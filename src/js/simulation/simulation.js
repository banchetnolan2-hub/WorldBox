// SIMULATION — moteur territorial déterministe, indépendant du rendu.
// Le moteur avance par ticks fixes (TICK secondes simulées). La vitesse d'affichage
// (0.5× … 8×) change seulement le nombre de ticks exécutés par seconde réelle,
// donc une même seed donne toujours le même résultat, quelle que soit la vitesse.

import { RNG } from './rng.js';
import { pickEvent } from './events.js';

export const TICK = 0.05;
export const STAT_KEYS = ['puissance', 'mobilite', 'stabilite', 'ressources', 'defense', 'expansion', 'vitesse'];
export const STAT_LABELS = {
  puissance: 'Puissance territoriale',
  mobilite: 'Mobilité',
  stabilite: 'Stabilité',
  ressources: 'Ressources',
  defense: 'Défense',
  expansion: 'Expansion',
  vitesse: 'Vitesse de progression',
};

export const DEFAULT_CONFIG = {
  seed: 'DEMO01',
  names: ['Pays A', 'Pays B'],
  stats: [null, null],
  powerMult: [1, 1],   // mode personnalisé : puissance globale de chaque pays
  eventRate: 1,        // 0 = aucun événement, 1 = normal, 2 = fréquent, 3 = très fréquent
  randomness: 0.5,     // 0 = très prévisible, 1 = très aléatoire
  pace: 1,             // rythme de base des actions
  maxDuration: 300,    // secondes simulées
  victoryRatio: 0.35,  // un pays perd s'il ne garde que 35 % de son territoire initial
};

// Paramètres d'équilibrage (ajustés par tests Monte-Carlo : npm test)
export const TUNE = {
  rate: 1.25,         // multiplicateur du nombre d'actions par seconde
  logitK: 2.1,        // sensibilité au rapport de forces
  localK: 0.3,        // bonus de soutien des cellules voisines
  momRevert: 0.06,    // retour de l'élan vers 0
  momSigma: 0.12,     // bruit minimal de l'élan
  momSigmaR: 0.35,    // bruit supplémentaire selon le niveau d'aléatoire
  momMax: 0.8,
  supply: 0.5,        // pénalité d'étirement en territoire adverse
  desperation: 0.25,  // bonus défensif quand un pays a perdu beaucoup de terrain
  ramp: 0.8,          // intensification progressive en fin de partie
};

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const sigmoid = (x) => 1 / (1 + Math.exp(-x));

class IndexSet {
  constructor(n) { this.items = new Int32Array(n); this.pos = new Int32Array(n).fill(-1); this.size = 0; }
  add(i) { if (this.pos[i] >= 0) return; this.pos[i] = this.size; this.items[this.size++] = i; }
  remove(i) {
    const p = this.pos[i]; if (p < 0) return;
    const last = this.items[--this.size];
    this.items[p] = last; this.pos[last] = p; this.pos[i] = -1;
  }
  has(i) { return this.pos[i] >= 0; }
  random(rng) { return this.items[rng.int(this.size)]; }
}

function defaultStats() {
  return { puissance: 55, mobilite: 55, stabilite: 60, ressources: 55, defense: 55, expansion: 50, vitesse: 55 };
}

