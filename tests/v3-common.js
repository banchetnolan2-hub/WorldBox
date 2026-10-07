// Outils communs aux tests du Mode Nation ajoutés dans cette version (monde réel, partie Nation, exécution).
const path = require('path'); const fs = require('fs'); const zlib = require('zlib');
let cache = null;
function load() {
  if (cache) return cache;
  require('esbuild').buildSync({ entryPoints: [path.join(__dirname, 'v3-entry.mjs')], bundle: true, platform: 'node', format: 'cjs', outfile: path.join(__dirname, '.v3-bundle.cjs'), logLevel: 'error', loader: { '.json': 'json' } });
  const m = require('./.v3-bundle.cjs');
  const grid = m.parseWorldGrid(new Uint8Array(zlib.inflateSync(fs.readFileSync(path.join(__dirname, '..', 'src/data/world-grid.bin')))));
  const relief = new m.Relief(new Uint8Array(zlib.inflateSync(fs.readFileSync(path.join(__dirname, '..', 'src/data/world-relief.bin')))));
  const geo = m.computeGeo(grid, relief);
  const data = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'src/data/countries.json'), 'utf8'));
  const nav = new m.Navigator(grid);
  const world = m.createOriginalWorld(grid, data);
  const cells = new Map(); for (let i = 0; i < grid.n; i++) cells.set(world.owner[i], (cells.get(world.owner[i]) || 0) + 1);
  const ents = world.entities.filter((e) => e.kind !== 'neutral' && cells.get(e.index) > 0);
  const details = m.buildDetails(grid, world.owner, world.entities);
  cache = { m, grid, geo, data, nav, world, ents, details };
  return cache;
}
let fails = 0, passes = 0;
const ok = (c, label) => { console.log((c ? 'OK   ' : 'ÉCHEC') + ' ' + label); if (c) passes++; else { fails++; process.exitCode = 1; } };
function setupFor(player, opts = {}) {
  const { ents } = load();
  return {
    participants: ents.map((e, k) => ({ e: e.index, team: k })), teams: ents.map((e) => ({ name: e.name, color: e.color })),
    options: { seed: opts.seed || 'NATION', warStart: 'tensions', maxDuration: 1e9, peaceEnd: 1e9, maxWarsPerYear: 2, maxAgents: 1100, startDay: 365, rules: opts.rules || undefined, nation: { player: ents.findIndex((e) => e.id === player), scenario: opts.scenario || null }, ...(opts.options || {}) },
  };
}
function mk(player, opts = {}, restore = null) { const { m, grid, nav, world, geo, details } = load(); return new m.WorldSim(grid, nav, world, setupFor(player, opts), restore, { geo, details: opts.noDetails ? null : details }); }
function run(sim, t) { while (!sim.finished && sim.time < t) { sim.step(); sim.captures.length = 0; sim.eventsOut.length = 0; } return sim; }
function side(sim, name) { return sim.sides.findIndex((s) => s.name === name); }
function summary(label) { console.log(`\n${label} : ${passes} réussi(s), ${fails} échec(s)`); }
module.exports = { load, ok, mk, run, side, setupFor, summary };
