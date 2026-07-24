# Threat model

## Protected asset

The integrity of the behavioral baseline and verifier result used to review an automated pull request.

## Adversaries and failures

- An otherwise capable coding agent accidentally changes tests, fixtures, or expected output to bless its own change.
- Pull-request code is malicious or compromised.
- A candidate branch edits a checked-in baseline or workflow.
- Nondeterminism creates false changes or hides real ones.
- Captured arguments contain credentials or personal data.
- Instrumentation alters runtime behavior.

## Required controls

- Execute untrusted PR code only in a least-privilege workflow with read-only repository permission, no secrets, no package-publish token, and no privileged cache restore.
- Never execute PR code in `pull_request_target` or an equivalent privileged context.
- Resolve baseline material from the event's exact base SHA or a provenance-attested artifact generated on protected main; ignore baseline edits in the candidate checkout. Record base and candidate in separate jobs or sandboxes, then diff bounded capsules in a third verifier context.
- Pin the released verifier/action by immutable version and, for third-party actions in release workflows, full commit SHA.
- Record all environment and input hashes.
- Redact configured key patterns and token patterns before disk writes; prove with canaries.
- Run semantic-transparency fixtures with and without instrumentation.
- Put time, output-size, recursion, and child-process limits around untrusted execution.

## Explicit boundary

The v0.1 verifier is an independent evidence channel against accidental or self-confirming agent changes. It is not a hardened sandbox against arbitrary hostile code on a self-hosted runner, and a workflow that the PR itself may edit is not a cryptographic trust root. Public documentation must say this directly and recommend a protected required workflow or external app for hostile contributors.
