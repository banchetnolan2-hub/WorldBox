// NATION SIMULATOR — un pays contrôlé par le joueur, tous les autres par l'IA, sur le même moteur.
// Ce module ajoute :
//  • les politiques du joueur (impôts, services publics, investissements, budget militaire, natalité,
//    posture militaire) reliées à l'économie mensuelle ;
//  • l'arbre de développement national (6 branches, coûts en % du PIB, durées en années) — utilisé
//    aussi par les IA, qui développent leur pays selon leur personnalité ;
//  • la diplomatie avec les IA : propositions, analyse par l'IA (facteurs), acceptation / refus /
//    contre-proposition, accords (commerce, non-agression, alliances), mémoire des refus et des trahisons,
//    offres et exigences venant des IA ;
//  • des décisions régulières liées à la situation du pays ;
//  • des événements mondiaux liés aux statistiques ; la chronologie annuelle du pays ; les scénarios.
// Tout est déterministe (générateur de la simulation) et sérialisable.
import { PERSONALITIES, UNIT_COST } from './profile.js';
import { tn } from './tuning.js';
import { MONTH_SEC, YEAR_SEC, fmtDate, dateParts } from './calendar.js';
import { startWar, joinWar, endWar, addRel, relationStatus } from './wars.js';
import { powerOf, aiLog } from './ai.js';
import { refreshCombat, landTotal } from './economy.js';
import { de } from './fr.js';
import { SCENARIOS, findScenario } from './scenarios.js';
import { evaluatePeace, makePeaceTerms, applyPeace, describeTerms, noteProposal, canPropose, dnote, trustOf, warContext } from './diplomacy.js';
import { TECHS, TECH_BY_ID, TECH_BRANCHES, BRANCH_BY_ID, FX_TEXT, affinity, techOpen, TERR_INDEX } from './techTree.js';
import { setStance } from './crises.js';
import { acceptSurrender, setPlayerGoals } from './warEnd.js';
import { yearExtras } from './insights.js';
import { createCoalition, coalitionById, evaluateJoin, joinCoalition, leaveCoalition, launchOffensive, memberOf, GOALS } from './coalitions.js';

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const pct = (v) => `${(v * 100).toFixed(1).replace('.', ',')} %`;

// ---------------- arbres technologiques (civil + militaire) ----------------
// défini dans techTree.js ; alias conservés pour l'interface et les sauvegardes
export const DEV_TREE = TECHS;
export const DEV_BY_ID = TECH_BY_ID;
export const DEV_BRANCHES = TECH_BRANCHES.map((b) => [b.id, b.label, b.icon]);
export const FX_LABELS = {
  gdp: (v) => `PIB +${Math.round(v * 100)} %`, growth: (v) => `Croissance +${(v * 100).toFixed(1).replace('.', ',')} pt/an`, income: (v) => `Recettes fiscales +${Math.round(v * 100)} %`,
  production: (v) => `Production +${v}`, efficiency: (v) => `Efficacité industrielle +${v}`, trade: (v) => `Commerce +${v}`, infra: (v) => `Infrastructures +${v}`,
  ports: (v) => `Ports +${v}`, speed: (v) => `Déplacements +${Math.round(v * 100)} %`, research: (v) => `Rendement de la recherche +${Math.round(v * 100)} %`, tech: (v) => `Technologie +${v}`,
  stability: (v) => `Stabilité +${v}`, diplo: (v) => `Influence diplomatique +${Math.round(v * 100)} %`, relAll: (v) => `Relations +${v} avec tous`, readiness: (v) => `Préparation +${Math.round(v * 100)} %`,
  fort: (v) => `Fortifications +${Math.round(v * 100)} %`, recruit: (v) => `Recrutement +${Math.round(v * 100)} %`, supply: (v) => `Ravitaillement +${Math.round(v * 100)} %`, equip: (v) => `Équipement +${v}`,
  air: (v) => `Aviation +${Math.round(v * 100)} %`, navy: (v) => `Marine +${Math.round(v * 100)} %`,
  ...FX_TEXT,
};

export const DIPLO_ACTIONS = {
  talk: { label: 'Discuter', icon: 'activity' },
  trade: { label: 'Proposer un accord commercial', icon: 'coins' },
  nap: { label: 'Proposer un pacte de non-agression', icon: 'shield' },
  alliance: { label: 'Proposer une alliance', icon: 'handshake' },
  aid: { label: 'Demander de l\'aide', icon: 'trending-up' },
  gift: { label: 'Améliorer les relations (aide financière)', icon: 'sparkles' },
  detente: { label: 'Réduire les tensions', icon: 'waves' },
  peace: { label: 'Négocier la paix', icon: 'scroll-text' },
  warGoals: { label: 'Objectifs de guerre', icon: 'crosshair' },
  war: { label: 'Déclarer la guerre', icon: 'swords' },
  cancel: { label: 'Rompre un accord', icon: 'x-circle' },
  coalInvite: { label: 'Inviter dans votre coalition', icon: 'users' },
  coalForm: { label: 'Former une coalition contre ce pays', icon: 'shield' },
  sanction: { label: 'Imposer des sanctions', icon: 'x-circle' },
  unsanction: { label: 'Lever les sanctions', icon: 'check' },
};

const HUMAN_DEALS = ['trade', 'nap', 'alliance', 'aid', 'detente', 'peace', 'talk'];
const pairKey = (a, b) => (a < b ? `${a}-${b}` : `${b}-${a}`);

// état propre à chaque joueur humain (plusieurs joueurs possibles en multijoueur)
const HUMAN_FIELDS = ['policy', 'baseTax', 'logs', 'offers', 'decision', 'nextDecisionAt', 'decisionsTaken', 'timeline', 'milestones', 'lastYear', 'mem', 'scenario', 'lastPeaceAt', 'pname'];

export class Nation {
  // Le « joueur courant » (this.player) est un CONTEXTE : par défaut le joueur principal (hôte) ; with(k, fn)
  // et at(k) exécutent une méthode pour un autre joueur humain. Les champs de HUMAN_FIELDS sont lus et écrits
  // dans l'état du joueur courant (this.humans[this.player]).
  constructor(sim, opts = {}, saved = null) {
    this.sim = sim;
    this.player = opts.player;
    this.scenarioId = opts.scenario || null;
    this.humans = {};
    if (saved) {
      if (saved.humans) {
        for (const [key, v] of Object.entries(saved)) if (!HUMAN_FIELDS.includes(key)) this[key] = v;
      } else {
        // ancienne sauvegarde (un seul joueur) : migration
        const st = {};
        for (const [key, v] of Object.entries(saved)) { if (HUMAN_FIELDS.includes(key)) st[key] = v; else this[key] = v; }
        this.humans = { [saved.player]: st };
      }
      this.sim = sim;
      for (const k of this.humanList()) if (sim.sides[k]) sim.sides[k].player = true;
      return;
    }
    this.deals = {};          // "a-b" -> { trade: true, nap: date de fin, since }
    this._id = 0;
    for (const s of sim.sides) s.dev = { done: [], active: {} };
    this._initHuman(this.player, opts);
  }

  // ---------------- joueurs humains ----------------
  _initHuman(k, opts = {}) {
    const sim = this.sim;
    const sd = sim.sides[k];
    this.humans[k] = {};
    this.with(k, () => {
      this.policy = { tax: 1, services: 1, invest: { ...sd.budget }, milPct: Math.round(sd.p.milBudget * 100) / 100, stance: 'balanced', family: 0 };
      this.baseTax = sd.p.taxRate;
      this.logs = {};           // côté -> [{ t, from, text, kind, result, factors }]
      this.offers = [];         // propositions reçues par ce joueur
      this.decision = null;     // décision en attente
      this.nextDecisionAt = sim.time + MONTH_SEC * 3;
      this.decisionsTaken = [];
      this.timeline = [];       // bilans annuels
      this.milestones = [];     // réformes, alliances, guerres… (chronologie nationale)
      this.lastYear = dateParts(sim.time, sim.cfg.startDay).y;
      this.mem = {};            // mémoire des IA envers ce joueur : côté -> { refused, declined, broken, gifts, asked, lastAsk }
      this.scenario = null;
      this.pname = opts.name || null;
      sd.player = true;
      if (opts.scenario) {
        const sc = findScenario(opts.scenario, opts.scenarioSpec);
        if (sc) { this.scenario = { id: sc.id, start: sim.time, status: 'running', done: {}, failed: false, notes: [] }; sc.setup(sim, k, this); }
      }
      this.snapshotYear(true);
      this.milestone('start', `Début de la partie : ${sd.name} en ${this.lastYear}.`);
    });
  }
  // un joueur humain rejoint la partie (multijoueur) : il prend la direction d'un pays dirigé par l'IA
  addHuman(k, name = null) {
    if (this.isHuman(k) || !this.sim.sides[k] || this.sim.sides[k].eliminated) return false;
    this._initHuman(k, { name });
    this.sim.chron('diplomacy', `${this.sim.sides[k].name} est désormais dirigé par ${name || 'un joueur'}.`, { e: [this.sim.sides[k].e] });
    return true;
  }
  // un joueur quitte la partie : l'IA reprend son pays
  removeHuman(k) {
    if (!this.isHuman(k) || k === this.player) return false;
    delete this.humans[k];
    const sd = this.sim.sides[k];
    sd.player = false;
    this.sim.chron('diplomacy', `L'IA reprend la direction de ${sd.name}.`, { e: [sd.e] });
    return true;
  }
  isHuman(k) { return !!(this.humans && this.humans[k]); }
  humanList() { return Object.keys(this.humans || {}).map(Number).sort((a, b) => a - b); }
  with(k, fn) {
    const prev = this.player;
    this.player = k;
    try { return fn(); } finally { this.player = prev; }
  }
  // vue de la nation pour le joueur k (méthodes et champs dans son contexte)
  at(k) {
    if (k === this.player || k === undefined || k === null) return this;
    const self = this;
    return new Proxy(self, {
      get(t, prop) {
        if (prop === '__base') return self;
        const v = self.with(k, () => t[prop]);
        return typeof v === 'function' ? (...a) => self.with(k, () => v.apply(t, a)) : v;
      },
      set(t, prop, val) { self.with(k, () => { t[prop] = val; }); return true; },
    });
  }

  get sd() { return this.sim.sides[this.player]; }
  serialize() { const { sim, ...rest } = this; return JSON.parse(JSON.stringify(rest)); }
  memOf(k) { return this.mem[k] || (this.mem[k] = { refused: 0, declined: 0, broken: 0, gifts: 0, asked: 0, lastAsk: -999, talks: 0 }); }
  deal(a, b) { return this.deals[pairKey(a, b)] || null; }
  setDeal(a, b, patch) { const k = pairKey(a, b); this.deals[k] = { ...(this.deals[k] || { since: this.sim.time }), ...patch }; }
  milestone(type, text) { if (!this.humans[this.player]) return; this.milestones.push({ t: Math.round(this.sim.time * 10) / 10, type, text }); if (this.milestones.length > 600) this.milestones.shift(); }
  log(k, from, text, kind = 'msg', extra = {}) {
    const l = this.logs[k] || (this.logs[k] = []);
    l.push({ t: Math.round(this.sim.time * 10) / 10, from, text, kind, ...extra });
    if (l.length > 80) l.shift();
  }

