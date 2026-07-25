import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { performance } from "node:perf_hooks";
import { checkedEvidenceOutput, writeEvidence } from "./evidence-output.mjs";

const sampleCount = 7;
const warmupCount = 2;
const callCount = 200;
const workPerCall = 100_000;
const root = process.cwd();
const hookUrl = pathToFileURL(resolve(root, "packages/hook/dist/register.js")).href;

function median(values) {
  const ordered = [...values].sort((left, right) => left - right);
  return ordered[Math.floor(ordered.length / 2)];
}

function execute(app, cwd, config) {
  const start = performance.now();
  const result = spawnSync(process.execPath, [app], {
    cwd,
    encoding: "utf8",
    env: {
      ...process.env,
      ...(config
        ? {
            NODE_OPTIONS: `${process.env.NODE_OPTIONS ?? ""} --import=${hookUrl}`.trim(),
            PROOFTAPE_CONFIG: JSON.stringify(config),
          }
        : {}),
    },
    timeout: 30_000,
    maxBuffer: 64 * 1024,
    shell: false,
    windowsHide: true,
  });
  const milliseconds = performance.now() - start;
  if (result.error || result.signal || result.status !== 0) {
    throw new Error(`performance fixture failed: ${result.error?.message ?? result.signal ?? result.status}`);
  }
  return { milliseconds, stdout: result.stdout };
}

const directory = await mkdtemp(join(tmpdir(), "prooftape-performance-"));
try {
  const dependencyDirectory = join(directory, "node_modules", "fixture");
  await mkdir(dependencyDirectory, { recursive: true });
  await writeFile(
    join(dependencyDirectory, "package.json"),
    JSON.stringify({ name: "fixture", version: "1.0.0", type: "module", exports: "./index.js" }),
  );
  await writeFile(
    join(dependencyDirectory, "index.js"),
    [
      "export function work(seed) {",
      "  let value = seed >>> 0;",
      `  for (let index = 0; index < ${workPerCall}; index += 1) {`,
      "    value = (Math.imul(value, 1664525) + 1013904223) >>> 0;",
      "  }",
      "  return value;",
      "}",
    ].join("\n"),
  );
  const app = join(directory, "app.mjs");
  await writeFile(
    app,
    [
      'import { work } from "fixture";',
      "let checksum = 0;",
      `for (let call = 0; call < ${callCount}; call += 1) checksum ^= work(call);`,
      "process.stdout.write(String(checksum));",
    ].join("\n"),
  );

  const plain = [];
  const instrumented = [];
  let expectedOutput;
  for (let run = 0; run < warmupCount + sampleCount; run += 1) {
    const plainResult = execute(app, directory);
    const observationDirectory = join(directory, `observations-${run}`);
    await mkdir(observationDirectory);
    const instrumentedResult = execute(app, directory, {
      schemaVersion: "1",
      dependency: "fixture",
      outputDirectory: observationDirectory,
      sessionId: `performance-${String(run).padStart(2, "0")}`,
      limits: {
        maxEvents: callCount + 10,
        maxEventBytes: 65_536,
        maxDepth: 12,
        maxCollectionEntries: 100,
        maxStringBytes: 16_384,
      },
      redactLiterals: [],
    });
    expectedOutput ??= plainResult.stdout;
    if (
      plainResult.stdout !== expectedOutput
      || instrumentedResult.stdout !== expectedOutput
    ) {
      throw new Error("instrumentation changed the fixture result");
    }
    if (run >= warmupCount) {
      plain.push(Number(plainResult.milliseconds.toFixed(3)));
      instrumented.push(Number(instrumentedResult.milliseconds.toFixed(3)));
    }
  }

  const plainMedianMilliseconds = median(plain);
  const instrumentedMedianMilliseconds = median(instrumented);
  const ratio = instrumentedMedianMilliseconds / plainMedianMilliseconds;
  const report = {
    schemaVersion: "1",
    kind: "prooftape-performance-report",
    budget: { maximumMedianRatio: 2 },
    fixture: {
      callCount,
      workPerCall,
      description: "CPU-bound synchronous dependency calls with scalar arguments and returns",
    },
    environment: {
      nodeVersion: process.version,
      platform: process.platform,
      arch: process.arch,
      cpu: process.env.PROCESSOR_IDENTIFIER ?? "not-reported",
    },
    samplesMilliseconds: { plain, instrumented },
    mediansMilliseconds: {
      plain: plainMedianMilliseconds,
      instrumented: instrumentedMedianMilliseconds,
    },
    medianRatio: Number(ratio.toFixed(3)),
    passed: ratio <= 2,
  };

  const output = checkedEvidenceOutput(root, process.argv.slice(2));
  if (output) {
    await writeEvidence(
      output.outputPath,
      `${JSON.stringify(report, null, 2)}\n`,
      output.replaceExisting,
    );
  }
  process.stdout.write(`${JSON.stringify(report)}\n`);
  if (!report.passed) process.exitCode = 1;
} finally {
  const absolute = resolve(directory);
  if (!absolute.startsWith(resolve(tmpdir(), "prooftape-performance-"))) {
    throw new Error("refusing to remove an unexpected performance directory");
  }
  await rm(absolute, { recursive: true, force: true });
}
