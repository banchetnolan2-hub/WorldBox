// COALITIONS — plusieurs pays s'unissent contre un pays (ou une menace) : chef de coalition, membres aux
// intérêts différents, objectif commun, coordination militaire, entrées et sorties, négociations, évolution
// pendant la guerre. Utilisé par toutes les IA et, en Nation Simulator, par le joueur.
//
// coalition = {
//   id, name, leader (côté), target (côté visé), kind ('defensive' | 'offensive' | 'containment'),
//   goal ('liberate' | 'defeat' | 'contain'), victim (côté protégé ou -1),
//   members: [{ k, joined, interest, commitment (0-1), contribution (Md$ et combats), claims: [ids d'origine] }],
//   cohesion (0-1), status ('active' | 'dissolved' | 'victorious'), formed, ended, endReason,
//   war (id de la guerre contre la cible ou null), history: [{ t, text, kind }],
//   op: { until, text } (offensive coordonnée en cours), nextOp
// }
// Tout est déterministe (générateur de la simulation) et sérialisé avec la partie.
import { joinWar, startWar, addRel, noteChange } from './wars.js';
import { tn } from './tuning.js';
import { powerOf, aiLog } from './ai.js';
import { PERSONALITIES } from './profile.js';
import { MONTH_SEC, YEAR_SEC } from './calendar.js';
import { de } from './fr.js';

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const r2 = (v) => Math.round(v * 100) / 100;

export const INTERESTS = {
  victim: { label: 'Pays agressé', desc: 'Défend son territoire et veut retrouver ses frontières.', loyalty: 1.0 },
  security: { label: 'Sécurité', desc: 'Voisin de la menace : veut l\'affaiblir pour se protéger.', loyalty: 0.85 },
  territory: { label: 'Revendications', desc: 'Espère récupérer ou gagner des territoires.', loyalty: 0.7 },
  alliance: { label: 'Solidarité d\'alliance', desc: 'Engagé par ses alliances avec les membres.', loyalty: 0.75 },
  economy: { label: 'Intérêts économiques', desc: 'Protège ses échanges et ses partenaires commerciaux.', loyalty: 0.5 },
  revenge: { label: 'Revanche', desc: 'Garde le souvenir de guerres passées contre la cible.', loyalty: 0.8 },
  opportunism: { label: 'Opportunisme', desc: 'Rejoint le camp gagnant pour obtenir une part des gains.', loyalty: 0.35 },
};
export const GOALS = {
  liberate: { label: 'Libérer le pays agressé', short: 'Libération', desc: 'Repousser l\'agresseur et rétablir les frontières d\'avant-guerre.' },
  defeat: { label: 'Vaincre la menace', short: 'Victoire', desc: 'Réduire durablement la puissance de la cible (territoires, capitulation).' },
  contain: { label: 'Contenir la menace', short: 'Endiguement', desc: 'Défense mutuelle : toute attaque contre un membre engage toute la coalition.' },
};
export const KIND_LABELS = { defensive: 'Coalition défensive', offensive: 'Coalition offensive', containment: 'Coalition d\'endiguement' };

const isPlayer = (sim, k) => !!(sim.nation && sim.nation.isHuman(k));
const on = (sim) => sim.rules.alliances !== false && sim.rules.coalitions !== false && sim.rules.diplomacy !== false;
const alive = (sim, k) => k >= 0 && sim.sides[k] && !sim.sides[k].eliminated;
const liveWar = (sim, id) => (id ? sim.wars.find((w) => w.id === id && w.status === 'active') || null : null);
const warOf = (sim, a, b) => sim.wars.find((w) => w.status === 'active' && ((w.a.includes(a) && w.b.includes(b)) || (w.b.includes(a) && w.a.includes(b))));

export function coalitions(sim) { return sim.coalitions || (sim.coalitions = []); }
export function activeCoalitions(sim) { return coalitions(sim).filter((c) => c.status === 'active'); }
export function coalitionsOf(sim, k) { return activeCoalitions(sim).filter((c) => c.members.some((m) => m.k === k)); }
export function coalitionsAgainst(sim, k) { return activeCoalitions(sim).filter((c) => c.target === k); }
export function memberOf(c, k) { return c.members.find((m) => m.k === k) || null; }
export function coalitionById(sim, id) { return coalitions(sim).find((c) => c.id === id) || null; }
export function coalitionPower(sim, c) { return c.members.reduce((a, m) => a + (alive(sim, m.k) ? powerOf(sim.sides[m.k]) : 0), 0); }
const note = (sim, c, text, kind = 'info') => { c.history.push({ t: Math.round(sim.time * 10) / 10, text, kind }); if (c.history.length > 120) c.history.shift(); };

