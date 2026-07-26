import { REPORT_LIMITS, type CapsuleV1, type ReportV1 } from "@prooftape/schema";
import { canonicalCapsule } from "./capsule.js";
import { sha256 } from "./canonical.js";
import { diffCalls } from "./diff.js";

export class UnsupportedComparisonError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "UnsupportedComparisonError";
  }
}

export class AmbiguousComparisonError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "AmbiguousComparisonError";
  }
}

function assertComparable(base: CapsuleV1, candidate: CapsuleV1): void {
  if (base.calls.length === 0 || candidate.calls.length === 0) {
    throw new UnsupportedComparisonError("empty capsules do not establish a behavioral verdict");
  }
  if (base.metadata.dependency.name !== candidate.metadata.dependency.name) {
    throw new UnsupportedComparisonError("capsules observe different dependencies");
  }
  if (
    base.metadata.nodeVersion !== candidate.metadata.nodeVersion
    || base.metadata.platform !== candidate.metadata.platform
    || base.metadata.arch !== candidate.metadata.arch
  ) {
    throw new UnsupportedComparisonError("capsules were recorded in different runtime environments");
  }
  if (base.metadata.command.join("\0") !== candidate.metadata.command.join("\0")) {
    throw new UnsupportedComparisonError("capsules used different test commands");
  }
  if (base.metadata.prooftapeVersion !== candidate.metadata.prooftapeVersion) {
    throw new UnsupportedComparisonError("capsules used different ProofTape versions");
  }
  if (base.metadata.configurationSha256 !== candidate.metadata.configurationSha256) {
    throw new UnsupportedComparisonError("capsules used different recorder configurations");
  }
  if (base.issues.length > 0 || candidate.issues.length > 0) {
    throw new UnsupportedComparisonError("a capsule contains explicit capture issues");
  }
  if (
    base.calls.some((call) => (call.unsupported?.length ?? 0) > 0)
    || candidate.calls.some((call) => (call.unsupported?.length ?? 0) > 0)
  ) {
    throw new UnsupportedComparisonError("a capsule contains unsupported captured values");
  }
}

export function buildReport(base: CapsuleV1, candidate: CapsuleV1): ReportV1 {
  assertComparable(base, candidate);
  const callDiffs = diffCalls(base.calls, candidate.calls);
  if (callDiffs.some((difference) => difference.kind === "ambiguous")) {
    throw new AmbiguousComparisonError("repeated calls could not be aligned unambiguously");
  }
  const differences = callDiffs.filter(
    (difference) => difference.kind !== "ambiguous",
  );
  if (differences.length > REPORT_LIMITS.maxDifferences) {
    throw new UnsupportedComparisonError("report difference limit exceeded");
  }
  const blockingDifferenceCount = differences.filter((difference) => difference.blocking).length;
  return {
    schemaVersion: "1",
    kind: "prooftape-report",
    dependency: base.metadata.dependency.name,
    verdict: blockingDifferenceCount > 0
      ? "behavior-changed"
      : "no-blocking-differences-observed",
    blockingDifferenceCount,
    warningCount: differences.filter((difference) => !difference.blocking).length,
    baseline: {
      capsuleHash: sha256(canonicalCapsule(base)),
      commitSha: base.metadata.commitSha,
      lockfileSha256: base.metadata.lockfileSha256,
      dependencyVersion: base.metadata.dependency.version,
      observationAuthenticity: base.metadata.observationAuthenticity,
    },
    candidate: {
      capsuleHash: sha256(canonicalCapsule(candidate)),
      commitSha: candidate.metadata.commitSha,
      lockfileSha256: candidate.metadata.lockfileSha256,
      dependencyVersion: candidate.metadata.dependency.version,
      observationAuthenticity: candidate.metadata.observationAuthenticity,
    },
    differences,
  };
}
