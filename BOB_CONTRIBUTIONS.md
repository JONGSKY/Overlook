# Bob contributions

Files authored or substantially changed with IBM Bob, and the task session that shows it.
Add a row after each Bob task; the screenshot must exist in `bob_sessions/`.

| File or folder | Task session (bob_sessions/) | Bob feature | What Bob did |
|---|---|---|---|
| `SPEC.md`, `BOB_BUILD_PLAN.md`, `brief/GT-142.docx`, `AGENTS.md`, first `.bob/` configuration (commit `c79cf8d`) | `timehasdensity_task00_full_task_session.png` (task 00) | Agent mode, skill (`office-insights`), document creation | Wrote the English spec and the build plan, wrote the request brief as a Word document, and the first Auditor mode, rules and skills |
| `docs/PLAN.md` | `timehasdensity_task01_full_task_session.png` (task 01, plan) | Plan mode, document understanding | Read `brief/GT-142.docx` and `SPEC.md`; wrote the phase plan, done checks, acceptance matrix and Bobcoin budget |
| `.bob/custom_modes.yaml`, `.bob/rules/`, `.bob/rules-overlook-auditor/`, `.bob/skills/` (fence-mapper, claim-extractor, business-translate), `AGENTS.md` | `timehasdensity_task01_full_task_session.png` (P1 subtask) | Agent mode, subtask, custom modes, skills | Wrote its own configuration: the Overlook Auditor mode with a `fileRegex` write limit, the audit rules and three skills |
| `samples/make-sample-repo.sh`, `samples/audit.sample.json` | `timehasdensity_task01_full_task_session.png` (P2 subtask) | Agent mode, subtask | Scripted the GT-142 sample repository and its sample audit |
| `engine/collect.mjs` | `timehasdensity_task01_full_task_session.png` (P3 subtask) | Agent mode, subtask | Evidence collector: changed files, steps, test rewrites, import graph |
| `schema/audit.schema.json`, `engine/build-city.mjs` | `timehasdensity_task01_full_task_session.png` (P4 subtask) | Agent mode, subtask | The audit contract and the verdict, risk and ripple computation |
| `engine/pr-comment.mjs`, `engine/apply-decisions.mjs`, `engine/test/` | `timehasdensity_task01_full_task_session.png` (P5 subtask) | Agent mode, subtask | Receipt, one revert commit per file, node:test tests |
| `ui/index.html` (first version) | `timehasdensity_task01_full_task_session.png` (P6, P7 subtasks) | Agent mode, subtasks | Verdict bar, receipt, isometric city, replay, inspector |
| `engine/`, `samples/`, `ui/` (fix 1) | `timehasdensity_task01_full_task_session.png` (task 01) | Agent mode | Unchanged files collected, evidence tags, placeholders removed |
| `engine/`, `samples/`, `ui/` (fix 2) | `timehasdensity_task02_full_task_session.png` (task 02) | Agent mode | Repo-wide test collection, `{en, ko}` text, real line breaks in revert commits, UI fixes, samples regenerated |

Per-phase Task Ids and Bobcoins: [`docs/BOB_SESSIONS.md`](docs/BOB_SESSIONS.md).