function nameOf(sim, c) {
  const T = sim.sides[c.target];
  const tn = T ? T.name : 'la menace';
  if (c.goal === 'liberate' && alive(sim, c.victim)) return `Coalition pour ${sim.sides[c.victim].name}`;
  if (c.kind === 'containment') return `Pacte contre ${tn}`;
  return `Coalition contre ${tn}`;
}

// ---------------- menace : à quel point un pays inquiète-t-il les autres ----------------
export function threatOf(sim, t, viewer = -1) {
  const S = sim.S, T = sim.sides[t];
  if (!alive(sim, t)) return { score: 0, factors: [] };
  const f = [];
  const add = (label, v) => { if (Math.abs(v) >= 0.03) f.push({ label, v: r2(v) }); };
  // puissance relative (par rapport à la moyenne des voisins)
  let np = 0, nn = 0;
  for (let o = 0; o < S; o++) if (o !== t && alive(sim, o) && (sim.contact[t * S + o] > 0 || sim.nearCap[t * S + o])) { np += powerOf(sim.sides[o]); nn++; }
  const ratio = powerOf(T) / Math.max(1e-6, nn ? np / nn : powerOf(T));
  add('Puissance militaire supérieure', clamp((ratio - 1.2) * 0.3, 0, 0.9));
  // agressions récentes (guerres déclarées, pays envahis)
  let agg = 0;
  for (const w of sim.wars) if (w.a[0] === t && w.cause === 'declaration' && sim.time - w.start < YEAR_SEC * 4) agg += w.status === 'active' ? 1 : 0.5;
  add('Agressions récentes', Math.min(1.2, agg * 0.45));
  // conquêtes : territoire tenu hors de ses frontières d'origine
  add('Conquêtes', clamp((T.heldForeign || 0) / Math.max(30, T.initial || T.cells) * 2.2, 0, 1));
  // personnalité expansionniste connue
  const P = PERSONALITIES[(T.ai && T.ai.personality) || 'opportunist'];
  add('Ambitions expansionnistes', (P.aggr - 1) * 0.25);
  if (viewer >= 0) {
    add('Proximité', sim.contact[t * S + viewer] > 0 ? 0.3 : sim.nearCap[t * S + viewer] ? 0.15 : -0.2);
    add('Relations', clamp(-sim.rel[viewer * S + t] / 120, -0.4, 0.6));
    if (sim.atWar[viewer * S + t]) add('Déjà en guerre', 0.6);
  }
  let score = 0; for (const x of f) score += x.v;
  return { score: r2(score), factors: f.sort((a, b) => Math.abs(b.v) - Math.abs(a.v)) };
}

// ---------------- intérêts d'un pays à rejoindre une coalition ----------------
export function evaluateJoin(sim, c, k) {
  const S = sim.S, t = c.target, K = sim.sides[k];
  const f = [];
  const add = (label, v) => { if (Math.abs(v) >= 0.03) f.push({ label, v: r2(v) }); };
  if (!alive(sim, k) || k === t || memberOf(c, k)) return { accept: false, score: -9, interest: null, factors: [{ label: 'Impossible', v: -9 }] };
  if (sim.allied[k * S + t]) return { accept: false, score: -9, interest: null, factors: [{ label: `Allié de ${sim.sides[t].name}`, v: -9 }] };
  const P = PERSONALITIES[(K.ai && K.ai.personality) || 'opportunist'];
  const th = threatOf(sim, t, k);
  add('Menace perçue', th.score * 0.6);
  // intérêts possibles, le plus fort l'emporte
  const interests = [];
  if (k === c.victim || sim.atWar[k * S + t]) interests.push(['victim', 0.9]);
  if (sim.contact[k * S + t] > 0) interests.push(['security', 0.35 + th.score * 0.25]);
  const lost = ((sim.sides[t].gainsFrom || {})[K.e] || 0) / 3;      // territoires pris par la cible
  if (lost > 2) interests.push(['territory', Math.min(0.8, 0.25 + lost / 60)]);
  let allies = 0; for (const m of c.members) if (sim.allied[k * S + m.k]) allies++;
  if (allies) interests.push(['alliance', 0.25 + allies * 0.15]);
  let trade = 0; for (const m of c.members) if (sim.trade && sim.trade[k * S + m.k]) trade++;
  if (trade) interests.push(['economy', 0.12 + trade * 0.06]);
  const past = (sim.dmem && Object.values(sim.dmem).length) ? sim.wars.filter((w) => w.status !== 'active' && ((w.a.includes(k) && w.b.includes(t)) || (w.b.includes(k) && w.a.includes(t)))).length : 0;
  if (past) interests.push(['revenge', 0.2 + past * 0.12]);
  // la coalition gagne : les opportunistes s'y joignent
  const w = liveWar(sim, c.war);
  const winning = w ? (w.a.includes(t) ? (w.shareB || 0) - (w.shareA || 0) : (w.shareA || 0) - (w.shareB || 0)) : 0;
  if (winning > 0.05) interests.push(['opportunism', 0.15 + winning * 0.8 * P.aggr]);
  interests.sort((a, b) => b[1] - a[1]);
  const [interest, iv] = interests[0] || [null, 0];
  if (interest) add(`Intérêt : ${INTERESTS[interest].label.toLowerCase()}`, iv);
  else add('Aucun intérêt direct', -0.35);
  add('Relations avec le chef', clamp(sim.rel[k * S + c.leader] / 100, -0.6, 0.5));
  add('Relations avec la cible', clamp(-sim.rel[k * S + t] / 140, -0.5, 0.5));
  // coût : guerre en cours ou à venir contre plus fort que soi
  const ratio = (coalitionPower(sim, c) + powerOf(K)) / Math.max(1e-6, powerOf(sim.sides[t]));
  add('Rapport de force de la coalition', clamp((ratio - 1) * 0.25, -0.5, 0.45));
  if (c.war && !sim.atWar[k * S + t]) add('Entrée en guerre immédiate', -0.35 * (P.risk < 0.5 ? 1.4 : 1));
  let busy = 0; for (let o = 0; o < S; o++) if (o !== t && sim.atWar[k * S + o]) busy++;
  if (busy) add('Déjà engagé dans d\'autres guerres', -0.3 * busy);
  add('Lassitude de la guerre', -(K.exhaustion || 0) * 0.6);
  if (K.crisis) add('Crise économique', -0.3);
  add('Personnalité', (P.ally - 1) * 0.35 + (K.ai && K.ai.personality === 'isolationist' ? -0.6 : 0));
  // le joueur : mémoire des engagements tenus ou rompus
  if (isPlayer(sim, c.leader) && sim.nation) { const mm = sim.nation.at(c.leader).memOf(k); add('Confiance envers vous', clamp(0.1 - mm.broken * 0.25 - mm.declined * 0.03 + mm.gifts * 0.04, -0.6, 0.3)); }
  let score = -0.25 + (tn(sim, 'aiCoalitions') - 1) * 0.4; for (const x of f) score += x.v;
  return { accept: score > 0, score: r2(score), interest: interest || 'alliance', factors: f.sort((a, b) => Math.abs(b.v) - Math.abs(a.v)) };
}

