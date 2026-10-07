// GÉOMÉTRIE DES TERRITOIRES — vrais polygones des territoires actuels, recalculés après chaque changement.
//
// Principe : la simulation attribue chaque parcelle (cellule de 0,25°) à un propriétaire. La carte, elle,
// part des vrais polygones des pays d'origine (Natural Earth 1:10m, frontières partagées). Pour chaque pays
// d'origine H :
//   1. les parcelles de H sont regroupées par clé (propriétaire + occupé / officiel) ;
//   2. la clé majoritaire forme le fond ; chaque autre clé donne une région = union de ses parcelles,
//      contour enchaîné puis lissé (Chaikin) -> lignes de front organiques, sans escaliers ;
//   3. région ∩ H (intersection) : les vraies frontières et les côtes sont conservées telles quelles ;
//      on retire les régions déjà calculées (différence) -> aucune superposition ;
//   4. fond = H − ∪ régions (différence) -> aucune lacune : la partition de H est exacte ;
//   5. nettoyage : morceaux minuscules (slivers, fragments accidentels) rattachés au voisin, sauf les
//      îles et enclaves réelles (composantes entières du polygone d'origine) ;
//   6. les pièces de même clé sont fusionnées (union).
// Les lignes de front sont les contours lissés des régions, limités à l'intérieur de H. Le rendu n'affiche
// une ligne que là où les deux côtés ont réellement des clés différentes (test sur la carte des pièces).
import polygonClipping from 'polygon-clipping';

const pc = polygonClipping;
const DEG = Math.PI / 180;

// territories.bin : [nTerr, (t, nPoly, (nRing, (nPts, lon, lat × nPts) × nRing) × nPoly) × nTerr]
export function parseTerritories(f32) {
  const out = new Map();
  let i = 0;
  const nT = f32[i++];
  for (let a = 0; a < nT; a++) {
    const t = f32[i++], np = f32[i++];
    const mp = [];
    for (let p = 0; p < np; p++) {
      const nr = f32[i++];
      const rings = [];
      for (let r = 0; r < nr; r++) {
        const n = f32[i++];
        const ring = new Array(n);
        for (let k = 0; k < n; k++, i += 2) ring[k] = [f32[i], f32[i + 1]];
        rings.push(ring);
      }
      mp.push(rings);
    }
    out.set(t, mp);
  }
  return out;
}

// aire d'un anneau (degrés², pondérée par cos(latitude) -> proportionnelle à la surface réelle)
function ringArea(r) {
  let s = 0;
  for (let k = 0, n = r.length; k < n; k++) {
    const [x1, y1] = r[k], [x2, y2] = r[(k + 1) % n];
    s += (x1 * y2 - x2 * y1) * Math.cos(((y1 + y2) / 2) * DEG);
  }
  return s / 2;
}
export function polyArea(poly) { let a = Math.abs(ringArea(poly[0])); for (let h = 1; h < poly.length; h++) a -= Math.abs(ringArea(poly[h])); return Math.max(0, a); }
export function mpArea(mp) { let a = 0; for (const p of mp) a += polyArea(p); return a; }
function ringLen(r) { let L = 0; for (let k = 0, n = r.length; k < n; k++) { const [x1, y1] = r[k], [x2, y2] = r[(k + 1) % n]; L += Math.hypot((x2 - x1) * Math.cos(((y1 + y2) / 2) * DEG), y2 - y1); } return L; }
// largeur moyenne d'un polygone (2 × aire / périmètre) : détecte les bandes minces (slivers)
export function meanWidth(poly) { let L = 0; for (const r of poly) L += ringLen(r); return L > 0 ? 2 * polyArea(poly) / L : 0; }
const m2 = (mp) => mpArea(mp);
function bboxOf(mp) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const p of mp) for (const [x, y] of p[0]) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  return [x0, y0, x1, y1];
}
const touch = (a, b, m = 0) => a[0] <= b[2] + m && b[0] <= a[2] + m && a[1] <= b[3] + m && b[1] <= a[3] + m;
function inRing(x, y, r) {
  let c = false;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
    const [xi, yi] = r[i], [xj, yj] = r[j];
    if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) c = !c;
  }
  return c;
}
export function inMP(x, y, mp) {
  for (const p of mp) { if (!inRing(x, y, p[0])) continue; let hole = false; for (let h = 1; h < p.length; h++) if (inRing(x, y, p[h])) { hole = true; break; } if (!hole) return true; }
  return false;
}

