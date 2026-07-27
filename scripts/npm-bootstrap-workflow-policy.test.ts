import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { auditNpmBootstrapWorkflow } from "./npm-bootstrap-workflow-policy.mjs";

const repository = resolve(import.meta.dirname, "..");

describe("one-time npm first-publication workflow", () => {
  it("is manual and bound to the exact reviewed tag and expected main commit", async () => {
    const workflow = await readFile(
      resolve(repository, ".github/workflows/npm-bootstrap.yml"),
      "utf8",
    );

    const audit = auditNpmBootstrapWorkflow(workflow, "0.1.0-alpha.1");
    expect(audit.failures).toEqual([]);
    expect(audit.report).toMatchObject({
      path: ".github/workflows/npm-bootstrap.yml",
      version: "0.1.0-alpha.1",
      manualDispatch: true,
      exactTag: "v0.1.0-alpha.1",
      serialized: true,
      expectedCommitBound: true,
      tagOnMain: true,
      passed: true,
    });

    const concurrent = workflow.replace(
      "group: prooftape-npm-bootstrap-v0.1.0-alpha.1",
      "group: unprotected-bootstrap",
    );
    expect(
      auditNpmBootstrapWorkflow(concurrent, "0.1.0-alpha.1").report.serialized,
    ).toBe(false);
  });

  it("isolates the one-time token and OIDC permission to a protected publish job", async () => {
    const workflow = await readFile(
      resolve(repository, ".github/workflows/npm-bootstrap.yml"),
      "utf8",
    );

    const audit = auditNpmBootstrapWorkflow(workflow, "0.1.0-alpha.1");
    expect(audit.report).toMatchObject({
      protectedEnvironment: "npm-bootstrap",
      leastPrivilegePermissions: true,
      oidcIsolatedToPublish: true,
      tokenIsolatedToPublishStep: true,
      explicitPublishApproval: true,
      actionsPinned: true,
      publishIdentityRechecked: true,
      pinnedToolchain: true,
      passed: true,
    });

    for (const weakened of [
      workflow.replace("id-token: write", "id-token: read"),
      workflow.replace("environment: npm-bootstrap", "environment: unprotected"),
      workflow.replace(
        "permissions:\n  contents: read",
        "permissions:\n  contents: read\n  id-token: write",
      ),
      workflow.replace(
        "NODE_AUTH_TOKEN: ${{ secrets.NPM_BOOTSTRAP_TOKEN }}",
        "NODE_AUTH_TOKEN: hard-coded",
      ),
      workflow.replace(
        "actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1",
        "actions/checkout@v7",
      ),
      workflow.replace('node-version: "24.18.0"', "node-version: 24"),
      workflow.replace('NPM_VERSION: "11.16.0"', 'NPM_VERSION: "11.5.1"'),
      workflow.replace(
        'test "${PROOFTAPE_WORKFLOW_SHA}" = "${PROOFTAPE_EXPECTED_COMMIT}"',
        "true",
      ),
    ]) {
      expect(auditNpmBootstrapWorkflow(weakened, "0.1.0-alpha.1").report.passed)
        .toBe(false);
    }
  });

  it("runs the full evidence, publication, revocation, and incident contract", async () => {
    const workflow = await readFile(
      resolve(repository, ".github/workflows/npm-bootstrap.yml"),
      "utf8",
    );
    const audit = auditNpmBootstrapWorkflow(workflow, "0.1.0-alpha.1");
    expect(audit.report).toMatchObject({
      fullGates: true,
      twoCleanBuilds: true,
      exactEvidenceVerification: true,
      registryAbsencePreflight: true,
      hiddenReleaseEvidence: true,
      provenancePublishOrder: true,
      immediateTokenRevocation: true,
      tokenNotRetained: true,
      cryptographicProvenanceVerification: true,
      registryIdentityVerification: true,
      incidentHandling: true,
      postPublicationIncidentHandling: true,
      fiveMinutePropagationWindow: true,
      githubPrereleaseAfterVerification: true,
      nonRerunnable: true,
      passed: true,
    });

    for (const weakened of [
      workflow.replace("npm run smoke:package", "echo skipped-package-smoke"),
      workflow.replace("npm run smoke:examples", "echo skipped-examples"),
      workflow.replace("npm run demo", "echo skipped-demo"),
      workflow.replace("npm run demo:record", "echo skipped-demo-recording"),
      workflow.replace("npm run real-upgrades", "echo skipped-real-upgrades"),
      workflow.replace("npm run corpus", "echo skipped-corpus"),
      workflow.replace("npm run performance", "echo skipped-performance"),
      workflow.replace("npm run security", "echo skipped-security"),
      workflow.replace("npm run release:prepare", "echo skipped-release-build"),
      workflow.replace("--provenance --tag alpha", "--tag alpha"),
      workflow.replace("npm logout --registry=https://registry.npmjs.org/", "true"),
      workflow.replace(
        "trap finish_authenticated_step EXIT\n          npm whoami",
        "npm whoami\n          trap finish_authenticated_step EXIT",
      ),
      workflow.replace("set +x", "set -x"),
      workflow.replace("package-manager-cache: false", "package-manager-cache: true"),
      workflow.replace("npm audit signatures", "echo skipped-signatures"),
      workflow.replace(
        "--failed-phase postpublish-verification",
        "--failed-phase publish",
      ),
      workflow.replace(
        "POSTPUBLISH_MAX_ATTEMPTS: \"31\"",
        "POSTPUBLISH_MAX_ATTEMPTS: \"12\"",
      ),
      workflow.replace(
        "POSTPUBLISH_MAX_DURATION_MS: \"300000\"",
        "POSTPUBLISH_MAX_DURATION_MS: \"900000\"",
      ),
      workflow.replace(
        "gh release create",
        "echo skipped-github-release",
      ),
      workflow.replace(
        'receipt.expectedCommit !== process.env.PROOFTAPE_EXPECTED_COMMIT',
        "false",
      ),
      workflow.replace("if: ${{ failure() }}", "if: ${{ false }}"),
      workflow.replace(
        /(path: \.evidence\/npm-bootstrap-incident\.json\r?\n\s+if-no-files-found:) error/u,
        "$1 ignore",
      ),
    ]) {
      expect(auditNpmBootstrapWorkflow(weakened, "0.1.0-alpha.1").report.passed)
        .toBe(false);
    }
  });

  it("executes token revocation exactly once after a middle-package failure", async () => {
    const workflow = await readFile(
      resolve(repository, ".github/workflows/npm-bootstrap.yml"),
      "utf8",
    );
    const startMarker = "        run: |\n          set -euo pipefail\n";
    const endMarker =
      "      - name: Verify registry bytes, metadata, alpha tag, and provenance identity";
    const start = workflow.indexOf(startMarker);
    const end = workflow.indexOf(endMarker, start);
    expect(start).toBeGreaterThanOrEqual(0);
    expect(end).toBeGreaterThan(start);
    const script = workflow
      .slice(start + "        run: |\n".length, end)
      .split(/\r?\n/u)
      .map((line) => line.startsWith("          ") ? line.slice(10) : line)
      .join("\n");

    const fixture = await mkdtemp(join(tmpdir(), "prooftape-npm-bootstrap-"));
    try {
      const callLog = join(fixture, "calls.log");
      const npmStub = join(fixture, "npm");
      const nodeStub = join(fixture, "node");
      await writeFile(npmStub, `#!/usr/bin/env bash
echo "$*" >> "$PROOFTAPE_CALL_LOG"
if [[ "$1" == "publish" && "$2" == *"prooftape-core"* ]]; then exit 42; fi
exit 0
`, "utf8");
      await writeFile(nodeStub, `#!/usr/bin/env bash
echo "incident $*" >> "$PROOFTAPE_CALL_LOG"
exit 0
`, "utf8");
      await chmod(npmStub, 0o755);
      await chmod(nodeStub, 0o755);

      const bashExecutable = process.platform === "win32"
        ? join(
            process.env.ProgramFiles ?? "C:\\Program Files",
            "Git",
            "bin",
            "bash.exe",
          )
        : "bash";
      const fixturePath = fixture.replaceAll("\\", "/");
      const result = spawnSync(bashExecutable, ["-c", script], {
        cwd: repository,
        encoding: "utf8",
        env: {
          ...process.env,
          PATH: process.platform === "win32"
            ? `${fixture};${process.env.PATH ?? ""}`
            : `${fixturePath}:${process.env.PATH ?? ""}`,
          PROOFTAPE_CALL_LOG: callLog.replaceAll("\\", "/"),
          PROOFTAPE_EXPECTED_COMMIT:
            "47e603559ee57587be7285917dc1fbfc898da450",
        },
        shell: false,
      });
      expect(result.status, result.stderr).toBe(42);
      const calls = await readFile(callLog, "utf8");
      expect(calls.match(/^logout --registry=https:\/\/registry\.npmjs\.org\/$/gmu))
        .toHaveLength(1);
      expect(calls).toContain("incident scripts/npm-bootstrap-verify.mjs incident");
      expect(calls).toContain("--failed-phase publish");
    } finally {
      await rm(fixture, { recursive: true, force: true });
    }
  });
});
