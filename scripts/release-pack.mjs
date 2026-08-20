import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  copyFile,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import {
  basename,
  dirname,
  isAbsolute,
  join,
  relative,
  resolve,
} from "node:path";

const VERSION = "0.1.0-alpha.2";
const PACKAGE_NAMES = [
  "@prooftape/schema",
  "@prooftape/core",
  "@prooftape/hook",
  "prooftape",
];
const PACKAGE_DIRECTORIES = new Map([
  ["@prooftape/schema", "packages/schema"],
  ["@prooftape/core", "packages/core"],
  ["@prooftape/hook", "packages/hook"],
  ["prooftape", "packages/cli"],
]);
const INTERNAL_DEPENDENCIES = new Set(PACKAGE_NAMES.slice(0, 3));
const FORBIDDEN_LIFECYCLE_SCRIPTS = new Set([
  "preinstall",
  "install",
  "postinstall",
  "prepack",
  "prepare",
  "postpack",
  "prepublish",
  "prepublishOnly",
  "publish",
  "postpublish",
]);
const MAX_PROCESS_OUTPUT_BYTES = 4 * 1024 * 1024;
const MAX_TARBALL_BYTES = 2 * 1024 * 1024;
const MAX_EVIDENCE_BYTES = 2 * 1024 * 1024;
const root = resolve(import.meta.dirname, "..");

function run(executable, args, options = {}) {
  const result = spawnSync(executable, args, {
    cwd: root,
    encoding: "utf8",
    timeout: 120_000,
    maxBuffer: MAX_PROCESS_OUTPUT_BYTES,
    windowsHide: true,
    shell: false,
    ...options,
  });
  if (result.error) throw result.error;
  return result;
}

function successfulText(executable, args, options = {}) {
  const result = run(executable, args, options);
  if (result.status !== 0) {
    throw new Error(
      `${executable} ${args.join(" ")} failed (${result.status}): `
        + `${result.stderr.trim().slice(0, 2_000)}`,
    );
  }
  return result.stdout.trim();
}

function expectedTarballName(name) {
  return `${name.replace(/^@/u, "").replace("/", "-")}-${VERSION}.tgz`;
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function jsonLine(value) {
  const output = `${JSON.stringify(value, null, 2)}\n`;
  if (Buffer.byteLength(output, "utf8") > MAX_EVIDENCE_BYTES) {
    throw new Error("release evidence exceeds the 2 MiB limit");
  }
  return output;
}

function inside(parent, target) {
  const path = relative(parent, target);
  return path === "" || (!path.startsWith("..") && !isAbsolute(path));
}

async function assertNoSymlinkComponents(parent, target) {
  let current = parent;
  for (const segment of relative(parent, target).split(/[\\/]/u).filter(Boolean)) {
    current = join(current, segment);
    try {
      const stats = await lstat(current);
      if (stats.isSymbolicLink()) {
        throw new Error("release output may not traverse a symbolic link");
      }
    } catch (error) {
      if (error instanceof Error && error.message.includes("symbolic link")) throw error;
      if (error?.code === "ENOENT") return;
      throw error;
    }
  }
}

function parseOutputArguments(args) {
  let output;
  let replaceExisting = false;
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--replace") {
      if (replaceExisting) throw new Error("--replace may be used only once");
      replaceExisting = true;
      continue;
    }
    if (argument === "--out") {
      if (output !== undefined) throw new Error("--out may be used only once");
      output = args[index + 1];
      if (!output || output.startsWith("--")) throw new Error("--out requires a path");
      index += 1;
      continue;
    }
    throw new Error(`unknown release-pack argument ${JSON.stringify(argument)}`);
  }
  if (output === undefined) throw new Error("--out is required");
  if (isAbsolute(output) || output.includes("\0")) {
    throw new Error("release output must be a relative path");
  }
  const evidenceRoot = resolve(root, ".evidence");
  const outputPath = resolve(root, output);
  if (!inside(evidenceRoot, outputPath) || outputPath === evidenceRoot) {
    throw new Error("release output must be a directory inside .evidence");
  }
  return { outputPath, replaceExisting };
}

