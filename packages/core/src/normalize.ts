import type {
  CallObservationV1,
  JsonValue,
  NormalizationRecord,
  SerializedError,
} from "@prooftape/schema";
import { sha256 } from "./canonical.js";

export interface LiteralNormalizer {
  readonly name: string;
  readonly literal: string;
  readonly replacement: string;
}

function pointer(parent: string, key: string | number): string {
  const escaped = String(key).replaceAll("~", "~0").replaceAll("/", "~1");
  return `${parent}/${escaped}`;
}

function normalizeValue(
  value: JsonValue,
  path: string,
  rules: readonly LiteralNormalizer[],
  records: NormalizationRecord[],
): JsonValue {
  if (typeof value === "string") {
    let current = value;
    for (const rule of rules) {
      if (rule.literal.length === 0 || !current.includes(rule.literal)) continue;
      const before = current;
      current = current.split(rule.literal).join(rule.replacement);
      records.push({
        jsonPointer: path,
        normalizer: rule.name,
        beforeHash: sha256(before),
        after: current,
      });
    }
    return current;
  }
  if (Array.isArray(value)) {
    return value.map((child, index) =>
      normalizeValue(child, pointer(path, index), rules, records)
    );
  }
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, child]) => [
        key,
        normalizeValue(child, pointer(path, key), rules, records),
      ]),
    );
  }
  return value;
}

function normalizeError(
  error: SerializedError,
  rules: readonly LiteralNormalizer[],
  records: NormalizationRecord[],
): SerializedError {
  const normalized = normalizeValue(
    error as unknown as JsonValue,
    "/error",
    rules,
    records,
  ) as unknown as SerializedError;
  return normalized;
}

export function normalizeObservation(
  observation: CallObservationV1,
  rules: readonly LiteralNormalizer[],
): CallObservationV1 {
  if (rules.length === 0) return observation;
  const records: NormalizationRecord[] = [...(observation.normalization ?? [])];
  const argsBefore = normalizeValue(observation.argsBefore, "/argsBefore", rules, records);
  const argsAfter = normalizeValue(observation.argsAfter, "/argsAfter", rules, records);
  const value = observation.value === undefined
    ? undefined
    : normalizeValue(observation.value, "/value", rules, records);
  const error = observation.error === undefined
    ? undefined
    : normalizeError(observation.error, rules, records);
  return {
    ...observation,
    argsBefore,
    argsAfter,
    ...(value === undefined ? {} : { value }),
    ...(error === undefined ? {} : { error }),
    ...(records.length === 0 ? {} : { normalization: records }),
  };
}
