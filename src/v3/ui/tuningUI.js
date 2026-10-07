// UI — RÉGLAGES AVANCÉS : profils (Équilibré, Réaliste, Guerre totale, Diplomatique, Bâtisseur, Arcade, profils
// enregistrés par le joueur) et une trentaine de curseurs par catégorie. Avant la partie : valeurs de la partie à
// créer ; en partie : le jeu se met en pause, et la validation envoie un ordre (identique chez tous les joueurs).
import { $, show, isShown, esc, notice } from './util.js';
import { icon } from './icons.js';
import { Store } from '../save/store.js';
import { TUNING, TUNING_CATS, TUNING_PROFILES, normalizeTuning, profileTuning, matchProfile, defaultTuning } from '../sim/tuning.js';

const fmt = (p, v) => `×${(Math.round(v * 100) / 100).toLocaleString('fr-FR')}`;
const PREFIX = 'profil-';

export class TuningUI {
  constructor(app) {
    this.app = app;
    this.custom = [];         // profils enregistrés : [{ id, name, v }]
    const t = document.createElement('template');
    t.innerHTML = `<section id="tuningDialog" class="overlay hidden"><div class="dialog wide panel tuning" id="tuningBox"></div></section>`;
    document.body.appendChild(t.content.firstChild);
    $('tuningDialog').addEventListener('keydown', (e) => e.stopPropagation());
  }
  isOpen() { return isShown('tuningDialog'); }
  async _loadCustom() {
    try {
      const list = await Store.list('reglages');
      const out = [];
      for (const x of list) if (x.id.startsWith(PREFIX)) { const d = await Store.read('reglages', x.id); if (d && d.v) out.push({ id: x.id, name: d.name || x.id.slice(PREFIX.length), v: normalizeTuning(d.v) }); }
      this.custom = out.sort((a, b) => a.name.localeCompare(b.name));
    } catch (_) { this.custom = []; }
  }
  // opts : { tuning, onDone(t), inGame, readonly }
  async open(opts) {
    this.opts = opts;
    this.t = normalizeTuning(opts.tuning);
    this.cat = this.cat || 'diplo';
    await this._loadCustom();
    this._render();
    show('tuningDialog');
    // réglages ouverts en partie : jeu en pause (en multijoueur, l'hôte met la partie commune en pause)
    this._netPaused = false;
    if (opts.inGame) {
      const s = this.app.session, net = s.net;
      if (net && net.active && net.isHost) { if (s.state === 'running') { s.pause(); this.app.hud.setPaused(true); this._netPaused = true; } }
      else this.app.pauseForOverlay();
    }
  }
  close() {
    show('tuningDialog', false);
    if (!this.opts || !this.opts.inGame) return;
    if (this._netPaused) { const s = this.app.session; if (s.state === 'paused') { s.resume(); this.app.hud.setPaused(false); } this._netPaused = false; }
    else this.app.resumeAfterOverlay();
  }

