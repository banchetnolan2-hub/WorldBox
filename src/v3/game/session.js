// GAME LOGIC V3 — une session : monde + simulation + rendu + caméra automatique.
// La simulation avance par pas fixes, indépendamment de l'affichage (voir WorldSim).
import { WorldSim, TICK } from '../sim/worldSim.js';
import { audio } from '../audio/audio.js';

const DEG = 180 / Math.PI;

export class Session {
  constructor(app) {
    this.app = app;
    this.renderer = app.renderer;
    this.world = null;
    this.sim = null;
    this.setup = null;
    this.state = 'idle';
    this.speed = 1;
    this.acc = 0;
    this.camMode = 'libre';
    this.director = { until: 0, shot: null, follow: null };
    this.hot = null;
    this.recentEvents = [];
    this.onEvent = null;
    this.onEnd = null;
    this.stepOnce = false;
  }

  // la grille et la navigation suivent le monde affiché (Terre ou monde créé)
  get grid() { return this.app.grid; }
  get nav() { return this.app.nav; }

  microList(owner) {
    const g = this.grid;
    const out = [];
    for (let i = g.nGrid; i < g.n; i++) out.push({ cell: i, owner: owner[i] });
    return out;
  }

  showWorld(world, participants = null) {
    this.world = world;
    this.renderer.setWorldOwner(world.owner, participants);
  }

  start(world, setup, restore = null) {
    this.world = world;
    this.setup = setup;
    setup.options.startDay = setup.options.startDay ?? (world.dateDays || 0);
    this.sim = new WorldSim(this.grid, this.nav, world, setup, restore, { geo: this.app.geoFor(world), details: this.app.detailsFor(world) });
    const parts = new Set(this.sim.sides.map((s) => s.e));
    this.renderer.setWorldOwner(this.sim.owner, parts, this.sim.occupied);
    this.speed = setup.options.speed || 1;
    this.acc = 0;
    this.state = 'running';
    this.hot = null;
    this.recentEvents = [];
    this.director = { until: this.renderer.time + 4, shot: 'overview', follow: null };
    this.flyToParticipants(1.3);
    return this.sim;
  }

  // vue englobant les participants
  participantsView() {
    const sim = this.sim;
    if (!sim) return null;
    let x = 0, y = 0, z = 0, n = 0;
    const pts = [];
    for (const s of sim.sides) {
      const c = this.world.entities[s.e].capital;
      if (!c) continue;
      const phi = c.lat / DEG, lam = c.lon / DEG;
      const p = [Math.cos(phi) * Math.sin(lam), Math.sin(phi), Math.cos(phi) * Math.cos(lam)];
      pts.push(p); x += p[0]; y += p[1]; z += p[2]; n++;
    }
    if (!n) return null;
    const l = Math.hypot(x, y, z) || 1;
    x /= l; y /= l; z /= l;
    let maxAng = 0;
    for (const p of pts) maxAng = Math.max(maxAng, Math.acos(Math.max(-1, Math.min(1, p[0] * x + p[1] * y + p[2] * z))));
    // taille des pays eux-mêmes
    const biggest = Math.max(...sim.sides.map((s) => s.initial));
    const spread = Math.max(maxAng, Math.sqrt(biggest) * 0.25 / DEG * 0.9 + 0.05);
    const dist = l < 0.3 ? 3.4 : Math.min(3.6, Math.max(1.35, 1 + spread * 2.4));
    return { lat: Math.asin(y) * DEG, lon: Math.atan2(x, z) * DEG, dist };
  }

  flyToParticipants(speed = 1.6) {
    const v = this.participantsView();
    if (v) this.renderer.cam.flyTo(v.lat, v.lon, v.dist, speed);
  }

  flyToCell(cell, dist = 1.45, speed = 1.8) {
    const g = this.grid;
    this.renderer.cam.flyTo(g.lat[cell], g.lon[cell], dist, speed);
  }

  // multijoueur : un invité ne commande pas le temps lui-même, il le demande à l'hôte
  get _guest() { return !!(this.net && this.net.active && !this.net.isHost); }
  setSpeed(s) { if (this._guest) { this.net.request('speed', s); return; } this.speed = s; if (this.net && this.net.active) this.net._frame(true); }
  pause() { if (this._guest) { this.net.request('pause'); return; } if (this.state === 'running') this.state = 'paused'; if (this.net && this.net.active) this.net._frame(true); }
  resume() { if (this._guest) { this.net.request('resume'); return; } if (this.state === 'paused') this.state = 'running'; if (this.net && this.net.active) this.net._frame(true); }
  toggle() { if (this.state === 'running') this.pause(); else if (this.state === 'paused') this.resume(); }
  step() { if (this._guest || (this.net && this.net.active)) return; if (this.sim && !this.sim.finished) { this.stepOnce = true; } }