// ---------------- création, adhésion, départ ----------------
export function createCoalition(sim, leader, target, opts = {}) {
  if (!on(sim) || !alive(sim, leader) || !alive(sim, target) || leader === target) return null;
  if (coalitionsAgainst(sim, target).some((c) => memberOf(c, leader))) return null;
  const list = coalitions(sim);
  sim._coalId = (sim._coalId || 0) + 1;
  const goal = opts.goal || (opts.victim >= 0 ? 'liberate' : 'contain');
  const c = {
    id: sim._coalId, name: '', leader, target, victim: opts.victim ?? -1, goal,
    kind: goal === 'contain' ? 'containment' : goal === 'liberate' ? 'defensive' : 'offensive',
    members: [], cohesion: 0.7, status: 'active', formed: sim.time, ended: null, endReason: null,
    war: null, history: [], op: null, nextOp: sim.time + 30, startShare: 0,
  };
  c.name = opts.name || nameOf(sim, c);
  list.push(c);
  const w0 = warOf(sim, leader, target) || (alive(sim, c.victim) ? warOf(sim, c.victim, target) : null);
  if (w0) c.war = w0.id;                       // coalition formée pendant une guerre : le fondateur s'y engage
  addMember(sim, c, leader, opts.interest || (leader === c.victim ? 'victim' : 'security'), true);
  note(sim, c, `${sim.sides[leader].name} fonde la coalition (${GOALS[goal].label.toLowerCase()}).`, 'found');
  sim.chron('alliance', `${sim.sides[leader].name} forme une coalition contre ${sim.sides[target].name}.`, { e: [sim.sides[leader].e, sim.sides[target].e] });
  sim._emit({ icon: '🛡️', title: 'COALITION', tone: 'neutral', side: leader, text: `${sim.sides[leader].name} forme « ${c.name} » : ${GOALS[goal].desc.toLowerCase()}`, coalition: c.id });
  addRel(sim, leader, target, -10);
  for (const k of opts.members || []) if (k !== leader) addMember(sim, c, k, evaluateJoin(sim, c, k).interest || 'alliance');
  return c;
}

