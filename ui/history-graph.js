// history-graph.js — the branch picture under the map: the base branch, the audited branch and a few branches
// that were active at the same time, with the audited range (base..head) marked and the replay's playhead on it.
//
//   const g = createHistoryGraph(el, city, { onStep, onLane })
//     onStep(progress)       a commit of the audited range was clicked (0 base, 1..n commits)
//     onLane(laneId, sha?)   another branch (or one of its commits) was clicked: compare it with the task;
//                            null when the audited branch itself was clicked
//   g.setProgress(p)         p as in the workspace: 0 base, 1..n commits, n + 1 head
//   g.setLane(laneId, sha?)  light one branch (and one of its commits), dim the rest; null clears
//   g.destroy()
//
// Commits are placed left to right, a parent always before its children, otherwise by date; lanes are rows.

const NS = 'http://www.w3.org/2000/svg';
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const short = (sha) => String(sha ?? '').slice(0, 7);
/** How a branch is named in the picture: its pull request when there is one. */
const day = (iso) => { const d = new Date(iso); return Number.isNaN(+d) ? '' : d.toLocaleDateString('en', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }); };

/** A graph from the steps alone, for audits collected before the collector drew one. */
function fallbackGraph(city) {
  const commits = [{ sha: city.meta.base, lane: 'base', parents: [], date: city.meta.generatedAt, message: 'Base', author: '' }];
  let prev = city.meta.base;
  city.steps.slice(1, -1).forEach((s, i) => {
    commits.push({ sha: s.sha, lane: 'head', parents: [prev], date: s.date ?? '', message: s.message, author: s.author ?? '', step: i + 1 });
    prev = s.sha;
  });
  return { lanes: [{ id: 'base', name: city.meta.refs?.base ?? 'base', kind: 'base' }, { id: 'head', name: city.meta.refs?.head ?? 'audited branch', kind: 'head' }], commits };
}

/** The graph as the UI uses it: at most three other branches, commits in drawing order. */
export function historyModel(city) {
  const G = { ...(city.graph?.commits?.length ? city.graph : fallbackGraph(city)) };
  const others = G.lanes.filter((l) => l.kind === 'other').slice(0, 3);
  const shown = new Set(['base', 'head', ...others.map((l) => l.id)]);
  const commits = G.commits.filter((c) => shown.has(c.lane));
  const lanes = [...others, G.lanes.find((l) => l.id === 'base'), G.lanes.find((l) => l.id === 'head')].filter(Boolean);
  // a parent always before its children, otherwise by date (commit dates can run backwards)
  const shas = new Set(commits.map((c) => c.sha)), placed = new Set(), order = [];
  const rest = commits.slice().sort((a, b) => String(a.date).localeCompare(String(b.date)));
  while (rest.length) {
    const i = Math.max(0, rest.findIndex((c) => c.parents.every((p) => !shas.has(p) || placed.has(p))));
    const [c] = rest.splice(i, 1);
    placed.add(c.sha); order.push(c);
  }
  return { lanes, commits: order, bySha: new Map(order.map((c) => [c.sha, c])), laneOf: new Map(lanes.map((l) => [l.id, l])) };
}

