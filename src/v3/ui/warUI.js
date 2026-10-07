// UI — fin de guerre et histoire : écran WAR ENDED, WAR REPORT (chronologie défilante, batailles
// cliquables, cartes BEFORE / AFTER / CHANGES), liste des guerres, WORLD HISTORY.
// Les rapports restent des données de simulation abstraites (territoires, dates, effectifs).
import { warEndSummary } from '../sim/warEnd.js';
import { $, show, isShown, esc, notice } from './util.js';
import { icon } from './icons.js';
import { fmtDate, fmtDuration, DAYS_PER_SEC } from '../sim/calendar.js';
import { END_REASONS, decodeDiff, warLabel, statSnap } from '../sim/wars.js';

const NONE = 65535;
const km2 = (v) => `${Math.round(v).toLocaleString('fr-FR')} km²`;
const pct = (v) => `${v >= 0 ? '+' : '−'}${Math.abs(v * 100).toFixed(1).replace('.', ',')} %`;
export const CHRON_TYPES = {
  war: ['Guerre', 'swords', '#ff7a6b'], battle: ['Bataille', 'flag', '#f0a35a'], treaty: ['Traité', 'scroll-text', '#8fd694'],
  border: ['Frontières', 'map', '#6ea8ff'], alliance: ['Alliance', 'handshake', '#b48cff'], crisis: ['Crise', 'trending-down', '#ff6f6f'],
  power: ['Puissance', 'crown', '#f0c35a'], elimination: ['Disparition', 'x-circle', '#9aa3b2'], creation: ['Création', 'sparkles', '#5fd3c6'],
  tension: ['Tensions', 'activity', '#9aa3b2'], sim: ['Simulation', 'history', '#6ea8ff'],
  economy: ['Économie', 'coins', '#8fd694'], demography: ['Démographie', 'users', '#c9b38a'], tech: ['Technologie', 'cpu', '#6ea8ff'], diplomacy: ['Diplomatie', 'handshake', '#b48cff'], politics: ['Politique', 'landmark', '#e0b25c'],
};

export class WarUI {
  constructor(app) {
    this.app = app;
    this.report = null;
    this.mapMode = null;
    this.histFilter = 'all';
    $('weReport').onclick = () => { const id = this.ended; this.hideEnded(false); this.openReport(this.liveWar(id)); };
    $('weBorders').onclick = () => { const id = this.ended; this.hideEnded(false); const d = this.liveWar(id); if (d) { this.openReport(d); this.setMap('after'); this.flyTo(d); } };
    $('weContinue').onclick = () => this.hideEnded(true);
    $('wrClose').onclick = () => this.closeReport();
    $('wrMap').addEventListener('click', (e) => { const b = e.target.closest('[data-map]'); if (b) this.setMap(b.dataset.map); });
    $('wrTabs').addEventListener('click', (e) => { const b = e.target.closest('[data-tab]'); if (b) this.tab(b.dataset.tab); });
    $('warsClose').onclick = () => { show('warsPanel', false); this.app.resumeAfterOverlay(); };
    $('whClose').onclick = () => { show('worldHistoryPanel', false); this.app.resumeAfterOverlay(); };
    $('whFilters').addEventListener('click', (e) => { const b = e.target.closest('[data-f]'); if (b) { this.histFilter = b.dataset.f; this.renderHistory(); } });
    $('whSearch').addEventListener('input', () => this.renderHistory());
    $('whSearch').addEventListener('keydown', (e) => e.stopPropagation());
  }

  get sim() { return this.app.session.sim; }
  colorOf(e) { return this.app.renderer.colors[e] || (this.app.entities()[e] || {}).color || '#888'; }
  nameOf(e) { const x = this.app.entities()[e]; return x ? x.name : 'Zone neutre'; }
  chip(e) { return `<span class="chip"><i class="dot" style="background:${this.colorOf(e)}"></i>${esc(this.nameOf(e))}</span>`; }

