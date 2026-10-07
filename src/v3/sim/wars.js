// GUERRES — cycle complet : tensions -> déclaration -> fronts et batailles -> condition de fin ->
// négociation -> TRAITÉ DE PAIX -> BORDER CLEANUP -> nouvelle carte -> relations, mémoire des IA,
// rapport de guerre (WAR REPORT), histoire du pays et histoire du monde. Tout est sérialisable.
import { onWarStarted } from './coalitions.js';
import { direction, secKey } from './fronts.js';
import { fmtDuration } from './calendar.js';
import { geoFor } from './geo.js';
import { de, ordinalF } from './fr.js';
import { reorganize } from './reorg.js';
import { settleTerms, dnote, claimTransfers } from './diplomacy.js';
import { manualWarEndCheck, initWarGoals, bindEndWar, bindSeparatePeace, capitulates as capitulatesHard } from './warEnd.js';
import { separatePeaceWith } from './coalitions.js';

const NONE = 65535;
const YEAR_SEC_W = 365 / 3;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const END_REASONS = {
  complete: 'Victoire territoriale complète',
  percent: 'Victoire territoriale',
  capitulation: 'Capitulation',
  economic: 'Effondrement économique',
  peace: 'Paix négociée',
  elimination: 'Disparition de l\'adversaire',
  armistice: 'Armistice (fin de la simulation)',
  manual: 'Fin décidée manuellement',
  objectives: 'Objectifs de guerre atteints',
  duration: 'Durée maximale atteinte (armistice)',
};
export const DEFAULT_WAR_END = { territorial: 'percent', percent: 0.65, economic: true, peace: true, capitulation: true };

// ---------------- relations ----------------
export function relIdx(sim, a, b) { return a * sim.S + b; }
export function getRel(sim, a, b) { return sim.rel[a * sim.S + b]; }
export function addRel(sim, a, b, v) {
  if (sim.rules && sim.rules.relations === false) return;
  const S = sim.S;
  sim.rel[a * S + b] = clamp(sim.rel[a * S + b] + v, -100, 100);
  sim.rel[b * S + a] = clamp(sim.rel[b * S + a] + v, -100, 100);
}
export function relationStatus(sim, a, b) {
  const S = sim.S;
  if (sim.atWar[a * S + b]) return 'war';
  if (sim.allied[a * S + b]) return 'ally';
  const r = sim.rel[a * S + b];
  if (r <= -55) return 'hostile';
  if (r <= -20) return 'rival';
  if (r >= 22 && sim.trade && sim.trade[a * S + b]) return 'trade';
  if (r >= 25) return 'friendly';
  return 'neutral';
}
export const REL_LABELS = { war: 'En guerre', ally: 'Allié', hostile: 'Hostile', rival: 'Rival', trade: 'Partenaire commercial', friendly: 'Amical', neutral: 'Neutre' };

// ---------------- création / participation ----------------
function coalitionName(sim, list) {
  const alive = list.filter((k) => sim.sides[k]);
  if (alive.length === 1) return sim.sides[alive[0]].name;
  const teams = new Set(alive.map((k) => sim.sides[k].team));
  if (teams.size === 1 && sim.teams[alive[0] !== undefined ? sim.sides[alive[0]].team : 0] && sim.teams.length < sim.sides.length) return sim.teams[sim.sides[alive[0]].team].name;
  return sim.sides[alive[0]].name + ' et alliés';
}

export function warLabel(sim, w) {
  return `${coalitionName(sim, w.a)} – ${coalitionName(sim, w.b)}`;
}

const ORD = ['', 'Deuxième ', 'Troisième ', 'Quatrième ', 'Cinquième ', 'Sixième '];
export function startWar(sim, a, b, cause = 'declaration', silent = false) {
  if (sim.rules && sim.rules.wars === false) return null;
  a = a.filter((k) => !sim.sides[k].eliminated);
  b = b.filter((k) => !sim.sides[k].eliminated);
  if (!a.length || !b.length) return null;
  const S = sim.S;
  const w = {
    id: ++sim._warId, a: [...a], b: [...b], start: sim.time, end: null, status: 'active', cause,
    prewar: {}, prewarTotal: { a: 0, b: 0 }, changes: new Map(), timeline: [], moments: [], battles: [], joiners: [],
    winner: null, endReason: null, treaty: null, report: null, lastTimeline: -99, initialUnits: {},
  };
  w.before = {};
  for (const k of [...a, ...b]) {
    w.prewar[k] = sim.sides[k].cells;
    w.initialUnits[k] = sim.sides[k].units;
    w.before[k] = statSnap(sim, k);
  }
  for (const k of a) w.prewarTotal.a += sim.sides[k].cells;
  for (const k of b) w.prewarTotal.b += sim.sides[k].cells;
  const base = `Guerre ${coalitionName(sim, a)} – ${coalitionName(sim, b)}`;
  const same = sim.wars.filter((x) => x.baseName === base).length;
  w.baseName = base;
  w.name = (ORD[Math.min(same, ORD.length - 1)] + base.charAt(0).toLowerCase() + base.slice(1)).replace(/^./, (c) => c.toUpperCase());
  if (same > 0 && !ORD[same]) w.name = `${base} (${same + 1})`;
  sim.wars.push(w);
  const relOn = !sim.rules || sim.rules.relations !== false;
  for (const x of a) for (const y of b) { sim.atWar[x * S + y]++; sim.atWar[y * S + x]++; if (relOn) { sim.rel[x * S + y] = Math.min(sim.rel[x * S + y], -60); sim.rel[y * S + x] = Math.min(sim.rel[y * S + x], -60); } }
  const txt = cause === 'initial' ? `${w.name} : le conflit commence.` : `${sim.sides[a[0]].name} déclare la guerre à ${sim.sides[b[0]].name}.`;
  w.moments.push({ t: sim.time, type: 'start', text: cause === 'initial' ? 'Début du conflit.' : `Déclaration de guerre de ${sim.sides[a[0]].name}.` });
  sim.chron('war', txt, { war: w.id, e: [...a, ...b].map((k) => sim.sides[k].e) });
  for (const k of [...a, ...b]) sim.hist(k, 'war', `Entrée en guerre : ${w.name}.`);
  if (!silent) sim._emit({ icon: '⚔️', title: 'DÉCLARATION DE GUERRE', tone: 'bad', side: a[0], text: txt, war: w.id, cell: sim.sides[b[0]].capital });
  recordTimeline(sim, w, true);
  sim.markDirty([...a, ...b]);
  initWarGoals(sim, w);                 // objectifs de guerre de chaque camp
  onWarStarted(sim, w);                 // coalitions : défense mutuelle, ralliement autour de la victime
  return w;
}

