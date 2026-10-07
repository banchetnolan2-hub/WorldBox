// WORLD SIMULATOR — point d'entrée : globe, mondes, créateur de partie, simulation, Contrôle total.
import { WorldViews } from './ui/worldViews.js';
import { BorderEditorUI } from './ui/borderEditor.js';
import { activeOverrides } from './sim/borderEdit.js';
import { CoalitionUI } from './ui/coalitionUI.js';
import { loadWorldData } from './world/loadWorld.js';
import { createOriginalWorld, cloneWorld, applySimulationToWorld, serializeWorld, deserializeWorld, countCells, NONE } from './world/worldState.js';
import { cellAtLatLon, EARTH_R } from './world/worldGrid.js';
import { buildDetails } from './world/details.js';
import { buildGridFromTerrain } from './world/terrain.js';
import { Navigator } from './world/navigation.js';
import { GlobeRenderer } from './globe/globeRenderer.js';
import { Session } from './game/session.js';
import { participantProfile } from './sim/worldSim.js';
import { geoFor, BIOME_COLORS } from './sim/geo.js';
import { randomSeedString } from './sim/rng.js';
import { audio } from './audio/audio.js';
import { Store, newId } from './save/store.js';
import { $, show, isShown, notice, esc, fmtTime, TEAM_COLORS, teamName, seg } from './ui/util.js';
import { Labels } from './ui/labels.js';
import { PickerDialog } from './ui/picker.js';
import { Creator, defaultCreatorConfig } from './ui/creator.js';
import { Hud, SPEEDS } from './ui/hud.js';
import { renderResults } from './ui/results.js';
import { WorldsUI } from './ui/worlds.js';
import { ControlMode } from './ui/control.js';
import { WorldEditor } from './ui/worldEditor.js';
import { CountryDialog } from './ui/countryDialog.js';
import { hydrateIcons } from './ui/icons.js';
import { isSavedWorld } from './ui/worlds.js';
import { WarUI } from './ui/warUI.js';
import { NationUI, NATION_SPEEDS } from './ui/nationUI.js';
import { MenuUI } from './ui/menu.js';
import { RulesUI, rulesBadge } from './ui/rulesUI.js';
import { WarEndUI } from './ui/warEndUI.js';
import { ScenarioEditor } from './ui/scenarioEditor.js';
import { GameNav } from './ui/gameNav.js';
import { NetUI, commandHooks } from './ui/netUI.js';
import { execCommand } from './net/commands.js';
import { GuideUI } from './ui/guide.js';
import { RecapUI } from './ui/recap.js';
import { TuningUI } from './ui/tuningUI.js';
import { ForcesUI } from './ui/forcesUI.js';
import { applyTheme, themePickerHtml, UI_SIZES } from './ui/themes.js';
import { NOTIF_LEVELS, AUTO_PAUSE, defaultAutoPause } from './ui/notify.js';

const DEG = 180 / Math.PI;
// vitesse des transitions de frontière (durée en secondes)
export const TRANSITIONS = { 'tres-lente': 3.2, lente: 2.1, normal: 1.3, rapide: 0.7 };

class App {
  async boot() {
    hydrateIcons();
    $('bootText').textContent = 'Chargement de la grille mondiale…';
    const { grid, nav, countriesData, hires, relief, borders, territories } = await loadWorldData();
    this.relief = relief;
    this.grid = grid; this.nav = nav; this.countriesData = countriesData;
    // contexte de la Terre : grille, navigation, relief réel et vraies frontières
    this.earthCtx = { grid, nav, relief, hires, earth: true };
    this.earthGrid = grid;
    this.ctx = this.earthCtx;
    this.canvas = $('globe');
    $('bootText').textContent = 'Préparation du globe en relief…';
    await new Promise((r) => setTimeout(r, 20));
    this.renderer = new GlobeRenderer(this.canvas, grid, hires, relief);
    this.world = createOriginalWorld(grid, countriesData);
    await this.renderer.init(this.world.entities);
    try { this.renderer.setBorders(borders); } catch (e) { console.warn('frontières vectorielles', e); }
    try { this.renderer.setTerritoryGeometry(grid, territories); } catch (e) { console.warn('géométrie des territoires', e); }
    // carte détaillée de la Terre : villes, régions, ports, lacs, routes
    $('bootText').textContent = 'Villes, régions et ports…';
    await new Promise((r) => setTimeout(r, 10));
    try { this.earthDetails = buildDetails(grid, this.world.owner, this.world.entities); this.renderer.setDetails(this.earthDetails); } catch (e) { console.warn('détails', e); this.earthDetails = null; }
    this.session = new Session(this);
    this.labels = new Labels($('labels'), this);
    this.picker = new PickerDialog(this);
    this.creator = new Creator(this);
    this.hud = new Hud(this);
    this.worldsUI = new WorldsUI(this);
    this.countryDialog = new CountryDialog();
    this.control = new ControlMode(this);
    this.editor = new WorldEditor(this);
    this.warUI = new WarUI(this);
    this.nationUI = new NationUI(this);
    this.rulesUI = new RulesUI();
    this.warEndUI = new WarEndUI();
    this.scenarioEditor = new ScenarioEditor(this);
    this.menuUI = new MenuUI(this);
    this.gameNav = new GameNav(this);
    this.coalitionUI = new CoalitionUI(this);
    this.borderEditor = new BorderEditorUI(this);
    this.worldViews = new WorldViews(this);
    this.netUI = new NetUI(this);
    this.guide = new GuideUI(this);
    this.recap = new RecapUI(this);
    this.tuningUI = new TuningUI(this);
    this.forcesUI = new ForcesUI(this);
    this.notice = notice;
    this.cmdHooks = commandHooks(this);
    this.screen = 'menu';
    this.cellCountsDirty = true;
    this.settings = { music: 0.55, sfx: 0.7, mute: false, flags: true, labels: true, markers: true, capitals: true, transition: 'normal', lastWorld: 'original' };
    const saved = await Store.read('reglages', 'settings');
    if (saved) Object.assign(this.settings, saved);
    audio.setSettings(this.settings);
    applyTheme(this.settings);
    this.applyDisplaySettings();
    if (this.settings.lastWorld && this.settings.lastWorld !== 'original') {
      try { await this.worldsUI.load(this.settings.lastWorld, true); } catch (_) { /* monde supprimé */ }
    }
    this.setWorld(this.world, true);
    this.session.onEvent = (e) => {
      // nouvel État créé en cours de partie (indépendance, séparation…) : le rendu doit connaître sa couleur
      if (e.newState >= 0 && this.entities()[e.newState]) { try { this.renderer.addEntity(this.entities()[e.newState]); this.refreshParams(); if (this.labels.invalidate) this.labels.invalidate(); } catch (err) { console.warn(err); } this.cellCountsDirty = true; }
      this.hud.event(e, this.session.sim); this.nationUI.onEvent(e);
    };
    if (!this.settings.autoPause) this.settings.autoPause = defaultAutoPause();
    this.session.onEnd = (res) => this.onEnd(res);
    this.session.onWarEnded = (id) => this.onWarEnded(id);
    this._bindMenu();
    this._bindHud();
    this._bindDialogs();
    this._bindInput();
    this._bindKeys();
    window.addEventListener('resize', () => this.renderer.resize());
    const unlock = () => { audio.unlock(); };
    window.addEventListener('pointerdown', unlock);
    window.addEventListener('keydown', unlock);
    this.renderer.cam.idleSpin = 3;
    this.goMenu();
    $('boot').style.opacity = '0';
    setTimeout(() => show('boot', false), 520);
    this.last = performance.now();
    this.hudAt = 0;
    requestAnimationFrame((t) => this.frame(t));
  }

