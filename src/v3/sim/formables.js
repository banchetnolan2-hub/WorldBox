// NATIONS FORMABLES — 32 nations qui peuvent naître pendant la partie, et celles créées par le joueur (éditeur).
// Trois façons de former une nation :
//  • par CONQUÊTE : contrôler l'essentiel du territoire d'origine des pays membres (et la capitale désignée) ;
//  • par la DIPLOMATIE : intégration volontaire et VOTE des États membres (à la manière d'une construction
//    européenne) — les pays qui votent oui rejoignent la nouvelle nation, les autres restent indépendants ;
//  • par l'UNION D'ALLIÉS : plusieurs pays alliés décident de fusionner.
// Les IA forment aussi des nations quand les conditions sont réunies. La formation déclenche une proclamation.
// Déterministe : décisions et votes sans tirage hors du générateur de la partie ; état sauvegardé (sim.formed).
import { PERSONALITIES } from './profile.js';
import { powerOf } from './ai.js';
import { addRel } from './wars.js';
import { blocsOf } from './geopolitics.js';
import { YEAR_SEC } from './calendar.js';

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const F = (id, name, members, capital, color, flag, need = 0.75, methods = ['conquest', 'vote', 'union'], desc = '') => ({ id, name, members, capital, color, flag: { layout: flag[0], colors: flag.slice(1) }, need, methods, desc });

