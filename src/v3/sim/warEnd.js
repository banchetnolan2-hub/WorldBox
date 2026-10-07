// FIN DES GUERRES — conditions configurables et contrôle de la paix.
//
// « Paix automatique » (warEnd.autoPeace) :
//   ON  : une condition remplie (pourcentage de territoire, capitulation, effondrement économique,
//         objectifs de guerre) termine la guerre d'elle-même (comportement historique du Bac à sable).
//   OFF : (défaut du mode Nation) AUCUNE guerre ne se termine parce qu'un pays a perdu une part de son
//         territoire. Ces situations produisent seulement des ÉVÉNEMENTS et des PROPOSITIONS :
//         - joueur vainqueur : « Le pays X est fortement affaibli. Souhaitez-vous proposer des conditions de paix ? »
//           (proposition de capitulation à accepter, refuser ou amender) ;
//         - joueur vaincu : le vainqueur exige une capitulation, que le joueur peut refuser ;
//         - entre IA : le vaincu propose sa capitulation, le vainqueur l'accepte ou poursuit selon sa personnalité.
//         La guerre continue tant qu'aucun accord n'est accepté. Seules exceptions : la conquête totale (il ne
//         reste rien à combattre) et la durée maximale si le joueur en a fixé une.
// La perte de territoire pèse sur la stabilité, l'économie, le moral, la capacité militaire, la diplomatie,
// le risque de révolte et le risque de capitulation (territorialEffects), sans jamais imposer la paix.
import { MONTH_SEC, YEAR_SEC } from './calendar.js';
import { PERSONALITIES } from './profile.js';
import { evaluatePeace, applyPeace, claimableRegions, regionCells, noteProposal, describeTerms, canPropose } from './diplomacy.js';
import { applyLosses } from './economy.js';

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const r2 = (v) => Math.round(v * 100) / 100;

// conditions de fin affichées dans les paramètres
export const END_CONDITIONS = [
  { id: 'conquest', icon: '🗺️', label: 'Conquête totale', desc: 'La guerre peut aller jusqu\'à la conquête complète de l\'adversaire. Désactivée : le dernier réduit (5 % du territoire) ne tombe pas, la capitulation est alors imposée.' },
  { id: 'peace', icon: '🤝', label: 'Paix négociée', desc: 'Propositions, contre-propositions et traités : territoires transférés, restitutions, réparations.' },
  { id: 'capitulation', icon: '🏳️', label: 'Capitulation', desc: 'Capitale perdue, armée détruite ou moral effondré : le vaincu offre sa capitulation (ou le vainqueur l\'exige).' },
  { id: 'economic', icon: '💰', label: 'Effondrement économique', desc: 'Crise prolongée et armée sous-financée : le pays en faillite cherche à capituler.' },
  { id: 'objectives', icon: '⚔️', label: 'Objectifs de guerre atteints', desc: 'Régions visées (et capitale) tenues pendant un mois : le vainqueur peut imposer ses conditions.' },
  { id: 'maxYears', icon: '⏱️', label: 'Durée maximale', desc: 'Armistice sur les lignes de front après le nombre d\'années choisi (0 : aucune limite).' },
];

export const NATION_WAR_END = { autoPeace: false, territorial: 'percent', percent: 0.7, conquest: true, peace: true, capitulation: true, economic: true, objectives: true, maxYears: 0 };
export const NO_AUTO_END = { autoPeace: false, territorial: 'none', conquest: true, peace: true, capitulation: false, economic: false, objectives: false, maxYears: 0 };

// complète une configuration (anciennes sauvegardes, Bac à sable)
export function normalizeWarEnd(we, nation = false) {
  const o = { ...(we || {}) };
  if (o.autoPeace === undefined) o.autoPeace = !nation;          // mode Nation : jamais de paix automatique par défaut
  if (o.conquest === undefined) o.conquest = true;
  if (o.objectives === undefined) o.objectives = !nation ? false : true;
  if (o.maxYears === undefined) o.maxYears = 0;
  if (o.territorial === undefined) o.territorial = 'percent';
  if (o.percent === undefined) o.percent = 0.65;
  if (o.peace === undefined) o.peace = true;
  if (o.capitulation === undefined) o.capitulation = true;
  if (o.economic === undefined) o.economic = true;
  return o;
}

