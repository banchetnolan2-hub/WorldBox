// UI — bibliothèque des mondes : liste, chargement, modification (CREATE WORLD), historique,
// import / export et sauvegarde au format .simworld (géométrie exacte, pays, capitales, équipes…).
import { $, show, esc, notice } from './util.js';
import { icon } from './icons.js';
import { Store } from '../save/store.js';
import { serializeWorld, deserializeWorld, createOriginalWorld } from '../world/worldState.js';

// identifiant d'un monde : 'original', 'w:<nom de fichier>' (worlds/*.simworld) ou 'monde-…' (ancien format)
const slug = (name) => (name || 'Monde').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-zA-Z0-9_ -]+/g, '').trim().replace(/\s+/g, '') || 'Monde';
export const isSavedWorld = (id) => !!id && (id.startsWith('w:') || id.startsWith('monde-'));
const refOf = (id) => (id.startsWith('w:') ? ['worlds', id.slice(2)] : ['mondes', id]);

export class WorldsUI {
  constructor(app) {
    this.app = app;
    $('worldsClose').addEventListener('click', () => show('worlds', false));
    $('worldImport').addEventListener('click', () => $('worldFile').click());
    $('worldFile').addEventListener('change', (e) => this.importFile(e.target.files[0]));
    $('worldCreate').addEventListener('click', () => { show('worlds', false); this.app.enterEditor(); });
    $('swCancel').addEventListener('click', () => show('saveWorldDialog', false));
    $('swOk').addEventListener('click', () => this.confirmSave());
    $('swName').addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter') this.confirmSave(); });
  }

  originalWorld() { return createOriginalWorld(this.app.earthGrid, this.app.countriesData); }

  async list() {
    const [a, b] = await Promise.all([Store.list('worlds'), Store.list('mondes')]);
    return [...a.map((x) => ({ ...x, id: 'w:' + x.id })), ...b.map((x) => ({ ...x, legacy: true }))];
  }

  async open() {
    show('worlds');
    show('worldHistory', false);
    const list = await this.list();
    const cur = this.app.world;
    const el = $('worldList');
    const item = (id, name, meta, kind, builtin) => `
      <li class="${cur.id === id ? 'cur' : ''}" data-id="${esc(id)}">
        <div class="slot-ic ${kind}">${icon(kind === 'custom' ? 'sparkles' : 'globe')}</div>
        <div class="slot-main"><div class="slot-name">${esc(name)}</div><div class="slot-meta">${esc(meta)}</div></div>
        <div class="slot-actions">
          <button class="btn ghost sm" data-act="load">${cur.id === id ? 'Actuel' : 'Charger'}</button>
          <button class="btn ghost sm icon" data-act="edit" title="Modifier dans CREATE WORLD">${icon('pencil')}</button>
          <button class="btn ghost sm icon" data-act="hist" title="Historique">${icon('history')}</button>
          ${builtin ? '' : `<button class="btn ghost sm icon" data-act="export" title="Exporter (.simworld)">${icon('download')}</button><button class="btn ghost sm icon danger" data-act="del" title="Supprimer">${icon('trash-2')}</button>`}
        </div>
      </li>`;
    let html = item('original', 'Monde original', 'La Terre · 196 pays · frontières de départ', 'earth', true);
    for (const w of list) {
      const m = w.meta || {};
      const date = m.updatedAt ? new Date(m.updatedAt).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' }) : '';
      const kind = m.kind === 'custom' ? 'custom' : 'earth';
      html += item(w.id, m.name || w.id, `${kind === 'custom' ? 'Monde créé' : 'Terre'} · année ${m.year || 1}${m.countries ? ` · ${m.countries} pays` : ''} · ${date}${w.legacy ? ' · ancien format' : ''}`, kind, false);
    }
    el.innerHTML = html;
    el.querySelectorAll('li[data-id]').forEach((li) => {
      const id = li.dataset.id;
      li.querySelector('[data-act=load]').onclick = () => this.load(id);
      li.querySelector('[data-act=edit]').onclick = async () => {
        try { const w = await this.readWorld(id); show('worlds', false); this.app.enterEditor({ world: w }); } catch (e) { notice('Impossible d\'ouvrir ce monde : ' + e.message, 4000); }
      };
      li.querySelector('[data-act=hist]').onclick = () => this.history(id);
      const ex = li.querySelector('[data-act=export]');
      if (ex) ex.onclick = () => this.exportWorld(id);
      const del = li.querySelector('[data-act=del]');
      if (del) del.onclick = async () => {
        if (!confirm('Supprimer définitivement ce monde ?')) return;
        const [cat, key] = refOf(id);
        await Store.remove(cat, key);
        if (this.app.world.id === id) await this.load('original', true);
        this.open();
      };
    });
  }

