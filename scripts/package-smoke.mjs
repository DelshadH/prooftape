import { spawnSync } from "node:child_process";
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

function run(executable, args, options = {}) {
  const result = spawnSync(executable, args, {
    encoding: "utf8",
    timeout: 120_000,
    maxBuffer: 2 * 1024 * 1024,
    windowsHide: true,
    shell: false,
    ...options,
  });
  if (result.error || result.status !== 0) {
    throw new Error(`${executable} ${args[0] ?? ""} failed: ${result.stderr.trim()}`);
  }
  return result.stdout.trim();
}

const repository = resolve(import.meta.dirname, "..");
const temporary = await mkdtemp(join(tmpdir(), "prooftape-package-smoke-"));

try {
  run("npm", ["run", "build"], { cwd: repository });
  const tarballs = [];
  for (const workspace of [
    "@prooftape/schema",
    "@prooftape/core",
    "@prooftape/hook",
    "prooftape",
  ]) {
    const output = run(
      "npm",
      ["pack", "--json", "--workspace", workspace, "--pack-destination", temporary],
      { cwd: repository },
    );
    const result = JSON.parse(output);
    const filename = result[0]?.filename;
    if (typeof filename !== "string") throw new Error(`npm pack returned no file for ${workspace}`);
    tarballs.push(join(temporary, filename));
  }

  const install = join(temporary, "install");
  await mkdir(install);
  await writeFile(
    join(install, "package.json"),
    JSON.stringify({ name: "prooftape-package-smoke", private: true }),
  );
  run(
    "npm",
    ["install", "--ignore-scripts", "--no-audit", "--no-fund", ...tarballs],
    { cwd: install },
  );
  const requireFromInstall = createRequire(join(install, "package.json"));
  const schemaEntry = requireFromInstall.resolve("@prooftape/schema");
  const {
    parseCapsule,
    parseReport,
    parseReproductionManifest,
  } = await import(pathToFileURL(schemaEntry).href);
  const goldenFormats = [
    ["capsule-v1.json", parseCapsule, "prooftape-capsule"],
    ["report-v1.json", parseReport, "prooftape-report"],
    [
      "reproduction-manifest-v1.json",
      parseReproductionManifest,
      "prooftape-reproduction-manifest",
    ],
  ];
  for (const [filename, parse, expectedKind] of goldenFormats) {
    const bytes = await readFile(join(repository, "fixtures", "schema", filename));
    const parsed = parse(bytes);
    if (parsed.kind !== expectedKind) {
      throw new Error(`packed schema rejected ${filename}`);
    }
  }
  const cli = join(install, "node_modules", "prooftape", "dist", "cli.js");
  const help = run(process.execPath, [cli, "--help"], { cwd: install });
  if (!help.includes("prooftape compare")) throw new Error("packed CLI help smoke failed");

  const fixture = join(temporary, "fixture");
  const dependency = join(fixture, "node_modules", "fixture");
  await mkdir(dependency, { recursive: true });
  await writeFile(
    join(fixture, "package.json"),
    JSON.stringify({ name: "packed-cli-fixture", private: true, type: "module" }),
  );
  await writeFile(
    join(fixture, "package-lock.json"),
    JSON.stringify({
      name: "packed-cli-fixture",
      lockfileVersion: 3,
      requires: true,
      packages: {},
    }),
  );
  await writeFile(
    join(fixture, ".gitignore"),
    "node_modules/\n*.ptape\n",
  );
  await writeFile(
    join(fixture, "app.mjs"),
    'import { value } from "fixture"; if (value(2) !== 4) process.exitCode = 9;\n',
  );
  await writeFile(
    join(dependency, "package.json"),
    JSON.stringify({ name: "fixture", version: "1.0.0", type: "module", exports: "./index.js" }),
  );
  await writeFile(join(dependency, "index.js"), "export const value = (input) => input * 2;\n");
  run("git", ["init", "-q"], { cwd: fixture });
  run("git", ["add", "."], { cwd: fixture });
  run("git", [
    "-c",
    "user.name=ProofTape",
    "-c",
    "user.email=fixture@example.invalid",
    "commit",
    "-qm",
    "fixture",
  ], { cwd: fixture });

  const quotedNode = `"${process.execPath.replaceAll('"', '\\"')}" app.mjs`;
  run(process.execPath, [
    cli,
    "record",
    "--dependency",
    "fixture",
    "--command",
    quotedNode,
    "--out",
    "smoke.ptape",
  ], { cwd: fixture });
  const capsule = JSON.parse(await readFile(join(fixture, "smoke.ptape"), "utf8"));
  if (
    capsule.kind !== "prooftape-capsule"
    || capsule.calls?.length !== 1
    || capsule.metadata?.observationAuthenticity !== "not-established"
  ) {
    throw new Error("packed CLI record smoke produced an invalid capsule");
  }
  const actionOutput = join(temporary, "github-output.txt");
  run(process.execPath, [join(repository, "scripts", "action-record.mjs")], {
    cwd: repository,
    env: {
      ...process.env,
      GITHUB_OUTPUT: actionOutput,
      GITHUB_WORKSPACE: fixture,
      PROOFTAPE_ACTION_COMMAND: quotedNode,
      PROOFTAPE_ACTION_DEPENDENCY: "fixture",
      PROOFTAPE_ACTION_OUTPUT: "action.ptape",
      PROOFTAPE_ACTION_TIMEOUT_MS: "10000",
      PROOFTAPE_ACTION_WORKING_DIRECTORY: ".",
    },
  });
  const actionCapsule = JSON.parse(await readFile(join(fixture, "action.ptape"), "utf8"));
  const outputMetadata = await readFile(actionOutput, "utf8");
  if (
    actionCapsule.kind !== "prooftape-capsule"
    || actionCapsule.calls?.length !== 1
    || actionCapsule.metadata?.observationAuthenticity !== "not-established"
    || !/capsule-sha256=[a-f0-9]{64}/u.test(outputMetadata)
    || !outputMetadata.includes("observation-authenticity=not-established\n")
  ) {
    throw new Error("composite Action helper smoke produced invalid evidence");
  }
  process.stdout.write("Packed CLI and composite Action recording smoke passed.\n");
} finally {
  await rm(temporary, { recursive: true, force: true });
}
