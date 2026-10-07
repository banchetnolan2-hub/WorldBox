// Tests du MULTIJOUEUR : deux simulations reliées (hôte + invité), ordres des deux joueurs, diplomatie
// entre humains, arrivée en cours de partie, empreintes identiques (aucune désynchronisation).
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
const ids = ['FR', 'DE', 'IT', 'ES', 'PL', 'BE', 'NL', 'CH', 'AT', 'GB', 'PT', 'CZ'];
const K = (id) => ids.indexOf(id);
const setup = { participants: ids.map((id, k) => ({ e: idx(id), team: k })), teams: ids.map((n) => ({ name: n })), options: { seed: 'MULTI', warStart: 'tensions', aiWars: true, maxDuration: 1e9, peaceEnd: 1e9, maxAgents: 600, nation: { player: K('FR') }, mode: 'nation' } };
const mk = (restore = null) => new m.WorldSim(grid, nav, world, JSON.parse(JSON.stringify(setup)), restore, { geo, details });

// une « machine » : simulation + rôle réseau
function machine(role, name) {
  const M = { sim: null, name, events: [], paused: false, speed: 1 };
  M.net = new m.NetGame(role, {
    sim: () => M.sim,
    exec: (cmd) => m.execCommand(M.sim, cmd),
    snapshot: async () => ({ sim: JSON.parse(JSON.stringify(M.sim.serialize())) }),
    load: async (d, side) => { M.sim = mk(d.sim); M.sim.localSide = side; },
    event: (type, p) => { M.events.push({ type, ...p }); if (type === 'lobby') M.lobby = p; },
    setPaused: (b) => { M.paused = b; }, setSpeed: (s) => { M.speed = s; }, paused: () => M.paused, speed: () => M.speed, localName: () => name,
  });
  M.act = (cmd) => { if (cmd.a === undefined) cmd.a = M.sim.localSide ?? M.sim.nation.player; return M.net.submit(JSON.parse(JSON.stringify(cmd))); };
  return M;
}
const flush = async (pump) => { for (let i = 0; i < 6; i++) { pump(); await new Promise((r) => setImmediate(r)); } };
// avance : l'hôte fait `n` pas, l'invité suit
async function run(H, G, pump, n) {
  for (let i = 0; i < n; i++) {
    const b = H.net.budget(H.sim, 1);
    if (b) { H.sim.step(); H.sim.captures.length = 0; H.sim.eventsOut.length = 0; H.net.afterStep(H.sim); }
    H.net.afterFrame(H.sim);
    if (i % 5 === 0 || i === n - 1) {
      await flush(pump);
      if (G.sim && G.net.loaded) {
        const s = G.net.budget(G.sim, 0);
        for (let k = 0; k < s; k++) { G.net.beforeStep(G.sim); G.sim.step(); G.sim.captures.length = 0; G.sim.eventsOut.length = 0; G.net.afterStep(G.sim); }
        G.net.afterFrame(G.sim);
        await flush(pump);
      }
    }
  }
}

