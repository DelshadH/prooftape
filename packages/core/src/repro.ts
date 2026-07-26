import { lstat, mkdir, writeFile } from "node:fs/promises";
import { basename, dirname, resolve } from "node:path";
import type {
  BehaviorDiffV1,
  CallObservationV1,
  CapsuleV1,
  JsonValue,
  ReportV1,
  ReproductionEvidenceV1,
  ReproductionManifestV1,
} from "@prooftape/schema";
import { parseReproductionManifest } from "@prooftape/schema";
import { canonicalJson, sha256 } from "./canonical.js";

const REPRO_SCRIPT = `#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const inputPath = fileURLToPath(new URL("./input.json", import.meta.url));
const input = JSON.parse(await readFile(inputPath, "utf8"));

function revive(value) {
  if (Array.isArray(value)) return value.map(revive);
  if (value && typeof value === "object") {
    if (value.$prooftape === "undefined") return undefined;
    if (value.$prooftape === "nan") return Number.NaN;
    if (value.$prooftape === "infinity") return Number.POSITIVE_INFINITY;
    if (value.$prooftape === "-infinity") return Number.NEGATIVE_INFINITY;
    if (value.$prooftape === "-0") return -0;
    if (value.$prooftape === "bigint") return BigInt(value.value);
    if (value.$prooftape === "date") return new Date(value.value);
    return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, revive(child)]));
  }
  return value;
}

function capture(value, ancestors = new Set()) {
  if (value === null || typeof value === "boolean" || typeof value === "string") return value;
  if (typeof value === "number") {
    if (Number.isNaN(value)) return { $prooftape: "nan" };
    if (value === Number.POSITIVE_INFINITY) return { $prooftape: "infinity" };
    if (value === Number.NEGATIVE_INFINITY) return { $prooftape: "-infinity" };
    if (Object.is(value, -0)) return { $prooftape: "-0" };
    return value;
  }
  if (typeof value === "undefined") return { $prooftape: "undefined" };
  if (typeof value === "bigint") return { $prooftape: "bigint", value: value.toString(10) };
  if (value instanceof Date) return { $prooftape: "date", value: value.toISOString() };
  if (typeof value !== "object" || ancestors.has(value)) throw new Error("unsupported replay value");
  ancestors.add(value);
  const result = Array.isArray(value)
    ? value.map((child) => capture(child, ancestors))
    : Object.fromEntries(Object.keys(value).sort().map((key) => [key, capture(value[key], ancestors)]));
  ancestors.delete(value);
  return result;
}

function captureError(error) {
  if (!(error instanceof Error)) {
    return { name: "NonError", message: "non-Error value thrown", fields: { value: capture(error) } };
  }
  const fields = {};
  let code;
  for (const key of Object.keys(error).sort()) {
    if (key === "name" || key === "message" || key === "stack") continue;
    if (key === "code") code = capture(error[key]);
    else fields[key] = capture(error[key]);
  }
  return {
    name: error.name,
    message: error.message,
    ...(code === undefined ? {} : { code }),
    ...(Object.keys(fields).length === 0 ? {} : { fields }),
  };
}

function sort(value) {
  if (Array.isArray(value)) return value.map(sort);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, sort(value[key])]));
  }
  return value;
}

const requireFromCheckout = createRequire(pathToFileURL(join(process.cwd(), "package.json")));
const dependencyModule = input.moduleKind === "commonjs"
  ? requireFromCheckout(input.moduleSpecifier)
  : await import(pathToFileURL(requireFromCheckout.resolve(input.moduleSpecifier)).href);
let target = dependencyModule;
let receiver;
if (input.targetKind === "export") {
  for (const part of input.exportPath.split(".")) {
    if (input.receiverKind === "parent") receiver = target;
    target = target[part];
  }
}
const args = revive(input.argsBefore);
let actual;
try {
  const returned = Reflect.apply(target, receiver, args);
  if (returned instanceof Promise && Object.getPrototypeOf(returned) === Promise.prototype) {
    try {
      actual = { outcome: "resolve", value: capture(await returned), argsAfter: capture(args) };
    } catch (error) {
      actual = { outcome: "reject", error: captureError(error), argsAfter: capture(args) };
    }
  } else {
    actual = { outcome: "return", value: capture(returned), argsAfter: capture(args) };
  }
} catch (error) {
  actual = { outcome: "throw", error: captureError(error), argsAfter: capture(args) };
}

const matches = JSON.stringify(sort(actual)) === JSON.stringify(sort(input.expectedBase));
process.stdout.write(matches ? "ProofTape reproduction matches baseline\\n" : "ProofTape reproduction differs from baseline\\n");
process.exitCode = matches ? 0 : 1;
`;

function containsUnsafeReplayValue(value: JsonValue): boolean {
  if (typeof value === "string") return value.includes("[REDACTED]");
  if (Array.isArray(value)) return value.some(containsUnsafeReplayValue);
  if (value !== null && typeof value === "object") {
    const tag = value.$prooftape;
    if (tag === "unsupported" || tag === "error" || tag === "reference") return true;
    return Object.values(value).some(containsUnsafeReplayValue);
  }
  return false;
}

