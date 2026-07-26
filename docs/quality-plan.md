# Quality plan

Each requirement below needs an automated verifier and compact, reproducible
evidence. A passing unit test alone is not enough for an integration or security
claim.

| Gate | Required evidence | Release condition |
|---|---|---|
| PT-G13 | Clean toolchain and package bootstrap | Fresh Linux checkouts run locked install, typecheck, tests, package smoke, and CLI smoke on Node 22 and 24. |
| PT-G01 | ESM and CJS interception feasibility | Supported sync/async calls are observed on Node 22 and 24 without changing outcomes, descriptors used by fixtures, or `this` behavior. |
| PT-G02 | Canonical schema | Capsule, report, and reproduction-manifest golden fixtures parse from source and the packed clean-room install; repeated runs produce byte-identical canonical capsules; schemas reject unknown fields and incompatible versions. |
| PT-G14 | Capture completeness | Under the documented non-adversarial-code assumption, child-process and parallel fixtures produce exact expected call counts; corruption or unsupported loss is explicit and nonzero, never silent. |
| PT-G03 | No-change oracle | Base/candidate with identical behavior exits 0 and emits zero blocking differences across 20 repeated runs. |
| PT-G04 | Green-tests/changed-behavior oracle | Both test commands exit 0; ProofTape exits 2 and identifies the exact changed return/throw with a runnable counterexample. |
| PT-G05 | Mutation, rejection, and sequence | Fixtures independently prove changed argument mutation, async rejection, inserted/deleted calls, and ambiguous-match failure. |
| PT-G06 | Normalization audit | UUID/timestamp/path fixture is stable only when configured; report lists each transformation and never normalizes undeclared semantic fields. |
| PT-G07 | Baseline integrity and authenticity boundary | Candidate code cannot retroactively change the held base capsule. A same-run adversarial fixture proves candidate code can forge its own raw stream; every capsule, report, reproduction manifest, and CLI verdict must explicitly mark observation authenticity as not established. Separate-job hashes are claimed only as transport integrity. |
| PT-G08 | Real package evidence | Three isolated real npm upgrade fixtures; at least one is tied to a documented historical behavioral regression or breaking change, with source and reproducible lockfiles. |
| PT-G09 | Security and privacy | Secret canaries never appear in raw/canonical reports; candidate-execution jobs have no secrets/write token; path traversal, oversized events, cycles, and malformed capsules are rejected. |
| PT-G10 | Semantic transparency | Instrumented and uninstrumented supported fixtures have equal outcomes, visible exports, property descriptors required by contract, and error identity fields. |
| PT-G15 | Public corpus and consumers | A machine-readable public corpus covers changed, clean, mutation, rejection, ambiguous, unsupported, child/worker, and adversarial cases; standalone ESM, CommonJS, child-process, Dependabot, and Renovate examples install and run from committed lockfiles. |
| PT-G11 | Performance budget | Median wall-clock overhead is ≤2.0× on the published synthetic fixture; report includes raw samples and environment. This is a budget, not a universal claim. |
| PT-G12 | Clean-room release | Linux clean checkout runs install, full tests, killer demo, package smoke test, and generated 15–20 second terminal recording from one command. |

## Independent consumer acceptance