  // ---------------- politiques du joueur, appliquées avant chaque mois ----------------
  preMonth(k) {
    if (!this.isHuman(k)) return;
    if (k !== this.player) { this.with(k, () => this.preMonth(k)); return; }
    const sd = this.sim.sides[k];
    const pol = this.policy;
    sd.p.taxRate = clamp(this.baseTax * pol.tax * (1 + (sd.devIncome || 0)), 0.03, 0.7);
    sd.austerity = clamp(1 - pol.services, -0.4, 0.4);
    const t = pol.invest.research + pol.invest.infra + pol.invest.econ || 1;
    sd.budget = { research: pol.invest.research / t, infra: pol.invest.infra / t, econ: pol.invest.econ / t };
    sd.milTarget = pol.milPct / 100 * Math.max(0.1, sd.eco.gdp);
    // impôts et services publics : stabilité et croissance (effets lents)
    const pp = sd.p.politics;
    pp.stability = clamp(pp.stability - (pol.tax - 1) * 1.6 + (pol.services - 1) * 1.2 + (sd.crisis ? -0.4 : 0.05) + ((sd.unemp || 6) > 12 ? -0.25 : 0), 5, 99);
    sd.policyGrowth = (pol.services - 1) * 0.012 - (pol.tax - 1) * 0.02;
    sd.p.popGrowth = clamp((sd.basePopGrowth ?? (sd.basePopGrowth = sd.p.popGrowth)) + pol.family * 0.35, -1.5, 4);
    sd.stance = pol.stance;
  }

  // ---------------- chaque mois, pour chaque pays ----------------
  month(k) {
    const sim = this.sim;
    const sd = sim.sides[k];
    if (sd.eliminated) return;
    this._projects(k);
    // emploi et niveau de vie (indicateurs dérivés)
    const g = sd.series.length > 12 ? (sd.eco.gdp / Math.max(1, sd.series[Math.max(0, sd.series.length - 13)][2]) - 1) : 0.02;
    sd.growthRate = g;
    const uT = clamp(5 + 22 * (1 - sd.stability) - g * 140 + sd.austerity * 8 + (sd.crisis ? 5 : 0) + (sim.isAtWar(k) ? 2 : 0) - (sd.p.infra.roads - 50) / 25, 2, 35);
    sd.unemp = sd.unemp === undefined ? uT : sd.unemp + (uT - sd.unemp) * 0.25;
    sd.living = clamp(Math.round(20 * Math.log10(1 + sd.pc * 1000 / 400) * (0.85 + 0.15 * sd.stability) * (1 - sd.unemp / 200)), 1, 100);
    const human = this.isHuman(k);
    if (human) this.with(k, () => {
      // propositions sans réponse : considérées comme refusées à l'échéance
      for (const o of this.offers.filter((x) => sim.time > x.until)) this.answerOffer(o.id, false, true);
      this._decisions();
      if (this.scenario && this.scenario.status === 'running') this._scenarioCheck();
    });
    else for (const p of this.humanList()) if (!sim.sides[p].eliminated) this.with(p, () => this._aiDiplomacy(k));
    this._worldEvents(k);
    if (human) this.with(k, () => {
      const y = dateParts(sim.time, sim.cfg.startDay).y;
      if (y !== this.lastYear) { this.lastYear = y; this.snapshotYear(); this._yearlyReactions(); }
    });
  }

  // ---------------- arbre de développement ----------------
  canStart(k, id) {
    const sd = this.sim.sides[k];
    const n = DEV_BY_ID[id];
    if (!n || sd.dev.done.includes(id) || sd.dev.active[n.branch]) return false;
    if (!this.branchAllowed(n.branch) || !techOpen(this.sim, k, n)) return false;
    return n.req.every((r) => sd.dev.done.includes(r));
  }
  // branches de l'arbre autorisées par les règles de la partie
  branchAllowed(b) {
    const R = this.sim.rules;
    if (R.techTree === false) return false;
    const br = BRANCH_BY_ID[b];
    if (!br) return false;
    if (br.cat === 'mil') return R.milTech !== false;
    if (br.rule === 'ecoTech') return R.ecoTech !== false;
    if (br.rule === 'research') return R.research !== false;
    if (br.rule === 'trade') return R.trade !== false && R.ecoTech !== false;
    if (br.rule === 'diplo') return R.relations !== false || R.treaties !== false;
    return true;
  }
  // coût et durée : réduits dans les domaines où le pays est spécialisé
  costOf(k, id) {
    const sd = this.sim.sides[k]; const n = DEV_BY_ID[id];
    const aff = affinity(this.sim, k, n.branch);
    return { total: n.cost * Math.max(0.5, sd.eco.gdp) / aff * tn(this.sim, 'techCost'), months: Math.max(6, Math.round(n.years * 12 / Math.sqrt(aff) * tn(this.sim, 'techTime'))), aff };
  }
  startProject(k, id) {
    if (!this.canStart(k, id)) return false;
    const sd = this.sim.sides[k];
    const n = DEV_BY_ID[id];
    const c = this.costOf(k, id);
    sd.dev.active[n.branch] = { id, done: 0, months: c.months, monthly: c.total / c.months, paid: 0, total: c.total, stalled: false };
    if (this.isHuman(k)) { this.at(k).milestone('project', `Lancement du projet « ${n.name} ».`); this.sim.hist(k, 'reform', `Projet lancé : ${n.name}.`); }
    return true;
  }
  cancelProject(k, branch) { const sd = this.sim.sides[k]; delete sd.dev.active[branch]; }
  _projects(k) {
    const sim = this.sim;
    const sd = sim.sides[k];
    // entretien des technologies coûteuses (porte-avions, défense antimissile, protection sociale…)
    if (sd.techUpkeep && sim.rules.economy !== false) sd.money -= sd.techUpkeep * sd.eco.gdp / 12;
    // les IA choisissent leurs projets selon leur personnalité et leurs moyens
    if (!this.isHuman(k) && sd.ai && sim.rules.aiAdvanced !== false && sim.rng.next() < 0.35 * tn(sim, 'aiResearch')) this._aiPickProject(k);
    for (const [branch, a] of Object.entries(sd.dev.active)) {
      const R = sim.rules;
      // financement impossible : projet suspendu (sans dette autorisée, la trésorerie doit suffire)
      if (R.economy !== false && sd.money < a.monthly && (R.debt === false || sd.debt > sd.eco.gdp * 1.1)) { a.stalled = true; continue; }
      a.stalled = false;
      if (R.economy !== false) { sd.money -= a.monthly; a.paid += a.monthly; }
      if (sd.money < 0) { sd.debt += -sd.money; sd.money = 0; }
      a.done++;
      if (a.done >= a.months) {
        delete sd.dev.active[branch];
        sd.dev.done.push(a.id);
        this._applyFx(k, DEV_BY_ID[a.id].fx);
        this._applyCons(k, DEV_BY_ID[a.id].cons);
        const n = DEV_BY_ID[a.id];
        if (this.isHuman(k)) {
          this.at(k).milestone('reform', `Réforme achevée : ${n.name}.`);
          sim.hist(k, 'reform', `Réforme achevée : ${n.name}.`);
          sim._emit({ icon: '🏗️', title: 'DÉVELOPPEMENT', tone: 'good', side: k, text: `${n.name} : projet achevé. ${Object.entries(n.fx).map(([f, v]) => FX_LABELS[f] ? FX_LABELS[f](v) : '').filter(Boolean).join(', ')}.`, nation: true });
        } else if (n.tier >= 4) sim.chron('tech', `${sd.name} achève le projet « ${n.name} ».`, { e: [sd.e] });
      }
    }
  }
  _aiPickProject(k) {
    const sim = this.sim, sd = sim.sides[k];
    const P = PERSONALITIES[sd.ai.personality];
    if (sd.crisis || sd.money < sd.eco.gdp * 0.01) return;
    const war = sim.isAtWar(k);
    const W = {
      eco: P.econ, ind: (P.econ + P.mil) / 2, agri: P.econ * 0.8 + (sd.p.res.food < 40 ? 0.5 : 0), energy: P.econ * 0.9 + P.infra * 0.2, tech: P.tech, comp: P.tech * 0.9 + P.econ * 0.2,
      infra: P.infra, transp: P.infra * 0.9, com: P.econ * 0.9 + (P.trade || 0), edu: (P.tech + P.econ) / 2, med: 0.7 + P.econ * 0.2, diplo: P.ally * 0.8 + P.peace * 0.3,
      space: P.tech * 0.6, soc: 0.6 + P.econ * 0.2,
    };
    const milW = P.mil * (war ? 1.7 : 0.75);
    for (const b of TECH_BRANCHES) if (b.cat === 'mil') W[b.id] = milW * ({ nav: P.naval || 1, mtr: (P.naval || 1) * 0.8, doc: 1.1, def: 1.1, aad: P.fort * 0.7 + 0.3 }[b.id] || 1);
    let best = null, bv = 0;
    for (const n of DEV_TREE) {
      if (!this.canStart(k, n.id)) continue;
      const v = (W[n.branch] || 0.6) * affinity(sim, k, n.branch) ** 2 * (1.25 - n.tier * 0.11) * (n.spec ? 1.3 : 1) * (0.6 + sim.rng.next() * 0.8);
      if (v > bv) { bv = v; best = n; }
    }
    // nombre de projets simultanés selon la richesse du pays
    const maxActive = clamp(Math.round(1 + Math.log10(Math.max(1, sd.eco.gdp)) - (war ? 0 : 0.5)), 1, 4);
    if (best && Object.keys(sd.dev.active).length < maxActive) this.startProject(k, best.id);
  }
  _applyFx(k, fx) {
    const sd = this.sim.sides[k];
    const p = sd.p;
    const R = this.sim.rules;
    for (const [f, v] of Object.entries(fx)) {
      if (R.milTech === false && (f === 'equip' || f === 'air' || f === 'navy')) continue;
      if (R.trade === false && f === 'trade') continue;
      if (f === 'gdp') sd.gdpBase *= 1 + v;
      else if (f === 'growth') sd.devGrowth = (sd.devGrowth || 0) + v;
      else if (f === 'income') { sd.devIncome = (sd.devIncome || 0) + v; if (!this.isHuman(k)) p.taxRate *= 1 + v; }
      else if (f === 'production') p.production = clamp(p.production + v, 1, 100);
      else if (f === 'efficiency') p.efficiency = clamp(p.efficiency + v, 1, 100);
      else if (f === 'trade') p.trade = clamp(p.trade + v, 1, 100);
      else if (f === 'infra') { for (const key of ['roads', 'rail', 'airports', 'cities']) p.infra[key] = clamp(p.infra[key] + v, 1, 100); }
      else if (f === 'ports') p.infra.ports = clamp(p.infra.ports + v, 0, 100);
      else if (f === 'speed') sd.speedK *= 1 + v;
      else if (f === 'research') sd.devResearch = (sd.devResearch || 0) + v;
      else if (f === 'tech') p.tech = clamp(p.tech + v, 1, 100);
      else if (f === 'stability') p.politics.stability = clamp(p.politics.stability + v, 1, 99);
      else if (f === 'diplo') sd.devDiplo = (sd.devDiplo || 0) + v;
      else if (f === 'relAll') { for (let o = 0; o < this.sim.S; o++) if (o !== k && !this.sim.atWar[k * this.sim.S + o]) addRel(this.sim, k, o, v); }   // accolades : sans elles, les effets suivants n'étaient jamais appliqués
      else if (f === 'readiness') sd.devReadiness = (sd.devReadiness || 0) + v;
      else if (f === 'fort') sd.devFort = (sd.devFort || 0) + v;
      else if (f === 'recruit') sd.devRecruit = (sd.devRecruit || 0) + v;
      else if (f === 'supply') sd.supplyLvl = Math.min(1.2, sd.supplyLvl + v);
      else if (f === 'equip') p.equip = clamp(p.equip + v, 1, 100);
      else if (f === 'air') { sd.air *= 1 + v; sd.initialAir *= 1 + v; }
      else if (f === 'navy') { sd.navy *= 1 + v; sd.initialNavy *= 1 + v; }
      // ---- effets des arbres civil et militaire ----
      else if (f === 'food') { p.politics.stability = clamp(p.politics.stability + v, 1, 99); sd.devGrowth = (sd.devGrowth || 0) + 0.0005 * v; if (p.res) p.res.food = clamp(p.res.food + v * 4, 1, 99); }
      else if (f === 'energy') { sd.gdpBase *= 1 + 0.008 * v; p.production = clamp(p.production + v * 1.5, 1, 100); if (p.res) p.res.energy = clamp(p.res.energy + v * 3, 1, 99); }
      else if (f === 'health') { p.popGrowth += 0.04 * v; sd.basePopGrowth = (sd.basePopGrowth ?? p.popGrowth) + 0.04 * v; p.politics.stability = clamp(p.politics.stability + v, 1, 99); }
      else if (f === 'popGrowth') { p.popGrowth += v; sd.basePopGrowth = (sd.basePopGrowth ?? p.popGrowth) + v; }
      else if (f === 'prestige') { sd.devDiplo = (sd.devDiplo || 0) + v * 0.02; for (let o = 0; o < this.sim.S; o++) if (o !== k && !this.sim.atWar[k * this.sim.S + o]) addRel(this.sim, k, o, v * 0.5); }
      else if (f === 'atk') sd.techAtk = (sd.techAtk || 1) * (1 + v);
      else if (f === 'def') sd.techDef = (sd.techDef || 1) * (1 + v);
      else if (f === 'atkTerr' || f === 'defTerr') { const key = f === 'atkTerr' ? 'techAtkT' : 'techDefT'; if (!sd[key]) sd[key] = [1, 1, 1, 1, 1, 1]; for (const [b, x] of Object.entries(v)) sd[key][TERR_INDEX[b]] *= 1 + x; }
      else if (f === 'artillery') sd.artillery = Math.min(0.6, (sd.artillery || 0) + v);
      else if (f === 'airDef') sd.airDef = Math.min(0.7, (sd.airDef || 0) + v);
      else if (f === 'intel') sd.intel = Math.min(0.5, (sd.intel || 0) + v);
      else if (f === 'sof') sd.sof = Math.min(0.6, (sd.sof || 0) + v);
      else if (f === 'sealift') sd.techSealift = (sd.techSealift || 0) + v;
      else if (f === 'seaRange') sd.techRange = (sd.techRange || 0) + v;
      else if (f === 'landing') sd.landingK = Math.min(0.8, (sd.landingK || 0) + v);
      else if (f === 'convoy') sd.convoyK = Math.min(0.7, (sd.convoyK || 0) + v);
      else if (f === 'blockade') sd.blockadeK = (sd.blockadeK || 0) + v;
      else if (f === 'blockadeRes') sd.blockadeRes = Math.min(0.8, (sd.blockadeRes || 0) + v);
      else if (f === 'airlift') sd.airlift = (sd.airlift || 0) + v;
      else if (f === 'casualties') sd.casualtyK = Math.max(-0.5, (sd.casualtyK || 0) + v);
      else if (f === 'morale') { sd.moraleBonus = (sd.moraleBonus || 0) + v; sd.morale = Math.min(1.25, sd.morale + v); }
      else if (f === 'mobilization') sd.manpower *= 1 + v;
    }
    refreshCombat(sd);
  }
  // conséquences d'une technologie achevée : entretien permanent, inquiétude des voisins, instabilité
  _applyCons(k, cons) {
    if (!cons) return;
    const sim = this.sim, sd = sim.sides[k], S = sim.S;
    if (cons.upkeep) sd.techUpkeep = (sd.techUpkeep || 0) + cons.upkeep;
    if (cons.stability) sd.p.politics.stability = clamp(sd.p.politics.stability + cons.stability, 1, 99);
    if (cons.tension && sim.rules.relations !== false) for (let o = 0; o < S; o++) if (o !== k && (sim.contact[k * S + o] || sim.nearCap[k * S + o]) && !sim.allied[k * S + o]) addRel(sim, k, o, -cons.tension);
  }