export class Simulation {
  constructor(grid, config = {}) {
    this.grid = grid;
    this.cfg = { ...DEFAULT_CONFIG, ...config };
    this.rng = new RNG(String(this.cfg.seed));
    const n = grid.n;
    this.n = n;
    this.owner = Uint8Array.from(grid.origin);
    this.adj = [new Uint8Array(n), new Uint8Array(n)];
    this.targets = [new IndexSet(n), new IndexSet(n)];
    this.contest = new Float32Array(n);
    this.lastFlip = new Float32Array(n).fill(-999);
    this.isolated = new Uint8Array(n);
    this.time = 0;
    this.tickCount = 0;
    this.finished = false;
    this.result = null;
    this.regional = null;
    this.captures = [];      // consommé par le rendu : { i, by, t }
    this.eventsOut = [];     // consommé par l'interface
    this.log = [];           // journal complet des événements
    this.history = [];       // [temps, % territoire A]
    this._unitId = 0;
    this.attemptCost = 0.1;

    for (let i = 0; i < n; i++) {
      for (let d = 0; d < 8; d++) {
        const j = grid.neighbors[i * 8 + d];
        if (j >= 0) this.adj[this.owner[j]][i]++;
      }
    }
    for (let i = 0; i < n; i++) this._refresh(i);
    // les deux pays ont-ils une frontière terrestre commune ? sinon : traversées maritimes régulières
    this.landContact = this.targets[0].size > 0;

    this.sides = [0, 1].map((s) => this._makeSide(s));
    this.eventInterval = this.cfg.eventRate > 0 ? 13 / this.cfg.eventRate : Infinity;
    this.nextEventAt = this.cfg.eventRate > 0 ? 7 + this.rng.range(0, 4) / this.cfg.eventRate : Infinity;
    this._computeIsolation();
    this.history.push([0, this.share(0)]);
  }

  // ---------- état des pays ----------
  _makeSide(s) {
    const st = { ...defaultStats(), ...(this.cfg.stats[s] || {}) };
    const initial = this.grid.counts[s];
    const side = {
      index: s,
      stats: st,
      atkBase: 0.6 + st.puissance / 125,
      defBase: 0.6 + st.defense / 125,
      rateFactor: (0.7 + st.vitesse / 170) * (0.92 + st.mobilite / 600),
      regen: 1.6 + st.ressources / 28,
      supplyK: 1.25 - st.expansion / 160,
      baseStability: 0.45 + st.stabilite / 200,
      powerMult: Math.pow(this.cfg.powerMult[s] || 1, 0.85),
      cells: initial,
      initial,
      stability: 0.45 + st.stabilite / 200,
      resources: 55 + st.ressources / 5,
      momentum: 0,
      phase: 'consolidation',
      phaseUntil: this.rng.range(1.5, 4),
      mods: [],
      units: [],
      attemptAcc: 0,
      landingAcc: 0,
      heldEnemy: 0,
      captured: 0,
      lost: 0,
      peak: initial,
    };
    const count = clamp(Math.round(4 + st.mobilite / 14), 5, 11);
    this.sides = this.sides || [];
    this.sides[s] = side;
    for (let k = 0; k < count; k++) this._spawnUnit(side, k * 0.35);
    return side;
  }

  name(s) { return this.cfg.names[s]; }
  // 0 au début, 1 en fin de partie : la simulation s'intensifie pour aboutir à un résultat
  intensity() {
    const m = this.cfg.maxDuration;
    return clamp((this.time - 0.35 * m) / (0.6 * m), 0, 1);
  }
  share(s) { const t = this.sides[0].cells + this.sides[1].cells; return t ? this.sides[s].cells / t : 0.5; }
  ratio(s) { const sd = this.sides[s]; return sd.initial ? sd.cells / sd.initial : 0; }
  leaderSide() {
    const r0 = this.ratio(0), r1 = this.ratio(1);
    if (Math.abs(r0 - r1) < 0.015) return -1;
    return r0 > r1 ? 0 : 1;
  }

  addMod(s, mod) { this.sides[s].mods.push({ attempts: 1, atk: 1, def: 1, ...mod }); }
  _mod(s, key) {
    let m = 1;
    for (const md of this.sides[s].mods) m *= md[key];
    return m;
  }

  // ---------- marqueurs (unités) ----------
  _spawnUnit(side, delay = 0) {
    const g = this.grid;
    const cap = g.capitals[side.index];
    let i = cap >= 0 && this.owner[cap] === side.index ? cap : this._randomOwnedCell(side.index);
    if (i < 0) return false;
    const jitter = g.cellSize * 1.5;
    const x = g.cx[i] + this.rng.range(-jitter, jitter);
    const y = g.cy[i] + this.rng.range(-jitter, jitter);
    const st = side.stats;
    side.units.push({
      id: ++this._unitId,
      side: side.index,
      x, y, px: x, py: y,
      target: -1,
      engaged: false,
      retargetAt: 0,
      bornAt: this.time + delay,
      speed: g.cellSize * (1.3 + st.mobilite / 38) * this.rng.range(0.85, 1.15),
      wins: 0,
      lastWinAt: -99,
    });
    return true;
  }

