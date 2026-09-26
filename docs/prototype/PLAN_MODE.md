# Overlook: plan and build in one Bob session

This file drives **one Bob session** that first plans the whole build in **Plan mode**, then implements every feature from that plan in **Agent mode**. Paste the prompt in section 3 into a new task and follow along.

The only submission evidence this file tracks is the **IBM Bob task session summary screenshots** in `bob_sessions/`.

Deadline: **Mon Sep 28, 00:00 KST**. Target: build finished by **Sun Sep 27, 18:00 KST**.

---

## 1. How the session is structured

```
Task 01 (parent, Plan mode)
 ├─ writes docs/PLAN.md and docs/BOB_SESSIONS.md
 ├─ human approves the plan
 └─ switches to Agent mode and runs one subtask per phase:
      P1 Bob config        P2 Sample repo       P3 Evidence collector
      P4 Schema + city     P5 Receipt, revert, tests
      P6 UI shell + receipt   P7 City, inspector, interactions   P8 Final checks
```

Why subtasks and not one long chat:
- Each subtask gets a fresh context. The context window is about 270k tokens, and a single long chat would fill it by P6 and drive up Bobcoin use.
- Each phase leaves its own trace in the task list, which means more session summaries to screenshot.
- If a phase fails, you rerun that phase and not the whole build.

**Not in this session.** These are separate tasks you run after the build (section 6):
- Checking the Overlook Auditor mode. The IDE must reload `.bob/custom_modes.yaml` first.
- The real demo task in `../realworld`. Bob must not know about Overlook there.
- The real audit.

## 2. Before you start (no Bobcoins)

- [ ] Bob IDE **2.0.2 or later**. Settings → General shows the hackathon team `ibm-coding-challenge-…` (us-east) selected. Note the Bobcoin balance (40 per person).
- [ ] Node.js 22+, git, Python 3 installed.
- [ ] Move `GT-142.docx` to `brief/GT-142.docx`, create an empty `bob_sessions/.gitkeep`, and add a `.gitignore` containing `node_modules/`, `.env`, `out/`.
- [ ] (Optional) Put 3–4 design reference PNGs in `docs/design-ref/`. If there are none, Bob follows SPEC section 6 only.
- [ ] Commit by hand: `chore: add spec, brief and plan inputs`.
- [ ] Auto-approve (Settings): allow **read**, **write inside the workspace**, and **execute** for `node`, `npm`, `git`, `bash`, `python3`. Keep subagent and mode-switch approvals manual so you can see each phase start.
- [ ] Open the workspace at the repo root (`Overlook/`).

## 3. Prompt: paste into a new task in Plan mode

```
We are building Overlook for the IBM Bob 2.0 hackathon. This one task plans the whole build and then implements it.

PART A: PLAN (Plan mode)
Read @SPEC.md sections 1, 2, 7 and 8, @PLAN_MODE.md sections 4 and 5, and @brief/GT-142.docx (confirm you understood the request document). Look at @docs/design-ref/ if it exists.
Write two files:
1. docs/PLAN.md with the structure in PLAN_MODE.md section 4.
2. docs/BOB_SESSIONS.md from the template in PLAN_MODE.md section 5.
Then stop and wait for my approval. Do not write code before I approve.

PART B: BUILD (after I approve)
Switch to Agent mode. Run the phases P1 to P8 from docs/PLAN.md in order, each as its own subtask. For each subtask:
- Give it only the SPEC.md sections listed for that phase (never the whole file) plus docs/PLAN.md.
- It implements the phase, runs the phase's done check, fixes failures (at most 3 attempts), commits with a short imperative message, and appends its row to docs/BOB_SESSIONS.md.
- It returns a summary: files created, done-check output, commit sha.
After each subtask, show me the summary. If a done check still fails after 3 attempts, stop and ask me instead of continuing.
Rules: engine has no npm dependencies; the UI is one static file; never commit secrets; the GT-142 sample commits are scripted and must say so.
```

After Part A, review `docs/PLAN.md` using the checklist in section 7. When it looks right, reply: `Approved. Start Part B.`

## 4. Required structure of docs/PLAN.md

```markdown
# Overlook implementation plan

## 0. Summary
Problem (2 sentences), solution (2 sentences), demo scenario GT-142.

## 1. Phases
For each of P1–P8:
### PN · <name>
- Mode: Agent (subtask)
- SPEC sections to attach
- Files created / changed
- Done check: exact command(s) and expected output
- Bobcoin estimate
- Session screenshot file name (see PLAN_MODE.md section 5)

## 2. Acceptance matrix
Each item of SPEC.md section 8 → phase or later task → command that proves it.

## 3. Bob feature coverage
| Bob feature | Where it is used | Proof (screenshot or file) |
Plan mode, Agent mode, subtasks, custom mode with fileRegex write restriction, project rules,
mode-specific rules, AGENTS.md, skills, parallel subagents, document understanding (.docx),
todo list, commit message generation, Review, PR generation, Bob Shell (optional).

## 4. Bobcoin budget and cut lines
## 5. Risks
## 6. Open questions
```

The phases and their content, using the SPEC sections:

