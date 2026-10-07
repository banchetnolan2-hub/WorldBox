// UI — mode CONTRÔLE TOTAL (bac à sable) : édition des frontières, des pays, des équipes,
// création de pays, contrôle de la simulation en direct, événements manuels, annuler / rétablir.
import { icon } from './icons.js';
import { $, show, esc, colorDot, notice, TEAM_COLORS, teamName, fmtInt } from './util.js';
import { MANUAL_EVENTS } from '../sim/events.js';
import { NONE, cloneWorld, countCells } from '../world/worldState.js';
import { randomSeedString } from '../sim/rng.js';

const STAT_FIELDS = [
  ['puissance', 'Puissance'], ['economie', 'Économie'], ['stabilite', 'Stabilité'], ['ressources', 'Ressources'],
  ['mobilite', 'Mobilité'], ['defense', 'Défense'], ['vitesse', 'Vitesse de progression'], ['expansion', 'Expansion'],
];

export class ControlMode {
  constructor(app) {
    this.app = app;
    this.active = false;
    this.tool = 'select';
    this.brush = 3;
    this.target = -1;       // pays actif
    this.undo = []; this.redo = [];
    this.stroke = null;
    this.placingCapital = null;
    document.querySelectorAll('#toolGrid button').forEach((b) => b.addEventListener('click', () => this.setTool(b.dataset.tool)));
    $('brush').addEventListener('input', () => { this.brush = Number($('brush').value); $('oBrush').textContent = this.brush ? `${this.brush * 2 + 1} parcelles` : '1 parcelle'; });
    $('undoBtn').addEventListener('click', () => this.doUndo());
    $('redoBtn').addEventListener('click', () => this.doRedo());
    $('ctlSaveWorld').addEventListener('click', () => this.saveWorld());
    $('ctlPickCountry').addEventListener('click', () => app.picker.open({ title: 'PAYS ACTIF', multi: false, allowDead: true, exclude: new Set(), onDone: ([e]) => this.setTarget(e) }));
    $('ctlNewCountry').addEventListener('click', () => this.openNewCountry());
    $('ctlAddTeam').addEventListener('click', () => this.addTeam());
    $('ctlSimStart').addEventListener('click', () => this.startSim());
    $('ctlPause').addEventListener('click', () => { app.session.pause(); this.refreshSim(); });
    $('ctlResume').addEventListener('click', () => { app.session.resume(); this.refreshSim(); });
    $('ctlStep').addEventListener('click', () => { app.session.pause(); app.session.step(); this.refreshSim(); });
    $('ctlSlower').addEventListener('click', () => this.changeSpeed(-1));
    $('ctlFaster').addEventListener('click', () => this.changeSpeed(1));
    $('ctlEnd').addEventListener('click', () => { if (app.session.sim) { app.session.sim.forceFinish(); } });
    $('ctlEvents').addEventListener('input', () => {
      const v = Number($('ctlEvents').value); $('oCtlEv').textContent = v.toFixed(1).replace('.', ',') + '×';
      const sim = app.session.sim; if (sim) { sim.cfg.eventRate = v; sim.eventInterval = v > 0 ? Math.max(3, (13 / v) / Math.sqrt(Math.max(1, sim.sides.length / 2))) : Infinity; if (v > 0 && !isFinite(sim.nextEventAt)) sim.nextEventAt = sim.time + 3; }
    });
    $('ctlRand').addEventListener('input', () => { const v = Number($('ctlRand').value); $('oCtlRand').textContent = Math.round(v * 100) + ' %'; if (app.session.sim) app.session.sim.cfg.randomness = v; });
    $('ctlExit').addEventListener('click', () => app.exitControl());
    // événements manuels
    $('ctlEventsGrid').innerHTML = MANUAL_EVENTS.map((ev) => `<button data-ev="${ev.id}">${ev.icon} ${ev.title.charAt(0) + ev.title.slice(1).toLowerCase()}</button>`).join('')
      + '<button data-ev="__territory">🗺️ Changement de territoire</button><button data-ev="__team">🤝 Création d\'une équipe</button>';
    $('ctlEventsGrid').querySelectorAll('button').forEach((b) => b.addEventListener('click', () => this.manualEvent(b.dataset.ev)));
  }

