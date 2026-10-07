// Tests de la MISE À JOUR MAJEURE : règles de la partie (un système désactivé l'est vraiment),
// transport naval des troupes, mémoire diplomatique et propositions de paix sans répétition,
// scénarios créés par le joueur, sauvegarde/reprise (règles + mémoire), détails de la carte.
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
const setup = (ids, opts = {}) => ({ participants: ids.map((id, k) => ({ e: idx(id), team: k })), teams: ids.map((n) => ({ name: n, color: '#fff' })), options: { seed: 'R', ...opts } });
const mk = (ids, opts = {}, restore = null) => new m.WorldSim(grid, nav, world, setup(ids, opts), restore, { geo, details });
const step = (sim, t, each) => { while (!sim.finished && sim.time < t) { sim.step(); sim.captures.length = 0; sim.eventsOut.length = 0; if (each && each(sim)) break; } return sim; };
const EU = ['FR', 'DE', 'IT', 'ES', 'PL', 'AT', 'CH', 'BE', 'NL', 'CZ', 'HU', 'RO'];

// 1. règles : résolution, dépendances, modes, préréglages
{
  const r = m.resolveRules({ mode: 'sandbox', rules: { economy: false, wars: false } });
  ok(r.economy === false && r.debt === false && r.trade === false && r.crises === false, 'règles : l\'économie désactivée coupe dette, commerce et crises');
  ok(r.wars === false && r.peace === false && r.milEvents === false, 'règles : les guerres désactivées coupent la paix et les événements militaires');
  const lock = m.resolveRules({ mode: 'story', rules: { alliances: true }, lockedRules: { alliances: false } });
  ok(lock.alliances === false, 'règles : une règle imposée par le scénario l\'emporte sur le choix du joueur');
  const none = m.PRESETS.none.make('sandbox');
  ok(m.RULES.every((x) => none[x.id] === false) && m.RULES.every((x) => m.PRESETS.all.make()[x.id] !== false), `préréglages « Tout désactiver » / « Activer tout » : ${m.RULES.length} systèmes`);
  ok(m.defaultRules('nation').decisions !== false && m.defaultRules('sandbox').decisions === false, 'modes : décisions actives en Nation, coupées en Sandbox');
}

// 2. guerres désactivées : aucune guerre, aucune frontière ne bouge, même avec un départ en guerre
{
  const sim = step(mk(['FR', 'DE', 'BE'], { rules: { wars: false }, maxDuration: 1e9 }), 150);
  let moved = 0; for (let i = 0; i < sim.n; i++) if (sim.owner[i] !== world.owner[i]) moved++;
  ok(sim.wars.length === 0 && moved === 0, `guerres désactivées : ${sim.wars.length} guerre(s), ${moved} parcelle(s) changée(s) en 150 s`);
}

// 3. alliances désactivées : aucune alliance hors équipe, aucun pays n'entre en guerre aux côtés d'un autre
{
  const sim = mk(EU, { rules: { alliances: false }, warStart: 'tensions', aiWars: true, maxDuration: 1e9, maxWarsPerYear: 3 });
  let allied = 0, joins = 0;
  step(sim, 300, (s) => { if (s.tickCount % 100) return; for (let a = 0; a < s.S; a++) for (let b = 0; b < s.S; b++) if (a !== b && s.allied[a * s.S + b] && s.sides[a].team !== s.sides[b].team) allied++; });
  for (const w of sim.wars) joins += (w.joiners || []).length;
  ok(allied === 0 && joins === 0, `alliances désactivées : ${allied} alliance(s), ${joins} entrée(s) en guerre d'un allié (${sim.wars.length} guerre(s))`);
}

// 4. relations désactivées : toutes les relations restent neutres
{
  const sim = step(mk(['FR', 'DE', 'IT'], { rules: { relations: false }, warStart: 'tensions', maxDuration: 1e9 }), 120);
  let nz = 0; for (let i = 0; i < sim.rel.length; i++) if (sim.rel[i] !== 0) nz++;
  ok(nz === 0, `relations désactivées : ${nz} relation(s) non neutre(s)`);
}

