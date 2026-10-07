// FICHE PAYS — profil complet et cohérent : population, économie (PIB, trésorerie, recettes,
// dépenses, dette, budget militaire), armée (composition), infrastructures, technologie,
// ressources, politique intérieure (abstraite), personnalité de l'IA.
// Les valeurs sont LIÉES : la population fixe le potentiel humain, la technologie l'efficacité
// des unités, l'économie la capacité à entretenir une armée, les infrastructures la vitesse et le
// ravitaillement… `recomputeProfile` recalcule toutes les valeurs dérivées après une modification.
// Module pur (sans DOM).

import REAL from '../../data/real-stats.json';

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

// données réelles de départ (Banque mondiale, SIPRI) d'un pays, ou null (pays créé)
export function realStatsOf(ent) {
  if (!ent || ent.kind === 'custom') return null;
  const r = REAL.countries[ent.id];
  return r ? { ...r, sources: REAL.meta.sources } : null;
}
export const REAL_META = REAL.meta;
const round = (v, d = 0) => { const k = 10 ** d; return Math.round(v * k) / k; };

export const PERSONALITIES = {
  defensive: { label: 'Défensive', desc: 'Protège ses frontières, fortifie, n\'attaque que menacée.', aggr: 0.4, risk: 0.3, mil: 1.1, econ: 0.95, tech: 0.95, infra: 1.05, fort: 1.7, naval: 0.8, peace: 1.35, ally: 1.25, expand: 0.15, opp: 0.4, air: 1 },
  expansionist: { label: 'Expansionniste', desc: 'Cherche à gagner du territoire, accepte les risques.', aggr: 1.5, risk: 0.85, mil: 1.35, econ: 0.75, tech: 0.8, infra: 0.9, fort: 0.7, naval: 1, peace: 0.55, ally: 0.8, expand: 1.7, opp: 1.3, air: 1 },
  economic: { label: 'Économique', desc: 'Priorité à la prospérité et au commerce ; guerres courtes.', aggr: 0.6, risk: 0.4, mil: 0.75, econ: 1.6, tech: 1.1, infra: 1.2, fort: 1, naval: 1, peace: 1.55, ally: 1.1, expand: 0.35, opp: 0.8, air: 1 },
  technological: { label: 'Technologique', desc: 'Investit dans la recherche ; armée moderne et aviation.', aggr: 0.8, risk: 0.5, mil: 0.95, econ: 1.1, tech: 1.9, infra: 1.1, fort: 1, naval: 1, peace: 1.1, ally: 1, expand: 0.6, opp: 0.9, air: 1.6 },
  opportunist: { label: 'Opportuniste', desc: 'Frappe les voisins affaiblis ou déjà en guerre.', aggr: 1, risk: 0.7, mil: 1, econ: 1, tech: 1, infra: 1, fort: 0.9, naval: 1, peace: 1, ally: 0.85, expand: 1.1, opp: 1.9, air: 1 },
  diplomatic: { label: 'Diplomatique', desc: 'Privilégie les alliances, les accords et la négociation ; s\'adapte aux menaces.', aggr: 0.5, risk: 0.4, mil: 0.9, econ: 1.1, tech: 1, infra: 1, fort: 1.05, naval: 1, peace: 1.6, ally: 1.7, expand: 0.3, opp: 0.5, air: 1 },
  isolationist: { label: 'Isolationniste', desc: 'Évite les alliances et les conflits extérieurs.', aggr: 0.3, risk: 0.2, mil: 0.9, econ: 1.2, tech: 1.1, infra: 1.25, fort: 1.45, naval: 0.7, peace: 1.45, ally: 0.35, expand: 0.1, opp: 0.3, air: 1 },
  maritime: { label: 'Maritime', desc: 'Flotte puissante, débarquements et commerce naval.', aggr: 0.9, risk: 0.6, mil: 1, econ: 1.2, tech: 1.1, infra: 1, fort: 0.9, naval: 2.3, peace: 1, ally: 1.1, expand: 0.8, opp: 1, air: 1.1 },
};
export const PERSONALITY_KEYS = Object.keys(PERSONALITIES);

export const ECONOMY_TYPES = {
  riche: 'Riche, petite armée',
  militarisee: 'Pauvre mais militarisée',
  industrielle: 'Industrielle',
  rente: 'Dépendante des ressources',
  commerce: 'Dépendante du commerce',
  techno: 'Très technologique',
  sousdev: 'Peu développée',
  peuplee: 'Très peuplée mais pauvre',
  equilibree: 'Équilibrée',
};