  // ---------------- monde ----------------
  entities() { return this.world.entities; }
  cellCounts() {
    if (this.cellCountsDirty || !this._counts) {
      const owner = this.session.sim ? this.session.sim.owner : this.world.owner;
      this._counts = countCells({ owner, entities: this.world.entities });
      this.cellCountsDirty = false;
      this._countsAt = performance.now();
    }
    return this._counts;
  }
  currentCellCount(e) {
    if (this.session.sim && performance.now() - (this._countsAt || 0) > 1000) this.cellCountsDirty = true;
    return this.cellCounts()[e] || 0;
  }
  totalLandCells() { return this.grid.n; }

  // unités terrestres (1 unité ≈ 1 000 soldats) d'après la fiche complète du pays et les réglages du créateur
  unitsFor(m, opt) {
    const ent = this.entities()[m.e];
    if (!ent || !ent.stats) return 0;
    const prof = participantProfile(ent, m, {});
    const pop = (m.popMult || 1) * (opt.popAll || 1), pow = (m.powerMult || 1) * (opt.powerAll || 1);
    const k = pow * (pop > 1 ? Math.pow(pop, 0.33) : Math.pow(pop, 0.5));
    return (prof.army.inf + prof.army.arm + prof.army.art + prof.army.rec) * k;
  }

  // biomes et rivières affichés (calcul différé : pas de ralentissement pendant l'édition)
  refreshGeo(delay = 400) {
    clearTimeout(this._geoT);
    this._geoT = setTimeout(() => {
      try { this.renderer.setGeo(this.settings.geo === false ? null : this.geoFor(this.world), BIOME_COLORS); } catch (e) { console.warn(e); }
    }, delay);
  }

  // géographie (biomes, rivières) du monde affiché
  geoFor(w) {
    const ctx = this.contextFor(w);
    return geoFor(ctx.grid, ctx.relief, { override: w && w.biomes, overrideVersion: w && w.biomesVersion });
  }

  // villes, régions et ports réels : seulement sur la Terre
  detailsFor(w) { return this.contextFor(w).earth ? this.earthDetails || null : null; }

  // contexte (grille + navigation + relief) d'un monde : la Terre, ou celui dérivé de son terrain
  contextFor(w) {
    if (!w || !w.terrain) return this.earthCtx;
    const t = w.terrain;
    if (t._ctx && t._ctx.version === t.version) return t._ctx;
    const { grid } = buildGridFromTerrain(t, null);
    t._ctx = { grid, nav: new Navigator(grid), relief: t, hires: null, earth: false, version: t.version };
    return t._ctx;
  }

  applyContext(ctx) {
    if (ctx === this.ctx && this.renderer.grid === ctx.grid) return;
    this.ctx = ctx;
    this.grid = ctx.grid;
    this.nav = ctx.nav;
    this.renderer.setContext(ctx);
    this.renderer.detailsOn = !!ctx.earth && this.settings.details !== false;
    this.labels && this.labels.clear();
  }

  setWorld(w, silent = false) {
    this.applyContext(this.contextFor(w));
    this.world = w;
    this.renderer.entities = w.entities;
    for (const e of w.entities) if (e.kind === 'custom') this.renderer.addEntity(e);
    this.cellCountsDirty = true;
    if (!this.session.sim) this.session.showWorld(w, null);
    this.renderer.updateEntityParams(w.owner, null);
    this.labels.clear();
    this.refreshGeo();
    $('worldName').textContent = w.name + (w.unsaved ? ' (non sauvegardé)' : '');
    $('worldMeta').textContent = `Année ${w.year} · ${(w.history || []).length} entrée(s) d'historique`;
    this.settings.lastWorld = isSavedWorld(w.id) ? w.id : 'original';
    this.saveSettings();
    void silent;
  }

  refreshParams() {
    const owner = this.session.sim ? this.session.sim.owner : this.world.owner;
    const parts = this.session.sim ? new Set(this.session.sim.sides.map((s) => s.e)) : null;
    this.renderer.updateEntityParams(owner, parts);
  }

  previewParticipants(set) {
    if (this.session.sim) return;
    this.renderer.updateEntityParams(this.world.owner, set && set.size ? set : null);
  }

  saveSettings() { Store.write('reglages', 'settings', this.settings); }

  applyDisplaySettings() {
    this.renderer.shadows = this.settings.flags !== false;
    this.renderer.transition = TRANSITIONS[this.settings.transition] || TRANSITIONS.normal;
    this.labels.capitals = this.settings.capitals !== false;
    this.renderer.detailsOn = !!(this.ctx && this.ctx.earth) && this.settings.details !== false;
    this.renderer.showMarkers = this.settings.markers;
    this.labels.enabled = this.settings.labels;
    this.hud && this.hud.setToggle('markersBtn', this.settings.markers);
    this.hud && this.hud.setToggle('labelsBtn', this.settings.labels);
    this.hud && this.hud.setToggle('audioBtn', !this.settings.mute);
  }

  // ---------------- écrans ----------------
  hideAll() {
    for (const id of ['menu', 'creator', 'hud', 'results', 'pause', 'worlds', 'loadGame', 'settings', 'saveWorldDialog', 'picker', 'warEnded', 'warReport', 'warsPanel', 'worldHistoryPanel', 'nationPick', 'storyPick']) show(id, false);
    this.nationUI.end();
    if (this.forcesUI) { this.forcesUI.cancelPick(); this.forcesUI.hideCard(); }
    if (this.gameNav) this.gameNav.showRail(false);
    for (const id of ['rulesDialog', 'scenarioEditor']) if ($(id)) show(id, false);
    this._overlayPaused = false;
    if (this.control.active) this.control.exit();
    if (this.editor && this.editor.active) this.editor.exit();
  }

  goMenu() {
    clearTimeout(this.spectatorTimer);
    $('hud').classList.remove('with-control');
    document.body.classList.remove('control-on');
    this.hideAll();
    if (this.netUI && this.netUI.net) { this.netUI.net.close(); this.netUI.net = null; this.session.net = null; }
    this.session.stop();
    this.spectator = false;
    this.hud.setCinema(false);
    this.hud.hideCountry();
    this.renderer.selected = -1;
    this.setWorld(this.world, true);
    this.screen = 'menu';
    this.renderer.cam.idleSpin = 3;
    this.renderer.cam.flyTo(28, this.renderer.cam.lon, 3.1, 1.2);
    show('menu');
    this.menuUI.refresh();
    audio.play('menu');
  }