// un pays rejoint une guerre existante (alliance)
export function joinWar(sim, w, s, side) {
  if (w.status !== 'active' || w.a.includes(s) || w.b.includes(s) || sim.sides[s].eliminated) return false;
  if (sim.rules && sim.rules.alliances === false) return false;   // sans alliances : personne ne rejoint une guerre
  const S = sim.S;
  const mine = side === 'a' ? w.a : w.b, other = side === 'a' ? w.b : w.a;
  mine.push(s);
  w.prewar[s] = sim.sides[s].cells;
  w.initialUnits[s] = sim.sides[s].units;
  (w.before || (w.before = {}))[s] = statSnap(sim, s);
  w.prewarTotal[side] += sim.sides[s].cells;
  w.joiners.push({ side: s, t: sim.time, coalition: side });
  for (const y of other) { sim.atWar[s * S + y]++; sim.atWar[y * S + s]++; addRel(sim, s, y, -35); }
  const ally = sim.sides[mine[0]].name;
  w.moments.push({ t: sim.time, type: 'join', text: `${sim.sides[s].name} rejoint le conflit aux côtés de ${ally}.` });
  sim.chron('alliance', `${sim.sides[s].name} entre en guerre aux côtés de ${ally} (${w.name}).`, { war: w.id, e: [sim.sides[s].e] });
  sim.hist(s, 'war', `Entrée en guerre aux côtés de ${ally} : ${w.name}.`);
  sim._emit({ icon: '🤝', title: 'ENTRÉE EN GUERRE', tone: 'neutral', side: s, text: `${sim.sides[s].name} rejoint la guerre aux côtés de ${ally}.`, war: w.id });
  sim.markDirty([s, ...other]);
  return true;
}

// enregistre le propriétaire d'avant-guerre d'une parcelle qui change de mains (pour chaque guerre concernée)
export function noteChange(sim, i, oldE, newE) {
  const so = sim.sideOf[oldE], sn = sim.sideOf[newE];
  const idx = sim.warsBySide;
  if (!idx) return;
  // seules les parcelles qui passent d'un camp à l'autre de la guerre (ou d'une zone grise à un camp) comptent
  if (sn >= 0) for (const w of idx[sn]) {
    if (w.changes.has(i)) continue;
    const inA = w.a.includes(sn);
    if (so < 0 || (inA ? w.b.includes(so) : w.a.includes(so))) w.changes.set(i, oldE);
  }
  else if (so >= 0) for (const w of idx[so]) if (!w.changes.has(i) && w.changes.size) { /* parcelle abandonnée à un tiers : ignorée */ }
}

export function recordTimeline(sim, w, force = false) {
  if (!force && sim.time - w.lastTimeline < 3) return;
  w.lastTimeline = sim.time;
  const members = [...w.a, ...w.b];
  w.timeline.push({ t: Math.round(sim.time * 10) / 10, m: members.slice(), c: members.map((k) => sim.sides[k].cells), u: members.map((k) => Math.round(sim.sides[k].units)) });
  if (w.timeline.length > 320) w.timeline = w.timeline.filter((_, k) => k % 2 === 0 || k === w.timeline.length - 1);
}

// ---------------- contrôle des conditions de fin ----------------
function heldShares(sim, w) {
  const aSet = new Set(w.a), bSet = new Set(w.b);
  let heldByA = 0, heldByB = 0;
  for (const [c, pre] of w.changes) {
    const ps = sim.sideOf[pre], cs = sim.sideOf[sim.owner[c]];
    if (ps < 0 || cs < 0) continue;
    if (bSet.has(ps) && aSet.has(cs)) heldByA++;
    else if (aSet.has(ps) && bSet.has(cs)) heldByB++;
  }
  return { heldByA, heldByB, shareA: heldByA / Math.max(1, w.prewarTotal.b), shareB: heldByB / Math.max(1, w.prewarTotal.a) };
}

// Victoire territoriale complète : vérification exacte sur la géométrie (chaque parcelle)
export function completeConquest(sim, w, winnerSide) {
  const L = new Set(winnerSide === 'a' ? w.b : w.a), Wn = new Set(winnerSide === 'a' ? w.a : w.b);
  let prewarL = 0, heldByW = 0;
  for (let i = 0; i < sim.n; i++) {
    const cur = sim.sideOf[sim.owner[i]];
    if (cur >= 0 && L.has(cur)) return false;          // il reste au moins une parcelle au perdant
    const pre = w.changes.has(i) ? sim.sideOf[w.changes.get(i)] : cur;
    if (pre >= 0 && L.has(pre)) { prewarL++; if (cur >= 0 && Wn.has(cur)) heldByW++; }
  }
  return prewarL > 0 && heldByW === prewarL;
}

function coalitionCrisis(sim, list) {
  const alive = list.filter((k) => !sim.sides[k].eliminated);
  if (!alive.length) return true;
  const lead = alive.reduce((m, k) => (sim.sides[k].initial > sim.sides[m].initial ? k : m), alive[0]);
  const sd = sim.sides[lead];
  return sd.crisis && sd.readiness < 0.5 && (sd.crisisMonths || 0) >= 3;
}

const capitulates = capitulatesHard;