  addUnits(s, k) {
    let added = 0;
    for (let q = 0; q < k && this.sides[s].units.length < 14; q++) if (this._spawnUnit(this.sides[s], q * 0.3)) added++;
    return added;
  }

  _randomOwnedCell(s) {
    for (let tries = 0; tries < 200; tries++) {
      const i = this.rng.int(this.n);
      if (this.owner[i] === s) return i;
    }
    for (let i = 0; i < this.n; i++) if (this.owner[i] === s) return i;
    return -1;
  }

  _retarget(u) {
    const c = u.side;
    const set = this.targets[c];
    u.retargetAt = this.time + this.rng.range(3, 7);
    if (set.size === 0) { u.target = -1; return; }
    const g = this.grid;
    const others = this.sides[c].units;
    let best = -1, bestScore = Infinity;
    const samples = Math.min(14, set.size);
    for (let k = 0; k < samples; k++) {
      const cand = set.random(this.rng);
      const dx = g.cx[cand] - u.x, dy = g.cy[cand] - u.y;
      let score = Math.sqrt(dx * dx + dy * dy) * this.rng.range(0.6, 1.4);
      for (const o of others) {
        if (o === u || o.target < 0) continue;
        const ox = g.cx[o.target] - g.cx[cand], oy = g.cy[o.target] - g.cy[cand];
        if (ox * ox + oy * oy < (g.cellSize * 5) ** 2) score += g.cellSize * 10;
      }
      if (this.regional && this.time < this.regional.until) {
        const rx = g.cx[cand] - this.regional.x, ry = g.cy[cand] - this.regional.y;
        if (rx * rx + ry * ry < this.regional.r * this.regional.r) score *= 0.4;
      }
      if (score < bestScore) { bestScore = score; best = cand; }
    }
    u.target = best;
  }

  _updateUnits(side) {
    const g = this.grid;
    const phaseBoost = side.phase === 'offensive' ? 1.25 : 0.85;
    for (const u of side.units) {
      u.px = u.x; u.py = u.y;
      if (this.time < u.bornAt) continue;
      const t = u.target;
      if (t < 0 || this.owner[t] === side.index || !this.targets[side.index].has(t) || this.time >= u.retargetAt) {
        this._retarget(u);
      }
      if (u.target < 0) { u.engaged = false; continue; }
      const tx = g.cx[u.target], ty = g.cy[u.target];
      const dx = tx - u.x, dy = ty - u.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      const step = u.speed * phaseBoost * TICK;
      if (dist > g.cellSize * 0.9) {
        const k = Math.min(1, step / dist);
        u.x += dx * k; u.y += dy * k;
      }
      u.engaged = dist < g.cellSize * 2.2;
    }
  }

  // ---------- ciblage ----------
  _scanNear(u, c, radius) {
    const g = this.grid;
    const ux = Math.floor((u.x - g.originX) / g.cellSize);
    const uy = Math.floor((u.y - g.originY) / g.cellSize);
    const d = 1 - c;
    let chosen = -1, seen = 0;
    for (let y = uy - radius; y <= uy + radius; y++) {
      if (y < 0 || y >= g.gh) continue;
      for (let x = ux - radius; x <= ux + radius; x++) {
        if (x < 0 || x >= g.gw) continue;
        const i = g.indexAt[y * g.gw + x];
        if (i < 0 || this.owner[i] !== d || this.adj[c][i] === 0) continue;
        seen++;
        if (this.rng.int(seen) === 0) chosen = i; // échantillonnage uniforme
      }
    }
    return chosen;
  }

