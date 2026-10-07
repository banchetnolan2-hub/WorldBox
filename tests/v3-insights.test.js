// Tests TABLEAU DE BORD « MON PAYS », CONSEILLER et RÉCAPITULATIF ANNUEL :
// données complètes, alertes, diagnostics, explications des refus, bilans annuels,
// et surtout : ces analyses ne modifient JAMAIS la simulation (multijoueur / sauvegardes).
const { load, ok, mk, run, side, summary } = require('./v3-common.js');
const { m } = load();

const sim = mk('FR', { seed: 'INSIGHTS' });
const n = sim.nation, k = n.player;
run(sim, 121.67 * 1.2);

// 1. tableau de bord : tous les thèmes du cahier des charges
{
  const d = m.dashboard(sim, k, n);
  const themes = ['economy', 'population', 'stability', 'budget', 'resources', 'military', 'diplomacy', 'wars', 'research', 'production', 'logistics', 'territory', 'recent'];
  ok(themes.every((t) => d[t] !== undefined), `tableau de bord : ${themes.length} thèmes présents`);
  ok(d.economy.gdp > 1000 && d.population.pop > 5e7 && d.military.soldiers > 0 && d.territory.km2 > 1e5, `France : PIB ${Math.round(d.economy.gdp)} Md$, ${Math.round(d.population.pop / 1e6)} M hab., ${Math.round(d.military.soldiers)} soldats, ${Math.round(d.territory.km2)} km²`);
  const tones = themes.filter((t) => d[t].tone).map((t) => d[t].tone);
  ok(tones.every((t) => ['good', 'warn', 'bad'].includes(t)), `chaque thème a un état : ${tones.join(' ')}`);
  ok(d.military.powerRank >= 1 && d.economy.gdpRank >= 1 && d.economy.gdpRank <= 15, `rangs mondiaux : puissance n° ${d.military.powerRank}, PIB n° ${d.economy.gdpRank}`);
  ok(d.logistics.supply > 0 && d.logistics.supply <= 1.2, `ravitaillement estimé : ${(d.logistics.supply * 100).toFixed(0)} %`);
}

// 2. alertes : une situation dégradée produit des alertes classées par gravité
{
  const sd = sim.sides[k];
  const save = { debt: sd.debt, stab: sd.stability, readiness: sd.readiness, crisis: sd.crisis };
  sd.debt = sd.eco.gdp * 1.6; sd.stability = 0.25; sd.readiness = 0.4; sd.crisis = true;
  const al = m.alerts(sim, k, n);
  ok(al.length >= 3 && al[0].level === 3 && al.every((a, i) => i === 0 || al[i - 1].level >= a.level), `alertes triées : ${al.slice(0, 4).map((a) => a.level + ' ' + a.text).join(' | ')}`);
  ok(al.every((a) => typeof a.target === 'string'), 'chaque alerte indique le panneau où agir');
  Object.assign(sd, { debt: save.debt, stability: save.stab, readiness: save.readiness, crisis: save.crisis });
}

// 3. conseiller : causes et recommandations, sans jamais agir
{
  const sd = sim.sides[k];
  const foe = side(sim, 'Allemagne');
  const w = m.startWar(sim, [foe], [k], 'declaration');
  run(sim, sim.time + 15);
  ok(w && w.status === 'active', `guerre en cours : ${w && w.name}`);
  const topics = m.advise(sim, k, n);
  const ids = topics.map((t) => t.id);
  ok(['economy', 'army', 'supply', 'stability', 'diplomacy'].every((x) => ids.includes(x)), `conseiller : ${topics.map((t) => t.title + ' (' + t.state + ')').join(', ')}`);
  const army = topics.find((t) => t.id === 'army');
  ok(army.state !== 'good' && army.recs.length > 0, `en guerre, le conseiller donne des pistes militaires : ${army.recs.map((r) => r.text).slice(0, 2).join(' / ')}`);
  const eco = topics.find((t) => t.id === 'economy');
  ok(eco.causes.some((c) => /guerre/i.test(c)), `l'économie de guerre est identifiée comme cause : ${eco.causes[0]}`);
  ok(topics.every((t) => t.recs.every((r) => r.target)), 'chaque recommandation renvoie vers un panneau (le conseiller ne joue pas à la place du joueur)');
  void sd;
}

