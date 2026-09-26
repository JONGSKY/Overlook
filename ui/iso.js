// iso.js — the shared pieces of the 3D city: units, label collisions, the replay commit card, block packing,
// verdict state (createVerdicts) and edge bundling. atlas3d.js draws with them; map.js lays out with them.

import { clipMid } from './layers.js';

export const U = 30;
export const CX = U * 0.866, CY = U * 0.5;

/** Screen-space label boxes that must not overlap. */
export function collider() {
  const boxes = [];
  return {
    free(x, y, w, h, pad = 2) {
      if (boxes.some((b) => x - pad < b.x + b.w && x + w + pad > b.x && y - pad < b.y + b.h && y + h + pad > b.y)) return false;
      boxes.push({ x, y, w, h });
      return true;
    },
    add(x, y, w, h) { boxes.push({ x, y, w, h }); },
  };
}

const escapeHtml = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

/** The replay card for commit n (1-based): message, +/−, its files, and how many commits left the request so far. */
export function commitCardHtml(city, n, paths, outsideSoFar) {
  const s = city.steps[n];
  const total = Object.values(s.changes ?? {}).reduce((a, c) => [a[0] + (c.plus || 0), a[1] + (c.minus || 0)], [0, 0]);
  const commits = city.steps.length - 2;
  return `<div class="rc-top"><b>Commit ${n}/${commits}</b><span class="rc-lines"><em class="p">+${total[0]}</em> <em class="m">−${total[1]}</em></span></div>
    <div class="rc-msg">${escapeHtml(s.message ?? '')}</div>
    <div class="rc-files">${paths.slice(0, 4).map((p) => `<code>${escapeHtml(clipMid(p.split('/').pop(), 26))}</code>`).join('')}${paths.length > 4 ? `<span>+${paths.length - 4}</span>` : ''}</div>
    <div class="rc-foot">${s.outside ? '<span class="rc-badge out">leaves the requested area</span>' : '<span class="rc-badge in">inside the request</span>'}<span class="rc-count">${outsideSoFar} of ${n} commit${n === 1 ? '' : 's'} outside so far</span></div>`;
}

// ---------------------------------------------------------------------------
// Blocks: a folder's files as parcels (one per real sub-folder) of lots. Shared by city blocks and tree platforms.
// ---------------------------------------------------------------------------
export const FOOT = 0.78; // building footprint inside a 1×1 lot
const ALLEY = 0.4, MARGIN = 0.35;

/** Shelf packing: items {w, h} get x, y; rows wrap at `target` width. Returns the packed size. */
/**
 * Pack rectangles tightly, in order: each one drops to the lowest free spot of a skyline no wider than `target`,
 * so a short item fills the space beside a tall one instead of leaving a hole at the end of a row.
 */
function skyline(items, target, gap) {
  let sky = [{ x: 0, w: target, y: 0 }], W = 0, H = 0;
  for (const it of items) {
    const need = Math.min(target, it.w + gap);
    let best = null;
    for (let i = 0; i < sky.length; i++) {
      const x = sky[i].x;
      if (x + it.w > target + 1e-9 && x > 0) break;
      let y = 0;
      for (let j = i; j < sky.length && sky[j].x < x + need - 1e-9; j++) y = Math.max(y, sky[j].y);
      if (!best || y < best.y - 1e-9) best = { x, y };
    }
    it.x = best.x; it.y = best.y;
    W = Math.max(W, it.x + it.w); H = Math.max(H, it.y + it.h);
    // raise the skyline over [x, x + need)
    const x0 = best.x, x1 = best.x + need, top = best.y + it.h + gap, next = [];
    for (const s of sky) {
      const e = s.x + s.w;
      if (e <= x0 || s.x >= x1) { next.push(s); continue; }
      if (s.x < x0) next.push({ x: s.x, w: x0 - s.x, y: s.y });
      if (e > x1) next.push({ x: x1, w: e - x1, y: s.y });
    }
    next.push({ x: x0, w: x1 - x0, y: top });
    next.sort((p, q) => p.x - q.x);
    sky = next.reduce((m, s) => { const l = m.at(-1); if (l && Math.abs(l.y - s.y) < 1e-9 && Math.abs(l.x + l.w - s.x) < 1e-9) l.w += s.w; else m.push({ ...s }); return m; }, []);
  }
  return { w: W, h: H };
}
/**
 * Pack as tightly as the items allow: try a range of widths, in the given order and tallest-first, and keep the
 * smallest, squarest result. The given order (importance) wins unless reordering saves a real share of the ground.
 */
export function pack(items, gap) {
  if (!items.length) return { w: 0, h: 0 };
  const maxW = Math.max(...items.map((i) => i.w));
  const area = items.reduce((a, i) => a + (i.w + gap) * (i.h + gap), 0);
  const hi = Math.max(maxW, Math.sqrt(area) * 2.4);
  const orders = [items, items.slice().sort((p, q) => q.h - p.h || q.w - p.w)];
  let best = null;
  orders.forEach((order, o) => {
    for (let k = 0; k <= 32; k++) {
      const size = skyline(order, maxW + ((hi - maxW) * k) / 32, gap);
      const score = size.w * size.h * (1 + 0.2 * Math.abs(Math.log(size.w / size.h))) * (o ? 1.08 : 1);
      if (!best || score < best.score - 1e-9) best = { score, pos: new Map(order.map((i) => [i, [i.x, i.y]])), size };
    }
  });
  for (const it of items) [it.x, it.y] = best.pos.get(it);
  return best.size;
}

/**
 * Lay out one folder: files grouped by real sub-folder into parcels, parcels packed tightly.
 * Returns { w, h, parcels: [{ dir, files, x, y, w, h, cols }], lots: [{ f, parcel, x0, y0, x1, y1 }] } in local
 * coordinates (0,0 at the block's back corner).
 */