  // ---------- entrée / sortie ----------
  enter() {
    this.active = true;
    const app = this.app;
    // on travaille sur une copie modifiable du monde
    if (app.world.readonly) app.setWorld(cloneWorld(app.world, { id: 'original-modifie', name: 'Monde personnalisé', readonly: false, unsaved: true }), true);
    if (!app.world.teams) app.world.teams = [];
    app.world.teams.forEach((t) => { t.members = t.members || []; });
    this.undo = []; this.redo = [];
    $('brush').value = this.brush; $('brush').dispatchEvent(new Event('input'));
    $('ctlEvents').value = 1; $('ctlEvents').dispatchEvent(new Event('input'));
    $('ctlRand').value = 0.5; $('ctlRand').dispatchEvent(new Event('input'));
    this.setTool('select');
    show('control');
    this.refreshAll();
  }

  exit() {
    this.active = false;
    this.placingCapital = null;
    show('control', false);
    this.app.canvas.classList.remove('paint');
  }

  get world() { return this.app.world; }
  get sim() { return this.app.session.sim; }
  ownerArray() { return this.sim ? this.sim.owner : this.world.owner; }

  setTool(t) {
    this.tool = t;
    document.querySelectorAll('#toolGrid button').forEach((b) => b.classList.toggle('on', b.dataset.tool === t));
    this.app.canvas.classList.toggle('paint', t === 'give' || t === 'remove');
    if (t === 'give' || t === 'remove') notice('Glisser (clic gauche) pour peindre · clic droit + glisser pour tourner le globe', 3000);
  }

  setTarget(e) {
    this.target = e;
    this.app.selectEntity(e, false);
    this.refreshAll();
  }

  // ---------- peinture ----------
  isPaintTool() { return this.active && (this.tool === 'give' || this.tool === 'remove'); }

  cellsAround(cell) {
    const g = this.app.grid;
    const out = [];
    if (cell < 0) return out;
    if (g.pos[cell] < 0) return [cell];
    const p = g.pos[cell], x0 = p % g.W, y0 = (p / g.W) | 0;
    const r = this.brush;
    const kx = 1 / Math.max(0.2, Math.cos(g.lat[cell] * Math.PI / 180));
    const rx = Math.ceil(r * kx);
    for (let dy = -r; dy <= r; dy++) {
      const y = y0 + dy; if (y < 0 || y >= g.H) continue;
      for (let dx = -rx; dx <= rx; dx++) {
        if ((dx / kx) ** 2 + dy * dy > r * r + 0.5) continue;
        const i = g.indexAt[y * g.W + ((x0 + dx + g.W) % g.W)];
        if (i >= 0) out.push(i);
      }
    }
    return out;
  }

  beginStroke(cell) {
    if (this.tool === 'give' && this.target < 0) { notice('Choisissez d\'abord le pays actif (clic sur la carte avec l\'outil Sélection, ou « Choisir le pays actif »).', 3500); return false; }
    const owner = this.ownerArray();
    this.stroke = { changes: new Map(), only: $('brushSame').checked ? owner[cell] : null };
    this.paint(cell);
    return true;
  }

  paint(cell) {
    if (!this.stroke) return;
    const owner = this.ownerArray();
    const to = this.tool === 'remove' ? NONE : this.target;
    for (const i of this.cellsAround(cell)) {
      if (this.stroke.only !== null && owner[i] !== this.stroke.only && !this.stroke.changes.has(i)) continue;
      if (owner[i] === to) continue;
      if (!this.stroke.changes.has(i)) this.stroke.changes.set(i, owner[i]);
      this.setCell(i, to);
    }
  }

