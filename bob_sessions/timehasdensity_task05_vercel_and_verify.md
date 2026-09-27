# Task 05 · Vercel deployment + /verify on real example

**Account:** Jeong Hae Jun · **Date:** Sep 27, 2026 · **Mode:** Agent · **Task Id:** `f5f78301537c791815c9daf473fdbf71` · **Bobcoins:** 21.02

---

## What was asked

Two items from the priority table:

1. **★★★ Deploy to Vercel** — make the project accessible from a public URL. Analyse the codebase, then add Vercel Serverless Functions for every API endpoint and adapt the filesystem usage for Vercel's ephemeral environment.
2. **★★★ Run `/verify` on a real example** — execute the original tests against the head code on `atlas-production-fixes` so the `tests_pass` claim shows `true` instead of "Not run".

---

## What was done

### Step 1 — Analysis (before any code change)

Read every relevant source file: `engine/site.mjs`, `engine/sources.mjs`, `engine/audits.mjs`, `engine/verify.mjs`, `ui/app.js`, `ui/workspace.js`, `vercel.json`, `package.json`, all sample city files, and `bob_sessions/README.md`.

Findings:
- No build step. UI is plain HTML + ES modules served from `ui/`.
- Backend is a single Node.js `http.createServer` in `engine/site.mjs`, always-on, bound to `127.0.0.1:4280`.
- All API work uses `child_process` to run git (clone, fetch, log, diff) and the filesystem for clone storage (`out/repos/`) and saved audits (`out/audits/`).
- `vercel.json` already had SPA rewrites but no API routing.

### Step 2 — Vercel deployment

**Files created:**

| File | Purpose |
|------|---------|
| `api/health.mjs` | `GET /api/health` |
| `api/source.mjs` | `POST /api/source` — clone + commit list |
| `api/audit.mjs` | `POST /api/audit` — full pipeline |
| `api/audits.mjs` | `GET /api/audits` |
| `api/audits/[id].mjs` | `GET/POST /api/audits/<id>` + `/receipt` + `/fence` (no `/verify`) |
| `.env.example` | Documents `GITHUB_TOKEN` |

**Files modified:**

| File | Change |
|------|--------|
| `vercel.json` | Added `functions.maxDuration: 60`, sub-path rewrites for `receipt`/`fence`/`verify` |
| `engine/audits.mjs` | `VERCEL=1` → store audits in `/tmp/overlook-audits/` instead of `out/audits/` |
| `engine/sources.mjs` | `VERCEL=1` → clone repos into `/tmp/overlook-repos/` instead of `out/repos/` |
| `package.json` | Added `"build": "echo 'No build step…'"` so Vercel finds a build script |

### Step 3 — `/verify` on atlas-production-fixes

**Problem discovered:** `detectTestCommandAtBase` returned `"vitest"` (the raw `scripts.test` value), but `sh` runs commands in a bare shell where `./node_modules/.bin` is not on PATH. Result: `exit 127, command not found`.

**Fixes in `engine/verify.mjs`:**
1. `inWorktree`: if `npm ci` fails (lock file out of sync), retry with `npm install` before giving up.
2. `detectTestCommandAtBase`: if the script body is a bare binary name with no path or arguments, prepend `./node_modules/.bin/` so it runs from the worktree.

**Result:** `crossTests({ repo: atlas, base, head })` → **78 tests, 4 test files, all passed**.

City updated: `samples/real/atlas-production-fixes.city.json` now contains `runs.cross` with `passed: true` and `command: "./node_modules/.bin/vitest"`. The `tests_pass` claim verdict changed from `unverified` to `true`. `claimsTrue` went from 2 to 3 (out of 4).

---

## Commits

| Commit | Message |
|--------|---------|
| `11db229` | Add Vercel Serverless Functions and /tmp storage for hosted deployment |
| `33c67ec` | Run crossTests on atlas: 78 tests pass, tests_pass claim verified true |
| `b0457bf` | Record task 05 in bob_sessions/ |

---

## Test results

`npm test` after all changes: **47 / 47 pass, 0 fail**.

---

## Limitations left

| Feature | Status on Vercel |
|---------|-----------------|
| GitHub PR/compare audit | ✅ Full support |
| Local folder audit | ❌ Requires local server |
| Audit history persistence | ⚠️ `/tmp` only — ephemeral per function instance |
| `/verify` (cross-test, reverts, checks) | ❌ Requires local git worktree |
| MCP server | ❌ Always-on process, not deployable as serverless |
