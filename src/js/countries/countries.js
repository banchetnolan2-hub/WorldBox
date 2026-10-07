// COUNTRIES — accès aux données des pays (src/data/countries.json)
import rawData from '../../data/countries.json';
import { geoArea } from 'd3-geo';
import { feature } from 'topojson-client';
import world from 'world-atlas/countries-50m.json';

// Mode classique 2D : seuls les pays présents sur la carte 2D et assez grands pour y être découpés
const features = feature(world, world.objects.countries).features;
const areaByAtlas = new Map();
for (const f of features) if (f.id) areaByAtlas.set(f.id, (areaByAtlas.get(f.id) || 0) + geoArea(f));
const data = { ...rawData, countries: rawData.countries.filter((c) => (areaByAtlas.get(c.atlasId) || 0) > 2e-5) };

const byId = new Map();
const byAtlas = new Map();
for (const c of data.countries) {
  byId.set(c.id, c);
  byAtlas.set(String(c.atlasId).padStart(3, '0'), c);
}

export const STAT_KEYS = data.statKeys;

export function allCountries() {
  return [...data.countries].sort((a, b) => a.name.localeCompare(b.name, 'fr'));
}

export function getCountry(id) {
  return byId.get(id) || null;
}

export function countryByAtlasId(atlasId) {
  return byAtlas.get(String(atlasId).padStart(3, '0')) || null;
}

export function flagUrl(country) {
  return `assets/flags/${(country.flag || country.iso2).toLowerCase()}.svg`;
}

// ----- couleurs -----
export function hexToRgb(hex) {
  const h = hex.replace('#', '');
  const v = parseInt(h.length === 3 ? h.split('').map((x) => x + x).join('') : h, 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
}

function colorDistance(a, b) {
  const [r1, g1, b1] = hexToRgb(a), [r2, g2, b2] = hexToRgb(b);
  const rm = (r1 + r2) / 2;
  return Math.sqrt((2 + rm / 256) * (r1 - r2) ** 2 + 4 * (g1 - g2) ** 2 + (2 + (255 - rm) / 256) * (b1 - b2) ** 2);
}

// Évite deux couleurs trop proches (ex. deux pays rouges)
export function resolveColors(a, b) {
  let ca = a.color, cb = b.color;
  if (colorDistance(ca, cb) < 150) {
    const options = [
      [a.color, b.color2], [a.color2, b.color], [a.color2, b.color2],
    ];
    let best = options[0], bestD = -1;
    for (const o of options) {
      const d = colorDistance(o[0], o[1]);
      if (d > bestD) { bestD = d; best = o; }
    }
    [ca, cb] = best;
    if (bestD < 150) cb = '#e8e8e8' === ca ? '#222' : '#f2f2f2';
  }
  // très clair : on assombrit légèrement pour garder des frontières lisibles
  return [ca, cb];
}

// Paires voisines pour le mode spectateur (capitales à moins de ~2000 km)
export function randomPair(rng = Math.random) {
  const list = data.countries;
  for (let tries = 0; tries < 200; tries++) {
    const a = list[Math.floor(rng() * list.length)];
    const near = list.filter((b) => b !== a && distanceKm(a.capital, b.capital) < 1900);
    if (near.length) return [a, near[Math.floor(rng() * near.length)]];
  }
  return [list[0], list[1]];
}

export function distanceKm(p, q) {
  const R = 6371, toR = Math.PI / 180;
  const dLat = (q.lat - p.lat) * toR, dLon = (q.lon - p.lon) * toR;
  const x = Math.sin(dLat / 2) ** 2 + Math.cos(p.lat * toR) * Math.cos(q.lat * toR) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
}
