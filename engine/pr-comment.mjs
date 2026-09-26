#!/usr/bin/env node
// pr-comment.mjs — city (+ decisions) -> Markdown receipt for a PR comment (SPEC 4.3).

import fs from 'node:fs';
import path from 'node:path';
import { isMain, parseArgs } from './collect.mjs';

const USAGE = 'usage: node engine/pr-comment.mjs --city ui/city.json [--decisions out/decisions.json] [--out out/receipt.md] [--lang en|ko]';

export const FOOTER = 'Evidence is computed from git (base..head). Bob explains; git decides.';
const RISK_ICON = { high: '🔴', medium: '🟠', low: '⚪' };
const VERDICT_ICON = { true: '✅', false: '❌', partial: '⚠️', unverified: '❔' };

/** Text fields may be a string or { en, ko }; fall back to en. */
export function text(value, lang = 'en') {
  if (value == null) return '';
  if (typeof value === 'string') return value;
  return value[lang] ?? value.en ?? '';
}

// Keep table cells and single lines intact.
const cell = (s) => String(s).replace(/\|/g, '\\|').replace(/\s*\n\s*/g, ' ');
const short = (sha) => (sha ? sha.slice(0, 7) : '?');

/**
 * Render the receipt.
 * @param city       city.json (SPEC 3.3)
 * @param decisions  optional decisions.json: { base, head, decisions: { path: "approve" | "revert" } }
 */
export function renderReceipt(city, decisions = null, { lang = 'en' } = {}) {
  const t = (v) => text(v, lang);
  const decided = decisions?.decisions ?? {};
  const req = city.request ?? {};
  const lines = [];

  lines.push(`## Overlook receipt · ${req.id ?? 'task'}`, '');
  lines.push(`**Request:** ${t(req.title)}${req.scope ? ` — ${t(req.scope)}` : ''}  `);
  lines.push(`**Repo:** \`${city.meta.repo}\` · \`${short(city.meta.base)}..${short(city.meta.head)}\`  `);
  if (city.fence?.paths?.length) {
    lines.push(`**Fence:** ${city.fence.paths.map((p) => `\`${p}\``).join(', ')} — ${t(city.fence.rationale)}`);
  }
  if (city.meta.sample) lines.push('', '> Sample data from a scripted repository, not a real Bob run.');
  lines.push('', "**Bob's report**", '', `> ${t(city.bobReport)}`, '');

  const tot = city.totals;
  lines.push('| Files changed | Outside request | Affected | API changes | Tests rewritten | Claims that hold |');
  lines.push('|---:|---:|---:|---:|---:|---:|');
  lines.push(`| ${tot.filesChanged} | ${tot.outside} | ${tot.affected} | ${tot.apiChanges} | ${tot.testsRewritten} | ${tot.claimsTrue} of ${tot.claims} |`, '');

  lines.push('### Outside the request', '');
  if (city.items.length === 0) lines.push('Nothing changed outside the request.');
  for (const item of city.items) {
    const d = decided[item.file];
    const decision = d === 'revert' ? '**revert**' : d === 'approve' ? '**approve**' : '_pending_';
    const plain = item.plain ? ` ${t(item.plain.title)}.` : '';
    lines.push(`- ${RISK_ICON[item.risk] ?? '⚪'} \`${item.file}\` · ${item.risk} · ${item.reasons.join(', ')} · decision: ${decision}  `);
    lines.push(`  ${cell(item.facts)}${cell(plain)}`);
  }
  lines.push('');

  const runs = city.runs ?? {};
  if (runs.cross || runs.reverts || runs.checks?.length) {
    lines.push('### Tests run by Overlook', '');
    const row = (label, r) => r && lines.push(`- ${r.skipped ? '❔' : r.passed ? '✅' : '❌'} ${label}: ${r.skipped ? r.reason : `\`${r.command}\` ${r.passed ? 'passed' : `failed (exit ${r.exitCode})`}`}  `);
    row('Original tests on the new code', runs.cross);
    row(`After the reviewer's reverts${runs.reverts?.reverted?.length ? ` (${runs.reverts.reverted.join(', ')})` : ''}`, runs.reverts);
    for (const c of runs.checks ?? []) row(`Check for "${c.text}"`, c);
    lines.push('');
  }
  lines.push('### AI claims checked', '');
  for (const c of city.claims) {
    lines.push(`- ${VERDICT_ICON[c.verdict] ?? '❔'} **${cell(t(c.text))}** — ${c.verdict}. ${cell(t(c.detail))} _(evidence: ${c.evidence.join(', ')})_`);
  }
  lines.push('');

  const pending = city.items.filter((i) => !decided[i.file]).length;
  const reverted = city.items.filter((i) => decided[i.file] === 'revert').length;
  const approved = city.items.filter((i) => decided[i.file] === 'approve').length;
  if (pending > 0) {
    lines.push(`**Status:** ${pending} decision(s) left out of ${city.items.length} change(s) outside the request.`);
  } else {
    lines.push(`**Status:** ready to merge — ${approved} approved, ${reverted} to revert.`);
  }
  lines.push('', '---', `_${FOOTER}_`, '');
  return lines.join('\n');
}

if (isMain(import.meta.url)) {
  try {
    const args = parseArgs(process.argv.slice(2));
    if (args.help || !args.city) {
      console.error(USAGE);
      process.exit(args.help ? 0 : 2);
    }
    const city = JSON.parse(fs.readFileSync(args.city, 'utf8'));
    let decisions = null;
    if (args.decisions) {
      decisions = JSON.parse(fs.readFileSync(args.decisions, 'utf8'));
      if (decisions.head && decisions.head !== city.meta.head) {
        console.error(`pr-comment: warning: decisions are for head ${short(decisions.head)}, city is ${short(city.meta.head)}`);
      }
    }
    const md = renderReceipt(city, decisions, { lang: args.lang ?? 'en' });
    const out = args.out ?? 'out/receipt.md';
    fs.mkdirSync(path.dirname(path.resolve(out)), { recursive: true });
    fs.writeFileSync(out, md);
    console.log(`receipt -> ${out}`);
  } catch (err) {
    console.error(`pr-comment: ${err.message}`);
    process.exit(1);
  }
}
