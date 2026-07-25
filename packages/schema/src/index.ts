export type JsonPrimitive = null | boolean | number | string;
export type JsonValue = JsonPrimitive | JsonValue[] | { readonly [key: string]: JsonValue };

export type OutcomeKind = "return" | "throw" | "resolve" | "reject";
export type ObservationAuthenticity = "not-established";

export interface SerializedError {
  readonly name: string;
  readonly message: string;
  readonly code?: JsonValue;
  readonly fields?: Readonly<Record<string, JsonValue>>;
}

export interface NormalizationRecord {
  readonly jsonPointer: string;
  readonly normalizer: string;
  readonly beforeHash: string;
  readonly after: JsonValue;
}

export interface UnsupportedObservation {
  readonly path: string;
  readonly reason: string;
  readonly type: string;
}

export interface CallObservationV1 {
  readonly schemaVersion: "1";
  readonly callId: string;
  readonly sequence: number;
  readonly processId: string;
  readonly dependency: string;
  readonly exportPath: string;
  readonly callSiteFingerprint: string;
  readonly argsBefore: JsonValue;
  readonly argsAfter: JsonValue;
  readonly outcome: OutcomeKind;
  readonly value?: JsonValue;
  readonly error?: SerializedError;
  readonly durationNanoseconds?: string;
  readonly normalization?: readonly NormalizationRecord[];
  readonly unsupported?: readonly UnsupportedObservation[];
}

export type DiffKind =
  | "added-call"
  | "removed-call"
  | "changed-return"
  | "changed-error"
  | "changed-mutation"
  | "changed-sequence"
  | "timing-warning"
  | "ambiguous";

export interface BehaviorDiffV1 {
  readonly schemaVersion: "1";
  readonly kind: DiffKind;
  readonly blocking: boolean;
  readonly matchKey: string;
  readonly base?: CallObservationV1;
  readonly candidate?: CallObservationV1;
  readonly summary: string;
}

export interface EvidenceMetadataV1 {
  readonly commitSha: string;
  readonly lockfileSha256: string;
  readonly nodeVersion: string;
  readonly platform: string;
  readonly arch: string;
  readonly command: readonly string[];
  readonly dependency: {
    readonly name: string;
    readonly version: string;
    readonly entry: string;
  };
  readonly prooftapeVersion: string;
  readonly configurationSha256: string;
  readonly observationAuthenticity: ObservationAuthenticity;
}

export interface CaptureIssueV1 {
  readonly code: string;
  readonly message: string;
  readonly processId?: string;
  readonly sequence?: number;
}

export interface CapsuleV1 {
  readonly schemaVersion: "1";
  readonly kind: "prooftape-capsule";
  readonly metadata: EvidenceMetadataV1;
  readonly calls: readonly CallObservationV1[];
  readonly issues: readonly CaptureIssueV1[];
}

export type ReportVerdict =
  | "no-blocking-differences-observed"
  | "behavior-changed";

export interface ReportEvidenceV1 {
  readonly capsuleHash: string;
  readonly commitSha: string;
  readonly lockfileSha256: string;
  readonly dependencyVersion: string;
  readonly observationAuthenticity: ObservationAuthenticity;
}

export interface ReproductionEvidenceV1 {
  readonly directory: string;
  readonly manifestSha256: string;
  readonly matchKey: string;
}

export interface ReportV1 {
  readonly schemaVersion: "1";
  readonly kind: "prooftape-report";
  readonly dependency: string;
  readonly verdict: ReportVerdict;
  readonly blockingDifferenceCount: number;
  readonly warningCount: number;
  readonly baseline: ReportEvidenceV1;
  readonly candidate: ReportEvidenceV1;
  readonly differences: readonly BehaviorDiffV1[];
  readonly reproduction?: ReproductionEvidenceV1;
}

export const CAPSULE_LIMITS = Object.freeze({
  maxBytes: 10 * 1024 * 1024,
  maxCalls: 10_000,
  maxIssues: 1_000,
  maxJsonDepth: 32,
  maxJsonEntries: 10_000,
} as const);

