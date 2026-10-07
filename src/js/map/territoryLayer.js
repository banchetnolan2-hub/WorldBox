// MAP — couche territoriale : 1 pixel = 1 cellule, mise à jour cellule par cellule
// (on ne redessine jamais toute la carte : seuls les pixels modifiés changent)
import { hexToRgb } from '../countries/countries.js';

const FLASH_DUR = 1.1;

export class TerritoryLayer {
  constructor(scene, colors) {
    const g = scene.grid;
    this.scene = scene;
    this.grid = g;
    this.canvas = document.createElement('canvas');
    this.canvas.width = g.gw; this.canvas.height = g.gh;
    this.ctx = this.canvas.getContext('2d');
    this.image = this.ctx.createImageData(g.gw, g.gh);
    this.buf = new Uint32Array(this.image.data.buffer);
    this.rgb = colors.map(hexToRgb);
    this.flashing = new Map(); // cellule -> instant de capture
    this.dirty = true;
    // texture : légère variation de luminosité par cellule (effet « parcelles »)
    this.shade = new Float32Array(g.n);
    for (let i = 0; i < g.n; i++) {
      let h = (g.gx[i] * 374761393 + g.gy[i] * 668265263) >>> 0;
      h = Math.imul(h ^ (h >>> 13), 1274126177) >>> 0;
      this.shade[i] = 0.95 + ((h & 1023) / 1023) * 0.09;
    }
    this.owner = Uint8Array.from(g.origin);
    for (let i = 0; i < g.n; i++) this._write(i, 0);
  }

  _color(i, flash) {
    const o = this.owner[i];
    const [r0, g0, b0] = this.rgb[o];
    let k = this.shade[i];
    let r = r0 * k, g = g0 * k, b = b0 * k;
    if (this.grid.origin[i] !== o) {
      // territoire gagné sur l'adversaire : teinte légèrement éclaircie
      r = r + (255 - r) * 0.16; g = g + (255 - g) * 0.16; b = b + (255 - b) * 0.16;
    }
    if (flash > 0) {
      r = r + (255 - r) * flash; g = g + (255 - g) * flash; b = b + (255 - b) * flash;
    }
    r = r > 255 ? 255 : r | 0; g = g > 255 ? 255 : g | 0; b = b > 255 ? 255 : b | 0;
    return (255 << 24) | (b << 16) | (g << 8) | r;
  }

  _write(i, flash) {
    const col = this._color(i, flash);
    const g = this.grid;
    this.buf[g.gy[i] * g.gw + g.gx[i]] = col;
    const s = this.scene.bleedStart;
    for (let k = s[i]; k < s[i + 1]; k++) this.buf[this.scene.bleedList[k]] = col;
    this.dirty = true;
  }

  syncAll(owner) {
    this.owner.set(owner);
    this.flashing.clear();
    for (let i = 0; i < this.grid.n; i++) this._write(i, 0);
  }

  setOwner(i, owner, now) {
    this.owner[i] = owner;
    this.flashing.set(i, now);
    this._write(i, 0.65);
  }

  update(now) {
    for (const [i, t0] of this.flashing) {
      const age = (now - t0) / FLASH_DUR;
      if (age >= 1) { this.flashing.delete(i); this._write(i, 0); }
      else this._write(i, 0.65 * (1 - age) * (1 - age));
    }
    if (this.dirty) {
      this.ctx.putImageData(this.image, 0, 0);
      this.dirty = false;
    }
  }
}
