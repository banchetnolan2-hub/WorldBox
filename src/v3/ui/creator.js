// UI — créateur de partie : modes, scénarios, pays participants, équipes, paramètres
import { icon } from './icons.js';
import { rulesBadge } from './rulesUI.js';
import { $, show, esc, colorDot, seg, bindRange, fmtTime, TEAM_COLORS, teamName, notice } from './util.js';
import { randomSeedString } from '../sim/rng.js';
import { audio } from '../audio/audio.js';
import { PERSONALITIES } from '../sim/profile.js';

export const EVENT_LEVELS = [
  { value: 0, label: 'Aucun' }, { value: 0.6, label: 'Rares' }, { value: 1, label: 'Normaux' }, { value: 1.8, label: 'Fréquents' }, { value: 3, label: 'Très fréq.' },
];
const SPEEDS = [0.5, 1, 2, 4, 8];

export function defaultCreatorConfig() {
  return {
    mode: '1v1',
    teams: [],
    options: { speed: 1, eventRate: 1, randomness: 0.5, maxDuration: 300, victoryRatio: 0.35, seed: randomSeedString(), naval: true, powerAll: 1, popAll: 1, resAll: 1, start: 'world', neutralCapture: true, warStart: 'war', aiWars: true, warEnd: { territorial: 'percent', percent: 0.65, economic: true, peace: true, capitulation: true } },
  };
}

const STRATS = [['equilibree', 'Selon la fiche du pays'], ['agressive', 'Agressive'], ['defensive', 'Défensive']];
const PERSOS = [['', 'Selon la fiche du pays'], ...Object.entries(PERSONALITIES).map(([k, v]) => [k, v.label])];

export class Creator {
  constructor(app) {
    this.app = app;
    this.cfg = defaultCreatorConfig();
    this.openEdit = null;
    document.querySelectorAll('#modeTabs button').forEach((b) => b.addEventListener('click', () => { audio.sfx('click'); this.setMode(b.dataset.mode); }));
    document.querySelectorAll('#presetRow [data-preset]').forEach((b) => b.addEventListener('click', () => { audio.sfx('click'); this.preset(b.dataset.preset); }));
    $('addTeamBtn').addEventListener('click', () => this.addTeam());
    $('clearBtn').addEventListener('click', () => { this.cfg.teams.forEach((t) => { t.members = []; }); this.render(); });
    $('creatorBack').addEventListener('click', () => app.goMenu());
    $('creatorLaunch').addEventListener('click', () => this.launch());
    $('cRulesBtn').addEventListener('click', () => {
      const op = this.cfg.options;
      this.app.rulesUI.open({ mode: this.ruleMode(), rules: op.rules || {}, onDone: (r) => { op.rules = r; this.renderRules(); } });
    });
    $('cSeedDice').addEventListener('click', () => { this.cfg.options.seed = randomSeedString(); $('cSeed').value = this.cfg.options.seed; });
    $('cSeed').addEventListener('input', () => { this.cfg.options.seed = $('cSeed').value.trim() || randomSeedString(); });
    $('cSeed').addEventListener('keydown', (e) => e.stopPropagation());
    $('cNaval').addEventListener('change', () => { this.cfg.options.naval = $('cNaval').checked; });
    $('cNeutral').addEventListener('change', () => { this.cfg.options.neutralCapture = $('cNeutral').checked; });
    const o = () => this.cfg.options;
    this.setRand = bindRange('cRand', 'oRand', (v) => Math.round(v * 100) + ' %', (v) => { o().randomness = v; });
    this.setDur = bindRange('cDur', 'oDur', (v) => fmtTime(v), (v) => { o().maxDuration = v; });
    this.setPct = bindRange('cPct', 'oPct', (v) => Math.round(v * 100) + ' %', (v) => { this.warEnd().percent = v; this.renderWarHint(); });
    for (const [id, key] of [['cCapit', 'capitulation'], ['cEcon', 'economic'], ['cPeace', 'peace']]) $(id).addEventListener('change', () => { this.warEnd()[key] = $(id).checked; this.renderWarHint(); });
    $('cAiWars').addEventListener('change', () => { o().aiWars = $('cAiWars').checked; this.renderWarHint(); });
    this.setPow = bindRange('cPow', 'oPow', (v) => '×' + v.toFixed(2).replace('.', ','), (v) => { o().powerAll = v; this.renderSummary(); });
    this.setPop = bindRange('cPop', 'oPop', (v) => '×' + v.toFixed(2).replace('.', ','), (v) => { o().popAll = v; this.renderSummary(); });
    this.setRes = bindRange('cRes', 'oRes', (v) => '×' + v.toFixed(2).replace('.', ','), (v) => { o().resAll = v; });
  }

