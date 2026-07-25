# Schema compatibility policy

ProofTape's capsule, report, and reproduction-manifest JSON shapes become the
stable public version 1 contract when `0.1.0-alpha.1` is published. Development
artifacts produced by unpublished `0.0.0` packages are not a compatibility
promise. In particular, version 1 development artifacts without the required
`observationAuthenticity: "not-established"` marker are rejected.

## Version 1 promise

After the first alpha is published:

- a version 1 parser will continue to accept every valid version 1 artifact;
- writers will keep required fields, field meanings, verdicts, limits, and hash
  scopes compatible;
- unknown fields and future schema versions remain errors rather than being
  ignored;
- fixes may make validation stricter only where an artifact was already invalid
  under the documented version 1 contract.

The committed golden files in `fixtures/schema` are parsed in source tests and
again from the packed `@prooftape/schema` dependency installed into a clean
temporary project. Those files cover the capsule, report, and reproduction
manifest contracts.

## When version 2 is required

A new schema version is required before any change that:

- adds a required field or removes or renames an existing field;
- changes a field's type, meaning, units, or allowed values;
- reinterprets a verdict or the public exit-code mapping;
- changes canonical JSON, semantic hash scope, or artifact hash scope;
- changes how observation authenticity is represented;
- makes a previously valid version 1 artifact invalid.

Version 1 parsers reject version 2 artifacts. A future migration must therefore
ship an explicit version-aware reader or converter; it must not silently guess.

## Canonical bytes and hashes

ProofTape canonical JSON sorts object keys recursively and emits no insignificant
whitespace. Persisted JSON files append one line-feed byte.

- Capsule hashes cover canonical JSON bytes without the trailing line feed.
- Report evidence repeats those canonical capsule hashes.
- Reproduction file hashes cover each exact generated file.
- A reproduction manifest hash covers its canonical JSON without the trailing
  line feed.
- GitHub artifact transport hashes cover the complete capsule file, including
  its trailing line feed.

These hashes detect later byte changes within their stated scope. They do not
establish who authored an in-process observation.
