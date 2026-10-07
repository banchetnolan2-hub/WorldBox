// Tests de la GÉOMÉTRIE DES TERRITOIRES : vrais polygones recalculés après chaque changement territorial.
// Partition exacte de chaque pays d'origine (aucune lacune, aucune superposition), polygones valides,
// aucun sliver ni fragment accidentel, îles et enclaves réelles conservées, lignes de front à l'intérieur
// des pays, cas de conquête / restitution / fusion / traité.
const path = require('path'); const fs = require('fs'); const zlib = require('zlib');
require('esbuild').buildSync({ entryPoints: [path.join(__dirname, 'v3-entry.mjs')], bundle: true, platform: 'node', format: 'cjs', outfile: path.join(__dirname, '.v3-bundle.cjs'), logLevel: 'error', loader: { '.json': 'json' } });
const m = require('./.v3-bundle.cjs');
const pc = require('polygon-clipping');
const ok = (c, label) => { console.log((c ? 'OK   ' : 'ÉCHEC') + ' ' + label); if (!c) process.exitCode = 1; };
const grid = m.parseWorldGrid(new Uint8Array(zlib.inflateSync(fs.readFileSync(path.join(__dirname, '..', 'src/data/world-grid.bin')))));
const data = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'src/data/countries.json'), 'utf8'));
const world = m.createOriginalWorld(grid, data);
const tb = zlib.inflateSync(fs.readFileSync(path.join(__dirname, '..', 'src/data/territories.bin')));
const polys = m.parseTerritories(new Float32Array(tb.buffer, tb.byteOffset, tb.length / 4));
const idx = (id) => world.entities.findIndex((e) => e.id === id);
const G = new m.TerritoryGeometry(grid, polys);
const owner = Int32Array.from(world.owner), occ = new Uint8Array(grid.n);
const key = (c) => owner[c] * 2 + occ[c];
const R = grid.RES, CELL = R * R;
const t0 = Date.now();
G.update(key);
ok(G.H.size > 230, `polygones d'origine : ${G.H.size} pays (Natural Earth 1:10m, frontières partagées), calcul complet en ${Date.now() - t0} ms`);

// contrôle complet d'un pays d'origine : partition exacte, polygones valides, pas de sliver, fronts intérieurs
function check(t, label) {
  const h = G.H.get(t);
  const errs = [];
  const total = h.pieces.reduce((a, p) => a + m.mpArea(p.mp), 0);
  if (Math.abs(total - h.area) > Math.max(1e-4, h.area * 0.005)) errs.push(`aire ${total.toFixed(3)} ≠ ${h.area.toFixed(3)}`);
  for (let i = 0; i < h.pieces.length; i++) for (let j = i + 1; j < h.pieces.length; j++) {
    const inter = m.mpArea(pc.intersection(h.pieces[i].mp, h.pieces[j].mp));
    if (inter > CELL * 0.002) errs.push(`superposition ${inter.toFixed(4)}`);
  }
  for (const p of h.pieces) {
    const v = m.mpArea(pc.union(p.mp));
    if (Math.abs(v - m.mpArea(p.mp)) > Math.max(1e-5, v * 0.002)) errs.push('polygone invalide (auto-intersection)');
    for (const poly of p.mp) {
      const a = m.polyArea(poly);
      const whole = h.comps.some((ca) => Math.abs(ca - a) < Math.max(1e-6, ca * 0.02));
      if (!whole && h.pieces.length > 1 && (a < CELL * 0.12 || m.meanWidth(poly) < R * 0.12)) errs.push(`sliver ${a.toFixed(4)}`);
    }
  }
  const keys = new Set(h.pieces.map((p) => p.key));
  if (keys.size !== h.pieces.length) errs.push('pièces de même clé non fusionnées');
  let pts = 0;
  for (const f of h.fronts) pts += f.length;
  if (h.pieces.length === 1 && h.fronts.length) errs.push('ligne de front dans un territoire uniforme');
  ok(!errs.length, `${label} : ${h.pieces.length} pièce(s), ${h.fronts.length} ligne(s) de front (${pts} points)${errs.length ? ' — ' + errs.slice(0, 3).join(' ; ') : ''}`);
  return h;
}
const cellsOf = (id, f = () => true) => { const t = idx(id), out = []; for (let c = 0; c < grid.n; c++) if (grid.origin[c] === t && f(c)) out.push(c); return out; };
const give = (cells, to, oc = 0) => { for (const c of cells) { owner[c] = to; occ[c] = oc; } };
const reset = () => { owner.set(world.owner); occ.fill(0); };
const FR = idx('FR'), DE = idx('DE'), BE = idx('BE'), IT = idx('IT'), ES = idx('ES'), RU = idx('RU'), PL = idx('PL');

