// Point d'entrée de l'interface : relie UI, logique de jeu, sauvegarde et contrôles clavier
import { Game } from './game/game.js';
import { Hud } from './ui/hud.js';
import { MainMenu, CustomMenu, renderResults, renderSlots, show, notice } from './ui/screens.js';
import { defaultConfig, sanitizeConfig } from './game/config.js';
import { SaveSystem } from './save/saveSystem.js';
import { getCountry, randomPair } from './countries/countries.js';
import { randomSeedString } from './simulation/rng.js';
import { runBatch } from './game/debugTools.js';

const $ = (id) => document.getElementById(id);

class App {
  constructor() {
    this.config = defaultConfig();
    this.hud = new Hud();
    this.game = new Game($('map'), this.hud);
    this.game.onEnd = (result, cfg) => this.onEnd(result, cfg);
    this.menu = new MainMenu(this);
    this.custom = new CustomMenu(this);
    this.screen = 'menu';
    this.spectatorTimer = null;
    this._bindHud();
    this._bindDialogs();
    this._bindKeys();
  }

  async init() {
    const last = await SaveSystem.loadLast();
    this.config = sanitizeConfig(last || defaultConfig());
    this.menu.open();
    this.preview();
  }

  withLoading(fn) {
    show('loading');
    // laisse le navigateur afficher l'indicateur avant le calcul de la carte
    return new Promise((resolve) => requestAnimationFrame(() => setTimeout(() => {
      try { fn(); } catch (e) { console.error(e); notice('Erreur : ' + e.message, 5000); }
      show('loading', false);
      resolve();
    }, 16)));
  }

  preview() {
    return this.withLoading(() => this.game.showPreview(this.config));
  }

  // ---------- lancement ----------
  launch({ newSeed = false, spectator = false } = {}) {
    clearTimeout(this.spectatorTimer);
    if (newSeed) this.config.seed = randomSeedString();
    this.config = sanitizeConfig(this.config);
    this.menu.close();
    this.custom.close();
    ['results', 'pause', 'loadDialog', 'saveDialog'].forEach((id) => show(id, false));
    this.screen = 'game';
    if (!spectator) SaveSystem.saveLast(this.config);
    return this.withLoading(() => this.game.start(this.config, { spectator }));
  }

  launchSpectator(nextPair = false) {
    if (nextPair) {
      const [a, b] = randomPair();
      Object.assign(this.config, { a: a.id, b: b.id, stats: null, statsFor: null, powerMult: [1, 1] });
    }
    this.config.speed = Math.max(this.config.speed, 2);
    return this.launch({ newSeed: true, spectator: true });
  }

  backToMenu() {
    clearTimeout(this.spectatorTimer);
    ['results', 'pause', 'loadDialog', 'saveDialog'].forEach((id) => show(id, false));
    this.game.stopToMenu();
    this.screen = 'menu';
    this.menu.open();
    this.preview();
  }

  openCustom() { this.menu.close(); this.custom.open(); this.screen = 'custom'; }
  closeCustom() {
    this.custom.close();
    this.screen = 'menu';
    this.menu.open();
    this.preview();
  }

  // ---------- fin de partie ----------
  onEnd(result, cfg) {
    setTimeout(() => {
      if (this.game.state !== 'ended') return;
      renderResults(result, cfg, this.game.colors);
      show('results');
      const spec = this.game.spectator;
      $('spectatorNext').textContent = '';
      if (spec) {
        let left = 8;
        const tick = () => {
          if (this.game.state !== 'ended' || !this.game.spectator) return;
          if (left <= 0) { this.launchSpectator(true); return; }
          $('spectatorNext').textContent = `Mode spectateur : prochaine simulation dans ${left} s…`;
          left--;
          this.spectatorTimer = setTimeout(tick, 1000);
        };
        tick();
      }
    }, 1400);
  }

  // ---------- pause ----------
  openPause() {
    if (this.screen !== 'game') return;
    if (this.game.state === 'running') this.game.pause();
    $('pauseSeed').textContent = `Seed : ${this.config.seed}`;
    show('pause');
  }
  closePause() { show('pause', false); this.game.resume(); }

  // ---------- sauvegarde ----------
  openSave() {
    const a = getCountry(this.config.a), b = getCountry(this.config.b);
    $('saveName').value = `${a.name} vs ${b.name} — ${this.config.seed}`;
    show('saveDialog');
    setTimeout(() => $('saveName').select(), 30);
  }
  async confirmSave() {
    const name = $('saveName').value.trim() || 'Simulation';
    await SaveSystem.saveSlot(name, this.config);
    show('saveDialog', false);
    notice('💾 Paramètres sauvegardés');
  }
  openLoad() {
    show('loadDialog');
    renderSlots(SaveSystem, (slot) => {
      this.config = sanitizeConfig({ ...slot.config });
      show('loadDialog', false);
      notice('Paramètres chargés : ' + slot.name);
      if (this.screen === 'menu') { this.menu.open(); this.preview(); }
    }, (slot) => SaveSystem.deleteSlot(slot.id));
  }

