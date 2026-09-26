# Overlook implementation plan

## 0. Summary

When an AI agent (Bob) finishes a coding task, it is hard to know what actually changed and whether it touched anything outside the requested scope. Reviewers have to read a long diff themselves, and there is no way to check whether the agent's report is true.

Overlook is an AI code audit tool: it collects deterministic evidence from git (changed files, LOC, import graph, test changes), and Bob in Auditor mode judges and explains on top of that evidence. A city-model UI visualizes the scope of the change, the reviewer can approve or revert each change, and the receipt can be exported as a PR comment.

**Demo scenario GT-142**: a request saying readers want relative time ("3 days ago") instead of absolute dates. Besides the Article view, the agent also touched `api/articles.serializer.ts` and `tests/formatDate.spec.ts`; Overlook shows these out-of-scope changes as red buildings.

---

## 1. Phases

### P1 · Bob config

- **Mode**: Agent (subtask)
- **SPEC sections**: 7 (7.1, 7.2, 7.3)
- **Files created / changed**:
  - `.bob/custom_modes.yaml`
  - `.bob/rules/01-project.md`
  - `.bob/rules/02-session-log.md`
  - `.bob/rules-overlook-auditor/01-evidence-first.md`
  - `.bob/skills/fence-mapper/SKILL.md`
  - `.bob/skills/claim-extractor/SKILL.md`
  - `.bob/skills/business-translate/SKILL.md`
  - `AGENTS.md`
  - `package.json`
  - `README.md` (stub)
- **Done check**:
  ```bash
  # Check that the files exist
  ls .bob/custom_modes.yaml .bob/rules/01-project.md .bob/rules/02-session-log.md \
     .bob/rules-overlook-auditor/01-evidence-first.md \
     .bob/skills/fence-mapper/SKILL.md \
     .bob/skills/claim-extractor/SKILL.md \
     .bob/skills/business-translate/SKILL.md \
     AGENTS.md package.json README.md
  # Check that the YAML parses
  python3 -c "import yaml, sys; yaml.safe_load(open('.bob/custom_modes.yaml')); print('YAML OK')"
  ```
  Expected: all files listed, `YAML OK`
- **Bobcoin estimate**: 3
- **Session screenshot**: `<team>_task01_p1_bob_config_summary.png`

---

### P2 · Sample repo

- **Mode**: Agent (subtask)
- **SPEC sections**: 5, 3.2
- **Files created / changed**:
  - `samples/make-sample-repo.sh`
  - `samples/audit.sample.json`
- **Done check**:
  ```bash
  bash samples/make-sample-repo.sh /tmp/overlook-sample
  ```
  Expected: two lines, `BASE=<sha>` and `HEAD=<sha>`, no errors
- **Bobcoin estimate**: 3
- **Session screenshot**: `<team>_task01_p2_sample_repo_summary.png`

---

### P3 · Evidence collector

- **Mode**: Agent (subtask)
- **SPEC sections**: 3.1, 4.1
- **Files created / changed**:
  - `engine/collect.mjs`
- **Done check**:
  ```bash
  bash samples/make-sample-repo.sh /tmp/overlook-sample
  # Take BASE/HEAD from the output above and substitute them below
  node engine/collect.mjs --repo /tmp/overlook-sample --base $BASE --head $HEAD \
      --src src --out /tmp/evidence.json
  node -e "
    const e = JSON.parse(require('fs').readFileSync('/tmp/evidence.json','utf8'));
    console.log(e.files.length + ' changed, ' + e.steps.length + ' steps');
    const fd = e.files.find(f => f.path.includes('formatDate.ts'));
    console.log('formatDate importedBy:', fd?.importedBy);
    const spec = e.files.find(f => f.path.includes('formatDate.spec'));
    console.log('spec rewritten:', spec?.test?.rewritten);
  "
  ```
  Expected: `6 changed, 6 steps`, the `importedBy` array includes `CommentCard` and `ProfileArticles`, `spec rewritten: true`
- **Bobcoin estimate**: 5
- **Session screenshot**: `<team>_task01_p3_collect_summary.png`

---

### P4 · Schema + city

- **Mode**: Agent (subtask)
- **SPEC sections**: 3.2, 3.3, 4.2
- **Files created / changed**:
  - `schema/audit.schema.json`
  - `engine/build-city.mjs`
  - `samples/city.sample.json`
  - `samples/city.sample.js`
