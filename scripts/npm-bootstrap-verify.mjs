import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { lstat, readFile, readdir, stat } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { checkedEvidenceOutput, writeEvidence } from "./evidence-output.mjs";

export const RELEASE_PACKAGES = Object.freeze([
  Object.freeze({
    name: "@prooftape/schema",
    version: "0.1.0-alpha.1",
    filename: "prooftape-schema-0.1.0-alpha.1.tgz",
    sha256: "357d528b9d84a2bb1bd27586cc7a3a817ad174f50c55eddcb8933bf31990598e",
  }),
  Object.freeze({
    name: "@prooftape/core",
    version: "0.1.0-alpha.1",
    filename: "prooftape-core-0.1.0-alpha.1.tgz",
    sha256: "0cc6e4f219fd2e2a4cd265f416a846e5541cd1a6bb194d0789b7b8bfb4c8c1be",
  }),
  Object.freeze({
    name: "@prooftape/hook",
    version: "0.1.0-alpha.1",
    filename: "prooftape-hook-0.1.0-alpha.1.tgz",
    sha256: "cdb09e211a6190dfe217667e3ea78fedbd5899f26dcf44f05807828da228d5b7",
  }),
  Object.freeze({
    name: "prooftape",
    version: "0.1.0-alpha.1",
    filename: "prooftape-0.1.0-alpha.1.tgz",
    sha256: "b874ff03e8ad500143b27bb0ea61e938e902a16d77849b7d1ecd845e8f78aba1",
  }),
]);

const REPRODUCIBILITY = Object.freeze({
  cleanSourceTrees: 2,
  packageTarballs: "byte-identical",
  sbom: "byte-identical",
  smokeResults: "byte-identical",
});

function isSafePackageFile(file) {
  if (
    !file
    || typeof file.path !== "string"
    || !Number.isSafeInteger(file.size)
    || file.size < 0
    || file.mode !== 420
  ) {
    return false;
  }
  return (
    file.path === "LICENSE"
    || file.path === "README.md"
    || file.path === "package.json"
    || /^dist\/[A-Za-z0-9._/-]+$/u.test(file.path)
  ) && !file.path.includes("..") && !file.path.includes("\\");
}

export function validateReleaseManifest(
  manifest,
  expectedCommit,
  expectedPackages = RELEASE_PACKAGES,
) {
  if (
    !/^[a-f0-9]{40}$/u.test(expectedCommit)
    || !manifest
    || manifest.schemaVersion !== "1"
    || manifest.kind !== "prooftape-release-package-manifest"
    || manifest.version !== "0.1.0-alpha.1"
    || manifest.commitSha !== expectedCommit
    || JSON.stringify(manifest.reproducibility) !== JSON.stringify(REPRODUCIBILITY)
    || !Array.isArray(manifest.packages)
    || manifest.packages.length !== expectedPackages.length
  ) {
    throw new Error("unexpected package manifest");
  }

  for (const [index, expected] of expectedPackages.entries()) {
    const actual = manifest.packages[index];
    if (
      !actual
      || actual.name !== expected.name
      || actual.version !== expected.version
      || actual.filename !== expected.filename
      || actual.sha256 !== expected.sha256
      || !Number.isSafeInteger(actual.size)
      || actual.size <= 0
    ) {
      throw new Error("unexpected package manifest");
    }
    if (
      !Array.isArray(actual.files)
      || actual.files.length < 4
      || !actual.files.every(isSafePackageFile)
      || !actual.files.some((file) => file.path === "LICENSE")
      || !actual.files.some((file) => file.path === "README.md")
      || !actual.files.some((file) => file.path === "package.json")
      || !actual.files.some((file) => file.path.startsWith("dist/"))
      || new Set(actual.files.map((file) => file.path)).size !== actual.files.length
    ) {
      throw new Error(`${expected.name}: unsafe package contents`);
    }
  }
  return expectedPackages;
}

export async function checkRegistryEmpty(fetchImplementation = fetch) {
  const results = [];
  for (const entry of RELEASE_PACKAGES) {
    const url = `https://registry.npmjs.org/${encodeURIComponent(entry.name)}`;
    const response = await fetchImplementation(url, {
      headers: { accept: "application/json" },
      redirect: "error",
      signal: AbortSignal.timeout(15_000),
    });
    if (response.status === 404) {
      results.push({ name: entry.name, status: 404, state: "absent" });
      continue;
    }
    if (response.ok) {
      throw new Error(`${entry.name}: package name already exists; bootstrap is not rerunnable`);
    }
    throw new Error(`${entry.name}: registry lookup failed with HTTP ${response.status}`);
  }
  return results;
}