export function warEndSummary(we) {
  if (!we) return '';
  if (we.autoPeace) return `Paix automatique : ON (${Math.round((we.percent || 0.65) * 100)} % du territoire)`;
  const on = END_CONDITIONS.filter((c) => (c.id === 'maxYears' ? we.maxYears > 0 : we[c.id] !== false)).map((c) => c.label.toLowerCase());
  return `Paix automatique : OFF — ${on.length ? on.join(', ') : 'aucune fin automatique'}`;
}

const isPlayerSide = (sim, k) => !!(sim.nation && sim.nation.isHuman(k));
const leadOf = (sim, list) => list.filter((k) => !sim.sides[k].eliminated).sort((x, y) => sim.sides[y].initial - sim.sides[x].initial)[0];
const playerIn = (sim, list) => !!(sim.nation && list.some((k) => sim.nation.isHuman(k)));
const humanIn = (sim, list) => list.find((k) => !sim.sides[k].eliminated && sim.nation.isHuman(k));

// ---------------- risque de capitulation (0..1) ----------------
export function collapseRisk(sim, w, list, shareLost) {
  const alive = list.filter((k) => !sim.sides[k].eliminated);
  if (!alive.length) return 1;
  let units = 0, init = 0, capLost = true, cells = 0, pre = 0, morale = 0, stab = 0, crisis = 0;
  for (const k of alive) {
    const sd = sim.sides[k];
    units += sd.units; init += w.initialUnits[k] || sd.maxUnits || 1;
    cells += sd.cells; pre += w.prewar[k] || sd.initial;
    morale += sd.morale; stab += sd.stability; crisis += sd.crisis ? 1 : 0;
    if (sd.capital >= 0 && (sim.owner[sd.capital] === sd.e || sim.time - (sd.capLostAt || 0) < 18)) capLost = false;
  }
  const n = alive.length;
  const armyLeft = units / Math.max(1, init);
  const lost = Math.max(shareLost, 1 - cells / Math.max(1, pre));
  const r = lost * 0.45 + (capLost ? 0.22 : 0) + clamp(1 - armyLeft, 0, 1) * 0.25 + clamp(0.8 - morale / n, 0, 0.6) * 0.35 + clamp(0.5 - stab / n, 0, 0.4) * 0.3 + (crisis / n) * 0.08;
  return r2(clamp(r, 0, 1));
}

// conditions « dures » (identiques à l'ancien système, utilisées pour savoir quand proposer une capitulation)
export function capitulates(sim, w, list, shareLost) {
  const alive = list.filter((k) => !sim.sides[k].eliminated);
  if (!alive.length) return true;
  let units = 0, init = 0, capLost = true;
  for (const k of alive) {
    const sd = sim.sides[k];
    units += sd.units; init += w.initialUnits[k] || sd.maxUnits;
    if (sd.capital >= 0 && (sim.owner[sd.capital] === sd.e || sim.time - (sd.capLostAt || 0) < 18)) capLost = false;
  }
  const armyLeft = units / Math.max(1, init);
  const moraleLow = alive.every((k) => sim.sides[k].morale < 0.45);
  return (capLost && (shareLost > 0.4 || armyLeft < 0.3)) || (armyLeft < 0.12 && shareLost > 0.12) || (moraleLow && shareLost > 0.5);
}

