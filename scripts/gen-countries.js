// Génère src/data/countries.json (196 pays) à partir de scripts/data/countries195.txt.
// Les statistiques sont abstraites (jeu) : dérivées de la population et d'un niveau économique,
// avec une variation déterministe par pays. Les 69 pays de la V2 gardent leurs statistiques réglées à la main.
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
const lines = fs.readFileSync(path.join(__dirname, 'data', 'countries195.txt'), 'utf8').split(/\r?\n/).filter((l) => l && !l.startsWith('#'));
const v2 = JSON.parse(fs.readFileSync(path.join(__dirname, 'data', 'countries-v2.json'), 'utf8'));
const v2ById = new Map(v2.countries.map((c) => [c.id, c]));

function hash(str, salt) {
  let h = 2166136261 ^ salt;
  for (const ch of str) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619) >>> 0; }
  h ^= h >>> 13; h = Math.imul(h, 1274126177) >>> 0;
  return (h % 10000) / 10000;
}
const clamp = (v, a, b) => Math.max(a, Math.min(b, Math.round(v)));
function hsl(h, s, l) {
  const a = s * Math.min(l, 1 - l);
  const f = (n) => { const k = (n + h / 30) % 12; return Math.round(255 * (l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1)))); };
  return '#' + [f(0), f(8), f(4)].map((x) => x.toString(16).padStart(2, '0')).join('');
}

const out = [];
for (const line of lines) {
  const [num, iso2, name, continent, capName, lat, lon, popM, eco] = line.split('|');
  const p = Number(popM), e = Number(eco);
  const r = (k) => hash(iso2, k);
  const lp = Math.log10(p + 0.1);
  const derived = {
    puissance: clamp(10 + e * 9 + 14 * lp + r(1) * 6, 8, 95),
    economie: clamp(10 + e * 13 + 4 * Math.log10(p + 1) + r(2) * 8, 8, 95),
    ressources: clamp(28 + e * 6 + r(3) * 30, 10, 95),
    stabilite: clamp(28 + e * 10 + r(4) * 16, 10, 95),
    mobilite: clamp(34 + e * 7 + r(5) * 16, 10, 95),
    defense: clamp(30 + e * 6 + 7 * Math.max(0, lp) + r(6) * 10, 10, 95),
    expansion: clamp(35 + r(7) * 30, 10, 95),
    vitesse: clamp(40 + e * 4 + r(8) * 16, 10, 95),
  };
  const old = v2ById.get(iso2);
  const stats = old ? { ...derived, ...old.stats } : derived;
  const hue = r(9) * 360;
  out.push({
    id: iso2,
    atlasId: num,
    iso2,
    name,
    continent,
    color: old ? old.color : hsl(hue, 0.62, 0.52),
    color2: old ? old.color2 : hsl((hue + 40) % 360, 0.55, 0.68),
    capital: { name: capName, lat: Number(lat), lon: Number(lon) },
    population: Math.round(p * 1e6 * (0.92 + r(10) * 0.16)),
    stats,
  });
}
// pays et territoires promus (zones neutres de la carte devenues jouables, même index de territoire)
const promoted = [];
const plines = fs.existsSync(path.join(__dirname, 'data', 'promoted.txt')) ? fs.readFileSync(path.join(__dirname, 'data', 'promoted.txt'), 'utf8').split(/\r?\n/).filter((l) => l && !l.startsWith('#')) : [];
for (const line of plines) {
  const [mapName, id, flag, continent, capName, lat, lon, popM, eco, drawn] = line.split('|');
  const p = Number(popM), e = Number(eco);
  const r = (k) => hash(id, k);
  const lp = Math.log10(p + 0.1);
  const stats = {
    puissance: clamp(10 + e * 9 + 14 * lp + r(1) * 6, 8, 95), economie: clamp(10 + e * 13 + 4 * Math.log10(p + 1) + r(2) * 8, 8, 95),
    ressources: clamp(28 + e * 6 + r(3) * 30, 10, 95), stabilite: clamp(28 + e * 10 + r(4) * 16, 10, 95), mobilite: clamp(34 + e * 7 + r(5) * 16, 10, 95),
    defense: clamp(30 + e * 6 + 7 * Math.max(0, lp) + r(6) * 10, 10, 95), expansion: clamp(35 + r(7) * 30, 10, 95), vitesse: clamp(40 + e * 4 + r(8) * 16, 10, 95),
  };
  const hue = r(9) * 360;
  const flagSpec = drawn ? { layout: drawn.split(':')[0], colors: drawn.split(':')[1].split(',') } : undefined;
  promoted.push({ mapName, id, iso2: flag || '', name: mapName, continent, color: hsl(hue, 0.62, 0.52), color2: hsl((hue + 40) % 360, 0.55, 0.68), capital: { name: capName, lat: Number(lat), lon: Number(lon) }, population: Math.round(p * 1e6 * (0.92 + r(10) * 0.16)), stats, ...(flagSpec ? { flagSpec } : {}) });
}
const data = {
  _doc: 'Base des 196 pays (193 membres de l\'ONU + Saint-Siège + Palestine + Groenland). Pour ajouter/modifier un pays : id et iso2 (drapeau), atlasId (code ISO 3166 numérique), nom, continent, couleurs de secours, capitale (lat/lon), population de simulation, statistiques 0-100. Statistiques et populations sont des valeurs de jeu.',
  statKeys: ['puissance', 'economie', 'ressources', 'stabilite', 'mobilite', 'defense', 'expansion', 'vitesse'],
  continents: ['Europe', 'Asie', 'Afrique', 'Amérique du Nord', 'Amérique du Sud', 'Océanie'],
  countries: out,
  // zones de la carte promues en pays jouables (Kosovo, Taïwan, Sahara occidental, Chypre du Nord, Nouvelle-Calédonie,
  // Porto Rico, Hong Kong, Somaliland) : elles gardent leur index de territoire (sauvegardes compatibles)
  promoted,
};
fs.writeFileSync(path.join(root, 'src', 'data', 'countries.json'), JSON.stringify(data, null, 1));
console.log(out.length + ' pays + ' + promoted.length + ' territoires promus écrits');
