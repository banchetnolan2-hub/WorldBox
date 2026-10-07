// DIPLOMATIE — mémoire des négociations et paix contextualisée.
//  • Mémoire diplomatique par paire de pays (dans les deux sens) : propositions, refus, acceptations,
//    contre-propositions, traités, guerres, alliances, trahisons, échanges. Elle sert à éviter de
//    répéter la même demande sans raison et rend les IA plus ou moins confiantes.
//  • Demandes de paix analysées (situation militaire, territoire, économie, stabilité, durée, moral,
//    objectifs, rapport de force, relations, gains possibles) avec délais d'attente (cooldowns).
//  • Conditions de paix détaillées : territoires conservés ou rendus, réparations, trêve, conséquences ;
//    réponse : accepter, refuser ou contre-proposer. Les conditions sont appliquées au traité.
import { coalitionPeaceFactor } from './coalitions.js';
import { tn } from './tuning.js';
import { valueShare } from './territoryValue.js';
import { PERSONALITIES } from './profile.js';
import { addRel } from './wars.js';
import { YEAR_SEC } from './calendar.js';

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const r2 = (v) => Math.round(v * 100) / 100;

// ---------------- mémoire diplomatique ----------------
export function dmem(sim, a, b) {
  const m = sim.dmem || (sim.dmem = {});
  const k = `${a}>${b}`;
  return m[k] || (m[k] = { props: [], refused: 0, accepted: 0, countered: 0, byType: {}, events: [] });
}
// trace d'un fait diplomatique (traité, guerre, alliance, trahison, échange) pour les deux pays
export function dnote(sim, a, b, kind, text) {
  for (const [x, y] of [[a, b], [b, a]]) {
    const m = dmem(sim, x, y);
    m.events.push({ t: Math.round(sim.time), kind, text });
    if (m.events.length > 30) m.events.shift();
  }
}
// résultat d'une proposition de a vers b
export function noteProposal(sim, a, b, type, result, ctx = null) {
  const m = dmem(sim, a, b);
  const bt = m.byType[type] || (m.byType[type] = { n: 0, refused: 0, accepted: 0, last: -1e9, lastRefused: -1e9, ctx: null });
  bt.n++; bt.last = sim.time; bt.ctx = ctx;
  if (result === 'refuse') { bt.refused++; bt.lastRefused = sim.time; m.refused++; }
  else if (result === 'accept') { bt.accepted++; bt.refused = 0; m.accepted++; }
  else if (result === 'counter') m.countered++;
  m.props.push({ t: Math.round(sim.time), type, result });
  if (m.props.length > 25) m.props.shift();
}
// une proposition peut-elle être (re)faite ? délai, refus répétés, situation inchangée
export function canPropose(sim, a, b, type, ctx = null, opts = {}) {
  const bt = dmem(sim, a, b).byType[type];
  if (!bt) return { ok: true };
  const t = sim.time;
  const base = (opts.cooldown ?? 60) * (type === 'peace' ? tn(sim, 'peaceCooldown') : 1);   // ≈ 6 mois entre deux propositions du même type
  if (t - bt.last < base) return { ok: false, reason: 'délai' };
  if (bt.refused > 0) {
    const wait = base * (1 + bt.refused) * (opts.patience ?? 1);
    if (t - bt.lastRefused < wait) return { ok: false, reason: 'refus récent' };
    // même situation qu'au dernier refus : inutile de redemander (sauf très longtemps après)
    if (ctx && bt.ctx && !changed(ctx, bt.ctx) && t - bt.lastRefused < YEAR_SEC * 2.5) return { ok: false, reason: 'situation inchangée' };
  }
  return { ok: true, refused: bt.refused };
}
function changed(a, b) {
  return Math.abs((a.adv || 0) - (b.adv || 0)) > 0.07 || Math.abs((a.exh || 0) - (b.exh || 0)) > 0.15 || Math.abs((a.ratio || 1) - (b.ratio || 1)) > 0.3 || (a.crisis || 0) !== (b.crisis || 0);
}
// confiance de b envers a (historique) : -1 … +1
export function trustOf(sim, b, a) {
  const m = dmem(sim, a, b), back = dmem(sim, b, a);
  const betray = m.events.filter((e) => e.kind === 'betrayal').length;
  const treaties = m.events.filter((e) => e.kind === 'treaty' || e.kind === 'alliance' || e.kind === 'trade').length;
  return clamp(treaties * 0.08 - betray * 0.35 - Math.min(0.3, back.refused * 0.04) + Math.min(0.2, m.accepted * 0.03), -1, 1);
}

