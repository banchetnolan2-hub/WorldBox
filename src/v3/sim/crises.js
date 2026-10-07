// CRISES INTERNATIONALES, CONFÉRENCES ET SANCTIONS
//  • Sanctions économiques : un pays coupe ses échanges avec un autre ; la cible perd une part de son PIB selon le
//    poids économique des pays qui la sanctionnent. Les coalitions sanctionnent leur cible, les IA sanctionnent
//    les agresseurs de leurs alliés ; levée après la paix ou le retour de bonnes relations.
//  • Crises internationales : une tension grave entre deux voisins (incident frontalier, différend territorial,
//    expulsion de diplomates…) ou un choc mondial (crise de l'énergie, crise alimentaire). Une crise bilatérale
//    passe par une phase de tension, puis une CONFÉRENCE INTERNATIONALE avec des médiateurs (grandes puissances
//    en bons termes avec les deux pays) : accord (trêve, relations rétablies), statu quo ou escalade (guerre).
//    Le joueur concerné choisit sa ligne (concessions, fermeté, médiation) ; ses choix ont des conséquences.
// Déterministe (générateur de la simulation) et sérialisé avec la partie.
import { MONTH_SEC, YEAR_SEC } from './calendar.js';
import { addRel, startWar } from './wars.js';
import { powerOf, aiLog } from './ai.js';
import { PERSONALITIES } from './profile.js';
import { activeCoalitions } from './coalitions.js';

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const alive = (sim, k) => k >= 0 && sim.sides[k] && !sim.sides[k].eliminated;
const isPlayer = (sim, k) => !!(sim.nation && sim.nation.isHuman(k));

// ======================= SANCTIONS =======================
export function sanctionsOf(sim) { return sim.sanctions || (sim.sanctions = []); }
export function isSanctioning(sim, a, b) { return sanctionsOf(sim).some((s) => s.by === a && s.on === b); }
export function sanctionedBetween(sim, a, b) { return sanctionsOf(sim).some((s) => (s.by === a && s.on === b) || (s.by === b && s.on === a)); }
export function sanctionsOn(sim, k) { return sanctionsOf(sim).filter((s) => s.on === k); }
export function sanction(sim, by, on, reason = '') {
  if (sim.rules.diplomacy === false || sim.rules.trade === false || by === on || !alive(sim, by) || !alive(sim, on) || isSanctioning(sim, by, on)) return false;
  sanctionsOf(sim).push({ by, on, t: sim.time, reason });
  addRel(sim, by, on, -15);
  const B = sim.sides[by], O = sim.sides[on];
  sim.chron('diplomacy', `${B.name} impose des sanctions économiques ${O.name ? 'à ' + O.name : ''}${reason ? ` (${reason})` : ''}.`, { e: [B.e, O.e] });
  sim._emit({ icon: '🚫', title: 'SANCTIONS', tone: 'bad', side: by, text: `${B.name} sanctionne ${O.name}${reason ? ` : ${reason}` : ''}.` });
  sim.hist(on, 'diplo', `Sanctions de ${B.name}.`);
  return true;
}
export function liftSanction(sim, by, on, why = '') {
  const L = sanctionsOf(sim), i = L.findIndex((s) => s.by === by && s.on === on);
  if (i < 0) return false;
  L.splice(i, 1);
  addRel(sim, by, on, 6);
  sim.chron('diplomacy', `${sim.sides[by].name} lève ses sanctions contre ${sim.sides[on].name}${why ? ` (${why})` : ''}.`, { e: [sim.sides[by].e, sim.sides[on].e] });
  sim._emit({ icon: '🤝', title: 'SANCTIONS LEVÉES', tone: 'good', side: by, text: `${sim.sides[by].name} lève ses sanctions contre ${sim.sides[on].name}.` });
  return true;
}
// part du PIB perdue par la cible (poids économique des pays qui la sanctionnent, ouverture commerciale)
export function sanctionDrag(sim, k) {
  const list = sanctionsOn(sim, k);
  if (!list.length) return 0;
  let world = 0; for (const s of sim.sides) if (!s.eliminated) world += s.eco.gdp;
  let w = 0; for (const s of list) if (alive(sim, s.by)) w += sim.sides[s.by].eco.gdp;
  const open = (sim.sides[k].p.trade || 50) / 100;
  return clamp(w / Math.max(1, world) * 0.12 * (0.5 + open), 0, 0.06) * (1 - (sim.sides[k].blockadeRes || 0) * 0.5);
}
function aiSanctions(sim) {
  const S = sim.S;
  // les coalitions sanctionnent leur cible
  for (const c of activeCoalitions(sim)) for (const m of c.members) {
    if (isPlayer(sim, m.k) || isSanctioning(sim, m.k, c.target)) continue;
    if (sim.rel[m.k * S + c.target] < -25 && sim.rng.next() < 0.35) sanction(sim, m.k, c.target, `membre de « ${c.name} »`);
  }
  // levée : guerre terminée depuis un an et relations redevenues correctes, ou coût trop élevé pour soi
  for (const s of sanctionsOf(sim).slice()) {
    if (isPlayer(sim, s.by)) continue;
    if (!alive(sim, s.by) || !alive(sim, s.on)) { sanctionsOf(sim).splice(sanctionsOf(sim).indexOf(s), 1); continue; }
    const war = sim.atWar[s.by * S + s.on] || sim.activeWars.some((w) => w.status === 'active' && (w.a.includes(s.on) || w.b.includes(s.on)));
    if (!war && sim.time - s.t > YEAR_SEC && (sim.rel[s.by * S + s.on] > -20 || sim.rng.next() < 0.08)) liftSanction(sim, s.by, s.on, 'apaisement');
    else if (sim.sides[s.by].crisis && sim.rng.next() < 0.1) liftSanction(sim, s.by, s.on, 'difficultés économiques');
  }
}

