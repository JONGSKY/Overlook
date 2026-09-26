#!/usr/bin/env node
// site.mjs — the Overlook site: the UI in ui/ plus a local API that audits a GitHub URL or a folder.
//
//   node engine/site.mjs [--port 4280]
//
// Binds to 127.0.0.1 only: the API reads local folders and runs git.
//
//   GET  /api/health
//   GET  /api/folders?path=<dir>            folder picker
//   POST /api/source  { github } | { folder }   -> range suggestion + recent commits
//   POST /api/audit   { github|folder, base, head, src?, title?, request?, report?, fence?, audit? }
//   GET  /api/audits                        recent audits
//   GET  /api/audits/<id>                   city.json of one audit
//   POST /api/audits/<id>/receipt { decisions }  -> PR comment markdown

import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { buildCity } from './build-city.mjs';
import { collect, git, isMain, parseArgs } from './collect.mjs';
import { draftAudit } from './draft-audit.mjs';
import { renderReceipt } from './pr-comment.mjs';
import { ROOT, auditRepo, listAudits, readAudit as loadAudit, saveAudit, writeAudit } from './audits.mjs';
import { applyRuns, withFence } from './core/city.mjs';
import { afterReverts, crossTests, runChecks } from './verify.mjs';
import { enrichGraphPrs, listCommits, listFolders, parseGithubUrl, resolveFolder, resolveGithub } from './sources.mjs';

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.md': 'text/plain; charset=utf-8' };

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

async function resolveSource(body) {
  if (body.github) {
    const gh = parseGithubUrl(body.github);
    if (!gh) throw new HttpError(400, 'That does not look like a GitHub URL. Try https://github.com/owner/repo/pull/123');
    try {
      return await resolveGithub(gh, ROOT);
    } catch (e) {
      throw new HttpError(502, `Could not fetch ${gh.owner}/${gh.repo}: ${String(e.stderr || e.message).trim().split('\n').pop()}`);
    }
  }
  if (body.folder) {
    try {
      return resolveFolder(body.folder);
    } catch (e) {
      throw new HttpError(400, e.message);
    }
  }
  throw new HttpError(400, 'Give a GitHub URL or a folder.');
}

async function api(req, url) {
  const body = req.method === 'POST' ? await readJson(req) : {};
  const p = url.pathname;

  if (p === '/api/health') return { ok: true };

  if (p === '/api/folders') {
    try {
      return listFolders(url.searchParams.get('path') || '');
    } catch (e) {
      throw new HttpError(400, e.message);
    }
  }

  if (p === '/api/source' && req.method === 'POST') {
    const src = await resolveSource(body);
    return {
      label: src.label,
      dir: src.dir,
      base: src.base,
      baseReason: src.baseReason ?? '',
      head: src.head,
      pr: src.pr,
      commits: listCommits(src.dir, src.head, 60),
    };
  }

  if (p === '/api/audit' && req.method === 'POST') {
    const src = await resolveSource(body);
    const head = body.head || src.head;
    const base = body.base || src.base;
    if (!base) throw new HttpError(400, 'Pick the base commit: the commit before the agent started.');
    let evidence;
    try {
      evidence = collect({ repo: src.dir, base, head, src: body.src || undefined, baseRef: src.refs?.base ?? undefined, headRef: (!body.head || body.head === src.head) ? src.refs?.head ?? undefined : undefined });
    } catch (e) {
      throw new HttpError(400, `git: ${String(e.message).split('\n')[0]}`);
    }
    if (evidence.files.length > 4000) throw new HttpError(400, `That maps ${evidence.files.length} files. Choose a smaller folder to map (for example src).`);
    if (body.github && evidence.graph) await enrichGraphPrs(evidence.graph, parseGithubUrl(body.github), src.pr);
    evidence.repo = src.label;
    // Anything left empty comes from the link: the issue the PR closes is the request, the PR description the
    // report; without a PR, the commit messages of the range are the report.
    const issue = src.pr?.issue;
    const subjects = evidence.steps.map((st) => st.message);
    const messages = () => { try { return git(src.dir, ['log', '--reverse', '--format=%B', `${evidence.base}..${evidence.head}`]).trim(); } catch { return subjects.join('. '); } };
    const request = body.request?.trim() || (issue ? `${issue.title}\n\n${issue.body}` : src.pr?.title) || subjects.at(-1) || '';
    const report = body.report?.trim() || src.pr?.body?.trim() || messages();
    const title = body.title?.trim() || issue?.title || src.pr?.title || subjects.at(-1) || src.label;
    const audit = body.audit && body.audit.kind === 'overlook.audit/v1'
      ? body.audit
      : draftAudit(evidence, { id: src.pr ? `#${src.label.split('#').pop()}` : '', title, request, report, fence: body.fence });
    const city = buildCity(evidence, audit);
    city.meta.source = body.github ? { type: 'github', url: body.github } : { type: 'folder', path: src.dir };
    city.meta.refs = { base: src.refs?.base ?? city.meta.refs?.base ?? null, head: (!body.head || body.head === src.head) && src.refs?.head ? src.refs.head : city.meta.refs?.head ?? null };
    if (src.pr?.url) city.meta.prUrl = src.pr.url;
    if (!body.audit && (body.fence ?? []).some((p) => String(p).trim())) city.meta.fenceSetBy = 'reviewer';
    const id = saveAudit(city, { label: src.label, github: body.github, folder: body.folder, dir: src.dir });
    return { id, city };
  }

  if (p === '/api/audits') return listAudits();

  function readAudit(id) {
    const doc = loadAudit(id);
    if (!doc) throw new HttpError(404, 'Unknown audit');
    return doc;
  }

  const m = p.match(/^\/api\/audits\/([^/]+)(\/receipt|\/fence|\/verify)?$/);
  if (m) {
    const doc = readAudit(m[1]);
    if (m[2] === '/fence' && req.method === 'POST') {
      const paths = (body.paths ?? []).map((x) => String(x).trim()).filter(Boolean);
      doc.city = withFence(doc.city, paths, body.rationale || 'Confirmed by the reviewer.');
      writeAudit(doc);
      return { id: doc.id, city: doc.city };
    }
    if (m[2] === '/verify' && req.method === 'POST') {
      const repo = auditRepo(doc);
      if (!repo || !fs.existsSync(repo)) throw new HttpError(400, 'The repository for this audit is not on this machine any more.');
      const { base, head } = doc.city.meta;
      const opts = { repo, base, head, command: body.command || undefined };
      let run;
      if (body.kind === 'cross') run = { cross: await crossTests(opts) };
      else if (body.kind === 'reverts') run = { reverts: await afterReverts({ ...opts, decisions: body.decisions ?? {} }) };
      else if (body.kind === 'checks') {
        const checks = doc.city.claims.filter((c) => c.check?.command).map((c) => ({ text: typeof c.text === 'string' ? c.text : c.text.en, command: c.check.command }));
        if (!checks.length) throw new HttpError(400, 'No claim in this audit has an executable check. The Overlook Auditor mode adds them (feature-check skill).');
        run = { checks: await runChecks({ repo, head, checks }) };
      } else throw new HttpError(400, 'kind must be cross, reverts or checks');
      doc.city = applyRuns(doc.city, { ...(doc.city.runs ?? {}), ...run });
      writeAudit(doc);
      return { id: doc.id, city: doc.city, run: Object.values(run)[0] };
    }
    if (m[2] && req.method === 'POST') {
      const decisions = { base: doc.city.meta.base, head: doc.city.meta.head, decisions: body.decisions ?? {} };
      return { markdown: renderReceipt(doc.city, decisions) };
    }
    return { id: doc.id, city: doc.city };
  }

  throw new HttpError(404, 'Not found');
}

