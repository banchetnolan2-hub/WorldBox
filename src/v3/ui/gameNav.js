// UI — NAVIGATION EN PARTIE : un rail vertical toujours présent (Carte, Pays, Diplomatie, Économie,
// Technologie, Militaire, Histoire, Actualités, Statistiques, Règles, Sauvegarde) et un panneau
// « Monde » à onglets. En mode Nation, les entrées liées au pays ouvrent la gestion du pays.
import { $, show, isShown, esc, fmtInt } from './util.js';
import { icon } from './icons.js';
import { flagImg } from './util.js';
import { fmtBn, PERSONALITIES } from '../sim/profile.js';
import { powerOf } from '../sim/ai.js';
import { landTotal } from '../sim/economy.js';
import { relationStatus, REL_LABELS } from '../sim/wars.js';
import { fmtDate, dateParts } from '../sim/calendar.js';
import { CHRON_TYPES } from './warUI.js';

const ITEMS = [
  ['map', 'Carte', 'map', 'Fermer les panneaux et revenir à la carte'],
  ['mine', 'Mon pays', 'landmark', 'Gestion de votre pays', true],
  ['countries', 'Pays', 'flag', 'Tous les pays : population, économie, forces, territoire'],
  ['diplo', 'Diplomatie', 'handshake', 'Alliances, guerres, tensions et accords'],
  ['coal', 'Coalitions', 'shield', 'Coalitions : membres, objectifs, cohésion, offensives coordonnées'],
  ['multi', 'Multijoueur', 'users', 'Jouer à plusieurs : inviter des amis, joueurs, messagerie', true],
  ['eco', 'Économie', 'coins', 'PIB, croissance, dette, commerce'],
  ['tech', 'Technologie', 'cpu', 'Niveaux technologiques et projets'],
  ['mil', 'Militaire', 'swords', 'Armées, guerres et rapports'],
  ['history', 'Histoire', 'book-open', 'Histoire du monde (H)'],
  ['news', 'Actualités', 'message-square', 'Derniers événements'],
  ['rank', 'Classement', 'award', 'Classement mondial et comparateur de pays'],
  ['maps', 'Cartes', 'layers', 'Cartes thématiques (K)'],
  ['crises', 'Crises', 'activity', 'Crises internationales, conférences et sanctions'],
  ['stats', 'Statistiques', 'activity', 'Évolution des grandes puissances'],
  ['rules', 'Règles', 'sliders-horizontal', 'Systèmes actifs dans cette partie'],
  ['guide', 'Guide', 'circle-help', 'Aide et tutoriel (F1)'],
  ['save', 'Sauvegarde', 'save', 'Sauvegarder la partie'],
];
const WTABS = [['countries', 'Pays'], ['rank', 'Classement'], ['cmp', 'Comparer'], ['diplo', 'Diplomatie'], ['coal', 'Coalitions'], ['crises', 'Crises'], ['maps', 'Cartes'], ['eco', 'Économie'], ['tech', 'Technologie'], ['mil', 'Militaire'], ['news', 'Actualités'], ['stats', 'Statistiques']];

