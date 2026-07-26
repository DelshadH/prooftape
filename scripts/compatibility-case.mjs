import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const repository = process.cwd();
const caseId = process.argv[2];
const { runCli } = await import(
  pathToFileURL(resolve(repository, "packages/cli/dist/main.js")).href
);

function observation(overrides = {}) {
  return {
    schemaVersion: "1",
    callId: "p1:1",
    sequence: 1,
    processId: "p1",
    dependency: "fixture",
    exportPath: "value",
    callSiteFingerprint: "<cwd>/app.mjs:1:1",
    moduleKind: "esm",
    receiverKind: "none",
    moduleSpecifier: "fixture",
    targetKind: "export",
    argsBefore: [{ count: 1 }],
    argsAfter: [{ count: 1 }],
    outcome: "return",
    value: "same",
    ...overrides,
  };
}

function capsule(commit, callOrCalls, issues = []) {
  return {
    schemaVersion: "1",
    kind: "prooftape-capsule",
    metadata: {
      commitSha: commit.repeat(40),
      lockfileSha256: (commit === "a" ? "b" : "d").repeat(64),
      nodeVersion: process.version,
      platform: process.platform,
      arch: process.arch,
      command: [process.execPath, "app.mjs"],
      dependency: {
        name: "fixture",
        version: commit === "a" ? "1.0.0" : "2.0.0",
        entry: "node_modules/fixture/index.js",
      },
      prooftapeVersion: "0.1.0-alpha.1",
      configurationSha256: "c".repeat(64),
      observationAuthenticity: "not-established",
    },
    calls: Array.isArray(callOrCalls) ? callOrCalls : [callOrCalls],
    issues,
  };
}

function streams() {
  let stdout = "";
  let stderr = "";
  return {
    io: {
      stdout: (value) => {
        stdout += value;
      },
      stderr: (value) => {
        stderr += value;
      },
    },
    result: () => ({ stdout, stderr }),
  };
}

async function cliDiff(base, candidate) {
  const cwd = await mkdtemp(join(tmpdir(), "prooftape-corpus-diff-"));
  await writeFile(join(cwd, "base.ptape"), `${JSON.stringify(base)}\n`);
  await writeFile(join(cwd, "candidate.ptape"), `${JSON.stringify(candidate)}\n`);
  const output = streams();
  const exitCode = await runCli([
    "diff",
    "--baseline",
    "base.ptape",
    "--candidate",
    "candidate.ptape",
    "--report",
    "report.json",
  ], { cwd, ...output.io });
  let report;
  try {
    report = JSON.parse(await readFile(join(cwd, "report.json"), "utf8"));
  } catch {
    report = undefined;
  }
  return {
    id: caseId,
    exitCode,
    verdict: report?.verdict ?? "harness-failure",
    differenceKinds: report?.differences?.map((difference) => difference.kind) ?? [],
    authenticityWarning: output.result().stderr.includes(
      "Observation authenticity is not established",
    ),
  };
}

function git(cwd, args) {
  const result = spawnSync("git", args, {
    cwd,
    encoding: "utf8",
    windowsHide: true,
    shell: false,
  });
  if (result.status !== 0) throw new Error(`git ${args[0]} failed`);
}

