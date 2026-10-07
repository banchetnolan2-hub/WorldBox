// MAP — construction de la scène : projection, formes vectorielles, grille territoriale
import { geoAzimuthalEqualArea, geoPath, geoCentroid, geoDistance, geoArea, geoGraticule10 } from 'd3-geo';
import { feature, mesh } from 'topojson-client';
import world from 'world-atlas/countries-50m.json';
import { buildGrid } from './grid.js';
import { countryByAtlasId } from '../countries/countries.js';

export const WORLD_W = 1600;
export const WORLD_H = 1000;
const EARTH_KM = 6371;

export const RESOLUTIONS = {
  grand: { label: 'Grandes parcelles', cells: 3500 },
  moyen: { label: 'Parcelles moyennes', cells: 7000 },
  petit: { label: 'Petites parcelles (détaillé)', cells: 13000 },
};

let worldCache = null;
function getWorld() {
  if (!worldCache) {
    const features = feature(world, world.objects.countries).features;
    worldCache = {
      features,
      borders: mesh(world, world.objects.countries, (a, b) => a !== b),
      coasts: mesh(world, world.objects.countries, (a, b) => a === b),
    };
  }
  return worldCache;
}

export function findFeature(atlasId) {
  const id = String(atlasId).padStart(3, '0');
  // plusieurs objets peuvent partager un code (ex. Australie + îles Ashmore) : on garde le plus grand
  const list = getWorld().features.filter((f) => f.id === id);
  if (!list.length) return null;
  return list.reduce((m, f) => (geoArea(f) > geoArea(m) ? f : m), list[0]);
}

function polygonsOf(geom) {
  if (!geom) return [];
  if (geom.type === 'Polygon') return [geom.coordinates];
  if (geom.type === 'MultiPolygon') return geom.coordinates;
  return [];
}

// Garde la partie principale d'un pays (retire les territoires très éloignés : outre-mer, etc.)
export function mainlandFeature(f, maxKm) {
  const polys = polygonsOf(f.geometry);
  if (polys.length <= 1) return f;
  const infos = polys.map((coords) => {
    const g = { type: 'Polygon', coordinates: coords };
    return { coords, area: geoArea(g), centroid: geoCentroid(g) };
  });
  const main = infos.reduce((m, p) => (p.area > m.area ? p : m), infos[0]);
  let radius = 0;
  const ring = main.coords[0];
  const stepR = Math.max(1, Math.floor(ring.length / 200));
  for (let k = 0; k < ring.length; k += stepR) radius = Math.max(radius, geoDistance(main.centroid, ring[k]) * EARTH_KM);
  const limit = maxKm || Math.max(1500, radius * 1.3);
  const kept = infos.filter((p) => p === main || geoDistance(p.centroid, main.centroid) * EARTH_KM <= limit);
  return { type: 'Feature', id: f.id, properties: f.properties, geometry: { type: 'MultiPolygon', coordinates: kept.map((p) => p.coords) } };
}

function largestPolygonCentroid(path, f) {
  const polys = polygonsOf(f.geometry);
  let best = null, bestA = -1;
  for (const coords of polys) {
    const g = { type: 'Polygon', coordinates: coords };
    const a = path.area(g);
    if (a > bestA) { bestA = a; best = g; }
  }
  return best ? path.centroid(best) : path.centroid(f);
}

