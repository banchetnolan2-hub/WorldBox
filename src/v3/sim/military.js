// ARMÉE DU JOUEUR — composition des forces, groupes d'armée et ordres des flottes (Mode Nation).
// • Composition : proportions d'infanterie, blindés, artillerie, reconnaissance, aviation et forces spéciales.
//   Effets réels : recrutement et reconversion progressive des unités, puissance selon le terrain, défense,
//   mobilité, consommation logistique, coût d'entretien (prix de chaque type), aviation, forces spéciales.
// • Groupes d'armée : nombre choisi par le joueur, affectation de chacun (défense de la capitale, réserve,
//   front contre un pays) : les forces sont réellement concentrées sur les fronts désignés.
// • Flottes : aller à une position, suivre des points de passage, patrouiller, escorter les convois,
//   rentrer au port.
// Tout est déterministe (aucun tirage hors du générateur de la partie) et ne concerne que les pays dirigés
// par un joueur : les pays de l'IA gardent exactement leur comportement.
import { LAND, refreshCombat, landTotal } from './economy.js';

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const COMP_KEYS = ['inf', 'arm', 'art', 'rec', 'air', 'sof'];
export const COMP_LABELS = {
  inf: { label: 'Infanterie', desc: 'Polyvalente, économique, la meilleure en montagne et en forêt.', icon: 'users' },
  arm: { label: 'Blindés', desc: 'Très efficaces en terrain ouvert ; coûteux, consomment beaucoup.', icon: 'shield' },
  art: { label: 'Artillerie', desc: 'Soutien puissant contre les fortifications ; logistique lourde.', icon: 'crosshair' },
  rec: { label: 'Reconnaissance', desc: 'Mobilité et renseignement ; peu de puissance de choc.', icon: 'compass' },
  air: { label: 'Aviation', desc: 'Grande puissance et frappes ; coûts très élevés.', icon: 'plane' },
  sof: { label: 'Forces spéciales', desc: 'Coups de main sur les poches isolées et près des capitales ; luttent contre les partisans.', icon: 'target' },
};

// composition actuelle (en %) déduite des forces du pays
export function currentComposition(sd) {
  const land = Math.max(1e-6, landTotal(sd));
  const air = Math.max(0, sd.air || 0) * 1.6;          // un avion pèse plus qu'une unité terrestre
  const sofShare = clamp((sd.sofComp || 0) / 2.2, 0, 0.5);
  const tot = (land + air) / (1 - sofShare);
  const c = { inf: sd.army.inf / tot, arm: sd.army.arm / tot, art: sd.army.art / tot, rec: sd.army.rec / tot, air: air / tot, sof: sofShare };
  return normalizeComposition(Object.fromEntries(COMP_KEYS.map((k) => [k, c[k] * 100])));
}
// proportions entières bornées, total 100
export function normalizeComposition(c) {
  const v = COMP_KEYS.map((k) => clamp(Math.round(Number(c && c[k]) || 0), 0, 80));
  let tot = v.reduce((a, b) => a + b, 0);
  if (tot <= 0) { v[0] = 100; tot = 100; }
  const out = v.map((x) => Math.floor((x / tot) * 100));
  let rest = 100 - out.reduce((a, b) => a + b, 0);
  for (let i = 0; rest > 0; i = (i + 1) % out.length) { if (v[i] > 0 || i === 0) { out[i]++; rest--; } }
  return Object.fromEntries(COMP_KEYS.map((k, i) => [k, out[i]]));
}
// effets d'une composition (par rapport à une armée « de référence »), lisibles par l'interface
export function compositionEffects(c) {
  const f = Object.fromEntries(COMP_KEYS.map((k) => [k, (c[k] || 0) / 100]));
  const landTot = Math.max(0.01, f.inf + f.arm + f.art + f.rec);
  const l = { inf: f.inf / landTot, arm: f.arm / landTot, art: f.art / landTot, rec: f.rec / landTot };
  return {
    logistics: clamp(1 + 1.5 * (l.art - 0.14) + 0.8 * (l.arm - 0.16) - 0.3 * (l.rec - 0.1) + 0.6 * (f.air - 0.06), 0.6, 1.9),
    mobility: clamp(1 + 0.7 * (l.rec - 0.1) + 0.35 * (l.arm - 0.16) - 0.3 * (l.art - 0.14), 0.7, 1.4),
    airShare: clamp(f.air / 0.06 - 1, -0.85, 2.5),
    sof: clamp(f.sof * 2.2, 0, 0.45),
    landShare: landTot,
  };
}