// ---------------- objectifs de guerre ----------------
// goals[side] = { regions: [id…], capital: bool, liberate: bool, custom: bool }
export function initWarGoals(sim, w) {
  w.goals = { a: goalsFor(sim, w, 'a'), b: goalsFor(sim, w, 'b') };
  w.goalAt = { a: 0, b: 0 };
}
function goalsFor(sim, w, side) {
  const mine = side === 'a' ? w.a : w.b, other = side === 'a' ? w.b : w.a;
  // le camp agressé (b) cherche d'abord à libérer son territoire ; l'agresseur vise des régions frontalières et la capitale
  if (side === 'b' && w.cause !== 'initial') return { regions: [], capital: false, liberate: true, custom: false };
  const g = { regions: [], capital: true, liberate: false, custom: false };
  if (!sim.details || !sim.details.regionOf) return g;
  const own = new Set(mine.map((k) => sim.sides[k].e)), enemy = new Set(other.map((k) => sim.sides[k].e));
  const grid = sim.grid, rc = regionCells(sim), ro = sim.details.regionOf;
  const score = new Map();
  for (const [rid, cells] of rc) {
    const reg = sim.details.regions[rid];
    if (!reg || !enemy.has(reg.e)) continue;
    let touch = 0;
    for (let q = 0; q < cells.length && touch < 40; q += 3) {
      const c = cells[q];
      for (let k = grid.nbrStart[c]; k < grid.nbrStart[c + 1]; k++) if (own.has(sim.owner[grid.nbr[k]])) { touch++; break; }
    }
    if (touch) score.set(rid, touch + cells.length * 0.002);
  }
  g.regions = [...score.entries()].sort((x, y) => y[1] - x[1] || x[0] - y[0]).slice(0, 4).map((x) => x[0]);
  void ro;
  return g;
}
// part (surface) des objectifs tenue par le camp
export function goalProgress(sim, w, side) {
  const g = w.goals && w.goals[side];
  if (!g) return { ok: false, share: 0, capital: false, items: 0 };
  const mine = side === 'a' ? w.a : w.b, other = side === 'a' ? w.b : w.a;
  const own = new Set(mine.map((k) => sim.sides[k].e));
  if (g.liberate) {
    // libération : plus aucune parcelle du camp n'est occupée (et il y en a eu)
    let occ = 0, ever = 0;
    for (const [c, pre] of w.changes) { if (!own.has(pre)) continue; ever++; if (!own.has(sim.owner[c])) occ++; }
    return { ok: ever > 0 && occ === 0, share: ever ? 1 - occ / ever : 1, capital: false, items: ever ? 1 : 0, liberate: true };
  }
  const kmOf = (c) => (sim.geo ? sim.geo.km2[c] : 770);
  const rc = regionCells(sim);
  let tot = 0, held = 0, allRegs = true;
  for (const rid of g.regions || []) {
    let t = 0, h = 0;
    for (const c of rc.get(rid) || []) { const k = kmOf(c); t += k; if (own.has(sim.owner[c])) h += k; }
    tot += t; held += h;
    if (t && h / t < 0.9) allRegs = false;
  }
  const lead = leadOf(sim, other);
  const cap = lead !== undefined ? sim.sides[lead].capital : -1;
  const capHeld = cap >= 0 && own.has(sim.owner[cap]);
  const needCap = g.capital && cap >= 0;
  const regsOk = (g.regions || []).length ? allRegs : true;
  const ok = ((g.regions || []).length || needCap) && regsOk && (!needCap || capHeld);
  return { ok: !!ok, share: tot ? held / tot : capHeld ? 1 : 0, capital: capHeld, items: (g.regions || []).length + (needCap ? 1 : 0) };
}
export function setPlayerGoals(sim, w, side, regions, capital) {
  if (!w.goals) initWarGoals(sim, w);
  w.goals[side] = { regions: [...new Set(regions)].slice(0, 40), capital: !!capital, liberate: false, custom: true };
  w.goalAt[side] = 0;
}

// conditions de capitulation : toutes les régions occupées par le vainqueur (et les objectifs si demandé).
// opts.only : capitulation d'un seul pays (paix séparée dans une coalition) — seules ses régions sont visées.
export function capitulationTerms(sim, w, winnerSide, proposer, opts = {}) {
  const winList = winnerSide === 'a' ? w.a : w.b, loseList = winnerSide === 'a' ? w.b : w.a;
  const claimant = leadOf(sim, winList);
  const loserLead = opts.only !== undefined ? opts.only : leadOf(sim, loseList);
  const t = { war: w.id, proposer, kind: 'treaty', territory: 'keep', reparations: 0, payer: -1, truceYears: 5, capitulation: true };
  if (opts.only !== undefined) t.separate = opts.only;
  if (claimant === undefined) return t;
  if (sim.details) {
    const onlyE = opts.only !== undefined ? sim.sides[opts.only].e : -1;
    const regs = claimableRegions(sim, w, claimant).filter((x) => onlyE < 0 || x.e === onlyE);
    const claims = regs.filter((x) => x.occupied >= (opts.all ? 0.01 : 0.5)).map((x) => x.id);
    if (opts.goals && w.goals && w.goals[winnerSide]) {
      const ok = new Set(regs.map((x) => x.id));
      for (const id of w.goals[winnerSide].regions || []) if (!claims.includes(id) && ok.has(id)) claims.push(id);
    }
    if (claims.length) { t.territory = 'custom'; t.claimant = claimant; t.claims = claims; }
  }
  if (loserLead !== undefined) { t.payer = loserLead; t.reparations = Math.round(sim.sides[loserLead].eco.gdp * (opts.goals ? 0.006 : 0.012) * 10) / 10; }
  return t;
}

