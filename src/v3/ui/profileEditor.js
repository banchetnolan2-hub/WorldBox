// UI — FICHE PAYS COMPLÈTE (CREATE COUNTRY) : toutes les statistiques modifiables, reliées entre elles.
// Chaque modification recalcule les valeurs dérivées (PIB, recettes, dépenses, solde, coût de l'armée,
// effectifs mobilisables, puissance, vitesse, ravitaillement…) et signale les incohérences.
import { profileOf, recomputeProfile, statsFromProfile, scaleArmyToBudget, PERSONALITIES, ECONOMY_TYPES, UNIT_LABELS, fmtBn, economyOf } from '../sim/profile.js';
import { esc } from './util.js';

const fmtN = (v, d = 0) => Number(v).toLocaleString('fr-FR', { maximumFractionDigits: d, minimumFractionDigits: 0 });
const fmtPop = (v) => (v >= 1e9 ? (v / 1e9).toFixed(2).replace('.', ',') + ' Md' : v >= 1e6 ? (v / 1e6).toFixed(1).replace('.', ',') + ' M' : fmtN(v)) + ' hab.';
const popToSlider = (p) => Math.log10(Math.max(1e4, p) / 1e4) / 5.2;
const sliderToPop = (v) => Math.round(1e4 * 10 ** (v * 5.2));

// sections : [clé, libellé, champs] ; champ = [chemin, libellé, min, max, pas, unité]
const SECTIONS = [
  ['eco', 'Économie', [
    ['money', 'Trésorerie', 0, 20000, 1, 'bn'], ['debt', 'Dette', 0, 40000, 1, 'bn'],
    ['income', 'Recettes / an', 0, 20000, 1, 'bn'], ['civil', 'Dépenses civiles / an', 0, 20000, 1, 'bn'],
    ['milBudget', 'Budget militaire (% du PIB)', 0, 25, 0.1, '%'],
    ['production', 'Industrie / production', 1, 100, 1], ['trade', 'Commerce', 1, 100, 1],
  ]],
  ['army', 'Armée', [
    ['army.inf', UNIT_LABELS.inf, 0, 4000, 1, 'u'], ['army.arm', UNIT_LABELS.arm, 0, 1500, 1, 'u'], ['army.art', UNIT_LABELS.art, 0, 1500, 1, 'u'],
    ['army.rec', UNIT_LABELS.rec, 0, 500, 1, 'u'], ['army.air', 'Aviation (niveau aérien)', 0, 400, 1, 'u'], ['army.navy', 'Marine (niveau naval)', 0, 300, 1, 'u'],
    ['equip', 'Qualité de l\'équipement', 1, 100, 1],
  ]],
  ['infra', 'Infrastructures', [
    ['infra.roads', 'Routes', 0, 100, 1], ['infra.rail', 'Chemins de fer', 0, 100, 1], ['infra.ports', 'Ports', 0, 100, 1],
    ['infra.airports', 'Aéroports', 0, 100, 1], ['infra.cities', 'Villes', 0, 100, 1],
  ]],
  ['tech', 'Technologie', [
    ['tech', 'Niveau technologique', 1, 100, 1], ['research', 'Recherche', 1, 100, 1], ['efficiency', 'Efficacité industrielle', 1, 100, 1],
  ]],
  ['res', 'Ressources', [
    ['res.food', 'Nourriture', 0, 100, 1], ['res.energy', 'Énergie', 0, 100, 1], ['res.raw', 'Matières premières', 0, 100, 1], ['res.strategic', 'Ressources stratégiques', 0, 100, 1],
  ]],
  ['pol', 'Politique intérieure', [
    ['politics.stability', 'Stabilité', 1, 100, 1], ['politics.cohesion', 'Cohésion nationale', 1, 100, 1], ['politics.trust', 'Confiance', 1, 100, 1], ['politics.admin', 'Efficacité administrative', 1, 100, 1],
  ]],
];

const get = (o, path) => path.split('.').reduce((x, k) => (x ? x[k] : undefined), o);
const set = (o, path, v) => { const ks = path.split('.'); const last = ks.pop(); ks.reduce((x, k) => x[k], o)[last] = v; };

/**
 * container : élément DOM ; ent : entité (pays) ; commit(fn) : applique une modification (annulable)
 */
