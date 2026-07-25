# ADR 0002: Public format version 1

- Status: Accepted
- Date: 2026-07-25

## Context

ProofTape persists three public JSON artifacts: capsules, comparison reports,
and reproduction manifests. Independent consumers need a precise compatibility
boundary before the first alpha.

## Decision

The three shapes committed in `fixtures/schema` become the stable public
version 1 contract with `0.1.0-alpha.1`. Parsers reject unknown fields and
future versions rather than guessing.

Canonical JSON sorts object keys recursively and contains no insignificant
whitespace. Persisted JSON files append one line-feed byte. Capsule and
reproduction-manifest semantic hashes exclude that line feed. GitHub artifact
transport hashes cover complete file bytes, including it.

Artifacts from unpublished `0.0.0` development packages are unsupported,
including artifacts without the required observation-authenticity marker.

## Consequences

Required-field additions, removals, renames, semantic reinterpretations,
canonicalization changes, hash-scope changes, authenticity-model changes, and
verdict or exit-semantic changes require version 2. Compatible defect fixes may
reject an artifact only when it was already invalid under the documented v1
contract.
