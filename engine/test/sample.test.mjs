// End-to-end test on the scripted GT-142 sample repo (SPEC 4.5, 8).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { collect, isApiPath, isTestPath, resolveImport, importSpecifiers, analyzeTestDiff, parseDiff } from '../collect.mjs';
import { buildCity, districtOf, inFence } from '../build-city.mjs';
import { applyDecisions } from '../apply-decisions.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const SCRIPT = path.join(ROOT, 'samples/make-sample-repo.sh');
const AUDIT = JSON.parse(fs.readFileSync(path.join(ROOT, 'samples/audit.sample.json'), 'utf8'));

// Keep git in this process independent of the machine's config and identity.
process.env.GIT_CONFIG_NOSYSTEM = '1';
process.env.GIT_CONFIG_GLOBAL = '/dev/null';
Object.assign(process.env, {
  GIT_AUTHOR_NAME: 'Overlook Test', GIT_AUTHOR_EMAIL: 'test@example.com',
  GIT_COMMITTER_NAME: 'Overlook Test', GIT_COMMITTER_EMAIL: 'test@example.com',
});

let tmp, repo, BASE, HEAD, evidence, city;

function makeSample(dir) {
  const out = execFileSync('bash', [SCRIPT, dir], { encoding: 'utf8' });
  return {
    base: out.match(/^BASE=([0-9a-f]{40})$/m)[1],
    head: out.match(/^HEAD=([0-9a-f]{40})$/m)[1],
  };
}
const gitIn = (dir, ...args) => execFileSync('git', ['-C', dir, ...args], { encoding: 'utf8' });

before(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'overlook-test-'));
  repo = path.join(tmp, 'gt142-sample-app');
  ({ base: BASE, head: HEAD } = makeSample(repo));
  evidence = collect({ repo, base: BASE, head: HEAD, src: '.' });
  city = buildCity(evidence, AUDIT);
});

after(() => fs.rmSync(tmp, { recursive: true, force: true }));

test('sample script is reproducible and matches the committed sample data', () => {
  const again = makeSample(path.join(tmp, 'again', 'gt142-sample-app'));
  assert.equal(again.base, BASE);
  assert.equal(again.head, HEAD);
  const sample = JSON.parse(fs.readFileSync(path.join(ROOT, 'samples/city.sample.json'), 'utf8'));
  assert.equal(sample.meta.head, HEAD, 'regenerate samples/city.sample.json (see samples/make-sample-repo.sh header)');
  assert.deepEqual(sample, JSON.parse(JSON.stringify(city)), 'samples/city.sample.json is stale');
});

test('sample script refuses a non-empty target', () => {
  assert.throws(() => execFileSync('bash', [SCRIPT, repo], { stdio: 'pipe' }), (err) => err.status === 1);
});

test('collect: six changed files, six steps, formatDate numbers', () => {
  const changed = evidence.files.filter((f) => f.status !== 'unchanged');
  assert.equal(changed.length, 6);
  assert.equal(evidence.steps.length, 6);
  const fd = evidence.files.find((f) => f.path === 'src/shared/utils/formatDate.ts');
  assert.deepEqual([fd.status, fd.locBefore, fd.locAfter, fd.plus, fd.minus, fd.step], ['modified', 4, 6, 3, 1, 2]);
  assert.deepEqual(fd.importedBy, [
    'src/articles/ArticleMeta.tsx', 'src/articles/ArticlePreview.tsx', 'src/comments/CommentCard.tsx',
    'src/profiles/ProfileArticles.tsx', 'tests/formatDate.spec.ts',
  ]);
  const rt = evidence.files.find((f) => f.path === 'src/shared/utils/relativeTime.ts');
  assert.equal(rt.status, 'added');
  assert.equal(rt.step, 1);
});

test('collect: tests/formatDate.spec.ts is rewritten', () => {
  const spec = evidence.files.find((f) => f.path === 'tests/formatDate.spec.ts');
  assert.equal(spec.isTest, true);
  assert.deepEqual(spec.test, { assertionsRemoved: 1, assertionsAdded: 1, skipsAdded: 0, rewritten: true, weakened: false });
  assert.ok(spec.diff.some(([k, t]) => k === 'd' && t.includes("toBe('Sep 23, 2026')")));
  assert.ok(spec.diff.some(([k, t]) => k === 'a' && t.includes('toMatch(/ago|today/)')));
});

