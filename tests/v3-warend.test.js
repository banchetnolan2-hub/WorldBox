// Tests de la FIN DES GUERRES : paix automatique OFF (mode Nation), propositions de capitulation,
// guerre poursuivie au-delà de 70/90 %, cessions/restitutions, objectifs de guerre, durée maximale.
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
const ids = ['CN', 'NP', 'IN', 'BD', 'PK', 'BT'];
const mk = (opts = {}, restore = null) => new m.WorldSim(grid, nav, world, { participants: ids.map((id, k) => ({ e: idx(id), team: k })), teams: ids.map((n) => ({ name: n })), options: { seed: 'WEND', warStart: 'tensions', aiWars: false, maxDuration: 1e9, peaceEnd: 1e9, ...opts } }, restore, { geo, details });
const step = (sim, t) => { while (!sim.finished && sim.time < t) { sim.step(); sim.captures.length = 0; sim.eventsOut.length = 0; } return sim; };
// combats gelés : le test contrôle seul l'occupation
const freeze = (sim) => { sim._attempt = () => false; sim.step(); sim.captures.length = 0; sim.eventsOut.length = 0; return sim; };
const occupy = (sim, from, to, share) => {
  const fe = sim.sides[from].e, te = sim.sides[to].e;
  const cells = []; for (let i = 0; i < sim.n; i++) if (sim.owner[i] === fe) cells.push(i);
  const cap = sim.sides[from].capital;
  cells.sort((a, b) => (a === cap) - (b === cap) || a - b);   // la capitale tombe en dernier
  const n = Math.floor(cells.length * share);
  for (let k = 0; k < n; k++) sim.flip(cells[k], te);
  return n;
};
const CN = ids.indexOf('CN'), NP = ids.indexOf('NP'), IN = ids.indexOf('IN'), BD = ids.indexOf('BD');
// événements aléatoires coupés : les combats sont gelés et le test contrôle seul l'occupation ; un événement
// « perte temporaire de territoire » tiré au hasard fausserait les pourcentages mesurés (isolation du test)
const nationOpts = { rules: { randomEvents: false }, nation: { player: CN }, mode: 'nation', warEnd: { territorial: 'percent', percent: 0.65, economic: true, peace: true, capitulation: true } };

