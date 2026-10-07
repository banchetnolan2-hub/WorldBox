// RÉGLAGES AVANCÉS — une trentaine de paramètres chiffrés (diplomatie, économie, guerre, IA, paix, occupation,
// logistique) et des profils prêts à l'emploi (Équilibré, Réaliste, Guerre totale, Diplomatique, Bâtisseur,
// Arcade). Les joueurs peuvent enregistrer leurs propres profils.
// Les valeurs font partie de l'état de la partie (sauvegardées, identiques chez tous les joueurs) ; en partie,
// un changement passe par un ordre multijoueur (même pas de simulation partout). Valeur 1 = comportement de base.

export const TUNING_CATS = [
  ['diplo', 'Diplomatie', 'handshake'], ['eco', 'Économie', 'coins'], ['war', 'Guerre', 'swords'], ['ai', 'Intelligence artificielle', 'brain'],
  ['peace', 'Paix', 'scroll-text'], ['occ', 'Occupation', 'map-pin'], ['log', 'Logistique', 'truck'],
];

// k : multiplicateur (1 = base) ; min / max / step : bornes du curseur
const P = (id, cat, label, desc, def = 1, min = 0.25, max = 2.5, step = 0.05, unit = '×') => ({ id, cat, label, desc, def, min, max, step, unit });
export const TUNING = [
  P('dipOpenness', 'diplo', 'Ouverture diplomatique des IA', 'Facilité avec laquelle les IA acceptent vos propositions.'),
  P('dipMemory', 'diplo', 'Mémoire des refus et trahisons', 'Poids des refus, ruptures et aides passés dans les décisions des IA.'),
  P('aiProposals', 'diplo', 'Fréquence des propositions des IA', 'Accords, alliances, demandes et exigences envoyés par les IA.'),
  P('allyReliability', 'diplo', 'Fiabilité des alliés', 'Probabilité qu\'un allié entre en guerre à vos côtés.'),
  P('aggressionPenalty', 'diplo', 'Réprobation des agressions', 'Perte de relations avec les autres pays après une déclaration de guerre.'),
  P('growth', 'eco', 'Croissance économique', 'Rythme de croissance de base des économies.', 1, 0.25, 2.5),
  P('taxYield', 'eco', 'Rendement fiscal', 'Recettes fiscales tirées du PIB.', 1, 0.5, 1.6),
  P('interest', 'eco', 'Taux d\'intérêt', 'Coût de la dette.', 1, 0, 3),
  P('debtCrisis', 'eco', 'Seuil de crise de la dette', 'Niveau de dette (en % du PIB) qui déclenche une crise.', 1, 0.5, 2.5),
  P('trade', 'eco', 'Gains du commerce', 'Effet des accords commerciaux et du blocus sur le PIB.', 1, 0, 2.5),
  P('techCost', 'eco', 'Coût des technologies', 'Coût des projets de l\'arbre technologique.'),
  P('techTime', 'eco', 'Durée des recherches', 'Durée des projets de l\'arbre technologique.'),
  P('aiWarFreq', 'war', 'Fréquence des guerres d\'IA', 'Nombre maximal de nouvelles guerres d\'IA par an.', 1, 0, 3),
  P('lethality', 'war', 'Pertes au combat', 'Pertes humaines et matérielles des batailles.'),
  P('defense', 'war', 'Avantage du défenseur', 'Puissance défensive (terrain, retranchements).', 1, 0.5, 1.8),
  P('fortSpeed', 'war', 'Vitesse des fortifications', 'Rapidité de construction des lignes fortifiées.', 1, 0, 3),
  P('recruit', 'war', 'Vitesse de recrutement', 'Rythme de mobilisation des nouvelles troupes.', 1, 0.25, 3),
  P('exhaustion', 'war', 'Lassitude de la guerre', 'Usure du moral et de l\'économie dans les guerres longues.', 1, 0, 2.5),
  P('aiAggression', 'ai', 'Agressivité des IA', 'Propension des IA à lancer des offensives.', 1, 0.2, 2.5),
  P('aiResearch', 'ai', 'Recherche des IA', 'Fréquence à laquelle les IA lancent des projets technologiques.', 1, 0, 3),
  P('aiCoalitions', 'ai', 'Coalitions des IA', 'Propension des IA à former et rejoindre des coalitions.', 1, 0, 2.5),
  P('peaceAccept', 'peace', 'Acceptation de la paix', 'Disposition des IA à signer la paix.', 1, 0.25, 2.5),
  P('maxDemand', 'peace', 'Exigences territoriales maximales', 'Part maximale du territoire d\'un pays qui peut être exigée, selon la situation militaire.', 1, 0.25, 2),
  P('peaceCooldown', 'peace', 'Délai entre deux propositions de paix', 'Temps d\'attente d\'une IA après un refus avant de reproposer la paix.', 1, 0.5, 4),
  P('reparations', 'peace', 'Réparations de guerre', 'Montant des réparations exigées dans les traités.', 1, 0, 3),
  P('occSpeed', 'occ', 'Consolidation des occupations', 'Vitesse à laquelle un territoire occupé devient contrôlé.', 1, 0.25, 3),
  P('partisans', 'occ', 'Activité des partisans', 'Fréquence des soulèvements dans les territoires mal tenus.', 1, 0, 3),
  P('occSupply', 'occ', 'Exigence de ravitaillement', 'Niveau de ravitaillement nécessaire pour tenir une occupation.', 1, 0.25, 2),
  P('supplyRange', 'log', 'Portée du ravitaillement', 'Distance à laquelle une armée reste bien ravitaillée hors de ses frontières.', 1, 0.4, 2.5),
  P('naval', 'log', 'Capacité de transport maritime', 'Convois de troupes simultanés et portée des traversées.', 1, 0.4, 2.5),
  P('attrition', 'log', 'Consommation des stocks', 'Consommation de réserves militaires par les offensives.', 1, 0.25, 2.5),
  P('events', 'log', 'Fréquence des événements', 'Événements aléatoires, économiques et diplomatiques.', 1, 0, 3),
];
export const TUNING_BY_ID = Object.fromEntries(TUNING.map((p) => [p.id, p]));
export const defaultTuning = () => Object.fromEntries(TUNING.map((p) => [p.id, p.def]));