export const REPORT_LIMITS = Object.freeze({
  maxBytes: 20 * 1024 * 1024,
  maxDifferences: 20_000,
} as const);

export class SchemaValidationError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "SchemaValidationError";
  }
}

function fail(path: string, message: string): never {
  throw new SchemaValidationError(`${path}: ${message}`);
}

function record(value: unknown, path: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    fail(path, "expected object");
  }
  return value as Record<string, unknown>;
}

function strictKeys(
  value: Record<string, unknown>,
  allowed: readonly string[],
  required: readonly string[],
  path: string,
): void {
  const allowedSet = new Set(allowed);
  for (const key of Object.keys(value)) {
    if (!allowedSet.has(key)) fail(path, `unknown field ${JSON.stringify(key)}`);
  }
  for (const key of required) {
    if (!Object.prototype.hasOwnProperty.call(value, key)) {
      fail(path, `missing field ${JSON.stringify(key)}`);
    }
  }
}

function stringValue(value: unknown, path: string, maxLength = 4_096): string {
  if (typeof value !== "string") fail(path, "expected string");
  if (value.length > maxLength) fail(path, `string exceeds ${maxLength} characters`);
  return value;
}

function integer(value: unknown, path: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    fail(path, "expected non-negative safe integer");
  }
  return value as number;
}

function jsonValue(value: unknown, path: string, depth = 0, budget = { entries: 0 }): JsonValue {
  if (depth > CAPSULE_LIMITS.maxJsonDepth) fail(path, "JSON depth limit exceeded");
  if (
    value === null
    || typeof value === "boolean"
    || typeof value === "string"
    || (typeof value === "number" && Number.isFinite(value))
  ) {
    return value;
  }
  if (Array.isArray(value)) {
    budget.entries += value.length;
    if (budget.entries > CAPSULE_LIMITS.maxJsonEntries) fail(path, "JSON entry limit exceeded");
    return value.map((item, index) => jsonValue(item, `${path}/${index}`, depth + 1, budget));
  }
  const object = record(value, path);
  const keys = Object.keys(object);
  budget.entries += keys.length;
  if (budget.entries > CAPSULE_LIMITS.maxJsonEntries) fail(path, "JSON entry limit exceeded");
  return Object.fromEntries(
    keys.map((key) => [key, jsonValue(object[key], `${path}/${key}`, depth + 1, budget)]),
  );
}

function parseError(value: unknown, path: string): SerializedError {
  const object = record(value, path);
  strictKeys(object, ["name", "message", "code", "fields"], ["name", "message"], path);
  const result: {
    name: string;
    message: string;
    code?: JsonValue;
    fields?: Readonly<Record<string, JsonValue>>;
  } = {
    name: stringValue(object.name, `${path}/name`, 256),
    message: stringValue(object.message, `${path}/message`),
  };
  if (Object.prototype.hasOwnProperty.call(object, "code")) {
    result.code = jsonValue(object.code, `${path}/code`);
  }
  if (Object.prototype.hasOwnProperty.call(object, "fields")) {
    const fields = record(object.fields, `${path}/fields`);
    result.fields = Object.fromEntries(
      Object.entries(fields).map(([key, child]) => [
        key,
        jsonValue(child, `${path}/fields/${key}`),
      ]),
    );
  }
  return result;
}

function parseUnsupported(value: unknown, path: string): UnsupportedObservation {
  const object = record(value, path);
  strictKeys(object, ["path", "reason", "type"], ["path", "reason", "type"], path);
  return {
    path: stringValue(object.path, `${path}/path`, 1_024),
    reason: stringValue(object.reason, `${path}/reason`, 256),
    type: stringValue(object.type, `${path}/type`, 256),
  };
}

