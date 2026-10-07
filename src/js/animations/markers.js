// ANIMATIONS — marqueurs (petits drapeaux animés) représentant les actions de la simulation

function easeOutBack(t) {
  const c1 = 1.70158, c3 = c1 + 1;
  return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
}

// Dessine un drapeau flottant sur un mât. (sx, sy) = pied du mât en coordonnées écran.
export function drawFlagMarker(ctx, sx, sy, opts) {
  const { color, flag, now, scale = 1, seed = 0, engaged = false, bornAge = 1, hot = 0 } = opts;
  const appear = Math.max(0, Math.min(1, bornAge / 0.5));
  if (appear <= 0) return;
  const s = scale * easeOutBack(appear);
  const poleH = 20 * s;
  const fw = 17 * s, fh = 12 * s;

  // ombre au sol
  ctx.globalAlpha = 0.35 * appear;
  ctx.fillStyle = '#000';
  ctx.beginPath();
  ctx.ellipse(sx, sy + 1, 5 * s, 2 * s, 0, 0, Math.PI * 2);
  ctx.fill();

  // anneau d'engagement
  if (engaged) {
    const p = (now * 1.6 + seed) % 1;
    ctx.globalAlpha = (1 - p) * 0.7;
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.ellipse(sx, sy, (5 + p * 12) * s, (2.4 + p * 5.5) * s, 0, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;

  // mât
  const topX = sx, topY = sy - poleH;
  ctx.strokeStyle = 'rgba(15,20,30,0.95)';
  ctx.lineWidth = 2.2 * s;
  ctx.beginPath(); ctx.moveTo(sx, sy); ctx.lineTo(topX, topY); ctx.stroke();
  ctx.strokeStyle = 'rgba(255,255,255,0.85)';
  ctx.lineWidth = 1 * s;
  ctx.beginPath(); ctx.moveTo(sx, sy); ctx.lineTo(topX, topY); ctx.stroke();

  // drapeau ondulant : découpé en bandes verticales décalées par une sinusoïde
  const slices = 8;
  const amp = (engaged ? 2.2 : 1.3) * s;
  const speed = engaged ? 9 : 5;
  const src = flag && flag.ready ? flag.canvas : null;
  // contour coloré (couleur du pays)
  ctx.fillStyle = color;
  for (let k = 0; k < slices; k++) {
    const t = k / slices;
    const off = Math.sin(now * speed + seed + t * 5) * amp * t;
    ctx.fillRect(topX + t * fw - 1, topY - 1 + off, fw / slices + 1.2, fh + 2);
  }
  for (let k = 0; k < slices; k++) {
    const t = k / slices;
    const off = Math.sin(now * speed + seed + t * 5) * amp * t;
    const dx = topX + t * fw, dw = fw / slices + 0.6;
    if (src) ctx.drawImage(src, (k / slices) * 64, 0, 64 / slices, 48, dx, topY + off, dw, fh);
    else { ctx.fillStyle = color; ctx.fillRect(dx, topY + off, dw, fh); }
  }
  // éclat lors d'une réussite récente
  if (hot > 0) {
    ctx.globalAlpha = hot * 0.8;
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.arc(topX, topY, 3.2 * s, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
  }
  // pomme du mât
  ctx.fillStyle = '#f5f1e6';
  ctx.beginPath(); ctx.arc(topX, topY - 1, 1.6 * s, 0, Math.PI * 2); ctx.fill();
}

export function drawCapital(ctx, sx, sy, color, now, scale = 1, lost = false) {
  const r = 6 * scale;
  const pulse = (now * 0.8) % 1;
  ctx.globalAlpha = (1 - pulse) * 0.5;
  ctx.strokeStyle = lost ? '#ffffff' : color;
  ctx.lineWidth = 1.5;
  ctx.beginPath(); ctx.arc(sx, sy, r + pulse * 10 * scale, 0, Math.PI * 2); ctx.stroke();
  ctx.globalAlpha = 1;
  ctx.fillStyle = 'rgba(10,14,24,0.9)';
  ctx.beginPath(); ctx.arc(sx, sy, r, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = color; ctx.lineWidth = 2;
  ctx.stroke();
  // étoile
  ctx.fillStyle = '#fff';
  ctx.beginPath();
  for (let k = 0; k < 10; k++) {
    const a = -Math.PI / 2 + k * Math.PI / 5;
    const rr = k % 2 === 0 ? r * 0.62 : r * 0.27;
    const x = sx + Math.cos(a) * rr, y = sy + Math.sin(a) * rr;
    if (k === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  }
  ctx.closePath();
  ctx.fill();
}