export function checkWars(sim) {
  const cond = sim.cfg.warEnd || DEFAULT_WAR_END;
  for (const w of sim.activeWars.slice()) {
    if (w.status === 'negotiating') { if (sim.time >= w.negotiateUntil) concludeTreaty(sim, w); continue; }
    recordTimeline(sim, w);
    const A = w.a.filter((k) => !sim.sides[k].eliminated), B = w.b.filter((k) => !sim.sides[k].eliminated);
    if (!A.length || !B.length) {
      const win = A.length ? 'a' : B.length ? 'b' : null;
      endWar(sim, w, win, win && (cond.territorial === 'complete' || cond.percent >= 1) && completeConquest(sim, w, win) ? 'complete' : 'elimination');
      continue;
    }
    const h = heldShares(sim, w);
    w.shareA = h.shareA; w.shareB = h.shareB;
    const bCells = B.reduce((s, k) => s + sim.sides[k].cells, 0), aCells = A.reduce((s, k) => s + sim.sides[k].cells, 0);
    // PAIX AUTOMATIQUE OFF (mode Nation par défaut) : aucune fin imposée par la perte de territoire ;
    // les conditions remplies deviennent des événements et des propositions (warEnd.js)
    if (cond.autoPeace === false) {
      if (bCells === 0 && completeConquest(sim, w, 'a')) { endWar(sim, w, 'a', 'complete'); continue; }
      if (aCells === 0 && completeConquest(sim, w, 'b')) { endWar(sim, w, 'b', 'complete'); continue; }
      manualWarEndCheck(sim, w, cond, { A, B, h, endWar });
      continue;
    }
    if (cond.maxYears > 0 && sim.time - w.start >= cond.maxYears * YEAR_SEC_W) {
      w.terms = { war: w.id, proposer: A[0], kind: 'ceasefire', territory: 'keep', reparations: 0, payer: -1, truceYears: 3 };
      endWar(sim, w, Math.abs(h.shareA - h.shareB) > 0.1 ? (h.shareA > h.shareB ? 'a' : 'b') : null, 'duration'); continue;
    }
    if (cond.territorial === 'complete') {
      if (bCells === 0 && completeConquest(sim, w, 'a')) { endWar(sim, w, 'a', 'complete'); continue; }
      if (aCells === 0 && completeConquest(sim, w, 'b')) { endWar(sim, w, 'b', 'complete'); continue; }
    } else if (cond.territorial === 'percent') {
      const p = clamp(cond.percent || 0.65, 0.05, 1);
      if (p >= 1) {
        if (bCells === 0 && completeConquest(sim, w, 'a')) { endWar(sim, w, 'a', 'complete'); continue; }
        if (aCells === 0 && completeConquest(sim, w, 'b')) { endWar(sim, w, 'b', 'complete'); continue; }
      } else {
        if (h.shareA >= p && h.shareA > h.shareB) { endWar(sim, w, 'a', 'percent'); continue; }
        if (h.shareB >= p && h.shareB > h.shareA) { endWar(sim, w, 'b', 'percent'); continue; }
      }
    }
    if (sim.time - w.start > 20) {
      if (cond.capitulation) {
        if (capitulates(sim, w, B, h.shareA) && h.shareA > h.shareB) { endWar(sim, w, 'a', 'capitulation'); continue; }
        if (capitulates(sim, w, A, h.shareB) && h.shareB > h.shareA) { endWar(sim, w, 'b', 'capitulation'); continue; }
      }
      if (cond.economic) {
        if (coalitionCrisis(sim, B) && !coalitionCrisis(sim, A) && h.shareA >= h.shareB) { endWar(sim, w, 'a', 'economic'); continue; }
        if (coalitionCrisis(sim, A) && !coalitionCrisis(sim, B) && h.shareB >= h.shareA) { endWar(sim, w, 'b', 'economic'); continue; }
      }
    }
  }
}

// ---------------- fin de guerre : négociation ----------------
bindEndWar((sim, w, winner, reason) => endWar(sim, w, winner, reason));
bindSeparatePeace((sim, w, k) => separatePeaceWith(sim, w, k));
export function endWar(sim, w, winner, reason) {
  if (w.status !== 'active') return;
  const S = sim.S;
  w.status = 'negotiating';
  w.winner = winner;
  w.endReason = reason;
  w.negotiateUntil = sim.time + (reason === 'armistice' || reason === 'manual' ? 0 : 4);
  for (const x of w.a) for (const y of w.b) { sim.atWar[x * S + y] = Math.max(0, sim.atWar[x * S + y] - 1); sim.atWar[y * S + x] = Math.max(0, sim.atWar[y * S + x] - 1); }
  const wn = winner ? coalitionName(sim, winner === 'a' ? w.a : w.b) : null;
  const txt = winner ? `${END_REASONS[reason]} : ${wn} l'emporte. Ouverture des négociations de paix.` : `${END_REASONS[reason]}. Ouverture des négociations.`;
  w.moments.push({ t: sim.time, type: 'victory', text: txt });
  sim._emit({ icon: '🕊️', title: 'NÉGOCIATIONS DE PAIX', tone: 'neutral', side: winner ? (winner === 'a' ? w.a[0] : w.b[0]) : w.a[0], text: `${w.name} — ${txt}`, war: w.id });
  sim.markDirty([...w.a, ...w.b]);
  if (w.negotiateUntil <= sim.time) concludeTreaty(sim, w);
}

// ---------------- traité de paix ----------------
function mainComponent(sim, s) {
  // composante principale d'un pays (celle de la capitale, sinon la plus grande connue)
  const sd = sim.sides[s];
  const g = sim.grid;
  const mark = sim._compMark || (sim._compMark = new Int32Array(sim.n));
  const stamp = sim._compStamp = (sim._compStamp || 0) + 1;
  let start = sd.capital >= 0 && sim.owner[sd.capital] === sd.e ? sd.capital : -1;
  if (start < 0) for (let i = 0; i < sim.n; i++) if (sim.owner[i] === sd.e) { start = i; break; }
  if (start < 0) return { mark, stamp, size: 0 };
  const st = [start]; mark[start] = stamp; let size = 0;
  while (st.length) {
    const a = st.pop(); size++;
    for (let k = g.nbrStart[a]; k < g.nbrStart[a + 1]; k++) { const b = g.nbr[k]; if (mark[b] !== stamp && sim.owner[b] === sd.e) { mark[b] = stamp; st.push(b); } }
  }
  return { mark, stamp, size };
}

function componentOf(sim, start, e, seen) {
  const g = sim.grid;
  const comp = [start]; seen.add(start);
  for (let q = 0; q < comp.length; q++) {
    const a = comp[q];
    for (let k = g.nbrStart[a]; k < g.nbrStart[a + 1]; k++) { const b = g.nbr[k]; if (!seen.has(b) && sim.owner[b] === e) { seen.add(b); comp.push(b); } }
    if (comp.length > 4000) break;
  }
  return comp;
}

