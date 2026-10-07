// RÉORGANISATION TERRITORIALE — après chaque traité de paix (et en fin de simulation) :
//   territoires conquis -> analyse de la géométrie -> réorganisation -> frontières propres.
// 1. ANTI-ENCLAVE : chaque morceau détaché d'un pays (enclave, exclave minuscule, fragment, « pixel »)
//    est analysé ; solution choisie parmi : A) rattacher au territoire principal voisin, B) donner au pays
//    qui possède déjà la région (contact majoritaire, ou propriétaire d'avant-guerre), C) libérer une
//    zone grise capturée. On retient la solution qui déplace le moins de parcelles et respecte le
//    résultat de la guerre.
// 2. RELAXATION NATURELLE : une bande étroite de part et d'autre des nouvelles frontières est redessinée
//    par propagation (Dijkstra) depuis l'intérieur de chaque pays, avec un coût qui suit le terrain
//    (crêtes, montagnes, rivières) et pénalise tout changement de propriétaire : la frontière devient
//    une courbe organique qui épouse la géographie, sans zigzags, et chaque pays reste d'un seul tenant.
// 3. LISSAGE : derniers crochets d'une ou deux parcelles supprimés, puis nouvelle passe anti-enclave.
import { MinHeap } from './geo.js';

const NONE = 65535;

function hash(i) { let h = Math.imul(i ^ 0x9e3779b9, 2654435761); h ^= h >>> 15; h = Math.imul(h, 2246822519); return ((h ^ (h >>> 13)) >>> 0) / 4294967296; }

// toutes les composantes (8-voisinage) d'un propriétaire, limitées aux composantes qui touchent la zone
function components(sim, e, seeds, mark, stamp) {
  const g = sim.grid;
  const out = [];
  for (const c of seeds) {
    if (sim.owner[c] !== e || mark[c] === stamp) continue;
    const comp = [c]; mark[c] = stamp;
    for (let q = 0; q < comp.length; q++) {
      const a = comp[q];
      for (let k = g.nbrStart[a]; k < g.nbrStart[a + 1]; k++) { const b = g.nbr[k]; if (mark[b] !== stamp && sim.owner[b] === e) { mark[b] = stamp; comp.push(b); } }
    }
    out.push(comp);
  }
  return out;
}

// composante principale (territoire principal, CORE TERRITORY) : celle de la capitale, sinon la plus grande
export function coreMark(sim, s) {
  const sd = sim.sides[s];
  const g = sim.grid;
  if (!sim._coreMark) { sim._coreMark = new Int32Array(sim.n); sim._coreStamp = 0; }
  const mark = sim._coreMark, stamp = ++sim._coreStamp;
  let start = sd.capital >= 0 && sim.owner[sd.capital] === sd.e ? sd.capital : -1;
  let size = 0;
  if (start >= 0) {
    const st = [start]; mark[start] = stamp;
    while (st.length) { const a = st.pop(); size++; for (let k = g.nbrStart[a]; k < g.nbrStart[a + 1]; k++) { const b = g.nbr[k]; if (mark[b] !== stamp && sim.owner[b] === sd.e) { mark[b] = stamp; st.push(b); } } }
  }
  // capitale perdue ou composante très petite : la plus grande composante devient le territoire principal
  if (start < 0 || size < sd.cells * 0.25) {
    const tmp = new Int32Array(0);
    void tmp;
    const seen = new Uint8Array(sim.n);
    let best = null;
    for (let i = 0; i < sim.n; i++) {
      if (sim.owner[i] !== sd.e || seen[i]) continue;
      const comp = [i]; seen[i] = 1;
      for (let q = 0; q < comp.length; q++) { const a = comp[q]; for (let k = g.nbrStart[a]; k < g.nbrStart[a + 1]; k++) { const b = g.nbr[k]; if (!seen[b] && sim.owner[b] === sd.e) { seen[b] = 1; comp.push(b); } } }
      if (!best || comp.length > best.length) best = comp;
    }
    const stamp2 = ++sim._coreStamp;
    if (best) for (const c of best) mark[c] = stamp2;
    return { mark, stamp: stamp2, size: best ? best.length : 0 };
  }
  return { mark, stamp, size };
}

/**
 * @param region  Set de parcelles à analyser (zone de la guerre élargie)
 * @param members Set des entités concernées
 * @param prewar  Map parcelle -> propriétaire d'avant-guerre (facultatif)
 */
