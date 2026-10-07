// UI — petits utilitaires partagés
import { flagUrlFor } from '../globe/flagAtlas.js';

export const $ = (id) => document.getElementById(id);
// affichage avec transitions : les écrans et fenêtres disparaissent en fondu
export function show(id, on = true) {
  const el = $(id);
  const animated = el.classList.contains('screen') || el.classList.contains('overlay');
  clearTimeout(el._hideT);
  if (on) {
    el.classList.remove('leaving');
    if (el.classList.contains('hidden')) { el.classList.remove('hidden'); fillRanges(el); }
    return;
  }
  if (el.classList.contains('hidden')) return;
  if (!animated) { el.classList.add('hidden'); return; }
  el.classList.add('leaving');
  el._hideT = setTimeout(() => { el.classList.add('hidden'); el.classList.remove('leaving'); }, 190);
}
export const isShown = (id) => { const el = $(id); return !el.classList.contains('hidden') && !el.classList.contains('leaving'); };

// curseurs : partie remplie de la piste (couleur d'accent jusqu'à la valeur)
export function fillRange(el) {
  const min = Number(el.min || 0), max = Number(el.max || 100);
  el.style.setProperty('--fill', ((Number(el.value) - min) / (max - min || 1) * 100).toFixed(1) + '%');
}
export function fillRanges(root = document) { root.querySelectorAll('input[type=range]').forEach(fillRange); }
if (typeof document !== 'undefined') document.addEventListener('input', (e) => { if (e.target && e.target.type === 'range') fillRange(e.target); }, true);

export function notice(text, ms = 2400) {
  const el = $('notice');
  el.textContent = text;
  el.classList.remove('hidden');
  clearTimeout(notice._t);
  notice._t = setTimeout(() => el.classList.add('hidden'), ms);
}

export function fmtTime(t) {
  const s = Math.max(0, Math.floor(t));
  return String(Math.floor(s / 60)).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0');
}

export function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

export const colorDot = (entity) => `<i class="dot" style="background:${entity && entity.color ? entity.color : '#888'}"></i>`;

export function flagImg(entity, cls = 'flag') {
  if (!entity) return '';
  return `<img class="${cls}" src="${flagUrlFor(entity)}" alt="" draggable="false">`;
}

export const fmtInt = (n) => Math.round(n).toLocaleString('fr-FR');
export const pct = (v, d = 1) => (v * 100).toFixed(d).replace('.', ',') + ' %';

export const TEAM_COLORS = ['#3b82f6', '#f59e0b', '#10b981', '#ef4444', '#a855f7', '#06b6d4', '#f97316', '#84cc16', '#ec4899', '#eab308', '#14b8a6', '#6366f1'];
export const teamName = (k) => 'ÉQUIPE ' + (k < 26 ? String.fromCharCode(65 + k) : k + 1);

export function seg(el, items, current, onPick) {
  el.innerHTML = items.map((it) => `<button data-v="${it.value}" class="${String(it.value) === String(current) ? 'on' : ''}">${it.label}</button>`).join('');
  el.querySelectorAll('button').forEach((b) => b.addEventListener('click', () => {
    el.querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === b));
    onPick(b.dataset.v);
  }));
}

export function bindRange(id, outId, fmt, onInput) {
  const el = $(id);
  const upd = () => { const v = Number(el.value); $(outId).textContent = fmt(v); onInput && onInput(v); };
  el.addEventListener('input', upd);
  return (v) => { el.value = v; $(outId).textContent = fmt(Number(v)); };
}