// ======================= CRISES =======================
export const CRISIS_TYPES = {
  border: { label: 'Incident frontalier', icon: '⚠️', text: (a, b) => `Des incidents armés éclatent à la frontière entre ${a} et ${b}.` },
  territory: { label: 'Différend territorial', icon: '🗺️', text: (a, b) => `${a} revendique officiellement des territoires de ${b}.` },
  diplomats: { label: 'Crise diplomatique', icon: '📜', text: (a, b) => `${a} et ${b} expulsent mutuellement leurs diplomates.` },
  minority: { label: 'Tensions communautaires', icon: '👥', text: (a, b) => `${a} accuse ${b} de maltraiter une minorité.` },
  water: { label: 'Guerre de l\'eau', icon: '💧', text: (a, b) => `Un barrage de ${b} menace l'approvisionnement en eau de ${a}.` },
  energy: { label: 'Crise mondiale de l\'énergie', icon: '⛽', global: true, text: () => 'Les prix de l\'énergie s\'envolent : les pays importateurs souffrent, les producteurs s\'enrichissent.' },
  food: { label: 'Crise alimentaire mondiale', icon: '🌾', global: true, text: () => 'De mauvaises récoltes font flamber les prix alimentaires : instabilité dans les pays fragiles.' },
};
export function crisesOf(sim) { return sim.crises || (sim.crises = []); }
export function activeCrises(sim) { return crisesOf(sim).filter((c) => c.stage === 'tension' || c.stage === 'conference' || c.stage === 'global'); }

