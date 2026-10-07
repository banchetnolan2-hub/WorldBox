// GAME LOGIC — orchestre carte, simulation, rendu, caméra et entrées
import { Simulation, TICK } from '../simulation/simulation.js';
import { buildScene } from '../map/mapBuilder.js';
import { Camera } from '../map/camera.js';
import { MapRenderer } from '../map/mapRenderer.js';
import { getCountry, resolveColors } from '../countries/countries.js';
import { effectiveStats } from './config.js';

const PAD_GAME = { top: 120, right: 320, bottom: 80, left: 300 };
const PAD_CINEMA = { top: 120, right: 40, bottom: 70, left: 40 };
const PAD_MENU = { top: 60, right: 60, bottom: 90, left: 640 };

export class Game {
  constructor(canvas, hud) {
    this.canvas = canvas;
    this.hud = hud;
    this.camera = new Camera();
    this.renderer = new MapRenderer(canvas, this.camera);
    this.state = 'menu';           // menu | running | paused | ended
    this.config = null;
    this.sim = null;
    this.scene = null;
    this.sceneCache = new Map();
    this.speed = 1;
    this.acc = 0;
    this.now = 0;
    this.last = performance.now();
    this.spectator = false;
    this.autoCam = false;
    this.autoCamHoldUntil = 0;
    this.hot = null;
    this.camPhaseAt = 0;
    this.camWide = false;
    this.hudAt = 0;
    this.fps = 60;
    this.onEnd = null;
    this.onFrame = null;
    this._resize();
    window.addEventListener('resize', () => this._resize());
    this._bindInput();
    requestAnimationFrame((t) => this._frame(t));
  }

  _resize() {
    const w = window.innerWidth, h = window.innerHeight;
    this.renderer.resize(w, h, Math.min(2, window.devicePixelRatio || 1));
    if (this.scene) this.camera.fit(this.scene.bounds, this._padding(), true);
  }

  _padding() {
    if (this.state === 'menu') return PAD_MENU;
    return this.spectator ? PAD_CINEMA : PAD_GAME;
  }

  // ---------- scène ----------
  getScene(a, b, resolution) {
    const key = `${a.id}|${b.id}|${resolution}`;
    if (this.sceneCache.has(key)) return this.sceneCache.get(key);
    const scene = buildScene(a, b, { resolution });
    this.sceneCache.set(key, scene);
    if (this.sceneCache.size > 3) this.sceneCache.delete(this.sceneCache.keys().next().value);
    return scene;
  }

  showPreview(config) {
    const a = getCountry(config.a), b = getCountry(config.b);
    const colors = resolveColors(a, b);
    this.state = 'menu';
    this.sim = null;
    this.scene = this.getScene(a, b, config.resolution);
    this.colors = colors;
    this.renderer.setScene(this.scene, colors);
    this.renderer.attachSim(null);
    this.camera.fit(this.scene.bounds, PAD_MENU, false);
    return colors;
  }

  // ---------- partie ----------
  start(config, { spectator = false } = {}) {
    this.config = config;
    this.spectator = spectator;
    const a = getCountry(config.a), b = getCountry(config.b);
    const colors = resolveColors(a, b);
    this.colors = colors;
    this.scene = this.getScene(a, b, config.resolution);
    this.renderer.setScene(this.scene, colors);
    this.sim = new Simulation(this.scene.grid, {
      seed: config.seed,
      names: [a.name, b.name],
      stats: effectiveStats(config),
      powerMult: config.powerMult,
      eventRate: config.eventRate,
      randomness: config.randomness,
      maxDuration: config.maxDuration,
      victoryRatio: config.victoryRatio,
    });
    this.renderer.attachSim(this.sim);
    this.state = 'running';
    this.acc = 0;
    this.speed = config.speed || 1;
    this.autoCam = spectator;
    this.hot = null;
    this.camPhaseAt = this.now + 12;
    this.camWide = false;
    this.hud.setup([a, b], colors);
    this.hud.setSpeed(this.speed);
    this.hud.setPaused(false);
    this.hud.setCinema(spectator);
    this.hud.setToggle('camBtn', this.autoCam);
    this.hud.setToggle('markersBtn', this.renderer.showMarkers);
    this.hud.show(true);
    this.hud.update(this.sim);
    this.camera.fit(this.scene.bounds, this._padding(), false);
  }

