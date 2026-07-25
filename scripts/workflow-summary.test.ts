import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import {
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  rm,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import type { ReportV1 } from "@prooftape/schema";
import { renderWorkflowSummary } from "./workflow-summary.mjs";

const report: ReportV1 = {
  schemaVersion: "1",
  kind: "prooftape-report",
  dependency: "fixture|name",
  verdict: "no-blocking-differences-observed",
  blockingDifferenceCount: 0,
  warningCount: 0,
  baseline: {
    capsuleHash: "b".repeat(64),
    commitSha: "a".repeat(40),
    lockfileSha256: "c".repeat(64),
    dependencyVersion: "1.0.0",
    observationAuthenticity: "not-established",
  },
  candidate: {
    capsuleHash: "e".repeat(64),
    commitSha: "f".repeat(40),
    lockfileSha256: "d".repeat(64),
    dependencyVersion: "2.0.0",
    observationAuthenticity: "not-established",
  },
  differences: [],
};

describe("workflow trust summary", () => {
  it("names transport, structure, authorship, and the exact comparison result", () => {
    const summary = renderWorkflowSummary(report, 0, {
      baseArtifactSha256: "7".repeat(64),
      candidateArtifactSha256: "8".repeat(64),
    });

    expect(summary).toContain(
      "**Observation authenticity is not established.**",
    );
    expect(summary).toContain(`| Base commit | \`${"a".repeat(40)}\` |`);
    expect(summary).toContain(`| Candidate commit | \`${"f".repeat(40)}\` |`);
    expect(summary).toContain("| Dependency | `fixture\\|name` |");
    expect(summary).toContain("| Base dependency version | `1.0.0` |");
    expect(summary).toContain("| Candidate dependency version | `2.0.0` |");
    expect(summary).toContain(
      `| Base canonical capsule SHA-256 | \`${"b".repeat(64)}\` |`,
    );
    expect(summary).toContain(
      `| Candidate canonical capsule SHA-256 | \`${"e".repeat(64)}\` |`,
    );
    expect(summary).toContain(
      `| Base artifact transport SHA-256 | \`${"7".repeat(64)}\` |`,
    );
    expect(summary).toContain(
      `| Candidate artifact transport SHA-256 | \`${"8".repeat(64)}\` |`,
    );
    expect(summary).toContain(
      "| Verdict | `no-blocking-differences-observed` |",
    );
    expect(summary).toContain("| Exit code | `0` |");
    expect(summary).toContain(
      "Capsule structure was validated before observations were compared.",
    );
    expect(summary).toContain(
      "Base protection and transport integrity do not establish observation authorship.",
    );
  });

  it("writes the rendered summary in the real verifier path", async () => {
    const repository = resolve(import.meta.dirname, "..");
    const directory = await mkdtemp(join(tmpdir(), "prooftape-summary-"));
    try {
      const baseDirectory = join(directory, "base");
      const candidateDirectory = join(directory, "candidate");
      await mkdir(baseDirectory);
      await mkdir(candidateDirectory);
      const golden = resolve(repository, "fixtures/schema/capsule-v1.json");
      const baseCapsule = join(baseDirectory, "capsule.ptape");
      const candidateCapsule = join(candidateDirectory, "capsule.ptape");
      await copyFile(golden, baseCapsule);
      await copyFile(golden, candidateCapsule);
      const bytes = await readFile(golden);
      const capsuleHash = createHash("sha256").update(bytes).digest("hex");
      const summaryPath = join(directory, "step-summary.md");

      const result = spawnSync(
        process.execPath,
        ["scripts/workflow-verify.mjs"],
        {
          cwd: repository,
          encoding: "utf8",
          env: {
            ...process.env,
            GITHUB_STEP_SUMMARY: summaryPath,
            PROOFTAPE_BASE_CAPSULE_SHA256: capsuleHash,
            PROOFTAPE_CANDIDATE_CAPSULE_SHA256: capsuleHash,
            PROOFTAPE_VERIFY_DIRECTORY: directory,
          },
          timeout: 30_000,
          maxBuffer: 2 * 1024 * 1024,
          windowsHide: true,
          shell: false,
        },
      );

      expect(result.status, result.stderr).toBe(0);
      expect(await readFile(summaryPath, "utf8")).toContain(
        "**Observation authenticity is not established.**",
      );
      await expect(readFile(join(directory, "exit-code.txt"), "utf8"))
        .resolves.toBe("0\n");
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
