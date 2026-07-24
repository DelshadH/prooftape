# Architecture

## Packages

- `@prooftape/schema`: versioned event, capsule, diff, and report schemas. No runtime dependencies.
- `@prooftape/hook`: Node preload/register hook that intercepts the configured package while preserving supported semantics.
- `@prooftape/core`: canonicalization, normalization, matching, diffing, isolation orchestration, and counterexample export.
- `prooftape`: CLI and exit-code contract.
- `@prooftape/action`: thin GitHub Action wrapper after the CLI is proven.

## Execution pipeline

1. Resolve and validate exact base/candidate SHAs.
2. In local mode create isolated worktrees; in GitHub mode record them in separate no-secret jobs.
3. Install each revision using its detected lockfile's frozen mode.
4. Execute the same command with the ProofTape hook preloaded.
5. Write append-only raw observations per process; merge by process/order metadata.
6. Canonicalize and normalize with an auditable transform log.
7. Match corresponding calls, classify differences, and reject unsupported observations explicitly.
8. For serializable changed calls, generate and execute a minimal `repro.mjs` against both dependency versions.
9. Emit terminal output, `report.json`, JUnit/Check annotations, and evidence metadata.

## GitHub execution split

`record-base` and `record-candidate` are separate unprivileged jobs without caches or secrets. Each uploads one bounded capsule. A third trusted-verifier job downloads both, validates hashes/schema/limits, and performs `prooftape diff`. This prevents candidate code from modifying the base recording through a shared filesystem. For a hostile contributor model, enforce the workflow from a protected organization/ruleset or external app; a workflow editable in the PR is only an accidental-agent control.

## Interception strategy

Use Node's synchronous module customization hooks registered from `--import`. The feasibility gate must prove both ESM and CJS behavior on supported surfaces. Wrappers may be used only where identity and descriptors are preserved or the limitation is explicitly rejected as unsupported.

The hook must not recursively instrument dependency-internal calls as application entry calls. Determine the boundary from importer/call-site ownership and record a documented fallback where exact ownership is unavailable.

## Matching

Start with a deterministic composite key:

`exportPath + occurrenceWithinTest + normalizedCallSiteFingerprint + normalizedArgsFingerprint`

Then use sequence-aware alignment for insertions/deletions. Never hide ambiguous matches; classify them as `ambiguous` and fail the harness until the user supplies a stable key or scope filter.

## Counterexample format

A counterexample directory contains:

- `repro.mjs`;
- `input.json`;
- base and candidate package manifests/lock excerpts;
- expected base and observed candidate outcome;
- one-command Docker or local replay instruction;
- SHA-256 manifest.

## Extension boundary

Do not build a plugin system in v0.1. Keep clear internal interfaces for serializer, normalizer, matcher, and reporter, but ship one implementation of each.
