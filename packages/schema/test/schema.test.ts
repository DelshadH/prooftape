import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  CAPSULE_LIMITS,
  EXIT,
  parseCapsule,
  parseReproductionManifest,
  parseReport,
  REPRODUCTION_MANIFEST_LIMITS,
  type CapsuleV1,
  type ReproductionManifestV1,
  type ReportV1,
} from "../src/index.js";

function invalidUtf8(value: unknown, marker: string): Uint8Array {
  const bytes = Buffer.from(JSON.stringify(value));
  const index = bytes.indexOf(marker);
  if (index < 0) throw new Error(`test marker ${JSON.stringify(marker)} was not found`);
  bytes[index] = 0xff;
  return bytes;
}

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
    observationAuthenticity: "not-established",
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
      moduleKind: "esm",
      receiverKind: "none",
      argsBefore: ["x"],
      argsAfter: ["x"],
      outcome: "return",
      value: "ok",
    },
  ],
  issues: [],
};

describe("parseCapsule", () => {
  it("parses the committed version 1 golden capsule", () => {
    const golden = readFileSync(
      new URL("../../../fixtures/schema/capsule-v1.json", import.meta.url),
      "utf8",
    );
    expect(parseCapsule(golden)).toEqual(capsule);
  });

  it("round-trips a valid v1 capsule", () => {
    expect(parseCapsule(JSON.stringify(capsule))).toEqual(capsule);
  });

  it("rejects raw duration from a persisted v1 capsule", () => {
    const withRawDuration = {
      ...capsule,
      calls: [{ ...capsule.calls[0], durationNanoseconds: "123" }],
    };

    expect(() => parseCapsule(JSON.stringify(withRawDuration))).toThrow(
      /unknown field.*durationNanoseconds/,
    );
  });

  it("rejects malformed UTF-8 bytes", () => {
    expect(() => parseCapsule(invalidUtf8(capsule, "v22.22.0"))).toThrow(
      /invalid UTF-8/,
    );
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

  it("rejects calls for a dependency other than the capsule dependency", () => {
    const mismatched = {
      ...capsule,
      calls: [{ ...capsule.calls[0], dependency: "different-package" }],
    };

    expect(() => parseCapsule(JSON.stringify(mismatched))).toThrow(
      /calls\/0\/dependency.*metadata dependency/,
    );
  });

  it("requires lowercase SHA-256 normalization hashes", () => {
    const malformed = {
      ...capsule,
      calls: [{
        ...capsule.calls[0],
        normalization: [{
          jsonPointer: "/value",
          normalizer: "fixture",
          beforeHash: "A".repeat(64),
          after: "normalized",
        }],
      }],
    };

    expect(() => parseCapsule(JSON.stringify(malformed))).toThrow(
      /beforeHash.*SHA-256/,
    );
  });

  it("rejects capsules beyond the event limit", () => {
    const oversized = {
      ...capsule,
      calls: Array.from({ length: CAPSULE_LIMITS.maxCalls + 1 }, () => capsule.calls[0]),
    };
    expect(() => parseCapsule(JSON.stringify(oversized))).toThrow(/call limit/);
  });

  it("requires the in-process observation-authenticity limitation", () => {
    const marked = {
      ...capsule,
      metadata: {
        ...capsule.metadata,
        observationAuthenticity: "not-established",
      },
    };

    expect(parseCapsule(JSON.stringify(marked)).metadata).toMatchObject({
      observationAuthenticity: "not-established",
    });
    const {
      observationAuthenticity: _observationAuthenticity,
      ...unmarkedMetadata
    } = capsule.metadata;
    expect(() => parseCapsule(JSON.stringify({
      ...capsule,
      metadata: unmarkedMetadata,
    }))).toThrow(
      /observationAuthenticity/,
    );
    expect(() => parseCapsule(JSON.stringify({
      ...marked,
      metadata: {
        ...marked.metadata,
        observationAuthenticity: "established",
      },
    }))).toThrow(/observationAuthenticity/);
  });
});

const report: ReportV1 = {
  schemaVersion: "1",
  kind: "prooftape-report",
  dependency: "fixture",
  verdict: "behavior-changed",
  blockingDifferenceCount: 1,
  warningCount: 0,
  baseline: {
    capsuleHash: "d".repeat(64),
    commitSha: "a".repeat(40),
    lockfileSha256: "b".repeat(64),
    dependencyVersion: "1.0.0",
    observationAuthenticity: "not-established",
  },
  candidate: {
    capsuleHash: "e".repeat(64),
    commitSha: "f".repeat(40),
    lockfileSha256: "c".repeat(64),
    dependencyVersion: "2.0.0",
    observationAuthenticity: "not-established",
  },
  differences: [{
    schemaVersion: "1",
    kind: "changed-return",
    blocking: true,
    matchKey: "fixture:parse:test.mjs:test:1",
    base: capsule.calls[0],
    candidate: { ...capsule.calls[0], value: "changed" },
    summary: "parse changed return value",
  }],
};

describe("parseReport", () => {
  it("parses the committed version 1 golden report", () => {
    const golden = readFileSync(
      new URL("../../../fixtures/schema/report-v1.json", import.meta.url),
      "utf8",
    );
    expect(parseReport(golden)).toEqual(report);
  });

  it("round-trips a valid v1 report", () => {
    expect(parseReport(JSON.stringify(report))).toEqual(report);
  });

  it("rejects malformed UTF-8 bytes", () => {
    expect(() => parseReport(invalidUtf8(report, "parse changed return value"))).toThrow(
      /invalid UTF-8/,
    );
  });

  it("rejects incompatible versions, unknown fields, and inconsistent counts", () => {
    expect(() => parseReport(JSON.stringify({ ...report, schemaVersion: "2" }))).toThrow(
      /schemaVersion/,
    );
    expect(() => parseReport(JSON.stringify({ ...report, injected: true }))).toThrow(
      /unknown field/,
    );
    expect(() => parseReport(JSON.stringify({ ...report, blockingDifferenceCount: 0 }))).toThrow(
      /blockingDifferenceCount/,
    );
  });

  it("requires the authenticity limitation for both evidence summaries", () => {
    const marked = {
      ...report,
      baseline: {
        ...report.baseline,
        observationAuthenticity: "not-established",
      },
      candidate: {
        ...report.candidate,
        observationAuthenticity: "not-established",
      },
    };

    expect(parseReport(JSON.stringify(marked))).toMatchObject({
      baseline: { observationAuthenticity: "not-established" },
      candidate: { observationAuthenticity: "not-established" },
    });
    const {
      observationAuthenticity: _baselineAuthenticity,
      ...unmarkedBaseline
    } = report.baseline;
    expect(() => parseReport(JSON.stringify({
      ...report,
      baseline: unmarkedBaseline,
    }))).toThrow(
      /observationAuthenticity/,
    );
    const {
      observationAuthenticity: _candidateAuthenticity,
      ...unmarkedCandidate
    } = report.candidate;
    expect(() => parseReport(JSON.stringify({
      ...report,
      candidate: unmarkedCandidate,
    }))).toThrow(/observationAuthenticity/);
    expect(() => parseReport(JSON.stringify({
      ...report,
      baseline: {
        ...report.baseline,
        observationAuthenticity: "established",
      },
    }))).toThrow(/observationAuthenticity/);
  });

  it("rejects difference shapes outside the strict v1 contract", () => {
    const firstDifference = report.differences[0];
    expect(firstDifference).toBeDefined();

    expect(() => parseReport(JSON.stringify({
      ...report,
      differences: [{ ...firstDifference, kind: "timing-warning" }],
    }))).toThrow(/kind/);

    expect(() => parseReport(JSON.stringify({
      ...report,
      differences: [{ ...firstDifference, kind: "ambiguous" }],
    }))).toThrow(/kind/);

    expect(() => parseReport(JSON.stringify({
      ...report,
      verdict: "no-blocking-differences-observed",
      blockingDifferenceCount: 0,
      warningCount: 1,
      differences: [{ ...firstDifference, blocking: false }],
    }))).toThrow(/blocking/);

    expect(() => parseReport(JSON.stringify({
      ...report,
      differences: [{ ...firstDifference, kind: "changed-sequence" }],
    }))).toThrow(/changed-sequence/);

    expect(() => parseReport(JSON.stringify({
      ...report,
      differences: [{
        ...firstDifference,
        base: { ...firstDifference?.base, dependency: "other-package" },
        candidate: { ...firstDifference?.candidate, dependency: "other-package" },
      }],
    }))).toThrow(/dependency/);

    expect(() => parseReport(JSON.stringify({
      ...report,
      differences: [{
        ...firstDifference,
        candidate: { ...firstDifference?.candidate, exportPath: "otherExport" },
      }],
    }))).toThrow(/paired calls/);
  });

  it("binds reproduction metadata to one safe report difference", () => {
    expect(() => parseReport(JSON.stringify({
      ...report,
      reproduction: {
        directory: "repro",
        manifestSha256: "f".repeat(64),
        matchKey: "not-a-difference",
      },
    }))).toThrow(/matchKey/);

    expect(() => parseReport(JSON.stringify({
      ...report,
      reproduction: {
        directory: "../repro",
        manifestSha256: "f".repeat(64),
        matchKey: report.differences[0]?.matchKey,
      },
    }))).toThrow(/directory/);
  });
});

const reproductionManifest: ReproductionManifestV1 = {
  schemaVersion: "1",
  kind: "prooftape-reproduction-manifest",
  observationAuthenticity: "not-established",
  matchKey: "fixture:parse:test.mjs:test:1",
  files: {
    "README.md": "1".repeat(64),
    "base-package.json": "2".repeat(64),
    "candidate-package.json": "3".repeat(64),
    "input.json": "4".repeat(64),
    "repro.mjs": "5".repeat(64),
  },
};

describe("parseReproductionManifest", () => {
  it("parses the committed version 1 golden reproduction manifest", () => {
    const golden = readFileSync(
      new URL(
        "../../../fixtures/schema/reproduction-manifest-v1.json",
        import.meta.url,
      ),
      "utf8",
    );
    expect(parseReproductionManifest(golden)).toEqual(reproductionManifest);
  });

  it("rejects malformed UTF-8 bytes", () => {
    expect(() =>
      parseReproductionManifest(invalidUtf8(reproductionManifest, "fixture:parse")),
    ).toThrow(/invalid UTF-8/);
  });

  it("rejects future versions, unknown fields, and incompatible file sets", () => {
    expect(() => parseReproductionManifest(JSON.stringify({
      ...reproductionManifest,
      schemaVersion: "2",
    }))).toThrow(/schemaVersion/);
    expect(() => parseReproductionManifest(JSON.stringify({
      ...reproductionManifest,
      injected: true,
    }))).toThrow(/unknown field/);
    expect(() => parseReproductionManifest(JSON.stringify({
      ...reproductionManifest,
      files: {
        ...reproductionManifest.files,
        "extra.json": "6".repeat(64),
      },
    }))).toThrow(/unknown field/);
    const {
      "README.md": _readmeHash,
      ...missingReadme
    } = reproductionManifest.files;
    expect(() => parseReproductionManifest(JSON.stringify({
      ...reproductionManifest,
      files: missingReadme,
    }))).toThrow(/missing field/);
  });

  it("requires the observation-authenticity limitation", () => {
    const {
      observationAuthenticity: _authenticity,
      ...unmarked
    } = reproductionManifest;
    expect(() => parseReproductionManifest(JSON.stringify(unmarked))).toThrow(
      /observationAuthenticity/,
    );
    expect(() => parseReproductionManifest(JSON.stringify({
      ...reproductionManifest,
      observationAuthenticity: "established",
    }))).toThrow(/observationAuthenticity/);
  });

  it("rejects malformed, oversized, and non-SHA-256 input", () => {
    expect(() => parseReproductionManifest("{")).toThrow(/invalid JSON/);
    expect(() => parseReproductionManifest(JSON.stringify({
      ...reproductionManifest,
      matchKey: "x".repeat(REPRODUCTION_MANIFEST_LIMITS.maxBytes),
    }))).toThrow(/byte limit/);
    expect(() => parseReproductionManifest(JSON.stringify({
      ...reproductionManifest,
      files: {
        ...reproductionManifest.files,
        "README.md": "A".repeat(64),
      },
    }))).toThrow(/SHA-256/);
  });
});
