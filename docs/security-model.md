# Threat model

## Protected asset

The protected asset is the integrity of the base capsule and verifier result
used to review a dependency-upgrade pull request.

## Adversaries and failures

- An automated change edits tests or expected output to bless itself.
- Candidate code is malicious or compromised.
- A candidate edits a checked-in baseline or workflow.
- Candidate code changes files while it is being recorded.
- A forged, malformed, or oversized capsule reaches the verifier.
- Captured arguments contain credentials or personal data.
- Nondeterminism or instrumentation changes the application result.

## Implemented controls

- Base and candidate use exact lowercase commit SHAs, separate worktrees or
  jobs, separate installs, and recorded lockfile hashes.
- Local commands require a completely clean checkout before execution and a
  clean checkout afterward. Candidate self-tampering is a harness failure.
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

Pin the caller's reusable-workflow reference to a full ProofTape commit. Keep
the caller workflow on the protected default branch and make its verifier job a
required status check. A workflow definition that the candidate controls is not
a trust root.

## Local boundary

ProofTape is not a sandbox. A local candidate command can read, write, open
network connections, start descendants, or attack the host with the authority
of the current user. Environment filtering reduces accidental secret exposure;
it does not contain arbitrary code. Use only disposable repositories without
credentials or an ephemeral hosted runner for hostile candidates. Never run it
against untrusted code on a privileged self-hosted runner.

The local base worktree is recorded before candidate execution and the capsule
is held by the parent process. A fixture proves a candidate cannot retroactively
change that evidence by targeting the sibling worktree. This protects evidence,
not the host filesystem.