  openCreator(cfg = null) {
    clearTimeout(this.spectatorTimer);
    if (!cfg && this.world.simSettings) cfg = JSON.parse(JSON.stringify(this.world.simSettings));
    this.hideAll();
    this.session.stop();
    this.setWorld(this.world, true);
    this.screen = 'creator';
    this.renderer.cam.idleSpin = 0;
    this.creator.open(cfg);
    audio.play('menu');
  }

  // lancement d'une simulation
  launch(setup, creatorCfg, opts = {}) {
    clearTimeout(this.spectatorTimer);
    const keepControl = opts.control && this.control.active;
    if (!keepControl) this.hideAll();
    else for (const id of ['results', 'pause']) show(id, false);
    this.lastSetup = JSON.parse(JSON.stringify(setup));
    if (creatorCfg) { this.lastCreator = creatorCfg; this.world.simSettings = JSON.parse(JSON.stringify(creatorCfg)); }
    for (const p of setup.participants) {
      const ent = this.entities()[p.e];
      if (!p.units && ent.unitsOverride) p.units = ent.unitsOverride;
      if (!p.strategy && ent.strategy) p.strategy = ent.strategy;
    }
    this.spectator = !!opts.spectator;
    this.screen = keepControl ? 'control' : 'game';
    this.renderer.cam.idleSpin = 0;
    // départ « autour de la capitale » : le reste du territoire des participants devient une zone grise à conquérir
    let simWorld = this.world;
    if (!opts.restore && setup.options.start === 'capital') simWorld = this.capitalStartWorld(setup);
    if (!opts.net && this.netUI && this.netUI.net) { this.netUI.net.close(); this.netUI.net = null; }
    const sim = this.session.start(simWorld, setup, opts.restore || null);
    // multijoueur : pays de cet ordinateur, et ordres des joueurs (exécutés partout au même pas)
    if (opts.localSide !== undefined && opts.localSide !== null) sim.localSide = opts.localSide;
    sim.cmdSink = (cmd) => this.act(cmd);
    this.session.net = null;            // branché à la fin (les réglages locaux ne doivent pas être envoyés à l'hôte)
    this.cellCountsDirty = true;
    this.hud.setup(sim, setup.label);
    this.hud.show(!keepControl || true);
    this.hud.setCinema(this.spectator);
    this.setSpeed(opts.spectator ? Math.max(2, setup.options.speed || 2) : (setup.options.speed || 1));
    if (setup.mode === 'nation' && sim.nv) this.nationUI.begin(sim, setup);
    this.renderer.setBorderOverrides(activeOverrides(sim));         // frontières dessinées à la main (sauvegarde)
    this.gameNav.showRail(!this.spectator);
    this._autosaveAt = performance.now();
    this.hud.setPaused(false);
    this.session.setCamMode(this.spectator ? 'auto' : 'libre');
    this.hud.setCam(this.session.camMode);
    this.labels.clear();
    audio.play('sim');
    if (keepControl) { show('hud'); this.control.refreshSim(); }
    if (opts.net) { this.session.net = opts.net; this.session.state = 'running'; }
    if (this.pendingHost && sim.nation && !opts.net) { this.pendingHost = false; setTimeout(() => { if (this.session.sim === sim) this.netUI.host(); }, 700); }
    return sim;
  }

  // ---------------- ordres des joueurs (solo : immédiat ; multijoueur : via l'hôte) ----------------
  act(cmd) {
    const sim = this.session.sim;
    if (!sim) return null;
    if (cmd.a === undefined) cmd.a = sim.localSide ?? (sim.nation ? sim.nation.player : -1);
    const net = this.session.net;
    if (net && net.active) return net.submit(JSON.parse(JSON.stringify(cmd)));
    return execCommand(sim, cmd, this.cmdHooks);
  }
  // état complet de la partie (capturé immédiatement) pour un joueur qui rejoint
  async netSnapshot() {
    const sim = this.session.sim;
    const state = JSON.parse(JSON.stringify(sim.serialize()));
    const origin = sim.origin.slice();
    const setup = JSON.parse(JSON.stringify(this.lastSetup));
    const creator = this.lastCreator ? JSON.parse(JSON.stringify(this.lastCreator)) : null;
    const world = await serializeWorld({ ...this.world, owner: origin });
    return { world, worldId: this.world.id, setup, creator, sim: state };
  }
  // invité : chargement de l'état reçu de l'hôte
  async netLoad(data, side, net) {
    const w = await deserializeWorld(data.world, this, this.countriesData);
    w.id = data.worldId || w.id;
    this.setWorld(w, true);
    this.lastCreator = data.creator;
    for (const id of ['loadGame', 'menu', 'nationPick', 'mpDialog']) show(id, false);
    this.launch(data.setup, data.creator, { restore: data.sim, localSide: side, net });
    this.refreshParams();
  }

  capitalStartWorld(setup) {
    const g = this.grid;
    const owner = Uint16Array.from(this.world.owner);
    const counts = this.cellCounts();
    for (const p of setup.participants) {
      const ent = this.entities()[p.e];
      if (!ent || !ent.capital) continue;
      const rKm = Math.max(140, Math.sqrt(counts[p.e] || 1) * 28 * 0.3);
      const phi = ent.capital.lat * Math.PI / 180, lam = ent.capital.lon * Math.PI / 180;
      const cx = Math.cos(phi) * Math.sin(lam), cy = Math.sin(phi), cz = Math.cos(phi) * Math.cos(lam);
      const cosMax = Math.cos(rKm / EARTH_R);
      for (let i = 0; i < g.n; i++) {
        if (owner[i] !== p.e) continue;
        const dot = g.xyz[i * 3] * cx + g.xyz[i * 3 + 1] * cy + g.xyz[i * 3 + 2] * cz;
        if (dot < cosMax) owner[i] = NONE;
      }
    }
    return { ...this.world, owner };
  }

  setSpeed(s) { this.session.setSpeed(s); this.hud.setSpeed(s); }

  restart(sameSeed) {
    if (!this.lastSetup) return;
    const setup = JSON.parse(JSON.stringify(this.lastSetup));
    if (!sameSeed) setup.options.seed = randomSeedString();
    this.launch(setup, this.lastCreator, { spectator: this.spectator, control: this.control.active });
  }

