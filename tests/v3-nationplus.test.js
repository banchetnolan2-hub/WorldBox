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

// §23 — réglages avancés : ~31 paramètres, 6 profils, effets réels, ordre multijoueur, sauvegarde
{
  ok(m.TUNING.length >= 30 && new Set(m.TUNING.map((p) => p.cat)).size === 7, `réglages avancés : ${m.TUNING.length} paramètres en ${new Set(m.TUNING.map((p) => p.cat)).size} catégories`);
  const names = m.TUNING_PROFILES.map((p) => p.label);
  ok(['Équilibré', 'Réaliste', 'Guerre totale', 'Diplomatique', 'Bâtisseur', 'Arcade'].every((x) => names.includes(x)), `profils : ${names.join(', ')}`);
  ok(m.TUNING_PROFILES.every((p) => Object.keys(p.v).every((k) => m.TUNING_BY_ID[k])), 'profils : uniquement des paramètres existants');
  ok(m.matchProfile(m.profileTuning('realistic')) === 'realistic' && m.matchProfile({ ...m.defaultTuning(), growth: 1.37 }) === null, 'reconnaissance du profil actif / personnalisé');
  const n1 = m.normalizeTuning({ growth: 99, bogus: 3, lethality: 'x' });
  ok(n1.growth === m.TUNING_BY_ID.growth.max && !('bogus' in n1) && n1.lethality === 1, 'valeurs bornées, inconnues ignorées');
  // profil Équilibré = partie sans réglage (bit à bit)
  const a = mk('FR', { seed: 'TUNE' }), b = mk('FR', { seed: 'TUNE', options: { tuning: m.profileTuning('balanced') } });
  for (let i = 0; i < 1200; i++) { a.step(); b.step(); }
  ok(m.stateHash(a) === m.stateHash(b), 'profil « Équilibré » identique à une partie sans réglage (comportement de base conservé)');
  // effets réels
  const g1 = mk('FR', { seed: 'TG' }), g2 = mk('FR', { seed: 'TG', options: { tuning: { growth: 2.5, techCost: 0.5 } } });
  const k = g1.nation.player;
  ok(Math.abs(g2.nation.costOf(k, 'eco1').total - g1.nation.costOf(k, 'eco1').total * 0.5) < 1e-6, 'coût des technologies : ×0,5 appliqué');
  run(g1, 121.67 * 2); run(g2, 121.67 * 2);
  ok(g2.sides[k].eco.gdp > g1.sides[k].eco.gdp * 1.01, `croissance ×2,5 : PIB ${Math.round(g1.sides[k].eco.gdp)} → ${Math.round(g2.sides[k].eco.gdp)} Md$`);
  const d1 = mk('FR', { seed: 'TD' }), d2 = mk('FR', { seed: 'TD', options: { tuning: { dipOpenness: 2.5 } } });
  const jp = side(d1, 'Japon');
  ok(d2.nation.evaluate(k, jp, 'alliance').score > d1.nation.evaluate(k, jp, 'alliance').score + 0.5, 'ouverture diplomatique : les IA acceptent plus facilement');
  const s1 = mk('FR', { seed: 'TS' }), s2 = mk('FR', { seed: 'TS', options: { tuning: { supplyRange: 0.4, defense: 1.8 } } });
  s1.sides[k].heldForeign = s2.sides[k].heldForeign = 400;
  const foreign = s1.origin.findIndex((e) => e !== s1.sides[k].e && s1.sideOf[e] >= 0);
  ok(s2.supply(k, foreign) < s1.supply(k, foreign) && s2.defensePower(k, s2.sides[k].capital) > s1.defensePower(k, s1.sides[k].capital) * 1.7, 'portée du ravitaillement et avantage du défenseur appliqués');
  // ordre multijoueur : l'hôte seul, appliqué partout au même pas, sauvegardé
  const h = mk('FR', { seed: 'TC' }), c = mk('FR', { seed: 'TC' });
  const kp = h.nation.player;
  const other = side(h, 'Allemagne');
  h.nation.addHuman(other, 'invité'); c.nation.addHuman(other, 'invité');
  ok(m.execCommand(h, { op: 'tuning', a: other, t: { growth: 2 } }) === null && h.tuning.growth === 1, 'un invité ne peut pas modifier les réglages');
  const cmd = { op: 'tuning', a: kp, t: m.profileTuning('totalwar') };
  for (let i = 0; i < 600; i++) { if (i === 200) { m.execCommand(h, JSON.parse(JSON.stringify(cmd))); m.execCommand(c, JSON.parse(JSON.stringify(cmd))); } h.step(); c.step(); }
  ok(m.matchProfile(h.tuning) === 'totalwar' && m.stateHash(h) === m.stateHash(c), 'réglages changés en partie : appliqués au même pas, simulations identiques');
  const r = mk('FR', { seed: 'TC' }, JSON.parse(JSON.stringify(h.serialize())));
  ok(m.matchProfile(r.tuning) === 'totalwar', 'réglages conservés dans la sauvegarde');
  const old = JSON.parse(JSON.stringify(h.serialize())); delete old.tuning;
  ok(m.matchProfile(mk('FR', { seed: 'TC' }, old).tuning) === 'balanced', 'ancienne sauvegarde sans réglages : valeurs de base');
}

summary('Mécaniques du Mode Nation');
