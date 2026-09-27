// workspace.js — the audit as a map-first workspace.
//
//   ┌ tree ──────────┬ map ─────────────────────────┬ inspector ─────────┐
//   │ Folders        │ the codebase atlas            │ overview, or the   │
//   │ Decisions      │                               │ selected file /    │
//   │ Commits        ├ commit timeline ──────────────┤ commit / claim     │
//   └────────────────┴───────────────────────────────┴────────────────────┘
//
// Git vocabulary (branch, commits, diff, approve) is borrowed from pull requests; the layout is Overlook's.
import { withFence } from '../engine/core/city.mjs';
import { createCity3D } from './atlas3d.js';
import { createHistoryGraph, historyModel } from './history-graph.js';
import { $, $$, api, auditCache, esc, icon, plural, short, store, text, timeAgo, toast } from './util.js';

const LAYOUT_ICON = {
  left: '<svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><rect x="1.5" y="2.5" width="13" height="11" rx="2" fill="none" stroke="currentColor" stroke-width="1.3"/><rect x="2.2" y="3.2" width="4" height="9.6" rx="1" fill="currentColor" class="ic-fill"/></svg>',
  right: '<svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><rect x="1.5" y="2.5" width="13" height="11" rx="2" fill="none" stroke="currentColor" stroke-width="1.3"/><rect x="9.8" y="3.2" width="4" height="9.6" rx="1" fill="currentColor" class="ic-fill"/></svg>',
  bottom: '<svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><rect x="1.5" y="2.5" width="13" height="11" rx="2" fill="none" stroke="currentColor" stroke-width="1.3"/><rect x="2.2" y="9" width="11.6" height="3.8" rx="1" fill="currentColor" class="ic-fill"/></svg>',
};
const VERDICT = {
  true: { icon: 'check', cls: 'ok', word: 'holds' },
  false: { icon: 'x', cls: 'bad', word: 'false' },
  partial: { icon: 'alert', cls: 'warn', word: 'partly true' },
  unverified: { icon: 'dot', cls: 'muted', word: 'unverified' },
};
const SEVERITY = { false: 0, partial: 1, unverified: 2, true: 3 };
const KIND_LABEL = { in: 'Inside request', out: 'Outside request', affected: 'May be affected', none: 'Unchanged', approved: 'Approved', reverted: 'Will be reverted' };
const REASON = {
  outside_fence: 'Changed outside the requested area.',
  additive: 'A new file outside the requested area.',
  deleted: 'Deleted a file outside the requested area.',
  api_contract: 'It is an API file: callers outside this repository may notice.',
  test_rewritten: 'Test assertions were rewritten, so the old expectation no longer protects the behaviour.',
  test_weakened: 'Tests were weakened (assertions removed or skipped).',
  ripple: 'Other files import it, so their behaviour may change too.',
};

export function showAudit(root, city, opts) {
  let current = null;
  const mount = (c, o) => {
    current?.();
    current = mountWorkspace(root, c, o, (next, keep) => mount(next, { ...o, ...keep }));
  };
  mount(applyStoredFence(city), opts);
  return () => current?.();
}

function applyStoredFence(city) {
  if (city.meta?.fenceSetBy === 'reviewer') return city;
  const saved = store.get(`overlook.fence.${city.meta?.head}`);
  if (!saved) return city;
  const same = JSON.stringify(saved.paths) === JSON.stringify(city.fence?.paths);
  const next = same ? { ...city, meta: { ...city.meta } } : withFence(city, saved.paths, 'Set by the reviewer.');
  next.meta.fenceSetBy = 'reviewer';
  return next;
}

