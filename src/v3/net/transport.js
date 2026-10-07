// TRANSPORTS RÉSEAU du multijoueur. Une « liaison » (Link) envoie et reçoit des objets JSON, quelle que
// soit la connexion :
//  - WebRTC (pair à pair) avec un CODE D'INVITATION échangé par copier-coller : aucune box à configurer,
//    la connexion traverse les box comme un appel vidéo (STUN) ;
//  - TCP direct (application Windows) : réseau local, ou réseau virtuel Tailscale / ZeroTier / Radmin VPN ;
//  - mémoire (tests automatiques).
// Les gros messages (état complet de la partie) sont découpés en morceaux et réassemblés.

const CHUNK = 48000;
const ICE = [{ urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] }, { urls: 'stun:stun.cloudflare.com:3478' }];

export class Link {
  constructor(label = '') {
    this.label = label;
    this.onmessage = null;
    this.onclose = null;
    this.closed = false;
    this._parts = new Map();
    this._seq = 0;
    this.bytesIn = 0;
    this.bytesOut = 0;
  }
  // à implémenter : _raw(str), close()
  send(obj) {
    if (this.closed) return;
    const str = JSON.stringify(obj);
    this.bytesOut += str.length;
    if (str.length <= CHUNK) { this._raw(str); return; }
    const id = ++this._seq, n = Math.ceil(str.length / CHUNK);
    for (let i = 0; i < n; i++) this._raw(JSON.stringify({ __c: id, i, n, d: str.slice(i * CHUNK, (i + 1) * CHUNK) }));
  }
  _recv(str) {
    this.bytesIn += str.length;
    let msg;
    try { msg = JSON.parse(str); } catch (_) { return; }
    if (msg && msg.__c !== undefined) {
      const p = this._parts.get(msg.__c) || { n: msg.n, got: 0, d: new Array(msg.n) };
      if (p.d[msg.i] === undefined) { p.d[msg.i] = msg.d; p.got++; }
      this._parts.set(msg.__c, p);
      if (p.got < p.n) { if (this.onprogress) this.onprogress(p.got / p.n); return; }
      this._parts.delete(msg.__c);
      try { msg = JSON.parse(p.d.join('')); } catch (_) { return; }
    }
    if (this.onmessage) this.onmessage(msg);
  }
  _closed() { if (this.closed) return; this.closed = true; if (this.onclose) this.onclose(); }
}

// ---------------- mémoire (tests) ----------------
export function memoryPair() {
  const a = new Link('A'), b = new Link('B');
  const qa = [], qb = [];
  a._raw = (s) => qb.push(s); b._raw = (s) => qa.push(s);
  a.close = () => { a._closed(); b._closed(); }; b.close = a.close;
  // livraison explicite (déterministe) : pump() distribue les messages en attente
  const pump = () => { let n = 0; while (qa.length || qb.length) { while (qb.length) { b._recv(qb.shift()); n++; } while (qa.length) { a._recv(qa.shift()); n++; } } return n; };
  return { a, b, pump };
}

