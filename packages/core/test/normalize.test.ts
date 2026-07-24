import { describe, expect, it } from "vitest";
import type { CallObservationV1 } from "@prooftape/schema";
import { diffMatchedCall, normalizeObservation } from "../src/index.js";

const observation: CallObservationV1 = {
  schemaVersion: "1",
  callId: "p1:1",
  sequence: 1,
  processId: "p1",
  dependency: "fixture",
  exportPath: "value",
  callSiteFingerprint: "test.mjs:run",
  argsBefore: [{
    id: "550e8400-e29b-41d4-a716-446655440000",
    semantic: "keep-me",
  }],
  argsAfter: [{
    id: "550e8400-e29b-41d4-a716-446655440000",
    semantic: "keep-me",
  }],
  outcome: "return",
  value: "created-2026-07-24T12:00:00Z",
};

describe("normalizeObservation", () => {
  it("applies only declared literal rules and audits every changed field", () => {
    const normalized = normalizeObservation(observation, [
      {
        name: "fixture-id",
        literal: "550e8400-e29b-41d4-a716-446655440000",
        replacement: "<id>",
      },
      {
        name: "fixture-time",
        literal: "2026-07-24T12:00:00Z",
        replacement: "<time>",
      },
    ]);

    expect(normalized.argsBefore).toEqual([{ id: "<id>", semantic: "keep-me" }]);
    expect(normalized.value).toBe("created-<time>");
    expect(normalized.normalization?.map((item) => [
      item.jsonPointer,
      item.normalizer,
      item.after,
    ])).toEqual([
      ["/argsBefore/0/id", "fixture-id", "<id>"],
      ["/argsAfter/0/id", "fixture-id", "<id>"],
      ["/value", "fixture-time", "created-<time>"],
    ]);
    expect(normalized.normalization?.every((item) => /^[a-f0-9]{64}$/.test(item.beforeHash)))
      .toBe(true);
  });

  it("does not normalize undeclared fields heuristically", () => {
    expect(normalizeObservation(observation, [])).toEqual(observation);
  });

  it("stabilizes declared UUID, timestamp, and path literals only when configured", () => {
    const candidate = {
      ...observation,
      argsBefore: [{
        id: "66fb9511-f3ac-42e5-b717-557766551111",
        semantic: "keep-me",
      }],
      argsAfter: [{
        id: "66fb9511-f3ac-42e5-b717-557766551111",
        semantic: "keep-me",
      }],
      value: "created-2026-07-25T12:00:00Z-C:\\candidate\\workspace",
    } satisfies CallObservationV1;
    const baselineWithPath = {
      ...observation,
      value: "created-2026-07-24T12:00:00Z-C:\\base\\workspace",
    } satisfies CallObservationV1;
    expect(diffMatchedCall(baselineWithPath, candidate)).not.toEqual([]);

    const baseRules = [
      {
        name: "fixture-id",
        literal: "550e8400-e29b-41d4-a716-446655440000",
        replacement: "<id>",
      },
      {
        name: "fixture-time",
        literal: "2026-07-24T12:00:00Z",
        replacement: "<time>",
      },
      {
        name: "fixture-path",
        literal: "C:\\base\\workspace",
        replacement: "<workspace>",
      },
    ];
    const candidateRules = [
      {
        name: "fixture-id",
        literal: "66fb9511-f3ac-42e5-b717-557766551111",
        replacement: "<id>",
      },
      {
        name: "fixture-time",
        literal: "2026-07-25T12:00:00Z",
        replacement: "<time>",
      },
      {
        name: "fixture-path",
        literal: "C:\\candidate\\workspace",
        replacement: "<workspace>",
      },
    ];
    const normalizedBase = normalizeObservation(baselineWithPath, baseRules);
    const normalizedCandidate = normalizeObservation(candidate, candidateRules);
    expect(diffMatchedCall(normalizedBase, normalizedCandidate)).toEqual([]);
    expect(normalizedBase.normalization).toHaveLength(4);
    expect(normalizedCandidate.normalization).toHaveLength(4);
  });
});
