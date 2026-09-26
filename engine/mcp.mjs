#!/usr/bin/env node
// mcp.mjs — Overlook as an MCP server (stdio, JSON-RPC 2.0, one message per line).
//
// Lets Bob run the deterministic engine as tools instead of shell commands, and hands back
// a link to the audit on the Overlook map. Configured in .bob/mcp.json.
//
//   overlook_collect   git evidence for base..head          -> out/evidence.json
//   overlook_build     evidence + Bob's audit.json          -> verdicts, items, map link
//   overlook_receipt   PR comment markdown for an audit (+ decisions)
//   overlook_fence     confirm or change the requested area (fence) and recompute
//   overlook_verify    run the tests: original tests on head, after reverts, or feature checks
//   overlook_apply     revert the files a reviewer rejected (dry run by default)
//   overlook_audits    recent audits on this machine
//
// Relative paths resolve against the Overlook repository root.

import fs from 'node:fs';
import path from 'node:path';
import { createInterface } from 'node:readline';
import { applyDecisions } from './apply-decisions.mjs';
import { ROOT, auditRepo, auditUrl, listAudits, readAudit, saveAudit, writeAudit } from './audits.mjs';
import { applyRuns, withFence } from './core/city.mjs';
import { afterReverts, crossTests, runChecks } from './verify.mjs';
import { buildCity } from './build-city.mjs';
import { collect, isMain, summarize } from './collect.mjs';
import { renderReceipt } from './pr-comment.mjs';

const abs = (p) => path.resolve(ROOT, p);
const readJson = (p) => JSON.parse(fs.readFileSync(abs(p), 'utf8'));
const writeJson = (p, data) => {
  fs.mkdirSync(path.dirname(abs(p)), { recursive: true });
  fs.writeFileSync(abs(p), JSON.stringify(data, null, 2) + '\n');
};
const str = (description) => ({ type: 'string', description });