// ---------------- analyse d'une guerre ----------------
function heldKm2(sim, w) {
  const aSet = new Set(w.a), bSet = new Set(w.b);
  const geo = sim.geo;
  let byA = 0, byB = 0;
  for (const [c, pre] of w.changes) {
    const ps = sim.sideOf[pre], cs = sim.sideOf[sim.owner[c]];
    if (ps < 0 || cs < 0 || sim.owner[c] === pre) continue;
    const k = geo ? geo.km2[c] : 770;
    if (bSet.has(ps) && aSet.has(cs)) byA += k;
    else if (aSet.has(ps) && bSet.has(cs)) byB += k;
  }
  return { byA, byB };
}
// ---------------- revendications territoriales précises (régions) ----------------
// terms.territory === 'custom' : terms.claimant (côté qui annexe) et terms.claims (identifiants de régions).
// Les régions revendiquées passent au revendicateur (qu'elles soient déjà occupées ou non) ; tous les
// autres territoires qui ont changé de mains pendant la guerre retournent à leur propriétaire d'avant-guerre.
const kmOf = (sim, c) => (sim.geo ? sim.geo.km2[c] : 770);
export function regionCells(sim) {
  if (sim._regionCells) return sim._regionCells;
  const rc = new Map();
  const ro = sim.details && sim.details.regionOf;
  if (ro) for (let c = 0; c < sim.n; c++) { const r = ro[c]; if (r >= 0) { const l = rc.get(r); if (l) l.push(c); else rc.set(r, [c]); } }
  sim._regionCells = rc;
  return rc;
}
// régions que « claimant » peut revendiquer : régions des pays adverses, tenues par l'adversaire ou occupées
export function claimableRegions(sim, w, claimant) {
  if (!sim.details) return [];
  const mineA = w.a.includes(claimant);
  const friends = new Set((mineA ? w.a : w.b).map((k) => sim.sides[k].e));
  const enemies = new Set((mineA ? w.b : w.a).map((k) => sim.sides[k].e));
  const out = [];
  for (const [rid, cells] of regionCells(sim)) {
    const reg = sim.details.regions[rid];
    if (!reg || !enemies.has(reg.e)) continue;           // nos propres régions occupées nous reviennent de toute façon
    let ours = 0, theirs = 0;
    for (const c of cells) { const o = sim.owner[c]; if (friends.has(o)) ours += kmOf(sim, c); else if (enemies.has(o)) theirs += kmOf(sim, c); }
    if (!theirs && !ours) continue;
    out.push({ id: rid, name: reg.name || 'Région', e: reg.e, ours: Math.round(ours), theirs: Math.round(theirs), km2: Math.round(ours + theirs), occupied: ours / Math.max(1, ours + theirs) });
  }
  return out.sort((a, b) => a.e - b.e || b.occupied - a.occupied || a.name.localeCompare(b.name, 'fr'));
}
// transferts de parcelles qu'entraînent des conditions « régions choisies » : [[cellule, nouveau propriétaire]]
export function claimTransfers(sim, w, terms) {
  const out = [];
  out.claimed = new Set();
  const claimant = sim.sides[terms.claimant];
  if (!claimant || claimant.eliminated) return out;
  const members = new Set([...w.a, ...w.b]);
  const camp = new Set((w.a.includes(terms.claimant) ? w.a : w.b).map((k) => sim.sides[k].e));
  const enemy = new Set((w.a.includes(terms.claimant) ? w.b : w.a).map((k) => sim.sides[k].e));
  const claimed = out.claimed;
  const rc = regionCells(sim);
  for (const rid of terms.claims || []) for (const c of rc.get(rid) || []) {
    const o = sim.owner[c];
    if (!enemy.has(o) && !camp.has(o)) continue;          // jamais les territoires d'un pays tiers
    claimed.add(c);
    if (o !== claimant.e) out.push([c, claimant.e]);
  }
  // cessions : régions du camp du revendicateur laissées à l'adversaire (les autres sont restituées)
  if ((terms.cedes || []).length) {
    const otherList = (w.a.includes(terms.claimant) ? w.b : w.a).filter((k) => !sim.sides[k].eliminated);
    const lead = otherList.sort((x, y) => sim.sides[y].initial - sim.sides[x].initial)[0];
    if (lead !== undefined) {
      const le = sim.sides[lead].e;
      for (const rid of terms.cedes) {
        const reg = sim.details && sim.details.regions[rid];
        if (!reg || !camp.has(reg.e)) continue;
        for (const c of rc.get(rid) || []) {
          const o = sim.owner[c];
          if (!enemy.has(o) && !camp.has(o)) continue;
          claimed.add(c);
          if (!enemy.has(o)) out.push([c, le]);
        }
      }
    }
  }
  for (const [c, pre] of w.changes) {
    if (claimed.has(c) || sim.owner[c] === pre) continue;
    const cur = sim.sideOf[sim.owner[c]], ps = sim.sideOf[pre];
    if (cur < 0 || !members.has(cur) || ps < 0 || !members.has(ps) || sim.sides[ps].eliminated) continue;
    out.push([c, pre]);                                    // non revendiqué : rendu
  }
  out.claimed = claimed;
  return out;
}
// bilan (km²) des conditions « régions choisies » pour le camp du pays r
function claimBalance(sim, w, terms, r) {
  const camp = new Set((w.a.includes(r) ? w.a : w.b).map((k) => sim.sides[k].e));
  let gain = 0, loss = 0, untaken = 0;
  for (const [c, to] of claimTransfers(sim, w, terms)) {
    const from = sim.owner[c], k = kmOf(sim, c);
    if (camp.has(to) && !camp.has(from)) gain += k;
    else if (!camp.has(to) && camp.has(from)) { loss += k; if (to === sim.sides[terms.claimant].e && sim.details.regionOf[c] >= 0 && (terms.claims || []).includes(sim.details.regionOf[c])) untaken += k; }
  }
  return { gain, loss, untaken };
}

