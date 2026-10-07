// MAP — rendu Canvas de la carte (fond mis en cache, territoires, frontières, marqueurs)
import { TerritoryLayer } from './territoryLayer.js';
import { Effects } from '../animations/effects.js';
import { drawFlagMarker, drawCapital } from '../animations/markers.js';
import { flagImage } from '../countries/flagImages.js';

const FONT = '"Bahnschrift", "Segoe UI", "Inter", system-ui, sans-serif';

export class MapRenderer {
  constructor(canvas, camera) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.camera = camera;
    this.dpr = 1;
    this.scene = null;
    this.sim = null;
    this.layer = null;
    this.colors = ['#888', '#888'];
    this.effects = new Effects();
    this.worldBg = null;
    this.crisp = null;
    this.bgKey = '';
    this.bgChangedAt = 0;
    this.frontPath = null;
    this.frontDirty = true;
    this.frontBuiltAt = -1;
    this.labelPos = [null, null];
    this.labelTarget = [null, null];
    this.labelUpdatedAt = -1;
    this.selected = -1;
    this.showMarkers = true;
    this.noise = this._makeNoise();
    this.stripes = this._makeStripes();
    this.lastFrameMs = 0;
  }

  _makeNoise() {
    const c = document.createElement('canvas');
    c.width = c.height = 256;
    const x = c.getContext('2d');
    const img = x.createImageData(256, 256);
    let seed = 1234567;
    for (let k = 0; k < img.data.length; k += 4) {
      seed = (seed * 1103515245 + 12345) >>> 0;
      const v = (seed >>> 24);
      img.data[k] = img.data[k + 1] = img.data[k + 2] = v;
      img.data[k + 3] = 10;
    }
    x.putImageData(img, 0, 0);
    return this.ctx.createPattern(c, 'repeat');
  }

  _makeStripes() {
    const c = document.createElement('canvas');
    c.width = c.height = 10;
    const x = c.getContext('2d');
    x.strokeStyle = 'rgba(255,255,255,0.55)';
    x.lineWidth = 2.2;
    x.beginPath();
    x.moveTo(-2, 12); x.lineTo(12, -2);
    x.moveTo(-2, 2); x.lineTo(2, -2);
    x.moveTo(8, 12); x.lineTo(12, 8);
    x.stroke();
    return this.ctx.createPattern(c, 'repeat');
  }

  resize(w, h, dpr) {
    this.dpr = dpr;
    this.canvas.width = Math.round(w * dpr);
    this.canvas.height = Math.round(h * dpr);
    this.canvas.style.width = w + 'px';
    this.canvas.style.height = h + 'px';
    this.camera.setViewport(w, h);
    this.bgKey = '';
    this.seaGradH = -1;
    this.crisp = null;
  }

  setScene(scene, colors) {
    this.scene = scene;
    this.colors = colors;
    this.layer = new TerritoryLayer(scene, colors);
    this.sim = null;
    this.frontDirty = true;
    this.labelPos = [null, null];
    this.bgKey = '';
    this.worldBg = scene.worldBg || null;
    this.crisp = null;
    this.selected = -1;
    this.effects.clear();
    this.flags = scene.countries.map((c) => flagImage(c));
    if (!this.worldBg) this._buildWorldBackground();
    this._updateLabels(0, true);
  }

  attachSim(sim) {
    this.sim = sim;
    this.effects.clear();
    if (this.layer) this.layer.syncAll(sim ? sim.owner : this.scene.grid.origin);
    this.frontDirty = true;
    this._updateLabels(0, true);
  }

  // captures issues de la simulation -> pixels + effets
  applyCaptures(captures, now) {
    if (!captures.length || !this.layer) return;
    const g = this.scene.grid;
    for (const c of captures) {
      this.layer.setOwner(c.i, c.by, now);
      this.effects.capture(g.cx[c.i], g.cy[c.i], this.colors[c.by], now);
    }
    this.frontDirty = true;
  }

  pulseAt(x, y, color, now) { this.effects.capture(x, y, color, now, true); }

  ownerArray() { return this.sim ? this.sim.owner : this.scene.grid.origin; }

  // ---------- coordonnées -> cellule ----------
  cellAtScreen(sx, sy) {
    if (!this.scene) return -1;
    const [wx, wy] = this.camera.screenToWorld(sx, sy);
    const g = this.scene.grid;
    const x = Math.floor((wx - g.originX) / g.cellSize), y = Math.floor((wy - g.originY) / g.cellSize);
    if (x < 0 || y < 0 || x >= g.gw || y >= g.gh) return -1;
    return g.indexAt[y * g.gw + x];
  }

  neutralAtScreen(sx, sy) {
    if (!this.scene) return null;
    const [wx, wy] = this.camera.screenToWorld(sx, sy);
    // étiquette la plus proche si le point est sur une terre neutre
    if (!this.ctx.isPointInPath(this.scene.neutral, wx, wy)) return null;
    let best = null, bestD = Infinity;
    for (const l of this.scene.labels) {
      const d = (l.x - wx) ** 2 + (l.y - wy) ** 2;
      if (d < bestD) { bestD = d; best = l; }
    }
    return best;
  }

  // ---------- fond ----------
  // Le fond (mer, terres neutres, halos côtiers, frontières) est dessiné UNE fois par scène
  // dans une grande image en coordonnées monde, puis simplement recopiée à chaque image.
  // Quand la caméra est immobile et zoomée, une version nette est recalculée une seule fois.
  _buildWorldBackground() {
    const scene = this.scene;
    const R = { x0: -900, y0: -560, x1: 2500, y1: 1560 };
    const maxPx = 4096;
    const scale = Math.min(1.25, maxPx / (R.x1 - R.x0), maxPx / (R.y1 - R.y0));
    const c = document.createElement('canvas');
    c.width = Math.ceil((R.x1 - R.x0) * scale);
    c.height = Math.ceil((R.y1 - R.y0) * scale);
    const ctx = c.getContext('2d');
    ctx.setTransform(scale, 0, 0, scale, -R.x0 * scale, -R.y0 * scale);
    ctx.fillStyle = '#0f2238';
    ctx.fill(scene.sphere);
    ctx.strokeStyle = 'rgba(120,170,220,0.07)';
    ctx.lineWidth = 1 / scale;
    ctx.stroke(scene.graticule);
    ctx.lineJoin = 'round';
    ctx.strokeStyle = 'rgba(70,140,200,0.07)';
    ctx.lineWidth = 12;
    ctx.stroke(scene.neutral);
    ctx.strokeStyle = 'rgba(90,160,215,0.10)';
    ctx.lineWidth = 5;
    ctx.stroke(scene.neutral);
    ctx.fillStyle = '#2a3243';
    ctx.fill(scene.neutral);
    ctx.strokeStyle = 'rgba(160,175,200,0.28)';
    ctx.lineWidth = 0.9 / scale;
    ctx.stroke(scene.borders);
    this.worldBg = { canvas: c, R, scale };
    scene.worldBg = this.worldBg;
    this.crisp = null;
  }

  _renderBackground(now) {
    const ctx = this.ctx;
    const cam = this.camera;
    const W = this.canvas.width, H = this.canvas.height;
    const dpr = this.dpr;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    if (!this.seaGrad || this.seaGradH !== H) {
      this.seaGrad = ctx.createLinearGradient(0, 0, 0, H);
      this.seaGrad.addColorStop(0, '#0b1a2d');
      this.seaGrad.addColorStop(1, '#0a1322');
      this.vignette = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.35, W / 2, H / 2, Math.max(W, H) * 0.75);
      this.vignette.addColorStop(0, 'rgba(0,0,0,0)');
      this.vignette.addColorStop(1, 'rgba(0,0,0,0.45)');
      this.seaGradH = H;
    }
    ctx.fillStyle = this.seaGrad;
    ctx.fillRect(0, 0, W, H);
    if (!this.scene) return;
    if (!this.worldBg) this._buildWorldBackground();

    const z = cam.zoom * dpr;
    const tx = (-cam.x * cam.zoom + cam.viewW / 2) * dpr, ty = (-cam.y * cam.zoom + cam.viewH / 2) * dpr;
    const key = [cam.x.toFixed(2), cam.y.toFixed(2), cam.zoom.toFixed(4), W, H].join('|');
    if (key !== this.bgKey) { this.bgKey = key; this.bgChangedAt = now; }
    const wb = this.worldBg;
    ctx.setTransform(z, 0, 0, z, tx, ty);
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(wb.canvas, wb.R.x0, wb.R.y0, wb.canvas.width / wb.scale, wb.canvas.height / wb.scale);

    // version nette quand on est zoomé et que la caméra ne bouge plus
    const needsCrisp = z > wb.scale * 1.15;
    if (needsCrisp && now - this.bgChangedAt > 0.3) {
      if (!this.crisp || this.crisp.key !== key) {
        const c = this.crisp ? this.crisp.canvas : document.createElement('canvas');
        c.width = W; c.height = H;
        const x = c.getContext('2d');
        x.setTransform(z, 0, 0, z, tx, ty);
        x.fillStyle = '#2a3243';
        x.fill(this.scene.neutral);
        x.strokeStyle = 'rgba(160,175,200,0.28)';
        x.lineWidth = 0.9 / cam.zoom;
        x.stroke(this.scene.borders);
        this.crisp = { canvas: c, key };
      }
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    if (needsCrisp && this.crisp && this.crisp.key === key) ctx.drawImage(this.crisp.canvas, 0, 0);

    // grain léger + vignette
    ctx.fillStyle = this.noise;
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = this.vignette;
    ctx.fillRect(0, 0, W, H);

    // noms des pays neutres
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = 'rgba(190,200,220,0.42)';
    for (const l of this.scene.labels) {
      const areaPx = l.area * cam.zoom * cam.zoom;
      if (areaPx < 2500) continue;
      const [sx, sy] = cam.worldToScreen(l.x, l.y);
      if (sx < -100 || sy < -30 || sx > cam.viewW + 100 || sy > cam.viewH + 30) continue;
      const size = Math.round(Math.max(9, Math.min(15, Math.sqrt(areaPx) / 14)));
      ctx.font = `600 ${size}px ${FONT}`;
      ctx.fillText(l.upper || (l.upper = l.name.toUpperCase()), sx, sy);
    }
  }

  // ---------- frontière mobile ----------
  _buildFront() {
    const g = this.scene.grid;
    const owner = this.ownerArray();
    const s = g.cellSize;
    const p = new Path2D();
    for (let i = 0; i < g.n; i++) {
      const o = owner[i];
      const x = g.originX + g.gx[i] * s, y = g.originY + g.gy[i] * s;
      const r = g.neighbors[i * 8 + 0];
      if (r >= 0 && owner[r] !== o) { p.moveTo(x + s, y); p.lineTo(x + s, y + s); }
      const d = g.neighbors[i * 8 + 2];
      if (d >= 0 && owner[d] !== o) { p.moveTo(x, y + s); p.lineTo(x + s, y + s); }
    }
    this.frontPath = p;
    this.frontDirty = false;
  }

  _contestPath(simTime) {
    const sim = this.sim;
    if (!sim) return null;
    const g = this.scene.grid;
    const s = g.cellSize;
    let p = null;
    for (let i = 0; i < g.n; i++) {
      if (sim.contest[i] > simTime) {
        if (!p) p = new Path2D();
        p.rect(g.originX + g.gx[i] * s, g.originY + g.gy[i] * s, s, s);
      }
    }
    return p;
  }

  // position des noms : centre de gravité des cellules possédées
  _updateLabels(now, instant = false) {
    if (!this.scene) return;
    if (!instant && now - this.labelUpdatedAt < 0.5) return;
    this.labelUpdatedAt = now;
    const g = this.scene.grid;
    const owner = this.ownerArray();
    for (let side = 0; side < 2; side++) {
      let sx = 0, sy = 0, c = 0;
      for (let i = 0; i < g.n; i++) if (owner[i] === side) { sx += g.cx[i]; sy += g.cy[i]; c++; }
      if (!c) { this.labelTarget[side] = null; continue; }
      const mx = sx / c, my = sy / c;
      // cellule possédée la plus proche du centre (évite un nom en pleine mer)
      let best = -1, bestD = Infinity;
      for (let i = 0; i < g.n; i++) {
        if (owner[i] !== side) continue;
        const d = (g.cx[i] - mx) ** 2 + (g.cy[i] - my) ** 2;
        if (d < bestD) { bestD = d; best = i; }
      }
      this.labelTarget[side] = { x: g.cx[best], y: g.cy[best], cells: c };
      if (instant || !this.labelPos[side]) this.labelPos[side] = { ...this.labelTarget[side] };
    }
  }

  // ---------- image complète ----------
  render(now, alpha, dt) {
    const t0 = performance.now();
    const ctx = this.ctx;
    const cam = this.camera;
    const dpr = this.dpr;
    this._renderBackground(now);
    if (!this.scene) return;
    const scene = this.scene;
    const g = scene.grid;
    const simTime = this.sim ? this.sim.time : 0;

    this.layer.update(now);
    if (this.frontDirty && now - this.frontBuiltAt > 0.06) { this._buildFront(); this.frontBuiltAt = now; }

    const z = cam.zoom * dpr;
    ctx.setTransform(z, 0, 0, z, (-cam.x * cam.zoom + cam.viewW / 2) * dpr, (-cam.y * cam.zoom + cam.viewH / 2) * dpr);

    // lueur sous les deux pays
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,0.55)';
    ctx.shadowBlur = 18 * dpr;
    ctx.fillStyle = '#1b2230';
    ctx.fill(scene.landAB);
    ctx.restore();

    // territoires (découpés par la vraie côte)
    ctx.save();
    ctx.clip(scene.landAB);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(this.layer.canvas, g.originX, g.originY, g.gw * g.cellSize, g.gh * g.cellSize);
    // zones contestées : hachures
    const contest = this._contestPath(simTime);
    if (contest) {
      const m = new DOMMatrix().scale(1 / z, 1 / z);
      this.stripes.setTransform(m);
      ctx.globalAlpha = 0.55;
      ctx.fillStyle = this.stripes;
      ctx.fill(contest);
      ctx.globalAlpha = 1;
    }
    // grain
    ctx.restore();

    // frontière d'origine (pointillés discrets)
    ctx.save();
    ctx.setLineDash([4 / cam.zoom, 4 / cam.zoom]);
    ctx.strokeStyle = 'rgba(255,255,255,0.28)';
    ctx.lineWidth = 1.1 / cam.zoom;
    ctx.stroke(scene.originBorder);
    ctx.restore();

    // ligne de front (lueur + trait)
    if (this.frontPath) {
      ctx.save();
      ctx.clip(scene.landAB);
      ctx.lineCap = 'round';
      ctx.strokeStyle = 'rgba(255,255,255,0.18)';
      ctx.lineWidth = 5 / cam.zoom;
      ctx.stroke(this.frontPath);
      ctx.strokeStyle = 'rgba(255,255,255,0.92)';
      ctx.lineWidth = 1.5 / cam.zoom;
      ctx.stroke(this.frontPath);
      ctx.restore();
    }

    // côtes des deux pays
    ctx.strokeStyle = 'rgba(230,240,255,0.55)';
    ctx.lineWidth = 1.1 / cam.zoom;
    ctx.stroke(scene.landAB);

    // cellule sélectionnée
    if (this.selected >= 0) {
      const s = g.cellSize;
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 2 / cam.zoom;
      ctx.strokeRect(g.originX + g.gx[this.selected] * s, g.originY + g.gy[this.selected] * s, s, s);
    }

    // ---- éléments en coordonnées écran ----
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    // zone régionale instable
    if (this.sim && this.sim.regional) {
      const r = this.sim.regional;
      const [sx, sy] = cam.worldToScreen(r.x, r.y);
      const rad = r.r * cam.zoom;
      ctx.save();
      ctx.strokeStyle = 'rgba(255,214,90,0.9)';
      ctx.lineWidth = 2;
      ctx.setLineDash([8, 6]);
      ctx.lineDashOffset = -now * 30;
      ctx.beginPath(); ctx.arc(sx, sy, rad, 0, Math.PI * 2); ctx.stroke();
      ctx.setLineDash([]);
      ctx.globalAlpha = 0.12 + 0.06 * Math.sin(now * 4);
      ctx.fillStyle = '#ffd65a';
      ctx.fill();
      ctx.globalAlpha = 1;
      ctx.font = `700 11px ${FONT}`;
      ctx.textAlign = 'center';
      ctx.fillStyle = '#ffd65a';
      ctx.fillText('ZONE INSTABLE', sx, sy - rad - 8);
      ctx.restore();
    }

    this.effects.beginFrame(dt);
    this.effects.draw(ctx, cam, now, g.cellSize);

    // capitales
    const owner = this.ownerArray();
    for (let side = 0; side < 2; side++) {
      const ci = g.capitals[side];
      if (ci < 0) continue;
      const [sx, sy] = cam.worldToScreen(g.cx[ci], g.cy[ci]);
      const o = owner[ci];
      drawCapital(ctx, sx, sy, this.colors[o], now, Math.min(1.6, 1.1 + (cam.zoom / cam.fitZoom - 1) * 0.1), o !== side);
    }

    // marqueurs
    if (this.sim && this.showMarkers) {
      const scale = Math.max(0.75, Math.min(1.35, 0.8 + (cam.zoom / cam.fitZoom - 1) * 0.12));
      const all = [];
      for (const side of this.sim.sides) for (const u of side.units) all.push(u);
      all.sort((a, b) => a.y - b.y);
      for (const u of all) {
        const x = u.px + (u.x - u.px) * alpha, y = u.py + (u.y - u.py) * alpha;
        const [sx, sy] = cam.worldToScreen(x, y);
        if (sx < -30 || sy < -30 || sx > cam.viewW + 30 || sy > cam.viewH + 40) continue;
        const bornAge = this.sim.time - u.bornAt;
        const hot = Math.max(0, 1 - (this.sim.time - u.lastWinAt) / 0.6);
        drawFlagMarker(ctx, sx, sy, {
          color: this.colors[u.side], flag: this.flags[u.side], now, scale,
          seed: u.id * 1.7, engaged: u.engaged, bornAge, hot,
        });
      }
    }

    // noms des deux pays
    this._updateLabels(now);
    const k = 1 - Math.exp(-dt * 3);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (let side = 0; side < 2; side++) {
      const tgt = this.labelTarget[side];
      if (!tgt) continue;
      const p = this.labelPos[side] || (this.labelPos[side] = { ...tgt });
      p.x += (tgt.x - p.x) * k; p.y += (tgt.y - p.y) * k;
      const [sx, sy] = cam.worldToScreen(p.x, p.y);
      const areaPx = tgt.cells * (g.cellSize * cam.zoom) ** 2;
      const size = Math.max(12, Math.min(34, Math.sqrt(areaPx) / 9));
      const name = scene.countries[side].name.toUpperCase();
      ctx.font = `800 ${size}px ${FONT}`;
      ctx.lineJoin = 'round';
      ctx.lineWidth = Math.max(3, size / 5);
      ctx.strokeStyle = 'rgba(8,12,20,0.75)';
      ctx.strokeText(name, sx, sy);
      ctx.fillStyle = '#fff';
      ctx.fillText(name, sx, sy);
    }

    this.lastFrameMs = performance.now() - t0;
  }
}
