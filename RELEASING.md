# Releasing ProofTape

Publishing from a developer workstation is prohibited. ProofTape has two
GitHub-hosted publication paths:

- `.github/workflows/npm-bootstrap.yml` is the manual, one-time exception for
  creating the four real `0.1.0-alpha.1` package records with a temporary
  granular npm token and GitHub provenance.
- `.github/workflows/release.yml` is the permanent tokenless OIDC path for
  versions after `0.1.0-alpha.1`.

Do not publish empty, placeholder, or unrelated packages. Do not create
independently constructed package archives. The first registry versions must
be the checksum-verified tarballs built from the reviewed ProofTape source.

No tag, GitHub release, npm package, or token exception is authorized until the
owner gives the final publication decision.

## Why a one-time token is necessary

npm requires a package to exist before its trusted publisher can be configured.
All four ProofTape names are absent, so tokenless OIDC cannot create their first
versions. npm does permit a token-authenticated publish from GitHub-hosted CI to
carry provenance when the job has `id-token: write`.

The bootstrap workflow therefore publishes the genuine reviewed
`0.1.0-alpha.1` once. It is not a second release path and cannot be rerun after
any expected package version exists.

## Technical bootstrap guarantees

The bootstrap workflow:

1. accepts only `workflow_dispatch` on the exact `v0.1.0-alpha.1` tag;
2. requires the tag, workflow SHA, checkout, and supplied full commit SHA to
   agree, and requires that commit to be reachable from protected `main`;
3. installs without lifecycle scripts and runs typecheck, all tests, package
   smoke, examples, killer demo, terminal recording, real upgrades, corpus,
   performance, security, and release preparation;
4. uses release preparation's two independent clean-source builds;
5. checks the exact eight-file release evidence set, every retained checksum,
   the four immutable tarball SHA-256 values, package identities, versions,
   repository metadata, internal dependency versions, and safe tar members;
6. proves all four package names are absent before evidence upload and again
   immediately before authentication;
7. exposes `NPM_BOOTSTRAP_TOKEN` to one protected step only, publishes schema,
   core, hook, then CLI with public access, provenance, and the `alpha` tag, and
   invokes npm logout from an exit trap on success, authentication failure, or
   any partial publish failure so the token-revocation attempt cannot be
   bypassed by an earlier command;
8. records an interrupted sequence as a publication incident and refuses a
   rerun once any expected version exists; and
9. downloads registry bytes, verifies SHA-256, `dist.integrity`, `dist.shasum`,
   package contents, repository identity, provenance subject, workflow, tag,
   commit, and `alpha` dist-tag, then runs `npm audit signatures`.

The secret is never printed, cached, uploaded, copied into release evidence, or
available to the preparation and verification steps.

## npm account setup

Complete these owner-only steps on [npmjs.com](https://www.npmjs.com/) after
the workflow commit has passed independent review:

1. Use an npm account with two-factor authentication enabled.
2. Create the free public organization `prooftape`, or confirm that the account
   owns it and can publish public packages under `@prooftape`.
3. Confirm the same account can create the unscoped public package `prooftape`.
4. From **Account → Access Tokens**, create a granular token named
   `prooftape-alpha1-bootstrap`:
   - expiration: the minimum available, one day;
   - bypass 2FA: enabled, because unattended publishing otherwise fails;
   - packages and scopes: read and write;
   - selection: **All Packages**, because npm cannot select package records
     that do not exist yet.

`All Packages` is broader than the final four-package permission would be. Its
risk is bounded by the one-day expiry, protected single-run environment,
single-step exposure, automatic logout, and immediate manual deletion. If the
account owns unrelated packages and this temporary breadth is unacceptable,
stop and use a dedicated npm owner account instead.

## GitHub environment setup

In **GitHub repository → Settings → Environments**, create `npm-bootstrap`.
Disable administrator bypass and restrict deployments to the exact tag
`v0.1.0-alpha.1`. Add an owner reviewer if GitHub plan support is available.

Only immediately before the authorized run, add environment secret
`NPM_BOOTSTRAP_TOKEN`. Never add it as a repository or organization secret.

## Pre-publication dry run

Before any tag or real token exists, independently run from a clean checkout of
the proposed workflow commit:

```bash
npm ci --ignore-scripts
npm run check
npm run smoke:package
npm run smoke:examples
npm run corpus
npm run security
npm run release:prepare
node scripts/npm-bootstrap-verify.mjs preflight \
  --dir .evidence/release \
  --commit FULL_WORKFLOW_COMMIT_SHA \
  --out .evidence/npm-bootstrap-preflight.json \
  --replace
```

This uses no npm credential and aborts if any package name has appeared. Review
the JSON receipt, tarball hashes, package manifest, SBOM, and smoke results.
The exact diff must then receive independent AI review and exact-head CI.

## Owner-authorized first publication

Only after the owner says `PUBLISH`:

1. create immutable tag `v0.1.0-alpha.1` at the final reviewed workflow commit;
2. create the GitHub release from the verified evidence;
3. add the one-day token to `npm-bootstrap`; and
4. dispatch the bootstrap once:

```bash
gh workflow run npm-bootstrap.yml \
  --ref v0.1.0-alpha.1 \
  -f tag=v0.1.0-alpha.1 \
  -f expected_commit=FULL_WORKFLOW_COMMIT_SHA \
  -f publish=true \
  -f confirm_token_exception=ONE_TIME_TOKEN_AUTHORIZED
gh run watch --exit-status
```

After the run, confirm npm logout succeeded, delete `NPM_BOOTSTRAP_TOKEN` from
the GitHub environment, and confirm the token is absent under npm **Access
Tokens**. npm documents that revocation can take up to one hour; do not treat
the secret deletion alone as registry revocation.

If publication stops after at least one package succeeds, do not rerun. Preserve
the incident artifact and logs, revoke and delete the bootstrap token, follow
[the compromised-release procedure](docs/compromised-release.md), and abandon
or deprecate the incomplete version set. Build and publish a coherent set of all
four packages under a new reviewed prerelease version; never publish only the
previously unpublished remainder.

## Configure permanent trusted publishing

After all four real packages exist, open each package on npmjs.com and select
**Settings → Trusted Publisher → GitHub Actions**:

- organization or user: `DelshadH`;
- repository: `prooftape`;
- workflow filename: `release.yml`;
- environment: `npm-release`;
- allowed action: `npm publish`.

Then select **Require two-factor authentication and disallow tokens** under
Publishing access. Delete any remaining bootstrap token and remove the
`npm-bootstrap` environment secret.

Do not run `release.yml` for `0.1.0-alpha.1`; npm versions are immutable and the
bootstrap already consumed it. Begin the permanent OIDC workflow with the next
independently reviewed prerelease.

## Correction, deprecation, and rollback

A bad npm version cannot be replaced. Stop the workflow, deprecate every
affected package version through npmjs.com, and publish a corrected new
prerelease from a newly reviewed commit and tag. Replace affected workflow pins.
If artifact integrity, publisher identity, source provenance, or token
revocation is in doubt, follow
[the compromised-release procedure](docs/compromised-release.md) and issue a
GitHub security advisory.
