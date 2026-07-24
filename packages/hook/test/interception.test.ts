import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";

interface RunResult {
  readonly status: number | null;
  readonly stdout: string;
  readonly stderr: string;
}

async function writeFixture(
  format: "esm" | "cjs",
): Promise<{ app: string; directory: string; output: string }> {
  const directory = await mkdtemp(join(tmpdir(), `prooftape-${format}-`));
  const dependencyDirectory = join(directory, "node_modules", "fixture");
  const output = join(directory, "observations");
  await mkdir(dependencyDirectory, { recursive: true });
  await mkdir(output);

  if (format === "esm") {
    await writeFile(
      join(dependencyDirectory, "package.json"),
      JSON.stringify({ name: "fixture", version: "1.0.0", type: "module", exports: "./index.js" }),
    );
    await writeFile(
      join(dependencyDirectory, "index.js"),
      [
        "export function add(left, right) { return left + right; }",
        "export const toolbox = {",
        '  marker: "kept",',
        "  bump(input) { input.count += 1; return this.marker; },",
        "};",
        "export async function later(value) { return { value }; }",
      ].join("\n"),
    );
    const app = join(directory, "app.mjs");
    await writeFile(
      app,
      [
        'import { add, toolbox, later } from "fixture";',
        "const same = add;",
        "const descriptor = Object.getOwnPropertyDescriptor(add, 'length');",
        "const input = { count: 1 };",
        "const output = {",
        "  same: same === add,",
        "  length: descriptor?.value,",
        "  total: add(2, 3),",
        "  marker: toolbox.bump(input),",
        "  input,",
        "  asyncValue: await later(7),",
        "};",
        "process.stdout.write(JSON.stringify(output));",
      ].join("\n"),
    );
    return { app, directory, output };
  }

  await writeFile(
    join(dependencyDirectory, "package.json"),
    JSON.stringify({ name: "fixture", version: "1.0.0", main: "./index.cjs" }),
  );
  await writeFile(
    join(dependencyDirectory, "index.cjs"),
    [
      "function fixture(value) { return value * 2; }",
      "fixture.add = function add(left, right) { return left + right; };",
      "module.exports = fixture;",
    ].join("\n"),
  );
  const app = join(directory, "app.cjs");
  await writeFile(
    app,
    [
      'const fixture = require("fixture");',
      "const same = fixture;",
      "const descriptor = Object.getOwnPropertyDescriptor(fixture, 'length');",
      "process.stdout.write(JSON.stringify({",
      "  same: same === fixture,",
      "  length: descriptor?.value,",
      "  direct: fixture(4),",
      "  member: fixture.add(2, 5),",
      "}));",
    ].join("\n"),
  );
  return { app, directory, output };
}

function run(app: string, directory: string, config?: Record<string, unknown>): RunResult {
  const register = pathToFileURL(resolve("packages/hook/dist/register.js")).href;
  const result = spawnSync(
    process.execPath,
    [app],
    {
      cwd: directory,
      encoding: "utf8",
      env: {
        ...process.env,
        ...(config
          ? {
              NODE_OPTIONS: `${process.env.NODE_OPTIONS ?? ""} --import=${register}`.trim(),
              PROOFTAPE_CONFIG: JSON.stringify(config),
            }
          : {}),
      },
      timeout: 10_000,
      windowsHide: true,
    },
  );
  return {
    status: result.status,
    stdout: result.stdout,
    stderr: result.stderr,
  };
}

async function observations(output: string): Promise<readonly Record<string, unknown>[]> {
  const names = await import("node:fs/promises").then(({ readdir }) => readdir(output));
  const lines: Record<string, unknown>[] = [];
  for (const name of names.sort()) {
    const content = await readFile(join(output, name), "utf8");
    lines.push(...content.trim().split("\n").filter(Boolean).map((line) => JSON.parse(line)));
  }
  return lines;
}

