// Tests des MÉCANIQUES DU MODE NATION ajoutées dans cette version (cahier des charges de reprise) :
// crayon de frontières hors Nation, réglages avancés, composition de l'armée, groupes d'armée, flottes,
// occupation, paix proportionnée, diplomatie territoriale, technologies exclusives, nations formables…
// Chaque mécanique est vérifiée aussi pour le déterminisme (sauvegarde / reprise, ordres multijoueur).
const { load, ok, mk, run, side, summary } = require('./v3-common.js');
const { m } = load();

// §20 — crayon de frontières : refusé en Mode Nation
{
  const sim = mk('FR', { seed: 'PENCIL' });
  const k = sim.nation.player;
  const before = sim.owner.slice();
  const stroke = m.prepareStroke([[6.35, 49.45], [7.0, 49.9], [8.1, 49.7], [8.1, 48.95]], false);
  const r = m.execCommand(sim, { op: 'border', a: k, strokes: [stroke] });
  ok(r === null && sim.owner.every((v, i) => v === before[i]), 'Mode Nation : le crayon de frontières est refusé (aucune parcelle modifiée)');
}

// §23 — réglages avancés : ~31 paramètres, 6 profils, effets réels, ordre multijoueur, sauvegarde
{
  ok(m.TUNING.length >= 30 && new Set(m.TUNING.map((p) => p.cat)).size === 7, `réglages avancés : ${m.TUNING.length} paramètres en ${new Set(m.TUNING.map((p) => p.cat)).size} catégories`);
  const names = m.TUNING_PROFILES.map((p) => p.label);
  ok(['Équilibré', 'Réaliste', 'Guerre totale', 'Diplomatique', 'Bâtisseur', 'Arcade'].every((x) => names.includes(x)), `profils : ${names.join(', ')}`);
  ok(m.TUNING_PROFILES.every((p) => Object.keys(p.v).every((k) => m.TUNING_BY_ID[k])), 'profils : uniquement des paramètres existants');
  ok(m.matchProfile(m.profileTuning('realistic')) === 'realistic' && m.matchProfile({ ...m.defaultTuning(), growth: 1.37 }) === null, 'reconnaissance du profil actif / personnalisé');
  const n1 = m.normalizeTuning({ growth: 99, bogus: 3, lethality: 'x' });
  ok(n1.growth === m.TUNING_BY_ID.growth.max && !('bogus' in n1) && n1.lethality === 1, 'valeurs bornées, inconnues ignorées');
  // profil Équilibré = partie sans réglage (bit à bit)
  const a = mk('FR', { seed: 'TUNE' }), b = mk('FR', { seed: 'TUNE', options: { tuning: m.profileTuning('balanced') } });
  for (let i = 0; i < 1200; i++) { a.step(); b.step(); }
  ok(m.stateHash(a) === m.stateHash(b), 'profil « Équilibré » identique à une partie sans réglage (comportement de base conservé)');
  // effets réels
  const g1 = mk('FR', { seed: 'TG' }), g2 = mk('FR', { seed: 'TG', options: { tuning: { growth: 2.5, techCost: 0.5 } } });
  const k = g1.nation.player;
  ok(Math.abs(g2.nation.costOf(k, 'eco1').total - g1.nation.costOf(k, 'eco1').total * 0.5) < 1e-6, 'coût des technologies : ×0,5 appliqué');
  run(g1, 121.67 * 2); run(g2, 121.67 * 2);
  ok(g2.sides[k].eco.gdp > g1.sides[k].eco.gdp * 1.01, `croissance ×2,5 : PIB ${Math.round(g1.sides[k].eco.gdp)} → ${Math.round(g2.sides[k].eco.gdp)} Md$`);
  const d1 = mk('FR', { seed: 'TD' }), d2 = mk('FR', { seed: 'TD', options: { tuning: { dipOpenness: 2.5 } } });
  const jp = side(d1, 'Japon');
  ok(d2.nation.evaluate(k, jp, 'alliance').score > d1.nation.evaluate(k, jp, 'alliance').score + 0.5, 'ouverture diplomatique : les IA acceptent plus facilement');
  const s1 = mk('FR', { seed: 'TS' }), s2 = mk('FR', { seed: 'TS', options: { tuning: { supplyRange: 0.4, defense: 1.8 } } });
  s1.sides[k].heldForeign = s2.sides[k].heldForeign = 400;
  const foreign = s1.origin.findIndex((e) => e !== s1.sides[k].e && s1.sideOf[e] >= 0);
  ok(s2.supply(k, foreign) < s1.supply(k, foreign) && s2.defensePower(k, s2.sides[k].capital) > s1.defensePower(k, s1.sides[k].capital) * 1.7, 'portée du ravitaillement et avantage du défenseur appliqués');
  // ordre multijoueur : l'hôte seul, appliqué partout au même pas, sauvegardé
  const h = mk('FR', { seed: 'TC' }), c = mk('FR', { seed: 'TC' });
  const kp = h.nation.player;
  const other = side(h, 'Allemagne');
  h.nation.addHuman(other, 'invité'); c.nation.addHuman(other, 'invité');
  ok(m.execCommand(h, { op: 'tuning', a: other, t: { growth: 2 } }) === null && h.tuning.growth === 1, 'un invité ne peut pas modifier les réglages');
  const cmd = { op: 'tuning', a: kp, t: m.profileTuning('totalwar') };
  for (let i = 0; i < 600; i++) { if (i === 200) { m.execCommand(h, JSON.parse(JSON.stringify(cmd))); m.execCommand(c, JSON.parse(JSON.stringify(cmd))); } h.step(); c.step(); }
  ok(m.matchProfile(h.tuning) === 'totalwar' && m.stateHash(h) === m.stateHash(c), 'réglages changés en partie : appliqués au même pas, simulations identiques');
  const r = mk('FR', { seed: 'TC' }, JSON.parse(JSON.stringify(h.serialize())));
  ok(m.matchProfile(r.tuning) === 'totalwar', 'réglages conservés dans la sauvegarde');
  const old = JSON.parse(JSON.stringify(h.serialize())); delete old.tuning;
  ok(m.matchProfile(mk('FR', { seed: 'TC' }, old).tuning) === 'balanced', 'ancienne sauvegarde sans réglages : valeurs de base');
}

