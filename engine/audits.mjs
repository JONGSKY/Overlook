// audits.mjs — saved audits (out/audits/<id>.json), shared by the site and the MCP server.

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
export const AUDITS = path.join(ROOT, 'out', 'audits');

export function saveAudit(city, source = {}) {
  fs.mkdirSync(AUDITS, { recursive: true });
  const id = crypto.createHash('sha1').update(`${city.meta.repo}|${city.meta.base}|${city.meta.head}|${Date.now()}|${Math.random()}`).digest('hex').slice(0, 10);
  fs.writeFileSync(path.join(AUDITS, `${id}.json`), JSON.stringify({ id, createdAt: new Date().toISOString(), source, city }));
  return id;
}

export function writeAudit(doc) {
  fs.mkdirSync(AUDITS, { recursive: true });
  fs.writeFileSync(path.join(AUDITS, `${doc.id}.json`), JSON.stringify(doc));
  return doc;
}

/** Local repository behind an audit (folder, or the GitHub clone). */
export function auditRepo(doc) {
  return doc.source?.dir ?? doc.city?.meta?.source?.path ?? null;
}

export function readAudit(id) {
  if (!/^[0-9a-f]{10}$/.test(id)) return null;
  const file = path.join(AUDITS, `${id}.json`);
  return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : null;
}

export function listAudits(limit = 20) {
  if (!fs.existsSync(AUDITS)) return [];
  return fs.readdirSync(AUDITS)
    .filter((f) => f.endsWith('.json'))
    .map((f) => {
      try {
        const d = JSON.parse(fs.readFileSync(path.join(AUDITS, f), 'utf8'));
        const c = d.city;
        return { id: d.id, createdAt: d.createdAt, label: d.source?.label ?? c.meta.repo, title: c.request?.title, base: c.meta.base, head: c.meta.head, outside: c.totals.outside, claims: c.totals.claims, claimsTrue: c.totals.claimsTrue };
      } catch {
        return null;
      }
    })
    .filter(Boolean)
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
    .slice(0, limit);
}

export const auditUrl = (id, port = process.env.OVERLOOK_PORT ?? 4280) => `http://localhost:${port}/ui/#/audit/${id}`;
