# Support

ProofTape currently supports the latest published alpha only. After a stable
release exists, support covers that latest stable release and the current
prerelease used to evaluate the next stable release.

Support means reproducing defects within the documented product contract,
maintaining the public exit-code and versioned-artifact contracts, and issuing
security or compatibility guidance when those contracts are affected. It does
not promise support for every JavaScript call shape, package manager, operating
system, or hostile local execution environment.

An observation outside the documented instrumentation surface is rejected with
exit code 4. That rejection is not a compatibility promise to add the surface.
Feature requests belong in a public GitHub issue. Suspected vulnerabilities,
secret exposure, release compromise, or bypass of a stated security boundary
belong in a private
[GitHub Security Advisory](https://github.com/DelshadH/prooftape/security/advisories/new).

Include the ProofTape version, Node version, operating system, command, public
exit code, and a synthetic reproduction. Do not attach production capsules,
credentials, private source, or customer data.
