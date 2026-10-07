// UI — écrans : menu principal, mode personnalisé, pause, résultats, sauvegardes
import { getCountry, resolveColors, randomPair, allCountries } from '../countries/countries.js';
import { flagHtml } from '../countries/flagImages.js';
import { STAT_KEYS, STAT_LABELS } from '../simulation/simulation.js';
import { EVENT_LEVELS, effectiveStats } from '../game/config.js';
import { RESOLUTIONS } from '../map/mapBuilder.js';
import { randomSeedString } from '../simulation/rng.js';
import { SPEEDS, fmtTime } from './hud.js';
import { CountryPicker } from './countryPicker.js';

const $ = (id) => document.getElementById(id);
export const show = (id, on = true) => $(id).classList.toggle('hidden', !on);

export function notice(text, ms = 2200) {
  const el = $('notice');
  el.textContent = text;
  el.classList.remove('hidden');
  clearTimeout(notice._t);
  notice._t = setTimeout(() => el.classList.add('hidden'), ms);
}

// ---------------- MENU PRINCIPAL ----------------
export class MainMenu {
  constructor(app) {
    this.app = app;
    this.pickA = new CountryPicker($('pickA'), { onChange: (c) => this.changed(0, c), getExcluded: () => app.config.b });
    this.pickB = new CountryPicker($('pickB'), { onChange: (c) => this.changed(1, c), getExcluded: () => app.config.a });
    $('swapBtn').addEventListener('click', () => {
      const cfg = app.config;
      [cfg.a, cfg.b] = [cfg.b, cfg.a];
      if (cfg.stats) cfg.stats = [cfg.stats[1], cfg.stats[0]];
      cfg.powerMult = [cfg.powerMult[1], cfg.powerMult[0]];
      cfg.statsFor = cfg.stats ? `${cfg.a}|${cfg.b}` : null;
      this.sync();
      app.preview();
    });
    $('randomPairBtn').addEventListener('click', () => {
      const [a, b] = randomPair();
      this.setPair(a.id, b.id);
    });
    $('launchBtn').addEventListener('click', () => app.launch({ newSeed: true }));
    $('customBtn').addEventListener('click', () => app.openCustom());
    $('spectatorBtn').addEventListener('click', () => app.launchSpectator());
    $('loadBtn').addEventListener('click', () => app.openLoad());
    $('quitBtn').addEventListener('click', () => { window.location.href = 'index.html'; });
  }

  setPair(a, b) {
    const cfg = this.app.config;
    cfg.a = a; cfg.b = b; cfg.stats = null; cfg.statsFor = null; cfg.powerMult = [1, 1];
    this.sync();
    this.app.preview();
  }

  changed(side, c) {
    const cfg = this.app.config;
    if (side === 0) cfg.a = c.id; else cfg.b = c.id;
    cfg.stats = null; cfg.statsFor = null; cfg.powerMult = [1, 1];
    this.app.preview();
  }

  sync() {
    this.pickA.select(this.app.config.a, true);
    this.pickB.select(this.app.config.b, true);
    const a = getCountry(this.app.config.a), b = getCountry(this.app.config.b);
    const [ca, cb] = resolveColors(a, b);
    document.documentElement.style.setProperty('--color-a', ca);
    document.documentElement.style.setProperty('--color-b', cb);
    $('menuHint').textContent = `${allCountries().length} pays disponibles`;
  }

  open() { show('menu'); this.sync(); }
  close() { show('menu', false); this.pickA.close(); this.pickB.close(); }
}

// ---------------- MODE PERSONNALISÉ ----------------
export class CustomMenu {
  constructor(app) {
    this.app = app;
    this.draft = null;
    const bindRange = (id, out, key, fmt, idx) => {
      $(id).addEventListener('input', () => {
        const v = Number($(id).value);
        if (idx !== undefined) this.draft[key][idx] = v; else this.draft[key] = v;
        $(out).textContent = fmt(v);
      });
    };
    const fmtPow = (v) => '×' + v.toFixed(2).replace('.', ',');
    bindRange('powA', 'outPowA', 'powerMult', fmtPow, 0);
    bindRange('powB', 'outPowB', 'powerMult', fmtPow, 1);
    bindRange('dur', 'outDur', 'maxDuration', (v) => fmtTime(v));
    bindRange('rand', 'outRand', 'randomness', (v) => Math.round(v * 100) + ' %');
    bindRange('vict', 'outVict', 'victoryRatio', (v) => Math.round(v * 100) + ' %');
    $('seed').addEventListener('input', () => { this.draft.seed = $('seed').value.trim() || randomSeedString(); });
    $('seedDice').addEventListener('click', () => { this.draft.seed = randomSeedString(); $('seed').value = this.draft.seed; });
    $('statsReset').addEventListener('click', () => { this.draft.stats = null; this.draft.statsFor = null; this.renderStats(); });
    $('customBack').addEventListener('click', () => app.closeCustom());
    $('customSave').addEventListener('click', () => { this.commit(); app.openSave(); });
    $('customLaunch').addEventListener('click', () => { this.commit(); app.launch({ newSeed: false }); });
  }

