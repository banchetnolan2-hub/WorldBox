// Données réelles de départ (NATION SIMULATOR et toute la simulation) :
//  - population : Banque mondiale (SP.POP.TOTL), via le jeu de données officiel miroir datasets/population
//  - PIB (US$ courants) : Banque mondiale (NY.GDP.MKTP.CD), via datasets/gdp
//  - dépenses militaires (% du PIB) : SIPRI Military Expenditure Database (dernière année disponible)
// Chaque valeur garde sa source et son année ; si une donnée manque, elle est marquée « estimée ».
// Usage : node scripts/build-real-stats.js  -> src/data/real-stats.json
const fs = require('fs');
const path = require('path');
const dir = path.join(__dirname, 'data', 'sources');
const countries = require('../src/data/countries.json').countries;
const iso = require('./data/sources/iso-map.json');

function csv(file) {
  const lines = fs.readFileSync(path.join(dir, file), 'utf8').trim().split(/\r?\n/);
  const head = parse(lines[0]);
  return lines.slice(1).map((l) => { const v = parse(l); const o = {}; head.forEach((h, k) => { o[h] = v[k]; }); return o; });
}
function parse(line) {
  const out = []; let cur = '', q = false;
  for (const ch of line) {
    if (ch === '"') q = !q; else if (ch === ',' && !q) { out.push(cur); cur = ''; } else cur += ch;
  }
  out.push(cur);
  return out;
}
function latest(rows, code) {
  let best = null;
  for (const r of rows) if (r['Country Code'] === code && r.Value !== '' && !isNaN(+r.Value) && (!best || +r.Year > +best.Year)) best = r;
  return best ? { value: +best.Value, year: +best.Year } : null;
}

const gdp = csv('worldbank-gdp.csv');
const pop = csv('worldbank-population.csv');
const sip = csv('sipri-military-expenditure.csv');
// SIPRI : noms anglais -> dernière valeur « GDP Percent »
const sipLast = new Map();
for (const r of sip) {
  if (r.metric !== 'GDP Percent') continue;
  const v = parseFloat(r.amount);
  if (!isFinite(v)) continue;
  const y = +r.year;
  const k = norm(r.Country);
  if (!sipLast.has(k) || y > sipLast.get(k).year) sipLast.set(k, { value: v, year: y, name: r.Country });
}
function norm(s) { return String(s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z]/g, ''); }
const ALIAS = {
  US: ['United States of America', 'USA', 'United States'], RU: ['Russia'], KR: ['Korea, South', 'South Korea'], KP: ['Korea, North', 'North Korea'],
  IR: ['Iran'], SY: ['Syria'], VN: ['Viet Nam', 'Vietnam'], LA: ['Laos'], BO: ['Bolivia'], VE: ['Venezuela'], TZ: ['Tanzania'], CD: ['Congo, DR', 'DR Congo', 'Congo, Dem. Rep.'],
  CG: ['Congo, Republic', 'Congo, Republic of', 'Congo'], CI: ["Cote d'Ivoire", "Côte d'Ivoire", 'Ivory Coast'], CV: ['Cape Verde', 'Cabo Verde'], CZ: ['Czechia', 'Czech Republic'],
  MK: ['North Macedonia', 'Macedonia, FYR', 'Macedonia'], MD: ['Moldova'], GB: ['United Kingdom', 'UK'], BA: ['Bosnia and Herzegovina', 'Bosnia-Herzegovina'],
  SZ: ['Eswatini', 'Swaziland'], TR: ['Turkey', 'Türkiye', 'Turkiye'], GM: ['Gambia, The', 'Gambia'], BS: ['Bahamas, The', 'Bahamas'], BN: ['Brunei', 'Brunei Darussalam'],
  TL: ['Timor Leste', 'Timor-Leste', 'East Timor'], MM: ['Myanmar', 'Burma'], PS: ['Palestine'], CF: ['Central African Republic', 'Central African Rep.'], DO: ['Dominican Republic', 'Dominican Rep.'],
  KG: ['Kyrgyzstan', 'Kyrgyz Republic'], SK: ['Slovakia', 'Slovak Republic'], AE: ['UAE', 'United Arab Emirates'], SS: ['South Sudan'], EG: ['Egypt'], YE: ['Yemen'],
};
function sipriFor(c) {
  const names = [...(ALIAS[c.iso2] || []), iso[c.id] && iso[c.id].en].filter(Boolean);
  for (const n of names) { const v = sipLast.get(norm(n)); if (v) return v; }
  return null;
}

const out = {};
let nG = 0, nP = 0, nM = 0;
for (const c of countries) {
  const a3 = iso[c.id] && iso[c.id].a3;
  const p = a3 ? latest(pop, a3) : null;
  const g = a3 ? latest(gdp, a3) : null;
  const m = sipriFor(c);
  const est = [];
  const rec = { a3 };
  if (p) {
    rec.population = Math.round(p.value); rec.popYear = p.year; nP++;
    // croissance démographique : moyenne annuelle sur les 5 dernières années disponibles (Banque mondiale)
    const old = pop.find((r) => r['Country Code'] === a3 && +r.Year === p.year - 5);
    if (old && +old.Value > 0) rec.popGrowth = Math.round((Math.pow(p.value / +old.Value, 1 / 5) - 1) * 10000) / 100;
  } else { rec.population = Math.round(c.population); est.push('population'); }
  if (g && g.year >= 2015) { rec.gdpUsd = Math.round(g.value); rec.gdpYear = g.year; nG++; } else { if (g) { rec.gdpUsd = Math.round(g.value); rec.gdpYear = g.year; } est.push('gdp'); }
  // valeurs SIPRI déjà exprimées en % du PIB ; une donnée trop ancienne est considérée comme non fiable
  if (m && m.year >= 2015) { rec.milPct = m.value; rec.milYear = m.year; nM++; } else est.push('military');
  rec.estimated = est;
  out[c.id] = rec;
}
const meta = {
  generated: new Date().toISOString().slice(0, 10),
  sources: {
    population: 'Banque mondiale — Population, total (SP.POP.TOTL), jeu de données datasets/population (github.com/datasets/population) ; croissance démographique : moyenne annuelle des 5 dernières années',
    gdp: 'Banque mondiale — PIB en US$ courants (NY.GDP.MKTP.CD), jeu de données datasets/gdp (github.com/datasets/gdp)',
    military: 'SIPRI Military Expenditure Database — dépenses militaires en % du PIB (dernière année disponible), extrait public github.com/Nathan-States/SIPRI-Dashboard',
    personnel: 'Effectifs militaires : estimés par le modèle à partir du budget militaire, du PIB et de la population (pas de source ouverte directement intégrable)',
  },
  coverage: { population: nP, gdp: nG, military: nM, total: countries.length },
};
fs.writeFileSync(path.join(__dirname, '..', 'src', 'data', 'real-stats.json'), JSON.stringify({ meta, countries: out }));
console.log('real-stats.json :', meta.coverage);
for (const id of ['FR', 'US', 'CN', 'RU', 'DE', 'IN', 'KP', 'VE', 'SY', 'PS', 'VA', 'TW']) if (out[id]) console.log(id, JSON.stringify(out[id]));
