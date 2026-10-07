// ORDRES DES JOUEURS — toute action d'un joueur qui modifie la simulation passe par un ordre sérialisable.
// En solo, l'ordre est exécuté immédiatement ; en multijoueur, il est transmis à l'hôte, daté d'un pas de
// simulation, puis exécuté au même pas sur tous les ordinateurs (simulation identique partout : lockstep).
import { sanction, liftSanction } from '../sim/crises.js';
import { computeEdit, applyEdit } from '../sim/borderEdit.js';
import { normalizeWarEnd } from '../sim/warEnd.js';

// méthodes de la Nation qu'un joueur peut déclencher (toujours dans son propre contexte)
export const NATION_COMMANDS = new Set([
  'propose', 'answerOffer', 'acceptCounter', 'counterPeace', 'startProject', 'cancelProject', 'choose', 'declareWar',
  'formCoalition', 'inviteToCoalition', 'leaveCoalitionP', 'coalitionOffensive', 'setCoalitionGoal', 'setWarGoals', 'log', 'milestone',
]);

const clone = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));

// vue de la nation pour l'interface d'un joueur : les méthodes qui modifient la partie deviennent des ordres
export function commandView(nation, k, sink) {
  const base = nation.at(k);
  return new Proxy(base, {
    get(t, prop) {
      if (typeof prop === 'string' && NATION_COMMANDS.has(prop)) return (...args) => sink({ op: 'n', a: k, m: prop, args: clone(args) });
      return t[prop];
    },
    set(t, prop, val) { t[prop] = val; return true; },
  });
}

// exécution d'un ordre (identique sur toutes les machines). hooks : effets d'affichage locaux.
export function execCommand(sim, cmd, hooks = {}) {
  if (!sim || !cmd) return null;
  const n = sim.nation;
  const a = cmd.a;
  const human = n && n.isHuman(a) && !sim.sides[a].eliminated;
  switch (cmd.op) {
    case 'n': {
      if (!human || !NATION_COMMANDS.has(cmd.m)) return null;
      const args = cmd.args || [];
      // un joueur n'agit que sur son propre pays
      if (['startProject', 'cancelProject'].includes(cmd.m) && args[0] !== a) return null;
      const v = n.at(a);
      return v[cmd.m](...args);
    }
    case 'policy': {
      if (!human) return null;
      const v = n.at(a), pol = v.policy, p = cmd.patch || {};
      for (const key of ['tax', 'services', 'milPct', 'family']) if (typeof p[key] === 'number' && Number.isFinite(p[key])) pol[key] = p[key];
      if (p.invest) pol.invest = { ...pol.invest, ...p.invest };
      if (p.stance) { pol.stance = p.stance; sim.sides[a].stance = p.stance; }
      if (cmd.text) v.milestone('decision', cmd.text);
      return true;
    }
    case 'sanction': {
      if (!human) return null;
      const ok = sanction(sim, a, cmd.to, 'décision de notre gouvernement');
      if (ok) { const v = n.at(a); v.log(cmd.to, 'player', 'Nous imposons des sanctions économiques à votre pays.', 'proposal'); if (!n.isHuman(cmd.to)) v.log(cmd.to, 'ai', 'Ces sanctions sont un acte hostile. Nous nous en souviendrons.', 'refuse'); v.milestone('diplo', `Sanctions contre ${sim.sides[cmd.to].name}.`); }
      return ok;
    }
    case 'unsanction': {
      if (!human) return null;
      const ok = liftSanction(sim, a, cmd.to, 'décision de notre gouvernement');
      if (ok) { const v = n.at(a); v.log(cmd.to, 'player', 'Nous levons nos sanctions.', 'proposal'); v.milestone('diplo', `Levée des sanctions contre ${sim.sides[cmd.to].name}.`); }
      return ok;
    }
    case 'border': {
      // crayon de frontières : réservé au Sandbox et à l'éditeur, jamais en Mode Nation (diplomatie ou guerre uniquement).
      // Les tracés des anciennes sauvegardes restent appliqués au chargement (sim.borderEdits).
      if (!human || n) return null;
      const e = computeEdit(sim, a, cmd.strokes || []);
      if (!e || !e.transfers.length) return null;
      const rec = applyEdit(sim, a, e, cmd.strokes, true);
      if (rec && hooks.onBorder) hooks.onBorder(e, a);
      return rec ? { gained: e.gained, lost: e.lost } : null;
    }
    case 'warEnd': {
      if (n && !n.isHuman(a)) return null;
      sim.cfg.warEnd = normalizeWarEnd(cmd.we, !!n);
      if (hooks.onWarEnd) hooks.onWarEnd(sim.cfg.warEnd);
      return true;
    }
    case 'join': {
      if (!n) return null;
      const ok = n.addHuman(cmd.k, cmd.name || null);
      if (hooks.onJoin) hooks.onJoin(cmd.k, ok);
      return ok;
    }
    case 'leave': {
      if (!n) return null;
      const ok = n.removeHuman(cmd.k);
      if (hooks.onLeave) hooks.onLeave(cmd.k, ok);
      return ok;
    }
    case 'rename': {
      // nom affiché d'un joueur (aucun effet sur la simulation)
      if (n && n.isHuman(cmd.k)) n.humans[cmd.k].pname = String(cmd.name || '').slice(0, 24);
      return true;
    }
    default: return null;
  }
}
