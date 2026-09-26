---
name: feature-check
description: >-
  Turns a feature claim from an agent's report into one executable check that exits 0 only when the claim
  holds on the head commit. Use when auditing claims git cannot check by itself.
---

# feature-check

Git can tell which files changed, not whether "article dates now show relative time". An executed check can.

## Process

1. Read the claim and find the code that implements it (entry points, the changed files in `out/evidence.json`).
2. Pick the smallest observable behaviour that proves the claim: a function's output, a rendered string,
   an HTTP response, a CLI output.
3. Write a check that runs from the repository root without network access or new dependencies:
   - JavaScript/TypeScript: `node -e "..."` or a small `out/checks/<n>-<slug>.mjs` that imports the module.
   - Existing test runner: a focused command such as `npx vitest run src/articles -t "relative time"`.
   - Python: `python -c "..."` or `python -m pytest -q path::test`.
4. The check must **fail on base** (the behaviour did not exist) and **pass on head** if the claim is true.
   Say so in `why`.
5. Put it on the claim: `"check": { "command": "sh out/checks/1-relative-dates.sh", "why": "..." }`.
6. If no honest check is possible, leave `check` out, set `verdict: "unverified"` and explain in `note`.

## Example

Claim: "Article dates now show relative time."

```json
{ "text": "Article dates now show relative time.", "type": "feature",
  "check": { "command": "node out/checks/1-relative-dates.mjs",
             "why": "ArticleMeta renders '3 days ago' for a date three days old; base renders the absolute date." } }
```
