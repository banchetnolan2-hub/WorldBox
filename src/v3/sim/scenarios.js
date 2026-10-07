// MODE HISTOIRE — scénarios jouables sur le moteur NATION SIMULATOR.
// Chaque scénario : un pays, une situation de départ, des objectifs vérifiés chaque mois,
// une durée et plusieurs fins (triomphe / succès / résultat mitigé / échec) selon les objectifs atteints.
// Les situations sont des mises en scène de jeu : elles modifient l'état initial de la simulation
// (dette, relations, dégâts, alliances), puis tout évolue librement selon les choix du joueur et des IA.
import { YEAR_SEC } from './calendar.js';
import { startWar, addRel } from './wars.js';
import { landTotal, refreshCombat } from './economy.js';
import { STORY } from './storyScenarios.js';

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const sideOfId = (sim, id) => sim.sides.findIndex((s) => sim.entities[s.e] && sim.entities[s.e].id === id);
const years = (sim, st) => (sim.time - (st.start || 0)) / YEAR_SEC;
const base = (n) => n.scenario.base || (n.scenario.base = {});
const ratio = (v, goal) => clamp(v / goal, 0, 1);
function snapshotBase(sim, k, n) {
  const sd = sim.sides[k];
  Object.assign(base(n), { allies: allies(sim, k), gdp: sd.eco.gdp, gdpBase: sd.gdpBase, debt: sd.debt, cells: sd.cells, tech: sd.p.tech, pop: sd.pop, infra: sd.p.infra.roads, stability: sd.p.politics.stability, soldiers: landTotal(sd) });
}
const tradeCount = (sim, k, n, filter = () => true) => Object.entries(n.deals).filter(([key, d]) => {
  if (!d.trade || d.bloc) return false;
  const [a, b] = key.split('-').map(Number);
  const o = a === k ? b : b === k ? a : -1;
  return o >= 0 && filter(o);
}).length;
const allies = (sim, k) => { let c = 0; for (let o = 0; o < sim.S; o++) if (o !== k && sim.allied[k * sim.S + o] && !sim.sides[o].eliminated) c++; return c; };
const debtRatio = (sd) => sd.debt / Math.max(0.1, sd.eco.gdp);
const gdpRank = (sim, k) => sim.sides.filter((s) => !s.eliminated).sort((a, b) => b.eco.gdp - a.eco.gdp).findIndex((s) => s.index === k) + 1;

// durée du scénario et objectifs « à tenir jusqu'à la fin » (pas atteints dès le départ par hasard)
const scYears = (sim, st) => { const sc = findScenario(st.id, sim.cfg.nation && sim.cfg.nation.scenarioSpec); return sc ? sc.years : 10; };
function holdToEnd(sim, st, cond, prog) {
  const t = ratio(years(sim, st), scYears(sim, st));
  return { progress: cond ? 0.4 + 0.6 * t : 0.4 * clamp(prog, 0, 1), done: cond && years(sim, st) >= scYears(sim, st) - 0.05 };
}
const newAllies = (sim, k, n) => allies(sim, k) - (base(n).allies || 0);

