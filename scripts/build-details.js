// Détails géographiques de la Terre (Natural Earth, domaine public) :
//  - villes (populated places) : nom, position, population, capitale nationale / régionale, région (admin-1)
//  - ports (ne_10m_ports)
//  - lacs (ne_50m_lakes), contours simplifiés
// Usage : node scripts/build-details.js -> src/data/details.json
const fs = require('fs');
const path = require('path');
const dir = path.join(__dirname, 'data', 'sources');
const countries = require('../src/data/countries.json').countries;
const iso = require('./data/sources/iso-map.json');
const J = (f) => JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));

const byIso2 = new Map(countries.map((c) => [String(c.iso2 || '').toUpperCase(), c.id]));
const byA3 = new Map(Object.entries(iso).map(([id, v]) => [v.a3, id]));
const EXTRA = { SDS: 'SS', KOS: 'XK', SAH: 'EH', PSX: 'PS', CYN: 'CY', SOL: 'SO', KAB: 'KZ' };
function countryOf(p) {
  const a2 = String(p.iso_a2 || '').toUpperCase();
  if (byIso2.has(a2)) return byIso2.get(a2);
  if (byA3.has(p.adm0_a3)) return byA3.get(p.adm0_a3);
  if (EXTRA[p.adm0_a3] && countries.some((c) => c.id === EXTRA[p.adm0_a3])) return EXTRA[p.adm0_a3];
  if (byA3.has(p.sov_a3)) return byA3.get(p.sov_a3);
  return null;
}
const r4 = (v) => Math.round(v * 1e4) / 1e4;

// ---------- ports ----------
const ports = J('ports.geojson').features.map((f) => ({ name: f.properties.name, lon: f.geometry.coordinates[0], lat: f.geometry.coordinates[1], rank: f.properties.scalerank }));
function nearPort(lat, lon) {
  for (const p of ports) {
    const d = Math.hypot((p.lat - lat), (p.lon - lon) * Math.cos(lat * Math.PI / 180));
    if (d < 0.25) return true;
  }
  return false;
}

// ---------- villes ----------
const pp = J('pp.geojson').features;
const per = new Map();
for (const f of pp) {
  const p = f.properties;
  const id = countryOf(p);
  if (!id) continue;
  const lon = f.geometry.coordinates[0], lat = f.geometry.coordinates[1];
  const pop = Math.max(p.pop_max || 0, p.pop_min || 0);
  let flags = 0;
  if (p.adm0cap === 1) flags |= 1;
  if (/Admin-1/.test(p.featurecla)) flags |= 2;
  if (p.worldcity || p.megacity) flags |= 8;
  if (nearPort(lat, lon)) flags |= 4;
  const list = per.get(id) || [];
  list.push({ name: p.name, lat: r4(lat), lon: r4(lon), pop, flags, adm1: p.adm1name || '', rank: p.scalerank });
  per.set(id, list);
}
const cities = [];
for (const [id, list] of per) {
  list.sort((a, b) => (b.flags & 1) - (a.flags & 1) || b.pop - a.pop);
  // grandes villes, capitales régionales (définissent les régions) et villes secondaires
  const keep = [];
  const seen = new Set();
  for (const c of list) {
    const big = c.pop >= 250000 || (c.flags & 1);
    const regionCap = (c.flags & 2) && !list.some((o) => o !== c && o.adm1 === c.adm1 && (o.flags & 2) && o.pop > c.pop);
    if (big || regionCap || keep.length < 12) {
      const key = c.name + c.adm1;
      if (seen.has(key)) continue;
      seen.add(key); keep.push(c);
    }
    if (keep.length >= 70) break;
  }
  for (const c of keep) cities.push([c.name, c.lat, c.lon, Math.round(c.pop), c.flags, id, c.adm1]);
}

// ---------- lacs (anneau extérieur simplifié) ----------
function simplify(ring, tol) {
  if (ring.length < 4) return ring;
  const keep = new Uint8Array(ring.length); keep[0] = keep[ring.length - 1] = 1;
  const st = [[0, ring.length - 1]];
  while (st.length) {
    const [a, b] = st.pop();
    let md = -1, mi = -1;
    const [x1, y1] = ring[a], [x2, y2] = ring[b];
    const L = Math.hypot(x2 - x1, y2 - y1) || 1e-9;
    for (let i = a + 1; i < b; i++) {
      const d = L < 1e-6 ? Math.hypot(ring[i][0] - x1, ring[i][1] - y1) : Math.abs((y2 - y1) * ring[i][0] - (x2 - x1) * ring[i][1] + x2 * y1 - y2 * x1) / L;
      if (d > md) { md = d; mi = i; }
    }
    if (md > tol) { keep[mi] = 1; st.push([a, mi], [mi, b]); }
  }
  return ring.filter((_, i) => keep[i]);
}
const lakes = [];
for (const f of J('lakes.geojson').features) {
  const g = f.geometry;
  const polys = g.type === 'Polygon' ? [g.coordinates] : g.coordinates;
  for (const poly of polys) {
    const ring = simplify(poly[0], 0.04).map(([x, y]) => [r4(x), r4(y)]);
    if (ring.length < 4) continue;
    lakes.push([f.properties.name_fr || f.properties.name || '', ring]);
  }
}

const out = {
  meta: { source: 'Natural Earth (domaine public) : populated places, ports, lakes', generated: new Date().toISOString().slice(0, 10) },
  cities, ports: ports.map((p) => [p.name, r4(p.lat), r4(p.lon), p.rank]), lakes,
};
fs.writeFileSync(path.join(__dirname, '..', 'src', 'data', 'details.json'), JSON.stringify(out));
console.log(`villes ${cities.length} (${per.size} pays), ports ${ports.length}, lacs ${lakes.length}, ${(JSON.stringify(out).length / 1024).toFixed(0)} Ko`);
const miss = countries.filter((c) => !per.has(c.id)).map((c) => c.id);
console.log('pays sans ville :', miss.join(' '));
