// UI — sélecteur de pays avec recherche et drapeaux
import { allCountries } from '../countries/countries.js';
import { flagHtml } from '../countries/flagImages.js';

const normalize = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

export class CountryPicker {
  constructor(root, { onChange, getExcluded }) {
    this.root = root;
    this.onChange = onChange;
    this.getExcluded = getExcluded || (() => null);
    this.value = null;
    this.countries = allCountries();
    this.root.innerHTML = `
      <button class="picker-btn" type="button"><span class="flag-slot"></span><span class="name">—</span><span class="caret">▼</span></button>
      <div class="picker-pop hidden">
        <input type="text" placeholder="Rechercher un pays…" spellcheck="false">
        <ul class="picker-list"></ul>
      </div>`;
    this.btn = root.querySelector('.picker-btn');
    this.pop = root.querySelector('.picker-pop');
    this.input = root.querySelector('input');
    this.list = root.querySelector('.picker-list');
    this.active = 0;
    this.btn.addEventListener('click', (e) => { e.stopPropagation(); this.toggle(); });
    this.input.addEventListener('input', () => { this.active = 0; this.renderList(); });
    this.input.addEventListener('keydown', (e) => {
      const items = [...this.list.querySelectorAll('li:not(.disabled)')];
      if (e.key === 'ArrowDown') { this.active = Math.min(items.length - 1, this.active + 1); this.highlight(items); e.preventDefault(); }
      else if (e.key === 'ArrowUp') { this.active = Math.max(0, this.active - 1); this.highlight(items); e.preventDefault(); }
      else if (e.key === 'Enter') { if (items[this.active]) this.select(items[this.active].dataset.id); e.preventDefault(); }
      else if (e.key === 'Escape') { this.close(); e.preventDefault(); }
      e.stopPropagation();
    });
    this.pop.addEventListener('click', (e) => e.stopPropagation());
    document.addEventListener('click', () => this.close());
  }

  highlight(items) {
    items.forEach((li, k) => li.classList.toggle('active', k === this.active));
    if (items[this.active]) items[this.active].scrollIntoView({ block: 'nearest' });
  }

  toggle() { if (this.pop.classList.contains('hidden')) this.open(); else this.close(); }
  open() {
    document.dispatchEvent(new Event('click'));
    this.pop.classList.remove('hidden');
    this.input.value = '';
    this.active = 0;
    this.renderList();
    setTimeout(() => this.input.focus(), 0);
  }
  close() { this.pop.classList.add('hidden'); }
  isOpen() { return !this.pop.classList.contains('hidden'); }

  renderList() {
    const q = normalize(this.input.value.trim());
    const excluded = this.getExcluded();
    const items = this.countries.filter((c) => !q || normalize(c.name).includes(q) || c.iso2.toLowerCase() === q);
    this.list.innerHTML = items.map((c) => `
      <li data-id="${c.id}" class="${c.id === excluded ? 'disabled' : ''}">
        ${flagHtml(c)}<span>${c.name}</span><i class="dot" style="background:${c.color}"></i>
      </li>`).join('') || '<li class="disabled">Aucun pays trouvé</li>';
    this.list.querySelectorAll('li[data-id]').forEach((li) => {
      li.addEventListener('click', () => this.select(li.dataset.id));
    });
    this.highlight([...this.list.querySelectorAll('li:not(.disabled)')]);
  }

  select(id, silent = false) {
    const c = this.countries.find((x) => x.id === id);
    if (!c) return;
    this.value = c;
    this.btn.querySelector('.flag-slot').innerHTML = flagHtml(c);
    this.btn.querySelector('.name').textContent = c.name;
    this.btn.style.setProperty('--pc', c.color);
    this.close();
    if (!silent && this.onChange) this.onChange(c);
  }
}
