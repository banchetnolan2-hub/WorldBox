// DIPLOMATIE TERRITORIALE — transformations territoriales négociées entre pays, par régions administratives :
// échange de frontières ou de régions, cession, achat, vente, restitution, indépendance, annexion consentie,
// fusion, séparation, création d'un nouvel État.
// Règles : prendre un territoire par la diplomatie exige l'ACCORD du pays concerné ; les régions échangées ou
// cédées doivent toucher le pays qui les reçoit (cohérence géographique). Le crayon de frontières n'existe pas
// en Mode Nation : ce module et la guerre sont les seuls moyens de changer les frontières.
// Déterministe (aucun tirage aléatoire) : évaluation et application identiques chez tous les joueurs.
import { PERSONALITIES } from './profile.js';
import { powerOf } from './ai.js';
import { addRel } from './wars.js';
import { regionCells, trustOf, dnote } from './diplomacy.js';
import { valueShare } from './territoryValue.js';
import { tn } from './tuning.js';

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const r2 = (v) => Math.round(v * 100) / 100;

export const TERRITORIAL_TYPES = {
  swap: { label: 'Échange de régions', desc: 'Vous cédez une ou plusieurs régions et recevez en échange des régions voisines.', give: true, take: true },
  border: { label: 'Échange de frontières', desc: 'Petit échange de régions frontalières pour rectifier la frontière.', give: true, take: true },
  cession: { label: 'Demande de cession', desc: 'Le pays vous cède des régions voisines de votre territoire (sans contrepartie).', take: true },
  purchase: { label: 'Achat de territoire', desc: 'Vous achetez des régions voisines contre un paiement.', take: true, price: true },
  sale: { label: 'Vente de territoire', desc: 'Vous vendez une ou plusieurs de vos régions voisines de ce pays.', give: true, price: true },
  offer: { label: 'Cession offerte', desc: 'Vous cédez des régions à ce pays (geste diplomatique).', give: true },
  restitution: { label: 'Restitution', desc: 'Retour de régions à leur pays d\'origine (demandée ou offerte).', give: true, take: true, origin: true },
  independence: { label: 'Indépendance', desc: 'Des régions deviennent un nouvel État souverain (les vôtres, ou celles de ce pays avec son accord).', give: true, take: true, state: true },
  newstate: { label: 'Création d\'un nouvel État', desc: 'Des régions des deux pays forment ensemble un nouvel État.', give: true, take: true, state: true },
  separation: { label: 'Séparation', desc: 'Le pays se sépare d\'une partie de son territoire, qui devient un État.', take: true, state: true },
  annexation: { label: 'Annexion consentie', desc: 'Le pays accepte de rejoindre le vôtre : tout son territoire vous revient.', all: true },
  merger: { label: 'Fusion', desc: 'Vos deux pays fusionnent en un seul État (le vôtre absorbe le sien).', all: true },
};

// propriétaire actuel (majoritaire) de chaque région
export function regionOwners(sim) {
  const out = new Map();
  for (const [rid, cells] of regionCells(sim)) {
    const cnt = new Map();
    for (const c of cells) cnt.set(sim.owner[c], (cnt.get(sim.owner[c]) || 0) + 1);
    let best = -1, bv = 0;
    for (const [e, v] of cnt) if (v > bv) { bv = v; best = e; }
    out.set(rid, best);
  }
  return out;
}
// parcelles d'une liste de régions tenues par l'entité e
function cellsOf(sim, rids, e) {
  const rc = regionCells(sim), out = [];
  for (const rid of rids || []) for (const c of rc.get(rid) || []) if (sim.owner[c] === e) out.push(c);
  return out;
}
// la zone (parcelles) touche-t-elle le territoire de l'entité e (ou d'autres parcelles reçues avec elle) ?
function touches(sim, cells, e, extra = null) {
  const g = sim.grid, set = new Set(cells);
  for (const c of cells) for (let k = g.nbrStart[c]; k < g.nbrStart[c + 1]; k++) { const j = g.nbr[k]; if (!set.has(j) && (sim.owner[j] === e || (extra && extra.has(j)))) return true; }
  return false;
}
// chaque région doit toucher le receveur, directement ou par une autre région reçue (cohérence géographique)
export function coherent(sim, rids, fromE, toE) {
  const rc = regionCells(sim);
  const parts = rids.map((r) => (rc.get(r) || []).filter((c) => sim.owner[c] === fromE)).filter((x) => x.length);
  const got = new Set();
  let left = parts.slice(), progress = true;
  while (left.length && progress) {
    progress = false;
    left = left.filter((cells) => { if (touches(sim, cells, toE, got)) { for (const c of cells) got.add(c); progress = true; return false; } return true; });
  }
  return left.length === 0;
}
// régions d'un pays proposables dans une négociation avec un autre (voisines si nécessaire)
export function tradableRegions(sim, owner, receiver, needAdjacent = true) {
  const own = regionOwners(sim), rc = regionCells(sim);
  const oe = sim.sides[owner].e, re = sim.sides[receiver].e;
  const out = [];
  for (const [rid, e] of own) {
    if (e !== oe) continue;
    const reg = sim.details && sim.details.regions[rid];
    const cells = (rc.get(rid) || []).filter((c) => sim.owner[c] === oe);
    if (!cells.length) continue;
    const capital = cells.includes(sim.sides[owner].capital);
    const adj = touches(sim, cells, re);
    if (needAdjacent && !adj) continue;
    out.push({ id: rid, name: (reg && reg.name) || 'Région', km2: Math.round(cells.reduce((t, c) => t + sim.geo.km2[c], 0)), adjacent: adj, capital, origin: reg ? reg.e : -1 });
  }
  return out.sort((a, b) => (b.adjacent - a.adjacent) || a.name.localeCompare(b.name, 'fr'));
}