  // fin d'une guerre : écran WAR ENDED pour les guerres importantes (ou celles du pays suivi)
  onWarEnded(id) {
    const sim = this.session.sim;
    if (!sim) return;
    const w = sim.wars.find((x) => x.id === id);
    if (!w || sim.finished) return;
    const members = [...w.a, ...w.b].map((k) => sim.sides[k].e);
    const km2 = w.treaty ? w.treaty.transfers.reduce((t, x) => t + x.km2, 0) : 0;
    const mine = sim.nv && members.includes(sim.sides[sim.nv.player].e);
    if (mine && !this.wantsAutoPause('warEnd')) { this.hud.warToast(w, () => this.warUI.openReport(this.warUI.liveWar(id))); return; }
    const major = mine || (!sim.nv && (sim.sides.length <= 10 || km2 > 250000)) || members.includes(this.renderer.selected) || members.some((e) => this.hud.selected === e);
    if (major && !this.spectator && !this.warUI.isOpen()) setTimeout(() => { if (this.session.sim === sim) this.warUI.showEnded(id); }, 900);
    else this.hud.warToast(w, () => this.warUI.openReport(this.warUI.liveWar(id)));
  }
  // pause automatique choisie par le joueur pour un type d'événement (Mode Nation)
  wantsAutoPause(kind) {
    const ap = { ...defaultAutoPause(), ...(this.settings.autoPause || {}) };
    return ap[kind] !== false;
  }
  // réglages avancés de la partie en cours (hôte : modifiables ; invité : lecture seule)
  openTuning() {
    const sim = this.session.sim;
    if (!sim) return;
    const n = sim.nation;
    const readonly = !!(n && sim.localSide !== undefined && sim.localSide !== null && sim.localSide !== n.player);
    this.tuningUI.open({ tuning: sim.tuning, inGame: true, readonly, onDone: (t) => this.act({ op: 'tuning', t }) });
  }
  pauseForOverlay() {
    if (this.session.net && this.session.net.active) return;      // partie partagée : un panneau ne met pas tout le monde en pause
    if (this.session.state === 'running') { this.session.pause(); this.hud.setPaused(true); this._overlayPaused = true; }
  }
  resumeAfterOverlay() {
    if (this.warUI.isOpen()) return;
    if (this._overlayPaused && this.session.state === 'paused') { this.session.resume(); this.hud.setPaused(false); }
    this._overlayPaused = false;
  }

  onEnd(res) {
    audio.play('end');
    audio.sfx('victory');
    this.hud.update(this.session.sim);
    setTimeout(() => {
      if (this.session.state !== 'ended') return;
      renderResults(this, this.session.sim);
      show('results');
      $('spectatorNext').textContent = '';
      if (this.spectator) {
        let left = 8;
        const tick = () => {
          if (!this.spectator || this.session.state !== 'ended') return;
          if (left <= 0) { this.spectatorNext(); return; }
          $('spectatorNext').textContent = `Mode spectateur : prochaine simulation dans ${left} s…`;
          left--;
          this.spectatorTimer = setTimeout(tick, 1000);
        };
        tick();
      }
    }, 1400);
    void res;
  }

  // monde résultant de la simulation terminée
  resultingWorld() {
    const base = cloneWorld(this.world);
    if (this.world.id === 'original' || this.world.readonly) { base.id = null; base.name = 'Nouveau monde'; }
    return applySimulationToWorld(base, this.session.sim, this.lastSetup ? this.lastSetup.label : '');
  }

  continueWorld() {
    const w = this.resultingWorld();
    if (!w.id) { w.id = newId('monde'); w.name = `Monde ${String(Date.now()).slice(-4)}`; }
    w.unsaved = false;
    // sauvegarde automatique pour ne pas perdre la génération
    const key = w.id && w.id.startsWith('w:') ? w.id.slice(2) : null;
    (key ? Promise.resolve(key) : this.worldsUI.freeKey(w.name.replace(/[^a-zA-Z0-9_-]+/g, '') || 'Monde')).then((k) => {
      w.id = 'w:' + k;
      this.setWorld(w);
      return this.worldsUI.writeWorld(w, k);
    }).then(() => notice(`${w.name} — année ${w.year} enregistrée. Nouvelle simulation sur ce monde.`, 3500));
    this.setWorld(w);
    const cfg = this.lastCreator ? JSON.parse(JSON.stringify(this.lastCreator)) : defaultCreatorConfig();
    cfg.options.seed = randomSeedString();
    this.openCreator(cfg);
  }

  // partie rapide : deux pays voisins tirés au hasard, lancement immédiat
  quickGame() {
    const ents = this.entities();
    const cells = this.cellCounts();
    const alive = ents.filter((e) => e.kind !== 'neutral' && cells[e.index] > 60 && e.capital);
    for (let t = 0; t < 40; t++) {
      const a = alive[Math.floor(Math.random() * alive.length)];
      const near = alive.filter((b) => b !== a && gcKm(a.capital, b.capital) < 1600);
      if (!near.length) continue;
      const b = near[Math.floor(Math.random() * near.length)];
      const setup = {
        participants: [{ e: a.index, team: 0 }, { e: b.index, team: 1 }], teams: [a, b].map((e) => ({ name: e.name, color: e.color })),
        options: { seed: randomSeedString(), eventRate: 1, randomness: 0.5, maxDuration: 300, victoryRatio: 0.35, naval: true, speed: 2, mode: 'sandbox' },
        label: `${a.name} VS ${b.name}`, mode: 'sandbox',
      };
      this.launch(setup, null);
      notice(`Partie rapide : ${a.name} contre ${b.name}.`, 3000);
      return;
    }
  }

  // ---------------- mode spectateur ----------------
  spectatorNext() {
    const ents = this.entities();
    const cells = this.cellCounts();
    const alive = ents.filter((e) => e.kind !== 'neutral' && cells[e.index] > 40 && e.capital);
    const a = alive[Math.floor(Math.random() * alive.length)];
    const near = alive.filter((b) => b !== a && gcKm(a.capital, b.capital) < 2400).sort(() => Math.random() - 0.5);
    const n = Math.min(near.length, 1 + Math.floor(Math.random() * 4));
    const list = [a, ...near.slice(0, n)];
    const teamsMode = list.length >= 4 && Math.random() < 0.5;
    const participants = list.map((e, k) => ({ e: e.index, team: teamsMode ? k % 2 : k }));
    const teams = teamsMode ? [0, 1].map((k) => ({ name: teamName(k), color: TEAM_COLORS[k] })) : list.map((e) => ({ name: e.name, color: e.color }));
    const setup = {
      participants, teams,
      options: { seed: randomSeedString(), eventRate: 1.2, randomness: 0.6, maxDuration: 240, victoryRatio: 0.35, naval: true, speed: 2 },
      label: list.length === 2 ? `${list[0].name} VS ${list[1].name}` : teamsMode ? 'Équipes' : `${list.length} pays`,
      mode: 'spectateur',
    };
    this.launch(setup, null, { spectator: true });
  }

  // ---------------- sélection ----------------
  selectEntity(e, fly = false) {
    if (e < 0 || e === NONE) { this.renderer.selected = -1; this.hud.hideCountry(); return; }
    this.renderer.selected = e;
    this.hud.sim = this.session.sim;
    this.hud.renderCountry(e);
    if (fly) this.centerOn(e);
    if (this.control.active && this.control.target !== e) { this.control.target = e; this.control.refreshAll(); }
  }

