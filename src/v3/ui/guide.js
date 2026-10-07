// UI — GUIDE ET TUTORIEL.
// • Guide : aide intégrée, toujours accessible (menu principal → Guide, rail en partie, touche F1),
//   organisée en chapitres (carte, économie, diplomatie, armée, recherche, groupes d'armée, marine,
//   occupations, propositions territoriales, nations formables, multijoueur, vitesse et notifications…).
// • Tutoriel : à la première partie Nation, une carte de conseils guide le joueur pas à pas ; chaque étape
//   se valide d'elle-même quand le joueur fait l'action (ou par « Suivant »). On peut le passer et le relancer.
// Purement présentation : aucun effet sur la simulation (aucun ordre, aucun tirage aléatoire).
import { $, show, isShown, esc } from './util.js';
import { icon } from './icons.js';

const K = (k) => `<kbd>${k}</kbd>`;
export const GUIDE = [
  {
    id: 'start', title: 'Bien commencer', icon: 'flag', body: `
      <p>En <b>Mode Nation</b>, vous dirigez un seul pays ; tous les autres sont dirigés par l'IA (ou par d'autres joueurs en multijoueur). Le monde évolue en continu : le temps avance tant que la partie n'est pas en pause.</p>
      <ul>
        <li>La <b>barre du haut</b> résume votre pays : PIB, trésorerie, population, stabilité, effectifs. Les pastilles signalent les propositions et décisions en attente.</li>
        <li>Le <b>rail de gauche</b> regroupe les sections : Mon pays, Gouvernement, Militaire, Diplomatie &amp; Territoire, Identité, Carte du monde, Réglages.</li>
        <li><b>Mon pays</b> (touche ${K('P')}) est le tableau de bord : alertes, état de chaque domaine, événements récents.</li>
        <li>Le <b>Conseiller</b> explique les causes d'un problème et propose des pistes ; il n'agit jamais à votre place.</li>
      </ul>
      <p>Commencez par lire les alertes du tableau de bord, lancez un projet de recherche, puis regardez vos voisins dans la diplomatie.</p>` },
  {
    id: 'map', title: 'La carte', icon: 'map', body: `
      <ul>
        <li>${K('Glisser')} tourne le globe, ${K('Molette')} ou ${K('+')} ${K('−')} zoome, les flèches déplacent la vue.</li>
        <li>Un <b>clic sur un pays</b>, un <b>groupe d'armée</b> ou une <b>flotte</b> ouvre une fiche flottante adaptée.</li>
        <li>Le <b>survol</b> d'une région indique son état : contrôlée, semi-occupée, occupée ou contestée.</li>
        <li>Couleur pleine : territoire officiel. Hachures plus claires : territoire occupé. Pointillés : frontière d'occupation. Le front actif est souligné d'un léger liseré lumineux.</li>
        <li>${K('K')} fait défiler les cartes thématiques (économie, puissance, stabilité, relations, blocs…), ${K('V')} recentre la vue.</li>
      </ul>` },
  {
    id: 'economy', title: 'L\'économie', icon: 'coins', body: `
      <p>Chaque mois : <b>recettes − dépenses = variation de la trésorerie</b>. Les dépenses comprennent l'administration, l'entretien de l'armée, les intérêts de la dette, les opérations militaires et les investissements.</p>
      <ul>
        <li><b>Impôts</b> : plus de recettes, mais la stabilité baisse. <b>Services publics</b> : croissance et stabilité, mais ils coûtent.</li>
        <li><b>Investissements</b> : répartition entre recherche, infrastructures et économie (effets sur plusieurs années).</li>
        <li><b>Dette</b> : autorisée selon les règles ; au-delà d'un certain niveau, crise économique (stabilité en chute, croissance négative).</li>
        <li>Une armée non payée perd sa <b>préparation</b> : surveillez la ligne « Armée payée à … % ».</li>
        <li>La guerre, le blocus naval, les sanctions et la perte de territoire freinent la croissance. Les accords commerciaux l'augmentent.</li>
      </ul>
      <p>Si l'économie se dégrade, ouvrez le <b>Conseiller</b> : il chiffre chaque cause.</p>` },
  {
    id: 'diplomacy', title: 'Les relations diplomatiques', icon: 'handshake', body: `
      <ul>
        <li>Relations de −100 à +100 : neutre, amical, partenaire commercial, allié, rival, hostile.</li>
        <li>Propositions possibles : discuter, accord commercial, pacte de non-agression, alliance, aide, réduction des tensions, paix, sanctions, coalitions.</li>
        <li>L'IA répond <b>Accepté</b>, <b>Refusé</b> ou par une <b>contre-proposition</b>, avec la liste des facteurs pris en compte (relations, confiance, personnalité, ennemi commun, risques…).</li>
        <li>L'IA se souvient des refus, des trahisons et des aides. Les demandes répétées l'agacent.</li>
        <li>Si aucune proposition n'est acceptable, le jeu l'indique clairement et explique pourquoi.</li>
      </ul>` },
  {
    id: 'army', title: 'L\'armée', icon: 'shield', body: `
      <ul>
        <li>Le <b>budget militaire</b> (en % du PIB) fixe la taille de l'armée que vous pouvez entretenir ; le recrutement dépend aussi de la population mobilisable et de l'industrie.</li>
        <li>La <b>composition</b> (infanterie, blindés, artillerie, reconnaissance, aviation, forces spéciales) a de vrais effets :
          <ul><li>blindés : très efficaces en terrain ouvert, coûteux ;</li><li>infanterie : polyvalente, la meilleure en montagne et en forêt ;</li>
          <li>artillerie : soutien puissant contre les fortifications, forte consommation logistique ;</li><li>reconnaissance : mobilité et renseignement ;</li>
          <li>aviation : grande puissance, coûts élevés ;</li><li>forces spéciales : efficaces dans les terrains difficiles et contre les partisans.</li></ul></li>
        <li>La <b>posture</b> (offensive, équilibrée, défensive) oriente les fronts. Les fortifications se construisent dans la durée.</li>
        <li>Préparation, moral, ravitaillement, technologie et terrain comptent autant que le nombre.</li>
      </ul>` },
  {
    id: 'research', title: 'La recherche', icon: 'network', body: `
      <ul>
        <li>L'arbre technologique compte 181 technologies en 12 branches. Chaque branche porte un projet à la fois ; un projet coûte une part du PIB, étalée sur sa durée.</li>
        <li>Les effets sont réels : économie, industrie, logistique, armée, diplomatie, renseignement, stabilité, ressources, mobilité…</li>
        <li><b>Choix exclusifs</b> : certaines paires de technologies s'excluent. Choisir l'une rend l'autre définitivement inaccessible (cadenas). Lisez bien les deux options.</li>
        <li>L'arbre se zoome, se parcourt à la souris et propose une <b>recherche textuelle</b> et un filtre <b>« Conseillé »</b> adapté à votre situation.</li>
        <li>Un projet sans financement est suspendu : vérifiez votre trésorerie.</li>
      </ul>` },
  {
    id: 'groups', title: 'Les groupes d\'armée', icon: 'users', body: `
      <ul>
        <li>Vous choisissez le <b>nombre de groupes d'armée</b> et l'<b>affectation</b> de chacun : défense de la capitale, réserve, ou front contre un pays donné.</li>
        <li>Les groupes sont visibles et <b>sélectionnables sur la carte</b> ; un clic ouvre leur fiche (effectifs, affectation, front).</li>
        <li>Une réserve renforce automatiquement le front le plus menacé ; un groupe affecté à un front y concentre ses attaques.</li>
      </ul>` },
  {
    id: 'navy', title: 'La marine', icon: 'ship', body: `
      <ul>
        <li>Chaque flotte reçoit un ordre : <b>aller à une position</b>, suivre plusieurs <b>points de passage</b>, <b>patrouiller</b>, <b>escorter les convois</b> ou <b>rentrer au port</b>.</li>
        <li>Les destinations se choisissent directement sur la carte (cliquez sur la mer).</li>
        <li>La marine protège vos transports de troupes, impose ou brise les blocus et soutient les débarquements.</li>
      </ul>` },
  {
    id: 'occupation', title: 'Les occupations', icon: 'map-pin', body: `
      <p>Un territoire conquis ne devient pas immédiatement le vôtre. Il passe par plusieurs états :</p>
      <ul>
        <li><b>Semi-occupé</b> : juste après la conquête ; peu productif, fragile.</li>
        <li><b>Occupé</b> : s'il est calme et bien ravitaillé, le contrôle se consolide.</li>
        <li><b>Contesté</b> : sans ravitaillement suffisant, des partisans apparaissent et certaines zones peuvent être reprises.</li>
        <li><b>Contrôlé</b> : territoire officiel (après un traité, ou une occupation longue et calme).</li>
      </ul>
      <p>L'état d'une région s'affiche au survol. Les forces spéciales et un bon ravitaillement réduisent l'activité des partisans.</p>` },
  {
    id: 'peace', title: 'La paix', icon: 'scroll-text', body: `
      <ul>
        <li>Chaque territoire a une <b>valeur</b> (superficie, population, ports, ressources, capitale, intérêt stratégique).</li>
        <li>L'adversaire compare ce que vous demandez à ce qu'il peut céder, selon le territoire réellement perdu, le rapport de forces, les fronts, la durée de la guerre, ses alliés et sa stabilité. Une petite victoire ne permet pas d'obtenir la moitié d'un pays.</li>
        <li>L'IA accepte, refuse ou fait une contre-offre. Après un refus, elle attend avant de reproposer.</li>
      </ul>` },
  {
    id: 'territory', title: 'Les propositions territoriales', icon: 'route', body: `
      <ul>
        <li>Diplomatie &amp; Territoire permet de négocier : échanges de frontières ou de régions, restitutions, cessions, achats de territoire, indépendances, annexion consentie, fusion, séparation, création d'un nouvel État.</li>
        <li>Prendre un territoire par la diplomatie nécessite toujours l'<b>accord du pays concerné</b>.</li>
        <li>Les échanges ne sont possibles qu'entre régions <b>voisines ou cohérentes géographiquement</b>.</li>
        <li>Le crayon de frontières n'existe pas en Mode Nation : il est réservé au Sandbox et à l'éditeur.</li>
      </ul>` },
  {
    id: 'formables', title: 'Les nations formables', icon: 'crown', body: `
      <ul>
        <li>Environ 32 nations peuvent être formées (par exemple une union régionale ou la réunification d'un pays historique).</li>
        <li><b>Par conquête</b> : contrôler les régions requises.</li>
        <li><b>Par la diplomatie</b> : adhésion volontaire et vote des États membres, à la manière d'une construction européenne.</li>
        <li><b>Union d'alliés</b> : plusieurs alliés décident de fusionner.</li>
        <li>L'IA peut aussi former des nations. La formation déclenche une <b>proclamation</b>.</li>
        <li>Un <b>éditeur</b> permet de créer vos propres nations formables.</li>
      </ul>` },
  {
    id: 'multi', title: 'Le multijoueur', icon: 'wifi', body: `
      <ul>
        <li><b>Héberger</b> : lancez une partie Nation, ouvrez Multijoueur et copiez le <b>code de partie</b> (par exemple <code>H7KQ2-M9XAPQ</code>).</li>
        <li><b>Rejoindre</b> : Menu → Multijoueur → Rejoindre, saisissez le code, cliquez sur Rejoindre, puis choisissez votre pays. Un même code sert à plusieurs joueurs.</li>
        <li>La connexion passe par un <b>serveur relais</b> (fonctionne derrière une box, en 4G/5G) ; les données sont <b>chiffrées</b> de bout en bout, le relais ne peut pas les lire. Si un relais est indisponible, le suivant est essayé.</li>
        <li>Tous les joueurs doivent avoir <b>exactement la même version</b> du jeu.</li>
        <li>Les anciennes méthodes (code d'invitation WebRTC, adresse IP) restent dans « Autres méthodes ».</li>
        <li>Pause et vitesse sont communes ; seul l'hôte sauvegarde.</li>
      </ul>` },
  {
    id: 'time', title: 'Vitesse et notifications', icon: 'clock', body: `
      <ul>
        <li>Vitesses : pause (${K('Espace')}), ×1, ×2, ×3, ×5 et ×10 au maximum (touches ${K('1')} à ${K('5')}).</li>
        <li>À vitesse élevée, les notifications semblables sont <b>regroupées</b> et les moins importantes sont masquées.</li>
        <li><b>Niveau de notifications</b> : toutes, importantes seulement, ou critiques seulement.</li>
        <li><b>Pause automatique</b> : choisissez les événements qui mettent le jeu en pause (déclaration de guerre, décision, proposition, fin de guerre, récapitulatif annuel…).</li>
        <li>Ouvrir les réglages en partie met le jeu en pause.</li>
      </ul>` },
  {
    id: 'settings', title: 'Réglages, identité et thèmes', icon: 'settings', body: `
      <ul>
        <li><b>Réglages avancés</b> : une trentaine de paramètres (diplomatie, économie, guerre, IA, paix, occupation, logistique) et des profils (Équilibré, Réaliste, Guerre totale, Diplomatique, Bâtisseur, Arcade). Vous pouvez enregistrer vos propres profils.</li>
        <li><b>Identité</b> : couleurs principale et secondaire, forme des unités (disque, carré, losange, hexagone), style des navires, couleur des autres pays. Une configuration peut être enregistrée et réutilisée.</li>
        <li><b>Thèmes d'interface</b> : plusieurs styles visuels, sans effet sur les règles du jeu.</li>
      </ul>` },
  {
    id: 'keys', title: 'Raccourcis', icon: 'monitor', body: `
      <ul>
        <li>${K('Espace')} pause · ${K('1')}–${K('5')} vitesse · ${K('P')} Mon pays · ${K('D')} diplomatie · ${K('G')} guerres · ${K('H')} histoire du monde</li>
        <li>${K('K')} cartes thématiques · ${K('M')} unités · ${K('L')} noms · ${K('V')} vue d'ensemble · ${K('C')} caméra auto/libre · ${K('S')} son</li>
        <li>${K('F1')} guide · ${K('Échap')} fermer / menu · ${K('F11')} plein écran</li>
      </ul>` },
];

