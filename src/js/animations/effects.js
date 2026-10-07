// ANIMATIONS — effets visuels légers (ondes de capture, étincelles)
// Pool limité pour ne jamais surcharger la carte ni le processeur.

const MAX_RIPPLES = 70;

export class Effects {
  constructor() {
    this.ripples = [];
    this.budget = 0;
  }

  clear() { this.ripples.length = 0; }

  // appelé par frame : limite le nombre de nouvelles ondes selon l'activité
  beginFrame(dt) { this.budget = Math.min(8, this.budget + dt * 40); }

  capture(x, y, color, now, strong = false) {
    if (!strong) {
      if (this.budget < 1) return;
      this.budget -= 1;
    }
    if (this.ripples.length >= MAX_RIPPLES) this.ripples.shift();
    this.ripples.push({ x, y, color, t0: now, dur: strong ? 1.4 : 0.8, strong });
  }

  draw(ctx, camera, now, cellSize) {
    const alive = [];
    ctx.save();
    for (const r of this.ripples) {
      const age = (now - r.t0) / r.dur;
      if (age >= 1 || age < 0) { if (age < 0) alive.push(r); continue; }
      alive.push(r);
      const [sx, sy] = camera.worldToScreen(r.x, r.y);
      if (sx < -50 || sy < -50 || sx > camera.viewW + 50 || sy > camera.viewH + 50) continue;
      const base = Math.max(6, cellSize * camera.zoom);
      const rad = base * (0.4 + age * (r.strong ? 4 : 1.8));
      ctx.globalAlpha = (1 - age) * (r.strong ? 0.9 : 0.55);
      ctx.strokeStyle = r.color;
      ctx.lineWidth = r.strong ? 3 : 1.5;
      ctx.beginPath();
      ctx.arc(sx, sy, rad, 0, Math.PI * 2);
      ctx.stroke();
      if (r.strong) {
        ctx.globalAlpha = (1 - age) * 0.25;
        ctx.fillStyle = r.color;
        ctx.fill();
      }
    }
    ctx.restore();
    this.ripples = alive;
  }
}
