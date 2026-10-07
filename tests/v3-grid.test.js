const path = require('path'); const fs = require('fs'); const zlib = require('zlib');
require('esbuild').buildSync({ entryPoints: [path.join(__dirname, 'v3-entry.mjs')], bundle: true, platform: 'node', format: 'cjs', outfile: path.join(__dirname, '.v3-bundle.cjs'), logLevel: 'error' });
const m = require('./.v3-bundle.cjs');
const raw = zlib.inflateSync(fs.readFileSync(path.join(__dirname, '..', 'src', 'data', 'world-grid.bin')));
let t = Date.now();
const g = m.parseWorldGrid(new Uint8Array(raw));
console.log('grille', g.n, 'cellules', g.compSize.length, 'masses', 'en', Date.now() - t, 'ms');
const nav = new m.Navigator(g);
const fr = m.nearestCell(g, 47.2, -2.2, (i) => g.origin[i] === 249 - 249 + g.territories.findIndex(x => x.id === 'FR'));
const gf = m.nearestCell(g, 4.9, -52.3);
const us = m.nearestCell(g, 40.7, -74.0);
const jp = m.nearestCell(g, 35.4, 139.6);
for (const [a, b, lbl] of [[fr, gf, 'France→Guyane'], [fr, us, 'France→New York'], [fr, jp, 'France→Japon']]) {
  t = Date.now();
  const r = nav.seaRoute(a, b);
  console.log(lbl, r ? Math.round(m.polylineLengthKm(r)) + ' km, ' + r.length + ' pts' : 'aucune route', Date.now() - t, 'ms');
}