// contexte d'une guerre du point de vue du pays s
export function warContext(sim, w, s) {
  const sd = sim.sides[s];
  const mine = w.a.includes(s) ? 'a' : 'b';
  const adv = mine === 'a' ? (w.shareA || 0) - (w.shareB || 0) : (w.shareB || 0) - (w.shareA || 0);
  const enemies = mine === 'a' ? w.b : w.a;
  const friends = mine === 'a' ? w.a : w.b;
  const pw = (list) => list.reduce((t, k) => t + (sim.sides[k].eliminated ? 0 : (sim.sides[k].units * sim.sides[k].q + sim.sides[k].airPow * 2.2 + sim.sides[k].navPow * 0.8)), 0);
  const ratio = pw(friends) / Math.max(1e-6, pw(enemies));
  const pre = w.prewar[s] || 1;
  const trend = sd.ai && sd.ai.analysis ? sd.ai.analysis.cellsTrend : 0;
  const gdp0 = (w.before && w.before[s] && w.before[s].gdp) || sd.eco.gdp;
  const goal = sd.ai && sd.ai.objectives ? sd.ai.objectives.some((o) => o.type === 'conquer' && enemies.includes(o.target)) : false;
  return {
    adv: r2(adv), lostShare: r2(Math.max(0, (pre - sd.cells) / pre)), gainShare: r2(Math.max(0, (sd.cells - pre) / pre)),
    exh: r2(sd.exhaustion), gdpDrop: r2(Math.max(0, 1 - sd.eco.gdp / Math.max(0.1, gdp0))), stab: r2(sd.stability), dur: Math.round(sim.time - w.start),
    morale: r2(sd.morale), ratio: r2(ratio), crisis: sd.crisis ? 1 : 0, trend: r2(trend), goal, mine,
  };
}
// envie de paix d'un pays (≥ 0,55 : il cherche la paix) et facteurs lisibles
export function assessPeace(sim, w, s) {
  const sd = sim.sides[s];
  const P = PERSONALITIES[(sd.ai && sd.ai.personality) || 'opportunist'];
  const c = warContext(sim, w, s);
  const f = [];
  const add = (label, v) => { if (Math.abs(v) >= 0.03) f.push({ label, v: r2(v) }); };
  add('Lassitude de la guerre', c.exh * 1.3);
  add('Territoire perdu', c.lostShare * 1.6);
  add('Situation sur le terrain', -c.adv * 1.6);
  add('Économie affaiblie', c.gdpDrop * 2 + c.crisis * 0.5);
  add('Stabilité intérieure', (0.6 - c.stab) * 0.8);
  add('Durée du conflit', Math.min(0.45, c.dur / 330));
  add('Moral des troupes', (0.75 - c.morale) * 0.6);
  add('Rapport de force', c.ratio < 1 ? (1 - c.ratio) * 0.5 : -Math.min(0.5, (c.ratio - 1) * 0.25));
  add('Objectifs de guerre non atteints', c.goal && c.adv < 0.15 ? -0.25 : 0);
  add('Progression actuelle', c.trend > 0.004 ? -0.35 : c.trend < -0.004 ? 0.25 : 0);
  // position de la coalition dont le pays fait partie (objectifs, cohésion)
  const cf = coalitionPeaceFactor(sim, w, s);
  if (cf) add(cf.label, cf.v);
  // vainqueur dont l'avance est arrêtée (reste du pays ennemi hors de portée terrestre) : il faut consolider les gains
  if (c.adv > 0.3 && Math.abs(c.trend) < 0.002 && c.dur > 90) {
    const foes = (w.a.includes(s) ? w.b : w.a).filter((k) => !sim.sides[k].eliminated);
    const noLand = foes.every((k) => (sim.contact ? sim.contact[s * sim.S + k] : 0) < 4);
    add(noLand ? 'Adversaire hors de portée : gains à consolider' : 'Front figé : gains à consolider', Math.min(1.7, c.adv * (noLand ? 1.7 : 1.1) + 0.2));
  }
  let will = -0.15;
  for (const x of f) will += x.v;
  will *= P.peace;
  return { will: r2(will), ctx: c, factors: f.sort((a, b) => Math.abs(b.v) - Math.abs(a.v)) };
}

