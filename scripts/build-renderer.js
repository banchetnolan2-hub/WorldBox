// Construit l'interface (renderer) dans /app : bundle JS + CSS + assets.
const esbuild = require('esbuild');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const src = path.join(root, 'src');
const out = path.join(root, 'app');

function copyDir(from, to, filter) {
  fs.mkdirSync(to, { recursive: true });
  for (const name of fs.readdirSync(from)) {
    const a = path.join(from, name);
    const b = path.join(to, name);
    if (fs.statSync(a).isDirectory()) copyDir(a, b, filter);
    else if (!filter || filter(name)) fs.copyFileSync(a, b);
  }
}

fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });

// 1. HTML + CSS (index = World Simulator V3, classic = mode classique 2D de la V2)
fs.copyFileSync(path.join(src, 'index.html'), path.join(out, 'index.html'));
fs.copyFileSync(path.join(src, 'classic.html'), path.join(out, 'classic.html'));
copyDir(path.join(src, 'styles'), path.join(out, 'styles'));

// 2. Drapeaux (uniquement ceux des pays définis dans les données)
const countries = JSON.parse(fs.readFileSync(path.join(src, 'data', 'countries.json'), 'utf8'));
const flagSrc = path.join(root, 'node_modules', 'flag-icons', 'flags', '4x3');
const flagOut = path.join(out, 'assets', 'flags');
fs.mkdirSync(flagOut, { recursive: true });
let missing = [];
for (const c of countries.countries) {
  const code = (c.flag || c.iso2).toLowerCase();
  const f = path.join(flagSrc, code + '.svg');
  if (fs.existsSync(f)) fs.copyFileSync(f, path.join(flagOut, code + '.svg'));
  else missing.push(code);
}
if (missing.length) console.warn('Drapeaux manquants :', missing.join(', '));

// 2b. Police (Inter, variable, licence OFL) : rendu identique hors connexion
const fontOut = path.join(out, 'assets', 'fonts');
fs.mkdirSync(fontOut, { recursive: true });
for (const f of ['inter-latin-opsz-normal.woff2', 'inter-latin-ext-opsz-normal.woff2']) {
  const a = path.join(root, 'node_modules', '@fontsource-variable', 'inter', 'files', f);
  if (fs.existsSync(a)) fs.copyFileSync(a, path.join(fontOut, f));
}
// Cormorant Garamond (OFL) : titres et lettrage cartographique
for (const f of ['cormorant-garamond-latin-500-normal.woff2', 'cormorant-garamond-latin-600-normal.woff2', 'cormorant-garamond-latin-700-normal.woff2', 'cormorant-garamond-latin-ext-600-normal.woff2', 'cormorant-garamond-latin-ext-700-normal.woff2', 'cormorant-garamond-latin-500-italic.woff2', 'cormorant-garamond-latin-600-italic.woff2']) {
  const a = path.join(root, 'node_modules', '@fontsource', 'cormorant-garamond', 'files', f);
  if (fs.existsSync(a)) fs.copyFileSync(a, path.join(fontOut, f));
}

// 3. Icône
const icon = path.join(root, 'build', 'icon.png');
if (fs.existsSync(icon)) fs.copyFileSync(icon, path.join(out, 'icon.png'));

// 4. Bundles JS : V3 (World Simulator) + V2 (mode classique 2D)
if (!fs.existsSync(path.join(src, 'data', 'world-grid.bin')) || !fs.existsSync(path.join(src, 'data', 'world-hires.bin'))) require('./build-world.js');
if (!fs.existsSync(path.join(src, 'data', 'borders.bin'))) require('./build-borders.js');
const common = {
  bundle: true, format: 'iife', target: ['chrome120'],
  minify: process.argv.includes('--minify'), sourcemap: !process.argv.includes('--minify'),
  loader: { '.json': 'json', '.bin': 'binary', '.svg': 'text' }, logLevel: 'warning',
};
if (fs.existsSync(path.join(src, 'devtest.html'))) {
  fs.copyFileSync(path.join(src, 'devtest.html'), path.join(out, 'devtest.html'));
  esbuild.buildSync({ ...common, entryPoints: [path.join(src, 'v3', 'devtest.js')], outfile: path.join(out, 'devtest.js') });
}
if (fs.existsSync(path.join(src, 'v3', 'main.js'))) {
  esbuild.buildSync({ ...common, entryPoints: [path.join(src, 'v3', 'main.js')], outfile: path.join(out, 'bundle.js') });
  // géométrie des territoires : calculée dans un travailleur (Web Worker)
  esbuild.buildSync({ ...common, entryPoints: [path.join(src, 'v3', 'world', 'geometryWorker.js')], outfile: path.join(out, 'geoWorker.js') });
}
esbuild.buildSync({
  entryPoints: [path.join(src, 'js', 'main.js')],
  bundle: true,
  outfile: path.join(out, 'classic.js'),
  format: 'iife',
  target: ['chrome120'],
  minify: process.argv.includes('--minify'),
  sourcemap: !process.argv.includes('--minify'),
  loader: { '.json': 'json' },
  logLevel: 'warning',
});

console.log('Interface construite dans app/ (' + countries.countries.length + ' pays)');
