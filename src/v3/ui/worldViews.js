// UI — VUES DU MONDE : classement mondial (plusieurs mesures, évolution), comparateur de pays (tableau +
// graphiques historiques superposés), crises internationales et sanctions, cartes thématiques (couleur des pays
// selon une mesure, avec légende). Onglets du panneau « Monde ».
import { esc, flagImg, fmtInt } from './util.js';
import { icon } from './icons.js';
import { fmtBn } from '../sim/profile.js';
import { powerOf } from '../sim/ai.js';
import { landTotal } from '../sim/economy.js';
import { fmtDate, dateParts } from '../sim/calendar.js';
import { activeCrises, crisesOf, sanctionsOf, CRISIS_TYPES } from '../sim/crises.js';
import { activeCoalitions } from '../sim/coalitions.js';

const num = (v, d = 1) => (Math.round(v * 10 ** d) / 10 ** d).toLocaleString('fr-FR');
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
function mix(a, b, t) { const pa = parseInt(a.slice(1), 16), pb = parseInt(b.slice(1), 16); const c = [16, 8, 0].map((s) => Math.round(((pa >> s) & 255) * (1 - t) + ((pb >> s) & 255) * t)); return '#' + c.map((x) => x.toString(16).padStart(2, '0')).join(''); }
function ramp(t, stops) { t = clamp(t, 0, 1); const n = stops.length - 1; const i = Math.min(n - 1, Math.floor(t * n)); return mix(stops[i], stops[i + 1], t * n - i); }
const SEQ = ['#1c2b3a', '#2f5a6e', '#5f9a86', '#c9c27a', '#e8a95b'];
const DIV = ['#c4553f', '#d99a7c', '#7d8389', '#8bbf9a', '#3f9a6a'];

// mesures du classement et des cartes thématiques
export const METRICS = {
  gdp: { label: 'PIB', get: (s) => s.eco.gdp, fmt: (v) => fmtBn(v), log: true },
  pc: { label: 'PIB par habitant', get: (s) => s.eco.gdp * 1e9 / Math.max(1, s.pop), fmt: (v) => `${fmtInt(v)} $`, log: true },
  pop: { label: 'Population', get: (s) => s.pop, fmt: (v) => `${num(v / 1e6)} M`, log: true },
  power: { label: 'Puissance militaire', get: (s) => powerOf(s), fmt: (v) => num(v, 0), log: true },
  soldiers: { label: 'Soldats', get: (s) => landTotal(s) * 1000, fmt: (v) => fmtInt(v), log: true },
  tech: { label: 'Technologie', get: (s) => s.p.tech, fmt: (v) => num(v) },
  stability: { label: 'Stabilité', get: (s) => s.stability * 100, fmt: (v) => `${Math.round(v)} %` },
  growth: { label: 'Croissance', get: (s) => (s.growthRate || 0) * 100, fmt: (v) => `${num(v)} %`, div: true },
  territory: { label: 'Territoire', get: (s) => s.km2 || s.cells, fmt: (v) => `${fmtInt(v)} km²`, log: true },
  debt: { label: 'Dette / PIB', get: (s) => s.debt / Math.max(0.1, s.eco.gdp) * 100, fmt: (v) => `${Math.round(v)} %`, inv: true },
  projects: { label: 'Technologies acquises', get: (s) => (s.dev ? s.dev.done.length : 0), fmt: (v) => String(v) },
};
export const MAP_MODES = [
  ['political', 'Politique', 'map'], ['gdp', 'Économie (PIB)', 'coins'], ['pc', 'Richesse par habitant', 'banknote'], ['power', 'Puissance militaire', 'swords'],
  ['tech', 'Technologie', 'cpu'], ['stability', 'Stabilité', 'scale'], ['growth', 'Croissance', 'trending-up'], ['pop', 'Population', 'users'],
  ['relations', 'Relations', 'handshake'], ['blocs', 'Alliances et coalitions', 'shield'], ['sanctions', 'Sanctions et crises', 'x-circle'],
];

export class WorldViews {
  constructor(app) {
    this.app = app; this.cmp = []; this.rankKey = 'gdp'; this.mapMode = 'political'; this._mapAt = 0;
    const t = document.createElement('template');
    t.innerHTML = `<div id="mapLegend" class="panel map-legend hidden"></div>`;
    document.body.appendChild(t.content.firstChild);
  }
  get sim() { return this.app.session.sim; }
  ent(e) { return this.app.entities()[e]; }
  alive() { return this.sim.sides.filter((s) => !s.eliminated); }

