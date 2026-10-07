// FRONTS — chaque conflit est découpé en secteurs (zones de front d'environ 400 km) :
// clé = adversaire × case géographique de 4°. Chaque secteur a un état (actif, inactif, en
// progression, bloqué, en recul), une posture décidée par l'IA (attaque / tenir / défense),
// une fortification, et reçoit une part des forces et des actions du pays.
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const BIN_DEG = 4;
export const NEUTRAL_KEY = 999;
export const STATUS_LABELS = { active: 'Actif', inactive: 'Inactif', advancing: 'En progression', blocked: 'Bloqué', retreating: 'En recul' };
export const POSTURE_LABELS = { attack: 'Offensive', hold: 'Tenir', defend: 'Défense' };
const DIRS = ['est', 'nord-est', 'nord', 'nord-ouest', 'ouest', 'sud-ouest', 'sud', 'sud-est'];

export function cellBins(grid) {
  const bins = new Int32Array(grid.n);
  const nx = Math.ceil(360 / BIN_DEG);
  for (let i = 0; i < grid.n; i++) bins[i] = Math.floor((grid.lat[i] + 90) / BIN_DEG) * nx + Math.floor((grid.lon[i] + 180) / BIN_DEG);
  return bins;
}
export const secKey = (o, bin) => (o < 0 ? NEUTRAL_KEY : o) * 100000 + bin;

// direction (8 secteurs) d'un point vu depuis un autre
export function direction(ax, ay, az, bx, by, bz) {
  const laA = Math.asin(ay), loA = Math.atan2(ax, az), laB = Math.asin(by), loB = Math.atan2(bx, bz);
  let dLo = loB - loA; if (dLo > Math.PI) dLo -= 2 * Math.PI; if (dLo < -Math.PI) dLo += 2 * Math.PI;
  const ang = Math.atan2(laB - laA, dLo * Math.cos((laA + laB) / 2));
  return DIRS[((Math.round(ang / (Math.PI / 4)) % 8) + 8) % 8];
}

function frontStat(sd, key, t) {
  let f = sd.front[key];
  if (!f) f = sd.front[key] = { gain: 0, loss: 0, att: 0, succ: 0, posture: 'hold', fort: 0, status: 'active', since: t, seen: t, cells: 0, name: '', o: -1, x: 0, y: 0, z: 0, cell: -1, dens: 0, airUntil: 0 };
  return f;
}
export function frontAcc(sd, key) {
  let a = sd.facc[key];
  if (!a) a = sd.facc[key] = { g: 0, l: 0, a: 0, w: 0 };
  return a;
}

