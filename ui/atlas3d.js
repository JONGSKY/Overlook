// atlas3d.js — the codebase in 3D on a canvas: the city (map).
//
// Same encoding as before (ui/iso.js): a file is a building, as tall as its lines of code, with a bright top band
// for the share this task changed, coloured by verdict (glass unchanged, blue inside the request, red outside,
// amber may be affected, green approved). What the canvas adds:
//   light         every face is shaded by the way it faces, with ground shadows, rim light and haze in the distance
//   architecture  big shared modules are set-back towers, tests are domed labs, the rest blocks with roof plant
//   alarms        a red light beam and a map pin over every undecided change outside the request
//   fence         a real fence (posts and rails) around the requested area: dashed while proposed, lit once confirmed
//   ripple        dotted arcs with light flowing from a change to the files that may be affected
//   revert        a reverted building sinks back and leaves a dashed ghost of the height it had
//   before lens   a magnifier (L) that shows the code as it was under the cursor
//   changes only  unchanged files fade (and in large repositories sink), so the work stands out
//   camera        smooth zoom and pan; the city turns freely (Shift- or right-drag) and snaps to quarter turns
//   day           the sky brightens as the review moves on: dusk until the area is confirmed, day when all is decided
// The city zones blocks by role (ui/layers.js); ui/map.js lays out the blocks and lots.

import { LAYER, layerOf, interest, clipMid, importsOf, isEnv, lines } from './layers.js';
import { U, CX, CY, collider, createVerdicts, bundleEdges, commitCardHtml } from './iso.js';
import { layoutCity } from './map.js';
import { inFence } from '../engine/core/city.mjs';

const QUARTER = Math.PI / 2;
const introduced = new Set(); // views whose opening animation already played in this page
const views = new Map(); // camera and rotation per view, kept when the workspace remounts the canvas

