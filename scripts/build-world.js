// Pré-calcule la grille mondiale (0,25°) : à quel pays appartient chaque cellule de la Terre.
// Produit src/data/world-grid.bin (compressé) utilisé par le jeu.
// - grille 1440 × 720 cellules (Uint16 : index du territoire, 65535 = océan)
// - grille de navigation maritime 360 × 180 (1°) pour les routes des navires
// - « micro-nœuds » pour les pays trop petits pour une cellule (Vatican, Monaco…)
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { feature } = require('topojson-client');

const root = path.join(__dirname, '..');
const world = require('world-atlas/countries-50m.json');
const countries = JSON.parse(fs.readFileSync(path.join(root, 'src', 'data', 'countries.json'), 'utf8')).countries;

const W = 1440, H = 720, RES = 0.25;
const S = 4; // sous-échantillons par côté de cellule
const SW = W * S, SH = H * S;
const SEA = 65535;
const NAV_W = 720, NAV_H = 360; // navigation maritime à 0,5°

const features = feature(world, world.objects.countries).features;
const byAtlas = new Map();
features.forEach((f, k) => { if (f.id) byAtlas.set(f.id, k); });

// Index des territoires : 0..194 = pays jouables, puis territoires neutres (non membres de la liste des 195)
const territories = countries.map((c) => ({ kind: 'country', id: c.id, name: c.name, atlasId: c.atlasId }));
const featureToTerritory = new Map();
const countryIndexByAtlas = new Map(countries.map((c, k) => [c.atlasId, k]));
// plusieurs objets de la carte peuvent partager le même code (ex. Australie + îles Ashmore)
features.forEach((f, k) => { if (f.id && countryIndexByAtlas.has(f.id)) featureToTerritory.set(k, countryIndexByAtlas.get(f.id)); });
const NEUTRAL_NAMES_FR = {
  Greenland: 'Groenland', 'W. Sahara': 'Sahara occidental', Taiwan: 'Taïwan', Kosovo: 'Kosovo', 'N. Cyprus': 'Chypre du Nord',
  Somaliland: 'Somaliland', 'Puerto Rico': 'Porto Rico', 'New Caledonia': 'Nouvelle-Calédonie', 'Falkland Is.': 'Îles Malouines',
  'Fr. S. Antarctic Lands': 'Terres australes françaises', 'Fr. Polynesia': 'Polynésie française', 'Hong Kong': 'Hong Kong', Macao: 'Macao',
  'Faeroe Is.': 'Îles Féroé', Bermuda: 'Bermudes', 'Cayman Is.': 'Îles Caïmans', Aruba: 'Aruba', Curaçao: 'Curaçao',
};
features.forEach((f, k) => {
  if (featureToTerritory.has(k)) return;
  const name = (f.properties && f.properties.name) || 'Territoire';
  if (name === 'Antarctica') return; // non simulé
  featureToTerritory.set(k, territories.length);
  territories.push({ kind: 'neutral', id: 'N' + territories.length, name: NEUTRAL_NAMES_FR[name] || name, atlasId: f.id || null });
});

// ---------- rasterisation par balayage (règle pair-impair) ----------
// Comptage par cellule : jusqu'à 3 territoires différents par cellule
const featA = new Uint16Array(W * H).fill(SEA), cntA = new Uint16Array(W * H);
const featB = new Uint16Array(W * H).fill(SEA), cntB = new Uint16Array(W * H);
const featC = new Uint16Array(W * H).fill(SEA), cntC = new Uint16Array(W * H);
const landSamples = new Uint16Array(NAV_W * NAV_H); // pour la navigation (0,5°)

function addSample(sx, sy, t) {
  const cell = Math.floor(sy / S) * W + Math.floor(sx / S);
  if (featA[cell] === t || featA[cell] === SEA) { featA[cell] = t; cntA[cell]++; }
  else if (featB[cell] === t || featB[cell] === SEA) { featB[cell] = t; cntB[cell]++; }
  else if (featC[cell] === t || featC[cell] === SEA) { featC[cell] = t; cntC[cell]++; }
  const nav = Math.floor(sy / (S * 2)) * NAV_W + Math.floor(sx / (S * 2));
  landSamples[nav]++;
}

function ringsOf(geom) {
  if (!geom) return [];
  const polys = geom.type === 'Polygon' ? [geom.coordinates] : geom.type === 'MultiPolygon' ? geom.coordinates : [];
  const rings = [];
  for (const p of polys) for (const r of p) {
    // rend les longitudes continues (anneaux qui traversent l'antiméridien)
    const out = [];
    let offset = 0;
    for (let k = 0; k < r.length; k++) {
      let [x, y] = r[k];
      if (k > 0) {
        const prev = r[k - 1][0];
        if (x - prev > 180) offset -= 360;
        else if (prev - x > 180) offset += 360;
      }
      out.push([x + offset, y]);
    }
    rings.push(out);
  }
  return rings;
}

