// verify.mjs — run the repository's own tests and checks, so "tests pass" is executed, not reported.
//
//   cross    the base version of the tests, run against the head code: do the original tests
//            still pass on what the agent delivered?
//   reverts  the reviewer's decisions applied to head (reverted files restored from base), then the
//            tests: does the result still work after the reverts?
//   checks   executable checks for feature claims (written by Bob in the audit), run on head.
//
// Everything runs in a throwaway git worktree; the user's working tree is never touched.

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { git, isTestPath } from './collect.mjs';

const TAIL = 60;

/** The command a project uses for its tests, or null. */
export function detectTestCommand(dir) {
  const pkgFile = path.join(dir, 'package.json');
  if (fs.existsSync(pkgFile)) {
    try {
      const t = JSON.parse(fs.readFileSync(pkgFile, 'utf8')).scripts?.test;
      if (t && !/no test specified/.test(t)) return 'npm test --silent';
    } catch { /* unreadable package.json */ }
  }
  if (fs.existsSync(path.join(dir, 'pytest.ini')) || fs.existsSync(path.join(dir, 'conftest.py'))) return 'python -m pytest -q';
  if (fs.existsSync(path.join(dir, 'pyproject.toml')) && /\[tool\.pytest/.test(fs.readFileSync(path.join(dir, 'pyproject.toml'), 'utf8'))) return 'python -m pytest -q';
  if (fs.existsSync(path.join(dir, 'go.mod'))) return 'go test ./...';
  if (fs.existsSync(path.join(dir, 'Cargo.toml'))) return 'cargo test';
  return null;
}

/**
 * Detect the test command from the BASE commit, not the agent's head.
 *
 * The attack: an agent changes package.json#scripts.test to "exit 0" (or
 * similar). If we run `npm test` on the head worktree, npm reads the current
 * package.json, so the tampered script runs instead of the real tests.
 *
 * The fix: read the *actual test command string* from the base package.json and
 * run it directly (bypassing `npm run`) — so the agent's rewrite of
 * scripts.test has no effect.
 */
function detectTestCommandAtBase(repo, baseSha, worktreeDir) {
  // Read package.json from base.
  try {
    const blob = git(repo, ['show', `${baseSha}:package.json`]);
    const pkg = JSON.parse(blob);
    const t = pkg.scripts?.test;
    if (t && !/no test specified/.test(t)) {
      // Run the original script body directly, not via `npm test`.
      // This means the agent rewriting scripts.test in the head commit has no effect.
      //
      // If the script body is a bare binary name (e.g. "vitest", "jest", "mocha") it is
      // only on PATH when npm sets it up — so prefix it with the local bin directory
      // so it works when run directly from a fresh worktree.
      if (/^[a-zA-Z0-9_-]+$/.test(t.trim())) {
        return `./node_modules/.bin/${t.trim()}`;
      }
      return t;
    }
  } catch { /* no package.json at base */ }
  // For other ecosystems the config files are not executable scripts, so they
  // cannot be trivially replaced with an always-exit-0 command.
  if (fs.existsSync(path.join(worktreeDir, 'pytest.ini')) || fs.existsSync(path.join(worktreeDir, 'conftest.py'))) return 'python -m pytest -q';
  if (fs.existsSync(path.join(worktreeDir, 'pyproject.toml')) && /\[tool\.pytest/.test(fs.readFileSync(path.join(worktreeDir, 'pyproject.toml'), 'utf8'))) return 'python -m pytest -q';
  if (fs.existsSync(path.join(worktreeDir, 'go.mod'))) return 'go test ./...';
  if (fs.existsSync(path.join(worktreeDir, 'Cargo.toml'))) return 'cargo test';
  return null;
}

function sh(command, cwd, timeoutMs) {
  return new Promise((ok) => {
    const started = Date.now();
    // A parent node:test run leaks NODE_TEST_CONTEXT, which makes a nested `node --test` exit 0.
    const { NODE_TEST_CONTEXT, ...env } = process.env;
    const child = spawn(command, { cwd, shell: true, env: { ...env, CI: '1', FORCE_COLOR: '0' } });
    let out = '';
    const take = (d) => { out = (out + d).slice(-200_000); };
    child.stdout.on('data', take);
    child.stderr.on('data', take);
    const timer = setTimeout(() => child.kill('SIGKILL'), timeoutMs);
    child.on('close', (code, signal) => {
      clearTimeout(timer);
      const lines = out.replace(/\x1b\[[0-9;]*m/g, '').trimEnd().split('\n');
      ok({ command, exitCode: signal ? null : code, timedOut: signal === 'SIGKILL', passed: code === 0 && !signal, durationMs: Date.now() - started, output: lines.slice(-TAIL).join('\n') });
    });
  });
}

function needsInstall(dir) {
  const pkgFile = path.join(dir, 'package.json');
  if (!fs.existsSync(pkgFile) || fs.existsSync(path.join(dir, 'node_modules'))) return false;
  const pkg = JSON.parse(fs.readFileSync(pkgFile, 'utf8'));
  return Object.keys({ ...pkg.dependencies, ...pkg.devDependencies }).length > 0;
}

/** Check out `rev` in a temporary worktree, let `prepare` edit it, run `command`, clean up. */
export async function inWorktree({ repo, rev, prepare, command, install = true, timeoutMs = 10 * 60_000 }) {
  repo = path.resolve(repo);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'overlook-verify-'));
  git(repo, ['worktree', 'add', '--detach', '--force', dir, rev]);
  try {
    await prepare?.(dir);
    const cmd = command || detectTestCommand(dir);
    if (!cmd) return { skipped: true, reason: 'No test command found (package.json "test", pytest, go test or cargo test). Pass one explicitly.' };
    let setup = null;
    if (install && needsInstall(dir)) {
      const hasLock = fs.existsSync(path.join(dir, 'package-lock.json'));
      setup = await sh(hasLock ? 'npm ci --no-audit --no-fund' : 'npm install --no-audit --no-fund', dir, timeoutMs);
      // npm ci fails when the lock file is out of sync (e.g. the base commit has a different lock).
      // Fall back to npm install so the test can still run.
      if (!setup.passed && hasLock) setup = await sh('npm install --no-audit --no-fund', dir, timeoutMs);
      if (!setup.passed) return { ...setup, passed: false, phase: 'install' };
    }
    const run = await sh(cmd, dir, timeoutMs);
    return { ...run, rev, ...(setup ? { installMs: setup.durationMs } : {}) };
  } finally {
    try { git(repo, ['worktree', 'remove', '--force', dir]); } catch { fs.rmSync(dir, { recursive: true, force: true }); }
  }
}

const exists = (repo, rev, p) => {
  try { git(repo, ['cat-file', '-e', `${rev}:${p}`]); return true; } catch { return false; }
};

/** The original tests (as at base) run against the head code. */
export async function crossTests({ repo, base, head, command, install }) {
  const changedTests = git(repo, ['diff', '--name-only', base, head]).split('\n').filter((p) => p && isTestPath(p));
  // Determine the test command from the BASE commit, not from the agent's head code.
  // An agent that changes package.json#scripts.test to "exit 0" (or similar) would
  // otherwise make crossTests always pass even when the original tests actually fail.
  const cmd = command || detectTestCommandAtBase(repo, base, path.resolve(repo));
  const restored = [];
  const result = await inWorktree({
    repo, rev: head, command: cmd, install,
    prepare: (dir) => {
      for (const p of changedTests) {
        if (exists(repo, base, p)) { git(dir, ['checkout', base, '--', p]); restored.push(p); }
      }
    },
  });
  return { kind: 'cross', ...result, restoredTests: restored };
}

/** Head with the reviewer's reverts applied (file restored from base, or removed if it did not exist). */
export async function afterReverts({ repo, base, head, decisions, command, install }) {
  const reverted = Object.entries(decisions ?? {}).filter(([, d]) => d === 'revert').map(([p]) => p);
  const result = await inWorktree({
    repo, rev: head, command, install,
    prepare: (dir) => {
      for (const p of reverted) {
        if (exists(repo, base, p)) git(dir, ['checkout', base, '--', p]);
        else fs.rmSync(path.join(dir, p), { force: true });
      }
    },
  });
  return { kind: 'reverts', ...result, reverted };
}

/** Executable checks for feature claims: [{ text, command }] run on head. */
export async function runChecks({ repo, head, checks, install }) {
  const results = [];
  for (const c of checks ?? []) {
    const r = await inWorktree({ repo, rev: head, command: c.command, install });
    results.push({ text: c.text, ...r, command: c.command });
  }
  return results;
}
