// Tests de l'ÉDITEUR DE FRONTIÈRES (Nation Simulator) : le tracé au crayon modifie réellement le territoire
// (annexion, cession), sans zone invalide, capitales protégées, uniquement les frontières du joueur, frontière
// EXACTEMENT sur le tracé dans la géométrie des territoires, réactions diplomatiques, sauvegarde.
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
const ids = ['FR', 'DE', 'BE', 'CH', 'IT', 'ES', 'LU', 'NL', 'PL', 'CZ', 'AT'];
const mk = (restore = null) => new m.WorldSim(grid, nav, world, { participants: ids.map((id, k) => ({ e: idx(id), team: k })), teams: ids.map((n) => ({ name: n })), options: { seed: 'BED', warStart: 'tensions', aiWars: false, maxDuration: 1e9, peaceEnd: 1e9, nation: { player: 0 }, mode: 'nation' } }, restore, { geo, details });
const FR = idx('FR'), DE = idx('DE');
const comps = (sim, e) => { const seen = new Uint8Array(sim.n); let n = 0; for (let i = 0; i < sim.n; i++) { if (sim.owner[i] !== e || seen[i]) continue; n++; const st = [i]; seen[i] = 1; while (st.length) { const a = st.pop(); for (let k = grid.nbrStart[a]; k < grid.nbrStart[a + 1]; k++) { const b = grid.nbr[k]; if (!seen[b] && sim.owner[b] === e) { seen[b] = 1; st.push(b); } } } } return n; };
const SAAR = m.prepareStroke([[6.35, 49.45], [6.7, 49.7], [7.0, 49.9], [7.5, 50.0], [7.9, 49.95], [8.1, 49.7], [8.25, 49.4], [8.15, 49.1], [8.1, 48.95]], false);