function rasterize(f, t, SWp = SW, SHp = SH, cb = addSample) {
  const rings = ringsOf(f.geometry);
  // tables d'arêtes par ligne d'échantillons
  const rowsEdges = new Map();
  for (const r of rings) {
    for (let k = 0; k < r.length - 1; k++) {
      const [x1, y1] = r[k], [x2, y2] = r[k + 1];
      if (y1 === y2) continue;
      // ligne d'échantillon sy : latitude 90 - (sy + 0.5) * 180 / SH
      const syA = (90 - Math.max(y1, y2)) * SHp / 180 - 0.5;
      const syB = (90 - Math.min(y1, y2)) * SHp / 180 - 0.5;
      for (let sy = Math.max(0, Math.ceil(syA)); sy <= Math.min(SHp - 1, Math.floor(syB)); sy++) {
        const lat = 90 - (sy + 0.5) * 180 / SHp;
        if ((lat < Math.min(y1, y2)) || (lat >= Math.max(y1, y2))) continue;
        const x = x1 + (lat - y1) / (y2 - y1) * (x2 - x1);
        let arr = rowsEdges.get(sy);
        if (!arr) rowsEdges.set(sy, (arr = []));
        arr.push(x);
      }
    }
  }
  for (const [sy, xs] of rowsEdges) {
    xs.sort((a, b) => a - b);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      const a = (xs[k] + 180) * SWp / 360 - 0.5, b = (xs[k + 1] + 180) * SWp / 360 - 0.5;
      for (let sx = Math.ceil(a); sx <= Math.floor(b); sx++) {
        const wx = ((sx % SWp) + SWp) % SWp;
        cb(wx, sy, t);
      }
    }
  }
}

const t0 = Date.now();
features.forEach((f, k) => {
  if (!featureToTerritory.has(k)) return;
  rasterize(f, featureToTerritory.get(k));
});

// ---------- attribution des cellules ----------
const cells = new Uint16Array(W * H).fill(SEA);
const THRESH = 4; // au moins 25 % de la cellule couverte de terre
for (let c = 0; c < W * H; c++) {
  const total = cntA[c] + cntB[c] + cntC[c];
  if (total < THRESH) continue;
  let best = featA[c], bc = cntA[c];
  if (cntB[c] > bc) { best = featB[c]; bc = cntB[c]; }
  if (cntC[c] > bc) { best = featC[c]; bc = cntC[c]; }
  cells[c] = best;
}

const cellCount = new Uint32Array(territories.length);
for (let c = 0; c < W * H; c++) if (cells[c] !== SEA) cellCount[cells[c]]++;

const cellOf = (lat, lon) => {
  const x = Math.min(W - 1, Math.max(0, Math.floor((lon + 180) / RES)));
  const y = Math.min(H - 1, Math.max(0, Math.floor((90 - lat) / RES)));
  return y * W + x;
};

// Pays trop petits : île -> cellule créée ; enclave -> micro-nœud
const micro = [];
countries.forEach((c, t) => {
  if (cellCount[t] > 0) return;
  // cellule où le pays a le plus d'échantillons
  let best = -1, bc = 0;
  for (let k = 0; k < W * H; k++) {
    const n = featA[k] === t ? cntA[k] : featB[k] === t ? cntB[k] : featC[k] === t ? cntC[k] : 0;
    if (n > bc) { bc = n; best = k; }
  }
  if (best < 0) best = cellOf(c.capital.lat, c.capital.lon);
  if (cells[best] === SEA) { cells[best] = t; cellCount[t]++; }
  else micro.push({ t, lat: c.capital.lat, lon: c.capital.lon, host: best });
});

