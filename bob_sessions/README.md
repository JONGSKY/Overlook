# Bob sessions

Team **Time Has Density** built Overlook with IBM Bob 2.0. Each screenshot below is the task session summary from Bob IDE, captured by the team member who ran the task in their own account. Every account used its full 40-Bobcoin budget.

| # | Captured by | Task | Bobcoins |
|---|---|---|---:|
| 00 | JONGSKY | Repository start: spec, request brief, Bob configuration | 7.00 |
| 01 | Asher | Plan, then build the first version in seven subtasks | 39.55 |
| 02 | seokyoung0213 | Fix the review findings | 39.95 |
| 03 | JONGSKY | Review and harden the finished codebase | 32.53 |
| | **Team** | **4 tasks, 3 accounts** | **119.03** |

---

## Task 00 · Repository start

**Captured by JONGSKY** · Sep 26 · 7.00 Bobcoins

![Task 00 session summary](timehasdensity_task00_full_task_session.png)

- **Plan:** wrote the English spec (`SPEC.md`) and the build order the team followed.
- **Documents:** wrote the demo request `brief/GT-142.docx` as a Word document with the `office-insights` skill.
- **Code:** set up the repository and wrote the first Overlook Auditor mode, its rules and three skills.
- **Run:** started a local server so the team could open the first screens.

## Task 01 · Plan and build

**Captured by Asher** · Sep 26 · 39.55 Bobcoins

![Task 01 session summary](timehasdensity_task01_full_task_session.png)

- **Plan:** in Plan mode, read the `.docx` brief and the spec and wrote [`docs/PLAN.md`](../docs/PLAN.md): phases, done checks, acceptance matrix and a Bobcoin budget.
- **Code:** switched to Agent mode and built the first version as seven subtasks, one commit per phase: Bob configuration, the scripted sample repository, the evidence collector, the audit schema and city builder, the receipt and one revert commit per file, and the map UI.
- **Tests:** wrote the `node:test` suite and ran `npm test` after every phase.
- **Run:** served the UI locally for the team to check the map, the replay and the inspector, then fixed what the check found (fix 1).

## Task 02 · Fix the review findings

**Captured by seokyoung0213** · Sep 26 · 39.95 Bobcoins

![Task 02 session summary](timehasdensity_task02_full_task_session.png)

- **Code:** applied the review list: test files collected across the whole repository, bilingual text kept, real line breaks in revert commits, UI fixes.
- **Run:** re-ran the collector on the scripted repository and regenerated the samples.

## Task 03 · Review and harden

**Captured by JONGSKY** · Sep 27 · 32.53 Bobcoins

![Task 03 session summary](timehasdensity_task03_full_task_session.png)

- **Review:** read through the whole codebase and removed dead code; fixed a double file read, an audit link path and a redraw helper; polished the README.
- **Tests:** fixed a temp-folder leak in the tests and added tests for the health check, static files, failing checks and test-diff analysis.
- **Security:** reproduced a way an agent could fake "tests pass" by rewriting the test script, then fixed it: the original test command is now read from the base commit.
- **Run:** ran the full test suite after each change, and ran the collector on a freshly built GT-142 sample repository.


---

## Budgets

Each team member's Bob account page: a 40.00 Bobcoin budget, fully used. Emails are partly hidden.

| Account | Used |
|---|---:|
| JONGSKY | 40.03 |
| Team account (ck…) | 40.02 |
| Team account (sy…) | 40.27 |
| **Total** | **120.32** |

The account pages count every task an account ran, so the total is a little above the sum of the four tasks above.

![JONGSKY account: 40.00 budget, 40.03 used](timehasdensity_jongsky_budget.png)

![Team account: 40.00 budget, 40.02 used](timehasdensity_account_ck_budget.png)

![Team account: 40.00 budget, 40.27 used](timehasdensity_account_sy_budget.png)

---

Task Ids and per-phase usage: [`docs/BOB_SESSIONS.md`](../docs/BOB_SESSIONS.md). Files Bob wrote: [`BOB_CONTRIBUTIONS.md`](../BOB_CONTRIBUTIONS.md).
