// UI — « DESSINER LES FRONTIÈRES » (Nation Simulator) : le joueur ouvre la carte, prend le crayon et trace
// lui-même la nouvelle frontière de son pays. Aperçu avant validation (gains en vert, pertes en rouge),
// gomme, annuler / rétablir, mode précision, zoom très proche, accrochage aux frontières existantes,
// vue avant / après, bouton « Valider les changements ». Le tracé modifie réellement la géométrie des
// territoires (parcelles + bandes polygonales exactes le long de la ligne) — voir sim/borderEdit.js.
import { $, show, esc, notice, flagImg } from './util.js';
import { icon } from './icons.js';
import { computeEdit, prepareStroke, snapToBorder, applyEdit, activeOverrides } from '../sim/borderEdit.js';

const DEG = Math.PI / 180;
const km = (v) => `${Math.round(v).toLocaleString('fr-FR')} km²`;

export class BorderEditorUI {
  constructor(app) {
    this.app = app;
    this.active = false;
    this.tool = 'pencil';
    this.precise = false;
    this.snap = true;
    this.view = 'after';
    this.strokes = [];
    this.undo = []; this.redo = [];
    this.cur = null;            // tracé en cours
    this.hover = null;
    this.edit = null;
    const t = document.createElement('template');
    t.innerHTML = `<div id="beRoot" class="hidden">
      <canvas id="beCanvas"></canvas>
      <div id="beTop" class="be-top"><div>${icon('pencil')}<b>Dessiner les frontières</b><span id="beHint">Tracez une ligne qui part de votre frontière et y revient : la zone délimitée change de pays.</span></div></div>
      <div id="beBar" class="be-bar">
        <button data-tool="pencil" title="Crayon (C)">${icon('pencil')}<span>Crayon</span></button>
        <button data-tool="eraser" title="Gomme (E) : cliquez sur un tracé pour l'effacer">${icon('eraser')}<span>Gomme</span></button>
        <button data-tool="pan" title="Main (H) : déplacer la carte (le clic droit déplace aussi la carte)">${icon('hand')}<span>Carte</span></button>
        <i class="sep"></i>
        <button data-opt="precise" title="Mode précision (P) : aucun lissage, zoom très proche">${icon('crosshair')}<span>Précision</span></button>
        <button data-opt="snap" title="Accrochage aux frontières existantes (A)">${icon('target')}<span>Accrochage</span></button>
        <i class="sep"></i>
        <button data-act="undo" title="Annuler (Ctrl+Z)">${icon('undo-2')}</button>
        <button data-act="redo" title="Rétablir (Ctrl+Y)">${icon('redo-2')}</button>
        <i class="sep"></i>
        <div class="seg" data-view><button data-v="before">Avant</button><button data-v="after">Après</button></div>
        <button data-act="zin" title="Zoomer">${icon('zoom-in')}</button><button data-act="zout" title="Dézoomer">${icon('zoom-out')}</button>
      </div>
      <aside id="bePanel" class="be-panel panel"></aside>
    </div>`;
    document.body.appendChild(t.content.firstChild);
    this.cv = $('beCanvas');
    $('beBar').addEventListener('click', (e) => {
      const b = e.target.closest('button'); if (!b) return;
      if (b.dataset.tool) this.setTool(b.dataset.tool);
      else if (b.dataset.opt) { this[b.dataset.opt] = !this[b.dataset.opt]; this._applyPrecise(); this._bar(); }
      else if (b.dataset.act === 'undo') this.doUndo();
      else if (b.dataset.act === 'redo') this.doRedo();
      else if (b.dataset.act === 'zin') this.app.renderer.cam.zoomBy(0.6);
      else if (b.dataset.act === 'zout') this.app.renderer.cam.zoomBy(1.6);
      else if (b.dataset.v) { this.view = b.dataset.v; this._bar(); }
    });
    $('bePanel').addEventListener('keydown', (e) => e.stopPropagation());
  }
  get sim() { return this.app.session.sim; }

