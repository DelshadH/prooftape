# Project-owned consumer examples

These examples are installable npm projects owned by ProofTape. They are not
claimed as outside adoption.

- `esm`: a direct ESM call to `camelcase`;
- `commonjs`: a CommonJS call to `is-number`;
- `child-process`: a parent test whose child calls `ms`;
- `github`: an ordinary dependency-update PR workflow plus Dependabot and
  Renovate configuration templates.

Each application test is intentionally small so a maintainer can copy it,
upgrade the dependency, and run ProofTape against the two exact commits.
Observation authenticity remains `not-established`; the examples are
regression evidence only when code under test is not actively evading or
forging instrumentation.