export const SCENARIOS = [
  {
    id: 'debt', cats: ['eco'], rules: { economy: true, debt: true, trade: true }, country: 'GR', title: 'La crise de la dette', icon: 'trending-down', years: 10, tag: 'Crise économique',
    desc: 'Les marchés ne prêtent plus. La dette publique dépasse largement le PIB, la trésorerie est vide et la population doute. Redressez les finances sans provoquer l\'effondrement social.',
    setup(sim, k, n) {
      const sd = sim.sides[k];
      sd.debt = Math.max(sd.debt, sd.eco.gdp * 1.75);
      sd.money = sd.eco.gdp * 0.003;
      sd.gdpBase *= 0.94;
      sd.p.politics.stability = clamp(sd.p.politics.stability - 14, 15, 99);
      sd.debtRatio0 = 1.6;
      snapshotBase(sim, k, n);
    },
    objectives: [
      { id: 'debt', text: 'Ramener la dette sous 110 % du PIB', check: (sim, k) => { const r = debtRatio(sim.sides[k]); return { progress: clamp((1.75 - r) / (1.75 - 1.1), 0, 1), done: r < 1.1 }; } },
      { id: 'gdp', text: 'Retrouver une économie supérieure de 15 % à celle du départ', check: (sim, k, n) => { const g = sim.sides[k].eco.gdp / base(n).gdp; return { progress: ratio(g - 1, 0.15), done: g >= 1.15 }; } },
      { id: 'stab', text: 'Maintenir une stabilité d\'au moins 60 % après 5 ans', check: (sim, k, n, st) => { const s = sim.sides[k].stability; return { progress: ratio(s, 0.6) * ratio(years(sim, st), 5), done: years(sim, st) >= 5 && s >= 0.6 }; } },
      { id: 'trade', text: 'Signer au moins 3 accords commerciaux', optional: true, check: (sim, k, n) => { const c = tradeCount(sim, k, n); return { progress: ratio(c, 3), done: c >= 3 }; } },
    ],
    fail: (sim, k) => sim.sides[k].stability < 0.22,
    endings: {
      triomphe: { title: 'Le miracle économique', text: 'Le pays a remboursé, s\'est modernisé et attire de nouveau les investisseurs. Votre gouvernement entre dans l\'histoire.' },
      succes: { title: 'Le redressement', text: 'Les finances sont assainies et l\'économie repart, même si tout n\'est pas réglé.' },
      mitige: { title: 'Une décennie difficile', text: 'Le pays a évité la faillite, mais la reprise reste fragile.' },
      echec: { title: 'La faillite', text: 'La dette a eu raison de la confiance. Le pays entre dans une longue période d\'instabilité.' },
    },
  },
  {
    id: 'tensions', cats: ['diplo', 'geo'], rules: { alliances: true, wars: true, relations: true, negotiations: true }, country: 'LT', title: 'Sous pression', icon: 'shield', years: 8, tag: 'Tensions diplomatiques',
    desc: 'Un grand voisin multiplie les démonstrations de force à vos frontières. Renforcez votre défense, trouvez des alliés et gardez votre territoire intact sans provoquer l\'escalade.',
    setup(sim, k, n) {
      const ru = sideOfId(sim, 'RU');
      if (ru >= 0) { addRel(sim, k, ru, -70); const a = sim.sides[ru].ai; if (a) a.personality = 'expansionist'; }
      snapshotBase(sim, k, n);
      base(n).rival = ru;
    },
    objectives: [
      { id: 'allies', text: 'Conclure au moins 2 nouvelles alliances', check: (sim, k, n) => { const c = newAllies(sim, k, n); return { progress: ratio(c, 2), done: c >= 2 }; } },
      { id: 'def', text: 'Consacrer au moins 2,5 % du PIB à la défense', check: (sim, k, n) => ({ progress: ratio(n.policy.milPct, 2.5), done: n.policy.milPct >= 2.5 && sim.time > 30 }) },
      { id: 'terr', text: 'Conserver tout le territoire national pendant 8 ans', check: (sim, k, n, st) => { if (sim.sides[k].cells < base(n).cells * 0.98) base(n).lost = true; if (base(n).lost) return { progress: 0, done: false, failed: true }; return { progress: ratio(years(sim, st), 8), done: years(sim, st) >= 7.95 }; } },
      { id: 'detente', text: 'Ramener les relations avec le voisin au-dessus de −20', optional: true, check: (sim, k, n) => { const o = base(n).rival; if (o < 0) return { progress: 1, done: true }; const r = sim.rel[k * sim.S + o]; return { progress: clamp((r + 70) / 50, 0, 1), done: r > -20 }; } },
    ],
    fail: (sim, k) => { const sd = sim.sides[k]; return sd.capital >= 0 && sim.owner[sd.capital] !== sd.e; },
    endings: {
      triomphe: { title: 'Le bastion', text: 'Allié, armé et respecté : votre pays a traversé la crise sans céder un mètre et a même apaisé les tensions.' },
      succes: { title: 'La dissuasion', text: 'Vos alliances et votre défense ont découragé toute agression.' },
      mitige: { title: 'Une paix armée', text: 'Le pays tient, mais la menace reste entière.' },
      echec: { title: 'L\'invasion', text: 'Isolé et mal préparé, le pays n\'a pas pu protéger son territoire.' },
    },
  },
  {
    id: 'rise', cats: ['dev'], rules: { techTree: true, ecoTech: true, economy: true }, country: 'VN', title: 'Le dragon émergent', icon: 'trending-up', years: 15, tag: 'Développement rapide',
    desc: 'Une population jeune, des usines qui s\'installent, des ports en plein essor. Faites de votre pays une puissance économique en une génération.',
    setup(sim, k, n) { snapshotBase(sim, k, n); },
    objectives: [
      { id: 'gdp', text: 'Doubler le PIB', check: (sim, k, n) => { const g = sim.sides[k].eco.gdp / base(n).gdp; return { progress: ratio(g - 1, 1), done: g >= 2 }; } },
      { id: 'proj', text: 'Achever 8 projets de développement', check: (sim, k) => { const c = sim.sides[k].dev.done.length; return { progress: ratio(c, 8), done: c >= 8 }; } },
      { id: 'tech', text: 'Gagner 10 points de technologie', check: (sim, k, n) => { const d = sim.sides[k].p.tech - base(n).tech; return { progress: ratio(d, 10), done: d >= 10 }; } },
      { id: 'peace', text: 'Ne mener aucune guerre', optional: true, check: (sim, k, n) => { const w = n.milestones.some((m) => m.type === 'war'); return { progress: w ? 0 : 1, done: false, failed: w }; } },
    ],
    endings: {
      triomphe: { title: 'Le nouveau tigre', text: 'Votre pays est devenu un modèle de développement, cité dans le monde entier.' },
      succes: { title: 'L\'émergence', text: 'Le pays a changé de dimension : il compte désormais parmi les économies qui montent.' },
      mitige: { title: 'Un élan freiné', text: 'Des progrès réels, mais la transformation reste inachevée.' },
      echec: { title: 'L\'occasion manquée', text: 'Le décollage n\'a pas eu lieu.' },
    },
  },
  {
    id: 'regional', cats: ['survie'], rules: { wars: true, peace: true, alliances: true, negotiations: true }, country: 'EC', title: 'Conflit frontalier', icon: 'swords', years: 8, tag: 'Conflit régional',
    desc: 'Un différend frontalier dégénère : votre voisin du sud lance une offensive. Défendez le pays, obtenez la paix, puis reconstruisez.',
    setup(sim, k, n) {
      snapshotBase(sim, k, n);
      const pe = sideOfId(sim, 'PE');
      base(n).rival = pe;
      // mobilisation générale : réservistes rappelés, positions défensives préparées
      const sd = sim.sides[k];
      for (const t of ['inf', 'art']) sd.army[t] *= 1.35;
      sd.devFort = (sd.devFort || 0) + 0.4;
      sd.readiness = Math.min(1, sd.readiness + 0.1);
      n.policy.stance = 'defensive';
      n.policy.milPct = Math.round((n.policy.milPct + 1.2) * 100) / 100;
      refreshCombat(sd);
      if (pe >= 0) { addRel(sim, k, pe, -60); if (startWar(sim, [pe], [k], 'declaration')) n.milestone('war', `${sim.sides[pe].name} attaque notre pays.`); }
    },
    objectives: [
      { id: 'hold', text: 'Ne pas perdre plus de 10 % du territoire', check: (sim, k, n) => { if (sim.sides[k].cells / base(n).cells < 0.9) base(n).lost = true; if (base(n).lost) return { progress: 0, done: false, failed: true }; return { progress: 1, done: !sim.isAtWar(k) && sim.time > 40 }; } },
      { id: 'peace', text: 'Obtenir la paix', check: (sim, k, n) => { const ok = n.milestones.some((m) => m.type === 'treaty') || (sim.time > 40 && !sim.isAtWar(k)); return { progress: ok ? 1 : 0, done: ok }; } },
      { id: 'rebuild', text: 'Dépasser le PIB d\'avant-guerre de 10 %', check: (sim, k, n) => { const g = sim.sides[k].eco.gdp / base(n).gdp; return { progress: ratio(g - 0.9, 0.2), done: g >= 1.1 && !sim.isAtWar(k) }; } },
      { id: 'friend', text: 'Rétablir des relations positives avec l\'ancien adversaire', optional: true, check: (sim, k, n) => { const o = base(n).rival; if (o < 0) return { progress: 1, done: true }; const r = sim.rel[k * sim.S + o]; return { progress: clamp((r + 60) / 60, 0, 1), done: r > 0 && !sim.isAtWar(k) }; } },
    ],
    fail: (sim, k, n) => sim.sides[k].cells < base(n).cells * 0.6,
    endings: {
      triomphe: { title: 'La paix des braves', text: 'Le pays a résisté, signé une paix honorable et noué une nouvelle amitié avec son ancien adversaire.' },
      succes: { title: 'La frontière tenue', text: 'L\'agression a été repoussée et le pays se reconstruit.' },
      mitige: { title: 'Une paix fragile', text: 'Le conflit s\'est arrêté, mais ses blessures restent ouvertes.' },
      echec: { title: 'La défaite', text: 'Le pays a perdu la guerre et une partie de son territoire.' },
    },
  },
  {
    id: 'rebuild', cats: ['dev', 'survie'], rules: { techTree: true, ecoTech: true, economy: true }, country: 'IQ', title: 'Reconstruire la nation', icon: 'shovel', years: 12, tag: 'Reconstruction',
    desc: 'Des années d\'instabilité ont laissé routes, réseaux et institutions en ruine. Reconstruisez les infrastructures, relancez l\'économie et rendez confiance à la population.',
    setup(sim, k, n) {
      const sd = sim.sides[k];
      for (const key of ['roads', 'rail', 'airports', 'cities']) sd.p.infra[key] = clamp(sd.p.infra[key] * 0.55, 5, 100);
      sd.infraDamage = 0.25;
      sd.gdpBase *= 0.85;
      sd.p.politics.stability = clamp(sd.p.politics.stability - 12, 12, 99);
      refreshCombat(sd);
      snapshotBase(sim, k, n);
    },
    objectives: [
      { id: 'infra', text: 'Porter le réseau routier à 60', check: (sim, k) => { const v = sim.sides[k].p.infra.roads; return { progress: ratio(v, 60), done: v >= 60 }; } },
      { id: 'gdp', text: 'Augmenter le PIB de 40 %', check: (sim, k, n) => { const g = sim.sides[k].eco.gdp / base(n).gdp; return { progress: ratio(g - 1, 0.4), done: g >= 1.4 }; } },
      { id: 'stab', text: 'Stabilité d\'au moins 65 % à la fin du scénario', check: (sim, k, n, st) => { const s = sim.sides[k].stability; return holdToEnd(sim, st, s >= 0.65, s / 0.65); } },
      { id: 'edu', text: 'Achever le projet « Universités »', optional: true, check: (sim, k) => { const d = sim.sides[k].dev.done.includes('edu3'); return { progress: d ? 1 : sim.sides[k].dev.done.filter((x) => x.startsWith('edu')).length / 3, done: d }; } },
    ],
    fail: (sim, k) => sim.sides[k].stability < 0.2,
    endings: {
      triomphe: { title: 'La renaissance', text: 'Le pays est méconnaissable : moderne, stable et tourné vers l\'avenir.' },
      succes: { title: 'Le retour à la normale', text: 'Les infrastructures sont rebâties et l\'économie fonctionne de nouveau.' },
      mitige: { title: 'Un chantier inachevé', text: 'Des progrès visibles, mais la reconstruction prendra encore des années.' },
      echec: { title: 'Le pays à l\'arrêt', text: 'La reconstruction n\'a pas pris ; l\'instabilité persiste.' },
    },
  },
  {
    id: 'tech', cats: ['dev', 'tech'], rules: { techTree: true, research: true, ecoTech: true }, country: 'IN', title: 'L\'essor technologique', icon: 'brain', years: 20, tag: 'Montée technologique',
    desc: 'Votre pays forme des millions d\'ingénieurs. Transformez ce potentiel en leadership technologique mondial.',
    setup(sim, k, n) { snapshotBase(sim, k, n); },
    objectives: [
      { id: 'tech', text: 'Gagner 15 points de technologie', check: (sim, k, n) => { const d = sim.sides[k].p.tech - base(n).tech; return { progress: ratio(d, 15), done: d >= 15 }; } },
      { id: 'center', text: 'Achever le « Centre de recherche national »', check: (sim, k) => { const dn = sim.sides[k].dev.done; return { progress: dn.includes('tech4') ? 1 : dn.filter((x) => x.startsWith('tech')).length / 4, done: dn.includes('tech4') }; } },
      { id: 'eco', text: 'Atteindre l\'« Économie technologique »', check: (sim, k) => { const dn = sim.sides[k].dev.done; return { progress: dn.includes('eco4') ? 1 : dn.filter((x) => x.startsWith('eco')).length / 4, done: dn.includes('eco4') }; } },
      { id: 'rank', text: 'Entrer dans le top 3 des économies mondiales', optional: true, check: (sim, k) => { const r = gdpRank(sim, k); return { progress: clamp(1 - (r - 3) / 10, 0, 1), done: r <= 3 }; } },
    ],
    endings: {
      triomphe: { title: 'La superpuissance du savoir', text: 'Votre pays est devenu une référence mondiale de l\'innovation.' },
      succes: { title: 'Le pôle d\'innovation', text: 'Recherche et industrie de pointe transforment l\'économie.' },
      mitige: { title: 'Des îlots d\'excellence', text: 'Quelques réussites brillantes, mais l\'ensemble du pays n\'a pas suivi.' },
      echec: { title: 'La fuite des cerveaux', text: 'Les talents sont partis à l\'étranger.' },
    },
  },
  {
    id: 'blocs', cats: ['geo', 'alt'], rules: { alliances: true, treaties: true, trade: true, relations: true }, country: 'BR', title: 'Le monde des deux blocs', icon: 'globe', years: 15, tag: 'Géopolitique fictive',
    desc: 'Scénario fictif : le monde se divise en deux grandes alliances rivales. Restez en paix, commercez avec les deux camps et devenez la puissance d\'équilibre.',
    setup(sim, k, n) {
      const west = ['US', 'GB', 'FR', 'DE', 'JP', 'CA', 'IT', 'AU'].map((id) => sideOfId(sim, id)).filter((x) => x >= 0 && x !== k);
      const east = ['CN', 'RU', 'IR', 'KP', 'BY', 'PK'].map((id) => sideOfId(sim, id)).filter((x) => x >= 0 && x !== k);
      const S = sim.S;
      for (const g of [west, east]) for (const a of g) for (const b of g) if (a !== b) { sim.allied[a * S + b] = 1; addRel(sim, a, b, 15); }
      for (const a of west) for (const b of east) addRel(sim, a, b, -35);
      sim.chron('alliance', 'Le monde se divise en deux blocs rivaux.', { e: [] });
      snapshotBase(sim, k, n);
      Object.assign(base(n), { west, east });
    },
    objectives: [
      { id: 'peace', text: 'Ne participer à aucune guerre pendant 15 ans', check: (sim, k, n, st) => { const w = n.milestones.some((m) => m.type === 'war'); if (w) return { progress: 0, done: false, failed: true }; return { progress: ratio(years(sim, st), 15), done: years(sim, st) >= 14.95 }; } },
      { id: 'tradeW', text: 'Signer 2 accords commerciaux avec le premier bloc', check: (sim, k, n) => { const c = tradeCount(sim, k, n, (o) => base(n).west.includes(o)); return { progress: ratio(c, 2), done: c >= 2 }; } },
      { id: 'tradeE', text: 'Signer 2 accords commerciaux avec le second bloc', check: (sim, k, n) => { const c = tradeCount(sim, k, n, (o) => base(n).east.includes(o)); return { progress: ratio(c, 2), done: c >= 2 }; } },
      { id: 'rank', text: 'Entrer dans le top 6 des économies mondiales', optional: true, check: (sim, k) => { const r = gdpRank(sim, k); return { progress: clamp(1 - (r - 6) / 10, 0, 1), done: r <= 6 }; } },
    ],
    endings: {
      triomphe: { title: 'L\'arbitre du monde', text: 'Courtisé par les deux blocs, votre pays est devenu la puissance d\'équilibre de la planète.' },
      succes: { title: 'La voie indépendante', text: 'Le pays a su rester neutre et prospère.' },
      mitige: { title: 'Entre deux feux', text: 'La neutralité a été préservée, au prix d\'occasions manquées.' },
      echec: { title: 'Aspiré dans la rivalité', text: 'Le pays n\'a pas su rester à l\'écart des tensions mondiales.' },
    },
  },
];

