// SIMULATION — générateur pseudo-aléatoire déterministe et sérialisable
export { hashSeed, randomSeedString } from '../../js/simulation/rng.js';
import { hashSeed } from '../../js/simulation/rng.js';

export class RNG {
  constructor(seed) {
    this.state = (typeof seed === 'number' ? seed : hashSeed(seed)) >>> 0;
    if (this.state === 0) this.state = 0x9e3779b9;
  }
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
    // Box-Muller sans valeur mémorisée (état entièrement contenu dans this.state)
    const u = Math.max(1e-12, this.next()), v = this.next();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
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
