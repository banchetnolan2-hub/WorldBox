// Tests des DÉPLACEMENTS MILITAIRES et du TRANSPORT MARITIME : jamais à pied sur la mer, jamais à travers
// un pays neutre, bateau seulement quand aucune route terrestre praticable n'existe (île, exclave, territoire
// séparé par un pays neutre), embarquement -> traversée -> débarquement visibles.
const path = require('path'); const fs = require('fs'); const zlib = require('zlib');
require('esbuild').buildSync({ entryPoints: [path.join(__dirname, 'v3-entry.mjs')], bundle: true, platform: 'node', format: 'cjs', outfile: path.join(__dirname, '.v3-bundle.cjs'), logLevel: 'error', loader: { '.json': 'json' } });
const m = require('./.v3-bundle.cjs');
const ok = (c, label) => { console.log((c ? 'OK   ' : 'ÉCHEC') + ' ' + label); if (!c) process.exitCode = 1; };
const grid = m.parseWorldGrid(new Uint8Array(zlib.inflateSync(fs.readFileSync(path.join(__dirname, '..', 'src/data/world-grid.bin')))));
const relief = new m.Relief(new Uint8Array(zlib.inflateSync(fs.readFileSync(path.join(__dirname, '..', 'src/data/world-relief.bin')))));
const geo = m.computeGeo(grid, relief);
const data = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'src/data/countries.json'), 'utf8'));
const nav = new m.Navigator(grid);
const world = m.createOriginalWorld(grid, data);
const idx = (id) => world.entities.findIndex((e) => e.id === id);
const details = m.buildDetails(grid, world.owner, world.entities);
const setup = (ids, opts = {}) => ({ participants: ids.map((id, k) => ({ e: idx(id), team: k })), teams: ids.map((n) => ({ name: n, color: '#fff' })), options: { seed: 'NAV', maxDuration: 1e9, ...opts } });
const cellAt = (x, y, z) => { const la = Math.asin(y) * 180 / Math.PI, lo = Math.atan2(x, z) * 180 / Math.PI; const X = Math.floor((lo + 180) / grid.RES) % grid.W, Y = Math.floor((90 - la) / grid.RES); return Y >= 0 && Y < grid.H ? grid.indexAt[Y * grid.W + X] : -1; };
function run(ids, T, opts = {}) {
  const sim = new m.WorldSim(grid, nav, world, setup(ids, opts), null, { geo, details });
  const r = { walk: 0, water: 0, neutral: 0, orders: 0, landings: 0, ships: 0, landedFriendly: 0, phases: new Set(), viaNeutralLand: 0 };
  const seen = new Set();
  while (sim.time < T && !sim.finished) {
    sim.step(); sim.captures.length = 0; sim.eventsOut.length = 0;
    if (sim.tickCount % 5) continue;
    for (const tr of sim.transports) if (tr.kind === 'ship' && tr.troops) r.ships++;
    for (const sd of sim.sides) for (const a of sd.agents) {
      if (a.sea) { r.phases.add(a.sea.phase); if (!seen.has(a.sea)) { seen.add(a.sea); r.orders++; if (a.sea.landing) r.landings++; } }
      if (a.transit >= 0 || sim.time < a.bornAt) continue;
      if (Math.hypot(a.x - a.px, a.y - a.py, a.z - a.pz) < 1e-7) continue;
      r.walk++;
      const c = cellAt(a.x, a.y, a.z);
      if (c < 0) { r.water++; continue; }
      const o = sim.sideOf[sim.owner[c]];
      if (o < 0) r.neutral++;                       // pays tiers neutre (hors de la partie)
    }
  }
  r.sim = sim;
  return r;
}
const pct = (a, b) => (100 * a / Math.max(1, b)).toFixed(1) + ' %';

