# Product contract

## One-sentence promise

Given a protected base revision and an untrusted candidate revision, ProofTape identifies supported application-to-dependency behavior that changed at runtime and emits a reproducible, machine-readable counterexample even when both revisions' tests pass.

## User

A maintainer reviewing an automated dependency-upgrade PR, and the coding agent repairing that PR.

## v0.1 inputs

- Base Git commit SHA and candidate Git commit SHA, or two independently recorded canonical capsules.
- Exactly one dependency package name.
- One shell test command.
- Optional include/exclude export paths and deterministic normalizers.
- A clean Git repository with a lockfile in each revision.

## v0.1 observed behavior

For each supported call crossing from application code into the named dependency:

- stable call sequence and call-site fingerprint;
- export/member path;
- JSON-safe arguments before invocation;
- JSON-safe arguments after invocation, to reveal mutation;
- return or resolved value;
- thrown or rejected error name, message, code, and JSON-safe enumerable fields;
- duration as non-blocking diagnostic metadata.

## Blocking differences

- return/resolution value changed;
- return became throw/reject or vice versa;
- error contract changed;
- argument mutation changed;
- relative sequence of matching supported calls changed;
- a previously observed supported call vanished or a new supported call appeared.

Timing changes are warnings in v0.1. Exact call-site line numbers are diagnostic and must not be the sole matching key.

## Determinism

Canonical JSON uses UTF-8, sorted object keys, explicit schema version, no insignificant whitespace, normalized paths, and a declared representation for `undefined`, `NaN`, infinities, bigints, dates, errors, cycles, and unsupported values. The same input must produce the same capsule hash.

Default normalizers cover temporary paths and stack-frame locations. UUIDs, timestamps, random IDs, and user fields require explicit opt-in normalizers; ProofTape must show every normalization in the report.

## Isolation

Base and candidate execute in separate clean worktrees with their own dependency installation. The verifier records commit SHA, lockfile hash, Node version, OS, command, dependency resolution, ProofTape version, and configuration hash. A failed test command is a harness failure, not a behavioral verdict. In GitHub mode, base and candidate recording run in separate unprivileged jobs; a third job parses bounded artifacts and performs the diff.

## Non-goals

ProofTape does not prove total semantic equivalence, security, absence of untested changes, compatibility for unobserved calls, or correctness of the existing test suite. The report must use “no blocking differences observed in captured supported calls,” never “safe” without qualification.

## Definition of done

The clean-room release proof in `quality-plan.md` passes from a fresh checkout,
and every public claim is backed by a reproducible fixture or measurement.