  // ---------------- ouverture / fermeture ----------------
  open() {
    const sim = this.sim;
    if (!sim || sim.nv) { notice('Le crayon de frontières n\'est pas disponible en Mode Nation : utilisez la diplomatie territoriale ou la guerre. Il reste accessible dans le Sandbox (Contrôle total) et l\'éditeur.'); return; }
    if (this.active) return;
    this.active = true;
    this.strokes = []; this.undo = []; this.redo = []; this.cur = null; this.edit = null; this.view = 'after';
    this.app.pauseForOverlay();
    this.app.nationUI.closePanel(); this.app.gameNav.closePanel();
    const cam = this.app.renderer.cam;
    this._camSave = { tilt: cam.tilt, minDist: cam.minDist };
    cam.tilt = false;
    this._applyPrecise();
    const sd = sim.sides[sim.nv.player], g = sim.grid;
    if (sd.capital >= 0) cam.flyTo(g.lat[sd.capital], g.lon[sd.capital], Math.max(1.12, Math.min(1.6, 1.08 + Math.sqrt(sd.cells) * 0.004)), 1.6);
    document.body.classList.add('be-on');
    show('beRoot');
    this._bar(); this._panel();
    this._resize();
    this._onResize = () => this._resize();
    window.addEventListener('resize', this._onResize);
    const loop = () => { if (!this.active) return; this._draw(); requestAnimationFrame(loop); };
    requestAnimationFrame(loop);
  }
  close() {
    if (!this.active) return;
    if (this.strokes.length && !window.confirm('Fermer l\'éditeur ? Les tracés non validés seront perdus.')) return;
    this._exit();
  }
  _exit() {
    this.active = false;
    show('beRoot', false);
    document.body.classList.remove('be-on');
    window.removeEventListener('resize', this._onResize);
    const cam = this.app.renderer.cam;
    if (this._camSave) { cam.tilt = this._camSave.tilt; cam.minDist = this._camSave.minDist; if (cam.dist < cam.minDist) cam.zoomBy(1); }
    this.app.resumeAfterOverlay();
  }
  _applyPrecise() { const cam = this.app.renderer.cam; cam.minDist = this.precise ? 1.006 : 1.02; }
  _resize() { const dpr = Math.min(2, window.devicePixelRatio || 1); this.cv.width = innerWidth * dpr; this.cv.height = innerHeight * dpr; this.cv.style.width = innerWidth + 'px'; this.cv.style.height = innerHeight + 'px'; this.dpr = dpr; }
  setTool(t) { this.tool = t; this._bar(); }

