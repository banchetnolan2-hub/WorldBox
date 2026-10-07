// UI — interface en partie : classement animé, barre de rapport de force, fiche pays, journal,
// notifications, contrôles. Toutes les valeurs affichées évoluent progressivement (interpolation),
// jamais par sauts : pourcentages, unités, puissance, barres, positions dans le classement.
import { $, show, esc, fmtTime, fmtInt, flagImg } from './util.js';
import { severity, shouldToast, Grouper } from './notify.js';
import { participantProfile } from '../sim/worldSim.js';
import { landTotal } from '../sim/economy.js';
import { regionResources } from '../world/details.js';
import { icon } from './icons.js';
import { fmtBn, PERSONALITIES, ECONOMY_TYPES, UNIT_LABELS } from '../sim/profile.js';
import { STATUS_LABELS, POSTURE_LABELS, frontSummary } from '../sim/fronts.js';
import { OBJECTIVE_LABELS, powerOf } from '../sim/ai.js';
import { relationStatus, REL_LABELS } from '../sim/wars.js';
import { fmtDate } from '../sim/calendar.js';
import { BIOME_NAMES } from '../sim/geo.js';

export const SPEEDS = [0.5, 1, 2, 4, 8];
const ROW_H = 46, TEAM_H = 28;
const fmtPct = (v) => (v * 100).toFixed(1).replace('.', ',') + ' %';

// valeur animée : l'affichage rejoint la cible en douceur
class Tween {
  constructor(v = 0) { this.v = v; this.t = v; this.init = false; }
  set(t) { if (!this.init) { this.v = t; this.init = true; } this.t = t; }
  step(k) { this.v += (this.t - this.v) * k; if (Math.abs(this.t - this.v) < 1e-6) this.v = this.t; return this.v; }
}

export class Hud {
  constructor(app) {
    this.app = app;
    this.rankCollapsed = false;
    this.journalCollapsed = false;
    this.selected = -1;
    this.prev = new Map();
    this.prevAt = -99;
    this.rows = new Map();     // clé -> { el, tw: {…} }
    this.tweens = [];          // [{ tw, apply(v) }]
    $('speeds').innerHTML = SPEEDS.map((s) => `<button data-speed="${s}">${String(s).replace('.', ',')}×</button>`).join('');
    $('rankToggle').addEventListener('click', () => { this.rankCollapsed = !this.rankCollapsed; $('ranking').classList.toggle('collapsed', this.rankCollapsed); });
    $('journalToggle').addEventListener('click', () => { this.journalCollapsed = !this.journalCollapsed; $('journal').classList.toggle('collapsed', this.journalCollapsed); });
    $('rankBody').addEventListener('click', (e) => {
      const row = e.target.closest('[data-e]');
      if (row) this.app.selectEntity(Number(row.dataset.e), true);
    });
  }

  show(on) { show('hud', on); }
  setCinema(on) { $('hud').classList.toggle('cinema', on); show('specBadge', on); }

  // lie une valeur animée à un affichage
  bind(key, apply) {
    let b = this.tweens.find((x) => x.key === key);
    if (!b) { b = { key, tw: new Tween(), apply }; this.tweens.push(b); } else { b.apply = apply; b.shown = undefined; }
    return b.tw;
  }
  animate(dt) {
    const k = Math.min(1, dt * 5.5);
    // on applique dès que la valeur affichée diffère de la valeur courante (y compris après un saut initial)
    for (const b of this.tweens) { const v = b.tw.step(k); if (v !== b.shown) { b.apply(v); b.shown = v; } }
    for (const r of this.rows.values()) {
      const a = r.share.v, b = r.units.v;
      r.share.step(k); r.units.step(k);
      if (r.apply && (a !== r.share.v || b !== r.units.v || !r.shown)) { r.apply(r); r.shown = true; }
    }
  }

  setup(sim, label) {
    this.sim = sim;
    $('scenarioName').textContent = label || '';
    $('logList').innerHTML = '<li class="empty">Les événements apparaîtront ici.</li>';
    $('toasts').innerHTML = '';
    $('rankBody').innerHTML = '';
    this.rows.clear();
    this.tweens = [];
    this.prev.clear();
    this.prevAt = -99;
    const two = sim.teams.length === 2;
    show('vsbar', two);
    if (two) {
      const A = sim.sides.filter((s) => s.team === 0), B = sim.sides.filter((s) => s.team === 1);
      const ents = this.app.entities();
      const lab = (list, t) => (list.length === 1 ? ents[list[0].e].name : sim.teams[t].name);
      $('vsA').querySelector('.n').textContent = lab(A, 0);
      $('vsB').querySelector('.n').textContent = lab(B, 1);
      const ca = A.length === 1 ? this.app.renderer.colors[A[0].e] : sim.teams[0].color;
      const cb = B.length === 1 ? this.app.renderer.colors[B[0].e] : sim.teams[1].color;
      $('vsbar').style.setProperty('--ca', ca === cb ? '#5b8cff' : ca);
      $('vsbar').style.setProperty('--cb', ca === cb ? '#f2a73b' : cb);
      const pa = $('vsA').querySelector('.p'), pb = $('vsB').querySelector('.p'), tug = $('vsbar').querySelector('.tug i');
      this.vsTween = this.bind('vs', (v) => { pa.textContent = fmtPct(v); pb.textContent = fmtPct(1 - v); tug.style.width = (v * 100).toFixed(2) + '%'; });
    }
    this.selected = -1;
    show('countryPanel', false);
  }

