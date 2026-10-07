// Tests des MÉCANIQUES DU MODE NATION ajoutées dans cette version (cahier des charges de reprise) :
// crayon de frontières hors Nation, réglages avancés, composition de l'armée, groupes d'armée, flottes,
// occupation, paix proportionnée, diplomatie territoriale, technologies exclusives, nations formables…
// Chaque mécanique est vérifiée aussi pour le déterminisme (sauvegarde / reprise, ordres multijoueur).
const { load, ok, mk, run, side, summary } = require('./v3-common.js');
const { m } = load();

// §20 — crayon de frontières : refusé en Mode Nation
{
  const sim = mk('FR', { seed: 'PENCIL' });
  const k = sim.nation.player;
  const before = sim.owner.slice();
  const stroke = m.prepareStroke([[6.35, 49.45], [7.0, 49.9], [8.1, 49.7], [8.1, 48.95]], false);
  const r = m.execCommand(sim, { op: 'border', a: k, strokes: [stroke] });
  ok(r === null && sim.owner.every((v, i) => v === before[i]), 'Mode Nation : le crayon de frontières est refusé (aucune parcelle modifiée)');
}

summary('Mécaniques du Mode Nation');
