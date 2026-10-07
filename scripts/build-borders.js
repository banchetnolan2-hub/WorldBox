// Carte détaillée (affichage) : frontières et côtes vectorielles + raster des territoires d'origine,
// à partir de Natural Earth 1:10m (world-atlas/countries-10m, domaine public).
//  - src/data/world-hires.bin : identifiant du territoire d'origine par pixel (8192 × 4096, 255 = mer)
//  - src/data/borders.bin     : polylignes (frontières entre territoires, côtes) en deux niveaux de détail
// Les identifiants de territoire sont ceux de la grille de simulation (world-grid.bin) : les objets de la
// carte 10m sont rattachés par code ISO, sinon au territoire majoritaire sous l'objet dans l'ancien raster.
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { feature } = require('topojson-client');
const root = path.join(__dirname, '..');
const topo = require('world-atlas/countries-10m.json');

const gb = zlib.inflateSync(fs.readFileSync(path.join(root, 'src/data/world-grid.bin')));
const header = JSON.parse(gb.slice(4, 4 + gb.readUInt32LE(0)).toString('utf8'));
const territories = header.territories;
const HW = 8192, HH = 4096;
const oldPath = path.join(root, 'src/data/world-hires-50m.bin');
const curPath = path.join(root, 'src/data/world-hires.bin');
if (!fs.existsSync(oldPath)) fs.copyFileSync(curPath, oldPath);          // raster 50m d'origine conservé comme référence
const old = zlib.inflateSync(fs.readFileSync(oldPath));

const geoms = topo.objects.countries.geometries;
const feats = feature(topo, topo.objects.countries).features;
const byAtlas = new Map();
territories.forEach((t, k) => { if (t.atlasId && !byAtlas.has(t.atlasId)) byAtlas.set(t.atlasId, k); });

// ---------- rasterisation (règle pair-impair, une ligne de pixels à la fois) ----------
function ringsOf(geom) {
  if (!geom) return [];
  const polys = geom.type === 'Polygon' ? [geom.coordinates] : geom.type === 'MultiPolygon' ? geom.coordinates : [];
  const rings = [];
  for (const p of polys) for (const r of p) {
    const out = []; let off = 0;
    for (let k = 0; k < r.length; k++) {
      let [x, y] = r[k];
      if (k > 0) { const pv = r[k - 1][0]; if (x - pv > 180) off -= 360; else if (pv - x > 180) off += 360; }
      out.push([x + off, y]);
    }
    rings.push(out);
  }
  return rings;
}
function rasterize(geom, cb, HW = 8192, HH = 4096) {
  const rows = new Map();
  for (const r of ringsOf(geom)) {
    for (let k = 0; k < r.length - 1; k++) {
      const [x1, y1] = r[k], [x2, y2] = r[k + 1];
      if (y1 === y2) continue;
      const a = (90 - Math.max(y1, y2)) * HH / 180 - 0.5, b = (90 - Math.min(y1, y2)) * HH / 180 - 0.5;
      for (let sy = Math.max(0, Math.ceil(a)); sy <= Math.min(HH - 1, Math.floor(b)); sy++) {
        const lat = 90 - (sy + 0.5) * 180 / HH;
        if (lat < Math.min(y1, y2) || lat >= Math.max(y1, y2)) continue;
        let arr = rows.get(sy); if (!arr) rows.set(sy, (arr = []));
        arr.push(x1 + (lat - y1) / (y2 - y1) * (x2 - x1));
      }
    }
  }
  for (const [sy, xs] of rows) {
    xs.sort((p, q) => p - q);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      const a = (xs[k] + 180) * HW / 360 - 0.5, b = (xs[k + 1] + 180) * HW / 360 - 0.5;
      for (let sx = Math.ceil(a); sx <= Math.floor(b); sx++) cb(((sx % HW) + HW) % HW, sy);
    }
  }
}