// pertes de chaque pays (part de son territoire d'avant-guerre tenue par le camp adverse)
function lossesBy(sim, w) {
  const held = new Map();
  for (const [c, pre] of w.changes) {
    const ps = sim.sideOf[pre], cs = sim.sideOf[sim.owner[c]];
    if (ps < 0 || cs < 0 || cs === ps) continue;
    const enemy = (w.a.includes(ps) && w.b.includes(cs)) || (w.b.includes(ps) && w.a.includes(cs));
    if (enemy) held.set(ps, (held.get(ps) || 0) + 1);
  }
  const out = new Map();
  for (const k of [...w.a, ...w.b]) out.set(k, sim.sides[k].eliminated ? 1 : (held.get(k) || 0) / Math.max(1, w.prewar[k] || sim.sides[k].initial));
  return out;
}

// ---------------- contrôle des guerres sans paix automatique ----------------
// Retourne true si la guerre a été terminée par cette fonction.
export function manualWarEndCheck(sim, w, cond, ctx) {
  const { A, B, h } = ctx;
  const loss = lossesBy(sim, w);
  const maxLoss = (list) => list.reduce((m, k) => Math.max(m, loss.get(k) || 0), 0);
  w.risk = { a: collapseRisk(sim, w, A, Math.max(h.shareB, maxLoss(A))), b: collapseRisk(sim, w, B, Math.max(h.shareA, maxLoss(B))) };
  w.losses = Object.fromEntries([...loss].map(([k, v]) => [k, r2(v)]));
  const dur = sim.time - w.start;
  // durée maximale fixée par le joueur : armistice sur les lignes de front
  if (cond.maxYears > 0 && dur >= cond.maxYears * YEAR_SEC) {
    const terms = { war: w.id, proposer: leadOf(sim, w.a), kind: 'ceasefire', territory: 'keep', reparations: 0, payer: -1, truceYears: 3 };
    w.terms = terms;
    w.moments.push({ t: sim.time, type: 'victory', text: `Durée maximale atteinte (${cond.maxYears} an${cond.maxYears > 1 ? 's' : ''}) : armistice sur les lignes de front.` });
    ctx.endWar(sim, w, Math.abs(h.shareA - h.shareB) > 0.1 ? (h.shareA > h.shareB ? 'a' : 'b') : null, 'duration');
    return true;
  }
  // conquête totale interdite : le dernier réduit (5 %) d'un pays ne tombe pas, sa capitulation est imposée
  if (cond.conquest === false) {
    for (const [win, winList, loseList] of [['a', A, B], ['b', B, A]]) {
      for (const k of loseList) {
        if ((loss.get(k) || 0) < 0.95) continue;
        if (loseList.length > 1) { const t = capitulationTerms(sim, w, win, k, { only: k }); separateCapitulation(sim, w, k, t); return false; }
        applyPeace(sim, w, capitulationTerms(sim, w, win, leadOf(sim, winList)), (s, ww, winner) => endWarCb(s, ww, winner, 'capitulation'));
        return true;
      }
    }
  }
  if (dur < 20 || (sim.time - (w._weCheck || -99)) < MONTH_SEC * 0.5) return false;
  w._weCheck = sim.time;
  if (!w.events) w.events = {};
  const peaceOn = cond.peace !== false && sim.rules.peace !== false;
  const pct = clamp(cond.percent || 0.7, 0.05, 1);
  for (const [win, winList, loseList, share, otherShare] of [['a', A, B, h.shareA, h.shareB], ['b', B, A, h.shareB, h.shareA]]) {
    // objectifs de guerre du camp (tenus un mois)
    let goalsDone = false;
    if (cond.objectives !== false && w.goals) {
      const gp = goalProgress(sim, w, win);
      if (gp.ok) { if (!w.goalAt[win]) w.goalAt[win] = sim.time; } else w.goalAt[win] = 0;
      const evw = w.events[win] || (w.events[win] = { goal: -999 });
      if (w.goalAt[win] && sim.time - w.goalAt[win] >= MONTH_SEC && sim.time - (evw.goal ?? -999) > MONTH_SEC * 8) { evw.goal = sim.time; goalsDone = true; }
    }
    // chaque pays du camp adverse, du plus touché au moins touché
    const cands = loseList.filter((k) => !sim.sides[k].eliminated).sort((x, y) => (loss.get(y) || 0) - (loss.get(x) || 0) || x - y);
    for (const k of cands) {
      const lk = loss.get(k) || 0;
      if (lk <= 0.02 && !goalsDone) continue;
      const ev = w.events['k' + k] || (w.events['k' + k] = { pct: 0, cap: -999, capShare: 0 });
      const reasons = [];
      // seuil de territoire : seulement un événement (jamais une fin)
      if (cond.territorial !== 'none' && lk >= pct && !ev.pct) {
        ev.pct = sim.time;
        const K = sim.sides[k];
        const txt = `${K.name} a perdu ${Math.round(lk * 100)} % de son territoire d'avant-guerre. La guerre continue tant qu'aucun accord n'est signé.`;
        w.moments.push({ t: sim.time, type: 'turn', text: txt });
        sim.chron('war', txt, { war: w.id, e: [K.e] });
        sim._emit({ icon: '🏳️', title: 'PAYS FORTEMENT AFFAIBLI', tone: playerIn(sim, winList) ? 'good' : playerIn(sim, [k]) ? 'bad' : 'neutral', side: k, text: txt, war: w.id });
        reasons.push('percent');
      } else if (cond.territorial !== 'none' && lk >= pct) reasons.push('percent');
      if (cond.capitulation !== false && lk > otherShare * 0.5 && capitulates(sim, w, [k], Math.max(lk, share))) reasons.push('capitulation');
      if (cond.economic !== false && economicCollapse(sim, [k]) && !economicCollapse(sim, winList)) reasons.push('economic');
      if (goalsDone && k === goalTarget(sim, w, win, loseList)) reasons.push('objectives');
      if (!reasons.length || !peaceOn) continue;
      // une proposition au plus tous les 6 mois, sauf si la situation s'est nettement aggravée
      const urgent = reasons.includes('objectives');
      if (!urgent && !(sim.time - ev.cap > MONTH_SEC * 6 || lk >= ev.capShare + 0.1)) continue;
      ev.cap = sim.time; ev.capShare = lk;
      const reason = urgent ? 'objectives' : reasons.includes('capitulation') ? 'capitulation' : reasons.includes('economic') ? 'economic' : 'percent';
      if (offerSurrender(sim, w, win, winList, loseList, k, reason, lk)) return true;
      break;     // une proposition par camp et par vérification
    }
  }
  return false;
}

