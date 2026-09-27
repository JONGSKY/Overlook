// git-env.mjs — make a bundled git available where the machine has none (Vercel).
//
// scripts/vercel-build.mjs packages git into gitbin/. When that folder exists and the
// process runs on Vercel (or git is missing from PATH), this puts it on PATH with the
// environment a relocated git needs. Imported for its side effect before any git call.

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const GITBIN = path.resolve(fileURLToPath(new URL('../gitbin', import.meta.url)));

function hasSystemGit() {
  try { execFileSync('git', ['--version'], { stdio: 'ignore' }); return true; } catch { return false; }
}

if (fs.existsSync(path.join(GITBIN, 'bin', 'git')) && (process.env.VERCEL === '1' || !hasSystemGit())) {
  // The function bundle may drop symlinks and exec bits, so build the exec path in /tmp.
  const exec = path.join('/tmp', 'overlook-git-exec');
  fs.mkdirSync(exec, { recursive: true });
  const place = (name, target) => {
    const p = path.join(exec, name);
    if (!fs.existsSync(p)) { fs.copyFileSync(target, p); fs.chmodSync(p, 0o755); }
  };
  place('git', path.join(GITBIN, 'bin', 'git'));
  place('git-remote-http', path.join(GITBIN, 'libexec', 'git-remote-http'));
  place('git-remote-https', path.join(GITBIN, 'libexec', 'git-remote-http'));

  const env = process.env;
  env.PATH = `${exec}:${env.PATH || '/usr/bin:/bin'}`;
  env.GIT_EXEC_PATH = exec;
  env.GIT_TEMPLATE_DIR = path.join(GITBIN, 'templates');
  env.GIT_SSL_CAINFO = env.GIT_SSL_CAINFO || path.join(GITBIN, 'cacert.pem');
  env.GIT_CONFIG_NOSYSTEM = '1';
  env.GIT_TERMINAL_PROMPT = '0';
  if (!env.HOME || !isWritable(env.HOME)) env.HOME = '/tmp';
  const lib = path.join(GITBIN, 'lib');
  if (fs.existsSync(lib) && fs.readdirSync(lib).length) {
    // Bundled libraries go last so the runtime's own copies win when they exist.
    env.LD_LIBRARY_PATH = [env.LD_LIBRARY_PATH, '/lib64', '/usr/lib64', lib].filter(Boolean).join(':');
  }
}

function isWritable(dir) {
  try { fs.accessSync(dir, fs.constants.W_OK); return true; } catch { return false; }
}
