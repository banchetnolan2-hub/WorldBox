// UI — CREATE WORLD : éditeur de monde complet.
// Terrain (pinceau de terres, gomme, lissage, relèvement, creusement, déplacement de masses),
// pays (créer un pays ici, peindre / retirer un territoire, capitales, propriétés), sauvegarde exacte.
// La géométrie est un champ d'altitude continu (voir world/terrain.js) : côtes lisses à tous les zooms.
import { $, show, esc, notice, fmtInt, isShown } from './util.js';
import { icon } from './icons.js';
import { Terrain, TW, TH, GW, GH, SEA, NONE, buildGridFromTerrain, rasterFromOwner } from '../world/terrain.js';
import { Navigator } from '../world/navigation.js';
import { EARTH_R } from '../world/worldGrid.js';
import { MAP_PALETTE } from '../globe/mapColors.js';
import { renderProfileEditor } from './profileEditor.js';
import { geoFor, BIOME_NAMES, BIOME_COLORS, computeGeo } from '../sim/geo.js';
import { emptyChronicle } from '../world/worldState.js';

const DEG = Math.PI / 180;
const TERRAIN_TOOLS = new Set(['land', 'erase', 'smooth', 'raise', 'lower', 'move', 'naturalize']);
const PAINT_TOOLS = new Set(['paint', 'unclaim']);
const ACTION_TOOLS = new Set(['autob', 'natb']);
const TOOLS = [
  ['terrain', 'land', 'brush', 'Terre', 'Dessiner de nouvelles terres (B)'],
  ['terrain', 'erase', 'eraser', 'Gomme', 'Supprimer des terres, créer de l\'océan (E)'],
  ['terrain', 'smooth', 'waves', 'Lisser', 'Lisser les côtes et le relief (S)'],
  ['terrain', 'raise', 'mountain', 'Relever', 'Agrandir / surélever une zone : collines, montagnes (R)'],
  ['terrain', 'lower', 'shovel', 'Creuser', 'Abaisser / creuser, créer des mers intérieures (L)'],
  ['terrain', 'move', 'move', 'Déplacer', 'Déplacer une masse terrestre entière (M) — la poser sur une autre la fusionne'],
  ['terrain', 'naturalize', 'wand-sparkles', 'Naturaliser', 'NATURALIZE : rendre naturelle une forme dessinée — côtes découpées, baies, péninsules, îlots, relief, vallées (N)'],
  ['terrain', 'biome', 'trees', 'Biomes', 'Peindre forêts, déserts, plaines, collines, montagnes, toundra (G)'],
  ['pays', 'select', 'mouse-pointer-2', 'Sélection', 'Choisir un pays (V)'],
  ['pays', 'create', 'plus-circle', 'Créer un pays ici', 'Cliquer une zone de terre : le pays prend automatiquement ce territoire (C)'],
  ['pays', 'capital', 'landmark', 'Capitale', 'Placer ou déplacer la capitale du pays sélectionné (K)'],
  ['frontieres', 'autob', 'split', 'Auto border', 'AUTO BORDER : frontières plausibles générées automatiquement à partir des capitales (A)'],
  ['frontieres', 'natb', 'route', 'Natural border', 'NATURAL BORDER : frontières qui suivent le relief, les rivières et les crêtes (F)'],
  ['frontieres', 'paint', 'paintbrush', 'Manual border', 'MANUAL BORDER : peindre le territoire du pays sélectionné (P)'],
  ['frontieres', 'unclaim', 'square-dashed', 'Retirer', 'Rendre une zone neutre (sans pays) (X)'],
];
const KEYS = { b: 'land', e: 'erase', s: 'smooth', r: 'raise', l: 'lower', m: 'move', n: 'naturalize', g: 'biome', v: 'select', c: 'create', p: 'paint', x: 'unclaim', k: 'capital', a: 'autob', f: 'natb' };
const STAT_FIELDS = [['puissance', 'Puissance'], ['economie', 'Économie'], ['ressources', 'Ressources'], ['stabilite', 'Stabilité'], ['defense', 'Défense'], ['mobilite', 'Mobilité'], ['vitesse', 'Vitesse'], ['expansion', 'Expansion']];

// bruit de valeur 2D (irrégularité naturelle des côtes dessinées)
function hash2(x, y) { let h = Math.imul(x, 374761393) + Math.imul(y, 668265263); h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967296; }
function vnoise(x, y) {
  const xi = Math.floor(x), yi = Math.floor(y), fx = x - xi, fy = y - yi;
  const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
  const a = hash2(xi, yi), b = hash2(xi + 1, yi), c = hash2(xi, yi + 1), d = hash2(xi + 1, yi + 1);
  return a + (b - a) * sx + (c - a + (a - b + d - c) * sx) * sy;
}
const organic = (x, y) => vnoise(x / 7, y / 7) * 0.65 + vnoise(x / 2.5 + 31, y / 2.5) * 0.35;

function dirOf(lat, lon) { const p = lat * DEG, l = lon * DEG; return [Math.cos(p) * Math.sin(l), Math.sin(p), Math.cos(p) * Math.cos(l)]; }
function latLonOf(v) { return [Math.asin(Math.max(-1, Math.min(1, v[1]))) / DEG, Math.atan2(v[0], v[2]) / DEG]; }
// rotation qui amène le vecteur a sur b (formule de Rodrigues)
function rotationBetween(a, b) {
  const c = [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const s = Math.hypot(...c), d = a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  if (s < 1e-9) return [1, 0, 0, 0, 1, 0, 0, 0, 1];
  const k = [c[0] / s, c[1] / s, c[2] / s];
  const K = [0, -k[2], k[1], k[2], 0, -k[0], -k[1], k[0], 0];
  const K2 = mul3(K, K);
  return [0, 1, 2, 3, 4, 5, 6, 7, 8].map((i) => (i % 4 === 0 ? 1 : 0) + s * K[i] + (1 - d) * K2[i]);
}
function mul3(A, B) { const R = new Array(9); for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) R[i * 3 + j] = A[i * 3] * B[j] + A[i * 3 + 1] * B[3 + j] + A[i * 3 + 2] * B[6 + j]; return R; }
const apply3 = (M, v) => [M[0] * v[0] + M[1] * v[1] + M[2] * v[2], M[3] * v[0] + M[4] * v[1] + M[5] * v[2], M[6] * v[0] + M[7] * v[1] + M[8] * v[2]];
const transpose3 = (M) => [M[0], M[3], M[6], M[1], M[4], M[7], M[2], M[5], M[8]];

export class WorldEditor {
  constructor(app) {
    this.app = app;
    this.active = false;
    this.tool = 'land';
    this.radiusKm = 260;
    this.strength = 0.6;
    this.selected = -1;
    this.undo = []; this.redo = [];
    this._buildUI();
  }

  // ---------------------------------------------------------------- interface
  _buildUI() {
    const rail = $('edTools');
    let group = '';
    rail.innerHTML = TOOLS.map(([g, id, ic, label, tip]) => {
      const head = g !== group ? `<div class="rail-group">${g === 'terrain' ? 'Terrain' : g === 'pays' ? 'Pays' : 'Frontières'}</div>` : '';
      group = g;
      return `${head}<button class="rail-btn" data-tool="${id}" data-tip="${esc(tip)}">${icon(ic)}<span>${label}</span></button>`;
    }).join('');
    rail.querySelectorAll('[data-tool]').forEach((b) => b.addEventListener('click', () => this.setTool(b.dataset.tool)));
    $('edRadius').addEventListener('input', () => { this.radiusKm = Number($('edRadius').value); $('oEdRadius').textContent = fmtInt(this.radiusKm) + ' km'; this._updateCursor(); });
    $('edStrength').addEventListener('input', () => { this.strength = Number($('edStrength').value); $('oEdStrength').textContent = Math.round(this.strength * 100) + ' %'; });
    $('edUndo').addEventListener('click', () => this.doUndo());
    $('edRedo').addEventListener('click', () => this.doRedo());
    $('edSave').addEventListener('click', () => this.save());
    $('edSimulate').addEventListener('click', () => this.simulate());
    $('edExit').addEventListener('click', () => this.app.exitEditor());
    $('edNewCountry').addEventListener('click', () => { this.setTool('create'); notice('Cliquez sur une zone de terre pour y créer le pays.', 3000); });
    $('edSearch').addEventListener('input', () => this.renderList());
    $('edSearch').addEventListener('keydown', (e) => e.stopPropagation());
    $('edName').addEventListener('keydown', (e) => e.stopPropagation());
    $('edName').addEventListener('change', () => { this.w.name = $('edName').value.trim() || 'Monde sans nom'; });
    document.querySelectorAll('#edStart [data-start]').forEach((b) => b.addEventListener('click', () => this.startFrom(b.dataset.start)));
    $('edStartCancel').addEventListener('click', () => { show('edStart', false); if (!this.w) this.app.exitEditor(); });
    $('edNewBtn').addEventListener('click', () => show('edStart'));
  }

