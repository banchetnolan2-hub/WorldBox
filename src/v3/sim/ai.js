// IA DES PAYS — architecture de décision sans génération de texte :
//   Perception -> Analyse -> Objectifs -> Planification -> Action -> Résultat -> Mémoire -> nouvelle décision.
// Deux rythmes : opérationnel (≈ toutes les 3 s : postures des secteurs, fortifications, frappes
// aériennes) et stratégique (chaque mois : objectifs, budget, diplomatie, mémoire).
// Chaque pays a une personnalité ; une même situation produit des décisions différentes.
import { coalitionsOf } from './coalitions.js';
import { tn } from './tuning.js';
import { PERSONALITIES } from './profile.js';
import { MONTH_SEC, YEAR_SEC } from './calendar.js';
import { secKey } from './fronts.js';
import { TERRAIN_DEF } from './geo.js';
import { startWar, joinWar, endWar, addRel, getRel } from './wars.js';
import { assessPeace, canPropose, noteProposal, makePeaceTerms, evaluatePeace, describeTerms, applyPeace, dnote, trustOf } from './diplomacy.js';

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const OBJECTIVE_LABELS = {
  conquer: 'Conquérir', defend: 'Défendre', peace: 'Obtenir la paix', consolidate: 'Consolider les conquêtes', rebuild: 'Reconstruire l\'économie',
  modernize: 'Moderniser l\'armée', navy: 'Développer la marine', expand: 'Expansion', alliance: 'Chercher des alliés', prosper: 'Prospérité', fortify: 'Fortifier les frontières',
};

export function initAI(sim, s) {
  const sd = sim.sides[s];
  const pers = sd.p.personality in PERSONALITIES ? sd.p.personality : 'opportunist';
  sd.ai = {
    personality: pers,
    objectives: [], memory: [], log: [],
    nextOp: sim.time + 1 + (s % 7) * 0.37,
    nextStrat: sim.time + 2 + (s % 13) * (MONTH_SEC / 13),
    lastCells: sd.cells, lastUnits: sd.units, lastMoney: sd.money,
    analysis: null, nextAir: sim.time + 6 + (s % 5), postWar: null, lastObj: null, deficitMonths: 0,
  };
}

export function aiLog(sim, s, text, tone = 'neutral') {
  const ai = sim.sides[s].ai;
  if (!ai) return;
  const last = ai.log[ai.log.length - 1];
  if (last && last.text === text && sim.time - last.t < 30) return;
  ai.log.push({ t: sim.time, text, tone });
  if (ai.log.length > 40) ai.log.shift();
}

function remember(ai, m, t) {
  const same = ai.memory.find((x) => x.type === m.type && x.key === m.key && x.target === m.target);
  if (same) { same.strength = Math.min(4, same.strength + m.strength * 0.6); same.t = t; same.text = m.text || same.text; }
  else ai.memory.push({ ...m, t });
  if (ai.memory.length > 40) { ai.memory.sort((a, b) => b.strength - a.strength); ai.memory.length = 32; }
}
const mem = (ai, type, pred = () => true) => ai.memory.filter((m) => m.type === type && pred(m)).reduce((s, m) => s + m.strength, 0);

export function powerOf(sd) { return sd.eliminated ? 0 : sd.units * sd.q * (0.6 + 0.4 * sd.morale) + sd.airPow * 2.2 + sd.navPow * 0.8; }

