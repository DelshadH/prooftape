import { lstat, readFile, writeFile } from "node:fs/promises";
import { isAbsolute, join, parse, relative, resolve } from "node:path";
import {
  AmbiguousComparisonError,
  buildReport,
  canonicalCapsule,
  canonicalJson,
  compareRevisions,
  generateReproduction,
  HarnessError,
  NoSafeReproductionError,
  recordRevision,
  UnsupportedCaptureError,
  UnsupportedComparisonError,
} from "@prooftape/core";
import {
  EXIT,
  parseCapsule,
  SchemaValidationError,
  type JsonValue,
  type ReportV1,
} from "@prooftape/schema";
import { CommandSyntaxError, parseCommand } from "./command.js";

export interface CliIo {
  readonly cwd: string;
  readonly stdout: (value: string) => void;
  readonly stderr: (value: string) => void;
}

class CliUsageError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "CliUsageError";
  }
}

const VERSION = "0.0.0";
const HELP = `ProofTape ${VERSION}

Usage:
  prooftape record --dependency <name> --command <command> --out <file> [--redact <literal>]
  prooftape diff --baseline <file> --candidate <file> [--report <file>] [--repro-dir <dir>]
  prooftape compare --base-ref <sha> --candidate-ref <sha> --dependency <name> --command <command> [--report <file>] [--repro-dir <dir>]

Commands are parsed into direct argument vectors. Shell operators and substitutions are rejected.

Exit codes:
  0  no blocking differences observed in captured supported calls
  2  one or more blocking behavior differences
  3  harness, command, instrumentation, isolation, or ambiguous matching failure
  4  invalid input or an explicitly unsupported surface
`;

const VALUE_OPTIONS = new Set([
  "--dependency",
  "--command",
  "--out",
  "--baseline",
  "--candidate",
  "--report",
  "--repro-dir",
  "--base-ref",
  "--candidate-ref",
  "--redact",
  "--timeout-ms",
  "--max-output-bytes",
  "--normalize",
]);

function parseOptions(args: readonly string[]): ReadonlyMap<string, readonly string[]> {
  const values = new Map<string, string[]>();
  for (let index = 0; index < args.length; index += 1) {
    const option = args[index];
    if (!option?.startsWith("--") || !VALUE_OPTIONS.has(option)) {
      throw new CliUsageError(`Unknown option ${JSON.stringify(option ?? "")}`);
    }
    const value = args[index + 1];
    if (value === undefined || value.startsWith("--")) {
      throw new CliUsageError(`Option ${option} requires a value`);
    }
    const existing = values.get(option) ?? [];
    if (existing.length > 0 && option !== "--redact" && option !== "--normalize") {
      throw new CliUsageError(`Option ${option} may be used only once`);
    }
    existing.push(value);
    values.set(option, existing);
    index += 1;
  }
  return values;
}

function parseNormalizers(values: readonly string[]): readonly {
  name: string;
  literal: string;
  replacement: string;
}[] {
  if (values.length > 20) throw new CliUsageError("at most 20 normalizers are supported");
  return values.map((value, index) => {
    const separator = value.indexOf("=");
    if (separator < 4) {
      throw new CliUsageError("--normalize uses <literal>=<replacement>");
    }
    const literal = value.slice(0, separator);
    const replacement = value.slice(separator + 1);
    if (literal.length > 256 || replacement.length > 256) {
      throw new CliUsageError("--normalize values must be at most 256 characters");
    }
    return { name: `literal-${index + 1}`, literal, replacement };
  });
}

function required(
  options: ReadonlyMap<string, readonly string[]>,
  name: string,
): string {
  const value = options.get(name)?.[0];
  if (value === undefined) throw new CliUsageError(`Missing required option ${name}`);
  return value;
}

function optionalInteger(
  options: ReadonlyMap<string, readonly string[]>,
  name: string,
  fallback: number,
): number {
  const value = options.get(name)?.[0];
  if (value === undefined) return fallback;
  if (!/^\d+$/u.test(value)) throw new CliUsageError(`${name} must be a decimal integer`);
  const parsedValue = Number(value);
  if (!Number.isSafeInteger(parsedValue)) throw new CliUsageError(`${name} is out of range`);
  return parsedValue;
}