  // ---------------- diplomatie ----------------
  // analyse d'une proposition par l'IA du pays « to » ; retourne la décision et les facteurs
  evaluate(from, to, type, terms = {}) {
    const sim = this.sim, S = sim.S;
    const A = sim.sides[from], B = sim.sides[to];
    const P = PERSONALITIES[B.ai.personality];
    const rel = sim.rel[to * S + from];
    const mem = this.isHuman(from) ? this.at(from).memOf(to) : { refused: 0, declined: 0, broken: 0, gifts: 0, asked: 0, lastAsk: -999 };
    const ratio = powerOf(A) / Math.max(1e-6, powerOf(B));
    const atWar = sim.atWar[to * S + from] > 0;
    const allied = sim.allied[to * S + from] === 1;
    let common = null;
    for (let e = 0; e < S; e++) if (e !== from && e !== to && sim.atWar[to * S + e] && (sim.atWar[from * S + e] || sim.rel[from * S + e] < -40)) { common = e; break; }
    const deal = this.deal(from, to) || {};
    const f = [];
    const add = (label, v) => { if (Math.abs(v) >= 0.02) f.push({ label, v: Math.round(v * 100) / 100 }); };
    add(`Relations (${Math.round(rel)})`, rel / 90);
    const trust = (-mem.broken * 0.35 - Math.min(0.35, mem.refused * 0.06) + Math.min(0.25, mem.gifts * 0.04)) * tn(sim, 'dipMemory');
    add('Confiance (historique de vos échanges)', trust);
    const spam = sim.time - mem.lastAsk < MONTH_SEC * 4 ? -0.2 * Math.min(3, mem.asked) : 0;
    add('Sollicitations répétées', spam);
    const diplo = (A.devDiplo || 0) * 0.8;
    add('Votre influence diplomatique', diplo);
    let score = 0.25 + rel / 90 + trust + spam + diplo + (tn(sim, 'dipOpenness') - 1) * 0.5;
    let counter = null;
    const R = sim.rules;
    const off = (type === 'alliance' && R.alliances === false) || ((type === 'trade' || type === 'nap') && R.treaties === false) || (type === 'trade' && R.trade === false)
      || (type === 'peace' && R.peace === false) || (type === 'aid' && terms.military && R.alliances === false) || (type !== 'peace' && R.negotiations === false);
    if (off) return { result: 'refuse', score: -9, factors: [{ label: 'Désactivé par les règles de la partie', v: 0 }], counter: null };
    if (atWar && type !== 'peace' && type !== 'talk') { add('Vous êtes en guerre', -2); score -= 2; }
    if (type === 'trade') {
      const benefit = (A.p.trade / 100) * 0.35 + (B.p.trade / 100) * 0.25;
      add('Intérêt économique', benefit); add(`Personnalité : ${P.label}`, (P.econ - 1) * 0.35);
      score += benefit + (P.econ - 1) * 0.35 - (B.ai.personality === 'isolationist' ? 0.3 : 0);
      if (deal.trade) { score = -9; f.push({ label: 'Accord déjà en vigueur', v: 0 }); }
      if (score > 0.25 && score <= 0.6) counter = { type: 'trade', terms: { fee: Math.round(A.eco.gdp * 0.002 * 10) / 10 }, text: `Nous accepterions contre une contribution de ${terms.fee || Math.round(A.eco.gdp * 0.002 * 10) / 10} Md$ pour l'ouverture de nos marchés.` };
    } else if (type === 'nap') {
      const fear = ratio > 1.3 ? 0.3 : 0;
      add('Votre puissance militaire', fear);
      add(`Personnalité : ${P.label}`, (P.peace - 1) * 0.4 - (P.expand > 1.3 && ratio < 0.8 ? 0.4 : 0));
      score += fear + (P.peace - 1) * 0.4 - (P.expand > 1.3 && ratio < 0.8 ? 0.4 : 0);
      if (deal.nap && deal.nap > sim.time) score = -9;
    } else if (type === 'alliance') {
      const ce = common !== null ? 0.5 : 0;
      add(common !== null ? `Ennemi commun : ${sim.sides[common].name}` : 'Pas d\'ennemi commun', ce);
      add(`Personnalité : ${P.label}`, (P.ally - 1) * 0.5 - (B.ai.personality === 'isolationist' ? 0.6 : 0));
      const risk = sim.isAtWar(from) && !common ? -0.35 : 0;
      add('Risque d\'être entraîné dans vos guerres', risk);
      const needTrade = !deal.trade ? -0.15 : 0.1;
      add(deal.trade ? 'Partenaires commerciaux' : 'Aucun accord commercial', needTrade);
      score += ce + (P.ally - 1) * 0.5 - (B.ai.personality === 'isolationist' ? 0.6 : 0) + risk + needTrade - 0.25;
      if (rel < 10) { add('Relations insuffisantes pour une alliance', -0.4); score -= 0.4; }
      if (allied) { score = -9; f.unshift({ label: 'Nos pays sont déjà alliés', v: 0 }); }
      if (score > 0.25 && score <= 0.6 && !deal.trade) counter = { type: 'trade', terms: {}, text: 'Commençons par un accord commercial ; une alliance pourra suivre.' };
    } else if (type === 'aid') {
      const amount = terms.amount || Math.round(B.eco.gdp * 0.004 * 10) / 10;
      const rich = B.money > amount * 3 ? 0.15 : -0.4;
      add('Moyens disponibles', rich); add(allied ? 'Alliés' : 'Pas d\'alliance', allied ? 0.35 : -0.15); add(`Personnalité : ${P.label}`, (P.ally - 1) * 0.3);
      score += rich + (allied ? 0.35 : -0.15) + (P.ally - 1) * 0.3 - 0.1;
      if (terms.military) { const m = sim.isAtWar(to) ? -0.4 : 0; add('Déjà engagé dans un conflit', m); score += m - 0.15; }
      if (score > 0.3 && score <= 0.6 && !terms.military) counter = { type: 'aid', terms: { amount: Math.round(amount * 0.5 * 10) / 10 }, text: `Nous pouvons accorder la moitié : ${Math.round(amount * 0.5 * 10) / 10} Md$.` };
    } else if (type === 'detente') {
      add(`Personnalité : ${P.label}`, (P.peace - 1) * 0.4);
      score += 0.25 + (P.peace - 1) * 0.4;
      if (rel > 40) { score = -9; f.push({ label: 'Aucune tension à réduire', v: 0 }); }
    } else if (type === 'peace') {
      const w = this.warWith(from, to);
      if (!w) return { result: 'refuse', score: -9, factors: [{ label: 'Pas de guerre en cours', v: 0 }] };
      const t = { ...makePeaceTerms(sim, w, from), ...(terms.terms || {}), proposer: from, war: w.id };
      const ev = evaluatePeace(sim, w, to, t);
      return { result: ev.result, score: ev.score, factors: ev.factors, counter: ev.counter ? { type: 'peace', terms: { terms: ev.counter }, text: this._peaceText(w, ev.counter, from) } : null, peace: t };
    }
    if (R.negotiations === false) counter = null;
    const result = score > 0.6 ? 'accept' : counter ? 'counter' : 'refuse';
    return { result, score, factors: f.sort((a, b) => Math.abs(b.v) - Math.abs(a.v)), counter };
  }