// vérifications communes ; retourne un message d'erreur ou null
export function checkDeal(sim, from, to, deal) {
  const T = TERRITORIAL_TYPES[deal.type];
  if (!T) return 'Type de proposition inconnu.';
  if (!sim.details) return 'La diplomatie territoriale nécessite la carte détaillée des régions (Terre).';
  const A = sim.sides[from], B = sim.sides[to];
  if (!A || !B || A.eliminated || B.eliminated || from === to) return 'Pays invalide.';
  if (sim.atWar[from * sim.S + to]) return 'Impossible pendant une guerre entre vos pays : utilisez les négociations de paix.';
  const give = deal.give || [], take = deal.take || [];
  if (T.all) return null;
  if (!give.length && !take.length) return 'Choisissez au moins une région.';
  if (!T.give && give.length) return 'Ce type de proposition ne comporte pas de régions cédées.';
  if (!T.take && take.length) return 'Ce type de proposition ne comporte pas de régions demandées.';
  const gc = cellsOf(sim, give, A.e), tc = cellsOf(sim, take, B.e);
  if (give.length && !gc.length) return 'Les régions cédées ne vous appartiennent pas.';
  if (take.length && !tc.length) return 'Les régions demandées n\'appartiennent pas à ce pays.';
  if (tc.includes(B.capital)) return `${B.name} ne cédera jamais sa capitale.`;
  if (gc.includes(A.capital)) return 'Vous ne pouvez pas céder votre capitale.';
  if (gc.length >= A.cells) return 'Vous ne pouvez pas céder tout votre territoire de cette manière (utilisez la fusion).';
  if (!T.state) {
    if (give.length && !coherent(sim, give, A.e, B.e)) return `Les régions cédées doivent être voisines de ${B.name}.`;
    if (take.length && !coherent(sim, take, B.e, A.e)) return `Les régions demandées doivent être voisines de votre territoire.`;
  }
  if (T.origin) {
    const regs = sim.details.regions;
    if (take.some((r) => regs[r] && regs[r].e !== A.e)) return 'Une restitution ne concerne que des régions d\'origine de votre pays.';
    if (give.some((r) => regs[r] && regs[r].e !== B.e)) return `Vous ne pouvez restituer que des régions d'origine de ${B.name}.`;
  }
  if (T.price && !(deal.price > 0)) return 'Indiquez un prix.';
  if (T.state && !String(deal.stateName || '').trim()) return 'Donnez un nom au nouvel État.';
  return null;
}

// prix de référence (Md$) d'un ensemble de régions du pays k : part de sa valeur × son PIB × 2,5
export function fairPrice(sim, k, cells) {
  const set = new Set(cells);
  return Math.round(valueShare(sim, k, (i) => set.has(i)) * Math.max(1, sim.sides[k].eco.gdp) * 2.5 * 10) / 10;
}