// ---------------- conditions de paix ----------------
// terms : { kind: 'ceasefire'|'treaty', territory: 'keep'|'restore', reparations: 0|Md$, payer: côté, truceYears, proposer: côté, war: id }
export function makePeaceTerms(sim, w, s, strategy = 'normal') {
  const c = warContext(sim, w, s);
  const sd = sim.sides[s];
  const enemyLead = (c.mine === 'a' ? w.b : w.a).find((k) => !sim.sides[k].eliminated);
  const t = { war: w.id, proposer: s, kind: 'ceasefire', territory: 'keep', reparations: 0, payer: -1, truceYears: 3 };
  if (c.adv > 0.08) {
    // en position de force : on garde les territoires, réparations possibles
    t.kind = 'treaty';
    if (c.adv > 0.25 && enemyLead !== undefined) { t.payer = enemyLead; t.reparations = Math.round(sim.sides[enemyLead].eco.gdp * 0.01 * tn(sim, 'reparations') * 10) / 10; }
    if (strategy === 'concede') { t.reparations = 0; t.payer = -1; }
  } else if (c.adv < -0.08) {
    // en difficulté : cessez-le-feu sur les lignes actuelles ; après des refus, concessions
    t.kind = 'ceasefire';
    if (strategy === 'concede') { t.kind = 'treaty'; t.payer = s; t.reparations = Math.round(sd.eco.gdp * 0.008 * 10) / 10; }
  } else {
    t.kind = 'treaty';
    t.territory = strategy === 'concede' ? 'restore' : 'keep';
  }
  t.truceYears = t.kind === 'ceasefire' ? 2 : 4;
  return t;
}
// ---------------- paix proportionnée ----------------
// Ce que le pays r peut raisonnablement céder (part de la valeur de son territoire) : territoire réellement
// perdu, situation sur le terrain, rapport de force, durée de la guerre, alliés, stabilité, lassitude.
// Une petite victoire militaire ne permet pas d'obtenir la moitié d'un pays.
export function cedeCapacity(sim, w, r) {
  const c = warContext(sim, w, r);
  const rd = sim.sides[r];
  const enemyE = new Set((w.a.includes(r) ? w.b : w.a).map((k) => sim.sides[k].e));
  const lost = valueShare(sim, r, (i) => enemyE.has(sim.owner[i]) && w.changes.has(i));
  const f = [];
  const add = (label, v) => { if (Math.abs(v) >= 0.005) f.push({ label, v: r2(v) }); };
  add('Territoire réellement perdu', lost);
  add('Situation sur le terrain', clamp(-c.adv, 0, 1) * 0.15);
  add('Rapport de force défavorable', c.ratio < 0.5 ? 0.06 : c.ratio < 0.8 ? 0.03 : 0);
  add('Durée de la guerre', Math.min(0.05, c.dur / YEAR_SEC * 0.02));
  add('Instabilité intérieure', c.stab < 0.35 ? 0.04 : 0);
  add('Lassitude de la guerre', c.exh > 0.6 ? 0.04 : 0);
  const friends = (w.a.includes(r) ? w.a : w.b).filter((k) => k !== r && !sim.sides[k].eliminated);
  add('Soutien de ses alliés', friends.length && c.ratio > 0.8 ? -0.04 : 0);
  let cap = 0.02;
  for (const x of f) cap += x.v;
  cap = clamp(cap * tn(sim, 'maxDemand'), 0.02, 0.75);
  cap = Math.max(cap, Math.min(0.95, lost + 0.01));   // ce qui est déjà perdu peut toujours être concédé (lignes actuelles)
  void rd;
  return { cap: r2(cap), lost: r2(lost), factors: f };
}
// part de la valeur du territoire de r qui passerait à l'adversaire avec ces conditions
export function demandShare(sim, w, r, terms) {
  const enemyE = new Set((w.a.includes(r) ? w.b : w.a).map((k) => sim.sides[k].e));
  const e = sim.sides[r].e;
  if (terms.territory === 'restore') return 0;
  let final = null;
  if (terms.territory === 'custom') { final = new Map(); for (const [c, to] of claimTransfers(sim, w, terms)) final.set(c, to); }
  return valueShare(sim, r, (i) => { const o = final && final.has(i) ? final.get(i) : sim.owner[i]; return enemyE.has(o) && (sim.owner[i] === e || w.changes.has(i)); });
}

