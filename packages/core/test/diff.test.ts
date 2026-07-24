import { describe, expect, it } from "vitest";
import type { CallObservationV1 } from "@prooftape/schema";
import { diffCalls, diffMatchedCall } from "../src/index.js";

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
    const differences = diffMatchedCall(base, candidate);
    expect(differences.map((item) => item.kind)).toContain("changed-return");
    expect(differences[0]?.summary).toBe("parse changed return value");
  });

  it("reports no change for equal observations", () => {
    expect(diffMatchedCall(base, { ...base })).toEqual([]);
  });

  it("distinguishes an absent return value from explicit null", () => {
    const { value: _removed, ...withoutValue } = base;
    expect(diffMatchedCall(withoutValue, base).map((item) => item.kind)).toContain("changed-return");
  });
});

describe("diffCalls", () => {
  it("reports added and removed calls", () => {
    const removed = { ...base, callId: "p1:2", sequence: 2, exportPath: "removed" };
    const added = { ...base, callId: "p1:3", sequence: 2, exportPath: "added" };

    expect(diffCalls([base, removed], [base, added]).map((item) => item.kind)).toEqual([
      "added-call",
      "removed-call",
    ]);
  });

  it("reports a relative sequence change once", () => {
    const second = { ...base, callId: "p1:2", sequence: 2, exportPath: "second" };
    const candidateFirst = { ...second, callId: "p1:1", sequence: 1 };
    const candidateSecond = { ...base, callId: "p1:2", sequence: 2 };

    expect(diffCalls([base, second], [candidateFirst, candidateSecond]).map((item) => item.kind))
      .toEqual(["changed-sequence"]);
  });

  it("marks changed duplicate counts ambiguous instead of guessing alignment", () => {
    const duplicate = { ...base, callId: "p1:2", sequence: 2 };

    expect(diffCalls([base, duplicate], [base]).map((item) => item.kind)).toContain("ambiguous");
  });

  it("aligns repeated calls when their counts are equal", () => {
    const duplicate = { ...base, callId: "p1:2", sequence: 2 };
    const changedDuplicate = { ...duplicate, value: "changed" };

    expect(diffCalls([base, duplicate], [base, changedDuplicate]).map((item) => item.kind))
      .toEqual(["changed-return"]);
  });
});