export function buildScene(countryA, countryB, options = {}) {
  const resolution = RESOLUTIONS[options.resolution] ? options.resolution : 'moyen';
  const w = getWorld();
  const rawA = findFeature(countryA.atlasId);
  const rawB = findFeature(countryB.atlasId);
  if (!rawA || !rawB) throw new Error('Pays introuvable dans la carte');
  const fa = mainlandFeature(rawA, countryA.maxDistanceKm);
  const fb = mainlandFeature(rawB, countryB.maxDistanceKm);
  const both = { type: 'FeatureCollection', features: [fa, fb] };

  const center = geoCentroid(both);
  const margin = 70;
  const projection = geoAzimuthalEqualArea()
    .rotate([-center[0], -center[1]])
    .clipAngle(100)
    .precision(0.3)
    .fitExtent([[margin, margin], [WORLD_W - margin, WORLD_H - margin]], both);
  const path = geoPath(projection);

  // ---- formes vectorielles ----
  const strA = path(fa) || '';
  const strB = path(fb) || '';
  const landA = new Path2D(strA);
  const landB = new Path2D(strB);
  const landAB = new Path2D(strA + strB);

  const viewMin = -WORLD_W * 1.2, viewMax = WORLD_W * 2.2;
  let neutralStr = '';
  const labels = [];
  for (const f of w.features) {
    const b = path.bounds(f);
    if (!isFinite(b[0][0]) || b[1][0] < viewMin || b[0][0] > viewMax || b[1][1] < -WORLD_H * 1.2 || b[0][1] > WORLD_H * 2.2) continue;
    const s = path(f);
    if (!s) continue;
    neutralStr += s;
    if (f.id === rawA.id || f.id === rawB.id) continue;
    const area = path.area(f);
    if (area < 120) continue;
    const c = largestPolygonCentroid(path, f);
    if (!isFinite(c[0])) continue;
    const known = countryByAtlasId(f.id);
    labels.push({ x: c[0], y: c[1], name: known ? known.name : (f.properties && f.properties.name) || '', area });
  }
  const neutral = new Path2D(neutralStr);
  const borders = new Path2D(path(w.borders) || '');
  const graticule = new Path2D(path(geoGraticule10()) || '');
  const sphere = new Path2D(path({ type: 'Sphere' }) || '');

  // ---- grille territoriale ----
  const areaA = path.area(fa), areaB = path.area(fb);
  const total = areaA + areaB;
  const target = RESOLUTIONS[resolution].cells;
  let s = Math.sqrt(total / target);
  s = Math.min(s, Math.sqrt(Math.min(areaA, areaB) / 45)); // le plus petit pays garde assez de cellules
  s = Math.max(s, Math.sqrt(total / 42000));                // plafond de performance
  const bA = path.bounds(fa), bB = path.bounds(fb);
  const x0 = Math.min(bA[0][0], bB[0][0]) - s, y0 = Math.min(bA[0][1], bB[0][1]) - s;
  const x1 = Math.max(bA[1][0], bB[1][0]) + s, y1 = Math.max(bA[1][1], bB[1][1]) + s;
  const gw = Math.ceil((x1 - x0) / s), gh = Math.ceil((y1 - y0) / s);

  const SS = 3; // sur-échantillonnage pour mesurer la couverture de chaque cellule
  const canvas = document.createElement('canvas');
  canvas.width = gw * SS; canvas.height = gh * SS;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.setTransform(SS / s, 0, 0, SS / s, -x0 * SS / s, -y0 * SS / s);
  ctx.globalCompositeOperation = 'lighter';
  ctx.fillStyle = '#ff0000'; ctx.fill(landA);
  ctx.fillStyle = '#0000ff'; ctx.fill(landB);
  const px = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
  const mask = new Int8Array(gw * gh).fill(-1);
  const coverA = new Float32Array(gw * gh), coverB = new Float32Array(gw * gh);
  for (let y = 0; y < gh; y++) {
    for (let x = 0; x < gw; x++) {
      let ra = 0, rb = 0;
      for (let sy = 0; sy < SS; sy++) {
        const row = ((y * SS + sy) * canvas.width + x * SS) * 4;
        for (let sx = 0; sx < SS; sx++) { ra += px[row + sx * 4]; rb += px[row + sx * 4 + 2]; }
      }
      ra /= 255; rb /= 255;
      coverA[y * gw + x] = ra; coverB[y * gw + x] = rb;
      if (Math.max(ra, rb) >= 1.6) mask[y * gw + x] = ra >= rb ? 0 : 1;
    }
  }
  const proj = (c) => {
    const p = projection([c.lon, c.lat]);
    return p ? { x: (p[0] - x0) / s - 0.5, y: (p[1] - y0) / s - 0.5 } : null;
  };
  const grid = buildGrid({ gw, gh, mask, cellSize: s, originX: x0, originY: y0, capitals: [proj(countryA.capital), proj(countryB.capital)] });

  // pixels « débordants » : bords de côte non couverts par une cellule, colorés comme la cellule la plus proche
  const bleedPix = [], bleedSrc = [];
  for (let y = 0; y < gh; y++) {
    for (let x = 0; x < gw; x++) {
      const p = y * gw + x;
      if (grid.indexAt[p] >= 0) continue;
      if (coverA[p] + coverB[p] < 0.05) {
        // pas de terre ici : on vérifie quand même les voisins pour lisser la côte
      }
      let best = -1, bestD = 99;
      for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= gw || ny >= gh) continue;
        const j = grid.indexAt[ny * gw + nx];
        if (j < 0) continue;
        const d = dx * dx + dy * dy;
        if (d < bestD) { bestD = d; best = j; }
      }
      if (best >= 0) { bleedPix.push(p); bleedSrc.push(best); }
    }
  }
  // index inversé cellule -> pixels débordants
  const bleedStart = new Int32Array(grid.n + 1);
  for (const c of bleedSrc) bleedStart[c + 1]++;
  for (let i = 0; i < grid.n; i++) bleedStart[i + 1] += bleedStart[i];
  const bleedList = new Int32Array(bleedPix.length);
  const fillPos = bleedStart.slice(0, grid.n);
  for (let k = 0; k < bleedPix.length; k++) bleedList[fillPos[bleedSrc[k]]++] = bleedPix[k];

  // frontière d'origine (pointillés)
  const originBorder = new Path2D();
  for (let i = 0; i < grid.n; i++) {
    for (const d of [0, 2]) {
      const j = grid.neighbors[i * 8 + d];
      if (j < 0 || grid.origin[j] === grid.origin[i]) continue;
      const x = x0 + grid.gx[i] * s, y = y0 + grid.gy[i] * s;
      if (d === 0) { originBorder.moveTo(x + s, y); originBorder.lineTo(x + s, y + s); }
      else { originBorder.moveTo(x, y + s); originBorder.lineTo(x + s, y + s); }
    }
  }

  const capitalPos = [countryA, countryB].map((c) => {
    const p = projection([c.capital.lon, c.capital.lat]);
    return p ? { x: p[0], y: p[1], name: c.capital.name } : null;
  });

  return {
    countries: [countryA, countryB],
    resolution,
    projection, path,
    land: [landA, landB], landAB,
    neutral, borders, graticule, sphere, labels,
    grid, bleedStart, bleedList,
    originBorder,
    capitalPos,
    bounds: [[x0, y0], [x1, y1]],
    world: { w: WORLD_W, h: WORLD_H },
  };
}