function spawnCrisis(sim) {
  const S = sim.S, R = sim.rules;
  // choc mondial (rare)
  if (sim.rng.next() < 0.08 && !activeCrises(sim).some((c) => CRISIS_TYPES[c.type].global) && R.ecoEvents !== false) {
    const type = sim.rng.next() < 0.55 ? 'energy' : 'food';
    const c = { id: (sim._crisisId = (sim._crisisId || 0) + 1), type, a: -1, b: -1, start: sim.time, stage: 'global', until: sim.time + YEAR_SEC * (0.6 + sim.rng.next() * 0.6), log: [] };
    crisesOf(sim).push(c);
    note(sim, c, CRISIS_TYPES[type].text());
    sim.chron('crisis', `${CRISIS_TYPES[type].label} : ${CRISIS_TYPES[type].text()}`, {});
    sim._emit({ icon: CRISIS_TYPES[type].icon, title: CRISIS_TYPES[type].label.toUpperCase(), tone: 'bad', side: -1, text: CRISIS_TYPES[type].text(), crisis: c.id });
    return;
  }
  if (R.diploEvents === false || R.diplomacy === false) return;
  // crise bilatérale : voisins en mauvais termes, sans guerre ni trêve, pas déjà en crise
  const busy = new Set(); for (const c of activeCrises(sim)) { busy.add(c.a); busy.add(c.b); }
  let best = null, bv = 0;
  for (let a = 0; a < S; a++) {
    if (!alive(sim, a) || busy.has(a)) continue;
    for (let b = a + 1; b < S; b++) {
      if (!alive(sim, b) || busy.has(b) || !(sim.contact[a * S + b] > 0) || sim.atWar[a * S + b] || sim.truce[a * S + b] > sim.time || sim.allied[a * S + b]) continue;
      const r = sim.rel[a * S + b];
      if (r > -35) continue;
      const v = (-r - 30) * (0.6 + sim.rng.next());
      if (v > bv) { bv = v; best = [a, b]; }
    }
  }
  if (!best) return;
  // l'initiateur : le plus agressif des deux
  let [a, b] = best;
  const pa = PERSONALITIES[(sim.sides[a].ai && sim.sides[a].ai.personality) || 'opportunist'].aggr, pb = PERSONALITIES[(sim.sides[b].ai && sim.sides[b].ai.personality) || 'opportunist'].aggr;
  if (pb > pa) [a, b] = [b, a];
  const types = ['border', 'territory', 'diplomats', 'minority', 'water'];
  const type = types[sim.rng.int(types.length)];
  const c = { id: (sim._crisisId = (sim._crisisId || 0) + 1), type, a, b, start: sim.time, stage: 'tension', until: sim.time + MONTH_SEC * (3 + sim.rng.int(4)), stances: {}, mediators: [], log: [], severity: clamp((-sim.rel[a * S + b] - 30) / 50, 0.2, 1) };
  crisesOf(sim).push(c);
  const A = sim.sides[a], B = sim.sides[b];
  const txt = CRISIS_TYPES[type].text(A.name, B.name);
  note(sim, c, txt);
  sim.chron('crisis', `${CRISIS_TYPES[type].label} : ${txt}`, { e: [A.e, B.e] });
  sim._emit({ icon: CRISIS_TYPES[type].icon, title: 'CRISE INTERNATIONALE', tone: 'bad', side: a, text: txt, crisis: c.id, cell: A.capital });
  addRel(sim, a, b, -8);
  for (const [h, o] of [[a, B], [b, A]]) if (isPlayer(sim, h)) sim.nation.at(h).milestone('diplo', `${CRISIS_TYPES[type].label} avec ${o.name}.`);
}
function note(sim, c, text) { c.log.push({ t: Math.round(sim.time * 10) / 10, text }); if (c.log.length > 30) c.log.shift(); }

// médiateurs : grandes puissances en bons termes avec les deux pays
function pickMediators(sim, c) {
  const S = sim.S;
  const cand = [];
  for (let k = 0; k < S; k++) {
    if (k === c.a || k === c.b || !alive(sim, k)) continue;
    const ra = sim.rel[k * S + c.a], rb = sim.rel[k * S + c.b];
    if (ra < -5 || rb < -5) continue;
    cand.push({ k, v: powerOf(sim.sides[k]) * (1 + (sim.sides[k].devDiplo || 0)) * (1 + Math.min(ra, rb) / 100) });
  }
  return cand.sort((x, y) => y.v - x.v).slice(0, 3).map((x) => x.k);
}

// choix du joueur (conférence) : appliqué par Nation.choose
export const STANCES = {
  concede: { label: 'Faire des concessions', desc: 'Accord très probable ; coûte de l\'argent, un peu de stabilité et de prestige.' },
  firm: { label: 'Rester ferme', desc: 'Prestige et soutien intérieur ; risque d\'escalade plus élevé.' },
  mediate: { label: 'Demander une médiation', desc: 'Les médiateurs pèsent davantage ; relations améliorées avec eux.' },
  threaten: { label: 'Menacer d\'une intervention', desc: 'L\'adversaire peut céder… ou déclarer la guerre.' },
};
export function setStance(sim, crisisId, k, stance) {
  const c = crisesOf(sim).find((x) => x.id === crisisId);
  if (!c || !STANCES[stance]) return;
  c.stances[k] = stance;
  const sd = sim.sides[k];
  if (stance === 'concede') { sd.money -= sd.eco.gdp * 0.003; sd.p.politics.stability = Math.max(5, sd.p.politics.stability - 2); }
  if (stance === 'firm') sd.p.politics.stability = Math.min(99, sd.p.politics.stability + 2);
  if (stance === 'mediate') for (const m of c.mediators) addRel(sim, k, m, 4);
  note(sim, c, `${sd.name} : ${STANCES[stance].label.toLowerCase()}.`);
}
function aiStance(sim, c, k) {
  const sd = sim.sides[k], o = k === c.a ? c.b : c.a;
  const P = PERSONALITIES[(sd.ai && sd.ai.personality) || 'opportunist'];
  const ratio = powerOf(sd) / Math.max(1e-6, powerOf(sim.sides[o]));
  const r = sim.rng.next();
  if (P.aggr > 1.2 && ratio > 1.3 && r < 0.45) return 'threaten';
  if (P.peace > 1.15 || ratio < 0.6) return r < 0.6 ? 'concede' : 'mediate';
  return r < 0.5 ? 'mediate' : 'firm';
}