  endStroke() {
    if (!this.stroke) return;
    const ch = [...this.stroke.changes].map(([i, before]) => [i, before, this.ownerArray()[i]]);
    this.stroke = null;
    if (!ch.length) return;
    this.pushUndo({ kind: 'owner', changes: ch });
    this.afterEdit();
  }

  setCell(i, e) {
    if (this.sim) this.sim.setOwner(i, e);
    else this.world.owner[i] = e;
    this.app.renderer.setOwnerInstant(i, e);
  }

  afterEdit() {
    if (this.sim) { this.sim.refreshAfterEdit(); this.world.owner = Uint16Array.from(this.sim.owner); }
    this.app.cellCountsDirty = true;
    this.app.refreshParams();
    this.refreshAll();
  }

  transferCountry(from) {
    if (this.target < 0 || from === this.target || from === NONE) return;
    const owner = this.ownerArray();
    const ch = [];
    for (let i = 0; i < owner.length; i++) if (owner[i] === from) { ch.push([i, from, this.target]); this.setCell(i, this.target); }
    if (ch.length) { this.pushUndo({ kind: 'owner', changes: ch }); this.afterEdit(); notice(`${this.app.entities()[from].name} → ${this.app.entities()[this.target].name} (${ch.length} parcelles)`); }
  }

  // clic sur le globe
  click(cell) {
    const owner = this.ownerArray();
    if (this.placingCapital !== null) {
      const e = this.placingCapital;
      const ent = this.app.entities()[e];
      const g = this.app.grid;
      ent.capital = { name: ent.capitalName || ent.name, lat: g.lat[cell], lon: g.lon[cell] };
      delete ent.capitalName;
      this.placingCapital = null;
      // territoire initial autour de la capitale
      const saveBrush = this.brush, saveTarget = this.target;
      this.target = e; this.brush = Math.max(2, this.brush);
      this.stroke = { changes: new Map(), only: null };
      const tool = this.tool; this.tool = 'give';
      this.paint(cell);
      this.tool = tool;
      this.endStroke();
      this.brush = saveBrush; this.target = saveTarget;
      this.setTarget(e);
      notice(`Capitale de ${ent.name} placée. Peignez son territoire avec « Donner un territoire ».`, 3500);
      return;
    }
    if (cell < 0) return;
    if (this.tool === 'transfer') { this.transferCountry(owner[cell]); return; }
    if (this.tool === 'select' && owner[cell] !== NONE) this.setTarget(owner[cell]);
  }

  // ---------- annuler / rétablir ----------
  pushUndo(action) { this.undo.push(action); if (this.undo.length > 100) this.undo.shift(); this.redo = []; this.updateUndoButtons(); }
  updateUndoButtons() { $('undoBtn').disabled = !this.undo.length; $('redoBtn').disabled = !this.redo.length; }

  applyAction(a, dir) {
    if (a.kind === 'owner') {
      for (const [i, before, after] of a.changes) this.setCell(i, dir < 0 ? before : after);
      this.afterEdit();
    } else if (a.kind === 'entity') {
      const ent = this.app.entities()[a.index];
      Object.assign(ent, JSON.parse(dir < 0 ? a.before : a.after));
      this.applyEntityToSim(a.index);
      this.app.refreshParams();
      this.refreshAll();
    } else if (a.kind === 'teams') {
      this.world.teams = JSON.parse(dir < 0 ? a.before : a.after);
      this.refreshAll();
    }
  }
  doUndo() { const a = this.undo.pop(); if (!a) return; this.applyAction(a, -1); this.redo.push(a); this.updateUndoButtons(); notice('↶ Modification annulée'); }
  doRedo() { const a = this.redo.pop(); if (!a) return; this.applyAction(a, 1); this.undo.push(a); this.updateUndoButtons(); notice('↷ Modification rétablie'); }

