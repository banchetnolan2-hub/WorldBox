// UI — MULTIJOUEUR : héberger une partie Nation, inviter des amis (code de partie par relais chiffré ;
// autres méthodes : code d'invitation WebRTC ou adresse IP), rejoindre une partie, choisir son pays,
// liste des joueurs, messagerie, quitter.
import { $, show, isShown, esc, notice, flagImg } from './util.js';
import { icon } from './icons.js';
import { NetGame, stateHash, NET_VERSION } from '../net/netGame.js';
import { relayHost, relayJoin, normalizeCode } from '../net/relay.js';
import { rtcInvite, rtcAnswer, tcpListen, tcpStop, tcpConnect, hasTcp, DEFAULT_PORT } from '../net/transport.js';
import { execCommand } from '../net/commands.js';
import { activeOverrides } from '../sim/borderEdit.js';

const NAME_KEY = 'ws-mp-name';
/* global __APP_VERSION__ */
export const GAME_VERSION = (typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : 'dev') + ' (' + NET_VERSION + ')';
const loadName = () => { try { return localStorage.getItem(NAME_KEY) || ''; } catch (_) { return ''; } };
// relais personnalisés (avancé) : liste JSON [{ name, url, user?, pass? }] dans le stockage local
const customRelays = () => { try { const r = JSON.parse(localStorage.getItem('ws-relays') || 'null'); return Array.isArray(r) && r.length ? r : undefined; } catch (_) { return undefined; } };
const saveName = (v) => { try { localStorage.setItem(NAME_KEY, v); } catch (_) { /* stockage indisponible */ } };

export class NetUI {
  constructor(app) {
    this.app = app;
    this.net = null;
    this.name = loadName() || 'Joueur';
    this.invites = [];          // invitations en cours (hôte) : { code, accept, link, state }
    this.unread = 0;
    const t = document.createElement('template');
    t.innerHTML = `<section id="mpDialog" class="overlay hidden"><div class="dialog panel mp" id="mpBox"></div></section>`;
    document.body.appendChild(t.content.firstChild);
    const t2 = document.createElement('template');
    t2.innerHTML = `<aside id="mpPanel" class="panel hidden"><div class="nm-head"><div class="nm-title"><div><small class="eyebrow">Partie partagée</small><b>Multijoueur</b></div></div><button class="btn ghost sm icon" id="mpClose" title="Fermer">${icon('x')}</button></div><div class="nm-body" id="mpBody"></div></aside>`;
    document.body.appendChild(t2.content.firstChild);
    $('mpClose').onclick = () => this.closePanel();
    $('mpBody').addEventListener('keydown', (e) => e.stopPropagation());
    $('mpBox').addEventListener('keydown', (e) => e.stopPropagation());
  }
  get sim() { return this.app.session.sim; }
  debugState() { const sim = this.sim; return sim ? { tick: sim.tickCount, hash: stateHash(sim), humans: sim.nation ? sim.nation.humanList() : [], local: sim.localSide ?? null, role: this.net ? this.net.role : null, loaded: this.net ? this.net.loaded : null } : null; }
  get active() { return !!(this.net && this.net.active); }
  isOpen() { return isShown('mpDialog') || isShown('mpPanel'); }
  close() { show('mpDialog', false); this.closePanel(); }