async function assertCleanCheckout() {
  const status = successfulText(
    "git",
    ["status", "--porcelain=v1", "--untracked-files=all"],
  );
  if (status !== "") throw new Error(`release checkout is not clean:\n${status}`);
}

async function readPackage(directory) {
  return JSON.parse(await readFile(resolve(root, directory, "package.json"), "utf8"));
}

async function verifyWorkspaceVersions() {
  const workspace = JSON.parse(await readFile(resolve(root, "package.json"), "utf8"));
  if (workspace.version !== VERSION) {
    throw new Error(`workspace version must be exactly ${VERSION}`);
  }
  const packages = new Map();
  for (const name of PACKAGE_NAMES) {
    const directory = PACKAGE_DIRECTORIES.get(name);
    const manifest = await readPackage(directory);
    if (manifest.name !== name || manifest.version !== VERSION) {
      throw new Error(`${name} must have exact version ${VERSION}`);
    }
    for (const script of Object.keys(manifest.scripts ?? {})) {
      if (FORBIDDEN_LIFECYCLE_SCRIPTS.has(script)) {
        throw new Error(`${name} may not define lifecycle script ${script}`);
      }
    }
    for (const [dependency, range] of Object.entries(manifest.dependencies ?? {})) {
      if (INTERNAL_DEPENDENCIES.has(dependency) && range !== VERSION) {
        throw new Error(`${name} must depend on ${dependency}@${VERSION} exactly`);
      }
    }
    packages.set(name, manifest);
  }
  const requiredInternal = new Map([
    ["@prooftape/core", ["@prooftape/schema"]],
    ["@prooftape/hook", ["@prooftape/core", "@prooftape/schema"]],
    ["prooftape", ["@prooftape/core", "@prooftape/hook", "@prooftape/schema"]],
  ]);
  for (const [name, dependencies] of requiredInternal) {
    const manifest = packages.get(name);
    for (const dependency of dependencies) {
      if (manifest.dependencies?.[dependency] !== VERSION) {
        throw new Error(`${name} is missing exact dependency ${dependency}@${VERSION}`);
      }
    }
  }
}

function verifyPackedFiles(name, result) {
  const expectedFilename = expectedTarballName(name);
  if (result.name !== name || result.version !== VERSION) {
    throw new Error(`npm pack returned unexpected identity for ${name}`);
  }
  if (result.filename !== expectedFilename) {
    throw new Error(`npm pack returned unexpected filename for ${name}`);
  }
  if (!Array.isArray(result.files) || result.files.length > 100) {
    throw new Error(`${name} has an invalid packed file list`);
  }
  const paths = new Set();
  for (const file of result.files) {
    if (
      typeof file?.path !== "string"
      || typeof file.size !== "number"
      || file.size < 0
      || file.size > MAX_TARBALL_BYTES
      || file.path.includes("\\")
      || file.path.startsWith("/")
      || file.path.split("/").includes("..")
    ) {
      throw new Error(`${name} has an unsafe packed file entry`);
    }
    const allowed = (
      file.path === "package.json"
      || file.path === "README.md"
      || file.path === "LICENSE"
      || /^dist\/[A-Za-z0-9._/-]+\.(?:js|map|d\.ts)$/u.test(file.path)
    );
    if (!allowed) throw new Error(`${name} packs unexpected file ${file.path}`);
    paths.add(file.path);
  }
  if (
    !paths.has("package.json")
    || !paths.has("README.md")
    || !paths.has("LICENSE")
  ) {
    throw new Error(`${name} must pack package.json, README.md, and LICENSE`);
  }
  if (![...paths].some((path) => path.startsWith("dist/"))) {
    throw new Error(`${name} packs no built distribution`);
  }
  return expectedFilename;
}

