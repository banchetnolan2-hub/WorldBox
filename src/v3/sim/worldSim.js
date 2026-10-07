// SIMULATION V3 — moteur mondial vivant, déterministe et sérialisable.
// Systèmes reliés entre eux :
//  • géographie par parcelle (relief, biomes, rivières) -> combat, vitesse, frontières naturelles ;
//  • profils de pays (population, économie, armée, infrastructures, technologie, ressources,
//    politique) -> économie mensuelle (budget, dette, recrutement, entretien, recherche) ;
//  • fronts par secteurs (actif / inactif / en progression / bloqué / en recul) ;
//  • combat multi-facteurs : forces locales, composition (infanterie, blindés, artillerie,
//    reconnaissance), terrain, qualité, préparation, ravitaillement, moral, fortifications,
//    soutien aérien, supériorité navale — jamais « A > B donc A gagne » ;
//  • IA par pays (perception -> analyse -> objectifs -> plan -> action -> résultat -> mémoire) ;
//  • diplomatie (relations, alliances, entrées en guerre, paix), guerres complètes (conditions de
//    fin, négociation, traité, BORDER CLEANUP, rapports), histoire des pays et du monde.
// Pas de temps fixe (TICK) : la vitesse d'affichage ne change pas le résultat pour une seed donnée.

import { RNG } from './rng.js';
import { pickEvent, EVENTS_BY_ID } from './events.js';
import { distKm, EARTH_R } from '../world/worldGrid.js';
import { greatCircle, polylineLengthKm } from '../world/navigation.js';
import { computeGeo, TERRAIN_DEF, TERRAIN_SPEED, RIVER_DEF } from './geo.js';
const TERRAIN_COST = TERRAIN_SPEED.map((v) => 1 / v);   // coût de passage d'un terrain (itinéraires)
import { profileOf, deriveProfile, PERSONALITIES, recomputeProfile } from './profile.js';
import { initSideEconomy, monthTick, applyLosses, refreshCombat, landTotal, armyUpkeepSide } from './economy.js';
import { cellBins, rebuildSectors, pickSector, defenseDensity, secKey, frontAcc } from './fronts.js';
import { initAI, aiOperational, aiStrategic, aiLog, powerOf } from './ai.js';
import { updateCoalitions, coalitionAttackBonus, serializeCoalitions, restoreCoalitions } from './coalitions.js';
import { updateCrises, serializeCrises, restoreCrises, sanctionedBetween, sanctionDrag, globalCrisisEffect } from './crises.js';
import { normalizeWarEnd, territorialEffects } from './warEnd.js';
import { startWar, joinWar, endWar, concludeTreaty, checkWars, noteChange, updateBattles, serializeWar, restoreWar, DEFAULT_WAR_END, addRel } from './wars.js';
import { MONTH_SEC, YEAR_SEC, fmtDate } from './calendar.js';
import { de } from './fr.js';
import { globalTidy } from './reorg.js';
import { Nation } from './nation.js';
import { commandView } from '../net/commands.js';
import { applyGeopolitics } from './geopolitics.js';
import { resolveRules } from './rules.js';
import { findScenario } from './scenarios.js';

export const TICK = 0.05;
const NONE = 65535;

export const TUNE = {
  rate: 0.75,        // actions par cellule de front et par seconde
  logitK: 2.1,
  localK: 0.3,
  momRevert: 0.06,
  momSigma: 0.12,
  momSigmaR: 0.35,
  momMax: 0.8,
  supply: 0.5,
  desperation: 0.25,
  ramp: 0.8,
  density: 2.2,       // unités par cellule de front pour une pression « normale »
  lossK: 0.0013,      // pertes par action (proportionnelles à la densité locale)
};

export const DEFAULTS = {
  seed: 'MONDE1',
  eventRate: 1,
  randomness: 0.5,
  maxDuration: 300,
  victoryRatio: 0.35,
  pace: 1,
  naval: true,
  maxAgents: 520,
  maxTransports: 70,
  maxFleets: 60,
  neutralCapture: true, // les zones grises (sans propriétaire / territoires neutres) peuvent être conquises
  integrationDelay: 22,  // secondes de contrôle avant qu'une zone occupée devienne officiellement intégrée
  warStart: 'war',       // 'war' : les camps sont en guerre dès le départ ; 'tensions' : l'IA décide
  aiWars: true,          // l'IA peut déclarer de nouvelles guerres
  peaceEnd: 45,          // fin de simulation après cette durée sans aucune guerre (s)
  startDay: 0,           // jours depuis le 1er janvier 2025
};

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const sigmoid = (x) => 1 / (1 + Math.exp(-x));

// Nombre d'unités (ancienne formule, conservée pour compatibilité)
export function computeMaxUnits(stats, population, powerMult = 1) {
  const popM = Math.max(0.0005, population / 1e6);
  const u = 38
    * Math.pow(popM, 0.33)
    * Math.pow(Math.max(5, stats.economie) / 50, 0.8)
    * Math.pow(Math.max(5, stats.puissance) / 50, 1.1)
    * (0.7 + 0.6 * stats.ressources / 100)
    * (0.6 + 0.8 * stats.stabilite / 100)
    * powerMult;
  return Math.max(5, Math.round(u));
}

function b64(typed) {
  const u8 = new Uint8Array(typed.buffer, typed.byteOffset, typed.byteLength);
  let s = '';
  for (let k = 0; k < u8.length; k += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(k, k + 0x8000));
  return typeof btoa !== 'undefined' ? btoa(s) : Buffer.from(u8).toString('base64');
}
function unb64(str, Type) {
  let u8;
  if (typeof atob !== 'undefined') {
    const s = atob(str);
    u8 = new Uint8Array(s.length);
    for (let k = 0; k < s.length; k++) u8[k] = s.charCodeAt(k);
  } else u8 = new Uint8Array(Buffer.from(str, 'base64'));
  return new Type(u8.buffer, 0, u8.byteLength / Type.BYTES_PER_ELEMENT);
}

// profil utilisé pour un participant (réglages du créateur pris en compte)
export function participantProfile(ent, p, geo) {
  let prof;
  if (p.stats) prof = deriveProfile({ ...ent, stats: { ...ent.stats, ...p.stats } }, geo);
  else prof = profileOf(ent, geo);
  if (p.personality && PERSONALITIES[p.personality]) prof.personality = p.personality;
  else if (p.strategy === 'agressive') prof.personality = 'expansionist';
  else if (p.strategy === 'defensive') prof.personality = 'defensive';
  if (p.units || ent.unitsOverride) {
    const target = p.units || ent.unitsOverride;
    const land = prof.army.inf + prof.army.arm + prof.army.art + prof.army.rec;
    const k = target / Math.max(1, land);
    for (const key of Object.keys(prof.army)) prof.army[key] *= k;
  }
  return recomputeProfile(prof);
}

export class WorldSim {
  /**
   * @param grid   grille mondiale (worldGrid)
   * @param nav    Navigator (routes maritimes) — optionnel
   * @param world  { owner: Uint16Array, entities: [...] }
   * @param setup  { participants: [{ e, team, powerMult, popMult, resMult, strategy, personality }], teams: [{ name, color }], options }
   * @param restore état sauvegardé (serialize)
   * @param env    { geo } géographie calculée (relief) — optionnelle
   */
  constructor(grid, nav, world, setup, restore = null, env = {}) {
    this.grid = grid;
    this.nav = nav;
    this.entities = world.entities;
    this.cfg = { ...DEFAULTS, ...setup.options };
    if (!this.cfg.warEnd) this.cfg.warEnd = { ...DEFAULT_WAR_END, percent: 1 - (this.cfg.victoryRatio ?? 0.35) };
    // fin des guerres : mode Nation = pas de paix automatique (le joueur décide de la paix)
    this.cfg.warEnd = normalizeWarEnd(this.cfg.warEnd, !!this.cfg.nation);
    // règles de la partie (systèmes actifs) : consultées partout dans la simulation
    // un scénario impose ses règles (même si l'interface ne les a pas transmises, ex. ancienne sauvegarde)
    const scn = this.cfg.nation && this.cfg.nation.scenario ? findScenario(this.cfg.nation.scenario, this.cfg.nation.scenarioSpec) : null;
    this.rules = resolveRules({ ...this.cfg, mode: this.cfg.mode || setup.mode, lockedRules: { ...((scn && scn.rules) || {}), ...(this.cfg.lockedRules || {}) } });
    if (this.rules.peace === false) this.cfg.warEnd = { ...this.cfg.warEnd, peace: false };
    if (this.rules.wars === false) { this.cfg.warStart = 'tensions'; this.cfg.aiWars = false; }
    this.teams = setup.teams.map((t) => ({ ...t }));
    this.geo = env.geo || grid._geo || computeGeo(grid, null);
    this.details = env.details || null;   // villes, régions, ports réels (Terre uniquement)
    this.bins = grid._bins || (grid._bins = cellBins(grid));
    const n = grid.n;
    this.n = n;
    this.owner = restore ? unb64(restore.owner, Uint16Array) : Uint16Array.from(world.owner);
    this.origin = restore ? unb64(restore.origin, Uint16Array) : Uint16Array.from(this.owner);
    this.sideOf = new Int16Array(65536).fill(-1);
    this.neutralOwner = new Uint8Array(65536);
    if (this.cfg.neutralCapture) {
      this.neutralOwner[65535] = 1;
      this.entities.forEach((e, k) => { if (e && e.kind === 'neutral') this.neutralOwner[k] = 1; });
    }
    this.borderPos = new Int32Array(n).fill(-1);
    this.contest = new Float32Array(n);
    this.isolated = new Uint8Array(n);
    this.lastFlip = new Float32Array(n).fill(-999);
    this.occupied = restore && restore.occupied ? unb64(restore.occupied, Uint8Array) : new Uint8Array(n);
    this.occList = [];
    for (let i = 0; i < n; i++) if (this.occupied[i]) this.occList.push(i);
    this.captures = [];
    this.eventsOut = [];
    this.log = [];
    this.history = [];
    this.transports = [];
    this.docked = [];
    this.strikes = [];
    this.fleets = [];
    this.regional = null;
    this.finished = false;
    this.result = null;
    this._id = 0;
    this._warId = 0;
    this.time = 0;
    this.tickCount = 0;
    this.rng = new RNG(String(this.cfg.seed));
    this.wars = [];
    this.activeWars = [];
    this.endedWars = [];
    this.battles = {};
    this.chronicle = [];
    this.hadWar = false;
    this.peaceSince = null;

    // ----- pays participants -----
    this.sides = setup.participants.map((p, k) => this._makeSide(p, k));
    const S = this.S = this.sides.length;
    this.sides.forEach((s, k) => { this.sideOf[s.e] = k; });
    for (let i = 0; i < n; i++) { const s = this.sideOf[this.owner[i]]; if (s >= 0) this.sides[s].cells++; }
    const coast = new Float64Array(S);
    for (let i = 0; i < n; i++) { const s = this.sideOf[this.owner[i]]; if (s >= 0 && grid.coastal[i]) coast[s]++; }
    for (const s of this.sides) { s.initial = Math.max(1, s.cells); s.peak = s.cells; s.km2 = 0; }
    for (let i = 0; i < n; i++) { const s = this.sideOf[this.owner[i]]; if (s >= 0) this.sides[s].km2 += this.geo.km2[i]; }
    this.sides.forEach((s, k) => {
      const ent = this.entities[s.e];
      const prof = participantProfile(ent, setup.participants[k], { coastShare: Math.min(1, coast[k] / Math.max(1, s.cells) * 4) });
      const p = setup.participants[k];
      initSideEconomy(s, prof, p.popMult || 1, p.powerMult || 1, p.resMult || 1);
      s.population = s.pop;
      s.baseStability = 0.45 + prof.politics.stability / 200;
      s.stability = s.baseStability;
      s.supplyLvl = prof.derived.supply;
      s.speedK = prof.derived.speed;
      s.nextMonth = MONTH_SEC * (0.3 + (k % 10) / 10 * 0.7);
    });
    this._countOccupied();
    for (const s of this.sides) s.capital = this._findCapital(s);
    for (const t of this.teams) t.initial = 0;
    for (const s of this.sides) this.teams[s.team].initial += s.cells;
    // matrices diplomatiques
    this.rel = new Float32Array(S * S);
    this.allied = new Uint8Array(S * S);
    this.truce = new Float32Array(S * S);
    this.atWar = new Uint8Array(S * S);
    this.contact = new Uint16Array(S * S);
    this.nearCap = new Uint8Array(S * S);
    this.trade = new Uint8Array(S * S);
    this._computeContact();
    this._computeNearCap();

    if (restore) {
      this._restore(restore);
      // anciennes parties (avant les guerres) : relations et guerres initiales reconstruites
      if (!restore.wars) { this._initRelations(world); this._initialWars(); this._rebuildAllBorders(); for (let k = 0; k < S; k++) this._rebuildSec(k); this._bordersDirty = false; this._dirtySides = new Set(); }
    } else {
      this._initRelations(world);
      for (let k = 0; k < S; k++) initAI(this, k);
      this._initialWars();
      for (let i = 0; i < n; i++) this._refreshBorder(i);
      for (let k = 0; k < S; k++) this._rebuildSec(k);
      this._bordersDirty = false; this._dirtySides = new Set();
      for (const s of this.sides) {
        const count = this._agentCount(s);
        for (let k = 0; k < count; k++) this._spawnAgent(s, k * 0.3);
      }
      for (let k = 0; k < S; k++) this._deploy(k);
      this.nextEventAt = this.cfg.eventRate > 0 ? 7 + this.rng.range(0, 4) : Infinity;
      this._computeIsolation();
      this._record();
      this._snapshotSeries();
    }
    // NATION SIMULATOR : un pays dirigé par le joueur (les autres restent pilotés par l'IA)
    this.nation = null;
    if (this.cfg.nation && this.cfg.nation.player >= 0 && this.cfg.nation.player < S) {
      // contexte géopolitique réel au départ (organisations, alliances, rivalités)
      const trades = !restore && this.cfg.nation.realWorld !== false ? applyGeopolitics(this) : [];
      if (this.rules.treaties === false || this.rules.trade === false) trades.length = 0;
      if (trades.length) this._computeTrade();
      this.nation = new Nation(this, this.cfg.nation, restore && restore.nation ? restore.nation : null);
      if (restore && restore.nation) this.sides[this.nation.player].player = true;
      for (const [a, b] of trades) this.nation.setDeal(a, b, { trade: true, bloc: true });
      if (trades.length) this.nation._refreshTrade();
    }
    this.landContact = this.sides.map((s) => s.border.length > 0);
    this.eventInterval = this.cfg.eventRate > 0
      ? Math.max(3, (13 / this.cfg.eventRate) / Math.sqrt(Math.max(1, this.sides.length / 2)))
      : Infinity;
  }

  // ---------------- pays ----------------
  _makeSide(p, k) {
    const ent = this.entities[p.e];
    const st = { ...ent.stats, ...(p.stats || {}) };
    const resMult = p.resMult || 1;
    const stats = { ...st, ressources: clamp(st.ressources * resMult, 1, 100) };
    const strategy = p.strategy || 'equilibree';
    return {
      index: k, e: p.e, team: p.team || 0, name: ent.name, stats, strategy,
      population: 0, maxUnits: 0, units: 0,
      rateFactor: (0.7 + stats.vitesse / 170) * (0.92 + stats.mobilite / 600),
      regen: 1.6 + stats.ressources / 28,
      baseStability: 0.45 + stats.stabilite / 200,
      econBase: stats.economie,
      econBoost: 0,
      cells: 0, initial: 1, peak: 0,
      stability: 0.45 + stats.stabilite / 200,
      resources: 55 + stats.ressources / 5,
      momentum: 0,
      phase: 'consolidation',
      phaseUntil: 0,
      mods: [],
      agents: [],
      border: [],
      front: {}, facc: {}, sectors: [], secDens: {}, avgDens: 1,
      attemptAcc: 0,
      heldForeign: 0,
      captured: 0, lost: 0,
      occupiedCells: 0, integratedAcc: 0,
      eliminated: false, defeated: false, eliminatedAt: -1,
      capital: -1,
      lastLandingMsg: -99, lastStrikeMsg: -99,
      gainsFrom: {},
      hist: [], series: [],
      blockade: 0,
    };
  }

  _findCapital(s) {
    const ent = this.entities[s.e];
    const g = this.grid;
    let best = -1, bestD = Infinity;
    const c = ent.capital;
    if (!c) { for (let i = 0; i < this.n; i++) if (this.owner[i] === s.e) return i; return -1; }
    const phi = c.lat * Math.PI / 180, lam = c.lon * Math.PI / 180;
    const cx = Math.cos(phi) * Math.sin(lam), cy = Math.sin(phi), cz = Math.cos(phi) * Math.cos(lam);
    for (let i = 0; i < this.n; i++) {
      if (this.owner[i] !== s.e) continue;
      const d = -(g.xyz[i * 3] * cx + g.xyz[i * 3 + 1] * cy + g.xyz[i * 3 + 2] * cz);
      if (d < bestD) { bestD = d; best = i; }
    }
    return best;
  }