// 5. économie désactivée : PIB, dette et trésorerie figés
{
  const sim = mk(['FR', 'DE'], { rules: { economy: false }, warStart: 'tensions', aiWars: false, maxDuration: 1e9 });
  const before = sim.sides.map((s) => [s.eco.gdp, s.debt]);
  step(sim, 200);
  const same = sim.sides.every((s, k) => s.eco.gdp === before[k][0] && s.debt === before[k][1]);
  ok(same, `économie désactivée : PIB ${before[0][0].toFixed(0)} -> ${sim.sides[0].eco.gdp.toFixed(0)} Md$, dette inchangée`);
}

// 6. événements aléatoires désactivés : aucun tirage
{
  const sim = step(mk(['FR', 'DE'], { rules: { randomEvents: false }, maxDuration: 1e9, eventRate: 1 }), 120);
  ok(sim.nextEventAt === Infinity, 'événements aléatoires désactivés : aucun événement programmé');
}

// 7. transport naval : débarquements entre îles, aucun bateau quand une route terrestre existe, règle respectée
{
  const seaUse = (sim, t) => { const seen = new Set(); let landings = 0; step(sim, t, (s) => { for (const sd of s.sides) for (const a of sd.agents) if (a.sea && !seen.has(a)) { seen.add(a); if (a.sea.landing) landings++; } }); return { orders: seen.size, landings }; };
  const isl = seaUse(mk(['GB', 'FR'], { maxDuration: 1e9 }), 220);
  ok(isl.orders > 0 && isl.landings > 0, `transport naval Royaume-Uni / France : ${isl.orders} groupe(s) embarqué(s), ${isl.landings} débarquement(s)`);
  const land = seaUse(mk(['FR', 'BE'], { maxDuration: 1e9 }), 120);
  ok(land.landings === 0, `pas de débarquement inutile entre pays voisins par la terre (France / Belgique) : ${land.landings}`);
  const off = seaUse(mk(['GB', 'FR'], { maxDuration: 1e9, rules: { navalTransport: false } }), 220);
  ok(off.orders === 0, `transport naval désactivé : ${off.orders} embarquement(s)`);
}

// 8. mémoire diplomatique : délai, refus, situation inchangée
{
  const sim = mk(['FR', 'DE'], { warStart: 'tensions', maxDuration: 1e9 });
  const ctx = { adv: 0.2, exh: 0.3, ratio: 1.2 };
  ok(m.canPropose(sim, 0, 1, 'peace', ctx).ok, 'mémoire : première proposition autorisée');
  m.noteProposal(sim, 0, 1, 'peace', 'refuse', ctx);
  ok(!m.canPropose(sim, 0, 1, 'peace', ctx, { cooldown: 45 }).ok, 'mémoire : pas de nouvelle proposition juste après un refus');
  sim.time += 200;
  const same = m.canPropose(sim, 0, 1, 'peace', ctx, { cooldown: 45 });
  const diff = m.canPropose(sim, 0, 1, 'peace', { adv: -0.2, exh: 0.6, ratio: 0.7 }, { cooldown: 45 });
  ok(!same.ok && same.reason === 'situation inchangée' && diff.ok, `mémoire : même situation -> ${same.reason} ; situation changée -> autorisée`);
  m.dnote(sim, 0, 1, 'betrayal', 'test');
  ok(m.trustOf(sim, 1, 0) < m.trustOf(sim, 0, 1) + 1 && m.dmem(sim, 1, 0).events.length === 1, 'mémoire : les faits sont inscrits pour les deux pays');
}

// 9. pas de pluie de propositions de paix entre IA (délai d'au moins 45 s entre deux propositions d'un même pays)
{
  const sim = step(mk(['FR', 'DE', 'ES', 'IT', 'PL'], { seed: 'CLEAN', maxDuration: 320 }), 1e9);
  let pairs = 0, props = 0, minGap = Infinity;
  for (const [key, mm] of Object.entries(sim.dmem || {})) {
    const t = mm.props.filter((p) => p.type === 'peace').map((p) => p.t);
    if (t.length) pairs++;
    props += t.length;
    for (let i = 1; i < t.length; i++) minGap = Math.min(minGap, t[i] - t[i - 1]);
    void key;
  }
  ok(minGap >= 44, `propositions de paix : ${props} en ${pairs} relation(s), écart minimal ${minGap === Infinity ? '—' : minGap + ' s'} (${sim.wars.length} guerre(s))`);
}