function addMember(sim, c, k, interest, founder = false) {
  if (memberOf(c, k)) return false;
  const K = sim.sides[k];
  c.members.push({ k, joined: sim.time, interest, commitment: clamp(INTERESTS[interest] ? INTERESTS[interest].loyalty : 0.6, 0.2, 1), contribution: 0, aid: 0 });
  if (!founder) {
    note(sim, c, `${K.name} rejoint la coalition (${INTERESTS[interest] ? INTERESTS[interest].label.toLowerCase() : 'solidarité'}).`, 'join');
    sim.chron('alliance', `${K.name} rejoint ${c.name}.`, { e: [K.e] });
    sim._emit({ icon: '🛡️', title: 'COALITION', tone: 'neutral', side: k, text: `${K.name} rejoint « ${c.name} ».`, coalition: c.id });
    c.cohesion = clamp(c.cohesion + 0.03, 0, 1);
  }
  sim.hist(k, 'alliance', `Membre de « ${c.name} ».`);
  for (const m of c.members) if (m.k !== k) addRel(sim, k, m.k, 6);
  addRel(sim, k, c.target, -8);
  // une coalition en guerre engage ses nouveaux membres
  const w = liveWar(sim, c.war);
  if (w && !w.a.includes(k) && !w.b.includes(k)) {
    const side = w.a.includes(c.target) ? 'b' : 'a';
    if (joinWar(sim, w, k, side)) note(sim, c, `${K.name} entre en guerre aux côtés de la coalition.`, 'war');
  }
  if (isPlayer(sim, k) && sim.nation) sim.nation.at(k).milestone('alliance', `Membre de « ${c.name} ».`);
  return true;
}

export function joinCoalition(sim, c, k) {
  if (!c || c.status !== 'active') return { ok: false, text: 'Cette coalition n\'existe plus.' };
  const ev = evaluateJoin(sim, c, k);
  if (ev.score <= -9) return { ok: false, text: ev.factors[0].label };
  addMember(sim, c, k, ev.interest);
  return { ok: true, ev };
}

// départ d'un membre (paix séparée possible si la coalition est en guerre)
export function leaveCoalition(sim, c, k, reason = '', separatePeace = true) {
  const m = memberOf(c, k);
  if (!m || c.status !== 'active') return false;
  c.members = c.members.filter((x) => x !== m);
  const K = sim.sides[k];
  note(sim, c, `${K.name} quitte la coalition${reason ? ` : ${reason}` : ''}.`, 'leave');
  sim.chron('alliance', `${K.name} quitte ${c.name}${reason ? ` (${reason})` : ''}.`, { e: [K.e] });
  sim._emit({ icon: '🛡️', title: 'COALITION', tone: 'bad', side: k, text: `${K.name} quitte « ${c.name} »${reason ? ` : ${reason}` : ''}.`, coalition: c.id });
  c.cohesion = clamp(c.cohesion - 0.08, 0, 1);
  for (const x of c.members) addRel(sim, k, x.k, -8);
  if (isPlayer(sim, k) && sim.nation) sim.nation.at(k).milestone('alliance', `Départ de « ${c.name} ».`);
  if (separatePeace && sim.atWar[k * sim.S + c.target] && k !== c.victim) {
    const w = liveWar(sim, c.war);
    if (w) separatePeaceWith(sim, w, k);
  }
  if (c.leader === k) electLeader(sim, c);
  if (!c.members.length) dissolve(sim, c, 'plus aucun membre');
  return true;
}

// paix séparée : le pays sort de la guerre, les territoires occupés entre lui et l'ennemi sont rendus
export function separatePeaceWith(sim, w, k) {
  if (!w || w.status !== 'active' || (!w.a.includes(k) && !w.b.includes(k))) return false;
  const S = sim.S, mine = w.a.includes(k) ? w.a : w.b, other = w.a.includes(k) ? w.b : w.a;
  if (mine.length <= 1) return false;                         // le dernier membre d'un camp ne fait pas « paix séparée »
  mine.splice(mine.indexOf(k), 1);
  for (const y of other) { sim.atWar[k * S + y] = Math.max(0, sim.atWar[k * S + y] - 1); sim.atWar[y * S + k] = Math.max(0, sim.atWar[y * S + k] - 1); sim.truce[k * S + y] = sim.truce[y * S + k] = sim.time + YEAR_SEC; }
  const K = sim.sides[k], ke = K.e, oe = new Set(other.map((o) => sim.sides[o].e));
  const back = [];
  for (const [c, pre] of w.changes) {
    const now = sim.owner[c];
    if ((now === ke && oe.has(pre)) || (oe.has(now) && pre === ke)) back.push([c, pre]);
  }
  for (const [c, pre] of back) sim.flip(c, pre, false);
  w.moments.push({ t: sim.time, type: 'join', text: `${K.name} signe une paix séparée et quitte le conflit.` });
  sim.chron('treaty', `${K.name} signe une paix séparée (${w.name}).`, { war: w.id, e: [ke] });
  sim.hist(k, 'peace', `Paix séparée : ${w.name}.`);
  sim._emit({ icon: '🕊️', title: 'PAIX SÉPARÉE', tone: 'neutral', side: k, text: `${K.name} quitte ${w.name} (statu quo : ${back.length} parcelle(s) rendue(s)).`, war: w.id });
  sim.markDirty([k, ...other]);
  void noteChange;
  return true;
}

