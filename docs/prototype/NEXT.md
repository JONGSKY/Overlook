# NEXT: handoff for continuing the build with Bob

This document is a **handoff for the next person, who continues the work with their own Bob account (Bobcoins)**.
Prompts for Bob and the explanations are in English.

- Deadline: **Mon Sep 28, 00:00 KST** · target submission: Sunday 22:00
- As of: 2026-09-26 21:05 KST, `main` @ `01397cf`
- Read together with: `SPEC.md` (specification, takes priority), `docs/PLAN.md` (phase plan), `docs/BOB_SESSIONS.md` (task and screenshot log), `BOB_BUILD_PLAN.md` (original build order)

---

## 1. Done so far

| Phase | What | Commit | Status |
|---|---|---|---|
| P1 | Bob config: `.bob/custom_modes.yaml` (Overlook Auditor, writes to `out/` only), rules, 3 skills, AGENTS.md | `a4470d9` | Done |
| P2 | GT-142 sample repo script, `audit.sample.json` | `62806d2` | Done |
| P3 | `engine/collect.mjs` | `481e15a` | Done |
| P4 | `schema/audit.schema.json`, `engine/build-city.mjs` | `f5d3ef6` | Done |
| P5 | `pr-comment.mjs`, `apply-decisions.mjs`, tests | `bdd4286` | Done |
| P6–P7 | `ui/index.html`: verdict bar, receipt, city, inspector | `18ba8d5`, `4f5af20` | Done |
| fix 1 | Unchanged files included, evidence tags, P7 placeholder text removed (tests 8/8) | `aa73c9a` | Done |
| **fix 2** | The 12 items in appendix A | none | **In progress (not committed)** |
| P8 | Finish README, LICENSE, SPEC §8 checks | none | Remaining |
| Tasks 02–06 | Auditor check, real demo, real audit, Review, PR | none | Remaining |

> At handoff, fix 2 was running in Asher's Bob session. The code changes **may not have been committed or pushed.** Check step 3 of section 2 before starting.

## 2. Before starting (no Bobcoins used)

1. **Bob IDE**: 2.0.2 or later. In Settings → General, select the hackathon team `ibm-coding-challenge-…` (us-east) and note your Bobcoin balance (40 per person).
2. **Environment**: Node.js 22 or later, git, Python 3
3. **Get the code**
   ```bash
   git clone https://github.com/asher-han/Overlook.git && cd Overlook
   git log --oneline -3
   ```
   - If the latest commit messages are `fix: …` commits about the 12 items, fix 2 is in.
   - Otherwise start from step 0.
4. **Check that it works**
   ```bash
   npm test
   python3 -m http.server 8080
   ```
   - Open `http://localhost:8080/ui/index.html?data=../samples/city.sample` in a browser.
   - It works if the `SAMPLE DATA` tag shows and **Replay Bob's task** runs.
5. **Bob workspace**: open the `Overlook/` folder as the root. **Overlook Auditor** must appear in the mode list; if not, restart the IDE.
6. **Auto-approve**: turn on only reading, writing inside the workspace, and running `node`/`npm`/`git`/`bash`/`python3`. Leave subagent creation on manual approval, because you need to see them start in parallel.

**Saving Bobcoins**
- Open **a new task per step**. Screenshots are also kept per task.
- Do not attach all of `@SPEC.md`; name sections, like `sections 4.1 only`.
- Paste only the error lines, not the whole log.
- If Bobcoins run short, a person does **task 05 (Review) and the README for P8**.

## 3. To do (in order, a new task per step)

Finish every task the same way:
1. Check the done criteria yourself.
2. Bob commits. If it did not, commit with Bob's commit message generation.
3. Take the **session summary screenshot** (section 4).
4. `git push`

### Step 0. Finish fix 2 (only if not committed) · Agent mode
```
Read @NEXT.md appendix A. Some of these fixes may already be applied (check git diff and the current code). Finish every item that is not done, following SPEC.md sections 3, 4.1, 4.2 and 6.2–6.6 and 6.8 only. Do not change the expected values in the tests (6 changed, 4 outside, 3 affected, claims true/false/false/partial).
Regenerate samples/city.sample.json and .js using --src src, run npm test, and commit.
```
Done when:
- `npm test` passes.
- Grey buildings show in the UI, and the receipt in the Business view is in plain language.
- Reverting lowers the totals, and Korean mode shows Korean text.

