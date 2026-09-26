// map.js — the layout of the codebase city, drawn by atlas3d.js.
//
// Zoning: the city is split into neighbourhoods by what the code does — Screens, App logic, Tests,
// Server & data, Infra & config. Every feature folder is a city block, every real sub-folder a parcel on it,
// every file a lot. Deterministic: the same city always gives the same layout.

import { LAYERS, districtLayer, interest, sectionName } from './layers.js';
import { pack, layoutBlock } from './iso.js';

const STREET = 1.2, AVENUE = 2.4, ZONE_PAD = 0.8;

/** Blocks, parcels and lots, grouped into zones by layer. Deterministic. */
export function layoutCity(city) {
  const byD = new Map();
  for (const f of city.files) {
    const d = f.district || './';
    if (!byD.has(d)) byD.set(d, []);
    byD.get(d).push(f);
  }
  const blocks = [...byD].map(([id, files]) => {
    const B = layoutBlock(files, id === './' ? '' : id, interest);
    return {
      id, files, ...B, layer: districtLayer(files),
      name: sectionName(id) + (id === './' ? '' : '/'),
      score: files.reduce((a, f) => a + interest(f), 0),
      changed: files.filter((f) => f.status !== 'unchanged').length,
      fenced: files.some((f) => f.inFence), // only folders that hold requested files
    };
  });
  const zones = [];
  for (const L of LAYERS) {
    const bs = blocks.filter((b) => b.layer === L.id);
    if (!bs.length) continue;
    bs.sort((a, b) => Number(b.fenced) - Number(a.fenced) || b.score - a.score || b.files.length - a.files.length || (a.id < b.id ? -1 : 1));
    const items = bs.map((b) => ({ b, w: b.w, h: b.h }));
    const size = pack(items, STREET);
    zones.push({ layer: L.id, name: L.name, blocks: bs, items, w: size.w + ZONE_PAD * 2, h: size.h + ZONE_PAD * 2 });
  }
  // Zones in layer order, packed tightly into a roughly square city.
  const size = pack(zones, AVENUE);
  const ox = size.w / 2, oy = size.h / 2;
  const lots = [];
  for (const z of zones) {
    z.x -= ox; z.y -= oy;
    for (const it of z.items) {
      const b = it.b;
      b.x = z.x + ZONE_PAD + it.x; b.y = z.y + ZONE_PAD + it.y;
      for (const p of b.parcels) { p.gx = b.x + p.x; p.gy = b.y + p.y; p.block = b; }
      for (const l of b.lots) lots.push({ ...l, block: b, x0: l.x0 + b.x, y0: l.y0 + b.y, x1: l.x1 + b.x, y1: l.y1 + b.y });
    }
  }
  return { zones, blocks, lots, ground: { x0: -ox - 1.2, y0: -oy - 1.2, x1: ox + 1.2, y1: oy + 1.2 } };
}