// pays principalement visé par les objectifs de guerre d'un camp
function goalTarget(sim, w, win, loseList) {
  const g = w.goals && w.goals[win];
  const lead = leadOf(sim, loseList);
  if (!g || !(g.regions || []).length || !sim.details) return lead;
  const cnt = new Map();
  for (const rid of g.regions) { const reg = sim.details.regions[rid]; if (!reg) continue; const k = sim.sideOf[reg.e]; if (k >= 0 && loseList.includes(k)) cnt.set(k, (cnt.get(k) || 0) + 1); }
  let best = lead, bv = 0;
  for (const [k, v] of cnt) if (v > bv || (v === bv && k < best)) { best = k; bv = v; }
  return g.capital && cnt.size > 1 ? lead : best;
}

function economicCollapse(sim, list) {
  const alive = list.filter((k) => !sim.sides[k].eliminated);
  if (!alive.length) return true;
  const lead = alive.reduce((m, k) => (sim.sides[k].initial > sim.sides[m].initial ? k : m), alive[0]);
  const sd = sim.sides[lead];
  return sd.crisis && sd.readiness < 0.5 && (sd.crisisMonths || 0) >= 3;
}

const REASON_TXT = {
  percent: 'a perdu l\'essentiel de son territoire',
  capitulation: 'est au bord de l\'effondrement militaire',
  economic: 'est en faillite et ne peut plus financer son armée',
  objectives: 'ne peut plus défendre les régions que vous visiez',
};