function conference(sim, c) {
  const S = sim.S, A = sim.sides[c.a], B = sim.sides[c.b];
  c.mediators = pickMediators(sim, c);
  c.stage = 'conference';
  c.until = sim.time + MONTH_SEC * 1.5;
  const med = c.mediators.map((k) => sim.sides[k].name);
  note(sim, c, `Conférence internationale${med.length ? ` sous l'égide ${med.length > 1 ? 'de ' + med.join(', ') : 'de ' + med[0]}` : ''}.`);
  sim._emit({ icon: '🏛️', title: 'CONFÉRENCE INTERNATIONALE', tone: 'neutral', side: c.a, text: `${A.name} et ${B.name} négocient${med.length ? ` (médiation : ${med.join(', ')})` : ''}.`, crisis: c.id });
  for (const k of [c.a, c.b]) {
    if (isPlayer(sim, k)) {
      const n = sim.nation.at(k), o = k === c.a ? B : A;
      if (!n.decision) {
        n.decision = { id: 'crisis', crisis: c.id, title: `Conférence : ${CRISIS_TYPES[c.type].label.toLowerCase()} avec ${o.name}`, text: `${CRISIS_TYPES[c.type].text(A.name, B.name)} Une conférence internationale s'ouvre${med.length ? ` (médiateurs : ${med.join(', ')})` : ''}. Quelle ligne adoptez-vous ?`,
          options: Object.entries(STANCES).map(([id, s]) => ({ label: s.label, desc: s.desc, crisis: id, fx: {} })), def: 2, t: sim.time, until: c.until - 0.5 };
        sim._emit({ icon: '⚖️', title: 'DÉCISION', tone: 'neutral', side: k, text: n.decision.title, nation: true, decision: true, urgent: true });
      } else c.stances[k] = 'mediate';
    } else c.stances[k] = aiStance(sim, c, k);
  }
}

function resolve(sim, c) {
  const S = sim.S, A = sim.sides[c.a], B = sim.sides[c.b];
  if (!alive(sim, c.a) || !alive(sim, c.b)) { c.stage = 'resolved'; c.outcome = 'void'; return; }
  const sa = c.stances[c.a] || 'mediate', sb = c.stances[c.b] || 'mediate';
  const w = { concede: 0.9, mediate: 0.45, firm: -0.25, threaten: -0.6 };
  const medPow = c.mediators.reduce((t, k) => t + powerOf(sim.sides[k]), 0) / Math.max(1e-6, powerOf(A) + powerOf(B));
  let score = w[sa] + w[sb] + clamp(medPow, 0, 2) * (sa === 'mediate' || sb === 'mediate' ? 0.5 : 0.3) + sim.rel[c.a * S + c.b] / 120 - c.severity * 0.6 + (sim.rng.next() - 0.5) * 0.6;
  const pa = PERSONALITIES[(A.ai && A.ai.personality) || 'opportunist'];
  if (sa === 'threaten' && sb === 'concede') score += 0.4;                     // la menace a payé
  let outcome = score > 0.55 ? 'accord' : score > -0.35 ? 'statu' : 'escalade';
  if (outcome === 'escalade' && (sim.rules.wars === false || sim.rng.next() > 0.45 * pa.aggr + (sa === 'threaten' ? 0.25 : 0))) outcome = 'statu';
  c.outcome = outcome; c.stage = 'resolved'; c.end = sim.time;
  const both = `${A.name} et ${B.name}`;
  if (outcome === 'accord') {
    addRel(sim, c.a, c.b, 22);
    sim.truce[c.a * S + c.b] = sim.truce[c.b * S + c.a] = sim.time + YEAR_SEC * 2;
    for (const m of c.mediators) { addRel(sim, m, c.a, 4); addRel(sim, m, c.b, 4); sim.sides[m].devDiplo = (sim.sides[m].devDiplo || 0) + 0.01; }
    // concessions : prestige perdu, mais crise désamorcée
    for (const [k, s] of [[c.a, sa], [c.b, sb]]) if (s === 'concede') sim.sides[k].p.politics.stability = Math.max(5, sim.sides[k].p.politics.stability - 1);
    note(sim, c, `Accord : ${both} signent un accord et une trêve de deux ans.`);
    sim.chron('treaty', `Conférence : accord entre ${both} (${CRISIS_TYPES[c.type].label.toLowerCase()}).`, { e: [A.e, B.e] });
    sim._emit({ icon: '🕊️', title: 'ACCORD', tone: 'good', side: c.a, text: `La conférence aboutit : ${both} signent un accord.`, crisis: c.id });
  } else if (outcome === 'statu') {
    addRel(sim, c.a, c.b, 4);
    note(sim, c, 'Aucun accord : la crise retombe sans être réglée.');
    sim._emit({ icon: '🏛️', title: 'CONFÉRENCE', tone: 'neutral', side: c.a, text: `Pas d'accord entre ${both} : statu quo.`, crisis: c.id });
  } else {
    note(sim, c, `Échec de la conférence : ${A.name} passe à l'action.`);
    const wr = startWar(sim, [c.a], [c.b], 'declaration');
    if (wr) { wr.moments.push({ t: sim.time, type: 'start', text: `Échec de la conférence (${CRISIS_TYPES[c.type].label.toLowerCase()}).` }); aiLog(sim, c.a, `Déclare la guerre à ${B.name} après l'échec de la conférence.`, 'bad'); }
  }
  for (const [h, o] of [[c.a, B], [c.b, A]]) if (isPlayer(sim, h)) sim.nation.at(h).milestone('diplo', `Conférence avec ${o.name} : ${{ accord: 'accord', statu: 'statu quo', escalade: 'escalade' }[outcome]}.`);
}

// effets mensuels des crises mondiales (appelé pour chaque pays dans son mois)
export function globalCrisisEffect(sim, k) {
  let drag = 0;
  const sd = sim.sides[k];
  for (const c of activeCrises(sim)) {
    if (c.stage !== 'global') continue;
    if (c.type === 'energy') { const e = (sd.p.res && sd.p.res.energy) || 50; drag += (55 - e) / 100 * 0.035; }
    if (c.type === 'food') { const f = (sd.p.res && sd.p.res.food) || 50; if (f < 45) sd.p.politics.stability = Math.max(5, sd.p.politics.stability - 0.4); drag += (50 - f) / 100 * 0.015; }
  }
  return drag;
}

export function updateCrises(sim) {
  if (sim.rules.diplomacy === false && sim.rules.ecoEvents === false) return;
  aiSanctions(sim);
  for (const c of activeCrises(sim)) {
    if (c.stage === 'global') { if (sim.time >= c.until) { c.stage = 'resolved'; c.outcome = 'over'; note(sim, c, 'Fin de la crise.'); sim._emit({ icon: CRISIS_TYPES[c.type].icon, title: 'FIN DE CRISE', tone: 'good', side: -1, text: `${CRISIS_TYPES[c.type].label} : les marchés se stabilisent.` }); } continue; }
    if (!alive(sim, c.a) || !alive(sim, c.b) || sim.atWar[c.a * sim.S + c.b]) { c.stage = 'resolved'; c.outcome = sim.atWar[c.a * sim.S + c.b] ? 'escalade' : 'void'; continue; }
    if (c.stage === 'tension') { addRel(sim, c.a, c.b, -1.5); if (sim.time >= c.until) conference(sim, c); }
    else if (c.stage === 'conference' && sim.time >= c.until) resolve(sim, c);
  }
  if (sim.time >= (sim._nextCrisis || MONTH_SEC * 6)) {
    sim._nextCrisis = sim.time + MONTH_SEC * (5 + sim.rng.int(8)) * (sim.sides.length > 40 ? 0.6 : 1.4);
    if (sim.rules.randomEvents !== false || sim.rules.diploEvents !== false) spawnCrisis(sim);
  }
}

export function serializeCrises(sim) { return { crises: crisesOf(sim).slice(-60), sanctions: sanctionsOf(sim), id: sim._crisisId || 0, next: sim._nextCrisis || 0 }; }
export function restoreCrises(sim, o) { if (!o) return; sim.crises = o.crises || []; sim.sanctions = o.sanctions || []; sim._crisisId = o.id || 0; sim._nextCrisis = o.next || 0; }
