# bob_sessions

Evidence that this project was built with IBM Bob 2.0: three Bob tasks in three team accounts.

## Overview

| Task | Account | Task Id | Workspace | What it did | Bobcoins |
|---|---|---|---|---|---|
| 00 · Repository start | JONGSKY | `02aff0e33b024a8d247ee10ffdd5302e` | `Overlook` | Spec, build plan, request brief (`.docx`), first Bob configuration; then a first Flowreel scaffold | **7.00** |
| 01 · Plan and build | Asher | `d0dc5380514d2815c0d135a5de87f383` | `Overlook` | Plan, P1–P7 as subtasks, fix 1 | **39.55** |
| 02 · Fix 2 (and other work) | seokyoung0213 | `fee241e48621efb456883040a4573662` | `05_IBM_Bob_2.0` | Fix 2, published as 6 commits in this repo | **39.95** |
| **Team total** | 3 accounts | | | | **86.50** |

Tasks 01 and 02 ended at the 40-Bobcoin budget per account (`BudgetExceededError`).

## Files

| File | What it is |
|---|---|
| `timehasdensity_task00_full_task_session.png` | Task session summary of task 00: context 100.9k / 270.0k (37%), **7.00 Bobcoins** |
| `timehasdensity_task01_full_task_session.png` | Task session summary of task 01, subtasks included: context 167.6k / 270.0k (62%), **39.55 Bobcoins** |
| `timehasdensity_task02_full_task_session.png` | Task session summary of task 02: context 166.5k / 270.0k (62%), **39.95 Bobcoins** |
| `bob-task-d0dc5380514d2815c0d135a5de87f383-2026-09-26.md` | Full transcript of task 01, exported from Bob IDE (Korean lines translated to English) |
| `timehasdensity_task02_fix2_usage.md` | Usage summary of the fix 2 segment of task 02, extracted from the local Bob DB |

Each task has one session-summary screenshot. Sessions inside a task are listed below with their usage instead of separate screenshots.

## Task 00 · Repository start (JONGSKY's account)

| Session | Mode | Task Id | Time (KST, Sep 26) | Model calls | Tool calls | Peak context | Bobcoins | Commits |
|---|---|---|---|---|---|---|---|---|
| Repository start | Agent | `02aff0e33b024a8d247ee10ffdd5302e` | 17:31–18:40 | 49 | 68 | 100.9k | **6.995** | `c79cf8d`, `f4d630f` |

- Bob wrote `SPEC.md`, `BOB_BUILD_PLAN.md`, `AGENTS.md`, the first `overlook-auditor` mode, its rules and three skills, and `samples/audit.sample.json`, and wrote the request brief `brief/GT-142.docx` with the `office-insights` skill (`office_edit`). Committed as `c79cf8d` (16 files, +1088).
- In the same task it then scaffolded a first direction, **Flowreel** (`f4d630f`, 27 files), and pushed it. That direction was dropped later (see [`docs/EVOLUTION.md`](../docs/EVOLUTION.md)); the spec, brief and Bob configuration carried on into task 01.
- Tool calls: `write_file` 39, `execute_command` 18, `update_todo_list` 6, `read_file` 2, `list_files` 1, `use_skill` 1, `office_edit` 1.

## Task 01 · Plan and build (Asher's account)

