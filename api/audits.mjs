// api/audits.mjs — Vercel Serverless Function: GET /api/audits
// Returns the list of recent audits saved in /tmp on this function instance.
// Note: Vercel function instances are ephemeral — the list is per-instance only.

import { listAudits } from '../engine/audits.mjs';

export default function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  res.status(200).json(listAudits());
}
