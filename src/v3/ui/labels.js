// UI — noms des pays et capitales sur le globe (calque HTML).
// Placement intelligent : le nom se place au « pôle d'inaccessibilité » du territoire (le point le plus
// éloigné de ses frontières et des côtes), sur sa plus grande partie ; la taille du texte suit la taille
// apparente du pays ; les pays trop petits reçoivent un petit repère + nom ; les chevauchements sont évités.
// Les positions sont recalculées lorsque les frontières changent (avec un glissement doux), en cache sinon.
import { icon } from './icons.js';
import { regionResources } from '../world/details.js';
const DEG = 180 / Math.PI;
const RES_ICON = { agri: 'sprout', wood: 'trees', mine: 'mountain', oil: 'droplets', fish: 'waves', industry: 'factory' };
const RES_NAME = { agri: 'Agriculture', wood: 'Forêts', mine: 'Minerais', oil: 'Hydrocarbures', fish: 'Pêche', industry: 'Industrie' };

export class Labels {
  constructor(root, app) {
    this.root = root;
    this.app = app;
    this.pool = [];
    this.capPool = [];
    this.cityPool = [];
    this.regPool = [];
    this.anchors = new Map(); // entité -> { x, y, z, r, cells, inner, cap }
    this.shown = new Map();   // entité -> position affichée (glissement doux)
    this.computedAt = -1;
    this.dirty = true;
    this.enabled = true;
    this.capitals = true;
    this.lastVersion = -1;
  }

  invalidate() { this.dirty = true; }

  // pôle d'inaccessibilité de chaque pays (distance aux frontières / côtes, en parcelles)
  compute(owner, only = null) {
    const g = this.app.grid;
    const n = g.nGrid;
    const dist = this._dist && this._dist.length === n ? this._dist : (this._dist = new Int16Array(n));
    const queue = this._queue && this._queue.length === n ? this._queue : (this._queue = new Int32Array(n));
    let qh = 0, qt = 0;
    for (let i = 0; i < n; i++) {
      const o = owner[i];
      let border = g.coastal[i] === 1;
      if (!border) for (let k = g.nbrStart[i]; k < g.nbrStart[i + 1]; k++) { const j = g.nbr[k]; if (j >= n || owner[j] !== o) { border = true; break; } }
      if (border) { dist[i] = 1; queue[qt++] = i; } else dist[i] = 0;
    }
    while (qh < qt) {
      const i = queue[qh++];
      const d = dist[i] + 1;
      for (let k = g.nbrStart[i]; k < g.nbrStart[i + 1]; k++) {
        const j = g.nbr[k];
        if (j < n && dist[j] === 0) { dist[j] = d; queue[qt++] = j; }
      }
    }
    // par pays : la plus grande partie (composante connexe du territoire), puis son point le plus intérieur
    const comp = this._comp && this._comp.length === n ? this._comp : (this._comp = new Int32Array(n));
    comp.fill(-1);
    const best = new Map(); // e -> { size, cell, d }
    const totals = new Map();
    const stack = [];
    for (let s = 0; s < n; s++) {
      const e = owner[s];
      if (comp[s] >= 0 || e === 65535 || (only && !only.has(e))) continue;
      comp[s] = s; stack.push(s);
      let size = 0, bc = s, bd = -1, sx = 0, sy = 0, sz = 0;
      const members = [];
      while (stack.length) {
        const a = stack.pop(); size++; members.push(a);
        sx += g.xyz[a * 3]; sy += g.xyz[a * 3 + 1]; sz += g.xyz[a * 3 + 2];
        for (let k = g.nbrStart[a]; k < g.nbrStart[a + 1]; k++) {
          const b = g.nbr[k];
          if (b < n && comp[b] < 0 && owner[b] === e) { comp[b] = s; stack.push(b); }
        }
      }
      // à distance égale, le point le plus proche du centre de la partie
      const l = Math.hypot(sx, sy, sz) || 1; sx /= l; sy /= l; sz /= l;
      let bScore = -Infinity;
      for (const a of members) {
        const score = dist[a] * 1.0 + (g.xyz[a * 3] * sx + g.xyz[a * 3 + 1] * sy + g.xyz[a * 3 + 2] * sz) * 0.8;
        if (score > bScore) { bScore = score; bc = a; bd = dist[a]; }
      }
      totals.set(e, (totals.get(e) || 0) + size);
      const cur = best.get(e);
      if (!cur || size > cur.size) best.set(e, { size, cell: bc, d: bd });
    }
    // micro-pays (nœuds hors grille)
    for (let i = n; i < g.n; i++) {
      const e = owner[i];
      if (e === 65535 || best.has(e) || (only && !only.has(e))) continue;
      best.set(e, { size: 1, cell: i, d: 0 }); totals.set(e, 1);
    }
    const R = this.app.renderer.cellR;
    this.anchors.clear();
    for (const [e, b] of best) {
      const i = b.cell;
      this.anchors.set(e, { x: g.xyz[i * 3], y: g.xyz[i * 3 + 1], z: g.xyz[i * 3 + 2], r: R ? R[i] : 1, cells: totals.get(e), main: b.size, inner: Math.max(0.6, b.d - 0.5) });
    }
    this.computedAt = this.app.renderer.time;
    this.dirty = false;
  }