export function concludeTreaty(sim, w) {
  if (w.status === 'ended') return;
  const members = [...w.a, ...w.b];
  const aSet = new Set(w.a), bSet = new Set(w.b);
  const winSet = w.winner === 'a' ? aSet : w.winner === 'b' ? bSet : null;
  const loseSet = w.winner === 'a' ? bSet : w.winner === 'b' ? aSet : null;
  const alive = (s) => s >= 0 && !sim.sides[s].eliminated && sim.sides[s].cells > 0;
  const returned = [];   // [cell, newOwnerEntity]
  // 1) règles du traité (ou conditions négociées : lignes actuelles / frontières d'avant-guerre)
  const terms = w.terms || null;
  // conditions « régions choisies » : annexions précises, le reste est rendu
  const custom = terms && terms.territory === 'custom' ? claimTransfers(sim, w, terms) : null;
  if (custom) { for (const [c] of custom) if (!w.changes.has(c)) w.changes.set(c, sim.owner[c]); returned.push(...custom); }   // annexions comptées dans le bilan de la guerre
  for (const [c, pre] of custom ? [] : w.changes) {
    const cur = sim.sideOf[sim.owner[c]];
    const ps = sim.sideOf[pre];
    if (cur < 0 || !members.includes(cur)) continue;
    if (sim.owner[c] === pre) continue;
    if (terms) {
      if (terms.territory === 'restore' && ps >= 0 && members.includes(ps) && alive(ps)) returned.push([c, pre]);
      continue;
    }
    if (winSet) {
      if (loseSet.has(cur) && ps >= 0 && winSet.has(ps)) returned.push([c, pre]);            // le perdant rend
      else if (winSet.has(cur) && ps >= 0 && winSet.has(ps) && ps !== cur && alive(ps)) returned.push([c, pre]); // entre alliés
    }
  }
  const retCount = returned.length;
  for (const [c, e] of returned) sim.flip(c, e, false);
  // 2) poches isolées : rendues à leur propriétaire d'avant-guerre (s'il existe encore)
  const pockets = [];
  for (const s of members) {
    if (!alive(s)) continue;
    const sd = sim.sides[s];
    const main = mainComponent(sim, s);
    const seen = new Set();
    for (const [c, pre] of w.changes) {
      if (sim.owner[c] !== sd.e || main.mark[c] === main.stamp || seen.has(c)) continue;
      if (custom && custom.claimed.has(c)) continue;      // une région annexée par traité n'est jamais rendue
      const comp = componentOf(sim, c, sd.e, seen);
      const small = comp.length <= Math.max(30, sd.cells * 0.04);
      if (!small) continue;
      // propriétaire d'avant-guerre majoritaire de la poche
      const votes = new Map();
      for (const x of comp) { const p0 = w.changes.has(x) ? w.changes.get(x) : sd.e; votes.set(p0, (votes.get(p0) || 0) + 1); }
      let best = sd.e, bv = -1;
      for (const [k, v] of votes) if (v > bv) { bv = v; best = k; }
      if (best === sd.e || !alive(sim.sideOf[best])) continue;
      for (const x of comp) pockets.push([x, best]);
    }
  }
  for (const [c, e] of pockets) sim.flip(c, e, false);
  // 3) tout devient officiel pour les participants
  for (const [c] of w.changes) {
    if (sim.occupied[c]) {
      const s = sim.sideOf[sim.owner[c]];
      if (s >= 0 && members.includes(s)) {
        sim.occupied[c] = 0;
        sim.sides[s].occupiedCells--;
        sim.captures.push({ i: c, by: sim.owner[c], from: sim.owner[c], t: sim.time, official: true });
      }
    }
  }
  // 4) BORDER CLEANUP
  // 4) RÉORGANISATION TERRITORIALE (anti-enclave, frontière naturelle, lissage)
  const region = new Set();
  for (const [c] of w.changes) region.add(c);
  for (let ring = 0; ring < 3; ring++) {
    const add = [];
    for (const c of region) for (let k = sim.grid.nbrStart[c]; k < sim.grid.nbrStart[c + 1]; k++) add.push(sim.grid.nbr[k]);
    for (const c of add) region.add(c);
  }
  // régions annexées par traité : territoire voulu, conservé même séparé du reste du pays (exclave)
  if (custom && custom.claimed.size) { if (!(sim.intentional instanceof Map)) sim.intentional = new Map(); for (const c of custom.claimed) sim.intentional.set(c, sim.owner[c]); }
  const cleanup = reorganize(sim, region, new Set(members.map((k) => sim.sides[k].e)), w.changes);
  // 5) bilan
  const geo = sim.geo;
  const trans = new Map();
  const diffCells = [], diffBefore = [], diffAfter = [];
  for (const [c, pre] of w.changes) {
    const now = sim.owner[c];
    if (now === pre) continue;
    diffCells.push(c); diffBefore.push(pre); diffAfter.push(now);
    const key = pre + '>' + now;
    const t = trans.get(key) || { from: pre, to: now, cells: 0, km2: 0 };
    t.cells++; t.km2 += geo ? geo.km2[c] : 770;
    trans.set(key, t);
  }
  w.diff = { cells: diffCells, before: diffBefore, after: diffAfter };
  const transfers = [...trans.values()].sort((x, y) => y.cells - x.cells);
  const ents = sim.entities;
  w.treaty = {
    t: sim.time,
    winner: winSet ? [...winSet].map((k) => sim.sides[k].e) : [],
    loser: loseSet ? [...loseSet].map((k) => sim.sides[k].e) : [],
    reason: w.endReason,
    transfers: transfers.slice(0, 30).map((t) => ({ from: t.from, to: t.to, fromName: ents[t.from] ? ents[t.from].name : 'Zone neutre', toName: ents[t.to] ? ents[t.to].name : 'Zone neutre', cells: t.cells, km2: Math.round(t.km2) })),
    returned: retCount + pockets.length,
    cleanup,
    duration: sim.time - w.start,
  };
  w.status = 'ended';
  w.end = sim.time;
  // 6) relations, trêve, mémoire des IA
  const shareA = w.shareA || 0, shareB = w.shareB || 0;
  const S = sim.S;
  const dur = (sim.time - w.start) / 120;
  for (const x of w.a) for (const y of w.b) {
    const xLost = w.winner === 'b', yLost = w.winner === 'a';
    const lost = Math.max(shareA, shareB);
    sim.rel[x * S + y] = clamp(sim.rel[x * S + y] * 0.4 - 30 - (xLost ? 30 * lost + 10 : 0) + 6 * Math.min(1, dur), -100, 60);
    sim.rel[y * S + x] = clamp(sim.rel[y * S + x] * 0.4 - 30 - (yLost ? 30 * lost + 10 : 0) + 6 * Math.min(1, dur), -100, 60);
    const tr = sim.time + 120 + 180 * lost;
    sim.truce[x * S + y] = Math.max(sim.truce[x * S + y], tr); sim.truce[y * S + x] = Math.max(sim.truce[y * S + x], tr);
  }
  if (sim.rules && sim.rules.relations === false) for (const x of w.a) for (const y of w.b) { sim.rel[x * S + y] = 0; sim.rel[y * S + x] = 0; }
  else for (const L of [w.a, w.b]) for (const x of L) for (const y of L) if (x !== y) sim.rel[x * S + y] = clamp(sim.rel[x * S + y] + 12, -100, 100);
  w.treaty.terms = settleTerms(sim, w);
  for (const x of w.a) for (const y of w.b) dnote(sim, x, y, 'treaty', `Traité de paix (${w.name})`);
  const winners = winSet ? [...winSet] : [], losers = loseSet ? [...loseSet] : [];
  for (const s of members) {
    const sd = sim.sides[s];
    if (sd.eliminated) continue;
    const pre = w.prewar[s] || 1;
    const delta = (sd.cells - pre) / pre;
    const ai = sd.ai;
    if (ai) {
      const enemies = (aSet.has(s) ? w.b : w.a);
      if (winners.includes(s) || delta > 0.05) ai.memory.push({ type: 'wonWar', target: enemies[0], strength: 1 + delta * 3, t: sim.time, text: `Victoire dans ${w.name}` });
      else if (losers.includes(s) || delta < -0.05) {
        ai.memory.push({ type: 'lostWar', target: enemies[0], strength: 1 + Math.abs(delta) * 4, t: sim.time, text: `Défaite dans ${w.name}` });
        if (delta < -0.08) ai.memory.push({ type: 'claim', target: enemies[0], strength: Math.abs(delta) * 5, t: sim.time, text: `Revendique les territoires perdus face à ${sim.sides[enemies[0]].name}` });
      }
      ai.postWar = { t: sim.time, delta, won: winners.includes(s) };
      ai.nextStrat = Math.min(ai.nextStrat || 0, sim.time + 0.5);
    }
    sd.morale = clamp(sd.morale + (delta > 0 ? 0.12 : -0.1), 0.25, 1.25);
    sd.exhaustion *= 0.5;
    const res = winners.includes(s) ? 'victoire' : losers.includes(s) ? 'défaite' : 'paix de compromis';
    sim.hist(s, 'treaty', `Traité de paix (${w.name}) : ${res}, territoire ${delta >= 0 ? '+' : ''}${(delta * 100).toFixed(1).replace('.', ',')} %.`);
  }
  // 7) rapport complet
  w.report = buildReport(sim, w);
  const tx = w.treaty.transfers.filter((t) => t.cells > 0).slice(0, 3).map((t) => `${t.fromName} → ${t.toName} (${Math.round(t.km2).toLocaleString('fr-FR')} km²)`).join(', ');
  sim.chron('treaty', `Traité de paix : fin de ${w.name.charAt(0).toLowerCase() + w.name.slice(1)} après ${fmtDuration(w.end - w.start)}.${tx ? ' Transferts : ' + tx + '.' : ' Frontières inchangées.'}`, { war: w.id, e: members.map((k) => sim.sides[k].e) });
  const totalKm2 = transfers.reduce((s, t) => s + t.km2, 0);
  if (totalKm2 > 60000) sim.chron('border', `Changement majeur de frontières : ${Math.round(totalKm2).toLocaleString('fr-FR')} km² changent de souveraineté.`, { war: w.id, cell: diffCells[(diffCells.length / 2) | 0] });
  w.moments.push({ t: sim.time, type: 'treaty', text: `Traité de paix signé. Réorganisation territoriale : ${cleanup.enclaves + cleanup.exclaves + cleanup.islands + cleanup.holes} fragment(s) rattaché(s), ${cleanup.relaxed + cleanup.smoothed} parcelle(s) de frontière redessinée(s).` });
  recordTimeline(sim, w, true);
  sim.markDirty(members);
  sim.endedWars.push(w.id);
  sim._emit({ icon: '📜', title: 'TRAITÉ DE PAIX', tone: 'good', side: winners[0] !== undefined ? winners[0] : w.a[0], text: `${w.name} : traité signé.`, war: w.id, warEnded: true });
}