function parseCall(value: unknown, path: string): CallObservationV1 {
  const object = record(value, path);
  strictKeys(
    object,
    [
      "schemaVersion",
      "callId",
      "sequence",
      "processId",
      "dependency",
      "exportPath",
      "callSiteFingerprint",
      "argsBefore",
      "argsAfter",
      "outcome",
      "value",
      "error",
      "durationNanoseconds",
      "normalization",
      "unsupported",
    ],
    [
      "schemaVersion",
      "callId",
      "sequence",
      "processId",
      "dependency",
      "exportPath",
      "callSiteFingerprint",
      "argsBefore",
      "argsAfter",
      "outcome",
    ],
    path,
  );
  if (object.schemaVersion !== "1") fail(`${path}/schemaVersion`, "expected \"1\"");
  if (!["return", "throw", "resolve", "reject"].includes(String(object.outcome))) {
    fail(`${path}/outcome`, "unknown outcome");
  }
  const outcome = object.outcome as OutcomeKind;
  const hasValue = Object.prototype.hasOwnProperty.call(object, "value");
  const hasError = Object.prototype.hasOwnProperty.call(object, "error");
  if ((outcome === "return" || outcome === "resolve") && !hasValue) {
    fail(`${path}/value`, "value is required for return or resolve");
  }
  if ((outcome === "throw" || outcome === "reject") && !hasError) {
    fail(`${path}/error`, "error is required for throw or reject");
  }
  if (hasValue && hasError) fail(path, "value and error are mutually exclusive");

  const result: {
    schemaVersion: "1";
    callId: string;
    sequence: number;
    processId: string;
    dependency: string;
    exportPath: string;
    callSiteFingerprint: string;
    argsBefore: JsonValue;
    argsAfter: JsonValue;
    outcome: OutcomeKind;
    value?: JsonValue;
    error?: SerializedError;
    durationNanoseconds?: string;
    normalization?: readonly NormalizationRecord[];
    unsupported?: readonly UnsupportedObservation[];
  } = {
    schemaVersion: "1",
    callId: stringValue(object.callId, `${path}/callId`, 256),
    sequence: integer(object.sequence, `${path}/sequence`),
    processId: stringValue(object.processId, `${path}/processId`, 256),
    dependency: stringValue(object.dependency, `${path}/dependency`, 256),
    exportPath: stringValue(object.exportPath, `${path}/exportPath`, 1_024),
    callSiteFingerprint: stringValue(
      object.callSiteFingerprint,
      `${path}/callSiteFingerprint`,
      2_048,
    ),
    argsBefore: jsonValue(object.argsBefore, `${path}/argsBefore`),
    argsAfter: jsonValue(object.argsAfter, `${path}/argsAfter`),
    outcome,
  };
  if (hasValue) result.value = jsonValue(object.value, `${path}/value`);
  if (hasError) result.error = parseError(object.error, `${path}/error`);
  if (Object.prototype.hasOwnProperty.call(object, "durationNanoseconds")) {
    const duration = stringValue(object.durationNanoseconds, `${path}/durationNanoseconds`, 64);
    if (!/^\d+$/.test(duration)) fail(`${path}/durationNanoseconds`, "expected decimal integer");
    result.durationNanoseconds = duration;
  }
  if (Object.prototype.hasOwnProperty.call(object, "unsupported")) {
    if (!Array.isArray(object.unsupported)) fail(`${path}/unsupported`, "expected array");
    result.unsupported = object.unsupported.map((item, index) =>
      parseUnsupported(item, `${path}/unsupported/${index}`),
    );
  }
  if (Object.prototype.hasOwnProperty.call(object, "normalization")) {
    if (!Array.isArray(object.normalization)) fail(`${path}/normalization`, "expected array");
    result.normalization = object.normalization.map((item, index) => {
      const itemPath = `${path}/normalization/${index}`;
      const normalizer = record(item, itemPath);
      strictKeys(
        normalizer,
        ["jsonPointer", "normalizer", "beforeHash", "after"],
        ["jsonPointer", "normalizer", "beforeHash", "after"],
        itemPath,
      );
      return {
        jsonPointer: stringValue(normalizer.jsonPointer, `${itemPath}/jsonPointer`, 2_048),
        normalizer: stringValue(normalizer.normalizer, `${itemPath}/normalizer`, 256),
        beforeHash: stringValue(normalizer.beforeHash, `${itemPath}/beforeHash`, 64),
        after: jsonValue(normalizer.after, `${itemPath}/after`),
      };
    });
  }
  return result;
}