  setTool(t) {
    this.tool = t;
    document.querySelectorAll('#edTools [data-tool]').forEach((b) => b.classList.toggle('on', b.dataset.tool === t));
    const brush = TERRAIN_TOOLS.has(t) && t !== 'move' || PAINT_TOOLS.has(t) || t === 'biome';
    $('edBrushOpts').classList.toggle('dim', !brush && !ACTION_TOOLS.has(t));
    $('edStrengthRow').classList.toggle('hidden', !TERRAIN_TOOLS.has(t) || t === 'move');
    this._renderActions(t);
    const hints = {
      land: 'Glissez pour dessiner des terres. Clic droit + glisser : tourner le globe.',
      erase: 'Glissez pour effacer des terres (océan).',
      smooth: 'Glissez sur les côtes pour les adoucir.',
      raise: 'Glissez pour élever le relief (collines, montagnes, agrandir une île).',
      lower: 'Glissez pour creuser (vallées, golfes, mers intérieures).',
      move: 'Glissez une masse terrestre pour la déplacer ; posée sur une autre, elle fusionne.',
      naturalize: 'Glissez sur une forme dessinée : les côtes deviennent irrégulières (baies, péninsules, îlots) et le relief naturel. Le résultat reste modifiable.',
      biome: 'Glissez pour peindre le biome choisi. « Auto » rend le biome calculé (climat, altitude, humidité).',
      autob: 'Partage les terres entre les pays qui ont une capitale : frontières irrégulières et plausibles.',
      natb: 'Frontières qui suivent les montagnes, les crêtes et les rivières (coût de franchissement du terrain).',
      select: 'Cliquez sur un pays pour le modifier.',
      create: 'Cliquez sur une zone de terre : un nouveau pays y est créé avec ce territoire.',
      paint: this.selected >= 0 ? 'Glissez pour agrandir le territoire du pays sélectionné.' : 'Sélectionnez d\'abord un pays.',
      unclaim: 'Glissez pour rendre des terres neutres.',
      capital: this.selected >= 0 ? 'Cliquez pour placer la capitale du pays sélectionné.' : 'Sélectionnez d\'abord un pays.',
    };
    $('edHint').textContent = hints[t] || '';
    this.app.canvas.classList.toggle('paint', t !== 'select');
    this._updateCursor();
  }

  isEditing() { return this.active; }

  // actions et options propres à l'outil
  _renderActions(t) {
    const el = $('edActions');
    if (!el) return;
    let h = '';
    if (t === 'naturalize') h = `<button class="btn ghost sm" data-act="natall">${icon('wand-sparkles')}<span>Naturaliser tout le monde</span></button><button class="btn ghost sm" data-act="valleys">${icon('waves')}<span>Creuser les vallées des rivières</span></button>`;
    else if (t === 'biome') {
      if (this.biome === undefined) this.biome = 1;
      h = `<div class="bio-grid">${[['-1', 'Auto', '#3b4252'], ...BIOME_NAMES.map((n, k) => [String(k), n, BIOME_COLORS[k]])].map(([v, n, c]) => `<button data-bio="${v}" class="${String(this.biome) === v ? 'on' : ''}"><i style="background:${c}"></i>${n}</button>`).join('')}</div>`;
    } else if (t === 'autob' || t === 'natb') {
      h = `<button class="btn primary sm" data-act="${t}:free">${icon('split')}<span>Terres sans pays</span></button>
        <button class="btn ghost sm" data-act="${t}:all">${icon('layers')}<span>Redessiner toutes les frontières</span></button>
        ${t === 'natb' ? `<button class="btn ghost sm" data-act="natb:refine">${icon('route')}<span>Ajuster les frontières existantes au relief</span></button>` : ''}
        <small class="hint">Seuls les pays qui ont une capitale reçoivent des terres. Annulable (Ctrl+Z).</small>`;
    }
    el.innerHTML = h;
    el.querySelectorAll('[data-bio]').forEach((b) => b.addEventListener('click', () => { this.biome = Number(b.dataset.bio); this._renderActions(t); }));
    el.querySelectorAll('[data-act]').forEach((b) => b.addEventListener('click', () => {
      const [a, scope] = b.dataset.act.split(':');
      if (a === 'natall') this.naturalizeAll();
      else if (a === 'valleys') this.carveValleys();
      else this.borders(a === 'autob' ? 'auto' : 'natural', scope);
    }));
  }

  // ---------------------------------------------------------------- ouverture
  // opts : { world } (monde à modifier) ou rien (écran de départ)
  enter(opts = {}) {
    this.active = true;
    this.undo = []; this.redo = [];
    show('editor');
    document.body.classList.add('editor-on');
    $('edRadius').value = this.radiusKm; $('edRadius').dispatchEvent(new Event('input'));
    $('edStrength').value = this.strength; $('edStrength').dispatchEvent(new Event('input'));
    this.setTool('select');
    if (opts.world) this.loadWorld(opts.world);
    else { this.w = null; show('edStart'); }
  }

  exit() {
    this.active = false;
    show('editor', false); show('edStart', false);
    document.body.classList.remove('editor-on');
    this.app.canvas.classList.remove('paint');
    this.app.renderer.setBrush(null);
  }

  startFrom(kind) {
    const app = this.app;
    show('edStart', false);
    notice('Préparation du monde…', 1200);
    setTimeout(() => {
      if (kind === 'earth') {
        const base = app.world.terrain ? app.worldsUI.originalWorld() : app.world;
        this.loadWorld(base, true);
        this.w.name = 'Terre modifiée';
      } else {
        const terrain = kind === 'random' ? Terrain.random(Math.floor(Math.random() * 1e9)) : Terrain.ocean();
        this._install({
          id: null, name: kind === 'random' ? 'Nouveau monde' : 'Monde océan', year: 1,
          createdAt: new Date().toISOString(), terrain, raster: null, entities: [], teams: [], relations: {},
          history: [{ year: 1, title: 'Création du monde', text: 'Monde créé dans CREATE WORLD.', date: new Date().toISOString() }],
        });
        this.setTool(kind === 'random' ? 'create' : 'land');
      }
      $('edName').value = this.w.name;
    }, 30);
  }

  // monde existant -> copie de travail (terrain modifiable + raster des propriétaires)
  loadWorld(world, forceCopy = false) {
    const app = this.app;
    let terrain, raster;
    if (world.terrain) {
      terrain = world.terrain.clone();
      raster = rasterFromOwner(app.contextFor(world).grid, world.owner);
    } else {
      terrain = Terrain.fromRelief(app.earthCtx.relief);
      raster = rasterFromOwner(app.earthGrid, world.owner);
    }
    const saved = !forceCopy && world.id && (world.id.startsWith('w:') || world.id.startsWith('monde-'));
    this._install({
      id: saved ? world.id : null, name: world.name || 'Monde', year: world.year || 1, createdAt: world.createdAt,
      terrain, raster,
      entities: world.entities.map((e) => ({ ...e, stats: e.stats ? { ...e.stats } : null, capital: e.capital ? { ...e.capital } : null })),
      teams: JSON.parse(JSON.stringify(world.teams || [])), relations: { ...(world.relations || {}) },
      history: [...(world.history || [])], simSettings: world.simSettings || null,
      biomes: world.biomes ? Uint8Array.from(world.biomes) : null, biomesVersion: 1,
      chronicle: JSON.parse(JSON.stringify(world.chronicle || emptyChronicle())), dateDays: world.dateDays || 0,
    });
    for (const e of this.w.entities) if (e.profile) e.profile = JSON.parse(JSON.stringify(e.profile));
    $('edName').value = this.w.name;
  }

