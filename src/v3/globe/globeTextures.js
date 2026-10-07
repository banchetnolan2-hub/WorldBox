// GLOBE — textures générées : masque terre/mer (côtes nettes), eaux peu profondes, bruit de relief,
// et textures de territoire (propriétaire de chaque parcelle, mises à jour parcelle par parcelle).
import * as THREE from 'three';
import { feature, mesh } from 'topojson-client';
import world from 'world-atlas/countries-50m.json';

let cachedFeatures = null;
export function worldFeatures() {
  if (!cachedFeatures) {
    cachedFeatures = {
      countries: feature(world, world.objects.countries).features,
      borders: mesh(world, world.objects.countries, (a, b) => a !== b),
      coasts: mesh(world, world.objects.countries, (a, b) => a === b),
    };
  }
  return cachedFeatures;
}

function unwrapRing(r) {
  const out = [];
  let offset = 0;
  for (let k = 0; k < r.length; k++) {
    const [x, y] = r[k];
    if (k > 0) {
      const prev = r[k - 1][0];
      if (x - prev > 180) offset -= 360;
      else if (prev - x > 180) offset += 360;
    }
    out.push([x + offset, y]);
  }
  return out;
}

// Bruit fractal répétable (relief et vagues)
export function buildNoiseTexture(N = 256) {
  const data = new Uint8Array(N * N * 4);
  const rnd = (x, y, s) => {
    let h = (x * 374761393 + y * 668265263 + s * 982451653) >>> 0;
    h = Math.imul(h ^ (h >>> 13), 1274126177) >>> 0;
    return ((h ^ (h >>> 16)) & 0xffff) / 65535;
  };
  const octave = (x, y, period, s) => {
    const x0 = Math.floor(x / period), y0 = Math.floor(y / period);
    const fx = x / period - x0, fy = y / period - y0;
    const P = N / period;
    const v = (i, j) => rnd(((i % P) + P) % P, ((j % P) + P) % P, s);
    const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
    const a = v(x0, y0), b = v(x0 + 1, y0), c = v(x0, y0 + 1), d = v(x0 + 1, y0 + 1);
    return (a + (b - a) * sx) + ((c + (d - c) * sx) - (a + (b - a) * sx)) * sy;
  };
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      const k = (y * N + x) * 4;
      for (let ch = 0; ch < 4; ch++) {
        let v = 0, amp = 0.5, tot = 0;
        for (const period of [64, 32, 16, 8, 4]) { v += octave(x, y, period, ch + 1) * amp; tot += amp; amp *= 0.55; }
        data[k + ch] = Math.round((v / tot) * 255);
      }
    }
  }
  const tex = new THREE.DataTexture(data, N, N, THREE.RGBAFormat, THREE.UnsignedByteType);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.generateMipmaps = true;
  tex.needsUpdate = true;
  return tex;
}

