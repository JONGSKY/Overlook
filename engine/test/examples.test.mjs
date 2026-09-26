// The three scripted examples in samples/examples (infra-drift, monorepo-scale, clean-pass):
// committed city data is fresh and deterministic, audits follow the schema, and the headline
// numbers tell the story each example was designed for.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { collect } from '../collect.mjs';
import { buildCity } from '../build-city.mjs';
import { EXAMPLES, makeExample } from '../../samples/examples/make-examples.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const DIR = path.join(ROOT, 'samples/examples');
const read = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));
const SCHEMA = read(path.join(ROOT, 'schema/audit.schema.json'));
const INDEX = read(path.join(DIR, 'index.json'));
const cities = Object.fromEntries(EXAMPLES.map((id) => [id, read(path.join(DIR, `${id}.city.json`))]));
const audits = Object.fromEntries(EXAMPLES.map((id) => [id, read(path.join(DIR, id, 'audit.json'))]));
const en = (v) => (typeof v === 'string' ? v : v?.en ?? '');
const kindOf = (city, kind) => city.files.filter((f) => f.kind === kind).map((f) => f.path);

// Minimal JSON Schema (draft 2020-12 subset) checker: enough for schema/audit.schema.json.
function validate(schema, value, at = '$', root = schema) {
  if (schema.$ref) return validate(schema.$ref.slice(2).split('/').reduce((o, k) => o[k], root), value, at, root);
  const errors = [];
  const typeOk = (t) => (t === 'object' ? value !== null && typeof value === 'object' && !Array.isArray(value)
    : t === 'array' ? Array.isArray(value) : t === 'integer' ? Number.isInteger(value) : typeof value === t);
  if (schema.type && !typeOk(schema.type)) return [`${at}: expected ${schema.type}`];
  if ('const' in schema && value !== schema.const) errors.push(`${at}: expected ${JSON.stringify(schema.const)}`);
  if (schema.enum && !schema.enum.includes(value)) errors.push(`${at}: ${JSON.stringify(value)} not in enum`);
  if (schema.minLength != null && typeof value === 'string' && value.length < schema.minLength) errors.push(`${at}: too short`);
  if (schema.pattern && typeof value === 'string' && !new RegExp(schema.pattern).test(value)) errors.push(`${at}: does not match ${schema.pattern}`);
  if (Array.isArray(value)) {
    if (schema.minItems != null && value.length < schema.minItems) errors.push(`${at}: fewer than ${schema.minItems} items`);
    if (schema.items) value.forEach((v, i) => errors.push(...validate(schema.items, v, `${at}[${i}]`, root)));
  }
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    for (const k of schema.required ?? []) if (!(k in value)) errors.push(`${at}: missing ${k}`);
    for (const [k, v] of Object.entries(value)) {
      if (schema.properties?.[k]) errors.push(...validate(schema.properties[k], v, `${at}.${k}`, root));
      else if (schema.additionalProperties === false) errors.push(`${at}: unexpected ${k}`);
      else if (typeof schema.additionalProperties === 'object') errors.push(...validate(schema.additionalProperties, v, `${at}.${k}`, root));
    }
  }
  if (schema.anyOf && !schema.anyOf.some((s) => validate(s, value, at, root).length === 0)) errors.push(`${at}: matches none of anyOf`);
  for (const s of schema.allOf ?? []) errors.push(...validate(s, value, at, root));
  if (schema.if) {
    const branch = validate(schema.if, value, at, root).length === 0 ? schema.then : schema.else;
    if (branch) errors.push(...validate(branch, value, at, root));
  }
  if (schema.not && validate(schema.not, value, at, root).length === 0) errors.push(`${at}: matches a forbidden schema`);
  return errors;
}

let tmp;
before(() => { tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'overlook-examples-')); });
after(() => fs.rmSync(tmp, { recursive: true, force: true }));

test('examples: scripts are deterministic and the committed city data is fresh', () => {
  for (const id of EXAMPLES) {
    const { base, head } = makeExample(id, path.join(tmp, id));
    const city = buildCity(collect({ repo: path.join(tmp, id), base, head, src: '.' }), audits[id]);
    assert.equal(cities[id].meta.base, base, `${id}: regenerate with npm run examples`);
    assert.equal(cities[id].meta.head, head, `${id}: regenerate with npm run examples`);
    assert.deepEqual(cities[id], JSON.parse(JSON.stringify(city)), `samples/examples/${id}.city.json is stale (npm run examples)`);
    const js = fs.readFileSync(path.join(DIR, `${id}.city.js`), 'utf8');
    assert.equal(js, `window.CITY = ${JSON.stringify(cities[id], null, 2)};\n`, `${id}.city.js does not match ${id}.city.json`);
  }
});

