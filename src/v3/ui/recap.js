// UI — RÉCAPITULATIF ANNUEL : à chaque nouvelle année de jeu, un bilan de l'année écoulée (PIB, population,
// budget, territoire, guerres et pertes, diplomatie et alliances, technologies, armée, événements marquants).
// Les bilans précédents restent consultables (Chronologie → Récapitulatifs annuels).
// Lecture seule : les données viennent des bilans annuels de la nation (sim/insights.js → annualRecap).
import { $, show, isShown, esc, fmtInt } from './util.js';
import { icon } from './icons.js';
import { fmtBn } from '../sim/profile.js';
import { annualRecap } from '../sim/insights.js';

const num = (v, d = 1) => (Math.round(v * 10 ** d) / 10 ** d).toLocaleString('fr-FR');
const signed = (v, d = 1, unit = '') => (v === null || v === undefined || !Number.isFinite(v) ? '—' : `${v > 0 ? '+' : v < 0 ? '−' : ''}${num(Math.abs(v), d)}${unit}`);
const pctCh = (v) => (v === null || !Number.isFinite(v) ? '—' : signed(v * 100, 1, ' %'));
const cls = (v, invert = false) => (v === null || !Number.isFinite(v) || Math.abs(v) < 1e-9 ? '' : (v > 0) !== invert ? 'up' : 'down');

export class RecapUI {
  constructor(app) {
    this.app = app;
    this.seen = 0;           // nombre de bilans annuels déjà présentés
    this.index = null;
    const t = document.createElement('template');
    t.innerHTML = `<section id="recapDialog" class="overlay hidden"><div class="dialog wide panel recap" id="recapBox"></div></section>`;
    document.body.appendChild(t.content.firstChild);
    $('recapDialog').addEventListener('keydown', (e) => e.stopPropagation());
  }
  get sim() { return this.app.session.sim; }
  isOpen() { return isShown('recapDialog'); }
  // début de partie (ou chargement) : les bilans déjà existants ne sont pas présentés à nouveau
  begin(sim) { this.seen = sim && sim.nv ? sim.nv.timeline.length : 0; }
  // appelé régulièrement : une nouvelle année vient d'être bilantée
  update(sim) {
    const n = sim && sim.nv;
    if (!n) return;
    const len = n.timeline.length;
    if (len <= this.seen) { if (len < this.seen) this.seen = len; return; }
    this.seen = len;
    if (this.app.settings.recap === false || len < 2) return;
    if (this.app.wantsAutoPause && !this.app.wantsAutoPause('recap')) { this.open(null, false); return; }
    this.open(null, true);
  }
  open(index = null, pause = true) {
    const sim = this.sim, n = sim && sim.nv;
    if (!n) return;
    const tl = n.timeline;
    this.index = index === null ? tl.length - 1 : Math.max(1, Math.min(tl.length - 1, index));
    if (tl.length < 2) { this._render(null); show('recapDialog'); return; }
    this._render(annualRecap(n, sim, this.index));
    show('recapDialog');
    if (pause) this.app.pauseForOverlay();
  }
  close() { show('recapDialog', false); this.app.resumeAfterOverlay(); }

