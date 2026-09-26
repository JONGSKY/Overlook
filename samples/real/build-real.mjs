#!/usr/bin/env node
// build-real.mjs — real examples: finished agent tasks from public repositories, audited with Overlook.
//
//   node samples/real/build-real.mjs [--only id,id]
//
// For each entry below: clone (or reuse) the repository in out/repos/, run the collector over the pinned
// base..head range, combine it with samples/real/<id>/audit.json and write samples/real/<id>.city.json (+ .js)
// and samples/real/index.json. The ranges are pinned by SHA, so a rebuild gives the same evidence.
//
// What is real and what is not: the code, the commits, the request and the agent's report are quoted from
// the source (linked in each audit's "example" block). The fence and the claim types were written by the
// Overlook team for the example; every git-checkable verdict is computed by build-city as usual.
// Repositories without a licence are built with `redact: true`: paths and line counts only, no code.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { collect, git, parseArgs } from '../../engine/collect.mjs';
import { buildCity, writeCity } from '../../engine/build-city.mjs';
import { enrichGraphPrs, ensureClone } from '../../engine/sources.mjs';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const DIR = path.join(ROOT, 'samples', 'real');

export const REAL = [
  { id: 'atlas-production-fixes', repo: 'chanjoongx/atlas', base: '26b3d5d3523f9135c4601b2c728a0d539aa541e7', head: '1aff2bb067689d3f06e0924d2d3f28ac7c8cc370',
    refs: { base: 'main', head: 'Bob session 10' },
    blurb: 'A real Bob session from last hackathon\'s runner-up. The prompt named four files and fenced off the backend; Bob stayed inside.' },
  { id: 'github-mcp-server-icons', repo: 'github/github-mcp-server', base: 'c0bd7b2744b0b283afb8a1c9a63970d3f1e967d9', head: 'defca05152127b609fdba87576668519f4d29354',
    refs: { base: 'main', head: 'copilot/record-sdk-version-usage' },
    blurb: 'Copilot agent PR in GitHub\'s MCP server: a compatibility fix that also rewrites test expectations and five tool snapshots.' },
  { id: 'playwright-mcp-screenshot', repo: 'microsoft/playwright-mcp', base: 'efe3ff0c7c10f55373adaacea7f22fc82334fa6c', head: '1d05029b6a693197177a9e8dcadaf1c31685145d',
    refs: { base: 'main', head: 'copilot/fix-724' },
    blurb: 'Copilot agent PR in Playwright MCP: a two-file fix inside the request, but the description still claims a change that was reverted.' },
];

function redact(evidence, url) {
  const note = [['h', `Code not shown: this repository has no licence to redistribute it. See ${url}`]];
  for (const f of evidence.files) if (f.diff?.length) f.diff = note;
  for (const s of evidence.steps) for (const c of Object.values(s.changes ?? {})) if (c.diff?.length) c.diff = note;
  for (const c of evidence.graph?.commits ?? []) delete c.peek; // no code from other commits either
}

async function buildOne(ex) {
  const [owner, repo] = ex.repo.split('/');
  const dir = await ensureClone({ owner, repo }, ROOT);
  try { git(dir, ['cat-file', '-e', `${ex.head}^{commit}`]); } catch {
    git(dir, ['fetch', '-q', 'origin', '+refs/pull/*/head:refs/remotes/origin/pr/*']);
  }
  const audit = JSON.parse(fs.readFileSync(path.join(DIR, ex.id, 'audit.json'), 'utf8'));
  // name-rev guesses on a clone with many branches; use the PR's own names (also for the branch graph)
  const evidence = collect({ repo: dir, base: ex.base, head: ex.head, baseRef: ex.refs.base, headRef: ex.refs.head });
  evidence.repo = ex.repo;
  const prNumber = Number(/\/pull\/(\d+)/.exec(audit.example.url ?? '')?.[1]) || null;
  await enrichGraphPrs(evidence.graph, { owner, repo }, prNumber ? { number: prNumber, title: audit.request?.title } : null);
  if (ex.redact) redact(evidence, audit.example.url);
  const city = buildCity(evidence, audit);
  city.meta.prUrl = audit.example.url;
  writeCity(path.join(DIR, `${ex.id}.city.json`), city);
  const t = city.totals;
  console.log(`${ex.id}: ${t.filesChanged} changed, ${t.outside} outside, ${t.affected} affected, ${t.claimsTrue}/${t.claims} claims hold`);
  return {
    id: ex.id, title: typeof city.request.title === 'string' ? city.request.title : city.request.title?.en,
    repo: ex.repo, kind: audit.example.kind, context: audit.example.context ?? '', url: audit.example.url, blurb: ex.blurb, ...(audit.example.bob_generated ? { bob_generated: true } : {}),
    files: city.files.length, changed: t.filesChanged, outside: t.outside, affected: t.affected, claims: t.claims, claimsTrue: t.claimsTrue,
    falseClaims: city.claims.filter((c) => c.verdict === 'false').length,
  };
}

const args = parseArgs(process.argv.slice(2));
const only = args.only ? String(args.only).split(',') : null;
const index = [];
for (const ex of REAL) {
  if (only && !only.includes(ex.id)) {
    const prev = JSON.parse(fs.readFileSync(path.join(DIR, 'index.json'), 'utf8')).find((e) => e.id === ex.id);
    if (prev) index.push(prev);
    continue;
  }
  index.push(await buildOne(ex));
}
fs.writeFileSync(path.join(DIR, 'index.json'), JSON.stringify(index, null, 2) + '\n');
console.log(`index.json: ${index.map((e) => e.id).join(', ')}`);
