# Compromised release response

Use this procedure if a package, tag, workflow, provenance statement, trusted
publisher, GitHub environment, maintainer account, or release artifact may have
been compromised.

## Contain

1. Stop or cancel every release workflow run and do not retry failed publishes.
2. Disable the npm trusted-publisher entries for all four ProofTape packages.
3. Remove pending deployment approvals from the `npm-release` environment and
   revoke affected GitHub sessions, keys, apps, and credentials.
4. Preserve the workflow log, GitHub artifact, tag object, commit, npm package
   metadata, provenance bundle, registry timestamps, and audit events.

Do not delete evidence to make the registry state look clean.

## Determine scope

Compare the published tarball digests and file lists with the retained
`SHA256SUMS` and `package-manifest.json`. Verify that provenance identifies the
expected repository, `release.yml`, environment, tag commit, and GitHub-hosted
runner. Treat every package published by the same run as affected until the
dependency-ordered set is checked.

The observation-authenticity limitation is separate: a conforming but forged
candidate capsule is not evidence that the npm release itself was compromised.

## Recover and disclose

1. Deprecate affected versions through the npm website with a concise warning.
2. Publish no replacement until the trust path and protected environment have
   been rebuilt and independently reviewed.
3. Correct the issue in a new commit, version, reviewed PR, and immutable tag;
   npm versions cannot be overwritten.
4. Replace all workflow or Action pins that reference affected commits.
5. Publish a GitHub security advisory when package integrity, publisher
   identity, source provenance, or user exposure is in doubt.
6. Record the final affected versions, hashes, time window, root cause,
   containment, and consumer action.
