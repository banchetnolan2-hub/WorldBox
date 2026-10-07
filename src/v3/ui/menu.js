// UI — MENU PRINCIPAL : une colonne d'entrées (Continuer, Nouvelle partie, Scénarios, Nation Simulator,
// Sandbox, Créer, Charger, Options, Crédits) et un panneau de sous-menu avec fil d'Ariane.
// Le joueur sait toujours où il est, comment revenir en arrière et ce que fait chaque bouton.
import { DIFFICULTY_BY_ID } from '../sim/rules.js';
import { $, show, esc, notice } from './util.js';
import { icon } from './icons.js';
import { Store } from '../save/store.js';
import { SCENARIOS, SCENARIO_CATS } from '../sim/scenarios.js';
import { REAL_META } from '../sim/profile.js';
import { DETAILS_META } from '../world/details.js';

const MAIN = [
  ['continue', 'Continuer', 'play'],
  ['new', 'Nouvelle partie', 'plus-circle'],
  ['scenarios', 'Story Mode', 'book-marked'],
  ['nation', 'Nation Simulator', 'landmark'],
  ['multi', 'Multijoueur', 'users'],
  ['sandbox', 'Sandbox', 'globe'],
  ['create', 'Créer', 'pencil'],
  ['load', 'Charger', 'folder-open'],
  ['options', 'Options', 'settings'],
  ['credits', 'Crédits', 'award'],
  ['quit', 'Quitter', 'power'],
];

export class MenuUI {
  constructor(app) {
    this.app = app;
    this.path = [];
    this.scCat = 'all';
    $('mmMain').innerHTML = MAIN.map(([k, l, ic]) => `<button data-m="${k}" class="mm-item">${icon(ic)}<span class="l">${l}</span><span class="d" data-desc="${k}"></span></button>`).join('');
    $('mmMain').addEventListener('click', (e) => { const b = e.target.closest('[data-m]'); if (b) this.go(b.dataset.m); });
    $('mmSub').addEventListener('click', (e) => {
      const b = e.target.closest('[data-act]');
      if (b && !b.disabled) this.act(b.dataset.act, b.dataset);
    });
  }

  // à l'ouverture du menu : sous-menu fermé, infos de la dernière partie
  async refresh() {
    this.closeSub();
    const list = (await Store.list('parties')).filter((x) => x.meta && !x.meta.broken);
    this.last = list[0] || null;
    const c = $('mmMain').querySelector('[data-desc=continue]');
    c.textContent = this.last ? (this.last.meta.name || '') : 'Aucune partie sauvegardée';
    $('mmMain').querySelector('[data-m=continue]').disabled = !this.last;
    this.games = list;
  }

  go(key) {
    const app = this.app;
    if (key === 'continue') { if (this.last) app.loadGame(this.last.id); return; }
    if (key === 'nation') { this.closeSub(); app.nationUI.openPick(); return; }
    if (key === 'multi') { this.closeSub(); app.netUI.openMenu('join'); return; }
    if (key === 'options') { app.openSettings(); return; }
    if (key === 'quit') { if (window.desktop) window.desktop.quit(); else notice('Fermez simplement l\'onglet du navigateur.'); return; }
    this.open(key);
  }

  closeSub() {
    show('mmSub', false);
    document.querySelectorAll('#mmMain .mm-item').forEach((b) => b.classList.remove('on'));
    this.cur = null;
  }