  _initRelations(world) {
    const S = this.S;
    const soloTeams = this.teams.length >= this.sides.length;
    const legacy = world.relations || {};
    for (let a = 0; a < S; a++) for (let b = 0; b < S; b++) {
      if (a === b) continue;
      const A = this.sides[a], B = this.sides[b];
      let r = ((((A.e * 73856093) ^ (B.e * 19349663)) >>> 0) % 31) - 15;
      const hurt = (legacy[`${B.e}>${A.e}`] || 0) + (legacy[`${A.e}>${B.e}`] || 0);
      r -= Math.min(45, hurt / 25);
      if (this.contact[a * S + b]) r -= 6;
      if (!soloTeams && A.team === B.team) { r = 65; this.allied[a * S + b] = 1; }
      this.rel[a * S + b] = r;
    }
    for (let a = 0; a < S; a++) for (let b = a + 1; b < S; b++) { const m = (this.rel[a * S + b] + this.rel[b * S + a]) / 2; this.rel[a * S + b] = this.rel[b * S + a] = m; }
    if (this.rules.relations === false) this.rel.fill(0);
    if (this.rules.alliances === false) for (let a = 0; a < S; a++) for (let b = 0; b < S; b++) if (this.sides[a].team !== this.sides[b].team || soloTeams) this.allied[a * S + b] = 0;
    this._computeTrade();
  }

  // guerres de départ : entre camps (tous si peu de camps, sinon seulement les voisins)
  _initialWars() {
    if (this.cfg.warStart === 'tensions') {
      this.chron('tension', 'Début de la simulation : tensions entre les pays, aucune guerre déclarée.', {});
      this._rebuildWarIndex();
      return;
    }
    const T = this.teams.length;
    const members = this.teams.map((_, t) => this.sides.map((s, k) => (s.team === t ? k : -1)).filter((k) => k >= 0)).filter((x) => x.length);
    const S = this.S;
    const touch = (A, B) => A.some((a) => B.some((b) => this.contact[a * S + b] > 2));
    for (let x = 0; x < members.length; x++) for (let y = x + 1; y < members.length; y++) {
      if (T > 8 && !touch(members[x], members[y])) continue;
      startWar(this, members[x], members[y], 'initial', true);
    }
    this._rebuildWarIndex();
  }

  _rebuildWarIndex() {
    this.activeWars = this.wars.filter((w) => w.status !== 'ended');
    if (this.activeWars.length) this.hadWar = true;
    this.warsBySide = this.sides.map(() => []);
    for (const w of this.activeWars) for (const k of [...w.a, ...w.b]) this.warsBySide[k].push(w);
  }

  // frontières et secteurs recalculés seulement pour les pays concernés par un changement de guerre
  _refreshDirty() {
    const set = this._dirtySides;
    this._bordersDirty = false;
    this._rebuildWarIndex();
    if (!set || set.size === 0 || set.size > this.S * 0.5) { this._dirtySides = new Set(); this._rebuildAllBorders(); for (let k = 0; k < this.S; k++) this._rebuildSec(k); return; }
    this._dirtySides = new Set();
    const g = this.grid;
    const mark = new Uint8Array(this.S);
    for (const k of set) mark[k] = 1;
    for (let i = 0; i < this.n; i++) {
      const o = this.sideOf[this.owner[i]];
      if (o < 0) continue;
      let hit = mark[o] === 1;
      if (!hit) for (let k = g.nbrStart[i]; k < g.nbrStart[i + 1]; k++) { const q = this.sideOf[this.owner[g.nbr[k]]]; if (q >= 0 && mark[q]) { hit = true; break; } }
      if (hit) this._refreshBorder(i);
    }
    for (let k = 0; k < this.S; k++) if (!this.sides[k].eliminated) this._rebuildSec(k);
  }
  markDirty(list) { if (!this._dirtySides) this._dirtySides = new Set(); for (const k of list) this._dirtySides.add(k); this._bordersDirty = true; }

  // vue de la nation pour l'interface locale (multijoueur : pays du joueur de cet ordinateur ; les actions
  // qui modifient la partie deviennent des ordres via cmdSink). Jamais utilisé par la simulation elle-même.
  get nv() {
    const n = this.nation;
    if (!n) return null;
    const k = this.localSide ?? n.player;
    if (!this.cmdSink) return k === n.player ? n : n.at(k);
    if (!this._nvP || this._nvK !== k || this._nvS !== this.cmdSink) { this._nvP = commandView(n, k, this.cmdSink); this._nvK = k; this._nvS = this.cmdSink; }
    return this._nvP;
  }
  name(s) { return this.sides[s].name; }
  teamOfSide(s) { return this.sides[s].team; }
  activeSides() { const r = []; this.sides.forEach((s, k) => { if (!s.eliminated) r.push(k); }); return r; }
  totalCells() { let t = 0; for (const s of this.sides) t += s.cells; return t; }
  share(s) { const t = this.totalCells(); return t ? this.sides[s].cells / t : 0; }
  ratio(s) { const sd = this.sides[s]; return sd.cells / sd.initial; }
  totalBorder() { let t = 0; for (const s of this.sides) t += s.border.length; return t; }
  leaderSide() {
    let best = -1, bv = -1;
    for (const k of this.activeSides()) { const r = this.ratio(k); if (r > bv) { bv = r; best = k; } }
    return best;
  }
  trailerSide() {
    let best = -1, bv = Infinity;
    for (const k of this.activeSides()) { const r = this.ratio(k); if (r < bv) { bv = r; best = k; } }
    return best;
  }
  intensity() {
    const m = this.cfg.maxDuration;
    return clamp((this.time - 0.35 * m) / (0.6 * m), 0, 1);
  }
  isAtWar(s) { const S = this.S; for (let o = 0; o < S; o++) if (this.atWar[s * S + o]) return true; return false; }
  dateStr(t = this.time, short = false) { return fmtDate(t, this.cfg.startDay || 0, short); }

  addMod(s, mod) { this.sides[s].mods.push({ attempts: 1, atk: 1, def: 1, ...mod }); }
  _mod(s, key) { let m = 1; for (const md of this.sides[s].mods) m *= md[key]; return m; }

  // cellule i possédée par un pays en guerre contre s (ou zone grise capturable) ?
  _enemyOf(s, i) {
    const o = this.sideOf[this.owner[i]];
    if (o < 0) return this.neutralOwner[this.owner[i]] === 1;
    if (o === s) return false;
    return this.atWar[s * this.S + o] > 0 && !this.sides[o].eliminated;
  }

  // ---------------- histoire ----------------
  chron(type, text, extra = {}) {
    this.chronicle.push({ t: Math.round(this.time * 100) / 100, type, text, ...extra });
    if (this.chronicle.length > 1500) this.chronicle.splice(0, this.chronicle.length - 1400);
  }
  hist(s, type, text) {
    const sd = this.sides[s];
    sd.hist.push({ t: Math.round(this.time * 100) / 100, type, text });
    if (sd.hist.length > 200) sd.hist.shift();
  }
  _snapshotSeries() {
    for (const sd of this.sides) {
      sd.series.push([Math.round(this.time), sd.cells, Math.round(sd.eco.gdp), Math.round(sd.money), Math.round(sd.units), Math.round(sd.p.tech * 10) / 10, Math.round(sd.stability * 100), Math.round(powerOf(sd) * 10) / 10]);
      if (sd.series.length > 240) sd.series = sd.series.filter((_, k) => k % 2 === 0);
    }
  }

  // ---------------- contacts ----------------
  _computeContact() {
    const S = this.S, g = this.grid;
    this.contact.fill(0);
    if (!this.contactCell) this.contactCell = new Int32Array(S * S);
    this.contactCell.fill(-1);
    for (let i = 0; i < g.nGrid; i++) {
      const a = this.sideOf[this.owner[i]];
      if (a < 0) continue;
      for (let k = g.nbrStart[i]; k < g.nbrStart[i + 1]; k++) {
        const b = this.sideOf[this.owner[g.nbr[k]]];
        if (b >= 0 && b !== a && this.contact[a * S + b] < 65535) { this.contact[a * S + b]++; if (this.contactCell[a * S + b] < 0 || (this.contact[a * S + b] & 31) === 16) this.contactCell[a * S + b] = i; }
      }
    }
  }
  _computeNearCap() {
    const S = this.S;
    const caps = this.sides.map((s) => this.entities[s.e].capital);
    for (let a = 0; a < S; a++) for (let b = 0; b < S; b++) {
      if (a === b || !caps[a] || !caps[b]) continue;
      const p = caps[a], q = caps[b], t = Math.PI / 180;
      const h = Math.sin((q.lat - p.lat) * t / 2) ** 2 + Math.cos(p.lat * t) * Math.cos(q.lat * t) * Math.sin((q.lon - p.lon) * t / 2) ** 2;
      this.nearCap[a * S + b] = 2 * EARTH_R * Math.asin(Math.sqrt(h)) < 1800 ? 1 : 0;
    }
  }
  _computeTrade() {
    const S = this.S;
    for (let a = 0; a < S; a++) {
      const A = this.sides[a];
      A.tradePartners = [];
      for (let b = 0; b < S; b++) {
        if (a === b) continue;
        const B = this.sides[b];
        const ok = this.rules.trade !== false && !this.atWar[a * S + b] && (this.rel[a * S + b] > 12 || (this.rules.relations === false && A.p.trade > 55 && B.p.trade > 55)) && A.p.trade > 40 && B.p.trade > 40 && !A.eliminated && !B.eliminated
          && (this.contact[a * S + b] || this.nearCap[a * S + b] || (A.p.infra.ports > 20 && B.p.infra.ports > 20));
        this.trade[a * S + b] = ok ? 1 : 0;
        if (ok) A.tradePartners.push(b);
      }
    }
  }

  // ---------------- front ----------------
  _isBorder(i) {
    const s = this.sideOf[this.owner[i]];
    if (s < 0) return false;
    const sd = this.sides[s];
    if (sd.eliminated) return false;
    const g = this.grid;
    for (let k = g.nbrStart[i]; k < g.nbrStart[i + 1]; k++) if (this._enemyOf(s, g.nbr[k])) return true;
    return false;
  }

  _refreshBorder(i) {
    const want = this._isBorder(i);
    const p = this.borderPos[i];
    if (want && p < 0) {
      const s = this.sides[this.sideOf[this.owner[i]]];
      this.borderPos[i] = s.border.length;
      s.border.push(i);
    } else if (!want && p >= 0) this._removeBorder(i);
  }

  _removeBorder(i, sideIdx = null) {
    const p = this.borderPos[i];
    if (p < 0) return;
    const s = this.sides[sideIdx !== null ? sideIdx : this.sideOf[this.owner[i]]];
    const list = s.border;
    const last = list.pop();
    if (last !== i) { list[p] = last; this.borderPos[last] = p; }
    this.borderPos[i] = -1;
  }

  _rebuildAllBorders() {
    for (const s of this.sides) s.border.length = 0;
    this.borderPos.fill(-1);
    for (let i = 0; i < this.n; i++) this._refreshBorder(i);
  }

  // ---------------- changement de propriétaire ----------------
  flip(i, newE, fromSim = true) {
    const oldE = this.owner[i];
    if (oldE === newE) return;
    const g = this.grid;
    const so = this.sideOf[oldE], sn = this.sideOf[newE];
    if (this.activeWars.length) noteChange(this, i, oldE, newE);
    const a2 = this.geo.km2[i];
    if (so >= 0) this.sides[so].km2 -= a2;
    if (sn >= 0) this.sides[sn].km2 += a2;
    if (this.borderPos[i] >= 0) this._removeBorder(i, so >= 0 ? so : null);
    this.owner[i] = newE;
    if (so >= 0) this.sides[so].cellEpoch = (this.sides[so].cellEpoch || 0) + 1;
    if (sn >= 0) this.sides[sn].cellEpoch = (this.sides[sn].cellEpoch || 0) + 1;
    if (so >= 0) {
      const d = this.sides[so];
      d.cells--; d.lost++;
      if (this.origin[i] !== oldE) d.heldForeign--;
    }
    if (sn >= 0) {
      const c = this.sides[sn];
      c.cells++; c.captured++;
      c.peak = Math.max(c.peak, c.cells);
      if (this.origin[i] !== newE) c.heldForeign++;
      c.resources = Math.min(100, c.resources + 0.08);
      if (oldE !== NONE) c.gainsFrom[oldE] = (c.gainsFrom[oldE] || 0) + 1;
      if (fromSim) { if (!c.recentConq) c.recentConq = []; c.recentConq.push([i, Math.round(this.time * 10) / 10]); if (c.recentConq.length > 40) c.recentConq.shift(); }
      if (so >= 0 && fromSim) {
        const d = this.sides[so];
        // population et dégâts : la parcelle change de mains
        const popCell = d.pop / Math.max(1, d.cells + 1);
        d.pop -= popCell; c.pop += popCell * 0.75;
        d.infraDamage = Math.min(0.5, d.infraDamage + 0.25 / Math.max(40, d.initial));
        applyLosses(d, d.units * 0.45 / Math.max(60, d.initial), false);
        const bin = this.bins[i];
        frontAcc(c, secKey(so, bin)).g++;
        frontAcc(d, secKey(sn, bin)).l++;
      } else if (so < 0 && fromSim) frontAcc(c, secKey(-1, this.bins[i])).g++;
    }
    // conquête : la zone est d'abord « occupée » ; reprise d'un territoire d'origine ou édition : officielle
    if (this.occupied[i] && so >= 0) this.sides[so].occupiedCells--;
    const occ = fromSim && sn >= 0 && newE !== this.origin[i] ? 1 : 0;
    this.occupied[i] = occ;
    if (occ) { this.sides[sn].occupiedCells++; this.occList.push(i); }
    this.isolated[i] = 0;
    this.contest[i] = 0;
    this._refreshBorder(i);
    for (let k = g.nbrStart[i]; k < g.nbrStart[i + 1]; k++) this._refreshBorder(g.nbr[k]);
    this.lastFlip[i] = this.time;
    this.captures.push({ i, by: newE, from: oldE, t: this.time, occ });

    if (fromSim && so >= 0 && sn >= 0) {
      const d = this.sides[so], c = this.sides[sn];
      if (i === d.capital) {
        d.stability = Math.max(0.15, d.stability - 0.12);
        d.morale = Math.max(0.25, d.morale - 0.15);
        d.momentum -= 0.1;
        d.capLostAt = this.time;
        this._emit({ icon: '🏛️', title: 'CAPITALE PRISE', tone: 'bad', side: so, cell: i,
          text: `Le centre administratif ${de(d.name)} passe sous le contrôle ${de(c.name)}.` });
        this.chron('battle', `${c.name} prend la capitale ${de(d.name)}.`, { cell: i, e: [c.e, d.e] });
        this.hist(so, 'capital', `Capitale prise par ${c.name}.`);
        for (const w of this.activeWars) if ((w.a.includes(so) && w.b.includes(sn)) || (w.b.includes(so) && w.a.includes(sn))) w.moments.push({ t: this.time, type: 'capital', text: `${c.name} prend la capitale ${de(d.name)}.`, cell: i });
      } else if (i === c.capital) {
        c.stability = Math.min(1, c.stability + 0.1);
        c.morale = Math.min(1.25, c.morale + 0.1);
        this._emit({ icon: '🏛️', title: 'CAPITALE REPRISE', tone: 'good', side: sn, cell: i, text: `${c.name} reprend son centre administratif.` });
        this.hist(sn, 'capital', 'Capitale reprise.');
      }
    }
  }

  // Événement « perte temporaire » : un voisin ennemi prend un groupe de cellules
  flipClusterFrom(s, amount) {
    const sd = this.sides[s];
    if (!sd.border.length) return 0;
    const g = this.grid;
    const start = sd.border[this.rng.int(sd.border.length)];
    let taker = -1;
    for (let k = g.nbrStart[start]; k < g.nbrStart[start + 1]; k++) {
      const j = g.nbr[k];
      if (this._enemyOf(s, j)) { taker = this.owner[j]; break; }
    }
    if (taker < 0) return 0;
    const queue = [start], seen = new Set([start]);
    let flipped = 0;
    while (queue.length && flipped < amount) {
      const i = queue.shift();
      if (this.owner[i] !== sd.e) continue;
      this.flip(i, taker);
      flipped++;
      for (let k = g.nbrStart[i]; k < g.nbrStart[i + 1]; k++) {
        const j = g.nbr[k];
        if (!seen.has(j) && this.owner[j] === sd.e) { seen.add(j); queue.push(j); }
      }
    }
    return flipped;
  }

