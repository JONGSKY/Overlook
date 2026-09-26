// A merge of the base branch into the task's branch is a step of its own: no file of the agent's, never outside
// the request, and the graph keeps what it brought in (SPEC 3.1 steps[].merge).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { collect, prOfSubject } from '../collect.mjs';
import { buildCity } from '../build-city.mjs';

process.env.GIT_CONFIG_NOSYSTEM = '1';
process.env.GIT_CONFIG_GLOBAL = '/dev/null';
Object.assign(process.env, {
  GIT_AUTHOR_NAME: 'Overlook Test', GIT_AUTHOR_EMAIL: 'test@example.com',
  GIT_COMMITTER_NAME: 'Overlook Test', GIT_COMMITTER_EMAIL: 'test@example.com',
});

let tmp, repo, base, head;
let clock = Date.parse('2026-01-01T00:00:00Z');
const git = (...a) => {
  clock += 60_000;
  const d = new Date(clock).toISOString();
  return execFileSync('git', ['-C', repo, ...a], { encoding: 'utf8', env: { ...process.env, GIT_AUTHOR_DATE: d, GIT_COMMITTER_DATE: d } }).trim();
};
const write = (p, text) => { fs.mkdirSync(path.dirname(path.join(repo, p)), { recursive: true }); fs.writeFileSync(path.join(repo, p), text); };

before(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'overlook-merge-'));
  repo = path.join(tmp, 'repo');
  fs.mkdirSync(repo);
  git('init', '-q', '-b', 'main');
  write('src/app/page.ts', 'export const page = 1;\n');
  write('src/lib/util.ts', 'export const util = 1;\n');
  git('add', '-A'); git('commit', '-q', '-m', 'start');
  git('checkout', '-q', '-b', 'feat/page');
  write('src/app/page.ts', 'export const page = 2;\n');
  git('commit', '-qam', 'change the page');
  git('checkout', '-q', 'main');
  write('src/lib/util.ts', 'export const util = 2;\n');
  git('commit', '-qam', 'Teammate: util (#7)');
  base = git('rev-parse', 'HEAD');
  git('checkout', '-q', 'feat/page');
  git('merge', '-q', '--no-edit', '-m', "Merge branch 'main' into feat/page", 'main');
  write('src/app/page.ts', 'export const page = 3;\n');
  git('commit', '-qam', 'finish the page');
  head = git('rev-parse', 'HEAD');
});
after(() => fs.rmSync(tmp, { recursive: true, force: true }));

test('a merge of the base branch is a step with what it brought in, not the agent\'s work', () => {
  // base as GitHub diffs a PR: the merge base of main and the branch, which is main's commit merged in
  const e = collect({ repo, base, head, src: '.', baseRef: 'main', headRef: 'feat/page' });
  const merge = e.steps.find((s) => s.merge);
  assert.ok(merge, 'the merge is a step');
  assert.deepEqual(merge.files, []);
  const g = e.graph.commits.find((c) => c.sha === merge.sha);
  assert.deepEqual(g.files, ['src/lib/util.ts'], 'the graph keeps what the merge brought in');
  const city = buildCity(e, { kind: 'overlook.audit/v1', request: { title: 't' }, fence: { paths: ['src/app/'] }, claims: [] });
  assert.equal(city.steps.find((s) => s.sha === merge.sha).outside, false, 'a merge never leaves the requested area');
  assert.equal(prOfSubject('Teammate: util (#7)'), 7);
  assert.deepEqual(e.files.filter((f) => f.status !== 'unchanged').map((f) => f.path), ['src/app/page.ts'], 'main\'s change is not the task\'s');
});
