// core/city.mjs — the pure part of build-city (SPEC 4.2): no filesystem, no git, no Node APIs.
// Shared by engine/build-city.mjs, the site server, the MCP server and the browser (live fence edits).
//
// Evidence decides, Bob explains: the audit contributes the fence, district labels, claim texts,
// plain-language text, screens and executable checks. Everything else is computed here.

// Folders too generic to be a district on their own; use two levels instead.
const GENERIC = new Set(['shared', 'common', 'lib', 'libs', 'utils', 'core', 'components', 'packages', 'modules']);
const RISK_ORDER = { high: 0, medium: 1, low: 2 };
// Claim types whose verdicts git can check; Bob's verdict is ignored for these.
const CHECKED_TYPES = new Set(['scope', 'no_api_change', 'tests_pass', 'no_new_files', 'only_files']);
const VERDICTS = new Set(['true', 'false', 'partial', 'unverified']);

const isChanged = (f) => f.status !== 'unchanged';
const baseName = (p) => p.split('/').pop();
const list = (paths) => paths.join(', ');

/** Is `p` inside the fence? Directory entries end with "/"; file entries match exactly. */
export function inFence(p, fencePaths) {
  return fencePaths.some((f) => p === f || (f.endsWith('/') && p.startsWith(f)) || p.startsWith(f + '/'));
}

/**
 * District id of a file: the longest matching audit district path, otherwise
 * the first folder under src (two levels if the first one is generic).
 */
export function districtOf(p, auditDistricts, src = 'src') {
  let best = null;
  for (const d of auditDistricts) {
    if (d.path && d.path !== './' && p.startsWith(d.path) && (!best || d.path.length > best.length)) best = d.path;
  }
  if (best) return best;

  const root = src === '.' ? 'src' : src;
  const prefix = p.startsWith(root + '/') ? root + '/' : '';
  const parts = p.slice(prefix.length).split('/');
  const folders = parts.slice(0, -1);
  if (folders.length === 0) return prefix || './';
  const depth = GENERIC.has(folders[0]) && folders.length > 1 ? 2 : 1;
  return prefix + folders.slice(0, depth).join('/') + '/';
}

function defaultLabel(id) {
  if (id === './') return 'Project root';
  const last = id.replace(/\/$/, '').split('/').pop();
  return last.charAt(0).toUpperCase() + last.slice(1);
}

// ---------------------------------------------------------------------------
// items: reasons, risk, facts
// ---------------------------------------------------------------------------

function reasonsAndRisk(file, ripple) {
  const reasons = [];
  let risk = null;
  const raise = (r) => { if (!risk || RISK_ORDER[r] < RISK_ORDER[risk]) risk = r; };

  if (file.status === 'deleted') { reasons.push('deleted'); raise('high'); }
  if (file.isApi) { reasons.push('api_contract'); raise('high'); }
  if (file.test?.rewritten) { reasons.push('test_rewritten'); raise('high'); }
  if (file.test?.weakened) { reasons.push('test_weakened'); raise('high'); }
  if (ripple.length > 0) { reasons.push('ripple'); raise(ripple.length >= 2 ? 'high' : 'medium'); }
  if (reasons.length === 0) {
    if (file.status === 'added') { reasons.push('additive'); raise('low'); }
    else { reasons.push('outside_fence'); raise('medium'); }
  }
  return { reasons, risk };
}

function factsSentence(file, reasons, ripple) {
  const status = file.status === 'renamed' ? `renamed from ${file.from}` : file.status;
  const parts = [`${status} outside the request fence, +${file.plus} −${file.minus}.`];
  if (reasons.includes('api_contract')) parts.push('is an API file.');
  if (file.test && (file.test.rewritten || file.test.weakened)) {
    const t = file.test;
    let s = `test assertions ${t.rewritten ? 'rewritten' : 'changed'}: ${t.assertionsRemoved} removed, ${t.assertionsAdded} added`;
    if (t.skipsAdded) s += `, ${t.skipsAdded} skip(s) added`;
    parts.push(s + '.');
  }
  if (ripple.length > 0) {
    parts.push(`changes the output of ${ripple.length} file(s) it is imported by: ${list(ripple.map(baseName))}.`);
  }
  return parts.join(' ');
}

