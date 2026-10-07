// ÉDITION MANUELLE DES FRONTIÈRES (Nation Simulator) — le joueur dessine au crayon une nouvelle frontière de
// son pays ; le tracé modifie réellement le territoire :
//  1. le tracé est converti en « mur » de parcelles 4-connexe (il sépare donc toujours les parcelles 8-connexes) ;
//  2. pour chaque pays touché, les parties de son territoire coupées de leur cœur par le tracé sont isolées ;
//  3. une partie coupée d'un pays étranger qui touche le pays du joueur lui revient ; une partie coupée du pays
//     du joueur revient au voisin de l'autre côté du tracé ;
//  4. les parcelles du tracé rejoignent le côté majoritaire ; nettoyage topologique (aucun fragment, aucune
//     parcelle sans propriétaire, capitales jamais transférées) ;
//  5. de part et d'autre du tracé, deux bandes polygonales exactes indiquent à la géométrie des territoires que
//     la frontière suit EXACTEMENT la ligne dessinée (et non le contour des parcelles).
// Tout est pur et testable ; l'application (validation) passe par sim.flip et la géométrie des territoires.
import polygonClipping from 'polygon-clipping';
import { YEAR_SEC } from './calendar.js';
import { addRel, startWar } from './wars.js';
import { PERSONALITIES } from './profile.js';
import { powerOf } from './ai.js';

const pc = polygonClipping;
const DEG = Math.PI / 180;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

// parcelle de la grille sous un point (lon, lat), -1 en mer
export function cellAtLL(g, lon, lat) {
  const x = Math.floor((((lon + 180) % 360) + 360) % 360 / g.RES), y = Math.floor((90 - lat) / g.RES);
  if (y < 0 || y >= g.H) return -1;
  return g.indexAt[y * g.W + ((x % g.W) + g.W) % g.W];
}
const gpos = (g, lon, lat) => [Math.floor((((lon + 180) % 360) + 360) % 360 / g.RES), Math.floor((90 - lat) / g.RES)];

// mur 4-connexe le long d'un tracé (positions de grille, y compris en mer)
export function strokeWall(g, pts) {
  const W = g.W, set = new Set();
  const add = (x, y) => { if (y >= 0 && y < g.H) set.add(y * W + ((x % W) + W) % W); };
  let prev = null;
  for (let s = 0; s < pts.length - 1; s++) {
    let [lo0, la0] = pts[s]; const [lo1, la1] = pts[s + 1];
    let dlo = lo1 - lo0; if (dlo > 180) dlo -= 360; if (dlo < -180) dlo += 360;
    const len = Math.hypot(dlo, la1 - la0), n = Math.max(1, Math.ceil(len / (g.RES * 0.25)));
    for (let k = 0; k <= n; k++) {
      const [x, y] = gpos(g, lo0 + dlo * k / n, la0 + (la1 - la0) * k / n);
      if (prev && (prev[0] !== x || prev[1] !== y)) {
        // pas en diagonale : on ajoute une parcelle orthogonale -> mur 4-connexe
        if (prev[0] !== x && prev[1] !== y) add(x, prev[1]);
      }
      add(x, y);
      prev = [x, y];
    }
  }
  const cells = [];
  for (const p of set) { const c = g.indexAt[p]; if (c >= 0) cells.push(c); }
  return { pos: set, cells };
}

// composantes d'un pays (8-voisinage) en excluant des parcelles « murs »
function components(sim, e, wall) {
  const g = sim.grid, lab = new Map();
  const comps = [];
  for (let i = 0; i < sim.n; i++) {
    if (sim.owner[i] !== e || wall.has(i) || lab.has(i)) continue;
    const comp = [i]; lab.set(i, comps.length);
    for (let q = 0; q < comp.length; q++) {
      const a = comp[q];
      for (let k = g.nbrStart[a]; k < g.nbrStart[a + 1]; k++) {
        const b = g.nbr[k];
        if (sim.owner[b] === e && !wall.has(b) && !lab.has(b)) { lab.set(b, comps.length); comp.push(b); }
      }
    }
    comps.push(comp);
  }
  return { comps, lab };
}

