import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));

function session() {
  const child = spawn(process.execPath, ['engine/mcp.mjs'], { cwd: ROOT });
  let buf = '';
  const waiting = new Map();
  child.stdout.on('data', (d) => {
    buf += d;
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const msg = JSON.parse(buf.slice(0, i));
      buf = buf.slice(i + 1);
      waiting.get(msg.id)?.(msg);
    }
  });
  let next = 1;
  const call = (method, params) => new Promise((ok) => {
    const id = next++;
    waiting.set(id, ok);
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
  });
  const tool = async (name, args) => {
    const r = await call('tools/call', { name, arguments: args });
    if (r.result.isError) throw new Error(r.result.content[0].text);
    return JSON.parse(r.result.content[0].text);
  };
  return { call, tool, close: () => child.kill() };
}

test('MCP: collect, build (publishes a map link) and receipt on the GT-142 sample', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'overlook-mcp-'));
  const repo = path.join(dir, 'gt142-sample-app');
  execFileSync('bash', [path.join(ROOT, 'samples/make-sample-repo.sh'), repo], { stdio: 'ignore' });
  const base = execFileSync('git', ['-C', repo, 'rev-list', '--max-parents=0', 'HEAD'], { encoding: 'utf8' }).trim();
  const s = session();
  let auditFile;
  try {
    const init = await s.call('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '0' } });
    assert.equal(init.result.serverInfo.name, 'overlook');
    const list = await s.call('tools/list');
    assert.deepEqual(list.result.tools.map((t) => t.name), ['overlook_collect', 'overlook_build', 'overlook_fence', 'overlook_verify', 'overlook_receipt', 'overlook_apply', 'overlook_audits']);

    const ev = path.join(dir, 'evidence.json');
    const collected = await s.tool('overlook_collect', { repo, base, src: '.', out: ev });
    assert.equal(collected.summary, '6 changed, 6 steps');

    const built = await s.tool('overlook_build', { evidence: ev, audit: 'samples/audit.sample.json', out: path.join(dir, 'city.json') });
    auditFile = path.join(ROOT, 'out', 'audits', `${built.auditId}.json`);
    assert.match(built.map, /\/audit\/[0-9a-f]{10}$/);
    assert.deepEqual([built.totals.outside, built.totals.affected], [4, 3]);
    assert.equal(built.claims.length, 4);

    const widened = await s.tool('overlook_fence', { audit_id: built.auditId, paths: ['src/articles/', 'src/shared/'] });
    assert.equal(widened.totals.outside, 2);

    const receipt = await s.tool('overlook_receipt', { audit_id: built.auditId });
    assert.match(receipt.markdown, /Bob explains; git decides/);

    const bad = await s.call('tools/call', { name: 'overlook_build', arguments: { evidence: ev, audit: 'nope.json' } });
    assert.equal(bad.result.isError, true);
  } finally {
    s.close();
    if (auditFile) fs.rmSync(auditFile, { force: true });
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