  // ---------- données d'une guerre (en cours de simulation ou archivée dans le monde) ----------
  liveWar(id) {
    const sim = this.sim;
    if (!sim) return null;
    const w = sim.wars.find((x) => x.id === id);
    if (!w) return null;
    const E = (k) => sim.sides[k].e;
    const d0 = sim.cfg.startDay || 0;
    const rep = w.report || {};
    return {
      live: true, id: w.id, name: w.name, status: w.status, startDay: d0, start: w.start, end: w.end ?? sim.time,
      a: w.a.map(E), b: w.b.map(E), result: rep.result || (w.status === 'active' ? 'Guerre en cours' : 'Négociations'),
      winner: rep.winner || [], reason: w.endReason, territories: rep.territories || this._liveTerritories(sim, w), zones: rep.zones || [],
      battles: w.battles, moments: w.moments, timeline: w.timeline.map((p) => ({ t: p.t, m: p.m.map(E), c: p.c, u: p.u })),
      diff: w.diff || this._liveDiff(sim, w), treaty: w.treaty, units: rep.units || {}, compare: rep.compare || this._liveCompare(sim, w),
    };
  }
  archived(a) {
    return {
      live: false, id: a.uid, name: a.name, status: 'ended', startDay: a.startDay, start: a.start, end: a.end, a: a.a, b: a.b,
      result: a.report ? a.report.result : '', winner: a.report ? a.report.winner : [], reason: a.endReason,
      territories: a.report ? a.report.territories : [], zones: a.report ? a.report.zones : [], battles: a.battles || [], moments: a.moments || [],
      timeline: a.timeline || [], diff: decodeDiff(a.diff), treaty: a.treaty, units: a.report ? a.report.units || {} : {}, compare: a.report ? a.report.compare || null : null,
    };
  }
  // comparaison AVANT GUERRE / MAINTENANT pendant une guerre en cours
  _liveCompare(sim, w) {
    if (!w.before) return null;
    const out = {};
    for (const k of [...w.a, ...w.b]) {
      const b = w.before[k];
      if (!b) continue;
      const af = statSnap(sim, k);
      const lost = Math.max(0, af.losses - b.losses) * 1000;
      out[sim.sides[k].e] = { name: sim.sides[k].name, coalition: w.a.includes(k) ? 'a' : 'b', before: b, after: af, live: true,
        losses: { personnel: Math.round(lost), wounded: Math.round(lost * 2.4), armor: Math.round(Math.max(0, af.lossArm - b.lossArm) * 10) / 10, artillery: Math.round(Math.max(0, af.lossArt - b.lossArt) * 10) / 10, air: Math.round(Math.max(0, b.air - af.air) * 10) / 10, navy: Math.round(Math.max(0, b.navy - af.navy) * 10) / 10, gdpPct: b.gdp > 0 ? Math.round((af.gdp / b.gdp - 1) * 1000) / 10 : 0, debt: Math.round((af.debt - b.debt) * 10) / 10, recruited: Math.round(Math.max(0, af.recruited - b.recruited) * 1000) } };
    }
    return out;
  }
  _liveDiff(sim, w) {
    const cells = [], before = [], after = [];
    for (const [c, pre] of w.changes) if (sim.owner[c] !== pre) { cells.push(c); before.push(pre); after.push(sim.owner[c]); }
    return { cells, before, after };
  }
  _liveTerritories(sim, w) {
    const geo = sim.geo;
    return [...w.a, ...w.b].map((k) => {
      const sd = sim.sides[k];
      let gained = 0, lost = 0;
      for (const [c, pre] of w.changes) { const now = sim.owner[c]; if (now === pre) continue; if (now === sd.e) gained += geo.km2[c]; if (pre === sd.e) lost += geo.km2[c]; }
      return { e: sd.e, name: sd.name, coalition: w.a.includes(k) ? 'a' : 'b', finalKm2: sd.km2, initialKm2: sd.km2 - gained + lost, gainedKm2: gained, lostKm2: lost };
    });
  }
  date(d, t, short = false) { return fmtDate(t, d.startDay, short); }

  // ---------- WAR ENDED ----------
  showEnded(warId) {
    const d = this.liveWar(warId);
    if (!d) return;
    this.ended = warId;
    this.app.pauseForOverlay();
    const win = d.winner.length ? d.winner : null;
    const main = win ? win[0] : d.a[0];
    const t = d.territories.find((x) => x.e === main) || { initialKm2: 1, finalKm2: 1 };
    const delta = t.initialKm2 ? (t.finalKm2 - t.initialKm2) / t.initialKm2 : 0;
    $('weWinner').innerHTML = win ? `${win.map((e) => `<i class="dot" style="background:${this.colorOf(e)}"></i>${esc(this.nameOf(e))}`).join(' · ')}` : 'Aucun vainqueur';
    $('weTitle').textContent = win ? 'Victoire' : 'Paix de compromis';
    $('weReason').textContent = END_REASONS[d.reason] || '';
    $('weWar').textContent = d.name;
    $('weTerritory').textContent = pct(delta);
    $('weTerritory').className = delta >= 0 ? 'up' : 'down';
    $('weDuration').textContent = fmtDuration(d.end - d.start);
    $('weDates').textContent = `${this.date(d, d.start)} → ${this.date(d, d.end)}`;
    $('weChanges').innerHTML = d.zones.length ? d.zones.slice(0, 4).map((z) => `<li><i class="dot" style="background:${this.colorOf(z.to)}"></i><span>${esc(z.name)}</span><small>→ ${esc(z.toName)} · ${km2(z.km2)}</small></li>`).join('') : '<li class="hint">Aucun changement de frontière.</li>';
    const el = $('warEnded');
    el.classList.remove('play'); void el.offsetWidth; el.classList.add('play');
    show('warEnded');
  }
  hideEnded(resume) {
    show('warEnded', false);
    if (resume) this.app.resumeAfterOverlay();
  }

