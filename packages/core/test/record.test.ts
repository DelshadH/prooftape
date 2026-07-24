import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";
import {
  buildReport,
  canonicalCapsule,
  HarnessError,
  UnsupportedCaptureError,
  recordRevision,
} from "../src/index.js";

async function repository(appSource: string): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "prooftape-record-"));
  const dependency = join(directory, "node_modules", "fixture");
  await mkdir(dependency, { recursive: true });
  await writeFile(
    join(directory, "package.json"),
    JSON.stringify({ name: "record-fixture", private: true, type: "module" }),
  );
  await writeFile(
    join(directory, "package-lock.json"),
    JSON.stringify({
      name: "record-fixture",
      lockfileVersion: 3,
      requires: true,
      packages: {},
    }),
  );
  await writeFile(join(directory, "app.mjs"), appSource);
  await writeFile(
    join(dependency, "package.json"),
    JSON.stringify({ name: "fixture", version: "1.2.3", type: "module", exports: "./index.js" }),
  );
  await writeFile(join(dependency, "index.js"), "export const value = (input) => ({ input });");
  for (const args of [
    ["init", "-q"],
    ["add", "package.json", "package-lock.json", "app.mjs"],
    ["-c", "user.name=ProofTape", "-c", "user.email=fixture@example.invalid", "commit", "-qm", "fixture"],
  ]) {
    const result = spawnSync("git", args, { cwd: directory, encoding: "utf8", windowsHide: true });
    expect(result.status, result.stderr).toBe(0);
  }
  return directory;
}

const hookUrl = pathToFileURL(resolve("packages/hook/dist/register.js")).href;

describe("recordRevision", () => {
  it("records a clean Git revision with deterministic evidence metadata", async () => {
    const directory = await repository([
      'import { value } from "fixture";',
      'const result = value("ok");',
      "if (result.input !== 'ok') process.exitCode = 9;",
    ].join("\n"));

    const result = await recordRevision({
      cwd: directory,
      dependency: "fixture",
      command: [process.execPath, "app.mjs"],
      hookUrl,
      prooftapeVersion: "0.0.0",
      redactLiterals: [],
      timeoutMilliseconds: 10_000,
      maxOutputBytes: 64 * 1024,
    });

    expect(result.capsule.calls).toHaveLength(1);
    expect(result.capsule.metadata).toMatchObject({
      dependency: { name: "fixture", version: "1.2.3" },
      command: [process.execPath, "app.mjs"],
    });
    expect(result.capsule.metadata.commitSha).toMatch(/^[a-f0-9]{40}$/);
  });

  it("redacts canaries before the capsule is created", async () => {
    const canary = "pt-secret-canary";
    const directory = await repository([
      'import { value } from "fixture";',
      `value(${JSON.stringify(canary)});`,
    ].join("\n"));

    const result = await recordRevision({
      cwd: directory,
      dependency: "fixture",
      command: [process.execPath, "app.mjs"],
      hookUrl,
      prooftapeVersion: "0.0.0",
      redactLiterals: [canary],
      timeoutMilliseconds: 10_000,
      maxOutputBytes: 64 * 1024,
    });

    expect(JSON.stringify(result.capsule)).not.toContain(canary);
  });

  it("classifies failed, timed out, and unobserved commands", async () => {
    const failed = await repository("process.exitCode = 7;");
    await expect(recordRevision({
      cwd: failed,
      dependency: "fixture",
      command: [process.execPath, "app.mjs"],
      hookUrl,
      prooftapeVersion: "0.0.0",
      redactLiterals: [],
      timeoutMilliseconds: 10_000,
      maxOutputBytes: 64 * 1024,
    })).rejects.toBeInstanceOf(HarnessError);

    const timedOut = await repository("setTimeout(() => {}, 10_000);");
    await expect(recordRevision({
      cwd: timedOut,
      dependency: "fixture",
      command: [process.execPath, "app.mjs"],
      hookUrl,
      prooftapeVersion: "0.0.0",
      redactLiterals: [],
      timeoutMilliseconds: 50,
      maxOutputBytes: 64 * 1024,
    })).rejects.toThrow(/timed out/);

    const unobserved = await repository("process.stdout.write('green');");
    await expect(recordRevision({
      cwd: unobserved,
      dependency: "fixture",
      command: [process.execPath, "app.mjs"],
      hookUrl,
      prooftapeVersion: "0.0.0",
      redactLiterals: [],
      timeoutMilliseconds: 10_000,
      maxOutputBytes: 64 * 1024,
    })).rejects.toBeInstanceOf(UnsupportedCaptureError);
  });

  it("produces byte-identical evidence and zero differences across 20 repeated runs", async () => {
    const directory = await repository([
      'import { value } from "fixture";',
      'value("stable");',
    ].join("\n"));
    const options = {
      cwd: directory,
      dependency: "fixture",
      command: [process.execPath, "app.mjs"],
      hookUrl,
      prooftapeVersion: "0.0.0",
      redactLiterals: [],
      timeoutMilliseconds: 10_000,
      maxOutputBytes: 64 * 1024,
    } as const;

    const baseline = await recordRevision(options);
    const canonical = canonicalCapsule(baseline.capsule);
    for (let run = 2; run <= 20; run += 1) {
      const candidate = await recordRevision(options);
      expect(canonicalCapsule(candidate.capsule)).toBe(canonical);
      expect(buildReport(baseline.capsule, candidate.capsule)).toMatchObject({
        verdict: "no-blocking-differences-observed",
        blockingDifferenceCount: 0,
        differences: [],
      });
    }
  }, 30_000);
});