  open(cfg = null) {
    if (cfg) this.cfg = JSON.parse(JSON.stringify(cfg));
    if (!this.cfg.teams.length) this.setMode(this.cfg.mode || '1v1', true);
    // retire les pays disparus du monde actuel
    const cells = this.app.cellCounts();
    for (const t of this.cfg.teams) t.members = t.members.filter((m) => cells[m.e] > 0 && this.app.entities()[m.e]);
    $('creatorWorld').textContent = `Monde : ${this.app.world.name} — année ${this.app.world.year}`;
    const op = this.cfg.options;
    seg($('cSpeed'), SPEEDS.map((s) => ({ value: s, label: String(s).replace('.', ',') + '×' })), op.speed, (v) => { op.speed = Number(v); });
    const evCur = EVENT_LEVELS.reduce((m, l) => (Math.abs(l.value - op.eventRate) < Math.abs(m.value - op.eventRate) ? l : m)).value;
    seg($('cEvents'), EVENT_LEVELS, evCur, (v) => { op.eventRate = Number(v); });
    this.setRand(op.randomness); this.setDur(op.maxDuration);
    this.renderWarOptions();
    this.setPow(op.powerAll); this.setPop(op.popAll); this.setRes(op.resAll);
    $('cSeed').value = op.seed;
    $('cNaval').checked = op.naval !== false;
    $('cNeutral').checked = op.neutralCapture !== false;
    seg($('cStart'), [{ value: 'world', label: 'Frontières du monde' }, { value: 'capital', label: 'Autour de la capitale' }], op.start || 'world', (v) => {
      op.start = v;
      if (v === 'capital') { op.neutralCapture = true; $('cNeutral').checked = true; }
    });
    show('creator');
    this.render();
  }

  close() { show('creator', false); }

  warEnd() {
    const op = this.cfg.options;
    if (!op.warEnd) op.warEnd = { territorial: 'percent', percent: 1 - (op.victoryRatio ?? 0.35), economic: true, peace: true, capitulation: true };
    return op.warEnd;
  }
  renderWarOptions() {
    const op = this.cfg.options, we = this.warEnd();
    if (!op.warStart) op.warStart = this.cfg.mode === 'world' ? 'tensions' : 'war';
    seg($('cWarStart'), [{ value: 'war', label: 'Guerre immédiate' }, { value: 'tensions', label: 'Tensions (l\'IA décide)' }], op.warStart, (v) => { op.warStart = v; this.renderWarHint(); });
    seg($('cTerr'), [{ value: 'complete', label: '100 %' }, { value: 'percent', label: 'Pourcentage' }, { value: 'none', label: 'Aucune' }], we.territorial, (v) => { we.territorial = v; this.renderWarOptions(); });
    $('cPctRow').classList.toggle('hidden', we.territorial !== 'percent');
    this.setPct(we.percent);
    $('cCapit').checked = !!we.capitulation; $('cEcon').checked = !!we.economic; $('cPeace').checked = !!we.peace;
    $('cAiWars').checked = op.aiWars !== false;
    this.renderWarHint();
  }
  renderWarHint() {
    const op = this.cfg.options, we = this.warEnd();
    const parts = [];
    if (we.territorial === 'complete') parts.push('Complete Territorial Victory : 100 % du territoire adverse, vérifié parcelle par parcelle');
    else if (we.territorial === 'percent') parts.push(`victoire quand ${Math.round(we.percent * 100)} % du territoire adverse est conquis`);
    if (we.capitulation) parts.push('capitulation automatique');
    if (we.economic) parts.push('effondrement économique');
    if (we.peace) parts.push('paix négociée');
    $('cWarHint').textContent = parts.length ? `Une guerre se termine par : ${parts.join(', ')}. Puis négociation, traité de paix et nettoyage des frontières.` : 'Guerre sans condition automatique : elle dure jusqu\'à la fin de la simulation (armistice).';
    void op;
  }