  // action du joueur envers un autre pays (retourne un compte rendu pour l'interface)
  propose(to, type, terms = {}) {
    const sim = this.sim, k = this.player, S = sim.S;
    const A = sim.sides[k], B = sim.sides[to];
    const mem = this.memOf(to);
    const label = DIPLO_ACTIONS[type].label;
    this.log(to, 'player', terms.text || label + (terms.amount ? ` (${terms.amount} Md$)` : '') + '.', 'proposal');
    // pays dirigé par un autre joueur humain : la proposition lui est transmise, il décide lui-même
    if (this.isHuman(to) && to !== k && HUMAN_DEALS.includes(type)) return this._proposeHuman(to, type, terms);
    let out;
    if (type === 'talk') {
      mem.talks++;
      if (sim.rel[k * S + to] < 60 && mem.talks <= 3) addRel(sim, k, to, 2);
      const ai = B.ai;
      const obj = ai.objectives && ai.objectives[0];
      const st = relationStatus(sim, to, k);
      const mood = st === 'ally' ? 'Nos deux pays sont alliés.' : st === 'war' ? 'Nos pays sont en guerre.' : sim.rel[to * S + k] > 25 ? 'Nous voyons votre pays comme un partenaire.' : sim.rel[to * S + k] < -25 ? 'Nous observons votre politique avec méfiance.' : 'Nos relations sont correctes.';
      const fear = powerOf(A) > powerOf(B) * 1.8 ? ' Votre puissance militaire nous inquiète.' : '';
      const goal = obj ? ` Notre priorité : ${{ conquer: 'remporter la guerre', defend: 'défendre notre territoire', peace: 'obtenir la paix', consolidate: 'consolider nos gains', rebuild: 'redresser notre économie', modernize: 'moderniser notre pays', navy: 'développer notre marine', expand: 'renforcer notre influence', alliance: 'trouver des alliés', prosper: 'la prospérité', fortify: 'protéger nos frontières' }[obj.type] || 'notre développement'}.` : '';
      const wants = !(this.deal(k, to) || {}).trade && B.p.trade > 50 && sim.rel[to * S + k] > 0 ? ' Un accord commercial nous intéresserait.' : '';
      out = { result: 'info', text: `${mood}${fear}${goal}${wants}`, factors: [] };
    } else if (type === 'gift') {
      const amount = Math.max(0.1, terms.amount || Math.round(A.eco.gdp * 0.002 * 10) / 10);
      if (A.money < amount) return this._reply(to, { result: 'refuse', text: 'Fonds insuffisants pour cette aide.', factors: [] });
      A.money -= amount; B.money += amount;
      const gain = clamp(amount / Math.max(1, B.eco.gdp) * 2500, 2, 18) * (1 + (A.devDiplo || 0));
      addRel(sim, k, to, gain); mem.gifts++;
      out = { result: 'accept', text: `Nous apprécions ce geste. (relations +${Math.round(gain)})`, factors: [] };
    } else if (type === 'war') {
      return this.declareWar(to);
    } else if (type === 'cancel') {
      const d = this.deal(k, to) || {};
      if (sim.allied[k * S + to]) { sim.allied[k * S + to] = sim.allied[to * S + k] = 0; this.milestone('diplo', `Fin de l'alliance avec ${B.name}.`); }
      if (d.trade) this.setDeal(k, to, { trade: false });
      if (d.nap && d.nap > sim.time) { this.setDeal(k, to, { nap: 0 }); mem.broken++; dnote(sim, k, to, 'betrayal', 'Pacte de non-agression rompu'); }
      addRel(sim, k, to, -20);
      this._refreshTrade();
      out = { result: 'info', text: 'Nous prenons acte de la rupture de nos accords. Cela ne sera pas oublié.', factors: [] };
    } else {
      const ev = this.evaluate(k, to, type, terms);
      mem.asked = sim.time - mem.lastAsk < MONTH_SEC * 4 ? mem.asked + 1 : 1; mem.lastAsk = sim.time;
      noteProposal(sim, k, to, type, ev.result);
      out = { ...ev, text: '' };
      if (ev.result === 'accept') { this._apply(k, to, type, type === 'peace' ? { terms: ev.peace } : terms); out.text = this._acceptText(type, terms); }
      else if (ev.result === 'counter') out.text = ev.counter.text;
      else { out.text = this._refuseText(type, ev); mem.declined++; }
    }
    return this._reply(to, out, type, terms);
  }
  _proposeHuman(to, type, terms) {
    const sim = this.sim, k = this.player, A = sim.sides[k], B = sim.sides[to];
    const who = (this.humans[to] && this.humans[to].pname) || 'le joueur';
    if (type === 'talk') return this._reply(to, { result: 'info', text: `${B.name} est dirigé par ${who} : utilisez la messagerie multijoueur pour lui écrire.`, factors: [] }, type, terms);
    const R = sim.rules;
    const off = (type === 'alliance' && R.alliances === false) || ((type === 'trade' || type === 'nap') && R.treaties === false) || (type === 'trade' && R.trade === false) || (type === 'peace' && R.peace === false) || R.negotiations === false;
    if (off) return this._reply(to, { result: 'refuse', text: 'Désactivé par les règles de la partie.', factors: [] }, type, terms);
    const label = DIPLO_ACTIONS[type].label;
    if (type === 'peace') {
      const w = this.warWith(k, to);
      if (!w) return this._reply(to, { result: 'refuse', text: 'Aucune guerre en cours avec ce pays.', factors: [] }, type, terms);
      const t = { ...((terms && terms.terms) || makePeaceTerms(sim, w, k)), proposer: k, war: w.id };
      this.at(to).offer(k, 'peace', { terms: t, war: w.id, human: true }, `${A.name} (${(this.humans[k] && this.humans[k].pname) || 'joueur'}) ${t.kind === 'ceasefire' ? 'propose un cessez-le-feu' : 'propose un traité de paix'}.`);
    } else {
      if (this.at(to).offers.some((o) => o.from === k && o.type === type)) return this._reply(to, { result: 'info', text: 'Une proposition identique attend déjà sa réponse.', factors: [] }, type, terms);
      this.at(to).offer(k, type, { ...terms, human: true }, `${A.name} (${(this.humans[k] && this.humans[k].pname) || 'joueur'}) : ${label.toLowerCase()}${terms.amount ? ` (${terms.amount} Md$)` : ''}${terms.military ? ' (entrée en guerre à ses côtés)' : ''}.`);
    }
    return this._reply(to, { result: 'info', text: `Proposition transmise à ${who}. En attente de sa réponse.`, factors: [] }, type, terms);
  }
  _reply(to, out, type, terms) {
    this.log(to, 'ai', out.text, out.result, { factors: out.factors, counter: out.counter || null, type, terms });
    return out;
  }
  // le joueur accepte la contre-proposition de l'IA
  acceptCounter(to, counter) {
    const sim = this.sim, k = this.player;
    const A = sim.sides[k];
    const t = counter.terms || {};
    const fee = counter.type === 'peace' ? 0 : t.fee || t.reparations || 0;
    if (fee && A.money < fee) return this._reply(to, { result: 'refuse', text: 'Vous ne disposez pas de cette somme.', factors: [] });
    if (fee) { A.money -= fee; sim.sides[to].money += fee; }
    this.log(to, 'player', 'Nous acceptons votre contre-proposition.', 'proposal');
    if (counter.type === 'aid') { this._apply(k, to, 'aid', t); return this._reply(to, { result: 'accept', text: `Aide de ${t.amount} Md$ versée.`, factors: [] }); }
    this._apply(k, to, counter.type, t);
    return this._reply(to, { result: 'accept', text: this._acceptText(counter.type, t), factors: [] });
  }
  _apply(k, to, type, terms) {
    const sim = this.sim, S = sim.S;
    const A = sim.sides[k], B = sim.sides[to];
    if (type === 'trade') { this.setDeal(k, to, { trade: true }); addRel(sim, k, to, 8); this.milestone('diplo', `Accord commercial avec ${B.name}.`); sim.chron('diplomacy', `Accord commercial entre ${A.name} et ${B.name}.`, { e: [A.e, B.e] }); this._refreshTrade(); }
    else if (type === 'nap') { this.setDeal(k, to, { nap: sim.time + YEAR_SEC * 5 }); addRel(sim, k, to, 10); sim.truce[k * S + to] = sim.truce[to * S + k] = Math.max(sim.truce[k * S + to], sim.time + YEAR_SEC * 5); this.milestone('diplo', `Pacte de non-agression avec ${B.name} (5 ans).`); sim.chron('diplomacy', `Pacte de non-agression entre ${A.name} et ${B.name}.`, { e: [A.e, B.e] }); }
    else if (type === 'alliance') { sim.allied[k * S + to] = sim.allied[to * S + k] = 1; addRel(sim, k, to, 15); this.milestone('alliance', `Alliance avec ${B.name}.`); sim.chron('alliance', `Alliance entre ${A.name} et ${B.name}.`, { e: [A.e, B.e] }); sim.hist(k, 'alliance', `Alliance avec ${B.name}.`); sim.hist(to, 'alliance', `Alliance avec ${A.name}.`); }
    else if (type === 'aid') {
      if (terms.military) {
        for (const w of sim.activeWars) if (w.status === 'active' && (w.a.includes(k) || w.b.includes(k))) { joinWar(sim, w, to, w.a.includes(k) ? 'a' : 'b'); break; }
      } else { const amt = terms.amount || Math.round(B.eco.gdp * 0.004 * 10) / 10; B.money -= amt; A.money += amt; this.milestone('diplo', `Aide financière de ${B.name} : ${amt} Md$.`); }
    } else if (type === 'detente') { addRel(sim, k, to, 12); A.p.politics.stability = Math.min(99, A.p.politics.stability + 0.5); }
    else if (type === 'peace') {
      const w = this.warWith(k, to);
      if (w) {
        const t = (terms && terms.terms) || makePeaceTerms(sim, w, k);
        applyPeace(sim, w, { ...t, war: w.id }, endWar);
        this.milestone('treaty', `${t.kind === 'ceasefire' ? 'Cessez-le-feu' : 'Paix'} avec ${B.name} : ${t.territory === 'restore' ? 'retour aux frontières d\'avant-guerre' : 'lignes actuelles'}${t.reparations > 0 ? `, réparations ${t.reparations} Md$` : ''}.`);
      }
    }
    if (type === 'alliance' || type === 'trade' || type === 'nap') dnote(sim, k, to, type === 'alliance' ? 'alliance' : type === 'trade' ? 'trade' : 'treaty', `Accord : ${type}`);
  }
  warWith(a, b) { return this.sim.wars.find((x) => x.status === 'active' && ((x.a.includes(a) && x.b.includes(b)) || (x.b.includes(a) && x.a.includes(b)))) || null; }
  _peaceText(w, t, viewer) {
    const d = describeTerms(this.sim, w, t, viewer);
    return [d.title.replace(/^.*? propose/, 'Nous proposons'), ...d.proposed, ...d.returned, ...d.conditions].join(' ');
  }
  _acceptText(type, t) {
    return { trade: 'Accord commercial conclu. Nos marchés vous sont ouverts.', nap: 'Pacte de non-agression signé pour cinq ans.', alliance: 'Alliance conclue. Nos destins sont liés.', aid: t && t.military ? 'Nous entrons en guerre à vos côtés.' : 'Aide accordée.', detente: 'Nous acceptons de réduire les tensions entre nos pays.', peace: 'La paix est acceptée. Les négociations du traité commencent.' }[type] || 'Accepté.';
  }
  _refuseText(type, ev) {
    const worst = ev.factors.filter((f) => f.v < 0)[0];
    const why = worst ? ` (${worst.label.toLowerCase()})` : '';
    return { trade: 'Nous ne souhaitons pas d\'accord commercial pour le moment', nap: 'Nous ne voulons pas nous engager', alliance: 'Une alliance n\'est pas dans notre intérêt', aid: 'Nous ne pouvons pas vous aider', detente: 'Nous ne voyons pas de raison de changer notre position', peace: 'Nous refusons la paix dans ces conditions' }[type] + why + '.';
  }
  declareWar(to) {
    const sim = this.sim, k = this.player, S = sim.S;
    const B = sim.sides[to];
    const d = this.deal(k, to) || {};
    if (sim.atWar[k * S + to]) return this._reply(to, { result: 'info', text: 'Nos pays sont déjà en guerre.', factors: [] });
    if (sim.rules.wars === false) return this._reply(to, { result: 'refuse', text: 'Les guerres sont désactivées dans les règles de cette partie.', factors: [] });
    if (d.nap && d.nap > sim.time) { this.memOf(to).broken++; dnote(sim, k, to, 'betrayal', 'Pacte de non-agression violé par une déclaration de guerre'); for (let o = 0; o < S; o++) if (o !== k) addRel(sim, k, o, -6); }
    sim.truce[k * S + to] = sim.truce[to * S + k] = 0;
    this.setDeal(k, to, { trade: false, nap: 0 });
    const w = startWar(sim, [k], [to], 'declaration');
    if (!w) return this._reply(to, { result: 'refuse', text: 'Impossible de déclarer la guerre.', factors: [] });
    // alliances défensives de la cible ; réprobation des pays proches de la cible
    for (let o = 0; o < S; o++) {
      if (o === k || o === to || sim.sides[o].eliminated) continue;
      if (sim.rules.alliances !== false && sim.allied[to * S + o] && !sim.allied[k * S + o] && sim.rng.next() < (0.45 * PERSONALITIES[sim.sides[o].ai.personality].ally + 0.2) * tn(sim, 'allyReliability')) joinWar(sim, w, o, 'b');
      if (sim.rel[o * S + to] > 30) addRel(sim, k, o, -8 * tn(sim, 'aggressionPenalty'));
    }
    this._refreshTrade();
    this.milestone('war', `Déclaration de guerre à ${B.name}.`);
    return this._reply(to, { result: 'info', text: 'Votre déclaration de guerre est reçue. Nous défendrons notre pays.', factors: [] });
  }
  // accords commerciaux -> partenaires (revenus) ; appelé après chaque changement
  _refreshTrade() {
    const sim = this.sim, S = sim.S;
    for (const [key, d] of Object.entries(this.deals)) {
      const [a, b] = key.split('-').map(Number);
      const on = d.trade && !sim.atWar[a * S + b];
      sim.trade[a * S + b] = sim.trade[b * S + a] = on ? 1 : sim.trade[a * S + b];
      for (const [x, y] of [[a, b], [b, a]]) {
        const sd = sim.sides[x];
        if (!sd.tradePartners) sd.tradePartners = [];
        const has = sd.tradePartners.includes(y);
        if (on && !has) sd.tradePartners.push(y);
        if (!on && has && !d.trade) sd.tradePartners.splice(sd.tradePartners.indexOf(y), 1);
      }
    }
  }