  // jeu de vitesses (NATION SIMULATOR : 1×, 2×, 5×, 10×) ; null = vitesses par défaut
  setSpeedSet(list) {
    const l = list || SPEEDS;
    $('speeds').innerHTML = l.map((s) => `<button data-speed="${s}">${String(s).replace('.', ',')}×</button>`).join('');
  }
  setSpeed(s) {
    document.querySelectorAll('#speeds button').forEach((b) => b.classList.toggle('on', Number(b.dataset.speed) === s));
    $('speedLabel').textContent = String(s).replace('.', ',') + '×';
  }
  setPaused(p) { $('playBtn').innerHTML = p ? `${icon('play')}<span>Lecture</span>` : `${icon('pause')}<span>Pause</span>`; $('playBtn').classList.toggle('on', p); }
  setCam(mode) { $('camAutoBtn').classList.toggle('on', mode === 'auto'); $('camFreeBtn').classList.toggle('on', mode === 'libre'); }
  setToggle(id, on) { $(id).classList.toggle('off', !on); }

  update(sim) {
    const snap = sim.snapshot();
    $('clock').textContent = fmtTime(sim.time);
    $('simDate').textContent = sim.dateStr(sim.time);
    const nw = sim.activeWars.filter((w) => w.status === 'active').length;
    $('warsCount').textContent = String(nw);
    $('warsBtn').classList.toggle('hot', nw > 0);
    $('clockMax').textContent = fmtTime(sim.cfg.maxDuration);
    if (sim.time - this.prevAt > 1.5) {
      this.trend = new Map(snap.map((s) => [s.e, s.share - (this.prev.get(s.e) || s.share)]));
      snap.forEach((s) => this.prev.set(s.e, s.share));
      this.prevAt = sim.time;
    }
    if (sim.teams.length === 2) {
      const ts = sim.teamStats();
      const tot = ts[0].cells + ts[1].cells || 1;
      if (this.vsTween) this.vsTween.set(ts[0].cells / tot);
    }
    if (!this.rankCollapsed) this._ranking(sim, snap);
    if (this.selected >= 0) this.renderCountry(this.selected, true);
  }

  // ---------- classement (lignes stables, déplacements animés) ----------
  _ranking(sim, snap) {
    const ents = this.app.entities();
    const sorted = [...snap].sort((a, b) => b.share - a.share);
    const multiTeam = sim.teams.length < sim.sides.length && sim.teams.length <= 8;
    const maxShare = sorted[0] ? Math.max(0.0001, sorted[0].share) : 1;
    const items = [];
    if (multiTeam) {
      const ts = sim.teamStats();
      const tot = sim.totalCells() || 1;
      ts.map((t, i) => [t, i]).sort((a, b) => b[0].cells - a[0].cells).forEach(([t, ti]) => {
        items.push({ key: 't' + ti, team: t, share: t.cells / tot });
        sorted.filter((s) => s.team === ti).slice(0, 12).forEach((s) => items.push({ key: 'e' + s.e, s, rank: sorted.indexOf(s) }));
      });
    } else sorted.slice(0, 40).forEach((s, k) => items.push({ key: 'e' + s.e, s, rank: k }));
    const body = $('rankBody');
    const seen = new Set();
    let y = 0;
    for (const it of items) {
      seen.add(it.key);
      let r = this.rows.get(it.key);
      if (!r) {
        const el = document.createElement('div');
        if (it.team) {
          el.className = 'rank-team';
          el.innerHTML = '<i></i><span class="tn"></span><b></b>';
        } else {
          const e = ents[it.s.e];
          el.className = 'rank-row';
          el.dataset.e = it.s.e;
          el.innerHTML = `<span class="i"></span><i class="dot" style="background:${this.app.renderer.colors[it.s.e] || '#888'}"></i><span class="nm">${esc(e.name)}</span><span class="pc"></span><div class="bar"><i style="background:${this.app.renderer.colors[it.s.e] || '#888'}"></i></div><span class="sub"></span>`;
        }
        el.style.transform = `translateY(${y}px)`;
        body.appendChild(el);
        r = { el, share: new Tween(), units: new Tween() };
        this.rows.set(it.key, r);
        requestAnimationFrame(() => el.classList.add('in'));
      }
      r.el.style.transform = `translateY(${y}px)`;
      if (it.team) {
        r.el.style.setProperty('--c', it.team.color);
        r.el.querySelector('.tn').textContent = it.team.name + (it.team.defeated ? ' · vaincue' : '');
        r.share.set(it.share);
        r.apply = (row) => { row.el.querySelector('b').textContent = fmtPct(row.share.v); };
        y += TEAM_H;
      } else {
        const s = it.s;
        const tr = this.trend ? this.trend.get(s.e) || 0 : 0;
        r.el.classList.toggle('sel', s.e === this.selected);
        r.el.classList.toggle('out', s.eliminated || s.defeated);
        r.el.querySelector('.i').textContent = it.rank + 1;
        const pc = r.el.querySelector('.pc');
        pc.classList.toggle('up', tr > 0.0005); pc.classList.toggle('down', tr < -0.0005);
        r.share.set(s.share);
        r.units.set(s.units);
        r.status = s.eliminated ? 'Éliminé' : s.defeated ? 'Vaincu' : null;
        r.ratio = s.ratio; r.occ = s.occupiedShare;
        r.el.querySelector('.bar i').style.width = (s.share / maxShare * 100).toFixed(1) + '%';
        r.apply = (row) => {
          row.el.querySelector('.pc').textContent = fmtPct(row.share.v);
          row.el.querySelector('.sub').textContent = row.status || `${fmtInt(row.units.v)} unités · ${row.ratio >= 1 ? '+' : ''}${Math.round((row.ratio - 1) * 100)} %${row.occ > 0.005 ? ` · ${Math.round(row.occ * 100)} % occupé` : ''}`;
        };
        y += ROW_H;
      }
    }
    body.style.height = y + 'px';
    for (const [key, r] of this.rows) {
      if (seen.has(key)) continue;
      r.el.classList.remove('in');
      setTimeout(() => r.el.remove(), 300);
      this.rows.delete(key);
    }
    for (const r of this.rows.values()) r.shown = false;
  }

