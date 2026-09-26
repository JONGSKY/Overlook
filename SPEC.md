# Overlook — Build Specification

This is the single source of truth for building Overlook with IBM Bob.
Read the section a task points to; do not read the whole file when a section is enough.

---

## 1. Product

**One line:** AI said done. Overlook shows what actually changed, compared with what you asked for, and lets anyone approve or revert each change.

Overlook audits a coding task that an AI agent (IBM Bob in Agent mode) has already finished. It answers: what did the agent actually change, compared with what was requested, and is what the agent reported true?

### Users

- **Developer reviewing an agent's work:** sees risky changes first instead of reading the whole diff.
- **Product manager who wrote the request:** reads the plain-language note above each change and the verdict line.
- **Team lead:** keeps a receipt for every AI task.

### Core principle: evidence decides, Bob explains.

- Facts (changed files, line counts, steps, test rewrites, import graph) are computed from git by deterministic code. No LLM decides a fact.
- Bob interprets: which parts of the codebase the request covers (the fence), which claims the agent made, and what the impact means in plain language.
- Claim verdicts that git can check are computed by code, not by Bob.

---

## 2. Repository Layout

```
engine/collect.mjs          evidence from git          -> out/evidence.json
engine/build-city.mjs       evidence + audit            -> city.json (+ city.js)
engine/pr-comment.mjs       city (+ decisions)          -> out/receipt.md
engine/apply-decisions.mjs  decisions                   -> one git revert commit per file
engine/sources.mjs          GitHub link (folder via API) -> repository + base..head, PR + issue, latest task
engine/draft-audit.mjs      typed request + report      -> draft audit.json (no Bob yet)
engine/audits.mjs           saved audits                -> out/audits/<id>.json
engine/site.mjs             the site + local API (npm run site, http://localhost:4280)
engine/mcp.mjs              MCP tools for Bob (npm run mcp, .bob/mcp.json)
engine/test/*.test.mjs      node:test tests
ui/                         the site: index.html, app.js, workspace.js, atlas3d.js, history-graph.js, map.js, iso.js, layers.js, util.js, styles.css (static, no build)
schema/audit.schema.json    contract for Bob's audit output
samples/make-sample-repo.sh builds a test repo reproducing scenario GT-142
samples/build-sample.sh     regenerates samples/city.sample.json and receipt.sample.md
samples/audit.sample.json   audit for the sample repo
samples/real/build-real.mjs real audits of public agent tasks (pinned base..head) -> samples/real/<id>.city.json + index.json
brief/GT-142.docx           the demo request
.bob/custom_modes.yaml      overlook-auditor mode
.bob/rules/, .bob/rules-overlook-auditor/, .bob/skills/*/SKILL.md, .bob/commands/*.md, .bob/mcp.json
AGENTS.md, .bobignore       Bob workspace guidance and ignore list
docs/                       architecture, metrics, screenshots
bob_sessions/               task session summary screenshots (submission requirement)
```

**Constraints:** Node.js 22+, ES modules, no npm dependencies anywhere. The UI is static (no framework, no build); fonts from Google Fonts only; English only.

## 3. Data Contracts

Any human-readable text field in `audit.json` and `city.json` may be a string or `{ "en": "...", "ko": "..." }`. The UI is English only and shows `en`.

### 3.1 evidence.json (written by collect.mjs)

```json
{
  "kind": "overlook.evidence/v1",
  "generatedAt": "ISO date",
  "repo": "folder name",
  "base": "full sha", "head": "full sha", "src": "src or .",
  "refs": { "base": "branch holding base, e.g. main", "head": "branch at head, e.g. agent/gt-142-relative-dates" },
  "steps": [ { "sha": "...", "message": "commit subject", "author": "name", "date": "ISO date", "files": ["paths touched in this commit"],
               "changes": { "path": { "plus": 3, "minus": 1, "diff": [["h","@@ …"],["a","added line"]] } }, "merge": true } ],
  "graph": {
    "lanes": [ { "id": "base", "name": "main", "kind": "base" }, { "id": "head", "name": "agent/gt-142-relative-dates", "kind": "head" },
               { "id": "o1", "name": "feature/other", "kind": "other", "merged": false, "more": 3,
                 "pr": { "number": 12, "title": "…", "state": "open | closed | merged", "url": "…", "mergedAt": "ISO date" } } ],
    "commits": [ { "sha": "...", "lane": "base | head | o1…", "parents": ["sha"], "date": "ISO date", "author": "name", "message": "subject", "step": 2,
                   "files": ["paths this commit touched, for commits outside the range"], "moreFiles": 0, "lines": [[3, 1]], "peek": { "path": [["h", "@@ -4 +4 @@"], ["a", "added line"], ["d", "removed line"]] },
                   "landed": true, "pr": 1652 } ]
  },
  "files": [ {
    "path": "src/shared/utils/formatDate.ts",
    "status": "unchanged | added | modified | deleted | renamed",
    "from": "old path if renamed",
    "locBefore": 4, "locAfter": 6,
    "plus": 3, "minus": 1,
    "step": 2,
    "isTest": false, "isApi": false,
    "importedBy": ["src/comments/CommentCard.tsx"],
    "uses": { "src/shared/utils/formatDate.ts": "import { formatDate } from '../shared/utils/formatDate';" },
    "diff": [["c","context line"],["d","removed line"],["a","added line"],["h","…"]],
    "test": { "assertionsRemoved": 1, "assertionsAdded": 1, "skipsAdded": 0, "rewritten": true, "weakened": false }
  } ]
}
```

