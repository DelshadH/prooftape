# Releasing ProofTape

Publishing from a developer workstation is prohibited. The only supported
publication path is `.github/workflows/release.yml` running on a GitHub-hosted
runner in the protected `npm-release` environment with npm trusted publishing.
No npm token belongs in GitHub, local configuration, or the workflow.

## One-time trusted-publisher setup

For each package (`@prooftape/schema`, `@prooftape/core`, `@prooftape/hook`, and
`prooftape`), configure npm trusted publishing with:

- repository owner `DelshadH`;
- repository name `prooftape`;
- workflow filename `release.yml`;
- GitHub environment `npm-release`.

In GitHub, create the `npm-release` environment, restrict it to the protected
release tag, disallow administrators from bypassing its rules, and require a
maintainer who did not author the release commit to approve deployment.

### Current first-publish blocker

As of 2026-07-25, registry lookups for all four package names return `E404`.
npm requires a package to exist before a trusted publisher can be configured.
The tokenless workflow therefore cannot authenticate the first publication,
even though first publications may carry provenance. Do not dispatch the release
workflow until this bootstrap conflict has an explicitly reviewed resolution.
In particular, do not silently add an npm token or publish from a workstation
to make the workflow green.

This is an external readiness blocker, not a code failure. The applicable npm
requirements are documented in
[trusted publishing](https://docs.npmjs.com/trusted-publishers/) and
[`npm trust`](https://docs.npmjs.com/cli/v11/commands/npm-trust/).

## Review and approval order

1. Resolve and review the first-publish blocker above.
2. Merge only a reviewed release PR after all required checks pass.
3. From a fresh clone of the reviewed commit, reproduce the non-publishing
   gates:

   ```bash
   npm ci --ignore-scripts
   npm run check
   npm run smoke:package
   npm run security
   npm run release:prepare
   ```

4. Inspect `.evidence/release/package-manifest.json`, `SHA256SUMS`,
   `sbom.cdx.json`, and `smoke-results.json`. Confirm the manifest commit is the
   reviewed commit and every tarball contains only `package.json`, `README.md`,
   `LICENSE`, and intended `dist` files.
5. Create the immutable release tag only after review approval:

   ```bash
   git tag -a v0.1.0-alpha.1 -m "ProofTape 0.1.0-alpha.1"
   git push origin v0.1.0-alpha.1
   ```

6. Dispatch the protected workflow and supply the exact tag:

   ```bash
   gh workflow run release.yml --ref main -f tag=v0.1.0-alpha.1
   gh run watch --exit-status
   ```

7. The independent environment reviewer checks the tag, evidence artifact, and
   workflow diff before approving the publish job.
8. After publication, confirm all four registry versions use the `alpha`
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
