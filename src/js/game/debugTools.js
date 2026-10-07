// GAME LOGIC — outils de test automatique (utilisés par les scripts de vérification)
import { Simulation } from '../simulation/simulation.js';
import { getCountry } from '../countries/countries.js';
import { defaultConfig, effectiveStats } from './config.js';

export function runBatch(game, aId, bId, n = 10, resolution = 'moyen') {
  const a = getCountry(aId), b = getCountry(bId);
  const scene = game.getScene(a, b, resolution);
  const cfg = { ...defaultConfig(), a: aId, b: bId, resolution };
  const out = { pair: `${a.name}-${b.name}`, cells: scene.grid.counts, wins: [0, 0, 0], durations: [], ms: 0 };
  const t0 = performance.now();
  for (let k = 0; k < n; k++) {
    const sim = new Simulation(scene.grid, { seed: 'B' + k, names: [a.name, b.name], stats: effectiveStats(cfg), maxDuration: cfg.maxDuration, victoryRatio: cfg.victoryRatio });
    while (!sim.finished) { sim.step(); sim.captures.length = 0; sim.eventsOut.length = 0; }
    out.wins[sim.result.winner < 0 ? 2 : sim.result.winner]++;
    out.durations.push(Math.round(sim.result.time));
  }
  out.durations.sort((x, y) => x - y);
  out.ms = Math.round((performance.now() - t0) / n);
  return out;
}
