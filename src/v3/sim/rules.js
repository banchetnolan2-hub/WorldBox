// RÈGLES DE LA PARTIE — chaque système de la simulation peut être activé ou désactivé avant de lancer
// une partie. Une règle désactivée l'est réellement : le moteur, l'IA, les événements et l'interface
// la consultent tous (sim.rules.<clé> === false).
// Valeurs par défaut propres à chaque mode ; un scénario peut imposer (verrouiller) certaines règles.

export const RULE_CATS = [
  ['diplo', 'Diplomatie', 'handshake'],
  ['gov', 'Gouvernement, décisions et IA', 'landmark'],
  ['eco', 'Économie', 'coins'],
  ['mil', 'Militaire', 'swords'],
  ['tech', 'Technologie', 'cpu'],
  ['events', 'Événements', 'activity'],
];

// cat : catégorie ; also : catégories où la règle apparaît aussi (même interrupteur) ; nation : réservée au mode Nation
export const RULES = [
  { id: 'diplomacy', cat: 'diplo', master: true, label: 'Diplomatie', desc: 'Système diplomatique complet. Désactivé : ni relations, ni traités, ni alliances, ni négociations ; les guerres ne se terminent que par les armes.' },
  { id: 'alliances', cat: 'diplo', label: 'Alliances', desc: 'Les pays peuvent former des alliances, appeler leurs alliés et entrer en guerre à leurs côtés.' },
  { id: 'coalitions', cat: 'diplo', label: 'Coalitions', desc: 'Plusieurs pays s\'unissent contre un agresseur ou une menace : chef, intérêts de chaque membre, objectif commun, offensives coordonnées, entrées, départs et paix séparées.' },
  { id: 'treaties', cat: 'diplo', label: 'Traités et accords', desc: 'Pactes de non-agression et accords commerciaux formels entre pays.' },
  { id: 'relations', cat: 'diplo', label: 'Relations diplomatiques', desc: 'Les relations évoluent (guerres, commerce, aides, rivalités). Désactivées : relations neutres et figées.' },
  { id: 'negotiations', cat: 'diplo', label: 'Négociations', desc: 'Propositions, contre-propositions et demandes entre pays (y compris celles des IA au joueur).' },
  { id: 'peace', cat: 'diplo', label: 'Demandes de paix', desc: 'Les guerres peuvent se terminer par une paix négociée. Désactivées : seules les conditions militaires mettent fin aux guerres.' },

  { id: 'decisions', cat: 'gov', label: 'Décisions nationales', desc: 'Décisions régulières du gouvernement (budget, crise, chômage, effort de guerre…).', nation: true },
  { id: 'govChanges', cat: 'gov', label: 'Changements de gouvernement', desc: 'Après une crise, une défaite ou une longue période, un pays peut changer d\'orientation (personnalité de l\'IA).' },
  { id: 'politicalEvents', cat: 'gov', label: 'Événements politiques', desc: 'Stabilité en hausse ou en baisse, mécontentement, réformes spontanées.' },
  { id: 'aiAdvanced', cat: 'gov', label: 'IA avancée', desc: 'Les IA analysent la situation, adaptent leur doctrine, cherchent des coalitions, utilisent l\'arbre de développement et changent de stratégie après des refus. Désactivée : comportements simples et prévisibles.' },
  { id: 'transformations', cat: 'gov', label: 'Transformations nationales', desc: 'Le modèle économique d\'un pays évolue avec sa technologie (industrialisation, économie de services…).' },

  { id: 'economy', cat: 'eco', label: 'Économie', desc: 'PIB, budget, croissance et dépenses évoluent chaque mois. Désactivée : l\'économie reste figée à son état de départ.' },
  { id: 'advancedEconomy', cat: 'eco', label: 'Économie avancée', desc: 'Dette et intérêts, crises économiques, transformations du modèle économique. Désactivée : budget simple, sans emprunt ni crise.' },
  { id: 'debt', cat: 'eco', label: 'Dette', desc: 'Les pays peuvent emprunter ; la dette coûte des intérêts et peut provoquer une crise.' },
  { id: 'trade', cat: 'eco', label: 'Commerce', desc: 'Les échanges entre partenaires augmentent le PIB ; blocus naval en temps de guerre.' },
  { id: 'resources', cat: 'eco', label: 'Ressources', desc: 'Réserves logistiques, rente des matières premières et effets des ressources naturelles.' },

  { id: 'wars', cat: 'mil', label: 'Guerres', desc: 'Les pays peuvent déclarer la guerre. Désactivées : monde entièrement pacifique.' },
  { id: 'movements', cat: 'mil', label: 'Déplacements militaires', desc: 'Les groupes se déplacent vers les fronts et les zones à défendre.' },
  { id: 'navalTransport', cat: 'mil', label: 'Transport maritime', desc: 'Embarquement, convois et débarquements vers les îles et les côtes lointaines.' },
  { id: 'logistics', cat: 'mil', label: 'Logistique', desc: 'Ravitaillement : une armée loin de ses bases, en territoire ennemi ou à court de réserves s\'affaiblit ; la capacité de transport maritime est limitée par la flotte et les ports.' },
  { id: 'mobilization', cat: 'mil', label: 'Mobilisation', desc: 'Recrutement de nouvelles troupes selon le budget et la population.' },
  { id: 'milTech', cat: 'tech', also: ['mil'], label: 'Technologies militaires', desc: 'Projets de défense, équipement et modernisation des armées.' },

  { id: 'technology', cat: 'tech', master: true, label: 'Technologie', desc: 'Système technologique complet (recherche, arbre de développement, technologies militaires et économiques).' },
  { id: 'research', cat: 'tech', label: 'Recherche', desc: 'Les investissements en recherche font progresser la technologie.' },
  { id: 'techTree', cat: 'tech', label: 'Arbre de développement', desc: 'Projets nationaux (économie, infrastructures, technologie, éducation, diplomatie, défense).' },
  { id: 'ecoTech', cat: 'tech', label: 'Technologies économiques', desc: 'Projets économiques, d\'infrastructures et d\'éducation de l\'arbre de développement.' },

  { id: 'events', cat: 'events', master: true, label: 'Événements', desc: 'Tous les événements de la partie (aléatoires, économiques, diplomatiques, militaires, politiques).' },
  { id: 'randomEvents', cat: 'events', label: 'Événements aléatoires', desc: 'Événements ponctuels tirés au hasard pendant la partie.' },
  { id: 'crises', cat: 'events', label: 'Crises', desc: 'Crises économiques (dette, déficits) et leurs conséquences.' },
  { id: 'ecoEvents', cat: 'events', label: 'Événements économiques', desc: 'Croissance forte, ralentissements, afflux ou pertes de ressources.' },
  { id: 'diploEvents', cat: 'events', label: 'Événements diplomatiques', desc: 'Crises diplomatiques, accords spontanés entre pays.' },
  { id: 'milEvents', cat: 'events', label: 'Événements militaires', desc: 'Contre-poussées, lignes consolidées, renforts, instabilités régionales du front.' },
];
export const RULE_BY_ID = Object.fromEntries(RULES.map((r) => [r.id, r]));