const INTERNAL_DEPENDENCIES = Object.freeze({
  "@prooftape/schema": Object.freeze({}),
  "@prooftape/core": Object.freeze({
    "@prooftape/schema": "0.1.0-alpha.1",
  }),
  "@prooftape/hook": Object.freeze({
    "@prooftape/core": "0.1.0-alpha.1",
    "@prooftape/schema": "0.1.0-alpha.1",
  }),
  "prooftape": Object.freeze({
    "@prooftape/core": "0.1.0-alpha.1",
    "@prooftape/hook": "0.1.0-alpha.1",
    "@prooftape/schema": "0.1.0-alpha.1",
  }),
});

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function successfulTar(args, label) {
  const result = spawnSync("tar", args, {
    encoding: "utf8",
    maxBuffer: 2 * 1024 * 1024,
    shell: false,
    windowsHide: true,
  });
  if (result.error || result.status !== 0) {
    throw new Error(`${label}: could not inspect package tarball`);
  }
  return result.stdout;
}

function verifyPackedPackage(tarballPath, manifestPackage, expectedPackage) {
  const members = successfulTar(
    ["-tzf", tarballPath],
    expectedPackage.name,
  ).trim().split(/\r?\n/u).filter(Boolean);
  const expectedMembers = manifestPackage.files
    .map((file) => `package/${file.path}`)
    .sort();
  if (JSON.stringify([...members].sort()) !== JSON.stringify(expectedMembers)) {
    throw new Error(`${expectedPackage.name}: tar members differ from the manifest`);
  }
  const verboseMembers = successfulTar(
    ["-tvzf", tarballPath],
    expectedPackage.name,
  ).trim().split(/\r?\n/u).filter(Boolean);
  if (
    verboseMembers.length !== expectedMembers.length
    || verboseMembers.some((line) => !line.startsWith("-"))
  ) {
    throw new Error(`${expectedPackage.name}: tarball contains a non-regular member`);
  }
  const packageJsonText = successfulTar(
    ["-xOzf", tarballPath, "package/package.json"],
    expectedPackage.name,
  );
  let packageJson;
  try {
    packageJson = JSON.parse(packageJsonText);
  } catch {
    throw new Error(`${expectedPackage.name}: package.json is not valid JSON`);
  }
  const repositoryDirectory = expectedPackage.name === "prooftape"
    ? "packages/cli"
    : `packages/${expectedPackage.name.slice("@prooftape/".length)}`;
  const internalDependencies = Object.fromEntries(
    Object.entries(packageJson.dependencies ?? {})
      .filter(([name]) => name.startsWith("@prooftape/")),
  );
  if (
    packageJson.name !== expectedPackage.name
    || packageJson.version !== expectedPackage.version
    || packageJson.repository?.type !== "git"
    || packageJson.repository?.url
      !== "git+https://github.com/DelshadH/prooftape.git"
    || packageJson.repository?.directory !== repositoryDirectory
    || JSON.stringify(internalDependencies)
      !== JSON.stringify(INTERNAL_DEPENDENCIES[expectedPackage.name])
  ) {
    throw new Error(`${expectedPackage.name}: unexpected packed package identity`);
  }
}

