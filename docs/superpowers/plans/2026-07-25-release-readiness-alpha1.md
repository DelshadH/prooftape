# ProofTape 0.1.0-alpha.1 Release Readiness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prepare ProofTape 0.1.0-alpha.1 for independent review without publishing or merging it.

**Architecture:** Preserve the accepted PT-G07 boundary and add executable evidence around it. Freeze all public version-1 JSON shapes, expose the trust limitation at every CLI/Action/workflow boundary, build release artifacts from exact workspace versions, and validate them from a separate consumer repository before opening a draft PR.

**Tech Stack:** Node.js 22/24, strict TypeScript, ESM, npm workspaces, Vitest, GitHub Actions, CycloneDX npm SBOM, GitHub OIDC npm provenance.

## Global Constraints

- PT-G07 is resolved through contract narrowing, not forgery prevention.
- `observationAuthenticity: "not-established"` remains mandatory in every version-1 capsule, both report summaries, reproduction manifests, generated reproduction documentation, CLI verdict, Action output, and workflow summary.
- Exit code 0 continues to mean “no blocking differences observed in captured supported calls.”
- Do not publish or merge during this phase.
- Work only on `codex/release-readiness-alpha1`; push it and keep its PR draft/open.
- Do not add dynamic imports, computed members, optional calls, pnpm, Yarn, dashboards, AI explanations, or multi-dependency support.
- Add no runtime dependency unless the standard library and existing packages are insufficient.
- Every behavior change follows a witnessed red-green test cycle.
- Public packages use one exact version: `0.1.0-alpha.1`.
- Publication may run only from a protected `npm-release` GitHub environment with OIDC provenance.

---

### Task 1: End-to-end adversarial false-clean proof

**Files:**
- Create: `packages/cli/test/adversarial-compare.test.ts`
- Modify: `docs/quality-plan.md`

**Interfaces:**
- Consumes: `runCli(args, io): Promise<number>` and the real `compare` command.
- Produces: one Git-backed base/candidate fixture proving a forged candidate can produce exit 0 only with an inseparable authenticity warning.

- [ ] **Step 1: Write the failing end-to-end test**

Create a temporary npm/Git repository with:

```ts
const baseDependency = 'export const value = () => "base-A";\n';
const candidateDependency = 'export const value = () => "candidate-B";\n';
```

Commit the base with a non-attacking `test.mjs`. Commit the candidate with a `test.mjs` that:

```js
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { value } from "fixture";

const observed = value();
process.stdout.write(`${observed}\n`);
const rawConfig = process.env.PROOFTAPE_CONFIG;
if (rawConfig) {
  const config = JSON.parse(rawConfig);
  const name = readdirSync(config.outputDirectory).find((entry) =>
    entry.startsWith(`raw-${config.sessionId}-`) && entry.endsWith(".jsonl")
  );
  if (!name) throw new Error("raw stream was not found");
  const path = join(config.outputDirectory, name);
  const record = JSON.parse(readFileSync(path, "utf8").trim());
  writeFileSync(path, `${JSON.stringify({
    ...record,
    call: { ...record.call, value: "base-A" },
  })}\n`);
}
```

Before invoking ProofTape, run the candidate plainly and assert stdout is exactly `candidate-B`. Then invoke:

```ts
const exitCode = await runCli([
  "compare",
  "--base-ref", base,
  "--candidate-ref", candidate,
  "--dependency", "fixture",
  "--command", `"${process.execPath}" test.mjs`,
  "--report", "false-clean-report.json",
], { cwd: repository, ...streams.io });
```

Assert literal outcomes:

```ts
expect(exitCode).toBe(0);
expect(streams.read().stdout).toContain(
  "No blocking differences observed in captured supported calls",
);
expect(streams.read().stderr).toContain(
  "Observation authenticity is not established",
);
expect(report).toMatchObject({
  verdict: "no-blocking-differences-observed",
  blockingDifferenceCount: 0,
  baseline: { observationAuthenticity: "not-established" },
  candidate: { observationAuthenticity: "not-established" },
});
```

- [ ] **Step 2: Run the test and witness RED**

For the red run, keep the candidate's real call and plain `candidate-B` output
but omit the raw-stream `writeFileSync`. The false-clean assertions must fail
with CLI exit 2 and a `behavior-changed` report. This proves the test detects
the difference unless the candidate actually forges its observation.