// capitulation séparée d'un membre d'une coalition : il quitte la guerre et cède les régions convenues
export function separateCapitulation(sim, w, k, terms) {
  if (!w || w.status !== 'active') return false;
  const mine = w.a.includes(k) ? w.a : w.b;
  if (mine.length <= 1) return false;
  const claimant = terms.claimant !== undefined ? sim.sides[terms.claimant] : null;
  const keep = [];
  if (claimant && !claimant.eliminated && (terms.claims || []).length) {
    const rc = regionCells(sim), ke = sim.sides[k].e;
    for (const rid of terms.claims) for (const c of rc.get(rid) || []) if (sim.origin[c] === ke || sim.owner[c] === ke || w.changes.get(c) === ke) keep.push(c);
  }
  const ok = separatePeaceCb ? separatePeaceCb(sim, w, k) : false;
  if (!ok) return false;
  if (!(sim.intentional instanceof Map)) sim.intentional = new Map();
  const ce = claimant ? claimant.e : -1;
  for (const c of keep) {
    const o = sim.owner[c];
    if (o !== sim.sides[k].e && o !== ce) continue;
    if (o !== ce) sim.flip(c, ce, false);
    if (sim.occupied[c]) { sim.occupied[c] = 0; claimant.occupiedCells = Math.max(0, claimant.occupiedCells - 1); }
    sim.intentional.set(c, ce);
  }
  if (terms.reparations > 0 && terms.payer === k) { const amt = Math.min(terms.reparations, sim.sides[k].money); sim.sides[k].money -= amt; if (claimant) claimant.money += amt; }
  const K = sim.sides[k];
  const txt = `${K.name} capitule séparément${keep.length && claimant ? ` et cède ${(terms.claims || []).length} région(s) à ${claimant.name}` : ''}. Ses alliés poursuivent la guerre.`;
  w.moments.push({ t: sim.time, type: 'victory', text: txt });
  sim.chron('treaty', txt, { war: w.id, e: [K.e] });
  sim.hist(k, 'peace', `Capitulation séparée : ${w.name}.`);
  sim._emit({ icon: '🏳️', title: 'CAPITULATION SÉPARÉE', tone: 'neutral', side: k, text: txt, war: w.id });
  sim.markDirty([k, ...(w.a.includes(k) ? w.b : w.a)]);
  return true;
}
let separatePeaceCb = null;
export function bindSeparatePeace(fn) { separatePeaceCb = fn; }

