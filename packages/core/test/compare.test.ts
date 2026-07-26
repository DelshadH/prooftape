import { spawnSync } from "node:child_process";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";
import {
  compareRevisions,
  HarnessError,
  sha256,
  UnsupportedCaptureError,
} from "../src/index.js";

function command(cwd: string, executable: string, args: readonly string[]): string {
  const result = spawnSync(executable, args, {
    cwd,
    encoding: "utf8",
    timeout: 30_000,
    windowsHide: true,
  });
  expect(result.status, result.stderr).toBe(0);
  return result.stdout.trim();
}

async function fixtureRepository(): Promise<{
  directory: string;
  base: string;
  candidate: string;
}> {
  const directory = await mkdtemp(join(tmpdir(), "prooftape-compare-"));
  const fixture = join(directory, "fixture-package");
  await mkdir(fixture);
  await writeFile(
    join(directory, "package.json"),
    JSON.stringify({
      name: "compare-fixture",
      private: true,
      type: "module",
    }),
  );
  await writeFile(join(directory, ".gitignore"), "node_modules/\n");
  await writeFile(
    join(directory, "test.mjs"),
    [
      'import { value } from "fixture";',
      "const observed = value(2);",
      "if (typeof observed !== 'string') process.exitCode = 9;",
    ].join("\n"),
  );
  await writeFile(
    join(fixture, "package.json"),
    JSON.stringify({ name: "fixture", version: "1.0.0", type: "module", exports: "./index.js" }),
  );
  await writeFile(join(fixture, "index.js"), 'export const value = () => "before";\n');
  const baseTarball = command(directory, "npm", ["pack", "./fixture-package", "--silent"]);
  await writeFile(
    join(directory, "package.json"),
    JSON.stringify({
      name: "compare-fixture",
      private: true,
      type: "module",
      dependencies: { fixture: `file:./${baseTarball}` },
    }),
  );
  command(directory, "npm", ["install", "--ignore-scripts", "--no-audit", "--no-fund"]);
  command(directory, "git", ["init", "-q"]);
  command(directory, "git", ["add", "."]);
  command(directory, "git", [
    "-c",
    "user.name=ProofTape",
    "-c",
    "user.email=fixture@example.invalid",
    "commit",
    "-qm",
    "base",
  ]);
  const base = command(directory, "git", ["rev-parse", "HEAD"]);

  await writeFile(
    join(fixture, "package.json"),
    JSON.stringify({ name: "fixture", version: "2.0.0", type: "module", exports: "./index.js" }),
  );
  await writeFile(join(fixture, "index.js"), 'export const value = () => "after";\n');
  const candidateTarball = command(directory, "npm", ["pack", "./fixture-package", "--silent"]);
  await writeFile(
    join(directory, "package.json"),
    JSON.stringify({
      name: "compare-fixture",
      private: true,
      type: "module",
      dependencies: { fixture: `file:./${candidateTarball}` },
    }),
  );
  command(directory, "npm", [
    "install",
    "--ignore-scripts",
    "--no-audit",
    "--no-fund",
  ]);
  command(directory, "git", ["add", "."]);
  command(directory, "git", [
    "-c",
    "user.name=ProofTape",
    "-c",
    "user.email=fixture@example.invalid",
    "commit",
    "-qm",
    "candidate",
  ]);
  const candidate = command(directory, "git", ["rev-parse", "HEAD"]);
  return { directory, base, candidate };
}