// ---------------- rythme opérationnel ----------------
export function aiOperational(sim, s) {
  const sd = sim.sides[s];
  const ai = sd.ai;
  const P = PERSONALITIES[ai.personality];
  ai.nextOp = sim.time + 2.6 + (s % 5) * 0.12;
  if (!sd.sectors || !sd.sectors.length) return;
  const geo = sim.geo;
  const objs = ai.objectives;
  const conquer = new Set(objs.filter((o) => o.type === 'conquer').map((o) => o.target));
  const defendT = new Set(objs.filter((o) => o.type === 'defend').map((o) => o.target));
  // pays du joueur : la posture militaire choisie remplace l'objectif de paix de l'IA
  const stance = sd.player ? (sd.stance || 'balanced') : null;
  const peace = stance ? stance === 'defensive' : objs[0] && objs[0].type === 'peace';
  const consolidate = objs.some((o) => o.type === 'consolidate');
  const scored = [];
  for (const sec of sd.sectors) {
    const f = sd.front[sec.key];
    if (!f) continue;
    const b = geo ? geo.biome[f.cell >= 0 ? f.cell : sec.cells[0]] : 0;
    let theirDens = 0.5;
    if (sec.o >= 0) {
      const od = sim.sides[sec.o];
      theirDens = (od.secDens && od.secDens[secKey(s, sec.bin)]) || od.avgDens || 1;
    }
    const myDens = sd.secDens[sec.key] || sd.avgDens || 1;
    const theirQ = sec.o >= 0 ? sim.sides[sec.o].defC : 0.5;
    let score = (myDens * sd.atkT[b]) / Math.max(0.05, theirDens * theirQ * TERRAIN_DEF[b] * (1 + (sec.o >= 0 ? (sim.sides[sec.o].front[secKey(s, sec.bin)] || {}).fort || 0 : 0) * 0.6));
    if (f.status === 'advancing') score *= 1.45;
    if (f.status === 'blocked') score *= 0.55;
    const failed = mem(ai, 'failedOffensive', (m) => m.key === sec.o * 100000 + sec.bin || m.key === sec.key);
    score /= 1 + failed * 0.8;
    if (sec.o >= 0 && conquer.has(sec.o)) score *= 1.6;
    if (sec.o < 0) score *= 0.5 * P.expand + 0.2;
    scored.push({ sec, f, score, b });
  }
  scored.sort((x, y) => y.score - x.score);
  const aggr = stance === 'offensive' ? Math.max(1.4, P.aggr * 1.5) : P.aggr;
  const nAtk = peace ? 0 : Math.max(1, Math.min(scored.length, Math.round(1 + scored.length / 4 * aggr)));
  let atk = 0;
  for (const it of scored) {
    const { sec, f } = it;
    const prev = f.posture;
    let post = 'hold';
    const threatened = f.status === 'retreating' || mem(ai, 'hardZone', (m) => m.key === sec.key) > 0.3 || (sec.o >= 0 && defendT.has(sec.o) && f.status !== 'advancing');
    if (!peace && atk < nAtk && it.score > 0.55 / P.risk && !(consolidate && it.score < 1.4) && (sec.o < 0 || conquer.has(sec.o) || P.aggr > 0.9 || it.score > 1.3)) { post = 'attack'; atk++; }
    else if (threatened) post = 'defend';
    f.posture = post;
    if (post === 'defend' || (post === 'hold' && (P.fort > 1.2 || stance === 'defensive'))) {
      const add = (post === 'defend' ? 0.035 : 0.012) * (stance === 'defensive' ? Math.max(1.3, P.fort) : P.fort) * (1 + (sd.devFort || 0)) * tn(sim, 'fortSpeed');
      const cost = sd.eco.gdp * 0.00004 * (post === 'defend' ? 1 : 0.4);
      if (sd.money > cost && f.fort < 1) { f.fort = Math.min(1, f.fort + add); sd.money -= cost; }
    }
    if (prev !== post && sec.cells.length >= 8 && sec.o >= 0) {
      const enemy = sim.sides[sec.o].name;
      if (post === 'attack') aiLog(sim, s, `Offensive lancée sur le ${f.name.toLowerCase()} (${enemy}).`, 'good');
      else if (prev === 'attack' && f.status === 'blocked') {
        aiLog(sim, s, `Offensive suspendue sur le ${f.name.toLowerCase()} : front bloqué.`, 'bad');
        remember(ai, { type: 'failedOffensive', key: sec.key, target: sec.o, strength: 0.8, text: `Offensive bloquée : ${f.name}` }, sim.time);
      } else if (post === 'defend') aiLog(sim, s, `Priorité à la défense du ${f.name.toLowerCase()} (${enemy}) et fortifications.`);
    }
  }
  // frappes aériennes sur le secteur offensif le plus prometteur ou le plus bloqué
  if (sd.air >= 2 && sim.time >= ai.nextAir && !peace && sd.money > 0) {
    const tgt = scored.find((x) => x.f.posture === 'attack' && x.sec.o >= 0) || scored.find((x) => x.f.status === 'retreating' && x.sec.o >= 0);
    if (tgt) {
      sim.launchAirStrike(s, tgt.sec, tgt.f);
      ai.nextAir = sim.time + clamp(9 * Math.sqrt(12 / Math.max(1, sd.air)), 3, 18) / P.air;
    } else ai.nextAir = sim.time + 4;
  }
}