export const TOOLS = [
  {
    name: 'overlook_collect',
    description: 'Collect evidence from git for a finished task (changed files, commits as steps, test rewrites, API files, import graph). Deterministic; no model involved. Writes out/evidence.json.',
    inputSchema: {
      type: 'object',
      properties: {
        repo: str('Path to the git repository that was changed'),
        base: str('Commit before the agent started'),
        head: str('Last commit of the task (default HEAD)'),
        src: str('Folder to map (default: the whole repository, so tests outside src are audited too)'),
        out: str('Output path (default out/evidence.json)'),
      },
      required: ['repo', 'base'],
    },
    run({ repo, base, head = 'HEAD', src, out = 'out/evidence.json' }) {
      const evidence = collect({ repo: abs(repo), base, head, src });
      evidence.repoPath = abs(repo);
      writeJson(out, evidence);
      const changed = evidence.files.filter((f) => f.status !== 'unchanged');
      return {
        summary: summarize(evidence),
        evidence: out,
        steps: evidence.steps.map((s, i) => `${i + 1}. ${s.sha.slice(0, 7)} ${s.message} (${s.files.length} files)`),
        changed: changed.map((f) => `${f.status} ${f.path} +${f.plus} -${f.minus}${f.isApi ? ' [api]' : ''}${f.test?.rewritten ? ' [test rewritten]' : ''}`),
      };
    },
  },
  {
    name: 'overlook_build',
    description: 'Combine evidence with your audit.json (fence, claims, plain-language notes). Git-checkable claim verdicts are computed here, not taken from the audit. Publishes the audit to the Overlook map and returns its link.',
    inputSchema: {
      type: 'object',
      properties: {
        evidence: str('Evidence path (default out/evidence.json)'),
        audit: str('Audit path written by the Overlook Auditor mode (default out/audit.json)'),
        out: str('City output path (default out/city.json)'),
      },
    },
    run({ evidence = 'out/evidence.json', audit = 'out/audit.json', out = 'out/city.json' }) {
      const auditDoc = readJson(audit);
      if (auditDoc.kind !== 'overlook.audit/v1') throw new Error(`${audit}: expected kind overlook.audit/v1`);
      const city = buildCity(readJson(evidence), auditDoc);
      writeJson(out, city);
      const ev = readJson(evidence);
      const id = saveAudit(city, { label: city.meta.repo, via: 'mcp', dir: ev.repoPath ?? null });
      return {
        map: auditUrl(id),
        auditId: id,
        totals: city.totals,
        outside: city.items.map((it) => `${it.risk.toUpperCase()} ${it.file}: ${it.facts}`),
        claims: city.claims.map((c) => `${c.verdict.toUpperCase()} "${typeof c.text === 'string' ? c.text : c.text.en}" — ${typeof c.detail === 'string' ? c.detail : c.detail?.en ?? ''}`),
        note: 'Open the map link with the Overlook site running (npm run site).',
      };
    },
  },
  {
    name: 'overlook_fence',
    description: 'Confirm or change the requested area of an audit (the fence) and recompute every verdict. Bob proposes the fence; a person confirms it; git decides the rest.',
    inputSchema: {
      type: 'object',
      properties: { audit_id: str('Audit id'), paths: { type: 'array', items: { type: 'string' }, description: 'Folders (ending in /) or files the request covers' }, rationale: str('Why, quoting the brief') },
      required: ['audit_id', 'paths'],
    },
    run({ audit_id, paths, rationale }) {
      const doc = readAudit(audit_id);
      if (!doc) throw new Error(`Unknown audit ${audit_id}`);
      doc.city = withFence(doc.city, paths, rationale || 'Confirmed by the reviewer.');
      writeAudit(doc);
      return { map: auditUrl(audit_id), totals: doc.city.totals, outside: doc.city.items.map((it) => it.file) };
    },
  },
  {
    name: 'overlook_verify',
    description: "Run the repository's tests in a throwaway worktree. kind 'cross': the base version of the tests against the head code (do the original tests still pass?). kind 'reverts': head with the given decisions applied. kind 'checks': the executable checks attached to feature claims. Results update the claim verdicts.",
    inputSchema: {
      type: 'object',
      properties: {
        audit_id: str('Audit id'),
        kind: { type: 'string', enum: ['cross', 'reverts', 'checks'] },
        command: str('Test command (default: detected, e.g. npm test)'),
        decisions: str('For kind reverts: decisions.json path exported from the map'),
        repo: str('Repository path if the audit does not know it'),
      },
      required: ['audit_id', 'kind'],
    },
    async run({ audit_id, kind, command, decisions, repo }) {
      const doc = readAudit(audit_id);
      if (!doc) throw new Error(`Unknown audit ${audit_id}`);
      const dir = repo ? abs(repo) : auditRepo(doc);
      if (!dir) throw new Error('Repository path unknown: pass repo');
      const { base, head } = doc.city.meta;
      let run;
      if (kind === 'cross') run = { cross: await crossTests({ repo: dir, base, head, command }) };
      else if (kind === 'reverts') run = { reverts: await afterReverts({ repo: dir, base, head, command, decisions: decisions ? readJson(decisions).decisions : {} }) };
      else run = { checks: await runChecks({ repo: dir, head, checks: doc.city.claims.filter((c) => c.check?.command).map((c) => ({ text: typeof c.text === 'string' ? c.text : c.text.en, command: c.check.command })) }) };
      doc.city = applyRuns(doc.city, { ...(doc.city.runs ?? {}), ...run });
      writeAudit(doc);
      const r = Object.values(run)[0];
      return { result: Array.isArray(r) ? r.map(({ text, passed, exitCode, command }) => ({ text, passed, exitCode, command })) : { passed: r.passed, exitCode: r.exitCode, command: r.command, skipped: r.skipped, reason: r.reason, tail: r.output?.split('\n').slice(-15).join('\n') }, claims: doc.city.claims.map((c) => `${c.verdict.toUpperCase()} ${typeof c.text === 'string' ? c.text : c.text.en}`) };
    },
  },
  {
    name: 'overlook_receipt',
    description: 'Render the PR comment (receipt) for an audit: request, report, totals, changes outside the request with decisions, and claim verdicts.',
    inputSchema: {
      type: 'object',
      properties: {
        audit_id: str('Audit id returned by overlook_build'),
        city: str('Or a city.json path'),
        decisions: str('Optional decisions.json path exported from the map'),
        out: str('Optional markdown output path, e.g. out/receipt.md'),
      },
    },
    run({ audit_id, city, decisions, out }) {
      const doc = audit_id ? readAudit(audit_id)?.city : city ? readJson(city) : null;
      if (!doc) throw new Error('Give audit_id or city');
      const markdown = renderReceipt(doc, decisions ? readJson(decisions) : null);
      if (out) {
        fs.mkdirSync(path.dirname(abs(out)), { recursive: true });
        fs.writeFileSync(abs(out), markdown);
      }
      return { markdown, ...(out ? { written: out } : {}) };
    },
  },
  {
    name: 'overlook_apply',
    description: "Apply a reviewer's decisions: one git revert commit per file marked revert. Runs as a dry run unless dry_run is false.",
    inputSchema: {
      type: 'object',
      properties: {
        repo: str('Path to the git repository'),
        decisions: str('decisions.json exported from the map'),
        dry_run: { type: 'boolean', description: 'Default true: only report what would change' },
      },
      required: ['repo', 'decisions'],
    },
    run({ repo, decisions, dry_run = true }) {
      const log = [];
      const result = applyDecisions({ repo: abs(repo), decisions: readJson(decisions), dryRun: dry_run !== false, log: (m) => log.push(m) });
      return { dryRun: dry_run !== false, log, result: result ?? null };
    },
  },
  {
    name: 'overlook_audits',
    description: 'List recent audits saved on this machine, with their map links.',
    inputSchema: { type: 'object', properties: {} },
    run: () => listAudits().map((a) => ({ ...a, map: auditUrl(a.id) })),
  },
];

export function handle(msg) {
  const { id, method, params } = msg;
  const reply = (result) => ({ jsonrpc: '2.0', id, result });
  const fail = (code, message) => ({ jsonrpc: '2.0', id, error: { code, message } });
  switch (method) {
    case 'initialize':
      return reply({ protocolVersion: params?.protocolVersion ?? '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'overlook', version: '0.1.0' } });
    case 'ping':
      return reply({});
    case 'tools/list':
      return reply({ tools: TOOLS.map(({ run, ...t }) => t) });
    case 'tools/call': {
      const tool = TOOLS.find((t) => t.name === params?.name);
      if (!tool) return fail(-32602, `Unknown tool: ${params?.name}`);
      return Promise.resolve()
        .then(() => tool.run(params.arguments ?? {}))
        .then((out) => reply({ content: [{ type: 'text', text: JSON.stringify(out, null, 2) }] }))
        .catch((e) => reply({ content: [{ type: 'text', text: `Error: ${e.message}` }], isError: true }));
    }
    default:
      return id === undefined ? null : fail(-32601, `Method not found: ${method}`);
  }
}

if (isMain(import.meta.url)) {
  createInterface({ input: process.stdin }).on('line', (line) => {
    if (!line.trim()) return;
    let msg;
    try {
      msg = JSON.parse(line);
    } catch {
      process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } }) + '\n');
      return;
    }
    Promise.resolve(handle(msg)).then((res) => {
      if (res) process.stdout.write(JSON.stringify(res) + '\n');
    });
  });
}