// Textures de territoire : A = (propriétaire, précédent propriétaire), B = (instant du changement, zone contestée)
export class TerritoryTextures {
  constructor(grid) {
    this.grid = grid;
    const { W, H } = grid;
    this.W = W; this.H = H;
    this.a = new Uint8Array(W * H * 4);
    this.b = new Uint8Array(W * H * 4);
    this.texA = new THREE.DataTexture(this.a, W, H, THREE.RGBAFormat, THREE.UnsignedByteType);
    this.texB = new THREE.DataTexture(this.b, W, H, THREE.RGBAFormat, THREE.UnsignedByteType);
    for (const t of [this.texA, this.texB]) {
      t.minFilter = THREE.NearestFilter; t.magFilter = THREE.NearestFilter;
      t.generateMipmaps = false; t.needsUpdate = true;
    }
    // pixels « débordants » : cases de mer près des côtes, colorées comme la parcelle la plus proche
    const src = [], pix = [];
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const p = y * W + x;
        if (grid.indexAt[p] >= 0) continue;
        let best = -1, bd = 99;
        for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
          const ny = y + dy; if (ny < 0 || ny >= H) continue;
          const j = grid.indexAt[ny * W + ((x + dx + W) % W)];
          if (j < 0) continue;
          const d = dx * dx + dy * dy;
          if (d < bd) { bd = d; best = j; }
        }
        if (best >= 0) { src.push(best); pix.push(p); }
      }
    }
    const n = grid.n;
    this.bStart = new Int32Array(n + 1);
    for (const s of src) this.bStart[s + 1]++;
    for (let i = 0; i < n; i++) this.bStart[i + 1] += this.bStart[i];
    this.bList = new Int32Array(pix.length);
    const fill = this.bStart.slice(0, n);
    for (let k = 0; k < pix.length; k++) this.bList[fill[src[k]]++] = pix[k];
    // mer : propriétaire « aucun »
    for (let p = 0; p < W * H; p++) { this.a[p * 4] = 255; this.a[p * 4 + 1] = 255; this.a[p * 4 + 2] = 255; this.a[p * 4 + 3] = 255; }
    this.dirty = new Set();
    this.full = true;
    this.contested = new Uint8Array(n);
    // état par parcelle pour la géométrie des territoires : propriétaire, occupé, pays d'origine à recalculer
    this.cellOwner = new Int32Array(n).fill(-1);
    this.cellOcc = new Uint8Array(n);
    this.geoDirty = new Set();
    this.geoAll = true;
    this.changedCells = new Set();        // parcelles modifiées depuis le dernier état géométrique
    this.cellTime = new Float32Array(n);  // instant (temps du rendu) du dernier changement de chaque parcelle
  }
  _mirror(i, owner, occ, time = -1) { const oc = occ ? 1 : 0; if (this.cellOwner[i] !== owner || this.cellOcc[i] !== oc) { this.geoDirty.add(this.grid.origin[i]); this.changedCells.add(i); if (time >= 0) this.cellTime[i] = time; this.cellOwner[i] = owner; this.cellOcc[i] = oc; } }
  keyOf(i) { const o = this.cellOwner[i]; return o < 0 || o >= 65534 ? -1 : o * 2 + this.cellOcc[i]; }

  // A = (propriétaire, ancien propriétaire) ; B = (instant du changement, contesté, indicateurs)
  // indicateurs : 1 = différent de la frontière d'origine, 2 = parcelle terrestre (sinon : débordement côtier),
  // 4 = territoire occupé (pas encore officiel), 8 = vient d'être intégré officiellement (transition)
  _writePix(p, i, owner, prev, t16, isLand, occ = false, justOfficial = false) {
    const k = p * 4;
    const o = owner === 65535 ? 65534 : owner, pr = prev === 65535 ? 65534 : prev;
    this.a[k] = o & 255; this.a[k + 1] = o >> 8;
    this.a[k + 2] = pr & 255; this.a[k + 3] = pr >> 8;
    this.b[k] = t16 & 255; this.b[k + 1] = t16 >> 8;
    const org = this.grid.origin[i];
    this.b[k + 3] = ((owner !== org || prev !== org) ? 1 : 0) + (isLand ? 2 : 0) + (occ ? 4 : 0) + (justOfficial ? 8 : 0);
  }

  _cellPixels(i, fn) {
    const p = this.grid.pos[i];
    if (p >= 0) fn(p, true);
    for (let k = this.bStart[i]; k < this.bStart[i + 1]; k++) fn(this.bList[k], false);
  }

  setAll(owner, occupied = null) {
    const n = this.grid.n;
    for (let i = 0; i < n; i++) {
      const o = owner[i];
      const oc = occupied ? occupied[i] === 1 : false;
      this._mirror(i, o, oc);
      this._cellPixels(i, (p, land) => { this._writePix(p, i, o, o, 0, land, oc); this.b[p * 4 + 2] = 0; });
    }
    this.contested.fill(0);
    this.full = true;
    this.geoAll = true;
  }

  // changement de propriétaire (transition animée dans le shader : la frontière glisse)
  setOwner(i, owner, prev, time, occ = false) {
    const t16 = Math.round(time * 20) & 0xffff;
    this._mirror(i, owner, occ, time);
    this._cellPixels(i, (p, land) => { this._writePix(p, i, owner, prev, t16, land, occ); this.dirty.add(p); });
  }

  // zone occupée qui devient officiellement intégrée : transition visible (couleur, frontière)
  setOfficial(i, time) {
    const t16 = Math.round(time * 20) & 0xffff;
    this._cellPixels(i, (p, land) => {
      const k = p * 4;
      const owner = this.a[k] | (this.a[k + 1] << 8);
      const o = owner === 65534 ? 65535 : owner;
      this._writePix(p, i, o, o, t16, land, false, true);
      this.dirty.add(p);
    });
    this._mirror(i, this.cellOwner[i], false, time);
  }

  setContested(i, on) {
    if (this.contested[i] === (on ? 1 : 0)) return;
    this.contested[i] = on ? 1 : 0;
    this._cellPixels(i, (p) => { this.b[p * 4 + 2] = on ? 255 : 0; this.dirty.add(p); });
  }

  dispose() { this.texA.dispose(); this.texB.dispose(); }

  upload() {
    if (this.full || this.dirty.size > 6000) {
      this.texA.updateRanges.length = 0; this.texB.updateRanges.length = 0;
      this.texA.needsUpdate = true; this.texB.needsUpdate = true;
      this.full = false; this.dirty.clear();
      return;
    }
    if (!this.dirty.size) return;
    for (const p of this.dirty) { this.texA.addUpdateRange(p * 4, 4); this.texB.addUpdateRange(p * 4, 4); }
    this.texA.needsUpdate = true; this.texB.needsUpdate = true;
    this.dirty.clear();
  }
}

export function lineGeometryFromMesh(m, radius = 1.0015) {
  const pos = [];
  const toXYZ = (lon, lat) => {
    const phi = lat * Math.PI / 180, lam = lon * Math.PI / 180;
    return [radius * Math.cos(phi) * Math.sin(lam), radius * Math.sin(phi), radius * Math.cos(phi) * Math.cos(lam)];
  };
  for (const line of m.coordinates) {
    for (let k = 1; k < line.length; k++) {
      const [a0, a1] = line[k - 1], [b0, b1] = line[k];
      if (Math.abs(a0 - b0) > 180) continue;
      pos.push(...toXYZ(a0, a1), ...toXYZ(b0, b1));
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  return g;
}