  // ---------- fiche pays : en-tête clair (9 repères) + onglets ----------
  renderCountry(e, refresh = false) {
    const ent = this.app.entities()[e];
    if (!ent) return;
    const sim = this.sim && this.app.session.sim === this.sim ? this.sim : null;
    const side = sim ? sim.sides.find((s) => s.e === e) : null;
    const el = $('countryPanel');
    const fresh = !refresh || this.selected !== e || el.dataset.e !== String(e) || !!side !== (el.dataset.side === '1');
    if (fresh) {
      this.selected = e;
      el.dataset.e = String(e);
      el.dataset.side = side ? '1' : '0';
      this.tweens = this.tweens.filter((b) => !b.key.startsWith('cp:'));
      el.innerHTML = this._countryHtml(ent, side, sim);
      show('countryPanel');
      el.classList.remove('enter'); void el.offsetWidth; el.classList.add('enter');
      this._tabAt = -1;
      el.querySelectorAll('.cp-tabs [data-tab]').forEach((b) => b.addEventListener('click', () => {
        this.cpTab = b.dataset.tab; this._tabAt = -1;
        el.querySelectorAll('.cp-tabs [data-tab]').forEach((x) => x.classList.toggle('on', x === b));
        this._renderTab(ent, side, sim, true);
      }));
      $('cpClose').onclick = () => this.app.selectEntity(-1);
      if ($('cpGo')) $('cpGo').onclick = () => this.app.centerOn(e);
      if ($('cpDiplo')) $('cpDiplo').onclick = () => this.app.nationUI.openDiplo(side.index);
      if ($('cpNation')) $('cpNation').onclick = () => this.app.nationUI.openPanel('eco');
      if ($('cpFollow')) $('cpFollow').onclick = () => {
        const tr = sim.transports.find((t) => t.side === side.index);
        if (tr) { this.app.session.followTransport(tr.id); this.setCam('auto'); }
      };
      this._renderTab(ent, side, sim, true);
    } else if (performance.now() - (this._tabAt || 0) > 1000) {
      this._renderStrip(ent, side, sim);
      this._renderTab(ent, side, sim, false);
    }
  }

