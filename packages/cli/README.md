# prooftape

Observation authenticity is not established against code under test.

ProofTape is a command-line tool that compares captured runtime behavior of one
npm dependency across exact base and candidate Git revisions.

This package is an early `0.1.0-alpha.1` release for Node.js 22.15 or newer.

```bash
npx prooftape compare \
  --base-ref <40-character-sha> \
  --candidate-ref <40-character-sha> \
  --dependency <package> \
  --command "npm test"
```

The supported observation surface and exit codes are documented in the
[product contract](https://github.com/DelshadH/prooftape/blob/main/docs/product.md).
Read the
[trust boundary](https://github.com/DelshadH/prooftape/blob/main/docs/security-model.md)
before relying on a result.

Licensed under Apache-2.0.