  _install(w) {
    this.w = w;
    this.selected = -1;
    this._rebuild(true);
    this.app.renderer.cam.flyTo(25, this.app.renderer.cam.lon, 2.6, 1.6);
    this.renderList();
    this.renderCountry();
  }

  // grille, navigation et propriétaires dérivés du terrain (après chaque modification du terrain)
  _rebuild(full = false) {
    const w = this.w, app = this.app;
    const t = w.terrain;
    t.quantize();
    t.version++;
    const { grid, owner } = buildGridFromTerrain(t, w.raster);
    // le raster suit les côtes : nouvelles terres neutres, terres englouties retirées
    if (!w.raster) w.raster = new Uint16Array(GW * GH).fill(SEA);
    for (let p = 0; p < GW * GH; p++) {
      if (grid.landAt[p]) { if (w.raster[p] === SEA) w.raster[p] = NONE; } else w.raster[p] = SEA;
    }
    t._ctx = { grid, nav: new Navigator(grid), relief: t, hires: null, earth: false, version: t.version };
    this.grid = grid;
    this.owner = owner;
    const view = this.viewWorld();
    app.setWorld(view, true);
    app.renderer.setWorldOwner(owner, null);
    app.cellCountsDirty = true;
    if (full) app.renderer.refreshRelief();
    this.renderList();
  }

  viewWorld() {
    const w = this.w;
    return { ...w, owner: this.owner, readonly: false, unsaved: true, editing: true };
  }

  // ---------------------------------------------------------------- saisie
  // appelé par l'application : retourne true si l'éditeur prend l'événement
  pointerDown(e, hit) {
    if (!this.w || e.button !== 0) return false;
    if (!hit) return true;
    const t = this.tool;
    if (TERRAIN_TOOLS.has(t)) {
      if (t === 'move') return this._moveStart(hit);
      this._strokeStart('terrain');
      this._terrainAt(hit.lat, hit.lon);
      this.last = [hit.lat, hit.lon];
      return true;
    }
    if (t === 'biome') {
      this._strokeStart('biome');
      this._biomeAt(hit.lat, hit.lon);
      this.last = [hit.lat, hit.lon];
      return true;
    }
    if (PAINT_TOOLS.has(t)) {
      if (t === 'paint' && this.selected < 0) { notice('Sélectionnez d\'abord un pays (outil Sélection ou liste).', 3000); return true; }
      this._strokeStart('owner');
      this._paintAt(hit.lat, hit.lon);
      this.last = [hit.lat, hit.lon];
      return true;
    }
    return false; // clic simple (sélection, créer, capitale) : traité au relâchement
  }

  pointerMove(e, hit) {
    this.hover = hit;
    this._updateCursor();
    if (!this.stroke || !hit) return;
    if (this.stroke.kind === 'move') { this._moveUpdate(hit); return; }
    // échantillons intermédiaires : trait continu même en mouvement rapide
    const [la0, lo0] = this.last;
    const d = gcKm(la0, lo0, hit.lat, hit.lon);
    const step = Math.max(12, this.radiusKm * 0.3);
    const n = Math.min(40, Math.ceil(d / step));
    const a = dirOf(la0, lo0), b = dirOf(hit.lat, hit.lon);
    for (let k = 1; k <= n; k++) {
      const f = k / n;
      const v = [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f];
      const l = Math.hypot(...v);
      const [la, lo] = latLonOf([v[0] / l, v[1] / l, v[2] / l]);
      if (this.stroke.kind === 'terrain') this._terrainAt(la, lo); else if (this.stroke.kind === 'biome') this._biomeAt(la, lo); else this._paintAt(la, lo);
    }
    this.last = [hit.lat, hit.lon];
  }

  pointerUp() {
    if (!this.stroke) return;
    if (this.stroke.kind === 'move') this._moveEnd();
    else this._strokeEnd();
  }

  click(hit, cell) {
    if (!this.w || !hit) return;
    const t = this.tool;
    const o = cell >= 0 ? this.owner[cell] : NONE;
    if (t === 'select') { this.select(o !== NONE ? o : -1); return; }
    if (t === 'create') { this._createHere(cell, hit); return; }
    if (t === 'capital') { this._placeCapital(hit, cell); return; }
  }

  key(e) {
    if (!this.active || !this.w) return false;
    const k = e.key.toLowerCase();
    if ((e.ctrlKey || e.metaKey) && k === 'z') { e.preventDefault(); this.doUndo(); return true; }
    if ((e.ctrlKey || e.metaKey) && k === 'y') { e.preventDefault(); this.doRedo(); return true; }
    if ((e.ctrlKey || e.metaKey) && k === 's') { e.preventDefault(); this.save(); return true; }
    if (KEYS[k] && !e.ctrlKey && !e.metaKey) { this.setTool(KEYS[k]); return true; }
    if (k === '[') { this.radiusKm = Math.max(40, this.radiusKm * 0.8); $('edRadius').value = this.radiusKm; $('edRadius').dispatchEvent(new Event('input')); return true; }
    if (k === ']') { this.radiusKm = Math.min(1500, this.radiusKm * 1.25); $('edRadius').value = this.radiusKm; $('edRadius').dispatchEvent(new Event('input')); return true; }
    return false;
  }

  _updateCursor() {
    const r = this.app.renderer;
    if (!this.active || !this.hover || !(TERRAIN_TOOLS.has(this.tool) && this.tool !== 'move' || PAINT_TOOLS.has(this.tool) || this.tool === 'biome')) { r.setBrush(null); return; }
    const bc = this.tool === 'biome' ? (this.biome >= 0 ? BIOME_COLORS[this.biome] : '#9aa3b2') : this.tool === 'naturalize' ? '#b48cff' : null;
    r.setBrush(dirOf(this.hover.lat, this.hover.lon), this.radiusKm, bc || (PAINT_TOOLS.has(this.tool) ? (this.tool === 'paint' && this.selected >= 0 ? this.w.entities[this.selected].color : '#e5e7eb') : '#ffffff'));
  }

  // ---------------------------------------------------------------- terrain
  _strokeStart(kind) {
    const w = this.w;
    this.stroke = {
      kind,
      elev: kind === 'terrain' || kind === 'move' ? Float32Array.from(w.terrain.elev) : null,
      raster: Uint16Array.from(w.raster),
      biomes: kind === 'biome' ? Uint8Array.from(w.biomes || new Uint8Array(GW * GH)) : null,
      entities: kind === 'move' ? JSON.stringify(w.entities.map((e) => e.capital)) : null,
      box: [Infinity, Infinity, -Infinity, -Infinity], // x0 y0 x1 y1 (texels du terrain)
      dirtyAt: 0,
    };
  }

  _terrainAt(lat, lon) {
    const t = this.w.terrain, e = t.elev, W = t.W, H = t.H;
    const R = this.radiusKm;
    const dLat = (R / EARTH_R) / DEG;
    const y0 = Math.max(0, Math.floor((90 - lat - dLat) / 180 * H)), y1 = Math.min(H - 1, Math.ceil((90 - lat + dLat) / 180 * H));
    const c = dirOf(lat, lon);
    const cosR = Math.cos(R / EARTH_R);
    const k = this.strength * 0.5;
    const tool = this.tool;
    const box = this.stroke.box;
    const smoothSrc = tool === 'smooth' ? e.slice() : null;
    for (let y = y0; y <= y1; y++) {
      const la = (90 - (y + 0.5) * 180 / H) * DEG;
      const cl = Math.cos(la);
      const dLon = cl < 0.02 ? 180 : Math.min(180, (Math.asin(Math.min(1, Math.sin(R / EARTH_R) / cl)) / DEG) + 0.5);
      const xc = (lon + 180) / 360 * W;
      const xa = Math.floor(xc - dLon / 360 * W), xb = Math.ceil(xc + dLon / 360 * W);
      const sy = Math.sin(la);
      for (let xx = xa; xx <= xb; xx++) {
        const x = ((xx % W) + W) % W;
        const lo = (-180 + (x + 0.5) * 360 / W) * DEG;
        const dot = c[0] * cl * Math.sin(lo) + c[1] * sy + c[2] * cl * Math.cos(lo);
        if (dot < cosR) continue;
        const dn = Math.acos(Math.min(1, dot)) / (R / EARTH_R);   // 0 au centre, 1 au bord
        let wgt = (1 - dn * dn); wgt *= wgt;
        const idx = y * W + x;
        const org = organic(x, y);
        let v = e[idx];
        if (tool === 'land') { wgt *= 0.55 + 0.9 * org; const tgt = Math.max(v, 0.18 + 0.5 * org); v += (tgt - v) * Math.min(1, wgt * k * 1.6); }
        else if (tool === 'erase') { wgt *= 0.55 + 0.9 * org; const tgt = Math.min(v, -0.6 - 2.4 * wgt); v += (tgt - v) * Math.min(1, wgt * k * 1.6); }
        else if (tool === 'naturalize') v = this._natValue(x, y, wgt * Math.min(1, k * 1.8), v);
        else if (tool === 'raise') v += wgt * k * (0.35 + 0.3 * org);
        else if (tool === 'lower') v -= wgt * k * (0.35 + 0.3 * org);
        else if (tool === 'smooth') {
          let s = 0, n = 0;
          for (let dy = -2; dy <= 2; dy++) {
            const yy = Math.max(0, Math.min(H - 1, y + dy));
            for (let dx = -2; dx <= 2; dx++) { s += smoothSrc[yy * W + (((x + dx) % W) + W) % W]; n++; }
          }
          v += (s / n - v) * Math.min(1, wgt * k * 1.2);
        }
        e[idx] = Math.max(-9, Math.min(8.8, v));
        if (xx < box[0]) box[0] = xx; if (xx > box[2]) box[2] = xx;
        if (y < box[1]) box[1] = y; if (y > box[3]) box[3] = y;
      }
    }
    this._refreshTexture();
  }