// ---------------- BORDER CLEANUP ----------------
// ancienne frontière -> analyse -> détection des anomalies (enclaves, fragments, zigzags) -> correction
// minimale. Les conquêtes réelles sont conservées : seules les anomalies géographiques sont corrigées,
// et une frontière posée sur une rivière ou une crête est « collante » (naturelle, donc conservée).
export function borderCleanup(sim, w, members) {
  const g = sim.grid;
  const geo = sim.geo;
  const memberE = new Set(members.map((k) => sim.sides[k].e));
  // zone d'étude : parcelles modifiées pendant la guerre + 2 anneaux
  const region = new Set();
  for (const [c] of w.changes) region.add(c);
  for (let ring = 0; ring < 2; ring++) {
    const add = [];
    for (const c of region) for (let k = g.nbrStart[c]; k < g.nbrStart[c + 1]; k++) add.push(g.nbr[k]);
    for (const c of add) region.add(c);
  }
  const capitals = new Set(sim.sides.map((s) => s.capital).filter((c) => c >= 0));
  let enclaves = 0, smoothed = 0, cellsMoved = 0;
  const moveTo = (c, e) => { sim.flip(c, e, false); cellsMoved++; };
  const enclavePass = () => {
    const seen = new Set();
    const mains = new Map();
    for (const c of region) {
      const e = sim.owner[c];
      if (!memberE.has(e) || seen.has(c)) continue;
      const s = sim.sideOf[e];
      if (!mains.has(s)) mains.set(s, mainComponent(sim, s));
      const mc = mains.get(s);
      if (mc.mark[c] === mc.stamp) { seen.add(c); continue; }
      const comp = componentOf(sim, c, e, seen);
      if (comp.some((x) => capitals.has(x))) continue;
      const sd = sim.sides[s];
      let coast = 0;
      const around = new Map();
      for (const x of comp) {
        if (g.coastal[x]) coast++;
        for (let k = g.nbrStart[x]; k < g.nbrStart[x + 1]; k++) {
          const y = g.nbr[k]; const o = sim.owner[y];
          if (o !== e) around.set(o, (around.get(o) || 0) + 1);
        }
      }
      // exclave côtière de taille respectable : conservée (accès à la mer)
      const limit = Math.max(14, Math.min(60, sd.cells * 0.02));
      if (comp.length > limit || (coast >= 3 && comp.length > 24)) continue;
      let best = -1, bv = -1;
      for (const [o, v] of around) if (memberE.has(o) && v > bv) { bv = v; best = o; }
      if (best < 0) continue;
      for (const x of comp) moveTo(x, best);
      enclaves++;
      mains.delete(sim.sideOf[best]);
    }
  };
  enclavePass();
  // zigzags et excroissances d'une parcelle : lissage majoritaire limité aux frontières entre participants
  for (let pass = 0; pass < 3; pass++) {
    const flips = [];
    for (const c of region) {
      const e = sim.owner[c];
      if (!memberE.has(e) || capitals.has(c) || c >= g.nGrid) continue;
      const counts = new Map();
      let same = 0, tot = 0;
      for (let k = g.nbrStart[c]; k < g.nbrStart[c + 1]; k++) {
        const o = sim.owner[g.nbr[k]];
        tot++;
        if (o === e) same++; else counts.set(o, (counts.get(o) || 0) + 1);
      }
      if (tot < 6) continue;
      let best = -1, bv = 0;
      for (const [o, v] of counts) if (memberE.has(o) && v > bv) { bv = v; best = o; }
      if (best < 0) continue;
      const sticky = geo && (geo.river[c] >= 2 || geo.ridge[c]) ? 1 : 0;   // frontière naturelle : conservée
      if (bv >= 6 + sticky && same <= 2 - sticky) flips.push([c, best]);
    }
    if (!flips.length) break;
    for (const [c, e] of flips) { moveTo(c, e); smoothed++; }
  }
  enclavePass();
  return { enclaves, smoothed, cells: cellsMoved, region: region.size };
}

