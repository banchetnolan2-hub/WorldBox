// WORLD — état d'un monde (persistant entre les simulations)
// Un monde = le propriétaire de chaque parcelle de la grille (la vraie géométrie des territoires,
// pas des pourcentages) + la liste des pays (y compris pays personnalisés) + équipes + historique.

import { encodeTerrain, decodeTerrain, toB64, fromB64 } from './terrain.js';
import { archiveWar } from '../sim/wars.js';
import { DAYS_PER_SEC } from '../sim/calendar.js';
import { statsFromProfile, recomputeProfile, realStatsOf } from '../sim/profile.js';

export const NONE = 65535;

export function buildEntities(grid, countriesData) {
  const byId = new Map(countriesData.countries.map((c) => [c.id, c]));
  // zones neutres promues en pays jouables (même index : les anciennes sauvegardes gardent leur correspondance)
  const promoted = new Map((countriesData.promoted || []).map((c) => [c.mapName, c]));
  return grid.territories.map((t, k) => {
    if (t.kind !== 'country' && promoted.has(t.name)) {
      const c = promoted.get(t.name);
      return {
        index: k, id: c.id, kind: 'country', promoted: true, name: c.name, iso2: c.iso2, continent: c.continent, flagSpec: c.flagSpec,
        color: c.color, color2: c.color2, capital: { ...c.capital }, population: c.population, stats: { ...c.stats }, alive: true,
      };
    }
    if (t.kind === 'country') {
      const c = byId.get(t.id);
      return {
        index: k, id: c.id, kind: 'country', name: c.name, iso2: c.iso2, continent: c.continent,
        color: c.color, color2: c.color2, capital: { ...c.capital }, population: (realStatsOf({ id: c.id, kind: 'country' }) || {}).population || c.population,
        stats: { ...c.stats }, alive: true,
      };
    }
    return { index: k, id: t.id, kind: 'neutral', name: t.name, color: '#6b7280', continent: null, capital: null, population: 0, stats: null, alive: true };
  });
}

export function createOriginalWorld(grid, countriesData) {
  const entities = buildEntities(grid, countriesData);
  return {
    id: 'original',
    name: 'Monde original',
    year: 1,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    owner: Uint16Array.from(grid.origin),
    entities,
    teams: [],
    relations: {},
    history: [{ year: 1, title: 'Monde original', text: 'Frontières de départ (204 pays et territoires).', date: new Date().toISOString() }],
    chronicle: emptyChronicle(),
    dateDays: 0,
    readonly: true,
  };
}

export function emptyChronicle() { return { events: [], wars: [], countries: {} }; }

export function cloneWorld(w, overrides = {}) {
  return {
    ...w,
    chronicle: JSON.parse(JSON.stringify(w.chronicle || emptyChronicle())),
    biomes: w.biomes ? Uint8Array.from(w.biomes) : null,
    owner: Uint16Array.from(w.owner),
    entities: w.entities.map((e) => ({ ...e, stats: e.stats ? { ...e.stats } : null, capital: e.capital ? { ...e.capital } : null, flag: e.flag ? JSON.parse(JSON.stringify(e.flag)) : undefined, profile: e.profile ? JSON.parse(JSON.stringify(e.profile)) : undefined })),
    teams: JSON.parse(JSON.stringify(w.teams || [])),
    relations: JSON.parse(JSON.stringify(w.relations || {})),
    history: [...(w.history || [])],
    readonly: false,
    ...overrides,
  };
}

// ----- encodage compact des frontières (RLE) -----
export function encodeOwner(owner) {
  const runs = [];
  let cur = owner[0], len = 0;
  for (let i = 0; i < owner.length; i++) {
    if (owner[i] === cur && len < 65535) len++;
    else { runs.push(cur, len); cur = owner[i]; len = 1; }
  }
  runs.push(cur, len);
  const u16 = Uint16Array.from(runs);
  const u8 = new Uint8Array(u16.buffer);
  let s = '';
  for (let k = 0; k < u8.length; k += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(k, k + 0x8000));
  return typeof btoa !== 'undefined' ? btoa(s) : Buffer.from(u8).toString('base64');
}

