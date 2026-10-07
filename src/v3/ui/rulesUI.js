// UI — RÈGLES DE LA PARTIE : activer / désactiver chaque système avant de lancer une simulation.
// Préréglages (tout activer, tout désactiver, recommandé), règles imposées par un scénario (verrouillées),
// consultation en lecture seule pendant la partie.
import { $, show, esc } from './util.js';
import { icon } from './icons.js';
import { RULES, RULE_CATS, RULE_BY_ID, PRESETS, MODES, defaultRules, resolveRules } from '../sim/rules.js';

export class RulesUI {
  constructor() {
    const t = document.createElement('template');
    t.innerHTML = `<section id="rulesDialog" class="overlay hidden"><div class="dialog wide panel rules" id="rulesBox"></div></section>`;
    document.body.appendChild(t.content.firstChild);
  }
  isOpen() { return !$('rulesDialog').classList.contains('hidden'); }
  // opts : { mode, rules, locked, readonly, title, onDone(rules) }
  open(opts = {}) {
    this.opts = opts;
    this.mode = opts.mode || 'sandbox';
    this.locked = opts.locked || {};
    this.rules = { ...defaultRules(this.mode), ...(opts.rules || {}), ...this.locked };
    this.render();
    show('rulesDialog');
  }
  close() { show('rulesDialog', false); if (this.opts && this.opts.onClose) this.opts.onClose(); }
  isCustom() { const rec = defaultRules(this.mode); return RULES.some((r) => (this.rules[r.id] !== false) !== (rec[r.id] !== false)); }
  render() {
    const o = this.opts;
    const ro = !!o.readonly;
    const eff = resolveRules({ rules: this.rules, mode: this.mode, lockedRules: this.locked });
    const off = RULES.filter((r) => eff[r.id] === false).length;
    const row = (r) => {
      const locked = this.locked[r.id] !== undefined;
      const on = this.rules[r.id] !== false;
      const forced = on && eff[r.id] === false;    // coupé par une règle parente
      return `<label class="rule ${on && !forced ? 'on' : ''} ${locked ? 'locked' : ''} ${forced ? 'forced' : ''}">
        <input type="checkbox" data-rule="${r.id}" ${on ? 'checked' : ''} ${ro || locked ? 'disabled' : ''}>
        <span class="sw"></span>
        <span class="txt"><b>${esc(r.label)}${locked ? ` ${icon('shield')}` : ''}</b><small>${esc(r.desc)}${locked ? ' Imposé par le scénario.' : ''}${forced ? ' Désactivé avec le système dont il dépend.' : ''}${r.nation ? ' (mode Nation)' : ''}</small></span></label>`;
    };
    $('rulesBox').innerHTML = `
      <div class="rules-head"><div><h2>${esc(o.title || 'Règles de la partie')}</h2>
        <p class="hint">${esc(MODES[this.mode] ? `${MODES[this.mode].label} : ${MODES[this.mode].desc}` : '')} Un système désactivé l'est dans toute la simulation : IA, événements et interface.</p></div>
        <button class="btn ghost sm icon" id="rlClose" title="Fermer">${icon('x')}</button></div>
      ${ro ? '' : `<div class="rules-presets">${Object.entries(PRESETS).map(([k, p]) => `<button class="btn ghost sm" data-preset="${k}">${esc(p.label)}</button>`).join('')}
        <span class="rules-mode ${this.isCustom() ? 'custom' : ''}">${this.isCustom() ? 'Mode personnalisé' : 'Réglages recommandés'}</span></div>`}
      <div class="rules-grid">${RULE_CATS.map(([c, label, ic]) => {
        const list = RULES.filter((r) => r.cat === c || (r.also || []).includes(c));
        return `<section class="rules-cat"><h3>${icon(ic)}<span>${esc(label)}</span></h3>${list.map(row).join('')}</section>`;
      }).join('')}</div>
      <div class="dialog-foot"><span class="hint grow">${off ? `${off} système${off > 1 ? 's' : ''} désactivé${off > 1 ? 's' : ''}.` : 'Tous les systèmes sont actifs.'}</span>
        ${ro ? '<button class="btn primary" id="rlOk">Fermer</button>' : '<button class="btn ghost" id="rlCancel">Annuler</button><button class="btn primary" id="rlOk">Valider ces règles</button>'}</div>`;
    const box = $('rulesBox');
    $('rlClose').onclick = () => this.close();
    if ($('rlCancel')) $('rlCancel').onclick = () => this.close();
    $('rlOk').onclick = () => { if (!ro && o.onDone) o.onDone({ ...this.rules }); this.close(); };
    box.querySelectorAll('[data-rule]').forEach((inp) => inp.addEventListener('change', () => {
      const id = inp.dataset.rule;
      this.rules[id] = inp.checked;
      this.render();
    }));
    box.querySelectorAll('[data-preset]').forEach((b) => b.addEventListener('click', () => {
      this.rules = { ...PRESETS[b.dataset.preset].make(this.mode), ...this.locked };
      this.render();
    }));
    void RULE_BY_ID;
  }
}

// résumé court pour un bouton (« Tous les systèmes actifs » / « 3 systèmes désactivés »)
export function rulesBadge(rules, mode, locked = {}) {
  const eff = resolveRules({ rules, mode, lockedRules: locked });
  const off = RULES.filter((r) => eff[r.id] === false);
  return off.length ? `${off.length} système${off.length > 1 ? 's' : ''} désactivé${off.length > 1 ? 's' : ''}` : 'Tous les systèmes actifs';
}
