// MULTIJOUEUR PAR CODE DE PARTIE via des RELAIS PUBLICS (MQTT sur WebSocket, port HTTPS).
// L'hôte ouvre la partie et obtient un code court (ex. H7KQ2-M9XAPQ) ; chaque joueur saisit le même code.
//  - le salon et la clé de chiffrement sont dérivés du code (PBKDF2) : les relais ne voient que des
//    octets chiffrés (AES-GCM 256, chaque trame authentifiée avec son sujet et l'émetteur) ;
//  - plusieurs relais publics : l'hôte écoute sur tous, l'invité garde le premier qui répond et bascule
//    automatiquement sur un autre si sa connexion tombe (resynchronisation de la partie ensuite) ;
//  - versions différentes refusées avec un message clair ; délai de 15 s avec un message explicite.
// Le transport ne fait que transporter des messages : la simulation (lockstep) reste celle de NetGame.
import { Link, deflate, inflate } from './transport.js';

export const RELAY_PROTO = 'wsr1';
export const JOIN_TIMEOUT = 15000;
export const DEFAULT_RELAYS = [
  { name: 'EMQX', url: 'wss://broker.emqx.io:8084/mqtt' },
  { name: 'HiveMQ', url: 'wss://broker.hivemq.com:8884/mqtt' },
  { name: 'Mosquitto', url: 'wss://test.mosquitto.org:8081/mqtt' },
  { name: 'Shiftr', url: 'wss://public.cloud.shiftr.io', user: 'public', pass: 'public' },
];
const FRAME = 24000;             // octets utiles par trame (bien en dessous des limites des relais publics)
const PING_EVERY = 10000, SILENT_MAX = 40000;

// ---------------- code de partie ----------------
const ALPHA = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';   // sans 0/O, 1/I/L : lisible à voix haute
export function makeCode(rand = (n) => crypto.getRandomValues(new Uint8Array(n))) {
  let s = '';
  const r = rand(32);
  for (let i = 0, j = 0; s.length < 11 && j < r.length; j++) if (r[j] < 248) { s += ALPHA[r[j] % 31]; i++; }
  while (s.length < 11) s += ALPHA[rand(1)[0] % 31];
  return s.slice(0, 5) + '-' + s.slice(5);
}
/** Code saisi par un joueur -> forme canonique, ou null si invalide. */
export function normalizeCode(input) {
  const s = String(input || '').toUpperCase().replace(/[\s\-_.]/g, '').replace(/O/g, '0');
  if (s.length !== 11 || [...s].some((c) => !ALPHA.includes(c))) return null;
  return s.slice(0, 5) + '-' + s.slice(5);
}
const hex = (b) => [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
/** Salon (sujet public) et clé AES-GCM dérivés du code : sans le code, ni l'un ni l'autre. */
export async function deriveRoom(code) {
  const enc = new TextEncoder();
  const base = await crypto.subtle.importKey('raw', enc.encode(code), 'PBKDF2', false, ['deriveBits']);
  const bits = new Uint8Array(await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: enc.encode('worldsim-relay-v1'), iterations: 60000 }, base, 384));
  const key = await crypto.subtle.importKey('raw', bits.slice(0, 32), 'AES-GCM', false, ['encrypt', 'decrypt']);
  return { room: hex(bits.slice(32, 48)), key };
}
async function seal(key, aad, bytes) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: new TextEncoder().encode(aad) }, key, bytes));
  const out = new Uint8Array(12 + ct.length); out.set(iv); out.set(ct, 12);
  return out;
}
async function unseal(key, aad, bytes) {
  return new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: bytes.slice(0, 12), additionalData: new TextEncoder().encode(aad) }, key, bytes.slice(12)));
}

