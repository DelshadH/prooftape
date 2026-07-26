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

function repositoryFile(path) {
  if (typeof path !== "string" || isAbsolute(path) || path.includes("\0")) {
    throw new Error("corpus command path must be repository-relative");
  }
  const absolute = resolve(repository, path);
  const relation = relative(repository, absolute);
  if (
    relation === ""
    || relation === ".."
    || relation.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`)
    || isAbsolute(relation)
  ) {
    throw new Error(`corpus command escapes the repository: ${path}`);
  }
  return absolute;
}

function directRun(command) {
  const [executableName, script, ...args] = command;
  if (executableName !== "node" || typeof script !== "string") {
    throw new Error("corpus commands must use node with a repository script");
  }
  const executable = process.execPath;
  const scriptPath = repositoryFile(script);
  const result = spawnSync(executable, [scriptPath, ...args], {
    cwd: repository,
    encoding: "utf8",
    timeout: 180_000,
    maxBuffer: 4 * 1024 * 1024,
    windowsHide: true,
    shell: false,
  });
  if (result.error || result.status !== 0) {
    throw new Error(
      `${script} failed: ${result.error?.message ?? result.stderr.trim()}`,
    );
  }
  const line = result.stdout.trim().split(/\r?\n/u).at(-1);
  try {
    return JSON.parse(line);
  } catch {
    throw new Error(`${script} did not emit a machine-readable final result`);
  }
}

function selectResult(result, selection) {
  if (selection === undefined) return result;
  const array = result[selection.array];
  if (!Array.isArray(array)) {
    throw new Error(`corpus result has no array ${selection.array}`);
  }
  const selected = array.find((item) =>
    item && typeof item === "object" && item[selection.field] === selection.equals
  );
  if (!selected) throw new Error(`corpus selection ${selection.equals} was not produced`);
  return selected;
}

function matchesPartial(actual, expected) {
  if (Array.isArray(expected)) {
    return Array.isArray(actual)
      && actual.length === expected.length
      && expected.every((value, index) => matchesPartial(actual[index], value));
  }
  if (expected && typeof expected === "object") {
    return actual
      && typeof actual === "object"
      && Object.entries(expected).every(([key, value]) =>
        matchesPartial(actual[key], value)
      );
  }
  return Object.is(actual, expected);
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
    || !Array.isArray(corpusCase.command)
    || corpusCase.command.some((argument) => typeof argument !== "string")
    || !corpusCase.expectedResult
    || typeof corpusCase.expectedResult !== "object"
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
  repositoryFile(corpusCase.command[1]);
  seenIds.add(corpusCase.id);
  seenCategories.add(corpusCase.category);
}

const commandCache = new Map();
const caseResults = [];
for (const corpusCase of manifest.cases) {
  const commandKey = JSON.stringify(corpusCase.command);
  const commandResult = commandCache.get(commandKey) ?? directRun(corpusCase.command);
  commandCache.set(commandKey, commandResult);
  const actual = selectResult(commandResult, corpusCase.selection);
  if (!matchesPartial(actual, corpusCase.expectedResult)) {
    throw new Error(
      `${corpusCase.id} result mismatch: ${JSON.stringify(actual)}`,
    );
  }
  caseResults.push({
    id: corpusCase.id,
    category: corpusCase.category,
    evidenceType: corpusCase.evidenceType,
    source: corpusCase.source,
    command: corpusCase.command,
    expectedResult: corpusCase.expectedResult,
    actualResult: actual,
    passed: true,
  });
}

const realUpgradeCommand = JSON.stringify(["node", "scripts/real-upgrade-gates.mjs"]);
const realUpgrades = commandCache.get(realUpgradeCommand);
if (realUpgrades?.passed !== true || realUpgrades.fixtures?.length !== 3) {
  throw new Error("public real-upgrade corpus did not pass");
}

const report = {
  schemaVersion: "1",
  kind: "prooftape-compatibility-corpus-report",
  observationAuthenticity: "not-established",
  categories: [...seenCategories].sort(),
  cases: caseResults,
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