function electLeader(sim, c) {
  const cand = c.members.filter((m) => alive(sim, m.k)).sort((a, b) => powerOf(sim.sides[b.k]) * (0.5 + b.commitment) - powerOf(sim.sides[a.k]) * (0.5 + a.commitment));
  if (!cand.length) return;
  const old = c.leader;
  c.leader = cand[0].k;
  if (old !== c.leader) {
    note(sim, c, `${sim.sides[c.leader].name} prend la tête de la coalition.`, 'leader');
    sim._emit({ icon: '🛡️', title: 'COALITION', tone: 'neutral', side: c.leader, text: `${sim.sides[c.leader].name} prend la tête de « ${c.name} ».`, coalition: c.id });
  }
}

function dissolve(sim, c, reason, success = false) {
  if (c.status !== 'active') return;
  c.status = success ? 'victorious' : 'dissolved';
  c.ended = sim.time; c.endReason = reason;
  note(sim, c, success ? `Objectif atteint : ${reason}. La coalition est dissoute.` : `Coalition dissoute : ${reason}.`, success ? 'win' : 'end');
  sim.chron('alliance', `${c.name} ${success ? 'atteint son objectif et se dissout' : 'est dissoute'} (${reason}).`, { e: c.members.map((m) => sim.sides[m.k].e) });
  sim._emit({ icon: '🛡️', title: success ? 'COALITION VICTORIEUSE' : 'COALITION DISSOUTE', tone: success ? 'good' : 'neutral', side: c.leader, text: `« ${c.name} » : ${reason}.`, coalition: c.id });
}

// ---------------- coordination militaire ----------------
// bonus de combat des membres engagés ensemble contre la cible (opérations combinées, renseignement partagé)
export function coalitionAttackBonus(sim, s) {
  const sd = sim.sides[s];
  if (!sd.coal || sim.time > sd.coal.until) return 1;
  return sd.coal.atk;
}
function coordinate(sim, c) {
  const S = sim.S, t = c.target;
  const fighting = c.members.filter((m) => alive(sim, m.k) && sim.atWar[m.k * S + t]);
  const n = fighting.length;
  const base = 1 + 0.035 * Math.min(4, n - 1) * c.cohesion;
  const opOn = c.op && sim.time < c.op.until;
  for (const m of fighting) sim.sides[m.k].coal = { until: sim.time + MONTH_SEC * 1.2, atk: base * (opOn ? 1.08 : 1), id: c.id };
  // offensive coordonnée : décidée par le chef quand la coalition est assez soudée
  if (!opOn && n >= 2 && sim.time >= (c.nextOp || 0) && c.cohesion > 0.45 && !isPlayer(sim, c.leader)) launchOffensive(sim, c);
  // soutien des membres éloignés : aide financière et matérielle au membre le plus menacé du front
  const front = fighting.filter((m) => sim.contact[m.k * S + t] >= 4);
  if (front.length) {
    const pressed = front.slice().sort((a, b) => (sim.sides[a.k].cells / Math.max(1, sim.sides[a.k].initial)) - (sim.sides[b.k].cells / Math.max(1, sim.sides[b.k].initial)))[0];
    for (const m of c.members) {
      if (m.k === pressed.k || !alive(sim, m.k) || isPlayer(sim, m.k)) continue;
      const K = sim.sides[m.k];
      if (front.includes(m) && sim.sides[m.k].cells < sim.sides[m.k].initial * 0.95) continue;
      const amt = Math.max(0, Math.min(K.money * 0.05, K.eco.gdp * 0.0015 * m.commitment));
      if (amt < 0.01) continue;
      K.money -= amt; sim.sides[pressed.k].money += amt; m.aid += amt; m.contribution += amt;
    }
  }
  for (const m of fighting) m.contribution += sim.sides[m.k].units * 0.0005;
}
export function launchOffensive(sim, c, byPlayer = false) {
  const S = sim.S, t = c.target;
  const fighting = c.members.filter((m) => alive(sim, m.k) && sim.atWar[m.k * S + t]);
  if (fighting.length < 2) return { ok: false, text: 'Il faut au moins deux membres en guerre contre la cible pour une offensive coordonnée.' };
  if (c.op && sim.time < c.op.until) return { ok: false, text: 'Une offensive coordonnée est déjà en cours.' };
  c.op = { until: sim.time + 45, text: `Offensive coordonnée contre ${sim.sides[t].name}` };
  c.nextOp = sim.time + 150;
  for (const m of fighting) {
    const sd = sim.sides[m.k];
    sd.momentum = Math.min(0.6, (sd.momentum || 0) + 0.08 * c.cohesion);
  }
  note(sim, c, `${byPlayer ? 'Sur votre ordre, offensive' : 'Offensive'} coordonnée de ${fighting.length} armées contre ${sim.sides[t].name}.`, 'op');
  sim._emit({ icon: '⚔️', title: 'OFFENSIVE COORDONNÉE', tone: 'neutral', side: c.leader, text: `« ${c.name} » : ${fighting.length} armées attaquent ensemble ${sim.sides[t].name}.`, coalition: c.id });
  return { ok: true };
}

