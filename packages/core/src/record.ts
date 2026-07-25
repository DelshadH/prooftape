import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import {
  lstat,
  mkdtemp,
  readFile,
  realpath,
  rm,
} from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { tmpdir } from "node:os";
import { randomBytes } from "node:crypto";
import type { EvidenceMetadataV1 } from "@prooftape/schema";
import { canonicalJson, sha256 } from "./canonical.js";
import { mergeRawDirectory, type RawMergeResult } from "./capsule.js";
import { canonicalCapsule } from "./capsule.js";
import { normalizeObservation, type LiteralNormalizer } from "./normalize.js";
import { parseCapsule } from "@prooftape/schema";

export interface RecordRevisionOptions {
  readonly cwd: string;
  readonly dependency: string;
  readonly command: readonly string[];
  readonly hookUrl: string;
  readonly prooftapeVersion: string;
  readonly redactLiterals: readonly string[];
  readonly timeoutMilliseconds: number;
  readonly maxOutputBytes: number;
  readonly normalizers?: readonly LiteralNormalizer[];
}

export class HarnessError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "HarnessError";
  }
}

export class UnsupportedCaptureError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "UnsupportedCaptureError";
  }
}

const COMMAND_ENVIRONMENT_ALLOWLIST = new Set([
  "ci",
  "comspec",
  "force_color",
  "lang",
  "language",
  "lc_all",
  "node_no_warnings",
  "no_color",
  "path",
  "pathext",
  "systemroot",
  "temp",
  "tmp",
  "tmpdir",
  "tz",
  "windir",
]);

function commandEnvironment(
  nodeOptions: string,
  hookConfig: Readonly<Record<string, unknown>>,
): NodeJS.ProcessEnv {
  const environment: NodeJS.ProcessEnv = {};
  for (const [name, value] of Object.entries(process.env)) {
    if (
      value !== undefined
      && Buffer.byteLength(value, "utf8") <= 32 * 1024
      && (
        COMMAND_ENVIRONMENT_ALLOWLIST.has(name.toLocaleLowerCase())
        || name.toLocaleLowerCase().startsWith("lc_")
      )
    ) {
      environment[name] = value;
    }
  }
  environment.NODE_OPTIONS = nodeOptions;
  environment.PROOFTAPE_CONFIG = JSON.stringify(hookConfig);
  return environment;
}

function runGit(cwd: string, args: readonly string[]): string {
  const result = spawnSync("git", args, {
    cwd,
    encoding: "utf8",
    timeout: 10_000,
    maxBuffer: 1024 * 1024,
    windowsHide: true,
  });
  if (result.error || result.status !== 0) {
    throw new HarnessError(`Git command failed: git ${args[0] ?? ""}`);
  }
  return result.stdout.trim();
}

async function lockfileEvidence(cwd: string): Promise<{ bytes: Buffer; hash: string }> {
  const path = join(cwd, "package-lock.json");
  let stats;
  try {
    stats = await lstat(path);
  } catch {
    throw new UnsupportedCaptureError("package-lock.json is required");
  }
  if (!stats.isFile() || stats.isSymbolicLink()) {
    throw new UnsupportedCaptureError("package-lock.json must be a regular file");
  }
  if (stats.size > 10 * 1024 * 1024) {
    throw new UnsupportedCaptureError("package-lock.json exceeds 10 MiB");
  }
  const bytes = await readFile(path);
  if (bytes.length !== stats.size) throw new HarnessError("package-lock.json changed while reading");
  try {
    const parsed = JSON.parse(bytes.toString("utf8")) as { lockfileVersion?: unknown };
    if (parsed.lockfileVersion !== 2 && parsed.lockfileVersion !== 3) {
      throw new UnsupportedCaptureError("npm lockfileVersion 2 or 3 is required");
    }
  } catch (error) {
    if (error instanceof UnsupportedCaptureError) throw error;
    throw new UnsupportedCaptureError("package-lock.json is invalid JSON");
  }
  return { bytes, hash: sha256(bytes) };
}