// simplification (Douglas-Peucker) d'un anneau fermé : les escaliers de la grille deviennent des diagonales
function simplifyRing(r, tol) {
  if (r.length < 5) return r;
  const pts = r.concat([r[0]]);
  const keep = new Uint8Array(pts.length); keep[0] = keep[pts.length - 1] = 1;
  const mid = (pts.length / 2) | 0; keep[mid] = 1;
  const st = [[0, mid], [mid, pts.length - 1]];
  while (st.length) {
    const [a, b] = st.pop();
    const [ax, ay] = pts[a], [bx, by] = pts[b];
    const dx = bx - ax, dy = by - ay, L = Math.hypot(dx, dy);
    let md = -1, mi = -1;
    for (let i = a + 1; i < b; i++) { const d = L > 1e-12 ? Math.abs((pts[i][0] - ax) * dy - (pts[i][1] - ay) * dx) / L : Math.hypot(pts[i][0] - ax, pts[i][1] - ay); if (d > md) { md = d; mi = i; } }
    if (md > tol) { keep[mi] = 1; st.push([a, mi], [mi, b]); }
  }
  const out = pts.filter((_, i) => keep[i]); out.pop();
  return out.length >= 3 ? out : r;
}
// lissage de Chaikin d'un anneau fermé
function chaikinRing(r, iter) {
  let p = r;
  for (let it = 0; it < iter; it++) {
    const q = [];
    for (let k = 0, n = p.length; k < n; k++) {
      const a = p[k], b = p[(k + 1) % n];
      q.push([a[0] * 0.75 + b[0] * 0.25, a[1] * 0.75 + b[1] * 0.25], [a[0] * 0.25 + b[0] * 0.75, a[1] * 0.25 + b[1] * 0.75]);
    }
    p = q;
  }
  return p;
}

export class TerritoryGeometry {
  // grid : grille de la simulation ; polys : Map territoire -> MultiPolygon (parseTerritories)
  constructor(grid, polys, { smooth = 2 } = {}) {
    this.grid = grid;
    this.smooth = smooth;
    this.R = grid.RES;
    this.cellArea = this.R * this.R;
    this.H = new Map();
    this.overrides = [];               // frontières dessinées à la main : bandes exactes de part et d'autre du tracé
    for (const [t, mp0] of polys) {
      const mp = mp0;                                              // validé (union) au premier calcul mixte
      if (!mp.length) continue;
      const comps = mp.map((p) => polyArea(p));
      this.H.set(t, { t, mp, bbox: bboxOf(mp), area: comps.reduce((a, b) => a + b, 0), comps, cells: [], anchor: -1, pieces: null, fronts: [], sig: '' });
    }
    // parcelles de chaque pays d'origine
    for (let c = 0; c < grid.n; c++) { const h = this.H.get(grid.origin[c]); if (h) h.cells.push(c); }
    // pays sans parcelle (micro-États, petites îles) : rattachés à la parcelle la plus proche
    for (const h of this.H.values()) {
      if (h.cells.length) continue;
      const cx = (h.bbox[0] + h.bbox[2]) / 2, cy = (h.bbox[1] + h.bbox[3]) / 2;
      let best = -1, bd = Infinity;
      for (let c = 0; c < grid.n; c++) { const dx = (grid.lon[c] - cx) * Math.cos(cy * DEG), dy = grid.lat[c] - cy; const d = dx * dx + dy * dy; if (d < bd) { bd = d; best = c; } }
      h.anchor = best;
    }
  }