/**
 * Calcule l'effet d'un ensemble de tracés pour le pays du joueur (k).
 * strokes : [[lon, lat], ...][] ; retourne { transfers: [[cell, newOwner]], gained, lost, byOwner, strips, warnings, effective }
 */
export function computeEdit(sim, k, strokes, opts = {}) {
  const g = sim.grid, A = sim.sides[k].e;
  const out = { transfers: [], gained: 0, lost: 0, byOwner: {}, strips: [], warnings: [], effective: [] };
  const valid = strokes.filter((s) => s && s.length >= 2);
  if (!valid.length) return out;
  const wallCells = new Set();
  for (const s of valid) for (const c of strokeWall(g, s).cells) wallCells.add(c);
  // pays touchés : propriétaires des parcelles du tracé et de leurs voisines
  const owners = new Set();
  for (const c of wallCells) { owners.add(sim.owner[c]); for (let q = g.nbrStart[c]; q < g.nbrStart[c + 1]; q++) owners.add(sim.owner[g.nbr[q]]); }
  owners.add(A);
  const isCountry = (e) => sim.entities[e] && sim.entities[e].kind !== 'neutral' && !sim.entities[e].removed;
  const capitals = new Set(sim.sides.map((s) => s.capital).filter((c) => c >= 0));
  const newOwner = new Map();
  const km = (c) => (sim.geo ? sim.geo.km2[c] : 770);
  for (const X of owners) {
    if (!isCountry(X)) continue;
    const base = components(sim, X, new Set());
    const cut = components(sim, X, wallCells);
    // pour chaque composante d'origine, la partie qui garde son « ancre » (capitale, sinon la plus grande) reste à X
    const keep = new Set();
    const side = sim.sideOf[X];
    const cap = side >= 0 ? sim.sides[side].capital : -1;
    const best = new Map();
    for (let ci = 0; ci < cut.comps.length; ci++) {
      const comp = cut.comps[ci];
      const L = base.lab.get(comp[0]);
      const hasCap = cap >= 0 && comp.includes(cap);
      const score = (hasCap ? 1e9 : 0) + comp.length;
      const b = best.get(L);
      if (!b || score > b.score) best.set(L, { ci, score });
    }
    for (const { ci } of best.values()) keep.add(ci);
    for (let ci = 0; ci < cut.comps.length; ci++) {
      if (keep.has(ci)) continue;
      const comp = cut.comps[ci];
      // voisins de la partie coupée (directement ou de l'autre côté du tracé)
      const votes = new Map();
      const vote = (o, w) => { if (o !== X && isCountry(o)) votes.set(o, (votes.get(o) || 0) + w); };
      for (const a of comp) for (let q = g.nbrStart[a]; q < g.nbrStart[a + 1]; q++) {
        const b = g.nbr[q];
        if (wallCells.has(b)) { for (let r = g.nbrStart[b]; r < g.nbrStart[b + 1]; r++) { const c2 = g.nbr[r]; if (!wallCells.has(c2) && sim.owner[c2] !== X) vote(sim.owner[c2], 1); } }
        else vote(sim.owner[b], 2);
      }
      let to;
      if (X !== A) to = votes.has(A) ? A : -1;                // territoire étranger coupé : au joueur s'il le touche
      else { let bv = 0; to = -1; for (const [o, v] of votes) if (v > bv) { bv = v; to = o; } }   // territoire du joueur coupé : au voisin
      if (to < 0) continue;
      if (comp.some((c) => capitals.has(c))) { out.warnings.push(`La capitale ${sim.entities[X].name ? 'de ' + sim.entities[X].name : ''} ne peut pas changer de pays : cette partie est ignorée.`); continue; }
      for (const c of comp) newOwner.set(c, to);
    }
  }
  // parcelles du tracé : chacune rejoint le pays situé du même côté de la ligne que son centre (la frontière
  // passe ainsi au plus près du tracé, à la demi-parcelle près)
  const ownerAfter = (c) => (newOwner.has(c) ? newOwner.get(c) : sim.owner[c]);
  const sideOf = (lon, lat) => {
    let bd = Infinity, sg = 0;
    for (const st of valid) for (let q = 0; q < st.length - 1; q++) {
      const [ax, ay] = st[q], [bx, by] = st[q + 1];
      const cl = Math.cos(((ay + by) / 2) * DEG);
      let dx = bx - ax; if (dx > 180) dx -= 360; if (dx < -180) dx += 360;
      let px = lon - ax; if (px > 180) px -= 360; if (px < -180) px += 360;
      const vx = dx * cl, vy = by - ay, wx = px * cl, wy = lat - ay;
      const L = vx * vx + vy * vy;
      const t = L ? Math.max(0, Math.min(1, (wx * vx + wy * vy) / L)) : 0;
      const d = Math.hypot(wx - vx * t, wy - vy * t);
      if (d < bd) { bd = d; sg = vx * wy - vy * wx >= 0 ? 1 : -1; }
    }
    return sg;
  };
  // propriétaire de chaque côté, d'après les voisines des parcelles du tracé (nouvel état)
  const sideVotes = { 1: new Map(), '-1': new Map() };
  for (const c of wallCells) for (let q = g.nbrStart[c]; q < g.nbrStart[c + 1]; q++) {
    const b = g.nbr[q]; if (wallCells.has(b)) continue;
    const o = ownerAfter(b); if (!isCountry(o)) continue;
    const sg = sideOf(g.lon[b], g.lat[b]); const M = sideVotes[sg]; M.set(o, (M.get(o) || 0) + 1);
  }
  const top = (M) => { let k2 = -1, bv = 0; for (const [o, v] of M) if (v > bv) { bv = v; k2 = o; } return k2; };
  const sideOwner = { 1: top(sideVotes[1]), '-1': top(sideVotes[-1]) };
  for (const c of wallCells) {
    if (capitals.has(c) || !isCountry(sim.owner[c])) continue;
    // une parcelle du tracé ne change de côté que si le pays voisin la touche (pas de saut au-delà d'un tiers)
    const to = sideOwner[sideOf(g.lon[c], g.lat[c])];
    if (to < 0 || to === sim.owner[c]) continue;
    let touches = false;
    for (let q = g.nbrStart[c]; q < g.nbrStart[c + 1]; q++) if (ownerAfter(g.nbr[q]) === to) { touches = true; break; }
    if (touches) newOwner.set(c, to);
  }
  // seules les modifications qui concernent le pays du joueur sont permises
  for (const [c, to] of [...newOwner]) {
    const from = sim.owner[c];
    if (from === to || (from !== A && to !== A)) newOwner.delete(c);
  }
  // nettoyage topologique : petits îlots (≤ 3 parcelles) enfermés par un autre pays après la modification
  for (let pass = 0; pass < 2; pass++) {
    const seen = new Set();
    const touched = new Set();
    for (const c of newOwner.keys()) { touched.add(c); for (let q = g.nbrStart[c]; q < g.nbrStart[c + 1]; q++) touched.add(g.nbr[q]); }
    for (const c0 of touched) {
      if (seen.has(c0)) continue;
      const e = ownerAfter(c0);
      const comp = [c0]; seen.add(c0);
      for (let q = 0; q < comp.length && comp.length <= 4; q++) for (let r = g.nbrStart[comp[q]]; r < g.nbrStart[comp[q] + 1]; r++) { const b = g.nbr[r]; if (!seen.has(b) && ownerAfter(b) === e) { seen.add(b); comp.push(b); } }
      if (comp.length > 3 || comp.some((c) => capitals.has(c) || g.coastal[c])) continue;
      const around = new Map();
      for (const a of comp) for (let r = g.nbrStart[a]; r < g.nbrStart[a + 1]; r++) { const o = ownerAfter(g.nbr[r]); if (o !== e) around.set(o, (around.get(o) || 0) + 1); }
      if (around.size !== 1) continue;
      const [o] = around.keys();
      if (!isCountry(o) || (o !== A && e !== A)) continue;
      for (const c of comp) { if (sim.owner[c] === o) newOwner.delete(c); else newOwner.set(c, o); }
    }
  }
  for (const [c, to] of newOwner) {
    const from = sim.owner[c];
    if (from === to) continue;
    out.transfers.push([c, to]);
    const a = km(c);
    if (to === A) { out.gained += a; const r = out.byOwner[from] || (out.byOwner[from] = { gained: 0, lost: 0 }); r.gained += a; }
    else { out.lost += a; const r = out.byOwner[to] || (out.byOwner[to] = { gained: 0, lost: 0 }); r.lost += a; }
  }
  const own = sim.sides[k].km2 || 1;
  if (out.lost > own * 0.25) out.warnings.push(`Attention : vous céderiez ${Math.round(out.lost / own * 100)} % de votre territoire.`);
  // effet de chaque tracé (pour l'interface : tracé sans effet = ne relie pas deux points de frontière)
  if (!opts.noPerStroke) out.effective = valid.map((s) => (valid.length === 1 ? out.transfers.length > 0 : computeEdit(sim, k, [s], { noPerStroke: true, noStrips: true }).transfers.length > 0));
  if (!out.transfers.length) return out;
  // bandes exactes le long des tracés (géométrie)
  if (!opts.noStrips) {
    const set = new Map(out.transfers);
    const after = (c) => (set.has(c) ? set.get(c) : sim.owner[c]);
    for (const s of valid) {
      for (const sideSign of [1, -1]) {
        const strip = stripPolygon(s, g.RES * 1.25, sideSign);
        if (!strip) continue;
        const bb = bboxRing(strip[0][0]);
        const votes = new Map(); const cells = [];
        const [x0, y0] = gpos(g, bb[0], bb[3]), [x1, y1] = gpos(g, bb[2], bb[1]);
        for (let y = Math.max(0, y0); y <= Math.min(g.H - 1, y1); y++) for (let x = x0; x <= x1; x++) {
          const c = g.indexAt[y * g.W + ((x % g.W) + g.W) % g.W];
          if (c < 0 || !inRing(g.lon[c], g.lat[c], strip[0][0])) continue;
          cells.push(c);
          const o = after(c); votes.set(o, (votes.get(o) || 0) + 1);
        }
        let key = -1, bv = 0; for (const [o, v] of votes) if (v > bv) { bv = v; key = o; }
        if (key < 0 || bv < cells.length * 0.6 || !cells.length) continue;
        out.strips.push({ poly: strip, owner: key, cells, bbox: bb });
      }
    }
  }
  return out;
}