// la situation permet une capitulation : proposition (joueur) ou négociation entre IA.
// k : pays qui capitule (s'il a des alliés encore en guerre : capitulation séparée)
function offerSurrender(sim, w, win, winList, loseList, k, reason, share) {
  const W = leadOf(sim, winList);
  if (W === undefined) return false;
  const alive = loseList.filter((x) => !sim.sides[x].eliminated);
  const separate = alive.length > 1 && k !== leadOf(sim, loseList);
  const L = separate ? k : leadOf(sim, loseList);
  const WS = sim.sides[W], LS = sim.sides[L];
  const opts = { goals: reason === 'objectives', ...(separate ? { only: L } : {}) };
  // le joueur est dans le camp vainqueur : « Souhaitez-vous proposer des conditions de paix ? »
  if (sim.nation && humanIn(sim, winList) !== undefined) {
    const p = humanIn(sim, winList), nation = sim.nation.at(p);
    if (nation.offers.some((o) => o.from === L && (o.type === 'peace' || o.type === 'surrender'))) return false;
    if (reason !== 'objectives' && (!canPropose(sim, L, p, 'peace', null, { cooldown: 45 }).ok || !nation.peaceOfferReady())) return false;
    const terms = capitulationTerms(sim, w, win, L, opts);
    const intro = reason === 'objectives' ? `Vos objectifs de guerre contre ${LS.name} sont atteints.` : `${LS.name} ${REASON_TXT[reason]} (${Math.round(share * 100)} % de son territoire perdu).`;
    nation.offer(L, 'surrender', { terms, war: w.id, reason, separate: separate ? L : undefined }, `${intro} Le pays ${LS.name} est fortement affaibli. Souhaitez-vous proposer des conditions de paix ?${separate ? ' (Capitulation séparée : ses alliés restent en guerre.)' : ''} La guerre continue tant qu'aucun accord n'est accepté.`);
    noteProposal(sim, L, p, 'peace', 'pending');
    return false;
  }
  // le joueur est dans le camp vaincu : le vainqueur exige sa capitulation (refusable)
  if (sim.nation && humanIn(sim, loseList) !== undefined && (!separate || sim.nation.isHuman(L))) {
    const nation = sim.nation.at(separate ? L : humanIn(sim, loseList));
    if (nation.offers.some((o) => o.from === W && o.type === 'peace')) return false;
    if (!canPropose(sim, W, nation.player, 'peace', null, { cooldown: 45 }).ok || !nation.peaceOfferReady()) return false;
    const terms = capitulationTerms(sim, w, win, W, opts);
    const d = describeTerms(sim, w, terms, nation.player);
    noteProposal(sim, W, nation.player, 'peace', 'pending');
    nation.offer(W, 'peace', { terms, war: w.id, capitulation: true, reason, separate: separate ? L : undefined }, `${WS.name} exige votre capitulation. ${d.proposed[0] || ''} Vous pouvez refuser et poursuivre la guerre.`);
    return false;
  }
  return aiSurrender(sim, w, win, W, L, reason, share, opts);
}
// entre IA : le vaincu offre sa capitulation ; le vainqueur décide selon ses intérêts et sa personnalité
function aiSurrender(sim, w, win, W, L, reason, share, opts) {
  const WS = sim.sides[W], LS = sim.sides[L];
  const terms = capitulationTerms(sim, w, win, L, opts);
  const ev = evaluatePeace(sim, w, W, terms);
  const P = PERSONALITIES[(WS.ai && WS.ai.personality) || 'opportunist'];
  const greedy = P.expand > 1.2 && share < 0.92 && reason !== 'objectives' && sim.rng.next() < 0.45;
  const accept = (ev.result === 'accept' || opts.only !== undefined) && !greedy;
  noteProposal(sim, L, W, 'peace', accept ? 'accept' : 'refuse');
  if (accept) {
    if (opts.only !== undefined) return separateCapitulation(sim, w, L, terms) && false;
    w.moments.push({ t: sim.time, type: 'victory', text: `${LS.name} capitule ; ${WS.name} accepte ses conditions.` });
    applyPeace(sim, w, terms, (s, ww, winner) => endWarCb(s, ww, winner, reason === 'economic' ? 'economic' : reason === 'objectives' ? 'objectives' : 'capitulation'));
    return true;
  }
  const txt = `${LS.name} offre sa capitulation ; ${WS.name} refuse et poursuit la guerre.`;
  w.moments.push({ t: sim.time, type: 'turn', text: txt });
  sim.chron('war', txt, { war: w.id, e: [LS.e, WS.e] });
  return false;
}
let endWarCb = null;
export function bindEndWar(fn) { endWarCb = fn; }

// le joueur accepte la capitulation offerte (ou ses propres conditions sont acceptées)
export function acceptSurrender(sim, w, terms, reason) {
  if (!w || w.status !== 'active') return false;
  if (terms.separate !== undefined && (w.a.includes(terms.separate) ? w.a : w.b).length > 1) return separateCapitulation(sim, w, terms.separate, terms);
  applyPeace(sim, w, terms, (s, ww, winner) => endWarCb(s, ww, winner, reason === 'economic' ? 'economic' : reason === 'objectives' ? 'objectives' : 'capitulation'));
  return true;
}

