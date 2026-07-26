import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  parseReproductionManifest,
  type CallObservationV1,
  type CapsuleV1,
} from "@prooftape/schema";
import { buildReport, generateReproduction } from "../src/index.js";

function capsule(value: string, version: string, commit: string): CapsuleV1 {
  return {
    schemaVersion: "1",
    kind: "prooftape-capsule",
    metadata: {
      commitSha: commit.repeat(40),
      lockfileSha256: (commit === "a" ? "b" : "d").repeat(64),
      nodeVersion: process.version,
      platform: process.platform,
      arch: process.arch,
      command: [process.execPath, "test.mjs"],
      dependency: {
        name: "fixture",
        version,
        entry: "node_modules/fixture/index.js",
      },
      prooftapeVersion: "0.0.0",
      configurationSha256: "c".repeat(64),
      observationAuthenticity: "not-established",
    },
    calls: [{
      schemaVersion: "1",
      callId: "p1:1",
      sequence: 1,
      processId: "p1",
      dependency: "fixture",
      exportPath: "value",
      callSiteFingerprint: "test.mjs:run",
      moduleKind: "esm",
      receiverKind: "none",
      moduleSpecifier: "fixture",
      targetKind: "export",
      argsBefore: [2],
      argsAfter: [2],
      outcome: "return",
      value,
    }],
    issues: [],
  };
}

async function installedFixture(value: string): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "prooftape-repro-env-"));
  const dependency = join(directory, "node_modules", "fixture");
  await mkdir(dependency, { recursive: true });
  await writeFile(join(directory, "package.json"), JSON.stringify({ type: "module" }));
  await writeFile(
    join(dependency, "package.json"),
    JSON.stringify({ name: "fixture", version: "1.0.0", type: "module", exports: "./index.js" }),
  );
  const source = value === "before"
    ? 'export function value(input) { return "before"; }\n'
    : value === "after"
      ? 'export function value(input) { return "after"; }\n'
      : undefined;
  if (!source) throw new Error("unknown reproduction fixture value");
  await writeFile(join(dependency, "index.js"), source);
  return directory;
}

async function installedCommonJsFixture(value: string): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "prooftape-repro-cjs-"));
  const dependency = join(directory, "node_modules", "fixture");
  await mkdir(dependency, { recursive: true });
  await writeFile(join(directory, "package.json"), JSON.stringify({ type: "module" }));
  await writeFile(
    join(dependency, "package.json"),
    JSON.stringify({ name: "fixture", version: "1.0.0", main: "./index.cjs" }),
  );
  await writeFile(
    join(dependency, "index.cjs"),
    `module.exports = { prefix: ${JSON.stringify(value)}, method(input) { return this.prefix + input; } };\n`,
  );
  return directory;
}

async function installedConditionalEsmFixture(value: string): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "prooftape-repro-conditional-"));
  const dependency = join(directory, "node_modules", "fixture");
  await mkdir(dependency, { recursive: true });
  await writeFile(join(directory, "package.json"), JSON.stringify({ type: "module" }));
  await writeFile(
    join(dependency, "package.json"),
    JSON.stringify({
      name: "fixture",
      version: "1.0.0",
      type: "module",
      exports: {
        import: "./import.js",
        require: "./require.cjs",
      },
    }),
  );
  await writeFile(
    join(dependency, "import.js"),
    `export function value() { return ${JSON.stringify(value)}; }\n`,
  );
  await writeFile(
    join(dependency, "require.cjs"),
    'module.exports = { value() { return "wrong-require-branch"; } };\n',
  );
  return directory;
}

