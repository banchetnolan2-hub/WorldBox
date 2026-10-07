// UI — fenêtre « Créer / modifier un pays » partagée (CREATE WORLD et Contrôle total) :
// nom, capitale, couleur, drapeau/logo facultatif, puissance, population, statistiques.
import { $, show } from './util.js';
import { drawCustomFlag } from '../globe/flagAtlas.js';
import { MAP_PALETTE } from '../globe/mapColors.js';

const LAYOUTS = [['none', 'Aucun'], ['v3', 'Vertical ×3'], ['h3', 'Horizontal ×3'], ['h2', 'Horizontal ×2'], ['v2', 'Vertical ×2'], ['cross', 'Croix'], ['diag', 'Diagonale'], ['circle', 'Disque'], ['star', 'Étoile'], ['solid', 'Uni']];
const RANGES = [['ncPop', 'oNcPop', (v) => (v >= 10 ? Math.round(v) : v.toFixed(1).replace('.', ',')) + ' M'], ['ncPow', 'oNcPow', String], ['ncEco', 'oNcEco', String], ['ncRes', 'oNcRes', String], ['ncStab', 'oNcStab', String]];

export class CountryDialog {
  constructor() {
    this.layout = 'none';
    $('ncCancel').addEventListener('click', () => this.close());
    $('ncOk').addEventListener('click', () => this.confirm());
    ['ncC1', 'ncC2', 'ncC3', 'ncName', 'ncColor'].forEach((id) => $(id).addEventListener('input', () => this.drawPreview()));
    for (const id of ['ncName', 'ncCapital']) $(id).addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter') this.confirm(); });
    for (const [id, out, f] of RANGES) $(id).addEventListener('input', () => { $(out).textContent = f(Number($(id).value)); });
    $('ncName').addEventListener('input', () => {
      if (!this.capitalTouched) $('ncCapital').value = $('ncName').value.trim() ? `${$('ncName').value.trim()} City` : '';
    });
    $('ncCapital').addEventListener('input', () => { this.capitalTouched = true; });
  }

  // opts : { title, info, okLabel, color, onDone(spec) }
  open(opts = {}) {
    this.opts = opts;
    this.capitalTouched = false;
    $('ncTitle').textContent = opts.title || 'Créer un pays';
    $('ncInfo').textContent = opts.info || '';
    $('ncOk').textContent = opts.okLabel || 'Créer le pays';
    $('ncName').value = '';
    $('ncCapital').value = '';
    const color = opts.color || MAP_PALETTE[Math.floor(Math.random() * MAP_PALETTE.length)];
    $('ncColor').value = color;
    $('ncSwatches').innerHTML = MAP_PALETTE.map((c) => `<button style="--c:${c}" data-c="${c}" class="${c === color ? 'on' : ''}" title="${c}"></button>`).join('');
    $('ncSwatches').querySelectorAll('button').forEach((b) => b.addEventListener('click', () => {
      $('ncColor').value = b.dataset.c;
      $('ncSwatches').querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === b));
      this.drawPreview();
    }));
    const sel = $('ncCont');
    sel.innerHTML = ['Europe', 'Asie', 'Afrique', 'Amérique du Nord', 'Amérique du Sud', 'Océanie', 'Monde créé'].map((c) => `<option>${c}</option>`).join('');
    sel.value = opts.continent || 'Monde créé';
    this.layout = 'none';
    const layout = $('ncLayout');
    layout.innerHTML = LAYOUTS.map(([v, l]) => `<button data-v="${v}" class="${v === this.layout ? 'on' : ''}">${l}</button>`).join('');
    layout.querySelectorAll('button').forEach((b) => b.addEventListener('click', () => {
      this.layout = b.dataset.v;
      layout.querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === b));
      this.drawPreview();
    }));
    for (const [id] of RANGES) $(id).dispatchEvent(new Event('input'));
    show('newCountry');
    this.drawPreview();
    setTimeout(() => $('ncName').focus(), 40);
  }

  close() { show('newCountry', false); if (this.opts && this.opts.onCancel) this.opts.onCancel(); }

  flagSpec() {
    if (this.layout === 'none') return null;
    return { layout: this.layout, colors: [$('ncC1').value, $('ncC2').value, $('ncC3').value] };
  }

  drawPreview() {
    const c = $('ncPreview');
    const ctx = c.getContext('2d');
    const f = this.flagSpec();
    ctx.clearRect(0, 0, c.width, c.height);
    if (f) { drawCustomFlag(ctx, f, 0, 0, c.width, c.height); return; }
    // emblème simple : couleur du pays + initiale
    ctx.fillStyle = $('ncColor').value;
    ctx.fillRect(0, 0, c.width, c.height);
    ctx.fillStyle = 'rgba(255,255,255,0.92)';
    ctx.font = `600 ${Math.round(c.height * 0.5)}px Inter, system-ui, sans-serif`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(($('ncName').value.trim()[0] || '?').toUpperCase(), c.width / 2, c.height / 2 + 2);
  }

  confirm() {
    const name = $('ncName').value.trim() || 'Nouveau pays';
    const pow = Number($('ncPow').value), eco = Number($('ncEco').value), res = Number($('ncRes').value), stab = Number($('ncStab').value);
    const color = $('ncColor').value;
    const flag = this.flagSpec() || { layout: 'solid', colors: [color] };
    const spec = {
      name, color, flag, color2: $('ncC2').value,
      capitalName: $('ncCapital').value.trim() || `${name} City`,
      continent: $('ncCont').value,
      population: Math.round(Number($('ncPop').value) * 1e6),
      stats: { puissance: pow, economie: eco, ressources: res, stabilite: stab, mobilite: 55, defense: Math.round((pow + 50) / 2), expansion: 50, vitesse: 55 },
    };
    const cb = this.opts.onDone;
    this.opts.onCancel = null;
    show('newCountry', false);
    if (cb) cb(spec);
  }
}