// ---------------------------------------------------------------------------
// claims
// ---------------------------------------------------------------------------

function checkClaim(claim, files) {
  const changed = files.filter(isChanged);
  const base = { text: claim.text, type: claim.type };
  const verdict = (ok, detailOk, detailBad, evidence, bad = 'false') =>
    ({ ...base, verdict: ok ? 'true' : bad, detail: ok ? detailOk : detailBad, evidence });

  switch (claim.type) {
    case 'scope': {
      const out = changed.filter((f) => f.kind === 'out').map((f) => f.path);
      return verdict(out.length === 0,
        `All ${changed.length} changed file(s) are inside the request fence.`,
        `${out.length} file(s) changed outside the request fence: ${list(out)}.`, ['git-diff']);
    }
    case 'no_api_change': {
      const api = changed.filter((f) => f.isApi).map((f) => f.path);
      return verdict(api.length === 0, 'No API file changed.',
        `${api.length} API file(s) changed: ${list(api)}.`, ['git-diff']);
    }
    case 'tests_pass': {
      // Until the original tests are run (applyRuns), a pass is only the agent's word: unverified, or partly true
      // at best when tests were rewritten or weakened (then passing proves less).
      const bad = changed.filter((f) => f.test && (f.test.rewritten || f.test.weakened)).map((f) => f.path);
      return bad.length
        ? { ...base, verdict: 'partial', detail: `Reported by the agent, not run yet; ${bad.length} test file(s) were rewritten or weakened: ${list(bad)}.`, evidence: ['test-diff'] }
        : { ...base, verdict: 'unverified', detail: 'Reported by the agent, not run yet: no test was rewritten or weakened. Run the original tests to check it.', evidence: ['test-diff'] };
    }
    case 'no_new_files': {
      const added = changed.filter((f) => f.status === 'added').map((f) => f.path);
      return verdict(added.length === 0, 'No file was added.',
        `${added.length} file(s) added: ${list(added)}.`, ['git-diff']);
    }
    case 'only_files': {
      const allowed = claim.files ?? [];
      const extras = changed.map((f) => f.path).filter((p) => !inFence(p, allowed));
      return verdict(extras.length === 0, `Only the named file(s) changed: ${list(allowed)}.`,
        `${extras.length} other file(s) changed: ${list(extras)}.`, ['git-diff']);
    }
    default: {
      // A feature claim with an executed check is decided by the check's exit code, not by Bob.
      if (claim.check?.result) {
        const r = claim.check.result;
        return { ...base, check: claim.check, verdict: r.passed ? 'true' : 'false',
          detail: `${r.passed ? 'Check passed' : 'Check failed'} on head: \`${claim.check.command}\`${r.passed ? '' : ` (exit ${r.exitCode})`}.`, evidence: ['check-run'] };
      }
      // feature and anything git cannot check: Bob's judgement, clearly labelled.
      const v = VERDICTS.has(claim.verdict) ? claim.verdict : 'unverified';
      return { ...base, ...(claim.check ? { check: claim.check } : {}), verdict: v, detail: claim.note ?? 'Not checkable from git; no note from Bob.', evidence: ['bob-judgement'] };
    }
  }
}

// ---------------------------------------------------------------------------
// buildCity
// ---------------------------------------------------------------------------

/**
 * @param evidence evidence.json (SPEC 3.1)
 * @param audit    audit.json (SPEC 3.2)
 * @returns city object (SPEC 3.3)
 */
