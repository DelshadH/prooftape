# Independent consumer evidence

ProofTape's canonical external consumer is the separate public repository
[`DelshadH/prooftape-consumer-example`](https://github.com/DelshadH/prooftape-consumer-example).
It is not a workspace, fixture, or package of this monorepo.

## Reviewed scenario

The open, unmerged
[dependency-upgrade pull request](https://github.com/DelshadH/prooftape-consumer-example/pull/1)
upgrades `camelcase` from `6.3.0` to `7.0.1`.

- protected base: `b9f84af2fab743eb57dbe9233746c98ed36e396b`;
- candidate: `2bcc279f3fc1d6af5660c0f95b9caa85653d4ea1`;
- ordinary application test: exit `0` on both revisions;
- plain application result: `"-"` at the base and `""` at the candidate;
- ProofTape verdict: `behavior-changed`;
- blocking difference: one `changed-return` for the default export;
- ProofTape exit code: `2`.

The consumer installs the four `0.1.0-alpha.1` packages from checksum-verified
packed tarballs. Its workflow has `contents: read`, passes no secrets, uses the
exact pull-request revision SHAs, pins the reusable workflow to
`7e2b4cf7aa0da8a7180ccf7a4b4f93a8ac0e157e`, and that workflow pins its
ProofTape checkout to the reviewed implementation commit
`a208493d37b5fe8aa579340fa5ff6d99bacdcb29`.

## GitHub run

The independent
[workflow run](https://github.com/DelshadH/prooftape-consumer-example/actions/runs/30160157416)
completed both ordinary tests and both recording jobs successfully. The final
job failed intentionally when it enforced ProofTape's public exit code `2`;
this is the expected required-check behavior for a blocking difference, not an
infrastructure failure.

The generated job summary contains the exact commits and dependency versions,
verdict and exit code, canonical capsule hashes, producing-job transport hashes,
and the bold statement **Observation authenticity is not established.** It
separates these claims:

1. the protected base capsule was retained before candidate execution;
2. capsule bytes matched their producing-job hashes during transport;
3. capsule structure was validated before observations were compared;
4. none of those properties establishes observation authorship.

Exact evidence:

| Property | SHA-256 |
| --- | --- |
| Base canonical capsule | `d1b4d84df2eb17050541c97d3ce6e1d3830dd76d8696b5ab710823724c66a310` |
| Candidate canonical capsule | `9fc929e128947652d8176ccda4ac49b2af0c904b2761ff668d0467d4589ce63a` |
| Base producing-job capsule bytes | `d9d35499683d9759586bc16ea5fb2296599bdc81e6f6f3f3e3a623abc9ff5a03` |
| Candidate producing-job capsule bytes | `5a9a7aea693379644e07318a04304f06d7ea84512600e2a96e2f961fb50a6310` |
| Base capsule artifact archive | `25a4fdd6f869de90df582c2204b95573265fe5d83accc217358fc6fa3c2469c3` |
| Candidate capsule artifact archive | `ef6af3ad18dfd810308b6ce8f2bb42fc8d5bb3b8a09c38c7d0e33505602c6631` |
| Report artifact archive | `13b82ee25041dd44bdbca46247c27c8c996c1f9b790abbc721f659ed8d9b3e2d` |
| Reproduction manifest | `7134a5ab2ff0cf90ae98bada2b62dcf2ab41f2e1664d8641e36c14dc0203e0de` |

The
[`prooftape-report` artifact](https://github.com/DelshadH/prooftape-consumer-example/actions/runs/30160157416/artifacts/8620020838)
contains the version-1 report, exit-code file, and runnable reproduction. The
reproduction exits `0` against the base package and `1` against the candidate,
matching the report's counterexample.

## Remaining external limitation

This run intentionally validates pre-publication tarball consumption. It does
not prove installation from the npm registry or registry provenance because
the packages have not been published. Registry publication remains blocked by
the first-publication trusted-publisher bootstrap described in
[RELEASING.md](../RELEASING.md).
