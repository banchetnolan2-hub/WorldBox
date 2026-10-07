// GÉOGRAPHIE SIMULÉE — informations physiques par parcelle, calculées une fois par grille :
// altitude, relief (rugosité), distance à la côte, humidité, température, biome, rivières
// (écoulement D8 + remplissage des dépressions + accumulation), crêtes, superficie.
// Utilisé par le combat (terrain), les mouvements, le ravitaillement, les frontières naturelles
// (BORDER CLEANUP, NATURAL BORDER) et le rendu (biomes, rivières).
// Module pur (sans DOM).

export const BIOME = { PLAINS: 0, FOREST: 1, HILLS: 2, MOUNTAINS: 3, DESERT: 4, TUNDRA: 5 };
export const BIOME_NAMES = ['Plaines', 'Forêts', 'Collines', 'Montagnes', 'Désert', 'Toundra'];
export const BIOME_KEYS = ['plains', 'forest', 'hills', 'mountains', 'desert', 'tundra'];
export const BIOME_COLORS = ['#9cb86a', '#4f8a4b', '#b2a06b', '#8d8479', '#d9c28a', '#c9d3d6'];
const DEG = Math.PI / 180;

// hachage déterministe (bruit de texture)
function hash2(x, y) {
  let h = (x * 374761393 + y * 668265263) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
function valueNoise(x, y, s) {
  const fx = x / s, fy = y / s;
  const x0 = Math.floor(fx), y0 = Math.floor(fy);
  const tx = fx - x0, ty = fy - y0;
  const u = tx * tx * (3 - 2 * tx), v = ty * ty * (3 - 2 * ty);
  const a = hash2(x0, y0), b = hash2(x0 + 1, y0), c = hash2(x0, y0 + 1), d = hash2(x0 + 1, y0 + 1);
  return (a + (b - a) * u) * (1 - v) + (c + (d - c) * u) * v;
}

export class MinHeap {
  constructor(cap) { this.k = new Float32Array(cap); this.v = new Int32Array(cap); this.n = 0; }
  push(key, val) {
    let i = this.n++;
    const K = this.k, V = this.v;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (K[p] <= key) break;
      K[i] = K[p]; V[i] = V[p]; i = p;
    }
    K[i] = key; V[i] = val;
  }
  pop() {
    const K = this.k, V = this.v;
    const top = V[0];
    const n = --this.n;
    if (n > 0) {
      const key = K[n], val = V[n];
      let i = 0;
      for (;;) {
        let c = 2 * i + 1;
        if (c >= n) break;
        if (c + 1 < n && K[c + 1] < K[c]) c++;
        if (K[c] >= key) break;
        K[i] = K[c]; V[i] = V[c]; i = c;
      }
      K[i] = key; V[i] = val;
    }
    return top;
  }
  get size() { return this.n; }
}

/**
 * @param grid     grille mondiale (worldGrid)
 * @param sampler  { heightKm(lat, lon) } : relief réel de la Terre ou terrain créé
 * @param opts     { override: Uint8Array(W*H) biomes peints (0 = auto, 1 + biome) }
 */
