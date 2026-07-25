# Security policy

Please report suspected vulnerabilities privately through
[GitHub Security Advisories](https://github.com/DelshadH/prooftape/security/advisories/new).
Do not include real secrets, private source, or captured production data in a
report. A small synthetic reproduction is preferred.

High-priority areas include:

- captured secrets reaching files, logs, errors, or artifacts;
- a candidate branch replacing or influencing the trusted baseline;
- path traversal, archive expansion, or unbounded input;
- unintended privileged execution in GitHub Actions;
- instrumentation changing supported program behavior.

ProofTape is pre-release software. Until version 0.1 is published, run local
comparisons only in disposable repositories without credentials. For hostile
pull requests, use the separate-job workflow described in
`docs/github.md` on an ephemeral hosted runner to protect the host and base
artifact. That workflow does not authenticate candidate observations against
candidate code; see `docs/security-model.md`.