function isInside(root: string, target: string): boolean {
  const path = relative(root, target);
  return path === "" || (!path.startsWith("..") && !isAbsolute(path));
}

async function assertNoSymlinkPath(root: string, target: string): Promise<void> {
  const pathRoot = parse(root).root;
  let current = pathRoot;
  for (const segment of relative(pathRoot, target).split(/[\\/]/u).filter(Boolean)) {
    current = join(current, segment);
    const stats = await lstat(current);
    if (stats.isSymbolicLink()) throw new CliUsageError("paths through symbolic links are not allowed");
  }
}

async function inputPath(cwd: string, userPath: string): Promise<string> {
  if (isAbsolute(userPath) || userPath.includes("\0")) {
    throw new CliUsageError("input paths must be relative to the repository");
  }
  const target = resolve(cwd, userPath);
  if (!isInside(cwd, target)) throw new CliUsageError("input path escapes the repository");
  await assertNoSymlinkPath(cwd, target);
  const stats = await lstat(target);
  if (!stats.isFile() || stats.isSymbolicLink()) {
    throw new CliUsageError("input path must be a regular file");
  }
  return target;
}

async function outputPath(cwd: string, userPath: string): Promise<string> {
  if (isAbsolute(userPath) || userPath.includes("\0")) {
    throw new CliUsageError("output paths must be relative to the repository");
  }
  const target = resolve(cwd, userPath);
  if (!isInside(cwd, target)) throw new CliUsageError("output path escapes the repository");
  const parent = resolve(target, "..");
  await assertNoSymlinkPath(cwd, parent);
  const parentStats = await lstat(parent);
  if (!parentStats.isDirectory() || parentStats.isSymbolicLink()) {
    throw new CliUsageError("output parent must be a real directory");
  }
  try {
    await lstat(target);
    throw new CliUsageError(`output already exists: ${userPath}`);
  } catch (error) {
    if (error instanceof CliUsageError) throw error;
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  return target;
}

async function writeExclusive(path: string, content: string): Promise<void> {
  await writeFile(path, content, { encoding: "utf8", flag: "wx", mode: 0o600 });
}

function cleanTerminal(value: string): string {
  return value.replace(/[\u0000-\u001f\u007f-\u009f]/gu, "?").slice(0, 1_000);
}

function printReport(report: ReportV1, io: CliIo): void {
  if (report.verdict === "no-blocking-differences-observed") {
    io.stdout("No blocking differences observed in captured supported calls.\n");
    return;
  }
  io.stdout(`${report.blockingDifferenceCount} blocking difference${report.blockingDifferenceCount === 1 ? "" : "s"} observed.\n`);
  for (const difference of report.differences.slice(0, 20)) {
    io.stdout(`- ${cleanTerminal(difference.summary)}\n`);
  }
}

async function diffCommand(
  options: ReadonlyMap<string, readonly string[]>,
  io: CliIo,
): Promise<number> {
  const baselinePath = await inputPath(io.cwd, required(options, "--baseline"));
  const candidatePath = await inputPath(io.cwd, required(options, "--candidate"));
  const baseline = parseCapsule(await readFile(baselinePath));
  const candidate = parseCapsule(await readFile(candidatePath));
  let report = buildReport(baseline, candidate);
  if (report.verdict === "behavior-changed") {
    const reproductionName = options.get("--repro-dir")?.[0] ?? "repro";
    const reproductionDirectory = await outputPath(io.cwd, reproductionName);
    try {
      const reproduction = await generateReproduction(
        baseline,
        candidate,
        report,
        reproductionDirectory,
      );
      report = { ...report, reproduction };
    } catch (error) {
      if (!(error instanceof NoSafeReproductionError)) throw error;
    }
  }
  const reportPath = await outputPath(io.cwd, options.get("--report")?.[0] ?? "report.json");
  await writeExclusive(reportPath, `${canonicalJson(report as unknown as JsonValue)}\n`);
  printReport(report, io);
  return report.verdict === "behavior-changed" ? EXIT.BEHAVIOR_CHANGED : EXIT.OK;
}

async function recordCommand(
  options: ReadonlyMap<string, readonly string[]>,
  io: CliIo,
): Promise<number> {
  const output = await outputPath(io.cwd, required(options, "--out"));
  const result = await recordRevision({
    cwd: io.cwd,
    dependency: required(options, "--dependency"),
    command: parseCommand(required(options, "--command")),
    hookUrl: import.meta.resolve("@prooftape/hook"),
    prooftapeVersion: VERSION,
    redactLiterals: options.get("--redact") ?? [],
    timeoutMilliseconds: optionalInteger(options, "--timeout-ms", 120_000),
    maxOutputBytes: optionalInteger(options, "--max-output-bytes", 1024 * 1024),
    normalizers: parseNormalizers(options.get("--normalize") ?? []),
  });
  await writeExclusive(output, `${canonicalCapsule(result.capsule)}\n`);
  if (result.hasUnsupported) {
    io.stderr("Recording completed with explicitly unsupported observations.\n");
    return EXIT.INVALID_INPUT;
  }
  io.stdout(`Recorded ${result.capsule.calls.length} supported call${result.capsule.calls.length === 1 ? "" : "s"}.\n`);
  return EXIT.OK;
}

async function compareCommand(
  options: ReadonlyMap<string, readonly string[]>,
  io: CliIo,
): Promise<number> {
  const reportPath = await outputPath(io.cwd, options.get("--report")?.[0] ?? "report.json");
  const reproductionName = options.get("--repro-dir")?.[0] ?? "repro";
  const reproductionDirectory = await outputPath(io.cwd, reproductionName);
  const result = await compareRevisions({
    cwd: io.cwd,
    baseRef: required(options, "--base-ref"),
    candidateRef: required(options, "--candidate-ref"),
    dependency: required(options, "--dependency"),
    command: parseCommand(required(options, "--command")),
    hookUrl: import.meta.resolve("@prooftape/hook"),
    prooftapeVersion: VERSION,
    redactLiterals: options.get("--redact") ?? [],
    timeoutMilliseconds: optionalInteger(options, "--timeout-ms", 120_000),
    maxOutputBytes: optionalInteger(options, "--max-output-bytes", 1024 * 1024),
    normalizers: parseNormalizers(options.get("--normalize") ?? []),
    reproductionDirectory,
  });
  await writeExclusive(reportPath, `${canonicalJson(result.report as unknown as JsonValue)}\n`);
  printReport(result.report, io);
  return result.report.verdict === "behavior-changed" ? EXIT.BEHAVIOR_CHANGED : EXIT.OK;
}

export async function runCli(
  args: readonly string[],
  io: CliIo,
): Promise<number> {
  const command = args[0];
  if (command === undefined || command === "--help" || command === "-h") {
    io.stdout(HELP);
    return EXIT.OK;
  }
  if (command === "--version") {
    io.stdout(`${VERSION}\n`);
    return EXIT.OK;
  }
  if (!["record", "diff", "compare"].includes(command)) {
    io.stderr(`Unknown command ${JSON.stringify(cleanTerminal(command))}.\n`);
    return EXIT.INVALID_INPUT;
  }
  try {
    const options = parseOptions(args.slice(1));
    if (command === "record") return await recordCommand(options, io);
    if (command === "diff") return await diffCommand(options, io);
    return await compareCommand(options, io);
  } catch (error) {
    const message = cleanTerminal(error instanceof Error ? error.message : "unknown failure");
    if (
      error instanceof CliUsageError
      || error instanceof CommandSyntaxError
      || error instanceof SchemaValidationError
      || error instanceof UnsupportedCaptureError
      || error instanceof UnsupportedComparisonError
      || (error as NodeJS.ErrnoException).code === "ENOENT"
    ) {
      io.stderr(`Unsupported or invalid input: ${message}\n`);
      return EXIT.INVALID_INPUT;
    }
    if (error instanceof HarnessError || error instanceof AmbiguousComparisonError) {
      io.stderr(`Harness failure: ${message}\n`);
      return EXIT.HARNESS_FAILED;
    }
    io.stderr(`Harness failure: ${message}\n`);
    return EXIT.HARNESS_FAILED;
  }
}
