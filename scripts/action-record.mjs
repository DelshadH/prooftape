import { createHash } from "node:crypto";
import { appendFile, mkdir, readFile, realpath } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const toolRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const { runCli } = await import(
  pathToFileURL(resolve(toolRoot, "packages/cli/dist/main.js")).href
);

function requiredEnvironment(name, maximum) {
  const value = process.env[name];
  if (!value || value.length > maximum || /[\u0000\r\n]/u.test(value)) {
    throw new Error(`${name} is missing or outside supported bounds`);
  }
  return value;
}

function inside(root, target) {
  const path = relative(root, target);
  return path === "" || (!path.startsWith("..") && !isAbsolute(path));
}

const workspace = await realpath(requiredEnvironment("GITHUB_WORKSPACE", 4_096));
const workingName = requiredEnvironment("PROOFTAPE_ACTION_WORKING_DIRECTORY", 1_024);
if (isAbsolute(workingName)) throw new Error("working-directory must be relative");
const workingDirectory = await realpath(resolve(workspace, workingName));
if (!inside(workspace, workingDirectory)) throw new Error("working-directory escapes the workspace");

const dependency = requiredEnvironment("PROOFTAPE_ACTION_DEPENDENCY", 256);
if (!/^(?:@[a-z0-9][a-z0-9._~-]*\/)?[a-z0-9][a-z0-9._~-]*$/u.test(dependency)) {
  throw new Error("dependency must be an exact npm package name");
}
const command = requiredEnvironment("PROOFTAPE_ACTION_COMMAND", 16_384);
const output = requiredEnvironment("PROOFTAPE_ACTION_OUTPUT", 1_024);
if (
  isAbsolute(output)
  || output.split(/[\\/]/u).some((segment) => segment === "..")
  || !/^[a-zA-Z0-9._/\\-]+$/u.test(output)
) {
  throw new Error("output must be a safe relative path");
}
const timeout = requiredEnvironment("PROOFTAPE_ACTION_TIMEOUT_MS", 16);
if (!/^\d+$/u.test(timeout)) throw new Error("timeout-ms must be a decimal integer");

const outputPath = resolve(workingDirectory, output);
if (!inside(workingDirectory, outputPath)) throw new Error("output escapes the working directory");
await mkdir(dirname(outputPath), { recursive: true });
const exitCode = await runCli([
  "record",
  "--dependency",
  dependency,
  "--command",
  command,
  "--out",
  output,
  "--timeout-ms",
  timeout,
], {
  cwd: workingDirectory,
  stdout: (value) => process.stdout.write(value),
  stderr: (value) => process.stderr.write(value),
});
if (exitCode !== 0) process.exit(exitCode);

const bytes = await readFile(outputPath);
const capsuleSha256 = createHash("sha256").update(bytes).digest("hex");
const githubOutput = process.env.GITHUB_OUTPUT;
if (githubOutput) {
  await appendFile(
    githubOutput,
    [
      `capsule-path=${outputPath}`,
      `capsule-sha256=${capsuleSha256}`,
      "observation-authenticity=not-established",
      "",
    ].join("\n"),
    "utf8",
  );
}
process.stdout.write(`Capsule SHA-256: ${capsuleSha256}\n`);
