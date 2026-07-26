import { lstat, readFile, readdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import {
  parseCapsule,
  type CallObservationV1,
  type CapsuleV1,
  type CaptureIssueV1,
  type EvidenceMetadataV1,
  type JsonValue,
} from "@prooftape/schema";
import { canonicalJson, sha256 } from "./canonical.js";

export interface RawMergeLimits {
  readonly maxFiles?: number;
  readonly maxTotalBytes?: number;
  readonly maxLineBytes?: number;
}

export interface RawMergeResult {
  readonly capsule: CapsuleV1;
  readonly capsuleHash: string;
  readonly hasUnsupported: boolean;
}

export class CaptureMergeError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "CaptureMergeError";
  }
}

function rawObject(value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new CaptureMergeError(`${label} must be an object`);
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
    throw new CaptureMergeError(`${label} has missing or unknown fields`);
  }
}

function regexEscape(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

function stableProcessSignature(calls: readonly CallObservationV1[]): string {
  const stable = calls
    .slice()
    .sort((left, right) => left.sequence - right.sequence)
    .map(({ callId: _callId, processId: _processId, ...call }) => call);
  return sha256(canonicalJson(stable as unknown as JsonValue));
}

function normalizeProcess(
  calls: readonly CallObservationV1[],
  processId: string,
): readonly CallObservationV1[] {
  return calls
    .slice()
    .sort((left, right) => left.sequence - right.sequence)
    .map((call) => ({
      ...call,
      processId,
      callId: `${processId}:${call.sequence}`,
    }));
}

export function canonicalCapsule(capsule: CapsuleV1): string {
  return canonicalJson(capsule as unknown as JsonValue);
}

export async function mergeRawDirectory(
  directory: string,
  sessionId: string,
  metadata: EvidenceMetadataV1,
  limits: RawMergeLimits = {},
): Promise<RawMergeResult> {
  const maxFiles = limits.maxFiles ?? 128;
  const maxTotalBytes = limits.maxTotalBytes ?? 20 * 1024 * 1024;
  const maxLineBytes = limits.maxLineBytes ?? 1024 * 1024;
  const absoluteDirectory = resolve(directory);
  const directoryStats = await lstat(absoluteDirectory);
  if (!directoryStats.isDirectory() || directoryStats.isSymbolicLink()) {
    throw new CaptureMergeError("raw observation path must be a real directory");
  }
  const names = (await readdir(absoluteDirectory)).sort();
  if (names.length > maxFiles) throw new CaptureMergeError("raw observation file limit exceeded");
  const namePattern = new RegExp(
    `^raw-${regexEscape(sessionId)}-(\\d+(?:-\\d+)?)\\.jsonl$`,
    "u",
  );
  const rawCalls: unknown[] = [];
  const rawIssues: CaptureIssueV1[] = [];
  let totalBytes = 0;

  for (const name of names) {
    const match = namePattern.exec(name);
    if (!match) throw new CaptureMergeError(`unexpected raw observation file ${JSON.stringify(name)}`);
    const fileProcessId = match[1];
    if (!fileProcessId) throw new CaptureMergeError("raw observation filename has no process ID");
    const filePath = join(absoluteDirectory, name);
    const stats = await lstat(filePath);
    if (!stats.isFile() || stats.isSymbolicLink()) {
      throw new CaptureMergeError("raw observation entries must be regular files");
    }
    totalBytes += stats.size;
    if (totalBytes > maxTotalBytes) {
      throw new CaptureMergeError("raw observation byte limit exceeded");
    }
    const bytes = await readFile(filePath);
    if (bytes.length !== stats.size) {
      throw new CaptureMergeError("raw observation file changed during verification");
    }
    if (bytes.length === 0) continue;
    let text: string;
    try {
      text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    } catch {
      throw new CaptureMergeError("raw observation file contains invalid UTF-8");
    }
    if (!text.endsWith("\n")) {
      throw new CaptureMergeError("raw observation file ends with a partial line");
    }
    const lines = text.slice(0, -1).split("\n");
    for (const [lineIndex, line] of lines.entries()) {
      if (Buffer.byteLength(line, "utf8") > maxLineBytes) {
        throw new CaptureMergeError(`raw observation line ${lineIndex + 1} exceeds line limit`);
      }
      let parsed: unknown;
      try {
        parsed = JSON.parse(line);
      } catch {
        throw new CaptureMergeError(`raw observation line ${lineIndex + 1} is invalid JSON`);
      }
      const envelope = rawObject(parsed, "raw observation");
      exactKeys(envelope, ["schemaVersion", "kind", "sessionId", envelope.kind === "call" ? "call" : "issue"], "raw observation");
      if (envelope.schemaVersion !== "1") {
        throw new CaptureMergeError("raw observation schemaVersion is unsupported");
      }
      if (envelope.sessionId !== sessionId) {
        throw new CaptureMergeError("raw observation session does not match");
      }
      if (envelope.kind === "call") {
        const rawCall = rawObject(envelope.call, "raw call");
        if (rawCall.processId !== fileProcessId) {
          throw new CaptureMergeError("raw call process does not match its filename");
        }
        const duration = rawCall.durationNanoseconds;
        if (
          typeof duration !== "string"
          || duration.length === 0
          || duration.length > 64
          || !/^\d+$/u.test(duration)
        ) {
          throw new CaptureMergeError(
            "raw call durationNanoseconds must be a decimal integer of at most 64 digits",
          );
        }
        const {
          durationNanoseconds: _durationNanoseconds,
          ...persistedCall
        } = rawCall;
        rawCalls.push(persistedCall);
      } else if (envelope.kind === "issue") {
        const rawIssue = rawObject(envelope.issue, "raw issue");
        exactKeys(rawIssue, ["code", "message"], "raw issue");
        if (typeof rawIssue.code !== "string" || typeof rawIssue.message !== "string") {
          throw new CaptureMergeError("raw issue fields must be strings");
        }
        rawIssues.push({
          code: rawIssue.code,
          message: rawIssue.message,
          processId: fileProcessId,
        });
      } else {
        throw new CaptureMergeError("raw observation kind is unsupported");
      }
    }
  }

  let parsedRaw: CapsuleV1;
  try {
    parsedRaw = parseCapsule(JSON.stringify({
      schemaVersion: "1",
      kind: "prooftape-capsule",
      metadata,
      calls: rawCalls,
      issues: rawIssues,
    }));
  } catch (error) {
    throw new CaptureMergeError(
      `raw observations failed schema validation: ${error instanceof Error ? error.message : "unknown error"}`,
    );
  }

  const groups = new Map<string, CallObservationV1[]>();
  for (const call of parsedRaw.calls) {
    const group = groups.get(call.processId) ?? [];
    group.push(call);
    groups.set(call.processId, group);
  }
  const orderedGroups = [...groups.entries()]
    .map(([rawProcessId, calls]) => ({
      rawProcessId,
      calls,
      signature: stableProcessSignature(calls),
    }))
    .sort((left, right) =>
      left.signature.localeCompare(right.signature)
      || left.rawProcessId.localeCompare(right.rawProcessId),
    );
  const processMapping = new Map<string, string>();
  const calls: CallObservationV1[] = [];
  orderedGroups.forEach((group, index) => {
    const normalized = `p${index + 1}`;
    processMapping.set(group.rawProcessId, normalized);
    calls.push(...normalizeProcess(group.calls, normalized));
  });
  const issues = parsedRaw.issues
    .map((captureIssue) => ({
      ...captureIssue,
      ...(captureIssue.processId
        ? { processId: processMapping.get(captureIssue.processId) ?? "unobserved-process" }
        : {}),
    }))
    .sort((left, right) =>
      left.code.localeCompare(right.code)
      || (left.processId ?? "").localeCompare(right.processId ?? "")
      || left.message.localeCompare(right.message),
    );

  const capsule = parseCapsule(JSON.stringify({
    schemaVersion: "1",
    kind: "prooftape-capsule",
    metadata,
    calls,
    issues,
  }));
  const canonical = canonicalCapsule(capsule);
  return {
    capsule,
    capsuleHash: sha256(canonical),
    hasUnsupported:
      capsule.issues.length > 0
      || capsule.calls.some((call) => (call.unsupported?.length ?? 0) > 0),
  };
}