  // ---------------- saisie ----------------
  key(e) {
    if (!this.active) return false;
    const k = e.key.toLowerCase();
    if ((e.ctrlKey || e.metaKey) && k === 'z') { e.preventDefault(); this.doUndo(); return true; }
    if ((e.ctrlKey || e.metaKey) && k === 'y') { e.preventDefault(); this.doRedo(); return true; }
    if (k === 'escape') { if (this.cur) { this.cur = null; return true; } this.close(); return true; }
    if (k === 'enter') { this.validate(); return true; }
    if (k === 'c') { this.setTool('pencil'); return true; }
    if (k === 'e') { this.setTool('eraser'); return true; }
    if (k === 'h') { this.setTool('pan'); return true; }
    if (k === 'p') { this.precise = !this.precise; this._applyPrecise(); this._bar(); return true; }
    if (k === 'a') { this.snap = !this.snap; this._bar(); return true; }
    return k.length === 1;              // les autres raccourcis du jeu sont neutralisés pendant l'édition
  }
  // retourne vrai si le clic est pris par l'éditeur (sinon il fait tourner la carte)
  pointerDown(e, hit) {
    if (e.button !== 0 || this.tool === 'pan') return false;
    if (this.tool === 'eraser') { this._eraseAt(e.clientX, e.clientY); return true; }
    if (!hit) return true;
    let p = [hit.lon, hit.lat];
    if (this.snap) { const s = this._snap(p); if (s) p = s; }
    this.cur = { raw: [p], sx: e.clientX, sy: e.clientY };
    return true;
  }
  pointerMove(e, hit) {
    this.hover = hit ? { lon: hit.lon, lat: hit.lat, x: e.clientX, y: e.clientY } : null;
    if (!this.cur) { if (this.tool === 'eraser' && e.buttons & 1) this._eraseAt(e.clientX, e.clientY); return; }
    if (!hit) return;
    const last = this.cur.raw[this.cur.raw.length - 1];
    const minPx = this.precise ? 1.5 : 4;
    const lp = this._proj(last);
    if (lp && Math.hypot(lp[0] - e.clientX, lp[1] - e.clientY) < minPx) return;
    let dl = hit.lon - last[0]; if (dl > 180) dl -= 360; if (dl < -180) dl += 360;
    this.cur.raw.push([last[0] + dl, hit.lat]);
  }
  pointerUp() {
    if (!this.cur) return;
    const raw = this.cur.raw; this.cur = null;
    if (raw.length < 2) return;
    let pts = prepareStroke(raw, this.precise);
    if (this.snap) { const s = this._snap(pts[pts.length - 1]); if (s) pts = [...pts.slice(0, -1), s]; }
    this._push();
    this.strokes.push(pts);
    this._recompute();
  }
  click() { /* clic simple sans tracé : rien */ }
  _snap(p) {
    const sim = this.sim, k = sim.nv.player;
    // tolérance : ~22 pixels à l'écran, convertie en degrés selon le zoom
    const a = this._proj(p), b = this._proj([p[0] + 0.25, p[1]]);
    const pxPerDeg = a && b ? Math.max(1, Math.hypot(a[0] - b[0], a[1] - b[1]) / 0.25) : 40;
    return snapToBorder(sim, k, p[0], p[1], 22 / pxPerDeg);
  }
  _eraseAt(x, y) {
    let best = -1, bd = 14;
    this.strokes.forEach((s, i) => {
      for (let q = 0; q < s.length - 1; q++) {
        const a = this._proj(s[q]), b = this._proj(s[q + 1]);
        if (!a || !b) continue;
        const d = segDist(x, y, a, b);
        if (d < bd) { bd = d; best = i; }
      }
    });
    if (best < 0) return;
    this._push();
    this.strokes.splice(best, 1);
    this._recompute();
  }
  _push() { this.undo.push(this.strokes.map((s) => s.slice())); if (this.undo.length > 60) this.undo.shift(); this.redo = []; }
  doUndo() { if (!this.undo.length) return; this.redo.push(this.strokes); this.strokes = this.undo.pop(); this._recompute(); }
  doRedo() { if (!this.redo.length) return; this.undo.push(this.strokes); this.strokes = this.redo.pop(); this._recompute(); }

  _recompute() {
    const sim = this.sim;
    this.edit = this.strokes.length ? computeEdit(sim, sim.nv.player, this.strokes) : null;
    this.prevCells = null;
    if (this.edit) {
      const A = sim.sides[sim.nv.player].e;
      this.prevCells = this.edit.transfers.map(([c, to]) => [c, to === A ? 1 : -1]);
    }
    this._bar(); this._panel();
  }

