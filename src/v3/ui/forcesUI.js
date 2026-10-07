// UI — FORCES ARMÉES DU JOUEUR : composition de l'armée et groupes d'armée (onglet Défense), fiches
// flottantes au clic sur un groupe d'armée ou une flotte, et choix des destinations des flottes sur la carte.
// Toute modification passe par un ordre (app.act) : identique chez tous les joueurs en multijoueur.
import { $, show, esc, notice, fmtInt } from './util.js';
import { icon } from './icons.js';
import { COMP_KEYS, COMP_LABELS, currentComposition, normalizeComposition, compositionEffects, GROUP_TASKS, MAX_GROUPS, normalizeGroups, groupName, FLEET_ORDERS } from '../sim/military.js';
import { relationStatus } from '../sim/wars.js';

const pctx = (v) => `${v >= 1 ? '+' : '−'}${Math.round(Math.abs(v - 1) * 100)} %`;

export class ForcesUI {
  constructor(app) {
    this.app = app;
    this.draft = null;        // composition en cours d'édition
    this.pickMode = null;     // { fleet, type, pts } : choix de destinations sur la carte
    const t = document.createElement('template');
    t.innerHTML = `<div id="floatCard" class="panel hidden"></div>`;
    document.body.appendChild(t.content.firstChild);
    const t2 = document.createElement('template');
    t2.innerHTML = `<div id="pickBanner" class="panel hidden"></div>`;
    document.body.appendChild(t2.content.firstChild);
    $('floatCard').addEventListener('pointerdown', (e) => e.stopPropagation());
  }
  get sim() { return this.app.session.sim; }

