// WORLD — routes maritimes (A* sur une grille océanique de 1°) et trajets aériens (arcs)
import { EARTH_R, latLonToXYZ } from './worldGrid.js';

const DEG = Math.PI / 180;

class MinHeap {
  constructor() { this.k = []; this.v = []; }
  get size() { return this.k.length; }
  push(key, val) {
    const k = this.k, v = this.v;
    let i = k.length; k.push(key); v.push(val);
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (k[p] <= key) break;
      k[i] = k[p]; v[i] = v[p]; i = p;
    }
    k[i] = key; v[i] = val;
  }
  pop() {
    const k = this.k, v = this.v;
    const top = v[0];
    const lk = k.pop(), lv = v.pop();
    if (k.length) {
      let i = 0;
      const n = k.length;
      for (;;) {
        let c = 2 * i + 1;
        if (c >= n) break;
        if (c + 1 < n && k[c + 1] < k[c]) c++;
        if (k[c] >= lk) break;
        k[i] = k[c]; v[i] = v[c]; i = c;
      }
      k[i] = lk; v[i] = lv;
    }
    return top;
  }
}

export class Navigator {
  constructor(grid) {
    this.grid = grid;
    this.W = grid.NAV_W; this.H = grid.NAV_H;
    this.res = 360 / this.W;
    this.nav = grid.nav;
    this.cache = new Map();
    const N = this.W * this.H;
    this.nlat = new Float32Array(N); this.nlon = new Float32Array(N);
    this.nx = new Float32Array(N * 3);
    for (let y = 0; y < this.H; y++) for (let x = 0; x < this.W; x++) {
      const k = y * this.W + x;
      const la = 90 - (y + 0.5) * this.res, lo = -180 + (x + 0.5) * this.res;
      this.nlat[k] = la; this.nlon[k] = lo;
      const p = latLonToXYZ(la, lo);
      this.nx[k * 3] = p[0]; this.nx[k * 3 + 1] = p[1]; this.nx[k * 3 + 2] = p[2];
    }
    this.gScore = new Float32Array(N);
    this.came = new Int32Array(N);
    this.stamp = new Int32Array(N);
    this.closed = new Int32Array(N);
    this.run = 0;
    // bassins maritimes reliés (8-voisinage, longitude circulaire) : deux nœuds de bassins différents
    // (mer Caspienne, grands lacs…) ne sont jamais reliés -> inutile de lancer une recherche
    this.basin = new Int32Array(N).fill(-1);
    let nb = 0;
    const st = [];
    for (let s0 = 0; s0 < N; s0++) {
      if (!this.nav[s0] || this.basin[s0] >= 0) continue;
      this.basin[s0] = nb; st.push(s0);
      while (st.length) {
        const cur = st.pop(), cx = cur % this.W, cy = (cur / this.W) | 0;
        for (let dy = -1; dy <= 1; dy++) {
          const ny = cy + dy; if (ny < 0 || ny >= this.H) continue;
          for (let dx = -1; dx <= 1; dx++) {
            const nk = ny * this.W + ((cx + dx + this.W) % this.W);
            if (this.nav[nk] && this.basin[nk] < 0) { this.basin[nk] = nb; st.push(nk); }
          }
        }
      }
      nb++;
    }
  }

  _d(a, b) {
    const x = this.nx;
    const dot = x[a * 3] * x[b * 3] + x[a * 3 + 1] * x[b * 3 + 1] + x[a * 3 + 2] * x[b * 3 + 2];
    return Math.acos(Math.max(-1, Math.min(1, dot))) * EARTH_R;
  }