  // ---------- WAR REPORT ----------
  openReport(d) {
    if (!d) return;
    this.report = d;
    this.app.pauseForOverlay();
    const parts = (list) => list.map((e) => this.chip(e)).join('');
    $('wrName').textContent = d.name;
    $('wrResult').textContent = d.result;
    $('wrResult').className = 'pill ' + (d.status === 'ended' ? 'done' : 'live');
    $('wrMeta').innerHTML = `${icon('calendar')}<span>${this.date(d, d.start)} → ${d.status === 'ended' ? this.date(d, d.end) : 'en cours'}</span>${icon('clock')}<span>${fmtDuration(d.end - d.start)}</span>`;
    $('wrSides').innerHTML = `<div class="wr-coal">${parts(d.a)}</div><b class="vs">VS</b><div class="wr-coal">${parts(d.b)}</div>`;
    show('warReport');
    document.body.classList.add('report-on');
    this.tab(this.curTab || 'summary');
    this.setMap(d.diff && d.diff.cells.length ? 'changes' : null);
  }
  closeReport() {
    this.setMap(null);
    show('warReport', false);
    document.body.classList.remove('report-on');
    this.report = null;
    this.app.resumeAfterOverlay();
    if (this.onClose) { const f = this.onClose; this.onClose = null; f(); }
  }
  tab(name) {
    this.curTab = name;
    document.querySelectorAll('#wrTabs [data-tab]').forEach((b) => b.classList.toggle('on', b.dataset.tab === name));
    const d = this.report;
    const body = $('wrBody');
    if (!d) return;
    if (name === 'summary') body.innerHTML = this._summary(d);
    else if (name === 'territory') body.innerHTML = this._territory(d);
    else if (name === 'timeline') { body.innerHTML = this._timeline(d); this._drawTimeline(d); }
    else if (name === 'battles') body.innerHTML = this._battles(d);
    else if (name === 'treaty') body.innerHTML = this._treaty(d);
    else if (name === 'compare') body.innerHTML = this._compare(d);
    body.querySelectorAll('[data-cell]').forEach((el) => el.addEventListener('click', () => {
      const c = Number(el.dataset.cell);
      if (c >= 0) { this.app.session.flyToCell(c, 1.35, 1.8); this.app.renderer.pulse(c, '#ffd65a', 1); body.querySelectorAll('.sel').forEach((x) => x.classList.remove('sel')); el.classList.add('sel'); }
    }));
    body.scrollTop = 0;
  }
  _summary(d) {
    const rows = d.territories.map((t) => {
      const delta = t.initialKm2 ? (t.finalKm2 - t.initialKm2) / t.initialKm2 : 0;
      return `<tr><td>${this.chip(t.e)}</td><td>${km2(t.initialKm2)}</td><td>${km2(t.finalKm2)}</td><td class="${delta >= 0 ? 'up' : 'down'}">${pct(delta)}</td></tr>`;
    }).join('');
    const major = d.battles.filter((b) => !b.naval).sort((x, y) => (y.gained + y.lost) - (x.gained + x.lost)).slice(0, 3);
    return `
      <div class="wr-grid">
        <div class="stat"><small>Résultat</small><b>${esc(d.result)}</b></div>
        <div class="stat"><small>Durée</small><b>${fmtDuration(d.end - d.start)}</b></div>
        <div class="stat"><small>Batailles</small><b>${d.battles.length}</b></div>
        <div class="stat"><small>Territoire transféré</small><b>${km2(d.diff ? d.diff.cells.reduce((s, c) => s + this._km2(c), 0) : 0)}</b></div>
      </div>
      <h4>Territoires</h4>
      <table class="wr-table"><thead><tr><th>Pays</th><th>Avant</th><th>Après</th><th>Évolution</th></tr></thead><tbody>${rows}</tbody></table>
      <h4>Principales zones ayant changé de propriétaire</h4>
      ${this._zones(d)}
      ${major.length ? `<h4>Batailles majeures</h4><ul class="wr-list">${major.map((b) => this._battleRow(d, b)).join('')}</ul>` : ''}`;
  }
  // AVANT GUERRE / APRÈS GUERRE et bilan statistique des pertes (forme abstraite)
  _compare(d) {
    const c = d.compare;
    if (!c || !Object.keys(c).length) return '<p class="hint">Comparaison indisponible pour cette guerre (ancienne sauvegarde).</p>';
    const n = (v) => Math.round(v).toLocaleString('fr-FR');
    const bn = (v) => `${(Math.round(v * 10) / 10).toLocaleString('fr-FR')} Md$`;
    const dl = (a, b, fmt = n, inv = false) => { const dd = b - a; if (Math.abs(dd) < 1e-9) return '<em class="flat">=</em>'; const good = inv ? dd < 0 : dd > 0; return `<em class="${good ? 'up' : 'down'}">${dd > 0 ? '+' : '−'}${fmt(Math.abs(dd))}</em>`; };
    const rows = [
      ['Population', (x) => x.pop, n], ['Territoire', (x) => x.km2, (v) => km2(v)], ['PIB', (x) => x.gdp, bn], ['Trésorerie', (x) => x.money, bn],
      ['Dette', (x) => x.debt, bn, true], ['Budget militaire', (x) => x.milBudget, bn], ['Personnel militaire', (x) => x.personnel, n], ['Groupes', (x) => x.groups, n],
      ['Stabilité', (x) => x.stability, (v) => v + ' %'], ['Relations (moyenne)', (x) => x.relAvg, n], ['Alliés', (x) => x.allies, n],
    ];
    const live = Object.values(c).some((x) => x.live);
    return `<p class="hint">${live ? 'Guerre en cours : comparaison entre l\'entrée en guerre et aujourd\'hui.' : 'Comparaison entre l\'entrée en guerre et la signature du traité.'} Les pertes sont des statistiques agrégées du modèle.</p>` +
      Object.entries(c).map(([e, x]) => `
      <div class="cmp-card">
        <div class="cmp-head">${this.chip(Number(e))}<small>${x.coalition === 'a' ? 'Camp 1' : 'Camp 2'}</small></div>
        <table class="wr-table cmp"><thead><tr><th></th><th>Avant guerre</th><th>${live ? 'Aujourd\'hui' : 'Après guerre'}</th><th>Écart</th></tr></thead><tbody>
          ${rows.map(([l, f, fmt, inv]) => `<tr><td>${l}</td><td>${fmt(f(x.before))}</td><td>${fmt(f(x.after))}</td><td>${dl(f(x.before), f(x.after), fmt, inv)}</td></tr>`).join('')}
        </tbody></table>
        <div class="cmp-loss">
          <div><small>Personnel perdu</small><b>${n(x.losses.personnel)}</b></div>
          <div><small>Blessés (estimation)</small><b>${n(x.losses.wounded)}</b></div>
          <div><small>Recrutés</small><b>${n(x.losses.recruited)}</b></div>
          <div><small>Matériel blindé</small><b>−${String(x.losses.armor).replace('.', ',')} gr.</b></div>
          <div><small>Artillerie</small><b>−${String(x.losses.artillery).replace('.', ',')} gr.</b></div>
          <div><small>Aviation / marine</small><b>−${String(x.losses.air).replace('.', ',')} / −${String(x.losses.navy).replace('.', ',')}</b></div>
          <div><small>Impact sur le PIB</small><b class="${x.losses.gdpPct >= 0 ? 'up' : 'down'}">${x.losses.gdpPct >= 0 ? '+' : ''}${String(x.losses.gdpPct).replace('.', ',')} %</b></div>
          <div><small>Dette supplémentaire</small><b>${bn(x.losses.debt)}</b></div>
        </div>
      </div>`).join('');
  }
  _km2(c) { const g = this.app.geoFor(this.app.world); return g ? g.km2[c] : 770; }
  _zones(d) {
    return d.zones.length ? `<ul class="wr-list">${d.zones.map((z) => `<li data-cell="${z.cell}"><i class="dot" style="background:${this.colorOf(z.to)}"></i><div><b>${esc(z.name)}</b><small>${esc(z.fromName)} → ${esc(z.toName)}</small></div><span>${km2(z.km2)}</span>${icon('locate')}</li>`).join('')}</ul>` : '<p class="hint">Aucune zone n\'a changé de propriétaire.</p>';
  }
  _territory(d) {
    const rows = d.territories.map((t) => `<tr><td>${this.chip(t.e)}</td><td>${t.coalition === 'a' ? 'Camp 1' : 'Camp 2'}</td><td>${km2(t.initialKm2)}</td><td>${km2(t.finalKm2)}</td><td class="up">+${km2(t.gainedKm2)}</td><td class="down">−${km2(t.lostKm2)}</td></tr>`).join('');
    const u = Object.entries(d.units || {}).map(([e, v]) => `<tr><td>${this.chip(Number(e))}</td><td>${v.initial.toLocaleString('fr-FR')}</td><td>${v.final.toLocaleString('fr-FR')}</td></tr>`).join('');
    return `<table class="wr-table"><thead><tr><th>Pays</th><th>Camp</th><th>Initial</th><th>Final</th><th>Gagné</th><th>Perdu</th></tr></thead><tbody>${rows}</tbody></table>
      <p class="hint">Les cartes AVANT / APRÈS / CHANGEMENTS (en haut) montrent la géométrie exacte.</p>
      <h4>Zones</h4>${this._zones(d)}
      ${u ? `<h4>Effectifs (soldats)</h4><table class="wr-table"><thead><tr><th>Pays</th><th>Début</th><th>Fin</th></tr></thead><tbody>${u}</tbody></table>` : ''}`;
  }
  _timeline(d) {
    const ms = [...d.moments].sort((a, b) => a.t - b.t);
    return `<div class="wr-chart-scroll" id="wrChartScroll"><canvas id="wrChart" height="190"></canvas></div>
      <div class="wr-legend">${[...new Set([...d.a, ...d.b])].map((e) => this.chip(e)).join('')}</div>
      <h4>Chronologie</h4>
      <ol class="wr-steps">${ms.map((m) => `<li class="k-${m.type}" ${m.cell >= 0 && m.cell !== undefined ? `data-cell="${m.cell}"` : ''}><time>${this.date(d, m.t)}</time><span>${esc(m.text)}</span></li>`).join('')}</ol>`;
  }
  _drawTimeline(d) {
    const cv = $('wrChart');
    const tl = d.timeline;
    if (!cv || tl.length < 2) return;
    const wrap = $('wrChartScroll');
    const W = Math.max(wrap.clientWidth || 520, tl.length * 7), H = 190;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    cv.style.width = W + 'px'; cv.width = W * dpr; cv.height = H * dpr;
    const ctx = cv.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const t0 = tl[0].t, t1 = tl[tl.length - 1].t || t0 + 1;
    const members = [...new Set(tl.flatMap((p) => p.m))];
    let max = 1;
    for (const p of tl) for (const v of p.c) max = Math.max(max, v);
    const X = (t) => 36 + (t - t0) / Math.max(1e-6, t1 - t0) * (W - 50), Y = (v) => 12 + (1 - v / max) * (H - 40);
    ctx.strokeStyle = 'rgba(255,255,255,0.07)'; ctx.lineWidth = 1;
    ctx.fillStyle = 'rgba(255,255,255,0.45)'; ctx.font = '10px Inter, sans-serif';
    for (let k = 0; k <= 4; k++) { const y = 12 + k * (H - 40) / 4; ctx.beginPath(); ctx.moveTo(36, y); ctx.lineTo(W - 10, y); ctx.stroke(); }
    // repères de temps (mois)
    const pxPerSec = (W - 50) / Math.max(1e-6, t1 - t0);
    const step = Math.max(1, Math.ceil(80 / pxPerSec / 10)) * 10;
    ctx.textAlign = 'center';
    for (let t = Math.ceil(t0 / step) * step; t <= t1; t += step) ctx.fillText(fmtDate(t, d.startDay, true), X(t), H - 12);
    for (const e of members) {
      ctx.strokeStyle = this.colorOf(e); ctx.lineWidth = 2; ctx.beginPath();
      let first = true;
      for (const p of tl) { const k = p.m.indexOf(e); if (k < 0) continue; const x = X(p.t), y = Y(p.c[k]); if (first) { ctx.moveTo(x, y); first = false; } else ctx.lineTo(x, y); }
      ctx.stroke();
    }
    // moments importants
    for (const m of d.moments) {
      const x = X(m.t);
      ctx.strokeStyle = m.type === 'battle' ? 'rgba(240,163,90,0.55)' : m.type === 'treaty' || m.type === 'victory' ? 'rgba(143,214,148,0.6)' : 'rgba(255,255,255,0.25)';
      ctx.setLineDash([3, 3]); ctx.beginPath(); ctx.moveTo(x, 12); ctx.lineTo(x, H - 28); ctx.stroke(); ctx.setLineDash([]);
    }
    ctx.textAlign = 'left'; ctx.fillStyle = 'rgba(255,255,255,0.45)';
    ctx.fillText('Parcelles', 4, 10);
  }
  _battleRow(d, b) {
    const dur = fmtDuration(Math.max(0.3, (b.t1 || b.t0) - b.t0));
    return `<li data-cell="${b.cell}" class="battle"><div><b>${esc(b.name)}</b><small>${this.date(d, b.t0)} · ${esc(b.region || '')} · ${dur}</small>
      <small>${esc(b.attackerName)} contre ${esc(b.defenderName)} · ${b.soldiers.toLocaleString('fr-FR')} soldats engagés${b.gained || b.lost ? ` · territoire : +${km2(b.km2Gained)} / −${km2(b.km2Lost)}` : ''}</small></div>
      <span class="res">${esc(b.result)}</span>${icon('locate')}</li>`;
  }
  _battles(d) {
    if (!d.battles.length) return '<p class="hint">Aucun affrontement important enregistré.</p>';
    return `<p class="hint">Cliquez sur une bataille pour voir sa position sur la carte.</p><ul class="wr-list">${[...d.battles].sort((a, b) => a.t0 - b.t0).map((b) => this._battleRow(d, b)).join('')}</ul>`;
  }
  _treaty(d) {
    const t = d.treaty;
    if (!t) return '<p class="hint">Le traité de paix n\'est pas encore signé.</p>';
    const tr = t.transfers.filter((x) => x.cells > 0);
    return `<div class="treaty">
      <div class="treaty-head">${icon('scroll-text')}<div><b>Traité de paix</b><small>signé le ${this.date(d, d.end)} · durée de la guerre ${fmtDuration(t.duration)}</small></div></div>
      <div class="wr-grid">
        <div class="stat"><small>Vainqueur</small><b>${t.winner.length ? t.winner.map((e) => esc(this.nameOf(e))).join(', ') : 'Aucun'}</b></div>
        <div class="stat"><small>Perdant</small><b>${t.loser.length ? t.loser.map((e) => esc(this.nameOf(e))).join(', ') : 'Aucun'}</b></div>
        <div class="stat"><small>Motif</small><b>${esc(END_REASONS[t.reason] || '')}</b></div>
        <div class="stat"><small>Territoires rendus</small><b>${t.returned} parcelle(s)</b></div>
      </div>
      <h4>Territoires transférés</h4>
      ${tr.length ? `<ul class="wr-list">${tr.map((x) => `<li><i class="dot" style="background:${this.colorOf(x.to)}"></i><div><b>${esc(x.fromName)} → ${esc(x.toName)}</b></div><span>${km2(x.km2)}</span></li>`).join('')}</ul>` : '<p class="hint">Aucun transfert : retour aux frontières d\'avant-guerre.</p>'}
      <h4>Réorganisation territoriale (anti-enclave / border cleanup)</h4>
      <div class="wr-grid">
        <div class="stat"><small>Enclaves supprimées</small><b>${t.cleanup.enclaves || 0}</b></div>
        <div class="stat"><small>Exclaves et fragments rattachés</small><b>${(t.cleanup.exclaves || 0) + (t.cleanup.holes || 0)}</b></div>
        <div class="stat"><small>Îles rendues / libérées</small><b>${t.cleanup.islands || 0}</b></div>
        <div class="stat"><small>Parcelles de frontière redessinées</small><b>${(t.cleanup.relaxed || 0) + (t.cleanup.smoothed || 0)}</b></div>
      </div>
      <p class="hint">Chaque fragment isolé est rattaché au territoire voisin qui le borde le plus (ou rendu à son ancien propriétaire), puis la nouvelle frontière est redessinée sur une bande étroite en suivant le relief, les crêtes et les rivières. Les conquêtes réelles sont conservées ; chaque pays reste d'un seul tenant.</p>
      <h4>Relations après la guerre</h4>
      <p class="hint">Les anciens belligérants restent méfiants : relations dégradées selon le résultat, les territoires perdus et la durée du conflit, et trêve pendant plusieurs mois. Les IA en tiennent compte (consolidation pour les vainqueurs, reconstruction et fortification pour les vaincus).</p>
    </div>`;
  }