  _render(rc) {
    const box = $('recapBox');
    const sim = this.sim, n = sim.nv;
    const sd = sim.sides[n.player];
    if (!rc) {
      box.innerHTML = `<small class="eyebrow">Récapitulatif annuel</small><h2>Pas encore de bilan</h2><p class="hint">Le premier récapitulatif sera disponible à la fin de la première année de jeu.</p><div class="dialog-foot"><span class="grow"></span><button class="btn primary" data-rc="close">Fermer</button></div>`;
      box.querySelector('[data-rc=close]').onclick = () => this.close();
      return;
    }
    const tl = n.timeline;
    const kpi = (label, val, ch, c, sub = '') => `<div><small>${label}</small><b>${val}</b><span class="${c}">${ch}</span>${sub ? `<em>${sub}</em>` : ''}</div>`;
    const terrCh = rc.territory.change;
    const list = (arr, empty) => (arr && arr.length ? `<ul>${arr.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>` : `<p class="hint">${empty}</p>`);
    const rank = (r) => (r.from && r.to ? `n° ${r.to}${r.to !== r.from ? ` <span class="${r.to < r.from ? 'up' : 'down'}">(${r.to < r.from ? '▲' : '▼'} ${Math.abs(r.to - r.from)})</span>` : ''}` : '—');
    const alliesCh = rc.diplomacy.allies.to !== undefined && rc.diplomacy.allies.from !== undefined ? rc.diplomacy.allies.to - rc.diplomacy.allies.from : null;
    const ent = this.app.entities()[sd.e];
    box.innerHTML = `
      <div class="rc-head"><div><small class="eyebrow">Récapitulatif annuel · ${esc(ent ? ent.name : sd.name)}</small><h2>Bilan de l'année ${rc.year}</h2></div>
        <div class="rc-nav"><button class="btn ghost sm icon" data-rc="prev" ${this.index <= 1 ? 'disabled' : ''} title="Année précédente">${icon('chevron-right', 'flip')}</button><span>${this.index} / ${tl.length - 1}</span><button class="btn ghost sm icon" data-rc="next" ${this.index >= tl.length - 1 ? 'disabled' : ''} title="Année suivante">${icon('chevron-right')}</button></div></div>
      <div class="nm-kpis rc-kpis">
        ${kpi('PIB', fmtBn(rc.gdp.to), pctCh(rc.gdp.change), cls(rc.gdp.change), `PIB/hab. ${fmtInt(rc.pc.to || 0)} $`)}
        ${kpi('Population', `${num((rc.pop.to || 0) / 1e6)} M`, pctCh(rc.pop.change), cls(rc.pop.change))}
        ${kpi('Trésorerie', fmtBn(rc.money.to), signed(rc.money.change, 1, ' Md$'), cls(rc.money.change), `dette ${fmtBn(rc.debt.to)} (${signed(rc.debt.change, 1, ' Md$')})`)}
        ${kpi('Territoire', `${fmtInt(rc.territory.to || 0)} ${rc.territory.unit}`, terrCh ? signed(terrCh, 0, ` ${rc.territory.unit}`) : 'inchangé', cls(terrCh))}
        ${kpi('Stabilité', `${rc.stability.to} %`, signed(rc.stability.change, 0, ' pt'), cls(rc.stability.change))}
        ${kpi('Technologie', num(rc.tech.to || 0), signed(rc.tech.change), cls(rc.tech.change))}
        ${kpi('Effectifs', fmtInt(rc.soldiers.to || 0), signed(rc.soldiers.change, 0), cls(rc.soldiers.change), rc.losses !== null ? `pertes : ${fmtInt(rc.losses)}` : '')}
        ${kpi('Puissance', rank(rc.powerRank), pctCh(rc.power.change), cls(rc.power.change), `PIB : ${rank(rc.gdpRank)}`)}
      </div>
      <div class="rc-cols">
        <section><h4>${icon('swords')} Guerres</h4>${rc.wars.active !== null ? `<p class="hint">${rc.wars.active ? `${rc.wars.active} guerre(s) en cours en fin d'année.` : 'Aucune guerre en cours en fin d\'année.'}${rc.losses ? ` Pertes humaines estimées : ${fmtInt(rc.losses)}.` : ''}</p>` : ''}${list(rc.wars.events, 'Aucun événement militaire majeur.')}</section>
        <section><h4>${icon('handshake')} Diplomatie</h4><p class="hint">${rc.diplomacy.allies.to ?? 0} allié(s)${alliesCh ? ` (${signed(alliesCh, 0)})` : ''}.</p>${list(rc.diplomacy.events, 'Aucun accord ni alliance nouvelle.')}</section>
        <section><h4>${icon('network')} Technologies découvertes</h4>${list(rc.techs, 'Aucune technologie achevée cette année.')}</section>
        <section><h4>${icon('activity')} Événements importants</h4>${list(rc.events, 'Une année calme.')}</section>
      </div>
      <div class="dialog-foot"><label class="check"><input type="checkbox" id="rcAuto" ${this.app.settings.recap !== false ? 'checked' : ''}><span>Afficher le récapitulatif à chaque nouvelle année</span></label><span class="grow"></span><button class="btn primary" data-rc="close">Continuer</button></div>`;
    box.querySelector('[data-rc=close]').onclick = () => this.close();
    const prev = box.querySelector('[data-rc=prev]'), next = box.querySelector('[data-rc=next]');
    if (prev) prev.onclick = () => this.open(this.index - 1, false);
    if (next) next.onclick = () => this.open(this.index + 1, false);
    $('rcAuto').onchange = () => { this.app.settings.recap = $('rcAuto').checked; this.app.saveSettings(); };
  }
}
