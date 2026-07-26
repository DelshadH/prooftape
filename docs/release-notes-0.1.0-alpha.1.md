# ProofTape 0.1.0-alpha.1

This document describes a prospective release candidate. No release tag,
GitHub release, npm package, or npm distribution tag exists until the owner
authorizes publication.

Observation authenticity is not established against code under test. Candidate
code shares the recorder's process authority and can suppress or forge its own
captured calls. Exit 0 means only that no blocking difference was observed in
captured supported calls.

This is an alpha release candidate. The capsule, report, and
reproduction-manifest JSON shapes become the stable public version 1 contract
when this candidate is published.
Artifacts made by unpublished `0.0.0` development builds are unsupported.

## Included

- exact base/candidate Git revision recording for one npm dependency;
- supported direct synchronous ESM and CommonJS calls, including errors,
  argument mutation, call presence, relative order, and receiver-aware replay;
- strict bounded v1 JSON parsers, canonical hashes, and executable safe
  reproductions;
- public exit codes 0, 2, 3, and 4 with explicit unsupported handling;
- a composite recording Action and isolated three-job reusable workflow;
- clean-room tarball installation, real changed/unchanged CLI smoke,
  SHA-256 sums, a sanitized CycloneDX SBOM, and a prepared npm provenance
  publication workflow;
- a public changed/clean/hostile compatibility corpus and standalone ESM,
  CommonJS, child-process, Dependabot, and Renovate examples.

## Deliberately unsupported

Dynamic imports, re-exports, constructors, tagged templates, optional or
computed calls, deep members, `call`/`apply`/`bind`, custom prototypes, cycles,
accessors, native Promise settlement observation, and multiple dependencies are
outside the alpha contract. Promise objects are returned unchanged and recorded
as explicitly unsupported so ProofTape does not alter native unhandled-rejection
semantics. The local runner is not a sandbox for hostile code.

**REGISTRY AUTHENTICATION UNAVAILABLE**

Until publication is authorized, evaluate the checksum-verified tarballs
attached to the release candidate evidence. If npm publication later succeeds,
the packages will use the `alpha` distribution tag. Read
[the product contract](product.md), [schema policy](schema-compatibility.md),
and [security model](security-model.md) before evaluation.