export const TUNING_PROFILES = [
  { id: 'balanced', label: 'Équilibré', desc: 'Réglages de base, recommandés pour une première partie.', v: {} },
  { id: 'realistic', label: 'Réaliste', desc: 'Guerres coûteuses, paix plus difficile, alliés prudents, logistique exigeante.',
    v: { lethality: 1.3, exhaustion: 1.4, supplyRange: 0.8, occSpeed: 0.7, partisans: 1.4, occSupply: 1.3, allyReliability: 0.8, maxDemand: 0.8, aiWarFreq: 0.8, dipOpenness: 0.9, growth: 0.9, attrition: 1.2 } },
  { id: 'totalwar', label: 'Guerre totale', desc: 'Conflits fréquents, IA agressives, recrutement rapide, peu de paix.',
    v: { aiWarFreq: 2.2, aiAggression: 1.8, recruit: 1.6, peaceAccept: 0.6, aggressionPenalty: 0.6, exhaustion: 0.6, fortSpeed: 1.3, maxDemand: 1.4, aiCoalitions: 1.4, peaceCooldown: 1.5 } },
  { id: 'diplomatic', label: 'Diplomatique', desc: 'IA ouvertes au dialogue, alliances fiables, guerres rares et vite négociées.',
    v: { dipOpenness: 1.4, aiProposals: 1.5, allyReliability: 1.3, aggressionPenalty: 1.6, aiWarFreq: 0.5, aiAggression: 0.7, peaceAccept: 1.5, peaceCooldown: 0.7, trade: 1.3 } },
  { id: 'builder', label: 'Bâtisseur', desc: 'Croissance et recherche favorisées, peu de guerres : bâtir son pays.',
    v: { growth: 1.4, techCost: 0.75, techTime: 0.8, trade: 1.3, aiWarFreq: 0.4, aiAggression: 0.6, interest: 0.7, debtCrisis: 1.3, events: 0.8 } },
  { id: 'arcade', label: 'Arcade', desc: 'Rythme rapide : conquêtes, occupations et recherches accélérées, peu de contraintes.',
    v: { occSpeed: 2.2, partisans: 0.3, occSupply: 0.6, supplyRange: 1.8, naval: 1.8, techTime: 0.6, recruit: 1.8, exhaustion: 0.5, attrition: 0.6, maxDemand: 1.6, peaceAccept: 1.4, peaceCooldown: 0.6, lethality: 0.8 } },
];
export const PROFILE_BY_ID = Object.fromEntries(TUNING_PROFILES.map((p) => [p.id, p]));

// valeurs bornées et complètes (paramètres inconnus ignorés, manquants à leur valeur de base)
export function normalizeTuning(t) {
  const out = defaultTuning();
  if (t && typeof t === 'object') for (const p of TUNING) {
    const v = Number(t[p.id]);
    if (Number.isFinite(v)) out[p.id] = Math.min(p.max, Math.max(p.min, Math.round(v / p.step) * p.step));
  }
  // arrondi stable (pas de 0,30000000000000004 qui différerait d'une machine à l'autre à l'affichage)
  for (const k of Object.keys(out)) out[k] = Math.round(out[k] * 1000) / 1000;
  return out;
}
export function profileTuning(id) { const p = PROFILE_BY_ID[id] || PROFILE_BY_ID.balanced; return normalizeTuning({ ...defaultTuning(), ...p.v }); }
// profil correspondant exactement aux valeurs (ou null : personnalisé)
export function matchProfile(t) {
  const n = normalizeTuning(t);
  for (const p of TUNING_PROFILES) { const v = profileTuning(p.id); if (TUNING.every((x) => v[x.id] === n[x.id])) return p.id; }
  return null;
}
// accès rapide depuis le moteur : tn(sim, 'growth') -> multiplicateur
export function tn(sim, id) { const t = sim && sim.tuning; const v = t ? t[id] : undefined; return v === undefined ? 1 : v; }