// 4. « pourquoi ce pays refuse » : refus expliqués à partir de l'analyse de l'IA
{
  const kp = side(sim, 'Corée du Nord');
  const r = n.propose(kp, 'alliance');
  const refs = m.recentRefusals(sim, n);
  const x = refs.find((y) => y.to === kp);
  ok(r.result !== 'accept' && x && x.reasons.length > 0, `refus expliqué : ${sim.sides[kp].name} / ${x && x.label} : ${x && x.reasons.join(', ')}`);
  const dip = m.advise(sim, k, n).find((t) => t.id === 'diplomacy');
  ok(dip.causes.some((c) => c.includes(sim.sides[kp].name)), `le conseiller reprend l'explication : ${dip.causes[0]}`);
}

// 5. récapitulatif annuel : évolution sur un an, faits marquants, compatibilité des anciens bilans
{
  run(sim, sim.time + 121.67 * 1.1);
  const rc = m.annualRecap(n, sim);
  ok(rc && rc.nextYear === rc.year + 1, `récapitulatif ${rc && rc.year} → ${rc && rc.nextYear}`);
  ok(rc.gdp.change !== null && rc.pop.change !== null && rc.territory.change !== null && rc.stability.change !== null, `PIB ${(rc.gdp.change * 100).toFixed(1)} %, population ${(rc.pop.change * 100).toFixed(2)} %, territoire ${rc.territory.change} ${rc.territory.unit}, stabilité ${rc.stability.change} pt`);
  ok(rc.losses !== null && rc.wars.active !== null && Array.isArray(rc.techs) && Array.isArray(rc.diplomacy.events), `pertes ${rc.losses}, guerres actives ${rc.wars.active}, technologies ${rc.techs.length}, faits diplomatiques ${rc.diplomacy.events.length}`);
  const old = { timeline: n.timeline.map(({ techs, losses, wars, air, navy, ...rest }) => rest), milestones: n.milestones, player: k };
  const rc2 = m.annualRecap(old, sim);
  ok(rc2 && rc2.losses === null && Array.isArray(rc2.techs), 'ancien bilan (sauvegarde précédente) : récapitulatif sans erreur, champs absents ignorés');
  ok(m.annualRecap({ timeline: [n.timeline[0]] }, sim) === null, 'pas de récapitulatif avant la fin de la première année');
}

// 6. LECTURE SEULE : appeler les analyses ne change pas la simulation (déterminisme, multijoueur)
{
  const a = mk('FR', { seed: 'RO' }), b = mk('FR', { seed: 'RO' });
  for (let s = 0; s < 1500; s++) {
    a.step(); b.step(); a.captures.length = b.captures.length = 0; a.eventsOut.length = b.eventsOut.length = 0;
    if (s % 37 === 0) { const kk = a.nation.player; m.dashboard(a, kk, a.nation); m.alerts(a, kk, a.nation); m.advise(a, kk, a.nation); m.annualRecap(a.nation, a); m.recentRefusals(a, a.nation); }
  }
  ok(m.stateHash(a) === m.stateHash(b) && a.rng.state === b.rng.state, `empreinte identique avec et sans analyses (${m.stateHash(a)})`);
  ok(JSON.stringify(a.nation.serialize()) === JSON.stringify(b.nation.serialize()), 'état de la nation identique (aucune écriture)');
}

// 7. sauvegarde : les bilans annuels enrichis sont conservés et la reprise reste exacte
{
  const snap = JSON.parse(JSON.stringify(sim.serialize()));
  const b = mk('FR', { seed: 'INSIGHTS' }, snap);
  ok(b.nation.timeline.length === n.timeline.length && JSON.stringify(b.nation.timeline.at(-1)) === JSON.stringify(n.timeline.at(-1)), 'bilans annuels identiques après rechargement');
  for (let s = 0; s < 600; s++) { sim.step(); b.step(); }
  ok(m.stateHash(sim) === m.stateHash(b), 'partie rechargée identique à l\'originale');
}
summary('Tableau de bord, conseiller, récapitulatif');
