import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// The real examples (samples/real/) are built from public repositories by build-real.mjs, which needs the
// network. These checks run on the committed output: the request and the report must be quoted, not paraphrased,
// and every example must say where it comes from and who wrote its fence.
const DIR = fileURLToPath(new URL('../../samples/real/', import.meta.url));
const read = (p) => JSON.parse(fs.readFileSync(path.join(DIR, p), 'utf8'));
const index = read('index.json');

test('real examples: index.json matches the built cities', () => {
  assert.ok(index.length >= 3);
  for (const e of index) {
    const city = read(`${e.id}.city.json`);
    assert.equal(city.totals.filesChanged, e.changed, e.id);
    assert.equal(city.totals.outside, e.outside, e.id);
    assert.equal(city.totals.claimsTrue, e.claimsTrue, e.id);
    assert.equal(city.meta.sample, false, `${e.id} is real data, not a sample`);
  }
});

test('real examples: every claim is a verbatim quote of the agent report, and the source is named', () => {
  for (const e of index) {
    const audit = read(`${e.id}/audit.json`);
    for (const c of audit.claims) assert.ok(audit.bobReport.includes(c.text), `${e.id}: claim not verbatim: ${c.text}`);
    for (const k of ['kind', 'repo', 'url', 'auditor']) assert.ok(audit.example?.[k], `${e.id}: example.${k}`);
    assert.match(audit.example.url, /^https:\/\/github\.com\//);
  }
});

test('real examples: repositories without a licence carry no code', () => {
  for (const e of index) {
    const audit = read(`${e.id}/audit.json`);
    if (!audit.example.redacted) continue;
    const city = read(`${e.id}.city.json`);
    for (const f of city.files) for (const [kind] of f.diff ?? []) assert.equal(kind, 'h', `${e.id}: ${f.path} has code lines`);
  }
});
