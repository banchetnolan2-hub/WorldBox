// Tests des ARBRES TECHNOLOGIQUES : arbre civil et arbre militaire (branches, paliers, prérequis valides et sans
// cycle), spécialisations différentes selon les pays (coûts, technologies propres), effets réels sur la
// simulation (combat, défense aérienne, convois…), conséquences, choix des IA, sauvegarde.
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

// 1. structure des arbres
{
  const civ = m.TECH_BRANCHES.filter((b) => b.cat === 'civil'), mil = m.TECH_BRANCHES.filter((b) => b.cat === 'mil');
  ok(civ.length >= 13 && mil.length >= 12, `branches : ${civ.length} civiles (${civ.map((b) => b.label).join(', ')}), ${mil.length} militaires`);
  ok(m.TECHS.length >= 140, `${m.TECHS.length} technologies (${m.TECHS.filter((t) => m.BRANCH_BY_ID[t.branch].cat === 'civil').length} civiles, ${m.TECHS.filter((t) => m.BRANCH_BY_ID[t.branch].cat === 'mil').length} militaires, ${m.TECHS.filter((t) => t.spec).length} propres à une spécialisation)`);
  const bad = m.TECHS.filter((t) => t.req.some((r) => !m.TECH_BY_ID[r]));
  ok(!bad.length, `prérequis valides${bad.length ? ' — ' + bad.map((t) => t.id).join(', ') : ''}`);
  // pas de cycle, chaque technologie est atteignable
  const reach = new Set(); let grew = true;
  while (grew) { grew = false; for (const t of m.TECHS) if (!reach.has(t.id) && t.req.every((r) => reach.has(r))) { reach.add(t.id); grew = true; } }
  ok(reach.size === m.TECHS.length, `toutes les technologies sont atteignables (aucun cycle) : ${reach.size}/${m.TECHS.length}`);
  ok(m.TECHS.every((t) => t.cost > 0 && t.years > 0 && Object.keys(t.fx).length > 0 && t.name && t.desc), 'chaque technologie a un coût, une durée, des effets et une description');
  ok(m.TECHS.filter((t) => t.cons).length >= 12, `${m.TECHS.filter((t) => t.cons).length} technologies ont des conséquences (entretien, tensions, stabilité)`);
  ok(['eco1', 'tech4', 'def4', 'diplo4', 'infra4', 'edu4'].every((id) => m.TECH_BY_ID[id]), 'anciens projets conservés (sauvegardes compatibles)');
  const maxTier = Math.max(...m.TECHS.map((t) => t.tier));
  ok(maxTier >= 6, `jusqu'à ${maxTier} paliers`);
}