export function buildCity(evidence, audit) {
  if (evidence?.kind !== 'overlook.evidence/v1') throw new Error('evidence: expected kind overlook.evidence/v1');
  if (audit?.kind !== 'overlook.audit/v1') throw new Error('audit: expected kind overlook.audit/v1');

  const fencePaths = audit.fence?.paths ?? [];
  const auditDistricts = audit.districts ?? [];
  const plain = audit.plain ?? {};

  // Files with district, fence and kind (none / in / out); affected is filled in below.
  const files = evidence.files.map((f) => {
    const fenced = inFence(f.path, fencePaths);
    return {
      ...f,
      name: baseName(f.path),
      district: districtOf(f.path, auditDistricts, evidence.src),
      inFence: fenced,
      kind: isChanged(f) ? (fenced ? 'in' : 'out') : 'none',
      item: null,
      causes: [],
    };
  });
  const byPath = new Map(files.map((f) => [f.path, f]));

  // Affected: unchanged non-test files importing a modified (not added), non-test, out-of-fence file.
  for (const cause of files) {
    const modified = cause.status === 'modified' || cause.status === 'renamed';
    if (!modified || cause.isTest || cause.inFence) continue;
    for (const importer of cause.importedBy ?? []) {
      const f = byPath.get(importer);
      if (!f || isChanged(f) || f.isTest) continue;
      f.kind = 'affected';
      if (!f.causes.includes(cause.path)) f.causes.push(cause.path);
    }
  }

  // Items: changed files outside the fence.
  const items = files
    .filter((f) => f.kind === 'out')
    .map((f) => {
      const ripple = (f.importedBy ?? []).filter((p) => byPath.get(p)?.kind === 'affected' && byPath.get(p).causes.includes(f.path));
      const { reasons, risk } = reasonsAndRisk(f, ripple);
      const evidenceTags = ['git-diff'];
      if (reasons.includes('test_rewritten') || reasons.includes('test_weakened')) evidenceTags.push('test-diff');
      if (ripple.length > 0) evidenceTags.push('import-graph');
      return {
        id: null,
        file: f.path,
        risk,
        reasons,
        ripple,
        step: f.step,
        facts: factsSentence(f, reasons, ripple),
        evidence: evidenceTags,
        plain: plain[f.path] ?? null,
      };
    })
    .sort((a, b) => RISK_ORDER[a.risk] - RISK_ORDER[b.risk] || (a.step ?? Infinity) - (b.step ?? Infinity) || a.file.localeCompare(b.file));
  items.forEach((item, i) => {
    item.id = `i${i + 1}`;
    byPath.get(item.file).item = item.id;
  });

  // Districts: every district that holds a file, labelled from the audit when it names it.
  const districtIds = [...new Set(files.map((f) => f.district))].sort();
  const districts = districtIds.map((id) => ({
    id,
    path: id,
    label: auditDistricts.find((d) => d.path === id)?.label ?? defaultLabel(id),
    inFence: id !== './' && inFence(id, fencePaths),
  }));

  // Steps: Task received + one per commit + Done. `outside` marks commits that touch out-of-fence changes.
  const steps = [
    { message: 'Task received', sha: null, files: [], outside: false },
    ...evidence.steps.map((s) => ({ ...s, outside: s.files.some((p) => byPath.get(p)?.kind === 'out') })),
    { message: 'Done', sha: null, files: [], outside: false },
  ];

  // Claims: git-checkable types are computed; Bob's verdict is used only for feature/other.
  const claims = (audit.claims ?? []).map((c) => checkClaim(c, files));
  if (claims.some((c) => CHECKED_TYPES.has(c.type) && c.evidence.includes('bob-judgement'))) {
    throw new Error('internal: git-checkable claim fell back to Bob\'s verdict');
  }

  const changed = files.filter(isChanged);
  const totals = {
    filesChanged: changed.length,
    outside: files.filter((f) => f.kind === 'out').length,
    affected: files.filter((f) => f.kind === 'affected').length,
    apiChanges: changed.filter((f) => f.isApi).length,
    testsRewritten: changed.filter((f) => f.test && (f.test.rewritten || f.test.weakened)).length,
    claimsTrue: claims.filter((c) => c.verdict === 'true').length,
    claims: claims.length,
  };

  return {
    kind: 'overlook.city/v1',
    meta: {
      repo: evidence.repo,
      base: evidence.base,
      head: evidence.head,
      refs: evidence.refs ?? { base: null, head: null },
      src: evidence.src,
      generatedAt: evidence.generatedAt,
      sample: audit.sample === true,
      draft: audit.draft === true,
      ...(audit.example ? { example: audit.example } : {}),
    },
    request: audit.request ?? {},
    bobReport: audit.bobReport ?? '',
    fence: { paths: fencePaths, rationale: audit.fence?.rationale ?? '' },
    districts,
    steps,
    ...(evidence.graph ? { graph: evidence.graph } : {}),
    files,
    items,
    claims,
    screens: audit.screens ?? [],
    plain,
    totals,
  };
}