  _pickTarget(c, engaged) {
    const set = this.targets[c];
    if (set.size === 0) return { i: -1, unit: null };
    const r = this.rng.next();
    if (engaged.length && r < 0.68) {
      const u = engaged[this.rng.int(engaged.length)];
      const i = this._scanNear(u, c, 3);
      if (i >= 0) return { i, unit: u };
    }
    if (this.regional && this.time < this.regional.until && r > 0.68 && r < 0.86) {
      const i = this._scanNear(this.regional, c, this.regional.rc);
      if (i >= 0) return { i, unit: null };
    }
    return { i: set.random(this.rng), unit: null };
  }

  // ---------- forces ----------
  attackPower(c, targetCell) {
    const s = this.sides[c];
    let a = s.atkBase * s.powerMult * (0.55 + 0.45 * s.stability) * Math.exp(s.momentum) * this._mod(c, 'atk');
    if (s.resources < 8) a *= 0.8;
    if (targetCell >= 0 && this.grid.origin[targetCell] !== c) {
      // plus on avance loin chez l'adversaire, plus la progression coûte (étirement)
      const frac = s.heldEnemy / Math.max(1, this.sides[1 - c].initial);
      a /= 1 + s.supplyK * frac * TUNE.supply;
    }
    return a;
  }

  defensePower(d, cell) {
    const s = this.sides[d];
    let v = s.defBase * s.powerMult * (0.55 + 0.45 * s.stability) * Math.exp(s.momentum * 0.3) * this._mod(d, 'def');
    if (s.phase === 'consolidation') v *= 1.12;
    if (this.grid.origin[cell] === d) {
      const desperation = 1 + TUNE.desperation * (1 - this.intensity() * 0.8) * Math.max(0, 1 - s.cells / s.initial);
      v *= 1.1 * desperation;
    } else {
      v *= 0.85;
    }
    if (this.regional && this.time < this.regional.until) {
      const g = this.grid;
      const dx = g.cx[cell] - this.regional.x, dy = g.cy[cell] - this.regional.y;
      if (dx * dx + dy * dy < this.regional.r * this.regional.r) v *= 0.75;
    }
    return v;
  }

  _attempt(c, i, unit) {
    const d = 1 - c;
    if (i < 0 || this.owner[i] !== d) return false;
    const s = this.sides[c];
    s.resources = Math.max(0, s.resources - this.attemptCost);
    const A = this.attackPower(c, i);
    const D = this.defensePower(d, i);
    const local = this.adj[c][i] - this.adj[d][i];
    let logit = TUNE.logitK * Math.log(A / D) + TUNE.localK * local - 0.35;
    if (this.isolated[i]) logit += 1.1;
    if (unit) logit += 0.25;
    if (this.rng.next() < sigmoid(logit)) {
      this.flip(i, c);
      if (unit) { unit.wins++; unit.lastWinAt = this.time; }
      return true;
    }
    this.contest[i] = this.time + 1.4;
    return false;
  }

  // ---------- changement de propriétaire ----------
  flip(i, c) {
    const d = this.owner[i];
    if (d === c) return;
    const g = this.grid;
    this.owner[i] = c;
    const sc = this.sides[c], sd = this.sides[d];
    sc.cells++; sd.cells--;
    sc.captured++; sd.lost++;
    if (g.origin[i] === d) sc.heldEnemy++;
    if (g.origin[i] === c) sd.heldEnemy--;
    sc.peak = Math.max(sc.peak, sc.cells);
    sc.resources = Math.min(100, sc.resources + 0.08);
    this.isolated[i] = 0;
    this.contest[i] = 0;
    for (let k = 0; k < 8; k++) {
      const j = g.neighbors[i * 8 + k];
      if (j < 0) continue;
      this.adj[d][j]--; this.adj[c][j]++;
    }
    this._refresh(i);
    for (let k = 0; k < 8; k++) {
      const j = g.neighbors[i * 8 + k];
      if (j >= 0) this._refresh(j);
    }
    this.lastFlip[i] = this.time;
    this.captures.push({ i, by: c, t: this.time });

    const caps = g.capitals;
    if (i === caps[d] && g.origin[i] === d) {
      sd.stability = Math.max(0.15, sd.stability - 0.12);
      sd.momentum -= 0.1;
      this._emit({ icon: '🏛️', title: 'CAPITALE PRISE', tone: 'bad', side: d,
        text: `Le centre administratif de ${this.name(d)} passe sous le contrôle de ${this.name(c)}.` });
    } else if (i === caps[c] && g.origin[i] === c) {
      sc.stability = Math.min(1, sc.stability + 0.1);
      this._emit({ icon: '🏛️', title: 'CAPITALE REPRISE', tone: 'good', side: c,
        text: `${this.name(c)} reprend son centre administratif.` });
    }
  }

