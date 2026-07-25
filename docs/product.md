# Product contract

## Promise

Given an exact protected base revision and an exact candidate revision, and
assuming the executed code does not actively suppress or forge ProofTape's
in-process instrumentation, ProofTape identifies supported
application-to-one-dependency behavior that changed at runtime and emits a
machine-readable counterexample even when both commands pass.

This is independent of the application's assertions and expected test output.
It is not independent of the code being observed, proof of total equivalence,
proof of correct tests, or evidence for code that was not executed.

## Inputs

- Two full lowercase Git commit SHAs, or two independently recorded version 1
  capsules.
- Exactly one npm package name, including an optional package subpath.
- One direct command represented by a shell-like quoted string. ProofTape parses
  quoting but does not start a shell.
- Optional repeated secret literals for redaction.
- Optional repeated literal normalizers in
  `<literal>=<replacement>` form.
- A clean Git root and npm lockfile version 2 or 3.

The local `compare` command accepts only a repository root with no tracked,
untracked, or modified application files. Ignored install output such as
`node_modules` is allowed.

## Supported call surface

ProofTape instruments application modules, not dependency-internal modules.
Supported bindings are:

- ESM default, named, and namespace imports from the exact package or a package
  subpath;
- CommonJS direct `require`, static destructuring, and one static required
  member;
- a direct call to the binding or one static member call;
- synchronous return or throw;
- a native Promise that resolves or rejects;
- scalar, JSON-safe array, plain-object, null-prototype object, bigint, date,
  and declared special-number values.

The recorder captures the export path, normalized call-site fingerprint,
per-process sequence, arguments before and after the call, and the outcome.
Errors include name, message, optional code, and safe enumerable fields.

## Explicitly unsupported

The current implementation rejects the whole affected application module when
it sees a dependency dynamic import, re-export, constructor, tagged template,
optional call, computed member, member deeper than one level, namespace call,
or `call`/`apply`/`bind`. It also rejects capture values with cycles, accessors,
enumerable symbol keys, custom prototypes, hostile proxy traps, excessive
depth, excessive collection size, or excessive strings.

Unsupported syntax becomes a capture issue. Unsupported values are marked at
their JSON pointer. Either condition prevents a clean comparison and maps to
exit 4.

## Blocking differences

- return or resolution value changed;
- return/resolution became throw/rejection or the reverse;
- error contract changed;
- argument mutation changed;
- relative sequence of matched calls changed;
- a supported call appeared or disappeared.

Repeated calls with unequal counts and no safe alignment are ambiguous. That is
a harness failure, not a guessed diff. Durations exist only in bounded raw
events and are deliberately removed from canonical capsules; version 1 makes no
performance-regression verdict.

## Determinism and normalization

Canonical JSON is UTF-8 with sorted object keys and no insignificant
whitespace. Process IDs are replaced with deterministic identifiers, raw
duration is removed, paths in call-site fingerprints are reduced, and every
capsule and report has schema version `"1"`.

ProofTape applies no heuristic UUID, timestamp, random-ID, or user-field
normalization. A declared literal normalizer changes only matching strings and
adds an audit record containing the JSON pointer, normalizer name, hash of the
previous value, and replacement. Secret literals and sensitive keys are
redacted before raw events reach disk.

## Observation authenticity

Version 1 does not establish that raw call observations were authored by the
ProofTape hook rather than by code under test. The recorder passes
`PROOFTAPE_CONFIG` to the command so the hook can find its raw directory and
session. The application and its dependencies share that process authority and
can read the configuration, detect instrumentation, suppress a call, or replace
the raw stream with conforming JSON before the parent merges it.

Every capsule and each base/candidate report summary therefore contains
`observationAuthenticity: "not-established"`. The CLI prints the same warning.
This is a machine-readable product boundary, not a claim that a session ID or
hash authenticates the observation producer.

## Isolation

Local comparison creates separate detached worktrees and performs a frozen npm
install with lifecycle scripts disabled. It records commit SHA, lockfile hash,
Node version, platform, architecture, direct command, dependency version and
entry, ProofTape version, and configuration hash. A command failure, timeout,
output overflow, checkout modification, or empty capture is not a behavioral
verdict.

The reusable GitHub workflow records base and candidate in separate
least-privilege jobs. A third job checks producing-job SHA-256 values, parses
bounded schemas, and performs the diff with a pinned verifier. This protects
the already-produced base artifact and transport integrity. The candidate-job
hash proves which bytes that job emitted; it does not prove those observations
were genuine.

## Non-goals

ProofTape does not prove security, compatibility for unobserved calls, total
semantic equivalence, or correctness of a test suite. It is not a local sandbox
for malicious code, and it does not attest observation authenticity against
code under test. Public output says “no blocking differences observed in
captured supported calls,” never “safe.”
