// sources.mjs — where an audit's git history comes from: a GitHub URL or a local folder.
//
// GitHub repositories are cloned into out/repos/<owner>__<repo> and fetched again on reuse.
// Pull request, compare and commit URLs resolve to a base..head range the same way GitHub
// computes its diff (merge-base of base and head).

import { execFile } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { git, prOfSubject } from './collect.mjs';

const run = promisify(execFile);

/**
 * Parse the GitHub URL forms Overlook accepts.
 *   https://github.com/o/r                     -> { kind: 'repo' }
 *   https://github.com/o/r/tree/<ref>          -> { kind: 'tree', ref }
 *   https://github.com/o/r/pull/12[/files]     -> { kind: 'pr', number }
 *   https://github.com/o/r/compare/a...b       -> { kind: 'compare', base, head }
 *   https://github.com/o/r/commit/<sha>        -> { kind: 'commit', sha }
 *   o/r, git@github.com:o/r.git                -> { kind: 'repo' }
 */
export function parseGithubUrl(input) {
  const s = String(input ?? '').trim();
  let m = s.match(/^git@github\.com:([\w.-]+)\/([\w.-]+?)(?:\.git)?$/);
  if (m) return { owner: m[1], repo: m[2], kind: 'repo' };
  m = s.match(/^([\w.-]+)\/([\w.-]+)$/);
  if (m && !s.includes('.com')) return { owner: m[1], repo: m[2].replace(/\.git$/, ''), kind: 'repo' };
  let url;
  try {
    url = new URL(/^https?:\/\//.test(s) ? s : `https://${s}`);
  } catch {
    return null;
  }
  if (!/^(www\.)?github\.com$/.test(url.hostname)) return null;
  const [owner, repoRaw, kind, ...rest] = url.pathname.split('/').filter(Boolean);
  if (!owner || !repoRaw) return null;
  const repo = repoRaw.replace(/\.git$/, '');
  const base = { owner, repo };
  if (kind === 'pull' && /^\d+$/.test(rest[0] ?? '')) return { ...base, kind: 'pr', number: Number(rest[0]) };
  if (kind === 'compare' && rest.length) {
    const spec = decodeURIComponent(rest.join('/'));
    const [b, h] = spec.includes('...') ? spec.split('...') : spec.split('..');
    if (b && h) return { ...base, kind: 'compare', base: b, head: h };
  }
  if (kind === 'commit' && rest[0]) return { ...base, kind: 'commit', sha: rest[0] };
  if (kind === 'tree' && rest.length) return { ...base, kind: 'tree', ref: decodeURIComponent(rest.join('/')) };
  return { ...base, kind: 'repo' };
}

export const cloneDir = (root, gh) => path.join(root, 'out', 'repos', `${gh.owner}__${gh.repo}`);

/** Clone (or refresh) a GitHub repository. Uses the machine's git credentials, so private repos work too. */
export async function ensureClone(gh, root) {
  const dir = cloneDir(root, gh);
  const url = `https://github.com/${gh.owner}/${gh.repo}.git`;
  const env = { ...process.env, GIT_TERMINAL_PROMPT: '0' };
  if (fs.existsSync(path.join(dir, '.git'))) {
    await run('git', ['-C', dir, 'fetch', '--prune', '--no-tags', 'origin'], { env, maxBuffer: 64 << 20 });
  } else {
    fs.mkdirSync(path.dirname(dir), { recursive: true });
    await run('git', ['clone', '--no-tags', url, dir], { env, maxBuffer: 64 << 20 });
  }
  return dir;
}

async function fetchRef(dir, ref) {
  await run('git', ['-C', dir, 'fetch', '--no-tags', 'origin', ref], { env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } });
  return git(dir, ['rev-parse', 'FETCH_HEAD']).trim();
}

const revParse = (dir, rev) => git(dir, ['rev-parse', '--verify', `${rev}^{commit}`]).trim();
const mergeBase = (dir, a, b) => git(dir, ['merge-base', a, b]).trim();
/**
 * Base of a pull request. GitHub diffs a PR against the merge base of its base and head. Once a PR is merged with a
 * merge commit its head is on the base branch, so that merge base is the head itself and the diff would be empty:
 * then use the PR's own base commit, or the first parent of the merge commit that brought the head in.
 */
export function prBase(dir, baseTip, head, baseSha) {
  if (baseSha) {
    try { return mergeBase(dir, revParse(dir, baseSha), head); } catch { /* not in this clone */ }
  }
  const mb = mergeBase(dir, baseTip, head);
  if (mb !== head) return mb;
  const merges = git(dir, ['rev-list', '--merges', '--ancestry-path', '--reverse', '--parents', `${head}..${baseTip}`]).trim().split('\n');
  for (const line of merges) {
    const [, first, ...rest] = line.split(' ');
    if (first && rest.includes(head)) return mergeBase(dir, first, head);
  }
  return mb;
}