  // ---------------- adaptateur réseau <-> application ----------------
  _adapter() {
    const app = this.app;
    return {
      sim: () => app.session.sim,
      exec: (cmd) => execCommand(app.session.sim, cmd, app.cmdHooks),
      snapshot: () => app.netSnapshot(),
      load: (data, side) => app.netLoad(data, side, this.net),
      event: (type, p) => this._event(type, p),
      setPaused: (b) => { if (b) app.session.pause(); else app.session.resume(); app.hud.setPaused(app.session.state === 'paused'); },
      setSpeed: (s) => app.setSpeed(s),
      paused: () => app.session.state !== 'running',
      speed: () => app.session.speed,
      localName: () => this.name,
      mirror: (m) => { const s = app.session; s.speed = m.sp || s.speed; if (s.state !== 'ended') s.state = m.p ? 'paused' : 'running'; app.hud.setPaused(!!m.p); app.hud.setSpeed(s.speed); },
    };
  }
  _event(type, p = {}) {
    if (type === 'chat') {
      if (!isShown('mpPanel')) { this.unread++; notice(`💬 ${p.from} : ${p.text}`, 4200); }
      this._renderChat();
      this._railBadge();
      return;
    }
    if (type === 'lobby') { this._lobby(p); return; }
    if (type === 'error') { notice(p.text, 5000); if (!this.net || !this.net.loaded) this._joinStatus(p.text, true); return; }
    if (type === 'hostLost') { notice(p.text, 6000); this._fallbackSolo(); return; }
    if (p.text) notice(p.text, 4200);
    if (type === 'joined') { show('mpDialog', false); this.openPanel(); }
    this.render();
  }