async function packPackages(packDirectory, sourceRoot = root) {
  const packed = [];
  for (const name of PACKAGE_NAMES) {
    const stdout = successfulText("npm", [
      "pack",
      "--json",
      "--workspace",
      name,
      "--pack-destination",
      packDirectory,
    ], { cwd: sourceRoot });
    const parsed = JSON.parse(stdout);
    if (!Array.isArray(parsed) || parsed.length !== 1) {
      throw new Error(`npm pack returned unexpected JSON for ${name}`);
    }
    const result = parsed[0];
    const filename = verifyPackedFiles(name, result);
    const tarballPath = resolve(packDirectory, filename);
    if (dirname(tarballPath) !== resolve(packDirectory)) {
      throw new Error(`unsafe tarball path for ${name}`);
    }
    const bytes = await readFile(tarballPath);
    if (bytes.byteLength > MAX_TARBALL_BYTES) {
      throw new Error(`${name} tarball exceeds the 2 MiB limit`);
    }
    packed.push({
      name,
      version: VERSION,
      filename,
      sha256: sha256(bytes),
      size: bytes.byteLength,
      files: result.files.map(({ path, size, mode }) => ({ path, size, mode })),
      tarballPath,
    });
  }
  return packed;
}

async function prepareCleanSourceTree(directory, commitSha) {
  successfulText("git", ["worktree", "add", "--detach", directory, commitSha]);
  successfulText("npm", [
    "ci",
    "--ignore-scripts",
    "--no-audit",
    "--no-fund",
  ], { cwd: directory });
  successfulText("npm", ["run", "build"], { cwd: directory });
}

function removeCleanSourceTree(directory) {
  const result = run("git", ["worktree", "remove", "--force", directory]);
  if (result.status !== 0) {
    throw new Error(`could not remove release worktree ${directory}`);
  }
}

async function verifyInstalledPackages(installDirectory) {
  const modulesRoot = await realpath(join(installDirectory, "node_modules"));
  for (const name of PACKAGE_NAMES) {
    const packageDirectory = join(installDirectory, "node_modules", ...name.split("/"));
    const stats = await lstat(packageDirectory);
    if (!stats.isDirectory() || stats.isSymbolicLink()) {
      throw new Error(`${name} was not installed as a real package directory`);
    }
    const installedRealPath = await realpath(packageDirectory);
    if (!inside(modulesRoot, installedRealPath)) {
      throw new Error(`${name} resolved outside the clean install`);
    }
    const manifest = JSON.parse(
      await readFile(join(packageDirectory, "package.json"), "utf8"),
    );
    if (manifest.name !== name || manifest.version !== VERSION) {
      throw new Error(`${name} installed with an unexpected identity`);
    }
    const entry = name === "prooftape"
      ? join(packageDirectory, "dist", "cli.js")
      : join(packageDirectory, manifest.exports);
    const entryStats = await lstat(entry);
    if (!entryStats.isFile() || entryStats.isSymbolicLink()) {
      throw new Error(`${name} export is not a real installed file`);
    }
  }
}

async function initializeGit(directory, message) {
  successfulText("git", ["init", "-q"], { cwd: directory });
  successfulText("git", ["add", "."], { cwd: directory });
  successfulText("git", [
    "-c",
    "user.name=ProofTape",
    "-c",
    "user.email=release@example.invalid",
    "commit",
    "-qm",
    message,
  ], { cwd: directory });
  return successfulText("git", ["rev-parse", "HEAD"], { cwd: directory });
}

function cliStatus(cli, args, cwd) {
  const result = run(process.execPath, [cli, ...args], { cwd });
  return {
    status: result.status,
    stdout: result.stdout,
    stderr: result.stderr,
  };
}

function requireCliStatus(label, actual, expected) {
  if (actual.status !== expected) {
    throw new Error(
      `${label} expected exit ${expected}, received ${actual.status}: `
        + `${actual.stderr.trim().slice(0, 2_000)}`,
    );
  }
}