  // ---------------- classement mondial ----------------
  rankHtml() {
    const sim = this.sim, key = this.rankKey, M = METRICS[key];
    const list = this.alive().map((s) => ({ s, v: M.get(s) })).sort((a, b) => (M.inv ? a.v - b.v : b.v - a.v));
    // rang il y a un an (séries mensuelles : PIB, puissance, territoire, technologie)
    const col = { gdp: 2, power: 7, territory: 1, tech: 5 }[key];
    const prev = new Map();
    if (col !== undefined) {
      const past = this.alive().map((s) => { const r = s.series.length > 12 ? s.series[s.series.length - 13] : s.series[0]; return { s, v: r ? r[col] : 0 }; }).sort((a, b) => b.v - a.v);
      past.forEach((x, i) => prev.set(x.s.index, i));
    }
    return `<div class="seg wrap" data-rank>${Object.entries(METRICS).map(([k, x]) => `<button data-v="${k}" class="${k === key ? 'on' : ''}">${x.label}</button>`).join('')}</div>
      <table class="wp-table rank-table"><thead><tr><th>#</th><th>Pays</th><th>${M.label}</th><th>Évolution (1 an)</th></tr></thead><tbody>${list.slice(0, 100).map(({ s, v }, i) => {
        const p = prev.get(s.index); const d = p === undefined ? 0 : p - i;
        return `<tr data-e="${s.e}" class="${s.player ? 'me' : ''}"><td>${i + 1}</td><td class="cn">${flagImg(this.ent(s.e), 'flag sm')}<span>${esc(s.name)}</span></td><td>${M.fmt(v)}</td><td>${d > 0 ? `<span class="up">▲ ${d}</span>` : d < 0 ? `<span class="down">▼ ${-d}</span>` : '<span class="dim">=</span>'}</td></tr>`;
      }).join('')}</tbody></table>`;
  }