  _refresh(i) {
    const o = this.owner[i];
    for (let c = 0; c < 2; c++) {
      if (o !== c && this.adj[c][i] > 0) this.targets[c].add(i);
      else this.targets[c].remove(i);
    }
  }

  // Bascule un groupe de cellules frontalières (événement « perte temporaire »)
  flipCluster(toSide, amount) {
    const set = this.targets[toSide];
    if (set.size === 0) return 0;
    const from = 1 - toSide;
    const start = set.random(this.rng);
    const queue = [start];
    const seen = new Set([start]);
    let flipped = 0;
    while (queue.length && flipped < amount) {
      const i = queue.shift();
      if (this.owner[i] !== from) continue;
      this.flip(i, toSide);
      flipped++;
      for (let k = 0; k < 8; k++) {
        const j = this.grid.neighbors[i * 8 + k];
        if (j >= 0 && !seen.has(j) && this.owner[j] === from) { seen.add(j); queue.push(j); }
      }
    }
    return flipped;
  }

  startRegional(duration) {
    const pool = this.targets[0].size >= this.targets[1].size ? this.targets[0] : this.targets[1];
    if (pool.size === 0) return null;
    const i = pool.random(this.rng);
    const g = this.grid;
    const rc = Math.max(3, Math.round(Math.sqrt(this.n) / 14));
    this.regional = { x: g.cx[i], y: g.cy[i], r: rc * g.cellSize, rc, until: this.time + duration, start: this.time };
    // la zone devient contestée
    for (let y = g.gy[i] - rc; y <= g.gy[i] + rc; y++) {
      for (let x = g.gx[i] - rc; x <= g.gx[i] + rc; x++) {
        if (x < 0 || y < 0 || x >= g.gw || y >= g.gh) continue;
        const j = g.indexAt[y * g.gw + x];
        if (j >= 0 && (x - g.gx[i]) ** 2 + (y - g.gy[i]) ** 2 <= rc * rc) this.contest[j] = this.time + duration;
      }
    }
    return this.regional;
  }

  // ---------- poches isolées ----------
  _computeIsolation() {
    const g = this.grid;
    const seen = new Uint8Array(this.n);
    this.isolated.fill(0);
    for (let s = 0; s < 2; s++) {
      // composante principale : celle de la capitale si tenue, sinon la plus grande
      let seedCell = g.capitals[s] >= 0 && this.owner[g.capitals[s]] === s ? g.capitals[s] : -1;
      const comps = [];
      for (let i = 0; i < this.n; i++) {
        if (this.owner[i] !== s || seen[i]) continue;
        const comp = [];
        const stack = [i]; seen[i] = 1;
        while (stack.length) {
          const a = stack.pop(); comp.push(a);
          for (let k = 0; k < 8; k++) {
            const b = g.neighbors[a * 8 + k];
            if (b >= 0 && !seen[b] && this.owner[b] === s) { seen[b] = 1; stack.push(b); }
          }
        }
        comps.push(comp);
      }
      let main = null;
      if (seedCell >= 0) main = comps.find((c) => c.includes(seedCell));
      if (!main) main = comps.reduce((m, c) => (!m || c.length > m.length ? c : m), null);
      for (const comp of comps) {
        if (comp === main) continue;
        // une île d'origine n'est pas une poche : seules les poches encerclées s'affaiblissent
        let touchesEnemy = false;
        for (const a of comp) if (this.adj[1 - s][a] > 0) { touchesEnemy = true; break; }
        if (!touchesEnemy) continue;
        if (comp.length > Math.max(25, this.sides[s].initial * 0.15)) continue;
        for (const a of comp) this.isolated[a] = 1;
      }
    }
  }