export async function verifyEvidenceDirectory(
  directory,
  expectedCommit,
  expectedPackages = RELEASE_PACKAGES,
) {
  const directoryMetadata = await lstat(directory);
  if (!directoryMetadata.isDirectory() || directoryMetadata.isSymbolicLink()) {
    throw new Error("release evidence path must be a real directory");
  }
  const expectedFiles = [
    "SHA256SUMS",
    "package-manifest.json",
    ...expectedPackages.map((entry) => entry.filename),
    "sbom.cdx.json",
    "smoke-results.json",
  ].sort();
  const actualFiles = (await readdir(directory)).sort();
  if (JSON.stringify(actualFiles) !== JSON.stringify(expectedFiles)) {
    throw new Error("unexpected release evidence file set");
  }
  for (const filename of actualFiles) {
    const metadata = await lstat(join(directory, filename));
    if (!metadata.isFile() || metadata.isSymbolicLink()) {
      throw new Error(`${filename}: release evidence must be a regular file`);
    }
  }

  const manifestText = await readFile(
    join(directory, "package-manifest.json"),
    "utf8",
  );
  let manifest;
  try {
    manifest = JSON.parse(manifestText);
  } catch {
    throw new Error("package manifest is not valid JSON");
  }
  validateReleaseManifest(manifest, expectedCommit, expectedPackages);

  const checksumText = await readFile(join(directory, "SHA256SUMS"), "utf8");
  const checksumEntries = checksumText.trim().split(/\r?\n/u).map((line) => {
    const match = /^([a-f0-9]{64}) {2}([A-Za-z0-9._-]+)$/u.exec(line);
    if (!match) throw new Error("SHA256SUMS contains a malformed entry");
    return { sha256: match[1], filename: match[2] };
  });
  const coveredFiles = actualFiles.filter((filename) => filename !== "SHA256SUMS");
  if (
    checksumEntries.length !== coveredFiles.length
    || JSON.stringify(checksumEntries.map((entry) => entry.filename).sort())
      !== JSON.stringify(coveredFiles.sort())
  ) {
    throw new Error("SHA256SUMS does not cover the exact retained payload");
  }
  for (const entry of checksumEntries) {
    const actualDigest = sha256(await readFile(join(directory, entry.filename)));
    if (actualDigest !== entry.sha256) {
      throw new Error(`${entry.filename}: SHA-256 mismatch`);
    }
  }

  for (const [index, expectedPackage] of expectedPackages.entries()) {
    const manifestPackage = manifest.packages[index];
    const tarballPath = join(directory, expectedPackage.filename);
    if (
      sha256(await readFile(tarballPath)) !== expectedPackage.sha256
      || (await stat(tarballPath)).size !== manifestPackage.size
    ) {
      throw new Error(`${expectedPackage.name}: immutable tarball identity mismatch`);
    }
    verifyPackedPackage(tarballPath, manifestPackage, expectedPackage);
  }

  const sbom = JSON.parse(await readFile(join(directory, "sbom.cdx.json"), "utf8"));
  const smoke = JSON.parse(
    await readFile(join(directory, "smoke-results.json"), "utf8"),
  );
  if (sbom.bomFormat !== "CycloneDX") {
    throw new Error("release SBOM is not CycloneDX");
  }
  if (
    smoke.schemaVersion !== "1"
    || smoke.kind !== "prooftape-release-smoke"
    || smoke.version !== "0.1.0-alpha.1"
    || smoke.observationAuthenticity !== "not-established"
  ) {
    throw new Error("unexpected release smoke evidence");
  }
  return {
    commitSha: expectedCommit,
    version: "0.1.0-alpha.1",
    packages: expectedPackages,
    checksums: checksumEntries,
  };
}

function expectedPurl(entry) {
  const encodedName = entry.name.startsWith("@")
    ? `%40${entry.name.slice(1)}`
    : entry.name;
  return `pkg:npm/${encodedName}@${entry.version}`;
}

