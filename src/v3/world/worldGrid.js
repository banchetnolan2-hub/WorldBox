// WORLD — grille mondiale (0,25°) chargée depuis src/data/world-grid.bin
// Chaque cellule terrestre est une parcelle simulée ; les micro-pays (Vatican, Monaco…)
// sont des nœuds supplémentaires reliés aux cellules voisines.
// Module pur (sans DOM) : utilisable dans le navigateur et sous Node (tests).

export const EARTH_R = 6371;
const DEG = Math.PI / 180;

export function parseWorldGrid(raw) {
  const u8 = raw instanceof Uint8Array ? raw : new Uint8Array(raw);
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  const hlen = dv.getUint32(0, true);
  const header = JSON.parse(new TextDecoder().decode(u8.subarray(4, 4 + hlen)));
  let off = 4 + hlen;
  off += (4 - (off % 4)) % 4;
  const { W, H, NAV_W, NAV_H } = header;
  const cellsBuf = u8.slice(off, off + W * H * 2);
  const cells = new Uint16Array(cellsBuf.buffer);
  off += W * H * 2;
  const nav = u8.slice(off, off + NAV_W * NAV_H);
  return buildWorldGrid(header, cells, nav);
}

export async function inflate(bytes) {
  if (typeof DecompressionStream !== 'undefined') {
    const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate'));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  }
  throw new Error('DecompressionStream indisponible');
}

export function buildWorldGrid(header, cells, nav) {
  const { W, H, RES, SEA, NAV_W, NAV_H } = header;
  const indexAt = new Int32Array(W * H).fill(-1);
  let nGrid = 0;
  for (let p = 0; p < W * H; p++) if (cells[p] !== SEA) indexAt[p] = nGrid++;
  const micro = header.micro || [];
  const n = nGrid + micro.length;

  const pos = new Int32Array(n).fill(-1);
  const lat = new Float32Array(n);
  const lon = new Float32Array(n);
  const xyz = new Float32Array(n * 3);
  const area = new Float32Array(n);
  const origin = new Uint16Array(n);
  const coastal = new Uint8Array(n);
  const isMicro = new Uint8Array(n);

  const setGeo = (i, la, lo) => {
    lat[i] = la; lon[i] = lo;
    const phi = la * DEG, lam = lo * DEG;
    xyz[i * 3] = Math.cos(phi) * Math.sin(lam);
    xyz[i * 3 + 1] = Math.sin(phi);
    xyz[i * 3 + 2] = Math.cos(phi) * Math.cos(lam);
  };

  // voisinage (8 directions, longitude circulaire)
  const nbrLists = new Array(n);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const p = y * W + x;
      const i = indexAt[p];
      if (i < 0) continue;
      pos[i] = p;
      origin[i] = cells[p];
      setGeo(i, 90 - (y + 0.5) * RES, -180 + (x + 0.5) * RES);
      area[i] = Math.cos(lat[i] * DEG);
      const list = [];
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (!dx && !dy) continue;
          const ny = y + dy;
          if (ny < 0 || ny >= H) { if (dx === 0) coastal[i] = 1; continue; }
          const nx = (x + dx + W) % W;
          const j = indexAt[ny * W + nx];
          if (j >= 0) list.push(j);
          else if (dx === 0 || dy === 0) coastal[i] = 1;
        }
      }
      nbrLists[i] = list;
    }
  }
  micro.forEach((m, k) => {
    const i = nGrid + k;
    isMicro[i] = 1;
    origin[i] = m.t;
    setGeo(i, m.lat, m.lon);
    area[i] = 0.3 * Math.cos(m.lat * DEG);
    const hx = m.host % W, hy = Math.floor(m.host / W);
    const list = [];
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const ny = hy + dy; if (ny < 0 || ny >= H) continue;
      const j = indexAt[ny * W + ((hx + dx + W) % W)];
      if (j >= 0) { list.push(j); nbrLists[j].push(i); }
    }
    nbrLists[i] = list;
  });

  const nbrStart = new Int32Array(n + 1);
  for (let i = 0; i < n; i++) nbrStart[i + 1] = nbrStart[i] + nbrLists[i].length;
  const nbr = new Int32Array(nbrStart[n]);
  for (let i = 0; i < n; i++) nbr.set(nbrLists[i], nbrStart[i]);

  // masses terrestres (continents / îles) : pour savoir si un trajet exige un navire
  const comp = new Int32Array(n).fill(-1);
  const compSize = [];
  let nc = 0;
  const stack = [];
  for (let s = 0; s < n; s++) {
    if (comp[s] >= 0) continue;
    comp[s] = nc; stack.push(s); let size = 0;
    while (stack.length) {
      const a = stack.pop(); size++;
      for (let k = nbrStart[a]; k < nbrStart[a + 1]; k++) {
        const b = nbr[k];
        if (comp[b] < 0) { comp[b] = nc; stack.push(b); }
      }
    }
    compSize.push(size); nc++;
  }

  const coastalList = [];
  const coastByCompLists = new Map();
  for (let i = 0; i < n; i++) {
    if (!coastal[i]) continue;
    coastalList.push(i);
    let l = coastByCompLists.get(comp[i]);
    if (!l) coastByCompLists.set(comp[i], (l = []));
    l.push(i);
  }
  const coastByComp = new Map();
  for (const [c, l] of coastByCompLists) coastByComp.set(c, Int32Array.from(l));

  return {
    header, W, H, RES, n, nGrid, territories: header.territories,
    cells, indexAt, pos, lat, lon, xyz, area, origin, coastal, isMicro,
    nbrStart, nbr, comp, compSize, coastalList: Int32Array.from(coastalList), coastByComp,
    nav, NAV_W, NAV_H,
  };
}

export function cellAtLatLon(grid, la, lo) {
  const x = Math.floor((((lo + 180) % 360) + 360) % 360 / grid.RES);
  const y = Math.floor((90 - la) / grid.RES);
  if (y < 0 || y >= grid.H) return -1;
  return grid.indexAt[y * grid.W + Math.min(grid.W - 1, x)];
}

// cellule terrestre la plus proche (recherche en spirale)
export function nearestCell(grid, la, lo, filter = null, maxR = 40) {
  const cx = Math.floor((((lo + 180) % 360) + 360) % 360 / grid.RES);
  const cy = Math.floor((90 - la) / grid.RES);
  for (let r = 0; r <= maxR; r++) {
    let best = -1, bestD = Infinity;
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        const y = cy + dy; if (y < 0 || y >= grid.H) continue;
        const i = grid.indexAt[y * grid.W + ((cx + dx + grid.W) % grid.W)];
        if (i < 0 || (filter && !filter(i))) continue;
        const d = dx * dx + dy * dy;
        if (d < bestD) { bestD = d; best = i; }
      }
    }
    if (best >= 0) return best;
  }
  return -1;
}

export function distKm(grid, a, b) {
  const x = grid.xyz;
  const dot = x[a * 3] * x[b * 3] + x[a * 3 + 1] * x[b * 3 + 1] + x[a * 3 + 2] * x[b * 3 + 2];
  return Math.acos(Math.max(-1, Math.min(1, dot))) * EARTH_R;
}

export function latLonToXYZ(la, lo, r = 1) {
  const phi = la * DEG, lam = lo * DEG;
  return [r * Math.cos(phi) * Math.sin(lam), r * Math.sin(phi), r * Math.cos(phi) * Math.cos(lam)];
}
