// WORLD — terrain modifiable (CREATE WORLD) : champ d'altitude continu (km, négatif = océan) sur une
// grille équirectangulaire 2048 × 1024. Les côtes sont la ligne d'altitude 0 de ce champ interpolé :
// elles restent lisses à tous les zooms. La grille de simulation (0,25°), la navigation maritime et le
// relief affiché sont tous dérivés de ce même champ -> une seule source de vérité pour la géométrie.
import { buildWorldGrid } from './worldGrid.js';

export const TW = 2048, TH = 1024;
export const SEA = 65535, NONE = 65535, LAND_UNOWNED = 65535;
const DEG = Math.PI / 180;

export class Terrain {
  constructor(elev, W = TW, H = TH) {
    this.W = W; this.H = H;
    this.elev = elev || new Float32Array(W * H).fill(-3.2);
    this.version = 0;
  }

  clone() { const t = new Terrain(Float32Array.from(this.elev), this.W, this.H); return t; }

  // altitudes arrondies au pas de sauvegarde (4 m) : le monde rechargé est rigoureusement identique
  quantize(y0 = 0, y1 = this.H - 1) {
    const e = this.elev;
    for (let k = y0 * this.W, end = (y1 + 1) * this.W; k < end; k++) e[k] = Math.max(-2750, Math.min(2250, Math.round(e[k] * 250))) * 0.004;
    return this;
  }

  // ---- échantillonnage (même interface que Relief) ----
  heightKm(lat, lon) {
    const { W, H, elev } = this;
    const fx = ((lon + 180) / 360) * W - 0.5, fy = ((90 - lat) / 180) * H - 0.5;
    const x0 = Math.floor(fx), y0 = Math.max(0, Math.min(H - 2, Math.floor(fy)));
    const tx = fx - x0, ty = Math.max(0, Math.min(1, fy - y0));
    const xa = ((x0 % W) + W) % W, xb = (xa + 1) % W;
    const a = elev[y0 * W + xa], b = elev[y0 * W + xb], c = elev[(y0 + 1) * W + xa], d = elev[(y0 + 1) * W + xb];
    return (a + (b - a) * tx) * (1 - ty) + (c + (d - c) * tx) * ty;
  }
  heightAtXYZ(x, y, z) {
    const l = Math.hypot(x, y, z) || 1;
    return this.heightKm(Math.asin(Math.max(-1, Math.min(1, y / l))) / DEG, Math.atan2(x, z) / DEG);
  }

  mipLevels() {
    const levels = [{ data: Float32Array.from(this.elev), width: this.W, height: this.H }];
    let cur = levels[0].data, W = this.W, H = this.H;
    while (W > 1 || H > 1) {
      const nW = Math.max(1, W >> 1), nH = Math.max(1, H >> 1);
      const nxt = new Float32Array(nW * nH);
      for (let y = 0; y < nH; y++) {
        const y0 = Math.min(H - 1, y * 2), y1 = Math.min(H - 1, y * 2 + 1);
        for (let x = 0; x < nW; x++) {
          const x0 = Math.min(W - 1, x * 2), x1 = Math.min(W - 1, x * 2 + 1);
          nxt[y * nW + x] = (cur[y0 * W + x0] + cur[y0 * W + x1] + cur[y1 * W + x0] + cur[y1 * W + x1]) * 0.25;
        }
      }
      levels.push({ data: nxt, width: nW, height: nH });
      cur = nxt; W = nW; H = nH;
    }
    return levels;
  }

  // ---- fabriques ----
  static ocean(depth = -3.4) { return new Terrain(new Float32Array(TW * TH).fill(depth)).quantize(); }

  // depuis le relief réel de la Terre (4096 × 2048 -> 2048 × 1024)
  static fromRelief(relief) {
    const t = new Terrain();
    const e = t.elev, h = relief.h, RW = relief.W;
    for (let y = 0; y < TH; y++) {
      for (let x = 0; x < TW; x++) {
        const a = (2 * y) * RW + 2 * x;
        e[y * TW + x] = (h[a] + h[a + 1] + h[a + RW] + h[a + RW + 1]) * 0.001; // (×4 m) / 4 / 1000
      }
    }
    return t.quantize();
  }