export function validatePublishedPackage(
  entry,
  tarballBytes,
  packument,
  attestationResponse,
  expectedCommit,
) {
  const versionMetadata = packument?.versions?.[entry.version];
  if (
    packument?.name !== entry.name
    || JSON.stringify(Object.keys(packument?.versions ?? {})) !== JSON.stringify([
      entry.version,
    ])
    || packument?.["dist-tags"]?.alpha !== entry.version
    || packument?.["dist-tags"]?.latest === entry.version
    || versionMetadata?.name !== entry.name
    || versionMetadata?.version !== entry.version
  ) {
    throw new Error(`${entry.name}: unexpected package version or alpha dist-tag`);
  }
  const repositoryDirectory = entry.name === "prooftape"
    ? "packages/cli"
    : `packages/${entry.name.slice("@prooftape/".length)}`;
  if (
    versionMetadata.repository?.type !== "git"
    || versionMetadata.repository?.url
      !== "git+https://github.com/DelshadH/prooftape.git"
    || versionMetadata.repository?.directory !== repositoryDirectory
  ) {
    throw new Error(`${entry.name}: unexpected repository identity`);
  }
  const sha512Hex = createHash("sha512").update(tarballBytes).digest("hex");
  const sha512Base64 = createHash("sha512").update(tarballBytes).digest("base64");
  const sha1Hex = createHash("sha1").update(tarballBytes).digest("hex");
  if (
    sha256(tarballBytes) !== entry.sha256
    || versionMetadata.dist?.integrity !== `sha512-${sha512Base64}`
    || versionMetadata.dist?.shasum !== sha1Hex
  ) {
    throw new Error(`${entry.name}: registry integrity does not match reviewed bytes`);
  }
  for (const field of ["tarball", "attestations"]) {
    const value = field === "tarball"
      ? versionMetadata.dist?.tarball
      : versionMetadata.dist?.attestations?.url;
    let url;
    try {
      url = new URL(value);
    } catch {
      throw new Error(`${entry.name}: registry ${field} URL is invalid`);
    }
    if (url.protocol !== "https:" || url.hostname !== "registry.npmjs.org") {
      throw new Error(`${entry.name}: registry ${field} URL is not trusted`);
    }
  }
  if (
    versionMetadata.dist?.attestations?.provenance?.predicateType
      !== "https://slsa.dev/provenance/v1"
  ) {
    throw new Error(`${entry.name}: npm provenance metadata is absent`);
  }
  const provenanceAttestation = attestationResponse?.attestations?.find(
    (attestation) => attestation.predicateType === "https://slsa.dev/provenance/v1",
  );
  const envelope = provenanceAttestation?.bundle?.dsseEnvelope;
  if (
    envelope?.payloadType !== "application/vnd.in-toto+json"
    || !Array.isArray(envelope.signatures)
    || envelope.signatures.length === 0
    || typeof envelope.payload !== "string"
    || envelope.payload.length > 1024 * 1024
  ) {
    throw new Error(`${entry.name}: npm provenance envelope is invalid`);
  }
  let provenance;
  try {
    provenance = JSON.parse(Buffer.from(envelope.payload, "base64").toString("utf8"));
  } catch {
    throw new Error(`${entry.name}: npm provenance payload is invalid`);
  }
  const workflow = provenance?.predicate?.buildDefinition
    ?.externalParameters?.workflow;
  const source = provenance?.predicate?.buildDefinition
    ?.resolvedDependencies?.find(
      (dependency) => dependency?.digest?.gitCommit === expectedCommit,
    );
  const subject = provenance?.subject?.find(
    (candidate) => candidate?.name === expectedPurl(entry),
  );
  if (
    provenance?._type !== "https://in-toto.io/Statement/v1"
    || provenance?.predicateType !== "https://slsa.dev/provenance/v1"
    || subject?.digest?.sha512 !== sha512Hex
    || workflow?.ref !== "refs/tags/v0.1.0-alpha.1"
    || workflow?.repository !== "https://github.com/DelshadH/prooftape"
    || workflow?.path !== ".github/workflows/npm-bootstrap.yml"
    || source?.uri
      !== "git+https://github.com/DelshadH/prooftape@refs/tags/v0.1.0-alpha.1"
    || provenance?.predicate?.runDetails?.builder?.id
      !== "https://github.com/actions/runner/github-hosted"
  ) {
    throw new Error(`${entry.name}: provenance repository identity is invalid`);
  }
  return {
    name: entry.name,
    version: entry.version,
    sha256: entry.sha256,
    integrity: versionMetadata.dist.integrity,
    shasum: versionMetadata.dist.shasum,
    alphaTag: packument["dist-tags"].alpha,
    provenanceCommit: source.digest.gitCommit,
    provenanceWorkflow: workflow.path,
  };
}