// ---------------- scénarios créés par le joueur ----------------
export const SCENARIO_CATS = [
  ['eco', 'Économie', 'coins'], ['diplo', 'Diplomatie', 'handshake'], ['dev', 'Développement', 'trending-up'],
  ['tech', 'Technologie', 'cpu'], ['geo', 'Géopolitique', 'globe'], ['survie', 'Survie', 'shield'], ['villes', 'Villes', 'building-2'],
  ['alt', 'Monde alternatif', 'sparkles'], ['crises', 'Crises', 'siren'], ['chaos', 'Chaos', 'flame'], ['mine', 'Mes scénarios', 'pencil'],
];
// objectifs disponibles dans l'éditeur : texte, valeur par défaut, bornes, vérification
export const OBJECTIVE_TEMPLATES = {
  gdp: { label: 'Multiplier le PIB', unit: '×', def: 1.5, min: 1.05, max: 4, step: 0.05, text: (v) => `Multiplier le PIB par ${String(v).replace('.', ',')}`,
    check: (sim, k, n, st, v) => { const g = sim.sides[k].eco.gdp / base(n).gdp; return { progress: ratio(g - 1, v - 1), done: g >= v }; } },
  debt: { label: 'Dette maximale', unit: '% du PIB', def: 90, min: 10, max: 200, step: 5, text: (v) => `Dette sous ${v} % du PIB à la fin du scénario`,
    check: (sim, k, n, st, v) => { const r = debtRatio(sim.sides[k]) * 100; const r0 = Math.max(v + 1, (base(n).debt / Math.max(0.1, base(n).gdp)) * 100); return holdToEnd(sim, st, r <= v, (r0 - r) / Math.max(1, r0 - v)); } },
  stability: { label: 'Stabilité', unit: '%', def: 70, min: 30, max: 95, step: 5, text: (v) => `Stabilité d'au moins ${v} % à la fin du scénario`,
    check: (sim, k, n, st, v) => { const s = sim.sides[k].stability * 100; return holdToEnd(sim, st, s >= v, s / v); } },
  tech: { label: 'Progrès technologique', unit: 'points', def: 8, min: 1, max: 30, step: 1, text: (v) => `Gagner ${v} points de technologie`,
    check: (sim, k, n, st, v) => { const d = sim.sides[k].p.tech - base(n).tech; return { progress: ratio(d, v), done: d >= v }; } },
  projects: { label: 'Projets achevés', unit: 'projets', def: 6, min: 1, max: 26, step: 1, text: (v) => `Achever ${v} projets de développement`,
    check: (sim, k, n, st, v) => { const c = sim.sides[k].dev.done.length; return { progress: ratio(c, v), done: c >= v }; } },
  alliances: { label: 'Nouvelles alliances', unit: 'alliances', def: 2, min: 1, max: 10, step: 1, text: (v) => `Conclure ${v} nouvelle${v > 1 ? 's' : ''} alliance${v > 1 ? 's' : ''}`,
    check: (sim, k, n, st, v) => { const c = newAllies(sim, k, n); return { progress: ratio(c, v), done: c >= v }; } },
  trade: { label: 'Accords commerciaux', unit: 'accords', def: 3, min: 1, max: 15, step: 1, text: (v) => `Signer ${v} accord${v > 1 ? 's' : ''} commercia${v > 1 ? 'ux' : 'l'}`,
    check: (sim, k, n, st, v) => { const c = tradeCount(sim, k, n); return { progress: ratio(c, v), done: c >= v }; } },
  territory: { label: 'Territoire préservé', unit: '% de pertes max.', def: 5, min: 0, max: 50, step: 1, text: (v) => `Ne pas perdre plus de ${v} % du territoire`,
    check: (sim, k, n, st, v) => { if (sim.sides[k].cells < base(n).cells * (1 - v / 100 - 0.01)) base(n).lostT = true; if (base(n).lostT) return { progress: 0, done: false, failed: true }; const sc = findScenario(st.id, sim.cfg.nation && sim.cfg.nation.scenarioSpec); return { progress: ratio(years(sim, st), sc ? sc.years : 10), done: years(sim, st) >= (sc ? sc.years : 10) - 0.05 }; } },
  peace: { label: 'Paix durable', unit: '', def: 0, min: 0, max: 0, step: 1, text: () => 'Ne participer à aucune guerre',
    check: (sim, k, n, st) => { if (n.milestones.some((m) => m.type === 'war')) return { progress: 0, done: false, failed: true }; const sc = findScenario(st.id, sim.cfg.nation && sim.cfg.nation.scenarioSpec); return { progress: ratio(years(sim, st), sc ? sc.years : 10), done: years(sim, st) >= (sc ? sc.years : 10) - 0.05 }; } },
  pop: { label: 'Croissance démographique', unit: '%', def: 5, min: 1, max: 60, step: 1, text: (v) => `Faire croître la population de ${v} %`,
    check: (sim, k, n, st, v) => { const g = (sim.sides[k].pop / base(n).pop - 1) * 100; return { progress: ratio(g, v), done: g >= v }; } },
  infra: { label: 'Infrastructures', unit: 'points', def: 15, min: 2, max: 60, step: 1, text: (v) => `Améliorer le réseau routier de ${v} points`,
    check: (sim, k, n, st, v) => { const d = sim.sides[k].p.infra.roads - base(n).infra; return { progress: ratio(d, v), done: d >= v }; } },
  techLevel: { label: 'Niveau technologique', unit: '/ 100', def: 80, min: 20, max: 100, step: 1, text: (v) => `Atteindre un niveau technologique de ${v}`,
    check: (sim, k, n, st, v) => { const t = sim.sides[k].p.tech; return { progress: ratio(t, v), done: t >= v }; } },
  army: { label: 'Armée', unit: '×', def: 1.5, min: 1.1, max: 5, step: 0.1, text: (v) => `Multiplier les effectifs militaires par ${String(v).replace('.', ',')}`,
    check: (sim, k, n, st, v) => { const r = landTotal(sim.sides[k]) / Math.max(1, base(n).soldiers); return { progress: ratio(r - 1, v - 1), done: r >= v }; } },
  gain: { label: 'Expansion territoriale', unit: '%', def: 10, min: 1, max: 200, step: 1, text: (v) => `Agrandir le territoire de ${v} %`,
    check: (sim, k, n, st, v) => { const g = (sim.sides[k].cells / base(n).cells - 1) * 100; return { progress: ratio(g, v), done: g >= v }; } },
  money: { label: 'Trésorerie', unit: '% du PIB', def: 5, min: 1, max: 40, step: 1, text: (v) => `Trésorerie d'au moins ${v} % du PIB à la fin du scénario`,
    check: (sim, k, n, st, v) => { const r = sim.sides[k].money / Math.max(0.1, sim.sides[k].eco.gdp) * 100; return holdToEnd(sim, st, r >= v, r / v); } },
  relation: { label: 'Relations avec un pays', unit: '', def: 40, min: -50, max: 100, step: 5, text: (v, t) => `Porter les relations avec ${t || 'le pays cible'} à ${v}`, needsTarget: true,
    check: (sim, k, n, st, v, t) => { const o = sideOfId(sim, t); if (o < 0) return { progress: 1, done: true }; const r = sim.rel[k * sim.S + o]; return { progress: clamp((r + 100) / (v + 100), 0, 1), done: r >= v }; } },
  survive: { label: 'Tenir la capitale', unit: '', def: 0, min: 0, max: 0, step: 1, text: () => 'Garder la capitale jusqu\'à la fin',
    check: (sim, k, n, st) => { const sd = sim.sides[k]; if (sd.capital >= 0 && sim.owner[sd.capital] !== sd.e) return { progress: 0, done: false, failed: true }; const sc = findScenario(st.id, sim.cfg.nation && sim.cfg.nation.scenarioSpec); return { progress: ratio(years(sim, st), sc ? sc.years : 10), done: years(sim, st) >= (sc ? sc.years : 10) - 0.05 }; } },
  rank: { label: 'Rang économique mondial', unit: 'e place', def: 10, min: 1, max: 50, step: 1, text: (v) => (v === 1 ? 'Être la première économie mondiale à la fin du scénario' : `Être dans le top ${v} des économies mondiales à la fin du scénario`),
    check: (sim, k, n, st, v) => { const r = gdpRank(sim, k); return holdToEnd(sim, st, r <= v, 1 - (r - v) / 20); } },
};
// scénario jouable à partir de la description enregistrée par l'éditeur
// ---------------- moteur de scénarios décrits par des données ----------------
// spec : { id, title, desc, cats, country, years, difficulty, icon, tag,
//   start: { debt, money, gdp, stability, infra, tech, army, rival, rivalRel, war, allies: [ids], hostile: [ids],
//            personalities: { ID: 'expansionist' }, aiWars: [[a, b], ...], blocs: [[ids], ...], relAll },
//   objectives: [{ type, value, target, main, optional, secret }],
//   fails: [{ type: 'stability' | 'capital' | 'territory' | 'debt' | 'war' | 'relation', value, target }],
//   events: [{ at: années, title, text, fx: { gdp, stability, debt, money, tech, infra, army, relAll, ... }, rel: { ID: Δ }, war: 'ID' }],
//   rules, endWin, endLose }
const FAIL_TEMPLATES = {
  stability: { text: (v) => `La stabilité tombe sous ${v} %`, check: (sim, k, n, st, v) => sim.sides[k].stability * 100 < v },
  capital: { text: () => 'La capitale est prise', check: (sim, k) => { const sd = sim.sides[k]; return sd.capital >= 0 && sim.owner[sd.capital] !== sd.e; } },
  territory: { text: (v) => `Plus de ${v} % du territoire est perdu`, check: (sim, k, n, st, v) => sim.sides[k].cells < base(n).cells * (1 - v / 100) },
  debt: { text: (v) => `La dette dépasse ${v} % du PIB`, check: (sim, k, n, st, v) => debtRatio(sim.sides[k]) * 100 > v },
  war: { text: () => 'Le pays entre en guerre', check: (sim, k) => sim.isAtWar(k) },
  relation: { text: (v, t) => `Les relations avec ${t} tombent sous ${v}`, check: (sim, k, n, st, v, t) => { const o = sideOfId(sim, t); return o >= 0 && sim.rel[k * sim.S + o] < v; } },
};
// effets prêts à l'emploi pour les événements créés dans l'éditeur
export const EVENT_PRESETS = {
  ecoDown: { label: 'Choc économique (PIB −6 %)', fx: { gdp: -0.06 }, tone: 'bad' },
  ecoUp: { label: 'Embellie économique (PIB +5 %)', fx: { gdp: 0.05 }, tone: 'good' },
  unrest: { label: 'Troubles sociaux (stabilité −8)', fx: { stability: -8 }, tone: 'bad' },
  unity: { label: 'Union nationale (stabilité +6)', fx: { stability: 6 }, tone: 'good' },
  debt: { label: 'Dette imprévue (+10 % du PIB)', fx: { debt: 0.1 }, tone: 'bad' },
  tech: { label: 'Percée technologique (+3)', fx: { tech: 3 }, tone: 'good' },
  isolation: { label: 'Isolement diplomatique (relations −15)', fx: { relAll: -15 }, tone: 'bad' },
  rivalWar: { label: 'Le rival déclare la guerre', fx: null, war: true, tone: 'bad' },
};
export const FAIL_TYPES = { stability: 'Stabilité minimale (%)', capital: 'Perte de la capitale', territory: 'Territoire perdu (%)', debt: 'Dette maximale (% du PIB)', war: 'Entrée en guerre' };
export function buildScenario(spec, custom = false) {
  const st0 = spec.start || {};
  const fails = (spec.fails || []).filter((f) => FAIL_TEMPLATES[f.type]);
  const nameOf = (sim, id) => { const o = sideOfId(sim, id); return o >= 0 ? sim.sides[o].name : id; };
  return {
    id: spec.id, custom, cats: custom ? ['mine', ...(spec.cats || [])] : spec.cats || [], rules: spec.rules || {}, country: spec.country,
    title: spec.title || 'Scénario sans titre', icon: spec.icon || (custom ? 'pencil' : 'book-marked'), tag: spec.tag || (custom ? 'Mon scénario' : 'Scénario'),
    years: spec.years || 10, desc: spec.desc || '', difficulty: spec.difficulty || null, spec,
    failTexts: fails.map((f) => FAIL_TEMPLATES[f.type].text(f.value, f.target)),
    eventCount: (spec.events || []).length,
    setup(sim, k, n) {
      const sd = sim.sides[k], S = sim.S;
      if (st0.debt != null) sd.debt = sd.eco.gdp * st0.debt / 100;
      if (st0.gdp) sd.gdpBase *= 1 + st0.gdp / 100;
      if (st0.stability) sd.p.politics.stability = clamp(sd.p.politics.stability + st0.stability, 5, 99);
      if (st0.infra) for (const key of ['roads', 'rail', 'airports']) sd.p.infra[key] = clamp(sd.p.infra[key] * (1 + st0.infra / 100), 2, 100);
      if (st0.tech) sd.p.tech = clamp(sd.p.tech + st0.tech, 1, 100);
      if (st0.army) for (const t of ['inf', 'arm', 'art', 'rec']) if (sd.army && sd.army[t] !== undefined) sd.army[t] *= 1 + st0.army / 100;
      if (st0.money != null) sd.money = sd.eco.gdp * st0.money / 100;
      if (st0.relAll) for (let o = 0; o < S; o++) if (o !== k) addRel(sim, k, o, st0.relAll);
      refreshCombat(sd);
      for (const [id, pers] of Object.entries(st0.personalities || {})) { const o = sideOfId(sim, id); if (o >= 0 && sim.sides[o].ai) sim.sides[o].ai.personality = pers; }
      const ally = (a, b) => { if (a < 0 || b < 0 || a === b || sim.rules.alliances === false) return; sim.allied[a * S + b] = sim.allied[b * S + a] = 1; addRel(sim, a, b, 20); };
      for (const id of st0.allies || []) ally(k, sideOfId(sim, id));
      for (const bloc of st0.blocs || []) { const ids = bloc.map((id) => (id === '@' ? k : sideOfId(sim, id))).filter((x) => x >= 0); for (const a of ids) for (const b of ids) if (a < b) ally(a, b); }
      for (const id of st0.hostile || []) { const o = sideOfId(sim, id); if (o >= 0) addRel(sim, k, o, -60); }
      for (const [a, b] of st0.aiWars || []) { const x = sideOfId(sim, a), y = sideOfId(sim, b); if (x >= 0 && y >= 0 && x !== y) startWar(sim, [x], [y], 'declaration'); }
      snapshotBase(sim, k, n);
      const rv = st0.rival ? sideOfId(sim, st0.rival) : -1;
      base(n).rival = rv;
      if (rv >= 0 && rv !== k) {
        if (st0.rivalRel != null) addRel(sim, k, rv, st0.rivalRel - sim.rel[k * sim.S + rv]);
        if (st0.war && startWar(sim, [rv], [k], 'declaration')) { n.milestone('war', `${sim.sides[rv].name} attaque notre pays.`); }
      }
    },
    // événements propres au scénario (déclenchés à date fixe) et conditions d'échec
    tick(sim, k, n, st, applyFx) {
      const yrs = years(sim, st);
      st.ev = st.ev || {};
      (spec.events || []).forEach((e, i) => {
        if (st.ev[i] || yrs < e.at) return;
        st.ev[i] = Math.round(sim.time);
        const pre = e.preset && EVENT_PRESETS[e.preset];
        const fx = e.fx || (pre && pre.fx);
        if (fx && applyFx) applyFx(sim, k, fx, n);
        if (pre && pre.war && st0.rival) { const o = sideOfId(sim, st0.rival); if (o >= 0 && o !== k && !sim.atWar[k * sim.S + o]) startWar(sim, [o], [k], 'declaration'); }
        for (const [id, d] of Object.entries(e.rel || {})) { const o = sideOfId(sim, id); if (o >= 0) addRel(sim, k, o, d); }
        if (e.war) { const o = sideOfId(sim, e.war); if (o >= 0 && o !== k && !sim.atWar[k * sim.S + o]) startWar(sim, [o], [k], 'declaration'); }
        n.milestone('event', `${e.title || 'Événement'} : ${e.text || ''}`);
        sim._emit({ icon: '📜', title: (e.title || 'Événement').toUpperCase(), tone: e.tone || (pre && pre.tone) || 'neutral', side: k, text: e.text, nation: true, important: true });
      });
    },
    fail: fails.length ? (sim, k, n, st) => fails.some((f) => FAIL_TEMPLATES[f.type].check(sim, k, n, st, f.value, f.target) && ((st.failWhy = FAIL_TEMPLATES[f.type].text(f.value, f.target ? nameOf(sim, f.target) : '')), true)) : null,
    objectives: (spec.objectives || []).filter((o) => OBJECTIVE_TEMPLATES[o.type]).map((o, i) => {
      const T = OBJECTIVE_TEMPLATES[o.type];
      return { id: 'o' + i, text: T.text(o.value, o.target), main: !!o.main, optional: !!o.optional, secret: !!o.secret, check: (sim, k, n, st) => T.check(sim, k, n, st, o.value, o.target) };
    }),
    endings: {
      triomphe: { title: spec.winTitle || 'Triomphe', text: spec.endWin || 'Tous les objectifs sont atteints : votre pays entre dans l\'histoire.' },
      succes: { title: 'Succès', text: spec.endOk || 'L\'essentiel des objectifs est atteint.' },
      mitige: { title: 'Résultat mitigé', text: spec.endMid || 'Des progrès, mais le pays n\'a pas atteint tous ses objectifs.' },
      echec: { title: spec.loseTitle || 'Échec', text: spec.endLose || 'Les objectifs n\'ont pas été atteints.' },
    },
  };
}
export const scenarioFromSpec = (spec) => buildScenario(spec, true);
export function findScenario(id, spec = null) {
  if (!id) return null;
  if (spec && spec.id === id) return scenarioFromSpec(spec);
  return SCENARIOS.find((x) => x.id === id) || null;
}

// scénarios d'origine : objectif principal = le premier ; difficulté conseillée
const BUILTIN_DIFF = { debt: 'hard', tensions: 'normal', rise: 'normal', regional: 'hard', rebuild: 'expert', tech: 'normal', blocs: 'expert' };
for (const sc of SCENARIOS) { if (sc.objectives[0] && !sc.objectives.some((o) => o.main)) sc.objectives[0].main = true; if (!sc.difficulty) sc.difficulty = BUILTIN_DIFF[sc.id] || 'normal'; }
// scénarios du Story Mode décrits par des données
SCENARIOS.push(...STORY.map((x) => buildScenario(x)));
export const SCENARIO_BY_ID = Object.fromEntries(SCENARIOS.map((s) => [s.id, s]));
