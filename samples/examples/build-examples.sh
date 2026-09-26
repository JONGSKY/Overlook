#!/usr/bin/env bash
# Rebuilds samples/examples/<id>.city.json (+ .js) and samples/examples/index.json from the
# scripted example repositories (make-examples.mjs), the same way build-sample.sh builds GT-142.
# The example commits are scripted; they are never presented as a real Bob or agent run.
set -euo pipefail
cd "$(dirname "$0")/../.."
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

node samples/examples/make-examples.mjs "$tmp/repos" > "$tmp/shas.txt"

# Each line: <id> BASE=<sha> HEAD=<sha> DIR=<path>
while read -r id base head dir; do
  base="${base#BASE=}"
  head="${head#HEAD=}"
  dir="${dir#DIR=}"
  node engine/collect.mjs --repo "$dir" --base "$base" --head "$head" --src . --out "$tmp/$id.evidence.json"
  node engine/build-city.mjs --evidence "$tmp/$id.evidence.json" --audit "samples/examples/$id/audit.json" \
    --out "samples/examples/$id.city.json"
done < "$tmp/shas.txt"

# index.json: one entry per example, numbers read from the built cities.
node --input-type=module - <<'EOF'
import fs from 'node:fs';
import { EXAMPLES } from './samples/examples/make-examples.mjs';

const BLURBS = {
  'infra-drift': 'A small Settings feature that quietly reaches into shared theme tokens, env config, docker-compose, Terraform and CI.',
  'monorepo-scale': 'A label rename in a 600-file monorepo that leaks into shared types, the public API and a database migration.',
  'clean-pass': 'The contrast case: the agent stays inside the fence, adds a test, and every claim holds.',
};
const en = (v) => (typeof v === 'string' ? v : v?.en ?? '');
const index = EXAMPLES.map((id) => {
  const city = JSON.parse(fs.readFileSync(`samples/examples/${id}.city.json`, 'utf8'));
  return {
    id,
    title: en(city.request.title),
    request: city.request.id,
    blurb: BLURBS[id],
    files: city.files.length,
    changed: city.totals.filesChanged,
    outside: city.totals.outside,
    affected: city.totals.affected,
  };
});
fs.writeFileSync('samples/examples/index.json', JSON.stringify(index, null, 2) + '\n');
console.log(`index.json: ${index.map((e) => e.id).join(', ')}`);
EOF
