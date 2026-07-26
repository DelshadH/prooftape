# GitHub dependency-update PR

Copy `prooftape-camelcase.yml` to `.github/workflows/prooftape.yml` in the
consumer repository. It runs for ordinary, Dependabot, and Renovate pull
requests because all use the same exact base and candidate event SHAs.

Copy either `dependabot.yml` to `.github/dependabot.yml` or `renovate.json` to
the repository root. Change the dependency and direct command only after
proving the command reaches a supported call.

Keep the full ProofTape commit pin, `contents: read`, and no inherited secrets.
The check protects retained base evidence and transport integrity; observation
authenticity remains `not-established`.
