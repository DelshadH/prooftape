# Threat model

## Protected asset

The protected assets are the already-recorded base capsule, the exact revisions
and lockfiles named by evidence metadata, and artifact transport into the
verifier. Authenticity of in-process call observations against code under test
is explicitly not a protected asset in version 1.

## Adversaries and failures

- An automated change edits tests or expected output to bless itself.
- Candidate code is malicious or compromised.
- A candidate edits a checked-in baseline or workflow.
- Candidate code changes files while it is being recorded.
- Candidate code reads `PROOFTAPE_CONFIG`, suppresses real calls, or replaces
  its writable raw stream with conforming forged observations.
- A forged, malformed, or oversized capsule reaches the verifier.
- Captured arguments contain credentials or personal data.
- Nondeterminism or instrumentation changes the application result.

## Implemented controls

- Base and candidate use exact lowercase commit SHAs, separate worktrees or
  jobs, separate installs, and recorded lockfile hashes.
- Local commands require a completely clean checkout before execution and a
  clean checkout afterward. Changes to tracked or untracked checkout files are
  a harness failure; this does not cover the external raw directory.
- Recorded commands receive only a bounded allowlist of non-secret environment
  variables. A test canary proves unrelated runner variables do not reach the
  process or capsule.
- Commands use direct process spawning. Shell operators, substitutions,
  multiline input, null bytes, excessive length, and excessive argument counts
  are rejected.
- Test time, output, raw files, total bytes, line bytes, event count, event
  bytes, JSON depth, JSON entries, string bytes, capsule calls, issues, and
  report differences are bounded.
- Raw directories, event files, CLI inputs, and outputs reject symlinks or path
  traversal. Writes are exclusive and use owner-only modes where supported.
- Sensitive field names and configured literal canaries are redacted before a
  raw event is written. Reproductions are disabled for redacted, normalized, or
  unsupported evidence.
- Strict parsers reject unknown top-level and nested fields, incompatible
  versions, inconsistent counts, malformed outcomes, and invalid hashes.
- Capsules and reports require
  `observationAuthenticity: "not-established"`, and the CLI warns on every
  successful record or comparison.
- ESM, CJS, child-process, worker-thread, mutation, rejection, error-identity,
  descriptor, and `this` fixtures compare instrumented and plain results.
- Dependency audit, license allowlist, tracked-source secret scan, workflow
  permission scan, and full-SHA Action scan run in CI.

## GitHub boundary

The reusable workflow grants `contents: read` only. It declares no secrets,
uses no caches, disables install scripts, does not persist checkout
credentials, and does not use `pull_request_target`. Candidate recording cannot
share a filesystem with base recording. The verifier checks capsule hashes
provided directly by the producing jobs before parsing bounded JSON.

These controls protect the base job from candidate filesystem writes and detect
artifact corruption between producing and verifying jobs. They do not
authenticate candidate observations. A candidate job can emit a structurally
valid capsule derived from suppressed or forged raw events, and its SHA-256
will faithfully identify those attacker-influenced bytes.

Pin the caller's reusable-workflow reference to a full ProofTape commit. Keep
the caller workflow on the protected default branch and make its verifier job a
required status check. A workflow definition that the candidate controls is not
a trust root.

## Local boundary

ProofTape is not a sandbox. A local candidate command can read, write, open
network connections, start descendants, or attack the host with the authority
of the current user. Environment filtering reduces accidental secret exposure;
it does not contain arbitrary code or hide recorder configuration from that
code. Use only disposable repositories without credentials or an ephemeral
hosted runner for hostile candidates. Never run it against untrusted code on a
privileged self-hosted runner.

The local base worktree is recorded before candidate execution and the capsule
is held by the parent process. A fixture proves a candidate cannot retroactively
change that evidence by targeting the sibling worktree. This protects evidence,
not the host filesystem.

## Residual risk and required assumption

The application, dependency, hook, and raw writer execute under one OS security
principal. The hook receives its writable directory and session identifier
through `PROOFTAPE_CONFIG`; the application can read the same value and write to
the same directory. Filename, session, process, schema, size, and artifact-hash
checks establish consistency and transport integrity, not authorship.

Use a ProofTape behavioral verdict only when code under test is not expected to
actively evade or forge instrumentation. An ephemeral runner limits damage to
the host but does not strengthen observation authenticity. Establishing a
stronger guarantee would require a collector outside the candidate's OS
authority and a new, carefully bounded product contract; in-process JavaScript
instrumentation alone cannot provide it.