  // ---------------- menu principal ----------------
  openMenu(tab = 'join') {
    this.tab = tab;
    const tcp = hasTcp();
    $('mpBox').innerHTML = `
      <div class="rules-head"><div><small class="eyebrow">Multijoueur</small><h2>Jouer à plusieurs</h2>
        <p class="hint">Un ordinateur héberge la partie Nation, les autres la rejoignent. Aucun port à ouvrir sur la box : un code d'invitation suffit. Chaque joueur dirige un pays ; l'IA dirige les autres.</p></div>
        <button class="btn ghost sm icon" id="mpX">${icon('x')}</button></div>
      <div class="field"><label><span>Votre nom de joueur</span></label><input type="text" id="mpName" maxlength="24" value="${esc(this.name)}"></div>
      <div class="seg mp-tabs"><button data-tab="host" class="${tab === 'host' ? 'on' : ''}">${icon('landmark')}<span>Héberger</span></button><button data-tab="join" class="${tab === 'join' ? 'on' : ''}">${icon('users')}<span>Rejoindre</span></button></div>
      <div id="mpTab"></div>`;
    $('mpX').onclick = () => show('mpDialog', false);
    $('mpName').oninput = () => { this.name = $('mpName').value.trim().slice(0, 24) || 'Joueur'; saveName(this.name); };
    $('mpBox').querySelectorAll('[data-tab]').forEach((b) => b.onclick = () => this.openMenu(b.dataset.tab));
    const box = $('mpTab');
    if (tab === 'host') {
      box.innerHTML = `<ol class="mp-steps"><li>Lancez une partie <b>Nation Simulator</b> (nouvelle ou sauvegardée).</li><li>Ouvrez le panneau <b>Multijoueur</b> : un <b>code de partie</b> s'affiche (ex. H7KQ2-M9XAPQ).</li><li>Envoyez ce code à vos amis (Discord, WhatsApp…) : chacun le saisit dans Multijoueur → Rejoindre, choisit son pays et vous rejoint.</li></ol>
        <div class="row"><button class="btn primary" id="mpNew">${icon('play')}<span>Nouvelle partie à héberger</span></button><button class="btn ghost" id="mpLoad">${icon('folder-open')}<span>Héberger une partie sauvegardée</span></button></div>
        ${this.sim && this.sim.nation ? `<p class="hint">Une partie Nation est en cours : <a href="#" id="mpNow">l'ouvrir aux autres joueurs maintenant</a>.</p>` : ''}`;
      $('mpNew').onclick = () => { this.app.pendingHost = true; show('mpDialog', false); this.app.nationUI.openPick(); notice('Choisissez votre pays : la partie sera ouverte aux autres joueurs.', 3500); };
      $('mpLoad').onclick = () => { this.app.pendingHost = true; show('mpDialog', false); this.app.openLoadGame(); };
      const now = $('mpNow'); if (now) now.onclick = (e) => { e.preventDefault(); show('mpDialog', false); this.host(); };
    } else {
      box.innerHTML = `
        <div class="mp-method mp-main"><h4>${icon('key')}<span>Code de partie</span></h4>
          <p class="hint">Saisissez le code donné par l'hôte. La connexion passe par des relais publics, chiffrée de bout en bout : aucun port à ouvrir.</p>
          <div class="row"><input type="text" id="mpCode" class="mp-codein" placeholder="H7KQ2-M9XAPQ" maxlength="16" spellcheck="false" autocomplete="off"><button class="btn primary" id="mpJoinCode">${icon('log-in')}<span>Rejoindre</span></button></div></div>
        <div id="mpJoinStatus" class="hint"></div>
        <details class="mp-other"><summary>Autres méthodes</summary>
        <div class="mp-method"><h4>${icon('link')}<span>Avec un code d'invitation direct (WebRTC)</span></h4>
          <p class="hint">Collez le code reçu de l'hôte (il commence par WSI-), puis renvoyez-lui le code de réponse.</p>
          <textarea id="mpInvite" rows="3" placeholder="WSI-…" spellcheck="false"></textarea>
          <div class="row"><button class="btn primary" id="mpAnswer">${icon('repeat')}<span>Créer ma réponse</span></button></div>
          <div id="mpReply"></div></div>
        <div class="mp-method"><h4>${icon('wifi')}<span>Par adresse IP (réseau local, Tailscale, ZeroTier, Radmin VPN)</span></h4>
          ${tcp ? `<div class="row"><input type="text" id="mpHost" placeholder="ex. 100.64.12.7 ou 192.168.1.20" spellcheck="false"><input type="number" id="mpPort" value="${DEFAULT_PORT}" min="1" max="65535"><button class="btn ghost" id="mpConnect">${icon('plug')}<span>Se connecter</span></button></div>` : '<p class="hint">Disponible dans l\'application Windows.</p>'}</div>
        </details>`;
      $('mpAnswer').onclick = () => this._answer();
      $('mpJoinCode').onclick = () => this._codeJoin();
      $('mpCode').onkeydown = (e) => { e.stopPropagation(); if (e.key === 'Enter') this._codeJoin(); };
      $('mpCode').oninput = () => { const v = normalizeCode($('mpCode').value); if (v && v !== $('mpCode').value) $('mpCode').value = v; };
      setTimeout(() => { const c = $('mpCode'); if (c) c.focus(); }, 50);
      if (tcp) $('mpConnect').onclick = () => this._tcpJoin();
    }
    show('mpDialog');
  }
  _joinStatus(text, bad = false) { const el = $('mpJoinStatus'); if (el) el.innerHTML = `<span class="${bad ? 'bad' : ''}">${esc(text)}</span>`; }
  _newGuest() {
    if (this.net) this.net.close();
    this.net = new NetGame('guest', this._adapter());
    return this.net;
  }
  async _answer() {
    const code = $('mpInvite').value;
    try {
      this._joinStatus('Préparation de la réponse…');
      const r = await rtcAnswer(code);
      const net = this._newGuest();
      r.link.onopen = () => { this._joinStatus('Connecté à l\'hôte : choix du pays…'); net.connect(r.link); };
      r.link.onclose = () => { if (!net.loaded) this._joinStatus('La connexion a échoué. Réessayez, ou utilisez Tailscale/ZeroTier et la connexion par adresse IP.', true); };
      $('mpReply').innerHTML = `<p class="hint">Envoyez ce code de réponse à l'hôte, qui le colle dans son panneau Multijoueur :</p>
        <div class="mp-code"><textarea readonly rows="3" id="mpReplyCode">${esc(r.code)}</textarea><button class="btn accent sm" id="mpCopyReply">${icon('copy')}<span>Copier</span></button></div>`;
      $('mpCopyReply').onclick = () => this._copy(r.code);
      this._joinStatus('En attente de la connexion de l\'hôte…');
    } catch (e) { this._joinStatus(e.message, true); }
  }
  async _codeJoin() {
    const raw = $('mpCode').value, code = normalizeCode(raw);
    if (!code) { this._joinStatus('Code invalide : il a la forme H7KQ2-M9XAPQ (11 lettres et chiffres).', true); return; }
    if (this._joining) return;
    this._joining = true;
    const btn = $('mpJoinCode'); if (btn) btn.disabled = true;
    this._joinStatus(`Recherche de la partie ${code}… (15 s au maximum)`);
    try {
      const link = await relayJoin(code, { version: GAME_VERSION, name: this.name, relays: customRelays() });
      const net = this._newGuest();
      link.onresume = (relay) => { notice(`Connexion rétablie par un autre relais (${relay}) : resynchronisation.`, 3500); if (net.loaded) net._requestResync(); };
      net.connect(link);
      this._joinStatus(`Connecté par le relais ${link.relay} : choix du pays…`);
    } catch (e) { this._joinStatus(e.message, true); }
    finally { this._joining = false; const b = $('mpJoinCode'); if (b) b.disabled = false; }
  }
  async _tcpJoin() {
    const host = $('mpHost').value.trim(), port = Number($('mpPort').value) || DEFAULT_PORT;
    if (!host) { this._joinStatus('Indiquez l\'adresse IP de l\'hôte.', true); return; }
    try {
      this._joinStatus(`Connexion à ${host}…`);
      const link = await tcpConnect(host, port);
      this._newGuest().connect(link);
      this._joinStatus('Connecté à l\'hôte : choix du pays…');
    } catch (e) { this._joinStatus(`Connexion impossible (${e.message}). Vérifiez l'adresse et que l'hôte a ouvert la partie.`, true); }
  }
  // choix du pays (invité)
  _lobby(m) {
    this.lobbyData = m;
    const q = (this.lobbyQuery || '').toLowerCase();
    const ents = this.app.entities();
    const list = m.countries.filter((c) => !q || c.name.toLowerCase().includes(q)).sort((a, b) => (b.human - a.human) || (b.gdp - a.gdp));
    $('mpBox').innerHTML = `
      <div class="rules-head"><div><small class="eyebrow">Partie de ${esc(m.host)}${m.date ? ` · ${esc(m.date)}` : ''}</small><h2>Choisissez votre pays</h2>
        <p class="hint">Joueurs : ${m.players.map((p) => `${esc(p.name)} (${esc((m.countries.find((c) => c.k === p.side) || {}).name || '—')})`).join(', ')}. Les autres pays sont dirigés par l'IA ; vous prenez la direction de celui que vous choisissez.</p></div>
        <button class="btn ghost sm icon" id="mpX">${icon('x')}</button></div>
      ${m.error ? `<p class="bad">${esc(m.error)}</p>` : ''}
      <div class="search">${icon('search')}<input type="text" id="mpQ" placeholder="Rechercher un pays…" value="${esc(this.lobbyQuery || '')}" spellcheck="false"></div>
      <div class="mp-countries">${list.slice(0, 220).map((c) => `<button data-k="${c.k}" ${c.taken ? 'disabled' : ''} class="${c.human ? 'human' : ''}">${flagImg(ents[c.e], 'flag sm')}<span>${esc(c.name)}</span><small>${c.taken ? `pris par ${esc(c.taken)}` : c.human ? 'pays d\'un joueur absent' : `${Math.round(c.gdp).toLocaleString('fr-FR')} Md$`}</small></button>`).join('')}</div>`;
    $('mpX').onclick = () => { show('mpDialog', false); if (this.net) this.net.close(); this.net = null; };
    const qi = $('mpQ');
    qi.oninput = () => { this.lobbyQuery = qi.value; const pos = qi.selectionStart; this._lobby(this.lobbyData); const n = $('mpQ'); n.focus(); n.setSelectionRange(pos, pos); };
    $('mpBox').querySelectorAll('[data-k]').forEach((b) => b.onclick = () => { this.net.pick(Number(b.dataset.k)); $('mpBox').querySelector('.mp-countries').innerHTML = `<p class="hint">Chargement de la partie…</p>`; });
    show('mpDialog');
  }

