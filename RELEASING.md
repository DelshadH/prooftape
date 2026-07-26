# Releasing ProofTape

Publishing from a developer workstation is prohibited. The only supported
publication path is `.github/workflows/release.yml` running on a GitHub-hosted
runner in the protected `npm-release` environment with npm trusted publishing.
No npm token belongs in GitHub, local configuration, or the workflow.

The release run has two jobs. The read-only `prepare` job rebuilds and uploads
the tarballs, checksums, package manifest, smoke results, and SBOM. Only after
that evidence exists may the `publish` job run in `npm-release`. Only `publish`
receives `id-token: write`.

## One-time trusted-publisher setup

For each package (`@prooftape/schema`, `@prooftape/core`, `@prooftape/hook`, and
`prooftape`), configure npm trusted publishing with:

- repository owner `DelshadH`;
- repository name `prooftape`;
- workflow filename `release.yml`;
- GitHub environment `npm-release`.

The `npm-release` GitHub environment was read back on 2026-07-26. It permits
only tag `v0.1.0-alpha.1` and contains no secret or variable. It has no required
human reviewer. An active no-bypass tag ruleset permits the owner-authorized
creation of
`v0.1.0-alpha.1` but prevents its later update or deletion.

### Current first-publish blocker

As of 2026-07-26, registry lookups for all four package names return `E404`,
and `npm whoami` reports no authenticated account.
npm requires a package to exist before a trusted publisher can be configured.
The tokenless workflow therefore cannot authenticate the first publication,
even though first publications may carry provenance.

**REGISTRY AUTHENTICATION UNAVAILABLE**

This is a registry-only limitation, not a technical alpha-release or GitHub
release blocker. Do not silently add a token or publish from a workstation.
The applicable npm requirements are documented in
[trusted publishing](https://docs.npmjs.com/trusted-publishers/) and
[`npm trust`](https://docs.npmjs.com/cli/v11/commands/npm-trust/).

## Technical review and publication order

1. Freeze the exact SHA, complete the required independent AI review, remediate
   validated blockers, and merge only after all exact-head checks pass.
2. From a fresh clone of the reviewed commit, reproduce the non-publishing
   gates:

   ```bash
   npm ci --ignore-scripts
   npm run check
   npm run smoke:package
   npm run smoke:examples
   npm run corpus
   npm run security
   npm run release:prepare
   ```

3. Inspect `.evidence/release/package-manifest.json`, `SHA256SUMS`,
   `sbom.cdx.json`, and `smoke-results.json`. Confirm the manifest commit is the
   reviewed commit and every tarball contains only `package.json`, `README.md`,
   `LICENSE`, and intended `dist` files.
4. Present the release decision packet. If the owner says `DO NOT PUBLISH`,
   leave the verified commit intact and stop. If the owner says `PUBLISH`,
   create the immutable release tag:

   ```bash
   git tag -a v0.1.0-alpha.1 -m "ProofTape 0.1.0-alpha.1"
   git push origin v0.1.0-alpha.1
   ```

5. Create the GitHub release with the verified tarballs, checksums, SBOM, and
   release notes. If registry authentication is available, dispatch the
   protected workflow and supply the exact tag:

   ```bash
   gh workflow run release.yml --ref v0.1.0-alpha.1 -f tag=v0.1.0-alpha.1
   gh run watch --exit-status
   ```

   Both `--ref` and `tag` must name the same exact release tag. The workflow
   rejects another triggering ref before checkout, and the environment permits
   no branch deployment.

6. If registry authentication remains unavailable, retain the verified GitHub
   release and report the registry-only limitation without changing the
   technical assessment.
7. After npm publication, confirm all four registry versions use the `alpha`
   distribution tag, expose provenance, and match the release notes. Do not
   move `latest` during the alpha.

The npm registry does not permit overwriting a published name and version. A
failed partial publish is handled as an incident; rerunning must not pretend the
four-package set was atomic.

## Correction, deprecation, and rollback

A bad npm version cannot be replaced. Stop the workflow, deprecate every
affected package version through the npm website, and publish a corrected new
prerelease version from a newly reviewed commit and tag. Replace any repository
workflow pins that refer to compromised code. If artifact integrity, publisher
identity, or source provenance is in doubt, follow
[the compromised-release procedure](docs/compromised-release.md) and issue a
GitHub security advisory.