function parseMetadata(value: unknown, path: string): EvidenceMetadataV1 {
  const object = record(value, path);
  strictKeys(
    object,
    [
      "commitSha",
      "lockfileSha256",
      "nodeVersion",
      "platform",
      "arch",
      "command",
      "dependency",
      "prooftapeVersion",
      "configurationSha256",
      "observationAuthenticity",
    ],
    [
      "commitSha",
      "lockfileSha256",
      "nodeVersion",
      "platform",
      "arch",
      "command",
      "dependency",
      "prooftapeVersion",
      "configurationSha256",
      "observationAuthenticity",
    ],
    path,
  );
  const commitSha = stringValue(object.commitSha, `${path}/commitSha`, 40);
  const lockfileSha256 = stringValue(object.lockfileSha256, `${path}/lockfileSha256`, 64);
  const configurationSha256 = stringValue(
    object.configurationSha256,
    `${path}/configurationSha256`,
    64,
  );
  if (!/^[a-f0-9]{40}$/.test(commitSha)) fail(`${path}/commitSha`, "expected full Git SHA");
  if (!/^[a-f0-9]{64}$/.test(lockfileSha256)) {
    fail(`${path}/lockfileSha256`, "expected SHA-256");
  }
  if (!/^[a-f0-9]{64}$/.test(configurationSha256)) {
    fail(`${path}/configurationSha256`, "expected SHA-256");
  }
  if (object.observationAuthenticity !== "not-established") {
    fail(
      `${path}/observationAuthenticity`,
      "expected \"not-established\"",
    );
  }
  if (!Array.isArray(object.command) || object.command.length === 0 || object.command.length > 256) {
    fail(`${path}/command`, "expected 1 to 256 arguments");
  }
  const dependency = record(object.dependency, `${path}/dependency`);
  strictKeys(
    dependency,
    ["name", "version", "entry"],
    ["name", "version", "entry"],
    `${path}/dependency`,
  );
  return {
    commitSha,
    lockfileSha256,
    nodeVersion: stringValue(object.nodeVersion, `${path}/nodeVersion`, 64),
    platform: stringValue(object.platform, `${path}/platform`, 64),
    arch: stringValue(object.arch, `${path}/arch`, 64),
    command: object.command.map((argument, index) =>
      stringValue(argument, `${path}/command/${index}`, 16_384),
    ),
    dependency: {
      name: stringValue(dependency.name, `${path}/dependency/name`, 256),
      version: stringValue(dependency.version, `${path}/dependency/version`, 256),
      entry: stringValue(dependency.entry, `${path}/dependency/entry`, 4_096),
    },
    prooftapeVersion: stringValue(object.prooftapeVersion, `${path}/prooftapeVersion`, 64),
    configurationSha256,
    observationAuthenticity: "not-established",
  };
}

function parseIssue(value: unknown, path: string): CaptureIssueV1 {
  const object = record(value, path);
  strictKeys(object, ["code", "message", "processId", "sequence"], ["code", "message"], path);
  const result: {
    code: string;
    message: string;
    processId?: string;
    sequence?: number;
  } = {
    code: stringValue(object.code, `${path}/code`, 256),
    message: stringValue(object.message, `${path}/message`, 4_096),
  };
  if (Object.prototype.hasOwnProperty.call(object, "processId")) {
    result.processId = stringValue(object.processId, `${path}/processId`, 256);
  }
  if (Object.prototype.hasOwnProperty.call(object, "sequence")) {
    result.sequence = integer(object.sequence, `${path}/sequence`);
  }
  return result;
}

