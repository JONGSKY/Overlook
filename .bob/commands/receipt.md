---
description: Render the Overlook receipt for an audit, ready to post on the pull request
argument-hint: <audit id> [decisions.json]
---

Call `overlook_receipt` with `audit_id: $1` (and `decisions: $2` if given), write it to `out/receipt.md`,
and show it. If the user asks, post it with `gh pr comment <number> --body-file out/receipt.md`.