  // ======================= onglet Défense =======================
  html(sim, n, sd) {
    const pol = n.policy;
    const comp = this.draft || pol.comp || currentComposition(sd);
    const fx = compositionEffects(comp);
    const total = COMP_KEYS.reduce((t, k) => t + (comp[k] || 0), 0);
    const groups = normalizeGroups(pol.groups || { count: 0 }, sim.S);
    const foes = [];
    for (let o = 0; o < sim.S; o++) if (o !== n.player && !sim.sides[o].eliminated && (sim.atWar[n.player * sim.S + o] || sim.contact[n.player * sim.S + o] > 0)) foes.push(o);
    foes.sort((a, b) => (sim.atWar[n.player * sim.S + b] - sim.atWar[n.player * sim.S + a]) || sim.sides[a].name.localeCompare(sim.sides[b].name));
    const st = (o) => (sim.atWar[n.player * sim.S + o] ? ' (en guerre)' : relationStatus(sim, n.player, o) === 'ally' ? ' (allié)' : '');
    return `<div class="nm-cols forces"><div>
      <h4>Composition de l'armée</h4>
      <p class="hint">Proportions visées : le recrutement suit cette composition et 4 % de l'armée de terre se reconvertit chaque mois.</p>
      ${COMP_KEYS.map((k) => `<div class="field comp-row"><label><span>${icon(COMP_LABELS[k].icon)} ${COMP_LABELS[k].label}</span><output data-cout="${k}">${comp[k] || 0} %</output></label><input type="range" min="0" max="80" step="1" value="${comp[k] || 0}" data-comp="${k}"><small class="hint">${esc(COMP_LABELS[k].desc)}</small></div>`).join('')}
      <div class="comp-fx" id="compFx">${this._fxHtml(fx, total)}</div>
      <div class="row"><button class="btn primary sm" data-compapply>${icon('check')}<span>Appliquer la composition</span></button><button class="btn ghost sm" data-compreset>${icon('rotate-ccw')}<span>Composition actuelle</span></button></div>
    </div><div>
      <h4>Groupes d'armée</h4>
      <div class="field"><label><span>Nombre de groupes</span></label><select data-gcount>${['Automatique', ...Array.from({ length: MAX_GROUPS }, (_, i) => `${i + 1}`)].map((l, i) => `<option value="${i}" ${groups.count === i ? 'selected' : ''}>${l}</option>`).join('')}</select>
        <small class="hint">Chaque groupe est un pion sur la carte : cliquez-le pour voir sa fiche.</small></div>
      ${groups.count ? `<div class="grp-list">${groups.list.map((g, i) => `<div class="grp-row" data-gi="${i}"><b>${esc(groupName(g, i))}</b>
        <select data-gtask="${i}">${Object.entries(GROUP_TASKS).map(([k, v]) => `<option value="${k}" ${g.task === k ? 'selected' : ''}>${v.label}</option>`).join('')}</select>
        ${g.task === 'front' || this._frontPick === i ? `<select data-gtarget="${i}">${foes.length ? foes.map((o) => `<option value="${o}" ${g.target === o ? 'selected' : ''}>${esc(sim.sides[o].name + st(o))}</option>`).join('') : '<option value="-1">Aucun pays voisin</option>'}</select>` : ''}</div>`).join('')}</div>
        <p class="hint">${Object.entries(GROUP_TASKS).map(([, v]) => `<b>${v.label}</b> : ${v.desc}`).join('<br>')}</p>` : '<p class="hint">Automatique : l\'état-major choisit le nombre de groupes selon la taille de l\'armée et les répartit entre les fronts et la capitale.</p>'}
    </div></div>`;
  }
  _fxHtml(fx, total) {
    return `<div class="kv"><span>Consommation logistique</span><b class="${fx.logistics > 1.05 ? 'down' : fx.logistics < 0.95 ? 'up' : ''}">${pctx(fx.logistics)}</b></div>
      <div class="kv"><span>Mobilité</span><b class="${fx.mobility > 1.02 ? 'up' : fx.mobility < 0.98 ? 'down' : ''}">${pctx(fx.mobility)}</b></div>
      <div class="kv"><span>Aviation (objectif)</span><b>${pctx(1 + fx.airShare)}</b></div>
      <div class="kv"><span>Forces spéciales</span><b>${Math.round(fx.sof * 100)} %</b></div>
      ${total !== 100 ? `<small class="hint">Total : ${total} % — les proportions seront ramenées à 100 %.</small>` : ''}`;
  }
  bind(body) {
    const sim = this.sim, n = sim.nv;
    const comp = () => this.draft || n.policy.comp || currentComposition(sim.sides[n.player]);
    body.querySelectorAll('[data-comp]').forEach((inp) => {
      inp.oninput = () => {
        this.draft = { ...comp(), [inp.dataset.comp]: Number(inp.value) };
        body.querySelector(`[data-cout="${inp.dataset.comp}"]`).textContent = `${inp.value} %`;
        const t = COMP_KEYS.reduce((a, k) => a + (this.draft[k] || 0), 0);
        $('compFx').innerHTML = this._fxHtml(compositionEffects(this.draft), t);
        this.app.nationUI.busy = true;
      };
      inp.onchange = () => { this.app.nationUI.busy = false; };
    });
    const ap = body.querySelector('[data-compapply]');
    if (ap) ap.onclick = () => {
      const c = normalizeComposition(comp());
      this.app.act({ op: 'policy', patch: { comp: c }, text: `Composition de l'armée : ${COMP_KEYS.map((k) => `${COMP_LABELS[k].label.toLowerCase()} ${c[k]} %`).join(', ')}.` });
      this.draft = null; notice('Composition appliquée : le recrutement et la reconversion suivent désormais ces proportions.');
      this.app.nationUI._renderTab(true);
    };
    const rs = body.querySelector('[data-compreset]');
    if (rs) rs.onclick = () => { this.draft = currentComposition(sim.sides[n.player]); this.app.nationUI._renderTab(true); };
    const send = (groups, text) => { this.app.act({ op: 'policy', patch: { groups }, text }); setTimeout(() => this.app.nationUI._renderTab(true), 30); };
    const gc = body.querySelector('[data-gcount]');
    if (gc) gc.onchange = () => {
      const cur = normalizeGroups(n.policy.groups || { count: 0 }, sim.S);
      const count = Number(gc.value);
      const list = Array.from({ length: count }, (_, i) => cur.list[i] || { task: 'auto', target: -1 });
      send({ count, list }, count ? `Organisation de l'armée en ${count} groupe(s) d'armée.` : 'Groupes d\'armée : répartition automatique.');
    };
    body.querySelectorAll('[data-gtask]').forEach((s) => { s.onchange = () => {
      const cur = normalizeGroups(n.policy.groups, sim.S), i = Number(s.dataset.gtask);
      const task = s.value;
      let target = cur.list[i].target;
      if (task === 'front' && target < 0) { const f = body.querySelector(`[data-gtarget="${i}"]`); target = f ? Number(f.value) : this._firstFoe(sim, n.player); }
      if (task === 'front' && target < 0) { notice('Aucun pays voisin ou ennemi pour un front.'); return; }
      cur.list[i] = { ...cur.list[i], task, target };
      send(cur, `${groupName(cur.list[i], i)} : ${GROUP_TASKS[task].label.toLowerCase()}${task === 'front' ? ` contre ${sim.sides[target].name}` : ''}.`);
    }; });
    body.querySelectorAll('[data-gtarget]').forEach((s) => { s.onchange = () => {
      const cur = normalizeGroups(n.policy.groups, sim.S), i = Number(s.dataset.gtarget);
      cur.list[i] = { ...cur.list[i], task: 'front', target: Number(s.value) };
      send(cur, `${groupName(cur.list[i], i)} : front contre ${sim.sides[Number(s.value)].name}.`);
    }; });
  }
  _firstFoe(sim, k) {
    for (let o = 0; o < sim.S; o++) if (o !== k && sim.atWar[k * sim.S + o] && !sim.sides[o].eliminated) return o;
    for (let o = 0; o < sim.S; o++) if (o !== k && sim.contact[k * sim.S + o] > 0 && !sim.sides[o].eliminated) return o;
    return -1;
  }