  // ---------- débarquement (pays sans frontière terrestre commune) ----------
  _landing(c) {
    const d = 1 - c;
    const g = this.grid;
    const own = [], enemy = [];
    for (let k = 0; k < 400 && (own.length < 40 || enemy.length < 60); k++) {
      const i = this.rng.int(this.n);
      if (!g.coastal[i]) continue;
      if (this.owner[i] === c && own.length < 40) own.push(i);
      else if (this.owner[i] === d && enemy.length < 60) enemy.push(i);
    }
    if (!own.length || !enemy.length) return;
    let best = -1, bestD = Infinity;
    for (const a of own) for (const b of enemy) {
      const dx = g.cx[a] - g.cx[b], dy = g.cy[a] - g.cy[b];
      const dd = dx * dx + dy * dy;
      if (dd < bestD) { bestD = dd; best = b; }
    }
    const A = this.attackPower(c, best), D = this.defensePower(d, best);
    const s = this.sides[c];
    if (this.rng.next() < sigmoid(1.5 * Math.log(A / D) + 0.2)) {
      this.flip(best, c);
      let extra = 0;
      for (let k = 0; k < 8 && extra < (this.landContact ? 4 : 7); k++) {
        const j = g.neighbors[best * 8 + k];
        if (j >= 0 && this.owner[j] === d) { this.flip(j, c); extra++; }
      }
      // on n'annonce pas chaque traversée : au plus une toutes les 40 s par pays
      if (this.time - (s.lastLandingMsg || -99) > 40) {
        s.lastLandingMsg = this.time;
        this._emit({ icon: '⛵', title: 'TRAVERSÉE', tone: 'good', side: c,
          text: `${this.name(c)} établit une tête de pont sur le territoire de ${this.name(d)}.` });
      }
    }
  }

  _emit(evt) {
    const e = { ...evt, t: this.time };
    this.eventsOut.push(e);
    this.log.push(e);
  }

