// ARBRES TECHNOLOGIQUES — arbre civil (14 branches) et arbre militaire (13 branches), avec coûts (part du PIB
// annuel), durées, prérequis (dans la branche et entre branches), effets permanents et conséquences (entretien,
// tensions avec les voisins, instabilité…). Chaque pays a des SPÉCIALISATIONS tirées de sa géographie, de son
// économie, de sa puissance et de sa culture stratégique : coûts réduits dans ses domaines forts, technologies
// propres (débarquements pour les puissances maritimes, guerre de montagne, défense en profondeur…).
// Les identifiants de l'ancien arbre de développement (eco1…def4) sont conservés : les sauvegardes restent valides.

// T(id, branche, palier, nom, description, coût (part du PIB), durée (années), effets, prérequis, options)
// options : cons (conséquences), spec (réservée à une spécialisation)
const T = (id, branch, tier, name, desc, cost, years, fx, req = [], o = {}) => ({ id, branch, tier, name, desc, cost, years, fx, req, cons: o.cons || null, spec: o.spec || null });

export const TECH_BRANCHES = [
  // ---- civil ----
  { id: 'eco', cat: 'civil', label: 'Économie', icon: 'coins', rule: 'ecoTech' },
  { id: 'ind', cat: 'civil', label: 'Industrie', icon: 'factory', rule: 'ecoTech' },
  { id: 'agri', cat: 'civil', label: 'Agriculture', icon: 'wheat', rule: 'ecoTech' },
  { id: 'energy', cat: 'civil', label: 'Énergie', icon: 'zap', rule: 'ecoTech' },
  { id: 'tech', cat: 'civil', label: 'Recherche', icon: 'brain', rule: 'research' },
  { id: 'comp', cat: 'civil', label: 'Informatique', icon: 'cpu', rule: 'research' },
  { id: 'infra', cat: 'civil', label: 'Infrastructures', icon: 'route', rule: 'ecoTech' },
  { id: 'transp', cat: 'civil', label: 'Transports', icon: 'plane', rule: 'ecoTech' },
  { id: 'com', cat: 'civil', label: 'Commerce', icon: 'banknote', rule: 'trade' },
  { id: 'edu', cat: 'civil', label: 'Éducation', icon: 'graduation-cap', rule: 'ecoTech' },
  { id: 'med', cat: 'civil', label: 'Médecine', icon: 'activity', rule: 'ecoTech' },
  { id: 'diplo', cat: 'civil', label: 'Diplomatie', icon: 'handshake', rule: 'diplo' },
  { id: 'space', cat: 'civil', label: 'Espace', icon: 'globe', rule: 'research' },
  { id: 'soc', cat: 'civil', label: 'Institutions', icon: 'landmark', rule: 'ecoTech' },
  // ---- militaire ----
  { id: 'def', cat: 'mil', label: 'Défense nationale', icon: 'shield', rule: 'milTech' },
  { id: 'inf', cat: 'mil', label: 'Infanterie', icon: 'users', rule: 'milTech' },
  { id: 'arm', cat: 'mil', label: 'Blindés', icon: 'gauge', rule: 'milTech' },
  { id: 'art', cat: 'mil', label: 'Artillerie', icon: 'crosshair', rule: 'milTech' },
  { id: 'avi', cat: 'mil', label: 'Aviation', icon: 'plane', rule: 'milTech' },
  { id: 'nav', cat: 'mil', label: 'Marine', icon: 'anchor', rule: 'milTech' },
  { id: 'aad', cat: 'mil', label: 'Défense aérienne', icon: 'target', rule: 'milTech' },
  { id: 'intel', cat: 'mil', label: 'Renseignement', icon: 'eye', rule: 'milTech' },
  { id: 'log', cat: 'mil', label: 'Logistique', icon: 'route', rule: 'milTech' },
  { id: 'doc', cat: 'mil', label: 'Doctrines', icon: 'book-marked', rule: 'milTech' },
  { id: 'sof', cat: 'mil', label: 'Forces spéciales', icon: 'flame', rule: 'milTech' },
  { id: 'mtr', cat: 'mil', label: 'Transport militaire', icon: 'ship', rule: 'milTech' },
  { id: 'mtech', cat: 'mil', label: 'Technologie militaire', icon: 'atom', rule: 'milTech' },
];
export const BRANCH_BY_ID = Object.fromEntries(TECH_BRANCHES.map((b) => [b.id, b]));

