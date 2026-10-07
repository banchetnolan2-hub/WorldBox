// SIMULATION — générateur pseudo-aléatoire déterministe (seed)
// Deux parties avec la même seed et les mêmes paramètres donnent exactement le même déroulé.

export function hashSeed(input) {
  const str = String(input);
  let h = 2166136261 >>> 0;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h >>> 0;
}

export function randomSeedString() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let s = '';
  for (let i = 0; i < 6; i++) s += alphabet[Math.floor(Math.random() * alphabet.length)];
  return s;
}

export class RNG {
  constructor(seed) {
    this.state = (typeof seed === 'number' ? seed : hashSeed(seed)) >>> 0;
    if (this.state === 0) this.state = 0x9e3779b9;
    this._spare = null;
  }
  // mulberry32
  next() {
    let t = (this.state = (this.state + 0x6d2b79f5) >>> 0);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  range(a, b) { return a + (b - a) * this.next(); }
  int(n) { return Math.floor(this.next() * n); }
  pick(arr) { return arr[Math.floor(this.next() * arr.length)]; }
  chance(p) { return this.next() < p; }
  normal() {
    if (this._spare !== null) { const s = this._spare; this._spare = null; return s; }
    let u, v, s;
    do { u = this.next() * 2 - 1; v = this.next() * 2 - 1; s = u * u + v * v; } while (s >= 1 || s === 0);
    const m = Math.sqrt(-2 * Math.log(s) / s);
    this._spare = v * m;
    return u * m;
  }
  exp(mean) { return -Math.log(1 - this.next()) * mean; }
  weighted(items, weightOf) {
    let total = 0;
    for (const it of items) total += Math.max(0, weightOf(it));
    let r = this.next() * total;
    for (const it of items) { r -= Math.max(0, weightOf(it)); if (r <= 0) return it; }
    return items[items.length - 1];
  }
}