  _refreshTexture(force = false) {
    const now = performance.now();
    if (!force && now - this.stroke.dirtyAt < 45) { this.stroke.pending = true; return; }
    this.stroke.dirtyAt = now;
    this.stroke.pending = false;
    const b = this.stroke.box, t = this.w.terrain;
    if (!isFinite(b[0])) return;
    const r = this.app.renderer;
    if (b[2] - b[0] >= t.W - 2 || b[0] < 0 || b[2] >= t.W) r.refreshRelief(0, Math.max(0, b[1] - 1), t.W, b[3] - b[1] + 3);
    else r.refreshRelief(b[0] - 1, Math.max(0, b[1] - 1), b[2] - b[0] + 3, b[3] - b[1] + 3);
  }

  _strokeEnd() {
    const st = this.stroke;
    this.stroke = null;
    if (st.kind === 'terrain') {
      if (st.pending) { this.stroke = st; this._refreshTexture(true); this.stroke = null; }
      if (!isFinite(st.box[0])) return;
      this._pushUndo({ kind: 'state', elev: st.elev, raster: st.raster, capitals: null });
      this._rebuild();
      return;
    }
    if (st.kind === 'biome') {
      if (!st.changed) return;
      this._pushUndo({ kind: 'state', elev: null, raster: null, capitals: null, biomes: st.biomes });
      this.w.biomesVersion = (this.w.biomesVersion || 0) + 1;
      this.app.setWorld(this.viewWorld(), true);
      this.app.renderer.setWorldOwner(this.owner, null);
      this.app.refreshGeo(0);
      return;
    }
    if (st.kind === 'owner') {
      if (!st.changed) return;
      this._pushUndo({ kind: 'state', elev: null, raster: st.raster, capitals: null });
      this.app.cellCountsDirty = true;
      this.app.labels.invalidate();
      this.renderList(); this.renderCountry();
    }
  }

  // ---------------------------------------------------------------- territoires
  _paintAt(lat, lon) {
    const g = this.grid;
    const to = this.tool === 'unclaim' ? NONE : this.selected;
    const R = this.radiusKm;
    const c = dirOf(lat, lon);
    const cosR = Math.cos(R / EARTH_R);
    const dLat = (R / EARTH_R) / DEG;
    const y0 = Math.max(0, Math.floor((90 - lat - dLat) / 0.25)), y1 = Math.min(GH - 1, Math.ceil((90 - lat + dLat) / 0.25));
    const r = this.app.renderer;
    for (let y = y0; y <= y1; y++) {
      const la = (90 - (y + 0.5) * 0.25) * DEG;
      const cl = Math.cos(la);
      const dLon = cl < 0.02 ? 180 : Math.min(180, Math.asin(Math.min(1, Math.sin(R / EARTH_R) / cl)) / DEG + 0.5);
      const xa = Math.floor((lon - dLon + 180) / 0.25), xb = Math.ceil((lon + dLon + 180) / 0.25);
      for (let xx = xa; xx <= xb; xx++) {
        const x = ((xx % GW) + GW) % GW;
        const p = y * GW + x;
        const i = g.indexAt[p];
        if (i < 0 || this.owner[i] === to) continue;
        if (c[0] * g.xyz[i * 3] + c[1] * g.xyz[i * 3 + 1] + c[2] * g.xyz[i * 3 + 2] < cosR) continue;
        this.w.raster[p] = to;
        this.owner[i] = to;
        r.setOwnerInstant(i, to);
        this.stroke.changed = true;
      }
    }
  }

  _createHere(cell, hit) {
    if (cell < 0) { notice('Cliquez sur une zone de terre.', 2200); return; }
    const g = this.grid;
    const from = this.owner[cell];
    // zone : les terres reliées au point cliqué ayant le même propriétaire (terres neutres le plus souvent)
    const region = [];
    const seen = new Uint8Array(g.n);
    const stack = [cell]; seen[cell] = 1;
    while (stack.length) {
      const i = stack.pop();
      region.push(i);
      for (let k = g.nbrStart[i]; k < g.nbrStart[i + 1]; k++) {
        const j = g.nbr[k];
        if (!seen[j] && this.owner[j] === from) { seen[j] = 1; stack.push(j); }
      }
    }
    const fromName = from !== NONE && this.w.entities[from] ? this.w.entities[from].name : null;
    const used = new Set(this.w.entities.filter((e) => !e.removed).map((e) => e.color));
    this.app.countryDialog.open({
      title: 'Créer un pays ici',
      info: `${fmtInt(region.length)} parcelles (≈ ${fmtInt(region.length * 27.8 * 27.8 * Math.cos(hit.lat * DEG))} km²)${fromName ? ` prises à ${fromName}` : ''} deviendront son territoire. La capitale sera placée à l'endroit cliqué.`,
      color: MAP_PALETTE.find((c) => !used.has(c)),
      onDone: (spec) => {
        const before = Uint16Array.from(this.w.raster);
        const ent = this._newEntity(spec, hit);
        for (const i of region) { this.owner[i] = ent.index; this.w.raster[g.pos[i]] = ent.index; this.app.renderer.setOwnerInstant(i, ent.index); }
        this._pushUndo({ kind: 'state', elev: null, raster: before, capitals: null, created: ent.index, removeCreated: true });
        this.app.cellCountsDirty = true;
        this.app.labels.invalidate();
        this.select(ent.index);
        notice(`${ent.name} créé · capitale : ${ent.capital.name}`, 3000);
      },
    });
  }

  _newEntity(spec, hit) {
    const ents = this.w.entities;
    const ent = {
      index: ents.length, id: 'C' + Date.now().toString(36) + ents.length, kind: 'custom', name: spec.name, continent: spec.continent,
      flag: spec.flag, color: spec.color, color2: spec.color2,
      capital: { name: spec.capitalName, lat: hit.lat, lon: hit.lon },
      population: spec.population, stats: spec.stats, alive: true,
    };
    ents.push(ent);
    this.app.renderer.addEntity(ent);
    if (!this.w.chronicle) this.w.chronicle = emptyChronicle();
    this.w.chronicle.events.push({ day: this.w.dateDays || 0, type: 'creation', text: `Création de ${ent.name} (capitale : ${ent.capital.name}).`, e: [ent.index] });
    return ent;
  }

  _placeCapital(hit, cell) {
    if (this.selected < 0) { notice('Sélectionnez d\'abord un pays.', 2500); return; }
    if (cell < 0) { notice('La capitale doit être placée sur la terre.', 2500); return; }
    const ent = this.w.entities[this.selected];
    this.editEntity((e) => { e.capital = { name: (e.capital && e.capital.name) || `${e.name} City`, lat: hit.lat, lon: hit.lon }; });
    if (this.owner[cell] !== this.selected) notice(`Capitale placée hors du territoire de ${ent.name}.`, 2800);
    this.app.labels.invalidate();
  }