// évaluation des conditions par le pays r (IA)
export function evaluatePeace(sim, w, r, terms) {
  const rd = sim.sides[r];
  const a = assessPeace(sim, w, r);
  const { byA, byB } = heldKm2(sim, w);
  const mine = w.a.includes(r) ? 'a' : 'b';
  const held = mine === 'a' ? byA : byB, lost = mine === 'a' ? byB : byA;
  const size = Math.max(1, rd.km2 || 1);
  const f = a.factors.slice(0, 5);
  let score = a.will - 0.35 + (tn(sim, 'peaceAccept') - 1) * 0.4;
  let terr = 0;
  let claimLabel = '';
  if (terms.territory === 'custom') {
    // régions choisies : céder une région encore tenue (non conquise) pèse deux fois plus lourd
    const b = claimBalance(sim, w, terms, r);
    terr = (b.gain - b.loss - b.untaken) / size * 3;
    claimLabel = b.untaken > 0 ? 'Régions revendiquées (dont des territoires non conquis)' : 'Régions revendiquées';
  } else if (terms.territory === 'keep') terr = (held - lost) / size * 3;
  else terr = (lost - held) / size * 3;            // statu quo d'avant-guerre : on récupère ses pertes, on rend ses gains
  terr = clamp(terr, -1.6, 1.2);
  if (Math.abs(terr) >= 0.03) f.push({ label: claimLabel || (terms.territory === 'keep' ? 'Lignes actuelles (territoires conservés)' : 'Retour aux frontières d\'avant-guerre'), v: r2(terr) });
  score += terr;
  // exigences territoriales comparées à ce que le pays peut céder (valeur, pas seulement superficie)
  let excess = 0, capInfo = null, demand = 0;
  if (terms.territory !== 'restore' && w.a.concat(w.b).includes(terms.proposer) && !(w.a.includes(r) && w.a.includes(terms.proposer)) && !(w.b.includes(r) && w.b.includes(terms.proposer))) {
    demand = demandShare(sim, w, r, terms);
    capInfo = cedeCapacity(sim, w, r);
    excess = demand - capInfo.cap;
    if (excess > 0.005) {
      const v = -Math.min(3, 0.5 + excess * 5);
      f.push({ label: `Exigences disproportionnées : ${Math.round(demand * 100)} % de la valeur du pays (acceptable au plus ${Math.round(capInfo.cap * 100)} %)`, v: r2(v) });
      score += v;
    }
  }
  if (terms.reparations > 0) {
    const v = clamp(terms.reparations / Math.max(0.5, rd.eco.gdp) * 9, 0, 1) * (terms.payer === r ? -1 : 1);
    f.push({ label: terms.payer === r ? 'Réparations à payer' : 'Réparations reçues', v: r2(v) });
    score += v;
  }
  const trust = trustOf(sim, r, terms.proposer);
  if (Math.abs(trust) >= 0.03) { f.push({ label: 'Confiance (historique)', v: r2(trust * 0.5) }); score += trust * 0.5; }
  if (terms.kind === 'ceasefire') { f.push({ label: 'Simple cessez-le-feu', v: -0.05 }); score -= 0.05; }
  let counter = null;
  if (score <= 0.15 && (score > -0.45 || (excess > 0.005 && score - Math.max(-3, -(0.5 + excess * 5)) > -0.45)) && sim.rules.negotiations !== false) {
    // contre-proposition : ce qui rendrait la paix acceptable pour r
    const c = { ...terms, proposer: r, counterOf: terms.proposer };
    if (terms.territory === 'custom' && terms.claimant !== r && (terms.claims || []).length) {
      // contre-proposition : seulement les régions réellement conquises, puis la moitié d'entre elles
      const regs = new Map(claimableRegions(sim, w, terms.claimant).map((x) => [x.id, x]));
      const won = terms.claims.filter((id) => regs.get(id) && regs.get(id).occupied >= 0.5);
      c.claims = won.length < terms.claims.length ? won : won.slice(0, Math.floor(won.length / 2));
      // exigences ramenées à ce que le pays peut céder : régions les mieux tenues d'abord
      if (capInfo) {
        const order = [...c.claims].sort((x, y) => (regs.get(y).occupied - regs.get(x).occupied) || (regs.get(x).km2 - regs.get(y).km2));
        while (order.length && demandShare(sim, w, r, { ...c, claims: order }) > capInfo.cap) order.pop();
        c.claims = order;
      }
    } else if (terms.territory === 'keep' && lost > held * 1.2) c.territory = 'restore';
    else if (terms.territory === 'restore' && held > lost * 1.2) c.territory = 'keep';
    else if (terms.payer === r) { c.reparations = Math.round(terms.reparations * 0.4 * 10) / 10; if (c.reparations < 0.1) { c.reparations = 0; c.payer = -1; } }
    else { const other = terms.proposer; c.payer = other; c.reparations = Math.round(Math.max(terms.reparations, sim.sides[other].eco.gdp * 0.006) * 10) / 10; }
    c.kind = 'treaty';
    if (JSON.stringify({ ...c, proposer: 0, counterOf: 0 }) !== JSON.stringify({ ...terms, proposer: 0, counterOf: 0 })) counter = c;
  }
  const result = score > 0.15 ? 'accept' : counter ? 'counter' : 'refuse';
  const factors = f.sort((x, y) => Math.abs(y.v) - Math.abs(x.v));
  // aucune proposition acceptable : explication claire
  let why = '';
  if (result === 'refuse') {
    const neg = factors.filter((x) => x.v < 0).slice(0, 3).map((x) => x.label.toLowerCase());
    why = `Aucune condition n'est acceptable pour ${rd.name} pour le moment${neg.length ? ` : ${neg.join(' ; ')}` : ''}.`
      + (capInfo ? ` Il pourrait céder au plus ${Math.round(capInfo.cap * 100)} % de la valeur de son territoire (il en a perdu ${Math.round(capInfo.lost * 100)} %).` : '')
      + ' Ce qui peut changer sa position : des gains militaires, une guerre plus longue, des exigences réduites ou une proposition de cessez-le-feu.';
  }
  return { result, score: r2(score), factors, counter, why, demand: r2(demand), cap: capInfo ? capInfo.cap : null };
}