export function parseCapsule(input: string | Uint8Array): CapsuleV1 {
  const text = typeof input === "string" ? input : new TextDecoder().decode(input);
  if (Buffer.byteLength(text, "utf8") > CAPSULE_LIMITS.maxBytes) {
    fail("/", "capsule byte limit exceeded");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    fail("/", "invalid JSON");
  }
  const object = record(parsed, "/");
  strictKeys(
    object,
    ["schemaVersion", "kind", "metadata", "calls", "issues"],
    ["schemaVersion", "kind", "metadata", "calls", "issues"],
    "/",
  );
  if (object.schemaVersion !== "1") fail("/schemaVersion", "expected \"1\"");
  if (object.kind !== "prooftape-capsule") fail("/kind", "expected prooftape-capsule");
  if (!Array.isArray(object.calls)) fail("/calls", "expected array");
  if (object.calls.length > CAPSULE_LIMITS.maxCalls) fail("/calls", "call limit exceeded");
  if (!Array.isArray(object.issues)) fail("/issues", "expected array");
  if (object.issues.length > CAPSULE_LIMITS.maxIssues) fail("/issues", "issue limit exceeded");
  return {
    schemaVersion: "1",
    kind: "prooftape-capsule",
    metadata: parseMetadata(object.metadata, "/metadata"),
    calls: object.calls.map((call, index) => parseCall(call, `/calls/${index}`)),
    issues: object.issues.map((issue, index) => parseIssue(issue, `/issues/${index}`)),
  };
}

function hashValue(value: unknown, path: string, length: 40 | 64): string {
  const result = stringValue(value, path, length);
  if (!new RegExp(`^[a-f0-9]{${length}}$`, "u").test(result)) {
    fail(path, length === 40 ? "expected full Git SHA" : "expected SHA-256");
  }
  return result;
}

function parseReportEvidence(value: unknown, path: string): ReportEvidenceV1 {
  const object = record(value, path);
  strictKeys(
    object,
    [
      "capsuleHash",
      "commitSha",
      "lockfileSha256",
      "dependencyVersion",
      "observationAuthenticity",
    ],
    [
      "capsuleHash",
      "commitSha",
      "lockfileSha256",
      "dependencyVersion",
      "observationAuthenticity",
    ],
    path,
  );
  if (object.observationAuthenticity !== "not-established") {
    fail(
      `${path}/observationAuthenticity`,
      "expected \"not-established\"",
    );
  }
  return {
    capsuleHash: hashValue(object.capsuleHash, `${path}/capsuleHash`, 64),
    commitSha: hashValue(object.commitSha, `${path}/commitSha`, 40),
    lockfileSha256: hashValue(object.lockfileSha256, `${path}/lockfileSha256`, 64),
    dependencyVersion: stringValue(object.dependencyVersion, `${path}/dependencyVersion`, 256),
    observationAuthenticity: "not-established",
  };
}

function parseDifference(value: unknown, path: string): BehaviorDiffV1 {
  const object = record(value, path);
  strictKeys(
    object,
    ["schemaVersion", "kind", "blocking", "matchKey", "base", "candidate", "summary"],
    ["schemaVersion", "kind", "blocking", "matchKey", "summary"],
    path,
  );
  if (object.schemaVersion !== "1") fail(`${path}/schemaVersion`, "expected \"1\"");
  const kinds: readonly DiffKind[] = [
    "added-call",
    "removed-call",
    "changed-return",
    "changed-error",
    "changed-mutation",
    "changed-sequence",
    "timing-warning",
    "ambiguous",
  ];
  if (!kinds.includes(object.kind as DiffKind)) fail(`${path}/kind`, "unknown difference kind");
  if (typeof object.blocking !== "boolean") fail(`${path}/blocking`, "expected boolean");
  const kind = object.kind as DiffKind;
  const hasBase = Object.prototype.hasOwnProperty.call(object, "base");
  const hasCandidate = Object.prototype.hasOwnProperty.call(object, "candidate");
  if (kind === "added-call" && (hasBase || !hasCandidate)) {
    fail(path, "added-call requires candidate only");
  }
  if (kind === "removed-call" && (!hasBase || hasCandidate)) {
    fail(path, "removed-call requires base only");
  }
  if (!["added-call", "removed-call", "ambiguous"].includes(kind) && (!hasBase || !hasCandidate)) {
    fail(path, `${kind} requires base and candidate`);
  }
  const result: {
    schemaVersion: "1";
    kind: DiffKind;
    blocking: boolean;
    matchKey: string;
    base?: CallObservationV1;
    candidate?: CallObservationV1;
    summary: string;
  } = {
    schemaVersion: "1",
    kind,
    blocking: object.blocking,
    matchKey: stringValue(object.matchKey, `${path}/matchKey`, 4_096),
    summary: stringValue(object.summary, `${path}/summary`, 4_096),
  };
  if (hasBase) result.base = parseCall(object.base, `${path}/base`);
  if (hasCandidate) result.candidate = parseCall(object.candidate, `${path}/candidate`);
  return result;
}

