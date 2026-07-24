import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { CallObservationV1, EvidenceMetadataV1 } from "@prooftape/schema";
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
};

function call(processId: string, sequence: number, value: unknown): CallObservationV1 {
  return {
    schemaVersion: "1",
    callId: `${processId}:${sequence}`,
    sequence,
    processId,
    dependency: "fixture",
    exportPath: "value",
    callSiteFingerprint: "test.mjs:run",
    argsBefore: [],
    argsAfter: [],
    outcome: "return",
    value: value as never,
    durationNanoseconds: String(100 + sequence),
  };
}

function raw(sessionId: string, observation: CallObservationV1): string {
  return `${JSON.stringify({
    schemaVersion: "1",
    kind: "call",
    sessionId,
    call: observation,
  })}\n`;
}

describe("mergeRawDirectory", () => {
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
    expect(one.capsule.calls.every((item) => item.durationNanoseconds === undefined)).toBe(true);
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
