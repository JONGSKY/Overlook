# bob_sessions

How Overlook was built with IBM Bob 2.0: every Bob task the team ran, by account, with its session summary.

## Sessions

| Account | Task | When (KST) | What Bob did | Bobcoins | Session summary |
|---|---|---|---|---:|---|
| JONGSKY | 00 · Repository start | Sep 26 | Wrote the spec, the build plan, the request brief `brief/GT-142.docx` (Word, via the `office-insights` skill) and the first Overlook Auditor mode, rules and skills | 7.00 | [task 00](timehasdensity_task00_full_task_session.png) |
| Asher | 01 · Plan and build | Sep 26 | Plan mode wrote `docs/PLAN.md`; then seven subtasks built the prototype: Bob config, sample repo, evidence collector, schema and city builder, receipt and revert, UI | 39.55 | [task 01](timehasdensity_task01_full_task_session.png) |
| seokyoung0213 | 02 · Fix 2 | Sep 26 | Applied the review fixes: repo-wide test collection, bilingual text, revert commit messages, UI fixes, samples regenerated | 39.95 | [task 02](timehasdensity_task02_full_task_session.png) |
| JONGSKY | 03 · Code review | Sep 27 | Reviewed the whole codebase: removed dead code, fixed a double stat and an audit URL path, strengthened the tests (temp-dir cleanup, health, static files, failing checks, test-diff analysis), took the original test command from base so a rewritten test script cannot fake a pass, polished the README | 32.53 | [task 03](timehasdensity_task03_full_task_session.png) |
| **Team** | **4 tasks** | | | **119.03** | |

Every account used its full 40-Bobcoin budget (JONGSKY: tasks 00 and 03).

## Result

- **The prototype** (tasks 00–02): the spec, the Auditor mode and skills, the evidence collector, the city builder, the receipt, one revert commit per file, the first map UI and the GT-142 sample.
- **The current version** grew from it (see [`docs/EVOLUTION.md`](../docs/EVOLUTION.md)); task 03 reviewed and hardened it.
- **In the product,** Bob is the auditor: the Overlook Auditor mode reads the request, runs four subagents (fence, claims, checks, plain language) and writes `audit.json`; git and executed tests decide the verdicts.

## Also here

- `bob-task-d0dc5380514d2815c0d135a5de87f383-2026-09-26.md`: the full transcript of task 01, exported from Bob IDE.
- `timehasdensity_task02_fix2_usage.md`: usage of the fix 2 part of task 02.

Task Ids, per-phase usage and commits: [`docs/BOB_SESSIONS.md`](../docs/BOB_SESSIONS.md).
