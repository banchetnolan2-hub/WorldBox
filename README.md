# World Simulator — simulation géopolitique 3D

Prenez n'importe quels pays du monde, formez des équipes, lancez la simulation et regardez la Terre évoluer :
Terre 3D en relief (vraies altitudes et profondeurs des océans), pays en couleurs cartographiques par-dessus le terrain,
frontières lissées, territoires officiels / occupés / neutres, unités sobres, navires et avions de transport visibles,
classement en direct, musique générée, mondes persistants sur plusieurs générations et mode Contrôle total.

> Statistiques, populations et résultats sont des valeurs de jeu. Aucune simulation n'est une prédiction réelle.

## Jouer

Double-cliquez sur **`WorldSimulator.exe`** (version portable, hors connexion). Si la carte graphique ne gère pas la 3D,
le jeu bascule sur un rendu logiciel (plus lent) ; le **mode classique 2D** de la V2 reste accessible depuis le menu.

## VERSION 3.1 — ce qui a changé

| Élément | Ce qu'il fait | Où |
|---|---|---|
| **Mon pays** (tableau de bord) | situation en un coup d'œil : économie, budget, population, stabilité, armée, guerres et fronts, ravitaillement, recherche, occupation, diplomatie ; alertes cliquables qui ouvrent le bon onglet | `sim/insights.js`, `ui/dashboard.js` |
| **Conseiller** | conseils contextuels (économie, armée, ravitaillement, recherche, occupation, stabilité, diplomatie) et explication des derniers refus des IA ; lecture seule, n'influence jamais la simulation | `sim/insights.js` |
| **Guide** et tutoriel | 16 chapitres (`F1`, menu, barre de gauche) ; tutoriel en 8 étapes à la première partie Nation | `ui/guide.js` |
| **Récapitulatif annuel** | chaque 1er janvier (désactivable) : PIB, population, territoire, guerres, traités, technologies, faits marquants ; aussi dans l'onglet Chronologie | `ui/recap.js` |
| **Thèmes** | Salle des cartes, Nuit polaire, État-major, Atlas clair, Contraste élevé ; taille de l'interface | `ui/themes.js`, Paramètres → Interface |
| Vitesses et notifications | vitesses 1×, 2×, 3×, 5×, 10× (×10 au maximum, aussi en multijoueur) ; notifications groupées, niveau réglable, pause automatique au choix (guerre, paix, alliance, révolte…) ; `R` désactivé en Mode Nation et en multijoueur | `ui/notify.js`, `game/session.js` |
| **Réglages avancés** | 32 paramètres en 7 catégories, 6 profils (Équilibré, Réaliste, Guerre totale, Diplomatique, Bâtisseur, Arcade) et profils personnels ; « Équilibré » = comportement d'origine à l'identique ; modifiables en partie (hôte seulement), sauvegardés | `sim/tuning.js`, `ui/tuningUI.js` |
| **Armée** | composition (infanterie, blindés, artillerie, reconnaissance, aviation, forces spéciales) avec reconversion progressive et effets réels ; groupes d'armée (nombre, mission, front visé, défense de la capitale, réserve) ; ordres de flotte (automatique, aller à, points de passage, patrouille, escorte des convois, retour au port) ; fiches flottantes des groupes, flottes et pays | `sim/military.js`, `ui/forcesUI.js` |
| **Occupation** | 4 états : contrôlé, semi-occupé, occupé, contesté (ravitaillement insuffisant) ; partisans ; état visible au survol | `worldSim._occState` |
| **Paix proportionnée** | une exigence est jugée selon ce que l'adversaire a réellement perdu (capacité de cession, jauge dans le formulaire) ; contre-offre ramenée à ce qui est acceptable, refus expliqués | `sim/diplomacy.js`, `sim/territoryValue.js` |
| **Diplomatie territoriale** | échange, rectification de frontière, cession, achat, vente, don, restitution, indépendance, nouvel État, séparation, annexion, fusion ; régions voisines seulement, capitale jamais cédée, prix équitable calculé | `sim/territorial.js` |
| **Technologies** | 181 technologies en 12 branches, 24 choix exclusifs (une voie ferme l'autre), IA cohérente ; arbre navigable (zoom, glisser, recherche, filtre « Conseillé ») ; anciennes sauvegardes converties | `sim/techTree.js` |
| **Nations formables** | 32 nations (Union européenne, Grande Colombie, Corée unifiée…) par conquête, vote des États ou union d'alliés ; proclamation, nouvelle identité, éditeur de nations ; l'IA en forme aussi (rarement) | `sim/formables.js`, `ui/formablesUI.js` |
| **8 pays et territoires** | Kosovo, Taïwan, Sahara occidental, Chypre du Nord, Nouvelle-Calédonie, Porto Rico, Hong Kong, Somaliland (204 jouables) | `scripts/data/promoted.txt` |
| Interface | barre de gauche par sections (Mon pays, Gouvernement, Militaire, Diplomatie & Territoire, Identité, Carte du monde, Réglages…) ; pastilles colorées en haut (PIB, budget, population, stabilité, armée, guerres, alertes) ; fiche flottante d'un pays au clic | `ui/gameNav.js`, `ui/nationUI.js` |
| Identité visuelle | couleur secondaire, forme des unités (disque, carré, losange, hexagone), style des navires, couleur des autres pays (normale, pastel, grisée, assombrie), préréglages enregistrés | `nationUI.js`, `globe/shaders.js` |
| Carte | front de conquête lumineux, parcelles prises qui s'illuminent puis se fondent dans la couleur du conquérant, déplacements des unités lissés, départ progressif de la caméra | `globe/shaders.js`, `globeRenderer.js`, `globeCamera.js` |
| Mode Nation | le crayon de frontières n'est plus disponible en Mode Nation (il reste en Sandbox / Contrôle total) | `sim/borderEdit.js` |
| **Multijoueur par code** | voir ci-dessous | `net/relay.js` |

## Développement

```bash
npm install
npm run dev        # construit l'interface et ouvre le jeu (Electron)
npm run build      # release/WorldSimulator.exe (portable) + installateur Windows
npm test           # moteur, guerres/IA, Nation, règles, géométrie, naval, coalitions, technologies, crises, fins de guerre,
                   # multijoueur, mondes, tableau de bord/conseiller, interface, mécaniques Nation 3.1, relais, moteur 2D
npm run web        # version navigateur de test : http://localhost:5173
```

Relief : `src/data/world-relief.bin` est produit par `scripts/relief/build-relief.py` à partir de la bathymétrie
ETOPO/GEBCO (ggOceanMapsLargeData, `dd_rbathy_cont.rda`) et du relief SRTM/GTOPO (`elev_bump_4k.jpg`, webgl-earth).
Paramètres → **Ombres portées du relief** : à décocher sur un ordinateur peu puissant (la résolution s'adapte aussi seule).

Données : `npm run countries` régénère `src/data/countries.json` (196 pays) puis la grille mondiale ;
`npm run world` régénère seulement la grille (`src/data/world-grid.bin`).

## Ce que contient le jeu

| Fonction | Où |
|---|---|
| Globe 3D (Three.js/WebGL2) : océans animés avec reflets, relief léger, atmosphère, éclairage jour/nuit, étoiles | `src/v3/globe/` |
| 196 pays (193 membres de l'ONU + Saint-Siège + Palestine) : drapeau, continent, capitale, population, puissance, économie, ressources, stabilité, mobilité… | `src/data/countries.json` |
| Terre en relief : maillage déplacé selon les vraies altitudes (exagération ×14), ombres portées, océans teintés selon la profondeur, fond marin visible, reflets, écume, atmosphère ; vue inclinée en zoom proche | `src/v3/globe/shaders.js`, `world-relief.bin` |
| Couleurs de pays cartographiques (deux voisins jamais de la même couleur), appliquées par-dessus le relief | `src/v3/globe/mapColors.js` |
| **CREATE WORLD** : pinceau de terres, gomme, lissage, relèvement, creusement, déplacement / fusion de masses terrestres ; « Créer un pays ici », territoire au pinceau, capitales (placer, déplacer, renommer, supprimer), propriétés des pays ; annuler / rétablir | `src/v3/ui/worldEditor.js`, `src/v3/world/terrain.js` |
| Mondes `.simworld` : géométrie exacte (champ d'altitude), propriétaire de chaque parcelle, pays, capitales, couleurs, statistiques, équipes, relations, historique, paramètres de simulation ; réouvrables dans l'éditeur | `src/v3/ui/worlds.js` |
| Noms des pays placés au point le plus intérieur du territoire (taille selon la taille apparente, repère + nom pour les petits pays, sans chevauchement), capitales ● | `src/v3/ui/labels.js` |
| Unités : petits soldats stylisés en formation (nombre selon les effectifs), qui marchent vers leur objectif | `markerVertex` / `markerFragment` |
| Interface : police Inter, icônes Lucide, valeurs et classements animés, transitions douces ; vitesse des transitions de frontière réglable | `src/styles/v3.css`, `src/v3/ui/hud.js` |
| Territoires : officiel (couleur pleine), occupé (même teinte, plus claire et hachurée), neutre (gris) ; une zone occupée tenue assez longtemps, hors du front, devient officielle de proche en proche | `worldSim._integrate` |
| Frontières lisses : vraies frontières (carte 8192×4096) et front lissés par un noyau continu, traits fins antialiasés ; frontières officielles en trait plein, frontières d'occupation en pointillés | shader `earthFragment`, `world-hires.bin` |
| Zones neutres grises capturables (option « Zones neutres », départ « Autour de la capitale ») | créateur de partie |
| Unités : groupes de 3 à 5 jetons aux couleurs du pays, orientés vers leur destination, posés sur le relief, trajectoires courbes (Bézier) | `markerVertex`, `worldSim._updateAgents` |
| Débarquement : le navire accoste, les unités descendent une à une puis avancent vers l'intérieur | `worldSim._updateTransports` |
| Grille mondiale de 252 000 parcelles (0,25°) + micro-États (Vatican, Monaco, Saint-Marin, Liechtenstein, Andorre) | `scripts/build-world.js` |
| Moteur multi-pays / multi-équipes déterministe (seed), unités calculées à partir de 5 paramètres | `src/v3/sim/worldSim.js` |
| Navires 3D sur de vraies routes maritimes (A* sur une grille océanique de 0,5°, détroits et canaux), avions 3D sur arcs courbes | `src/v3/world/navigation.js` |
| Modes 1 VS 1, Multi-pays, Équipes, Monde (196 pays), Personnalisé, Spectateur ; scénarios Europe, Asie, Afrique, Amériques, Océanie | créateur de partie |
| Classement en direct, fiche pays (clic), journal, caméra automatique / libre, suivi d'un navire | `src/v3/ui/` |
| Musiques (menu, simulation, fin) et effets générés en direct — aucun fichier sous droits | `src/v3/audio/audio.js` |
| Mondes persistants : frontières exactes parcelle par parcelle, pays disparus, équipes, statistiques, relations, historique par année | `src/v3/world/worldState.js` |
| Contrôle total : pinceau de frontières, retrait/transfert de territoire, création de pays (drapeau, capitale), édition des pays, équipes et alliances, simulation pas à pas, événements manuels, annuler/rétablir | `src/v3/ui/control.js` |
| Sauvegarde complète d'une partie (territoires, unités, navires en route, événements, seed…) et reprise exacte | 💾 en partie |

## Simulation vivante (systèmes reliés)

| Système | Ce qu'il fait | Où |
|---|---|---|
| Géographie par parcelle | altitude, rugosité, distance à la côte, climat, **biomes** (plaines, forêts, collines, montagnes, désert, toundra), **rivières** (écoulement + accumulation), crêtes, superficie en km² | `src/v3/sim/geo.js` |
| Fiche pays complète | population et croissance ; PIB, trésorerie, recettes, dépenses, dette, budget militaire ; armée (infanterie, blindés, artillerie, reconnaissance, aviation, marine), technologie, qualité ; infrastructures ; ressources ; politique intérieure ; personnalité ; type d'économie. Valeurs **liées** (population → potentiel, technologie → efficacité, économie → armée entretenable, infrastructures → vitesse et ravitaillement) | `src/v3/sim/profile.js`, `src/v3/ui/profileEditor.js` |
| Économie mensuelle | recettes − dépenses = variation du budget ; entretien de l'armée, intérêts, opérations, investissements (recherche, infrastructures, économie) ; dette, crise, armée sous-entretenue (préparation en baisse), recrutement limité par la population, l'argent et l'industrie ; commerce et blocus naval | `src/v3/sim/economy.js` |
| Fronts par secteurs | chaque guerre découpée en zones (≈ 400 km) : active, inactive, en progression, bloquée, en recul ; posture (offensive / tenir / défense), fortifications, forces allouées | `src/v3/sim/fronts.js` |
| Combat multi-facteurs | forces locales, composition × terrain (blindés en plaine, infanterie en montagne…), rivières, capitales, qualité, préparation, ravitaillement, moral, fortifications, soutien aérien, supériorité navale, aléatoire — jamais « A > B donc A gagne » | `worldSim._attempt` |
| IA des pays | Perception → Analyse → Objectifs (principal, secondaire, long terme) → Planification (budget, postures, doctrine selon le terrain) → Action (offensives, fortifications, frappes aériennes, diplomatie) → Résultat → Mémoire (échecs offensifs, zones difficiles, voisins affaiblis, déficits, guerres gagnées/perdues, revendications). 8 personnalités | `src/v3/sim/ai.js` |
| Diplomatie | relations (neutre, amical, partenaire commercial, allié, rival, hostile), alliances, appels à l'aide, entrées en guerre, paix négociée, nouvelles guerres, trêves | `src/v3/sim/ai.js`, `wars.js` |
| Guerres complètes | conditions de fin (100 % vérifié parcelle par parcelle, pourcentage, capitulation, effondrement économique, paix, sans condition) → négociation → **traité de paix** → **BORDER CLEANUP** (enclaves, fragments, zigzags ; frontières naturelles conservées) → nouvelle carte → relations et mémoire des IA | `src/v3/sim/wars.js` |
| Rapports et histoire | WAR ENDED, WAR REPORT (territoires, zones, chronologie défilante, batailles cliquables, cartes AVANT / APRÈS / CHANGEMENTS, traité), histoire de chaque pays, **WORLD HISTORY** ; tout est enregistré dans le monde | `src/v3/ui/warUI.js`, `worldState.recordChronicle` |
| Unités | groupes mixtes (fantassins, chars, artillerie, véhicules de reconnaissance) dont la taille suit les effectifs, navires de guerre en patrouille, avions de combat, transports | `globeRenderer.js`, `shaders.js` |
| CREATE WORLD | NATURALIZE (côtes découpées, baies, péninsules, îlots, relief), vallées des rivières, pinceau de biomes, AUTO BORDER, NATURAL BORDER, MANUAL BORDER | `src/v3/ui/worldEditor.js` |

## NATION SIMULATOR et MODE HISTOIRE

| Élément | Ce qu'il fait | Où |
|---|---|---|
| Données réelles de départ | population et croissance démographique (Banque mondiale, SP.POP.TOTL), PIB (Banque mondiale, NY.GDP.MKTP.CD), dépenses militaires en % du PIB (SIPRI) ; source et année conservées, valeurs manquantes ou anciennes marquées « estimée » | `scripts/build-real-stats.js`, `src/data/real-stats.json` |
| Choix du pays | clic sur le globe ou recherche, fiche complète (population, PIB, PIB/hab., budget, dépenses, dette, économie, territoire, défense, technologie, infrastructures, ressources, stabilité, organisations, partenaires, tensions, voisins), identité personnalisable (nom, nom court, capitale, couleur, drapeau, symbole, noms des régions) | `src/v3/ui/nationUI.js` |
| Gestion du pays | Économie (impôts, services publics, investissements), Population (politique familiale et migratoire, emploi, niveau de vie), Infrastructures, Technologie, Défense (Personnel, Groupes, budget, posture, capacités), Diplomatie, Développement, Chronologie, Identité, Objectifs | `nationUI.js`, `src/v3/sim/nation.js` |
| Arbre de développement | 6 branches (Économie, Infrastructures, Technologie, Éducation, Diplomatie, Défense), 26 projets avec coût (part du PIB), durée et effets ; argent engagé chaque mois ; les IA l'utilisent aussi selon leur personnalité | `nation.js` |
| Diplomatie avec les IA | discuter, accord commercial, pacte de non-agression, alliance, aide, améliorer les relations, réduire les tensions, paix, rupture, guerre ; l'IA répond ACCEPTÉ / REFUSÉ / CONTRE-PROPOSITION avec son analyse (facteurs) et se souvient des refus, trahisons et aides | `nation.js` |
| Monde de départ | grandes organisations (OTAN, UE, OTSC, Mercosur, ASEAN, CCG…), alliances, rivalités connues ; ensuite tout évolue | `src/v3/sim/geopolitics.js` |
| Décisions et événements | décisions régulières liées à la situation (budget, récession, chômage, dette, effort de guerre, vieillissement…), événements mondiaux liés aux statistiques | `nation.js` |
| Mode histoire | 7 scénarios (crise de la dette, tensions, développement rapide, conflit régional, reconstruction, montée technologique, monde des deux blocs), objectifs suivis, 4 fins possibles | `src/v3/sim/scenarios.js` |
| Rapports de guerre | onglet AVANT / APRÈS : population, territoire, PIB, budget, effectifs, relations, pertes statistiques (personnel, estimation des blessés, matériel agrégé, impact économique) | `wars.statSnap`, `warUI.js` |

Vitesses en mode Nation : Pause, 1×, 2×, 3×, 5×, 10× (touches `Espace`, `1`–`5`) ; `P` gestion du pays, `D` diplomatie. Début : 1er janvier 2026.

Calendrier : 1 seconde simulée = 3 jours. Tests : `npm test` (moteur, guerres/IA/économie, mondes créés, mode classique).

## VERSION MAJEURE : règles, menu, carte détaillée, transport naval, paix négociée

| Élément | Ce qu'il fait | Où |
|---|---|---|
| Menu principal | Continuer, Nouvelle partie (Nation, Monde personnalisé, Partie rapide), Scénarios (Économie, Diplomatie, Développement, Géopolitique, Survie, Monde alternatif, Mes scénarios), Nation Simulator, Sandbox (Monde actuel, Créer un monde, Modifier les pays, Modifier la carte), Créer (monde, pays, scénario), Charger, Options, Crédits ; fil d'Ariane et bouton Retour dans chaque sous-menu, `Échap` remonte d'un niveau | `src/v3/ui/menu.js` |
| Règles de la partie | 26 systèmes en 6 catégories (Diplomatie, Gouvernement, Économie, Militaire, Technologie, Événements) ; Activer tout / Tout désactiver / Paramètres recommandés / mode personnalisé ; dépendances (sans guerres : pas de paix ni d'événements militaires ; sans économie : pas de dette, de commerce ni de crises). Un système désactivé l'est dans la simulation, chez les IA, dans les événements et dans l'interface | `src/v3/sim/rules.js`, `src/v3/ui/rulesUI.js` |
| Règles par mode | Sandbox : réglable (décisions et changements de gouvernement coupés par défaut) ; Nation : réglages réalistes ; Histoire : règles imposées par le scénario (verrouillées) ; Monde personnalisé : choix du joueur | `rules.js` |
| Créer un scénario | pays, texte, catégories, durée, situation de départ (dette, trésorerie, choc économique, stabilité, infrastructures, rival, guerre), objectifs paramétrables (obligatoires ou facultatifs), règles imposées, textes de fin ; enregistré dans « Mes scénarios » | `src/v3/ui/scenarioEditor.js`, `scenarios.js` |
| Navigation en partie | rail toujours visible : Carte, Pays, Diplomatie, Économie, Technologie, Militaire, Histoire, Actualités, Statistiques, Règles, Sauvegarde ; panneau « Le monde » à onglets | `src/v3/ui/gameNav.js` |
| Fiche pays | en-tête (capitale, population, économie, production, technologie, infrastructures, diplomatie, forces, territoire) et onglets Aperçu, Économie, Militaire, Technologie, Diplomatie, Villes, Histoire, Statistiques | `src/v3/ui/hud.js` |
| Carte détaillée | 3 000 villes, régions administratives, 1 000 ports, 400 lacs, routes ; affichage progressif selon le zoom (LOD), ressources par région ; désactivable dans Paramètres → Carte détaillée | `scripts/build-details.js`, `src/v3/world/details.js`, `globeRenderer.js`, `labels.js` |
| Transport naval des troupes | embarquement dans un vrai port, attente au port, traversée, débarquement, changement de destination ; uniquement quand aucune route terrestre n'existe et que l'opération a un sens (distance, accès à la mer, contrôle des côtes, diplomatie, objectif, sécurité de la route, capacité de transport) | `worldSim.js` (`_orderSea`, `_updateNaval`) |
| Paix négociée | l'IA analyse la situation avant de proposer, attend après un refus (délai croissant), ne redemande pas si rien n'a changé, fait des concessions après plusieurs refus ; propositions détaillées (territoires proposés / conservés / rendus, conditions, conséquences) ; Accepter / Refuser / Contre-proposer, chaque réponse pèse sur les relations | `src/v3/sim/diplomacy.js`, `ai.js`, `nationUI.js` |
| Mémoire diplomatique | propositions, refus, acceptations, traités, guerres, alliances, trahisons, échanges ; sauvegardée avec la partie | `diplomacy.js` |

Charte graphique « salle des cartes » : encre marine `#07111a`, texte parchemin `#ece6d6`, accent laiton `#d4ab5c` ;
titres en Cormorant Garamond, texte en Inter ; animations courtes (0,15 à 0,45 s), aucune étiquette en capitales.

## REFONTE : carte vectorielle, difficultés, Story Mode

| Élément | Ce qu'il fait | Où |
|---|---|---|
| Carte | frontières et côtes vectorielles Natural Earth 1:10m (nettes à tous les zooms, deux niveaux de détail, posées sur le relief) ; masque terre/mer 16384 × 8192 pour des rivages et des îles exacts en vue rapprochée ; limites régionales lissées ; palette d'atlas ; une frontière d'origine s'efface là où le territoire a changé de mains | `scripts/build-borders.js` (`npm run borders`), `src/v3/globe/vectorLines.js`, `shaders.js` |
| Géométrie des territoires | après chaque changement (conquête, occupation, traité, édition) : polygones recalculés à partir des vrais pays d'origine (Natural Earth 1:10m), régions lissées puis intersection / union / différence (polygon-clipping), partition exacte sans trou ni superposition, slivers et fragments accidentels fusionnés, îles et enclaves réelles conservées ; calcul incrémental dans plusieurs travailleurs (seules les parcelles modifiées sont envoyées, seuls les pays touchés sont recalculés, grands pays découpés en tuiles de 4°) ; animation interpolée à chaque image entre l'état précédent et le nouvel état, dans l'ordre réel des captures ; cartes des pièces redessinées seulement dans les rectangles modifiés ; une frontière n'est tracée que si ses deux côtés diffèrent réellement | `src/v3/world/territoryGeometry.js`, `geometryWorker.js`, `globeRenderer.js`, `tests/v3-geometry.test.js` |
| Nouvelles règles | systèmes maîtres Diplomatie, Technologie, Événements ; Économie avancée (dette, crises, transformations) ; Logistique (ravitaillement, capacité de transport maritime) ; IA avancée (doctrine, coalitions, stratégie de négociation, arbre de développement des IA) | `rules.js`, `worldSim.js`, `ai.js` |
| Difficultés (Nation) | Découverte, Normal, Difficile, Expert, Grand Stratège, Personnalisée : la difficulté règle la complexité (systèmes actifs, rythme des événements et des décisions), jamais des bonus | `rules.js` (`DIFFICULTIES`), `nationUI.js` |
| Story Mode | 48 scénarios en 11 catégories (économie, diplomatie, développement, technologie, géopolitique, survie, villes, monde alternatif, crises, chaos, mes scénarios) : objectif principal, objectifs secondaires et secrets, conditions d'échec, événements datés, difficulté conseillée | `storyScenarios.js`, `scenarios.js` (`buildScenario`) |
| Éditeur de scénarios | rôle de chaque objectif (principal, secondaire, facultatif, secret), pays visé, conditions d'échec, événements datés, difficulté | `scenarioEditor.js` |

## MISE À JOUR : maritime, coalitions, arbres technologiques, éditeur de frontières, crises

| Élément | Ce qu'il fait | Où |
|---|---|---|
| Déplacements réalistes | itinéraires terrestres (A*) par son territoire, celui des alliés (en guerre) ou la zone du front ennemi ; jamais à pied sur la mer, jamais à travers un pays neutre ; « zones terrestres » praticables par pays | `worldSim._landPath`, `_lab` |
| Transport maritime | bateau seulement sans route terrestre praticable (îles, exclaves, territoire séparé par un neutre) ; navire à quai pendant l'embarquement, traversée, débarquement ; bassins maritimes précalculés ; routes déterministes | `worldSim._orderSea`, `navigation.js` |
| Coalitions | formation face aux agresseurs ou aux menaces, chef, intérêts de chaque membre (agressé, sécurité, revendications, alliance, économie, revanche, opportunisme), objectif (libérer, vaincre, contenir), cohésion, offensives coordonnées, aide aux membres du front, entrées et départs, paix séparée, négociation par le chef ; jouable en Nation (fonder, inviter, objectif, offensive, quitter) | `sim/coalitions.js`, `ui/coalitionUI.js` |
| Arbres technologiques | (3.1 : 181 technologies regroupées en 12 branches, 24 choix exclusifs) 27 lignes : 14 civiles et 13 militaires, jusqu'à 6 paliers, prérequis croisés, coûts et durées, effets réels (combat, défense aérienne, convois, débarquements, renseignement, forces spéciales, pertes…) et conséquences (entretien, inquiétude des voisins, stabilité) ; spécialisations par pays (maritime, continentale, montagne, désert, industrielle, technologique, petit État…) avec coûts réduits et technologies propres | `sim/techTree.js`, onglet Technologies |
| Éditeur de frontières | (3.1 : retiré du Mode Nation) crayon, gomme, annuler/rétablir, précision, zoom très proche, accrochage aux frontières, avant/après, validation ; le tracé modifie les parcelles ET la géométrie (frontière exactement sur la ligne) ; capitales protégées, nettoyage topologique, réactions des voisins | `sim/borderEdit.js`, `ui/borderEditor.js` |
| Crises et sanctions | crises bilatérales (incident frontalier, différend territorial…) puis conférence internationale avec médiateurs (accord, statu quo, guerre) ; le joueur choisit sa ligne ; crises mondiales de l'énergie et alimentaire ; sanctions économiques (joueur et IA, coalitions) | `sim/crises.js` |
| Vues du monde | classement mondial (11 mesures, évolution sur un an), comparateur de pays (tableau + courbes), crises et sanctions, cartes thématiques (`K`) : économie, richesse, puissance, technologie, stabilité, croissance, population, relations, blocs, sanctions | `ui/worldViews.js` |
| Corrections | effets militaires de l'arbre et de plusieurs décisions jamais appliqués (else ambigu) ; régions annexées par traité supprimées par le nettoyage ; vainqueur bloqué qui ne proposait jamais la paix | |

## Contrôles

`Glisser` tourner le globe · `Molette` / `+` `−` zoom · `Flèches` rotation · `Clic` fiche du pays · `Espace` pause ·
`N` avancer d'une étape · `1`–`5` vitesse (Mode Nation : 1× à 10×) · `F1` guide · `C` caméra auto/libre · `V` vue d'ensemble · `R` recommencer (hors Mode Nation et multijoueur) ·
`G` guerres et rapports · `K` cartes thématiques · `H` histoire du monde · `M` marqueurs · `L` noms · `S` son · `Échap` menu · `F11` plein écran. En Contrôle total : clic gauche + glisser = peindre,
clic droit + glisser = tourner, `Ctrl+Z` / `Ctrl+Y` = annuler / rétablir.

## Sauvegardes

Dans `%APPDATA%\WorldSimulator\` : `worlds\MonMonde.simworld` (un fichier par monde), `parties\` (parties complètes),
`reglages\` ; les mondes de l'ancienne version (`mondes\*.json`) restent lisibles. Un monde peut être exporté / importé
(`.simworld`) depuis l'écran **Mondes**, et rouvert dans **CREATE WORLD** pour être modifié.

## Ajouter ou modifier un pays

Éditez `scripts/data/countries195.txt` (code numérique ISO, code à 2 lettres pour le drapeau, nom, continent, capitale,
latitude, longitude, population, niveau économique) puis `npm run countries`. Pour des réglages fins, modifiez directement
`src/data/countries.json`. Les pays créés dans le jeu (Contrôle total) sont enregistrés dans le monde.

## Architecture

```
electron/            fenêtre Windows, stockage local (IPC)
src/index.html       interface V3              src/classic.html   mode classique 2D (V2)
src/v3/world/        grille mondiale, routes maritimes, état des mondes
src/v3/sim/          moteur (worldSim), géographie, profils, économie, fronts, IA, guerres, calendrier
src/v3/globe/        rendu 3D : Terre en relief, océans, couleurs des pays, unités, navires, caméra
src/v3/game/         session de jeu, caméra automatique
src/v3/ui/           menus, créateur, HUD, résultats, mondes, Contrôle total
src/v3/audio/        musique et effets générés
src/js/              V2 (mode classique 2D), conservée telle quelle
```

## Crédits

Carte : Natural Earth via `world-atlas` (domaine public) ; villes, ports et lacs : Natural Earth (populated places, ports, lakes ; domaine public). Police de titres : Cormorant Garamond (OFL). Police : Inter (OFL). Icônes : Lucide (ISC). Relief : ETOPO/GEBCO (NOAA/GEBCO, domaine public) et SRTM/GTOPO (USGS/NASA, domaine public). Drapeaux de l'interface : `flag-icons` (MIT). 3D : Three.js (MIT).
Musiques, sons, interface et code : originaux.

## MISE À JOUR : fin des guerres contrôlée par le joueur (Mode Nation)

- **Paix automatique ON/OFF** (choix du pays → « Paix automatique », et en partie : panneau des guerres → « Fin des guerres »). En mode Nation elle est **OFF** par défaut : aucune guerre ne se termine parce qu'un pays a perdu 70 % (ou 99 %) de son territoire.
- Conditions configurables : 🗺️ conquête totale, 🤝 paix négociée, 🏳️ capitulation, 💰 effondrement économique, ⚔️ objectifs de guerre, ⏱️ durée maximale, 🚫 aucune fin automatique.
- Paix automatique OFF : les seuils produisent un **événement** et une **proposition de capitulation** (« Le pays X est fortement affaibli. Souhaitez-vous proposer des conditions de paix ? ») : accepter, continuer la guerre ou proposer ses conditions. Si le joueur perd, le vainqueur exige sa capitulation, que le joueur peut refuser. Entre IA, le vaincu offre sa capitulation et le vainqueur peut la refuser (personnalité). Dans une coalition, un pays peut capituler séparément.
- Négociation : régions annexées, **régions cédées / restitution** des régions occupées, réparations, contre-propositions ; **objectifs de guerre** du joueur (régions visées, capitale).
- La perte de territoire pèse sur la stabilité, l'économie, le moral, les recrues, la diplomatie (les pays tiers se méfient de l'envahisseur), le **risque de révolte** (troubles intérieurs), la **résistance** dans les territoires occupés, les **contre-offensives** (sursaut national) et le **risque de capitulation** (affiché dans la diplomatie et le panneau des guerres) — sans jamais imposer la paix.
- Code : `src/v3/sim/warEnd.js`, `src/v3/ui/warEndUI.js` ; tests : `tests/v3-warend.test.js`.

## MISE À JOUR : multijoueur (Mode Nation)

- **Menu principal → Multijoueur** : héberger ou rejoindre. En partie : barre de gauche → **Multijoueur**.
- **Code de partie (3.1)** : l'hôte ouvre la partie et obtient un code court, par exemple `H7KQ2-M9XAPQ` ; chaque joueur va dans **Menu → Multijoueur → Rejoindre**, saisit ce code et choisit son pays. **Un même code sert à plusieurs joueurs.**
  - Connexion par des **relais publics** (MQTT sur WebSocket sécurisé : EMQX, HiveMQ, Mosquitto, Shiftr) : aucun port à ouvrir, aucun serveur à installer.
  - **Chiffrement de bout en bout** : le salon et la clé AES-GCM 256 sont dérivés du code (PBKDF2) ; les relais ne voient que des octets chiffrés ; une trame altérée ou forgée sans le code est ignorée.
  - **Bascule automatique** : l'hôte écoute sur tous les relais joignables ; si celui d'un joueur tombe, il repasse par un autre et la partie est resynchronisée.
  - Message explicite si aucune partie ne répond au bout de **15 s**, si aucun relais n'est joignable, ou si les **versions du jeu diffèrent** (la connexion est alors refusée).
  - Relais personnalisés (avancé) : liste JSON `[{"name":"…","url":"wss://…"}]` dans le stockage local `ws-relays`.
- **Autres méthodes** (repliées sous « Autres méthodes ») :
  - **Code d'invitation direct** : l'hôte crée un **code d'invitation** (WSI-…), l'ami le colle et renvoie son **code de réponse** (WSR-…) ; la connexion passe directement entre les PC (WebRTC, comme un appel vidéo).
  - **Par adresse IP** (application Windows) : réseau local ou réseau virtuel **Tailscale / ZeroTier / Radmin VPN** ; port 47615 (autoriser WorldSimulator dans le pare-feu Windows à la première ouverture).
- L'invité **choisit son pays** (dirigé jusque-là par l'IA) et reçoit la partie en cours ; il peut arriver à tout moment.
- Simulation identique sur chaque PC (**lockstep**) : seuls les ordres des joueurs circulent. Empreinte comparée toutes les 10 s de simulation ; en cas d'écart, l'hôte renvoie l'état complet automatiquement.
- **Diplomatie entre joueurs** : commerce, pactes, alliances, aide, paix, contre-propositions, coalitions — c'est l'autre joueur qui décide, pas l'IA. Guerres entre joueurs, capitulations proposées au joueur vaincu.
- **Pause et vitesse communes** ; **messagerie** ; un joueur qui part laisse son pays « en attente » (il peut revenir) ou l'hôte le **confie à l'IA**. Seul l'hôte sauvegarde ; une partie sauvegardée garde tous les joueurs.
- Code : `src/v3/net/` (relay, transport, netGame, commands), `src/v3/ui/netUI.js` ; tests : `tests/v3-multi.test.js`, `tests/v3-relay.test.js` (vrais serveurs MQTT locaux : chiffrement, plusieurs joueurs, bascule, version, délai, partie complète sans désynchronisation).