async function recordRepository(files) {
  const cwd = await mkdtemp(join(tmpdir(), "prooftape-corpus-record-"));
  const dependency = join(cwd, "node_modules", "fixture");
  await mkdir(dependency, { recursive: true });
  await writeFile(
    join(cwd, "package.json"),
    JSON.stringify({ name: "corpus-case", private: true, type: "module" }),
  );
  await writeFile(
    join(cwd, "package-lock.json"),
    JSON.stringify({
      name: "corpus-case",
      lockfileVersion: 3,
      requires: true,
      packages: {},
    }),
  );
  await writeFile(join(cwd, ".gitignore"), "node_modules/\n*.ptape\n");
  await writeFile(
    join(dependency, "package.json"),
    JSON.stringify({ name: "fixture", version: "1.0.0", type: "module", exports: "./index.js" }),
  );
  await writeFile(join(dependency, "index.js"), "export const value = (input) => input;\n");
  for (const [name, source] of Object.entries(files)) {
    await writeFile(join(cwd, name), source);
  }
  git(cwd, ["init", "-q", "--initial-branch=main"]);
  git(cwd, ["add", "."]);
  git(cwd, [
    "-c",
    "user.name=ProofTape",
    "-c",
    "user.email=corpus@example.invalid",
    "commit",
    "-qm",
    "corpus case",
  ]);
  const output = streams();
  const exitCode = await runCli([
    "record",
    "--dependency",
    "fixture",
    "--command",
    `"${process.execPath.replaceAll('"', '\\"')}" app.mjs`,
    "--out",
    "case.ptape",
  ], { cwd, ...output.io });
  let recorded;
  try {
    recorded = JSON.parse(await readFile(join(cwd, "case.ptape"), "utf8"));
  } catch {
    recorded = undefined;
  }
  return {
    id: caseId,
    exitCode,
    callCount: recorded?.calls?.length ?? 0,
    issueCodes: recorded?.issues?.map((item) => item.code) ?? [],
    authenticityWarning: output.result().stderr.includes(
      "Observation authenticity is not established",
    ),
  };
}

let result;
if (caseId === "synthetic-mutation") {
  result = await cliDiff(
    capsule("a", observation({ argsAfter: [{ count: 2 }] })),
    capsule("e", observation({ argsAfter: [{ count: 3 }] })),
  );
} else if (caseId === "synthetic-throw-error") {
  result = await cliDiff(
    capsule("a", observation({
      outcome: "throw",
      value: undefined,
      error: { name: "Error", message: "before" },
    })),
    capsule("e", observation({
      outcome: "throw",
      value: undefined,
      error: { name: "TypeError", message: "after" },
    })),
  );
} else if (caseId === "synthetic-ambiguous-repeat") {
  const first = observation();
  result = await cliDiff(
    capsule("a", [first, { ...first, callId: "p1:2", sequence: 2 }]),
    capsule("e", first),
  );
} else if (caseId === "synthetic-unsupported-syntax") {
  result = await recordRepository({
    "app.mjs": [
      'const dependency = await import("fixture");',
      'dependency.value("unsupported");',
    ].join("\n"),
  });
} else if (caseId === "synthetic-child-worker") {
  result = await recordRepository({
    "child.mjs": 'import { value } from "fixture"; value("child");\n',
    "worker.mjs": [
      'import { parentPort } from "node:worker_threads";',
      'import { value } from "fixture";',
      'value("worker");',
      'parentPort.postMessage("done");',
    ].join("\n"),
    "app.mjs": [
      'import { spawnSync } from "node:child_process";',
      'import { Worker } from "node:worker_threads";',
      'import { value } from "fixture";',
      'value("parent");',
      'const child = spawnSync(process.execPath, ["child.mjs"], { stdio: "inherit" });',
      'if (child.status !== 0) process.exitCode = 9;',
      'await new Promise((resolve, reject) => {',
      '  const worker = new Worker(new URL("./worker.mjs", import.meta.url));',
      '  worker.once("message", resolve); worker.once("error", reject);',
      '});',
    ].join("\n"),
  });
} else if (caseId === "synthetic-forged-false-clean") {
  const run = spawnSync(
    process.execPath,
    [
      resolve(repository, "node_modules", "vitest", "vitest.mjs"),
      "run",
      "packages/cli/test/adversarial-compare.test.ts",
      "-t",
      "reports a warned false-clean result",
    ],
    {
      cwd: repository,
      encoding: "utf8",
      timeout: 120_000,
      maxBuffer: 2 * 1024 * 1024,
      windowsHide: true,
      shell: false,
    },
  );
  result = {
    id: caseId,
    exitCode: run.status,
    verdict: run.status === 0 ? "warned-false-clean" : "failed",
    authenticityWarning: run.status === 0,
  };
} else {
  throw new Error(`unknown compatibility case ${JSON.stringify(caseId)}`);
}

process.stdout.write(`${JSON.stringify(result)}\n`);