export function buildPublicationIncident({
  expectedCommit,
  failedPhase,
  failedPackage,
  verificationStage,
  attemptedPackages,
  revocationAttempted,
  revocationSucceeded,
  registryStates,
}) {
  const expectedNames = RELEASE_PACKAGES.map((entry) => entry.name);
  const failedPhases = [
    "authentication",
    "publish",
    "token-revocation",
    "postpublish-verification",
  ];
  const verificationStages = [
    "registry-provenance-signatures",
    "verification-artifact-upload",
    "github-release-creation",
  ];
  const postPublishFailure = failedPhase === "postpublish-verification";
  if (
    !/^[a-f0-9]{40}$/u.test(expectedCommit)
    || !failedPhases.includes(failedPhase)
    || (
      failedPhase === "publish"
        ? !expectedNames.includes(failedPackage)
        : failedPackage !== undefined
    )
    || (
      postPublishFailure
        ? !verificationStages.includes(verificationStage)
        : verificationStage !== undefined
    )
    || !Array.isArray(attemptedPackages)
    || attemptedPackages.some((name) => !expectedNames.includes(name))
    || new Set(attemptedPackages).size !== attemptedPackages.length
    || (
      postPublishFailure
      && JSON.stringify(attemptedPackages) !== JSON.stringify(expectedNames)
    )
    || typeof revocationAttempted !== "boolean"
    || typeof revocationSucceeded !== "boolean"
    || (revocationSucceeded && !revocationAttempted)
    || (postPublishFailure && !revocationSucceeded)
    || !Array.isArray(registryStates)
    || JSON.stringify(registryStates.map((state) => state.name))
      !== JSON.stringify(expectedNames)
    || registryStates.some((state) => (
      ![true, false, null].includes(state.versionExists)
      || !["known", "unknown"].includes(state.lookup)
      || (state.versionExists === null) !== (state.lookup === "unknown")
    ))
  ) {
    throw new Error("invalid npm bootstrap incident input");
  }
  const publishedPackages = registryStates
    .filter((state) => state.versionExists)
    .map((state) => state.name);
  const registryStateUnknown = registryStates.some(
    (state) => state.versionExists === null,
  );
  const publicationState = registryStateUnknown
    ? "unknown"
    : publishedPackages.length === RELEASE_PACKAGES.length
      ? "complete"
      : publishedPackages.length > 0
        ? "partial"
        : "not-observed";
  const partialPublication = publicationState === "partial";
  const releaseIncident = (
    postPublishFailure
    || publishedPackages.length > 0
    || registryStateUnknown
  );
  return {
    schemaVersion: "1",
    kind: "prooftape-npm-bootstrap-incident",
    version: "0.1.0-alpha.1",
    expectedCommit,
    severity: releaseIncident ? "release-incident" : "publication-failure",
    partialPublication,
    registryStateUnknown,
    publicationState,
    rerunAllowed: (
      !postPublishFailure
      && publishedPackages.length === 0
      && !registryStateUnknown
    ),
    failedPhase,
    failedPackage: failedPackage ?? null,
    verificationStage: verificationStage ?? null,
    attemptedPackages,
    revocationAttempted,
    revocationSucceeded,
    publishedPackages,
    registryStates,
    requiredAction: releaseIncident
      ? "Stop publication, revoke credentials, preserve logs and evidence, and follow docs/compromised-release.md."
      : "Diagnose before considering another owner-authorized attempt.",
  };
}

async function boundedResponse(response, label, maximumBytes = 2 * 1024 * 1024) {
  const contentLength = Number(response.headers.get("content-length") ?? "0");
  if (Number.isFinite(contentLength) && contentLength > maximumBytes) {
    throw new Error(`${label}: registry response exceeds the byte limit`);
  }
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length > maximumBytes) {
    throw new Error(`${label}: registry response exceeds the byte limit`);
  }
  return bytes;
}

async function fetchJson(url, label, fetchImplementation = fetch) {
  const response = await fetchImplementation(url, {
    headers: { accept: "application/json" },
    redirect: "error",
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) {
    throw new Error(`${label}: registry request failed with HTTP ${response.status}`);
  }
  try {
    return JSON.parse((await boundedResponse(response, label)).toString("utf8"));
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new Error(`${label}: registry returned invalid JSON`);
    }
    throw error;
  }
}

export async function queryRegistryStates(fetchImplementation = fetch) {
  const states = [];
  for (const entry of RELEASE_PACKAGES) {
    const url = `https://registry.npmjs.org/${encodeURIComponent(entry.name)}`;
    let response;
    try {
      response = await fetchImplementation(url, {
        headers: { accept: "application/json" },
        redirect: "error",
        signal: AbortSignal.timeout(15_000),
      });
    } catch {
      states.push({
        name: entry.name,
        versionExists: null,
        lookup: "unknown",
        reason: "registry request failed",
      });
      continue;
    }
    if (response.status === 404) {
      states.push({
        name: entry.name,
        versionExists: false,
        lookup: "known",
      });
      continue;
    }
    if (!response.ok) {
      states.push({
        name: entry.name,
        versionExists: null,
        lookup: "unknown",
        reason: `registry lookup failed with HTTP ${response.status}`,
      });
      continue;
    }
    let packument;
    try {
      packument = JSON.parse(
        (await boundedResponse(response, entry.name)).toString("utf8"),
      );
    } catch (error) {
      if (error instanceof SyntaxError) {
        states.push({
          name: entry.name,
          versionExists: null,
          lookup: "unknown",
          reason: "registry returned invalid JSON",
        });
        continue;
      }
      states.push({
        name: entry.name,
        versionExists: null,
        lookup: "unknown",
        reason: "registry response could not be read",
      });
      continue;
    }
    states.push({
      name: entry.name,
      versionExists: Boolean(packument?.versions?.[entry.version]),
      lookup: "known",
    });
  }
  return states;
}