  _el(pool, cls, html) {
    const el = document.createElement('div');
    el.className = cls;
    el.innerHTML = html;
    this.root.appendChild(el);
    pool.push(el);
    return el;
  }

  update(owner, only, pctOf, dt = 0.016) {
    const r = this.app.renderer;
    if (!this.enabled) { this.root.style.display = 'none'; return; }
    this.root.style.display = '';
    const version = r.territoryVersion || 0;
    if (this.dirty || (version !== this.lastVersion && r.time - this.computedAt > 1.2) || r.time - this.computedAt > 6) {
      this.lastVersion = version;
      this.compute(owner, only);
    }
    const ents = this.app.entities();
    const cam = r.camera;
    const fovK = 2 * Math.tan((cam.fov * Math.PI) / 360) / r.viewH; // rayon par pixel à distance 1
    const items = [];
    const k = Math.min(1, dt * 4);
    for (const [e, a] of this.anchors) {
      const ent = ents[e];
      if (!ent || ent.kind === 'neutral' || ent.removed) continue;
      // glissement doux de l'ancre quand les frontières changent
      let s = this.shown.get(e);
      if (!s) { s = { x: a.x, y: a.y, z: a.z, r: a.r }; this.shown.set(e, s); }
      s.x += (a.x - s.x) * k; s.y += (a.y - s.y) * k; s.z += (a.z - s.z) * k; s.r += (a.r - s.r) * k;
      const p = r.project(s.x, s.y, s.z, s.r + 0.003);
      if (!p) continue;
      const dCam = Math.hypot(cam.position.x - s.x * s.r, cam.position.y - s.y * s.r, cam.position.z - s.z * s.r);
      const pxPerRad = 1 / (fovK * dCam);
      const innerPx = a.inner * 0.25 / DEG * pxPerRad;          // demi-largeur intérieure disponible
      const sizePx = Math.sqrt(a.main) * 0.25 / DEG * pxPerRad;  // taille apparente de la partie principale
      const important = only ? only.has(e) : false;
      items.push({ e, ent, p, innerPx, sizePx, cells: a.cells, important });
    }
    // priorité : participants, puis les plus grands pays
    items.sort((a, b) => (b.important - a.important) || (b.cells - a.cells));
    const placed = [];
    const overlaps = (rc) => placed.some((q) => !(rc[2] < q[0] || rc[0] > q[2] || rc[3] < q[1] || rc[1] > q[3]));
    let used = 0;
    const maxLabels = only && only.size > 30 ? 40 : 70;
    for (const it of items) {
      if (used >= maxLabels) break;
      const name = it.ent.name;
      // taille du texte selon la taille apparente du pays
      let fs = Math.max(10, Math.min(21, 7 + it.sizePx * 0.06));
      const textW = name.length * fs * 0.74 + 6;
      let mode = 'in';
      if (textW > it.innerPx * 2.6 + it.sizePx * 0.8) {
        // pays trop petit pour son nom : petit repère + nom (seulement s'il est assez visible ou important)
        if (!it.important && it.sizePx < 14) continue;
        mode = 'pin'; fs = it.important ? 11.5 : 10.5;
      }
      const w = mode === "pin" ? name.length * fs * 0.7 + 18 : textW;
      const h = fs * 1.35 + (pctOf && pctOf(it.e) ? fs * 0.95 : 0);
      const x0 = mode === 'pin' ? it.p[0] - 5 : it.p[0] - w / 2;
      const rect = [x0 - 3, it.p[1] - h / 2 - 2, x0 + w + 3, it.p[1] + h / 2 + 2];
      if (overlaps(rect)) continue;
      placed.push(rect);
      let el = this.pool[used];
      if (!el) el = this._el(this.pool, 'glabel', '<i class="pin"></i><span class="n"></span><span class="p"></span>');
      if (el._e !== it.e || el._name !== name) { el._e = it.e; el._name = name; el.querySelector('.n').textContent = name; el.classList.remove('show'); }
      if (el._c !== it.ent.color) { el._c = it.ent.color; el.style.setProperty('--c', it.ent.color); }
      const pct = pctOf ? pctOf(it.e) : null;
      const pe = el.querySelector('.p');
      if (pe._t !== pct) { pe._t = pct; pe.textContent = pct || ''; }
      el.classList.toggle('pinned', mode === 'pin');
      el.classList.toggle('imp', it.important);
      el.style.fontSize = fs.toFixed(1) + 'px';
      el.style.transform = mode === 'pin'
        ? `translate(${(it.p[0] - 4).toFixed(1)}px, ${it.p[1].toFixed(1)}px) translate(0, -50%)`
        : `translate(${it.p[0].toFixed(1)}px, ${it.p[1].toFixed(1)}px) translate(-50%, -50%)`;
      el.style.display = '';
      if (!el.classList.contains('show')) requestAnimationFrame(() => el.classList.add('show'));
      used++;
    }
    for (let q = used; q < this.pool.length; q++) { const el = this.pool[q]; el.style.display = 'none'; el.classList.remove('show'); el._e = -1; }
    this._capitals(ents, only, placed, fovK);
    this._details(placed, fovK);
  }