  update(dt) {
    const sim = this.sim;
    let alpha = 1;
    const net = this.net && this.net.active ? this.net : null;
    if (sim && net && !net.isHost) {
      // invité : avance jusqu'au pas autorisé par l'hôte, en appliquant les ordres à leur pas exact
      const steps = net.budget(sim, 0);
      for (let k = 0; k < steps && !sim.finished; k++) { net.beforeStep(sim); sim.step(); net.afterStep(sim); }
      net.afterFrame(sim);
    } else if (sim && (this.state === 'running' || this.stepOnce)) {
      if (this.stepOnce) { for (let k = 0; k < 20 && !sim.finished; k++) sim.step(); this.stepOnce = false; }
      else {
        this.acc += dt * this.speed;
        let steps = Math.floor(this.acc / TICK);
        if (steps > 48) { steps = 48; this.acc = 0; } else this.acc -= steps * TICK;
        if (net) { const b = net.budget(sim, steps); if (b < steps) this.acc = 0; steps = b; }
        for (let k = 0; k < steps && !sim.finished; k++) { sim.step(); if (net) net.afterStep(sim); }
        alpha = Math.min(1, this.acc / TICK);
      }
      if (net) net.afterFrame(sim);
    } else if (sim && net) net.afterFrame(sim);
    if (sim) {
      if (sim.captures.length) {
        const real = sim.captures.filter((c) => !c.official);
        if (real.length) this._hotspot(real, dt);
        this.renderer.applyCaptures(sim.captures, this.renderer.time);
        if (real.length) audio.sfx('capture');
        sim.captures.length = 0;
      }
      for (const e of sim.eventsOut) this._handleEvent(e);
      sim.eventsOut.length = 0;
      // zones contestées -> texture (4 fois par seconde)
      if (!this._contestAt || this.renderer.time - this._contestAt > 0.25) {
        this._contestAt = this.renderer.time;
        const tt = this.renderer.territory, t = sim.time;
        const g = this.grid;
        for (let i = 0; i < g.nGrid; i++) {
          const on = sim.contest[i] > t;
          if (on !== (tt.contested[i] === 1)) tt.setContested(i, on);
        }
      }
      if (sim.finished && this.state === 'running') {
        this.state = 'ended';
        if (this.onEnd) this.onEnd(sim.result);
      }
      if (this.camMode === 'auto') this._direct();
    }
    return alpha;
  }

  _hotspot(caps, dt) {
    const g = this.grid;
    let x = 0, y = 0, z = 0;
    for (const c of caps) { x += g.xyz[c.i * 3]; y += g.xyz[c.i * 3 + 1]; z += g.xyz[c.i * 3 + 2]; }
    const l = Math.hypot(x, y, z) || 1; x /= l; y /= l; z /= l;
    if (!this.hot) this.hot = { x, y, z };
    const k = Math.min(1, 0.03 * caps.length);
    this.hot.x += (x - this.hot.x) * k; this.hot.y += (y - this.hot.y) * k; this.hot.z += (z - this.hot.z) * k;
  }

  _handleEvent(e) {
    if (this.onEvent) this.onEvent(e);
    const important = ['CAPITALE PRISE', 'PAYS ÉLIMINÉ', 'ÉQUIPE VAINCUE', 'ÉVÉNEMENT RÉGIONAL', 'CAPITALE REPRISE', 'DÉCLARATION DE GUERRE', 'TRAITÉ DE PAIX', 'ENTRÉE EN GUERRE'].includes(e.title);
    if (e.warEnded && this.onWarEnded) this.onWarEnded(e.war);
    if (e.cell >= 0 && e.cell !== undefined) this.renderer.pulse(e.cell, e.tone === 'bad' ? '#ff6b6b' : '#ffd65a', 1);
    if (e.title === 'PAYS ÉLIMINÉ') audio.sfx('eliminated');
    else if (e.transport) audio.sfx(e.title.includes('NAVIRES') ? 'ship' : 'plane');
    else audio.sfx(e.tone === 'bad' ? 'bad' : 'event');
    if (important || e.transport) this.recentEvents.push({ ...e, at: this.renderer.time });
    if (this.recentEvents.length > 10) this.recentEvents.shift();
  }

  // ---------- caméra automatique ----------
  _direct() {
    const r = this.renderer, now = r.time, d = this.director;
    const sim = this.sim;
    if (d.follow) {
      const tr = sim.transports.find((t) => t.id === d.follow);
      const vs = r.vehicleScreen && r.vehicleScreen.find((v) => v.id === d.follow);
      if (tr && vs && now < d.until) {
        const p = vs.pos;
        r.cam.flyTo(Math.asin(Math.max(-1, Math.min(1, p.y / p.length()))) * DEG, Math.atan2(p.x, p.z) * DEG, 1.55, 6);
        return;
      }
      d.follow = null;
      d.until = 0;
    }
    if (now < d.until) {
      if (d.shot === 'hot' && this.hot) {
        const h = this.hot;
        r.cam.flyTo(Math.asin(h.y) * DEG, Math.atan2(h.x, h.z) * DEG, d.dist || 1.5, 1.2);
      }
      return;
    }
    // prochain plan
    const ev = this.recentEvents.filter((e) => now - e.at < 4).pop();
    if (ev && ev.cell >= 0 && ev.cell !== undefined) {
      this.flyToCell(ev.cell, 1.4, 1.6);
      d.shot = 'event'; d.until = now + 5;
      this.recentEvents = this.recentEvents.filter((e) => e !== ev);
      return;
    }
    const roll = Math.random();
    if (roll < 0.25 && sim.transports.length) {
      const tr = sim.transports[Math.floor(Math.random() * sim.transports.length)];
      if (tr.length - tr.done > 600) { d.follow = tr.id; d.until = now + 7; d.shot = 'follow'; return; }
    }
    if (roll < 0.75 && this.hot) {
      d.shot = 'hot'; d.until = now + 8; d.dist = 1.35 + Math.random() * 0.35;
      return;
    }
    d.shot = 'overview'; d.until = now + 6;
    this.flyToParticipants(1.2);
  }

  setCamMode(m) {
    this.camMode = m;
    this.director.until = 0;
    this.director.follow = null;
  }

  followTransport(id) {
    this.camMode = 'auto';
    this.director.follow = id;
    this.director.until = this.renderer.time + 12;
  }

  stop() {
    this.sim = null;
    this.state = 'idle';
  }
}
