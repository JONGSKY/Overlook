# Metrics: before/after

Fill every value with a measurement. Mark any estimate as "estimated".

| Metric | Method | Before (diff only) | After (Overlook) |
|---|---|---|---|
| Time to find out-of-scope changes | 3–5 people answer the same 5 questions (outside files, affected screens, API change, test change, false claims) on the same task | [measured] min | [measured] min |
| Correct answers | Same 5 questions | [measured] /5 | [measured] /5 |
| Review scope | Changed lines to read vs. decisions to make | [measured] lines | [measured] items |
| False claims caught | Claims in the agent's report that git contradicts | report only: 0 | [measured] /[n] |
| Non-developer decision | A PM approves or reverts each change without reading code | not possible | [measured] |
| Revert round trip | Revert in the map → export → apply → re-audit shows one fewer pending item | — | [measured] |
| Bob usage | Task sessions / Bobcoins | — | [measured] |

Expected values on the scripted GT-142 sample, used as a correctness check and not as an impact metric: 6 changed, 4 outside, 3 affected, claims true / false / false / partial.
