# Public compatibility corpus

This manifest indexes the runnable public-upstream and synthetic cases used to
bound ProofTape's alpha claim. Run it with:

```bash
npm run corpus
```

The gate executes the referenced real-upgrade, matching, interception, and
adversarial tests and writes `.evidence/compatibility-corpus.json`.

Synthetic cases prove the mechanism and are labeled `synthetic`. The three
real-upgrade fixtures use public packages and committed lockfiles. None of
these cases is claimed as outside adoption or proof of unobserved behavior.
Every result retains the version-1 limitation:
`observationAuthenticity: "not-established"`.