export function createHistoryGraph(el, city, { onStep = () => {}, onLane = () => {}, onLook = () => {} } = {}) {
  const M = historyModel(city);
  const { lanes: order, commits: inOrder, bySha } = M;
  const n = city.steps.length - 2;
  const outsideStep = new Set(city.steps.map((s, i) => (s.outside ? i : -1)).filter((i) => i > 0));
  const hasOthers = order.some((l) => l.kind === 'other');
  const ROW = { other: 20, base: 32, head: 36 };
  const TOP = hasOthers ? 4 : 18, GAP = hasOthers ? 16 : 0, BOTTOM = 18;
  const rowY = new Map(), rowTop = new Map();
  let y = TOP;
  for (const l of order) { if (l.kind === 'base') y += GAP; rowTop.set(l.id, y); rowY.set(l.id, y + ROW[l.kind] / 2); y += ROW[l.kind]; }
  const H = y + BOTTOM;
  const baseC = bySha.get(city.meta.base);
  const laneKind = (id) => M.laneOf.get(id)?.kind ?? 'other';
  const inRange = (c) => c.step != null || c.sha === city.meta.base;
  let W = 0, svg = null, progress = 0, X = null, lane = null, laneSha = null, look = null;

  el.classList.add('hg-host');
  const tip = document.createElement('div');
  tip.className = 'hg-tip';
  tip.hidden = true;

  // The picture is wider than the bar when there is history around the task: it scrolls sideways (drag, wheel,
  // the ‹ › buttons), the branch names stay pinned on the left, and it opens centred on the task.
  const UNIT = 22, RANGE_WEIGHT = 2.6;
  let scroller = null, first = true, dragged = false;
  function draw() {
    W = el.clientWidth;
    if (W < 40) return;
    const GUT = Math.min(170, Math.max(110, W * 0.18)), PADL = 26, PADR = 40;
    const weight = (c) => (inRange(c) ? RANGE_WEIGHT : 1);
    const gaps = inOrder.slice(1).map((c, i) => (weight(c) + weight(inOrder[i])) / 2);
    const units = gaps.reduce((a, b) => a + b, 0);
    const need = GUT + PADL + units * UNIT + PADR, CW = Math.max(W, need);
    let x = GUT + PADL + (need < W ? (W - need) / 2 : 0);
    X = new Map(inOrder.map((c, i) => [c.sha, (x += i ? gaps[i - 1] * UNIT : 0)]));
    const pos = (c) => [X.get(c.sha), rowY.get(c.lane) ?? rowY.get('base')];
    const parts = [], names = [];

    // rows you can click: the audited branch goes back to the replay, any other branch opens the comparison
    for (const l of order) parts.push(`<rect class="hg-row k-${l.kind}" data-row="${l.id}" x="0" y="${rowTop.get(l.id)}" width="${CW}" height="${ROW[l.kind]}" rx="6"/>`);
    // the audited range: a band from its first to its last commit over the two main rows
    const ranged = inOrder.filter(inRange).map((c) => X.get(c.sha));
    if (ranged.length) {
      const a = Math.min(...ranged) - 14, b = Math.max(...ranged) + 14;
      const top = rowTop.get('base') + 1, bot = rowTop.get('head') + ROW.head - 1;
      parts.push(`<rect class="hg-range" x="${a}" y="${top}" width="${Math.max(24, b - a)}" height="${bot - top}" rx="9"/>`);
      const headPr = M.laneOf.get('head')?.pr;
      parts.push(`<text class="hg-range-t" x="${a + 8}" y="${top - 4}">${headPr ? `PR #${headPr.number}` : 'This task'} · ${n} commit${n === 1 ? '' : 's'}</text>`);
      band = [a, b];
    }
    // lane lines; names go in the pinned column
    for (const l of order) {
      const ly = rowY.get(l.id), mine = inOrder.filter((c) => c.lane === l.id);
      if (!mine.length) continue;
      const from = l.kind === 'base' ? 0 : X.get(mine[0].sha), to = l.kind === 'base' ? CW : X.get(mine.at(-1).sha);
      parts.push(`<line class="hg-lane k-${l.kind}" data-l="${l.id}" x1="${from}" y1="${ly}" x2="${to}" y2="${ly}"/>`);
      const state = l.pr?.state ?? (l.merged ? 'merged' : '');
      const label = l.pr ? `#${l.pr.number} ${l.name}` : l.name;
      names.push(`<button class="hg-nm k-${l.kind}" data-l="${l.id}" data-name-lane="${l.id}" style="top:${ly - 10}px" title="${esc(`${l.name}${l.pr ? ` · PR #${l.pr.number} ${l.pr.state}` : ''}${l.kind === 'head' ? '' : ' · click to compare'}`)}">${l.kind !== 'base' && state ? `<i class="hg-dot s-${state}"></i>` : ''}<span>${esc(label)}</span></button>`);
      if (l.more) parts.push(`<text class="hg-more" data-l="${l.id}" x="${X.get(mine[0].sha) - 10}" y="${ly + 3.5}" text-anchor="end">+${l.more}</text>`);
    }
    // edges: parent → child; across lanes as a curve (a fork or a merge)
    for (const c of inOrder) {
      const [cx, cy] = pos(c);
      c.parents.forEach((p, k) => {
        const pc = bySha.get(p);
        if (!pc) {
          if (k === 0 && c.lane !== 'base') { // history goes on off the picture: a short fork from the base branch
            const by = rowY.get('base'), bx = cx - 18;
            parts.push(`<path class="hg-edge k-${laneKind(c.lane)} stub" data-l="${c.lane}" d="M${bx},${by} C${bx + 10},${by} ${cx - 10},${cy} ${cx},${cy}"/>`);
          }
          return;
        }
        const [px, py] = pos(pc);
        const l = c.lane === pc.lane ? c.lane : k === 0 ? c.lane : pc.lane;
        const d = py === cy ? `M${px},${py} L${cx},${cy}` : `M${px},${py} C${px + (cx - px) * 0.55},${py} ${cx - (cx - px) * 0.55},${cy} ${cx},${cy}`;
        parts.push(`<path class="hg-edge k-${laneKind(l)}${k > 0 ? ' merge' : ''}" data-l="${l}" d="${d}"/>`);
      });
    }
    // commits
    for (const c of inOrder) {
      const [cx, cy] = pos(c), kind = laneKind(c.lane);
      const isBase = c.sha === city.meta.base, isHead = c.sha === city.meta.head;
      const step = isBase ? 0 : c.step;
      const r = kind === 'head' ? 8 : kind === 'base' ? (step != null ? 6 : 4.5) : 4;
      const cls = ['hg-c', `k-${kind}`, step != null ? 'step' : 'ctx', outsideStep.has(step) ? 'out' : '', step > 0 && c.parents?.length > 1 ? 'merge' : '', c.landed ? 'landed' : '', c.pr && kind === 'base' ? 'pr' : ''].filter(Boolean).join(' ');
      parts.push(`<g class="${cls}" data-sha="${c.sha}" data-l="${c.lane}" ${step != null ? `data-step="${step}"` : ''} tabindex="0" role="button" aria-label="${esc(`${short(c.sha)} ${c.message}`)}" transform="translate(${cx},${cy})"><circle r="${r + 7}" class="hit"/><circle r="${r}" class="dot"/>${kind === 'head' && step ? `<text class="n" y="3.5">${step}</text>` : ''}</g>`);
      if (isBase || isHead) parts.push(`<text class="hg-tag" x="${cx}" y="${cy + (isHead ? 23 : -11)}" text-anchor="middle">${isBase ? 'base' : 'head'}</text>`);
    }
    // where the task reached the base branch (a merge, a squash or a rebase): a dashed line from head
    const landed = inOrder.filter((c) => c.landed), headC = bySha.get(city.meta.head);
    if (landed.length && headC) {
      const [hx, hy] = pos(headC), [lx, ly] = pos(landed.at(-1));
      parts.push(`<path class="hg-land" d="M${hx},${hy} C${hx + (lx - hx) * 0.5},${hy} ${lx - (lx - hx) * 0.5},${ly} ${lx},${ly}"/>`);
      const hp = M.laneOf.get('head')?.pr;
      parts.push(`<text class="hg-land-t" x="${lx}" y="${ly - 11}" text-anchor="middle">${hp ? `PR #${hp.number} merged` : 'merged'}</text>`);
    }
    parts.push(`<line class="hg-play" id="hgPlay" x1="0" x2="0" y1="4" y2="${H - 4}"/>`);

    const keep = scroller && !first && userMoved ? scroller.scrollLeft : null;
    el.style.setProperty('--hg-gut', `${GUT}px`);
    el.innerHTML = `<div class="hg-scroll"><svg class="hg" xmlns="${NS}" width="${CW}" height="${H}" viewBox="0 0 ${CW} ${H}" role="group" aria-label="Branch history around the audited range">${parts.join('')}</svg></div>
      <div class="hg-names" style="width:${GUT}px;height:${H}px">${names.join('')}</div>
      <button class="hg-nav prev" type="button" aria-label="Earlier commits" title="Earlier commits">‹</button><button class="hg-nav next" type="button" aria-label="Later commits" title="Later commits">›</button>`;
    el.append(tip);
    scroller = el.querySelector('.hg-scroll');
    svg = scroller.firstElementChild;
    gutter = GUT;
    // Centre the task; when it is wider than the view, start at its first commit.
    const room = W - GUT;
    scroller.scrollLeft = keep ?? Math.max(0, band[1] - band[0] > room - 40 ? band[0] - GUT - 16 : (band[0] + band[1]) / 2 - (W + GUT) / 2);
    first = false;
    wire();
    paint();
    nav();
  }
  let band = [0, 0], gutter = 0, userMoved = false; // userMoved: scrolled by hand, so a redraw keeps the position

  function nav() {
    if (!scroller) return;
    const max = scroller.scrollWidth - scroller.clientWidth;
    el.querySelector('.hg-nav.prev').hidden = scroller.scrollLeft <= 2;
    el.querySelector('.hg-nav.next').hidden = scroller.scrollLeft >= max - 2;
    el.classList.toggle('hg-more-left', scroller.scrollLeft > 2);
    el.classList.toggle('hg-more-right', scroller.scrollLeft < max - 2);
  }
  /** Bring a commit into view (the replay's current one, or the one picked on another branch). */
  function reveal(sha) {
    const x = X?.get(sha);
    if (x == null || !scroller) return;
    const l = scroller.scrollLeft, w = scroller.clientWidth;
    if (x < l + gutter + 30 || x > l + w - 30) scroller.scrollTo({ left: Math.max(0, x - (w + gutter) / 2), behavior: 'smooth' });
  }

  function wire() {
    svg.querySelectorAll('.hg-c').forEach((g) => {
      const c = bySha.get(g.dataset.sha);
      const go = () => {
        hideTip();
        if (g.dataset.step != null) onStep(Number(g.dataset.step));
        else onLook(c.sha); // any other commit: read what it changed
      };
      g.addEventListener('click', (e) => { e.stopPropagation(); if (!dragged) go(); });
      g.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(); } });
      g.addEventListener('pointerenter', () => showTip(g, c));
      g.addEventListener('pointerleave', hideTip);
      g.addEventListener('focus', () => { showTip(g, c); reveal(c.sha); });
      g.addEventListener('blur', hideTip);
    });
    const pick = (id) => { if (!dragged) onLane(id === 'head' ? null : id); };
    svg.querySelectorAll('.hg-row').forEach((r) => {
      r.addEventListener('click', () => pick(r.dataset.row));
      r.addEventListener('pointerenter', () => svg.dataset.hover = r.dataset.row);
      r.addEventListener('pointerleave', () => delete svg.dataset.hover);
    });
    el.querySelectorAll('[data-name-lane]').forEach((b) => b.addEventListener('click', () => pick(b.dataset.nameLane)));
    const page = () => (scroller.clientWidth - gutter) * 0.7;
    el.querySelector('.hg-nav.prev').onclick = () => (userMoved = true) && scroller.scrollBy({ left: -page(), behavior: 'smooth' });
    el.querySelector('.hg-nav.next').onclick = () => (userMoved = true) && scroller.scrollBy({ left: page(), behavior: 'smooth' });
    scroller.addEventListener('scroll', () => { hideTip(); nav(); }, { passive: true });
    // a vertical wheel moves along the history when there is more of it than fits
    scroller.addEventListener('wheel', (e) => {
      if (scroller.scrollWidth <= scroller.clientWidth || Math.abs(e.deltaY) <= Math.abs(e.deltaX)) return;
      scroller.scrollLeft += e.deltaY;
      userMoved = true;
      e.preventDefault();
    }, { passive: false });
    // drag to pan; a drag is not a click
    let start = null;
    scroller.addEventListener('pointerdown', (e) => { if (e.button === 0) { start = { x: e.clientX, left: scroller.scrollLeft }; dragged = false; } });
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    function move(e) {
      if (!start) return;
      const dx = e.clientX - start.x;
      if (!dragged && Math.abs(dx) > 4) { dragged = true; el.classList.add('hg-dragging'); hideTip(); }
      if (dragged) { scroller.scrollLeft = start.left - dx; userMoved = true; }
    }
    function up() { if (!start) return; start = null; el.classList.remove('hg-dragging'); setTimeout(() => (dragged = false), 0); }
    unwire = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); };
  }
  let unwire = () => {};

  function showTip(g, c) {
    const l = M.laneOf.get(c.lane);
    const files = c.step != null ? (city.steps[c.step]?.files ?? []).length : (c.files ?? []).length + (c.moreFiles ?? 0);
    const headPr = M.laneOf.get('head')?.pr;
    const where = c.sha === city.meta.base ? 'base of this task' : c.step != null ? `commit ${c.step} of ${n} · ${headPr ? `PR #${headPr.number}` : 'this task'}` : c.landed ? `${headPr ? `PR #${headPr.number}` : 'this task'} merged into ${l?.name ?? 'the base branch'}` : c.pr && l?.kind === 'base' ? `PR #${c.pr} merged into ${l.name}` : l?.pr ? `${l.name} · PR #${l.pr.number} (${l.pr.state})` : l?.name ?? '';
    const hint = c.step != null || c.sha === city.meta.base ? 'Click to put it on the map' : 'Click to see what it changed';
    tip.innerHTML = `<b>${esc(c.message)}</b><span class="mono">${short(c.sha)} · ${esc(c.author || '')}${c.date ? ` · ${esc(day(c.date))}` : ''}</span><span>${esc(where)}${files ? ` · ${files} file${files === 1 ? '' : 's'}` : ''}</span><em>${hint}</em>`;
    tip.hidden = false;
    const hr = el.getBoundingClientRect(), gr = g.getBoundingClientRect();
    const tw = tip.offsetWidth, th = tip.offsetHeight;
    let left = gr.left + gr.width / 2 - hr.left - tw / 2;
    left = Math.max(4, Math.min(hr.width - tw - 4, left));
    let top = gr.top - hr.top - th - 8;
    if (top < -hr.top + 60) top = gr.bottom - hr.top + 8;
    tip.style.left = `${left}px`;
    tip.style.top = `${top}px`;
  }
  function hideTip() { tip.hidden = true; }

  // progress: commits up to the playhead are filled, later ones hollow; the playhead sits on the current commit
  function paint() {
    if (!svg || !X) return;
    const p = Math.min(progress, n); // the "done" step shows the head commit
    svg.querySelectorAll('[data-step]').forEach((g) => {
      const s = Number(g.dataset.step);
      g.classList.toggle('done', s <= p);
      g.classList.toggle('current', !lane && s === p);
    });
    const at = look ? bySha.get(look) : p === 0 ? baseC : inOrder.find((c) => c.step === p);
    const line = svg.querySelector('#hgPlay');
    if (at && line && !lane) { line.style.transform = `translateX(${X.get(at.sha)}px)`; line.style.opacity = 1; line.classList.toggle('look', !!look); } // glides (CSS)
    else if (line) line.style.opacity = 0;
    svg.querySelectorAll('.hg-c').forEach((g) => g.classList.toggle('looked', g.dataset.sha === look));
    if (look) svg.querySelectorAll('[data-step]').forEach((g) => g.classList.remove('current'));
    // a branch being compared: it and the task stay lit, everything else steps back
    if (lane) svg.dataset.lane = lane; else delete svg.dataset.lane;
    el.querySelectorAll('[data-l]').forEach((e) => e.classList.toggle('dim', !!lane && e.dataset.l !== lane && e.dataset.l !== 'head'));
    el.querySelectorAll('.hg-nm').forEach((b) => b.classList.toggle('sel', b.dataset.nameLane === lane));
    svg.querySelectorAll('.hg-row').forEach((r) => r.classList.toggle('sel', r.dataset.row === lane));
    svg.querySelectorAll('.hg-c.ctx').forEach((g) => g.classList.toggle('picked', g.dataset.sha === laneSha));
    if (look) reveal(look); else if (laneSha) reveal(laneSha); else if (!lane && at && moved) reveal(at.sha);
    moved = false;
  }
  let moved = false, opened = false;

  const ro = new ResizeObserver(() => { if (el.clientWidth !== W) { unwire(); draw(); } });
  ro.observe(el);
  draw();
  return {
    // The first position is where the page opens: keep the view on the whole task rather than jump to that commit.
    setProgress(p) { moved = opened && p !== progress; opened = true; progress = p; paint(); },
    setLane(id, sha = null) { lane = id; laneSha = sha; look = null; paint(); },
    setLook(sha) { look = sha; lane = null; laneSha = null; paint(); },
    destroy() { ro.disconnect(); unwire(); el.replaceChildren(); el.classList.remove('hg-host', 'hg-more-left', 'hg-more-right'); },
  };
}