export const TECHS = [
  // ===================== ÉCONOMIE =====================
  T('eco1', 'eco', 1, 'Économie de base', 'Fiscalité modernisée et marché intérieur organisé.', 0.004, 1, { income: 0.03, growth: 0.002 }),
  T('eco2', 'eco', 2, 'Industrialisation', 'Développement d\'une base industrielle nationale.', 0.008, 1.5, { gdp: 0.03, production: 8, growth: 0.003 }, ['eco1']),
  T('eco3', 'eco', 3, 'Industrie avancée', 'Chaînes de production modernes et efficaces.', 0.012, 2, { gdp: 0.04, production: 8, efficiency: 8 }, ['eco2', 'infra2']),
  T('eco4', 'eco', 4, 'Économie technologique', 'Services à haute valeur ajoutée et numérique.', 0.018, 3, { gdp: 0.05, growth: 0.004, trade: 6 }, ['eco3', 'tech3']),
  T('eco5', 'eco', 5, 'Innovation avancée', 'Une économie tirée par l\'innovation.', 0.025, 4, { gdp: 0.06, growth: 0.006, efficiency: 6 }, ['eco4', 'edu4']),
  T('eco6', 'eco', 6, 'Économie de la connaissance', 'La propriété intellectuelle et les services avancés deviennent le premier moteur de la croissance.', 0.032, 5, { gdp: 0.07, growth: 0.007, income: 0.03 }, ['eco5', 'comp4']),
  // ===================== INDUSTRIE =====================
  T('ind1', 'ind', 1, 'Ateliers mécanisés', 'Machines-outils et premières usines modernes.', 0.005, 1, { production: 6, gdp: 0.01 }),
  T('ind2', 'ind', 2, 'Sidérurgie nationale', 'Acier et métallurgie produits sur le territoire.', 0.009, 1.5, { production: 8, equip: 3, gdp: 0.015 }, ['ind1', 'energy1']),
  T('ind3', 'ind', 3, 'Chimie et matériaux', 'Plastiques, engrais et matériaux composites.', 0.013, 2, { production: 6, efficiency: 6, gdp: 0.02 }, ['ind2'], { cons: { stability: -1 } }),
  T('ind4', 'ind', 4, 'Robotisation', 'Lignes de production automatisées.', 0.019, 3, { efficiency: 10, gdp: 0.03, equip: 3 }, ['ind3', 'comp2'], { cons: { stability: -2 } }),
  T('ind5', 'ind', 5, 'Usines intelligentes', 'Production pilotée par les données, rapide et flexible.', 0.026, 4, { efficiency: 10, production: 8, gdp: 0.04 }, ['ind4', 'comp3']),
  T('ind6', 'ind', 6, 'Nanomatériaux', 'Matériaux conçus atome par atome pour l\'industrie de pointe.', 0.033, 5, { efficiency: 8, equip: 6, gdp: 0.04, tech: 2 }, ['ind5', 'tech5']),
  // ===================== AGRICULTURE =====================
  T('agri1', 'agri', 1, 'Irrigation', 'Canaux et réservoirs : récoltes plus sûres.', 0.003, 1, { food: 1, growth: 0.001 }),
  T('agri2', 'agri', 2, 'Mécanisation agricole', 'Tracteurs et moissonneuses : moins de bras, plus de récoltes.', 0.006, 1.5, { food: 1, efficiency: 3, gdp: 0.01 }, ['agri1', 'ind1']),
  T('agri3', 'agri', 3, 'Révolution verte', 'Semences sélectionnées, engrais et protection des cultures.', 0.009, 2, { food: 2, popGrowth: 0.1, stability: 2 }, ['agri2', 'ind3']),
  T('agri4', 'agri', 4, 'Agro-industrie', 'Transformation et exportation des produits agricoles.', 0.013, 2.5, { food: 1, trade: 4, gdp: 0.02 }, ['agri3', 'com2']),
  T('agri5', 'agri', 5, 'Agriculture de précision', 'Capteurs, satellites et génétique végétale.', 0.018, 3, { food: 2, efficiency: 4, gdp: 0.02 }, ['agri4', 'comp3']),
  T('agri6', 'agri', 6, 'Autonomie alimentaire', 'Le pays nourrit sa population même en cas de blocus.', 0.022, 4, { food: 3, stability: 4, blockadeRes: 0.4 }, ['agri5', 'energy4']),
  // ===================== ÉNERGIE =====================
  T('energy1', 'energy', 1, 'Électrification', 'Réseau électrique national.', 0.005, 1, { energy: 1, production: 4, gdp: 0.01 }),
  T('energy2', 'energy', 2, 'Centrales thermiques', 'Production d\'électricité à grande échelle.', 0.009, 1.5, { energy: 1, production: 5, gdp: 0.015 }, ['energy1'], { cons: { stability: -1 } }),
  T('energy3', 'energy', 3, 'Hydrocarbures modernes', 'Exploration, raffinage et réserves stratégiques.', 0.012, 2, { energy: 1, gdp: 0.02, supply: 0.04 }, ['energy2', 'ind2']),
  T('energy4', 'energy', 4, 'Énergie nucléaire civile', 'Centrales nucléaires : électricité abondante et stable.', 0.022, 4, { energy: 2, gdp: 0.03, efficiency: 4 }, ['energy3', 'tech3'], { cons: { tension: 2, upkeep: 0.001 } }),
  T('energy5', 'energy', 5, 'Énergies renouvelables', 'Éolien, solaire et stockage à grande échelle.', 0.024, 4, { energy: 2, gdp: 0.02, stability: 3, growth: 0.002 }, ['energy4', 'ind4']),
  T('energy6', 'energy', 6, 'Réseaux intelligents', 'Production, stockage et consommation pilotés en temps réel.', 0.028, 4, { energy: 2, efficiency: 6, gdp: 0.03 }, ['energy5', 'comp4']),
  // ===================== RECHERCHE =====================
  T('tech1', 'tech', 1, 'Recherche fondamentale', 'Laboratoires publics et financement de la science.', 0.005, 1.5, { research: 0.15, tech: 1.5 }),
  T('tech2', 'tech', 2, 'Innovation', 'Transfert de la recherche vers les entreprises.', 0.009, 2, { research: 0.15, tech: 2, efficiency: 4 }, ['tech1']),
  T('tech3', 'tech', 3, 'Technologies avancées', 'Matériaux, énergie et informatique de pointe.', 0.015, 3, { research: 0.2, tech: 3, gdp: 0.02 }, ['tech2', 'edu2']),
  T('tech4', 'tech', 4, 'Centre de recherche national', 'Un pôle scientifique de rang mondial.', 0.022, 4, { research: 0.3, tech: 4, equip: 4 }, ['tech3']),
  T('tech5', 'tech', 5, 'Biotechnologies', 'Génétique, santé et matériaux vivants.', 0.026, 4, { research: 0.2, tech: 3, health: 1, gdp: 0.02 }, ['tech4', 'med3']),
  T('tech6', 'tech', 6, 'Technologies quantiques', 'Calcul et communications quantiques.', 0.035, 5, { research: 0.3, tech: 5, intel: 0.04 }, ['tech5', 'comp5']),
  // ===================== INFORMATIQUE =====================
  T('comp1', 'comp', 1, 'Informatisation', 'Ordinateurs dans les administrations et les entreprises.', 0.005, 1, { efficiency: 3, income: 0.01 }, ['tech1']),
  T('comp2', 'comp', 2, 'Réseaux et Internet', 'Accès généralisé au réseau.', 0.009, 1.5, { efficiency: 4, trade: 3, gdp: 0.015 }, ['comp1', 'infra2']),
  T('comp3', 'comp', 3, 'Économie numérique', 'Commerce, services et paiements en ligne.', 0.013, 2, { gdp: 0.03, trade: 4, growth: 0.002 }, ['comp2']),
  T('comp4', 'comp', 4, 'Cybersécurité', 'Protection des réseaux de l\'État et des entreprises.', 0.016, 2.5, { stability: 3, intel: 0.04, def: 0.02 }, ['comp3']),
  T('comp5', 'comp', 5, 'Intelligence artificielle', 'Systèmes d\'aide à la décision et automatisation avancée.', 0.026, 4, { efficiency: 8, research: 0.2, gdp: 0.04 }, ['comp4', 'tech4'], { cons: { stability: -2 } }),
  T('comp6', 'comp', 6, 'Supercalculateurs', 'Calcul massif pour la science, l\'industrie et la défense.', 0.03, 4, { research: 0.25, tech: 3, intel: 0.03 }, ['comp5']),
  // ===================== INFRASTRUCTURES =====================
  T('infra1', 'infra', 1, 'Routes', 'Réseau routier principal entretenu et étendu.', 0.005, 1, { infra: 6, speed: 0.04 }),
  T('infra2', 'infra', 2, 'Réseau national', 'Routes et voies ferrées reliant tout le territoire.', 0.01, 2, { infra: 8, speed: 0.06, trade: 3, growth: 0.002 }, ['infra1']),
  T('infra3', 'infra', 3, 'Infrastructures modernes', 'Ports, aéroports et énergie modernisés.', 0.016, 3, { infra: 10, ports: 8, trade: 5, gdp: 0.02 }, ['infra2']),
  T('infra4', 'infra', 4, 'Réseau haute performance', 'Transports rapides et réseaux numériques nationaux.', 0.024, 4, { infra: 12, speed: 0.08, gdp: 0.03, growth: 0.003 }, ['infra3', 'tech2']),
  T('infra5', 'infra', 5, 'Villes intelligentes', 'Urbanisme, services et réseaux pilotés par les données.', 0.028, 4, { infra: 8, stability: 3, efficiency: 4, gdp: 0.02 }, ['infra4', 'comp3']),
  T('infra6', 'infra', 6, 'Infrastructures résilientes', 'Réseaux doublés, protégés et réparables rapidement.', 0.03, 4, { infra: 6, def: 0.03, blockadeRes: 0.2, supply: 0.05 }, ['infra5', 'energy5']),
  // ===================== TRANSPORTS =====================
  T('transp1', 'transp', 1, 'Chemins de fer', 'Lignes ferroviaires entre les grandes villes.', 0.006, 1.5, { infra: 4, speed: 0.04, trade: 2 }, ['infra1']),
  T('transp2', 'transp', 2, 'Ports en eau profonde', 'Grands ports de commerce.', 0.009, 2, { ports: 10, trade: 4 }, ['transp1']),
  T('transp3', 'transp', 3, 'Autoroutes', 'Réseau autoroutier national.', 0.012, 2, { speed: 0.06, infra: 4, gdp: 0.01 }, ['transp1', 'infra2']),
  T('transp4', 'transp', 4, 'Aviation civile', 'Grands aéroports et compagnies nationales.', 0.014, 2.5, { trade: 4, gdp: 0.015, airlift: 0.3 }, ['transp3', 'ind3']),
  T('transp5', 'transp', 5, 'Trains à grande vitesse', 'Lignes rapides entre les métropoles.', 0.022, 4, { speed: 0.08, growth: 0.003, stability: 2 }, ['transp4', 'infra4']),
  T('transp6', 'transp', 6, 'Logistique automatisée', 'Plateformes, conteneurs et transport pilotés par l\'IA.', 0.026, 4, { trade: 6, efficiency: 4, supply: 0.05 }, ['transp5', 'comp5']),
  // ===================== COMMERCE =====================
  T('com1', 'com', 1, 'Douanes modernes', 'Procédures simplifiées et lutte contre la fraude.', 0.003, 1, { trade: 3, income: 0.015 }),
  T('com2', 'com', 2, 'Zones franches', 'Zones industrielles et portuaires ouvertes aux investisseurs.', 0.006, 1.5, { trade: 5, gdp: 0.015 }, ['com1']),
  T('com3', 'com', 3, 'Place financière', 'Banques, bourse et assurances de rang international.', 0.01, 2, { gdp: 0.02, income: 0.02, trade: 4 }, ['com2', 'eco2']),
  T('com4', 'com', 4, 'Réseau d\'accords', 'Diplomatie économique et accords de libre-échange.', 0.012, 2.5, { trade: 6, relAll: 3, gdp: 0.02 }, ['com3', 'diplo2']),
  T('com5', 'com', 5, 'Monnaie de réserve', 'La monnaie nationale sert aux échanges internationaux.', 0.02, 4, { income: 0.03, gdp: 0.03, diplo: 0.1 }, ['com4', 'eco4']),
  // ===================== ÉDUCATION =====================
  T('edu1', 'edu', 1, 'Éducation de base', 'Scolarisation générale et alphabétisation.', 0.004, 1.5, { stability: 3, growth: 0.002, research: 0.05 }),
  T('edu2', 'edu', 2, 'Enseignement supérieur', 'Lycées et formations techniques développés.', 0.008, 2, { efficiency: 5, research: 0.1, growth: 0.002 }, ['edu1']),
  T('edu3', 'edu', 3, 'Universités', 'Universités nationales et formation des chercheurs.', 0.013, 3, { research: 0.15, tech: 2, efficiency: 4 }, ['edu2']),
  T('edu4', 'edu', 4, 'Recherche avancée', 'Écoles doctorales et recherche de haut niveau.', 0.02, 4, { research: 0.2, tech: 3, gdp: 0.02 }, ['edu3', 'tech2']),
  T('edu5', 'edu', 5, 'Formation tout au long de la vie', 'Requalification permanente des travailleurs.', 0.022, 4, { efficiency: 6, growth: 0.003, stability: 2 }, ['edu4', 'comp3']),
  // ===================== MÉDECINE =====================
  T('med1', 'med', 1, 'Hygiène publique', 'Eau potable, vaccination et dispensaires.', 0.004, 1, { health: 1, popGrowth: 0.08 }),
  T('med2', 'med', 2, 'Hôpitaux modernes', 'Réseau hospitalier national.', 0.008, 1.5, { health: 1, stability: 2 }, ['med1', 'edu1']),
  T('med3', 'med', 3, 'Industrie pharmaceutique', 'Médicaments produits sur le territoire.', 0.012, 2, { health: 1, gdp: 0.015, research: 0.05 }, ['med2', 'ind3']),
  T('med4', 'med', 4, 'Médecine militaire', 'Chirurgie de guerre et évacuations sanitaires : moins de pertes.', 0.012, 2, { casualties: -0.12, morale: 0.04 }, ['med3', 'def2']),
  T('med5', 'med', 5, 'Couverture santé universelle', 'Soins accessibles à toute la population.', 0.022, 4, { health: 2, stability: 4, popGrowth: 0.05 }, ['med4', 'soc3'], { cons: { upkeep: 0.002 } }),
  T('med6', 'med', 6, 'Médecine de précision', 'Diagnostics génétiques et traitements personnalisés.', 0.026, 4, { health: 1, research: 0.1, gdp: 0.02 }, ['med5', 'tech5']),
  // ===================== DIPLOMATIE =====================
  T('diplo1', 'diplo', 1, 'Relations internationales', 'Réseau d\'ambassades et de consulats.', 0.002, 1, { diplo: 0.1, relAll: 4 }),
  T('diplo2', 'diplo', 2, 'Accords commerciaux', 'Diplomatie économique et ouverture des marchés.', 0.004, 1.5, { trade: 8, diplo: 0.1 }, ['diplo1']),
  T('diplo3', 'diplo', 3, 'Partenariats', 'Partenariats stratégiques durables.', 0.007, 2, { diplo: 0.15, relAll: 5, trade: 4 }, ['diplo2']),
  T('diplo4', 'diplo', 4, 'Coopération internationale', 'Influence dans les organisations internationales.', 0.011, 3, { diplo: 0.2, relAll: 6, stability: 3 }, ['diplo3']),
  T('diplo5', 'diplo', 5, 'Puissance d\'influence', 'Médias, culture et aide au développement au service du pays.', 0.016, 3, { diplo: 0.2, relAll: 8, trade: 3 }, ['diplo4', 'edu3']),
  // ===================== ESPACE =====================
  T('space1', 'space', 1, 'Fusées-sondes', 'Premiers lanceurs expérimentaux.', 0.008, 2, { tech: 1.5, research: 0.05 }, ['tech2', 'ind2']),
  T('space2', 'space', 2, 'Satellites de communication', 'Télécommunications et télévision par satellite.', 0.014, 3, { trade: 3, gdp: 0.015, prestige: 3 }, ['space1', 'comp2']),
  T('space3', 'space', 3, 'Observation de la Terre', 'Météo, cartographie et surveillance du territoire.', 0.016, 3, { intel: 0.05, food: 1, prestige: 3 }, ['space2']),
  T('space4', 'space', 4, 'Navigation par satellite', 'Positionnement précis pour l\'économie et les armées.', 0.02, 3, { efficiency: 4, atk: 0.03, speed: 0.03 }, ['space3', 'comp3'], { cons: { tension: 3 } }),
  T('space5', 'space', 5, 'Vols habités', 'Astronautes nationaux et station orbitale.', 0.03, 5, { prestige: 8, research: 0.15, tech: 3 }, ['space4', 'tech4']),
  T('space6', 'space', 6, 'Industrie spatiale', 'Lanceurs réutilisables et économie orbitale.', 0.034, 5, { gdp: 0.04, research: 0.1, prestige: 5 }, ['space5', 'ind5']),
  // ===================== INSTITUTIONS =====================
  T('soc1', 'soc', 1, 'Administration moderne', 'Fonction publique formée et cadastre à jour.', 0.003, 1, { income: 0.02, stability: 2 }),
  T('soc2', 'soc', 2, 'État de droit', 'Justice indépendante et lutte contre la corruption.', 0.006, 2, { stability: 4, growth: 0.002 }, ['soc1', 'edu1']),
  T('soc3', 'soc', 3, 'Protection sociale', 'Retraites, chômage et aides aux familles.', 0.012, 3, { stability: 5, popGrowth: 0.05 }, ['soc2'], { cons: { upkeep: 0.0015 } }),
  T('soc4', 'soc', 4, 'Administration numérique', 'Démarches en ligne et impôts simplifiés.', 0.012, 2, { income: 0.03, efficiency: 3 }, ['soc3', 'comp3']),
  T('soc5', 'soc', 5, 'Cohésion nationale', 'Institutions solides, adhésion de la population en temps de crise.', 0.016, 3, { stability: 6, morale: 0.06, mobilization: 0.1 }, ['soc4', 'edu4']),

  // ===================== DÉFENSE NATIONALE =====================
  T('def1', 'def', 1, 'Défense nationale', 'Doctrine et commandement unifiés.', 0.004, 1, { readiness: 0.04, fort: 0.15 }),
  T('def2', 'def', 2, 'Organisation', 'Logistique, formation et réserves organisées.', 0.008, 1.5, { readiness: 0.05, recruit: 0.25, supply: 0.05 }, ['def1']),
  T('def3', 'def', 3, 'Modernisation', 'Équipements renouvelés et standardisés.', 0.013, 2.5, { equip: 8, readiness: 0.04 }, ['def2', 'tech1']),
  T('def4', 'def', 4, 'Capacités avancées', 'Capacités aériennes, navales et de renseignement.', 0.02, 3.5, { equip: 8, air: 0.2, navy: 0.15 }, ['def3', 'tech3']),
  T('def5', 'def', 5, 'Défense intégrée', 'Commandement commun terre-air-mer en temps réel.', 0.026, 4, { atk: 0.04, def: 0.05, readiness: 0.05 }, ['def4', 'comp4']),
  // ===================== INFANTERIE =====================
  T('inf1', 'inf', 1, 'Armement individuel moderne', 'Fusils, protections et uniformes standardisés.', 0.004, 1, { def: 0.03, equip: 2 }, ['def1']),
  T('inf2', 'inf', 2, 'Infanterie motorisée', 'Camions et véhicules de transport de troupes.', 0.007, 1.5, { speed: 0.05, atk: 0.02 }, ['inf1', 'ind1']),
  T('inf3', 'inf', 3, 'Infanterie mécanisée', 'Véhicules blindés de combat d\'infanterie.', 0.011, 2, { atk: 0.04, def: 0.03 }, ['inf2', 'arm1']),
  T('inf4', 'inf', 4, 'Fantassin connecté', 'Vision nocturne, radio et données partagées.', 0.016, 2.5, { atk: 0.03, def: 0.04, intel: 0.02 }, ['inf3', 'comp2']),
  T('inf5', 'inf', 5, 'Infanterie de nouvelle génération', 'Protection avancée, drones de section et appui automatisé.', 0.022, 3, { atk: 0.05, def: 0.05, casualties: -0.06 }, ['inf4', 'mtech3']),
  // ===================== BLINDÉS =====================
  T('arm1', 'arm', 1, 'Chars de combat', 'Premières unités blindées.', 0.008, 1.5, { atk: 0.04, atkTerr: { plains: 0.04 } }, ['def1', 'ind2']),
  T('arm2', 'arm', 2, 'Divisions blindées', 'Blindés regroupés pour la percée.', 0.012, 2, { atk: 0.04, atkTerr: { plains: 0.06, desert: 0.04 } }, ['arm1', 'inf2']),
  T('arm3', 'arm', 3, 'Chars modernes', 'Blindage composite, conduite de tir numérique.', 0.017, 2.5, { atk: 0.05, def: 0.03 }, ['arm2', 'ind3']),
  T('arm4', 'arm', 4, 'Protection active', 'Systèmes de protection contre les missiles antichars.', 0.021, 3, { def: 0.05, casualties: -0.05 }, ['arm3', 'comp3']),
  T('arm5', 'arm', 5, 'Blindés de nouvelle génération', 'Chars connectés et véhicules robotisés d\'accompagnement.', 0.028, 4, { atk: 0.07, atkTerr: { plains: 0.05 } }, ['arm4', 'mtech3']),
  // ===================== ARTILLERIE =====================
  T('art1', 'art', 1, 'Artillerie tractée', 'Canons et obusiers en batteries.', 0.005, 1, { atk: 0.03, artillery: 0.05 }, ['def1']),
  T('art2', 'art', 2, 'Artillerie automotrice', 'Obusiers blindés qui suivent les offensives.', 0.009, 1.5, { atk: 0.03, artillery: 0.06 }, ['art1', 'arm1']),
  T('art3', 'art', 3, 'Lance-roquettes multiples', 'Feux massifs sur les positions ennemies.', 0.013, 2, { atk: 0.04, artillery: 0.08 }, ['art2', 'ind3']),
  T('art4', 'art', 4, 'Munitions de précision', 'Obus et roquettes guidés.', 0.019, 3, { atk: 0.04, artillery: 0.1, casualties: -0.03 }, ['art3', 'space4']),
  T('art5', 'art', 5, 'Feux en réseau', 'Capteurs, drones et artillerie reliés en temps réel.', 0.024, 3.5, { atk: 0.06, artillery: 0.08 }, ['art4', 'intel3']),
  // ===================== AVIATION =====================
  T('avi1', 'avi', 1, 'Aviation de chasse', 'Escadrilles de chasseurs.', 0.008, 1.5, { air: 0.15 }, ['def1', 'ind2']),
  T('avi2', 'avi', 2, 'Aviation d\'appui', 'Avions d\'attaque au sol.', 0.012, 2, { air: 0.15, atk: 0.03 }, ['avi1']),
  T('avi3', 'avi', 3, 'Avions à réaction', 'Chasseurs-bombardiers modernes.', 0.017, 2.5, { air: 0.2, atk: 0.02 }, ['avi2', 'ind3']),
  T('avi4', 'avi', 4, 'Supériorité aérienne', 'Chasseurs multirôles, radars aéroportés, ravitaillement en vol.', 0.024, 3, { air: 0.25, atk: 0.03 }, ['avi3', 'comp3']),
  T('avi5', 'avi', 5, 'Furtivité', 'Avions difficiles à détecter.', 0.032, 4.5, { air: 0.3, atk: 0.04 }, ['avi4', 'mtech3'], { cons: { tension: 4, upkeep: 0.0015 } }),
  // ===================== MARINE =====================
  T('nav1', 'nav', 1, 'Garde-côtes', 'Patrouilleurs et surveillance des côtes.', 0.005, 1, { navy: 0.12, def: 0.01 }, ['def1']),
  T('nav2', 'nav', 2, 'Flotte de surface', 'Frégates et destroyers.', 0.011, 2, { navy: 0.2 }, ['nav1', 'ind2']),
  T('nav3', 'nav', 3, 'Sous-marins', 'Flotte sous-marine d\'attaque.', 0.016, 3, { navy: 0.2, blockade: 0.2 }, ['nav2', 'ind3']),
  T('nav4', 'nav', 4, 'Groupe aéronaval', 'Porte-avions et escorte.', 0.03, 5, { navy: 0.3, air: 0.1, sealift: 1 }, ['nav3', 'avi3'], { cons: { tension: 4, upkeep: 0.002 } }),
  T('nav5', 'nav', 5, 'Marine de haute mer', 'Flotte capable d\'opérer sur tous les océans.', 0.03, 5, { navy: 0.3, sealift: 1, seaRange: 0.3 }, ['nav4', 'space4']),
  // ===================== DÉFENSE AÉRIENNE =====================
  T('aad1', 'aad', 1, 'Défense antiaérienne', 'Canons et batteries autour des sites stratégiques.', 0.004, 1, { airDef: 0.08 }, ['def1']),
  T('aad2', 'aad', 2, 'Radars de surveillance', 'Couverture radar du territoire.', 0.008, 1.5, { airDef: 0.08, intel: 0.02 }, ['aad1', 'comp1']),
  T('aad3', 'aad', 3, 'Missiles sol-air', 'Batteries de missiles mobiles.', 0.014, 2, { airDef: 0.12 }, ['aad2', 'ind3']),
  T('aad4', 'aad', 4, 'Défense multicouche', 'Courte, moyenne et longue portée coordonnées.', 0.021, 3, { airDef: 0.12, def: 0.03 }, ['aad3', 'comp3']),
  T('aad5', 'aad', 5, 'Défense antimissile', 'Interception des missiles balistiques et des drones.', 0.03, 4.5, { airDef: 0.15, def: 0.03 }, ['aad4', 'space4'], { cons: { tension: 3, upkeep: 0.0015 } }),
  // ===================== RENSEIGNEMENT =====================
  T('intel1', 'intel', 1, 'Service de renseignement', 'Agence nationale de renseignement.', 0.003, 1, { intel: 0.04 }, ['def1']),
  T('intel2', 'intel', 2, 'Écoutes et interceptions', 'Renseignement d\'origine électromagnétique.', 0.007, 1.5, { intel: 0.05 }, ['intel1', 'comp1']),
  T('intel3', 'intel', 3, 'Drones de reconnaissance', 'Surveillance permanente des fronts.', 0.012, 2, { intel: 0.06, atk: 0.02 }, ['intel2', 'avi1']),
  T('intel4', 'intel', 4, 'Cyberdéfense militaire', 'Protection des réseaux militaires et opérations dans le cyberespace.', 0.016, 2.5, { intel: 0.05, def: 0.03 }, ['intel3', 'comp4']),
  T('intel5', 'intel', 5, 'Fusion du renseignement', 'Satellites, drones et sources humaines analysés par l\'IA.', 0.022, 3, { intel: 0.08, atk: 0.03 }, ['intel4', 'comp5']),
  // ===================== LOGISTIQUE =====================
  T('log1', 'log', 1, 'Intendance', 'Dépôts et chaînes de ravitaillement.', 0.004, 1, { supply: 0.05 }, ['def1']),
  T('log2', 'log', 2, 'Logistique motorisée', 'Convois de camions et dépôts avancés.', 0.008, 1.5, { supply: 0.06, speed: 0.03 }, ['log1', 'inf2']),
  T('log3', 'log', 3, 'Réserves stratégiques', 'Stocks de munitions, carburant et pièces détachées.', 0.012, 2, { supply: 0.06, readiness: 0.04, blockadeRes: 0.15 }, ['log2', 'energy3']),
  T('log4', 'log', 4, 'Logistique interarmées', 'Planification commune et suivi des stocks en temps réel.', 0.016, 2.5, { supply: 0.07, speed: 0.04 }, ['log3', 'comp3']),
  T('log5', 'log', 5, 'Logistique prédictive', 'Ravitaillement anticipé grâce aux données du front.', 0.02, 3, { supply: 0.08, atk: 0.03 }, ['log4', 'comp5']),
  // ===================== DOCTRINES =====================
  T('doc1', 'doc', 1, 'Défense en profondeur', 'Lignes successives qui usent l\'attaquant.', 0.004, 1, { def: 0.05, fort: 0.1 }, ['def1']),
  T('doc2', 'doc', 2, 'Guerre de mouvement', 'Percées rapides et exploitation.', 0.006, 1.5, { atk: 0.05, speed: 0.04 }, ['def1']),
  T('doc3', 'doc', 3, 'Opérations combinées', 'Infanterie, blindés, artillerie et aviation agissent ensemble.', 0.01, 2, { atk: 0.04, def: 0.03 }, ['doc2', 'avi2']),
  T('doc4', 'doc', 4, 'Guerre en réseau', 'Les unités partagent la même image du champ de bataille.', 0.016, 2.5, { atk: 0.05, def: 0.04, intel: 0.03 }, ['doc3', 'comp3']),
  T('doc5', 'doc', 5, 'Guerre multidomaine', 'Terre, air, mer, espace et cyberespace planifiés ensemble.', 0.022, 3, { atk: 0.06, def: 0.05 }, ['doc4', 'space4']),
  // ===================== FORCES SPÉCIALES =====================
  T('sof1', 'sof', 1, 'Commandos', 'Unités d\'élite pour les coups de main.', 0.004, 1, { sof: 0.1 }, ['inf1']),
  T('sof2', 'sof', 2, 'Troupes aéroportées', 'Parachutistes et assaut héliporté.', 0.009, 1.5, { sof: 0.1, airlift: 0.3 }, ['sof1', 'avi1']),
  T('sof3', 'sof', 3, 'Opérations derrière les lignes', 'Sabotage des dépôts et des communications ennemies.', 0.012, 2, { sof: 0.15, atk: 0.02 }, ['sof2', 'intel2']),
  T('sof4', 'sof', 4, 'Commandement des opérations spéciales', 'Forces spéciales interarmées entraînées pour toutes les missions.', 0.016, 2.5, { sof: 0.15, intel: 0.03 }, ['sof3', 'intel3']),
  // ===================== TRANSPORT MILITAIRE =====================
  T('mtr1', 'mtr', 1, 'Navires de transport', 'Transports de troupes et de matériel.', 0.006, 1, { sealift: 1 }, ['def1', 'transp2']),
  T('mtr2', 'mtr', 2, 'Moyens de débarquement', 'Barges et navires amphibies.', 0.01, 1.5, { sealift: 1, landing: 0.15 }, ['mtr1', 'nav1']),
  T('mtr3', 'mtr', 3, 'Pont aérien', 'Avions de transport stratégique.', 0.013, 2, { airlift: 0.5, speed: 0.03 }, ['mtr1', 'transp4']),
  T('mtr4', 'mtr', 4, 'Projection de forces', 'Déployer rapidement une armée loin du territoire.', 0.02, 3, { sealift: 1, seaRange: 0.25, landing: 0.15 }, ['mtr2', 'mtr3']),
  // ===================== TECHNOLOGIE MILITAIRE =====================
  T('mtech1', 'mtech', 1, 'Industrie de défense', 'Arsenaux et entreprises de défense nationales.', 0.007, 1.5, { equip: 5, production: 2 }, ['def1', 'ind2']),
  T('mtech2', 'mtech', 2, 'Électronique militaire', 'Radios, capteurs et contre-mesures.', 0.011, 2, { equip: 4, intel: 0.03, def: 0.02 }, ['mtech1', 'comp1']),
  T('mtech3', 'mtech', 3, 'Drones armés', 'Drones d\'observation et d\'attaque.', 0.016, 2.5, { atk: 0.05, air: 0.1 }, ['mtech2', 'intel3'], { cons: { tension: 2 } }),
  T('mtech4', 'mtech', 4, 'Missiles de croisière', 'Frappes de précision à longue distance.', 0.022, 3, { atk: 0.04, artillery: 0.08 }, ['mtech3', 'space4'], { cons: { tension: 4 } }),
  T('mtech5', 'mtech', 5, 'Armes à énergie dirigée', 'Lasers contre les drones et les missiles.', 0.03, 4.5, { airDef: 0.12, def: 0.04 }, ['mtech4', 'tech5'], { cons: { upkeep: 0.001 } }),

  // ===================== TECHNOLOGIES PROPRES AUX SPÉCIALISATIONS =====================
  T('sp_amph', 'mtr', 3, 'Infanterie de marine', 'Troupes d\'assaut amphibie : les débarquements réussissent bien plus souvent.', 0.012, 2, { landing: 0.3, sealift: 1 }, ['mtr2'], { spec: 'maritime' }),
  T('sp_blue', 'nav', 4, 'Contrôle des mers', 'Une marine qui domine ses routes maritimes et protège ses convois.', 0.022, 3, { navy: 0.25, seaRange: 0.2, convoy: 0.4 }, ['nav3'], { spec: 'maritime' }),
  T('sp_mount', 'inf', 3, 'Troupes de montagne', 'Unités entraînées au combat en altitude.', 0.009, 1.5, { atkTerr: { mountains: 0.15, hills: 0.08 }, defTerr: { mountains: 0.1 } }, ['inf2'], { spec: 'mountain' }),
  T('sp_desert', 'arm', 3, 'Guerre du désert', 'Blindés et logistique adaptés aux grands espaces arides.', 0.01, 1.5, { atkTerr: { desert: 0.15 }, supply: 0.04 }, ['arm1'], { spec: 'desert' }),
  T('sp_arctic', 'inf', 3, 'Combat arctique', 'Troupes et matériels adaptés au grand froid.', 0.009, 1.5, { atkTerr: { tundra: 0.15, forest: 0.06 }, defTerr: { tundra: 0.1 } }, ['inf2'], { spec: 'arctic' }),
  T('sp_depth', 'doc', 3, 'Espace stratégique', 'Un immense territoire qui use les envahisseurs : repli, dispersion, contre-offensive.', 0.01, 2, { def: 0.06, fort: 0.1, mobilization: 0.1 }, ['doc1'], { spec: 'continental' }),
  T('sp_rail', 'log', 3, 'Réseau ferré militaire', 'Les armées traversent le pays en quelques jours.', 0.012, 2, { speed: 0.08, supply: 0.05 }, ['log2', 'transp1'], { spec: 'continental' }),
  T('sp_arsenal', 'mtech', 3, 'Arsenal national', 'Une industrie lourde capable de produire en masse en temps de guerre.', 0.014, 2, { equip: 6, recruit: 0.2, production: 3 }, ['mtech1'], { spec: 'industrial' }),
  T('sp_resource', 'energy', 4, 'Diplomatie de l\'énergie', 'Les ressources du pays deviennent un levier d\'influence.', 0.012, 2, { diplo: 0.15, income: 0.03, relAll: 3 }, ['energy3'], { spec: 'resource' }),
  T('sp_tech', 'mtech', 4, 'Supériorité technologique', 'Des armements d\'une génération d\'avance.', 0.026, 3.5, { atk: 0.05, def: 0.05, equip: 6 }, ['mtech3', 'tech4'], { spec: 'tech' }),
  T('sp_power', 'doc', 4, 'Dissuasion globale', 'Une puissance qui pèse sur tous les théâtres : les adversaires hésitent à l\'attaquer.', 0.025, 4, { def: 0.06, diplo: 0.1, prestige: 4 }, ['doc3'], { spec: 'power', cons: { tension: 3 } }),
  T('sp_neutral', 'diplo', 4, 'Neutralité armée', 'Une défense dissuasive et une diplomatie respectée.', 0.01, 2, { def: 0.08, relAll: 5, fort: 0.15 }, ['diplo2', 'doc1'], { spec: 'small' }),
  T('sp_agri', 'agri', 4, 'Grenier du monde', 'Exportations agricoles massives et sécurité alimentaire.', 0.012, 2, { food: 2, trade: 5, relAll: 2 }, ['agri3'], { spec: 'agrarian' }),
  T('sp_trade', 'com', 4, 'Plaque tournante commerciale', 'Ports, finance et logistique au carrefour des routes mondiales.', 0.014, 2, { trade: 8, income: 0.02, ports: 6 }, ['com2'], { spec: 'trader' }),
];
export const TECH_BY_ID = Object.fromEntries(TECHS.map((t) => [t.id, t]));