  // ---------- boucle principale ----------
  step() {
    if (this.finished) return;
    this.time += TICK;
    this.tickCount++;
    const rng = this.rng;
    const randomness = clamp(this.cfg.randomness, 0, 1);

    for (const s of this.sides) {
      s.mods = s.mods.filter((m) => m.until > this.time);
      if (this.time >= s.phaseUntil) {
        const exp = s.stats.expansion / 100;
        if (s.phase === 'offensive') {
          s.phase = 'consolidation';
          s.phaseUntil = this.time + rng.range(4, 10) * (1.35 - exp * 0.7);
        } else {
          s.phase = 'offensive';
          s.phaseUntil = this.time + rng.range(6, 15) * (0.7 + exp * 0.6);
        }
      }
      // élan : marche aléatoire qui revient vers 0 (Ornstein-Uhlenbeck)
      const sigma = TUNE.momSigma + TUNE.momSigmaR * randomness;
      s.momentum += -s.momentum * TUNE.momRevert * TICK + sigma * Math.sqrt(TICK) * rng.normal();
      s.momentum = clamp(s.momentum, -TUNE.momMax, TUNE.momMax);
      const terr = Math.sqrt(Math.max(0.05, s.cells / s.initial));
      s.resources = Math.min(100, s.resources + s.regen * terr * TICK);
      // la stabilité suit la situation territoriale (symétrique quelle que soit la taille du pays)
      const stabTarget = s.baseStability * (0.55 + 0.45 * Math.min(1.15, s.cells / s.initial));
      s.stability += (stabTarget - s.stability) * 0.12 * TICK;
      s.stability = clamp(s.stability, 0.15, 1);
    }

    for (const s of this.sides) this._updateUnits(s);

    const order = rng.next() < 0.5 ? [0, 1] : [1, 0];
    // le rythme dépend du plus petit des deux pays : un petit pays ne s'effondre pas en quelques secondes
    const m = Math.min(this.n, 2 * Math.min(this.sides[0].initial, this.sides[1].initial));
    const basePerSecond = TUNE.rate * this.cfg.pace * Math.max(6, 0.0155 * m);
    // coût en ressources d'une action : une poussée continue consomme ~6 ressources/s
    this.attemptCost = 3.8 / basePerSecond;
    const warmup = 0.45 + 0.55 * Math.min(1, this.time / 15); // démarrage progressif
    const perSecond = basePerSecond * warmup * (1 + TUNE.ramp * this.intensity());
    for (const c of order) {
      const s = this.sides[c];
      const noFront = this.targets[c].size === 0;
      if (noFront || !this.landContact) {
        s.landingAcc += TICK * (s.phase === 'offensive' ? 1.4 : 0.7);
        const every = noFront ? 1.4 : 2.2;
        if (s.landingAcc >= every && this.sides[1 - c].cells > 0) { s.landingAcc = 0; this._landing(c); }
        if (noFront) continue;
      }
      const phaseF = s.phase === 'offensive' ? 1.55 : 0.6;
      const resF = s.resources < 10 ? 0.35 + s.resources * 0.065 : 1;
      const rate = perSecond * s.rateFactor * phaseF * resF * this._mod(c, 'attempts');
      s.attemptAcc += rate * TICK;
      const engaged = s.units.filter((u) => u.engaged && this.time >= u.bornAt);
      let guard = 0;
      while (s.attemptAcc >= 1 && guard++ < 200) {
        s.attemptAcc -= 1;
        const { i, unit } = this._pickTarget(c, engaged);
        if (i < 0) break;
        this._attempt(c, i, unit);
      }
    }

    if (this.time >= this.nextEventAt) {
      const choice = pickEvent(this, rng);
      if (choice) {
        const r = choice.type.apply(this, choice.side, rng);
        const obj = typeof r === 'string' ? { text: r } : r;
        this._emit({ icon: choice.type.icon, title: obj.title || choice.type.title, tone: obj.tone || choice.type.tone,
          side: choice.type.global ? -1 : choice.side, id: choice.type.id, text: obj.text });
      }
      this.nextEventAt = this.time + Math.max(5, rng.exp(this.eventInterval));
    }
    if (this.regional && this.time >= this.regional.until) this.regional = null;

    if (this.tickCount % 20 === 0) {
      this._computeIsolation();
      this.history.push([this.time, this.share(0)]);
      this._checkEnd();
    }
  }

  _checkEnd() {
    const vr = this.cfg.victoryRatio;
    for (let s = 0; s < 2; s++) {
      const d = 1 - s;
      if (this.sides[d].cells === 0 || this.ratio(d) <= vr) {
        return this._finish(s, 'territoire');
      }
    }
    if (this.time >= this.cfg.maxDuration) {
      const r0 = this.ratio(0), r1 = this.ratio(1);
      const winner = Math.abs(r0 - r1) < 0.02 ? -1 : r0 > r1 ? 0 : 1;
      this._finish(winner, 'temps');
    }
  }

  _finish(winner, reason) {
    this.finished = true;
    this.result = {
      winner,
      reason,
      time: this.time,
      share: [this.share(0), this.share(1)],
      ratio: [this.ratio(0), this.ratio(1)],
      captured: [this.sides[0].captured, this.sides[1].captured],
      history: this.history,
      events: this.log.length,
    };
  }

  // Résumé lisible (panneau statistiques)
  snapshot() {
    return this.sides.map((s, k) => ({
      share: this.share(k),
      ratio: this.ratio(k),
      cells: s.cells,
      stability: s.stability,
      resources: s.resources,
      momentum: s.momentum,
      phase: s.phase,
      units: s.units.length,
      front: this.targets[k].size,
      mods: s.mods.map((m) => m.label).filter(Boolean),
      attack: this.attackPower(k, -1),
    }));
  }
}
