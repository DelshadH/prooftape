# Version 1 formats

ProofTape writes canonical JSON followed by one newline. All public objects use
`"schemaVersion": "1"`. Parsers reject unknown fields and incompatible versions
instead of guessing forward compatibility.

Pre-release amendment: the required `observationAuthenticity` marker was added
while every package was still unpublished at `0.0.0`. Earlier development
artifacts without the marker are intentionally rejected rather than silently
upgraded, so an absent trust boundary cannot be mistaken for
observation-authenticated evidence.

The capsule, report, and reproduction-manifest shapes become the stable public
version 1 contract with the first published alpha. See
[the compatibility policy](schema-compatibility.md) for the exact promise,
version-bump rules, golden fixtures, and hash scopes.

## Capsule

A capsule has:

- `kind: "prooftape-capsule"`;
- evidence metadata for commit, lockfile, runtime, command, dependency, tool,
  configuration, and `observationAuthenticity: "not-established"`;
- an ordered `calls` array;
- an `issues` array.

Each call records dependency, export path, call site, normalized process and
sequence identifiers, arguments before and after, and exactly one return,
throw, resolve, or reject outcome. Optional normalization and unsupported-value
arrays point to every changed or rejected field.

Capsules are limited to 10 MiB, 10,000 calls, 1,000 issues, JSON depth 32, and
10,000 JSON entries per validated value. Raw capture uses additional per-file,
per-line, total-byte, and event limits.

## Tagged values

Version 1 uses `$prooftape` objects for:

- `undefined`;
- `nan`, `infinity`, `-infinity`, and `-0`;
- decimal-string `bigint`;
- ISO-string `date`;
- explicit `unsupported` with a reason.

Object keys are sorted recursively. Plain JSON strings remain strings. Cycles,
accessors, custom prototypes, symbols, proxy traps, and bounded-limit failures
are unsupported rather than lossy encodings.

## Report

A report has:

- `kind: "prooftape-report"`;
- dependency and verdict;
- blocking and warning counts that must equal the difference array;
- base and candidate capsule hashes, commits, lockfile hashes, and dependency
  versions, with `observationAuthenticity: "not-established"` repeated for each
  evidence summary;
- versioned differences;
- optional reproduction metadata.

The two verdicts are `no-blocking-differences-observed` and
`behavior-changed`. Reports are limited to 20 MiB and 20,000 differences.

## Hashes

Capsule hashes cover canonical capsule bytes without the trailing file newline.
Lockfile hashes cover exact installed-checkout bytes. Artifact hashes in the
GitHub workflow cover the complete capsule file bytes, including its newline.
Reproduction manifests hash each generated file and then hash the canonical
manifest. Reproduction manifests also carry
`observationAuthenticity: "not-established"`, and the generated README states
the same limitation.

Hashes detect byte changes after production. They do not prove that code under
test did not suppress or forge the in-process observations before the capsule
was produced.

## Action and workflow presentation

The composite Action exposes the literal output
`observation-authenticity=not-established` in addition to the capsule path and
complete-file transport hash. The reusable workflow summary shows both
canonical capsule hashes and complete artifact transport hashes with distinct
labels. Neither output changes the version-1 JSON schemas or establishes
observation authorship.