  // ---------- édition d'un pays ----------
  entitySnapshot(e) { const x = this.app.entities()[e]; return JSON.stringify({ stats: x.stats, population: x.population, strategy: x.strategy, unitsOverride: x.unitsOverride, name: x.name, capital: x.capital }); }

  editEntity(e, fn) {
    const before = this.entitySnapshot(e);
    fn(this.app.entities()[e]);
    const after = this.entitySnapshot(e);
    if (before !== after) this.pushUndo({ kind: 'entity', index: e, before, after });
    this.applyEntityToSim(e);
  }

  applyEntityToSim(e) {
    const sim = this.sim;
    if (!sim) return;
    const k = sim.sides.findIndex((s) => s.e === e);
    if (k < 0) return;
    sim.applyEntity(k, this.app.entities()[e]);
  }

  renderCountry() {
    const el = $('ctlCountry');
    const e = this.target;
    const ent = e >= 0 ? this.app.entities()[e] : null;
    $('brushTarget').innerHTML = ent ? `Pays actif : ${colorDot(ent)} <b>${esc(ent.name)}</b>` : 'Pays actif : <b>aucun</b> — cliquez sur un pays avec l\'outil Sélection';
    if (!ent || ent.kind === 'neutral') { el.innerHTML = '<h4>PAYS</h4><p class="hint">Sélectionnez un pays pour modifier ses paramètres.</p>'; return; }
    const cells = this.app.cellCounts()[e] || 0;
    const sim = this.sim;
    const side = sim ? sim.sides.find((s) => s.e === e) : null;
    const units = side ? Math.round(side.units) : Math.round(ent.unitsOverride || this.app.unitsFor({ e }, {}));
    const teams = this.world.teams;
    const myTeam = teams.findIndex((t) => t.members.includes(e));
    el.innerHTML = `<h4>PAYS : ${esc(ent.name.toUpperCase())}</h4>
      <p class="hint">${fmtInt(cells)} parcelles · ${fmtInt(ent.population)} habitants · ${fmtInt(units)} unités${side ? ' (en simulation)' : ''}</p>
      <div class="ctl-stats">
        ${STAT_FIELDS.map(([k, l]) => `<label><span>${l}</span><output>${ent.stats[k]}</output></label><input type="range" min="5" max="100" step="1" value="${ent.stats[k]}" data-stat="${k}">`).join('')}
        <label><span>Population (millions)</span><output>${(ent.population / 1e6).toFixed(1).replace('.', ',')}</output></label><input type="range" min="0.01" max="1500" step="0.01" value="${ent.population / 1e6}" data-pop="1">
        <label><span>Nombre d'unités</span><output>${fmtInt(units)}</output></label><input type="range" min="5" max="5000" step="5" value="${units}" data-units="1">
        <label><span>Stratégie</span></label>
        <select data-strat="1" style="width:100%;padding:5px;background:rgba(0,0,0,.35);color:var(--text);border:1px solid var(--line);border-radius:6px">
          ${[['equilibree', 'Équilibrée'], ['agressive', 'Agressive'], ['defensive', 'Défensive']].map(([v, l]) => `<option value="${v}" ${(ent.strategy || 'equilibree') === v ? 'selected' : ''}>${l}</option>`).join('')}
        </select>
        <label><span>Équipe</span></label>
        <select data-team="1" style="width:100%;padding:5px;background:rgba(0,0,0,.35);color:var(--text);border:1px solid var(--line);border-radius:6px">
          <option value="-1">— Aucune (ne participe pas)</option>
          ${teams.map((t, k) => `<option value="${k}" ${k === myTeam ? 'selected' : ''}>${esc(t.name)}</option>`).join('')}
        </select>
      </div>`;
    el.querySelectorAll('[data-stat]').forEach((inp) => {
      inp.addEventListener('input', () => { inp.previousElementSibling.querySelector('output').textContent = inp.value; });
      inp.addEventListener('change', () => this.editEntity(e, (x) => { x.stats[inp.dataset.stat] = Number(inp.value); }));
    });
    const pop = el.querySelector('[data-pop]');
    pop.addEventListener('input', () => { pop.previousElementSibling.querySelector('output').textContent = Number(pop.value).toFixed(1).replace('.', ','); });
    pop.addEventListener('change', () => this.editEntity(e, (x) => { x.population = Math.round(Number(pop.value) * 1e6); }));
    const un = el.querySelector('[data-units]');
    un.addEventListener('input', () => { un.previousElementSibling.querySelector('output').textContent = fmtInt(un.value); });
    un.addEventListener('change', () => this.editEntity(e, (x) => { x.unitsOverride = Number(un.value); }));
    el.querySelector('[data-strat]').addEventListener('change', (ev) => this.editEntity(e, (x) => { x.strategy = ev.target.value; }));
    el.querySelector('[data-team]').addEventListener('change', (ev) => this.setTeamOf(e, Number(ev.target.value)));
  }

