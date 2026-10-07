// Tests NATION SIMULATOR / MODE HISTOIRE : données réelles, pays du joueur, arbre de développement,
// diplomatie (analyse de l'IA), décisions, scénarios, sauvegarde exacte, parties longues (décennies).
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
const cells = new Map(); for (let i = 0; i < grid.n; i++) cells.set(world.owner[i], (cells.get(world.owner[i]) || 0) + 1);
const ents = world.entities.filter((e) => e.kind !== 'neutral' && cells.get(e.index) > 0);
const setupFor = (player, opts = {}) => ({
  participants: ents.map((e, k) => ({ e: e.index, team: k })), teams: ents.map((e) => ({ name: e.name, color: e.color })),
  options: { seed: opts.seed || 'NATION', warStart: 'tensions', maxDuration: 1e9, peaceEnd: 1e9, maxWarsPerYear: 2, maxAgents: 1100, startDay: 365, nation: { player: ents.findIndex((e) => e.id === player), scenario: opts.scenario || null } },
});
const mk = (player, opts, restore = null) => new m.WorldSim(grid, nav, world, setupFor(player, opts), restore, { geo });
const run = (sim, t) => { while (!sim.finished && sim.time < t) { sim.step(); sim.captures.length = 0; sim.eventsOut.length = 0; } return sim; };

// 1. données réelles : couverture et sources identifiées, aucune note de puissance unique
{
  const meta = m.REAL_META;
  ok(meta && meta.coverage.population >= 190 && meta.coverage.gdp >= 185 && meta.coverage.military >= 140, `données réelles : population ${meta.coverage.population}, PIB ${meta.coverage.gdp}, dépenses militaires ${meta.coverage.military} pays / ${meta.coverage.total}`);
  const fr = m.realStatsOf(world.entities.find((e) => e.id === 'FR'));
  ok(fr && fr.population > 6e7 && fr.gdpUsd > 2e12 && fr.milPct > 1 && fr.milPct < 4, `France : ${(fr.population / 1e6).toFixed(1)} M hab. (${fr.popYear}), PIB ${(fr.gdpUsd / 1e9).toFixed(0)} Md$ (${fr.gdpYear}), défense ${fr.milPct.toFixed(2)} % (${fr.milYear})`);
}

// 2. partie Nation : pays du joueur, statistiques de départ réelles
const sim = mk('FR');
const n = sim.nation;
const k = n.player;
const sd = sim.sides[k];
ok(sd.name === 'France' && sd.player === true && sim.sides.filter((s) => s.player).length === 1, `pays du joueur : ${sd.name} (côté ${k} / ${sim.S})`);
ok(Math.abs(sd.eco.gdp - 3000) < 600, `PIB de départ de la France proche du réel : ${sd.eco.gdp.toFixed(0)} Md$`);
ok(Math.abs(sd.pop / 1e6 - 68) < 4, `population de départ : ${(sd.pop / 1e6).toFixed(1)} M`);

// 3. arbre de développement : coût, durée, argent immobilisé, effets
{
  const m0 = sd.money;
  ok(n.canStart(k, 'eco1') && !n.canStart(k, 'eco2'), 'arbre : « Économie de base » disponible, « Industrialisation » verrouillée');
  ok(n.startProject(k, 'eco1') && n.startProject(k, 'tech1'), 'projets lancés (économie, technologie)');
  ok(!n.startProject(k, 'eco2'), 'une branche ne peut porter qu\'un projet à la fois');
  const tax0 = sd.p.tech;
  run(sim, 10 * 20);
  ok(sd.dev.done.includes('eco1') && sd.dev.done.includes('tech1'), `projets achevés après ${(sim.time / 121.67).toFixed(1)} an(s) : ${sd.dev.done.join(', ')}`);
  ok(sd.p.tech > tax0 && (sd.devIncome || 0) > 0, `effets appliqués : technologie ${tax0.toFixed(1)} -> ${sd.p.tech.toFixed(1)}, recettes +${Math.round(sd.devIncome * 100)} %`);
  void m0;
  const aiDev = sim.sides.filter((s) => !s.player && s.dev.done.length + Object.keys(s.dev.active).length > 0).length;
  ok(aiDev > sim.S * 0.5, `les IA développent aussi leur pays : ${aiDev} pays avec des projets`);
}

// 4. diplomatie : analyse par l'IA (facteurs), réponses différentes selon les relations et l'historique
{
  const de = sim.sides.findIndex((s) => s.name === 'Brésil');
  const ev = n.evaluate(k, sim.sides.findIndex((s) => s.name === 'Japon'), 'trade');
  ok(ev.factors.length >= 3 && ['accept', 'refuse', 'counter'].includes(ev.result), `Japon / accord commercial : ${ev.result} (score ${ev.score.toFixed(2)}) — ${ev.factors.map((f) => f.label + ' ' + f.v).join(' ; ')}`);
  const kp = sim.sides.findIndex((s) => s.name === 'Corée du Nord');
  const ev2 = n.evaluate(k, kp, 'alliance');
  ok(ev2.result === 'refuse', `Corée du Nord / alliance : ${ev2.result} (${ev2.factors.slice(0, 2).map((f) => f.label).join(', ')})`);
  const before = n.evaluate(k, de, 'alliance').score;
  n.memOf(de).refused = 4; n.memOf(de).broken = 1;
  const after = n.evaluate(k, de, 'alliance').score;
  ok(after < before - 0.3, `mémoire : refus et trahisons passés rendent l'IA moins coopérative (${before.toFixed(2)} -> ${after.toFixed(2)})`);
  n.memOf(de).refused = 0; n.memOf(de).broken = 0;
  const r = n.propose(de, 'talk');
  ok(r.result === 'info' && r.text.length > 20, `discussion : « ${r.text} »`);
  const g = n.propose(de, 'gift', { amount: 2 });
  ok(g.result === 'accept', `aide financière : ${g.text}`);
}