  // ---------------------------------------------------------------- déplacement de masses
  _moveStart(hit) {
    const t = this.w.terrain, W = t.W, H = t.H;
    const x = Math.floor((hit.lon + 180) / 360 * W) % W, y = Math.min(H - 1, Math.floor((90 - hit.lat) / 180 * H));
    if (t.elev[y * W + x] <= 0) { notice('Cliquez sur une terre pour la déplacer.', 2200); return true; }
    const mask = new Uint8Array(W * H);
    const stack = [y * W + x]; mask[y * W + x] = 1;
    let n = 0, cx = 0, cy = 0, cz = 0;
    while (stack.length) {
      const k = stack.pop(); n++;
      const ky = (k / W) | 0, kx = k - ky * W;
      const v = dirOf(90 - (ky + 0.5) * 180 / H, -180 + (kx + 0.5) * 360 / W);
      cx += v[0]; cy += v[1]; cz += v[2];
      for (let dy = -1; dy <= 1; dy++) {
        const yy = ky + dy; if (yy < 0 || yy >= H) continue;
        for (let dx = -1; dx <= 1; dx++) {
          const j = yy * W + ((kx + dx + W) % W);
          if (!mask[j] && t.elev[j] > 0) { mask[j] = 1; stack.push(j); }
        }
      }
    }
    // marge côtière (plateau continental) déplacée avec la terre
    const grown = mask.slice();
    for (let pass = 0; pass < 3; pass++) {
      const src = grown.slice();
      for (let k = 0; k < W * H; k++) {
        if (src[k]) continue;
        const ky = (k / W) | 0, kx = k - ky * W;
        if ((kx > 0 && src[k - 1]) || (kx < W - 1 && src[k + 1]) || (ky > 0 && src[k - W]) || (ky < H - 1 && src[k + W])) grown[k] = 2;
      }
    }
    const cl = Math.hypot(cx, cy, cz);
    const centroid = [cx / cl, cy / cl, cz / cl];
    let maxAng = 0;
    for (let k = 0; k < W * H; k++) {
      if (!grown[k]) continue;
      const ky = (k / W) | 0, kx = k - ky * W;
      const v = dirOf(90 - (ky + 0.5) * 180 / H, -180 + (kx + 0.5) * 360 / W);
      maxAng = Math.max(maxAng, Math.acos(Math.min(1, v[0] * centroid[0] + v[1] * centroid[1] + v[2] * centroid[2])));
    }
    this._strokeStart('move');
    const base = this.stroke.elev.slice();
    // à l'emplacement d'origine : océan (profondeur moyenne des alentours)
    for (let k = 0; k < W * H; k++) if (grown[k]) base[k] = grown[k] === 1 ? -1.6 : Math.min(base[k], -0.9);
    Object.assign(this.stroke, { mask: grown, base, centroid, maxAng, start: dirOf(hit.lat, hit.lon), rot: null, landCells: n });
    this.stroke.box = [0, 0, W - 1, H - 1];
    this.app.renderer.cam.target = null;
    return true;
  }

  _moveUpdate(hit) {
    const st = this.stroke;
    const now = performance.now();
    st.target = dirOf(hit.lat, hit.lon);
    if (now - (st.movedAt || 0) < 90) return;
    st.movedAt = now;
    this._applyMove();
  }

  _applyMove() {
    const st = this.stroke, t = this.w.terrain, W = t.W, H = t.H;
    if (!st.target) return;
    const M = rotationBetween(st.start, st.target);
    const Mi = transpose3(M);
    st.rot = M;
    const e = t.elev;
    e.set(st.base);
    const c = apply3(M, st.centroid);
    const cosMax = Math.cos(Math.min(Math.PI, st.maxAng + 0.02));
    const src = st.elev, mask = st.mask;
    const [cLat] = latLonOf(c);
    const angDeg = st.maxAng / DEG + 1;
    const y0 = Math.max(0, Math.floor((90 - cLat - angDeg) / 180 * H)), y1 = Math.min(H - 1, Math.ceil((90 - cLat + angDeg) / 180 * H));
    for (let y = y0; y <= y1; y++) {
      const la = (90 - (y + 0.5) * 180 / H) * DEG;
      const cl = Math.cos(la), sl = Math.sin(la);
      for (let x = 0; x < W; x++) {
        const lo = (-180 + (x + 0.5) * 360 / W) * DEG;
        const v = [cl * Math.sin(lo), sl, cl * Math.cos(lo)];
        if (v[0] * c[0] + v[1] * c[1] + v[2] * c[2] < cosMax) continue;
        const s = apply3(Mi, v);
        const [sla, slo] = latLonOf(s);
        const sx = Math.floor((slo + 180) / 360 * W) % W, sy = Math.min(H - 1, Math.max(0, Math.floor((90 - sla) / 180 * H)));
        const m = mask[sy * W + sx];
        if (!m) continue;
        const val = src[sy * W + sx];
        const k = y * W + x;
        // fusion : la terre déplacée s'ajoute aux terres existantes
        e[k] = m === 1 ? Math.max(e[k], val) : Math.max(e[k], Math.min(val, -0.2));
      }
    }
    this.app.renderer.refreshRelief();
  }

  _moveEnd() {
    const st = this.stroke;
    this._applyMove();
    this.stroke = null;
    if (!st.rot) return;
    // propriétaires et capitales suivent la terre déplacée
    const M = st.rot, Mi = transpose3(M);
    const t = this.w.terrain, W = t.W, H = t.H;
    const oldR = st.raster, newR = Uint16Array.from(oldR);
    const inMask = (la, lo) => {
      const sx = Math.floor((lo + 180) / 360 * W) % W, sy = Math.min(H - 1, Math.max(0, Math.floor((90 - la) / 180 * H)));
      return st.mask[sy * W + sx] === 1;
    };
    for (let p = 0; p < GW * GH; p++) {
      const y = (p / GW) | 0, x = p - y * GW;
      if (inMask(90 - (y + 0.5) * 0.25, -180 + (x + 0.5) * 0.25)) newR[p] = SEA;
    }
    for (let p = 0; p < GW * GH; p++) {
      const y = (p / GW) | 0, x = p - y * GW;
      const v = dirOf(90 - (y + 0.5) * 0.25, -180 + (x + 0.5) * 0.25);
      const [sla, slo] = latLonOf(apply3(Mi, v));
      if (!inMask(sla, slo)) continue;
      const sp = Math.min(GH - 1, Math.floor((90 - sla) / 0.25)) * GW + (Math.floor((slo + 180) / 0.25) % GW);
      if (oldR[sp] !== SEA) newR[p] = oldR[sp];
    }
    this.w.raster = newR;
    for (const ent of this.w.entities) {
      if (!ent.capital || !inMask(ent.capital.lat, ent.capital.lon)) continue;
      const [la, lo] = latLonOf(apply3(M, dirOf(ent.capital.lat, ent.capital.lon)));
      ent.capital = { ...ent.capital, lat: la, lon: lo };
    }
    this._pushUndo({ kind: 'state', elev: st.elev, raster: oldR, capitals: st.entities });
    this._rebuild();
    this.app.labels.invalidate();
  }

  // ---------------------------------------------------------------- annuler / rétablir
  _pushUndo(a) {
    // taille maîtrisée : on garde les 40 dernières actions
    this.undo.push(a); if (this.undo.length > 40) this.undo.shift();
    this.redo = [];
    this._undoButtons();
  }
  _undoButtons() { $('edUndo').disabled = !this.undo.length; $('edRedo').disabled = !this.redo.length; }

  // état courant des composantes touchées par une action (pour l'action inverse)
  _capture(a) {
    const w = this.w;
    if (a.kind === 'entity') return { kind: 'entity', entity: a.entity, json: JSON.stringify(w.entities[a.entity]) };
    return {
      kind: 'state',
      elev: a.elev ? Float32Array.from(w.terrain.elev) : null,
      raster: a.raster ? Uint16Array.from(w.raster) : null,
      capitals: a.capitals ? JSON.stringify(w.entities.map((e) => e.capital)) : null,
      biomes: a.biomes ? Uint8Array.from(w.biomes || new Uint8Array(GW * GH)) : null,
      created: a.created, removeCreated: a.created !== undefined ? !a.removeCreated : undefined,
    };
  }