// 1. annexion : la zone entre le tracé et la frontière passe au joueur
{
  const sim = mk();
  const e = m.computeEdit(sim, 0, [SAAR]);
  const allDEtoFR = e.transfers.every(([c, to]) => to === FR && sim.owner[c] === DE);
  const inside = e.transfers.every(([c]) => grid.lat[c] > 48.9 && grid.lat[c] < 50.1 && grid.lon[c] > 6.3 && grid.lon[c] < 8.4);
  ok(e.transfers.length >= 15 && allDEtoFR && inside, `annexion (Sarre et Palatinat) : ${e.transfers.length} parcelles, ${Math.round(e.gained).toLocaleString('fr-FR')} km² pris à l'Allemagne, toutes entre le tracé et la frontière`);
  ok(e.effective[0] === true && e.strips.length === 2, 'tracé effectif, deux bandes exactes de part et d\'autre de la ligne');
  const c0 = comps(sim, FR), d0 = comps(sim, DE);
  const r0 = sim.rel[0 * sim.S + 1];
  m.applyEdit(sim, 0, e, [SAAR], true);
  ok(e.transfers.every(([c]) => sim.owner[c] === FR && !sim.occupied[c]), 'validation : territoires officiellement français (pas une occupation)');
  ok(comps(sim, FR) <= c0 && comps(sim, DE) <= d0 + 0, `topologie : composantes France ${c0} -> ${comps(sim, FR)}, Allemagne ${d0} -> ${comps(sim, DE)} (aucun fragment créé)`);
  let none = 0; for (let i = 0; i < sim.n; i++) if (world.owner[i] !== 65535 && sim.owner[i] === 65535) none++;
  ok(none === 0, 'aucune parcelle sans pays');
  ok(sim.rel[0 * sim.S + 1] < r0 - 10, `réaction de l'Allemagne : relations ${Math.round(r0)} -> ${Math.round(sim.rel[0 * sim.S + 1])}`);
  // géométrie exacte : la nouvelle frontière suit le tracé
  const tb = zlib.inflateSync(fs.readFileSync(path.join(__dirname, '..', 'src/data/territories.bin')));
  const G = new m.TerritoryGeometry(grid, m.parseTerritories(new Float32Array(tb.buffer, tb.byteOffset, tb.length / 4)));
  const key = (c) => sim.owner[c] * 2 + (sim.occupied[c] ? 1 : 0);
  G.setOverrides(m.activeOverrides(sim)); G.update(key);
  const fr = G.H.get(DE).pieces.find((p) => p.key === FR * 2);
  const dist = (p) => { let bd = 1e9; for (const poly of fr.mp) for (const r of poly) for (const q of r) bd = Math.min(bd, Math.hypot((q[0] - p[0]) * Math.cos(p[1] * Math.PI / 180), q[1] - p[1])); return bd; };
  const dmax = Math.max(...SAAR.slice(3, -3).map(dist));
  ok(fr && dmax < 0.002, `géométrie : la frontière passe exactement sur le tracé (écart max ${dmax.toFixed(4)}°)`);
  const total = G.H.get(DE).pieces.reduce((a, p) => a + m.mpArea(p.mp), 0);
  ok(Math.abs(total - G.H.get(DE).area) < G.H.get(DE).area * 0.005, 'géométrie : partition exacte du pays (aucune lacune, aucune superposition)');
  // sauvegarde : les nouvelles frontières sont conservées
  const snap = JSON.parse(JSON.stringify(sim.serialize()));
  const b = mk(snap);
  ok(b.borderEdits.length === 1 && m.activeOverrides(b).length === 2 && e.transfers.every(([c]) => b.owner[c] === FR), 'sauvegarde : tracés et frontières exactes repris');
}
// 2. cession : une partie de l'Alsace coupée par le tracé revient à l'Allemagne
{
  const sim = mk();
  const e = m.computeEdit(sim, 0, [m.prepareStroke([[7.6, 48.95], [7.3, 48.6], [7.55, 48.1]], false)]);
  ok(e.transfers.length > 0 && e.transfers.every(([c, to]) => to === DE && sim.owner[c] === FR) && e.lost > 0 && e.gained === 0, `cession : ${e.transfers.length} parcelles alsaciennes cédées à l'Allemagne (${Math.round(e.lost).toLocaleString('fr-FR')} km²)`);
}
// 3. tracé qui ne relie pas deux points de frontière : aucun effet
{
  const sim = mk();
  const e = m.computeEdit(sim, 0, [[[2, 47], [2.5, 47.2], [3, 47.1]]]);
  ok(e.transfers.length === 0 && e.effective[0] === false, 'tracé à l\'intérieur du pays sans rejoindre la frontière : aucun effet');
}
// 4. capitale protégée : impossible de céder la région de Paris
{
  const sim = mk();
  const e = m.computeEdit(sim, 0, [m.prepareStroke([[4.0, 50.2], [2.5, 49.3], [1.6, 48.6], [2.4, 48.2], [3.6, 48.6], [5.0, 49.2], [5.8, 49.5]], true)]);
  const cap = sim.sides[0].capital;
  ok(!e.transfers.some(([c]) => c === cap), `capitale du joueur jamais cédée (${e.transfers.length} parcelle(s) concernée(s))`);
  // capitale étrangère : un tracé autour de Bruxelles depuis la frontière française ne l'annexe pas
  const e2 = m.computeEdit(sim, 0, [m.prepareStroke([[2.6, 51.05], [3.6, 51.2], [4.5, 51.1], [4.9, 50.7], [4.6, 50.2], [4.2, 50.1]], true)]);
  const bcap = sim.sides[ids.indexOf('BE')].capital;
  ok(!e2.transfers.some(([c]) => c === bcap), `capitale étrangère protégée (Bruxelles)${e2.warnings.length ? ' : « ' + e2.warnings[0].slice(0, 50) + '… »' : ''}`);
}
// 5. seules les frontières du joueur : un tracé entre l'Allemagne et la Pologne ne change rien
{
  const sim = mk();
  const e = m.computeEdit(sim, 0, [m.prepareStroke([[14.6, 53.5], [15.5, 52.5], [14.8, 51.3]], false)]);
  ok(e.transfers.every(([c, to]) => to === FR || sim.owner[c] === FR), `tracé loin de la France : ${e.transfers.length} transfert(s) concernant d'autres pays`);
}
