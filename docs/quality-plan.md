# Quality plan

Each requirement below needs an automated verifier and compact, reproducible
evidence. A passing unit test alone is not enough for an integration or security
claim.

| Gate | Required proof | Release condition |
|---|---|---|
| PT-G13 | Clean toolchain and package bootstrap | Fresh Linux checkouts run locked install, typecheck, tests, package smoke, and CLI smoke on Node 22 and 24. |
| PT-G01 | ESM and CJS interception feasibility | Supported sync/async calls are observed on Node 22 and 24 without changing outcomes, descriptors used by fixtures, or `this` behavior. |
| PT-G02 | Canonical schema | Golden fixtures round-trip; repeated runs produce byte-identical canonical capsules; schema rejects unknown incompatible versions. |
| PT-G14 | Capture completeness | Child-process and parallel fixtures produce exact expected call counts; corruption or unsupported loss is explicit and nonzero, never silent. |
| PT-G03 | No-change oracle | Base/candidate with identical behavior exits 0 and emits zero blocking differences across 20 repeated runs. |
| PT-G04 | Green-tests/changed-behavior oracle | Both test commands exit 0; ProofTape exits 2 and identifies the exact changed return/throw with a runnable counterexample. |
| PT-G05 | Mutation, rejection, and sequence | Fixtures independently prove changed argument mutation, async rejection, inserted/deleted calls, and ambiguous-match failure. |
| PT-G06 | Normalization audit | UUID/timestamp/path fixture is stable only when configured; report lists each transformation and never normalizes undeclared semantic fields. |
| PT-G07 | Baseline integrity | Candidate edits its baseline/config and attempts same-run filesystem tampering; separate-job verifier still uses exact base material. Documentation separately demonstrates the protected-required-workflow setup for hostile contributors. |
| PT-G08 | Real package evidence | Three isolated real npm upgrade fixtures; at least one is tied to a documented historical behavioral regression or breaking change, with source and reproducible lockfiles. |
| PT-G09 | Security and privacy | Secret canaries never appear in raw/canonical reports; untrusted workflow has no secrets/write token; path traversal, oversized events, cycles, and malformed capsules are rejected. |
| PT-G10 | Semantic transparency | Instrumented and uninstrumented supported fixtures have equal outcomes, visible exports, property descriptors required by contract, and error identity fields. |
| PT-G11 | Performance budget | Median wall-clock overhead is ≤2.0× on the published synthetic fixture; report includes raw samples and environment. This is a budget, not a universal claim. |
| PT-G12 | Clean-room release | Linux clean checkout runs install, full tests, killer demo, package smoke test, and generated 15–20 second terminal recording from one command. |

The gate identifiers are stable so test output and release evidence can refer to
the same requirement over time. Changing a requirement needs an explicit design
decision, not a quieter test.

## Killer demo acceptance

The demo must show, in one uninterrupted run:

1. base tests green;
2. candidate tests green;
3. ProofTape exits 2;
4. one concise behavioral diff;
5. generated `repro.mjs` fails on candidate and matches base expectation;
6. `report.json` names the same counterexample.

A hand-edited screenshot is not evidence.

## Automated gate map

| Gate | Verifier |
|---|---|
| PT-G13 | `.github/workflows/ci.yml` runs locked install, typecheck, all tests, audit, and packed CLI/Action smoke on Node 22 and 24. |
| PT-G01, PT-G10 | `packages/hook/test/interception.test.ts`, `runtime.test.ts`, and `transform.test.ts` execute real ESM, CJS, native Promise, error, mutation, worker, and child-process fixtures. |
| PT-G02, PT-G03 | Schema, capsule, serialization, and property tests plus the 20-run recording test prove strict parsing and byte-identical repetition. |
| PT-G14 | Hook child/worker tests and raw-capsule corruption, session, line, file, and byte-limit tests make capture loss explicit. |
| PT-G04 | `npm run demo` executes both green commands, returns ProofTape exit 2, and verifies the same report/reproduction match key. |
| PT-G05 | Runtime, diff, report, and compare tests cover mutation, rejection, insertion, deletion, sequence, and ambiguous repeats. |
| PT-G06 | `packages/core/test/normalize.test.ts` proves declared-only UUID, timestamp, and path normalization with an audit record per field. |
| PT-G07 | Compare tests attack the base sibling and candidate checkout; `.github/workflows/prooftape.yml` separates jobs and binds artifacts to producing-job hashes. |
| PT-G08 | `npm run real-upgrades` builds isolated Git histories from six committed lockfiles and tests `camelcase`, `is-number`, and `ms`. |
| PT-G09 | `npm run security` combines npm audit, license allowlist, production-install-script check, tracked-source secret scan, and workflow policy scan. |
| PT-G11 | `npm run performance` records seven raw sample pairs, environment, medians, and the enforced 2.0× budget. |
| PT-G12 | The Node 24 quality job runs the demo, 15.5-second cast generation, real upgrades, performance, security, and package smoke from a clean checkout. |
