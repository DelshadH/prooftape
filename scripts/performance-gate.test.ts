import { spawnSync } from "node:child_process";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const repository = resolve(import.meta.dirname, "..");

describe("performance gate", () => {
  it("removes its temporary fixture and raw observations", async () => {
    const temporaryRoot = await mkdtemp(
      join(tmpdir(), "prooftape-performance-cleanup-test-"),
    );
    try {
      const result = spawnSync(
        process.execPath,
        ["scripts/performance-gate.mjs"],
        {
          cwd: repository,
          encoding: "utf8",
          env: {
            ...process.env,
            TEMP: temporaryRoot,
            TMP: temporaryRoot,
            TMPDIR: temporaryRoot,
          },
          shell: false,
          windowsHide: true,
        },
      );

      expect([0, 1]).toContain(result.status);
      expect(result.stderr).toBe("");
      expect(JSON.parse(result.stdout)).toMatchObject({
        schemaVersion: "1",
        kind: "prooftape-performance-report",
        passed: expect.any(Boolean),
      });
      await expect(readdir(temporaryRoot)).resolves.toEqual([]);
    } finally {
      await rm(temporaryRoot, { recursive: true, force: true });
    }
  });

  it("removes temporary observations when evidence output is rejected", async () => {
    const temporaryRoot = await mkdtemp(
      join(tmpdir(), "prooftape-performance-cleanup-test-"),
    );
    try {
      const result = spawnSync(
        process.execPath,
        [
          "scripts/performance-gate.mjs",
          "--out",
          "performance.json",
          "--replace",
        ],
        {
          cwd: repository,
          encoding: "utf8",
          env: {
            ...process.env,
            TEMP: temporaryRoot,
            TMP: temporaryRoot,
            TMPDIR: temporaryRoot,
          },
          shell: false,
          windowsHide: true,
        },
      );

      expect(result.status).toBe(1);
      expect(result.stderr).toContain(
        "--replace is limited to files inside .evidence",
      );
      await expect(readdir(temporaryRoot)).resolves.toEqual([]);
    } finally {
      await rm(temporaryRoot, { recursive: true, force: true });
    }
  });
});