  // carte détaillée : régions (et ressources), grandes villes puis villes secondaires selon le zoom
  _details(placed, fovK) {
    const r = this.app.renderer;
    const d = r.details;
    let nc = 0, nr = 0;
    const dist = r.cam.dist;
    if (d && r.detailsOn !== false && this.capitals !== false && dist < 1.95) {
      const g = this.app.grid;
      const cam = r.camera;
      const clash = (rc) => placed.some((q) => !(rc[2] < q[0] || rc[0] > q[2] || rc[3] < q[1] || rc[1] > q[3]));
      // régions
      if (dist < 1.62) {
        const res = dist < 1.38 && this.app.geoFor ? regionResources(d, g, this.app.geoFor(this.app.world), this.app.entities()) : null;
        const cands = [];
        for (const reg of d.regions) {
          if (reg.center < 0 || reg.cells < 6) continue;
          const i = reg.center;
          const x = g.xyz[i * 3], y = g.xyz[i * 3 + 1], z = g.xyz[i * 3 + 2];
          const R = (r.cellR ? r.cellR[i] : 1) + 0.002;
          const p = r.project(x, y, z, R);
          if (!p) continue;
          const dCam = Math.hypot(cam.position.x - x * R, cam.position.y - y * R, cam.position.z - z * R);
          const px = Math.sqrt(reg.cells) * 0.25 / DEG / (fovK * dCam);
          if (px < 70) continue;
          cands.push({ reg, p, px });
        }
        cands.sort((a, b) => b.px - a.px);
        for (const c of cands) {
          if (nr >= 40) break;
          const name = c.reg.name;
          const list = res ? res[c.reg.id] : null;
          const w = name.length * 6.4 + (list ? list.length * 16 : 0) + 8;
          const rc = [c.p[0] - w / 2, c.p[1] - 8, c.p[0] + w / 2, c.p[1] + 8];
          if (clash(rc)) continue;
          placed.push(rc);
          let el = this.regPool[nr];
          if (!el) el = this._el(this.regPool, 'greg', '<span></span><em></em>');
          if (el._n !== name) { el._n = name; el.querySelector('span').textContent = name; }
          const key = list ? list.join(',') : '';
          if (el._r !== key) { el._r = key; el.querySelector('em').innerHTML = list ? list.map((k) => `<i title="${RES_NAME[k]}">${icon(RES_ICON[k])}</i>`).join('') : ''; }
          el.style.transform = `translate(${c.p[0].toFixed(1)}px, ${c.p[1].toFixed(1)}px) translate(-50%, -50%)`;
          el.style.opacity = String(Math.min(1, (1.62 - dist) / 0.15));
          el.style.display = '';
          nr++;
        }
      }
      // villes : seuil de population selon le zoom
      const minPop = dist > 1.75 ? 3e6 : dist > 1.55 ? 1e6 : dist > 1.38 ? 3e5 : dist > 1.25 ? 1e5 : 0;
      const cands = [];
      for (const c of d.cities) {
        if (c.cap || (c.pop < minPop && !(c.rcap && dist < 1.4))) continue;
        const la = c.lat / DEG, lo = c.lon / DEG;
        const x = Math.cos(la) * Math.sin(lo), y = Math.sin(la), z = Math.cos(la) * Math.cos(lo);
        const p = r.project(x, y, z, r.surfaceR(x, y, z) + 0.002);
        if (!p || p[0] < -40 || p[1] < -20 || p[0] > r.viewW + 40 || p[1] > r.viewH + 20) continue;
        cands.push({ c, p });
      }
      cands.sort((a, b) => b.c.pop - a.c.pop);
      for (const it of cands) {
        if (nc >= 90) break;
        const c = it.c;
        const big = c.pop > 1e6;
        const w = c.name.length * (big ? 6.6 : 6) + (c.port && dist < 1.4 ? 14 : 0) + 10;
        const rc = [it.p[0] + 4, it.p[1] - 7, it.p[0] + 4 + w, it.p[1] + 7];
        if (clash(rc)) continue;
        placed.push(rc);
        let el = this.cityPool[nc];
        if (!el) el = this._el(this.cityPool, 'gcity', '<span></span>');
        const k = c.name + (c.port && dist < 1.4 ? '⚓' : '') + big;
        if (el._k !== k) { el._k = k; el.querySelector('span').innerHTML = (c.port && dist < 1.4 ? icon('anchor') : '') + c.name.replace(/[&<>]/g, ''); el.classList.toggle('big', big); }
        el.style.transform = `translate(${(it.p[0] + 5).toFixed(1)}px, ${it.p[1].toFixed(1)}px) translate(0, -50%)`;
        el.style.display = '';
        nc++;
      }
    }
    for (let q = nc; q < this.cityPool.length; q++) this.cityPool[q].style.display = 'none';
    for (let q = nr; q < this.regPool.length; q++) this.regPool[q].style.display = 'none';
  }