| Phase | Builds | SPEC | Done check |
|---|---|---|---|
| P1 | `.bob/custom_modes.yaml`, `.bob/rules/01-project.md`, `.bob/rules/02-session-log.md` (text below), `.bob/rules-overlook-auditor/01-evidence-first.md`, 3 skills, `AGENTS.md`, `package.json`, README stub | 7 | files exist; YAML parses (`python3 -c "import yaml…"` or a node check) |
| P2 | `samples/make-sample-repo.sh`, `samples/audit.sample.json` | 5, 3.2 | `bash samples/make-sample-repo.sh /tmp/overlook-sample` prints BASE= and HEAD= |
| P3 | `engine/collect.mjs` | 3.1, 4.1 | summary `6 changed, 6 steps`; `formatDate.ts` importedBy has CommentCard and ProfileArticles; spec file rewritten=true |
| P4 | `schema/audit.schema.json`, `engine/build-city.mjs`, `samples/city.sample.json/.js` | 3.2, 3.3, 4.2 | outside 4, affected 3, claims true/false/false/partial |
| P5 | `engine/pr-comment.mjs`, `engine/apply-decisions.mjs`, `engine/test/*.test.mjs` | 4.3, 4.4, 4.5 | `npm test` passes |
| P6 | `ui/index.html`: loading, header, verdict bar, layout, receipt, EN/KO, themes | 6.1, 6.2, 6.5, 6.7, 6.8 | served by `python3 -m http.server`; `?data=../samples/city.sample` renders, no console errors |
| P7 | `ui/index.html`: isometric city, replay, inspector, interactions | 6.3, 6.4, 6.6 | replay works; clicking the red building shows the diff; revert lowers it |
| P8 | Final pass: SPEC section 8 checks that do not need the Auditor mode, README, MIT LICENSE | 1, 8 | checklist output in the subtask summary |

Text for `.bob/rules/02-session-log.md` (P1 creates it):

```markdown
# Session log
At the end of every task or subtask, append a row to docs/BOB_SESSIONS.md with: task or
phase id, mode, what was done (one line), commit sha, and the screenshot file name the human
must save. Then tell the human: "Save the session summary as bob_sessions/<file name>".
```

## 5. Task session summary screenshots (hackathon requirement)

**How to take one**
1. In the Bob chat panel, click **Tasks** to open the task list. If the task ran in another workspace, choose **All**.
2. Open the task. Check that you are in the right workspace.
3. Click the **task header**. The task session consumption summary appears.
4. Take a PNG screenshot of the summary and save it in `bob_sessions/`.

**File names:** `<team>_taskNN_<short_desc>_summary.png`. The `<team>` placeholder is your team name. Every team member needs at least one.

**When to take them:** at the end of the session, and again for each later task. If subtasks show up as separate entries in the task list, screenshot each one. If they appear only inside the parent task, screenshot the parent. (The docs do not say which happens. Check the task list after P1.)

**Template for docs/BOB_SESSIONS.md** (Plan mode creates it, and each task appends to it):

```markdown
# Bob task sessions

| # | Task / phase | Mode | What was done | Commit | Screenshot file | Saved |
|---|---|---|---|---|---|---|
| 01 | Plan + build (parent) | Plan → Agent | plan approved, P1–P8 run | – | <team>_task01_plan_and_build_summary.png | ☐ |
| 01.P1 | Bob config | Agent | | | <team>_task01_p1_bob_config_summary.png | ☐ |
| … | | | | | | |
| 02 | Auditor mode check (sample) | Overlook Auditor | | | <team>_task02_auditor_sample_summary.png | ☐ |
| 03 | Demo task in ../realworld | Agent | | | <team>_task03_realworld_demo_summary.png | ☐ |
| 04 | Real audit | Overlook Auditor | | | <team>_task04_real_audit_summary.png | ☐ |
| 05 | Review (optional) | Review | | | <team>_task05_review_summary.png | ☐ |
| 06 | Commit, PR, README | Agent | | | <team>_task06_pr_summary.png | ☐ |
```

## 6. Tasks after the build (each one is a new task)

| # | Mode | What | Prompt source |
|---|---|---|---|
| 02 | Overlook Auditor | Restart the IDE so the mode loads. Try to write to `src/` (must be refused), then audit the sample with **parallel subagents** and the .docx brief. | BOB_BUILD_PLAN.md step 10 |
| 03 | Agent, workspace `../realworld` | Note `git rev-parse HEAD` as BASE. Implement GT-142 normally without mentioning Overlook. Save Bob's final report verbatim to `out/bob-report.txt`. | step 11 |
| 04 | Overlook Auditor | Audit the real task, decide in the UI, run apply-decisions, re-audit until the stamp reads READY TO MERGE. | step 12 |
| 05 | Review (optional) | Review `engine/` and `ui/`. | step 9 |
| 06 | Agent | Build the real `ui/city.json`, write the README, open a PR with a generated description, turn on GitHub Pages. | step 13 |

## 7. Plan review checklist (before you type "Approved")

- [ ] P1–P8 each have a done-check command with an expected result.
- [ ] Each phase attaches SPEC sections, not the whole file.
- [ ] P1 creates `.bob/rules/02-session-log.md`.
- [ ] The acceptance matrix covers every item of SPEC section 8. Auditor-mode items point to task 02.
- [ ] The Bobcoin total fits the budget, and cut lines are defined. Never cut P3, P4, P6 or P7.
- [ ] The open questions are answered, or there are none.
