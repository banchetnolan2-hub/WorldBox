// VALEUR DES TERRITOIRES — sert à la paix (exigences proportionnées) et à la diplomatie territoriale.
// La valeur d'une parcelle dépend de sa superficie, de sa population (villes), de ses ports, de ses ressources
// (régions pétrolières et minières), de la présence de la capitale et de son intérêt stratégique (côte,
// frontière). Calcul déterministe (mêmes données, même ordre) : identique chez tous les joueurs.
import { regionResources } from '../world/details.js';

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

// poids par parcelle (calculés une fois par partie) : population des villes, ports, ressources
function cellData(sim) {
  if (sim._tv) return sim._tv;
  const n = sim.n, d = sim.details, g = sim.grid;
  const pop = new Float32Array(n), port = new Uint8Array(n), res = new Uint8Array(n);
  if (d) {
    for (const c of d.cities) if (c.cell >= 0 && c.cell < n) { pop[c.cell] += c.pop; if (c.port) port[c.cell] = 1; }
    try {
      const rr = regionResources(d, g, sim.geo, sim.entities);
      for (let i = 0; i < n; i++) { const r = d.regionOf[i]; if (r >= 0 && rr[r] && (rr[r].includes('oil') || rr[r].includes('mine'))) res[i] = 1; }
    } catch (_) { /* monde créé : pas de ressources régionales */ }
  }
  sim._tv = { pop, port, res };
  return sim._tv;
}

// part de la valeur (0 → 1) que représente `subset` (prédicat sur une parcelle) dans le territoire de référence
// du pays k : ses parcelles actuelles + son territoire d'origine (avant les conquêtes adverses).
export function valueShare(sim, k, subset) {
  const sd = sim.sides[k], e = sd.e;
  const { pop, port, res } = cellData(sim);
  const km2 = sim.geo.km2, coastal = sim.grid.coastal;
  const cap = sd.capital;
  let A = 0, P = 0, Pt = 0, R = 0, S = 0, C = 0;
  let a = 0, p = 0, pt = 0, r = 0, s = 0, c = 0;
  const g = sim.grid;
  const capXYZ = cap >= 0 ? [g.xyz[cap * 3], g.xyz[cap * 3 + 1], g.xyz[cap * 3 + 2]] : null;
  for (let i = 0; i < sim.n; i++) {
    if (sim.owner[i] !== e && sim.origin[i] !== e) continue;
    const inS = subset(i);
    const ar = km2[i];
    const strat = (coastal && coastal[i] ? 1 : 0) + (sim.borderPos[i] >= 0 ? 1 : 0);
    const isCap = capXYZ && (i === cap || (g.xyz[i * 3] * capXYZ[0] + g.xyz[i * 3 + 1] * capXYZ[1] + g.xyz[i * 3 + 2] * capXYZ[2]) > 0.99972) ? 1 : 0;   // ≈ 150 km
    A += ar; P += pop[i]; Pt += port[i]; R += res[i] * ar; S += strat; C += isCap;
    if (inS) { a += ar; p += pop[i]; pt += port[i]; r += res[i] * ar; s += strat; c += isCap; }
  }
  // pondérations : superficie, population, ports, ressources, capitale, intérêt stratégique
  let wA = 0.36, wP = 0.3, wPt = 0.08, wR = 0.08, wC = 0.12, wS = 0.06;
  if (!P) { wA += wP; wP = 0; }
  if (!Pt) { wA += wPt; wPt = 0; }
  if (!R) { wA += wR; wR = 0; }
  if (!C) { wA += wC; wC = 0; }
  if (!S) { wA += wS; wS = 0; }
  const v = wA * (A ? a / A : 0) + wP * (P ? p / P : 0) + wPt * (Pt ? pt / Pt : 0) + wR * (R ? r / R : 0) + wC * (C ? c / C : 0) + wS * (S ? s / S : 0);
  return clamp(v, 0, 1);
}

// détail lisible de la valeur d'un ensemble de parcelles (pour l'interface)
export function valueDetail(sim, k, cells) {
  const set = cells instanceof Set ? cells : new Set(cells);
  const { pop, port, res } = cellData(sim);
  let km = 0, ppl = 0, ports = 0, rsc = 0, capital = false;
  for (const i of set) { km += sim.geo.km2[i]; ppl += pop[i]; ports += port[i]; rsc += res[i]; if (i === sim.sides[k].capital) capital = true; }
  return { share: valueShare(sim, k, (i) => set.has(i)), km2: Math.round(km), cityPop: Math.round(ppl), ports, resources: rsc > 0, capital };
}