export const SPECIALIZATIONS = {
  maritime: { label: 'Puissance maritime', desc: 'Littoral étendu ou insulaire : marine, débarquements et commerce maritime.', aff: { nav: 1.35, mtr: 1.35, transp: 1.15, com: 1.1 } },
  continental: { label: 'Puissance continentale', desc: 'Immense territoire terrestre : profondeur stratégique, chemins de fer et blindés.', aff: { arm: 1.25, log: 1.3, doc: 1.15, transp: 1.15 } },
  mountain: { label: 'Pays de montagnes', desc: 'Relief difficile : infanterie de montagne et défense.', aff: { inf: 1.3, doc: 1.1, def: 1.1 } },
  desert: { label: 'Pays désertique', desc: 'Grands espaces arides : blindés et logistique.', aff: { arm: 1.2, log: 1.2, energy: 1.1 } },
  arctic: { label: 'Pays du grand froid', desc: 'Climat polaire : troupes adaptées et énergie.', aff: { inf: 1.15, energy: 1.15, log: 1.1 } },
  industrial: { label: 'Puissance industrielle', desc: 'Base industrielle large : production d\'armement et d\'équipements.', aff: { ind: 1.3, mtech: 1.2, arm: 1.1, energy: 1.1 } },
  resource: { label: 'Économie des ressources', desc: 'Matières premières abondantes : énergie et influence.', aff: { energy: 1.3, com: 1.1, diplo: 1.1 } },
  tech: { label: 'Puissance technologique', desc: 'Recherche de pointe : informatique, espace, armes avancées.', aff: { tech: 1.3, comp: 1.3, space: 1.25, mtech: 1.2, intel: 1.15, avi: 1.1 } },
  power: { label: 'Grande puissance militaire', desc: 'Forces armées complètes : aviation, marine, projection.', aff: { avi: 1.2, nav: 1.15, mtr: 1.15, space: 1.15, doc: 1.1 } },
  small: { label: 'Petit État', desc: 'Territoire réduit : défense dissuasive et diplomatie.', aff: { diplo: 1.3, aad: 1.15, intel: 1.15, com: 1.15, doc: 1.05 } },
  agrarian: { label: 'Puissance agricole', desc: 'Terres fertiles : agriculture et exportations alimentaires.', aff: { agri: 1.35, com: 1.05 } },
  trader: { label: 'Nation commerçante', desc: 'Économie ouverte : commerce, finance et transports.', aff: { com: 1.35, transp: 1.15, eco: 1.1 } },
  militarist: { label: 'Culture militaire', desc: 'Armée au centre de l\'État : infanterie, artillerie et forces spéciales.', aff: { inf: 1.15, art: 1.2, sof: 1.2, def: 1.15 } },
};