// ---------------- client MQTT 3.1.1 minimal (QoS 0) sur WebSocket ----------------
const te = new TextEncoder(), td = new TextDecoder();
const str16 = (s) => { const b = te.encode(s); const o = new Uint8Array(2 + b.length); o[0] = b.length >> 8; o[1] = b.length & 255; o.set(b, 2); return o; };
const cat = (...a) => { const n = a.reduce((x, y) => x + y.length, 0), o = new Uint8Array(n); let p = 0; for (const x of a) { o.set(x, p); p += x.length; } return o; };
function packet(type, body) {
  const len = []; let n = body.length;
  do { let d = n % 128; n = Math.floor(n / 128); if (n > 0) d |= 128; len.push(d); } while (n > 0);
  return cat(Uint8Array.of(type, ...len), body);
}
export class Mqtt {
  constructor(relay, WS = globalThis.WebSocket) { this.relay = relay; this.WS = WS; this.ws = null; this.buf = new Uint8Array(0); this.pid = 1; this.onmessage = null; this.onclose = null; this.open = false; }
  connect(clientId, ms = 8000) {
    return new Promise((resolve, reject) => {
      let done = false;
      const fail = (why) => { if (done) return; done = true; clearTimeout(t); try { this.ws.close(); } catch (_) { /* déjà fermé */ } reject(new Error(why)); };
      const t = setTimeout(() => fail('délai dépassé'), ms);
      try { this.ws = new this.WS(this.relay.url, ['mqtt']); } catch (e) { fail(e.message); return; }
      this.ws.binaryType = 'arraybuffer';
      this.ws.onerror = () => fail('connexion refusée');
      this.ws.onopen = () => {
        const r = this.relay, flags = 0x02 | (r.user ? 0x80 : 0) | (r.pass ? 0x40 : 0);
        this._send(packet(0x10, cat(str16('MQTT'), Uint8Array.of(4, flags, 0, 60), str16(clientId), r.user ? str16(r.user) : new Uint8Array(0), r.pass ? str16(r.pass) : new Uint8Array(0))));
      };
      this.ws.onclose = () => { if (!done) fail('connexion fermée'); else this._down(); };
      this.ws.onmessage = (ev) => {
        this.buf = cat(this.buf, new Uint8Array(ev.data));
        for (;;) {
          let mul = 1, len = 0, i = 1, d;
          do { if (i >= this.buf.length) return; d = this.buf[i++]; len += (d & 127) * mul; mul *= 128; } while (d & 128);
          if (this.buf.length < i + len) return;
          const type = this.buf[0] >> 4, body = this.buf.slice(i, i + len);
          this.buf = this.buf.slice(i + len);
          if (type === 2) {                                     // CONNACK
            if (body[1] !== 0) { fail(`refus du relais (${body[1]})`); return; }
            done = true; clearTimeout(t); this.open = true;
            this._ping = setInterval(() => this._send(Uint8Array.of(0xc0, 0)), 25000);
            resolve(this);
          } else if (type === 3) {                              // PUBLISH (QoS 0)
            const tl = (body[0] << 8) | body[1];
            const topic = td.decode(body.slice(2, 2 + tl));
            if (this.onmessage) this.onmessage(topic, body.slice(2 + tl));
          }
        }
      };
    });
  }
  _send(b) { if (this.ws && this.ws.readyState === 1) this.ws.send(b); }
  subscribe(topic) { const id = this.pid++ & 0xffff || 1; this._send(packet(0x82, cat(Uint8Array.of(id >> 8, id & 255), str16(topic), Uint8Array.of(0)))); }
  publish(topic, payload) { this._send(packet(0x30, cat(str16(topic), payload))); }
  _down() { if (!this.open) return; this.open = false; clearInterval(this._ping); if (this.onclose) this.onclose(); }
  close() { try { this._send(Uint8Array.of(0xe0, 0)); this.ws.close(); } catch (_) { /* déjà fermé */ } this._down(); }
}

