#!/usr/bin/env node
// collect.mjs — evidence from git (SPEC 3.1, 4.1).
//
// Every fact in evidence.json is computed from git by deterministic code:
// file lists, status, line counts, steps (commits), diffs, test rewrites and
// the import graph at head. Nothing here is decided by a model.

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const USAGE = `usage: node engine/collect.mjs --repo <path> --base <sha> [--head HEAD] [--src src] [--out out/evidence.json]

  --repo  git repository to audit
  --base  commit before the agent started (the task's base)
  --head  last commit of the agent's task (default HEAD)
  --src   folder to map (default "." = the whole repository, so tests outside
          src/ are audited too); pass e.g. --src src to narrow a large repo
  --out   output file (default out/evidence.json)`;

// Extensions whose non-blank lines count as LOC (SPEC 4.1).
const TEXT_EXT = new Set(['js', 'jsx', 'ts', 'tsx', 'mjs', 'cjs', 'vue', 'svelte', 'py', 'java', 'kt', 'go', 'rb',
  'php', 'cs', 'swift', 'css', 'scss', 'html', 'json', 'yml', 'yaml', 'md', 'sql',
  // infrastructure and configuration text, so env, build, CI and deploy files have a size too
  'tf', 'tfvars', 'hcl', 'toml', 'ini', 'cfg', 'conf', 'sh', 'bash', 'env', 'xml', 'graphql', 'gql', 'proto', 'rs',
  'less', 'sass', 'ejs', 'hbs', 'astro', 'mdx', 'txt']);
