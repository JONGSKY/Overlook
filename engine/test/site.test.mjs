import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { extractClaims, stem, suggestFence } from '../draft-audit.mjs';
import { createSite } from '../site.mjs';
import { parseGithubUrl, prBase } from '../sources.mjs';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));

test('parseGithubUrl understands repo, PR, compare, commit and tree URLs', () => {
  assert.deepEqual(parseGithubUrl('https://github.com/o/r'), { owner: 'o', repo: 'r', kind: 'repo' });
  assert.deepEqual(parseGithubUrl('github.com/o/r.git'), { owner: 'o', repo: 'r', kind: 'repo' });
  assert.deepEqual(parseGithubUrl('o/r'), { owner: 'o', repo: 'r', kind: 'repo' });
  assert.deepEqual(parseGithubUrl('git@github.com:o/r.git'), { owner: 'o', repo: 'r', kind: 'repo' });
  assert.deepEqual(parseGithubUrl('https://github.com/o/r/pull/42/files'), { owner: 'o', repo: 'r', kind: 'pr', number: 42 });
  assert.deepEqual(parseGithubUrl('https://github.com/o/r/compare/main...feat/x'), { owner: 'o', repo: 'r', kind: 'compare', base: 'main', head: 'feat/x' });
  assert.deepEqual(parseGithubUrl('https://github.com/o/r/commit/abc123'), { owner: 'o', repo: 'r', kind: 'commit', sha: 'abc123' });
  assert.deepEqual(parseGithubUrl('https://github.com/o/r/tree/release/1.2'), { owner: 'o', repo: 'r', kind: 'tree', ref: 'release/1.2' });
  assert.equal(parseGithubUrl('https://gitlab.com/o/r'), null);
  assert.equal(parseGithubUrl('not a url'), null);
});

