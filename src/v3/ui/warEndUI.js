// UI — FIN DES GUERRES : « Paix automatique » ON/OFF et conditions de fin configurables.
// Utilisé au lancement d'une partie Nation et pendant la partie (modifications appliquées immédiatement).
import { $, show, esc } from './util.js';
import { icon } from './icons.js';
import { END_CONDITIONS, NATION_WAR_END, NO_AUTO_END, normalizeWarEnd } from '../sim/warEnd.js';

export class WarEndUI {
  constructor() {
    const t = document.createElement('template');
    t.innerHTML = '<section id="warEndDialog" class="overlay hidden"><div class="dialog panel warend" id="warEndBox"></div></section>';
    document.body.appendChild(t.content.firstChild);
  }
  isOpen() { return !$('warEndDialog').classList.contains('hidden'); }
  // opts : { warEnd, nation, title, onDone(warEnd), onClose }
  open(opts = {}) {
    this.opts = opts;
    this.we = normalizeWarEnd(opts.warEnd || NATION_WAR_END, opts.nation !== false);
    this.render();
    show('warEndDialog');
  }
  close() { show('warEndDialog', false); if (this.opts && this.opts.onClose) this.opts.onClose(); }
  render() {
    const we = this.we, o = this.opts;
    const cond = (c) => {
      if (c.id === 'maxYears') {
        return `<div class="we-row ${we.maxYears > 0 ? 'on' : ''}"><span class="we-ic">${c.icon}</span><span class="txt"><b>${esc(c.label)}</b><small>${esc(c.desc)}</small></span>
          <span class="we-years"><input type="number" min="0" max="200" step="1" id="weYears" value="${we.maxYears || 0}"><small>an(s)</small></span></div>`;
      }
      const on = we[c.id] !== false;
      return `<label class="we-row ${on ? 'on' : ''}"><span class="we-ic">${c.icon}</span><span class="txt"><b>${esc(c.label)}</b><small>${esc(c.desc)}</small></span>
        <input type="checkbox" data-c="${c.id}" ${on ? 'checked' : ''}><span class="sw"></span></label>`;
    };
    const pct = Math.round((we.percent || 0.7) * 100);
    $('warEndBox').innerHTML = `
      <div class="rules-head"><div><h2>${esc(o.title || 'Fin des guerres')}</h2>
        <p class="hint">Vous restez maître de la décision de paix : choisissez ce qui peut mettre fin à une guerre.</p></div>
        <button class="btn ghost sm icon" id="weClose" title="Fermer">${icon('x')}</button></div>
      <label class="we-master ${we.autoPeace ? 'on' : ''}"><span class="txt"><b>Paix automatique</b>
        <small>${we.autoPeace ? `ON : une guerre se termine d'elle-même quand une condition est remplie (dont ${pct} % du territoire adverse conquis).` : 'OFF : aucune guerre ne se termine automatiquement parce qu\'un pays a perdu une part de son territoire. Ces situations déclenchent seulement des événements et des propositions de capitulation que vous acceptez, refusez ou amendez.'}</small></span>
        <b class="we-state">${we.autoPeace ? 'ON' : 'OFF'}</b><input type="checkbox" id="weAuto" ${we.autoPeace ? 'checked' : ''}><span class="sw"></span></label>
      <div class="we-pct"><span>${we.autoPeace ? 'Victoire territoriale à' : 'Événement « pays fortement affaibli » à'}</span>
        <input type="range" id="wePct" min="30" max="100" step="5" value="${pct}"><b id="wePctV">${pct} %</b>
        <label class="check"><input type="checkbox" id="wePctOn" ${we.territorial !== 'none' ? 'checked' : ''}><span>actif</span></label></div>
      <h3 class="we-h">Conditions de fin</h3>
      <div class="we-list">${END_CONDITIONS.map(cond).join('')}</div>
      <div class="rules-presets">
        <button class="btn ghost sm" data-preset="nation">${icon('landmark')}<span>Recommandé (Nation)</span></button>
        <button class="btn ghost sm" data-preset="none">${icon('ban')}<span>🚫 Aucune fin automatique</span></button>
        <button class="btn ghost sm" data-preset="auto">${icon('zap')}<span>Paix automatique classique</span></button>
      </div>
      <p class="hint">La perte de territoire pèse toujours sur la stabilité, l'économie, le moral, la capacité militaire, la diplomatie et les risques de révolte et de capitulation — sans jamais forcer la paix quand la paix automatique est désactivée.</p>
      <div class="dialog-foot"><span class="grow"></span><button class="btn ghost" id="weCancel">Annuler</button><button class="btn primary" id="weOk">${icon('check')}<span>Valider</span></button></div>`;
    const box = $('warEndBox');
    $('weClose').onclick = () => this.close();
    $('weCancel').onclick = () => this.close();
    $('weOk').onclick = () => { if (o.onDone) o.onDone({ ...this.we }); this.close(); };
    $('weAuto').onchange = () => { we.autoPeace = $('weAuto').checked; this.render(); };
    const pr = $('wePct');
    pr.oninput = () => { we.percent = Number(pr.value) / 100; $('wePctV').textContent = `${pr.value} %`; };
    pr.onchange = () => this.render();
    $('wePctOn').onchange = () => { we.territorial = $('wePctOn').checked ? (we.percent >= 1 ? 'complete' : 'percent') : 'none'; this.render(); };
    const yr = $('weYears');
    yr.addEventListener('keydown', (e) => e.stopPropagation());
    yr.onchange = () => { we.maxYears = Math.max(0, Math.min(200, Math.round(Number(yr.value) || 0))); this.render(); };
    box.querySelectorAll('[data-c]').forEach((cb) => cb.onchange = () => { we[cb.dataset.c] = cb.checked; this.render(); });
    box.querySelectorAll('[data-preset]').forEach((b) => b.onclick = () => {
      const k = b.dataset.preset;
      this.we = k === 'none' ? { ...NO_AUTO_END, percent: we.percent } : k === 'auto' ? { ...NATION_WAR_END, autoPeace: true, percent: 0.65, objectives: false } : { ...NATION_WAR_END };
      this.render();
    });
  }
}
