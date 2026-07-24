# Research sources to verify during implementation

Use primary sources for implementation decisions and re-check versions before release.

- Node.js module customization hooks: https://nodejs.org/api/module.html
- GitHub Actions secure-use guidance: https://docs.github.com/en/actions/reference/security/secure-use
- GitHub artifact attestations: https://docs.github.com/en/actions/security-guides/using-artifact-attestations-to-establish-provenance-for-builds
- Gilesi behavioral library-upgrade comparison paper: https://arxiv.org/abs/2507.20814
- ChangeGuard behavioral regression research: https://github.com/sola-st/ChangeGuard

Do not claim that runtime behavior comparison is novel. The v0.1 differentiation must be proven in the protected-base workflow, agent-readable counterexample, executable reproduction, and baseline-integrity gates.
