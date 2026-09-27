// api/health.mjs — Vercel Serverless Function: GET /api/health
//
// The site asks this before it offers to audit a link. An audit clones the repository, so without a git binary
// (the default Vercel runtime has none) the answer is ok:false and the page opens in examples mode instead of
// letting a visitor paste a link that can only fail.
import { execFileSync } from 'node:child_process';

let hasGit = null;
function gitAvailable() {
  if (hasGit === null) {
    try { execFileSync('git', ['--version'], { stdio: 'ignore' }); hasGit = true; } catch { hasGit = false; }
  }
  return hasGit;
}

export default function handler(req, res) {
  if (!gitAvailable()) return res.status(200).json({ ok: false, reason: 'git is not available on this host; auditing a link needs the local server (npm run site).' });
  res.status(200).json({ ok: true });
}