  // valeurs de l'en-tête (pays en simulation ou fiche du monde)
  _facts(ent, side, sim) {
    const app = this.app;
    const km2 = (() => { if (side) return side.km2 || 0; const geo = app.geoFor(app.world); const o = app.world.owner; let t = 0; for (let i = 0; i < o.length; i++) if (o[i] === ent.index) t += geo ? geo.km2[i] : 770; return t; })();
    if (side) {
      const S = sim.S;
      let allies = 0, wars = 0;
      for (let o = 0; o < S; o++) { if (o === side.index) continue; if (sim.allied[side.index * S + o]) allies++; if (sim.atWar[side.index * S + o]) wars++; }
      return { cap: ent.capital ? ent.capital.name : '—', pop: side.pop, gdp: side.eco.gdp, prod: side.p.production, tech: side.p.tech, infra: Math.round((side.p.infra.roads + side.p.infra.rail + side.p.infra.airports) / 3), diplo: wars ? `${wars} guerre${wars > 1 ? 's' : ''}` : allies ? `${allies} allié${allies > 1 ? 's' : ''}` : 'Neutre', diploBad: wars > 0, soldiers: landTotal(side) * 1000, km2 };
    }
    if (ent.kind === 'neutral') return null;
    if (!this._profCache || this._profCache.e !== ent.index) this._profCache = { e: ent.index, p: participantProfile(ent, {}, {}) };
    const p = this._profCache.p;
    return { cap: ent.capital ? ent.capital.name : '—', pop: p.population, gdp: p.derived.gdp, prod: p.production, tech: p.tech, infra: Math.round((p.infra.roads + p.infra.rail + p.infra.airports) / 3), diplo: '—', soldiers: p.derived.soldiers * 0.85, km2 };
  }
  _stripHtml(f) {
    if (!f) return '';
    const it = (ic, l, v, cls = '') => `<div class="cf ${cls}" title="${l} : ${String(v).replace(/<[^>]+>/g, '').replace(/"/g, '')}">${icon(ic)}<span><small>${l}</small><b>${v}</b></span></div>`;
    return it('landmark', 'Capitale', esc(f.cap)) + it('users', 'Population', `${(f.pop / 1e6).toFixed(f.pop < 1e7 ? 2 : 1).replace('.', ',')} M`)
      + it('coins', 'Économie', fmtBn(f.gdp)) + it('factory', 'Production', `${Math.round(f.prod)} / 100`) + it('cpu', 'Technologie', `${Math.round(f.tech)} / 100`)
      + it('route', 'Infrastructure', `${f.infra} / 100`) + it('handshake', 'Diplomatie', f.diplo, f.diploBad ? 'bad' : '') + it('shield', 'Forces', fmtInt(f.soldiers))
      + it('map', 'Territoire', f.km2 >= 1e5 ? `${(f.km2 / 1e6).toFixed(2).replace('.', ',')} M km²` : `${fmtInt(f.km2)} km²`);
  }
  _renderStrip(ent, side, sim) { const el = $('countryPanel').querySelector('.cp-facts'); if (el) el.innerHTML = this._stripHtml(this._facts(ent, side, sim)); }

  _countryHtml(ent, side, sim) {
    const nationBtn = side && sim && sim.nv ? (side.index === sim.nv.player ? `<button class="btn primary sm" id="cpNation" title="Gestion du pays">${icon('sliders-horizontal')}<span>Gérer</span></button>` : `<button class="btn primary sm" id="cpDiplo" title="Diplomatie avec ce pays">${icon('handshake')}<span>Diplomatie</span></button>`) : '';
    const status = side ? (side.eliminated ? 'Éliminé' : sim.isAtWar(side.index) ? 'En guerre' : 'En paix') : (ent.kind === 'custom' ? 'Pays créé' : '');
    let html = `<div class="cp-head">${ent.kind === 'neutral' ? `<i class="swatch" style="background:${ent.color}"></i>` : flagImg(ent, 'flag lg')}<div class="cp-name"><b>${esc(ent.name)}</b><small>${esc(ent.continent || '')}${status ? ` — <span class="${status === 'En guerre' ? 'down' : ''}">${status}</span>` : ''}</small></div>${nationBtn}<button class="btn ghost sm icon cp-close" id="cpClose" title="Fermer">${icon('x')}</button></div>`;
    if (ent.kind === 'neutral') return html + '<p class="hint">Territoire neutre : il ne participe pas aux simulations.</p>';
    html += `<div class="cp-facts">${this._stripHtml(this._facts(ent, side, sim))}</div>`;
    const T = [['over', 'Aperçu'], ['eco', 'Économie'], ['army', 'Militaire'], ['tech', 'Technologie'], ['rel', 'Diplomatie'], ['cities', 'Villes'], ['hist', 'Histoire'], ['stats', 'Statistiques']];
    const tab = this.cpTab || 'over';
    html += `<div class="cp-tabs">${T.map(([k, l]) => `<button data-tab="${k}" class="${k === tab ? 'on' : ''}">${l}</button>`).join('')}</div>`;
    html += '<div class="cp-tab"></div><div class="cp-actions">';
    html += `<button class="btn ghost sm" id="cpGo">${icon('locate')}<span>Centrer</span></button>`;
    if (side && sim.transports.some((t) => t.side === side.index)) html += `<button class="btn ghost sm" id="cpFollow">${icon('ship')}<span>Suivre un convoi</span></button>`;
    return html + '</div>';
  }