// ACCORD du pays « to » (IA) : facteurs lisibles, acceptation / refus / contre-proposition, explication
export function evaluateDeal(sim, from, to, deal, opts = {}) {
  const err = checkDeal(sim, from, to, deal);
  if (err) return { result: 'refuse', score: -9, factors: [{ label: err, v: -9 }], counter: null, why: err };
  const T = TERRITORIAL_TYPES[deal.type];
  const S = sim.S, A = sim.sides[from], B = sim.sides[to];
  const P = PERSONALITIES[(B.ai && B.ai.personality) || 'opportunist'];
  const rel = sim.rel[to * S + from];
  const f = [];
  const add = (label, v) => { if (Math.abs(v) >= 0.02) f.push({ label, v: r2(v) }); };
  const gc = cellsOf(sim, deal.give, A.e), tc = cellsOf(sim, deal.take, B.e);
  add(`Relations (${Math.round(rel)})`, clamp(rel / 110, -0.9, 0.4));   // pour un territoire, les relations ne suffisent pas
  add('Confiance', trustOf(sim, to, from) * 0.5);
  const allied = sim.allied[to * S + from] === 1;
  if (allied) add('Alliés', 0.25);
  const ratio = powerOf(A) / Math.max(1e-6, powerOf(B));
  if (ratio > 2 && !T.all) add('Votre puissance (pression)', Math.min(0.15, (ratio - 2) * 0.05));
  add('Ouverture diplomatique', (tn(sim, 'dipOpenness') - 1) * 0.5);
  let score = 0.1;
  if (T.all) {
    // annexion consentie / fusion : seulement un petit pays proche, allié, instable ou très faible face à vous
    const small = B.pop < 1e6 ? 0.5 : B.pop < 4e6 ? 0.1 : B.pop < 15e6 ? -0.3 : -0.9;
    add('Taille du pays', small);
    add('Disparition de l\'État (souveraineté)', -2.2);
    add(`Personnalité : ${P.label}`, (P.ally - 1) * 0.5 - (B.ai && B.ai.personality === 'isolationist' ? 0.6 : 0));
    if (B.stability < 0.35) add('Instabilité intérieure', 0.3);
    if (ratio > 8) add('Écart de puissance', 0.25);
    if (deal.type === 'merger' && rel > 60) add('Projet commun de fusion', 0.3);
  } else {
    // ce que le pays perd et ce qu'il reçoit (valeur), contrepartie financière, légitimité historique
    const lost = tc.length ? valueShare(sim, to, (i) => tc.includes(i)) : 0;
    const gainCells = new Set(gc);
    const gainKm = gc.reduce((t, c) => t + sim.geo.km2[c], 0), lostKm = tc.reduce((t, c) => t + sim.geo.km2[c], 0);
    if (lost > 0) add(`Territoire cédé (${Math.round(lost * 100)} % de la valeur du pays)`, -0.9 - lost * 12);
    if (gc.length && !T.state) add(`Territoire reçu (${Math.round(gainKm).toLocaleString('fr-FR')} km²)`, Math.min(0.9, 0.25 + gainKm / Math.max(1, B.km2) * 6));
    if (deal.type === 'swap' || deal.type === 'border') add('Équilibre de l\'échange', clamp((gainKm - lostKm) / Math.max(1, lostKm + gainKm) * 0.8, -0.8, 0.5));
    if (T.price && deal.price > 0) {
      const fair = deal.type === 'purchase' ? fairPrice(sim, to, tc) : 0;
      if (deal.type === 'purchase') add(`Prix proposé (${deal.price} Md$, valeur estimée ${fair} Md$)`, clamp(deal.price / Math.max(0.1, fair) * 0.9 - 0.1, -0.6, 1.5));
      else add(`Prix demandé (${deal.price} Md$)`, -clamp(deal.price / Math.max(0.5, B.eco.gdp) * 12, 0, 1.5) + (B.money > deal.price * 2 ? 0 : -0.5));
    }
    const regs = sim.details.regions;
    if (deal.type === 'restitution') {
      if (deal.take && deal.take.length) add('Revendication historique (régions d\'origine de votre pays)', 0.3);
      if (deal.give && deal.give.length) add('Retour de régions historiques', 0.5);
    }
    if (T.state) {
      if (tc.length) add('Perte de souveraineté sur ces régions', -0.6);
      const foreign = deal.take ? deal.take.filter((r) => regs[r] && regs[r].e !== B.e).length : 0;
      if (foreign) add('Régions annexées autrefois', 0.35);
      if (B.stability < 0.4) add('Instabilité intérieure', 0.25);
      if (!tc.length) add('Ne concerne que vos régions', 0.6);
    }
    if (deal.type === 'offer' || (deal.type === 'sale' && !deal.price)) add('Geste diplomatique', 0.4);
    add(`Personnalité : ${P.label}`, (P.expand > 1.2 && gainCells.size ? 0.15 : 0) - (P.expand > 1.2 && tc.length ? 0.2 : 0));
  }
  for (const x of f) score += x.v;
  const factors = f.sort((a, b) => Math.abs(b.v) - Math.abs(a.v));
  let counter = null;
  if (score <= 0.5 && score > -0.6 && sim.rules.negotiations !== false && !T.all) {
    // contre-proposition : moins de régions demandées, ou un prix plus élevé
    if (T.price && deal.type === 'purchase') { const fair = fairPrice(sim, to, tc); if (deal.price < fair * 1.35) counter = { ...deal, price: Math.round(fair * 1.35 * 10) / 10 }; }
    else if ((deal.take || []).length > 1) counter = { ...deal, take: deal.take.slice(0, Math.ceil(deal.take.length / 2)) };
    else if (deal.type === 'cession' && (deal.take || []).length) counter = { ...deal, type: 'purchase', price: fairPrice(sim, to, tc) };
  }
  const result = score > 0.5 ? 'accept' : counter ? 'counter' : 'refuse';
  const neg = factors.filter((x) => x.v < 0).slice(0, 3).map((x) => x.label.toLowerCase());
  const why = result === 'refuse' ? `${B.name} refuse : aucune version de cette proposition n'est acceptable pour le moment${neg.length ? ` (${neg.join(' ; ')})` : ''}. Améliorez vos relations, proposez une contrepartie ou demandez moins de territoire.` : '';
  void opts;
  return { result, score: r2(score), factors, counter, why };
}