// texte lisible des conditions, du point de vue du pays « viewer »
export function describeTerms(sim, w, terms, viewer) {
  const { byA, byB } = heldKm2(sim, w);
  const mine = w.a.includes(viewer) ? 'a' : 'b';
  const held = mine === 'a' ? byA : byB, lost = mine === 'a' ? byB : byA;
  const km = (v) => `${Math.round(v).toLocaleString('fr-FR')} km²`;
  const P = sim.sides[terms.proposer];
  const out = { title: '', proposed: [], kept: [], returned: [], conditions: [], consequences: [] };
  out.title = terms.kind === 'ceasefire' ? `${P.name} propose un cessez-le-feu.` : `${P.name} propose un traité de paix.`;
  if (terms.territory === 'custom') {
    const regs = new Map(claimableRegions(sim, w, terms.claimant).map((x) => [x.id, x]));
    const list = (terms.claims || []).map((id) => regs.get(id)).filter(Boolean);
    const youTake = (w.a.includes(viewer) ? w.a : w.b).includes(terms.claimant);
    const C = sim.sides[terms.claimant];
    const tot = list.reduce((a, x) => a + x.km2, 0), free = list.reduce((a, x) => a + x.theirs, 0);
    out.proposed.push(list.length ? `${youTake ? 'Vous annexez' : `${C.name} annexe`} ${list.length} région${list.length > 1 ? 's' : ''} : ${list.slice(0, 8).map((x) => x.name).join(', ')}${list.length > 8 ? '…' : ''}.` : 'Aucune région n\'est annexée.');
    if (list.length) out.kept.push(`${km(tot)} au total${free > 0 ? `, dont ${km(free)} ${youTake ? 'encore tenus par l\'adversaire' : 'que vous tenez encore'}` : ''}.`);
    if ((terms.cedes || []).length) {
      const own = new Map(claimableRegions(sim, w, (w.a.includes(terms.claimant) ? w.b : w.a).find((k) => !sim.sides[k].eliminated) ?? terms.claimant).map((x) => [x.id, x]));
      const ced = terms.cedes.map((id) => own.get(id)).filter(Boolean);
      const viewerGives = (w.a.includes(viewer) ? w.a : w.b).includes(terms.claimant);
      if (ced.length) out.proposed.push(`${viewerGives ? 'Vous cédez' : `${C.name} cède`} ${ced.length} région${ced.length > 1 ? 's' : ''} : ${ced.slice(0, 8).map((x) => x.name).join(', ')}${ced.length > 8 ? '…' : ''}.`);
    }
    out.returned.push('Tous les autres territoires occupés retournent à leur propriétaire d\'avant-guerre (restitution).');
  } else if (terms.territory === 'keep') {
    out.proposed.push('Les lignes de front actuelles deviennent les nouvelles frontières.');
    out.kept.push(held > 0 ? `Vous conservez ${km(held)} pris à l'adversaire.` : 'Vous ne conservez aucun territoire adverse.');
    if (lost > 0) out.kept.push(`L'adversaire conserve ${km(lost)} de votre territoire.`);
  } else {
    out.proposed.push('Retour aux frontières d\'avant-guerre.');
    if (held > 0) out.returned.push(`Vous rendez ${km(held)} occupés.`);
    if (lost > 0) out.returned.push(`Vous récupérez ${km(lost)} perdus pendant la guerre.`);
    if (!held && !lost) out.returned.push('Aucun territoire n\'a changé de mains.');
  }
  if (terms.reparations > 0) out.conditions.push(`${terms.payer === viewer ? 'Vous versez' : `${sim.sides[terms.payer].name} verse`} ${String(terms.reparations).replace('.', ',')} Md$ de réparations.`);
  out.conditions.push(`Trêve de ${terms.truceYears} an${terms.truceYears > 1 ? 's' : ''} : aucune nouvelle guerre entre les deux camps.`);
  if (terms.kind === 'ceasefire') out.conditions.push('Cessez-le-feu immédiat ; les zones occupées sont intégrées au traité.');
  out.consequences.push('Fin des combats et démobilisation progressive ; la lassitude de guerre diminue.');
  out.consequences.push(terms.territory === 'restore' ? 'Les relations s\'améliorent davantage (paix sans annexion).' : 'Les annexions laissent des revendications : relations durablement tendues.');
  if (terms.reparations > 0) out.consequences.push(terms.payer === viewer ? 'La trésorerie diminue ; la stabilité baisse légèrement.' : 'La trésorerie augmente.');
  return out;
}

