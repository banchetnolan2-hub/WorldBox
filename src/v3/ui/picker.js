// UI — sélecteur de pays (recherche, filtre par continent, sélection multiple)
import { $, show, flagImg, seg, esc } from './util.js';

const normalize = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const CONTS = ['Tous', 'Europe', 'Asie', 'Afrique', 'Amérique du Nord', 'Amérique du Sud', 'Océanie', 'Personnalisé'];

export class PickerDialog {
  constructor(app) {
    this.app = app;
    this.cont = 'Tous';
    this.sel = new Set();
    this.onDone = null;
    $('pickerSearch').addEventListener('input', () => this.render());
    $('pickerSearch').addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') this.done();
      if (e.key === 'Escape') this.close();
    });
    $('pickerCancel').addEventListener('click', () => this.close());
    $('pickerOk').addEventListener('click', () => this.done());
  }

  // opts : { title, multi, exclude:Set, onDone(list) }
  open(opts) {
    this.opts = { multi: true, exclude: new Set(), ...opts };
    this.sel = new Set();
    $('pickerTitle').textContent = this.opts.title || 'AJOUTER DES PAYS';
    $('pickerOk').textContent = this.opts.multi ? 'AJOUTER' : 'CHOISIR';
    $('pickerSearch').value = '';
    seg($('pickerCont'), CONTS.map((c) => ({ value: c, label: c === 'Amérique du Nord' ? 'Am. Nord' : c === 'Amérique du Sud' ? 'Am. Sud' : c })), this.cont, (v) => { this.cont = v; this.render(); });
    show('picker');
    this.render();
    setTimeout(() => $('pickerSearch').focus(), 30);
  }

  render() {
    const q = normalize($('pickerSearch').value.trim());
    const cells = this.app.cellCounts();
    const ents = this.app.entities().filter((e) => e.kind !== 'neutral' && !e.removed);
    const list = ents
      .filter((e) => this.cont === 'Tous' || (this.cont === 'Personnalisé' ? e.kind === 'custom' : e.continent === this.cont))
      .filter((e) => !q || normalize(e.name).includes(q) || (e.iso2 || '').toLowerCase() === q)
      .sort((a, b) => a.name.localeCompare(b.name, 'fr'));
    const grid = $('pickerGrid');
    grid.innerHTML = list.map((e) => {
      const dead = !cells[e.index];
      const used = this.opts.exclude.has(e.index);
      return `<button class="pick ${this.sel.has(e.index) ? 'sel' : ''} ${used ? 'used' : ''} ${dead ? 'dead' : ''}" data-e="${e.index}" ${dead ? 'title="Ce pays n\'a plus de territoire dans ce monde"' : ''}>
        ${flagImg(e)}<span>${esc(e.name)}</span>${dead ? '<small>disparu</small>' : ''}</button>`;
    }).join('') || '<p class="hint">Aucun pays trouvé.</p>';
    grid.querySelectorAll('.pick').forEach((b) => b.addEventListener('click', () => {
      const e = Number(b.dataset.e);
      if (!cells[e] && !this.opts.allowDead) return;
      if (!this.opts.multi) { this.sel = new Set([e]); this.done(); return; }
      if (this.sel.has(e)) this.sel.delete(e); else this.sel.add(e);
      b.classList.toggle('sel');
      $('pickerOk').textContent = this.sel.size ? `AJOUTER (${this.sel.size})` : 'AJOUTER';
    }));
  }

  done() {
    const list = [...this.sel];
    show('picker', false);
    if (this.opts.onDone && list.length) this.opts.onDone(list);
  }

  close() { show('picker', false); }
}