export function computeGeo(grid, sampler, opts = {}) {
  const n = grid.n, N = grid.nGrid;
  const t0 = Date.now();
  const elev = new Float32Array(n);
  const rough = new Float32Array(n);
  const s = grid.RES * 0.3;
  for (let i = 0; i < N; i++) {
    const la = grid.lat[i], lo = grid.lon[i];
    if (!sampler) { elev[i] = 0.3; continue; }
    const h0 = sampler.heightKm(la, lo);
    const h1 = sampler.heightKm(la + s, lo + s), h2 = sampler.heightKm(la - s, lo - s);
    const h3 = sampler.heightKm(la + s, lo - s), h4 = sampler.heightKm(la - s, lo + s);
    const mx = Math.max(h0, h1, h2, h3, h4), mn = Math.min(h0, h1, h2, h3, h4);
    elev[i] = Math.max(0.005, (h0 * 2 + h1 + h2 + h3 + h4) / 6);
    rough[i] = mx - mn;
  }
  // rugosité : écart aux voisins
  for (let i = 0; i < N; i++) {
    let mx = elev[i], mn = elev[i];
    for (let k = grid.nbrStart[i]; k < grid.nbrStart[i + 1]; k++) { const j = grid.nbr[k]; if (j < N) { const e = elev[j]; if (e > mx) mx = e; if (e < mn) mn = e; } }
    rough[i] = Math.max(rough[i], (mx - mn) * 0.8);
  }
  // distance à la côte (en parcelles), parcours en largeur multi-sources
  const coastDist = new Uint16Array(n).fill(65535);
  let q = new Int32Array(n), qh = 0, qt = 0;
  for (let i = 0; i < n; i++) if (grid.coastal[i]) { coastDist[i] = 0; q[qt++] = i; }
  while (qh < qt) {
    const a = q[qh++];
    const d = coastDist[a] + 1;
    for (let k = grid.nbrStart[a]; k < grid.nbrStart[a + 1]; k++) { const b = grid.nbr[k]; if (coastDist[b] > d) { coastDist[b] = d; q[qt++] = b; } }
  }
  for (let i = 0; i < n; i++) if (coastDist[i] === 65535) coastDist[i] = 200;

  // climat simplifié : humidité (océan + bandes de latitude) et température (latitude + altitude)
  const moist = new Float32Array(n), temp = new Float32Array(n);
  const biome = new Uint8Array(n);
  const W = grid.W;
  const override = opts.override || null;
  for (let i = 0; i < n; i++) {
    const la = grid.lat[i], al = Math.abs(la);
    const p = grid.pos[i];
    const x = p >= 0 ? p % W : 0, y = p >= 0 ? (p / W) | 0 : 0;
    const d = coastDist[i];
    let m = Math.exp(-d / 30);
    if (al < 12) m += 0.5 * (1 - al / 12);                                       // zone intertropicale
    const sub = al > 14 && al < 34 ? Math.sin((al - 14) / 20 * Math.PI) : 0;     // anticyclones subtropicaux
    m -= 0.36 * sub * Math.min(1, Math.max(0, (d - 6) / 22));
    if (al > 38 && al < 62) m += 0.25 * Math.sin((al - 38) / 24 * Math.PI);        // zones tempérées
    const nz = valueNoise(x, y, 9) * 0.6 + valueNoise(x + 911, y + 377, 3.5) * 0.4;
    m += (nz - 0.5) * 0.3;
    moist[i] = Math.max(0, Math.min(1.3, m));
    const T = 27 - 0.62 * al - 6.5 * elev[i];
    temp[i] = T;
    let b;
    const e = elev[i], r = rough[i];
    if (e > 2.0 || (e > 1.15 && r > 0.75) || r > 1.3) b = BIOME.MOUNTAINS;
    else if (T < -13.5 || (T < -9.5 && moist[i] < 0.16)) b = BIOME.TUNDRA;
    else if (r > 0.34 || e > 1.45) b = BIOME.HILLS;
    else if (moist[i] < 0.24 && T > 6) b = BIOME.DESERT;
    else if (moist[i] + (nz - 0.5) * 0.5 > 0.7 || (T < 1 && moist[i] + (nz - 0.5) * 0.4 > 0.3)) b = BIOME.FOREST;
    else b = BIOME.PLAINS;
    if (override && p >= 0 && override[p]) b = override[p] - 1;
    biome[i] = b;
  }

  // rivières : remplissage des dépressions (priority-flood) depuis la mer, puis accumulation
  const recv = new Int32Array(n).fill(-1);
  const order = new Int32Array(n);
  const done = new Uint8Array(n);
  const heap = new MinHeap(n + 8);
  let no = 0;
  for (let i = 0; i < N; i++) if (grid.coastal[i]) { heap.push(elev[i], i); done[i] = 1; }
  // masses terrestres sans côte (rare) : graine au point le plus bas
  const level = new Float32Array(n);
  while (heap.size) {
    const a = heap.pop();
    order[no++] = a;
    const la = level[a] = Math.max(level[a], elev[a]);
    for (let k = grid.nbrStart[a]; k < grid.nbrStart[a + 1]; k++) {
      const b = grid.nbr[k];
      if (done[b] || b >= N) continue;
      done[b] = 1;
      recv[b] = a;
      level[b] = Math.max(elev[b], la + 1e-5);
      heap.push(level[b], b);
    }
  }
  for (let i = 0; i < N; i++) if (!done[i]) { done[i] = 1; order[no++] = i; }
  const acc = new Float32Array(n);
  for (let k = no - 1; k >= 0; k--) {
    const a = order[k];
    acc[a] += grid.area[a] * (0.15 + moist[a]) * (temp[a] > -12 ? 1 : 0.3);
    const r = recv[a];
    if (r >= 0) acc[r] += acc[a];
  }
  const river = new Uint8Array(n);
  const RIV = [70, 300, 1100];
  const riverSegs = [];
  for (let i = 0; i < N; i++) {
    const a = acc[i];
    if (a < RIV[0] || biome[i] === BIOME.MOUNTAINS && a < RIV[1]) continue;
    river[i] = a >= RIV[2] ? 3 : a >= RIV[1] ? 2 : 1;
  }
  for (let i = 0; i < N; i++) {
    if (!river[i]) continue;
    const r = recv[i];
    if (r >= 0) riverSegs.push(i, r, river[i]);
    else riverSegs.push(i, -1, river[i]);
  }

  // crêtes : parcelles de montagne plus hautes que la moyenne de leurs voisines
  const ridge = new Uint8Array(n);
  for (let i = 0; i < N; i++) {
    if (biome[i] !== BIOME.MOUNTAINS && biome[i] !== BIOME.HILLS) continue;
    let sum = 0, c = 0;
    for (let k = grid.nbrStart[i]; k < grid.nbrStart[i + 1]; k++) { const j = grid.nbr[k]; if (j < N) { sum += elev[j]; c++; } }
    if (c && elev[i] > sum / c + (biome[i] === BIOME.MOUNTAINS ? 0.05 : 0.08)) ridge[i] = 1;
  }

  // micro-pays : héritent de la parcelle hôte
  for (let i = N; i < n; i++) {
    const h = grid.nbrStart[i] < grid.nbrStart[i + 1] ? grid.nbr[grid.nbrStart[i]] : -1;
    if (h >= 0) { elev[i] = elev[h]; biome[i] = biome[h]; moist[i] = moist[h]; temp[i] = temp[h]; }
  }

  // superficie (km²) : 0,25° × 0,25° × cos(latitude)
  const side = grid.RES * 111.32;
  const km2 = new Float32Array(n);
  for (let i = 0; i < n; i++) km2[i] = side * side * grid.area[i];

  // coût de franchissement (frontières naturelles, déplacements)
  const barrier = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    let c = 0;
    if (biome[i] === BIOME.MOUNTAINS) c += 2.2; else if (biome[i] === BIOME.HILLS) c += 0.7;
    if (ridge[i]) c += 2.5;
    if (river[i]) c += 1.2 + river[i] * 0.9;
    if (biome[i] === BIOME.FOREST) c += 0.3;
    if (biome[i] === BIOME.DESERT) c += 0.4;
    barrier[i] = c;
  }
  const counts = [0, 0, 0, 0, 0, 0];
  for (let i = 0; i < N; i++) counts[biome[i]]++;
  return { elev, rough, coastDist, moist, temp, biome, river, riverSegs: Int32Array.from(riverSegs), recv, acc, ridge, km2, barrier, counts, ms: Date.now() - t0 };
}

// cache par grille (et par version du terrain / des biomes peints)
export function geoFor(grid, sampler, opts = {}) {
  const key = (sampler && sampler.version !== undefined ? sampler.version : 'earth') + ':' + (opts.overrideVersion || 0);
  if (grid._geo && grid._geoKey === key) return grid._geo;
  grid._geo = computeGeo(grid, sampler, opts);
  grid._geoKey = key;
  return grid._geo;
}

// ---- effets du terrain sur le combat ----
// multiplicateurs d'attaque par type d'unité et par biome
//                              plaines forêt collines montagnes désert toundra
export const TERRAIN_ATK = {
  inf: [1.0, 1.1, 1.05, 1.05, 0.9, 0.9],
  arm: [1.45, 0.65, 0.85, 0.4, 1.35, 0.75],
  art: [1.2, 0.85, 1.1, 0.85, 1.15, 1.0],
  rec: [1.15, 0.85, 1.0, 0.75, 1.2, 0.95],
};
export const TERRAIN_DEF = [1.0, 1.28, 1.32, 1.85, 0.95, 1.12];
export const TERRAIN_SPEED = [1.0, 0.75, 0.8, 0.5, 0.85, 0.7];
export const RIVER_DEF = [1, 1.18, 1.32, 1.5];