  // frontières dessinées par le joueur : la frontière suit exactement le tracé (et non le contour des parcelles)
  setOverrides(list) {
    const touchAny = (bb) => list.some((o) => touch(bb, o.bbox, this.R)) || this.overrides.some((o) => touch(bb, o.bbox, this.R));
    for (const h of this.H.values()) if (touchAny(h.bbox)) h.sig = '';
    this.overrides = (list || []).map((o) => ({ ...o, bbox: o.bbox || bboxOf(o.poly) }));
  }
  _applyOverrides(h, keyOf) {
    if (!this.overrides.length) return;
    let changed = false;
    for (const o of this.overrides) {
      if (!touch(h.bbox, o.bbox, this.R)) continue;
      // validité : les parcelles de la bande (dans ce pays d'origine) appartiennent encore au bon propriétaire
      let n = 0, ok = 0; const kc = new Map();
      for (const c of o.cells) { if (this.grid.origin[c] !== h.t) continue; n++; const kk = keyOf(c); if ((kk >> 1) === o.owner) { ok++; kc.set(kk, (kc.get(kk) || 0) + 1); } }
      if (!n || ok < n * 0.7) continue;
      let key = o.owner * 2, kv = 0; for (const [kk, v] of kc) if (v > kv) { kv = v; key = kk; }
      if (h.pieces.every((p) => p.key === key)) continue;
      if (!h.pbb) h.pbb = h.mp.map((p) => bboxOf([p]));
      h.vp = h.vp || [];
      const near = [];
      h.mp.forEach((p, i) => { if (!touch(h.pbb[i], o.bbox, this.R)) return; if (!h.vp[i]) { try { h.vp[i] = pc.union([p]); } catch (_) { h.vp[i] = [p]; } } near.push(...h.vp[i]); });
      if (!near.length) continue;
      let clip;
      try { clip = pc.intersection(o.poly, near); } catch (_) { continue; }
      if (!clip.length) continue;
      for (const pz of h.pieces) { if (pz.key === key) continue; try { pz.mp = pc.difference(pz.mp, clip); } catch (_) { /* pièce inchangée */ } }
      const tg = h.pieces.find((p) => p.key === key);
      if (tg) { try { tg.mp = pc.union(tg.mp, clip); } catch (_) { tg.mp = tg.mp.concat(clip); } } else h.pieces.push({ key, mp: clip });
      changed = true;
    }
    if (!changed) return;
    h.pieces = h.pieces.filter((p) => p.mp.length && mpArea(p.mp) > this.cellArea * 0.01);
    h.pieces.sort((x, y) => m2(y.mp) - m2(x.mp));
    h.fronts = [];
    for (let i = 1; i < h.pieces.length; i++) for (const poly of h.pieces[i].mp) for (const r of poly) h.fronts.push(r.concat([r[0]]));
  }

  // keyOf(c) : clé d'une parcelle (propriétaire * 2 + occupé), -1 = aucune
  // renvoie la liste des pays d'origine recalculés
  update(keyOf, only = null) {
    const changed = [];
    for (const h of (only ? only.map((t) => this.H.get(t)).filter(Boolean) : this.H.values())) {
      const sig = h.cells.length ? h.cells.map(keyOf).join(',') : String(keyOf(h.anchor));
      if (sig === h.sig && h.pieces) continue;
      h.sig = sig;
      this._compute(h, keyOf);
      changed.push(h.t);
    }
    return changed;
  }