// ---------------- batailles ----------------
export function updateBattles(sim) {
  const S = sim.S;
  const active = new Set();
  for (const w of sim.activeWars) {
    if (w.status !== 'active') continue;
    for (const x of w.a) for (const y of w.b) {
      const sx = sim.sides[x], sy = sim.sides[y];
      if (!sx.sectors || !sy.sectors) continue;
      for (const sec of sx.sectors) {
        if (sec.o !== y) continue;
        const f1 = sx.front[sec.key];
        const f2 = sy.front[secKey(x, sec.bin)];
        const att = (f1 ? f1.att : 0) + (f2 ? f2.att : 0);
        const size = sec.cells.length + (f2 ? f2.cells : 0);
        const key = `${w.id}:${Math.min(x, y)}-${Math.max(x, y)}-${sec.bin}`;
        const thr = Math.max(1.4, size * 0.16);
        let b = sim.battles[key];
        if (att >= thr) {
          active.add(key);
          if (!b) {
            b = sim.battles[key] = { key, war: w.id, x, y, bin: sec.bin, t0: sim.time, t1: sim.time, cell: f1 ? f1.cell : sec.cells[0], quiet: 0,
              g0x: f1 ? f1.cumGain || 0 : 0, g0y: f2 ? f2.cumGain || 0 : 0, l0x: f1 ? f1.lossU || 0 : 0, l0y: f2 ? f2.lossU || 0 : 0,
              attX: 0, attY: 0, units: 0, name: f1 ? f1.name : 'Front', ownerFrontName: f1 ? f1.name : '' };
          }
          b.quiet = 0; b.t1 = sim.time;
          b.attX += (f1 ? f1.att : 0); b.attY += (f2 ? f2.att : 0);
          b.units = Math.max(b.units, (f1 ? f1.force || 0 : 0) + (f2 ? f2.force || 0 : 0));
          b.gx = (f1 ? f1.cumGain || 0 : 0) - b.g0x; b.gy = (f2 ? f2.cumGain || 0 : 0) - b.g0y;
          b.lx = (f1 ? f1.lossU || 0 : 0) - b.l0x; b.ly = (f2 ? f2.lossU || 0 : 0) - b.l0y;
          if (f1 && f1.cell >= 0) b.cell = f1.cell;
          if (sim.time - b.t0 > 20) finishBattle(sim, w, b);
        }
      }
    }
  }
  for (const key of Object.keys(sim.battles)) {
    if (active.has(key)) continue;
    const b = sim.battles[key];
    if (++b.quiet >= 2) {
      const w = sim.wars.find((x) => x.id === b.war);
      finishBattle(sim, w, b);
    }
  }
  void S;
}