- **Done check**:
  ```bash
  # The sample repo must already exist at /tmp/overlook-sample
  node engine/collect.mjs --repo /tmp/overlook-sample --base $BASE --head $HEAD \
      --src src --out out/evidence.json
  node engine/build-city.mjs --evidence out/evidence.json \
      --audit samples/audit.sample.json --out samples/city.sample.json
  node -e "
    const c = JSON.parse(require('fs').readFileSync('samples/city.sample.json','utf8'));
    console.log('outside:', c.totals.outside);
    console.log('affected:', c.totals.affected);
    console.log('claims:', c.claims.map(cl => cl.verdict).join(', '));
  "
  ```
  Expected: `outside: 4`, `affected: 3`, `claims: true, false, false, partial`
- **Bobcoin estimate**: 6
- **Session screenshot**: `<team>_task01_p4_schema_city_summary.png`

---

### P5 · Receipt, revert, tests

- **Mode**: Agent (subtask)
- **SPEC sections**: 4.3, 4.4, 4.5
- **Files created / changed**:
  - `engine/pr-comment.mjs`
  - `engine/apply-decisions.mjs`
  - `engine/test/collect.test.mjs`
  - `engine/test/city.test.mjs`
  - `engine/test/apply.test.mjs`
- **Done check**:
  ```bash
  npm test
  ```
  Expected: all tests pass, `0 failing`
- **Bobcoin estimate**: 6
- **Session screenshot**: `<team>_task01_p5_tests_summary.png`

---

### P6 · UI shell + receipt

- **Mode**: Agent (subtask)
- **SPEC sections**: 6.1, 6.2, 6.5, 6.7, 6.8
- **Files created / changed**:
  - `ui/index.html` (loading, header, verdict bar, layout, receipt, EN/KO, themes)
- **Done check**:
  ```bash
  cd ui && python3 -m http.server 8080 &
  sleep 1
  # Open http://localhost:8080/index.html?data=../samples/city.sample in a browser
  # Check: SAMPLE DATA tag, verdict bar, receipt, approve/revert buttons
  # No console errors
  # Check the console for no window.CITY or fetch errors
  curl -s http://localhost:8080/index.html | grep -c "Overlook"
  kill %1
  ```
  Expected: `curl` prints 1 or more (the page contains "Overlook"); no console errors after the manual browser check
- **Bobcoin estimate**: 8
- **Session screenshot**: `<team>_task01_p6_ui_shell_summary.png`

---

### P7 · City, inspector, interactions

- **Mode**: Agent (subtask)
- **SPEC sections**: 6.3, 6.4, 6.6
- **Files created / changed**:
  - `ui/index.html` (adds the isometric city canvas, replay, inspector panel, interactions)
- **Done check**:
  ```bash
  cd ui && python3 -m http.server 8080 &
  sleep 1
  curl -s http://localhost:8080/index.html | grep -c "canvas"
  kill %1
  ```
  Manual check:
  - At `?data=../samples/city.sample`, click "Replay Bob's task" → buildings grow step by step
  - Click a red building (outside request) → the Inspector shows the diff and risk information
  - Click Revert in the Inspector → the building drops (switches to the unchanged color)

  Expected: a `canvas` tag exists; all 3 manual checks pass
- **Bobcoin estimate**: 10
- **Session screenshot**: `<team>_task01_p7_city_inspector_summary.png`

---

### P8 · Final checks

- **Mode**: Agent (subtask)
- **SPEC sections**: 1, 8
- **Files created / changed**:
  - `README.md` (final version)
  - `LICENSE` (MIT)
  - any other fixes needed
- **Done check**:
  ```bash
  # Go through the SPEC 8 checklist in order
  npm test                                    # 1) tests pass
  node -e "
    const c = JSON.parse(require('fs').readFileSync('samples/city.sample.json','utf8'));
    const ok = c.totals.outside===4 && c.totals.affected===3;
    const verdicts = c.claims.map(x=>x.verdict).join(',');
    console.log('sample flow:', ok ? 'OK' : 'FAIL');
    console.log('claims:', verdicts);
  "
  grep -r "secret\|password\|token\|api_key" --include="*.json" --include="*.mjs" \
      --include="*.yaml" --include="*.md" . || echo "no secrets found"
  cat README.md | head -5
  cat LICENSE | head -2
  ```
  Expected: `npm test` passes, `sample flow: OK`, `claims: true,false,false,partial`, `no secrets found`, README/LICENSE exist
- **Bobcoin estimate**: 4
- **Session screenshot**: `<team>_task01_p8_final_checks_summary.png`

---

## 2. Acceptance matrix

