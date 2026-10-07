// SIMULATION — événements aléatoires (abstraits, non graphiques)
// Chaque événement a un poids, une condition éventuelle et une fonction apply(sim, side, rng).
// apply() retourne le texte affiché dans l'interface.

export const EVENT_TYPES = [
  {
    id: 'rapid',
    icon: '⚡',
    title: 'PROGRESSION RAPIDE',
    tone: 'good',
    weight: 1.2,
    apply(sim, side, rng) {
      const dur = rng.range(7, 11);
      sim.addMod(side, { attempts: 2.0, atk: 1.12, until: sim.time + dur, label: 'Progression rapide' });
      return `La progression de ${sim.name(side)} augmente pendant quelques secondes.`;
    },
  },
  {
    id: 'slow',
    icon: '🐢',
    title: 'RALENTISSEMENT',
    tone: 'bad',
    weight: 1.0,
    apply(sim, side, rng) {
      const dur = rng.range(7, 11);
      sim.addMod(side, { attempts: 0.45, until: sim.time + dur, label: 'Ralentissement' });
      return `${sim.name(side)} ralentit sa progression pendant un moment.`;
    },
  },
  {
    id: 'setback',
    icon: '📉',
    title: 'PERTE TEMPORAIRE DE TERRITOIRE',
    tone: 'bad',
    weight: 0.9,
    // plus probable pour le pays qui mène
    sideBias: 'leader',
    condition: (sim, side) => sim.targets[1 - side].size > 0 && sim.sides[side].cells > 10,
    apply(sim, side, rng) {
      const s = sim.sides[side];
      const amount = Math.max(3, Math.min(90, Math.round(s.initial * rng.range(0.012, 0.03))));
      const lost = sim.flipCluster(1 - side, amount);
      sim.addMod(side, { attempts: 1.35, def: 1.1, until: sim.time + 12, label: 'Reprise' });
      return `${sim.name(side)} recule sur une portion du front (${lost} parcelles) mais prépare une reprise.`;
    },
  },
  {
    id: 'resources',
    icon: '💰',
    title: 'BONUS DE RESSOURCES',
    tone: 'good',
    weight: 1.0,
    apply(sim, side, rng) {
      const s = sim.sides[side];
      s.resources = Math.min(100, s.resources + rng.range(30, 45));
      sim.addMod(side, { atk: 1.1, until: sim.time + 10, label: 'Ressources' });
      return `${sim.name(side)} reçoit un afflux de ressources.`;
    },
  },
  {
    id: 'stability',
    icon: '⚖️',
    title: 'CHANGEMENT DE STABILITÉ',
    tone: 'neutral',
    weight: 1.0,
    apply(sim, side, rng) {
      const s = sim.sides[side];
      const up = rng.chance(0.5 + (s.baseStability - s.stability));
      const delta = rng.range(0.1, 0.18) * (up ? 1 : -1);
      s.stability = Math.max(0.15, Math.min(1, s.stability + delta));
      return up
        ? { text: `La stabilité de ${sim.name(side)} se renforce.`, tone: 'good', title: 'STABILITÉ EN HAUSSE' }
        : { text: `La stabilité de ${sim.name(side)} est fragilisée.`, tone: 'bad', title: 'STABILITÉ EN BAISSE' };
    },
  },
  {
    id: 'regional',
    icon: '🌐',
    title: 'ÉVÉNEMENT RÉGIONAL',
    tone: 'neutral',
    weight: 0.8,
    global: true,
    condition: (sim) => sim.targets[0].size + sim.targets[1].size > 0,
    apply(sim, side, rng) {
      const zone = sim.startRegional(rng.range(9, 14));
      return zone
        ? 'Une zone du front devient instable : les deux pays s\'y disputent le terrain.'
        : 'Une zone du front devient instable.';
    },
  },
  {
    id: 'fortify',
    icon: '🛡️',
    title: 'LIGNE CONSOLIDÉE',
    tone: 'good',
    weight: 0.9,
    sideBias: 'trailer',
    apply(sim, side, rng) {
      sim.addMod(side, { def: 1.35, until: sim.time + rng.range(9, 13), label: 'Ligne consolidée' });
      return `${sim.name(side)} renforce ses positions défensives.`;
    },
  },
  {
    id: 'counter',
    icon: '🔄',
    title: 'CONTRE-POUSSÉE',
    tone: 'good',
    weight: 0.8,
    sideBias: 'trailer',
    apply(sim, side, rng) {
      const s = sim.sides[side];
      s.phase = 'offensive';
      s.phaseUntil = sim.time + rng.range(8, 12);
      s.momentum = Math.max(s.momentum, 0) + 0.15;
      return `${sim.name(side)} lance une contre-poussée.`;
    },
  },
  {
    id: 'markers',
    icon: '🚩',
    title: 'NOUVEAUX MARQUEURS',
    tone: 'good',
    weight: 0.6,
    condition: (sim, side) => sim.sides[side].units.length < 14,
    apply(sim, side) {
      const added = sim.addUnits(side, 2);
      return `${sim.name(side)} déploie ${added} marqueur${added > 1 ? 's' : ''} supplémentaire${added > 1 ? 's' : ''}.`;
    },
  },
];

export function pickEvent(sim, rng) {
  const lead = sim.leaderSide();
  const candidates = [];
  for (const type of EVENT_TYPES) {
    for (let side = 0; side < 2; side++) {
      if (type.global && side === 1) continue;
      if (type.condition && !type.condition(sim, side)) continue;
      let w = type.weight;
      if (type.sideBias === 'leader' && lead >= 0) w *= side === lead ? 1.6 : 0.5;
      if (type.sideBias === 'trailer' && lead >= 0) w *= side === lead ? 0.6 : 1.5;
      candidates.push({ type, side, w });
    }
  }
  if (!candidates.length) return null;
  return rng.weighted(candidates, (c) => c.w);
}