| Session | Mode | Task Id | Time (KST, Sep 26) | Model calls | Peak context | Context tokens, cumulative | Bobcoins | Commits |
|---|---|---|---|---|---|---|---|---|
| Plan + coordination | Plan → Agent | `d0dc5380…` (parent) | 19:43–20:43 | 30 | 67.1k | 1.36M | 2.720 | plan in `a4470d9` |
| P1 · Bob config | Agent · subtask | `adc30bb6d54d4bdb47ad303e3da6c116` | 19:48–19:51 | 14 | 34.3k | 0.41M | 0.822 | `a4470d9` |
| P2 · Sample repo | Agent · subtask | `9984766621f995e1756dd6c342e0ab5f` | 19:51–20:02 | 14 | 34.2k | 0.43M | 0.850 | `62806d2`, `c094606` |
| P3 · Evidence collector | Agent · subtask | `c4c9acb4256a5f38a540a70e3a4e3873` | 20:03–20:06 | 21 | 43.5k | 0.78M | 1.554 | `481e15a`, `76b3f40` |
| P4 · Schema + city | Agent · subtask | `96674984d03a88fc10f910add1a76e82` | 20:07–20:13 | 29 | 56.6k | 1.35M | 2.705 | `f5d3ef6`, `39cd4d7` |
| P5 · Receipt, revert, tests | Agent · subtask | `ec6dc0fb48c0d93ac521c4fa0050c4a4` | 20:21–20:26 | 26 | 56.2k | 1.19M | 2.382 | `bdd4286` |
| P6 · UI shell + receipt | Agent · subtask | `a7c6a5419c6d47241d1104c0a6c4df92` | 20:27–20:33 | 16 | 56.6k | 0.72M | 1.440 | `18ba8d5`, `ff0a65a` |
| P7 · City, inspector | Agent · subtask | `91234891ab16e9542440850e3ebd7e65` | 20:34–20:42 | 31 | 101.2k | 2.11M | 4.213 | `4f5af20`, `104f842` |
| Fixes (fix 1, then fix 2 attempt) | Agent | `d0dc5380…` (parent) | 20:46–21:01 | 91 | 167.6k | 11.43M | 22.858 | `aa73c9a` (fix 1) |
| **Task 01 total** | | `d0dc5380514d2815c0d135a5de87f383` | 19:43–21:01 | **272** | **167.6k** | **19.77M** | **39.55** | 13 commits, `a4470d9` … `aa73c9a` |

- The total is the value in `timehasdensity_task01_full_task_session.png`: subtasks 13.966 + parent 25.578 = 39.544 Bobcoins.
- A first attempt at fix 2 started here and was stopped by the budget limit before anything was committed. Fix 2 was then done in task 02.
- Fix 1 and the fix 2 attempt ran in the parent, whose context was already over 160k tokens, so each call cost about 0.33 Bobcoins: 58% of the task. Each subtask started with a fresh context.

## Task 02 · Fix 2 (seokyoung0213's account)

Fix 2 applied the 12 items of `NEXT.md` appendix A: test files collected repo-wide, `{en, ko}` text kept, a real line break in revert commits, scope hints removed from the sample, plain text rewritten, UI fixes for SPEC 6.2–6.4 and 6.8, and the sample regenerated.

| Session | Mode | Task Id | Time (KST, Sep 26) | Model calls | Tool calls | Peak context | Context tokens, cumulative | Bobcoins | Commits |
|---|---|---|---|---|---|---|---|---|---|
| Fix 2 | Agent | `fee241e4…` | 21:16–21:29 | 106 | 117 | 150.1k | 11.18M | 22.353 | `69425be` in the Bob workspace → `a8327ba`, `c5719cc`, `732ddab`, `c12a61d`, `21bfba4`, `419e20d` here |
| Other work in the same task | Agent | `fee241e4…` | outside 21:16–21:29 | | | | | 17.594 | not in this repo |
| **Task 02 total** | | `fee241e48621efb456883040a4573662` | | | | **166.5k** | | **39.95** | |

- The total is the value in `timehasdensity_task02_full_task_session.png` (39.946908 in the DB). The fix 2 segment is 56% of it.
- Bob committed fix 2 as `69425be` in the teammate's workspace (`05_IBM_Bob_2.0`): 9 files, +477 −165. The same change was published in this repository as the six commits above (21:45–21:46); together they also change exactly 9 files, +477 −165.
- Tool calls in the fix 2 segment: `read_file` 51, `apply_diff` 26, `execute_command` 23, `grep` 8, `update_todo_list` 5, `list_files` 4.
- The rest of task 02 was not itemised in the export and produced no commits in this repository.

## Reading the columns

- **Model calls** counts Bob's model responses. **Tool calls** counts the tools those responses used.
- **Context tokens, cumulative** adds up the context length of every call. Bob records context length and cost per call, not separate input and output counts.

## Where the numbers come from

Bob keeps every task in a local SQLite store, `~/.bob/db/bob.db`, on the machine that ran it: table `tasks` (`id`, `title`, `task_type`, `costs`), and table `messages` with `_meta.spend.cost` and `_meta.spend.contextTokens` for each model call. Each account's numbers were read from its own machine. To reproduce them, run this on a copy of the database:

```bash
sqlite3 -readonly bob.db "select id, task_type, title, json_extract(costs,'$.cost'), json_extract(costs,'$.contextTokens') from tasks where json_extract(costs,'$.cost') > 0 order by created_at;"
```

Changes made outside Bob are listed in [`docs/BOB_SESSIONS.md`](../docs/BOB_SESSIONS.md) and marked `[manual]` in their commit messages.