  setMode(mode, silent = false) {
    const prev = this.allMembers();
    this.cfg.mode = mode;
    const mk = (k) => ({ name: teamName(k), color: TEAM_COLORS[k % TEAM_COLORS.length], members: [] });
    if (mode === '1v1') {
      this.cfg.teams = [mk(0), mk(1)];
      const list = prev.length >= 2 ? prev.slice(0, 2) : this.defaultPair();
      this.cfg.teams[0].members = [list[0]]; this.cfg.teams[1].members = [list[1]];
    } else if (mode === 'multi') {
      this.cfg.teams = [{ name: 'CHACUN POUR SOI', color: '#94a3b8', members: prev.length ? prev : this.defaultPair() }];
    } else if (mode === 'world') {
      const cells = this.app.cellCounts();
      this.cfg.teams = [{ name: 'MONDE ENTIER', color: '#94a3b8', members: this.app.entities().filter((e) => e.kind !== 'neutral' && cells[e.index] > 0).map((e) => this.member(e.index)) }];
      if (this.cfg.options.maxDuration < 420) { this.cfg.options.maxDuration = 480; this.setDur && this.setDur(480); }
      this.cfg.options.warStart = 'tensions';
      if (this.setPct) this.renderWarOptions();
    } else {
      // équipes / personnalisé : on répartit les pays existants en 2 équipes
      this.cfg.teams = [mk(0), mk(1)];
      const list = prev.length ? prev : this.defaultPair();
      list.forEach((m, k) => this.cfg.teams[k % 2].members.push(m));
    }
    if (!silent) this.render();
  }

  defaultPair() {
    const ents = this.app.entities();
    const cells = this.app.cellCounts();
    const ids = ['FR', 'DE'].map((id) => ents.findIndex((e) => e.id === id)).filter((i) => i >= 0 && cells[i] > 0);
    if (ids.length < 2) {
      const alive = ents.filter((e) => e.kind !== 'neutral' && cells[e.index] > 0).map((e) => e.index);
      return alive.slice(0, 2).map((e) => this.member(e));
    }
    return ids.map((e) => this.member(e));
  }

  member(e) { return { e, powerMult: 1, popMult: 1, resMult: 1, strategy: 'equilibree' }; }
  allMembers() { return this.cfg.teams.flatMap((t) => t.members); }

  preset(name) {
    const ents = this.app.entities();
    const cells = this.app.cellCounts();
    const alive = ents.filter((e) => e.kind !== 'neutral' && cells[e.index] > 0);
    const byCont = { europe: 'Europe', asie: 'Asie', afrique: 'Afrique', oceanie: 'Océanie' };
    if (name === 'monde') { this.setMode('world'); this.highlight('world'); return; }
    let list;
    if (name === 'ameriques') list = alive.filter((e) => e.continent === 'Amérique du Nord' || e.continent === 'Amérique du Sud');
    else if (name === 'random') {
      const pool = alive.filter((e) => cells[e.index] > 20);
      const a = pool[Math.floor(Math.random() * pool.length)];
      const near = pool.filter((b) => b !== a && b.capital && a.capital && dist(a.capital, b.capital) < 2200);
      list = [a, ...shuffle(near).slice(0, 1 + Math.floor(Math.random() * 4))];
    } else list = alive.filter((e) => e.continent === byCont[name]);
    this.cfg.mode = 'multi';
    this.cfg.teams = [{ name: 'CHACUN POUR SOI', color: '#94a3b8', members: list.map((e) => this.member(e.index)) }];
    this.highlight('multi');
    this.render();
  }