  // sous-menus
  open(key, sub = null) {
    this.cur = key;
    document.querySelectorAll('#mmMain .mm-item').forEach((b) => b.classList.toggle('on', b.dataset.m === key));
    const label = MAIN.find((m) => m[0] === key)[1];
    const crumbs = [['menu', 'Menu principal'], [key, label]];
    if (sub) crumbs.push([key + ':' + sub, sub]);
    let body = '';
    let lead = '';
    const opt = (act, ic, title, desc, extra = '') => `<button class="mm-opt" data-act="${act}" ${extra}>${icon(ic)}<span><b>${title}</b><small>${desc}</small></span>${icon('chevron-right')}</button>`;
    if (key === 'new') {
      lead = 'Choisissez comment commencer.';
      body = opt('nation', 'landmark', 'Nation Simulator', 'Dirigez un seul pays de 2026 à aussi loin que vous le voulez ; l\'IA dirige tous les autres.')
        + opt('custom', 'sliders-horizontal', 'Monde personnalisé', 'Choisissez les pays, les équipes, la durée et les règles de la partie.')
        + opt('quick', 'zap', 'Partie rapide', 'Deux pays voisins tirés au hasard, lancement immédiat.')
        + opt('spectator', 'film', 'Mode spectateur', 'Des simulations automatiques s\'enchaînent sans intervention.');
    } else if (key === 'scenarios') {
      lead = `${SCENARIOS.length} scénarios : un pays, une situation de départ, un objectif principal, des objectifs secondaires et secrets, des événements et plusieurs fins.`;
      body = `<div class="mm-tabs">${[['all', 'Tous', 'list'], ...SCENARIO_CATS].map(([k, l]) => `<button data-act="sccat" data-cat="${k}" class="${this.scCat === k ? 'on' : ''}">${l}</button>`).join('')}</div><div class="mm-cards" id="mmScenarios"><p class="hint">Chargement…</p></div>`;
    } else if (key === 'sandbox') {
      lead = 'Simulation libre : vous observez et modifiez le monde.';
      body = opt('world', 'earth', 'Simulation', `Tous les pays de « ${esc(this.app.world.name)} », règles configurables.`)
        + opt('custom', 'sliders-horizontal', 'Choisir les pays', 'Un duel, plusieurs pays ou des équipes.')
        + opt('editmap', 'map', 'Éditeur de monde', 'Continents, côtes, relief, biomes et frontières.')
        + opt('control', 'pencil', 'Éditeur de pays', 'Frontières, statistiques, équipes et événements en direct (Contrôle total).')
        + opt('worlds', 'folder-open', 'Mondes enregistrés', 'Charger, renommer, exporter ou importer un monde.')
        + opt('classic', 'map-pin', 'Mode classique 2D', 'La carte 2D de la première version.');
    } else if (key === 'create') {
      lead = 'Vos propres mondes, pays et scénarios.';
      body = opt('editor', 'sparkles', 'Créer un monde', 'Dessinez continents, îles, relief, rivières, pays et capitales.')
        + opt('country', 'flag', 'Créer un pays', 'Ajoutez un pays sur la carte : nom, drapeau, capitale, statistiques.')
        + opt('scenarioEditor', 'book-marked', 'Créer un scénario', 'Choisissez un pays, une situation de départ, des objectifs et les règles.');
    } else if (key === 'load') {
      lead = 'Parties sauvegardées (les plus récentes en premier).';
      const g = this.games || [];
      body = g.length ? `<ul class="mm-saves">${g.slice(0, 30).map((x) => { const m = x.meta || {}; return `<li><div><b>${esc(m.name || x.id)}</b><small>${esc(m.world || '')}${m.updatedAt ? ` — ${new Date(m.updatedAt).toLocaleString('fr-FR', { dateStyle: 'medium', timeStyle: 'short' })}` : ''}</small></div><button class="btn primary sm" data-act="loadgame" data-id="${esc(x.id)}">Reprendre</button><button class="btn ghost sm icon" data-act="delgame" data-id="${esc(x.id)}" title="Supprimer cette sauvegarde">${icon('trash-2')}</button></li>`; }).join('')}</ul>`
        : '<p class="mm-empty">Aucune partie sauvegardée. Pendant une partie, utilisez Sauvegarde dans la barre de navigation (ou la pause).</p>';
      body += opt('worlds', 'globe', 'Mondes enregistrés', 'Les mondes créés ou modifiés, avec leur histoire.');
    } else if (key === 'credits') {
      lead = 'World Simulator';
      body = `<div class="mm-credits">
        <h4>Données</h4>
        <p>Frontières : Natural Earth via world-atlas (domaine public). Villes, ports et lacs : ${esc(DETAILS_META.source)}.</p>
        <p>Population et PIB : Banque mondiale (SP.POP.TOTL, NY.GDP.MKTP.CD). Dépenses militaires : SIPRI Military Expenditure Database.</p>
        <p>Relief : ETOPO / GEBCO (NOAA, domaine public), SRTM / GTOPO (USGS, NASA).</p>
        <h4>Typographies et icônes</h4>
        <p>Inter et Cormorant Garamond (SIL Open Font License). Icônes Lucide (ISC). Drapeaux : flag-icons (MIT).</p>
        <h4>Technologie</h4>
        <p>Three.js (MIT), Electron (MIT), esbuild (MIT).</p>
        <h4>Avertissement</h4>
        <p>Toutes les simulations sont des modèles de jeu abstraits ; aucun résultat n'est une prédiction du monde réel.</p>
        <p class="hint">Couverture des données réelles : population ${REAL_META.coverage.population} pays, PIB ${REAL_META.coverage.gdp}, dépenses militaires ${REAL_META.coverage.military}.</p></div>`;
    }
    $('mmSub').innerHTML = `
      <nav class="mm-crumbs">${crumbs.map(([k, l], i) => i < crumbs.length - 1 ? `<button data-act="crumb" data-k="${k}">${esc(l)}</button><i>›</i>` : `<span>${esc(l)}</span>`).join('')}</nav>
      <h2>${esc(label)}</h2>${lead ? `<p class="mm-lead">${esc(lead)}</p>` : ''}
      <div class="mm-body">${body}</div>
      <div class="mm-subfoot"><button class="btn ghost sm" data-act="back">${icon('chevron-right', 'flip')}<span>Retour</span></button></div>`;
    show('mmSub');
    const el = $('mmSub'); el.classList.remove('enter'); void el.offsetWidth; el.classList.add('enter');
    if (key === 'scenarios') this._scenarios();
  }

