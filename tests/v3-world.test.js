// Tests CREATE WORLD : terrain, grille dérivée, simulation sur un monde créé, sauvegarde exacte (.simworld),
// migration des anciens mondes (Groenland devenu un pays).
const path = require('path'); const fs = require('fs'); const zlib = require('zlib');
require('esbuild').buildSync({ entryPoints: [path.join(__dirname, 'v3-entry.mjs')], bundle: true, platform: 'node', format: 'cjs', outfile: path.join(__dirname, '.v3-bundle.cjs'), logLevel: 'error' });
const m = require('./.v3-bundle.cjs');
const ok = (c, label) => { console.log((c ? 'OK   ' : 'ÉCHEC') + ' ' + label); if (!c) process.exitCode = 1; };

(async () => {
  // 1. terrain aléatoire -> grille de simulation
  const t0 = Date.now();
  const terrain = m.Terrain.random(42);
  const { grid } = m.buildGridFromTerrain(terrain, null);
  const landPct = grid.nGrid / (1440 * 720);
  ok(landPct > 0.12 && landPct < 0.6, `terrain aléatoire : ${(landPct * 100).toFixed(1)} % de terres, ${grid.compSize.length} masses, ${Date.now() - t0} ms`);

  // 2. deux pays créés sur deux grandes masses, simulation complète
  const comps = [...grid.compSize.entries()].sort((a, b) => b[1] - a[1]);
  const owner = new Uint16Array(grid.n).fill(65535);
  const ents = [];
  [comps[0][0], comps[1] ? comps[1][0] : comps[0][0]].forEach((c, k) => {
    let first = -1;
    for (let i = 0; i < grid.n; i++) if (grid.comp[i] === c && (k === 0 || owner[i] === 65535)) { if (k === 1 && comps[1] === undefined && i % 2) continue; owner[i] = k; if (first < 0) first = i; }
    ents.push({ index: k, id: 'C' + k, kind: 'custom', name: k ? 'Orion' : 'Nova', color: k ? '#e98f3c' : '#6b5fd0', capital: { name: 'Cap' + k, lat: grid.lat[first], lon: grid.lon[first] }, population: 50e6, stats: { puissance: 60, economie: 55, ressources: 55, stabilite: 60, mobilite: 55, defense: 55, expansion: 50, vitesse: 55 }, alive: true });
  });
  const nav = new m.Navigator(grid);
  const world = { owner, entities: ents };
  const sim = new m.WorldSim(grid, nav, world, { participants: [{ e: 0, team: 0 }, { e: 1, team: 1 }], teams: [{ name: 'A', color: '#fff' }, { name: 'B', color: '#fff' }], options: { seed: 'CW', maxDuration: 240 } });
  let steps = 0, ships = 0;
  while (!sim.finished && steps < 6000) { sim.step(); sim.captures.length = 0; sim.eventsOut.length = 0; steps++; if (sim.transports.some((t) => t.kind === 'ship')) ships++; }
  ok(sim.finished, `simulation sur un monde créé : ${sim.sides.map((s) => s.name + ' ' + s.cells).join(' / ')}, transports maritimes actifs ${ships} pas`);

  // 3. sauvegarde exacte de la géométrie
  const enc = await m.encodeTerrain(terrain);
  const dec = await m.decodeTerrain(enc);
  let maxErr = 0;
  for (let k = 0; k < terrain.elev.length; k++) maxErr = Math.max(maxErr, Math.abs(dec.elev[k] - terrain.elev[k]));
  ok(maxErr <= 0.0021, `terrain encodé ${(enc.data.length / 1024).toFixed(0)} Ko, écart max ${(maxErr * 1000).toFixed(1)} m`);
  const g2 = m.buildGridFromTerrain(dec, null).grid;
  ok(g2.n === grid.n && g2.indexAt.every((v, i) => v === grid.indexAt[i]), 'grille identique après rechargement (même île, même forme)');

  // 4. monde complet : sérialisation / désérialisation
  const w = { id: 'w:Test', name: 'Test', year: 3, terrain, owner: sim.owner, entities: ents, teams: [], relations: {}, history: [] };
  const data = JSON.parse(JSON.stringify(await m.serializeWorld(w)));
  const ctx = { earthGrid: null, contextFor: (x) => ({ grid: m.buildGridFromTerrain(x.terrain, null).grid }) };
  const back = await m.deserializeWorld(data, ctx, null);
  ok(back.owner.every((v, i) => v === sim.owner[i]) && back.entities[1].capital.name === 'Cap1' && back.year === 3, `monde .simworld : ${(JSON.stringify(data).length / 1024).toFixed(0)} Ko, frontières, pays et capitales identiques`);

  // 5. migration d'un ancien monde (Groenland neutre -> pays)
  const raw = zlib.inflateSync(fs.readFileSync(path.join(__dirname, '..', 'src', 'data', 'world-grid.bin')));
  const eg = m.parseWorldGrid(new Uint8Array(raw));
  const cd = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'src', 'data', 'countries.json'), 'utf8'));
  const orig = m.createOriginalWorld(eg, cd);
  const gl = orig.entities.findIndex((e) => e.id === 'GL');
  ok(gl >= 0 && orig.entities[gl].kind === 'country' && [...orig.owner].filter((v) => v === gl).length > 1000, `Groenland : pays jouable (${[...orig.owner].filter((v) => v === gl).length} parcelles, capitale ${orig.entities[gl].capital.name})`);
  // ancien format : Groenland neutre en fin de liste
  const oldEnts = orig.entities.filter((e) => e.id !== 'GL').map((e, k) => ({ ...e, index: k }));
  oldEnts.push({ ...orig.entities[gl], index: oldEnts.length, kind: 'neutral', id: 'N999' });
  const map = new Map(orig.entities.map((e, k) => [k, oldEnts.findIndex((o) => o.name === e.name)]));
  const oldOwner = orig.owner.map((v) => (v === 65535 ? v : map.get(v)));
  const oldData = { format: 'world-simulator-monde', version: 1, id: 'monde-x', name: 'Ancien', year: 2, cells: eg.n, owner: m.encodeOwner(oldOwner), entities: oldEnts, teams: [], relations: {}, history: [] };
  const mig = await m.deserializeWorld(oldData, { earthGrid: eg }, cd);
  ok(mig.owner.every((v, i) => v === orig.owner[i]), 'ancien monde migré : frontières identiques, Groenland indépendant');
  // pays et territoires ajoutés : Kosovo, Taïwan, Sahara occidental, Chypre du Nord, Nouvelle-Calédonie, Porto Rico,
  // Hong Kong, Somaliland — jouables, à l'index de l'ancienne zone neutre (sauvegardes compatibles)
  const ids = ['XK', 'TW', 'EH', 'XC', 'NC', 'PR', 'HK', 'XS'];
  const counts = new Map(); for (const v of orig.owner) counts.set(v, (counts.get(v) || 0) + 1);
  const added = ids.map((id) => orig.entities.find((e) => e.id === id));
  ok(added.every((e) => e && e.kind === 'country' && e.capital && (counts.get(e.index) || 0) > 0), `pays ajoutés : ${added.map((e) => `${e.name} (${counts.get(e.index)} parcelle(s))`).join(', ')}`);
  const cdOld = { ...cd, promoted: [] };
  const before = m.createOriginalWorld(eg, cdOld);
  ok(added.every((e) => before.entities[e.index].kind === 'neutral' && before.entities[e.index].name === e.name), 'même index que l\'ancienne zone neutre');
  const oldW = { format: 'world-simulator-monde', version: 1, id: 'monde-y', name: 'Avant', year: 3, cells: eg.n, owner: m.encodeOwner(before.owner), entities: before.entities, teams: [], relations: {}, history: [] };
  const mig2 = await m.deserializeWorld(oldW, { earthGrid: eg }, cd);
  ok(mig2.owner.every((v, i) => v === before.owner[i]) && added.every((e) => mig2.entities[e.index].kind === 'country'), 'monde enregistré avant l\'ajout : frontières identiques, territoires désormais jouables');
})();