| SPEC § 8 item | Phase / Task | Check |
|---|---|---|
| `node --test engine/test` passes | P5 | `npm test` |
| 6 changed, 4 outside, 3 affected, claims true/false/false/partial | P3, P4 | `node engine/build-city.mjs` → check totals |
| `ui/index.html?data=../samples/city.sample` renders, SAMPLE DATA tag, no console errors, light/dark, 400px | P6 | manual browser check |
| Revert → export → apply-decisions → rerun → receipt pending drops by 1 | P7, Task 04 | `node engine/apply-decisions.mjs --dry-run` + manual UI check |
| Overlook Auditor mode cannot write outside `out/` | Task 02 | Try writing to `src/` in Auditor mode → refused |
| No secrets in the repository | P8 | `grep -r "secret\|password\|token\|api_key" …` |

> The Auditor mode write restriction is checked in Task 02, after restarting the IDE.

---

## 3. Bob feature coverage

| Bob feature | Where it is used | Evidence (screenshot or file) |
|---|---|---|
| Plan mode | Task 01 Part A: writing `docs/PLAN.md` and `docs/BOB_SESSIONS.md` | `<team>_task01_plan_and_build_summary.png` |
| Agent mode | Implementing each subtask P1–P8 | Screenshot per phase |
| Subtasks | P1–P8 each run as an independent subtask | Subtask entries in the task list |
| Custom mode with fileRegex write restriction | `.bob/custom_modes.yaml` overlook-auditor: `fileRegex: "^out/.*\\.(json\|md)$"` | Task 02 screenshot, `custom_modes.yaml` |
| Project rules | `.bob/rules/01-project.md` (commit rules, no secrets, no engine dependencies) | Files in `docs/` |
| Mode-specific rules | `.bob/rules-overlook-auditor/01-evidence-first.md` (audit procedure) | `.bob/rules-overlook-auditor/` |
| AGENTS.md | Contains the "evidence decides, Bob explains" principle | `AGENTS.md` |
| Skills | fence-mapper, claim-extractor, business-translate (3 skills) | `.bob/skills/*/SKILL.md` |
| Parallel subagents | 4 subagents run in parallel during the Task 02 audit (fence, claims, plain, district) | Task 02 screenshot, video |
| Document understanding (.docx) | Reading `brief/GT-142.docx` in Task 02/04 | Task 02 screenshot |
| Todo list | Bob keeps a checklist in each subtask | Todo list shown in the chat |
| Commit message generation | Bob writes the commit message after each phase | git log |
| Review | Task 05 (optional): review `engine/`, `ui/` | `<team>_task05_review_summary.png` |
| PR generation | Task 06: generate the PR description and open the PR | `<team>_task06_pr_summary.png` |
| Bob Shell (optional) | Task 15 (optional): `bob run --mode overlook-auditor …` | Video or terminal output |

---

## 4. Bobcoin budget and cut lines

| Phase | Estimate | Cumulative |
|---|---|---|
| P1 Bob config | 3 | 3 |
| P2 Sample repo | 3 | 6 |
| P3 Evidence collector | 5 | 11 |
| P4 Schema + city | 6 | 17 |
| P5 Receipt, revert, tests | 6 | 23 |
| P6 UI shell + receipt | 8 | 31 |
| P7 City, inspector, interactions | 10 | 41 |
| P8 Final checks | 4 | 45 |
| **Task 02–06 (separate tasks)** | 20 | 65 |

> At 40 Bobcoins per person, about 45 are expected through P8. With 120 coins available across a 3-person team, there is headroom.

**Never cut**: P3, P4, P6, P7 (core features)

**Can be cut to save coins** (lowest priority first):
1. Task 05 (Review) — optional step
2. Task 15 (Bob Shell) — optional step
3. Task 14 (submission draft) — can be written by a person

**If P5 tests take too long**: cut the test asserts to 3 and replace the rest with manual checks.

---

## 5. Risks

| Risk | Likelihood | Mitigation |
|---|---|---|
| P3 import graph cannot handle path aliases (@/) | Medium | The sample repo uses relative paths only; if the real demo app uses aliases, request a P3 fix |
| P7 canvas rendering cannot be verified headless | High | Use a manual browser check instead; the done check lists curl + manual steps |
| P5 tests fail because of OS-specific git paths | Medium | Use `os.tmpdir()` instead of /tmp; retry up to 3 times on failure |
| P4 outside count is not 4 | Low | Pin fence.paths in samples/audit.sample.json to `src/articles/` |
| Not enough Bobcoins | Medium | Check the balance before P8; skip the Review/Shell steps |

---

## 6. Open questions

None. The YAML indentation in SPEC 7.1 (how fileRegex is expressed in groups) follows the SPEC example as is.
