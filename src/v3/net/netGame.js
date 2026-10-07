// MULTIJOUEUR — partie partagée en « lockstep » : chaque ordinateur fait tourner la même simulation
// (déterministe) ; seuls les ORDRES des joueurs circulent. L'hôte donne le rythme (pas de simulation autorisés),
// date chaque ordre d'un pas et d'un numéro d'ordre ; les invités l'exécutent au même pas, dans le même ordre.
// Un invité qui rejoint reçoit l'état complet de la partie. Une empreinte de l'état est comparée tous les
// HASH_EVERY pas : en cas d'écart (désynchronisation), l'hôte renvoie l'état complet à l'invité concerné.

export const NET_VERSION = 'worldsim-mp-1';
export const HASH_EVERY = 200;      // pas de simulation entre deux vérifications (10 s de simulation)
const MAX_LAG = 160;                // l'hôte attend un invité en retard de plus de MAX_LAG pas
const GUEST_MAX_STEPS = 160;        // rattrapage maximal par image chez un invité

// empreinte de l'état de la simulation (rapide, uniquement des données de simulation)
export function stateHash(sim) {
  let h = 2166136261 >>> 0;
  const mix = (v) => { h ^= v & 0xffff; h = Math.imul(h, 16777619) >>> 0; h ^= (v >>> 16) & 0xffff; h = Math.imul(h, 16777619) >>> 0; };
  mix(sim.tickCount | 0); mix(sim.rng.state >>> 0);
  const o = sim.owner, oc = sim.occupied;
  for (let i = 0; i < o.length; i++) mix(o[i] + (oc ? oc[i] << 16 : 0));   // propriétaire et état d'occupation
  for (const s of sim.sides) { mix(s.cells | 0); mix(Math.round(s.units * 1000) | 0); mix(Math.round(s.money * 1000) | 0); mix(Math.round(s.morale * 10000) | 0); mix(s.agents ? s.agents.length : 0); }
  mix(sim.wars.length); mix(sim.transports ? sim.transports.length : 0);
  return h >>> 0;
}

// adapter : { sim(), exec(cmd) -> résultat, snapshot() -> Promise<données> (hôte), load(data, side) -> Promise (invité),
//             event(type, payload), setPaused(bool), setSpeed(n), paused(), speed(), localName() }
export class NetGame {
  constructor(role, adapter) {
    this.role = role;
    this.ad = adapter;
    this.peers = [];          // hôte : [{ id, link, name, side, ack, loaded }]
    this.seq = 0;             // numéro du dernier ordre exécuté
    this.hashes = new Map();  // hôte : pas -> empreinte
    this.queue = [];          // invité : ordres en attente [{ t, s, cmd }]
    this.allowed = 0;         // invité : pas autorisé par l'hôte
    this.loaded = role === 'host';
    this.buffer = [];
    this.chat = [];
    this.active = true;
    this._pid = 0;
    this._lastFrame = -1;
    this._lastAck = 0;
    this.stalled = false;
    this.status = role === 'host' ? 'Partie ouverte' : 'Connexion…';
  }
  get isHost() { return this.role === 'host'; }
  get inGame() { return this.active && this.loaded; }