  // ---------- cartes BEFORE / AFTER / CHANGES ----------
  setMap(mode) {
    const d = this.report;
    document.querySelectorAll('#wrMap [data-map]').forEach((b) => b.classList.toggle('on', b.dataset.map === (mode || 'now')));
    const r = this.app.renderer;
    const sim = this.sim;
    const base = sim ? sim.owner : this.app.world.owner;
    if (!mode || mode === 'now' || !d || !d.diff) {
      this.mapMode = null;
      if (sim) r.setWorldOwner(sim.owner, new Set(sim.sides.map((s) => s.e)), sim.occupied);
      else r.setWorldOwner(this.app.world.owner, null);
      this.app.labels.invalidate();
      return;
    }
    this.mapMode = mode;
    const owner = mode === 'changes' ? new Uint16Array(base.length).fill(NONE) : Uint16Array.from(base);
    const { cells, before, after } = d.diff;
    for (let k = 0; k < cells.length; k++) owner[cells[k]] = mode === 'before' ? before[k] : after[k];
    const parts = new Set([...d.a, ...d.b]);
    r.setWorldOwner(owner, parts, null);
    this.app.labels.invalidate();
    if (mode === 'changes' && !cells.length) notice('Aucune parcelle n\'a changé de propriétaire.');
  }
  flyTo(d) {
    if (d.zones && d.zones[0]) this.app.session.flyToCell(d.zones[0].cell, 1.6, 1.4);
  }