  startRegional(duration, s = -1) {
    let pool = null;
    if (s >= 0 && this.sides[s].border.length) pool = this.sides[s].border;
    else {
      const act = this.activeSides().filter((k) => this.sides[k].border.length);
      if (!act.length) return null;
      pool = this.sides[act[this.rng.int(act.length)]].border;
    }
    const center = pool[this.rng.int(pool.length)];
    const g = this.grid;
    const radiusKm = 110 + Math.min(200, Math.sqrt(this.totalCells()) * 0.6);
    this.regional = { cell: center, x: g.xyz[center * 3], y: g.xyz[center * 3 + 1], z: g.xyz[center * 3 + 2], radiusKm, until: this.time + duration, start: this.time };
    const queue = [center], seen = new Set([center]);
    while (queue.length) {
      const i = queue.shift();
      this.contest[i] = this.time + duration;
      for (let k = g.nbrStart[i]; k < g.nbrStart[i + 1]; k++) {
        const j = g.nbr[k];
        if (seen.has(j) || distKm(g, center, j) > radiusKm) continue;
        seen.add(j); queue.push(j);
      }
    }
    return this.regional;
  }

  _inRegional(i) {
    const r = this.regional;
    if (!r || this.time >= r.until) return false;
    return distKm(this.grid, r.cell, i) < r.radiusKm;
  }

  // ---------------- combat ----------------
  // ravitaillement : éloignement du territoire d'origine, infrastructures, ressources, entretien
  supply(s, targetCell) {
    const sd = this.sides[s];
    if (this.rules.logistics === false) return 1;     // logistique désactivée : pas d'usure du ravitaillement
    let v = 1;
    if (targetCell >= 0 && this.origin[targetCell] !== sd.e) {
      const frac = sd.heldForeign / Math.max(50, sd.initial);
      v /= 1 + (1.45 - 0.7 * sd.supplyLvl) * frac * TUNE.supply;
    }
    if (sd.resources < 8) v *= 0.8;
    return v * (0.8 + 0.2 * sd.readiness);
  }

  attackPower(s, targetCell = -1, dens = null) {
    const sd = this.sides[s];
    const b = targetCell >= 0 ? this.geo.biome[targetCell] : 0;
    const d = dens !== null ? dens : sd.avgDens;
    let a = sd.atkT[b] * clamp(Math.sqrt(d / TUNE.density), 0.3, 2.4) * (0.55 + 0.45 * sd.stability) * sd.morale * Math.exp(sd.momentum) * this._mod(s, 'atk');
    a *= this.supply(s, targetCell);
    if (sd.coal) a *= coalitionAttackBonus(this, s);            // opérations combinées d'une coalition
    // arbre militaire : armements, doctrines, adaptation au terrain, renseignement
    if (sd.techAtk) a *= sd.techAtk;
    if (sd.techAtkT) a *= sd.techAtkT[b];
    if (sd.intel) a *= 1 + sd.intel * 0.5;
    return a;
  }

  defensePower(s, cell, dens = null, attacker = -1) {
    const sd = this.sides[s];
    const b = this.geo.biome[cell];
    const d = dens !== null ? dens : sd.avgDens;
    let v = sd.defC * clamp(Math.sqrt(d / TUNE.density), 0.3, 2.4) * (0.55 + 0.45 * sd.stability) * (0.5 + 0.5 * sd.morale) * Math.exp(sd.momentum * 0.3) * this._mod(s, 'def');
    v *= TERRAIN_DEF[b] * RIVER_DEF[this.geo.river[cell]];
    if (attacker >= 0) { const f = sd.front[secKey(attacker, this.bins[cell])]; if (f) v *= 1 + 0.6 * f.fort * (1 + (sd.devFort || 0) * 0.5) * (1 - (this.sides[attacker].artillery || 0)); }   // l'artillerie adverse réduit l'effet des fortifications
    if (sd.techDef) v *= sd.techDef;
    if (sd.techDefT) v *= sd.techDefT[b];
    if (sd.intel) v *= 1 + sd.intel * 0.5;
    if (sd.capital >= 0 && (cell === sd.capital || distKm(this.grid, cell, sd.capital) < 90)) v *= 1.3;
    if (this.origin[cell] === sd.e) {
      v *= 1.1 * (1 + TUNE.desperation * (1 - this.intensity() * 0.8) * Math.max(0, 1 - sd.cells / sd.initial));
    } else v *= 0.85;
    if (this.contest[cell] > this.time && this.regional) v *= 0.8;
    return v;
  }

  pressure(s) {
    const sd = this.sides[s];
    const b = Math.max(1, sd.border.length);
    return clamp(Math.sqrt(sd.units / (b * TUNE.density)), 0.35, 1.6);
  }

  _attempt(s, j, agent = null, bonus = 0) {
    const sd = this.sides[s];
    if (!this._enemyOf(s, j)) return false;
    const d = this.sideOf[this.owner[j]];
    const dd = d >= 0 ? this.sides[d] : null;
    const slow = dd ? clamp(Math.sqrt(dd.initial / 900), 0.25, 1) : 0.7;
    if (this.rng.next() > slow) return false;
    sd.resources = Math.max(0, sd.resources - this.attemptCost);
    const bin = this.bins[j];
    const key = secKey(d, bin);
    const densA = sd.secDens[key] !== undefined ? sd.secDens[key] : sd.avgDens;
    const f = sd.front[key];
    let A = this.attackPower(s, j, densA);
    // forces spéciales : coups de main sur les poches isolées et autour de la capitale ennemie
    if (sd.sof && dd && (this.isolated[j] || (dd.capital >= 0 && distKm(this.grid, j, dd.capital) < 180))) A *= 1 + sd.sof;
    // soutien aérien (supériorité locale) et reconnaissance
    if (dd) {
      const air = sd.airPow / (sd.airPow + dd.airPow * 1.1 + 0.5) - 0.4;
      const b = this.geo.biome[j];
      A *= 1 + clamp(air, -0.3, 0.6) * 0.3 * (b === 1 || b === 3 ? 0.5 : 1);
      if (f && f.airUntil > this.time) A *= 1.22;
    }
    A *= 1 + sd.frac.rec * 0.8;
    const densD = dd ? defenseDensity(this, d, s, j) : 0;
    const D = dd ? this.defensePower(d, j, densD, s) : 0.62 * TERRAIN_DEF[this.geo.biome[j]] * 0.7;
    const g = this.grid;
    const S = this.S;
    let local = 0;
    for (let k = g.nbrStart[j]; k < g.nbrStart[j + 1]; k++) {
      const nb = this.owner[g.nbr[k]];
      const o = this.sideOf[nb];
      if (o < 0) { if (!dd && this.neutralOwner[nb]) local--; continue; }
      if (o === s || this.allied[s * S + o]) local++;
      else if (dd && (o === d || this.allied[d * S + o])) local--;
    }
    let logit = TUNE.logitK * Math.log(A / D) + TUNE.localK * local - 0.35 + bonus;
    if (this.isolated[j]) logit += 1.1;
    if (agent) logit += 0.25;
    const p = sigmoid(logit);
    const acc = frontAcc(sd, key);
    acc.a++;
    sd.opsAcc += densA;
    // pertes (abstraites) : proportionnelles aux forces engagées localement
    const la = TUNE.lossK * Math.min(densA, 5) * (1.1 - 0.7 * p) * (dd ? 1 : 0.35);
    applyLosses(sd, la, true);
    if (f) f.lossU = (f.lossU || 0) + la;
    if (dd) {
      const ld = TUNE.lossK * Math.min(densD, 5) * (0.35 + 0.9 * p) * (A / (A + D) + 0.3);
      applyLosses(dd, ld, false);
      const fd = dd.front[secKey(s, bin)];
      if (fd) fd.lossU = (fd.lossU || 0) + ld;
    }
    if (this.rng.next() < p) {
      acc.w++;
      this.flip(j, sd.e);
      if (agent) { agent.wins++; agent.lastWinAt = this.time; }
      return true;
    }
    this.contest[j] = Math.max(this.contest[j], this.time + 1.4);
    return false;
  }

  // ---------------- groupes militaires (points sur la carte) ----------------
  // Peu de groupes, bien placés : chaque point représente une part des forces du pays. Les groupes
  // partent du territoire principal (CORE TERRITORY) et se concentrent sur les fronts selon les
  // décisions de l'IA ; en paix ils reviennent vers les conquêtes récentes, les frontières sensibles,
  // puis le cœur du pays. Aucun déplacement sans raison, aucun bateau quand la terre suffit.
  _agentCount(sd) {
    let c = clamp(Math.round(2 + Math.sqrt(sd.maxUnits) / 7), 2, 8);
    const cap = this.cfg.maxAgents / Math.max(1, this.sides.length);
    if (c > cap) c = Math.max(1, Math.floor(cap));
    return c;
  }

  _spawnAgent(sd, delay = 0) {
    const g = this.grid;
    const i = sd.capital >= 0 && this.owner[sd.capital] === sd.e ? sd.capital : this._randomOwned(sd.e);
    if (i < 0) return false;
    const a = {
      id: ++this._id, side: sd.index, cell: i, role: 'mix',
      x: g.xyz[i * 3], y: g.xyz[i * 3 + 1], z: g.xyz[i * 3 + 2],
      px: 0, py: 0, pz: 0,
      target: -1, post: -1, postKey: null, engaged: false, bornAt: this.time + delay,
      speed: (35 + sd.stats.mobilite * 0.7) * this.rng.range(0.9, 1.1),
      wins: 0, lastWinAt: -99, transit: -1, str: 1,
    };
    const j = this.rng.range(-0.003, 0.003);
    a.x += j; a.y -= j;
    const l = Math.hypot(a.x, a.y, a.z); a.x /= l; a.y /= l; a.z /= l;
    a.px = a.x; a.py = a.y; a.pz = a.z;
    sd.agents.push(a);
    return true;
  }

  // ---------------- déplacements terrestres réalistes ----------------
  // Une armée ne traverse que son territoire, celui de ses alliés ou celui d'un ennemi en guerre : jamais un
  // pays neutre, jamais la mer à pied. « Zone terrestre » = ensemble des parcelles du pays reliées par la
  // terre en passant uniquement par des territoires praticables ; deux zones différentes (île, exclave,
  // territoire séparé par un pays neutre) ne communiquent que par la mer (ou par les airs).
  _passCost(k, c) {
    const o = this.sideOf[this.owner[c]];
    if (o === k) return 1;
    if (o < 0) return 0;
    const S = this.S;
    if (this.atWar[k * S + o]) {
      // territoire ennemi : seulement la zone du front (au contact de son propre sol), et évité
      const g = this.grid, e = this.sides[k].e;
      for (let q = g.nbrStart[c]; q < g.nbrStart[c + 1]; q++) if (this.owner[g.nbr[q]] === e) return 2.5;
      return 0;
    }
    if (this.allied[k * S + o] && this.sides[k].passWar) return 1.3;   // en guerre : droit de passage chez les alliés
    return 0;
  }
  // zone terrestre d'une parcelle pour un camp (calcul paresseux, invalidé quand la carte ou les alliances changent)
  _lab(sd, c) {
    if (c < 0) return -1;
    if (!this.landLab) { this.landLab = new Int32Array(this.n); this.landVer = new Int32Array(this.n); this._labStamp = new Int32Array(this.n); this._labStampN = 0; this._labCounter = 0; this._labId = 0; }
    const S = this.S, k = sd.index;
    // signature exacte de la situation (territoires, guerres, alliances) : résultat déterministe, identique après une reprise
    if (sd.labTick !== this.tickCount || !sd.labVer) {
      sd.labTick = this.tickCount;
      let sig = sd.passWar ? 7 : 11;
      for (let o = 0; o < S; o++) {
        const w = o === k ? 1 : this.atWar[k * S + o] ? 2 : this.allied[k * S + o] && sd.passWar ? 3 : 0;
        if (w) sig = (Math.imul(sig, 31) + (o + 1) * 17 + w * 5 + (this.sides[o].cellEpoch || 0) * 131) | 0;
      }
      if (sig !== sd.labSig || !sd.labVer) { sd.labSig = sig; sd.labVer = ++this._labCounter; }
    }
    if (this.owner[c] === sd.e && this.landVer[c] === sd.labVer) return this.landLab[c];
    // remplissage depuis c : toutes les parcelles praticables reliées ; on retient la zone des parcelles du pays
    const g = this.grid, st = this._labStamp, mark = ++this._labStampN;
    const lab = ++this._labId;
    const stack = [c]; st[c] = mark;
    while (stack.length) {
      const i = stack.pop();
      if (this.owner[i] === sd.e) {
        // zone déjà identifiée pendant cette version (départ hors du sol national) : même identifiant
        if (this.landVer[i] === sd.labVer && this.landLab[i] !== lab) return this.landLab[i];
        this.landLab[i] = lab; this.landVer[i] = sd.labVer;
      }
      for (let q = g.nbrStart[i]; q < g.nbrStart[i + 1]; q++) {
        const j = g.nbr[q];
        if (st[j] === mark || !this._passCost(k, j)) continue;
        st[j] = mark; stack.push(j);
      }
    }
    return lab;
  }
  // zone terrestre où se trouve un groupe (dernière parcelle du pays traversée)
  _agentLab(sd, a) { return this._lab(sd, a.lastOwn !== undefined && this.owner[a.lastOwn] === sd.e ? a.lastOwn : a.cell); }
  // itinéraire terrestre (A*) par les territoires praticables ; null s'il n'existe pas
  _landPath(sd, from, to, maxNodes = 90000) {
    const g = this.grid, k = sd.index;
    if (from === to) return [to];
    if (g.comp[from] !== g.comp[to]) return null;
    // zones terrestres différentes : inutile de chercher (aucune route praticable)
    if (this.landVer && sd.labVer && this.owner[from] === sd.e && this.owner[to] === sd.e && this.landVer[from] === sd.labVer && this.landVer[to] === sd.labVer && this.landLab[from] !== this.landLab[to]) return null;
    if (!this._astar) { this._astar = { gs: new Float32Array(this.n), came: new Int32Array(this.n), stamp: new Int32Array(this.n), closed: new Int32Array(this.n), n: 0 }; }
    const A = this._astar, mark = ++A.n;
    const xyz = g.xyz;
    // groupe resté en territoire devenu impraticable (fin de guerre) : il se retire en le traversant
    const stuckIn = this._passCost(k, from) ? -2 : this.owner[from];
    const h = (i) => Math.acos(clamp(xyz[i * 3] * xyz[to * 3] + xyz[i * 3 + 1] * xyz[to * 3 + 1] + xyz[i * 3 + 2] * xyz[to * 3 + 2], -1, 1)) * EARTH_R;
    const heap = [], push = (i, f) => { heap.push([f, i]); let x = heap.length - 1; while (x > 0) { const p = (x - 1) >> 1; if (heap[p][0] <= heap[x][0]) break; [heap[p], heap[x]] = [heap[x], heap[p]]; x = p; } };
    const pop = () => { const top = heap[0], last = heap.pop(); if (heap.length) { heap[0] = last; let x = 0; for (;;) { const l = 2 * x + 1, r = l + 1; let m = x; if (l < heap.length && heap[l][0] < heap[m][0]) m = l; if (r < heap.length && heap[r][0] < heap[m][0]) m = r; if (m === x) break; [heap[m], heap[x]] = [heap[x], heap[m]]; x = m; } } return top[1]; };
    A.stamp[from] = mark; A.gs[from] = 0; A.came[from] = -1; push(from, h(from));
    let seen = 0;
    while (heap.length) {
      const i = pop();
      if (A.closed[i] === mark) continue;
      A.closed[i] = mark;
      if (i === to) {
        const path = []; for (let x = to; x >= 0; x = A.came[x]) path.push(x);
        return path.reverse();
      }
      if (++seen > maxNodes) return null;
      for (let q = g.nbrStart[i]; q < g.nbrStart[i + 1]; q++) {
        const j = g.nbr[q];
        const w = j === to ? 1 : this._passCost(k, j) || (this.owner[j] === stuckIn ? 1.5 : 0);
        if (!w || A.closed[j] === mark) continue;
        const d = Math.acos(clamp(xyz[i * 3] * xyz[j * 3] + xyz[i * 3 + 1] * xyz[j * 3 + 1] + xyz[i * 3 + 2] * xyz[j * 3 + 2], -1, 1)) * EARTH_R * w * (TERRAIN_COST[this.geo.biome[j]] || 1);
        const ng = A.gs[i] + d;
        if (A.stamp[j] === mark && ng >= A.gs[j]) continue;
        A.stamp[j] = mark; A.gs[j] = ng; A.came[j] = i; push(j, ng + h(j));
      }
    }
    return null;
  }
  // points de passage espacés (environ 3 parcelles) : déplacement fluide le long de l'itinéraire
  _waypoints(path) {
    if (!path || path.length < 3) return path;
    // le long des côtes, chaque parcelle est conservée : la trajectoire ne coupe jamais une baie
    const g = this.grid, out = [];
    let last = 0;
    for (let q = 1; q < path.length - 1; q++) {
      if (g.coastal[path[q]] || g.coastal[path[q + 1]] || q - last >= 3) { out.push(path[q]); last = q; }
    }
    out.push(path[path.length - 1]);
    return out;
  }

