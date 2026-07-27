const BOOTSTRAP_WORKFLOW_PATH = ".github/workflows/npm-bootstrap.yml";

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

function hasExactPermissions(text, headerIndent, entryIndent, expected) {
  const pattern = new RegExp(
    `^ {${headerIndent}}permissions:[^\\S\\r\\n]*\\r?\\n`
      + `((?:^ {${entryIndent}}[a-z-]+:[^\\r\\n]*\\r?\\n?)+)`,
    "gmu",
  );
  const blocks = [...text.matchAll(pattern)];
  if (blocks.length !== 1) return false;
  const entries = [
    ...(blocks[0]?.[1] ?? "").matchAll(
      /^\s*([a-z-]+):\s*(read|write|none)\s*$/gmu,
    ),
  ].map((match) => `${match[1]}:${match[2]}`).sort();
  return JSON.stringify(entries) === JSON.stringify([...expected].sort());
}

export function auditNpmBootstrapWorkflow(text, version) {
  const exactTag = `v${version}`;
  const onBlock = /^on:\s*\r?\n([\s\S]*?)^permissions:/mu.exec(text)?.[1] ?? "";
  const events = [...onBlock.matchAll(/^ {2}([a-z_]+):/gmu)]
    .map((match) => match[1]);
  const manualDispatch = (
    events.length === 1
    && events[0] === "workflow_dispatch"
  );
  const tagIsExact = (
    text.includes(`RELEASE_VERSION: ${JSON.stringify(version)}`)
    && text.includes(`default: ${exactTag}`)
    && text.includes('EXPECTED_TAG="v${RELEASE_VERSION}"')
    && text.includes("ref: ${{ inputs.tag }}")
  );
  const expectedCommitBound = (
    text.includes("PROOFTAPE_EXPECTED_COMMIT: ${{ inputs.expected_commit }}")
    && text.includes("PROOFTAPE_WORKFLOW_SHA: ${{ github.sha }}")
    && text.includes('if [[ "${PROOFTAPE_WORKFLOW_SHA}" != "${PROOFTAPE_EXPECTED_COMMIT}" ]]')
    && text.includes('test "$(git rev-parse HEAD)" = "${PROOFTAPE_EXPECTED_COMMIT}"')
    && text.includes('test "$(git rev-list -n 1 "${PROOFTAPE_RELEASE_TAG}")" = "${PROOFTAPE_EXPECTED_COMMIT}"')
  );
  const tagOnMain = (
    text.includes("git fetch --no-tags origin main:refs/remotes/origin/main")
    && text.includes(
      'git merge-base --is-ancestor "${PROOFTAPE_EXPECTED_COMMIT}" refs/remotes/origin/main',
    )
  );
  const prepareBlock = /^  prepare:\s*\r?\n([\s\S]*?)^  publish:/mu.exec(text)?.[1] ?? "";
  const publishBlock = /^  publish:\s*\r?\n([\s\S]*)$/mu.exec(text)?.[1] ?? "";
  const environmentMatch = /^ {4}environment:\s*(\S+)\s*$/mu.exec(publishBlock);
  const protectedEnvironment = environmentMatch?.[1] ?? "";
  const leastPrivilegePermissions = (
    hasExactPermissions(text, 0, 2, ["contents:read"])
    && hasExactPermissions(prepareBlock, 4, 6, ["contents:read"])
    && hasExactPermissions(
      publishBlock,
      4,
      6,
      ["contents:read", "id-token:write"],
    )
  );
  const oidcIsolatedToPublish = (
    !/\bid-token:\s*write\b/u.test(text.slice(0, text.indexOf("  publish:")))
    && (publishBlock.match(/\bid-token:\s*write\b/gu)?.length ?? 0) === 1
  );
  const secretReference = "NODE_AUTH_TOKEN: ${{ secrets.NPM_BOOTSTRAP_TOKEN }}";
  const tokenIsolatedToPublishStep = (
    !prepareBlock.includes("NODE_AUTH_TOKEN")
    && (text.match(/\$\{\{\s*secrets\./gu)?.length ?? 0) === 1
    && (text.match(/NODE_AUTH_TOKEN:/gu)?.length ?? 0) === 1
    && publishBlock.includes(secretReference)
  );
  const explicitPublishApproval = (
    text.includes("publish:")
    && text.includes("type: boolean")
    && text.includes("default: false")
    && text.includes("confirm_token_exception:")
    && text.includes(
      "if: ${{ inputs.publish && inputs.confirm_token_exception == 'ONE_TIME_TOKEN_AUTHORIZED' }}",
    )
  );
  const actionPins = [
    ...text.matchAll(/^\s*(?:-\s+)?uses:\s+\S+@(\S+)/gmu),
  ];
  const actionsPinned = (
    actionPins.length > 0
    && actionPins.every((match) => /^[a-f0-9]{40}$/u.test(match[1]))
  );
  const fullGates = [
    "npm ci --ignore-scripts --no-audit --no-fund",
    "npm run check",
    "npm run smoke:package",
    "npm run smoke:examples",
    "npm run demo",
    "npm run demo:record",
    "npm run real-upgrades",
    "npm run corpus",
    "npm run performance",
    "npm run security",
    "npm run release:prepare",
  ].every((command) => new RegExp(
    `^\\s*run:\\s*${escapeRegex(command)}\\s*$`,
    "mu",
  ).test(prepareBlock));
  const twoCleanBuilds = (
    prepareBlock.includes("Build twice from clean source")
    && prepareBlock.includes("npm run release:prepare")
  );
  const exactEvidenceVerification = (
    (text.match(/npm-bootstrap-verify\.mjs preflight/gu)?.length ?? 0) === 2
    && prepareBlock.includes("--dir .evidence/release")
    && prepareBlock.includes("--commit \"${PROOFTAPE_EXPECTED_COMMIT}\"")
  );
  const registryAbsencePreflight = (
    prepareBlock.includes("Verify exact evidence, immutable hashes, contents, and empty registry")
    && publishBlock.includes(
      "Recheck evidence and registry absence immediately before authentication",
    )
  );
  const hiddenReleaseEvidence = (
    prepareBlock.includes(".evidence/release")
    && prepareBlock.includes(".evidence/npm-bootstrap-preflight.json")
    && /^ {10}include-hidden-files:\s*true\s*$/mu.test(prepareBlock)
  );
  const expectedPublishCalls = [
    'publish_one "@prooftape/schema" ".evidence/release/prooftape-schema-0.1.0-alpha.1.tgz"',
    'publish_one "@prooftape/core" ".evidence/release/prooftape-core-0.1.0-alpha.1.tgz"',
    'publish_one "@prooftape/hook" ".evidence/release/prooftape-hook-0.1.0-alpha.1.tgz"',
    'publish_one "prooftape" ".evidence/release/prooftape-0.1.0-alpha.1.tgz"',
  ];
  let publishPosition = -1;
  const orderedCalls = expectedPublishCalls.every((call) => {
    const index = publishBlock.indexOf(call, publishPosition + 1);
    if (index < 0) return false;
    publishPosition = index;
    return true;
  });
  const provenancePublishOrder = (
    orderedCalls
    && publishBlock.includes(
      'npm publish "$2" --access public --provenance --tag alpha',
    )
  );
  const immediateTokenRevocation = (
    publishBlock.includes("finish_authenticated_step()")
    && publishBlock.includes("trap finish_authenticated_step EXIT")
    && publishBlock.indexOf("trap finish_authenticated_step EXIT")
      < publishBlock.indexOf("npm whoami")
    && /finish_authenticated_step\(\) \{[\s\S]*?trap - EXIT[\s\S]*?npm logout --registry=https:\/\/registry\.npmjs\.org\/[\s\S]*?record_incident[\s\S]*?\n {10}\}/u
      .test(publishBlock)
    && !publishBlock.slice(
      publishBlock.indexOf("npm whoami"),
      publishBlock.indexOf("finish_authenticated_step()"),
    ).includes("trap - EXIT")
  );
  const tokenNotRetained = (
    publishBlock.includes("set +x")
    && !publishBlock.includes("set -x")
    && (text.match(/package-manager-cache:\s*false/gu)?.length ?? 0) === 2
    && !/actions\/cache@/u.test(text)
    && !/^\s+path:\s*.*(?:NODE_AUTH_TOKEN|NPM_BOOTSTRAP_TOKEN|\.npmrc|\$HOME)/gmu
      .test(text)
  );
  const cryptographicProvenanceVerification = (
    publishBlock.includes("npm audit signatures")
  );
  const registryIdentityVerification = (
    publishBlock.includes("npm-bootstrap-verify.mjs postpublish")
    && publishBlock.includes(
      "Verify registry bytes, metadata, alpha tag, and provenance identity",
    )
  );
  const incidentHandling = (
    publishBlock.includes("incident_args=(")
    && publishBlock.includes(
      'node scripts/npm-bootstrap-verify.mjs "${incident_args[@]}"',
    )
    && publishBlock.includes("npm-bootstrap-incident.json")
    && publishBlock.includes('--failed-phase "${failed_phase}"')
    && publishBlock.includes("trap finish_authenticated_step EXIT")
    && publishBlock.includes("if: ${{ failure() }}")
    && /name:\s*prooftape-0\.1\.0-alpha\.1-npm-bootstrap-incident[\s\S]*?path:\s*\.evidence\/npm-bootstrap-incident\.json\s*\r?\n\s*if-no-files-found:\s*error/u
      .test(publishBlock)
  );
  const nonRerunnable = (
    registryAbsencePreflight
    && (text.match(/npm-bootstrap-verify\.mjs preflight/gu)?.length ?? 0) === 2
  );
  const failures = [];
  if (!manualDispatch) failures.push("bootstrap must use only workflow_dispatch");
  if (!tagIsExact) failures.push(`bootstrap must validate and check out exact tag ${exactTag}`);
  if (!expectedCommitBound) {
    failures.push("bootstrap tag, checkout, and workflow SHA must equal the expected commit");
  }
  if (!tagOnMain) failures.push("bootstrap commit must be reachable from protected main");
  if (protectedEnvironment !== "npm-bootstrap") {
    failures.push("bootstrap publish must use the npm-bootstrap environment");
  }
  if (!leastPrivilegePermissions) {
    failures.push("bootstrap permissions must match the exact least-privilege maps");
  }
  if (!oidcIsolatedToPublish) {
    failures.push("id-token: write must be isolated to the bootstrap publish job");
  }
  if (!tokenIsolatedToPublishStep) {
    failures.push("the bootstrap token must appear only in one protected publish step");
  }
  if (!explicitPublishApproval) {
    failures.push("bootstrap publication requires explicit one-time-token approval inputs");
  }
  if (!actionsPinned) failures.push("bootstrap actions must use full commit SHAs");
  if (!fullGates) failures.push("bootstrap must run every release gate");
  if (!twoCleanBuilds) failures.push("bootstrap must build twice from clean source");
  if (!exactEvidenceVerification) {
    failures.push("bootstrap must verify exact release evidence before authentication");
  }
  if (!registryAbsencePreflight) {
    failures.push("bootstrap must prove all package names absent twice");
  }
  if (!hiddenReleaseEvidence) {
    failures.push("bootstrap must retain hidden dry-run and release evidence");
  }
  if (!provenancePublishOrder) {
    failures.push("bootstrap must publish the four real tarballs in dependency order");
  }
  if (!immediateTokenRevocation) {
    failures.push("bootstrap must revoke the one-time token immediately");
  }
  if (!tokenNotRetained) {
    failures.push("bootstrap token must not be traced, cached, or uploaded");
  }
  if (!cryptographicProvenanceVerification) {
    failures.push("bootstrap must cryptographically verify npm provenance");
  }
  if (!registryIdentityVerification) {
    failures.push("bootstrap must verify registry and provenance identity");
  }
  if (!incidentHandling) {
    failures.push("bootstrap must preserve partial-publication incidents");
  }
  if (!nonRerunnable) {
    failures.push("bootstrap must fail closed once any package exists");
  }
  return {
    report: {
      path: BOOTSTRAP_WORKFLOW_PATH,
      version,
      manualDispatch,
      exactTag: tagIsExact ? exactTag : "",
      expectedCommitBound,
      tagOnMain,
      protectedEnvironment,
      leastPrivilegePermissions,
      oidcIsolatedToPublish,
      tokenIsolatedToPublishStep,
      explicitPublishApproval,
      actionsPinned,
      fullGates,
      twoCleanBuilds,
      exactEvidenceVerification,
      registryAbsencePreflight,
      hiddenReleaseEvidence,
      provenancePublishOrder,
      immediateTokenRevocation,
      tokenNotRetained,
      cryptographicProvenanceVerification,
      registryIdentityVerification,
      incidentHandling,
      nonRerunnable,
      passed: failures.length === 0,
    },
    failures,
  };
}