  _renderTab(ent, side, sim, fresh) {
    this._tabAt = performance.now();
    const el = $('countryPanel').querySelector('.cp-tab');
    if (!el) return;
    const tab = this.cpTab || 'over';
    const kv = (l, v, cls = '') => `<div class="kv ${cls}"><span>${l}</span><b>${v}</b></div>`;
    const bar = (l, v, max, col, txt = null) => `<div class="cp-bar"><span>${l}</span><b>${txt ?? fmtInt(v)}</b><div class="meter"><i style="width:${Math.max(0, Math.min(100, v / Math.max(1e-6, max) * 100)).toFixed(1)}%;background:${col}"></i></div></div>`;
    let h = '';
    const p = side ? side.p : (this._profCache && this._profCache.e === ent.index ? this._profCache.p : participantProfile(ent, {}, {}));
    if (!side && tab !== 'cities' && tab !== 'over' && tab !== 'tech' && tab !== 'eco') {
      h = '<p class="hint">Ces informations apparaissent quand le pays participe à une simulation.</p>';
    } else if (tab === 'over') {
      if (side) {
        const snap = sim.snapshot()[side.index];
        h += kv('Part du territoire mondial', fmtPct(snap.share)) + kv('Progression', `${snap.ratio >= 1 ? '+' : ''}${Math.round((snap.ratio - 1) * 100)} %`) + kv('Zones occupées', fmtInt(snap.occupied));
        h += kv('Stabilité', `${Math.round(side.stability * 100)} %`) + kv('Trésorerie', fmtBn(side.money)) + kv('Personnalité', esc(PERSONALITIES[side.ai.personality].label));
        h += `<p class="hint">${esc(PERSONALITIES[side.ai.personality].desc)}</p>`;
        if (!side.player) h += '<small class="eyebrow">Priorités de l\'IA</small><ol class="cp-obj">' + side.ai.objectives.slice(0, 3).map((o, k) => `<li><b>${['Principal', 'Secondaire', 'Long terme'][k] || 'Autre'}</b> ${esc(OBJECTIVE_LABELS[o.type])}${o.target !== undefined ? ' — ' + esc(sim.sides[o.target].name) : ''}</li>`).join('') + '</ol>';
        const ai = side.ai;
        if (ai.log.length) h += '<small class="eyebrow">Décisions récentes</small><ul class="cp-log">' + ai.log.slice(-5).reverse().map((l) => `<li class="${l.tone}"><time>${fmtDate(l.t, sim.cfg.startDay, true)}</time>${esc(l.text)}</li>`).join('') + '</ul>';
      } else {
        const d = p.derived;
        h += kv('Type d\'économie', ECONOMY_TYPES[d.economyType] || '') + kv('PIB par habitant', `${fmtInt(d.gdpPc)} $`) + kv('Dépenses militaires', `${String(p.milBudget).replace('.', ',')} % du PIB`) + kv('Personnalité (IA)', esc(PERSONALITIES[p.personality].label));
        h += kv('Ressources', `${d.resLevel} / 100`) + kv('Stabilité', `${Math.round(p.politics.stability)} / 100`);
        if (sim) h += '<p class="hint">Ne participe pas à cette simulation.</p>';
      }
    } else if (tab === 'eco') {
      if (!side) {
        const d = p.derived;
        h += kv('PIB / an', fmtBn(d.gdp)) + kv('Recettes / an', fmtBn(d.income)) + kv('Dépenses / an', fmtBn(d.expenses)) + kv('Dette', fmtBn(p.debt)) + kv('Commerce', `${Math.round(p.trade)} / 100`);
      } else {
        const sd = side, e = sd.eco;
        h += kv('Type d\'économie', ECONOMY_TYPES[p.derived ? p.derived.economyType : 'equilibree'] || '');
        h += kv('PIB / an', fmtBn(e.gdp)) + kv('PIB par habitant', `${fmtInt(sd.pc * 1000)} $`) + kv('Trésorerie', fmtBn(sd.money)) + kv('Dette', `${fmtBn(sd.debt)} (${Math.round(sd.debt / Math.max(1, e.gdp) * 100)} % du PIB)`);
        h += '<div class="cp-sep"></div>' + kv('Recettes / an', fmtBn(e.income)) + kv('Dépenses / an', fmtBn(e.expenses)) + kv('Solde / an', fmtBn(e.balance), e.balance < 0 ? 'neg' : 'pos');
        h += '<div class="cp-sep"></div><small class="eyebrow">Dépenses</small>';
        const tot = Math.max(1e-6, (e.civil || 0) + e.upkeep + (e.interest || 0) + (e.ops || 0) + (e.research || 0) + (e.infra || 0) + (e.econ || 0));
        for (const [l, v, c] of [['Administration', e.civil || 0, '#8d96a8'], ['Armée (entretien)', e.upkeep, '#d9705f'], ['Opérations militaires', e.ops || 0, '#d99a52'], ['Intérêts de la dette', e.interest || 0, '#a58fd1'], ['Recherche', e.research || 0, '#6aa5c9'], ['Infrastructures', e.infra || 0, '#5fb5a8'], ['Économie', e.econ || 0, '#8fbf7a']]) h += bar(l, v, tot, c, fmtBn(v));
        h += '<div class="cp-sep"></div>' + kv('Commerce', `${sd.tradePartners.length} partenaire(s), +${fmtBn(e.trade || 0)}`) + (sd.blockade > 0.005 ? kv('Blocus naval', `−${Math.round(sd.blockade * 100)} % d'activité`, 'neg') : '');
        h += kv('Entretien de l\'armée payé', Math.round((e.pay ?? 1) * 100) + ' %', (e.pay ?? 1) < 0.95 ? 'neg' : '');
        if (sd.crisis) h += '<p class="cp-alert">Crise économique en cours.</p>';
      }
    } else if (tab === 'army') {
      const sd = side;
      h += kv('Soldats', fmtInt(landTotal(sd) * 1000)) + kv('Groupes', String(sd.agents.length)) + kv('Réserves mobilisables', fmtInt(sd.manpower * 1000)) + kv('Qualité', Math.round(sd.q * 100) + ' %') + kv('Préparation', Math.round(sd.readiness * 100) + ' %') + kv('Moral', Math.round(sd.morale * 100) + ' %') + kv('Lassitude de guerre', Math.round(sd.exhaustion * 100) + ' %');
      h += '<div class="cp-sep"></div><small class="eyebrow">Composition (milliers de soldats)</small>';
      const mx = Math.max(sd.army.inf, 1);
      h += bar(UNIT_LABELS.inf, sd.army.inf, mx, '#a7b0bf') + bar(UNIT_LABELS.arm, sd.army.arm, mx, '#d99a52') + bar(UNIT_LABELS.art, sd.army.art, mx, '#d9705f') + bar(UNIT_LABELS.rec, sd.army.rec, mx, '#5fb5a8');
      h += bar(UNIT_LABELS.air, sd.air, Math.max(sd.air, sd.initialAir, 1), '#6aa5c9') + bar(UNIT_LABELS.navy, sd.navy, Math.max(sd.navy, sd.initialNavy, 1), '#4d7fb0');
      h += '<div class="cp-sep"></div>' + kv('Budget militaire visé', fmtBn(sd.milTarget) + ' / an') + kv('Pertes cumulées', fmtInt((sd.lossesTotal || 0) * 1000) + ' soldats') + kv('Puissance (indice)', powerOf(sd).toFixed(0));
      const sea = sd.agents.filter((a) => a.sea || a.transit >= 0).length;
      if (sea) h += kv('Groupes en transport maritime', String(sea));
      const fr = frontSummary(sd).filter((f) => f.cells > 0);
      h += '<small class="eyebrow">Fronts</small>';
      if (!fr.length) h += '<p class="hint">Aucun front actif.</p>';
      const geo = sim.geo;
      h += fr.slice(0, 10).map((f) => `<div class="front st-${f.status}" data-cell="${f.cell}"><div><b>${esc(f.name)}</b><small>${f.o >= 0 ? esc(sim.sides[f.o].name) : 'zones grises'} — ${f.cells} parcelles, ${esc((BIOME_NAMES[geo.biome[f.cell >= 0 ? f.cell : 0]] || '').toLowerCase())}</small></div>
        <span class="st">${STATUS_LABELS[f.status]}</span><small class="pos">${POSTURE_LABELS[f.posture]}${f.fort > 0.05 ? `, fortifié ${Math.round(f.fort * 100)} %` : ''}</small></div>`).join('');
    } else if (tab === 'tech') {
      h += kv('Niveau technologique', `${(p.tech).toFixed(1).replace('.', ',')} / 100`) + kv('Recherche', `${Math.round(p.research)} / 100`) + kv('Efficacité industrielle', `${Math.round(p.efficiency)} / 100`) + kv('Équipement militaire', `${Math.round(p.equip)} / 100`);
      h += '<div class="cp-sep"></div><small class="eyebrow">Infrastructures</small>';
      for (const [k, l, c] of [['roads', 'Routes', '#5fb5a8'], ['rail', 'Rail', '#6aa5c9'], ['ports', 'Ports', '#4d7fb0'], ['airports', 'Aéroports', '#a58fd1'], ['cities', 'Villes', '#d9b45c']]) h += bar(l, p.infra[k], 100, c, Math.round(p.infra[k]));
      if (side && side.dev) {
        h += '<div class="cp-sep"></div><small class="eyebrow">Projets de développement</small>';
        const act = Object.values(side.dev.active);
        h += kv('Achevés', String(side.dev.done.length)) + (act.length ? act.map((a) => kv('En cours', `${esc(a.id)} — ${Math.round(a.done / a.months * 100)} %`)).join('') : kv('En cours', 'aucun'));
      }
    } else if (tab === 'rel') {
      const S = sim.S;
      if (sim.nv && side.index !== sim.nv.player) {
        const pl = sim.nv.player;
        const st = relationStatus(sim, pl, side.index);
        h += `<div class="rel rel-${st} me"><span>Avec votre pays</span><small>${REL_LABELS[st]}</small><b>${Math.round(sim.rel[pl * S + side.index])}</b></div>`;
        const m = sim.dmem && sim.dmem[`${pl}>${side.index}`];
        if (m) h += kv('Vos propositions acceptées / refusées', `${m.accepted} / ${m.refused}`);
      }
      const rows = sim.sides.map((o, k) => ({ o, k })).filter(({ k }) => k !== side.index && !sim.sides[k].eliminated).map(({ o, k }) => ({ o, k, st: relationStatus(sim, side.index, k), r: sim.rel[side.index * S + k] }))
        .sort((a, b) => (a.st === 'war' ? -1 : 0) - (b.st === 'war' ? -1 : 0) || (a.st === 'ally' ? -1 : 0) - (b.st === 'ally' ? -1 : 0) || a.r - b.r).slice(0, 16);
      h += rows.map(({ o, st, r }) => `<div class="rel rel-${st}" data-ent="${o.e}">${flagImg(this.app.entities()[o.e], 'flag xs')}<span>${esc(o.name)}</span><small>${REL_LABELS[st]}</small><b>${r > 0 ? '+' : ''}${Math.round(r)}</b></div>`).join('') || '<p class="hint">Aucun autre pays.</p>';
      const ai = side.ai;
      if (ai.memory.length) h += '<small class="eyebrow">Mémoire de l\'IA</small><ul class="cp-mem">' + ai.memory.slice().sort((a, b) => b.strength - a.strength).slice(0, 6).map((m) => `<li><i style="opacity:${Math.min(1, 0.3 + m.strength / 2)}"></i>${esc(m.text || m.type)}</li>`).join('') + '</ul>';
    } else if (tab === 'cities') {
      h += this._cities(ent, side, sim);
    } else if (tab === 'hist') {
      const sd = side;
      h += '<ul class="cp-log">' + sd.hist.slice(-16).reverse().map((x) => `<li><time>${fmtDate(x.t, sim.cfg.startDay, true)}</time>${esc(x.text)}</li>`).join('') + '</ul>';
      const past = this.app.world.chronicle && this.app.world.chronicle.countries[String(sd.e)];
      if (past && past.entries.length) h += '<small class="eyebrow">Avant cette simulation</small><ul class="cp-log">' + past.entries.slice(-10).reverse().map((x) => `<li><time>${fmtDate(0, x.day, true)}</time>${esc(x.text)}</li>`).join('') + '</ul>';
      if (!sd.hist.length && !(past && past.entries.length)) h += '<p class="hint">Pas encore d\'événement marquant.</p>';
    } else if (tab === 'stats') {
      h += this._sparks(side);
      h += kv('Parcelles gagnées / perdues', `${fmtInt(side.captured)} / ${fmtInt(side.lost)}`);
    }
    if (!fresh && el._h === h) return;
    el._h = h;
    el.innerHTML = h;
    if (fresh) { el.classList.remove('fade'); void el.offsetWidth; el.classList.add('fade'); }
    el.querySelectorAll('[data-cell]').forEach((n) => n.addEventListener('click', () => { const c = Number(n.dataset.cell); if (c >= 0) { this.app.session.flyToCell(c, 1.35, 1.8); this.app.renderer.pulse(c, '#e8c46a', 1); } }));
    el.querySelectorAll('[data-ent]').forEach((n) => n.addEventListener('click', () => this.app.selectEntity(Number(n.dataset.ent), true)));
  }