### Step 1. P8 final checks · Agent mode
```
Read @SPEC.md sections 1 and 8 and @docs/PLAN.md phase P8.
Complete README.md (what Overlook is, the principle "evidence decides, Bob explains", how to run the sample flow end to end, how to open the UI, repository layout, how Bob is used: Overlook Auditor mode, rules, three skills, parallel subagents). Add an MIT LICENSE. Run every SPEC section 8 check that does not need the Overlook Auditor mode and report pass/fail with the command output. Update docs/BOB_SESSIONS.md. Commit.
```

### Step 2. Auditor mode check (sample) · **Overlook Auditor mode**
Restart the IDE first, build the sample repository and note BASE.
```bash
bash samples/make-sample-repo.sh /tmp/overlook-sample
```

Check 1: write restriction
```
List the tool groups you have in this mode. Then try to create src/should-not-exist.txt containing "test". Report exactly what happened. Do not work around a refusal.
```
Check 2: guarded sample audit (**parallel subagents, .docx document understanding**)
1. Prepare in the terminal: collect the facts, write the packet for Bob, record the repository state.
   ```bash
   printf 'Done. Article dates now show relative time. I only changed the article views. No API changes. All tests pass.\n' > out/bob-report.txt
   ```
   ```bash
   node engine/audit.mjs prepare --repo /tmp/overlook-sample --base <BASE> --brief brief/GT-142.docx --report out/bob-report.txt --sample
   ```
2. Send the prompt printed by `prepare` (`out/bob-prompt.md`) to Bob (Overlook Auditor mode) as it is.
3. When Bob stops, finish in the terminal.
   ```bash
   node engine/audit.mjs finish
   ```
Done when:
- Writing to `src/` is refused. If it is not, note the result and report it.
- Several subagents show in the subagent panel at the same time, and Bob runs `validate-audit.mjs`.
- `finish` ends with `✔`, and the receipt (`out/receipt.md`) shows 4 outside the request and claims `true, false, false, partial`. If it shows `✖`, give `out/audit-report.md` to Bob and have it fix the audit.

### Step 3. Real demo task · Agent mode · **workspace `../realworld`**
1. Clone one RealWorld (Conduit) React implementation into a **folder next to** `Overlook`.
   - Prefer one where articles, comments and profiles share a date-format function.
   - Check the licence (MIT or similar).
2. Copy `Overlook/.bob/rules/01-project.md` into `../realworld/.bob/rules/`.
3. Record **BASE** with `git rev-parse HEAD`.
4. Point the prompt at the path of `brief/GT-142.docx`.
5. **Do not mention Overlook**; let Bob work as usual.
```
Read @<path-to>/Overlook/brief/GT-142.docx and implement it. Commit after each sub-task with a short message. When you are done, give me a short final report of what you changed and whether tests pass.
```
6. Save Bob's final report **verbatim** as `Overlook/out/bob-report.txt`. `out/` is gitignored, so keep a separate copy.
7. Do not manipulate the result. If nothing changed outside the request, run one or two other requests (for example, showing a comment count) and pick the most telling result.

> If the app uses path aliases like `@/…`, files affected only through an import may be missed. Then ask in Agent mode: "Add tsconfig/jsconfig path alias resolution to the import resolver in engine/collect.mjs, with a test."

### Step 4. Real audit · **Overlook Auditor mode** (Overlook workspace)
```bash
node engine/audit.mjs prepare --repo ../realworld --base <BASE> --brief brief/GT-142.docx --report out/bob-report.txt
```
Send the prompt printed by `prepare` to Bob (Overlook Auditor mode); when Bob stops, finish.
```bash
node engine/audit.mjs finish
```
Then, by a person:
1. Start the server.
   ```bash
   python3 -m http.server 8080
   ```
2. Open `http://localhost:8080/ui/index.html`. There must be **no** `SAMPLE DATA` tag.
3. Make the decisions, click **Export decisions** and save the result as `out/decisions.json`.
4. Apply the decisions.
   ```bash
   node engine/apply-decisions.mjs --repo ../realworld --decisions out/decisions.json
   ```
