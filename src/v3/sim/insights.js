// ANALYSES DU PAYS — données du tableau de bord « Mon pays », alertes, conseiller contextuel et
// récapitulatif annuel.
// Module en LECTURE SEULE : il ne modifie jamais la simulation et n'utilise pas son générateur aléatoire.
// Il peut donc être appelé à tout moment par l'interface (solo ou multijoueur) sans risque de
// désynchronisation ni de divergence entre une partie et sa sauvegarde.
import { powerOf } from './ai.js';
import { landTotal } from './economy.js';
import { relationStatus } from './wars.js';
import { YEAR_SEC } from './calendar.js';
import { TECH_BY_ID } from './techTree.js';

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const r1 = (v) => Math.round(v * 10) / 10;
const pctTxt = (v, d = 1) => `${(v * 100).toFixed(d).replace('.', ',')} %`;
const bnTxt = (v) => (Math.abs(v) >= 1000 ? `${(v / 1000).toFixed(2).replace('.', ',')} T$` : `${(Math.round(v * 10) / 10).toString().replace('.', ',')} Md$`);

// valeur d'une série annuelle il y a ~1 an (sd.series : [t, cellules, PIB, trésorerie, unités, tech, stabilité, puissance])
function seriesAgo(sd, col, sec = YEAR_SEC) {
  const s = sd.series || [];
  if (s.length < 2) return null;
  const t = s[s.length - 1][0] - sec;
  for (let i = s.length - 1; i >= 0; i--) if (s[i][0] <= t) return s[i][col];
  return s[0][col];
}

// ravitaillement estimé d'une armée qui combat hors de son territoire d'origine (0 → 1)
export function supplyIndex(sim, k) {
  const sd = sim.sides[k];
  if (sim.rules.logistics === false) return 1;
  const frac = (sd.heldForeign || 0) / Math.max(50, sd.initial || 1);
  const foreign = 1 / (1 + (1.45 - 0.7 * (sd.supplyLvl ?? 0.5)) * frac * 1.0);
  const stock = sd.resources < 8 ? 0.8 : 1;
  return clamp(foreign * stock * (0.8 + 0.2 * (sd.readiness ?? 1)), 0, 1.2);
}

// guerres du pays : camp, adversaires, évolution territoriale et pertes
export function warsOf(sim, k) {
  const out = [];
  for (const w of sim.wars) {
    if (w.status !== 'active') continue;
    const side = w.a.includes(k) ? 'a' : w.b.includes(k) ? 'b' : null;
    if (!side) continue;
    const mine = side === 'a' ? w.a : w.b, foes = side === 'a' ? w.b : w.a;
    const myCells = mine.reduce((t, x) => t + sim.sides[x].cells, 0);
    const myPre = mine.reduce((t, x) => t + (w.prewar[x] || sim.sides[x].cells), 0);
    const foeCells = foes.reduce((t, x) => t + sim.sides[x].cells, 0);
    const foePre = foes.reduce((t, x) => t + (w.prewar[x] || sim.sides[x].cells), 0);
    const myPow = mine.reduce((t, x) => t + powerOf(sim.sides[x]), 0);
    const foePow = foes.reduce((t, x) => t + powerOf(sim.sides[x]), 0);
    const sd = sim.sides[k];
    const unitsNow = sd.units, units0 = (w.initialUnits && w.initialUnits[k]) || sd.units;
    const delta = (myCells - myPre) / Math.max(1, myPre) - (foeCells - foePre) / Math.max(1, foePre);
    out.push({
      id: w.id, name: w.name, side, foes, allies: mine.filter((x) => x !== k),
      years: (sim.time - w.start) / YEAR_SEC, ratio: myPow / Math.max(1e-6, foePow),
      myChange: (myCells - myPre) / Math.max(1, myPre), foeChange: (foeCells - foePre) / Math.max(1, foePre),
      unitsChange: (unitsNow - units0) / Math.max(1e-6, units0),
      trend: delta > 0.03 ? 'win' : delta < -0.03 ? 'lose' : 'even',
    });
  }
  return out;
}

