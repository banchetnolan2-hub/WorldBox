// UI — interface en partie : barre A VS B, statistiques en direct, journal, notifications, infobulle
import { flagUrl } from '../countries/countries.js';
import { flagHtml } from '../countries/flagImages.js';

const $ = (id) => document.getElementById(id);
export const SPEEDS = [0.5, 1, 2, 4, 8];

export function fmtTime(t) {
  const s = Math.max(0, Math.floor(t));
  return String(Math.floor(s / 60)).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0');
}
const pct = (v) => (v * 100).toFixed(1).replace('.', ',') + ' %';
const pct0 = (v) => Math.round(v * 100) + ' %';

export class Hud {
  constructor() {
    this.root = $('hud');
    this.sides = [$('sideA'), $('sideB')];
    this.statsBody = $('statsBody');
    this.logList = $('logList');
    this.toasts = $('toasts');
    this.tooltip = $('tooltip');
    this.prevShare = [0.5, 0.5];
    this.prevShareAt = 0;
    this.countries = null;
    this.colors = null;
    this.statsCollapsed = false;
    $('statsToggle').addEventListener('click', () => {
      this.statsCollapsed = !this.statsCollapsed;
      $('statsToggle').textContent = this.statsCollapsed ? '+' : '–';
      this.statsBody.classList.toggle('hidden', this.statsCollapsed);
    });
    const sp = $('speeds');
    sp.innerHTML = SPEEDS.map((s) => `<button data-speed="${s}">${String(s).replace('.', ',')}×</button>`).join('');
  }

  show(on) { this.root.classList.toggle('hidden', !on); }
  setCinema(on) { this.root.classList.toggle('cinema', on); $('spectatorBadge').classList.toggle('hidden', !on); }

  setup(countries, colors) {
    this.countries = countries;
    this.colors = colors;
    document.documentElement.style.setProperty('--color-a', colors[0]);
    document.documentElement.style.setProperty('--color-b', colors[1]);
    countries.forEach((c, k) => {
      const el = this.sides[k];
      el.style.setProperty('--c', colors[k]);
      el.querySelector('.flag-lg').src = flagUrl(c);
      el.querySelector('.side-name').textContent = c.name;
      el.querySelector('.side-pct').textContent = '—';
      el.querySelector('.side-sub').textContent = '';
    });
    this.logList.innerHTML = '<li class="log-empty">Les événements de la simulation apparaîtront ici.</li>';
    this.toasts.innerHTML = '';
    this.prevShare = [0.5, 0.5];
    this.prevShareAt = -99;
    this.hideTooltip();
  }

  setSpeed(speed) {
    this.speed = speed;
    document.querySelectorAll('#speeds button').forEach((b) => b.classList.toggle('on', Number(b.dataset.speed) === speed));
    $('speedLabel').textContent = String(speed).replace('.', ',') + '×';
  }

  setPaused(paused) {
    $('playBtn').textContent = paused ? '▶ PLAY' : '⏸ PAUSE';
    $('playBtn').classList.toggle('on', paused);
  }

  setToggle(id, on) { $(id).classList.toggle('on', on); }