`graph` (optional) is the branch picture around the audited range, for the history bar under the map:
- **base** lane: a stretch of the base branch's first-parent line you can scroll along: up to 12 commits before `base`, then up to 30 unbroken commits after it (a later commit that merges `head` into it is kept too).
- **head** lane: the first-parent line `base..head`. Commits of the range that are not on it (merged in from the base branch) sit on the base lane.
- **other** lanes: at most five other branches that forked from the base branch or were active in the same period, each with its newest five own commits (`more` counts the rest); `merged` when the branch is already in the base branch.
- `step` is the 1-based index of the commit in `steps`, only for commits inside `base..head`; a parent that is not in `commits` means the history continues off the picture.
- `merge` on a step: the commit is a merge (for example the base branch merged into the task's branch). It touches no file of its own, so `files` is empty and it never leaves the requested area; the graph commit keeps what it brought in (`files`, `lines`, `peek` against its first parent), shown as another branch's work, not the agent's.
- `files` (commits without a `step`, and merge steps; the range's other commits have theirs in `steps`): the paths the commit touched against its first parent, at most 40 (`moreFiles` counts the rest); `lines` the +/− line counts per file, in the same order; `peek` the first changed lines (at most 6) of its first four files, so any commit in the picture can be read. Redacted examples carry no `peek`. The UI compares a branch with the audited one through them: files changed on both sides may conflict.
- `pr` on a lane (the head lane and other branches): the pull request opened from that branch, with title and state. The head lane's comes from the audited PR; the others are looked up on GitHub (`enrichGraphPrs` in `engine/sources.mjs`) and are left out without network.
- `direct` on the head lane: the task was committed straight onto the base branch (head is on its first-parent line), not through a pull request.
- `pr` on a commit: the pull request its subject names, from git alone: a squash subject ending in `(#123)` or `Merge pull request #123 …`. On the base branch these are the pull requests merged there.
- `landed` (base lane, after base): the task itself reaching the base branch, either a merge whose parents include `head` or a commit whose `git patch-id --stable` equals the whole range's or one step's (squash or rebase merges). Such commits are not counted as someone else's work when comparing.

### 3.2 audit.json (written by Bob in Overlook Auditor mode)

```json
{
  "kind": "overlook.audit/v1",
  "sample": false,
  "example": { "kind": "Copilot agent PR", "repo": "owner/name", "url": "source link", "context": "why", "auditor": "who wrote fence and claim types", "license": "MIT", "redacted": false },
  "request": { "id": "GT-142", "title": "...", "scope": "Article list, Article page", "source": "brief/GT-142.docx" },
  "fence": { "paths": ["src/articles/"], "rationale": "sentence quoting the brief" },
  "districts": [ { "path": "src/comments/", "label": "Comments" } ],
  "bobReport": "the agent's final report, verbatim",
  "claims": [
    { "text": "verbatim substring of bobReport", "type": "scope | no_api_change | tests_pass | no_new_files | only_files | feature",
      "files": ["only for only_files"], "verdict": "true | false | false | partial (feature only)", "note": "feature only" }
  ],
  "plain": { "path": { "title": "under 12 words", "detail": "under 20 words" } },
  "screens": [ { "file": "path", "label": "Comments · not requested", "title": "...", "who": "...", "before": "text or {\"img\":\"path\"}", "after": "text or {\"img\":\"path\"}" } ]
}
```

`example` (optional) marks a real task from a public repository audited as an example (`samples/real/`): the request and the agent's report are quoted from the source, the fence and claim types were written by a person. `build-city` copies it to `city.meta.example`; the UI then says so instead of "Audited with IBM Bob". With `redacted`, diffs are left out because the source has no license.

Also write this as a JSON Schema (draft 2020-12) in `schema/audit.schema.json`.

### 3.3 city.json (written by build-city.mjs)

```json
{
  "kind": "overlook.city/v1",
  "meta": { "repo": "...", "base": "...", "head": "...", "generatedAt": "...", "sample": false },
  "request": {}, "bobReport": "...",
  "fence": { "paths": [], "rationale": "..." },
  "districts": [ { "id": "src/articles/", "path": "src/articles/", "label": "...", "inFence": true } ],
  "steps": [ { "message": "Task received", "sha": null, "files": [] }, "…one per commit…", { "message": "Done", "sha": null, "files": [] } ],
  "graph": "evidence.graph, copied as is (optional)",
  "files": [ { "…evidence fields…": "", "name": "file name", "district": "id", "inFence": true, "kind": "none | in | out | affected", "item": "i1", "causes": ["path"] } ],
  "items": [ { "id": "i1", "file": "path", "risk": "high | medium | low", "reasons": ["api_contract"], "ripple": ["paths"], "step": 2, "facts": "sentence", "evidence": ["git-diff"], "plain": { "title": "", "detail": "" } } ],
  "claims": [ { "text": "...", "type": "...", "verdict": "true | false | partial | unverified", "detail": "sentence", "evidence": ["git-diff"] } ],
  "screens": [],
  "totals": { "filesChanged": 0, "outside": 0, "affected": 0, "apiChanges": 0, "testsRewritten": 0, "claimsTrue": 0, "claims": 0 }
}
```

`build-city.mjs` also writes `city.js` next to `city.json` containing `window.CITY = {...};` so the UI works from `file://`.

---

## 4. Engine Algorithms

### 4.1 collect.mjs

CLI: `node engine/collect.mjs --repo <path> --base <sha> [--head HEAD] [--src .] [--out out/evidence.json]`. `--src` defaults to `.` (the whole repository) so tests outside `src/` are audited.

- **File lists:** `git ls-tree -r --name-only <rev> -- <src>` at base and head.
- **Status:** `git diff --name-status -M base head -- <src>` (A added, M modified, D deleted, R renamed).
- **Plus/minus:** `git diff --numstat -M base head -- <src>`.
- **LOC:** non-blank lines of `git show <rev>:<path>` for text extensions (js, jsx, ts, tsx, mjs, cjs, vue, svelte, py, java, kt, go, rb, php, cs, swift, css, scss, html, json, yml, yaml, md, sql, and for infrastructure and configuration: tf, tfvars, hcl, toml, ini, cfg, conf, sh, bash, env, xml, graphql, gql, proto, rs, less, sass, ejs, hbs, astro, mdx, txt) and for text files without one (`Dockerfile*`, `Containerfile`, `Makefile`, `Procfile`, `Jenkinsfile`, `Gemfile`, `Brewfile`, `.env*`, `.gitignore`, `.dockerignore`, `.editorconfig`, `.npmrc`, `.nvmrc`, `.node-version`). 0 for others and for missing files.
- **Steps:** `git log --reverse --format=%H%x1f%s base..head`; files per commit via `git diff-tree --no-commit-id --name-only -r <sha>`. step of a file = 1-based index of the first commit that touched it.
- **Diff:** `git diff -U1 base head -- <path>`, drop headers, map lines to c/d/a, @@ to h, cap at 60 lines.
- **Test file:** path matches `(^|/)(__tests__|tests?|spec)/` or `[._-](spec|test)\.[a-z]+$`. For changed test files count removed/added lines containing assertion keywords (`expect`, `assert*`, `should`, `toBe`, `toEqual`, `toMatch*`, `assertEquals`) and added skip markers (`it.skip(`, `test.skip(`, `describe.skip(`, `xit(`, `xdescribe(`, `@Disabled`, `@Ignore`, `pytest.mark.skip`). `rewritten` = removed > 0 and added > 0. `weakened` = skips added > 0 or removed > added.
- **API file:** path segment or filename matches `api`, `route(s)`, `controller(s)`, `serializer(s)`, `handler(s)`, `endpoint(s)`.
- **Import graph at head** for js/ts files: match `import … from '…'`, `export … from '…'`, `import('…')`, `require('…')`. Resolve relative specifiers against the importing file, trying extensions `""`, `.ts`, `.tsx`, `.js`, `.jsx`, `.mjs`, `.cjs`, `/index.ts`, `/index.tsx`, `/index.js`. Build `importedBy` (reverse edges). For every import of a *changed* file, keep the import statement on one line in the importer's `uses` (`{ changed path: statement }`): the evidence shown for "may be affected". **Go**: the module path comes from `go.mod`; an import of `<module>/pkg/x` (single or in an `import ( … )` block, with or without an alias) makes the importer depend on every non-test `.go` file in `pkg/x/` (statement `import "<module>/pkg/x"`). **Python**: `import a.b`, `from a.b import c` and relative `from .x import y` resolve to `a/b.py` or `a/b/__init__.py` (also under `src/`), and `from a.b import c` also to the submodule `a/b/c.py`. Other languages have no import graph, so nothing is marked "may be affected" there.

### 4.2 build-city.mjs

CLI: `node engine/build-city.mjs --evidence out/evidence.json --audit out/audit.json [--out ui/city.json]`

- **District of a file:** longest matching `audit.districts[].path` prefix; otherwise the first folder under `src` (two levels if the first is generic: `shared`, `common`, `lib`, `libs`, `utils`, `core`, `components`, `packages`, `modules`).
- **In fence:** path equals or starts with any `fence.paths` entry (directories end with `/`).
- **kind:** changed & in fence → `in`; changed & outside → `out`; unchanged, non-test file that imports a modified (not added), non-test, out-of-fence file → `affected` with `causes`.
- **Items** = changed files with `kind out`. Reasons and risk:

| Condition | Reason | Risk |
|---|---|---|
| deleted | `deleted` | high |
| API file | `api_contract` | high |
| test rewritten | `test_rewritten` | high |
| test weakened | `test_weakened` | high |
| has affected importers | `ripple` | high if 2+, else medium (never lowers a high) |
| added, nothing else | `additive` | low |
| none of the above | `outside_fence` | medium |

`facts`: one deterministic sentence, e.g. `"modified outside the request fence, +3 −1. changes the output of 2 file(s) it is imported by: CommentCard.tsx, ProfileArticles.tsx."` Sort items by risk (high first), then step.

- **Claim verdicts (computed, not from Bob):**

| type | false / partial when | detail | evidence |
|---|---|---|---|
| `scope` | any `out` file | list them | git-diff |
| `no_api_change` | any changed API file | list them | git-diff |
| `tests_pass` | not run yet: **unverified**, or **partial** when a test was rewritten or weakened (passing then proves less); true / false only after the original tests run (`applyRuns`) | "Reported by the agent, not run yet…" + list | test-diff |
| `no_new_files` | any added file | list them | git-diff |
| `only_files` | any changed file not in `files` | list extras | git-diff |
| `feature` / other | use Bob's verdict (default `unverified`) | Bob's note | bob-judgement |

- **steps** = `[Task received]` + commits + `[Done]`.

### 4.3 pr-comment.mjs

CLI: `--city ui/city.json [--decisions out/decisions.json] [--out out/receipt.md]`. Markdown: title with request id, request, Bob's report, totals table, "Outside the request" list with risk icons (🔴 high, 🟠 medium, ⚪ low) and decision, "AI claims checked" with ✅ ❌ ⚠️ ❔ and evidence, status line, footer `"Evidence is computed from git (base..head). Bob explains; git decides."`

### 4.4 apply-decisions.mjs

CLI: `--repo <path> --decisions out/decisions.json [--dry-run]`. `decisions.json` = `{ "base": sha, "head": sha, "decisions": { "path": "approve | revert" } }`. Refuse if the working tree is dirty. For each revert: if the file exists at base, `git checkout <base> -- <path>`; else `git rm <path>`; commit `overlook: revert <path>` with a body explaining it was a reviewer decision. One commit per file.

### 4.6 verify.mjs (tests run by Overlook)

All runs happen in a throwaway `git worktree` (removed afterwards); dependencies are installed there when `package.json` has any. The test command is detected (`npm test` if a real `test` script exists, pytest, `go test ./...`, `cargo test`) or given. `NODE_TEST_CONTEXT` is stripped so nested `node --test` runs report their real exit code.

- **cross:** worktree at head; every test file that changed between base and head and exists at base is restored to its base version; run the tests. Failing = "the original tests fail on the new code".
- **reverts:** worktree at head; every file marked `revert` is restored from base (or removed if it did not exist); run the tests.
- **checks:** for each feature claim with `check.command`, run it at head; exit 0 = the claim holds.

`applyRuns(city, runs)` folds results into the claims: `tests_pass` becomes `true` (or stays `partial` when tests were rewritten) when the cross run passes and `false` when it fails (evidence `test-run`); a feature claim with a check takes the check's result (evidence `check-run`). Runs are stored on the city (`city.runs`) and shown in the summary, the merge box and the receipt.

### 4.5 Tests (engine/test, run with npm test)

Build the sample repo in a temp dir, run collect and build-city, assert: 6 changed files, 4 outside the fence, 3 affected files, `tests/formatDate.spec.ts` rewritten, claims verdicts `true`, `false`, `false`, `partial`, and `apply-decisions` creates a revert commit that restores `src/api/articles.serializer.ts`.

---

## 5. Sample Scenario GT-142 (for samples/make-sample-repo.sh)

A small TypeScript/React app with folders `src/{articles,comments,profiles,shared/utils,api,auth,feed,settings}` and `tests/`. Baseline commit, then six scripted commits that imitate an agent:

1. Create `src/shared/utils/relativeTime.ts`.
2. Make `formatDate(d, opts = { relative: true })` return relative time by default (it is imported by `comments/CommentCard.tsx` and `profiles/ProfileArticles.tsx`).
3. `articles/ArticlePreview.tsx` uses `formatDate`.
4. `articles/ArticleMeta.tsx` uses `formatDate`.
5. `api/articles.serializer.ts` adds `relativeDate` (imported by `api/articles.controller.ts`).
6. `tests/formatDate.spec.ts`: replace `toBe('Sep 23, 2026')` with `toMatch(/ago|today/)`.

The script prints `BASE=` and `HEAD=`. State in the header that these commits are scripted and never presented as a real Bob run.

---

## 6. Site Specification (ui/ + engine/site.mjs)

### 6.1 Modes

- **Local server** (`npm run site`): `/api/health` answers, so the site can start audits.
- **Static host** (e.g. Vercel): no API. The home page says so and only the samples (`/sample`, `/sample/<id>`) open.
- Routes (clean paths under the app root, `/` locally and at the root of a static host): `/` (or `/main`) Main: the live map of a real audit fills the screen, with the headline on top and the GitHub link input in the middle · `/examples` every example as a card with a snapshot of its map, in two rows of three (real agent work: atlas, github-mcp-server #1645, playwright-mcp #725; scripted: infra-drift, monorepo-scale, clean-pass) · `/sample` the GT-142 sample · `/sample/<id>` a real audit (`samples/real/`) or a scripted example · `/audit/<id>` a saved audit (local server). The page loads with `<base href="/ui/">`; the local server answers these paths with `ui/index.html`, a static host with rewrites (`vercel.json`). Old `#/…` links are moved to the paths. `?data=<path-without-extension>` still opens any city file.

### 6.2 Starting an audit (home)

- One input, **GitHub link**.
  - GitHub accepts pull request, `compare/a...b`, commit, `tree/<ref>`, repository, `owner/repo` and `git@github.com:` forms. The repo is cloned into `out/repos/<owner>__<repo>` (fetched again on reuse). For a PR the base is the merge base of the PR base branch and the PR head, and the PR title and body prefill the request title and the agent's report.
- **GitHub links only** in the page (the Local folder tab was removed; the API and the MCP server still take a folder).
- **Paste a link and it runs.** Pasting (or *Audit it →*) resolves the link (`POST /api/source`) and runs the audit straight away (`POST /api/audit` with only the source, base and head), showing the steps (fetching, reading the history, checking the claims, drawing the map), then opens it. Everything left empty comes from the link: for a pull request the range is the PR's, the **request** is the issue it closes (`Fixes #724`, fetched from GitHub) or else its title, and the **agent's report** is its description; for a compare or commit link the range is the link's; for a repository or branch whose last commit names a pull request (a squash "Title (#123)" or "Merge pull request #123") the audit is that pull request, with its own branch restored from GitHub (`pull/123/head`: every commit, and every merge of the base branch into it); otherwise, and for a local folder, the range is **the latest task**, the run of commits at the tip by the same author (merges excluded, at most 12; `suggestTask`), the request is the last commit subject and the report the commit messages. The fence is inferred from the request: folders whose names it mentions, or, when there are none, the files whose distinctive names it mentions ("browser_take_screenshot" → `screenshot.ts`). *Choose the commits and scope yourself* opens the form below instead, filled from the link; it also opens when no range can be found. A missing link or a failed fetch or audit shows a short message at the top of the page for a few seconds (a toast); nothing on the page moves.
- The form (`POST /api/source`) returns the resolved range and the last 60 commits. The progress and the form open right under the link input, over the map, which stays behind (the input keeps its place and the page grows below it); the form asks for: base and head (commit pickers), request title, folder to map (optional), what was requested, the agent's final report, the request fence (comma separated, optional), and optionally Bob's `out/audit.json` (drag and drop).
- **Run audit** (`POST /api/audit`): collect → Bob's audit if given, otherwise `draftAudit` → `buildCity` → saved as `out/audits/<id>.json` → navigate to `/audit/<id>`.
- Draft audit: sentences of the report become claims. `scope`, `no_api_change`, `tests_pass` and `no_new_files` are recognised by wording; others are `feature` / `unverified`. If no fence is typed, folders whose names the request mentions become the fence (singular/plural insensitive). Draft audits are tagged "Draft audit" in the UI.
- Also on Main: the headline ("AI said done. See what actually changed.") sits at the top and the link input a little above the middle (the space above and below it split 42 : 58, so the place holds on any screen), one wide frosted bar (78 % of the width, up to 1480 px) that lifts and lights up under the pointer or while typing. Behind it the real audits (`samples/real/index.json`) take turns: each map replays its commits, holds, turns a quarter and hands over to the next (`setInsets({ top, bottom })` keeps the city under the headline); the city drifts slightly against the pointer.

### 6.3 Audit page: a map-first workspace (ui/workspace.js)

Pull-request ideas (branch, commits, diff, approve) are borrowed; the layout is built around the map.

- **Branch line** (under the title) follows the history bar: the task (head → base, commits, files, +/−), a commit of the task (*commit 2 of 6 · sha · files +/− · vs commit 1*), or any other commit (*branch · sha · files +/− · vs the commit before · before / while / after this task*), or a compared branch.
- **Header:** state pill ("N to decide" / Ready), title and request id, "agent wants to merge N commits into `<base ref>` from `<head ref>`", repo, +/−, tag (Sample data / Draft audit / Audited with IBM Bob), View on GitHub (PRs).
- **Layout:** three columns filling the window: tree (290 px) · map with the history bar under it · review panel (410 px); each can be switched off from the header (Shift+1 / Shift+3 / Shift+2). Under 960 px: map, review panel, tree stacked.
- **One question per region:** left *what changed* (the tree), map *where*, right *is it OK* (the verdict, or the commit / file in focus), bottom *how it unfolded* (the history bar). Nothing is repeated across regions.
- **Tree** (left, titled "What changed"): the folders view only.
  - *Folders*: the repository tree, kept quiet: a folder that only holds one folder is one row (`github/__toolsnaps__`); each folder shows one small bar of its changes (outside / inside / may be affected, rolled up) and their number, the details in its tooltip; requested folders are tinted; +/− counts are faint until hovered. Folders without changes and unchanged files are hidden behind "Show N unchanged files", busy folders are open. The tree follows the replay: files the current commit touches are lit, files changed only later are dimmed. Hover a row to outline its files on the canvas; click a folder to open/close it and fly the map to it; click a file to select it.
- **Review panel** (right; the verdict questions are described under *Verdict* below):
  - *File*: change i of n, name, path, badges, the plain-language explanation (title and sentence, when the audit has one), commit link; Approve / Revert (A / R, then the next undecided change is selected) and Next (J); why it was flagged; why it may be affected (affected files, with a link to the cause); the claims whose detail names it; what it may affect; screens; the diff (the commit's own diff when opened from a commit).
  - *Commit*: see *The commit on screen* and *any other commit* in the history bar.
  - *Claim*: verdict, detail, who decided it (git, test run, executed check, IBM Bob, nobody yet), the files named in the detail, the executable check (Run checks).
- **Requested area editor, runs, export:** as before (6.2); the editor also outlines the would-be fenced files on the canvas while editing.

### 6.4a Layers (ui/layers.js)

Every file has a **layer**, the role it plays, decided by path rules (an audit may set `file.layer`):

| Layer | Holds | Rule (first match) |
|---|---|---|
| `test` Tests | the checks | test folders (`tests/ __tests__/ spec/ e2e/ cypress/ playwright/`) or `*.test.* / *.spec.*`, or `isTest` |
| `ui` Screens | what users see | UI extensions (`tsx jsx vue svelte astro html css scss sass less styl erb hbs ejs njk twig liquid pug`) outside infra folders |
| `infra` Infra & config | env, build, CI, deploy, dependencies, docs | `.env*`, `Dockerfile`, compose files, `*.tf *.yaml *.toml *.md …`, manifests and lock files, tool configs, `config.* / env.*` modules, or anything under `.github/ infra/ terraform/ k8s/ helm/ deploy/ docker/ config/ env/ docs/ scripts/ tools/ bin/` |
| `server` Server & data | API, services, database | `api/ server/ backend/ services/ controllers/ routes/ handlers/ models/ db/ prisma/ migrations/ workers/ jobs/ …` |
| `ui` Screens | | UI folders (`components pages views screens ui templates layouts public static assets styles widgets frontend client web`) |
| `logic` App logic | shared code, state, helpers | `shared/ common/ utils/ helpers/ lib/ core/ hooks/ state/ store/ context/ types/ theme/ …` or any other code file |

A feature folder (district) takes the layer most of its files have (ties: the layer with more interesting files), so it is drawn once. Env and config modules (`.env*`, `env.*`, `config.*`, secrets, configmaps) get a purple outline: a change there changes how every environment runs.

### 6.4b 3D drawing (ui/atlas3d.js, with ui/iso.js)

- **Projection:** isometric, one lot = 1 ground unit (30 px), z in pixels; the view turns in quarter steps.
- **A file is a building.** Height = `(8 + 62·min(1.2, √(loc / p95 loc)))·lift`, where `lift = min(3, max(1, √(files / 150)))` so a large city seen from further away keeps its skyline (folder slabs thicken by the same factor); a changed, affected or approved file is at least `30·lift` tall, so a few-line change never reads as a pad on the ground (lines on that side at that replay step; a building grows when its commit lands). A **bright top band** is the share of its lines this task changed, `(plus + minus) / loc`, so a rewrite looks different from a tweak. Colour = verdict: pale glass unchanged, blue inside the request, red outside, amber may be affected (standing in a hatched ring), green approved, dashed outline reverted or new, a dashed empty lot where the file does not exist. A red **beacon** rises over undecided changes outside the request unless their risk is low; the `!` pin is red (high), orange (medium) or grey (low). Changes inside carry their commit number.
- **A folder is a block**; its real sub-folders are **parcels** on it (the folder's own files first, then busy sub-folders, then the rest, packed tightly), each file a lot in its parcel.
- **Large repositories:** below 11 px per lot, quiet parcels (nothing changed or affected, more than 2 files) are drawn as one massing block; zooming in opens them into buildings. Sub-folder names appear when zoomed in (≥ 0.9).
- **Connections:** dotted amber arcs with arrows from each change to each file that may be affected; selecting a file draws what it imports (solid blue) and what imports it (dashed purple), up to 40 each, from the `importedBy` graph in the evidence.
- **Labels** are drawn in screen space with collision avoidance, in this order: pins, fence tags, file names of changes (outside, then inside, then may be affected; only outside ones when zoomed far out), folder names, sub-folder names.
- **Replay** (▶ in the history bar): a replay frames every file the task touches once, then holds still; each commit rings its buildings (blue inside the request, red outside) and they rise to their height at that commit. There is no flying marker.

### 6.4c The tree (removed)

The 3D tree view and the flat card tree were removed: the workspace shows the city only, and the left pane is a plain file tree.

### 6.4e Branch history and the timeline

- **Header:** tag (sample / draft / real example / Bob), repo, state pill and title, the branch line (head → base, commits, files, +/−), and a status line with the review at a glance: a verdict pill that names the real issue (*Needs your review* when changes outside the request wait for a decision or the original tests fail, *Check the report* when claims are not backed by git, *Ready to merge* once every change is decided, *Looks clean* otherwise), its reasons in the tooltip only (the measures beside it already show them), then four measures as a label and a number (outside the request n / files, may be affected, report n / claims hold, original tests). Colour only where something needs attention; the details are in the tooltips. During a replay the pill shows the commit on screen (*Commit 3 of 6*, its message) and the two scope measures show the state at that commit (*so far*); numbers count to their new value. The line follows whatever the history bar has in focus: **a commit of another branch** (the pill names branch · sha and message; the measures become files changed, also changed by this task, lines, when) or **a compared branch** (the pill reads *Comparing …* with its PR; the measures become commits, files changed, also changed by this task, state); the pill's ✕ goes back to the task. Each part opens the matching verdict question; the pill pauses a running replay. Tools on the right: GitHub and three panel switches (folder tree, history bar, review panel; Shift+1 / Shift+3 / Shift+2). A file shows both its plain-language explanation and its code; there is no view switch. The choice is kept per browser.
- **Review panel** (right) shows one card at a time: a selected file or claim (with Approve / Revert, ← Back); else the commit the replay stands on; else the verdict. Branch information lives in the history bar under the map.
- **Why a file may be affected:** the collector keeps the import statement for every import of a changed file (`uses`). The file view shows the chain: 1 the file uses these names from the changed file (the statement), 2 this task changed that file in commit n, inside or outside the request (the changed lines that mention those names, else the exported lines), 3 so it may behave differently although nobody edited it. A change outside the request shows the same chain for every file it may affect; the map tooltip and the commit card say it in one line.
- **History bar** (always under the map, `ui/history-graph.js`): a control row: what is on screen, where the audited branch stands, and at the right end the player (a speed switch 1× · 2× · 0.5×, kept per browser, and one small ▶: at base or head it plays from the first commit, anywhere else it plays on from the commit on screen; ❚❚ pauses; Space does the same, ← / → still step; on the right where the audited branch stands: *PR #n · merged into main (when)*, *open, not merged yet*, *closed without merging*, *committed straight to main*, or *not merged into main yet*) over the branch picture from `graph`. Rows: up to three other branches of the same period (faded, named `#n branch` with a dot for its PR state when it has a pull request), the base branch, the audited branch. Commits run left to right at a fixed spacing, a parent always before its children, the task's commits with more room than the context around them. When the history is wider than the bar it **scrolls sideways** (drag, mouse wheel or trackpad, the ‹ › buttons at its ends, a thin scrollbar); it opens centred on the task (at its first commit when the task is wider than the bar), the branch names stay pinned on the left (click one to compare), and the replay keeps its current commit in view; forks and merges are curves, merges dashed. The task (base and every step) sits in a dashed band labelled "This task · n commits"; its commits are numbered, red when they leave the requested area, filled once the replay has passed them, and a playhead marks the current one. Where the task reached the base branch (`landed`) a green dashed line runs from head to that commit ("PR #n merged"); base-branch commits that merged a pull request are ringed in purple and name it in their card. The band is labelled with the audited PR ("PR #n · k commits") when there is one. Hovering any commit shows a card at once (message, sha, author, date, branch, files, what a click does). Clicking a commit of the task moves the replay; clicking **any other commit** opens it: the review panel shows what it changed against the commit before it (each file with +/−, its first changed lines from `peek`, the files this task also changed marked as a possible conflict), the map lights its files: each stands at full height (never folded into a massed parcel), purple when the task did not change it, named with its +/− at any zoom, with folder names counting *n in this commit* (the shared ones ringed and labelled *also changed by this task*); the file tree opens with an *In this commit* list (click a file to point at it on the map) above the task's own files, and marks the shared ones; ◀ Earlier / Later ▶ walk along its branch and *Compare the whole branch* opens the comparison. Clicking a branch's row or name opens **its first commit here** (for the base branch, the first after base) the same way: everything is shown against the commit before, and ← → or ▶ walk along that branch commit by commit. Comparing a whole branch with the task (files changed on both sides) is a button in that card (*Compare this branch with the task*). ← → walk the whole picture: the task's commits, then past base the base branch's earlier commits and past head its later ones. A merge inside the task's branch (the base branch merged in to stay current) is a dashed purple dot: on it the review panel shows what the merge brought in against the commit before (another branch's work, not judged against the request) and which of those files the task changes too, and the map lights those files. Audits without `graph` get a two-row picture from the steps.
- **Comparing a branch with the task:** the branch's row is lit (amber) and the rest of the picture dims; the review panel shows what that branch did while the task was open (for the base branch: since the task branched off, without the task's own landing) and the verdict *files changed on both sides* (a merge may conflict there) or *no file in common*, then its commits (each with its files and how many are shared; click one to narrow to it). On the map the branch's files are lit and the shared ones ringed ("changed on both sides"); in the tree the shared files are highlighted. The caption says what is compared; Stop comparing, Esc, a click on the audited branch, play or a step ends it.
- **The commit on screen** (any position between base and head, and every replay step): the review panel shows the commit card, which compares it with the one before: outside / inside / may be affected / files changed so far (before → after, with the difference), then each file of the commit with its state change (e.g. unchanged → outside the request, did not exist → …, or edited again), +/−, its first changed lines, and the files it newly reaches. On the map the commit's buildings get a lit ring and a dashed outline of their height before the commit (a new file: a dashed green lot), newly affected files an amber ring, everything else fades, and only these files are named. Nothing covers the map. Replay moves one commit every 3.2 s at 1× (a ring around ▶ fills until the next commit). No marker flies between commits (an earlier *Bob* marker was removed: the agent is not always Bob); the commit's buildings light up in place. The map frames every file the task touches once when a replay starts and then holds still, moving only if a commit's files are off screen; the commit card slides in, the history bar's playhead glides to the commit and the current commit pulses. The card has previous / play / next (next from the last commit returns to the verdict).

- **The canvas is the map only** (ui/atlas3d.js). How the change travels is told in the review panel and the history bar.
- **Verdict** (review panel at base or head, nothing selected): four questions, one line each with its answer (Did the agent stay inside the request? Is the report true? Do the original tests still pass? What do I do now?); one is open at a time, the first one with a problem by default. Their details: the scope bar and fence with Confirm / Edit area; the claims, worst first, each behind a verdict chip (false · partly true · unverified · holds), and the agent's report; the test command and Run; decision progress, Start review, Export, PR comment. The header status bar opens the matching question.

### 6.4d Canvas renderer (ui/atlas3d.js)

The workspace draws both canvases (Before and After) with `atlas3d.js` on a `<canvas>`; `map.js` supplies the layout (`layoutCity`). Same encoding as 6.4b, plus:

- **Light and material:** faces shaded by the way they face, ground shadows, rim light, haze in the distance; windows (lit at night in dark mode) when zoomed in.
- **Architecture:** app-logic and server files at least 34 px tall are set-back towers with a spire, test files are domed labs, the rest blocks with roof plant.
- **Alarms:** a pulsing red light beam and a map pin (colour by risk) over every undecided change outside the request; commit numbers over changes inside.
- **Fence:** posts and rails depth-sorted with the buildings; dashed while proposed, lit once the reviewer confirms it.
- **Ripple:** arcs with light flowing from a change to the files it may affect; when more than 24 are bundled they dim until a change is selected, which brings its own arcs forward.
- **Revert:** a reverted building sinks to its base height and leaves a dashed ghost of the height it had.
- **Changes only** (on by default): unchanged files fade; above 300 files they also step down to 60 % of their height (plus a little), so the work stands out while the city keeps its volume.
- **Depth:** the two visible walls of every box are shaded apart (lit ≈ 0.95, shaded ≈ 0.57), tops are brighter, and a thin highlight runs up the corner where the walls meet; buildings cast longer, darker ground shadows. Unchanged buildings have their own colour (`--bld`), lighter than the ground in the dark theme. A folder's slab keeps a light tint on top and takes the colour of its most pressing file state on its sides (red, blue, amber), so the buildings on it stay readable.
- **Before lens** (L, ◎): a magnifier that shows the base under the cursor; files that change are outlined in blue dashes.
- **Camera:** eased zoom and pan, pinch on touch; the city turns freely with Shift- or right-drag (Q / E, ⟳) and snaps to quarter turns. When the changed and may-be-affected files cover a small part of a large city, the workspace opens framed on them (with room around); the fit button switches between that view and the whole city. Camera and turn are kept when the canvas is remounted. The first view rises from back to front (skipped with reduced motion).
- **Survey grid** on the city: faint street lines (no compass, no edge letters or numbers).
- **Day:** the sky is dusk until the requested area is confirmed and brightens as decisions are made.
- **Edit the area on the map** (F, or Edit area): clicking a block or platform adds or removes it; every verdict is recomputed live (`withFence`) and the bar shows outside / affected / claims before → after, with Confirm, Cancel and "Pick folders…" (the dialog).
- **Scan:** a sweep of light while the original tests run.
- **Tree as a dashboard:** one band per role in the city's zone colours, the ground line between tests and server, and a card per band (sticky on the left, ≥ 720 px) with its folders, files and chips for outside / inside / affected; clicking a card flies to that band. Folder labels are placed before file tags, and file tags sit beside their buildings.

### 6.4 The map: codebase city (ui/map.js, 3D)

- **Zoning:** blocks are grouped into neighbourhoods by layer (Screens, App logic, Tests, Server & data, Infra & config), each with its own ground colour and name painted on the ground; neighbourhoods and their blocks are skyline-packed into a near-square city: each piece drops to the lowest free spot, several widths are tried and the smallest result kept; the order (requested blocks first, then by change score and size) is kept unless tallest-first saves more than 8% of the ground (`pack` in `ui/iso.js`). Streets between blocks, avenues between neighbourhoods.
- **Blocks:** one per district, slab coloured by the most pressing state of its files (red: a change outside the request, else blue: a change inside, else amber: may be affected) on its sides, with a light tint on top that grows with the share of its files involved, or the fence tint when requested; parcels and buildings as in 6.4b; the request fence (dashed rails and posts) around requested blocks, "PROPOSED FENCE" until the reviewer confirms it, then "REQUESTED AREA".
- **Block names** on the street in front of each block with the file count and `N !` for undecided changes outside the request.
- **Modes and layers:** Before · Compare (draggable divider) · After; a Layers menu with May affect (arcs) and Changes only. ⟳ turns the city a quarter; double-click zooms in.
- **Interaction** (both canvases): wheel zoom around the cursor, drag to pan, +/−/fit/turn, hover tooltip (path, verdict, lines, share changed, layer), click selects the file (inspector), tree hover outlines buildings, folder and commit clicks fly to their buildings. Both share `ui/viewport.js`.

### 6.5 Decisions, receipt, keys

- Approve / Revert toggle per review item (affected files act on their cause). A toast offers Undo for 4.5 s. Decisions persist per `meta.head` in `localStorage` (wrapped in try/catch).
- Receipt: requested files, live totals (outside, affected, API changes, tests rewritten), stamp "N DECISIONS LEFT" / "READY TO MERGE", Export decisions (JSON + apply command), Copy PR comment (local server: `POST /api/audits/<id>/receipt`).
- Keys: J / K move between items, A approve, R revert, Esc clears the selection (ignored while typing or in a dialog).
- A file shows its plain-language note (when the audit has one) above its facts and diff; there is no view switch.

### 6.6 Visual design

GitHub (Primer) look so the page feels familiar: system font stack, `ui-monospace` for code, 6 px radii, Primer colours (accent `#0969DA`, outside `#CF222E`, affected `#BF8700`, ok `#1A7F37`, open `#1F883D`, ready `#8250DF`; dark variants in `ui/styles.css`), Octicon-style inline icons. IBM Plex Sans Condensed only for the brand and home headline. Light and dark follow `prefers-color-scheme` until the viewer flips the switch in the top bar (one click toggles; the knob slides between sun and moon and colours ease over) (`data-theme` on `<html>`, kept in `localStorage` as `overlook.theme`); the map repaints on either change, and the Examples cards redraw their map snapshots for the new theme. No emoji decoration. Works at 390 px wide. `prefers-reduced-motion` stops route, ripple, pulse and Bob animations.

## 7. Bob Configuration

### 7.1 .bob/custom_modes.yaml

```yaml
customModes:
  - slug: overlook-auditor
    name: Overlook Auditor
    description: Audits a finished Bob task. Reads everything, writes only audit output.
    roleDefinition: >-
      You are Overlook Auditor. You audit a coding task another agent has already finished. You compare what
      was requested with what actually changed, check every claim in the agent's final report, and explain the
      impact in plain language. You never fix code.
    whenToUse: After a Bob task finishes and before merge, to produce out/audit.json.
    customInstructions: >-
      Evidence decides, Bob explains. Run the collector first and treat its output as the source of truth.
      Never edit source code, tests or configuration. Write only to out/. Follow .bob/rules-overlook-auditor/.
    groups:
      - read
      - - edit
        - fileRegex: "^out/.*\\.(json|md)$"
          description: Audit output files in out/ only
      - execute
      - mcp
      - skill
      - subagent
      - todo
```

### 7.2 Rules

- `.bob/rules/01-project.md`: commit after every sub-task with a short imperative message (the replay depends on it); never commit secrets; engine has no dependencies; UI is one static file.
- `.bob/rules-overlook-auditor/01-evidence-first.md`: the audit procedure. 1) find brief, agent report, base commit; 2) run the collector; 3) spawn subagents in parallel: fence (fence-mapper), claims (claim-extractor), plain language (business-translate), district labels; 4) write `out/audit.json` valid against the schema, claim text verbatim; 5) run build-city; 6) run pr-comment and show the receipt. Never edit outside `out/`; never mark a git-checkable claim true yourself; never soften a finding.