function sanitizeAndValidateSbom(sbom, packed) {
  if (sbom.bomFormat !== "CycloneDX" || !Array.isArray(sbom.components)) {
    throw new Error("npm sbom did not produce CycloneDX components");
  }
  const artifactByName = new Map(
    packed.map((entry) => [entry.name, entry]),
  );
  const allowedNames = new Set([
    ...artifactByName.keys(),
    "acorn",
  ]);
  for (const component of sbom.components) {
    if (!allowedNames.has(component.name)) {
      throw new Error(`SBOM contains unexpected component ${JSON.stringify(component.name)}`);
    }
    const unsafeProperty = component.properties?.find((property) =>
      property.value === "true"
      && /(?:extraneous|dev)/iu.test(String(property.name))
    );
    if (unsafeProperty) {
      throw new Error(`SBOM contains non-production component ${JSON.stringify(component.name)}`);
    }
    const artifact = artifactByName.get(component.name);
    if (artifact && Array.isArray(component.externalReferences)) {
      component.externalReferences = component.externalReferences.map((reference) =>
        reference.type === "distribution"
          ? {
              ...reference,
              url: `urn:prooftape:artifact:${artifact.filename}`,
              hashes: [{ alg: "SHA-256", content: artifact.sha256 }],
            }
          : reference
      );
    }
  }
  delete sbom.serialNumber;
  if (sbom.metadata && typeof sbom.metadata === "object") {
    delete sbom.metadata.timestamp;
    if (sbom.metadata.component && typeof sbom.metadata.component === "object") {
      sbom.metadata.component.name = "prooftape-release-sbom";
    }
  }
  const serialized = JSON.stringify(sbom);
  if (
    /file:[A-Za-z]:[\\/]|file:\/(?:tmp|private\/tmp)\//u.test(serialized)
    || serialized.includes("prooftape-release-pack-")
  ) {
    throw new Error("SBOM contains an ephemeral build-host path");
  }
  return sbom;
}

function verifyIndependentPackBuilds(first, second) {
  const summarize = (entries) => entries.map((entry) => ({
    name: entry.name,
    version: entry.version,
    filename: entry.filename,
    sha256: entry.sha256,
    size: entry.size,
    files: entry.files,
  }));
  if (JSON.stringify(summarize(first)) !== JSON.stringify(summarize(second))) {
    throw new Error("independent package builds are not byte-reproducible");
  }
}

async function installPackedPackages(directory, packed, name) {
  await mkdir(directory);
  await writeFile(
    join(directory, "package.json"),
    JSON.stringify({
      name,
      version: "0.0.0",
      private: true,
      type: "module",
    }),
  );
  successfulText("npm", [
    "install",
    "--ignore-scripts",
    "--no-audit",
    "--no-fund",
    ...packed.map((entry) => entry.tarballPath),
  ], { cwd: directory });
  await verifyInstalledPackages(directory);
}

async function buildSbom(directory, packed) {
  await installPackedPackages(directory, packed, "prooftape-release-sbom");
  const sbomText = successfulText("npm", [
    "sbom",
    "--omit=dev",
    "--sbom-format",
    "cyclonedx",
  ], { cwd: directory });
  return jsonLine(sanitizeAndValidateSbom(JSON.parse(sbomText), packed));
}