// ---------------- réaction aux nouvelles guerres ----------------
// appelé quand une guerre commence : défense mutuelle des coalitions d'endiguement, ralliement pour la victime
export function onWarStarted(sim, w) {
  if (!on(sim) || !w) return;
  const aggressor = w.a[0];
  for (const c of activeCoalitions(sim)) {
    if (c.target !== aggressor) continue;
    if (!w.b.some((k) => memberOf(c, k))) continue;
    c.war = w.id;
    if (c.goal === 'contain') { c.goal = 'defeat'; c.kind = 'offensive'; note(sim, c, `${sim.sides[aggressor].name} attaque un membre : la défense mutuelle s'applique.`, 'war'); }
    for (const m of c.members) {
      if (w.a.includes(m.k) || w.b.includes(m.k) || !alive(sim, m.k)) continue;
      if (isPlayer(sim, m.k)) { sim.nation.at(m.k).offer(c.leader === m.k ? w.b[0] : c.leader, 'help', {}, `${sim.sides[aggressor].name} attaque un membre de « ${c.name} ». La coalition vous appelle à honorer vos engagements.`); continue; }
      const P = PERSONALITIES[sim.sides[m.k].ai.personality];
      if (sim.rng.next() < 0.45 + 0.4 * m.commitment * P.ally) { if (joinWar(sim, w, m.k, 'b')) { aiLog(sim, m.k, `Honore ses engagements dans « ${c.name} » et entre en guerre.`, 'bad'); note(sim, c, `${sim.sides[m.k].name} entre en guerre (défense mutuelle).`, 'war'); } }
      else { m.commitment = Math.max(0.1, m.commitment - 0.25); c.cohesion = clamp(c.cohesion - 0.06, 0, 1); note(sim, c, `${sim.sides[m.k].name} hésite à entrer en guerre.`, 'warn'); }
    }
  }
}

// ---------------- mise à jour mensuelle ----------------
export function updateCoalitions(sim) {
  if (!on(sim)) return;
  const S = sim.S;
  for (const c of activeCoalitions(sim)) {
    // membres disparus, cible éliminée
    c.members = c.members.filter((m) => alive(sim, m.k));
    if (!c.members.length) { dissolve(sim, c, 'plus aucun membre'); continue; }
    if (!alive(sim, c.leader)) electLeader(sim, c);
    if (!alive(sim, c.target)) { dissolve(sim, c, `${sim.sides[c.target].name} a été vaincu`, true); continue; }
    // guerre en cours contre la cible
    let w = liveWar(sim, c.war);
    if (!w) {
      w = c.members.map((m) => warOf(sim, m.k, c.target)).find(Boolean) || null;
      if (w && c.war !== w.id) { c.war = w.id; c.startShare = 0; note(sim, c, `La coalition est en guerre contre ${sim.sides[c.target].name} (${w.name}).`, 'war'); }
      else if (!w && c.war) {
        // la guerre est terminée : objectif atteint ?
        const ended = sim.wars.find((x) => x.id === c.war);
        c.war = null;
        if (ended && ended.winner) {
          const won = ended[ended.winner].some((k) => memberOf(c, k));
          if (won && c.goal !== 'contain') { dissolve(sim, c, `victoire sur ${sim.sides[c.target].name}`, true); continue; }
          if (!won) { c.cohesion = clamp(c.cohesion - 0.25, 0, 1); note(sim, c, 'La guerre est perdue : la coalition est ébranlée.', 'warn'); }
        }
        if (c.goal === 'liberate') { c.goal = 'contain'; c.kind = 'containment'; c.name = nameOf(sim, c); note(sim, c, 'La guerre est finie : la coalition devient un pacte de défense mutuelle.', 'info'); }
      }
    }
    // cohésion : victoires, défaites, lassitude, partage du fardeau, désaccords
    const exh = c.members.reduce((a, m) => a + (sim.sides[m.k].exhaustion || 0), 0) / c.members.length;
    let drift = 0.004 - exh * 0.02;
    if (w) {
      const tA = w.a.includes(c.target);
      const adv = tA ? (w.shareB || 0) - (w.shareA || 0) : (w.shareA || 0) - (w.shareB || 0);
      drift += clamp((adv - (c.lastAdv ?? adv)) * 0.6, -0.05, 0.05) + (adv > 0.05 ? 0.006 : adv < -0.1 ? -0.01 : 0);
      c.lastAdv = adv;
      const inWar = c.members.filter((m) => sim.atWar[m.k * S + c.target]).length;
      if (inWar < c.members.length) drift -= 0.008 * (c.members.length - inWar);     // passagers clandestins
      coordinate(sim, c);
    } else if (sim.time - c.formed > YEAR_SEC * 2 && threatOf(sim, c.target).score < 0.35) drift -= 0.02;   // menace dissipée
    c.cohesion = clamp(c.cohesion + drift, 0, 1);
    // engagement de chaque membre selon son intérêt
    for (const m of c.members) {
      const K = sim.sides[m.k];
      let d = (INTERESTS[m.interest] ? INTERESTS[m.interest].loyalty : 0.6) - m.commitment;
      d = d * 0.05 - (K.exhaustion || 0) * 0.02 - (K.crisis ? 0.02 : 0) + (c.cohesion - 0.5) * 0.01;
      if (m.interest === 'opportunism' && w) { const tA = w.a.includes(c.target); const adv = tA ? (w.shareB || 0) - (w.shareA || 0) : (w.shareA || 0) - (w.shareB || 0); d += adv < 0 ? -0.05 : 0.01; }
      m.commitment = clamp(m.commitment + d, 0, 1);
    }
    // départs : engagement trop faible (jamais le pays agressé, jamais le joueur sans son accord)
    for (const m of c.members.slice()) {
      if (m.k === c.victim || isPlayer(sim, m.k) || c.members.length <= 1) continue;
      if (m.commitment < 0.12 || (c.cohesion < 0.2 && m.commitment < 0.4)) {
        leaveCoalition(sim, c, m.k, m.interest === 'opportunism' ? 'la coalition ne gagne plus' : (sim.sides[m.k].exhaustion || 0) > 0.5 ? 'lassitude de la guerre' : 'intérêts divergents', true);
        aiLog(sim, m.k, `Quitte « ${c.name} ».`);
      }
    }
    if (c.status !== 'active') continue;
    if (c.cohesion < 0.08) { dissolve(sim, c, 'désaccords entre les membres'); continue; }
    if (c.members.length === 1 && !c.war && sim.time - c.formed > YEAR_SEC) { dissolve(sim, c, 'aucun allié n\'a rejoint la coalition'); continue; }
    if (!c.war && c.goal === 'contain' && sim.time - c.formed > YEAR_SEC * 6 && threatOf(sim, c.target).score < 0.2) { dissolve(sim, c, 'la menace a disparu', true); continue; }
    // recrutement : le chef (IA) invite les pays intéressés
    if (!isPlayer(sim, c.leader) && sim.time >= (c.nextInvite || 0)) {
      c.nextInvite = sim.time + MONTH_SEC * 4;
      recruit(sim, c);
    }
  }
  // formation de nouvelles coalitions par les IA
  if (sim.time >= (sim._nextCoalScan || 0)) {
    sim._nextCoalScan = sim.time + MONTH_SEC;
    formCoalitions(sim);
  }
}