  centerOn(e) {
    const owner = this.session.sim ? this.session.sim.owner : this.world.owner;
    this.labels.compute(owner, new Set([e]));
    const a = this.labels.anchors.get(e);
    if (!a) return;
    const cnt = this.cellCounts()[e] || 1;
    const dist = Math.min(3.2, Math.max(1.25, 1.12 + Math.sqrt(cnt) * 0.0045));
    this.renderer.cam.flyTo(Math.asin(a.y) * DEG, Math.atan2(a.x, a.z) * DEG, dist, 1.8);
    this.labels.invalidate();
    if (this.session.camMode === 'auto') { this.session.setCamMode('libre'); this.hud.setCam('libre'); }
  }

  pickCell(sx, sy) {
    // micro-pays d'abord (pastilles)
    const g = this.grid;
    for (let i = g.nGrid; i < g.n; i++) {
      const p = this.renderer.project(g.xyz[i * 3], g.xyz[i * 3 + 1], g.xyz[i * 3 + 2], this.renderer.cellR ? this.renderer.cellR[i] : 1);
      if (p && Math.hypot(p[0] - sx, p[1] - sy) < 11) return i;
    }
    const hit = this.renderer.rayToLatLon(sx, sy);
    if (!hit) return -1;
    return cellAtLatLon(g, hit.lat, hit.lon);
  }

  ownerAt(cell) {
    if (cell < 0) return NONE;
    return this.session.sim ? this.session.sim.owner[cell] : this.world.owner[cell];
  }

  // ---------------- sauvegarde de partie ----------------
  async saveGame(auto = false) {
    const sim = this.session.sim;
    if (!sim || this.spectator) return;
    if (this.session.net && this.session.net.active && !this.session.net.isHost) { if (!auto) notice('Seul l\'hôte sauvegarde la partie partagée.'); return; }
    const id = auto ? 'sauvegarde-auto' : newId('partie');
    const name = (auto ? 'Sauvegarde automatique : ' : '') + (sim.nv ? `${this.lastSetup.label}, ${sim.dateStr(sim.time)}` : `${this.lastSetup.label}, ${sim.dateStr(sim.time)}`);
    const startWorld = await serializeWorld({ ...this.world, owner: sim.origin });
    const data = {
      meta: { name, updatedAt: new Date().toISOString(), world: this.world.name, time: sim.time },
      world: startWorld, worldId: this.world.id, setup: this.lastSetup, creator: this.lastCreator || null, sim: sim.serialize(),
    };
    const ok = await Store.write('parties', id, data);
    if (!auto || ok === false) notice(ok === false ? 'Échec de la sauvegarde.' : `Partie sauvegardée : ${name}`);
  }

  async openLoadGame() {
    show('loadGame');
    const list = await Store.list('parties');
    const el = $('gameList');
    el.innerHTML = list.length ? list.map((g) => {
      const m = g.meta || {};
      return `<li data-id="${esc(g.id)}"><div class="slot-main"><div class="slot-name">${esc(m.name || g.id)}</div>
        <div class="slot-meta">Monde : ${esc(m.world || '?')} · ${m.updatedAt ? new Date(m.updatedAt).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' }) : ''}</div></div>
        <button class="ghost small" data-act="load">Reprendre</button><button class="ghost small" data-act="del">🗑</button></li>`;
    }).join('') : '<li class="empty">Aucune partie sauvegardée. Utilisez 💾 pendant une simulation.</li>';
    el.querySelectorAll('li[data-id]').forEach((li) => {
      li.querySelector('[data-act=load]').onclick = () => this.loadGame(li.dataset.id);
      li.querySelector('[data-act=del]').onclick = async () => { await Store.remove('parties', li.dataset.id); this.openLoadGame(); };
    });
  }

  async loadGame(id) {
    const data = await Store.read('parties', id);
    if (!data) { notice('Partie introuvable'); return; }
    try {
      const w = await deserializeWorld(data.world, this, this.countriesData);
      w.id = data.worldId || w.id;
      this.setWorld(w, true);
      this.lastCreator = data.creator;
      show('loadGame', false);
      this.launch(data.setup, data.creator, { restore: data.sim });
      if (!this.pendingHost) this.session.pause();
      this.hud.setPaused(true);
      this.refreshParams();
      notice('Partie restaurée (en pause) — Espace pour reprendre.', 3500);
    } catch (e) { notice('Impossible de reprendre cette partie : ' + e.message, 4000); }
  }

  // ---------------- CREATE WORLD ----------------
  enterEditor(opts = {}) {
    this.hideAll();
    this.session.stop();
    this.screen = 'editor';
    this.renderer.cam.idleSpin = 0;
    this.hud.hideCountry();
    this.editor.enter(opts);
    audio.play('menu');
  }

  exitEditor() {
    const ed = this.editor;
    if (ed.w) {
      const w = ed.finalWorld();
      w.unsaved = !isSavedWorld(w.id);
      ed.exit();
      this.setWorld(w, true);
    } else ed.exit();
    this.renderer.selected = -1;
    this.goMenu();
  }

  // ---------------- contrôle total ----------------
  enterControl() {
    this.hideAll();
    this.session.stop();
    this.screen = 'control';
    this.renderer.cam.idleSpin = 0;
    this.setWorld(this.world, true);
    this.control.enter();
    $('hud').classList.add('with-control');
    document.body.classList.add('control-on');
    audio.play('menu');
  }

  exitControl() {
    this.control.exit();
    $('hud').classList.remove('with-control');
    document.body.classList.remove('control-on');
    this.goMenu();
  }

  // ---------------- boucle ----------------
  frame(ts) {
    const dt = Math.min(0.1, Math.max(0, (ts - this.last) / 1000));
    this.last = ts;
    this.fps = (this.fps || 60) + ((dt > 0 ? 1 / dt : 60) - (this.fps || 60)) * 0.05;
    const alpha = this.session.update(dt);
    const sim = this.session.sim;
    const micro = this.session.microList(sim ? sim.owner : this.world.owner);
    this.renderer.frame(dt, sim, alpha, micro);
    this.hud.animate(dt);
    const owner = sim ? sim.owner : this.world.owner;
    if (sim) {
      const parts = new Set(sim.sides.map((s) => s.e));
      const snap = this._snapAt && this.renderer.time - this._snapAt < 0.5 ? this._snap : (this._snapAt = this.renderer.time, this._snap = new Map(sim.snapshot().map((s) => [s.e, s.share])));
      this.labels.update(owner, parts, sim.nv ? () => null : (e) => (snap.has(e) ? (snap.get(e) * 100).toFixed(1).replace('.', ',') + ' %' : null), dt);
      if (this.renderer.time - this.hudAt > (sim.sides.length > 30 ? 0.5 : 0.2)) { this.hudAt = this.renderer.time; this.hud.update(sim); this.nationUI.update(sim); this.forcesUI.refresh(); this.gameNav.update(); this.worldViews.update(); this.netUI.update();
        if (sim.nv && this.session.state === 'running' && performance.now() - (this._autosaveAt || 0) > 180000) { this._autosaveAt = performance.now(); this.saveGame(true); } this.cellCountsDirty = true; if (this.control.active) this.control.refreshSim(); }
    } else if (this.screen === 'menu' || this.screen === 'creator' || this.screen === 'control' || this.screen === 'editor' || this.screen === 'nationPick') {
      this.labels.update(owner, this.screen === 'creator' ? new Set(this.creator.allMembers().map((m) => m.e)) : null, null, dt);
    }
    requestAnimationFrame((t) => this.frame(t));
  }

