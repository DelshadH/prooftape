# ADR 0001: PT-G07 observation authenticity

- Status: Accepted
- Date: 2026-07-25

## Context

ProofTape's recorder and code under test execute with the same process authority.
The hook must disclose a writable raw-output directory and session identifier.
Candidate code can therefore suppress observations or replace them with
schema-valid forged calls. Session identifiers, strict JSON parsing, canonical
hashes, held-base evidence, and producing-job artifact hashes do not identify
the author of an in-process observation.

An end-to-end adversarial fixture proves a real base-A to candidate-B behavior
change can be rewritten into a warned exit-0 comparison.

## Decision

PT-G07 is satisfied by narrowing the contract, not by claiming forgery
prevention. Version 1 requires
`observationAuthenticity: "not-established"` in capsules, both report evidence
summaries, and reproduction manifests. Successful CLI, Action, and workflow
presentation repeats the limitation.

Exit 0 means no blocking difference was observed in captured supported calls.
It does not establish observation authorship.

## Consequences

ProofTape can protect already-recorded base bytes and verify artifact transport
hashes without describing candidate observations as authenticated. Users must
not use a result as an attestation against actively evasive code.

A stronger product contract requires a collector and trust root outside the
candidate's operating-system authority. That change would require a new
architecture, threat model, evidence model, and schema version.