function recruit(sim, c) {
  const S = sim.S;
  // assez de membres : rapport de force largement favorable ou coalition déjà très large
  const T = sim.sides[c.target];
  if (c.members.length >= 9 || (T && coalitionPower(sim, c) > powerOf(T) * (c.war ? 2.2 : 1.6))) return;
  let best = -1, bv = 0, bev = null;
  for (let k = 0; k < S; k++) {
    if (!alive(sim, k) || memberOf(c, k) || k === c.target) continue;
    if (!(sim.contact[k * S + c.target] > 0 || sim.nearCap[k * S + c.target] || c.members.some((m) => sim.allied[k * S + m.k]))) continue;
    const ev = evaluateJoin(sim, c, k);
    if (ev.score > bv) { bv = ev.score; best = k; bev = ev; }
  }
  if (best < 0) return;
  if (isPlayer(sim, best)) {
    sim.nation.at(best).offer(c.leader, 'coalition', { coalition: c.id }, `${sim.sides[c.leader].name} vous invite à rejoindre « ${c.name} » (${GOALS[c.goal].label.toLowerCase()}).`);
    return;
  }
  if (sim.rng.next() < clamp(0.35 + bv, 0, 0.95)) addMember(sim, c, best, bev.interest);
  else aiLog(sim, best, `Décline l'invitation à rejoindre « ${c.name} ».`);
}