  // continents aléatoires (bruit fractal sur la sphère), ~ 30 % de terres
  static random(seed = 1) {
    const t = new Terrain();
    const noise = makeNoise3(seed);
    const e = t.elev;
    for (let y = 0; y < TH; y++) {
      const la = (90 - (y + 0.5) * 180 / TH) * DEG;
      const cy = Math.sin(la), cr = Math.cos(la);
      for (let x = 0; x < TW; x++) {
        const lo = (-180 + (x + 0.5) * 360 / TW) * DEG;
        const px = cr * Math.sin(lo), pz = cr * Math.cos(lo);
        // continents (basse fréquence, distordue) + détails
        const wx = noise(px * 1.3 + 7, cy * 1.3, pz * 1.3) * 0.6, wy = noise(px * 1.3, cy * 1.3 + 11, pz * 1.3) * 0.6;
        let c = fbm(noise, px * 1.6 + wx, cy * 1.6 + wy, pz * 1.6, 4) - 0.07;
        c -= Math.max(0, Math.abs(cy) - 0.82) * 1.8; // pôles plutôt océaniques
        const detail = fbm(noise, px * 6 + 3, cy * 6, pz * 6, 4);
        const ridge = 1 - Math.abs(noise(px * 3.2 + 5, cy * 3.2 + 5, pz * 3.2 + 5));
        let hkm;
        if (c > 0) hkm = 0.05 + c * 3.2 + Math.pow(ridge, 4) * 4.2 * Math.min(1, c * 6) + (detail + 0.2) * 0.6 * Math.min(1, c * 8);
        else hkm = Math.max(-5.5, c * 11 - 0.12 + detail * 0.4);
        e[y * TW + x] = hkm;
      }
    }
    return t.quantize();
  }
}

// ---------- bruit 3D déterministe ----------
function makeNoise3(seed) {
  let s = (seed >>> 0) || 1;
  const rnd = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
  const perm = new Uint8Array(512), grad = new Float32Array(256);
  const p = [...Array(256).keys()];
  for (let k = 255; k > 0; k--) { const j = Math.floor(rnd() * (k + 1)); [p[k], p[j]] = [p[j], p[k]]; }
  for (let k = 0; k < 512; k++) perm[k] = p[k & 255];
  for (let k = 0; k < 256; k++) grad[k] = rnd() * 2 - 1;
  const fade = (t) => t * t * t * (t * (t * 6 - 15) + 10);
  const h = (x, y, z) => grad[perm[perm[perm[x & 255] + (y & 255)] + (z & 255)]];
  return (x, y, z) => {
    const X = Math.floor(x), Y = Math.floor(y), Z = Math.floor(z);
    const fx = x - X, fy = y - Y, fz = z - Z;
    const u = fade(fx), v = fade(fy), w = fade(fz);
    const l = (a, b, t) => a + (b - a) * t;
    return l(
      l(l(h(X, Y, Z), h(X + 1, Y, Z), u), l(h(X, Y + 1, Z), h(X + 1, Y + 1, Z), u), v),
      l(l(h(X, Y, Z + 1), h(X + 1, Y, Z + 1), u), l(h(X, Y + 1, Z + 1), h(X + 1, Y + 1, Z + 1), u), v), w);
  };
}
function fbm(noise, x, y, z, oct) {
  let v = 0, a = 0.5, f = 1;
  for (let k = 0; k < oct; k++) { v += noise(x * f, y * f, z * f) * a; a *= 0.5; f *= 2.03; }
  return v;
}

// ---------- grille de simulation dérivée du terrain ----------
export const GW = 1440, GH = 720, GRES = 0.25, NAV_W = 720, NAV_H = 360;

