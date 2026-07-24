# Contributing

ProofTape is early and its trust boundaries are still settling. Before starting
work, read `docs/product.md`, `docs/architecture.md`, and
`docs/security-model.md`.

Keep pull requests narrow. Add a failing fixture first, then the implementation,
tests, and any documentation affected by the behavior. Changes to interception,
canonical data, baseline integrity, redaction, workflow permissions, or resource
limits need an explicit security note in the pull request.

Run:

```bash
npm run typecheck
npm test
npm run build
```

Please do not add a dashboard, hosted service, additional language, or plugin
system before the 0.1 command-line path is complete.