function bboxRing(r) { let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity; for (const [x, y] of r) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; } return [x0, y0, x1, y1]; }
function inRing(x, y, r) { let c = false; for (let i = 0, j = r.length - 1; i < r.length; j = i++) { const [xi, yi] = r[i], [xj, yj] = r[j]; if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) c = !c; } return c; }
// bande d'une largeur w (degrés) d'un côté du tracé (signe +1 : à gauche dans le sens du tracé)
export function stripPolygon(pts, w, sign) {
  if (pts.length < 2) return null;
  const off = pts.map((p, i) => {
    const a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)];
    const cl = Math.cos(p[1] * DEG) || 1e-3;
    let dx = (b[0] - a[0]) * cl, dy = b[1] - a[1];
    const L = Math.hypot(dx, dy) || 1; dx /= L; dy /= L;
    return [p[0] - dy * w * sign / cl, p[1] + dx * w * sign];
  });
  const ring = [...pts.map((p) => [p[0], p[1]]), ...off.reverse()];
  ring.push([ring[0][0], ring[0][1]]);
  try { const u = pc.union([[ring]]); return u.length ? u : null; } catch (_) { return null; }
}

// lissage et simplification d'un tracé (degrés) ; précision : aucun lissage
export function prepareStroke(pts, precise = false) {
  if (pts.length < 2) return pts;
  let p = pts;
  if (!precise) {
    // simplification (Douglas-Peucker, tolérance ~1/5 de parcelle) puis lissage léger (Chaikin)
    p = simplify(p, 0.05);
    for (let it = 0; it < 2 && p.length >= 3; it++) {
      const q = [p[0]];
      for (let k = 0; k < p.length - 1; k++) { const a = p[k], b = p[k + 1]; q.push([a[0] * 0.75 + b[0] * 0.25, a[1] * 0.75 + b[1] * 0.25], [a[0] * 0.25 + b[0] * 0.75, a[1] * 0.25 + b[1] * 0.75]); }
      q.push(p[p.length - 1]); p = q;
    }
  }
  return p;
}
function simplify(pts, tol) {
  if (pts.length < 3) return pts;
  const keep = new Uint8Array(pts.length); keep[0] = keep[pts.length - 1] = 1;
  const st = [[0, pts.length - 1]];
  while (st.length) {
    const [a, b] = st.pop(); const [ax, ay] = pts[a], [bx, by] = pts[b];
    const dx = bx - ax, dy = by - ay, L = Math.hypot(dx, dy);
    let md = -1, mi = -1;
    for (let i = a + 1; i < b; i++) { const d = L > 1e-12 ? Math.abs((pts[i][0] - ax) * dy - (pts[i][1] - ay) * dx) / L : Math.hypot(pts[i][0] - ax, pts[i][1] - ay); if (d > md) { md = d; mi = i; } }
    if (md > tol) { keep[mi] = 1; st.push([a, mi], [mi, b]); }
  }
  return pts.filter((_, i) => keep[i]);
}

