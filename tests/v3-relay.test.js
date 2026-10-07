// Tests du MULTIJOUEUR PAR CODE (relais MQTT chiffrés) avec de vrais serveurs MQTT locaux (aedes) :
// code de partie, plusieurs joueurs sur le même code, chiffrement de bout en bout, version différente,
// code inconnu (délai), bascule automatique de relais, puis une vraie partie NetGame à travers le relais.
const path = require('path'); const fs = require('fs'); const zlib = require('zlib'); const http = require('http');
require('esbuild').buildSync({ entryPoints: [path.join(__dirname, 'v3-entry.mjs')], bundle: true, platform: 'node', format: 'cjs', outfile: path.join(__dirname, '.v3-bundle.cjs'), logLevel: 'error', loader: { '.json': 'json' } });
const m = require('./.v3-bundle.cjs');
const { createBroker } = require('aedes');
const { WebSocketServer, createWebSocketStream } = require('ws');
const ok = (c, label) => { console.log((c ? 'OK   ' : 'ÉCHEC') + ' ' + label); if (!c) process.exitCode = 1; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (f, ms = 8000) => { const t = Date.now(); while (!f()) { if (Date.now() - t > ms) return false; await sleep(20); } return true; };

// relais local : serveur MQTT sur WebSocket (sous-protocole « mqtt »), comme les relais publics
async function broker(name) {
  const b = await createBroker();
  const srv = http.createServer();
  const wss = new WebSocketServer({ server: srv, handleProtocols: (p) => (p.has('mqtt') ? 'mqtt' : false) });
  const socks = new Set();
  wss.on('connection', (ws) => { socks.add(ws); ws.on('close', () => socks.delete(ws)); b.handle(createWebSocketStream(ws)); });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const relay = { name, url: `ws://127.0.0.1:${srv.address().port}/mqtt` };
  const seen = [];
  b.on('publish', (pk) => { if (pk.topic.startsWith(m.RELAY_PROTO)) seen.push(Buffer.from(pk.payload)); });
  return { relay, seen, b, kill: () => new Promise((r) => { for (const s of socks) s.terminate(); wss.close(); srv.close(() => b.close(r)); }) };
}

(async () => {
  // ---------- code de partie ----------
  const code = m.makeCode();
  ok(/^[2-9A-HJKMNP-Z]{5}-[2-9A-HJKMNP-Z]{6}$/.test(code), `code de partie lisible : ${code}`);
  ok(m.normalizeCode(code.toLowerCase().replace('-', ' ')) === code && m.normalizeCode('ABC') === null, 'saisie tolérante (minuscules, espaces) ; code incomplet refusé');
  const d1 = await m.deriveRoom(code), d2 = await m.deriveRoom(code), d3 = await m.deriveRoom(m.makeCode());
  ok(d1.room === d2.room && d1.room !== d3.room && !d1.room.includes(code.replace('-', '')), 'salon dérivé du code (identique pour tous les joueurs, le code n\'apparaît pas)');

  const A = await broker('A'), B = await broker('B');
  const relays = [A.relay, B.relay];
  const V = 'test-1';

  // ---------- hôte + deux joueurs sur le même code ----------
  const got = [];
  const host = await m.relayHost((link, info) => { got.push(link); link.onmessage = (msg) => { link.inbox = link.inbox || []; link.inbox.push(msg); if ('echo' in msg) link.send({ echo: msg.echo, from: 'hôte' }); }; void info; }, { version: V, relays });
  ok(host.relays.length === 2, `partie ouverte sur ${host.relays.length} relais : ${host.relays.join(', ')} ; code ${host.code}`);
  const g1 = await m.relayJoin(host.code, { version: V, relays, name: 'Alex' });
  const g2 = await m.relayJoin(host.code.toLowerCase(), { version: V, relays, name: 'Sam' });
  await until(() => got.length === 2);
  ok(got.length === 2 && got.map((l) => l.label).sort().join() === 'Alex,Sam', 'deux joueurs rejoignent avec le même code');
  const in1 = [], in2 = [];
  g1.onmessage = (x) => in1.push(x); g2.onmessage = (x) => in2.push(x);
  for (let i = 0; i < 30; i++) g1.send({ echo: i });
  g2.send({ echo: 'bonjour' });
  await until(() => in1.length === 30 && in2.length === 1);
  ok(in1.length === 30 && in1.every((x, i) => x.echo === i), 'messages reçus dans l\'ordre (30 allers-retours)');
  ok(in2.length === 1 && in2[0].echo === 'bonjour', 'chaque joueur reçoit ses propres réponses');
  // gros message (état complet de partie) : découpé, compressé, réassemblé
  const big = { blob: Array.from({ length: 60000 }, (_, i) => (i * 7919) % 100003), mark: 'SECRET-PLAN-ÉTAT' };
  const L1 = got.find((l) => l.label === 'Alex');
  L1.send(big);
  await until(() => in1.length === 31, 15000);
  ok(in1.length === 31 && in1[30].blob.length === 60000 && in1[30].blob[59999] === big.blob[59999], `gros message réassemblé (${JSON.stringify(big).length} caractères)`);
  // chiffrement : les relais ne voient jamais le contenu
  const all = Buffer.concat([...A.seen, ...B.seen]);
  ok(A.seen.length + B.seen.length > 20 && !all.includes('SECRET') && !all.includes('echo') && !all.includes('Alex'), `relais : ${A.seen.length + B.seen.length} trames, aucune en clair (chiffrement de bout en bout)`);
  // trame forgée par un tiers sans le code : ignorée
  const spy = await new m.Mqtt(A.relay, globalThis.WebSocket).connect('spy');
  spy.publish(`${m.RELAY_PROTO}/${d1.room}/h`, new Uint8Array(200).fill(65));
  spy.publish(`${m.RELAY_PROTO}/${(await m.deriveRoom(host.code)).room}/h`, new Uint8Array(200).fill(66));
  await sleep(300);
  ok(got.length === 2, 'trames forgées (sans la clé) ignorées par l\'hôte');
  spy.close();

  // ---------- version différente ----------
  let err = null;
  try { await m.relayJoin(host.code, { version: 'test-0', relays }); } catch (e) { err = e.message; }
  ok(/Versions différentes/.test(err || '') && /test-1/.test(err), `version différente refusée : « ${err} »`);

  // ---------- code inconnu : délai et message explicite ----------
  err = null; const t0 = Date.now();
  try { await m.relayJoin(m.makeCode(), { version: V, relays, timeout: 2500 }); } catch (e) { err = e.message; }
  ok(/Aucune partie trouvée/.test(err || '') && Date.now() - t0 >= 2400, `code inconnu : « ${err} »`);
  err = null;
  try { await m.relayJoin(host.code, { version: V, relays: [{ name: 'X', url: 'ws://127.0.0.1:1/mqtt' }] }); } catch (e) { err = e.message; }
  ok(/Aucun relais public joignable/.test(err || ''), 'aucun relais joignable : message clair');

  // ---------- bascule de relais ----------
  const onA = [g1, g2].find((g) => g.relay === 'A') || g1;
  const before = onA.relay;
  let resumed = null; onA.onresume = (r) => { resumed = r; };
  await (before === 'A' ? A : B).kill();
  await until(() => resumed !== null, 10000);
  ok(resumed && resumed !== before, `relais ${before} perdu : bascule automatique sur ${resumed}`);
  const inbox = onA === g1 ? in1 : in2, n0 = inbox.length;
  onA.send({ echo: 'après bascule' });
  await until(() => inbox.length > n0, 8000);
  ok(inbox.length > n0 && inbox[inbox.length - 1].echo === 'après bascule', 'la partie continue sur le nouveau relais');
  g1.close(); g2.close();
  await until(() => got.every((l) => l.closed), 5000);
  ok(got.every((l) => l.closed), 'départ des joueurs signalé à l\'hôte');
  host.close();

  // ---------- partie en pause (aucun message du jeu) : les joueurs restent connectés ----------
  {
    const R = await broker('R');
    const links = [];
    const h = await m.relayHost((l) => links.push(l), { version: V, relays: [R.relay], pingEvery: 250, silentMax: 1000 });
    const g = await m.relayJoin(h.code, { version: V, relays: [R.relay], pingEvery: 250, silentMax: 1000 });
    await sleep(3000);
    ok(!g.closed && links.length === 1 && !links[0].closed, 'partie silencieuse (pause) : la liaison reste ouverte grâce aux pings');
    h.close();
    ok(await until(() => g.closed, 3000), 'hôte parti : l\'invité est prévenu');
    await R.kill();
  }

  // ---------- vraie partie NetGame à travers le relais (aucune désynchronisation) ----------
  const C = await broker('C');
  const grid = m.parseWorldGrid(new Uint8Array(zlib.inflateSync(fs.readFileSync(path.join(__dirname, '..', 'src/data/world-grid.bin')))));
  const relief = new m.Relief(new Uint8Array(zlib.inflateSync(fs.readFileSync(path.join(__dirname, '..', 'src/data/world-relief.bin')))));
  const geo = m.computeGeo(grid, relief);
  const data = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'src/data/countries.json'), 'utf8'));
  const nav = new m.Navigator(grid);
  const world = m.createOriginalWorld(grid, data);
  const idx = (id) => world.entities.findIndex((e) => e.id === id);
  const details = m.buildDetails(grid, world.owner, world.entities);
  const ids = ['FR', 'DE', 'BE', 'NL', 'CH', 'LU'];
  const setup = { participants: ids.map((id, k) => ({ e: idx(id), team: k })), teams: ids.map((n) => ({ name: n })), options: { seed: 'RELAY', warStart: 'tensions', aiWars: true, maxDuration: 1e9, peaceEnd: 1e9, maxAgents: 300, nation: { player: 0 }, mode: 'nation' } };
  const mk = (restore = null) => new m.WorldSim(grid, nav, world, JSON.parse(JSON.stringify(setup)), restore, { geo, details });
  const machine = (role, name) => {
    const M = { sim: null, events: [], paused: false, speed: 1 };
    M.net = new m.NetGame(role, {
      sim: () => M.sim, exec: (cmd) => m.execCommand(M.sim, cmd),
      snapshot: async () => ({ sim: JSON.parse(JSON.stringify(M.sim.serialize())) }),
      load: async (d, side) => { M.sim = mk(d.sim); M.sim.localSide = side; },
      event: (type, p) => { M.events.push({ type, ...p }); if (type === 'lobby') M.lobby = p; },
      setPaused: (b) => { M.paused = b; }, setSpeed: (s) => { M.speed = s; }, paused: () => M.paused, speed: () => M.speed, localName: () => name,
    });
    return M;
  };
  const H = machine('host', 'Nolan'), G = machine('guest', 'Alex');
  H.sim = mk();
  const room = await m.relayHost((link) => H.net.addLink(link), { version: m.NET_VERSION, relays: [C.relay] });
  const gl = await m.relayJoin(room.code, { version: m.NET_VERSION, relays: [C.relay], name: 'Alex' });
  G.net.connect(gl);
  ok(await until(() => !!G.lobby), `salon reçu à travers le relais : ${G.lobby ? G.lobby.countries.length : 0} pays`);
  G.net.pick(1);
  ok(await until(() => G.net.loaded && G.sim, 20000), `partie chargée chez l'invité (état complet chiffré, ${(gl.bytesIn / 1024).toFixed(0)} Ko reçus)`);
  for (let i = 0; i < 400; i++) {
    if (H.net.budget(H.sim, 1)) { H.sim.step(); H.sim.captures.length = 0; H.sim.eventsOut.length = 0; H.net.afterStep(H.sim); }
    H.net.afterFrame(H.sim);
    if (i === 50) { G.net.submit({ op: 'policy', a: 1, patch: { stance: 'defensive' }, text: 'test' }); }
    if (i % 10 === 0) await sleep(15);
    const s = G.net.budget(G.sim, 0);
    for (let k = 0; k < s; k++) { G.net.beforeStep(G.sim); G.sim.step(); G.sim.captures.length = 0; G.sim.eventsOut.length = 0; G.net.afterStep(G.sim); }
    G.net.afterFrame(G.sim);
  }
  await until(() => { const s = G.net.budget(G.sim, 0); for (let k = 0; k < s; k++) { G.net.beforeStep(G.sim); G.sim.step(); G.net.afterStep(G.sim); } return G.sim.tickCount === H.sim.tickCount; }, 15000);
  ok(G.sim.tickCount === H.sim.tickCount && m.stateHash(G.sim) === m.stateHash(H.sim), `même état après ${H.sim.tickCount} pas : empreintes identiques (${m.stateHash(H.sim)})`);
  ok(!H.events.some((e) => e.type === 'desync') && !G.events.some((e) => e.type === 'desync'), 'aucune désynchronisation détectée');
  gl.close(); room.close();
  await C.kill(); await B.kill().catch(() => {}); await A.kill().catch(() => {});
  console.log(process.exitCode ? '\nMultijoueur par code : ÉCHECS' : '\nMultijoueur par code : tout réussi');
  process.exit(process.exitCode || 0);
})().catch((e) => { console.error(e); process.exit(1); });