describe("compareRevisions", () => {
  it("classifies malformed commit identifiers as unsupported input", async () => {
    await expect(compareRevisions({
      cwd: process.cwd(),
      baseRef: "not-a-sha",
      candidateRef: "a".repeat(40),
      dependency: "fixture",
      command: [process.execPath, "test.mjs"],
      hookUrl: pathToFileURL(resolve("packages/hook/dist/register.js")).href,
      prooftapeVersion: "0.0.0",
      redactLiterals: [],
      timeoutMilliseconds: 20_000,
      maxOutputBytes: 64 * 1024,
    })).rejects.toBeInstanceOf(UnsupportedCaptureError);
  });
  it("records exact isolated npm-lockfile worktrees and verifies a reproduction", async () => {
    const fixture = await fixtureRepository();
    const reproDirectory = join(fixture.directory, "repro");

    const result = await compareRevisions({
      cwd: fixture.directory,
      baseRef: fixture.base,
      candidateRef: fixture.candidate,
      dependency: "fixture",
      command: [process.execPath, "test.mjs"],
      hookUrl: pathToFileURL(resolve("packages/hook/dist/register.js")).href,
      prooftapeVersion: "0.0.0",
      redactLiterals: [],
      timeoutMilliseconds: 20_000,
      maxOutputBytes: 64 * 1024,
      reproductionDirectory: reproDirectory,
    });

    expect(result.report.verdict).toBe("behavior-changed");
    expect(
      result.report.differences.map((item) => item.kind),
      JSON.stringify(result.report.differences, null, 2),
    ).toEqual(["changed-return"]);
    expect(result.report.reproduction?.manifestSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(result.base.metadata.commitSha).toBe(fixture.base);
    expect(result.candidate.metadata.commitSha).toBe(fixture.candidate);
    expect(result.base.metadata.dependency.version).toBe("1.0.0");
    expect(result.candidate.metadata.dependency.version).toBe("2.0.0");
  }, 60_000);

  it("keeps recorded base evidence intact when candidate code targets the sibling worktree", async () => {
    const fixture = await fixtureRepository();
    await writeFile(
      join(fixture.directory, "test.mjs"),
      [
        'import { writeFileSync } from "node:fs";',
        'import { value } from "fixture";',
        "const observed = value(2);",
        'writeFileSync(new URL("../base/package-lock.json", import.meta.url), \'{"tampered":true}\');',
        "if (typeof observed !== 'string') process.exitCode = 9;",
      ].join("\n"),
    );
    command(fixture.directory, "git", ["add", "test.mjs"]);
    command(fixture.directory, "git", [
      "-c",
      "user.name=ProofTape",
      "-c",
      "user.email=fixture@example.invalid",
      "commit",
      "-qm",
      "candidate baseline attack",
    ]);
    const attackingCandidate = command(fixture.directory, "git", ["rev-parse", "HEAD"]);

    const result = await compareRevisions({
      cwd: fixture.directory,
      baseRef: fixture.base,
      candidateRef: attackingCandidate,
      dependency: "fixture",
      command: [process.execPath, "test.mjs"],
      hookUrl: pathToFileURL(resolve("packages/hook/dist/register.js")).href,
      prooftapeVersion: "0.0.0",
      redactLiterals: [],
      timeoutMilliseconds: 20_000,
      maxOutputBytes: 64 * 1024,
    });

    expect(result.base.metadata.commitSha).toBe(fixture.base);
    expect(result.base.metadata.lockfileSha256).not.toBe(sha256('{"tampered":true}'));
    expect(result.base.calls[0]?.value).toBe("before");
  }, 60_000);

  it("fails closed when candidate code modifies its own tracked checkout", async () => {
    const fixture = await fixtureRepository();
    await writeFile(
      join(fixture.directory, "test.mjs"),
      [
        'import { appendFileSync } from "node:fs";',
        'import { value } from "fixture";',
        "value(2);",
        'appendFileSync(new URL("./test.mjs", import.meta.url), "\\n// candidate tamper");',
      ].join("\n"),
    );
    command(fixture.directory, "git", ["add", "test.mjs"]);
    command(fixture.directory, "git", [
      "-c",
      "user.name=ProofTape",
      "-c",
      "user.email=fixture@example.invalid",
      "commit",
      "-qm",
      "candidate self attack",
    ]);
    const attackingCandidate = command(fixture.directory, "git", ["rev-parse", "HEAD"]);

    await expect(compareRevisions({
      cwd: fixture.directory,
      baseRef: fixture.base,
      candidateRef: attackingCandidate,
      dependency: "fixture",
      command: [process.execPath, "test.mjs"],
      hookUrl: pathToFileURL(resolve("packages/hook/dist/register.js")).href,
      prooftapeVersion: "0.0.0",
      redactLiterals: [],
      timeoutMilliseconds: 20_000,
      maxOutputBytes: 64 * 1024,
    })).rejects.toThrow(HarnessError);
  }, 60_000);
});