  // ---------- liste des guerres ----------
  openWars() {
    this.app.pauseForOverlay();
    const sim = this.sim;
    const world = this.app.world;
    const live = sim ? sim.wars.map((w) => ({ w, d: null })) : [];
    let html = '';
    if (sim) {
      const we = sim.cfg.warEnd || {};
      html += `<div class="we-bar"><span>${icon('scroll-text')}</span><div><b>Fin des guerres</b><small>${esc(warEndSummary(we))}</small></div><button class="btn ghost sm" id="wpWarEnd">${icon('sliders-horizontal')}<span>Modifier</span></button></div>`;
      html += `<h4>Cette simulation</h4>`;
      if (!live.length) html += '<p class="hint">Aucune guerre pour l\'instant.</p>';
      html += `<ul class="wr-list">${live.slice().reverse().map(({ w }) => {
        const st = w.status === 'active' ? '<span class="pill live">En cours</span>' : w.status === 'negotiating' ? '<span class="pill">Négociations</span>' : '<span class="pill done">Terminée</span>';
        const sh = w.status === 'active' ? ` · ${warLabel(sim, w)} · occupé : ${Math.round((w.shareA || 0) * 100)} % / ${Math.round((w.shareB || 0) * 100)} %${w.risk ? ` · risque de capitulation : ${Math.round(w.risk.a * 100)} % / ${Math.round(w.risk.b * 100)} %` : ''}` : w.report ? ` · ${esc(w.report.result)}` : '';
        return `<li data-live="${w.id}"><div><b>${esc(w.name)}</b><small>${sim.dateStr(w.start)} · ${fmtDuration((w.end ?? sim.time) - w.start)}${sh}</small></div>${st}${icon('chevron-right')}</li>`;
      }).join('')}</ul>`;
    }
    const arch = (world.chronicle && world.chronicle.wars) || [];
    html += `<h4>Histoire du monde (${arch.length})</h4>`;
    html += arch.length ? `<ul class="wr-list">${arch.slice().reverse().map((a) => `<li data-arch="${esc(a.uid)}"><div><b>${esc(a.name)}</b><small>${fmtDate(a.start, a.startDay)} · ${fmtDuration(a.end - a.start)} · ${esc(a.report ? a.report.result : '')}</small></div><span class="pill done">Archivée</span>${icon('chevron-right')}</li>`).join('')}</ul>` : '<p class="hint">Les guerres terminées sont enregistrées dans le monde quand vous le sauvegardez ou le continuez.</p>';
    $('warsBody').innerHTML = html;
    if ($('wpWarEnd')) $('wpWarEnd').onclick = () => this.app.warEndUI.open({ warEnd: sim.cfg.warEnd, nation: !!sim.nv, title: 'Fin des guerres (partie en cours)', onDone: (we) => { this.app.act({ op: 'warEnd', we }); if (this.app.lastSetup && this.app.lastSetup.options) this.app.lastSetup.options.warEnd = { ...we }; }, onClose: () => this.openWars() });
    $('warsBody').querySelectorAll('[data-live]').forEach((li) => li.addEventListener('click', () => { show('warsPanel', false); this.openReport(this.liveWar(Number(li.dataset.live))); }));
    $('warsBody').querySelectorAll('[data-arch]').forEach((li) => li.addEventListener('click', () => { const a = arch.find((x) => x.uid === li.dataset.arch); show('warsPanel', false); this.openReport(this.archived(a)); }));
    show('warsPanel');
  }