// 9 bis. le joueur n'est pas inondé de demandes de paix : refus mémorisés, délais croissants
{
  const ids = EU;
  const st = { participants: ids.map((id, k) => ({ e: idx(id), team: k, ...(id === 'DE' ? { powerMult: 1.4 } : {}) })), teams: ids.map((n) => ({ name: n })), options: { seed: 'SPAM', warStart: 'tensions', aiWars: false, maxDuration: 1e9, peaceEnd: 1e9, maxAgents: 600, warEnd: { territorial: 'complete', percent: 1, economic: false, peace: true, capitulation: false }, nation: { player: ids.indexOf('FR') }, mode: 'nation' } };
  const sim = new m.WorldSim(grid, nav, world, st, null, { geo, details });
  const n = sim.nation, de = ids.indexOf('DE');
  step(sim, 70);
  n.declareWar(de);
  const times = [];
  let seen = new Set();
  step(sim, 70 + 365, (s) => {
    for (const o of n.offers) if (o.type === 'peace' && !seen.has(o.id)) { seen.add(o.id); times.push(Math.round(s.time)); }
    // le joueur refuse tout de suite chaque proposition de paix
    for (const o of n.offers.filter((x) => x.type === 'peace')) n.answerOffer(o.id, false);
  });
  const gaps = times.slice(1).map((t, i) => t - times[i]);
  const grow = gaps.length < 2 || gaps[gaps.length - 1] >= gaps[0];
  const still = sim.activeWars.some((w) => w.status === 'active');
  ok((times.length >= 2 || (!still && times.length >= 1)) && times.length <= 6 && gaps.every((g) => g >= 44) && grow, `paix proposée au joueur : ${times.length} fois en 3 ans malgré des refus immédiats (écarts ${gaps.join(', ') || '—'} s, guerre ${still ? 'toujours en cours' : 'terminée'})`);
}
// 10. conditions de paix : territoires conservés ou rendus, réparations
{
  const sim = mk(['DE', 'BE'], { maxDuration: 1e9, warEnd: { territorial: 'complete', percent: 1, economic: false, peace: false, capitulation: false } }, null);
  step(sim, 12);
  const w = sim.activeWars[0];
  const t = m.makePeaceTerms(sim, w, w.a[0]);
  const d = m.describeTerms(sim, w, t, w.a[0]);
  ok(t && (t.kind === 'ceasefire' || t.kind === 'treaty') && (t.territory === 'keep' || t.territory === 'restore') && d.conditions.length > 0 && d.consequences.length > 0, `conditions de paix : ${t.kind}, ${t.territory}, ${d.conditions.length} condition(s), ${d.consequences.length} conséquence(s)`);
  const ev = m.evaluatePeace(sim, w, w.b[0], t);
  ok(['accept', 'refuse', 'counter'].includes(ev.result) && ev.factors.length > 0, `évaluation de la paix par l'adversaire : ${ev.result} (${ev.factors.length} facteurs)`);
  const restore = { ...t, kind: 'treaty', territory: 'restore', reparations: 0, payer: -1, proposer: w.a[0], war: w.id };
  const lost = (e) => { let c = 0; for (let i = 0; i < sim.n; i++) if (world.owner[i] === e && sim.owner[i] !== e) c++; return c; };
  const be = sim.sides[w.b[0]].e;
  const l0 = lost(be);
  m.applyPeace(sim, w, restore, m.endWar);
  step(sim, sim.time + 30);
  ok(l0 === 0 || lost(be) < l0, `frontières d'avant-guerre : Belgique ${l0} parcelle(s) occupée(s) -> ${lost(be)} après le traité`);
}

// 11. sauvegarde / reprise exacte avec règles et mémoire diplomatique
{
  const opts = { seed: 'SVR', rules: { alliances: false, randomEvents: false }, maxDuration: 1e9 };
  const a = mk(['FR', 'DE', 'IT'], opts);
  step(a, 70);
  m.noteProposal(a, 0, 1, 'peace', 'refuse', { adv: 0.1 });
  const snap = JSON.parse(JSON.stringify(a.serialize()));
  const b = mk(['FR', 'DE', 'IT'], opts, snap);
  step(a, 140); step(b, 140);
  const same = a.owner.every((v, i) => v === b.owner[i]) && a.rng.state === b.rng.state && JSON.stringify(a.dmem) === JSON.stringify(b.dmem) && JSON.stringify(a.rules) === JSON.stringify(b.rules);
  ok(same, `sauvegarde/reprise : règles (${Object.values(b.rules).filter((v) => v === false).length} désactivées) et mémoire diplomatique identiques`);
}