// relations diplomatiques résumées
export function diplomacyOf(sim, k, n) {
  const S = sim.S;
  const allies = [], rivals = [], partners = [], tense = [];
  for (let o = 0; o < S; o++) {
    if (o === k || sim.sides[o].eliminated) continue;
    const st = relationStatus(sim, k, o);
    if (st === 'ally') allies.push(o);
    if (sim.trade[k * S + o]) partners.push(o);
    const rel = sim.rel[k * S + o];
    if (!sim.atWar[k * S + o] && rel < -40 && (sim.contact[k * S + o] || sim.nearCap[k * S + o])) tense.push(o);
    if (!sim.atWar[k * S + o] && rel < -60) rivals.push(o);
  }
  const offers = n && n.offers ? n.offers.length : 0;
  return { allies, rivals, partners, tense, offers };
}

// états d'occupation des territoires tenus par le pays k (semi-occupé, occupé, contesté)
export function occupationOf(sim, k) {
  const out = { semi: 0, occupied: 0, contested: 0 };
  const e = sim.sides[k].e;
  for (const i of sim.occList || []) {
    if (sim.owner[i] !== e) continue;
    const l = sim.occupied[i];
    if (l === 1) out.semi++; else if (l === 2) out.occupied++; else if (l === 3) out.contested++;
  }
  return out;
}