  // villes du pays (selon les frontières actuelles), régions et ressources
  _cities(ent, side, sim) {
    const d = this.app.detailsFor ? this.app.detailsFor(this.app.world) : null;
    if (!d) return '<p class="hint">Les villes et régions détaillées sont disponibles sur la carte de la Terre.</p>';
    const owner = sim ? sim.owner : this.app.world.owner;
    const mine = d.cities.filter((c) => owner[c.cell] === ent.index).sort((a, b) => (b.cap - a.cap) || b.pop - a.pop);
    const lost = d.cities.filter((c) => c.e === ent.index && owner[c.cell] !== ent.index);
    const gained = mine.filter((c) => c.e !== ent.index);
    const regs = new Map();
    for (const c of mine) if (c.region !== undefined) regs.set(c.region, (regs.get(c.region) || 0) + 1);
    const res = regionResources(d, this.app.grid, this.app.geoFor(this.app.world), this.app.entities());
    let h = `<div class="kv"><span>Villes principales</span><b>${mine.length}</b></div><div class="kv"><span>Ports</span><b>${mine.filter((c) => c.port).length}</b></div>`;
    h += `<div class="kv"><span>Population des grandes villes</span><b>${(mine.reduce((t, c) => t + c.pop, 0) / 1e6).toFixed(1).replace('.', ',')} M</b></div>`;
    h += '<ul class="cp-cities">' + mine.slice(0, 18).map((c) => `<li data-cell="${c.cell}">${icon(c.cap ? 'landmark' : c.port ? 'anchor' : 'circle-dot')}<span><b>${esc(c.name)}</b><small>${esc(c.region !== undefined ? d.regions[c.region].name : '')}${c.e !== ent.index ? ' — occupée' : ''}</small></span><em>${c.pop >= 1e6 ? (c.pop / 1e6).toFixed(1).replace('.', ',') + ' M' : fmtInt(c.pop / 1000) + ' k'}</em></li>`).join('') + '</ul>';
    if (lost.length) h += `<p class="cp-alert">Villes perdues : ${lost.slice(0, 6).map((c) => esc(c.name)).join(', ')}${lost.length > 6 ? '…' : ''}</p>`;
    if (gained.length) h += `<p class="hint">Villes conquises : ${gained.slice(0, 6).map((c) => esc(c.name)).join(', ')}</p>`;
    const RES = { agri: ['sprout', 'Agriculture'], wood: ['trees', 'Forêts'], mine: ['mountain', 'Minerais'], oil: ['droplets', 'Hydrocarbures'], fish: ['waves', 'Pêche'], industry: ['factory', 'Industrie'] };
    const rl = [...regs.keys()].filter((r) => d.regions[r].e === ent.index).slice(0, 14);
    if (rl.length) h += '<small class="eyebrow">Régions et ressources</small><ul class="cp-regions">' + rl.map((r) => `<li data-cell="${d.regions[r].center}"><span>${esc(d.regions[r].name)}</span><em>${res[r].map((k) => `<i title="${RES[k][1]}">${icon(RES[k][0])}</i>`).join('')}</em></li>`).join('') + '</ul>';
    return h;
  }