// spécialisations d'un pays (géographie, économie, puissance, culture stratégique) — calcul mis en cache
// pays arides (le modèle de terrain du jeu sous-estime les déserts)
const ARID = new Set(['DZ', 'LY', 'EG', 'SA', 'AE', 'OM', 'YE', 'QA', 'KW', 'BH', 'IQ', 'JO', 'SY', 'MR', 'ML', 'NE', 'TD', 'SD', 'SO', 'DJ', 'ER', 'NA', 'TM', 'UZ', 'AU', 'EH', 'IR', 'PK', 'AF']);
export function specsOf(sim, k) {
  const sd = sim.sides[k];
  if (sd.techSpecs && sd.techSpecs.t > sim.time - 365) return sd.techSpecs.list;
  const g = sim.grid, geo = sim.geo;
  let n = 0, coast = 0;
  const bio = [0, 0, 0, 0, 0, 0];
  for (let i = 0; i < sim.n; i++) {
    if (sim.owner[i] !== sd.e) continue;
    n++;
    if (g.coastal[i]) coast++;
    if (geo) bio[geo.biome[i]]++;
  }
  const p = sd.p, d = p.derived || {};
  const P = sd.ai ? sd.ai.personality : '';
  const ent = sim.entities && sim.entities[sd.e];
  const id = ent ? ent.id : '';
  const cs = n ? coast / n : 0;
  // score de chaque spécialisation (≥ 1 : pertinente) ; on garde les trois plus marquées
  const rank = sim.sides.filter((o) => !o.eliminated && (o.units * o.q) > sd.units * sd.q).length;
  const sc = {
    maritime: cs / 0.3 + (p.infra.ports || 0) / 120 + (P === 'maritime' ? 0.5 : 0),
    continental: n > 2600 ? (Math.log10(n) - 2.4) * (1 - cs * 2) : 0,
    mountain: n ? (bio[3] / n) / 0.22 : 0,
    desert: (ARID.has(id) ? 1.4 : 0) + (n ? (bio[4] / n) / 0.3 : 0),
    arctic: n ? (bio[5] / n) / 0.3 : 0,
    industrial: (p.production || 0) / 76 * (d.economyType === 'industrielle' ? 1.15 : 1),
    resource: ((p.res && p.res.energy) || 0) / 75 * (d.economyType === 'rente' ? 1.25 : 1),
    tech: (p.tech || 0) / 80 + (P === 'technological' ? 0.25 : 0),
    small: n && n < 160 ? 1.2 - n / 400 : 0,
    agrarian: ((p.res && p.res.food) || 0) / 74,
    trader: (p.trade || 0) / 80 + (d.economyType === 'commerce' ? 0.25 : 0) + (P === 'economic' ? 0.1 : 0),
    militarist: (d.milPct || 0) / 3.5 + (d.economyType === 'militarisee' ? 0.3 : 0),
    power: sim.sides.length > 8 && rank < 6 ? 1.3 - rank * 0.04 : 0,
  };
  const out = Object.entries(sc).filter(([, v]) => v >= 1).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([k]) => k);
  sd.techSpecs = { t: sim.time, list: out };
  return out;
}
// affinité d'un pays pour une branche (coûts et durées divisés, préférences de l'IA)
export function affinity(sim, k, branch) {
  let a = 1;
  for (const s of specsOf(sim, k)) { const v = SPECIALIZATIONS[s].aff[branch]; if (v) a = Math.max(a, v); }
  // pays sans ports : marine et transport maritime très chers
  if ((branch === 'nav' || branch === 'mtr') && (sim.sides[k].p.infra.ports || 0) < 4) a = 0.55;
  return a;
}
// une technologie est-elle ouverte à ce pays (technologies propres aux spécialisations)
export function techOpen(sim, k, t) { return !t.spec || specsOf(sim, k).includes(t.spec); }