  _compute(h, keyOf) {
    if (!h.cells.length) { h.pieces = [{ key: keyOf(h.anchor), mp: h.mp }]; h.fronts = []; return; }
    const groups = new Map();
    for (const c of h.cells) { const k = keyOf(c); (groups.get(k) || groups.set(k, []).get(k)).push(c); }
    const order = [...groups.entries()].sort((a, b) => b[1].length - a[1].length);
    if (order.length === 1) { h.pieces = [{ key: order[0][0], mp: h.mp }]; h.fronts = []; return; }
    const bgKey = order[0][0];
    const pieces = [];
    let taken = [];
    // contours des régions, puis seuls les polygones du pays d'origine qu'ils touchent entrent dans les
    // opérations (les autres îles et territoires restent entiers) : calcul local, rapide même pour les
    // très grands pays
    const regs = [];
    let zb = [Infinity, Infinity, -Infinity, -Infinity];
    for (let g = 1; g < order.length; g++) {
      const rings = this._unionRings(order[g][1], h.t).map((r) => chaikinRing(simplifyRing(r, this.R * 0.55), this.smooth));
      if (!rings.length) continue;
      const bb = bboxOf(rings.map((r) => [r]));
      zb = [Math.min(zb[0], bb[0]), Math.min(zb[1], bb[1]), Math.max(zb[2], bb[2]), Math.max(zb[3], bb[3])];
      regs.push([order[g][0], rings]);
    }
    if (!h.pbb) h.pbb = h.mp.map((p) => bboxOf([p]));
    h.vp = h.vp || [];
    const near = [], far = [];
    // (les grands polygones sont déjà découpés en tuiles à la construction des données : partition spatiale,
    // seules les tuiles proches des régions modifiées entrent dans les opérations)
    h.mp.forEach((p, i) => {
      if (!touch(h.pbb[i], zb, this.R)) { far.push(p); return; }
      if (!h.vp[i]) { try { h.vp[i] = pc.union([p]); } catch (_) { h.vp[i] = [p]; } }   // validation : anneaux orientés, sans auto-intersection
      near.push(...h.vp[i]);
    });
    for (const [key, rings] of regs) {
      let region;
      try {
        region = pc.xor(...rings.map((r) => [[r]]));                         // anneaux extérieurs et trous (pair-impair)
        region = near.length ? pc.intersection(region, near) : [];           // vraies frontières et côtes conservées
        if (taken.length) region = pc.difference(region, ...taken);         // jamais de superposition
      } catch (_) { continue; }
      region = region.filter((p) => polyArea(p) > this.cellArea * 0.12 && meanWidth(p) > this.R * 0.12);   // slivers et fragments accidentels
      if (!region.length) continue;
      pieces.push({ key, mp: region });
      taken.push(region);
    }
    // fond : le reste exact du pays d'origine
    let bg;
    try { bg = taken.length ? pc.difference(near, ...taken) : near; } catch (_) { bg = near; }
    // nettoyage topologique : chaque composante trop petite ou trop mince (sliver, fragment accidentel,
    // enclave d'une seule parcelle ne différant que par le statut) rejoint la clé voisine dominante ;
    // les îles et enclaves réelles (composantes entières du pays d'origine) sont conservées.
    const comps = [];
    for (const p of bg) comps.push({ key: bgKey, poly: p, bb: bboxOf([p]) });
    for (const p of far) comps.push({ key: bgKey, poly: p, bb: bboxOf([p]), far: true });
    for (const pz of pieces) for (const p of pz.mp) comps.push({ key: pz.key, poly: p, bb: bboxOf([p]) });
    const whole = (a) => h.comps.some((ca) => Math.abs(ca - a) < Math.max(1e-6, ca * 0.02));
    comps.sort((x, y) => polyArea(x.poly) - polyArea(y.poly));
    for (const c of comps) {
      if (c.far) continue;
      const a = polyArea(c.poly);
      if (whole(a)) continue;
      const thin = a < this.cellArea * 0.12 || meanWidth(c.poly) < this.R * 0.12;
      if (!thin && a >= this.cellArea * 1.5) continue;
      const host = this._neighbourKey(c, comps);
      if (host === null || host === c.key) continue;
      if (thin || (host >> 1) === (c.key >> 1)) c.key = host;
    }
    // fusion (union) des composantes de même clé : polygones valides, sans superposition
    const byKey = new Map();
    const farBy = new Map();
    for (const c of comps) { const M = c.far ? farBy : byKey; (M.get(c.key) || M.set(c.key, []).get(c.key)).push([c.poly]); }
    h.pieces = [];
    for (const [key, list] of byKey) { let mp; try { mp = list.length > 1 ? pc.union(...list) : list[0]; } catch (_) { mp = list.flat(); } h.pieces.push({ key, mp: mp.concat((farBy.get(key) || []).map((x) => x[0])) }); farBy.delete(key); }
    for (const [key, list] of farBy) h.pieces.push({ key, mp: list.map((x) => x[0]) });
    // lignes de front : contours des pièces autres que le fond (après nettoyage) ; le rendu n'en montre
    // que les portions où les deux côtés diffèrent réellement (jamais sur la côte, jamais dans un territoire)
    h.pieces.sort((x, y) => m2(y.mp) - m2(x.mp));
    h.fronts = [];
    for (let i = 1; i < h.pieces.length; i++) for (const poly of h.pieces[i].mp) for (const r of poly) h.fronts.push(r.concat([r[0]]));
    this._applyOverrides(h, keyOf);
  }

  // clé dominante juste à l'extérieur d'une composante (points pris le long de son contour)
  _neighbourKey(c, comps) {
    const r = c.poly[0], n = r.length, step = Math.max(1, Math.floor(n / 32));
    const eps = this.R * 0.06, votes = new Map();
    const sgn = ringArea(r) >= 0 ? 1 : -1;                     // anneau direct : l'extérieur est à droite
    for (let k = 0; k < n; k += step) {
      const [x1, y1] = r[k], [x2, y2] = r[(k + 1) % n];
      const dx = x2 - x1, dy = y2 - y1, L = Math.hypot(dx, dy) || 1;
      const px = (x1 + x2) / 2 + (dy / L) * eps * sgn, py = (y1 + y2) / 2 - (dx / L) * eps * sgn;
      for (const o of comps) {
        if (o === c || px < o.bb[0] || px > o.bb[2] || py < o.bb[1] || py > o.bb[3]) continue;
        if (inMP(px, py, [o.poly])) { votes.set(o.key, (votes.get(o.key) || 0) + 1); break; }
      }
    }
    let best = null, bv = 0;
    for (const [k, v] of votes) if (v > bv) { bv = v; best = k; }
    return best;
  }

