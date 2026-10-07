// Tests du moteur mondial V3 : scénarios 1v1, 1v1v1, 5 pays, équipes, îles, 196 pays, sauvegarde/reprise.
const path = require('path'); const fs = require('fs'); const zlib = require('zlib');
require('esbuild').buildSync({ entryPoints: [path.join(__dirname, 'v3-entry.mjs')], bundle: true, platform: 'node', format: 'cjs', outfile: path.join(__dirname, '.v3-bundle.cjs'), logLevel: 'error' });
const m = require('./.v3-bundle.cjs');
if (process.env.TUNE) Object.assign(m.TUNE, JSON.parse(process.env.TUNE));
const raw = zlib.inflateSync(fs.readFileSync(path.join(__dirname, '..', 'src', 'data', 'world-grid.bin')));
const grid = m.parseWorldGrid(new Uint8Array(raw));
const data = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'src', 'data', 'countries.json'), 'utf8'));
const nav = new m.Navigator(grid);
const world = m.createOriginalWorld(grid, data);
const idx = (id) => world.entities.findIndex((e) => e.id === id);

function setup(teamsOf, opts = {}) {
  const participants = [], teams = [];
  teamsOf.forEach((ids, t) => { teams.push({ name: 'Équipe ' + String.fromCharCode(65 + t), color: '#fff' }); ids.forEach((id) => participants.push({ e: idx(id), team: t })); });
  return { participants, teams, options: opts };
}

function run(label, teamsOf, n = 6, opts = {}) {
  const res = [];
  let ms = 0, ticks = 0, maxTr = 0, ships = 0, planes = 0;
  for (let k = 0; k < n; k++) {
    const sim = new m.WorldSim(grid, nav, world, setup(teamsOf, { seed: label + k, ...opts }));
    const t0 = Date.now();
    const seenTr = new Set();
    while (!sim.finished) {
      sim.step(); sim.captures.length = 0; sim.eventsOut.length = 0; ticks++;
      maxTr = Math.max(maxTr, sim.transports.length);
      for (const t of sim.transports) if (!seenTr.has(t.id)) { seenTr.add(t.id); if (t.kind === 'ship') ships++; else planes++; }
    }
    ms += Date.now() - t0;
    res.push(sim.result);
  }
  const wins = {};
  for (const r of res) { const w = r.winnerTeam < 0 ? 'nul' : 'T' + r.winnerTeam; wins[w] = (wins[w] || 0) + 1; }
  const dur = res.map((r) => Math.round(r.time)).sort((a, b) => a - b);
  console.log(`${label.padEnd(26)} ${JSON.stringify(wins)} durées ${dur.join(',')} | ${(ms / ticks).toFixed(2)} ms/tick | navires ${ships} avions ${planes} (max simult. ${maxTr})`);
  return res;
}

const N = Number(process.argv[2] || 6);
run('1v1 France-Allemagne', [['FR'], ['DE']], N);
run('1v1 France-Espagne', [['FR'], ['ES']], N);
run('1v1v1 FR-DE-ES', [['FR'], ['DE'], ['ES']], N);
run('5 pays Europe', [['FR'], ['DE'], ['ES'], ['IT'], ['PL']], Math.max(2, N >> 1));
run('Équipes FR+DE+IT / ES+PT+GB', [['FR', 'DE', 'IT'], ['ES', 'PT', 'GB']], Math.max(2, N >> 1));
run('Îles : Royaume-Uni vs France', [['GB'], ['FR']], Math.max(2, N >> 1));
run('Îles : Japon vs Corée du Sud', [['JP'], ['KR']], Math.max(2, N >> 1));
run('Continents : Brésil vs Nigeria', [['BR'], ['NG']], 2);
run('Grand/petit : Russie-Estonie', [['RU'], ['EE']], Math.max(2, N >> 1));
if (!process.argv.includes('--quick')) {
  const all = world.entities.filter((e) => e.kind === 'country').map((e) => [e.id]);
  const t0 = Date.now();
  run('MONDE 196 pays', all, 1, { maxDuration: 120 });
  console.log('  (monde : ' + ((Date.now() - t0) / 1000).toFixed(1) + ' s pour 120 s simulées)');
}
// sauvegarde / reprise exacte
const s1 = new m.WorldSim(grid, nav, world, setup([['FR'], ['DE'], ['IT']], { seed: 'SAVE' }));
for (let k = 0; k < 900; k++) s1.step();
const snap = JSON.parse(JSON.stringify(s1.serialize()));
const s2 = new m.WorldSim(grid, nav, world, setup([['FR'], ['DE'], ['IT']], { seed: 'SAVE' }), snap);
for (let k = 0; k < 900; k++) { s1.step(); s2.step(); }
const same = s1.owner.every((v, i) => v === s2.owner[i]) && s1.time === s2.time;
console.log('Sauvegarde/reprise exacte :', same ? 'OK' : 'ÉCHEC', '| transports en cours sauvegardés :', snap.transports.length);
// monde : encodage des frontières
const enc = m.encodeOwner(s1.owner); const dec = m.decodeOwner(enc, grid.n);
console.log('Encodage des frontières :', dec.every((v, i) => v === s1.owner[i]) ? 'OK' : 'ÉCHEC', (enc.length / 1024).toFixed(0) + ' Ko');
// territoires occupés -> officiels
{
  const so = new m.WorldSim(grid, nav, world, setup([['FR'], ['DE']], { seed: 'OCC' }));
  let maxOcc = 0, officialized = 0;
  for (let k = 0; k < 4000; k++) {
    so.step();
    for (const c of so.captures) if (c.official) officialized++;
    so.captures.length = 0;
    maxOcc = Math.max(maxOcc, so.sides[0].occupiedCells + so.sides[1].occupiedCells);
  }
  let arr = [0, 0];
  for (let i = 0; i < so.n; i++) if (so.occupied[i]) { const s = so.sideOf[so.owner[i]]; if (s >= 0) arr[s]++; }
  const coherent = arr[0] === so.sides[0].occupiedCells && arr[1] === so.sides[1].occupiedCells;
  const snapO = JSON.parse(JSON.stringify(so.serialize()));
  const sr = new m.WorldSim(grid, nav, world, setup([['FR'], ['DE']], { seed: 'OCC' }), snapO);
  const kept = sr.occupied.every((v, i) => v === so.occupied[i]) && sr.sides[0].occupiedCells === so.sides[0].occupiedCells;
  console.log('Occupation :', coherent && kept && officialized > 0 && maxOcc > 0 ? 'OK' : 'ÉCHEC',
    `| max occupé ${maxOcc} | intégrées ${officialized} | occupé à la fin ${arr.join('/')}`);
}
