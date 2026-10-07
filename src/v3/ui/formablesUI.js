// UI — NATIONS FORMABLES : onglet (nations accessibles à votre pays, progression, conquête / vote / union d'alliés,
// aperçu du vote), écran de PROCLAMATION, et ÉDITEUR de nations formables (enregistrées pour vos parties et
// ajoutables à la partie en cours). Les actions passent par des ordres (multijoueur).
import { $, show, isShown, esc, notice } from './util.js';
import { icon } from './icons.js';
import { Store } from '../save/store.js';
import { allFormables, membersOf, conquestProgress, canForm, isFormed, formedBy, METHODS, normalizeFormable } from '../sim/formables.js';
import { drawCustomFlag, customFlagDataUrl } from '../globe/flagAtlas.js';

const PREFIX = 'formable-';
const LAYOUTS = [['h3', 'Horizontal ×3'], ['v3', 'Vertical ×3'], ['h2', 'Horizontal ×2'], ['v2', 'Vertical ×2'], ['cross', 'Croix'], ['diag', 'Diagonale'], ['circle', 'Disque'], ['star', 'Étoile'], ['solid', 'Uni']];
const flagHtml = (f, cls = 'fm-flag') => `<img class="${cls}" src="${customFlagDataUrl(f.flag, 64, 42)}" alt="">`;

export class FormablesUI {
  constructor(app) {
    this.app = app;
    this.custom = [];
    const add = (html) => { const t = document.createElement('template'); t.innerHTML = html.trim(); document.body.appendChild(t.content.firstChild); };
    add('<section id="proclaimDialog" class="overlay hidden"><div class="dialog panel proclaim" id="proclaimBox"></div></section>');
    add('<section id="formEditor" class="overlay hidden"><div class="dialog wide panel fm-editor" id="formEdBox"></div></section>');
    $('formEditor').addEventListener('keydown', (e) => e.stopPropagation());
    this.load();
  }
  get sim() { return this.app.session.sim; }
  async load() {
    try {
      const out = [];
      for (const x of await Store.list('reglages')) if (x.id.startsWith(PREFIX)) { const d = await Store.read('reglages', x.id); const f = normalizeFormable(d); if (f) out.push(f); }
      this.custom = out;
    } catch (_) { this.custom = []; }
  }
  // nations personnalisées passées à une nouvelle partie
  setupList() { return this.custom.map((f) => ({ ...f })); }