  // ---------------- hôte ----------------
  host() {
    const app = this.app, sim = this.sim;
    if (!sim || !sim.nation) { notice('Lancez d\'abord une partie Nation Simulator.'); return; }
    if (this.net && this.net.isHost && this.net.active) { this.openPanel(); return; }
    if (this.net) this.net.close();
    this.net = new NetGame('host', this._adapter());
    app.act({ op: 'rename', k: sim.nation.player, name: this.name });
    app.session.net = this.net;
    if (hasTcp()) tcpListen(DEFAULT_PORT, (link) => this.net && this.net.isHost && this.net.addLink(link)).then((r) => { this.tcpInfo = r; this.render(); });
    this._openRelay();
    this.app.gameNav.render();
    this.openPanel();
    notice('Partie ouverte aux autres joueurs : donnez-leur le code de partie.', 4200);
  }
  // code de partie : écoute sur les relais publics (nouvelle tentative possible si aucun n'est joignable)
  _openRelay() {
    const net = this.net;
    this.relay = { state: 'opening' };
    this.render();
    relayHost((link) => { if (this.net === net && net.isHost) net.addLink(link); else link.close(); }, { version: GAME_VERSION, code: this.lastCode, relays: customRelays() })
      .then((h) => {
        if (this.net !== net) { h.close(); return; }
        this.relay = { state: 'open', h, code: h.code };
        this.lastCode = h.code;            // même code si la partie est rouverte
        this.render();
      })
      .catch((e) => { if (this.net === net) { this.relay = { state: 'error', text: e.message }; this.render(); } });
  }
  _closeRelay() { if (this.relay && this.relay.h) this.relay.h.close(); this.relay = null;
  }
  async _createInvite() {
    try {
      const inv = await rtcInvite();
      inv.state = 'en attente de la réponse';
      inv.link.onopen = () => { inv.state = 'connecté'; this.net.addLink(inv.link); this.invites = this.invites.filter((x) => x !== inv); this.render(); };
      this.invites.push(inv);
      this.render();
    } catch (e) { notice('Invitation impossible : ' + e.message, 4000); }
  }
  async _acceptInvite(i) {
    const inv = this.invites[i];
    const el = $(`mpRep${i}`);
    if (!inv || !el) return;
    try { await inv.accept(el.value); inv.state = 'connexion…'; this.render(); } catch (e) { notice(e.message, 4000); }
  }
  _copy(text) {
    const done = () => notice('Code copié.');
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(done, () => { this._copyFallback(text); done(); });
    else { this._copyFallback(text); done(); }
  }
  _copyFallback(text) { const ta = document.createElement('textarea'); ta.value = text; document.body.appendChild(ta); ta.select(); try { document.execCommand('copy'); } catch (_) { /* rien */ } ta.remove(); }

