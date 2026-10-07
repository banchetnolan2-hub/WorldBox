// Tests des COALITIONS : formation face à un agresseur, chef, intérêts différents, entrée en guerre des
// membres, offensives coordonnées, départs et paix séparée, défense mutuelle, évolution, joueur, sauvegarde.
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
const IDS = ['RU', 'UA', 'PL', 'RO', 'LT', 'LV', 'EE', 'FI', 'DE', 'SK', 'HU', 'MD', 'BY', 'KZ', 'GE'];
const mk = (opts = {}, restore = null, ids = IDS, extra = {}) => new m.WorldSim(grid, nav, world, { participants: ids.map((id, k) => ({ e: idx(id), team: k, ...(id === 'RU' ? { powerMult: 1.3 } : {}) })), teams: ids.map((n) => ({ name: n })), options: { seed: 'COAL', warStart: 'tensions', aiWars: false, maxDuration: 1e9, peaceEnd: 1e9, ...opts }, ...extra }, restore, { geo, details });
const step = (sim, t, each) => { while (!sim.finished && sim.time < t) { sim.step(); sim.captures.length = 0; sim.eventsOut.length = 0; if (each && each(sim)) break; } return sim; };

// 1. agression : une coalition se forme, plusieurs membres aux intérêts différents entrent en guerre
{
  const sim = mk();
  step(sim, 20);
  const w = m.startWar(sim, [0], [1], 'declaration');
  let joinedWar = 0, ops = 0;
  step(sim, 130, (s) => { const c = m.coalitionsAgainst(s, 0)[0]; if (c) { joinedWar = Math.max(joinedWar, w.b.length); ops += c.history.filter((h) => h.kind === 'op').length > 0 ? 1 : 0; } });
  const c = m.coalitions(sim).find((x) => x.target === 0);
  ok(!!c, `agression de la Russie : coalition formée (« ${c ? c.name : '—'} », chef ${c ? sim.sides[c.leader].name : '—'})`);
  ok(c && c.members.length >= 3, `membres : ${c ? c.members.map((x) => `${sim.sides[x.k].name} (${m.INTERESTS[x.interest].label})`).join(', ') : '—'}`);
  ok(joinedWar >= 3, `coordination : ${joinedWar} pays engagés dans la guerre aux côtés de l'Ukraine`);
  ok(c && c.history.some((h) => h.kind === 'op'), 'offensive coordonnée lancée par le chef de la coalition');
  ok(c && c.history.length >= 4, `évolution de la coalition : ${c ? c.history.length : 0} étapes enregistrées`);
}
// 2. défense mutuelle (endiguement) : une attaque contre un membre engage les autres
{
  const sim = mk({}, null, ['RU', 'EE', 'LV', 'LT', 'PL', 'FI']);
  step(sim, 10);
  const c = m.createCoalition(sim, 4, 0, { goal: 'contain', members: [1, 2, 3, 5] });
  ok(c && c.members.length === 5 && c.kind === 'containment', `pacte d'endiguement : ${c ? c.members.length : 0} membres`);
  const w = m.startWar(sim, [0], [1], 'declaration');
  ok(w.b.length >= 3 && c.goal === 'defeat', `la Russie attaque l'Estonie : ${w.b.length} pays défendent l'Estonie, objectif « ${m.GOALS[c.goal].label} »`);
  // départ d'un membre en guerre : paix séparée (statu quo pour lui)
  const k = w.b.find((x) => x !== 1);
  const before = sim.atWar[k * sim.S + 0];
  m.leaveCoalition(sim, c, k, 'test', true);
  ok(before > 0 && sim.atWar[k * sim.S + 0] === 0 && !w.b.includes(k) && !m.memberOf(c, k), `paix séparée de ${sim.sides[k].name} : sort de la guerre et de la coalition`);
  // chef : succession si le chef quitte
  const lead = c.leader;
  m.leaveCoalition(sim, c, lead, 'test', false);
  ok(c.leader !== lead && m.memberOf(c, c.leader), `nouveau chef : ${sim.sides[c.leader].name}`);
}
// 3. joueur (Nation Simulator) : former une coalition, inviter (réponse argumentée de l'IA), offensive, quitter
{
  const ids = ['PL', 'RU', 'LT', 'LV', 'EE', 'FI', 'UA', 'DE'];
  const sim = mk({ nation: { player: 0 }, mode: 'nation' }, null, ids);
  const n = sim.nation;
  step(sim, 10);
  const r = n.formCoalition(1, 'contain');
  ok(r.ok && r.coalition.leader === 0, `le joueur fonde « ${r.coalition ? r.coalition.name : '—'} »`);
  const res = [2, 3, 4, 5, 7].map((k) => n.inviteToCoalition(r.coalition.id, k));
  ok(res.every((x) => ['accept', 'refuse'].includes(x.result) && x.factors.length > 0), `invitations : ${res.map((x) => x.result).join(', ')} (analyse : ${res[0].factors.slice(0, 2).map((f) => f.label).join(' ; ')})`);
  ok(res.some((x) => x.result === 'accept'), `au moins un pays accepte (${r.coalition.members.length} membres)`);
  const w = m.startWar(sim, [1], [2], 'declaration');
  step(sim, sim.time + 3);
  const off = n.coalitionOffensive(r.coalition.id);
  ok(off.ok || /deux membres/.test(off.text), `offensive coordonnée ordonnée par le joueur : ${off.ok ? 'lancée' : off.text}`);
  ok(n.leaveCoalitionP(r.coalition.id) && !m.memberOf(r.coalition, 0), 'le joueur peut quitter la coalition');
  void w;
}
// 4. règles : coalitions désactivées -> aucune coalition
{
  const sim = mk({ rules: { coalitions: false } });
  step(sim, 20);
  m.startWar(sim, [0], [1], 'declaration');
  step(sim, 100);
  ok(m.coalitions(sim).length === 0, 'règle « Coalitions » désactivée : aucune coalition');
}
// 5. sauvegarde : coalitions et effets identiques après reprise
{
  const a = mk();
  step(a, 20); m.startWar(a, [0], [1], 'declaration'); step(a, 70);
  const snap = JSON.parse(JSON.stringify(a.serialize()));
  const b = mk({}, snap);
  step(a, 140); step(b, 140);
  ok(JSON.stringify(m.coalitions(a)) === JSON.stringify(m.coalitions(b)) && a.owner.every((v, i) => v === b.owner[i]), `sauvegarde/reprise : ${m.coalitions(a).length} coalition(s) identiques`);
}