  _restoreState(a) {
    const w = this.w;
    if (a.kind === 'entity') {
      Object.assign(w.entities[a.entity], JSON.parse(a.json));
      this.app.renderer.addEntity(w.entities[a.entity]);
      this.app.refreshParams();
    } else {
      if (a.elev) w.terrain.elev.set(a.elev);
      if (a.raster) w.raster = Uint16Array.from(a.raster);
      if (a.capitals) JSON.parse(a.capitals).forEach((c, k) => { if (w.entities[k]) w.entities[k].capital = c; });
      if (a.biomes) { w.biomes = Uint8Array.from(a.biomes); w.biomesVersion = (w.biomesVersion || 0) + 1; this.app.setWorld(this.viewWorld(), true); this.app.renderer.setWorldOwner(this.owner, null); this.app.refreshGeo(0); }
      if (a.created !== undefined && w.entities[a.created]) { w.entities[a.created].removed = !!a.removeCreated; if (a.removeCreated && this.selected === a.created) this.selected = -1; }
      if (a.elev) { this.app.renderer.refreshRelief(); this._rebuild(); }
      else {
        const g = this.grid;
        for (let i = 0; i < g.n; i++) { const v = w.raster[g.pos[i]]; const o = v === SEA ? NONE : v; if (this.owner[i] !== o) { this.owner[i] = o; this.app.renderer.setOwnerInstant(i, o); } }
        this.app.cellCountsDirty = true;
      }
    }
    this.app.labels.invalidate();
    this.renderList(); this.renderCountry();
  }

  doUndo() {
    const a = this.undo.pop(); if (!a) return;
    this.redo.push(this._capture(a));
    this._restoreState(a);
    this._undoButtons();
    notice('Modification annulée', 1200);
  }
  doRedo() {
    const a = this.redo.pop(); if (!a) return;
    this.undo.push(this._capture(a));
    this._restoreState(a);
    this._undoButtons();
    notice('Modification rétablie', 1200);
  }

  // ---------------------------------------------------------------- pays
  select(e) {
    this.selected = e;
    this.app.renderer.selected = e;
    this.renderList();
    this.renderCountry();
    this.setTool(this.tool);
  }

  editEntity(fn, e = this.selected) {
    const ent = this.w.entities[e];
    if (!ent) return;
    const before = JSON.stringify(ent);
    fn(ent);
    if (JSON.stringify(ent) !== before) this._pushUndo({ kind: 'entity', entity: e, json: before });
    this.app.renderer.addEntity(ent);
    this.app.refreshParams();
    this.app.labels.invalidate();
    this.renderList();
  }

  renderList() {
    if (!this.w) return;
    const q = ($('edSearch').value || '').trim().toLowerCase();
    const counts = new Uint32Array(this.w.entities.length + 1);
    if (this.owner) for (let i = 0; i < this.owner.length; i++) if (this.owner[i] < counts.length) counts[this.owner[i]]++;
    const list = this.w.entities.filter((e) => !e.removed && e.kind !== 'neutral' && (counts[e.index] > 0 || e.kind === 'custom'))
      .filter((e) => !q || e.name.toLowerCase().includes(q))
      .sort((a, b) => counts[b.index] - counts[a.index]);
    $('edCount').textContent = `${list.length} pays`;
    $('edList').innerHTML = list.slice(0, 250).map((e) => `
      <li class="${e.index === this.selected ? 'on' : ''}" data-e="${e.index}">
        <i class="dot" style="background:${e.color}"></i><span class="nm">${esc(e.name)}</span><small>${fmtInt(counts[e.index])}</small>
      </li>`).join('') || '<li class="empty">Aucun pays. Outil « Créer un pays ici » pour commencer.</li>';
    $('edList').querySelectorAll('li[data-e]').forEach((li) => li.addEventListener('click', () => {
      const e = Number(li.dataset.e);
      this.select(e);
      this.app.centerOn(e);
    }));
  }

  renderCountry() {
    const el = $('edCountry');
    const ent = this.w && this.selected >= 0 ? this.w.entities[this.selected] : null;
    if (!ent) { el.innerHTML = '<p class="hint">Sélectionnez un pays pour modifier son nom, sa couleur, sa capitale, sa puissance et ses statistiques.</p>'; return; }
    const cap = ent.capital;
    el.innerHTML = `
      <div class="field"><label><span>Nom</span></label><input type="text" id="edcName" maxlength="32" value="${esc(ent.name)}"></div>
      <div class="field"><label><span>Couleur</span></label>
        <div class="swatches">${MAP_PALETTE.map((c) => `<button style="--c:${c}" data-c="${c}" class="${c === ent.color ? 'on' : ''}"></button>`).join('')}<input type="color" id="edcColor" value="${ent.color}"></div></div>
      <div class="field"><label><span>Capitale</span></label>
        <div class="row"><input type="text" id="edcCap" maxlength="32" value="${esc(cap ? cap.name : '')}" placeholder="Aucune capitale">
        <button class="btn ghost sm" id="edcCapMove" title="Placer / déplacer sur la carte">${icon('map-pin')}</button>
        <button class="btn ghost sm" id="edcCapDel" title="Supprimer la capitale" ${cap ? '' : 'disabled'}>${icon('trash-2')}</button></div>
        <small class="hint">${cap ? `${cap.lat.toFixed(2)}°, ${cap.lon.toFixed(2)}°` : 'Outil Capitale ou bouton ci-dessus pour la placer.'}</small></div>
      <div class="ed-sep"><span class="eyebrow">Fiche du pays</span><small class="hint">Toutes les valeurs sont liées entre elles.</small></div>
      <div id="edcProfile" class="pf"></div>
      <div class="row"><button class="btn ghost sm danger" id="edcDelete">${icon('trash-2')} Supprimer le pays</button></div>`;
    const name = $('edcName');
    name.addEventListener('keydown', (e) => e.stopPropagation());
    name.addEventListener('change', () => this.editEntity((x) => { x.name = name.value.trim() || x.name; }));
    el.querySelectorAll('.swatches [data-c]').forEach((b) => b.addEventListener('click', () => { this.editEntity((x) => { x.color = b.dataset.c; if (x.flag && x.flag.layout === 'solid') x.flag = { layout: 'solid', colors: [b.dataset.c] }; }); this.renderCountry(); }));
    $('edcColor').addEventListener('change', () => { this.editEntity((x) => { x.color = $('edcColor').value; }); this.renderCountry(); });
    const capIn = $('edcCap');
    capIn.addEventListener('keydown', (e) => e.stopPropagation());
    capIn.addEventListener('change', () => { if (!ent.capital) { notice('Placez d\'abord la capitale sur la carte.', 2500); return; } this.editEntity((x) => { x.capital = { ...x.capital, name: capIn.value.trim() || x.capital.name }; }); });
    $('edcCapMove').addEventListener('click', () => { this.setTool('capital'); notice('Cliquez sur la carte pour placer la capitale.', 2500); });
    $('edcCapDel').addEventListener('click', () => { this.editEntity((x) => { x.capital = null; }); this.renderCountry(); });
    if (ent.kind !== 'neutral') renderProfileEditor($('edcProfile'), ent, (fn) => { this.editEntity(fn); this.renderCountry(); });
    $('edcDelete').addEventListener('click', () => this.deleteCountry(this.selected));
  }

  deleteCountry(e) {
    const ent = this.w.entities[e];
    if (!ent || !confirm(`Supprimer ${ent.name} ? Son territoire deviendra neutre.`)) return;
    const before = Uint16Array.from(this.w.raster);
    const g = this.grid;
    for (let i = 0; i < g.n; i++) if (this.owner[i] === e) { this.owner[i] = NONE; this.w.raster[g.pos[i]] = NONE; this.app.renderer.setOwnerInstant(i, NONE); }
    this._pushUndo({ kind: 'state', elev: null, raster: before, capitals: null, created: e, removeCreated: false });
    ent.removed = true; ent.alive = false;
    if (this.w.chronicle) this.w.chronicle.events.push({ day: this.w.dateDays || 0, type: 'elimination', text: `Disparition de ${ent.name} (supprimé dans CREATE WORLD).`, e: [e] });
    this.select(-1);
    this.app.cellCountsDirty = true;
    this.app.labels.invalidate();
  }

