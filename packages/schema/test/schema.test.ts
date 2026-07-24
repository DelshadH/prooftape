import { describe, expect, it } from "vitest";
import {
  CAPSULE_LIMITS,
  EXIT,
  parseCapsule,
  type CapsuleV1,
} from "../src/index.js";

describe("public exit contract", () => {
  it("does not overlap conventional success", () => {
    expect(EXIT.OK).toBe(0);
    expect(new Set(Object.values(EXIT)).size).toBe(4);
  });
});

const capsule: CapsuleV1 = {
  schemaVersion: "1",
  kind: "prooftape-capsule",
  metadata: {
    commitSha: "a".repeat(40),
    lockfileSha256: "b".repeat(64),
    nodeVersion: "v22.22.0",
    platform: "linux",
    arch: "x64",
    command: ["node", "test.mjs"],
    dependency: {
      name: "fixture",
      version: "1.0.0",
      entry: "node_modules/fixture/index.js",
    },
    prooftapeVersion: "0.0.0",
    configurationSha256: "c".repeat(64),
  },
  calls: [
    {
      schemaVersion: "1",
      callId: "p1:1",
      sequence: 1,
      processId: "p1",
      dependency: "fixture",
      exportPath: "parse",
      callSiteFingerprint: "test.mjs:test",
      argsBefore: ["x"],
      argsAfter: ["x"],
      outcome: "return",
      value: "ok",
    },
  ],
  issues: [],
};

describe("parseCapsule", () => {
  it("round-trips a valid v1 capsule", () => {
    expect(parseCapsule(JSON.stringify(capsule))).toEqual(capsule);
  });

  it("rejects unknown versions and unknown fields", () => {
    expect(() =>
      parseCapsule(JSON.stringify({ ...capsule, schemaVersion: "2" })),
    ).toThrow(/schemaVersion/);
    expect(() =>
      parseCapsule(JSON.stringify({ ...capsule, candidateControlled: true })),
    ).toThrow(/unknown field/);
  });

  it("rejects malformed outcome contracts", () => {
    const malformed = {
      ...capsule,
      calls: [{ ...capsule.calls[0], outcome: "throw", value: undefined }],
    };
    expect(() => parseCapsule(JSON.stringify(malformed))).toThrow(/error/);
  });

  it("rejects capsules beyond the event limit", () => {
    const oversized = {
      ...capsule,
      calls: Array.from({ length: CAPSULE_LIMITS.maxCalls + 1 }, () => capsule.calls[0]),
    };
    expect(() => parseCapsule(JSON.stringify(oversized))).toThrow(/call limit/);
  });
});