### 7.3 Skills (.bob/skills/<name>/SKILL.md, frontmatter name and description)

- **fence-mapper:** read the brief, list requested items quoting it, find where each is implemented by reading entry points, choose the smallest covering set of directories/files, keep shared code outside unless the brief asks for shared behaviour, write a one-sentence rationale quoting the brief.
- **claim-extractor:** split the report into atomic claims, keep text verbatim, classify type (see 3.2), give verdict + note only for `feature`.
- **business-translate:** title < 12 words, detail < 20 words, describe what customers or other teams notice, no code words, state risk plainly, never reassure without evidence ("Needs a check").

---

### 7.4 MCP server, commands, fixer

- `.bob/mcp.json` registers `node engine/mcp.mjs` as `overlook` with tools `overlook_collect`, `overlook_build` (publishes the audit and returns its map link), `overlook_fence` (confirm/change the requested area), `overlook_verify` (cross / reverts / checks), `overlook_receipt`, `overlook_apply` (dry run unless `dry_run: false`) and `overlook_audits`.
- Commands: `/audit <repo> <base> <brief> "<report>"`, `/verify <audit id> [kind] [decisions]`, `/fix-forward <audit id> [decisions]`, `/receipt <audit id> [decisions]`.
- Mode `overlook-fixer` (`.bob/rules-overlook-fixer/`): apply the reverts, run the tests, re-implement the request inside `fence.paths` only, never rewrite or weaken a test, commit per sub-task, then audit its own work.
- Skill `feature-check`: one executable check per feature claim, failing on base and passing on head if the claim holds; stored as `claims[].check = { command, why }` in `audit.json` (schema updated).
- `.bobignore` keeps `out/repos/`, `out/audits/` and generated sample JS out of Bob's context.

## 8. Acceptance Checklist

1. `npm test` passes (collector, verdicts, reverts, receipt, site API, MCP server).
2. Sample flow produces: 6 changed, 4 outside, 3 affected, claims `true`, `false`, `false`, `partial`; `npm run sample` leaves `samples/city.sample.json` unchanged.
3. `/sample` renders from a static host with the Sample data tag, no console errors, light and dark, at 390 px.
4. With `npm run site`: pasting a GitHub PR or repository link produces an audit that opens on the map without any form (a local folder works through the API and MCP).
5. Revert on the map → export → `apply-decisions` → re-audit shows one fewer pending item.
6. The Overlook Auditor mode cannot write outside `out/`.
7. No secrets in the repo.

---

## Appendix A. Brief GT-142

**GT-142 · Relative publish dates.** Requested by Product (Content team). Priority medium.

**Request:** Readers find absolute dates like "Wed Sep 23 2026" hard to scan. Show when an article was published as relative time, for example "3 days ago".

**Where:** Article list (home feed cards); Article page (header under the title).

**Out of scope:** other screens and the public API.

**Acceptance:** article list and article page show relative publish time; hovering the relative time shows the full date.
