# Protected GitHub setup

ProofTape's reusable workflow protects the exact base artifact and artifact
transport only when the caller definition and required-check rule are protected
from the candidate. It does not authenticate observations created inside the
candidate process.

This concrete caller runs the repository's Acorn smoke fixture. It pins the
reusable workflow to the reviewed three-job implementation with the explicit
observation-authenticity boundary and immutable tool checkout.

```yaml
name: Dependency behavior

on:
  pull_request:
    types: [opened, synchronize, reopened]

permissions:
  contents: read

jobs:
  proof:
    uses: DelshadH/prooftape/.github/workflows/prooftape.yml@4c77fb152ede888cc85295e54291bf16b0f45f22
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

## Make it required

1. Commit the caller workflow on the protected default branch.
2. Run it once so GitHub records the verifier check name.
3. In repository settings, create a branch ruleset targeting the default
   branch.
4. Require pull requests and require the reusable workflow's
   `Verify immutable capsules` status check.
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
