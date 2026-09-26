// api/source.mjs — Vercel Serverless Function: POST /api/source
// Resolves a GitHub URL to a clone, returns { label, base, head, pr, commits }.
// Local-folder mode is not available on Vercel (no filesystem persistence).

import { enrichGraphPrs, listCommits, parseGithubUrl, resolveGithub } from '../engine/sources.mjs';
import { ROOT } from '../engine/audits.mjs';

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

  res.status(200).json({
    label: src.label,
    dir: src.dir,
    base: src.base,
    baseReason: src.baseReason ?? '',
    head: src.head,
    pr: src.pr,
    commits: listCommits(src.dir, src.head, 60),
  });
}

function readJson(req) {
  return new Promise((ok, fail) => {
    let s = '';
    req.setEncoding('utf8');
    req.on('data', (c) => { s += c; if (s.length > 5e6) fail(new Error('Request too large')); });
    req.on('end', () => { try { ok(s ? JSON.parse(s) : {}); } catch { fail(new Error('Invalid JSON')); } });
  });
}