const defaultHead = (dir) => {
  try {
    return revParse(dir, 'origin/HEAD');
  } catch {
    return revParse(dir, 'HEAD');
  }
};

async function githubPull(gh) {
  try {
    const res = await fetch(`https://api.github.com/repos/${gh.owner}/${gh.repo}/pulls/${gh.number}`, {
      headers: { accept: 'application/vnd.github+json', ...(process.env.GITHUB_TOKEN ? { authorization: `Bearer ${process.env.GITHUB_TOKEN}` } : {}) },
    });
    if (!res.ok) return null;
    const pr = await res.json();
    const out = { title: pr.title, body: pr.body ?? '', baseRef: pr.base?.ref, baseSha: pr.base?.sha, headRef: pr.head?.label ?? pr.head?.ref, number: pr.number, url: pr.html_url, merged: !!pr.merged_at };
    // The issue the PR closes is what was asked for ("Fixes #724"); the PR description is the agent's report.
    const closes = /\b(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?)\s*:?\s+#(\d+)/i.exec(out.body)?.[1];
    if (closes) {
      try {
        const ir = await fetch(`https://api.github.com/repos/${gh.owner}/${gh.repo}/issues/${closes}`, { headers: { accept: 'application/vnd.github+json', ...(process.env.GITHUB_TOKEN ? { authorization: `Bearer ${process.env.GITHUB_TOKEN}` } : {}) }, signal: AbortSignal.timeout(6000) });
        if (ir.ok) { const is = await ir.json(); out.issue = { number: is.number, title: is.title, body: is.body ?? '', url: is.html_url }; }
      } catch { /* the PR alone is enough */ }
    }
    return out;
  } catch {
    return null;
  }
}

/**
 * Name the pull requests in a branch graph (SPEC 3.1 `graph`): the audited branch's PR, and for each other branch
 * the PR opened from it, with title and state (open / closed / merged). Best effort: without network the graph
 * keeps what git gave it (PR numbers from commit subjects).
 */
export async function enrichGraphPrs(graph, gh, headPr = null) {
  if (!graph || !gh) return graph;
  const headers = { accept: 'application/vnd.github+json', ...(process.env.GITHUB_TOKEN ? { authorization: `Bearer ${process.env.GITHUB_TOKEN}` } : {}) };
  const api = async (p) => {
    try {
      const res = await fetch(`https://api.github.com/repos/${gh.owner}/${gh.repo}/${p}`, { headers, signal: AbortSignal.timeout(6000) });
      return res.ok ? await res.json() : null;
    } catch { return null; }
  };
  const summary = (pr) => (pr?.number ? { number: pr.number, title: pr.title, state: pr.merged_at ? 'merged' : pr.state, url: pr.html_url, ...(pr.merged_at ? { mergedAt: pr.merged_at } : {}) } : null);
  const head = graph.lanes.find((l) => l.kind === 'head');
  if (head && headPr?.number) {
    head.pr = summary(await api(`pulls/${headPr.number}`)) ?? { number: headPr.number, title: headPr.title ?? '', state: headPr.merged ? 'merged' : 'open', ...(headPr.url ? { url: headPr.url } : {}) };
  }
  for (const l of graph.lanes.filter((x) => x.kind === 'other')) {
    const found = await api(`pulls?head=${encodeURIComponent(`${gh.owner}:${l.name}`)}&state=all&per_page=1`);
    const pr = summary(found?.[0]);
    if (pr) l.pr = pr;
  }
  return graph;
}

/** A pull request's own branch (pull/<n>/head) against the base it was opened on. */
async function resolvePull(dir, gh, label) {
  const head = await fetchRef(dir, `pull/${gh.number}/head`);
  const pr = await githubPull(gh);
  let baseTip;
  try {
    baseTip = pr?.baseRef ? await fetchRef(dir, pr.baseRef) : defaultHead(dir);
  } catch {
    baseTip = defaultHead(dir);
  }
  const info = pr ?? { title: `Pull request #${gh.number}`, body: '', number: gh.number };
  return { dir, label: `${label}#${gh.number}`, base: prBase(dir, baseTip, head, pr?.baseSha), head, pr: info, refs: { base: info.baseRef ?? null, head: info.headRef ?? `pull/${gh.number}` } };
}

/**
 * Resolve a GitHub URL into a local clone and, when the URL names one, a base..head range.
 * @returns {{ dir, label, base: string|null, head: string, pr: object|null }}
 */