// dépendances : une règle désactivée en coupe d'autres
// (plusieurs parents possibles : la règle est coupée dès que l'un d'eux l'est)
const PARENT = {
  alliances: 'diplomacy', coalitions: ['diplomacy', 'alliances'], treaties: 'diplomacy', relations: 'diplomacy', negotiations: 'diplomacy', peace: ['wars', 'diplomacy'],
  navalTransport: 'movements', advancedEconomy: 'economy', trade: 'economy', resources: 'economy',
  debt: ['economy', 'advancedEconomy'], crises: ['economy', 'advancedEconomy'], transformations: 'advancedEconomy',
  research: 'technology', techTree: 'technology', milTech: 'technology', ecoTech: ['technology', 'techTree'],
  randomEvents: 'events', ecoEvents: 'events', diploEvents: ['events', 'diplomacy'], milEvents: ['events', 'wars'], politicalEvents: 'events',
};

export const MODES = {
  sandbox: { label: 'Sandbox', desc: 'Presque tout est configurable.' },
  nation: { label: 'Nation Simulator', desc: 'Systèmes réalistes par défaut.' },
  story: { label: 'Mode histoire', desc: 'Règles imposées par le scénario.' },
  custom: { label: 'Monde personnalisé', desc: 'Règles choisies par le joueur.' },
};