  // ---------- équipes ----------
  teamsEdit(fn) {
    const before = JSON.stringify(this.world.teams);
    fn(this.world.teams);
    const after = JSON.stringify(this.world.teams);
    if (before !== after) this.pushUndo({ kind: 'teams', before, after });
    this.refreshAll();
  }

  setTeamOf(e, k) {
    this.teamsEdit((teams) => {
      teams.forEach((t) => { t.members = t.members.filter((m) => m !== e); });
      if (k >= 0 && teams[k]) teams[k].members.push(e);
    });
    if (this.sim) {
      const side = this.sim.sides.find((s) => s.e === e);
      if (side && k >= 0 && k < this.sim.teams.length) { this.sim.setTeam(side.index, k); notice('Alliance modifiée en direct'); }
      else if (!side && k >= 0) notice('Ce pays rejoindra la prochaine simulation lancée.');
    }
  }

  addTeam(silent = false) {
    this.teamsEdit((teams) => { const k = teams.length; teams.push({ name: teamName(k), color: TEAM_COLORS[k % TEAM_COLORS.length], members: [] }); });
    if (!silent) notice('Équipe créée : ajoutez-y des pays via la fiche du pays actif.');
  }

  renderTeams() {
    const teams = this.world.teams;
    const ents = this.app.entities();
    $('ctlTeams').innerHTML = teams.length ? teams.map((t, k) => `
      <div class="ctl-team"><i style="background:${t.color}"></i><span><b>${esc(t.name)}</b> — ${t.members.map((e) => esc(ents[e] ? ents[e].name : '?')).join(', ') || '<em class="hint">vide</em>'}</span>
      ${this.target >= 0 && !t.members.includes(this.target) ? `<button class="btn ghost xs icon" data-addto="${k}" title="Ajouter le pays actif">${icon('plus')}</button>` : ''}
      <button class="btn ghost xs icon" data-delteam="${k}" title="Supprimer l'équipe">${icon('x')}</button></div>`).join('')
      : '<p class="hint">Aucune équipe. Créez au moins 2 équipes pour lancer une simulation.</p>';
    $('ctlTeams').querySelectorAll('[data-addto]').forEach((b) => b.addEventListener('click', () => this.setTeamOf(this.target, Number(b.dataset.addto))));
    $('ctlTeams').querySelectorAll('[data-delteam]').forEach((b) => b.addEventListener('click', () => this.teamsEdit((teams) => teams.splice(Number(b.dataset.delteam), 1))));
  }