  // contours de l'union des parcelles (arêtes de la grille enchaînées, intérieur à gauche)
  // Les positions voisines qui n'appartiennent pas au pays d'origine (pays voisin, mer) sont ajoutées :
  // la région couvre ainsi la bande de terre entre ses parcelles et la vraie frontière ou la côte
  // (l'intersection avec le pays d'origine la ramène exactement sur la frontière réelle).
  _unionRings(cells, t) {
    const g = this.grid, W = g.W, R = this.R;
    const set = new Set(cells.map((c) => g.pos[c]).filter((p) => p >= 0));   // parcelles hors grille (micro-États) : sans contour propre
    const ownBase = (x, y) => { if (y < 0 || y >= g.H) return false; const c = g.indexAt[y * W + ((x + W) % W)]; return c >= 0 && g.origin[c] === t; };
    for (const p of [...set]) {
      const x = p % W, y = (p / W) | 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || nx >= W || ny < 0 || ny >= g.H || ownBase(nx, ny)) continue;
        set.add(ny * W + nx);
      }
    }
    const has = (x, y) => x >= 0 && x < W && y >= 0 && y < g.H && set.has(y * W + x);
    const V = (X, Y) => Y * (W + 1) + X;
    const out = new Map();                                                 // sommet de départ -> arêtes sortantes
    const add = (a, b) => { const l = out.get(a); if (l) l.push(b); else out.set(a, [b]); };
    for (const p of set) {
      const x = p % W, y = (p / W) | 0;
      if (!has(x, y + 1)) add(V(x, y + 1), V(x + 1, y + 1));             // bas (vers l'est)
      if (!has(x + 1, y)) add(V(x + 1, y + 1), V(x + 1, y));             // droite (vers le nord)
      if (!has(x, y - 1)) add(V(x + 1, y), V(x, y));                     // haut (vers l'ouest)
      if (!has(x - 1, y)) add(V(x, y), V(x, y + 1));                     // gauche (vers le sud)
    }
    const xy = (v) => [v % (W + 1), Math.floor(v / (W + 1))];
    const rings = [];
    for (const start of [...out.keys()]) {
      while (out.get(start) && out.get(start).length) {
        const ring = [start];
        let prev = start, cur = out.get(start).pop();
        let guard = 0;
        while (cur !== start && guard++ < 1e6) {
          ring.push(cur);
          const l = out.get(cur);
          if (!l || !l.length) break;
          let k = 0;
          if (l.length > 1) {
            // point de contact en diagonale : on tourne au plus serré (intérieur à gauche) -> anneaux séparés
            const [px, py] = xy(prev), [cx, cy] = xy(cur);
            const din = [cx - px, -(cy - py)];
            let best = -Infinity;
            l.forEach((n, i) => { const [nx, ny] = xy(n); const d = [nx - cx, -(ny - cy)]; const cr = din[0] * d[1] - din[1] * d[0]; if (cr > best) { best = cr; k = i; } });
          }
          prev = cur; cur = l.splice(k, 1)[0];
        }
        if (ring.length >= 4) rings.push(ring.map((v) => { const [X, Y] = xy(v); return [-180 + X * R, 90 - Y * R]; }));
      }
    }
    return rings;
  }

  // parties d'un contour lissé situées à l'intérieur du pays d'origine (lignes de front)
  _inside(ring, mp) {
    const out = [];
    let cur = [];
    for (let k = 0; k <= ring.length; k++) {
      const p = ring[k % ring.length];
      if (inMP(p[0], p[1], mp)) cur.push(p);
      else { if (cur.length > 1) out.push(cur); cur = []; }
    }
    if (cur.length > 1) out.push(cur);
    return out;
  }

  // toutes les pièces (pour le rendu et les tests)
  allPieces() { const out = []; for (const h of this.H.values()) if (h.pieces) for (const p of h.pieces) out.push({ t: h.t, key: p.key, mp: p.mp }); return out; }
  allFronts() { const out = []; for (const h of this.H.values()) out.push(...h.fronts); return out; }
}
