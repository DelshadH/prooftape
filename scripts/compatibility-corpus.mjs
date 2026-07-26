import { spawnSync } from "node:child_process";
import { lstat, readFile } from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";
import { checkedEvidenceOutput, writeEvidence } from "./evidence-output.mjs";

const repository = process.cwd();
const manifestPath = resolve(
  repository,
  "fixtures",
  "compatibility-corpus",
  "manifest.json",
);
const requiredCategories = new Set([
  "detected-semantic-changes",
  "clean-upgrades",
  "mutation-changes",
  "throw-rejection-changes",
  "ambiguous-calls",
  "unsupported-syntax",
  "child-worker-behavior",
  "adversarial-unauthenticated-observations",
]);

function directRun(executable, args) {
  const result = spawnSync(executable, args, {
    cwd: repository,
    encoding: "utf8",
    timeout: 180_000,
    maxBuffer: 4 * 1024 * 1024,
    windowsHide: true,
    shell: false,
  });
  if (result.error || result.status !== 0) {
    throw new Error(
      `${args[0] ?? executable} failed: ${result.error?.message ?? result.stderr.trim()}`,
    );
  }
  return result.stdout.trim();
}

function repositoryFile(path) {
  if (typeof path !== "string" || isAbsolute(path) || path.includes("\0")) {
    throw new Error("corpus verifier path must be repository-relative");
  }
  const absolute = resolve(repository, path);
  const relation = relative(repository, absolute);
  if (
    relation === ""
    || relation === ".."
    || relation.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`)
    || isAbsolute(relation)
  ) {
    throw new Error(`corpus verifier escapes the repository: ${path}`);
  }
  return absolute;
}

const manifestStats = await lstat(manifestPath);
if (!manifestStats.isFile() || manifestStats.isSymbolicLink()) {
  throw new Error("compatibility corpus manifest must be a regular file");
}
const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
if (
  manifest.schemaVersion !== "1"
  || manifest.kind !== "prooftape-compatibility-corpus"
  || manifest.observationAuthenticity !== "not-established"
  || !Array.isArray(manifest.cases)
) {
  throw new Error("compatibility corpus manifest has an invalid contract");
}
if (manifest.cases.length !== requiredCategories.size) {
  throw new Error("compatibility corpus must contain one case per required category");
}

const seenIds = new Set();
const seenCategories = new Set();
for (const corpusCase of manifest.cases) {
  if (
    !corpusCase
    || typeof corpusCase !== "object"
    || typeof corpusCase.id !== "string"
    || typeof corpusCase.category !== "string"
    || !["public-upstream", "synthetic"].includes(corpusCase.evidenceType)
    || typeof corpusCase.source !== "string"
    || typeof corpusCase.verifierFile !== "string"
    || typeof corpusCase.verifierText !== "string"
    || typeof corpusCase.expected !== "string"
  ) {
    throw new Error("compatibility corpus contains a malformed case");
  }
  if (seenIds.has(corpusCase.id)) throw new Error(`duplicate corpus id ${corpusCase.id}`);
  if (seenCategories.has(corpusCase.category)) {
    throw new Error(`duplicate corpus category ${corpusCase.category}`);
  }
  if (!requiredCategories.has(corpusCase.category)) {
    throw new Error(`unexpected corpus category ${corpusCase.category}`);
  }
  const verifierPath = repositoryFile(corpusCase.verifierFile);
  const verifierStats = await lstat(verifierPath);
  if (!verifierStats.isFile() || verifierStats.isSymbolicLink()) {
    throw new Error(`corpus verifier must be a regular file: ${corpusCase.verifierFile}`);
  }
  if (!(await readFile(verifierPath, "utf8")).includes(corpusCase.verifierText)) {
    throw new Error(`corpus verifier text is stale: ${corpusCase.id}`);
  }
  for (const additional of corpusCase.additionalVerifiers ?? []) {
    if (
      typeof additional?.file !== "string"
      || typeof additional.text !== "string"
    ) {
      throw new Error(`corpus additional verifier is malformed: ${corpusCase.id}`);
    }
    const additionalPath = repositoryFile(additional.file);
    const additionalStats = await lstat(additionalPath);
    if (!additionalStats.isFile() || additionalStats.isSymbolicLink()) {
      throw new Error(`corpus additional verifier is unsafe: ${additional.file}`);
    }
    if (!(await readFile(additionalPath, "utf8")).includes(additional.text)) {
      throw new Error(`corpus additional verifier text is stale: ${corpusCase.id}`);
    }
  }
  seenIds.add(corpusCase.id);
  seenCategories.add(corpusCase.category);
}
for (const category of requiredCategories) {
  if (!seenCategories.has(category)) throw new Error(`missing corpus category ${category}`);
}

const vitestFiles = [
  "packages/core/test/diff.test.ts",
  "packages/hook/test/interception.test.ts",
  "packages/cli/test/cli.test.ts",
  "packages/cli/test/adversarial-compare.test.ts",
];
directRun(process.execPath, [
  resolve(repository, "node_modules", "vitest", "vitest.mjs"),
  "run",
  ...vitestFiles,
]);
const realUpgradeOutput = directRun(process.execPath, [
  resolve(repository, "scripts", "real-upgrade-gates.mjs"),
]);
const realUpgrades = JSON.parse(realUpgradeOutput.split(/\r?\n/u).at(-1));
if (realUpgrades.passed !== true || realUpgrades.fixtures?.length !== 3) {
  throw new Error("public real-upgrade corpus did not pass");
}

const report = {
  schemaVersion: "1",
  kind: "prooftape-compatibility-corpus-report",
  observationAuthenticity: "not-established",
  categories: [...seenCategories].sort(),
  cases: manifest.cases.map((corpusCase) => ({
    id: corpusCase.id,
    category: corpusCase.category,
    evidenceType: corpusCase.evidenceType,
    expected: corpusCase.expected,
    source: corpusCase.source,
    passed: true,
  })),
  realUpgrades: realUpgrades.fixtures,
  passed: true,
};
const output = checkedEvidenceOutput(repository, process.argv.slice(2));
if (output) {
  await writeEvidence(
    output.outputPath,
    `${JSON.stringify(report, null, 2)}\n`,
    output.replaceExisting,
  );
}
process.stdout.write(`${JSON.stringify(report)}\n`);
