import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { EvidenceMetadataV1, RawCallObservationV1 } from "@prooftape/schema";
import {
  CaptureMergeError,
  canonicalCapsule,
  mergeRawDirectory,
  sha256,
} from "../src/index.js";

const metadata: EvidenceMetadataV1 = {
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
};

function call(processId: string, sequence: number, value: unknown): RawCallObservationV1 {
  return {
    schemaVersion: "1",
    callId: `${processId}:${sequence}`,
    sequence,
    processId,
    dependency: "fixture",
    exportPath: "value",
    callSiteFingerprint: "test.mjs:run",
    moduleKind: "esm",
    receiverKind: "none",
    moduleSpecifier: "fixture",
    targetKind: "export",
    argsBefore: [],
    argsAfter: [],
    outcome: "return",
    value: value as never,
    durationNanoseconds: String(100 + sequence),
  };
}

function raw(sessionId: string, observation: unknown): string {
  return `${JSON.stringify({
    schemaVersion: "1",
    kind: "call",
    sessionId,
    call: observation,
  })}\n`;
}

describe("mergeRawDirectory", () => {
  it("requires a bounded decimal duration in every raw call", async () => {
    const directory = await mkdtemp(join(tmpdir(), "prooftape-merge-"));
    const {
      durationNanoseconds: _durationNanoseconds,
      ...withoutDuration
    } = call("1", 1, null);
    await writeFile(
      join(directory, "raw-session00-1.jsonl"),
      raw("session00", withoutDuration),
    );

    await expect(mergeRawDirectory(directory, "session00", metadata))
      .rejects.toThrow(/durationNanoseconds/);

    await writeFile(
      join(directory, "raw-session00-1.jsonl"),
      raw("session00", { ...call("1", 1, null), durationNanoseconds: "1e9" }),
    );

    await expect(mergeRawDirectory(directory, "session00", metadata))
      .rejects.toThrow(/durationNanoseconds/);
  });

  it("normalizes process IDs and removes timing for byte-identical capsules", async () => {
    const root = await mkdtemp(join(tmpdir(), "prooftape-merge-"));
    const first = join(root, "first");
    const second = join(root, "second");
    await mkdir(first);
    await mkdir(second);
    await writeFile(join(first, "raw-session01-900.jsonl"), raw("session01", call("900", 1, "b")));
    await writeFile(join(first, "raw-session01-100.jsonl"), raw("session01", call("100", 1, "a")));
    await writeFile(
      join(second, "raw-session01-777.jsonl"),
      raw("session01", { ...call("777", 1, "a"), durationNanoseconds: "999999" }),
    );
    await writeFile(
      join(second, "raw-session01-888.jsonl"),
      raw("session01", { ...call("888", 1, "b"), durationNanoseconds: "1" }),
    );

    const one = await mergeRawDirectory(first, "session01", metadata);
    const two = await mergeRawDirectory(second, "session01", metadata);

    expect(one.capsule.calls.map((item) => item.processId)).toEqual(["p1", "p2"]);
    expect(
      one.capsule.calls.every(
        (item) => !Object.prototype.hasOwnProperty.call(item, "durationNanoseconds"),
      ),
    ).toBe(true);
    expect(canonicalCapsule(one.capsule)).toBe(canonicalCapsule(two.capsule));
    expect(one.capsuleHash).toBe(sha256(canonicalCapsule(one.capsule)));
  });

  it("preserves explicit unsupported observations", async () => {
    const directory = await mkdtemp(join(tmpdir(), "prooftape-merge-"));
    const unsupported = {
      ...call("3", 1, null),
      unsupported: [{ path: "/0", reason: "cycle", type: "object" }],
    };
    await writeFile(
      join(directory, "raw-session02-3.jsonl"),
      raw("session02", unsupported),
    );

    const result = await mergeRawDirectory(directory, "session02", metadata);

    expect(result.hasUnsupported).toBe(true);
    expect(result.capsule.calls[0]?.unsupported?.[0]?.reason).toBe("cycle");
  });

  it("rejects malformed, cross-session, and oversized raw input", async () => {
    const malformed = await mkdtemp(join(tmpdir(), "prooftape-merge-"));
    await writeFile(join(malformed, "raw-session03-1.jsonl"), '{"kind":"call"}\n');
    await expect(mergeRawDirectory(malformed, "session03", metadata))
      .rejects.toBeInstanceOf(CaptureMergeError);

    const malformedUtf8 = await mkdtemp(join(tmpdir(), "prooftape-merge-"));
    const malformedUtf8Bytes = Buffer.from(raw("session03", call("1", 1, "marker")));
    const markerIndex = malformedUtf8Bytes.indexOf("marker");
    if (markerIndex < 0) throw new Error("raw UTF-8 test marker was not found");
    malformedUtf8Bytes[markerIndex] = 0xff;
    await writeFile(
      join(malformedUtf8, "raw-session03-1.jsonl"),
      malformedUtf8Bytes,
    );
    await expect(mergeRawDirectory(malformedUtf8, "session03", metadata))
      .rejects.toThrow(/UTF-8/);

    const wrongSession = await mkdtemp(join(tmpdir(), "prooftape-merge-"));
    await writeFile(
      join(wrongSession, "raw-session03-1.jsonl"),
      raw("attacker9", call("1", 1, null)),
    );
    await expect(mergeRawDirectory(wrongSession, "session03", metadata))
      .rejects.toThrow(/session/);

    const oversized = await mkdtemp(join(tmpdir(), "prooftape-merge-"));
    await writeFile(
      join(oversized, "raw-session03-1.jsonl"),
      `${"x".repeat(70_000)}\n`,
    );
    await expect(mergeRawDirectory(oversized, "session03", metadata, {
      maxLineBytes: 65_536,
    })).rejects.toThrow(/line/);
  });
});