  // ---------------- initiatives des IA envers le joueur ----------------
  _aiDiplomacy(k) {
    const sim = this.sim, S = sim.S, p = this.player;
    const sd = sim.sides[k];
    if (!sd.ai || sim.sides[p].eliminated || this.offers.length >= 3 || sim.rules.negotiations === false) return;
    const rel = sim.rel[k * S + p];
    const near = sim.contact[k * S + p] > 0 || sim.nearCap[k * S + p];
    const P = PERSONALITIES[sd.ai.personality];
    const r = sim.rng.next() / tn(sim, 'aiProposals');
    const d = this.deal(k, p) || {};
    const mem = this.memOf(k);
    const coop = (1 - Math.min(0.8, mem.refused * 0.15)) * (1 + trustOf(sim, k, p) * 0.5);
    const may = (type) => canPropose(sim, k, p, type, null, { cooldown: type === 'demand' ? 120 : 90 }).ok;
    if (r < 0.012 * coop && may('trade') && rel > 15 && !d.trade && !sim.atWar[k * S + p] && sd.p.trade > 40) this.offer(k, 'trade', {}, `${sd.name} propose un accord commercial.`);
    else if (r < 0.018 * coop && may('alliance') && rel > 40 && !sim.allied[k * S + p] && P.ally > 0.9 && (sd.ai.analysis && sd.ai.analysis.threat > 0.6)) this.offer(k, 'alliance', {}, `${sd.name} propose une alliance face aux menaces de la région.`);
    else if (r < 0.022 && sim.allied[k * S + p] && rel > 25 && !sim.isAtWar(p) && sim.activeWars.some((w) => w.status === 'active' && w.b.includes(k))) this.offer(k, 'help', {}, `${sd.name}, votre allié, a été attaqué et demande votre aide militaire.`);
    else if (r < 0.026 && may('demand') && near && rel < -35 && P.expand > 1.2 && powerOf(sd) > powerOf(sim.sides[p]) * 1.6 && !sim.atWar[k * S + p]) {
      const amt = Math.round(sim.sides[p].eco.gdp * 0.005 * 10) / 10;
      this.offer(k, 'demand', { amount: amt }, `${sd.name} exige un tribut de ${amt} Md$ et menace votre pays.`);
    }
  }
  // délai minimal entre deux propositions de paix reçues par le joueur (tous pays confondus)
  peaceOfferReady(gap = 40) { return this.sim.time - (this.lastPeaceAt ?? -1e9) >= gap * tn(this.sim, 'peaceCooldown'); }
  offerAllowed(type) {
    const R = this.sim.rules;
    if (R.negotiations === false && type !== 'peace') return false;
    if ((type === 'alliance' || type === 'help') && R.alliances === false) return false;
    if (type === 'trade' && (R.treaties === false || R.trade === false)) return false;
    if ((type === 'peace' || type === 'surrender') && (R.peace === false || (this.sim.cfg.warEnd && this.sim.cfg.warEnd.peace === false))) return false;
    if (type === 'demand' && R.wars === false) return false;
    if (type === 'coalition' && (R.alliances === false || R.coalitions === false)) return false;
    return true;
  }
  offer(from, type, terms, text) {
    if (!this.offerAllowed(type)) return;
    if (this.offers.some((o) => o.from === from && o.type === type)) return;
    this.offers.push({ id: ++this._id, from, type, terms, text, t: this.sim.time, until: this.sim.time + MONTH_SEC * 3 });
    if (type === 'peace' || type === 'surrender') this.lastPeaceAt = this.sim.time;   // pas de rafale de propositions de paix
    if (type !== 'peace') noteProposal(this.sim, from, this.player, type, 'pending');
    this.log(from, 'ai', text, 'offer');
    this.sim._emit({ icon: type === 'surrender' ? '🏳️' : '✉️', title: type === 'surrender' ? 'CAPITULATION PROPOSÉE' : 'PROPOSITION DIPLOMATIQUE', tone: type === 'demand' ? 'bad' : 'neutral', side: from, text, nation: true, offer: true, urgent: ['demand', 'help', 'peace', 'surrender'].includes(type) });
  }
  answerOffer(id, accept, expired = false) {
    const sim = this.sim, S = sim.S, k = this.player;
    const o = this.offers.find((x) => x.id === id);
    if (!o) return;
    this.offers = this.offers.filter((x) => x !== o);
    const from = o.from, B = sim.sides[from];
    const mem = this.memOf(from);
    this.log(from, 'player', expired ? '(aucune réponse)' : accept ? 'Nous acceptons.' : 'Nous refusons.', 'proposal');
    // proposition d'un autre joueur humain : appliquée du point de vue de celui qui l'a faite
    if (o.terms && o.terms.human && HUMAN_DEALS.includes(o.type)) {
      const me = sim.sides[k];
      if (!accept) { this.at(from).log(k, 'ai', expired ? `${me.name} n'a pas répondu.` : `${me.name} refuse votre proposition.`, 'refuse'); return; }
      if (o.type === 'peace' && !this.warWith(from, k)) return;
      this.with(from, () => this._apply(from, k, o.type, o.type === 'peace' ? { terms: o.terms.terms } : o.terms));
      this.at(from).log(k, 'ai', `${me.name} accepte votre proposition.`, 'accept');
      this.milestone('diplo', `Accord avec ${B.name} : ${DIPLO_ACTIONS[o.type].label.toLowerCase()}.`);
      return;
    }
    noteProposal(sim, from, k, o.type === 'surrender' ? 'peace' : o.type, accept ? 'accept' : 'refuse', o.type === 'peace' && o.terms.war ? (this.warWith(from, k) ? warContext(sim, this.warWith(from, k), from) : null) : null);
    // capitulation offerte : refuser = poursuivre la guerre (aucune pénalité diplomatique)
    if (o.type === 'surrender') {
      const w = this.warWith(from, k);
      if (!accept || !w) {
        this.log(from, 'ai', expired ? 'Sans réponse de votre part, les combats continuent.' : 'Vous refusez notre capitulation : les combats continuent.', 'refuse');
        if (w && !expired) { w.moments.push({ t: sim.time, type: 'turn', text: `${sim.sides[k].name} refuse la capitulation de ${B.name} et poursuit la guerre.` }); this.milestone('war', `Capitulation de ${B.name} refusée : la guerre continue.`); }
        return;
      }
      // le vaincu est un autre joueur : ces conditions lui sont proposées, il décide
      if (this.isHuman(from)) { this._proposeHuman(from, 'peace', { terms: { ...o.terms.terms, war: w.id } }); return; }
      acceptSurrender(sim, w, { ...o.terms.terms, war: w.id }, o.terms.reason);
      this.milestone('treaty', `Capitulation de ${B.name} acceptée.`);
      this.log(from, 'ai', 'Nous capitulons. Le traité est en cours de rédaction.', 'accept');
      return;
    }
    if (o.type === 'peace' && !accept) { mem.refused++; addRel(sim, k, from, o.terms && o.terms.capitulation ? -1 : -3); this.log(from, 'ai', o.terms && o.terms.capitulation ? 'Vous refusez de capituler. Nos armées poursuivront l\'offensive.' : 'Votre refus est noté. Nous attendrons une évolution de la situation.', 'refuse'); return; }
    if (o.type === 'peace' && o.terms && o.terms.capitulation) {
      const w = this.warWith(from, k);
      if (w) { acceptSurrender(sim, w, { ...o.terms.terms, war: w.id }, o.terms.reason); this.milestone('treaty', `Capitulation face à ${B.name}.`); this.log(from, 'ai', 'Votre capitulation est acceptée.', 'accept'); }
      return;
    }
    // proposition restée sans réponse : moins grave qu'un refus explicite (sauf une exigence)
    if (!accept && expired && o.type !== 'demand') { mem.declined++; addRel(sim, k, from, -2); return; }
    if (!accept) {
      mem.refused++;
      addRel(sim, k, from, o.type === 'demand' ? -12 : -5);
      if (o.type === 'demand' && sim.rng.next() < 0.45) { const w = startWar(sim, [from], [k], 'declaration'); if (w) { this.milestone('war', `${B.name} déclare la guerre après notre refus de payer un tribut.`); this.log(from, 'ai', 'Votre refus est un acte hostile. Nos armées entrent en action.', 'war'); } }
      else if (o.type === 'help' && sim.allied[k * S + from]) { addRel(sim, k, from, -10); this.log(from, 'ai', 'Nous nous souviendrons de votre absence.', 'refuse'); }
      return;
    }
    if (o.type === 'coalition') {
      const c = coalitionById(sim, o.terms.coalition);
      const r = joinCoalition(sim, c, k);
      this.log(from, 'ai', r.ok ? `Bienvenue dans « ${c.name} ».` : `L'invitation n'est plus valable : ${r.text}`, r.ok ? 'accept' : 'refuse');
      if (r.ok) addRel(sim, k, from, 6);
      return;
    }
    if (o.type === 'demand') { const A = sim.sides[k]; const amt = Math.min(A.money, o.terms.amount); A.money -= amt; B.money += amt; addRel(sim, k, from, 6); A.p.politics.stability = Math.max(5, A.p.politics.stability - 3); this.milestone('diplo', `Tribut versé à ${B.name} : ${amt} Md$.`); }
    else if (o.type === 'help') {
      for (const w of sim.activeWars) if (w.status === 'active' && (w.a.includes(from) || w.b.includes(from))) { joinWar(sim, w, k, w.a.includes(from) ? 'a' : 'b'); this.milestone('war', `Entrée en guerre aux côtés de ${B.name}.`); break; }
    } else this._apply(k, from, o.type, o.terms);
    this.log(from, 'ai', o.type === 'peace' ? 'La paix est acceptée. Les négociations du traité commencent.' : 'Merci. Notre accord est en vigueur.', 'accept');
  }
  // ---------------- coalitions du joueur ----------------
  formCoalition(target, goal = 'contain') {
    const sim = this.sim, k = this.player;
    if (sim.rules.alliances === false || sim.rules.coalitions === false) return { ok: false, text: 'Les coalitions sont désactivées dans les règles de cette partie.' };
    const victim = goal === 'liberate' ? sim.activeWars.filter((w) => w.status === 'active' && w.a[0] === target).map((w) => w.b[0])[0] ?? -1 : -1;
    const c = createCoalition(sim, k, target, { goal: victim >= 0 || goal !== 'liberate' ? goal : 'contain', victim });
    if (!c) return { ok: false, text: 'Impossible de former cette coalition (vous en faites déjà partie, ou la cible n\'existe plus).' };
    this.milestone('alliance', `Fondation de « ${c.name} ».`);
    return { ok: true, coalition: c };
  }
  inviteToCoalition(id, to) {
    const sim = this.sim, k = this.player;
    const c = coalitionById(sim, id);
    if (!c || c.status !== 'active' || !memberOf(c, k)) return { result: 'refuse', text: 'Cette coalition n\'existe plus.', factors: [] };
    const B = sim.sides[to];
    if (this.isHuman(to)) {
      this.log(to, 'player', `Nous vous invitons à rejoindre « ${c.name} ».`, 'proposal');
      this.at(to).offer(k, 'coalition', { coalition: c.id, human: true }, `${sim.sides[k].name} vous invite à rejoindre « ${c.name} » (${GOALS[c.goal].label.toLowerCase()}).`);
      return { result: 'info', factors: [], text: `Invitation transmise à ${B.name}.` };
    }
    const ev = evaluateJoin(sim, c, to);
    this.log(to, 'player', `Nous vous invitons à rejoindre « ${c.name} » (${GOALS[c.goal].label.toLowerCase()}).`, 'proposal');
    noteProposal(sim, k, to, 'coalition', ev.accept ? 'accept' : 'refuse');
    if (ev.accept) {
      joinCoalition(sim, c, to);
      this.log(to, 'ai', `Nous rejoignons « ${c.name} ». Nos intérêts sont communs face à ${sim.sides[c.target].name}.`, 'accept', { factors: ev.factors });
      aiLog(sim, to, `Rejoint « ${c.name} » à l'invitation de ${sim.sides[k].name}.`, 'good');
      return { result: 'accept', factors: ev.factors, text: `${B.name} rejoint la coalition.` };
    }
    this.memOf(to).declined++;
    this.log(to, 'ai', `Nous ne rejoindrons pas « ${c.name} » pour le moment.`, 'refuse', { factors: ev.factors });
    return { result: 'refuse', factors: ev.factors, text: `${B.name} décline l'invitation.` };
  }
  leaveCoalitionP(id, separatePeace = true) {
    const sim = this.sim, k = this.player;
    const c = coalitionById(sim, id);
    if (!c || !memberOf(c, k)) return false;
    for (const m of c.members) if (m.k !== k) { this.memOf(m.k).broken += sim.atWar[k * sim.S + c.target] ? 1 : 0; }
    return leaveCoalition(sim, c, k, 'décision de notre gouvernement', separatePeace);
  }
  coalitionOffensive(id) {
    const c = coalitionById(this.sim, id);
    if (!c || c.leader !== this.player) return { ok: false, text: 'Seul le chef de la coalition peut lancer une offensive coordonnée.' };
    const r = launchOffensive(this.sim, c, true);
    if (r.ok) this.milestone('war', `Offensive coordonnée de « ${c.name} ».`);
    return r;
  }
  setCoalitionGoal(id, goal) {
    const c = coalitionById(this.sim, id);
    if (!c || c.leader !== this.player || !GOALS[goal]) return false;
    if (goal === 'liberate' && c.victim < 0) return false;
    c.goal = goal; c.kind = goal === 'contain' ? 'containment' : goal === 'liberate' ? 'defensive' : 'offensive';
    c.history.push({ t: Math.round(this.sim.time * 10) / 10, text: `Nouvel objectif fixé par ${this.sim.sides[this.player].name} : ${GOALS[goal].label.toLowerCase()}.`, kind: 'info' });
    return true;
  }