// ---------------- rythme stratégique (mensuel) ----------------
export function aiStrategic(sim, s) {
  const sd = sim.sides[s];
  const ai = sd.ai;
  const P = PERSONALITIES[ai.personality];
  const S = sim.S;
  const t = sim.time;
  const dt = Math.max(1, t - (ai.lastStratAt || t - MONTH_SEC));
  ai.lastStratAt = t;
  ai.nextStrat = t + MONTH_SEC;
  // ---- Mémoire : oubli progressif ----
  for (const m of ai.memory) m.strength *= Math.exp(-dt / (m.type === 'claim' ? 600 : m.type === 'lostWar' || m.type === 'wonWar' ? 300 : 110));
  ai.memory = ai.memory.filter((m) => m.strength > 0.08);
  // ---- Perception ----
  const my = Math.max(1e-6, powerOf(sd));
  const enemies = [];
  for (let o = 0; o < S; o++) if (o !== s && sim.atWar[s * S + o] && !sim.sides[o].eliminated) enemies.push(o);
  const warsOf = (o) => { let n = 0; for (let k = 0; k < S; k++) if (sim.atWar[o * S + k]) n++; return Math.max(1, n); };
  const cellsTrend = (sd.cells - ai.lastCells) / Math.max(20, sd.initial);
  const unitsTrend = (sd.units - ai.lastUnits) / Math.max(1, ai.lastUnits);
  ai.lastCells = sd.cells; ai.lastUnits = sd.units;
  const gdp = Math.max(0.1, sd.eco.gdp);
  const balance = sd.eco.balance / gdp;
  const debtRatio = sd.debt / gdp;
  const overext = sd.occupiedCells / Math.max(1, sd.cells);
  let threat = 0;
  const fronts = { advancing: 0, retreating: 0, blocked: 0, total: 0 };
  for (const sec of sd.sectors || []) { const f = sd.front[sec.key]; if (!f || sec.o < 0) continue; fronts.total++; if (fronts[f.status] !== undefined) fronts[f.status]++; }
  for (const o of enemies) threat += powerOf(sim.sides[o]) / warsOf(o) / my;
  // lassitude de la guerre
  const exK = tn(sim, 'exhaustion');      // réglage avancé ; à 1, calcul identique à l'origine (même ordre des opérations)
  if (enemies.length) sd.exhaustion = clamp(exK === 1 ? sd.exhaustion + 0.012 + Math.max(0, -unitsTrend) * 0.25 + Math.max(0, -cellsTrend) * 0.8 + (sd.crisis ? 0.02 : 0) : sd.exhaustion + (0.012 + Math.max(0, -unitsTrend) * 0.25 + Math.max(0, -cellsTrend) * 0.8 + (sd.crisis ? 0.02 : 0)) * exK, 0, 1);
  else sd.exhaustion = Math.max(0, sd.exhaustion - 0.04);
  // moral : résultats récents
  sd.morale = clamp(sd.morale + cellsTrend * 0.9 - sd.exhaustion * 0.01 + (sd.crisis ? -0.02 : 0.004) + (0.72 + 0.3 * sd.p.politics.cohesion / 100 - sd.morale) * 0.04, 0.25, 1.25);
  if (sd.crisis) sd.crisisMonths = (sd.crisisMonths || 0) + 1; else sd.crisisMonths = 0;
  // voisins (contact terrestre) et opportunités
  const neigh = [];
  const contact = sim.contact;
  for (let o = 0; o < S; o++) {
    if (o === s || sim.sides[o].eliminated) continue;
    const c = contact ? contact[s * S + o] : 0;
    const near = c > 0 || sim.nearCap[s * S + o];
    if (!near) continue;
    neigh.push({ o, contact: c, ratio: my / Math.max(1e-6, powerOf(sim.sides[o])), rel: sim.rel[s * S + o], atWar: !!sim.atWar[s * S + o], truce: sim.truce[s * S + o] > t, busy: warsOf(o) > (sim.atWar[s * S + o] ? 1 : 0) });
  }
  ai.analysis = { power: my, threat, enemies: enemies.length, cellsTrend, unitsTrend, balance, debtRatio, overext, fronts, exhaustion: sd.exhaustion, morale: sd.morale };

  // ---- Objectifs ----
  const cands = [];
  const claimVs = (o) => mem(ai, 'claim', (m) => m.target === o);
  for (const o of enemies) {
    const ratio = my / Math.max(1e-6, powerOf(sim.sides[o]) / warsOf(o));
    const failed = mem(ai, 'failedOffensive', (m) => m.target === o);
    const conq = tn(sim, 'aiAggression') * P.aggr * clamp(ratio, 0.15, 3) * (1 + clamp(cellsTrend * 8, -0.5, 0.8)) * (1 - 0.55 * sd.exhaustion) / (1 + failed * 0.35) * (1 + claimVs(o) * 0.3);
    cands.push({ type: 'conquer', target: o, score: conq });
    const losing = fronts.retreating / Math.max(1, fronts.total);
    const capThreat = sd.capital >= 0 && sim.owner[sd.capital] !== sd.e ? 1 : 0;
    cands.push({ type: 'defend', target: o, score: (1 / clamp(ratio, 0.2, 5)) * (0.5 + losing * 2) + capThreat + mem(ai, 'hardZone', (m) => m.target === o) * 0.3 });
  }
  if (enemies.length && sim.cfg.warEnd && sim.cfg.warEnd.peace !== false) {
    const losing = cellsTrend < -0.01 ? 0.8 : 0;
    const winningOver = cellsTrend > 0 && overext > 0.25 ? 0.6 : 0;
    cands.push({ type: 'peace', target: enemies[0], score: P.peace * (sd.exhaustion * 1.6 + losing + (sd.crisis ? 0.9 : 0) + winningOver + (fronts.blocked > fronts.advancing && fronts.total > 1 ? 0.25 : 0)) });
  }
  const pw = ai.postWar && t - ai.postWar.t < 240 ? ai.postWar : null;
  cands.push({ type: 'consolidate', score: overext * 3 + (pw && pw.won ? 1.1 : 0) });
  cands.push({ type: 'rebuild', score: P.econ * ((sd.crisis ? 1.6 : 0) + (balance < -0.02 ? 0.5 : 0) + (debtRatio > 1 ? 0.4 : 0) + (pw && !pw.won ? 1.2 : 0)) });
  cands.push({ type: 'fortify', score: P.fort * 0.35 * (threat > 0.8 ? 1 : 0.4) + (pw && !pw.won ? 0.7 : 0) + mem(ai, 'hardZone') * 0.25 });
  cands.push({ type: 'modernize', score: P.tech * 0.45 * (sd.money > gdp * 0.03 ? 1 : 0.4) });
  cands.push({ type: 'prosper', score: P.econ * 0.5 * (enemies.length ? 0.4 : 1) });
  const coastEnemies = enemies.some((o) => !sim.contact[s * S + o]);
  if (sd.p.infra.ports > 5) cands.push({ type: 'navy', score: P.naval * 0.3 * (coastEnemies || !sd.border.length ? 1.6 : 0.6) });
  // expansion : une cible voisine plus faible, isolée ou déjà en guerre
  const atWarN = enemies.length;
  let bestExp = null;
  for (const n of neigh) {
    if (n.atWar || n.truce || sim.allied[s * S + n.o]) continue;
    const od = sim.sides[n.o];
    let opp = P.expand * clamp(n.ratio - 1.15, 0, 3) * (n.busy ? 1 + 0.6 * P.opp : 1) * (od.stability < 0.45 ? 1.3 : 1) * (od.crisis ? 1.4 : 1)
      * (n.rel < -20 ? 1.35 : n.rel > 30 ? 0.3 : 0.8) * (1 - sd.exhaustion) * (1 + claimVs(n.o) * 0.8) * (sd.crisis ? 0.3 : 1) * (atWarN ? 0.25 : 1);
    if (!n.contact) opp *= P.naval > 1.5 ? 0.7 : 0.25;
    if (opp > (bestExp ? bestExp.score : 0)) bestExp = { type: 'expand', target: n.o, score: opp };
    if (n.ratio > 1.8 && n.contact) remember(ai, { type: 'weakNeighbour', target: n.o, strength: 0.3, text: `Voisin affaibli : ${od.name}` }, t);
  }
  if (bestExp && sim.cfg.aiWars !== false) cands.push(bestExp);
  if (threat > 0.9 || neigh.some((n) => n.ratio < 0.6 && n.rel < -30)) cands.push({ type: 'alliance', score: P.ally * (0.4 + Math.max(0, threat - 0.8)) });
  cands.sort((x, y) => y.score - x.score);
  // hystérésis : l'objectif principal n'est remplacé que par un objectif nettement meilleur
  const prev = ai.objectives[0];
  let primary = cands[0];
  if (prev) {
    const same = cands.find((c) => c.type === prev.type && c.target === prev.target);
    if (same && same.score >= primary.score * 0.8) primary = same;
  }
  const secondary = cands.find((c) => c !== primary && c.type !== primary.type) || null;
  const longTerm = cands.find((c) => c !== primary && c !== secondary && ['modernize', 'rebuild', 'navy', 'expand', 'prosper', 'fortify', 'consolidate'].includes(c.type)) || null;
  ai.objectives = [primary, secondary, longTerm].filter(Boolean).map((o, k) => ({ ...o, rank: k }));
  // objectifs de conquête simultanés pour toutes les guerres offensives
  for (const c of cands) if (c.type === 'conquer' && c.score > 0.9 && !ai.objectives.some((o) => o.type === 'conquer' && o.target === c.target)) ai.objectives.push({ ...c, rank: 3 });
  const objKey = primary.type + ':' + (primary.target ?? '');
  if (objKey !== ai.lastObj) {
    ai.lastObj = objKey;
    aiLog(sim, s, `Nouvel objectif principal : ${OBJECTIVE_LABELS[primary.type].toLowerCase()}${primary.target !== undefined ? ' — ' + sim.sides[primary.target].name : ''}.`, primary.type === 'conquer' || primary.type === 'expand' ? 'bad' : 'neutral');
  }

  // pays du joueur : budget, investissements et diplomatie sont décidés par le joueur
  if (sd.player) { aiDoctrine(sim, s, sd, enemies, warsOf, P); return; }
  // ---- Planification : budget ----
  let desired = sd.milBase * P.mil;
  if (enemies.length) desired *= 1.3 + 0.55 * clamp(threat, 0, 1.5);
  else if (threat > 0 || neigh.some((n) => n.rel < -40)) desired *= 1.05;
  const types = ai.objectives.slice(0, 2).map((o) => o.type);
  if (types.includes('conquer') || types.includes('expand')) desired *= 1.2;
  if (types.includes('rebuild') || types.includes('peace') || types.includes('prosper')) desired *= 0.85;
  // un pays joueur voisin, beaucoup plus puissant et peu amical : l'IA renforce sa défense
  if (sim.nation) for (const p of sim.nation.humanList()) {
    if (p === s) continue;
    if ((sim.contact[s * S + p] || sim.nearCap[s * S + p]) && powerOf(sim.sides[p]) > my * 1.5 && sim.rel[s * S + p] < 10) { desired *= 1.12; break; }
  }
  const over = mem(ai, 'overspend');
  desired *= 1 / (1 + over * 0.25);
  if (sd.crisis) desired *= 0.7;
  const income = Math.max(0.01, sd.eco.income);
  desired = Math.min(desired, income * (enemies.length ? 0.85 : 0.45) + sd.money * 0.05);
  const before = sd.milTarget;
  sd.milTarget += (desired - sd.milTarget) * 0.35;
  if (Math.abs(sd.milTarget - before) / Math.max(1e-6, before) > 0.12) aiLog(sim, s, sd.milTarget > before ? `Budget militaire augmenté (+${Math.round((sd.milTarget / before - 1) * 100)} %).` : `Budget militaire réduit (${Math.round((sd.milTarget / before - 1) * 100)} %)${over > 0.3 || sd.crisis ? ' : finances dégradées' : ''}.`, sd.milTarget > before ? 'neutral' : 'bad');
  // austérité, investissements
  if (balance < -0.03 && debtRatio > 0.7) { sd.austerity = Math.min(0.22, sd.austerity + 0.03); ai.deficitMonths++; }
  else { sd.austerity = Math.max(0, sd.austerity - 0.02); ai.deficitMonths = Math.max(0, ai.deficitMonths - 1); }
  if (ai.deficitMonths >= 3) { remember(ai, { type: 'overspend', strength: 0.5, text: 'Déficits répétés : dépenses à réduire' }, t); if (ai.deficitMonths === 3) aiLog(sim, s, 'Déficits répétés : réduction des dépenses.', 'bad'); }
  let r = 0.25 * P.tech, inf = 0.25 * P.infra, ec = 0.3 * P.econ;
  if (types.includes('modernize')) r *= 1.8;
  if (types.includes('rebuild')) { ec *= 1.8; inf *= 1.4; }
  if (types.includes('consolidate')) inf *= 1.6;
  const tot = r + inf + ec;
  sd.budget = { research: r / tot, infra: inf / tot, econ: ec / tot };
  const adv = sim.rules.aiAdvanced !== false;        // IA avancée : doctrine, coalitions, stratégie de négociation
  if (adv) aiDoctrine(sim, s, sd, enemies, warsOf, P);
  sd.navalFocus = types.includes('navy') ? 0.7 : P.naval > 1.5 ? 0.3 : 0;

  // ---- Actions diplomatiques ----
  // la paix est envisagée dès que la situation l'appelle (même si la défense reste la priorité) ;
  // proposePeace analyse ensuite la situation et applique délais et mémoire des refus
  const peaceC = cands.find((c) => c.type === 'peace');
  if (peaceC && (primary.type === 'peace' ? peaceC.score > 0.85 : peaceC.score > 0.75)) proposePeace(sim, s, peaceC.target);
  const defendScore = cands.find((c) => c.type === 'defend');
  if (enemies.length && defendScore && defendScore.score > 1.1) requestHelp(sim, s);
  if (adv && (primary.type === 'alliance' || (secondary && secondary.type === 'alliance'))) seekAlliance(sim, s, enemies, neigh);
  if (primary.type === 'expand' && primary.score > 1.5 && sim.cfg.aiWars !== false && t > (sim.nation ? 60 : 12) && t - (ai.lastDeclare || -999) > 90) { ai.lastDeclare = t; declare(sim, s, primary.target); }
  // relations : dérive lente, commerce
  for (const n of neigh) if (!n.atWar) addRel(sim, s, n.o, (n.rel < 0 ? 0.6 : -0.3) * 0.5 + (sim.trade[s * S + n.o] ? 0.4 : 0) - (n.contact > 0 && P.expand > 1.3 ? 0.4 : 0));
}