  update(sim) {
    const snap = sim.snapshot();
    const t = sim.time;
    if (t - this.prevShareAt >= 1.5) {
      this.trend = snap.map((s, k) => s.share - this.prevShare[k]);
      this.prevShare = snap.map((s) => s.share);
      this.prevShareAt = t;
    }
    snap.forEach((s, k) => {
      const el = this.sides[k];
      const p = el.querySelector('.side-pct');
      p.textContent = pct(s.share);
      const tr = this.trend ? this.trend[k] : 0;
      p.classList.toggle('up', tr > 0.002);
      p.classList.toggle('down', tr < -0.002);
      el.querySelector('.bar-fill').style.width = (s.share * 100).toFixed(2) + '%';
      el.querySelector('.side-sub').textContent =
        `${pct0(s.ratio)} du territoire initial · ${s.phase === 'offensive' ? 'Poussée' : 'Consolidation'}`;
    });
    document.querySelector('.tug-a').style.width = (snap[0].share * 100).toFixed(2) + '%';
    $('clock').textContent = fmtTime(t) + ' / ' + fmtTime(sim.cfg.maxDuration);

    if (this.statsCollapsed) return;
    const [A, B] = snap;
    const sA = sim.sides[0].stats, sB = sim.sides[1].stats;
    const bar = (v, k) => `<div class="mini"><i style="width:${Math.max(0, Math.min(100, v * 100)).toFixed(1)}%;background:${this.colors[k]}"></i></div>`;
    const mom = (m, k) => {
      const w = Math.min(50, Math.abs(m) / 0.8 * 50);
      const left = m >= 0 ? 50 : 50 - w;
      return `<div class="mini"><i style="left:${left}%;width:${w}%;background:${m >= 0 ? '#5be39a' : '#ff6b6b'}"></i><i style="left:50%;width:1px;background:#fff;opacity:.5"></i></div>`;
    };
    const phase = (s) => `<span class="phase ${s.phase}">${s.phase === 'offensive' ? 'POUSSÉE' : 'CONSOLID.'}</span>`;
    const num = (v) => `<span style="text-align:right;font-weight:700">${v}</span>`;
    const c = this.countries;
    let html = `<div class="stat-grid">
      <span></span><span class="h">${flagHtml(c[0])}</span><span class="h">${flagHtml(c[1])}</span>
      <span class="lbl">Territoire</span>${num(pct0(A.share))}${num(pct0(B.share))}
      <span class="lbl">Parcelles</span>${num(A.cells)}${num(B.cells)}
      <span class="lbl">Stabilité</span>${bar(A.stability, 0)}${bar(B.stability, 1)}
      <span class="lbl">Ressources</span>${bar(A.resources / 100, 0)}${bar(B.resources / 100, 1)}
      <span class="lbl">Élan</span>${mom(A.momentum, 0)}${mom(B.momentum, 1)}
      <span class="lbl">Force actuelle</span>${num(A.attack.toFixed(2))}${num(B.attack.toFixed(2))}
      <span class="lbl">Phase</span>${phase(A)}${phase(B)}
      <span class="lbl">Marqueurs</span>${num(A.units)}${num(B.units)}
      <span class="lbl">Front (parcelles)</span>${num(A.front)}${num(B.front)}
    </div>
    <div class="stat-grid" style="margin-top:10px;opacity:.85">
      <span class="lbl">Puissance</span>${num(sA.puissance)}${num(sB.puissance)}
      <span class="lbl">Défense</span>${num(sA.defense)}${num(sB.defense)}
      <span class="lbl">Mobilité</span>${num(sA.mobilite)}${num(sB.mobilite)}
      <span class="lbl">Vitesse</span>${num(sA.vitesse)}${num(sB.vitesse)}
      <span class="lbl">Expansion</span>${num(sA.expansion)}${num(sB.expansion)}
    </div>`;
    const mods = [...A.mods.map((m) => [m, 0]), ...B.mods.map((m) => [m, 1])];
    if (mods.length) html += `<div class="mods">${mods.map(([m, k]) => `<span style="--c:${this.colors[k]}">${m}</span>`).join('')}</div>`;
    this.statsBody.innerHTML = html;
  }

  event(e, simTime) {
    const color = e.side >= 0 ? this.colors[e.side] : '#ffcf4a';
    const flag = e.side >= 0 ? flagHtml(this.countries[e.side]) : '';
    // notification
    const el = document.createElement('div');
    el.className = `toast ${e.tone || 'neutral'}`;
    el.style.setProperty('--c', color);
    el.innerHTML = `<div class="t-title"><span>${e.icon || '•'}</span>${flag}<span>${e.title}</span></div><div class="t-text">${e.text}</div>`;
    this.toasts.prepend(el);
    while (this.toasts.children.length > 2) this.toasts.lastChild.remove();
    const life = this.speed >= 4 ? 2000 : 3300; // plus court en accéléré pour ne pas masquer la carte
    setTimeout(() => el.classList.add('out'), life);
    setTimeout(() => el.remove(), life + 450);
    // journal
    const empty = this.logList.querySelector('.log-empty');
    if (empty) empty.remove();
    const li = document.createElement('li');
    li.style.setProperty('--c', color);
    li.innerHTML = `<time>${fmtTime(simTime)}</time><b>${e.icon || ''} ${e.title}</b>${e.text}`;
    this.logList.prepend(li);
    while (this.logList.children.length > 14) this.logList.lastChild.remove();
  }

  showTooltip(x, y, html) {
    const t = this.tooltip;
    t.innerHTML = html;
    t.classList.remove('hidden');
    const w = t.offsetWidth, h = t.offsetHeight;
    t.style.left = Math.min(window.innerWidth - w - 10, x + 14) + 'px';
    t.style.top = Math.min(window.innerHeight - h - 10, y + 14) + 'px';
  }
  hideTooltip() { this.tooltip.classList.add('hidden'); }
}