  // territoire principal : masse terrestre de la capitale (sinon la plus grande tenue par le pays)
  _coreComp(sd) {
    const g = this.grid;
    if (sd.capital >= 0 && this.owner[sd.capital] === sd.e) return (sd.coreComp = g.comp[sd.capital]);
    if (sd.coreComp !== undefined && sd.coreComp >= 0) {
      for (const b of sd.border) if (g.comp[b] === sd.coreComp) return sd.coreComp;
    }
    const votes = new Map();
    for (const b of sd.border) votes.set(g.comp[b], (votes.get(g.comp[b]) || 0) + 1);
    let best = -1, bv = -1;
    for (const [c, v] of votes) if (v > bv) { bv = v; best = c; }
    if (best < 0) { const i = this._randomOwned(sd.e); best = i >= 0 ? g.comp[i] : -1; }
    return (sd.coreComp = best);
  }

  // cellule du pays proche d'un point (échantillon), sur la même masse terrestre
  _ownCellNear(sd, cell, comp, spread = 4) {
    const g = this.grid;
    let c = cell;
    for (let step = 0; step < spread; step++) {
      let next = -1, seen = 0;
      for (let k = g.nbrStart[c]; k < g.nbrStart[c + 1]; k++) {
        const j = g.nbr[k];
        if (this.owner[j] !== sd.e || g.comp[j] !== comp) continue;
        seen++;
        if (this.rng.int(seen) === 0) next = j;
      }
      if (next < 0) break;
      c = next;
    }
    return c;
  }

  // répartition des groupes : concentration progressive sur les zones importantes
  _deploy(k) {
    const sd = this.sides[k];
    if (sd.eliminated) return;
    const g = this.grid, S = this.S;
    // groupes engagés dans un déplacement maritime (vers le port, au port, en mer) : déjà affectés
    const seaBound = sd.agents.filter((a) => a.sea || a.transit >= 0 || a.op === 'landing');
    const agents = sd.agents.filter((a) => a.transit < 0 && !a.sea && a.op !== 'landing' && this.time >= a.bornAt);
    if (!agents.length) return;
    const coreComp = this._coreComp(sd);
    const coreCell = sd.capital >= 0 && this.owner[sd.capital] === sd.e ? sd.capital : (sd.border.find((b) => g.comp[b] === coreComp) ?? this._randomOwned(sd.e));
    const core = this._lab(sd, coreCell);
    const naval = this._navalOK(sd);
    // zone terrestre de chaque groupe (territoires praticables : le sien, ses alliés, ses ennemis en guerre)
    const aLab = new Map(agents.map((a) => [a, this._agentLab(sd, a)]));
    const agentComps = new Set(aLab.values());
    const labOf = (c) => this._lab(sd, c);
    let posts = [];
    const atWar = this.isAtWar(k);
    if (sd.sectors && sd.sectors.length) {
      for (const sec of sd.sectors) {
        const f = sd.front[sec.key];
        if (!f || !sec.cells.length) continue;
        let w = sec.fw * (f.status === 'retreating' ? 1.5 : f.status === 'advancing' ? 1.2 : 1) * (f.status === 'inactive' ? 0.35 : 1);
        if (sec.o < 0) w *= 0.3;
        if (sec.o >= 0 && this.contact[k * S + sec.o] < 4) w *= 0.15;   // contact symbolique (détroit) : pas un vrai front terrestre
        const c0 = sec.cells.find((x) => this.owner[x] === sd.e) ?? sec.cells[0];
        posts.push({ key: 'S' + sec.key, cells: sec.cells, w, comp: labOf(c0), front: true, force: f.force || 0 });
      }
    }
    if (posts.length) {
      // réserve stratégique autour de la capitale (plus importante si les fronts sont symboliques)
      const fw = posts.reduce((t, p) => t + p.w, 0);
      const real = (sd.sectors || []).some((sec) => sec.o >= 0 && sec.cells.length >= 3 && this.contact[k * S + sec.o] >= 4);
      const cap = sd.capital >= 0 && this.owner[sd.capital] === sd.e ? sd.capital : -1;
      if (cap >= 0) posts.push({ key: 'K', cells: [cap], w: real ? fw * 0.12 : fw * 3, comp: labOf(cap), core: true });
    }
    if (!posts.length) {
      // paix : conquêtes récentes -> frontières sensibles -> cœur du pays
      const conq = (sd.recentConq || []).filter(([c, t]) => this.owner[c] === sd.e && this.time - t < 90).map(([c]) => c);
      if (conq.length) posts.push({ key: 'C', cells: conq, w: 1.3, comp: labOf(conq[0]) });
      for (let o = 0; o < S; o++) {
        const c = this.contactCell ? this.contactCell[k * S + o] : -1;
        if (c < 0 || this.owner[c] !== sd.e || this.sides[o].eliminated) continue;
        const rel = this.rel[k * S + o];
        if (rel < 15) posts.push({ key: 'B' + o, cells: [c], w: 0.6 + Math.max(0, -rel) / 40, comp: labOf(c) });
      }
      const cap = sd.capital >= 0 && this.owner[sd.capital] === sd.e ? sd.capital : -1;
      if (cap >= 0) posts.push({ key: 'K', cells: [cap], w: 1.4, comp: labOf(cap), core: true });
    }
    // zones joignables par la terre depuis les groupes ; les autres (îles, territoires d'outre-mer, fronts
    // lointains) ne sont desservies que par la mer, et seulement si cela a un sens militaire
    posts = posts.filter((p) => {
      if (p.comp === core || agentComps.has(p.comp)) return true;
      if (!naval) return false;
      p.remote = true;
      if (p.front) return true;                           // front sur une autre masse terrestre
      if (p.key === 'C') return true;                     // conquêtes récentes outre-mer à tenir
      if (p.key[0] === 'B') { const o = Number(p.key.slice(1)); return this.rel[k * S + o] < -40; }   // frontière d'outre-mer réellement menacée
      return false;
    });
    // en paix, un seul groupe au plus par zone d'outre-mer
    if (!atWar) for (const p of posts) if (p.remote) p.w = Math.min(p.w, 0.35);
    if (!posts.length) {
      const c = this._randomOwned(sd.e);
      if (c < 0) return;
      posts.push({ key: 'K', cells: [c], w: 1, comp: labOf(c), core: true });
    }
    // effectifs voulus par zone (plus grands restes)
    const N = agents.length;
    const W = posts.reduce((t, p) => t + p.w, 0) || 1;
    const want = posts.map((p) => (N * p.w) / W);
    const base = want.map(Math.floor);
    let rest = N - base.reduce((a, b) => a + b, 0);
    const order = want.map((v, i) => [v - base[i], i]).sort((a, b) => b[0] - a[0]);
    for (let q = 0; q < rest; q++) base[order[q % order.length][1]]++;
    const byKey = new Map(posts.map((p, i) => [p.key, i]));
    const count = posts.map(() => 0);
    const inbound = posts.map(() => 0);
    for (const a of seaBound) { const i = byKey.get(a.postKey); if (i !== undefined) inbound[i]++; }
    for (let i = 0; i < posts.length; i++) if (posts[i].remote && !atWar && base[i] > 1) base[i] = 1;
    for (const a of agents) { const i = byKey.get(a.postKey); if (i !== undefined && aLab.get(a) === posts[i].comp) count[i]++; else a.postKey = null; }
    const dist = (a, p) => { const c = p.cells[(p.cells.length / 2) | 0]; return Math.acos(clamp(a.x * g.xyz[c * 3] + a.y * g.xyz[c * 3 + 1] + a.z * g.xyz[c * 3 + 2], -1, 1)); };
    const assign = (a, i) => {
      const p = posts[i];
      a.postKey = p.key;
      a.postSlot = this.rng.next();
      count[i]++;
      a.post = this._pickPost(sd, a, p);
    };
    // groupes libres d'abord, puis déplacements progressifs (au plus un quart des groupes à la fois)
    for (const a of agents) {
      if (a.postKey) continue;
      let best = -1, bd = Infinity;
      posts.forEach((p, i) => { if (count[i] >= base[i] || p.comp !== aLab.get(a)) return; const d = dist(a, p); if (d < bd) { bd = d; best = i; } });
      if (best < 0) posts.forEach((p, i) => { if (p.comp !== aLab.get(a)) return; const d = dist(a, p) + (count[i] - base[i]) * 0.5; if (d < bd) { bd = d; best = i; } });
      if (best >= 0) assign(a, best);
    }
    let moves = Math.max(1, Math.round(N / 4));
    while (moves-- > 0) {
      let need = -1, nv = 0;
      count.forEach((c, i) => { const d = base[i] - c; if (d > nv) { nv = d; need = i; } });
      if (need < 0) break;
      let pick = null, bd = Infinity;
      for (const a of agents) {
        const i = byKey.get(a.postKey);
        if (i === undefined || count[i] <= base[i] || aLab.get(a) !== posts[need].comp) continue;
        const d = dist(a, posts[need]);
        if (d < bd) { bd = d; pick = a; }
      }
      if (!pick) break;
      count[byKey.get(pick.postKey)]--;
      assign(pick, need);
    }
    // forces représentées par chaque point, poste actualisé si le front a bougé
    for (const a of agents) {
      const i = byKey.get(a.postKey);
      if (i === undefined) continue;
      const p = posts[i];
      a.str = (p.front ? p.force || sd.units * p.w / W : sd.units * p.w / W) / Math.max(1, count[i]);
      if (a.post < 0 || this.owner[a.post] !== sd.e || (p.front && this.borderPos[a.post] < 0 && this.rng.next() < 0.5)) a.post = this._pickPost(sd, a, p);
    }
    // renforts par la mer vers les zones qu'aucune route terrestre ne relie (une commande à la fois)
    if (naval && this.time >= (sd.nextSeaOrder || 0) && this._seaOrders(sd) < this._sealift(sd)) {
      let need = -1, nv = 0;
      posts.forEach((p, i) => { if (!p.remote) return; const d = base[i] - count[i] - inbound[i]; if (d > nv) { nv = d; need = i; } });
      if (need >= 0) {
        const p = posts[need];
        let pick = null, bd = Infinity;
        for (const a of agents) {
          if (aLab.get(a) === p.comp) continue;
          const i = byKey.get(a.postKey);
          const spare = i === undefined || count[i] > base[i] || (posts[i].key === 'K' && count[i] > 1);
          if (!spare || N <= 1) continue;
          const d = this._agentDist(a, p.cells[(p.cells.length / 2) | 0]);
          if (d < bd) { bd = d; pick = a; }
        }
        if (pick) {
          const i = byKey.get(pick.postKey); if (i !== undefined) count[i]--;
          const dest = this._pickPost(sd, pick, p);
          if (dest >= 0 && this._orderSea(sd, pick, dest, { key: p.key, reason: p.front ? 'front' : 'garrison' })) inbound[need]++;
          else { pick.postKey = null; sd.nextSeaOrder = this.time + 8; }
        }
      }
    }
    // débarquements : seulement contre un ennemi qu'on ne peut pas atteindre par la terre
    if (atWar && naval && this.time >= (sd.nextLanding || 0) && this._seaOrders(sd) < this._sealift(sd)) {
      let overseas = false;
      for (let o = 0; o < S; o++) if (this.atWar[k * S + o] && this.contact[k * S + o] < 4 && !this.sides[o].eliminated) { overseas = true; break; }
      const noLand = !(sd.sectors || []).some((sec) => sec.o >= 0 && this.contact[k * S + sec.o] >= 4);
      if (overseas && (noLand || this.rng.next() < 0.35 + (sd.navalFocus || 0))) {
        sd.nextLanding = this.time + (noLand ? 14 : 30) / (1 + (sd.navalFocus || 0));
        const cand = agents.filter((a) => aLab.get(a) === core).sort((x, y) => (x.postKey && x.postKey[0] === 'S' ? 1 : 0) - (y.postKey && y.postKey[0] === 'S' ? 1 : 0));
        const a = cand[0];
        if (a && N > 1) {
          const tgt = this._landingTarget(k, a);
          // même masse terrestre seulement si le seul lien est un détroit symbolique (ex. Manche)
          const strait = tgt >= 0 && g.comp[tgt] === g.comp[a.cell] && this.contact[k * S + this.sideOf[this.owner[tgt]]] < 4;
          if (tgt >= 0 && (g.comp[tgt] !== g.comp[a.cell] || strait)) this._orderSea(sd, a, tgt, { landing: true, key: null, reason: 'landing', strait });
        }
      }
    }
    // groupe isolé sur une autre masse terrestre sans raison d'y rester : retour au territoire principal par la mer
    for (const a of agents) {
      if (a.postKey || core < 0 || aLab.get(a) === core || this.time < (a.nextTransportAt || 0) || (a.landedAt !== undefined && this.time - a.landedAt < 25)) continue;
      // destination : la capitale si elle est tenue, sinon un port du territoire principal
      // seulement si la capitale est tenue (pas de navettes pendant une invasion)
      const cap = sd.capital >= 0 && this.owner[sd.capital] === sd.e && labOf(sd.capital) === core ? sd.capital : -1;
      if (cap < 0 || labOf(cap) === aLab.get(a)) continue;
      if (naval) this._orderSea(sd, a, cap, { key: 'K', reason: 'home' });
      else if (this.cfg.naval) { a.target = cap; this._launchTransport(a, true); }   // sans transport maritime : pont aérien
      a.nextTransportAt = this.time + 12;
    }
  }