export function decodeOwner(str, n) {
  let u8;
  if (typeof atob !== 'undefined') {
    const s = atob(str);
    u8 = new Uint8Array(s.length);
    for (let k = 0; k < s.length; k++) u8[k] = s.charCodeAt(k);
  } else u8 = new Uint8Array(Buffer.from(str, 'base64'));
  const runs = new Uint16Array(u8.buffer, 0, u8.byteLength >> 1);
  const owner = new Uint16Array(n);
  let p = 0;
  for (let k = 0; k < runs.length; k += 2) {
    owner.fill(runs[k], p, Math.min(n, p + runs[k + 1]));
    p += runs[k + 1];
  }
  return owner;
}

// Sauvegarde d'un monde (.simworld) : géométrie exacte (terrain + propriétaire de chaque parcelle),
// pays (capitales, couleurs, statistiques, unités), équipes, relations, historique, paramètres.
export async function serializeWorld(w) {
  return {
    format: 'world-simulator-monde',
    version: 2,
    id: w.id, name: w.name, year: w.year,
    createdAt: w.createdAt, updatedAt: new Date().toISOString(),
    cells: w.owner.length,
    owner: encodeOwner(w.owner),
    terrain: w.terrain ? await encodeTerrain(w.terrain) : null,
    entities: w.entities,
    teams: w.teams || [],
    relations: w.relations || {},
    history: w.history || [],
    simSettings: w.simSettings || null,
    chronicle: w.chronicle || emptyChronicle(),
    dateDays: w.dateDays || 0,
    biomes: w.biomes ? toB64(rleBytes(w.biomes)) : null,
  };
}

// RLE simple (valeur, longueur ≤ 255) pour les biomes peints
function rleBytes(u8) {
  const out = [];
  let cur = u8[0], len = 0;
  for (let i = 0; i < u8.length; i++) {
    if (u8[i] === cur && len < 255) len++;
    else { out.push(cur, len); cur = u8[i]; len = 1; }
  }
  out.push(cur, len);
  return Uint8Array.from(out);
}
function unrle(bytes, n) {
  const u8 = new Uint8Array(n);
  let p = 0;
  for (let k = 0; k < bytes.length; k += 2) { u8.fill(bytes[k], p, Math.min(n, p + bytes[k + 1])); p += bytes[k + 1]; }
  return u8;
}

