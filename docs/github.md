# Protected GitHub setup

ProofTape's reusable workflow protects the exact base artifact and artifact
transport only when the caller definition and required-check rule are protected
from the candidate. It does not authenticate observations created inside the
candidate process.

This concrete caller runs the repository's Acorn smoke fixture. It pins the
reusable workflow to the reviewed three-job implementation with the explicit
observation-authenticity boundary and full-commit tool checkout.

```yaml
name: Dependency behavior

on:
  pull_request:
    types: [opened, synchronize, reopened]

permissions:
  contents: read

jobs:
  comparison:
    uses: DelshadH/prooftape/.github/workflows/prooftape.yml@820c188574eb898c6822dd0e72c78f84c4061d41
    permissions:
      contents: read
    with:
      base_ref: ${{ github.event.pull_request.base.sha }}
      candidate_ref: ${{ github.event.pull_request.head.sha }}
      dependency: acorn
      command: node fixtures/workflow/acorn-smoke.mjs
```

For another repository, change only the dependency and direct command after
proving that the command reaches a supported call. Keep the full workflow SHA,
exact event SHAs, read-only permission, and absence of `secrets: inherit`.

## What the check reports

The `Validate capsule integrity and compare observations` job summary includes
the exact base and candidate commits, dependency versions, canonical capsule
hashes, artifact transport hashes, verdict, and public exit code. It also
states, in bold, that observation authenticity is not established and explains
that base retention, transport-hash matching, and capsule-structure validation
do not establish observation authorship.

The composite recording Action exposes
`observation-authenticity=not-established`. Callers do not need to parse a
capsule to discover this boundary.

The independent
[ProofTape consumer example](https://github.com/DelshadH/prooftape-consumer-example)
recorded the earlier reviewed workflow used for its first
[dependency-upgrade run](https://github.com/DelshadH/prooftape-consumer-example/actions/runs/30160157416)
as historical end-to-end evidence. New callers must use the remediated exact
pin shown above. The reproducible historical evidence and exact hashes are recorded in
[external-consumer.md](external-consumer.md).

## Make it required

1. Commit the caller workflow on the protected default branch.
2. Run it once so GitHub records the verifier check name.
3. In repository settings, create a branch ruleset targeting the default
   branch.
4. Require pull requests and require the reusable workflow's
   `Validate capsule integrity and compare observations` status check.
5. Prevent rule bypass for automation accounts that open dependency upgrades.
6. Keep workflow-file changes subject to the same independent technical review
   and required checks.

Do not switch this to `pull_request_target`. Do not add repository, organization,
or environment secrets. Do not add a cache shared with candidate execution.
The candidate job is allowed to fail or produce a hostile capsule; the separate
verifier checks its producing-job hash, bounded schema, and exit code. That hash
identifies the bytes emitted by the candidate job. It does not prove candidate
code did not suppress or forge calls before capsule creation. Use the workflow
as regression evidence only when code under test is not actively evading the
instrumentation.

## Protected npm release environment

Package publication is separate from comparison execution. Configure npm
trusted publishing for all four package names with repository
`DelshadH/prooftape`, workflow `release.yml`, and environment `npm-release`.
That environment must:

1. allow only the exact owner-authorized release tag;
2. contain no npm token or other secret;
3. grant `id-token: write` only to the publish job.

The first-release controls were read back on 2026-07-26 with only
`v0.1.0-alpha.1` permitted. For the next owner-authorized publication the
environment is restricted to exact tag `v0.1.0-alpha.2`; it has zero secrets,
zero variables, and no human-review rule. `main` requires an up-to-date pull
request, the three documented CI checks, conversation resolution, and
administrator enforcement, with a human approval count of zero; force pushes
and deletion are disabled. No-bypass tag rulesets prevent update or deletion
of each owner-authorized release tag after creation.

The manual release workflow binds both the run and checkout to the exact
`v0.1.0-alpha.2` tag. Its read-only preparation job rebuilds and uploads all
evidence before approval. The protected publish job alone receives
`id-token: write`; it downloads the same-run artifact, verifies its exact file
set, tagged commit, version, and tarball checksums, rejects older npm clients
that cannot use trusted publishing, and publishes the four tarballs in
dependency order with provenance. See
[RELEASING.md](../RELEASING.md) for the approval sequence and
[the compromise procedure](compromised-release.md) for containment and
replacement.

The one-time bootstrap created all four genuine `0.1.0-alpha.1` package
records on 2026-07-31. npm requires a package to exist before adding its
trusted publisher, so later releases use the permanent OIDC workflow.

The reviewed first-publication exception is
`.github/workflows/npm-bootstrap.yml`. It is manual, tag- and commit-bound,
GitHub-hosted, serialized by a non-canceling global lock, and protected by the
separate `npm-bootstrap` environment. Its read-only job pins Node `24.18.0` and
npm `11.16.0`, rebuilds twice from clean source, runs every release gate,
verifies the immutable tarball hashes and empty registry, and uploads reviewable
evidence. Only its protected publish job receives `id-token: write`; only one
step receives the one-day granular token. That step publishes the real
`0.1.0-alpha.1` tarballs in dependency order with provenance and invalidates the
token with npm logout from an exit trap on every authenticated success or
failure path. Registry bytes, integrity fields, package contents, provenance
identity, and signatures are verified afterward without authentication, with a
five-minute absolute propagation deadline that includes registry request time.
The GitHub prerelease is created only after token revocation, registry and
provenance verification, signature audit, and preservation of the
publication-verification artifact. Failures after any publication attempt are
preserved as non-rerunnable incident evidence.

For a package's sole first version, npm assigned both `alpha` and `latest` to
the reviewed prerelease and rejected authenticated removal of `latest` with
HTTP 400. The verifier accepts `latest` only in that exact one-version state,
records both tags, and still rejects any different tag target.

Do not publish placeholder packages. Do not run the permanent `release.yml`
workflow for `0.1.0-alpha.1` after the bootstrap consumes that immutable
version. Configure each resulting package to trust `release.yml` and
`npm-release`, select **Require two-factor authentication and disallow tokens**,
and use OIDC beginning with the next prerelease. The exact owner setup,
dry-run, incident, and revocation procedures are maintained in
[RELEASING.md](../RELEASING.md).