  async _scenarios() {
    const mine = (await Store.list('scenarios')).filter((x) => x.meta && !x.meta.broken);
    this.mine = mine;
    const cat = this.scCat;
    const ents = this.app.entities();
    const cards = [];
    for (const s of SCENARIOS) {
      if (cat !== 'all' && !(s.cats || []).includes(cat)) continue;
      const e = ents.find((x) => x.id === s.country);
      const df = s.difficulty && DIFFICULTY_BY_ID[s.difficulty];
      cards.push(`<button class="mm-card" data-act="scenario" data-id="${s.id}"><div class="mc-top">${icon(s.icon)}<small>${esc(s.tag)}</small>${df ? `<span class="mc-diff" style="--dc:${df.color}">${esc(df.label)}</span>` : ''}</div><b>${esc(s.title)}</b><span class="mc-sub">${e ? esc(e.name) : ''}, ${s.years} ans${s.objectives.some((o) => o.secret) ? ' · objectifs secrets' : ''}</span><p>${esc(s.desc)}</p></button>`);
    }
    if (cat === 'all' || cat === 'mine') {
      for (const x of mine) {
        const m = x.meta;
        const e = ents.find((y) => y.id === m.country);
        cards.push(`<div class="mm-card mine"><div class="mc-top">${icon('pencil')}<small>Mon scénario</small></div><b>${esc(m.name)}</b><span class="mc-sub">${e ? esc(e.name) : ''}, ${m.years || '?'} ans</span><p>${esc(m.desc || '')}</p>
          <div class="mc-acts"><button class="btn primary xs" data-act="myscenario" data-id="${esc(x.id)}">Jouer</button><button class="btn ghost xs" data-act="editscenario" data-id="${esc(x.id)}">Modifier</button><button class="btn ghost xs icon" data-act="delscenario" data-id="${esc(x.id)}" title="Supprimer">${icon('trash-2')}</button></div></div>`);
      }
      if (cat === 'mine' && !mine.length) cards.push('<p class="mm-empty">Vous n\'avez pas encore créé de scénario.</p>');
    }
    cards.push(`<button class="mm-card add" data-act="newscenario">${icon('plus')}<b>Créer un scénario</b><p>Pays, situation de départ, objectifs, durée et règles.</p></button>`);
    const box = $('mmScenarios');
    if (box) box.innerHTML = cards.join('');
  }

  async act(a, ds) {
    const app = this.app;
    if (a === 'back') { if (this.cur) this.closeSub(); return; }
    if (a === 'crumb') { if (ds.k === 'menu') this.closeSub(); else this.open(ds.k); return; }
    if (a === 'nation') { this.closeSub(); app.nationUI.openPick(); }
    else if (a === 'custom') { const cfg = app.lastCreator ? JSON.parse(JSON.stringify(app.lastCreator)) : null; app.openCreator(cfg); if (app.creator.cfg.mode === 'world') app.creator.setMode('custom'); }
    else if (a === 'world') { app.openCreator(); app.creator.setMode('world'); }
    else if (a === 'quick') app.quickGame();
    else if (a === 'spectator') app.spectatorNext();
    else if (a === 'editmap') { if (app.world.terrain) app.enterEditor({ world: app.world }); else { app.enterEditor(); app.editor.startFrom('earth'); } }
    else if (a === 'editor') app.enterEditor();
    else if (a === 'control') app.enterControl();
    else if (a === 'country') { app.enterControl(); setTimeout(() => app.control.openNewCountry(), 300); }
    else if (a === 'worlds') app.worldsUI.open();
    else if (a === 'classic') window.location.href = 'classic.html';
    else if (a === 'loadgame') app.loadGame(ds.id);
    else if (a === 'delgame') { if (window.confirm('Supprimer définitivement cette sauvegarde ?')) { await Store.remove('parties', ds.id); await this.refresh(); this.open('load'); } }
    else if (a === 'sccat') { this.scCat = ds.cat; this.open('scenarios'); }
    else if (a === 'scenario') { this.closeSub(); app.nationUI.openPick(ds.id); }
    else if (a === 'myscenario') { const d = await Store.read('scenarios', ds.id); if (d && d.spec) { this.closeSub(); app.nationUI.openPick(d.spec.id, d.spec); } }
    else if (a === 'editscenario') { const d = await Store.read('scenarios', ds.id); if (d && d.spec) app.scenarioEditor.open(d.spec, () => this.open('scenarios')); }
    else if (a === 'delscenario') { if (window.confirm('Supprimer ce scénario ?')) { await Store.remove('scenarios', ds.id); this._scenarios(); } }
    else if (a === 'newscenario' || a === 'scenarioEditor') app.scenarioEditor.open(null, () => { this.scCat = 'mine'; this.open('scenarios'); });
  }
}