// ---------------- WebRTC : codes d'invitation ----------------
const b64u = (bytes) => { let s = ''; for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]); return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); };
const unb64u = (str) => { const s = atob(str.replace(/-/g, '+').replace(/_/g, '/')); const out = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i); return out; };
export async function deflate(str) {
  if (typeof CompressionStream === 'undefined') return new TextEncoder().encode(str);
  const cs = new Blob([str]).stream().pipeThrough(new CompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(cs).arrayBuffer());
}
export async function inflate(bytes) {
  if (typeof DecompressionStream === 'undefined') return new TextDecoder().decode(bytes);
  const ds = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return new Response(ds).text();
}
export async function encodeCode(kind, desc, extra = {}) { return `WS${kind === 'offer' ? 'I' : 'R'}-` + b64u(await deflate(JSON.stringify({ t: desc.type, s: desc.sdp, ...extra }))); }
export async function decodeCode(code) {
  const c = String(code || '').trim().replace(/\s+/g, '');
  const m = c.match(/^WS([IR])-(.+)$/);
  if (!m) throw new Error('Code invalide (il doit commencer par WSI- ou WSR-).');
  const o = JSON.parse(await inflate(unb64u(m[2])));
  return { kind: m[1] === 'I' ? 'offer' : 'answer', desc: { type: o.t, sdp: o.s }, extra: o };
}
function gathered(pc, ms = 5000) {
  return new Promise((resolve) => {
    if (pc.iceGatheringState === 'complete') { resolve(); return; }
    const t = setTimeout(resolve, ms);
    pc.addEventListener('icegatheringstatechange', () => { if (pc.iceGatheringState === 'complete') { clearTimeout(t); resolve(); } });
  });
}
class RtcLink extends Link {
  constructor(pc, label) { super(label); this.pc = pc; this.dc = null; this._q = []; }
  attach(dc) {
    this.dc = dc;
    dc.bufferedAmountLowThreshold = 256 * 1024;
    dc.onmessage = (e) => this._recv(typeof e.data === 'string' ? e.data : new TextDecoder().decode(e.data));
    dc.onclose = () => this._closed();
    dc.onopen = () => { this._flush(); if (this.onopen) this.onopen(); };
    dc.onbufferedamountlow = () => this._flush();
    this.pc.onconnectionstatechange = () => { if (['failed', 'closed'].includes(this.pc.connectionState)) this._closed(); };
  }
  _raw(s) { this._q.push(s); this._flush(); }
  _flush() {
    const dc = this.dc;
    if (!dc || dc.readyState !== 'open') return;
    while (this._q.length && dc.bufferedAmount < 1024 * 1024) dc.send(this._q.shift());
  }
  close() { try { if (this.dc) this.dc.close(); this.pc.close(); } catch (_) { /* déjà fermée */ } this._closed(); }
}
// hôte : crée une invitation ; accept(code de réponse) termine la connexion
export async function rtcInvite(label = 'invité') {
  const pc = new RTCPeerConnection({ iceServers: ICE });
  const link = new RtcLink(pc, label);
  link.attach(pc.createDataChannel('ws', { ordered: true }));
  await pc.setLocalDescription(await pc.createOffer());
  await gathered(pc);
  const code = await encodeCode('offer', pc.localDescription);
  return {
    code, link,
    accept: async (reply) => { const r = await decodeCode(reply); if (r.kind !== 'answer') throw new Error('Collez le code de RÉPONSE (WSR-…) de votre ami.'); await pc.setRemoteDescription(r.desc); return link; },
  };
}
// invité : répond à une invitation ; renvoie le code de réponse à donner à l'hôte
export async function rtcAnswer(inviteCode) {
  const r = await decodeCode(inviteCode);
  if (r.kind !== 'offer') throw new Error('Collez le code d\'INVITATION (WSI-…) de l\'hôte.');
  const pc = new RTCPeerConnection({ iceServers: ICE });
  const link = new RtcLink(pc, 'hôte');
  pc.ondatachannel = (e) => link.attach(e.channel);
  await pc.setRemoteDescription(r.desc);
  await pc.setLocalDescription(await pc.createAnswer());
  await gathered(pc);
  return { code: await encodeCode('answer', pc.localDescription), link };
}

// ---------------- TCP (application Windows) ----------------
class TcpLink extends Link {
  constructor(id, label) { super(label); this.id = id; }
  _raw(s) { window.desktop.net.send(this.id, s); }
  close() { window.desktop.net.close(this.id); this._closed(); }
}
const tcpLinks = new Map();
let tcpBound = false, tcpOnOpen = null;
function bindTcp() {
  if (tcpBound || !hasTcp()) return;
  tcpBound = true;
  window.desktop.net.onEvent((e) => {
    if (e.type === 'open') { const l = new TcpLink(e.id, e.remote || 'invité'); tcpLinks.set(e.id, l); if (tcpOnOpen) tcpOnOpen(l); }
    else if (e.type === 'data') { const l = tcpLinks.get(e.id); if (l) l._recv(e.data); }
    else if (e.type === 'close') { const l = tcpLinks.get(e.id); if (l) { tcpLinks.delete(e.id); l._closed(); } }
  });
}
export function hasTcp() { return typeof window !== 'undefined' && !!(window.desktop && window.desktop.net); }
export async function tcpListen(port, onLink) {
  bindTcp();
  tcpOnOpen = onLink;
  return window.desktop.net.listen(port);
}
export async function tcpStop() { tcpOnOpen = null; if (hasTcp()) await window.desktop.net.stop(); }
export async function tcpConnect(host, port) {
  bindTcp();
  const r = await window.desktop.net.connect(host, port);
  if (!r.ok) throw new Error(r.error || 'connexion impossible');
  const l = new TcpLink(r.id, host);
  tcpLinks.set(r.id, l);
  return l;
}
export const DEFAULT_PORT = 47615;
