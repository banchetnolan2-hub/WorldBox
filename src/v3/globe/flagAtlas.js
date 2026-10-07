// GLOBE — atlas de drapeaux (une seule texture pour les 196 pays + pays personnalisés)
import * as THREE from 'three';

export const SLOT_W = 160, SLOT_H = 120, COLS = 25, ROWS = 14;

export function flagUrlFor(entity) {
  if (!entity) return '';
  if (entity.customFlag) return customFlagDataUrl(entity.customFlag, 64, 48);
  if (entity.kind === 'custom') return customFlagDataUrl(entity.flag, 64, 48);
  return `assets/flags/${(entity.iso2 || '').toLowerCase()}.svg`;
}

// Dessin d'un drapeau personnalisé (bandes, croix, diagonale…)
export function drawCustomFlag(ctx, flag, x, y, w, h) {
  const f = flag || { layout: 'solid', colors: ['#888888'] };
  const c = f.colors && f.colors.length ? f.colors : ['#888888'];
  ctx.save();
  ctx.beginPath(); ctx.rect(x, y, w, h); ctx.clip();
  const col = (k) => c[k % c.length];
  switch (f.layout) {
    case 'h2': case 'h3': case 'h4': {
      const n = Number(f.layout[1]);
      for (let k = 0; k < n; k++) { ctx.fillStyle = col(k); ctx.fillRect(x, y + (h * k) / n, w, h / n + 1); }
      break;
    }
    case 'v2': case 'v3': {
      const n = Number(f.layout[1]);
      for (let k = 0; k < n; k++) { ctx.fillStyle = col(k); ctx.fillRect(x + (w * k) / n, y, w / n + 1, h); }
      break;
    }
    case 'cross': {
      ctx.fillStyle = col(0); ctx.fillRect(x, y, w, h);
      ctx.fillStyle = col(1);
      ctx.fillRect(x + w * 0.3, y, w * 0.14, h);
      ctx.fillRect(x, y + h * 0.43, w, h * 0.14);
      break;
    }
    case 'diag': {
      ctx.fillStyle = col(0); ctx.fillRect(x, y, w, h);
      ctx.fillStyle = col(1);
      ctx.beginPath(); ctx.moveTo(x + w, y); ctx.lineTo(x + w, y + h); ctx.lineTo(x, y + h); ctx.closePath(); ctx.fill();
      break;
    }
    case 'circle': {
      ctx.fillStyle = col(0); ctx.fillRect(x, y, w, h);
      ctx.fillStyle = col(1);
      ctx.beginPath(); ctx.arc(x + w / 2, y + h / 2, h * 0.3, 0, Math.PI * 2); ctx.fill();
      break;
    }
    case 'star': {
      ctx.fillStyle = col(0); ctx.fillRect(x, y, w, h);
      ctx.fillStyle = col(1);
      const cx = x + w / 2, cy = y + h / 2, R = h * 0.34, r = R * 0.42;
      ctx.beginPath();
      for (let k = 0; k < 10; k++) {
        const a = -Math.PI / 2 + k * Math.PI / 5, rr = k % 2 ? r : R;
        const px = cx + Math.cos(a) * rr, py = cy + Math.sin(a) * rr;
        if (k) ctx.lineTo(px, py); else ctx.moveTo(px, py);
      }
      ctx.closePath(); ctx.fill();
      break;
    }
    default:
      ctx.fillStyle = col(0); ctx.fillRect(x, y, w, h);
  }
  ctx.restore();
}

const customCache = new Map();
export function customFlagDataUrl(flag, w = 64, h = 48) {
  const key = JSON.stringify(flag) + w;
  if (customCache.has(key)) return customCache.get(key);
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  drawCustomFlag(c.getContext('2d'), flag, 0, 0, w, h);
  const url = c.toDataURL('image/png');
  customCache.set(key, url);
  return url;
}

export class FlagAtlas {
  constructor() {
    this.canvas = document.createElement('canvas');
    this.canvas.width = SLOT_W * COLS;
    this.canvas.height = SLOT_H * ROWS;
    // mémoire CPU : évite la perte du contenu si le contexte graphique du canevas est réinitialisé
    this.ctx = this.canvas.getContext('2d', { willReadFrequently: true });
    this.canvas.addEventListener('contextrestored', () => this.redrawAll());
    this.ctx.fillStyle = '#777';
    this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.texture.generateMipmaps = false;
    this.texture.minFilter = THREE.LinearFilter;
    this.texture.magFilter = THREE.LinearFilter;
    this.slots = new Map(); // clé -> index de case
    this.pending = 0;
    this.onReady = null;
  }

  slotXY(slot) { return [slot % COLS, Math.floor(slot / COLS)]; }

  // assigne une case à chaque entité ayant un drapeau
  load(entities) {
    this.entitiesRef = entities;
    let slot = 0;
    const jobs = [];
    for (const e of entities) {
      if (e.kind === 'neutral') continue;
      if (slot >= COLS * ROWS) break;
      const s = slot++;
      this.slots.set(e.index, s);
      jobs.push([e, s]);
    }
    this.nextSlot = slot;
    this.pending = jobs.length;
    return Promise.all(jobs.map(([e, s]) => this._draw(e, s)));
  }

  redrawAll() {
    if (!this.entitiesRef) return;
    for (const e of this.entitiesRef) if (this.slots.has(e.index)) this._draw(e, this.slots.get(e.index));
  }

  ensure(entity) {
    if (this.slots.has(entity.index)) { this._draw(entity, this.slots.get(entity.index)); return; }
    const s = this.nextSlot++;
    this.slots.set(entity.index, s);
    this._draw(entity, s);
  }

  _draw(e, slot) {
    const [cx, cy] = this.slotXY(slot);
    const x = cx * SLOT_W, y = cy * SLOT_H;
    return new Promise((resolve) => {
      if (e.kind === 'custom') {
        drawCustomFlag(this.ctx, e.flag, x, y, SLOT_W, SLOT_H);
        this.texture.needsUpdate = true;
        resolve();
        return;
      }
      const img = new Image();
      img.onload = () => {
        this.ctx.drawImage(img, x, y, SLOT_W, SLOT_H);
        this.texture.needsUpdate = true;
        resolve();
      };
      img.onerror = () => {
        this.ctx.fillStyle = e.color || '#888';
        this.ctx.fillRect(x, y, SLOT_W, SLOT_H);
        this.texture.needsUpdate = true;
        resolve();
      };
      img.src = flagUrlFor(e);
    });
  }

  // petite image (canvas) d'un drapeau pour les marqueurs
  slotOf(index) { return this.slots.has(index) ? this.slots.get(index) : -1; }
}
