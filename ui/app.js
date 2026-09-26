// app.js — the Overlook site: start an audit from a GitHub URL or a local folder, then review it like a pull request.
import { showAudit } from './workspace.js';
import { $, $$, api, esc, icon, short, store } from './util.js';
import { createCity3D } from './atlas3d.js';

const app = $('#app');

let API = false;
async function detectApi() {
  try {
    const r = await fetch('/api/health', { cache: 'no-store' });
    API = r.ok && (await r.json()).ok === true;
  } catch { API = false; }
  document.body.classList.toggle('no-api', !API);
}


// ------------------------------------------------------------------ theme
// Light or dark: follows the system until the viewer picks one in the top bar; the choice is kept per browser.
const systemDark = matchMedia('(prefers-color-scheme: dark)');
const themeNow = () => document.documentElement.dataset.theme || (systemDark.matches ? 'dark' : 'light');
function paintThemeSwitch() {
  const b = $('#themeToggle');
  if (!b) return;
  const dark = themeNow() === 'dark';
  b.setAttribute('aria-checked', String(dark));
  b.title = dark ? 'Switch to light mode' : 'Switch to dark mode';
}
// One switch: a click flips the theme; colours ease over instead of jumping.
$('#themeToggle')?.addEventListener('click', () => {
  const next = themeNow() === 'dark' ? 'light' : 'dark';
  const root = document.documentElement;
  if (!matchMedia('(prefers-reduced-motion: reduce)').matches) {
    root.classList.add('theme-anim');
    clearTimeout(paintThemeSwitch.t);
    paintThemeSwitch.t = setTimeout(() => root.classList.remove('theme-anim'), 450);
  }
  root.dataset.theme = next;
  store.set('overlook.theme', next);
  paintThemeSwitch();
});
systemDark.addEventListener('change', paintThemeSwitch);
paintThemeSwitch();

