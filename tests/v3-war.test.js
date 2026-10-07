// Tests des systèmes vivants : conditions de fin de guerre, traité, BORDER CLEANUP, rapports,
// IA (personnalités), économie liée (armée trop chère), sauvegarde des guerres.
const path = require('path'); const fs = require('fs'); const zlib = require('zlib');
require('esbuild').buildSync({ entryPoints: [path.join(__dirname, 'v3-entry.mjs')], bundle: true, platform: 'node', format: 'cjs', outfile: path.join(__dirname, '.v3-bundle.cjs'), logLevel: 'error' });
const m = require('./.v3-bundle.cjs');
const ok = (c, label) => { console.log((c ? 'OK   ' : 'ÉCHEC') + ' ' + label); if (!c) process.exitCode = 1; };
const grid = m.parseWorldGrid(new Uint8Array(zlib.inflateSync(fs.readFileSync(path.join(__dirname, '..', 'src/data/world-grid.bin')))));
const relief = new m.Relief(new Uint8Array(zlib.inflateSync(fs.readFileSync(path.join(__dirname, '..', 'src/data/world-relief.bin')))));
const geo = m.computeGeo(grid, relief);
const data = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'src/data/countries.json'), 'utf8'));
const nav = new m.Navigator(grid);
const world = m.createOriginalWorld(grid, data);
const idx = (id) => world.entities.findIndex((e) => e.id === id);
const mk = (ids, opts = {}, parts = {}) => new m.WorldSim(grid, nav, world, {
  participants: ids.map((id, k) => ({ e: idx(id), team: k, ...(parts[id] || {}) })), teams: ids.map((n) => ({ name: n, color: '#fff' })), options: { seed: 'T', ...opts },
}, null, { geo });
const run = (sim, maxT = 1e9) => { while (!sim.finished && sim.time < maxT) { sim.step(); sim.captures.length = 0; sim.eventsOut.length = 0; } return sim; };

console.log(`géographie : ${geo.ms} ms, biomes ${geo.counts.join('/')}, ${geo.riverSegs.length / 3} segments de rivières`);

