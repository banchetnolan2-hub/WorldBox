// UI — TABLEAU DE BORD « MON PAYS » et CONSEILLER : la situation nationale en un coup d'œil.
// Priorité à la décision : d'abord ce qui demande une action (alertes), puis une carte par thème avec
// 2 ou 3 chiffres clés et un état coloré ; un clic ouvre le panneau où agir.
// Lecture seule : les données viennent de sim/insights.js (aucun effet sur la simulation).
import { esc, fmtInt } from './util.js';
import { icon } from './icons.js';
import { fmtBn } from '../sim/profile.js';
import { dashboard, alerts, advise } from '../sim/insights.js';
import { fmtDate } from '../sim/calendar.js';

const num = (v, d = 1) => (Math.round(v * 10 ** d) / 10 ** d).toLocaleString('fr-FR');
const pct = (v, d = 0) => `${(v * 100).toFixed(d).replace('.', ',')} %`;
const sign = (v, d = 1) => `${v >= 0 ? '+' : '−'}${num(Math.abs(v), d)}`;
const TONE_LABEL = { good: 'Bon', warn: 'À surveiller', bad: 'Critique' };
const LEVEL = { 3: 'bad', 2: 'warn', 1: 'info' };

function card(id, title, ic, tone, target, rows, foot = '') {
  return `<button class="db-card ${tone}" data-dbgo="${target}" title="Ouvrir : ${esc(title)}">
    <div class="db-card-h">${icon(ic)}<b>${esc(title)}</b><i class="db-state" title="${TONE_LABEL[tone] || ''}"></i></div>
    <div class="db-rows">${rows.map(([l, v, c]) => `<div><span>${l}</span><b class="${c || ''}">${v}</b></div>`).join('')}</div>${foot ? `<small class="db-foot">${foot}</small>` : ''}</button>`;
}

// noms des pays (avec pastille de couleur)
const names = (ui, list, max = 3) => (list.length ? list.slice(0, max).map((o) => ui.sim.sides[o].name).join(', ') + (list.length > max ? ` +${list.length - max}` : '') : '—');