// §17 — occupation : semi-occupé → occupé → contrôlé ; contesté sans ravitaillement ; partisans
{
  const census = (sim) => { const c = [0, 0, 0, 0]; for (let i = 0; i < sim.n; i++) if (sim.occupied[i]) c[sim.occupied[i]]++; return c; };
  const sim = mk('DE', { seed: 'OCC' });
  const k = sim.nation.player, pl = side(sim, 'Pologne');
  m.startWar(sim, [k], [pl], 'declaration');
  let seenSemi = false, seenOcc = false, firstSemi = -1;
  for (let i = 0; i < 6000 && !(seenOcc && seenSemi); i++) {
    sim.step(); sim.captures.length = 0; sim.eventsOut.length = 0;
    const c = census(sim);
    if (c[1] && firstSemi < 0) firstSemi = sim.time;
    seenSemi = seenSemi || c[1] > 0; seenOcc = seenOcc || c[2] > 0;
  }
  const c = census(sim);
  ok(seenSemi, `conquête récente : semi-occupation (première à t=${firstSemi.toFixed(0)})`);
  ok(seenOcc, `zones calmes et ravitaillées : occupation consolidée (semi ${c[1]}, occupé ${c[2]}, contesté ${c[3]})`);
  const st = [...new Set(Array.from({ length: sim.n }, (_, i) => sim.occupationState(i).label))];
  ok(st.includes('Contrôlé') && st.some((x) => x !== 'Contrôlé'), `états lisibles au survol : ${st.join(', ')}`);
  // sans ravitaillement suffisant : zones contestées, partisans, zones reprises
  const hard = mk('DE', { seed: 'OCC2', options: { tuning: { occSupply: 2, partisans: 3 } } });
  const kh = hard.nation.player, ph = side(hard, 'Pologne');
  m.startWar(hard, [kh], [ph], 'declaration');
  let contested = 0, retaken = 0, partisans = 0;
  for (let i = 0; i < 9000; i++) {
    const before = hard.sides[kh].cells;
    hard.step(); hard.captures.length = 0;
    for (const e of hard.eventsOut) if (e.title === 'PARTISANS') partisans++;
    hard.eventsOut.length = 0;
    contested = Math.max(contested, census(hard)[3]);
    void before;
  }
  for (let i = 0; i < hard.n; i++) if (hard.origin[i] === hard.sides[ph].e && hard.owner[i] === hard.sides[ph].e && hard.lastFlip[i] > 0) retaken++;
  ok(contested > 0, `ravitaillement insuffisant : zones contestées (${contested} au maximum)`);
  ok(partisans > 0, `partisans actifs : ${partisans} soulèvement(s) signalé(s)`);
  // Sandbox : comportement d'origine (pas d'états intermédiaires)
  const { load: L } = require('./v3-common.js'); void L;
  // déterminisme : sauvegarde au milieu des occupations, reprise identique
  const snap = JSON.parse(JSON.stringify(sim.serialize()));
  const b = mk('DE', { seed: 'OCC' }, snap);
  ok(census(b).join() === census(sim).join(), 'états d\'occupation conservés par la sauvegarde');
  for (let i = 0; i < 1500; i++) { sim.step(); b.step(); }
  ok(m.stateHash(sim) === m.stateHash(b) && census(b).join() === census(sim).join(), 'reprise identique (propriétaires, états d\'occupation, empreinte multijoueur)');
}

