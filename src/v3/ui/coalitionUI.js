// UI — COALITIONS : vue d'ensemble (toutes les coalitions du monde, membres, intérêts, cohésion, rapport de
// force, historique) et, en Nation Simulator, actions du joueur (fonder, inviter, objectif, offensive coordonnée,
// quitter). Utilisé par le panneau « Monde » (onglet Coalitions) et la fiche diplomatique.
import { esc, flagImg, notice } from './util.js';
import { icon } from './icons.js';
import { fmtDate } from '../sim/calendar.js';
import { powerOf } from '../sim/ai.js';
import { coalitions, memberOf, coalitionPower, threatOf, evaluateJoin, INTERESTS, GOALS, KIND_LABELS } from '../sim/coalitions.js';

const pct = (v) => `${Math.round(v * 100)} %`;
const num = (v) => Math.round(v).toLocaleString('fr-FR');

export class CoalitionUI {
  constructor(app) { this.app = app; this.open = new Set(); this.form = null; }
  get sim() { return this.app.session.sim; }
  ent(e) { return this.app.entities()[e]; }
  chip(k) { const sim = this.sim, sd = sim.sides[k]; return `<span class="chip" data-e="${sd.e}">${flagImg(this.ent(sd.e), 'flag xs')}${esc(sd.name)}</span>`; }

  // ---------------- contenu de l'onglet ----------------
  html() {
    const sim = this.sim;
    if (!sim) return '';
    if (sim.rules.alliances === false || sim.rules.coalitions === false) return '<p class="cp-alert">Les coalitions sont désactivées dans les règles de cette partie.</p>';
    const all = coalitions(sim);
    const act = all.filter((c) => c.status === 'active'), done = all.filter((c) => c.status !== 'active').slice(-8).reverse();
    const n = sim.nv, p = n ? n.player : -1;
    const mine = p >= 0 ? act.filter((c) => memberOf(c, p)) : [];
    const others = act.filter((c) => !mine.includes(c));
    return `${n ? this._formHtml() : ''}
      ${mine.length ? `<h4>Vos coalitions</h4>${mine.map((c) => this._card(c, true)).join('')}` : ''}
      <h4>Coalitions actives dans le monde</h4>${others.length ? others.map((c) => this._card(c, false)).join('') : '<p class="hint">Aucune coalition active. Elles se forment face aux agresseurs et aux puissances menaçantes.</p>'}
      ${done.length ? `<h4>Coalitions dissoutes</h4>${done.map((c) => `<div class="co-past ${c.status}">${icon(c.status === 'victorious' ? 'award' : 'x-circle')}<span>${esc(c.name)}</span><small>${esc(c.endReason || '')} · ${fmtDate(c.ended, sim.cfg.startDay, true)}</small></div>`).join('')}` : ''}`;
  }