  _sparks(sd) {
    const ser = sd.series;
    if (ser.length < 2) return '<p class="hint">Les courbes apparaissent après quelques mois de simulation.</p>';
    const spark = (idx, label, col, fmt) => {
      const vals = ser.map((r) => r[idx]);
      const mn = Math.min(...vals), mx = Math.max(...vals);
      const pts = vals.map((v, k) => `${(k / (vals.length - 1) * 100).toFixed(1)},${(30 - (v - mn) / Math.max(1e-6, mx - mn) * 27).toFixed(1)}`).join(' ');
      return `<div class="spark"><span>${label}<b>${fmt(vals[vals.length - 1])}</b></span><svg viewBox="0 0 100 32" preserveAspectRatio="none"><polyline points="${pts}" fill="none" stroke="${col}" stroke-width="1.6" vector-effect="non-scaling-stroke"/></svg></div>`;
    };
    return `<div class="sparks">${spark(1, 'Territoire (parcelles)', '#6aa5c9', fmtInt)}${spark(2, 'PIB', '#8fbf7a', fmtBn)}${spark(4, 'Armée (milliers)', '#d9705f', fmtInt)}${spark(5, 'Technologie', '#a58fd1', (v) => String(v).replace('.', ','))}${spark(6, 'Stabilité (%)', '#d9b45c', fmtInt)}${spark(7, 'Puissance', '#e8c46a', fmtInt)}</div>`;
  }

