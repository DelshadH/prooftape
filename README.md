# ProofTape

**Catch runtime behavior changes in dependency upgrades, even when both test
suites stay green.**

ProofTape records how an application calls one npm dependency at an exact base
revision, records the same supported calls at an exact candidate revision, and
compares the results. It detects changed returns, errors, argument mutation,
call presence, and relative order. When the captured values are safe to replay,
it also writes an executable minimal reproduction.

> **Status:** honest pre-0.1 seed. The end-to-end CLI, recorder, schemas,
> isolated worktrees, reproduction generator, package smoke test, and
> least-privilege reusable workflow are implemented and exercised. The npm
> packages are not published yet, the supported JavaScript surface is
> deliberately narrow, the local runner is not a sandbox for hostile code, and
> observation authenticity is not established against code under test.

## Run from a checkout

ProofTape requires Node 22.15 or newer and an npm lockfile.

```bash
npm ci --ignore-scripts
npm run build

node packages/cli/dist/cli.js compare \
  --base-ref "$BASE_SHA" \
  --candidate-ref "$HEAD_SHA" \
  --dependency zod \
  --command "npm test"
```

`compare` requires two full lowercase commit SHAs and a completely clean
repository. It creates detached worktrees, runs `npm ci --ignore-scripts` in
each, records the same direct command, and removes the worktrees afterward.

The lower-level flow is useful when base and candidate recording must happen on
different machines or in different GitHub jobs:

```bash
node packages/cli/dist/cli.js record --dependency zod --command "npm test" --out baseline.ptape
node packages/cli/dist/cli.js record --dependency zod --command "npm test" --out candidate.ptape
node packages/cli/dist/cli.js diff --baseline baseline.ptape --candidate candidate.ptape
```

Commands are parsed into an argument vector and executed without a shell.
Operators, substitutions, multiline input, and more than 256 arguments are
rejected.

## Trust boundary

ProofTape detects regressions when the executed code does not actively evade or
forge its in-process instrumentation. The hook configuration necessarily gives
that process its writable raw directory and session identifier. Code under test
therefore has enough authority to suppress calls or replace them with
well-formed forged observations. Structural validation, session identifiers,
capsule hashes, and separate GitHub jobs do not establish who authored a call.

Every capsule and report records
`"observationAuthenticity": "not-established"`, and every successful
record/diff/compare command prints the same warning. The separate-job workflow
still protects already-recorded base evidence and artifact transport from the
candidate; it does not turn candidate observations into an attestation. The
composite Action exposes `observation-authenticity=not-established`, and the
workflow job summary repeats the warning beside the exact revisions, dependency
versions, canonical capsule hashes, artifact transport hashes, verdict, and exit
code.

## What is supported

The recorder handles static ESM imports and CommonJS `require` bindings that are
called directly or through one static member. It records synchronous returns and
throws, native Promise resolutions and rejections, and before/after argument
values. ESM and CJS fixtures prove that supported calls retain their result,
`this`, function identity, and required descriptors.

Dynamic imports, re-exports, constructors, tagged templates, optional calls,
computed or deep members, `call`/`apply`/`bind`, custom prototypes, cycles,
accessors, and other unsafe values are explicit unsupported results. They never
quietly produce a clean verdict. See [the product contract](docs/product.md) for
the full boundary.

Exit codes are part of the public contract:

- `0`: no blocking difference was observed in captured supported calls.
- `2`: one or more blocking behavior differences were found.
- `3`: the harness, command, instrumentation, isolation, or matching failed.
- `4`: input is invalid or an observed surface is unsupported.

## Reproducible release evidence

```bash
npm run check
npm run smoke:package
npm run demo
npm run demo:record
npm run real-upgrades
npm run performance
npm run security
```

The demo shows green base and candidate tests, one blocking change, and the same
counterexample in `report.json` and `repro.mjs`. The real-upgrade gate covers
locked `camelcase`, `is-number`, and `ms` upgrades. CI runs the supported Node
22 and 24 matrix. Repeated release-gate runs safely replace their own prior
files inside `.evidence`; other explicit output paths remain create-only.

The JSON format is documented in [docs/formats.md](docs/formats.md), the
security boundary in [docs/security-model.md](docs/security-model.md), and every
release gate in [docs/quality-plan.md](docs/quality-plan.md). The protected
workflow setup is in [docs/github.md](docs/github.md).

## Security

Recorded commands are arbitrary project code. Use a disposable local repository
or the separate-job GitHub workflow, never a privileged self-hosted runner.
ProofTape removes unrelated environment variables before starting the command,
but it does not contain filesystem or network access on a local machine. An
ephemeral hosted runner protects the host better; it does not prevent candidate
code from forging its own capture. Read [SECURITY.md](SECURITY.md) before using
captured private data.

Apache-2.0 licensed.
