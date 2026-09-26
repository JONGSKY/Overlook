---
name: fence-mapper
description: >-
  Maps a coding brief to the smallest set of source paths that covers the requested changes.
  Use when you need to determine the fence (scope boundary) for an audit.
---

# fence-mapper

Given a coding brief, identify exactly which directories or files should be inside the request fence.

## Process

1. **Read the brief carefully.** Quote the exact sentences that describe what should change.
2. **List every requested item** with the verbatim quote from the brief that justifies it.
3. **Find where each item is implemented** by reading entry points (e.g. the router, index files, or named components). Use `read_file` and `grep` — do not guess paths.
4. **Choose the smallest covering set** of directories or files. Prefer a directory if it covers all requested items cleanly. Do not include directories just because they are nearby.
5. **Keep shared code outside the fence** unless the brief explicitly asks for a change to shared behaviour.
6. **Write a one-sentence rationale** that quotes the brief directly and names the chosen paths.

## Output format

```json
{
  "paths": ["src/articles/", "src/feed/"],
  "rationale": "The brief asks to change 'Article list (home feed cards)' and 'Article page', which are implemented in src/articles/ and src/feed/."
}
```

## Example

**Brief excerpt:** "Show when an article was published as relative time. Where: Article list (home feed cards); Article page (header under the title). Out of scope: other screens and the public API."

**Correct output:**
```json
{
  "paths": ["src/articles/"],
  "rationale": "The brief scopes the change to 'Article list' and 'Article page', both in src/articles/; shared utils and the API are explicitly out of scope."
}
```

**Wrong output (too broad):**
```json
{
  "paths": ["src/"],
  "rationale": "The brief mentions articles so all of src/ is relevant."
}
```
