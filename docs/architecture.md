# Architecture

## Packages

- `@prooftape/schema` defines and strictly parses versioned calls, capsules,
  differences, and reports. It has no runtime dependencies.
- `@prooftape/hook` registers Node synchronous module hooks and rewrites
  supported application call expressions.
- `@prooftape/core` serializes values, merges raw events, normalizes, matches,
  diffs, manages worktrees, and generates reproductions.
- `prooftape` provides the CLI and exit-code contract.
- `packages/action` provides the composite recording Action used by
  separate-job workflows.

`acorn` is the only non-workspace runtime dependency. A real JavaScript parser
is required to preserve evaluation order and distinguish supported call syntax;
regular-expression rewriting is not safe enough for that boundary.

## Local pipeline

1. Validate a clean Git root and two exact commit objects.
2. Create separate detached base and candidate worktrees.
3. Run `npm ci --ignore-scripts --no-audit --no-fund` in each worktree.
4. Resolve the named dependency and record its installed version and entry.
5. Start the direct command with the ProofTape hook in `NODE_OPTIONS`.
6. Write bounded append-only JSONL, one file per process or worker thread.
7. Reject partial, malformed, cross-session, oversized, symlinked, or unexpected
   raw files.
8. Replace process IDs deterministically, remove duration, apply declared
   normalizers, and create a canonical capsule.
9. Match calls by dependency, export path, call site, and occurrence, then
   classify return, error, mutation, presence, and order differences.
10. Generate `repro.mjs` only for a changed return, error, or mutation whose
    inputs and outcomes can be replayed without redaction or normalization.
11. Execute the reproduction against both installed revisions. Base must exit 0
    and candidate must exit 1 before the report links it.

The recorder checks repository status before and after the command. It also
passes only a small non-secret environment allowlist plus the hook
configuration.

The configuration includes the raw output directory and session identifier.
Because application code shares the hook's process authority, it can read that
configuration and alter its own raw stream. Merge validation proves bounded
structure and consistency, not observation authorship. The resulting capsule
and report carry `observationAuthenticity: "not-established"`.

## Transparent interception

The preload calls Node's synchronous `module.registerHooks`. Its load hook parses
application ESM or CommonJS source, finds static bindings to the named package,
and replaces the call expression with:

```text
runtime.invoke(
  dependency,
  exportPath,
  originalFunction,
  receiver,
  arguments,
  staticCallSite,
  moduleKind,
  receiverKind,
  moduleSpecifier,
  targetKind
)
```

The imported or required binding is never replaced, so visible function
identity and descriptors remain unchanged. `Reflect.apply` preserves the
receiver. The runtime returns the original result, rethrows the same error
object, and returns native Promises without attaching a settlement handler.
Promise settlement is explicitly unsupported because transparent generic
observation is not available through the public Node API. Dependency-internal
modules and unrelated modules are not transformed.

The generated call uses a collision-free runtime binding and does not resolve
through application bindings named `globalThis` or `Symbol`. If a module
contains a relevant unsupported construct, the hook leaves that
module unchanged and writes an explicit issue. Partial instrumentation of the
same module is not presented as complete evidence.

## Matching

The deterministic base key is:

```text
dependency + exactModuleSpecifier + exportPath + normalizedCallSiteFingerprint
```

Equal-count repeats align by occurrence. Unequal duplicate counts are
ambiguous; ProofTape does not guess. Matched-call order is compared separately
from added and removed calls.

## Reproduction directory

A safe counterexample contains:

- `repro.mjs`;
- `input.json`;
- `base-package.json`;
- `candidate-package.json`;
- `README.md`;
- `manifest.json` with a SHA-256 for every generated file.

The script resolves the dependency from the checkout where it is run. Exit 0
means the observed result matches the base evidence; exit 1 means it differs.

## GitHub split

`.github/workflows/prooftape.yml` has independent base, candidate, and verifier
jobs. Each job checks out `github.workflow_sha`, the exact commit containing the
invoked reusable workflow, and uses full-SHA third-party Actions.
They have only `contents: read`, receive no secrets, use no dependency cache,
disable npm lifecycle scripts, and never use `pull_request_target`.

Each recording job publishes a capsule plus its SHA-256 as a job output. The
verifier downloads the two unique-name artifacts, checks that their complete
bytes match the hashes supplied through the producing-job outputs, strictly
parses both capsule structures, emits the report/reproduction artifact, and
then enforces the public exit code. This isolates the base artifact and detects
transport changes after each job produces its capsule. It does not authenticate
calls emitted by code inside the candidate job.

The verifier writes a GitHub step summary from the strictly parsed report. It
shows exact commits, dependency versions, canonical capsule hashes, complete
artifact transport hashes, verdict, and exit code. The summary distinguishes
base retention, transport-hash matching, structural parsing, observation
comparison, and the absence of observation authorship.
