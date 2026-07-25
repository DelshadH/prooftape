import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { readFile, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

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