// APPLICATION d'un accord territorial (après accord des deux pays)
export function applyDeal(sim, from, to, deal) {
  const err = checkDeal(sim, from, to, deal);
  if (err) return { ok: false, text: err };
  const T = TERRITORIAL_TYPES[deal.type];
  const A = sim.sides[from], B = sim.sides[to];
  const gc = cellsOf(sim, deal.give, A.e), tc = cellsOf(sim, deal.take, B.e);
  let created = -1;
  if (T.all) {
    const all = [];
    for (let i = 0; i < sim.n; i++) if (sim.owner[i] === B.e) all.push(i);
    for (const c of all) sim.flip(c, A.e, false);
    sim.chron('creation', deal.type === 'merger' ? `Fusion de ${A.name} et de ${B.name}.` : `${B.name} rejoint ${A.name} (annexion consentie).`, { e: [A.e, B.e] });
  } else if (T.state) {
    const cells = [...gc, ...tc];
    created = sim.addState({ name: deal.stateName, color: deal.stateColor, parent: tc.length && !gc.length ? to : from, cells });
  } else {
    for (const c of gc) sim.flip(c, B.e, false);
    for (const c of tc) sim.flip(c, A.e, false);
  }
  if (T.price && deal.price > 0) {
    const payer = deal.type === 'purchase' ? A : B, payee = deal.type === 'purchase' ? B : A;
    payer.money -= deal.price; if (payer.money < 0) { payer.debt += -payer.money; payer.money = 0; }
    payee.money += deal.price;
  }
  addRel(sim, from, to, T.all ? 0 : deal.type === 'offer' || deal.type === 'restitution' ? 10 : 4);
  dnote(sim, from, to, 'treaty', `Accord territorial : ${T.label.toLowerCase()}`);
  if (!T.all) sim.chron('treaty', `Accord territorial entre ${A.name} et ${B.name} : ${T.label.toLowerCase()}${created >= 0 ? ` — naissance de ${sim.sides[created].name}` : ''}.`, { e: [A.e, B.e] });
  sim.markDirty && sim.markDirty([from, to]);
  sim._regionCells = null;
  return { ok: true, created, moved: gc.length + tc.length };
}

// résumé lisible d'une proposition
export function describeDeal(sim, deal, from, to) {
  const T = TERRITORIAL_TYPES[deal.type];
  const regs = sim.details ? sim.details.regions : [];
  const names = (l) => (l || []).map((r) => (regs[r] && regs[r].name) || 'région').join(', ');
  const parts = [T ? T.label : deal.type];
  if ((deal.give || []).length) parts.push(`${sim.sides[from].name} cède : ${names(deal.give)}`);
  if ((deal.take || []).length) parts.push(`${sim.sides[to].name} cède : ${names(deal.take)}`);
  if (deal.price > 0) parts.push(`prix : ${deal.price} Md$`);
  if (T && T.state) parts.push(`nouvel État : ${deal.stateName || '?'}`);
  return parts.join(' · ');
}
