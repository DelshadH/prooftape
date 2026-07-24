export type JsonPrimitive = null | boolean | number | string;
export type JsonValue = JsonPrimitive | JsonValue[] | { readonly [key: string]: JsonValue };

export type OutcomeKind = "return" | "throw" | "resolve" | "reject";

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

export const EXIT = Object.freeze({
  OK: 0,
  BEHAVIOR_CHANGED: 2,
  HARNESS_FAILED: 3,
  INVALID_INPUT: 4,
} as const);
