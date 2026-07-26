import {
  closeSync,
  constants,
  lstatSync,
  openSync,
  writeSync,
} from "node:fs";
import { isAbsolute, join, parse, relative, resolve } from "node:path";
import { registerHooks } from "node:module";
import { threadId } from "node:worker_threads";
import type { RawCallObservationV1 } from "@prooftape/schema";
import { createRuntime } from "./runtime.js";
import { transformApplicationSource, type TransformIssue } from "./transform.js";

export interface HookLimits {
  readonly maxEvents: number;
  readonly maxEventBytes: number;
  readonly maxDepth: number;
  readonly maxCollectionEntries: number;
  readonly maxStringBytes: number;
}

export interface HookOptions {
  readonly schemaVersion: "1";
  readonly dependency: string;
  readonly outputDirectory: string;
  readonly sessionId: string;
  readonly limits: HookLimits;
  readonly redactLiterals: readonly string[];
}

interface RawCallRecord {
  readonly schemaVersion: "1";
  readonly kind: "call";
  readonly sessionId: string;
  readonly call: RawCallObservationV1;
}

interface RawIssueRecord {
  readonly schemaVersion: "1";
  readonly kind: "issue";
  readonly sessionId: string;
  readonly issue: TransformIssue;
}

type RawRecord = RawCallRecord | RawIssueRecord;

const RUNTIME_SYMBOL = Symbol.for("prooftape.runtime.v1");
const PACKAGE_NAME = /^(?:@[a-z0-9][a-z0-9._~-]*\/)?[a-z0-9][a-z0-9._~-]*$/u;
const SESSION_ID = /^[a-zA-Z0-9_-]{8,64}$/u;