// 1. États-Unis / Russie : Alaska et Extrême-Orient desservis par la mer, jamais à pied à travers le Canada ou la mer
{
  const r = run(['US', 'RU'], 160);
  ok(r.walk > 500 && r.water / r.walk < 0.02, `États-Unis / Russie : ${pct(r.water, r.walk)} des déplacements à pied sur la mer (${r.walk} relevés)`);
  ok(r.neutral / r.walk < 0.02, `États-Unis / Russie : ${pct(r.neutral, r.walk)} des déplacements à travers un pays neutre`);
  ok(r.landings > 0 && r.ships > 0, `débarquements outre-mer : ${r.landings} débarquement(s), navires de transport visibles (${r.ships} relevés)`);
}
// 2. Russie / Lituanie : Kaliningrad n'est pas atteint à travers la Biélorussie neutre mais par la Baltique
{
  const r = run(['RU', 'LT'], 160);
  ok(r.neutral / Math.max(1, r.walk) < 0.03, `Russie / Lituanie : ${pct(r.neutral, r.walk)} des déplacements à travers un pays neutre`);
  const sim = new m.WorldSim(grid, nav, world, setup(['RU', 'LT']), null, { geo, details }), ru = sim.sides[0];
  const kal = (() => { for (let c = 0; c < grid.n; c++) if (sim.owner[c] === ru.e && grid.lon[c] > 19.5 && grid.lon[c] < 22.9 && grid.lat[c] > 54.3 && grid.lat[c] < 55.3) return c; return -1; })();
  ok(kal >= 0 && sim._lab(ru, kal) !== sim._lab(ru, ru.capital) && !sim._landPath(ru, kal, ru.capital), 'Kaliningrad et Moscou : deux zones terrestres distinctes (aucune route praticable sans traverser la Biélorussie neutre)');
  ok(r.orders > 0, `Russie : ${r.orders} transport(s) maritime(s) commandé(s) vers l'exclave`);
}
// 3. France / Belgique : aucune traversée maritime quand une route terrestre existe
{
  const r = run(['FR', 'BE'], 120);
  ok(r.orders === 0, `France / Belgique : ${r.orders} embarquement(s) (route terrestre directe)`);
}
// 4. Royaume-Uni / France : embarquement au port, traversée, débarquement
{
  const r = run(['GB', 'FR'], 200);
  ok(r.orders > 0 && r.landings > 0, `Royaume-Uni / France : ${r.orders} embarquement(s), ${r.landings} débarquement(s)`);
  ok(['toPort', 'port', 'sea'].every((p) => r.phases.has(p)), `phases observées : ${[...r.phases].join(' -> ')}`);
  ok(r.water / Math.max(1, r.walk) < 0.02, `Royaume-Uni / France : ${pct(r.water, r.walk)} des déplacements à pied sur la mer`);
}
// 5. itinéraire terrestre : contourne la mer (Texas -> Floride par la côte, pas à travers le golfe du Mexique)
{
  const sim = new m.WorldSim(grid, nav, world, setup(['US', 'MX']), null, { geo, details });
  const us = sim.sides[0];
  const near = (la, lo) => { let b = -1, bd = 1e9; for (let c = 0; c < grid.n; c++) { if (sim.owner[c] !== us.e) continue; const d = Math.hypot(grid.lat[c] - la, grid.lon[c] - lo); if (d < bd) { bd = d; b = c; } } return b; };
  const a = near(29.4, -95), b = near(28, -81.7);
  const p = sim._landPath(us, a, b);
  ok(p && p.length > 20 && p.every((c) => sim.owner[c] === us.e), `itinéraire Houston -> Floride : ${p ? p.length : 0} parcelles, toutes sur le sol américain`);
}
// 6. sauvegarde : itinéraires et ordres maritimes repris à l'identique
{
  const s1 = new m.WorldSim(grid, nav, world, setup(['GB', 'FR', 'NL']), null, { geo, details });
  for (let k = 0; k < 700; k++) s1.step();
  const snap = JSON.parse(JSON.stringify(s1.serialize()));
  const s2 = new m.WorldSim(grid, nav, world, setup(['GB', 'FR', 'NL']), snap, { geo, details });
  for (let k = 0; k < 700; k++) { s1.step(); s2.step(); }
  ok(s1.owner.every((v, i) => v === s2.owner[i]), 'sauvegarde/reprise : déplacements et transports maritimes identiques');
}