// 12. scénario créé par le joueur : objectifs, situation de départ, règles imposées
{
  const spec = { id: 'scenario-test', title: 'Test', country: 'FR', years: 5, cats: ['economy'], start: { debt: 150, money: null, gdp: -10, stability: 0, infra: 0, rival: 'DE', rivalRel: -60, war: true }, objectives: [{ type: 'gdp', value: 1.2 }, { type: 'debt', value: 90, optional: true }], rules: { wars: false } };
  const sc = m.scenarioFromSpec(spec);
  ok(sc.objectives.length === 2 && sc.objectives[1].optional && m.findScenario(spec.id, spec).title === 'Test', `scénario personnalisé : ${sc.objectives.length} objectifs (${sc.objectives.map((o) => o.text).join(' ; ')})`);
  const ids = world.entities.filter((e) => e.kind === 'country' && grid.n && world.owner.includes(e.index)).map((e) => e.id).filter((id) => EU.includes(id) || id === 'FR');
  const st = { participants: ids.map((id, k) => ({ e: idx(id), team: k })), teams: ids.map((n) => ({ name: n })), options: { seed: 'SC', warStart: 'tensions', maxDuration: 1e9, peaceEnd: 1e9, nation: { player: ids.indexOf('FR'), scenario: spec.id, scenarioSpec: spec }, mode: 'story' } };
  const sim = new m.WorldSim(grid, nav, world, st, null, { geo, details });
  const k = sim.nation.player;
  ok(sim.rules.wars === false && sim.wars.length === 0, 'scénario personnalisé : les règles imposées s\'appliquent (guerres désactivées : le rival n\'attaque pas)');
  ok(Math.abs(sim.sides[k].debt / sim.sides[k].eco.gdp - 1.5) < 0.05, `scénario personnalisé : dette de départ ${(sim.sides[k].debt / sim.sides[k].eco.gdp * 100).toFixed(0)} % du PIB`);
}

// 13. détails de la carte : villes, régions, ports, lacs
{
  let land = 0, withReg = 0;
  for (let i = 0; i < grid.n; i++) if (world.owner[i] > 0 || grid.land?.[i]) { if (world.entities[world.owner[i]] && world.entities[world.owner[i]].kind === 'country') { land++; if (details.regionOf[i] >= 0) withReg++; } }
  const paris = details.cities.find((c) => c.name === 'Paris');
  ok(details.cities.length > 2000 && details.regions.length > 500 && details.ports.length > 300 && details.lakes.length > 100, `détails : ${details.cities.length} villes, ${details.regions.length} régions, ${details.ports.length} ports, ${details.lakes.length} lacs`);
  ok(paris && paris.cap && world.entities[paris.e].id === 'FR', 'détails : Paris est la capitale de la France');
  ok(withReg / Math.max(1, land) > 0.95, `détails : ${(withReg / land * 100).toFixed(1)} % des parcelles des pays rattachées à une région`);
  const fr = details.regions.filter((r) => world.entities[r.e] && world.entities[r.e].id === 'FR');
  ok(fr.length >= 8, `détails : ${fr.length} régions françaises (${fr.slice(0, 5).map((r) => r.name).join(', ')}…)`);
}