test('city: 6 changed, 4 outside, 3 affected', () => {
  assert.equal(city.totals.filesChanged, 6);
  assert.equal(city.totals.outside, 4);
  assert.equal(city.totals.affected, 3);
  const affected = city.files.filter((f) => f.kind === 'affected');
  assert.deepEqual(Object.fromEntries(affected.map((f) => [f.path, f.causes])), {
    'src/api/articles.controller.ts': ['src/api/articles.serializer.ts'],
    'src/comments/CommentCard.tsx': ['src/shared/utils/formatDate.ts'],
    'src/profiles/ProfileArticles.tsx': ['src/shared/utils/formatDate.ts'],
  });
  assert.deepEqual(city.files.filter((f) => f.kind === 'in').map((f) => f.path),
    ['src/articles/ArticleMeta.tsx', 'src/articles/ArticlePreview.tsx']);
});

test('city: items sorted by risk then step, with reasons', () => {
  assert.deepEqual(city.items.map((i) => [i.id, i.file, i.risk, i.reasons]), [
    ['i1', 'src/shared/utils/formatDate.ts', 'high', ['ripple']],
    ['i2', 'src/api/articles.serializer.ts', 'high', ['api_contract', 'ripple']],
    ['i3', 'tests/formatDate.spec.ts', 'high', ['test_rewritten']],
    ['i4', 'src/shared/utils/relativeTime.ts', 'low', ['additive']],
  ]);
  assert.equal(city.items[0].facts,
    'modified outside the request fence, +3 −1. changes the output of 2 file(s) it is imported by: CommentCard.tsx, ProfileArticles.tsx.');
  assert.equal(city.steps.length, 8);
  assert.equal(city.steps[0].message, 'Task received');
  assert.equal(city.steps.at(-1).message, 'Done');
});

test('city: claim verdicts are computed from git', () => {
  assert.deepEqual(city.claims.map((c) => c.verdict), ['true', 'false', 'false', 'partial']);
  // A git-checkable claim marked true by the audit is still checked by code.
  const lying = { ...AUDIT, claims: AUDIT.claims.map((c) => ({ ...c, verdict: 'true' })) };
  assert.deepEqual(buildCity(evidence, lying).claims.map((c) => c.verdict), ['true', 'false', 'false', 'partial']);
});

test('city: every district has a label and only src/articles/ is fenced', () => {
  assert.deepEqual(city.districts.filter((d) => d.inFence).map((d) => d.id), ['src/articles/']);
  for (const d of city.districts) assert.ok(AUDIT.districts.some((a) => a.path === d.id), `no audit label for ${d.id}`);
});

test('audit sample: plain language for every changed and affected file', () => {
  const need = city.files.filter((f) => f.kind !== 'none').map((f) => f.path);
  for (const p of need) {
    const entry = AUDIT.plain[p];
    assert.ok(entry, `missing plain entry for ${p}`);
    assert.ok(entry.title.en.split(/\s+/).length < 12, `title too long: ${p}`);
    assert.ok(entry.detail.en.split(/\s+/).length < 20, `detail too long: ${p}`);
    assert.ok(entry.title.ko && entry.detail.ko, `missing Korean for ${p}`);
  }
  for (const c of AUDIT.claims) assert.ok(AUDIT.bobReport.includes(c.text), `claim not verbatim: ${c.text}`);
});

test('apply-decisions: dry run changes nothing, dirty tree is refused', () => {
  const decisions = { base: BASE, head: HEAD, decisions: { 'src/api/articles.serializer.ts': 'revert' } };
  const res = applyDecisions({ repo, decisions, dryRun: true });
  assert.equal(res.planned.length, 1);
  assert.equal(gitIn(repo, 'rev-parse', 'HEAD').trim(), HEAD);

  fs.appendFileSync(path.join(repo, 'src/feed/FeedTabs.tsx'), '\n// wip\n');
  assert.throws(() => applyDecisions({ repo, decisions }), /dirty/);
  gitIn(repo, 'checkout', '--', 'src/feed/FeedTabs.tsx');
});

