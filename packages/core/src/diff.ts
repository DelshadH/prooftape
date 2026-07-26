import type { BehaviorDiffV1, CallObservationV1 } from "@prooftape/schema";
import { canonicalJson, sha256 } from "./canonical.js";

export interface AmbiguousCallDiff {
  readonly schemaVersion: "1";
  readonly kind: "ambiguous";
  readonly blocking: true;
  readonly matchKey: string;
  readonly base?: CallObservationV1;
  readonly candidate?: CallObservationV1;
  readonly summary: string;
}

export type CallDiff = BehaviorDiffV1 | AmbiguousCallDiff;

function comparable(value: unknown): string {
  return canonicalJson(value as never);
}

function optionalComparable<T extends object>(value: T, key: keyof T): string {
  const present = Object.prototype.hasOwnProperty.call(value, key);
  return comparable(present ? { present: true, value: value[key] } : { present: false });
}

export function observationMatchKey(observation: CallObservationV1): string {
  return [
    observation.dependency,
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
    const kind = base.outcome === "throw" || base.outcome === "reject" || candidate.outcome === "throw" || candidate.outcome === "reject"
      ? "changed-error"
      : "changed-return";
    diffs.push({
      schemaVersion: "1",
      kind,
      blocking: true,
      matchKey,
      base,
      candidate,
      summary: base.outcome !== candidate.outcome
        ? `${base.exportPath} changed from ${base.outcome} to ${candidate.outcome}`
        : `${base.exportPath} changed ${base.outcome === "resolve" ? "resolved" : "return"} value`,
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

interface IndexedObservation {
  readonly observation: CallObservationV1;
  readonly index: number;
}

function groupCalls(
  calls: readonly CallObservationV1[],
): ReadonlyMap<string, readonly IndexedObservation[]> {
  const groups = new Map<string, IndexedObservation[]>();
  calls.forEach((observation, index) => {
    const key = observationMatchKey(observation);
    const group = groups.get(key) ?? [];
    group.push({ observation, index });
    groups.set(key, group);
  });
  return groups;
}

export function diffCalls(
  baseCalls: readonly CallObservationV1[],
  candidateCalls: readonly CallObservationV1[],
): readonly CallDiff[] {
  const baseGroups = groupCalls(baseCalls);
  const candidateGroups = groupCalls(candidateCalls);
  const keys = [...new Set([...baseGroups.keys(), ...candidateGroups.keys()])].sort();
  const matchedDiffs: BehaviorDiffV1[] = [];
  const added: BehaviorDiffV1[] = [];
  const removed: BehaviorDiffV1[] = [];
  const ambiguous: AmbiguousCallDiff[] = [];
  const baseOrder: string[] = [];
  const candidateOrder: Array<{ id: string; index: number }> = [];

  for (const key of keys) {
    const baseGroup = baseGroups.get(key) ?? [];
    const candidateGroup = candidateGroups.get(key) ?? [];
    if (
      baseGroup.length !== candidateGroup.length
      && Math.max(baseGroup.length, candidateGroup.length) > 1
    ) {
      ambiguous.push({
        schemaVersion: "1",
        kind: "ambiguous",
        blocking: true,
        matchKey: key,
        ...(baseGroup[0] ? { base: baseGroup[0].observation } : {}),
        ...(candidateGroup[0] ? { candidate: candidateGroup[0].observation } : {}),
        summary: `${baseGroup[0]?.observation.exportPath ?? candidateGroup[0]?.observation.exportPath ?? "call"} has ambiguous repeated-call alignment`,
      });
      continue;
    }

    const matchedCount = Math.min(baseGroup.length, candidateGroup.length);
    for (let index = 0; index < matchedCount; index += 1) {
      const baseItem = baseGroup[index];
      const candidateItem = candidateGroup[index];
      if (!baseItem || !candidateItem) continue;
      const occurrenceId = `${key}#${index}`;
      baseOrder.push(occurrenceId);
      candidateOrder.push({ id: occurrenceId, index: candidateItem.index });
      matchedDiffs.push(...diffMatchedCall(baseItem.observation, candidateItem.observation));
    }
    for (const item of candidateGroup.slice(matchedCount)) {
      added.push({
        schemaVersion: "1",
        kind: "added-call",
        blocking: true,
        matchKey: key,
        candidate: item.observation,
        summary: `${item.observation.exportPath} is a new observed call`,
      });
    }
    for (const item of baseGroup.slice(matchedCount)) {
      removed.push({
        schemaVersion: "1",
        kind: "removed-call",
        blocking: true,
        matchKey: key,
        base: item.observation,
        summary: `${item.observation.exportPath} is no longer observed`,
      });
    }
  }

  const candidateOrderedIds = candidateOrder
    .sort((left, right) => left.index - right.index)
    .map((item) => item.id);
  const sequenceChanged = baseOrder.length > 1
    && baseOrder.some((id, index) => candidateOrderedIds[index] !== id);
  const sequenceDiff: readonly BehaviorDiffV1[] = sequenceChanged
    ? [{
      schemaVersion: "1",
      kind: "changed-sequence",
      blocking: true,
      matchKey: sha256(baseOrder.join("\n")),
      summary: "relative order of matching observed calls changed",
    }]
    : [];

  return [
    ...ambiguous,
    ...matchedDiffs,
    ...sequenceDiff,
    ...added,
    ...removed,
  ];
}
