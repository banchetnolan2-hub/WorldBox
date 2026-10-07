// ÉCONOMIE — mise à jour mensuelle d'un pays (toutes les 10 s simulées = 30 jours).
// PIB -> recettes ; dépenses = administration + entretien de l'armée + intérêts + opérations ;
// solde -> trésorerie / dette ; investissements (recherche, infrastructures, économie) ;
// recrutement limité par la population mobilisable, l'argent et l'industrie ;
// armée non payée -> préparation (entretien) en baisse -> efficacité en baisse.
import { economyOf, unitCost, UNIT_COST, interestRate, quality } from './profile.js';
import { TERRAIN_ATK } from './geo.js';

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const W_ATK = { inf: 1, arm: 2.2, art: 1.6, rec: 0.9 };
export const W_DEF = { inf: 1.15, arm: 1.6, art: 1.45, rec: 0.7 };
export const LAND = ['inf', 'arm', 'art', 'rec'];

// initialisation de l'état économique et militaire d'un participant à partir de son profil
export function initSideEconomy(sd, p, popMult = 1, powerMult = 1, resMult = 1) {
  sd.p = p;
  sd.pop = p.population * popMult;
  const eco = economyOf(p, sd.pop);
  sd.gdpBase = eco.gdp;
  sd.pc = eco.pc;
  sd.money = p.money * Math.sqrt(popMult);
  sd.debt = p.debt * Math.sqrt(popMult);
  const k = powerMult * (popMult > 1 ? Math.pow(popMult, 0.33) : Math.pow(popMult, 0.5));
  sd.army = { inf: p.army.inf * k, arm: p.army.arm * k, art: p.army.art * k, rec: p.army.rec * k };
  sd.air = p.army.air * k;
  sd.navy = p.army.navy * k;
  const land = sd.army.inf + sd.army.arm + sd.army.art + sd.army.rec;
  sd.doctrine = { inf: sd.army.inf / land, arm: sd.army.arm / land, art: sd.army.art / land, rec: sd.army.rec / land };
  sd.units = land * 0.85;
  for (const t of LAND) sd.army[t] *= 0.85;
  sd.maxUnits = land;
  sd.initialLand = land;
  sd.initialAir = sd.air; sd.initialNavy = sd.navy;
  sd.resMult = resMult;
  sd.readiness = 0.92;
  sd.morale = 0.72 + 0.3 * p.politics.cohesion / 100;
  sd.exhaustion = 0;
  sd.manpower = Math.max(land * 0.4, sd.pop * (0.006 + 0.028 * p.politics.cohesion / 100) / 1000 - land);
  const cost = unitCost(p, eco.pc);
  sd.unitCostBn = cost;
  // cible de dépense militaire initiale : l'entretien actuel
  sd.milTarget = armyUpkeepSide(sd) * 1.0;
  sd.milBase = sd.milTarget;
  sd.budget = { research: 0.3, infra: 0.3, econ: 0.4 };
  sd.austerity = 0;
  sd.airShare = 0;
  const dv = p.derived || {};
  sd.eco = { gdp: eco.gdp, income: eco.gdp * p.taxRate, expenses: (p.civil || 0) + sd.milTarget + (dv.interest || 0), upkeep: sd.milTarget, balance: eco.gdp * p.taxRate - (p.civil || 0) - sd.milTarget - (dv.interest || 0), trade: 0, blockade: 0, ops: 0, research: 0, infra: 0, econ: 0, interest: dv.interest || 0, civil: p.civil || 0, pay: 1 };
  sd.opsAcc = 0;
  sd.infraDamage = 0;
  sd.crisis = false;
  sd.lastMonth = 0;
  sd.tradePartners = [];
  refreshCombat(sd);
}

export function armyUpkeepSide(sd) {
  const c = sd.unitCostBn;
  const a = sd.army;
  return c * (a.inf * UNIT_COST.inf + a.arm * UNIT_COST.arm + a.art * UNIT_COST.art + a.rec * UNIT_COST.rec + sd.air * UNIT_COST.air + sd.navy * UNIT_COST.navy);
}
export function landTotal(sd) { const a = sd.army; return a.inf + a.arm + a.art + a.rec; }