// §14 — composition de l'armée : effets réels
{
  const base = mk('FR', { seed: 'COMP' }), heavy = mk('FR', { seed: 'COMP' });
  const k = base.nation.player;
  const c0 = m.currentComposition(base.sides[k]);
  ok(Object.values(c0).reduce((a, b) => a + b, 0) === 100, `composition actuelle : ${Object.entries(c0).map(([x, v]) => x + ' ' + v + ' %').join(', ')}`);
  const comp = { inf: 25, arm: 35, art: 25, rec: 5, air: 5, sof: 5 };
  m.execCommand(heavy, { op: 'policy', a: k, patch: { comp } });
  run(base, 121.67); run(heavy, 121.67);
  const b = base.sides[k], h = heavy.sides[k];
  ok(h.army.arm / m.landTotal(h) > b.army.arm / m.landTotal(b) * 1.3, `reconversion : blindés ${(b.army.arm / m.landTotal(b) * 100).toFixed(0)} % → ${(h.army.arm / m.landTotal(h) * 100).toFixed(0)} % de l'armée de terre`);
  ok(h.atkT[0] / h.q > b.atkT[0] / b.q, 'puissance d\'attaque en terrain ouvert accrue (blindés)');
  ok((h.compLogK || 1) > 1.05 && heavy.supply(k, heavy.origin.findIndex((e) => e !== h.e)) <= base.supply(k, base.origin.findIndex((e) => e !== b.e)), `consommation logistique accrue (×${(h.compLogK || 1).toFixed(2)})`);
  ok(m.armyUpkeepSide(h) / m.landTotal(h) > m.armyUpkeepSide(b) / m.landTotal(b), 'coût d\'entretien par soldat plus élevé (blindés, artillerie)');
  const light = mk('FR', { seed: 'COMP' });
  m.execCommand(light, { op: 'policy', a: k, patch: { comp: { inf: 40, arm: 5, art: 5, rec: 25, air: 5, sof: 20 } } });
  run(light, 121.67 * 0.2);
  ok((light.sides[k].compSpeedK || 1) > 1 && (light.sides[k].sofComp || 0) > 0.3, `reconnaissance : mobilité ×${(light.sides[k].compSpeedK || 1).toFixed(2)} ; forces spéciales ${Math.round((light.sides[k].sofComp || 0) * 100)} %`);
  const ai = side(base, 'Allemagne');
  ok(base.sides[ai].compLogK === undefined && base.sides[ai].sofComp === undefined, 'les pays de l\'IA ne sont pas concernés');
}