Run:

```bash
npx vitest run packages/cli/test/adversarial-compare.test.ts
```

Expected failure: `expected 2 to be 0`, with a real `changed-return`
difference from `base-A` to `candidate-B`.

- [ ] **Step 3: Add only the fixture mechanics needed by the test**

Enable the raw-stream overwrite shown in Step 1. Use real `npm pack`,
`npm install --ignore-scripts`, Git commits, and the built hook. Keep the
attack in candidate application code; do not mock recording, comparison,
schema parsing, or CLI output.

- [ ] **Step 4: Run the focused test and witness GREEN**

Run:

```bash
npx vitest run packages/cli/test/adversarial-compare.test.ts
```

Expected: 1 test passed, with the plain candidate proving `candidate-B` and ProofTape producing a warned false-clean result.

- [ ] **Step 5: Document the exact PT-G07 regression proof**

Add the test path and five asserted facts to `docs/quality-plan.md`. State that the test prevents future malicious-candidate overclaims; it is not a forgery mitigation.

- [ ] **Step 6: Commit**

```bash
git add packages/cli/test/adversarial-compare.test.ts docs/quality-plan.md
git commit -m "test: prove adversarial false-clean boundary"
```

### Task 2: Precise workflow and Action trust output

**Files:**
- Create: `scripts/workflow-summary.mjs`
- Create: `scripts/workflow-summary.test.ts`
- Modify: `scripts/workflow-verify.mjs`
- Modify: `scripts/action-record.mjs`
- Modify: `scripts/package-smoke.mjs`
- Modify: `packages/action/action.yml`
- Modify: `.github/workflows/prooftape.yml`
- Modify: `README.md`
- Modify: `SECURITY.md`
- Modify: `docs/architecture.md`
- Modify: `docs/formats.md`
- Modify: `docs/github.md`
- Modify: `docs/product.md`
- Modify: `docs/security-model.md`

**Interfaces:**
- Produces: `renderWorkflowSummary(report: ReportV1, exitCode: number): string`.
- Produces: Action output `observation-authenticity=not-established`.
- Consumes: `GITHUB_STEP_SUMMARY`, `ReportV1`, and the existing verifier exit contract.

- [ ] **Step 1: Write failing workflow-summary and Action-output tests**

The summary test uses a literal no-change `ReportV1` and requires:

```ts
expect(renderWorkflowSummary(report, 0)).toContain(
  "**Observation authenticity is not established.**",
);
expect(renderWorkflowSummary(report, 0)).toContain("| Base commit | aaaaa");
expect(renderWorkflowSummary(report, 0)).toContain("| Candidate commit | fffff");
expect(renderWorkflowSummary(report, 0)).toContain("| Exit code | `0` |");
expect(renderWorkflowSummary(report, 0)).toContain(
  "Base protection does not establish observation authorship",
);
```

Extend package smoke so its real `GITHUB_OUTPUT` must contain:

```text
observation-authenticity=not-established
```

- [ ] **Step 2: Run focused tests and witness RED**

Run:

```bash
npx vitest run scripts/workflow-summary.test.ts
npm run smoke:package
```

Expected failures: missing `workflow-summary.mjs` export and missing Action output.

- [ ] **Step 3: Implement the summary renderer**

`renderWorkflowSummary` returns bounded Markdown with:

```js
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
  `| Base capsule SHA-256 | \`${cell(report.baseline.capsuleHash)}\` |`,
  `| Candidate capsule SHA-256 | \`${cell(report.candidate.capsuleHash)}\` |`,
  `| Verdict | \`${cell(report.verdict)}\` |`,
  `| Exit code | \`${exitCode}\` |`,
  "",
  "The protected base capsule is retained outside candidate execution.",
  "Capsule bytes matched their producing-job hashes during artifact transport.",
  "Capsule structure was validated before observations were compared.",
  "Base protection and transport integrity do not establish observation authorship.",
  "",
].join("\n");
```

Escape `|`, CR, LF, and control characters in all dynamic cells and cap each displayed value at 1,000 characters.

- [ ] **Step 4: Wire real workflow and Action outputs**

After `runCli` produces `report.json`, parse it with `parseReport`, append the renderer output to `GITHUB_STEP_SUMMARY`, and retain existing exit semantics. In `action-record.mjs`, append:

```js
`observation-authenticity=not-established\n`
```

Declare the matching composite Action output in `packages/action/action.yml`.

- [ ] **Step 5: Rename ambiguous workflow terms**

Rename:

```yaml
verify:
  name: Validate capsule integrity and compare observations
