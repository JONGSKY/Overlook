#!/usr/bin/env bash
# Rebuilds samples/city.sample.json (+ .js) and samples/receipt.sample.md from the scripted GT-142 repo.
# The sample commits are scripted by make-sample-repo.sh; they are never presented as a real Bob run.
set -euo pipefail
cd "$(dirname "$0")/.."
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
repo="$tmp/gt142-sample-app"
eval "$(bash samples/make-sample-repo.sh "$repo" | grep -E '^(BASE|HEAD)=')"
node engine/collect.mjs --repo "$repo" --base "$BASE" --src . --out "$tmp/evidence.json"
node engine/build-city.mjs --evidence "$tmp/evidence.json" --audit samples/audit.sample.json --out samples/city.sample.json
node engine/pr-comment.mjs --city samples/city.sample.json --out samples/receipt.sample.md
