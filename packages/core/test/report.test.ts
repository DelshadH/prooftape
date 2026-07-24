import { describe, expect, it } from "vitest";
import type { CapsuleV1 } from "@prooftape/schema";
import {
  AmbiguousComparisonError,
  UnsupportedComparisonError,
  buildReport,
} from "../src/index.js";

function capsule(value: unknown): CapsuleV1 {
  return {
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
    calls: [{
      schemaVersion: "1",
      callId: "p1:1",
      sequence: 1,
      processId: "p1",
      dependency: "fixture",
      exportPath: "value",
      callSiteFingerprint: "test.mjs:run",
      argsBefore: ["x"],
      argsAfter: ["x"],
      outcome: "return",
      value: value as never,
    }],
    issues: [],
  };
}

describe("buildReport", () => {
  it("emits a deterministic no-change verdict", () => {
    const base = capsule("same");
    const report = buildReport(base, base);

    expect(report.verdict).toBe("no-blocking-differences-observed");
    expect(report.blockingDifferenceCount).toBe(0);
    expect(report.differences).toEqual([]);
  });

  it("emits changed behavior with evidence hashes", () => {
    const base = capsule("before");
    const candidate = {
      ...capsule("after"),
      metadata: { ...capsule("after").metadata, commitSha: "d".repeat(40) },
    };
    const report = buildReport(base, candidate);

    expect(report.verdict).toBe("behavior-changed");
    expect(report.blockingDifferenceCount).toBe(1);
    expect(report.differences[0]?.kind).toBe("changed-return");
    expect(report.baseline.capsuleHash).toMatch(/^[a-f0-9]{64}$/);
  });

  it("rejects unsupported observations and mismatched environments", () => {
    const base = capsule("same");
    expect(() => buildReport({ ...base, issues: [{ code: "PT_X", message: "unsupported" }] }, base))
      .toThrow(UnsupportedComparisonError);
    expect(() => buildReport(
      base,
      {
        ...base,
        metadata: { ...base.metadata, platform: "win32" },
      },
    )).toThrow(/environment/);
  });

  it("fails ambiguous repeated-call alignment as a harness error", () => {
    const base = capsule("same");
    const duplicate = { ...base.calls[0]!, callId: "p1:2", sequence: 2 };
    const repeated = { ...base, calls: [...base.calls, duplicate] };

    expect(() => buildReport(repeated, base)).toThrow(AmbiguousComparisonError);
  });
});