export const FORMABLES = [
  F('eufed', 'Fédération européenne', ['FR', 'DE', 'IT', 'ES', 'PT', 'NL', 'BE', 'LU', 'AT', 'IE', 'DK', 'FI', 'SE', 'PL', 'CZ', 'SK', 'HU', 'SI', 'HR', 'RO', 'BG', 'GR', 'EE', 'LV', 'LT', 'CY', 'MT'], 'BE', '#2c4a9a', ['star', '#1f3f99', '#f5c400'], 0.7, ['vote', 'union', 'conquest'], 'Les États européens s\'unissent dans une fédération.'),
  F('benelux', 'Union du Benelux', ['BE', 'NL', 'LU'], 'BE', '#d9822b', ['h3', '#d9822b', '#ffffff', '#1f4fa0']),
  F('nordic', 'Union nordique', ['SE', 'NO', 'DK', 'FI', 'IS'], 'SE', '#2f6fb1', ['cross', '#2f6fb1', '#f5c400']),
  F('iberia', 'Union ibérique', ['ES', 'PT'], 'ES', '#b8322f', ['v2', '#1f6b35', '#c8102e']),
  F('danube', 'Union danubienne', ['AT', 'HU', 'SI'], 'AT', '#c9a227', ['h2', '#111111', '#f5c400']),
  F('czsk', 'Tchécoslovaquie', ['CZ', 'SK'], 'CZ', '#1f5fa8', ['diag', '#ffffff', '#d7141a', '#11457e']),
  F('commonwealth', 'République des Deux Nations', ['PL', 'LT', 'LV'], 'PL', '#b2253c', ['h2', '#ffffff', '#b2253c']),
  F('baltic', 'Union baltique', ['EE', 'LV', 'LT'], 'LV', '#3a7d44', ['h3', '#0072ce', '#000000', '#ffffff']),
  F('romania', 'Grande Roumanie', ['RO', 'MD'], 'RO', '#2155a3', ['v3', '#002b7f', '#fcd116', '#ce1126']),
  F('yugo', 'Yougoslavie', ['SI', 'HR', 'BA', 'RS', 'ME', 'MK', 'XK'], 'RS', '#335c99', ['h3', '#003893', '#ffffff', '#de0000']),
  F('caucasus', 'Fédération transcaucasienne', ['GE', 'AM', 'AZ'], 'GE', '#8e3b46', ['h3', '#da291c', '#0033a0', '#f2a800']),
  F('turkestan', 'Union d\'Asie centrale', ['KZ', 'UZ', 'KG', 'TJ', 'TM'], 'KZ', '#1d9bb2', ['h3', '#00afca', '#fec50c', '#1eb53a']),
  F('maghreb', 'Union du Maghreb', ['MA', 'DZ', 'TN', 'LY', 'MR'], 'DZ', '#2e7d4f', ['v2', '#006233', '#ffffff']),
  F('uar', 'République arabe unie', ['EG', 'SY'], 'EG', '#a83232', ['h3', '#ce1126', '#ffffff', '#000000']),
  F('gulf', 'Union arabe du Golfe', ['SA', 'AE', 'QA', 'KW', 'BH', 'OM'], 'SA', '#1f7a4a', ['h2', '#006c35', '#ffffff']),
  F('korea', 'Corée unifiée', ['KR', 'KP'], 'KR', '#2a5daf', ['circle', '#ffffff', '#0047a0', '#cd2e3a']),
  F('mekong', 'Fédération du Mékong', ['VN', 'LA', 'KH'], 'VN', '#c0392b', ['star', '#da251d', '#ffcd00']),
  F('maphilindo', 'Maphilindo', ['MY', 'ID', 'PH'], 'ID', '#cc3b3b', ['h2', '#ce1126', '#ffffff']),
  F('australasia', 'Fédération australasienne', ['AU', 'NZ'], 'AU', '#1f3f7a', ['star', '#012169', '#ffffff']),
  F('melanesia', 'Union mélanésienne', ['PG', 'SB', 'VU', 'FJ', 'NC'], 'PG', '#3b8a5a', ['diag', '#000000', '#ce1126', '#fcd116']),
  F('northam', 'Union nord-américaine', ['US', 'CA', 'MX'], 'US', '#3a4f8a', ['h3', '#3c3b6e', '#ffffff', '#b22234'], 0.75, ['vote', 'union', 'conquest']),
  F('centam', 'Provinces-Unies d\'Amérique centrale', ['GT', 'HN', 'SV', 'NI', 'CR'], 'GT', '#2a6cb3', ['h3', '#0f47af', '#ffffff', '#0f47af']),
  F('colombia', 'Grande Colombie', ['CO', 'VE', 'EC', 'PA'], 'CO', '#d8a41a', ['h3', '#fcd116', '#003893', '#ce1126']),
  F('plata', 'Provinces-Unies du Río de la Plata', ['AR', 'UY', 'PY'], 'AR', '#6fa8dc', ['h3', '#74acdf', '#ffffff', '#74acdf']),
  F('perubol', 'Confédération péruano-bolivienne', ['PE', 'BO'], 'PE', '#b22d2d', ['v3', '#d91023', '#ffffff', '#d91023']),
  F('unasur', 'Union sud-américaine', ['BR', 'AR', 'CL', 'CO', 'PE', 'VE', 'EC', 'BO', 'PY', 'UY', 'GY', 'SR'], 'BR', '#2b8a3e', ['circle', '#009c3b', '#ffdf00', '#002776'], 0.7, ['vote', 'union', 'conquest']),
  F('westindies', 'Fédération des Indes occidentales', ['JM', 'TT', 'BB', 'BS', 'LC', 'VC', 'GD', 'AG', 'DM', 'KN', 'PR'], 'TT', '#1f6fb0', ['h3', '#00267f', '#ffc726', '#00267f']),
  F('eac', 'Fédération d\'Afrique de l\'Est', ['KE', 'TZ', 'UG', 'RW', 'BI', 'SS'], 'KE', '#2f7d3b', ['h3', '#000000', '#bb0000', '#006600']),
  F('sahel', 'Confédération du Sahel', ['ML', 'BF', 'NE'], 'ML', '#c88b1a', ['v3', '#14b53a', '#fcd116', '#ce1126']),
  F('somalia', 'Somalie unifiée', ['SO', 'XS', 'DJ'], 'SO', '#4189dd', ['star', '#4189dd', '#ffffff']),
  F('sadc', 'Union d\'Afrique australe', ['ZA', 'NA', 'BW', 'LS', 'SZ', 'ZW', 'MZ'], 'ZA', '#2b7a4b', ['h3', '#007a4d', '#ffb612', '#de3831']),
  F('usafrica', 'États-Unis d\'Afrique', ['NG', 'ET', 'EG', 'CD', 'ZA', 'KE', 'TZ', 'DZ', 'SD', 'MA', 'GH', 'CI', 'CM', 'AO', 'SN', 'ML', 'NE', 'TD', 'UG', 'ZM', 'ZW', 'MZ'], 'ET', '#3d7a2f', ['star', '#078930', '#fcdd09'], 0.65, ['vote', 'union'], 'Le rêve panafricain : une union politique du continent.'),
];
export const FORMABLE_BY_ID = Object.fromEntries(FORMABLES.map((f) => [f.id, f]));
export const METHODS = { conquest: 'Conquête', vote: 'Vote des États membres', union: 'Union d\'alliés' };

