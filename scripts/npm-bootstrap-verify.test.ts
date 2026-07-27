import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import {
  mkdtemp,
  mkdir,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  buildPublicationIncident,
  checkRegistryEmpty,
  queryRegistryStates,
  RELEASE_PACKAGES,
  validateReleaseManifest,
  validatePublishedPackage,
  verifyEvidenceDirectory,
  verifyPublishedRegistryWithRetry,
} from "./npm-bootstrap-verify.mjs";

const commit = "b56ef43a944ea800671ed64397d55420f63c692c";
const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map(
    (path) => rm(path, { recursive: true, force: true }),
  ));
});

function digest(bytes: Buffer | string) {
  return createHash("sha256").update(bytes).digest("hex");
}

function validManifest() {
  return {
    schemaVersion: "1",
    kind: "prooftape-release-package-manifest",
    version: "0.1.0-alpha.1",
    commitSha: commit,
    reproducibility: {
      cleanSourceTrees: 2,
      packageTarballs: "byte-identical",
      sbom: "byte-identical",
      smokeResults: "byte-identical",
    },
    packages: RELEASE_PACKAGES.map((entry) => ({
      ...entry,
      size: 1,
      files: [
        { path: "LICENSE", size: 1, mode: 420 },
        { path: "README.md", size: 1, mode: 420 },
        { path: "dist/index.js", size: 1, mode: 420 },
        { path: "package.json", size: 1, mode: 420 },
      ],
    })),
  };
}