// doctrine : aviation selon la menace aérienne, composition de l'armée selon le terrain des fronts actifs
function aiDoctrine(sim, s, sd, enemies, warsOf, P) {
  let enemyAir = 0;
  for (const o of enemies) enemyAir += sim.sides[o].airPow / warsOf(o);
  sd.airShare = clamp((P.air - 1) + (enemyAir > sd.airPow ? 0.3 : 0), -0.3, 0.9);
  if (sd.sectors && sd.sectors.length && sim.geo) {
    let open = 0, rough = 0;
    for (const sec of sd.sectors) { const b = sim.geo.biome[sec.cells[0]]; if (b === 0 || b === 4) open += sec.cells.length; else rough += sec.cells.length; }
    const k = open / Math.max(1, open + rough);
    const d0 = sd.p.army;
    const land0 = d0.inf + d0.arm + d0.art + d0.rec || 1;
    const arm = d0.arm / land0 * (0.6 + 0.8 * k), art = d0.art / land0 * (0.9 + 0.3 * (1 - k)), rec = d0.rec / land0;
    const inf2 = Math.max(0.3, 1 - arm - art - rec);
    const s2 = inf2 + arm + art + rec;
    sd.doctrine = { inf: inf2 / s2, arm: arm / s2, art: art / s2, rec: rec / s2 };
  }
}