// ---------------- trames chiffrées ----------------
// charge MQTT : pid de l'émetteur (16 octets ASCII) | iv | chiffré( idMsg u32 | n° u16 | total u16 | données )
// les données réassemblées sont du JSON compressé : { c: contrôle } ou { m: message du jeu }.
class Codec {
  constructor(key) { this.key = key; this.seq = 0; this.parts = new Map(); }
  async encode(topic, pid, obj) {
    const z = await deflate(JSON.stringify(obj));
    const id = (++this.seq) >>> 0, n = Math.max(1, Math.ceil(z.length / FRAME)), out = [];
    for (let i = 0; i < n; i++) {
      const head = new Uint8Array(8); const dv = new DataView(head.buffer);
      dv.setUint32(0, id); dv.setUint16(4, i); dv.setUint16(6, n);
      out.push(cat(te.encode(pid), await seal(this.key, topic + '|' + pid, cat(head, z.subarray(i * FRAME, (i + 1) * FRAME)))));
    }
    return out;
  }
  /** -> { pid, obj } quand un message est complet ; null sinon ; lève une erreur si la trame est illégitime */
  async decode(topic, bytes) {
    const pid = td.decode(bytes.slice(0, 16));
    const plain = await unseal(this.key, topic + '|' + pid, bytes.slice(16));
    const dv = new DataView(plain.buffer, plain.byteOffset);
    const id = dv.getUint32(0), i = dv.getUint16(4), n = dv.getUint16(6), data = plain.slice(8);
    let whole = data;
    if (n > 1) {
      const k = pid + ':' + id;
      const p = this.parts.get(k) || { n, got: 0, d: new Array(n) };
      if (!p.d[i]) { p.d[i] = data; p.got++; }
      this.parts.set(k, p);
      if (p.got < n) return { pid, obj: null, progress: p.got / n };
      this.parts.delete(k);
      whole = cat(...p.d);
    }
    return { pid, obj: JSON.parse(await inflate(whole)) };
  }
}
const randPid = () => hex(crypto.getRandomValues(new Uint8Array(8)));

/** Liaison vers un pair à travers le relais : envoi/réception ordonnés, chiffrés, compressés. */
class RelayLink extends Link {
  constructor(label, sendObj) { super(label); this._sendObj = sendObj; this._out = Promise.resolve(); this.lastSeen = Date.now(); }
  send(obj) {
    if (this.closed) return;
    this._out = this._out.then(() => this._sendObj({ m: obj })).catch(() => { /* relais tombé : bascule gérée ailleurs */ });
  }
  _deliver(m) { this.lastSeen = Date.now(); if (this.onmessage && !this.closed) this.onmessage(m); }
}

async function connectRelays(relays, clientId, WS) {
  const res = await Promise.all(relays.map((r) => new Mqtt(r, WS).connect(clientId + '-' + r.name).catch(() => null)));
  return res.filter(Boolean);
}

// ======================= HÔTE =======================
/**
 * Ouvre une partie sur les relais. onLink(link, info) est appelé pour chaque joueur qui rejoint.
 * opts : { code?, version, relays?, WebSocket? } -> { code, relays: [noms], close() }
 */