  highlight(mode) { this.cfg.mode = mode; }

  addTeam() {
    if (this.cfg.mode === '1v1' || this.cfg.mode === 'multi' || this.cfg.mode === 'world') { this.cfg.mode = 'teams'; }
    const k = this.cfg.teams.length;
    this.cfg.teams.push({ name: teamName(k), color: TEAM_COLORS[k % TEAM_COLORS.length], members: [] });
    this.render();
  }

  addCountries(teamIdx) {
    const used = new Set(this.allMembers().map((m) => m.e));
    this.app.picker.open({
      title: `AJOUTER DES PAYS — ${this.cfg.teams[teamIdx].name}`,
      multi: this.cfg.mode !== '1v1',
      exclude: used,
      onDone: (list) => {
        if (this.cfg.mode === '1v1') this.cfg.teams[teamIdx].members = [this.member(list[0])];
        else for (const e of list) this.cfg.teams[teamIdx].members.push(this.member(e));
        this.render();
      },
    });
  }

  render() {
    document.querySelectorAll('#modeTabs button').forEach((b) => b.classList.toggle('on', b.dataset.mode === this.cfg.mode));
    this.renderRules();
    const ents = this.app.entities();
    const custom = this.cfg.mode === 'custom';
    const el = $('teams');
    const teams = this.cfg.teams;
    const compact = this.cfg.mode === 'world';
    el.innerHTML = teams.map((t, ti) => `
      <div class="team" style="--tc:${t.color}" data-t="${ti}">
        <div class="team-head">
          <input value="${esc(t.name)}" data-tname="${ti}" ${this.cfg.mode === 'multi' || compact ? 'readonly' : ''}>
          <span class="count">${t.members.length}</span>
          ${teams.length > 2 && !['1v1', 'multi', 'world'].includes(this.cfg.mode) ? `<button class="btn ghost xs icon" data-delteam="${ti}" title="Supprimer l'équipe">${icon('x')}</button>` : ''}
        </div>
        <ul class="team-list">
          ${t.members.slice(0, compact ? 60 : 400).map((m, mi) => {
            const e = ents[m.e];
            const open = this.openEdit === `${ti}:${mi}`;
            return `<li>
              <div class="pcard">
                ${colorDot(e)}<span class="nm" title="${esc(e.name)}">${esc(e.name)}</span>
                <span class="pw" title="Puissance">${Math.round(e.stats.puissance * m.powerMult)}</span>
                ${teams.length > 1 && !compact ? `<select data-move="${ti}:${mi}" title="Changer d'équipe">${teams.map((tt, k) => `<option value="${k}" ${k === ti ? 'selected' : ''}>${esc(tt.name.replace('ÉQUIPE ', 'Éq. '))}</option>`).join('')}</select>` : ''}
                <button data-edit="${ti}:${mi}" title="Réglages du pays">${icon('sliders-horizontal')}</button>
                <button data-rm="${ti}:${mi}" title="Retirer">${icon('x')}</button>
              </div>
              ${open ? this.editHtml(m, e, custom) : ''}
            </li>`;
          }).join('')}
          ${compact && t.members.length > 60 ? `<li class="hint">… et ${t.members.length - 60} autres pays</li>` : ''}
        </ul>
        ${compact ? '' : `<button class="team-add" data-add="${ti}">Ajouter un pays</button>`}
      </div>`).join('');
    el.querySelectorAll('[data-add]').forEach((b) => b.addEventListener('click', () => this.addCountries(Number(b.dataset.add))));
    el.querySelectorAll('[data-rm]').forEach((b) => b.addEventListener('click', () => {
      const [ti, mi] = b.dataset.rm.split(':').map(Number);
      teams[ti].members.splice(mi, 1); this.openEdit = null; this.render();
    }));
    el.querySelectorAll('[data-edit]').forEach((b) => b.addEventListener('click', () => {
      this.openEdit = this.openEdit === b.dataset.edit ? null : b.dataset.edit; this.render();
    }));
    el.querySelectorAll('[data-move]').forEach((s) => s.addEventListener('change', () => {
      const [ti, mi] = s.dataset.move.split(':').map(Number);
      const to = Number(s.value);
      const [m] = teams[ti].members.splice(mi, 1);
      if (this.cfg.mode === '1v1') { const other = teams[to].members.splice(0, 1); teams[ti].members.push(...other); }
      teams[to].members.push(m);
      if (this.cfg.mode === '1v1' || this.cfg.mode === 'multi') this.cfg.mode = this.cfg.mode === '1v1' ? '1v1' : 'teams';
      this.openEdit = null; this.render();
    }));
    el.querySelectorAll('[data-delteam]').forEach((b) => b.addEventListener('click', () => {
      const ti = Number(b.dataset.delteam);
      const [t] = teams.splice(ti, 1);
      teams[0].members.push(...t.members);
      this.render();
    }));
    el.querySelectorAll('[data-tname]').forEach((i) => {
      i.addEventListener('input', () => { teams[Number(i.dataset.tname)].name = i.value.slice(0, 24) || teamName(Number(i.dataset.tname)); });
      i.addEventListener('keydown', (e) => e.stopPropagation());
    });
    el.querySelectorAll('.pedit input, .pedit select').forEach((inp) => {
      const [ti, mi, key] = inp.dataset.k.split(':');
      const m = teams[Number(ti)].members[Number(mi)];
      inp.addEventListener('input', () => {
        if (key === 'strategy') m.strategy = inp.value;
        else if (key === 'personality') m.personality = inp.value || undefined;
        else if (key.startsWith('stat.')) { m.stats = m.stats || {}; m.stats[key.slice(5)] = Number(inp.value); }
        else m[key] = Number(inp.value);
        const out = inp.parentElement.querySelector('output');
        if (out) out.textContent = key.startsWith('stat.') ? inp.value : '×' + Number(inp.value).toFixed(2).replace('.', ',');
        this.renderSummary();
      });
    });
    this.renderSummary();
    this.app.previewParticipants(new Set(this.allMembers().map((m) => m.e)));
  }