  setSpeed(s) {
    this.speed = s;
    if (this.config) this.config.speed = s;
    this.hud.setSpeed(s);
  }

  pause() { if (this.state === 'running') { this.state = 'paused'; this.hud.setPaused(true); } }
  resume() { if (this.state === 'paused') { this.state = 'running'; this.hud.setPaused(false); this.last = performance.now(); } }
  togglePause() { if (this.state === 'running') this.pause(); else if (this.state === 'paused') this.resume(); }

  toggleAutoCam() {
    this.autoCam = !this.autoCam;
    this.hud.setToggle('camBtn', this.autoCam);
    if (!this.autoCam) this.camera.reset();
  }
  toggleMarkers() {
    this.renderer.showMarkers = !this.renderer.showMarkers;
    this.hud.setToggle('markersBtn', this.renderer.showMarkers);
  }
  fitView() { this.autoCamHoldUntil = this.now + 6; this.camera.fit(this.scene ? this.scene.bounds : [[0, 0], [1600, 1000]], this._padding()); }
  zoom(f) { this.autoCamHoldUntil = this.now + 6; this.camera.zoomCenter(f); }

  stopToMenu() {
    this.state = 'menu';
    this.sim = null;
    this.hud.show(false);
    this.hud.setCinema(false);
    this.spectator = false;
    this.renderer.attachSim(null);
  }

  // ---------- boucle ----------
  _frame(ts) {
    const dt = Math.min(0.1, Math.max(0, (ts - this.last) / 1000));
    this.last = ts;
    this.now += dt;
    if (dt > 0) this.fps += (1 / dt - this.fps) * 0.05;
    let alpha = 1;
    const sim = this.sim;
    if (sim && this.state === 'running') {
      this.acc += dt * this.speed;
      let steps = Math.floor(this.acc / TICK);
      if (steps > 40) { steps = 40; this.acc = 0; }
      else this.acc -= steps * TICK;
      for (let k = 0; k < steps && !sim.finished; k++) sim.step();
      alpha = Math.min(1, this.acc / TICK);
    }
    if (sim) {
      if (sim.captures.length) {
        this._trackHotspot(sim.captures, dt);
        this.renderer.applyCaptures(sim.captures, this.now);
        sim.captures.length = 0;
      }
      for (const e of sim.eventsOut) {
        this.hud.event(e, e.t);
        if (e.id === 'regional' && sim.regional) this.renderer.pulseAt(sim.regional.x, sim.regional.y, '#ffd65a', this.now);
      }
      sim.eventsOut.length = 0;
      if (this.now - this.hudAt > 0.1) { this.hudAt = this.now; this.hud.update(sim); }
      if (sim.finished && this.state === 'running') {
        this.state = 'ended';
        this.hud.update(sim);
        if (this.onEnd) this.onEnd(sim.result, this.config);
      }
    }
    if (this.autoCam && sim && this.now > this.autoCamHoldUntil) this._autoCamera();
    this.camera.update(dt);
    this.renderer.render(this.now, alpha, dt);
    if (this.onFrame) this.onFrame(dt);
    requestAnimationFrame((t) => this._frame(t));
  }

  _trackHotspot(captures, dt) {
    let x = 0, y = 0;
    const g = this.scene.grid;
    for (const c of captures) { x += g.cx[c.i]; y += g.cy[c.i]; }
    x /= captures.length; y /= captures.length;
    if (!this.hot) this.hot = { x, y };
    const k = Math.min(1, 0.02 * captures.length);
    this.hot.x += (x - this.hot.x) * k;
    this.hot.y += (y - this.hot.y) * k;
  }

