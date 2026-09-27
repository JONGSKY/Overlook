# AGENTS.md: Overlook

## Mission
Overlook audits a coding task an AI agent has already finished. It answers three questions: what changed, how that compares with what was requested, and whether the agent's report is true.

## Principle
**Evidence decides, Bob explains.** Facts are computed from git by deterministic code in `engine/`. Bob draws the request fence, splits the report into claims and explains impact in plain language. Bob never decides a fact that git can check.

## Commands
- `npm test`: all tests (node:test, no dependencies)
- `npm run site`: the site and its local API at http://localhost:4280
- `npm run mcp`: the Overlook MCP server over stdio (configured in `.bob/mcp.json`)
- `npm run sample`, `npm run examples`, `npm run real`: regenerate the sample, the scripted examples and the real audits after engine changes

## Layout
- `engine/collect.mjs`: git → `evidence.json` (files, commits, branch graph)
- `engine/build-city.mjs`: evidence + audit → `city.json` (verdicts, risks, ripple)
- `engine/pr-comment.mjs`: city (+ decisions) → receipt markdown
- `engine/apply-decisions.mjs`: decisions → one revert commit per file
- `engine/site.mjs`, `engine/sources.mjs`, `engine/draft-audit.mjs`: local site API, GitHub links (PR, issue, latest task), draft audits
- `engine/mcp.mjs`: MCP tools for Bob
- `ui/`: static site (`index.html`, `app.js` main + routes, `workspace.js`, `atlas3d.js` the map, `history-graph.js` the branch history, `styles.css`)
- `schema/audit.schema.json`: contract for Bob's `audit.json`
- `samples/`: scripted GT-142 repo and its sample audit, `examples/` scripted examples, `real/` real audits of public agent tasks

## Conventions
- Node.js 22+, ES modules, no runtime npm dependencies. The only npm package is `dugite`, a devDependency the Vercel build uses to bundle git (`scripts/vercel-build.mjs`).
- UI text is English. The UI must work from a static host (sample only) and from the local server.
- Data contracts are in `SPEC.md` section 3. Update the SPEC and the schema before changing a contract.
- Commit after every sub-task with a short imperative message.
- Audits write only to `out/` (gitignored).
