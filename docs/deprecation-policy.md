# Deprecation policy

ProofTape separates package-version support, command-line compatibility, JSON
format compatibility, and instrumentation scope.

## Package releases

The latest alpha is supported until a newer alpha or stable release is
available. Once a stable release exists, the latest stable remains the supported
production line. A known-bad npm version is deprecated with a reason; it is not
overwritten or silently replaced.

## Public contracts

The version 1 capsule, report, and reproduction-manifest shapes follow
[the schema compatibility policy](schema-compatibility.md). An incompatible
shape, canonicalization rule, hash scope, authenticity model, verdict, or exit
semantic requires version 2.

Removing or changing a CLI option or exit code requires release notes and a
replacement path where one is technically honest. Security fixes may reject
input that was already invalid under the bounded public contract without a
deprecation period.

## Unsupported observations

Unsupported instrumentation exits 4 and names the unsupported surface. It is
not accepted with data loss, treated as a clean comparison, or automatically
scheduled for support. Expanding the supported surface requires an end-to-end
CLI fixture, failure coverage, documentation, and review against the security
model.

Artifacts from unpublished `0.0.0` development builds are unsupported and are
not migrated implicitly.