export function renderProfileEditor(container, ent, commit, opts = {}) {
  const p = profileOf(ent, opts.geo || {});
  const open = renderProfileEditor.open || (renderProfileEditor.open = new Set(['eco']));
  const d = p.derived;
  const valueOf = (path) => (path === 'income' ? d.income : get(p, path));
  const field = ([path, label, min, max, step, unit]) => {
    const v = valueOf(path);
    const num = unit === 'bn' || unit === 'u';
    return `<div class="pf-field" data-path="${path}">
      <label><span>${label}</span>${num ? `<input type="number" class="pf-num" min="${min}" step="${step}" value="${Math.round(v * 10) / 10}">` : `<output>${unit === '%' ? String(Math.round(v * 10) / 10).replace('.', ',') + ' %' : Math.round(v)}</output>`}</label>
      ${num ? '' : `<input type="range" min="${min}" max="${max}" step="${step}" value="${v}">`}
    </div>`;
  };
  const kv = (label, value, cls = '') => `<div class="pf-kv ${cls}"><span>${label}</span><b>${value}</b></div>`;
  const persoOpts = Object.entries(PERSONALITIES).map(([k, x]) => `<option value="${k}" ${p.personality === k ? 'selected' : ''}>${x.label}</option>`).join('');
  const html = `
    <div class="pf-summary">
      ${kv('PIB', fmtBn(d.gdp))}${kv('PIB / habitant', fmtN(d.gdpPc) + ' $')}
      ${kv('Solde budgétaire', fmtBn(d.balance) + ' / an', d.balance < 0 ? 'neg' : 'pos')}${kv('Coût de l\'armée', fmtBn(d.upkeep) + ' / an')}
      ${kv('Soldats', fmtN(Math.round(d.soldiers)))}${kv('Mobilisables', fmtN(Math.round(d.manpower * 1000)))}
      ${kv('Puissance militaire', d.power + ' / 100')}${kv('Type d\'économie', ECONOMY_TYPES[d.economyType])}
    </div>
    ${d.warnings.length ? `<ul class="pf-warn">${d.warnings.map((w) => `<li>${esc(w)}</li>`).join('')}</ul>` : ''}
    <div class="pf-field"><label><span>Personnalité (IA)</span></label><select class="pf-perso">${persoOpts}</select><small class="hint">${esc(PERSONALITIES[p.personality].desc)}</small></div>
    <div class="pf-field" data-path="population"><label><span>Population</span><output>${fmtPop(p.population)}</output></label><input type="range" class="pf-pop" min="0" max="1" step="0.001" value="${popToSlider(p.population)}"></div>
    <div class="pf-field" data-path="popGrowth"><label><span>Croissance démographique</span><output>${String(p.popGrowth).replace('.', ',')} % / an</output></label><input type="range" min="-1" max="4" step="0.05" value="${p.popGrowth}"></div>
    ${SECTIONS.map(([key, label, fields]) => `
      <details class="pf-sec" data-sec="${key}" ${open.has(key) ? 'open' : ''}><summary>${label}</summary>
        ${fields.map(field).join('')}
        ${key === 'army' ? `<button class="btn ghost xs pf-fit">Adapter l'armée au budget militaire</button>` : ''}
      </details>`).join('')}`;
  container.innerHTML = html;
  container.querySelectorAll('details.pf-sec').forEach((dt) => dt.addEventListener('toggle', () => { if (dt.open) open.add(dt.dataset.sec); else open.delete(dt.dataset.sec); }));
  const apply = (fn) => commit((x) => {
    const q = profileOf(x, opts.geo || {});
    fn(q);
    recomputeProfile(q);
    x.population = q.population;
    x.stats = statsFromProfile(q, x.stats || {});
    x.unitsOverride = 0;
    delete q.derived;
    x.profile = q;
  });
  container.querySelector('.pf-perso').addEventListener('change', (e) => apply((q) => { q.personality = e.target.value; }));
  const pop = container.querySelector('.pf-pop');
  pop.addEventListener('input', () => { pop.previousElementSibling.querySelector('output').textContent = fmtPop(sliderToPop(Number(pop.value))); });
  pop.addEventListener('change', () => apply((q) => {
    // plus d'habitants : l'économie et le potentiel humain suivent ; l'armée reste la même
    q.population = sliderToPop(Number(pop.value));
  }));
  container.querySelectorAll('.pf-field[data-path]').forEach((f) => {
    const path = f.dataset.path;
    if (path === 'population') return;
    const range = f.querySelector('input[type=range]'), num = f.querySelector('.pf-num');
    const input = range || num;
    const out = f.querySelector('output');
    if (range && out) range.addEventListener('input', () => { out.textContent = path === 'milBudget' ? String(range.value).replace('.', ',') + ' %' : path === 'popGrowth' ? String(range.value).replace('.', ',') + ' % / an' : range.value; });
    if (num) num.addEventListener('keydown', (e) => e.stopPropagation());
    input.addEventListener('change', () => apply((q) => {
      const v = Math.max(0, Number(input.value));
      if (path === 'income') { const eco = economyOf(q); q.taxRate = Math.min(0.7, Math.max(0.02, v / Math.max(0.01, eco.gdp))); }
      else if (path === 'milBudget') { q.milBudget = v; scaleArmyToBudget(q); }
      else if (path === 'popGrowth') q.popGrowth = Number(input.value);
      else set(q, path, v);
      // liens : une meilleure technologie améliore aussi l'équipement ; des ports sont nécessaires à une marine
      if (path === 'tech') q.equip = Math.min(100, Math.max(q.equip, v * 0.7));
      if (path === 'army.navy' && v > 0 && q.infra.ports < 5) q.infra.ports = 10;
      if (path.startsWith('army.')) { const eco = economyOf(q); q.milBudget = Math.round(recomputeProfile(q).derived.upkeep / eco.gdp * 1000) / 10; }
    }));
  });
  const fit = container.querySelector('.pf-fit');
  if (fit) fit.addEventListener('click', () => apply((q) => { scaleArmyToBudget(q); }));
}