  // ======================= HÔTE =======================
  addLink(link) {
    const p = { id: ++this._pid, link, name: 'Joueur', side: -1, ack: 0, loaded: false, ping: 0 };
    this.peers.push(p);
    link.onmessage = (m) => this._hostMsg(p, m);
    link.onclose = () => this._peerGone(p);
    return p;
  }
  _send(p, m) { if (p.link && !p.link.closed) p.link.send(m); }
  broadcast(m, except = null) {
    for (const p of this.peers) {
      if (p === except) continue;
      if (p.loaded) this._send(p, m);
      else if (p.awaiting) p.pend.push(m);       // invité en cours de chargement : messages gardés pour après l'état complet
    }
  }
  lobbyInfo() {
    const sim = this.ad.sim(), n = sim.nation;
    const taken = new Map(this.peers.filter((p) => p.side >= 0).map((p) => [p.side, p.name]));
    taken.set(n.player, this.ad.localName());
    return {
      host: this.ad.localName(), date: sim.dateStr ? sim.dateStr(sim.time) : '',
      countries: sim.sides.map((s, k) => ({ k, e: s.e, name: s.name, human: n.isHuman(k), taken: taken.get(k) || null, eliminated: !!s.eliminated, cells: s.cells, gdp: s.eco ? s.eco.gdp : 0 }))
        .filter((c) => !c.eliminated),
      players: this.players(),
    };
  }
  players() {
    const sim = this.ad.sim();
    const n = sim && sim.nation;
    const list = [{ name: this.ad.localName(), side: n ? n.player : -1, host: true, lag: 0 }];
    for (const p of this.peers) if (p.side >= 0) list.push({ name: p.name, side: p.side, host: false, lag: sim ? Math.max(0, sim.tickCount - p.ack) : 0, id: p.id });
    return list;
  }
  _hostMsg(p, m) {
    const sim = this.ad.sim();
    if (!m || !sim) return;
    switch (m.type) {
      case 'hello':
        if (m.v !== NET_VERSION) { this._send(p, { type: 'error', text: 'Versions du jeu différentes : mettez à jour WorldSimulator chez tous les joueurs.' }); setTimeout(() => p.link.close(), 500); return; }
        p.name = String(m.name || 'Joueur').slice(0, 24);
        this._send(p, { type: 'lobby', ...this.lobbyInfo() });
        this.ad.event('peer', { name: p.name, text: `${p.name} est connecté et choisit son pays.` });
        return;
      case 'pick': {
        const k = Number(m.k);
        const sd = sim.sides[k];
        const owner = this.players().find((x) => x.side === k);
        if (!sd || sd.eliminated || owner) { this._send(p, { type: 'lobby', ...this.lobbyInfo(), error: 'Ce pays n\'est plus disponible.' }); return; }
        if (!sim.nation.isHuman(k)) this.submit({ op: 'join', a: sim.nation.player, k, name: p.name });
        else this.submit({ op: 'rename', a: sim.nation.player, k, name: p.name });
        p.side = k;
        this.sendSnapshot(p, 'join');
        this.ad.event('join', { name: p.name, side: k, text: `${p.name} dirige désormais ${sd.name}.` });
        this.broadcast({ type: 'players', players: this.players() }, p);
        return;
      }
      case 'cmd':
        if (p.side < 0 || !p.loaded || !m.cmd) return;
        this.submit({ ...m.cmd, a: p.side });
        return;
      case 'ack': p.ack = Number(m.t) || 0; if (m.ping) p.ping = m.ping; return;
      case 'h': {
        const h = this.hashes.get(m.t);
        if (h !== undefined && h !== m.h) { this.ad.event('desync', { name: p.name, text: `Écart de simulation détecté chez ${p.name} : resynchronisation.` }); this.sendSnapshot(p, 'resync'); }
        return;
      }
      case 'resync': this.sendSnapshot(p, 'resync'); return;
      case 'chat': {
        const msg = { type: 'chat', from: p.name, side: p.side, text: String(m.text || '').slice(0, 400), t: Date.now() };
        this._chat(msg); this.broadcast(msg);
        return;
      }
      case 'req':
        if (m.what === 'pause') this.ad.setPaused(true);
        else if (m.what === 'resume') this.ad.setPaused(false);
        else if (m.what === 'speed') this.ad.setSpeed(Math.min(10, Math.max(0.25, Number(m.v) || 1)));   // ×10 au maximum
        this.ad.event('req', { name: p.name, text: `${p.name} : ${m.what === 'pause' ? 'pause' : m.what === 'resume' ? 'reprise' : `vitesse ×${m.v}`}.` });
        this._frame(true);
        return;
      default:
    }
  }
  sendSnapshot(p, why) {
    const sim = this.ad.sim();
    p.loaded = false;
    p.awaiting = true; p.pend = [];
    const meta = { seq: this.seq, t: sim.tickCount, side: p.side, why, players: null };
    p.ack = meta.t;
    this.ad.snapshot().then((data) => {
      meta.players = this.players();
      this._send(p, { type: 'snap', ...meta, data, chat: this.chat.slice(-30) });
      for (const m of p.pend) this._send(p, m);
      p.pend = []; p.awaiting = false; p.loaded = true;
    }).catch((e) => { p.awaiting = false; this.ad.event('error', { text: 'Envoi de la partie impossible : ' + e.message }); });
  }
  _peerGone(p) {
    this.peers = this.peers.filter((x) => x !== p);
    if (p.side >= 0) {
      const sim = this.ad.sim();
      this.ad.event('left', { name: p.name, side: p.side, text: `${p.name} a quitté la partie${sim ? ` : ${sim.sides[p.side].name} attend son retour (vous pouvez le confier à l'IA)` : ''}.` });
      this.broadcast({ type: 'players', players: this.players() });
    }
  }
  kick(id) { const p = this.peers.find((x) => x.id === id); if (p) { this._send(p, { type: 'error', text: 'L\'hôte vous a retiré de la partie.' }); setTimeout(() => p.link.close(), 300); } }

  // ======================= ORDRES =======================
  // hôte : exécution immédiate au pas courant, puis diffusion ; invité : envoi à l'hôte
  submit(cmd) {
    const sim = this.ad.sim();
    if (!sim) return null;
    if (!this.isHost) {
      if (!this.loaded || !this.link) return null;
      this.link.send({ type: 'cmd', cmd });
      return { pending: true, ok: true, result: 'pending', text: 'Ordre transmis à l\'hôte : il s\'applique dans un instant.', factors: [] };
    }
    const res = this.ad.exec(cmd);
    this.seq++;
    this.broadcast({ type: 'c', t: sim.tickCount, s: this.seq, cmd });
    return res;
  }

  // ======================= INVITÉ =======================
  connect(link) {
    this.link = link;
    link.onmessage = (m) => this._guestMsg(m);
    link.onclose = () => { if (!this.active) return; this.active = false; this.ad.event('hostLost', { text: 'La connexion avec l\'hôte est perdue. Vous continuez seul cette partie.' }); };
    link.send({ type: 'hello', v: NET_VERSION, name: this.ad.localName() });
  }
  pick(k) { if (this.link) this.link.send({ type: 'pick', k }); }
  _guestMsg(m) {
    if (!m) return;
    if (m.type === 'snap') { this._loadSnap(m); return; }
    if (!this.loaded && (m.type === 'c' || m.type === 'f')) { this.buffer.push(m); return; }
    switch (m.type) {
      case 'lobby': this.ad.event('lobby', m); return;
      case 'error': this.ad.event('error', { text: m.text }); return;
      case 'c': this._enqueue(m); return;
      case 'f': this.allowed = Math.max(this.allowed, m.t); this.hostPaused = !!m.p; this.hostSpeed = m.sp; if (this.ad.mirror) this.ad.mirror(m); return;
      case 'players': this.playersList = m.players; this.ad.event('players', m); return;
      case 'chat': this._chat(m); return;
      default:
    }
  }
  async _loadSnap(m) {
    this.loaded = false;
    this.queue = [];
    try {
      await this.ad.load(m.data, m.side);
    } catch (e) { this.ad.event('error', { text: 'Chargement de la partie impossible : ' + e.message }); return; }
    this.seq = m.seq;
    this.allowed = m.t;
    this.side = m.side;
    if (m.players) this.playersList = m.players;
    if (m.chat && !this.chat.length) for (const c of m.chat) this.chat.push(c);
    this.loaded = true;
    const buf = this.buffer; this.buffer = [];
    for (const x of buf) this._guestMsg(x);
    this.status = 'Connecté';
    this.ad.event(m.why === 'resync' ? 'resynced' : 'joined', { side: m.side, text: m.why === 'resync' ? 'Partie resynchronisée avec l\'hôte.' : 'Vous avez rejoint la partie.' });
  }
  _enqueue(m) {
    if (m.s <= this.seq) return;
    const sim = this.ad.sim();
    this.queue.push(m);
    if (sim && sim.tickCount > m.t) { this._requestResync(); return; }
    if (sim && sim.tickCount === m.t) this.applyDue(sim);
  }
  _requestResync() { if (this._resyncAsked && performance.now() - this._resyncAsked < 3000) return; this._resyncAsked = performance.now(); this.loaded = false; this.link.send({ type: 'resync' }); }
  applyDue(sim) {
    if (this.isHost || !this.loaded) return;
    this.queue.sort((x, y) => x.s - y.s);
    while (this.queue.length && this.queue[0].t <= sim.tickCount) {
      const m = this.queue.shift();
      if (m.t < sim.tickCount || m.s !== this.seq + 1) { this._requestResync(); return; }
      this.ad.exec(m.cmd);
      this.seq = m.s;
    }
  }

  // ======================= RYTHME (appelé par la session) =======================
  // nombre de pas que cette machine peut simuler maintenant (desired : pas voulus par la vitesse locale)
  budget(sim, desired) {
    if (!this.active) return desired;
    if (this.isHost) {
      const lag = this.peers.filter((p) => p.side >= 0 && p.loaded && !p.link.closed);
      const min = lag.length ? Math.min(...lag.map((p) => p.ack)) : sim.tickCount;
      this.stalled = sim.tickCount - min > MAX_LAG;
      return this.stalled ? 0 : desired;
    }
    if (!this.loaded) return 0;
    return Math.max(0, Math.min(this.allowed - sim.tickCount, GUEST_MAX_STEPS));
  }
  beforeStep(sim) { if (!this.isHost) this.applyDue(sim); }
  afterStep(sim) {
    if (sim.tickCount % HASH_EVERY !== 0) return;
    const h = stateHash(sim);
    if (this.isHost) { this.hashes.set(sim.tickCount, h); if (this.hashes.size > 40) this.hashes.delete(this.hashes.keys().next().value); }
    else if (this.loaded) this.link.send({ type: 'h', t: sim.tickCount, h });
  }
  afterFrame(sim) {
    if (!this.active || !sim) return;
    if (this.isHost) this._frame(false);
    else if (this.loaded) {
      this.applyDue(sim);
      const now = performance.now();
      if (now - this._lastAck > 250 || sim.tickCount - (this._lastAckT || 0) >= 40) { this._lastAck = now; this._lastAckT = sim.tickCount; this.link.send({ type: 'ack', t: sim.tickCount }); }
    }
  }
  _frame(force) {
    const sim = this.ad.sim();
    if (!sim) return;
    const now = performance.now();
    if (!force && sim.tickCount === this._lastFrame && now - (this._lastFrameAt || 0) < 1000) return;
    this._lastFrame = sim.tickCount; this._lastFrameAt = now;
    this.broadcast({ type: 'f', t: sim.tickCount, p: this.ad.paused(), sp: this.ad.speed() });
  }

  // ======================= DIVERS =======================
  sendChat(text) {
    text = String(text || '').trim().slice(0, 400);
    if (!text) return;
    if (this.isHost) { const sim = this.ad.sim(); const msg = { type: 'chat', from: this.ad.localName(), side: sim && sim.nation ? sim.nation.player : -1, text, t: Date.now() }; this._chat(msg); this.broadcast(msg); }
    else if (this.link) this.link.send({ type: 'chat', text });
  }
  _chat(m) { this.chat.push(m); if (this.chat.length > 200) this.chat.shift(); this.ad.event('chat', m); }
  request(what, v) { if (this.isHost) { if (what === 'pause') this.ad.setPaused(true); else if (what === 'resume') this.ad.setPaused(false); else this.ad.setSpeed(v); this._frame(true); } else if (this.link) this.link.send({ type: 'req', what, v }); }
  close() {
    this.active = false;
    if (this.isHost) for (const p of this.peers) { this._send(p, { type: 'error', text: 'L\'hôte a fermé la partie multijoueur.' }); setTimeout(() => p.link.close(), 300); }
    else if (this.link) this.link.close();
  }
}
