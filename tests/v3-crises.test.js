// Tests des CRISES INTERNATIONALES, CONFÉRENCES et SANCTIONS.
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
const ids = ['IN', 'PK', 'CN', 'US', 'RU', 'FR', 'GB', 'DE', 'JP', 'BD', 'NP', 'AF', 'IR'];
const mk = (opts = {}, restore = null) => new m.WorldSim(grid, nav, world, { participants: ids.map((id, k) => ({ e: idx(id), team: k })), teams: ids.map((n) => ({ name: n })), options: { seed: 'CRI', warStart: 'tensions', aiWars: false, maxDuration: 1e9, peaceEnd: 1e9, ...opts } }, restore, { geo, details });
const step = (sim, t) => { while (!sim.finished && sim.time < t) { sim.step(); sim.captures.length = 0; sim.eventsOut.length = 0; } return sim; };
const S = (sim) => sim.S;

// 1. sanctions : effet économique réel, levée
{
  const sim = mk();
  step(sim, 5);
  const ru = ids.indexOf('RU');
  ok(m.sanctionDrag(sim, ru) === 0, 'aucune sanction au départ');
  for (const by of ['US', 'FR', 'GB', 'DE', 'JP']) m.sanction(sim, ids.indexOf(by), ru, 'test');
  const d = m.sanctionDrag(sim, ru);
  const g0 = sim.sides[ru].eco.gdp;
  step(sim, 5 + 10 * 12);
  ok(d > 0.005 && m.sanctionsOn(sim, ru).length >= 4, `sanctions de 5 pays : perte de ${Math.round(d * 1000) / 10} % du PIB russe`);
  const ref = mk(); step(ref, 5 + 10 * 12);
  ok(sim.sides[ru].eco.gdp < ref.sides[ru].eco.gdp, `PIB russe après un an : ${Math.round(sim.sides[ru].eco.gdp)} Md$ (sans sanctions : ${Math.round(ref.sides[ru].eco.gdp)} Md$)`);
  ok(m.liftSanction(sim, ids.indexOf('FR'), ru) && !m.isSanctioning(sim, ids.indexOf('FR'), ru), 'levée des sanctions');
  void g0;
}
// 2. crises : une crise entre voisins hostiles passe par une conférence et se conclut
{
  const sim = mk();
  const a = ids.indexOf('IN'), b = ids.indexOf('PK');
  sim.rel[a * S(sim) + b] = sim.rel[b * S(sim) + a] = -80;
  sim._nextCrisis = 0;
  let seen = null, conf = false;
  while (sim.time < 300 && !(seen && seen.stage === 'resolved')) {
    sim.step(); sim.captures.length = 0; sim.eventsOut.length = 0;
    const c = m.crisesOf(sim).find((x) => x.a >= 0);
    if (c) { seen = c; if (c.stage === 'conference') conf = true; }
  }
  ok(!!seen, `crise déclenchée : ${seen ? m.CRISIS_TYPES[seen.type].label + ' entre ' + sim.sides[seen.a].name + ' et ' + sim.sides[seen.b].name : '—'}`);
  ok(conf && seen.mediators.length > 0, `conférence internationale avec médiateurs : ${seen ? seen.mediators.map((k) => sim.sides[k].name).join(', ') : '—'}`);
  ok(seen && seen.stage === 'resolved' && ['accord', 'statu', 'escalade'].includes(seen.outcome), `issue de la conférence : ${seen ? seen.outcome : '—'} (${seen ? seen.log.length : 0} étapes)`);
}
// 3. joueur : la conférence lui demande sa ligne (décision) et l'applique
{
  const sim = mk({ nation: { player: ids.indexOf('IN') }, mode: 'nation' });
  const a = ids.indexOf('IN'), b = ids.indexOf('PK');
  sim.rel[a * S(sim) + b] = sim.rel[b * S(sim) + a] = -80;
  sim._nextCrisis = 0; sim.nation.decision = null; sim.nation.nextDecisionAt = 1e9;
  let asked = null;
  while (sim.time < 300 && !asked) { sim.step(); sim.captures.length = 0; sim.eventsOut.length = 0; if (sim.nation.decision && sim.nation.decision.crisis) asked = sim.nation.decision; }
  ok(!!asked && asked.options.length === 4, `décision du joueur : « ${asked ? asked.title : '—'} » (${asked ? asked.options.map((o) => o.label).join(' / ') : ''})`);
  if (asked) {
    sim.nation.choose(0);
    const c = m.crisesOf(sim).find((x) => x.id === asked.crisis);
    ok(c.stances[a] === 'concede', 'la ligne choisie (concessions) est prise en compte par la conférence');
  }
}
// 4. crise mondiale de l'énergie : les importateurs perdent, les producteurs gagnent
{
  const sim = mk();
  step(sim, 2);
  sim.crises = [{ id: 1, type: 'energy', a: -1, b: -1, start: 0, stage: 'global', until: 1e9, log: [] }];
  const byE = sim.sides.slice().sort((x, y) => x.p.res.energy - y.p.res.energy);
  const lo = byE[0], hi = byE[byE.length - 1];
  const dl = m.globalCrisisEffect(sim, lo.index), dh = m.globalCrisisEffect(sim, hi.index);
  ok(dl > 0 && dh < 0, `crise de l'énergie : ${lo.name} (importateur) perd ${Math.round(dl * 1000) / 10} % de PIB, ${hi.name} (producteur) gagne ${Math.round(-dh * 1000) / 10} %`);
}
// 5. sauvegarde
{
  const a = mk(); step(a, 5); m.sanction(a, 3, 4, 'test'); a._nextCrisis = 0; step(a, 80);
  const snap = JSON.parse(JSON.stringify(a.serialize()));
  const b = mk({}, snap); step(a, 160); step(b, 160);
  ok(JSON.stringify(m.sanctionsOf(a)) === JSON.stringify(m.sanctionsOf(b)) && JSON.stringify(m.crisesOf(a)) === JSON.stringify(m.crisesOf(b)), `sauvegarde : ${m.sanctionsOf(a).length} sanction(s), ${m.crisesOf(a).length} crise(s) identiques après reprise`);
}