  // ---------------- transport maritime des troupes ----------------
  // Système abstrait : un groupe rejoint un port de son pays (par la terre), attend sa place (capacité de
  // transport, sécurité de la route), embarque, navigue sur une route maritime réelle, puis débarque dans
  // un port ami ou sur une côte ennemie. Jamais de bateau quand une route terrestre existe.
  _navalOK(sd) {
    if (!this.nav || !this.cfg.naval || this.rules.navalTransport === false || this.rules.movements === false) return false;
    return this._sealift(sd) > 0;
  }
  // capacité de transport (convois simultanés) : marine, ports, commerce maritime
  _sealift(sd) {
    const ports = sd.p.infra.ports || 0;
    if (ports < 4 && sd.navy < 0.5) return 0;
    if (this.rules.logistics === false) return 6;      // capacité de transport non limitée par la flotte
    return clamp(Math.round(0.6 + sd.navy / 6 + ports / 30) + (sd.techSealift || 0), 1, 9);
  }
  _seaOrders(sd) { let n = 0; for (const a of sd.agents) if (a.sea || a.transit >= 0) n++; return n; }
  // portée maximale raisonnable d'un convoi (km) : pas de traversée d'océan sans marine
  _seaRange(sd) { return (1600 + 950 * Math.sqrt(Math.max(0, sd.navy)) + 25 * (sd.p.infra.ports || 0)) * (1 + (sd.techRange || 0)); }
  // port du pays le plus pertinent sur une masse terrestre (proche du groupe et de la destination)
  _portIn(sd, comp, near, toward, owner = sd.e, lab = null) {
    const g = this.grid;
    const list = g.coastByComp.get(comp);
    if (!list) return -1;
    let best = -1, bd = Infinity;
    const n = Math.min(list.length, lab !== null ? 900 : 260);
    for (let t = 0; t < n; t++) {
      const i = list.length <= n ? list[t] : list[this.rng.int(list.length)];
      if (this.owner[i] !== owner) continue;
      if (lab !== null && this._lab(sd, i) !== lab) continue;          // port joignable par la terre depuis le groupe
      let d = (near >= 0 ? distKm(g, near, i) * 0.6 : 0) + (toward >= 0 ? distKm(g, i, toward) : 0);
      if (this.details) d -= this.details.portCell[i] * 180;   // les vrais ports sont préférés
      if (d < bd) { bd = d; best = i; }
    }
    return best;
  }
  // ordre de transport maritime : retourne false si aucun itinéraire pertinent
  _orderSea(sd, a, dest, opts = {}) {
    const g = this.grid;
    const here = this._agentLab(sd, a);
    // jamais de bateau quand une route terrestre praticable existe
    if (dest < 0 || (!opts.landing && this.owner[dest] === sd.e && this._lab(sd, dest) === here) || (opts.landing && g.comp[dest] === g.comp[a.cell] && !opts.strait)) { if (dest >= 0 && !opts.landing) { a.post = dest; a.postKey = opts.key ?? a.postKey; } return false; }
    const port = this._portIn(sd, g.comp[a.cell], a.cell, dest, sd.e, here);
    if (port < 0) return false;
    let to = dest;
    if (!opts.landing) { const dl = this._lab(sd, dest); to = g.coastal[dest] && this.owner[dest] === sd.e ? dest : this._portIn(sd, g.comp[dest], -1, dest, sd.e, dl); if (to < 0) return false; }
    else if (!g.coastal[dest]) { to = this._portIn(sd, g.comp[dest], -1, dest, this.owner[dest]); if (to < 0) return false; }
    const route = this.nav.seaRoute(port, to);
    if (!route || route.length < 2) return false;
    const len = polylineLengthKm(route);
    if (len > this._seaRange(sd)) return false;
    a.sea = { phase: 'toPort', port, to, dest, landing: !!opts.landing, key: opts.key ?? null, reason: opts.reason || '', t: this.time, len: Math.round(len) };
    a.post = port; a.postKey = opts.key ?? null; a.engaged = false; a.target = -1;
    if (opts.landing) a.op = 'landing';
    sd.nextSeaOrder = this.time + 4;
    return true;
  }
  _cancelSea(a, why = '') {
    if (this.docked) this.docked = this.docked.filter((d) => d.boarding !== a.id);
    a.sea = null; a.postKey = null; if (a.op === 'landing') a.op = null;
    a.nextTransportAt = this.time + 10;
    void why;
  }
  // risque de la route : marines ennemies plus fortes (0-1)
  _seaRisk(sd, len) {
    const S = this.S, k = sd.index;
    let enemy = 0;
    for (let o = 0; o < S; o++) if (this.atWar[k * S + o] && !this.sides[o].eliminated) enemy += this.sides[o].navPow;
    if (enemy <= 0) return 0;
    return clamp(enemy / (enemy + sd.navPow * 1.3 + 0.5) * Math.min(1.4, len / 2500), 0, 1);
  }
  // ports : chargement, attente (capacité, sécurité), départ ; vérifications pendant la traversée
  _updateNaval() {
    if (!this.nav) return;
    const g = this.grid;
    for (const sd of this.sides) {
      if (sd.eliminated) continue;
      let used = 0;
      for (const tr of this.transports) if (tr.side === sd.index && tr.kind === 'ship') used++;
      const cap = this._sealift(sd);
      for (const a of sd.agents) {
        const sea = a.sea;
        if (!sea || a.transit >= 0) continue;
        // port perdu, ou ordre devenu inutile
        if (this.owner[sea.port] !== sd.e || (!sea.landing && this.owner[sea.dest] !== sd.e && this.owner[sea.to] !== sd.e) || (sea.landing && !this._enemyOf(sd.index, sea.to))) {
          if (!sea.landing && this.owner[sea.dest] === sd.e) { const t2 = this._portIn(sd, g.comp[sea.dest], -1, sea.dest, sd.e, this._lab(sd, sea.dest)); if (t2 >= 0) { sea.to = t2; continue; } }
          this._cancelSea(a, 'invalide'); continue;
        }
        if (sea.phase === 'toPort') {
          if (this._agentDist(a, sea.port) <= 8) {
            sea.phase = 'port'; sea.since = this.time; sea.ready = this.time + clamp(4.5 - (sd.p.infra.ports || 0) / 30, 1.2, 4.5);
            // navire à quai pendant l'embarquement (visible sur la carte)
            const r0 = this.nav.seaRoute(sea.port, sea.to);
            if (r0 && r0.length >= 2) {
              if (!this.docked) this.docked = [];
              const path = [[r0[1][0], r0[1][1], r0[1][2]], [r0[0][0], r0[0][1], r0[0][2]]];
              this.docked.push({ kind: 'ship', side: sd.index, path, length: Math.max(2, polylineLengthKm(path)), until: sea.ready + 1, t: this.time, boarding: a.id });
            }
          }
          else if (this.time - sea.t > 60) this._cancelSea(a, 'trop long');
          continue;
        }
        if (sea.phase === 'port' && this.docked) for (const d of this.docked) if (d.boarding === a.id) d.until = Math.max(d.until, this.time + 1.2);   // le navire attend au quai
        if (sea.phase !== 'port' || this.time < sea.ready) continue;
        // attente au port : capacité de transport, sécurité de la route
        const risk = this._seaRisk(sd, sea.len);
        const urgent = sea.landing || sea.reason === 'front';
        if (used >= cap || (risk > 0.55 && !urgent && this.time - sea.since < 30)) {
          if (this.time - sea.since > 45) this._cancelSea(a, 'attente');
          continue;
        }
        if (this.transports.length >= this.cfg.maxTransports) continue;
        this._sail(sd, a);
        used++;
      }
    }
    // pendant la traversée : interceptions, destination perdue -> nouvelle destination ou retour
    if (this.tickCount % 20 === 11) for (const tr of this.transports) {
      if (tr.kind !== 'ship' || !tr.troops) continue;
      const sd = this.sides[tr.side];
      if (!tr.landing && this.owner[tr.to] !== sd.e && !tr.returning) {
        const a = sd.agents.find((x) => x.id === tr.agent);
        const dest = a && a.sea ? a.sea.dest : tr.to;
        const alt = this.owner[dest] === sd.e ? this._portIn(sd, g.comp[dest], -1, dest, sd.e, this._lab(sd, dest)) : -1;
        this._redirect(tr, alt >= 0 ? alt : tr.from, alt < 0);
        if (this.time - (sd.lastConvoyMsg || -99) > 30) { sd.lastConvoyMsg = this.time; this._emit({ icon: '🚢', title: 'CONVOI DÉROUTÉ', tone: 'neutral', side: tr.side, text: alt >= 0 ? `Le port d'arrivée est perdu : le convoi de ${sd.name} change de destination.` : `Plus aucun port sûr : le convoi de ${sd.name} fait demi-tour.` }); }
      }
      if (this.tickCount % 40 === 11 && this.fleets.length) {
        const pos = this._pathPos(tr);
        for (const f of this.fleets) {
          if (!this.atWar[tr.side * this.S + f.side]) continue;
          const fp = this._pathPos(f);
          const d = Math.acos(clamp(pos[0] * fp[0] + pos[1] * fp[1] + pos[2] * fp[2], -1, 1)) * EARTH_R;
          if (d > 350) continue;
          const od = this.sides[f.side];
          const hit = od.navPow / (od.navPow + sd.navPow + 0.5);
          if (this.rng.next() < hit * 0.6 * (1 - (sd.convoyK || 0))) {
            const lost = tr.cargo * hit * 0.18;
            applyLosses(sd, lost, false);
            const a = sd.agents.find((x) => x.id === tr.agent);
            if (a) a.str = Math.max(0.1, (a.str || 1) * (1 - hit * 0.18));
            tr.intercepted = (tr.intercepted || 0) + 1;
            if (this.time - (sd.lastConvoyMsg || -99) > 25) { sd.lastConvoyMsg = this.time; this._emit({ icon: '⚓', title: 'CONVOI INTERCEPTÉ', tone: 'bad', side: tr.side, text: `La marine de ${od.name} attaque un convoi de ${sd.name} : pertes à bord.` }); }
          }
          break;
        }
      }
    }
  }
  // départ du convoi
  _sail(sd, a) {
    const sea = a.sea;
    const route = this.nav.seaRoute(sea.port, sea.to);
    if (!route || route.length < 2) { this._cancelSea(a, 'route'); return; }
    const length = polylineLengthKm(route);
    const speed = 520 * (0.8 + sd.stats.mobilite / 250) * (0.85 + 0.15 * Math.min(1, (sd.p.infra.ports || 0) / 60));
    if (this.docked) this.docked = this.docked.filter((d) => d.boarding !== a.id);   // le navire à quai appareille
    const tr = {
      id: ++this._id, kind: 'ship', troops: true, side: sd.index, agent: a.id, from: sea.port, to: sea.to, landing: sea.landing,
      path: route.map((p) => [p[0], p[1], p[2]]), length, done: 0, speed,
      cargo: Math.max(1, Math.round(sd.units / Math.max(1, sd.agents.length) * 0.4)), t0: this.time,
    };
    this.transports.push(tr);
    a.transit = tr.id; a.engaged = false;
    sea.phase = 'sea';
    sd.resources = Math.max(0, sd.resources - 3);
    sd.money -= sd.unitCostBn * 0.6;
    if (this.time - (sd.lastLandingMsg || -99) > 40 && (sd.border.length === 0 || sea.landing || this.rng.chance(0.3))) {
      sd.lastLandingMsg = this.time;
      this._emit({ icon: '🚢', title: sea.landing ? 'DÉBARQUEMENT EN PRÉPARATION' : 'TROUPES EMBARQUÉES', tone: 'neutral', side: sd.index, transport: tr.id,
        text: sea.landing ? `${sd.name} embarque des troupes pour débarquer sur les côtes ${de(this._ownerName(sea.to))}.` : `${sd.name} transfère des troupes par la mer vers ${this._regionName(sea.dest)}.` });
    }
  }
  _regionName(i) {
    const e = this.entities[this.owner[i]];
    return e ? `le territoire ${de(e.name).replace(/^de /, 'de ')}` : 'un territoire';
  }
  // nouvelle destination en mer (ou retour au port de départ)
  _redirect(tr, to, back) {
    const pos = this._pathPos(tr);
    const g = this.grid;
    const end = [g.xyz[to * 3], g.xyz[to * 3 + 1], g.xyz[to * 3 + 2]];
    let path;
    if (back) {
      // retour par la route déjà parcourue
      let k = 1; while (k < tr.path.length - 1 && tr._seg && tr._seg[k] < tr.done) k++;
      path = [pos, ...tr.path.slice(0, k).reverse()];
    } else path = [...tr.path.slice(0, -1).filter((_, q) => !tr._seg || tr._seg[q] >= tr.done), end];
    if (!back) path.unshift(pos);
    tr.path = path.map((p) => [p[0], p[1], p[2]]);
    tr.length = Math.max(2, polylineLengthKm(tr.path));
    tr.done = 0; tr.to = to; tr.returning = back;
    delete tr._seg; delete tr._cum;
    if (back) tr.landing = false;
  }

  // cible de débarquement : côte d'un ennemi d'outre-mer, la plus proche parmi un échantillon
  _landingTarget(k, a) {
    const g = this.grid, S = this.S;
    let best = -1, bd = Infinity;
    for (let o = 0; o < S; o++) {
      if (!this.atWar[k * S + o] || this.contact[k * S + o] >= 4 || this.sides[o].eliminated) continue;
      const od = this.sides[o];
      const ref = od.capital >= 0 && this.owner[od.capital] === od.e ? od.capital : od.border[0];
      if (ref === undefined || ref < 0) continue;
      const list = g.coastByComp.get(g.comp[ref]);
      if (!list) continue;
      for (let t = 0; t < 220; t++) {
        const i = list[this.rng.int(list.length)];
        if (this.owner[i] !== od.e) continue;
        const d = this._agentDist(a, i);
        if (d < bd) { bd = d; best = i; }
      }
    }
    return best;
  }

  _pickPost(sd, a, p) {
    const len = p.cells.length;
    let c = p.cells[Math.min(len - 1, Math.floor(((a.postSlot ?? 0.5) * 0.8 + 0.1) * len))];
    if (this.owner[c] !== sd.e) c = p.cells.find((x) => this.owner[x] === sd.e) ?? -1;
    if (c < 0) return -1;
    // un peu en retrait de la ligne de front (dans le pays) ; autour de la capitale pour le cœur
    return this._ownCellNear(sd, c, this.grid.comp[c], p.front ? 2 : p.core ? 6 : 3);
  }

  // NATION SIMULATOR : le nombre de groupes suit la taille réelle de l'armée (recrutement, pertes, démobilisation)
  _adjustAgents(sd) {
    if (sd.eliminated) return;
    const cap = Math.max(1, Math.floor(this.cfg.maxAgents / Math.max(1, this.sides.length)));
    const target = Math.min(cap, clamp(Math.round(1.5 + Math.sqrt(landTotal(sd)) / 6), 1, 9));
    if (sd.agents.length < target) this._spawnAgent(sd, 0.5);
    else if (sd.agents.length > target + 1) {
      const idle = sd.agents.filter((a) => !a.engaged && a.transit < 0 && !a.sea && a.op !== 'landing');
      const a = idle[idle.length - 1];
      if (a) sd.agents.splice(sd.agents.indexOf(a), 1);
    }
  }

  addAgents(s, k) {
    const sd = this.sides[s];
    let added = 0;
    for (let q = 0; q < k && sd.agents.length < this._agentCount(sd) + 2; q++) if (this._spawnAgent(sd, q * 0.3)) added++;
    return added;
  }

  _randomOwned(e) {
    for (let t = 0; t < 400; t++) { const i = this.rng.int(this.n); if (this.owner[i] === e) return i; }
    for (let i = 0; i < this.n; i++) if (this.owner[i] === e) return i;
    return -1;
  }

  _agentDist(a, i) {
    const g = this.grid;
    const dot = a.x * g.xyz[i * 3] + a.y * g.xyz[i * 3 + 1] + a.z * g.xyz[i * 3 + 2];
    return Math.acos(clamp(dot, -1, 1)) * EARTH_R;
  }

  _enemyNeighbor(s, b) {
    const g = this.grid;
    let chosen = -1, seen = 0;
    for (let k = g.nbrStart[b]; k < g.nbrStart[b + 1]; k++) {
      const j = g.nbr[k];
      if (!this._enemyOf(s, j)) continue;
      seen++;
      if (this.rng.int(seen) === 0) chosen = j;
    }
    return chosen;
  }

  _remoteTarget(s, a) {
    const g = this.grid;
    const list = g.coastalList;
    let best = -1, bd = Infinity;
    for (let t = 0; t < 140; t++) {
      const i = list[this.rng.int(list.length)];
      if (!this._enemyOf(s, i)) continue;
      const d = this._agentDist(a, i);
      if (this.sideOf[this.owner[i]] < 0 && d > 1500) continue;
      if (d < bd) { bd = d; best = i; }
    }
    return best;
  }

  _launchTransport(a, forcePlane = false) {
    if (this.transports.length >= this.cfg.maxTransports || this.time < (a.nextTransportAt || 0)) { a.target = -1; return; }
    a.nextTransportAt = this.time + this.rng.range(7, 12);
    const s = a.side, sd = this.sides[s], g = this.grid;
    let kind = 'plane';
    let path = null;
    let from = a.cell;
    if (!forcePlane && this.nav && !g.coastal[a.target]) {
      const list = g.coastByComp.get(g.comp[a.target]);
      let best = -1, bd = Infinity;
      if (list) for (let t = 0; t < 200; t++) {
        const i = list[this.rng.int(list.length)];
        if (!this._enemyOf(s, i)) continue;
        const d = distKm(g, i, a.target);
        if (d < bd) { bd = d; best = i; }
      }
      if (best >= 0) a.target = best;
    }
    if (!forcePlane && this.nav && g.coastal[a.target]) {
      let best = -1, bd = Infinity;
      const list = g.coastByComp.get(g.comp[a.cell]) || g.coastalList;
      for (let t = 0; t < 250; t++) {
        const i = list[this.rng.int(list.length)];
        if (this.owner[i] !== sd.e) continue;
        const d = distKm(g, i, a.target);
        if (d < bd) { bd = d; best = i; }
      }
      if (best >= 0) {
        const route = this.nav.seaRoute(best, a.target);
        if (route && route.length >= 2) { path = route; kind = 'ship'; from = best; }
      }
    }
    if (!path) {
      const p0 = [a.x, a.y, a.z];
      const p1 = [g.xyz[a.target * 3], g.xyz[a.target * 3 + 1], g.xyz[a.target * 3 + 2]];
      path = greatCircle(p0, p1, 40);
      kind = 'plane';
    }
    const length = polylineLengthKm(path);
    const speed = kind === 'ship' ? 520 * (0.8 + sd.stats.mobilite / 250) : 1500 * (0.8 + sd.stats.mobilite / 300);
    const tr = {
      id: ++this._id, kind, side: s, agent: a.id, from, to: a.target,
      path: path.map((p) => [p[0], p[1], p[2]]), length, done: 0, speed,
      cargo: Math.max(1, Math.round(sd.units / Math.max(1, sd.agents.length) * 0.4)),
      t0: this.time,
    };
    this.transports.push(tr);
    a.transit = tr.id;
    a.engaged = false;
    sd.resources = Math.max(0, sd.resources - (kind === 'ship' ? 3 : 5));
    sd.money -= sd.unitCostBn * (kind === 'ship' ? 0.6 : 1.2);
    if (this.time - sd.lastLandingMsg > 40 && (sd.border.length === 0 || this.rng.chance(0.25))) {
      sd.lastLandingMsg = this.time;
      this._emit({ icon: kind === 'ship' ? '🚢' : '✈️', title: kind === 'ship' ? 'NAVIRES EN ROUTE' : 'PONT AÉRIEN', tone: 'neutral', side: s,
        transport: tr.id, text: `${sd.name} ${kind === 'ship' ? 'envoie des navires de transport' : 'lance un transport aérien'} vers ${this._ownerName(a.target)}.` });
    }
  }

  _ownerName(i) { const e = this.entities[this.owner[i]]; return e ? e.name : 'un territoire'; }

  // supériorité navale de s sur la zone d'un débarquement (0-1)
  navalEdge(s, targetCell) {
    const o = this.sideOf[this.owner[targetCell]];
    const mine = this.sides[s].navPow;
    const theirs = o >= 0 ? this.sides[o].navPow : 0;
    return mine / (mine + theirs + 0.5);
  }