export async function relayHost(onLink, opts = {}) {
  const code = opts.code || makeCode();
  const relays = opts.relays || DEFAULT_RELAYS;
  const pingEvery = opts.pingEvery || PING_EVERY, silentMax = opts.silentMax || SILENT_MAX;
  const { room, key } = await deriveRoom(code);
  const me = randPid(), codec = new Codec(key), hostTopic = `${RELAY_PROTO}/${room}/h`;
  const peers = new Map();       // pid -> { link, via, chain }
  let clients = [], closed = false;
  const sendTo = async (pid, via, obj) => {
    const topic = `${RELAY_PROTO}/${room}/g/${pid}`;
    for (const f of await codec.encode(topic, me, obj)) via.publish(topic, f);
  };
  const attach = (c) => {
    c.subscribe(hostTopic);
    c.onmessage = (topic, bytes) => {
      if (topic !== hostTopic || bytes.length < 40) return;
      const pid = td.decode(bytes.slice(0, 16));
      const p = peers.get(pid) || { link: null, via: c, chain: Promise.resolve(), born: Date.now() };
      if (!peers.has(pid)) peers.set(pid, p);
      p.chain = p.chain.then(async () => {
        let r;
        try { r = await codec.decode(topic, bytes); } catch (_) { return; }       // trame d'un tiers ou altérée : ignorée
        if (!r.obj) return;
        const { c: ctl, m } = r.obj;
        if (ctl) {
          if (ctl.t === 'open') {
            if (ctl.v !== opts.version) { await sendTo(pid, c, { c: { t: 'refuse', text: `Versions différentes : la partie utilise WorldSimulator ${opts.version}, vous avez ${ctl.v}. Installez la même version que l'hôte.` } }); return; }
            await sendTo(pid, c, { c: { t: 'welcome', v: opts.version } });
          } else if (ctl.t === 'sel') {
            p.via = c;
            if (!p.link) {
              p.link = new RelayLink(String(ctl.name || 'invité').slice(0, 24), (o) => sendTo(pid, p.via, o));
              p.link.close = () => { if (!p.link.closed) sendTo(pid, p.via, { c: { t: 'bye' } }).catch(() => {}); peers.delete(pid); p.link._closed(); };
              onLink(p.link, { relay: c.relay.name });
            } else if (ctl.resume) p.link.lastSeen = Date.now();
          } else if (ctl.t === 'ping') { if (p.link) p.link.lastSeen = Date.now(); if (ctl.via) p.via = c; }
          else if (ctl.t === 'bye' && p.link) { peers.delete(pid); p.link._closed(); }
          return;
        }
        if (m !== undefined && p.link) { p.via = c; p.link.bytesIn += bytes.length; p.link._deliver(m); }
      });
    };
    c.onclose = () => { clients = clients.filter((x) => x !== c); };
  };
  clients = await connectRelays(relays, 'wsh-' + me, opts.WebSocket);
  if (!clients.length) throw new Error('Aucun relais public joignable : vérifiez la connexion Internet (ou utilisez « Autres méthodes »).');
  clients.forEach(attach);
  // relais perdus : nouvelle tentative régulière ; joueurs silencieux : déconnectés
  const timer = setInterval(async () => {
    if (closed) return;
    for (const [pid, p] of peers) {
      if (!p.link) { if (Date.now() - p.born > 60000) peers.delete(pid); continue; }
      if (Date.now() - p.link.lastSeen > silentMax) { peers.delete(pid); p.link._closed(); continue; }
      sendTo(pid, p.via, { c: { t: 'ping' } }).catch(() => {});
    }
    const missing = relays.filter((r) => !clients.some((c) => c.relay === r));
    if (missing.length) { const more = await connectRelays(missing, 'wsh-' + me, opts.WebSocket); if (closed) more.forEach((c) => c.close()); else { more.forEach(attach); clients.push(...more); } }
  }, pingEvery);
  return {
    code,
    get relays() { return clients.map((c) => c.relay.name); },
    close() { closed = true; clearInterval(timer); for (const p of peers.values()) if (p.link) p.link.close(); for (const c of clients) c.close(); clients = []; },
  };
}

// ======================= INVITÉ =======================
/**
 * Rejoint la partie du code donné. Résout une liaison prête pour NetGame.connect(link).
 * opts : { version, name, relays?, WebSocket?, timeout? }
 */
