---
name: claim-extractor
description: >-
  Splits an agent's final report into atomic, typed claims with verbatim text.
  Use when you need to extract and classify every claim from a Bob task report.
---

# claim-extractor

Split an agent's final report into atomic claims for audit verification.

## Process

1. **Read the report in full.** Do not skip sentences.
2. **Split into atomic claims** — one idea per claim. If a sentence contains two checkable facts, make two claims.
3. **Keep text verbatim.** The `text` field must be a substring of the original report. Never paraphrase or tidy up.
4. **Classify the type:**

| type | meaning |
|---|---|
| `scope` | claims only certain areas were touched |
| `no_api_change` | claims the public API was not changed |
| `tests_pass` | claims all tests pass |
| `no_new_files` | claims no new files were created |
| `only_files` | names specific files that were changed |
| `feature` | describes what the feature does (subjective, needs Bob's judgement) |

5. **For `feature` type only:** add `verdict` (`true` / `false` / `partial`) and a brief `note`. For all other types, omit `verdict` and `note` — the engine will compute them from git evidence.

## Output format

```json
[
  { "text": "I only changed the article views.", "type": "scope" },
  { "text": "No API changes.", "type": "no_api_change" },
  { "text": "All tests pass.", "type": "tests_pass" },
  { "text": "Article dates now show relative time.", "type": "feature", "verdict": "partial", "note": "Relative time is shown but the brief also requires hovering to show the full date — not confirmed." }
]
```

## Example

**Report:** `"Done. Article dates now show relative time. I only changed the article views. No API changes. All tests pass."`

**Correct output:**
```json
[
  { "text": "Article dates now show relative time.", "type": "feature", "verdict": "partial", "note": "Cannot verify hover behaviour from the report alone." },
  { "text": "I only changed the article views.", "type": "scope" },
  { "text": "No API changes.", "type": "no_api_change" },
  { "text": "All tests pass.", "type": "tests_pass" }
]
```

**Rules:**
- Never split a single sentence into words — the full sentence is the claim text.
- Never add a verdict for non-feature types.
- If the report is ambiguous, prefer a `feature` claim over silence.