// ------------------------------------------------------------------ router
// Clean paths under the app root: "" (home), "sample", "sample/<id>" (examples and real audits), "audit/<id>".
// The root is the folder above ui/ (from <base href>): "/" locally, "/<repo>/" on GitHub Pages.
export const ROOT = new URL('..', document.baseURI).pathname;
export const href = (p = '') => ROOT + p;
export function navigate(p, { replace = false } = {}) {
  history[replace ? 'replaceState' : 'pushState'](null, '', href(p));
  route();
}
const currentPath = () => {
  let p = location.pathname.startsWith(ROOT) ? location.pathname.slice(ROOT.length) : location.pathname.replace(/^\//, '');
  if (p === 'ui' || p.startsWith('ui/') || p === 'main' || p === 'main/') p = ''; // the app's own folder; /main is the home too
  return p.replace(/\/+$/, '');
};
// Old hash links (#/sample, #/example/x, #/real/x, #/audit/id/…) move to the clean paths.
function upgradeHash() {
  const h = location.hash.replace(/^#\/?/, '');
  if (!location.hash.startsWith('#/')) return;
  const m = h.match(/^(sample|example\/[\w-]+|real\/[\w-]+|audit\/[0-9a-f]{10})/);
  const p = !m ? '' : m[1].replace(/^(example|real)\//, 'sample/');
  history.replaceState(null, '', href(p) + location.search);
}
document.addEventListener('click', (e) => {
  const a = e.target.closest?.('a[href]');
  if (!a || a.target === '_blank' || e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
  const u = new URL(a.href, location.href);
  if (u.origin !== location.origin || !u.pathname.startsWith(ROOT) || u.pathname.startsWith(ROOT + 'ui/') || u.pathname.startsWith(ROOT + 'samples/') || a.hasAttribute('download')) return;
  e.preventDefault();
  navigate(u.pathname.slice(ROOT.length) + u.hash);
});
addEventListener('popstate', () => route());

let cleanup = null;
async function route() {
  cleanup?.();
  cleanup = null;
  window.scrollTo(0, 0);
  const p = currentPath();
  const q = new URLSearchParams(location.search);
  const step = q.get('step');
  const deep = { look: q.get('look'), lane: q.get('lane'), file: q.get('file') };
  document.querySelectorAll('[data-route]').forEach((a) => { a.href = href(a.dataset.route); });
  document.querySelectorAll('.nav a').forEach((a) => a.classList.toggle('on', a.dataset.route === '' ? p === '' : p === a.dataset.route || p.startsWith(a.dataset.route + '/')));
  document.body.classList.toggle('is-home', p === '');
  try {
    if (q.get('data') && p === '') {
      cleanup = showAudit(app, await loadStatic(q.get('data')), { label: q.get('data'), step, ...deep });
      return;
    }
    if (p === 'examples') {
      cleanup = showExamples();
      return;
    }
    if (p === 'sample') {
      cleanup = showAudit(app, await loadStatic('../samples/city.sample'), { label: 'GT-142 sample', step, ...deep });
      return;
    }
    let m = p.match(/^sample\/([a-z0-9-]+)$/);
    if (m) {
      const city = await loadStatic(`../samples/real/${m[1]}.city`).catch(() => loadStatic(`../samples/examples/${m[1]}.city`));
      cleanup = showAudit(app, city, { label: m[1], step, ...deep });
      return;
    }
    m = p.match(/^audit\/([0-9a-f]{10})$/);
    if (m) {
      if (!API) throw new Error('This audit lives on a local Overlook server. Start it with npm run site.');
      const { city } = await api(`/api/audits/${m[1]}`);
      cleanup = showAudit(app, city, { id: m[1], step, hasApi: API, ...deep });
      return;
    }
    cleanup = showHome();
  } catch (e) {
    app.innerHTML = `<div class="page narrow"><div class="card error-card"><h2>Could not open this audit</h2><p>${esc(e.message)}</p><a class="btn" href="${href('')}">Start a new audit</a></div></div>`;
  }
}

async function loadStatic(base) {
  try {
    const r = await fetch(base + '.json', { cache: 'no-store' });
    if (r.ok) return await r.json();
    if (location.protocol !== 'file:') throw new Error(`No audit data at ${base}.json`);
  } catch (e) { if (location.protocol !== 'file:') throw e; /* file://: fall back to the .js copy */ }
  return new Promise((ok, fail) => {
    const s = document.createElement('script');
    s.src = base + '.js';
    s.onload = () => (window.CITY ? ok(window.CITY) : fail(new Error('No data in ' + base + '.js')));
    s.onerror = () => fail(new Error(`No audit data at ${base}.json`));
    document.head.appendChild(s);
  });
}

// ------------------------------------------------------------------ home
function showHome() {
  app.innerHTML = `
  <div class="page home">
    <section class="hx">
      <div class="hx-map" id="heroMap" aria-hidden="true"></div>
      <div class="hx-copy">
        <p class="eyebrow">Audit what your AI agent actually did</p>
        <h1>AI said done.<br/><span>See what actually changed.</span></h1>
        <p class="lede">Paste a pull request. Overlook maps every change against what you asked for and checks each line of the agent's report against git.</p>
      </div>
      <div class="hx-input card start" id="start">
      <div class="hx-label"><svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><path fill="currentColor" d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"/></svg> GitHub link</div>
      <form class="source" id="sourceForm" autocomplete="off">
        <div class="field-row">
          <input id="ghUrl" type="text" spellcheck="false" aria-label="GitHub URL" placeholder="Paste a GitHub pull request URL · github.com/owner/repo/pull/123" value="${esc(store.get('overlook.gh') || '')}"/>
          <button class="btn primary" type="submit">Audit it <span class="arr">→</span></button>
        </div>
        <div class="auto-note">Paste a pull request, compare, commit or repository link: the commits, the request and the agent's report are read from it. <button class="linkbtn" type="button" data-manual-open>Choose them yourself</button></div>
      </form>
      <div class="offline">
        <b>Auditing your own repository needs the local Overlook server.</b>
        This hosted copy opens the examples only (see <a href="${href('examples')}">Examples</a>). Run <code>npm run site</code> in the Overlook repository and open <code>http://localhost:4280</code>.
      </div>
      </div>
      <div id="configure" class="hx-configure"></div>
    </section>
  </div>`;

  $$('[data-scroll]').forEach((a) => (a.onclick = (e) => { e.preventDefault(); $('#' + a.dataset.scroll)?.scrollIntoView({ behavior: 'smooth', block: 'start' }); setTimeout(() => $('#ghUrl')?.focus(), 400); }));
  $('#sourceForm').onsubmit = (e) => { e.preventDefault(); loadSource(); };
  $('[data-manual-open]').onclick = () => loadSource({ manual: true });
  // Pasting a GitHub link is enough: it loads straight away.
  $('#ghUrl').addEventListener('paste', () => setTimeout(() => { if (/github\.com\/[^/\s]+\/[^/\s]+/.test($('#ghUrl').value)) loadSource(); }));
  return heroPreview();
}

// The hero is the product itself: real audits (Copilot agent PRs, Bob sessions) take turns behind the input.
// Each one replays its commits, turns a quarter, and hands over to the next.
const HERO_ORDER = ['github-mcp-server-icons', 'atlas-production-fixes', 'playwright-mcp-screenshot'];
const STEP_MS = 1000, REPLAY_MAX_MS = 2400, HOLD_MS = 1000, TURN_MS = 1200, FADE_MS = 260; // about 4–5 s per audit
function heroPreview() {
  let alive = true, map = null, timer = 0, cur = -1, list = [];
  const box = $('#heroMap'), hx = $('.hx'), cities = new Map();
  const text = (x) => (typeof x === 'string' ? x : x?.en ?? '');
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));

  // The city starts under the headline, centred and large, and sits behind the link input.
  const place = () => {
    const copy = $('.hx-copy');
    if (!copy || !map) return;
    const b = box.getBoundingClientRect();
    map.setInsets({ top: Math.round(copy.getBoundingClientRect().bottom - b.top - b.height * 0.1), bottom: -Math.round(b.height * 0.1) }); // shares of the screen, so it sits the same everywhere
  };
  const ro = new ResizeObserver(place);
  ro.observe(box);
  // A little depth: the city drifts against the pointer.
  const still = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const drift = (e) => {
    const r = hx.getBoundingClientRect();
    box.style.transform = `translate(${(0.5 - (e.clientX - r.left) / r.width) * 10}px, ${(0.5 - (e.clientY - r.top) / r.height) * 6}px)`;
  };
  if (!still) hx.addEventListener('pointermove', drift);

  async function show(i) {
    clearTimeout(timer);
    cur = i;
    const e = list[i];
    const city = cities.get(e.id) ?? (await loadStatic(`../samples/real/${e.id}.city`).catch(() => null));
    if (!alive || cur !== i) return;
    if (!city) { timer = setTimeout(() => show((i + 1) % list.length), 200); return; }
    cities.set(e.id, city);
    const last = city.steps.length - 1;
    if (map) { box.classList.add('swap'); await wait(FADE_MS); if (!alive || cur !== i) return; map.destroy(); }
    map = createCity3D(box, { city, text }, { replayCard: false, compact: true, fitMax: 4, onSelect: () => {} });
    map.setLayers({ route: false, labels: true, ripple: true, focus: true });
    map.setProgress(0);
    place();
    box.classList.remove('swap');
    // play the commits (a long history plays faster), hold on the result, turn the city a quarter, then the next audit
    const step = Math.min(STEP_MS, REPLAY_MAX_MS / Math.max(1, last));
    let p = 0;
    const tick = () => {
      if (!alive || cur !== i) return;
      if (p < last) { map.setProgress(++p); timer = setTimeout(tick, step); return; }
      timer = setTimeout(() => { map.rotate(1); timer = setTimeout(() => show((i + 1) % list.length), TURN_MS); }, HOLD_MS);
    };
    timer = setTimeout(tick, 250);
  }

  (async () => {
    const index = await loadStatic('../samples/real/index').catch(() => []);
    if (!alive) return;
    list = HERO_ORDER.map((id) => index.find((e) => e.id === id)).filter(Boolean);
    if (list.length) show(0);
  })();
  return () => { alive = false; clearTimeout(timer); ro.disconnect(); hx.removeEventListener('pointermove', drift); map?.destroy(); };
}

// ------------------------------------------------------------------ examples
// Every finished task we audited, as cards that show what its dashboard looks like: a snapshot of the real map,
// the state, and the review at a glance. Real agent work first, then the scripted scenarios.
function showExamples() {
  app.innerHTML = `
  <div class="page examples-page">
    <header class="ex-head">
      <h1>Finished agent tasks, audited</h1>
      <p class="lede">Open one to see the full dashboard: the map, what changed outside the request, what it may affect and why, which claims in the agent's report hold, and the branch history around the task.</p>
    </header>
    <h2 class="ex-h">Real agent work <span class="muted">IBM Bob sessions from last hackathon's winners and Copilot coding-agent pull requests in well-known projects</span></h2>
    <div class="ex-grid" id="exReal"></div>
    <h2 class="ex-h">Scripted scenarios <span class="muted">made-up repositories that show typical shapes of agent work</span></h2>
    <div class="ex-grid" id="exScripted"></div>
  </div>`;
  let alive = true;
  const maps = [];
  (async () => {
    const get = async (u) => { try { const r = await fetch(u, { cache: 'no-store' }); return r.ok ? r.json() : []; } catch { return []; } };
    const [real, scripted] = await Promise.all([get('../samples/real/index.json'), get('../samples/examples/index.json')]);
    if (!alive) return;
    const card = (e, dir, kind) => {
      const pill = e.outside ? `<span class="pv-pill">${icon('pr')} ${e.outside} to decide</span>` : `<span class="pv-pill ready">${icon('check')} in scope</span>`;
      const claims = e.claims != null ? `<span><b class="${e.claimsTrue < e.claims ? 'bad' : 'ok'}">${e.claimsTrue}/${e.claims}</b> claims hold</span>` : '';
      return `<a class="ex-card" href="${href(`sample/${e.id}`)}">
        <div class="ex-shot"><div class="pv-bar"><i></i><i></i><i></i><span class="mono">${esc(e.repo ?? 'scripted example')}</span>${pill}</div><div class="ex-map" data-map="${esc(dir)}/${esc(e.id)}"><span class="ex-loading">Drawing the map…</span></div></div>
        <div class="ex-body">
          <p class="ex-kind">${esc(kind)}</p>
          <h3>${esc(e.title)}</h3>
          <p class="ex-blurb">${esc(e.blurb ?? '')}</p>
          <div class="ex-kpis"><span><b class="${e.outside ? 'bad' : 'ok'}">${e.outside}</b> of ${e.changed} outside</span><span><b class="${e.affected ? 'warn' : ''}">${e.affected}</b> may be affected</span>${claims}</div>
        </div></a>`;
    };
    $('#exReal').innerHTML = real.map((e) => card(e, 'real', `${e.kind}${e.context ? ` · ${e.context.split('·')[0].trim()}` : ''}`)).join('');
    $('#exScripted').innerHTML = scripted.map((e) => card(e, 'examples', `Scripted scenario · ${e.files} files`)).join('');
    drawAll();
  })();
  // Draw each map with the real renderer, keep a snapshot per theme, and let the renderer go (three at a time).
  // A theme switch redraws the cards (from the snapshots already taken for that theme when there are some).
  const shots = new Map();
  let gen = 0;
  async function drawAll() {
    const g = ++gen, theme = themeNow();
    const boxes = $$('[data-map]');
    for (let i = 0; i < boxes.length && alive && g === gen; i += 3) {
      await Promise.all(boxes.slice(i, i + 3).map(async (box) => {
        const key = `${theme}:${box.dataset.map}`, seen = [...shots.keys()].some((k) => k.endsWith(`:${box.dataset.map}`));
        if (shots.has(key)) { box.innerHTML = `<img alt="" src="${shots.get(key)}"/>`; return; }
        const [dir, id] = box.dataset.map.split('/');
        const city = await loadStatic(`../samples/${dir}/${id}.city`).catch(() => null);
        if (!city || !alive || g !== gen) return;
        box.innerHTML = '';
        const m = createCity3D(box, { city, text: (x) => (typeof x === 'string' ? x : x?.en ?? '') }, { replayCard: false, compact: true, onSelect: () => {} });
        maps.push(m);
        m.setLayers({ route: false, labels: true, ripple: true, focus: true });
        m.setProgress(city.steps.length - 1);
        await new Promise((r) => setTimeout(r, seen ? 700 : 2300)); // the first drawing raises the buildings
        const shot = alive && g === gen ? box.querySelector('canvas')?.toDataURL('image/png') : null;
        m.destroy();
        maps.splice(maps.indexOf(m), 1);
        if (!shot) return;
        shots.set(key, shot);
        box.innerHTML = `<img alt="" src="${shot}"/>`;
      }));
    }
  }
  const redraw = () => drawAll();
  const themeObs = new MutationObserver(redraw);
  themeObs.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  systemDark.addEventListener('change', redraw);
  return () => { alive = false; gen++; themeObs.disconnect(); systemDark.removeEventListener('change', redraw); for (const m of maps) m.destroy(); };
}

// GitHub links only (the engine can still read a local folder: API and MCP, not the page).
// A short message at the top of the page, like a toast: it floats over everything, so nothing moves, and goes by itself.
let noticeTimer = 0;
function notice(msg, { ms = 3600 } = {}) {
  document.querySelector('.top-toast')?.remove();
  clearTimeout(noticeTimer);
  const t = document.createElement('div');
  t.className = 'top-toast';
  t.setAttribute('role', 'alert');
  t.innerHTML = `${icon('alert')}<span>${esc(msg)}</span>`;
  t.onclick = () => t.remove();
  document.body.appendChild(t);
  noticeTimer = setTimeout(() => { t.classList.add('out'); setTimeout(() => t.remove(), 300); }, ms);
}

function currentSource() {
  const github = $('#ghUrl').value.trim();
  store.set('overlook.gh', github);
  return github ? { github } : null;
}

// Paste a link and it runs: the range, the request, the report and the fence all come from the link (a PR's issue
// and description, or the latest run of commits by one author). The form is there only to adjust ("manual").
async function loadSource({ manual = false } = {}) {
  if (!API) return;
  const source = currentSource();
  const box = $('#configure');
  if (!source) { box.innerHTML = ''; notice('Paste a GitHub link first.'); $('#ghUrl')?.focus(); return; }
  // Keep the input where it is: the progress and the form open right under it, and the page grows below.
  const hx = $('.hx'), inp = $('#start');
  if (hx && inp && !hx.style.getPropertyValue('--input-top')) hx.style.setProperty('--input-top', `${inp.offsetTop}px`);
  const steps = ['Fetching the repository', 'Reading the history', 'Checking every claim against git', 'Drawing the map'];
  const show = (i, note = '') => {
    box.innerHTML = `<div class="auto-run"><ol>${steps.map((t, k) => `<li class="${k < i ? 'done' : k === i ? 'now' : ''}">${k < i ? '✓' : k === i ? '<span class="spinner"></span>' : '·'} ${t}${k === 1 && note ? ` <small>${esc(note)}</small>` : ''}</li>`).join('')}</ol>
      <button class="linkbtn" data-manual>Choose the commits and scope yourself</button></div>`;
    $('[data-manual]', box).onclick = () => loadSource({ manual: true });
  };
  if (!manual) show(0);
  else box.innerHTML = `<div class="working"><span class="spinner"></span>${source.github ? 'Fetching the repository from GitHub…' : 'Reading the git history…'}</div>`;
  box.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  let src;
  try {
    src = await api('/api/source', source);
  } catch (e) {
    box.innerHTML = '';
    notice(e.message, { ms: 6000 });
    return;
  }
  if (manual || !src.base) { renderConfigure(box, source, src); box.scrollIntoView({ behavior: 'smooth', block: 'start' }); return; }
  const what = src.pr ? `PR #${src.pr.number}${src.pr.issue ? ` for issue #${src.pr.issue.number}` : ''}` : src.baseReason || 'the latest commits';
  show(1, what);
  const t1 = setTimeout(() => show(2, what), 900), t2 = setTimeout(() => show(3, what), 2200);
  try {
    const out = await api('/api/audit', { ...source, base: src.base, head: src.head });
    clearTimeout(t1); clearTimeout(t2);
    navigate(`audit/${out.id}`);
  } catch (e) {
    clearTimeout(t1); clearTimeout(t2);
    box.innerHTML = '';
    notice(`${e.message} Try "Choose them yourself".`, { ms: 7000 });
  }
}

function commitOptions(commits, selected) {
  return commits.map((c) => `<option value="${c.sha}" ${c.sha === selected ? 'selected' : ''}>${short(c.sha)} · ${esc(c.subject.slice(0, 70))}</option>`).join('');
}

function renderConfigure(box, source, src) {
  const commits = src.commits;
  const head = src.head;
  const base = src.base || commits[Math.min(1, commits.length - 1)]?.sha;
  const baseInList = commits.some((c) => c.sha === base);
  const pr = src.pr;
  box.innerHTML = `
    <form class="configure" id="configureForm">
      <div class="source-summary">
        <span class="src-icon">${source.github ? 'GitHub' : 'Folder'}</span>
        <b>${esc(src.label)}</b>
        <span class="muted mono">${esc(source.folder ? src.dir : '')}</span>
      </div>

      <div class="grid2">
        <label><span class="lbl">Base <small>the commit before the agent started</small></span>
          <select id="base" title="${esc(src.baseReason ? `Suggested: ${src.baseReason}` : '')}">${baseInList ? '' : `<option value="${esc(base)}" selected>${short(base)} · merge base</option>`}${commitOptions(commits, base)}</select></label>
        <label><span class="lbl">Head <small>the agent's last commit</small></span>
          <select id="head">${commitOptions(commits, head)}</select></label>
      </div>

      <div class="grid2">
        <label><span class="lbl">Request title</span>
          <input id="title" type="text" value="${esc(pr?.issue?.title || pr?.title || '')}" placeholder="From the link when left empty"/></label>
        <label><span class="lbl">Folder to map <small>optional</small></span>
          <input id="srcDir" type="text" placeholder="the whole repository (or e.g. src for a large repo)"/></label>
      </div>

      <label><span class="lbl">What was requested <small>used to suggest the request fence</small></span>
        <textarea id="request" rows="2" placeholder="From the link when left empty: the issue the PR closes, or the PR title">${esc(pr?.issue ? `${pr.issue.title}\n\n${pr.issue.body}` : '')}</textarea></label>

      <label><span class="lbl">The agent's final report <small>each sentence becomes a claim to check</small></span>
        <textarea id="report" rows="3" placeholder="From the link when left empty: the PR description, or the commit messages">${esc(pr?.body || '')}</textarea></label>

      <label><span class="lbl">Request fence <small>folders or files the request covers, comma separated; leave empty to suggest from the request</small></span>
        <input id="fence" type="text" spellcheck="false" placeholder="src/articles/"/></label>

      <label class="dropzone" id="auditDrop">
        <input type="file" id="auditFile" accept="application/json,.json" hidden/>
        <span><b>Have a Bob audit?</b> Drop <code>out/audit.json</code> from the Overlook Auditor mode here to use Bob's fence, claims and plain-language notes.</span>
        <span id="auditName" class="muted"></span>
      </label>

      <div class="actions">
        <button class="btn primary big" type="submit" id="run">Run audit</button>
        <span id="runStatus" class="muted"></span>
      </div>
    </form>`;

  let bobAudit = null;
  const drop = $('#auditDrop');
  const takeFile = async (file) => {
    try {
      const doc = JSON.parse(await file.text());
      if (doc.kind !== 'overlook.audit/v1') throw new Error('not an overlook.audit/v1 file');
      bobAudit = doc;
      $('#auditName').textContent = `Using ${file.name}: ${doc.claims?.length ?? 0} claims, fence ${(doc.fence?.paths || []).join(', ') || 'none'}`;
      drop.classList.add('has-file');
    } catch (e) {
      $('#auditName').textContent = `Could not read ${file.name}: ${e.message}`;
    }
  };
  drop.onclick = (e) => { if (e.target.tagName !== 'INPUT') $('#auditFile').click(); };
  $('#auditFile').onchange = (e) => e.target.files[0] && takeFile(e.target.files[0]);
  drop.ondragover = (e) => { e.preventDefault(); drop.classList.add('over'); };
  drop.ondragleave = () => drop.classList.remove('over');
  drop.ondrop = (e) => { e.preventDefault(); drop.classList.remove('over'); e.dataTransfer.files[0] && takeFile(e.dataTransfer.files[0]); };

  $('#configureForm').onsubmit = async (e) => {
    e.preventDefault();
    const btn = $('#run');
    btn.disabled = true;
    $('#runStatus').innerHTML = '<span class="spinner"></span> Collecting evidence from git and drawing the map…';
    try {
      const out = await api('/api/audit', {
        ...source,
        base: $('#base').value,
        head: $('#head').value,
        src: $('#srcDir').value.trim() || undefined,
        title: $('#title').value.trim(),
        request: $('#request').value.trim(),
        report: $('#report').value.trim(),
        fence: $('#fence').value.split(',').map((s) => s.trim()).filter(Boolean),
        audit: bobAudit || undefined,
      });
      navigate(`audit/${out.id}`);
    } catch (err) {
      $('#runStatus').innerHTML = `<span class="form-error">${esc(err.message)}</span>`;
      btn.disabled = false;
    }
  };
}

// ------------------------------------------------------------------ boot
upgradeHash();
await detectApi();
route();
