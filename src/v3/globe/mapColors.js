// GLOBE — couleurs cartographiques des pays (sans drapeaux) :
// palette harmonieuse, deux pays voisins n'ont jamais la même couleur (coloration de graphe).
export const MAP_PALETTE = [
  // palette d'atlas : teintes franches mais désaturées, lisibles sur le relief et avec la charte laiton/encre
  '#c8665a', '#d99a52', '#d9bf6a', '#9db766', '#5fa483', '#c9a07e',
  '#8d9ad6', '#7f72c0', '#a774ad', '#cc7895', '#a98463', '#86a05a',
];

function hash(k) { let h = Math.imul(k + 1, 2654435761) >>> 0; h = (h ^ (h >>> 15)) >>> 0; return h; }

// voisinage des pays d'après la grille (frontières terrestres)
function adjacency(grid, owner, nEnt) {
  const adj = Array.from({ length: nEnt }, () => new Set());
  for (let i = 0; i < grid.n; i++) {
    const a = owner[i];
    if (a >= nEnt) continue;
    for (let k = grid.nbrStart[i]; k < grid.nbrStart[i + 1]; k++) {
      const b = owner[grid.nbr[k]];
      if (b !== a && b < nEnt) { adj[a].add(b); adj[b].add(a); }
    }
  }
  return adj;
}

export function mapColors(grid, entities) {
  const n = entities.length;
  const adj = adjacency(grid, grid.origin, n);
  const order = [...Array(n).keys()].sort((a, b) => adj[b].size - adj[a].size || a - b);
  const pick = new Int16Array(n).fill(-1);
  const used = new Int32Array(MAP_PALETTE.length);
  for (const k of order) {
    const taken = new Set([...adj[k]].map((j) => pick[j]).filter((c) => c >= 0));
    const start = hash(k + 7) % MAP_PALETTE.length;
    let best = -1, bestUse = Infinity;
    for (let t = 0; t < MAP_PALETTE.length; t++) {
      const c = (start + t) % MAP_PALETTE.length;
      if (taken.has(c)) continue;
      if (used[c] < bestUse) { bestUse = used[c]; best = c; }
    }
    if (best < 0) best = start;
    pick[k] = best; used[best]++;
  }
  // petites variations de teinte : deux pays de la même couleur restent discernables
  return entities.map((e, k) => shade(MAP_PALETTE[pick[k]], ((hash(k) % 7) - 3) * 0.035));
}

function shade(hex, amt) {
  const v = parseInt(hex.slice(1), 16);
  const f = (c) => Math.max(0, Math.min(255, Math.round(amt >= 0 ? c + (255 - c) * amt : c * (1 + amt))));
  const r = f((v >> 16) & 255), g = f((v >> 8) & 255), b = f(v & 255);
  return '#' + ((r << 16) | (g << 8) | b).toString(16).padStart(6, '0');
}

// en partie : couleurs des participants toutes distinctes (si possible), voisins actuels compris
export function distinctParticipantColors(entities, participants, grid, owner) {
  const list = [...participants].filter((k) => entities[k] && entities[k].kind !== 'neutral').sort((a, b) => a - b);
  if (list.length > MAP_PALETTE.length) return;
  const base = (hex) => {
    let best = 0, bd = Infinity;
    const v = parseInt(hex.slice(1), 16);
    MAP_PALETTE.forEach((p, i) => {
      const w = parseInt(p.slice(1), 16);
      const d = Math.abs(((v >> 16) & 255) - ((w >> 16) & 255)) + Math.abs(((v >> 8) & 255) - ((w >> 8) & 255)) + Math.abs((v & 255) - (w & 255));
      if (d < bd) { bd = d; best = i; }
    });
    return best;
  };
  const taken = new Set();
  for (const k of list) {
    const e = entities[k];
    if (e.kind === 'custom') { taken.add(base(e.color)); continue; }
    let c = base(e.color);
    if (taken.has(c)) {
      for (let t = 1; t < MAP_PALETTE.length; t++) { const cc = (c + t * 5) % MAP_PALETTE.length; if (!taken.has(cc)) { c = cc; break; } }
      e.color = MAP_PALETTE[c];
    }
    taken.add(c);
  }
}