export async function resolveGithub(gh, root) {
  const dir = await ensureClone(gh, root);
  const label = `${gh.owner}/${gh.repo}`;
  if (gh.kind === 'pr') return resolvePull(dir, gh, label);
  if (gh.kind === 'compare') {
    const b = await fetchRef(dir, gh.base);
    const h = await fetchRef(dir, gh.head);
    return { dir, label: `${label} ${gh.base}...${gh.head}`, base: mergeBase(dir, b, h), head: h, pr: null, refs: { base: gh.base, head: gh.head } };
  }
  if (gh.kind === 'commit') {
    const head = revParse(dir, gh.sha);
    return { dir, label: `${label}@${head.slice(0, 7)}`, base: revParse(dir, `${head}^`), head, pr: null };
  }
  const head = gh.kind === 'tree' ? await fetchRef(dir, gh.ref) : defaultHead(dir);
  // The latest task is often a pull request that landed as one commit ("Title (#123)", or a merge of it). Its own
  // branch, with every commit and every merge from the base branch, is still on GitHub as pull/<n>/head: audit that.
  const number = prOfSubject(git(dir, ['log', '-n', '1', '--format=%s', head]).trim());
  if (number) {
    try {
      const out = await resolvePull(dir, { ...gh, kind: 'pr', number }, label);
      if (out.base && out.base !== out.head) return { ...out, label, baseReason: `pull request #${number}, the latest task on ${out.refs?.base ?? 'the default branch'} (its own commits, from GitHub)` };
    } catch { /* the pull request ref is gone: fall back to the commits themselves */ }
  }
  const task = suggestTask(dir, head);
  return { dir, label, base: task.base, baseReason: task.reason, head, pr: null, refs: { base: null, head: gh.kind === 'tree' ? gh.ref : null } };
}

/**
 * Without a range in the link (a repository, a branch or a local folder), audit the latest task: the run of
 * commits at the tip by the same author, merges excluded, at most 12. Returns { base, reason }.
 */
export function suggestTask(dir, head) {
  const log = git(dir, ['log', '--first-parent', '-n', '13', '--format=%H%x1f%P%x1f%an', head]).trim().split('\n').filter(Boolean)
    .map((l) => { const [sha, parents, author] = l.split('\x1f'); return { sha, parents: parents ? parents.split(' ') : [], author }; });
  if (!log.length) return { base: null, reason: '' };
  const who = log[0].author;
  const run = [];
  for (const c of log) { if (c.author !== who || c.parents.length !== 1 || run.length >= 12) break; run.push(c); }
  if (!run.length) run.push(log[0]);
  const base = run.at(-1).parents[0] ?? null;
  return { base, reason: `the last ${run.length === 1 ? 'commit' : `${run.length} commits`} by ${who}` };
}

/** A local folder must be (inside) a git work tree; returns its top level. */
export function resolveFolder(folder) {
  const abs = path.resolve(folder.replace(/^~(?=$|\/)/, os.homedir()));
  if (!fs.existsSync(abs) || !fs.statSync(abs).isDirectory()) throw new Error(`Not a folder: ${abs}`);
  let top;
  try {
    top = git(abs, ['rev-parse', '--show-toplevel']).trim();
  } catch {
    throw new Error(`Not a git repository: ${abs}`);
  }
  const head = revParse(top, 'HEAD'), task = suggestTask(top, head);
  return { dir: top, label: path.basename(top), base: task.base, baseReason: task.reason, head, pr: null };
}


/** Recent commits reachable from `head`, newest first. */
export function listCommits(dir, head = 'HEAD', limit = 40) {
  const out = git(dir, ['log', `--max-count=${limit}`, '--format=%H%x1f%s%x1f%an%x1f%cI', head]).trim();
  return out ? out.split('\n').map((l) => {
    const [sha, subject, author, date] = l.split('\x1f');
    return { sha, subject, author, date };
  }) : [];
}

/** Sub-folders of `dir` for the folder picker, marking git repositories. */
export function listFolders(dir) {
  const abs = path.resolve((dir || os.homedir()).replace(/^~(?=$|\/)/, os.homedir()));
  const entries = fs.readdirSync(abs, { withFileTypes: true })
    .filter((e) => e.isDirectory() && !e.name.startsWith('.') && e.name !== 'node_modules')
    .map((e) => {
      const p = path.join(abs, e.name);
      return { name: e.name, path: p, isGit: fs.existsSync(path.join(p, '.git')) };
    })
    .sort((a, b) => Number(b.isGit) - Number(a.isGit) || a.name.localeCompare(b.name));
  return { path: abs, parent: path.dirname(abs) === abs ? null : path.dirname(abs), isGit: fs.existsSync(path.join(abs, '.git')), home: os.homedir(), entries };
}
