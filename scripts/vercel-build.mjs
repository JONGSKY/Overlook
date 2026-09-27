// scripts/vercel-build.mjs — package a git binary for the Vercel Functions.
//
// The Vercel Node.js runtime has no `git`, but every audit clones and reads git history.
// This copies the portable git from the `dugite` package into gitbin/ (bin/git, the
// https remote helper, templates and a CA bundle) and, when the build image can
// resolve it, the libcurl chain the https helper links against. gitbin/ is shipped
// with every function via vercel.json "includeFiles"; engine/git-env.mjs wires it up.
// Runs once, as vercel.json "buildCommand". Do not also add it as an npm "vercel-build"
// script: the functions builder would run it again and delete dist/ while it is uploaded.

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const SRC = path.join(ROOT, 'node_modules', 'dugite', 'git');
const OUT = path.join(ROOT, 'gitbin');

if (!fs.existsSync(path.join(SRC, 'bin', 'git'))) {
  console.error('dugite git not found — run npm install first');
  process.exit(1);
}

fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(path.join(OUT, 'bin'), { recursive: true });
fs.mkdirSync(path.join(OUT, 'libexec'), { recursive: true });
fs.mkdirSync(path.join(OUT, 'lib'), { recursive: true });

const copy = (from, to) => { fs.copyFileSync(from, to); fs.chmodSync(to, 0o755); };
copy(path.join(SRC, 'bin', 'git'), path.join(OUT, 'bin', 'git'));
copy(path.join(SRC, 'libexec', 'git-core', 'git-remote-http'), path.join(OUT, 'libexec', 'git-remote-http'));
fs.cpSync(path.join(SRC, 'share', 'git-core', 'templates'), path.join(OUT, 'templates'), { recursive: true });
fs.copyFileSync(path.join(SRC, 'ssl', 'cacert.pem'), path.join(OUT, 'cacert.pem'));

// Bundle the shared libraries the https helper needs (libcurl and its chain), except
// the C runtime itself, so the helper also runs where the runtime image lacks libcurl.
const SKIP = /^(libc|libm|libdl|libpthread|librt|ld-linux[^/]*|linux-vdso)\.so/;
let copied = 0;
try {
  const out = execFileSync('ldd', [path.join(OUT, 'libexec', 'git-remote-http')], { encoding: 'utf8' });
  for (const line of out.split('\n')) {
    const m = line.match(/^\s*(\S+)\s+=>\s+(\/\S+)/);
    if (!m || SKIP.test(m[1])) continue;
    fs.copyFileSync(fs.realpathSync(m[2]), path.join(OUT, 'lib', m[1]));
    copied++;
  }
  if (/not found/.test(out)) console.warn('ldd: some libraries were not found:\n' + out);
} catch (e) {
  console.warn('ldd failed, shipping git without bundled libraries:', e.message);
}

const size = (d) => fs.readdirSync(d, { withFileTypes: true }).reduce((n, e) => n + (e.isDirectory() ? size(path.join(d, e.name)) : fs.statSync(path.join(d, e.name)).size), 0);
console.log(`gitbin ready: ${(size(OUT) / 1e6).toFixed(1)} MB, ${copied} shared libraries bundled`);

// Static output: the repository as it was served before (ui/, engine/, samples/ …),
// without node_modules or the git bundle, so the upload stays small.
const DIST = path.join(ROOT, 'dist');
const SKIP_TOP = new Set(['node_modules', 'gitbin', 'dist', '.git', '.vercel', 'out']);
fs.rmSync(DIST, { recursive: true, force: true });
fs.mkdirSync(DIST);
for (const name of fs.readdirSync(ROOT)) {
  if (SKIP_TOP.has(name)) continue;
  fs.cpSync(path.join(ROOT, name), path.join(DIST, name), { recursive: true });
}
console.log('static output ready in dist/');
