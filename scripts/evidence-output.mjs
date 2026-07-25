import { randomUUID } from "node:crypto";
import { lstat, mkdir, rename, rm, writeFile } from "node:fs/promises";
import { basename, dirname, isAbsolute, relative, resolve } from "node:path";

export function checkedEvidenceOutput(root, args, option = "--out") {
  const index = args.indexOf(option);
  const replaceExisting = args.includes("--replace");
  if (index === -1) {
    if (replaceExisting) throw new Error(`--replace requires ${option}`);
    return undefined;
  }

  const value = args[index + 1];
  if (!value || isAbsolute(value) || value.includes("\0")) {
    throw new Error(`${option} must be a relative path`);
  }
  const outputPath = resolve(root, value);
  const repositoryPath = relative(root, outputPath);
  if (repositoryPath.startsWith("..") || isAbsolute(repositoryPath)) {
    throw new Error(`${option} escapes the repository`);
  }

  if (replaceExisting) {
    const evidenceRoot = resolve(root, ".evidence");
    const evidencePath = relative(evidenceRoot, outputPath);
    if (
      evidencePath === ""
      || evidencePath.startsWith("..")
      || isAbsolute(evidencePath)
    ) {
      throw new Error("--replace is limited to files inside .evidence");
    }
  }

  return { outputPath, replaceExisting };
}

export async function writeEvidence(outputPath, contents, replaceExisting) {
  await mkdir(dirname(outputPath), { recursive: true });
  if (!replaceExisting) {
    await writeFile(outputPath, contents, { flag: "wx", mode: 0o600 });
    return;
  }

  try {
    const existing = await lstat(outputPath);
    if (!existing.isFile()) {
      throw new Error("refusing to replace a non-file evidence path");
    }
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }

  const temporaryPath = resolve(
    dirname(outputPath),
    `.${basename(outputPath)}.${process.pid}.${randomUUID()}.tmp`,
  );
  try {
    await writeFile(temporaryPath, contents, { flag: "wx", mode: 0o600 });
    try {
      await rename(temporaryPath, outputPath);
    } catch (error) {
      if (error?.code !== "EEXIST" && error?.code !== "EPERM") throw error;
      const existing = await lstat(outputPath);
      if (!existing.isFile()) {
        throw new Error("refusing to replace a non-file evidence path");
      }
      await rm(outputPath, { force: true });
      await rename(temporaryPath, outputPath);
    }
  } finally {
    await rm(temporaryPath, { force: true });
  }
}