  // ---------------- liaisons ----------------
  _bindMenu() {
    $('menuHistoryBtn').onclick = () => this.warUI.openHistory();
    $('menuWarsBtn').onclick = () => this.warUI.openWars();
  }

  _bindHud() {
    $('playBtn').onclick = () => { this.session.toggle(); this.hud.setPaused(this.session.state === 'paused'); };
    $('stepBtn').onclick = () => { this.session.pause(); this.session.step(); this.hud.setPaused(true); };
    $('speeds').onclick = (e) => { const b = e.target.closest('[data-speed]'); if (b) this.setSpeed(Number(b.dataset.speed)); };
    $('camAutoBtn').onclick = () => { this.session.setCamMode('auto'); this.hud.setCam('auto'); };
    $('camFreeBtn').onclick = () => { this.session.setCamMode('libre'); this.hud.setCam('libre'); };
    $('zoomInBtn').onclick = () => this.renderer.cam.zoomBy(0.75);
    $('zoomOutBtn').onclick = () => this.renderer.cam.zoomBy(1.33);
    $('fitBtn').onclick = () => { this.session.setCamMode('libre'); this.hud.setCam('libre'); this.session.flyToParticipants(1.6); };
    $('markersBtn').onclick = () => { this.settings.markers = !this.settings.markers; this.applyDisplaySettings(); this.saveSettings(); };
    $('labelsBtn').onclick = () => { this.settings.labels = !this.settings.labels; this.applyDisplaySettings(); this.saveSettings(); };
    $('audioBtn').onclick = () => { this.settings.mute = !this.settings.mute; audio.setSettings(this.settings); this.applyDisplaySettings(); this.saveSettings(); };
    $('restartBtn').onclick = () => {
      if (this.session.net && this.session.net.active) { notice('Impossible de recommencer une partie multijoueur.'); return; }
      if (this.nationUI.active && !window.confirm('Recommencer une nouvelle partie ? La partie en cours sera perdue si elle n\'est pas sauvegardée.')) return;
      this.restart(false);
    };
    $('menuBtn').onclick = () => this.openPause();
    $('warsBtn').onclick = () => this.warUI.openWars();
  }

  openPause() {
    if (!this.session.sim) return;
    if (this.session.state === 'running') this.session.pause();
    this.hud.setPaused(true);
    $('pSeed').textContent = `Seed : ${this.session.sim.cfg.seed}`;
    show('pause');
  }

  _bindDialogs() {
    $('resumeBtn').onclick = () => { show('pause', false); this.session.resume(); this.hud.setPaused(false); };
    $('pSaveGame').onclick = () => this.saveGame();
    $('pRestartSame').onclick = () => { show('pause', false); this.restart(true); };
    $('pRestartNew').onclick = () => { show('pause', false); this.restart(false); };
    $('pCreator').onclick = () => { show('pause', false); this.openCreator(this.lastCreator || null); };
    $('pMenu').onclick = () => this.goMenu();
    $('replayBtn').onclick = () => { show('results', false); this.restart(false); };
    $('rNewSim').onclick = () => this.openCreator(this.lastCreator || null);
    $('rMenu').onclick = () => this.goMenu();
    $('rSaveWorld').onclick = () => {
      const w = this.resultingWorld();
      this.worldsUI.openSave(w, `Année ${w.year} : les nouvelles frontières (parcelle par parcelle), les pays disparus, les équipes, les statistiques et l'historique seront enregistrés.`);
    };
    $('rContinue').onclick = () => this.continueWorld();
    $('rViewMap').onclick = () => { show('results', false); notice('Carte finale — ☰ MENU pour revenir.', 3000); };
    $('loadGameClose').onclick = () => show('loadGame', false);
    $('settingsClose').onclick = () => { show('settings', false); this.resumeAfterOverlay(); };
    const upd = () => {
      this.settings.music = Number($('sMusic').value); this.settings.sfx = Number($('sSfx').value); this.settings.mute = $('sMute').checked;
      this.settings.flags = $('sFlags').checked; this.settings.labels = $('sLabels').checked; this.settings.markers = $('sMarkers').checked;
      this.settings.capitals = $('sCapitals').checked; this.settings.details = $('sDetails').checked;
      const geo = $('sGeo').checked; if (geo !== (this.settings.geo !== false)) { this.settings.geo = geo; this.refreshGeo(0); }
      $('oMusic').textContent = Math.round(this.settings.music * 100) + ' %'; $('oSfx').textContent = Math.round(this.settings.sfx * 100) + ' %';
      audio.setSettings(this.settings); this.applyDisplaySettings(); this.saveSettings();
    };
    for (const id of ['sMusic', 'sSfx', 'sMute', 'sFlags', 'sLabels', 'sMarkers', 'sCapitals', 'sDetails', 'sGeo']) $(id).addEventListener('input', upd);
    this.worldsUI.onSaved = null;
  }

  openSettings() {
    const s = this.settings;
    $('sMusic').value = s.music; $('sSfx').value = s.sfx; $('sMute').checked = s.mute;
    $('sFlags').checked = s.flags; $('sLabels').checked = s.labels; $('sMarkers').checked = s.markers;
    $('sCapitals').checked = s.capitals !== false;
    $('sGeo').checked = s.geo !== false;
    $('sDetails').checked = s.details !== false;
    seg($('sTransition'), [{ value: 'tres-lente', label: 'Très lente' }, { value: 'lente', label: 'Lente' }, { value: 'normal', label: 'Normale' }, { value: 'rapide', label: 'Rapide' }], s.transition || 'normal', (v) => {
      this.settings.transition = v; this.applyDisplaySettings(); this.saveSettings();
    });
    $('oMusic').textContent = Math.round(s.music * 100) + ' %'; $('oSfx').textContent = Math.round(s.sfx * 100) + ' %';
    // thème et taille de l'interface (présentation uniquement)
    const themes = () => { $('sTheme').innerHTML = themePickerHtml(this.settings.theme); };
    themes();
    $('sTheme').onclick = (e) => { const b = e.target.closest('[data-theme-id]'); if (!b) return; this.settings.theme = b.dataset.themeId; applyTheme(this.settings); this.saveSettings(); themes(); };
    // notifications : niveau et pause automatique
    seg($('sNotif'), NOTIF_LEVELS, s.notifLevel || 'all', (v) => { this.settings.notifLevel = v; this.saveSettings(); });
    const ap = { ...defaultAutoPause(), ...(s.autoPause || {}) };
    $('sAutoPause').innerHTML = AUTO_PAUSE.map(([k, l]) => `<label class="check"><input type="checkbox" data-ap="${k}" ${ap[k] ? 'checked' : ''}><span>${l}</span></label>`).join('');
    $('sAutoPause').onchange = (e) => { const c = e.target.closest('[data-ap]'); if (!c) return; this.settings.autoPause = { ...ap, ...(this.settings.autoPause || {}), [c.dataset.ap]: c.checked }; this.saveSettings(); };
    seg($('sUiScale'), UI_SIZES, Number(s.uiScale) || 1, (v) => { this.settings.uiScale = Number(v); applyTheme(this.settings); this.saveSettings(); });
    show('settings');
    this.pauseForOverlay();            // réglages ouverts en partie : jeu en pause
  }