const ALL_ON = Object.fromEntries(RULES.map((r) => [r.id, true]));
// valeurs recommandées par mode
export const RECOMMENDED = {
  sandbox: { ...ALL_ON, decisions: false, govChanges: false, transformations: false },
  nation: { ...ALL_ON },
  story: { ...ALL_ON },
  custom: { ...ALL_ON, govChanges: false },
};

export function defaultRules(mode = 'sandbox') { return { ...(RECOMMENDED[mode] || RECOMMENDED.sandbox) }; }

// règles effectives : défauts du mode + choix du joueur + règles imposées (scénario) + dépendances
export const RULE_PARENT = PARENT;
export function resolveRules(cfg = {}) {
  const mode = cfg.mode || (cfg.nation ? (cfg.nation.scenario ? 'story' : 'nation') : 'sandbox');
  const r = { ...defaultRules(mode), ...(cfg.rules || {}), ...(cfg.lockedRules || {}) };
  // compatibilité avec les anciens réglages
  if (cfg.aiWars === false && r.wars !== false) r.aiWars = false;
  if (cfg.naval === false) r.navalTransport = false;
  if (cfg.eventRate === 0) r.randomEvents = false;
  for (let pass = 0; pass < 3; pass++) for (const [k, p] of Object.entries(PARENT)) if ([].concat(p).some((x) => r[x] === false)) r[k] = false;
  return r;
}

export function rulesSummary(r) {
  const off = RULES.filter((x) => r[x.id] === false).map((x) => x.label);
  return off.length ? `${off.length} système(s) désactivé(s) : ${off.join(', ')}` : 'Tous les systèmes sont actifs.';
}

export const PRESETS = {
  all: { label: 'Activer tout', make: () => ({ ...ALL_ON }) },
  none: { label: 'Tout désactiver', make: () => Object.fromEntries(RULES.map((r) => [r.id, false])) },
  recommended: { label: 'Paramètres recommandés', make: (mode) => defaultRules(mode) },
};

// ---------------- DIFFICULTÉS (Nation Simulator) ----------------
// La difficulté ne donne aucun bonus ni malus : elle règle la COMPLEXITÉ (systèmes actifs, densité
// d'événements et de décisions, profondeur de l'IA).
const off = (...ids) => ({ ...ALL_ON, ...Object.fromEntries(ids.map((x) => [x, false])) });
export const DIFFICULTIES = [
  { id: 'discovery', label: 'Découverte', color: '#82c095', desc: 'Systèmes simplifiés : pas de dette ni de crises, pas de logistique, IA prévisible, aucun événement aléatoire.',
    rules: off('advancedEconomy', 'logistics', 'aiAdvanced', 'events', 'govChanges', 'resources'), eventRate: 0.2, decisionRate: 0.5 },
  { id: 'normal', label: 'Normal', color: '#7fa8d8', desc: 'Simulation complète : économie, dette, logistique, IA stratégique, événements.',
    rules: off('govChanges', 'transformations', 'politicalEvents'), eventRate: 0.45, decisionRate: 1 },
  { id: 'hard', label: 'Difficile', color: '#e3a35a', desc: 'Plus de complexité : changements de gouvernement et événements politiques, décisions plus fréquentes.',
    rules: off('transformations'), eventRate: 0.6, decisionRate: 1.2 },
  { id: 'expert', label: 'Expert', color: '#e47d66', desc: 'Simulation très profonde : transformations nationales, densité élevée d\'événements et de décisions.',
    rules: { ...ALL_ON }, eventRate: 0.75, decisionRate: 1.4 },
  { id: 'grand', label: 'Grand Stratège', color: '#b8a6e0', desc: 'Tous les systèmes, au rythme le plus dense : chaque mois compte.',
    rules: { ...ALL_ON }, eventRate: 0.9, decisionRate: 1.7 },
];
export const DIFFICULTY_BY_ID = Object.fromEntries(DIFFICULTIES.map((d) => [d.id, d]));
