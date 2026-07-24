import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { CapsuleV1 } from "@prooftape/schema";
import { runCli } from "../src/main.js";

function capsule(value: string, commit: string): CapsuleV1 {
  return {
    schemaVersion: "1",
    kind: "prooftape-capsule",
    metadata: {
      commitSha: commit.repeat(40),
      lockfileSha256: (commit === "a" ? "b" : "d").repeat(64),
      nodeVersion: process.version,
      platform: process.platform,
      arch: process.arch,
      command: [process.execPath, "test.mjs"],
      dependency: {
        name: "fixture",
        version: commit === "a" ? "1.0.0" : "2.0.0",
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
      argsBefore: [2],
      argsAfter: [2],
      outcome: "return",
      value,
    }],
    issues: [],
  };
}

function output() {
  let stdout = "";
  let stderr = "";
  return {
    io: {
      stdout: (value: string) => {
        stdout += value;
      },
      stderr: (value: string) => {
        stderr += value;
      },
    },
    read: () => ({ stdout, stderr }),
  };
}

describe("runCli", () => {
  it("prints help and rejects unknown commands with the public exit contract", async () => {
    const help = output();
    expect(await runCli(["--help"], { cwd: process.cwd(), ...help.io })).toBe(0);
    expect(help.read().stdout).toContain("prooftape compare");

    const unknown = output();
    expect(await runCli(["unknown"], { cwd: process.cwd(), ...unknown.io })).toBe(4);
    expect(unknown.read().stderr).toContain("Unknown command");
  });

  it("diffs capsules, writes versioned JSON, and emits a reproduction", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "prooftape-cli-"));
    await writeFile(join(cwd, "base.ptape"), JSON.stringify(capsule("before", "a")));
    await writeFile(join(cwd, "candidate.ptape"), JSON.stringify(capsule("after", "e")));
    const streams = output();

    const exitCode = await runCli([
      "diff",
      "--baseline",
      "base.ptape",
      "--candidate",
      "candidate.ptape",
      "--report",
      "report.json",
      "--repro-dir",
      "repro",
    ], { cwd, ...streams.io });

    expect(exitCode).toBe(2);
    expect(streams.read().stdout).toContain("1 blocking difference");
    const report = JSON.parse(await readFile(join(cwd, "report.json"), "utf8"));
    expect(report).toMatchObject({
      schemaVersion: "1",
      kind: "prooftape-report",
      verdict: "behavior-changed",
      reproduction: { directory: "repro" },
    });
    expect(await readFile(join(cwd, "repro", "repro.mjs"), "utf8")).toContain("matches baseline");
  });

  it("returns zero only for no blocking differences in supported calls", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "prooftape-cli-"));
    const unchanged = capsule("same", "a");
    await writeFile(join(cwd, "base.ptape"), JSON.stringify(unchanged));
    await writeFile(join(cwd, "candidate.ptape"), JSON.stringify(unchanged));
    const streams = output();

    const exitCode = await runCli([
      "diff",
      "--baseline",
      "base.ptape",
      "--candidate",
      "candidate.ptape",
      "--report",
      "report.json",
    ], { cwd, ...streams.io });

    expect(exitCode).toBe(0);
    expect(streams.read().stdout).toContain(
      "No blocking differences observed in captured supported calls",
    );
  });

  it("maps malformed and unsupported input to exit 4 without a stack trace", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "prooftape-cli-"));
    await writeFile(join(cwd, "bad.ptape"), '{"schemaVersion":"99"}');
    const streams = output();

    const exitCode = await runCli([
      "diff",
      "--baseline",
      "bad.ptape",
      "--candidate",
      "../escape.ptape",
    ], { cwd, ...streams.io });

    expect(exitCode).toBe(4);
    expect(streams.read().stderr).not.toContain(" at ");
  });

  it("rejects repository traversal for capsule inputs and report outputs", async () => {
    const parent = await mkdtemp(join(tmpdir(), "prooftape-cli-parent-"));
    const cwd = join(parent, "repo");
    await import("node:fs/promises").then(({ mkdir }) => mkdir(cwd));
    const unchanged = capsule("same", "a");
    await writeFile(join(parent, "outside.ptape"), JSON.stringify(unchanged));
    await writeFile(join(cwd, "inside.ptape"), JSON.stringify(unchanged));

    const escapedInput = output();
    expect(await runCli([
      "diff",
      "--baseline",
      "../outside.ptape",
      "--candidate",
      "inside.ptape",
    ], { cwd, ...escapedInput.io })).toBe(4);
    expect(escapedInput.read().stderr).toContain("escapes the repository");

    const escapedOutput = output();
    expect(await runCli([
      "diff",
      "--baseline",
      "inside.ptape",
      "--candidate",
      "inside.ptape",
      "--report",
      "../report.json",
    ], { cwd, ...escapedOutput.io })).toBe(4);
    expect(escapedOutput.read().stderr).toContain("escapes the repository");
  });

  it("maps ambiguous capture to exit 3 and explicit unsupported capture to exit 4", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "prooftape-cli-"));
    const base = capsule("same", "a");
    const duplicate = { ...base.calls[0]!, callId: "p1:2", sequence: 2 };
    await writeFile(
      join(cwd, "ambiguous-base.ptape"),
      JSON.stringify({ ...base, calls: [...base.calls, duplicate] }),
    );
    await writeFile(join(cwd, "candidate.ptape"), JSON.stringify(base));
    const ambiguous = output();
    expect(await runCli([
      "diff",
      "--baseline",
      "ambiguous-base.ptape",
      "--candidate",
      "candidate.ptape",
    ], { cwd, ...ambiguous.io })).toBe(3);
    expect(ambiguous.read().stderr).toContain("Harness failure");

    await writeFile(
      join(cwd, "unsupported-base.ptape"),
      JSON.stringify({
        ...base,
        issues: [{ code: "PT_UNSUPPORTED_DYNAMIC_IMPORT", message: "unsupported" }],
      }),
    );
    const unsupported = output();
    expect(await runCli([
      "diff",
      "--baseline",
      "unsupported-base.ptape",
      "--candidate",
      "candidate.ptape",
    ], { cwd, ...unsupported.io })).toBe(4);
    expect(unsupported.read().stderr).toContain("Unsupported or invalid input");
  });
});