  // objectifs de guerre du joueur (régions visées, capitale)
  setWarGoals(to, regions, capital = true) {
    const w = this.warWith(this.player, to);
    if (!w) return false;
    setPlayerGoals(this.sim, w, w.a.includes(this.player) ? 'a' : 'b', regions, capital);
    this.milestone('war', `Objectifs de guerre fixés contre ${this.sim.sides[to].name} : ${regions.length} région(s)${capital ? ' et la capitale' : ''}.`);
    return true;
  }

  // contre-proposition du joueur à une demande de paix d'une IA
  counterPeace(id, terms) {
    const sim = this.sim, k = this.player;
    const o = this.offers.find((x) => x.id === id);
    if (!o || (o.type !== 'peace' && o.type !== 'surrender')) return null;
    const w = this.warWith(o.from, k);
    this.offers = this.offers.filter((x) => x !== o);
    if (!w) return null;
    const t = { ...terms, proposer: k, war: w.id };
    this.log(o.from, 'player', `Contre-proposition : ${this._peaceText(w, t, k)}`, 'proposal');
    if (o.terms && o.terms.human) {
      this.at(o.from).offer(k, 'peace', { terms: t, war: w.id, human: true }, `${sim.sides[k].name} fait une contre-proposition de paix.`);
      return this._reply(o.from, { result: 'info', text: 'Contre-proposition transmise. En attente de sa réponse.', factors: [] }, 'peace', {});
    }
    const ev = evaluatePeace(sim, w, o.from, t);
    noteProposal(sim, k, o.from, 'peace', ev.result === 'accept' ? 'accept' : 'refuse');
    if (ev.result === 'accept') {
      if (o.type === 'surrender' || (o.terms && o.terms.capitulation)) {
        acceptSurrender(sim, w, { ...t, separate: o.terms.separate }, o.terms.reason);
        this.milestone('treaty', `Paix aux conditions négociées avec ${sim.sides[o.from].name}.`);
      } else this._apply(k, o.from, 'peace', { terms: t });
      return this._reply(o.from, { result: 'accept', text: 'Nous acceptons vos conditions. La paix est signée.', factors: ev.factors });
    }
    addRel(sim, k, o.from, -1);
    return this._reply(o.from, { result: ev.result === 'counter' ? 'counter' : 'refuse', text: ev.result === 'counter' ? this._peaceText(w, ev.counter, o.from) : 'Ces conditions sont inacceptables. Les combats continuent.', factors: ev.factors, counter: ev.counter ? { type: 'peace', terms: { terms: ev.counter }, text: '' } : null }, 'peace', {});
  }

  // ---------------- décisions du joueur ----------------
  _decisions() {
    const sim = this.sim;
    if (sim.rules.decisions === false) { this.decision = null; return; }
    if (this.decision) {
      if (sim.time > this.decision.until) { this.choose(this.decision.def ?? 0, true); }
      return;
    }
    if (sim.time < this.nextDecisionAt) return;
    const sd = this.sd;
    const ctx = this.context();
    const R = sim.rules;
    const cands = DECISIONS.filter((d) => !this.decisionsTaken.slice(-3).includes(d.id) && (!d.rule || R[d.rule] !== false) && d.when(ctx, sd, this));
    if (!cands.length) { this.nextDecisionAt = sim.time + MONTH_SEC * 2; return; }
    const urgent = cands.find((x) => x.id === 'warEffort');
    const d = urgent || cands[sim.rng.int(cands.length)];
    const built = d.build(ctx, sd, this);
    // options incompatibles avec les règles (mobilisation, dette…) retirées
    built.options = built.options.filter((o) => !(o.fx && ((o.fx.army > 0 && R.mobilization === false) || (o.fx.debt && R.debt === false) || (o.fx.trade && R.trade === false) || (o.fx.research && R.research === false) || (o.fx.relAll && R.relations === false))));
    if (!built.options.length) { this.nextDecisionAt = sim.time + MONTH_SEC * 2; return; }
    if ((built.def ?? 0) >= built.options.length) built.def = built.options.length - 1;
    this.decision = { id: d.id, title: built.title || d.title, text: built.text, options: built.options, def: built.def ?? built.options.length - 1, t: sim.time, until: sim.time + MONTH_SEC * 4 };
    this.nextDecisionAt = sim.time + MONTH_SEC * (5 + sim.rng.int(5)) / (sim.cfg.decisionRate || 1);
    sim._emit({ icon: '⚖️', title: 'DÉCISION', tone: 'neutral', side: this.player, text: this.decision.title, nation: true, decision: true });
  }
  context() {
    const sd = this.sd, sim = this.sim;
    const gdp = Math.max(0.1, sd.eco.gdp);
    return { gdp, debtRatio: sd.debt / gdp, deficit: -sd.eco.balance / gdp, growth: sd.growthRate || 0, unemp: sd.unemp || 6, stability: sd.stability, tech: sd.p.tech, popGrowth: sd.p.popGrowth, atWar: sim.isAtWar(this.player), money: sd.money, res: sd.p.res };
  }
  choose(idx, auto = false) {
    const d = this.decision;
    if (!d) return;
    const opt = d.options[idx] || d.options[0];
    this.decision = null;
    this.decisionsTaken.push(d.id);
    if (this.decisionsTaken.length > 20) this.decisionsTaken.shift();
    applyEffects(this.sim, this.player, opt.fx || {}, this);
    if (d.crisis && opt.crisis) setStance(this.sim, d.crisis, this.player, opt.crisis);   // conférence internationale
    this.milestone('decision', `${d.title} : ${opt.label}${auto ? ' (décision automatique du gouvernement)' : ''}.`);
    this.sim.hist(this.player, 'decision', `${d.title} : ${opt.label}.`);
  }