  // ---------------------------------------------------------------- NATURALIZE
  // valeur naturalisée d'un texel : déformation (domain warp) de la forme d'origine + détails fractals
  _natValue(x, y, amount, cur) {
    const t = this.w.terrain, W = t.W, H = t.H;
    const src = this.stroke ? this.stroke.elev : this._natSrc;
    // déformation multi-échelle : grands golfes et péninsules, puis baies, puis petites indentations
    const wx = (vnoise(x / 80, y / 80) - 0.5) * 170 + (vnoise(x / 24 + 17, y / 24) - 0.5) * 60 + (vnoise(x / 7 + 5, y / 7 + 9) - 0.5) * 14;
    const wy = (vnoise(x / 80 + 71, y / 80 + 33) - 0.5) * 170 + (vnoise(x / 24 + 41, y / 24 + 3) - 0.5) * 60 + (vnoise(x / 7 + 23, y / 7) - 0.5) * 14;
    const sx = x + wx * amount, sy = Math.max(0, Math.min(H - 1, y + wy * amount));
    const x0 = Math.floor(sx), y0 = Math.floor(sy), fx = sx - x0, fy = sy - y0;
    const at = (xx, yy) => src[Math.max(0, Math.min(H - 1, yy)) * W + ((xx % W) + W) % W];
    let v = (at(x0, y0) * (1 - fx) + at(x0 + 1, y0) * fx) * (1 - fy) + (at(x0, y0 + 1) * (1 - fx) + at(x0 + 1, y0 + 1) * fx) * fy;
    // côtes : baies, péninsules et îlots
    const coast = Math.max(0, 1 - Math.abs(v) / 0.7);
    const d = vnoise(x / 3.2 + 91, y / 3.2 + 7) * 0.6 + vnoise(x / 1.4, y / 1.4 + 51) * 0.4;
    v += (d - 0.5) * 1.4 * coast * amount;
    // intérieur des terres : collines et chaînes de montagnes (bruit en crêtes)
    if (v > 0.05) {
      const rn = vnoise(x / 26 + 3, y / 26 + 11) * 0.7 + vnoise(x / 11 + 13, y / 11 + 1) * 0.3;
      const ridge = 1 - Math.abs(rn * 2 - 1);
      const inland = Math.min(1, v / 0.6);
      v += (Math.pow(ridge, 3) * 1.6 + (vnoise(x / 5, y / 5) - 0.5) * 0.35) * inland * amount * 0.7;
    }
    return cur + (v - cur) * Math.min(1, amount * 1.6);
  }

  naturalizeAll() {
    if (!this.w) return;
    const t = this.w.terrain;
    const before = Float32Array.from(t.elev);
    this._natSrc = before;
    const e = t.elev;
    const k = Math.max(0.3, this.strength);
    for (let y = 0; y < t.H; y++) for (let x = 0; x < t.W; x++) {
      const i = y * t.W + x;
      e[i] = Math.max(-9, Math.min(8.8, this._natValue(x, y, k * 0.8, before[i])));
    }
    this._natSrc = null;
    this._pushUndo({ kind: 'state', elev: before, raster: Uint16Array.from(this.w.raster), capitals: null });
    this.app.renderer.refreshRelief();
    this._rebuild();
    notice('Monde naturalisé : côtes découpées, baies, îlots et relief. Ctrl+Z pour annuler.', 3200);
  }

  // vallées : les rivières calculées creusent légèrement le relief
  carveValleys() {
    if (!this.w) return;
    const t = this.w.terrain, g = this.grid;
    const geo = computeGeo(g, t);
    const before = Float32Array.from(t.elev);
    const e = t.elev;
    let n = 0;
    for (let i = 0; i < g.nGrid; i++) {
      const r = geo.river[i];
      if (!r) continue;
      const cx = (g.lon[i] + 180) / 360 * t.W, cy = (90 - g.lat[i]) / 180 * t.H;
      const rad = 1 + r;
      for (let dy = -rad; dy <= rad; dy++) for (let dx = -rad; dx <= rad; dx++) {
        const x = ((Math.floor(cx) + dx) % t.W + t.W) % t.W, y = Math.max(0, Math.min(t.H - 1, Math.floor(cy) + dy));
        const w = Math.max(0, 1 - Math.hypot(dx, dy) / (rad + 0.5));
        const k = y * t.W + x;
        if (e[k] > 0.08) { e[k] = Math.max(0.03, e[k] - w * (0.05 + 0.06 * r) * Math.min(1, e[k] / 0.4)); n++; }
      }
    }
    this._pushUndo({ kind: 'state', elev: before, raster: Uint16Array.from(this.w.raster), capitals: null });
    this.app.renderer.refreshRelief();
    this._rebuild();
    notice(`Vallées creusées le long de ${geo.riverSegs.length / 3} tronçons de rivières.`, 3000);
  }

  // ---------------------------------------------------------------- biomes
  _biomeAt(lat, lon) {
    const w = this.w;
    if (!w.biomes) w.biomes = new Uint8Array(GW * GH);
    const val = this.biome >= 0 ? this.biome + 1 : 0;
    const R = this.radiusKm;
    const c = dirOf(lat, lon);
    const cosR = Math.cos(R / EARTH_R);
    const dLat = (R / EARTH_R) / DEG;
    const y0 = Math.max(0, Math.floor((90 - lat - dLat) / 0.25)), y1 = Math.min(GH - 1, Math.ceil((90 - lat + dLat) / 0.25));
    for (let y = y0; y <= y1; y++) {
      const la = (90 - (y + 0.5) * 0.25) * DEG;
      const cl = Math.cos(la);
      const dLon = cl < 0.02 ? 180 : Math.min(180, Math.asin(Math.min(1, Math.sin(R / EARTH_R) / cl)) / DEG + 0.5);
      const xa = Math.floor((lon - dLon + 180) / 0.25), xb = Math.ceil((lon + dLon + 180) / 0.25);
      for (let xx = xa; xx <= xb; xx++) {
        const x = ((xx % GW) + GW) % GW;
        const lo = (-180 + (x + 0.5) * 0.25) * DEG;
        if (c[0] * cl * Math.sin(lo) + c[1] * Math.sin(la) + c[2] * cl * Math.cos(lo) < cosR) continue;
        // bords irréguliers
        if (organic(x, y) < 0.18 && Math.random() < 0.5) continue;
        const p = y * GW + x;
        if (w.biomes[p] !== val) { w.biomes[p] = val; this.stroke.changed = true; }
      }
    }
  }

