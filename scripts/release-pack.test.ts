import { spawnSync } from "node:child_process";
import {
  cp,
  mkdtemp,
  readFile,
  readdir,
  rm,
  symlink,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const repository = resolve(import.meta.dirname, "..");

function run(executable: string, args: readonly string[], cwd: string) {
  return spawnSync(executable, args, {
    cwd,
    encoding: "utf8",
    timeout: 180_000,
    maxBuffer: 4 * 1024 * 1024,
    windowsHide: true,
    shell: false,
  });
}

describe("release-pack", () => {
  it("builds bounded alpha artifacts in a clean checkout", async () => {
    const temporary = await mkdtemp(join(tmpdir(), "prooftape-release-test-"));
    const checkout = join(temporary, "checkout");
    try {
      await cp(repository, checkout, {
        recursive: true,
        filter: (source) => {
          const name = basename(source);
          return (
            ![".git", ".evidence", "coverage", "dist", "node_modules"].includes(name)
            && !name.endsWith(".tsbuildinfo")
          );
        },
      });
      await symlink(
        join(repository, "node_modules"),
        join(checkout, "node_modules"),
        process.platform === "win32" ? "junction" : "dir",
      );
      expect(run("git", ["init", "-q"], checkout).status).toBe(0);
      expect(run("git", ["add", "."], checkout).status).toBe(0);
      expect(run("git", [
        "-c",
        "user.name=ProofTape",
        "-c",
        "user.email=release@example.invalid",
        "commit",
        "-qm",
        "release fixture",
      ], checkout).status).toBe(0);

      const result = run(process.execPath, [
        "scripts/release-pack.mjs",
        "--out",
        ".evidence/release-test",
        "--replace",
      ], checkout);
      expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);

      const output = join(checkout, ".evidence", "release-test");
      const packageManifest = JSON.parse(
        await readFile(join(output, "package-manifest.json"), "utf8"),
      );
      const smokeResults = JSON.parse(
        await readFile(join(output, "smoke-results.json"), "utf8"),
      );
      const sbomText = await readFile(join(output, "sbom.cdx.json"), "utf8");
      const sbom = JSON.parse(sbomText);
      expect({
        version: packageManifest.version,
        packages: packageManifest.packages.map(
          (entry: { name: string }) => entry.name,
        ),
        smoke: smokeResults.smoke,
      }).toEqual({
        version: "0.1.0-alpha.1",
        packages: [
          "@prooftape/schema",
          "@prooftape/core",
          "@prooftape/hook",
          "prooftape",
        ],
        smoke: {
          help: 0,
          version: 0,
          record: 0,
          diffChanged: 2,
          diffUnchanged: 0,
          compareChanged: 2,
          invalidInput: 4,
          unsupportedInput: 4,
        },
      });
      expect(await readdir(output)).toEqual(expect.arrayContaining([
        "SHA256SUMS",
        "package-manifest.json",
        "sbom.cdx.json",
        "smoke-results.json",
      ]));
      expect((await readdir(output)).filter((name) => name.endsWith(".tgz")))
        .toHaveLength(4);
      expect(sbom.components?.some(
        (component: { name?: string }) => component.name === "fixture",
      )).toBe(false);
      expect(sbomText).not.toMatch(/file:[A-Za-z]:[\\/]|file:\/(?:tmp|private\/tmp)\//u);
      expect(sbomText).not.toContain("prooftape-release-pack-");
    } finally {
      await rm(temporary, { recursive: true, force: true });
    }
  }, 240_000);
});