export function dashboardHtml(ui, sim, n, sd) {
  const k = n.player;
  const d = dashboard(sim, k, n);
  const al = alerts(sim, k, n);
  const e = d.economy, b = d.budget, m = d.military, l = d.logistics, t = d.territory;
  const R = sim.rules;
  const top = al.slice(0, 5);
  const cards = [
    card('eco', 'Économie', 'coins', e.tone, 'eco', [
      ['PIB', fmtBn(e.gdp)], ['Croissance', e.growthKnown ? `${sign(e.growth * 100)} %` : 'en mesure…', !e.growthKnown ? '' : e.growth >= 0 ? 'up' : 'down'],
      ['Rang mondial (PIB)', `n° ${e.gdpRank}`], ...(e.unemp !== null ? [['Chômage', `${num(e.unemp)} %`, e.unemp > 11 ? 'down' : '']] : []),
    ], e.crisis ? 'Crise économique en cours' : ''),
    card('budget', 'Budget', 'landmark', b.tone, 'eco', [
      ['Trésorerie', fmtBn(b.money)], ['Solde annuel', `${b.balance >= 0 ? '+' : ''}${fmtBn(b.balance)}`, b.balance >= 0 ? 'up' : 'down'],
      ['Dette', `${pct(b.debtRatio)} du PIB`, b.debtRatio > 1 ? 'down' : ''],
    ], b.pay < 0.999 ? `Armée payée à ${pct(b.pay)}` : ''),
    card('pop', 'Population et stabilité', 'users', d.stability.tone === 'bad' || d.population.tone === 'bad' ? 'bad' : d.stability.tone === 'warn' || d.population.tone === 'warn' ? 'warn' : 'good', 'pop', [
      ['Population', `${num(d.population.pop / 1e6)} M`], ['Démographie', `${sign(d.population.growth, 2)} %/an`, d.population.growth < 0 ? 'down' : ''],
      ['Stabilité', pct(d.stability.value), d.stability.value < 0.45 ? 'down' : ''],
    ], d.stability.yearAgo !== null ? `Il y a un an : ${pct(d.stability.yearAgo)}` : ''),
    card('res', 'Ressources', 'gem', d.resources.tone, 'infra', [
      ['Alimentation', Math.round(d.resources.food)], ['Énergie', Math.round(d.resources.energy)], ['Matières premières', Math.round(d.resources.raw)],
      ['Stocks militaires', `${Math.round(d.resources.military)} / 100`, d.resources.military < 20 ? 'down' : ''],
    ]),
    card('mil', 'Puissance militaire', 'shield', m.tone, 'def', [
      ['Personnel', fmtInt(m.soldiers)], ['Puissance', `n° ${m.powerRank} mondial`], ['Préparation', pct(m.readiness), m.readiness < 0.7 ? 'down' : ''],
      ['Aviation · Marine', `${num(m.air, 0)} · ${num(m.navy, 0)}`],
    ], `${m.groups} groupe(s) sur la carte · moral ${pct(Math.min(1, m.morale))}`),
    card('wars', 'Guerres', 'swords', d.wars.tone, 'mil', d.wars.list.length ? d.wars.list.slice(0, 3).map((w) => [esc(w.name.length > 34 ? w.name.slice(0, 33) + '…' : w.name), w.trend === 'win' ? 'Avantage' : w.trend === 'lose' ? 'Recul' : 'Équilibre', w.trend === 'win' ? 'up' : w.trend === 'lose' ? 'down' : '']) : [['Situation', 'En paix', 'up']],
    d.wars.list.length ? `Rapport de forces : ${d.wars.list.map((w) => num(w.ratio, 2)).join(' · ')}` : ''),
    card('diplo', 'Diplomatie', 'handshake', d.diplomacy.tone, 'diplo', [
      ['Alliés', esc(names(ui, d.diplomacy.allies))], ['Partenaires commerciaux', d.diplomacy.partners.length], ['Tensions', esc(names(ui, d.diplomacy.tense)), d.diplomacy.tense.length ? 'down' : ''],
    ], d.diplomacy.offers ? `${d.diplomacy.offers} proposition(s) en attente` : ''),
    ...(R.techTree !== false ? [card('dev', 'Recherche', 'network', d.research.tone, 'dev', d.research.list.length ? d.research.list.slice(0, 3).map((x) => [esc(x.name), x.stalled ? 'Suspendu' : `${pct(x.progress)} · ${x.months} mois`, x.stalled ? 'down' : '']) : [['Projets', 'Aucun en cours', 'down']],
      `${d.research.done} technologie(s) acquise(s) · niveau ${Math.round(d.research.tech)}`)] : []),
    card('prod', 'Production et logistique', 'factory', l.tone === 'bad' || d.production.tone === 'bad' ? 'bad' : l.tone === 'warn' || d.production.tone === 'warn' ? 'warn' : 'good', 'infra', [
      ['Industrie', Math.round(d.production.industry)], ['Ravitaillement', pct(l.supply), l.supply < 0.8 ? 'down' : ''], ['Routes · Rail · Ports', `${Math.round(l.roads)} · ${Math.round(l.rail)} · ${Math.round(l.ports)}`],
    ], d.production.blockade > 0 ? 'Blocus naval en cours' : ''),
    card('terr', 'Territoire', 'map', t.tone, 'mil', [
      ['Superficie', `${fmtInt(t.km2)} km²`], ['Évolution', `${sign(t.change * 100)} %`, t.change < 0 ? 'down' : t.change > 0 ? 'up' : ''],
      ['Zones occupées', t.occupied ? fmtInt(t.occupied) + ' parcelles' : 'Aucune'],
    ]),
  ];
  const recent = d.recent.length ? `<ul class="db-recent">${d.recent.map((x) => `<li><small>${esc(fmtDate(x.t, sim.cfg.startDay, true))}</small><span>${esc(x.text)}</span></li>`).join('')}</ul>` : '<p class="hint">Aucun événement pour le moment.</p>';
  return `<div class="db">
    <div class="db-alerts">${top.length ? top.map((a) => `<button class="db-alert ${LEVEL[a.level]}" data-dbgo="${a.target}">${icon(a.level >= 3 ? 'alert-triangle' : a.level === 2 ? 'alert-circle' : 'info')}<span>${esc(a.text)}</span>${icon('chevron-right')}</button>`).join('') : `<div class="db-alert ok">${icon('check')}<span>Aucune alerte : la situation est sous contrôle.</span></div>`}</div>
    <div class="db-grid">${cards.join('')}</div>
    <div class="db-bottom">
      <div><h4>Événements récents</h4>${recent}</div>
      <div><h4>Conseiller</h4>${advisorSummary(sim, n)}<button class="btn ghost sm" data-dbgo="advisor">${icon('lightbulb')}<span>Voir les analyses du conseiller</span></button></div>
    </div></div>`;
}

function advisorSummary(sim, n) {
  const topics = advise(sim, n.player, n).filter((x) => x.state !== 'good').slice(0, 3);
  if (!topics.length) return '<p class="hint">Rien d\'inquiétant : continuez votre stratégie.</p>';
  return `<ul class="db-adv">${topics.map((x) => `<li class="${x.state}"><b>${esc(x.title)}</b><span>${esc(x.recs[0] ? x.recs[0].text : x.summary)}</span></li>`).join('')}</ul>`;
}

// ======================= CONSEILLER =======================
export function advisorHtml(ui, sim, n) {
  const topics = advise(sim, n.player, n);
  return `<p class="hint">Le conseiller analyse la situation et explique les causes. Il ne prend aucune décision à votre place : chaque piste ouvre le panneau où agir.</p>
  <div class="adv">${topics.map((x) => `<section class="adv-topic ${x.state}">
    <header>${icon(x.icon)}<b>${esc(x.title)}</b><span class="adv-state">${TONE_LABEL[x.state]}</span></header>
    <p>${esc(x.summary)}</p>
    ${x.causes.length ? `<h5>Pourquoi</h5><ul>${x.causes.map((c) => `<li>${esc(c)}</li>`).join('')}</ul>` : ''}
    ${x.recs.length ? `<h5>Ce que vous pouvez faire</h5><div class="adv-recs">${x.recs.map((r) => `<button class="btn ghost sm" data-dbgo="${r.target}">${icon('chevron-right')}<span>${esc(r.text)}</span></button>`).join('')}</div>` : ''}
  </section>`).join('')}</div>`;
}