async function smokeInstalledCli(temporary, installDirectory) {
  const cli = join(installDirectory, "node_modules", "prooftape", "dist", "cli.js");
  const dependency = join(installDirectory, "node_modules", "fixture");
  await mkdir(dependency, { recursive: true });
  await writeFile(
    join(dependency, "package.json"),
    JSON.stringify({
      name: "fixture",
      version: "1.0.0",
      type: "module",
      exports: "./index.js",
    }),
  );
  await writeFile(
    join(dependency, "index.js"),
    'export const value = () => "before";\n',
  );
  await writeFile(join(installDirectory, ".gitignore"), "node_modules/\n*.ptape\nreport*.json\nrepro*/\n");
  await writeFile(
    join(installDirectory, "app.mjs"),
    'import { value } from "fixture"; if (value() !== "before") process.exitCode = 9;\n',
  );
  await initializeGit(installDirectory, "clean install smoke");

  const quotedNode = `"${process.execPath.replaceAll('"', '\\"')}" app.mjs`;
  const help = cliStatus(cli, ["--help"], installDirectory);
  const version = cliStatus(cli, ["--version"], installDirectory);
  const record = cliStatus(cli, [
    "record",
    "--dependency",
    "fixture",
    "--command",
    quotedNode,
    "--out",
    "base.ptape",
  ], installDirectory);
  requireCliStatus("help smoke", help, 0);
  requireCliStatus("version smoke", version, 0);
  requireCliStatus("record smoke", record, 0);
  if (
    !help.stdout.includes("prooftape compare")
    || version.stdout !== `${VERSION}\n`
    || !record.stderr.includes("Observation authenticity is not established")
  ) {
    throw new Error("packed CLI presentation smoke failed");
  }

  const base = JSON.parse(await readFile(join(installDirectory, "base.ptape"), "utf8"));
  const changed = structuredClone(base);
  changed.metadata.commitSha = "e".repeat(40);
  changed.metadata.dependency.version = "2.0.0";
  changed.calls[0].value = "after";
  await writeFile(
    join(installDirectory, "changed.ptape"),
    `${JSON.stringify(changed)}\n`,
  );
  await writeFile(
    join(installDirectory, "unchanged.ptape"),
    `${JSON.stringify(base)}\n`,
  );
  const unsupported = structuredClone(base);
  unsupported.issues = [{
    code: "PT_UNSUPPORTED_DYNAMIC_IMPORT",
    message: "unsupported release smoke input",
  }];
  await writeFile(
    join(installDirectory, "unsupported.ptape"),
    `${JSON.stringify(unsupported)}\n`,
  );

  const diffChanged = cliStatus(cli, [
    "diff",
    "--baseline",
    "base.ptape",
    "--candidate",
    "changed.ptape",
    "--report",
    "report-changed.json",
    "--repro-dir",
    "repro-changed",
  ], installDirectory);
  const diffUnchanged = cliStatus(cli, [
    "diff",
    "--baseline",
    "base.ptape",
    "--candidate",
    "unchanged.ptape",
    "--report",
    "report-unchanged.json",
  ], installDirectory);
  const invalidInput = cliStatus(cli, ["unknown"], installDirectory);
  const unsupportedInput = cliStatus(cli, [
    "diff",
    "--baseline",
    "unsupported.ptape",
    "--candidate",
    "unchanged.ptape",
    "--report",
    "report-unsupported.json",
  ], installDirectory);
  requireCliStatus("changed diff smoke", diffChanged, 2);
  requireCliStatus("unchanged diff smoke", diffUnchanged, 0);
  requireCliStatus("invalid input smoke", invalidInput, 4);
  requireCliStatus("unsupported input smoke", unsupportedInput, 4);

  const compareRepository = join(temporary, "compare-repository");
  const localDependency = join(temporary, "fixture-source");
  await mkdir(compareRepository);
  await mkdir(localDependency);
  await writeFile(
    join(compareRepository, "package.json"),
    JSON.stringify({
      name: "release-compare-smoke",
      private: true,
      type: "module",
      dependencies: { fixture: "file:./fixture-1.0.0.tgz" },
    }),
  );
  await writeFile(join(compareRepository, ".gitignore"), "node_modules/\nreport.json\nrepro/\n");
  await writeFile(
    join(compareRepository, "app.mjs"),
    'import { value } from "fixture"; if (!["before", "after"].includes(value())) process.exitCode = 9;\n',
  );
  await writeFile(
    join(localDependency, "package.json"),
    JSON.stringify({
      name: "fixture",
      version: "1.0.0",
      type: "module",
      exports: "./index.js",
    }),
  );
  await writeFile(
    join(localDependency, "index.js"),
    'export const value = () => "before";\n',
  );
  successfulText("npm", [
    "pack",
    "--pack-destination",
    compareRepository,
  ], { cwd: localDependency });
  successfulText("npm", [
    "install",
    "--package-lock-only",
    "--ignore-scripts",
    "--no-audit",
    "--no-fund",
  ], { cwd: compareRepository });
  const baseCommit = await initializeGit(compareRepository, "base behavior");

  await writeFile(
    join(localDependency, "package.json"),
    JSON.stringify({
      name: "fixture",
      version: "2.0.0",
      type: "module",
      exports: "./index.js",
    }),
  );
  await writeFile(
    join(localDependency, "index.js"),
    'export const value = () => "after";\n',
  );
  await writeFile(
    join(compareRepository, "package.json"),
    JSON.stringify({
      name: "release-compare-smoke",
      private: true,
      type: "module",
      dependencies: { fixture: "file:./fixture-2.0.0.tgz" },
    }),
  );
  successfulText("npm", [
    "pack",
    "--pack-destination",
    compareRepository,
  ], { cwd: localDependency });
  await rm(join(compareRepository, "fixture-1.0.0.tgz"));
  await rm(join(compareRepository, "package-lock.json"));
  successfulText("npm", [
    "install",
    "--package-lock-only",
    "--ignore-scripts",
    "--no-audit",
    "--no-fund",
  ], { cwd: compareRepository });
  successfulText("git", ["add", "."], { cwd: compareRepository });
  successfulText("git", [
    "-c",
    "user.name=ProofTape",
    "-c",
    "user.email=release@example.invalid",
    "commit",
    "-qm",
    "candidate behavior",
  ], { cwd: compareRepository });
  const candidateCommit = successfulText(
    "git",
    ["rev-parse", "HEAD"],
    { cwd: compareRepository },
  );
  const compareChanged = cliStatus(cli, [
    "compare",
    "--base-ref",
    baseCommit,
    "--candidate-ref",
    candidateCommit,
    "--dependency",
    "fixture",
    "--command",
    quotedNode,
    "--report",
    "report.json",
    "--repro-dir",
    "repro",
  ], compareRepository);
  requireCliStatus("changed compare smoke", compareChanged, 2);

  return {
    help: help.status,
    version: version.status,
    record: record.status,
    diffChanged: diffChanged.status,
    diffUnchanged: diffUnchanged.status,
    compareChanged: compareChanged.status,
    invalidInput: invalidInput.status,
    unsupportedInput: unsupportedInput.status,
  };
}

