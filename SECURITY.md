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

ProofTape is pre-release software. Until version 0.1 is published, use only
synthetic fixtures or disposable repositories without credentials.