5. Run the audit again with `prepare` → Bob → `finish`. Check that the stamp changes to **READY TO MERGE**.

> If the request fence is wrong, do not rerun Bob: change it with **Edit fence** in the UI or fix `fence.paths` in `out/audit.json`, then run only `finish` again.
> With Bob Shell, `node engine/audit.mjs run … --max-cost 3` runs `prepare`, Bob and `finish` in one go.

### Step 5. (Optional) Review · Bob's Review feature
- Have Bob review `engine/` and `ui/`, then fix the findings in Agent mode.

### Step 6. Submission prep · Agent mode
```
Prepare the repo for submission: force-add ui/city.json and ui/city.js from the real audit, update README.md with the real results from ui/city.json (only numbers that are in the file), and add a GitHub Pages note. Then create a branch, commit, and open a pull request with a generated description.
```
- This step uses Bob's **commit message and PR generation**.
- In GitHub → Settings → Pages, turn on the root of the main branch to get the app URL.

## 4. Bob session summary screenshots (required submission)

1. Click **Tasks** in the Bob chat. For tasks in other workspaces, choose **All**.
2. Open the task and click the **task header (title line)** to show the usage summary.
3. Capture the summary as a PNG: `Cmd+Shift+4` → `Space` → click the Bob window
4. Save it as `bob_sessions/<team>_taskNN_<short-description>_summary.png`. No spaces in file names.
5. Set the Saved cell of that row in `docs/BOB_SESSIONS.md` to ☑.

Notes:
- **It is fine if only the task total shows, without subtasks.** That screen is the task summary.
- **Every team member needs at least one.** Whoever continues must keep the summary of the task in their own account.
- Asher has to capture the final usage summary of task 01 (Asher, plan + P1–P7) separately. The PNG currently in `bob_sessions/` is a chat screenshot, supporting evidence for document understanding.

## 5. Checks before submission

- [ ] `npm test` passes; sample flow gives 6 / 4 / 3, claims `true, false, false, partial`
- [ ] The city built from real data shows no `SAMPLE DATA` tag
- [ ] Auditor mode cannot write outside `out/` (result of step 2)
- [ ] A summary PNG per task in `bob_sessions/`, at least one from every team member
- [ ] Public repository, MIT LICENSE, no secrets, emails or tokens
- [ ] No unmeasured numbers in the README

---

## Appendix A. fix 2 items (used in step 0)

Engine
1. `engine/collect.mjs`: test files outside `--src` are missed (with the default `--src src`, `tests/formatDate.spec.ts` is not collected and "All tests pass" becomes true). Always also collect files matching the test-file pattern anywhere in the repo. Add a test that runs collect with `--src src` and still gets `rewritten` and claims true/false/false/partial.
2. `engine/build-city.mjs`: keep `{ "en", "ko" }` text fields as-is (fence.rationale, plain.title/detail, request fields, screens, district labels). Do not flatten to English.
3. `engine/apply-decisions.mjs`: the commit body contains a literal `\n`. Write a real line break.
4. `samples/make-sample-repo.sh`: remove "(outside request scope)" hints from scripted commit messages.
5. `samples/audit.sample.json`: add a plain entry for `src/shared/utils/relativeTime.ts`, and rewrite the tests plain text without code words. Keep en and ko.

UI (`ui/index.html`)
6. Building height (SPEC 6.3): every file has a building. Use `locBefore` before the file's step and `locAfter` from its step on; `maxLoc` is over both. A reverted building returns to `locBefore`, not 0. Unchanged and affected buildings are visible at every step.
7. Business view: receipt "Outside request" entries show plain title + detail instead of facts.
8. Totals recompute live after reverts: a reverted item no longer counts as outside, and its affected files no longer count (their arcs and rings disappear).
9. Affected files: inspector shows Approve / Revert / Next acting on their cause (SPEC 6.4).
10. Korean: translate "N of M AI claims hold up" into natural Korean ("N of M AI claims are valid"). Render `{en, ko}` fields in the current language with fallback to en.
11. At 400 px: the language toggle does not wrap, and in one-column layout the city panel and inspector come before the receipt (SPEC 6.2).
12. Step line: omit empty separators when sha is null ("Step 7/7 · Done").