  // ---------------- comparateur ----------------
  cmpHtml() {
    const sim = this.sim;
    if (!this.cmp.length) { const me = sim.nv ? sim.nv.player : -1; this.cmp = (me >= 0 ? [me] : []).concat(this.alive().sort((a, b) => b.eco.gdp - a.eco.gdp).map((s) => s.index).filter((k) => k !== me)).slice(0, 3); }
    this.cmp = this.cmp.filter((k) => sim.sides[k] && !sim.sides[k].eliminated);
    const opts = this.alive().slice().sort((a, b) => a.name.localeCompare(b.name, 'fr'));
    const rows = Object.entries(METRICS).map(([k, M]) => {
      const vals = this.cmp.map((i) => M.get(sim.sides[i]));
      const best = M.inv ? Math.min(...vals) : Math.max(...vals);
      return `<tr><td>${M.label}</td>${vals.map((v) => `<td class="${v === best && vals.length > 1 ? 'best' : ''}">${M.fmt(v)}</td>`).join('')}</tr>`;
    }).join('');
    return `<div class="cmp-pick">${this.cmp.map((k, i) => `<span class="chip">${flagImg(this.ent(sim.sides[k].e), 'flag xs')}${esc(sim.sides[k].name)}<button data-cmprm="${i}" title="Retirer">${icon('x')}</button></span>`).join('')}
      ${this.cmp.length < 4 ? `<select id="cmpAdd"><option value="">+ Ajouter un pays…</option>${opts.filter((s) => !this.cmp.includes(s.index)).map((s) => `<option value="${s.index}">${esc(s.name)}</option>`).join('')}</select>` : ''}</div>
      <table class="wp-table cmp-table"><thead><tr><th></th>${this.cmp.map((k) => `<th>${esc(sim.sides[k].name)}</th>`).join('')}</tr></thead><tbody>${rows}</tbody></table>
      <h4>Évolution</h4><canvas class="nm-chart" data-cmpchart="2" height="150"></canvas><canvas class="nm-chart" data-cmpchart="7" height="150"></canvas><canvas class="nm-chart" data-cmpchart="5" height="130"></canvas><canvas class="nm-chart" data-cmpchart="1" height="130"></canvas>`;
  }
  _cmpChart(cv, idx) {
    const sim = this.sim;
    const label = { 2: 'PIB (Md$)', 7: 'Puissance militaire', 5: 'Technologie', 1: 'Territoire (parcelles)', 6: 'Stabilité (%)' }[idx];
    const list = this.cmp.map((k) => sim.sides[k]);
    const W = cv.clientWidth || 520, H = Number(cv.getAttribute('height'));
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    cv.width = W * dpr; cv.height = H * dpr; cv.style.height = H + 'px';
    const ctx = cv.getContext('2d'); ctx.scale(dpr, dpr);
    ctx.fillStyle = '#b4ae9f'; ctx.font = '600 11px Inter, sans-serif'; ctx.fillText(label, 8, 14);
    let mn = Infinity, mx = -Infinity, t0 = Infinity, t1 = -Infinity;
    for (const s of list) for (const r of s.series) { mn = Math.min(mn, r[idx]); mx = Math.max(mx, r[idx]); t0 = Math.min(t0, r[0]); t1 = Math.max(t1, r[0]); }
    if (!isFinite(mn) || t1 <= t0) { ctx.fillText('Données disponibles après quelques mois.', 8, H / 2); return; }
    const L = 8, R = W - 110, T = 24, B = H - 16;
    const X = (t) => L + (t - t0) / (t1 - t0) * (R - L), Y = (v) => B - (v - mn) / Math.max(1e-9, mx - mn) * (B - T);
    ctx.strokeStyle = 'rgba(232,225,207,0.07)'; for (let k = 0; k <= 3; k++) { const y = T + (B - T) * k / 3; ctx.beginPath(); ctx.moveTo(L, y); ctx.lineTo(R, y); ctx.stroke(); }
    ctx.fillStyle = 'rgba(232,225,207,0.45)'; ctx.font = '10px Inter, sans-serif';
    const ya = dateParts(t0, sim.cfg.startDay).y, yb = dateParts(t1, sim.cfg.startDay).y;
    for (let y = ya; y <= yb; y++) { const tt = ((y - 2025) * 365 - (sim.cfg.startDay || 0)) / 3; if (tt >= t0 && tt <= t1) ctx.fillText(String(y), X(tt) - 12, H - 3); }
    list.forEach((s, i) => {
      const col = this.app.renderer.colors[s.e] || '#ccc';
      ctx.strokeStyle = col; ctx.lineWidth = s.player ? 2.6 : 1.8;
      ctx.beginPath(); s.series.forEach((r, k) => (k ? ctx.lineTo(X(r[0]), Y(r[idx])) : ctx.moveTo(X(r[0]), Y(r[idx])))); ctx.stroke();
      ctx.fillStyle = col; ctx.font = '600 11px Inter, sans-serif';
      ctx.fillText(s.name.length > 14 ? s.name.slice(0, 13) + '…' : s.name, R + 8, T + 8 + i * 15);
    });
  }

  // ---------------- crises et sanctions ----------------
  crisesHtml() {
    const sim = this.sim;
    const act = activeCrises(sim), past = crisesOf(sim).filter((c) => !act.includes(c)).slice(-10).reverse();
    const sanc = sanctionsOf(sim);
    const name = (k) => (sim.sides[k] ? sim.sides[k].name : '?');
    const stage = { tension: '<span class="pill no">Tension</span>', conference: '<span class="pill co">Conférence</span>', global: '<span class="pill no">En cours</span>' };
    const out = { accord: '<span class="pill ok">Accord</span>', statu: '<span class="pill">Statu quo</span>', escalade: '<span class="pill no">Guerre</span>', over: '<span class="pill">Terminée</span>', void: '<span class="pill">Close</span>' };
    const card = (c, live) => `<div class="cr-card ${live ? 'live' : ''}"><div class="cr-head">${icon(CRISIS_TYPES[c.type].global ? 'trending-down' : 'activity')}<b>${esc(CRISIS_TYPES[c.type].label)}</b>${c.a >= 0 ? `<span>${esc(name(c.a))} / ${esc(name(c.b))}</span>` : '<span>Monde entier</span>'}${live ? stage[c.stage] || '' : out[c.outcome] || ''}</div>
      <ul>${c.log.slice(-4).map((l) => `<li><time>${fmtDate(l.t, sim.cfg.startDay, true)}</time><span>${esc(l.text)}</span></li>`).join('')}</ul></div>`;
    return `<h4>Crises en cours</h4>${act.length ? act.map((c) => card(c, true)).join('') : '<p class="hint">Aucune crise internationale en cours.</p>'}
      <h4>Sanctions économiques (${sanc.length})</h4>${sanc.length ? `<table class="wp-table"><thead><tr><th>Pays</th><th>Sanctionne</th><th>Depuis</th><th>Motif</th></tr></thead><tbody>${sanc.slice(-40).reverse().map((s) => `<tr><td class="cn">${flagImg(this.ent(sim.sides[s.by].e), 'flag xs')}<span>${esc(name(s.by))}</span></td><td class="cn">${flagImg(this.ent(sim.sides[s.on].e), 'flag xs')}<span>${esc(name(s.on))}</span></td><td>${fmtDate(s.t, sim.cfg.startDay, true)}</td><td>${esc(s.reason || '')}</td></tr>`).join('')}</tbody></table>` : '<p class="hint">Aucune sanction en vigueur.</p>'}
      ${past.length ? `<h4>Crises passées</h4>${past.map((c) => card(c, false)).join('')}` : ''}`;
  }