// étapes du tutoriel : done(app) valide l'étape automatiquement quand le joueur fait l'action
const nPanel = (tab) => (app) => isShown('nationPanel') && app.nationUI.tab === tab;
export const TUTORIAL = [
  { title: 'Bienvenue', text: 'La barre du haut résume votre pays : PIB, trésorerie, population, stabilité et effectifs. Le jeu est en pause pour vous laisser le temps de lire.' },
  { title: 'Mon pays', text: 'Ouvrez le tableau de bord : bouton « Gérer le pays », entrée « Mon pays » du rail, ou touche P.', done: nPanel('home') },
  { title: 'Les alertes', text: 'En haut du tableau de bord, les alertes indiquent ce qui demande une action. Cliquez sur une carte pour ouvrir le panneau correspondant.' },
  { title: 'Le conseiller', text: 'Ouvrez l\'onglet « Conseiller » : il explique les causes de chaque difficulté et propose des pistes.', done: nPanel('advisor') },
  { title: 'La recherche', text: 'Ouvrez l\'onglet « Technologies » et lancez un premier projet.', done: (app) => { const s = app.session.sim; return !!(s && s.nv && Object.keys(s.sides[s.nv.player].dev.active).length); } },
  { title: 'La diplomatie', text: 'Ouvrez l\'onglet « Diplomatie » (touche D) et regardez vos voisins.', done: nPanel('diplo') },
  { title: 'Le temps', text: 'Fermez le panneau et lancez le temps : Espace, ou les vitesses ×1 à ×10 en bas de l\'écran.', done: (app) => app.session.state === 'running' && !isShown('nationPanel') },
  { title: 'Le guide', text: 'Le guide reste accessible à tout moment : entrée « Guide » du rail, du menu principal, ou touche F1. Bonne partie !' },
];