  // capitales : ● + nom, visibles quand on s'approche ou pour les participants
  _capitals(ents, only, placed, fovK) {
    const r = this.app.renderer;
    const cam = r.camera;
    let used = 0;
    if (this.capitals) {
      const cands = [];
      for (const [e, a] of this.anchors) {
        const ent = ents[e];
        if (!ent || !ent.capital || ent.kind === 'neutral' || ent.removed) continue;
        const la = ent.capital.lat / DEG, lo = ent.capital.lon / DEG;
        const x = Math.cos(la) * Math.sin(lo), y = Math.sin(la), z = Math.cos(la) * Math.cos(lo);
        const R = r.surfaceR(x, y, z) + 0.002;
        const p = r.project(x, y, z, R);
        if (!p) continue;
        const dCam = Math.hypot(cam.position.x - x * R, cam.position.y - y * R, cam.position.z - z * R);
        const sizePx = Math.sqrt(a.main) * 0.25 / DEG / (fovK * dCam);
        const imp = only ? only.has(e) : false;
        if (sizePx < (imp ? 40 : 110)) continue;
        cands.push({ e, ent, p, sizePx, imp });
      }
      cands.sort((a, b) => (b.imp - a.imp) || (b.sizePx - a.sizePx));
      for (const c of cands) {
        if (used >= 60) break;
        const name = c.ent.capital.name || '';
        const withName = c.sizePx > (c.imp ? 70 : 150);
        const w = withName ? name.length * 6.6 + 16 : 10;
        const rect = [c.p[0] - 5, c.p[1] - 7, c.p[0] - 5 + w, c.p[1] + 7];
        const clash = placed.some((q) => !(rect[2] < q[0] || rect[0] > q[2] || rect[3] < q[1] || rect[1] > q[3]));
        let el = this.capPool[used];
        if (!el) el = this._el(this.capPool, 'gcap', '<i></i><span></span>');
        const showName = withName && !clash;
        if (el._n !== name) { el._n = name; el.querySelector('span').textContent = name; }
        el.classList.toggle('named', showName);
        el.style.transform = `translate(${(c.p[0] - 4).toFixed(1)}px, ${(c.p[1] - 4).toFixed(1)}px)`;
        el.style.display = '';
        if (showName) placed.push(rect);
        used++;
      }
    }
    for (let q = used; q < this.capPool.length; q++) this.capPool[q].style.display = 'none';
  }

  clear() {
    for (const el of this.pool) { el.style.display = 'none'; el.classList.remove('show'); el._e = -1; }
    for (const el of this.capPool) el.style.display = 'none';
    for (const el of this.cityPool) el.style.display = 'none';
    for (const el of this.regPool) el.style.display = 'none';
    this.anchors.clear(); this.shown.clear();
    this.computedAt = -1; this.dirty = true;
  }
}