  // ---------- WORLD HISTORY ----------
  historyEvents() {
    const w = this.app.world;
    const list = ((w.chronicle && w.chronicle.events) || []).map((e) => ({ ...e }));
    const sim = this.sim;
    if (sim) {
      const d0 = sim.cfg.startDay || 0;
      for (const ev of sim.chronicle) list.push({ day: Math.round(d0 + ev.t * DAYS_PER_SEC), type: ev.type, text: ev.text, cell: ev.cell, e: ev.e, liveWar: ev.war, live: true });
    }
    (w.history || []).forEach((h) => { if (h.title && h.year > 1 && h.day !== undefined) list.push({ day: h.day, type: 'sim', text: `${h.title}. ${h.text}` }); });
    return list.sort((a, b) => a.day - b.day);
  }
  openHistory() {
    this.app.pauseForOverlay();
    const f = $('whFilters');
    const types = ['all', 'war', 'battle', 'treaty', 'border', 'alliance', 'crisis', 'power', 'elimination', 'creation'];
    f.innerHTML = types.map((t) => `<button data-f="${t}">${t === 'all' ? 'Tout' : CHRON_TYPES[t][0]}</button>`).join('');
    this.renderHistory();
    show('worldHistoryPanel');
  }
  renderHistory() {
    document.querySelectorAll('#whFilters [data-f]').forEach((b) => b.classList.toggle('on', b.dataset.f === this.histFilter));
    const q = ($('whSearch').value || '').trim().toLowerCase();
    const evs = this.historyEvents().filter((e) => (this.histFilter === 'all' || e.type === this.histFilter) && (!q || e.text.toLowerCase().includes(q)));
    const body = $('whBody');
    if (!evs.length) { body.innerHTML = '<p class="hint">Aucun événement. L\'histoire du monde s\'écrit pendant les simulations : guerres, batailles, traités, alliances, crises…</p>'; return; }
    let year = null, html = '';
    for (const e of evs.slice(-600)) {
      const y = fmtDate(0, e.day).split(' ').pop();
      if (y !== year) { year = y; html += `<li class="year"><b>${y}</b></li>`; }
      const [label, ic, col] = CHRON_TYPES[e.type] || ['Événement', 'info', '#9aa3b2'];
      html += `<li class="ev" style="--c:${col}" ${e.cell >= 0 && e.cell !== undefined ? `data-cell="${e.cell}"` : ''} ${e.liveWar ? `data-lw="${e.liveWar}"` : ''} ${e.war && !e.live ? `data-aw="${esc(e.war)}"` : ''}>
        <span class="ic-wrap">${icon(ic)}</span><div><small>${fmtDate(0, e.day)} · ${label}</small><span>${esc(e.text)}</span></div></li>`;
    }
    body.innerHTML = `<ol class="wh-list">${html}</ol>`;
    body.scrollTop = body.scrollHeight;
    body.querySelectorAll('li.ev').forEach((li) => li.addEventListener('click', () => {
      if (li.dataset.lw) { show('worldHistoryPanel', false); this.openReport(this.liveWar(Number(li.dataset.lw))); return; }
      if (li.dataset.aw) {
        const a = (this.app.world.chronicle.wars || []).find((x) => x.uid === li.dataset.aw);
        if (a) { show('worldHistoryPanel', false); this.openReport(this.archived(a)); return; }
      }
      if (li.dataset.cell) { this.app.session.flyToCell(Number(li.dataset.cell), 1.5, 1.6); this.app.renderer.pulse(Number(li.dataset.cell), '#ffd65a', 1); }
    }));
  }

  isOpen() { return isShown('warReport') || isShown('warEnded') || isShown('warsPanel') || isShown('worldHistoryPanel'); }
}