// le pays du joueur reçoit une proposition au lieu d'une décision automatique
const isPlayer = (sim, k) => !!(sim.nation && sim.nation.isHuman(k));

// ---------------- diplomatie ----------------
function warBetween(sim, a, b) {
  return sim.activeWars.find((w) => w.status === 'active' && ((w.a.includes(a) && w.b.includes(b)) || (w.b.includes(a) && w.a.includes(b))));
}

// Proposition de paix : analysée (situation militaire, territoire, économie, stabilité, durée, moral,
// objectifs, rapport de force, relations) ; délais entre deux propositions, pas de répétition si la
// situation n'a pas changé ; après plusieurs refus, l'IA fait des concessions ou continue le combat.
function proposePeace(sim, s, o) {
  if (sim.rules.peace === false) return;
  const w = warBetween(sim, s, o);
  if (!w || sim.time - w.start < 20) return;
  const other = w.a.includes(s) ? w.b : w.a;
  const lead = other.filter((k) => !sim.sides[k].eliminated).sort((x, y) => sim.sides[y].initial - sim.sides[x].initial)[0];
  if (lead === undefined) return;
  // dans une coalition, seul le chef négocie la paix avec la cible (les autres membres le consultent)
  const coal = coalitionsOf(sim, s).find((c) => c.target === o || (w.a.includes(c.target) || w.b.includes(c.target)));
  if (coal && coal.leader !== s && sim.sides[coal.leader] && !sim.sides[coal.leader].eliminated && (w.a.includes(coal.leader) || w.b.includes(coal.leader))) return;
  const me = assessPeace(sim, w, s);
  if (me.will < 0.45) return;
  const chk = canPropose(sim, s, lead, 'peace', me.ctx, { cooldown: 45, patience: PERSONALITIES[sim.sides[s].ai.personality].peace > 1.2 ? 0.8 : 1.2 });
  if (!chk.ok) return;
  const refusals = sim.rules.aiAdvanced === false ? 0 : chk.refused || 0;   // IA simple : pas de changement de stratégie
  if (refusals >= 2 && me.ctx.adv > 0.1 && me.ctx.trend >= 0) { remember(sim.sides[s].ai, { type: 'peaceRefused', target: lead, strength: 0.6, text: `Paix refusée par ${sim.sides[lead].name} : poursuite des opérations` }, sim.time); return; }
  const terms = makePeaceTerms(sim, w, s, refusals >= 2 ? 'concede' : 'normal');
  if (isPlayer(sim, lead)) {
    if (!sim.nation.at(lead).peaceOfferReady()) return;
    const d = describeTerms(sim, w, terms, lead);
    sim.nation.at(lead).offer(s, 'peace', { terms, war: w.id }, d.title);
    noteProposal(sim, s, lead, 'peace', 'pending', me.ctx);
    return;
  }
  const ev = evaluatePeace(sim, w, lead, terms);
  aiLog(sim, s, `${terms.kind === 'ceasefire' ? 'Cessez-le-feu' : 'Paix'} proposé${terms.kind === 'ceasefire' ? '' : 'e'} à ${sim.sides[lead].name}${refusals >= 2 ? ' (avec concessions)' : ''}.`);
  let final = ev.result === 'accept' ? terms : null;
  if (ev.result === 'counter') {
    const back = evaluatePeace(sim, w, s, ev.counter);
    aiLog(sim, lead, `Contre-proposition à ${sim.sides[s].name}.`);
    if (back.result === 'accept') final = ev.counter;
  }
  noteProposal(sim, s, lead, 'peace', final ? 'accept' : 'refuse', me.ctx);
  if (final) {
    aiLog(sim, lead, `Accepte la paix avec ${sim.sides[s].name}.`, 'good');
    applyPeace(sim, w, final, endWar);
  } else {
    aiLog(sim, lead, `Refuse la paix proposée par ${sim.sides[s].name}.`, 'bad');
    addRel(sim, s, lead, -2);
  }
}

