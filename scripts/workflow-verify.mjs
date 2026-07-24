import { createHash } from "node:crypto";
import { readFile, realpath, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const toolRoot = resolve(import.meta.dirname, "..");
const { runCli } = await import(
  pathToFileURL(resolve(toolRoot, "packages/cli/dist/main.js")).href
);
const { parseCapsule } = await import(
  pathToFileURL(resolve(toolRoot, "packages/schema/dist/index.js")).href
);

function expectedHash(name) {
  const value = process.env[name];
  if (!value || !/^[a-f0-9]{64}$/u.test(value)) {
    throw new Error(`${name} must be a SHA-256`);
  }
  return value;
}

const directory = await realpath(process.env.PROOFTAPE_VERIFY_DIRECTORY ?? "");
const inputs = [
  ["base/capsule.ptape", expectedHash("PROOFTAPE_BASE_CAPSULE_SHA256")],
  ["candidate/capsule.ptape", expectedHash("PROOFTAPE_CANDIDATE_CAPSULE_SHA256")],
];
for (const [name, expected] of inputs) {
  const bytes = await readFile(resolve(directory, name));
  if (bytes.length > 10 * 1024 * 1024) throw new Error(`${name} exceeds 10 MiB`);
  const actual = createHash("sha256").update(bytes).digest("hex");
  if (actual !== expected) throw new Error(`${name} does not match its producing job`);
  parseCapsule(bytes);
}

const exitCode = await runCli([
  "diff",
  "--baseline",
  "base/capsule.ptape",
  "--candidate",
  "candidate/capsule.ptape",
  "--report",
  "report.json",
  "--repro-dir",
  "repro",
], {
  cwd: directory,
  stdout: (value) => process.stdout.write(value),
  stderr: (value) => process.stderr.write(value),
});
if (![0, 2, 3, 4].includes(exitCode)) throw new Error("CLI returned an unknown exit code");
await writeFile(resolve(directory, "exit-code.txt"), `${exitCode}\n`, {
  flag: "wx",
  mode: 0o600,
});
process.stdout.write(`Verifier recorded ProofTape exit ${exitCode}.\n`);
