# Overlook Auditor: evidence-first audit procedure

Follow this procedure every time you audit a task. **Evidence decides, Bob explains.**
You propose; a person confirms the requested area; git and executed tests decide.

## 1. Gather inputs
- The **request brief** (for the demo: `brief/GT-142.docx`; read it with document understanding).
- The **agent's final report**, verbatim.
- The **repository** and the **base commit** (the commit before the agent started). If either is missing, ask.

## 2. Collect evidence
`overlook_collect { repo, base, head?, src? }` (fallback: `node engine/collect.mjs ...`). Read `out/evidence.json`.
It is the source of truth; never contradict it.

## 3. Spawn four subagents in parallel
- **fence**: `fence-mapper` skill. The smallest set of paths the brief covers, a rationale quoting the brief,
  and the paths you are unsure about.
- **claims**: `claim-extractor` skill. Atomic claims, verbatim text, typed.
- **checks**: `feature-check` skill. For every `feature` claim, one executable check that exits 0 only if the
  claim holds on head. Write each check as `out/checks/<n>-<slug>.sh` (or `.mjs`) and reference it from the claim.
- **plain**: `business-translate` skill. Plain-language title and detail for every changed and possibly affected
  file, plus a short label for each district path in the evidence.

## 4. Write `out/audit.json`
Valid against `schema/audit.schema.json`.
- `claims[].text` must be a verbatim substring of the report.
- Git-checkable claim types (`scope`, `no_api_change`, `tests_pass`, `no_new_files`, `only_files`) get
  **no verdict** from you. The engine computes them.
- `feature` claims carry `check: { command, why }`. Add a verdict and note only when no check is possible.

## 5. Build, confirm the area, run the tests
1. `overlook_build {}` returns the map link. Give it to the user.
2. Show the proposed requested area and the paths you were unsure about. **Ask the user to confirm or edit it**
   (on the map, or tell you the paths); then call `overlook_fence { audit_id, paths }`.
3. `overlook_verify { audit_id, kind: "cross" }`: the original tests against the new code.
4. `overlook_verify { audit_id, kind: "checks" }` when feature claims have checks.
5. `overlook_receipt { audit_id, out: "out/receipt.md" }` and show the receipt.

## Hard constraints
- Never edit anything outside `out/`.
- Never mark a git-checkable claim true or false yourself; never override an executed result.
- Never soften a finding. If the evidence shows a problem, say it plainly.
- Reverts happen only through `overlook_apply` after a person exported decisions; run it as a dry run first.