The public
[`prooftape-consumer-example`](https://github.com/DelshadH/prooftape-consumer-example)
is the packaging and onboarding check outside this monorepo. Its first
[upgrade run](https://github.com/DelshadH/prooftape-consumer-example/actions/runs/30160157416)
keeps ordinary tests green across `camelcase` `6.3.0` to `7.0.1`, while
ProofTape reports one changed return and exits `2`. It installs all four alpha
packages from checksum-verified tarballs, uses no secrets or write token, pins
both workflow trust roots to full commits, uploads the report and reproduction,
and emits the explicit authenticity warning. See
[external-consumer.md](external-consumer.md) for the exact revisions and
hashes.

The gate identifiers are stable so test output and release evidence can refer to
the same requirement over time. Changing a requirement needs an explicit design
decision, not a quieter test.

## PT-G07 design decision: narrow the trust claim

Decision date: 2026-07-25.

The original PT-G07 wording combined two different properties: protecting
already-recorded base evidence from candidate writes, and authenticating raw
candidate observations against candidate code. The first property is enforced.
The second is impossible in the current same-process design: the hook and code
under test share an OS principal, and `PROOFTAPE_CONFIG` exposes the writable raw
directory and session identifier required by the hook.

Version 1 therefore narrows the product contract instead of treating
well-formed JSON, session IDs, or producing-job hashes as proof of authorship.
PT-G07 now requires all of the following:

1. the parent records and retains the base capsule before candidate execution;
2. a candidate sibling-worktree attack cannot alter that held base evidence;
3. candidate checkout modification remains a harness failure;
4. a real adversarial command demonstrates that candidate code can replace its
   raw stream with conforming forged evidence;
5. capsules and both report evidence summaries require
   `observationAuthenticity: "not-established"`;
6. reproduction manifests require the same marker and generated reproduction
   documentation states the limitation;
7. successful record/diff/compare output warns that code under test can suppress
   or forge calls;
8. an end-to-end comparison proves a real candidate value can be forged to the
   base value, producing exit 0 only alongside the authenticity warning and
   both report markers;
9. GitHub job hashes are documented only as artifact-transport integrity.

This is an explicit reduction in assurance, not a substitute control. A future
stronger gate would require a collector outside candidate OS authority and a new
product contract.

## Killer demo acceptance

The demo must show, in one uninterrupted run:

1. base tests green;
2. candidate tests green;
3. ProofTape exits 2;
4. one concise behavioral diff;
5. generated `repro.mjs` fails on candidate and matches base expectation;
6. `report.json` names the same counterexample.
7. the observation-authenticity warning is visible in the terminal transcript.

A hand-edited screenshot is not evidence.

## Automated gate map

| Gate | Verifier |
|---|---|
| PT-G13 | `.github/workflows/ci.yml` runs locked install, typecheck, all tests, audit, and packed CLI/Action smoke on Node 22 and 24. |
| PT-G01, PT-G10 | `packages/hook/test/interception.test.ts`, `runtime.test.ts`, and `transform.test.ts` execute real ESM, CJS, native Promise, error, mutation, worker, and child-process fixtures. |
| PT-G02, PT-G03 | Schema, capsule, serialization, and property tests plus the 20-run recording test prove strict parsing and byte-identical repetition; `scripts/package-smoke.mjs` parses all three committed v1 goldens through the packed `@prooftape/schema` installed in a clean temporary project. |
| PT-G14 | Hook child/worker tests and raw-capsule corruption, session, line, file, and byte-limit tests make capture loss explicit. |
| PT-G04 | `npm run demo` executes both green commands, returns ProofTape exit 2, and verifies the same report/reproduction match key. |
| PT-G05 | Runtime, diff, report, and compare tests cover mutation, rejection, insertion, deletion, sequence, and ambiguous repeats. |
| PT-G06 | `packages/core/test/normalize.test.ts` proves declared-only UUID, timestamp, and path normalization with an audit record per field. |
| PT-G07 | `packages/core/test/compare.test.ts` protects held base evidence and detects checkout changes; `record.test.ts` executes a raw-stream forgery; `packages/cli/test/adversarial-compare.test.ts` proves a genuine A-to-B behavior change can be forged into a warned exit-0 result; schema, reproduction, and CLI tests require the machine-readable authenticity marker, generated warning, and terminal warning; `.github/workflows/prooftape.yml` separates jobs and binds artifact transport to producing-job hashes without claiming observation authorship. |
| PT-G08 | `npm run real-upgrades` builds isolated Git histories from six committed lockfiles and tests `camelcase`, `is-number`, and `ms`. |
| PT-G09 | `npm run security` combines npm audit, license allowlist, production-install-script check, tracked-source secret scan, and workflow policy scan. |
| PT-G15 | `npm run corpus` validates and executes `fixtures/compatibility-corpus/manifest.json`; `npm run smoke:examples` installs and runs each project-owned example from a temporary standalone checkout and validates the pinned read-only workflow templates. |
| PT-G11 | `npm run performance` records seven raw sample pairs, environment, medians, and the enforced 2.0× budget. |
| PT-G12 | The Node 24 quality job runs the demo, 15.5-second cast generation, real upgrades, performance, security, and package smoke from a clean checkout. |
