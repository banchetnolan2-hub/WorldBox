// CŒUR DU CALCUL GÉOMÉTRIQUE (exécuté dans un travailleur, ou directement à défaut) — étape « calcul géométrique » du pipeline, hors du fil principal :
//   simulation (fil principal) -> parcelles modifiées -> [ici] recalcul des seuls pays d'origine touchés
//   (polygones validés, fusionnés, nettoyés) -> triangulation + lignes de front prêtes pour la carte
//   graphique -> état suivant envoyé au rendu, qui l'anime (interpolation) à la fréquence d'image.
// Les pays sans changement ne coûtent rien : leur géométrie reste en cache.
import earcut from 'earcut';
import { TerritoryGeometry, parseTerritories } from './territoryGeometry.js';
import { ribbonArrays, unitLL } from '../globe/ribbonData.js';


// maillage d'un pays d'origine : triangles (lon, lat) + clé encodée (2 octets) par sommet
function meshOf(h) {
  let nv = 0, ni = 0;
  const parts = [];
  for (const pc of h.pieces || []) {
    if (pc.key < 0) continue;
    const owner = pc.key >> 1, occ = pc.key & 1;
    const v = owner + (occ ? 32768 : 0) + 1;
    for (const poly of pc.mp) {
      const flat = [], holes = [];
      for (let r = 0; r < poly.length; r++) {
        const ring = poly[r];
        let n = ring.length;
        if (n > 1 && ring[0][0] === ring[n - 1][0] && ring[0][1] === ring[n - 1][1]) n--;
        if (n < 3) continue;
        if (r > 0) holes.push(flat.length / 2);
        for (let k = 0; k < n; k++) flat.push(ring[k][0], ring[k][1]);
      }
      if (flat.length < 6) continue;
      const tri = earcut(flat, holes.length ? holes : null, 2);
      parts.push({ flat, tri, v });
      nv += flat.length / 2; ni += tri.length;
    }
  }
  const pos = new Float32Array(nv * 2), key = new Uint8Array(nv * 2), idx = new Uint32Array(ni);
  let o = 0, oi = 0;
  for (const { flat, tri, v } of parts) {
    pos.set(flat, o * 2);
    for (let k = 0; k < flat.length / 2; k++) { key[(o + k) * 2] = v & 255; key[(o + k) * 2 + 1] = v >> 8; }
    for (let k = 0; k < tri.length; k++) idx[oi + k] = tri[k] + o;
    o += flat.length / 2; oi += tri.length;
  }
  return { pos, key, idx };
}
const bboxOf = (h) => {
  let x0 = 180, y0 = 90, x1 = -180, y1 = -90;
  for (const pc of h.pieces || []) for (const p of pc.mp) for (const [x, y] of p[0]) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  return [x0, y0, x1, y1];
};

export function createGeometryCore() {
  let G = null, keys = null, part = [0, 1];
  const mine = (t) => t % part[1] === part[0];     // plusieurs travailleurs : chacun ses pays d'origine
  return (m) => {
  if (m.type === 'init') {
    if (m.part) part = m.part;
    G = new TerritoryGeometry(m.grid, parseTerritories(m.polys));
    keys = new Int32Array(m.grid.n).fill(-1);
    return null;
  }
  if (m.type === 'overrides' && G) { G.setOverrides(m.list || []); return null; }
  if (m.type === 'update' && G) {
    const t0 = performance.now();
    let dirty = null;
    if (m.full) keys.set(m.keys);
    else {
      const d = new Set();
      for (let k = 0; k < m.cells.length; k++) { keys[m.cells[k]] = m.keys[k]; d.add(G.grid.origin[m.cells[k]]); }
      dirty = [...d].filter((t) => G.H.has(t) && mine(t));
    }
    if (!dirty) dirty = [...G.H.keys()].filter(mine);
    const changed = G.update((c) => keys[c], dirty);
    const out = [], transfer = [];
    for (const t of changed) {
      const h = G.H.get(t);
      const mesh = meshOf(h);
      const fr = h.fronts.length ? ribbonArrays(h.fronts.map((f) => f.map(([lo, la]) => unitLL(lo, la)))) : null;
      out.push({ t, mesh, fronts: fr, bbox: bboxOf(h) });
      transfer.push(mesh.pos.buffer, mesh.key.buffer, mesh.idx.buffer);
      if (fr) transfer.push(fr.pos.buffer, fr.oth.buffer, fr.side.buffer, fr.end.buffer, fr.len.buffer, fr.idx.buffer);
    }
    return { msg: { type: 'result', id: m.id, out, ms: performance.now() - t0 }, transfer };
  }
  return null;
  };
}