async function dependencyEvidence(
  cwd: string,
  dependency: string,
): Promise<EvidenceMetadataV1["dependency"]> {
  const requireFromProject = createRequire(join(cwd, "package.json"));
  let entry: string;
  try {
    entry = requireFromProject.resolve(dependency);
  } catch {
    throw new UnsupportedCaptureError(`dependency ${JSON.stringify(dependency)} is not installed`);
  }
  let current = dirname(entry);
  const root = resolve(cwd);
  while (true) {
    const manifestPath = join(current, "package.json");
    try {
      const stats = await lstat(manifestPath);
      if (stats.isFile() && !stats.isSymbolicLink() && stats.size <= 1024 * 1024) {
        const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as {
          name?: unknown;
          version?: unknown;
        };
        if (manifest.name === dependency && typeof manifest.version === "string") {
          const relativeEntry = relative(root, resolve(entry)).replaceAll("\\", "/");
          if (relativeEntry.startsWith("../") || relativeEntry === "..") {
            throw new UnsupportedCaptureError("dependency entry resolves outside the checkout");
          }
          return {
            name: dependency,
            version: manifest.version,
            entry: relativeEntry,
          };
        }
      }
    } catch (error) {
      if (error instanceof UnsupportedCaptureError) throw error;
    }
    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }
  throw new UnsupportedCaptureError(`cannot locate package metadata for ${JSON.stringify(dependency)}`);
}

async function removeRawDirectory(directory: string): Promise<void> {
  const absolute = resolve(directory);
  const expectedPrefix = resolve(tmpdir(), "prooftape-record-");
  if (!absolute.startsWith(expectedPrefix)) {
    throw new HarnessError("refusing to remove an unexpected raw observation directory");
  }
  await rm(absolute, { recursive: true, force: true });
}