function readJson(req) {
  return new Promise((ok, fail) => {
    let s = '';
    req.setEncoding('utf8');
    req.on('data', (c) => {
      s += c;
      if (s.length > 20e6) fail(new HttpError(413, 'Request too large'));
    });
    req.on('end', () => {
      try {
        ok(s ? JSON.parse(s) : {});
      } catch {
        fail(new HttpError(400, 'Invalid JSON'));
      }
    });
  });
}

function serveStatic(res, url) {
  const rel = decodeURIComponent(url.pathname);
  // The app's clean paths (/, /sample, /sample/<id>, /audit/<id>) all load the app; it routes on the path.
  if (/^\/(index\.html|ui|main|examples|sample(\/[a-z0-9-]+)?|audit\/[0-9a-f]{10})?\/?$/.test(rel)) {
    res.writeHead(200, { 'content-type': TYPES['.html'], 'cache-control': 'no-store' });
    return fs.createReadStream(path.join(ROOT, 'ui', 'index.html')).pipe(res);
  }
  const file = path.normalize(path.join(ROOT, rel));
  const allowed = [path.join(ROOT, 'ui'), path.join(ROOT, 'samples'), path.join(ROOT, 'engine', 'core')];
  if (!allowed.some((a) => file.startsWith(a + path.sep))) return res.writeHead(404).end('Not found');
  let target = file;
  try {
    if (fs.statSync(target).isDirectory()) target = path.join(target, 'index.html');
    fs.statSync(target);
  } catch {
    return res.writeHead(404, { 'content-type': 'text/plain' }).end('Not found');
  }
  res.writeHead(200, { 'content-type': TYPES[path.extname(target)] ?? 'application/octet-stream', 'cache-control': 'no-store' });
  fs.createReadStream(target).pipe(res);
}

export function createSite() {
  return http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    if (!url.pathname.startsWith('/api/')) return serveStatic(res, url);
    try {
      const out = await api(req, url);
      res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' }).end(JSON.stringify(out));
    } catch (e) {
      res.writeHead(e.status ?? 500, { 'content-type': 'application/json; charset=utf-8' }).end(JSON.stringify({ error: e.message }));
    }
  });
}

if (isMain(import.meta.url)) {
  const args = parseArgs(process.argv.slice(2));
  const port = Number(args.port ?? process.env.PORT ?? 4280);
  createSite().listen(port, '127.0.0.1', () => console.log(`Overlook: http://localhost:${port}/`));
}
