const RELEASE_WORKFLOW_PATH = ".github/workflows/release.yml";

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

export function auditReleaseWorkflow(text, version) {
  const exactTag = `v${version}`;
  const onBlock = /^on:\s*\r?\n([\s\S]*?)^permissions:/mu.exec(text)?.[1] ?? "";
  const events = [
    ...onBlock.matchAll(/^ {2}([a-z_]+):/gmu),
  ].map((match) => match[1]);
  const manualDispatch = (
    events.length === 1
    && events[0] === "workflow_dispatch"
  );
  const contentsRead = (
    /^permissions:\s*\r?\n(?:(?: {2}.+)?\r?\n)*? {2}contents:\s*read\s*$/mu
      .test(text)
    && !/\bcontents:\s*write\b/u.test(text)
  );
  const oidc = (
    /^permissions:\s*\r?\n(?:(?: {2}.+)?\r?\n)*? {2}id-token:\s*write\s*$/mu
      .test(text)
  );
  const environmentMatch = /^\s{4}environment:\s*(\S+)\s*$/mu.exec(text);
  const protectedEnvironment = environmentMatch?.[1] ?? "";
  const tagIsExact = (
    text.includes(`RELEASE_VERSION: ${JSON.stringify(version)}`)
    && text.includes(`default: ${exactTag}`)
    && text.includes("ref: ${{ inputs.tag }}")
    && text.includes('EXPECTED_TAG="v${RELEASE_VERSION}"')
    && text.includes('if [[ "${PROOFTAPE_RELEASE_TAG}" != "${EXPECTED_TAG}" ]]')
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
    tokenless,
    provenancePublish,
    passed: (
      manualDispatch
      && contentsRead
      && oidc
      && protectedEnvironment === "npm-release"
      && tagIsExact
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
  if (!tokenless) failures.push("release must not use npm tokens or workflow secrets");
  if (!actionsPinned) failures.push("release actions must use full commit SHAs");
  if (!provenancePublish) {
    failures.push("release must publish all four tarballs in dependency order with provenance");
  }
  if (!npmFloor) failures.push("release must require npm 11.5.1 or newer");
  return { report, failures };
}