export async function recordRevision(
  options: RecordRevisionOptions,
): Promise<RawMergeResult> {
  if (options.command.length === 0 || options.command.length > 256) {
    throw new UnsupportedCaptureError("command must contain 1 to 256 arguments");
  }
  if (
    !Number.isSafeInteger(options.timeoutMilliseconds)
    || options.timeoutMilliseconds < 1
    || options.timeoutMilliseconds > 15 * 60 * 1000
  ) {
    throw new UnsupportedCaptureError("timeout must be from 1 ms to 15 minutes");
  }
  if (
    !Number.isSafeInteger(options.maxOutputBytes)
    || options.maxOutputBytes < 1024
    || options.maxOutputBytes > 10 * 1024 * 1024
  ) {
    throw new UnsupportedCaptureError("output limit must be from 1 KiB to 10 MiB");
  }

  const cwd = await realpath(resolve(options.cwd));
  const normalizers = options.normalizers ?? [];
  if (normalizers.length > 20) {
    throw new UnsupportedCaptureError("at most 20 literal normalizers are supported");
  }
  for (const [index, normalizer] of normalizers.entries()) {
    if (
      normalizer.name.length < 1
      || normalizer.name.length > 64
      || normalizer.literal.length < 4
      || normalizer.literal.length > 256
      || normalizer.replacement.length > 256
    ) {
      throw new UnsupportedCaptureError(`normalizer ${index + 1} is outside supported bounds`);
    }
  }
  const gitRoot = await realpath(runGit(cwd, ["rev-parse", "--show-toplevel"]));
  if (gitRoot.toLocaleLowerCase() !== cwd.toLocaleLowerCase()) {
    throw new UnsupportedCaptureError("record must run at the Git repository root");
  }
  const beforeStatus = runGit(cwd, ["status", "--porcelain", "--untracked-files=all"]);
  if (beforeStatus !== "") throw new HarnessError("checkout files are not clean");
  const commitSha = runGit(cwd, ["rev-parse", "HEAD"]);
  if (!/^[a-f0-9]{40}$/u.test(commitSha)) throw new HarnessError("Git did not return a full commit SHA");
  const lockfile = await lockfileEvidence(cwd);
  const dependency = await dependencyEvidence(cwd, options.dependency);
  const configurationSha256 = sha256(canonicalJson({
    command: [...options.command],
    dependency: options.dependency,
    limits: {
      maxCollectionEntries: 100,
      maxDepth: 12,
      maxEventBytes: 1024 * 1024,
      maxEvents: 10_000,
      maxStringBytes: 16 * 1024,
      maxOutputBytes: options.maxOutputBytes,
      timeoutMilliseconds: options.timeoutMilliseconds,
    },
    redactionLiteralCount: options.redactLiterals.length,
    normalizers: normalizers.map((normalizer) => ({
      name: normalizer.name,
      replacement: normalizer.replacement,
    })),
  }));
  const metadata: EvidenceMetadataV1 = {
    commitSha,
    lockfileSha256: lockfile.hash,
    nodeVersion: process.version,
    platform: process.platform,
    arch: process.arch,
    command: [...options.command],
    dependency,
    prooftapeVersion: options.prooftapeVersion,
    configurationSha256,
    observationAuthenticity: "not-established",
  };
  const rawDirectory = await mkdtemp(join(tmpdir(), "prooftape-record-"));
  const sessionId = randomBytes(12).toString("hex");
  const hookConfig = {
    schemaVersion: "1",
    dependency: options.dependency,
    outputDirectory: rawDirectory,
    sessionId,
    limits: {
      maxEvents: 10_000,
      maxEventBytes: 1024 * 1024,
      maxDepth: 12,
      maxCollectionEntries: 100,
      maxStringBytes: 16 * 1024,
    },
    redactLiterals: options.redactLiterals,
  };
  const existingNodeOptions = process.env.NODE_OPTIONS?.trim() ?? "";
  if (Buffer.byteLength(existingNodeOptions, "utf8") > 16 * 1024) {
    await removeRawDirectory(rawDirectory);
    throw new UnsupportedCaptureError("existing NODE_OPTIONS exceeds 16 KiB");
  }
  const nodeOptions = `${existingNodeOptions}${existingNodeOptions ? " " : ""}--import=${options.hookUrl}`;

  try {
    const commandResult = spawnSync(options.command[0]!, options.command.slice(1), {
      cwd,
      env: commandEnvironment(nodeOptions, hookConfig),
      encoding: "buffer",
      timeout: options.timeoutMilliseconds,
      maxBuffer: options.maxOutputBytes,
      windowsHide: true,
      shell: false,
    });
    if (commandResult.error) {
      const code = (commandResult.error as NodeJS.ErrnoException).code;
      if (code === "ETIMEDOUT") throw new HarnessError("test command timed out");
      if (code === "ENOBUFS") throw new HarnessError("test command exceeded the output limit");
      throw new HarnessError(`test command could not start${code ? ` (${code})` : ""}`);
    }
    if (commandResult.signal) throw new HarnessError(`test command ended by ${commandResult.signal}`);
    if (commandResult.status !== 0) {
      throw new HarnessError(`test command exited ${commandResult.status ?? "without a status"}`);
    }
    const afterStatus = runGit(cwd, ["status", "--porcelain", "--untracked-files=all"]);
    if (afterStatus !== "") throw new HarnessError("test command modified checkout files");
    const merged = await mergeRawDirectory(rawDirectory, sessionId, metadata);
    if (merged.capsule.calls.length === 0) {
      throw new UnsupportedCaptureError("test command made no supported calls to the dependency");
    }
    if (normalizers.length === 0) return merged;
    const capsule = parseCapsule(JSON.stringify({
      ...merged.capsule,
      calls: merged.capsule.calls.map((call) => normalizeObservation(call, normalizers)),
    }));
    const canonical = canonicalCapsule(capsule);
    return {
      capsule,
      capsuleHash: sha256(canonical),
      hasUnsupported: merged.hasUnsupported,
    };
  } finally {
    await removeRawDirectory(rawDirectory);
  }
}
