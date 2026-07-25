import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { readFile, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { auditReleaseWorkflow } from "./release-workflow-policy.mjs";

const repository = resolve(import.meta.dirname, "..");
const identifier = randomUUID();
const output = `.evidence/security-rerun-${identifier}.json`;
const outputPath = resolve(repository, output);
const outsideOutput = `scripts/security-rerun-${identifier}.json`;
const outsideOutputPath = resolve(repository, outsideOutput);

afterEach(async () => {
  await rm(outputPath, { force: true });
  await rm(outsideOutputPath, { force: true });
});

function runAudit(outputArgument: string, replace = false) {
  return spawnSync(
    process.execPath,
    [
      "scripts/security-audit.mjs",
      "--out",
      outputArgument,
      ...(replace ? ["--replace"] : []),
    ],
    {
      cwd: repository,
      encoding: "utf8",
      shell: false,
      windowsHide: true,
    },
  );
}

describe("quality-gate evidence output", () => {
  it("requires a protected tokenless OIDC release workflow", async () => {
    const result = runAudit(output, true);
    expect(result.status, result.stderr).toBe(0);

    const report = JSON.parse(await readFile(outputPath, "utf8"));
    expect(report.releaseWorkflow).toEqual({
      path: ".github/workflows/release.yml",
      version: "0.1.0-alpha.1",
      manualDispatch: true,
      contentsRead: true,
      oidc: true,
      protectedEnvironment: "npm-release",
      exactTag: "v0.1.0-alpha.1",
      tagBoundRun: true,
      reviewableEvidenceBeforePublish: true,
      oidcIsolatedToPublish: true,
      tokenless: true,
      provenancePublish: true,
      passed: true,
    });
  });

  it("fails closed for weakened release identity, permissions, pins, or auth", async () => {
    const workflow = await readFile(
      resolve(repository, ".github/workflows/release.yml"),
      "utf8",
    );
    expect(auditReleaseWorkflow(workflow, "0.1.0-alpha.1").report.passed)
      .toBe(true);

    const weakened = [
      workflow.replace("id-token: write", "id-token: read"),
      `${workflow}\nenv:\n  NODE_AUTH_TOKEN: forbidden\n`,
      workflow.replace(
        "actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1",
        "actions/checkout@v7",
      ),
      workflow.replace(
        "default: v0.1.0-alpha.1",
        "default: v0.1.0-alpha.2",
      ),
      workflow.replace("ref: ${{ inputs.tag }}", "ref: main"),
      workflow.replace(
        "PROOFTAPE_RELEASE_REF: ${{ github.ref }}",
        "PROOFTAPE_RELEASE_REF: refs/heads/main",
      ),
      workflow.replace("needs: prepare", "needs: []"),
      workflow.replace(
        "permissions:\n  contents: read",
        "permissions:\n  contents: read\n  id-token: write",
      ),
    ];
    for (const candidate of weakened) {
      expect(auditReleaseWorkflow(candidate, "0.1.0-alpha.1").report.passed)
        .toBe(false);
    }

    const releasing = await readFile(resolve(repository, "RELEASING.md"), "utf8");
    expect(releasing).toContain(
      "Publishing from a developer workstation is prohibited.",
    );
    expect(releasing).not.toMatch(/^\s*npm publish\b/mu);
  });

  it("replaces stale evidence when a fixed-path gate is rerun", async () => {
    const first = runAudit(output, true);
    expect(first.status, first.stderr).toBe(0);

    await writeFile(outputPath, "stale evidence\n");

    const second = runAudit(output, true);
    expect(second.status, second.stderr).toBe(0);

    const report = JSON.parse(await readFile(outputPath, "utf8"));
    expect(report.kind).toBe("prooftape-security-audit");
    expect(report.passed).toBe(true);
  });

  it("keeps explicit outputs create-only without replacement", async () => {
    await writeFile(outputPath, "existing evidence\n");

    const result = runAudit(output);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("EEXIST");
    await expect(readFile(outputPath, "utf8")).resolves.toBe("existing evidence\n");
  });

  it("limits replacement to the ignored evidence directory", async () => {
    const result = runAudit(outsideOutput, true);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain(
      "--replace is limited to files inside .evidence",
    );
    await expect(readFile(outsideOutputPath, "utf8")).rejects.toMatchObject({
      code: "ENOENT",
    });
  });
});