  _updateTransports() {
    if (!this.docked) this.docked = [];
    this.docked = this.docked.filter((d) => d.until > this.time);
    const done = [];
    for (const tr of this.transports) {
      tr.done += tr.speed * TICK;
      if (tr.done >= tr.length) done.push(tr);
    }
    for (const tr of done) {
      this.transports.splice(this.transports.indexOf(tr), 1);
      const sd = this.sides[tr.side];
      const a = sd.agents.find((x) => x.id === tr.agent);
      const g = this.grid;
      this.docked.push({ kind: tr.kind, side: tr.side, path: tr.path, length: tr.length, until: this.time + 2.2, t: this.time });
      if (a) {
        a.transit = -1;
        a.landedAt = this.time;
        a.x = a.px = g.xyz[tr.to * 3]; a.y = a.py = g.xyz[tr.to * 3 + 1]; a.z = a.pz = g.xyz[tr.to * 3 + 2];
        a.cell = tr.to; a.route = null; a.routeTo = -1;
        if (this.owner[tr.to] === sd.e) a.lastOwn = tr.to;
        // débarquement dans un port ami : le groupe rejoint sa zone d'affectation par la terre
        const sea = a.sea;
        if (sea && !tr.landing && !tr.returning && this.owner[sea.dest] === sd.e && this._lab(sd, sea.dest) === this._lab(sd, tr.to)) { a.post = sea.dest; a.postKey = sea.key; }
        else { a.post = tr.to; a.postKey = null; }
        a.sea = null; a.op = null;
        a.nextTransportAt = Math.max(a.nextTransportAt || 0, this.time + 5);
      }
      if (sd.eliminated) continue;
      let landed = this.owner[tr.to] === sd.e;
      const edge = tr.kind === 'ship' ? this.navalEdge(tr.side, tr.to) : 0.5;
      if (this._enemyOf(tr.side, tr.to) && this._attempt(tr.side, tr.to, a, 0.5 + edge * 0.9 + (tr.kind === 'ship' ? (sd.landingK || 0) : 0))) {
        landed = true;
        let extra = 0;
        for (let k = g.nbrStart[tr.to]; k < g.nbrStart[tr.to + 1] && extra < 4; k++) {
          const j = g.nbr[k];
          if (this._enemyOf(tr.side, j)) { this.flip(j, sd.e); extra++; }
        }
      }
      if (!landed && a && this.owner[tr.from] === sd.e) { a.returnTo = tr.from; a.returnAt = this.time + 1.6; }
    }
  }

  // ---------------- opérations aériennes ----------------
  launchAirStrike(s, sec, f) {
    const sd = this.sides[s];
    if (this.strikes.length >= 40) return;
    const g = this.grid;
    let base = sd.capital >= 0 && this.owner[sd.capital] === sd.e ? sd.capital : (sd.border.length ? sd.border[0] : -1);
    if (base < 0) return;
    // base aérienne : parcelle du pays la plus proche du front parmi un échantillon
    const tc = f.cell >= 0 ? f.cell : sec.cells[0];
    let bd = distKm(g, base, tc);
    for (let t = 0; t < 30; t++) {
      const i = sd.border.length ? sd.border[this.rng.int(sd.border.length)] : -1;
      if (i < 0) break;
      const d = distKm(g, i, tc);
      if (d > 250 && d < bd) { bd = d; base = i; }
    }
    // cible légèrement en territoire ennemi
    let target = tc;
    for (let k = g.nbrStart[tc]; k < g.nbrStart[tc + 1]; k++) if (this._enemyOf(s, g.nbr[k])) { target = g.nbr[k]; break; }
    const p0 = [g.xyz[base * 3], g.xyz[base * 3 + 1], g.xyz[base * 3 + 2]], p1 = [g.xyz[target * 3], g.xyz[target * 3 + 1], g.xyz[target * 3 + 2]];
    const go = greatCircle(p0, p1, 24);
    const path = [...go, ...go.slice(0, -1).reverse()];
    const length = polylineLengthKm(path);
    const planes = Math.min(sd.air * 0.25, 2 + sd.air * 0.08);
    this.strikes.push({ id: ++this._id, kind: 'strike', side: s, sector: sec.key, o: sec.o, target, path: path.map((p) => [p[0], p[1], p[2]]), length, done: 0, speed: 2400, hit: false, planes, t0: this.time });
    sd.money -= sd.unitCostBn * planes * 0.8;
  }

  _updateStrikes() {
    for (const st of this.strikes) {
      st.done += st.speed * TICK;
      if (!st.hit && st.done >= st.length / 2) {
        st.hit = true;
        const sd = this.sides[st.side];
        const o = st.o;
        if (o < 0 || this.sides[o].eliminated) continue;
        const od = this.sides[o];
        // interception : défense aérienne adverse
        const intercept = Math.min(0.85, od.airPow / (od.airPow + sd.airPow * 1.3 + 0.5) * 0.45 + (od.airDef || 0));   // défense aérienne (arbre militaire)
        const lost = st.planes * intercept * this.rng.range(0.5, 1.2);
        sd.air = Math.max(0, sd.air - lost * 0.35);
        od.air = Math.max(0, od.air - lost * 0.12);
        const eff = (1 - intercept) * st.planes * sd.q;
        const f = sd.front[st.sector];
        if (f) f.airUntil = this.time + 6;
        const fd = od.front[secKey(st.side, this.bins[st.target])];
        if (fd) fd.fort = Math.max(0, fd.fort - 0.12 * (1 - intercept));
        applyLosses(od, eff * 0.35, false);
        if (this.time - sd.lastStrikeMsg > 35) {
          sd.lastStrikeMsg = this.time;
          this._emit({ icon: '✈️', title: 'FRAPPE AÉRIENNE', tone: 'neutral', side: st.side, cell: st.target, text: `L'aviation de ${sd.name} appuie l'offensive contre ${od.name}${intercept > 0.25 ? ' malgré une forte défense aérienne' : ''}.` });
        }
      }
    }
    this.strikes = this.strikes.filter((st) => st.done < st.length);
  }

  // ---------------- flottes ----------------
  _updateFleets() {
    if (!this.nav || !this.cfg.naval) return;
    const g = this.grid;
    // création / suppression selon la taille des marines
    if (this.tickCount % 40 === 7) {
      for (const sd of this.sides) {
        if (sd.eliminated) continue;
        const want = sd.navy >= 1.2 && sd.p.infra.ports > 5 && this.isAtWar(sd.index) ? clamp(Math.floor(1 + sd.navy / 6), 1, 3) : 0;   // flottes visibles en temps de guerre
        const mine = this.fleets.filter((f) => f.side === sd.index);
        if (mine.length > want) { const f = mine[0]; this.fleets.splice(this.fleets.indexOf(f), 1); }
        else if (mine.length < want && this.fleets.length < this.cfg.maxFleets) this._newFleet(sd);
      }
    }
    for (const f of this.fleets) {
      f.done += f.speed * TICK;
      if (f.done >= f.length) this._routeFleet(f);
    }
    // combats navals (toutes les 2 s)
    if (this.tickCount % 40 === 21 && this.fleets.length > 1) {
      const pos = this.fleets.map((f) => this._pathPos(f));
      for (let x = 0; x < this.fleets.length; x++) for (let y = x + 1; y < this.fleets.length; y++) {
        const A = this.fleets[x], B = this.fleets[y];
        if (!this.atWar[A.side * this.S + B.side]) continue;
        const d = Math.acos(clamp(pos[x][0] * pos[y][0] + pos[x][1] * pos[y][1] + pos[x][2] * pos[y][2], -1, 1)) * EARTH_R;
        if (d > 320) continue;
        const sa = this.sides[A.side], sb = this.sides[B.side];
        const pa = sa.navPow, pb = sb.navPow;
        sa.navy = Math.max(0, sa.navy - pb / (pa + pb + 0.1) * 0.6 * this.rng.range(0.6, 1.3));
        sb.navy = Math.max(0, sb.navy - pa / (pa + pb + 0.1) * 0.6 * this.rng.range(0.6, 1.3));
        if (!A.lastFight || this.time - A.lastFight > 30) {
          const winner = pa >= pb ? sa : sb;
          this._emit({ icon: '⚓', title: 'BATAILLE NAVALE', tone: 'neutral', side: winner.index, text: `Affrontement naval entre les flottes de ${sa.name} et de ${sb.name} : avantage ${winner.name}.` });
          for (const w of this.activeWars) if ((w.a.includes(A.side) && w.b.includes(B.side)) || (w.b.includes(A.side) && w.a.includes(B.side))) {
            const cell = this._nearestCoast(pos[x]);
            w.battles.push({ id: `${w.id}-n${w.battles.length + 1}`, name: `Bataille navale (${sa.name} / ${sb.name})`, naval: true, t0: this.time, t1: this.time + 1, cell, attacker: sa.e, defender: sb.e, attackerName: sa.name, defenderName: sb.name, result: `Avantage ${winner.name}`, gained: 0, lost: 0, km2Gained: 0, km2Lost: 0, soldiers: Math.round((sa.navy + sb.navy) * 1000), losses: [0, 0], region: 'En mer' });
          }
        }
        A.lastFight = B.lastFight = this.time;
      }
    }
  }
  _pathPos(tr) {
    const p = tr.path;
    let d = tr.done, k = 1;
    if (!tr._seg) { tr._seg = [0]; for (let q = 1; q < p.length; q++) tr._seg.push(tr._seg[q - 1] + Math.acos(clamp(p[q - 1][0] * p[q][0] + p[q - 1][1] * p[q][1] + p[q - 1][2] * p[q][2], -1, 1)) * EARTH_R); }
    while (k < p.length - 1 && tr._seg[k] < d) k++;
    const a = p[k - 1], b = p[k];
    const t = clamp((d - tr._seg[k - 1]) / Math.max(1e-6, tr._seg[k] - tr._seg[k - 1]), 0, 1);
    return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
  }
  _nearestCoast(p) {
    const g = this.grid; const list = g.coastalList;
    let best = list[0], bd = -2;
    for (let t = 0; t < 400; t++) { const i = list[(t * 7919) % list.length]; const d = g.xyz[i * 3] * p[0] + g.xyz[i * 3 + 1] * p[1] + g.xyz[i * 3 + 2] * p[2]; if (d > bd) { bd = d; best = i; } }
    return best;
  }
  _ownCoast(sd) {
    const g = this.grid;
    for (let t = 0; t < 300; t++) { const i = g.coastalList[this.rng.int(g.coastalList.length)]; if (this.owner[i] === sd.e) return i; }
    return -1;
  }
  _newFleet(sd) {
    const c = this._ownCoast(sd);
    if (c < 0) return;
    const f = { id: ++this._id, kind: 'fleet', side: sd.index, at: c, path: [[this.grid.xyz[c * 3], this.grid.xyz[c * 3 + 1], this.grid.xyz[c * 3 + 2]]], length: 0, done: 0, speed: 380 };
    this.fleets.push(f);
    this._routeFleet(f);
  }
  _routeFleet(f) {
    const sd = this.sides[f.side];
    const g = this.grid;
    // patrouille : vers une côte ennemie (guerre) ou le long des côtes du pays
    let to = -1;
    const S = this.S;
    if (this.isAtWar(f.side) && this.rng.next() < 0.6) {
      for (let t = 0; t < 200 && to < 0; t++) {
        const i = g.coastalList[this.rng.int(g.coastalList.length)];
        const o = this.sideOf[this.owner[i]];
        if (o >= 0 && this.atWar[f.side * S + o] && distKm(g, i, f.at) < 3500) to = i;
      }
    }
    if (to < 0) { const c = this._ownCoast(sd); if (c >= 0 && distKm(g, c, f.at) < 3000) to = c; }
    const route = to >= 0 && to !== f.at ? this.nav.seaRoute(f.at, to) : null;
    if (!route || route.length < 2) { f.path = [f.path[f.path.length - 1], f.path[f.path.length - 1]]; f.length = 1; f.done = 0; f.speed = 0.1; return; }
    f.path = route.map((p) => [p[0], p[1], p[2]]);
    f.length = polylineLengthKm(route);
    f.done = 0; f.speed = 330 + sd.p.tech * 1.2; f.at = to; delete f._seg; delete f._cum;
  }

  _updateAgents(sd) {
    const g = this.grid;
    for (const a of sd.agents) {
      a.px = a.x; a.py = a.y; a.pz = a.z;
      if (this.time < a.bornAt || a.transit >= 0) continue;
      if (a.returnAt !== undefined) {
        if (this.time < a.returnAt) { a.engaged = true; continue; }
        const r = a.returnTo;
        if (this.owner[r] === sd.e) {
          a.x = a.px = g.xyz[r * 3]; a.y = a.py = g.xyz[r * 3 + 1]; a.z = a.pz = g.xyz[r * 3 + 2];
          a.cell = r; a.landedAt = this.time;
        }
        delete a.returnAt; delete a.returnTo;
      }
      const t = this.rules.movements === false ? a.cell : a.post;
      if (t < 0) { a.engaged = false; a.target = -1; continue; }
      // itinéraire terrestre par les territoires praticables (jamais à travers la mer ni un pays neutre)
      let w = t;
      if (t !== a.cell && this.rules.movements !== false) {
        if (a.routeTo !== t || a.routePass !== sd.passSig) {
          if (this._pathBudget > 0) {
            this._pathBudget--;
            const path = this._landPath(sd, a.cell, t);
            a.route = this._waypoints(path); a.routeI = 0; a.routeTo = t; a.noRoute = !path; a.routePass = sd.passSig;
          } else { a.engaged = false; a.target = -1; continue; }       // itinéraire calculé au pas suivant
        }
        if (a.noRoute) {
          // aucune route terrestre : on ne marche pas sur la mer ni à travers un pays neutre ; la répartition
          // (ou le transport maritime) prend le relais
          a.engaged = false; a.target = -1;
          if (this.tickCount % 30 === a.id % 30) { a.postKey = null; a.routeTo = -1; }
          continue;
        }
        if (a.route) {
          while (a.routeI < a.route.length - 1 && this._agentDist(a, a.route[a.routeI]) < 9) a.routeI++;
          w = a.route[Math.min(a.routeI, a.route.length - 1)];
        }
      }
      const tx = g.xyz[w * 3], ty = g.xyz[w * 3 + 1], tz = g.xyz[w * 3 + 2];
      const dot = clamp(a.x * tx + a.y * ty + a.z * tz, -1, 1);
      const ang = Math.acos(dot);
      const distK = ang * EARTH_R;
      if (distK > 6) {
        // déplacement terrestre : infrastructures et terrain ; transferts rapides (rail, route) sur les longues distances
        const terr = TERRAIN_SPEED[this.geo.biome[a.cell]] || 1;
        const ease = a.landedAt !== undefined ? Math.min(1, 0.3 + (this.time - a.landedAt) / 3) : 1;
        const stepK = a.speed * sd.speedK * terr * ease * (distK > 1200 ? 2.6 : 1) * TICK;
        const f = Math.min(1, stepK / distK);
        const s1 = Math.sin((1 - f) * ang) / Math.sin(ang), s2 = Math.sin(f * ang) / Math.sin(ang);
        a.x = a.x * s1 + tx * s2; a.y = a.y * s1 + ty * s2; a.z = a.z * s1 + tz * s2;
        const l = Math.hypot(a.x, a.y, a.z) || 1; a.x /= l; a.y /= l; a.z /= l;
      }
      const f = a.postKey && a.postKey[0] === 'S' ? sd.front[Number(a.postKey.slice(1))] : null;
      const distPost = w === t ? distK : this._agentDist(a, t);
      a.engaged = distPost < 80 && !!f && f.status !== 'inactive' && !a.sea;
      a.target = a.engaged ? t : -1;
      if (this.tickCount % 10 === a.id % 10) {
        const la = Math.asin(a.y) * 180 / Math.PI, lo = Math.atan2(a.x, a.z) * 180 / Math.PI;
        const x = Math.floor((lo + 180) / g.RES) % g.W, y = Math.floor((90 - la) / g.RES);
        const c = y >= 0 && y < g.H ? g.indexAt[y * g.W + x] : -1;
        if (c >= 0) { a.cell = c; if (this.owner[c] === sd.e) a.lastOwn = c; }
      }
    }
  }

  _nearAgentTarget(s, a) {
    const g = this.grid;
    const p = g.pos[a.cell];
    if (p < 0) return -1;
    const x0 = p % g.W, y0 = (p / g.W) | 0;
    const S = this.S;
    let chosen = -1, seen = 0;
    for (let dy = -3; dy <= 3; dy++) {
      const y = y0 + dy; if (y < 0 || y >= g.H) continue;
      for (let dx = -3; dx <= 3; dx++) {
        const i = g.indexAt[y * g.W + ((x0 + dx + g.W) % g.W)];
        if (i < 0 || !this._enemyOf(s, i)) continue;
        let touches = false;
        for (let k = g.nbrStart[i]; k < g.nbrStart[i + 1]; k++) {
          const o = this.sideOf[this.owner[g.nbr[k]]];
          if (o === s || (o >= 0 && this.allied[s * S + o])) { touches = true; break; }
        }
        if (!touches) continue;
        seen++;
        if (this.rng.int(seen) === 0) chosen = i;
      }
    }
    return chosen;
  }