export class GuideUI {
  constructor(app) {
    this.app = app;
    this.chapter = 'start';
    this.step = -1;
    const add = (html) => { const t = document.createElement('template'); t.innerHTML = html.trim(); const el = t.content.firstChild; document.body.appendChild(el); return el; };
    add(`<section id="guideDialog" class="overlay hidden"><div class="dialog wide panel guide">
      <div class="guide-side"><small class="eyebrow">Aide</small><h2>Guide</h2><nav id="guideNav"></nav>
        <button class="btn ghost sm" id="guideTuto">${icon('graduation-cap')}<span>Relancer le tutoriel</span></button></div>
      <div class="guide-main"><div class="guide-head"><h3 id="guideTitle"></h3><button class="btn ghost sm icon" id="guideClose" title="Fermer (Échap)">${icon('x')}</button></div>
        <div class="guide-body" id="guideBody"></div>
        <div class="guide-foot"><button class="btn ghost sm" id="guidePrev">${icon('chevron-right', 'flip')}<span>Précédent</span></button><span class="grow"></span><button class="btn ghost sm" id="guideNext"><span>Suivant</span>${icon('chevron-right')}</button></div>
      </div></div></section>`);
    add(`<div id="tutoCard" class="panel hidden"></div>`);
    $('guideNav').addEventListener('click', (e) => { const b = e.target.closest('[data-ch]'); if (b) this.show(b.dataset.ch); });
    $('guideClose').onclick = () => this.close();
    $('guidePrev').onclick = () => this._move(-1);
    $('guideNext').onclick = () => this._move(1);
    $('guideTuto').onclick = () => { this.close(); if (this.app.nationUI.active) this.startTutorial(); else this._tutoLater = true; };
    $('guideDialog').addEventListener('keydown', (e) => e.stopPropagation());
    $('guideDialog').addEventListener('click', (e) => { if (e.target.id === 'guideDialog') this.close(); });
  }
  isOpen() { return isShown('guideDialog'); }
  open(chapter = null) {
    if (chapter) this.chapter = chapter;
    $('guideNav').innerHTML = GUIDE.map((c) => `<button data-ch="${c.id}">${icon(c.icon)}<span>${esc(c.title)}</span></button>`).join('');
    show('guideDialog');
    this.app.pauseForOverlay();
    this.show(this.chapter);
  }
  close() { show('guideDialog', false); this.app.resumeAfterOverlay(); }
  show(id) {
    const c = GUIDE.find((x) => x.id === id) || GUIDE[0];
    this.chapter = c.id;
    $('guideTitle').innerHTML = `${icon(c.icon)} ${esc(c.title)}`;
    $('guideBody').innerHTML = c.body;
    $('guideBody').scrollTop = 0;
    document.querySelectorAll('#guideNav [data-ch]').forEach((b) => b.classList.toggle('on', b.dataset.ch === c.id));
    const i = GUIDE.indexOf(c);
    $('guidePrev').disabled = i === 0; $('guideNext').disabled = i === GUIDE.length - 1;
  }
  _move(d) { const i = GUIDE.findIndex((x) => x.id === this.chapter); this.show(GUIDE[Math.max(0, Math.min(GUIDE.length - 1, i + d))].id); }