async function prepareRelease() {
  const { outputPath, replaceExisting } = parseOutputArguments(
    process.argv.slice(2),
  );
  await assertNoSymlinkComponents(root, outputPath);
  try {
    const outputStats = await lstat(outputPath);
    if (!outputStats.isDirectory() || outputStats.isSymbolicLink()) {
      throw new Error("existing release output must be a real directory");
    }
    if (!replaceExisting) throw new Error("release output already exists");
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }

  await assertCleanCheckout();
  await verifyWorkspaceVersions();
  const commitSha = successfulText("git", ["rev-parse", "HEAD"]);

  const temporary = await mkdtemp(join(tmpdir(), "prooftape-release-pack-"));
  const sourceOne = join(temporary, "source-one");
  const sourceTwo = join(temporary, "source-two");
  let sourceOneAdded = false;
  let sourceTwoAdded = false;
  try {
    await prepareCleanSourceTree(sourceOne, commitSha);
    sourceOneAdded = true;
    await prepareCleanSourceTree(sourceTwo, commitSha);
    sourceTwoAdded = true;
    const packDirectory = join(temporary, "packs-one");
    const verificationPackDirectory = join(temporary, "packs-two");
    const installDirectory = join(temporary, "install-one");
    const verificationInstallDirectory = join(temporary, "install-two");
    const sbomDirectory = join(temporary, "sbom-one");
    const verificationSbomDirectory = join(temporary, "sbom-two");
    const smokeTemporary = join(temporary, "smoke-one");
    const verificationSmokeTemporary = join(temporary, "smoke-two");
    await mkdir(packDirectory);
    await mkdir(verificationPackDirectory);
    await mkdir(smokeTemporary);
    await mkdir(verificationSmokeTemporary);
    const packed = await packPackages(packDirectory, sourceOne);
    const verificationPacked = await packPackages(verificationPackDirectory, sourceTwo);
    verifyIndependentPackBuilds(packed, verificationPacked);
    await installPackedPackages(
      installDirectory,
      packed,
      "prooftape-release-smoke-one",
    );
    await installPackedPackages(
      verificationInstallDirectory,
      verificationPacked,
      "prooftape-release-smoke-two",
    );
    const sbomOutput = await buildSbom(sbomDirectory, packed);
    const verificationSbomOutput = await buildSbom(
      verificationSbomDirectory,
      verificationPacked,
    );
    if (sbomOutput !== verificationSbomOutput) {
      throw new Error("independent SBOM builds are not byte-reproducible");
    }
    const smoke = await smokeInstalledCli(smokeTemporary, installDirectory);
    const verificationSmoke = await smokeInstalledCli(
      verificationSmokeTemporary,
      verificationInstallDirectory,
    );
    if (JSON.stringify(smoke) !== JSON.stringify(verificationSmoke)) {
      throw new Error("independent package smoke results are not reproducible");
    }
    const packageManifest = {
      schemaVersion: "1",
      kind: "prooftape-release-package-manifest",
      version: VERSION,
      commitSha,
      nodeVersion: process.version,
      npmVersion: successfulText("npm", ["--version"]),
      reproducibility: {
        cleanSourceTrees: 2,
        packageTarballs: "byte-identical",
        sbom: "byte-identical",
        smokeResults: "byte-identical",
      },
      packages: packed.map(({
        name,
        version,
        filename,
        sha256: digest,
        size,
        files,
      }) => ({
        name,
        version,
        filename,
        sha256: digest,
        size,
        files,
      })),
    };
    const smokeResults = {
      schemaVersion: "1",
      kind: "prooftape-release-smoke",
      version: VERSION,
      observationAuthenticity: "not-established",
      smoke,
    };
    const packageManifestOutput = jsonLine(packageManifest);
    const smokeResultsOutput = jsonLine(smokeResults);
    const checksums = [
      ...packed.map((entry) => `${entry.sha256}  ${entry.filename}`),
      `${sha256(Buffer.from(packageManifestOutput, "utf8"))}  package-manifest.json`,
      `${sha256(Buffer.from(sbomOutput, "utf8"))}  sbom.cdx.json`,
      `${sha256(Buffer.from(smokeResultsOutput, "utf8"))}  smoke-results.json`,
    ].join("\n") + "\n";
    if (Buffer.byteLength(checksums, "utf8") > MAX_EVIDENCE_BYTES) {
      throw new Error("checksum evidence exceeds the 2 MiB limit");
    }

    if (replaceExisting) {
      await rm(outputPath, { recursive: true, force: true });
    }
    await mkdir(dirname(outputPath), { recursive: true });
    await assertNoSymlinkComponents(root, outputPath);
    await mkdir(outputPath, { recursive: false });
    for (const entry of packed) {
      await copyFile(entry.tarballPath, join(outputPath, entry.filename));
    }
    await writeFile(
      join(outputPath, "package-manifest.json"),
      packageManifestOutput,
      { flag: "wx" },
    );
    await writeFile(
      join(outputPath, "smoke-results.json"),
      smokeResultsOutput,
      { flag: "wx" },
    );
    await writeFile(join(outputPath, "sbom.cdx.json"), sbomOutput, { flag: "wx" });
    await writeFile(join(outputPath, "SHA256SUMS"), checksums, { flag: "wx" });
    process.stdout.write(
      `Prepared ${VERSION} release evidence for commit ${commitSha} in `
        + `${relative(root, outputPath)}.\n`,
    );
  } finally {
    if (sourceTwoAdded) removeCleanSourceTree(sourceTwo);
    if (sourceOneAdded) removeCleanSourceTree(sourceOne);
    await rm(temporary, { recursive: true, force: true });
  }
}

await prepareRelease();
