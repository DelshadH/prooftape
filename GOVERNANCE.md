# Governance

ProofTape is maintained through reviewed changes to its public repository. A
maintainer is a collaborator with merge authority; a contributor is anyone who
opens an issue or pull request.

## Change authority

- Maintainers merge only pull requests that pass all required checks.
- At least one approving maintainer is required. The author may not be the sole
  approver for changes to releases, workflows, permissions, schemas, exit
  codes, the security boundary, dependency policy, or repository rules.
- Stale approvals are dismissed after the reviewed commit changes.
- Automation has no bypass from pull-request, review, or required-check rules.
- A failing or missing check is not waived by changing the test, fixture, or
  documented contract unless that contract change is itself explicit and
  reviewed.

Routine implementation decisions may be made in a pull request. Public trust or
compatibility decisions require an ADR under `docs/adr`. Security-sensitive
discussion starts in a private GitHub Security Advisory, not a public issue.

## Release authority

Releases use the protected `npm-release` GitHub environment and the process in
[RELEASING.md](RELEASING.md). One approving maintainer who did not author the
release commit must review release-affecting changes and approve the environment
deployment. A tag is created only after that review. No maintainer or automation
account bypasses these controls.

The following repository settings are prerequisites, not claims about the
current GitHub configuration:

- `main` requires a pull request, one approval, and dismissal of stale reviews;
- required checks are `checks (22)`, `checks (24)`, and `quality-gates`;
- automation cannot bypass the rules;
- `npm-release` requires an independent deployment approval;
- each npm trusted publisher is restricted to
  `.github/workflows/release.yml` and `npm-release`;
- `v0.1.0-alpha.1` is created only after release approval.

## Maintainer changes

A new maintainer must demonstrate understanding of the product and security
contracts through reviewed contributions, enable strong account security, and
complete the recovery validation in
[docs/maintainer-recovery.md](docs/maintainer-recovery.md). Removal of a
maintainer includes repository, npm, environment, trusted-publisher, session,
key, and app review.

No secret, recovery code, private contact address, or customer data belongs in
this repository.