  seg(id, items, current, onPick) {
    const el = $(id);
    el.innerHTML = items.map((it) => `<button data-v="${it.value}" class="${String(it.value) === String(current) ? 'on' : ''}">${it.label}</button>`).join('');
    el.querySelectorAll('button').forEach((b) => b.addEventListener('click', () => {
      el.querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === b));
      onPick(b.dataset.v);
    }));
  }

  open() {
    const cfg = this.app.config;
    this.draft = JSON.parse(JSON.stringify(cfg));
    const d = this.draft;
    const a = getCountry(d.a), b = getCountry(d.b);
    this.colors = resolveColors(a, b);
    $('customMatchup').innerHTML = `${flagHtml(a)} ${a.name} <span style="color:var(--muted)">VS</span> ${flagHtml(b)} ${b.name}`;
    document.querySelectorAll('#custom [data-name="0"]').forEach((e) => { e.textContent = a.name; });
    document.querySelectorAll('#custom [data-name="1"]').forEach((e) => { e.textContent = b.name; });
    const set = (id, out, v, txt) => { $(id).value = v; $(out).textContent = txt; };
    set('powA', 'outPowA', d.powerMult[0], '×' + d.powerMult[0].toFixed(2).replace('.', ','));
    set('powB', 'outPowB', d.powerMult[1], '×' + d.powerMult[1].toFixed(2).replace('.', ','));
    set('dur', 'outDur', d.maxDuration, fmtTime(d.maxDuration));
    set('rand', 'outRand', d.randomness, Math.round(d.randomness * 100) + ' %');
    set('vict', 'outVict', d.victoryRatio, Math.round(d.victoryRatio * 100) + ' %');
    $('seed').value = d.seed;
    this.seg('segSpeed', SPEEDS.map((s) => ({ value: s, label: String(s).replace('.', ',') + '×' })), d.speed, (v) => { d.speed = Number(v); });
    const evCur = EVENT_LEVELS.reduce((m, l) => (Math.abs(l.value - d.eventRate) < Math.abs(m.value - d.eventRate) ? l : m)).value;
    this.seg('segEvents', EVENT_LEVELS, evCur, (v) => { d.eventRate = Number(v); });
    this.seg('segRes', Object.entries(RESOLUTIONS).map(([k, r]) => ({ value: k, label: r.label.replace(' (détaillé)', '') })), d.resolution, (v) => { d.resolution = v; });
    this.renderStats();
    show('custom');
  }

  renderStats() {
    const d = this.draft;
    const stats = effectiveStats(d);
    const countries = [getCountry(d.a), getCountry(d.b)];
    const el = $('statsEditor');
    el.innerHTML = [0, 1].map((k) => `
      <div>
        <div class="col-head" style="--c:${this.colors[k]}">${flagHtml(countries[k])} ${countries[k].name}</div>
        ${STAT_KEYS.map((key) => `
          <div class="stat-row">
            <span>${STAT_LABELS[key]}</span><span class="v" id="sv${k}${key}">${stats[k][key]}</span>
            <input type="range" min="10" max="100" step="1" value="${stats[k][key]}" data-side="${k}" data-key="${key}">
          </div>`).join('')}
      </div>`).join('');
    el.querySelectorAll('input').forEach((inp) => inp.addEventListener('input', () => {
      if (!d.stats || d.statsFor !== `${d.a}|${d.b}`) { d.stats = effectiveStats(d); d.statsFor = `${d.a}|${d.b}`; }
      const side = Number(inp.dataset.side), key = inp.dataset.key;
      d.stats[side][key] = Number(inp.value);
      $(`sv${side}${key}`).textContent = inp.value;
    }));
  }

  commit() {
    Object.assign(this.app.config, this.draft);
  }

  close() { show('custom', false); }
}