  // ---------------- poches isolées ----------------
  _computeIsolation() {
    const g = this.grid;
    this.isolated.fill(0);
    if (!this._seen) this._seen = new Uint8Array(this.n);
    const seen = this._seen;
    seen.fill(0);
    const stack = [];
    for (const sd of this.sides) {
      if (sd.eliminated || sd.cells === 0 || !sd.border.length) continue;   // poches isolées : seulement pour les pays en guerre
      const comps = [];
      const starts = [];
      if (sd.capital >= 0 && this.owner[sd.capital] === sd.e) starts.push(sd.capital);
      for (const b of sd.border) starts.push(b);
      for (const st of starts) {
        if (seen[st]) continue;
        const comp = [];
        seen[st] = 1; stack.push(st);
        while (stack.length) {
          const a = stack.pop(); comp.push(a);
          for (let k = g.nbrStart[a]; k < g.nbrStart[a + 1]; k++) {
            const b = g.nbr[k];
            if (!seen[b] && this.owner[b] === sd.e) { seen[b] = 1; stack.push(b); }
          }
        }
        comps.push(comp);
      }
      if (!comps.length) continue;
      let main = comps[0];
      if (!(sd.capital >= 0 && this.owner[sd.capital] === sd.e)) main = comps.reduce((m, c) => (c.length > m.length ? c : m), comps[0]);
      for (const comp of comps) {
        if (comp === main) continue;
        if (comp.length > Math.max(25, sd.initial * 0.15)) continue;
        for (const a of comp) this.isolated[a] = 1;
      }
    }
  }

  _countOccupied() {
    for (const s of this.sides) s.occupiedCells = 0;
    for (let i = 0; i < this.n; i++) {
      if (!this.occupied[i]) continue;
      const s = this.sideOf[this.owner[i]];
      if (s >= 0) this.sides[s].occupiedCells++; else this.occupied[i] = 0;
    }
  }

  _integrate() {
    const g = this.grid;
    const base = this.cfg.integrationDelay;
    const ready = [];
    const keep = [];
    if (!this._occStamp) { this._occStamp = new Int32Array(this.n); this._occPass = 0; }
    const pass = ++this._occPass;
    for (const i of this.occList) {
      if (!this.occupied[i] || this._occStamp[i] === pass) continue;
      this._occStamp[i] = pass;
      const o = this.owner[i];
      const s = this.sideOf[o];
      if (s < 0) { this.occupied[i] = 0; continue; }
      const sd = this.sides[s];
      const held = this.time - this.lastFlip[i];
      let ok = held >= base * (1.25 - sd.stability * 0.5) * (1.2 - 0.4 * sd.p.politics.admin / 100) && this.borderPos[i] < 0 && this.contest[i] <= this.time;
      if (ok && held < base * 3) {
        let touch = false;
        for (let k = g.nbrStart[i]; k < g.nbrStart[i + 1]; k++) { const j = g.nbr[k]; if (this.owner[j] === o && !this.occupied[j]) { touch = true; break; } }
        ok = touch;
      }
      if (ok) ready.push(i); else keep.push(i);
    }
    this.occList = keep;
    const perSide = new Map();
    for (const i of ready) {
      const o = this.owner[i];
      const s = this.sideOf[o];
      this.occupied[i] = 0;
      this.sides[s].occupiedCells--;
      this.captures.push({ i, by: o, from: o, t: this.time, official: true });
      perSide.set(s, (perSide.get(s) || 0) + 1);
    }
    for (const [s, c] of perSide) {
      const sd = this.sides[s];
      sd.integratedAcc += c;
      const threshold = Math.max(60, sd.initial * 0.08);
      if (sd.integratedAcc >= threshold) {
        sd.integratedAcc = 0;
        this._emit({ icon: '📜', title: 'INTÉGRATION OFFICIELLE', tone: 'neutral', side: s, cell: ready.find((i) => this.sideOf[this.owner[i]] === s),
          text: `${sd.name} intègre officiellement une partie des territoires qu'il occupait.` });
      }
    }
  }

  officialCells(s) { const sd = this.sides[s]; return sd.cells - sd.occupiedCells; }

  _emit(evt) {
    const e = { ...evt, t: this.time };
    this.eventsOut.push(e);
    this.log.push(e);
    if (this.log.length > 400) this.log.shift();
  }

  _record() {
    this.history.push([Math.round(this.time * 10) / 10, ...this.sides.map((s) => s.cells)]);
  }

  // ---------------- économie mensuelle ----------------
  _month(s) {
    const sd = this.sides[s];
    const S = this.S;
    sd.nextMonth += MONTH_SEC;
    const atWar = this.isAtWar(s);
    const terr = (sd.cells - sd.occupiedCells * 0.65) / Math.max(1, sd.initial);
    // commerce : partenaires en paix ; blocus naval par les ennemis dominants en mer
    let tradeBonus = 0;
    for (const o of sd.tradePartners) if (!this.atWar[s * S + o] && !(this.sanctions && this.sanctions.length && sanctionedBetween(this, s, o))) tradeBonus += (sd.p.trade * this.sides[o].p.trade) / 10000 * 0.012 * (this.nation && (this.nation.deal(s, o) || {}).trade ? 1.8 : 1);
    tradeBonus = Math.min(this.nation ? 0.1 : 0.08, tradeBonus);
    let blockade = 0;
    if (atWar && sd.p.infra.ports > 5) for (let o = 0; o < S; o++) {
      if (!this.atWar[s * S + o]) continue;
      const od = this.sides[o];
      if (od.navPow > sd.navPow * 1.5 && od.navPow > 1) blockade += 0.05 * Math.min(1, od.navPow / Math.max(0.5, sd.navPow) - 1.5) * (sd.p.trade / 100) * (1 + (od.blockadeK || 0));
    }
    sd.blockade = Math.min(0.15, blockade) * (1 - (sd.blockadeRes || 0));
    // sanctions économiques et crises mondiales (énergie, alimentation) : perte (ou gain) de PIB
    sd.sanctionLoss = this.sanctions && this.sanctions.length ? sanctionDrag(this, s) : 0;
    sd.crisisLoss = this.crises && this.crises.length ? globalCrisisEffect(this, s) : 0;
    const ops = sd.opsAcc * sd.unitCostBn * 0.004;
    sd.opsAcc = 0;
    if (this.nation) this.nation.preMonth(s);
    const R = this.rules;
    if (R.trade === false) { tradeBonus = 0; sd.blockade = 0; }
    const evs = R.economy === false ? [] : monthTick(sd, { drag: clamp((sd.sanctionLoss || 0) + (sd.crisisLoss || 0), -0.03, 0.15), terrFactor: terr, atWar, tradeBonus, blockade: sd.blockade, opsCost: ops, debt: R.debt !== false, crises: R.crises !== false, research: R.research !== false, mobilization: R.mobilization !== false });
    if (R.economy === false && R.mobilization !== false) refreshCombat(sd);
    for (const ev of evs) {
      if (ev.type === 'crisis') {
        this._emit({ icon: '📉', title: 'CRISE ÉCONOMIQUE', tone: 'bad', side: s, text: `${sd.name} entre en crise économique : dette et déficits pèsent sur l'armée.` });
        this.chron('crisis', `Crise économique en ${sd.name}.`, { e: [sd.e] });
        this.hist(s, 'crisis', 'Crise économique.');
        aiLog(this, s, 'Crise économique : priorité au redressement des finances.', 'bad');
      } else if (ev.type === 'recovery') {
        this.hist(s, 'economy', 'Sortie de crise économique.');
        this._emit({ icon: '📈', title: 'REPRISE ÉCONOMIQUE', tone: 'good', side: s, text: `${sd.name} sort de la crise économique.` });
      }
    }
    // stabilité : territoire, crise, guerre
    sd.baseStability = 0.45 + sd.p.politics.stability / 200;
    // conséquences de la perte de territoire (révolte, moral, capacité militaire, diplomatie)
    if (R.wars !== false) territorialEffects(this, s);
    if (this.nation) { this.nation.month(s); this._adjustAgents(sd); }
  }

  // ---------------- boucle principale ----------------
  step() {
    if (this.finished) return;
    this.time += TICK;
    this.tickCount++;
    const rng = this.rng;
    const randomness = clamp(this.cfg.randomness, 0, 1);

    for (let k = 0; k < this.sides.length; k++) {
      const s = this.sides[k];
      if (s.eliminated) continue;
      s.mods = s.mods.filter((m) => m.until > this.time);
      const sigma = TUNE.momSigma + TUNE.momSigmaR * randomness;
      s.momentum += -s.momentum * TUNE.momRevert * TICK + sigma * Math.sqrt(TICK) * rng.normal();
      s.momentum = clamp(s.momentum, -TUNE.momMax, TUNE.momMax);
      const ratio = s.cells / s.initial;
      const terr = Math.sqrt(Math.max(0.05, ratio));
      s.resources = this.rules.resources === false ? 100 : Math.min(100, s.resources + s.regen * terr * (0.7 + 0.3 * s.readiness) * TICK);
      const stabTarget = s.baseStability * (0.55 + 0.45 * Math.min(1.15, ratio)) * (s.crisis ? 0.85 : 1) * (1 - 0.15 * s.exhaustion);
      s.stability = clamp(s.stability + (stabTarget - s.stability) * 0.12 * TICK, 0.15, 1);
      s.econBoost = Math.max(0, (s.econBoost || 0) - 0.2 * TICK);
      s.economy = clamp(s.econBase * (0.6 + 0.4 * Math.min(1.3, ratio)) * (0.8 + 0.4 * s.stability) + s.econBoost, 1, 100);
      if (this.time >= s.nextMonth) this._month(k);
      if (this.time >= s.ai.nextStrat) aiStrategic(this, k);
      if (this.time >= s.ai.nextOp) {
        aiOperational(this, k);
        const att = s.sectors ? s.sectors.filter((x) => s.front[x.key] && s.front[x.key].posture === 'attack').length : 0;
        s.phase = att > 0 ? 'offensive' : 'consolidation';
      }
    }
    if (this._bordersDirty) this._refreshDirty();

    // praticabilité (guerres, alliances) : un changement invalide les itinéraires en cours
    if (this.tickCount % 10 === 3) for (const sd of this.sides) {
      const S = this.S, k = sd.index; let sig = 3;
      for (let o = 0; o < S; o++) { const v = this.atWar[k * S + o] ? 2 : this.allied[k * S + o] ? 1 : 0; if (v) sig = (Math.imul(sig, 33) + o * 4 + v) | 0; }
      sd.passSig = sig;
      sd.passWar = this.isAtWar(k);                  // en paix, les armées restent sur leur sol (pas de transit chez les alliés)
    }
    this._pathBudget = 14;
    if (this.time >= (this._nextCoal || 0)) { this._nextCoal = this.time + MONTH_SEC; updateCoalitions(this); updateCrises(this); }                                       // itinéraires terrestres calculés par pas (lissage de charge)
    for (const s of this.sides) if (!s.eliminated) this._updateAgents(s);
    this._updateNaval();
    this._updateTransports();
    this._updateStrikes();
    this._updateFleets();

    const warm = 0.45 + 0.55 * Math.min(1, this.time / 15);
    const inten = 1 + TUNE.ramp * this.intensity();
    const avgBorder = Math.max(1, this.totalBorder() / Math.max(1, this.sides.length));
    this.attemptCost = 3.8 / Math.max(3, TUNE.rate * avgBorder * 1.2);
    const order = this.sides.map((_, k) => k);
    for (let k = order.length - 1; k > 0; k--) { const r = rng.int(k + 1); [order[k], order[r]] = [order[r], order[k]]; }
    const budgetScale = Math.min(1, 1200 / Math.max(1, this.totalBorder() * TUNE.rate * TICK * 2.5));
    for (const k of order) {
      const s = this.sides[k];
      if (s.eliminated || !s.border.length) continue;
      const phaseF = 0.55 + 1.1 * (s.attackShare || 0);
      const resF = s.resources < 10 ? 0.35 + s.resources * 0.065 : 1;
      const rate = TUNE.rate * this.cfg.pace * s.border.length * this.pressure(k) * s.rateFactor * phaseF * resF * this._mod(k, 'attempts') * warm * inten * budgetScale * (0.6 + 0.4 * s.readiness);
      s.attemptAcc += rate * TICK;
      const engaged = s.agents.filter((a) => a.engaged && a.transit < 0 && this.time >= a.bornAt);
      let guard = 0;
      while (s.attemptAcc >= 1 && guard++ < 400) {
        s.attemptAcc -= 1;
        if (!s.border.length) break;
        let j = -1, agent = null;
        const r = rng.next();
        if (engaged.length && r < 0.5) {
          agent = engaged[rng.int(engaged.length)];
          j = this._nearAgentTarget(k, agent);
        }
        if (j < 0) {
          agent = null;
          if (this.regional && this.time < this.regional.until && r > 0.6 && r < 0.72) {
            const b = s.border[rng.int(s.border.length)];
            if (this._inRegional(b)) j = this._enemyNeighbor(k, b);
          }
          if (j < 0) {
            // répartition par secteur selon les postures décidées par l'IA
            const sec = pickSector(this, s);
            let b = sec && sec.cells.length ? sec.cells[rng.int(sec.cells.length)] : -1;
            if (b < 0 || this.owner[b] !== s.e || this.borderPos[b] < 0) b = s.border[rng.int(s.border.length)];
            j = this._enemyNeighbor(k, b);
          }
        }
        if (j >= 0) this._attempt(k, j, agent);
      }
      if (s.attemptAcc > 50) s.attemptAcc = 50;
    }

    if (this.time >= this.nextEventAt && this.rules.randomEvents === false) this.nextEventAt = Infinity;
    if (this.time >= this.nextEventAt) {
      const choice = pickEvent(this, rng);
      if (choice) this.triggerEvent(choice.type.id, choice.side, false);
      this.nextEventAt = this.time + Math.max(3, rng.exp(this.eventInterval));
    }
    if (this.regional && this.time >= this.regional.until) this.regional = null;

    if (this.tickCount % 10 === 5) this._integrate();
    if (this.tickCount % 40 === 13) {
      const half = this.S > 40 ? 2 : 1, phase = Math.floor(this.tickCount / 40) % half;
      for (let k = 0; k < this.S; k++) if (!this.sides[k].eliminated) { this._rebuildSec(k); if (k % half === phase) this._deploy(k); }
      updateBattles(this);
    }
    if (this.tickCount % 20 === 0) {
      this._checkEliminations();
      this._record();
      checkWars(this);
      if (this._bordersDirty) this._refreshDirty();
      this._checkEnd();
    }
    if (this.tickCount % 200 === 100) { this._computeContact(); this._computeTrade(); if (this.nation) this.nation._refreshTrade(); }
    if (this.tickCount % (MONTH_SEC / TICK) === 0) this._snapshotSeries();
    if (this.tickCount % Math.round(YEAR_SEC / TICK) === 0) this._yearly();
    if (this.tickCount % (this.sides.length > 40 ? 100 : 40) === 0) this._computeIsolation();
  }

  _rebuildSec(k) { rebuildSectors(this, k); this._sectorShares(k); }

  _sectorShares(k) {
    const s = this.sides[k];
    let a = 0, t = 0;
    const cumF = new Float64Array(s.sectors.length);
    let cf = 0;
    s.sectors.forEach((sec, q) => { t += sec.w; if (s.front[sec.key] && s.front[sec.key].posture === 'attack') a += sec.w; cf += sec.fw; cumF[q] = cf; });
    s.attackShare = t ? a / t : 0;
    s.secCumF = cumF;
  }

