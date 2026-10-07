// GAME LOGIC — configuration d'une partie
import { getCountry } from '../countries/countries.js';
import { randomSeedString } from '../simulation/rng.js';

export const EVENT_LEVELS = [
  { value: 0, label: 'Aucun' },
  { value: 0.6, label: 'Rares' },
  { value: 1, label: 'Normaux' },
  { value: 1.8, label: 'Fréquents' },
  { value: 3, label: 'Très fréquents' },
];

export function defaultConfig() {
  return {
    a: 'FR',
    b: 'ES',
    stats: null,          // statistiques modifiées (sinon celles des données pays)
    statsFor: null,       // "A|B" : les statistiques modifiées ne valent que pour cette paire
    powerMult: [1, 1],
    speed: 1,
    eventRate: 1,
    resolution: 'moyen',
    maxDuration: 300,
    randomness: 0.5,
    seed: randomSeedString(),
    victoryRatio: 0.35,
  };
}

export function sanitizeConfig(cfg) {
  const d = defaultConfig();
  const c = { ...d, ...(cfg || {}) };
  if (!getCountry(c.a)) c.a = d.a;
  if (!getCountry(c.b) || c.b === c.a) c.b = c.a === 'ES' ? 'FR' : 'ES';
  if (!Array.isArray(c.powerMult) || c.powerMult.length !== 2) c.powerMult = [1, 1];
  c.powerMult = c.powerMult.map((v) => Math.min(2, Math.max(0.5, Number(v) || 1)));
  if (![0.5, 1, 2, 4, 8].includes(c.speed)) c.speed = 1;
  c.eventRate = Math.min(3, Math.max(0, Number(c.eventRate)));
  if (!Number.isFinite(c.eventRate)) c.eventRate = 1;
  if (!['grand', 'moyen', 'petit'].includes(c.resolution)) c.resolution = 'moyen';
  c.maxDuration = Math.min(900, Math.max(60, Number(c.maxDuration) || 300));
  c.randomness = Math.min(1, Math.max(0, Number(c.randomness)));
  if (!Number.isFinite(c.randomness)) c.randomness = 0.5;
  c.victoryRatio = Math.min(0.6, Math.max(0.05, Number(c.victoryRatio) || 0.35));
  c.seed = String(c.seed || randomSeedString()).slice(0, 24);
  if (c.stats && c.statsFor !== `${c.a}|${c.b}`) { c.stats = null; c.statsFor = null; }
  return c;
}

export function effectiveStats(cfg) {
  const A = getCountry(cfg.a), B = getCountry(cfg.b);
  if (cfg.stats && cfg.statsFor === `${cfg.a}|${cfg.b}`) return [{ ...A.stats, ...cfg.stats[0] }, { ...B.stats, ...cfg.stats[1] }];
  return [{ ...A.stats }, { ...B.stats }];
}