  // ---------------- événements mondiaux liés aux statistiques ----------------
  _worldEvents(k) {
    const sim = this.sim, S = sim.S;
    const sd = sim.sides[k];
    const r = sim.rng.next();
    const mine = this.isHuman(k);
    const g = sd.growthRate || 0;
    const note = (type, text, tone = 'neutral') => {
      if (mine) { sim._emit({ icon: '📰', title: 'ÉVÉNEMENT', tone, side: k, text, nation: true }); this.at(k).milestone('event', text); sim.hist(k, type, text); }
      else if (sim.rng.next() < 0.25) sim.chron(type, text, { e: [sd.e] });
    };
    const R = sim.rules;
    const eco = R.ecoEvents !== false && R.economy !== false, dip = R.diploEvents !== false;
    if (!eco && r < 0.024) return;
    if (r < 0.01 && g > 0.03 && sd.stability > 0.6) { sd.gdpBase *= 1.01; note('economy', `Forte croissance économique en ${sd.name} : investissements en hausse.`, 'good'); }
    else if (r < 0.02 && (sd.debt / Math.max(1, sd.eco.gdp) > 1 || sd.stability < 0.4)) { sd.gdpBase *= 0.99; note('economy', `Ralentissement économique en ${sd.name}.`, 'bad'); }
    else if (r < 0.024 && sd.p.popGrowth < 0.1) { sd.p.politics.stability = Math.max(5, sd.p.politics.stability - 0.5); note('demography', `Vieillissement de la population en ${sd.name} : la main-d'œuvre diminue.`, 'bad'); }
    else if (r < 0.03 && R.research !== false && sd.p.research > 70 && sd.p.tech < 99) { sd.p.tech = Math.min(100, sd.p.tech + 1.2); note('tech', `Découverte technologique majeure en ${sd.name}.`, 'good'); }
    else if (r < 0.034 && dip) {
      // tension ou accord avec un voisin, selon les relations
      for (let o = 0; o < S; o++) {
        if (o === k || !sim.contact[k * S + o] || sim.sides[o].eliminated) continue;
        const rel = sim.rel[k * S + o];
        if (rel < -40 && !sim.atWar[k * S + o]) { addRel(sim, k, o, -8); note('diplomacy', `Crise diplomatique entre ${sd.name} et ${sim.sides[o].name}.`, 'bad'); break; }
        if (rel > 30 && R.treaties !== false && R.trade !== false && !(this.deal(k, o) || {}).trade && !this.isHuman(k) && !this.isHuman(o) && sd.p.trade > 40 && sim.sides[o].p.trade > 40) { this.setDeal(k, o, { trade: true }); this._refreshTrade(); note('diplomacy', `Accord commercial entre ${sd.name} et ${sim.sides[o].name}.`, 'good'); break; }
      }
    }
  }

  // ---------------- réactions annuelles du monde ----------------
  _yearlyReactions() {
    const sim = this.sim, S = sim.S, k = this.player;
    const tl = this.timeline;
    if (tl.length < 2) return;
    const a = tl[tl.length - 2], b = tl[tl.length - 1];
    // un joueur qui devient beaucoup plus puissant inquiète ses voisins
    if (!a.first && b.power > a.power * 1.12 && b.powerRank <= 10) {
      for (let o = 0; o < S; o++) if (o !== k && (sim.contact[k * S + o] || sim.nearCap[k * S + o]) && !sim.allied[k * S + o]) addRel(sim, k, o, -3 * PERSONALITIES[sim.sides[o].ai.personality].risk);
      this.milestone('event', 'Votre montée en puissance inquiète les pays voisins.');
    }
    // une économie florissante attire les partenaires
    if (b.gdp > a.gdp * 1.04) for (let o = 0; o < S; o++) if (o !== k && sim.trade[k * S + o]) addRel(sim, k, o, 1.5);
    // dérive des relations (influence diplomatique)
    const dip = this.sd.devDiplo || 0;
    if (dip > 0) for (let o = 0; o < S; o++) if (o !== k && !sim.atWar[k * S + o] && sim.rel[k * S + o] < 40) addRel(sim, k, o, dip * 4);
    // expiration des pactes
    for (const [key, d] of Object.entries(this.deals)) if (d.nap && d.nap < sim.time && d.nap > 0) { d.nap = 0; const [x, y] = key.split('-').map(Number); if (x === k || y === k) this.milestone('diplo', `Fin du pacte de non-agression avec ${sim.sides[x === k ? y : x].name}.`); }
  }

  snapshotYear(first = false) {
    const sim = this.sim, sd = this.sd;
    const ranked = sim.sides.filter((s) => !s.eliminated).map((s) => ({ k: s.index, p: powerOf(s), g: s.eco.gdp })).sort((x, y) => y.p - x.p);
    const gRank = [...ranked].sort((x, y) => y.g - x.g).findIndex((x) => x.k === this.player) + 1;
    const allies = sim.sides.filter((s, o) => o !== this.player && sim.allied[this.player * sim.S + o]).length;
    this.timeline.push({
      year: dateParts(sim.time, sim.cfg.startDay).y, t: Math.round(sim.time), first,
      gdp: Math.round(sd.eco.gdp * 10) / 10, pc: Math.round(sd.pc * 1000), pop: Math.round(sd.pop), cells: sd.cells, km2: Math.round(sd.km2),
      money: Math.round(sd.money * 10) / 10, debt: Math.round(sd.debt * 10) / 10, tech: Math.round(sd.p.tech * 10) / 10, stability: Math.round(sd.stability * 100),
      soldiers: Math.round(landTotal(sd) * 1000), power: Math.round(powerOf(sd) * 10) / 10, powerRank: ranked.findIndex((x) => x.k === this.player) + 1, gdpRank: gRank,
      allies, projects: sd.dev.done.length, unemp: Math.round((sd.unemp || 0) * 10) / 10, living: sd.living || 0,
      ...yearExtras(sim, this.player),   // technologies, pertes, guerres (récapitulatif annuel)
    });
  }

  // ---------------- scénarios (mode histoire) ----------------
  _scenarioCheck() {
    const sc = findScenario(this.scenario.id, this.sim.cfg.nation && this.sim.cfg.nation.scenarioSpec);
    if (!sc) return;
    const st = this.scenario;
    const years = (this.sim.time - st.start) / YEAR_SEC;
    if (sc.tick) sc.tick(this.sim, this.player, this, st, applyEffects);   // événements du scénario
    let allDone = true;
    for (const o of sc.objectives) {
      const r = o.check(this.sim, this.player, this, st);
      st.progress = st.progress || {};
      st.progress[o.id] = r.progress;
      if (r.done && !st.done[o.id]) { st.done[o.id] = Math.round(this.sim.time); this.milestone('objective', `${o.secret ? 'Objectif secret découvert' : 'Objectif atteint'} : ${o.text}.`); this.sim._emit({ icon: '🎯', title: o.secret ? 'OBJECTIF SECRET' : 'OBJECTIF ATTEINT', tone: 'good', side: this.player, text: o.text, nation: true }); }
      if (r.failed && !st.failedObj) { st.failedObj = o.id; }
      if (!st.done[o.id] && !o.optional && !o.secret) allDone = false;
    }
    if (allDone || years >= sc.years || (sc.fail && sc.fail(this.sim, this.player, this, st))) {
      st.status = 'ended';
      // les objectifs secrets sont des bonus ; sans l'objectif principal, pas mieux qu'un résultat mitigé ;
      // une condition d'échec remplie termine le scénario sur un échec
      const visible = sc.objectives.filter((o) => !o.secret);
      const ok = visible.filter((o) => st.done[o.id]).length + sc.objectives.filter((o) => o.secret && st.done[o.id]).length * 0.5;
      const ratio = Math.min(1, ok / Math.max(1, visible.length));
      const failed = !allDone && years < sc.years;
      const mainMissed = sc.objectives.some((o) => o.main && !st.done[o.id]);
      st.grade = failed ? 'echec' : ratio >= 1 ? 'triomphe' : ratio >= 0.66 ? 'succes' : ratio >= 0.33 ? 'mitige' : 'echec';
      if (mainMissed && (st.grade === 'triomphe' || st.grade === 'succes')) st.grade = 'mitige';
      st.ending = sc.endings[st.grade];
      this.milestone('objective', `Fin du scénario « ${sc.title} » : ${st.ending.title}.`);
      this.sim._emit({ icon: '🏁', title: 'FIN DU SCÉNARIO', tone: ratio >= 0.66 ? 'good' : 'bad', side: this.player, text: st.ending.title, nation: true, scenarioEnd: true });
    }
  }
}

// ---------------- effets des décisions ----------------
export function applyEffects(sim, k, fx, nation) {
  const sd = sim.sides[k];
  const gdp = Math.max(0.1, sd.eco.gdp);
  const p = sd.p;
  for (const [f, v] of Object.entries(fx)) {
    if (f === 'money') { sd.money += v * gdp; if (sd.money < 0) { sd.debt += -sd.money; sd.money = 0; } }
    else if (f === 'debt') sd.debt = Math.max(0, sd.debt + v * gdp);
    else if (f === 'stability') p.politics.stability = clamp(p.politics.stability + v, 1, 99);
    else if (f === 'gdp') sd.gdpBase *= 1 + v;
    else if (f === 'growth') sd.devGrowth = (sd.devGrowth || 0) + v;
    else if (f === 'tech') p.tech = clamp(p.tech + v, 1, 100);
    else if (f === 'infra') for (const key of ['roads', 'rail', 'airports']) p.infra[key] = clamp(p.infra[key] + v, 1, 100);
    else if (f === 'trade') p.trade = clamp(p.trade + v, 1, 100);
    else if (f === 'popGrowth') { sd.basePopGrowth = (sd.basePopGrowth ?? p.popGrowth) + v; p.popGrowth += v; }
    else if (f === 'relAll') { for (let o = 0; o < sim.S; o++) if (o !== k) addRel(sim, k, o, v); }
    else if (f === 'relNeighbors') { for (let o = 0; o < sim.S; o++) if (o !== k && sim.contact[k * sim.S + o]) addRel(sim, k, o, v); }
    else if (f === 'milPct' && nation) nation.policy.milPct = clamp(nation.policy.milPct + v, 0, 25);
    else if (f === 'services' && nation) nation.policy.services = clamp(nation.policy.services + v, 0.6, 1.4);
    else if (f === 'tax' && nation) nation.policy.tax = clamp(nation.policy.tax + v, 0.6, 1.5);
    else if (f === 'equip') p.equip = clamp(p.equip + v, 1, 100);
    else if (f === 'readiness') sd.readiness = clamp(sd.readiness + v, 0.15, 1);
    else if (f === 'research') sd.devResearch = (sd.devResearch || 0) + v;
    else if (f === 'army') { for (const t of ['inf', 'arm', 'art', 'rec']) sd.army[t] *= 1 + v; }
  }
  refreshCombat(sd);
}