function finishBattle(sim, w, b) {
  delete sim.battles[b.key];
  if (!w) return;
  const dur = b.t1 - b.t0;
  const gx = b.gx || 0, gy = b.gy || 0;
  if (dur < 3 || gx + gy < 5) return;
  const attacker = b.attX >= b.attY ? b.x : b.y, defender = attacker === b.x ? b.y : b.x;
  const ga = attacker === b.x ? gx : gy, gd = attacker === b.x ? gy : gx;
  const net = ga - gd;
  const A = sim.sides[attacker], D = sim.sides[defender];
  const result = net >= 6 ? `Victoire ${de(A.name)}` : net <= -3 ? `Victoire défensive ${de(D.name)}` : 'Issue indécise';
  const km2 = (c) => Math.round(c * (sim.geo ? 770 * Math.max(0.2, sim.grid.area[b.cell] || 1) : 770));
  // nom : front vu depuis le défenseur + capitale proche
  const g = sim.grid;
  const dc = D.capital >= 0 ? D.capital : b.cell;
  const dir = direction(g.xyz[dc * 3], g.xyz[dc * 3 + 1], g.xyz[dc * 3 + 2], g.xyz[b.cell * 3], g.xyz[b.cell * 3 + 1], g.xyz[b.cell * 3 + 2]);
  let near = '';
  let bd = 240;
  for (const s of sim.sides) {
    const e = sim.entities[s.e];
    if (!e || !e.capital || s.capital < 0) continue;
    const d = Math.acos(clamp(g.xyz[b.cell * 3] * g.xyz[s.capital * 3] + g.xyz[b.cell * 3 + 1] * g.xyz[s.capital * 3 + 1] + g.xyz[b.cell * 3 + 2] * g.xyz[s.capital * 3 + 2], -1, 1)) * 6371;
    if (d < bd) { bd = d; near = e.capital.name; }
  }
  const idx = w.battles.length + 1;
  const base = near ? `bataille ${de(near)}` : `bataille du front ${dir} (${D.name})`;
  const same = w.battles.filter((x) => x.baseName === base).length;
  const nm = ordinalF(same) + base;
  const battle = {
    id: `${w.id}-${idx}`, baseName: base, name: nm.charAt(0).toUpperCase() + nm.slice(1),
    t0: b.t0, t1: b.t1, cell: b.cell, attacker: A.e, defender: D.e, attackerName: A.name, defenderName: D.name,
    result, gained: ga, lost: gd, km2Gained: km2(ga), km2Lost: km2(gd),
    soldiers: Math.round(b.units * 1000), losses: [Math.round((attacker === b.x ? b.lx : b.ly) * 1000), Math.round((attacker === b.x ? b.ly : b.lx) * 1000)],
    region: `Front ${dir} ${de(D.name)}`,
  };
  w.battles.push(battle);
  if (w.battles.length > 80) { w.battles.sort((p, q) => (q.gained + q.lost) - (p.gained + p.lost)); w.battles.length = 70; w.battles.sort((p, q) => p.t0 - q.t0); }
  // numérotation chronologique des batailles portant le même nom
  const same2 = w.battles.filter((x) => x.baseName === base).sort((p2, q2) => p2.t0 - q2.t0);
  same2.forEach((x, k) => {
    const nm2 = ordinalF(k) + x.baseName;
    const old = x.name;
    x.name = nm2.charAt(0).toUpperCase() + nm2.slice(1);
    if (old !== x.name) for (const mo of w.moments) if (mo.battle === x.id) mo.text = `${x.name} : ${x.result}.`;
  });
  const major = ga + gd >= 40 || battle.soldiers > 150000;
  if (major) {
    w.moments.push({ t: b.t0, type: 'battle', text: `${battle.name} : ${result}.`, cell: b.cell, battle: battle.id });
    sim.chron('battle', `${battle.name} (${w.name}) : ${result}.`, { war: w.id, cell: b.cell, e: [A.e, D.e] });
  }
  // la mémoire des IA retient les échecs offensifs et les zones difficiles
  const aiA = A.ai, aiD = D.ai;
  if (aiA && net <= 0 && b.attX + b.attY > 20) aiA.memory.push({ type: 'failedOffensive', key: secKey(defender, b.bin), target: defender, strength: 1.2, t: sim.time, text: `Échec offensif : ${battle.name}` });
  if (aiD && net >= 8) aiD.memory.push({ type: 'hardZone', key: secKey(attacker, b.bin), target: attacker, strength: 1 + net / 30, t: sim.time, text: `Zone difficile à défendre : ${battle.region}` });
}

// ---------------- statistiques avant / après guerre ----------------
// photographie d'un pays (comparaison AVANT GUERRE / APRÈS GUERRE) ; les pertes sont cumulées par pays
export function statSnap(sim, k) {
  const sd = sim.sides[k];
  const S = sim.S;
  let rel = 0, n = 0, allies = 0;
  for (let o = 0; o < S; o++) if (o !== k && !sim.sides[o].eliminated) { rel += sim.rel[k * S + o]; n++; if (sim.allied[k * S + o]) allies++; }
  const a = sd.army;
  return {
    t: Math.round(sim.time), pop: Math.round(sd.pop), cells: sd.cells, km2: Math.round(sd.km2 || 0),
    gdp: Math.round(sd.eco.gdp * 10) / 10, money: Math.round(sd.money * 10) / 10, debt: Math.round(sd.debt * 10) / 10, income: Math.round((sd.eco.income || 0) * 10) / 10,
    milBudget: Math.round((sd.milTarget || 0) * 100) / 100, personnel: Math.round((a.inf + a.arm + a.art + a.rec) * 1000),
    groups: (sd.agents || []).length, air: Math.round(sd.air * 10) / 10, navy: Math.round(sd.navy * 10) / 10, armor: Math.round(a.arm * 10) / 10,
    losses: sd.lossesTotal || 0, lossArm: sd.lossArm || 0, lossArt: sd.lossArt || 0, recruited: sd.recruited || 0,
    stability: Math.round(sd.stability * 100), relAvg: n ? Math.round(rel / n) : 0, allies,
  };
}