  // bilan annuel : changements de puissance
  _yearly() {
    const ranked = this.sides.filter((s) => !s.eliminated).map((s) => ({ s, p: powerOf(s) })).sort((a, b) => b.p - a.p);
    if (ranked.length >= 3) {
      const top = ranked[0].s.index;
      if (this._topPower !== undefined && this._topPower !== top) this.chron('power', `${ranked[0].s.name} devient la première puissance militaire de la simulation.`, { e: [ranked[0].s.e] });
      this._topPower = top;
    }
    for (const { s, p } of ranked) {
      if (s._lastPower && p < s._lastPower * 0.55) this.chron('power', `Effondrement de la puissance militaire de ${s.name}.`, { e: [s.e] });
      if (s._lastPower && p > s._lastPower * 1.6 && p > 5) this.chron('power', `Montée en puissance de ${s.name}.`, { e: [s.e] });
      s._lastPower = p;
    }
    const R = this.rules;
    for (const s of this.sides) {
      if (s.eliminated) continue;
      // transformations nationales : le modèle économique suit le niveau technologique
      if (R.transformations !== false && R.economy !== false) {
        const p = s.p;
        p.production = clamp(p.production + ((38 + 0.45 * p.tech) - p.production) * 0.04, 1, 99);
        p.trade = clamp(p.trade + ((25 + 0.55 * p.tech + (p.infra.ports || 0) * 0.15) - p.trade) * 0.03, 1, 99);
        const before = p.derived && p.derived.economyType;
        p.population = s.pop;
        recomputeProfile(p);
        if (before && p.derived.economyType !== before && !s.player) this.chron('economy', `${s.name} change de modèle économique.`, { e: [s.e] });
        if (s.player && before && p.derived.economyType !== before && this.nation) this.nation.at(s.index).milestone('reform', 'Le modèle économique du pays évolue.');
      }
      // changements de gouvernement : crise prolongée, guerre perdue, ou alternance occasionnelle
      if (R.govChanges !== false && s.ai && !s.player) {
        const lost = s.ai.memory && s.ai.memory.some((m) => m.type === 'lostWar' && m.strength > 0.6);
        const chance = 0.015 + ((s.crisisMonths || 0) > 6 ? 0.25 : 0) + (lost ? 0.2 : 0) + (s.stability < 0.4 ? 0.1 : 0);
        if (this.rng.next() < chance) {
          const opts = lost || s.crisis ? ['economic', 'defensive', 'diplomatic', 'isolationist'] : ['economic', 'technological', 'diplomatic', 'defensive', 'opportunist', 'maritime'];
          const prev = s.ai.personality;
          const next = opts.filter((x) => x !== prev)[this.rng.int(opts.length - 1)];
          if (next && PERSONALITIES[next]) {
            s.ai.personality = next; s.p.personality = next;
            s.p.politics.stability = clamp(s.p.politics.stability + 4, 1, 99);
            const lab = PERSONALITIES[next].label.toLowerCase();
            this.chron('politics', `Changement de gouvernement en ${s.name} : nouvelle orientation ${lab}.`, { e: [s.e] });
            this.hist(s.index, 'politics', `Nouveau gouvernement (orientation ${lab}).`);
            aiLog(this, s.index, `Nouveau gouvernement : orientation ${lab}.`, 'neutral');
          }
        }
      }
    }
  }

  triggerEvent(id, s, manual = true) {
    const type = EVENTS_BY_ID[id];
    if (!type || s < 0 || !this.sides[s]) return null;
    const r = type.apply(this, s, this.rng);
    const obj = typeof r === 'string' ? { text: r } : r;
    const evt = { icon: type.icon, title: obj.title || type.title, tone: obj.tone || type.tone, side: type.global ? -1 : s, id, text: obj.text, manual };
    if (this.regional && id === 'regional') evt.cell = this.regional.cell;
    this._emit(evt);
    return evt;
  }

  _checkEliminations() {
    for (const s of this.sides) {
      if (!s.eliminated && s.cells === 0) {
        s.eliminated = true;
        s.defeated = true;
        s.eliminatedAt = this.time;
        this.transports = this.transports.filter((t) => t.side !== s.index);
        this.fleets = this.fleets.filter((t) => t.side !== s.index);
        s.agents.length = 0;
        s.border.length = 0;
        s.sectors = [];
        this._emit({ icon: '✖', title: 'PAYS ÉLIMINÉ', tone: 'bad', side: s.index, text: `${s.name} n'a plus aucun territoire dans cette simulation.` });
        this.chron('elimination', `Disparition de ${s.name} : plus aucun territoire.`, { e: [s.e] });
        this.hist(s.index, 'elimination', 'Disparition du pays.');
      }
    }
    this.teams.forEach((t, ti) => {
      const members = this.sides.filter((s) => s.team === ti);
      t.defeated = members.length > 0 && members.every((m) => m.eliminated);
    });
  }

  activeTeams() {
    const r = [];
    this.teams.forEach((t, ti) => { if (!t.defeated && this.sides.some((s) => s.team === ti && !s.eliminated)) r.push(ti); });
    return r;
  }

  teamStats() {
    return this.teams.map((t, ti) => {
      let cells = 0;
      for (const s of this.sides) if (s.team === ti) cells += s.cells;
      return { name: t.name, color: t.color, cells, initial: t.initial, ratio: t.initial ? cells / t.initial : 0, defeated: !!t.defeated };
    });
  }

  _checkEnd() {
    if (this.nation) {
      // mode Nation : la partie continue tant que le pays du joueur existe
      if (this.nation.humanList().every((k) => this.sides[k].eliminated)) return this._finish(this._bestTeam(), 'territoire');
      if (this.time >= this.cfg.maxDuration) return this._finish(this._bestTeam(), 'temps');
      return;
    }
    if (this.time >= this.cfg.maxDuration) return this._finish(this._bestTeam(), 'temps');
    if (this.activeSides().length <= 1 && this.sides.length > 1) return this._finish(this._bestTeam(), 'territoire');
    if (this.activeWars.length) { this.peaceSince = null; return; }
    if (!this.hadWar) return;
    if (this.peaceSince === null) this.peaceSince = this.time;
    if (this.time - this.peaceSince >= (this.cfg.peaceEnd || 45)) this._finish(this._bestTeam(), 'paix');
  }

  _bestTeam() {
    // vainqueur de la dernière guerre terminée par une victoire, sinon meilleure progression
    const ended = this.wars.filter((w) => w.status === 'ended' && w.winner);
    const ts = this.teamStats();
    if (ended.length === 1 && this.wars.length === 1) {
      const w = ended[0];
      const members = w.winner === 'a' ? w.a : w.b;
      const teams = new Set(members.map((k) => this.sides[k].team));
      if (teams.size === 1) return [...teams][0];
    }
    let best = -1, bv = -1, second = -1;
    ts.forEach((t, ti) => { if (t.ratio > bv) { second = bv; bv = t.ratio; best = ti; } else if (t.ratio > second) second = t.ratio; });
    return bv - second < 0.02 ? -1 : best;
  }

  _finish(winnerTeam, reason) {
    // armistice : les guerres encore en cours se terminent (traité, rapport)
    for (const w of this.activeWars.slice()) {
      if (w.status === 'active') endWar(this, w, null, reason === 'manuel' ? 'manual' : 'armistice');
      if (w.status === 'negotiating') concludeTreaty(this, w);
    }
    this._rebuildWarIndex();
    // carte finale lisible : plus aucun fragment minuscule
    this.tidy = globalTidy(this);
    this.finished = true;
    const total = this.totalCells();
    this.result = {
      winnerTeam, reason, time: this.time,
      teams: this.teamStats(),
      sides: this.sides.map((s) => ({
        e: s.e, name: s.name, team: s.team, cells: s.cells, initial: s.initial,
        share: total ? s.cells / total : 0, ratio: s.cells / s.initial,
        captured: s.captured, lost: s.lost, eliminated: s.eliminated, units: Math.round(s.units),
        occupied: s.occupiedCells,
      })),
      events: this.log.length,
      wars: this.wars.map((w) => ({ id: w.id, name: w.name, reason: w.endReason, winner: w.winner })),
    };
  }

  forceFinish() { if (!this.finished) this._finish(this._bestTeam(), 'manuel'); }

  // ---------------- édition en direct (mode Contrôle total) ----------------
  setOwner(i, e) {
    this.flip(i, e, false);
  }

  refreshAfterEdit() {
    for (const s of this.sides) {
      s.cells = 0; s.heldForeign = 0;
    }
    for (let i = 0; i < this.n; i++) {
      const s = this.sideOf[this.owner[i]];
      if (s >= 0) { this.sides[s].cells++; if (this.origin[i] !== this.owner[i]) this.sides[s].heldForeign++; }
    }
    for (const s of this.sides) {
      if (s.cells > 0 && s.eliminated) { s.eliminated = false; s.defeated = false; }
      if (s.capital < 0 || this.owner[s.capital] !== s.e) { const c = this._findCapital(s); if (c >= 0) s.capital = c; }
    }
    this._countOccupied();
    this._rebuildAllBorders();
    for (let k = 0; k < this.S; k++) this._rebuildSec(k);
    this._computeContact();
    this._computeIsolation();
  }

  // changement d'équipe en direct : rejoint les guerres de sa nouvelle équipe
  setTeam(s, team) {
    const sd = this.sides[s];
    sd.team = team;
    for (const w of this.activeWars) {
      if (w.status !== 'active') continue;
      const inA = w.a.some((k) => k !== s && this.sides[k].team === team), inB = w.b.some((k) => k !== s && this.sides[k].team === team);
      if (inA && !w.a.includes(s) && !w.b.includes(s)) joinWar(this, w, s, 'a');
      else if (inB && !w.a.includes(s) && !w.b.includes(s)) joinWar(this, w, s, 'b');
    }
    for (let o = 0; o < this.S; o++) if (o !== s && this.sides[o].team === team) { this.allied[s * this.S + o] = this.allied[o * this.S + s] = 1; addRel(this, s, o, 30); }
    this._bordersDirty = true;
  }

  // statistiques modifiées en direct (Contrôle total)
  applyEntity(s, ent) {
    const sd = this.sides[s];
    const prof = participantProfile(ent, { e: sd.e }, { coastShare: 0.3 });
    const land0 = landTotal(sd);
    sd.stats = { ...ent.stats };
    sd.p.tech = prof.tech; sd.p.equip = prof.equip; sd.p.politics = prof.politics; sd.p.personality = prof.personality;
    if (sd.ai) sd.ai.personality = prof.personality;
    const newLand = prof.army.inf + prof.army.arm + prof.army.art + prof.army.rec;
    if (Math.abs(newLand - sd.maxUnits) / Math.max(1, sd.maxUnits) > 0.02) {
      const k = newLand / Math.max(1, land0);
      for (const t of ['inf', 'arm', 'art', 'rec']) sd.army[t] *= k;
      sd.maxUnits = newLand;
      sd.milTarget = armyUpkeepSide(sd); sd.milBase = sd.milTarget;
    }
    sd.baseStability = 0.45 + ent.stats.stabilite / 200;
    sd.econBase = ent.stats.economie;
    sd.rateFactor = (0.7 + ent.stats.vitesse / 170) * (0.92 + ent.stats.mobilite / 600);
    sd.regen = 1.6 + ent.stats.ressources / 28;
    refreshCombat(sd);
  }

  // ---------------- résumé ----------------
  snapshot() {
    const total = this.totalCells();
    return this.sides.map((s, k) => ({
      index: k, e: s.e, name: s.name, team: s.team,
      share: total ? s.cells / total : 0,
      ratio: s.cells / s.initial,
      cells: s.cells, units: Math.round(s.units), maxUnits: s.maxUnits,
      occupied: s.occupiedCells, official: s.cells - s.occupiedCells,
      occupiedShare: s.cells ? s.occupiedCells / s.cells : 0,
      stability: s.stability, resources: s.resources, economy: s.economy || s.econBase,
      momentum: s.momentum, phase: s.phase,
      front: s.border.length, agents: s.agents.length,
      captured: s.captured, lost: s.lost,
      eliminated: s.eliminated, defeated: s.defeated,
      mods: s.mods.map((m) => m.label).filter(Boolean),
      power: s.stats.puissance,
      atWar: this.isAtWar(k),
    }));
  }

  // ---------------- sauvegarde complète ----------------
  serialize() {
    return {
      v: 4,
      time: this.time, tickCount: this.tickCount, rng: this.rng.state, id: this._id, warId: this._warId,
      owner: b64(this.owner), origin: b64(this.origin), occupied: b64(this.occupied),
      contest: b64(this.contest), lastFlip: b64(this.lastFlip),
      nextEventAt: this.nextEventAt,
      regional: this.regional,
      finished: this.finished, result: this.result,
      teams: this.teams,
      isolated: b64(this.isolated),
      rel: b64(this.rel), allied: b64(this.allied), truce: b64(this.truce), atWar: b64(this.atWar), trade: b64(this.trade),
      sides: this.sides.map((s) => {
        const { border, sectors, secCum, secCumF, labSig, labVer, labTick, ...rest } = s;
        const o = JSON.parse(JSON.stringify(rest));
        o.borderB64 = b64(Int32Array.from(border));
        o.sectorsSaved = (sectors || []).map((x) => ({ key: x.key, o: x.o, bin: x.bin, w: x.w, fw: x.fw, cells: b64(Int32Array.from(x.cells)) }));
        return o;
      }),
      wars: this.wars.map(serializeWar),
      battles: this.battles, chronicle: this.chronicle, endedWars: this.endedWars, hadWar: this.hadWar, peaceSince: this.peaceSince,
      transports: this.transports, strikes: this.strikes, fleets: this.fleets.map(({ _seg, _cum, ...f }) => f),
      occList: this.occList, occPass: this._occPass || 0, topPower: this._topPower,
      log: this.log.slice(-200),
      history: this.history,
      docked: this.docked,
      aiDeclares: this.aiDeclares || [],
      dmem: this.dmem || {},
      intentional: this.intentional ? [...this.intentional] : null,
      coalitions: serializeCoalitions(this),
      crises: serializeCrises(this),
      borderEdits: this.borderEdits || [],   // [parcelle, propriétaire voulu]
      warEnd: this.cfg.warEnd,               // réglages de fin des guerres (modifiables en partie)
      nation: this.nation ? this.nation.serialize() : null,
    };
  }

  _restore(st) {
    if (st.warEnd) this.cfg.warEnd = normalizeWarEnd(st.warEnd, !!this.cfg.nation);
    this.time = st.time; this.tickCount = st.tickCount; this.rng.state = st.rng >>> 0; this._id = st.id; this._warId = st.warId || 0;
    this.contest = unb64(st.contest, Float32Array);
    if (st.lastFlip) this.lastFlip = unb64(st.lastFlip, Float32Array);
    this.nextEventAt = st.nextEventAt;
    this.regional = st.regional;
    this.finished = st.finished; this.result = st.result;
    this.teams = st.teams;
    const S = this.S;
    const restoreMat = (key, Type, dst) => { if (st[key]) { const a = unb64(st[key], Type); if (a.length === dst.length) dst.set(a); } };
    restoreMat('rel', Float32Array, this.rel); restoreMat('allied', Uint8Array, this.allied); restoreMat('truce', Float32Array, this.truce);
    restoreMat('atWar', Uint8Array, this.atWar); restoreMat('trade', Uint8Array, this.trade);
    st.sides.forEach((saved, k) => {
      const s = this.sides[k];
      const { borderB64, sectorsSaved, ...rest } = saved;
      Object.assign(s, rest);
      s.border = borderB64 ? Array.from(unb64(borderB64, Int32Array)) : [];
      s.sectors = (sectorsSaved || []).map((x) => ({ key: x.key, o: x.o, bin: x.bin, w: x.w, fw: x.fw, cells: Array.from(unb64(x.cells, Int32Array)) }));
      let c = 0; s.secCum = new Float64Array(s.sectors.length); s.sectors.forEach((x, q) => { c += x.w; s.secCum[q] = c; }); s.secW = c;
      this._sectorShares(k);
      if (!s.ai) initAI(this, k);
    });
    this.wars = (st.wars || []).map(restoreWar);
    this._rebuildWarIndex();
    this.hadWar = !!st.hadWar;
    this.peaceSince = st.peaceSince !== undefined ? st.peaceSince : null;
    this.battles = st.battles || {};
    this.chronicle = st.chronicle || [];
    this.endedWars = st.endedWars || [];
    this.transports = st.transports || [];
    this.strikes = st.strikes || [];
    this.fleets = st.fleets || [];
    this.docked = st.docked || [];
    this.log = st.log || [];
    this.history = st.history || [];
    this._topPower = st.topPower;
    this.aiDeclares = st.aiDeclares || [];
    this.dmem = st.dmem || {};
    restoreCoalitions(this, st.coalitions);
    restoreCrises(this, st.crises);
    this.borderEdits = st.borderEdits || [];
    this.intentional = st.intentional ? new Map(st.intentional.map((x) => (Array.isArray(x) ? x : [x, this.owner[x]]))) : null;
    if (st.occList) { this.occList = st.occList.slice(); this._occPass = st.occPass || 0; this._occStamp = new Int32Array(this.n); }
    for (const s of this.sides) { s.cells = 0; s.km2 = 0; }
    for (let i = 0; i < this.n; i++) { const s = this.sideOf[this.owner[i]]; if (s >= 0) { this.sides[s].cells++; this.sides[s].km2 += this.geo.km2[i]; } }
    this._countOccupied();
    this.borderPos.fill(-1);
    const hasBorders = st.sides.every((x) => x.borderB64 !== undefined);
    if (hasBorders) this.sides.forEach((s) => s.border.forEach((i, p) => { this.borderPos[i] = p; }));
    else this._rebuildAllBorders();
    if (st.isolated) this.isolated = unb64(st.isolated, Uint8Array);
    else this._computeIsolation();
    void S;
  }
}