// les IA forment des coalitions face aux agresseurs (une à la fois par cible)
function formCoalitions(sim) {
  const S = sim.S;
  if (sim.rules.aiAdvanced === false) return;
  for (const w of sim.activeWars) {
    if (w.status !== 'active' || w.cause !== 'declaration' || sim.time - w.start < 6) continue;
    const t = w.a[0], victim = w.b[0];
    if (!alive(sim, t) || !alive(sim, victim) || coalitionsAgainst(sim, t).length) continue;
    const adv = (w.shareA || 0) - (w.shareB || 0);
    if (adv < 0.04 && threatOf(sim, t).score < 0.8) continue;      // l'agression échoue déjà : pas besoin de coalition
    // le fondateur : le plus puissant des pays inquiets (voisins de l'agresseur ou alliés de la victime), sinon la victime
    let founder = -1, fv = 0;
    for (let k = 0; k < S; k++) {
      if (k === t || !alive(sim, k) || sim.allied[k * S + t] || isPlayer(sim, k)) continue;
      const near = sim.contact[k * S + t] > 0 || sim.nearCap[k * S + t] || sim.allied[k * S + victim] || k === victim;
      if (!near) continue;
      const th = threatOf(sim, t, k).score;
      const v = th * (0.5 + powerOf(sim.sides[k]) / Math.max(1e-6, powerOf(sim.sides[t]))) * PERSONALITIES[sim.sides[k].ai.personality].ally;
      if (v > fv && th > 0.55) { fv = v; founder = k; }
    }
    if (founder < 0) continue;
    const c = createCoalition(sim, founder, t, { victim, goal: 'liberate' });
    if (!c) continue;
    if (founder !== victim && !memberOf(c, victim)) { if (isPlayer(sim, victim)) sim.nation.at(victim).offer(founder, 'coalition', { coalition: c.id }, `${sim.sides[founder].name} forme une coalition pour vous défendre contre ${sim.sides[t].name}. Rejoignez-la.`); else addMember(sim, c, victim, 'victim'); }
    aiLog(sim, founder, `Forme « ${c.name} » face à ${sim.sides[t].name}.`, 'good');
    recruit(sim, c);
  }
  // endiguement préventif : une puissance très menaçante sans guerre en cours
  if (sim.rng.next() < 0.25) {
    let t = -1, tv = 1.25;
    for (let k = 0; k < S; k++) { if (!alive(sim, k) || coalitionsAgainst(sim, k).length) continue; const th = threatOf(sim, k).score; if (th > tv) { tv = th; t = k; } }
    if (t >= 0) {
      let founder = -1, fv = 0;
      for (let k = 0; k < S; k++) {
        if (k === t || !alive(sim, k) || sim.allied[k * S + t] || isPlayer(sim, k) || !(sim.contact[k * S + t] > 0)) continue;
        const th = threatOf(sim, t, k).score;
        if (th > 0.9 && th > fv) { fv = th; founder = k; }
      }
      if (founder >= 0) { const c = createCoalition(sim, founder, t, { goal: 'contain' }); if (c) recruit(sim, c); }
    }
  }
}

// ---------------- négociations : intérêts de la coalition dans une paix ----------------
// facteur ajouté à l'évaluation d'une paix par un membre : tant que les objectifs ne sont pas atteints, les
// membres poussent à continuer ; une coalition épuisée pousse à négocier.
export function coalitionPeaceFactor(sim, w, s) {
  const S = sim.S;
  const enemy = (w.a.includes(s) ? w.b : w.a);
  const c = activeCoalitions(sim).find((x) => memberOf(x, s) && enemy.includes(x.target));
  if (!c) return null;
  const terr = c.members.some((m) => m.interest === 'territory' || m.interest === 'victim');
  const tA = w.a.includes(c.target);
  const adv = tA ? (w.shareB || 0) - (w.shareA || 0) : (w.shareA || 0) - (w.shareB || 0);
  let v = (0.45 - c.cohesion) * 0.6;                    // coalition soudée : moins encline à négocier
  if (terr && adv < 0.02) v -= 0.25;                     // territoires à libérer
  if (adv > 0.15) v += 0.2;                              // objectifs en bonne voie : la paix devient acceptable
  void S;
  return { label: `Position de « ${c.name} »`, v: r2(v) };
}

// ---------------- sauvegarde ----------------
export function serializeCoalitions(sim) { return { list: coalitions(sim), id: sim._coalId || 0, scan: sim._nextCoalScan || 0, next: sim._nextCoal || 0 }; }
export function restoreCoalitions(sim, o) { if (!o) return; sim.coalitions = o.list || []; sim._coalId = o.id || 0; sim._nextCoalScan = o.scan || 0; sim._nextCoal = o.next || 0; }

export function coalitionSummary(sim, c) {
  const T = sim.sides[c.target];
  return {
    id: c.id, name: c.name, kind: KIND_LABELS[c.kind], goal: GOALS[c.goal], target: T ? T.name : '?', leader: sim.sides[c.leader] ? sim.sides[c.leader].name : '?',
    members: c.members.map((m) => ({ ...m, name: sim.sides[m.k].name, interestLabel: INTERESTS[m.interest] ? INTERESTS[m.interest].label : m.interest, power: powerOf(sim.sides[m.k]) })),
    cohesion: c.cohesion, power: coalitionPower(sim, c), targetPower: T ? powerOf(T) : 0, atWar: !!c.war, status: c.status,
  };
}
export const coalitionVerb = (c) => (c.goal === 'liberate' ? 'pour libérer' : c.goal === 'defeat' ? 'pour vaincre' : 'pour contenir');
void de;