  // ======================= onglet =======================
  html(sim, n) {
    const k = n.player, me = sim.entities[sim.sides[k].e];
    const done = formedBy(sim, k);
    const all = allFormables(sim);
    const mine = all.filter((f) => f.members.includes(me.id) || (done && done.id === f.id));
    const others = all.filter((f) => !mine.includes(f));
    const row = (f, full) => {
      const mem = membersOf(sim, f);
      const formed = (sim.formed || []).find((x) => x.id === f.id);
      const p = conquestProgress(sim, f, k);
      const btn = (method) => { const c = canForm(sim, f.id, k, method); return `<button class="btn ${c.ok ? 'primary' : 'ghost'} xs" data-form="${f.id}" data-method="${method}" ${c.ok || method !== 'conquest' ? '' : 'disabled'} title="${esc(c.ok ? '' : c.why || '')}">${icon(method === 'conquest' ? 'crown' : method === 'vote' ? 'vote' : 'merge')}<span>${method === 'conquest' ? 'Proclamer' : method === 'vote' ? 'Proposer un vote' : 'Union d\'alliés'}</span></button>`; };
      return `<div class="fm-row ${formed ? 'formed' : ''}">${flagHtml(f)}<div class="fm-main"><b>${esc(f.name)}</b>${f.custom ? '<span class="pill">personnalisée</span>' : ''}
        <small>${mem.map((x) => `<span class="${sim.sides[x.k].eliminated ? 'dim' : ''}">${esc(sim.sides[x.k].name)}</span>`).join(', ') || 'membres absents de cette carte'}</small>
        ${formed ? `<small class="up">Proclamée par ${esc(formed.orig ? formed.orig.name : '?')} (${esc(METHODS[formed.method] || '')})</small>` : full ? `<div class="fm-prog"><span>Territoire contrôlé</span><div class="meter"><i style="width:${Math.round(p.share * 100)}%"></i><em style="left:${Math.round(f.need * 100)}%"></em></div><b>${Math.round(p.share * 100)} % / ${Math.round(f.need * 100)} %</b><span class="${p.capital ? 'up' : 'down'}">${icon(p.capital ? 'check' : 'x')} capitale</span></div>
        <div class="row">${f.methods.map(btn).join('')}</div>` : ''}</div></div>`;
    };
    return `<p class="hint">Une nation peut naître par la conquête (territoire des pays membres et capitale désignée), par le vote des États membres (les deux tiers des États et plus de la moitié de la population), ou par l'union d'alliés. Les pays qui votent oui la rejoignent ; les autres restent indépendants. L'IA forme aussi des nations.</p>
      ${done ? `<div class="db-alert ok">${icon('crown')}<span>Votre pays a proclamé <b>${esc(done.name)}</b>.</span></div>` : ''}
      <h4>Nations accessibles à votre pays</h4>${mine.length ? mine.map((f) => row(f, !done)).join('') : '<p class="hint">Aucune nation formable ne comprend votre pays. Créez la vôtre avec l\'éditeur.</p>'}
      <div class="row"><button class="btn ghost sm" data-formed>${icon('pencil')}<span>Éditeur de nations formables</span></button></div>
      <h4>Autres nations formables du monde</h4>${others.map((f) => row(f, false)).join('')}`;
  }
  bind(body) {
    const sim = this.sim, n = sim.nv;
    body.querySelectorAll('[data-form]').forEach((b) => b.addEventListener('click', () => this._act(b.dataset.form, b.dataset.method)));
    const ed = body.querySelector('[data-formed]'); if (ed) ed.onclick = () => this.openEditor();
    void n;
  }
  _act(id, method) {
    const sim = this.sim, n = sim.nv, k = n.player;
    const f = allFormables(sim).find((x) => x.id === id);
    const c = canForm(sim, id, k, method);
    if (!c.ok) { notice(c.why, 4200); return; }
    if (method !== 'conquest') {
      const t = n.previewVote(id, method);
      const list = t.votes.map((v) => `${v.name} : ${v.human ? 'vote du joueur' : v.yes ? 'OUI' : 'non'}`).join('\n');
      if (!window.confirm(`${METHODS[method]} pour former ${f.name}.\n\nPositions estimées :\n${list}\n\n${t.passed ? 'Le vote devrait être adopté.' : 'Le vote risque d\'échouer.'} Continuer ?`)) return;
    } else if (!window.confirm(`Proclamer ${f.name} ? Votre pays prend le nom, la couleur et le drapeau de cette nation.`)) return;
    const r = n.formNationP(id, method);
    if (r && r.ok === false) notice(r.text, 5000);
    else if (r && r.pending) notice(r.text, 4000);
    setTimeout(() => this.app.nationUI._renderTab(true), 50);
  }

  // ======================= proclamation =======================
  onEvent(e) {
    if (!e.proclamation) return;
    const sim = this.sim;
    if (!sim) return;
    const rec = (sim.formed || []).find((x) => x.id === e.formable);
    if (!rec) return;
    const mine = sim.nv && rec.side === sim.nv.player;
    // l'identité change : couleurs et noms sur la carte
    this.app.refreshParams(); if (this.app.labels) this.app.labels.clear();
    if (!mine && !(sim.nv && rec.joined.includes(sim.nv.player)) && this.app.settings.notifLevel === 'critical') return;
    const f = allFormables(sim).find((x) => x.id === rec.id) || rec;
    $('proclaimBox').innerHTML = `<div class="pc-flag"><canvas id="pcFlag" width="300" height="200"></canvas></div>
      <small class="eyebrow">Proclamation</small><h2>${esc(rec.name)}</h2>
      <p>${esc(rec.orig ? rec.orig.name : '')} proclame ${esc(rec.name)}${rec.joined.length ? `, rejoint par ${esc(rec.joined.map((k) => sim.sides[k].name).join(', '))}` : ''}.</p>
      <p class="hint">${esc(f.desc || 'Une nouvelle page de l\'histoire s\'ouvre.')} Formation : ${esc(METHODS[rec.method] || '')}.</p>
      <div class="dialog-foot"><span class="grow"></span><button class="btn primary" id="pcOk">${mine ? 'Vive la nation !' : 'Continuer'}</button></div>`;
    drawCustomFlag($('pcFlag').getContext('2d'), rec.flag, 0, 0, 300, 200);
    show('proclaimDialog');
    if (this.app.wantsAutoPause('formable')) this.app.pauseForOverlay();
    $('pcOk').onclick = () => { show('proclaimDialog', false); this.app.resumeAfterOverlay(); };
  }
  isOpen() { return isShown('proclaimDialog') || isShown('formEditor'); }
  closeAll() { show('proclaimDialog', false); show('formEditor', false); this.app.resumeAfterOverlay(); }