function mountWorkspace(root, city, { id, label, step = null, hasApi = false, hosted = false, basePath, sel = null, look = null, lane = null, file = null }, reopen) {
  const meta = city.meta || {};
  const byPath = new Map(city.files.map((f) => [f.path, f]));
  const itemByFile = new Map(city.items.map((it) => [it.file, it]));
  const lastStep = city.steps.length - 1;
  const commits = city.steps.slice(1, -1).map((s, i) => ({ ...s, n: i + 1 }));
  const changed = city.files.filter((f) => f.status !== 'unchanged');
  const affected = city.files.filter((f) => f.kind === 'affected');
  const plus = changed.reduce((n, f) => n + f.plus, 0), minus = changed.reduce((n, f) => n + f.minus, 0);
  const requestId = text(city.request?.id);
  const title = text(city.request?.title) || 'Untitled request';
  const baseRef = meta.refs?.base || short(meta.base);
  const headRef = meta.refs?.head && meta.refs.head !== meta.refs?.base ? meta.refs.head : short(meta.head);
  const auditedBy = meta.example ? 'example' : meta.sample ? 'sample' : meta.draft ? 'draft' : 'bob';
  const fencePaths = city.fence?.paths || [];
  const fenceConfirmed = meta.fenceSetBy === 'reviewer';
  const runs = city.runs || {};
  const canRun = Boolean(hasApi && id && !hosted);

  const V = {
    speed: [0.5, 1, 2].includes(store.get('overlook.speed')) ? store.get('overlook.speed') : 1,
    code: true, // a file shows both: the plain sentence first, then the code
    sel, // { type: 'file' | 'commit' | 'claim', id, commit? }
    decisions: store.get(`overlook.decisions.${meta.head}`) || {},
    open: new Set(store.get(`overlook.open.${meta.head}`) || []),
    showQuiet: false,
    progress: step != null ? Number(step) : lastStep,
    running: null,
  };
  let map = null;

  const itemFor = (f) => {
    if (!f) return null;
    if (itemByFile.has(f.path)) return itemByFile.get(f.path);
    for (const c of f.causes || []) if (itemByFile.has(c)) return itemByFile.get(c);
    return null;
  };
  const pending = () => city.items.filter((it) => !V.decisions[it.file]);
  const persist = () => store.set(`overlook.decisions.${meta.head}`, V.decisions);
  const kindOf = (f) => (f.kind === 'out' && V.decisions[f.path] === 'approve' ? 'approved' : f.kind === 'out' && V.decisions[f.path] === 'revert' ? 'reverted' : f.kind);
  const claimText = (c) => text(c.text);
  const hold = city.claims.filter((c) => c.verdict === 'true').length;

  // ---------------------------------------------------------------- frame
  root.innerHTML = `
  <div class="ws-page">
    <header class="ws-head">
      <div class="wh-main">
        <div class="wh-kicker">
          ${auditedBy === 'example' ? `<a class="tag tag-real" href="${esc(meta.example.url)}" target="_blank" rel="noopener" title="${esc(`${meta.example.context ?? ''}. Request and report quoted from the source; fence and claim types by ${meta.example.auditor}.`)}">Real ${esc(meta.example.kind)}${meta.example.redacted ? ' · code not shown' : ''}</a>` : auditedBy === 'sample' ? '<span class="tag tag-sample">Sample data</span>' : auditedBy === 'draft' ? '<span class="tag tag-draft" title="Fence and claims come from what was typed in Overlook. Run the Overlook Auditor mode in Bob for the full audit.">Draft audit</span>' : '<span class="tag tag-bob">Audited with IBM Bob</span>'}
          <span class="wh-repo mono">${esc(meta.repo || label || '')}</span>
        </div>
        <h1><span class="state-pill" id="statePill"></span><span class="wh-title">${esc(title)}</span> <span class="pr-num">${esc(requestId)}</span></h1>
        <div class="wh-branch" id="whBranch"></div>
      </div>
      <div class="wh-stats" id="kpis" role="group" aria-label="The review at a glance"></div>
      <div class="wh-tools">
        ${meta.prUrl ? `<a class="icon-btn" href="${esc(meta.prUrl)}" target="_blank" rel="noopener" title="Open the source on GitHub" aria-label="Open on GitHub">${icon('github')}</a>` : ''}
        <span class="icon-group" role="group" aria-label="Panels">
          <button class="icon-btn" data-panel="files" title="Folder tree (Shift+1)" aria-label="Folder tree">${LAYOUT_ICON.left}</button>
          <button class="icon-btn" data-panel="history" title="History bar: branches and the replay (Shift+3)" aria-label="History bar">${LAYOUT_ICON.bottom}</button>
          <button class="icon-btn" data-panel="inspector" title="Review panel: the verdict, or the commit / file in focus (Shift+2)" aria-label="Review panel">${LAYOUT_ICON.right}</button>
        </span>
      </div>
    </header>
    <div class="ws" id="ws">
      <aside class="ws-tree">
        <div class="pane-title"><span>${icon('folder')} What changed</span><span class="pt-n">${plural(changed.length, 'file')}</span></div>
        <div class="tree" id="tree"></div>
      </aside>
      <section class="ws-center">
        <div class="ws-map">
          <div id="map" class="map"></div>
          <div class="map-float tl">
            <div class="seg small" id="mode"><button data-mode="before">Before</button><button data-mode="compare">Compare</button><button data-mode="after">After</button></div>
            <details class="layers"><summary class="chip-toggle">Layers</summary><div class="layers-menu">
              <label class="toggle"><input type="checkbox" data-layer="ripple" checked/> May affect</label>
              <label class="toggle" title="Fade files this task did not touch"><input type="checkbox" data-layer="focus" checked/> Changes only</label>
            </div></details>
          </div>
          <div class="map-zoom"><button id="zin" aria-label="Zoom in">+</button><button id="zout" aria-label="Zoom out">−</button><button id="zfit" aria-label="Fit map">⤢</button><button id="zrot" aria-label="Turn the view" title="Turn the view (Q / E)">⟳</button><button id="zlens" aria-label="Before lens" title="Before lens: see the code as it was under the cursor (L)" aria-pressed="false">◎</button></div>
          <div class="map-editbar hidden" id="editbar" role="region" aria-label="Edit the requested area"></div>
          <div class="commit-hud hidden" id="hud" aria-live="polite"></div>
          <div class="legend" id="legend"></div>
        </div>
        <div class="journey" id="journey"></div>
      </section>
      <aside class="ws-inspector" id="inspector"></aside>
    </div>
  </div>`;

  // ---------------------------------------------------------------- panels: the folder tree (left) and the review panel (right)
  const LAYOUT0 = { files: window.innerWidth >= 1280, inspector: true, history: true };
  V.layout = { ...LAYOUT0, ...(store.get('overlook.layout') || {}) };
  function applyLayout() {
    const L = V.layout, wide = window.innerWidth > 960;
    const ws = $('#ws');
    ws.style.gridTemplateColumns = wide ? [L.files ? '290px' : null, 'minmax(0, 1fr)', L.inspector ? '410px' : null].filter(Boolean).join(' ') : '';
    $('.ws-tree').hidden = !L.files;
    $('#inspector').hidden = !L.inspector;
    $('#journey').hidden = L.history === false;
    $$('[data-panel]').forEach((b) => { b.classList.toggle('on', !!L[b.dataset.panel]); b.setAttribute('aria-pressed', String(!!L[b.dataset.panel])); });
    store.set('overlook.layout', { files: L.files, inspector: L.inspector, history: L.history !== false });
  }
  function togglePanel(k, on) {
    V.layout[k] = on ?? !V.layout[k];
    applyLayout();
  }
  $$('[data-panel]').forEach((b) => (b.onclick = () => togglePanel(b.dataset.panel)));

  // The number tiles in the header: the four questions of the review at a glance.
  // The review at a glance, one line: where things stand (a verdict that names the real issue), then four
  // measures as a label and a number. Colour only where something needs attention; details are in the tooltips.
  // During a replay the verdict shows the commit on screen and the scope measures its state ("so far").
  // The branch line under the title says where the history bar stands: the task, a commit of it, or any other
  // commit of the picture, compared with the commit before.
  function renderBranchLine() {
    const el = $('#whBranch');
    if (!el) return;
    const task = `${icon('branch')} <code class="ref">${esc(headRef)}</code> <span class="muted">→</span> <code class="ref">${esc(baseRef)}</code>`;
    const p = V.progress;
    if (V.look) {
      const { c, lane, files, when } = lookInfo(V.look);
      const [pl, mi] = files.reduce((a, f) => [a[0] + (f.plus ?? 0), a[1] + (f.minus ?? 0)], [0, 0]);
      el.innerHTML = `${icon('branch')} <code class="ref look">${esc(lane?.name ?? '')}</code> <span class="mono">${short(c.sha)}</span> <span class="muted">·</span> ${plural(files.length + (c.moreFiles ?? 0), 'file')} <span class="p mono">+${pl}</span> <span class="m mono">−${mi}</span> <span class="muted">· vs the commit before · ${esc(when)}</span>`;
    } else if (V.lane) {
      const v = laneView(V.lane.id);
      el.innerHTML = `${icon('branch')} <code class="ref look">${esc(v?.lane.name ?? '')}</code> <span class="muted">vs</span> <code class="ref">${esc(headRef)}</code> <span class="muted">·</span> ${plural(v?.list.length ?? 0, 'commit')} <span class="muted">·</span> ${plural(v?.files.length ?? 0, 'file')}`;
    } else if (p > 0 && p < lastStep && mergeAt(p) && H.bySha.get(commits[p - 1].sha)) {
      const c = commits[p - 1], g = H.bySha.get(c.sha), { files } = lookInfo(c.sha);
      const [pl, mi] = files.reduce((a, f) => [a[0] + (f.plus ?? 0), a[1] + (f.minus ?? 0)], [0, 0]);
      el.innerHTML = `${task} <span class="muted">·</span> commit ${p} of ${commits.length} <span class="mono">${short(c.sha)}</span> <span class="muted">· a merge brings in</span> ${plural(files.length + (g.moreFiles ?? 0), 'file')} <span class="p mono">+${pl}</span> <span class="m mono">−${mi}</span> <span class="muted">vs ${p === 1 ? 'base' : `commit ${p - 1}`}</span>`;
    } else if (p > 0 && p < lastStep) {
      const c = commits[p - 1], [pl, mi] = Object.values(c.changes ?? {}).reduce((a, x) => [a[0] + (x.plus || 0), a[1] + (x.minus || 0)], [0, 0]);
      el.innerHTML = `${task} <span class="muted">·</span> commit ${p} of ${commits.length} <span class="mono">${short(c.sha)}</span> <span class="muted">·</span> ${plural((c.files ?? []).length, 'file')} <span class="p mono">+${pl}</span> <span class="m mono">−${mi}</span> <span class="muted">· vs ${p === 1 ? 'the base' : `commit ${p - 1}`}</span>`;
    } else {
      el.innerHTML = `${task} <span class="muted">·</span> ${plural(commits.length, 'commit')} <span class="muted">·</span> ${plural(changed.length, 'file')} <span class="p mono">+${plus}</span> <span class="m mono">−${minus}</span>${p === 0 ? ' <span class="muted">· at the base</span>' : ''}`;
    }
  }
  const kpiWas = {};
  function renderKpis() {
    renderBranchLine();
    const out = city.items.length, n = pending().length, bad = city.claims.length - hold;
    const r = runs.cross, p = V.progress, mid = p > 0 && p < lastStep;
    const now = mid ? statsAt(p) : { out: changed.filter((f) => f.kind === 'out').length, aff: affected.length, files: changed.length };
    const c = mid ? commits[p - 1] : null;
    const failed = r && !r.skipped && !r.passed;
    const why = [out && n && `${plural(n, 'change')} outside the request to decide`, bad && `${plural(bad, 'claim')} not backed by git`, failed && 'original tests fail', affected.length && `${affected.length} may be affected`].filter(Boolean);
    const head = mid
      ? { cls: c.outside ? 'bad' : 'in', icon: 'commit', t: `Commit ${p} of ${commits.length}`, s: c.message, live: true }
      : failed || (out && n) ? { cls: 'bad', icon: 'x', t: 'Needs your review', s: why.join(' · '), tipOnly: true }
      : bad ? { cls: 'warn', icon: 'alert', t: 'Check the report', s: why.join(' · '), tipOnly: true }
      : out ? { cls: 'ok', icon: 'check', t: 'Ready to merge', s: `all ${plural(out, 'change')} outside the request decided` }
      : { cls: 'ok', icon: 'check', t: 'Looks clean', s: 'inside the request · every claim holds' };
    const of = mid ? now.files : changed.length;
    let stats = [
      { key: 'out', cls: now.out ? 'bad' : '', label: 'Outside the request', v: now.out, unit: `/ ${of}`, tag: mid ? 'so far' : '', tip: mid ? `At commit ${p}: ${now.out} of ${of} changed files are outside the request` : `${now.out} of ${of} changed files are outside the request`, act: 'decisions' },
      { key: 'aff', cls: now.aff ? 'warn' : '', label: 'May be affected', v: now.aff, unit: now.aff === 1 ? 'file' : 'files', tag: mid ? 'so far' : '', tip: 'Files nobody edited that import a changed file', act: 'affected' },
      { key: 'rep', cls: bad ? 'bad' : '', label: 'Report', v: hold, unit: `/ ${city.claims.length} hold`, tag: '', tip: bad ? `${bad} of the agent's claims are not backed by git` : 'Every claim in the agent\'s report holds', act: 'claim' },
      { key: 'tst', cls: failed ? 'bad' : r?.passed ? 'ok' : 'muted', label: 'Original tests', v: !r ? 'Not run' : r.skipped ? 'Skipped' : r.passed ? 'Pass' : 'Fail', unit: '', tag: '', tip: !r ? (canRun ? 'Run them from the verdict panel' : 'Needs the local server (npm run site)') : 'The base version of the tests, run on the new code', act: 'overview' },
    ];
    let focus = head;
    if (V.look) {
      const { c, lane, files, when } = lookInfo(V.look);
      const both = files.filter((f) => f.both).length, [pl, mi] = files.reduce((a, f) => [a[0] + (f.plus ?? 0), a[1] + (f.minus ?? 0)], [0, 0]);
      focus = { cls: both ? 'warn' : 'in', icon: 'commit', t: `${lane?.name ?? ''} · ${short(c.sha)}`, s: c.message, live: false, look: true };
      stats = [
        { key: 'lf', cls: '', label: 'Files changed', v: files.length + (c.moreFiles ?? 0), unit: 'vs the commit before', tag: '', tip: 'Files this commit changed against its parent', act: 'look' },
        { key: 'lb', cls: both ? 'bad' : '', label: 'Also changed by this task', v: both, unit: both === 1 ? 'file' : 'files', tag: both ? 'may conflict' : '', tip: 'Files both this commit and the task changed', act: 'look' },
        { key: 'll', cls: '', label: 'Lines', v: `+${pl} −${mi}`, unit: '', tag: '', tip: 'Lines added and removed by this commit', act: 'look' },
        { key: 'lw', cls: 'muted', label: 'When', v: when, unit: '', tag: '', tip: 'Where this commit sits against the task', act: 'look' },
      ];
    } else if (V.lane) {
      const v = laneView(V.lane.id, V.lane.sha);
      if (v) {
        const st = v.lane.pr?.state ?? (v.lane.merged ? 'merged' : v.lane.kind === 'base' ? 'base branch' : 'open');
        focus = { cls: v.overlap.length ? 'warn' : 'in', icon: 'branch', t: `Comparing ${v.lane.name}`, s: v.lane.pr ? `PR #${v.lane.pr.number} · ${v.lane.pr.title ?? ''}` : v.lane.kind === 'base' ? 'the base branch, since this task branched off' : 'a branch active while this task was open', live: false, look: true };
        stats = [
          { key: 'cc', cls: '', label: 'Commits', v: v.list.length, unit: v.lane.kind === 'base' ? 'by others' : '', tag: v.landed.length ? 'task merged here' : '', tip: 'Commits on that branch in this period', act: 'lane' },
          { key: 'cf', cls: '', label: 'Files changed', v: v.files.length, unit: 'files', tag: '', tip: 'Files that branch changed', act: 'lane' },
          { key: 'cb', cls: v.overlap.length ? 'bad' : '', label: 'Also changed by this task', v: v.overlap.length, unit: v.overlap.length === 1 ? 'file' : 'files', tag: v.overlap.length ? 'may conflict' : '', tip: 'Files both sides changed: where a merge can conflict', act: 'lane' },
          { key: 'cs', cls: 'muted', label: 'State', v: st, unit: '', tag: '', tip: 'Where that branch stands', act: 'lane' },
        ];
      }
    }
    $('#kpis').innerHTML = `<button class="kv k-${focus.cls}${focus.live ? ' live' : ''}${focus.look ? ' look' : ''}" data-kpi="${mid && !focus.look ? 'replay' : focus.look ? 'back' : 'start'}" title="${esc(focus.s)}">
        <span class="kv-i">${focus.live ? '<i class="kh-live"></i>' : icon(focus.icon)}</span>
        <span class="kv-t"><b>${esc(focus.t)}</b>${focus.tipOnly ? '' : `<span>${esc(focus.s)}</span>`}</span>${focus.look ? '<span class="kv-x" title="Back to the task">✕</span>' : ''}</button>`
      + stats.map((t) => `<button class="km ${t.cls ? `k-${t.cls}` : ''}" data-kpi="${t.act}" title="${esc(t.tip)}">
        <span class="km-l">${esc(t.label)}</span>
        <span class="km-v"><b data-kv="${t.key}" data-to="${typeof t.v === 'number' ? t.v : ''}">${typeof t.v === 'number' ? kpiWas[t.key] ?? t.v : t.v}</b>${t.unit ? `<small>${esc(t.unit)}</small>` : ''}${t.tag ? `<em>${esc(t.tag)}</em>` : ''}</span></button>`).join('');
    // count from the last value shown to the new one
    for (const b of $$('#kpis [data-to]')) {
      if (b.dataset.to === '') continue;
      const to = Number(b.dataset.to), from = kpiWas[b.dataset.kv] ?? to;
      kpiWas[b.dataset.kv] = to;
      if (from === to || matchMedia('(prefers-reduced-motion: reduce)').matches) { b.textContent = to; continue; }
      b.classList.add('bump');
      const t0 = performance.now();
      const tick = (t) => { const k = Math.min(1, (t - t0) / 450); b.textContent = Math.round(from + (to - from) * (1 - Math.pow(1 - k, 3))); if (k < 1) requestAnimationFrame(tick); else setTimeout(() => b.classList.remove('bump'), 200); };
      requestAnimationFrame(tick);
    }
    $$('[data-kpi]').forEach((b) => (b.onclick = () => {
      const a = b.dataset.kpi;
      if (a === 'replay') return timer ? stopPlay() : null;
      if (a === 'back') return V.look ? clearLook() : compareWith(null);
      if (a === 'look' || a === 'lane') return;
      if (a === 'affected' && affected[0]) return select({ type: 'file', id: affected[0].path });
      V.openQ = { decisions: 'scope', claim: 'report', overview: 'tests', start: 'decide' }[a] ?? V.openQ;
      if (V.progress > 0 && V.progress < lastStep) { stopPlay(); setProgress(lastStep); }
      select(null);
      if (a === 'decisions' && city.items[0]) map?.focusPaths(city.items.map((i) => i.file));
    }));
  }

  // ---------------------------------------------------------------- tree
  // Another branch's commit (or a merge in the task's branch) on screen: its files head the tree, compared with the
  // commit before it, so the left pane follows the map and the review panel.
  function commitFiles() {
    const sha = V.look ?? (V.progress > 0 && V.progress < lastStep && mergeAt(V.progress) ? commits[V.progress - 1].sha : null);
    if (!sha || !H.bySha.get(sha)) return null;
    const { c, lane, files } = lookInfo(sha);
    return { c, lane, files, more: c.moreFiles ?? 0 };
  }
  function commitTreeHtml() {
    const cf = commitFiles();
    if (!cf) return '';
    const row = (f) => { const cf2 = byPath.get(f.path), name = f.path.split('/').pop(), dir = f.path.split('/').slice(0, -1).join('/');
      return `<${cf2 ? `button class="t-cf ${f.both ? 'both' : ''}" data-cf-file="${esc(f.path)}"` : 'div class="t-cf off"'} data-hover="${esc(f.path)}" title="${esc(f.path)}"><span class="kdot k-other"></span><span class="t-cf-n mono">${esc(name)}</span>${f.plus != null ? `<span class="t-cf-pm mono"><em class="p">+${f.plus}</em> <em class="m">−${f.minus}</em></span>` : ''}<span class="t-cf-d mono">${esc(dir || './')}${f.both ? ' · also changed by this task' : ''}</span></${cf2 ? 'button' : 'div'}>`; };
    return `<div class="t-commit"><div class="t-commit-h">${icon('commit')} <b>In this commit · ${plural(cf.files.length + cf.more, 'file')}</b></div>
      <div class="t-commit-s"><span class="mono">${esc(cf.lane?.name ?? '')} · ${short(cf.c.sha)}</span> · compared with the commit before it</div>${cf.files.map(row).join('')}${cf.more ? `<p class="i-note">+${cf.more} more files</p>` : ''}
      <div class="t-commit-t">This task's files</div></div>`;
  }
  function renderTree() {
    $('#tree').innerHTML = commitTreeHtml() + folderTree();
    wire($('#tree'));
    // a file of the commit on screen: point at it on the map; the commit stays on screen
    $$('#tree [data-cf-file]').forEach((b) => (b.onclick = () => map?.select(b.dataset.cfFile, { zoom: true })));
    $$('#tree [data-hover]').forEach((r) => {
      r.onmouseenter = () => map?.hover(r.dataset.hover.split('|').filter(Boolean));
      r.onmouseleave = () => map?.hover([]);
    });
    $('#tree .sel')?.scrollIntoView({ block: 'nearest' });
  }

  const isSel = (type, id) => V.sel?.type === type && V.sel?.id === id;
  const decIcon = (f) => { const d = V.decisions[f.path]; return d === 'approve' ? `<span class="t-dec ok" title="approved">${icon('check')}</span>` : d === 'revert' ? `<span class="t-dec bad" title="will be reverted">${icon('undo')}</span>` : ''; };
  // A long name keeps its end (the part that tells files apart): "assign_copi…to_issue.snap".
  const midName = (name) => {
    const cut = name.length > 18 ? Math.min(9, Math.floor(name.length / 3)) : 0;
    return `<span class="t-name t-mid"><span class="t-h">${esc(name.slice(0, name.length - cut))}</span><span class="t-t">${esc(name.slice(name.length - cut))}</span></span>`;
  };
  const STATUS = { added: ['A', 'added'], modified: ['M', 'modified'], deleted: ['D', 'deleted'], renamed: ['R', 'renamed'] };
  // Where a file stands at the replay's current commit: touched by it (now) or not changed yet (later).
  const flowOf = (f) => {
    const p = V.progress;
    if (p <= 0 || p >= lastStep || f.step == null) return '';
    if ((commits[p - 1]?.files ?? []).includes(f.path)) return 'now';
    return f.step > p ? 'later' : '';
  };
  const bothSides = () => (V.look ? new Set(lookInfo(V.look).files.filter((f) => f.both).map((f) => f.path)) : V.lane ? new Set(laneView(V.lane.id, V.lane.sha)?.overlap ?? []) : null);
  const fileRow = (f, depth, extra = '') => `<button class="t-row t-file k-${kindOf(f)} ${V.lane || V.look ? (bothSides().has(f.path) ? 'both' : 'later') : flowOf(f)} ${isSel('file', f.path) ? 'sel' : ''}" style="--d:${depth}" data-file="${esc(f.path)}" data-hover="${esc(f.path)}" title="${esc(f.path)} · ${esc(KIND_LABEL[kindOf(f)] ?? '')}">
      <span class="kdot k-${kindOf(f)}"></span>${midName(f.name)}${extra}${decIcon(f)}
      ${f.status !== 'unchanged' ? `<span class="t-num"><span class="p">+${f.plus}</span><span class="m">−${f.minus}</span></span>${f.status !== 'modified' ? `<span class="t-st s-${f.status}" title="${STATUS[f.status]?.[1] ?? f.status}">${STATUS[f.status]?.[0] ?? ''}</span>` : ''}` : f.kind === 'affected' ? '' : ''}</button>`;

  function folderTree() {
    const root = { dirs: new Map(), files: [] };
    for (const f of city.files) {
      let node = root;
      const parts = f.path.split('/');
      for (const p of parts.slice(0, -1)) {
        if (!node.dirs.has(p)) node.dirs.set(p, { dirs: new Map(), files: [], path: (node.path ?? '') + p + '/' });
        node = node.dirs.get(p);
      }
      node.files.push(f);
    }
    const stats = (node) => {
      const s = { in: 0, out: 0, affected: 0, all: 0, paths: [] };
      for (const f of node.files) { s.all++; if (f.kind !== 'none') { s[f.kind]++; s.paths.push(f.path); } }
      for (const d of node.dirs.values()) { const t = stats(d); s.in += t.in; s.out += t.out; s.affected += t.affected; s.all += t.all; s.paths.push(...t.paths); }
      return s;
    };
    const walk = (node, depth) => {
      let out = '';
      for (const [first, dir] of [...node.dirs].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
        // a folder that only holds one folder is shown as one row: "github/__toolsnaps__"
        let name = first, d = dir;
        const shownFiles = (x) => x.files.filter((f) => V.showQuiet || f.kind !== 'none').length;
        const shownDirs = (x) => [...x.dirs].filter(([, y]) => V.showQuiet || stats(y).paths.length);
        while (!shownFiles(d) && shownDirs(d).length === 1) { const [n2, d2] = shownDirs(d)[0]; name += '/' + n2; d = d2; }
        const s = stats(d);
        const busy = s.in + s.out + s.affected;
        if (!busy && !V.showQuiet) continue;
        const open = V.open.has(d.path) || (busy && !V.open.has('-' + d.path));
        const fenced = fencePaths.some((p) => d.path === p || d.path.startsWith(p));
        const seg = (n, k) => (n ? `<i class="k-${k}" style="flex:${n}"></i>` : '');
        const tip = [s.out && `${s.out} outside`, s.in && `${s.in} inside`, s.affected && `${s.affected} may be affected`].filter(Boolean).join(' · ') || `${s.all} unchanged`;
        out += `<button class="t-row t-dir ${fenced ? 'fenced' : ''}" style="--d:${depth}" data-dir="${esc(d.path)}" data-hover="${esc(s.paths.join('|'))}" title="${esc(d.path)} · ${esc(tip)}${fenced ? ' · requested area' : ''}">
          <span class="t-caret ${open ? 'open' : ''}">${icon('chevron')}</span>${icon('folder')}<span class="t-name">${esc(name)}</span>
          ${busy ? `<span class="t-mix" aria-label="${esc(tip)}"><span class="t-bar">${seg(s.out, 'out')}${seg(s.in, 'in')}${seg(s.affected, 'aff')}</span><b class="${s.out ? 'k-out' : s.affected ? 'k-aff' : 'k-in'}">${busy}</b></span>` : `<span class="t-quiet">${s.all}</span>`}</button>`;
        if (open) out += walk(d, depth + 1);
      }
      for (const f of node.files.sort((a, b) => (a.name < b.name ? -1 : 1))) {
        if (f.kind === 'none' && !V.showQuiet) continue;
        out += fileRow(f, depth);
      }
      return out;
    };
    const quiet = city.files.filter((f) => f.kind === 'none').length;
    return `${walk(root, 0)}
      <button class="t-more" data-quiet>${V.showQuiet ? 'Hide' : 'Show'} ${plural(quiet, 'unchanged file')}</button>`;
  }

  // ---------------------------------------------------------------- inspector
  // One card at a time: a selected file or claim, else the commit the replay stands on, else the verdict.
  function renderInspector() {
    const box = $('#inspector');
    const s = V.sel, p = V.progress;
    let body;
    if (s?.type === 'file' && byPath.has(s.id)) body = fileInspector(byPath.get(s.id), s.commit);
    else if (s?.type === 'claim') body = claimInspector(city.claims[s.id]);
    else if (V.look) body = lookCard();
    else if (V.lane) body = compareCard();
    else if (s?.type === 'commit') body = commitCard(s.id);
    else if (p > 0 && p < lastStep) body = commitCard(p);
    else body = overview();
    box.innerHTML = body;
    wire(box);
    $$('[data-hud-step]', box).forEach((b) => (b.onclick = () => { stopPlay(); V.sel = null; setProgress(Math.max(0, Math.min(lastStep, Number(b.dataset.hudStep)))); }));
    $('[data-hud-play]', box)?.addEventListener('click', () => (timer ? stopPlay() : play(p)));
    $$('[data-q]', box).forEach((b) => (b.onclick = () => { V.openQ = V.openQ === b.dataset.q ? null : b.dataset.q; renderInspector(); }));
    $$('[data-cmp-close]', box).forEach((b) => (b.onclick = () => compareWith(null)));
    $$('[data-look-close]', box).forEach((b) => (b.onclick = () => clearLook()));
    $$('[data-look-sha]', box).forEach((b) => (b.onclick = () => lookAt(b.dataset.lookSha)));
    $$('[data-look-lane]', box).forEach((b) => (b.onclick = () => compareWith(b.dataset.lookLane)));
    $$('[data-cmp-sha]', box).forEach((b) => (b.onclick = () => lookAt(b.dataset.cmpSha)));
    $('[data-cmp-all]', box)?.addEventListener('click', () => compareWith(V.lane.id));
    box.scrollTop = 0;
  }

  const back = () => '<button class="linkbtn i-back" data-overview>← Back</button>';

  // The verdict: four questions, one line each; one of them open at a time.
  function overview() {
    const out = city.items.length, n = pending().length;
    const inFiles = changed.filter((f) => f.inFence).length;
    const w = (x) => `${changed.length ? (x / changed.length) * 100 : 0}%`;
    const r = runs.cross;
    const tests = !r ? ['muted', 'Not run yet'] : r.skipped ? ['muted', 'Could not run'] : r.passed ? ['ok', 'Original tests pass'] : ['bad', 'Original tests fail on the new code'];
    const revertPaths = Object.entries(V.decisions).filter(([, d]) => d === 'revert').map(([p]) => p);
    const qs = [
      { id: 'scope', cls: out ? 'bad' : 'ok', q: 'Did the agent stay inside the request?', a: out ? `No: ${out} of ${changed.length} files are outside` : `Yes: all ${changed.length} files are inside`,
        body: `<div class="scope-bar"><span class="sb-in" style="width:${w(inFiles)}"></span><span class="sb-out" style="width:${w(out)}"></span></div>
          <div class="i-fence">${fencePaths.map((p) => `<code class="ref fence">${esc(p)}</code>`).join(' ') || '<span class="muted">No requested area</span>'}
            ${fenceConfirmed ? `<span class="ok small">${icon('check')} confirmed</span>` : `<span class="warn small">${icon('alert')} proposed${auditedBy === 'draft' ? '' : auditedBy === 'example' ? ' for this example' : ' by Bob'}</span>`}</div>
          <div class="i-actions">${fenceConfirmed ? '' : '<button class="btn sm" data-confirm-fence>Confirm</button>'}<button class="btn sm" data-edit-fence>Edit area</button></div>
          ${affected.length ? `<p class="i-note">${plural(affected.length, 'more file')} import a changed file and may be affected.</p>` : ''}` },
      { id: 'report', cls: hold < city.claims.length ? 'bad' : 'ok', q: "Is the agent's report true?", a: `${hold} of ${city.claims.length} claims hold`,
        body: `<ul class="vc-list">${city.claims.map((c, i) => [c, i]).sort((a, b) => SEVERITY[a[0].verdict] - SEVERITY[b[0].verdict] || a[1] - b[1]).map(([c, i]) => { const v = VERDICT[c.verdict] ?? VERDICT.unverified; return `<li><button class="vc v-${v.cls}" data-claim="${i}"><span class="vc-chip">${icon(v.icon)}${esc(v.word)}</span><span class="vc-t">${esc(claimText(c))}</span></button></li>`; }).join('')}</ul>
          <details class="i-report"><summary>The agent's report</summary>${reportHtml()}</details>` },
      { id: 'tests', cls: tests[0], q: 'Do the original tests still pass?', a: tests[1],
        body: `${r && !r.skipped ? `<p class="i-note"><code>${esc(r.command)}</code>${r.restoredTests?.length ? ` with ${esc(r.restoredTests.join(', '))} restored to base` : ''}</p>` : r?.skipped ? `<p class="i-note">${esc(r.reason)}</p>` : ''}
          ${canRun ? `<div class="i-actions"><button class="btn sm" data-run="cross" ${V.running ? 'disabled' : ''}>${V.running === 'cross' ? '<span class="spinner"></span> Running…' : r ? 'Run again' : 'Run tests'}</button></div>` : '<p class="i-note">Runs with the local server (<code>npm run site</code>).</p>'}` },
      { id: 'decide', cls: n ? 'next' : 'ok', q: 'What do I do now?', a: n ? `Decide ${plural(n, 'change')} outside the request` : 'All changes decided',
        body: `<div class="q-progress"><span style="width:${out ? ((out - n) / out) * 100 : 100}%"></span></div>
          <div class="i-actions">
            ${n ? '<button class="btn primary" data-start>Start review →</button>' : ''}
            ${!n && revertPaths.length && canRun ? `<button class="btn" data-run="reverts" ${V.running ? 'disabled' : ''}>${V.running === 'reverts' ? '<span class="spinner"></span>' : 'Run tests with my reverts'}</button>${runs.reverts ? `<span class="${runs.reverts.passed ? 'ok' : 'bad'} small">${runs.reverts.passed ? 'passed' : 'failed'}</span>` : ''}` : ''}
            <button class="btn" data-export>Export decisions</button>
            ${id ? '<button class="btn" data-pr>Copy PR comment</button>' : ''}
          </div>
          ${!n && revertPaths.length ? `<p class="i-note">If the reverts break the request: <code>/fix-forward ${esc(id || 'audit-id')}</code> in Bob.</p>` : ''}` },
    ];
    if (V.openQ === undefined) V.openQ = (qs.find((x) => x.cls === 'bad') ?? qs.find((x) => x.cls === 'next'))?.id ?? 'scope';
    return `<div class="i-pad i-verdict">
      ${qs.map((x) => `<section class="vq ${x.cls} ${V.openQ === x.id ? 'open' : ''}">
        <button class="vq-h" data-q="${x.id}" aria-expanded="${V.openQ === x.id}"><span class="vq-i">${icon(x.cls === 'ok' ? 'check' : x.cls === 'bad' ? 'x' : x.cls === 'next' ? 'dot' : 'dot')}</span><span class="vq-t"><span class="vq-q">${esc(x.q)}</span><b class="vq-a">${esc(x.a)}</b></span><span class="vq-c">${icon('chevron')}</span></button>
        ${V.openQ === x.id ? `<div class="vq-b">${x.body}</div>` : ''}
      </section>`).join('')}
    </div>`;
  }

  function reportHtml() {
    const t = text(city.bobReport);
    if (!t) return '<p class="muted">No report was given.</p>';
    const claims = city.claims.map((c) => ({ ...c, txt: claimText(c), at: t.indexOf(claimText(c)) })).filter((c) => c.at >= 0).sort((a, b) => a.at - b.at);
    let html = '', pos = 0;
    for (const c of claims) {
      if (c.at < pos) continue;
      const v = VERDICT[c.verdict] ?? VERDICT.unverified;
      html += esc(t.slice(pos, c.at)) + `<span class="claim-mark c-${esc(c.verdict)}">${esc(c.txt)}<span class="vchip v-${v.cls}">${icon(v.icon)}${v.word}</span></span>`;
      pos = c.at + c.txt.length;
    }
    return `<p class="report">${(html + esc(t.slice(pos))).replace(/`([^`<>]+)`/g, '<code>$1</code>')}</p>`;
  }

  function fileInspector(f, commitN) {
    const it = itemByFile.get(f.path);
    const cause = f.kind === 'affected' ? itemFor(f) : null;
    const d = it ? V.decisions[f.path] : null;
    const against = city.claims.map((c, i) => ({ c, i })).filter(({ c }) => c.verdict !== 'true' && text(c.detail).includes(f.path));
    const ripple = (it?.ripple || []).map((p) => byPath.get(p)).filter(Boolean);
    const screens = (city.screens || []).filter((s) => s.file === f.path || (it?.ripple || []).includes(s.file));
    const side = (v) => (v && typeof v === 'object' && v.img ? `<img src="${esc(v.img)}" alt=""/>` : esc(text(v)));
    const commit = commitN ? commits[commitN - 1] : null;
    const change = commit?.changes?.[f.path];
    const diff = change ? change.diff : f.diff;
    const reasons = it ? [...((it.reasons || []).some((r) => ['outside_fence', 'additive', 'deleted'].includes(r)) ? [] : ['outside_fence']), ...(it.reasons || [])] : [];
    const idx = it ? city.items.indexOf(it) + 1 : 0;
    return `<div class="i-pad">
      ${back()}
      <p class="i-kicker">${it ? `Change ${idx} of ${city.items.length} outside the request` : esc(KIND_LABEL[f.kind] ?? '')}</p>
      <h2 class="i-title">${esc(f.name)}</h2>
      <p class="i-path mono">${esc(f.path)}</p>
      <div class="labels i-badges">${badges(f)}${f.step ? `<button class="linkbtn small" data-commit="${f.step}">commit ${f.step}</button>` : ''}</div>
      ${it?.plain ? `<p class="i-plain"><b>${esc(text(it.plain.title))}</b> ${esc(text(it.plain.detail))}</p>` : ''}
      ${it ? `<div class="i-decide">
          <button class="btn big-ok ${d === 'approve' ? 'on' : ''}" data-d="approve" data-f="${esc(f.path)}">${icon('check')} Approve <kbd>A</kbd></button>
          <button class="btn big-bad ${d === 'revert' ? 'on' : ''}" data-d="revert" data-f="${esc(f.path)}">${icon('undo')} Revert <kbd>R</kbd></button>
          <button class="btn" data-next>Next <kbd>J</kbd></button></div>` : cause ? `<p class="i-note">Decide on its cause: <button class="linkbtn" data-file="${esc(cause.file)}">${esc(cause.file)}</button></p>` : ''}
      ${it ? `<section class="i-sec"><h3>Why Overlook flagged it</h3><ul class="rv-why">${reasons.map((r) => `<li>${esc(REASON[r] ?? r)}</li>`).join('')}</ul></section>` : ''}
      ${f.kind === 'affected' ? `<section class="i-sec"><h3>Why it may be affected</h3>${(f.causes || []).map((c) => whyChain(f, byPath.get(c))).join('')}<p class="i-note">An import means the behaviour can change, not that it did. Confirm with the tests or by looking at the screen.</p></section>` : ''}
      ${against.length ? `<section class="i-sec"><h3>The report says otherwise</h3>${against.map(({ c, i }) => { const v = VERDICT[c.verdict] ?? VERDICT.unverified; return `<button class="rv-claim v-${v.cls}" data-claim="${i}">${icon(v.icon)} “${esc(claimText(c))}” <span class="muted">is ${v.word}</span></button>`; }).join('')}</section>` : ''}
      ${ripple.length ? `<section class="i-sec"><h3>What this change may affect</h3>${ripple.slice(0, 6).map((r) => whyChain(r, f, true)).join('')}${ripple.length > 6 ? `<p class="i-note">and ${ripple.length - 6} more: ${ripple.slice(6).map((r) => `<button class="linkbtn mono" data-file="${esc(r.path)}">${esc(r.name)}</button>`).join(', ')}</p>` : ''}</section>` : ''}
      ${screens.length ? `<section class="i-sec"><h3>Screens</h3><div class="screens">${screens.map((s) => `<div class="screen"><div class="sc-head"><b>${esc(text(s.title))}</b><span class="muted">${esc(text(s.who))}</span></div><div class="ba"><div><small>Before</small>${side(s.before)}</div><div class="after"><small>After</small>${side(s.after)}</div></div></div>`).join('')}</div></section>` : ''}
      ${V.code && diff?.length ? `<section class="i-sec"><h3>${commit ? `Change in commit ${commit.n}` : 'The change'} <span class="muted small"><span class="p">+${(change ?? f).plus}</span> <span class="m">−${(change ?? f).minus}</span></span>${commit ? ' <button class="linkbtn small" data-full>show all commits</button>' : ''}</h3>${diffTable(diff)}</section>` : ''}
    </div>`;
  }

  // Why `f` may be affected by `cause`: 1 it imports it (the statement), 2 this task changed it (the lines that
  // matter to what f uses), 3 so f may behave differently. Deterministic: import graph + diff, no model.
  const importedNames = (line) => {
    if (!line) return [];
    const braces = line.match(/\{([^}]*)\}/);
    const names = braces ? braces[1].split(',').map((x) => x.trim().split(/\s+as\s+/)[0]).filter(Boolean) : [];
    const def = line.match(/^import\s+([A-Za-z_$][\w$]*)\s*(?:,|from)/);
    return def ? [def[1], ...names] : names;
  };
  function whyChain(f, cause, compact = false) {
    if (!f || !cause) return '';
    const line = f.uses?.[cause.path];
    const names = importedNames(line);
    const rows = (cause.diff ?? []).filter(([k, t]) => (k === 'a' || k === 'd') && String(t).trim());
    const hits = names.length ? rows.filter(([, t]) => names.some((n) => String(t).includes(n))) : [];
    const shown = (hits.length ? hits : rows.filter(([, t]) => /\bexport\b/.test(t)).length ? rows.filter(([, t]) => /\bexport\b/.test(t)) : rows).slice(0, 4);
    const causeWhere = cause.kind === 'out' ? 'outside the request' : 'inside the request';
    const plain = itemByFile.get(cause.path)?.plain ? `<p class="why-plain">${esc(text(itemByFile.get(cause.path).plain.detail))}</p>` : '';
    return `<div class="why${compact ? ' compact' : ''}">
      <div class="why-step"><span class="why-n">1</span><div><button class="linkbtn mono" data-file="${esc(f.path)}">${esc(f.name)}</button> ${names.length ? `uses <b class="mono">${esc(names.slice(0, 3).join(', '))}</b> from` : 'imports'} <button class="linkbtn mono" data-file="${esc(cause.path)}">${esc(cause.name)}</button>
        ${line && V.code ? `<code class="why-code">${esc(line)}</code>` : ''}</div></div>
      <div class="why-step"><span class="why-n">2</span><div>This task changed <b class="mono">${esc(cause.name)}</b>${cause.step ? ` in <button class="linkbtn" data-commit="${cause.step}">commit ${cause.step}</button>` : ''}, <span class="${cause.kind === 'out' ? 'bad' : ''}">${causeWhere}</span>${names.length && hits.length ? `, including ${esc(names.length === 1 ? names[0] : 'what it uses')}` : ''}:
        ${V.code && shown.length ? `<div class="why-diff">${shown.map(([k, t]) => `<div class="hud-ln ${k}"><span>${k === 'a' ? '+' : '−'}</span><code>${esc(String(t).slice(0, 110))}</code></div>`).join('')}</div>` : ''}${plain}</div></div>
      <div class="why-step"><span class="why-n">3</span><div>So <b class="mono">${esc(f.name)}</b> ${f.kind === 'affected' ? 'may now behave differently, although nobody edited it' : f.status !== 'unchanged' ? 'was also edited in this task' : 'may now behave differently'}.</div></div>
    </div>`;
  }

  function claimInspector(c) {
    const v = VERDICT[c.verdict] ?? VERDICT.unverified;
    const ev = c.evidence || [];
    const by = ev.includes('check-run') ? 'an executed check' : ev.includes('test-run') ? 'a test run' : ev.includes('bob-judgement') ? (meta.draft ? 'nobody yet (draft audit)' : meta.example ? 'a person reading the diff (example audit)' : 'IBM Bob') : 'git';
    const named = city.files.filter((f) => text(c.detail).includes(f.path));
    return `<div class="i-pad">
      ${back()}
      <p class="i-kicker">Claim in the agent's report</p>
      <h2 class="i-title">“${esc(claimText(c))}”</h2>
      <div class="i-q ${v.cls}"><div class="i-qa">${icon(v.icon)} ${v.word}</div><p class="i-note">${esc(text(c.detail)).replace(/`([^`]+)`/g, '<code>$1</code>')}</p><p class="i-note">Decided by ${by}.</p></div>
      ${named.length ? `<section class="i-sec"><h3>Files behind this verdict</h3>${named.map((f) => `<button class="t-row t-file" data-file="${esc(f.path)}"><span class="kdot k-${kindOf(f)}"></span><span class="t-name mono">${esc(f.path)}</span></button>`).join('')}</section>` : ''}
      ${c.check?.command ? `<section class="i-sec"><h3>Executable check</h3><code class="cmd">${esc(c.check.command)}</code>${c.check.why ? `<p class="i-note">${esc(c.check.why)}</p>` : ''}${canRun ? `<button class="btn sm" data-run="checks">Run checks</button>` : ''}</section>` : ''}
    </div>`;
  }

  function badges(f) {
    const it = itemByFile.get(f.path);
    const k = kindOf(f);
    return `<span class="label l-${k}">${esc(KIND_LABEL[k] ?? k)}</span>
      ${it ? `<span class="risk risk-${it.risk}">${it.risk}</span>` : ''}
      ${f.isApi && f.status !== 'unchanged' ? '<span class="label l-bad">API</span>' : ''}
      ${f.test?.rewritten || f.test?.weakened ? `<span class="label l-warn">test ${f.test.weakened ? 'weakened' : 'rewritten'}</span>` : ''}
      ${f.status === 'added' ? '<span class="label l-muted">new file</span>' : f.status === 'deleted' ? '<span class="label l-muted">deleted</span>' : ''}`;
  }

  function diffTable(rows) {
    let o = 0, n = 0;
    const body = rows.map(([k, s]) => {
      if (k === 'h') {
        const m = s.match(/^@@ -(\d+)(?:,\d+)? \+(\d+)/);
        if (m) { o = Number(m[1]); n = Number(m[2]); }
        return `<tr class="h"><td class="ln"></td><td class="ln"></td><td class="code">${esc(s)}</td></tr>`;
      }
      const ol = k === 'a' ? '' : o++, nl = k === 'd' ? '' : n++;
      return `<tr class="${k}"><td class="ln">${ol}</td><td class="ln">${nl}</td><td class="code"><span class="sign">${k === 'a' ? '+' : k === 'd' ? '-' : ' '}</span>${esc(s)}</td></tr>`;
    }).join('');
    return `<div class="diff-wrap"><table class="diff-table">${body}</table></div>`;
  }

  // ---------------------------------------------------------------- map + timeline
  function mountMap() {
    map?.destroy();
    const shared = `<span><i class="lg lg-cube"></i>Height = lines of code</span><span><i class="lg lg-cap"></i>Bright top = share changed by this task</span><span><i class="lg lg-in"></i>Inside request</span><span><i class="lg lg-out"></i>Outside request (pin + light beam = to decide)</span>
         <span><i class="lg lg-aff"></i>May be affected (solid ring = seen on a screen)</span><span><i class="lg lg-vine"></i>Change → may affect</span><span><i class="lg lg-link"></i>Imports of the selected file</span><span><i class="lg lg-fence"></i>Request fence (dashed = proposed, lit = confirmed)</span>
         <span><i class="lg lg-ghost"></i>Dashed outline = height before a revert</span><span><i class="lg lg-arch"></i>Towers: big shared modules · domes: tests</span>`;
    $('#legend').innerHTML = `<span class="lk"><i class="kdot k-out"></i>Outside the request</span><span class="lk"><i class="kdot k-in"></i>Inside</span><span class="lk"><i class="kdot k-affected"></i>May be affected</span><span class="lk"><i class="lk-fence"></i>Requested area</span>
      <details class="lg-more"><summary aria-label="More about the map">?</summary><div class="lg-pop"><span><i class="lg lg-zones"></i>Neighbourhoods by role: screens, app logic, tests, server & data, infra & config</span>${shared}<span class="muted">Click a building · drag to pan · Shift- or right-drag to turn (Q / E) · L before lens · F edit the area on the map</span></div></details>`;
    stopEdit();
    map = createCity3D($('#map'), { city, requestId, text }, {
      replayCard: false,
      onSelect: (p) => (p && byPath.has(p) ? select({ type: 'file', id: p }, { zoom: false }) : select(null)),
      tooltip: (f, st) => (f.cluster ? `<b>${esc(f.district)}</b><span>${esc(f.name)}, folded</span>` : `<b>${esc(f.path)}</b><span>${esc(st === 'base' ? 'as it was (base)' : KIND_LABEL[st] ?? st)}${f.status !== 'unchanged' ? ` · +${f.plus} −${f.minus}` : ''}</span>${st === 'affected' && f.causes?.length ? `<span>uses ${esc(importedNames(f.uses?.[f.causes[0]]).slice(0, 2).join(', ') || 'code')} from ${esc(f.causes[0].split('/').pop())}, which this task changed</span>` : ''}`),
    });
    map.setDecisions({ ...V.decisions });
    map.setProgress(V.progress);
    renderHud();
    setMode(store.get('overlook.mode') || 'after');
    $$('[data-mode]').forEach((b) => (b.onclick = () => setMode(b.dataset.mode)));
    $$('[data-layer]').forEach((c) => (c.onchange = () => map.setLayers({ [c.dataset.layer]: c.checked })));
    $('#zin').onclick = () => map.zoomBy(1.35);
    $('#zout').onclick = () => map.zoomBy(1 / 1.35);
    $('#zfit').onclick = () => map.fit();
    $('#zrot').onclick = () => map.rotate?.(1);
    $('#zrot').hidden = !map.rotate;
    $('#zlens').onclick = () => toggleLens();
    $('#zlens').hidden = !map.toggleLens;
    $('#zlens').setAttribute('aria-pressed', 'false');
    const focus = $('[data-layer="focus"]');
    focus.checked = store.get('overlook.focus') !== false;
    focus.addEventListener('change', () => store.set('overlook.focus', focus.checked));
    $$('[data-layer]').forEach((c) => map.setLayers({ [c.dataset.layer]: c.checked }));
    if (V.sel?.type === 'file') map.select(V.sel.id, { zoom: true });
  }
  function toggleLens() {
    if (!map?.toggleLens) return;
    const on = map.toggleLens();
    $('#zlens').setAttribute('aria-pressed', String(on));
    $('#zlens').classList.toggle('on', on);
  }
  function setMode(m) {
    map?.setMode(m);
    store.set('overlook.mode', m);
    $$('[data-mode]').forEach((b) => b.classList.toggle('on', b.dataset.mode === m));
  }
  // Where the audited branch stands: its pull request merged, open or closed, or merged without one.
  function prStatus() {
    const pr = H.laneOf.get('head')?.pr, base = H.laneOf.get('base')?.name ?? baseRef;
    const landed = H.commits.filter((c) => c.landed);
    const when = pr?.mergedAt ?? landed.at(-1)?.date;
    const chip = pr
      ? `<a class="pr-state s-${pr.state}" href="${esc(pr.url ?? meta.prUrl ?? '#')}" target="_blank" rel="noopener" title="${esc(pr.title ?? '')}">${icon('pr')} PR #${pr.number} · ${pr.state === 'merged' ? `merged into <b>${esc(base)}</b>${when ? ` ${esc(timeAgo(when))}` : ''}` : pr.state === 'open' ? 'open, not merged yet' : 'closed without merging'}</a>`
      : landed.length ? `<span class="pr-state s-merged">${icon('check')} merged into <b>${esc(base)}</b>${when ? ` ${esc(timeAgo(when))}` : ''}</span>`
      : H.laneOf.get('head')?.direct ? `<span class="pr-state s-direct" title="No pull request: the commits went straight onto ${esc(base)}">${icon('commit')} committed straight to <b>${esc(base)}</b></span>`
      : `<span class="pr-state s-open" title="Not on ${esc(base)} yet">${icon('branch')} not merged into <b>${esc(base)}</b> yet</span>`;
    return `<span class="hb-right">${chip}</span>`;
  }
  // The history bar: a row of controls (play, step, what is on screen), then the branch picture under it.
  let histGraph = null;
  function renderJourney() {
    const box = $('#journey');
    histGraph?.destroy();
    box.className = 'journey rbar hgbar';
    box.innerHTML = `<div class="hb-ctl">
        <div class="step-caption" id="stepCaption"></div>
        ${prStatus()}
        <span class="hb-player"><button class="hb-speed" id="speed" type="button" title="Replay speed">${V.speed}×</button><span class="hb-play" id="playWrap"><svg class="hb-ring" viewBox="0 0 36 36" aria-hidden="true"><circle cx="18" cy="18" r="16.5"/></svg><button class="play" id="play" aria-label="Play the commits" title="Play: from the first commit, or on from the commit on screen (Space)">${timer ? '❚❚' : '▶'}</button></span></span>
      </div>
      <div class="rb-graph" id="hgBox"></div>`;
    histGraph = createHistoryGraph($('#hgBox'), city, {
      onStep: (i) => { stopPlay(); clearLook(true); if (V.lane) compareWith(null, { quiet: true }); if (V.sel) { V.sel = null; map?.select(null); renderTree(); } setProgress(i); },
      onLane: (lane) => openLane(lane),
      onLook: (sha) => lookAt(sha),
    });
    if (V.lane) histGraph.setLane(V.lane.id, V.lane.sha);
    if (V.look) histGraph.setLook(V.look);
    caption();
    markProgress();
    $('#play').onclick = togglePlay;
    $('#speed').onclick = () => {
      V.speed = V.speed === 1 ? 2 : V.speed === 2 ? 0.5 : 1;
      store.set('overlook.speed', V.speed);
      $('#speed').textContent = `${V.speed}×`;
      if (timer) { clearInterval(timer); timer = setInterval(playTick, stepMs()); ring(); }
    };
  }
  // ◀ ▶ and ← → walk the whole picture: the task's commits, and past its ends the base branch before and after it;
  // on a commit of another branch they walk along that branch.
  function nudge(d) {
    stopPlay();
    if (V.look) { const { prev, next } = lookInfo(V.look); const to = d < 0 ? prev : next; if (to) lookAt(to.sha); return; }
    if (V.lane) compareWith(null, { quiet: true });
    if (V.sel) { V.sel = null; map?.select(null); renderTree(); }
    const p = V.progress;
    if (d < 0 && p === 0) {
      const b = H.bySha.get(meta.base), list = b ? H.commits.filter((c) => c.lane === b.lane) : [];
      const before = list[list.indexOf(b) - 1];
      if (before) lookAt(before.sha);
      return;
    }
    if (d > 0 && p >= lastStep) {
      const hi = H.commits.findIndex((c) => c.sha === meta.head);
      const after = H.commits.slice(hi + 1).find((c) => c.lane === 'base' && c.step == null);
      if (after) lookAt(after.sha);
      return;
    }
    setProgress(Math.max(0, Math.min(lastStep, p + d)));
  }

  /** A branch clicked in the history bar: its first commit here (for the base branch, the first after base). */
  function openLane(id) {
    if (!id) { clearLook(); if (V.lane) compareWith(null); return; }
    const list = H.commits.filter((c) => c.lane === id && c.step == null && c.sha !== meta.base);
    const baseDate = H.bySha.get(meta.base)?.date ?? '';
    const first = id === 'base' ? list.find((c) => c.date > baseDate) ?? list.at(-1) : list[0];
    if (first) lookAt(first.sha);
  }
  // ---------------------------------------------------------------- reading any commit of the picture
  // A commit outside the task (on the base branch before or after it, or on another branch): what it changed
  // against the commit before it, file by file, and which of those files this task changed too.
  function lookInfo(sha) {
    const c = H.bySha.get(sha), lane = H.laneOf.get(c.lane);
    const mine = new Set(changed.map((f) => f.path));
    const files = (c.files ?? []).map((p, i) => ({ path: p, plus: c.lines?.[i]?.[0] ?? null, minus: c.lines?.[i]?.[1] ?? null, both: mine.has(p) && !c.landed }));
    const list = H.commits.filter((x) => x.lane === c.lane), i = list.indexOf(c);
    const t0 = H.bySha.get(meta.base)?.date ?? '', t1 = H.bySha.get(meta.head)?.date ?? '';
    const when = c.landed ? 'the task, merged' : c.date < t0 ? 'before this task' : c.date > t1 ? 'after this task' : 'while this task was open';
    return { c, lane, files, prev: list[i - 1], next: list[i + 1], when };
  }
  function lookAt(sha, { keepPlaying = false } = {}) {
    const c = H.bySha.get(sha);
    if (!c) return;
    if (c.sha === meta.base || c.step != null) { if (!keepPlaying) stopPlay(); clearLook(true); return setProgress(c.sha === meta.base ? 0 : c.step); }
    if (!keepPlaying) stopPlay();
    V.lane = null;
    V.look = sha;
    V.sel = null;
    map?.select(null);
    histGraph?.setLook(sha);
    lookFocus(true);
    renderKpis();
    if (!V.layout.inspector) togglePanel('inspector', true);
    renderInspector();
    renderTree();
    caption();
  }
  function clearLook(quiet = false) {
    if (!V.look) return;
    V.look = null;
    histGraph?.setLook(null);
    renderHud();
    renderKpis();
    if (!quiet) { renderInspector(); renderTree(); }
    caption();
  }
  function lookFocus(fly = false) {
    const { files } = lookInfo(V.look);
    const on = files.filter((f) => map?.has(f.path)).map((f) => f.path), both = files.filter((f) => f.both && map?.has(f.path)).map((f) => f.path);
    map?.setCommitFocus?.({ paths: on, aff: both, first: [], stats: Object.fromEntries(files.filter((f) => f.plus != null).map((f) => [f.path, { plus: f.plus, minus: f.minus }])), affLabel: 'also changed by this task' });
    if (fly && on.length) map?.focusPaths(both.length ? both : on);
  }
  function lookCard() {
    const { c, lane, files, prev, next, when } = lookInfo(V.look);
    const both = files.filter((f) => f.both);
    const [pl, mi] = files.reduce((a, f) => [a[0] + (f.plus ?? 0), a[1] + (f.minus ?? 0)], [0, 0]);
    const peek = (p) => (c.peek?.[p] ?? []).map(([k, t]) => `<div class="hud-ln ${k}"><span>${k === 'a' ? '+' : k === 'd' ? '−' : '·'}</span><code>${esc(t)}</code></div>`).join('');
    const row = (f) => { const cf = byPath.get(f.path), name = f.path.split('/').pop();
      return `<div class="look-f ${f.both ? 'both' : ''}"><${cf ? `button class="hud-fname" data-file="${esc(f.path)}"` : 'span class="hud-fname off"'} title="${esc(f.path)}"><span class="kdot ${cf ? `k-${kindOf(cf)}` : ''}"></span><span class="mono">${esc(name)}</span>${f.plus != null ? `<span class="mono small"><em class="p">+${f.plus}</em> <em class="m">−${f.minus}</em></span>` : ''}</${cf ? 'button' : 'span'}>
        <div class="hud-tr mono">${esc(f.path.split('/').slice(0, -1).join('/') || './')}${f.both ? ' · <b class="bad">also changed by this task</b>' : ''}</div>${peek(f.path)}</div>`; };
    const onWhat = lane?.kind === 'base' ? `on <code class="ref">${esc(lane.name)}</code>` : `on <code class="ref">${esc(lane?.name ?? '')}</code>${lane?.pr ? ` · PR #${lane.pr.number}` : ''}`;
    return `<div class="i-pad i-look">
      <div class="cmp-top"><p class="i-kicker">Commit ${onWhat} · ${esc(when)}</p><button class="linkbtn" data-look-close>✕ Back to the task</button></div>
      <h2 class="i-title">${c.pr ? `<span class="pr-mini">PR #${c.pr}</span> ` : ''}${esc(c.message.replace(/\s*\(#\d+\)\s*$/, ''))}</h2>
      <div class="hud-meta"><span class="mono muted">${short(c.sha)}</span><span class="muted">${esc(c.author || '')}</span><span class="muted">${esc(timeAgo(c.date))}</span>${files.length ? `<span class="mono"><em class="p">+${pl}</em> <em class="m">−${mi}</em></span>` : ''}</div>
      ${c.landed ? `<p class="cmp-landed">${icon('check')} This is the task itself, merged into <code class="ref">${esc(lane?.name ?? '')}</code>.</p>` : ''}
      <div class="hud-sec">Compared with the commit before it</div>
      <div class="cmp-verdict ${both.length ? 'bad' : 'ok'}">${icon(both.length ? 'alert' : 'check')}<span>${files.length ? `<b>${plural(files.length + (c.moreFiles ?? 0), 'file')} changed.</b> ${both.length ? `${plural(both.length, 'of them is', 'of them are')} also changed by this task: merging may conflict there.` : 'None of them is changed by this task.'}` : 'No file changes recorded for this commit.'}</span></div>
      <div class="look-files">${files.map(row).join('')}${c.moreFiles ? `<p class="i-note">+${c.moreFiles} more files</p>` : ''}</div>
      ${meta.example?.redacted ? '<p class="i-note">Code not shown: this repository has no licence to redistribute it.</p>' : ''}
      <div class="hud-nav"><button class="btn sm" ${prev ? `data-look-sha="${prev.sha}"` : 'disabled'}>◀ Earlier</button><button class="btn sm" ${next ? `data-look-sha="${next.sha}"` : 'disabled'}>Later ▶</button>${lane && lane.kind !== 'head' ? `<button class="btn sm" data-look-lane="${lane.id}">Compare this branch with the task</button>` : ''}</div>
    </div>`;
  }

  // ---------------------------------------------------------------- comparing another branch with the task
  // Click a branch (or one of its commits) in the history bar: what it changed while this task was open, and the
  // files both sides touched, which is where a merge can conflict.
  const H = historyModel(city);
  function laneView(id, sha = null) {
    const lane = H.laneOf.get(id);
    if (!lane) return null;
    const baseDate = H.bySha.get(meta.base)?.date ?? '';
    const after = H.commits.filter((c) => c.lane === id && c.step == null && (lane.kind !== 'base' || c.date > baseDate));
    const landed = after.filter((c) => c.landed); // the task itself reaching the branch: not someone else's work
    const list = after.filter((c) => !c.landed);
    const picked = sha ? H.bySha.get(sha) : null;
    const of = (cs) => [...new Set(cs.flatMap((c) => c.files ?? []))];
    const files = of(picked ? [picked] : list);
    const mine = new Set(changed.map((f) => f.path));
    const overlap = picked?.landed ? [] : files.filter((p) => mine.has(p));
    return { lane, list, landed, picked, files, overlap };
  }
  function compareWith(id, { sha = null, quiet = false } = {}) {
    if (!id) {
      if (!V.lane) return;
      V.lane = null;
      histGraph?.setLane(null);
      renderHud();
      renderKpis();
      if (!quiet) { renderInspector(); renderTree(); }
      caption();
      return;
    }
    stopPlay();
    if (V.lane?.id === id && V.lane.sha === sha && sha) sha = null; // a second click on the same commit shows the whole branch
    V.look = null;
    V.lane = { id, sha };
    V.sel = null;
    map?.select(null);
    histGraph?.setLane(id, sha);
    laneFocus(true);
    renderKpis();
    if (!V.layout.inspector) togglePanel('inspector', true);
    renderInspector();
    renderTree();
    caption();
  }
  function laneFocus(fly = false) {
    const v = laneView(V.lane.id, V.lane.sha);
    if (!v) return;
    const onMap = v.files.filter((p) => map?.has(p));
    const both = v.overlap.filter((p) => map?.has(p));
    map?.setCommitFocus?.({ paths: onMap, aff: both, first: [], stats: {}, affLabel: 'changed on both sides', countLabel: 'changed there' });
    if (fly && (both.length || onMap.length)) map?.focusPaths(both.length ? both : onMap);
  }
  function compareCard() {
    const v = laneView(V.lane.id, V.lane.sha);
    if (!v) return overview();
    const { lane, list, landed, picked, files, overlap } = v;
    const others = lane.kind === 'base' ? 'other commits' : 'commits';
    const who = lane.kind === 'base' ? `Since this task branched off, <code class="ref">${esc(lane.name)}</code> got ${plural(list.length, others.slice(0, -1))}` : `While this task was open, <code class="ref">${esc(lane.name)}</code> had ${plural(list.length, 'commit')}${lane.more ? ` (the newest ${list.length}; ${lane.more} older not shown)` : ''}`;
    const subject = picked ? (picked.landed ? `This is the task itself, merged into <code class="ref">${esc(lane.name)}</code>.` : `This commit touched ${plural(files.length, 'file')}.`) : list.length ? `${who}, touching ${plural(files.length, 'file')}.` : `Nobody else changed <code class="ref">${esc(lane.name)}</code> in this period.`;
    const landedLine = !picked && landed.length ? `<p class="cmp-landed">${icon('check')} This task reached <code class="ref">${esc(lane.name)}</code> in ${plural(landed.length, 'commit')} (${esc(timeAgo(landed.at(-1).date))}): ${landed.map((c) => `<button class="linkbtn mono" data-cmp-sha="${c.sha}">${short(c.sha)}</button>`).join(' ')}</p>` : '';
    const fileBtn = (p) => { const f = byPath.get(p); return f ? `<button class="cmp-f k-${kindOf(f)}" data-file="${esc(p)}" title="${esc(p)}"><span class="kdot k-${kindOf(f)}"></span><span class="mono">${esc(f.name)}</span><span class="muted small">this task: ${esc((KIND_LABEL[kindOf(f)] ?? '').toLowerCase())} · <em class="p">+${f.plus}</em> <em class="m">−${f.minus}</em></span></button>` : `<span class="cmp-f off mono" title="${esc(p)}">${esc(p.split('/').pop())}</span>`; };
    const shared = (c) => (c.files ?? []).filter((p) => overlapAll.has(p)).length;
    const overlapAll = new Set(laneView(V.lane.id).overlap);
    return `<div class="i-pad i-cmp">
      <div class="cmp-top"><p class="i-kicker">Compare branches</p><button class="linkbtn" data-cmp-close>✕ Stop comparing</button></div>
      <h2 class="i-title cmp-title"><code class="ref">${esc(lane.name)}</code><span class="muted">vs</span><code class="ref head">${esc(headRef)}</code></h2>
      ${lane.pr ? `<p class="cmp-pr"><a class="pr-state s-${lane.pr.state}" href="${esc(lane.pr.url ?? '#')}" target="_blank" rel="noopener">${icon('pr')} PR #${lane.pr.number} · ${esc(lane.pr.state)}</a> <span>${esc(lane.pr.title ?? '')}</span></p>` : ''}
      ${picked ? `<p class="cmp-pick"><span class="mono muted">${short(picked.sha)}</span> ${esc(picked.message)} <button class="linkbtn" data-cmp-all>whole branch</button></p>` : ''}
      <p class="cmp-sum">${subject}</p>
      ${landedLine}
      <div class="cmp-verdict ${overlap.length ? 'bad' : 'ok'}">${icon(overlap.length ? 'alert' : 'check')}<span>${overlap.length ? `<b>${plural(overlap.length, 'file')} changed on both sides.</b> Merging the two may conflict there.` : '<b>No file changed on both sides.</b> The two do not touch the same code.'}</span></div>
      ${overlap.length ? `<div class="cmp-files">${overlap.map(fileBtn).join('')}</div>` : ''}
      ${!picked && list.length ? `<div class="hud-sec">${esc(lane.name)}: commits</div>
        <ul class="cmp-commits">${list.slice().reverse().map((c) => `<li><button data-cmp-sha="${c.sha}"><span class="cmp-cm">${c.pr ? `<span class="pr-mini">PR #${c.pr}</span> ` : ''}${esc(c.message.replace(/\s*\(#\d+\)\s*$/, ''))}</span><span class="cmp-meta mono">${short(c.sha)} · ${esc(timeAgo(c.date))} · ${plural((c.files ?? []).length + (c.moreFiles ?? 0), 'file')}${shared(c) ? ` · <b class="bad">${shared(c)} shared</b>` : ''}</span></button></li>`).join('')}</ul>` : ''}
      ${picked && files.length ? `<div class="hud-sec">Files in this commit</div><div class="cmp-files">${files.map(fileBtn).join('')}</div>` : ''}
      <p class="i-note">On the map: this branch's files are lit, the shared ones ringed. Files outside the mapped folder are not on the map.</p>
    </div>`;
  }

  // ---------------------------------------------------------------- the commit on screen, compared with the one before
  const reachedAt = (f, p) => f.step != null && f.step > 0 && f.step <= p;
  function statsAt(p) {
    const ch = changed.filter((f) => reachedAt(f, p));
    return {
      out: ch.filter((f) => f.kind === 'out').length,
      inn: ch.filter((f) => f.kind === 'in').length,
      aff: affected.filter((f) => (f.causes || []).some((c) => { const cf = byPath.get(c); return cf && reachedAt(cf, p); })).length,
      files: ch.length,
    };
  }
  // The commit in focus, on the map: its files lit and what it newly reaches ringed. Its story is in the review panel.
  function commitFocus(p) {
    const c = commits[p - 1];
    const files = (c.files ?? []).map((q) => byPath.get(q)).filter(Boolean);
    const reachedBefore = (f) => (f.causes || []).some((q) => { const cf = byPath.get(q); return cf && reachedAt(cf, p - 1); });
    const reachesNow = (f) => (f.causes || []).some((q) => { const cf = byPath.get(q); return cf && reachedAt(cf, p); });
    const newlyAff = affected.filter((f) => reachesNow(f) && !reachedBefore(f));
    const stat = (f) => c.changes?.[f.path] ?? { plus: 0, minus: 0, diff: [] };
    return { c, files, newlyAff, stat };
  }
  function renderHud() {
    const p = V.progress;
    $('#hud')?.classList.add('hidden');
    map?.setInsets?.({ right: 0 });
    if (V.look) return lookFocus();
    if (V.lane) return laneFocus();
    if (p <= 0 || p >= lastStep) { map?.setCommitFocus?.(null); return; }
    if (mergeAt(p)) return mergeFocus(p);
    const { files, newlyAff, stat } = commitFocus(p);
    map?.setCommitFocus?.({ paths: files.map((f) => f.path), aff: newlyAff.map((f) => f.path), first: files.filter((f) => f.step === p).map((f) => f.path), stats: Object.fromEntries(files.map((f) => [f.path, { plus: stat(f).plus ?? 0, minus: stat(f).minus ?? 0 }])) });
  }
  // The review panel while the replay stands on a commit: what it did, compared with the commit before.
  // A merge in the task's branch (usually the base branch merged in to stay current) is not the agent's work: it
  // shows what it brought in against the commit before it, and which of those files the task changes too.
  const mergeAt = (p) => { const c = commits[p - 1]; return c && (c.merge || H.bySha.get(c.sha)?.parents?.length > 1) ? c : null; };
  function mergeFocus(p) {
    const { files } = lookInfo(mergeAt(p).sha);
    const on = files.filter((f) => map?.has(f.path)).map((f) => f.path), both = files.filter((f) => f.both && map?.has(f.path)).map((f) => f.path);
    map?.setCommitFocus?.({ paths: on, aff: both, first: [], stats: Object.fromEntries(files.filter((f) => f.plus != null).map((f) => [f.path, { plus: f.plus, minus: f.minus }])), affLabel: 'also changed by this task' });
  }
  function mergeCard(p) {
    const c = mergeAt(p), g = H.bySha.get(c.sha);
    const { files } = g ? lookInfo(c.sha) : { files: [] };
    const both = files.filter((f) => f.both), more = g?.moreFiles ?? 0;
    const [pl, mi] = files.reduce((a, f) => [a[0] + (f.plus ?? 0), a[1] + (f.minus ?? 0)], [0, 0]);
    const peek = (q) => (g?.peek?.[q] ?? []).map(([k, t]) => `<div class="hud-ln ${k}"><span>${k === 'a' ? '+' : k === 'd' ? '−' : '·'}</span><code>${esc(t)}</code></div>`).join('');
    const row = (f) => { const cf = byPath.get(f.path), name = f.path.split('/').pop();
      return `<div class="look-f ${f.both ? 'both' : ''}"><${cf ? `button class="hud-fname" data-file="${esc(f.path)}"` : 'span class="hud-fname off"'} title="${esc(f.path)}"><span class="kdot ${cf ? `k-${kindOf(cf)}` : ''}"></span><span class="mono">${esc(name)}</span>${f.plus != null ? `<span class="mono small"><em class="p">+${f.plus}</em> <em class="m">−${f.minus}</em></span>` : ''}</${cf ? 'button' : 'span'}>
        <div class="hud-tr mono">${esc(f.path.split('/').slice(0, -1).join('/') || './')}${f.both ? ' · <b class="bad">also changed by this task</b>' : ''}</div>${peek(f.path)}</div>`; };
    const n = files.length + more;
    return `<div class="i-pad i-cc merge">
      <p class="i-kicker">Commit ${p} of ${commits.length} · a merge</p>
      <h2 class="i-title">${esc(c.message)}</h2>
      <div class="hud-meta"><span class="label l-merge">brings in another branch</span>${n ? `<span class="mono"><em class="p">+${pl}</em> <em class="m">−${mi}</em></span>` : ''}<span class="mono muted">${short(c.sha)}</span></div>
      <div class="hud-sec">Compared with ${p === 1 ? 'the base' : `commit ${p - 1}`}</div>
      <div class="cmp-verdict ${both.length ? 'bad' : 'ok'}">${icon(both.length ? 'alert' : 'check')}<span>${n ? `<b>${plural(n, 'file')} came in with this merge.</b> Not the agent's work, so it is not judged against the request. ${both.length ? `${plural(both.length, 'of them is', 'of them are')} also changed by this task: check that both changes survived the merge.` : 'None of them is changed by this task.'}` : 'This merge brought in no file inside the mapped folder.'}</span></div>
      <div class="look-files">${files.map(row).join('')}${more ? `<p class="i-note">+${more} more files</p>` : ''}</div>
      <div class="hud-nav"><button class="btn sm" data-hud-step="${p - 1}">◀ ${p - 1 > 0 ? `Commit ${p - 1}` : 'Base'}</button><button class="btn sm" data-hud-play>${timer ? '❚❚ Pause' : '▶ Play'}</button><button class="btn sm" data-hud-step="${p + 1}">${p + 1 < lastStep ? `Commit ${p + 1}` : 'Head'} ▶</button></div>
    </div>`;
  }
  function commitCard(p) {
    if (mergeAt(p)) return mergeCard(p);
    const { c, files, newlyAff, stat } = commitFocus(p);
    const was = statsAt(p - 1), now = statsAt(p);
    const [pl, mi] = files.reduce((a, f) => [a[0] + (stat(f).plus || 0), a[1] + (stat(f).minus || 0)], [0, 0]);
    const row = (label, a, b, bad) => { const d = b - a; return `<tr class="${d ? (bad ? 'up-bad' : 'up') : ''}"><td>${label}</td><td class="mono">${a}</td><td>→</td><td class="mono"><b>${b}</b></td><td class="mono d">${d > 0 ? `+${d}` : d < 0 ? d : ''}</td></tr>`; };
    const beforeWord = (f) => (f.step < p ? (KIND_LABEL[kindOf(f)] ?? '').toLowerCase() : f.status === 'added' ? 'did not exist' : 'unchanged');
    const lines = (f) => (stat(f).diff ?? []).filter(([k]) => k === 'a' || k === 'd' || k === 'h').slice(0, 4)
      .map(([k, t]) => `<div class="hud-ln ${k}"><span>${k === 'a' ? '+' : k === 'd' ? '−' : '·'}</span><code>${esc(String(t).slice(0, 90))}</code></div>`).join('');
    const reach = (f) => {
      const to = newlyAff.filter((a) => (a.causes || []).includes(f.path));
      return to.length ? `<div class="hud-reach">↳ now reaches ${to.map((t) => `<button class="tl-to k-affected" data-file="${esc(t.path)}" title="${esc(`${t.path} · ${t.uses?.[f.path] ?? 'imports it'}`)}">${esc(t.name)}</button>`).join('')}<span class="hud-why">they import it${importedNames(to[0].uses?.[f.path]).length ? ` (${esc(importedNames(to[0].uses?.[f.path]).slice(0, 2).join(', '))})` : ''}</span></div>` : '';
    };
    return `<div class="i-pad i-cc ${c.outside ? 'out' : ''}">
      <p class="i-kicker">Commit ${p} of ${commits.length}</p>
      <h2 class="i-title">${esc(c.message)}</h2>
      <div class="hud-meta">${c.outside ? '<span class="label l-bad">leaves the requested area</span>' : '<span class="label l-in">inside the request</span>'}<span class="mono"><em class="p">+${pl}</em> <em class="m">−${mi}</em></span><span class="mono muted">${short(c.sha)}</span>${c.author ? `<span class="muted">${esc(c.author)}</span>` : ''}</div>
      <div class="hud-sec">Compared with ${p === 1 ? 'the base' : `commit ${p - 1}`}</div>
      <table class="hud-delta">${row('Outside the request', was.out, now.out, true)}${row('Inside the request', was.inn, now.inn)}${row('May be affected', was.aff, now.aff, true)}${row('Files changed so far', was.files, now.files)}</table>
      <div class="hud-sec">In this commit</div>
      ${files.map((f) => `<div class="hud-file"><button class="hud-fname k-${kindOf(f)}" data-file="${esc(f.path)}" data-in-commit="${p}" title="${esc(f.path)}"><span class="kdot k-${kindOf(f)}"></span><span class="mono">${esc(f.name)}</span><span class="mono small"><em class="p">+${stat(f).plus ?? 0}</em> <em class="m">−${stat(f).minus ?? 0}</em></span></button>
        <div class="hud-tr">${esc(beforeWord(f))} <span>→</span> <b class="k-${kindOf(f)}">${esc((KIND_LABEL[kindOf(f)] ?? '').toLowerCase())}</b>${f.step < p ? ' · edited again' : ''}</div>${lines(f)}${reach(f)}</div>`).join('') || '<p class="muted small">No files in this commit (a plan or a merge).</p>'}
      <div class="hud-nav"><button class="btn sm" data-hud-step="${p - 1}">◀ ${p - 1 > 0 ? `Commit ${p - 1}` : 'Base'}</button><button class="btn sm" data-hud-play>${timer ? '❚❚ Pause' : '▶ Play'}</button><button class="btn sm" data-hud-step="${p + 1}">${p + 1 < lastStep ? `Commit ${p + 1}` : 'Verdict'} ▶</button></div>
    </div>`;
  }
  function markProgress() {
    const p = V.progress;
    histGraph?.setProgress(p);
  }
  function caption() {
    if (V.look) {
      const { c, lane, files, when } = lookInfo(V.look);
      const both = files.filter((f) => f.both).length;
      $('#stepCaption').innerHTML = `<b>${esc(lane?.name ?? '')}</b> <span class="mono muted">${short(c.sha)}</span> ${esc(c.message)} <span class="label ${both ? 'l-bad' : 'l-in'}">${esc(when)}</span> <button class="linkbtn" data-look-close>Back to the task</button>`;
      $('#stepCaption [data-look-close]').onclick = () => clearLook();
      return;
    }
    if (V.lane) {
      const v = laneView(V.lane.id, V.lane.sha);
      $('#stepCaption').innerHTML = `<b>Comparing</b> <code class="ref">${esc(v?.lane.name ?? '')}</code> <span class="muted">with this task ·</span> ${v?.overlap.length ? `<span class="label l-bad">${plural(v.overlap.length, 'file')} on both sides</span>` : '<span class="label l-in">no shared files</span>'} <button class="linkbtn" data-cmp-close>Stop comparing</button>`;
      $('#stepCaption [data-cmp-close]').onclick = () => compareWith(null);
      return;
    }
    const i = V.progress, s = city.steps[i];
    const soFar = commits.slice(0, Math.max(0, Math.min(i, commits.length))).filter((c) => c.outside).length;
    $('#stepCaption').innerHTML = i === 0 ? `<b>Base</b> <span class="muted">before the task · ${short(meta.base)}</span>`
      : i === lastStep ? `<b>Head</b> <span class="muted">${short(meta.head)} · ${soFar} of ${commits.length} commits outside the request</span>`
      : `<b>Commit ${i}/${commits.length}</b> ${esc(s.message)} ${mergeAt(i) ? '<span class="label l-merge">merge · brings in another branch</span>' : s.outside ? '<span class="label l-bad">leaves requested area</span>' : '<span class="label l-in">inside</span>'} <span class="muted">· ${soFar} of ${i} so far outside</span>`;
  }
  function setProgress(p, opts = {}) {
    V.progress = p;
    renderHud(); // before the map moves, so the camera frames the space left of the card
    map?.setProgress(p, opts);
    if (map && p < lastStep && map.mode === 'before') setMode('after');
    markProgress();
    caption();
    renderKpis();
    renderTree(); // the tree follows the replay: this commit's files lit, later ones dimmed
    if (!V.sel || V.sel.type === 'commit') { if (V.sel?.type === 'commit') V.sel = null; renderInspector(); }
  }
  let timer = null;
  function play(from = 0) {
    clearLook(true);
    if (V.lane) compareWith(null, { quiet: true });
    if (map?.mode === 'before') setMode('after');
    V.hudClosed = null;
    setProgress(from >= lastStep ? 0 : from);
    $('#play').textContent = '❚❚';
    timer = setInterval(playTick, stepMs());
    ring();
  }
  const stepMs = () => 3200 / V.speed;
  function togglePlay() {
    if (timer) return stopPlay();
    if (V.look) { // walk along that branch, commit by commit
      if (!lookInfo(V.look).next) { const l = H.bySha.get(V.look).lane; openLane(l); }
      $('#play').textContent = '❚❚';
      timer = setInterval(() => { const n = V.look && lookInfo(V.look).next; if (!n) return stopPlay(); lookAt(n.sha, { keepPlaying: true }); ring(); }, stepMs());
      ring();
      return;
    }
    play(V.progress <= 0 || V.progress >= lastStep - 1 ? 0 : V.progress);
  }
  function playTick() {
    if (V.progress >= lastStep) return stopPlay();
    setProgress(V.progress + 1, { play: V.progress + 1 < lastStep });
    ring();
  }
  // the ring around ▶ fills up until the next commit
  function ring() {
    const w = $('#playWrap');
    if (!w) return;
    w.style.setProperty('--step', `${stepMs()}ms`);
    w.classList.remove('run');
    void w.offsetWidth;
    if (timer) w.classList.add('run');
  }
  function stopPlay() { const was = !!timer; clearInterval(timer); timer = null; const b = $('#play'); if (b) b.textContent = '▶'; $('#playWrap')?.classList.remove('run'); if (was) { map?.playEnd?.(); renderHud(); } }

  // ---------------------------------------------------------------- selection, decisions
  function select(s, { zoom = true } = {}) {
    V.sel = s;
    if (s && !V.layout.inspector) togglePanel('inspector', true);
    if (s?.type === 'file') {
      map?.select(map.has(s.id) ? s.id : null, { zoom: zoom && map.has(s.id) });
    } else {
      map?.select(null);
      if (s?.type === 'commit') {
        setProgress(s.id);
        const files = commits[s.id - 1]?.files ?? [];
        if (zoom) map?.focusPaths(files);
      }
    }
    renderTree();
    renderInspector();
  }
  function decide(file, value) {
    const prev = V.decisions[file] || null;
    const next = prev === value ? null : value;
    if (next) V.decisions[file] = next; else delete V.decisions[file];
    persist();
    map?.setDecisions({ ...V.decisions });
    renderState();
    if (next && pending().length) select({ type: 'file', id: nextPending(file) });
    else { renderTree(); renderInspector(); }
    const name = file.split('/').pop();
    toast(next === 'approve' ? `Approved ${name}` : next === 'revert' ? `${name} will be reverted` : `Cleared the decision on ${name}`, () => {
      if (prev) V.decisions[file] = prev; else delete V.decisions[file];
      persist(); map?.setDecisions({ ...V.decisions }); renderState(); select({ type: 'file', id: file });
    });
  }
  function nextPending(from) {
    const list = city.items;
    const start = Math.max(0, list.findIndex((it) => it.file === from));
    for (let k = 1; k <= list.length; k++) {
      const it = list[(start + k) % list.length];
      if (!V.decisions[it.file]) return it.file;
    }
    return list[(start + 1) % list.length].file;
  }
  function move(dir) {
    const list = city.items;
    if (!list.length) return;
    const cur = V.sel?.type === 'file' ? list.findIndex((it) => it.file === V.sel.id) : -1;
    const i = cur < 0 ? (dir > 0 ? 0 : list.length - 1) : (cur + dir + list.length) % list.length;
    select({ type: 'file', id: list[i].file });
  }
  function renderState() {
    if ($('#journey')?.childElementCount) renderJourney();
    renderKpis();
    const n = pending().length;
    const pill = $('#statePill');
    pill.className = `state-pill ${n ? 'open' : 'ready'}`;
    pill.innerHTML = `${icon('pr')} ${n ? `${n} to decide` : 'Ready'}`;
  }

  // ---------------------------------------------------------------- fence, runs, export
  // Edit the requested area on the map itself: click blocks (city) or platforms (tree) in or out; every verdict is
  // recomputed as you go. The dialog stays available for typed paths.
  let editing = null;
  function editOnMap() {
    if (!map?.editFence) return openFenceEditor();
    if (editing) return;
    let paths = [...fencePaths];
    const bar = $('#editbar');
    const render = () => {
      const preview = withFence(city, paths);
      map.preview(preview);
      bar.innerHTML = `<div class="eb-text"><b>Requested area</b> <span class="muted">Click folders on the map to add or remove them.</span>
          <span class="eb-nums">Outside <b>${city.totals.outside} → <span class="${preview.totals.outside ? 'bad' : 'ok'}">${preview.totals.outside}</span></b> · May be affected <b>${city.totals.affected} → ${preview.totals.affected}</b> · Claims that hold <b>${city.totals.claimsTrue} → ${preview.totals.claimsTrue}</b></span>
          <span class="eb-paths">${paths.map((p) => `<code class="ref fence">${esc(p)}</code>`).join(' ') || '<span class="muted">Nothing yet: every change counts as outside.</span>'}</span></div>
        <div class="eb-actions"><button class="btn sm" data-eb="more">Pick folders…</button><button class="btn sm" data-eb="cancel">Cancel</button><button class="btn sm primary" data-eb="save">Confirm area</button></div>`;
      $$('[data-eb]', bar).forEach((b) => (b.onclick = () => {
        const a = b.dataset.eb;
        stopEdit();
        if (a === 'save') saveFence(paths);
        else if (a === 'more') openFenceEditor();
      }));
    };
    map.editFence(paths, (next) => { paths = next; render(); });
    editing = true;
    bar.classList.remove('hidden');
    render();
  }
  function stopEdit() {
    if (!editing) return;
    editing = null;
    $('#editbar')?.classList.add('hidden');
    map?.endEditFence?.();
    map?.preview?.(city);
  }
  function openFenceEditor() {
    const dlg = $('#fenceDialog');
    const dirs = new Map();
    for (const f of city.files) {
      const parts = f.path.split('/').slice(0, -1);
      for (let i = 1; i <= Math.min(parts.length, 3); i++) {
        const d = parts.slice(0, i).join('/') + '/';
        const e = dirs.get(d) ?? { files: 0, changed: 0, depth: i - 1 };
        e.files++;
        if (f.status !== 'unchanged') e.changed++;
        dirs.set(d, e);
      }
    }
    const selected = new Set(fencePaths.filter((p) => dirs.has(p)));
    const current = () => [...selected, ...$('#fenceExtra').value.split(',').map((x) => x.trim()).filter(Boolean)];
    const draw = () => {
      const preview = withFence(city, current());
      $('#fencePreview').innerHTML = `Outside request <b>${city.totals.outside} → <span class="${preview.totals.outside ? 'bad' : 'ok'}">${preview.totals.outside}</span></b> · May be affected <b>${city.totals.affected} → ${preview.totals.affected}</b> · Claims that hold <b>${city.totals.claimsTrue} → ${preview.totals.claimsTrue}</b>`;
      map?.hover(city.files.filter((f) => current().some((p) => f.path === p || f.path.startsWith(p))).map((f) => f.path));
    };
    $('#fenceList').innerHTML = [...dirs].sort((a, b) => (a[0] < b[0] ? -1 : 1)).map(([d, e]) =>
      `<label class="fence-row" style="--d:${e.depth}"><input type="checkbox" value="${esc(d)}" ${selected.has(d) ? 'checked' : ''}/> <span class="mono">${esc(d)}</span>
        <span class="muted small">${e.files} files${e.changed ? ` · <b class="warn">${e.changed} changed</b>` : ''}</span></label>`).join('');
    $('#fenceExtra').value = fencePaths.filter((p) => !dirs.has(p)).join(', ');
    $('#fenceRationale').textContent = text(city.fence?.rationale) || 'No rationale given.';
    $$('#fenceList input').forEach((i) => (i.onchange = () => { i.checked ? selected.add(i.value) : selected.delete(i.value); draw(); }));
    $('#fenceExtra').oninput = draw;
    draw();
    const close = () => { map?.hover([]); dlg.close(); };
    $('#fenceCancel').onclick = close;
    $('#fenceSave').onclick = async () => { const paths = current(); close(); await saveFence(paths); };
    dlg.showModal();
  }
  async function saveFence(paths) {
    try {
      let next;
      if (id && hasApi) { ({ city: next } = await api(`/api/audits/${id}/fence`, { paths, city })); auditCache.set(id, next); }
      else {
        store.set(`overlook.fence.${meta.head}`, { paths });
        next = withFence(city, paths);
        next.meta.fenceSetBy = 'reviewer';
      }
      reopen(next, { sel: null });
      toast('Requested area confirmed. Every verdict was recomputed from git.');
    } catch (e) { toast(e.message); }
  }
  async function run(kind) {
    if (!canRun || V.running) return;
    V.running = kind;
    map?.scan?.();
    renderInspector();
    try {
      const { city: next, run: r } = await api(`/api/audits/${id}/verify`, { kind, ...(kind === 'reverts' ? { decisions: V.decisions } : {}) });
      const ok = Array.isArray(r) ? r.every((x) => x.passed) : r.passed;
      toast(r.skipped ? r.reason : `${kind === 'cross' ? 'Original tests' : kind === 'reverts' ? 'Tests after your reverts' : 'Checks'} ${ok ? 'passed' : 'failed'}.`);
      reopen(next, { sel: V.sel });
    } catch (e) {
      V.running = null;
      toast(e.message);
      renderInspector();
    }
  }
  function openExport() {
    const json = JSON.stringify({ base: meta.base, head: meta.head, decisions: { ...V.decisions } }, null, 2);
    $('#exJson').textContent = json;
    $('#exCmd').textContent = `node engine/apply-decisions.mjs --repo ${meta.source?.path || `<path to ${meta.repo || 'the repository'}>`} --decisions out/decisions.json`;
    $('#exCopy').onclick = async () => { try { await navigator.clipboard.writeText(json); toast('Decisions copied'); } catch { /* blocked */ } };
    $('#exClose').onclick = () => $('#exportDialog').close();
    $('#exportDialog').showModal();
  }

  // ---------------------------------------------------------------- wiring
  function wire(scope) {
    $$('[data-file]', scope).forEach((b) => (b.onclick = (e) => { e.stopPropagation(); select({ type: 'file', id: b.dataset.file, commit: b.dataset.inCommit ? Number(b.dataset.inCommit) : V.sel?.type === 'commit' ? V.sel.id : undefined }); }));
    $$('[data-commit]', scope).forEach((b) => (b.onclick = (e) => { e.stopPropagation(); const n = Number(b.dataset.commit); if (!isSel('commit', n)) select({ type: 'commit', id: n }); }));
    $$('[data-claim]', scope).forEach((b) => (b.onclick = (e) => { e.stopPropagation(); select({ type: 'claim', id: Number(b.dataset.claim) }); }));
    $$('[data-dir]', scope).forEach((b) => (b.onclick = () => {
      const d = b.dataset.dir, open = b.querySelector('.t-caret').classList.contains('open');
      V.open.delete(d); V.open.delete('-' + d);
      V.open.add(open ? '-' + d : d);
      store.set(`overlook.open.${meta.head}`, [...V.open]);
      renderTree();
      map?.focusPaths(city.files.filter((f) => f.path.startsWith(d)).map((f) => f.path));
    }));
    $$('[data-group]', scope).forEach((b) => (b.onclick = () => { const k = '-g:' + b.dataset.group; V.open.has(k) ? V.open.delete(k) : V.open.add(k); renderTree(); }));
    $$('[data-step]', scope).forEach((b) => (b.onclick = (e) => { e.stopPropagation(); setProgress(Number(b.dataset.step)); }));
    $$('[data-d]', scope).forEach((b) => (b.onclick = () => decide(b.dataset.f, b.dataset.d)));
    $$('[data-next]', scope).forEach((b) => (b.onclick = () => move(1)));
    $$('[data-full]', scope).forEach((b) => (b.onclick = () => select({ type: 'file', id: V.sel.id }, { zoom: false })));
    $$('[data-overview]', scope).forEach((b) => (b.onclick = () => select(null)));
    $$('[data-start]', scope).forEach((b) => (b.onclick = () => select({ type: 'file', id: pending()[0].file })));
    $$('[data-quiet]', scope).forEach((b) => (b.onclick = () => { V.showQuiet = !V.showQuiet; renderTree(); }));
    $$('[data-edit-fence]', scope).forEach((b) => (b.onclick = editOnMap));
    $$('[data-confirm-fence]', scope).forEach((b) => (b.onclick = () => saveFence(fencePaths)));
    $$('[data-run]', scope).forEach((b) => (b.onclick = () => run(b.dataset.run)));
    $$('[data-export]', scope).forEach((b) => (b.onclick = openExport));
    $$('[data-pr]', scope).forEach((b) => (b.onclick = async () => {
      try {
        const { markdown } = await api(`/api/audits/${id}/receipt`, { decisions: V.decisions, city });
        await navigator.clipboard.writeText(markdown);
        toast('PR comment copied. Paste it on the pull request.');
      } catch (e) { toast(e.message); }
    }));
  }

  const onKey = (e) => {
    if (e.metaKey || e.ctrlKey || e.altKey || e.target.closest?.('input, textarea, select') || document.querySelector('dialog[open]')) return;
    const k = e.key.toLowerCase();
    const f = V.sel?.type === 'file' ? byPath.get(V.sel.id) : null;
    const it = f ? itemFor(f) : null;
    if (k === 'j') move(1);
    else if (k === 'k') move(-1);
    else if (k === 'a' && it) decide(it.file, 'approve');
    else if (k === 'r' && it) decide(it.file, 'revert');
    else if (k === 'escape') { if (editing) stopEdit(); else if (V.look && !V.sel) clearLook(); else if (V.lane && !V.sel) compareWith(null); else select(null); }
    else if (k === 'arrowleft' || k === 'arrowright') nudge(k === 'arrowleft' ? -1 : 1);
    else if (k === ' ' && !e.target.closest?.('button, a, [role="button"], summary')) togglePlay();
    else if (k === 'q' || k === 'e') map?.rotate?.(k === 'q' ? -1 : 1);
    else if (k === 'l') toggleLens();
    else if (k === 'f') { if (editing) stopEdit(); else editOnMap(); }
    else if (e.shiftKey && /^Digit[123]$/.test(e.code)) togglePanel(['files', 'inspector', 'history'][Number(e.code.slice(5)) - 1]);

    else return;
    e.preventDefault();
  };
  document.addEventListener('keydown', onKey);

  applyLayout();
  renderState();
  mountMap();
  renderJourney();
  renderTree();
  renderInspector();
  // Deep links: ?look=<sha> opens a commit of the picture, ?lane=<id> compares a branch, ?file=<path> selects a file.
  if (look) { const c = H.commits.find((x) => x.sha.startsWith(look)); if (c) lookAt(c.sha); }
  else if (lane && H.laneOf.has(lane)) compareWith(lane);
  else if (file && byPath.has(file)) select({ type: 'file', id: file });
  return () => { document.removeEventListener('keydown', onKey); stopPlay(); histGraph?.destroy(); map?.destroy(); };
}
