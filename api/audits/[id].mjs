// api/audits/[id].mjs — Vercel Serverless Function:
//   GET  /api/audits/<id>                   → { id, city }
//   POST /api/audits/<id>/receipt           → { markdown }
//   POST /api/audits/<id>/fence             → { id, city }
//
// /verify is not supported on Vercel (requires local git worktree + test runner).

import { readAudit, writeAudit } from '../../engine/audits.mjs';
import { renderReceipt } from '../../engine/pr-comment.mjs';
import { withFence } from '../../engine/core/city.mjs';

export default async function handler(req, res) {
  // Vercel populates req.query.id from the [id] filename pattern.
  // For sub-paths (/receipt, /fence, /verify) vercel.json rewrites the URL here,
  // so we extract the sub-path from req.url (which keeps the original path).
  const urlPath = req.url?.replace(/\?.*$/, '') ?? '';
  const m = urlPath.match(/\/api\/audits\/([0-9a-f]{10})(\/receipt|\/fence|\/verify)?$/);
  // Fallback: Vercel injects id via req.query when no sub-path is present.
  const id = m?.[1] ?? (typeof req.query?.id === 'string' ? req.query.id : null);
  const sub = m?.[2] ?? '';
  if (!id || !/^[0-9a-f]{10}$/.test(id)) return res.status(404).json({ error: 'Not found' });

  // Each Vercel Function has its own /tmp, so an audit saved by /api/audit is usually
  // not on disk here. The browser keeps the audit and sends its city with POST requests;
  // fence and receipt are pure functions of the city, so they work without the store.
  let doc = readAudit(id);

  // GET /api/audits/<id>
  if (req.method === 'GET' && !sub) {
    if (!doc) return res.status(404).json({ error: 'This audit is no longer on the server. Run the audit again from the start page.' });
    return res.status(200).json({ id: doc.id, city: doc.city });
  }

  let body;
  try { body = await readJson(req); } catch (e) { return res.status(400).json({ error: e.message }); }
  if (!doc && body.city && typeof body.city === 'object') doc = { id, city: body.city };
  if (!doc) return res.status(404).json({ error: 'Unknown audit' });

  // POST /api/audits/<id>/fence
  if (sub === '/fence' && req.method === 'POST') {
    const paths = (body.paths ?? []).map((x) => String(x).trim()).filter(Boolean);
    doc.city = withFence(doc.city, paths, body.rationale || 'Confirmed by the reviewer.');
    try { writeAudit(doc); } catch { /* stateless fallback */ }
    return res.status(200).json({ id: doc.id, city: doc.city });
  }

  // POST /api/audits/<id>/receipt
  if (sub === '/receipt' && req.method === 'POST') {
    const decisions = { base: doc.city.meta.base, head: doc.city.meta.head, decisions: body.decisions ?? {} };
    return res.status(200).json({ markdown: renderReceipt(doc.city, decisions) });
  }

  // /verify is not available on Vercel
  if (sub === '/verify') {
    return res.status(400).json({ error: 'Verify is not available on the hosted version. It requires a local git worktree and test runner. Run npm run site locally.' });
  }

  res.status(404).json({ error: 'Not found' });
}

function readJson(req) {
  return new Promise((ok, fail) => {
    let s = '';
    req.setEncoding('utf8');
    req.on('data', (c) => { s += c; if (s.length > 20e6) fail(new Error('Request too large')); });
    req.on('end', () => { try { ok(s ? JSON.parse(s) : {}); } catch { fail(new Error('Invalid JSON')); } });
  });
}