// reconstruction des secteurs d'un pays (toutes les 2 s)
export function rebuildSectors(sim, s) {
  const sd = sim.sides[s];
  const g = sim.grid;
  const t = sim.time;
  const dt = Math.max(0.5, t - (sd.secBuiltAt || 0));
  sd.secBuiltAt = t;
  const map = new Map();
  for (const b of sd.border) {
    let o = -2;
    for (let k = g.nbrStart[b]; k < g.nbrStart[b + 1]; k++) {
      const j = g.nbr[k];
      if (!sim._enemyOf(s, j)) continue;
      o = sim.sideOf[sim.owner[j]];
      if (o >= 0) break;
    }
    if (o === -2) continue;
    const key = secKey(o, sim.bins[b]);
    let sec = map.get(key);
    if (!sec) { sec = { key, o, bin: sim.bins[b], cells: [], x: 0, y: 0, z: 0 }; map.set(key, sec); }
    sec.cells.push(b);
    sec.x += g.xyz[b * 3]; sec.y += g.xyz[b * 3 + 1]; sec.z += g.xyz[b * 3 + 2];
  }
  const list = [...map.values()].sort((a, b) => a.key - b.key);
  const cap = sd.capital >= 0 ? sd.capital : (sd.border[0] >= 0 ? sd.border[0] : 0);
  const cx = g.xyz[cap * 3], cy = g.xyz[cap * 3 + 1], cz = g.xyz[cap * 3 + 2];
  let wSum = 0, fSum = 0;
  for (const sec of list) {
    const l = Math.hypot(sec.x, sec.y, sec.z) || 1;
    sec.x /= l; sec.y /= l; sec.z /= l;
    const f = frontStat(sd, sec.key, t);
    const acc = sd.facc[sec.key] || { g: 0, l: 0, a: 0, w: 0 };
    const k = 1 - Math.exp(-dt / 5);
    f.gain += (acc.g / dt - f.gain) * k;
    f.loss += (acc.l / dt - f.loss) * k;
    f.att += (acc.a / dt - f.att) * k;
    f.succ += (acc.w / dt - f.succ) * k;
    f.cumGain = (f.cumGain || 0) + acc.g; f.cumLoss = (f.cumLoss || 0) + acc.l;
    f.cells = sec.cells.length;
    f.o = sec.o; f.x = sec.x; f.y = sec.y; f.z = sec.z; f.seen = t;
    f.cell = sec.cells[(sec.cells.length / 2) | 0];
    const size = Math.max(3, sec.cells.length);
    const net = (f.gain - f.loss) / size;
    const prev = f.status;
    if (f.att < 0.08 && f.loss < 0.04) f.status = 'inactive';
    else if (net > 0.012) f.status = 'advancing';
    else if (net < -0.012) f.status = 'retreating';
    else if (f.att > 0.4 && f.succ / Math.max(0.01, f.att) < 0.12) f.status = 'blocked';
    else f.status = 'active';
    if (prev !== f.status) f.since = t;
    if (!f.name) {
      const dir = direction(cx, cy, cz, sec.x, sec.y, sec.z);
      const base = `Front ${dir}`;
      let nm = base, q = 2;
      const used = new Set(Object.values(sd.front).map((x) => x.name));
      while (used.has(nm)) nm = `${base} ${q++}`;
      f.name = nm;
      f.dir = dir;
    }
    f.fort = Math.max(0, f.fort - 0.004 * dt);
    const pm = f.posture === 'attack' ? 2.3 : f.posture === 'defend' ? 0.45 : 1;
    const fm = f.posture === 'attack' ? 2.3 : f.posture === 'defend' ? 1.6 : 1;
    sec.w = size * pm * (sec.o < 0 ? 0.55 : 1);
    sec.fw = size * fm * (sec.o < 0 ? 0.35 : 1);
    // groupes d'armée du joueur : forces concentrées sur les fronts désignés ; la réserve renforce les fronts en recul
    if (sd.groupFocus && sec.o >= 0 && sd.groupFocus[sec.o]) { sec.w *= sd.groupFocus[sec.o]; sec.fw *= sd.groupFocus[sec.o]; }
    if (sd.reserveK && f.status === 'retreating') sec.fw *= 1 + sd.reserveK;
    wSum += sec.w; fSum += sec.fw;
  }
  // parts d'actions (tirage pondéré) et de forces par secteur
  sd.sectors = list;
  sd.secCum = new Float64Array(list.length);
  let c = 0;
  sd.secDens = {};
  for (let k = 0; k < list.length; k++) {
    const sec = list[k];
    c += sec.w; sd.secCum[k] = c;
    const force = sd.units * sec.fw / Math.max(1e-6, fSum);
    const dens = force / Math.max(3, sec.cells.length);
    sd.secDens[sec.key] = dens;
    sd.front[sec.key].dens = dens;
    sd.front[sec.key].force = force;
  }
  sd.secW = c;
  sd.avgDens = sd.units / Math.max(8, sd.border.length);
  sd.facc = {};
  // les secteurs disparus depuis longtemps sont oubliés
  for (const key of Object.keys(sd.front)) if (t - sd.front[key].seen > 40) delete sd.front[key];
}

export function pickSector(sim, sd) {
  const list = sd.sectors;
  if (!list || !list.length || !(sd.secW > 0)) return null;
  const x = sim.rng.next() * sd.secW;
  let lo = 0, hi = list.length - 1;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (sd.secCum[mid] < x) lo = mid + 1; else hi = mid; }
  return list[lo];
}

// densité de défense locale d'un pays face à l'attaquant s sur la case de la cellule j
export function defenseDensity(sim, d, s, j) {
  const dd = sim.sides[d];
  const v = dd.secDens ? dd.secDens[secKey(s, sim.bins[j])] : undefined;
  return v !== undefined ? v : (dd.avgDens || dd.units / Math.max(8, dd.border.length || 8)) * 0.8;
}

export function frontSummary(sd) {
  const out = [];
  for (const [key, f] of Object.entries(sd.front)) if (f.cells > 0) out.push({ key: Number(key), ...f });
  return out.sort((a, b) => b.cells - a.cells);
}

export { clamp };
