// UI — NATION SIMULATOR et MODE HISTOIRE : choix du pays (fiche complète, données réelles et sources),
// identité personnalisée, barre nationale, GESTION DU PAYS (économie, population, infrastructures,
// technologie, défense, diplomatie, arbre de développement, chronologie, identité, objectifs),
// dialogue diplomatique avec l'analyse de l'IA, propositions des IA, décisions, fin de scénario.
import { $, show, isShown, esc, notice, fmtInt, flagImg } from './util.js';
import { icon } from './icons.js';
import { participantProfile } from '../sim/worldSim.js';
import { fmtBn, PERSONALITIES, ECONOMY_TYPES, UNIT_LABELS, realStatsOf, REAL_META } from '../sim/profile.js';
import { powerOf, OBJECTIVE_LABELS } from '../sim/ai.js';
import { relationStatus, REL_LABELS, DEFAULT_WAR_END } from '../sim/wars.js';
import { landTotal } from '../sim/economy.js';
import { fmtDate, YEAR_SEC, dateParts } from '../sim/calendar.js';
import { DEV_TREE, DEV_BRANCHES, DEV_BY_ID, FX_LABELS, DIPLO_ACTIONS } from '../sim/nation.js';
import { TECH_BRANCHES, BRANCH_BY_ID, SPECIALIZATIONS, CONS_TEXT, specsOf, affinity, techOpen } from '../sim/techTree.js';
import { SCENARIOS, findScenario } from '../sim/scenarios.js';
import { describeTerms, makePeaceTerms, claimableRegions } from '../sim/diplomacy.js';
import { NATION_WAR_END, goalProgress, collapseRisk } from '../sim/warEnd.js';
import { coalitionsOf, coalitionsAgainst, memberOf } from '../sim/coalitions.js';
import { sanction, liftSanction, isSanctioning, sanctionsOn } from '../sim/crises.js';
import { rulesBadge } from './rulesUI.js';
import { defaultRules, DIFFICULTIES, DIFFICULTY_BY_ID } from '../sim/rules.js';
import { blocsOf, rivalsOf, friendsOf } from '../sim/geopolitics.js';
import { randomSeedString } from '../sim/rng.js';
import { drawCustomFlag } from '../globe/flagAtlas.js';
import { MAP_PALETTE } from '../globe/mapColors.js';
import { dashboardHtml, advisorHtml } from './dashboard.js';

export const NATION_SPEEDS = [1, 2, 5, 10];
const NONE = 65535;
const pctS = (v, d = 1) => `${(v * 100).toFixed(d).replace('.', ',')} %`;
const num = (v, d = 1) => (Math.round(v * 10 ** d) / 10 ** d).toLocaleString('fr-FR');
const usd = (v) => `${Math.round(v).toLocaleString('fr-FR')} $`;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const TABS = [
  ['home', 'Mon pays', 'landmark'], ['advisor', 'Conseiller', 'lightbulb'],
  ['eco', 'Économie', 'coins'], ['pop', 'Population', 'users'], ['infra', 'Infrastructures', 'route'], ['tech', 'Technologie', 'cpu'],
  ['def', 'Défense', 'shield'], ['diplo', 'Diplomatie', 'handshake'], ['dev', 'Technologies', 'network'], ['time', 'Chronologie', 'history'],
  ['id', 'Identité', 'flag'], ['goals', 'Objectifs', 'target'],
];
const SYMBOLS = ['crown', 'shield', 'landmark', 'anchor', 'sprout', 'zap', 'mountain', 'trees', 'waves', 'sparkles', 'globe', 'award'];
const FLAG_LAYOUTS = [['h3', 'Horizontal ×3'], ['v3', 'Vertical ×3'], ['h2', 'Horizontal ×2'], ['v2', 'Vertical ×2'], ['cross', 'Croix'], ['diag', 'Diagonale'], ['circle', 'Disque'], ['star', 'Étoile'], ['solid', 'Uni']];
const REGION_DIRS = [['nord', 'Nord'], ['sud', 'Sud'], ['est', 'Est'], ['ouest', 'Ouest']];
const MS_ICONS = { start: 'flag', project: 'shovel', reform: 'award', diplo: 'handshake', alliance: 'handshake', war: 'swords', treaty: 'scroll-text', decision: 'scale', event: 'activity', objective: 'target' };

export class NationUI {
  constructor(app) {
    this.app = app;
    this.sel = -1;
    this.scenario = null;
    this.identity = null;
    this.tab = 'home';
    this.autoPause = true;
    this.active = false;
    this.backup = null;
    this._build();
  }

  // ======================= DOM =======================
  _build() {
    const add = (html) => { const t = document.createElement('template'); t.innerHTML = html.trim(); const el = t.content.firstChild; document.body.appendChild(el); return el; };
    add(`<section id="nationPick" class="hidden">
      <div class="np-left panel">
        <small class="eyebrow" id="npEyebrow">Nation Simulator</small>
        <h2 id="npTitle">Choisissez votre pays</h2>
        <p class="hint" id="npHint">Cliquez sur un pays du globe ou cherchez-le. Vous le dirigerez ; tous les autres pays seront dirigés par l'IA.</p>
        <div class="search">${icon('search')}<input type="text" id="npSearch" placeholder="Rechercher un pays…" spellcheck="false"></div>
        <ul class="np-list" id="npList"></ul>
        <div class="np-foot"><button class="btn ghost" id="npBack">${icon('chevron-right', 'flip')}<span>Menu</span></button></div>
      </div>
      <div class="np-sheet panel hidden" id="npSheet"></div>
    </section>`);
    add(`<section id="storyPick" class="overlay hidden"><div class="dialog wide panel story">
      <small class="eyebrow">Mode histoire</small><h2>Choisissez un scénario</h2>
      <p class="hint">Un pays, une situation de départ, des objectifs et plusieurs fins possibles. Le reste du monde est dirigé par l'IA et évolue librement.</p>
      <div class="story-grid" id="storyGrid"></div>
      <div class="dialog-foot"><span class="grow"></span><button class="btn ghost" id="storyClose">Fermer</button></div></div></section>`);
    add(`<div id="nationBar" class="panel hidden"></div>`);
    add(`<aside id="nationPanel" class="panel hidden"><div class="nm-head"><div class="nm-title" id="nmTitle"></div><button class="btn ghost sm icon" id="nmClose" title="Fermer">${icon('x')}</button></div>
      <nav class="nm-tabs" id="nmTabs"></nav><div class="nm-body" id="nmBody"></div></aside>`);
    add(`<div id="nationGoals" class="panel hidden"></div>`);
    add(`<section id="diploDialog" class="overlay hidden"><div class="dialog wide panel diplo" id="diploBox"></div></section>`);
    add(`<section id="nationDecision" class="overlay hidden"><div class="dialog panel decision" id="decisionBox"></div></section>`);
    add(`<section id="nationOffers" class="overlay hidden"><div class="dialog panel offers" id="offersBox"></div></section>`);
    add(`<section id="scenarioEnd" class="overlay hidden"><div class="dialog panel scen-end" id="scenEndBox"></div></section>`);
    $('npBack').onclick = () => this.app.goMenu();
    $('npSearch').addEventListener('input', () => this._list());
    $('npSearch').addEventListener('keydown', (e) => e.stopPropagation());
    $('storyClose').onclick = () => show('storyPick', false);
    $('nmClose').onclick = () => this.closePanel();
    $('nmTabs').addEventListener('click', (e) => { const b = e.target.closest('[data-tab]'); if (b) this.openPanel(b.dataset.tab); });
    const np = $('nationPanel');
    np.addEventListener('pointerdown', () => { this.busy = true; });
    window.addEventListener('pointerup', () => { this.busy = false; });
    np.addEventListener('keydown', (e) => e.stopPropagation());
    $('diploDialog').addEventListener('keydown', (e) => e.stopPropagation());
  }

  get sim() { return this.app.session.sim; }
  get nation() { return this.sim && this.sim.nv; }
  ent(e) { return this.app.entities()[e]; }
  color(e) { return this.app.renderer.colors[e] || (this.ent(e) || {}).color || '#888'; }
  chip(k) { const sd = this.sim.sides[k]; return `<span class="chip"><i class="dot" style="background:${this.color(sd.e)}"></i>${esc(sd.name)}</span>`; }