// ---------------------------------------------------------------------------
// Rebuild from a city (fence edits in the UI, test runs on the server)
// ---------------------------------------------------------------------------

const EVIDENCE_KEYS = ['path', 'status', 'from', 'locBefore', 'locAfter', 'plus', 'minus', 'step', 'isTest', 'isApi', 'importedBy', 'uses', 'diff', 'test'];

/** Evidence and audit recovered from a city, so it can be rebuilt with a different fence. */
export function unbuild(city) {
  const files = city.files.map((f) => Object.fromEntries(EVIDENCE_KEYS.filter((k) => k in f).map((k) => [k, f[k]])));
  const steps = city.steps.slice(1, -1).map(({ outside, ...s }) => s);
  const evidence = { kind: 'overlook.evidence/v1', generatedAt: city.meta.generatedAt, repo: city.meta.repo, base: city.meta.base, head: city.meta.head, refs: city.meta.refs, src: city.meta.src, steps, ...(city.graph ? { graph: city.graph } : {}), files };
  const plain = { ...(city.plain ?? {}) };
  for (const it of city.items) if (it.plain) plain[it.file] = it.plain;
  const audit = {
    kind: 'overlook.audit/v1',
    sample: city.meta.sample === true,
    draft: city.meta.draft === true,
    ...(city.meta.example ? { example: city.meta.example } : {}),
    request: city.request,
    fence: city.fence,
    districts: city.districts.map((d) => ({ path: d.path, label: d.label })),
    bobReport: city.bobReport,
    claims: city.claims.map((c) => ({ text: c.text, type: c.type, ...(c.files ? { files: c.files } : {}), ...(c.type === 'feature' || !CHECKED_TYPES.has(c.type) ? { verdict: c.evidence?.includes('bob-judgement') ? c.verdict : undefined, note: c.evidence?.includes('bob-judgement') ? c.detail : undefined } : {}), ...(c.check ? { check: c.check } : {}) })),
    plain,
    screens: city.screens,
  };
  return { evidence, audit };
}

/**
 * Same city with a new fence. Keeps meta extras (source, refs, runs) and marks who set the fence.
 * @param {string[]} fencePaths  e.g. ["src/articles/"]
 */
export function withFence(city, fencePaths, rationale = 'Set by the reviewer.') {
  const { evidence, audit } = unbuild(city);
  audit.fence = { paths: fencePaths, rationale };
  const next = buildCity(evidence, audit);
  next.meta = { ...city.meta, ...next.meta, source: city.meta.source, prUrl: city.meta.prUrl, fenceSetBy: 'reviewer' };
  if (city.runs) return applyRuns(next, city.runs);
  return next;
}

/**
 * Fold executed test runs into the claims (SPEC 4.6). `runs` = { cross?, reverts?, checks? } from engine/verify.mjs.
 * - cross: the base version of the changed tests, run against head. Failing means the original tests fail on the new code.
 */
export function applyRuns(city, runs) {
  const out = { ...city, runs };
  out.claims = city.claims.map((c) => {
    if (c.type === 'tests_pass' && runs.cross && !runs.cross.skipped) {
      const r = runs.cross;
      return r.passed
        ? { ...c, verdict: c.verdict === 'partial' ? 'partial' : 'true', detail: `The original tests pass on the new code (\`${r.command}\`). ${c.verdict === 'partial' ? c.detail : ''}`.trim(), evidence: [...new Set([...(c.evidence ?? []), 'test-run'])] }
        : { ...c, verdict: 'false', detail: `The original tests fail on the new code (\`${r.command}\`, exit ${r.exitCode}).`, evidence: [...new Set([...(c.evidence ?? []), 'test-run'])] };
    }
    const chk = runs.checks?.find((x) => x.text === (typeof c.text === 'string' ? c.text : c.text?.en));
    if (chk && c.type === 'feature') {
      return { ...c, check: { command: chk.command, result: chk }, verdict: chk.passed ? 'true' : 'false', detail: `${chk.passed ? 'Check passed' : 'Check failed'} on head: \`${chk.command}\`${chk.passed ? '' : ` (exit ${chk.exitCode})`}.`, evidence: ['check-run'] };
    }
    return c;
  });
  out.totals = { ...city.totals, claimsTrue: out.claims.filter((c) => c.verdict === 'true').length };
  return out;
}
