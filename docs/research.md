# Primary implementation sources

These sources were re-checked on 2026-07-24.

- [Node module customization hooks](https://nodejs.org/api/module.html#customization-hooks)
  documents synchronous `module.registerHooks`, its availability from Node
  22.15, registration through `--import`, and its coverage of `import`,
  `require`, and `createRequire`.
- [GitHub secure use reference](https://docs.github.com/en/actions/reference/security/secure-use)
  treats pull-request contexts as untrusted and recommends least-privilege
  tokens and full-commit Action references.
- [GitHub reusable workflow documentation](https://docs.github.com/en/actions/how-tos/reuse-automations/reuse-workflows)
  documents `workflow_call`, permission downgrading, and full commit SHAs as the
  safest reusable-workflow reference.
- [GitHub reusable configuration concepts](https://docs.github.com/en/actions/concepts/workflows-and-actions/reusing-workflow-configurations)
  distinguishes multi-job reusable workflows from composite Actions.

The real-upgrade fixture sources are the package maintainers'
[`camelcase` v7 notes](https://github.com/sindresorhus/camelcase/releases/tag/v7.0.0),
[`is-number` 6-to-7 comparison](https://github.com/jonschlinkert/is-number/compare/6.0.0...7.0.0),
and [`ms` v2.1.3 notes](https://github.com/vercel/ms/releases/tag/2.1.3).

ProofTape does not claim that runtime behavior comparison is novel. Related work
includes the [Gilesi library-upgrade comparison paper](https://arxiv.org/abs/2507.20814)
and [ChangeGuard](https://github.com/sola-st/ChangeGuard). The project is
distinguished by its narrow Node CLI, protected-base workflow, strict evidence
format, and executable counterexample.