// 1. conquête d'une région (Bretagne)
give(cellsOf('FR', (c) => grid.lon[c] < -1.5 && grid.lat[c] > 47), DE, 1);
G.update(key);
let h = check(FR, 'conquête d\'une région (Bretagne occupée)');
ok(h.pieces.some((p) => p.key === DE * 2 + 1), 'la région conquise forme sa propre pièce (occupée)');

// 2. conquête partielle, puis 3. conquêtes successives : le pays est recalculé à chaque étape
reset();
for (const [step, lon] of [[1, 5.6], [2, 4.6], [3, 3.6]]) {
  give(cellsOf('BE', (c) => grid.lon[c] > lon), DE, 1);
  const ch = G.update(key);
  check(BE, `conquête successive ${step} de la Belgique (recalcul : ${ch.map((t) => world.entities[t].id).join(',') || 'aucun'})`);
}

// 4. enclave volontaire (une parcelle d'un autre pays au milieu de la France) : conservée
reset();
const paris = cellsOf('FR').sort((a, b) => Math.hypot(grid.lat[a] - 47, grid.lon[a] - 2.5) - Math.hypot(grid.lat[b] - 47, grid.lon[b] - 2.5)).slice(0, 4);
give(paris, IT, 0);
G.update(key);
h = check(FR, 'enclave d\'un autre pays (4 parcelles)');
ok(h.pieces.some((p) => p.key === IT * 2), 'enclave étrangère conservée');
// fragment accidentel : une seule parcelle « occupée » du même propriétaire -> fusionnée
reset();
give(paris.slice(0, 1), FR, 1);
G.update(key);
h = check(FR, 'fragment accidentel de statut (1 parcelle)');
ok(h.pieces.length === 1, 'le fragment accidentel est fusionné dans le territoire voisin');

// 5. exclave (Kaliningrad) et 6. île (Corse rattachée à l'Italie)
reset();
G.update(key);
const ru = G.H.get(RU);
const kal = ru.pieces[0].mp.some((p) => p[0].every(([x, y]) => x > 19 && x < 23 && y > 54 && y < 56));
ok(ru.pieces.length === 1 && kal, 'exclave : Kaliningrad reste un polygone russe séparé');
give(cellsOf('FR', (c) => grid.lon[c] > 8 && grid.lon[c] < 10 && grid.lat[c] > 41 && grid.lat[c] < 43.2), IT, 0);
G.update(key);
h = check(FR, 'île (Corse rattachée à l\'Italie)');
const cors = h.pieces.find((p) => p.key === IT * 2);
ok(cors && cors.mp.length === 1 && cors.mp[0].length === 1 && h.comps.some((a) => Math.abs(a - m.mpArea(cors.mp)) < a * 0.02), `l'île entière change de mains, côte exacte (${cors ? m.mpArea(cors.mp).toFixed(3) : '?'} degrés²)`);

// 7. territoire côtier : la côte reste celle de la carte (aucune bande résiduelle)
reset();
give(cellsOf('FR', (c) => grid.lat[c] > 48.6 && grid.lon[c] < 1.6 && grid.lon[c] > -2), DE, 1);
G.update(key);
h = check(FR, 'territoire côtier (Normandie)');

