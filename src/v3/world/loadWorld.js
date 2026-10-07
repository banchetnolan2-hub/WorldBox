// WORLD — chargement des données embarquées (grille mondiale + pays)
import gridBin from '../../data/world-grid.bin';
import hiresBin from '../../data/world-hires.bin';
import reliefBin from '../../data/world-relief.bin';
import bordersBin from '../../data/borders.bin';
import maskBin from '../../data/land-mask.bin';
import terrBin from '../../data/territories.bin';
import { Relief } from './relief.js';
import countriesData from '../../data/countries.json';
import { inflate, parseWorldGrid } from './worldGrid.js';
import { Navigator } from './navigation.js';

export async function loadWorldData() {
  const raw = await inflate(gridBin);
  const grid = parseWorldGrid(raw);
  const nav = new Navigator(grid);
  const hires = { W: 8192, H: 4096, data: await inflate(hiresBin) };
  const relief = new Relief(await inflate(reliefBin));
  const b8 = await inflate(bordersBin);
  const borders = new Uint16Array(b8.slice().buffer, 0, b8.length >> 1);
  hires.mask = await inflate(maskBin);   // terre/mer 16384 × 8192, 1 bit par pixel
  const t8 = await inflate(terrBin);
  const territories = new Float32Array(t8.slice().buffer, 0, t8.length >> 2);   // polygones des pays d'origine
  return { grid, nav, countriesData, hires, relief, borders, territories };
}
