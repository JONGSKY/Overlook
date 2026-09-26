# From prototype to Overlook

This repository holds two stages of the same project.

1. **Prototype** (`a4470d9` … `326b571`, Sep 26): planned and built with IBM Bob 2.0 in two tasks. How it was built is recorded in [`bob_sessions/`](../bob_sessions/), [`docs/BOB_SESSIONS.md`](BOB_SESSIONS.md) and [`docs/PLAN.md`](PLAN.md). The handoff notes from that stage are in [`docs/prototype/`](prototype/).
2. **Current version** (imported from [JONGSKY/Overlook](https://github.com/JONGSKY/Overlook), last commit `d14e2ae`, Sep 27): the prototype grown into a map-first audit tool. Its commit history was merged into this repository with authorship kept.

## How IBM Bob 2.0 was used

Bob 2.0 was used at every stage: to plan the project, to build it, and as the engine of the product itself.

| Stage | Bob 2.0 feature | What Bob did |
|---|---|---|
| Plan | **Plan mode**, **document understanding** | Read the request brief `brief/GT-142.docx` and `SPEC.md`, and wrote [`docs/PLAN.md`](PLAN.md): eight phases, the files per phase, a done check per phase, the acceptance matrix, Bob feature coverage, a Bobcoin budget and risks |
| Build | **Agent mode**, **subtasks** | Ran phases P1–P7 as seven subtasks, each in a fresh context: Bob configuration, the scripted sample repository, the evidence collector, the schema and city builder, the receipt, revert and tests, and the UI. 13 commits |
| Build | **Todo lists**, **commit messages** | Kept a checklist in every subtask and committed after every phase |
| Fix | **Agent mode**, two team accounts | Fix 1 and fix 2 from the review: repo-wide test collection, `{en, ko}` text, real line breaks in revert commits, UI fixes, samples regenerated |
| Configure | **Custom modes**, **mode rules**, **skills**, **AGENTS.md** | Bob wrote its own configuration in P1: the `overlook-auditor` mode with a `fileRegex` write limit, the audit rules, the `fence-mapper`, `claim-extractor` and `business-translate` skills |
| Run | **Parallel subagents**, **MCP**, **slash commands** | In the product, the Auditor mode reads the brief, runs four subagents at once (fence, claims, checks, plain language), calls the Overlook MCP tools, and the Fixer mode fixes forward inside the requested area |

Three Bob accounts were used: task 00 (7.00 Bobcoins) started the repository, and tasks 01 and 02 used their full 40-Bobcoin budgets: **86.50 Bobcoins** in total, with Task Ids, per-phase usage and session summary screenshots in [`bob_sessions/`](../bob_sessions/) and [`docs/BOB_SESSIONS.md`](BOB_SESSIONS.md).

## History of the current version

| Commit | Date (KST) | What happened |
|---|---|---|
| `e054556`, `c79cf8d` | Sep 26 17:19–17:31 | New repository. Bob (task 00, JONGSKY's account) wrote the spec, the build plan, the request brief `brief/GT-142.docx` and the first Bob configuration |
| `f4d630f` … `ff73a41` | Sep 26 18:38–19:17 | A different direction, **Flowreel** (scaffolded by Bob in task 00, `f4d630f`): record base and head at runtime, diff the execution graphs, narrate the difference with a fact checker, React Flow viewer |
| `ccc70ca` | Sep 27 03:42 | Flowreel dropped. Overlook rebuilt from the prototype's design and contracts (collector, city builder, receipt, revert, schema, sample GT-142) in one commit of 156 files |
| `d14e2ae` | Sep 27 05:30 | Final version: merged pull-request branches restored and every commit shown against the one before, import graph for Go and Python, map-only workspace (tree view and GitHub Pages workflow removed), fewer real audits |

The current version keeps the prototype's principle, **evidence decides, Bob explains**, the `overlook-auditor` mode, the three skills, the GT-142 sample and the data flow `collect → build-city → receipt → apply-decisions`.

## What changed from the prototype

### Engine

| Prototype | Current version |
|---|---|
| `collect.mjs`: changed files, steps, test rewrites, import graph (JS/TS) | Also a branch graph (base branch, audited branch, other branches of the period, pull requests, merges as steps of their own), any commit against the one before, import graph for JS/TS, Go and Python |
| `build-city.mjs`: verdicts, risks, ripple | Logic moved to `engine/core/city.mjs`, a pure module with no Node APIs, shared by the CLI, the local site, the MCP server and the browser (live fence edits) |
| Tests were reported by the agent | `verify.mjs` runs them: the **original** tests against the agent's code in a throwaway worktree, and the tests again with the reviewer's reverts applied |
| Input was a local repo and two SHAs | `sources.mjs`: paste a GitHub pull request, compare, commit or repository URL, or pick a local folder; a merged pull request is audited from its own branch |
| Audit needed Bob | `draft-audit.mjs` builds a draft audit from the typed request and report; Bob's `out/audit.json` replaces it |
| CLI only | `site.mjs`: local site and API on `127.0.0.1:4280` (`npm run site`); `audits.mjs` keeps saved audits |
| — | `mcp.mjs`: MCP server with `overlook_collect`, `overlook_build`, `overlook_fence`, `overlook_verify`, `overlook_receipt`, `overlook_apply`, `overlook_audits` |
| — | `scan.mjs`: the same rules run over 22 public agent pull requests through the GitHub API ([`docs/measurements.md`](measurements.md)) |

### Bob configuration

| Prototype | Current version |
|---|---|
| `overlook-auditor` writes `out/*.json` and `out/*.md` | Also `out/*.sh` and `out/*.mjs` for executable checks; uses the MCP server |
| — | New mode `overlook-fixer`: after a review, re-implements the request inside the requested area only and never weakens a test |
| 3 skills | 4 skills: `feature-check` added, which turns a feature claim into a check whose exit code decides the verdict |
| Auditor proposes the fence and it is final | Auditor proposes the fence, a person confirms or edits it on the map, verdicts are recomputed |
| — | Slash commands `/audit`, `/verify`, `/fix-forward`, `/receipt` (`.bob/commands/`) and `.bob/mcp.json` |

### UI

| Prototype | Current version |
|---|---|
| One `ui/index.html` with an isometric city, verdict bar, receipt and inspector | A static site split into modules (`app.js`, `workspace.js`, `atlas3d.js`, `history-graph.js`, `map.js`, `iso.js`, …), still with no build step |
| Isometric city | A 3D city zoned by file role (screens, app logic, tests, server and data, infra and config), with the requested area fenced in blue and a Layers menu |
| Replay of steps | Replay commit by commit; Before / Compare / After; a branch history bar where any commit on any branch drives the whole workspace |
| Receipt and approve/revert | Workspace with one question per region: verdict line on top, changed files on the left, map, a card on the right (the four questions, a file with **Approve / Revert**, or a commit), branch history below |

### Samples, tests and delivery

- Samples: GT-142 plus three scripted examples (`infra-drift`, `monorepo-scale`, `clean-pass`) and three audits of real public agent tasks (`samples/real/`).
- Tests: 45 `node:test` tests (collector, branch graph, merges, imports, verdicts, reverts, receipt, site API, MCP server, scan). The prototype's `apply`, `export` and `pipeline` tests were removed because they target the prototype's APIs.
- Delivery: GitHub Actions CI (`.github/workflows/ci.yml`), MIT `LICENSE`, `docs/architecture.md`, `docs/metrics.md`, `docs/measurements.md`.