  // ---------- simulation ----------
  startSim() {
    const teams = this.world.teams.filter((t) => t.members.length);
    const cells = this.app.cellCounts();
    const valid = teams.map((t) => ({ ...t, members: t.members.filter((e) => cells[e] > 0) })).filter((t) => t.members.length);
    if (valid.length < 2) { notice('Créez au moins 2 équipes contenant des pays qui possèdent un territoire.', 3500); return; }
    const participants = [];
    valid.forEach((t, ti) => t.members.forEach((e) => {
      const ent = this.app.entities()[e];
      participants.push({ e, team: ti, strategy: ent.strategy, units: ent.unitsOverride || 0 });
    }));
    const setup = {
      participants,
      teams: valid.map((t) => ({ name: t.name, color: t.color })),
      options: { seed: randomSeedString(), eventRate: Number($('ctlEvents').value), randomness: Number($('ctlRand').value), maxDuration: 600, victoryRatio: 0.35, naval: true, speed: 1 },
      label: 'Contrôle total',
      mode: 'control',
    };
    this.app.launch(setup, null, { control: true });
    this.refreshSim();
  }

  changeSpeed(dir) {
    const speeds = [0.5, 1, 2, 4, 8];
    const s = this.app.session;
    const k = Math.max(0, Math.min(speeds.length - 1, speeds.indexOf(s.speed) + dir));
    this.app.setSpeed(speeds[k]);
    this.refreshSim();
  }

  refreshSim() {
    const s = this.app.session;
    $('ctlSimInfo').textContent = s.sim ? `Simulation ${s.state === 'running' ? 'en cours' : s.state === 'paused' ? 'en pause' : 'terminée'} · vitesse ${String(s.speed).replace('.', ',')}× · ${s.sim.sides.length} pays` : 'Aucune simulation en cours. Préparez le monde puis lancez.';
  }

  manualEvent(id) {
    const sim = this.sim;
    if (id === '__team') { this.addTeam(); return; }
    if (!sim) { notice('Lancez d\'abord une simulation (section SIMULATION).'); return; }
    const side = sim.sides.findIndex((s) => s.e === this.target);
    if (side < 0) { notice('Le pays actif ne participe pas à la simulation en cours.'); return; }
    if (id === '__territory') {
      const n = sim.flipClusterFrom(side, Math.max(5, Math.round(sim.sides[side].initial * 0.05)));
      sim._emit({ icon: '🗺️', title: 'CHANGEMENT DE TERRITOIRE', tone: 'bad', side, manual: true, text: `${sim.name(side)} perd ${n} parcelles au profit d'un voisin.` });
      return;
    }
    sim.triggerEvent(id, side, true);
  }

  // ---------- nouveau pays ----------
  openNewCountry() {
    this.app.countryDialog.open({
      title: 'Créer un pays',
      info: 'Après la création, cliquez sur la carte pour placer la capitale ; un territoire initial est créé autour.',
      onDone: (spec) => this.createCountry(spec),
    });
  }

  createCountry(spec) {
    const app = this.app;
    const ents = app.entities();
    if (ents.length >= 500) { notice('Nombre maximal de pays atteint.'); return; }
    const ent = {
      index: ents.length, id: 'C' + ents.length, kind: 'custom', name: spec.name, continent: spec.continent,
      flag: spec.flag, color: spec.color, color2: spec.color2,
      capital: null, capitalName: spec.capitalName, population: spec.population, stats: spec.stats, alive: true,
    };
    ents.push(ent);
    app.renderer.addEntity(ent);
    this.placingCapital = ent.index;
    this.target = ent.index;
    notice(`${spec.name} créé : cliquez sur la carte pour placer sa capitale.`, 5000);
    this.refreshAll();
  }

  saveWorld() {
    const w = this.world;
    if (this.sim) w.owner = Uint16Array.from(this.sim.owner);
    w.history = w.history || [];
    w.history.push({ year: w.year, title: 'Modifications manuelles', text: 'Monde édité en mode Contrôle total.', date: new Date().toISOString() });
    this.app.worldsUI.openSave(w, 'Les frontières modifiées, les pays créés, les équipes et les statistiques seront enregistrés.');
  }

  refreshAll() {
    if (!this.active) return;
    $('ctlWorld').textContent = `${this.world.name} · année ${this.world.year}`;
    this.renderCountry();
    this.renderTeams();
    this.refreshSim();
    this.updateUndoButtons();
  }
}

export { countCells };
