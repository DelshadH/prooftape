# Governance

ProofTape is maintained through reviewed changes to its public repository. A
maintainer is a collaborator with merge authority; a contributor is anyone who
opens an issue or pull request.

## Change authority

- Maintainers merge only pull requests that pass all required checks.
- Human approval is not a technical alpha-release prerequisite.
- Release-affecting work freezes an exact SHA and receives fresh-context
  independent AI review for security, correctness, evidence, packaging,
  release, documentation, and usability. The result is recorded as
  `independent-ai-technical-review`, never as human approval or an external
  professional audit.
- Automation has no bypass from pull-request or required-check rules.
- A failing or missing check is not waived by changing the test, fixture, or
  documented contract unless that contract change is itself explicit and
  reviewed.

Routine implementation decisions may be made in a pull request. Public trust or
compatibility decisions require an ADR under `docs/adr`. Security-sensitive
discussion starts in a private GitHub Security Advisory, not a public issue.

## Release authority

Releases use the protected `npm-release` GitHub environment and the process in
[RELEASING.md](RELEASING.md). The owner makes one final binary decision,
`PUBLISH` or `DO NOT PUBLISH`, after all technical gates and independent AI
review pass. A tag or GitHub release is created only after `PUBLISH`.

The following GitHub settings were read back on 2026-07-26:

- `main` requires a pull request and no human approval count;
- required checks are `checks (22)`, `checks (24)`, and `quality-gates`;
- required checks must be current with `main`;
- administrators are subject to the `main` rules, and force pushes and branch
  deletion are disabled;
- conversations must be resolved before merge;
- `npm-release` contains no secret or variable and permits only tag
  `v0.1.0-alpha.1`;
- an active tag ruleset with no bypass prevents update or deletion of
  `v0.1.0-alpha.1` after creation.

The npm trusted publishers cannot be configured before the four new package
names exist. That registry-authentication limitation is tracked without
reintroducing a human-review requirement.

## Maintainer changes

A new maintainer must demonstrate understanding of the product and security
contracts through reviewed contributions, enable strong account security, and
complete the recovery validation in
[docs/maintainer-recovery.md](docs/maintainer-recovery.md). Removal of a
maintainer includes repository, npm, environment, trusted-publisher, session,
key, and app review.

No secret, recovery code, private contact address, or customer data belongs in
this repository.