(async () => {
  const H = machine('host', 'Nolan'), G = machine('guest', 'Alex');
  H.sim = mk();
  const { a, b, pump } = m.memoryPair();
  H.net.addLink(a);
  G.net.connect(b);
  await flush(pump);
  ok(!!G.lobby && G.lobby.countries.length >= 10, `salon reçu par l'invité : ${G.lobby ? G.lobby.countries.length : 0} pays, hôte « ${G.lobby && G.lobby.host} »`);
  // un peu de partie avant l'arrivée de l'invité
  await run(H, G, pump, 120);
  H.act({ op: 'policy', patch: { tax: 1.1, milPct: 2.6 }, text: 'test' });
  G.net.pick(K('DE'));
  await flush(pump);
  ok(G.net.loaded && G.sim && G.sim.localSide === K('DE') && G.sim.nation.isHuman(K('DE')), 'l\'invité rejoint en cours de partie et dirige l\'Allemagne');
  ok(H.sim.nation.isHuman(K('DE')) && H.sim.nation.humanList().length === 2, 'deux joueurs humains dans la simulation de l\'hôte');
  ok(G.sim.tickCount === H.sim.tickCount && m.stateHash(G.sim) === m.stateHash(H.sim), `état identique à l'arrivée (pas ${G.sim.tickCount})`);
  // ordres des deux joueurs pendant la partie
  await run(H, G, pump, 60);
  const proj = (sim, k) => { const n = sim.nation; return m.DEV_TREE.find((x) => n.canStart(k, x.id)); };
  const pDE = proj(G.sim, K('DE'));
  G.act({ op: 'n', m: 'startProject', args: [K('DE'), pDE.id] });
  G.act({ op: 'policy', patch: { services: 1.15, stance: 'offensive' }, text: 'Posture' });
  G.act({ op: 'n', m: 'propose', args: [K('PL'), 'gift', { amount: 1 }] });
  H.act({ op: 'n', m: 'propose', args: [K('IT'), 'trade', {}] });
  // diplomatie entre humains : l'hôte propose un accord commercial à l'invité, qui accepte
  H.act({ op: 'n', m: 'propose', args: [K('DE'), 'trade', {}] });
  await run(H, G, pump, 30);
  const offer = G.sim.nation.at(K('DE')).offers.find((o) => o.from === K('FR') && o.type === 'trade');
  ok(!!offer && offer.terms.human, `l'invité reçoit la proposition du joueur hôte : « ${offer ? offer.text : '—'} »`);
  ok(H.sim.sides[K('DE')].dev.active[pDE.branch] && H.sim.sides[K('DE')].stance === 'offensive', 'les ordres de l\'invité s\'appliquent chez l\'hôte (projet, posture)');
  if (offer) G.act({ op: 'n', m: 'answerOffer', args: [offer.id, true] });
  await run(H, G, pump, 30);
  ok(!!(H.sim.nation.deal(K('FR'), K('DE')) || {}).trade && !!(G.sim.nation.deal(K('FR'), K('DE')) || {}).trade, 'accord commercial entre les deux joueurs, appliqué chez les deux');
  // guerre entre joueurs puis paix proposée par l'invité, acceptée par l'hôte
  H.act({ op: 'n', m: 'declareWar', args: [K('DE')] });
  await run(H, G, pump, 400);
  ok(H.sim.atWar[K('FR') * H.sim.S + K('DE')] > 0 && G.sim.atWar[K('FR') * G.sim.S + K('DE')] > 0, 'guerre entre les deux joueurs, chez les deux');
  G.act({ op: 'n', m: 'propose', args: [K('FR'), 'peace', { terms: { kind: 'ceasefire', territory: 'keep', reparations: 0, payer: -1, truceYears: 2 } }] });
  await run(H, G, pump, 10);
  const po = H.sim.nation.offers.find((o) => o.type === 'peace' && o.from === K('DE'));
  ok(!!po, 'l\'hôte reçoit la proposition de paix du joueur invité (pas de réponse automatique de l\'IA)');
  if (po) H.act({ op: 'n', m: 'answerOffer', args: [po.id, true] });
  await run(H, G, pump, 200);
  ok(!H.sim.atWar[K('FR') * H.sim.S + K('DE')] && !G.sim.atWar[K('FR') * G.sim.S + K('DE')], 'paix signée entre les deux joueurs');
  // longue partie : vérifications d'empreinte régulières
  await run(H, G, pump, 1500);
  const desync = H.events.filter((e) => e.type === 'desync').length + G.events.filter((e) => e.type === 'resynced').length;
  ok(desync === 0, `aucune désynchronisation sur ${H.sim.tickCount} pas (${Math.floor(H.sim.tickCount / m.HASH_EVERY || 0)} contrôles)`);
  const s = G.net.budget(G.sim, 0); for (let k = 0; k < s; k++) { G.net.beforeStep(G.sim); G.sim.step(); G.net.afterStep(G.sim); }
  ok(G.sim.tickCount === H.sim.tickCount && m.stateHash(G.sim) === m.stateHash(H.sim), `états identiques au pas ${H.sim.tickCount} : ${m.stateHash(H.sim).toString(16)}`);
  ok(JSON.stringify(G.sim.sides.map((x) => x.cells)) === JSON.stringify(H.sim.sides.map((x) => x.cells)), 'mêmes territoires pour tous les pays');
  // messagerie
  G.net.sendChat('Bonjour !');
  await flush(pump);
  ok(H.net.chat.some((c) => c.text === 'Bonjour !' && c.from === 'Alex'), 'messagerie entre joueurs');
  // désynchronisation forcée : détectée et corrigée
  G.sim.sides[K('IT')].money += 50;
  await run(H, G, pump, m.HASH_EVERY + 20);
  await run(H, G, pump, 40);
  const fixed = H.events.some((e) => e.type === 'desync') && G.events.some((e) => e.type === 'resynced');
  const s2 = G.net.budget(G.sim, 0); for (let k = 0; k < s2; k++) { G.net.beforeStep(G.sim); G.sim.step(); G.net.afterStep(G.sim); }
  ok(fixed && m.stateHash(G.sim) === m.stateHash(H.sim), 'écart volontaire détecté puis corrigé (état renvoyé par l\'hôte)');
  // départ de l'invité : le pays reste celui d'un joueur absent, l'hôte peut le confier à l'IA
  b.close();
  await flush(pump);
  ok(H.events.some((e) => e.type === 'left') && H.sim.nation.isHuman(K('DE')), 'départ du joueur : son pays attend son retour');
  H.act({ op: 'leave', k: K('DE') });
  ok(!H.sim.nation.isHuman(K('DE')) && !H.sim.sides[K('DE')].player, 'pays confié à l\'IA');
  // sauvegarde d'une partie à deux joueurs : reprise exacte
  const H2 = mk(JSON.parse(JSON.stringify(H.sim.serialize())));
  let firstDiff = -1;
  if (m.stateHash(H2) !== m.stateHash(H.sim)) firstDiff = 0;
  for (let i = 0; i < 100; i++) { H.sim.step(); H2.step(); if (firstDiff < 0 && m.stateHash(H2) !== m.stateHash(H.sim)) { firstDiff = i + 1; const A = H.sim, B = H2; console.log('   écart au pas', A.tickCount, 'rng', A.rng.state === B.rng.state, 'cells', A.sides.filter((s, k) => s.cells !== B.sides[k].cells).map((s) => s.name), 'units', A.sides.filter((s, k) => Math.abs(s.units - B.sides[k].units) > 1e-9).map((s) => s.name), 'money', A.sides.filter((s, k) => Math.abs(s.money - B.sides[k].money) > 1e-9).map((s) => s.name), 'morale', A.sides.filter((s, k) => Math.abs(s.morale - B.sides[k].morale) > 1e-9).map((s) => s.name), 'agents', A.sides.filter((s, k) => s.agents.length !== B.sides[k].agents.length).map((s) => s.name)); } }
  ok(m.stateHash(H2) === m.stateHash(H.sim), 'sauvegarde / reprise exacte après une partie multijoueur');
})();