// ---------------- modèles de décisions (liées à la situation) ----------------
const bn = (v) => `${Math.round(v * 10) / 10} Md$`;
export const DECISIONS = [
  {
    id: 'budget', rule: 'economy', when: (c) => c.deficit > 0.015 || c.money < c.gdp * 0.01,
    build: (c) => ({
      title: 'Le budget est limité',
      text: `Le déficit atteint ${pct(Math.max(0, c.deficit))} du PIB et la trésorerie est faible. Le gouvernement doit choisir ses priorités.`,
      options: [
        { label: 'Investir dans les infrastructures', desc: 'Emprunt, infrastructures +4, croissance future', fx: { debt: 0.01, infra: 4, growth: 0.002 } },
        { label: 'Investir dans la recherche', desc: 'Emprunt, technologie +2, rendement de la recherche', fx: { debt: 0.01, tech: 2, research: 0.05 } },
        { label: 'Réduire les dépenses', desc: 'Services publics −8 %, stabilité −3', fx: { services: -0.08, stability: -3 } },
        { label: 'Augmenter les impôts', desc: 'Impôts +6 %, stabilité −2', fx: { tax: 0.06, stability: -2 } },
      ], def: 2,
    }),
  },
  {
    id: 'recession', rule: 'economy', when: (c) => c.growth < -0.005,
    build: (c) => ({
      title: 'Récession économique',
      text: `L'économie se contracte (${pct(c.growth)} sur un an). Le chômage menace.`,
      options: [
        { label: 'Plan de relance', desc: 'Dépense de 1,5 % du PIB, croissance +0,6 pt, dette en hausse', fx: { debt: 0.015, growth: 0.006, stability: 2 } },
        { label: 'Réformes structurelles', desc: 'Efficacité à long terme, stabilité −3', fx: { growth: 0.004, stability: -3 } },
        { label: 'Rigueur budgétaire', desc: 'Services −6 %, dette maîtrisée, stabilité −2', fx: { services: -0.06, stability: -2 } },
      ], def: 1,
    }),
  },
  {
    id: 'unemployment', rule: 'economy', when: (c) => c.unemp > 11,
    build: (c) => ({
      title: 'Chômage élevé',
      text: `Le chômage atteint ${c.unemp.toFixed(1).replace('.', ',')} %. La population attend une réponse.`,
      options: [
        { label: 'Grands travaux publics', desc: '1 % du PIB, infrastructures +3, stabilité +3', fx: { debt: 0.01, infra: 3, stability: 3 } },
        { label: 'Formation professionnelle', desc: '0,5 % du PIB, efficacité future, technologie +1', fx: { debt: 0.005, tech: 1, growth: 0.002 } },
        { label: 'Ne rien changer', desc: 'Stabilité −4', fx: { stability: -4 } },
      ], def: 2,
    }),
  },
  {
    id: 'techOpportunity', rule: 'research', when: (c, sd) => sd.p.research > 55 && c.tech < 98,
    build: () => ({
      title: 'Percée scientifique',
      text: 'Des laboratoires nationaux annoncent une avancée prometteuse. Faut-il l\'exploiter ?',
      options: [
        { label: 'Financer un programme national', desc: '0,6 % du PIB, technologie +3', fx: { money: -0.006, tech: 3 } },
        { label: 'Céder des licences à l\'étranger', desc: 'Recettes immédiates (0,4 % du PIB), relations +2', fx: { money: 0.004, relAll: 2 } },
        { label: 'Laisser le secteur privé décider', desc: 'Technologie +1', fx: { tech: 1 } },
      ], def: 2,
    }),
  },
  {
    id: 'neighborArms', rule: 'relations', when: (c, sd, n) => {
      const sim = n.sim, k = n.player, S = sim.S;
      for (let o = 0; o < S; o++) if (o !== k && sim.contact[k * S + o] && sim.rel[k * S + o] < -20 && powerOf(sim.sides[o]) > powerOf(sd) * 1.2) return true;
      return false;
    },
    build: (c, sd, n) => {
      const sim = n.sim, k = n.player, S = sim.S;
      let o = 0; for (let x = 0; x < S; x++) if (x !== k && sim.contact[k * S + x] && sim.rel[k * S + x] < -20 && powerOf(sim.sides[x]) > powerOf(sd) * 1.2) { o = x; break; }
      return {
        title: `Inquiétudes face ${de(sim.sides[o].name).replace(/^de /, 'à ').replace(/^d'/, 'à ').replace(/^des /, 'aux ')}`,
        text: `${sim.sides[o].name} renforce son armée près de nos frontières. Nos relations sont tendues.`,
        options: [
          { label: 'Renforcer la défense', desc: 'Budget militaire +0,5 pt de PIB, préparation +5 %', fx: { milPct: 0.5, readiness: 0.05 } },
          { label: 'Chercher des alliés', desc: 'Relations +4 avec tous les pays', fx: { relAll: 4 } },
          { label: 'Ouvrir le dialogue', desc: 'Relations +6 avec les voisins, stabilité −1', fx: { relNeighbors: 6, stability: -1 } },
        ], def: 2,
      };
    },
  },
  {
    id: 'warEffort', rule: 'wars', when: (c) => c.atWar,
    build: (c, sd) => ({
      title: 'L\'effort de guerre',
      text: `Le pays est en guerre. Préparation des forces : ${Math.round(sd.readiness * 100)} %, lassitude : ${Math.round(sd.exhaustion * 100)} %. Le gouvernement doit fixer l'effort national.`,
      options: [
        { label: 'Mobilisation générale', desc: 'Budget militaire +1,5 pt de PIB, armée +10 %, stabilité −3', fx: { milPct: 1.5, army: 0.1, stability: -3, readiness: 0.05 } },
        { label: 'Économie de guerre', desc: 'Budget militaire +0,8 pt, emprunt de 1 % du PIB', fx: { milPct: 0.8, debt: 0.01, readiness: 0.03 } },
        { label: 'Préserver l\'économie', desc: 'Aucune hausse des dépenses, stabilité +1', fx: { stability: 1 } },
      ], def: 1,
    }),
  },
  {
    id: 'aging', rule: 'politicalEvents', when: (c) => c.popGrowth < 0.25,
    build: () => ({
      title: 'Vieillissement de la population',
      text: 'La natalité baisse et la population active diminue.',
      options: [
        { label: 'Politique familiale', desc: 'Croissance démographique +0,3, dépense de 0,4 % du PIB', fx: { popGrowth: 0.3, money: -0.004 } },
        { label: 'Ouvrir l\'immigration de travail', desc: 'Croissance démographique +0,4, stabilité −2, croissance +0,2 pt', fx: { popGrowth: 0.4, stability: -2, growth: 0.002 } },
        { label: 'Automatisation', desc: 'Technologie +1, croissance +0,1 pt', fx: { tech: 1, growth: 0.001 } },
      ], def: 2,
    }),
  },
  {
    id: 'disaster', rule: 'ecoEvents', when: (c, sd) => sd.p.infra.roads < 55,
    build: () => ({
      title: 'Catastrophe naturelle',
      text: 'Des inondations ont endommagé routes et réseaux dans plusieurs régions.',
      options: [
        { label: 'Reconstruction rapide', desc: '1 % du PIB, infrastructures +2, stabilité +2', fx: { debt: 0.01, infra: 2, stability: 2 } },
        { label: 'Demander une aide internationale', desc: 'Relations +3, stabilité −1', fx: { relAll: 3, stability: -1 } },
        { label: 'Reconstruction progressive', desc: 'Infrastructures −3, stabilité −3', fx: { infra: -3, stability: -3 } },
      ], def: 2,
    }),
  },
  {
    id: 'stability', rule: 'politicalEvents', when: (c) => c.stability < 0.45,
    build: () => ({
      title: 'Mécontentement social',
      text: 'Des manifestations se multiplient dans les grandes villes.',
      options: [
        { label: 'Grandes réformes sociales', desc: 'Services +8 %, stabilité +6', fx: { services: 0.08, stability: 6 } },
        { label: 'Baisse d\'impôts', desc: 'Impôts −6 %, stabilité +4', fx: { tax: -0.06, stability: 4 } },
        { label: 'Fermeté', desc: 'Stabilité +2, relations −3', fx: { stability: 2, relAll: -3 } },
      ], def: 2,
    }),
  },
  {
    id: 'debt', rule: 'debt', when: (c) => c.debtRatio > 1.1,
    build: (c) => ({
      title: 'Dette publique élevée',
      text: `La dette atteint ${Math.round(c.debtRatio * 100)} % du PIB ; les taux d'intérêt montent.`,
      options: [
        { label: 'Plan de désendettement', desc: 'Impôts +5 %, services −5 %, stabilité −3', fx: { tax: 0.05, services: -0.05, stability: -3 } },
        { label: 'Restructurer la dette', desc: 'Dette −10 % du PIB, relations −6', fx: { debt: -0.1, relAll: -6 } },
        { label: 'Compter sur la croissance', desc: 'Aucun changement immédiat', fx: {} },
      ], def: 2,
    }),
  },
  {
    id: 'postwar', rule: 'wars', when: (c, sd, n) => !c.atWar && n.milestones.slice(-6).some((m) => m.type === 'treaty' || m.type === 'war') && sd.readiness < 0.9,
    build: () => ({
      title: 'L\'après-guerre',
      text: 'La guerre est terminée. Comment préparer l\'avenir ?',
      options: [
        { label: 'Reconstruction', desc: 'Infrastructures +4, croissance +0,3 pt, dette +1 % du PIB', fx: { infra: 4, growth: 0.003, debt: 0.01 } },
        { label: 'Démobilisation', desc: 'Armée −15 %, budget militaire −0,5 pt, stabilité +3', fx: { army: -0.15, milPct: -0.5, stability: 3 } },
        { label: 'Rester vigilant', desc: 'Préparation +5 %, relations −2', fx: { readiness: 0.05, relAll: -2 } },
      ], def: 0,
    }),
  },
  {
    id: 'resources', rule: 'resources', when: (c) => c.res.energy > 65 || c.res.raw > 65,
    build: () => ({
      title: 'Rente des ressources',
      text: 'Les cours des matières premières montent : les recettes d\'exportation augmentent.',
      options: [
        { label: 'Fonds souverain', desc: 'Trésorerie +0,8 % du PIB', fx: { money: 0.008 } },
        { label: 'Diversifier l\'économie', desc: 'Croissance +0,3 pt, commerce +4', fx: { growth: 0.003, trade: 4 } },
        { label: 'Baisser les impôts', desc: 'Impôts −4 %, stabilité +3', fx: { tax: -0.04, stability: 3 } },
      ], def: 0,
    }),
  },
  {
    id: 'trade', rule: 'trade', when: (c, sd) => sd.tradePartners && sd.tradePartners.length > 0,
    build: () => ({
      title: 'Différend commercial',
      text: 'Un partenaire accuse nos entreprises de concurrence déloyale.',
      options: [
        { label: 'Faire des concessions', desc: 'Commerce −2, relations +4', fx: { trade: -2, relAll: 4 } },
        { label: 'Négocier', desc: 'Relations +1', fx: { relAll: 1 } },
        { label: 'Mesures de rétorsion', desc: 'Commerce −4, stabilité +1, relations −5', fx: { trade: -4, stability: 1, relAll: -5 } },
      ], def: 1,
    }),
  },
];

export { fmtDate, UNIT_COST, aiLog };

for (const f of HUMAN_FIELDS) {
  Object.defineProperty(Nation.prototype, f, {
    get() { const h = this.humans && this.humans[this.player]; return h ? h[f] : undefined; },
    set(v) { const h = this.humans && this.humans[this.player]; if (h) h[f] = v; },
    configurable: true,
  });
}
