// UI — CRÉER UN SCÉNARIO : pays, situation de départ, objectifs (modèles paramétrables), durée,
// règles imposées et textes de fin. Les scénarios sont enregistrés localement (« Mes scénarios »).
import { $, show, esc, notice } from './util.js';
import { icon } from './icons.js';
import { Store, newId } from '../save/store.js';
import { OBJECTIVE_TEMPLATES, SCENARIO_CATS, EVENT_PRESETS, FAIL_TYPES } from '../sim/scenarios.js';
import { DIFFICULTIES } from '../sim/rules.js';
import { rulesBadge } from './rulesUI.js';

const blank = () => ({
  id: newId('scenario'), title: '', desc: '', cats: [], country: 'FR', years: 10,
  start: { debt: null, money: null, gdp: 0, stability: 0, infra: 0, rival: '', rivalRel: -40, war: false },
  objectives: [{ type: 'gdp', value: 1.3, main: true }, { type: 'stability', value: 65 }],
  fails: [{ type: 'stability', value: 20 }], events: [], difficulty: 'normal',
  rules: {}, endWin: '', endLose: '',
});

export class ScenarioEditor {
  constructor(app) {
    this.app = app;
    const t = document.createElement('template');
    t.innerHTML = `<section id="scenarioEditor" class="overlay hidden"><div class="dialog wide panel sced" id="scedBox"></div></section>`;
    document.body.appendChild(t.content.firstChild);
    $('scenarioEditor').addEventListener('keydown', (e) => e.stopPropagation());
  }
  open(spec = null, onSaved = null) {
    this.spec = spec ? JSON.parse(JSON.stringify(spec)) : blank();
    this.spec.fails = this.spec.fails || []; this.spec.events = this.spec.events || []; this.spec.difficulty = this.spec.difficulty || 'normal';
    this.onSaved = onSaved;
    this.render();
    show('scenarioEditor');
  }
  close() { show('scenarioEditor', false); }
  render() {
    const s = this.spec, st = s.start;
    const ents = this.app.entities().filter((e) => e && e.kind === 'country' && !e.removed).sort((a, b) => a.name.localeCompare(b.name, 'fr'));
    const opts = (sel, none = false) => (none ? '<option value="">Aucun</option>' : '') + ents.map((e) => `<option value="${e.id}" ${e.id === sel ? 'selected' : ''}>${esc(e.name)}</option>`).join('');
    const rng = (key, label, min, max, step, val, fmt, hint = '') => `<div class="field"><label><span>${label}</span><output data-o="${key}">${fmt(val)}</output></label><input type="range" data-k="${key}" min="${min}" max="${max}" step="${step}" value="${val}">${hint ? `<small class="hint">${hint}</small>` : ''}</div>`;
    const pct = (v) => `${v > 0 ? '+' : ''}${v} %`;
    $('scedBox').innerHTML = `
      <div class="rules-head"><div><h2>${s.title ? esc(s.title) : 'Nouveau scénario'}</h2><p class="hint">Le scénario se joue en mode Nation : vous dirigez le pays choisi, l'IA dirige le reste du monde.</p></div><button class="btn ghost sm icon" data-a="close" title="Fermer">${icon('x')}</button></div>
      <div class="sced-grid">
        <section>
          <h3>Présentation</h3>
          <div class="field"><label><span>Titre</span></label><input type="text" data-f="title" maxlength="48" value="${esc(s.title)}" placeholder="La grande réforme"></div>
          <div class="field"><label><span>Situation (texte affiché au joueur)</span></label><textarea data-f="desc" rows="3" maxlength="400" placeholder="Décrivez la situation de départ et ce qui est attendu.">${esc(s.desc)}</textarea></div>
          <div class="field"><label><span>Catégories</span></label><div class="chips">${SCENARIO_CATS.filter((c) => c[0] !== 'mine').map(([k, l]) => `<button data-cat="${k}" class="chip ${s.cats.includes(k) ? 'on' : ''}">${l}</button>`).join('')}</div></div>
          <div class="field"><label><span>Pays joué</span></label><select data-f="country">${opts(s.country)}</select></div>
          ${rng('years', 'Durée', 3, 40, 1, s.years, (v) => `${v} ans`)}
          <h3>Fins</h3>
          <div class="field"><label><span>Texte en cas de triomphe (facultatif)</span></label><input type="text" data-f="endWin" maxlength="160" value="${esc(s.endWin)}"></div>
          <div class="field"><label><span>Texte en cas d'échec (facultatif)</span></label><input type="text" data-f="endLose" maxlength="160" value="${esc(s.endLose)}"></div>
        </section>
        <section>
          <h3>Situation de départ</h3>
          <label class="check"><input type="checkbox" data-t="debt" ${st.debt != null ? 'checked' : ''}><span>Fixer la dette publique</span></label>
          ${st.debt != null ? rng('debt', 'Dette', 0, 250, 5, st.debt, (v) => `${v} % du PIB`) : ''}
          <label class="check"><input type="checkbox" data-t="money" ${st.money != null ? 'checked' : ''}><span>Fixer la trésorerie</span></label>
          ${st.money != null ? rng('money', 'Trésorerie', 0, 30, 0.5, st.money, (v) => `${String(v).replace('.', ',')} % du PIB`) : ''}
          ${rng('gdp', 'Choc économique', -40, 40, 1, st.gdp, pct, 'Variation du PIB au départ.')}
          ${rng('stability', 'Stabilité', -40, 20, 1, st.stability, (v) => `${v > 0 ? '+' : ''}${v} points`)}
          ${rng('infra', 'Infrastructures', -60, 30, 5, st.infra, pct)}
          <div class="field"><label><span>Pays rival</span></label><select data-f="rival">${opts(st.rival, true)}</select></div>
          ${st.rival ? rng('rivalRel', 'Relations avec le rival', -100, 50, 5, st.rivalRel, (v) => String(v)) + `<label class="check"><input type="checkbox" data-t="war" ${st.war ? 'checked' : ''}><span>Le rival attaque dès le début</span></label>` : ''}
        </section>
        <section>
          <h3>Objectifs</h3>
          <ul class="sced-obj">${s.objectives.map((o, i) => { const T = OBJECTIVE_TEMPLATES[o.type]; return `<li>
            <select data-oi="${i}" data-of="type">${Object.entries(OBJECTIVE_TEMPLATES).map(([k, t]) => `<option value="${k}" ${k === o.type ? 'selected' : ''}>${t.label}</option>`).join('')}</select>
            ${T.max > T.min ? `<input type="number" data-oi="${i}" data-of="value" min="${T.min}" max="${T.max}" step="${T.step}" value="${o.value}"><span class="u">${T.unit}</span>` : '<span class="u"></span>'}
            <select data-oi="${i}" data-of="role">${[['main', 'Principal'], ['normal', 'Secondaire'], ['optional', 'Facultatif'], ['secret', 'Secret']].map(([k, l]) => `<option value="${k}" ${(o.main ? 'main' : o.secret ? 'secret' : o.optional ? 'optional' : 'normal') === k ? 'selected' : ''}>${l}</option>`).join('')}</select>
            ${T.needsTarget ? `<select data-oi="${i}" data-of="target">${opts(o.target || '', true)}</select>` : ''}
            <button class="btn ghost xs icon" data-rm="${i}" title="Retirer">${icon('x')}</button>
            <small>${esc(T.text(o.value, o.target ? (ents.find((e) => e.id === o.target) || {}).name : ''))}</small></li>`; }).join('')}</ul>
          ${s.objectives.length < 6 ? `<button class="btn ghost sm" data-a="addobj">${icon('plus')}<span>Ajouter un objectif</span></button>` : ''}
          <h3>Conditions d'échec</h3>
          <ul class="sced-list">${s.fails.map((f, i) => `<li><select data-fi="${i}" data-ff="type">${Object.entries(FAIL_TYPES).map(([k, l]) => `<option value="${k}" ${k === f.type ? 'selected' : ''}>${l}</option>`).join('')}</select>${['stability', 'territory', 'debt'].includes(f.type) ? `<input type="number" data-fi="${i}" data-ff="value" value="${f.value ?? 20}" min="0" max="300">` : ''}<button class="btn ghost xs icon" data-frm="${i}" title="Retirer">${icon('x')}</button></li>`).join('')}</ul>
          ${s.fails.length < 4 ? `<button class="btn ghost sm" data-a="addfail">${icon('plus')}<span>Ajouter une condition d'échec</span></button>` : ''}
          <h3>Événements</h3>
          <ul class="sced-list">${s.events.map((e, i) => `<li><input type="number" data-ei="${i}" data-ef="at" value="${e.at}" min="0" max="40" step="0.5" title="Année du scénario"><span class="hint">an(s)</span><select data-ei="${i}" data-ef="preset">${Object.entries(EVENT_PRESETS).map(([k, p]) => `<option value="${k}" ${k === e.preset ? 'selected' : ''}>${esc(p.label)}</option>`).join('')}</select><input type="text" data-ei="${i}" data-ef="title" maxlength="40" value="${esc(e.title || '')}" placeholder="Titre"><input type="text" data-ei="${i}" data-ef="text" maxlength="140" value="${esc(e.text || '')}" placeholder="Texte affiché"><button class="btn ghost xs icon" data-erm="${i}" title="Retirer">${icon('x')}</button></li>`).join('')}</ul>
          ${s.events.length < 8 ? `<button class="btn ghost sm" data-a="addevent">${icon('plus')}<span>Ajouter un événement</span></button>` : ''}
          <h3>Difficulté conseillée</h3>
          <select data-f="difficulty">${DIFFICULTIES.map((d) => `<option value="${d.id}" ${d.id === s.difficulty ? 'selected' : ''}>${esc(d.label)}</option>`).join('')}</select>
          <h3>Règles</h3>
          <p class="hint">Les règles choisies ici sont imposées au joueur.</p>
          <button class="btn ghost sm" data-a="rules">${icon('sliders-horizontal')}<span>${rulesBadge(s.rules, 'story')}</span></button>
        </section>
      </div>
      <div class="dialog-foot"><span class="hint grow" id="scedWarn"></span><button class="btn ghost" data-a="close">Annuler</button><button class="btn ghost" data-a="save">${icon('save')}<span>Enregistrer</span></button><button class="btn primary" data-a="play">${icon('play')}<span>Enregistrer et jouer</span></button></div>`;
    const box = $('scedBox');
    box.querySelectorAll('[data-f]').forEach((el) => el.addEventListener('input', () => {
      const f = el.dataset.f;
      if (f === 'rival') { st.rival = el.value; this.render(); return; }
      s[f] = el.value;
      if (f === 'title') box.querySelector('h2').textContent = el.value || 'Nouveau scénario';
    }));
    box.querySelectorAll('[data-k]').forEach((el) => el.addEventListener('input', () => {
      const k = el.dataset.k, v = Number(el.value);
      if (k === 'years') s.years = v; else st[k] = v;
      const o = box.querySelector(`[data-o="${k}"]`);
      const fmt = { years: (x) => `${x} ans`, debt: (x) => `${x} % du PIB`, money: (x) => `${String(x).replace('.', ',')} % du PIB`, stability: (x) => `${x > 0 ? '+' : ''}${x} points`, rivalRel: String }[k] || ((x) => `${x > 0 ? '+' : ''}${x} %`);
      if (o) o.textContent = fmt(v);
    }));
    box.querySelectorAll('[data-t]').forEach((el) => el.addEventListener('change', () => {
      const k = el.dataset.t;
      if (k === 'war') st.war = el.checked;
      else st[k] = el.checked ? (k === 'debt' ? 80 : 5) : null;
      this.render();
    }));
    box.querySelectorAll('[data-cat]').forEach((b) => b.addEventListener('click', () => {
      const c = b.dataset.cat;
      s.cats = s.cats.includes(c) ? s.cats.filter((x) => x !== c) : [...s.cats, c];
      b.classList.toggle('on');
    }));
    box.querySelectorAll('[data-oi]').forEach((el) => el.addEventListener('change', () => {
      const o = s.objectives[Number(el.dataset.oi)];
      const f = el.dataset.of;
      if (f === 'type') { o.type = el.value; o.value = OBJECTIVE_TEMPLATES[o.type].def; }
      else if (f === 'role') { o.main = el.value === 'main'; o.secret = el.value === 'secret'; o.optional = el.value === 'optional'; if (o.main) s.objectives.forEach((x) => { if (x !== o) x.main = false; }); }
      else if (f === 'target') o.target = el.value;
      else if (f === 'value') { const T = OBJECTIVE_TEMPLATES[o.type]; o.value = Math.max(T.min, Math.min(T.max, Number(el.value) || T.def)); }
      this.render();
    }));
    box.querySelectorAll('[data-rm]').forEach((b) => b.addEventListener('click', () => { s.objectives.splice(Number(b.dataset.rm), 1); this.render(); }));
    box.querySelectorAll('[data-fi]').forEach((el) => el.addEventListener('change', () => { const f = s.fails[Number(el.dataset.fi)]; if (el.dataset.ff === 'type') { f.type = el.value; f.value = { stability: 20, territory: 25, debt: 200 }[f.value] ?? f.value ?? 20; } else f.value = Number(el.value) || 0; this.render(); }));
    box.querySelectorAll('[data-frm]').forEach((b) => b.addEventListener('click', () => { s.fails.splice(Number(b.dataset.frm), 1); this.render(); }));
    box.querySelectorAll('[data-ei]').forEach((el) => el.addEventListener('change', () => { const e = s.events[Number(el.dataset.ei)]; const f = el.dataset.ef; e[f] = f === 'at' ? Math.max(0, Number(el.value) || 0) : el.value; }));
    box.querySelectorAll('[data-erm]').forEach((b) => b.addEventListener('click', () => { s.events.splice(Number(b.dataset.erm), 1); this.render(); }));
    box.querySelectorAll('[data-a]').forEach((b) => b.addEventListener('click', () => this._action(b.dataset.a)));
  }
  _validate() {
    const s = this.spec;
    if (!s.title.trim()) return 'Donnez un titre au scénario.';
    if (!s.objectives.length) return 'Ajoutez au moins un objectif.';
    if (!s.objectives.some((o) => !o.optional && !o.secret)) return 'Au moins un objectif doit être obligatoire.';
    if (s.objectives.some((o) => OBJECTIVE_TEMPLATES[o.type].needsTarget && !o.target)) return 'Choisissez le pays visé par l\'objectif de relations.';
    if (s.events.some((e) => e.preset === 'rivalWar') && !s.start.rival) return 'L\'événement « Le rival déclare la guerre » demande un pays rival.';
    if (s.start.rival && s.start.rival === s.country) return 'Le rival doit être un autre pays.';
    return '';
  }
  async _action(a) {
    const s = this.spec;
    if (a === 'close') { this.close(); return; }
    if (a === 'addobj') { const used = new Set(s.objectives.map((o) => o.type)); const t = Object.keys(OBJECTIVE_TEMPLATES).find((k) => !used.has(k)) || 'gdp'; s.objectives.push({ type: t, value: OBJECTIVE_TEMPLATES[t].def, optional: false }); this.render(); return; }
    if (a === 'addfail') { s.fails.push({ type: 'capital' }); this.render(); return; }
    if (a === 'addevent') { s.events.push({ at: Math.min(s.years - 1, 2), preset: 'ecoDown', title: '', text: '' }); this.render(); return; }
    if (a === 'rules') { this.app.rulesUI.open({ mode: 'story', rules: s.rules, title: 'Règles imposées par le scénario', onDone: (r) => { s.rules = r; this.render(); } }); return; }
    if (a === 'save' || a === 'play') {
      const err = this._validate();
      if (err) { $('scedWarn').textContent = err; return; }
      s.title = s.title.trim();
      const ok = await Store.write('scenarios', s.id, { meta: { name: s.title, country: s.country, years: s.years, desc: s.desc, difficulty: s.difficulty, updatedAt: new Date().toISOString() }, spec: s });
      if (ok === false) { notice('Échec de l\'enregistrement du scénario.'); return; }
      notice(`Scénario « ${s.title} » enregistré.`);
      this.close();
      if (a === 'play') this.app.nationUI.openPick(s.id, s);
      else if (this.onSaved) this.onSaved();
    }
  }
}