  _bindInput() {
    const c = this.canvas;
    let down = null;
    c.addEventListener('contextmenu', (e) => e.preventDefault());
    c.addEventListener('pointerdown', (e) => {
      c.setPointerCapture(e.pointerId);
      down = { x: e.clientX, y: e.clientY, lx: e.clientX, ly: e.clientY, moved: false, paint: false, edit: false, button: e.button };
      if (this.borderEditor.active) {
        down.border = this.borderEditor.pointerDown(e, this.renderer.rayToLatLon(e.clientX, e.clientY));
        down.edit = down.border;
      } else if (this.editor.active && e.button === 0) {
        const hit = this.renderer.rayToLatLon(e.clientX, e.clientY);
        down.edit = this.editor.pointerDown(e, hit);
      } else {
        const paint = e.button === 0 && this.control.isPaintTool();
        down.paint = paint;
        if (paint) {
          const cell = this.pickCell(e.clientX, e.clientY);
          if (!this.control.beginStroke(cell)) down.paint = false;
        }
      }
      this.renderer.cam.idleSpin = 0;
    });
    c.addEventListener('pointermove', (e) => {
      if (this.borderEditor.active && (!down || down.border)) this.borderEditor.pointerMove(e, this.renderer.rayToLatLon(e.clientX, e.clientY));
      if (this.borderEditor.active && !down) return;
      if (this.editor.active && (!down || down.edit)) {
        const now = performance.now();
        if (down || now - (this._edMoveAt || 0) > 30) { this._edMoveAt = now; this.editor.pointerMove(e, this.renderer.rayToLatLon(e.clientX, e.clientY)); }
      }
      if (!down) { this._hover(e); return; }
      const dx = e.clientX - down.lx, dy = e.clientY - down.ly;
      if (!down.moved && Math.hypot(e.clientX - down.x, e.clientY - down.y) > 4) { down.moved = true; if (!down.paint && !down.edit) c.classList.add('dragging'); $('tooltip').classList.add('hidden'); }
      if (down.moved && !down.edit) {
        if (down.paint) this.control.paint(this.pickCell(e.clientX, e.clientY));
        else {
          this.renderer.cam.rotateBy(dx, dy);
          if (this.session.camMode === 'auto') { this.session.setCamMode('libre'); this.hud.setCam('libre'); }
        }
      }
      down.lx = e.clientX; down.ly = e.clientY;
    });
    c.addEventListener('pointerup', (e) => {
      if (!down) return;
      const d = down; down = null;
      c.classList.remove('dragging');
      if (d.border) { this.borderEditor.pointerUp(); return; }
      if (this.borderEditor.active) return;
      if (d.edit) { this.editor.pointerUp(); return; }
      if (d.paint) { this.control.endStroke(); return; }
      if (!d.moved && d.button === 0) {
        const cell = this.pickCell(e.clientX, e.clientY);
        if (this.editor.active) { this.editor.click(this.renderer.rayToLatLon(e.clientX, e.clientY), cell); return; }
        if (this.control.active) { this.control.click(cell); if (this.control.tool !== 'select') return; }
        // groupe d'armée ou flotte sous le curseur : fiche flottante (ou choix d'une destination de flotte)
        if (this.session.sim && this.screen === 'game' && this.forcesUI.click(e.clientX, e.clientY)) { audio.sfx('click'); return; }
        const o = this.ownerAt(cell);
        if (this.screen === 'nationPick') { if (o !== NONE) this.nationUI.pick(o, false); audio.sfx('click'); return; }
        if (o !== NONE && this.entities()[o]) this.selectEntity(o);
        else this.selectEntity(-1);
        audio.sfx('click');
      }
    });
    c.addEventListener('pointerleave', () => { if (this.editor.active) { this.editor.hover = null; this.renderer.setBrush(null); } });
    c.addEventListener('wheel', (e) => {
      e.preventDefault();
      this.renderer.cam.zoomBy(Math.exp(e.deltaY * 0.0013));
      this.renderer.cam.idleSpin = 0;
      if (this.session.camMode === 'auto') { this.session.setCamMode('libre'); this.hud.setCam('libre'); }
    }, { passive: false });
  }

  _hover(e) {
    const now = performance.now();
    if (now - (this._hoverAt || 0) < 90) return;
    this._hoverAt = now;
    const tip = $('tooltip');
    const cell = this.pickCell(e.clientX, e.clientY);
    const o = this.ownerAt(cell);
    const ent = o !== NONE ? this.entities()[o] : null;
    if (!ent || ent.removed || this.control.isPaintTool() || (this.editor.active && this.editor.tool !== 'select')) { tip.classList.add('hidden'); return; }
    const g = this.grid;
    const orig = g.origin[cell];
    const sim = this.session.sim;
    let extra = '';
    if (sim && sim.occupied && sim.occupied[cell]) {
      const st = sim.occupationState ? sim.occupationState(cell) : { label: 'Occupé' };
      const hint = { semi: 'conquête récente, contrôle fragile', occupied: 'calme et ravitaillé, sera intégré', contested: 'ravitaillement insuffisant, partisans actifs' }[st.id] || 'pas encore intégré';
      extra += `<small class="occ-${st.id}">${st.label} · ${hint}</small>`;
    } else if (sim && sim.nation && cell >= 0 && sim.owner[cell] !== 65535) extra += '<small>Contrôlé</small>';
    if (sim && sim.origin[cell] !== o && this.entities()[sim.origin[cell]]) extra += `<small>Territoire d'origine : ${esc(this.entities()[sim.origin[cell]].name)}</small>`;
    else if (!sim && orig !== o && orig !== NONE && this.entities()[orig]) extra += `<small>Frontière d'origine : ${esc(this.entities()[orig].name)}</small>`;
    tip.innerHTML = `<div class="tt-head"><i class="dot" style="background:${ent.color}"></i><b>${esc(ent.name)}</b></div>${ent.capital ? `<small>Capitale : ${esc(ent.capital.name)}</small>` : ''}${extra}`;
    tip.style.left = Math.min(window.innerWidth - 220, e.clientX + 14) + 'px';
    tip.style.top = Math.min(window.innerHeight - 60, e.clientY + 14) + 'px';
    tip.classList.remove('hidden');
  }

