// Receipt rendering (SPEC 4.3), using the committed sample city.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { renderReceipt, text, FOOTER } from '../pr-comment.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const city = JSON.parse(fs.readFileSync(path.join(ROOT, 'samples/city.sample.json'), 'utf8'));

test('receipt has title, report, sections, icons and the footer', () => {
  const md = renderReceipt(city);
  assert.ok(md.includes('Overlook receipt · GT-142'));
  assert.ok(md.includes(city.bobReport));
  assert.ok(md.includes('### Outside the request'));
  assert.ok(md.includes('### AI claims checked'));
  assert.ok(md.includes('🔴 `src/shared/utils/formatDate.ts`'));
  assert.ok(md.includes('⚪ `src/shared/utils/relativeTime.ts`'));
  for (const icon of ['✅', '❌', '⚠️']) assert.ok(md.includes(icon), `missing ${icon}`);
  assert.ok(md.includes('4 decision(s) left'));
  assert.ok(md.trimEnd().endsWith(`_${FOOTER}_`));
  assert.equal(FOOTER, 'Evidence is computed from git (base..head). Bob explains; git decides.');
});

test('receipt reflects decisions', () => {
  const decisions = {
    base: city.meta.base,
    head: city.meta.head,
    decisions: Object.fromEntries(city.items.map((i, n) => [i.file, n === 1 ? 'revert' : 'approve'])),
  };
  const md = renderReceipt(city, decisions);
  assert.ok(md.includes('decision: **revert**'));
  assert.ok(md.includes('ready to merge — 3 approved, 1 to revert'));
});

test('text() falls back to en', () => {
  assert.equal(text('plain'), 'plain');
  assert.equal(text({ en: 'Hi', ko: 'Hi (ko)' }, 'ko'), 'Hi (ko)');
  assert.equal(text({ en: 'Hi' }, 'ko'), 'Hi');
  assert.equal(text(undefined), '');
});