  async readWorld(id) {
    if (id === 'original') return this.originalWorld();
    const [cat, key] = refOf(id);
    const data = await Store.read(cat, key);
    if (!data) throw new Error('Monde introuvable');
    const w = await deserializeWorld(data, this.app, this.app.countriesData);
    w.id = id;
    return w;
  }

  async load(id, silent = false) {
    try {
      const w = await this.readWorld(id);
      this.app.setWorld(w);
      if (!silent) { notice(`Monde chargé : ${w.name}`); show('worlds', false); }
      return w;
    } catch (e) { notice('Impossible de charger ce monde : ' + e.message, 4000); return null; }
  }

  async history(id) {
    const w = id === this.app.world.id ? this.app.world : await this.readWorld(id);
    const el = $('worldHistory');
    el.innerHTML = `<h3>Historique — ${esc(w.name)}</h3>` + [...(w.history || [])].reverse().map((h) => `
      <div class="hist-item"><b>Année ${h.year}</b><div><strong>${esc(h.title)}</strong><p>${esc(h.text)}</p></div></div>`).join('');
    show('worldHistory');
  }

  async exportWorld(id) {
    const [cat, key] = refOf(id);
    const data = await Store.read(cat, key);
    if (!data) return;
    const blob = new Blob([JSON.stringify(data)], { type: 'application/octet-stream' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${slug(data.name)}.simworld`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }

  async importFile(file) {
    if (!file) return;
    try {
      const data = JSON.parse(await file.text());
      const w = await deserializeWorld(data, this.app, this.app.countriesData);
      const key = await this.freeKey(slug(w.name));
      await this.writeWorld(w, key);
      notice('Monde importé : ' + w.name);
      this.open();
    } catch (e) { notice('Fichier invalide : ' + e.message, 4000); }
    $('worldFile').value = '';
  }

  async freeKey(base) {
    const names = new Set((await Store.list('worlds')).map((x) => x.id));
    if (!names.has(base)) return base;
    for (let k = 2; ; k++) if (!names.has(`${base}${k}`)) return `${base}${k}`;
  }

  async writeWorld(w, key) {
    const data = await serializeWorld(w);
    let n = 0;
    const counts = new Set();
    for (let i = 0; i < w.owner.length; i++) if (w.owner[i] !== 65535) counts.add(w.owner[i]);
    for (const e of counts) if (w.entities[e] && w.entities[e].kind !== 'neutral') n++;
    data.meta = { name: w.name, year: w.year, updatedAt: new Date().toISOString(), kind: w.terrain ? 'custom' : 'earth', countries: n };
    const ok = await Store.write('worlds', key, data);
    return ok !== false;
  }

  // ---- sauvegarder un monde (après une simulation, depuis le Contrôle total ou CREATE WORLD) ----
  openSave(worldToSave, info, onSaved = null) {
    this.pending = worldToSave;
    this.onSaved = onSaved;
    const canOverwrite = isSavedWorld(worldToSave.id) || isSavedWorld(this.app.world.id);
    $('swInfo').textContent = info || 'Les frontières exactes (parcelle par parcelle), les pays, les équipes, les statistiques et l\'historique seront enregistrés.';
    $('swName').value = worldToSave.name && worldToSave.name !== 'Nouveau monde' ? worldToSave.name : `Monde ${String(Date.now()).slice(-4)}`;
    $('swOverwrite').checked = canOverwrite;
    $('swOverwrite').disabled = !canOverwrite;
    show('saveWorldDialog');
    setTimeout(() => $('swName').select(), 30);
  }

  async confirmSave() {
    const w = this.pending;
    if (!w) return;
    const name = $('swName').value.trim() || 'Monde sans nom';
    const prevId = isSavedWorld(w.id) ? w.id : isSavedWorld(this.app.world.id) ? this.app.world.id : null;
    const overwrite = $('swOverwrite').checked && prevId && prevId.startsWith('w:');
    const key = overwrite ? prevId.slice(2) : await this.freeKey(slug(name));
    w.name = name;
    w.readonly = false;
    w.unsaved = false;
    $('swOk').disabled = true;
    const ok = await this.writeWorld(w, key);
    $('swOk').disabled = false;
    show('saveWorldDialog', false);
    if (!ok) { notice('Échec de la sauvegarde du monde', 4000); return; }
    w.id = 'w:' + key;
    this.app.setWorld(w, true);
    notice(`Monde enregistré : ${name}.simworld (année ${w.year})`, 3200);
    if (this.onSaved) { const cb = this.onSaved; this.onSaved = null; cb(w); }
  }
}
