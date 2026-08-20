# ProofTape 0.1.0-alpha.2

`0.1.0-alpha.2` is published from immutable tag `v0.1.0-alpha.2` through the
tokenless npm trusted-publisher workflow. All four packages are built twice
from the reviewed source, checksum verified, and published with registry
signatures and GitHub provenance.

Observation authenticity is not established against code under test. Candidate
code shares the recorder's process authority and can suppress or forge its own
captured calls. Exit 0 means only that no blocking difference was observed in
captured supported calls.

## Changes since alpha.1

- Updates the runtime parser dependency `acorn` from 8.17.0 to 8.18.0.
- Updates the transitive development dependency `nanoid` from 3.3.16 to 3.3.18,
  resolving GHSA-2v37-7h3g-55p8.
- Keeps the public version 1 capsule, report, and reproduction-manifest formats,
  exit codes, supported observation surface, and authenticity boundary unchanged.

## Published packages

- `@prooftape/schema@0.1.0-alpha.2`
- `@prooftape/core@0.1.0-alpha.2`
- `@prooftape/hook@0.1.0-alpha.2`
- `prooftape@0.1.0-alpha.2`

The `alpha` dist-tag points to this version. Install the CLI explicitly from the
prerelease channel:

```bash
npm install --save-dev prooftape@alpha
```

Read the [product contract](product.md),
[schema policy](schema-compatibility.md), and
[security model](security-model.md) before evaluation.
