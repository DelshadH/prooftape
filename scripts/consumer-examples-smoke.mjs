import { spawnSync } from "node:child_process";
import { cp, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const repository = resolve(import.meta.dirname, "..");
const temporary = await mkdtemp(join(tmpdir(), "prooftape-consumer-examples-"));
const examples = ["esm", "commonjs", "child-process"];

function run(cwd, executable, args) {
  const result = spawnSync(executable, args, {
    cwd,
    encoding: "utf8",
    timeout: 60_000,
    maxBuffer: 2 * 1024 * 1024,
    windowsHide: true,
    shell: false,
  });
  if (result.error || result.status !== 0) {
    throw new Error(
      `${cwd}: ${args[0] ?? executable} failed: `
        + `${result.error?.message ?? result.stderr.trim()}`,
    );
  }
}

try {
  for (const name of examples) {
    const source = join(repository, "examples", name);
    const destination = join(temporary, name);
    const lock = JSON.parse(await readFile(join(source, "package-lock.json"), "utf8"));
    if (
      Object.values(lock.packages ?? {}).some(
        (entry) => entry?.link === true || String(entry?.resolved ?? "").startsWith("file:"),
      )
    ) {
      throw new Error(`${name}: example lockfile must not link to the monorepo`);
    }
    await cp(source, destination, { recursive: true, errorOnExist: true });
    run(destination, "npm", [
      "ci",
      "--ignore-scripts",
      "--no-audit",
      "--no-fund",
    ]);
    run(destination, "npm", ["test"]);
  }

  const workflow = await readFile(
    join(repository, "examples", "github", "prooftape-camelcase.yml"),
    "utf8",
  );
  if (
    !/uses: DelshadH\/prooftape\/\.github\/workflows\/prooftape\.yml@[a-f0-9]{40}/u
      .test(workflow)
    || !workflow.includes("contents: read")
    || workflow.includes("secrets:")
    || workflow.includes("pull_request_target")
  ) {
    throw new Error("GitHub consumer workflow is not pinned and read-only");
  }
  JSON.parse(
    await readFile(
      join(repository, "examples", "github", "renovate.json"),
      "utf8",
    ),
  );
  process.stdout.write(
    "ESM, CommonJS, child-process, Dependabot, and Renovate examples passed.\n",
  );
} finally {
  await rm(temporary, { recursive: true, force: true });
}
