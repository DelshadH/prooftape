# Changelog

## Unreleased

- Implemented strict version 1 capsule and report parsers, canonical JSON,
  bounded value serialization, redaction, and audited literal normalization.
- Implemented ESM and CommonJS application-call instrumentation with explicit
  unsupported handling and semantic-transparency fixtures.
- Implemented exact-revision recording, isolated npm-lockfile worktrees,
  behavior matching, blocking diffs, the public exit contract, and
  base/candidate-executed minimal reproductions.
- Added child-process and worker capture, hostile-input and property tests,
  a 20-run byte-determinism fixture, candidate checkout/base-attack fixtures,
  and three locked real npm upgrade fixtures.
- Added publishable package metadata, packed-tarball smoke tests, an executable
  killer demo, terminal recording, measured performance budget, dependency and
  license audit, secret scan, and workflow policy scan.
- Added a composite recording Action and a three-job reusable GitHub workflow
  with read-only permissions, no secrets or caches, full-commit tool/Action
  pins, capsule hashes, and a separate strict parser/comparator job.
- Made fixed-path release evidence safely rerunnable inside `.evidence` while
  keeping other outputs create-only, and clean up performance-gate observations.
- Narrowed the candidate trust contract after an adversarial fixture proved
  same-process code can forge its raw stream; capsules, reports, CLI output, and
  security documentation now state that observation authenticity is not
  established.
- Refreshed every pinned GitHub Action to its Node 24 runtime and adopted
  fail-closed artifact digest checks while explicitly disabling cache creation
  in the candidate-execution workflow.
- Added a composite Action authenticity output and a GitHub summary that
  separates base retention, capsule-structure validation, canonical capsule
  hashes, artifact transport hashes, observation comparison, and unsupported
  observation authorship.
