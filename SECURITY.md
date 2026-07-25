# Security policy

Please report suspected vulnerabilities privately through
[GitHub Security Advisories](https://github.com/DelshadH/prooftape/security/advisories/new).
Do not include real secrets, private source, or captured production data in a
report. A small synthetic reproduction is preferred.

High-priority areas include:

- captured secrets reaching files, logs, errors, or artifacts;
- a candidate branch replacing or influencing the protected base revision or
  retained base capsule;
- path traversal, archive expansion, or unbounded input;
- unintended privileged execution in GitHub Actions;
- instrumentation changing supported program behavior.

ProofTape is pre-release software. Until version 0.1 is published, run local
comparisons only in disposable repositories without credentials. For hostile
pull requests, use the separate-job workflow described in
`docs/github.md` on an ephemeral hosted runner to protect the host and base
artifact. That workflow does not authenticate candidate observations against
candidate code. Its Action output and job summary state that limitation
explicitly; see `docs/security-model.md`.

Supported security maintenance covers the current alpha and, after a stable
release exists, the latest stable release. Affected published versions are
named in the private advisory and eventual disclosure. Release-integrity or
publisher-identity incidents follow
[docs/compromised-release.md](docs/compromised-release.md).

Repository recovery, npm ownership, trusted-publisher removal, session/token
revocation, and successor validation are documented in
[docs/maintainer-recovery.md](docs/maintainer-recovery.md). That procedure
deliberately contains no recovery codes, private contacts, or account secrets.