describe("generateReproduction", () => {
  it("creates a versioned reproduction that matches base and fails candidate", async () => {
    const base = capsule("before", "1.0.0", "a");
    const candidate = capsule("after", "2.0.0", "e");
    const report = buildReport(base, candidate);
    const root = await mkdtemp(join(tmpdir(), "prooftape-repro-"));
    const directory = join(root, "repro");

    const evidence = await generateReproduction(base, candidate, report, directory);

    expect(evidence.manifestSha256).toMatch(/^[a-f0-9]{64}$/);
    const manifest = parseReproductionManifest(
      await readFile(join(directory, "manifest.json")),
    );
    expect(manifest).toMatchObject({
      kind: "prooftape-reproduction-manifest",
      observationAuthenticity: "not-established",
    });
    for (const [filename, expectedHash] of Object.entries(manifest.files)) {
      const bytes = await readFile(join(directory, filename));
      expect(createHash("sha256").update(bytes).digest("hex")).toBe(expectedHash);
    }
    expect(await readFile(join(directory, "README.md"), "utf8")).toContain(
      "Observation authenticity is not established",
    );
    const baseEnvironment = await installedFixture("before");
    const candidateEnvironment = await installedFixture("after");
    const baseRun = spawnSync(process.execPath, [join(directory, "repro.mjs")], {
      cwd: baseEnvironment,
      encoding: "utf8",
      windowsHide: true,
    });
    const candidateRun = spawnSync(process.execPath, [join(directory, "repro.mjs")], {
      cwd: candidateEnvironment,
      encoding: "utf8",
      windowsHide: true,
    });

    expect(baseRun.status, baseRun.stderr).toBe(0);
    expect(baseRun.stdout).toContain("matches baseline");
    expect(candidateRun.status, candidateRun.stderr).toBe(1);
    expect(candidateRun.stdout).toContain("differs from baseline");
  });

  it("refuses redacted or normalized counterexamples", async () => {
    const base = capsule("[REDACTED]", "1.0.0", "a");
    const candidate = capsule("after", "2.0.0", "e");
    const report = buildReport(base, candidate);
    const root = await mkdtemp(join(tmpdir(), "prooftape-repro-"));

    await expect(generateReproduction(base, candidate, report, join(root, "repro")))
      .rejects.toThrow(/safe reproduction/);
  });

  it("replays CommonJS member calls with their original receiver", async () => {
    const withInvocation = (
      source: CapsuleV1,
      value: string,
    ): CapsuleV1 => ({
      ...source,
      calls: [{
        ...source.calls[0]!,
        exportPath: "method",
        argsBefore: ["x"],
        argsAfter: ["x"],
        value,
        moduleKind: "commonjs",
        receiverKind: "parent",
        moduleSpecifier: "fixture",
        targetKind: "export",
      } as unknown as CallObservationV1],
    });
    const base = withInvocation(capsule("beforex", "1.0.0", "a"), "beforex");
    const candidate = withInvocation(capsule("afterx", "2.0.0", "e"), "afterx");
    const report = buildReport(base, candidate);
    const root = await mkdtemp(join(tmpdir(), "prooftape-repro-"));
    const directory = join(root, "repro");
    await generateReproduction(base, candidate, report, directory);
    const baseEnvironment = await installedCommonJsFixture("before");
    const candidateEnvironment = await installedCommonJsFixture("after");

    const baseRun = spawnSync(process.execPath, [join(directory, "repro.mjs")], {
      cwd: baseEnvironment,
      encoding: "utf8",
      windowsHide: true,
    });
    const candidateRun = spawnSync(process.execPath, [join(directory, "repro.mjs")], {
      cwd: candidateEnvironment,
      encoding: "utf8",
      windowsHide: true,
    });
    expect(baseRun.status, baseRun.stderr).toBe(0);
    expect(candidateRun.status, candidateRun.stderr).toBe(1);
  });

  it("distinguishes a CommonJS default member from the callable module", async () => {
    const withInvocation = (
      source: CapsuleV1,
      value: string,
    ): CapsuleV1 => ({
      ...source,
      calls: [{
        ...source.calls[0]!,
        exportPath: "default",
        argsBefore: ["x"],
        argsAfter: ["x"],
        value,
        moduleKind: "commonjs",
        receiverKind: "parent",
        moduleSpecifier: "fixture/subpath",
        targetKind: "export",
      }],
    });
    const base = withInvocation(capsule("beforex", "1.0.0", "a"), "beforex");
    const candidate = withInvocation(capsule("afterx", "2.0.0", "e"), "afterx");
    const report = buildReport(base, candidate);
    const root = await mkdtemp(join(tmpdir(), "prooftape-repro-"));
    const directory = join(root, "repro");
    await generateReproduction(base, candidate, report, directory);

    const environment = await mkdtemp(join(tmpdir(), "prooftape-repro-cjs-default-"));
    const dependency = join(environment, "node_modules", "fixture");
    await mkdir(dependency, { recursive: true });
    await writeFile(join(environment, "package.json"), JSON.stringify({ type: "module" }));
    await writeFile(
      join(dependency, "package.json"),
      JSON.stringify({
        name: "fixture",
        version: "1.0.0",
        exports: { "./subpath": "./subpath.cjs" },
      }),
    );
    await writeFile(
      join(dependency, "subpath.cjs"),
      'module.exports = { prefix: "before", default(input) { return this.prefix + input; } };\n',
    );

    const run = spawnSync(process.execPath, [join(directory, "repro.mjs")], {
      cwd: environment,
      encoding: "utf8",
      windowsHide: true,
    });
    expect(run.status, run.stderr).toBe(0);
  });

  it("replays the import branch of ESM conditional exports", async () => {
    const base = capsule("before", "1.0.0", "a");
    const candidate = capsule("after", "2.0.0", "e");
    const report = buildReport(base, candidate);
    const root = await mkdtemp(join(tmpdir(), "prooftape-repro-"));
    const directory = join(root, "repro");
    await generateReproduction(base, candidate, report, directory);
    const environment = await installedConditionalEsmFixture("before");

    const run = spawnSync(process.execPath, [join(directory, "repro.mjs")], {
      cwd: environment,
      encoding: "utf8",
      windowsHide: true,
    });
    expect(run.status, run.stderr).toBe(0);
  });
});