  // ---------------- panneau en partie ----------------
  openPanel() { this.unread = 0; this._railBadge(); show('mpPanel'); this.render(); }
  closePanel() { show('mpPanel', false); }
  _railBadge() { const b = document.querySelector('#navRail [data-nav=multi]'); if (b) b.classList.toggle('badge', this.unread > 0); }
  render() {
    if (!isShown('mpPanel')) return;
    const sim = this.sim, net = this.net;
    const ents = this.app.entities();
    const body = $('mpBody');
    if (!sim || !sim.nation) { body.innerHTML = '<p class="hint">Le multijoueur est disponible en Nation Simulator.</p>'; return; }
    if (!net || !net.active) {
      body.innerHTML = `<p>Partie solo. Ouvrez-la à vos amis : ils rejoindront avec un code d'invitation ou par adresse IP, et dirigeront chacun un pays.</p>
        <div class="field"><label><span>Votre nom de joueur</span></label><input type="text" id="mpName2" maxlength="24" value="${esc(this.name)}"></div>
        <button class="btn primary" id="mpHostBtn">${icon('users')}<span>Ouvrir la partie aux autres joueurs</span></button>
        <p class="hint">Pendant une partie partagée, la pause et la vitesse sont communes, et chaque action est appliquée chez tous les joueurs.</p>`;
      $('mpName2').oninput = () => { this.name = $('mpName2').value.trim().slice(0, 24) || 'Joueur'; saveName(this.name); };
      $('mpHostBtn').onclick = () => this.host();
      return;
    }
    const players = net.isHost ? net.players() : (net.playersList || []);
    const n = sim.nation;
    const absent = net.isHost ? n.humanList().filter((k) => k !== n.player && !players.some((p) => p.side === k)) : [];
    const row = (p) => { const sd = sim.sides[p.side]; return `<li>${sd ? flagImg(ents[sd.e], 'flag sm') : ''}<div><b>${esc(p.name)}${p.host ? ' <span class="pill">hôte</span>' : ''}</b><small>${sd ? esc(sd.name) : '—'}${!p.host && p.lag > 40 ? ` · retard ${Math.round(p.lag / 20)} s` : ''}</small></div>${net.isHost && !p.host ? `<button class="btn ghost xs" data-kick="${p.id}" title="Retirer de la partie">${icon('x')}</button>` : ''}</li>`; };
    body.innerHTML = `
      <div class="mp-status"><span class="dot ${net.stalled ? 'warn' : 'ok'}"></span><b>${net.isHost ? 'Vous hébergez la partie' : 'Connecté à la partie'}</b>${net.stalled ? '<small>En attente d\'un joueur en retard…</small>' : ''}</div>
      <h4>Joueurs (${players.length})</h4>
      <ul class="mp-players">${players.map(row).join('')}</ul>
      ${absent.length ? `<h4>Pays de joueurs absents</h4><ul class="mp-players">${absent.map((k) => `<li>${flagImg(ents[sim.sides[k].e], 'flag sm')}<div><b>${esc(sim.sides[k].name)}</b><small>${esc((n.humans[k] && n.humans[k].pname) || 'joueur')} peut revenir et le reprendre</small></div><button class="btn ghost xs" data-ai="${k}">Confier à l'IA</button></li>`).join('')}</ul>` : ''}
      ${net.isHost ? `<h4>Code de partie</h4>
        ${this._relayHtml()}
        <details class="mp-other"><summary>Autres méthodes (invitation directe, adresse IP)</summary>
        <div class="mp-invites">${this.invites.map((inv, i) => `<div class="mp-inv"><small>Invitation ${i + 1} · ${esc(inv.state)}</small>
          <div class="mp-code"><textarea readonly rows="2">${esc(inv.code)}</textarea><button class="btn accent xs" data-copy="${i}">${icon('copy')}<span>Copier</span></button></div>
          <div class="mp-code"><textarea rows="2" id="mpRep${i}" placeholder="Collez ici le code de réponse (WSR-…)" spellcheck="false"></textarea><button class="btn primary xs" data-acc="${i}">${icon('plug')}<span>Connecter</span></button></div></div>`).join('')}</div>
        <button class="btn ghost sm" id="mpInv">${icon('plus')}<span>Créer une invitation</span></button>
        ${this.tcpInfo && this.tcpInfo.ok ? `<p class="hint">Par adresse IP (réseau local, Tailscale, ZeroTier…) : port ${this.tcpInfo.port}, adresses ${this.tcpInfo.addresses.map((a) => `<b>${esc(a.address)}</b>`).join(', ') || '—'}.</p>` : ''}
        </details>` : ''}
      <h4>Messagerie</h4>
      <div class="mp-chat" id="mpChat"></div>
      <div class="row"><input type="text" id="mpMsg" maxlength="400" placeholder="Écrire aux autres joueurs…"><button class="btn primary sm" id="mpSend">${icon('send')}</button></div>
      <div class="row"><span class="grow"></span><button class="btn ghost sm danger" id="mpQuit">${icon('power')}<span>${net.isHost ? 'Fermer la partie partagée' : 'Quitter la partie'}</span></button></div>`;
    this._renderChat();
    const msg = $('mpMsg');
    const send = () => { if (msg.value.trim()) { net.sendChat(msg.value); msg.value = ''; } };
    $('mpSend').onclick = send;
    msg.onkeydown = (e) => { e.stopPropagation(); if (e.key === 'Enter') send(); };
    $('mpQuit').onclick = () => this.leave();
    if ($('mpCopyCode')) $('mpCopyCode').onclick = () => this._copy(this.relay.code);
    if ($('mpRetryRelay')) $('mpRetryRelay').onclick = () => this._openRelay();
    if ($('mpInv')) $('mpInv').onclick = () => this._createInvite();
    body.querySelectorAll('[data-copy]').forEach((b) => b.onclick = () => this._copy(this.invites[Number(b.dataset.copy)].code));
    body.querySelectorAll('[data-acc]').forEach((b) => b.onclick = () => this._acceptInvite(Number(b.dataset.acc)));
    body.querySelectorAll('[data-kick]').forEach((b) => b.onclick = () => { if (window.confirm('Retirer ce joueur de la partie ?')) net.kick(Number(b.dataset.kick)); });
    body.querySelectorAll('[data-ai]').forEach((b) => b.onclick = () => { this.app.act({ op: 'leave', k: Number(b.dataset.ai) }); this.render(); });
  }
  _relayHtml() {
    const r = this.relay;
    if (!r || r.state === 'opening') return `<p class="hint">Connexion aux relais publics…</p>`;
    if (r.state === 'error') return `<p class="bad">${esc(r.text)}</p><button class="btn ghost sm" id="mpRetryRelay">${icon('refresh-cw')}<span>Réessayer</span></button>`;
    return `<div class="mp-gamecode"><b>${esc(r.code)}</b><button class="btn accent sm" id="mpCopyCode">${icon('copy')}<span>Copier</span></button></div>
      <p class="hint">Chaque joueur saisit ce code dans Multijoueur → Rejoindre. Connexion chiffrée de bout en bout · relais : ${esc(r.h.relays.join(', ') || '—')}.</p>`;
  }
  _renderChat() {
    const el = $('mpChat');
    if (!el || !this.net) return;
    const sim = this.sim, ents = this.app.entities();
    el.innerHTML = this.net.chat.slice(-80).map((m) => { const sd = sim && m.side >= 0 ? sim.sides[m.side] : null; return `<div class="mp-msg">${sd ? flagImg(ents[sd.e], 'flag xs') : ''}<b>${esc(m.from)}</b><span>${esc(m.text)}</span></div>`; }).join('') || '<p class="hint">Aucun message.</p>';
    el.scrollTop = el.scrollHeight;
  }
  update() { if (isShown('mpPanel') && this.net && performance.now() - (this._at || 0) > 2000 && !(document.activeElement && document.activeElement.closest && document.activeElement.closest('#mpPanel'))) { this._at = performance.now(); this.render(); } }