  warToast(w, onOpen) {
    const el = document.createElement('div');
    el.className = 'toast good';
    el.style.setProperty('--c', '#8fd694');
    el.innerHTML = `<i class="dot"></i><div><div class="t-title">Traité de paix</div><div class="t-text">${esc(w.name)} — ${esc(w.report ? w.report.result : '')}</div></div><button class="btn ghost xs">Rapport</button>`;
    el.querySelector('button').onclick = onOpen;
    $('toasts').prepend(el);
    while ($('toasts').children.length > 3) $('toasts').lastChild.remove();
    setTimeout(() => el.classList.add('out'), 6000);
    setTimeout(() => el.remove(), 6500);
  }

  hideCountry() { this.selected = -1; show('countryPanel', false); }

  // ---------- événements ----------
  event(e, sim) {
    const side = e.side >= 0 && sim.sides[e.side] ? sim.sides[e.side] : null;
    const color = side ? this.app.renderer.colors[side.e] : '#f2c14e';
    const speed = this.app.session.speed;
    const title = e.title.charAt(0) + e.title.slice(1).toLowerCase();
    // niveau de notifications, quantité réduite à vitesse élevée, regroupement des notifications semblables
    const sev = severity(e, sim);
    if (!this.grouper) this.grouper = new Grouper(4000);
    const g = shouldToast(this.app.settings.notifLevel || 'all', sev, speed, sim.sides.length) ? this.grouper.push(e, performance.now()) : null;
    if (g && g.merge) {
      const el = g.merge;
      el.querySelector('.t-text').textContent = e.text;
      let c = el.querySelector('.t-count'); if (!c) { c = document.createElement('span'); c.className = 't-count'; el.querySelector('.t-title').appendChild(c); }
      c.textContent = ` ×${g.count}`;
      clearTimeout(el._t1); clearTimeout(el._t2); el.classList.remove('out');
      const life = speed >= 4 ? 2600 : 3600;
      el._t1 = setTimeout(() => el.classList.add('out'), life); el._t2 = setTimeout(() => el.remove(), life + 450);
    } else if (g) {
      const el = document.createElement('div');
      el.className = `toast ${e.tone || 'neutral'}`;
      el.style.setProperty('--c', color);
      el.innerHTML = `<i class="dot"></i><div><div class="t-title">${esc(title)}</div><div class="t-text">${esc(e.text)}</div></div>`;
      $('toasts').prepend(el);
      while ($('toasts').children.length > 2) $('toasts').lastChild.remove();
      const life = speed >= 4 ? 2200 : 3400;
      el._t1 = setTimeout(() => el.classList.add('out'), life);
      el._t2 = setTimeout(() => el.remove(), life + 450);
      this.grouper.attach(e, el);
    }
    const li = document.createElement('li');
    li.style.setProperty('--c', color);
    li.innerHTML = `<time>${fmtTime(e.t)}</time><b>${esc(title)}</b><span>${esc(e.text)}</span>`;
    const list = $('logList');
    if (list.firstChild && list.firstChild.classList && list.firstChild.classList.contains('empty')) list.innerHTML = '';
    list.prepend(li);
    while (list.children.length > 30) list.lastChild.remove();
  }
}