test('a merged pull request still diffs against the commit it branched from', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'overlook-merged-'));
  const g = (...a) => execFileSync('git', a, { cwd: dir, encoding: 'utf8', env: { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' } }).trim();
  g('init', '-q', '-b', 'main');
  fs.writeFileSync(path.join(dir, 'a.txt'), '1\n'); g('add', '.'); g('commit', '-qm', 'base');
  const base = g('rev-parse', 'HEAD');
  g('checkout', '-qb', 'agent'); fs.writeFileSync(path.join(dir, 'b.txt'), '2\n'); g('add', '.'); g('commit', '-qm', 'agent work');
  const head = g('rev-parse', 'HEAD');
  g('checkout', '-q', 'main'); fs.writeFileSync(path.join(dir, 'c.txt'), '3\n'); g('add', '.'); g('commit', '-qm', 'main moves on');
  g('merge', '-q', '--no-ff', '-m', 'merge agent', 'agent');
  const tip = g('rev-parse', 'HEAD');
  assert.equal(prBase(dir, tip, head), base, 'fallback: first parent of the merge commit');
  assert.equal(prBase(dir, tip, head, base), base, 'the base commit GitHub reports');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('draft claims recognise the git-checkable wording', () => {
  const claims = extractClaims('Done. Article dates now show relative time. I only changed the article views. No API changes. All tests pass.');
  assert.deepEqual(claims.map((c) => c.type), ['feature', 'scope', 'no_api_change', 'tests_pass']);
  assert.equal(claims[0].verdict, 'unverified');
  assert.equal(extractClaims('I did not add any new files.')[0].type, 'no_new_files');
});

test('fence suggestion matches singular and plural folder names', () => {
  assert.equal(stem('articles'), 'article');
  assert.equal(stem('classes'), 'class');
  assert.equal(stem('stories'), 'story');
  const evidence = { files: [{ path: 'src/articles/A.tsx' }, { path: 'src/articles/list/B.tsx' }, { path: 'src/comments/C.tsx' }] };
  assert.deepEqual(suggestFence(evidence, 'Show relative time on the article page'), ['src/articles/']);
});

test('site API health, static serving, and audit end to end', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'overlook-site-'));
  const repo = path.join(dir, 'gt142-sample-app');
  execFileSync('bash', [path.join(ROOT, 'samples/make-sample-repo.sh'), repo], { stdio: 'ignore' });
  const base = execFileSync('git', ['-C', repo, 'rev-list', '--max-parents=0', 'HEAD'], { encoding: 'utf8' }).trim();
  const server = createSite().listen(0, '127.0.0.1');
  await new Promise((r) => server.once('listening', r));
  const url = `http://127.0.0.1:${server.address().port}`;
  const get = (p) => fetch(url + p);
  const post = (p, body) => fetch(url + p, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }).then((r) => r.json());
  try {
    // Health endpoint
    const health = await get('/api/health').then((r) => r.json());
    assert.equal(health.ok, true, '/api/health must return {ok: true}');

    // Static serving: the app shell is served for every clean path
    for (const p of ['/', '/sample', '/examples', '/audit/a1b2c3d4e5']) {
      const res = await get(p);
      assert.equal(res.status, 200, `${p} must return 200`);
      assert.match(res.headers.get('content-type'), /text\/html/, `${p} content-type`);
    }
    // Static serving: a known UI file is served correctly
    const js = await get('/ui/util.js');
    assert.equal(js.status, 200, '/ui/util.js must return 200');
    assert.match(js.headers.get('content-type'), /javascript/, '/ui/util.js content-type');
    // Static serving: unknown paths return 404 (exercises the double-stat fix for directories)
    const notFound = await get('/ui/nonexistent-file-xyz.js');
    assert.equal(notFound.status, 404, 'unknown static path must return 404');
    // Static serving: directory without an index.html returns 404 (not a crash)
    const noIndex = await get('/engine');
    assert.equal(noIndex.status, 404, 'path outside allowed dirs must return 404');

    // Source and audit API
    const src = await post('/api/source', { folder: repo });
    assert.equal(src.commits.length, 7);
    const out = await post('/api/audit', {
      folder: repo, base, title: 'Relative publish dates', request: 'Show relative time on the article list and article page.',
      report: 'Done. Article dates now show relative time. I only changed the article views. No API changes. All tests pass.',
    });
    assert.deepEqual(out.city.fence.paths, ['src/articles/']);
    assert.equal(out.city.totals.outside, 4);
    assert.equal(out.city.totals.affected, 3);
    assert.deepEqual(out.city.claims.map((c) => c.verdict), ['unverified', 'false', 'false', 'partial']);
    assert.equal(out.city.meta.draft, true);
    assert.deepEqual(out.city.meta.refs, { base: 'main', head: 'agent/gt-142-relative-dates' });
    assert.ok(out.city.steps[1].changes['src/shared/utils/relativeTime.ts'].plus > 0, 'per-commit diffs are collected');

    // Retrieve saved audit
    const again = await get(`/api/audits/${out.id}`).then((r) => r.json());
    assert.equal(again.city.meta.head, out.city.meta.head);

    // Fence update
    const widened = await post(`/api/audits/${out.id}/fence`, { paths: ['src/articles/', 'src/shared/'] });
    assert.equal(widened.city.totals.outside, 2);
    assert.equal(widened.city.meta.fenceSetBy, 'reviewer');

    // Receipt
    const receipt = await post(`/api/audits/${out.id}/receipt`, { decisions: {} });
    assert.match(receipt.markdown, /Bob explains; git decides/);

    // Unknown audit returns 404
    const missing = await get('/api/audits/0000000000').then((r) => r.json());
    assert.ok(missing.error, 'unknown audit id must return an error');

    // Bad GitHub URL returns a clear error
    const bad = await post('/api/source', { github: 'https://example.com/x' });
    assert.match(bad.error, /GitHub URL/);
  } finally {
    server.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