  // ---------------- cartes thématiques ----------------
  mapsHtml() {
    return `<p class="hint">Les pays prennent la couleur de la mesure choisie. Touche <b>K</b> : carte suivante.</p><div class="maps-grid">${MAP_MODES.map(([k, l, ic]) => `<button data-mapmode="${k}" class="${this.mapMode === k ? 'on' : ''}">${icon(ic)}<span>${l}</span></button>`).join('')}</div>`;
  }
  setMapMode(mode) {
    this.mapMode = mode;
    const r = this.app.renderer, sim = this.sim;
    if (!sim || mode === 'political') { r.setThematic(null); document.getElementById('mapLegend').classList.add('hidden'); return; }
    const S = sim.S, sideOfE = new Map(sim.sides.map((s) => [s.e, s]));
    let colorOf, legend;
    if (METRICS[mode]) {
      const M = METRICS[mode];
      const vals = this.alive().map((s) => M.get(s));
      const f = (v) => (M.log ? Math.log10(Math.max(1e-6, v)) : v);
      let lo = Math.min(...vals.map(f)), hi = Math.max(...vals.map(f));
      if (M.div) { const m = Math.max(Math.abs(lo), Math.abs(hi), 1e-6); lo = -m; hi = m; }
      colorOf = (e) => { const s = sideOfE.get(e.index); if (!s || s.eliminated) return null; const t = (f(M.get(s)) - lo) / Math.max(1e-9, hi - lo); return ramp(M.inv ? 1 - t : t, M.div ? DIV : SEQ); };
      legend = `<b>${M.label}</b><div class="lg-bar" style="background:linear-gradient(90deg, ${(M.div ? DIV : SEQ).join(',')})"></div><div class="lg-ends"><span>${M.inv ? 'élevé' : 'faible'}</span><span>${M.inv ? 'faible' : 'élevé'}</span></div>`;
    } else if (mode === 'relations') {
      const ref = sim.nv ? sim.nv.player : (this.app.hud && this.app.hud.selected >= 0 ? sim.sideOf[this.app.hud.selected] : -1);
      if (ref < 0 || ref === undefined) { colorOf = () => null; legend = '<b>Relations</b><small>Sélectionnez un pays.</small>'; }
      else {
        colorOf = (e) => { const s = sideOfE.get(e.index); if (!s || s.eliminated) return null; if (s.index === ref) return '#e3c47e'; if (sim.atWar[ref * S + s.index]) return '#a8352a'; if (sim.allied[ref * S + s.index]) return '#2f7f5a'; return ramp((sim.rel[ref * S + s.index] + 100) / 200, DIV); };
        legend = `<b>Relations avec ${esc(sim.sides[ref].name)}</b><div class="lg-bar" style="background:linear-gradient(90deg, ${DIV.join(',')})"></div><div class="lg-ends"><span>hostiles</span><span>excellentes</span></div><div class="lg-keys"><i style="background:#a8352a"></i>en guerre <i style="background:#2f7f5a"></i>allié</div>`;
      }
    } else if (mode === 'blocs') {
      // blocs d'alliés (composantes connexes) ; cibles des coalitions en rouge
      const bloc = new Map(); let nb = 0;
      for (let a = 0; a < S; a++) { if (bloc.has(a)) continue; const st = [a]; const comp = [a]; bloc.set(a, -1); while (st.length) { const x = st.pop(); for (let y = 0; y < S; y++) if (!bloc.has(y) && sim.allied[x * S + y]) { bloc.set(y, -1); st.push(y); comp.push(y); } } if (comp.length > 1) { for (const k of comp) bloc.set(k, nb); nb++; } }
      const pal = ['#5b8fd6', '#d6a35b', '#7cc28f', '#b88ad6', '#d6705b', '#5bc7c7', '#c7c25b', '#d65b9e'];
      const targets = new Set(activeCoalitions(sim).map((c) => c.target));
      const members = new Set(activeCoalitions(sim).flatMap((c) => c.members.map((m) => m.k)));
      colorOf = (e) => { const s = sideOfE.get(e.index); if (!s || s.eliminated) return null; if (targets.has(s.index)) return '#b23b2e'; const b = bloc.get(s.index); if (b >= 0) return pal[b % pal.length]; return members.has(s.index) ? '#e3c47e' : '#4a5560'; };
      legend = '<b>Alliances et coalitions</b><small>Une couleur par bloc d\'alliés.</small><div class="lg-keys"><i style="background:#b23b2e"></i>cible d\'une coalition <i style="background:#e3c47e"></i>membre de coalition <i style="background:#4a5560"></i>non aligné</div>';
    } else if (mode === 'sanctions') {
      const sanc = sanctionsOf(sim); const on = new Map(), by = new Set(); for (const s of sanc) { on.set(s.on, (on.get(s.on) || 0) + 1); by.add(s.by); }
      const crisis = new Set(); for (const c of activeCrises(sim)) { crisis.add(c.a); crisis.add(c.b); }
      colorOf = (e) => { const s = sideOfE.get(e.index); if (!s || s.eliminated) return null; if (on.has(s.index)) return ramp(Math.min(1, on.get(s.index) / 6) * 0.5 + 0.5, ['#7d8389', '#d99a7c', '#a8352a']); if (crisis.has(s.index)) return '#e0b25c'; if (by.has(s.index)) return '#6f8fb4'; return '#4a5560'; };
      legend = '<b>Sanctions et crises</b><div class="lg-keys"><i style="background:#a8352a"></i>sous sanctions <i style="background:#6f8fb4"></i>impose des sanctions <i style="background:#e0b25c"></i>en crise</div>';
    }
    r.setThematic(colorOf);
    const lg = document.getElementById('mapLegend');
    lg.innerHTML = `${legend}<button class="btn ghost xs" data-mapoff>${icon('x')}<span>Carte politique</span></button>`;
    lg.classList.remove('hidden');
    lg.querySelector('[data-mapoff]').onclick = () => { this.setMapMode('political'); if (this.app.gameNav.isOpen() && this.app.gameNav.tab === 'maps') this.app.gameNav.renderTab(true); };
  }
  nextMap() { const i = MAP_MODES.findIndex((m) => m[0] === this.mapMode); this.setMapMode(MAP_MODES[(i + 1) % MAP_MODES.length][0]); }
  update() { if (this.mapMode !== 'political' && this.sim && performance.now() - this._mapAt > 2000) { this._mapAt = performance.now(); this.setMapMode(this.mapMode); } }

  bind(tab, body, rerender) {
    if (tab === 'rank') body.querySelectorAll('[data-rank] button').forEach((b) => b.addEventListener('click', () => { this.rankKey = b.dataset.v; rerender(); }));
    if (tab === 'cmp') {
      body.querySelectorAll('[data-cmprm]').forEach((b) => b.addEventListener('click', (e) => { e.stopPropagation(); this.cmp.splice(Number(b.dataset.cmprm), 1); if (!this.cmp.length) this.cmp = [-1]; rerender(); }));
      const add = body.querySelector('#cmpAdd'); if (add) add.addEventListener('change', () => { if (add.value !== '') { this.cmp = this.cmp.filter((k) => k >= 0); this.cmp.push(Number(add.value)); rerender(); } });
      body.querySelectorAll('canvas[data-cmpchart]').forEach((cv) => this._cmpChart(cv, Number(cv.dataset.cmpchart)));
    }
    if (tab === 'maps') body.querySelectorAll('[data-mapmode]').forEach((b) => b.addEventListener('click', () => { this.setMapMode(b.dataset.mapmode); rerender(); }));
  }
}