// 2. spécialisations : différentes selon les pays
const ids = ['GB', 'RU', 'CH', 'SA', 'DE', 'JP', 'IL', 'BR', 'NO', 'SG', 'US', 'FR', 'EG', 'CN'];
const st = { participants: ids.map((id, k) => ({ e: idx(id), team: k })), teams: ids.map((n) => ({ name: n })), options: { seed: 'TECH', warStart: 'tensions', aiWars: false, maxDuration: 1e9, peaceEnd: 1e9, nation: { player: 0 }, mode: 'nation' } };
const sim = new m.WorldSim(grid, nav, world, st, null, { geo, details });
const n = sim.nation;
const spec = (id) => m.specsOf(sim, ids.indexOf(id));
{
  const list = ids.map((id) => `${id}: ${spec(id).join('+') || '—'}`);
  ok(spec('GB').includes('maritime') && spec('RU').includes('continental') && spec('CH').includes('mountain') && spec('SA').includes('desert'), `spécialisations : ${list.join(' · ')}`);
  ok(new Set(ids.map((id) => spec(id).sort().join())).size >= 9, 'les pays ont des profils technologiques différents');
  const gb = n.costOf(ids.indexOf('GB'), 'nav2'), ru = n.costOf(ids.indexOf('RU'), 'nav2');
  ok(gb.aff > ru.aff, `affinités : marine ${gb.aff.toFixed(2)} (Royaume-Uni) contre ${ru.aff.toFixed(2)} (Russie)`);
  const ch = ids.indexOf('CH');
  ok(n.costOf(ch, 'nav1').aff < 1, `pays sans accès à la mer : marine plus chère (affinité ${n.costOf(ch, 'nav1').aff.toFixed(2)})`);
  sim.sides[0].dev.done.push('def1', 'inf1', 'inf2', 'mtr1', 'nav1', 'transp1', 'infra1');
  const k2 = ids.indexOf('CH'); sim.sides[k2].dev.done.push('def1', 'inf1', 'inf2');
  ok(n.canStart(0, 'mtr2') && !n.canStart(0, 'sp_mount') && n.canStart(k2, 'sp_mount'), 'technologies propres : « Troupes de montagne » ouvertes à la Suisse, pas au Royaume-Uni');
}
// 3. effets réels sur la simulation
{
  const k = 1, sd = sim.sides[k];
  const a0 = sim.attackPower(k, sd.capital), d0 = sim.defensePower(k, sd.capital);
  n._applyFx(k, { atk: 0.1, def: 0.1 });
  ok(sim.attackPower(k, sd.capital) > a0 * 1.09 && sim.defensePower(k, sd.capital) > d0 * 1.09, `combat : attaque ${(sim.attackPower(k, sd.capital) / a0).toFixed(2)}×, défense ${(sim.defensePower(k, sd.capital) / d0).toFixed(2)}×`);
  const s0 = sim._sealift(sd);
  n._applyFx(k, { sealift: 2 });
  ok(sim._sealift(sd) >= Math.min(9, s0 + 2), `convois maritimes : ${s0} -> ${sim._sealift(sd)}`);
  n._applyFx(k, { airDef: 0.2 });
  ok(sd.airDef >= 0.2, 'défense aérienne enregistrée (interceptions des frappes)');
  // conséquences : tensions avec les voisins
  const k3 = ids.indexOf('RU'), nb = sim.sides.findIndex((o, i) => i !== k3 && sim.contact[k3 * sim.S + i] > 0 && !sim.allied[k3 * sim.S + i]);
  const r0 = sim.rel[k3 * sim.S + nb];
  n._applyCons(k3, m.TECH_BY_ID.avi5.cons);
  ok(sim.rel[k3 * sim.S + nb] < r0 && sim.sides[k3].techUpkeep > 0, `conséquences de « Furtivité » : relations ${r0.toFixed(0)} -> ${sim.rel[k3 * sim.S + nb].toFixed(0)}, entretien ${(sim.sides[k3].techUpkeep * 100).toFixed(2)} % du PIB`);
}
// 4. les IA choisissent selon leur profil ; en guerre, plus de technologies militaires
{
  const run = (war) => {
    const s2 = new m.WorldSim(grid, nav, world, { ...st, options: { ...st.options, seed: 'TECH2' } }, null, { geo, details });
    if (war) m.startWar(s2, [ids.indexOf('RU')], [ids.indexOf('DE')], 'declaration');
    while (s2.time < 200) { s2.step(); s2.captures.length = 0; s2.eventsOut.length = 0; }
    let mil = 0, tot = 0;
    for (const id of ['RU', 'DE']) { const sd = s2.sides[ids.indexOf(id)]; for (const t of [...sd.dev.done, ...Object.values(sd.dev.active).map((a) => a.id)]) { tot++; if (m.BRANCH_BY_ID[m.TECH_BY_ID[t].branch].cat === 'mil') mil++; } }
    const nb = s2.sides.reduce((a, sd) => a + sd.dev.done.length + Object.keys(sd.dev.active).length, 0);
    return { mil, tot, nb, s2 };
  };
  const peace = run(false), war = run(true);
  ok(peace.nb > 20, `les IA lancent des projets : ${peace.nb} en paix`);
  ok(war.mil / Math.max(1, war.tot) >= peace.mil / Math.max(1, peace.tot), `en guerre, part militaire ${Math.round(100 * war.mil / Math.max(1, war.tot))} % (paix : ${Math.round(100 * peace.mil / Math.max(1, peace.tot))} %)`);
  const gb = war.s2.sides[ids.indexOf('JP')];
  const branches = new Set([...gb.dev.done, ...Object.values(gb.dev.active).map((a) => a.id)].map((t) => m.TECH_BY_ID[t].branch));
  ok(branches.size >= 2, `Japon : projets dans ${[...branches].join(', ')}`);
}
// 5. sauvegarde : effets militaires et projets repris
{
  const snap = JSON.parse(JSON.stringify(sim.serialize()));
  const b = new m.WorldSim(grid, nav, world, st, snap, { geo, details });
  ok(b.sides[1].techAtk === sim.sides[1].techAtk && b.sides[1].airDef === sim.sides[1].airDef && b.sides[0].dev.done.length === sim.sides[0].dev.done.length, 'sauvegarde : technologies et effets militaires conservés');
}
