import type { BehaviorDiffV1, CallObservationV1 } from "@prooftape/schema";
import { canonicalJson, sha256 } from "./canonical.js";

function comparable(value: unknown): string {
  return canonicalJson(value as never);
}

function optionalComparable<T extends object>(value: T, key: keyof T): string {
  const present = Object.prototype.hasOwnProperty.call(value, key);
  return comparable(present ? { present: true, value: value[key] } : { present: false });
}

export function observationMatchKey(observation: CallObservationV1): string {
  return [
    observation.exportPath,
    observation.callSiteFingerprint,
    sha256(comparable(observation.argsBefore)),
  ].join(":");
}

export function diffMatchedCall(
  base: CallObservationV1,
  candidate: CallObservationV1,
): readonly BehaviorDiffV1[] {
  const matchKey = observationMatchKey(base);
  const diffs: BehaviorDiffV1[] = [];

  if (base.outcome !== candidate.outcome || optionalComparable(base, "value") !== optionalComparable(candidate, "value")) {
    diffs.push({
      schemaVersion: "1",
      kind: base.outcome === "throw" || base.outcome === "reject" || candidate.outcome === "throw" || candidate.outcome === "reject"
        ? "changed-error"
        : "changed-return",
      blocking: true,
      matchKey,
      base,
      candidate,
      summary: `${base.exportPath} changed outcome`,
    });
  }

  if (optionalComparable(base, "error") !== optionalComparable(candidate, "error")) {
    diffs.push({
      schemaVersion: "1",
      kind: "changed-error",
      blocking: true,
      matchKey,
      base,
      candidate,
      summary: `${base.exportPath} changed error contract`,
    });
  }

  if (comparable(base.argsAfter) !== comparable(candidate.argsAfter)) {
    diffs.push({
      schemaVersion: "1",
      kind: "changed-mutation",
      blocking: true,
      matchKey,
      base,
      candidate,
      summary: `${base.exportPath} changed argument mutation`,
    });
  }

  return deduplicate(diffs);
}

function deduplicate(diffs: readonly BehaviorDiffV1[]): readonly BehaviorDiffV1[] {
  const seen = new Set<string>();
  return diffs.filter((diff) => {
    const key = `${diff.kind}:${diff.matchKey}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