// ---------------------------------------------------------------- colour helpers
function rgb(c) {
  c = String(c || '').trim();
  if (c[0] === '#') {
    let h = c.slice(1);
    if (h.length === 3) h = [...h].map((x) => x + x).join('');
    const n = parseInt(h.slice(0, 6), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  const m = c.match(/[\d.]+/g);
  return m ? m.slice(0, 3).map(Number) : [128, 128, 128];
}
const hex = (a) => '#' + a.map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('');
const SHADE = new Map();
/** f < 1 darkens, f > 1 lightens towards white. Cached: the renderer asks for the same few tones all the time. */
function shade(c, f) {
  const key = c + '|' + f.toFixed(2);
  let v = SHADE.get(key);
  if (!v) { v = hex(rgb(c).map((x) => (f <= 1 ? x * f : x + (255 - x) * (f - 1)))); SHADE.set(key, v); }
  return v;
}
const MIX = new Map();
function mix(a, b, t) {
  const key = a + '|' + b + '|' + t.toFixed(2);
  let v = MIX.get(key);
  if (!v) { const x = rgb(a), y = rgb(b); v = hex(x.map((q, i) => q + (y[i] - q) * t)); MIX.set(key, v); }
  return v;
}
const rgba = (c, a) => `rgba(${rgb(c).join(',')},${a})`;

const KEYS = ['bg', 'surface', 'surface-2', 'ink', 'ink-2', 'ink-3', 'line', 'accent', 'in', 'out', 'aff', 'ok', 'merged', 'city-bg',
  'g-t', 'g-l', 'g-r', 'b-t', 'b-l', 'r-t', 'r-l', 'a-t', 'a-l', 'k-t', 'k-l', 'slab-top', 'slab-l', 'slab-r', 'win', 'win-dark',
  'bld', 'z-ui', 'z-ui-2', 'z-logic', 'z-logic-2', 'z-test', 'z-test-2', 'z-server', 'z-server-2', 'z-infra', 'z-infra-2'];
function readPalette() {
  const cs = getComputedStyle(document.documentElement);
  const P = {};
  for (const k of KEYS) P[k] = cs.getPropertyValue('--' + k).trim() || '#888888';
  const [r, g, b] = rgb(P.bg);
  P.dark = r * 0.3 + g * 0.59 + b * 0.11 < 90;
  P.font = getComputedStyle(document.body).fontFamily || 'system-ui, sans-serif';
  P.cond = cs.getPropertyValue('--cond').trim() || P.font;
  P.dusk = P.dark ? '#1A1D33' : '#E4DEEC';
  P.shadow = P.dark ? '0,0,0' : '18,26,38';
  return P;
}

const BODY = { none: 'bld', reverted: 'bld', in: 'b-l', out: 'r-l', affected: 'a-l', approved: 'k-l' };

function hull(pts) {
  const p = pts.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cr = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lo = [], up = [];
  for (const q of p) { while (lo.length >= 2 && cr(lo.at(-2), lo.at(-1), q) <= 0) lo.pop(); lo.push(q); }
  for (let i = p.length - 1; i >= 0; i--) { const q = p[i]; while (up.length >= 2 && cr(up.at(-2), up.at(-1), q) <= 0) up.pop(); up.push(q); }
  up.pop(); lo.pop();
  return lo.concat(up);
}
function inPoly(pts, x, y) {
  let c = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, yi] = pts[i], [xj, yj] = pts[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c;
  }
  return c;
}
const path = (c, pts) => { c.beginPath(); c.moveTo(pts[0][0], pts[0][1]); for (let i = 1; i < pts.length; i++) c.lineTo(pts[i][0], pts[i][1]); c.closePath(); };
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
/** Point on a chain of cubic segments [[p0, c1, c2, p3], …] at u in 0..1. */
function along(segs, u) {
  const n = segs.length, i = Math.min(n - 1, Math.floor(u * n)), t = u * n - i, [a, b, c, d] = segs[i], m = 1 - t;
  return [m * m * m * a[0] + 3 * m * m * t * b[0] + 3 * m * t * t * c[0] + t * t * t * d[0], m * m * m * a[1] + 3 * m * m * t * b[1] + 3 * m * t * t * c[1] + t * t * t * d[1]];
}
const quadSeg = (a, ctl, b) => [a, [a[0] + (2 / 3) * (ctl[0] - a[0]), a[1] + (2 / 3) * (ctl[1] - a[1])], [b[0] + (2 / 3) * (ctl[0] - b[0]), b[1] + (2 / 3) * (ctl[1] - b[1])], b];

// ---------------------------------------------------------------- scenes: groups (blocks / platforms) and lots
function cityScene(city) {
  const C = layoutCity(city);
  // Slabs thicken with the city, like the buildings (createVerdicts' lift): seen from further away, they keep their depth.
  const lift = Math.min(3, Math.max(1, Math.sqrt(city.files.length / 150))), zt = 2.5 * lift, t = 6 * lift;
  const groups = C.blocks.map((b) => ({ id: b.id, name: b.name, layer: b.layer, x: b.x, y: b.y, w: b.w, d: b.h, z: zt, t, order: 0, parcels: b.parcels, score: b.score, lots: [], src: b }));
  const gOf = new Map(C.blocks.map((b, i) => [b, groups[i]]));
  const lots = C.lots.map((l) => ({ f: l.f, x0: l.x0, y0: l.y0, x1: l.x1, y1: l.y1, z0: zt + t + 2, g: gOf.get(l.block), parcel: l.parcel }));
  return { groups, lots, zones: C.zones, ground: C.ground, zt, lift };
}

export function createCity3D(container, model, handlers = {}) {
  const kind = 'map';
  let city = model.city;
  const key = `${kind}:${city.meta?.head ?? ''}`;
  const motion = !matchMedia('(prefers-reduced-motion: reduce)').matches;
  let items = new Map((city.items ?? []).map((it) => [it.file, it]));
  let M = createVerdicts(city, city.files, items);

  const S = cityScene(city);
  for (const l of S.lots) l.g.lots.push(l);
  const lotOf = new Map(S.lots.map((l) => [l.f.path, l]));
  const lotsOfParcel = new Map();
  for (const l of S.lots) (lotsOfParcel.get(l.parcel) ?? lotsOfParcel.set(l.parcel, []).get(l.parcel)).push(l);
  const imports = importsOf(city);
  const onScreen = new Set((city.screens ?? []).map((s) => s.file));
  const big = city.files.length > 300;
  const lodPx = 11 + (city.files.length > 300 ? 6 : city.files.length > 120 ? 3 : 0);

  const state = {
    mode: 'after', split: 0.5,
    layers: { route: true, ripple: true, labels: true, focus: true },
    selected: null, hover: new Set(), hoverHit: null,
    lens: { on: false, x: 0, y: 0, in: false },
    edit: null, fx: [], alarmT: -1e9, scanT: -1e9,
    commit: null, // { paths: Set, aff: Set, first: Set, stats: { path: { plus, minus } } } while a commit is on screen
  };
  let PAL = readPalette();

  // ---------------------------------------------------------------- canvas, buffers, overlays
  container.classList.add('atlas-wrap');
  const cv = document.createElement('canvas');
  cv.className = 'atlas atlas3d city-view';
  cv.setAttribute('role', 'img');
  cv.setAttribute('aria-label', 'Codebase city');
  container.appendChild(cv);
  const ctx = cv.getContext('2d');
  const bufA = document.createElement('canvas'), bufB = document.createElement('canvas');
  const tip = document.createElement('div');
  tip.className = 'atlas-tip hidden';
  container.appendChild(tip);
  const card = document.createElement('div');
  card.className = 'replay-card hidden';
  container.appendChild(card);
  let W = 0, H = 0, dpr = 1;

  // ---------------------------------------------------------------- camera and projection
  const cam = { k: 1, x: 0, y: 0 }, tgt = { k: 1, x: 0, y: 0 };
  let rot = 0, rotT = 0, rc = 1, rs = 0, touched = false, orbiting = false, camMoving = false;
  const iso = (x, y, z = 0) => { const p = x * rc - y * rs, q = x * rs + y * rc; return [(p - q) * CX, (p + q) * CY - z]; };
  const scr = (a) => [cam.x + a[0] * cam.k, cam.y + a[1] * cam.k];
  const P = (x, y, z = 0) => { const p = x * rc - y * rs, q = x * rs + y * rc; return [cam.x + (p - q) * CX * cam.k, cam.y + ((p + q) * CY - z) * cam.k]; };
  const depthOf = (x, y) => x * (rc + rs) + y * (rc - rs);
  const N4 = [[0, -1], [1, 0], [0, 1], [-1, 0]];
  let faces = [];
  function turn() {
    rc = Math.cos(rot); rs = Math.sin(rot);
    faces = [];
    for (let i = 0; i < 4; i++) {
      const [nx, ny] = N4[i], p = nx * rc - ny * rs, q = nx * rs + ny * rc;
      if (p + q > 1e-6) faces.push({ i, f: 0.76 + 0.19 * (p - q) / Math.SQRT2 }); // lit wall ~0.95, shaded wall ~0.57
    }
  }
  turn();
  // The workspace floats a toolbar over the top and a legend over the bottom; a compact preview has neither.
  let insetRightPx = 0; // room taken by a card floating over the map (the commit comparison)
  let insetTopPx = null, insetBottomPx = null; // set by a page that lays text over the map (Main)
  const insetTop = () => insetTopPx ?? (handlers.compact ? 8 : W < 600 ? 104 : 54);
  const insetBottom = () => insetBottomPx ?? (handlers.compact ? 8 : 46);

  function sceneBox() {
    const g = S.ground, keep = [rc, rs];
    rc = Math.cos(rotT); rs = Math.sin(rotT); // where the view is heading, so a fit during a turn lands centred
    const cs = [[g.x0, g.y0], [g.x1, g.y0], [g.x1, g.y1], [g.x0, g.y1]].flatMap(([x, y]) => [iso(x, y, 0), iso(x, y, -16 * S.lift)]);
    const tall = Math.max(40, ...S.lots.map((l) => M.heightOf(l.f, 'after'))) + 30;
    [rc, rs] = keep;
    return { x0: Math.min(...cs.map((p) => p[0])) - 20, x1: Math.max(...cs.map((p) => p[0])) + 20, y0: Math.min(...cs.map((p) => p[1])) - tall, y1: Math.max(...cs.map((p) => p[1])) + 24 };
  }
  const usable = () => { const r = W > 700 ? insetRightPx : 0; return { x: 0, y: insetTop(), w: Math.max(120, W - r), h: Math.max(120, H - insetTop() - insetBottom()) }; };
  const fitK = (b) => { const u = usable(); return Math.min(u.w / (b.x1 - b.x0), u.h / (b.y1 - b.y0)) * 0.96; };
  function fitTo(b, maxK, animate = true) {
    const u = usable(), k = Math.min(maxK, fitK(b));
    const t = { k, x: u.x + u.w / 2 - ((b.x0 + b.x1) / 2) * k, y: u.y + u.h / 2 - ((b.y0 + b.y1) / 2) * k };
    Object.assign(tgt, t);
    if (!animate || !motion) Object.assign(cam, t);
    kick();
  }
  const FIT_MAX = handlers.fitMax ?? 2.2; // how far a fit may zoom in on a small codebase
  // In a large codebase the changes are a few small buildings in a big city: open framed on them (changed and
  // may-be-affected files, with room around), and let the fit button switch between that and the whole city.
  let fitAll = false;
  function workBox() {
    if (handlers.compact) return null;
    const ls = S.lots.filter((l) => l.f.status !== 'unchanged' || M.stateOf(l.f) === 'affected');
    if (!ls.length) return null;
    const all = sceneBox(), pts = ls.flatMap((l) => [iso(l.x0, l.y0, l.z0), iso(l.x1, l.y1, l.z0), iso(l.x1, l.y0, l.z0), iso(l.x0, l.y1, l.z0 + M.heightOf(l.f, 'after'))]);
    const b = { x0: Math.min(...pts.map((p) => p[0])), x1: Math.max(...pts.map((p) => p[0])), y0: Math.min(...pts.map((p) => p[1])), y1: Math.max(...pts.map((p) => p[1])) };
    const w = b.x1 - b.x0, h = b.y1 - b.y0, px = Math.max(160, w * 0.35), py = Math.max(140, h * 0.35);
    const box = { x0: b.x0 - px, x1: b.x1 + px, y0: b.y0 - py - 140, y1: b.y1 + py }; // room above for the fence tag and pins
    // Worth it only when the work covers a small part of the city.
    return (box.x1 - box.x0) * (box.y1 - box.y0) < 0.35 * (all.x1 - all.x0) * (all.y1 - all.y0) ? box : null;
  }
  const homeBox = () => (!fitAll && workBox()) || sceneBox();
  function fit(animate = true) {
    if (!touched && workBox()) fitAll = !fitAll; else fitAll = false;
    touched = false; fitTo(homeBox(), FIT_MAX, animate);
  }
  function zoomAt(sx, sy, f) {
    const k = Math.min(6, Math.max(fitK(sceneBox()) * 0.45, tgt.k * f));
    tgt.x = sx - ((sx - tgt.x) * k) / tgt.k; tgt.y = sy - ((sy - tgt.y) * k) / tgt.k; tgt.k = k;
    touched = true;
    kick();
  }
  function focusPaths(paths, play = false) {
    const ls = paths.map((p) => lotOf.get(p)).filter(Boolean);
    if (!ls.length) return;
    const pts = ls.flatMap((l) => [iso(l.x0, l.y0, l.z0), iso(l.x1, l.y1, l.z0), iso(l.x1, l.y0, l.z0), iso(l.x0, l.y1, l.z0 + M.heightOf(l.f, 'after'))]);
    const pad = play ? 240 : 140;
    touched = true;
    fitTo({ x0: Math.min(...pts.map((p) => p[0])) - pad, x1: Math.max(...pts.map((p) => p[0])) + pad, y0: Math.min(...pts.map((p) => p[1])) - pad, y1: Math.max(...pts.map((p) => p[1])) + pad }, play ? 1.25 : 1.6);
  }

  // ---------------------------------------------------------------- state of every lot (animated)
  // The camera is remembered per audit for the workspace only; previews (Main, Examples) always open framed,
  // and they never overwrite what the workspace remembered.
  const saved = handlers.compact ? null : views.get(key);
  let introT0 = 0;
  if (!introduced.has(key) && motion) {
    introduced.add(key);
    introT0 = performance.now() + 150;
    const ds = S.lots.map((l) => depthOf((l.x0 + l.x1) / 2, (l.y0 + l.y1) / 2));
    const d0 = Math.min(...ds), d1 = Math.max(...ds);
    S.lots.forEach((l, i) => (l.delay = ((ds[i] - d0) / Math.max(1e-6, d1 - d0)) * 900));
    rot = -0.62; turn();
  }
  for (const l of S.lots) { l.h = introT0 ? 0 : M.exists(l.f, 'after') ? M.heightOf(l.f, 'after') : 0; l.a = 1; l.delay ??= 0; }
  const isSel = (l) => l.f.path === state.selected;
  const isHov = (l) => state.hover.has(l.f.path) || state.hoverHit === l.f.path;
  function targetH(l, now) {
    if (introT0 && now < introT0 + l.delay) return 0;
    if (!M.exists(l.f, 'after')) return 0;
    const h = M.heightOf(l.f, 'after'), st = M.stateOf(l.f);
    if (state.commit?.paths.has(l.f.path)) return Math.max(h, 30 * M.lift);
    if (st !== 'none' && st !== 'reverted') return Math.max(h, 30 * M.lift);
    if (state.layers.focus && big && !state.edit && M.stateOf(l.f) === 'none' && !isSel(l) && !isHov(l)) return 6 + h * 0.6;
    return h;
  }
  function targetA(l) {
    if (state.commit && !state.edit) return state.commit.paths.has(l.f.path) || state.commit.aff.has(l.f.path) || isSel(l) || isHov(l) ? 1 : 0.22;
    if (!state.layers.focus || state.edit || isSel(l) || isHov(l)) return 1;
    return M.stateOf(l.f) === 'none' ? (big ? 0.72 : 0.4) : 1;
  }
  function refreshGroups() {
    for (const g of S.groups) g.fenced = state.edit ? g.lots.some((l) => inFence(l.f.path, state.edit.paths)) : g.lots.some((l) => l.f.inFence);
  }
  refreshGroups();
  const confirmed = () => city.meta?.fenceSetBy === 'reviewer';
  function dayLevel() {
    if (!confirmed()) return 0;
    const all = city.items ?? [];
    if (!all.length) return 1;
    return 0.2 + (0.8 * all.filter((it) => M.st.decisions[it.file]).length) / all.length;
  }

  // ---------------------------------------------------------------- drawing kit
  /** A box with visible sides shaded by the way they face, and its top. */
  function box(c, x0, y0, x1, y1, z0, z1, color, o = {}) {
    const cs = [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
    for (const { i, f } of faces) {
      const a = cs[i], b = cs[(i + 1) % 4];
      const A0 = P(a[0], a[1], z0), B0 = P(b[0], b[1], z0), B1 = P(b[0], b[1], z1), A1 = P(a[0], a[1], z1);
      path(c, [A0, B0, B1, A1]);
      if (o.flat) c.fillStyle = shade(color, f);
      else {
        const g = c.createLinearGradient(A1[0], A1[1], A0[0], A0[1]);
        g.addColorStop(0, shade(color, f + 0.06)); g.addColorStop(1, shade(color, f - 0.12));
        c.fillStyle = g;
      }
      c.fill();
      if (o.windows) windows(c, a, b, z0, z1, o);
    }
    if (!o.flat && faces.length === 2 && z1 - z0 > 4) {
      const k = faces[0].i === (faces[1].i + 1) % 4 ? faces[0].i : faces[1].i, e = cs[k];
      c.beginPath(); c.moveTo(...P(e[0], e[1], z0)); c.lineTo(...P(e[0], e[1], z1));
      c.strokeStyle = rgba('#ffffff', PAL.dark ? 0.14 : 0.35); c.lineWidth = 1; c.stroke();
    }
    path(c, cs.map(([x, y]) => P(x, y, z1)));
    c.fillStyle = o.top ?? shade(color, 1.2);
    c.fill();
    if (o.rim) { c.strokeStyle = o.rim; c.lineWidth = 1; c.stroke(); }
  }
  function windows(c, a, b, z0, z1, o) {
    const fh = 8, n = Math.floor((z1 - z0 - 5) / fh);
    if (n < 1) return;
    const cols = o.glass ? [[0.12, 0.3], [0.41, 0.59], [0.7, 0.88]] : [[0.16, 0.42], [0.58, 0.84]];
    for (let k = 0; k < n; k++) {
      const zz = z0 + 4 + k * fh;
      for (const [u0, u1] of cols) {
        const lit = o.lit && ((o.seed * 97 + k * 13 + u0 * 7) % 1) > 0.45;
        const p0 = [a[0] + (b[0] - a[0]) * u0, a[1] + (b[1] - a[1]) * u0], p1 = [a[0] + (b[0] - a[0]) * u1, a[1] + (b[1] - a[1]) * u1];
        path(c, [P(p0[0], p0[1], zz), P(p1[0], p1[1], zz), P(p1[0], p1[1], zz + 3.6), P(p0[0], p0[1], zz + 3.6)]);
        c.fillStyle = lit ? 'rgba(255,214,140,.7)' : o.win;
        c.fill();
      }
    }
  }
  const boxHull = (x0, y0, x1, y1, z0, z1) => hull([[x0, y0], [x1, y0], [x1, y1], [x0, y1]].flatMap(([x, y]) => [P(x, y, z0), P(x, y, z1)]));
  const quadAt = (x0, y0, x1, y1, z) => [P(x0, y0, z), P(x1, y0, z), P(x1, y1, z), P(x0, y1, z)];
  function groundEllipse(c, l, scale) {
    const [x, y] = P((l.x0 + l.x1) / 2, (l.y0 + l.y1) / 2, l.z0), rx = (l.x1 - l.x0) * CX * cam.k * scale;
    c.beginPath(); c.ellipse(x, y, rx, rx * (CY / CX), 0, 0, Math.PI * 2);
  }
  const hatches = new WeakMap();
  function hatch(c) {
    let h = hatches.get(c);
    if (h && h.color === PAL.aff) return h.p;
    const pc = document.createElement('canvas');
    pc.width = pc.height = 8;
    const x = pc.getContext('2d');
    x.strokeStyle = PAL.aff; x.lineWidth = 2;
    x.beginPath(); x.moveTo(-2, 10); x.lineTo(10, -2); x.moveTo(-2, 2); x.lineTo(2, -2); x.moveTo(6, 10); x.lineTo(10, 6); x.stroke();
    h = { p: c.createPattern(pc, 'repeat'), color: PAL.aff };
    hatches.set(c, h);
    return h.p;
  }
  /** Text painted flat on the ground along the front edge of a rectangle. */
  function groundText(c, r, z, text, size, color) {
    const edges = [[[r.x0, r.y0], [r.x1, r.y0], [0, 1]], [[r.x1, r.y0], [r.x1, r.y1], [-1, 0]], [[r.x1, r.y1], [r.x0, r.y1], [0, -1]], [[r.x0, r.y1], [r.x0, r.y0], [1, 0]]];
    let best = null, by = -Infinity;
    for (const e of edges) { const m = P((e[0][0] + e[1][0]) / 2, (e[0][1] + e[1][1]) / 2, z)[1]; if (m > by) { by = m; best = e; } }
    let [A, B, inward] = best;
    if (P(...B, z)[0] < P(...A, z)[0]) [A, B] = [B, A];
    const len = Math.hypot(B[0] - A[0], B[1] - A[1]), ux = (B[0] - A[0]) / len, uy = (B[1] - A[1]) / len;
    const o = P(A[0] + ux * 0.4 + inward[0] * 0.45, A[1] + uy * 0.4 + inward[1] * 0.45, z), eu = P(A[0] + ux * 1.4 + inward[0] * 0.45, A[1] + uy * 1.4 + inward[1] * 0.45, z);
    const ev = P(A[0] + ux * 0.4, A[1] + uy * 0.4, z);
    const s = 20;
    c.save();
    c.setTransform(dpr * (eu[0] - o[0]) / s, dpr * (eu[1] - o[1]) / s, dpr * (ev[0] - o[0]) / 0.45 / s, dpr * (ev[1] - o[1]) / 0.45 / s, dpr * o[0], dpr * o[1]);
    c.font = `700 ${size * s}px ${PAL.cond}`;
    c.fillStyle = color; c.textBaseline = 'alphabetic';
    c.fillText(text, 0, 0, (len - 0.8) * s);
    c.restore();
  }

  // ---------------------------------------------------------------- the scene (cached per side)
  let hitsA = [], hitsB = [], groupHits = [], haze = null, flat = false, pxLot = 30;
  function stateOn(l, side) { return side === 'after' ? M.stateOf(l.f) : 'none'; }

  function drawSky(c) {
    const g = c.createLinearGradient(0, 0, 0, H);
    const base = PAL['city-bg'], day = dayLevel();
    g.addColorStop(0, mix(base, PAL.dusk, (1 - day) * 0.85));
    g.addColorStop(1, base);
    c.fillStyle = g;
    c.fillRect(0, 0, W, H);
  }

  function drawCityGround(c) {
    const g = S.ground;
    box(c, g.x0, g.y0, g.x1, g.y1, -16 * S.lift, 0, PAL['slab-l'], { flat: true, top: PAL['slab-top'] });
    // Survey grid: faint lines on the streets.
    const cell = Math.max(4, Math.ceil(Math.max(g.x1 - g.x0, g.y1 - g.y0) / 6));
    const nx = Math.ceil((g.x1 - g.x0) / cell), ny = Math.ceil((g.y1 - g.y0) / cell);
    c.save();
    c.strokeStyle = rgba(PAL['ink-3'], PAL.dark ? 0.16 : 0.18); c.lineWidth = 1; c.setLineDash([3, 5]);
    for (let i = 1; i < nx; i++) { const x = g.x0 + i * cell, a = P(x, g.y0, 0), b = P(x, g.y1, 0); c.beginPath(); c.moveTo(...a); c.lineTo(...b); c.stroke(); }
    for (let j = 1; j < ny; j++) { const y = g.y0 + j * cell, a = P(g.x0, y, 0), b = P(g.x1, y, 0); c.beginPath(); c.moveTo(...a); c.lineTo(...b); c.stroke(); }
    c.restore();
    for (const z of S.zones) {
      box(c, z.x, z.y, z.x + z.w, z.y + z.h, 0, S.zt, PAL[`z-${z.layer}-2`], { flat: true, top: PAL[`z-${z.layer}`] });
      if (U * cam.k > 5) groundText(c, { x0: z.x, y0: z.y, x1: z.x + z.w, y1: z.y + z.h }, 1.5, z.name.toUpperCase(), 0.62, rgba(PAL.ink, PAL.dark ? 0.2 : 0.2));
    }
  }

  function plateTop(g, side) {
    if (g.fenced) return mix(PAL['g-t'], PAL.accent, 0.16);
    if (side === 'before') return PAL['g-t'];
    // The folder takes the colour of the most pressing thing inside it: outside the request (red), inside (blue),
    // may be affected (amber). The more of its files involved, the stronger the tint.
    const n = { out: 0, in: 0, affected: 0 };
    for (const l of g.lots) { const t = M.stateOf(l.f); if (t === 'out') n.out++; else if (t === 'in' || t === 'approved') n.in++; else if (t === 'affected') n.affected++; }
    const col = plateColor(g);
    if (!col) return PAL['g-t'];
    const share = (n.out + n.in + n.affected) / g.lots.length;
    // A light tint on top (the buildings on it must still stand out); the colour itself goes on the slab's sides.
    return mix(PAL['g-t'], col, PAL.dark ? 0.1 + 0.08 * Math.min(1, share * 2) : 0.06 + 0.06 * Math.min(1, share * 2));
  }
  function plateColor(g) {
    let out = false, inn = false, aff = false;
    for (const l of g.lots) { const t = M.stateOf(l.f); if (t === 'out') out = true; else if (t === 'in' || t === 'approved') inn = true; else if (t === 'affected') aff = true; }
    return out ? PAL.out : inn ? PAL.in : aff ? PAL.aff : null;
  }

  function drawPlate(c, g, side) {
    const top = g.z + g.t;
    const col = side === 'after' && !g.fenced ? plateColor(g) : null;
    const sideC = col ? mix(PAL['g-l'], col, PAL.dark ? 0.6 : 0.5) : PAL['g-l'];
    box(c, g.x, g.y, g.x + g.w, g.y + g.d, g.z, top, sideC, { flat: true, top: plateTop(g, side), rim: rgba('#ffffff', PAL.dark ? 0.08 : 0.8) });
    for (const p of g.parcels) box(c, p.gx - 0.1, p.gy - 0.1, p.gx + p.w + 0.1, p.gy + p.h + 0.1, top, top + 2, sideC, { flat: true, top: shade(plateTop(g, side), PAL.dark ? 1.1 : 1.03) });
    const q = quadAt(g.x, g.y, g.x + g.w, g.y + g.d, top);
    if (side === 'after') groupHits.push({ g, poly: q });
    if (state.edit) {
      path(c, quadAt(g.x + 0.12, g.y + 0.12, g.x + g.w - 0.12, g.y + g.d - 0.12, top + 1));
      c.setLineDash([5, 4]); c.strokeStyle = rgba(PAL.accent, g.fenced ? 0.95 : 0.4); c.lineWidth = state.hoverGroup === g ? 2.6 : 1.4; c.stroke(); c.setLineDash([]);
      if (state.hoverGroup === g) { path(c, q); c.fillStyle = rgba(PAL.accent, 0.12); c.fill(); }
    }
    // Ground marks: shadows, affected rings, the selection ring, empty lots.
    for (const l of g.lots) {
      const st = stateOn(l, side), exists = M.exists(l.f, side);
      const h = side === 'after' ? l.h : exists ? M.heightOf(l.f, 'before') : 0;
      if (!exists) {
        if (side === 'before' || st === 'reverted' || l.f.status === 'added' || l.f.status === 'deleted') {
          path(c, quadAt(l.x0, l.y0, l.x1, l.y1, l.z0)); c.setLineDash([3, 3]); c.strokeStyle = rgba(PAL['ink-3'], 0.8); c.lineWidth = 1; c.stroke(); c.setLineDash([]);
        }
        continue;
      }
      if (!flat && h > 1) {
        const k = cam.k, dx = h * k * 0.5, dy = h * k * 0.16;
        const cs = [[l.x0, l.y0], [l.x1, l.y0], [l.x1, l.y1], [l.x0, l.y1]].map(([x, y]) => P(x, y, l.z0));
        path(c, hull(cs.concat(cs.map(([x, y]) => [x + dx, y + dy]))));
        c.fillStyle = `rgba(${PAL.shadow},${(PAL.dark ? 0.42 : 0.18) * (side === 'after' ? l.a : 1)})`;
        c.fill();
      }
      if (st === 'affected') {
        const sure = onScreen.has(l.f.path);
        groundEllipse(c, l, 1.3);
        c.fillStyle = hatch(c); c.globalAlpha = 0.75; c.fill(); c.globalAlpha = 1;
        c.strokeStyle = rgba(PAL.aff, sure ? 1 : 0.6); c.lineWidth = sure ? 2.2 : 1.3;
        if (!sure) c.setLineDash([3, 3]);
        c.stroke(); c.setLineDash([]);
      }
      if (side === 'after' && isSel(l)) {
        groundEllipse(c, l, 1.45);
        c.fillStyle = rgba(PAL.accent, 0.16); c.fill();
        c.strokeStyle = rgba(PAL.accent, 0.85); c.lineWidth = 1.6; c.stroke();
      }
    }
  }

  function archOf(l) {
    return (l.arch ??= archFor(l));
  }
  function archFor(l) {
    const L = layerOf(l.f);
    if (L === 'test') return 'lab';
    if ((L === 'logic' || L === 'server') && Math.max(M.heightOf(l.f, 'after'), M.heightOf(l.f, 'before')) >= 34) return 'tower';
    return 'block';
  }

  function drawLot(c, l, side, hits) {
    const f = l.f, after = side === 'after';
    const st = stateOn(l, side);
    const exists = M.exists(f, side);
    const h = after ? l.h : exists ? M.heightOf(f, 'before') : 0;
    const { x0, y0, x1, y1, z0 } = l;
    if (after && st === 'reverted' && f.status !== 'deleted') {
      // The ghost: the height the file had before the revert.
      const gh = M.heightFor(f.locAfter || 0);
      if (gh > h + 1) { c.save(); path(c, boxHull(x0, y0, x1, y1, z0, z0 + gh)); c.setLineDash([3, 3]); c.strokeStyle = rgba(PAL['ink-2'], 0.6); c.lineWidth = 1.1; c.stroke(); c.restore(); }
    }
    const inCommit = after && state.commit?.paths.has(f.path);
    if (inCommit) {
      // This commit's buildings: a lit ring on the ground, and a dashed outline where the building stood before it.
      const col = st === 'out' ? PAL.out : st === 'none' ? PAL.merged : PAL.accent;
      c.save(); groundEllipse(c, l, 1.7); c.strokeStyle = rgba(col, 0.9); c.lineWidth = 2.4; if (motion) { c.shadowColor = col; c.shadowBlur = 10; } c.stroke(); c.restore();
      const prev = state.commit.first.has(f.path) ? (f.status === 'added' ? 0 : M.heightFor(f.locBefore || 0)) : null;
      if (prev != null && Math.abs(prev - h) > 1.5 && prev > 0) { c.save(); path(c, boxHull(x0, y0, x1, y1, z0, z0 + prev)); c.setLineDash([4, 3]); c.strokeStyle = rgba(PAL.ink, 0.75); c.lineWidth = 1.3; c.stroke(); c.restore(); }
      if (prev === 0) { c.save(); path(c, quadAt(x0 - 0.08, y0 - 0.08, x1 + 0.08, y1 + 0.08, z0)); c.setLineDash([3, 3]); c.strokeStyle = rgba(PAL.ok, 0.9); c.lineWidth = 1.4; c.stroke(); c.restore(); }
    }
    if (after && state.commit?.aff.has(f.path)) { c.save(); groundEllipse(c, l, 1.6); c.strokeStyle = rgba(PAL.aff, 0.95); c.lineWidth = 2.2; c.stroke(); c.restore(); }
    if (h < 0.6) return;
    const a = after ? l.a : state.layers.focus && interest(f) === 0 ? 0.45 : 1;
    let body = PAL[BODY[st] ?? 'bld'];
    if (st === 'none' || st === 'reverted') {
      if (haze) body = mix(body, haze.sky, Math.round((1 - (depthOf((x0 + x1) / 2, (y0 + y1) / 2) - haze.d0) / haze.span) * 6) / 6 * (PAL.dark ? 0.26 : 0.2));
      if (after && big && state.layers.focus && !state.edit && st === 'none' && !isSel(l)) body = mix(body, PAL['g-t'], 0.3);
    }
    // A file of the commit on screen that the task did not change (another branch's work): purple, like its dot.
    if (after && st === 'none' && state.commit?.paths.has(f.path)) body = mix(PAL.bld, PAL.merged, 0.7);
    const arch = flat ? 'block' : archOf(l);
    const capH = after && st !== 'none' && st !== 'reverted' && M.reached(f) ? Math.min(h - 2, Math.max(3, h * M.capOf(f))) : 0;
    const capC = mix(body, '#ffffff', PAL.dark ? 0.32 : 0.42);
    const win = pxLot >= 18 && !flat;
    const o = { flat, windows: win, win: st === 'none' || st === 'reverted' ? PAL['win-dark'] : PAL.win, lit: PAL.dark && st !== 'none' && st !== 'reverted', seed: (f.path.length * 9301 + (f.locAfter || 0)) % 233 / 233, rim: pxLot > 12 ? rgba('#ffffff', PAL.dark ? 0.16 : 0.5) : null };
    const z1 = z0 + h;
    c.globalAlpha = a;
    let topZ = z1, extra = [];
    if (arch === 'tower' && h > 26) {
      const zb = z0 + (h - capH) * 0.62, i = 0.15 * (x1 - x0);
      box(c, x0, y0, x1, y1, z0, zb, body, o);
      box(c, x0 + i, y0 + i, x1 - i, y1 - i, zb, z1 - capH, body, { ...o, glass: true });
      if (capH) box(c, x0 + i, y0 + i, x1 - i, y1 - i, z1 - capH, z1, capC, { flat, rim: o.rim });
      if (pxLot >= 16) { const s0 = P((x0 + x1) / 2, (y0 + y1) / 2, z1), s1 = P((x0 + x1) / 2, (y0 + y1) / 2, z1 + 8); c.strokeStyle = shade(body, 0.7); c.lineWidth = 1.4; c.beginPath(); c.moveTo(...s0); c.lineTo(...s1); c.stroke(); topZ = z1 + 8; }
    } else {
      box(c, x0, y0, x1, y1, z0, z1 - capH, body, o);
      if (capH) box(c, x0, y0, x1, y1, z1 - capH, z1, capC, { flat, rim: o.rim });
      if (arch === 'lab' && pxLot >= 14) {
        const cc = P((x0 + x1) / 2, (y0 + y1) / 2, z1 + 1), r = (x1 - x0) * 0.3 * CX * cam.k;
        c.beginPath(); c.ellipse(cc[0], cc[1], r, r * 0.95, 0, Math.PI, 0); c.ellipse(cc[0], cc[1], r, r * 0.5, 0, 0, Math.PI); c.closePath();
        const g = c.createRadialGradient(cc[0] - r * 0.35, cc[1] - r * 0.6, 1, cc[0], cc[1] - r * 0.2, r * 1.1);
        g.addColorStop(0, shade(capH ? capC : body, 1.3)); g.addColorStop(1, shade(capH ? capC : body, 0.9));
        c.fillStyle = g; c.fill();
        extra = [[cc[0], cc[1] - r]];
      } else if (arch === 'block' && pxLot >= 22 && h > 12) {
        const w = x1 - x0, d = y1 - y0;
        box(c, x0 + w * 0.56, y0 + d * 0.18, x0 + w * 0.82, y0 + d * 0.44, z1, z1 + 3.5, shade(capH ? capC : body, 0.85), { flat: true });
        topZ = z1 + 3.5;
      }
    }
    c.globalAlpha = 1;
    const hl = boxHull(x0, y0, x1, y1, z0, topZ);
    if (extra.length) hl.push(...extra);
    const outline = extra.length ? hull(hl) : hl;
    if (after && isSel(l)) { path(c, outline); c.strokeStyle = PAL.ink; c.lineWidth = 2.4; c.stroke(); }
    else if (after && isHov(l)) { path(c, outline); c.strokeStyle = PAL.accent; c.lineWidth = 2; c.stroke(); }
    else if (after && st === 'out') { path(c, outline); c.strokeStyle = rgba(PAL.out, PAL.dark ? 0.9 : 0.55); c.lineWidth = 1; c.stroke(); }
    else if (after && f.status === 'added' && st !== 'none') { path(c, outline); c.setLineDash([5, 3]); c.strokeStyle = PAL.ink; c.lineWidth = 1.2; c.stroke(); c.setLineDash([]); }
    else if (!after && f.status !== 'unchanged') { path(c, outline); c.setLineDash([3, 3]); c.strokeStyle = rgba(PAL.accent, 0.9); c.lineWidth = 1.3; c.stroke(); c.setLineDash([]); }
    if (isEnv(f) && st !== 'none') { path(c, outline); c.strokeStyle = PAL.merged; c.lineWidth = 1.6; c.stroke(); }
    hits.push({ path: f.path, poly: outline });
  }

  function drawMass(c, p, ls, g, side, hits) {
    // l.h already steps back in a large repository with Changes only, so the mass keeps the average of what is drawn.
    const h = (ls.reduce((a, l) => a + (side === 'after' ? l.h : M.heightOf(l.f, 'before')), 0) / ls.length) * 0.85;
    const r = [p.gx + 0.08, p.gy + 0.08, p.gx + p.w - 0.08, p.gy + p.h - 0.08];
    c.globalAlpha = state.layers.focus ? 0.6 : 0.9;
    box(c, ...r, g.z + g.t + 2, g.z + g.t + 2 + Math.max(2, h), PAL.bld, { flat: true, rim: rgba('#ffffff', PAL.dark ? 0.1 : 0.6) });
    c.globalAlpha = 1;
    hits.push({ mass: p, g, poly: boxHull(...r, g.z + g.t + 2, g.z + g.t + 2 + Math.max(2, h)) });
  }

  function fenceSegs(g) {
    const o = 0.28, x0 = g.x - o, y0 = g.y - o, x1 = g.x + g.w + o, y1 = g.y + g.d + o, segs = [];
    for (const [ax, ay, bx, by] of [[x0, y0, x1, y0], [x1, y0, x1, y1], [x0, y1, x1, y1], [x0, y0, x0, y1]]) {
      const n = Math.max(2, Math.ceil(Math.hypot(bx - ax, by - ay) / 0.7));
      for (let i = 0; i < n; i++) segs.push({ ax: ax + ((bx - ax) * i) / n, ay: ay + ((by - ay) * i) / n, bx: ax + ((bx - ax) * (i + 1)) / n, by: ay + ((by - ay) * (i + 1)) / n, z: g.z + g.t });
    }
    return segs;
  }
  function drawFence(c, s) {
    const FH = 10, ok = confirmed() && !state.edit, alarm = performance.now() - state.alarmT < 1300;
    const col = alarm ? PAL.out : PAL.accent;
    const a0 = P(s.ax, s.ay, s.z), a1 = P(s.ax, s.ay, s.z + FH), b0 = P(s.bx, s.by, s.z), b1 = P(s.bx, s.by, s.z + FH), am = P(s.ax, s.ay, s.z + FH / 2), bm = P(s.bx, s.by, s.z + FH / 2);
    c.save();
    c.strokeStyle = rgba(col, ok ? 0.95 : 0.7); c.lineWidth = Math.max(1.1, 1.7 * Math.min(cam.k, 1.5)); c.lineCap = 'round';
    if (ok && !flat) { c.shadowColor = rgba(col, 0.5); c.shadowBlur = 6; }
    if (!ok) c.setLineDash([3, 3]);
    c.beginPath(); c.moveTo(...a1); c.lineTo(...b1); c.moveTo(...am); c.lineTo(...bm); c.stroke();
    c.setLineDash([]);
    c.beginPath(); c.moveTo(...a0); c.lineTo(...a1); c.stroke();
    c.restore();
  }

  function drawScene(buf, side) {
    const c = buf.getContext('2d');
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    c.clearRect(0, 0, W, H);
    const hits = [];
    if (side === 'after') groupHits = [];
    drawSky(c);
    drawCityGround(c);
    const lod = pxLot < lodPx;
    const list = [];
    for (const g of S.groups) {
      list.push({ o: g.order, d: -1e9, g });
      for (const p of g.parcels) {
        const ls = lotsOfParcel.get(p) ?? [];
        if (lod && ls.length > 2 && ls.every((l) => interest(l.f) === 0 && !isSel(l) && !isHov(l) && !state.commit?.paths.has(l.f.path))) list.push({ o: g.order, d: depthOf(p.gx + p.w / 2, p.gy + p.h / 2), mass: p, ls, g });
        else for (const l of ls) list.push({ o: g.order, d: depthOf((l.x0 + l.x1) / 2, (l.y0 + l.y1) / 2), l });
      }
      if (g.fenced) for (const s of fenceSegs(g)) list.push({ o: g.order, d: depthOf((s.ax + s.bx) / 2, (s.ay + s.by) / 2) + 0.02, s });
    }
    list.sort((a, b) => a.o - b.o || a.d - b.d);
    for (const it of list) {
      if (it.g && !it.mass && !it.l) drawPlate(c, it.g, side);
      else if (it.mass) drawMass(c, it.mass, it.ls, it.g, side, hits);
      else if (it.s) drawFence(c, it.s);
      else {
        const l = it.l, [x, y] = P((l.x0 + l.x1) / 2, (l.y0 + l.y1) / 2, l.z0);
        if (x < -90 || x > W + 90 || y < -30 || y - 140 * cam.k > H) continue;
        drawLot(c, l, side, hits);
      }
    }
    if (side === 'after') hitsA = hits; else hitsB = hits;
  }

  // ---------------------------------------------------------------- overlay: arcs, beams, pins, labels, lens
  const topIso = (l) => iso((l.x0 + l.x1) / 2, (l.y0 + l.y1) / 2, l.z0 + l.h + (archOf(l) === 'tower' && l.h > 26 ? 8 : 0));
  const baseIso = (l) => iso((l.x0 + l.x1) / 2, (l.y0 + l.y1) / 2, l.z0);
  /** Route from a to b in iso space: an arc. */
  function route(la, lb) {
    const a = topIso(la), b = topIso(lb);
    const lift = 30 + Math.hypot(b[0] - a[0], b[1] - a[1]) * 0.22;
    return [quadSeg(a, [(a[0] + b[0]) / 2, Math.min(a[1], b[1]) - lift], b)];
  }
  function strokeSegs(c, segs) {
    const s = segs.map((q) => q.map(scr));
    c.beginPath(); c.moveTo(...s[0][0]);
    for (const q of s) c.bezierCurveTo(...q[1], ...q[2], ...q[3]);
    c.stroke();
    return s;
  }
  function arrow(c, s, color, size = 7) {
    const q = s.at(-1), [x, y] = q[3], [px, py] = q[2][0] === x && q[2][1] === y ? q[1] : q[2], ang = Math.atan2(y - py, x - px);
    c.save(); c.translate(x, y); c.rotate(ang);
    c.beginPath(); c.moveTo(0, 0); c.lineTo(-size, -size * 0.55); c.lineTo(-size, size * 0.55); c.closePath();
    c.fillStyle = color; c.fill(); c.restore();
  }

  let needTick = false;
  const bundleTags = [];
  function drawArcs(c, t) {
    bundleTags.length = 0;
    if (!state.layers.ripple) return;
    const edges = [];
    for (const l of S.lots) {
      if (M.stateOf(l.f) !== 'affected') continue;
      for (const cp of l.f.causes || []) { const cl = lotOf.get(cp); if (cl && M.reached(M.byPath.get(cp)) && M.st.decisions[cp] !== 'revert') edges.push({ from: cp, to: l.f.path }); }
    }
    if (!edges.length) return;
    const sel = state.selected;
    const busy = edges.length > 24;
    for (const e of bundleEdges(edges, (p) => lotOf.get(p).g.id, sel)) {
      const la = lotOf.get(e.from);
      const target = e.count === 1 ? e.to : e.tos.reduce((best, p) => (lotOf.get(p).h > lotOf.get(best).h ? p : best), e.tos[0]);
      const lb = lotOf.get(target);
      const hot = sel && (sel === e.from || sel === e.to || (e.tos ?? []).includes(sel));
      const dim = sel && !hot;
      const segs = route(la, lb);
      c.save();
      c.globalAlpha = dim ? 0.14 : busy && !hot ? (edges.length > 60 ? 0.32 : 0.5) : 0.95;
      c.strokeStyle = PAL.aff;
      c.lineWidth = e.count > 1 ? Math.min(8, 2 + Math.log2(e.count) * 1.5) : hot ? 2.6 : 1.8;
      c.setLineDash(e.count > 1 ? [3, 6] : [5, 5]);
      if (motion) { c.lineDashOffset = -(t / 45) % 10; needTick = true; }
      const s = strokeSegs(c, segs);
      c.setLineDash([]);
      arrow(c, s, PAL.aff, e.count > 1 ? 9 : 7);
      if (motion && !dim && (hot || !busy)) {
        const [qx, qy] = along(s, ((t / 1500) + (e.from.length % 7) / 7) % 1);
        c.shadowColor = PAL.aff; c.shadowBlur = 8; c.beginPath(); c.arc(qx, qy, hot ? 3.2 : 2.5, 0, Math.PI * 2); c.fillStyle = PAL.aff; c.fill();
      }
      c.restore();
      if (e.count > 1 && !dim && (hot || edges.length <= 60)) bundleTags.push({ at: along(s, 0.5), count: e.count });
    }
  }
  function drawLinks(c) {
    const l = state.selected && lotOf.get(state.selected);
    if (!l) return;
    const draw = (from, to, cls) => {
      const la = lotOf.get(from), lb = lotOf.get(to);
      if (!la || !lb) return;
      c.save();
      c.strokeStyle = cls === 'out' ? PAL.accent : PAL.merged; c.lineWidth = 1.6; c.globalAlpha = 0.85;
      if (cls === 'in') c.setLineDash([5, 4]);
      const s = strokeSegs(c, route(la, lb));
      c.setLineDash([]);
      arrow(c, s, cls === 'out' ? PAL.accent : PAL.merged, 6);
      c.restore();
    };
    for (const p of (imports.get(l.f.path) ?? []).slice(0, 40)) draw(l.f.path, p, 'out');
    for (const p of (l.f.importedBy ?? []).slice(0, 40)) draw(p, l.f.path, 'in');
  }
  const riskColor = (r) => (r === 'low' ? PAL['ink-3'] : r === 'medium' ? mix(PAL.out, PAL.aff, 0.5) : PAL.out);
  function mapPin(c, x, y, color, glyph) {
    const r = 9, cy = y - r * 1.9;
    const shape = () => { c.beginPath(); c.arc(x, cy, r, Math.PI * 0.82, Math.PI * 2.18); c.lineTo(x, y); c.closePath(); };
    c.save(); if (motion) { c.shadowColor = rgba(color, 0.55); c.shadowBlur = 10; } shape(); c.fillStyle = color; c.fill(); c.restore();
    shape(); c.strokeStyle = '#fff'; c.lineWidth = 1.5; c.stroke();
    c.fillStyle = '#fff'; c.font = `700 11px ${PAL.font}`; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText(glyph, x, cy + 0.5);
  }
  function drawBeamsAndPins(c, t, Cl) {
    const pinned = [];
    for (const l of S.lots) {
      const st = M.stateOf(l.f);
      if (!['out', 'in', 'approved'].includes(st) || l.h < 1 || !M.exists(l.f, 'after')) continue;
      const [x, y] = scr(topIso(l));
      if (x < -40 || x > W + 40 || y < -60 || y > H + 60) continue;
      const risk = M.riskOf(l.f);
      if (st === 'out') {
        if (risk !== 'low' && (!state.commit || state.commit.paths.has(l.f.path))) {
          const hgt = 70 + 40 * Math.min(1, cam.k), wd = Math.max(8, (l.x1 - l.x0) * CX * 1.1 * cam.k);
          const pulse = motion ? 0.75 + 0.25 * Math.sin(t / 480 + l.x0) : 1;
          const g = c.createLinearGradient(x, y, x, y - hgt);
          g.addColorStop(0, rgba(PAL.out, 0.34 * pulse)); g.addColorStop(1, rgba(PAL.out, 0));
          c.fillStyle = g;
          c.beginPath(); c.moveTo(x - wd / 2, y); c.lineTo(x + wd / 2, y); c.lineTo(x + wd * 0.3, y - hgt); c.lineTo(x - wd * 0.3, y - hgt); c.closePath(); c.fill();
          if (motion) needTick = true;
        }
        const bob = motion ? Math.sin(t / 300 + l.x0 * 3) * 2 : 0;
        mapPin(c, x, y - 4 - bob, riskColor(risk), '!');
        Cl.add(x - 11, y - 34, 22, 30);
      } else {
        c.beginPath(); c.arc(x, y - 12, 8, 0, Math.PI * 2);
        c.fillStyle = st === 'approved' ? PAL.ok : PAL.in; c.fill();
        c.strokeStyle = '#fff'; c.lineWidth = 1.3; c.stroke();
        c.fillStyle = '#fff'; c.font = `700 10px ${PAL.font}`; c.textAlign = 'center'; c.textBaseline = 'middle';
        c.fillText(st === 'approved' ? '✓' : String(l.f.step ?? ''), x, y - 11.5);
        Cl.add(x - 9, y - 21, 18, 18);
      }
      pinned.push({ l, st, x, y });
    }
    return pinned;
  }
  function drawSelectionScan(c, t) {
    const l = state.selected && lotOf.get(state.selected);
    if (!l || !motion || l.h < 2) return;
    const p = (t / 1600) % 1, z = l.z0 + l.h * p;
    c.save();
    path(c, quadAt(l.x0 - 0.04, l.y0 - 0.04, l.x1 + 0.04, l.y1 + 0.04, z));
    c.strokeStyle = rgba(PAL.accent, 0.85 * (1 - p * 0.6)); c.lineWidth = 1.6; c.shadowColor = PAL.accent; c.shadowBlur = 8; c.stroke();
    c.restore();
    needTick = true;
  }
  function drawFx(c, t) {
    const now = performance.now();
    state.fx = state.fx.filter((f) => now - f.t0 < f.dur);
    for (const f of state.fx) {
      const p = (now - f.t0) / f.dur;
      const [x, y] = scr(f.at), rx = U * cam.k * (f.r0 + p * f.r1);
      c.beginPath(); c.ellipse(x, y, rx, rx * (CY / CX), 0, 0, Math.PI * 2);
      c.strokeStyle = rgba(f.color, 0.85 * (1 - p)); c.lineWidth = 3 * (1 - p) + 1; c.stroke();
    }
    if (state.fx.length) needTick = true;
    const sp = (now - state.scanT) / 1600;
    if (sp >= 0 && sp < 1) {
      const b = sceneBox(), y0 = cam.y + b.y0 * cam.k, y1 = cam.y + b.y1 * cam.k, y = y0 + (y1 - y0) * sp;
      const g = c.createLinearGradient(0, y - 60, 0, y);
      g.addColorStop(0, rgba(PAL.accent, 0)); g.addColorStop(1, rgba(PAL.accent, 0.16));
      c.fillStyle = g; c.fillRect(0, y - 60, W, 60);
      c.save(); c.strokeStyle = rgba(PAL.accent, 0.9); c.lineWidth = 2; c.shadowColor = PAL.accent; c.shadowBlur = 12;
      c.beginPath(); c.moveTo(0, y); c.lineTo(W, y); c.stroke(); c.restore();
      needTick = true;
    }
    const ap = (now - state.alarmT) / 1300;
    if (ap >= 0 && ap < 1) {
      const a = Math.abs(Math.sin(ap * Math.PI * 3)) * 0.22;
      const g = c.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.3, W / 2, H / 2, Math.max(W, H) * 0.7);
      g.addColorStop(0, rgba(PAL.out, 0)); g.addColorStop(1, rgba(PAL.out, a));
      c.fillStyle = g; c.fillRect(0, 0, W, H);
      needTick = true;
    }
  }

  // Pills in screen space.
  const widths = new Map();
  function pill(c, Cl, x, y, text, sty, { h = 20, size = 11, leader = null, anchor = 'middle' } = {}) {
    const font = `${sty.bold ? 700 : 600} ${size}px ${PAL.font}`;
    const k = font + text;
    let w = widths.get(k);
    if (w == null) { c.font = font; w = c.measureText(text).width + 16; widths.set(k, w); }
    const x0 = anchor === 'middle' ? x - w / 2 : anchor === 'end' ? x - w : x;
    if (Cl && !Cl.free(x0, y - h / 2, w, h)) return false;
    c.save();
    if (leader) { c.strokeStyle = sty.border ?? PAL['ink-3']; c.lineWidth = 1; c.beginPath(); c.moveTo(...leader); c.lineTo(x, y + h / 2); c.stroke(); }
    c.shadowColor = 'rgba(0,0,0,.16)'; c.shadowBlur = 6; c.shadowOffsetY = 1;
    c.beginPath(); c.roundRect(x0, y - h / 2, w, h, h / 2);
    c.fillStyle = sty.bg; c.fill();
    c.shadowColor = 'transparent';
    if (sty.border) { c.strokeStyle = sty.border; c.lineWidth = sty.bw ?? 1; if (sty.dash) c.setLineDash([3, 2]); c.stroke(); c.setLineDash([]); }
    c.fillStyle = sty.fg; c.font = font; c.textAlign = 'center'; c.textBaseline = 'middle';
    c.fillText(text, x0 + w / 2, y + 0.5);
    c.restore();
    return true;
  }
  const STY = () => ({
    block: { bg: rgba(PAL.surface, 0.94), fg: PAL['ink-2'], border: PAL.line },
    busy: { bg: rgba(PAL.surface, 0.97), fg: PAL.ink, border: PAL.line, bold: true },
    hasOut: { bg: rgba(PAL.surface, 0.97), fg: PAL.ink, border: PAL.out, bw: 1.6, bold: true },
    fenced: { bg: PAL.accent, fg: '#fff', border: PAL.accent, bold: true },
    fence: { bg: PAL.surface, fg: PAL.accent, border: PAL.accent, bw: 1.8, bold: true },
    out: { bg: PAL.out, fg: '#fff', border: PAL.out, bold: true },
    in: { bg: PAL.surface, fg: PAL.in, border: PAL.in, bw: 1.4 },
    approved: { bg: PAL.surface, fg: PAL.ok, border: PAL.ok, bw: 1.4 },
    affected: { bg: PAL.surface, fg: mix(PAL.aff, PAL.ink, 0.35), border: PAL.aff, dash: true, bw: 1.3 },
    none: { bg: PAL.surface, fg: PAL.ink, border: PAL.line },
    sel: { bg: PAL.ink, fg: PAL.surface, border: PAL.ink, bold: true },
    bundle: { bg: PAL.aff, fg: '#fff', bold: true },
    parcel: { bg: rgba(PAL.surface, 0.85), fg: PAL['ink-3'] },
    bob: { bg: PAL.ink, fg: PAL.bg, bold: true },
    other: { bg: PAL.surface, fg: PAL.merged, border: PAL.merged, bw: 1.4 }, // a file of the commit on screen the task did not change
    both: { bg: PAL.merged, fg: '#fff', border: PAL.merged, bold: true },
  });

  function drawLabels(c, pinned, Cl) {
    const sty = STY(), k = cam.k;
    for (const b of bundleTags) pill(c, Cl, b.at[0], b.at[1] - 12, `×${b.count}`, sty.bundle, { h: 20, size: 11.5 });
    if (!state.layers.labels) return;
    // The fence tag, once, over the requested area.
    const fenced = S.groups.filter((g) => g.fenced);
    if (fenced.length) {
      const g = fenced[0];
      const tallest = Math.max(10, ...g.lots.map((l) => l.h));
      const spots = [[g.x, g.y, g.z + g.t + tallest + 26], [g.x + g.w, g.y, g.z + g.t + 30], [g.x, g.y + g.d, g.z + g.t + 30]].map((q) => P(...q)).sort((a, b) => a[1] - b[1]);
      const word = state.edit ? 'EDITING AREA' : confirmed() ? 'REQUESTED AREA' : 'PROPOSED FENCE';
      for (const [x, y] of spots) if (pill(c, Cl, x, y, word, sty.fence, { h: 24, size: 11.5 })) break;
    }
    // Names of changed files, the most important first.
    const fileTags = () => {
      const cm = state.commit;
      let named = pinned.slice();
      for (const l of S.lots) {
        const st = M.stateOf(l.f);
        if ((st === 'affected' || isSel(l)) && !named.some((n) => n.l === l) && l.h > 0.5) { const [x, y] = scr(topIso(l)); named.push({ l, st, x, y }); }
      }
      // With a commit on screen, name only what it touched and what it newly reaches: also files this task never
      // changed (another branch's commit, a merge), which have no pin of their own.
      if (cm) for (const p of [...cm.paths, ...cm.aff]) { const l = lotOf.get(p); if (l && !named.some((n) => n.l === l) && l.h > 0.5) { const [x, y] = scr(topIso(l)); named.push({ l, st: M.stateOf(l.f), x, y }); } }
      if (cm) named = named.filter((n) => cm.paths.has(n.l.f.path) || cm.aff.has(n.l.f.path) || isSel(n.l));
      const rank = { out: 0, in: 1, approved: 1, affected: 2, none: 3, reverted: 3 };
      named.sort((a, b) => (isSel(a.l) ? -1 : isSel(b.l) ? 1 : cm ? Number(cm.aff.has(a.l.f.path)) - Number(cm.aff.has(b.l.f.path)) || rank[a.st] - rank[b.st] : rank[a.st] - rank[b.st]));
      for (const n of named) {
        if (k < 0.35 && !isSel(n.l) && n.st !== 'out' && !cm) continue; // zoomed far out only the worst are named, except in a commit
        if (n.x < -60 || n.x > W + 60 || n.y < -40 || n.y > H + 40) continue;
        const cs = cm?.stats[n.l.f.path];
        const lift = n.st === 'out' ? 52 : 38, st = isSel(n.l) ? sty.sel : cm && n.st === 'none' ? (cm.aff.has(n.l.f.path) ? sty.both : sty.other) : sty[n.st] ?? sty.none;
        const name = clipMid(n.l.f.name, 24) + (cs ? `  +${cs.plus} −${cs.minus}` : cm?.aff.has(n.l.f.path) ? `  ${cm.affLabel}` : '');
        // Above the building first; beside it when that spot is taken.
        const above = [n.x, n.y - lift, 'middle'], right = [n.x + 14, n.y - 16, 'start'], left = [n.x - 14, n.y - 16, 'end'];
        const tries = [above, right, left, [n.x, n.y - lift - 22, 'middle']];
        for (const [x, y, anchor] of tries) if (pill(c, Cl, x, y, name, st, { h: 20, size: 11.5, anchor, leader: anchor === 'middle' ? [n.x, n.y - (n.st === 'out' ? 30 : 20)] : null })) break;
      }
    };
    // Folder names on the street in front of each block.
    const folderTags = () => {
      const cm = state.commit;
      const order = [...S.groups].sort((a, b) => Number(b.fenced) - Number(a.fenced) || b.score - a.score || b.lots.length - a.lots.length);
      for (const g of order) {
        const outN = g.lots.filter((l) => M.stateOf(l.f) === 'out').length;
        const inN = g.lots.filter((l) => ['in', 'approved'].includes(M.stateOf(l.f))).length;
        const affN = g.lots.filter((l) => M.stateOf(l.f) === 'affected').length;
        const cmN = cm ? g.lots.filter((l) => cm.paths.has(l.f.path)).length : 0;
        const what = cm ? (cmN ? ` · ${cmN} ${cm.countLabel}` : '') : outN ? ` · ${outN} outside` : inN ? ` · ${inN} inside` : affN ? ` · ${affN} affected` : k > 0.5 ? ` · ${g.lots.length}` : '';
        const label = `${clipMid(g.name, 22)}${what}`;
        const z = g.z + g.t;
        const mids = [[g.x + g.w / 2, g.y - 0.6], [g.x + g.w + 0.6, g.y + g.d / 2], [g.x + g.w / 2, g.y + g.d + 0.6], [g.x - 0.6, g.y + g.d / 2]].map((m) => P(m[0], m[1], z)).sort((a, b) => b[1] - a[1]);
        const s = cm ? (cmN ? sty.busy : sty.block) : g.fenced ? sty.fenced : outN ? sty.hasOut : g.score ? sty.busy : sty.block;
        for (const [x, y] of mids) if (pill(c, Cl, x, y + 4, label, s, { h: 24, size: 12 })) break;
      }
    };
    // Files first; the street has room for folders after them.
    fileTags(); folderTags();
    // Sub-folder names when zoomed in far enough to matter.
    if (k > 0.9) {
      for (const g of S.groups) for (const p of g.parcels) {
        if (!p.dir) continue;
        const [x, y] = P(p.gx + p.w / 2, p.gy + p.h + 0.15, g.z + g.t + 2);
        pill(c, Cl, x, y + 8, clipMid(p.dir, 22), sty.parcel, { h: 16, size: 10 });
      }
    }
  }

  function drawLens(c) {
    const L = state.lens;
    if (!L.on || !L.in) return;
    const R0 = Math.max(70, Math.min(120, W * 0.1)), x = L.x, y = L.y;
    c.save();
    c.beginPath(); c.arc(x, y, R0, 0, Math.PI * 2); c.clip();
    c.setTransform(1, 0, 0, 1, 0, 0); c.drawImage(bufB, 0, 0); c.setTransform(dpr, 0, 0, dpr, 0, 0);
    c.fillStyle = PAL.dark ? 'rgba(255,230,180,.05)' : 'rgba(160,120,40,.07)'; c.fillRect(x - R0, y - R0, R0 * 2, R0 * 2);
    c.restore();
    c.save(); c.beginPath(); c.arc(x, y, R0, 0, Math.PI * 2); c.lineWidth = 5; c.strokeStyle = PAL.ink; c.shadowColor = 'rgba(0,0,0,.3)'; c.shadowBlur = 14; c.stroke(); c.restore();
    c.beginPath(); c.arc(x, y, R0 - 4, Math.PI * 1.1, Math.PI * 1.45); c.strokeStyle = 'rgba(255,255,255,.7)'; c.lineWidth = 2; c.stroke();
    const hx = x + R0 * 0.72, hy = y + R0 * 0.72;
    c.beginPath(); c.moveTo(hx, hy); c.lineTo(hx + R0 * 0.36, hy + R0 * 0.36); c.lineWidth = 9; c.lineCap = 'round'; c.strokeStyle = PAL.ink; c.stroke(); c.lineCap = 'butt';
    pill(c, null, x, y - R0 - 4, `BEFORE · ${String(city.meta?.base ?? '').slice(0, 7)}`, STY().bob, { h: 20, size: 10.5 });
  }

  function drawDivider(c) {
    if (state.mode !== 'compare') return;
    const x = W * state.split;
    c.fillStyle = PAL.ink; c.fillRect(x - 1, 0, 2, H);
    c.beginPath(); c.arc(x, H / 2, 16, 0, Math.PI * 2); c.fillStyle = PAL.surface; c.fill(); c.strokeStyle = PAL.ink; c.lineWidth = 2; c.stroke();
    c.beginPath(); c.moveTo(x - 5, H / 2 - 5); c.lineTo(x - 10, H / 2); c.lineTo(x - 5, H / 2 + 5); c.moveTo(x + 5, H / 2 - 5); c.lineTo(x + 10, H / 2); c.lineTo(x + 5, H / 2 + 5); c.stroke();
    c.font = `700 11px ${PAL.font}`; c.fillStyle = PAL['ink-2']; c.textBaseline = 'middle';
    c.textAlign = 'right'; c.fillText('BEFORE', x - 14, insetTop() + 18);
    c.textAlign = 'left'; c.fillText('AFTER', x + 14, insetTop() + 18);
  }

  // ---------------------------------------------------------------- replay: Bob flies from commit to commit
  const rp = { active: false, from: null, to: null, t0: 0, out: false, soFar: 0, last: 0 };
  function replayStep(n) {
    const s = city.steps[n];
    if (!s || n === 0) return replayReset();
    if (n <= rp.last) rp.soFar = city.steps.slice(1, n + 1).filter((x) => x.outside).length;
    else if (s.outside) rp.soFar++;
    rp.last = n;
    const paths = (s.files ?? []).filter((p) => lotOf.has(p));
    // A replay frames every file the task touches once, then holds the camera still: the commits light up in
    // place instead of the view zooming in and out on each one. It only moves if a commit's files are off screen.
    if (!rp.active) {
      const all = [...new Set(city.steps.flatMap((x) => x.files ?? []))].filter((p) => lotOf.has(p));
      if (all.length) focusPaths(all, true);
    } else if (paths.length && paths.some((p) => { const [x, y] = scr(topIso(lotOf.get(p))); return x < 30 || x > W - 30 || y < insetTop() + 20 || y > H - insetBottom() - 20; })) {
      focusPaths(paths, true);
    }
    if (!paths.length) { rp.active = true; return; }
    const now = performance.now();
    for (const p of paths) state.fx.push({ at: baseIso(lotOf.get(p)), t0: now, dur: 1400, r0: 0.5, r1: 2.6, color: s.outside ? PAL.out : PAL.in });
    if (s.outside) state.alarmT = now;
    const target = lotOf.get(paths[0]);
    const tIso = topIso(target);
    rp.from = rp.to ? topIso(rp.to) : [tIso[0], tIso[1] - 160];
    rp.to = target; rp.t0 = now; rp.out = !!s.outside; rp.active = true;
    if (handlers.replayCard !== false) {
      card.className = `replay-card ${s.outside ? 'out' : 'in'}`;
      card.innerHTML = commitCardHtml(city, n, paths, rp.soFar);
    }
    kick();
  }
  function replayReset() { Object.assign(rp, { active: false, from: null, to: null, soFar: 0, last: 0 }); card.className = 'replay-card hidden'; }

  // ---------------------------------------------------------------- frame loop
  let raf = 0, last = 0, dirty = true, alive = true;
  function kick() { if (!raf && alive) raf = requestAnimationFrame(frame); }
  function step(dt) {
    let moved = false;
    const kc = motion ? Math.min(1, dt * 7) : 1;
    camMoving = false;
    for (const q of ['k', 'x', 'y']) {
      const d = tgt[q] - cam[q];
      if (Math.abs(d) > (q === 'k' ? 1e-4 : 0.05)) { cam[q] += d * kc; moved = camMoving = true; } else cam[q] = tgt[q];
    }
    if (!orbiting && rot !== rotT) {
      const d = rotT - rot;
      if (Math.abs(d) > 1e-3 && motion) rot += d * Math.min(1, dt * 4); else rot = rotT;
      moved = camMoving = true;
    }
    turn();
    const now = performance.now(), kh = motion ? Math.min(1, dt * 7) : 1;
    for (const l of S.lots) {
      const th = targetH(l, now), ta = targetA(l);
      if (Math.abs(th - l.h) > 0.15) { l.h += (th - l.h) * kh; moved = true; } else l.h = th;
      if (Math.abs(ta - l.a) > 0.01) { l.a += (ta - l.a) * kh; moved = true; } else l.a = ta;
    }
    if (introT0 && now > introT0 + 1400) introT0 = 0;
    else if (introT0) moved = true;
    return moved;
  }
  function frame(t) {
    raf = 0;
    if (!alive || !W) return;
    const dt = last ? Math.min(0.05, (t - last) / 1000) : 1 / 60;
    last = t;
    const moved = step(dt);
    if (moved) dirty = true;
    needTick = false;
    if (dirty) {
      pxLot = U * cam.k;
      flat = pxLot < 16 || (camMoving && S.lots.length > 700);
      const g = S.ground, ds = [[g.x0, g.y0], [g.x1, g.y0], [g.x1, g.y1], [g.x0, g.y1]].map(([x, y]) => depthOf(x, y));
      haze = { d0: Math.min(...ds), span: Math.max(1e-6, Math.max(...ds) - Math.min(...ds)), sky: PAL['city-bg'] };
      drawScene(bufA, 'after');
      if (state.mode !== 'after' || state.lens.on) drawScene(bufB, 'before');
      dirty = false;
    }
    composite(t);
    if (moved || needTick || introT0) kick(); else last = 0;
  }
  const splitX = () => (state.mode === 'compare' ? W * state.split : state.mode === 'before' ? W : 0);
  function composite(t) {
    const c = ctx;
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.clearRect(0, 0, cv.width, cv.height);
    const sx = splitX() * dpr;
    if (sx > 0) { c.save(); c.beginPath(); c.rect(0, 0, sx, cv.height); c.clip(); c.drawImage(bufB, 0, 0); c.restore(); }
    if (sx < cv.width) { c.save(); c.beginPath(); c.rect(sx, 0, cv.width - sx, cv.height); c.clip(); c.drawImage(bufA, 0, 0); c.restore(); }
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    const Cl = collider();
    c.save();
    c.beginPath(); c.rect(splitX(), 0, W, H); c.clip();
    drawArcs(c, t);
    drawLinks(c);
    drawSelectionScan(c, t);
    const pinned = drawBeamsAndPins(c, t, Cl);
    drawFx(c, t);
    c.restore();
    drawLabels(c, state.mode === 'before' ? [] : pinned, Cl);
    drawDivider(c);
    drawLens(c);
  }

  // ---------------------------------------------------------------- input
  const local = (e) => { const r = cv.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
  function hitAt(sx, sy) {
    const hits = sx < splitX() ? hitsB : hitsA;
    for (let i = hits.length - 1; i >= 0; i--) if (inPoly(hits[i].poly, sx, sy)) return hits[i];
    return null;
  }
  function groupAt(sx, sy) {
    const h = hitAt(sx, sy);
    if (h) return h.g ?? lotOf.get(h.path)?.g ?? null;
    for (let i = groupHits.length - 1; i >= 0; i--) if (inPoly(groupHits[i].poly, sx, sy)) return groupHits[i].g;
    return null;
  }
  const pointers = new Map();
  let drag = null, pinch = null;
  function onDown(e) {
    const [sx, sy] = local(e);
    pointers.set(e.pointerId, [sx, sy]);
    try { cv.setPointerCapture(e.pointerId); } catch { /* not an active pointer */ }
    if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      pinch = { d: Math.hypot(a[0] - b[0], a[1] - b[1]), k: tgt.k };
      drag = null;
      return;
    }
    drag = { sx, sy, x: cam.x, y: cam.y, rot, moved: false, orbit: (e.shiftKey || e.button === 2), split: state.mode === 'compare' && Math.abs(sx - W * state.split) < 22 };
  }
  function onMove(e) {
    const [sx, sy] = local(e);
    if (pointers.has(e.pointerId)) pointers.set(e.pointerId, [sx, sy]);
    if (pinch && pointers.size === 2) {
      const [a, b] = [...pointers.values()], d = Math.hypot(a[0] - b[0], a[1] - b[1]);
      const f = (pinch.k * (d / pinch.d)) / tgt.k;
      zoomAt((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, f);
      Object.assign(cam, tgt);
      return;
    }
    state.lens.x = sx; state.lens.y = sy; state.lens.in = true;
    if (drag) {
      const dx = sx - drag.sx, dy = sy - drag.sy;
      if (Math.hypot(dx, dy) > 3) drag.moved = true;
      if (drag.split) { state.split = Math.min(0.97, Math.max(0.03, sx / W)); kick(); }
      else if (drag.orbit && drag.moved) { orbiting = true; rot = rotT = drag.rot + dx * 0.008; dirty = true; kick(); }
      else if (drag.moved) { touched = true; cam.x = tgt.x = drag.x + dx; cam.y = tgt.y = drag.y + dy; dirty = true; kick(); }
      tip.classList.add('hidden');
      return;
    }
    if (state.lens.on) { tip.classList.add('hidden'); kick(); return; }
    let html = '', target = null;
    if (state.edit) {
      const g = groupAt(sx, sy);
      if (g !== state.hoverGroup) { state.hoverGroup = g; dirty = true; kick(); }
      if (g) html = `<b>${esc(g.id === './' ? 'project files' : g.id)}</b><span>${g.fenced ? 'In the requested area · click to remove' : 'Outside the requested area · click to add'}</span>`;
      target = g;
    } else {
      const h = hitAt(sx, sy);
      const hp = h?.path ?? null;
      if (hp !== state.hoverHit) { state.hoverHit = hp; dirty = true; kick(); }
      if (h?.mass) html = `<b>${esc(h.g.id + (h.mass.dir || ''))}</b><span>${h.mass.files.length} unchanged files, folded · click to open</span>`;
      else if (h) {
        const l = lotOf.get(h.path), f = l.f, side = sx < splitX() ? 'before' : 'after';
        html = (handlers.tooltip ? handlers.tooltip(f, side === 'before' ? 'base' : M.stateOf(f)) : esc(f.path)) +
          `<span>${lines(f.locAfter || f.locBefore || 0)} lines${f.status !== 'unchanged' ? ` · ${Math.round(M.capOf(f) * 100)}% changed` : ''} · ${LAYER[layerOf(f)].name}</span>`;
      }
      target = h;
    }
    if (html) { tip.innerHTML = html; tip.style.left = sx + 'px'; tip.style.top = sy + 'px'; tip.classList.remove('hidden'); } else tip.classList.add('hidden');
    cv.style.cursor = target ? 'pointer' : '';
  }
  function onUp(e) {
    pointers.delete(e.pointerId);
    if (pinch) { if (pointers.size < 2) pinch = null; return; }
    const was = drag;
    drag = null;
    if (orbiting) { orbiting = false; rotT = Math.round(rot / QUARTER) * QUARTER; kick(); }
    if (!was || was.moved || was.split) return;
    const [sx, sy] = local(e);
    if (state.edit) { const g = groupAt(sx, sy); if (g) toggleGroup(g); return; }
    const h = hitAt(sx, sy);
    if (h?.mass) { focusPaths(h.mass.files.map((f) => f.path)); return; }
    handlers.onSelect?.(h?.path ?? null);
  }
  function onLeave() { tip.classList.add('hidden'); state.lens.in = false; if (state.hoverHit || state.hoverGroup) { state.hoverHit = null; state.hoverGroup = null; dirty = true; } kick(); }
  function onWheel(e) { e.preventDefault(); const [sx, sy] = local(e); zoomAt(sx, sy, Math.exp(-e.deltaY * 0.0016)); }
  function onDbl(e) { const [sx, sy] = local(e); zoomAt(sx, sy, 1.8); }
  const onCtx = (e) => e.preventDefault();
  cv.addEventListener('pointerdown', onDown);
  cv.addEventListener('pointermove', onMove);
  cv.addEventListener('pointerup', onUp);
  cv.addEventListener('pointercancel', onUp);
  cv.addEventListener('pointerleave', onLeave);
  cv.addEventListener('wheel', onWheel, { passive: false });
  cv.addEventListener('dblclick', onDbl);
  cv.addEventListener('contextmenu', onCtx);

  function toggleGroup(g) {
    const paths = state.edit.paths;
    const own = g.id === './' ? g.lots.map((l) => l.f.path) : [g.id];
    let next;
    if (g.fenced) {
      next = [];
      for (const p of paths) {
        if (!g.lots.some((l) => inFence(l.f.path, [p]))) { next.push(p); continue; }
        // p covers this folder: keep what it covers elsewhere.
        for (const o of S.groups) {
          if (o === g) continue;
          const covered = o.lots.filter((l) => inFence(l.f.path, [p]));
          if (!covered.length) continue;
          if (covered.length === o.lots.length && o.id !== './') next.push(o.id); else next.push(...covered.map((l) => l.f.path));
        }
      }
    } else next = [...paths, ...own];
    state.edit.paths = [...new Set(next)].sort();
    refreshGroups();
    dirty = true; kick();
    state.edit.onChange?.(state.edit.paths);
  }

  // ---------------------------------------------------------------- theme, size
  const mq = matchMedia('(prefers-color-scheme: dark)');
  const onTheme = () => { PAL = readPalette(); dirty = true; kick(); };
  mq.addEventListener('change', onTheme);
  const themeObs = new MutationObserver(onTheme); // the page's own light/dark switch (data-theme on <html>)
  themeObs.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  function resize() {
    const r = container.getBoundingClientRect();
    if (!r.width || !r.height) return;
    W = r.width; H = r.height; dpr = Math.min(2, window.devicePixelRatio || 1);
    for (const c of [cv, bufA, bufB]) { c.width = Math.round(W * dpr); c.height = Math.round(H * dpr); }
    cv.style.width = W + 'px'; cv.style.height = H + 'px';
    if (!touched) fitTo(homeBox(), FIT_MAX, false);
    dirty = true;
    kick();
  }
  const ro = new ResizeObserver(resize);
  ro.observe(container);
  if (saved) {
    rot = rotT = saved.rot; turn();
    touched = saved.touched;
    resize();
    if (saved.touched) { Object.assign(cam, saved.cam); Object.assign(tgt, saved.cam); }
  } else resize();

  const api = {
    kind: 'map',
    setMode(m) { state.mode = m; dirty = true; kick(); },
    get mode() { return state.mode; },
    setProgress(p, { play = false } = {}) { M.st.progress = p; dirty = true; if (play) replayStep(p); else if (rp.active) replayReset(); kick(); },
    playEnd() { replayReset(); touched = false; fitTo(homeBox(), FIT_MAX); },
    setDecisions(d) { M.st.decisions = d; dirty = true; kick(); },
    setLayers(l) { Object.assign(state.layers, l); dirty = true; kick(); },
    select(p, { zoom = false } = {}) {
      state.selected = p;
      const l = p && lotOf.get(p);
      if (l && motion && (items.get(p)?.ripple?.length || (l.f.importedBy ?? []).some((q) => M.stateOf(M.byPath.get(q) ?? {}) === 'affected'))) {
        state.fx.push({ at: baseIso(l), t0: performance.now(), dur: 2000, r0: 0.5, r1: 6, color: PAL.aff });
      }
      if (zoom && p) focusPaths([p]);
      dirty = true; kick();
    },
    rotate(dir = 1) { rotT = Math.round((rotT + dir * QUARTER) / QUARTER) * QUARTER; kick(); },
    zoomBy: (f) => zoomAt(W / 2, (H + insetTop() - insetBottom()) / 2, f),
    fit: () => fit(),
    screenOf: (p) => { const l = lotOf.get(p); return l ? scr(topIso(l)) : null; },
    hexPx: () => U * 0.6 * cam.k,
    focusPaths: (paths) => focusPaths(paths),
    hover(paths) { state.hover = new Set(paths ?? []); dirty = true; kick(); },
    has: (p) => lotOf.has(p),
    stateOf: (f) => M.stateOf(f),
    toggleLens(on) {
      state.lens.on = on ?? !state.lens.on;
      if (state.lens.on && !state.lens.in) { state.lens.x = W / 2; state.lens.y = H / 2; state.lens.in = true; }
      tip.classList.add('hidden');
      dirty = true; kick();
      return state.lens.on;
    },
    get lensOn() { return state.lens.on; },
    /** Edit the requested area on the map: clicking a block adds or removes it. */
    editFence(paths, onChange) { state.edit = { paths: [...paths], onChange }; refreshGroups(); dirty = true; kick(); },
    endEditFence() { state.edit = null; state.hoverGroup = null; refreshGroups(); tip.classList.add('hidden'); dirty = true; kick(); },
    get editing() { return !!state.edit; },
    /** Recolour with another verdict of the same code (a previewed fence); the layout stays put. */
    preview(next) {
      city = next;
      items = new Map((next.items ?? []).map((it) => [it.file, it]));
      const { progress, decisions } = M.st;
      M = createVerdicts(next, next.files, items);
      M.st.progress = progress; M.st.decisions = decisions;
      const byP = new Map(next.files.map((f) => [f.path, f]));
      for (const l of S.lots) l.f = byP.get(l.f.path) ?? l.f;
      refreshGroups();
      dirty = true; kick();
    },
    /** A sweep of light over the codebase while tests run. */
    scan() { state.scanT = performance.now(); kick(); },
    /** Put one commit in front: what it touched (+/−, the height before it) and what it newly reaches. */
    /** Keep the camera clear of a card on the right edge of the map, or of text laid over its top or bottom. */
    setInsets({ right = insetRightPx, top = insetTopPx, bottom = insetBottomPx } = {}) {
      if (right === insetRightPx && top === insetTopPx && bottom === insetBottomPx) return;
      insetRightPx = right; insetTopPx = top; insetBottomPx = bottom;
      if (!touched) fitTo(homeBox(), FIT_MAX);
    },
    setCommitFocus(cf) {
      state.commit = cf ? { paths: new Set(cf.paths ?? []), aff: new Set(cf.aff ?? []), first: new Set(cf.first ?? []), stats: cf.stats ?? {}, affLabel: cf.affLabel ?? 'now affected', countLabel: cf.countLabel ?? 'in this commit' } : null;
      dirty = true; kick();
    },
    destroy() {
      alive = false;
      cancelAnimationFrame(raf);
      if (!handlers.compact) views.set(key, { cam: { ...tgt }, rot: rotT, touched });
      ro.disconnect();
      mq.removeEventListener('change', onTheme);
      themeObs.disconnect();
      container.replaceChildren();
      container.classList.remove('atlas-wrap');
    },
  };
  return api;
}