export async function verifyPublishedRegistry(
  expectedCommit,
  fetchImplementation = fetch,
) {
  const results = [];
  for (const entry of RELEASE_PACKAGES) {
    const packumentUrl =
      `https://registry.npmjs.org/${encodeURIComponent(entry.name)}`;
    const packument = await fetchJson(
      packumentUrl,
      `${entry.name} packument`,
      fetchImplementation,
    );
    const metadata = packument?.versions?.[entry.version];
    const tarballUrl = metadata?.dist?.tarball;
    const attestationUrl = metadata?.dist?.attestations?.url;
    if (typeof tarballUrl !== "string" || typeof attestationUrl !== "string") {
      throw new Error(`${entry.name}: registry publication metadata is incomplete`);
    }
    const tarballResponse = await fetchImplementation(tarballUrl, {
      redirect: "error",
      signal: AbortSignal.timeout(15_000),
    });
    if (!tarballResponse.ok) {
      throw new Error(`${entry.name}: tarball download failed`);
    }
    const tarball = await boundedResponse(
      tarballResponse,
      `${entry.name} tarball`,
      1024 * 1024,
    );
    const attestations = await fetchJson(
      attestationUrl,
      `${entry.name} attestations`,
      fetchImplementation,
    );
    results.push(validatePublishedPackage(
      entry,
      tarball,
      packument,
      attestations,
      expectedCommit,
    ));
  }
  return results;
}

export async function verifyPublishedRegistryWithRetry(
  expectedCommit,
  {
    maximumAttempts = 31,
    retryDelayMilliseconds = 10_000,
    verify = verifyPublishedRegistry,
    wait = (milliseconds) => new Promise(
      (resolveDelay) => setTimeout(resolveDelay, milliseconds),
    ),
  } = {},
) {
  if (
    !Number.isSafeInteger(maximumAttempts)
    || maximumAttempts < 1
    || maximumAttempts > 31
    || !Number.isSafeInteger(retryDelayMilliseconds)
    || retryDelayMilliseconds < 0
    || retryDelayMilliseconds > 10_000
  ) {
    throw new Error("invalid bounded post-publication retry configuration");
  }
  let lastError;
  for (let attempt = 1; attempt <= maximumAttempts; attempt += 1) {
    try {
      return await verify(expectedCommit);
    } catch (error) {
      lastError = error;
      if (attempt < maximumAttempts) {
        await wait(retryDelayMilliseconds);
      }
    }
  }
  throw lastError;
}

function parseOptions(args, allowed) {
  const options = new Map();
  for (let index = 0; index < args.length; index += 1) {
    const name = args[index];
    if (name === "--replace") {
      if (!allowed.has(name) || options.has(name)) {
        throw new Error(`unexpected or repeated option ${name}`);
      }
      options.set(name, true);
      continue;
    }
    if (!allowed.has(name) || options.has(name)) {
      throw new Error(`unexpected or repeated option ${name}`);
    }
    const value = args[index + 1];
    if (value === undefined || value.startsWith("--")) {
      throw new Error(`${name} requires a value`);
    }
    options.set(name, value);
    index += 1;
  }
  return options;
}