  _bindKeys() {
    window.addEventListener('keydown', (e) => {
      if (e.target && (e.target.tagName === 'INPUT' && e.target.type === 'text')) return;
      const k = e.key;
      if (this.borderEditor.active && this.borderEditor.key(e)) return;
      if (this.editor.active && k !== 'Escape' && !k.startsWith('Arrow') && k !== '+' && k !== '-' && this.editor.key(e)) return;
      const inSim = !!this.session.sim;
      if (k === 'F1') { e.preventDefault(); if (this.guide.isOpen()) this.guide.close(); else this.guide.open(); return; }
      if (k === 'Escape') {
        e.preventDefault();
        if (this.guide.isOpen()) { this.guide.close(); return; }
        if (this.recap.isOpen()) { this.recap.close(); return; }
        if (this.tuningUI.isOpen()) { this.tuningUI.close(); return; }
        if (this.forcesUI.pickMode) { this.forcesUI.cancelPick(); return; }
        if (isShown('floatCard')) { this.forcesUI.hideCard(); return; }
        if (isShown('settings')) { show('settings', false); this.resumeAfterOverlay(); return; }
        for (const id of ['picker', 'saveWorldDialog', 'newCountry', 'worlds', 'loadGame', 'edStart']) if (isShown(id)) { show(id, false); return; }
        if (isShown('warReport')) { this.warUI.closeReport(); return; }
        if (isShown('warsPanel')) { show('warsPanel', false); this.resumeAfterOverlay(); return; }
        if (isShown('worldHistoryPanel')) { show('worldHistoryPanel', false); this.resumeAfterOverlay(); return; }
        if (isShown('warEnded')) { this.warUI.hideEnded(true); return; }
        if (this.warEndUI.isOpen()) { this.warEndUI.close(); return; }
        if (this.rulesUI.isOpen()) { this.rulesUI.close(); return; }
        if (this.netUI.isOpen()) { this.netUI.close(); return; }
        if (isShown('scenarioEditor')) { this.scenarioEditor.close(); return; }
        if (isShown('diploDialog')) { this.nationUI.closeDiplo(); return; }
        if (this.gameNav.isOpen()) { this.gameNav.closePanel(); return; }
        for (const id of ['nationOffers', 'nationDecision', 'scenarioEnd']) if (isShown(id)) { show(id, false); this.resumeAfterOverlay(); return; }
        if (isShown('storyPick')) { show('storyPick', false); return; }
        if (isShown('nationPanel')) { this.nationUI.closePanel(); return; }
        if (this.screen === 'nationPick') { this.goMenu(); return; }
        if (this.editor.active) { this.editor.setTool('select'); return; }
        if (isShown('pause')) { show('pause', false); this.session.resume(); this.hud.setPaused(false); return; }
        if (isShown('results')) { this.goMenu(); return; }
        if (this.screen === 'menu' && isShown('mmSub')) { this.menuUI.closeSub(); return; }
        if (this.screen === 'creator') { this.goMenu(); return; }
        if (inSim && this.screen === 'game') { this.openPause(); return; }
        return;
      }
      if ((e.ctrlKey || e.metaKey) && this.control.active) {
        if (k.toLowerCase() === 'z') { e.preventDefault(); this.control.doUndo(); return; }
        if (k.toLowerCase() === 'y') { e.preventDefault(); this.control.doRedo(); return; }
      }
      if (k === '+' || k === '=' || e.code === 'NumpadAdd') { this.renderer.cam.zoomBy(0.75); return; }
      if (k === '-' || e.code === 'NumpadSubtract') { this.renderer.cam.zoomBy(1.33); return; }
      if (k === 'ArrowLeft') { this.renderer.cam.rotateBy(-40, 0); return; }
      if (k === 'ArrowRight') { this.renderer.cam.rotateBy(40, 0); return; }
      if (k === 'ArrowUp') { this.renderer.cam.rotateBy(0, 40); return; }
      if (k === 'ArrowDown') { this.renderer.cam.rotateBy(0, -40); return; }
      if (!inSim) { if (k === 'Enter' && this.screen === 'creator') this.creator.launch(); return; }
      const low = k.toLowerCase();
      if (k === ' ') { e.preventDefault(); if (isShown('pause')) { show('pause', false); this.session.resume(); } else this.session.toggle(); this.hud.setPaused(this.session.state === 'paused'); }
      else if (low === 'r') { if (!this.nationUI.active && !(this.session.net && this.session.net.active)) this.restart(false); }   // Nation / multijoueur : pas de relance accidentelle
      else if (low === 'c') { const m = this.session.camMode === 'auto' ? 'libre' : 'auto'; this.session.setCamMode(m); this.hud.setCam(m); }
      else if (low === 'n') { this.session.pause(); this.session.step(); this.hud.setPaused(true); }
      else if (low === 'm') $('markersBtn').click();
      else if (low === 'l') $('labelsBtn').click();
      else if (low === 's') $('audioBtn').click();
      else if (low === 'v') $('fitBtn').click();
      else if (low === 'k' && inSim) this.worldViews.nextMap();
      else if (low === 'g') this.warUI.openWars();
      else if (low === 'h') this.warUI.openHistory();
      else if (this.nationUI.active && ['1', '2', '3', '4', '5'].includes(k)) this.setSpeed(NATION_SPEEDS[Number(k) - 1]);
      else if (low === 'p' && this.nationUI.active) this.nationUI.openPanel();
      else if (low === 'd' && this.nationUI.active) this.nationUI.openPanel('diplo');
      else if (['1', '2', '3', '4', '5'].includes(k)) this.setSpeed(SPEEDS[Number(k) - 1]);
    });
  }
}

function gcKm(p, q) {
  const t = Math.PI / 180;
  const a = Math.sin((q.lat - p.lat) * t / 2) ** 2 + Math.cos(p.lat * t) * Math.cos(q.lat * t) * Math.sin((q.lon - p.lon) * t / 2) ** 2;
  return 2 * EARTH_R * Math.asin(Math.sqrt(a));
}

const app = new App();
window.__ws = app;
window.__audio = audio;
const booted = app.boot();
booted.catch((e) => {
  console.error(e);
  $('bootText').textContent = /WebGL/i.test(e.message)
    ? 'Impossible d\'initialiser la 3D (WebGL). Mettez à jour le pilote de la carte graphique, ou utilisez le mode classique 2D.'
    : 'Erreur au démarrage : ' + e.message;
  const a = document.createElement('a');
  a.href = 'classic.html'; a.textContent = '→ Ouvrir le mode classique 2D'; a.style.color = '#ffcf4a';
  document.querySelector('.boot-card').appendChild(a);
});

// accès pour les tests automatiques
window.__game = {
  debugStart: () => booted.then(() => {
    const cfg = defaultCreatorConfig();
    app.openCreator(cfg);
    app.creator.launch();
    app.setSpeed(4);
  }),
  debugState: () => {
    if (!app.session) return { screen: 'boot' };
    const sim = app.session.sim;
    return {
      screen: app.screen, fps: Math.round(app.fps || 0), frameMs: app.renderer.stats.frameMs.toFixed(2),
      time: sim ? sim.time.toFixed(1) : null, sides: sim ? sim.sides.length : 0,
      transports: sim ? sim.transports.length : 0,
      share: sim ? sim.snapshot().slice(0, 6).map((s) => s.name + ' ' + (s.share * 100).toFixed(1)) : null,
    };
  },
};
