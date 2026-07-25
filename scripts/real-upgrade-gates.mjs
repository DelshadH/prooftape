import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";
import { checkedEvidenceOutput, writeEvidence } from "./evidence-output.mjs";

const root = process.cwd();
const { canonicalJson, compareRevisions } = await import(
  pathToFileURL(resolve(root, "packages/core/dist/index.js")).href
);
const { parseReport } = await import(
  pathToFileURL(resolve(root, "packages/schema/dist/index.js")).href
);
const hookUrl = pathToFileURL(resolve(root, "packages/hook/dist/register.js")).href;

const fixtures = [
  {
    name: "camelcase",
    dependency: "camelcase",
    app: "app.mjs",
    expectedVerdict: "behavior-changed",
    source: "https://github.com/sindresorhus/camelcase/releases/tag/v7.0.0",
  },
  {
    name: "is-number",
    dependency: "is-number",
    app: "app.cjs",
    expectedVerdict: "no-blocking-differences-observed",
    source: "https://github.com/jonschlinkert/is-number/compare/6.0.0...7.0.0",
  },
  {
    name: "ms",
    dependency: "ms",
    app: "app.cjs",
    expectedVerdict: "no-blocking-differences-observed",
    source: "https://github.com/vercel/ms/releases/tag/2.1.3",
  },
];

function git(cwd, args) {
  const result = spawnSync("git", args, {
    cwd,
    encoding: "utf8",
    env: {
      ...process.env,
      GIT_AUTHOR_DATE: "2026-01-01T00:00:00Z",
      GIT_COMMITTER_DATE: "2026-01-01T00:00:00Z",
    },
    timeout: 30_000,
    maxBuffer: 1024 * 1024,
    shell: false,
    windowsHide: true,
  });
  if (result.error || result.status !== 0) {
    throw new Error(`fixture Git command failed: ${args[0]}`);
  }
  return result.stdout.trim();
}

async function installRevision(fixtureRoot, revision, repository) {
  await writeFile(
    join(repository, "package.json"),
    await readFile(join(fixtureRoot, revision, "package.json")),
  );
  await writeFile(
    join(repository, "package-lock.json"),
    await readFile(join(fixtureRoot, revision, "package-lock.json")),
  );
}

const workRoot = await mkdtemp(join(tmpdir(), "prooftape-real-upgrades-"));
const results = [];
try {
  for (const fixture of fixtures) {
    const fixtureRoot = resolve(root, "fixtures", "real-upgrades", fixture.name);
    const repository = join(workRoot, fixture.name);
    await mkdir(repository);
    await writeFile(
      join(repository, fixture.app),
      await readFile(join(fixtureRoot, fixture.app)),
    );
    await writeFile(join(repository, ".gitignore"), "node_modules/\nrepro/\n");
    await installRevision(fixtureRoot, "base", repository);
    git(repository, ["init", "-q", "--initial-branch=main"]);
    git(repository, ["add", ".gitignore", fixture.app, "package.json", "package-lock.json"]);
    git(repository, [
      "-c",
      "user.name=ProofTape",
      "-c",
      "user.email=fixture@example.invalid",
      "commit",
      "-qm",
      "base",
    ]);
    const baseRef = git(repository, ["rev-parse", "HEAD"]);

    await installRevision(fixtureRoot, "candidate", repository);
    git(repository, ["add", "package.json", "package-lock.json"]);
    git(repository, [
      "-c",
      "user.name=ProofTape",
      "-c",
      "user.email=fixture@example.invalid",
      "commit",
      "-qm",
      "candidate",
    ]);
    const candidateRef = git(repository, ["rev-parse", "HEAD"]);
    const comparison = await compareRevisions({
      cwd: repository,
      baseRef,
      candidateRef,
      dependency: fixture.dependency,
      command: [process.execPath, fixture.app],
      hookUrl,
      prooftapeVersion: "0.0.0",
      redactLiterals: [],
      timeoutMilliseconds: 30_000,
      maxOutputBytes: 64 * 1024,
      ...(fixture.expectedVerdict === "behavior-changed"
        ? { reproductionDirectory: join(repository, "repro") }
        : {}),
    });
    const report = parseReport(canonicalJson(comparison.report));
    if (report.verdict !== fixture.expectedVerdict) {
      throw new Error(`${fixture.name}: expected ${fixture.expectedVerdict}, got ${report.verdict}`);
    }
    if (
      fixture.expectedVerdict === "behavior-changed"
      && (report.blockingDifferenceCount !== 1 || !report.reproduction)
    ) {
      throw new Error(`${fixture.name}: expected one reproducible blocking difference`);
    }
    results.push({
      name: fixture.name,
      dependency: fixture.dependency,
      baseVersion: report.baseline.dependencyVersion,
      candidateVersion: report.candidate.dependencyVersion,
      verdict: report.verdict,
      blockingDifferenceCount: report.blockingDifferenceCount,
      baseLockfileSha256: report.baseline.lockfileSha256,
      candidateLockfileSha256: report.candidate.lockfileSha256,
      source: fixture.source,
    });
  }
} finally {
  const absolute = resolve(workRoot);
  if (!absolute.startsWith(resolve(tmpdir(), "prooftape-real-upgrades-"))) {
    throw new Error("refusing to remove an unexpected real-upgrade directory");
  }
  await rm(absolute, { recursive: true, force: true });
}

const report = {
  schemaVersion: "1",
  kind: "prooftape-real-upgrade-report",
  fixtures: results,
  passed: results.length === fixtures.length,
};
const output = checkedEvidenceOutput(root, process.argv.slice(2));
if (output) {
  await writeEvidence(
    output.outputPath,
    `${JSON.stringify(report, null, 2)}\n`,
    output.replaceExisting,
  );
}
process.stdout.write(`${JSON.stringify(report)}\n`);
