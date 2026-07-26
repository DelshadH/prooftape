# CommonJS consumer

This CommonJS project makes one supported direct call to `is-number`.

```bash
npm ci --ignore-scripts
npm test
```

Commit this base, upgrade `is-number`, commit the candidate, then compare the
exact SHAs with dependency `is-number` and command `npm test`.
