#!/usr/bin/env node
// build-city.mjs — evidence + audit -> city.json and city.js (SPEC 3.3, 4.2).
//
// Evidence decides, Bob explains: the audit contributes the fence, district
// labels, claim texts, plain-language text and screens. Everything else —
// districts, kinds, items, risks, facts and the verdicts of git-checkable
// claims — is computed here from the evidence.

import fs from 'node:fs';
import path from 'node:path';
import { isMain, parseArgs, writeJson } from './collect.mjs';
import { buildCity } from './core/city.mjs';

export * from './core/city.mjs';

const USAGE = 'usage: node engine/build-city.mjs --evidence out/evidence.json --audit out/audit.json [--out ui/city.json]';


/** Write city.json and city.js (window.CITY = …;) next to it. */
export function writeCity(outJson, city) {
  writeJson(outJson, city);
  const outJs = outJson.replace(/\.json$/, '') + '.js';
  fs.writeFileSync(outJs, `window.CITY = ${JSON.stringify(city, null, 2)};\n`);
  return outJs;
}

if (isMain(import.meta.url)) {
  try {
    const args = parseArgs(process.argv.slice(2));
    if (args.help || !args.evidence || !args.audit) {
      console.error(USAGE);
      process.exit(args.help ? 0 : 2);
    }
    const evidence = JSON.parse(fs.readFileSync(args.evidence, 'utf8'));
    const audit = JSON.parse(fs.readFileSync(args.audit, 'utf8'));
    const out = args.out ?? 'ui/city.json';
    const city = buildCity(evidence, audit);
    const outJs = writeCity(out, city);
    const t = city.totals;
    console.log(`${t.filesChanged} changed, ${t.outside} outside, ${t.affected} affected, ` +
      `${t.claimsTrue}/${t.claims} claims hold -> ${out} (+ ${path.basename(outJs)})`);
  } catch (err) {
    console.error(`build-city: ${err.message}`);
    process.exit(1);
  }
}