// ======================= TABLEAU DE BORD =======================
// Toutes les données utiles à la décision, regroupées par thème. Chaque thème porte un état
// (good / warn / bad) pour que l'écran mette en avant ce qui demande une action.
export function dashboard(sim, k, n = null) {
  const sd = sim.sides[k];
  const e = sd.eco, p = sd.p;
  const gdp = Math.max(0.1, e.gdp);
  const growth = sd.growthRate || 0;
  const known = (sd.series || []).length > 12;   // croissance mesurée sur au moins un an
  const debtRatio = sd.debt / gdp;
  const deficit = -e.balance / gdp;
  const gdp1 = seriesAgo(sd, 2);
  const stab = sd.stability;
  const stab1 = seriesAgo(sd, 6);
  const wars = warsOf(sim, k);
  const dip = diplomacyOf(sim, k, n);
  const sup = supplyIndex(sim, k);
  const land = landTotal(sd);
  const ranked = sim.sides.filter((s) => !s.eliminated).map((s) => ({ k: s.index, p: powerOf(s), g: s.eco.gdp })).sort((a, b) => b.p - a.p);
  const powerRank = ranked.findIndex((x) => x.k === k) + 1;
  const gdpRank = [...ranked].sort((a, b) => b.g - a.g).findIndex((x) => x.k === k) + 1;
  const active = Object.values(sd.dev ? sd.dev.active : {});
  const research = active.map((a) => ({ id: a.id, name: (TECH_BY_ID[a.id] || {}).name || a.id, progress: a.done / Math.max(1, a.months), months: Math.max(0, a.months - a.done), stalled: !!a.stalled }));
  const tone = (bad, warn) => (bad ? 'bad' : warn ? 'warn' : 'good');
  const res = p.res || { food: 50, energy: 50, raw: 50, strategic: 50 };
  const resMin = Math.min(res.food, res.energy, res.raw);
  const recent = [];
  if (n && n.milestones) for (const m of n.milestones.slice(-6).reverse()) recent.push({ t: m.t, type: m.type, text: m.text });
  return {
    k, name: sd.name, atWar: wars.length > 0,
    economy: {
      gdp: e.gdp, growth, growthKnown: known, gdpYearAgo: gdp1, pc: sd.pc, gdpRank, unemp: sd.unemp ?? null, living: sd.living ?? null, crisis: !!sd.crisis,
      tone: tone(sd.crisis || (known && growth < -0.01), (known && growth < 0.005) || (sd.unemp || 0) > 11),
    },
    population: { pop: sd.pop, growth: p.popGrowth, tone: tone(p.popGrowth < -0.6, p.popGrowth < 0) },
    stability: { value: stab, yearAgo: stab1 !== null ? stab1 / 100 : null, tone: tone(stab < 0.35, stab < 0.5) },
    budget: {
      money: sd.money, debt: sd.debt, debtRatio, balance: e.balance, deficit, income: e.income, expenses: e.expenses,
      upkeep: e.upkeep, interest: e.interest || 0, civil: e.civil || 0, pay: e.pay ?? 1,
      tone: tone(debtRatio > 1.3 || (sd.money <= 0 && deficit > 0.02), deficit > 0.02 || debtRatio > 0.9),
    },
    resources: { ...res, military: sd.resources, tone: tone(resMin < 15 || sd.resources < 10, resMin < 30 || sd.resources < 30) },
    military: {
      soldiers: land * 1000, air: sd.air, navy: sd.navy, power: powerOf(sd), powerRank, readiness: sd.readiness, morale: sd.morale,
      groups: sd.agents ? sd.agents.length : 0, doctrine: sd.doctrine ? { ...sd.doctrine } : null, manpower: sd.manpower * 1000,
      tone: tone(sd.readiness < 0.5, sd.readiness < 0.75 || (e.pay ?? 1) < 0.95),
    },
    diplomacy: { ...dip, tone: tone(dip.tense.length >= 3, dip.tense.length > 0 || dip.offers > 0) },
    wars: { list: wars, tone: tone(wars.some((w) => w.trend === 'lose'), wars.length > 0) },
    research: { list: research, done: sd.dev ? sd.dev.done.length : 0, tech: p.tech, tone: tone(false, !research.length || research.some((x) => x.stalled)) },
    production: { industry: p.production, efficiency: p.efficiency, trade: p.trade, partners: dip.partners.length, blockade: e.blockade || 0, tone: tone(false, (e.blockade || 0) > 0) },
    logistics: { supply: sup, supplyLvl: sd.supplyLvl ?? 0.5, roads: p.infra.roads, rail: p.infra.rail, ports: p.infra.ports, stock: sd.resources, tone: tone(sup < 0.55, sup < 0.8) },
    territory: {
      cells: sd.cells, km2: sd.km2 || 0, initial: sd.initial, occupied: sd.occupiedCells || 0, foreign: sd.heldForeign || 0,
      change: (sd.cells - sd.initial) / Math.max(1, sd.initial), occ: occupationOf(sim, k),
      tone: tone(sd.cells < sd.initial * 0.85, sd.cells < sd.initial || occupationOf(sim, k).contested > 0),
    },
    recent,
  };
}