function requiredOption(options, name) {
  const value = options.get(name);
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${name} is required`);
  }
  return value;
}

function requiredBooleanOption(options, name) {
  const value = requiredOption(options, name);
  if (!["true", "false"].includes(value)) {
    throw new Error(`${name} must be true or false`);
  }
  return value === "true";
}

function integerOption(options, name, defaultValue) {
  const value = options.get(name);
  if (value === undefined) return defaultValue;
  if (typeof value !== "string" || !/^(?:0|[1-9][0-9]*)$/u.test(value)) {
    throw new Error(`${name} must be a non-negative integer`);
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) {
    throw new Error(`${name} must be a safe integer`);
  }
  return parsed;
}

async function writeReport(root, outputArgument, replace, report) {
  const output = checkedEvidenceOutput(root, [
    "--out",
    outputArgument,
    ...(replace ? ["--replace"] : []),
  ]);
  if (!output) throw new Error("--out is required");
  await writeEvidence(
    output.outputPath,
    `${JSON.stringify(report, null, 2)}\n`,
    output.replaceExisting,
  );
}

async function runPreflight(root, options) {
  if (process.env.NODE_AUTH_TOKEN || process.env.NPM_TOKEN) {
    throw new Error("bootstrap preflight must run without npm authentication");
  }
  const expectedCommit = requiredOption(options, "--commit");
  const directory = resolve(root, requiredOption(options, "--dir"));
  if (directory !== resolve(root, ".evidence/release")) {
    throw new Error("bootstrap evidence must be .evidence/release");
  }
  const evidence = await verifyEvidenceDirectory(directory, expectedCommit);
  const registry = await checkRegistryEmpty();
  const report = {
    schemaVersion: "1",
    kind: "prooftape-npm-bootstrap-preflight",
    version: "0.1.0-alpha.1",
    expectedCommit,
    authenticationPresent: false,
    rerunGuard: "all-package-names-absent",
    evidence,
    registry,
    passed: true,
  };
  await writeReport(
    root,
    requiredOption(options, "--out"),
    options.get("--replace") === true,
    report,
  );
  process.stdout.write(`${JSON.stringify(report)}\n`);
}

async function runPostPublish(root, options) {
  if (process.env.NODE_AUTH_TOKEN || process.env.NPM_TOKEN) {
    throw new Error("post-publication verification must run without npm authentication");
  }
  const expectedCommit = requiredOption(options, "--commit");
  const directory = resolve(root, requiredOption(options, "--dir"));
  if (directory !== resolve(root, ".evidence/release")) {
    throw new Error("bootstrap evidence must be .evidence/release");
  }
  const evidence = await verifyEvidenceDirectory(directory, expectedCommit);
  const registry = await verifyPublishedRegistryWithRetry(expectedCommit, {
    maximumAttempts: integerOption(options, "--max-attempts", 31),
    retryDelayMilliseconds:
      integerOption(options, "--retry-delay-ms", 10_000),
  });
  const report = {
    schemaVersion: "1",
    kind: "prooftape-npm-bootstrap-publication-verification",
    version: "0.1.0-alpha.1",
    expectedCommit,
    authenticationPresent: false,
    evidence,
    registry,
    passed: true,
  };
  await writeReport(
    root,
    requiredOption(options, "--out"),
    options.get("--replace") === true,
    report,
  );
  process.stdout.write(`${JSON.stringify(report)}\n`);
}

async function runIncident(root, options) {
  const expectedCommit = requiredOption(options, "--commit");
  const attemptedOption = options.get("--attempted");
  if (typeof attemptedOption !== "string") {
    throw new Error("--attempted is required");
  }
  const attemptedPackages = attemptedOption
    .split(",")
    .filter(Boolean);
  const report = buildPublicationIncident({
    expectedCommit,
    failedPhase: requiredOption(options, "--failed-phase"),
    failedPackage: options.get("--failed-package"),
    verificationStage: options.get("--verification-stage"),
    attemptedPackages,
    revocationAttempted:
      requiredBooleanOption(options, "--revocation-attempted"),
    revocationSucceeded:
      requiredBooleanOption(options, "--revocation-succeeded"),
    registryStates: await queryRegistryStates(),
  });
  await writeReport(
    root,
    requiredOption(options, "--out"),
    options.get("--replace") === true,
    report,
  );
  process.stderr.write("npm bootstrap publication incident recorded\n");
}

async function main() {
  const [command, ...args] = process.argv.slice(2);
  const allowed = new Set([
    "--attempted",
    "--commit",
    "--dir",
    "--failed-package",
    "--failed-phase",
    "--max-attempts",
    "--out",
    "--replace",
    "--revocation-attempted",
    "--revocation-succeeded",
    "--retry-delay-ms",
    "--verification-stage",
  ]);
  const options = parseOptions(args, allowed);
  const root = process.cwd();
  if (command === "preflight") {
    await runPreflight(root, options);
  } else if (command === "postpublish") {
    await runPostPublish(root, options);
  } else if (command === "incident") {
    await runIncident(root, options);
  } else {
    throw new Error("expected preflight, postpublish, or incident command");
  }
}

if (
  process.argv[1]
  && resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  await main();
}