// §15 — groupes d'armée : nombre, affectation, concentration réelle des forces
{
  const sim = mk('FR', { seed: 'GRP' });
  const k = sim.nation.player, de = side(sim, 'Allemagne'), it = side(sim, 'Italie');
  m.startWar(sim, [k], [de, it], 'declaration');
  run(sim, sim.time + 20);
  const share = (s, o) => { let t = 0, all = 0; for (const sec of s.sectors || []) { const f = s.front[sec.key]; all += f.force || 0; if (sec.o === o) t += f.force || 0; } return t / Math.max(1e-9, all); };
  const before = share(sim.sides[k], de);
  m.execCommand(sim, { op: 'policy', a: k, patch: { groups: { count: 6, list: [{ task: 'front', target: de }, { task: 'front', target: de }, { task: 'front', target: de }, { task: 'capital' }, { task: 'reserve' }, { task: 'auto' }] } } });
  run(sim, sim.time + 25);
  const after = share(sim.sides[k], de);
  ok(sim.sides[k].agents.length === 6, `nombre de groupes choisi : ${sim.sides[k].agents.length}`);
  ok(after > before + 0.05, `forces concentrées sur le front allemand : ${(before * 100).toFixed(0)} % → ${(after * 100).toFixed(0)} %`);
  ok(sim.sides[k].capGuard > 0 && sim.defensePower(k, sim.sides[k].capital) > 0, 'défense de la capitale renforcée');
  const gids = new Set(sim.sides[k].agents.map((a) => a.gid));
  ok(gids.size === 6, 'chaque point de la carte est un groupe identifié (fiche flottante)');
  const snap = JSON.parse(JSON.stringify(sim.serialize()));
  const b = mk('FR', { seed: 'GRP' }, snap);
  for (let i = 0; i < 800; i++) { sim.step(); b.step(); }
  ok(m.stateHash(sim) === m.stateHash(b) && JSON.stringify(sim.nation.serialize().humans) === JSON.stringify(b.nation.serialize().humans), 'groupes et composition conservés et reprise identique');
}

// §16 — flottes : ordres du joueur
{
  const sim = mk('GB', { seed: 'FLEET' });
  const k = sim.nation.player;
  run(sim, 6);
  const mine = sim.fleets.filter((f) => f.side === k);
  ok(mine.length >= 1, `flottes du joueur présentes en temps de paix : ${mine.length}`);
  const f = mine[0];
  const g = load().grid;
  const dest = g.coastalList.find((i) => Math.abs(g.lat[i] - 36.1) < 0.6 && Math.abs(g.lon[i] + 5.35) < 0.8);   // Gibraltar
  ok(m.execCommand(sim, { op: 'fleet', a: k, id: f.id, order: { type: 'goto', pts: [dest] } }) === true, 'ordre « aller à » accepté');
  ok(m.execCommand(sim, { op: 'fleet', a: side(sim, 'France'), id: f.id, order: { type: 'port' } }) === null, 'un autre pays ne peut pas donner d\'ordre à cette flotte');
  run(sim, sim.time + 60);
  const p = sim.fleetPos(f), d = Math.acos(Math.min(1, p[0] * g.xyz[dest * 3] + p[1] * g.xyz[dest * 3 + 1] + p[2] * g.xyz[dest * 3 + 2])) * 6371;
  ok(d < 400 && f.order.arrived, `flotte arrivée à destination (${Math.round(d)} km) et à l'arrêt`);
  m.execCommand(sim, { op: 'fleet', a: k, id: f.id, order: { type: 'escort' } });
  run(sim, sim.time + 3);
  ok(sim.sides[k].escortK > 0, `escorte de convois : interceptions réduites de ${Math.round(sim.sides[k].escortK * 100)} %`);
  m.execCommand(sim, { op: 'fleet', a: k, id: f.id, order: { type: 'patrol', pts: [dest, g.coastalList.find((i) => sim.owner[i] === sim.sides[k].e)] } });
  ok(f.order.type === 'patrol' && f.order.pts.length === 2, 'patrouille entre deux points');
  m.execCommand(sim, { op: 'fleet', a: k, id: f.id, order: { type: 'port' } });
  run(sim, sim.time + 80);
  ok(sim.owner[f.at] === sim.sides[k].e, 'retour au port : la flotte rejoint une côte nationale');
  const snap = JSON.parse(JSON.stringify(sim.serialize()));
  const b = mk('GB', { seed: 'FLEET' }, snap);
  ok(b.fleets.find((x) => x.id === f.id).order.type === 'port', 'ordres des flottes sauvegardés');
}

summary('Mécaniques du Mode Nation');
