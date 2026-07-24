# camelcase 6 to 7

This fixture upgrades `camelcase` from 6.3.0 to 7.0.1. Both fixture checks
remain green because they assert the public return type. ProofTape observes that
`camelCase("-")` changes from `"-"` to `""`.

The package's
[v7.0.0 release notes](https://github.com/sindresorhus/camelcase/releases/tag/v7.0.0)
document that a separator-only input now returns an empty string. They also
document the move to pure ESM.