// application : la guerre se termine selon les conditions (le traité les applique)
export function applyPeace(sim, w, terms, endWar) {
  if (!w || w.status !== 'active') return false;
  w.terms = { ...terms };
  const d = (w.shareA || 0) - (w.shareB || 0);
  let winner = terms.territory === 'keep' && Math.abs(d) > 0.1 ? (d > 0 ? 'a' : 'b') : null;
  if (terms.territory === 'custom' && ((terms.claims || []).length || (terms.cedes || []).length)) {
    const b = claimBalance(sim, w, terms, terms.claimant);
    const mine = w.a.includes(terms.claimant) ? 'a' : 'b';
    winner = b.gain >= b.loss ? mine : (mine === 'a' ? 'b' : 'a');
    if (Math.abs(b.gain - b.loss) < 1) winner = null;
  }
  endWar(sim, w, winner, 'peace');
  return true;
}
// réparations + relations après un traité aux conditions négociées (appelé par concludeTreaty)
export function settleTerms(sim, w) {
  const t = w.terms;
  if (!t) return null;
  const S = sim.S;
  const out = { territory: t.territory, kind: t.kind, reparations: 0, payer: null, receiver: null, truceYears: t.truceYears };
  if (t.reparations > 0 && t.payer >= 0 && !sim.sides[t.payer].eliminated) {
    const payer = sim.sides[t.payer];
    const recv = (w.a.includes(t.payer) ? w.b : w.a).find((k) => !sim.sides[k].eliminated);
    if (recv !== undefined) {
      const amt = Math.min(t.reparations, payer.money + payer.eco.gdp * 0.02);
      payer.money -= amt; if (payer.money < 0) { payer.debt += -payer.money; payer.money = 0; }
      sim.sides[recv].money += amt;
      payer.p.politics.stability = Math.max(5, payer.p.politics.stability - 2);
      out.reparations = Math.round(amt * 10) / 10; out.payer = payer.e; out.receiver = sim.sides[recv].e;
    }
  }
  const truce = sim.time + t.truceYears * YEAR_SEC;
  for (const x of w.a) for (const y of w.b) {
    sim.truce[x * S + y] = Math.max(sim.truce[x * S + y], truce); sim.truce[y * S + x] = Math.max(sim.truce[y * S + x], truce);
    if (t.territory === 'restore') addRel(sim, x, y, 15);
  }
  return out;
}
