import { spawnSync } from "node:child_process";
import { mkdtemp, realpath, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import type { CapsuleV1, ReportV1 } from "@prooftape/schema";
import { HarnessError, recordRevision, type RecordRevisionOptions } from "./record.js";
import { buildReport } from "./report.js";
import {
  generateReproduction,
  NoSafeReproductionError,
} from "./repro.js";

export interface CompareRevisionsOptions extends Omit<RecordRevisionOptions, "cwd"> {
  readonly cwd: string;
  readonly baseRef: string;
  readonly candidateRef: string;
  readonly reproductionDirectory?: string;
}

export interface CompareRevisionsResult {
  readonly base: CapsuleV1;
  readonly candidate: CapsuleV1;
  readonly report: ReportV1;
}

function git(cwd: string, args: readonly string[]): string {
  const result = spawnSync("git", args, {
    cwd,
    encoding: "utf8",
    timeout: 30_000,
    maxBuffer: 2 * 1024 * 1024,
    windowsHide: true,
  });
  if (result.error || result.status !== 0) {
    throw new HarnessError(`Git worktree command failed: ${args[0] ?? "git"}`);
  }
  return result.stdout.trim();
}

function install(cwd: string): void {
  const result = spawnSync(
    "npm",
    ["ci", "--ignore-scripts", "--no-audit", "--no-fund"],
    {
      cwd,
      encoding: "buffer",
      timeout: 5 * 60 * 1000,
      maxBuffer: 2 * 1024 * 1024,
      windowsHide: true,
      shell: false,
    },
  );
  if (result.error) {
    const code = (result.error as NodeJS.ErrnoException).code;
    throw new HarnessError(`locked npm install could not start${code ? ` (${code})` : ""}`);
  }
  if (result.signal) throw new HarnessError(`locked npm install ended by ${result.signal}`);
  if (result.status !== 0) throw new HarnessError("locked npm install failed");
}

function verifyReproduction(
  scriptPath: string,
  baseDirectory: string,
  candidateDirectory: string,
): void {
  const run = (cwd: string) => spawnSync(process.execPath, [scriptPath], {
    cwd,
    encoding: "buffer",
    timeout: 30_000,
    maxBuffer: 64 * 1024,
    windowsHide: true,
    shell: false,
  });
  const base = run(baseDirectory);
  if (base.error || base.signal || base.status !== 0) {
    throw new HarnessError("generated reproduction did not match the base outcome");
  }
  const candidate = run(candidateDirectory);
  if (candidate.error || candidate.signal || candidate.status !== 1) {
    throw new HarnessError("generated reproduction did not reproduce the candidate difference");
  }
}

async function removeCompareDirectory(directory: string): Promise<void> {
  const absolute = resolve(directory);
  const expectedPrefix = resolve(tmpdir(), "prooftape-compare-worktrees-");
  if (!absolute.startsWith(expectedPrefix)) {
    throw new HarnessError("refusing to remove an unexpected comparison directory");
  }
  await rm(absolute, { recursive: true, force: true });
}

export async function compareRevisions(
  options: CompareRevisionsOptions,
): Promise<CompareRevisionsResult> {
  if (!/^[a-f0-9]{40}$/u.test(options.baseRef) || !/^[a-f0-9]{40}$/u.test(options.candidateRef)) {
    throw new HarnessError("base and candidate refs must be full lowercase commit SHAs");
  }
  const cwd = await realpath(resolve(options.cwd));
  const gitRoot = await realpath(git(cwd, ["rev-parse", "--show-toplevel"]));
  if (gitRoot.toLocaleLowerCase() !== cwd.toLocaleLowerCase()) {
    throw new HarnessError("compare must run at the Git repository root");
  }
  if (git(cwd, ["status", "--porcelain", "--untracked-files=all"]) !== "") {
    throw new HarnessError("checkout files are not clean");
  }
  git(cwd, ["cat-file", "-e", `${options.baseRef}^{commit}`]);
  git(cwd, ["cat-file", "-e", `${options.candidateRef}^{commit}`]);

  const worktreeRoot = await mkdtemp(join(tmpdir(), "prooftape-compare-worktrees-"));
  const baseDirectory = join(worktreeRoot, "base");
  const candidateDirectory = join(worktreeRoot, "candidate");
  let baseAdded = false;
  let candidateAdded = false;
  try {
    git(cwd, ["worktree", "add", "--detach", baseDirectory, options.baseRef]);
    baseAdded = true;
    git(cwd, ["worktree", "add", "--detach", candidateDirectory, options.candidateRef]);
    candidateAdded = true;
    install(baseDirectory);
    install(candidateDirectory);
    const common = {
      dependency: options.dependency,
      command: options.command,
      hookUrl: options.hookUrl,
      prooftapeVersion: options.prooftapeVersion,
      redactLiterals: options.redactLiterals,
      timeoutMilliseconds: options.timeoutMilliseconds,
      maxOutputBytes: options.maxOutputBytes,
      ...(options.normalizers === undefined ? {} : { normalizers: options.normalizers }),
    };
    const base = await recordRevision({ ...common, cwd: baseDirectory });
    const candidate = await recordRevision({ ...common, cwd: candidateDirectory });
    let report = buildReport(base.capsule, candidate.capsule);

    if (
      report.verdict === "behavior-changed"
      && options.reproductionDirectory !== undefined
    ) {
      try {
        const reproduction = await generateReproduction(
          base.capsule,
          candidate.capsule,
          report,
          options.reproductionDirectory,
        );
        verifyReproduction(
          join(options.reproductionDirectory, "repro.mjs"),
          baseDirectory,
          candidateDirectory,
        );
        report = { ...report, reproduction };
      } catch (error) {
        if (!(error instanceof NoSafeReproductionError)) throw error;
      }
    }

    return { base: base.capsule, candidate: candidate.capsule, report };
  } finally {
    if (candidateAdded) {
      try {
        git(cwd, ["worktree", "remove", "--force", candidateDirectory]);
      } catch {
        // The prefix-checked temporary directory cleanup below is the final fallback.
      }
    }
    if (baseAdded) {
      try {
        git(cwd, ["worktree", "remove", "--force", baseDirectory]);
      } catch {
        // The prefix-checked temporary directory cleanup below is the final fallback.
      }
    }
    await removeCompareDirectory(worktreeRoot);
  }
}
