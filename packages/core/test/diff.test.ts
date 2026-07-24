import { describe, expect, it } from "vitest";
import type { CallObservationV1 } from "@prooftape/schema";
import { diffMatchedCall } from "../src/index.js";

const base: CallObservationV1 = {
  schemaVersion: "1",
  callId: "1",
  sequence: 1,
  processId: "p1",
  dependency: "fixture",
  exportPath: "parse",
  callSiteFingerprint: "test:1",
  argsBefore: [{ value: "x" }],
  argsAfter: [{ value: "x" }],
  outcome: "return",
  value: null,
};

describe("diffMatchedCall", () => {
  it("reports a changed return", () => {
    const candidate = { ...base, value: "x" } satisfies CallObservationV1;
    expect(diffMatchedCall(base, candidate).map((item) => item.kind)).toContain("changed-return");
  });

  it("reports no change for equal observations", () => {
    expect(diffMatchedCall(base, { ...base })).toEqual([]);
  });

  it("distinguishes an absent return value from explicit null", () => {
    const { value: _removed, ...withoutValue } = base;
    expect(diffMatchedCall(withoutValue, base).map((item) => item.kind)).toContain("changed-return");
  });
});