describe("npm bootstrap evidence verifier", () => {
  it("accepts only the exact real-alpha manifest and immutable tarball hashes", () => {
    expect(validateReleaseManifest(validManifest(), commit))
      .toEqual(RELEASE_PACKAGES);

    const wrongHash = validManifest();
    wrongHash.packages[0]!.sha256 = "0".repeat(64);
    expect(() => validateReleaseManifest(wrongHash, commit))
      .toThrow("unexpected package manifest");

    const unrelatedFile = validManifest();
    unrelatedFile.packages[0]!.files.push({
      path: "placeholder.txt",
      size: 1,
      mode: 420,
    });
    expect(() => validateReleaseManifest(unrelatedFile, commit))
      .toThrow("unsafe package contents");
  });

  it("allows bootstrap only while every package name is absent", async () => {
    const absent = await checkRegistryEmpty(async () => new Response(
      JSON.stringify({ error: "Not found" }),
      { status: 404 },
    ));
    expect(absent).toEqual(RELEASE_PACKAGES.map((entry) => ({
      name: entry.name,
      status: 404,
      state: "absent",
    })));

    await expect(checkRegistryEmpty(async (url) => new Response(
      JSON.stringify({
        name: decodeURIComponent(new URL(url).pathname.slice(1)),
        versions: {},
      }),
      { status: 200 },
    ))).rejects.toThrow("already exists");

    await expect(checkRegistryEmpty(async () => new Response(
      "registry unavailable",
      { status: 503 },
    ))).rejects.toThrow("registry lookup failed");
  });

  it("verifies the exact evidence file set, checksums, tar members, and package identity", async () => {
    const root = await mkdtemp(join(tmpdir(), "prooftape-bootstrap-test-"));
    temporaryDirectories.push(root);
    const evidence = join(root, "release");
    await mkdir(evidence);
    const expectedPackages = [];
    const manifestPackages = [];

    for (const entry of RELEASE_PACKAGES) {
      const staging = join(root, entry.filename);
      await mkdir(join(staging, "package", "dist"), { recursive: true });
      const repositoryDirectory = entry.name === "prooftape"
        ? "packages/cli"
        : `packages/${entry.name.slice("@prooftape/".length)}`;
      const internalDependencies = {
        "@prooftape/schema": {},
        "@prooftape/core": {
          "@prooftape/schema": entry.version,
        },
        "@prooftape/hook": {
          "@prooftape/core": entry.version,
          "@prooftape/schema": entry.version,
        },
        "prooftape": {
          "@prooftape/core": entry.version,
          "@prooftape/hook": entry.version,
          "@prooftape/schema": entry.version,
        },
      }[entry.name]!;
      const packageJson = {
        name: entry.name,
        version: entry.version,
        repository: {
          type: "git",
          url: "git+https://github.com/DelshadH/prooftape.git",
          directory: repositoryDirectory,
        },
        dependencies: internalDependencies,
      };
      const files = {
        "LICENSE": "license\n",
        "README.md": "readme\n",
        "dist/index.js": "export {};\n",
        "package.json": `${JSON.stringify(packageJson, null, 2)}\n`,
      };
      for (const [path, contents] of Object.entries(files)) {
        await writeFile(join(staging, "package", path), contents);
      }
      const tarball = join(evidence, entry.filename);
      const packed = spawnSync(
        "tar",
        [
          "-czf",
          tarball,
          "-C",
          staging,
          "package/LICENSE",
          "package/README.md",
          "package/dist/index.js",
          "package/package.json",
        ],
        { encoding: "utf8", shell: false, windowsHide: true },
      );
      expect(packed.status, packed.stderr).toBe(0);
      const sha256 = digest(await readFile(tarball));
      expectedPackages.push({ ...entry, sha256 });
      manifestPackages.push({
        ...entry,
        sha256,
        size: (await stat(tarball)).size,
        files: await Promise.all(Object.entries(files).map(async ([path]) => ({
          path,
          size: (await stat(join(staging, "package", path))).size,
          mode: 420,
        }))),
      });
    }

    const manifest = {
      ...validManifest(),
      packages: manifestPackages,
    };
    const manifestText = `${JSON.stringify(manifest, null, 2)}\n`;
    const sbom = "{\"bomFormat\":\"CycloneDX\",\"specVersion\":\"1.6\"}\n";
    const smoke = JSON.stringify({
      schemaVersion: "1",
      kind: "prooftape-release-smoke",
      version: "0.1.0-alpha.1",
      observationAuthenticity: "not-established",
      smoke: {},
    }) + "\n";
    await writeFile(join(evidence, "package-manifest.json"), manifestText);
    await writeFile(join(evidence, "sbom.cdx.json"), sbom);
    await writeFile(join(evidence, "smoke-results.json"), smoke);
    const checksumLines = [
      ...expectedPackages.map((entry) => `${entry.sha256}  ${entry.filename}`),
      `${digest(manifestText)}  package-manifest.json`,
      `${digest(sbom)}  sbom.cdx.json`,
      `${digest(smoke)}  smoke-results.json`,
    ];
    await writeFile(
      join(evidence, "SHA256SUMS"),
      `${checksumLines.join("\n")}\n`,
    );

    const result = await verifyEvidenceDirectory(
      evidence,
      commit,
      expectedPackages,
    );
    expect(result.packages).toEqual(expectedPackages);

    await writeFile(join(evidence, "unexpected.txt"), "not retained\n");
    await expect(verifyEvidenceDirectory(evidence, commit, expectedPackages))
      .rejects.toThrow("unexpected release evidence file set");
  });

  it("binds registry hashes and provenance to the bootstrap workflow, tag, and commit", () => {
    const entry = RELEASE_PACKAGES[0]!;
    const tarball = Buffer.from("reviewed package bytes");
    const publishedEntry = { ...entry, sha256: digest(tarball) };
    const sha512Hex = createHash("sha512").update(tarball).digest("hex");
    const sha512Base64 = createHash("sha512").update(tarball).digest("base64");
    const sha1 = createHash("sha1").update(tarball).digest("hex");
    const provenance = {
      _type: "https://in-toto.io/Statement/v1",
      subject: [{
        name: `pkg:npm/%40prooftape/schema@${entry.version}`,
        digest: { sha512: sha512Hex },
      }],
      predicateType: "https://slsa.dev/provenance/v1",
      predicate: {
        buildDefinition: {
          externalParameters: {
            workflow: {
              ref: "refs/tags/v0.1.0-alpha.1",
              repository: "https://github.com/DelshadH/prooftape",
              path: ".github/workflows/npm-bootstrap.yml",
            },
          },
          resolvedDependencies: [{
            uri: "git+https://github.com/DelshadH/prooftape@refs/tags/v0.1.0-alpha.1",
            digest: { gitCommit: commit },
          }],
        },
        runDetails: {
          builder: {
            id: "https://github.com/actions/runner/github-hosted",
          },
        },
      },
    };
    const attestationUrl =
      `https://registry.npmjs.org/-/npm/v1/attestations/`
      + `${encodeURIComponent(entry.name)}@${entry.version}`;
    const packument = {
      name: entry.name,
      "dist-tags": { alpha: entry.version },
      versions: {
        [entry.version]: {
          name: entry.name,
          version: entry.version,
          repository: {
            type: "git",
            url: "git+https://github.com/DelshadH/prooftape.git",
            directory: "packages/schema",
          },
          dist: {
            integrity: `sha512-${sha512Base64}`,
            shasum: sha1,
            tarball: `https://registry.npmjs.org/${entry.filename}`,
            attestations: {
              url: attestationUrl,
              provenance: {
                predicateType: "https://slsa.dev/provenance/v1",
              },
            },
          },
        },
      },
    };
    const attestations = {
      attestations: [{
        predicateType: "https://slsa.dev/provenance/v1",
        bundle: {
          dsseEnvelope: {
            payloadType: "application/vnd.in-toto+json",
            payload: Buffer.from(JSON.stringify(provenance)).toString("base64"),
            signatures: [{ sig: "present" }],
          },
        },
      }],
    };

    expect(validatePublishedPackage(
      publishedEntry,
      tarball,
      packument,
      attestations,
      commit,
    )).toMatchObject({
      name: entry.name,
      version: entry.version,
      alphaTag: entry.version,
      provenanceCommit: commit,
    });

    packument.versions[entry.version]!.repository.url =
      "git+https://github.com/attacker/replacement.git";
    expect(() => validatePublishedPackage(
      publishedEntry,
      tarball,
      packument,
      attestations,
      commit,
    )).toThrow("repository identity");
  });

  it("records partial publication as a non-rerunnable incident", () => {
    const report = buildPublicationIncident({
      expectedCommit: commit,
      failedPhase: "publish",
      failedPackage: "@prooftape/hook",
      attemptedPackages: [
        "@prooftape/schema",
        "@prooftape/core",
        "@prooftape/hook",
      ],
      revocationAttempted: true,
      revocationSucceeded: true,
      registryStates: [
        { name: "@prooftape/schema", versionExists: true, lookup: "known" },
        { name: "@prooftape/core", versionExists: true, lookup: "known" },
        { name: "@prooftape/hook", versionExists: false, lookup: "known" },
        { name: "prooftape", versionExists: false, lookup: "known" },
      ],
    });

    expect(report).toMatchObject({
      kind: "prooftape-npm-bootstrap-incident",
      severity: "release-incident",
      partialPublication: true,
      rerunAllowed: false,
      failedPackage: "@prooftape/hook",
      publishedPackages: ["@prooftape/schema", "@prooftape/core"],
    });
  });

  it("distinguishes retryable authentication from irreversible token-revocation failure", () => {
    const absentRegistry = RELEASE_PACKAGES.map((entry) => ({
      name: entry.name,
      versionExists: false,
      lookup: "known",
    }));
    expect(buildPublicationIncident({
      expectedCommit: commit,
      failedPhase: "authentication",
      attemptedPackages: [],
      revocationAttempted: true,
      revocationSucceeded: true,
      registryStates: absentRegistry,
    })).toMatchObject({
      kind: "prooftape-npm-bootstrap-incident",
      failedPhase: "authentication",
      failedPackage: null,
      partialPublication: false,
      rerunAllowed: true,
    });

    expect(buildPublicationIncident({
      expectedCommit: commit,
      failedPhase: "token-revocation",
      attemptedPackages: RELEASE_PACKAGES.map((entry) => entry.name),
      revocationAttempted: true,
      revocationSucceeded: false,
      registryStates: absentRegistry,
    })).toMatchObject({
      kind: "prooftape-npm-bootstrap-incident",
      failedPhase: "token-revocation",
      failedPackage: null,
      partialPublication: false,
      publicationState: "not-observed",
      rerunAllowed: false,
    });
  });

  it("preserves unknown registry state when incident enrichment is unavailable", async () => {
    const states = await queryRegistryStates(async () => new Response(
      "temporarily unavailable",
      { status: 503 },
    ));

    expect(states).toEqual(RELEASE_PACKAGES.map((entry) => ({
      name: entry.name,
      versionExists: null,
      lookup: "unknown",
      reason: "registry lookup failed with HTTP 503",
    })));
    expect(buildPublicationIncident({
      expectedCommit: commit,
      failedPhase: "publish",
      failedPackage: "@prooftape/core",
      attemptedPackages: ["@prooftape/schema", "@prooftape/core"],
      revocationAttempted: true,
      revocationSucceeded: true,
      registryStates: states,
    })).toMatchObject({
      severity: "release-incident",
      registryStateUnknown: true,
      rerunAllowed: false,
    });
  });

  it("records irreversible post-publication verification failure as non-rerunnable", () => {
    const report = buildPublicationIncident({
      expectedCommit: commit,
      failedPhase: "postpublish-verification",
      verificationStage: "registry-provenance-signatures",
      attemptedPackages: RELEASE_PACKAGES.map((entry) => entry.name),
      revocationAttempted: true,
      revocationSucceeded: true,
      registryStates: RELEASE_PACKAGES.map((entry) => ({
        name: entry.name,
        versionExists: true,
        lookup: "known",
      })),
    });

    expect(report).toMatchObject({
      kind: "prooftape-npm-bootstrap-incident",
      failedPhase: "postpublish-verification",
      verificationStage: "registry-provenance-signatures",
      publicationState: "complete",
      attemptedPackages: RELEASE_PACKAGES.map((entry) => entry.name),
      revocationSucceeded: true,
      rerunAllowed: false,
    });
  });

  it("keeps registry and provenance propagation retries finite and near five minutes", async () => {
    let verificationAttempts = 0;
    const waits: number[] = [];
    const result = await verifyPublishedRegistryWithRetry(commit, {
      maximumAttempts: 31,
      retryDelayMilliseconds: 10_000,
      verify: async () => {
        verificationAttempts += 1;
        if (verificationAttempts < 3) throw new Error("not propagated");
        return [{ passed: true }];
      },
      wait: async (milliseconds) => {
        waits.push(milliseconds);
      },
    });

    expect(result).toEqual([{ passed: true }]);
    expect(verificationAttempts).toBe(3);
    expect(waits).toEqual([10_000, 10_000]);
  });

  it("includes registry request time inside the absolute five-minute deadline", async () => {
    let nowMilliseconds = 0;
    let verificationAttempts = 0;
    const waits: number[] = [];

    await expect(verifyPublishedRegistryWithRetry(commit, {
      maximumAttempts: 31,
      maximumDurationMilliseconds: 300_000,
      retryDelayMilliseconds: 10_000,
      now: () => nowMilliseconds,
      verify: async () => {
        verificationAttempts += 1;
        nowMilliseconds += 15_000;
        throw new Error("not propagated");
      },
      wait: async (milliseconds) => {
        waits.push(milliseconds);
        nowMilliseconds += milliseconds;
      },
    })).rejects.toThrow("five-minute deadline");

    expect(nowMilliseconds).toBeLessThanOrEqual(300_000);
    expect(verificationAttempts).toBeLessThan(31);
    expect(waits.reduce((total, milliseconds) => total + milliseconds, 0))
      .toBeLessThan(300_000);
  });
});