function object(value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

function exactKeys(
  value: Record<string, unknown>,
  expected: readonly string[],
  label: string,
): void {
  const actual = Object.keys(value).sort();
  const sortedExpected = [...expected].sort();
  if (
    actual.length !== sortedExpected.length
    || actual.some((key, index) => key !== sortedExpected[index])
  ) {
    throw new Error(`${label} has missing or unknown fields`);
  }
}

function boundedInteger(
  value: unknown,
  label: string,
  minimum: number,
  maximum: number,
): number {
  if (!Number.isSafeInteger(value) || (value as number) < minimum || (value as number) > maximum) {
    throw new Error(`${label} must be an integer from ${minimum} to ${maximum}`);
  }
  return value as number;
}

export function parseHookOptions(raw: string): HookOptions {
  if (Buffer.byteLength(raw, "utf8") > 64 * 1024) {
    throw new Error("PROOFTAPE_CONFIG exceeds 64 KiB");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("PROOFTAPE_CONFIG is not valid JSON");
  }
  const config = object(parsed, "PROOFTAPE_CONFIG");
  exactKeys(
    config,
    [
      "schemaVersion",
      "dependency",
      "outputDirectory",
      "sessionId",
      "limits",
      "redactLiterals",
    ],
    "PROOFTAPE_CONFIG",
  );
  if (config.schemaVersion !== "1") throw new Error("unsupported hook schemaVersion");
  if (typeof config.dependency !== "string" || !PACKAGE_NAME.test(config.dependency)) {
    throw new Error("dependency must be an exact npm package name");
  }
  if (typeof config.outputDirectory !== "string" || !isAbsolute(config.outputDirectory)) {
    throw new Error("outputDirectory must be absolute");
  }
  if (typeof config.sessionId !== "string" || !SESSION_ID.test(config.sessionId)) {
    throw new Error("sessionId is invalid");
  }
  if (!Array.isArray(config.redactLiterals) || config.redactLiterals.length > 20) {
    throw new Error("redactLiterals must contain at most 20 strings");
  }
  const redactLiterals = config.redactLiterals.map((literal, index) => {
    if (typeof literal !== "string" || literal.length < 4 || literal.length > 256) {
      throw new Error(`redactLiterals[${index}] must contain 4 to 256 characters`);
    }
    return literal;
  });
  const limits = object(config.limits, "limits");
  exactKeys(
    limits,
    [
      "maxEvents",
      "maxEventBytes",
      "maxDepth",
      "maxCollectionEntries",
      "maxStringBytes",
    ],
    "limits",
  );
  return {
    schemaVersion: "1",
    dependency: config.dependency,
    outputDirectory: config.outputDirectory,
    sessionId: config.sessionId,
    limits: {
      maxEvents: boundedInteger(limits.maxEvents, "maxEvents", 1, 10_000),
      maxEventBytes: boundedInteger(limits.maxEventBytes, "maxEventBytes", 1_024, 1024 * 1024),
      maxDepth: boundedInteger(limits.maxDepth, "maxDepth", 1, 32),
      maxCollectionEntries: boundedInteger(
        limits.maxCollectionEntries,
        "maxCollectionEntries",
        1,
        10_000,
      ),
      maxStringBytes: boundedInteger(limits.maxStringBytes, "maxStringBytes", 16, 1024 * 1024),
    },
    redactLiterals,
  };
}

function createWriter(options: HookOptions): {
  readonly writeCall: (call: RawCallObservationV1) => void;
  readonly writeIssue: (issue: TransformIssue) => void;
} {
  const outputDirectory = resolve(options.outputDirectory);
  const stats = lstatSync(outputDirectory);
  if (!stats.isDirectory() || stats.isSymbolicLink()) {
    throw new Error("outputDirectory must be a real directory");
  }
  const root = parse(outputDirectory).root;
  let current = root;
  for (const segment of relative(root, outputDirectory).split(/[\\/]/u).filter(Boolean)) {
    current = join(current, segment);
    if (lstatSync(current).isSymbolicLink()) {
      throw new Error("outputDirectory must not traverse symbolic links");
    }
  }
  const outputPath = join(
    outputDirectory,
    `raw-${options.sessionId}-${process.pid}-${threadId}.jsonl`,
  );
  const flags = constants.O_APPEND
    | constants.O_CREAT
    | constants.O_EXCL
    | constants.O_WRONLY
    | (constants.O_NOFOLLOW ?? 0);
  const descriptor = openSync(outputPath, flags, 0o600);
  let eventCount = 0;
  let limitIssueWritten = false;

  const writeRecord = (record: RawRecord): void => {
    if (eventCount >= options.limits.maxEvents) {
      if (!limitIssueWritten) {
        limitIssueWritten = true;
        const bounded = `${JSON.stringify({
          schemaVersion: "1",
          kind: "issue",
          sessionId: options.sessionId,
          issue: {
            code: "PT_EVENT_LIMIT",
            message: "per-process observation limit reached",
          },
        })}\n`;
        writeSync(descriptor, bounded, undefined, "utf8");
      }
      return;
    }
    const line = `${JSON.stringify(record)}\n`;
    if (Buffer.byteLength(line, "utf8") > options.limits.maxEventBytes) {
      if (!limitIssueWritten) {
        limitIssueWritten = true;
        const bounded = `${JSON.stringify({
          schemaVersion: "1",
          kind: "issue",
          sessionId: options.sessionId,
          issue: {
            code: "PT_EVENT_BYTES",
            message: "an observation exceeded the configured byte limit",
          },
        })}\n`;
        writeSync(descriptor, bounded, undefined, "utf8");
      }
      return;
    }
    writeSync(descriptor, line, undefined, "utf8");
    eventCount += 1;
  };

  process.once("exit", () => {
    try {
      closeSync(descriptor);
    } catch {
      // The process is already exiting and the descriptor may have been closed by user code.
    }
  });

  return {
    writeCall: (call) => writeRecord({
      schemaVersion: "1",
      kind: "call",
      sessionId: options.sessionId,
      call,
    }),
    writeIssue: (transformIssue) => writeRecord({
      schemaVersion: "1",
      kind: "issue",
      sessionId: options.sessionId,
      issue: transformIssue,
    }),
  };
}

export function registerProofTapeHooks(options: HookOptions): void {
  const writer = createWriter(options);
  const recorderProcessId = `${process.pid}-${threadId}`;
  const runtime = createRuntime({
    processId: recorderProcessId,
    maxDepth: options.limits.maxDepth,
    maxCollectionEntries: options.limits.maxCollectionEntries,
    maxStringBytes: options.limits.maxStringBytes,
    redactLiterals: options.redactLiterals,
    emit: writer.writeCall,
    onInternalError: () => {
      writer.writeIssue({
        code: "PT_RECORDER_WRITE",
        message: "the recorder could not persist an observation",
      });
    },
  });
  if (Object.prototype.hasOwnProperty.call(globalThis, RUNTIME_SYMBOL)) {
    throw new Error("ProofTape runtime symbol is already defined");
  }
  Object.defineProperty(globalThis, RUNTIME_SYMBOL, {
    configurable: false,
    enumerable: false,
    writable: false,
    value: runtime,
  });

  registerHooks({
    load(url, context, nextLoad) {
      const loaded = nextLoad(url, context);
      if (
        (loaded.format !== "module" && loaded.format !== "commonjs")
        || loaded.source === null
        || loaded.source === undefined
      ) {
        return loaded;
      }
      const source = typeof loaded.source === "string"
        ? loaded.source
        : loaded.source instanceof ArrayBuffer
          ? Buffer.from(loaded.source).toString("utf8")
          : Buffer.from(
            loaded.source.buffer,
            loaded.source.byteOffset,
            loaded.source.byteLength,
          ).toString("utf8");
      const result = transformApplicationSource(source, {
        dependency: options.dependency,
        format: loaded.format,
        url,
      });
      for (const transformIssue of result.issues) writer.writeIssue(transformIssue);
      return result.transformed ? { ...loaded, source: result.source } : loaded;
    },
  });
}

const rawConfig = process.env.PROOFTAPE_CONFIG;
if (rawConfig !== undefined) {
  registerProofTapeHooks(parseHookOptions(rawConfig));
}