// ======================= ALERTES =======================
// Alertes triées par gravité. target : panneau à ouvrir pour agir.
export function alerts(sim, k, n = null) {
  const d = dashboard(sim, k, n);
  const out = [];
  const add = (level, text, target) => out.push({ level, text, target });
  if (d.economy.crisis) add(3, 'Crise économique : la dette est devenue insoutenable.', 'eco');
  if (d.budget.pay < 0.95) add(3, `L'armée n'est payée qu'à ${Math.round(d.budget.pay * 100)} % : sa préparation baisse.`, 'eco');
  for (const w of d.wars.list) if (w.trend === 'lose') add(3, `${w.name} : votre camp perd du terrain (${pctTxt(w.myChange, 0)}).`, 'mil');
  if (d.stability.value < 0.35) add(3, `Stabilité très basse (${Math.round(d.stability.value * 100)} %) : risque de troubles.`, 'pop');
  if (d.logistics.supply < 0.55 && d.atWar) add(2, `Ravitaillement insuffisant au front (${Math.round(d.logistics.supply * 100)} %).`, 'mil');
  if (d.budget.deficit > 0.03) add(2, `Déficit de ${pctTxt(d.budget.deficit)} du PIB.`, 'eco');
  if (d.budget.debtRatio > 1.1) add(2, `Dette élevée : ${Math.round(d.budget.debtRatio * 100)} % du PIB.`, 'eco');
  if (d.economy.growthKnown && d.economy.growth < -0.005) add(2, `Récession : ${pctTxt(d.economy.growth)} sur un an.`, 'eco');
  if (d.resources.military < 15) add(2, 'Stocks militaires presque épuisés.', 'mil');
  if (d.territory.occ.contested) add(2, `${d.territory.occ.contested} zone(s) occupée(s) contestée(s) : partisans actifs, ravitaillement insuffisant.`, 'def');
  if (d.research.list.some((x) => x.stalled)) add(1, 'Un projet de recherche est suspendu faute de financement.', 'dev');
  if (!d.research.list.length && sim.rules.techTree !== false) add(1, 'Aucune recherche en cours.', 'dev');
  if (d.diplomacy.offers) add(1, `${d.diplomacy.offers} proposition(s) diplomatique(s) en attente.`, 'offers');
  if (n && n.decision) add(2, `Décision en attente : ${n.decision.title}.`, 'decision');
  if (d.military.readiness < 0.6) add(1, `Préparation de l'armée faible (${Math.round(d.military.readiness * 100)} %).`, 'def');
  if (d.diplomacy.tense.length) add(1, `Tensions fortes avec ${d.diplomacy.tense.map((o) => sim.sides[o].name).slice(0, 3).join(', ')}.`, 'diplo');
  return out.sort((a, b) => b.level - a.level);
}