function requestHelp(sim, s) {
  if (sim.rules.alliances === false || sim.rules.negotiations === false) return;
  const S = sim.S;
  const sd = sim.sides[s];
  for (const w of sim.activeWars) {
    if (w.status !== 'active' || !(w.a.includes(s) || w.b.includes(s))) continue;
    const side = w.a.includes(s) ? 'a' : 'b';
    const enemies = side === 'a' ? w.b : w.a;
    for (let k = 0; k < S; k++) {
      if (k === s || sim.sides[k].eliminated || w.a.includes(k) || w.b.includes(k)) continue;
      const allied = sim.allied[s * S + k] || sim.sides[k].team === sd.team && sim.teams.length < sim.sides.length;
      const rel = sim.rel[s * S + k];
      if (!allied && rel < 45) continue;
      if (enemies.some((e) => sim.allied[k * S + e])) continue;
      const kd = sim.sides[k];
      const P = PERSONALITIES[kd.ai.personality];
      let busy = 0; for (let x = 0; x < S; x++) if (sim.atWar[k * S + x]) busy++;
      if (isPlayer(sim, k)) {
        if (!sd.ai.lastHelpAsk || sim.time - sd.ai.lastHelpAsk > 60) { sd.ai.lastHelpAsk = sim.time; sim.nation.at(k).offer(s, 'help', {}, `${sd.name}${allied ? ', votre allié,' : ''} est en guerre et demande votre aide militaire.`); }
        return;
      }
      const chance = (allied ? 0.55 : 0.18) * P.ally * (busy ? 0.3 : 1) * (1 - kd.exhaustion) * (kd.crisis ? 0.3 : 1) * tn(sim, 'allyReliability');
      if (sim.rng.next() < chance) {
        if (joinWar(sim, w, k, side)) { aiLog(sim, k, `Répond à l'appel de ${sd.name} et entre en guerre.`, 'bad'); aiLog(sim, s, `${kd.name} rejoint la guerre à nos côtés.`, 'good'); }
      } else if (allied) {
        aiLog(sim, k, `Refuse d'entrer en guerre aux côtés de ${sd.name}.`);
        addRel(sim, s, k, -4);
      }
      return;
    }
  }
}

