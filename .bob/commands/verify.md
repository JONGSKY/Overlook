---
description: Run the repository's own tests for an Overlook audit
argument-hint: <audit id> [cross|reverts|checks] [decisions.json]
---

Call `overlook_verify` with `audit_id: $1` and `kind: $2` (default `cross`; pass `decisions: $3` for `reverts`).
Report the command, pass/fail and the last lines of output, then show how the claim verdicts changed.