  // ======================= CHOIX DU PAYS =======================
  openPick(scenarioId = null, spec = null) {
    const app = this.app;
    app.hideAll();
    app.session.stop();
    app.setWorld(app.world, true);
    app.screen = 'nationPick';
    app.renderer.cam.idleSpin = 0;
    this.scenario = scenarioId ? findScenario(scenarioId, spec) : null;
    this.scenarioSpec = spec && spec.id === scenarioId ? spec : null;
    this.difficulty = (this.scenario && this.scenario.difficulty && DIFFICULTY_BY_ID[this.scenario.difficulty]) ? this.scenario.difficulty : 'normal';
    this.rules = { ...DIFFICULTY_BY_ID[this.difficulty].rules, ...((this.scenario && this.scenario.rules) || {}) };
    this.identity = null;
    $('npEyebrow').textContent = this.scenario ? `Mode histoire · ${this.scenario.tag}` : 'Nation Simulator';
    $('npTitle').textContent = this.scenario ? this.scenario.title : 'Choisissez votre pays';
    $('npHint').textContent = this.scenario ? this.scenario.desc : 'Cliquez sur un pays du globe ou cherchez-le. Vous le dirigerez ; tous les autres pays seront dirigés par l\'IA.';
    $('npSearch').value = '';
    show('nationPick');
    $('npSearch').parentElement.classList.toggle('hidden', !!this.scenario);
    this._list();
    if (this.scenario) {
      const e = app.entities().find((x) => x.id === this.scenario.country);
      if (e) this.pick(e.index);
    } else if (this.sel >= 0 && this.ent(this.sel)) this.pick(this.sel);
    else { show('npSheet', false); }
  }
  openStory() {
    $('storyGrid').innerHTML = SCENARIOS.map((s) => {
      const e = this.app.entities().find((x) => x.id === s.country);
      return `<button class="story-card" data-sc="${s.id}">
        <div class="sc-top">${icon(s.icon)}<small>${esc(s.tag)}</small><span class="grow"></span>${e ? flagImg(e, 'flag sm') : ''}</div>
        <b>${esc(s.title)}</b><span class="sc-country">${e ? esc(e.name) : ''} · ${s.years} ans</span><p>${esc(s.desc)}</p>
        <ul>${s.objectives.map((o) => `<li>${icon('target')}${esc(o.text)}${o.optional ? ' <em>(facultatif)</em>' : ''}</li>`).join('')}</ul></button>`;
    }).join('');
    $('storyGrid').querySelectorAll('[data-sc]').forEach((b) => { b.onclick = () => { show('storyPick', false); this.openPick(b.dataset.sc); }; });
    show('storyPick');
  }
  _candidates() {
    const counts = this.app.cellCounts();
    return this.app.entities().filter((e) => e && e.kind !== 'neutral' && !e.removed && counts[e.index] > 0);
  }
  _list() {
    const q = $('npSearch').value.trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
    let list = this._candidates();
    if (this.scenario) list = list.filter((e) => e.id === this.scenario.country);
    else if (q) list = list.filter((e) => e.name.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').includes(q));
    list.sort((a, b) => (b.population || 0) - (a.population || 0));
    $('npList').innerHTML = list.slice(0, 120).map((e) => `<li data-e="${e.index}" class="${e.index === this.sel ? 'on' : ''}">${flagImg(e, 'flag sm')}<span>${esc(e.name)}</span><small>${e.population ? num(e.population / 1e6) + ' M' : ''}</small></li>`).join('');
    $('npList').querySelectorAll('[data-e]').forEach((li) => { li.onclick = () => this.pick(Number(li.dataset.e), true); });
  }
  // clic sur le globe pendant le choix
  pick(e, fly = true) {
    const ent = this.ent(e);
    if (!ent || ent.kind === 'neutral' || e === NONE) return;
    if (this.scenario && ent.id !== this.scenario.country) { notice(`Ce scénario se joue avec ${this.app.entities().find((x) => x.id === this.scenario.country).name}.`); return; }
    this.sel = e;
    this.app.renderer.selected = e;
    if (fly) this.app.centerOn(e);
    this._list();
    this._sheet(ent);
  }
  _profile(ent) { return participantProfile(ent, {}, {}); }
  _neighbors(e) {
    const g = this.app.grid, owner = this.app.world.owner;
    const cnt = new Map();
    for (let i = 0; i < g.n; i++) {
      if (owner[i] !== e) continue;
      for (let k = g.nbrStart[i]; k < g.nbrStart[i + 1]; k++) { const o = owner[g.nbr[k]]; if (o !== e && o !== NONE) cnt.set(o, (cnt.get(o) || 0) + 1); }
    }
    return [...cnt.entries()].sort((a, b) => b[1] - a[1]).map(([o]) => this.ent(o)).filter((x) => x && x.kind !== 'neutral');
  }
  _sheet(ent) {
    const p = this._profile(ent);
    const d = p.derived;
    const real = realStatsOf(ent);
    const est = (key) => (!real || real.estimated.includes(key) ? '<span class="est" title="Donnée manquante ou ancienne : valeur estimée par le modèle">estimée</span>' : '');
    const src = (txt) => `<span class="src" title="${esc(txt)}">${icon('info')}</span>`;
    const km2 = (() => { const geo = this.app.geoFor(this.app.world); let s = 0; const o = this.app.world.owner; for (let i = 0; i < o.length; i++) if (o[i] === ent.index) s += geo ? geo.km2[i] : 770; return s; })();
    const id = this.identity && this.identity.e === ent.index ? this.identity : null;
    const name = id ? id.name : ent.name;
    const neigh = this._neighbors(ent.index).slice(0, 8);
    const blocs = blocsOf(ent.id || '');
    const rivals = rivalsOf(ent.id || '').map((r) => this.app.entities().find((x) => x.id === r.id)).filter(Boolean);
    const friends = friendsOf(ent.id || '').map((r) => this.app.entities().find((x) => x.id === r.id)).filter(Boolean).slice(0, 8);
    const budget = d.income, expenses = d.expenses;
    const row = (l, v, extra = '') => `<div class="kv"><span>${l}</span><b>${v}${extra}</b></div>`;
    const meter = (l, v, extra = '') => `<div class="kv meter-row"><span>${l}</span><b>${Math.round(v)}${extra}</b><div class="meter"><i style="width:${clamp(v, 0, 100)}%;background:${ent.color}"></i></div></div>`;
    const S = REAL_META.sources;
    const flagHtml = id && id.flag ? `<canvas class="flag lg" id="npFlagCv" width="96" height="64"></canvas>` : flagImg(ent, 'flag lg');
    const sc = this.scenario;
    $('npSheet').innerHTML = `
      <div class="np-head">${flagHtml}<div><small class="eyebrow">${esc(ent.continent || '')}</small><h2>${esc(name)}</h2><span class="hint">Capitale : ${esc(id ? id.capital : (ent.capital && ent.capital.name) || '—')}</span></div></div>
      ${sc ? `<div class="np-scen"><b>${icon(sc.icon)}${esc(sc.title)}</b><p>${esc(sc.desc)}</p><ul>${sc.objectives.map((o) => `<li>${icon('target')}${esc(o.text)}${o.optional ? ' <em>(facultatif)</em>' : ''}</li>`).join('')}</ul><small class="hint">Durée : ${sc.years} ans</small></div>` : ''}
      <div class="np-cols">
        <div>
          <h4>Population et économie</h4>
          ${row('Population', fmtInt(p.population), est('population') + src(S.population))}
          ${row('Croissance démographique', `${num(p.popGrowth, 2)} % / an`)}
          ${row('PIB', fmtBn(d.gdp), est('gdp') + src(S.gdp))}
          ${row('PIB par habitant', usd(d.gdpPc))}
          ${row('Budget (recettes)', fmtBn(budget) + ' / an')}
          ${row('Dépenses', fmtBn(expenses) + ' / an')}
          ${row('Dette publique', `${fmtBn(p.debt)} (${Math.round(p.debt / d.gdp * 100)} % du PIB)`, '<span class="est">estimée</span>')}
          ${row('Économie', ECONOMY_TYPES[d.economyType] || '')}
          ${row('Territoire', `${fmtInt(km2)} km²`)}
        </div>
        <div>
          <h4>Défense</h4>
          ${row('Dépenses militaires', `${num(p.milBudget, 2)} % du PIB`, est('military') + src(S.military))}
          ${row('Personnel militaire (actif)', fmtInt(d.soldiers * 0.85), '<span class="est" title="' + esc(S.personnel) + '">estimé</span>')}
          ${row('Groupes sur la carte', String(Math.max(1, Math.min(5, Math.round(1.5 + Math.sqrt(d.land * 0.85) / 6)))))}
          ${row('Puissance militaire (indice)', String(d.power))}
          ${row('Aviation / marine', `${num(p.army.air)} / ${num(p.army.navy)} groupes`)}
          <h4>Développement</h4>
          ${meter('Technologie', p.tech)}
          ${meter('Infrastructures', d.infraLevel)}
          ${meter('Ressources', d.resLevel)}
          ${meter('Stabilité', p.politics.stability)}
        </div>
      </div>
      <h4>Relations internationales</h4>
      <div class="np-rel">
        ${blocs.length ? `<div><small>Organisations</small><p>${blocs.map((b) => `<span class="tagx">${esc(b.name)}</span>`).join('')}</p></div>` : ''}
        ${friends.length ? `<div><small>Partenaires proches</small><p>${friends.map((e) => `<span class="mini">${flagImg(e, 'flag xs')}${esc(e.name)}</span>`).join('')}</p></div>` : ''}
        ${rivals.length ? `<div><small>Tensions</small><p>${rivals.map((e) => `<span class="mini bad">${flagImg(e, 'flag xs')}${esc(e.name)}</span>`).join('')}</p></div>` : ''}
        <div><small>Voisins</small><p>${neigh.map((e) => `<span class="mini">${flagImg(e, 'flag xs')}${esc(e.name)}</span>`).join('') || '<span class="hint">Aucun voisin terrestre</span>'}</p></div>
      </div>
      <p class="np-sources">${icon('book-marked')}Sources : population et PIB — Banque mondiale (${p.real ? `${p.real.popYear || '?'} / ${p.real.gdpYear || '?'}` : '—'}) ; dépenses militaires — SIPRI (${p.real && p.real.milYear ? p.real.milYear : 'estimées'}). Les valeurs marquées « estimée » sont calculées par le modèle. Personnalité de l'IA si le pays n'est pas joué : ${esc(PERSONALITIES[p.personality].label)}.</p>
      <div class="np-diff"><small>Difficulté : la complexité de la simulation, sans bonus ni malus</small>
        <div class="diff-seg">${DIFFICULTIES.map((d) => `<button data-diff="${d.id}" class="${this.difficulty === d.id ? 'on' : ''}" style="--dc:${d.color}"><i></i>${esc(d.label)}</button>`).join('')}<button data-diff="custom" class="${this.difficulty === 'custom' ? 'on' : ''}" style="--dc:var(--accent)"><i></i>Personnalisée</button></div>
        <p class="hint">${esc(this.difficulty === 'custom' ? 'Vos propres règles : choisissez chaque système dans « Règles de la partie ».' : DIFFICULTY_BY_ID[this.difficulty].desc)}</p></div>
      <div class="np-actions">
        <button class="btn ghost" id="npIdentity">${icon('pencil')}<span>Personnaliser l'identité</span></button>
        <button class="btn ghost" id="npRules" title="Règles de la partie">${icon('sliders-horizontal')}<span>${rulesBadge(this.rules || {}, sc ? 'story' : 'nation', sc ? sc.rules || {} : {})}</span></button>
        <button class="btn ghost" id="npWarEnd" title="Fin des guerres : paix automatique et conditions">${icon('scroll-text')}<span>Paix automatique : ${(this.warEnd || NATION_WAR_END).autoPeace ? 'ON' : 'OFF'}</span></button>
        <span class="grow"></span>
        <span class="hint">Début : ${fmtDate(0, this._startDay())}</span>
        <button class="btn primary" id="npStart">${icon('play')}<span>${sc ? 'Commencer le scénario' : 'Diriger ce pays'}</span></button>
      </div>
      <div id="npIdBox" class="np-id hidden"></div>`;
    show('npSheet');
    if (id && id.flag) drawCustomFlag($('npFlagCv').getContext('2d'), id.flag, 0, 0, 96, 64);
    $('npStart').onclick = () => this.start();
    const openRules = () => this.app.rulesUI.open({ mode: sc ? 'story' : 'nation', rules: this.rules || {}, locked: sc ? sc.rules || {} : {}, onDone: (r) => { this.rules = r; if (this.difficulty !== 'custom' && JSON.stringify(r) !== JSON.stringify({ ...DIFFICULTY_BY_ID[this.difficulty].rules, ...((sc && sc.rules) || {}) })) this.difficulty = 'custom'; this._sheet(ent); } });
    $('npRules').onclick = openRules;
    $('npWarEnd').onclick = () => this.app.warEndUI.open({ warEnd: this.warEnd || NATION_WAR_END, nation: true, title: 'Fin des guerres (mode Nation)', onDone: (we) => { this.warEnd = we; this._sheet(ent); } });
    $('npSheet').querySelectorAll('[data-diff]').forEach((b) => { b.onclick = () => {
      const id = b.dataset.diff;
      if (id === 'custom') { this.difficulty = 'custom'; openRules(); this._sheet(ent); return; }
      this.difficulty = id; this.rules = { ...DIFFICULTY_BY_ID[id].rules, ...((sc && sc.rules) || {}) }; this._sheet(ent);
    }; });
    $('npIdentity').onclick = () => {
      const box = $('npIdBox');
      if (!box.classList.contains('hidden')) { box.classList.add('hidden'); return; }
      if (!this.identity || this.identity.e !== ent.index) this.identity = this._defaultIdentity(ent);
      box.classList.remove('hidden');
      this._identityForm(box, this.identity, () => this._sheet(ent), true);
      box.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    };
  }
  _startDay() { return Math.max(365, this.app.world.dateDays || 0); }
  _defaultIdentity(ent) {
    return { e: ent.index, name: ent.name, shortName: ent.shortName || ent.name.slice(0, 3).toUpperCase(), capital: (ent.capital && ent.capital.name) || '', color: ent.colorOverride || ent.color, flag: ent.customFlag || null, symbol: ent.symbol || 'landmark', regions: { ...(ent.regionNames || {}) } };
  }
  // formulaire d'identité (choix du pays ou en partie)
  _identityForm(box, idt, onChange, preview = false) {
    const fl = idt.flag || { layout: 'h3', colors: ['#1d4ed8', '#f8fafc', '#dc2626'] };
    box.innerHTML = `
      <div class="id-grid">
        <div>
          <div class="field"><label><span>Nom du pays</span></label><input type="text" data-f="name" maxlength="32" value="${esc(idt.name)}"></div>
          <div class="field"><label><span>Nom court</span></label><input type="text" data-f="shortName" maxlength="12" value="${esc(idt.shortName)}"></div>
          <div class="field"><label><span>Capitale</span></label><input type="text" data-f="capital" maxlength="32" value="${esc(idt.capital)}"></div>
          <div class="field"><label><span>Couleur sur la carte</span></label><div class="swatches">${MAP_PALETTE.slice(0, 16).map((c) => `<button style="--c:${c}" data-c="${c}" class="${c === idt.color ? 'on' : ''}"></button>`).join('')}<input type="color" data-f="color" value="${idt.color}"></div></div>
          <div class="field"><label><span>Symbole national</span></label><div class="sym-row">${SYMBOLS.map((s) => `<button data-sym="${s}" class="${s === idt.symbol ? 'on' : ''}">${icon(s)}</button>`).join('')}</div></div>
        </div>
        <div>
          <div class="field"><label><span>Drapeau</span></label>
            <label class="check"><input type="checkbox" data-f="customFlag" ${idt.flag ? 'checked' : ''}><span>Drapeau personnalisé</span></label>
            <div class="seg wrap ${idt.flag ? '' : 'disabled'}" data-flaglayout>${FLAG_LAYOUTS.map(([v, l]) => `<button data-v="${v}" class="${v === fl.layout ? 'on' : ''}">${l}</button>`).join('')}</div>
            <div class="nc-colors"><input type="color" data-fc="0" value="${fl.colors[0]}"><input type="color" data-fc="1" value="${fl.colors[1] || '#ffffff'}"><input type="color" data-fc="2" value="${fl.colors[2] || '#000000'}"><canvas width="72" height="48" data-flagcv></canvas></div>
          </div>
          <div class="field"><label><span>Noms des régions</span></label><div class="reg-grid">${REGION_DIRS.map(([k, l]) => `<input type="text" data-reg="${k}" maxlength="24" placeholder="${l}" value="${esc(idt.regions[k] || '')}">`).join('')}</div><small class="hint">Utilisés pour nommer les zones dans les rapports de guerre.</small></div>
        </div>
      </div>
      <div class="row"><span class="grow"></span><button class="btn primary sm" data-apply>${icon('check')}<span>Appliquer</span></button></div>`;
    const draw = () => { const cv = box.querySelector('[data-flagcv]'); const ctx = cv.getContext('2d'); ctx.clearRect(0, 0, 72, 48); if (idt.flag) drawCustomFlag(ctx, idt.flag, 0, 0, 72, 48); else { ctx.fillStyle = '#222'; ctx.fillRect(0, 0, 72, 48); ctx.fillStyle = '#888'; ctx.font = '10px Inter'; ctx.fillText('officiel', 18, 28); } };
    box.querySelectorAll('input[type=text]').forEach((inp) => inp.addEventListener('keydown', (e) => e.stopPropagation()));
    box.querySelectorAll('[data-f]').forEach((inp) => inp.addEventListener('input', () => {
      const f = inp.dataset.f;
      if (f === 'customFlag') { idt.flag = inp.checked ? { layout: fl.layout, colors: [...fl.colors] } : null; box.querySelector('[data-flaglayout]').classList.toggle('disabled', !inp.checked); draw(); return; }
      idt[f] = inp.value;
    }));
    box.querySelectorAll('[data-c]').forEach((b) => b.addEventListener('click', () => { idt.color = b.dataset.c; box.querySelector('[data-f=color]').value = b.dataset.c; box.querySelectorAll('[data-c]').forEach((x) => x.classList.toggle('on', x === b)); }));
    box.querySelectorAll('[data-sym]').forEach((b) => b.addEventListener('click', () => { idt.symbol = b.dataset.sym; box.querySelectorAll('[data-sym]').forEach((x) => x.classList.toggle('on', x === b)); }));
    box.querySelectorAll('[data-flaglayout] button').forEach((b) => b.addEventListener('click', () => { fl.layout = b.dataset.v; box.querySelectorAll('[data-flaglayout] button').forEach((x) => x.classList.toggle('on', x === b)); if (idt.flag) idt.flag = { layout: fl.layout, colors: [...fl.colors] }; draw(); }));
    box.querySelectorAll('[data-fc]').forEach((inp) => inp.addEventListener('input', () => { fl.colors[Number(inp.dataset.fc)] = inp.value; if (idt.flag) idt.flag = { layout: fl.layout, colors: [...fl.colors] }; draw(); }));
    box.querySelectorAll('[data-reg]').forEach((inp) => inp.addEventListener('input', () => { idt.regions[inp.dataset.reg] = inp.value.trim(); }));
    box.querySelector('[data-apply]').onclick = () => { idt.name = idt.name.trim() || this.ent(idt.e).name; onChange(); };
    draw();
    void preview;
  }
  // applique une identité à l'entité (sauvegarde des valeurs d'origine pour les restaurer en fin de partie)
  _applyIdentity(idt) {
    const ent = this.ent(idt.e);
    if (!ent) return;
    if (!this.backup || this.backup.e !== idt.e) this.backup = { e: idt.e, name: ent.name, shortName: ent.shortName, capital: ent.capital ? ent.capital.name : null, colorOverride: ent.colorOverride, customFlag: ent.customFlag, symbol: ent.symbol, regionNames: ent.regionNames };
    ent.name = idt.name || ent.name;
    ent.shortName = idt.shortName;
    if (ent.capital && idt.capital) ent.capital = { ...ent.capital, name: idt.capital };
    ent.colorOverride = idt.color && idt.color !== this.app.renderer.mapColor[ent.index] ? idt.color : ent.colorOverride;
    if (idt.color) ent.colorOverride = idt.color;
    ent.customFlag = idt.flag || undefined;
    ent.symbol = idt.symbol;
    ent.regionNames = Object.values(idt.regions || {}).some(Boolean) ? { ...idt.regions } : undefined;
    const sim = this.sim;
    if (sim) { const sd = sim.sides.find((s) => s.e === ent.index); if (sd) sd.name = ent.name; this.app.refreshParams(); this.app.labels.clear(); }
  }
  _restoreIdentity() {
    const b = this.backup;
    if (!b) return;
    const ent = this.ent(b.e);
    if (ent) {
      ent.name = b.name; ent.shortName = b.shortName; if (ent.capital && b.capital) ent.capital = { ...ent.capital, name: b.capital };
      ent.colorOverride = b.colorOverride; ent.customFlag = b.customFlag; ent.symbol = b.symbol; ent.regionNames = b.regionNames;
    }
    this.backup = null;
  }

  // lancement de la partie
  start() {
    const app = this.app;
    const sel = this.sel;
    if (sel < 0) return;
    const list = this._candidates();
    const player = list.findIndex((e) => e.index === sel);
    if (player < 0) return;
    const ent = this.ent(sel);
    const setup = {
      participants: list.map((e, k) => ({ e: e.index, team: k })),
      teams: list.map((e) => ({ name: e.name, color: e.color })),
      options: {
        seed: randomSeedString(), maxAgents: 1100, eventRate: (DIFFICULTY_BY_ID[this.difficulty] || DIFFICULTY_BY_ID.normal).eventRate, decisionRate: (DIFFICULTY_BY_ID[this.difficulty] || DIFFICULTY_BY_ID.normal).decisionRate, difficulty: this.difficulty, randomness: 0.5, maxDuration: 1e9, peaceEnd: 1e9, victoryRatio: 0.35, naval: true, speed: 1,
        start: 'world', neutralCapture: false, warStart: 'tensions', aiWars: true, maxWarsPerYear: 2, warEnd: { ...(this.warEnd || NATION_WAR_END) },
        startDay: this._startDay(), nation: { player, scenario: this.scenario ? this.scenario.id : null, scenarioSpec: this.scenarioSpec || null, realWorld: !app.world.terrain },
        mode: this.scenario ? 'story' : 'nation', rules: { ...(this.rules || {}) }, lockedRules: this.scenario ? { ...(this.scenario.rules || {}) } : {},
      },
      label: this.scenario ? this.scenario.title : (this.identity && this.identity.e === sel ? this.identity.name : ent.name),
      mode: 'nation',
      identity: this.identity && this.identity.e === sel ? this.identity : null,
    };
    show('nationPick', false);
    app.launch(setup, null);
  }

  // ======================= EN PARTIE =======================
  begin(sim, setup) {
    this.active = true;
    if (setup.identity && (!this.backup || this.backup.e !== setup.identity.e)) this._applyIdentity(setup.identity);
    document.body.classList.add('nation-on');
    this.app.hud.setSpeedSet(NATION_SPEEDS);
    this.app.setSpeed(setup.options.speed && NATION_SPEEDS.includes(setup.options.speed) ? setup.options.speed : 1);
    this.app.hud.rankCollapsed = true;
    $('ranking').classList.add('collapsed');
    this.seenOffers = new Set();
    this.lastDecision = null;
    this.endShown = false;
    show('nationBar');
    this._bar(true);
    this._goals();
    const sd = sim.sides[sim.nv.player];
    setTimeout(() => { if (this.sim === sim && sd.capital >= 0) { this.app.session.setCamMode('libre'); this.app.hud.setCam('libre'); this.app.session.flyToCell(sd.capital, Math.min(2.2, 1.25 + Math.sqrt(sd.cells) * 0.004), 1.6); } }, 400);
    this.app.selectEntity(-1);
  }
  end() {
    if (!this.active) { this._restoreIdentity(); return; }
    this.active = false;
    document.body.classList.remove('nation-on');
    for (const id of ['nationBar', 'nationPanel', 'nationGoals', 'diploDialog', 'nationDecision', 'nationOffers', 'scenarioEnd']) show(id, false);
    this.app.hud.setSpeedSet(null);
    this.app.hud.rankCollapsed = false;
    $('ranking').classList.remove('collapsed');
    this._restoreIdentity();
  }
  // événements de la simulation (décisions, propositions, fin de scénario)
  onEvent(e) {
    if (!this.active || !e.nation) return;
    if (e.decision && this.autoPause) { this.app.pauseForOverlay(); this.openDecision(); }
    else if (e.offer && this.autoPause && e.urgent && !isShown('diploDialog')) { this.app.pauseForOverlay(); this.openOffers(); }
    else if (e.scenarioEnd) { this.app.pauseForOverlay(); this.openScenarioEnd(); }
  }
  update(sim) {
    if (!this.active || !sim.nv) return;
    this._bar();
    const now = performance.now();
    if (isShown('nationPanel') && !this.busy && now - (this._panelAt || 0) > 1200) this._renderTab(true);
    if (now - (this._goalsAt || 0) > 1000) { this._goalsAt = now; this._goals(); }
  }

  // ---------- barre nationale ----------
  _bar(full = false) {
    const sim = this.sim, n = sim.nv, sd = sim.sides[n.player], ent = this.ent(sd.e);
    const el = $('nationBar');
    if (full || !el.dataset.ready) {
      el.dataset.ready = '1';
      el.innerHTML = `
        <button class="nb-id" id="nbId" title="Gestion du pays">${flagImg(ent, 'flag md')}<div><b id="nbName"></b><small id="nbSub"></small></div></button>
        <div class="nb-date"><small>Année</small><b id="nbYear"></b><span id="nbDate"></span></div>
        <div class="nb-kpis" id="nbKpis"></div>
        <div class="nb-btns">
          <button class="btn ghost sm" data-open="home" title="Tableau de bord du pays (P)">${icon('sliders-horizontal')}<span>Gérer le pays</span></button>
          <button class="btn ghost sm icon nb-badge" id="nbOffers" title="Propositions diplomatiques">${icon('message-square')}<i></i></button>
          <button class="btn ghost sm icon nb-badge" id="nbDecision" title="Décision en attente">${icon('scale')}<i></i></button>
          <button class="btn ghost sm icon ${this.autoPause ? 'on' : ''}" id="nbAuto" title="Pause automatique sur les décisions et propositions">${icon('pause')}</button>
        </div>`;
      $('nbId').onclick = () => this.openPanel('home');
      el.querySelectorAll('[data-open]').forEach((b) => { b.onclick = () => this.openPanel(b.dataset.open); });
      $('nbOffers').onclick = () => this.openOffers();
      $('nbDecision').onclick = () => this.openDecision();
      $('nbAuto').onclick = () => { this.autoPause = !this.autoPause; $('nbAuto').classList.toggle('on', this.autoPause); notice(this.autoPause ? 'Pause automatique activée pour les décisions et propositions.' : 'Pause automatique désactivée.'); };
    }
    const dp = dateParts(sim.time, sim.cfg.startDay);
    $('nbName').innerHTML = `${ent.symbol ? icon(ent.symbol) : ''}${esc(ent.name)}`;
    $('nbSub').textContent = sim.isAtWar(n.player) ? 'En guerre' : n.scenario ? (n.scenario.status === 'running' ? 'Mode histoire' : 'Scénario terminé') : 'En paix';
    $('nbSub').className = sim.isAtWar(n.player) ? 'down' : '';
    $('nbYear').textContent = dp.y;
    $('nbDate').textContent = fmtDate(sim.time, sim.cfg.startDay);
    const growth = sd.growthRate || 0;
    $('nbKpis').innerHTML = [
      ['PIB', fmtBn(sd.eco.gdp), `${growth >= 0 ? '+' : ''}${num(growth * 100)} %`, growth >= 0 ? 'up' : 'down'],
      ['Trésorerie', fmtBn(sd.money), `dette ${Math.round(sd.debt / Math.max(0.1, sd.eco.gdp) * 100)} %`, sd.debt / Math.max(0.1, sd.eco.gdp) > 1 ? 'down' : ''],
      ['Population', `${num(sd.pop / 1e6)} M`, `${num(sd.p.popGrowth, 2)} %/an`, ''],
      ['Stabilité', `${Math.round(sd.stability * 100)} %`, sd.unemp !== undefined ? `chômage ${num(sd.unemp)} %` : '', sd.stability < 0.45 ? 'down' : ''],
      ['Personnel', fmtInt(landTotal(sd) * 1000), `${sd.agents.length} groupes`, ''],
    ].map(([l, v, s, c]) => `<div><small>${l}</small><b>${v}</b><span class="${c}">${s}</span></div>`).join('');
    const no = n.offers.length;
    $('nbOffers').classList.toggle('hidden', sim.rules.negotiations === false && !no);
    $('nbDecision').classList.toggle('hidden', sim.rules.decisions === false);
    $('nbOffers').classList.toggle('hot', no > 0); $('nbOffers').querySelector('i').textContent = no ? String(no) : '';
    $('nbDecision').classList.toggle('hot', !!n.decision); $('nbDecision').querySelector('i').textContent = n.decision ? '!' : '';
  }

  // ---------- objectifs (mode histoire) ----------
  _goals() {
    const sim = this.sim, n = sim && sim.nv;
    if (!n || !n.scenario) { show('nationGoals', false); return; }
    const sc = findScenario(n.scenario.id, sim.cfg.nation.scenarioSpec);
    if (!sc) return;
    const st = n.scenario;
    const yrs = (sim.time - (st.start || 0)) / YEAR_SEC;
    $('nationGoals').innerHTML = `<div class="panel-title"><span>${icon(sc.icon)} ${esc(sc.title)}</span><small>${st.status === 'running' ? `${Math.max(0, sc.years - yrs).toFixed(1).replace('.', ',')} an(s) restant(s)` : 'Terminé'}</small></div>
      <ul>${sc.objectives.map((o) => this._objLine(o, st)).join('')}</ul>`;
    show('nationGoals');
  }

  // ======================= GESTION DU PAYS =======================
  openPanel(tab = this.tab) {
    if (tab === 'dev' && this.sim && this.sim.rules.techTree === false) tab = 'tech';
    if (!this.sim || !this.sim.nv) return;
    this.tab = tab;
    const n = this.sim.nv;
    const R = this.sim.rules;
    const tabs = TABS.filter(([k]) => (k !== 'goals' || n.scenario) && (k !== 'dev' || R.techTree !== false));
    if (!tabs.some(([k]) => k === tab)) tab = this.tab = 'home';
    $('nmTabs').innerHTML = tabs.map(([k, l, ic]) => `<button data-tab="${k}" class="${k === tab ? 'on' : ''}">${icon(ic)}<span>${l}</span></button>`).join('');
    const sd = this.sim.sides[n.player], ent = this.ent(sd.e);
    $('nmTitle').innerHTML = `${flagImg(ent, 'flag md')}<div><small class="eyebrow">Gestion du pays</small><b>${esc(ent.name)}</b></div>`;
    $('nationPanel').classList.toggle('wide', tab === 'dev');          // l'arbre technologique a besoin de place
    show('nationPanel');
    this._renderTab(false);
  }
  closePanel() { show('nationPanel', false); }
  _renderTab(refresh) {
    this._panelAt = performance.now();
    const body = $('nmBody');
    const sim = this.sim;
    if (!sim || !sim.nv) return;
    const sc = body.scrollTop;
    const f = { home: this._tHome, advisor: this._tAdvisor, eco: this._tEco, pop: this._tPop, infra: this._tInfra, tech: this._tTech, def: this._tDef, diplo: this._tDiplo, dev: this._tDev, time: this._tTime, id: this._tId, goals: this._tGoals }[this.tab];
    if (!f) return;
    if (refresh && (this.tab === 'id')) return;
    if (refresh && this.tab === 'diplo' && document.activeElement && document.activeElement.id === 'dpSearch') return;
    body.innerHTML = f.call(this, sim, sim.nv, sim.sides[sim.nv.player]);
    if (refresh) body.scrollTop = sc;
    this._bindTab(body);
  }
  _kv(l, v, cls = '') { return `<div class="kv ${cls}"><span>${l}</span><b>${v}</b></div>`; }
  _meter(l, v, col = 'var(--accent)', max = 100, txt = null) { return `<div class="kv meter-row"><span>${l}</span><b>${txt ?? Math.round(v)}</b><div class="meter"><i style="width:${clamp(v / max * 100, 0, 100).toFixed(1)}%;background:${col}"></i></div></div>`; }
  _kpis(list) { return `<div class="nm-kpis">${list.map(([l, v, s, c]) => `<div><small>${l}</small><b>${v}</b>${s ? `<span class="${c || ''}">${s}</span>` : ''}</div>`).join('')}</div>`; }
  _slider(key, label, min, max, step, val, fmt, hint) {
    return `<div class="field pol"><label><span>${label}</span><output data-out="${key}">${fmt(val)}</output></label><input type="range" data-pol="${key}" min="${min}" max="${max}" step="${step}" value="${val}" data-fmt="${key}"><small class="hint">${hint}</small></div>`;
  }
  _chart(id, h = 120) { return `<canvas class="nm-chart" data-chart="${id}" height="${h}"></canvas>`; }

  _tHome(sim, n, sd) { return dashboardHtml(this, sim, n, sd); }
  _tAdvisor(sim, n) { return advisorHtml(this, sim, n); }
  _tEco(sim, n, sd) {
    const e = sd.eco, p = sd.p, pol = n.policy;
    const tot = Math.max(1e-6, (e.civil || 0) + e.upkeep + (e.interest || 0) + (e.ops || 0) + (e.research || 0) + (e.infra || 0) + (e.econ || 0));
    const projects = Object.values(sd.dev.active).reduce((s, a) => s + (a.stalled ? 0 : a.monthly * 12), 0);
    const deals = Object.entries(n.deals).filter(([k, d]) => d.trade && k.split('-').map(Number).includes(n.player)).length;
    const invT = pol.invest.research + pol.invest.infra + pol.invest.econ || 1;
    return this._kpis([
      ['PIB', fmtBn(e.gdp), `${(sd.growthRate || 0) >= 0 ? '+' : ''}${num((sd.growthRate || 0) * 100)} % sur un an`, (sd.growthRate || 0) >= 0 ? 'up' : 'down'],
      ['PIB par habitant', usd(sd.pc * 1000), ''],
      ['Solde budgétaire', fmtBn(e.balance), `${num(e.balance / Math.max(0.1, e.gdp) * 100)} % du PIB`, e.balance < 0 ? 'down' : 'up'],
      ['Dette', fmtBn(sd.debt), `${Math.round(sd.debt / Math.max(0.1, e.gdp) * 100)} % du PIB`, sd.debt / Math.max(0.1, e.gdp) > 1 ? 'down' : ''],
    ]) + this._chart('gdp') + `
      <div class="nm-cols"><div>
        <h4>Budget de l'État</h4>
        ${this._kv('Revenus (recettes fiscales)', fmtBn(e.income) + ' / an')}${this._kv('Dépenses', fmtBn(e.expenses) + ' / an')}${this._kv('Trésorerie', fmtBn(sd.money))}${this._kv('Intérêts de la dette', fmtBn(e.interest || 0) + ' / an')}
        ${this._kv('Projets de développement', fmtBn(projects) + ' / an', projects > e.income * 0.15 ? 'neg' : '')}
        <small class="eyebrow">Répartition des dépenses</small>
        ${[['Administration et services', e.civil || 0, '#7c8aa5'], ['Défense (entretien)', e.upkeep, '#ff7a6b'], ['Opérations militaires', e.ops || 0, '#f0a35a'], ['Intérêts', e.interest || 0, '#b48cff'], ['Recherche', e.research || 0, '#6ea8ff'], ['Infrastructures', e.infra || 0, '#5fd3c6'], ['Économie', e.econ || 0, '#8fd694']].map(([l, v, c]) => `<div class="cp-bar"><span>${l}</span><b>${fmtBn(v)}</b><div class="meter"><i style="width:${(v / tot * 100).toFixed(1)}%;background:${c}"></i></div></div>`).join('')}
      </div><div>
        <h4>Production et commerce</h4>
        ${this._meter('Production industrielle', p.production, '#f0a35a')}${this._meter('Efficacité', p.efficiency, '#8fd694')}${this._meter('Ouverture commerciale', p.trade, '#6ea8ff')}
        ${this._kv('Partenaires commerciaux', `${sd.tradePartners.length} (${deals} accord${deals > 1 ? 's' : ''})`)}${this._kv('Gains du commerce', '+' + fmtBn(e.trade || 0) + ' / an')}
        ${sd.blockade > 0.005 ? this._kv('Blocus naval', `−${Math.round(sd.blockade * 100)} %`, 'neg') : ''}
        ${this._kv('Investissements', fmtBn((e.research || 0) + (e.infra || 0) + (e.econ || 0)) + ' / an')}
        ${sd.crisis ? '<p class="cp-alert">Crise économique en cours.</p>' : ''}
      </div></div>
      <h4>Politique économique</h4>
      <div class="nm-cols"><div>
        ${this._slider('tax', 'Niveau des impôts', 0.6, 1.5, 0.02, pol.tax, (v) => `${Math.round(v * 100)} %`, 'Plus d\'impôts : plus de recettes, mais moins de croissance et de stabilité.')}
        ${this._slider('services', 'Services publics', 0.6, 1.4, 0.02, pol.services, (v) => `${Math.round(v * 100)} %`, 'Des services généreux soutiennent la stabilité et la croissance, mais coûtent cher.')}
      </div><div>
        <small class="eyebrow">Orientation des investissements</small>
        ${this._slider('inv-research', 'Recherche', 0, 1, 0.05, pol.invest.research / invT, (v) => pctS(v, 0), 'Technologie et productivité.')}
        ${this._slider('inv-infra', 'Infrastructures', 0, 1, 0.05, pol.invest.infra / invT, (v) => pctS(v, 0), 'Routes, rail, aéroports.')}
        ${this._slider('inv-econ', 'Économie', 0, 1, 0.05, pol.invest.econ / invT, (v) => pctS(v, 0), 'Croissance directe du PIB.')}
      </div></div>`;
  }
  _tPop(sim, n, sd) {
    const pol = n.policy, p = sd.p;
    const tl = n.timeline;
    const first = tl[0];
    return this._kpis([
      ['Population', fmtInt(sd.pop), first ? `${sd.pop >= first.pop ? '+' : '−'}${num(Math.abs(sd.pop - first.pop) / 1e6)} M depuis ${first.year}` : ''],
      ['Croissance', `${num(p.popGrowth, 2)} % / an`, p.popGrowth < 0 ? 'en baisse' : '', p.popGrowth < 0 ? 'down' : 'up'],
      ['Chômage', `${num(sd.unemp || 0)} %`, '', (sd.unemp || 0) > 10 ? 'down' : ''],
      ['Niveau de vie', `${sd.living || 0} / 100`, ''],
    ]) + this._chart('pop') + `
      <div class="nm-cols"><div>
        <h4>Démographie</h4>
        ${this._kv('Population active (estimation)', fmtInt(sd.pop * 0.47))}${this._kv('Emplois occupés (estimation)', fmtInt(sd.pop * 0.47 * (1 - (sd.unemp || 6) / 100)))}
        ${this._kv('Réserves mobilisables', fmtInt(sd.manpower * 1000))}
        ${this._kv('Source de départ', 'Banque mondiale (population, croissance 5 ans)')}
        ${this._slider('family', 'Politique familiale et migratoire', -1, 1, 0.1, pol.family, (v) => `${v > 0 ? '+' : ''}${num(v * 0.35, 2)} pt/an`, 'Influence la croissance démographique (natalité, accueil de travailleurs).')}
      </div><div>
        <h4>Société</h4>
        ${this._meter('Stabilité', sd.stability * 100, '#f0c35a')}${this._meter('Cohésion nationale', p.politics.cohesion, '#8fd694')}${this._meter('Confiance dans l\'État', p.politics.trust, '#6ea8ff')}${this._meter('Administration', p.politics.admin, '#b48cff')}
        ${this._meter('Niveau de vie', sd.living || 0, '#5fd3c6')}
      </div></div>`;
  }
  _tInfra(sim, n, sd) {
    const p = sd.p, e = sd.eco;
    return this._kpis([
      ['Niveau global', `${Math.round((p.infra.roads + p.infra.rail + p.infra.ports * 0.5 + p.infra.airports * 0.5 + p.infra.cities) / 4)} / 100`, ''],
      ['Investissement', fmtBn(e.infra || 0) + ' / an', ''],
      ['Vitesse des transports', `×${num(sd.speedK, 2)}`, ''],
      ['Ravitaillement', `${Math.round(sd.supplyLvl * 100)} %`, ''],
    ]) + `<div class="nm-cols"><div><h4>Réseaux</h4>
      ${this._meter('Routes', p.infra.roads, '#5fd3c6')}${this._meter('Rail (transports)', p.infra.rail, '#6ea8ff')}${this._meter('Ports', p.infra.ports, '#3f7df3')}${this._meter('Aéroports', p.infra.airports, '#b48cff')}${this._meter('Villes', p.infra.cities, '#f0c35a')}
      ${sd.infraDamage > 0.01 ? this._kv('Dégâts à réparer', `${Math.round(sd.infraDamage * 100)} %`, 'neg') : ''}
      </div><div><h4>Projets</h4>${this._branchList(n, sd, 'infra')}<p class="hint">Les infrastructures accélèrent les déplacements des armées, le ravitaillement et la croissance.</p></div></div>`;
  }
  _tTech(sim, n, sd) {
    if (sim.rules.technology === false) return '<p class="nm-off">La technologie est désactivée dans les règles de cette partie : le niveau technologique reste celui du départ.</p>';
    const p = sd.p, e = sd.eco;
    return this._kpis([
      ['Niveau technologique', num(p.tech), ''],
      ['Recherche', `${Math.round(p.research)} / 100`, ''],
      ['Innovation', `+${Math.round((sd.devResearch || 0) * 100)} %`, 'rendement de la recherche'],
      ['Budget R&D', fmtBn(e.research || 0) + ' / an', ''],
    ]) + this._chart('tech') + `<div class="nm-cols"><div><h4>Technologie</h4>${this._branchList(n, sd, 'tech')}</div><div><h4>Éducation</h4>${this._branchList(n, sd, 'edu')}</div></div>
      <p class="hint">La technologie améliore la productivité (PIB), la qualité des armées et l'équipement. Orientez les investissements vers la recherche dans l'onglet Économie.</p>`;
  }
  _branchList(n, sd, branch) {
    return DEV_TREE.filter((x) => x.branch === branch).map((x) => {
      const done = sd.dev.done.includes(x.id), act = sd.dev.active[branch] && sd.dev.active[branch].id === x.id ? sd.dev.active[branch] : null;
      return `<div class="br-row ${done ? 'done' : act ? 'act' : n.canStart(n.player, x.id) ? 'avail' : 'locked'}">${icon(done ? 'circle-check' : act ? 'hourglass' : 'circle-dot')}<span>${esc(x.name)}</span><small>${done ? 'Achevé' : act ? `${Math.round(act.done / act.months * 100)} %` : n.canStart(n.player, x.id) ? 'Disponible' : 'Verrouillé'}</small></div>`;
    }).join('') + `<button class="btn ghost xs" data-goto="dev" data-cat="civil">${icon('network')}<span>Arbre technologique</span></button>`;
  }
  _tDef(sim, n, sd) {
    const pol = n.policy;
    const wars = sim.activeWars.filter((w) => w.status === 'active' && (w.a.includes(n.player) || w.b.includes(n.player)));
    const first = n.timeline[0];
    return `<div class="nm-big"><div><small>Personnel</small><b>${fmtInt(landTotal(sd) * 1000)}</b>${first ? `<span class="${landTotal(sd) * 1000 >= first.soldiers ? 'up' : 'down'}">${landTotal(sd) * 1000 >= first.soldiers ? '+' : '−'}${fmtInt(Math.abs(landTotal(sd) * 1000 - first.soldiers))} depuis ${first.year}</span>` : ''}</div>
        <div><small>Groupes</small><b>${sd.agents.length}</b><span>sur la carte</span></div>
        <div><small>Budget de défense</small><b>${fmtBn(sd.eco.upkeep)}</b><span>${num(sd.eco.upkeep / Math.max(0.1, sd.eco.gdp) * 100, 2)} % du PIB</span></div></div>
      ${this._chart('army')}
      <div class="nm-cols"><div>
        <h4>Organisation</h4>
        ${this._slider('milPct', 'Budget militaire visé', 0, 12, 0.1, pol.milPct, (v) => `${num(v, 1)} % du PIB`, 'Le recrutement et l\'entretien suivent ce budget ; l\'argent est pris sur les autres dépenses.')}
        <div class="field"><label><span>Posture militaire</span></label><div class="seg" data-stance>${[['offensive', 'Offensive'], ['balanced', 'Équilibrée'], ['defensive', 'Défensive']].map(([v, l]) => `<button data-v="${v}" class="${pol.stance === v ? 'on' : ''}">${l}</button>`).join('')}</div><small class="hint">En guerre : offensives sur les fronts favorables, équilibre, ou défense et fortifications.</small></div>
        ${this._meter('Préparation', sd.readiness * 100, '#8fd694')}${this._meter('Moral', sd.morale * 100, '#f0c35a', 125)}${this._meter('Qualité', sd.q * 100, '#6ea8ff', 100)}${this._meter('Lassitude de guerre', sd.exhaustion * 100, '#ff7a6b')}
      </div><div>
        <h4>Capacités</h4>
        ${[['inf', '#a7b0bf'], ['arm', '#f0a35a'], ['art', '#ff7a6b'], ['rec', '#5fd3c6']].map(([t, c]) => this._meter(UNIT_LABELS[t], sd.army[t], c, Math.max(sd.army.inf, 1), fmtInt(sd.army[t] * 1000))).join('')}
        ${this._meter(UNIT_LABELS.air, sd.air, '#6ea8ff', Math.max(sd.air, sd.initialAir, 1), num(sd.air) + ' gr.')}${this._meter(UNIT_LABELS.navy, sd.navy, '#3f7df3', Math.max(sd.navy, sd.initialNavy, 1), num(sd.navy) + ' gr.')}
        ${this._kv('Réserves mobilisables', fmtInt(sd.manpower * 1000))}${this._kv('Pertes cumulées', fmtInt((sd.lossesTotal || 0) * 1000))}${this._kv('Puissance (indice)', Math.round(powerOf(sd)))}
        ${this._kv('Fortifications', `+${Math.round((sd.devFort || 0) * 100)} %`)}${this._kv('Attaque / défense (technologies)', `${Math.round(((sd.techAtk || 1) - 1) * 100)} % / ${Math.round(((sd.techDef || 1) - 1) * 100)} %`)}${this._kv('Défense aérienne', `${Math.round((sd.airDef || 0) * 100)} %`)}${this._kv('Renseignement', `${Math.round((sd.intel || 0) * 100)} %`)}
        <button class="btn ghost xs" data-goto="dev" data-cat="mil">${icon('network')}<span>Arbre militaire</span></button>
      </div></div>
      <h4>Conflits</h4>${wars.length ? wars.map((w) => `<div class="war-row" data-war="${w.id}">${icon('swords')}<span>${esc(w.name)}</span><small>${fmtDate(w.start, sim.cfg.startDay, true)}</small><button class="btn ghost xs">Rapport</button></div>`).join('') : '<p class="hint">Aucune guerre en cours.</p>'}`;
  }
  _tDiplo(sim, n, sd) {
    if (sim.rules.diplomacy === false) return '<p class="nm-off">La diplomatie est désactivée dans les règles de cette partie : pas de relations, de traités, d\'alliances ni de négociations. Les guerres se terminent uniquement par les armes.</p>';
    const S = sim.S, k = n.player;
    const f = this.dFilter || 'near';
    const q = (this.dQuery || '').toLowerCase();
    let rows = sim.sides.map((o, i) => ({ o, i })).filter(({ o, i }) => i !== k && !o.eliminated);
    rows = rows.map((r) => ({ ...r, rel: sim.rel[k * S + r.i], st: relationStatus(sim, k, r.i), near: sim.contact[k * S + r.i] > 0 || sim.nearCap[k * S + r.i], deal: n.deal(k, r.i) || {} }));
    if (q) rows = rows.filter((r) => r.o.name.toLowerCase().includes(q));
    else if (f === 'near') rows = rows.filter((r) => r.near || r.st === 'war' || r.st === 'ally');
    else if (f === 'part') rows = rows.filter((r) => r.st === 'ally' || r.deal.trade || r.rel > 30);
    else if (f === 'riv') rows = rows.filter((r) => r.st === 'war' || r.rel < -25);
    else if (f === 'pow') rows = rows.sort((a, b) => powerOf(b.o) - powerOf(a.o)).slice(0, 25);
    if (f !== 'pow') rows.sort((a, b) => (b.st === 'war') - (a.st === 'war') || (b.st === 'ally') - (a.st === 'ally') || b.rel - a.rel);
    const allies = sim.sides.filter((o, i) => i !== k && sim.allied[k * S + i]).length;
    const trade = Object.entries(n.deals).filter(([key, d]) => d.trade && key.split('-').map(Number).includes(k)).length;
    const nap = Object.entries(n.deals).filter(([key, d]) => d.nap > sim.time && key.split('-').map(Number).includes(k)).length;
    return this._kpis([['Alliés', String(allies), ''], ['Accords commerciaux', String(trade), ''], ['Pactes de non-agression', String(nap), ''], ['Propositions reçues', String(n.offers.length), n.offers.length ? 'à traiter' : '', n.offers.length ? 'up' : '']]) + `
      <div class="row dp-tools"><div class="seg" data-dfilter>${[['near', 'Voisins et liens'], ['part', 'Partenaires'], ['riv', 'Rivaux'], ['pow', 'Puissances'], ['all', 'Tous']].map(([v, l]) => `<button data-v="${v}" class="${f === v ? 'on' : ''}">${l}</button>`).join('')}</div>
      <div class="search grow"><i>${icon('search')}</i><input type="text" id="dpSearch" placeholder="Rechercher…" value="${esc(this.dQuery || '')}" spellcheck="false"></div></div>
      <div class="dp-list">${rows.slice(0, 80).map(({ o, i, rel, st, deal }) => `<button class="dp-row rel-${st}" data-diplo="${i}">${flagImg(this.ent(o.e), 'flag sm')}<span class="nm">${esc(o.name)}</span>
        <small>${REL_LABELS[st]}${deal.trade ? ' · commerce' : ''}${deal.nap > sim.time ? ' · non-agression' : ''}</small><span class="relbar"><i style="left:${50 + rel / 2}%"></i></span><b class="${rel >= 0 ? 'up' : 'down'}">${rel > 0 ? '+' : ''}${Math.round(rel)}</b></button>`).join('') || '<p class="hint">Aucun pays.</p>'}</div>
      <p class="hint">Sélectionnez un pays pour ouvrir sa fiche et lui faire une proposition. L'IA analyse vos relations, l'économie, ses intérêts, la situation internationale et les risques, et se souvient de vos échanges.</p>`;
  }
  _tDev(sim, n, sd) {
    const k = n.player;
    const committed = Object.values(sd.dev.active).reduce((s2, a) => s2 + a.monthly * 12, 0);
    const cat = this.devCat || 'civil';
    const branches = TECH_BRANCHES.filter((b) => b.cat === cat && n.branchAllowed(b.id));
    if (!branches.length) return '<p class="nm-off">Cet arbre est désactivé dans les règles de cette partie.</p>';
    if (!this.devBranch || !branches.some((b) => b.id === this.devBranch)) this.devBranch = branches[0].id;
    const br = BRANCH_BY_ID[this.devBranch];
    const specs = specsOf(sim, k);
    const stOf = (x) => {
      const done = sd.dev.done.includes(x.id);
      const act = sd.dev.active[x.branch] && sd.dev.active[x.branch].id === x.id ? sd.dev.active[x.branch] : null;
      if (done) return ['done', null];
      if (act) return ['act', act];
      if (!techOpen(sim, k, x)) return ['closed', null];
      if (n.canStart(k, x.id)) return ['avail', null];
      if (sd.dev.active[x.branch] && x.req.every((r) => sd.dev.done.includes(r))) return ['busy', null];
      return ['locked', null];
    };
    const fxTxt = (fx) => Object.entries(fx).map(([f, v]) => (FX_LABELS[f] ? FX_LABELS[f](v) : '')).filter(Boolean).join(' · ');
    const consTxt = (c) => (c ? Object.entries(c).map(([f, v]) => (CONS_TEXT[f] ? CONS_TEXT[f](v) : '')).filter(Boolean).join(' · ') : '');
    const node = (x) => {
      const [st, act] = stOf(x);
      const c = n.costOf(k, x.id);
      const req = x.req.filter((r) => DEV_BY_ID[r].branch !== x.branch).map((r) => `${DEV_BY_ID[r].name} (${BRANCH_BY_ID[DEV_BY_ID[r].branch].label.toLowerCase()})`);
      const cons = consTxt(x.cons);
      return `<button class="dv-node st-${st} ${x.spec ? 'spec' : ''}" data-dev="${x.id}">
        ${x.spec ? `<span class="dv-spec">${icon('award')}${esc(SPECIALIZATIONS[x.spec].label)}</span>` : ''}
        <b>${esc(x.name)}</b><small>${esc(x.desc)}</small>
        <span class="dv-fx">${esc(fxTxt(x.fx))}</span>
        ${cons ? `<span class="dv-cons">${icon('activity')}${esc(cons)}</span>` : ''}
        ${req.length ? `<span class="dv-req">Requiert : ${esc(req.join(', '))}</span>` : ''}
        <span class="dv-cost">${st === 'done' ? `${icon('circle-check')}Achevé` : st === 'closed' ? `${icon('lock')}Réservé à une spécialisation` : act ? `${icon('hourglass')}${Math.round(act.done / act.months * 100)} % · ${Math.max(0, act.months - act.done)} mois${act.stalled ? ' · suspendu' : ''}` : `${fmtBn(c.total)} · ${c.months} mois${c.aff > 1.01 ? ' <em class="dv-aff">spécialité</em>' : c.aff < 0.99 ? ' <em class="dv-aff bad">difficile</em>' : ''}`}</span>
        ${act ? `<div class="meter"><i style="width:${(act.done / act.months * 100).toFixed(0)}%"></i></div>` : ''}</button>`;
    };
    const list = DEV_TREE.filter((x) => x.branch === br.id);
    const tiers = Math.max(...list.map((x) => x.tier));
    const progress = (b) => { const L = DEV_TREE.filter((x) => x.branch === b.id && techOpen(sim, k, x)); return [L.filter((x) => sd.dev.done.includes(x.id)).length, L.length]; };
    const allMine = TECH_BRANCHES.filter((b) => n.branchAllowed(b.id));
    const doneAll = allMine.reduce((a2, b) => a2 + progress(b)[0], 0), totAll = allMine.reduce((a2, b) => a2 + progress(b)[1], 0);
    return `<div class="dv-top">
        <div class="seg" data-devcat>${[['civil', 'Arbre civil'], ['mil', 'Arbre militaire']].map(([v, l]) => `<button data-v="${v}" class="${cat === v ? 'on' : ''}">${l}</button>`).join('')}</div>
        <div class="dv-specs">${specs.length ? specs.map((x) => `<span class="pill spec" title="${esc(SPECIALIZATIONS[x].desc)}">${icon('award')}${esc(SPECIALIZATIONS[x].label)}</span>`).join('') : '<span class="hint">Aucune spécialisation marquée</span>'}</div>
      </div>
      <div class="dv-sum">${this._kv('Engagements en cours', `${fmtBn(committed)} / an (${Math.round(committed / Math.max(0.01, sd.eco.income) * 100)} % des recettes)`)}${this._kv('Trésorerie disponible', fmtBn(sd.money))}${this._kv('Technologies acquises', `${doneAll} / ${totAll}`)}${sd.techUpkeep ? this._kv('Entretien des technologies', `${fmtBn(sd.techUpkeep * sd.eco.gdp)} / an`) : ''}</div>
      <div class="dv-layout">
        <nav class="dv-branches">${branches.map((b) => { const [d0, t0] = progress(b); const act = sd.dev.active[b.id]; const aff = affinity(sim, k, b.id); return `<button data-devbranch="${b.id}" class="${b.id === br.id ? 'on' : ''}">${icon(b.icon)}<span>${esc(b.label)}</span>${act ? `<i class="dv-dot" title="Projet en cours">${icon('hourglass')}</i>` : ''}${aff > 1.01 ? `<i class="dv-dot spec" title="Spécialité du pays : coûts réduits">${icon('award')}</i>` : ''}<small>${d0}/${t0}</small><em style="width:${t0 ? (d0 / t0 * 100).toFixed(0) : 0}%"></em></button>`; }).join('')}</nav>
        <div class="dv-main">
          <div class="dv-bhead">${icon(br.icon)}<b>${esc(br.label)}</b><small>${affinity(sim, k, br.id) > 1.01 ? 'Spécialité de votre pays : coûts et durées réduits.' : affinity(sim, k, br.id) < 0.99 ? 'Domaine difficile pour votre pays : coûts et durées augmentés.' : 'Une seule recherche à la fois dans cette branche.'}</small></div>
          <div class="dv-tiers" style="grid-template-columns:repeat(${tiers}, minmax(150px, 1fr))">${Array.from({ length: tiers }, (_, t) => `<div class="dv-tier"><span class="dv-tl">Palier ${t + 1}</span>${list.filter((x) => x.tier === t + 1).map(node).join('') || '<div class="dv-empty"></div>'}</div>`).join('')}</div>
        </div>
      </div>
      <p class="hint">Chaque projet est payé chaque mois pendant sa durée. Les spécialisations de votre pays (géographie, économie, culture militaire) réduisent les coûts dans leurs domaines et ouvrent des technologies propres. Certaines technologies ont des conséquences : entretien permanent, inquiétude des voisins, tensions sociales.</p>`;
  }
  _tTime(sim, n, sd) {
    const tl = n.timeline;
    const y0 = tl.length ? tl[0].year : dateParts(0, sim.cfg.startDay).y;
    const ms = [...n.milestones].reverse();
    const byYear = new Map();
    for (const m of ms) { const y = dateParts(m.t, sim.cfg.startDay).y; if (!byYear.has(y)) byYear.set(y, []); byYear.get(y).push(m); }
    const last = tl[tl.length - 1] || {};
    const marks = [];
    for (let y = Math.ceil((y0 + 1) / 10) * 10; y <= Math.max(last.year || y0, y0) + 10; y += 10) marks.push(y);
    return `<div class="tl-marks">${[y0, 2030, ...marks].filter((v, i, a) => a.indexOf(v) === i && v >= y0).sort((a, b) => a - b).slice(0, 8).map((y) => `<span class="${(last.year || y0) >= y ? 'on' : ''}">${y}</span>`).join('<i></i>')}</div>
      <div class="tl-charts">${this._chart('tl-gdp', 90)}${this._chart('tl-pop', 90)}${this._chart('tl-tech', 90)}${this._chart('tl-mil', 90)}</div>
      ${tl.length > 1 ? `<table class="wr-table tl-table"><thead><tr><th>Année</th><th>PIB</th><th>Population</th><th>Technologie</th><th>Personnel</th><th>Stabilité</th><th>Rang (PIB)</th></tr></thead><tbody>${tl.slice().reverse().slice(0, 12).map((r) => `<tr><td>${r.year}</td><td>${fmtBn(r.gdp)}</td><td>${num(r.pop / 1e6)} M</td><td>${num(r.tech)}</td><td>${fmtInt(r.soldiers)}</td><td>${r.stability} %</td><td>${r.gdpRank}e</td></tr>`).join('')}</tbody></table>` : '<p class="hint">Le premier bilan annuel apparaîtra au 1er janvier.</p>'}
      <h4>Événements marquants</h4>
      <div class="tl-years">${[...byYear.entries()].slice(0, 12).map(([y, list]) => `<div class="tl-year"><b>${y}</b><ul>${list.slice(0, 14).map((m) => `<li class="ms-${m.type}">${icon(MS_ICONS[m.type] || 'activity')}<time>${fmtDate(m.t, sim.cfg.startDay, true)}</time><span>${esc(m.text)}</span></li>`).join('')}</ul></div>`).join('')}</div>`;
  }
  _tId(sim, n, sd) {
    if (!this.identity || this.identity.e !== sd.e) this.identity = this._defaultIdentity(this.ent(sd.e));
    return `<div class="id-borders"><div><b>Territoire</b><small>Redessinez vous-même les frontières de votre pays sur la carte, au crayon.</small></div><button class="btn accent sm" data-borders>${icon('pencil')}<span>Dessiner les frontières</span></button></div><div id="nmIdBox"></div><p class="hint">Le nom, la couleur et le drapeau sont appliqués immédiatement à la carte, aux rapports et aux sauvegardes de cette partie.</p>`;
  }
  _objLine(o, st, withPct = false) {
    const done = st.done && st.done[o.id];
    const pr = done ? 1 : (st.progress && st.progress[o.id]) || 0;
    const failed = st.failedObj === o.id && !done;
    const hidden = o.secret && !done;
    const txt = hidden ? 'Objectif secret : il se révélera quand vous l\'atteindrez' : esc(o.text);
    const tag = o.main ? '<em class="ob-main">principal</em>' : o.secret ? '<em class="ob-secret">secret</em>' : o.optional ? '<em>(facultatif)</em>' : '';
    return `<li class="${done ? 'done' : failed ? 'failed' : ''} ${hidden ? 'secret' : ''}">${icon(done ? 'circle-check' : failed ? 'circle-x' : hidden ? 'lock' : 'target')}<div><span>${txt} ${tag}</span>${hidden ? '' : `<div class="meter"><i style="width:${(pr * 100).toFixed(0)}%"></i></div>`}</div>${withPct && !hidden ? `<b>${Math.round(pr * 100)} %</b>` : ''}</li>`;
  }
  _tGoals(sim, n) {
    const sc = n.scenario && findScenario(n.scenario.id, sim.cfg.nation.scenarioSpec);
    if (!sc) return '<p class="hint">Aucun scénario.</p>';
    const st = n.scenario;
    const yrs = (sim.time - (st.start || 0)) / YEAR_SEC;
    return `<div class="np-scen"><b>${icon(sc.icon)}${esc(sc.title)}</b><p>${esc(sc.desc)}</p></div>
      ${this._kv('Temps écoulé', `${num(yrs)} an(s) sur ${sc.years}`)}${this._kv('État', st.status === 'running' ? 'En cours' : `Terminé — ${st.ending ? st.ending.title : ''}`)}
      <ul class="goals-list">${sc.objectives.map((o) => this._objLine(o, st, true)).join('')}</ul>
      ${sc.failTexts && sc.failTexts.length ? `<h4>Conditions d'échec</h4><ul class="fail-list">${sc.failTexts.map((t) => `<li>${icon('circle-x')}<span>${esc(t)}</span></li>`).join('')}</ul>` : ''}
      <h4>Fins possibles</h4><ul class="endings">${Object.entries(sc.endings).map(([g, e]) => `<li class="g-${g}"><b>${esc(e.title)}</b><span>${esc(e.text)}</span></li>`).join('')}</ul>`;
  }

  _bindTab(body) {
    const sim = this.sim, n = sim.nv;
    const pol = n.policy;
    body.querySelectorAll('[data-pol]').forEach((inp) => {
      const key = inp.dataset.pol;
      const out = body.querySelector(`[data-out="${key}"]`);
      const fmt = {
        tax: (v) => `${Math.round(v * 100)} %`, services: (v) => `${Math.round(v * 100)} %`, milPct: (v) => `${num(v, 1)} % du PIB`,
        family: (v) => `${v > 0 ? '+' : ''}${num(v * 0.35, 2)} pt/an`,
      }[key] || ((v) => pctS(v, 0));
      inp.addEventListener('input', () => { out.textContent = fmt(Number(inp.value)); });
      inp.addEventListener('change', () => {
        const v = Number(inp.value);
        const patch = key.startsWith('inv-') ? { invest: { [key.slice(4)]: Math.max(0.001, v) } } : { [key]: v };
        this.app.act({ op: 'policy', patch, text: `Politique : ${inp.closest('.field').querySelector('label span').textContent.toLowerCase()} → ${fmt(v)}.` });
        this.busy = false;
        this._renderTab(true);
      });
    });
    const stance = body.querySelector('[data-stance]');
    if (stance) stance.querySelectorAll('button').forEach((b) => b.addEventListener('click', () => { this.app.act({ op: 'policy', patch: { stance: b.dataset.v }, text: `Posture militaire : ${b.textContent.toLowerCase()}.` }); this._renderTab(true); }));
    body.querySelectorAll('[data-war]').forEach((el) => el.querySelector('button').addEventListener('click', () => this.app.warUI.openReport(this.app.warUI.liveWar(Number(el.dataset.war)))));
    body.querySelectorAll('[data-goto]').forEach((b) => b.addEventListener('click', () => { if (b.dataset.cat) { this.devCat = b.dataset.cat; this.devBranch = null; } this.openPanel(b.dataset.goto); }));
    const df = body.querySelector('[data-dfilter]');
    if (df) df.querySelectorAll('button').forEach((b) => b.addEventListener('click', () => { this.dFilter = b.dataset.v; this.dQuery = ''; this._renderTab(false); }));
    const ds = body.querySelector('#dpSearch');
    if (ds) ds.addEventListener('input', () => { this.dQuery = ds.value; const pos = ds.selectionStart; this._renderTab(false); const nd = $('dpSearch'); if (nd) { nd.focus(); nd.setSelectionRange(pos, pos); } });
    body.querySelectorAll('[data-diplo]').forEach((b) => b.addEventListener('click', () => this.openDiplo(Number(b.dataset.diplo))));
    body.querySelectorAll('[data-dev]').forEach((b) => b.addEventListener('click', () => this._devClick(b.dataset.dev)));
    const dc = body.querySelector('[data-devcat]');
    if (dc) dc.querySelectorAll('button').forEach((b) => b.addEventListener('click', () => { this.devCat = b.dataset.v; this.devBranch = null; this._renderTab(false); }));
    body.querySelectorAll('[data-devbranch]').forEach((b) => b.addEventListener('click', () => { this.devBranch = b.dataset.devbranch; this._renderTab(false); }));
    const bb = body.querySelector('[data-borders]');
    if (bb) bb.addEventListener('click', () => this.app.borderEditor.open());
    const idb = body.querySelector('#nmIdBox');
    if (idb) this._identityForm(idb, this.identity, () => { this._applyIdentity(this.identity); this._bar(true); this.openPanel('id'); notice('Identité mise à jour.'); });
    body.querySelectorAll('[data-dbgo]').forEach((b) => b.addEventListener('click', () => this._dbGo(b.dataset.dbgo)));
    body.querySelectorAll('[data-chart]').forEach((cv) => this._drawChart(cv, cv.dataset.chart));
  }
  // tableau de bord / conseiller : ouvre le panneau où agir
  _dbGo(target) {
    if (target === 'offers') { this.openOffers(); return; }
    if (target === 'decision') { this.openDecision(); return; }
    if (target === 'mil') { this.closePanel(); this.app.warUI.openWars(); return; }
    if (target === 'dev' && this.sim.rules.techTree === false) target = 'tech';
    this.openPanel(target);
  }
  _devClick(id) {
    const sim = this.sim, n = sim.nv, k = n.player, sd = sim.sides[k];
    const x = DEV_BY_ID[id];
    const act = sd.dev.active[x.branch];
    if (act && act.id === id) {
      if (window.confirm(`Abandonner le projet « ${x.name} » ? Les ${fmtBn(act.paid)} déjà dépensés sont perdus.`)) { n.cancelProject(k, x.branch); n.milestone('project', `Projet abandonné : ${x.name}.`); }
    } else if (n.canStart(k, id)) {
      const c = n.costOf(k, id);
      if (c.total / c.months > sd.money * 0.5 && sd.money < c.total * 0.25) notice(`Trésorerie faible : le projet sera financé par la dette (${fmtBn(c.total / c.months)} / mois).`, 3600);
      n.startProject(k, id);
    } else if (sd.dev.done.includes(id)) notice(`${x.name} : déjà achevé.`);
    else if (!techOpen(sim, k, x)) notice(`${x.name} est réservé aux pays de spécialisation « ${SPECIALIZATIONS[x.spec].label} ».`);
    else if (act) notice(`La branche est occupée par « ${DEV_BY_ID[act.id].name} ».`);
    else notice(`Prérequis : ${x.req.map((r) => DEV_BY_ID[r].name).join(', ')}.`);
    this._renderTab(true);
  }

  // ---------- graphiques ----------
  _drawChart(cv, kind) {
    const sim = this.sim, n = sim.nv, sd = sim.sides[n.player];
    const W = cv.clientWidth || 480, H = Number(cv.getAttribute('height'));
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    cv.width = W * dpr; cv.height = H * dpr; cv.style.height = H + 'px';
    const ctx = cv.getContext('2d');
    ctx.scale(dpr, dpr);
    let pts = [], label = '', col = '#6ea8ff', fmt = (v) => num(v);
    const ser = sd.series;
    const t0 = sim.cfg.startDay;
    if (kind === 'gdp') { pts = ser.map((r) => [r[0], r[2]]); label = 'PIB (Md$)'; col = '#8fd694'; fmt = (v) => fmtBn(v); }
    else if (kind === 'army') { pts = ser.map((r) => [r[0], r[4] * 1000]); label = 'Personnel militaire'; col = '#ff7a6b'; fmt = (v) => fmtInt(v); }
    else if (kind === 'tech') { pts = ser.map((r) => [r[0], r[5]]); label = 'Niveau technologique'; col = '#6ea8ff'; }
    else if (kind === 'pop') { pts = n.timeline.map((r) => [r.t, r.pop]); label = 'Population (bilans annuels)'; col = '#f0c35a'; fmt = (v) => `${num(v / 1e6)} M`; }
    else if (kind.startsWith('tl-')) {
      const key = { 'tl-gdp': 'gdp', 'tl-pop': 'pop', 'tl-tech': 'tech', 'tl-mil': 'soldiers' }[kind];
      pts = n.timeline.map((r) => [r.t, r[key]]);
      label = { gdp: 'PIB', pop: 'Population', tech: 'Technologie', soldiers: 'Personnel' }[key];
      col = { gdp: '#8fd694', pop: '#f0c35a', tech: '#6ea8ff', soldiers: '#ff7a6b' }[key];
      fmt = key === 'gdp' ? (v) => fmtBn(v) : key === 'pop' ? (v) => `${num(v / 1e6)} M` : key === 'soldiers' ? (v) => fmtInt(v) : (v) => num(v);
      if (pts.length) pts.push([sim.time, key === 'gdp' ? sd.eco.gdp : key === 'pop' ? sd.pop : key === 'tech' ? sd.p.tech : landTotal(sd) * 1000]);
    }
    ctx.fillStyle = '#a7b0bf'; ctx.font = '600 10.5px Inter, sans-serif';
    ctx.fillText(label.toUpperCase(), 8, 13);
    if (pts.length < 2) { ctx.fillStyle = '#6e7889'; ctx.font = '11px Inter, sans-serif'; ctx.fillText('Données disponibles après quelques mois.', 8, H / 2 + 4); return; }
    const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
    const x0 = Math.min(...xs), x1 = Math.max(...xs);
    let y0 = Math.min(...ys), y1 = Math.max(...ys);
    const pad = (y1 - y0) * 0.12 || Math.abs(y1) * 0.05 || 1; y0 -= pad; y1 += pad;
    const L = 8, R = W - 64, T = 22, B = H - 18;
    const X = (x) => L + (x - x0) / Math.max(1e-6, x1 - x0) * (R - L), Y = (y) => B - (y - y0) / Math.max(1e-9, y1 - y0) * (B - T);
    ctx.strokeStyle = 'rgba(255,255,255,0.06)'; ctx.lineWidth = 1;
    for (let k = 0; k <= 2; k++) { const y = T + (B - T) * k / 2; ctx.beginPath(); ctx.moveTo(L, y); ctx.lineTo(R, y); ctx.stroke(); }
    // années
    ctx.fillStyle = '#6e7889'; ctx.font = '10px Inter, sans-serif';
    const ya = dateParts(x0, t0).y, yb = dateParts(x1, t0).y;
    const step = Math.max(1, Math.ceil((yb - ya + 1) / 8));
    for (let y = ya; y <= yb; y += step) { const tt = ((y - 2025) * 365 - t0) / 3; if (tt < x0 || tt > x1) continue; const x = X(tt); ctx.fillText(String(y), x - 12, H - 4); ctx.strokeStyle = 'rgba(255,255,255,0.05)'; ctx.beginPath(); ctx.moveTo(x, T); ctx.lineTo(x, B); ctx.stroke(); }
    const grad = ctx.createLinearGradient(0, T, 0, B);
    grad.addColorStop(0, col + '55'); grad.addColorStop(1, col + '00');
    ctx.beginPath(); pts.forEach(([x, y], k) => (k ? ctx.lineTo(X(x), Y(y)) : ctx.moveTo(X(x), Y(y))));
    ctx.lineTo(X(x1), B); ctx.lineTo(X(x0), B); ctx.closePath(); ctx.fillStyle = grad; ctx.fill();
    ctx.beginPath(); pts.forEach(([x, y], k) => (k ? ctx.lineTo(X(x), Y(y)) : ctx.moveTo(X(x), Y(y))));
    ctx.strokeStyle = col; ctx.lineWidth = 1.8; ctx.stroke();
    ctx.fillStyle = '#e9edf4'; ctx.font = '600 11px Inter, sans-serif';
    const lastY = ys[ys.length - 1];
    ctx.fillText(fmt(lastY), R + 6, Y(lastY) + 4);
    ctx.fillStyle = '#6e7889'; ctx.font = '10px Inter, sans-serif';
    if (Math.abs(Y(lastY) - T) > 16) ctx.fillText(fmt(y1 - pad), R + 6, T + 8);
    if (Math.abs(Y(lastY) - B) > 16) ctx.fillText(fmt(y0 + pad), R + 6, B);
  }

  // ======================= DIPLOMATIE =======================
  openDiplo(k) {
    const sim = this.sim;
    if (!sim || !sim.nv || k === sim.nv.player || !sim.sides[k]) return;
    this.dTarget = k;
    this.app.pauseForOverlay();
    show('diploDialog');
    this._diplo();
  }
  _diplo(last = null) {
    const sim = this.sim, n = sim.nv, p = n.player, S = sim.S;
    const k = this.dTarget, B = sim.sides[k], A = sim.sides[p], ent = this.ent(B.e);
    const st = relationStatus(sim, p, k);
    const rel = sim.rel[p * S + k];
    const deal = n.deal(p, k) || {};
    const mem = n.memOf(k);
    const P = PERSONALITIES[B.ai.personality];
    const atWar = sim.atWar[p * S + k] > 0;
    const allied = sim.allied[p * S + k] === 1;
    const R = sim.rules;
    const acts = [];
    acts.push('talk');
    if (atWar) { if (R.peace !== false) acts.push('peace'); acts.push('warGoals'); }
    else {
      if (!deal.trade && R.treaties !== false && R.trade !== false && R.negotiations !== false) acts.push('trade');
      if (!(deal.nap > sim.time) && !allied && R.treaties !== false && R.negotiations !== false) acts.push('nap');
      if (!allied && R.alliances !== false && R.negotiations !== false) acts.push('alliance');
      if (R.negotiations !== false) acts.push('aid');
      if (R.relations !== false) acts.push('gift');
      if (rel < 40 && R.relations !== false && R.negotiations !== false) acts.push('detente');
      if (allied || deal.trade || deal.nap > sim.time) acts.push('cancel');
      if (R.wars !== false) acts.push('war');
    }
    // coalitions : inviter ce pays dans une de vos coalitions, ou en former une contre lui
    const coalOn = R.alliances !== false && R.coalitions !== false && R.diplomacy !== false;
    const myCoals = coalOn ? coalitionsOf(sim, p).filter((c) => !memberOf(c, k) && c.target !== k) : [];
    if (myCoals.length && !sim.allied[k * S + myCoals[0].target]) acts.push('coalInvite');
    if (coalOn && !allied && !coalitionsAgainst(sim, k).some((c) => memberOf(c, p))) acts.push('coalForm');
    if (R.diplomacy !== false && R.trade !== false) acts.push(isSanctioning(sim, p, k) ? 'unsanction' : 'sanction');
    const log = (n.logs[k] || []).slice(-30);
    const gdpAmt = Math.round(A.eco.gdp * 0.002 * 10) / 10;
    const factorsHtml = (f) => (f && f.length ? `<ul class="factors">${f.slice(0, 7).map((x) => `<li><span>${esc(x.label)}</span><b class="${x.v > 0 ? 'up' : x.v < 0 ? 'down' : ''}">${x.v > 0 ? '+' : ''}${String(x.v).replace('.', ',')}</b></li>`).join('')}</ul>` : '');
    const badge = (r) => ({ accept: '<span class="pill ok">ACCEPTÉ</span>', refuse: '<span class="pill no">REFUSÉ</span>', counter: '<span class="pill co">CONTRE-PROPOSITION</span>', offer: '<span class="pill co">PROPOSITION</span>', war: '<span class="pill no">GUERRE</span>' }[r] || '');
    const objs = (B.ai.objectives || []).slice(0, 2).map((o) => OBJECTIVE_LABELS[o.type]).filter(Boolean);
    $('diploBox').innerHTML = `
      <div class="dp-head">${flagImg(ent, 'flag lg')}<div><small class="eyebrow">Diplomatie</small><h2>${esc(B.name)}</h2><span class="pill rel-${st}">${REL_LABELS[st]}</span></div><span class="grow"></span><button class="btn ghost sm icon" id="dpClose">${icon('x')}</button></div>
      <div class="dp-grid">
        <div class="dp-sheet">
          <div class="relgauge"><span>Relations</span><b class="${rel >= 0 ? 'up' : 'down'}">${rel > 0 ? '+' : ''}${Math.round(rel)}</b><div class="relbar big"><i style="left:${50 + rel / 2}%"></i></div></div>
          ${this._kv('Personnalité', esc(P.label))}<p class="hint">${esc(P.desc)}</p>
          ${this._kv('PIB', fmtBn(B.eco.gdp))}${this._kv('Population', `${num(B.pop / 1e6)} M`)}${this._kv('Personnel militaire', fmtInt(landTotal(B) * 1000))}
          ${this._kv('Puissance / la vôtre', `${num(powerOf(B) / Math.max(1e-6, powerOf(A)), 2)} ×`)}${this._kv('Stabilité', `${Math.round(B.stability * 100)} %`)}
          ${this._kv('Accords', [allied ? 'alliance' : '', deal.trade ? 'commerce' : '', deal.nap > sim.time ? 'non-agression' : ''].filter(Boolean).join(', ') || 'aucun')}
          ${this._kv('En guerre', sim.isAtWar(k) ? 'oui' : 'non')}${atWar ? this._warSheet(k) : ''}${sanctionsOn(sim, k).length ? this._kv('Sous sanctions', `${sanctionsOn(sim, k).length} pays`) : ''}${isSanctioning(sim, p, k) ? this._kv('Vos sanctions', 'en vigueur') : ''}
          ${objs.length && (mem.talks > 0 || allied) ? this._kv('Priorités connues', esc(objs.join(', ').toLowerCase())) : ''}
          <small class="eyebrow">Mémoire de vos échanges</small>
          <div class="memrow"><span>Refus de leurs offres</span><b>${mem.refused}</b><span>Propositions refusées</span><b>${mem.declined}</b><span>Engagements rompus</span><b>${mem.broken}</b><span>Aides versées</span><b>${mem.gifts}</b></div>
        </div>
        <div class="dp-chat">
          <div class="chat" id="dpChat">${log.length ? log.map((l) => `<div class="msg ${l.from}">${l.from === 'ai' ? flagImg(ent, 'flag xs') : ''}<div><div class="txt">${badge(l.kind)}${esc(l.text)}</div>${l.from === 'ai' && l.factors && l.factors.length ? `<details ${l === log[log.length - 1] ? 'open' : ''}><summary>Analyse de l'IA</summary>${factorsHtml(l.factors)}</details>` : ''}${l.from === 'ai' && l.kind === 'counter' && l.counter && l === log[log.length - 1] ? `<button class="btn accent xs" id="dpAcceptCounter">${icon('check')}<span>Accepter la contre-proposition</span></button>` : ''}</div><time>${fmtDate(l.t, sim.cfg.startDay, true)}</time></div>`).join('') : '<p class="hint">Aucun échange pour le moment. Commencez par discuter.</p>'}</div>
          <div class="dp-actions">${acts.map((a) => `<button class="btn ${a === 'war' ? 'danger ghost' : a === 'cancel' ? 'ghost' : 'ghost'} sm" data-act="${a}">${icon(DIPLO_ACTIONS[a].icon)}<span>${DIPLO_ACTIONS[a].label}</span></button>`).join('')}</div>
          <div class="dp-amount"><span>Montant (aide, demande)</span><input type="number" id="dpAmount" min="0.1" step="0.1" value="${gdpAmt}"><span>Md$</span><label class="check"><input type="checkbox" id="dpMil"><span>Aide militaire (entrée en guerre)</span></label></div>
        </div>
      </div>`;
    const chat = $('dpChat'); chat.scrollTop = chat.scrollHeight;
    $('dpClose').onclick = () => this.closeDiplo();
    $('dpAmount').addEventListener('keydown', (e) => e.stopPropagation());
    if ($('dpAcceptCounter')) $('dpAcceptCounter').onclick = () => { const l = log[log.length - 1]; n.acceptCounter(k, l.counter); this._diplo(); this._bar(); };
    $('diploBox').querySelectorAll('[data-act]').forEach((b) => b.addEventListener('click', () => {
      const a = b.dataset.act;
      const amount = Math.max(0.1, Number($('dpAmount').value) || gdpAmt);
      if (a === 'war' && !window.confirm(`Déclarer la guerre à ${B.name} ? Les alliés de ce pays peuvent entrer en guerre, et vos relations avec ses partenaires se dégraderont.`)) return;
      if (a === 'cancel' && !window.confirm(`Rompre les accords avec ${B.name} ? Ce pays s'en souviendra.`)) return;
      if (a === 'peace') { this._peaceForm(k); return; }
      if (a === 'warGoals') { this._goalsForm(k); return; }
      if (a === 'coalForm') { const r = n.formCoalition(k, atWar ? 'defeat' : 'contain'); if (r && r.pending) { notice('Ordre transmis : formation de la coalition.'); return; } if (!r.ok) { notice(r.text); return; } n.log(k, 'player', `Nous formons « ${r.coalition.name} » face à vous.`, 'proposal'); this.closeDiplo(); this.app.gameNav.openPanel('coal'); this.app.coalitionUI.open.add(r.coalition.id); this.app.gameNav.renderTab(false); return; }
      if (a === 'sanction') { if (!window.confirm(`Imposer des sanctions économiques à ${B.name} ? Les échanges seront coupés ; ses partenaires et ses alliés le prendront mal.`)) return; this.app.act({ op: 'sanction', to: k }); this._diplo(); return; }
      if (a === 'unsanction') { this.app.act({ op: 'unsanction', to: k }); this._diplo(); return; }
      if (a === 'coalInvite') { n.inviteToCoalition(myCoals[0].id, k); this._diplo(); this._bar(); return; }
      const terms = a === 'gift' ? { amount } : a === 'aid' ? ($('dpMil').checked ? { military: true } : { amount }) : {};
      n.propose(k, a, terms);
      this._diplo();
      this._bar();
    }));
    void last;
  }
  // formulaire de paix : lignes actuelles ou frontières d'avant-guerre, réparations, type d'accord
  _peaceForm(k, offerId = null, base = null) {
    const sim = this.sim, n = sim.nv, p = n.player;
    const w = n.warWith(p, k);
    if (!w) { notice('Aucune guerre en cours avec ce pays.'); return; }
    const t = { ...(base || makePeaceTerms(sim, w, p)), proposer: p };
    // conditions venant de l'adversaire (« régions choisies » à son profit) : vues de votre côté = cessions
    if (t.territory === 'custom' && t.claimant !== undefined && t.claimant !== p && !(w.a.includes(t.claimant) && w.a.includes(p)) && !(w.b.includes(t.claimant) && w.b.includes(p))) {
      t.cedes = [...(t.claims || [])]; t.claims = []; t.claimant = p;
    }
    if (t.payer === undefined) t.payer = -1;
    const box = document.createElement('div');
    box.className = 'peace-form';
    const render = () => {
      const d = describeTerms(sim, w, t, p);
      box.innerHTML = `<h4>${offerId ? 'Votre contre-proposition' : 'Vos conditions de paix'}</h4>
        <div class="seg" data-pf="kind"><button data-v="ceasefire" class="${t.kind === 'ceasefire' ? 'on' : ''}">Cessez-le-feu</button><button data-v="treaty" class="${t.kind === 'treaty' ? 'on' : ''}">Traité de paix</button></div>
        <div class="seg" data-pf="territory"><button data-v="keep" class="${t.territory === 'keep' ? 'on' : ''}">Lignes actuelles</button><button data-v="restore" class="${t.territory === 'restore' ? 'on' : ''}">Frontières d'avant-guerre</button>${sim.details ? `<button data-v="custom" class="${t.territory === 'custom' ? 'on' : ''}">Régions choisies</button>` : ''}</div>
        ${t.territory === 'custom' ? this._claimsHtml(sim, w, t) + this._cedesHtml(sim, w, t, k) : ''}
        <div class="pf-rep"><span>Réparations</span><input type="number" min="0" step="0.5" value="${t.reparations || 0}" data-pf="rep"><span>Md$ versés par</span>
          <div class="seg" data-pf="payer"><button data-v="${p}" class="${t.payer === p ? 'on' : ''}">vous</button><button data-v="${k}" class="${t.payer === k ? 'on' : ''}">${esc(sim.sides[k].name)}</button></div></div>
        ${this._termsHtml(d)}
        <div class="row"><span class="grow"></span><button class="btn ghost sm" data-pf="cancel">Annuler</button><button class="btn primary sm" data-pf="send">${icon('send')}<span>Envoyer</span></button></div>`;
      box.querySelectorAll('[data-pf=kind] button').forEach((b) => b.onclick = () => { t.kind = b.dataset.v; render(); });
      box.querySelectorAll('[data-pf=territory] button').forEach((b) => b.onclick = () => {
        t.territory = b.dataset.v;
        if (t.territory === 'custom' && !t.claims) { t.claimant = p; t.claims = claimableRegions(sim, w, p).filter((x) => x.occupied >= 0.5).map((x) => x.id); }
        render();
      });
      // régions choisies : cases à cocher, raccourcis, sélection directement sur la carte
      const act0 = (key, fn) => { const b = box.querySelector(`[data-pf=${key}]`); if (b) b.onclick = fn; };
      const list = box.querySelector('.pf-list');
      if (list) list.scrollTop = this._claimScroll || 0;
      box.querySelectorAll('[data-cede]').forEach((cb) => cb.onchange = () => {
        const id = Number(cb.dataset.cede);
        t.cedes = cb.checked ? [...new Set([...(t.cedes || []), id])] : (t.cedes || []).filter((x) => x !== id);
        render();
      });
      act0('cedeAll', () => { t.cedes = claimableRegions(sim, w, k).filter((x) => x.occupied >= 0.5).map((x) => x.id); render(); });
      act0('cedeNone', () => { t.cedes = []; render(); });
      box.querySelectorAll('[data-claim]').forEach((cb) => cb.onchange = () => {
        const id = Number(cb.dataset.claim);
        t.claims = cb.checked ? [...new Set([...t.claims, id])] : t.claims.filter((x) => x !== id);
        this._claimScroll = list ? list.scrollTop : 0; render();
      });
      const act = (k, fn) => { const b = box.querySelector(`[data-pf=${k}]`); if (b) b.onclick = fn; };
      act('occ', () => { t.claims = claimableRegions(sim, w, p).filter((x) => x.occupied >= 0.5).map((x) => x.id); render(); });
      act('none', () => { t.claims = []; render(); });
      act('map', () => this._claimMap(sim, w, t, render));
      box.querySelectorAll('[data-pf=payer] button').forEach((b) => b.onclick = () => { t.payer = Number(b.dataset.v); if (!t.reparations) t.reparations = Math.round(sim.sides[t.payer].eco.gdp * 0.008 * 10) / 10; render(); });
      const rep = box.querySelector('[data-pf=rep]');
      rep.addEventListener('keydown', (e) => e.stopPropagation());
      rep.onchange = () => { t.reparations = Math.max(0, Number(rep.value) || 0); if (t.reparations > 0 && t.payer < 0) t.payer = p; if (!t.reparations) t.payer = -1; render(); };
      box.querySelector('[data-pf=cancel]').onclick = () => box.remove();
      box.querySelector('[data-pf=send]').onclick = () => {
        t.truceYears = t.kind === 'ceasefire' ? 2 : 4;
        if (offerId) { n.counterPeace(offerId, { ...t }); show('nationOffers', false); this.openDiplo(k); }
        else { n.propose(k, 'peace', { terms: { ...t }, text: `Proposition : ${t.kind === 'ceasefire' ? 'cessez-le-feu' : 'traité de paix'}, ${t.territory === 'keep' ? 'lignes actuelles' : t.territory === 'custom' ? `annexion de ${(t.claims || []).length} région(s)${(t.cedes || []).length ? `, cession de ${t.cedes.length} région(s), restitution du reste` : ''}` : 'frontières d\'avant-guerre'}${t.reparations > 0 ? `, ${t.reparations} Md$ de réparations` : ''}.` }); this._diplo(); }
        this._bar();
      };
    };
    render();
    const host = offerId ? document.querySelector(`#offersBox .offer[data-id="${offerId}"]`) : $('diploBox').querySelector('.dp-chat');
    if (!host) return;
    const old = host.querySelector('.peace-form'); if (old) old.remove();
    host.appendChild(box);
    box.scrollIntoView({ block: 'nearest' });
  }
  // vos régions occupées : cochées = cédées à l'adversaire, décochées = restitution demandée
  _cedesHtml(sim, w, t, k) {
    const regs = claimableRegions(sim, w, k).filter((x) => x.occupied > 0.01 || (t.cedes || []).includes(x.id));
    if (!regs.length) return '';
    const sel = new Set(t.cedes || []);
    const km = (v) => `${Math.round(v).toLocaleString('fr-FR')} km²`;
    const rows = regs.map((x) => `<label class="cl-row ${sel.has(x.id) ? 'on' : ''}"><input type="checkbox" data-cede="${x.id}" ${sel.has(x.id) ? 'checked' : ''}><span>${esc(x.name)}</span>${sel.has(x.id) ? '<em class="cl-no">cédée</em>' : '<em class="cl-ok">restitution demandée</em>'}<small>${km(x.km2)} · occupée à ${Math.round(x.occupied * 100)} %</small></label>`).join('');
    return `<div class="pf-claims cedes"><div class="row"><b>Vos régions occupées</b><span class="hint">${sel.size} cédée${sel.size > 1 ? 's' : ''} ; les autres vous sont restituées</span></div>
      <div class="row"><button class="btn ghost xs" data-pf="cedeNone">Tout restituer</button><button class="btn ghost xs" data-pf="cedeAll">Céder les régions perdues</button></div>
      <div class="pf-list">${rows}</div></div>`;
  }
  // situation militaire et risques (fiche diplomatique en guerre)
  _warSheet(k) {
    const sim = this.sim, n = sim.nv, p = n.player;
    const w = n.warWith(p, k);
    if (!w) return '';
    const mine = w.a.includes(p) ? 'a' : 'b', theirs = mine === 'a' ? 'b' : 'a';
    const B = sim.sides[k], A = sim.sides[p];
    const shareThem = w.losses && w.losses[k] !== undefined ? w.losses[k] : mine === 'a' ? (w.shareA || 0) : (w.shareB || 0);
    const shareUs = w.losses && w.losses[p] !== undefined ? w.losses[p] : mine === 'a' ? (w.shareB || 0) : (w.shareA || 0);
    const riskThem = w.risk ? w.risk[theirs] : collapseRisk(sim, w, theirs === 'a' ? w.a : w.b, shareThem);
    const riskUs = w.risk ? w.risk[mine] : collapseRisk(sim, w, mine === 'a' ? w.a : w.b, shareUs);
    const gp = w.goals ? goalProgress(sim, w, mine) : null;
    const pct = (v) => `${Math.round((v || 0) * 100)} %`;
    const we = sim.cfg.warEnd || {};
    return `${this._kv(`Territoire de ${esc(B.name)} conquis`, pct(shareThem))}${this._kv('Votre territoire perdu', pct(shareUs))}
      ${this._kv('Risque de capitulation (eux / vous)', `${pct(riskThem)} / ${pct(riskUs)}`)}
      ${this._kv('Risque de révolte (eux / vous)', `${pct(B.revoltRisk)} / ${pct(A.revoltRisk)}`)}
      ${gp && gp.items ? this._kv('Objectifs de guerre', gp.ok ? 'atteints' : `${pct(gp.share)} tenus`) : ''}
      ${this._kv('Paix automatique', we.autoPeace ? 'ON' : 'OFF — la paix dépend de vous')}`;
  }
  // objectifs de guerre du joueur : régions visées et capitale
  _goalsForm(k) {
    const sim = this.sim, n = sim.nv, p = n.player;
    const w = n.warWith(p, k);
    if (!w) { notice('Aucune guerre en cours avec ce pays.'); return; }
    const mine = w.a.includes(p) ? 'a' : 'b';
    const g = (w.goals && w.goals[mine]) || { regions: [], capital: true };
    const sel = new Set(g.regions || []);
    let capital = g.capital !== false && !g.liberate;
    const box = document.createElement('div');
    box.className = 'peace-form';
    const render = () => {
      const ke = sim.sides[k].e;
      const regs = sim.details ? claimableRegions(sim, w, p).sort((a, b) => (b.e === ke) - (a.e === ke)) : [];
      const km = (v) => `${Math.round(v).toLocaleString('fr-FR')} km²`;
      let html = '', cur = -1;
      for (const x of regs) {
        if (x.e !== cur) { cur = x.e; const ent = this.ent(x.e); html += `<h5>${ent ? flagImg(ent, 'flag xs') : ''}${esc(ent ? ent.name : '')}</h5>`; }
        html += `<label class="cl-row ${sel.has(x.id) ? 'on' : ''}"><input type="checkbox" data-goal="${x.id}" ${sel.has(x.id) ? 'checked' : ''}><span>${esc(x.name)}</span>${x.occupied >= 0.9 ? '<em class="cl-ok">tenue</em>' : x.occupied > 0.01 ? `<em class="cl-part">${Math.round(x.occupied * 100)} %</em>` : '<em class="cl-no">à prendre</em>'}<small>${km(x.km2)}</small></label>`;
      }
      const gp = goalProgress(sim, { ...w, goals: { ...w.goals, [mine]: { regions: [...sel], capital } } }, mine);
      box.innerHTML = `<h4>Objectifs de guerre contre ${esc(sim.sides[k].name)}</h4>
        <p class="hint">Quand vos objectifs sont tenus pendant un mois, l'adversaire vous offre sa capitulation${sim.cfg.warEnd && sim.cfg.warEnd.autoPeace ? ' (paix automatique ON : la paix est signée sur ces régions)' : ' : vous décidez de l\'accepter, de l\'amender ou de continuer la guerre'}.</p>
        <label class="check"><input type="checkbox" data-gcap ${capital ? 'checked' : ''}><span>Prendre la capitale adverse</span></label>
        <div class="pf-claims"><div class="row"><b>Régions visées</b><span class="hint">${sel.size} sélectionnée${sel.size > 1 ? 's' : ''} — progression ${Math.round(gp.share * 100)} %${gp.ok ? ' (atteints)' : ''}</span></div>
        <div class="pf-list">${html || '<p class="hint">Régions indisponibles sur cette carte : seule la capitale peut être visée.</p>'}</div></div>
        <div class="row"><span class="grow"></span><button class="btn ghost sm" data-g="cancel">Annuler</button><button class="btn primary sm" data-g="ok">${icon('crosshair')}<span>Fixer ces objectifs</span></button></div>`;
      box.querySelectorAll('[data-goal]').forEach((cb) => cb.onchange = () => { const id = Number(cb.dataset.goal); if (cb.checked) sel.add(id); else sel.delete(id); render(); });
      box.querySelector('[data-gcap]').onchange = (e) => { capital = e.target.checked; render(); };
      box.querySelector('[data-g=cancel]').onclick = () => box.remove();
      box.querySelector('[data-g=ok]').onclick = () => { n.setWarGoals(k, [...sel], capital); box.remove(); notice('Objectifs de guerre fixés.'); this._diplo(); };
    };
    render();
    const host = $('diploBox').querySelector('.dp-chat');
    if (!host) return;
    const old = host.querySelector('.peace-form'); if (old) old.remove();
    host.appendChild(box);
    box.scrollIntoView({ block: 'nearest' });
  }
  // liste des régions revendicables (pays adverses), groupées par pays d'origine
  _claimsHtml(sim, w, t) {
    const te = this.dTarget >= 0 && sim.sides[this.dTarget] ? sim.sides[this.dTarget].e : -1;
    const regs = claimableRegions(sim, w, t.claimant ?? sim.nv.player).sort((a, b) => (b.e === te) - (a.e === te));
    const sel = new Set(t.claims || []);
    const km = (v) => `${Math.round(v).toLocaleString('fr-FR')} km²`;
    const chosen = regs.filter((x) => sel.has(x.id));
    const tot = chosen.reduce((a, x) => a + x.km2, 0), free = chosen.reduce((a, x) => a + x.theirs, 0);
    let html = '', cur = -1;
    for (const x of regs) {
      if (x.e !== cur) { cur = x.e; const ent = this.ent(x.e); html += `<h5>${ent ? flagImg(ent, 'flag xs') : ''}${esc(ent ? ent.name : '')}</h5>`; }
      const st = x.occupied >= 0.99 ? '<em class="cl-ok">conquise</em>' : x.occupied > 0.01 ? `<em class="cl-part">conquise à ${Math.round(x.occupied * 100)} %</em>` : '<em class="cl-no">tenue par l\'adversaire</em>';
      html += `<label class="cl-row ${sel.has(x.id) ? 'on' : ''}"><input type="checkbox" data-claim="${x.id}" ${sel.has(x.id) ? 'checked' : ''}><span>${esc(x.name)}</span>${st}<small>${km(x.km2)}</small></label>`;
    }
    return `<div class="pf-claims"><div class="row"><b>Régions à annexer</b><span class="hint">${chosen.length} sélectionnée${chosen.length > 1 ? 's' : ''}, ${km(tot)}${free > 0 ? ` (dont ${km(free)} non conquis : l'adversaire acceptera difficilement)` : ''}</span></div>
      <div class="row"><button class="btn ghost xs" data-pf="occ">Régions conquises</button><button class="btn ghost xs" data-pf="none">Aucune</button><span class="grow"></span><button class="btn ghost xs" data-pf="map">${icon('map')}<span>Choisir sur la carte</span></button></div>
      <div class="pf-list">${html || '<p class="hint">Aucune région adverse disponible.</p>'}</div>
      <p class="hint">Les régions cochées vous reviennent, même celles que vous n'avez pas conquises ; tous les autres territoires occupés retournent à leur propriétaire d'avant-guerre.</p></div>`;
  }
  // sélection sur la carte : une étiquette par région revendicable, cliquer l'ajoute ou la retire
  _claimMap(sim, w, t, done) {
    const app = this.app, r = app.renderer, g = sim.grid || app.grid;
    const dlgs = ['diploDialog', 'nationOffers'].filter((id) => isShown(id));
    for (const id of dlgs) show(id, false);
    const regs = claimableRegions(sim, w, t.claimant);
    const layer = document.createElement('div');
    layer.id = 'claimLayer';
    const bar = document.createElement('div');
    bar.className = 'claim-bar panel';
    document.body.appendChild(layer); document.body.appendChild(bar);
    const pins = regs.map((x) => {
      const el = document.createElement('button');
      el.className = 'claim-pin';
      el.innerHTML = `<i></i><span>${esc(x.name)}</span>`;
      el.title = `${x.name} — ${Math.round(x.km2).toLocaleString('fr-FR')} km² — ${x.occupied >= 0.99 ? 'conquise' : x.occupied > 0.01 ? `conquise à ${Math.round(x.occupied * 100)} %` : 'tenue par l\'adversaire'}`;
      el.onclick = (ev) => { ev.stopPropagation(); const s = new Set(t.claims); if (s.has(x.id)) s.delete(x.id); else s.add(x.id); t.claims = [...s]; refresh(); };
      layer.appendChild(el);
      const c = sim.details.regions[x.id].center;
      return { x, el, c };
    });
    const refresh = () => {
      const sel = new Set(t.claims);
      for (const p of pins) { p.el.classList.toggle('on', sel.has(p.x.id)); p.el.classList.toggle('occ', p.x.occupied >= 0.5); }
      const tot = regs.filter((x) => sel.has(x.id)).reduce((a, x) => a + x.km2, 0);
      bar.innerHTML = `<span>${icon('map')}<b>Cliquez les régions à annexer</b> — ${sel.size} sélectionnée${sel.size > 1 ? 's' : ''}, ${Math.round(tot).toLocaleString('fr-FR')} km²</span><button class="btn primary sm" id="claimDone">${icon('check')}<span>Terminer</span></button>`;
      $('claimDone').onclick = finish;
    };
    let alive = true;
    const loop = () => {
      if (!alive) return;
      for (const p of pins) {
        const c = p.c;
        const q = c >= 0 ? r.project(g.xyz[c * 3], g.xyz[c * 3 + 1], g.xyz[c * 3 + 2], (r.cellR ? r.cellR[c] : 1) + 0.002) : null;
        if (!q) { p.el.style.display = 'none'; continue; }
        p.el.style.display = '';
        p.el.style.transform = `translate(${q[0].toFixed(1)}px, ${q[1].toFixed(1)}px) translate(-50%, -50%)`;
      }
      requestAnimationFrame(loop);
    };
    const finish = () => { alive = false; layer.remove(); bar.remove(); document.removeEventListener('keydown', esc2, true); for (const id of dlgs) show(id); done(); };
    const esc2 = (e) => { if (e.key === 'Escape') { e.stopPropagation(); e.preventDefault(); finish(); } };
    document.addEventListener('keydown', esc2, true);
    // caméra sur la zone revendicable
    const cs = pins.filter((p) => p.c >= 0);
    if (cs.length) {
      let x = 0, y = 0, z = 0; for (const p of cs) { x += g.xyz[p.c * 3]; y += g.xyz[p.c * 3 + 1]; z += g.xyz[p.c * 3 + 2]; }
      const l = Math.hypot(x, y, z) || 1;
      r.cam.flyTo(Math.asin(y / l) * 180 / Math.PI, Math.atan2(x, z) * 180 / Math.PI, 1.5);
    }
    refresh(); loop();
  }
  _termsHtml(d) {
    const sec = (l, list) => (list.length ? `<div class="tm-sec"><small>${l}</small><ul>${list.map((x) => `<li>${esc(x)}</li>`).join('')}</ul></div>` : '');
    return `<div class="terms">${sec('Territoires proposés', d.proposed)}${sec('Territoires conservés', d.kept)}${sec('Territoires rendus', d.returned)}${sec('Conditions', d.conditions)}${sec('Conséquences', d.consequences)}</div>`;
  }
  closeDiplo() { show('diploDialog', false); this.app.resumeAfterOverlay(); if (isShown('nationPanel') && this.tab === 'diplo') this._renderTab(true); }

  // ======================= PROPOSITIONS DES IA =======================
  openOffers() {
    const sim = this.sim, n = sim && sim.nv;
    if (!n) return;
    const labels = { trade: 'Accord commercial', alliance: 'Alliance', help: 'Demande d\'aide militaire', demand: 'Exigence', peace: 'Proposition de paix', coalition: 'Invitation dans une coalition', surrender: 'Capitulation proposée' };
    $('offersBox').innerHTML = `<small class="eyebrow">Diplomatie</small><h2>Propositions reçues</h2>
      ${n.offers.length ? n.offers.map((o) => {
        const B = sim.sides[o.from];
        const w = o.type === 'peace' || o.type === 'surrender' ? n.warWith(o.from, n.player) : null;
        const sur = o.type === 'surrender', capD = o.type === 'peace' && o.terms && o.terms.capitulation;
        const terms = w && o.terms && o.terms.terms ? this._termsHtml(describeTerms(sim, w, o.terms.terms, n.player)) : '';
        return `<div class="offer" data-id="${o.id}">${flagImg(this.ent(B.e), 'flag md')}<div><b>${labels[o.type] || o.type} : ${esc(B.name)}</b><span>${esc(o.text)}</span><small>Réponse attendue avant le ${fmtDate(o.until, sim.cfg.startDay, true)}. Relations : ${Math.round(sim.rel[n.player * sim.S + o.from])}.</small></div>
        ${terms}
        <div class="offer-btns"><button class="btn primary sm" data-yes>${icon('check')}<span>${sur ? 'Accepter la capitulation' : capD ? 'Capituler' : 'Accepter'}</span></button><button class="btn ghost sm" data-no>${icon(sur || capD ? 'swords' : 'x')}<span>${sur || capD ? 'Continuer la guerre' : 'Refuser'}</span></button>${w && sim.rules.negotiations !== false ? `<button class="btn ghost sm" data-counter>${icon('repeat')}<span>${sur ? 'Proposer mes conditions' : 'Contre-proposer'}</span></button>` : ''}<button class="btn ghost sm icon" data-open title="Ouvrir la diplomatie avec ce pays">${icon('message-square')}</button></div></div>`; }).join('') : '<p class="hint">Aucune proposition en attente.</p>'}
      <p class="hint">Refuser une offre est mémorisé : un pays dont vous refusez souvent les propositions devient moins coopératif.</p>
      <div class="dialog-foot"><span class="grow"></span><button class="btn primary" id="offersClose">Fermer</button></div>`;
    $('offersBox').querySelectorAll('.offer').forEach((el) => {
      const id = Number(el.dataset.id);
      el.querySelector('[data-yes]').onclick = () => { n.answerOffer(id, true); this.openOffers(); this._bar(); };
      el.querySelector('[data-no]').onclick = () => { n.answerOffer(id, false); this.openOffers(); this._bar(); };
      el.querySelector('[data-open]').onclick = () => { const o = n.offers.find((x) => x.id === id); if (o) { show('nationOffers', false); this.openDiplo(o.from); } };
      const c = el.querySelector('[data-counter]');
      if (c) c.onclick = () => { const o = n.offers.find((x) => x.id === id); if (o) this._peaceForm(o.from, id, o.terms && o.terms.terms); };
    });
    $('offersClose').onclick = () => { show('nationOffers', false); this.app.resumeAfterOverlay(); };
    show('nationOffers');
  }

  // ======================= DÉCISIONS =======================
  openDecision() {
    const sim = this.sim, n = sim && sim.nv;
    if (!n) return;
    const d = n.decision;
    if (!d) { notice('Aucune décision en attente.'); return; }
    $('decisionBox').innerHTML = `<small class="eyebrow">Décision du gouvernement</small><h2>${esc(d.title)}</h2><p class="dc-text">${esc(d.text)}</p>
      <div class="dc-opts">${d.options.map((o, i) => `<button class="dc-opt" data-i="${i}"><b>${esc(o.label)}</b><span>${esc(o.desc || '')}</span></button>`).join('')}</div>
      <p class="hint">Sans réponse avant le ${fmtDate(d.until, sim.cfg.startDay, true)}, le gouvernement choisira « ${esc(d.options[d.def ?? d.options.length - 1].label)} ».</p>
      <div class="dialog-foot"><span class="grow"></span><button class="btn ghost" id="dcLater">Plus tard</button></div>`;
    $('decisionBox').querySelectorAll('[data-i]').forEach((b) => { b.onclick = () => { n.choose(Number(b.dataset.i)); show('nationDecision', false); this.app.resumeAfterOverlay(); this._bar(); notice(`Décision : ${b.querySelector('b').textContent}`); }; });
    $('dcLater').onclick = () => { show('nationDecision', false); this.app.resumeAfterOverlay(); };
    show('nationDecision');
  }

  // ======================= FIN DE SCÉNARIO =======================
  openScenarioEnd() {
    const sim = this.sim, n = sim && sim.nv;
    if (!n || !n.scenario || this.endShown) return;
    this.endShown = true;
    const sc = findScenario(n.scenario.id, sim.cfg.nation.scenarioSpec);
    const st = n.scenario;
    const tl = n.timeline, a = tl[0] || {}, sd = sim.sides[n.player];
    const grades = { triomphe: 'Triomphe', succes: 'Succès', mitige: 'Résultat mitigé', echec: 'Échec' };
    $('scenEndBox').innerHTML = `<small class="eyebrow">${esc(sc.title)} · fin du scénario</small><div class="se-grade g-${st.grade}">${grades[st.grade]}</div><h2>${esc(st.ending.title)}</h2><p>${esc(st.ending.text)}</p>${st.failWhy ? `<p class="se-fail">${icon('circle-x')}Condition d'échec : ${esc(st.failWhy)}.</p>` : ''}
      <ul class="goals-list">${sc.objectives.map((o) => `<li class="${st.done[o.id] ? 'done' : ''}">${icon(st.done[o.id] ? 'circle-check' : 'circle-x')}<div><span>${esc(o.text)} ${o.main ? '<em class="ob-main">principal</em>' : o.secret ? '<em class="ob-secret">secret</em>' : ''}</span></div></li>`).join('')}</ul>
      <div class="nm-kpis">${[['PIB', `${fmtBn(a.gdp || 0)} → ${fmtBn(sd.eco.gdp)}`], ['Population', `${num((a.pop || 0) / 1e6)} → ${num(sd.pop / 1e6)} M`], ['Technologie', `${num(a.tech || 0)} → ${num(sd.p.tech)}`], ['Stabilité', `${a.stability || 0} → ${Math.round(sd.stability * 100)} %`]].map(([l, v]) => `<div><small>${l}</small><b>${v}</b></div>`).join('')}</div>
      <div class="dialog-foot"><button class="btn ghost" id="seMenu">Menu principal</button><span class="grow"></span><button class="btn ghost" id="seTime">${icon('history')}<span>Chronologie</span></button><button class="btn primary" id="seGo">${icon('play')}<span>Continuer à diriger le pays</span></button></div>`;
    $('seMenu').onclick = () => { show('scenarioEnd', false); this.app.goMenu(); };
    $('seTime').onclick = () => { show('scenarioEnd', false); this.openPanel('time'); };
    $('seGo').onclick = () => { show('scenarioEnd', false); this.app.resumeAfterOverlay(); };
    show('scenarioEnd');
  }
}