  // ---------------------------------------------------------------- AUTO / NATURAL BORDER
  // partage des terres par propagation depuis les capitales (Dijkstra) :
  //  auto : coût irrégulier (bruit) -> frontières plausibles ; natural : coût du terrain (montagnes, crêtes, rivières)
  borders(mode, scope) {
    if (!this.w) return;
    const g = this.grid, w = this.w;
    const geo = computeGeo(g, w.terrain, { override: w.biomes });
    const ents = w.entities.filter((e) => !e.removed && e.kind !== 'neutral');
    const withCap = ents.filter((e) => e.capital);
    if (!withCap.length) { notice('Placez au moins une capitale (outil Capitale) avant de générer des frontières.', 3500); return; }
    const before = Uint16Array.from(w.raster);
    const n = g.n;
    const dist = new Float32Array(n).fill(Infinity);
    const lab = new Int32Array(n).fill(-1);
    const fixed = new Uint8Array(n);
    const heap = new Heap(n * 3);
    const weight = new Map(withCap.map((e) => [e.index, Math.max(0.75, Math.min(1.45, Math.pow((e.population || 1e7) / 3e7, 0.12)))]));
    const push = (i, e, d) => { if (d < dist[i]) { dist[i] = d; lab[i] = e; heap.push(d, i); } };
    if (scope === 'free') {
      for (let i = 0; i < n; i++) if (this.owner[i] !== NONE) { fixed[i] = 1; lab[i] = this.owner[i]; dist[i] = 0; }
      for (let i = 0; i < n; i++) if (fixed[i]) for (let k = g.nbrStart[i]; k < g.nbrStart[i + 1]; k++) { const j = g.nbr[k]; if (this.owner[j] === NONE) { heap.push(0, i); break; } }
    } else if (scope === 'refine') {
      // bande de 3 parcelles autour des frontières existantes recalculée d'après le relief
      const band = new Uint8Array(n);
      for (let i = 0; i < n; i++) for (let k = g.nbrStart[i]; k < g.nbrStart[i + 1]; k++) if (this.owner[g.nbr[k]] !== this.owner[i] && this.owner[i] !== NONE && this.owner[g.nbr[k]] !== NONE) { band[i] = 1; break; }
      for (let pass = 0; pass < 2; pass++) { const b2 = band.slice(); for (let i = 0; i < n; i++) if (b2[i]) for (let k = g.nbrStart[i]; k < g.nbrStart[i + 1]; k++) if (this.owner[g.nbr[k]] !== NONE) band[g.nbr[k]] = 1; }
      for (let i = 0; i < n; i++) { if (this.owner[i] === NONE) { fixed[i] = 1; continue; } if (!band[i]) { lab[i] = this.owner[i]; dist[i] = 0; fixed[i] = 2; } }
      for (let i = 0; i < n; i++) if (fixed[i] === 2) for (let k = g.nbrStart[i]; k < g.nbrStart[i + 1]; k++) if (band[g.nbr[k]]) { heap.push(0, i); break; }
    } else {
      for (const e of ents) if (!e.capital) for (let i = 0; i < n; i++) if (this.owner[i] === e.index) { fixed[i] = 1; lab[i] = e.index; dist[i] = 0; }
    }
    if (scope !== 'refine') for (const e of withCap) {
      const c = nearestLand(g, e.capital.lat, e.capital.lon);
      if (c >= 0 && !(scope === 'free' && fixed[c] && lab[c] !== e.index)) push(c, e.index, 0);
    }
    while (heap.size) {
      const d = heap.topKey(), i = heap.pop();
      if (d > dist[i]) continue;
      const e = lab[i];
      const wt = weight.get(e) || 1;
      for (let k = g.nbrStart[i]; k < g.nbrStart[i + 1]; k++) {
        const j = g.nbr[k];
        if (fixed[j] === 1 || (scope === 'refine' && fixed[j] === 2)) continue;
        let c;
        if (mode === 'natural') c = 1 + geo.barrier[j] * 1.6 + Math.abs(geo.elev[j] - geo.elev[i]) * 4 + (geo.river[i] && !geo.river[j] ? 1.2 : 0) + organic(g.pos[j] % GW, (g.pos[j] / GW) | 0) * 0.4;
        else c = 0.5 + 1.6 * organic(g.pos[j] % GW, (g.pos[j] / GW) | 0) ** 2 + geo.barrier[j] * 0.25;
        push(j, e, d + c / wt);
      }
    }
    // îles sans capitale : rattachées au pays le plus proche (moins de 900 km)
    let changed = 0;
    const r = this.app.renderer;
    for (let i = 0; i < n; i++) {
      if (fixed[i] === 1 && scope !== 'refine') continue;
      if (scope === 'refine' && fixed[i]) continue;
      let o = lab[i];
      if (o < 0) {
        if (scope !== 'all') continue;
        let best = -1, bd = 900;
        for (const e of withCap) { const d = gcKm(g.lat[i], g.lon[i], e.capital.lat, e.capital.lon); if (d < bd) { bd = d; best = e.index; } }
        o = best >= 0 ? best : NONE;
      }
      if (this.owner[i] !== o) { this.owner[i] = o; w.raster[g.pos[i]] = o; r.setOwnerInstant(i, o); changed++; }
    }
    this._pushUndo({ kind: 'state', elev: null, raster: before, capitals: null });
    this.app.cellCountsDirty = true;
    this.app.labels.invalidate();
    this.app.refreshParams();
    this.renderList(); this.renderCountry();
    notice(`${mode === 'natural' ? 'NATURAL BORDER' : 'AUTO BORDER'} : ${fmtInt(changed)} parcelles attribuées.`, 3000);
  }

  // ---------------------------------------------------------------- sauvegarde / simulation
  finalWorld() {
    const w = this.w;
    return {
      id: w.id, name: ($('edName').value || w.name || 'Monde').trim(), year: w.year || 1, createdAt: w.createdAt || new Date().toISOString(),
      terrain: w.terrain, owner: Uint16Array.from(this.owner), entities: w.entities,
      teams: w.teams || [], relations: w.relations || {}, history: w.history || [], simSettings: w.simSettings || null,
      biomes: w.biomes || null, biomesVersion: w.biomesVersion || 0, chronicle: w.chronicle || emptyChronicle(), dateDays: w.dateDays || 0,
      readonly: false,
    };
  }

  save() {
    if (!this.w) return;
    const world = this.finalWorld();
    world.history = [...(world.history || []), { year: world.year, title: 'Monde modifié', text: 'Géométrie, pays et capitales enregistrés depuis CREATE WORLD.', date: new Date().toISOString() }];
    this.app.worldsUI.openSave(world, 'La géométrie exacte (continents, îles, océans, relief), les frontières, les pays, les capitales, les couleurs et les statistiques seront enregistrés.', (saved) => {
      this.w.id = saved.id; this.w.name = saved.name;
      $('edName').value = saved.name;
      // l'application a basculé sur le monde enregistré : on continue à le modifier
      this._rebuild();
    });
  }

  simulate() {
    if (!this.w) return;
    const counts = this.app.cellCounts();
    const playable = this.w.entities.filter((e) => !e.removed && e.kind !== 'neutral' && counts[e.index] > 0);
    if (playable.length < 2) { notice('Créez au moins 2 pays avec un territoire pour lancer une simulation.', 3200); return; }
    const world = this.finalWorld();
    world.unsaved = true;
    this.exit();
    this.app.setWorld(world, true);
    this.app.openCreator(null);
  }
}

class Heap {
  constructor(cap) { this.k = new Float32Array(cap); this.v = new Int32Array(cap); this.n = 0; }
  get size() { return this.n; }
  topKey() { return this.k[0]; }
  push(key, val) {
    if (this.n >= this.k.length) { const k2 = new Float32Array(this.k.length * 2); k2.set(this.k); this.k = k2; const v2 = new Int32Array(this.v.length * 2); v2.set(this.v); this.v = v2; }
    let i = this.n++; const K = this.k, V = this.v;
    while (i > 0) { const p = (i - 1) >> 1; if (K[p] <= key) break; K[i] = K[p]; V[i] = V[p]; i = p; }
    K[i] = key; V[i] = val;
  }
  pop() {
    const K = this.k, V = this.v, top = V[0], n = --this.n;
    if (n > 0) {
      const key = K[n], val = V[n]; let i = 0;
      for (;;) { let c = 2 * i + 1; if (c >= n) break; if (c + 1 < n && K[c + 1] < K[c]) c++; if (K[c] >= key) break; K[i] = K[c]; V[i] = V[c]; i = c; }
      K[i] = key; V[i] = val;
    }
    return top;
  }
}
function nearestLand(g, lat, lon) {
  const x = Math.floor((lon + 180) / g.RES) % g.W, y = Math.floor((90 - lat) / g.RES);
  for (let r = 0; r < 12; r++) for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
    const yy = y + dy; if (yy < 0 || yy >= g.H) continue;
    const i = g.indexAt[yy * g.W + ((x + dx + g.W) % g.W)];
    if (i >= 0) return i;
  }
  return -1;
}

function gcKm(la1, lo1, la2, lo2) {
  const a = Math.sin((la2 - la1) * DEG / 2) ** 2 + Math.cos(la1 * DEG) * Math.cos(la2 * DEG) * Math.sin((lo2 - lo1) * DEG / 2) ** 2;
  return 2 * EARTH_R * Math.asin(Math.min(1, Math.sqrt(a)));
}
// population : curseur logarithmique de 10 000 à 1,5 milliard
const popToSlider = (p) => Math.max(0, Math.min(1, (Math.log10(Math.max(1e4, p || 1e6)) - 4) / (Math.log10(1.5e9) - 4)));
const sliderToPop = (v) => Math.round(Math.pow(10, 4 + v * (Math.log10(1.5e9) - 4)));
function fmtPop(p) { return p >= 1e6 ? (p / 1e6).toFixed(p >= 1e7 ? 0 : 1).replace('.', ',') + ' M' : fmtInt(p); }
export { isShown };