  _card(c, mine) {
    const sim = this.sim, n = sim.nv, p = n ? n.player : -1, S = sim.S;
    const T = sim.sides[c.target];
    const pw = coalitionPower(sim, c), tp = powerOf(T);
    const ratio = pw / Math.max(1e-6, pw + tp);
    const w = c.war ? sim.wars.find((x) => x.id === c.war) : null;
    const opened = this.open.has(c.id) || mine;
    const lead = c.leader === p;
    const members = c.members.slice().sort((a, b) => (b.k === c.leader) - (a.k === c.leader) || b.commitment - a.commitment);
    const row = (m) => {
      const sd = sim.sides[m.k];
      const inWar = sim.atWar[m.k * S + c.target] > 0;
      return `<tr data-e="${sd.e}" class="${sd.player ? 'me' : ''}"><td class="cn">${flagImg(this.ent(sd.e), 'flag sm')}<span>${esc(sd.name)}</span>${m.k === c.leader ? `<i class="co-lead" title="Chef de la coalition">${icon('crown')}</i>` : ''}</td>
        <td title="${esc(INTERESTS[m.interest] ? INTERESTS[m.interest].desc : '')}">${esc(INTERESTS[m.interest] ? INTERESTS[m.interest].label : m.interest)}</td>
        <td><div class="co-bar"><i style="width:${(m.commitment * 100).toFixed(0)}%"></i></div></td>
        <td>${inWar ? `<span class="pill no">en guerre</span>` : '<span class="pill">engagé</span>'}</td>
        <td>${m.aid > 0.05 ? `${m.aid.toFixed(1).replace('.', ',')} Md$` : '–'}</td></tr>`;
    };
    const candidates = lead || (mine && n) ? this._candidates(c) : [];
    return `<div class="co-card ${mine ? 'mine' : ''}" data-coal="${c.id}">
      <div class="co-head" data-toggle="${c.id}">${icon('shield')}<div class="grow"><b>${esc(c.name)}</b><small>${esc(KIND_LABELS[c.kind])} · ${esc(GOALS[c.goal].label)} · depuis ${fmtDate(c.formed, sim.cfg.startDay, true)}</small></div>
        ${w && w.status === 'active' ? `<span class="pill no" data-war="${w.id}">${icon('swords')}${esc(w.name)}</span>` : ''}<span class="pill">${c.members.length} membre${c.members.length > 1 ? 's' : ''}</span></div>
      <div class="co-sum"><span>Chef</span>${this.chip(c.leader)}<span>Cible</span>${this.chip(c.target)}${c.victim >= 0 && sim.sides[c.victim] ? `<span>Protège</span>${this.chip(c.victim)}` : ''}</div>
      <div class="co-meters"><div><small>Cohésion</small><div class="co-bar big"><i style="width:${pct(c.cohesion)};background:${c.cohesion > 0.55 ? 'var(--good)' : c.cohesion > 0.3 ? 'var(--gold)' : 'var(--bad)'}"></i></div><b>${pct(c.cohesion)}</b></div>
        <div><small>Rapport de force</small><div class="co-bar big vs"><i style="width:${pct(ratio)}"></i></div><b>${num(pw)} / ${num(tp)}</b></div></div>
      ${c.op && sim.time < c.op.until ? `<p class="co-op">${icon('swords')}${esc(c.op.text)} — jusqu'au ${fmtDate(c.op.until, sim.cfg.startDay, true)}</p>` : ''}
      ${opened ? `<table class="wp-table co-table"><thead><tr><th>Membre</th><th>Intérêt</th><th>Engagement</th><th>Statut</th><th>Aide</th></tr></thead><tbody>${members.map(row).join('')}</tbody></table>
        ${mine && n ? `<div class="co-actions">
          ${candidates.length ? `<select id="coInvite${c.id}">${candidates.map((x) => `<option value="${x.k}">${esc(sim.sides[x.k].name)} — ${x.ev.score > 0 ? 'intéressé' : 'réticent'} (${x.ev.score > 0 ? '+' : ''}${x.ev.score.toFixed(2).replace('.', ',')})</option>`).join('')}</select><button class="btn ghost sm" data-invite="${c.id}">${icon('users')}<span>Inviter</span></button>` : '<span class="hint">Aucun pays à inviter pour le moment.</span>'}
          ${lead ? `<button class="btn ghost sm" data-op="${c.id}">${icon('swords')}<span>Offensive coordonnée</span></button>
            <select data-goal="${c.id}">${Object.entries(GOALS).filter(([g]) => g !== 'liberate' || c.victim >= 0).map(([g, x]) => `<option value="${g}" ${g === c.goal ? 'selected' : ''}>${esc(x.label)}</option>`).join('')}</select>` : ''}
          <span class="grow"></span><button class="btn danger ghost sm" data-leave="${c.id}">${icon('log-out')}<span>Quitter</span></button></div>
          <div class="co-reply" id="coReply${c.id}"></div>` : ''}
        <details class="co-hist"><summary>Historique (${c.history.length})</summary><ul>${c.history.slice().reverse().map((h) => `<li class="k-${h.kind}"><time>${fmtDate(h.t, sim.cfg.startDay, true)}</time><span>${esc(h.text)}</span></li>`).join('')}</ul></details>` : ''}
    </div>`;
  }

  _candidates(c) {
    const sim = this.sim, S = sim.S;
    const out = [];
    for (let k = 0; k < S; k++) {
      if (sim.sides[k].eliminated || memberOf(c, k) || k === c.target || sim.allied[k * S + c.target]) continue;
      const near = sim.contact[k * S + c.target] > 0 || sim.nearCap[k * S + c.target] || c.members.some((m) => sim.allied[k * S + m.k] || sim.contact[k * S + m.k] > 0);
      if (!near) continue;
      out.push({ k, ev: evaluateJoin(sim, c, k) });
    }
    return out.sort((a, b) => b.ev.score - a.ev.score).slice(0, 30);
  }

  // formulaire : fonder une coalition (Nation Simulator)
  _formHtml() {
    const sim = this.sim, n = sim.nv, p = n.player, S = sim.S;
    const targets = [];
    for (let k = 0; k < S; k++) {
      if (k === p || sim.sides[k].eliminated || sim.allied[p * S + k]) continue;
      if (coalitions(sim).some((c) => c.status === 'active' && c.target === k && memberOf(c, p))) continue;   // déjà dans une coalition contre ce pays
      if (!(sim.contact[p * S + k] > 0 || sim.nearCap[p * S + k] || sim.atWar[p * S + k] || sim.rel[p * S + k] < -30)) continue;
      targets.push({ k, th: threatOf(sim, k, p) });
    }
    targets.sort((a, b) => b.th.score - a.th.score);
    if (!targets.length) return '<p class="hint">Aucun pays voisin ou hostile contre lequel former une coalition.</p>';
    const t0 = this.form && targets.some((x) => x.k === this.form.target) ? this.form.target : targets[0].k;
    const th = targets.find((x) => x.k === t0).th;
    const agg = sim.wars.some((w) => w.status === 'active' && w.a[0] === t0);
    return `<div class="co-form"><h4>Fonder une coalition</h4>
      <div class="row"><label>Contre</label><select id="coTarget">${targets.slice(0, 40).map((x) => `<option value="${x.k}" ${x.k === t0 ? 'selected' : ''}>${esc(sim.sides[x.k].name)} — menace ${x.th.score.toFixed(2).replace('.', ',')}</option>`).join('')}</select>
      <label>Objectif</label><select id="coGoal"><option value="contain">${GOALS.contain.label}</option>${agg ? `<option value="liberate">${GOALS.liberate.label}</option>` : ''}<option value="defeat">${GOALS.defeat.label}</option></select>
      <button class="btn primary sm" id="coCreate">${icon('shield')}<span>Fonder</span></button></div>
      <ul class="factors">${th.factors.slice(0, 6).map((f) => `<li><span>${esc(f.label)}</span><b class="${f.v > 0 ? 'down' : 'up'}">${f.v > 0 ? '+' : ''}${String(f.v).replace('.', ',')}</b></li>`).join('')}</ul>
      <p class="hint">Une coalition d'endiguement engage ses membres à se défendre mutuellement ; une coalition offensive vise à vaincre la cible. Les autres pays décident d'y entrer selon leurs propres intérêts.</p></div>`;
  }

  // ---------------- interactions ----------------
  bind(body, rerender) {
    const sim = this.sim, n = sim && sim.nv;
    body.querySelectorAll('[data-toggle]').forEach((el) => el.addEventListener('click', (e) => { if (e.target.closest('[data-war],[data-e]')) return; const id = Number(el.dataset.toggle); if (this.open.has(id)) this.open.delete(id); else this.open.add(id); rerender(); }));
    if (!n) return;
    const tg = body.querySelector('#coTarget');
    if (tg) tg.addEventListener('change', () => { this.form = { target: Number(tg.value) }; rerender(); });
    const cr = body.querySelector('#coCreate');
    if (cr) cr.addEventListener('click', () => {
      const r = n.formCoalition(Number(body.querySelector('#coTarget').value), body.querySelector('#coGoal').value);
      if (!r.ok) { notice(r.text); return; }
      this.open.add(r.coalition.id);
      notice(`« ${r.coalition.name} » est fondée. Invitez maintenant d'autres pays.`);
      rerender();
    });
    body.querySelectorAll('[data-invite]').forEach((b) => b.addEventListener('click', () => {
      const id = Number(b.dataset.invite);
      const sel = body.querySelector(`#coInvite${id}`);
      const r = n.inviteToCoalition(id, Number(sel.value));
      rerender();
      const box = this.app.gameNav && document.getElementById(`coReply${id}`);
      if (box) box.innerHTML = `<p><span class="pill ${r.result === 'accept' ? 'ok' : 'no'}">${r.result === 'accept' ? 'ACCEPTÉ' : 'REFUSÉ'}</span> ${esc(r.text)}</p><ul class="factors">${r.factors.slice(0, 7).map((f) => `<li><span>${esc(f.label)}</span><b class="${f.v > 0 ? 'up' : 'down'}">${f.v > 0 ? '+' : ''}${String(f.v).replace('.', ',')}</b></li>`).join('')}</ul>`;
    }));
    body.querySelectorAll('[data-op]').forEach((b) => b.addEventListener('click', () => { const r = n.coalitionOffensive(Number(b.dataset.op)); notice(r.ok ? 'Offensive coordonnée lancée : toutes les armées de la coalition attaquent ensemble.' : r.text); rerender(); }));
    body.querySelectorAll('[data-goal]').forEach((s) => s.addEventListener('change', () => { n.setCoalitionGoal(Number(s.dataset.goal), s.value); rerender(); }));
    body.querySelectorAll('[data-leave]').forEach((b) => b.addEventListener('click', () => {
      const c = coalitions(sim).find((x) => x.id === Number(b.dataset.leave));
      const war = c && sim.atWar[n.player * sim.S + c.target] > 0;
      if (!window.confirm(`Quitter « ${c ? c.name : ''} » ?${war ? ' Vous signerez une paix séparée avec la cible (statu quo) et vos partenaires s\'en souviendront.' : ''}`)) return;
      n.leaveCoalitionP(Number(b.dataset.leave), true);
      rerender();
    }));
    body.querySelectorAll('select').forEach((s) => s.addEventListener('keydown', (e) => e.stopPropagation()));
  }
}
