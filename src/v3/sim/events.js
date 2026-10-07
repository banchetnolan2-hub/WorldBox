// SIMULATION V3 — événements aléatoires / manuels (abstraits, non graphiques)
// apply(sim, sideIndex, rng) retourne un texte ou { text, tone, title }.

export const EVENTS = [
  {
    id: 'rapid', cat: 'mil', icon: '⚡', title: 'PROGRESSION RAPIDE', tone: 'good', weight: 1.1, manual: true,
    apply(sim, s, rng) {
      sim.addMod(s, { attempts: 2.0, atk: 1.12, until: sim.time + rng.range(7, 11), label: 'Progression rapide' });
      return `La progression de ${sim.name(s)} augmente pendant quelques secondes.`;
    },
  },
  {
    id: 'slow', cat: 'mil', icon: '🐢', title: 'RALENTISSEMENT', tone: 'bad', weight: 0.9, manual: true,
    apply(sim, s, rng) {
      sim.addMod(s, { attempts: 0.45, until: sim.time + rng.range(7, 11), label: 'Ralentissement' });
      return `${sim.name(s)} ralentit sa progression pendant un moment.`;
    },
  },
  {
    id: 'setback', cat: 'mil', icon: '📉', title: 'PERTE TEMPORAIRE DE TERRITOIRE', tone: 'bad', weight: 0.8, manual: true, sideBias: 'leader',
    condition: (sim, s) => sim.sides[s].border.length > 0 && sim.sides[s].cells > 10,
    apply(sim, s, rng) {
      const sd = sim.sides[s];
      const amount = Math.max(3, Math.min(120, Math.round(sd.initial * rng.range(0.012, 0.03))));
      const lost = sim.flipClusterFrom(s, amount);
      sim.addMod(s, { attempts: 1.35, def: 1.1, until: sim.time + 12, label: 'Reprise' });
      return `${sim.name(s)} recule sur une portion du front (${lost} parcelles) mais prépare une reprise.`;
    },
  },
  {
    id: 'resources', cat: 'eco', icon: '💰', title: 'BONUS DE RESSOURCES', tone: 'good', weight: 0.9, manual: true,
    apply(sim, s, rng) {
      const sd = sim.sides[s];
      sd.resources = Math.min(100, sd.resources + rng.range(30, 45));
      sim.addMod(s, { atk: 1.1, until: sim.time + 10, label: 'Ressources' });
      return `${sim.name(s)} reçoit un afflux de ressources.`;
    },
  },
  {
    id: 'resloss', cat: 'eco', icon: '🕳️', title: 'PERTE DE RESSOURCES', tone: 'bad', weight: 0.5, manual: true,
    apply(sim, s, rng) {
      const sd = sim.sides[s];
      sd.resources = Math.max(0, sd.resources - rng.range(25, 40));
      return `${sim.name(s)} perd une partie de ses réserves de ressources.`;
    },
  },
  {
    id: 'economy', cat: 'eco', icon: '📈', title: 'BONUS ÉCONOMIQUE', tone: 'good', weight: 0.7, manual: true,
    apply(sim, s, rng) {
      const sd = sim.sides[s];
      sd.econBoost = Math.min(30, (sd.econBoost || 0) + rng.range(8, 14));
      sd.units = Math.min(sd.maxUnits * 1.3, sd.units + sd.maxUnits * 0.12);
      return `L'économie de ${sim.name(s)} accélère : production et renforts en hausse.`;
    },
  },
  {
    id: 'stability', cat: 'pol', icon: '⚖️', title: 'CHANGEMENT DE STABILITÉ', tone: 'neutral', weight: 0.9,
    apply(sim, s, rng) {
      const sd = sim.sides[s];
      const up = rng.chance(0.5 + (sd.baseStability - sd.stability));
      return up ? EVENTS_BY_ID.stabup.apply(sim, s, rng) : EVENTS_BY_ID.stabdown.apply(sim, s, rng);
    },
  },
  {
    id: 'stabup', cat: 'pol', icon: '⚖️', title: 'STABILITÉ EN HAUSSE', tone: 'good', weight: 0, manual: true,
    apply(sim, s, rng) {
      const sd = sim.sides[s];
      sd.stability = Math.min(1, sd.stability + rng.range(0.1, 0.18));
      return { text: `La stabilité de ${sim.name(s)} se renforce.`, tone: 'good', title: 'STABILITÉ EN HAUSSE' };
    },
  },
  {
    id: 'stabdown', cat: 'pol', icon: '⚖️', title: 'STABILITÉ EN BAISSE', tone: 'bad', weight: 0, manual: true,
    apply(sim, s, rng) {
      const sd = sim.sides[s];
      sd.stability = Math.max(0.15, sd.stability - rng.range(0.1, 0.18));
      return { text: `La stabilité de ${sim.name(s)} est fragilisée.`, tone: 'bad', title: 'STABILITÉ EN BAISSE' };
    },
  },
  {
    id: 'regional', cat: 'mil', icon: '🌐', title: 'ÉVÉNEMENT RÉGIONAL', tone: 'neutral', weight: 0.7, global: true,
    condition: (sim) => sim.totalBorder() > 0,
    apply(sim, s, rng) {
      sim.startRegional(rng.range(9, 14), s);
      return 'Une zone du front devient instable : les pays s\'y disputent le terrain.';
    },
  },
  {
    id: 'fortify', cat: 'mil', icon: '🛡️', title: 'LIGNE CONSOLIDÉE', tone: 'good', weight: 0.8, manual: true, sideBias: 'trailer',
    apply(sim, s, rng) {
      sim.addMod(s, { def: 1.35, until: sim.time + rng.range(9, 13), label: 'Ligne consolidée' });
      return `${sim.name(s)} renforce ses positions défensives.`;
    },
  },
  {
    id: 'counter', cat: 'mil', icon: '🔄', title: 'CONTRE-POUSSÉE', tone: 'good', weight: 0.7, manual: true, sideBias: 'trailer',
    apply(sim, s, rng) {
      const sd = sim.sides[s];
      sd.phase = 'offensive';
      sd.phaseUntil = sim.time + rng.range(8, 12);
      sd.momentum = Math.max(sd.momentum, 0) + 0.15;
      return `${sim.name(s)} lance une contre-poussée.`;
    },
  },
  {
    id: 'reinforce', cat: 'mil', icon: '🚩', title: 'ARRIVÉE D\'UNITÉS', tone: 'good', weight: 0.7, manual: true,
    apply(sim, s) {
      const sd = sim.sides[s];
      const extra = Math.round(sd.maxUnits * 0.2);
      sd.units = Math.min(sd.maxUnits * 1.5, sd.units + extra);
      const added = sim.addAgents(s, 2);
      return `${sim.name(s)} reçoit ${extra} unités supplémentaires${added ? ` (+${added} marqueurs)` : ''}.`;
    },
  },
];