  leave() {
    if (!this.net) return;
    if (!window.confirm(this.net.isHost ? 'Fermer la partie partagée ? Les autres joueurs seront déconnectés ; vous continuez seul.' : 'Quitter la partie ? Vous pourrez la rejoindre de nouveau.')) return;
    const wasHost = this.net.isHost;
    this.net.close();
    if (wasHost) { tcpStop(); this._closeRelay(); this._fallbackSolo(); }
    else { this.net = null; this.app.session.net = null; this.app.goMenu(); }
    this.render();
  }
  // plus de réseau : la partie continue en solo sur cet ordinateur
  _fallbackSolo() {
    const sim = this.sim;
    if (this.net) this.net.active = false;
    this.net = null;
    this.invites = [];
    this._closeRelay();
    this.app.session.net = null;
    if (sim) { sim.cmdSink = (cmd) => this.app.act(cmd); }
    this.app.gameNav.render();
    this.render();
  }
}

// effets d'affichage des ordres exécutés (frontières dessinées, réglages…)
export function commandHooks(app) {
  return {
    onBorder: (e) => {
      const r = app.renderer, sim = app.session.sim;
      for (const [c, to] of e.transfers) r.setOwnerInstant(c, to);
      r.setBorderOverrides(activeOverrides(sim));
      app.cellCountsDirty = true;
      if (app.labels) app.labels.invalidate();
      if (app.refreshParams) app.refreshParams();
    },
    onTuning: () => { if (app.notice) app.notice('Réglages avancés de la partie modifiés.'); },
    onJoin: () => { if (app.netUI) app.netUI.render(); },
    onLeave: () => { if (app.netUI) app.netUI.render(); },
  };
}
