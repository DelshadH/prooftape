# Contributing

Read `docs/product.md`, `docs/security-model.md`, `docs/architecture.md`, and
`docs/quality-plan.md` before changing a public boundary.

Keep changes narrow and start behavioral work with a failing fixture. Changes
to interception, canonical data, baseline integrity, redaction, workflow
permissions, resource limits, or exit codes need a test that exercises the real
CLI or hook.

Run the same checks used for a release:

```bash
npm ci --ignore-scripts
npm run check
npm run smoke:package
npm run demo
npm run real-upgrades
npm run performance
npm run security
```

Do not weaken a quality gate to make CI green. Do not add a dashboard, hosted
service, language, plugin system, or runtime dependency without a concrete need
inside the pre-0.1 command-line contract.
