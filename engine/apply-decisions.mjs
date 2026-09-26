#!/usr/bin/env node
// apply-decisions.mjs — apply reviewer decisions as git commits (SPEC 4.4).
//
// decisions.json = { "base": sha, "head": sha, "decisions": { "path": "approve" | "revert" } }
// Each "revert" becomes its own commit that puts the file back to its base
// content (or removes it if it did not exist at base). "approve" needs no commit.

import fs from 'node:fs';
import path from 'node:path';
import { git, isMain, parseArgs } from './collect.mjs';

const USAGE = 'usage: node engine/apply-decisions.mjs --repo <path> --decisions out/decisions.json [--dry-run] [--force]';

function existsAt(repo, rev, p) {
  try {
    git(repo, ['cat-file', '-e', `${rev}:${p}`]);
    return true;
  } catch {
    return false;
  }
}

function validPath(p) {
  return typeof p === 'string' && p.length > 0 && !p.startsWith('/') && !p.startsWith('-') &&
    !p.split('/').includes('..');
}

/**
 * Apply decisions to a repository.
 * @param {{repo: string, decisions: object, dryRun?: boolean, force?: boolean, log?: (s: string) => void}} opts
 * @returns {{planned: object[], commits: string[]}}
 */
export function applyDecisions({ repo, decisions, dryRun = false, force = false, log = () => {} }) {
  repo = path.resolve(repo);
  if (!decisions?.base || typeof decisions.decisions !== 'object') {
    throw new Error('decisions: expected { base, head, decisions: { path: "approve" | "revert" } }');
  }
  const base = git(repo, ['rev-parse', '--verify', '--quiet', `${decisions.base}^{commit}`]).trim();
  const head = git(repo, ['rev-parse', 'HEAD']).trim();

  // Refuse a dirty working tree (untracked files, such as out/, are fine).
  const dirty = git(repo, ['status', '--porcelain', '--untracked-files=no']).trim();
  if (dirty) throw new Error(`working tree is dirty; commit or stash first:\n${dirty}`);
  if (decisions.head && !head.startsWith(decisions.head) && !force) {
    throw new Error(`decisions were made for head ${decisions.head.slice(0, 7)} but the repo is at ${head.slice(0, 7)}; pass --force to apply anyway`);
  }

  // Renames base -> HEAD, so reverting a renamed file also restores its old path.
  const renames = new Map();
  const ns = git(repo, ['diff', '--name-status', '-z', '-M', base, head]).split('\0');
  for (let i = 0; i < ns.length - 1;) {
    const code = ns[i++];
    if (code[0] === 'R' || code[0] === 'C') { const from = ns[i++]; const to = ns[i++]; if (code[0] === 'R') renames.set(to, from); } else i++;
  }

  const planned = [];
  for (const [p, decision] of Object.entries(decisions.decisions).sort(([a], [b]) => a.localeCompare(b))) {
    if (decision === 'approve') continue;
    if (decision !== 'revert') throw new Error(`unknown decision "${decision}" for ${p}`);
    if (!validPath(p)) throw new Error(`refusing unsafe path: ${p}`);
    const from = renames.get(p);
    let action;
    if (existsAt(repo, base, p)) action = { path: p, action: 'checkout' };
    else if (from) action = { path: p, action: 'rename-back', from };
    else if (existsAt(repo, 'HEAD', p)) action = { path: p, action: 'rm' };
    else { log(`skip ${p}: not present at base or HEAD`); continue; }
    planned.push(action);
  }

  const commits = [];
  for (const a of planned) {
    const describe = a.action === 'checkout' ? `git checkout ${base.slice(0, 7)} -- ${a.path}`
      : a.action === 'rename-back' ? `git rm ${a.path} && git checkout ${base.slice(0, 7)} -- ${a.from}`
        : `git rm ${a.path}`;
    if (dryRun) { log(`[dry-run] ${describe}; commit "overlook: revert ${a.path}"`); continue; }

    if (a.action === 'checkout') {
      git(repo, ['checkout', base, '--', a.path]);
    } else {
      git(repo, ['rm', '-q', '--', a.path]);
      if (a.action === 'rename-back') git(repo, ['checkout', base, '--', a.from]);
    }
    const staged = git(repo, ['diff', '--cached', '--name-only']).trim();
    if (!staged) { log(`skip ${a.path}: already matches base`); continue; }
    git(repo, ['commit', '-q', '-m', `overlook: revert ${a.path}`, '-m',
      `Reviewer decision in Overlook: revert ${a.path} to its content at ${base.slice(0, 12)}.\n` +
      'The change was outside the request and was not approved during review.']);
    const sha = git(repo, ['rev-parse', 'HEAD']).trim();
    commits.push(sha);
    log(`${sha.slice(0, 7)} overlook: revert ${a.path}`);
  }
  return { planned, commits };
}

if (isMain(import.meta.url)) {
  try {
    const args = parseArgs(process.argv.slice(2));
    if (args.help || !args.repo || !args.decisions) {
      console.error(USAGE);
      process.exit(args.help ? 0 : 2);
    }
    const decisions = JSON.parse(fs.readFileSync(args.decisions, 'utf8'));
    const { planned, commits } = applyDecisions({
      repo: args.repo, decisions, dryRun: args.dryRun === true, force: args.force === true, log: (s) => console.log(s),
    });
    console.log(args.dryRun ? `${planned.length} revert(s) planned, nothing changed` : `${commits.length} revert commit(s) created`);
  } catch (err) {
    console.error(`apply-decisions: ${err.stderr?.toString().trim() || err.message}`);
    process.exit(1);
  }
}