  // ======================= éditeur =======================
  openEditor(base = null) {
    this.ed = base ? { ...base } : { name: '', color: '#8a6bd1', flag: { layout: 'h3', colors: ['#8a6bd1', '#ffffff', '#2a2a2a'] }, members: [], capital: '', need: 0.75, methods: ['conquest', 'vote', 'union'], desc: '' };
    this.edQuery = '';
    this._renderEditor();
    show('formEditor');
    this.app.pauseForOverlay();
  }
  _renderEditor() {
    const d = this.ed, ents = this.app.entities().filter((e) => e && e.kind !== 'neutral' && !e.runtime);
    const q = this.edQuery.toLowerCase();
    const list = ents.filter((e) => !q || e.name.toLowerCase().includes(q) || (e.id || '').toLowerCase() === q).slice(0, 60);
    $('formEdBox').innerHTML = `<small class="eyebrow">Éditeur</small><h2>Nation formable</h2>
      <div class="fm-ed">
        <div>
          <div class="field"><label><span>Nom</span></label><input type="text" data-fe="name" maxlength="40" value="${esc(d.name)}" placeholder="Union des…"></div>
          <div class="field"><label><span>Description</span></label><input type="text" data-fe="desc" maxlength="200" value="${esc(d.desc)}"></div>
          <div class="field"><label><span>Couleur et drapeau</span></label><div class="row"><input type="color" data-fe="color" value="${d.color}"><select data-fe="layout">${LAYOUTS.map(([v, l]) => `<option value="${v}" ${d.flag.layout === v ? 'selected' : ''}>${l}</option>`).join('')}</select>${d.flag.colors.map((c, i) => `<input type="color" data-fc="${i}" value="${c}">`).join('')}<img class="fm-flag big" src="${customFlagDataUrl(d.flag, 96, 64)}" alt=""></div></div>
          <div class="field"><label><span>Territoire requis (conquête)</span><output>${Math.round(d.need * 100)} %</output></label><input type="range" min="0.4" max="1" step="0.05" value="${d.need}" data-fe="need"></div>
          <div class="field"><label><span>Méthodes de formation</span></label>${Object.entries(METHODS).map(([k, l]) => `<label class="check"><input type="checkbox" data-fm="${k}" ${d.methods.includes(k) ? 'checked' : ''}><span>${l}</span></label>`).join('')}</div>
          <div class="field"><label><span>Capitale (pays membre)</span></label><select data-fe="capital">${d.members.map((id) => { const e = ents.find((x) => x.id === id); return `<option value="${id}" ${d.capital === id ? 'selected' : ''}>${esc(e ? e.name : id)}</option>`; }).join('') || '<option value="">Ajoutez des membres</option>'}</select></div>
        </div>
        <div>
          <div class="field"><label><span>Pays membres (${d.members.length})</span></label><div class="fm-members">${d.members.map((id) => { const e = ents.find((x) => x.id === id); return `<span class="pill" data-rm="${id}">${esc(e ? e.name : id)} ${icon('x')}</span>`; }).join('') || '<span class="hint">Au moins deux pays.</span>'}</div></div>
          <div class="search">${icon('search')}<input type="text" data-fe="q" placeholder="Ajouter un pays…" value="${esc(this.edQuery)}" spellcheck="false"></div>
          <div class="fm-list">${list.map((e) => `<button class="fm-pick ${d.members.includes(e.id) ? 'on' : ''}" data-add="${e.id}">${esc(e.name)}</button>`).join('')}</div>
        </div>
      </div>
      <div class="fm-saved">${this.custom.length ? `<b>Vos nations :</b> ${this.custom.map((f) => `<span class="pill" data-edit="${esc(f.id)}">${esc(f.name)}</span>`).join(' ')}` : ''}</div>
      <div class="dialog-foot"><button class="btn ghost sm" data-fa="del" ${d.id ? '' : 'disabled'}>${icon('trash-2')}<span>Supprimer</span></button><span class="grow"></span><button class="btn ghost" data-fa="close">Fermer</button>
        ${this.sim && this.sim.nv ? '<button class="btn ghost" data-fa="game">Ajouter à cette partie</button>' : ''}<button class="btn primary" data-fa="save">Enregistrer</button></div>`;
    const box = $('formEdBox');
    const val = (k, v) => { this.ed[k] = v; };
    box.querySelector('[data-fe=name]').onchange = (e) => val('name', e.target.value.trim());
    box.querySelector('[data-fe=desc]').onchange = (e) => val('desc', e.target.value.trim());
    box.querySelector('[data-fe=color]').onchange = (e) => { d.color = e.target.value; d.flag.colors[0] = d.color; this._renderEditor(); };
    box.querySelector('[data-fe=layout]').onchange = (e) => { d.flag.layout = e.target.value; this._renderEditor(); };
    box.querySelectorAll('[data-fc]').forEach((i) => { i.onchange = () => { d.flag.colors[Number(i.dataset.fc)] = i.value; this._renderEditor(); }; });
    box.querySelector('[data-fe=need]').onchange = (e) => { d.need = Number(e.target.value); this._renderEditor(); };
    box.querySelector('[data-fe=capital]').onchange = (e) => val('capital', e.target.value);
    box.querySelectorAll('[data-fm]').forEach((c) => { c.onchange = () => { d.methods = Object.keys(METHODS).filter((k) => box.querySelector(`[data-fm=${k}]`).checked); }; });
    const qi = box.querySelector('[data-fe=q]');
    qi.oninput = () => { this.edQuery = qi.value; const pos = qi.selectionStart; this._renderEditor(); const nq = $('formEdBox').querySelector('[data-fe=q]'); nq.focus(); nq.setSelectionRange(pos, pos); };
    box.querySelectorAll('[data-add]').forEach((b) => { b.onclick = () => { const id = b.dataset.add; d.members = d.members.includes(id) ? d.members.filter((x) => x !== id) : [...d.members, id]; if (!d.capital || !d.members.includes(d.capital)) d.capital = d.members[0] || ''; this._renderEditor(); }; });
    box.querySelectorAll('[data-rm]').forEach((b) => { b.onclick = () => { d.members = d.members.filter((x) => x !== b.dataset.rm); if (!d.members.includes(d.capital)) d.capital = d.members[0] || ''; this._renderEditor(); }; });
    box.querySelectorAll('[data-edit]').forEach((b) => { b.onclick = () => { const f = this.custom.find((x) => x.id === b.dataset.edit); if (f) { this.ed = JSON.parse(JSON.stringify(f)); this._renderEditor(); } }; });
    box.querySelector('[data-fa=close]').onclick = () => { show('formEditor', false); this.app.resumeAfterOverlay(); };
    box.querySelector('[data-fa=save]').onclick = () => this._save(false);
    const g = box.querySelector('[data-fa=game]'); if (g) g.onclick = () => this._save(true);
    box.querySelector('[data-fa=del]').onclick = async () => { if (!d.id || !window.confirm(`Supprimer « ${d.name} » ?`)) return; await Store.remove('reglages', d.id.startsWith(PREFIX) ? d.id : PREFIX + d.id); await this.load(); this.openEditor(); };
  }
  async _save(toGame) {
    const d = this.ed;
    if (!d.name) { notice('Donnez un nom à la nation.'); return; }
    if (d.members.length < 2) { notice('Choisissez au moins deux pays membres.'); return; }
    const slug = d.name.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 30);
    const f = normalizeFormable({ ...d, id: d.id || `custom-${slug}` });
    await Store.write('reglages', PREFIX + slug, { ...f, meta: { name: f.name, updatedAt: new Date().toISOString() } });
    await this.load();
    if (toGame && this.sim && this.sim.nv) { this.app.act({ op: 'formable', f }); notice(`${f.name} ajoutée à cette partie et enregistrée pour vos prochaines parties.`); }
    else notice(`${f.name} enregistrée : elle sera disponible dans vos prochaines parties.`);
    this.ed = { ...f }; this._renderEditor();
  }
}
