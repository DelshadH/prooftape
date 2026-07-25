const RELEASE_WORKFLOW_PATH = ".github/workflows/release.yml";

function escapeRegExp(value) {
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

export function auditReleaseWorkflow(text, version) {
  const exactTag = `v${version}`;
  const onBlock = /^on:\s*\r?\n([\s\S]*?)^permissions:/mu.exec(text)?.[1] ?? "";
  const topPermissions = /^permissions:\s*\r?\n([\s\S]*?)^env:/mu.exec(text)?.[1] ?? "";
  const prepareBlock = /^  prepare:\s*\r?\n([\s\S]*?)^  publish:/mu.exec(text)?.[1] ?? "";
  const publishBlock = /^  publish:\s*\r?\n([\s\S]*)$/mu.exec(text)?.[1] ?? "";
  const events = [
    ...onBlock.matchAll(/^ {2}([a-z_]+):/gmu),
  ].map((match) => match[1]);
  const manualDispatch = (
    events.length === 1
    && events[0] === "workflow_dispatch"
  );
  const contentsRead = (
    /^ {2}contents:\s*read\s*$/mu.test(topPermissions)
    && !/\bcontents:\s*write\b/u.test(text)
  );
  const oidc = (
    /^ {6}id-token:\s*write\s*$/mu.test(publishBlock)
  );
  const environmentMatch = /^ {4}environment:\s*(\S+)\s*$/mu.exec(publishBlock);
  const protectedEnvironment = environmentMatch?.[1] ?? "";
  const tagIsExact = (
    text.includes(`RELEASE_VERSION: ${JSON.stringify(version)}`)
    && text.includes(`default: ${exactTag}`)
    && text.includes("ref: ${{ inputs.tag }}")
    && text.includes('EXPECTED_TAG="v${RELEASE_VERSION}"')
    && text.includes('if [[ "${PROOFTAPE_RELEASE_TAG}" != "${EXPECTED_TAG}" ]]')
  );
  const tagBoundRun = (
    text.includes("PROOFTAPE_RELEASE_REF: ${{ github.ref }}")
    && text.includes('EXPECTED_REF="refs/tags/${EXPECTED_TAG}"')
    && text.includes('if [[ "${PROOFTAPE_RELEASE_REF}" != "${EXPECTED_REF}" ]]')
  );
  const reviewableEvidenceBeforePublish = (
    /^ {4}needs:\s*prepare\s*$/mu.test(publishBlock)
    && prepareBlock.includes("actions/upload-artifact@")
    && publishBlock.includes("actions/download-artifact@")
    && !/^ {4}environment:/mu.test(prepareBlock)
  );
  const hiddenReleaseEvidence = (
    prepareBlock.includes("path: .evidence/release")
    && /^ {10}include-hidden-files:\s*true\s*$/mu.test(prepareBlock)
  );
  const oidcIsolatedToPublish = (
    !/\bid-token:\s*write\b/u.test(topPermissions)
    && !/\bid-token:\s*write\b/u.test(prepareBlock)
    && /^ {6}id-token:\s*write\s*$/mu.test(publishBlock)
  );
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
  const tokenless = (
    !/\b(?:NODE_AUTH_TOKEN|NPM_TOKEN)\b/u.test(text)
    && !/\$\{\{\s*secrets\./u.test(text)
  );
  const actionPins = [
    ...text.matchAll(/^\s*(?:-\s+)?uses:\s+\S+@(\S+)/gmu),
  ];
  const actionsPinned = (
    actionPins.length > 0
    && actionPins.every((match) => /^[a-f0-9]{40}$/u.test(match[1]))
  );
  const expectedTarballs = [
    "prooftape-schema",
    "prooftape-core",
    "prooftape-hook",
    "prooftape",
  ].map((name) => `${name}-${version}.tgz`);
  let publishPosition = -1;
  const provenancePublish = expectedTarballs.every((filename) => {
    const pattern = new RegExp(
      `npm publish \\.evidence/release/${escapeRegExp(filename)}`
        + " --access public --provenance --tag alpha",
      "u",
    );
    const match = pattern.exec(text.slice(publishPosition + 1));
    if (!match) return false;
    publishPosition += match.index + match[0].length + 1;
    return true;
  });
  const npmFloor = (
    text.includes("Require npm 11.5.1 or newer")
    && text.includes('"11.5.1"')
  );

  const report = {
    path: RELEASE_WORKFLOW_PATH,
    version,
    manualDispatch,
    contentsRead,
    oidc,
    protectedEnvironment,
    exactTag: tagIsExact ? exactTag : "",
    tagBoundRun,
    reviewableEvidenceBeforePublish,
    hiddenReleaseEvidence,
    oidcIsolatedToPublish,
    leastPrivilegePermissions,
    tokenless,
    provenancePublish,
    passed: (
      manualDispatch
      && contentsRead
      && oidc
      && protectedEnvironment === "npm-release"
      && tagIsExact
      && tagBoundRun
      && reviewableEvidenceBeforePublish
      && hiddenReleaseEvidence
      && oidcIsolatedToPublish
      && leastPrivilegePermissions
      && tokenless
      && actionsPinned
      && provenancePublish
      && npmFloor
    ),
  };
  const failures = [];
  if (!manualDispatch) failures.push("release must use only workflow_dispatch");
  if (!contentsRead) failures.push("release must grant contents: read");
  if (!oidc) failures.push("release must grant id-token: write");
  if (protectedEnvironment !== "npm-release") {
    failures.push("release must use the npm-release environment");
  }
  if (!tagIsExact) failures.push(`release must validate and check out exact tag ${exactTag}`);
  if (!tagBoundRun) failures.push("release workflow run must be bound to the exact tag ref");
  if (!reviewableEvidenceBeforePublish) {
    failures.push("release evidence must be uploaded before the protected publish job");
  }
  if (!hiddenReleaseEvidence) {
    failures.push("release upload must include the hidden .evidence directory");
  }
  if (!oidcIsolatedToPublish) {
    failures.push("id-token: write must be isolated to the protected publish job");
  }
  if (!leastPrivilegePermissions) {
    failures.push("release permissions must match the exact least-privilege maps");
  }
  if (!tokenless) failures.push("release must not use npm tokens or workflow secrets");
  if (!actionsPinned) failures.push("release actions must use full commit SHAs");
  if (!provenancePublish) {
    failures.push("release must publish all four tarballs in dependency order with provenance");
  }
  if (!npmFloor) failures.push("release must require npm 11.5.1 or newer");
  return { report, failures };
}