  // ---------- tutoriel ----------
  maybeStartTutorial() {
    const s = this.app.settings;
    if (this._tutoLater || !s.tutorialDone) { this._tutoLater = false; setTimeout(() => this.startTutorial(), 900); }
  }
  startTutorial() {
    if (!this.app.nationUI.active) return;
    this.step = 0;
    this.app.pauseForOverlay();
    this._renderStep();
  }
  _renderStep() {
    const st = TUTORIAL[this.step];
    if (!st) { this.endTutorial(true); return; }
    const last = this.step === TUTORIAL.length - 1;
    $('tutoCard').innerHTML = `<div class="tuto-h">${icon('graduation-cap')}<small class="eyebrow">Tutoriel · étape ${this.step + 1} / ${TUTORIAL.length}</small><button class="btn ghost sm icon" id="tutoSkip" title="Passer le tutoriel">${icon('x')}</button></div>
      <b>${esc(st.title)}</b><p>${esc(st.text)}</p>
      <div class="tuto-dots">${TUTORIAL.map((_, i) => `<i class="${i < this.step ? 'done' : i === this.step ? 'on' : ''}"></i>`).join('')}</div>
      <div class="row"><button class="btn ghost sm" id="tutoGuide">${icon('circle-help')}<span>Guide</span></button><span class="grow"></span>${st.done && !last ? '<small class="dim">ou</small>' : ''}<button class="btn ${st.done ? 'ghost' : 'primary'} sm" id="tutoNext">${last ? 'Terminer' : 'Suivant'}</button></div>`;
    show('tutoCard');
    $('tutoSkip').onclick = () => this.endTutorial(true);
    $('tutoNext').onclick = () => this._next();
    $('tutoGuide').onclick = () => this.open();
  }
  _next() { this.step++; if (this.step >= TUTORIAL.length) this.endTutorial(true); else this._renderStep(); }
  endTutorial(done) {
    this.step = -1;
    show('tutoCard', false);
    if (done && !this.app.settings.tutorialDone) { this.app.settings.tutorialDone = true; this.app.saveSettings(); }
  }
  // appelé régulièrement en partie : validation automatique des étapes
  update() {
    if (this.step < 0) return;
    if (!this.app.nationUI.active) { this.step = -1; show('tutoCard', false); return; }
    const st = TUTORIAL[this.step];
    if (st && st.done && st.done(this.app)) this._next();
  }
}