export async function relayJoin(codeInput, opts = {}) {
  const code = normalizeCode(codeInput);
  if (!code) throw new Error('Code de partie invalide : il a la forme H7KQ2-M9XAPQ (11 caractères).');
  const relays = opts.relays || DEFAULT_RELAYS, timeout = opts.timeout || JOIN_TIMEOUT;
  const pingEvery = opts.pingEvery || PING_EVERY, silentMax = opts.silentMax || SILENT_MAX;
  const { room, key } = await deriveRoom(code);
  const me = randPid(), codec = new Codec(key);
  const myTopic = `${RELAY_PROTO}/${room}/g/${me}`, hostTopic = `${RELAY_PROTO}/${room}/h`;
  const send = async (c, obj) => { for (const f of await codec.encode(hostTopic, me, obj)) c.publish(hostTopic, f); };
  let chain = Promise.resolve(), link = null, cur = null, closed = false;
  const listen = (c, onCtl) => {
    c.subscribe(myTopic);
    c.onmessage = (topic, bytes) => {
      if (topic !== myTopic) return;
      if (link) link.bytesIn += bytes.length;
      chain = chain.then(async () => {
        let r;
        try { r = await codec.decode(topic, bytes); } catch (_) { return; }
        if (link && c === cur) link.lastSeen = Date.now();       // toute trame de l'hôte (ping compris) prouve qu'il est là
        if (r.obj === null) { if (link && link.onprogress) link.onprogress(r.progress); return; }
        if (r.obj.c) { onCtl(c, r.obj.c); return; }
        if (link && c === cur && r.obj.m !== undefined) link._deliver(r.obj.m);
      });
    };
  };
  const t0 = Date.now();
  // 1) connexion à tous les relais en parallèle, « open » sur chacun ; le premier « welcome » l'emporte
  const clients = await connectRelays(relays, 'wsg-' + me, opts.WebSocket);
  if (!clients.length) throw new Error('Aucun relais public joignable : vérifiez la connexion Internet ou le pare-feu (ou utilisez « Autres méthodes »).');
  const chosen = await new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`Aucune partie trouvée pour le code ${code} après ${Math.round(timeout / 1000)} s : vérifiez le code et que l'hôte a bien ouvert la partie.`)), Math.max(1000, timeout - (Date.now() - t0)));
    for (const c of clients) {
      listen(c, (cc, ctl) => {
        if (ctl.t === 'welcome') { clearTimeout(t); resolve(cc); }
        else if (ctl.t === 'refuse') { clearTimeout(t); reject(new Error(ctl.text)); }
        else if (ctl.t === 'bye' && link) link._closed();
      });
      send(c, { c: { t: 'open', v: opts.version } }).catch(() => {});
    }
  }).catch((e) => { clients.forEach((c) => c.close()); throw e; });
  for (const c of clients) if (c !== chosen) c.close();
  cur = chosen;
  link = new RelayLink('hôte', (o) => send(cur, o));
  link.relay = chosen.relay.name;
  await send(cur, { c: { t: 'sel', name: opts.name || 'invité' } });
  // 2) bascule automatique si le relais tombe ; surveillance de l'hôte
  const failover = async () => {
    if (closed || link.closed) return;
    const order = [...relays.filter((r) => r !== cur.relay), cur.relay];
    for (const r of order) {
      const c = await new Mqtt(r, opts.WebSocket).connect('wsg-' + me + '-' + r.name + '-' + Date.now() % 1000).catch(() => null);
      if (!c) continue;
      listen(c, (cc, ctl) => { if (ctl.t === 'bye') link._closed(); });
      c.onclose = failover;
      cur = c; link.relay = r.name;
      await send(c, { c: { t: 'sel', name: opts.name || 'invité', resume: true } });
      if (link.onresume) link.onresume(r.name);
      return;
    }
    link._closed();
  };
  cur.onclose = failover;
  const timer = setInterval(() => {
    if (link.closed) { clearInterval(timer); return; }
    if (Date.now() - link.lastSeen > silentMax) { link._closed(); return; }
    send(cur, { c: { t: 'ping', via: true } }).catch(() => {});
  }, pingEvery);
  link.close = () => { if (closed) return; closed = true; clearInterval(timer); send(cur, { c: { t: 'bye' } }).catch(() => {}).finally(() => setTimeout(() => cur.close(), 200)); link._closed(); };
  const prev = link._closed.bind(link);
  link._closed = () => { clearInterval(timer); if (!closed) { closed = true; try { cur.close(); } catch (_) { /* déjà fermé */ } } prev(); };
  return link;
}