function parseReproduction(value: unknown, path: string): ReproductionEvidenceV1 {
  const object = record(value, path);
  strictKeys(
    object,
    ["directory", "manifestSha256", "matchKey"],
    ["directory", "manifestSha256", "matchKey"],
    path,
  );
  return {
    directory: stringValue(object.directory, `${path}/directory`, 4_096),
    manifestSha256: hashValue(object.manifestSha256, `${path}/manifestSha256`, 64),
    matchKey: stringValue(object.matchKey, `${path}/matchKey`, 4_096),
  };
}

export function parseReport(input: string | Uint8Array): ReportV1 {
  const text = typeof input === "string" ? input : new TextDecoder().decode(input);
  if (Buffer.byteLength(text, "utf8") > REPORT_LIMITS.maxBytes) {
    fail("/", "report byte limit exceeded");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    fail("/", "invalid JSON");
  }
  const object = record(parsed, "/");
  strictKeys(
    object,
    [
      "schemaVersion",
      "kind",
      "dependency",
      "verdict",
      "blockingDifferenceCount",
      "warningCount",
      "baseline",
      "candidate",
      "differences",
      "reproduction",
    ],
    [
      "schemaVersion",
      "kind",
      "dependency",
      "verdict",
      "blockingDifferenceCount",
      "warningCount",
      "baseline",
      "candidate",
      "differences",
    ],
    "/",
  );
  if (object.schemaVersion !== "1") fail("/schemaVersion", "expected \"1\"");
  if (object.kind !== "prooftape-report") fail("/kind", "expected prooftape-report");
  if (!["no-blocking-differences-observed", "behavior-changed"].includes(String(object.verdict))) {
    fail("/verdict", "unknown verdict");
  }
  if (!Array.isArray(object.differences)) fail("/differences", "expected array");
  if (object.differences.length > REPORT_LIMITS.maxDifferences) {
    fail("/differences", "difference limit exceeded");
  }
  const differences = object.differences.map((difference, index) =>
    parseDifference(difference, `/differences/${index}`),
  );
  const blockingDifferenceCount = integer(
    object.blockingDifferenceCount,
    "/blockingDifferenceCount",
  );
  const warningCount = integer(object.warningCount, "/warningCount");
  if (blockingDifferenceCount !== differences.filter((difference) => difference.blocking).length) {
    fail("/blockingDifferenceCount", "does not match differences");
  }
  if (warningCount !== differences.filter((difference) => !difference.blocking).length) {
    fail("/warningCount", "does not match differences");
  }
  const verdict = object.verdict as ReportVerdict;
  if ((blockingDifferenceCount > 0) !== (verdict === "behavior-changed")) {
    fail("/verdict", "does not match blocking difference count");
  }
  const result: {
    schemaVersion: "1";
    kind: "prooftape-report";
    dependency: string;
    verdict: ReportVerdict;
    blockingDifferenceCount: number;
    warningCount: number;
    baseline: ReportEvidenceV1;
    candidate: ReportEvidenceV1;
    differences: readonly BehaviorDiffV1[];
    reproduction?: ReproductionEvidenceV1;
  } = {
    schemaVersion: "1",
    kind: "prooftape-report",
    dependency: stringValue(object.dependency, "/dependency", 256),
    verdict,
    blockingDifferenceCount,
    warningCount,
    baseline: parseReportEvidence(object.baseline, "/baseline"),
    candidate: parseReportEvidence(object.candidate, "/candidate"),
    differences,
  };
  if (Object.prototype.hasOwnProperty.call(object, "reproduction")) {
    result.reproduction = parseReproduction(object.reproduction, "/reproduction");
  }
  return result;
}

export const EXIT = Object.freeze({
  OK: 0,
  BEHAVIOR_CHANGED: 2,
  HARNESS_FAILED: 3,
  INVALID_INPUT: 4,
} as const);