test('examples: audits are valid, marked as samples, and explain every changed file', () => {
  for (const id of EXAMPLES) {
    const audit = audits[id];
    const city = cities[id];
    assert.deepEqual(validate(SCHEMA, audit), [], `${id}/audit.json does not match schema/audit.schema.json`);
    assert.equal(audit.sample, true, `${id}: scripted examples must carry "sample": true`);
    assert.equal(city.meta.sample, true);

    // Claims are verbatim, non-overlapping parts of the report (the report view highlights them in order).
    let pos = 0;
    for (const c of audit.claims) {
      const at = audit.bobReport.indexOf(en(c.text), pos);
      assert.ok(at >= 0, `${id}: claim not verbatim or out of order: ${en(c.text)}`);
      pos = at + en(c.text).length;
    }

    const changed = city.files.filter((f) => f.status !== 'unchanged').map((f) => f.path);
    const explained = new Set([...changed, ...kindOf(city, 'affected')]);
    for (const p of changed) assert.ok(audit.plain[p], `${id}: missing plain entry for changed file ${p}`);
    for (const [p, entry] of Object.entries(audit.plain)) {
      assert.ok(explained.has(p), `${id}: plain entry for a file that is neither changed nor affected: ${p}`);
      assert.ok(en(entry.title).split(/\s+/).length < 12, `${id}: title too long: ${p}`);
      assert.ok(en(entry.detail).split(/\s+/).length < 20, `${id}: detail too long: ${p}`);
    }
    for (const s of audit.screens) assert.ok(city.files.some((f) => f.path === s.file), `${id}: screen for unknown file ${s.file}`);
    for (const d of city.districts) assert.ok(audit.districts.some((a) => a.path === d.id), `${id}: no audit label for district ${d.id}`);
  }
});

test('examples: index.json matches the built cities', () => {
  assert.deepEqual(INDEX.map((e) => e.id), EXAMPLES);
  for (const e of INDEX) {
    const city = cities[e.id];
    assert.equal(e.request, city.request.id);
    assert.equal(e.title, en(city.request.title));
    assert.ok(e.blurb && e.blurb.length > 20);
    assert.deepEqual([e.files, e.changed, e.outside, e.affected],
      [city.files.length, city.totals.filesChanged, city.totals.outside, city.totals.affected]);
  }
});

test('infra-drift: a Settings feature that drifts into theme, config, infra and CI', () => {
  const city = cities['infra-drift'];
  assert.equal(city.files.length, 65);
  assert.deepEqual([city.totals.filesChanged, city.totals.outside, city.totals.affected], [10, 7, 23]);
  assert.deepEqual(kindOf(city, 'in'), ['src/settings/SettingsPage.tsx', 'src/settings/ThemeToggle.tsx', 'src/settings/settingsStore.ts']);
  assert.deepEqual(kindOf(city, 'out').sort(), ['.env.example', '.github/workflows/ci.yml', 'config/env.ts', 'docker-compose.yml',
    'infra/terraform/variables.tf', 'src/theme/tokens.ts', 'tests/theme/tokens.test.ts']);
  const item = (p) => city.items.find((i) => i.file === p);
  assert.equal(item('src/theme/tokens.ts').risk, 'high');
  assert.ok(item('src/theme/tokens.ts').ripple.length >= 15, 'tokens.ts should ripple into most components');
  assert.ok(item('src/theme/tokens.ts').ripple.includes('src/components/Button.tsx'));
  assert.ok(item('config/env.ts').ripple.includes('server/index.ts'));
  assert.deepEqual(item('tests/theme/tokens.test.ts').reasons, ['test_rewritten']);
  assert.ok(city.files.find((f) => f.path === '.github/workflows/ci.yml').diff.some(([k, t]) => k === 'a' && t.includes('if: false')));
  assert.deepEqual(city.claims.map((c) => [c.type, c.verdict]),
    [['feature', 'true'], ['scope', 'false'], ['only_files', 'false'], ['tests_pass', 'partial']]);
});

test('monorepo-scale: a label rename that reaches shared types, the API and the database', () => {
  const city = cities['monorepo-scale'];
  assert.ok(city.files.length > 500, `expected > 500 files, got ${city.files.length}`);
  assert.deepEqual([city.totals.filesChanged, city.totals.outside, city.totals.apiChanges, city.totals.testsRewritten], [26, 13, 6, 4]);
  assert.ok(city.totals.affected > 20, `expected > 20 affected, got ${city.totals.affected}`);
  assert.ok(kindOf(city, 'in').every((p) => p.startsWith('apps/admin/customers/')));
  const types = city.items.find((i) => i.file === 'packages/types/customer.ts');
  assert.equal(types.risk, 'high');
  assert.ok(types.ripple.length > 50, 'the shared Customer type should ripple across apps and services');
  assert.ok(types.ripple.some((p) => p.startsWith('apps/web/')) && types.ripple.some((p) => p.startsWith('services/worker/')));
  const migration = city.files.find((f) => f.path === 'services/api/migrations/0031_rename_customer_name_to_client_name.sql');
  assert.equal(migration.status, 'added');
  assert.equal(migration.kind, 'out');
  assert.deepEqual(city.claims.map((c) => [c.type, c.verdict]),
    [['feature', 'true'], ['scope', 'false'], ['no_api_change', 'false'], ['tests_pass', 'partial']]);
});

test('clean-pass: everything inside the fence, a test added, every claim holds', () => {
  const city = cities['clean-pass'];
  assert.deepEqual([city.totals.filesChanged, city.totals.outside, city.totals.affected, city.items.length], [2, 0, 0, 0]);
  assert.deepEqual(kindOf(city, 'in'), ['src/checkout/total.ts', 'tests/checkout/total.test.ts']);
  const spec = city.files.find((f) => f.path === 'tests/checkout/total.test.ts');
  assert.deepEqual(spec.test, { assertionsRemoved: 0, assertionsAdded: 3, skipsAdded: 0, rewritten: false, weakened: false });
  assert.ok(city.steps.every((s) => !s.outside));
  assert.ok(city.claims.every((c) => c.verdict === 'true'));
  assert.equal(city.totals.claimsTrue, city.totals.claims);
});
