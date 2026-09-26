# Overlook: build order for building it from scratch with Bob

This document is the team's plan for building Overlook from scratch with IBM Bob.
Bob reads SPEC.md (the English specification), and the step prompts below are pasted in as they are.

**Deadline: Mon Sep 28, 00:00 KST. Target submission: Sunday 22:00**

---

## Principles

- Bob writes all the code. People only check results, run things and make small fixes.
- Any part a person changes substantially is marked `[manual]` in the commit message.
- One step = one Bob task. Opening a new task per step keeps a session summary per step, and the shorter context also saves Bobcoins.
- After every task, take a session summary screenshot and put it in `bob_sessions/`. Every team member needs at least one.

---

## 0. Before starting (no Bobcoins used)

### 0-1. Repository

- Start the submission repository clean, so it only contains code Bob made.
- First contents of the repository (committed by a person):

```
SPEC.md                    ← English specification
BOB_BUILD_PLAN.md          ← this document
brief/GT-142.docx          ← demo request (content of SPEC appendix A)
docs/design-ref/*.png      ← design reference images
bob_sessions/.gitkeep
.gitignore                 ← node_modules/, .env, out/
```

- Commit message: `chore: add spec, brief and design references`

### 0-2. Design references

Open the existing prototype page in a browser and put 3–4 screen captures in `docs/design-ref/`:
- the whole city, the receipt, the inspector, the business view

### 0-3. Environment (every team member)

- Check the Bob invitation email, create an IBMid
- Install Bob IDE 2.0.2 or later
- In Settings → General, select the hackathon account (`ibm-coding-challenge`, `us-east`)
- Node.js 22 or later, git, Python 3
- (Optional) Bob Shell: `curl -fsSL https://bob.ibm.com/download/bobshell.sh | bash`
- Demo target app: clone one RealWorld (Conduit) React implementation into a folder next to the submission repository (`../realworld`)

### 0-4. Owners (example, 3 people)

| Owner | Steps | Share of Bobcoins |
|---|---|---|
| A (engine) | 1, 2, 4, 5, 10, 12 | Largest |
| B (data and verification) | 3, 6, 9, 11 | Medium |
| C (UI and presentation) | 7, 8, 13, 14 | Medium |

Working alone, go in order; steps 9 and 13–15 are optional.

### 0-5. Bobcoin budget (40 per person)

After step 1, check usage in Settings and divide what is left by the remaining steps to set a budget per step.

Ways to save:
- Start each step as a new task.
- Tell Bob to read only the sections it needs, like "section 4.1 only", not all of `@SPEC.md`.
- Do not paste whole logs; paste only the error lines.

Steps to keep when Bobcoins run short: **4, 5, 7, 8, 10, 11, 12**

---

## Steps

At the end of every step:
1. Run the done-check command yourself
2. Commit with Bob's commit message generation (skip if the step already committed)
3. Session summary screenshot → `bob_sessions/<team>_stepNN_<short-description>.png`

---

### Step 1. Plan: Plan mode · owner A

```
Read @SPEC.md sections 1, 2 and 8. Also look at the images in docs/design-ref/.
Make an implementation plan for Overlook that follows the spec exactly: the order of work, the files to create, and how each acceptance check in section 8 will be verified. Save it as docs/PLAN.md. Do not write code yet.
```

**Done when:** `docs/PLAN.md` exists and its steps are close to this document

---

### Step 2. Project setup and Bob configuration: Agent mode · owner A

First type `/init` in the chat (creates AGENTS.md). Then:

```
Read @SPEC.md section 7 only.
Create exactly these Bob configuration files as specified: .bob/custom_modes.yaml, .bob/rules/01-project.md, .bob/rules-overlook-auditor/01-evidence-first.md, and three skills in .bob/skills/ (fence-mapper, claim-extractor, business-translate) with SKILL.md files that have name and description frontmatter and concrete examples.
Also create package.json (type module, no dependencies, scripts: test = node --test engine/test) and a short README.md stub. Update AGENTS.md so it states the principle "evidence decides, Bob explains". Commit.
```

**Done when:**
- Overlook Auditor appears in the IDE's mode list
- The 3 skills are recognized (ask "Which skills are available?" in the chat)

---

### Step 3. Sample repository for testing: Agent mode · owner B

```
Read @SPEC.md section 5 and section 3.2.
Write samples/make-sample-repo.sh that builds the GT-142 sample repository exactly as described (baseline commit, then six scripted commits), prints BASE= and HEAD=, and says in its header that the commits are scripted. Then write samples/audit.sample.json for that repo with "sample": true, English and Korean text, district labels, claims matching a report "Done. Article dates now show relative time. I only changed the article views. No API changes. All tests pass.", plain-language entries and four screens. Run the script into /tmp/overlook-sample to check it works. Commit.
```