// ---------------- RÉSULTATS ----------------
export function renderResults(result, config, colors) {
  const countries = [getCountry(config.a), getCountry(config.b)];
  const w = result.winner;
  $('winnerLine').innerHTML = w >= 0
    ? `${flagHtml(countries[w])} Victoire de ${countries[w].name}${result.reason === 'temps' ? ' (au temps)' : ''}`
    : 'Égalité : aucun pays ne prend l\'avantage';
  ['resA', 'resB'].forEach((id, k) => {
    const el = $(id);
    el.style.setProperty('--c', colors[k]);
    el.classList.toggle('win', w === k);
    el.innerHTML = `
      <div class="crown">${w === k ? '★ VAINQUEUR' : ''}</div>
      <div class="rs-name">${flagHtml(countries[k])} ${countries[k].name.toUpperCase()}</div>
      <div class="rs-pct">${(result.share[k] * 100).toFixed(0)} %</div>
      <div class="rs-sub">Territoire final</div>
      <div class="rs-sub">${Math.round(result.ratio[k] * 100)} % du territoire initial · ${result.captured[k]} parcelles gagnées</div>`;
  });
  const why = result.reason === 'temps' ? 'Durée maximale atteinte' : 'Condition de victoire territoriale atteinte';
  $('resultMeta').textContent = `${why} · durée simulée ${fmtTime(result.time)} · ${result.events} événements · seed ${config.seed}`;
  drawHistory($('historyChart'), result.history, colors, countries);
}

function drawHistory(canvas, history, colors, countries) {
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const W = canvas.clientWidth || 560, H = canvas.clientHeight || 140;
  canvas.width = W * dpr; canvas.height = H * dpr;
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, W, H);
  if (history.length < 2) return;
  const pad = { l: 34, r: 10, t: 12, b: 20 };
  const tMax = history[history.length - 1][0] || 1;
  const X = (t) => pad.l + (t / tMax) * (W - pad.l - pad.r);
  const Y = (v) => pad.t + (1 - v) * (H - pad.t - pad.b);
  // zone A (bas) et B (haut)
  ctx.beginPath();
  ctx.moveTo(X(0), Y(0));
  for (const [t, v] of history) ctx.lineTo(X(t), Y(v));
  ctx.lineTo(X(tMax), Y(0));
  ctx.closePath();
  ctx.fillStyle = colors[0];
  ctx.globalAlpha = 0.5; ctx.fill();
  ctx.beginPath();
  ctx.moveTo(X(0), Y(1));
  for (const [t, v] of history) ctx.lineTo(X(t), Y(v));
  ctx.lineTo(X(tMax), Y(1));
  ctx.closePath();
  ctx.fillStyle = colors[1];
  ctx.fill();
  ctx.globalAlpha = 1;
  ctx.beginPath();
  history.forEach(([t, v], k) => (k ? ctx.lineTo(X(t), Y(v)) : ctx.moveTo(X(t), Y(v))));
  ctx.strokeStyle = '#fff'; ctx.lineWidth = 2; ctx.stroke();
  // axes
  ctx.fillStyle = 'rgba(255,255,255,0.6)';
  ctx.font = '11px "Bahnschrift","Segoe UI",sans-serif';
  ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
  for (const v of [0, 0.5, 1]) {
    ctx.fillText(Math.round(v * 100) + '%', pad.l - 5, Y(v));
    ctx.strokeStyle = 'rgba(255,255,255,0.12)'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(pad.l, Y(v)); ctx.lineTo(W - pad.r, Y(v)); ctx.stroke();
  }
  ctx.textAlign = 'center'; ctx.textBaseline = 'top';
  ctx.fillText('0:00', X(0) + 12, H - pad.b + 5);
  ctx.fillText(fmtTime(tMax), X(tMax) - 18, H - pad.b + 5);
  ctx.fillText(`Évolution du territoire — ${countries[0].name} (bas) / ${countries[1].name} (haut)`, W / 2 + 10, H - pad.b + 5);
}

// ---------------- CHARGER ----------------
export async function renderSlots(saveSystem, onLoad, onDelete) {
  const list = await saveSystem.list();
  const el = $('slotList');
  if (!list.length) { el.innerHTML = '<li class="empty">Aucune sauvegarde pour le moment.</li>'; return; }
  el.innerHTML = list.map((s) => {
    const a = getCountry(s.config.a), b = getCountry(s.config.b);
    const date = new Date(s.date);
    return `<li data-id="${s.id}">
      <div class="slot-main">
        <div class="slot-name">${escapeHtml(s.name)}</div>
        <div class="slot-meta">${a ? flagHtml(a) : ''} ${a ? a.name : '?'} vs ${b ? flagHtml(b) : ''} ${b ? b.name : '?'} · seed ${escapeHtml(s.config.seed || '')} · ${date.toLocaleDateString('fr-FR')} ${date.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}</div>
      </div>
      <button class="ghost small" data-act="load">Charger</button>
      <button class="ghost small" data-act="del" title="Supprimer">🗑</button>
    </li>`;
  }).join('');
  el.querySelectorAll('li[data-id]').forEach((li) => {
    const slot = list.find((s) => s.id === li.dataset.id);
    li.querySelector('[data-act=load]').addEventListener('click', () => onLoad(slot));
    li.querySelector('[data-act=del]').addEventListener('click', async () => { await onDelete(slot); renderSlots(saveSystem, onLoad, onDelete); });
  });
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