// ---------- navigation maritime (1°) ----------
const nav = new Uint8Array(NAV_W * NAV_H);
const perNav = (S * 2) * (S * 2);
// navigable si la mer occupe au moins 60 % de la case : les navires ne coupent plus à travers les terres
for (let k = 0; k < NAV_W * NAV_H; k++) nav[k] = landSamples[k] <= perNav * 0.4 ? 1 : 0;
// passages étroits forcés (détroits et canaux), tracés comme des chenaux continus
const channels = [
  [[35.95, -6.3], [35.95, -5.2]],                 // Gibraltar
  [[40.05, 26.15], [40.45, 26.75], [40.7, 27.8]], // Dardanelles
  [[40.95, 28.95], [41.25, 29.1], [41.35, 29.2]], // Bosphore
  [[31.4, 32.35], [30.6, 32.35], [29.9, 32.55]],  // Suez
  [[9.4, -79.95], [9.1, -79.7], [8.85, -79.5]],   // Panama
  [[56.1, 12.6], [55.5, 12.8]],                   // Øresund
  [[55.9, 10.9], [55.1, 10.9]],                   // Grand Belt
  [[45.45, 36.55], [45.2, 36.5]],                 // Kertch
  [[26.9, 56.1], [26.3, 56.5]],                   // Ormuz
  [[12.8, 43.3], [12.4, 43.5]],                   // Bab-el-Mandeb
  [[38.3, 15.6], [37.9, 15.6]],                   // Messine
  [[41.35, 9.1], [41.3, 9.4]],                    // Bonifacio
  [[51.1, 1.3], [50.9, 1.6]],                     // Pas de Calais
  [[1.25, 103.6], [1.2, 104.2]],                  // Singapour
  [[-10.4, 142.1], [-10.6, 142.4]],               // Torrès
  [[65.9, -169.5], [66.1, -168.5]],               // Béring
];
for (const pts of channels) {
  for (let k = 1; k < pts.length; k++) {
    const [a0, b0] = pts[k - 1], [a1, b1] = pts[k];
    const steps = Math.ceil(Math.max(Math.abs(a1 - a0), Math.abs(b1 - b0)) / 0.1) + 1;
    for (let t = 0; t <= steps; t++) {
      const lat = a0 + (a1 - a0) * t / steps, lon = b0 + (b1 - b0) * t / steps;
      const x = Math.floor((lon + 180) * NAV_W / 360), y = Math.floor((90 - lat) * NAV_H / 180);
      if (x >= 0 && y >= 0 && x < NAV_W && y < NAV_H) nav[y * NAV_W + x] = 1;
    }
  }
}

// ---------- écriture ----------
const header = {
  version: 1, W, H, RES, SEA, NAV_W, NAV_H,
  territories: territories.map((t) => ({ kind: t.kind, id: t.id, name: t.name, atlasId: t.atlasId })),
  micro,
};
const headerBuf = Buffer.from(JSON.stringify(header), 'utf8');
const lenBuf = Buffer.alloc(4); lenBuf.writeUInt32LE(headerBuf.length, 0);
const pad = Buffer.alloc((4 - ((4 + headerBuf.length) % 4)) % 4);
const raw = Buffer.concat([lenBuf, headerBuf, pad, Buffer.from(cells.buffer), Buffer.from(nav.buffer)]);
const out = zlib.deflateSync(raw, { level: 9 });
fs.writeFileSync(path.join(root, 'src', 'data', 'world-grid.bin'), out);

// ---------- carte haute résolution des vraies frontières (affichage uniquement) ----------
// 8192 × 4096 (≈ 5 km) : identifiant du territoire d'origine par pixel, 255 = mer
const HW = 8192, HH = 4096;
const hires = new Uint8Array(HW * HH).fill(255);
features.forEach((f, k) => {
  if (!featureToTerritory.has(k)) return;
  const t = featureToTerritory.get(k);
  if (t > 254) return;
  rasterize(f, t, HW, HH, (x, y, tt) => { hires[y * HW + x] = tt; });
});
const hiOut = zlib.deflateSync(Buffer.from(hires.buffer), { level: 9 });
fs.writeFileSync(path.join(root, 'src', 'data', 'world-hires.bin'), hiOut);
console.log(`Carte haute résolution : ${HW}×${HH}, ${(hiOut.length / 1024).toFixed(0)} Ko`);

const land = cells.reduce((s, v) => s + (v !== SEA ? 1 : 0), 0);
const missing = countries.filter((c, t) => cellCount[t] === 0 && !micro.some((m) => m.t === t)).map((c) => c.name);
console.log(`Grille mondiale : ${land} cellules terrestres, ${territories.length} territoires (${countries.length} pays), ${micro.length} micro-pays, ${(out.length / 1024).toFixed(0)} Ko, ${Date.now() - t0} ms`);
if (missing.length) console.log('Pays sans cellule :', missing.join(', '));
if (process.argv.includes('--verbose')) {
  countries.forEach((c, t) => console.log(c.name.padEnd(22), cellCount[t]));
  console.log('micro:', micro.map((m) => countries[m.t].name).join(', '));
}
if (process.argv.includes('--probe')) {
  const k = cellOf(-25, 135);
  console.log('probe', territories[featA[k]] && territories[featA[k]].name, cntA[k], featB[k] !== SEA && territories[featB[k]].name, cntB[k], featC[k] !== SEA && territories[featC[k]].name, cntC[k], 'owner', cells[k] !== SEA && territories[cells[k]].name);
}