**Done when:** `bash samples/make-sample-repo.sh /tmp/overlook-sample` prints BASE/HEAD with no errors

---

### Step 4. Evidence collector: Agent mode · owner A

```
Read @SPEC.md sections 3.1 and 4.1 only.
Implement engine/collect.mjs exactly as specified: Node 22, ES module, no dependencies, git via child_process. Run it on the sample repo (bash samples/make-sample-repo.sh /tmp/overlook-sample; base = first commit) and show me the summary line and the entries for src/shared/utils/formatDate.ts and tests/formatDate.spec.ts. Commit after it works.
```

**Done when:** the summary line is `6 changed, 6 steps`, `importedBy` of `formatDate.ts` contains `CommentCard` and `ProfileArticles`, and `rewritten` of the test file is `true`

---

### Step 5. Verdicts and schema: Agent mode · owner A

```
Read @SPEC.md sections 3.2, 3.3 and 4.2 only.
Write schema/audit.schema.json (JSON Schema 2020-12) and implement engine/build-city.mjs exactly as specified, including the risk table, the claim verdict table, and writing city.js next to city.json. Run it with the sample evidence and samples/audit.sample.json, output samples/city.sample.json, and show me totals, items and claims. Commit.
```

**Done when:** `outside` 4, `affected` 3, claim verdicts in order `true`, `false`, `false`, `partial`

---

### Step 6. Tests, PR receipt, revert: Agent mode · owner B

```
Read @SPEC.md sections 4.3, 4.4 and 4.5 only.
Implement engine/pr-comment.mjs and engine/apply-decisions.mjs, and write node:test tests in engine/test/ that build the sample repo in a temp directory and check every assertion listed in section 4.5. Run npm test until it passes. Commit.
```

**Done when:** `npm test` passes

---

### Step 7. UI (1) shell, verdict bar, receipt: Agent mode · owner C

```
Read @SPEC.md sections 6.1, 6.2, 6.5, 6.7 and 6.8. Use the images in docs/design-ref/ as the visual reference.
Create ui/index.html as one static file: data loading, header, verdict bar with underlined false claims, two-column layout, and the full receipt with approve/revert, totals, stamp and export. Leave a placeholder panel where the city canvas will go. English and Korean strings, light and dark theme, works at 400px. Test with ui/index.html?data=../samples/city.sample using a local server (python3 -m http.server). Commit.
```

**Done when:** with the sample data, the verdict bar and receipt show and approve/revert work

---

### Step 8. UI (2) city, replay, inspector: Agent mode · owner C

```
Read @SPEC.md sections 6.3, 6.4 and 6.6 only. Compare with the city image in docs/design-ref/.
Add the isometric city canvas to ui/index.html exactly as specified (layout, projection, faces, fence, pins, affected rings, dependency arcs, shockwaves, focus mode, replay with the Bob tag, hit testing), then the inspector and the interactions (toast with undo, next, keyboard, localStorage). Keep it in the same file. Check there are no console errors. Commit.
```

**Done when:** replay raises the buildings step by step, clicking a red building shows the diff and the screen before and after, and Revert lowers the building

---

### Step 9. (Optional) Check with Bob code review: Review feature · owner B

Have Bob's Review feature review the changes in `engine/` and `ui/`, then fix the findings in Agent mode.
This is evidence of one more Bob feature.

---

### Step 10. Auditor mode check (sample): Overlook Auditor mode · owner A

**Check 1, write restriction:**

```
List the tool groups you have in this mode. Then try to create src/should-not-exist.txt containing "test". Report exactly what happened. Do not work around a refusal.
```

**Check 2, full sample audit (parallel subagents):**

```
Audit the sample task in /tmp/overlook-sample. Brief: @brief/GT-142.docx. Base commit: <BASE>. Agent's report: "Done. Article dates now show relative time. I only changed the article views. No API changes. All tests pass."
Follow your rules: run the collector, spawn the four subagents in parallel using the fence-mapper, claim-extractor and business-translate skills, write out/audit.json valid against schema/audit.schema.json, then run build-city to ui/city.json and pr-comment, and show me the receipt.
```

**Done when:**
- Writing to `src/` is refused. If it is not, record the result and block it with a rule.
- Several subagents show in the subagent panel at the same time → record this screen for the video
- `out/audit.json` is created

---

### Step 11. Real demo task: Agent mode · owner B · target `../realworld`