// ---------------- conséquences de la perte de territoire (mensuel) ----------------
// stabilité, économie, moral, capacité militaire, diplomatie, risque de révolte — sans forcer la paix
export function territorialEffects(sim, s) {
  const sd = sim.sides[s];
  if (sd.eliminated) return;
  const lost = clamp(1 - sd.cells / Math.max(1, sd.initial), 0, 1);
  const occ = sd.occupiedCells || 0;
  sd.lostShare = r2(lost);
  // capacité militaire : moins de territoire, moins de recrues et d'industrie
  if (lost > 0.05) {
    const k = 1 - lost * 0.5;
    sd.manpower *= 0.97 + 0.03 * k;
    sd.readiness = clamp(sd.readiness - lost * 0.015, 0.15, 1);
  }
  // risque de révolte : territoire perdu, stabilité, lassitude, crise
  const risk = clamp(lost * 0.55 + (1 - sd.stability) * 0.45 + sd.exhaustion * 0.3 + (sd.crisis ? 0.12 : 0) - 0.42, 0, 1);
  sd.revoltRisk = r2(risk);
  if (risk > 0.05 && sim.rules.politicalEvents !== false && sim.rng.next() < risk * 0.22) {
    sd.stability = clamp(sd.stability - 0.04 - risk * 0.05, 0.15, 1);
    sd.morale = clamp(sd.morale - 0.03, 0.25, 1.25);
    sd.readiness = clamp(sd.readiness - 0.05, 0.15, 1);
    sd.p.politics.stability = Math.max(5, sd.p.politics.stability - 2 - risk * 4);
    const txt = lost > 0.3 ? `Troubles intérieurs en ${sd.name} : la population conteste la conduite de la guerre.` : `Agitation sociale en ${sd.name}.`;
    sim.hist(s, 'crisis', txt);
    if (isPlayerSide(sim, s) || lost > 0.4) sim._emit({ icon: '🔥', title: 'RÉVOLTE', tone: isPlayerSide(sim, s) ? 'bad' : 'neutral', side: s, text: `${txt} Stabilité et préparation de l'armée en baisse.`, nation: isPlayerSide(sim, s) });
  }
  // résistance dans les territoires occupés : pertes pour l'occupant
  if (occ > 0 && sim.rules.movements !== false) {
    const resist = Math.min(0.012, occ / Math.max(1, sd.cells) * 0.02) * (1 + sim.rng.next());
    if (resist > 0.0005) applyLosses(sd, sd.units * resist, false);
  }
  // sursaut national : un pays très affaibli mais encore stable peut lancer une contre-offensive
  if (sim.isAtWar(s) && lost > 0.35 && sd.stability > 0.35 && sd.morale > 0.5 && !sd.mods.some((m) => m.kind === 'rally') && sim.rng.next() < 0.12 * lost) {
    sim.addMod(s, { kind: 'rally', atk: 1.25, def: 1.15, until: sim.time + MONTH_SEC * 2 });
    sd.morale = clamp(sd.morale + 0.08, 0.25, 1.25);
    const txt = `Sursaut national en ${sd.name} : mobilisation générale et contre-offensive.`;
    sim.hist(s, 'war', txt);
    sim._emit({ icon: '⚡', title: 'CONTRE-OFFENSIVE', tone: isPlayerSide(sim, s) ? 'good' : 'neutral', side: s, text: txt });
  }
  // diplomatie : les pays tiers se rapprochent du pays envahi et se méfient de l'envahisseur
  if (lost > 0.25 && sim.isAtWar(s) && sim.rules.relations !== false) {
    const S = sim.S;
    for (let o = 0; o < S; o++) {
      if (!sim.atWar[s * S + o]) continue;
      for (let t = 0; t < S; t++) {
        if (t === s || t === o || sim.sides[t].eliminated || sim.atWar[t * S + s] || sim.atWar[t * S + o]) continue;
        if (sim.rel[t * S + s] > 0) { sim.rel[t * S + o] = clamp(sim.rel[t * S + o] - 0.4 * lost, -100, 100); sim.rel[o * S + t] = clamp(sim.rel[o * S + t] - 0.4 * lost, -100, 100); }
      }
    }
  }
}