  // ---------------- affichage ----------------
  _proj(p) {
    const la = p[1] * DEG, lo = p[0] * DEG;
    const x = Math.cos(la) * Math.sin(lo), y = Math.sin(la), z = Math.cos(la) * Math.cos(lo);
    const r = this.app.renderer;
    return r.project(x, y, z, 1.0015);
  }
  _draw() {
    const ctx = this.cv.getContext('2d'), dpr = this.dpr || 1;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, innerWidth, innerHeight);
    const sim = this.sim; if (!sim) return;
    const g = sim.grid, R = g.RES / 2;
    // aperçu des parcelles qui changent de pays
    if (this.view === 'after' && this.prevCells && this.prevCells.length) {
      for (const [c, s] of this.prevCells) {
        const la = g.lat[c], lo = g.lon[c];
        const q = [this._proj([lo - R, la - R]), this._proj([lo + R, la - R]), this._proj([lo + R, la + R]), this._proj([lo - R, la + R])];
        if (q.some((v) => !v)) continue;
        ctx.beginPath(); ctx.moveTo(q[0][0], q[0][1]); for (let k = 1; k < 4; k++) ctx.lineTo(q[k][0], q[k][1]); ctx.closePath();
        ctx.fillStyle = s > 0 ? 'rgba(130, 205, 150, 0.42)' : 'rgba(228, 110, 90, 0.42)';
        ctx.fill();
      }
    }
    // tracés
    const line = (pts, color, w, dash = null) => {
      ctx.save(); ctx.lineJoin = 'round'; ctx.lineCap = 'round';
      if (dash) ctx.setLineDash(dash);
      ctx.beginPath(); let on = false;
      for (const p of pts) { const s = this._proj(p); if (!s) { on = false; continue; } if (!on) { ctx.moveTo(s[0], s[1]); on = true; } else ctx.lineTo(s[0], s[1]); }
      ctx.strokeStyle = 'rgba(5, 10, 16, 0.7)'; ctx.lineWidth = w + 3; ctx.stroke();
      ctx.strokeStyle = color; ctx.lineWidth = w; ctx.stroke();
      ctx.restore();
    };
    const eff = this.edit ? this.edit.effective : [];
    this.strokes.forEach((s, i) => {
      if (this.view === 'before') line(s, 'rgba(227, 196, 126, 0.45)', 1.6, [5, 5]);
      else line(s, eff[i] === false ? '#e47d66' : '#e3c47e', 2.6, eff[i] === false ? [7, 5] : null);
      for (const p of [s[0], s[s.length - 1]]) { const q = this._proj(p); if (q) { ctx.beginPath(); ctx.arc(q[0], q[1], 4, 0, Math.PI * 2); ctx.fillStyle = eff[i] === false ? '#e47d66' : '#e3c47e'; ctx.fill(); } }
    });
    if (this.cur) line(this.cur.raw, '#ffffff', 2.2);
    // accrochage : point de frontière visé
    if (this.hover && this.snap && this.tool === 'pencil') {
      const s = this._snap([this.hover.lon, this.hover.lat]);
      const q = s && this._proj(s);
      if (q) { ctx.beginPath(); ctx.arc(q[0], q[1], 7, 0, Math.PI * 2); ctx.strokeStyle = '#e3c47e'; ctx.lineWidth = 2; ctx.stroke(); }
    }
    if (this.hover && this.precise) {
      ctx.font = '600 11px Inter, sans-serif'; ctx.fillStyle = 'rgba(236,230,214,0.85)';
      ctx.fillText(`${Math.abs(this.hover.lat).toFixed(3)}° ${this.hover.lat >= 0 ? 'N' : 'S'}  ${Math.abs(this.hover.lon).toFixed(3)}° ${this.hover.lon >= 0 ? 'E' : 'O'}`, this.hover.x + 14, this.hover.y + 22);
    }
  }
  _bar() {
    const bar = $('beBar'); if (!bar) return;
    bar.querySelectorAll('[data-tool]').forEach((b) => b.classList.toggle('on', b.dataset.tool === this.tool));
    bar.querySelector('[data-opt="precise"]').classList.toggle('on', this.precise);
    bar.querySelector('[data-opt="snap"]').classList.toggle('on', this.snap);
    bar.querySelector('[data-act="undo"]').disabled = !this.undo.length;
    bar.querySelector('[data-act="redo"]').disabled = !this.redo.length;
    bar.querySelectorAll('[data-view] button').forEach((b) => b.classList.toggle('on', b.dataset.v === this.view));
    document.body.classList.toggle('be-draw', this.tool !== 'pan');
  }
  _panel() {
    const sim = this.sim, n = sim.nv, k = n.player, sd = sim.sides[k];
    const e = this.edit;
    const rows = e ? Object.entries(e.byOwner).map(([o, r]) => { const ent = sim.entities[o]; const S = sim.sideOf[Number(o)]; return `<div class="be-row">${flagImg(ent, 'flag sm')}<span>${esc(ent ? ent.name : '?')}</span>${r.gained > 0 ? `<b class="up">+${km(r.gained)}</b>` : ''}${r.lost > 0 ? `<b class="down">−${km(r.lost)}</b>` : ''}${S >= 0 ? `<small>relations ${Math.round(sim.rel[k * sim.S + S])}</small>` : ''}</div>`; }).join('') : '';
    const bad = e ? e.effective.filter((x) => !x).length : 0;
    $('bePanel').innerHTML = `<div class="be-head">${flagImg(this.app.entities()[sd.e], 'flag md')}<div><small class="eyebrow">Frontières</small><b>${esc(sd.name)}</b></div></div>
      <div class="nm-kpis be-kpis"><div><small>Gagné</small><b class="up">${e ? km(e.gained) : '0 km²'}</b></div><div><small>Cédé</small><b class="down">${e ? km(e.lost) : '0 km²'}</b></div><div><small>Tracés</small><b>${this.strokes.length}</b></div></div>
      ${rows ? `<h4>Pays concernés</h4>${rows}` : '<p class="hint">Aucun changement pour le moment. Dessinez une ligne qui part d\'un point de votre frontière et y revient : tout ce qu\'elle délimite change de pays.</p>'}
      ${bad ? `<p class="hint warn">${icon('info')} ${bad} tracé(s) sans effet (en pointillés rouges) : ils doivent couper un territoire d'un bord à l'autre. Activez l'accrochage pour partir et arriver exactement sur une frontière.</p>` : ''}
      ${e && e.warnings.length ? `<ul class="be-warn">${[...new Set(e.warnings)].map((w) => `<li>${esc(w)}</li>`).join('')}</ul>` : ''}
      ${e && e.gained > 0 ? `<p class="hint warn">Prendre du territoire sans guerre dégrade fortement les relations ; un voisin puissant ou agressif peut déclarer la guerre.</p>` : ''}
      <details class="be-help"><summary>Comment ça marche</summary><ul>
        <li><b>Crayon</b> : tracez la nouvelle frontière. Partie d'un pays voisin délimitée par votre tracé et votre frontière : elle vous revient. Partie de votre pays coupée par le tracé : elle revient au voisin.</li>
        <li><b>Accrochage</b> : les extrémités se posent sur la frontière existante la plus proche.</li>
        <li><b>Précision</b> : aucun lissage du tracé, zoom très proche, coordonnées affichées.</li>
        <li><b>Gomme</b> : cliquez sur un tracé pour l'effacer. <b>Ctrl+Z / Ctrl+Y</b> : annuler, rétablir.</li>
        <li>Clic droit ou outil <b>Carte</b> : déplacer la vue. Molette : zoom.</li>
        <li>La frontière suit exactement votre tracé ; les territoires sont recalculés et nettoyés (aucun fragment, aucune zone sans pays, capitales protégées).</li></ul></details>
      <div class="be-foot"><button class="btn ghost" id="beCancel">${icon('x')}<span>Fermer</span></button><span class="grow"></span><button class="btn primary" id="beApply" ${e && e.transfers.length ? '' : 'disabled'}>${icon('check')}<span>Valider les changements</span></button></div>`;
    $('beCancel').onclick = () => this.close();
    $('beApply').onclick = () => this.validate();
  }

  validate() {
    const sim = this.sim, e = this.edit;
    if (!e || !e.transfers.length) { notice('Aucun changement à valider.'); return; }
    const n = sim.nv;
    const msg = `Valider les nouvelles frontières ?\n\nGagné : ${km(e.gained)}\nCédé : ${km(e.lost)}\n\nLes pays concernés réagiront (relations, risque de guerre).`;
    if (!window.confirm(msg)) return;
    void n;
    const rec = this.app.act({ op: 'border', strokes: JSON.parse(JSON.stringify(this.strokes)) });
    if (rec && rec.pending) notice('Nouvelles frontières transmises : elles s\'appliquent chez tous les joueurs.', 3600);
    else if (rec) notice(`Nouvelles frontières en vigueur : +${km(e.gained)}, −${km(e.lost)}.`, 4200);
    this.strokes = []; this.edit = null; this.prevCells = null;
    this._exit();
    this.app.nationUI._bar && this.app.nationUI._bar(true);
  }
}

function segDist(x, y, a, b) {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const L = dx * dx + dy * dy;
  const t = L ? Math.max(0, Math.min(1, ((x - a[0]) * dx + (y - a[1]) * dy) / L)) : 0;
  return Math.hypot(a[0] + dx * t - x, a[1] + dy * t - y);
}
