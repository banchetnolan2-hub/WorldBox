// DÉTAILS DE LA TERRE — villes, régions, ports, lacs, routes (Natural Earth, domaine public).
// Construit une fois pour la grille terrestre (cache sur la grille). Les régions sont dérivées des
// villes principales de chaque région administrative (admin-1) : chaque parcelle rejoint la région de
// la ville la plus proche dans son pays d'origine (diffusion sur la grille, sans traverser les frontières).
import DATA from '../../data/details.json';
import { cellAtLatLon, nearestCell, distKm } from './worldGrid.js';

export const CITY_CAPITAL = 1, CITY_REGION = 2, CITY_PORT = 4, CITY_MAJOR = 8;
export const DETAILS_META = DATA.meta;

export function buildDetails(grid, owner, entities) {
  if (grid._details) return grid._details;
  const t0 = Date.now();
  const byId = new Map(entities.map((e, k) => [e && e.id, k]));
  // ---- villes ----
  const cities = [];
  for (const [name, lat, lon, pop, flags, cid, adm1] of DATA.cities) {
    const e = byId.get(cid);
    if (e === undefined) continue;
    let cell = cellAtLatLon(grid, lat, lon);
    if (cell < 0 || owner[cell] !== e) cell = nearestCell(grid, lat, lon, (i) => owner[i] === e, 6);
    if (cell < 0) continue;
    cities.push({ id: cities.length, name, lat, lon, pop, cap: !!(flags & CITY_CAPITAL), rcap: !!(flags & CITY_REGION), port: !!(flags & CITY_PORT), major: !!(flags & CITY_MAJOR), e, adm1: adm1 || '', cell });
  }
  // ---- régions : diffusion depuis les villes, par pays ----
  const n = grid.n;
  const regionOf = new Int16Array(n).fill(-1);
  const regions = [];
  const key = new Map();
  const queue = new Int32Array(n);
  let qh = 0, qt = 0;
  const seeds = cities.filter((c) => c.adm1).sort((a, b) => (b.rcap - a.rcap) || (b.pop - a.pop));
  for (const c of seeds) {
    const k = c.e + '|' + c.adm1;
    let r = key.get(k);
    if (r === undefined) { r = regions.length; key.set(k, r); regions.push({ id: r, name: c.adm1, e: c.e, seat: c.id, cities: [], cells: 0 }); }
    regions[r].cities.push(c.id);
    c.region = r;
    if (regionOf[c.cell] < 0) { regionOf[c.cell] = r; queue[qt++] = c.cell; }
  }
  while (qh < qt) {
    const i = queue[qh++];
    const r = regionOf[i];
    for (let k = grid.nbrStart[i]; k < grid.nbrStart[i + 1]; k++) {
      const j = grid.nbr[k];
      if (regionOf[j] >= 0 || owner[j] !== owner[i]) continue;
      regionOf[j] = r; queue[qt++] = j;
    }
  }
  const acc = new Float64Array(regions.length * 3);
  for (let i = 0; i < n; i++) {
    const r = regionOf[i];
    if (r < 0) continue;
    regions[r].cells++;
    acc[r * 3] += grid.xyz[i * 3]; acc[r * 3 + 1] += grid.xyz[i * 3 + 1]; acc[r * 3 + 2] += grid.xyz[i * 3 + 2];
  }
  // centre de chaque région : la parcelle de la région la plus proche du barycentre
  const bestDot = new Float64Array(regions.length).fill(-2);
  for (const r of regions) { const l = Math.hypot(acc[r.id * 3], acc[r.id * 3 + 1], acc[r.id * 3 + 2]) || 1; acc[r.id * 3] /= l; acc[r.id * 3 + 1] /= l; acc[r.id * 3 + 2] /= l; r.center = -1; }
  for (let i = 0; i < n; i++) {
    const r = regionOf[i];
    if (r < 0) continue;
    const dt = grid.xyz[i * 3] * acc[r * 3] + grid.xyz[i * 3 + 1] * acc[r * 3 + 1] + grid.xyz[i * 3 + 2] * acc[r * 3 + 2];
    if (dt > bestDot[r]) { bestDot[r] = dt; regions[r].center = i; }
  }
  for (const c of cities) if (c.region === undefined && regionOf[c.cell] >= 0) { c.region = regionOf[c.cell]; regions[c.region].cities.push(c.id); }
  // ---- ports : parcelles côtières des ports réels ----
  const portCell = new Uint8Array(n);
  const ports = [];
  for (const [name, lat, lon, rank] of DATA.ports) {
    let cell = cellAtLatLon(grid, lat, lon);
    if (cell < 0 || !grid.coastal[cell]) cell = nearestCell(grid, lat, lon, (i) => grid.coastal[i] === 1, 4);
    if (cell < 0) continue;
    const w = rank <= 4 ? 3 : rank <= 6 ? 2 : 1;
    portCell[cell] = Math.max(portCell[cell], w);
    ports.push({ name, lat, lon, cell, w });
  }
  for (const c of cities) if (c.port && grid.coastal[c.cell]) portCell[c.cell] = Math.max(portCell[c.cell], c.pop > 1e6 ? 3 : 2);
  // ---- routes : réseau principal reliant les villes de chaque pays (arbre couvrant + liaisons proches) ----
  const roads = [];
  const perE = new Map();
  for (const c of cities) { const l = perE.get(c.e) || []; l.push(c); perE.set(c.e, l); }
  for (const list of perE.values()) {
    const L = list.slice().sort((a, b) => b.pop - a.pop).slice(0, 18);
    if (L.length < 2) continue;
    const inT = [L[0]];
    const rest = L.slice(1);
    while (rest.length) {
      let bi = -1, bj = -1, bd = Infinity;
      for (let i = 0; i < inT.length; i++) for (let j = 0; j < rest.length; j++) {
        if (grid.comp[inT[i].cell] !== grid.comp[rest[j].cell]) continue;
        const d = distKm(grid, inT[i].cell, rest[j].cell);
        if (d < bd) { bd = d; bi = i; bj = j; }
      }
      if (bj < 0) { inT.push(rest.shift()); continue; }
      if (bd < 1100) roads.push([inT[bi].cell, rest[bj].cell, inT[bi].pop + rest[bj].pop > 2e6 ? 2 : 1]);
      inT.push(rest.splice(bj, 1)[0]);
    }
  }
  const out = { cities, regions, regionOf, portCell, ports, lakes: DATA.lakes, roads, ms: Date.now() - t0 };
  grid._details = out;
  return out;
}

