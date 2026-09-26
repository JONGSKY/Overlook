---
name: business-translate
description: >-
  Translates technical file-change evidence into plain language for non-developers.
  Use when you need plain-language titles and details for audit items.
---

# business-translate

Write plain-language summaries of technical changes for product managers and team leads.

## Rules

- **Title:** under 12 words. Must describe what the change means to customers or other teams — not what code changed.
- **Detail:** under 20 words. Describe observable impact. State risk plainly.
- **No code words.** No file names, function names, class names, or technical jargon.
- **No false reassurance.** Do not write "minor change" or "likely fine" without evidence. Use "Needs a check." when uncertain.
- **Describe what customers or other teams notice**, not what the developer did.

## Output format

For each file path in the evidence, provide:

```json
{
  "src/api/articles.serializer.ts": {
    "title": "Article data sent to apps may include new field",
    "detail": "A new date field was added to article responses. Third-party apps may need updating."
  }
}
```

## Examples

### Good translations

| Technical fact | Plain title | Plain detail |
|---|---|---|
| `api/articles.serializer.ts` modified, +12 lines, isApi: true | "Article data sent to apps may include new field" | "A new date field was added to article responses. Third-party apps may need updating." |
| `src/comments/CommentCard.tsx` affected (imports changed formatDate) | "Comment timestamps may display differently" | "Comment dates might change appearance as a side effect of the article date update." |
| `tests/formatDate.spec.ts` rewritten | "Date formatting tests were replaced" | "Old tests removed and new ones added. Needs a check that coverage is equivalent." |

### Bad translations (do not write these)

| Bad | Why |
|---|---|
| "Modified articles.serializer.ts" | Uses file name — not plain language |
| "Minor API change, probably fine" | False reassurance without evidence |
| "relativeTime function updated" | Uses function name |
| "The serializer now adds relativeDate" | Uses code term `relativeDate` |

## Risk language

| Risk level | Suggested phrasing |
|---|---|
| high | "Needs a check before merge." / "Could affect [specific audience]." |
| medium | "Low risk but review recommended." |
| low | "Additive change; existing behaviour unchanged." |
