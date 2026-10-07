// outil : carte des biomes et rivières de la Terre (PPM) pour vérification visuelle
const path = require('path'); const fs = require('fs'); const zlib = require('zlib');
require('esbuild').buildSync({ entryPoints: [path.join(__dirname, 'v3-entry.mjs')], bundle: true, platform: 'node', format: 'cjs', outfile: path.join(__dirname, '.v3-bundle.cjs'), logLevel: 'error' });
const m = require('./.v3-bundle.cjs');
const grid = m.parseWorldGrid(new Uint8Array(zlib.inflateSync(fs.readFileSync(path.join(__dirname, '..', 'src/data/world-grid.bin')))));
const relief = new m.Relief(new Uint8Array(zlib.inflateSync(fs.readFileSync(path.join(__dirname, '..', 'src/data/world-relief.bin')))));
const geo = m.computeGeo(grid, relief);
console.log('geo ms', geo.ms, 'biomes', geo.counts, 'river segs', geo.riverSegs.length / 3);
const W = grid.W, H = grid.H, img = Buffer.alloc(W * H * 3, 30);
const col = m.BIOME_COLORS.map((h) => [1, 3, 5].map((k) => parseInt(h.slice(k, k + 2), 16)));
for (let i = 0; i < grid.nGrid; i++) { const p = grid.pos[i]; const c = geo.river[i] ? [40, 90, 200] : col[geo.biome[i]]; img[p * 3] = c[0]; img[p * 3 + 1] = c[1]; img[p * 3 + 2] = c[2]; }
fs.writeFileSync(process.argv[2] || 'geo.ppm', Buffer.concat([Buffer.from(`P6 ${W} ${H} 255\n`), img]));