  editHtml(m, e, custom) {
    const [ti, mi] = this.openEdit.split(':');
    const k = (key) => `${ti}:${mi}:${key}`;
    const range = (key, label, min, max, step, val) => `<label><span>${label}</span><output>×${Number(val).toFixed(2).replace('.', ',')}</output></label><input type="range" min="${min}" max="${max}" step="${step}" value="${val}" data-k="${k(key)}">`;
    const stat = (key, label) => {
      const v = (m.stats && m.stats[key] !== undefined) ? m.stats[key] : e.stats[key];
      return `<label><span>${label}</span><output>${v}</output></label><input type="range" min="5" max="100" step="1" value="${v}" data-k="${k('stat.' + key)}">`;
    };
    return `<div class="pedit">
      ${range('powerMult', 'Puissance', 0.5, 2, 0.05, m.powerMult)}
      ${range('popMult', 'Population', 0.25, 4, 0.05, m.popMult)}
      ${range('resMult', 'Ressources', 0.5, 1.5, 0.05, m.resMult)}
      <label><span>Personnalité de l'IA</span></label>
      <select data-k="${k('personality')}">${PERSOS.map(([v, l]) => `<option value="${v}" ${(m.personality || '') === v ? 'selected' : ''}>${l}</option>`).join('')}</select>
      ${custom ? stat('economie', 'Économie') + stat('stabilite', 'Stabilité') + stat('mobilite', 'Mobilité') + stat('defense', 'Défense') + stat('vitesse', 'Vitesse de progression') + stat('expansion', 'Expansion') : ''}
    </div>`;
  }

