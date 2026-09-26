# Bob task sessions

How this prototype was built with IBM Bob 2.0: every commit mapped to the Bob task that produced it, and every change made outside Bob listed separately.

Task Id, context length and Bobcoins below were read from Bob's local task store (`~/.bob/db/bob.db`) on the machine that ran the task, on 2026-09-27. They are the same values the task session summary shows in Bob IDE (Tasks → open the task → click the task header), so each screenshot in `bob_sessions/` can be checked against this table.

File prefix for screenshots: `timehasdensity_`

## Built in Bob

### Task 00 · Repository start (JONGSKY's account, workspace `Overlook`)

| # | Task / phase | Mode | Task Id | Context | Bobcoins | Commits |
|---|---|---|---|---|---|---|
| 00 | Spec, build plan, request brief (`brief/GT-142.docx`, written with the `office-insights` skill), AGENTS.md, first Bob configuration, sample audit | Agent | `02aff0e33b024a8d247ee10ffdd5302e` | 100.9k / 270k | **6.995** | `c79cf8d` |
| 00 · Flowreel | A first direction (runtime trace diff), scaffolded and pushed; dropped later | Agent | (same task) | | (included) | `f4d630f` |

### Task 01 · Plan and build (Asher's account, workspace `Overlook`)

One task that planned in Plan mode, then switched to Agent mode and ran each phase as a subtask. The parent task's Bobcoins include its subtasks.

| # | Task / phase | Mode | Task Id | Context | Bobcoins | Commits |
|---|---|---|---|---|---|---|
| 01 | Plan + build (parent) | Plan → Agent | `d0dc5380514d2815c0d135a5de87f383` | 167.6k / 270k | **39.545** (total) | see below |
| 01 · plan | Read `brief/GT-142.docx`, wrote `docs/PLAN.md` and this log | Plan | (parent) | | 1.41 | in `a4470d9` |
| 01.P1 | Bob config: mode, rules, 3 skills, AGENTS.md, package.json | Agent · subtask | `adc30bb6d54d4bdb47ad303e3da6c116` | 34.3k | 0.822 | `a4470d9` |
| 01.P2 | Sample repo script and sample audit | Agent · subtask | `9984766621f995e1756dd6c342e0ab5f` | 34.2k | 0.850 | `62806d2`, `c094606` |
| 01.P3 | `engine/collect.mjs` | Agent · subtask | `c4c9acb4256a5f38a540a70e3a4e3873` | 43.5k | 1.554 | `481e15a`, `76b3f40` |
| 01.P4 | `schema/audit.schema.json`, `engine/build-city.mjs` | Agent · subtask | `96674984d03a88fc10f910add1a76e82` | 56.6k | 2.705 | `f5d3ef6`, `39cd4d7` |
| 01.P5 | `engine/pr-comment.mjs`, `engine/apply-decisions.mjs`, tests | Agent · subtask | `ec6dc0fb48c0d93ac521c4fa0050c4a4` | 56.2k | 2.382 | `bdd4286` |
| 01.P6 | `ui/index.html`: verdict bar, receipt, EN/KO, themes | Agent · subtask | `a7c6a5419c6d47241d1104c0a6c4df92` | 56.6k | 1.440 | `18ba8d5`, `ff0a65a` |
| 01.P7 | `ui/index.html`: isometric city, replay, inspector | Agent · subtask | `91234891ab16e9542440850e3ebd7e65` | 101.2k | 4.213 | `4f5af20`, `104f842` |
| 01 · fix 1 | Unchanged files collected, evidence tags as arrays, placeholders removed | Agent (in the parent, not a subtask) | (parent) | | ≈ 22.9 with fix 2 below | `aa73c9a` |
| 01 · fix 2 (stopped) | Started fix 2 in the parent; stopped by `BudgetExceededError` (40 Bobcoin limit). Not committed. | Agent | (parent) | | (included above) | – |

Subtasks total 13.97 Bobcoins; the parent itself used 25.58, of which about 22.9 went to fix 1 and the stopped fix 2 at a 160k+ token context. Lesson recorded for the team: start fixes as new tasks.

### Task 02 · Fix 2 (seokyoung0213's account)

| # | Task | Mode | Task Id | Bobcoins | Commits |
|---|---|---|---|---|---|
| 02 | Test files collected repo-wide, `{en,ko}` kept, real newline in revert commits, sample hints removed, UI fixes (SPEC 6.2–6.4, 6.8), samples regenerated | Agent | `fee241e48621efb456883040a4573662` (workspace `05_IBM_Bob_2.0`) | 22.353 for fix 2 (task total 39.95) | Bob's `69425be` published as `a8327ba`, `c5719cc`, `732ddab`, `c12a61d`, `21bfba4`, `419e20d` |

