// Tests du moteur de simulation (Node) : déterminisme, équilibre, durée, dynamique.
// Lancer :  npm test
const path = require('path');
require('esbuild').buildSync({
  entryPoints: [path.join(__dirname, 'entry.mjs')], bundle: true, platform: 'node', format: 'cjs',
  outfile: path.join(__dirname, '.sim-bundle.cjs'), logLevel: 'error',
});
const { Simulation, syntheticGrid, TUNE } = require('./.sim-bundle.cjs');
if (process.env.TUNE) Object.assign(TUNE, JSON.parse(process.env.TUNE));

const argN = Number(process.argv[2] || 60);
const grid = syntheticGrid(120, 80);
const base = { puissance: 60, mobilite: 60, stabilite: 60, ressources: 60, defense: 60, expansion: 55, vitesse: 60 };

function run(seed, statsB = base, extra = {}) {
  const sim = new Simulation(grid, { seed, names: ['A', 'B'], stats: [base, statsB], ...extra });
  let leadChanges = 0, lastLead = -1, minA = 1, maxA = 0;
  while (!sim.finished) {
    sim.step();
    sim.captures.length = 0; sim.eventsOut.length = 0;
    if (sim.tickCount % 20 === 0) {
      const a = sim.share(0); minA = Math.min(minA, a); maxA = Math.max(maxA, a);
      const l = sim.leaderSide();
      if (l >= 0 && lastLead >= 0 && l !== lastLead) leadChanges++;
      if (l >= 0) lastLead = l;
    }
  }
  return { ...sim.result, leadChanges, minA, maxA };
}

function batch(label, statsB, extra) {
  const t0 = Date.now();
  const res = [];
  for (let k = 0; k < argN; k++) res.push(run('S' + k, statsB, extra));
  const winsA = res.filter((r) => r.winner === 0).length;
  const winsB = res.filter((r) => r.winner === 1).length;
  const draws = res.length - winsA - winsB;
  const dur = res.map((r) => r.time).sort((a, b) => a - b);
  const timeouts = res.filter((r) => r.reason === 'temps').length;
  const lc = res.reduce((s, r) => s + r.leadChanges, 0) / res.length;
  const swing = res.reduce((s, r) => s + (r.maxA - r.minA), 0) / res.length;
  console.log(`${label.padEnd(28)} A ${winsA}  B ${winsB}  nul ${draws} | durée méd ${dur[dur.length >> 1].toFixed(0)}s (min ${dur[0].toFixed(0)}, max ${dur[dur.length - 1].toFixed(0)}) | fin au temps ${timeouts} | chgts de tête ${lc.toFixed(1)} | amplitude ${(swing * 100).toFixed(0)}% | ${(Date.now() - t0) / res.length | 0} ms/partie`);
  return { winsA, winsB };
}

// 1. déterminisme
const r1 = run('SAME'), r2 = run('SAME');
if (r1.time !== r2.time || r1.share[0] !== r2.share[0]) { console.error('ÉCHEC : non déterministe'); process.exit(1); }
console.log('Déterminisme OK (' + grid.n + ' cellules)');

batch('Stats égales', base);
const stronger = { ...base, puissance: 72, defense: 70 };
const b = batch('B nettement plus fort', stronger);
if (b.winsA === 0) console.warn('Attention : le plus faible ne gagne jamais');
batch('B puissance ×1.5 (perso)', base, { powerMult: [1, 1.5] });
batch('Aléatoire 0', base, { randomness: 0 });
batch('Aléatoire 1', base, { randomness: 1 });
batch('Sans événements', base, { eventRate: 0 });
