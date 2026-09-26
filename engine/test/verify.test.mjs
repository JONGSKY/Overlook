import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { applyRuns } from '../core/city.mjs';
import { afterReverts, crossTests, detectTestCommand, runChecks } from '../verify.mjs';

function repoWithAgentChange() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'overlook-verify-repo-'));
  const g = (...a) => execFileSync('git', ['-C', dir, ...a], { stdio: 'pipe', env: { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' } });
  const w = (p, s) => { fs.mkdirSync(path.dirname(path.join(dir, p)), { recursive: true }); fs.writeFileSync(path.join(dir, p), s); };
  g('init', '-q', '-b', 'main');
  w('package.json', JSON.stringify({ type: 'module', scripts: { test: 'node --test' } }));
  w('src/price.mjs', 'export const total = (a, b) => a + b;\n');
  w('src/label.mjs', 'export const label = (n) => `$${n}`;\n');
  w('test/price.test.mjs', "import { test } from 'node:test';\nimport assert from 'node:assert/strict';\nimport { total } from '../src/price.mjs';\ntest('total', () => assert.equal(total(1, 2), 3));\n");
  g('add', '-A'); g('commit', '-qm', 'base');
  const base = g('rev-parse', 'HEAD').toString().trim();
  // The agent changes shared behaviour and rewrites the test to match.
  w('src/price.mjs', 'export const total = (a, b) => a + b + 1; // adds a fee\n');
  w('test/price.test.mjs', "import { test } from 'node:test';\nimport assert from 'node:assert/strict';\nimport { total } from '../src/price.mjs';\ntest('total', () => assert.equal(total(1, 2), 4));\n");
  w('src/label.mjs', 'export const label = (n) => `USD ${n}`;\n');
  g('add', '-A'); g('commit', '-qm', 'agent');
  const head = g('rev-parse', 'HEAD').toString().trim();
  return { dir, base, head };
}

test('detects the test command', () => {
  const { dir } = repoWithAgentChange();
  try {
    assert.equal(detectTestCommand(dir), 'npm test --silent');
    // A directory with no recognised config returns null.
    const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'overlook-detect-'));
    try {
      assert.equal(detectTestCommand(empty), null);
    } finally {
      fs.rmSync(empty, { recursive: true, force: true });
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('crossTests: an agent rewriting scripts.test to exit 0 cannot bypass the check', async () => {
  // Build a repo where the agent changes src and also sets package.json#scripts.test to "exit 0".
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'overlook-bypass-'));
  const g = (...a) => execFileSync('git', ['-C', dir, ...a], { stdio: 'pipe', env: { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' } });
  const w = (p, s) => { fs.mkdirSync(path.dirname(path.join(dir, p)), { recursive: true }); fs.writeFileSync(path.join(dir, p), s); };
  g('init', '-q', '-b', 'main');
  w('package.json', JSON.stringify({ type: 'module', scripts: { test: 'node --test' } }));
  w('src/calc.mjs', 'export const add = (a, b) => a + b;\n');
  w('test/calc.test.mjs', "import { test } from 'node:test';\nimport assert from 'node:assert/strict';\nimport { add } from '../src/calc.mjs';\ntest('add', () => assert.equal(add(1, 2), 3));\n");
  g('add', '-A'); g('commit', '-qm', 'base');
  const base = g('rev-parse', 'HEAD').toString().trim();

  // Agent: changes the source so original tests would fail, rewrites the test to match,
  // and replaces scripts.test with "exit 0" to hide the failure.
  w('src/calc.mjs', 'export const add = (a, b) => a + b + 10; // hidden fee\n');
  w('test/calc.test.mjs', "import { test } from 'node:test';\nimport assert from 'node:assert/strict';\nimport { add } from '../src/calc.mjs';\ntest('add', () => assert.equal(add(1, 2), 13)); // rewritten\n");
  w('package.json', JSON.stringify({ type: 'module', scripts: { test: "node -e 'process.exit(0)'" } }));
  g('add', '-A'); g('commit', '-qm', 'agent: break calc, rewrite test, hide via exit 0');
  const head = g('rev-parse', 'HEAD').toString().trim();

  try {
    const cross = await crossTests({ repo: dir, base, head });
    // crossTests restores the original test (assert.equal(add(1,2), 3)) and runs
    // the command from base (node --test), NOT the agent's "exit 0".
    // The original test must fail because the source now returns 13.
    assert.equal(cross.passed, false, 'bypass must be blocked: original test fails on tampered source');
    assert.deepEqual(cross.restoredTests, ['test/calc.test.mjs'], 'test file was restored from base');
    // The command must come from base, not the head "exit 0".
    assert.ok(cross.command !== "node -e 'process.exit(0)'", 'must not use the tampered test script');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('cross run: the original test fails on the new code; reverts make the task pass again', async () => {
  const { dir, base, head } = repoWithAgentChange();
  try {
    const cross = await crossTests({ repo: dir, base, head });
    assert.equal(cross.passed, false, 'base test on head code must fail');
    assert.deepEqual(cross.restoredTests, ['test/price.test.mjs']);

    const onlyCode = await afterReverts({ repo: dir, base, head, decisions: { 'src/price.mjs': 'revert' } });
    assert.equal(onlyCode.passed, false, 'reverting the code but keeping the rewritten test breaks the suite');

    const both = await afterReverts({ repo: dir, base, head, decisions: { 'src/price.mjs': 'revert', 'test/price.test.mjs': 'revert', 'src/label.mjs': 'approve' } });
    assert.equal(both.passed, true);
    assert.deepEqual(both.reverted, ['src/price.mjs', 'test/price.test.mjs']);

    const checks = await runChecks({ repo: dir, head, checks: [
      { text: 'Labels use USD.', command: "node -e \"import('./src/label.mjs').then(m => process.exit(m.label(1) === 'USD 1' ? 0 : 1))\"" },
      { text: 'Labels use $.',   command: "node -e \"import('./src/label.mjs').then(m => process.exit(m.label(1) === '$ 1'   ? 0 : 1))\"" },
    ] });
    assert.equal(checks[0].passed, true,  'passing check is true');
    assert.equal(checks[1].passed, false, 'failing check is false');
    assert.equal(typeof checks[1].exitCode, 'number', 'exit code captured');

    const city = { claims: [{ text: 'All tests pass.', type: 'tests_pass', verdict: 'partial', detail: 'x', evidence: ['test-diff'] }, { text: 'Labels use USD.', type: 'feature', verdict: 'unverified', evidence: ['bob-judgement'] }], totals: {} };
    const applied = applyRuns(city, { cross, checks });
    assert.equal(applied.claims[0].verdict, 'false');
    assert.match(applied.claims[0].detail, /original tests fail/);
    assert.equal(applied.claims[1].verdict, 'true');
    assert.deepEqual(applied.claims[1].evidence, ['check-run']);
    assert.equal(execFileSync('git', ['-C', dir, 'worktree', 'list']).toString().trim().split('\n').length, 1, 'worktrees are cleaned up');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