  // ======================= sélection sur la carte =======================
  // clic sur la carte : groupe d'armée ou flotte à proximité ? (true = clic traité)
  click(sx, sy) {
    const sim = this.sim, r = this.app.renderer;
    if (!sim) return false;
    if (this.pickMode) { this._pickPoint(sx, sy); return true; }
    let best = null, bd = 18 * 18;
    const consider = (kind, obj, xyz) => { const p = r.project(xyz[0], xyz[1], xyz[2], 1.004); if (!p) return; const d = (p[0] - sx) ** 2 + (p[1] - sy) ** 2; if (d < bd) { bd = d; best = { kind, obj, p }; } };
    if (r.showMarkers !== false) {
      for (const sd of sim.sides) { if (sd.eliminated) continue; for (const a of sd.agents) if (sim.time >= a.bornAt && a.transit < 0) consider('group', a, [a.x, a.y, a.z]); }
      for (const f of sim.fleets || []) consider('fleet', f, sim.fleetPos(f));
    }
    if (!best) { this.hideCard(); return false; }
    this.sel = best;
    this._card(sx, sy);
    return true;
  }
  hideCard() { show('floatCard', false); this.sel = null; }
  refresh() { if (this.sel && !$('floatCard').classList.contains('hidden')) this._card(null, null); }
  _card(sx, sy) {
    const sim = this.sim, s = this.sel;
    if (!s) return;
    const el = $('floatCard');
    const k = s.kind === 'group' ? s.obj.side : s.obj.side;
    const sd = sim.sides[k];
    if (!sd) { this.hideCard(); return; }
    const ent = this.app.entities()[sd.e];
    const mine = sim.nv && k === sim.nv.player;
    const col = this.app.renderer.colors[sd.e] || ent.color;
    let body = '';
    if (s.kind === 'group') {
      const a = s.obj;
      const plan = sd.groupPlan;
      const gid = Number.isInteger(a.gid) ? a.gid : [...sd.agents].sort((x, y) => x.id - y.id).indexOf(a) % Math.max(1, plan ? plan.count : 1);
      this.selGid = gid;
      const g = plan && plan.list[gid];
      const f = a.postKey && a.postKey[0] === 'S' ? sd.front[a.postKey.slice(1)] : null;
      const title = plan ? groupName(g, gid) : 'Groupe d\'armée';
      body = `<div class="fc-h"><i class="dot" style="background:${col}"></i><b>${esc(title)}</b><small>${esc(sd.name)}</small></div>
        <div class="kv"><span>Effectifs représentés</span><b>${fmtInt(Math.max(0, a.str) * 1000)}</b></div>
        <div class="kv"><span>Affectation</span><b>${esc(g ? GROUP_TASKS[g.task].label + (g.task === 'front' && sim.sides[g.target] ? ` · ${sim.sides[g.target].name}` : '') : 'Automatique')}</b></div>
        <div class="kv"><span>Position</span><b>${esc(f ? f.name || 'Front' : a.postKey === 'K' ? 'Région de la capitale' : a.postKey === 'C' ? 'Conquêtes récentes' : 'Territoire national')}</b></div>
        ${f ? `<div class="kv"><span>État du front</span><b>${esc({ advancing: 'En progression', retreating: 'En recul', blocked: 'Bloqué', inactive: 'Calme', active: 'Actif' }[f.status] || f.status)}</b></div>` : ''}
        <div class="kv"><span>Engagé au combat</span><b>${a.engaged ? 'Oui' : 'Non'}</b></div>
        ${mine ? (plan ? `<div class="fc-acts">${Object.entries(GROUP_TASKS).filter(([t]) => t !== 'front').map(([t, v]) => `<button class="btn ghost xs ${g && g.task === t ? 'on' : ''}" data-fcg="${t}">${v.label}</button>`).join('')}<button class="btn ghost xs" data-fcgo="def">${icon('sliders-horizontal')}Affecter à un front…</button></div>` : `<div class="fc-acts"><button class="btn ghost xs" data-fcgo="def">${icon('users')}Organiser les groupes d'armée</button></div>`) : ''}`;
    } else {
      const fl = s.obj, o = fl.order || { type: 'auto' };
      body = `<div class="fc-h"><i class="dot" style="background:${col}"></i><b>Flotte ${esc(sd.name)}</b><small>${icon('ship')}</small></div>
        <div class="kv"><span>Marine du pays</span><b>${Math.round(sd.navy * 10) / 10} gr.</b></div>
        <div class="kv"><span>Ordre</span><b>${esc(FLEET_ORDERS[o.type] ? FLEET_ORDERS[o.type].label : 'Automatique')}${o.arrived ? ' · arrivée' : ''}</b></div>
        ${mine ? `<div class="fc-acts">${Object.entries(FLEET_ORDERS).map(([t, v]) => `<button class="btn ghost xs ${o.type === t ? 'on' : ''}" data-fco="${t}" title="${esc(v.desc)}">${icon(v.icon)}${v.label}</button>`).join('')}</div>` : ''}`;
    }
    el.innerHTML = `<button class="btn ghost xs icon fc-x" title="Fermer">${icon('x')}</button>${body}`;
    el.style.setProperty('--c', col);
    if (sx !== null) { el.style.left = Math.min(window.innerWidth - 300, sx + 16) + 'px'; el.style.top = Math.min(window.innerHeight - 260, Math.max(70, sy - 20)) + 'px'; }
    show('floatCard');
    el.querySelector('.fc-x').onclick = () => this.hideCard();
    el.querySelectorAll('[data-fcgo]').forEach((b) => { b.onclick = () => { this.hideCard(); this.app.nationUI.openPanel(b.dataset.fcgo); }; });
    el.querySelectorAll('[data-fcg]').forEach((b) => { b.onclick = () => {
      const n = sim.nv, cur = normalizeGroups(n.policy.groups, sim.S);
      const gid = this.selGid ?? 0;
      cur.list[gid] = { ...cur.list[gid], task: b.dataset.fcg, target: -1 };
      this.app.act({ op: 'policy', patch: { groups: cur }, text: `${groupName(cur.list[gid], gid)} : ${GROUP_TASKS[b.dataset.fcg].label.toLowerCase()}.` });
      setTimeout(() => this._card(null, null), 30);
    }; });
    el.querySelectorAll('[data-fco]').forEach((b) => { b.onclick = () => this._fleetOrder(s.obj, b.dataset.fco); });
  }

