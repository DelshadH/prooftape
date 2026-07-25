import { spawnSync } from "node:child_process";
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative, resolve } from "node:path";
import { checkedEvidenceOutput, writeEvidence } from "./evidence-output.mjs";

function execute(executable, args, options = {}) {
  return spawnSync(executable, args, {
    encoding: "utf8",
    timeout: 120_000,
    maxBuffer: 2 * 1024 * 1024,
    windowsHide: true,
    shell: false,
    ...options,
  });
}

function requireSuccess(executable, args, options = {}) {
  const result = execute(executable, args, options);
  if (result.error || result.status !== 0) {
    throw new Error(`${executable} ${args[0] ?? ""} failed: ${result.stderr.trim()}`);
  }
  return result.stdout.trim();
}

const transcript = [];
function show(message) {
  transcript.push(message);
  process.stdout.write(`${message}\n`);
}

async function writeDependency(directory, version, behavior) {
  await writeFile(
    join(directory, "package.json"),
    JSON.stringify({
      name: "fixture",
      version,
      type: "module",
      exports: "./index.js",
    }),
  );
  const source = behavior === "before:"
    ? 'export function format(value) { return "before:" + value; }\n'
    : behavior === "after:"
      ? 'export function format(value) { return "after:" + value; }\n'
      : undefined;
  if (!source) throw new Error("unknown demo behavior");
  await writeFile(join(directory, "index.js"), source);
}

const repository = resolve(import.meta.dirname, "..");
const temporary = await mkdtemp(join(tmpdir(), "prooftape-killer-demo-"));
const fixtureRepository = join(temporary, "repository");
const dependencyDirectory = join(fixtureRepository, "fixture-package");
const baseReplay = join(temporary, "base-replay");
let baseReplayAdded = false;