// caches de combat (recalculés régulièrement)
export function refreshCombat(sd) {
  const land = Math.max(1e-6, landTotal(sd));
  const f = { inf: sd.army.inf / land, arm: sd.army.arm / land, art: sd.army.art / land, rec: sd.army.rec / land };
  sd.frac = f;
  const q = quality(sd.p.tech, sd.p.equip) * (0.55 + 0.45 * sd.readiness);
  sd.q = q;
  sd.atkT = [0, 1, 2, 3, 4, 5].map((b) => (f.inf * W_ATK.inf * TERRAIN_ATK.inf[b] + f.arm * W_ATK.arm * TERRAIN_ATK.arm[b] + f.art * W_ATK.art * TERRAIN_ATK.art[b] + f.rec * W_ATK.rec * TERRAIN_ATK.rec[b]) * q);
  sd.defC = (f.inf * W_DEF.inf + f.arm * W_DEF.arm + f.art * W_DEF.art + f.rec * W_DEF.rec) * q;
  sd.airPow = sd.air * q;
  sd.navPow = sd.navy * q;
  sd.units = land;
}

// pertes de combat réparties selon la composition (les blindés s'usent plus en attaque)
export function applyLosses(sd, amount, attacking) {
  if (amount <= 0) return;
  const land = landTotal(sd);
  if (land <= 1) return;
  const a = sd.army;
  const wArm = attacking ? 1.3 : 0.9, wArt = attacking ? 0.6 : 0.8;
  const tot = a.inf + a.arm * wArm + a.art * wArt + a.rec * 1.1;
  const k = Math.min(0.5, amount * (1 + (sd.casualtyK || 0)) / tot);      // médecine militaire, protection des blindés
  a.inf -= a.inf * k; a.arm -= a.arm * wArm * k; a.art -= a.art * wArt * k; a.rec -= a.rec * 1.1 * k;
  sd.lossArm = (sd.lossArm || 0) + a.arm / Math.max(1e-6, 1 - wArm * k) * wArm * k;
  sd.lossArt = (sd.lossArt || 0) + a.art / Math.max(1e-6, 1 - wArt * k) * wArt * k;
  sd.units = landTotal(sd);
  sd.lossesTotal = (sd.lossesTotal || 0) + amount;
  sd.manpower = Math.max(0, sd.manpower - amount * 0.15);
}

/**
 * Mois écoulé pour un pays. ctx : { terrFactor, occShare, atWar, blockade, tradeBonus, frontTerrain[6], opsCost }
 * Retourne une liste d'événements (crise économique, etc.).
 */