// 14. Story Mode : tous les scénarios démarrent, leurs pays existent, objectifs/échecs/événements fonctionnent
{
  const cells = new Map(); for (let i = 0; i < grid.n; i++) cells.set(world.owner[i], (cells.get(world.owner[i]) || 0) + 1);
  const ents = world.entities.filter((e) => e.kind !== 'neutral' && cells.get(e.index) > 0);
  const ids = new Set(ents.map((e) => e.id));
  const all = m.ALL_SCENARIOS;
  let bad = [], evs = 0, secret = 0, mains = 0;
  const t0 = Date.now();
  for (const sc of all) {
    const sp = sc.spec || {}, s0 = sp.start || {};
    const refs = [sc.country, s0.rival, ...(s0.allies || []), ...(s0.hostile || []), ...Object.keys(s0.personalities || {}), ...(s0.aiWars || []).flat(), ...(s0.blocs || []).flat().filter((x) => x !== '@'),
      ...(sp.objectives || []).map((o) => o.target), ...(sp.events || []).flatMap((e) => [e.war, ...Object.keys(e.rel || {})])].filter(Boolean);
    const miss = refs.filter((x) => !ids.has(x));
    if (miss.length) { bad.push(`${sc.id}: pays ${miss.join(',')}`); continue; }
    try {
      const st = { participants: ents.map((e, k) => ({ e: e.index, team: k })), teams: ents.map((e) => ({ name: e.name })), options: { seed: 'SC-' + sc.id, warStart: 'tensions', maxDuration: 1e9, peaceEnd: 1e9, maxAgents: 500, nation: { player: ents.findIndex((e) => e.id === sc.country), scenario: sc.id }, mode: 'story' } };
      const sim = new m.WorldSim(grid, nav, world, st, null, { geo });
      for (const o of sc.objectives) { if (['peace', 'survive', 'territory'].includes(((sc.spec || {}).objectives || [])[Number(o.id.slice(1))]?.type)) continue; const r = o.check(sim, sim.nation.player, sim.nation, sim.nation.scenario); if (r.done) bad.push(`${sc.id}: objectif déjà atteint au départ (${o.text})`); }
      for (let i = 0; i < 200; i++) { sim.step(); sim.captures.length = 0; sim.eventsOut.length = 0; }
      // on avance le temps du scénario pour déclencher tous les événements et vérifier les objectifs
      const n = sim.nation;
      n.scenario.start = -sc.years * m.YEAR_SEC * 0.6;
      n._scenarioCheck();
      evs += Object.keys(n.scenario.ev || {}).length;
      for (const o of sc.objectives) { const r = o.check(sim, n.player, n, n.scenario); if (!r || typeof r.progress !== 'number' || Number.isNaN(r.progress)) bad.push(`${sc.id}: objectif ${o.id}`); }
      secret += sc.objectives.filter((o) => o.secret).length; mains += sc.objectives.some((o) => o.main) ? 1 : 0;
    } catch (e) { bad.push(`${sc.id}: ${e.message}`); }
  }
  ok(all.length >= 45 && bad.length === 0, `Story Mode : ${all.length} scénarios, ${mains} avec objectif principal, ${secret} objectifs secrets, ${evs} événements déclenchés en ${((Date.now() - t0) / 1000).toFixed(0)} s${bad.length ? ' — ' + bad.join(' ; ') : ''}`);
}

// 15. difficultés : complexité croissante (nombre de systèmes actifs), aucune règle de bonus
{
  const on = m.DIFFICULTIES.map((d) => Object.values(m.resolveRules({ mode: 'nation', rules: d.rules })).filter((v) => v !== false).length);
  const inc = on.every((v, i) => i === 0 || v >= on[i - 1]);
  ok(m.DIFFICULTIES.length === 5 && inc && on[0] < on[4], `difficultés : ${m.DIFFICULTIES.map((d, i) => `${d.label} ${on[i]}`).join(', ')} systèmes actifs`);
}

// 16. logistique et IA avancée désactivées : effets réels
{
  const a = mk(['FR', 'DE'], { rules: { logistics: false }, maxDuration: 1e9 });
  a.sides[0].heldForeign = 400;
  const cell = (() => { for (let i = 0; i < a.n; i++) if (a.origin[i] !== a.sides[0].e && a.owner[i] !== a.sides[0].e) return i; return -1; })();
  const b = mk(['FR', 'DE'], { maxDuration: 1e9 });
  b.sides[0].heldForeign = 400;
  ok(a.supply(0, cell) === 1 && b.supply(0, cell) < 1, `logistique : ravitaillement ${a.supply(0, cell).toFixed(2)} (désactivée) / ${b.supply(0, cell).toFixed(2)} (active)`);
  const c = mk(EU, { rules: { aiAdvanced: false }, warStart: 'tensions', maxDuration: 1e9 });
  const d0 = JSON.stringify(c.sides.map((s) => s.doctrine || null));
  step(c, 200);
  const d1 = mk(EU, { warStart: 'tensions', maxDuration: 1e9 }); const e0 = JSON.stringify(d1.sides.map((s) => s.doctrine || null)); step(d1, 200);
  ok(JSON.stringify(c.sides.map((s) => s.doctrine || null)) === d0 && JSON.stringify(d1.sides.map((s) => s.doctrine || null)) !== e0, 'IA avancée : doctrine figée quand elle est désactivée, adaptée quand elle est active');
}