function seekAlliance(sim, s, enemies, neigh) {
  const S = sim.S;
  const sd = sim.sides[s];
  if (sim.rules.alliances === false || sd.ai.personality === 'isolationist' || (sd.ai.lastAllianceTry && sim.time - sd.ai.lastAllianceTry < 40)) return;
  sd.ai.lastAllianceTry = sim.time;
  let best = -1, bv = 0;
  for (let k = 0; k < S; k++) {
    if (k === s || sim.sides[k].eliminated || sim.allied[s * S + k] || sim.atWar[s * S + k]) continue;
    const common = enemies.some((e) => sim.atWar[k * S + e]) ? 40 : 0;
    const rival = neigh.some((n) => n.rel < -30 && sim.rel[k * S + n.o] < -30) ? 20 : 0;
    const v = sim.rel[s * S + k] + common + rival;
    if (v > bv && v > 30) { bv = v; best = k; }
  }
  if (best < 0) return;
  if (!canPropose(sim, s, best, 'alliance', null, { cooldown: 80 }).ok) return;
  const kd = sim.sides[best];
  const P = PERSONALITIES[kd.ai.personality];
  if (isPlayer(sim, best)) { sim.nation.at(best).offer(s, 'alliance', {}, `${sd.name} propose une alliance${enemies.length ? ' face à ses ennemis' : ''}.`); return; }
  const ok = sim.rng.next() < 0.5 * P.ally * (1 + trustOf(sim, best, s));
  noteProposal(sim, s, best, 'alliance', ok ? 'accept' : 'refuse');
  if (!ok) { aiLog(sim, best, `Décline l'alliance proposée par ${sd.name}.`); return; }
  {
    dnote(sim, s, best, 'alliance', 'Alliance conclue');
    sim.allied[s * S + best] = sim.allied[best * S + s] = 1;
    addRel(sim, s, best, 20);
    sim.chron('alliance', `Alliance entre ${sd.name} et ${kd.name}.`, { e: [sd.e, kd.e] });
    sim.hist(s, 'alliance', `Alliance avec ${kd.name}.`); sim.hist(best, 'alliance', `Alliance avec ${sd.name}.`);
    aiLog(sim, s, `Alliance conclue avec ${kd.name}.`, 'good');
    sim._emit({ icon: '🤝', title: 'ALLIANCE', tone: 'good', side: s, text: `${sd.name} et ${kd.name} concluent une alliance.` });
  }
}

