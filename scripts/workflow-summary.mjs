function cell(value) {
  return String(value)
    .replace(/[\u0000-\u001f\u007f-\u009f]/gu, "?")
    .replaceAll("`", "'")
    .replaceAll("|", "\\|")
    .slice(0, 1_000);
}

function hash(value, label) {
  if (!/^[a-f0-9]{64}$/u.test(value)) {
    throw new Error(`${label} must be a SHA-256`);
  }
  return value;
}

export function renderWorkflowSummary(report, exitCode, transport) {
  if (![0, 2, 3, 4].includes(exitCode)) {
    throw new Error("exit code is outside the public contract");
  }
  const baseArtifactSha256 = hash(
    transport.baseArtifactSha256,
    "base artifact transport hash",
  );
  const candidateArtifactSha256 = hash(
    transport.candidateArtifactSha256,
    "candidate artifact transport hash",
  );
  return [
    "# ProofTape comparison",
    "",
    "**Observation authenticity is not established.**",
    "",
    "| Property | Value |",
    "| --- | --- |",
    `| Base commit | \`${cell(report.baseline.commitSha)}\` |`,
    `| Candidate commit | \`${cell(report.candidate.commitSha)}\` |`,
    `| Dependency | \`${cell(report.dependency)}\` |`,
    `| Base dependency version | \`${cell(report.baseline.dependencyVersion)}\` |`,
    `| Candidate dependency version | \`${cell(report.candidate.dependencyVersion)}\` |`,
    `| Base canonical capsule SHA-256 | \`${cell(report.baseline.capsuleHash)}\` |`,
    `| Candidate canonical capsule SHA-256 | \`${cell(report.candidate.capsuleHash)}\` |`,
    `| Base artifact transport SHA-256 | \`${baseArtifactSha256}\` |`,
    `| Candidate artifact transport SHA-256 | \`${candidateArtifactSha256}\` |`,
    `| Verdict | \`${cell(report.verdict)}\` |`,
    `| Exit code | \`${exitCode}\` |`,
    "",
    "The protected base capsule is retained before candidate execution.",
    "Capsule bytes matched their producing-job hashes during artifact transport.",
    "Capsule structure was validated before observations were compared.",
    "Base protection and transport integrity do not establish observation authorship.",
    "",
  ].join("\n");
}