- Before starting, record BASE with `git rev-parse HEAD`.
- Copy `.bob/rules/01-project.md` (commit after every step) into the demo repository too.
- Do not steer Bob; let it work as usual. Do not mention Overlook.

```
Read @<path>/brief/GT-142.docx and implement it. Commit after each sub-task with a short message. When you are done, give me a short final report of what you changed and whether tests pass.
```

- Save Bob's final report verbatim as `out/bob-report.txt` in the submission repository.
- Run 2–3 more requests the same way and pick the most telling result for the demo. Do not manipulate results.

---

### Step 12. Real audit: Overlook Auditor mode · owner A

```
Audit the finished task in ../realworld. Brief: @brief/GT-142.docx. Base commit: <BASE>. Agent's report: @out/bob-report.txt. Source folder: src.
Follow your rules end to end and show me the receipt.
```

Then, run by a person:

```bash
python3 -m http.server 8080   # http://localhost:8080/ui/index.html
```

- In the UI: decide → export → save `out/decisions.json`
- `node engine/apply-decisions.mjs --repo ../realworld --decisions out/decisions.json`
- Run the step 12 audit again and record the stamp changing to "READY TO MERGE".

**Done when:** the city built from real data shows no SAMPLE DATA tag

---

### Step 13. Deployment and PR: Agent mode · owner C

```
Prepare the repo for submission: make ui/city.json and ui/city.js from the real audit part of the repo (force-add them), write a complete README.md from @SPEC.md section 1 and the real results in ui/city.json, add an MIT LICENSE, and add a GitHub Pages note. Then create a branch, commit, and open a pull request with a generated description.
```

- In GitHub → Settings → Pages, turn on the root of the `main` branch to get the Application URL.
- (Optional) Post the receipt on the demo repository's PR: `gh pr comment <number> --body-file out/receipt.md`

---

### Step 14. Submission draft: Ask or Agent mode · owner C

```
Using @SPEC.md section 1, @ui/city.json and the files in bob_sessions/, draft docs/SUBMISSION.md with: a short description (one sentence), a Problem & Solution statement under 500 words, and an IBM Bob usage statement under 500 words that names the concrete Bob features we used (custom mode with fileRegex write restriction, parallel subagents, document understanding of the .docx brief, three skills, Agent mode with per-step commits, Review, commit/PR generation, and Bob Shell if used). Use only facts from the repo. Mark any number we have not measured as [measured: ...].
```

Fill the `[measured: …]` placeholders from user testing (3–5 people; time and accuracy reading a diff vs. using Overlook).

---

### Step 15. (Optional) Bob Shell, non-interactive

```bash
bob run --mode overlook-auditor --format json "Audit the finished task in ../realworld. Base <BASE>. Brief brief/GT-142.docx. Report out/bob-report.txt. Follow your rules."
```

Skip it if the custom mode does not work with `--mode`.
If it works, put 5 seconds of it in the video as the case for "automatic audit on every PR".

---

## Video shot list (record while doing the steps)

| Scene | Step | Purpose |
|---|---|---|
| Bob's "Done…" report in the chat | 11 | First 5 seconds of the video |
| 4 subagents running in parallel in Auditor mode | 10 or 12 | Evidence that Bob is the engine |
| City replay, red buildings, shockwaves | 12 | Key scene |
| Clicking a red building, evidence tags, diff | 12 | "git decides" |
| Approve/revert in the business view, building lowers | 12 | Value for business users |
| apply-decisions commits → stamp turns green | 12 | A real revert |
| (Optional) receipt as a PR comment | 13 | Workflow integration |

---

## If something goes wrong

- **The request fence is wrong** → fix `fence.paths` in `out/audit.json` and rerun only `build-city`. No need to rerun Bob.
- **Affected files are not detected** → the demo app uses path aliases like `@/…`. Ask in Agent mode: `"Add tsconfig path alias resolution to resolveImport in engine/collect.mjs"`.
- **The custom mode does not appear** → check the indentation of `custom_modes.yaml`, then restart the IDE.
- **Not enough Bobcoins** → do steps 9, 13, 14 and 15 by hand and focus on steps 4, 5, 7, 8, 10, 11 and 12.

---

## Final check before submission

- [ ] Public repository, MIT license, no secrets
- [ ] Session summary screenshots from every team member in `bob_sessions/`
- [ ] Video 3 minutes or less, product demo 90 seconds or more, includes Bob in use
- [ ] Problem & solution and Bob usage statements each 500 words or less, every `[measured]` placeholder filled
- [ ] Cover image, slides, Application URL
- [ ] Title `Overlook` (English letters and spaces only, 32 characters or less)
