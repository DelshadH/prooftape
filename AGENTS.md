# Repository instructions

## Goal

Build ProofTape into a trustworthy command-line tool for independently checking
runtime behavior changes in npm dependency upgrades. Preserve the narrow promise
in `docs/product.md`; do not expand the product until the core comparison is
proven end to end.

## Read first

1. `README.md`
2. `docs/product.md`
3. `docs/security-model.md`
4. `docs/architecture.md`
5. `docs/quality-plan.md`

## Commands

```bash
npm install --ignore-scripts
npm run typecheck
npm test
npm run build
```

Use the repository's Node version and npm workspaces. Commit a lockfile before
relying on reproducible installs. Keep TypeScript strict and ESM-native.

## Working rules

- Implement vertical slices that users can run. A library helper without a CLI
  path, fixture, and test is not a finished feature.
- Start behavior changes with a failing test. Cover success, failure, malformed
  input, limits, and platform-specific behavior where relevant.
- Keep output useful to people and tools: concise terminal text and versioned,
  documented JSON. Do not hide errors behind generic summaries.
- Preserve public exit codes and explicitly reject unsupported observations with
  exit code 4. Silent data loss is a correctness bug.
- Use plain developer language in comments and documentation. Avoid generated
  filler, inflated novelty claims, and claims not demonstrated by a fixture.
- Do not weaken a test, quality gate, permission boundary, or fixture merely to
  make CI green.

## Security boundaries

- Treat the candidate repository, test command, capsules, paths, and serialized
  values as untrusted.
- Never run pull-request code with secrets, write permissions, privileged caches,
  or `pull_request_target`.
- Record base and candidate behavior in separate workspaces or jobs. Resolve the
  baseline from the exact protected base commit, not a candidate-controlled file.
- Bound process time, output, event size/count, recursion, and archive extraction.
- Reject path traversal and symbolic-link escapes. Never invoke a shell when a
  direct argument vector will work.
- Redact configured secret patterns before persistence and prove that canaries do
  not reach capsules, logs, errors, or CI artifacts.
- Do not add runtime dependencies without explaining why the standard library or
  an existing dependency is insufficient. Review license, maintenance, install
  scripts, and vulnerability status.

## Completion standard

A feature is complete only when its public command works from a clean checkout,
tests exercise the real implementation, documentation matches behavior, and the
relevant proof in `docs/quality-plan.md` is reproducible. Before release, run the
full test matrix, dependency audit, secret scan, package smoke test, hostile-input
tests, and a clean-room killer demo.