test('apply-decisions: revert commit restores the serializer, re-run shows one fewer item', () => {
  const decisions = {
    base: BASE, head: HEAD,
    decisions: { 'src/api/articles.serializer.ts': 'revert', 'src/shared/utils/relativeTime.ts': 'approve' },
  };
  const { commits } = applyDecisions({ repo, decisions });
  assert.equal(commits.length, 1);
  assert.equal(gitIn(repo, 'log', '-1', '--format=%s').trim(), 'overlook: revert src/api/articles.serializer.ts');
  assert.equal(gitIn(repo, 'rev-parse', 'HEAD~1').trim(), HEAD);
  assert.equal(
    fs.readFileSync(path.join(repo, 'src/api/articles.serializer.ts'), 'utf8'),
    gitIn(repo, 'show', `${BASE}:src/api/articles.serializer.ts`),
  );
  assert.equal(gitIn(repo, 'status', '--porcelain').trim(), '');

  const rerun = buildCity(collect({ repo, base: BASE, src: '.' }), AUDIT);
  assert.equal(rerun.items.length, city.items.length - 1);
  assert.ok(!rerun.items.some((i) => i.file === 'src/api/articles.serializer.ts'));
  assert.equal(rerun.totals.affected, 2);
  assert.equal(rerun.claims.find((c) => c.type === 'no_api_change').verdict, 'true');
});

test('analyzeTestDiff edge cases', () => {
  // Only assertions added (new test file): not rewritten, not weakened.
  const onlyAdd = analyzeTestDiff(parseDiff('@@ -0,0 +1,3 @@\n+expect(a).toBe(1);\n+expect(b).toBe(2);\n+expect(c).toBe(3);\n'));
  assert.deepEqual(onlyAdd, { assertionsRemoved: 0, assertionsAdded: 3, skipsAdded: 0, rewritten: false, weakened: false });

  // Only skips added: weakened even without removed assertions.
  const onlySkip = analyzeTestDiff(parseDiff('@@ -1 +1 @@\n-it("x", () => {});\n+it.skip("x", () => {});\n'));
  assert.equal(onlySkip.skipsAdded, 1);
  assert.equal(onlySkip.weakened, true);
  assert.equal(onlySkip.rewritten, false);

  // Removed > added: rewritten and weakened.
  const shrunk = analyzeTestDiff(parseDiff('@@ -1,3 +1,1 @@\n-expect(a).toBe(1);\n-expect(b).toBe(2);\n+expect(a).toBe(1);\n'));
  assert.equal(shrunk.assertionsRemoved, 2);
  assert.equal(shrunk.assertionsAdded, 1);
  assert.equal(shrunk.rewritten, true);
  assert.equal(shrunk.weakened, true);

  // No assertion lines: nothing flagged.
  const noAssert = analyzeTestDiff(parseDiff('@@ -1 +1 @@\n-const x = 1;\n+const x = 2;\n'));
  assert.deepEqual(noAssert, { assertionsRemoved: 0, assertionsAdded: 0, skipsAdded: 0, rewritten: false, weakened: false });
});

test('helpers: test/API detection, import resolution, districts, fence', () => {
  assert.ok(isTestPath('tests/a.ts') && isTestPath('src/__tests__/x.js') && isTestPath('src/a.spec.tsx') && isTestPath('b_test.py'));
  assert.ok(!isTestPath('src/latest.ts') && !isTestPath('src/contest/x.ts'));
  assert.ok(isApiPath('src/api/x.ts') && isApiPath('src/articles.serializer.ts') && isApiPath('src/userController.ts') && isApiPath('app/routes/a.ts'));
  assert.ok(!isApiPath('src/articles/ArticleList.tsx') && !isApiPath('src/rapid/x.ts'));
  assert.deepEqual(importSpecifiers(`import a from './a';\nexport { b } from "../b";\nconst c = await import('./c');\nrequire('d');\nimport './e.css';`),
    ['./a', './e.css', '../b', './c', 'd']);
  const files = new Set(['src/a/index.ts', 'src/b.tsx']);
  assert.equal(resolveImport('src/c/x.ts', '../a', files), 'src/a/index.ts');
  assert.equal(resolveImport('src/c/x.ts', '../b', files), 'src/b.tsx');
  assert.equal(resolveImport('src/c/x.ts', 'react', files), null);
  assert.equal(districtOf('src/shared/utils/x.ts', []), 'src/shared/utils/');
  assert.equal(districtOf('src/feed/x.tsx', []), 'src/feed/');
  assert.equal(districtOf('src/main.tsx', [], '.'), 'src/');
  assert.equal(districtOf('package.json', [], '.'), './');
  assert.equal(districtOf('src/shared/utils/x.ts', [{ path: 'src/shared/' }]), 'src/shared/');
  assert.ok(inFence('src/articles/A.tsx', ['src/articles/']) && !inFence('src/articlesX/A.tsx', ['src/articles/']));
  assert.ok(inFence('src/articles/A.tsx', ['src/articles/A.tsx']));
});