export const EVENTS_BY_ID = Object.fromEntries(EVENTS.map((e) => [e.id, e]));
export const MANUAL_EVENTS = EVENTS.filter((e) => e.manual);

export function pickEvent(sim, rng) {
  const lead = sim.leaderSide();
  const trail = sim.trailerSide();
  const active = sim.activeSides();
  if (!active.length) return null;
  const candidates = [];
  const R = sim.rules || {};
  const allowed = { mil: R.milEvents !== false && R.wars !== false, eco: R.ecoEvents !== false && R.resources !== false, pol: R.politicalEvents !== false };
  for (const type of EVENTS) {
    if (!type.weight || allowed[type.cat] === false) continue;
    if (type.id === 'reinforce' && R.mobilization === false) continue;
    if (type.global) {
      if (!type.condition || type.condition(sim, -1)) candidates.push({ type, side: active[rng.int(active.length)], w: type.weight });
      continue;
    }
    // un pays tiré au hasard (pondéré par son importance) + biais meneur/retardataire
    let s = active[rng.int(active.length)];
    if (type.sideBias === 'leader' && lead >= 0 && rng.chance(0.5)) s = lead;
    if (type.sideBias === 'trailer' && trail >= 0 && rng.chance(0.5)) s = trail;
    if (type.condition && !type.condition(sim, s)) continue;
    candidates.push({ type, side: s, w: type.weight });
  }
  if (!candidates.length) return null;
  return rng.weighted(candidates, (c) => c.w);
}