// 1. victoire territoriale complète (vérifiée parcelle par parcelle)
{
  const sim = run(mk(['FR', 'BE'], { warEnd: { territorial: 'complete', percent: 1, economic: false, peace: false, capitulation: false }, maxDuration: 400 }, { FR: { powerMult: 2 } }));
  const w = sim.wars[0];
  let left = 0; for (let i = 0; i < sim.n; i++) if (sim.owner[i] === idx('BE')) left++;
  ok(w.status === 'ended' && w.endReason === 'complete' && left === 0, `Complete Territorial Victory : ${w.name}, ${w.endReason}, parcelles restantes du perdant ${left}, durée ${m.fmtDuration(w.end - w.start)}`);
  const t = w.report.territories.find((x) => x.e === idx('BE'));
  ok(t && t.finalKm2 === 0 && t.lostKm2 > 20000, `rapport : Belgique ${t.initialKm2} km² -> ${t.finalKm2} km², perdu ${t.lostKm2} km²`);
}
// 2. pourcentage + traité + nettoyage des frontières (aucune enclave minuscule chez les participants)
{
  const sim = mk(['FR', 'DE'], { warEnd: { territorial: 'percent', percent: 0.3, economic: true, peace: true, capitulation: true } });
  run(sim);
  const w = sim.wars[0];
  ok(w.status === 'ended' && !!w.treaty && !!w.report, `fin de guerre : ${w.endReason}, vainqueur ${w.winner}, ${w.battles.length} batailles, ${w.timeline.length} points de chronologie`);
  // composantes des deux pays
  const bad = [];
  for (const s of sim.sides) {
    const seen = new Uint8Array(sim.n);
    for (let i = 0; i < sim.n; i++) {
      if (sim.owner[i] !== s.e || seen[i]) continue;
      const st = [i]; seen[i] = 1; let size = 0; let cap = false; let region = false;
      while (st.length) { const a = st.pop(); size++; if (a === s.capital) cap = true; if (w.changes.has(a)) region = true; for (let k = grid.nbrStart[a]; k < grid.nbrStart[a + 1]; k++) { const b = grid.nbr[k]; if (!seen[b] && sim.owner[b] === s.e) { seen[b] = 1; st.push(b); } } }
      let foreign = false; for (let a = 0; a < sim.n && !foreign; a++) if (seen[a] === 1 && sim.owner[a] === s.e && size < 8) for (let k = grid.nbrStart[a]; k < grid.nbrStart[a + 1]; k++) if (sim.owner[grid.nbr[k]] !== s.e) { foreign = true; break; }
      if (!cap && region && size < 8 && foreign) { const nb = new Set(); for (let a = 0; a < sim.n; a++) if (seen[a] === 1 && sim.owner[a] === s.e) {} bad.push({ size, cell: i, lat: grid.lat[i], lon: grid.lon[i], owner: s.name, coastal: grid.coastal[i], nbrs: [...new Set(Array.from({ length: grid.nbrStart[i + 1] - grid.nbrStart[i] }, (_, q) => world.entities[sim.owner[grid.nbr[grid.nbrStart[i] + q]]]?.name))] }); }
    }
  }
  ok(bad.length === 0, `BORDER CLEANUP : ${JSON.stringify(w.treaty.cleanup)}, enclaves restantes ${bad.length} ${JSON.stringify(bad)}`);
  ok(w.report.zones.length > 0 && w.report.zones[0].name.length > 3, `zones changées : ${w.report.zones.slice(0, 3).map((z) => z.name + ' ' + z.km2 + ' km²').join(', ')}`);
  ok(sim.chronicle.some((c) => c.type === 'treaty') && sim.sides.every((s) => s.hist.some((h) => h.type === 'treaty')), 'histoire du monde et des pays : traité enregistré');
  const aiW = sim.sides.find((s) => s.ai.memory.some((x) => x.type === 'wonWar' || x.type === 'lostWar'));
  ok(!!aiW, 'IA : la fin de guerre est mémorisée (' + sim.sides.map((s) => s.name + ' -> ' + s.ai.objectives.map((o) => o.type).join('/')).join(' ; ') + ')');
}
// 3. guerre sans condition automatique -> armistice à la fin
{
  const sim = run(mk(['FR', 'DE'], { maxDuration: 90, warEnd: { territorial: 'none', economic: false, peace: false, capitulation: false } }));
  ok(sim.wars[0].endReason === 'armistice' && Math.abs(sim.time - 90) < 1, `sans condition automatique : ${sim.wars[0].endReason} à ${sim.time.toFixed(0)} s`);
}
// 4. personnalités : même situation, décisions différentes
{
  const res = {};
  for (const p of ['expansionist', 'defensive']) {
    let decl = 0;
    for (const seed of ['a', 'b', 'c']) {
      const sim = mk(['DE', 'PL', 'CZ', 'AT'], { seed, warStart: 'tensions', maxDuration: 150 }, { DE: { personality: p, powerMult: 1.6 } });
      run(sim);
      decl += sim.wars.filter((w) => w.a[0] === 0).length;
    }
    res[p] = decl;
  }
  ok(res.expansionist > res.defensive, `personnalités : guerres déclarées par l'Allemagne expansionniste ${res.expansionist} / défensive ${res.defensive}`);
}
// 5. économie liée : une armée trop chère pour le budget est réduite
{
  const sim = mk(['CH', 'AT'], { warStart: 'tensions', aiWars: false, maxDuration: 200 }, { CH: { units: 900 } });
  const u0 = sim.sides[0].units, d0 = sim.sides[0].debt;
  run(sim, 150);
  const s = sim.sides[0];
  ok(s.units < u0 * 0.85, `armée trop coûteuse : ${u0.toFixed(0)} -> ${s.units.toFixed(0)} unités, dette ${d0.toFixed(0)} -> ${s.debt.toFixed(0)} Md$, préparation ${s.readiness.toFixed(2)}`);
}
// 6. sauvegarde / reprise en pleine guerre (guerres, batailles, IA, économie)
{
  const a = mk(['FR', 'DE', 'IT'], { seed: 'SV' });
  for (let k = 0; k < 1500; k++) a.step();
  const snap = JSON.parse(JSON.stringify(a.serialize()));
  const b = new m.WorldSim(grid, nav, world, { participants: ['FR', 'DE', 'IT'].map((id, k) => ({ e: idx(id), team: k })), teams: [0, 1, 2].map((k) => ({ name: 'T' + k })), options: { seed: 'SV' } }, snap, { geo });
  for (let k = 0; k < 1500; k++) { a.step(); b.step(); }
  const same = a.owner.every((v, i) => v === b.owner[i]) && a.rng.state === b.rng.state && a.wars.length === b.wars.length && JSON.stringify(a.chronicle) === JSON.stringify(b.chronicle);
  ok(same, `sauvegarde/reprise exacte en guerre : ${a.wars.length} guerre(s), ${a.chronicle.length} entrées d'histoire`);
}
// 7. le monde garde l'histoire : guerres (rapport, traité, batailles, frontières avant/après), pays, date
(async () => {
  const sim = run(mk(['FR', 'DE'], { seed: 'HIST' }));
  const w0 = m.cloneWorld(world);
  const w1 = m.applySimulationToWorld(w0, sim, 'France VS Allemagne');
  const data = JSON.parse(JSON.stringify(await m.serializeWorld(w1)));
  const w2 = await m.deserializeWorld(data, { earthGrid: grid, contextFor: () => ({ grid }) }, JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'src/data/countries.json'), 'utf8')));
  const war = w2.chronicle.wars[0];
  const diff = war && m.decodeDiff(war.diff);
  const fr = w2.entities[idx('FR')];
  ok(!!war && war.report && war.treaty && war.battles.length > 0 && diff.cells.length > 0 && w2.chronicle.events.length > 3 && w2.dateDays > 0,
    `sauvegarde du monde : ${w2.chronicle.wars.length} guerre(s), ${w2.chronicle.events.length} événements, ${diff ? diff.cells.length : 0} parcelles avant/après, date ${m.fmtDate(0, w2.dateDays)}`);
  ok(!!fr.profile && fr.profile.army && w2.chronicle.countries[String(idx('FR'))].entries.length > 0, `profil et histoire de la France conservés (armée ${Math.round(fr.profile.army.inf)} u. d'infanterie, trésorerie ${fr.profile.money} Md$)`);
  // une deuxième simulation part de l'état laissé par la première
  const sim2 = new m.WorldSim(grid, nav, w2, { participants: [{ e: idx('FR'), team: 0 }, { e: idx('DE'), team: 1 }], teams: [{ name: 'A' }, { name: 'B' }], options: { seed: 'H2', startDay: w2.dateDays } }, null, { geo });
  ok(Math.abs(sim2.sides[0].money - fr.profile.money) < 1 && sim2.dateStr() === m.fmtDate(0, w2.dateDays), `nouvelle simulation depuis le monde sauvegardé : ${sim2.dateStr()}`);
})();
// 8. carte propre après plusieurs guerres + groupes militaires sur le territoire principal / les fronts
{
  const ids = ['FR', 'DE', 'ES', 'IT', 'PL'];
  const sim = mk(ids, { seed: 'CLEAN', maxDuration: 320 });
  let offCore = 0, samples = 0, frontShare = 0, frontSamples = 0;
  while (!sim.finished) {
    sim.step(); sim.captures.length = 0; sim.eventsOut.length = 0;
    if (sim.tickCount % 200 === 0) for (const s of sim.sides) {
      if (s.eliminated) continue;
      const core = s.coreComp;
      for (const a of s.agents) { if (a.transit >= 0) continue; samples++; if (grid.comp[a.cell] !== core) offCore++; }
      if (sim.isAtWar(s.index) && s.agents.length && (s.sectors || []).some((sec) => sec.o >= 0 && sim.atWar[s.index * sim.S + sec.o] && sim.contact[s.index * sim.S + sec.o] >= 4)) { frontSamples++; frontShare += s.agents.filter((a) => (a.postKey && a.postKey[0] === 'S') || (a.sea && a.sea.landing) || a.op === 'landing').length / s.agents.length; }
    }
  }
  let frags = 0;
  for (const s of sim.sides) {
    if (s.eliminated) continue;
    const seen = new Uint8Array(sim.n);
    for (let i = 0; i < sim.n; i++) {
      if (sim.owner[i] !== s.e || seen[i]) continue;
      const c = [i]; seen[i] = 1; let foreign = false, orig = world.owner[i] === s.e;
      for (let q = 0; q < c.length; q++) { const a = c[q]; for (let k = grid.nbrStart[a]; k < grid.nbrStart[a + 1]; k++) { const b = grid.nbr[k]; if (sim.owner[b] === s.e) { if (!seen[b]) { seen[b] = 1; c.push(b); } } else foreign = true; } }
      if (foreign && c.length < 25 && !orig && !c.includes(s.capital)) frags++;
    }
  }
  ok(frags === 0, `carte après ${sim.wars.length} guerres : ${frags} fragment(s) minuscule(s) restant(s)`);
  ok(offCore / Math.max(1, samples) < 0.15 && frontShare / Math.max(1, frontSamples) > 0.5, `groupes militaires : ${Math.round((1 - offCore / samples) * 100)} % sur le territoire principal, ${Math.round(frontShare / frontSamples * 100)} % sur les fronts ou en débarquement (pays ayant un front terrestre)`);
}
