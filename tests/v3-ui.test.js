// Tests de l'INTERFACE sans navigateur : guide (chapitres exigés par le cahier des charges), tutoriel,
// thèmes (présentation uniquement, chaque thème défini dans la feuille de style), modules d'interface
// indépendants de la simulation.
const path = require('path'); const fs = require('fs');
const out = path.join(__dirname, '.ui-bundle.cjs');
require('esbuild').buildSync({
  stdin: { contents: "export * from './src/v3/ui/guide.js'; export * from './src/v3/ui/themes.js';", resolveDir: path.join(__dirname, '..'), loader: 'js' },
  bundle: true, platform: 'node', format: 'cjs', outfile: out, logLevel: 'error', loader: { '.svg': 'text', '.json': 'json' },
});
const m = require(out);
let fails = 0, passes = 0;
const ok = (c, label) => { console.log((c ? 'OK   ' : 'ÉCHEC') + ' ' + label); if (c) passes++; else { fails++; process.exitCode = 1; } };

// guide : les chapitres demandés (carte, économie, diplomatie, armée, recherche, groupes d'armée, marine,
// occupations, propositions territoriales, nations formables, multijoueur)
const need = ['map', 'economy', 'diplomacy', 'army', 'research', 'groups', 'navy', 'occupation', 'territory', 'formables', 'multi'];
const ids = m.GUIDE.map((c) => c.id);
ok(need.every((x) => ids.includes(x)), `guide : ${m.GUIDE.length} chapitres, dont les ${need.length} exigés`);
ok(m.GUIDE.every((c) => c.title && c.icon && c.body.length > 200), 'chaque chapitre a un titre, une icône et un contenu');
ok(new Set(ids).size === ids.length, 'identifiants de chapitres uniques');
ok(m.TUTORIAL.length >= 6 && m.TUTORIAL.some((s) => s.done) && /guide/i.test(m.TUTORIAL.at(-1).text), `tutoriel : ${m.TUTORIAL.length} étapes, validation automatique, rappel final de l'accès au guide`);

// thèmes : présentation uniquement
const css = fs.readFileSync(path.join(__dirname, '..', 'src/styles/v3.css'), 'utf8');
ok(m.THEMES.length >= 4 && m.THEMES[0].id === 'cartes', `thèmes : ${m.THEMES.map((t) => t.label).join(', ')}`);
ok(m.THEMES.slice(1).every((t) => css.includes(`:root[data-theme="${t.id}"]`)), 'chaque thème est défini dans la feuille de style');
const hex = (h) => { const v = parseInt(h.slice(1), 16); return [(v >> 16) & 255, (v >> 8) & 255, v & 255]; };
const lum = (h) => { const c = hex(h).map((x) => { x /= 255; return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4; }); return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]; };
const ratio = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
for (const t of m.THEMES) {
  const r = ratio(t.sw[0], t.sw[1]);
  ok(r >= 7, `lisibilité « ${t.label} » : contraste texte/fond ${r.toFixed(1)}:1`);
}
ok(m.UI_SIZES.some((s) => s.value === 1) && m.UI_SIZES.every((s) => s.value >= 0.8 && s.value <= 1.5), 'tailles d\'interface bornées (80 % à 150 %)');
// aucun module d'interface ajouté ne touche à la simulation
for (const f of ['themes.js', 'guide.js', 'recap.js', 'dashboard.js']) {
  const src = fs.readFileSync(path.join(__dirname, '..', 'src/v3/ui', f), 'utf8');
  ok(!/\.rng\b|\bact\(|execCommand|\.step\(/.test(src), `${f} : aucun tirage aléatoire ni ordre de simulation`);
}
console.log(`\nInterface : ${passes} réussi(s), ${fails} échec(s)`);
fs.unlinkSync(out);
