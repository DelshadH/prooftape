import { describe, expect, it } from "vitest";
import type { CallObservationV1 } from "@prooftape/schema";
import { normalizeObservation } from "../src/index.js";

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
});
