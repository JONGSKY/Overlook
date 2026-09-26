#!/usr/bin/env node
// scan.mjs — measure public AI-agent pull requests with Overlook's own rules.
//
// For each pull request this reads the GitHub REST API only (no cloning):
// the PR, its changed files and patches, the issue it links to (the request)
// and the repository tree at the PR's base. It then applies the same
// deterministic rules the engine applies to a local repository:
//
//   test file            isTestPath            (collect.mjs)
//   test rewritten/weak  analyzeTestDiff on the parsed patch (collect.mjs)
//   API file             isApiPath             (collect.mjs)
//   claims               extractClaims on the PR description (draft-audit.mjs)
//   fence                suggestFence from the issue title + body (draft-audit.mjs)
//   outside the fence    inFence               (copied from build-city.mjs)
//   claim verdicts       checkClaim            (reimplemented from build-city.mjs)
//
// usage:
//   node engine/scan.mjs --prs docs/measurements/prs.txt [--name agents]
//   node engine/scan.mjs --query "is:pr author:app/copilot-swe-agent is:merged" --limit 10 [--linked] [--one-per-repo]
//
// GITHUB_TOKEN (optional) raises the API limit from 60 to 5000 requests an hour.
// Responses are cached in out/scan/cache/ so a re-run spends no requests;
// pass --no-cache to ignore the cache.

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { analyzeTestDiff, isApiPath, isMain, isTestPath, parseArgs, parseDiff, writeJson } from './collect.mjs';
import { extractClaims, suggestFence } from './draft-audit.mjs';

const USAGE = `usage: node engine/scan.mjs (--prs <file> | --query "<search>" [--limit N]) [options]

  --prs <file>      one pull request URL per line (# starts a comment)
  --query <q>       GitHub issue-search query; "is:pr" is added if missing
  --limit N         how many search results to scan (default 10)
  --linked          with --query: keep only PRs whose description links an issue
  --one-per-repo    with --query: keep only the newest PR of each repository
  --name <name>     output name: out/scan/<name>.json (default: prs file name or "search")
  --reserve N       stop when fewer than N core API requests remain (default 4)
  --no-cache        do not read out/scan/cache/

env: GITHUB_TOKEN   optional; raises the API limit (never printed)`;

const API = 'https://api.github.com';
const CACHE_DIR = 'out/scan/cache';
/** Claim types this scan can check from the API (build-city also checks only_files, which drafts never produce). */
export const CHECKED_TYPES = ['scope', 'no_api_change', 'tests_pass', 'no_new_files'];

// ---------------------------------------------------------------------------
// pure: parsing
// ---------------------------------------------------------------------------

/** "https://github.com/o/r/pull/12" -> { owner, repo, number }; null if not a PR URL. */
export function parsePrUrl(url) {
  const m = String(url).trim().match(/^https?:\/\/github\.com\/([^/\s]+)\/([^/\s]+)\/pull\/(\d+)/);
  return m ? { owner: m[1], repo: m[2], number: Number(m[3]) } : null;
}