export function reorganize(sim, region, members, prewar = null, opts = {}) {
  const g = sim.grid;
  const geo = sim.geo;
  const stats = { enclaves: 0, exclaves: 0, islands: 0, holes: 0, relaxed: 0, smoothed: 0, cells: 0, region: region.size };
  const capitals = new Set(sim.sides.map((s) => s.capital).filter((c) => c >= 0));
  const moveTo = (c, e) => { if (sim.owner[c] === e) return; sim.flip(c, e, false); stats.cells++; };
  const isMember = (e) => members.has(e);
  // territoires voulus (régions annexées par traité, exclaves choisies par le joueur ou un scénario) : jamais
  // considérés comme des fragments accidentels
  const keep = opts.protect || sim.intentional || null;
  const kept = (c) => !!keep && keep.has(c) && (!(keep instanceof Map) || keep.get(c) === sim.owner[c]);
  const mark = new Int32Array(sim.n);
  let stamp = 0;

  // ---- 1. anti-enclave ----
  const antiEnclave = () => {
    let changed = 0;
    for (const e of members) {
      const s = sim.sideOf[e];
      if (s < 0 || sim.sides[s].cells === 0) continue;
      const sd = sim.sides[s];
      const core = coreMark(sim, s);
      const comps = components(sim, e, region, mark, ++stamp);
      for (const comp of comps) {
        if (comp.length && core.mark[comp[0]] === core.stamp) continue;     // territoire principal
        if (comp.some((x) => capitals.has(x))) continue;
        if (keep && comp.some(kept)) continue;                                  // exclave voulue
        const around = new Map();
        let coast = 0;
        for (const x of comp) {
          if (g.coastal[x]) coast++;
          for (let k = g.nbrStart[x]; k < g.nbrStart[x + 1]; k++) { const o = sim.owner[g.nbr[k]]; if (o !== e) around.set(o, (around.get(o) || 0) + 1); }
        }
        // propriétaire d'avant-guerre majoritaire de ce morceau
        let pre = e;
        if (prewar) {
          const votes = new Map();
          for (const x of comp) { const p0 = prewar.has(x) ? prewar.get(x) : e; votes.set(p0, (votes.get(p0) || 0) + 1); }
          let bv = -1; for (const [k, v] of votes) if (v > bv) { bv = v; pre = k; }
        }
        const limit = Math.max(30, Math.min(260, sd.cells * 0.05));
        if (around.size === 0) {
          // île : conservée, sauf une petite île prise pendant la guerre (rendue à son ancien propriétaire)
          if (pre !== e && comp.length <= limit && (pre === NONE || (sim.sideOf[pre] >= 0 && sim.sides[sim.sideOf[pre]].cells > 0))) {
            for (const x of comp) moveTo(x, pre); stats.islands++; changed++;
          }
          continue;
        }
        const big = comp.length > limit * (coast >= 3 ? 1 : 2.5);
        if (big) continue;   // exclave importante (conquête réelle) : conservée
        // options : A/B -> voisin au contact majoritaire (en préférant un pays concerné par la guerre),
        //           ancien propriétaire s'il borde le morceau ; C -> zone grise si elle entoure le morceau
        let best = -1, bv = -1;
        for (const [o, v] of around) {
          if (o !== NONE && (!sim.entities[o] || sim.entities[o].kind === 'neutral')) continue;
          let score = v + (isMember(o) ? 0.5 : 0) + (o === pre ? comp.length * 0.3 : 0);
          if (o === NONE) score = pre === NONE ? v : v * 0.25;
          if (score > bv) { bv = score; best = o; }
        }
        if (best < 0 && best !== NONE) continue;
        for (const x of comp) moveTo(x, best);
        if (best === NONE) stats.islands++; else if (around.size === 1) stats.enclaves++; else stats.exclaves++;
        changed++;
      }
    }
    // trous : petites zones grises enfermées dans un seul pays concerné
    const seenHole = new Set();
    for (const c of region) {
      if (sim.owner[c] !== NONE || seenHole.has(c) || c >= g.nGrid) continue;
      const comp = [c]; seenHole.add(c);
      let open = false;
      const around = new Map();
      for (let q = 0; q < comp.length && comp.length < 80; q++) {
        const a = comp[q];
        for (let k = g.nbrStart[a]; k < g.nbrStart[a + 1]; k++) {
          const b = g.nbr[k]; const o = sim.owner[b];
          if (o === NONE) { if (!seenHole.has(b)) { seenHole.add(b); comp.push(b); } }
          else around.set(o, (around.get(o) || 0) + 1);
        }
      }
      if (comp.length >= 80) open = true;
      if (open || around.size !== 1) continue;
      const [o] = around.keys();
      if (!isMember(o)) continue;
      for (const x of comp) moveTo(x, o);
      stats.holes++; changed++;
    }
    return changed;
  };
  antiEnclave();

  // ---- 2. relaxation naturelle de la frontière ----
  if (geo && opts.relax !== false) {
    const band = new Uint8Array(sim.n);
    const bandList = [];
    for (const c of region) {
      const e = sim.owner[c];
      if (!isMember(e) || c >= g.nGrid) continue;
      for (let k = g.nbrStart[c]; k < g.nbrStart[c + 1]; k++) {
        const o = sim.owner[g.nbr[k]];
        if (o !== e && isMember(o)) { band[c] = 1; bandList.push(c); break; }
      }
    }
    // bande de 2 parcelles de chaque côté (sans capitales)
    for (let ring = 0; ring < 2; ring++) {
      const add = [];
      for (const c of bandList) for (let k = g.nbrStart[c]; k < g.nbrStart[c + 1]; k++) { const b = g.nbr[k]; if (!band[b] && b < g.nGrid && region.has(b) && isMember(sim.owner[b])) { band[b] = 1; add.push(b); } }
      bandList.push(...add);
    }
    for (const c of bandList) if (capitals.has(c) || kept(c)) band[c] = 0;
    // la frontière d'un territoire voulu (région annexée par traité) est conservée telle quelle
    if (keep) for (const c of bandList) {
      if (!band[c]) continue;
      for (let k = g.nbrStart[c]; k < g.nbrStart[c + 1] && band[c]; k++) {
        const j = g.nbr[k];
        if (kept(j)) { band[c] = 0; break; }
        for (let q = g.nbrStart[j]; q < g.nbrStart[j + 1]; q++) if (kept(g.nbr[q])) { band[c] = 0; break; }
      }
    }
    if (bandList.length) {
      const dist = new Float32Array(sim.n).fill(Infinity);
      const lab = new Int32Array(sim.n).fill(-1);
      const heap = new MinHeap(sim.n + 16);
      // graines : parcelles hors bande qui touchent la bande
      for (const c of bandList) {
        if (!band[c]) continue;
        for (let k = g.nbrStart[c]; k < g.nbrStart[c + 1]; k++) {
          const b = g.nbr[k];
          if (band[b] || !isMember(sim.owner[b]) || dist[b] === 0) continue;
          dist[b] = 0; lab[b] = sim.owner[b]; heap.push(0, b);
        }
      }
      for (const c of bandList) if (!band[c]) { dist[c] = 0; lab[c] = sim.owner[c]; heap.push(0, c); }
      while (heap.size) {
        const i = heap.pop();
        const d = dist[i], e = lab[i];
        for (let k = g.nbrStart[i]; k < g.nbrStart[i + 1]; k++) {
          const j = g.nbr[k];
          if (!band[j]) continue;
          const keep = sim.owner[j] === e ? 0 : 1.7;              // respecter le résultat de la guerre
          const terr = geo.barrier[j] * 1.1 + (geo.river[i] && !geo.river[j] ? 0.9 : 0);
          const c = 1 + terr + keep + hash(j) * 0.45;              // irrégularité organique
          const nd = d + c;
          if (nd < dist[j]) { dist[j] = nd; lab[j] = e; heap.push(nd, j); }
        }
      }
      for (const c of bandList) if (band[c] && lab[c] >= 0 && lab[c] !== sim.owner[c]) { moveTo(c, lab[c]); stats.relaxed++; }
    }
  }

  // ---- 3. lissage des derniers crochets ----
  for (let pass = 0; pass < 4; pass++) {
    const flips = [];
    for (const c of region) {
      const e = sim.owner[c];
      if (!isMember(e) || capitals.has(c) || c >= g.nGrid || kept(c)) continue;
      const counts = new Map();
      let same = 0, tot = 0;
      for (let k = g.nbrStart[c]; k < g.nbrStart[c + 1]; k++) { const o = sim.owner[g.nbr[k]]; tot++; if (o === e) same++; else counts.set(o, (counts.get(o) || 0) + 1); }
      if (tot < 6) continue;
      let best = -1, bv = 0;
      for (const [o, v] of counts) if (isMember(o) && v > bv) { bv = v; best = o; }
      if (best < 0) continue;
      const sticky = geo && (geo.river[c] >= 2 || geo.ridge[c]) ? 1 : 0;
      if ((bv >= 5 + sticky && same <= 2 - sticky) || (same <= 1 && bv >= 4)) flips.push([c, best]);
    }
    if (!flips.length) break;
    for (const [c, e] of flips) { moveTo(c, e); stats.smoothed++; }
  }
  antiEnclave();
  return stats;
}

// nettoyage global (fin de simulation) : fragments minuscules de tous les pays, carte lisible
export function globalTidy(sim) {
  const members = new Set(sim.sides.filter((s) => !s.eliminated).map((s) => s.e));
  const region = new Set();
  for (let i = 0; i < sim.n; i++) if (members.has(sim.owner[i])) region.add(i);
  return reorganize(sim, region, members, null, { relax: false });
}