// raster des propriétaires (GW × GH) : SEA en mer, NONE = terre sans pays, sinon index de l'entité
export function buildGridFromTerrain(terrain, raster) {
  const cells = new Uint16Array(GW * GH).fill(SEA);
  const landAt = new Uint8Array(GW * GH);
  for (let y = 0; y < GH; y++) {
    const la = 90 - (y + 0.5) * GRES;
    for (let x = 0; x < GW; x++) {
      const lo = -180 + (x + 0.5) * GRES;
      if (terrain.heightKm(la, lo) > 0) { landAt[y * GW + x] = 1; cells[y * GW + x] = 0; }
    }
  }
  // navigation (0,5°) : navigable si au moins 3 échantillons sur 4 sont en mer
  const nav = new Uint8Array(NAV_W * NAV_H);
  for (let y = 0; y < NAV_H; y++) {
    for (let x = 0; x < NAV_W; x++) {
      let sea = 0;
      for (let sy = 0; sy < 2; sy++) for (let sx = 0; sx < 2; sx++) if (!landAt[(y * 2 + sy) * GW + x * 2 + sx]) sea++;
      nav[y * NAV_W + x] = sea >= 3 ? 1 : 0;
    }
  }
  const header = { version: 2, W: GW, H: GH, RES: GRES, SEA, NAV_W, NAV_H, territories: [], micro: [], custom: true };
  const grid = buildWorldGrid(header, cells, nav);
  const owner = new Uint16Array(grid.n).fill(NONE);
  if (raster) for (let i = 0; i < grid.n; i++) { const v = raster[grid.pos[i]]; owner[i] = v === SEA ? NONE : v; }
  grid.origin = Uint16Array.from(owner);
  grid.landAt = landAt;
  return { grid, owner };
}

// raster des propriétaires depuis une grille + tableau de propriétaires
export function rasterFromOwner(grid, owner) {
  const r = new Uint16Array(GW * GH).fill(SEA);
  for (let i = 0; i < grid.n; i++) { const p = grid.pos[i]; if (p >= 0) r[p] = owner[i]; }
  return r;
}

// ---------- encodage (sauvegarde exacte de la géométrie) ----------
// altitudes en pas de 4 m, différences par ligne, compressées (deflate), base64
export async function encodeTerrain(t) {
  const n = t.W * t.H;
  const q = new Int16Array(n);
  for (let y = 0; y < t.H; y++) {
    let prev = 0;
    for (let x = 0; x < t.W; x++) {
      const k = y * t.W + x;
      const v = Math.max(-2750, Math.min(2250, Math.round(t.elev[k] * 250)));
      q[k] = v - prev; prev = v;
    }
  }
  const bytes = await deflateBytes(new Uint8Array(q.buffer));
  return { W: t.W, H: t.H, codec: 'i16-4m-delta-deflate', data: toB64(bytes) };
}

export async function decodeTerrain(obj) {
  const bytes = await inflateBytes(fromB64(obj.data));
  const d = new Int16Array(bytes.buffer, bytes.byteOffset, obj.W * obj.H);
  const elev = new Float32Array(obj.W * obj.H);
  for (let y = 0; y < obj.H; y++) {
    let acc = 0;
    for (let x = 0; x < obj.W; x++) { const k = y * obj.W + x; acc += d[k]; elev[k] = acc * 0.004; }
  }
  return new Terrain(elev, obj.W, obj.H);
}

// CompressionStream : disponible dans Electron/Chromium et dans Node ≥ 18
async function deflateBytes(u8) {
  const s = new Blob([u8]).stream().pipeThrough(new CompressionStream('deflate'));
  return new Uint8Array(await new Response(s).arrayBuffer());
}
async function inflateBytes(u8) {
  const s = new Blob([u8]).stream().pipeThrough(new DecompressionStream('deflate'));
  return new Uint8Array(await new Response(s).arrayBuffer());
}
export function toB64(u8) {
  if (typeof btoa === 'undefined') return Buffer.from(u8).toString('base64');
  let s = '';
  for (let k = 0; k < u8.length; k += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(k, k + 0x8000));
  return btoa(s);
}
export function fromB64(str) {
  if (typeof atob === 'undefined') return new Uint8Array(Buffer.from(str, 'base64'));
  const s = atob(str);
  const u8 = new Uint8Array(s.length);
  for (let k = 0; k < s.length; k++) u8[k] = s.charCodeAt(k);
  return u8;
}
