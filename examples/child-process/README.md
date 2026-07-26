# Child-process consumer

The parent starts a Node child process. The child inherits ProofTape's hook and
makes one supported direct call to `ms`.

```bash
npm ci --ignore-scripts
npm test
```

Commit this base, upgrade `ms`, commit the candidate, then compare the exact
SHAs with dependency `ms` and command `npm test`.