  renderSummary() {
    const n = this.allMembers().length;
    const teams = this.effectiveTeams();
    $('participantsCount').textContent = `${n} pays · ${teams.length} ${teams.length > 1 ? 'camps' : 'camp'}`;
    let warn = '';
    if (n < 2) warn = 'Ajoutez au moins 2 pays.';
    else if (teams.length < 2) warn = 'Il faut au moins 2 équipes avec des pays.';
    $('creatorWarn').textContent = warn;
    $('creatorLaunch').disabled = !!warn;
    const units = this.allMembers().reduce((s, m) => s + this.app.unitsFor(m, this.cfg.options), 0);
    $('creatorSummary').textContent = n ? `${n} pays, environ ${Math.round(units).toLocaleString('fr-FR')} unités au total.` : '';
  }

  // équipes réelles pour le moteur (en MULTI / MONDE : un camp par pays)
  effectiveTeams() {
    if (this.cfg.mode === 'multi' || this.cfg.mode === 'world') {
      return this.allMembers().map((m) => ({ name: this.app.entities()[m.e].name, color: this.app.entities()[m.e].color, members: [m] }));
    }
    return this.cfg.teams.filter((t) => t.members.length);
  }

  ruleMode() { return this.cfg.mode === 'custom' || this.cfg.mode === 'teams' ? 'custom' : 'sandbox'; }
  renderRules() { const t = $('cRulesTxt'); if (t) t.textContent = rulesBadge(this.cfg.options.rules || {}, this.ruleMode()); }
  buildSetup() {
    const op = this.cfg.options;
    const teams = this.effectiveTeams();
    const participants = [];
    teams.forEach((t, ti) => t.members.forEach((m) => participants.push({
      e: m.e, team: ti, powerMult: m.powerMult * op.powerAll, popMult: m.popMult * op.popAll, resMult: m.resMult * op.resAll,
      strategy: m.strategy, stats: m.stats, personality: m.personality,
    })));
    const label = this.cfg.mode === 'world' ? 'Monde entier'
      : teams.length === 2 && teams.every((t) => t.members.length === 1) ? teams.map((t) => this.app.entities()[t.members[0].e].name).join(' VS ')
      : this.cfg.mode === 'multi' ? `${participants.length} pays` : teams.map((t) => t.name).join(' VS ');
    return {
      participants,
      teams: teams.map((t) => ({ name: t.name, color: t.color })),
      options: { seed: op.seed, eventRate: op.eventRate, randomness: op.randomness, maxDuration: op.maxDuration, victoryRatio: op.victoryRatio, naval: op.naval !== false, speed: op.speed, start: op.start || 'world', neutralCapture: op.neutralCapture !== false, warStart: op.warStart || 'war', aiWars: op.aiWars !== false, warEnd: { ...this.warEnd() }, rules: { ...(op.rules || {}) }, mode: this.ruleMode() },
      label,
      mode: this.cfg.mode,
    };
  }

  launch() {
    if ($('creatorLaunch').disabled) { notice($('creatorWarn').textContent); return; }
    this.app.launch(this.buildSetup(), JSON.parse(JSON.stringify(this.cfg)));
  }
}

function dist(p, q) {
  const R = 6371, t = Math.PI / 180;
  const a = Math.sin((q.lat - p.lat) * t / 2) ** 2 + Math.cos(p.lat * t) * Math.cos(q.lat * t) * Math.sin((q.lon - p.lon) * t / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}
function shuffle(a) { const b = [...a]; for (let k = b.length - 1; k > 0; k--) { const r = Math.floor(Math.random() * (k + 1)); [b[k], b[r]] = [b[r], b[k]]; } return b; }
