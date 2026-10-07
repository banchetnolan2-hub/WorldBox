// UI — écran de fin de simulation (classement final + courbe d'évolution)
import { $, esc, colorDot, fmtTime, pct, show } from './util.js';
import { fmtDuration } from '../sim/calendar.js';

export function renderResults(app, sim) {
  const r = sim.result;
  const ents = app.entities();
  const colors = app.renderer.colors;
  const winTeam = r.winnerTeam;
  const teamSolo = sim.teams.length === sim.sides.length;
  let line;
  if (winTeam >= 0) {
    const members = sim.sides.filter((s) => s.team === winTeam);
    const who = members.length === 1 ? ents[members[0].e].name : sim.teams[winTeam].name;
    line = `${members.length === 1 ? colorDot(ents[members[0].e]) : ''}<span>Victoire : ${esc(who)}</span>${r.reason === 'temps' ? ' · meilleure progression' : ''}`;
  } else line = r.reason === 'manuel' ? 'Simulation arrêtée manuellement' : 'Aucun vainqueur net';
  $('winnerLine').innerHTML = line;

  const rows = [...r.sides].sort((a, b) => b.share - a.share);
  let html = `<div class="rt-row rt-head"><span></span><span></span><span>PAYS</span><b>TERRITOIRE</b><b>PROGRESSION</b><b>${teamSolo ? 'UNITÉS' : 'ÉQUIPE'}</b></div>`;
  rows.forEach((s, k) => {
    const win = winTeam >= 0 && s.team === winTeam;
    html += `<div class="rt-row ${win ? 'win' : ''}"><span class="r">${k + 1}</span>${colorDot(ents[s.e])}<span>${esc(s.name)}${s.eliminated ? ' <small class="hint">(éliminé)</small>' : ''}</span>
      <b>${pct(s.share)}</b><b class="${s.ratio >= 1 ? 'up' : 'down'}">${s.ratio >= 1 ? '+' : ''}${Math.round((s.ratio - 1) * 100)} %</b>
      <b>${teamSolo ? s.units.toLocaleString('fr-FR') : esc(sim.teams[s.team].name)}</b></div>`;
  });
  $('resultTable').innerHTML = html;
  $('resultMeta').textContent = `${r.reason === 'temps' ? 'Durée maximale atteinte' : r.reason === 'manuel' ? 'Fin manuelle' : r.reason === 'paix' ? 'Paix : plus aucune guerre en cours' : 'Condition de victoire atteinte'} · ${fmtTime(r.time)} simulées · ${r.events} événements · seed ${sim.cfg.seed}`;
  drawHistory($('historyChart'), sim, colors);
  // guerres de la simulation : rapports complets
  const wars = sim.wars.filter((w) => w.report);
  $('resultWars').innerHTML = wars.length ? `<h4>Guerres (${wars.length})</h4><ul class="wr-list">${wars.slice(-8).reverse().map((w) => `<li data-war="${w.id}"><div><b>${esc(w.name)}</b><small>${esc(w.report.result)} · ${fmtDuration(w.end - w.start)}</small></div><span class="pill done">Rapport</span></li>`).join('')}</ul>` : '';
  $('resultWars').querySelectorAll('[data-war]').forEach((li) => li.addEventListener('click', () => { show('results', false); app.warUI.openReport(app.warUI.liveWar(Number(li.dataset.war))); app.warUI.onClose = () => show('results'); }));
}

function drawHistory(canvas, sim, colors) {
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const W = canvas.clientWidth || 640, H = canvas.clientHeight || 150;
  canvas.width = W * dpr; canvas.height = H * dpr;
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, W, H);
  const hist = sim.history;
  if (hist.length < 2) return;
  const pad = { l: 36, r: 10, t: 10, b: 20 };
  const tMax = hist[hist.length - 1][0] || 1;
  const X = (t) => pad.l + (t / tMax) * (W - pad.l - pad.r);
  // parts de territoire cumulées (aires empilées) pour les 8 plus grands, le reste regroupé
  const n = sim.sides.length;
  const final = sim.sides.map((s, k) => [k, s.cells]).sort((a, b) => b[1] - a[1]);
  const top = final.slice(0, 8).map((x) => x[0]);
  const series = hist.map((row) => {
    const tot = row.slice(1).reduce((a, b) => a + b, 0) || 1;
    const vals = top.map((k) => row[1 + k] / tot);
    const rest = 1 - vals.reduce((a, b) => a + b, 0);
    return { t: row[0], vals, rest };
  });
  const Y = (v) => pad.t + (1 - v) * (H - pad.t - pad.b);
  let base = series.map(() => 0);
  const layers = top.map((k, li) => ({ color: colors[sim.sides[k].e] || '#888', get: (s) => s.vals[li] }));
  if (n > 8) layers.push({ color: '#475569', get: (s) => s.rest });
  for (const L of layers) {
    ctx.beginPath();
    series.forEach((s, i) => { const y = Y(base[i] + L.get(s)); if (i) ctx.lineTo(X(s.t), y); else ctx.moveTo(X(s.t), y); });
    for (let i = series.length - 1; i >= 0; i--) ctx.lineTo(X(series[i].t), Y(base[i]));
    ctx.closePath();
    ctx.fillStyle = L.color;
    ctx.globalAlpha = 0.85;
    ctx.fill();
    ctx.globalAlpha = 1;
    base = base.map((b, i) => b + L.get(series[i]));
  }
  ctx.fillStyle = 'rgba(255,255,255,0.6)';
  ctx.font = '11px Inter, "Segoe UI", sans-serif';
  ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
  for (const v of [0, 0.5, 1]) ctx.fillText(Math.round(v * 100) + '%', pad.l - 5, Y(v));
  ctx.textAlign = 'center'; ctx.textBaseline = 'top';
  ctx.fillText('0:00', X(0) + 12, H - pad.b + 5);
  ctx.fillText(fmtTime(tMax), X(tMax) - 18, H - pad.b + 5);
  ctx.fillText('Évolution des parts de territoire', W / 2, H - pad.b + 5);
}