export const FX_TEXT = {
  food: (v) => `Sécurité alimentaire +${v}`, energy: (v) => `Énergie +${v}`, health: (v) => `Santé +${v}`,
  popGrowth: (v) => `Démographie +${String(v).replace('.', ',')} pt/an`, prestige: (v) => `Prestige +${v}`,
  atk: (v) => `Attaque +${Math.round(v * 100)} %`, def: (v) => `Défense +${Math.round(v * 100)} %`,
  artillery: (v) => `Contre les fortifications +${Math.round(v * 100)} %`, airDef: (v) => `Défense aérienne +${Math.round(v * 100)} %`,
  intel: (v) => `Renseignement +${Math.round(v * 100)} %`, sof: (v) => `Forces spéciales +${Math.round(v * 100)} %`,
  sealift: (v) => `Convois maritimes +${v}`, airlift: (v) => `Pont aérien +${Math.round(v * 100)} %`, seaRange: (v) => `Portée navale +${Math.round(v * 100)} %`,
  landing: (v) => `Débarquements +${Math.round(v * 100)} %`, convoy: (v) => `Protection des convois +${Math.round(v * 100)} %`, blockade: (v) => `Blocus +${Math.round(v * 100)} %`,
  blockadeRes: (v) => `Résistance au blocus +${Math.round(v * 100)} %`, casualties: (v) => `Pertes ${Math.round(v * 100)} %`,
  morale: (v) => `Moral +${Math.round(v * 100)} %`, mobilization: (v) => `Réserves mobilisables +${Math.round(v * 100)} %`,
  atkTerr: (o) => Object.entries(o).map(([b, v]) => `Attaque en ${TERR_FR[b]} +${Math.round(v * 100)} %`).join(', '),
  defTerr: (o) => Object.entries(o).map(([b, v]) => `Défense en ${TERR_FR[b]} +${Math.round(v * 100)} %`).join(', '),
};
const TERR_FR = { plains: 'plaine', forest: 'forêt', hills: 'collines', mountains: 'montagne', desert: 'désert', tundra: 'toundra' };
export const CONS_TEXT = {
  stability: (v) => `Stabilité ${v > 0 ? '+' : ''}${v}`, tension: (v) => `Inquiétude des voisins (relations −${v})`, upkeep: (v) => `Entretien ${String((v * 100).toFixed(2)).replace('.', ',')} % du PIB / an`,
};
export const TERR_INDEX = { plains: 0, forest: 1, hills: 2, mountains: 3, desert: 4, tundra: 5 };