function observationOutcome(observation: CallObservationV1): JsonValue {
  return {
    outcome: observation.outcome,
    ...(observation.value === undefined ? {} : { value: observation.value }),
    ...(observation.error === undefined
      ? {}
      : { error: observation.error as unknown as JsonValue }),
    argsAfter: observation.argsAfter,
  };
}

function reproducibleDifference(
  difference: BehaviorDiffV1,
): difference is BehaviorDiffV1 & {
  readonly base: CallObservationV1;
  readonly candidate: CallObservationV1;
} {
  return (
    ["changed-return", "changed-error", "changed-mutation"].includes(difference.kind)
    && difference.base !== undefined
    && difference.candidate !== undefined
    && Array.isArray(difference.base.argsBefore)
    && (difference.base.unsupported?.length ?? 0) === 0
    && (difference.candidate.unsupported?.length ?? 0) === 0
    && (difference.base.normalization?.length ?? 0) === 0
    && (difference.candidate.normalization?.length ?? 0) === 0
    && difference.base.moduleKind !== undefined
    && difference.base.receiverKind !== undefined
    && difference.base.moduleSpecifier !== undefined
    && difference.base.targetKind !== undefined
    && difference.base.moduleKind === difference.candidate.moduleKind
    && difference.base.receiverKind === difference.candidate.receiverKind
    && difference.base.moduleSpecifier === difference.candidate.moduleSpecifier
    && difference.base.targetKind === difference.candidate.targetKind
    && !containsUnsafeReplayValue(difference.base.argsBefore)
    && !containsUnsafeReplayValue(observationOutcome(difference.base))
    && !containsUnsafeReplayValue(observationOutcome(difference.candidate))
  );
}

async function exclusiveWrite(path: string, value: string): Promise<void> {
  await writeFile(path, value, { encoding: "utf8", flag: "wx", mode: 0o600 });
}

export class NoSafeReproductionError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "NoSafeReproductionError";
  }
}

export async function generateReproduction(
  base: CapsuleV1,
  candidate: CapsuleV1,
  report: ReportV1,
  outputDirectory: string,
): Promise<ReproductionEvidenceV1> {
  const difference = report.differences.find(reproducibleDifference);
  if (!difference) {
    throw new NoSafeReproductionError("no changed call is eligible for a safe reproduction");
  }
  const absolute = resolve(outputDirectory);
  if (absolute !== outputDirectory) throw new Error("reproduction directory must be absolute");
  const parentStats = await lstat(dirname(absolute));
  if (!parentStats.isDirectory() || parentStats.isSymbolicLink()) {
    throw new Error("reproduction parent must be a real directory");
  }
  await mkdir(absolute, { recursive: false, mode: 0o700 });

  const input = canonicalJson({
    schemaVersion: "1",
    kind: "prooftape-reproduction-input",
    dependency: report.dependency,
    exportPath: difference.base.exportPath,
    moduleKind: difference.base.moduleKind!,
    receiverKind: difference.base.receiverKind!,
    moduleSpecifier: difference.base.moduleSpecifier!,
    targetKind: difference.base.targetKind!,
    argsBefore: difference.base.argsBefore,
    expectedBase: observationOutcome(difference.base),
    observedCandidate: observationOutcome(difference.candidate),
  });
  const basePackage = canonicalJson({
    name: report.dependency,
    version: base.metadata.dependency.version,
    entry: base.metadata.dependency.entry,
    lockfileSha256: base.metadata.lockfileSha256,
  });
  const candidatePackage = canonicalJson({
    name: report.dependency,
    version: candidate.metadata.dependency.version,
    entry: candidate.metadata.dependency.entry,
    lockfileSha256: candidate.metadata.lockfileSha256,
  });
  const readme = [
    "# ProofTape reproduction",
    "",
    "Run this directory's script from a checkout with dependencies installed:",
    "",
    "```bash",
    "node /absolute/path/to/repro.mjs",
    "```",
    "",
    "Exit 0 matches the recorded base outcome. Exit 1 reproduces the behavior difference.",
    "",
    "Observation authenticity is not established. Code under test shared the recorder's",
    "process authority and could have suppressed or forged the captured call.",
    "",
  ].join("\n");
  const files = {
    "README.md": readme,
    "base-package.json": `${basePackage}\n`,
    "candidate-package.json": `${candidatePackage}\n`,
    "input.json": `${input}\n`,
    "repro.mjs": REPRO_SCRIPT,
  };
  for (const [name, content] of Object.entries(files)) {
    await exclusiveWrite(resolve(absolute, name), content);
  }
  const manifestValue = {
    schemaVersion: "1",
    kind: "prooftape-reproduction-manifest",
    observationAuthenticity: "not-established",
    matchKey: difference.matchKey,
    files: {
      "README.md": sha256(files["README.md"]),
      "base-package.json": sha256(files["base-package.json"]),
      "candidate-package.json": sha256(files["candidate-package.json"]),
      "input.json": sha256(files["input.json"]),
      "repro.mjs": sha256(files["repro.mjs"]),
    },
  } satisfies ReproductionManifestV1;
  const manifest = canonicalJson(manifestValue);
  parseReproductionManifest(manifest);
  await exclusiveWrite(resolve(absolute, "manifest.json"), `${manifest}\n`);
  return {
    directory: basename(absolute),
    manifestSha256: sha256(manifest),
    matchKey: difference.matchKey,
  };
}