describe("Node module interception", () => {
  for (const format of ["esm", "cjs"] as const) {
    it(`records ${format.toUpperCase()} calls without changing supported outcomes`, async () => {
      const fixture = await writeFixture(format);
      const plain = run(fixture.app, fixture.directory);
      const instrumented = run(fixture.app, fixture.directory, {
        schemaVersion: "1",
        dependency: "fixture",
        outputDirectory: fixture.output,
        sessionId: `${format}0123456789`,
        limits: {
          maxEvents: 100,
          maxEventBytes: 65_536,
          maxDepth: 12,
          maxCollectionEntries: 100,
          maxStringBytes: 16_384,
        },
        redactLiterals: [],
      });

      expect(instrumented.status, instrumented.stderr).toBe(0);
      expect(instrumented.stdout).toBe(plain.stdout);
      expect(instrumented.stderr).toBe("");
      const records = await observations(fixture.output);
      const calls = records
        .filter((record) => record.kind === "call")
        .map((record) => record.call as { exportPath: string; outcome: string });
      expect(calls.map((call) => call.exportPath)).toEqual(
        format === "esm"
          ? ["add", "toolbox.bump", "later"]
          : ["default", "add"],
      );
      expect(calls.at(-1)?.outcome).toBe(format === "esm" ? "resolve" : "return");
    });
  }

  it("records worker-thread calls without file collisions or silent loss", async () => {
    const fixture = await writeFixture("esm");
    const worker = join(fixture.directory, "worker.mjs");
    await writeFile(
      worker,
      [
        'import { add } from "fixture";',
        "if (add(1, 2) !== 3) process.exitCode = 9;",
      ].join("\n"),
    );
    await writeFile(
      fixture.app,
      [
        'import { Worker } from "node:worker_threads";',
        "const workerUrl = new URL('./worker.mjs', import.meta.url);",
        "await Promise.all([1, 2].map(() => new Promise((resolve, reject) => {",
        "  const worker = new Worker(workerUrl);",
        "  worker.once('error', reject);",
        "  worker.once('exit', (code) => code === 0 ? resolve() : reject(new Error(String(code))));",
        "})));",
      ].join("\n"),
    );

    const instrumented = run(fixture.app, fixture.directory, {
      schemaVersion: "1",
      dependency: "fixture",
      outputDirectory: fixture.output,
      sessionId: "workers012345",
      limits: {
        maxEvents: 100,
        maxEventBytes: 65_536,
        maxDepth: 12,
        maxCollectionEntries: 100,
        maxStringBytes: 16_384,
      },
      redactLiterals: [],
    });

    expect(instrumented.status, instrumented.stderr).toBe(0);
    const records = await observations(fixture.output);
    expect(records.filter((record) => record.kind === "call")).toHaveLength(2);
    expect(records.filter((record) => record.kind === "issue")).toEqual([]);
  });

  it("records inherited child-process calls without collisions or silent loss", async () => {
    const fixture = await writeFixture("esm");
    const child = join(fixture.directory, "child.mjs");
    await writeFile(
      child,
      [
        'import { add } from "fixture";',
        "if (add(2, 4) !== 6) process.exitCode = 9;",
      ].join("\n"),
    );
    await writeFile(
      fixture.app,
      [
        'import { spawnSync } from "node:child_process";',
        "for (let index = 0; index < 2; index += 1) {",
        "  const child = spawnSync(process.execPath, ['./child.mjs'], { stdio: 'inherit' });",
        "  if (child.status !== 0) process.exit(child.status ?? 8);",
        "}",
      ].join("\n"),
    );

    const instrumented = run(fixture.app, fixture.directory, {
      schemaVersion: "1",
      dependency: "fixture",
      outputDirectory: fixture.output,
      sessionId: "children012345",
      limits: {
        maxEvents: 100,
        maxEventBytes: 65_536,
        maxDepth: 12,
        maxCollectionEntries: 100,
        maxStringBytes: 16_384,
      },
      redactLiterals: [],
    });

    expect(instrumented.status, instrumented.stderr).toBe(0);
    const records = await observations(fixture.output);
    expect(records.filter((record) => record.kind === "call")).toHaveLength(2);
    expect(records.filter((record) => record.kind === "issue")).toEqual([]);
  });

  it("records unsupported dynamic imports explicitly and leaves execution unchanged", async () => {
    const fixture = await writeFixture("esm");
    await writeFile(
      fixture.app,
      [
        'const dependency = await import("fixture");',
        "process.stdout.write(String(dependency.add(2, 3)));",
      ].join("\n"),
    );

    const plain = run(fixture.app, fixture.directory);
    const instrumented = run(fixture.app, fixture.directory, {
      schemaVersion: "1",
      dependency: "fixture",
      outputDirectory: fixture.output,
      sessionId: "unsupported01",
      limits: {
        maxEvents: 100,
        maxEventBytes: 65_536,
        maxDepth: 12,
        maxCollectionEntries: 100,
        maxStringBytes: 16_384,
      },
      redactLiterals: [],
    });

    expect(instrumented.status, instrumented.stderr).toBe(0);
    expect(instrumented.stdout).toBe(plain.stdout);
    const records = await observations(fixture.output);
    expect(records.filter((record) => record.kind === "call")).toEqual([]);
    expect(records.filter((record) => record.kind === "issue")).toEqual([
      expect.objectContaining({
        issue: expect.objectContaining({ code: "PT_UNSUPPORTED_DYNAMIC_IMPORT" }),
      }),
    ]);
  });

  it("reports event count and event byte loss explicitly", async () => {
    const countFixture = await writeFixture("esm");
    await writeFile(
      countFixture.app,
      [
        'import { add } from "fixture";',
        "if (add(1, 2) + add(3, 4) !== 10) process.exitCode = 9;",
      ].join("\n"),
    );
    const countResult = run(countFixture.app, countFixture.directory, {
      schemaVersion: "1",
      dependency: "fixture",
      outputDirectory: countFixture.output,
      sessionId: "eventlimit01",
      limits: {
        maxEvents: 1,
        maxEventBytes: 65_536,
        maxDepth: 12,
        maxCollectionEntries: 100,
        maxStringBytes: 16_384,
      },
      redactLiterals: [],
    });
    expect(countResult.status, countResult.stderr).toBe(0);
    const countRecords = await observations(countFixture.output);
    expect(countRecords.filter((record) => record.kind === "call")).toHaveLength(1);
    expect(countRecords).toContainEqual(expect.objectContaining({
      kind: "issue",
      issue: expect.objectContaining({ code: "PT_EVENT_LIMIT" }),
    }));

    const bytesFixture = await writeFixture("esm");
    await writeFile(
      bytesFixture.app,
      [
        'import { add } from "fixture";',
        `if (add(${JSON.stringify("x".repeat(5_000))}, "") === "") process.exitCode = 9;`,
      ].join("\n"),
    );
    const bytesResult = run(bytesFixture.app, bytesFixture.directory, {
      schemaVersion: "1",
      dependency: "fixture",
      outputDirectory: bytesFixture.output,
      sessionId: "eventbytes01",
      limits: {
        maxEvents: 10,
        maxEventBytes: 1_024,
        maxDepth: 12,
        maxCollectionEntries: 100,
        maxStringBytes: 16_384,
      },
      redactLiterals: [],
    });
    expect(bytesResult.status, bytesResult.stderr).toBe(0);
    const byteRecords = await observations(bytesFixture.output);
    expect(byteRecords.filter((record) => record.kind === "call")).toEqual([]);
    expect(byteRecords).toContainEqual(expect.objectContaining({
      kind: "issue",
      issue: expect.objectContaining({ code: "PT_EVENT_BYTES" }),
    }));
  });
});