// accrochage : point de frontière du pays le plus proche (parcelle frontalière, en degrés), ou null
export function snapToBorder(sim, k, lon, lat, maxDeg) {
  const g = sim.grid, sd = sim.sides[k];
  let best = null, bd = maxDeg * maxDeg;
  const cl = Math.cos(lat * DEG);
  for (const c of sd.border) {
    const dx = (g.lon[c] - lon) * cl, dy = g.lat[c] - lat;
    const d = dx * dx + dy * dy;
    if (d < bd) { bd = d; best = c; }
  }
  if (best === null) return null;
  // milieu entre la parcelle frontalière et sa voisine étrangère la plus proche : sur la frontière elle-même
  let nb = -1, nd = Infinity;
  for (let q = g.nbrStart[best]; q < g.nbrStart[best + 1]; q++) { const j = g.nbr[q]; if (sim.owner[j] === sd.e) continue; const dx = (g.lon[j] - lon) * cl, dy = g.lat[j] - lat; const d = dx * dx + dy * dy; if (d < nd) { nd = d; nb = j; } }
  if (nb < 0) return [g.lon[best], g.lat[best]];
  return [(g.lon[best] + g.lon[nb]) / 2, (g.lat[best] + g.lat[nb]) / 2];
}

// ---------------- application (validation des changements) ----------------
// edit : résultat de computeEdit ; reactions : réactions diplomatiques des voisins (Nation Simulator)
export function applyEdit(sim, k, edit, strokes, reactions = true) {
  if (!edit.transfers.length) return null;
  const A = sim.sides[k].e, S = sim.S;
  for (const [c, to] of edit.transfers) {
    sim.flip(c, to, false);                         // changement officiel (pas une occupation)
    if (!(sim.intentional instanceof Map)) sim.intentional = new Map();
    sim.intentional.set(c, to);                     // frontière voulue : jamais « nettoyée » comme un fragment
  }
  sim.borderEdits = sim.borderEdits || [];
  const rec = { id: (sim.borderEdits.length ? sim.borderEdits[sim.borderEdits.length - 1].id : 0) + 1, t: sim.time, k, gained: Math.round(edit.gained), lost: Math.round(edit.lost), strokes: strokes.map((s) => s.map(([x, y]) => [Math.round(x * 1e4) / 1e4, Math.round(y * 1e4) / 1e4])), strips: edit.strips.map((s) => ({ poly: s.poly, owner: s.owner, cells: s.cells, bbox: s.bbox })), owners: Object.keys(edit.byOwner).map(Number) };
  sim.borderEdits.push(rec);
  if (sim.refreshAfterEdit) sim.refreshAfterEdit();
  const name = sim.sides[k].name;
  const parts = [];
  for (const [o, r] of Object.entries(edit.byOwner)) {
    const s = sim.sideOf[Number(o)];
    const on = sim.entities[o] ? sim.entities[o].name : '?';
    if (r.gained > 0) parts.push(`${Math.round(r.gained).toLocaleString('fr-FR')} km² pris à ${on}`);
    if (r.lost > 0) parts.push(`${Math.round(r.lost).toLocaleString('fr-FR')} km² cédés à ${on}`);
    // réactions : un pays qui perd du territoire sans guerre le prend très mal ; un pays qui en reçoit apprécie
    if (reactions && s >= 0 && s !== k && sim.rules.relations !== false) {
      if (r.gained > 0) {
        const hurt = clamp(12 + r.gained / 2500, 12, 75);
        addRel(sim, k, s, -hurt);
        sim.sides[s].grievance = (sim.sides[s].grievance || 0) + r.gained;
        sim.hist(s, 'war', `${name} redessine la frontière et s'empare de ${Math.round(r.gained).toLocaleString('fr-FR')} km².`);
        const P = PERSONALITIES[(sim.sides[s].ai && sim.sides[s].ai.personality) || 'opportunist'];
        const ratio = powerOf(sim.sides[s]) / Math.max(1e-6, powerOf(sim.sides[k]));
        const anger = r.gained / Math.max(500, sim.sides[s].km2 || 1) * 4;
        if (sim.rules.wars !== false && !sim.atWar[k * S + s] && sim.rng.next() < clamp(anger * P.aggr * Math.min(1.5, ratio) + (hurt > 50 ? 0.2 : 0), 0, 0.85)) {
          const w = startWar(sim, [s], [k], 'declaration');
          if (w) sim._emit({ icon: '⚔️', title: 'GUERRE', tone: 'bad', side: s, text: `${sim.sides[s].name} refuse la nouvelle frontière et déclare la guerre à ${name}.`, war: w.id });
        }
      }
      if (r.lost > 0) addRel(sim, k, s, clamp(4 + r.lost / 4000, 4, 30));
    }
  }
  const txt = `${name} redessine ses frontières : ${parts.join(', ')}.`;
  sim.chron('treaty', txt, { e: [A, ...rec.owners] });
  sim.hist(k, 'treaty', txt);
  sim._emit({ icon: '✏️', title: 'NOUVELLES FRONTIÈRES', tone: 'neutral', side: k, text: txt });
  if (sim.nation && sim.nation.isHuman(k)) sim.nation.at(k).milestone('treaty', `Frontières redessinées : ${parts.join(', ')}.`);
  return rec;
}

// bandes encore valides (le terrain n'a pas changé de mains depuis) : envoyées à la géométrie des territoires
export function activeOverrides(sim) {
  const out = [];
  for (const e of sim.borderEdits || []) for (const s of e.strips || []) {
    let okc = 0; for (const c of s.cells) if (sim.owner[c] === s.owner) okc++;
    if (okc >= s.cells.length * 0.7) out.push({ poly: s.poly, owner: s.owner, bbox: s.bbox, cells: s.cells });
  }
  return out;
}
void YEAR_SEC;