// ======================= CONSEILLER =======================
// Diagnostics contextuels : pour chaque problème, les causes mesurées et des recommandations.
// Le conseiller n'agit jamais : chaque recommandation indique seulement où agir (target).
export function advise(sim, k, n = null) {
  const d = dashboard(sim, k, n);
  const sd = sim.sides[k], e = sd.eco, p = sd.p;
  const topics = [];
  const gdp = Math.max(0.1, e.gdp);

  // ---- économie ----
  {
    const causes = [], recs = [];
    if (sd.crisis) causes.push('Crise de la dette : les marchés ne prêtent plus, la stabilité s\'érode chaque mois.');
    if (d.atWar) causes.push(`L'économie de guerre freine la croissance (environ −${(1.5 + 3 * (sd.exhaustion || 0)).toFixed(1).replace('.', ',')} pt/an, épuisement ${Math.round((sd.exhaustion || 0) * 100)} %).`);
    if ((e.blockade || 0) > 0) causes.push(`Blocus naval : ${pctTxt((e.blockade || 0) / gdp)} du PIB perdu.`);
    if (sd.cells < sd.initial * 0.95) causes.push(`Territoire perdu (${pctTxt(1 - sd.cells / Math.max(1, sd.initial), 0)}) : moins de production et de recettes.`);
    if ((sd.infraDamage || 0) > 0.05) causes.push(`Infrastructures endommagées (−${Math.round(sd.infraDamage * 100)} % de production).`);
    if (sd.stability < 0.5) causes.push(`Stabilité basse (${Math.round(sd.stability * 100)} %) : l'activité et les recettes fiscales baissent.`);
    if (d.budget.interest > gdp * 0.03) causes.push(`Intérêts de la dette : ${bnTxt(d.budget.interest)} par an.`);
    if (d.budget.upkeep > gdp * 0.05) causes.push(`Entretien de l'armée élevé : ${pctTxt(d.budget.upkeep / gdp)} du PIB.`);
    if ((sd.austerity || 0) > 0.1) causes.push('Services publics réduits : la croissance et la stabilité en pâtissent.');
    if ((sd.techUpkeep || 0) > 0.004) causes.push(`Coût permanent des technologies coûteuses : ${pctTxt(sd.techUpkeep)} du PIB par an.`);
    if ((sd.unemp || 0) > 11) causes.push(`Chômage élevé (${r1(sd.unemp).toString().replace('.', ',')} %).`);
    if (d.budget.deficit > 0.02) recs.push({ text: 'Réduire le déficit : baisser légèrement le budget militaire ou relever les impôts (effet sur la stabilité).', target: 'eco' });
    if (d.atWar && d.wars.list.every((w) => w.trend !== 'win')) recs.push({ text: 'Une guerre qui ne progresse pas coûte cher : envisagez une paix négociée.', target: 'diplo' });
    if (!d.diplomacy.partners.length || d.diplomacy.partners.length < 3) recs.push({ text: 'Signer des accords commerciaux augmente les recettes.', target: 'diplo' });
    if (p.infra.roads < 45 || p.infra.rail < 40) recs.push({ text: 'Orienter les investissements vers les infrastructures (croissance à long terme).', target: 'eco' });
    if (d.research.list.length === 0) recs.push({ text: 'Lancer un projet économique dans l\'arbre technologique.', target: 'dev' });
    const kn = d.economy.growthKnown;
    const bad = (kn && d.economy.growth < 0.005) || sd.crisis || d.budget.deficit > 0.02;
    const gTxt = kn ? `croissance ${pctTxt(d.economy.growth)}` : 'croissance encore non mesurée (moins d\'un an)';
    topics.push({ id: 'economy', title: 'Économie', icon: 'coins', state: sd.crisis || (kn && d.economy.growth < -0.01) ? 'bad' : bad ? 'warn' : 'good',
      summary: bad ? `${gTxt[0].toUpperCase() + gTxt.slice(1)}, solde ${bnTxt(e.balance)} par an.` : `Économie saine : ${gTxt}.`, causes, recs });
  }

  // ---- guerres et armée ----
  {
    const causes = [], recs = [];
    for (const w of d.wars.list) {
      if (w.trend !== 'lose' && w.ratio > 0.9) continue;
      causes.push(`${w.name} : rapport de forces ${w.ratio.toFixed(2).replace('.', ',')} : 1${w.ratio < 1 ? ' en votre défaveur' : ''}.`);
    }
    if (d.atWar) {
      if (sd.readiness < 0.75) causes.push(`Préparation de ${Math.round(sd.readiness * 100)} % : l'armée est mal entretenue (financement ${Math.round((e.pay ?? 1) * 100)} %).`);
      if (sd.morale < 0.6) causes.push(`Moral bas (${Math.round(sd.morale * 100)} %).`);
      if (d.logistics.supply < 0.8) causes.push(`Ravitaillement à ${Math.round(d.logistics.supply * 100)} % : les troupes avancées s'épuisent.`);
      if (sd.p.tech < 40) causes.push(`Technologie militaire en retard (niveau ${Math.round(sd.p.tech)}).`);
      if ((sd.exhaustion || 0) > 0.5) causes.push(`Épuisement de guerre important (${Math.round(sd.exhaustion * 100)} %).`);
      const f = sd.doctrine || {};
      if ((f.arm || 0) < 0.08) causes.push('Très peu de blindés : les offensives en terrain ouvert sont faibles.');
      if ((f.art || 0) < 0.08) causes.push('Peu d\'artillerie : les fortifications adverses tiennent mieux.');
      if ((e.pay ?? 1) < 0.95) recs.push({ text: 'Payer intégralement l\'armée (budget militaire ou trésorerie) pour remonter la préparation.', target: 'def' });
      if (d.logistics.supply < 0.8) recs.push({ text: 'Consolider avant d\'avancer : le ravitaillement baisse avec la profondeur des conquêtes.', target: 'def' });
      if (d.wars.list.some((w) => w.ratio < 0.8)) recs.push({ text: 'Chercher des alliés ou rejoindre une coalition contre l\'adversaire.', target: 'diplo' });
      recs.push({ text: 'Adopter une posture défensive sur les fronts où vous êtes en infériorité.', target: 'def' });
      if (sd.p.tech < 50) recs.push({ text: 'Rechercher des technologies militaires (doctrine, défense, logistique).', target: 'dev' });
    }
    const losing = d.wars.list.some((w) => w.trend === 'lose');
    topics.push({ id: 'army', title: 'Armée et guerres', icon: 'swords', state: losing ? 'bad' : d.atWar ? 'warn' : sd.readiness < 0.6 ? 'warn' : 'good',
      summary: !d.atWar ? `En paix. Préparation ${Math.round(sd.readiness * 100)} %, puissance n° ${d.military.powerRank}.` : losing ? 'Votre camp recule sur au moins un front.' : 'Guerre en cours, fronts stables ou favorables.', causes, recs });
  }

  // ---- ravitaillement ----
  {
    const causes = [], recs = [];
    const frac = (sd.heldForeign || 0) / Math.max(50, sd.initial || 1);
    if (frac > 0.05) causes.push(`Vos troupes tiennent ${pctTxt(frac, 0)} de territoire étranger : plus on avance, plus les lignes s'allongent.`);
    if ((sd.supplyLvl ?? 0.5) < 0.6) causes.push(`Logistique nationale faible (niveau ${Math.round((sd.supplyLvl ?? 0.5) * 100)}).`);
    if (sd.resources < 30) causes.push(`Stocks militaires bas (${Math.round(sd.resources)} / 100) : chaque offensive en consomme.`);
    if (sd.readiness < 0.8) causes.push('Préparation insuffisante (entretien de l\'armée).');
    if (p.infra.roads < 45) causes.push(`Routes insuffisantes (${Math.round(p.infra.roads)} / 100).`);
    if (sim.rules.logistics === false) causes.length = 0;
    if (causes.length) {
      recs.push({ text: 'Rechercher les technologies de logistique et de transport.', target: 'dev' });
      recs.push({ text: 'Investir dans les infrastructures (routes, rail).', target: 'eco' });
      if (frac > 0.05) recs.push({ text: 'Laisser les régions conquises se stabiliser avant une nouvelle offensive.', target: 'def' });
    }
    topics.push({ id: 'supply', title: 'Ravitaillement', icon: 'truck', state: d.logistics.supply < 0.55 ? 'bad' : d.logistics.supply < 0.8 ? 'warn' : 'good',
      summary: `Ravitaillement estimé au front : ${Math.round(d.logistics.supply * 100)} %.`, causes, recs });
  }

  // ---- occupations ----
  {
    const o = d.territory.occ;
    const causes = [], recs = [];
    if (o.contested) {
      causes.push(`${o.contested} zone(s) contestée(s) : le ravitaillement n'y suffit pas, des partisans s'y soulèvent et peuvent les reprendre.`);
      recs.push({ text: 'Améliorer la logistique (technologies, routes) ou réduire la profondeur des conquêtes.', target: 'dev' });
      recs.push({ text: 'Renforcer les forces spéciales dans la composition de l\'armée (lutte contre les partisans).', target: 'def' });
    }
    if (o.semi) causes.push(`${o.semi} zone(s) semi-occupée(s) : elles deviendront occupées si elles restent calmes et ravitaillées.`);
    if (o.semi || o.occupied || o.contested) topics.push({ id: 'occupation', title: 'Occupations', icon: 'map-pin', state: o.contested ? 'warn' : 'good',
      summary: `Semi-occupé ${o.semi} · occupé ${o.occupied} · contesté ${o.contested} (parcelles).`, causes, recs });
  }

  // ---- stabilité ----
  {
    const causes = [], recs = [];
    const pol = n && n.policy;
    if (pol && pol.tax > 1.08) causes.push(`Impôts élevés (${Math.round(pol.tax * 100)} % du niveau de base).`);
    if (pol && pol.services < 0.92) causes.push(`Services publics réduits (${Math.round(pol.services * 100)} %).`);
    if ((sd.unemp || 0) > 11) causes.push('Chômage élevé.');
    if (sd.crisis) causes.push('Crise économique.');
    if (sd.cells < sd.initial * 0.9) causes.push('Pertes territoriales.');
    if (causes.length && sd.stability < 0.6) {
      if (pol && pol.services < 1) recs.push({ text: 'Rétablir les services publics.', target: 'eco' });
      if (pol && pol.tax > 1.05) recs.push({ text: 'Baisser la pression fiscale si le budget le permet.', target: 'eco' });
      recs.push({ text: 'Technologies sociales et de santé : stabilité durable.', target: 'dev' });
    }
    topics.push({ id: 'stability', title: 'Stabilité', icon: 'scale', state: d.stability.tone, summary: `Stabilité ${Math.round(sd.stability * 100)} %.`, causes: sd.stability < 0.6 ? causes : [], recs });
  }

  // ---- recherche ----
  if (sim.rules.techTree !== false) {
    const causes = [], recs = [];
    const list = d.research.list;
    if (!list.length) { causes.push('Aucun projet en cours : vos rivaux progressent pendant ce temps.'); recs.push({ text: 'Choisir un projet dans l\'arbre technologique (filtre « Conseillé »).', target: 'dev' }); }
    for (const x of list) if (x.stalled) causes.push(`« ${x.name} » est suspendu : la trésorerie ne couvre pas son coût mensuel.`);
    if (list.some((x) => x.stalled)) recs.push({ text: 'Rétablir la trésorerie ou abandonner un projet trop coûteux.', target: 'dev' });
    topics.push({ id: 'research', title: 'Recherche', icon: 'network', state: list.some((x) => x.stalled) ? 'warn' : !list.length ? 'warn' : 'good',
      summary: list.length ? list.map((x) => `${x.name} (${Math.round(x.progress * 100)} %)`).join(', ') + '.' : 'Aucune recherche en cours.', causes, recs });
  }

  // ---- diplomatie : refus récents expliqués ----
  {
    const refusals = n ? recentRefusals(sim, n, 4) : [];
    const causes = refusals.map((r) => `${sim.sides[r.to].name} a refusé « ${r.label} » : ${r.reasons.join(', ') || 'aucune raison précise'}.`);
    const recs = [];
    if (refusals.some((r) => r.reasons.some((x) => /relations/i.test(x)))) recs.push({ text: 'Améliorer d\'abord les relations (aide financière, réduction des tensions, commerce).', target: 'diplo' });
    if (refusals.some((r) => r.reasons.some((x) => /sollicitations/i.test(x)))) recs.push({ text: 'Espacer les propositions : les demandes répétées agacent.', target: 'diplo' });
    if (refusals.some((r) => r.reasons.some((x) => /confiance|trahison/i.test(x)))) recs.push({ text: 'Respecter vos accords : la confiance remonte lentement.', target: 'diplo' });
    if (refusals.some((r) => r.type === 'peace')) recs.push({ text: 'Demandes de paix refusées : réduire les exigences territoriales ou améliorer la situation militaire.', target: 'mil' });
    topics.push({ id: 'diplomacy', title: 'Diplomatie', icon: 'handshake', state: refusals.length ? 'warn' : 'good',
      summary: refusals.length ? `${refusals.length} refus récent(s) expliqué(s).` : `${d.diplomacy.allies.length} allié(s), ${d.diplomacy.partners.length} partenaire(s) commercial(aux).`, causes, recs });
  }
  const rank = { bad: 0, warn: 1, good: 2 };
  return topics.sort((a, b) => rank[a.state] - rank[b.state]);
}

