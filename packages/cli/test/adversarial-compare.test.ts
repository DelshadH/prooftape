import { spawnSync } from "node:child_process";
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

function run(
  cwd: string,
  executable: string,
  args: readonly string[],
): string {
  const result = spawnSync(executable, args, {
    cwd,
    encoding: "utf8",
    timeout: 30_000,
    maxBuffer: 2 * 1024 * 1024,
    windowsHide: true,
    shell: false,
  });
  expect(result.status, result.stderr).toBe(0);
  return result.stdout.trim();
}

function commit(cwd: string, message: string): string {
  run(cwd, "git", ["add", "."]);
  run(cwd, "git", [
    "-c",
    "user.name=ProofTape",
    "-c",
    "user.email=fixture@example.invalid",
    "commit",
    "-qm",
    message,
  ]);
  return run(cwd, "git", ["rev-parse", "HEAD"]);
}

async function adversarialRepository(): Promise<{
  directory: string;
  base: string;
  candidate: string;
}> {
  const directory = await mkdtemp(join(tmpdir(), "prooftape-false-clean-"));
  const fixture = join(directory, "fixture-package");
  await mkdir(fixture);
  await writeFile(
    join(directory, ".gitignore"),
    "node_modules/\nfalse-clean-report.json\nrepro/\n",
  );
  await writeFile(
    join(fixture, "package.json"),
    JSON.stringify({
      name: "fixture",
      version: "1.0.0",
      type: "module",
      exports: "./index.js",
    }),
  );
  await writeFile(
    join(fixture, "index.js"),
    'export const value = () => "base-A";\n',
  );
  const baseTarball = run(directory, "npm", [
    "pack",
    "./fixture-package",
    "--silent",
  ]);
  await writeFile(
    join(directory, "package.json"),
    JSON.stringify({
      name: "prooftape-false-clean-fixture",
      private: true,
      type: "module",
      dependencies: { fixture: `file:./${baseTarball}` },
    }),
  );
  await writeFile(
    join(directory, "test.mjs"),
    [
      'import { value } from "fixture";',
      "const observed = value();",
      "process.stdout.write(`${observed}\\n`);",
    ].join("\n"),
  );
  run(directory, "npm", [
    "install",
    "--ignore-scripts",
    "--no-audit",
    "--no-fund",
  ]);
  run(directory, "git", ["init", "-q"]);
  const base = commit(directory, "base behavior A");

  await writeFile(
    join(fixture, "package.json"),
    JSON.stringify({
      name: "fixture",
      version: "2.0.0",
      type: "module",
      exports: "./index.js",
    }),
  );
  await writeFile(
    join(fixture, "index.js"),
    'export const value = () => "candidate-B";\n',
  );
  const candidateTarball = run(directory, "npm", [
    "pack",
    "./fixture-package",
    "--silent",
  ]);
  await writeFile(
    join(directory, "package.json"),
    JSON.stringify({
      name: "prooftape-false-clean-fixture",
      private: true,
      type: "module",
      dependencies: { fixture: `file:./${candidateTarball}` },
    }),
  );
  await writeFile(
    join(directory, "test.mjs"),
    [
      'import { value } from "fixture";',
      "const observed = value();",
      "process.stdout.write(`${observed}\\n`);",
      'import { readdirSync, readFileSync, writeFileSync } from "node:fs";',
      'import { join } from "node:path";',
      "const rawConfig = process.env.PROOFTAPE_CONFIG;",
      "if (rawConfig) {",
      "  const config = JSON.parse(rawConfig);",
      "  const name = readdirSync(config.outputDirectory).find((entry) =>",
      "    entry.startsWith(`raw-${config.sessionId}-`) && entry.endsWith('.jsonl')",
      "  );",
      '  if (!name) throw new Error("raw stream was not found");',
      "  const path = join(config.outputDirectory, name);",
      '  const record = JSON.parse(readFileSync(path, "utf8").trim());',
      "  writeFileSync(path, `${JSON.stringify({",
      "    ...record,",
      '    call: { ...record.call, value: "base-A" },',
      "  })}\\n`);",
      "}",
    ].join("\n"),
  );
  run(directory, "npm", [
    "install",
    "--ignore-scripts",
    "--no-audit",
    "--no-fund",
  ]);
  const candidate = commit(directory, "candidate behavior B");
  return { directory, base, candidate };
}

describe("adversarial candidate boundary", () => {
  it("reports a warned false-clean result when candidate code forges behavior A", async () => {
    const fixture = await adversarialRepository();
    try {
      expect(run(
        fixture.directory,
        process.execPath,
        ["test.mjs"],
      )).toBe("candidate-B");
      const quotedNode = `"${process.execPath.replaceAll('"', '\\"')}" test.mjs`;
      const cli = resolve("packages/cli/dist/cli.js");

      const comparison = spawnSync(process.execPath, [
        cli,
        "compare",
        "--base-ref",
        fixture.base,
        "--candidate-ref",
        fixture.candidate,
        "--dependency",
        "fixture",
        "--command",
        quotedNode,
        "--report",
        "false-clean-report.json",
      ], {
        cwd: fixture.directory,
        encoding: "utf8",
        timeout: 60_000,
        maxBuffer: 2 * 1024 * 1024,
        windowsHide: true,
        shell: false,
      });

      expect(comparison.status, comparison.stderr).toBe(0);
      expect(comparison.stdout).toContain(
        "No blocking differences observed in captured supported calls",
      );
      expect(comparison.stderr).toContain(
        "Observation authenticity is not established",
      );
      const report = JSON.parse(
        await readFile(
          join(fixture.directory, "false-clean-report.json"),
          "utf8",
        ),
      );
      expect(report).toMatchObject({
        verdict: "no-blocking-differences-observed",
        blockingDifferenceCount: 0,
        baseline: {
          dependencyVersion: "1.0.0",
          observationAuthenticity: "not-established",
        },
        candidate: {
          dependencyVersion: "2.0.0",
          observationAuthenticity: "not-established",
        },
      });
    } finally {
      await rm(fixture.directory, { recursive: true, force: true });
    }
  }, 60_000);
});
