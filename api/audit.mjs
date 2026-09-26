// api/audit.mjs — Vercel Serverless Function: POST /api/audit
// Full audit pipeline: clone → collect evidence → build city → save → return { id, city }.
// Local-folder mode is not available on Vercel.

import { buildCity } from '../engine/build-city.mjs';
import { collect, git } from '../engine/collect.mjs';
import { draftAudit } from '../engine/draft-audit.mjs';
import { saveAudit } from '../engine/audits.mjs';
import { ROOT } from '../engine/audits.mjs';
import { enrichGraphPrs, listCommits, parseGithubUrl, resolveGithub } from '../engine/sources.mjs';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  let body;
  try { body = await readJson(req); } catch (e) { return res.status(400).json({ error: e.message }); }

  if (body.folder) return res.status(400).json({ error: 'Local folder mode is not available on the hosted version. Run npm run site locally.' });
  if (!body.github) return res.status(400).json({ error: 'Give a GitHub URL.' });

  const gh = parseGithubUrl(body.github);
  if (!gh) return res.status(400).json({ error: 'That does not look like a GitHub URL. Try https://github.com/owner/repo/pull/123' });

  let src;
  try {
    src = await resolveGithub(gh, ROOT);
  } catch (e) {
    return res.status(502).json({ error: `Could not fetch ${gh.owner}/${gh.repo}: ${String(e.stderr || e.message).trim().split('\n').pop()}` });
  }

  const head = body.head || src.head;
  const base = body.base || src.base;
  if (!base) return res.status(400).json({ error: 'Pick the base commit: the commit before the agent started.' });

  let evidence;
  try {
    evidence = collect({
      repo: src.dir,
      base,
      head,
      src: body.src || undefined,
      baseRef: src.refs?.base ?? undefined,
      headRef: (!body.head || body.head === src.head) ? src.refs?.head ?? undefined : undefined,
    });
  } catch (e) {
    return res.status(400).json({ error: `git: ${String(e.message).split('\n')[0]}` });
  }

  if (evidence.files.length > 4000) {
    return res.status(400).json({ error: `That maps ${evidence.files.length} files. Choose a smaller folder to map (for example src).` });
  }

  if (body.github && evidence.graph) await enrichGraphPrs(evidence.graph, gh, src.pr);
  evidence.repo = src.label;

  const issue = src.pr?.issue;
  const subjects = evidence.steps.map((st) => st.message);
  const messages = () => {
    try { return git(src.dir, ['log', '--reverse', '--format=%B', `${evidence.base}..${evidence.head}`]).trim(); }
    catch { return subjects.join('. '); }
  };
  const request = body.request?.trim() || (issue ? `${issue.title}\n\n${issue.body}` : src.pr?.title) || subjects.at(-1) || '';
  const report  = body.report?.trim()  || src.pr?.body?.trim() || messages();
  const title   = body.title?.trim()   || issue?.title || src.pr?.title || subjects.at(-1) || src.label;

  const audit = body.audit && body.audit.kind === 'overlook.audit/v1'
    ? body.audit
    : draftAudit(evidence, { id: src.pr ? `#${src.label.split('#').pop()}` : '', title, request, report, fence: body.fence });

  const city = buildCity(evidence, audit);
  city.meta.source = { type: 'github', url: body.github };
  city.meta.refs = {
    base: src.refs?.base ?? city.meta.refs?.base ?? null,
    head: (!body.head || body.head === src.head) && src.refs?.head ? src.refs.head : city.meta.refs?.head ?? null,
  };
  if (src.pr?.url) city.meta.prUrl = src.pr.url;
  if (!body.audit && (body.fence ?? []).some((p) => String(p).trim())) city.meta.fenceSetBy = 'reviewer';

  const id = saveAudit(city, { label: src.label, github: body.github, dir: src.dir });
  res.status(200).json({ id, city });
}

function readJson(req) {
  return new Promise((ok, fail) => {
    let s = '';
    req.setEncoding('utf8');
    req.on('data', (c) => { s += c; if (s.length > 20e6) fail(new Error('Request too large')); });
    req.on('end', () => { try { ok(s ? JSON.parse(s) : {}); } catch { fail(new Error('Invalid JSON')); } });
  });
}