function declare(sim, s, o) {
  if (sim.rules.wars === false) return;
  const S = sim.S;
  if (sim.atWar[s * S + o] || sim.truce[s * S + o] > sim.time || sim.sides[o].eliminated) return;
  if (sim.activeWars.some((w) => (w.a.includes(s) && w.b.includes(o)) || (w.b.includes(s) && w.a.includes(o)))) return;
  const sd = sim.sides[s];
  let wars = 0; for (let k = 0; k < S; k++) if (sim.atWar[s * S + k]) wars++;
  if (wars >= 2) return;
  // limite globale : pas plus de N nouvelles guerres déclarées par les IA par an (parties longues)
  if (sim.cfg.maxWarsPerYear) {
    sim.aiDeclares = (sim.aiDeclares || []).filter((x) => sim.time - x < YEAR_SEC);
    if (sim.aiDeclares.length >= Math.round(sim.cfg.maxWarsPerYear * tn(sim, 'aiWarFreq'))) return;
  }
  // un pacte de non-agression avec le joueur est respecté (sauf personnalité très agressive)
  if (isPlayer(sim, o)) { const d = sim.nation.deal(s, o); if (d && d.nap > sim.time && PERSONALITIES[sim.sides[s].ai.personality].expand < 1.5) return; }
  const w = startWar(sim, [s], [o], 'declaration');
  if (!w) return;
  dnote(sim, s, o, 'war', `Déclaration de guerre de ${sim.sides[s].name}`);
  if (sim.cfg.maxWarsPerYear) sim.aiDeclares.push(sim.time);
  if (isPlayer(sim, o)) sim.nation.at(o).milestone('war', `${sd.name} nous déclare la guerre.`);
  aiLog(sim, s, `Déclaration de guerre à ${sim.sides[o].name}.`, 'bad');
  aiLog(sim, o, `${sd.name} nous déclare la guerre.`, 'bad');
  // alliances défensives
  for (let k = 0; k < S; k++) {
    if (k === o || k === s || !sim.allied[o * S + k] || sim.sides[k].eliminated || sim.allied[s * S + k]) continue;
    const P = PERSONALITIES[sim.sides[k].ai.personality];
    if (sim.rng.next() < 0.5 * P.ally + 0.2) joinWar(sim, w, k, 'b');
  }
  sd.exhaustion = Math.max(0, sd.exhaustion - 0.1);
  addRel(sim, s, o, -30);
  void getRel;
}