// refus récents d'une IA, avec leurs facteurs négatifs (explication « pourquoi ce pays refuse »)
export function recentRefusals(sim, n, max = 5, since = YEAR_SEC) {
  const out = [];
  const labels = { trade: 'accord commercial', nap: 'pacte de non-agression', alliance: 'alliance', aid: 'aide', detente: 'réduction des tensions', peace: 'paix' };
  for (const [key, list] of Object.entries(n.logs || {})) {
    const to = Number(key);
    if (!sim.sides[to]) continue;
    for (let i = list.length - 1; i >= 0; i--) {
      const l = list[i];
      if (sim.time - l.t > since) break;
      if (l.from !== 'ai' || (l.kind !== 'refuse' && l.kind !== 'counter') || !l.type) continue;
      const reasons = (l.factors || []).filter((f) => f.v < 0).sort((a, b) => a.v - b.v).slice(0, 3).map((f) => f.label.toLowerCase());
      out.push({ to, t: l.t, type: l.type, label: labels[l.type] || l.type, counter: l.kind === 'counter', reasons });
      break;
    }
  }
  return out.sort((a, b) => b.t - a.t).slice(0, max);
}

// ======================= RÉCAPITULATIF ANNUEL =======================
// Compare deux bilans annuels (nation.timeline) et rassemble les faits marquants de l'année
// (jalons de la chronologie nationale). Fonctionne aussi avec les anciennes sauvegardes (champs absents).
export function annualRecap(n, sim, index = null) {
  const tl = (n && n.timeline) || [];
  if (tl.length < 2) return null;
  const i = index === null ? tl.length - 1 : index;
  if (i < 1 || i >= tl.length) return null;
  const a = tl[i - 1], b = tl[i];
  const diff = (key) => (a[key] !== undefined && b[key] !== undefined ? b[key] - a[key] : null);
  const rel = (key) => (a[key] ? (b[key] - a[key]) / a[key] : null);
  const ms = ((n && n.milestones) || []).filter((m) => m.t > a.t && m.t <= b.t);
  const pick = (types) => ms.filter((m) => types.includes(m.type)).map((m) => m.text);
  const sd = sim ? sim.sides[n.player !== undefined ? n.player : 0] : null;
  return {
    year: a.year, nextYear: b.year,
    gdp: { from: a.gdp, to: b.gdp, change: rel('gdp') }, pc: { from: a.pc, to: b.pc, change: rel('pc') },
    pop: { from: a.pop, to: b.pop, change: rel('pop') },
    money: { from: a.money, to: b.money, change: diff('money') }, debt: { from: a.debt, to: b.debt, change: diff('debt') },
    territory: { from: a.km2 || a.cells, to: b.km2 || b.cells, change: a.km2 !== undefined ? diff('km2') : diff('cells'), unit: a.km2 !== undefined ? 'km²' : 'parcelles' },
    stability: { from: a.stability, to: b.stability, change: diff('stability') },
    tech: { from: a.tech, to: b.tech, change: diff('tech') },
    soldiers: { from: a.soldiers, to: b.soldiers, change: diff('soldiers') },
    power: { from: a.power, to: b.power, change: rel('power') }, powerRank: { from: a.powerRank, to: b.powerRank }, gdpRank: { from: a.gdpRank, to: b.gdpRank },
    losses: b.losses !== undefined && a.losses !== undefined ? Math.max(0, b.losses - a.losses) : null,
    wars: { active: b.wars ?? null, events: pick(['war', 'treaty']) },
    diplomacy: { allies: { from: a.allies, to: b.allies }, events: pick(['diplo', 'alliance']) },
    techs: b.techs && a.techs ? b.techs.filter((x) => !a.techs.includes(x)).map((x) => (TECH_BY_ID[x] || {}).name || x) : pick(['reform']).map((x) => x.replace(/^Réforme achevée : /, '').replace(/\.$/, '')),
    events: pick(['event', 'decision', 'objective']).slice(-8),
    alive: sd ? !sd.eliminated : true,
  };
}

// champs supplémentaires des bilans annuels (ajoutés au bilan existant, ignorés par les anciennes sauvegardes)
export function yearExtras(sim, k) {
  const sd = sim.sides[k];
  return {
    techs: sd.dev ? sd.dev.done.slice() : [],
    losses: Math.round((sd.lossesTotal || 0) * 1000),
    wars: sim.wars.filter((w) => w.status === 'active' && (w.a.includes(k) || w.b.includes(k))).length,
    air: r1(sd.air || 0), navy: r1(sd.navy || 0),
  };
}

