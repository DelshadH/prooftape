# Maintainer and release recovery

This checklist restores control without placing recovery material in source.
Use it after account loss, maintainer departure, suspicious access, or release
infrastructure compromise.

## Regain and contain

1. Use GitHub's account and organization recovery process to restore a verified
   repository owner. Do not share recovery codes in an issue or commit.
2. Use npm account or organization recovery to restore a verified owner for all
   four package names.
3. Remove or disable the npm trusted publisher while the incident is scoped.
4. Revoke affected GitHub sessions, SSH and signing keys, personal access
   tokens, OAuth apps, GitHub Apps, npm sessions, and npm tokens.
5. Remove pending `npm-release` deployments and inspect its reviewers,
   deployment branches/tags, secrets, and bypass settings.
6. Inspect `main` rules, required checks, tag rules, repository collaborators,
   deploy keys, webhooks, workflow permissions, and recent audit events.

## Restore

1. Establish a second verified maintainer before restoring release authority.
2. Compare protected branches and release tags with independently retained
   clones and published provenance. Investigate every unexplained difference.
3. Restore branch and environment rules from [GOVERNANCE.md](../GOVERNANCE.md)
   and [docs/github.md](github.md).
4. Recreate the npm trusted publisher with the exact repository, workflow
   filename, environment, and allowed publish action.
5. Run the complete clean-room gates and review every release artifact before
   approving another tag.
6. If any published version may be affected, use
   [the compromised-release procedure](compromised-release.md), deprecate it,
   and issue a security advisory when users may need to act.

## Validate a successor

The outgoing and incoming maintainers, or two independent remaining
maintainers, verify owner access, required checks, private advisory access,
environment approval, npm ownership, trusted-publisher configuration, and a
non-publishing release rehearsal. Record completion in a reviewed issue or pull
request without account identifiers, private contacts, secrets, or recovery
codes.
