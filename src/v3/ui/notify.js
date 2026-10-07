// UI — NOTIFICATIONS : niveau choisi par le joueur, regroupement des notifications semblables, quantité
// réduite à vitesse élevée, et choix des événements qui mettent automatiquement le jeu en pause.
// Présentation uniquement : le journal garde tous les événements ; la simulation n'est jamais modifiée.

export const NOTIF_LEVELS = [
  { value: 'all', label: 'Toutes' },
  { value: 'important', label: 'Importantes' },
  { value: 'critical', label: 'Critiques' },
];
// événements pouvant mettre le jeu en pause (Mode Nation)
export const AUTO_PAUSE = [
  ['war', 'Déclaration de guerre contre vous ou vos alliés', true],
  ['decision', 'Décision du gouvernement à prendre', true],
  ['offer', 'Proposition diplomatique urgente (paix, aide, exigence)', true],
  ['warEnd', 'Fin d\'une guerre vous concernant', true],
  ['capital', 'Capitale prise (la vôtre ou celle d\'un ennemi)', false],
  ['formable', 'Proclamation d\'une nation', true],
  ['recap', 'Récapitulatif annuel', true],
];
export const defaultAutoPause = () => Object.fromEntries(AUTO_PAUSE.map(([k, , v]) => [k, v]));

const CRITICAL = ['DÉCLARATION DE GUERRE', 'CAPITALE PRISE', 'PAYS ÉLIMINÉ', 'ÉQUIPE VAINCUE', 'CAPITULATION PROPOSÉE', 'NATION PROCLAMÉE'];
const IMPORTANT = ['DÉCISION', 'PROPOSITION DIPLOMATIQUE', 'FIN DE LA GUERRE', 'PAIX', 'OBJECTIF ATTEINT', 'FIN DU SCÉNARIO', 'ÉVÉNEMENT RÉGIONAL', 'INTÉGRATION OFFICIELLE', 'DÉVELOPPEMENT', 'COALITION'];

// gravité d'un événement : 3 critique, 2 important, 1 information
export function severity(e, sim) {
  const mine = !!(sim && sim.nv && e.side === sim.nv.player);
  const t = String(e.title || '').toUpperCase();
  if (CRITICAL.some((x) => t.startsWith(x))) return mine || !sim || !sim.nv ? 3 : 2;
  if (e.manual || e.decision || (e.offer && e.urgent)) return 3;
  if (mine || e.nation || IMPORTANT.some((x) => t.startsWith(x))) return 2;
  return 1;
}

// faut-il afficher une notification ? (niveau choisi, vitesse, nombre de pays)
export function shouldToast(level, sev, speed, sides) {
  const min = level === 'critical' ? 3 : level === 'important' ? 2 : 1;
  if (sev < min) return false;
  // à vitesse élevée, moins de bruit : seules les notifications importantes restent
  if (speed >= 5 && sev < 2) return false;
  if (speed >= 10 && sev < 2 && sides > 6) return false;
  if (sev === 1 && speed > 2 && sides > 6) return false;
  return true;
}

// regroupement : une notification du même type arrivée récemment est fusionnée (compteur)
export class Grouper {
  constructor(windowMs = 4000) { this.windowMs = windowMs; this.recent = new Map(); }
  key(e) { return `${e.title}|${e.tone || ''}`; }
  // retourne { merge: élément existant } ou { merge: null }
  push(e, now, el = null) {
    const k = this.key(e);
    const r = this.recent.get(k);
    if (r && now - r.at < this.windowMs && r.el && r.el.isConnected !== false) { r.at = now; r.count++; return { merge: r.el, count: r.count }; }
    this.recent.set(k, { at: now, count: 1, el });
    if (this.recent.size > 40) for (const [kk, v] of this.recent) if (now - v.at > this.windowMs) this.recent.delete(kk);
    return { merge: null, count: 1 };
  }
  attach(e, el) { const r = this.recent.get(this.key(e)); if (r) r.el = el; }
}
