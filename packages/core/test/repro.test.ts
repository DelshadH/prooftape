import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { CapsuleV1 } from "@prooftape/schema";
import { buildReport, generateReproduction } from "../src/index.js";

function capsule(value: string, version: string, commit: string): CapsuleV1 {
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
        version,
        entry: "node_modules/fixture/index.js",
      },
      prooftapeVersion: "0.0.0",
      configurationSha256: "c".repeat(64),
      observationAuthenticity: "not-established",
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

async function installedFixture(value: string): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "prooftape-repro-env-"));
  const dependency = join(directory, "node_modules", "fixture");
  await mkdir(dependency, { recursive: true });
  await writeFile(join(directory, "package.json"), JSON.stringify({ type: "module" }));
  await writeFile(
    join(dependency, "package.json"),
    JSON.stringify({ name: "fixture", version: "1.0.0", type: "module", exports: "./index.js" }),
  );
  const source = value === "before"
    ? 'export function value(input) { return "before"; }\n'
    : value === "after"
      ? 'export function value(input) { return "after"; }\n'
      : undefined;
  if (!source) throw new Error("unknown reproduction fixture value");
  await writeFile(join(dependency, "index.js"), source);
  return directory;
}

describe("generateReproduction", () => {
  it("creates a manifest-verified replay that matches base and fails candidate", async () => {
    const base = capsule("before", "1.0.0", "a");
    const candidate = capsule("after", "2.0.0", "e");
    const report = buildReport(base, candidate);
    const root = await mkdtemp(join(tmpdir(), "prooftape-repro-"));
    const directory = join(root, "repro");

    const evidence = await generateReproduction(base, candidate, report, directory);

    expect(evidence.manifestSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(JSON.parse(await readFile(join(directory, "manifest.json"), "utf8")))
      .toMatchObject({
        kind: "prooftape-reproduction-manifest",
        observationAuthenticity: "not-established",
      });
    expect(await readFile(join(directory, "README.md"), "utf8")).toContain(
      "Observation authenticity is not established",
    );
    const baseEnvironment = await installedFixture("before");
    const candidateEnvironment = await installedFixture("after");
    const baseRun = spawnSync(process.execPath, [join(directory, "repro.mjs")], {
      cwd: baseEnvironment,
      encoding: "utf8",
      windowsHide: true,
    });
    const candidateRun = spawnSync(process.execPath, [join(directory, "repro.mjs")], {
      cwd: candidateEnvironment,
      encoding: "utf8",
      windowsHide: true,
    });

    expect(baseRun.status, baseRun.stderr).toBe(0);
    expect(baseRun.stdout).toContain("matches baseline");
    expect(candidateRun.status, candidateRun.stderr).toBe(1);
    expect(candidateRun.stdout).toContain("differs from baseline");
  });

  it("refuses redacted or normalized counterexamples", async () => {
    const base = capsule("[REDACTED]", "1.0.0", "a");
    const candidate = capsule("after", "2.0.0", "e");
    const report = buildReport(base, candidate);
    const root = await mkdtemp(join(tmpdir(), "prooftape-repro-"));

    await expect(generateReproduction(base, candidate, report, join(root, "repro")))
      .rejects.toThrow(/safe reproduction/);
  });
});
