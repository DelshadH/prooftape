# ESM consumer

This Node ESM project makes one supported direct call to `camelcase`.

```bash
npm ci --ignore-scripts
npm test
```

Commit this base, upgrade `camelcase`, commit the candidate, then run the
repository README's `prooftape compare` command with the two exact SHAs,
dependency `camelcase`, and command `npm test`.