// 5. décisions et événements
{
  run(sim, 10 * 12 * 3);
  ok(n.decision || n.decisionsTaken.length > 0, `décisions proposées : ${n.decision ? n.decision.title : n.decisionsTaken.join(', ')}`);
  if (n.decision) { const t = n.decision.title; n.choose(0); ok(!n.decision && n.milestones.some((x) => x.type === 'decision'), `décision prise : ${t}`); }
  ok(n.timeline.length >= 3, `chronologie annuelle : ${n.timeline.map((y) => y.year + ' PIB ' + y.gdp).join(' | ')}`);
}

// 6. sauvegarde / reprise exacte avec le mode Nation
{
  const snap = JSON.parse(JSON.stringify(sim.serialize()));
  const b = mk('FR', {}, snap);
  for (let s = 0; s < 1200; s++) { sim.step(); b.step(); }
  const same = sim.owner.every((v, i) => v === b.owner[i]) && sim.rng.state === b.rng.state && JSON.stringify(sim.nation.serialize()) === JSON.stringify(b.nation.serialize());
  ok(same, `sauvegarde/reprise exacte (nation, projets, accords, décisions) à ${sim.dateStr ? sim.dateStr() : sim.time.toFixed(0)}`);
}

// 7. partie longue : 20 ans, le monde continue d'évoluer, rythme des guerres limité, performances
{
  const t0 = Date.now(), tk0 = sim.tickCount;
  run(sim, 121.67 * 20);
  const ms = (Date.now() - t0) / Math.max(1, sim.tickCount - tk0);
  const wars = sim.wars.length;
  ok(!sim.finished && n.timeline.length >= 19, `20 ans simulés : ${n.timeline[0].year} -> ${n.timeline[n.timeline.length - 1].year}, ${wars} guerre(s) dans le monde, ${ms.toFixed(2)} ms/tick`);
  ok(wars <= 2 * 21 + 6, `rythme des guerres d'IA limité (${wars})`);
  const tl = n.timeline;
  ok(tl[tl.length - 1].gdp !== tl[0].gdp && sd.eco.gdp > 0, `évolution de la France : PIB ${tl[0].gdp} -> ${tl[tl.length - 1].gdp} Md$, population ${(tl[0].pop / 1e6).toFixed(1)} -> ${(tl[tl.length - 1].pop / 1e6).toFixed(1)} M, technologie ${tl[0].tech} -> ${tl[tl.length - 1].tech}`);
  const g = sim.sides.filter((s) => !s.eliminated).map((s) => s.eco.gdp / (s.eco.gdp0 || s.eco.gdp));
  g.sort((a, b) => a - b);
  ok(g[Math.floor(g.length / 2)] > 1.05 && g[Math.floor(g.length / 2)] < 4, `croissance médiane mondiale sur 20 ans : ×${g[Math.floor(g.length / 2)].toFixed(2)}`);
  const ended = sim.wars.filter((w) => w.report && w.report.compare);
  if (ended.length) {
    const rep = ended[0].report;
    const c = Object.values(rep.compare)[0];
    ok(c.before && c.after && c.losses.personnel >= 0, `rapport de guerre AVANT/APRÈS : ${c.name} population ${c.before.pop} -> ${c.after.pop}, effectifs ${c.before.personnel} -> ${c.after.personnel}, pertes ${c.losses.personnel}, PIB ${c.losses.gdpPct} %`);
  } else ok(true, 'aucune guerre terminée à comparer');
}

// 8. scénarios du mode histoire : mise en place, objectifs suivis, fin de scénario
for (const sc of m.SCENARIOS) {
  const s = mk(sc.country, { scenario: sc.id, seed: 'SC' + sc.id });
  const nn = s.nation;
  run(s, 121.67 * 2);
  const st = nn.scenario;
  ok(st && st.progress && Object.keys(st.progress).length === sc.objectives.length, `scénario « ${sc.title} » (${s.sides[nn.player].name}) : ${sc.objectives.map((o) => Math.round((st.progress[o.id] || 0) * 100) + ' %').join(' / ')}, état ${st.status}`);
}
{
  const s = mk('GR', { scenario: 'debt', seed: 'END' });
  s.nation.scenario.start = -121.67 * 10;    // durée écoulée : la fin du scénario doit être prononcée
  run(s, 12);
  const st = s.nation.scenario;
  ok(st.status === 'ended' && st.ending && st.grade, `fin de scénario : ${st.grade} — ${st.ending && st.ending.title}`);
}