  // ---------- ordres des flottes ----------
  _fleetOrder(fl, type) {
    if (type === 'goto' || type === 'waypoints' || type === 'patrol') {
      this.pickMode = { fleet: fl.id, type, pts: [] };
      this._banner();
      return;
    }
    this.app.act({ op: 'fleet', id: fl.id, order: { type } });
    notice(`Flotte : ${FLEET_ORDERS[type].label.toLowerCase()}.`);
    setTimeout(() => this._card(null, null), 30);
  }
  _banner() {
    const pm = this.pickMode;
    if (!pm) { show('pickBanner', false); return; }
    const multi = pm.type !== 'goto';
    $('pickBanner').innerHTML = `${icon('map-pin')}<span>${pm.type === 'goto' ? 'Cliquez sur la mer ou une côte : destination de la flotte.' : `Cliquez les points de ${pm.type === 'patrol' ? 'patrouille' : 'passage'} dans l'ordre (${pm.pts.length} choisi${pm.pts.length > 1 ? 's' : ''}).`}</span>
      ${multi ? `<button class="btn primary xs" data-pk="ok" ${pm.pts.length ? '' : 'disabled'}>Valider</button>` : ''}<button class="btn ghost xs" data-pk="no">Annuler</button>`;
    show('pickBanner');
    const ok = $('pickBanner').querySelector('[data-pk=ok]');
    if (ok) ok.onclick = () => this._finishPick();
    $('pickBanner').querySelector('[data-pk=no]').onclick = () => this.cancelPick();
  }
  cancelPick() { this.pickMode = null; show('pickBanner', false); }
  _finishPick() {
    const pm = this.pickMode;
    if (!pm || !pm.pts.length) return;
    this.app.act({ op: 'fleet', id: pm.fleet, order: { type: pm.type, pts: pm.pts } });
    notice(`Flotte : ${FLEET_ORDERS[pm.type].label.toLowerCase()} (${pm.pts.length} point${pm.pts.length > 1 ? 's' : ''}).`);
    this.cancelPick();
    setTimeout(() => this._card(null, null), 30);
  }
  _pickPoint(sx, sy) {
    const hit = this.app.renderer.rayToLatLon(sx, sy);
    if (!hit) return;
    const g = this.app.grid, p = hit.p;
    let best = -1, bd = -2;
    for (const i of g.coastalList) { const d = g.xyz[i * 3] * p.x + g.xyz[i * 3 + 1] * p.y + g.xyz[i * 3 + 2] * p.z; if (d > bd) { bd = d; best = i; } }
    if (best < 0) return;
    this.pickMode.pts.push(best);
    if (this.pickMode.type === 'goto' || this.pickMode.pts.length >= 8) this._finishPick(); else this._banner();
  }
}