// Extensionless or dot files that are text: Dockerfile, Makefile, .env.example, .gitignore …
const TEXT_NAME = /^(Dockerfile[^/]*|Containerfile|Makefile|Procfile|Jenkinsfile|Gemfile|Brewfile|\.env[^/]*|\.gitignore|\.dockerignore|\.editorconfig|\.npmrc|\.nvmrc|\.node-version)$/;
// Files that take part in the import graph.
const CODE_EXT = new Set(['js', 'jsx', 'ts', 'tsx', 'mjs', 'cjs']);
// Extensions tried when resolving a relative import specifier, in order.
const RESOLVE_SUFFIXES = ['', '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '/index.ts', '/index.tsx', '/index.js'];
// Name tokens that mark an API file.
const API_TOKENS = new Set(['api', 'route', 'routes', 'controller', 'controllers', 'serializer', 'serializers',
  'handler', 'handlers', 'endpoint', 'endpoints']);

const DIFF_CAP = 60;

const ASSERTION_RE = /\b(expect|assert\w*|should|toBe|toEqual|toMatch\w*|assertEquals)\b/;
const SKIP_RES = [
  /\b(it|test|describe)\.skip\(/,
  /(^|[^\w$.])x(it|describe)\(/,
  /@Disabled\b/,
  /@Ignore\b/,
  /pytest\.mark\.skip/,
];

// ---------------------------------------------------------------------------
// git helpers
// ---------------------------------------------------------------------------

export function git(repo, args, { input, encoding = 'utf8' } = {}) {
  return execFileSync('git', ['-C', repo, ...args], {
    encoding: encoding === 'buffer' ? undefined : encoding,
    input,
    maxBuffer: 512 * 1024 * 1024,
    stdio: ['pipe', 'pipe', 'pipe'],
  });
}

function revParse(repo, rev) {
  return git(repo, ['rev-parse', '--verify', '--quiet', `${rev}^{commit}`]).trim();
}

function splitZ(out) {
  const parts = out.split('\0');
  if (parts[parts.length - 1] === '') parts.pop();
  return parts;
}

function pathspec(src) {
  return src === '.' ? ['.'] : [src];
}

function lsTree(repo, rev, src) {
  return splitZ(git(repo, ['ls-tree', '-r', '--name-only', '-z', rev, '--', ...pathspec(src)]));
}

// Read many blobs in one `git cat-file --batch` call. Returns Map path -> text | null.
function readBlobs(repo, rev, paths) {
  const result = new Map();
  if (paths.length === 0) return result;
  const input = paths.map((p) => `${rev}:${p}\n`).join('');
  const buf = git(repo, ['cat-file', '--batch'], { input, encoding: 'buffer' });
  let pos = 0;
  for (const p of paths) {
    const nl = buf.indexOf(10, pos);
    const header = buf.subarray(pos, nl).toString('utf8');
    pos = nl + 1;
    if (header.endsWith(' missing') || header.endsWith(' ambiguous')) {
      result.set(p, null);
      continue;
    }
    const size = Number(header.split(' ')[2]);
    result.set(p, buf.subarray(pos, pos + size).toString('utf8'));
    pos += size + 1; // content is followed by a newline
  }
  return result;
}

// ---------------------------------------------------------------------------
// classification
// ---------------------------------------------------------------------------

const ext = (p) => {
  const base = p.split('/').pop();
  const i = base.lastIndexOf('.');
  return i > 0 ? base.slice(i + 1).toLowerCase() : '';
};

export function isTestPath(p) {
  return /(^|\/)(__tests__|tests?|spec)\//.test(p) || /[._-](spec|test)\.[a-z]+$/.test(p);
}

export function isApiPath(p) {
  // A path segment or the file name contains an API token (camelCase, ".", "_" and "-" split tokens).
  return p.split('/').some((segment) =>
    segment
      .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .some((token) => API_TOKENS.has(token)));
}

function loc(p, text) {
  if (text == null || !(TEXT_EXT.has(ext(p)) || TEXT_NAME.test(p.split('/').pop()))) return 0;
  return text.split('\n').filter((line) => /\S/.test(line)).length;
}

// ---------------------------------------------------------------------------
// diff + test analysis
// ---------------------------------------------------------------------------

// Parse a unified diff into [["c"|"d"|"a"|"h", text]], dropping file headers.
export function parseDiff(text) {
  const rows = [];
  let inHunk = false;
  for (const line of text.split('\n')) {
    if (line.startsWith('@@')) {
      inHunk = true;
      rows.push(['h', line]);
    } else if (!inHunk) {
      continue; // diff --git, index, ---, +++, rename from/to, ...
    } else if (line.startsWith('+')) {
      rows.push(['a', line.slice(1)]);
    } else if (line.startsWith('-')) {
      rows.push(['d', line.slice(1)]);
    } else if (line.startsWith(' ')) {
      rows.push(['c', line.slice(1)]);
    } else if (line.startsWith('diff --git')) {
      inHunk = false;
    }
    // "\ No newline at end of file" and trailing empty lines are dropped.
  }
  return rows;
}

/** Branch that contains a commit, as a PR would name it ("main" for main~3); null if none. */
function branchOf(repo, sha) {
  try {
    const tips = git(repo, ['for-each-ref', '--format=%(refname:short) %(objectname)', 'refs/heads', 'refs/remotes/origin']).trim().split('\n').filter(Boolean);
    const exact = tips.find((l) => l.endsWith(' ' + sha));
    if (exact) return exact.split(' ')[0].replace(/^origin\//, '');
    const n = git(repo, ['name-rev', '--name-only', '--no-undefined', '--refs=refs/heads/*', '--refs=refs/remotes/origin/*', sha]).trim();
    return n.replace(/^remotes\/origin\//, '').replace(/[~^].*$/, '') || null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------- branch graph
// The picture around the audited range: the base branch, the audited branch, and a few other branches that were
// active at the same time. Only git; the order and the choice are fixed, so the same range gives the same graph.
const MAIN_BEFORE = 12, MAIN_AFTER = 30, OTHER_MAX = 5, OTHER_COMMITS = 5, CANDIDATES = 40;
const FMT = '%H%x1f%P%x1f%cI%x1f%an%x1f%s';

/** The pull request a commit subject names: a squash "Title (#123)" or a merge "Merge pull request #123 from …". */
export function prOfSubject(subject) {
  const m = /\(#(\d+)\)\s*$/.exec(subject) ?? /^Merge pull request #(\d+)\b/.exec(subject);
  return m ? Number(m[1]) : null;
}
function logCommits(repo, args) {
  const out = git(repo, ['log', `--format=${FMT}`, ...args]).trim();
  return out ? out.split('\n').map((line) => {
    const [sha, parents, date, author, message] = line.split('\x1f');
    const pr = prOfSubject(message);
    return { sha, parents: parents ? parents.split(' ') : [], date: new Date(date).toISOString(), author, message, ...(pr ? { pr } : {}) };
  }) : [];
}
const tryRev = (repo, rev) => { try { return revParse(repo, rev) || null; } catch { return null; } };
const isAncestor = (repo, a, b) => { try { git(repo, ['merge-base', '--is-ancestor', a, b]); return true; } catch { return false; } };

/** The default branch (main, then master) when it holds the commit: the usual base of a pull request. */
function defaultBranchHolding(repo, sha) {
  for (const name of ['main', 'master']) {
    for (const ref of [`refs/remotes/origin/${name}`, `refs/heads/${name}`]) {
      const tip = tryRev(repo, ref);
      if (tip && isAncestor(repo, sha, tip)) return name;
    }
  }
  return null;
}

/** Where the base branch's tip is: the name the caller gives, else the default branch, else the branch that holds base. */
function baseTip(repo, baseRef, baseSha) {
  for (const name of [baseRef, defaultBranchHolding(repo, baseSha), branchOf(repo, baseSha)].filter(Boolean)) {
    for (const ref of [`refs/remotes/origin/${name}`, `refs/heads/${name}`]) {
      const sha = tryRev(repo, ref);
      if (sha && isAncestor(repo, baseSha, sha)) return { name, sha };
    }
  }
  return null;
}

export function collectGraph(repo, { baseSha, headSha, steps, baseRef, headRef, pr }) {
  const stepOf = new Map(steps.map((s, i) => [s.sha, i + 1]));
  const byDate = (a, b) => a.date.localeCompare(b.date);
  const own = logCommits(repo, ['--first-parent', `${baseSha}..${headSha}`]);
  const [baseC] = logCommits(repo, ['-n', '1', baseSha]);
  const t0 = Date.parse(baseC.date), t1 = Date.parse(own[0]?.date ?? baseC.date);
  const pad = Math.max(86400e3, (t1 - t0) * 0.25);
  const inWindow = (d) => Date.parse(d) >= t0 - pad && Date.parse(d) <= t1 + pad;

  const tip = baseTip(repo, baseRef, baseSha);
  const lanes = [{ id: 'base', name: tip?.name ?? 'base', kind: 'base' }, { id: 'head', name: headRef || 'audited branch', kind: 'head', ...(pr ? { pr } : {}) }];
  const commits = new Map();
  // Files a commit outside the range touched (against its first parent), so a branch can be compared with the task.
  // For a commit outside the range: what it changed against its first parent, file by file (+/− lines), and a peek at
  // the first changed lines of its first files, so any commit in the picture can be read, not only the task's.
  const FILES_MAX = 40, PEEK_FILES = 4, PEEK_LINES = 6, EMPTY_TREE = '4b825dc642cb6eb9a060e54bf8d69288fbee4904';
  const touched = (c) => {
    try {
      const parent = c.parents[0] ?? EMPTY_TREE;
      const rows = git(repo, ['diff', '--no-renames', '--numstat', parent, c.sha]).trim().split('\n').filter(Boolean).map((l) => {
        const [plus, minus, ...p] = l.split('\t');
        return { path: p.join('\t'), plus: plus === '-' ? 0 : Number(plus), minus: minus === '-' ? 0 : Number(minus) };
      });
      const shown = rows.slice(0, FILES_MAX);
      const peek = {};
      for (const r of shown.slice(0, PEEK_FILES)) {
        const lines = [];
        for (const line of git(repo, ['diff', '--no-renames', '-U0', parent, c.sha, '--', r.path]).split('\n')) {
          if (lines.length >= PEEK_LINES) break;
          if (line.startsWith('@@')) lines.push(['h', line.replace(/^(@@[^@]*@@).*/, '$1')]);
          else if (/^[+-]/.test(line) && !/^(\+\+\+|---) /.test(line)) lines.push([line[0] === '+' ? 'a' : 'd', line.slice(1, 121)]);
        }
        if (lines.length) peek[r.path] = lines;
      }
      return { files: shown.map((r) => r.path), lines: shown.map((r) => [r.plus, r.minus]), ...(rows.length > FILES_MAX ? { moreFiles: rows.length - FILES_MAX } : {}), ...(Object.keys(peek).length ? { peek } : {}) };
    } catch { return { files: [] }; }
  };
  const put = (c, lane) => {
    if (commits.has(c.sha)) return;
    // A merge inside the range also keeps what it brought in (against its first parent): the work of the branch it merged.
    commits.set(c.sha, { ...c, lane, ...(stepOf.has(c.sha) ? { step: stepOf.get(c.sha), ...(c.parents.length > 1 ? touched(c) : {}) } : touched(c)) });
  };

  // The audited line first, so work committed straight onto the base branch still reads as the task's own row.
  for (const c of own.slice().reverse()) put(c, 'head');
  // Base lane: a stretch of history you can scroll along: up to 12 commits before base, then the first-parent line
  // after it, unbroken, up to 30 commits (plus the merge that brings head in, if later).
  for (const c of logCommits(repo, ['--first-parent', '-n', String(MAIN_BEFORE + 1), baseSha]).reverse()) put(c, 'base');
  if (tip) {
    const after = logCommits(repo, ['--first-parent', '--reverse', `${baseSha}..${tip.sha}`]);
    const mergedAt = after.find((c) => c.parents.slice(1).includes(headSha)); // a merge commit that brings head in
    const kept = after.slice(0, MAIN_AFTER);
    for (const c of kept) put(c, 'base');
    if (mergedAt) put(mergedAt, 'base');
    // work committed straight onto the base branch: head is on its first-parent line
    if (after.some((c) => c.sha === headSha)) lanes[1].direct = true;
  }
  // The task landing on the base branch: a merge of head, or a commit whose patch equals the task's (a squash of the
  // whole range, or one of its commits rebased). Those are the task itself, not someone else's work.
  const patchId = (c) => {
    try {
      const diff = git(repo, c.parents?.length ? ['diff', c.parents[0], c.sha] : ['show', '--format=', c.sha]);
      return diff.trim() ? git(repo, ['patch-id', '--stable'], { input: diff }).trim().split(' ')[0] || null : null;
    } catch { return null; }
  };
  const taskPatches = new Set([patchId({ sha: headSha, parents: [baseSha] }), ...steps.map((st) => patchId(logCommits(repo, ['-n', '1', st.sha])[0]))].filter(Boolean));
  for (const c of commits.values()) {
    if (c.lane !== 'base' || stepOf.has(c.sha) || Date.parse(c.date) <= t0) continue;
    if (c.parents.slice(1).includes(headSha) || taskPatches.has(patchId(c))) c.landed = true;
  }
  // Range commits merged in from elsewhere sit on the base lane.
  for (const s of steps) if (!commits.has(s.sha)) put(logCommits(repo, ['-n', '1', s.sha])[0], tip && isAncestor(repo, s.sha, tip.sha) ? 'base' : 'head');

  // Other branches active in the same period, nearest first.
  if (tip) {
    const skip = new Set([tip.name, headRef, 'HEAD'].filter(Boolean));
    const refs = git(repo, ['for-each-ref', '--sort=-committerdate', '--format=%(refname:short)\x1f%(objectname)\x1f%(committerdate:iso-strict)', 'refs/remotes/origin', 'refs/heads'])
      .trim().split('\n').filter(Boolean).map((l) => { const [ref, sha, date] = l.split('\x1f'); return { name: ref.replace(/^origin\//, ''), sha, date }; })
      .filter((r) => !skip.has(r.name) && !r.name.startsWith('pr/') && r.sha !== headSha && r.sha !== tip.sha);
    const seen = new Set();
    const mid = (t0 + t1) / 2;
    const candidates = refs.filter((r) => !seen.has(r.sha) && seen.add(r.sha) && Date.parse(r.date) >= t0 - pad)
      .sort((a, b) => Math.abs(Date.parse(a.date) - mid) - Math.abs(Date.parse(b.date) - mid)).slice(0, CANDIDATES);
    let n = 0;
    for (const r of candidates) {
      if (n >= OTHER_MAX) break;
      let fork;
      try { fork = git(repo, ['merge-base', tip.sha, r.sha]).trim(); } catch { continue; }
      if (isAncestor(repo, headSha, r.sha) || isAncestor(repo, r.sha, headSha)) continue; // the audited line itself
      const mine = logCommits(repo, ['--first-parent', `${fork}..${r.sha}`]);
      if (!mine.length || !mine.some((c) => inWindow(c.date))) continue;
      const id = `o${++n}`;
      lanes.push({ id, name: r.name, kind: 'other', merged: isAncestor(repo, r.sha, tip.sha), more: Math.max(0, mine.length - OTHER_COMMITS) });
      for (const c of mine.slice(0, OTHER_COMMITS).reverse()) put(c, id);
    }
  }
  return { lanes, commits: [...commits.values()].sort(byDate) };
}

/** Per-file +/- and diff rows of one commit: { path: { plus, minus, diff } }. */
function commitChanges(repo, sha, files) {
  if (!files.length) return {};
  const out = {};
  const text = git(repo, ['show', '--format=', '--no-color', '-U1', '-M', sha, '--', ...files]);
  for (const chunk of text.split(/^diff --git /m).slice(1)) {
    const plusPath = chunk.match(/^\+\+\+ b\/(.+)$/m)?.[1];
    const minusPath = chunk.match(/^--- a\/(.+)$/m)?.[1];
    const renameTo = chunk.match(/^rename to (.+)$/m)?.[1];
    const p = plusPath ?? renameTo ?? minusPath;
    if (!p) continue;
    const rows = parseDiff('diff --git ' + chunk);
    out[p] = {
      plus: rows.filter((r) => r[0] === 'a').length,
      minus: rows.filter((r) => r[0] === 'd').length,
      diff: capDiff(rows),
    };
  }
  return out;
}

function capDiff(rows) {
  if (rows.length <= DIFF_CAP) return rows;
  const kept = rows.slice(0, DIFF_CAP - 1);
  kept.push(['h', `… ${rows.length - kept.length} more lines`]);
  return kept;
}

export function analyzeTestDiff(rows) {
  let assertionsRemoved = 0;
  let assertionsAdded = 0;
  let skipsAdded = 0;
  for (const [kind, text] of rows) {
    if (kind === 'd' && ASSERTION_RE.test(text)) assertionsRemoved++;
    if (kind === 'a' && ASSERTION_RE.test(text)) assertionsAdded++;
    if (kind === 'a' && SKIP_RES.some((re) => re.test(text))) skipsAdded++;
  }
  return {
    assertionsRemoved,
    assertionsAdded,
    skipsAdded,
    rewritten: assertionsRemoved > 0 && assertionsAdded > 0,
    weakened: skipsAdded > 0 || assertionsRemoved > assertionsAdded,
  };
}

// ---------------------------------------------------------------------------
// import graph
// ---------------------------------------------------------------------------

const IMPORT_RES = [
  /\bimport\s+(?:[^'";]*?\s+from\s+)?['"]([^'"\n]+)['"]/g, // import x from '…', import '…'
  /\bexport\s+[^'";]*?\s+from\s+['"]([^'"\n]+)['"]/g,      // export … from '…'
  /\bimport\s*\(\s*['"]([^'"\n]+)['"]\s*\)/g,              // import('…')
  /\brequire\s*\(\s*['"]([^'"\n]+)['"]\s*\)/g,             // require('…')
];

export function importSpecifiers(source) {
  const specs = new Set();
  for (const re of IMPORT_RES) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(source))) specs.add(m[1]);
  }
  return [...specs];
}

// Resolve a relative specifier from `fromPath` against the set of files at head.
export function resolveImport(fromPath, spec, fileSet) {
  if (!spec.startsWith('./') && !spec.startsWith('../')) return null;
  const target = path.posix.normalize(path.posix.join(path.posix.dirname(fromPath), spec));
  for (const suffix of RESOLVE_SUFFIXES) {
    if (fileSet.has(target + suffix)) return target + suffix;
  }
  return null;
}

/** The statement in `source` that imports `spec`, on one line, e.g. "import { formatDate } from './formatDate';". */
export function importStatement(source, spec) {
  const at = Math.max(source.indexOf(`'${spec}'`), source.indexOf(`"${spec}"`), source.indexOf(`\`${spec}\``));
  if (at < 0) return null;
  const head = source.slice(0, at);
  const start = Math.max(head.lastIndexOf('import'), head.lastIndexOf('export'), head.lastIndexOf('require'));
  if (start < 0 || at - start > 400) return null;
  const end = source.indexOf('\n', at);
  return source.slice(start, end < 0 ? undefined : end).replace(/\s+/g, ' ').trim().slice(0, 200);
}

// Go: an import names a package, which is a folder of the module ("<module>/pkg/x" → pkg/x/), so a file that
// imports it depends on every non-test .go file in that folder. The module path comes from go.mod.
export function goImports(source) {
  const specs = [];
  for (const m of source.matchAll(/^\s*import\s+(?:[\w.]+\s+)?"([^"]+)"/gm)) specs.push(m[1]);
  for (const block of source.matchAll(/^\s*import\s*\(([\s\S]*?)\)/gm)) {
    for (const m of block[1].matchAll(/^\s*(?:[\w.]+\s+)?"([^"]+)"/gm)) specs.push(m[1]);
  }
  return [...new Set(specs)];
}
function goEdges(headFiles, headBlobs) {
  const goMod = headFiles.find((p) => p === 'go.mod') ?? headFiles.find((p) => p.endsWith('/go.mod'));
  const module = goMod && /^module\s+(\S+)/m.exec(headBlobs.get(goMod) ?? '')?.[1];
  if (!module) return [];
  const root = goMod.includes('/') ? goMod.slice(0, goMod.lastIndexOf('/') + 1) : '';
  const byDir = new Map();
  for (const p of headFiles) {
    if (!p.endsWith('.go') || p.endsWith('_test.go')) continue;
    const d = path.posix.dirname(p);
    (byDir.get(d) ?? byDir.set(d, []).get(d)).push(p);
  }
  const edges = [];
  for (const p of headFiles) {
    if (!p.endsWith('.go')) continue;
    const source = headBlobs.get(p);
    if (source == null) continue;
    for (const spec of goImports(source)) {
      if (spec !== module && !spec.startsWith(module + '/')) continue;
      const dir = (root + spec.slice(module.length + 1)).replace(/\/$/, '') || '.';
      for (const target of byDir.get(dir) ?? []) if (path.posix.dirname(p) !== dir) edges.push({ from: p, to: target, line: `import "${spec}"` });
    }
  }
  return edges;
}
// Python: "import a.b", "from a.b import c" and relative "from .x import y" resolve to a/b.py or a/b/__init__.py
// (also under src/); "from a.b import c" may name the submodule a/b/c.py too.
export function pythonImports(source) {
  const out = [];
  for (const m of source.matchAll(/^\s*from\s+(\.*[\w.]*)\s+import\s+([\w*, ()]+)/gm)) out.push({ mod: m[1], names: m[2].replace(/[()]/g, '').split(',').map((x) => x.trim().split(/\s+/)[0]).filter(Boolean), line: m[0].trim() });
  for (const m of source.matchAll(/^\s*import\s+([\w.]+(?:\s*,\s*[\w.]+)*)/gm)) for (const mod of m[1].split(',')) out.push({ mod: mod.trim(), names: [], line: m[0].trim() });
  return out;
}
function pythonEdges(headFiles, headBlobs, fileSet) {
  const resolve = (dotted) => {
    const rel = dotted.replace(/\./g, '/');
    for (const pre of ['', 'src/']) for (const cand of [`${pre}${rel}.py`, `${pre}${rel}/__init__.py`]) if (fileSet.has(cand)) return cand;
    return null;
  };
  const edges = [];
  for (const p of headFiles) {
    if (!p.endsWith('.py')) continue;
    const source = headBlobs.get(p);
    if (source == null) continue;
    for (const { mod, names, line } of pythonImports(source)) {
      let base = mod;
      if (mod.startsWith('.')) { // relative: one dot is this package
        const dots = /^\.+/.exec(mod)[0].length;
        let dir = path.posix.dirname(p).split('/');
        dir = dir.slice(0, Math.max(0, dir.length - (dots - 1)));
        base = [...dir.filter((x) => x && x !== '.'), mod.slice(dots)].filter(Boolean).join('.');
      }
      const targets = new Set([resolve(base), ...names.map((n) => resolve(`${base}.${n}`))].filter(Boolean));
      for (const t of targets) if (t !== p) edges.push({ from: p, to: t, line: line.slice(0, 200) });
    }
  }
  return edges;
}

// Returns { importedBy: Map path -> [paths that import it], uses: Map importer -> { changed target: import statement } }.
// The statements are kept only for imports of changed files: they are the evidence for "may be affected".
// JavaScript/TypeScript (relative imports), Go (packages of the module) and Python (modules of the repository).
function buildImportGraph(headFiles, headBlobs, changedSet = new Set()) {
  const fileSet = new Set(headFiles);
  const importedBy = new Map(headFiles.map((p) => [p, new Set()]));
  const uses = new Map();
  const link = (from, to, line) => {
    if (!to || to === from || !importedBy.has(to)) return;
    importedBy.get(to).add(from);
    if (changedSet.has(to) && line) (uses.get(from) ?? uses.set(from, {}).get(from))[to] = line;
  };
  for (const p of headFiles) {
    if (!CODE_EXT.has(ext(p))) continue;
    const source = headBlobs.get(p);
    if (source == null) continue;
    for (const spec of importSpecifiers(source)) link(p, resolveImport(p, spec, fileSet), importStatement(source, spec));
  }
  for (const e of goEdges(headFiles, headBlobs)) link(e.from, e.to, e.line);
  for (const e of pythonEdges(headFiles, headBlobs, fileSet)) link(e.from, e.to, e.line);
  return { importedBy: new Map([...importedBy].map(([k, v]) => [k, [...v].sort()])), uses };
}

// ---------------------------------------------------------------------------
// collect
// ---------------------------------------------------------------------------

/**
 * Collect evidence for base..head.
 * @param {{repo: string, base: string, head?: string, src?: string}} opts
 * @returns evidence object (SPEC 3.1)
 */
export function collect({ repo, base, head = 'HEAD', src, baseRef, headRef, pr, graph = true }) {
  repo = path.resolve(repo);
  const baseSha = revParse(repo, base);
  const headSha = revParse(repo, head);
  // Default: the whole repository, so tests outside src/ (test/, tests/, spec/) are audited too.
  if (!src) src = '.';
  src = src === '.' || src === './' ? '.' : src.replace(/^\.\//, '').replace(/\/+$/, '');
  const inScope = (p) => src === '.' || p === src || p.startsWith(src + '/');

  const baseFiles = lsTree(repo, baseSha, src);
  const headFiles = lsTree(repo, headSha, src);

  // Status (A/M/D/R) with rename detection.
  const status = new Map(); // path at head (or base for deleted) -> { status, from }
  const ns = splitZ(git(repo, ['diff', '--name-status', '-z', '-M', baseSha, headSha, '--', ...pathspec(src)]));
  for (let i = 0; i < ns.length;) {
    const code = ns[i++];
    if (code[0] === 'R' || code[0] === 'C') {
      const from = ns[i++];
      const to = ns[i++];
      status.set(to, code[0] === 'R' ? { status: 'renamed', from } : { status: 'added' });
    } else {
      const p = ns[i++];
      status.set(p, { status: { A: 'added', M: 'modified', D: 'deleted', T: 'modified' }[code[0]] ?? 'modified' });
    }
  }

  // Plus/minus counts.
  const numstat = new Map();
  const nm = splitZ(git(repo, ['diff', '--numstat', '-z', '-M', baseSha, headSha, '--', ...pathspec(src)]));
  for (let i = 0; i < nm.length;) {
    const [plus, minus, p] = nm[i++].split('\t');
    let key = p;
    if (p === '') { i++; key = nm[i++]; } // rename: "+\t-\t\0old\0new\0"
    numstat.set(key, { plus: plus === '-' ? 0 : Number(plus), minus: minus === '-' ? 0 : Number(minus) });
  }

  // Steps: one per commit in base..head, files filtered to the mapped folder. A merge (of the base branch into the
  // task's branch, say) touches no file of its own: `merge: true`, and the graph keeps what it brought in.
  const steps = [];
  const logOut = git(repo, ['log', '--reverse', '--format=%H%x1f%s%x1f%an%x1f%cI%x1f%P', `${baseSha}..${headSha}`]).trim();
  for (const line of logOut ? logOut.split('\n') : []) {
    const [sha, message, author, date, parents] = line.split('\x1f');
    const files = splitZ(git(repo, ['diff-tree', '--no-commit-id', '--name-only', '-r', '-z', sha])).filter(inScope);
    steps.push({ sha, message, author, date: new Date(date).toISOString(), files, changes: commitChanges(repo, sha, files), ...(parents.split(' ').length > 1 ? { merge: true } : {}) });
  }
  const firstStep = (p) => {
    const i = steps.findIndex((s) => s.files.includes(p));
    return i === -1 ? null : i + 1;
  };

  // All paths: head files plus files deleted since base. Renamed-from paths are folded into their target.
  const renamedFrom = new Set([...status.values()].filter((s) => s.from).map((s) => s.from));
  const headSet = new Set(headFiles);
  const allPaths = [...headFiles, ...baseFiles.filter((p) => !headSet.has(p) && !renamedFrom.has(p))].sort();

  // Blob contents for LOC and the import graph.
  const headBlobs = readBlobs(repo, headSha, headFiles);
  const baseSet = new Set(baseFiles);
  const basePaths = allPaths.map((p) => status.get(p)?.from ?? p).filter((p) => baseSet.has(p));
  const baseBlobs = readBlobs(repo, baseSha, basePaths);
  const changedSet = new Set([...status].filter(([, v]) => v.status && v.status !== 'unchanged').map(([k]) => k));
  const { importedBy, uses } = buildImportGraph(headFiles, headBlobs, changedSet);

  const files = allPaths.map((p) => {
    const st = status.get(p) ?? { status: 'unchanged' };
    const changed = st.status !== 'unchanged';
    const basePath = st.from ?? p;
    const isTest = isTestPath(p);
    const file = {
      path: p,
      status: st.status,
      ...(st.from ? { from: st.from } : {}),
      locBefore: loc(basePath, baseBlobs.get(basePath)),
      locAfter: loc(p, headBlobs.get(p)),
      plus: numstat.get(p)?.plus ?? 0,
      minus: numstat.get(p)?.minus ?? 0,
      step: changed ? (firstStep(p) ?? (st.from ? firstStep(st.from) : null)) : null,
      isTest,
      isApi: isApiPath(p),
      importedBy: importedBy.get(p) ?? [],
      ...(uses.has(p) ? { uses: uses.get(p) } : {}),
      diff: [],
      test: null,
    };
    if (changed) {
      const paths = st.from ? [st.from, p] : [p];
      const rows = parseDiff(git(repo, ['diff', '-U1', '-M', baseSha, headSha, '--', ...paths]));
      file.diff = capDiff(rows);
      if (isTest) file.test = analyzeTestDiff(rows);
    }
    return file;
  });

  // generatedAt is the head commit's committer date so the same range always yields the same evidence.
  const generatedAt = new Date(git(repo, ['show', '-s', '--format=%cI', headSha]).trim()).toISOString();

  const refs = { base: baseRef ?? defaultBranchHolding(repo, baseSha) ?? branchOf(repo, baseSha), head: headRef ?? branchOf(repo, headSha) };
  let branchGraph;
  if (graph) {
    try { branchGraph = collectGraph(repo, { baseSha, headSha, steps, baseRef: refs.base, headRef: refs.head, pr }); } catch { /* a shallow or odd clone: no picture */ }
  }
  return {
    kind: 'overlook.evidence/v1',
    generatedAt,
    repo: path.basename(repo),
    base: baseSha,
    head: headSha,
    refs,
    src,
    steps,
    ...(branchGraph ? { graph: branchGraph } : {}),
    files,
  };
}

export function summarize(evidence) {
  const changed = evidence.files.filter((f) => f.status !== 'unchanged').length;
  return `${changed} changed, ${evidence.steps.length} steps`;
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

export function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '-h' || a === '--help') { args.help = true; continue; }
    if (!a.startsWith('--')) throw new Error(`unexpected argument: ${a}`);
    const key = a.slice(2).replace(/-([a-z])/g, (_, c) => c.toUpperCase());
    const next = argv[i + 1];
    if (next === undefined || next.startsWith('--')) args[key] = true;
    else { args[key] = next; i++; }
  }
  return args;
}

export function isMain(metaUrl) {
  if (!process.argv[1]) return false;
  try {
    return fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(metaUrl));
  } catch {
    return false;
  }
}

export function writeJson(file, data) {
  fs.mkdirSync(path.dirname(path.resolve(file)), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data, null, 2) + '\n');
}

if (isMain(import.meta.url)) {
  try {
    const args = parseArgs(process.argv.slice(2));
    if (args.help || !args.repo || !args.base) {
      console.error(USAGE);
      process.exit(args.help ? 0 : 2);
    }
    const out = args.out ?? 'out/evidence.json';
    const evidence = collect({ repo: args.repo, base: args.base, head: args.head ?? 'HEAD', src: args.src });
    writeJson(out, evidence);
    console.log(`${summarize(evidence)} -> ${out}`);
  } catch (err) {
    console.error(`collect: ${err.stderr?.toString().trim() || err.message}`);
    process.exit(1);
  }
}