export class GameNav {
  constructor(app) {
    this.app = app;
    this.tab = 'countries';
    this.sort = { countries: 'gdp' };
    const t = document.createElement('template');
    t.innerHTML = `<nav id="navRail" class="hidden"></nav>`;
    document.body.appendChild(t.content.firstChild);
    const t2 = document.createElement('template');
    t2.innerHTML = `<aside id="worldPanel" class="panel hidden"><div class="nm-head"><div class="nm-title"><div><small class="eyebrow">Le monde</small><b id="wpTitle">Pays</b></div></div><button class="btn ghost sm icon" id="wpClose" title="Fermer (Échap)">${icon('x')}</button></div><nav class="nm-tabs" id="wpTabs"></nav><div class="nm-body" id="wpBody"></div></aside>`;
    document.body.appendChild(t2.content.firstChild);
    $('navRail').addEventListener('click', (e) => { const b = e.target.closest('[data-nav]'); if (b) this.go(b.dataset.nav); });
    $('wpClose').onclick = () => this.closePanel();
    $('wpTabs').addEventListener('click', (e) => { const b = e.target.closest('[data-tab]'); if (b) this.openPanel(b.dataset.tab); });
    $('wpBody').addEventListener('keydown', (e) => e.stopPropagation());
  }
  get sim() { return this.app.session.sim; }
  render() {
    const nation = !!(this.sim && this.sim.nv);
    $('navRail').innerHTML = ITEMS.filter((it) => !it[4] || nation).map(([k, l, ic, tip]) => `<button data-nav="${k}" title="${esc(tip)}">${icon(ic)}<span>${l}</span></button>`).join('');
  }
  showRail(on) { if (on) this.render(); show('navRail', on); document.body.classList.toggle('rail-on', on); if (!on) this.closePanel(); }
  setActive(k) { document.querySelectorAll('#navRail [data-nav]').forEach((b) => b.classList.toggle('on', b.dataset.nav === k)); }
  go(k) {
    const app = this.app, sim = this.sim;
    if (!sim) return;
    const nui = app.nationUI;
    const nation = nui.active && sim.nv;
    if (k === 'map') { this.closePanel(); nui.closePanel(); app.selectEntity(-1); this.setActive('map'); return; }
    if (k === 'save') { app.saveGame(); return; }
    if (k === 'guide') { app.guide.open(); return; }
    if (k === 'multi') { this.closePanel(); app.nationUI.closePanel(); if (app.netUI.isOpen()) app.netUI.closePanel(); else app.netUI.openPanel(); return; }
    if (k === 'rules') { app.rulesUI.open({ mode: sim.cfg.mode || (sim.nv ? 'nation' : 'sandbox'), rules: sim.rules, readonly: true, title: 'Règles de cette partie' }); return; }
    if (k === 'history') { app.warUI.openHistory(); return; }
    if (nation && ['mine', 'diplo', 'eco', 'tech', 'mil'].includes(k)) {
      this.closePanel();
      nui.openPanel({ mine: 'home', diplo: 'diplo', eco: 'eco', tech: sim.rules.techTree === false ? 'tech' : 'dev', mil: 'def' }[k]);
      this.setActive(k);
      return;
    }
    nui.closePanel();
    this.openPanel(k);
  }
  isOpen() { return isShown('worldPanel'); }
  closePanel() { show('worldPanel', false); this.setActive(null); }
  openPanel(tab) {
    this.tab = tab;
    $('wpTabs').innerHTML = WTABS.map(([k, l]) => `<button data-tab="${k}" class="${k === tab ? 'on' : ''}">${l}</button>`).join('');
    $('wpTitle').textContent = (WTABS.find((x) => x[0] === tab) || ['', ''])[1];
    show('worldPanel');
    this.setActive(tab);
    this.renderTab(false);
  }
  update() { if (this.isOpen() && !this.busy && performance.now() - (this._at || 0) > 1500 && !(document.activeElement && document.activeElement.closest && document.activeElement.closest('#worldPanel'))) this.renderTab(true); }
  renderTab(refresh) {
    this._at = performance.now();
    const sim = this.sim;
    if (!sim) return;
    const body = $('wpBody');
    const sc = body.scrollTop;
    const V = this.app.worldViews;
    const f = { countries: this._countries, diplo: this._diplo, coal: () => this.app.coalitionUI.html(), rank: () => V.rankHtml(), cmp: () => V.cmpHtml(), crises: () => V.crisesHtml(), maps: () => V.mapsHtml(), eco: this._eco, tech: this._tech, mil: this._mil, news: this._news, stats: this._stats }[this.tab];
    if (!f) return;
    body.innerHTML = f.call(this, sim);
    if (refresh) body.scrollTop = sc;
    else { body.classList.remove('fade'); void body.offsetWidth; body.classList.add('fade'); }
    body.querySelectorAll('[data-e]').forEach((el) => el.addEventListener('click', () => { this.app.selectEntity(Number(el.dataset.e), true); }));
    body.querySelectorAll('[data-sort]').forEach((el) => el.addEventListener('click', () => { this.sort[this.tab] = el.dataset.sort; this.renderTab(false); }));
    body.querySelectorAll('[data-war]').forEach((el) => el.addEventListener('click', (ev) => { ev.stopPropagation(); this.app.warUI.openReport(this.app.warUI.liveWar(Number(el.dataset.war))); }));
    const q = body.querySelector('#wpSearch');
    if (q) q.addEventListener('input', () => { this.query = q.value; const pos = q.selectionStart; this.renderTab(false); const nq = $('wpSearch'); if (nq) { nq.focus(); nq.setSelectionRange(pos, pos); } });
    body.querySelectorAll('canvas[data-chart]').forEach((cv) => this._chart(cv, cv.dataset.chart));
    if (this.tab === 'coal') this.app.coalitionUI.bind(body, () => this.renderTab(true));
    if (['rank', 'cmp', 'maps'].includes(this.tab)) V.bind(this.tab, body, () => this.renderTab(true));
  }
  _ent(e) { return this.app.entities()[e]; }
  _row(sd, cells) { return `<tr data-e="${sd.e}" class="${sd.player ? 'me' : ''}"><td class="cn">${flagImg(this._ent(sd.e), 'flag sm')}<span>${esc(sd.name)}</span></td>${cells.map((c) => `<td>${c}</td>`).join('')}</tr>`; }
  _table(heads, rows, sortKey) {
    return `<table class="wp-table"><thead><tr><th>Pays</th>${heads.map(([k, l]) => `<th data-sort="${k}" class="${sortKey === k ? 'on' : ''}">${l}</th>`).join('')}</tr></thead><tbody>${rows.join('')}</tbody></table>`;
  }
  _alive(sim) { return sim.sides.filter((s) => !s.eliminated); }
  _countries(sim) {
    const key = this.sort.countries || 'gdp';
    const q = (this.query || '').toLowerCase();
    const val = { gdp: (s) => s.eco.gdp, pop: (s) => s.pop, km2: (s) => s.km2 || s.cells, mil: (s) => landTotal(s), tech: (s) => s.p.tech, power: (s) => powerOf(s) };
    let list = this._alive(sim).filter((s) => !q || s.name.toLowerCase().includes(q));
    list.sort((a, b) => val[key](b) - val[key](a));
    const rows = list.slice(0, 120).map((s) => this._row(s, [fmtBn(s.eco.gdp), `${(s.pop / 1e6).toFixed(1).replace('.', ',')} M`, `${fmtInt(s.km2 || 0)} km²`, fmtInt(landTotal(s) * 1000), (s.p.tech).toFixed(0), Math.round(powerOf(s))]));
    return `<div class="search wp-search">${icon('search')}<input type="text" id="wpSearch" placeholder="Rechercher un pays…" value="${esc(this.query || '')}" spellcheck="false"></div>
      <p class="hint">Cliquez sur un en-tête pour trier, sur un pays pour ouvrir sa fiche. ${list.length} pays.</p>
      ${this._table([['gdp', 'PIB'], ['pop', 'Population'], ['km2', 'Territoire'], ['mil', 'Soldats'], ['tech', 'Techno.'], ['power', 'Puissance']], rows, key)}`;
  }
  _diplo(sim) {
    const S = sim.S;
    const alliances = [];
    for (let a = 0; a < S; a++) for (let b = a + 1; b < S; b++) if (sim.allied[a * S + b] && !sim.sides[a].eliminated && !sim.sides[b].eliminated) alliances.push([a, b]);
    // blocs d'alliés (composantes connexes)
    const seen = new Set(); const blocs = [];
    for (let a = 0; a < S; a++) {
      if (seen.has(a)) continue;
      const comp = []; const st = [a]; seen.add(a);
      while (st.length) { const x = st.pop(); comp.push(x); for (let y = 0; y < S; y++) if (!seen.has(y) && sim.allied[x * S + y]) { seen.add(y); st.push(y); } }
      if (comp.length > 1) blocs.push(comp);
    }
    blocs.sort((x, y) => y.length - x.length);
    const tensions = [];
    for (let a = 0; a < S; a++) for (let b = a + 1; b < S; b++) if (!sim.atWar[a * S + b] && sim.rel[a * S + b] < -45 && (sim.contact[a * S + b] || sim.nearCap[a * S + b])) tensions.push([a, b, sim.rel[a * S + b]]);
    tensions.sort((x, y) => x[2] - y[2]);
    const chip = (k) => `<span class="chip" data-e="${sim.sides[k].e}">${flagImg(this._ent(sim.sides[k].e), 'flag xs')}${esc(sim.sides[k].name)}</span>`;
    const wars = sim.activeWars.filter((w) => w.status === 'active');
    return `${sim.rules.alliances === false ? '<p class="cp-alert">Les alliances sont désactivées dans les règles de cette partie.</p>' : ''}
      <h4>Blocs d'alliés</h4>${blocs.length ? blocs.slice(0, 12).map((b) => `<div class="wp-bloc">${b.slice(0, 40).map(chip).join('')}</div>`).join('') : '<p class="hint">Aucune alliance.</p>'}
      <h4>Guerres en cours</h4>${wars.length ? wars.map((w) => `<div class="wp-war" data-war="${w.id}">${icon('swords')}<span>${esc(w.name)}</span><small>depuis ${fmtDate(w.start, sim.cfg.startDay, true)}</small></div>`).join('') : '<p class="hint">Aucune guerre.</p>'}
      <h4>Tensions entre voisins</h4>${tensions.length ? tensions.slice(0, 15).map(([a, b, r]) => `<div class="wp-pair">${chip(a)}<i>${icon('activity')}</i>${chip(b)}<b class="down">${Math.round(r)}</b></div>`).join('') : '<p class="hint">Aucune tension majeure.</p>'}`;
  }
  _eco(sim) {
    const key = this.sort.eco || 'gdp';
    const g = (s) => s.growthRate !== undefined ? s.growthRate : (s.series.length > 13 ? s.eco.gdp / Math.max(1, s.series[s.series.length - 13][2]) - 1 : 0);
    const val = { gdp: (s) => s.eco.gdp, pc: (s) => s.pc, growth: g, debt: (s) => s.debt / Math.max(0.1, s.eco.gdp), trade: (s) => s.tradePartners.length };
    const list = this._alive(sim).sort((a, b) => val[key](b) - val[key](a)).slice(0, 80);
    const world = this._alive(sim).reduce((t, s) => t + s.eco.gdp, 0);
    const crisis = this._alive(sim).filter((s) => s.crisis).length;
    return `<div class="nm-kpis"><div><small>PIB mondial</small><b>${fmtBn(world)}</b></div><div><small>Pays en crise</small><b>${crisis}</b></div><div><small>Commerce</small><b>${sim.rules.trade === false ? 'désactivé' : 'actif'}</b></div><div><small>Dette</small><b>${sim.rules.debt === false ? 'désactivée' : 'active'}</b></div></div>
      ${this._table([['gdp', 'PIB'], ['pc', 'PIB / hab.'], ['growth', 'Croissance'], ['debt', 'Dette'], ['trade', 'Partenaires']], list.map((s) => this._row(s, [fmtBn(s.eco.gdp), `${fmtInt(s.pc * 1000)} $`, `<span class="${g(s) >= 0 ? 'up' : 'down'}">${(g(s) * 100).toFixed(1).replace('.', ',')} %</span>`, `${Math.round(s.debt / Math.max(0.1, s.eco.gdp) * 100)} %`, s.tradePartners.length])), key)}`;
  }
  _tech(sim) {
    const key = this.sort.tech || 'tech';
    const val = { tech: (s) => s.p.tech, research: (s) => s.p.research, proj: (s) => (s.dev ? s.dev.done.length : 0), infra: (s) => (s.p.infra.roads + s.p.infra.rail) / 2 };
    const list = this._alive(sim).sort((a, b) => val[key](b) - val[key](a)).slice(0, 80);
    return `${sim.rules.research === false ? '<p class="cp-alert">La recherche est désactivée : les niveaux technologiques n\'évoluent pas.</p>' : ''}
      ${this._table([['tech', 'Technologie'], ['research', 'Recherche'], ['proj', 'Projets'], ['infra', 'Infrastructures']], list.map((s) => this._row(s, [s.p.tech.toFixed(1).replace('.', ','), Math.round(s.p.research), s.dev ? s.dev.done.length : '–', Math.round((s.p.infra.roads + s.p.infra.rail) / 2)])), key)}`;
  }
  _mil(sim) {
    const key = this.sort.mil || 'power';
    const val = { power: (s) => powerOf(s), soldiers: (s) => landTotal(s), air: (s) => s.air, navy: (s) => s.navy, budget: (s) => s.milTarget };
    const list = this._alive(sim).sort((a, b) => val[key](b) - val[key](a)).slice(0, 60);
    const wars = sim.wars.slice().reverse().slice(0, 12);
    return `<h4>Guerres</h4>${wars.length ? wars.map((w) => `<div class="wp-war ${w.status === 'ended' ? 'ended' : ''}" data-war="${w.id}">${icon(w.status === 'ended' ? 'scroll-text' : 'swords')}<span>${esc(w.name)}</span><small>${w.status === 'ended' ? 'terminée' : 'en cours'}</small></div>`).join('') : '<p class="hint">Aucune guerre pour le moment.</p>'}
      <h4>Forces armées</h4>${this._table([['power', 'Puissance'], ['soldiers', 'Soldats'], ['air', 'Aviation'], ['navy', 'Marine'], ['budget', 'Budget']], list.map((s) => this._row(s, [Math.round(powerOf(s)), fmtInt(landTotal(s) * 1000), s.air.toFixed(1).replace('.', ','), s.navy.toFixed(1).replace('.', ','), fmtBn(s.milTarget)])), key)}`;
  }
  _news(sim) {
    const log = sim.log.slice(-60).reverse();
    const ch = sim.chronicle.slice(-30).reverse();
    return `<h4>Dernières nouvelles</h4><ul class="wp-news">${log.map((e) => `<li class="t-${e.tone || 'neutral'}"><time>${fmtDate(e.t, sim.cfg.startDay, true)}</time><b>${esc(e.title.charAt(0) + e.title.slice(1).toLowerCase())}</b><span>${esc(e.text)}</span></li>`).join('') || '<li class="hint">Rien pour le moment.</li>'}</ul>
      <h4>Grands faits</h4><ul class="wp-news">${ch.map((c) => { const T = CHRON_TYPES[c.type] || CHRON_TYPES.sim; return `<li><time>${fmtDate(c.t, sim.cfg.startDay, true)}</time><b style="color:${T[2]}">${T[0]}</b><span>${esc(c.text)}</span></li>`; }).join('')}</ul>`;
  }
  _stats(sim) {
    return `<p class="hint">Les six premières puissances économiques, mois par mois.</p>
      <canvas class="nm-chart" data-chart="gdp" height="170"></canvas><canvas class="nm-chart" data-chart="power" height="170"></canvas><canvas class="nm-chart" data-chart="cells" height="170"></canvas>`;
  }
  _chart(cv, kind) {
    const sim = this.sim;
    const idx = { gdp: 2, power: 7, cells: 1 }[kind];
    const label = { gdp: 'PIB (Md$)', power: 'Puissance militaire (indice)', cells: 'Territoire (parcelles)' }[kind];
    const top = this._alive(sim).sort((a, b) => b.eco.gdp - a.eco.gdp).slice(0, 6);
    const W = cv.clientWidth || 520, H = Number(cv.getAttribute('height'));
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    cv.width = W * dpr; cv.height = H * dpr; cv.style.height = H + 'px';
    const ctx = cv.getContext('2d'); ctx.scale(dpr, dpr);
    const css = getComputedStyle(document.body);
    ctx.fillStyle = css.getPropertyValue('--text-2') || '#aaa'; ctx.font = '600 11px Inter, sans-serif'; ctx.fillText(label, 8, 14);
    let mn = Infinity, mx = -Infinity, t0 = Infinity, t1 = -Infinity;
    for (const s of top) for (const r of s.series) { mn = Math.min(mn, r[idx]); mx = Math.max(mx, r[idx]); t0 = Math.min(t0, r[0]); t1 = Math.max(t1, r[0]); }
    if (!isFinite(mn) || t1 <= t0) { ctx.fillText('Données disponibles après quelques mois.', 8, H / 2); return; }
    const L = 8, R = W - 120, T = 24, B = H - 16;
    const X = (t) => L + (t - t0) / (t1 - t0) * (R - L), Y = (v) => B - (v - mn) / Math.max(1e-9, mx - mn) * (B - T);
    ctx.strokeStyle = 'rgba(232,225,207,0.07)'; for (let k = 0; k <= 3; k++) { const y = T + (B - T) * k / 3; ctx.beginPath(); ctx.moveTo(L, y); ctx.lineTo(R, y); ctx.stroke(); }
    ctx.fillStyle = 'rgba(232,225,207,0.45)'; ctx.font = '10px Inter, sans-serif';
    const ya = dateParts(t0, sim.cfg.startDay).y, yb = dateParts(t1, sim.cfg.startDay).y;
    for (let y = ya; y <= yb; y++) { const tt = ((y - 2025) * 365 - sim.cfg.startDay) / 3; if (tt >= t0 && tt <= t1) ctx.fillText(String(y), X(tt) - 12, H - 3); }
    top.forEach((s, i) => {
      const col = this.app.renderer.colors[s.e] || '#ccc';
      ctx.strokeStyle = col; ctx.lineWidth = s.player ? 2.6 : 1.6;
      ctx.beginPath(); s.series.forEach((r, k) => (k ? ctx.lineTo(X(r[0]), Y(r[idx])) : ctx.moveTo(X(r[0]), Y(r[idx])))); ctx.stroke();
      ctx.fillStyle = col; ctx.font = '600 11px Inter, sans-serif';
      ctx.fillText(s.name.length > 14 ? s.name.slice(0, 13) + '…' : s.name, R + 8, T + 8 + i * 15);
    });
    void PERSONALITIES; void relationStatus; void REL_LABELS;
  }
}