// formables de la partie : liste de base + nations créées dans l'éditeur (options de la partie)
export function allFormables(sim) { return [...FORMABLES, ...((sim.cfg && sim.cfg.customFormables) || []).map(normalizeFormable).filter(Boolean)]; }
export function normalizeFormable(f) {
  if (!f || !f.name || !Array.isArray(f.members) || f.members.length < 2) return null;
  const methods = (f.methods || ['conquest', 'vote', 'union']).filter((m) => METHODS[m]);
  return { id: String(f.id || 'custom-' + f.name).slice(0, 40), name: String(f.name).slice(0, 40), members: f.members.map(String).slice(0, 40), capital: String(f.capital || f.members[0]), color: /^#[0-9a-f]{6}$/i.test(f.color || '') ? f.color : '#8a6bd1', flag: f.flag && f.flag.layout ? f.flag : { layout: 'h2', colors: [f.color || '#8a6bd1', '#ffffff'] }, need: clamp(Number(f.need) || 0.75, 0.4, 1), methods: methods.length ? methods : ['conquest'], desc: String(f.desc || '').slice(0, 200), custom: true };
}
const byId = (sim, id) => allFormables(sim).find((f) => f.id === id) || null;

// pays membres présents dans la partie : { side, e, alive }
export function membersOf(sim, f) {
  const out = [];
  for (const id of f.members) {
    const e = sim.entities.findIndex((x) => x && x.id === id);
    if (e < 0) continue;
    const k = sim.sideOf[e];
    if (k < 0) continue;
    out.push({ id, e, k, alive: !sim.sides[k].eliminated });
  }
  return out;
}
// part du territoire d'origine des membres contrôlée par le pays k, et contrôle de la capitale désignée
export function conquestProgress(sim, f, k) {
  const mem = membersOf(sim, f);
  const set = new Set(mem.map((x) => x.e));
  const ke = sim.sides[k].e;
  let tot = 0, mine = 0;
  for (let i = 0; i < sim.n; i++) if (set.has(sim.origin[i])) { tot++; if (sim.owner[i] === ke) mine++; }
  const cm = mem.find((x) => x.id === f.capital);
  const cache = sim._fcap || (sim._fcap = {});
  const capCell = cm ? (cache[cm.e] ?? (cache[cm.e] = findOriginCapital(sim, cm.e))) : -1;
  return { share: tot ? mine / tot : 0, capital: capCell >= 0 && sim.owner[capCell] === ke, total: tot };
}
function findOriginCapital(sim, e) {
  const ent = sim.entities[e];
  if (!ent || !ent.capital) return -1;
  const g = sim.grid, t = Math.PI / 180;
  const cx = Math.cos(ent.capital.lat * t) * Math.sin(ent.capital.lon * t), cy = Math.sin(ent.capital.lat * t), cz = Math.cos(ent.capital.lat * t) * Math.cos(ent.capital.lon * t);
  let best = -1, bd = -2;
  for (let i = 0; i < sim.n; i++) if (sim.origin[i] === e) { const d = g.xyz[i * 3] * cx + g.xyz[i * 3 + 1] * cy + g.xyz[i * 3 + 2] * cz; if (d > bd) { bd = d; best = i; } }
  return best;
}
export function isFormed(sim, id) { return (sim.formed || []).some((x) => x.id === id); }
export function formedBy(sim, k) { return (sim.formed || []).find((x) => x.side === k) || null; }

// conditions d'une méthode pour le pays k (fondateur) ; { ok, why }
export function canForm(sim, id, k, method) {
  const f = byId(sim, id);
  if (!f) return { ok: false, why: 'Nation inconnue.' };
  if (isFormed(sim, id)) return { ok: false, why: 'Cette nation existe déjà.' };
  if (formedBy(sim, k)) return { ok: false, why: 'Votre pays a déjà formé une nation.' };
  if (!f.methods.includes(method)) return { ok: false, why: `${f.name} ne peut pas être formée par ${METHODS[method].toLowerCase()}.` };
  const mem = membersOf(sim, f);
  if (!mem.some((x) => x.k === k)) return { ok: false, why: `Seul un pays membre (${f.members.join(', ')}) peut fonder ${f.name}.` };
  if (method === 'conquest') {
    const p = conquestProgress(sim, f, k);
    if (p.share < f.need) return { ok: false, why: `Il faut contrôler ${Math.round(f.need * 100)} % du territoire des pays membres (actuellement ${Math.round(p.share * 100)} %).`, progress: p };
    if (!p.capital) return { ok: false, why: 'Il faut contrôler la capitale désignée.', progress: p };
    return { ok: true, progress: p };
  }
  const others = mem.filter((x) => x.alive && x.k !== k);
  if (!others.length) return { ok: false, why: 'Aucun autre pays membre à convaincre.' };
  if (others.some((x) => sim.atWar[k * sim.S + x.k])) return { ok: false, why: 'Impossible en guerre contre un pays membre.' };
  if (method === 'union') {
    const allies = others.filter((x) => sim.allied[k * sim.S + x.k]);
    if (!allies.length) return { ok: false, why: 'L\'union d\'alliés nécessite au moins un allié parmi les pays membres.' };
  }
  return { ok: true };
}

// position d'un pays membre m face à l'adhésion (vote ou union) proposée par k : score et facteurs
export function memberStance(sim, f, k, m, method) {
  const S = sim.S, M = sim.sides[m];
  const P = PERSONALITIES[(M.ai && M.ai.personality) || 'opportunist'];
  const rel = sim.rel[m * S + k];
  const fs = [];
  const add = (label, v) => { if (Math.abs(v) >= 0.02) fs.push({ label, v: Math.round(v * 100) / 100 }); };
  add(`Relations avec le fondateur (${Math.round(rel)})`, clamp(rel / 100, -1, 0.6));
  add('Alliés', sim.allied[m * S + k] ? 0.35 : 0);
  const ent = sim.entities[M.e], fe = sim.entities[sim.sides[k].e];
  const shared = ent && fe ? blocsOf(ent.id).filter((b) => blocsOf(fe.id).some((x) => x.id === b.id)).length : 0;
  add('Organisations communes', Math.min(0.45, shared * 0.2));
  add('Perte de souveraineté', method === 'union' ? -0.75 : -0.95);
  add(`Personnalité : ${P.label}`, (P.ally - 1) * 0.5 - (M.ai && M.ai.personality === 'isolationist' ? 0.7 : 0) + (M.ai && M.ai.personality === 'diplomatic' ? 0.15 : 0));
  const ratio = powerOf(sim.sides[k]) / Math.max(1e-6, powerOf(M));
  add('Protection d\'un ensemble plus puissant', ratio > 3 ? 0.2 : 0);
  if (M.stability < 0.4) add('Instabilité intérieure', 0.2);
  if (M.crisis) add('Crise économique', 0.25);
  const threat = M.ai && M.ai.analysis ? M.ai.analysis.threat || 0 : 0;
  add('Menace extérieure', clamp(threat - 0.4, 0, 0.6) * 0.5);
  let score = 0.15;
  for (const x of fs) score += x.v;
  return { score: Math.round(score * 100) / 100, yes: score > 0.25, factors: fs.sort((a, b) => Math.abs(b.v) - Math.abs(a.v)) };
}

// vote des États membres (méthode « vote ») ou décision des alliés (méthode « union ») ; humains : leur choix
// humanVotes : { [side]: true|false } réponses des autres joueurs (multijoueur)
export function tally(sim, id, k, method, humanVotes = {}) {
  const f = byId(sim, id);
  const mem = membersOf(sim, f).filter((x) => x.alive && x.k !== k && (method !== 'union' || sim.allied[k * sim.S + x.k]));
  const votes = mem.map((x) => {
    const human = sim.nation && sim.nation.isHuman(x.k);
    if (human) return { k: x.k, name: sim.sides[x.k].name, yes: humanVotes[x.k] === true, human: true, pending: humanVotes[x.k] === undefined, factors: [] };
    const st = memberStance(sim, f, k, x.k, method);
    return { k: x.k, name: sim.sides[x.k].name, yes: st.yes, score: st.score, factors: st.factors };
  });
  const yes = votes.filter((v) => v.yes);
  const popAll = mem.reduce((t, x) => t + sim.sides[x.k].pop, sim.sides[k].pop), popYes = yes.reduce((t, v) => t + sim.sides[v.k].pop, sim.sides[k].pop);
  // vote : majorité des deux tiers des États (fondateur compris) ET plus de la moitié de la population ; union : au moins un allié
  const passed = method === 'union' ? yes.length > 0 : (yes.length + 1) >= Math.ceil((mem.length + 1) * 2 / 3) && popYes > popAll * 0.5;
  return { votes, passed, yes: yes.length + 1, total: mem.length + 1, popShare: popYes / Math.max(1, popAll) };
}

// FORMATION : la nation est proclamée par le pays k ; les pays membres qui ont accepté (vote / union) la rejoignent
export function formNation(sim, id, k, method, humanVotes = {}) {
  const f = byId(sim, id);
  const c = canForm(sim, id, k, method);
  if (!c.ok) return { ok: false, text: c.why };
  let joined = [];
  if (method !== 'conquest') {
    const t = tally(sim, id, k, method, humanVotes);
    if (!t.passed) return { ok: false, text: method === 'union' ? 'Aucun allié n\'accepte de fusionner pour le moment.' : `Le vote échoue : ${t.yes} État(s) sur ${t.total} favorables (${Math.round(t.popShare * 100)} % de la population). Il faut les deux tiers des États et plus de la moitié de la population.`, tally: t };
    joined = t.votes.filter((v) => v.yes).map((v) => v.k);
    const ke = sim.sides[k].e;
    for (const m of joined) {
      const me = sim.sides[m].e;
      for (let i = 0; i < sim.n; i++) if (sim.owner[i] === me) sim.flip(i, ke, false);
      sim.sides[k].money += sim.sides[m].money; sim.sides[k].debt += sim.sides[m].debt;
      sim.sides[m].money = 0; sim.sides[m].debt = 0;
    }
  }
  const sd = sim.sides[k], ent = sim.entities[sd.e];
  const rec = { id: f.id, side: k, e: sd.e, t: Math.round(sim.time), method, joined, name: f.name, color: f.color, flag: f.flag, orig: { name: ent.name, colorOverride: ent.colorOverride || null, customFlag: ent.customFlag || null } };
  (sim.formed || (sim.formed = [])).push(rec);
  applyFormedIdentity(sim, rec);
  sd.p.politics.stability = clamp(sd.p.politics.stability + 6, 1, 99);
  sd.stability = Math.min(1, sd.stability + 0.05);
  for (let o = 0; o < sim.S; o++) if (o !== k && !sim.sides[o].eliminated && (sim.contact[k * sim.S + o] || sim.nearCap[k * sim.S + o])) addRel(sim, k, o, method === 'conquest' ? -6 : -2);
  sim.chron('creation', `Proclamation de ${f.name} par ${rec.orig.name}${joined.length ? ` (rejoint par ${joined.map((m) => sim.sides[m].name).join(', ')})` : ''}.`, { e: [sd.e, ...joined.map((m) => sim.sides[m].e)] });
  sim.hist(k, 'creation', `Proclamation de ${f.name}.`);
  if (sim.nation && sim.nation.isHuman(k)) sim.nation.at(k).milestone('objective', `Proclamation de ${f.name}.`);
  sim._emit({ icon: '👑', title: 'NATION PROCLAMÉE', tone: 'good', side: k, text: `${rec.orig.name} proclame ${f.name}.`, formable: f.id, proclamation: true, cell: sd.capital });
  return { ok: true, joined, name: f.name };
}
// identité de la nation formée (nom, couleur, drapeau) appliquée au pays ; restaurée en fin de partie
export function applyFormedIdentity(sim, rec) {
  const sd = sim.sides[rec.side], ent = sim.entities[rec.e];
  if (!sd || !ent) return;
  ent.name = rec.name; ent.colorOverride = rec.color; ent.customFlag = rec.flag;
  sd.name = rec.name;
}
export function revertFormedIdentities(sim) {
  for (const rec of [...(sim.formed || [])].reverse()) {
    const ent = sim.entities[rec.e];
    if (!ent || !rec.orig) continue;
    ent.name = rec.orig.name; ent.colorOverride = rec.orig.colorOverride || undefined; ent.customFlag = rec.orig.customFlag || undefined;
  }
}

// IA : chaque année, un pays dirigé par l'IA qui remplit les conditions peut former une nation
export function aiFormables(sim) {
  if (!sim.nation || sim.rules.diplomacy === false) return;
  for (let k = 0; k < sim.S; k++) {
    const sd = sim.sides[k];
    if (sd.eliminated || sd.player || !sd.ai || formedBy(sim, k)) continue;
    for (const f of allFormables(sim)) {
      if (isFormed(sim, f.id) || !f.members.includes((sim.entities[sd.e] || {}).id)) continue;
      if (f.methods.includes('conquest') && canForm(sim, f.id, k, 'conquest').ok) { formNation(sim, f.id, k, 'conquest'); break; }
      // union entre alliés très proches, rarement (tirage sur le générateur de la partie)
      if (f.methods.includes('union') && f.members.length <= 5 && sim.rng.next() < 0.01 && canForm(sim, f.id, k, 'union').ok) {
        const t = tally(sim, f.id, k, 'union');
        if (t.passed && t.votes.length && t.votes.every((v) => !v.human && v.yes && v.score > 0.6)) { formNation(sim, f.id, k, 'union'); break; }
      }
    }
  }
}
export const FORMABLE_CHECK_EVERY = YEAR_SEC;