// ---------- rattachement des objets 10m aux territoires ----------
const featT = new Int16Array(feats.length).fill(-1);
const pixOf = feats.map(() => []);
feats.forEach((f, k) => {
  if (f.id === '010') return;                                   // Antarctique : non simulé
  rasterize(f.geometry, (x, y) => pixOf[k].push(y * HW + x));
  if (f.id && byAtlas.has(f.id)) { featT[k] = byAtlas.get(f.id); return; }
  const votes = new Map();
  for (const p of pixOf[k]) { const v = old[p]; if (v !== 255) votes.set(v, (votes.get(v) || 0) + 1); }
  let best = -1, bv = 0; for (const [v, c] of votes) if (c > bv) { bv = c; best = v; }
  if (best < 0 && pixOf[k].length) {                             // petite île absente de la carte 50m : territoire le plus proche
    const p = pixOf[k][0], x0 = p % HW, y0 = (p / HW) | 0;
    let bd = 1e9;
    for (let dy = -40; dy <= 40; dy++) for (let dx = -40; dx <= 40; dx++) {
      const y = y0 + dy; if (y < 0 || y >= HH) continue;
      const v = old[y * HW + ((x0 + dx + HW) % HW)];
      if (v !== 255 && dx * dx + dy * dy < bd) { bd = dx * dx + dy * dy; best = v; }
    }
  }
  featT[k] = best;
});
const hires = new Uint8Array(HW * HH).fill(255);
feats.forEach((f, k) => { const t = featT[k]; if (t < 0 || t > 254) return; for (const p of pixOf[k]) hires[p] = t; });
// territoires trop petits pour la carte 10m mais présents dans la grille : on garde l'ancien raster
let kept = 0;
for (let p = 0; p < HW * HH; p++) if (hires[p] === 255 && old[p] !== 255) {
  // seulement si aucun pixel 10m de ce territoire à proximité (évite d'élargir les côtes)
  const x = p % HW, y = (p / HW) | 0; let near = false;
  for (let dy = -3; dy <= 3 && !near; dy++) for (let dx = -3; dx <= 3; dx++) { const yy = y + dy; if (yy < 0 || yy >= HH) continue; if (hires[yy * HW + ((x + dx + HW) % HW)] !== 255) { near = true; break; } }
  if (!near) { hires[p] = old[p]; kept++; }
}
fs.writeFileSync(curPath, zlib.deflateSync(Buffer.from(hires.buffer), { level: 9 }));

// ---------- masque terre/mer 1:10m très fin (16384 × 8192, 1 bit par pixel ≈ 2,4 km) ----------
// sert au rivage en vue rapprochée : il coïncide avec le trait de côte vectoriel
const MW = 16384, MH = 8192;
const mask = new Uint8Array(MW * MH / 8);
feats.forEach((f) => rasterize(f.geometry, (x, y) => { mask[(y * MW + x) >> 3] |= 1 << (x & 7); }, MW, MH));
fs.writeFileSync(path.join(root, 'src/data/land-mask.bin'), zlib.deflateSync(Buffer.from(mask.buffer), { level: 9 }));

// ---------- arcs : frontières (deux territoires) et côtes (un seul) ----------
const arcOwners = topo.arcs.map(() => []);
geoms.forEach((g, k) => {
  const t = featT[k]; if (t < 0) return;
  const walk = (a) => { if (Array.isArray(a)) a.forEach(walk); else { const i = a < 0 ? ~a : a; arcOwners[i].push(t); } };
  walk(g.arcs);
});
const [sx, sy] = topo.transform.scale, [tx, ty] = topo.transform.translate;
function decode(arc) { let x = 0, y = 0; return arc.map(([dx, dy]) => { x += dx; y += dy; return [x * sx + tx, y * sy + ty]; }); }
function simplify(pts, tol) {
  if (pts.length < 3) return pts.slice();
  const keep = new Uint8Array(pts.length); keep[0] = keep[pts.length - 1] = 1;
  const st = [[0, pts.length - 1]];
  while (st.length) {
    const [a, b] = st.pop();
    const [ax, ay] = pts[a], [bx, by] = pts[b];
    const dx = bx - ax, dy = by - ay, L = Math.hypot(dx, dy) || 1e-12;
    let md = -1, mi = -1;
    for (let i = a + 1; i < b; i++) { const d = L > 1e-12 ? Math.abs((pts[i][0] - ax) * dy - (pts[i][1] - ay) * dx) / L : Math.hypot(pts[i][0] - ax, pts[i][1] - ay); if (d > md) { md = d; mi = i; } }
    if (md > tol) { keep[mi] = 1; st.push([a, mi], [mi, b]); }
  }
  return pts.filter((_, i) => keep[i]);
}
const q = (lon, lat) => [Math.round((lon + 180) / 360 * 65535), Math.round((90 - lat) / 180 * 65535)];
const out = [];
const stats = { border: [0, 0], coast: [0, 0] };
topo.arcs.forEach((arc, i) => {
  const o = arcOwners[i];
  if (!o.length) return;
  const a = o[0], b = o.length > 1 ? o[1] : -1;
  if (b === a) return;                                           // limite interne d'un même territoire
  const pts = decode(arc);
  [[0.004, 0], [0.03, 1]].forEach(([tol, lod]) => {
    const s = simplify(pts, tol);
    if (s.length < 2) return;
    out.push(a + 1, b + 1, lod, s.length);
    for (const [lon, lat] of s) out.push(...q(lon, lat));
    stats[b < 0 ? 'coast' : 'border'][lod] += s.length;
  });
});
const buf = Buffer.from(new Uint16Array(out).buffer);
const z = zlib.deflateSync(buf, { level: 9 });
fs.writeFileSync(path.join(root, 'src/data/borders.bin'), z);
console.log(`Carte 10m : ${feats.length} objets, raster ${HW}×${HH} (${kept} pixels conservés de la carte 50m)`);
console.log(`Frontières : ${stats.border[0]} points (détail) / ${stats.border[1]} (vue large) ; côtes : ${stats.coast[0]} / ${stats.coast[1]} ; ${(z.length / 1024).toFixed(0)} Ko`);