  // nœud maritime navigable le plus proche d'une cellule côtière
  seaNodeNear(cell) {
    const g = this.grid;
    const cx = Math.floor((g.lon[cell] + 180) / this.res), cy = Math.floor((90 - g.lat[cell]) / this.res);
    let best = -1, bestD = Infinity;
    for (let r = 0; r <= 6 && best < 0; r++) {
      for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        const y = cy + dy; if (y < 0 || y >= this.H) continue;
        const k = y * this.W + ((cx + dx + this.W) % this.W);
        if (!this.nav[k]) continue;
        const d = dx * dx + dy * dy;
        if (d < bestD) { bestD = d; best = k; }
      }
    }
    return best;
  }

  // chemin entre deux nœuds maritimes (liste d'index), null si impossible
  path(a, b) {
    if (a < 0 || b < 0) return null;
    if (a === b) return [a];
    if (this.basin[a] !== this.basin[b]) return null;
    const key = a < b ? a * 300000 + b : b * 300000 + a;
    if (this.cache.has(key)) {
      const p = this.cache.get(key);
      return p && (p[0] === a ? p : [...p].reverse());
    }
    // calcul toujours dans le même sens (plus petit -> plus grand) : le résultat ne dépend pas de l'ordre des
    // requêtes ni du cache (déterminisme des parties et des reprises de sauvegarde)
    if (a > b) { const p = this.path(b, a); return p && [...p].reverse(); }
    const run = ++this.run;
    const { W, H } = this;
    const heap = new MinHeap();
    this.stamp[a] = run; this.gScore[a] = 0; this.came[a] = -1;
    heap.push(this._d(a, b), a);
    let found = false, iter = 0;
    while (heap.size && iter++ < 400000) {
      const cur = heap.pop();
      if (cur === b) { found = true; break; }
      if (this.closed[cur] === run) continue;
      this.closed[cur] = run;
      const cx = cur % W, cy = (cur / W) | 0;
      for (let dy = -1; dy <= 1; dy++) {
        const ny = cy + dy; if (ny < 0 || ny >= H) continue;
        for (let dx = -1; dx <= 1; dx++) {
          if (!dx && !dy) continue;
          const nk = ny * W + ((cx + dx + W) % W);
          if (!this.nav[nk] || this.closed[nk] === run) continue;
          const g = this.gScore[cur] + this._d(cur, nk);
          if (this.stamp[nk] !== run || g < this.gScore[nk]) {
            this.stamp[nk] = run; this.gScore[nk] = g; this.came[nk] = cur;
            heap.push(g + this._d(nk, b) * 1.05, nk);
          }
        }
      }
    }
    let result = null;
    if (found) {
      result = [];
      for (let k = b; k >= 0; k = this.came[k]) result.push(k);
      result.reverse();
    }
    if (this.cache.size > 3000) this.cache.clear();
    this.cache.set(key, result);
    return result;
  }

  // Route maritime complète entre deux cellules terrestres côtières -> points 3D (sphère unité)
  seaRoute(fromCell, toCell) {
    const a = this.seaNodeNear(fromCell), b = this.seaNodeNear(toCell);
    const nodes = this.path(a, b);
    if (!nodes) return null;
    const g = this.grid;
    const pts = [[g.xyz[fromCell * 3], g.xyz[fromCell * 3 + 1], g.xyz[fromCell * 3 + 2]]];
    // simplification : un nœud sur deux (le lissage est fait au rendu)
    for (let k = 0; k < nodes.length; k++) {
      if (k % 3 && k !== nodes.length - 1) continue;
      const q = nodes[k];
      pts.push([this.nx[q * 3], this.nx[q * 3 + 1], this.nx[q * 3 + 2]]);
    }
    pts.push([g.xyz[toCell * 3], g.xyz[toCell * 3 + 1], g.xyz[toCell * 3 + 2]]);
    return smoothPath(pts, 2);
  }
}

// Lissage de Chaikin puis reprojection sur la sphère
export function smoothPath(pts, iterations = 2) {
  let p = pts;
  for (let it = 0; it < iterations; it++) {
    if (p.length < 3) break;
    const out = [p[0]];
    for (let k = 0; k < p.length - 1; k++) {
      const a = p[k], b = p[k + 1];
      out.push([a[0] * 0.75 + b[0] * 0.25, a[1] * 0.75 + b[1] * 0.25, a[2] * 0.75 + b[2] * 0.25]);
      out.push([a[0] * 0.25 + b[0] * 0.75, a[1] * 0.25 + b[1] * 0.75, a[2] * 0.25 + b[2] * 0.75]);
    }
    out.push(p[p.length - 1]);
    p = out;
  }
  return p.map((v) => { const l = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / l, v[1] / l, v[2] / l]; });
}

// Arc de grand cercle (transport aérien)
export function greatCircle(a, b, steps = 32) {
  const dot = Math.max(-1, Math.min(1, a[0] * b[0] + a[1] * b[1] + a[2] * b[2]));
  const om = Math.acos(dot);
  const out = [];
  for (let k = 0; k <= steps; k++) {
    const t = k / steps;
    let p;
    if (om < 1e-6) p = a;
    else {
      const s1 = Math.sin((1 - t) * om) / Math.sin(om), s2 = Math.sin(t * om) / Math.sin(om);
      p = [a[0] * s1 + b[0] * s2, a[1] * s1 + b[1] * s2, a[2] * s1 + b[2] * s2];
    }
    out.push(p);
  }
  return out;
}

export function polylineLengthKm(pts) {
  let L = 0;
  for (let k = 1; k < pts.length; k++) {
    const a = pts[k - 1], b = pts[k];
    L += Math.acos(Math.max(-1, Math.min(1, a[0] * b[0] + a[1] * b[1] + a[2] * b[2]))) * EARTH_R;
  }
  return L;
}

export function toLatLon(v) {
  return [Math.asin(Math.max(-1, Math.min(1, v[1]))) / DEG, Math.atan2(v[0], v[2]) / DEG];
}
