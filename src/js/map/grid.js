// MAP — grille territoriale : chaque cellule est une parcelle de territoire
// Construite à partir d'un masque (gw × gh) : -1 = mer / hors jeu, 0 = pays A, 1 = pays B.
// Ce module est pur (pas de DOM) pour pouvoir être testé sous Node.

export const DIRS = [
  [1, 0], [-1, 0], [0, 1], [0, -1],
  [1, 1], [1, -1], [-1, 1], [-1, -1],
];

export function buildGrid({ gw, gh, mask, cellSize = 1, originX = 0, originY = 0, capitals = null }) {
  const indexAt = new Int32Array(gw * gh).fill(-1);
  let n = 0;
  for (let p = 0; p < gw * gh; p++) if (mask[p] === 0 || mask[p] === 1) indexAt[p] = n++;

  const gx = new Int16Array(n);
  const gy = new Int16Array(n);
  const origin = new Uint8Array(n);
  const cx = new Float32Array(n);
  const cy = new Float32Array(n);
  const neighbors = new Int32Array(n * 8).fill(-1);
  const coastal = new Uint8Array(n);
  const counts = [0, 0];

  for (let y = 0; y < gh; y++) {
    for (let x = 0; x < gw; x++) {
      const i = indexAt[y * gw + x];
      if (i < 0) continue;
      gx[i] = x; gy[i] = y;
      origin[i] = mask[y * gw + x];
      counts[origin[i]]++;
      cx[i] = originX + (x + 0.5) * cellSize;
      cy[i] = originY + (y + 0.5) * cellSize;
      for (let d = 0; d < 8; d++) {
        const nx = x + DIRS[d][0], ny = y + DIRS[d][1];
        let j = -1;
        if (nx >= 0 && ny >= 0 && nx < gw && ny < gh) j = indexAt[ny * gw + nx];
        neighbors[i * 8 + d] = j;
        if (j < 0 && d < 4) coastal[i] = 1;
      }
    }
  }

  // Cellules « capitale » : position de départ de chaque pays
  const caps = [-1, -1];
  for (let side = 0; side < 2; side++) {
    let target = capitals && capitals[side];
    let best = -1, bestD = Infinity;
    // centre de gravité par défaut
    let mx = 0, my = 0, c = 0;
    for (let i = 0; i < n; i++) if (origin[i] === side) { mx += gx[i]; my += gy[i]; c++; }
    if (!target && c) target = { x: mx / c, y: my / c };
    if (target) {
      for (let i = 0; i < n; i++) {
        if (origin[i] !== side) continue;
        const dx = gx[i] - target.x, dy = gy[i] - target.y;
        const d2 = dx * dx + dy * dy;
        if (d2 < bestD) { bestD = d2; best = i; }
      }
    }
    caps[side] = best;
  }

  return { gw, gh, n, indexAt, gx, gy, origin, cx, cy, neighbors, coastal, counts, capitals: caps, cellSize, originX, originY };
}

// Grille synthétique (tests / démonstration) : deux blocs séparés par une frontière ondulée
export function syntheticGrid(gw = 120, gh = 80, seedFn = Math.sin) {
  const mask = new Int8Array(gw * gh).fill(-1);
  for (let y = 0; y < gh; y++) {
    for (let x = 0; x < gw; x++) {
      const nx = x / gw - 0.5, ny = y / gh - 0.5;
      const r = Math.sqrt(nx * nx * 0.9 + ny * ny * 1.3);
      if (r > 0.47 + 0.03 * seedFn(x * 0.3) * seedFn(y * 0.2)) continue;
      const border = gw / 2 + 4 * seedFn(y * 0.15);
      mask[y * gw + x] = x < border ? 0 : 1;
    }
  }
  return buildGrid({ gw, gh, mask });
}