// 8. fusion : pays entièrement annexés -> une seule pièce, aucune ligne de front
reset();
give(cellsOf('BE'), FR, 0);
G.update(key);
h = check(BE, 'fusion (Belgique annexée par la France)');
ok(h.pieces.length === 1 && h.pieces[0].key === FR * 2 && h.fronts.length === 0, 'territoire fusionné : une pièce, aucune frontière intérieure');

// 9. restitution : retour aux frontières d'origine
reset();
G.update(key);
ok([FR, BE, IT, DE].every((t) => G.H.get(t).pieces.length === 1), 'restitution : chaque pays retrouve un seul polygone d\'origine');

// 10. guerres simulées puis traités : géométrie valide pour tous les pays touchés
{
  const relief = new m.Relief(new Uint8Array(zlib.inflateSync(fs.readFileSync(path.join(__dirname, '..', 'src/data/world-relief.bin')))));
  const geo = m.computeGeo(grid, relief);
  const nav = new m.Navigator(grid);
  const ids = ['FR', 'DE', 'BE', 'NL', 'PL', 'CZ'];
  const sim = new m.WorldSim(grid, nav, world, { participants: ids.map((id, k) => ({ e: idx(id), team: k })), teams: ids.map((n) => ({ name: n })), options: { seed: 'GEO', maxDuration: 1e9 } }, null, { geo });
  let checks = 0, bad = 0, ms = 0, upd = 0;
  const k2 = (c) => sim.owner[c] * 2 + (sim.occupied[c] === 1 ? 1 : 0);
  for (let s = 0; s < 4000; s++) {
    sim.step(); sim.captures.length = 0; sim.eventsOut.length = 0;
    if (s % 400 === 0) {
      const t1 = Date.now(); const ch = G.update(k2); ms += Date.now() - t1; upd += ch.length;
      for (const t of ch) {
        const hh = G.H.get(t); checks++;
        const total = hh.pieces.reduce((a, p) => a + m.mpArea(p.mp), 0);
        if (Math.abs(total - hh.area) > Math.max(1e-4, hh.area * 0.005)) bad++;
      }
    }
  }
  ok(checks > 0 && bad === 0, `guerres et traités simulés : ${sim.wars.length} guerre(s), ${upd} recalculs de pays, partition exacte à chaque fois (${ms} ms au total)`);
}

// 11. pipeline incrémental (travailleur) : seules les parcelles modifiées sont envoyées, seuls les pays
// touchés sont recalculés, maillages triangulés et lignes de front prêts pour la carte graphique
{
  const core = m.createGeometryCore();
  core({ type: 'init', polys: new Float32Array(tb.buffer, tb.byteOffset, tb.length / 4), grid });
  const keys0 = new Int32Array(grid.n); for (let c = 0; c < grid.n; c++) keys0[c] = world.owner[c] * 2;
  let t1 = Date.now();
  const full = core({ type: 'update', full: true, keys: keys0 }).msg;
  const tFull = Date.now() - t1;
  const tris = full.out.reduce((a, r) => a + r.mesh.idx.length / 3, 0);
  ok(full.out.length > 230 && tris > 100000, `état initial : ${full.out.length} pays triangulés (${tris} triangles) en ${tFull} ms`);
  // conquête de quelques parcelles à l'est de la France
  const cells = Int32Array.from(cellsOf('FR', (c) => grid.lon[c] > 6.8 && grid.lat[c] > 48)), keys = new Int32Array(cells.length).fill(DE * 2 + 1);
  t1 = Date.now();
  const d = core({ type: 'update', cells, keys }).msg;
  const tDelta = Date.now() - t1;
  ok(d.out.length === 1 && d.out[0].t === FR && d.out[0].fronts && d.out[0].mesh.idx.length > 0, `mise à jour incrémentale : ${cells.length} parcelles -> ${d.out.map((r) => world.entities[r.t].id).join(',')} recalculé seul en ${tDelta} ms, ${d.out[0].fronts ? d.out[0].fronts.idx.length / 6 : 0} segments de front`);
  const none = core({ type: 'update', cells: new Int32Array(0), keys: new Int32Array(0) }).msg;
  ok(none.out.length === 0, 'aucun changement : aucun calcul');
}