// ---------------- rapport de guerre ----------------
export function buildReport(sim, w) {
  const ents = sim.entities;
  const members = [...w.a, ...w.b];
  const geo = sim.geo;
  const km2Of = (c) => (geo ? geo.km2[c] : 770);
  const terr = {};
  for (const k of members) { const e = sim.sides[k].e; terr[e] = { e, name: sim.sides[k].name, coalition: w.a.includes(k) ? 'a' : 'b', initial: w.prewar[k] || 0, final: sim.sides[k].cells, gainedKm2: 0, lostKm2: 0, initialKm2: 0, finalKm2: 0 }; }
  for (const k of members) { const t = terr[sim.sides[k].e]; t.finalKm2 = sim.sides[k].km2; }
  const zones = new Map();
  const g = sim.grid;
  for (let k = 0; k < w.diff.cells.length; k++) {
    const c = w.diff.cells[k], pre = w.diff.before[k], now = w.diff.after[k];
    const a = km2Of(c);
    if (terr[now]) terr[now].gainedKm2 += a;
    if (terr[pre]) terr[pre].lostKm2 += a;
    // zones : direction depuis la capitale du perdant de la parcelle
    const ps = sim.sideOf[pre];
    const cap = ps >= 0 && sim.sides[ps].capital >= 0 ? sim.sides[ps].capital : c;
    const dir = direction(g.xyz[cap * 3], g.xyz[cap * 3 + 1], g.xyz[cap * 3 + 2], g.xyz[c * 3], g.xyz[c * 3 + 1], g.xyz[c * 3 + 2]);
    const key = `${pre}>${now}>${dir}`;
    const z = zones.get(key) || { from: pre, to: now, dir, km2: 0, cells: 0, x: 0, y: 0, z: 0, cell: c };
    z.km2 += a; z.cells++;
    z.x += g.xyz[c * 3]; z.y += g.xyz[c * 3 + 1]; z.z += g.xyz[c * 3 + 2];
    zones.set(key, z);
  }
  for (const t of Object.values(terr)) t.initialKm2 = t.finalKm2 - t.gainedKm2 + t.lostKm2;
  const zl = [...zones.values()].sort((p, q) => q.km2 - p.km2).slice(0, 8).map((z) => {
    // parcelle la plus proche du barycentre
    const l = Math.hypot(z.x, z.y, z.z) || 1;
    let best = z.cell, bd = -2;
    for (let k = 0; k < w.diff.cells.length && k < 20000; k++) {
      if (w.diff.before[k] !== z.from || w.diff.after[k] !== z.to) continue;
      const c = w.diff.cells[k];
      const d = (g.xyz[c * 3] * z.x + g.xyz[c * 3 + 1] * z.y + g.xyz[c * 3 + 2] * z.z) / l;
      if (d > bd) { bd = d; best = c; }
    }
    const from = ents[z.from] ? ents[z.from].name : 'zone neutre';
    const region = z.dir.charAt(0).toUpperCase() + z.dir.slice(1);
    // noms de régions personnalisés (identité du pays dans NATION SIMULATOR)
    const rn = ents[z.from] && ents[z.from].regionNames;
    let custom = rn && (rn[z.dir] || rn[z.dir.split('-')[0]]);
    // région réelle (admin-1) de la zone, si la carte détaillée est disponible
    if (!custom && sim.details) { const r = sim.details.regionOf[best]; const reg = r >= 0 ? sim.details.regions[r] : null; if (reg && reg.e === z.from) custom = reg.name; }
    return { name: custom || `${region} ${de(from)}`, from: z.from, to: z.to, fromName: from, toName: ents[z.to] ? ents[z.to].name : 'zone neutre', km2: Math.round(z.km2), cell: best };
  });
  const wn = w.winner ? (w.winner === 'a' ? w.a : w.b) : [];
  let result;
  if (w.winner) result = `${END_REASONS[w.endReason] || 'Victoire'} — ${coalitionName(sim, wn)}`;
  else result = END_REASONS[w.endReason] || 'Paix sans vainqueur';
  const units = {};
  for (const k of members) units[sim.sides[k].e] = { initial: Math.round((w.initialUnits[k] || 0) * 1000), final: Math.round(sim.sides[k].units * 1000) };
  // AVANT / APRÈS et pertes (forme statistique : effectifs, matériel agrégé, impact économique)
  const compare = {};
  for (const k of members) {
    const b = (w.before || {})[k];
    if (!b) continue;
    const af = statSnap(sim, k);
    const lost = Math.max(0, af.losses - b.losses) * 1000;
    compare[sim.sides[k].e] = {
      name: sim.sides[k].name, coalition: w.a.includes(k) ? 'a' : 'b', before: b, after: af,
      losses: {
        personnel: Math.round(lost),
        wounded: Math.round(lost * 2.4),          // estimation statistique (ratio blessés / pertes définitives)
        armor: Math.round(Math.max(0, af.lossArm - b.lossArm) * 10) / 10,
        artillery: Math.round(Math.max(0, af.lossArt - b.lossArt) * 10) / 10,
        air: Math.round(Math.max(0, b.air - af.air) * 10) / 10,
        navy: Math.round(Math.max(0, b.navy - af.navy) * 10) / 10,
        gdpPct: b.gdp > 0 ? Math.round((af.gdp / b.gdp - 1) * 1000) / 10 : 0,
        debt: Math.round((af.debt - b.debt) * 10) / 10,
        recruited: Math.round(Math.max(0, af.recruited - b.recruited) * 1000),
      },
    };
  }
  return {
    compare,
    name: w.name, result, winner: wn.map((k) => sim.sides[k].e), reason: w.endReason,
    a: w.a.map((k) => sim.sides[k].e), b: w.b.map((k) => sim.sides[k].e),
    start: w.start, end: w.end, duration: w.end - w.start,
    territories: Object.values(terr).map((t) => ({ ...t, initialKm2: Math.round(t.initialKm2), finalKm2: Math.round(t.finalKm2), gainedKm2: Math.round(t.gainedKm2), lostKm2: Math.round(t.lostKm2) })),
    zones: zl, units,
    major: zl.slice(0, 3).map((z) => z.name),
  };
}

// ---------------- sérialisation ----------------
function b64i32(arr) {
  const u8 = new Uint8Array(Int32Array.from(arr).buffer);
  let s = '';
  for (let k = 0; k < u8.length; k += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(k, k + 0x8000));
  return typeof btoa !== 'undefined' ? btoa(s) : Buffer.from(u8).toString('base64');
}
function unb64i32(str) {
  let u8;
  if (typeof atob !== 'undefined') { const s = atob(str); u8 = new Uint8Array(s.length); for (let k = 0; k < s.length; k++) u8[k] = s.charCodeAt(k); }
  else u8 = new Uint8Array(Buffer.from(str, 'base64'));
  return Array.from(new Int32Array(u8.buffer, 0, u8.byteLength >> 2));
}
export function serializeWar(w) {
  const { changes, diff, ...rest } = w;
  const ch = [];
  for (const [c, e] of changes) ch.push(c, e);
  return { ...JSON.parse(JSON.stringify(rest)), changesB64: b64i32(ch), diffB64: diff ? { cells: b64i32(diff.cells), before: b64i32(diff.before), after: b64i32(diff.after) } : null };
}
export function restoreWar(o) {
  const { changesB64, diffB64, ...rest } = o;
  const w = { ...rest, changes: new Map() };
  if (changesB64) { const a = unb64i32(changesB64); for (let k = 0; k < a.length; k += 2) w.changes.set(a[k], a[k + 1]); }
  w.diff = diffB64 ? { cells: unb64i32(diffB64.cells), before: unb64i32(diffB64.before), after: unb64i32(diffB64.after) } : null;
  return w;
}
// version compacte pour l'enregistrement dans le monde (pas de liste de changements en cours)
export function archiveWar(sim, w, startDay) {
  return {
    id: w.id, name: w.name, start: w.start, end: w.end, startDay, report: w.report, treaty: w.treaty,
    battles: w.battles, moments: w.moments, timeline: w.timeline.map((p) => ({ t: p.t, m: p.m.map((k) => sim.sides[k].e), c: p.c, u: p.u })),
    a: w.a.map((k) => sim.sides[k].e), b: w.b.map((k) => sim.sides[k].e), endReason: w.endReason,
    diff: w.diff ? { cells: b64i32(w.diff.cells), before: b64i32(w.diff.before), after: b64i32(w.diff.after) } : null,
  };
}
export function decodeDiff(d) { return d ? { cells: unb64i32(d.cells), before: unb64i32(d.before), after: unb64i32(d.after) } : null; }

export { geoFor };