// coût annuel d'entretien (milliards $) par unité, relatif à l'infanterie
export const UNIT_COST = { inf: 1, arm: 3.2, art: 2.1, rec: 1.4, air: 4.5, navy: 6.5 };
export const UNIT_LABELS = { inf: 'Infanterie', arm: 'Blindés', art: 'Artillerie', rec: 'Reconnaissance', air: 'Aviation', navy: 'Marine' };

function hashStr(s) {
  let h = 2166136261;
  for (let k = 0; k < s.length; k++) { h ^= s.charCodeAt(k); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
function hrand(seed, k) {
  let x = (seed + Math.imul(k + 1, 2654435761)) >>> 0;
  x ^= x >>> 15; x = Math.imul(x, 2246822519); x ^= x >>> 13; x = Math.imul(x, 3266489917); x ^= x >>> 16;
  return (x >>> 0) / 4294967296;
}

// Unités terrestres de base (1 unité ≈ 1 000 soldats équipés) : combinaison de plusieurs paramètres
export function baseLandUnits(stats, population) {
  const popM = Math.max(0.0005, population / 1e6);
  return 38 * Math.pow(popM, 0.33) * Math.pow(Math.max(5, stats.economie) / 50, 0.8) * Math.pow(Math.max(5, stats.puissance) / 50, 1.1)
    * (0.7 + 0.6 * stats.ressources / 100) * (0.6 + 0.8 * stats.stabilite / 100);
}

/**
 * Profil dérivé des statistiques d'origine d'un pays (196 pays réels ou pays créé).
 * geo : { coastShare (0-1), cells } optionnel.
 */
export function deriveProfile(ent, geo = {}) {
  const st = ent.stats || { puissance: 50, economie: 50, ressources: 50, stabilite: 50, mobilite: 50, defense: 50, expansion: 50, vitesse: 50 };
  const seed = hashStr(String(ent.id || ent.name || 'X'));
  const r = (k, a = -1, b = 1) => a + (b - a) * hrand(seed, k);
  const real = realStatsOf(ent);
  const pop = Math.max(1000, ent.population || (real && real.population) || 1e6);
  const coast = geo.coastShare !== undefined ? geo.coastShare : 0.3;
  const tech = clamp(st.economie * 1.04 - 4 + r(1, -5, 5), 5, 99);
  const militar = clamp((st.puissance - st.economie) / 30, -0.4, 1.2);
  const p = {
    v: 1,
    personality: pickPersonality(st, coast, pop, seed),
    popGrowth: round(clamp(2.9 - 2.7 * tech / 100 + r(2, -0.3, 0.3), -0.6, 3.5), 2),
    tech: round(tech),
    research: round(clamp(tech * 0.9 + r(3, -8, 8), 3, 99)),
    efficiency: round(clamp(st.economie * 0.8 + st.stabilite * 0.2 + r(4, -8, 8), 5, 99)),
    production: round(clamp(st.economie * 0.55 + st.ressources * 0.35 + Math.log10(pop / 1e6 + 1) * 6 + r(5, -8, 8), 5, 99)),
    trade: round(clamp(st.economie * 0.7 + coast * 30 - Math.log10(pop / 1e6 + 1) * 4 + r(6, -10, 10), 5, 99)),
    equip: round(clamp(tech * 0.8 + st.puissance * 0.25 + r(7, -6, 6), 5, 99)),
    infra: {
      roads: round(clamp(st.economie * 0.85 + st.mobilite * 0.2 + r(8, -8, 8), 5, 99)),
      rail: round(clamp(st.economie * 0.8 + r(9, -15, 10), 3, 99)),
      ports: round(clamp(coast > 0.02 ? 25 + coast * 60 + st.economie * 0.3 + r(10, -10, 10) : 0, 0, 99)),
      airports: round(clamp(st.economie * 0.8 + st.mobilite * 0.15 + r(11, -8, 8), 5, 99)),
      cities: round(clamp(st.economie * 0.7 + Math.log10(pop / 1e6 + 1) * 10 + r(12, -8, 8), 5, 99)),
    },
    res: {
      food: round(clamp(st.ressources * 0.8 + r(13, -15, 15) + 12, 5, 99)),
      energy: round(clamp(st.ressources * 0.9 + r(14, -25, 25), 3, 99)),
      raw: round(clamp(st.ressources * 0.9 + r(15, -18, 18), 3, 99)),
      strategic: round(clamp(st.ressources * 0.7 + r(16, -25, 20), 2, 99)),
    },
    politics: {
      stability: round(st.stabilite),
      cohesion: round(clamp(st.stabilite + r(17, -12, 10), 5, 99)),
      trust: round(clamp(st.stabilite * 0.8 + 10 + r(18, -10, 10), 5, 99)),
      admin: round(clamp(st.economie * 0.6 + st.stabilite * 0.4 + r(19, -8, 8), 5, 99)),
    },
    population: pop,
  };
  // armée : taille de base × militarisation, composition selon industrie, technologie, côtes
  const land = baseLandUnits(st, pop) * (1 + militar * 0.85) * clamp(Math.pow(pop / 2e7, 0.15), 0.55, 1.15);
  const armS = clamp(0.05 + 0.15 * (p.production / 100) * (tech / 100) + r(20, -0.03, 0.03), 0.02, 0.3);
  const artS = clamp(0.07 + 0.1 * p.production / 100 + r(21, -0.03, 0.03), 0.03, 0.25);
  const recS = clamp(0.04 + 0.04 * st.mobilite / 100, 0.02, 0.12);
  p.army = {
    inf: round(land * (1 - armS - artS - recS), 1),
    arm: round(land * armS, 1),
    art: round(land * artS, 1),
    rec: round(land * recS, 1),
    air: round(land * clamp(0.015 + 0.09 * (tech / 100) ** 2 + r(22, -0.01, 0.01), 0.004, 0.14), 1),
    navy: round(land * (coast > 0.02 ? clamp((0.01 + 0.07 * coast) * (0.5 + p.infra.ports / 100) * (p.personality === 'maritime' ? 2 : 1), 0, 0.2) : 0), 1),
  };
  // économie : PIB réel (Banque mondiale) quand il est disponible -> calibrage de la productivité
  let eco = economyOf(p);
  if (real && real.gdpUsd && !real.estimated.includes('gdp')) {
    const realGdp = real.gdpUsd / 1e9 * (pop / Math.max(1, real.population));   // même PIB par habitant
    p.gdpCal = round(realGdp / eco.gdp, 4);
    eco = economyOf(p);
  }
  p.taxRate = round(clamp(0.13 + 0.2 * p.politics.admin / 100 + r(23, -0.02, 0.02), 0.08, 0.45), 3);
  const income = eco.gdp * p.taxRate;
  let upkeep = armyUpkeep(p, eco.pc);
  // une économie faible ne peut pas entretenir une grande armée : plafond selon la militarisation
  const cap = eco.gdp * 0.034 * (1 + Math.max(0, militar) * 2.6);
  if (upkeep > cap) { const k = cap / upkeep; for (const key of Object.keys(p.army)) p.army[key] = round(p.army[key] * k, 1); upkeep = cap; }
  p.debt = round(eco.gdp * clamp(0.15 + 0.85 * hrand(seed, 24), 0, 1.3) * (st.economie > 60 ? 1 : 0.55));
  const interest = p.debt * interestRate(p.debt / eco.gdp);
  p.civil = round(Math.max(income * 0.25, income - upkeep - interest - eco.gdp * 0.012 * (hrand(seed, 25) * 2 - 1.1)), 1);
  p.money = round(eco.gdp * (0.03 + 0.1 * st.economie / 100) + eco.gdp * 0.18 * Math.max(0, p.res.energy - 70) / 30);
  p.milBudget = round(upkeep / eco.gdp * 100, 2);  // % du PIB
  // dépenses militaires réelles (SIPRI, % du PIB) : l'armée est dimensionnée sur ce budget
  if (real && real.milPct !== undefined && !real.estimated.includes('military')) {
    p.milBudget = round(real.milPct, 2);
    const k = (p.milBudget / 100 * eco.gdp) / Math.max(1e-6, upkeep);
    for (const key of Object.keys(p.army)) p.army[key] = round(p.army[key] * k, 1);
    p.civil = round(Math.max(income * 0.25, p.civil - (p.milBudget / 100 * eco.gdp - upkeep)), 1);
  }
  if (real && real.popGrowth !== undefined) p.popGrowth = round(clamp(real.popGrowth, -2, 4), 2);   // Banque mondiale (moyenne 5 ans)
  if (real) p.real = { popYear: real.popYear || null, gdpYear: real.gdpYear || null, milYear: real.milYear || null, estimated: real.estimated.slice() };
  return recomputeProfile(p);
}

function pickPersonality(st, coast, pop, seed) {
  const w = {
    defensive: 0.6 + Math.max(0, st.defense - st.expansion) / 12 + (st.defense > 70 ? 0.6 : 0),
    expansionist: 0.3 + Math.max(0, st.expansion - 58) / 5 + Math.max(0, st.puissance - st.economie) / 25,
    economic: 0.4 + Math.max(0, st.economie - st.puissance - 5) / 8,
    technological: st.economie >= 84 ? 1.1 + (st.economie - 84) / 4 : 0.1,
    opportunist: 0.8,
    isolationist: 0.2 + (st.expansion < 48 ? 0.9 : 0) + (pop < 5e6 && st.stabilite > 65 ? 0.4 : 0),
    maritime: 0.1 + (coast > 0.35 ? 1.4 : coast > 0.2 ? 0.5 : 0) + (coast > 0.6 ? 1 : 0),
  };
  let tot = 0; for (const k in w) tot += w[k];
  let x = hrand(seed, 99) * tot;
  for (const k in w) { x -= w[k]; if (x <= 0) return k; }
  return 'opportunist';
}

export function interestRate(debtRatio) { return clamp(0.02 + 0.035 * Math.max(0, debtRatio - 0.6), 0.015, 0.14); }

// PIB (milliards $ / an) et PIB par habitant (milliers $) : population × productivité
export function economyOf(p, popOverride = null) {
  const pop = popOverride || p.population;
  const tech = p.tech / 100;
  const inf = (p.infra.roads + p.infra.rail + p.infra.ports * 0.5 + p.infra.airports * 0.5 + p.infra.cities) / 400;
  const res = (p.res.food + p.res.energy + p.res.raw + p.res.strategic) / 400;
  const pc = 62 * Math.pow(Math.max(0.03, tech), 2.2)
    * (0.55 + 0.5 * inf) * (0.6 + 0.4 * p.efficiency / 100) * (0.8 + 0.25 * p.trade / 100)
    * (0.85 + 0.22 * res) * (0.72 + 0.28 * p.politics.stability / 100) * (0.8 + 0.2 * p.production / 100)
    * clamp(Math.pow(pop / 5e7, -0.12), 0.55, 1.5) * (p.gdpCal || 1) * (p.devGdp || 1);
  return { pc, gdp: Math.max(0.05, pop * pc * 1e-6) };
}

// coût d'une unité d'infanterie (milliards $ / an) : suit le niveau de vie et la qualité de l'équipement
export function unitCost(p, pc) { return (0.025 + 0.0022 * pc) * (0.5 + p.equip / 100); }
export function armyUpkeep(p, pc) {
  const c = unitCost(p, pc);
  const a = p.army;
  return c * (a.inf * UNIT_COST.inf + a.arm * UNIT_COST.arm + a.art * UNIT_COST.art + a.rec * UNIT_COST.rec + a.air * UNIT_COST.air + a.navy * UNIT_COST.navy);
}
export function landUnits(p) { const a = p.army; return a.inf + a.arm + a.art + a.rec; }

// qualité des unités (0-1+) : technologie, équipement
export function quality(tech, equip) { return (0.45 + 0.55 * tech / 100) * (0.7 + 0.3 * equip / 100); }

// Puissance militaire (indice 0-100, échelle logarithmique)
export function militaryPower(p) {
  const a = p.army;
  const q = quality(p.tech, p.equip);
  const s = (a.inf + a.arm * 2.4 + a.art * 1.8 + a.rec * 0.9 + a.air * 3 + a.navy * 2.5) * q;
  return clamp(Math.round(18 * Math.log10(1 + s)), 1, 100);
}

// Toutes les valeurs dérivées (lecture seule dans la fiche) + avertissements de cohérence
export function recomputeProfile(p) {
  const eco = economyOf(p);
  const pc = eco.pc;
  const upkeep = armyUpkeep(p, pc);
  const income = eco.gdp * p.taxRate;
  const interest = p.debt * interestRate(p.debt / eco.gdp);
  const expenses = p.civil + upkeep + interest;
  const land = landUnits(p);
  const mobil = 0.006 + 0.028 * p.politics.cohesion / 100;
  const manpower = p.population * mobil / 1000; // unités mobilisables au total
  const d = {
    gdp: eco.gdp, gdpPc: pc * 1000, income, expenses, upkeep, interest, balance: income - expenses,
    unitCost: unitCost(p, pc), milPct: upkeep / eco.gdp * 100,
    land, manpower, soldiers: land * 1000, power: militaryPower(p),
    quality: quality(p.tech, p.equip),
    infraLevel: Math.round((p.infra.roads + p.infra.rail + p.infra.ports * 0.5 + p.infra.airports * 0.5 + p.infra.cities) / 4),
    resLevel: Math.round((p.res.food + p.res.energy + p.res.raw + p.res.strategic) / 4),
    speed: 0.7 + 0.5 * ((p.infra.roads + p.infra.rail) / 200),
    supply: 0.6 + 0.4 * ((p.infra.roads + p.infra.rail + p.infra.ports * 0.3) / 230) * (0.7 + 0.3 * (p.res.food + p.res.energy) / 200),
  };
  d.economyType = economyType(p, d);
  const warn = [];
  if (d.balance < -0.03 * d.gdp) warn.push(`Déficit important (${fmtBn(d.balance)} / an) : la dette va augmenter.`);
  if (d.milPct > p.milBudget * 1.15 + 0.2) warn.push(`L'armée coûte ${d.milPct.toFixed(1).replace('.', ',')} % du PIB, plus que le budget militaire prévu (${String(p.milBudget).replace('.', ',')} %) : elle sera réduite ou moins entretenue.`);
  if (land > manpower * 0.9) warn.push('Armée proche du maximum mobilisable pour cette population.');
  if (p.army.navy > 0 && p.infra.ports < 5) warn.push('Marine sans ports : les navires ne peuvent pas être entretenus.');
  if (p.army.arm + p.army.art > land * 0.5 && p.production < 40) warn.push('Industrie trop faible pour produire autant de blindés et d\'artillerie.');
  if (p.debt > d.gdp * 1.2) warn.push('Dette très élevée : risque de crise économique.');
  d.warnings = warn;
  p.derived = d;
  return p;
}

function economyType(p, d) {
  const pc = d.gdpPc / 1000;
  if (p.tech >= 86 && p.research >= 80) return 'techno';
  if (d.milPct >= 3.6 && pc < 12) return 'militarisee';
  if (p.population > 1.2e8 && pc < 14) return 'peuplee';
  if (pc < 4) return 'sousdev';
  if (p.res.energy >= 75 && p.production < 60) return 'rente';
  if (p.trade >= 75 && p.population < 3e7) return 'commerce';
  if (p.production >= 68) return 'industrielle';
  if (pc >= 26 && d.milPct < 2.4) return 'riche';
  return 'equilibree';
}

export function fmtBn(v) {
  const a = Math.abs(v);
  const s = a >= 1000 ? (a / 1000).toFixed(a >= 10000 ? 0 : 1) + ' 000' : a >= 100 ? a.toFixed(0) : a >= 10 ? a.toFixed(1) : a.toFixed(2);
  return (v < 0 ? '−' : '') + s.replace('.', ',').replace(' 000', ' k') + ' Md$';
}

// Adapte l'armée à un nouveau budget (% du PIB) en gardant la composition
export function scaleArmyToBudget(p) {
  const eco = economyOf(p);
  const target = p.milBudget / 100 * eco.gdp;
  const cur = armyUpkeep(p, eco.pc);
  if (cur <= 0) return p;
  const k = target / cur;
  for (const key of Object.keys(p.army)) p.army[key] = round(p.army[key] * k, 1);
  return recomputeProfile(p);
}

// Profil d'un pays : celui enregistré dans le monde (modifié dans CREATE COUNTRY) ou dérivé des statistiques
export function profileOf(ent, geo) {
  if (ent.profile && ent.profile.v) {
    const p = JSON.parse(JSON.stringify(ent.profile));
    p.population = ent.population || p.population;
    return recomputeProfile(p);
  }
  return deriveProfile(ent, geo);
}

// statistiques résumées (compatibilité avec les anciennes fiches : puissance, économie…)
export function statsFromProfile(p, old = {}) {
  const d = p.derived || recomputeProfile(p).derived;
  return {
    ...old,
    puissance: clamp(Math.round(d.power * 0.95 + 5), 5, 100),
    economie: clamp(Math.round(p.tech * 0.6 + p.efficiency * 0.4), 5, 100),
    ressources: clamp(d.resLevel, 5, 100),
    stabilite: clamp(Math.round(p.politics.stability), 5, 100),
    mobilite: clamp(Math.round(d.speed * 70), 5, 100),
    defense: old.defense || 55,
    expansion: clamp(Math.round(PERSONALITIES[p.personality].expand * 30 + 30), 5, 100),
    vitesse: old.vitesse || 55,
  };
}
