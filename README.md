# ProofTape

**Catch runtime behavior changes in dependency-upgrade pull requests—even when the tests stay green.**

ProofTape records how an application calls one npm dependency at a trusted base
revision, records the same calls on a candidate revision, and reports meaningful
differences. A report can include changed return values, exceptions, argument
mutation, and call ordering, plus a small executable reproduction when the data
can be serialized safely.

This matters when an automated upgrade also edits tests: a green suite can show
that the new code agrees with the new tests, but it does not independently show
that observed dependency behavior stayed the same.

> **Status:** pre-0.1 development. The schema and diffing kernel are present; the
> recorder, isolation runner, and release CLI are not complete yet. Do not put
> ProofTape in a required CI check until the 0.1 release.

## Intended command

```bash
prooftape compare \
  --base-ref "$BASE_SHA" \
  --candidate-ref "$HEAD_SHA" \
  --dependency zod \
  --command "npm test"
```

The lower-level flow will also be available:

```bash
prooftape record --dependency zod --command "npm test" --out baseline.ptape
prooftape record --dependency zod --command "npm test" --out candidate.ptape
prooftape diff --baseline baseline.ptape --candidate candidate.ptape --repro-dir repro
```

Exit codes are part of the public contract:

- `0`: no blocking difference was observed in captured, supported calls.
- `2`: one or more blocking behavior differences were found.
- `3`: the harness, command, instrumentation, or isolation failed.
- `4`: the input is invalid or uses an unsupported surface.

## Scope

The first release targets Node.js 22 and 24, npm lockfiles, one explicitly named
dependency, JSON-safe functions and object methods, and synchronous or
promise-based outcomes. It will not claim total semantic equivalence or safety
for unobserved calls.

The product contract is in [docs/product.md](docs/product.md), the implementation
shape is in [docs/architecture.md](docs/architecture.md), and the release proofs
are in [docs/quality-plan.md](docs/quality-plan.md).

## Development

```bash
npm install --ignore-scripts
npm run typecheck
npm test
```

See [CONTRIBUTING.md](CONTRIBUTING.md) before opening a pull request.

## Security

ProofTape executes project test commands and may observe sensitive arguments.
Read [SECURITY.md](SECURITY.md) and [docs/security-model.md](docs/security-model.md)
before trying it on private code.

Apache-2.0 licensed.