```

Use step names “Validate capsule structure, verify transport hashes, and compare” and “Enforce comparison exit contract.”

- [ ] **Step 6: Audit assurance terminology**

Run:

```bash
rg -n -i -uu --glob '!node_modules/**' --glob '!dist/**' --glob '!.git/**' --glob '!.evidence/**' '(verified|trusted|untrusted|immutable|integrity|authentic|tamper|secure|proof|attestation)' .
```

For each occurrence, name the property: Git revision, base retention, schema structure, byte hash, artifact transport, or unsupported observation authenticity. Remove any phrase that can make “validated capsule” mean “authenticated observation.”

- [ ] **Step 7: Run focused and full tests**

```bash
npx vitest run scripts/workflow-summary.test.ts scripts/evidence-output.test.ts
npm run smoke:package
npm run check
```

Expected: all commands exit 0 and Action smoke observes the new output.

- [ ] **Step 8: Commit**

```bash
git add scripts packages/action .github/workflows/prooftape.yml README.md SECURITY.md docs
git commit -m "feat: expose workflow authenticity boundary"
```

### Task 3: Freeze public schema version 1

**Files:**
- Create: `fixtures/schema/reproduction-manifest-v1.json`
- Create: `docs/schema-compatibility.md`
- Modify: `packages/schema/src/index.ts`
- Modify: `packages/schema/test/schema.test.ts`
- Modify: `packages/core/src/repro.ts`
- Modify: `packages/core/test/repro.test.ts`
- Modify: `scripts/package-smoke.mjs`
- Modify: `docs/formats.md`
- Modify: `README.md`

**Interfaces:**
- Produces: `ReproductionManifestV1`.
- Produces: `parseReproductionManifest(input: string | Uint8Array): ReproductionManifestV1`.
- Produces: `REPRODUCTION_MANIFEST_LIMITS.maxBytes = 64 * 1024`.

- [ ] **Step 1: Write failing reproduction-manifest schema tests**

Add a literal golden object:

```ts
const reproductionManifest: ReproductionManifestV1 = {
  schemaVersion: "1",
  kind: "prooftape-reproduction-manifest",
  observationAuthenticity: "not-established",
  matchKey: "fixture:parse:test.mjs:test:1",
  files: {
    "README.md": "1".repeat(64),
    "base-package.json": "2".repeat(64),
    "candidate-package.json": "3".repeat(64),
    "input.json": "4".repeat(64),
    "repro.mjs": "5".repeat(64),
  },
};
```

Require parsing of the committed golden and rejection of:

```ts
{ ...reproductionManifest, schemaVersion: "2" }
{ ...reproductionManifest, injected: true }
{ ...reproductionManifest, observationAuthenticity: "established" }
{ ...reproductionManifest, files: { ...reproductionManifest.files, extra: "6".repeat(64) } }
```

Also add explicit missing-marker and invalid-marker cases for capsule metadata and both report evidence summaries.

- [ ] **Step 2: Run schema tests and witness RED**

```bash
npx vitest run packages/schema/test/schema.test.ts
```

Expected failure: `ReproductionManifestV1` and `parseReproductionManifest` are not exported.

- [ ] **Step 3: Implement a strict bounded parser**

Require exactly the five generated filenames, 64-character lowercase hex hashes, schema version `"1"`, kind `"prooftape-reproduction-manifest"`, and authenticity `"not-established"`. Reject unknown top-level fields and unknown/missing file entries.

- [ ] **Step 4: Make the generator self-validate**

Construct the manifest as `ReproductionManifestV1`, canonicalize it, and call `parseReproductionManifest(manifest)` before persistence. Keep the manifest hash over canonical bytes without the file newline.

- [ ] **Step 5: Add packed-distribution golden compatibility**

In `scripts/package-smoke.mjs`, resolve `@prooftape/schema` from the clean temporary install using:

```js
const installedRequire = createRequire(join(install, "package.json"));
const installedSchemaUrl = pathToFileURL(
  installedRequire.resolve("@prooftape/schema"),
).href;
const {
  parseCapsule,
  parseReport,
  parseReproductionManifest,
} = await import(installedSchemaUrl);
```

Read and parse all three committed golden files. This proves the schema dependency shipped with the packed CLI can read every frozen public artifact.

- [ ] **Step 6: Declare the compatibility policy**

Document:

- current JSON shapes are stable public version 1 at the first published alpha;
- all artifacts from unpublished `0.0.0` development builds are unsupported;
- no required-field additions, removals, renames, semantic reinterpretations, or canonicalization changes are permitted within v1;
- a schema v2 is required for any incompatible shape, authenticity model, canonicalization, hash scope, or verdict/exit semantic change;
- readers reject future versions instead of guessing;
- canonical JSON has recursively sorted keys and no insignificant whitespace;
- persisted public files have one trailing LF, while capsule/reproduction manifest semantic hashes exclude that LF and workflow transport hashes include complete file bytes.

- [ ] **Step 7: Run tests**

```bash
npx vitest run packages/schema/test/schema.test.ts packages/core/test/repro.test.ts
npm run smoke:package
npm run check
```

- [ ] **Step 8: Commit**

```bash
git add fixtures/schema packages/schema packages/core scripts/package-smoke.mjs docs README.md
git commit -m "feat: freeze public schema version 1"
```

### Task 4: Prepare coherent alpha packages and clean-room artifacts

**Files:**
- Create: `scripts/release-pack.mjs`
- Create: `scripts/release-pack.test.ts`
- Create: `packages/schema/README.md`
- Create: `packages/core/README.md`
- Create: `packages/hook/README.md`
- Create: `packages/cli/README.md`
- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `packages/schema/package.json`
- Modify: `packages/core/package.json`
- Modify: `packages/hook/package.json`
- Modify: `packages/cli/package.json`
- Modify: `packages/cli/src/main.ts`
- Modify: `packages/cli/test/cli.test.ts`
- Modify: `scripts/package-smoke.mjs`
- Modify: `.gitignore`

**Interfaces:**
- Produces: `npm run release:prepare`.
- Produces under `.evidence/release/`: four tarballs, `package-manifest.json`, `SHA256SUMS`, `sbom.cdx.json`, and `smoke-results.json`.

- [ ] **Step 1: Write failing version and release-pack tests**

Require:

```ts
expect(await runCli(["--version"], io)).toBe(0);
expect(streams.read().stdout).toBe("0.1.0-alpha.1\n");
```

The release-pack test invokes:

```bash
node scripts/release-pack.mjs --out .evidence/release-test --replace
```

and asserts the evidence object contains exactly:

```json
{
  "version": "0.1.0-alpha.1",
  "packages": [
    "@prooftape/schema",
    "@prooftape/core",
    "@prooftape/hook",
    "prooftape"
  ],
  "smoke": {
    "help": 0,
    "version": 0,
    "record": 0,
    "diffChanged": 2,
    "diffUnchanged": 0,
    "compareChanged": 2,
    "invalidInput": 4,
    "unsupportedInput": 4
  }
}
```

- [ ] **Step 2: Witness RED**

```bash
npx vitest run packages/cli/test/cli.test.ts scripts/release-pack.test.ts
```

Expected failures: CLI still reports `0.0.0` and `release-pack.mjs` does not exist.

- [ ] **Step 3: Version all workspace packages coherently**

Set root and all four publishable package versions to `0.1.0-alpha.1`. Set every internal dependency to the exact same version:

```json
"@prooftape/schema": "0.1.0-alpha.1"
```

and equivalent exact entries for core and hook. Update the lockfile with:

```bash
npm install --package-lock-only --ignore-scripts --no-audit --no-fund
```

Set the CLI `VERSION` constant to `0.1.0-alpha.1`.

- [ ] **Step 4: Implement deterministic release preparation**

`release-pack.mjs` must:

1. require a clean checkout;
2. require coherent exact versions;
3. run `npm run build`;
4. `npm pack --json` each package into a temporary directory;
5. reject unexpected tarball paths and inspect every returned file list;
6. reject lifecycle scripts in publishable packages;
7. compute SHA-256 for every tarball;
8. install all four tarballs into an external temporary project with `--ignore-scripts`;
9. prove installed internal dependencies resolve to real package directories and versions, not workspace links;
10. run help, version, record, changed/unchanged diff, changed compare, invalid input, and explicit unsupported input cases;
11. run `npm sbom --omit=dev --sbom-format cyclonedx` in the clean installed project;
12. copy only the four tarballs and bounded JSON/text evidence into the requested ignored output directory;
13. always remove temporary projects.

Use `spawnSync` with `shell: false`, explicit argument arrays, timeouts, bounded buffers, and Windows-hidden processes.

- [ ] **Step 5: Add package-specific READMEs**

Each package README names its role, supported Node version, alpha status, Apache-2.0 license, and links to the repository trust boundary. The CLI README places this sentence before usage:

```text
Observation authenticity is not established against code under test.
```

- [ ] **Step 6: Run release evidence and inspect every package**

```bash
npm run release:prepare
```

Read `package-manifest.json`, `SHA256SUMS`, `sbom.cdx.json`, and every npm pack file entry. Confirm only package metadata, README/LICENSE, and intended `dist` files ship.

- [ ] **Step 7: Run focused and full tests**

```bash
npx vitest run packages/cli/test/cli.test.ts scripts/release-pack.test.ts
npm run smoke:package
npm run check
```

- [ ] **Step 8: Commit**

```bash
git add package.json package-lock.json packages scripts .gitignore
git commit -m "build: prepare 0.1.0-alpha.1 packages"
```

### Task 5: Publication provenance and release operations

**Files:**
- Create: `.github/workflows/release.yml`
- Create: `RELEASING.md`
- Create: `docs/release-notes-0.1.0-alpha.1.md`
- Create: `docs/compromised-release.md`
- Modify: `CHANGELOG.md`
- Modify: `docs/github.md`
- Modify: `scripts/security-audit.mjs`
- Modify: `scripts/evidence-output.test.ts`

**Interfaces:**
- Produces: a manually dispatched, protected-environment release workflow.
- Consumes: exact tag `v0.1.0-alpha.1`, environment `npm-release`, and `npm run release:prepare`.

- [ ] **Step 1: Write a failing workflow-policy test**

Extend the security gate behavior so release workflows are accepted only when they contain:

```yaml
permissions:
  contents: read
  id-token: write