  // ---------- liaisons ----------
  _bindHud() {
    $('playBtn').addEventListener('click', () => this.game.togglePause());
    $('speeds').addEventListener('click', (e) => {
      const b = e.target.closest('button[data-speed]');
      if (b) this.game.setSpeed(Number(b.dataset.speed));
    });
    $('restartBtn').addEventListener('click', () => this.launch({ newSeed: true, spectator: this.game.spectator }));
    $('zoomInBtn').addEventListener('click', () => this.game.zoom(1.35));
    $('zoomOutBtn').addEventListener('click', () => this.game.zoom(1 / 1.35));
    $('fitBtn').addEventListener('click', () => this.game.fitView());
    $('camBtn').addEventListener('click', () => this.game.toggleAutoCam());
    $('markersBtn').addEventListener('click', () => this.game.toggleMarkers());
    $('menuBtn').addEventListener('click', () => this.openPause());
  }

  _bindDialogs() {
    $('resumeBtn').addEventListener('click', () => this.closePause());
    $('pauseRestart').addEventListener('click', () => this.launch({ newSeed: false, spectator: this.game.spectator }));
    $('pauseNew').addEventListener('click', () => this.launch({ newSeed: true, spectator: this.game.spectator }));
    $('pauseSave').addEventListener('click', () => this.openSave());
    $('pauseMenu').addEventListener('click', () => this.backToMenu());
    $('replayBtn').addEventListener('click', () => this.launch({ newSeed: true, spectator: this.game.spectator }));
    $('sameSeedBtn').addEventListener('click', () => this.launch({ newSeed: false, spectator: this.game.spectator }));
    $('newSimBtn').addEventListener('click', () => this.backToMenu());
    $('mainMenuBtn').addEventListener('click', () => this.backToMenu());
    $('loadClose').addEventListener('click', () => show('loadDialog', false));
    $('saveConfirm').addEventListener('click', () => this.confirmSave());
    $('saveCancel').addEventListener('click', () => show('saveDialog', false));
    $('saveName').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') this.confirmSave();
      e.stopPropagation();
    });
  }

  _bindKeys() {
    window.addEventListener('keydown', (e) => {
      if (e.target && e.target.tagName === 'INPUT' && e.target.type === 'text') return;
      const k = e.key;
      const inGame = this.screen === 'game';
      const overlayOpen = !$('saveDialog').classList.contains('hidden') || !$('loadDialog').classList.contains('hidden');
      if (k === 'Escape') {
        e.preventDefault();
        if (overlayOpen) { show('saveDialog', false); show('loadDialog', false); return; }
        if (this.screen === 'custom') { this.closeCustom(); return; }
        if (!inGame) return;
        if (!$('results').classList.contains('hidden')) { this.backToMenu(); return; }
        if (!$('pause').classList.contains('hidden')) this.closePause(); else this.openPause();
        return;
      }
      if (overlayOpen) return;
      if (k === ' ' || k === 'Spacebar') {
        e.preventDefault();
        if (!inGame) return;
        if (!$('pause').classList.contains('hidden')) this.closePause(); else this.game.togglePause();
        return;
      }
      if (k === '+' || k === '=' || e.code === 'NumpadAdd') { e.preventDefault(); this.game.zoom(1.35); return; }
      if (k === '-' || k === '_' || e.code === 'NumpadSubtract') { e.preventDefault(); this.game.zoom(1 / 1.35); return; }
      if (!inGame) {
        if (k === 'Enter' && this.screen === 'menu') this.launch({ newSeed: true });
        return;
      }
      const lower = k.toLowerCase();
      if (lower === 'r') this.launch({ newSeed: true, spectator: this.game.spectator });
      else if (lower === 'v') this.game.fitView();
      else if (lower === 'c') this.game.toggleAutoCam();
      else if (lower === 'm') this.game.toggleMarkers();
      else if (['1', '2', '3', '4', '5'].includes(k)) this.game.setSpeed([0.5, 1, 2, 4, 8][Number(k) - 1]);
    });
  }
}

const app = new App();
app.init();

// Accès pour les tests automatiques
window.__game = {
  app,
  debugStart: () => app.launch({ newSeed: false }),
  debugState: () => app.game.debugState(),
  runBatch: (a, b, n, res) => runBatch(app.game, a, b, n, res),
};