Task 02 also ended at the 40-Bobcoin limit. Session summary: `bob_sessions/timehasdensity_task02_full_task_session.png`.

### Task 03 · Code review (JONGSKY's account, workspace `Overlook`)

| # | Task | Mode | Task Id | Context | Bobcoins | Commits |
|---|---|---|---|---|---|---|
| 03 | Whole-codebase review: dead code removed, a double stat and an audit URL path fixed, tests strengthened (temp-dir cleanup, health, static files, failing checks, test-diff analysis), the original test command taken from base, README polished | Agent | `2a3f849272487143b4f35663fa8b3e7d` | 223.1k / 270k | **32.53** | `92996ad`, `5083312`, `4f6b39f` |

### Task 04 · Prove Bob runs inside Overlook (tour_captain, workspace `Overlook`)

| # | Task | Mode | Task Id | Context | Bobcoins | Commits |
|---|---|---|---|---|---|---|
| 04 | Committed 4 untracked skills; ran Overlook Auditor mode on 3 real agent PRs (atlas, github-mcp-server, playwright-mcp); filled metrics.md; resolved merge conflict and pushed | Agent (Overlook Auditor mode) | `42b63285d0a90a340949f70e491fd152` | 128.7k / 270k | **17.12** | `93f5697`, `80c6027`, `1409a2b`, `583f20f` |

### Task 05 · Vercel deployment + /verify on real example (JONGSKY's account, workspace `Overlook`)

| # | Task | Mode | Task Id | Commits |
|---|---|---|---|---|
| 05 | Added `api/` Serverless Functions; adapted `out/` storage to `/tmp` on Vercel; fixed bare-binary test command detection and `npm ci` fallback; ran `crossTests` on atlas (78 tests pass); updated city.json with `runs.cross`; recorded session | Agent | _(this conversation)_ | `cb114b3`, `91c26a2`, _(this commit)_ |

Full write-up: [`bob_sessions/timehasdensity_task05_vercel_and_verify.md`](../bob_sessions/timehasdensity_task05_vercel_and_verify.md)

Key findings from this task's audits:

| Audit | Outside | False claims (Bob) | False claims (team-written) |
|---|---|---|---|
| atlas-production-fixes | 0 / 8 | 0 | 0 |
| github-mcp-server #1645 | 5 / 7 | **1** | 0 |
| playwright-mcp #725 | 0 / 2 | **1** | 0 |

Bob found a false claim in both Copilot PRs, which the previous team-written audits missed. Both rest on evidence in git (a snapshot diff, the agent's own revert commit) and are recorded as Bob's judgement with its reasoning.

## Made outside Bob

Two small commits were made by hand and are marked `[manual]` in their commit message.

| Change | Commit | Note |
|---|---|---|
| `NEXT.md` handoff document | `9f46d15` | documentation |
| UI export keyed by file path; engine rejects other shapes; `engine/test/export.test.mjs`; README rewrite | `326b571` | bug fix to Bob's code |

## Screenshots

| File | Kind | Status |
|---|---|---|
| `timehasdensity_task00_full_task_session.png` | session summary of task 00 (7.00 Bobcoins, Task Id `02aff0e3…`) | saved |
| `timehasdensity_task01_full_task_session.png` | session summary of task 01, all subtasks included (39.55 Bobcoins, Task Id `d0dc5380…`) | saved |
| `timehasdensity_task02_full_task_session.png` | session summary of task 02 (39.95 Bobcoins, Task Id `fee241e4…`) | saved |
| `timehasdensity_task03_full_task_session.png` | session summary of task 03 (32.53 Bobcoins, Task Id `2a3f8492…`) | saved |
| `timehasdensity_task04_session_header.png` | session summary of task 04 (17.12 Bobcoins, Task Id `42b63285…`, context 128.7k / 270k) | saved |

Subtask usage is recorded as numbers in `bob_sessions/README.md` instead of separate screenshots.

## Not done in this prototype

Planned in `docs/PLAN.md` and `docs/prototype/NEXT.md`, not run in the prototype: P8 final checks (MIT LICENSE, SPEC §8), Auditor mode on the sample, the real demo task in `../realworld`, the real audit, Bob Review, submission PR.

**Done in task 04 (post-prototype):** committed untracked skills, ran Overlook Auditor mode on 3 public real-world agent PRs, filled metrics, corrected measurements analysis.