// ctx : { earthGrid, contextFor(world) } fourni par l'application (grille de la Terre ou grille dérivée du terrain)
export async function deserializeWorld(data, ctx, countriesData) {
  if (!data || data.format !== 'world-simulator-monde') throw new Error('Fichier de monde invalide');
  const common = {
    id: data.id, name: data.name, year: data.year || 1,
    createdAt: data.createdAt, updatedAt: data.updatedAt,
    teams: data.teams || [], relations: data.relations || {}, history: data.history || [],
    simSettings: data.simSettings || null, readonly: false,
    chronicle: data.chronicle || emptyChronicle(), dateDays: data.dateDays || 0,
    biomes: data.biomes ? unrle(fromB64(data.biomes), 1440 * 720) : null,
  };
  if (data.terrain) {
    const terrain = await decodeTerrain(data.terrain);
    const w = { ...common, terrain, entities: data.entities.map((e, k) => ({ ...e, index: k })) };
    const { grid } = ctx.contextFor(w);
    if (data.cells !== grid.n) throw new Error('Géométrie du monde incohérente');
    w.owner = decodeOwner(data.owner, grid.n);
    return w;
  }
  const grid = ctx.earthGrid;
  if (data.cells !== grid.n) throw new Error('Ce monde a été créé avec une autre grille');
  const base = buildEntities(grid, countriesData);
  let owner = decodeOwner(data.owner, grid.n);
  // migration : la liste des pays a pu changer (ex. Groenland devenu un pays) -> correspondance par identifiant / nom
  const same = data.entities.every((e, k) => k >= base.length || e.kind === 'custom' || (base[k] && base[k].id === e.id));
  let entities;
  if (same) entities = data.entities.map((e, k) => ({ ...(base[k] || {}), ...e, index: k, kind: base[k] ? base[k].kind : e.kind }));
  else {
    const byId = new Map(base.map((e, k) => [e.id, k]));
    const byName = new Map(base.map((e, k) => [e.name, k]));
    const map = new Map();
    entities = base.map((e) => ({ ...e }));
    for (const [k, e] of data.entities.entries()) {
      if (e.kind === 'custom') { const ni = entities.length; entities.push({ ...e, index: ni }); map.set(k, ni); continue; }
      let ni = byId.has(e.id) && base[byId.get(e.id)].kind === e.kind ? byId.get(e.id) : byName.get(e.name);
      if (ni === undefined) continue;
      map.set(k, ni);
      if (base[ni].kind === e.kind) entities[ni] = { ...base[ni], ...e, index: ni, id: base[ni].id, kind: base[ni].kind };
    }
    const remap = (v) => (v === NONE ? NONE : map.has(v) ? map.get(v) : NONE);
    owner = owner.map(remap);
    common.teams = common.teams.map((t) => ({ ...t, members: (t.members || []).map(remap).filter((m) => m !== NONE) }));
    const rel = {};
    for (const [key, v] of Object.entries(common.relations)) {
      const [a, b] = key.split('>').map(Number);
      if (map.has(a) && map.has(b)) rel[`${map.get(a)}>${map.get(b)}`] = v;
    }
    common.relations = rel;
  }
  return { ...common, owner, entities };
}

// Nombre de parcelles par entité
export function countCells(w) {
  const counts = new Uint32Array(w.entities.length + 1);
  for (let i = 0; i < w.owner.length; i++) if (w.owner[i] !== NONE && w.owner[i] < counts.length) counts[w.owner[i]]++;
  return counts;
}