try {
  await mkdir(dependencyDirectory, { recursive: true });
  await writeFile(
    join(fixtureRepository, ".gitignore"),
    "node_modules/\nreport.json\nrepro/\n",
  );
  await writeFile(
    join(fixtureRepository, "test.mjs"),
    [
      'import { format } from "fixture";',
      'const result = format("x");',
      "if (typeof result !== 'string' || !result.endsWith('x')) process.exitCode = 9;",
    ].join("\n"),
  );
  await writeDependency(dependencyDirectory, "1.0.0", "before:");
  const baseTarball = requireSuccess(
    "npm",
    ["pack", "./fixture-package", "--silent"],
    { cwd: fixtureRepository },
  );
  await writeFile(
    join(fixtureRepository, "package.json"),
    JSON.stringify({
      name: "prooftape-killer-demo",
      private: true,
      type: "module",
      dependencies: { fixture: `file:./${baseTarball}` },
    }),
  );
  requireSuccess(
    "npm",
    ["install", "--ignore-scripts", "--no-audit", "--no-fund"],
    { cwd: fixtureRepository },
  );
  requireSuccess("git", ["init", "-q"], { cwd: fixtureRepository });
  requireSuccess("git", ["add", "."], { cwd: fixtureRepository });
  requireSuccess("git", [
    "-c",
    "user.name=ProofTape",
    "-c",
    "user.email=fixture@example.invalid",
    "commit",
    "-qm",
    "base",
  ], { cwd: fixtureRepository });
  const baseSha = requireSuccess("git", ["rev-parse", "HEAD"], { cwd: fixtureRepository });
  requireSuccess(process.execPath, ["test.mjs"], { cwd: fixtureRepository });
  show("1. Base tests: green");

  await writeDependency(dependencyDirectory, "2.0.0", "after:");
  const candidateTarball = requireSuccess(
    "npm",
    ["pack", "./fixture-package", "--silent"],
    { cwd: fixtureRepository },
  );
  await writeFile(
    join(fixtureRepository, "package.json"),
    JSON.stringify({
      name: "prooftape-killer-demo",
      private: true,
      type: "module",
      dependencies: { fixture: `file:./${candidateTarball}` },
    }),
  );
  requireSuccess(
    "npm",
    ["install", "--ignore-scripts", "--no-audit", "--no-fund"],
    { cwd: fixtureRepository },
  );
  requireSuccess("git", ["add", "."], { cwd: fixtureRepository });
  requireSuccess("git", [
    "-c",
    "user.name=ProofTape",
    "-c",
    "user.email=fixture@example.invalid",
    "commit",
    "-qm",
    "candidate",
  ], { cwd: fixtureRepository });
  const candidateSha = requireSuccess("git", ["rev-parse", "HEAD"], { cwd: fixtureRepository });
  requireSuccess(process.execPath, ["test.mjs"], { cwd: fixtureRepository });
  show("2. Candidate tests: green");

  const cli = join(repository, "packages", "cli", "dist", "cli.js");
  const quotedNode = `"${process.execPath.replaceAll('"', '\\"')}" test.mjs`;
  const comparison = execute(process.execPath, [
    cli,
    "compare",
    "--base-ref",
    baseSha,
    "--candidate-ref",
    candidateSha,
    "--dependency",
    "fixture",
    "--command",
    quotedNode,
    "--report",
    "report.json",
    "--repro-dir",
    "repro",
  ], { cwd: fixtureRepository });
  if (comparison.error || comparison.status !== 2) {
    throw new Error(`ProofTape comparison did not exit 2: ${comparison.stderr.trim()}`);
  }
  show("3. ProofTape exit: 2");
  const authenticityWarning = comparison.stderr.trim();
  if (!authenticityWarning.includes("Observation authenticity is not established")) {
    throw new Error("ProofTape comparison omitted the observation-authenticity warning");
  }
  show(`   ${authenticityWarning}`);
  show(`4. ${comparison.stdout.trim().split(/\r?\n/u).join(" ")}`);

  const candidateRepro = execute(
    process.execPath,
    [join(fixtureRepository, "repro", "repro.mjs")],
    { cwd: fixtureRepository },
  );
  if (candidateRepro.status !== 1) throw new Error("candidate reproduction did not fail");
  show("5. Generated repro: differs on candidate");

  requireSuccess(
    "git",
    ["worktree", "add", "--detach", baseReplay, baseSha],
    { cwd: fixtureRepository },
  );
  baseReplayAdded = true;
  requireSuccess(
    "npm",
    ["ci", "--ignore-scripts", "--no-audit", "--no-fund"],
    { cwd: baseReplay },
  );
  const baseRepro = execute(
    process.execPath,
    [join(fixtureRepository, "repro", "repro.mjs")],
    { cwd: baseReplay },
  );
  if (baseRepro.status !== 0) throw new Error("base reproduction did not match");

  const report = JSON.parse(await readFile(join(fixtureRepository, "report.json"), "utf8"));
  if (
    report.kind !== "prooftape-report"
    || report.blockingDifferenceCount !== 1
    || report.reproduction?.matchKey !== report.differences?.[0]?.matchKey
    || report.baseline?.observationAuthenticity !== "not-established"
    || report.candidate?.observationAuthenticity !== "not-established"
  ) {
    throw new Error("report and reproduction counterexample do not match");
  }
  show("6. Generated repro: matches base; report.json names the same counterexample");

  const recording = checkedEvidenceOutput(
    repository,
    process.argv.slice(2),
    "--record",
  );
  if (recording) {
    const header = JSON.stringify({
      version: 2,
      width: 100,
      height: 24,
      timestamp: Math.floor(Date.now() / 1000),
      env: { SHELL: "prooftape-demo", TERM: "xterm-256color" },
    });
    const events = transcript.map((line, index) =>
      JSON.stringify([
        Number((0.5 + (15 * index) / Math.max(1, transcript.length - 1)).toFixed(3)),
        "o",
        `${line}\r\n`,
      ])
    );
    await writeEvidence(
      recording.outputPath,
      `${[header, ...events].join("\n")}\n`,
      recording.replaceExisting,
    );
    process.stdout.write(
      `Recording written to ${relative(repository, recording.outputPath)} (15.5 seconds).\n`,
    );
  }
} finally {
  if (baseReplayAdded) {
    execute("git", ["worktree", "remove", "--force", baseReplay], { cwd: fixtureRepository });
  }
  await rm(temporary, { recursive: true, force: true });
}
