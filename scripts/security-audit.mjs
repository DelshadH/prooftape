import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { checkedEvidenceOutput, writeEvidence } from "./evidence-output.mjs";
import { auditNpmBootstrapWorkflow } from "./npm-bootstrap-workflow-policy.mjs";
import { auditReleaseWorkflow } from "./release-workflow-policy.mjs";

const root = process.cwd();
const allowedLicenses = new Set(["Apache-2.0", "BSD-3-Clause", "ISC", "MIT"]);
const secretPatterns = [
  ["AWS access key", /\bAKIA[0-9A-Z]{16}\b/gu],
  ["GitHub token", /\bgh[pousr]_[A-Za-z0-9]{20,}\b/gu],
  ["Slack token", /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/gu],
  ["private key", /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/gu],
];

function trackedFiles() {
  const result = spawnSync(
    "git",
    ["ls-files", "-z", "--cached", "--others", "--exclude-standard"],
    {
    cwd: root,
    encoding: "utf8",
    timeout: 10_000,
    maxBuffer: 4 * 1024 * 1024,
    shell: false,
    windowsHide: true,
    },
  );
  if (result.error || result.status !== 0) throw new Error("could not list tracked files");
  return result.stdout.split("\0").filter(Boolean);
}

const failures = [];
const lock = JSON.parse(await readFile(resolve(root, "package-lock.json"), "utf8"));
const packageEntries = Object.entries(lock.packages ?? {}).filter(
  ([path, metadata]) => path !== "" && !metadata.link,
);
for (const [path, metadata] of packageEntries) {
  if (!metadata.license || !allowedLicenses.has(metadata.license)) {
    failures.push(`${path}: unapproved or missing license ${JSON.stringify(metadata.license)}`);
  }
  if (
    metadata.resolved
    && !metadata.resolved.startsWith("https://registry.npmjs.org/")
  ) {
    failures.push(`${path}: dependency is not locked to the npm registry`);
  }
  if (metadata.hasInstallScript && !metadata.dev) {
    failures.push(`${path}: production dependency has an install script`);
  }
}

let scannedBytes = 0;
let workflowCount = 0;
let releaseWorkflowText = "";
let npmBootstrapWorkflowText = "";
for (const file of trackedFiles()) {
  const bytes = await readFile(resolve(root, file));
  scannedBytes += bytes.length;
  if (scannedBytes > 50 * 1024 * 1024) throw new Error("tracked source scan exceeded 50 MiB");
  if (bytes.includes(0)) continue;
  const text = bytes.toString("utf8");
  const normalizedFile = file.replaceAll("\\", "/");
  for (const [label, pattern] of secretPatterns) {
    pattern.lastIndex = 0;
    if (pattern.test(text)) failures.push(`${file}: possible ${label}`);
  }
  if (/^\.github\/workflows\/[^/]+\.ya?ml$/u.test(normalizedFile)) {
    workflowCount += 1;
    if (normalizedFile === ".github/workflows/release.yml") {
      releaseWorkflowText = text;
    }
    if (normalizedFile === ".github/workflows/npm-bootstrap.yml") {
      npmBootstrapWorkflowText = text;
    }
    if (/\bpull_request_target\s*:/u.test(text)) {
      failures.push(`${file}: pull_request_target is forbidden`);
    }
    if (/\bwrite-all\b/u.test(text)) {
      failures.push(`${file}: write-all permission is forbidden`);
    }
    for (const match of text.matchAll(/^\s*([a-z-]+):\s*write\s*$/gmu)) {
      const scope = match[1];
      const releaseOidc = (
        normalizedFile === ".github/workflows/release.yml"
        && scope === "id-token"
      );
      const bootstrapOidc = (
        normalizedFile === ".github/workflows/npm-bootstrap.yml"
        && scope === "id-token"
      );
      if (!releaseOidc && !bootstrapOidc) {
        failures.push(`${file}: ${scope}: write permission is forbidden`);
      }
    }
    if (/\$\{\{\s*secrets\./u.test(text)) {
      const oneTimeBootstrapSecret = (
        normalizedFile === ".github/workflows/npm-bootstrap.yml"
        && (text.match(/\$\{\{\s*secrets\.NPM_BOOTSTRAP_TOKEN\s*\}\}/gu)?.length ?? 0)
          === 1
        && (text.match(/\$\{\{\s*secrets\./gu)?.length ?? 0) === 1
      );
      if (!oneTimeBootstrapSecret) {
        failures.push(`${file}: workflow secrets are forbidden`);
      }
    }
    if (/persist-credentials:\s*true/u.test(text)) {
      failures.push(`${file}: persisted checkout credentials are forbidden`);
    }
    for (const line of text.split(/\r?\n/u)) {
      const match = /^\s*(?:-\s+)?uses:\s+\S+@(\S+)/u.exec(line);
      if (match && !/^[a-f0-9]{40}$/u.test(match[1])) {
        failures.push(`${file}: action is not pinned to a full commit SHA`);
      }
    }
  }
}

const version = lock.packages?.[""]?.version;
if (typeof version !== "string") throw new Error("workspace version is missing");
const releaseWorkflowAudit = auditReleaseWorkflow(releaseWorkflowText, version);
for (const failure of releaseWorkflowAudit.failures) {
  failures.push(`.github/workflows/release.yml: ${failure}`);
}
const npmBootstrapWorkflowAudit = auditNpmBootstrapWorkflow(
  npmBootstrapWorkflowText,
  version,
);
for (const failure of npmBootstrapWorkflowAudit.failures) {
  failures.push(`.github/workflows/npm-bootstrap.yml: ${failure}`);
}

let releasingText = "";
try {
  releasingText = await readFile(resolve(root, "RELEASING.md"), "utf8");
} catch (error) {
  if (error?.code !== "ENOENT") throw error;
}
if (!releasingText.includes("Publishing from a developer workstation is prohibited.")) {
  failures.push("RELEASING.md: developer-workstation publishing must be prohibited");
}
if (/^\s*npm publish\b/mu.test(releasingText)) {
  failures.push("RELEASING.md: direct npm publish commands are forbidden");
}

const report = {
  schemaVersion: "1",
  kind: "prooftape-security-audit",
  dependencyPackages: packageEntries.length,
  allowedLicenses: [...allowedLicenses].sort(),
  productionInstallScripts: 0,
  trackedFilesScanned: trackedFiles().length,
  trackedBytesScanned: scannedBytes,
  workflowsScanned: workflowCount,
  releaseWorkflow: releaseWorkflowAudit.report,
  npmBootstrapWorkflow: npmBootstrapWorkflowAudit.report,
  failures,
  passed: failures.length === 0,
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