// ---------- polygones des territoires d'origine (géométrie des territoires) ----------
// Reconstruits à partir des arcs partagés simplifiés une seule fois : deux pays voisins ont exactement la
// même frontière (aucun trou, aucun chevauchement). Format Float32 :
// [nTerr, (t, nPoly, (nRing, (nPts, lon, lat × nPts) × nRing) × nPoly) × nTerr]
const TOL_POLY = 0.012;
const simpArcs = topo.arcs.map((arc) => simplify(decode(arc), TOL_POLY));
const ringFrom = (refs) => {
  const pts = [];
  for (const r of refs) {
    const a = r < 0 ? simpArcs[~r].slice().reverse() : simpArcs[r];
    for (let k = pts.length ? 1 : 0; k < a.length; k++) pts.push(a[k]);
  }
  return pts;
};
const byTerr = new Map();
geoms.forEach((g, k) => {
  const t = featT[k]; if (t < 0 || !g.arcs) return;
  const polys = g.type === 'Polygon' ? [g.arcs] : g.type === 'MultiPolygon' ? g.arcs : [];
  for (const p of polys) {
    const rings = p.map(ringFrom).filter((r) => r.length >= 4);
    if (!rings.length) continue;
    (byTerr.get(t) || byTerr.set(t, []).get(t)).push(rings);
  }
});
// partition spatiale : les grands polygones (continents) sont découpés en tuiles de 4° ; au jeu, seules les
// tuiles proches d'un front entrent dans les opérations géométriques (les autres restent en cache)
const pcl = require('polygon-clipping');
const TILE = 4;
let tiled = 0;
for (const [t, polys] of byTerr) {
  const out = [];
  for (const rings of polys) {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const [x, y] of rings[0]) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
    if (x1 - x0 <= TILE * 2.5 && y1 - y0 <= TILE * 2.5) { out.push(rings); continue; }
    let valid;
    try { valid = pcl.union(rings); } catch (_) { out.push(rings); continue; }
    for (let x = Math.floor(x0 / TILE) * TILE; x < x1; x += TILE) for (let y = Math.floor(y0 / TILE) * TILE; y < y1; y += TILE) {
      let part;
      try { part = pcl.intersection(valid, [[[x, y], [x + TILE, y], [x + TILE, y + TILE], [x, y + TILE], [x, y]]]); } catch (_) { part = []; }
      for (const q of part) { out.push(q); tiled++; }
    }
  }
  byTerr.set(t, out);
}
console.log(`Partition spatiale : ${tiled} tuiles`);
const pf = [byTerr.size];
let nPts = 0;
for (const [t, polys] of byTerr) {
  pf.push(t, polys.length);
  for (const rings of polys) { pf.push(rings.length); for (const r of rings) { pf.push(r.length); for (const [x, y] of r) pf.push(x, y); nPts += r.length; } }
}
const pz = zlib.deflateSync(Buffer.from(new Float32Array(pf).buffer), { level: 9 });
fs.writeFileSync(path.join(root, 'src/data/territories.bin'), pz);
console.log(`Polygones des territoires : ${byTerr.size} territoires, ${nPts} points, ${(pz.length / 1024).toFixed(0)} Ko`);