environment: npm-release
```

and rejected if they use `NODE_AUTH_TOKEN`, `NPM_TOKEN`, developer-workstation publication instructions, unpinned Actions, or a ref other than an exact `v${packageVersion}` tag.

- [ ] **Step 2: Witness RED**

```bash
npx vitest run scripts/evidence-output.test.ts
npm run security
```

Expected failure: no protected provenance workflow is present in the audited workflow set.

- [ ] **Step 3: Add the protected release workflow**

The workflow:

- uses only full Action SHAs;
- has `contents: read` and `id-token: write`;
- uses `environment: npm-release`;
- checks out the exact tag selected by the dispatcher;
- rejects a tag not equal to `v0.1.0-alpha.1`;
- runs clean install, `npm run check`, package smoke, security, and release preparation;
- uploads tarballs, checksums, SBOM, manifest, and smoke results;
- publishes schema, core, hook, then CLI tarballs with `npm publish <tarball> --access public --provenance`;
- contains no npm secret because trusted publishing uses GitHub OIDC.

- [ ] **Step 4: Document clean-room, rollback, deprecation, and compromise procedures**

`RELEASING.md` gives literal commands and approval order. It prohibits workstation publishing and states npm versions cannot be overwritten. Rollback means deprecating the bad version, rotating/revoking trust as applicable, publishing a corrected new version, replacing workflow pins, and issuing a GitHub security advisory when integrity is in doubt.

Release notes begin with the authenticity limitation and alpha compatibility status before features.

- [ ] **Step 5: Verify policy**

```bash
npm run security
npm run release:prepare
git diff --check
```

- [ ] **Step 6: Commit**

```bash
git add .github/workflows/release.yml RELEASING.md docs CHANGELOG.md scripts
git commit -m "ci: prepare provenance-only alpha release"
```

### Task 6: Durable governance and maintenance policy

**Files:**
- Create: `GOVERNANCE.md`
- Create: `SUPPORT.md`
- Create: `docs/deprecation-policy.md`
- Create: `docs/maintainer-recovery.md`
- Create: `docs/adr/0001-pt-g07-observation-authenticity.md`
- Create: `docs/adr/0002-public-format-v1.md`
- Modify: `CONTRIBUTING.md`
- Modify: `SECURITY.md`
- Modify: `README.md`

**Interfaces:**
- Produces: source-controlled decisions and a manual-settings prerequisite list.

- [ ] **Step 1: Write governance and support contracts**

State:

- maintainers merge only reviewed PRs with required CI;
- one approving maintainer is required for release-affecting changes;
- security reports use private advisories;
- support covers current alpha and the latest stable release after one exists;
- unsupported instrumentation receives exit 4 rather than a compatibility promise.

- [ ] **Step 2: Record the two accepted ADRs**

ADR 0001 records:

- same-process code can forge observations;
- version 1 does not establish observation authorship;
- the accepted decision is contract narrowing;
- a stronger contract requires a collector outside candidate OS authority.

ADR 0002 records:

- the three frozen v1 artifacts;
- canonical/newline/hash rules;
- pre-publication `0.0.0` artifacts are unsupported;
- incompatible changes require v2.

- [ ] **Step 3: Add recovery and deprecation procedures**

Name recovery steps for GitHub owner access, npm owner access, OIDC trusted publisher removal, token/session revocation, branch/environment rule inspection, release deprecation, advisory publication, and successor maintainer validation. Do not place account secrets, recovery codes, or private contact details in source.

- [ ] **Step 4: Record manual repository prerequisites**

Document these settings:

- `main` requires pull requests;
- one approval and dismissal of stale reviews;
- required checks: `checks (22)`, `checks (24)`, `quality-gates`;
- no automation bypass;
- `npm-release` environment approval;
- npm trusted publisher restricted to `.github/workflows/release.yml`;
- tag `v0.1.0-alpha.1` created only after review approval.

- [ ] **Step 5: Audit links and language**

```bash
rg -n -i '(verified|trusted|untrusted|immutable|integrity|authentic|tamper|secure|proof|attestation)' README.md SECURITY.md CONTRIBUTING.md GOVERNANCE.md SUPPORT.md RELEASING.md docs
```

Ensure each occurrence names the precise protected property.

- [ ] **Step 6: Commit**

```bash
git add GOVERNANCE.md SUPPORT.md RELEASING.md README.md SECURITY.md CONTRIBUTING.md docs
git commit -m "docs: establish release maintenance policy"
```

### Task 7: Independent external consumer

**Files in separate repository `DelshadH/prooftape-consumer-example`:**
- Create: `README.md`
- Create: `package.json`
- Create: `package-lock.json`
- Create: `app.mjs`
- Create: `test.mjs`
- Create: `vendor/*.tgz`
- Create: `vendor/SHA256SUMS`
- Create: `.github/workflows/prooftape.yml`
- Create: `.github/dependabot.yml`

**Interfaces:**
- Consumes: the four packed `0.1.0-alpha.1` tarballs and the reusable workflow pinned to a full commit SHA.
- Produces: a green application test on both commits, a ProofTape exit-2 comparison, report/reproduction artifact, visible workflow summary, and authenticity warning.

- [ ] **Step 1: Create the independent repository locally**

Create it outside the monorepo. Copy the four tarballs and their checksums from `.evidence/release`. Root `devDependencies` reference all four files so exact internal alpha dependencies resolve without publication.

- [ ] **Step 2: Create base behavior**

Use `camelcase@6.3.0` and the established real-upgrade input from `fixtures/real-upgrades/camelcase/app.mjs`. The test asserts only the intentionally broad application contract that remains green across both versions.

- [ ] **Step 3: Create candidate behavior**

Upgrade to `camelcase@7.0.1`, update the lockfile, and retain the same green test. Prove the plain application output changed.

- [ ] **Step 4: Add the protected caller**

Immediately after the ProofTape workflow-pin commit, capture its exact value
with `git rev-parse HEAD`. Put that complete 40-character output after
`DelshadH/prooftape/.github/workflows/prooftape.yml@` in the external caller.
Use only `contents: read`, no secrets, exact event SHAs, dependency
`camelcase`, and direct command `node test.mjs`.

- [ ] **Step 5: Create GitHub repository and pull request**

Create public repository `DelshadH/prooftape-consumer-example`, push base to `main`, push candidate to `dependency/camelcase-7`, and open a draft PR. Do not merge it.

- [ ] **Step 6: Run and inspect external workflow**

Require:

- both ordinary tests green;
- reusable workflow exit 2;
- report names the changed return;
- reproduction matches base and differs on candidate;
- summary includes exact SHAs, versions, hashes, verdict, exit 2, and bold authenticity limitation;
- no secret or write-token use.

- [ ] **Step 7: Document Dependabot and Renovate onboarding**

Provide a Dependabot configuration and a README note showing the equivalent Renovate package rule. State that ProofTape checks are evidence for supported observed calls, not malicious-candidate attestation.

- [ ] **Step 8: Record the run in the ProofTape PR**

Add the external repository, draft PR, workflow run, artifact hashes, and remaining tarball-only limitation to the main ProofTape draft PR description.

### Task 8: Final trust-root pinning, repository settings, and draft PR

**Files:**
- Modify: `.github/workflows/prooftape.yml`
- Modify: `docs/github.md`
- Modify: `docs/quality-plan.md`
- Modify: `CHANGELOG.md`

**Interfaces:**
- Produces: a workflow commit pinned internally to the exact implementation commit and an external caller pinned to the workflow commit.

- [ ] **Step 1: Commit implementation before pinning**

Record the full implementation SHA containing summary generation, Action output, frozen schema, and alpha packaging. Update all three internal ProofTape checkout refs to that SHA and commit the workflow pin separately.

- [ ] **Step 2: Update caller examples**

Pin `docs/github.md` and the external consumer to the full workflow commit created in Step 1. Never invent or shorten a trust-root ref.

- [ ] **Step 3: Run the complete local release matrix**

```bash
npm ci --ignore-scripts
npm run check
npm run smoke:package
npm run demo
npm run demo:record
npm run real-upgrades
npm run performance
npm run security
npm run release:prepare
git diff --check
```

- [ ] **Step 4: Inspect artifacts and repository state**

Read every package manifest, checksum, SBOM metadata, external smoke result, and `git status -sb`. Confirm no credentials, build outputs, tarballs, temporary repositories, or evidence files are tracked.

- [ ] **Step 5: Push the branch**

```bash
git push -u origin codex/release-readiness-alpha1
```

- [ ] **Step 6: Open a draft PR against main**

The PR body includes:

- exact commit SHA and changed-file summary;
- witnessed red-green cycles;
- unit/integration test counts;
- exact verification commands;
- packed-package manifests and checksums;
- SBOM location;
- external-consumer PR/workflow;
- provenance plan;
- schema-v1 decision;
- every remaining limitation;
- explicit status `READY FOR 0.1.0-alpha.1 REVIEW` or `NOT READY` with blockers.

- [ ] **Step 7: Apply repository protections**

After confirming the required check names on the draft PR, configure `main` to require PRs, one approving review, stale-review dismissal, no automation bypass, and all three CI checks. Configure `npm-release` as the release workflow environment. Record any unsupported setting as a manual release prerequisite.

- [ ] **Step 8: Monitor CI and keep the PR open**

Wait for Node 22, Node 24, quality gates, release policy checks, and external consumer workflow. Fix failures on the branch through new commits. Do not merge or publish.

## Self-review

- **Spec coverage:** Tasks 1–8 cover the false-clean proof, terminology, workflow warning, Action output, schema freeze, golden artifacts, packed compatibility, coherent alpha versions, tarball inspection, clean external installation, full CLI exit matrix, checksums, SBOM, OIDC provenance, release/rollback/compromise documentation, independent consumer, governance, support, deprecation, ADRs, recovery, repository settings, branch, PR, and completion report.
- **No feature expansion:** No new JavaScript instrumentation surface, package manager, dashboard, AI layer, or multi-dependency feature appears in the plan.
- **Type consistency:** `ObservationAuthenticity` remains the literal `"not-established"`; the workflow summary consumes `ReportV1`; the new reproduction parser returns `ReproductionManifestV1`; all packages use exact version `0.1.0-alpha.1`.
- **Safety:** Publishing and merging are prohibited; release execution requires an exact tag, OIDC, and the protected `npm-release` environment.