export function monthTick(sd, ctx) {
  const p = sd.p;
  const out = [];
  const stab = sd.stability;
  // PIB : territoire (zones occupées peu productives), stabilité, dégâts de guerre, commerce, blocus
  const warDrag = ctx.atWar ? 0.94 - 0.08 * sd.exhaustion : 1;
  // la stabilité de départ est déjà comprise dans le PIB réel de départ : seul l'écart compte
  const stab0 = sd.stab0 ?? (sd.stab0 = stab);
  const tb0 = sd.tb0 ?? (sd.tb0 = ctx.tradeBonus - ctx.blockade);
  const gdp = sd.gdpBase * Math.pow(Math.max(0.05, ctx.terrFactor), 0.85) * (0.7 + 0.3 * stab) / (0.7 + 0.3 * stab0) * warDrag * (1 + ctx.tradeBonus - ctx.blockade) / (1 + tb0) * (1 - Math.min(0.3, sd.infraDamage)) * (1 - (ctx.drag || 0));   // sanctions, crises mondiales
  const m = 1 / 12;
  const income = gdp * p.taxRate * (0.85 + 0.15 * stab) * m * (ctx.taxK ?? 1);
  const upkeepFull = armyUpkeepSide(sd) * m;
  const useDebt = ctx.debt !== false;
  const interest = useDebt ? sd.debt * interestRate(sd.debt / Math.max(1, gdp)) * m * (ctx.interestK ?? 1) : 0;
  const civil = p.civil * (gdp / Math.max(1, sd.eco.gdp0 || gdp)) ** 0.5 * (1 - sd.austerity) * m;
  const ops = ctx.opsCost || 0;
  // l'armée est payée en priorité après l'administration ; au-delà de la capacité d'emprunt : sous-entretien
  const debtCap = useDebt ? gdp * 1.6 : 0;
  const avail = sd.money + income + (useDebt ? Math.max(0, debtCap - sd.debt) * 0.08 : 0) - civil - interest;
  const pay = clamp(avail / Math.max(1e-6, upkeepFull + ops), 0, 1);
  const upkeep = upkeepFull * pay;
  let balance = income - civil - interest - upkeep - ops * pay;
  // investissements : une partie de l'excédent, ou un minimum même en déficit si le pays est solide
  const surplus = balance + sd.money * 0.02;
  const invest = Math.max(0, surplus) * 0.7 + gdp * m * 0.004 * (sd.money > gdp * 0.02 ? 1 : 0);
  const b = sd.budget;
  const inv = { research: invest * b.research, infra: invest * b.infra, econ: invest * b.econ };
  balance -= invest;
  sd.money += balance;
  if (sd.money < 0) { if (useDebt) sd.debt += -sd.money; sd.money = 0; }
  else if (sd.debt > 0 && sd.money > gdp * 0.08) { const r = Math.min(sd.debt, (sd.money - gdp * 0.08) * 0.25); sd.debt -= r; sd.money -= r; }
  // préparation de l'armée : suit le niveau de financement
  sd.readiness = clamp(sd.readiness + (clamp(pay, 0, 1) * (0.9 + 0.1 * p.efficiency / 100 + (sd.devReadiness || 0)) - sd.readiness) * 0.35, 0.15, 1);
  // effets des investissements (sur plusieurs années)
  const gy = Math.max(1, gdp);
  if (ctx.research !== false) p.tech = clamp(p.tech + (inv.research / (gy * 0.02) * 0.6 + 0.01) * (1 + (sd.devResearch || 0)), 1, 100);
  p.research = clamp(p.research * 0.98 + 100 * Math.min(1, inv.research / (gy * m * 0.03)) * 0.02, 1, 100);
  const infraGain = inv.infra / (gy * 0.03) * 0.8;
  for (const k of ['roads', 'rail', 'airports']) p.infra[k] = clamp(p.infra[k] + infraGain - sd.infraDamage * 0.4, 1, 100);
  sd.infraDamage = Math.max(0, sd.infraDamage * 0.93 - infraGain * 0.002);
  const growth = (0.012 + 0.022 * (1 - p.tech / 100)) * (ctx.growthK ?? 1) + inv.econ / gy * 1.2 - (ctx.atWar ? 0.015 + 0.03 * sd.exhaustion : 0) - (sd.crisis ? 0.03 : 0) + (sd.devGrowth || 0) + (sd.policyGrowth || 0);
  sd.gdpBase *= 1 + growth * m;
  // population, réservistes
  sd.pop *= 1 + (p.popGrowth / 100) * m * (ctx.atWar ? 0.6 : 1);
  const mobil = 0.006 + 0.028 * p.politics.cohesion / 100 + (ctx.atWar ? 0.01 : 0);
  const pool = sd.pop * mobil / 1000;
  sd.manpower = clamp(sd.manpower + pool * 0.004, 0, Math.max(0, pool - landTotal(sd)) + pool * 0.05);
  // recrutement / démobilisation vers la cible fixée par l'IA
  const perLand = sd.unitCostBn * (UNIT_COST.inf * sd.doctrine.inf + UNIT_COST.arm * sd.doctrine.arm + UNIT_COST.art * sd.doctrine.art + UNIT_COST.rec * sd.doctrine.rec);
  const airNavy = sd.unitCostBn * (sd.air * UNIT_COST.air + sd.navy * UNIT_COST.navy);
  const landBudget = Math.max(0, sd.milTarget - airNavy);
  const targetLand = landBudget / Math.max(1e-6, perLand);
  const land = landTotal(sd);
  if (land < targetLand && sd.money > 0 && ctx.mobilization !== false) {
    const heavyCap = 0.5 + sd.p.production / 100 * 2.5 * Math.sqrt(gdp / 500 + 0.2);
    let d = Math.min(targetLand - land, targetLand * 0.07 * (1 + (sd.devRecruit || 0)) * (ctx.recruitK ?? 1), sd.manpower, sd.money / Math.max(1e-6, perLand * 0.5));
    d = Math.max(0, d);
    const heavy = d * (sd.doctrine.arm + sd.doctrine.art);
    const kHeavy = heavy > heavyCap ? heavyCap / heavy : 1;
    for (const t of LAND) sd.army[t] += d * sd.doctrine[t] * (t === 'arm' || t === 'art' ? kHeavy : 1);
    sd.manpower -= d;
    sd.money -= d * perLand * 0.45;
    sd.recruited = (sd.recruited || 0) + d;
  } else if (land > targetLand * 1.05) {
    const d = Math.min(land - targetLand, land * 0.05);
    for (const t of LAND) sd.army[t] -= d * (sd.army[t] / land);
    sd.manpower += d * 0.8;
  }
  // aviation et marine : construites si le budget et l'industrie le permettent
  const airTarget = sd.initialAir * (sd.milTarget / Math.max(1e-6, sd.milBase)) * (1 + sd.airShare);
  if (sd.air < airTarget && sd.money > 0) { const d = Math.min(airTarget - sd.air, 0.4 + airTarget * 0.04 * p.production / 60); sd.air += d; sd.money -= d * sd.unitCostBn * UNIT_COST.air * 0.8; }
  else if (sd.air > airTarget * 1.15) sd.air -= (sd.air - airTarget) * 0.05;
  const navTarget = sd.initialNavy * (sd.milTarget / Math.max(1e-6, sd.milBase)) * (1 + (sd.navalFocus || 0)) * (p.infra.ports > 5 ? 1 : 0);
  if (sd.navy < navTarget && sd.money > 0) { const d = Math.min(navTarget - sd.navy, 0.25 + navTarget * 0.03 * p.production / 60); sd.navy += d; sd.money -= d * sd.unitCostBn * UNIT_COST.navy * 0.8; }
  else if (sd.navy > navTarget * 1.2) sd.navy -= (sd.navy - navTarget) * 0.04;
  // crise économique : dette excessive ou trésorerie vide avec un déficit important
  const debtRatio = sd.debt / gy;
  const wasCrisis = sd.crisis;
  sd.debtRatio0 = sd.debtRatio0 ?? debtRatio;
  const dk = ctx.debtK ?? 1;
  sd.crisis = ctx.crises !== false && (debtRatio > Math.max(1.45 * dk, sd.debtRatio0 + 0.45 * dk) || (sd.money <= 0 && balance < -income * 0.4 && debtRatio > 0.9 * dk));
  if (sd.crisis && !wasCrisis) out.push({ type: 'crisis' });
  if (!sd.crisis && wasCrisis) out.push({ type: 'recovery' });
  if (sd.crisis) sd.stability = Math.max(0.15, sd.stability - 0.015);
  sd.eco = {
    gdp0: sd.eco.gdp0 || gdp, gdp, income: income * 12, expenses: (civil + interest + upkeep + ops * pay + invest) * 12, upkeep: upkeep * 12,
    upkeepFull: upkeepFull * 12, balance: (income - civil - interest - upkeep - ops * pay - invest) * 12, trade: ctx.tradeBonus * gdp, blockade: ctx.blockade * gdp,
    ops: ops * 12, research: inv.research * 12, infra: inv.infra * 12, econ: inv.econ * 12, interest: interest * 12, civil: civil * 12, pay,
  };
  refreshCombat(sd);
  return out;
}