// 1. mode Nation : paix automatique OFF par défaut, la guerre continue après 70 %, 90 %
{
  const sim = mk(nationOpts);
  ok(sim.cfg.warEnd.autoPeace === false, 'mode Nation : « Paix automatique » OFF par défaut (même avec une ancienne configuration)');
  step(sim, 3);
  sim.nation.decision = null; sim.nation.nextDecisionAt = 1e9;
  sim.nation.declareWar(NP);
  freeze(sim);
  const w = sim.nation.warWith(CN, NP);
  ok(!!w && w.goals && w.goals.a.capital, `objectifs de guerre initiaux : capitale + ${w.goals.a.regions.length} région(s)`);
  occupy(sim, NP, CN, 0.75);
  step(sim, sim.time + 40);
  ok(w.status === 'active' && w.losses[NP] > 0.7, `75 % du Népal conquis : la guerre continue (pertes du Népal ${Math.round(w.losses[NP] * 100)} %, camp : ${w.b.map((k) => sim.sides[k].name).join(', ')})`);
  const off = sim.nation.offers.find((o) => o.type === 'surrender' && o.from === NP);
  ok(!!off, `proposition reçue : « ${off ? off.text.slice(0, 110) : '—'}… »`);
  ok(w.risk && w.risk.b > w.risk.a, `risque de capitulation suivi : Népal ${Math.round(w.risk.b * 100)} %, Chine ${Math.round(w.risk.a * 100)} %`);
  if (off) sim.nation.answerOffer(off.id, false);
  ok(w.status === 'active', 'capitulation refusée : la guerre continue');
  occupy(sim, NP, CN, 0.8);    // 95 % au total environ
  step(sim, sim.time + 80);
  ok(w.status === 'active' && w.losses[NP] > 0.9, `au-delà de 90 % (${Math.round(w.losses[NP] * 100)} %) : toujours aucune paix automatique`);
  ok(sim.sides[NP].revoltRisk > 0 && sim.sides[NP].lostShare > 0.8, `pertes territoriales : risque de révolte ${Math.round(sim.sides[NP].revoltRisk * 100)} %, stabilité ${Math.round(sim.sides[NP].stability * 100)} %`);
  // le joueur propose ses conditions : annexion de 2 régions seulement, le reste restitué
  const regs = m.claimableRegions(sim, w, CN).filter((x) => x.occupied > 0.5).slice(0, 2).map((x) => x.id);
  const before = sim.sides[NP].cells;
  const r = sim.nation.propose(NP, 'peace', { terms: { kind: 'treaty', territory: 'custom', claimant: CN, claims: regs, reparations: 0, payer: -1, truceYears: 4 } });
  ok(r.result === 'accept', `paix proposée par le joueur (2 régions annexées, restitution du reste) : ${r.result}`);
  step(sim, sim.time + 10);
  ok(w.status === 'ended' && sim.sides[NP].cells > before, `traité appliqué : le Népal récupère ${sim.sides[NP].cells - before} parcelles`);
}
// 2. accepter une capitulation offerte
{
  const sim = mk(nationOpts);
  step(sim, 3);
  sim.nation.decision = null; sim.nation.nextDecisionAt = 1e9;
  sim.nation.declareWar(NP);
  freeze(sim);
  const w = sim.nation.warWith(CN, NP);
  occupy(sim, NP, CN, 0.8);
  step(sim, sim.time + 40);
  const off = sim.nation.offers.find((o) => o.type === 'surrender');
  if (off) sim.nation.answerOffer(off.id, true);
  step(sim, sim.time + 10);
  const out = w.status === 'ended' ? w.endReason === 'capitulation' : !w.b.includes(NP) && !sim.atWar[CN * sim.S + NP];
  ok(!!off && out, `capitulation acceptée : ${w.status === 'ended' ? 'guerre terminée (' + w.endReason + ')' : 'le Népal capitule séparément, ses alliés continuent'} ; Népal : ${sim.sides[NP].cells} parcelles`);
}
// 3. le joueur perdant peut refuser la capitulation exigée
{
  const sim = mk({ ...nationOpts, nation: { player: NP } });
  step(sim, 3);
  sim.nation.decision = null; sim.nation.nextDecisionAt = 1e9;
  const w = m.startWar(sim, [CN], [NP], 'declaration'); freeze(sim);
  occupy(sim, NP, CN, 0.8);
  step(sim, sim.time + 40);
  const dem = sim.nation.offers.find((o) => o.type === 'peace' && o.terms.capitulation);
  ok(!!dem, `capitulation exigée par la Chine : « ${dem ? dem.text.slice(0, 90) : '—'}… »`);
  if (dem) sim.nation.answerOffer(dem.id, false);
  ok(w.status === 'active', 'le joueur refuse de capituler : la guerre continue');
}
// 4. entre IA (paix automatique OFF) : jamais de fin « 65 % du territoire »
{
  const sim = mk(nationOpts);
  step(sim, 3);
  sim.nation.decision = null; sim.nation.nextDecisionAt = 1e9;
  const w = m.startWar(sim, [IN], [BD], 'declaration'); freeze(sim);
  occupy(sim, BD, IN, 0.75);
  step(sim, sim.time + 60);
  ok(w.endReason !== 'percent', `guerre entre IA : pas de victoire territoriale automatique (${w.status}${w.endReason ? ', ' + w.endReason : ''})`);
}
// 5. Bac à sable, paix automatique ON : comportement classique conservé
{
  const sim = mk({ warEnd: { territorial: 'percent', percent: 0.65, economic: true, peace: true, capitulation: true } });
  ok(sim.cfg.warEnd.autoPeace === true, 'Bac à sable : paix automatique ON par défaut');
  step(sim, 3);
  const w = m.startWar(sim, [IN], [BD], 'declaration'); freeze(sim);
  occupy(sim, BD, IN, 0.75);
  step(sim, sim.time + 10);
  ok(w.status !== 'active' && w.endReason === 'percent', `paix automatique : fin à 65 % (${w.endReason})`);
}
// 6. durée maximale (choisie par le joueur) : armistice
{
  const sim = mk({ ...nationOpts, warEnd: { ...m.NATION_WAR_END, maxYears: 1 } });
  step(sim, 3);
  sim.nation.decision = null; sim.nation.nextDecisionAt = 1e9;
  sim.nation.declareWar(NP);
  freeze(sim);
  const w = sim.nation.warWith(CN, NP);
  step(sim, sim.time + m.YEAR_SEC + 5);
  ok(w.status === 'ended' && w.endReason === 'duration', `durée maximale d'un an : armistice (${w.endReason})`);
}
// 7. conquête totale autorisée : la guerre va jusqu'au bout ; sauvegarde des réglages
{
  const sim = mk({ ...nationOpts, warEnd: { ...m.NO_AUTO_END } });
  step(sim, 3);
  sim.nation.decision = null; sim.nation.nextDecisionAt = 1e9;
  sim.nation.declareWar(NP);
  freeze(sim);
  const w = sim.nation.warWith(CN, NP);
  occupy(sim, NP, CN, 0.9);
  step(sim, sim.time + 30);
  ok(w.status === 'active' && !sim.nation.offers.some((o) => o.type === 'surrender'), 'aucune fin automatique : ni paix, ni proposition imposée à 90 %');
  sim.nation.setWarGoals(NP, [], true);
  const st = JSON.parse(JSON.stringify(sim.serialize()));
  const sim2 = mk({ ...nationOpts }, st);
  const w2 = sim2.wars.find((x) => x.id === w.id);
  ok(sim2.cfg.warEnd.capitulation === false && w2 && w2.goals.a.custom, 'réglages de fin des guerres et objectifs conservés dans la sauvegarde');
  occupy(sim, NP, CN, 1);
  step(sim, sim.time + 10);
  ok(sim.sides[NP].eliminated && (w.status !== 'ended' || w.endReason === 'complete'), `conquête totale possible : Népal entièrement conquis (${w.status === 'ended' ? w.endReason : 'ses alliés poursuivent la guerre'})`);
}
// 8. objectifs de guerre du joueur atteints : proposition, pas de fin imposée
{
  const sim = mk(nationOpts);
  step(sim, 3);
  sim.nation.decision = null; sim.nation.nextDecisionAt = 1e9;
  sim.nation.declareWar(NP);
  freeze(sim);
  const w = sim.nation.warWith(CN, NP);
  const regs = m.claimableRegions(sim, w, CN).slice(0, 2);
  sim.nation.setWarGoals(NP, regs.map((x) => x.id), false);
  const rc = m.regionCells(sim);
  for (const x of regs) for (const c of rc.get(x.id)) if (sim.owner[c] === sim.sides[NP].e) sim.flip(c, sim.sides[CN].e);
  step(sim, sim.time + 40);
  const off = sim.nation.offers.find((o) => o.type === 'surrender' && o.terms.reason === 'objectives');
  ok(w.status === 'active' && !!off, `objectifs atteints (${regs.map((x) => x.name).join(', ')}) : proposition « ${off ? off.text.slice(0, 70) : '—'}… », guerre toujours en cours`);
  ok(off && regs.every((x) => off.terms.terms.claims.includes(x.id)), 'les conditions proposées reprennent les régions visées');
}