  _render() {
    const ro = !!this.opts.readonly;
    const cur = matchProfile(this.t);
    const customHit = this.custom.find((c) => TUNING.every((p) => c.v[p.id] === this.t[p.id]));
    const prof = (id, label, desc, on, del = false) => `<button class="tn-prof ${on ? 'on' : ''}" data-prof="${esc(id)}" ${ro ? 'disabled' : ''} title="${esc(desc)}"><b>${esc(label)}</b><small>${esc(desc)}</small>${del ? `<i data-del="${esc(id)}" title="Supprimer ce profil">${icon('trash-2')}</i>` : ''}</button>`;
    const changed = TUNING.filter((p) => this.t[p.id] !== p.def).length;
    $('tuningBox').innerHTML = `
      <div class="tn-head"><div><small class="eyebrow">${this.opts.inGame ? 'Partie en cours · jeu en pause' : 'Avant la partie'}</small><h2>Réglages avancés</h2></div>
        <span class="hint">${changed ? `${changed} paramètre(s) modifié(s)` : 'Valeurs de base'}${ro ? ' · lecture seule (seul l\'hôte modifie les réglages)' : ''}</span></div>
      <div class="tn-profs">${TUNING_PROFILES.map((p) => prof(p.id, p.label, p.desc, cur === p.id && !customHit)).join('')}${this.custom.map((c) => prof(c.id, c.name, 'Profil enregistré', customHit === c, true)).join('')}</div>
      <nav class="nm-tabs tn-cats">${TUNING_CATS.map(([k, l, ic]) => `<button data-cat="${k}" class="${this.cat === k ? 'on' : ''}">${icon(ic)}<span>${l}</span></button>`).join('')}</nav>
      <div class="tn-list">${TUNING.filter((p) => p.cat === this.cat).map((p) => `<div class="field tn-row ${this.t[p.id] !== p.def ? 'mod' : ''}"><label><span>${esc(p.label)}</span><output data-out="${p.id}">${fmt(p, this.t[p.id])}</output></label>
        <input type="range" data-tn="${p.id}" min="${p.min}" max="${p.max}" step="${p.step}" value="${this.t[p.id]}" ${ro ? 'disabled' : ''}><small class="hint">${esc(p.desc)}</small></div>`).join('')}</div>
      <div class="dialog-foot">
        ${ro ? '' : `<button class="btn ghost sm" data-act="reset">${icon('rotate-ccw')}<span>Valeurs de base</span></button>
        <input type="text" id="tnName" maxlength="28" placeholder="Nom du profil" spellcheck="false"><button class="btn ghost sm" data-act="save">${icon('save')}<span>Enregistrer le profil</span></button>`}
        <span class="grow"></span>
        <button class="btn ghost" data-act="cancel">${ro ? 'Fermer' : 'Annuler'}</button>${ro ? '' : `<button class="btn primary" data-act="ok">${this.opts.inGame ? 'Appliquer' : 'Valider'}</button>`}
      </div>`;
    const box = $('tuningBox');
    box.querySelectorAll('[data-cat]').forEach((b) => { b.onclick = () => { this.cat = b.dataset.cat; this._render(); }; });
    box.querySelectorAll('[data-tn]').forEach((inp) => {
      inp.oninput = () => { const p = TUNING.find((x) => x.id === inp.dataset.tn); this.t[p.id] = Number(inp.value); box.querySelector(`[data-out="${p.id}"]`).textContent = fmt(p, this.t[p.id]); };
      inp.onchange = () => { this.t = normalizeTuning(this.t); this._render(); };
    });
    box.querySelectorAll('[data-prof]').forEach((b) => { b.onclick = (e) => {
      const del = e.target.closest('[data-del]');
      if (del) { this._delete(del.dataset.del); return; }
      const id = b.dataset.prof;
      const c = this.custom.find((x) => x.id === id);
      this.t = c ? normalizeTuning(c.v) : profileTuning(id);
      this._render();
    }; });
    const act = (k, f) => { const b = box.querySelector(`[data-act="${k}"]`); if (b) b.onclick = f; };
    act('reset', () => { this.t = defaultTuning(); this._render(); });
    act('cancel', () => this.close());
    act('save', () => this._save());
    act('ok', () => { const t = normalizeTuning(this.t); this.close(); if (this.opts.onDone) this.opts.onDone(t); });
    const nm = $('tnName'); if (nm) nm.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter') this._save(); });
  }
  async _save() {
    const name = ($('tnName').value || '').trim();
    if (!name) { notice('Donnez un nom au profil.'); $('tnName').focus(); return; }
    const id = PREFIX + name.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40);
    await Store.write('reglages', id, { name, v: normalizeTuning(this.t), meta: { name, updatedAt: new Date().toISOString() } });
    notice(`Profil « ${name} » enregistré : il sera proposé dans toutes vos parties.`);
    await this._loadCustom();
    this._render();
  }
  async _delete(id) {
    const c = this.custom.find((x) => x.id === id);
    if (!c || !window.confirm(`Supprimer le profil « ${c.name} » ?`)) return;
    await Store.remove('reglages', id);
    await this._loadCustom();
    this._render();
  }
}

// résumé court pour un bouton : « Réglages : Réaliste » / « Réglages : personnalisés »
export function tuningBadge(t) {
  const id = matchProfile(t || {});
  const p = TUNING_PROFILES.find((x) => x.id === id);
  return `Réglages : ${p ? p.label : 'personnalisés'}`;
}