// application mensuelle (avant le mois du pays) : doctrine de recrutement, reconversion progressive, effets
export function applyComposition(sd, comp) {
  if (!comp) return;
  const c = normalizeComposition(comp);
  const fx = compositionEffects(c);
  const landTot = Math.max(1, c.inf + c.arm + c.art + c.rec);
  sd.doctrine = { inf: c.inf / landTot, arm: c.arm / landTot, art: c.art / landTot, rec: c.rec / landTot };
  // reconversion : 4 % de l'armée de terre par mois vers la composition voulue (le total ne change pas)
  const land = landTotal(sd);
  if (land > 0) for (const t of LAND) sd.army[t] = Math.max(0, sd.army[t] + (land * sd.doctrine[t] - sd.army[t]) * 0.04);
  sd.airShare = fx.airShare;
  sd.sofComp = fx.sof;
  sd.compLogK = fx.logistics;
  sd.compSpeedK = fx.mobility;
  refreshCombat(sd);
}

// ---------------- groupes d'armée ----------------
export const GROUP_TASKS = {
  auto: { label: 'Automatique', desc: 'L\'état-major répartit ce groupe selon la situation.' },
  capital: { label: 'Défense de la capitale', desc: 'Reste autour de la capitale ; défense renforcée dans sa région.' },
  reserve: { label: 'Réserve', desc: 'Renforce automatiquement le front le plus menacé (en recul).' },
  front: { label: 'Front', desc: 'Concentre ses forces sur le front contre le pays désigné.' },
};
export const MAX_GROUPS = 12;
export function normalizeGroups(g, S = 9999) {
  const count = clamp(Math.round(Number(g && g.count) || 0), 0, MAX_GROUPS);
  const list = [];
  for (let i = 0; i < count; i++) {
    const x = (g && g.list && g.list[i]) || {};
    const task = GROUP_TASKS[x.task] ? x.task : 'auto';
    const target = task === 'front' && Number.isInteger(x.target) && x.target >= 0 && x.target < S ? x.target : -1;
    list.push({ task: task === 'front' && target < 0 ? 'auto' : task, target, name: typeof x.name === 'string' ? x.name.slice(0, 24) : '' });
  }
  return { count, list };
}
// effets des affectations : poids des fronts, défense de la capitale, réserve
export function applyGroups(sd, groups) {
  if (!groups || !groups.count) { delete sd.groupPlan; delete sd.groupFocus; delete sd.capGuard; delete sd.reserveK; return; }
  sd.groupPlan = groups;
  const N = groups.count;
  const focus = {};
  let cap = 0, res = 0;
  for (const g of groups.list) {
    if (g.task === 'front') focus[g.target] = (focus[g.target] || 0) + 1;
    else if (g.task === 'capital') cap++;
    else if (g.task === 'reserve') res++;
  }
  for (const t of Object.keys(focus)) focus[t] = 1 + 2.2 * focus[t] / N;
  sd.groupFocus = focus;
  sd.capGuard = cap / N;
  sd.reserveK = 2 * res / N;
}
export const groupName = (g, i) => (g && g.name) || `${i + 1}${i === 0 ? 'er' : 'e'} groupe d'armée`;

// ---------------- flottes ----------------
export const FLEET_ORDERS = {
  auto: { label: 'Automatique', icon: 'compass', desc: 'Patrouille près des côtes ennemies en guerre, sinon le long des vôtres.' },
  goto: { label: 'Aller à une position', icon: 'map-pin', desc: 'Choisissez la destination sur la carte, puis la flotte y reste.' },
  waypoints: { label: 'Points de passage', icon: 'route', desc: 'Suit plusieurs points choisis sur la carte, dans l\'ordre.' },
  patrol: { label: 'Patrouille', icon: 'repeat', desc: 'Va et vient entre les points choisis (ou le long de vos côtes).' },
  escort: { label: 'Escorte de convois', icon: 'ship', desc: 'Accompagne vos transports de troupes : moins d\'interceptions.' },
  port: { label: 'Retour au port', icon: 'anchor', desc: 'Rentre au port le plus proche et y reste.' },
};
export function normalizeFleetOrder(o, n = 1e9) {
  const type = o && FLEET_ORDERS[o.type] ? o.type : 'auto';
  const pts = (o && Array.isArray(o.pts) ? o.pts : []).map(Number).filter((c) => Number.isInteger(c) && c >= 0 && c < n).slice(0, 8);
  if ((type === 'goto') && !pts.length) return { type: 'auto', pts: [] };
  if (type === 'waypoints' && !pts.length) return { type: 'auto', pts: [] };
  return { type, pts: type === 'goto' ? pts.slice(0, 1) : pts, i: 0 };
}