/** Lines of a PR list file: URLs only, blank lines and # comments skipped. */
export function readPrList(text) {
  return String(text).split('\n').map((l) => l.replace(/#.*$/, '').trim()).filter(Boolean);
}

/**
 * Number of the issue a PR description links to, in the same repository, or null.
 * Recognised: "Fixes #12", "Closes #12", "Resolves #12" (any tense, optional colon),
 * the same keywords before "owner/repo#12" or a full issue URL, and otherwise
 * any full issue URL of the same repository.
 */
export function linkedIssue(body, owner, repo) {
  const text = stripComments(String(body ?? ''));
  const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const url = `https?://github\\.com/${esc(owner)}/${esc(repo)}/issues/(\\d+)`;
  const keyword = '\\b(?:fix(?:e[sd])?|close[sd]?|resolve[sd]?)\\b:?\\s+';
  const patterns = [
    new RegExp(`${keyword}#(\\d+)\\b`, 'i'),
    new RegExp(`${keyword}${esc(owner)}/${esc(repo)}#(\\d+)\\b`, 'i'),
    new RegExp(`${keyword}${url}`, 'i'),
    new RegExp(url, 'i'),
  ];
  for (const re of patterns) {
    const m = text.match(re);
    if (m) return Number(m[1]);
  }
  return null;
}

function stripComments(text) {
  return text.replace(/<!--[\s\S]*?-->/g, ' ');
}

/**
 * The agent's report as sentences extractClaims can read. A PR description is
 * Markdown, so before splitting into sentences this drops HTML comments and
 * blocks between <!-- START x --> and <!-- END x --> markers (tool tips), fenced
 * code, images, and <details> blocks that quote the original request
 * ("Original prompt"/"Original issue"), strips list/heading/quote markers and the outer pipes of table rows, and
 * ends every line with a period so bullets do not merge into one sentence.
 */
export function reportText(body) {
  let text = String(body ?? '').replace(/\r\n?/g, '\n');
  text = stripComments(text.replace(/<!--\s*START ([^>]*?)\s*-->[\s\S]*?<!--\s*END \1\s*-->/g, ' '));
  text = text.replace(/<details>\s*<summary>[^<]*original[^<]*<\/summary>[\s\S]*?<\/details>/gi, ' ');
  text = text.replace(/```[\s\S]*?(```|$)/g, ' ');
  text = text.replace(/!\[[^\]]*\]\([^)]*\)/g, ' ');
  text = text.replace(/<[^>\n]+>/g, ' ');
  return text
    .split('\n')
    .map((l) => l.replace(/^\s*(?:>\s*)*(?:#{1,6}\s+|[-*+]\s+(?:\[[ xX]\]\s+)?|\d+[.)]\s+)?/, '').replace(/\*\*|__/g, '').replace(/^\|\s*|\s*\|$/g, '').trim())
    .filter((l) => l && !/^\[!\w+\]$/.test(l) && !/^[-=|:\s]+$/.test(l))
    .map((l) => (/[.!?:]$/.test(l) ? l : l + '.'))
    .join('\n');
}

// ---------------------------------------------------------------------------
// pure: files, fence, claims
// ---------------------------------------------------------------------------

const STATUS = { added: 'added', removed: 'deleted', modified: 'modified', renamed: 'renamed', copied: 'added', changed: 'modified', unchanged: 'unchanged' };

/**
 * One entry of /pulls/{n}/files -> an evidence-like file record (SPEC 3.1 names).
 * The patch starts at its @@ header, so parseDiff reads it as the engine does;
 * GitHub omits the patch for binary and very large files (test: null, noPatch: true).
 */
export function fileRecord(gh) {
  const p = gh.filename;
  const isTest = isTestPath(p);
  const rec = {
    path: p,
    status: STATUS[gh.status] ?? 'modified',
    ...(gh.previous_filename ? { from: gh.previous_filename } : {}),
    plus: gh.additions ?? 0,
    minus: gh.deletions ?? 0,
    isTest,
    isApi: isApiPath(p),
    test: null,
  };
  if (typeof gh.patch !== 'string') rec.noPatch = true;
  else if (isTest) rec.test = analyzeTestDiff(parseDiff(gh.patch));
  return rec;
}

/** Is `p` inside the fence? Copied from build-city.mjs: directory entries end with "/"; file entries match exactly. */
export function inFence(p, fencePaths) {
  return fencePaths.some((f) => p === f || (f.endsWith('/') && p.startsWith(f)) || p.startsWith(f + '/'));
}

/**
 * Suggested fence: suggestFence over every path at base plus the PR's changed
 * paths (the engine's evidence holds base and head files, so added folders count).
 */
export function fenceFor(treePaths, files, requestText) {
  const paths = new Set(treePaths);
  for (const f of files) paths.add(f.path);
  return suggestFence({ files: [...paths].map((p) => ({ path: p })) }, requestText);
}

/** Changed files outside the fence, or null when there is no usable fence. */
export function outsideFiles(files, fencePaths) {
  if (!fencePaths || fencePaths.length === 0) return null;
  return files.filter((f) => f.status !== 'unchanged' && !inFence(f.path, fencePaths)).map((f) => f.path);
}

const list = (paths) => paths.join(', ');

/**
 * Verdict of one claim, following build-city's checkClaim for the types git can
 * check. Differences, all deliberate: with no usable fence (no linked issue, or
 * the issue names no folder) a scope claim is `unverified` instead of counting
 * every change as outside; a test file whose patch GitHub withholds cannot be
 * analysed and is listed in the detail; `feature` and other claims stay
 * `unverified` because no one reviewed them.
 */
export function checkClaim(claim, files, fencePaths) {
  const changed = files.filter((f) => f.status !== 'unchanged');
  const base = { text: claim.text, type: claim.type };
  const verdict = (ok, detailOk, detailBad, bad = 'false') =>
    ({ ...base, verdict: ok ? 'true' : bad, detail: ok ? detailOk : detailBad });

  switch (claim.type) {
    case 'scope': {
      const out = outsideFiles(changed, fencePaths);
      if (out === null) return { ...base, verdict: 'unverified', detail: 'No fence: the PR links no issue, or the issue names no folder.' };
      return verdict(out.length === 0,
        `All ${changed.length} changed file(s) are inside the suggested fence.`,
        `${out.length} file(s) changed outside the suggested fence: ${list(out)}.`);
    }
    case 'no_api_change': {
      const api = changed.filter((f) => f.isApi).map((f) => f.path);
      return verdict(api.length === 0, 'No API file changed.', `${api.length} API file(s) changed: ${list(api)}.`);
    }
    case 'tests_pass': {
      const bad = changed.filter((f) => f.test && (f.test.rewritten || f.test.weakened)).map((f) => f.path);
      const blind = changed.filter((f) => f.isTest && f.noPatch).map((f) => f.path);
      const note = blind.length ? ` ${blind.length} test file(s) had no patch to read: ${list(blind)}.` : '';
      // The tests were never run, so a clean test diff leaves the claim unverified, never true (as in core/city.mjs).
      return bad.length
        ? { ...base, verdict: 'partial', detail: `Pass status is reported by the agent, not run by Overlook; ${bad.length} test file(s) were rewritten or weakened: ${list(bad)}.` + note }
        : { ...base, verdict: 'unverified', detail: 'Pass status is reported by the agent, not run by Overlook; no test was rewritten or weakened.' + note };
    }
    case 'no_new_files': {
      const added = changed.filter((f) => f.status === 'added').map((f) => f.path);
      return verdict(added.length === 0, 'No file was added.', `${added.length} file(s) added: ${list(added)}.`);
    }
    default:
      return { ...base, verdict: 'unverified', detail: 'Not checkable from git.' };
  }
}

/**
 * Measure one pull request from raw API data (no network).
 * @param input { url, pr, files, issue, tree }
 *   pr     /repos/{o}/{r}/pulls/{n}
 *   files  concatenated /pulls/{n}/files pages
 *   issue  /issues/{m} of the linked issue, or null
 *   tree   /git/trees/{base}?recursive=1, or null
 */
export function measurePr({ url, pr, files: ghFiles, issue = null, tree = null, issueNumber = null }) {
  const ref = parsePrUrl(url ?? pr?.html_url);
  const files = ghFiles.map(fileRecord);
  const notes = [];

  const linked = issueNumber ?? linkedIssue(pr.body, ref.owner, ref.repo);
  let request;
  if (issue && !issue.pull_request) {
    request = { source: 'issue', number: issue.number, title: issue.title, url: issue.html_url };
  } else if (issue?.pull_request) {
    request = { source: 'missing', reason: `#${linked} is a pull request, not an issue` };
  } else if (linked) {
    request = { source: 'missing', reason: `linked issue #${linked} could not be read` };
  } else {
    request = { source: 'missing', reason: 'the description links no issue' };
  }

  let fence = null;
  if (request.source === 'issue') {
    const treePaths = (tree?.tree ?? []).filter((e) => e.type === 'blob').map((e) => e.path);
    if (!tree) notes.push('tree not read; fence suggested from changed paths only');
    if (tree?.truncated) notes.push(`tree truncated by GitHub (${treePaths.length} paths read)`);
    const paths = fenceFor(treePaths, files, `${issue.title ?? ''} ${issue.body ?? ''}`);
    fence = { paths, source: 'suggested from issue title + body', treePaths: treePaths.length, treeTruncated: Boolean(tree?.truncated) };
    if (paths.length === 0) notes.push('the issue names no folder of the repository: no usable fence');
  }
  if (pr.changed_files != null && pr.changed_files !== files.length) {
    notes.push(`GitHub lists ${files.length} of ${pr.changed_files} changed files`);
  }

  const out = outsideFiles(files, fence?.paths);
  const tests = files.filter((f) => f.isTest);
  const badTests = tests.filter((f) => f.test && (f.test.rewritten || f.test.weakened));
  const claims = extractClaims(reportText(pr.body)).map((c) => checkClaim(c, files, fence?.paths));

  return {
    url: pr.html_url ?? url,
    repo: `${ref.owner}/${ref.repo}`,
    number: ref.number,
    title: pr.title,
    author: pr.user?.login ?? null,
    state: pr.merged_at ? 'merged' : pr.state,
    base: pr.base?.sha ?? null,
    head: pr.head?.sha ?? null,
    request,
    filesChanged: files.length,
    plus: files.reduce((n, f) => n + f.plus, 0),
    minus: files.reduce((n, f) => n + f.minus, 0),
    fence,
    outside: out === null ? null : { count: out.length, paths: out },
    tests: {
      changed: tests.map((f) => f.path),
      rewrittenOrWeakened: badTests.map((f) => ({ path: f.path, ...f.test })),
    },
    apiFiles: files.filter((f) => f.isApi).map((f) => f.path),
    addedFiles: files.filter((f) => f.status === 'added').map((f) => f.path),
    claims: claims.map(({ text, type, verdict, detail }) => ({ text, type, verdict, detail })),
    notes,
    files: files.map(({ path: p, status, plus, minus, isTest, isApi, test, noPatch }) =>
      ({ path: p, status, plus, minus, isTest, isApi, ...(test ? { test } : {}), ...(noPatch ? { noPatch } : {}),
        ...(fence?.paths.length ? { inFence: inFence(p, fence.paths) } : {}) })),
  };
}

/** Aggregate numbers over measured PRs. Every ratio carries its own denominator. */
export function aggregate(results) {
  const n = results.length;
  const withIssue = results.filter((r) => r.request.source === 'issue');
  const withFence = results.filter((r) => r.outside !== null);
  const claims = results.flatMap((r) => r.claims);
  const checkable = claims.filter((c) => CHECKED_TYPES.includes(c.type));
  const checked = checkable.filter((c) => c.verdict !== 'unverified');
  const byType = Object.fromEntries(CHECKED_TYPES.map((t) => {
    const cs = checked.filter((c) => c.type === t);
    return [t, { checked: cs.length, true: cs.filter((c) => c.verdict === 'true').length, false: cs.filter((c) => c.verdict === 'false').length, partial: cs.filter((c) => c.verdict === 'partial').length }];
  }));
  const withChanges = results.filter((r) => r.filesChanged > 0).length;
  return {
    prs: n,
    withChanges,
    withLinkedIssue: withIssue.length,
    withFence: withFence.length,
    outsideFence: withFence.filter((r) => r.outside.count > 0).length,
    outsideFiles: withFence.reduce((s, r) => s + r.outside.count, 0),
    filesInFencedPrs: withFence.reduce((s, r) => s + r.filesChanged, 0),
    changedTests: results.filter((r) => r.tests.changed.length > 0).length,
    rewroteOrWeakenedTest: results.filter((r) => r.tests.rewrittenOrWeakened.length > 0).length,
    touchedApi: results.filter((r) => r.apiFiles.length > 0).length,
    prsWithCheckableClaim: results.filter((r) => r.claims.some((c) => CHECKED_TYPES.includes(c.type))).length,
    checkableClaims: checkable.length,
    checkedClaims: checked.length,
    contradicted: checked.filter((c) => c.verdict === 'false').length,
    partial: checked.filter((c) => c.verdict === 'partial').length,
    held: checked.filter((c) => c.verdict === 'true').length,
    byType,
    featureClaims: claims.length - checkable.length,
    filesChanged: results.reduce((s, r) => s + r.filesChanged, 0),
  };
}

const cell = (s) => String(s).replace(/\|/g, '\\|').replace(/\n/g, ' ');

/** Markdown table (one row per PR) followed by the aggregate numbers. */
export function markdownSummary(results, { skipped = [], stopped = null } = {}) {
  const rows = results.map((r) => {
    const req = r.request.source === 'issue' ? `#${r.request.number}` : 'missing';
    const fence = r.fence ? (r.fence.paths.length ? r.fence.paths.map((p) => `\`${p}\``).join(' ') : '(none)') : '—';
    const outside = r.outside === null ? '—' : String(r.outside.count);
    const cs = r.claims.filter((c) => CHECKED_TYPES.includes(c.type));
    const claims = cs.length ? cs.map((c) => `${c.type}:${c.verdict}`).join(', ') : '—';
    return `| [${r.repo}#${r.number}](${r.url}) | ${cell(r.author)} | ${req} | ${r.filesChanged} | +${r.plus} −${r.minus} | ${fence} | ${outside} | ${r.tests.changed.length} | ${r.tests.rewrittenOrWeakened.length} | ${r.apiFiles.length} | ${cell(claims)} |`;
  });
  const a = aggregate(results);
  const lines = [
    '| PR | author | request | files | +/− | suggested fence | outside | tests changed | tests rewritten/weakened | API files | checkable claims |',
    '|---|---|---|---:|---:|---|---:|---:|---:|---:|---|',
    ...rows,
    '',
    `- PRs measured: ${a.prs} (${a.withChanges} change at least one file; ${a.withLinkedIssue} link an issue; ${a.withFence} have a usable suggested fence)`,
    `- Changed files outside the suggested fence: ${a.outsideFence} of ${a.withFence} PRs (${a.outsideFiles} of ${a.filesInFencedPrs} files)`,
    `- Changed a test file: ${a.changedTests} of ${a.withChanges}; rewrote or weakened a test: ${a.rewroteOrWeakenedTest} of ${a.withChanges}`,
    `- Changed an API file: ${a.touchedApi} of ${a.withChanges}`,
    `- Checkable claims: ${a.checkableClaims} in ${a.prsWithCheckableClaim} PRs; checked ${a.checkedClaims}: ${a.held} true, ${a.contradicted} false, ${a.partial} partial`,
  ];
  if (skipped.length) lines.push(`- Skipped: ${skipped.map((s) => `${s.url} (${s.reason})`).join('; ')}`);
  if (stopped) lines.push(`- Stopped early: ${stopped}`);
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// network
// ---------------------------------------------------------------------------

export class RateLimitError extends Error {}

/** Minimal GitHub REST client: cache-first, reads X-RateLimit-* headers, never prints the token. */
export class GitHub {
  constructor({ token = process.env.GITHUB_TOKEN, cache = true, reserve = 4, log = () => {} } = {}) {
    this.token = token || null;
    this.cache = cache;
    this.reserve = reserve;
    this.log = log;
    this.remaining = { core: null, search: null };
    this.reset = { core: null, search: null };
    this.requests = 0;
    this.cacheHits = 0;
  }

  cacheFile(url) {
    return path.join(CACHE_DIR, crypto.createHash('sha1').update(url).digest('hex') + '.json');
  }

  async get(pathname, { resource = 'core' } = {}) {
    const url = pathname.startsWith('http') ? pathname : API + pathname;
    const file = this.cacheFile(url);
    if (this.cache && fs.existsSync(file)) {
      this.cacheHits++;
      return JSON.parse(fs.readFileSync(file, 'utf8'));
    }
    const left = this.remaining[resource];
    if (left !== null && left < (resource === 'core' ? this.reserve : 1)) {
      throw new RateLimitError(`${resource} limit nearly used (${left} left, resets ${resetTime(this.reset[resource])})`);
    }
    const headers = { accept: 'application/vnd.github+json', 'x-github-api-version': '2022-11-28', 'user-agent': 'overlook-scan' };
    if (this.token) headers.authorization = `Bearer ${this.token}`;
    const res = await fetch(url, { headers });
    this.requests++;
    const rem = res.headers.get('x-ratelimit-remaining');
    const res_ = res.headers.get('x-ratelimit-resource') ?? resource;
    if (rem !== null) {
      this.remaining[res_] = Number(rem);
      this.reset[res_] = Number(res.headers.get('x-ratelimit-reset'));
    }
    if ((res.status === 403 || res.status === 429) && (rem === '0' || res.headers.get('retry-after'))) {
      throw new RateLimitError(`${res_} rate limit reached (resets ${resetTime(this.reset[res_])})`);
    }
    if (!res.ok) {
      const body = await res.text();
      const err = new Error(`GET ${url.replace(API, '')}: ${res.status} ${body.slice(0, 160)}`);
      err.status = res.status;
      throw err;
    }
    const data = { body: await res.json(), link: res.headers.get('link') };
    fs.mkdirSync(CACHE_DIR, { recursive: true });
    fs.writeFileSync(file, JSON.stringify(data));
    return data;
  }

  async json(pathname, opts) {
    return (await this.get(pathname, opts)).body;
  }

  /** Follow Link rel="next" pages; returns the concatenated arrays. */
  async paginate(pathname, maxPages = 30) {
    const all = [];
    let next = pathname;
    for (let i = 0; next && i < maxPages; i++) {
      const { body, link } = await this.get(next);
      all.push(...body);
      next = link?.match(/<([^>]+)>;\s*rel="next"/)?.[1] ?? null;
    }
    return all;
  }
}

function resetTime(epoch) {
  return epoch ? new Date(epoch * 1000).toISOString() : 'unknown';
}

/** Fetch everything one PR needs and measure it. */
export async function scanPr(gh, url) {
  const ref = parsePrUrl(url);
  if (!ref) throw new Error(`not a pull request URL: ${url}`);
  const base = `/repos/${ref.owner}/${ref.repo}`;
  const pr = await gh.json(`${base}/pulls/${ref.number}`);
  const files = await gh.paginate(`${base}/pulls/${ref.number}/files?per_page=100`);
  const issueNumber = linkedIssue(pr.body, ref.owner, ref.repo);
  let issue = null;
  let tree = null;
  if (issueNumber) {
    try {
      issue = await gh.json(`${base}/issues/${issueNumber}`);
    } catch (err) {
      if (err instanceof RateLimitError) throw err;
      gh.log(`  issue #${issueNumber}: ${err.message}`);
    }
    if (issue && !issue.pull_request) tree = await gh.json(`${base}/git/trees/${pr.base.sha}?recursive=1`);
  }
  return measurePr({ url, pr, files, issue, tree, issueNumber });
}

/** PR URLs from an issue-search query, newest first, optionally filtered. */
export async function searchPrs(gh, query, { limit = 10, linked = false, onePerRepo = false } = {}) {
  const q = /\bis:pr\b|\btype:pr\b/.test(query) ? query : `is:pr ${query}`;
  const perPage = Math.min(100, linked || onePerRepo ? Math.max(limit * 4, 30) : limit);
  const data = await gh.json(`/search/issues?q=${encodeURIComponent(q)}&sort=created&order=desc&per_page=${perPage}`, { resource: 'search' });
  const seen = new Set();
  const urls = [];
  for (const item of data.items ?? []) {
    const ref = parsePrUrl(item.html_url);
    if (!ref) continue;
    const repoKey = `${ref.owner}/${ref.repo}`.toLowerCase();
    if (onePerRepo && seen.has(repoKey)) continue;
    if (linked && !linkedIssue(item.body, ref.owner, ref.repo)) continue;
    seen.add(repoKey);
    urls.push(item.html_url);
    if (urls.length >= limit) break;
  }
  return urls;
}

/** Scan a list of PR URLs; stops at the rate limit and returns what it has. */
export async function scan(gh, urls, { log = () => {} } = {}) {
  const results = [];
  const skipped = [];
  let stopped = null;
  for (const url of urls) {
    try {
      const r = await scanPr(gh, url);
      results.push(r);
      log(`  ${r.repo}#${r.number}: ${r.filesChanged} files, request ${r.request.source === 'issue' ? '#' + r.request.number : 'missing'}, outside ${r.outside?.count ?? '—'}`);
    } catch (err) {
      if (err instanceof RateLimitError) {
        stopped = `${err.message}; ${urls.length - results.length - skipped.length} PR(s) not scanned`;
        log(`  stopped: ${stopped}`);
        break;
      }
      skipped.push({ url, reason: err.message });
      log(`  skipped ${url}: ${err.message}`);
    }
  }
  return { results, skipped, stopped };
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

if (isMain(import.meta.url)) {
  const args = parseArgs(process.argv.slice(2));
  if (args.help || (!args.prs && !args.query)) {
    console.error(USAGE);
    process.exit(args.help ? 0 : 2);
  }
  const log = (s) => console.error(s);
  const gh = new GitHub({ cache: !args.noCache, reserve: Number(args.reserve ?? 4), log });
  let urls;
  const queries = [];
  try {
    if (args.prs) {
      urls = readPrList(fs.readFileSync(args.prs, 'utf8'));
    } else {
      queries.push(args.query);
      urls = await searchPrs(gh, args.query, { limit: Number(args.limit ?? 10), linked: Boolean(args.linked), onePerRepo: Boolean(args.onePerRepo) });
    }
  } catch (err) {
    console.error(`scan: ${err.message}`);
    process.exit(1);
  }
  log(`scanning ${urls.length} PR(s)${gh.token ? ' (authenticated)' : ' (unauthenticated: 60 requests/hour)'}`);
  const { results, skipped, stopped } = await scan(gh, urls, { log });
  const name = args.name ?? (args.prs ? path.basename(args.prs).replace(/\.[^.]+$/, '') : 'search');
  const out = path.join('out/scan', `${name}.json`);
  writeJson(out, {
    kind: 'overlook.scan/v1',
    generatedAt: new Date().toISOString(),
    input: args.prs ? { prs: args.prs } : { query: args.query, limit: Number(args.limit ?? 10), linked: Boolean(args.linked), onePerRepo: Boolean(args.onePerRepo) },
    rules: 'collect.isTestPath, collect.isApiPath, collect.analyzeTestDiff(parseDiff(patch)), draft-audit.extractClaims(reportText(body)), draft-audit.suggestFence(base tree + changed paths, issue title + body), build-city inFence/checkClaim',
    api: { requests: gh.requests, cacheHits: gh.cacheHits, remaining: gh.remaining },
    urls,
    aggregate: aggregate(results),
    skipped,
    stopped,
    results,
  });
  console.log(markdownSummary(results, { skipped, stopped }));
  log(`-> ${out} (${gh.requests} API request(s), ${gh.cacheHits} from cache, core remaining ${gh.remaining.core ?? '?'})`);
}