  _autoCamera() {
    // alterne : suivi de la zone active (zoomé) / vue d'ensemble
    if (this.now > this.camPhaseAt) {
      this.camWide = !this.camWide;
      this.camPhaseAt = this.now + (this.camWide ? 5 : 11);
      if (this.camWide) this.camera.fit(this.scene.bounds, this._padding());
    }
    if (!this.camWide && this.hot) {
      const zoom = this.camera.fitZoom * (this.spectator ? 2.4 : 2.0);
      const t = this.camera.target;
      if (!t || Math.abs(t.x - this.hot.x) + Math.abs(t.y - this.hot.y) > 2 || Math.abs(t.zoom - zoom) > 0.01) {
        this.camera.follow(this.hot.x, this.hot.y, zoom);
      }
    }
  }

  // ---------- souris ----------
  _bindInput() {
    const c = this.canvas;
    let down = null;
    c.addEventListener('mousedown', (e) => {
      if (e.button !== 0) return;
      down = { x: e.clientX, y: e.clientY, lx: e.clientX, ly: e.clientY, moved: false };
    });
    window.addEventListener('mousemove', (e) => {
      if (!down) return;
      const dx = e.clientX - down.lx, dy = e.clientY - down.ly;
      if (!down.moved && Math.hypot(e.clientX - down.x, e.clientY - down.y) > 4) { down.moved = true; c.classList.add('dragging'); this.hud.hideTooltip(); }
      if (down.moved) {
        this.camera.pan(dx, dy);
        this.autoCamHoldUntil = this.now + 6;
      }
      down.lx = e.clientX; down.ly = e.clientY;
    });
    window.addEventListener('mouseup', (e) => {
      if (!down) return;
      const wasClick = !down.moved;
      down = null;
      c.classList.remove('dragging');
      if (wasClick && e.target === c) this._select(e.clientX, e.clientY);
    });
    c.addEventListener('wheel', (e) => {
      e.preventDefault();
      const f = Math.exp(-e.deltaY * 0.0015);
      this.camera.zoomAt(f, e.clientX, e.clientY);
      this.autoCamHoldUntil = this.now + 6;
    }, { passive: false });
  }

  _select(sx, sy) {
    if (!this.scene || this.state === 'menu') return;
    const i = this.renderer.cellAtScreen(sx, sy);
    const g = this.scene.grid;
    const names = this.scene.countries.map((c) => c.name);
    if (i >= 0) {
      this.renderer.selected = i;
      const owner = this.renderer.ownerArray()[i];
      const origin = g.origin[i];
      const sim = this.sim;
      let etat = 'Stable';
      if (sim && sim.contest[i] > sim.time) etat = 'Contestée';
      else if (sim && sim.isolated[i]) etat = 'Poche isolée';
      else if (owner !== origin) etat = `Gagnée par ${names[owner]}`;
      const cap = g.capitals.indexOf(i);
      this.hud.showTooltip(sx, sy, `
        <b><span style="display:inline-block;width:10px;height:10px;border-radius:2px;background:${this.colors[owner]}"></span>${names[owner]}</b>
        ${cap >= 0 ? `<div class="row">Capitale : <span>${this.scene.countries[cap].capital.name}</span></div>` : ''}
        <div class="row">Territoire d'origine : <span>${names[origin]}</span></div>
        <div class="row">État : <span>${etat}</span></div>
        <div class="row">Parcelle n° <span>${i}</span></div>`);
      return;
    }
    this.renderer.selected = -1;
    const n = this.renderer.neutralAtScreen(sx, sy);
    if (n) this.hud.showTooltip(sx, sy, `<b>${n.name || 'Territoire'}</b><div class="row">Territoire neutre (hors simulation)</div>`);
    else this.hud.hideTooltip();
  }

  // ---------- test automatique ----------
  debugState() {
    return {
      state: this.state,
      fps: Math.round(this.fps),
      frameMs: this.renderer.lastFrameMs.toFixed(2),
      cells: this.scene ? this.scene.grid.n : 0,
      grid: this.scene ? [this.scene.grid.gw, this.scene.grid.gh] : null,
      counts: this.scene ? this.scene.grid.counts : null,
      time: this.sim ? this.sim.time.toFixed(1) : null,
      share: this.sim ? this.sim.snapshot().map((s) => s.share.toFixed(3)) : null,
      events: this.sim ? this.sim.log.length : 0,
    };
  }
}
