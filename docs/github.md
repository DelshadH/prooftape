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
    uses: DelshadH/prooftape/.github/workflows/prooftape.yml@7e2b4cf7aa0da8a7180ccf7a4b4f93a8ac0e157e
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
uses this exact pin. Its first
[dependency-upgrade run](https://github.com/DelshadH/prooftape-consumer-example/actions/runs/30160157416)
proves the complete caller path outside this monorepo. The reproducible evidence
and exact hashes are recorded in
[external-consumer.md](external-consumer.md).

## Make it required

1. Commit the caller workflow on the protected default branch.
2. Run it once so GitHub records the verifier check name.
3. In repository settings, create a branch ruleset targeting the default
   branch.
4. Require pull requests and require the reusable workflow's
   `Validate capsule integrity and compare observations` status check.
5. Prevent rule bypass for automation accounts that open dependency upgrades.
6. Keep workflow-file changes subject to the same review and required checks.

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

1. require approval from a maintainer who did not author the release commit;
2. allow only the exact reviewed release tag;
3. prevent administrator bypass;
4. contain no npm token or other secret.

These GitHub-side controls were configured and read back on 2026-07-25:
the only permitted deployment ref is tag `v0.1.0-alpha.1`, self-review and
administrator bypass are disabled, and the environment has zero secrets and
zero variables. `main` also requires an up-to-date pull request, one approval,
the three documented CI checks, stale-review dismissal, last-push approval,
conversation resolution, and administrator enforcement; force pushes and
deletion are disabled.

The repository currently has one collaborator. That account cannot approve its
own environment deployment, so a second qualified maintainer is an intentional
release blocker rather than a reason to relax the controls.

The manual release workflow has only `contents: read` and `id-token: write`,
checks out and verifies the exact `v0.1.0-alpha.1` tag, rejects older npm clients
that cannot use trusted publishing, rebuilds all evidence, and publishes the
four tarballs in dependency order with provenance. See
[RELEASING.md](../RELEASING.md) for the approval sequence and
[the compromise procedure](compromised-release.md) for containment and
replacement.

The policy workflow is prepared but cannot yet authenticate a first publish:
all four npm package names were absent on 2026-07-25, and npm requires a package
to exist before adding its trusted publisher. This conflict must be resolved by
explicit review before a tag or dispatch; it must not be bypassed with a hidden
token. The exact blocker is maintained in [RELEASING.md](../RELEASING.md).
