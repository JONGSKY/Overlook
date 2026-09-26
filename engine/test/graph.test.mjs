// Branch graph around the audited range (SPEC 3.1 `graph`).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { collect } from '../collect.mjs';
import { suggestTask } from '../sources.mjs';

process.env.GIT_CONFIG_NOSYSTEM = '1';
process.env.GIT_CONFIG_GLOBAL = '/dev/null';
Object.assign(process.env, {
  GIT_AUTHOR_NAME: 'Overlook Test', GIT_AUTHOR_EMAIL: 'test@example.com',
  GIT_COMMITTER_NAME: 'Overlook Test', GIT_COMMITTER_EMAIL: 'test@example.com',
});

let tmp, repo;
const sha = {};
let clock = Date.parse('2026-03-01T10:00:00Z');
function git(...args) {
  const when = new Date((clock += 3600e3)).toISOString();
  return execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8', env: { ...process.env, GIT_AUTHOR_DATE: when, GIT_COMMITTER_DATE: when } }).trim();
}
function commit(name, file) {
  fs.mkdirSync(path.dirname(path.join(repo, file)), { recursive: true });
  fs.writeFileSync(path.join(repo, file), `${name}\n`);
  git('add', file);
  git('commit', '-q', '-m', name);
  sha[name] = git('rev-parse', 'HEAD');
}

before(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'overlook-graph-'));
  repo = path.join(tmp, 'repo');
  fs.mkdirSync(repo);
  git('init', '-q', '-b', 'main');
  commit('c0', 'a.txt');
  commit('c1', 'b.txt');                 // base
  git('checkout', '-q', '-b', 'feature');
  commit('f1', 'src/x.txt');
  commit('f2', 'src/y.txt');
  git('checkout', '-q', 'main');
  commit('m1', 'c.txt');                 // main moves on while the feature is open
  git('checkout', '-q', '-b', 'other');
  commit('o1', 'd.txt');                 // someone else's branch, same period
  git('checkout', '-q', 'feature');
  git('merge', '-q', '--no-edit', 'main'); // the feature syncs with main
  sha.fm = git('rev-parse', 'HEAD');
  git('checkout', '-q', 'main');
  git('cherry-pick', sha.f1);            // the task's first commit lands on main by rebase
  sha.landed = git('rev-parse', 'HEAD');
  commit('m2', 'e.txt');                 // someone else's commit on main afterwards
  git('checkout', '-q', 'feature');
});

after(() => fs.rmSync(tmp, { recursive: true, force: true }));

test('graph: base lane, audited lane, other branches, steps mapped', () => {
  const e = collect({ repo, base: sha.c1, head: sha.fm, src: '.' });
  const g = e.graph;
  assert.ok(g, 'evidence carries a graph');
  assert.deepEqual(g.lanes.slice(0, 2).map((l) => [l.id, l.name, l.kind]), [['base', 'main', 'base'], ['head', 'feature', 'head']]);
  const other = g.lanes.find((l) => l.kind === 'other');
  assert.equal(other?.name, 'other');
  assert.equal(other.merged, false);

  const at = Object.fromEntries(g.commits.map((c) => [c.sha, c]));
  // the audited branch's own line
  assert.deepEqual([sha.f1, sha.f2, sha.fm].map((s) => at[s].lane), ['head', 'head', 'head']);
  // a main commit merged into the range sits on the base lane, but it is still a step of the range
  assert.equal(at[sha.m1].lane, 'base');
  // every step is on the picture with its 1-based index
  e.steps.forEach((s, i) => assert.equal(at[s.sha]?.step, i + 1, `step ${i + 1} (${s.message})`));
  // base and its parent for context; nothing before the range carries a step
  assert.equal(at[sha.c1].lane, 'base');
  assert.equal(at[sha.c0]?.step, undefined);
  assert.equal(at[sha.o1].lane, other.id);
  // the merge keeps both parents, so the UI can draw the curve from main
  assert.deepEqual(at[sha.fm].parents, [sha.f2, sha.m1]);
  // the task reaching main is marked, someone else's commit is not
  assert.equal(at[sha.landed]?.landed, true);
  assert.equal(at[sha.m2]?.landed, undefined);
  assert.deepEqual(at[sha.m2].files, ['e.txt']);
  assert.deepEqual(at[sha.m2].lines, [[1, 0]]);
  assert.deepEqual(at[sha.m2].peek['e.txt'].filter(([k]) => k === 'a'), [['a', 'm2']]);
  // in date order
  assert.deepEqual(g.commits.map((c) => c.date), g.commits.map((c) => c.date).slice().sort());
});

test('graph: can be turned off, and a caller-given base branch name is used', () => {
  assert.equal(collect({ repo, base: sha.c1, head: sha.fm, src: '.', graph: false }).graph, undefined);
  const e = collect({ repo, base: sha.c1, head: sha.fm, src: '.', baseRef: 'main', headRef: 'feature' });
  assert.deepEqual(e.refs, { base: 'main', head: 'feature' });
  assert.equal(e.graph.lanes[1].name, 'feature');
});

test('suggestTask: without a range, the latest run of commits by one author, merges excluded', () => {
  // feature's tip is a merge: the run is just that commit's first parent line stopping at the merge
  const onFeature = suggestTask(repo, sha.fm);
  assert.equal(onFeature.base, sha.f2);
  assert.match(onFeature.reason, /the last commit by Overlook Test/);
  // main: the same author back to the root; the root (no parent) ends the run and becomes its base
  const onMain = suggestTask(repo, sha.m2);
  assert.equal(onMain.base, sha.c0);
  assert.match(onMain.reason, /the last 4 commits by Overlook Test/);
});