// 17. traité de paix : annexion PRÉCISE des régions choisies par le joueur
{
  const ids = EU;
  const st = { participants: ids.map((id, k) => ({ e: idx(id), team: k, ...(id === 'FR' ? { powerMult: 1.8 } : {}) })), teams: ids.map((n) => ({ name: n })), options: { seed: 'CLAIM', warStart: 'tensions', aiWars: false, maxDuration: 1e9, peaceEnd: 1e9, maxAgents: 600, warEnd: { territorial: 'complete', percent: 1, economic: false, peace: true, capitulation: false }, nation: { player: ids.indexOf('FR') }, mode: 'nation' } };
  const sim = new m.WorldSim(grid, nav, world, st, null, { geo, details });
  const n = sim.nation, p = n.player, de = ids.indexOf('DE');
  n.declareWar(de);
  let w = null;
  step(sim, 200, (s) => { if (!w && s.tickCount % 20 === 0) { const ww = n.warWith(p, de); if (ww && m.claimableRegions(s, ww, p).filter((x) => x.occupied >= 0.5).length >= 3) w = ww; } return w; });
  w = w || n.warWith(p, de);
  const regs = m.claimableRegions(sim, w, p);
  const won = regs.filter((x) => x.occupied >= 0.5), held = regs.filter((x) => x.occupied < 0.01);
  const claims = [...won.slice(0, 2).map((x) => x.id), ...held.slice(0, 1).map((x) => x.id)];
  const terms = { ...m.makePeaceTerms(sim, w, p), kind: 'treaty', territory: 'custom', claimant: p, claims, proposer: p, war: w.id, reparations: 0, payer: -1 };
  const desc = m.describeTerms(sim, w, terms, p);
  const ev = m.evaluatePeace(sim, w, de, terms);
  const occupiedBefore = [...w.changes.keys()].filter((c) => sim.owner[c] === sim.sides[p].e && world.owner[c] === sim.sides[de].e).length;
  m.applyPeace(sim, w, terms, m.endWar);
  step(sim, sim.time + 60, () => w.status === 'ended');
  console.log('   état de la guerre après la paix :', w.status, w.endReason);
  const rc = m.regionCells(sim), claimed = new Set(claims.flatMap((id) => rc.get(id) || []));
  const FRe = sim.sides[p].e, DEe = sim.sides[de].e;
  let inClaimFR = 0, inClaim = 0, outsideFR = 0;
  for (let c = 0; c < grid.n; c++) {
    if (world.owner[c] !== DEe) continue;
    if (claimed.has(c)) { inClaim++; if (sim.owner[c] === FRe) inClaimFR++; } else if (sim.owner[c] === FRe) outsideFR++;
  }
  ok(regs.length > 5 && claims.length >= 2 && desc.proposed[0].includes('annexez'), `régions revendicables : ${regs.length} (dont ${won.length} conquises) ; conditions : « ${desc.proposed[0].slice(0, 90)} »`);
  ok(['accept', 'refuse', 'counter'].includes(ev.result) && ev.factors.some((f) => f.label.startsWith('Régions revendiquées')), `évaluation par l'IA : ${ev.result} (${ev.factors.map((f) => f.label).slice(0, 3).join(' ; ')})`);
  ok(inClaim > 0 && inClaimFR / inClaim > 0.9 && outsideFR <= Math.max(2, occupiedBefore * 0.05), `après le traité : ${inClaimFR}/${inClaim} parcelles des régions choisies françaises (dont une région non conquise), ${outsideFR} parcelle(s) française(s) hors des régions choisies (sur ${occupiedBefore} occupées avant)`);
}