export function layoutBlock(files, district, interestOf) {
  const byDir = new Map();
  for (const f of files) {
    const d = f.path.slice(0, f.path.lastIndexOf('/') + 1);
    const rel = district && d.startsWith(district) ? d.slice(district.length) : d;
    if (!byDir.has(rel)) byDir.set(rel, []);
    byDir.get(rel).push(f);
  }
  const parcels = [...byDir].map(([dir, fs]) => {
    fs.sort((a, b) => interestOf(b) - interestOf(a) || (a.name < b.name ? -1 : 1));
    const cols = Math.max(1, Math.ceil(Math.sqrt(fs.length * 1.3)));
    const rows = Math.ceil(fs.length / cols);
    return { dir, files: fs, cols, rows, w: cols, h: rows, score: fs.reduce((a, f) => a + interestOf(f), 0) };
  });
  // The folder's own files first, then busy sub-folders, then the rest in path order.
  parcels.sort((a, b) => (a.dir === '' ? -1 : b.dir === '' ? 1 : 0) || b.score - a.score || (a.dir < b.dir ? -1 : 1));
  const size = pack(parcels, ALLEY);
  const lots = [];
  for (const p of parcels) {
    p.x += MARGIN; p.y += MARGIN;
    p.files.forEach((f, i) => {
      const c = i % p.cols, r = Math.floor(i / p.cols);
      const x0 = p.x + c + (1 - FOOT) / 2, y0 = p.y + r + (1 - FOOT) / 2;
      lots.push({ f, parcel: p, x0, y0, x1: x0 + FOOT, y1: y0 + FOOT });
    });
  }
  return { w: size.w + MARGIN * 2, h: size.h + MARGIN * 2, parcels, lots };
}

// ---------------------------------------------------------------------------
// Verdicts over time: what a file looks like at replay step p, with the reviewer's decisions.
// ---------------------------------------------------------------------------
export function createVerdicts(city, files, itemByFile = new Map()) {
  const byPath = new Map(city.files.map((f) => [f.path, f]));
  const st = { progress: city.steps.length - 1, decisions: {} };
  const locs = files.map((f) => Math.max(f.locBefore || 0, f.locAfter || 0)).sort((a, b) => a - b);
  const ref = Math.max(8, locs[Math.floor(locs.length * 0.95)] || 1); // the 95th percentile, so one giant file does not flatten the rest
  // A large city is seen from further away: taller buildings keep its skyline readable (×1 up to 150 files, ×3 at most).
  const lift = Math.min(3, Math.max(1, Math.sqrt(files.length / 150)));
  const heightFor = (loc) => (8 + 62 * Math.min(1.2, Math.sqrt(loc / ref))) * lift;
  const reached = (f) => f.step != null && f.step > 0 && f.step <= st.progress + 1e-6;
  function stateOf(f) {
    if (!f || f.cluster) return 'none';
    if (f.kind === 'affected') return (f.causes || []).some((c) => { const cf = byPath.get(c); return cf && reached(cf) && st.decisions[c] !== 'revert'; }) ? 'affected' : 'none';
    if (f.kind === 'none' || !reached(f)) return 'none';
    if (f.kind === 'in') return 'in';
    const d = st.decisions[f.path];
    return d === 'approve' ? 'approved' : d === 'revert' ? 'reverted' : 'out';
  }
  const exists = (f, side) => {
    if (side === 'before') return f.status !== 'added';
    if (f.status === 'added') return reached(f) && st.decisions[f.path] !== 'revert';
    if (f.status === 'deleted') return !reached(f) || st.decisions[f.path] === 'revert';
    return true;
  };
  /** Height in px: lines of code on that side at this step (a building grows when its commit lands). */
  const heightOf = (f, side) => {
    const after = side === 'after' && reached(f) && st.decisions[f.path] !== 'revert';
    const loc = after ? f.locAfter || f.locBefore || 0 : f.locBefore || f.locAfter || 0;
    return heightFor(loc);
  };
  /** Share of the file's lines this task changed (0..1), for the bright top band. */
  const capOf = (f) => (f.status === 'unchanged' ? 0 : Math.min(1, ((f.plus || 0) + (f.minus || 0)) / Math.max(1, f.locAfter || f.locBefore || 1)));
  const riskOf = (f) => itemByFile.get(f.path)?.risk ?? null;
  return { st, byPath, reached, stateOf, exists, heightOf, heightFor, lift, capOf, riskOf };
}

/**
 * Edges from changes to the files they may affect. Up to `limit` edges are drawn one by one; beyond that they are
 * bundled per (change, target folder) into one arc with a count, so a change imported by 90 files reads as a few
 * thick arcs instead of a wall. Edges touching `keep` (the selected file) always stay single.
 * edges: [{ from, to }] (paths); groupOf(path) → folder key.
 */
export function bundleEdges(edges, groupOf, keep, limit = 24) {
  if (edges.length <= limit) return edges.map((e) => ({ ...e, count: 1 }));
  const single = [], groups = new Map();
  for (const e of edges) {
    if (keep && (e.from === keep || e.to === keep)) { single.push({ ...e, count: 1 }); continue; }
    const k = `${e.from}\u0000${groupOf(e.to)}`;
    if (!groups.has(k)) groups.set(k, { from: e.from, group: groupOf(e.to), tos: [] });
    groups.get(k).tos.push(e.to);
  }
  return single.concat([...groups.values()].map((g) => (g.tos.length === 1 ? { from: g.from, to: g.tos[0], count: 1 } : { from: g.from, tos: g.tos, group: g.group, count: g.tos.length })));
}