// ressources dominantes d'une région (d'après le relief, les biomes, les côtes et les villes)
const RES_LABELS = { agri: 'Agriculture', wood: 'Forêts', mine: 'Minerais', oil: 'Hydrocarbures', fish: 'Pêche', industry: 'Industrie' };
export function regionResources(details, grid, geo, entities) {
  if (details._res) return details._res;
  const counts = details.regions.map(() => [0, 0, 0, 0, 0, 0, 0]);   // biomes 0-5 + côtes
  for (let i = 0; i < grid.nGrid; i++) {
    const r = details.regionOf[i];
    if (r < 0) continue;
    counts[r][geo.biome[i]]++;
    if (grid.coastal[i]) counts[r][6]++;
  }
  details._res = details.regions.map((reg, r) => {
    const c = counts[r];
    const tot = Math.max(1, reg.cells);
    const ent = entities[reg.e];
    const energy = ent && ent.profile && ent.profile.res ? ent.profile.res.energy : (ent && ent.stats ? ent.stats.ressources : 50);
    const pop = reg.cities.reduce((s, id) => s + details.cities[id].pop, 0);
    const list = [];
    if ((c[0] + c[1] * 0.4) / tot > 0.35) list.push('agri');
    if (c[1] / tot > 0.3) list.push('wood');
    if ((c[2] + c[3]) / tot > 0.3) list.push('mine');
    if ((c[4] / tot > 0.3 || c[5] / tot > 0.4) && energy > 55) list.push('oil');
    if (c[6] / tot > 0.25) list.push('fish');
    if (pop > 1.5e6) list.push('industry');
    if (!list.length) list.push(c[0] >= c[4] ? 'agri' : 'mine');
    return list.slice(0, 3);
  });
  return details._res;
}
export { RES_LABELS };
