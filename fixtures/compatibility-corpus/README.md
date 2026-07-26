# Public compatibility corpus

This manifest indexes the runnable public-upstream and synthetic cases used to
bound ProofTape's alpha claim. Run it with:

```bash
npm run corpus
```

Each manifest entry carries a direct argument-vector command and a
machine-readable expected result. The gate executes every case independently,
compares the keyed result, and writes
`.evidence/compatibility-corpus.json`. Mutation, throw/error, ambiguous,
unsupported-syntax, and child/worker cases cross the real CLI boundary; the
forgery case runs the full adversarial comparison fixture.

Synthetic cases prove the mechanism and are labeled `synthetic`. The three
real-upgrade fixtures use public packages and committed lockfiles. None of
these cases is claimed as outside adoption or proof of unobserved behavior.
Every result retains the version-1 limitation:
`observationAuthenticity: "not-established"`.