// Intègre le résultat d'une simulation dans le monde (nouvelle génération)
export function applySimulationToWorld(w, sim, setupSummary) {
  const before = countCells(w);
  recordChronicle(w, sim);
  w.owner = Uint16Array.from(sim.owner);
  const after = countCells(w);
  w.year = (w.year || 1) + 1;
  w.updatedAt = new Date().toISOString();
  // statistiques et population évoluent avec le territoire
  for (const s of sim.sides) {
    const e = w.entities[s.e];
    if (!e || !e.stats) continue;
    const ratio = before[s.e] ? after[s.e] / before[s.e] : 1;
    if (!s.p) e.population = Math.round(e.population * Math.max(0.2, Math.min(3, 0.5 + 0.5 * ratio)));
    e.stats.stabilite = Math.round(Math.max(5, Math.min(98, e.stats.stabilite + (ratio - 1) * 10)));
    e.stats.ressources = Math.round(Math.max(5, Math.min(98, e.stats.ressources + (ratio - 1) * 8)));
    e.alive = after[s.e] > 0;
    // le profil évolue : population, finances, armée, technologie, infrastructures, stabilité
    if (s.p) {
      const p = JSON.parse(JSON.stringify(s.p));
      delete p.derived;
      p.population = Math.max(1000, Math.round(s.pop));
      p.money = Math.round(s.money * 10) / 10; p.debt = Math.round(s.debt * 10) / 10;
      const land = s.army.inf + s.army.arm + s.army.art + s.army.rec;
      const k = land > 0 ? 1 / 0.85 : 1;
      p.army = { inf: s.army.inf * k, arm: s.army.arm * k, art: s.army.art * k, rec: s.army.rec * k, air: s.air, navy: s.navy };
      for (const key of Object.keys(p.army)) p.army[key] = Math.round(p.army[key] * 10) / 10;
      p.politics.stability = Math.round(Math.max(5, Math.min(98, s.stability * 200 - 90)));
      p.tech = Math.round(p.tech * 10) / 10;
      p.personality = s.ai ? s.ai.personality : p.personality;
      recomputeProfile(p);
      delete p.derived;
      e.profile = p;
      e.population = p.population;
    }
    // relations : qui a pris du territoire à qui
    for (const [from, n] of Object.entries(s.gainsFrom)) {
      const key = `${s.e}>${from}`;
      w.relations[key] = (w.relations[key] || 0) + n;
    }
  }
  w.teams = JSON.parse(JSON.stringify(sim.teams.map((t) => ({ name: t.name, color: t.color }))));
  // historique lisible
  const changes = sim.sides
    .map((s) => ({ name: s.name, e: s.e, delta: after[s.e] - before[s.e], ratio: before[s.e] ? after[s.e] / before[s.e] : 0 }))
    .filter((c) => c.delta !== 0)
    .sort((a, b) => b.delta - a.delta);
  const winners = changes.filter((c) => c.delta > 0).slice(0, 3).map((c) => `${c.name} +${Math.round((c.ratio - 1) * 100)} %`);
  const losers = changes.filter((c) => c.delta < 0).slice(-3).map((c) => `${c.name} ${Math.round((c.ratio - 1) * 100)} %`);
  const gone = sim.sides.filter((s) => after[s.e] === 0).map((s) => s.name);
  let text = setupSummary ? setupSummary + '. ' : '';
  if (winners.length) text += `Gains : ${winners.join(', ')}. `;
  if (losers.length) text += `Pertes : ${losers.join(', ')}. `;
  if (gone.length) text += `Disparus : ${gone.join(', ')}.`;
  w.history.push({
    year: w.year,
    title: sim.result && sim.result.winnerTeam >= 0 ? `Victoire : ${sim.teams[sim.result.winnerTeam].name}` : 'Simulation sans vainqueur net',
    text: text.trim() || 'Aucun changement de frontière.',
    date: new Date().toISOString(),
    changes: changes.slice(0, 40),
  });
  return w;
}

// histoire : événements du monde (dates absolues en jours), rapports de guerre, histoire de chaque pays
export function recordChronicle(w, sim) {
  if (!w.chronicle) w.chronicle = emptyChronicle();
  const c = w.chronicle;
  const d0 = w.dateDays || 0;
  const day = (t) => Math.round(d0 + t * DAYS_PER_SEC);
  const ents = (list) => (list || []).filter((e) => e !== undefined);
  for (const ev of sim.chronicle) c.events.push({ day: day(ev.t), type: ev.type, text: ev.text, e: ents(ev.e), war: ev.war ? `${d0}:${ev.war}` : undefined, cell: ev.cell });
  for (const wr of sim.wars) if (wr.status === 'ended') { const a = archiveWar(sim, wr, d0); a.uid = `${d0}:${wr.id}`; c.wars.push(a); }
  for (const s of sim.sides) {
    const key = String(s.e);
    const h = c.countries[key] || (c.countries[key] = { entries: [], series: [] });
    for (const x of s.hist) h.entries.push({ day: day(x.t), type: x.type, text: x.text });
    for (const r of s.series) h.series.push([day(r[0]), ...r.slice(1)]);
    if (h.entries.length > 400) h.entries.splice(0, h.entries.length - 400);
    if (h.series.length > 600) h.series = h.series.filter((_, k) => k % 2 === 0);
  }
  if (c.events.length > 4000) c.events.splice(0, c.events.length - 4000);
  if (c.wars.length > 300) c.wars.splice(0, c.wars.length - 300);
  w.dateDays = day(sim.time);
  void statsFromProfile;
}
