// WORLD — relief réel de la Terre : altitudes des continents et profondeurs des océans
// (grille 4096 × 2048, pas de 4 m ; voir scripts/relief/build-relief.py).
export const RELIEF_W = 4096, RELIEF_H = 2048;

export class Relief {
  // raw : octets décompressés (différences d'altitude par ligne, Int16 / 4 m)
  constructor(raw) {
    const W = RELIEF_W, H = RELIEF_H;
    const d = new Int16Array(raw.buffer, raw.byteOffset, W * H);
    const h = new Int16Array(W * H); // altitude / 4 m
    for (let y = 0; y < H; y++) {
      let acc = 0;
      const o = y * W;
      for (let x = 0; x < W; x++) { acc += d[o + x]; h[o + x] = acc; }
    }
    this.W = W; this.H = H;
    this.h = h;
  }

  // altitude en km (négative en mer), interpolation bilinéaire
  heightKm(lat, lon) {
    const { W, H, h } = this;
    const fx = ((lon + 180) / 360) * W - 0.5, fy = ((90 - lat) / 180) * H - 0.5;
    const x0 = Math.floor(fx), y0 = Math.max(0, Math.min(H - 2, Math.floor(fy)));
    const tx = fx - x0, ty = Math.max(0, Math.min(1, fy - y0));
    const xa = ((x0 % W) + W) % W, xb = (xa + 1) % W;
    const a = h[y0 * W + xa], b = h[y0 * W + xb], c = h[(y0 + 1) * W + xa], e = h[(y0 + 1) * W + xb];
    return ((a + (b - a) * tx) * (1 - ty) + (c + (e - c) * tx) * ty) * 0.004;
  }

  heightAtXYZ(x, y, z) {
    const l = Math.hypot(x, y, z) || 1;
    return this.heightKm(Math.asin(Math.max(-1, Math.min(1, y / l))) * 180 / Math.PI, Math.atan2(x, z) * 180 / Math.PI);
  }

  // niveaux de détail (km, flottants) pour la carte graphique : niveau 0 puis réductions successives
  mipLevels() {
    const levels = [];
    let W = this.W, H = this.H;
    let cur = new Float32Array(W * H);
    for (let k = 0; k < cur.length; k++) cur[k] = this.h[k] * 0.004;
    levels.push({ data: cur, width: W, height: H });
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
}
