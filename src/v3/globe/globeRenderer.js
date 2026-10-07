// GLOBE — rendu 3D (Three.js / WebGL2) : Terre en relief (vraies altitudes et profondeurs),
// océans, atmosphère, couleurs des pays, unités, navires, avions, routes, effets. Peu d'appels de
// dessin : tout ce qui est multiple (unités, navires, anneaux) est « instancié ».
import * as THREE from 'three';
import { ribbonMesh, ribbonMaterial, chaikin, simplifyDP, parseBorders } from './vectorLines.js';
import { createGeometryCore } from '../world/geometryCore.js';
import { GlobeCamera } from './globeCamera.js';
import { buildNoiseTexture, TerritoryTextures } from './globeTextures.js';
import { mapColors, distinctParticipantColors } from './mapColors.js';
import * as S from './shaders.js';

// identité visuelle : formes des unités, couleur secondaire empaquetée, couleur d'affichage des autres pays
const SHAPES = { disk: 0, square: 1, diamond: 2, hex: 3 };
const packRgb = (hex) => { const v = parseInt(String(hex).slice(1), 16); return Number.isFinite(v) ? v : -1; };
function othersColor(hex, mode) {
  const c = hexRgb(hex);
  if (!mode || mode === 'normal') return c;
  const g = (c[0] + c[1] + c[2]) / 3;
  if (mode === 'gris') return [g * 0.55 + 0.25, g * 0.55 + 0.26, g * 0.55 + 0.28];
  if (mode === 'pastel') return [c[0] * 0.55 + 0.42, c[1] * 0.55 + 0.42, c[2] * 0.55 + 0.42];
  if (mode === 'sombre') return [c[0] * 0.55, c[1] * 0.55, c[2] * 0.55];
  return c;
}


const NONE = 65535;
const MAX_ENT = 512;
const MAX_MARKERS = 8000;
const MAX_RINGS = 256;
const MAX_SHIPS = 120;
// exagération verticale du relief (géométrie) : l'Himalaya et les Andes restent visibles de loin
export const EXAG_KM = 14 / 6371;
const CAP_RINGS = 230, CAP_SECTORS = 460;

function hexRgb(h) {
  const v = parseInt((h || '#888888').replace('#', ''), 16);
  return [((v >> 16) & 255) / 255, ((v >> 8) & 255) / 255, (v & 255) / 255];
}

export class GlobeRenderer {
  constructor(canvas, grid, hires, relief) {
    this.hires = hires;
    this.relief = relief;
    this.canvas = canvas;
    this.grid = grid;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    this.renderer.setClearColor(0x03060d, 1);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(38, 1, 0.01, 60);
    this.cam = new GlobeCamera(this.camera);
    this.time = 0;
    this.entities = [];
    this.selected = -1;
    this.showMarkers = true;
    this.shadows = true;
    this.rings = [];
    this.colors = [];
    this.stats = { frameMs: 0 };
  }

  async init(entities) {
    this.entities = entities;
    this.mapColor = mapColors(this.grid, entities);
    this.noiseTex = buildNoiseTexture();
    this.territory = new TerritoryTextures(this.grid);
    this.hiresTex = buildHiresTexture(this.hires);
    // masque terre/mer très fin : 32 pixels par texel RGBA (1 bit chacun)
    if (this.hires.mask) {
      this.maskTex = new THREE.DataTexture(this.hires.mask, 512, 8192, THREE.RGBAFormat, THREE.UnsignedByteType);
      this.maskTex.minFilter = this.maskTex.magFilter = THREE.NearestFilter; this.maskTex.generateMipmaps = false; this.maskTex.needsUpdate = true;
    }
    this.emptyHires = new THREE.DataTexture(new Uint8Array([255]), 1, 1, THREE.RedFormat, THREE.UnsignedByteType);
    this.emptyHires.needsUpdate = true;
    this.reliefTex = this._buildReliefTexture();
    this._computeCellRadius();
    this.transition = 1.3;
    this.hiresOn = !!this.hires;
    // paramètres des entités : couleur (rgb) + mode (a)
    this.params = new Float32Array(MAX_ENT * 4);
    this.paramsTex = new THREE.DataTexture(this.params, MAX_ENT, 1, THREE.RGBAFormat, THREE.FloatType);
    this.paramsTex.minFilter = this.paramsTex.magFilter = THREE.NearestFilter;
    this.paramsTex.needsUpdate = true;

    this.sunDir = new THREE.Vector3(1, 0.6, 1).normalize();
    this.earthMat = new THREE.ShaderMaterial({
      glslVersion: THREE.GLSL3,
      vertexShader: S.earthVertex,
      fragmentShader: S.earthFragment,
      uniforms: {
        uRelief: { value: this.reliefTex },
        uNoise: { value: this.noiseTex },
        uOwnerA: { value: this.territory.texA },
        uOwnerB: { value: this.territory.texB },
        uParams: { value: this.paramsTex },
        uHires: { value: this.hiresTex },
        uHiresSize: { value: new THREE.Vector2(this.hires.W, this.hires.H) },
        uGrid: { value: new THREE.Vector2(this.grid.W, this.grid.H) },
        uTime: { value: 0 },
        uSunDir: { value: this.sunDir },
        uCamPos: { value: new THREE.Vector3() },
        uSelected: { value: -1 },
        uShowBorders: { value: 1 },
        uShade: { value: EXAG_KM * 2 },
        uShadows: { value: 1 },
        uBorderFade: { value: 1 },
        uExag: { value: EXAG_KM },
        uReliefW: { value: this.relief.W },
        uHiresOn: { value: 1 },
        uTransition: { value: 1.3 },
        uGeo: { value: null },
        uGeoOn: { value: 0 },
        uCapC: { value: new THREE.Vector3(0, 0, 1) },
        uCapX: { value: new THREE.Vector3(1, 0, 0) },
        uCapY: { value: new THREE.Vector3(0, 1, 0) },
        uCapAngle: { value: 1.2 },
        uCapRes: { value: new THREE.Vector2(CAP_RINGS, CAP_SECTORS) },
        uVecOn: { value: 0 },
        uTerr: { value: null },
        uTerrPrev: { value: null },
        uTerrF: { value: null },
        uMix: { value: 1 },
        uTerrOn: { value: 0 },
        uTerrSize: { value: new THREE.Vector2(8192, 4096) },
        uMask: { value: null },
        uMaskOn: { value: 0 },
      },
    });
    this.earth = new THREE.Mesh(capGeometry(CAP_RINGS, CAP_SECTORS), this.earthMat);
    this.earth.frustumCulled = false;
    this.scene.add(this.earth);

    // atmosphère
    this.atmoMat = new THREE.ShaderMaterial({
      glslVersion: THREE.GLSL3,
      vertexShader: S.atmosphereVertex, fragmentShader: S.atmosphereFragment,
      uniforms: { uCamPos: { value: new THREE.Vector3() }, uSunDir: { value: this.sunDir } },
      side: THREE.BackSide, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false,
    });
    this.scene.add(new THREE.Mesh(new THREE.SphereGeometry(1.028, 128, 64), this.atmoMat));

    // étoiles
    const starPos = [];
    let seed = 7;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (let k = 0; k < 2600; k++) {
      const u = rnd() * 2 - 1, t = rnd() * Math.PI * 2, r = 30 + rnd() * 10;
      const s = Math.sqrt(1 - u * u);
      starPos.push(r * s * Math.cos(t), r * u, r * s * Math.sin(t));
    }
    const sg = new THREE.BufferGeometry();
    sg.setAttribute('position', new THREE.Float32BufferAttribute(starPos, 3));
    this.scene.add(new THREE.Points(sg, new THREE.PointsMaterial({ color: 0xaab8d8, size: 0.06, sizeAttenuation: true, transparent: true, opacity: 0.8, depthWrite: false })));


    // cercle du pinceau (éditeur de monde)
    const bg = new THREE.BufferGeometry();
    bg.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(129 * 3), 3));
    this.brushLine = new THREE.LineLoop(bg, new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.85, depthTest: false }));
    this.brushLine.frustumCulled = false;
    this.brushLine.renderOrder = 8;
    this.brushLine.visible = false;
    this.scene.add(this.brushLine);

    this._initMarkers();
    this._initRings();
    this._initVehicles();
    this.resize();
  }

  // Contexte de monde : Terre (grille, relief réel, vraies frontières) ou monde créé (grille et relief
  // dérivés du terrain modifiable). Tout le rendu suit ce contexte.
  setContext(ctx) {
    const u = this.earthMat.uniforms;
    if (ctx.relief !== this.relief) {
      // la texture du relief terrestre est gardée en cache (retour rapide sur la Terre)
      if (!this.earthRelief) { this.earthRelief = this.relief; this.earthReliefTex = this.reliefTex; this.earthLevels = this._reliefLevels; }
      if (this.reliefTex && this.reliefTex !== this.earthReliefTex) this.reliefTex.dispose();
      this.relief = ctx.relief;
      if (ctx.relief === this.earthRelief) { this.reliefTex = this.earthReliefTex; this._reliefLevels = this.earthLevels; }
      else this.reliefTex = this._buildReliefTexture();
      u.uRelief.value = this.reliefTex;
      u.uReliefW.value = this.relief.W;
    }
    this.hiresOn = !!ctx.hires;
    u.uHires.value = ctx.hires ? this.hiresTex : this.emptyHires;
    u.uHiresOn.value = ctx.hires ? 1 : 0;
    if (ctx.grid !== this.grid) {
      this.grid = ctx.grid;
      this.territory.dispose();
      this.territory = new TerritoryTextures(this.grid);
      u.uOwnerA.value = this.territory.texA;
      u.uOwnerB.value = this.territory.texB;
      u.uGrid.value.set(this.grid.W, this.grid.H);
      this.rings = [];
      this.headings.clear();
    }
    this._computeCellRadius();
    this.version = (this.version || 0) + 1;
  }

  // géographie simulée : teinte des biomes sous les pays et réseau de rivières
  setGeo(geo, colors) {
    const g = this.grid;
    const u = this.earthMat.uniforms;
    if (this.geoTex) this.geoTex.dispose();
    if (!geo) { u.uGeoOn.value = 0; if (this.riverLines) this.riverLines.visible = false; return; }
    const data = new Uint8Array(g.W * g.H * 4);
    const pal = colors.map((h) => [1, 3, 5].map((k) => parseInt(h.slice(k, k + 2), 16)));
    for (let i = 0; i < g.nGrid; i++) {
      const p = g.pos[i], c = pal[geo.biome[i]] || pal[0];
      data[p * 4] = c[0]; data[p * 4 + 1] = c[1]; data[p * 4 + 2] = c[2]; data[p * 4 + 3] = 255;
    }
    const tex = new THREE.DataTexture(data, g.W, g.H, THREE.RGBAFormat);
    tex.magFilter = tex.minFilter = THREE.LinearFilter;
    tex.wrapS = THREE.RepeatWrapping;
    tex.needsUpdate = true;
    this.geoTex = tex;
    u.uGeo.value = tex; u.uGeoOn.value = 1;
    // rivières : segments entre centres de parcelles, posés sur le relief
    const segs = geo.riverSegs;
    const pos = [], col = [];
    for (let k = 0; k < segs.length; k += 3) {
      const a = segs[k], b = segs[k + 1], cls = segs[k + 2];
      if (b < 0) continue;
      const ra = this.cellR[a] + 0.0004, rb = (b < g.n ? this.cellR[b] : 1) + 0.0004;
      pos.push(g.xyz[a * 3] * ra, g.xyz[a * 3 + 1] * ra, g.xyz[a * 3 + 2] * ra, g.xyz[b * 3] * rb, g.xyz[b * 3 + 1] * rb, g.xyz[b * 3 + 2] * rb);
      const i = 0.35 + cls * 0.2;
      for (let q = 0; q < 2; q++) col.push(0.35 * i, 0.62 * i, 1.0 * i);
    }
    if (!this.riverLines) {
      this.riverLines = new THREE.LineSegments(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.7, depthWrite: false }));
      this.riverLines.frustumCulled = false;
      this.riverLines.renderOrder = 2;
      this.scene.add(this.riverLines);
    }
    const bg = this.riverLines.geometry;
    bg.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    bg.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    bg.computeBoundingSphere();
    this.riverLines.visible = true;
  }

  // ---------------- carte détaillée (Terre) : lacs, limites régionales, routes, villes ----------------
  // Niveaux de détail : chaque calque apparaît progressivement en zoomant (opacité selon la distance).
  setDetails(d) {
    for (const k of ['lakeMesh', 'regionRibbon', 'roadLines', 'cityPoints']) if (this[k]) { this.scene.remove(this[k]); this[k].geometry.dispose(); this[k] = null; }
    this.details = d;
    if (!d) return;
    const g = this.grid;
    const DEG = Math.PI / 180;
    const xyz = (la, lo) => [Math.cos(la * DEG) * Math.sin(lo * DEG), Math.sin(la * DEG), Math.cos(la * DEG) * Math.cos(lo * DEG)];
    const lift = (p, h) => { const r = this.surfaceR(p[0], p[1], p[2]) + h; return [p[0] * r, p[1] * r, p[2] * r]; };
    // lacs : polygones triangulés posés sur le relief
    const lp = [];
    for (const [, ring] of d.lakes) {
      let minX = Infinity, maxX = -Infinity;
      for (const [x] of ring) { minX = Math.min(minX, x); maxX = Math.max(maxX, x); }
      if (maxX - minX > 180) continue;
      const pts = ring.slice(0, -1).map(([x, y]) => new THREE.Vector2(x, y));
      if (pts.length < 3) continue;
      let tris;
      try { tris = THREE.ShapeUtils.triangulateShape(pts, []); } catch (_) { continue; }
      for (const t of tris) for (const q of t) { const v = lift(xyz(pts[q].y, pts[q].x), 0.0005); lp.push(v[0], v[1], v[2]); }
    }
    const lg = new THREE.BufferGeometry();
    lg.setAttribute('position', new THREE.Float32BufferAttribute(lp, 3));
    this.lakeMesh = new THREE.Mesh(lg, new THREE.MeshBasicMaterial({ color: 0x2a5d8c, transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide }));
    this.lakeMesh.renderOrder = 1; this.lakeMesh.frustumCulled = false;
    this.scene.add(this.lakeMesh);
    // limites régionales : arêtes de la grille entre deux régions d'un même pays, enchaînées en
    // polylignes puis lissées (Chaikin) -> tracés courbes, sans escaliers
    const R = g.RES, W = g.W;
    const reg = d.regionOf;
    const adj = new Map();
    const key = (x, y) => y * (W + 1) + x;
    const link = (x1, y1, x2, y2) => { const a = key(x1, y1), b = key(x2, y2); (adj.get(a) || adj.set(a, []).get(a)).push(b); (adj.get(b) || adj.set(b, []).get(b)).push(a); };
    for (let i = 0; i < g.nGrid; i++) {
      const ri = reg[i];
      if (ri < 0) continue;
      const p = g.pos[i], x = p % W, y = (p / W) | 0;
      const right = g.indexAt[y * W + ((x + 1) % W)];
      if (x + 1 < W && right >= 0 && reg[right] >= 0 && reg[right] !== ri && d.regions[reg[right]].e === d.regions[ri].e) link(x + 1, y, x + 1, y + 1);
      const down = y + 1 < g.H ? g.indexAt[(y + 1) * W + x] : -1;
      if (down >= 0 && reg[down] >= 0 && reg[down] !== ri && d.regions[reg[down]].e === d.regions[ri].e) link(x, y + 1, x + 1, y + 1);
    }
    const used = new Set();
    const ek = (a, b) => (a < b ? a * 4194304 + b : b * 4194304 + a);
    const lines = [];
    const walk = (start, next) => {
      const pts = [start, next]; used.add(ek(start, next));
      let prev = start, cur = next;
      while ((adj.get(cur) || []).length === 2) {
        const n = adj.get(cur).find((v) => v !== prev && !used.has(ek(cur, v)));
        if (n === undefined) break;
        used.add(ek(cur, n)); pts.push(n); prev = cur; cur = n;
      }
      return pts;
    };
    const starts = [...adj.keys()].sort((p, q) => (adj.get(p).length === 2) - (adj.get(q).length === 2));
    for (const st of starts) for (const nb of adj.get(st)) if (!used.has(ek(st, nb))) lines.push(walk(st, nb));
    const ribbons = lines.map((l) => chaikin(simplifyDP(l.map((v) => [-180 + (v % (W + 1)) * R, 90 - Math.floor(v / (W + 1)) * R]), R * 0.75), 3)
      .map(([lo, la]) => this._liftLL(lo, la)));
    this.regionRibbon = ribbonMesh(ribbons, { color: 0xf1e8d0, width: 1, opacity: 0, order: 2, lift: 0.0002 });
    this.regionRibbon.visible = false;
    this.scene.add(this.regionRibbon);
    // routes principales entre les villes
    const sp = [], sc = [];
    for (const [a, b, w] of d.roads) {
      const pa = [g.xyz[a * 3], g.xyz[a * 3 + 1], g.xyz[a * 3 + 2]], pb = [g.xyz[b * 3], g.xyz[b * 3 + 1], g.xyz[b * 3 + 2]];
      const N = 10;
      let prev = lift(pa, 0.0011);
      for (let k = 1; k <= N; k++) {
        const t = k / N;
        let q = [pa[0] + (pb[0] - pa[0]) * t, pa[1] + (pb[1] - pa[1]) * t, pa[2] + (pb[2] - pa[2]) * t];
        const l = Math.hypot(q[0], q[1], q[2]); q = [q[0] / l, q[1] / l, q[2] / l];
        const cur = lift(q, 0.0011);
        sp.push(...prev, ...cur);
        const c = w === 2 ? [0.95, 0.83, 0.6] : [0.8, 0.74, 0.62];
        sc.push(...c, ...c);
        prev = cur;
      }
    }
    const sg = new THREE.BufferGeometry();
    sg.setAttribute('position', new THREE.Float32BufferAttribute(sp, 3));
    sg.setAttribute('color', new THREE.Float32BufferAttribute(sc, 3));
    this.roadLines = new THREE.LineSegments(sg, new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0, depthWrite: false }));
    this.roadLines.renderOrder = 2; this.roadLines.frustumCulled = false;
    this.scene.add(this.roadLines);
    // villes : points ronds dont la taille suit la population (zones urbaines)
    const cp = [], cs = [], cc = [];
    for (const c of d.cities) {
      if (c.cap) continue;   // capitales : déjà représentées
      const v = lift(xyz(c.lat, c.lon), 0.0016);
      cp.push(...v);
      cs.push(c.pop > 5e6 ? 7 : c.pop > 1e6 ? 5.5 : c.pop > 3e5 ? 4.2 : 3.2);
      cc.push(...(c.port ? [0.75, 0.88, 1] : [1, 0.96, 0.86]));
    }
    const cg = new THREE.BufferGeometry();
    cg.setAttribute('position', new THREE.Float32BufferAttribute(cp, 3));
    cg.setAttribute('size', new THREE.Float32BufferAttribute(cs, 1));
    cg.setAttribute('color', new THREE.Float32BufferAttribute(cc, 3));
    this.cityPoints = new THREE.Points(cg, new THREE.ShaderMaterial({
      transparent: true, depthWrite: false,
      uniforms: { uOpacity: { value: 0 }, uScale: { value: 1 } },
      vertexShader: `attribute float size; attribute vec3 color; varying vec3 vC; varying float vFace; uniform float uScale;
        void main(){ vC = color; vec4 mv = modelViewMatrix * vec4(position,1.0); vec3 n = normalize(position); vec3 toCam = normalize(cameraPosition - position);
          vFace = dot(n, toCam); gl_PointSize = size * uScale; gl_Position = projectionMatrix * mv; }`,
      fragmentShader: `varying vec3 vC; varying float vFace; uniform float uOpacity;
        void main(){ if (vFace < 0.05) discard; vec2 q = gl_PointCoord - 0.5; float r = length(q); if (r > 0.5) discard;
          float ring = smoothstep(0.5, 0.36, r); float core = smoothstep(0.3, 0.18, r);
          vec3 col = mix(vec3(0.05,0.06,0.08), vC, core);
          gl_FragColor = vec4(col, ring * uOpacity); }`,
    }));
    this.cityPoints.renderOrder = 3; this.cityPoints.frustumCulled = false;
    this.scene.add(this.cityPoints);
  }

  // frontières et côtes vectorielles (Natural Earth 1:10m) : nettes à tous les zooms, deux niveaux de détail
  setBorders(u16) {
    this.borderData = parseBorders(u16);
    this.vec = { coarse: null, fine: null };
    this.vec.coarse = this._buildVector(1);
  }
  _liftLL(lon, lat) {
    const DEG = Math.PI / 180, c = Math.cos(lat * DEG);
    return [c * Math.sin(lon * DEG), Math.sin(lat * DEG), c * Math.cos(lon * DEG)];
  }
  _buildVector(lod) {
    const borders = [], coasts = [];
    const step = lod ? 0.35 : 0.12;      // densification : la ligne suit la courbure et le relief
    for (const b of this.borderData) {
      if (b.lod !== lod) continue;
      const out = [];
      for (let k = 0; k < b.pts.length; k++) {
        const [lo, la] = b.pts[k];
        if (k > 0) {
          let [plo, pla] = b.pts[k - 1];
          let dlo = lo - plo; if (dlo > 180) dlo -= 360; if (dlo < -180) dlo += 360;
          const n = Math.ceil(Math.hypot(dlo, la - pla) / step);
          for (let j = 1; j < n; j++) out.push(this._liftLL(plo + dlo * j / n, pla + (la - pla) * j / n));
        }
        out.push(this._liftLL(lo, la));
      }
      (b.b < 0 ? coasts : borders).push(out);
    }
    const grp = new THREE.Group();
    grp.add(ribbonMesh(coasts, { color: 0x0b1f2e, width: 1, opacity: 0.55, order: 3, lift: 0.00015 }));
    grp.add(ribbonMesh(borders, { color: 0x0a1016, width: 1.6, opacity: 0.85, sideTest: true, order: 4, lift: 0.0002 }));
    grp.visible = false;
    this.scene.add(grp);
    return grp;
  }

  // ---------------- géométrie des territoires (Terre) ----------------
  // Pipeline : simulation -> parcelles modifiées -> calcul géométrique (travailleur, seuls les pays touchés)
  // -> nouvel état (maillages + lignes de front) -> interpolation visuelle -> rendu.
  // Deux cartes des pièces (état précédent / nouvel état) sont mises à jour seulement dans les rectangles
  // modifiés ; le shader fait avancer le front de l'une à l'autre à chaque image (uMix), dans l'ordre réel
  // des captures (texture des instants de capture). Le rendu ne dépend donc jamais du rythme des calculs.
  setTerritoryGeometry(grid, polysF32) {
    this.terrGrid = grid;
    const TW = this.renderer.capabilities.maxTextureSize >= 8192 ? 8192 : 4096;
    const mk = () => new THREE.WebGLRenderTarget(TW, TW / 2, { format: THREE.RGFormat, type: THREE.UnsignedByteType, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, depthBuffer: false, generateMipmaps: false });
    this.terrNext = mk(); this.terrPrev = mk();
    this.terrScene = new THREE.Scene();
    this.terrCam = new THREE.OrthographicCamera(-180, 180, -90, 90, -1, 1);   // ligne 0 de la texture = nord (comme les autres cartes)
    this.terrMat = new THREE.ShaderMaterial({
      vertexShader: 'attribute vec2 aKey; varying vec2 vK; void main() { vK = aKey / 255.0; gl_Position = projectionMatrix * modelViewMatrix * vec4(position.xy, 0.0, 1.0); }',
      fragmentShader: 'varying vec2 vK; void main() { gl_FragColor = vec4(vK, 0.0, 1.0); }',
      side: THREE.DoubleSide, depthTest: false, depthWrite: false,
    });
    // instants de capture (0..1 dans l'intervalle entre deux états), à la résolution de la grille, filtrés
    this.terrFData = new Uint8Array(grid.W * grid.H);
    this.terrF = new THREE.DataTexture(this.terrFData, grid.W, grid.H, THREE.RedFormat, THREE.UnsignedByteType);
    this.terrF.minFilter = this.terrF.magFilter = THREE.LinearFilter; this.terrF.generateMipmaps = false; this.terrF.needsUpdate = true;
    this.terrFCells = [];
    this.terrMeshes = new Map();       // pays d'origine -> maillage (cache)
    this.terrBoxes = new Map();        // pays d'origine -> rectangle (lon/lat)
    this.frontMeshes = new Map();      // pays d'origine -> lignes de front (nouvel état)
    this.frontOld = [];                // lignes de front de l'état précédent (effacées en fin d'animation)
    this.frontMat = ribbonMaterial({ color: 0x0a1016, width: 1.6, opacity: 0.85, sideTest: true, lift: 0.0002 });
    this.terrBusy = false; this.terrAt = -1e9; this.terrSnapT = 0; this.terrLastRects = [];
    this.terrMix = 1; this.terrMixT0 = 0; this.terrMixDur = 0.4; this.terrPending = null;
    this.stats.terr = { updates: 0, workerMs: 0, applyMs: 0, cells: 0 };
    const u = this.earthMat.uniforms;
    u.uTerr.value = this.terrNext.texture; u.uTerrPrev.value = this.terrPrev.texture; u.uTerrF.value = this.terrF;
    u.uTerrSize.value.set(TW, TW / 2);
    const g = grid;
    const init = { type: 'init', polys: polysF32, grid: { n: g.n, nGrid: g.nGrid, W: g.W, H: g.H, RES: g.RES, origin: g.origin, pos: g.pos, indexAt: g.indexAt, lat: g.lat, lon: g.lon } };
    // plusieurs travailleurs en parallèle (chacun une part des pays) ; un état n'est appliqué que lorsque
    // toutes les parts sont prêtes
    try {
      const N = Math.max(1, Math.min(4, (navigator.hardwareConcurrency || 4) - 2));
      this.geoWorkers = [];
      for (let i = 0; i < N; i++) {
        const w = new Worker(new URL('geoWorker.js', location.href));
        w.onmessage = (ev) => this._terrPart(ev.data);
        w.onerror = (e) => { console.warn('géométrie (travailleur)', e.message); this.geoWorkers = null; this.terrBusy = false; this._terrLocal(init); this.territory.geoAll = true; };
        w.postMessage({ ...init, part: [i, N] });
        if (this._pendingOverrides) w.postMessage({ type: 'overrides', list: this._pendingOverrides });
        this.geoWorkers.push(w);
      }
    } catch (e) { this.geoWorkers = null; this._terrLocal(init); }
  }
  _terrPart(m) {
    if (!m || m.type !== 'result' || !this.terrParts) return;
    this.terrParts.out.push(...m.out); this.terrParts.ms = Math.max(this.terrParts.ms, m.ms);
    if (--this.terrParts.left > 0) return;
    const all = this.terrParts; this.terrParts = null;
    this._terrResult({ type: 'result', out: all.out, ms: all.ms });
  }
  // à défaut de travailleur : même calcul, exécuté directement
  _terrLocal(init) { this.terrCore = createGeometryCore(); this.terrCore(init); if (this._pendingOverrides) this.terrCore({ type: 'overrides', list: this._pendingOverrides }); }
  // frontières dessinées à la main (Nation Simulator) : transmises au calcul géométrique, puis recalcul complet
  setBorderOverrides(list) {
    this._pendingOverrides = list || [];
    const msg = { type: 'overrides', list: this._pendingOverrides };
    if (this.geoWorkers) for (const w of this.geoWorkers) w.postMessage(msg);
    else if (this.terrCore) this.terrCore(msg);
    if (this.territory) this.territory.geoAll = true;
  }
  _terrActive() { return !!(this.terrGrid && this.hiresOn && this.grid === this.terrGrid); }

  // étape 1 -> 2 : parcelles modifiées envoyées au calcul géométrique (rythme limité, un calcul à la fois)
  _updateTerritory() {
    if (!this._terrActive()) return;
    this._terrAnimate();
    const T = this.territory;
    T.geoDirty.clear();
    if (this.terrBusy) return;
    const full = T.geoAll;
    if (!full && !T.changedCells.size) return;
    const now = performance.now();
    if (!full && now - this.terrAt < 250) return;
    this.terrAt = now;
    let msg;
    if (full) {
      T.geoAll = false; T.changedCells.clear();
      const keys = new Int32Array(this.grid.n);
      for (let i = 0; i < keys.length; i++) keys[i] = T.keyOf(i);
      msg = { type: 'update', full: true, keys };
    } else {
      const cells = Int32Array.from(T.changedCells), keys = new Int32Array(cells.length);
      for (let k = 0; k < cells.length; k++) keys[k] = T.keyOf(cells[k]);
      T.changedCells.clear();
      msg = { type: 'update', cells, keys };
    }
    this.terrBusy = true;
    this.terrReq = { full, cells: msg.cells ? msg.cells.slice() : null, t: this.time };   // copie : le tableau envoyé est transféré au travailleur
    this.stats.terr.cells += msg.cells ? msg.cells.length : 0;
    if (this.geoWorkers) { this.terrParts = { left: this.geoWorkers.length, out: [], ms: 0 }; for (const w of this.geoWorkers) w.postMessage(msg); }
    else { const req = this.terrReq; const r = this.terrCore({ ...msg, cells: msg.cells ? Int32Array.from(msg.cells) : undefined }); this.terrReq = req; this._terrResult(r.msg); }
  }

  // étape 3 : nouvel état reçu -> maillages remplacés pour les seuls pays recalculés, cartes des pièces
  // mises à jour dans les rectangles modifiés, animation de l'état précédent vers le nouvel état
  _terrResult(m) {
    if (!m || m.type !== 'result') return;
    const st = this.stats.terr; st.updates++; st.workerMs += m.ms;
    const req = this.terrReq || { full: true, cells: null, t: this.time };
    if (!m.out.length) { this.terrBusy = false; return; }
    // une animation est en cours : le nouvel état attend qu'elle se termine (elle accélère un peu) ;
    // aucun nouveau calcul n'est demandé entre-temps -> jamais de saut visible entre deux états
    if (this.terrMix < 1 && !req.full) { this.terrPending = { m, req }; return; }
    this._terrApplyResult(m, req);
  }
  _terrApplyResult(m, req) {
    this.terrBusy = false;
    const st = this.stats.terr;
    const tA = performance.now();
    this._terrFinish();
    const rects = [];
    for (const r of m.out) {
      const old = this.terrMeshes.get(r.t);
      if (old) { this.terrScene.remove(old); old.geometry.dispose(); }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(r.mesh.pos, 2));
      g.setAttribute('aKey', new THREE.BufferAttribute(r.mesh.key, 2));
      g.setIndex(new THREE.BufferAttribute(r.mesh.idx, 1));
      g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 400);   // pas de calcul automatique (positions 2D)
      const mesh = new THREE.Mesh(g, this.terrMat); mesh.frustumCulled = false;
      this.terrScene.add(mesh); this.terrMeshes.set(r.t, mesh);
      const ob = this.terrBoxes.get(r.t);
      rects.push(r.bbox); if (ob) rects.push(ob);
      this.terrBoxes.set(r.t, r.bbox);
      // lignes de front : l'ancien tracé reste affiché pendant l'animation, le nouveau apparaît
      const of = this.frontMeshes.get(r.t);
      if (of) this.frontOld.push(of);
      if (r.fronts) { const fm = ribbonMesh(r.fronts, { material: this.frontMat, order: 4 }); this.scene.add(fm); this.frontMeshes.set(r.t, fm); } else this.frontMeshes.delete(r.t);
    }
    // l'ancien « nouvel état » devient l'état précédent ; la carte libérée reçoit le nouvel état, redessinée
    // seulement là où elle diffère (rectangles de cette mise à jour et de la précédente)
    const tmp = this.terrPrev; this.terrPrev = this.terrNext; this.terrNext = tmp;
    this._terrDraw(this.terrNext, req.full ? null : rects.concat(this.terrLastRects));
    this.terrLastRects = req.full ? [] : rects;
    if (req.full) this._terrDraw(this.terrPrev, null);
    const u = this.earthMat.uniforms;
    u.uTerr.value = this.terrNext.texture; u.uTerrPrev.value = this.terrPrev.texture;
    // instants de capture des parcelles modifiées, ramenés à 0..1 entre l'état précédent et celui-ci
    const t0 = this.terrSnapT, t1 = req.t, T = this.territory, W = this.grid.W;
    for (const p of this.terrFCells) this.terrFData[p] = 0;
    this.terrFCells = [];
    if (!req.full && req.cells) {
      const span = Math.max(1e-3, t1 - t0);
      for (const c of req.cells) {
        const p = this.grid.pos[c]; if (p < 0) continue;
        const f = Math.max(0.02, Math.min(1, (T.cellTime[c] - t0) / span));
        this.terrFData[p] = Math.round(f * 255); this.terrFCells.push(p);
      }
    }
    this.terrF.needsUpdate = true;
    // durée de l'animation : l'intervalle réel entre les deux états (le front avance à vitesse continue)
    this.terrMixDur = req.full ? 0 : Math.min(1.6, Math.max(0.3, t1 - t0));
    this.terrSnapT = t1;
    this.terrMixT0 = this.time;
    this.terrMix = req.full ? 1 : 0;
    st.applyMs += performance.now() - tA;
    this.version = (this.version || 0) + 1;
  }
  _terrAnimate() {
    if (this.terrMix < 1) {
      const dt = Math.max(0, this.time - (this.terrLastT ?? this.time));
      const speed = this.terrPending ? 2.5 : 1;                       // un état attend : on rattrape doucement
      this.terrMix = this.terrMixDur > 0 ? Math.min(1, this.terrMix + dt * speed / this.terrMixDur) : 1;
      if (this.terrMix >= 1) this._terrFinish();
    }
    this.terrLastT = this.time;
    if (this.terrMix >= 1 && this.terrPending) { const { m, req } = this.terrPending; this.terrPending = null; this._terrApplyResult(m, req); }
  }
  _terrFinish() {
    this.terrMix = 1;
    for (const m of this.frontOld) { this.scene.remove(m); m.geometry.dispose(); }
    this.frontOld = [];
  }
  // rastérisation des pièces dans une carte, limitée aux rectangles donnés (null = toute la carte)
  _terrDraw(rt, rects) {
    const R = this.renderer, W = rt.width, H = rt.height;
    const prevRT = R.getRenderTarget();
    const list = rects ? rects.filter(Boolean).map(([x0, y0, x1, y1]) => {
      const px0 = Math.max(0, Math.floor((x0 + 180) / 360 * W) - 3), px1 = Math.min(W, Math.ceil((x1 + 180) / 360 * W) + 3);
      const py0 = Math.max(0, Math.floor((90 - y1) / 180 * H) - 3), py1 = Math.min(H, Math.ceil((90 - y0) / 180 * H) + 3);
      return [px0, py0, Math.max(1, px1 - px0), Math.max(1, py1 - py0)];
    }) : [[0, 0, W, H]];
    R.setClearColor(0x000000, 0);
    for (const [x, y, w, h] of list) {
      rt.scissor.set(x, y, w, h); rt.scissorTest = !!rects;
      R.setRenderTarget(rt);
      R.clear(true, false, false);
      R.render(this.terrScene, this.terrCam);
    }
    rt.scissorTest = false;
    R.setRenderTarget(prevRT);
    R.setClearColor(0x03060d, 1);
  }
  _terrUniforms(m, res, d) {
    const u = m.material.uniforms;
    u.uRes.value.copy(res);
    if (this.terrNext) { u.uTerr.value = this.terrNext.texture; u.uTerrPrev.value = this.terrPrev.texture; u.uTerrF.value = this.terrF; u.uMix.value = this.terrMix; u.uTerrSize.value.set(this.terrNext.width, this.terrNext.height); }
    const pxAng = (d - 1) * 2 * Math.tan(this.camera.fov * Math.PI / 360) / Math.max(1, this.viewH);
    u.uEps.value = Math.max(1.6 * 2 * Math.PI / (this.terrNext ? this.terrNext.width : 8192), 2.5 * pxAng);
    u.uDashKm.value = Math.max(4, 6371 * pxAng * 9);
    u.uSideTest.value = m.material.userData.sideTest && this._terrActive() ? 1 : 0;
  }
  _updateVector() {
    if (!this.vec) return;
    const d = this.cam.dist, on = !!this.hiresOn && this.showBordersVec !== false;
    if (on && d < 1.8 && !this.vec.fine) this.vec.fine = this._buildVector(0);
    const pr = this.renderer.getPixelRatio();
    const res = new THREE.Vector2(this.viewW * pr / 2, this.viewH * pr / 2);
    const k = Math.max(0, Math.min(1, (3.2 - d) / 2.1));          // 0 vue lointaine -> 1 très près
    // niveau de détail du relief comparable à celui du maillage au centre de la vue
    const capA = this.earthMat.uniforms.uCapAngle.value, texel = 2 * Math.PI / this.relief.W;
    const lod = Math.max(0, Math.log2((1.6 * Math.pow(0.35, 0.6) * capA / 230) / texel) + 0.5);
    const setRel = (m) => { const u = m.material.uniforms; u.uRelief.value = this.reliefTex; u.uExag.value = EXAG_KM; u.uLod.value = lod; };
    if (this.regionRibbon) setRel(this.regionRibbon);
    for (const [key, grp] of Object.entries(this.vec)) {
      if (!grp) continue;
      grp.visible = on && (key === 'fine' ? d < 1.8 : d >= 1.8);
      if (!grp.visible) continue;
      const [coast, border] = grp.children;
      for (const m of grp.children) { setRel(m); this._terrUniforms(m, res, d); }
      border.material.uniforms.uWidth.value = (1.05 + 1.0 * k) * pr;
      coast.material.uniforms.uWidth.value = (0.8 + 0.5 * k) * pr;
      coast.material.uniforms.uOpacity.value = 0.35 + 0.3 * k;
    }
    if (this.regionRibbon) {
      const u = this.regionRibbon.material.uniforms;
      u.uRes.value.copy(res); u.uWidth.value = 1.0 * pr;
      u.uOpacity.value = this.detailsOn !== false && this.hiresOn ? 0.32 * Math.max(0, Math.min(1, (1.7 - d) / 0.32)) : 0;
      this.regionRibbon.visible = u.uOpacity.value > 0.01;
    }
    // lignes de front (matériau partagé : un seul jeu d'uniformes pour tous les pays)
    if (this.frontMat) {
      const fv = on && this._terrActive();
      for (const fm of this.frontMeshes.values()) fm.visible = fv;
      for (const fm of this.frontOld) fm.visible = fv;
      if (fv) { const fake = { material: this.frontMat }; setRel(fake); this._terrUniforms(fake, res, d); this.frontMat.uniforms.uWidth.value = (1.05 + 1.0 * k) * pr; }
    }
    this.earthMat.uniforms.uTerrOn.value = this._terrActive() ? 1 : 0;
    this.earthMat.uniforms.uMix.value = this.terrMix ?? 1;
    this.earthMat.uniforms.uVecOn.value = on ? 1 : 0;
    this.earthMat.uniforms.uMaskOn.value = this.hiresOn && this.maskTex ? 1 : 0;
    if (this.maskTex) this.earthMat.uniforms.uMask.value = this.maskTex;
  }
  _updateDetails() {
    if (!this.details) return;
    const d = this.cam.dist;
    const fade = (near, far) => Math.max(0, Math.min(1, (far - d) / (far - near)));
    const on = this.detailsOn !== false;
    if (this.lakeMesh) { this.lakeMesh.material.opacity = on ? 0.9 * fade(2.2, 3.2) : 0; this.lakeMesh.visible = this.lakeMesh.material.opacity > 0.01; }
    if (this.roadLines) { this.roadLines.material.opacity = on ? 0.32 * fade(1.25, 1.55) : 0; this.roadLines.visible = this.roadLines.material.opacity > 0.01; }
    if (this.cityPoints) {
      const u = this.cityPoints.material.uniforms;
      u.uOpacity.value = on ? fade(1.32, 1.62) : 0;
      u.uScale.value = Math.min(1.6, this.renderer.getPixelRatio() * (1.25 - Math.min(0.5, (d - 1.1) * 0.6)));
      this.cityPoints.visible = u.uOpacity.value > 0.01;
    }
  }

  // terrain modifié (éditeur) : mise à jour de la texture de relief sur une zone
  refreshRelief(x0 = 0, y0 = 0, w = this.relief.W, h = this.relief.H) {
    const gl = this.renderer.getContext();
    const props = this.renderer.properties.get(this.reliefTex);
    if (!props.__webglTexture) { this.reliefTex.needsUpdate = true; return; }
    const src = this.relief.elev;
    const toHalf = THREE.DataUtils.toHalfFloat;
    gl.bindTexture(gl.TEXTURE_2D, props.__webglTexture);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 2);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    // niveau 0 puis niveaux réduits (moyennes 2×2) sur la même zone
    let W = this.relief.W, H = this.relief.H;
    let level = src, lx0 = Math.max(0, x0), ly0 = Math.max(0, y0), lx1 = Math.min(W, x0 + w), ly1 = Math.min(H, y0 + h);
    let lvl = 0;
    const mips = this.reliefTex.mipmaps;
    for (;;) {
      const rw = lx1 - lx0, rh = ly1 - ly0;
      if (rw > 0 && rh > 0) {
        const buf = new Uint16Array(rw * rh);
        for (let y = 0; y < rh; y++) for (let x = 0; x < rw; x++) buf[y * rw + x] = toHalf(level[(ly0 + y) * W + lx0 + x]);
        gl.texSubImage2D(gl.TEXTURE_2D, lvl, lx0, ly0, rw, rh, gl.RED, gl.HALF_FLOAT, buf);
        if (mips && mips[lvl]) for (let y = 0; y < rh; y++) mips[lvl].data.set(buf.subarray(y * rw, (y + 1) * rw), (ly0 + y) * W + lx0);
      }
      if (W === 1 && H === 1) break;
      const nW = Math.max(1, W >> 1), nH = Math.max(1, H >> 1);
      const nxt = this._reliefLevels && this._reliefLevels[lvl + 1];
      if (!nxt) break;
      const nx0 = lx0 >> 1, ny0 = ly0 >> 1, nx1 = Math.min(nW, (lx1 + 1) >> 1), ny1 = Math.min(nH, (ly1 + 1) >> 1);
      for (let y = ny0; y < ny1; y++) {
        const ya = Math.min(H - 1, y * 2), yb = Math.min(H - 1, y * 2 + 1);
        for (let x = nx0; x < nx1; x++) {
          const xa = Math.min(W - 1, x * 2), xb = Math.min(W - 1, x * 2 + 1);
          nxt[y * nW + x] = (level[ya * W + xa] + level[ya * W + xb] + level[yb * W + xa] + level[yb * W + xb]) * 0.25;
        }
      }
      level = nxt; W = nW; H = nH; lx0 = nx0; ly0 = ny0; lx1 = nx1; ly1 = ny1; lvl++;
    }
    this._reliefLevels[0] = src;
  }

  // cercle du pinceau sur le relief ; dir = null pour le masquer
  setBrush(dir, radiusKm = 200, color = '#ffffff') {
    if (!dir) { this.brushLine.visible = false; return; }
    const c = new THREE.Vector3(...dir);
    const t = new THREE.Vector3(0, 1, 0).cross(c);
    if (t.lengthSq() < 1e-6) t.set(1, 0, 0);
    t.normalize();
    const b = new THREE.Vector3().crossVectors(c, t);
    const ang = radiusKm / 6371;
    const P = this.brushLine.geometry.attributes.position.array;
    for (let k = 0; k < 128; k++) {
      const a = (k / 128) * Math.PI * 2;
      const v = c.clone().multiplyScalar(Math.cos(ang)).addScaledVector(t, Math.sin(ang) * Math.cos(a)).addScaledVector(b, Math.sin(ang) * Math.sin(a));
      const R = this.surfaceR(v.x, v.y, v.z) + 0.0015;
      P[k * 3] = v.x * R; P[k * 3 + 1] = v.y * R; P[k * 3 + 2] = v.z * R;
    }
    this.brushLine.geometry.attributes.position.needsUpdate = true;
    this.brushLine.material.color.set(color);
    this.brushLine.visible = true;
  }

  // relief : altitudes en km (demi-flottants) avec niveaux de détail précalculés
  _buildReliefTexture() {
    const levels = this.relief.mipLevels();
    this._reliefLevels = levels.map((lv) => lv.data);
    const toHalf = THREE.DataUtils.toHalfFloat;
    const mips = levels.map((lv) => {
      const d = new Uint16Array(lv.data.length);
      for (let k = 0; k < d.length; k++) d[k] = toHalf(lv.data[k]);
      return { data: d, width: lv.width, height: lv.height };
    });
    const tex = new THREE.DataTexture(mips[0].data, mips[0].width, mips[0].height, THREE.RedFormat, THREE.HalfFloatType);
    tex.mipmaps = mips;
    tex.generateMipmaps = false;
    tex.minFilter = THREE.LinearMipmapLinearFilter;
    tex.magFilter = THREE.LinearFilter;
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.ClampToEdgeWrapping;
    tex.unpackAlignment = 2;
    tex.needsUpdate = true;
    return tex;
  }

  // rayon de la surface (relief compris) au-dessus de chaque parcelle
  _computeCellRadius() {
    const g = this.grid;
    this.cellR = new Float32Array(g.n);
    for (let i = 0; i < g.n; i++) this.cellR[i] = 1 + Math.max(0, this.relief.heightKm(g.lat[i], g.lon[i])) * EXAG_KM;
  }

  // rayon de la surface sous un point (x, y, z quelconques)
  surfaceR(x, y, z) {
    return 1 + Math.max(0, this.relief.heightAtXYZ(x, y, z)) * EXAG_KM;
  }

  // ---------------- paramètres des entités ----------------
  // mode : 0 = neutre (gris), 1 = pays hors simulation (atténué), 2 = participant
  // Couleurs : palette cartographique (deux pays voisins n'ont jamais la même couleur) ;
  // en partie, les participants reçoivent des couleurs toutes différentes.
  updateEntityParams(owner, participants = null) {
    const ents = this.entities;
    for (const e of ents) {
      if (e && e.kind === 'country' && this.mapColor[e.index]) e.color = this.mapColor[e.index];
    }
    if (participants && participants.size > 1) distinctParticipantColors(ents, participants, this.grid, owner);
    for (const e of ents) if (e && e.colorOverride) e.color = e.colorOverride;   // couleur choisie par le joueur (NATION SIMULATOR)
    this.colors = [];
    for (const e of ents) {
      if (!e) continue;
      const k = e.index;
      if (k >= MAX_ENT) continue;
      const mode = e.kind === 'neutral' || e.removed ? 0 : (!participants || participants.has(k)) ? 2 : 1;
      const col = this.focusEntity >= 0 && k !== this.focusEntity && mode === 2 ? othersColor(e.color, this.othersMode) : hexRgb(e.color);   // couleur d'affichage des autres pays
      this.colors[k] = e.color;
      this.params[k * 4] = col[0]; this.params[k * 4 + 1] = col[1]; this.params[k * 4 + 2] = col[2]; this.params[k * 4 + 3] = mode;
    }
    this.paramsTex.needsUpdate = true;
    this.participants = participants;
  }

  // CARTES THÉMATIQUES : couleur de chaque pays selon une mesure (colorOf(e) -> '#rrggbb' ou null = gris)
  setThematic(colorOf) {
    this.thematic = !!colorOf;
    for (const e of this.entities || []) {
      if (!e) continue;
      const k = e.index;
      if (k >= MAX_ENT || this.params[k * 4 + 3] === 0) continue;
      const hex = colorOf ? (colorOf(e) || '#5b636b') : (this.colors[k] || '#888888');
      const col = hexRgb(hex);
      this.params[k * 4] = col[0]; this.params[k * 4 + 1] = col[1]; this.params[k * 4 + 2] = col[2];
    }
    this.paramsTex.needsUpdate = true;
  }

  addEntity(e) {
    if (e && e.index < MAX_ENT) {
      const col = hexRgb(e.color);
      this.colors[e.index] = e.color;
      this.params.set([col[0], col[1], col[2], 2], e.index * 4);
      this.paramsTex.needsUpdate = true;
    }
  }

  setWorldOwner(owner, participants = null, occupied = null) {
    this.territoryVersion = (this.territoryVersion || 0) + 1;
    this.territory.setAll(owner, occupied);
    this.updateEntityParams(owner, participants);
    this.microOwner = owner;
  }

  applyCaptures(captures, now) {
    const g = this.grid;
    this.territoryVersion = (this.territoryVersion || 0) + 1;
    for (const c of captures) {
      if (c.official) { this.territory.setOfficial(c.i, now); continue; }
      this.territory.setOwner(c.i, c.by, c.from, now, !!c.occ);
      if (this.rings.length < 10 && Math.random() < 0.025) {
        const R = this.cellR[c.i] + 0.0005;
        this.rings.push({ i: c.i, x: g.xyz[c.i * 3] * R, y: g.xyz[c.i * 3 + 1] * R, z: g.xyz[c.i * 3 + 2] * R, t0: now, dur: 0.9, size: 0.012, strong: 0, color: this.colors[c.by] || '#ffffff' });
      }
    }
  }

  // édition (Contrôle total) : transition courte, jamais instantanée
  setOwnerInstant(i, e, prev = null) {
    this.territoryVersion = (this.territoryVersion || 0) + 1;
    const g = this.grid;
    const k = g.pos[i] >= 0 ? g.pos[i] * 4 : -1;
    const before = prev !== null ? prev : (k >= 0 ? (this.territory.a[k] | (this.territory.a[k + 1] << 8)) : e);
    this.territory.setOwner(i, e, before === 65534 ? 65535 : before, this.time);
  }

  pulse(cell, color = '#ffd65a', strong = 1) {
    const g = this.grid;
    if (cell < 0) return;
    const R = this.cellR[cell] + 0.0005;
    this.rings.push({ i: cell, x: g.xyz[cell * 3] * R, y: g.xyz[cell * 3 + 1] * R, z: g.xyz[cell * 3 + 2] * R, t0: this.time, dur: 1.6, size: 0.05, strong, color });
    if (this.rings.length > MAX_RINGS) this.rings.shift();
  }

  // ---------------- marqueurs ----------------
  _initMarkers() {
    const quad = new THREE.PlaneGeometry(1, 1);
    const g = new THREE.InstancedBufferGeometry();
    g.index = quad.index;
    g.setAttribute('position', quad.getAttribute('position'));
    this.mDir = new Float32Array(MAX_MARKERS * 3);
    this.headings = new Map();
    this.mPos = new Float32Array(MAX_MARKERS * 3);
    this.mColor = new Float32Array(MAX_MARKERS * 3);
    this.mData = new Float32Array(MAX_MARKERS * 4);
    g.setAttribute('aDir', new THREE.InstancedBufferAttribute(this.mDir, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aPos', new THREE.InstancedBufferAttribute(this.mPos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aColor', new THREE.InstancedBufferAttribute(this.mColor, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aData', new THREE.InstancedBufferAttribute(this.mData, 4).setUsage(THREE.DynamicDrawUsage));
    g.instanceCount = 0;
    this.markerGeo = g;
    this.markerMat = new THREE.ShaderMaterial({
      glslVersion: THREE.GLSL3, vertexShader: S.markerVertex, fragmentShader: S.markerFragment,
      uniforms: { uTime: { value: 0 }, uPixel: { value: 0.001 } },
      transparent: true, depthTest: false, depthWrite: false, side: THREE.DoubleSide,
    });
    this.markers = new THREE.Mesh(g, this.markerMat);
    this.markers.frustumCulled = false;
    this.markers.renderOrder = 5;
    this.scene.add(this.markers);
  }

  _initRings() {
    const quad = new THREE.PlaneGeometry(1, 1).translate(0.5, 0.5, 0);
    const g = new THREE.InstancedBufferGeometry();
    g.index = quad.index;
    g.setAttribute('position', quad.getAttribute('position'));
    this.rPos = new Float32Array(MAX_RINGS * 3);
    this.rData = new Float32Array(MAX_RINGS * 4);
    this.rColor = new Float32Array(MAX_RINGS * 3);
    g.setAttribute('aPos', new THREE.InstancedBufferAttribute(this.rPos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aData', new THREE.InstancedBufferAttribute(this.rData, 4).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aColor', new THREE.InstancedBufferAttribute(this.rColor, 3).setUsage(THREE.DynamicDrawUsage));
    g.instanceCount = 0;
    this.ringGeo = g;
    const m = new THREE.ShaderMaterial({
      glslVersion: THREE.GLSL3, vertexShader: S.ringVertex, fragmentShader: S.ringFragment,
      uniforms: { uPixel: { value: 0.001 } }, transparent: true, depthWrite: false, depthTest: false, blending: THREE.AdditiveBlending,
    });
    this.ringMesh = new THREE.Mesh(g, m);
    this.ringMesh.renderOrder = 4;
    this.ringMesh.frustumCulled = false;
    this.scene.add(this.ringMesh);
  }

  // ---------------- navires / avions / routes ----------------
  _initVehicles() {
    // navire de transport (axe avant = +Z, haut = +Y) : coque effilée, pont, passerelle, cheminée, conteneurs
    const hullShape = new THREE.Shape();
    hullShape.moveTo(-0.26, -1.0);
    hullShape.bezierCurveTo(-0.34, -0.7, -0.34, 0.3, -0.3, 0.55);
    hullShape.quadraticCurveTo(-0.18, 0.95, 0, 1.12);
    hullShape.quadraticCurveTo(0.18, 0.95, 0.3, 0.55);
    hullShape.bezierCurveTo(0.34, 0.3, 0.34, -0.7, 0.26, -1.0);
    hullShape.closePath();
    const hull = new THREE.ExtrudeGeometry(hullShape, { depth: 0.26, bevelEnabled: true, bevelThickness: 0.03, bevelSize: 0.03, bevelSegments: 2, curveSegments: 10 });
    hull.rotateX(Math.PI / 2); hull.translate(0, 0.05, 0);   // extrusion vers le bas (sous la ligne du pont)
    const deck = new THREE.ShapeGeometry(hullShape, 10); deck.rotateX(-Math.PI / 2); deck.scale(0.9, 1, 0.9); deck.translate(0, 0.075, 0);
    const bridge = new THREE.BoxGeometry(0.42, 0.26, 0.3).translate(0, 0.2, -0.62);
    const bridgeTop = new THREE.BoxGeometry(0.5, 0.05, 0.22).translate(0, 0.35, -0.6);
    const funnel = new THREE.CylinderGeometry(0.07, 0.09, 0.3, 10).translate(0, 0.3, -0.85);
    const crates = [
      [new THREE.BoxGeometry(0.2, 0.14, 0.26).translate(-0.11, 0.14, -0.15), 0xc0392b],
      [new THREE.BoxGeometry(0.2, 0.14, 0.26).translate(0.11, 0.14, -0.15), 0x2e86c1],
      [new THREE.BoxGeometry(0.2, 0.14, 0.26).translate(-0.11, 0.14, 0.15), 0xf1c40f],
      [new THREE.BoxGeometry(0.2, 0.14, 0.26).translate(0.11, 0.14, 0.15), 0x27ae60],
    ];
    const shipGeo = mergeColored([[hull, 0x2b3645], [deck, 0xb9a88a], [bridge, 0xf2f2f0], [bridgeTop, 0x9aa5b1], [funnel, 0x1b1f27], ...crates]);
    this.shipMesh = new THREE.InstancedMesh(shipGeo, new THREE.MeshLambertMaterial({ vertexColors: true }), MAX_SHIPS);
    this.shipMesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(MAX_SHIPS * 3).fill(1), 3);
    this.shipMesh.count = 0;
    this.shipMesh.frustumCulled = false;
    // avion de transport : fuselage profilé, ailes en flèche, dérive
    const fus = new THREE.CylinderGeometry(0.1, 0.075, 1.3, 12); fus.rotateX(Math.PI / 2);
    const nose = new THREE.SphereGeometry(0.1, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2); nose.rotateX(Math.PI / 2); nose.translate(0, 0, 0.65);
    const wingShape = new THREE.Shape();
    wingShape.moveTo(0.06, 0.18); wingShape.lineTo(0.95, -0.2); wingShape.lineTo(0.95, -0.32); wingShape.lineTo(0.06, -0.15);
    wingShape.lineTo(-0.06, -0.15); wingShape.lineTo(-0.95, -0.32); wingShape.lineTo(-0.95, -0.2); wingShape.lineTo(-0.06, 0.18); wingShape.closePath();
    const wings = new THREE.ExtrudeGeometry(wingShape, { depth: 0.035, bevelEnabled: false }); wings.rotateX(-Math.PI / 2); wings.translate(0, 0, 0);
    const tailShape = new THREE.Shape();
    tailShape.moveTo(0.05, -0.45); tailShape.lineTo(0.4, -0.62); tailShape.lineTo(0.4, -0.68); tailShape.lineTo(-0.4, -0.68); tailShape.lineTo(-0.4, -0.62); tailShape.lineTo(-0.05, -0.45); tailShape.closePath();
    const stab = new THREE.ExtrudeGeometry(tailShape, { depth: 0.025, bevelEnabled: false }); stab.rotateX(-Math.PI / 2);
    const finShape = new THREE.Shape();
    finShape.moveTo(-0.45, 0); finShape.lineTo(-0.68, 0.34); finShape.lineTo(-0.6, 0.34); finShape.lineTo(-0.3, 0); finShape.closePath();
    const fin = new THREE.ExtrudeGeometry(finShape, { depth: 0.025, bevelEnabled: false }); fin.rotateY(-Math.PI / 2); fin.translate(0.012, 0.05, 0);
    const planeGeo = mergeColored([[fus, 0xf4f6f8], [nose, 0xdfe4ea], [wings, 0xc9d1da], [stab, 0xc9d1da], [fin, 0xffffff]]);
    this.planeMesh = new THREE.InstancedMesh(planeGeo, new THREE.MeshLambertMaterial({ vertexColors: true }), MAX_SHIPS);
    this.planeMesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(MAX_SHIPS * 3).fill(1), 3);
    this.planeMesh.count = 0;
    this.planeMesh.frustumCulled = false;
    // navire de guerre (flotte) : coque grise effilée, superstructure, tourelles
    const wHullShape = new THREE.Shape();
    wHullShape.moveTo(-0.2, -1.05); wHullShape.lineTo(-0.24, 0.2); wHullShape.quadraticCurveTo(-0.16, 0.9, 0, 1.25);
    wHullShape.quadraticCurveTo(0.16, 0.9, 0.24, 0.2); wHullShape.lineTo(0.2, -1.05); wHullShape.closePath();
    const wHull = new THREE.ExtrudeGeometry(wHullShape, { depth: 0.2, bevelEnabled: true, bevelThickness: 0.02, bevelSize: 0.02, bevelSegments: 1, curveSegments: 8 });
    wHull.rotateX(Math.PI / 2); wHull.translate(0, 0.05, 0);
    const wDeck = new THREE.ShapeGeometry(wHullShape, 8); wDeck.rotateX(-Math.PI / 2); wDeck.scale(0.9, 1, 0.9); wDeck.translate(0, 0.07, 0);
    const wSup = new THREE.BoxGeometry(0.26, 0.22, 0.5).translate(0, 0.18, -0.15);
    const wMast = new THREE.CylinderGeometry(0.02, 0.03, 0.4, 6).translate(0, 0.45, -0.1);
    const wT1 = new THREE.CylinderGeometry(0.09, 0.1, 0.08, 10).translate(0, 0.12, 0.55);
    const wG1 = new THREE.CylinderGeometry(0.02, 0.02, 0.3, 6); wG1.rotateX(Math.PI / 2); wG1.translate(0, 0.14, 0.72);
    const wT2 = new THREE.CylinderGeometry(0.08, 0.09, 0.07, 10).translate(0, 0.11, -0.72);
    const warGeo = mergeColored([[wHull, 0x4a5563], [wDeck, 0x7b8694], [wSup, 0xc9d1da], [wMast, 0x39414c], [wT1, 0x5d6875], [wG1, 0x39414c], [wT2, 0x5d6875]]);
    this.warMesh = new THREE.InstancedMesh(warGeo, new THREE.MeshLambertMaterial({ vertexColors: true }), MAX_SHIPS);
    this.warMesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(MAX_SHIPS * 3).fill(1), 3);
    this.warMesh.count = 0; this.warMesh.frustumCulled = false;
    // avion de combat (frappes aériennes) : fuselage fin, ailes delta, double dérive
    const jf = new THREE.CylinderGeometry(0.05, 0.07, 1.1, 10); jf.rotateX(Math.PI / 2);
    const jn = new THREE.ConeGeometry(0.05, 0.3, 10); jn.rotateX(Math.PI / 2); jn.translate(0, 0, 0.7);
    const dShape = new THREE.Shape(); dShape.moveTo(0, 0.25); dShape.lineTo(0.62, -0.35); dShape.lineTo(-0.62, -0.35); dShape.closePath();
    const jw = new THREE.ExtrudeGeometry(dShape, { depth: 0.025, bevelEnabled: false }); jw.rotateX(-Math.PI / 2);
    const fShape = new THREE.Shape(); fShape.moveTo(-0.5, 0); fShape.lineTo(-0.6, 0.28); fShape.lineTo(-0.5, 0.28); fShape.lineTo(-0.3, 0); fShape.closePath();
    const jt1 = new THREE.ExtrudeGeometry(fShape, { depth: 0.02, bevelEnabled: false }); jt1.rotateY(-Math.PI / 2); jt1.translate(0.1, 0.03, 0);
    const jt2 = jt1.clone(); jt2.translate(-0.2, 0, 0);
    const jetGeo = mergeColored([[jf, 0x9aa5b1], [jn, 0x6c7784], [jw, 0x8a95a2], [jt1, 0x7b8694], [jt2, 0x7b8694]]);
    this.jetMesh = new THREE.InstancedMesh(jetGeo, new THREE.MeshLambertMaterial({ vertexColors: true }), MAX_SHIPS);
    this.jetMesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(MAX_SHIPS * 3).fill(1), 3);
    this.jetMesh.count = 0; this.jetMesh.frustumCulled = false;
    this.scene.add(this.shipMesh, this.planeMesh, this.warMesh, this.jetMesh);
    this.scene.add(new THREE.AmbientLight(0xffffff, 0.55));
    this.dirLight = new THREE.DirectionalLight(0xffffff, 1.4);
    this.scene.add(this.dirLight);
    // routes (lignes)
    this.routeGeo = new THREE.BufferGeometry();
    this.routeGeo.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(3 * 2 * 60000), 3).setUsage(THREE.DynamicDrawUsage));
    this.routeGeo.setAttribute('color', new THREE.Float32BufferAttribute(new Float32Array(3 * 2 * 60000), 3).setUsage(THREE.DynamicDrawUsage));
    this.routeGeo.setDrawRange(0, 0);
    this.routes = new THREE.LineSegments(this.routeGeo, new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false }));
    this.routes.frustumCulled = false;
    this.scene.add(this.routes);
    this.routesBuiltAt = -1;
  }

  _vehicleFrame(tr, alongKm) {
    // position et direction le long du trajet
    const p = tr.path;
    if (!tr._cum) {
      tr._cum = [0];
      for (let k = 1; k < p.length; k++) {
        const a = p[k - 1], b = p[k];
        tr._cum.push(tr._cum[k - 1] + Math.acos(Math.max(-1, Math.min(1, a[0] * b[0] + a[1] * b[1] + a[2] * b[2]))) * 6371);
      }
    }
    const cum = tr._cum;
    const d = Math.max(0, Math.min(cum[cum.length - 1], alongKm));
    let k = 1;
    while (k < cum.length - 1 && cum[k] < d) k++;
    const a = p[k - 1], b = p[k];
    const seg = cum[k] - cum[k - 1] || 1;
    const t = (d - cum[k - 1]) / seg;
    const pos = new THREE.Vector3(a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t).normalize();
    const dir = new THREE.Vector3(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
    return { pos, dir, frac: d / (cum[cum.length - 1] || 1) };
  }

  _updateVehicles(sim, alpha) {
    const m4 = new THREE.Matrix4();
    const camPos = this.camera.position;
    const pxWorld = 2 * Math.tan((this.camera.fov * Math.PI) / 360) / this.viewH;
    let ns = 0, np = 0, nw = 0, nj = 0;
    const col = new THREE.Color();
    const list = sim ? sim.transports : [];
    const extra = sim ? [...(sim.fleets || []), ...(sim.strikes || [])] : [];
    this.vehicleScreen = [];
    // navires arrivés : restent un instant à quai puis s'effacent
    const docked = sim && sim.docked ? sim.docked.map((d) => ({ ...d, id: -1, done: d.length, speed: 0, _dock: Math.max(0, (d.until - sim.time) / 2.2) })) : [];
    for (const tr of [...list, ...docked, ...extra]) {
      if (tr._dock !== undefined && tr.kind === 'plane') continue;
      if (!tr.path || tr.path.length < 2 || !(tr.length > 1)) continue;
      const along = tr.done + tr.speed * 0.05 * alpha;
      const f = this._vehicleFrame(tr, along);
      const up = f.pos.clone();
      let pos = f.pos.clone();
      const air = tr.kind === 'plane' || tr.kind === 'strike';
      if (tr.kind === 'strike') pos.multiplyScalar(Math.max(1.006 + 0.012 * Math.sin(Math.PI * f.frac * 2) ** 2, this.surfaceR(pos.x, pos.y, pos.z) + 0.005));
      else if (tr.kind === 'plane') pos.multiplyScalar(Math.max(1.004 + 0.035 * Math.sin(Math.PI * f.frac) * Math.min(1, tr.length / 2500), this.surfaceR(pos.x, pos.y, pos.z) + 0.004));
      else pos.multiplyScalar(1.0012);
      const fwd = f.dir.clone().sub(up.clone().multiplyScalar(f.dir.dot(up))).normalize();
      const right = new THREE.Vector3().crossVectors(up, fwd).normalize();
      const dist = camPos.distanceTo(pos);
      const size = (tr.kind === 'ship' ? 19 : tr.kind === 'fleet' ? 21 : tr.kind === 'strike' ? 15 : 20) * pxWorld * dist * (tr._dock !== undefined ? Math.min(1, tr._dock * 1.5) : 1);
      m4.makeBasis(right.multiplyScalar(size), up.clone().multiplyScalar(size), fwd.multiplyScalar(size));
      void air;
      if (tr.kind === 'ship' || tr.kind === 'fleet') {
        // roulis et tangage légers
        m4.multiply(new THREE.Matrix4().makeRotationZ(Math.sin(this.time * 2.6 + tr.id) * 0.07));
        m4.multiply(new THREE.Matrix4().makeRotationX(Math.sin(this.time * 1.9 + tr.id * 0.7) * 0.04));
      } else if (tr.kind === 'plane') {
        // montée puis descente le long de l'arc
        m4.multiply(new THREE.Matrix4().makeRotationX(-Math.cos(Math.PI * f.frac) * 0.22 * Math.min(1, tr.length / 2500)));
      }
      m4.setPosition(pos);
      // aux couleurs du pays (sans drapeau)
      const ccol = this.colors[sim.sides[tr.side].e] || '#ffffff';
      col.set(ccol).lerp(new THREE.Color(1, 1, 1), tr.kind === 'ship' ? 0.35 : 0.55);
      if (tr.kind === 'fleet' || tr.kind === 'strike') col.set(ccol).lerp(new THREE.Color(0.75, 0.78, 0.82), 0.45);
      // style des navires choisi par le joueur (identité)
      const se = this.entities && this.entities[sim.sides[tr.side].e];
      if (se && se.shipStyle && (tr.kind === 'fleet' || tr.kind === 'ship')) {
        if (se.shipStyle === 'national') col.set(ccol);
        else if (se.shipStyle === 'sombre') col.set(ccol).lerp(new THREE.Color(0.08, 0.09, 0.11), 0.6);
        else if (se.shipStyle === 'clair') col.set(ccol).lerp(new THREE.Color(1, 1, 1), 0.75);
      }
      if (tr.kind === 'fleet' && nw < MAX_SHIPS) { this.warMesh.setMatrixAt(nw, m4); this.warMesh.setColorAt(nw, col); nw++; }
      else if (tr.kind === 'strike' && nj < MAX_SHIPS) { this.jetMesh.setMatrixAt(nj, m4); this.jetMesh.setColorAt(nj, col); nj++; }
      else if (tr.kind === 'ship' && ns < MAX_SHIPS) { this.shipMesh.setMatrixAt(ns, m4); this.shipMesh.setColorAt(ns, col); ns++; }
      else if (tr.kind === 'plane' && np < MAX_SHIPS) { this.planeMesh.setMatrixAt(np, m4); this.planeMesh.setColorAt(np, col); np++; }
      this.vehicleScreen.push({ id: tr.id, pos });
    }
    this.shipMesh.count = ns; this.planeMesh.count = np; this.warMesh.count = nw; this.jetMesh.count = nj;
    for (const mm of [this.warMesh, this.jetMesh]) { mm.instanceMatrix.needsUpdate = true; if (mm.instanceColor) mm.instanceColor.needsUpdate = true; }
    this.shipMesh.instanceMatrix.needsUpdate = true; this.planeMesh.instanceMatrix.needsUpdate = true;
    if (this.shipMesh.instanceColor) this.shipMesh.instanceColor.needsUpdate = true;
    if (this.planeMesh.instanceColor) this.planeMesh.instanceColor.needsUpdate = true;

    // routes : reconstruites 10 fois par seconde
    if (this.time - this.routesBuiltAt > 0.1) {
      this.routesBuiltAt = this.time;
      const P = this.routeGeo.attributes.position.array, C = this.routeGeo.attributes.color.array;
      let v = 0;
      for (const tr of list) {
        const c = new THREE.Color(this.colors[sim.sides[tr.side].e] || '#ffffff');
        const p = tr.path;
        if (!tr._cum) this._vehicleFrame(tr, 0);
        const lift = tr.kind === 'plane';
        for (let k = 1; k < p.length && v < 119990; k++) {
          const done = tr._cum[k] <= tr.done;
          const ahead = !done;
          const inten = done ? 0.32 : 0.14;   // tracé discret
          if (ahead && k % 2) continue; // pointillés devant le véhicule
          for (const qi of [k - 1, k]) {
            const q = p[qi];
            const fr = lift ? (tr._cum[qi] || 0) / (tr.length || 1) : 0;
            const r = lift ? 1.004 + 0.035 * Math.sin(Math.PI * fr) * Math.min(1, tr.length / 2500) : 1.0014;
            P[v * 3] = q[0] * r; P[v * 3 + 1] = q[1] * r; P[v * 3 + 2] = q[2] * r;
            C[v * 3] = c.r * inten; C[v * 3 + 1] = c.g * inten; C[v * 3 + 2] = c.b * inten;
            v++;
          }
        }
      }
      this.routeGeo.setDrawRange(0, v);
      this.routeGeo.attributes.position.needsUpdate = true;
      this.routeGeo.attributes.color.needsUpdate = true;
    }
  }

  // ---------------- image ----------------
  resize() {
    const w = this.canvas.clientWidth || window.innerWidth, h = this.canvas.clientHeight || window.innerHeight;
    this.viewW = w; this.viewH = h;
    this.renderer.setPixelRatio(Math.min(1.5, window.devicePixelRatio || 1) * (this.resScale || 1));
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  // résolution adaptative : si l'ordinateur peine (moins de ~30 images/s), on réduit un peu la définition
  _adapt(dt) {
    if (!(dt > 0)) return;
    this._dtAvg = this._dtAvg ? this._dtAvg * 0.97 + dt * 0.03 : dt;
    this._adaptT = (this._adaptT || 0) + dt;
    if (this._adaptT < 3) return;
    const s = this.resScale || 1;
    if (this._dtAvg > 1 / 30 && s > 0.6) { this.resScale = Math.max(0.6, s - 0.15); this._adaptT = 0; this.resize(); }
    else if (this._dtAvg < 1 / 55 && s < 1) { this.resScale = Math.min(1, s + 0.1); this._adaptT = 0; this.resize(); }
  }

  frame(dt, sim, alpha, micro = []) {
    const t0 = performance.now();
    this._adapt(dt);
    this.time += dt;
    this.cam.update(dt);
    const camPos = this.camera.position;
    const camLen = camPos.length();
    // soleil décalé par rapport à la caméra : relief, ombres et terminateur visibles
    const viewDir = new THREE.Vector3(); this.camera.getWorldDirection(viewDir);
    const right = new THREE.Vector3().crossVectors(viewDir, this.camera.up).normalize();
    const camN = camPos.clone().normalize();
    this.sunDir.copy(camN).add(right.multiplyScalar(-0.85)).add(this.camera.up.clone().multiplyScalar(0.55)).normalize();
    this.dirLight.position.copy(this.sunDir).multiplyScalar(10);
    const u = this.earthMat.uniforms;
    u.uTime.value = this.time;
    u.uCamPos.value.copy(camPos);
    u.uSelected.value = this.selected;
    u.uShadows.value = this.shadows ? 1 : 0;
    u.uTransition.value = this.transition || 1.3;
    // maillage du relief centré sous la caméra (densité maximale au nadir)
    const cx = new THREE.Vector3(0, 1, 0).cross(camN);
    if (cx.lengthSq() < 1e-6) cx.set(1, 0, 0);
    cx.normalize();
    u.uCapC.value.copy(camN); u.uCapX.value.copy(cx); u.uCapY.value.copy(new THREE.Vector3().crossVectors(camN, cx));
    u.uCapAngle.value = Math.min(Math.PI * 0.62, Math.acos(Math.min(1, 1 / camLen)) + 0.2);
    // relief plus marqué de loin pour rester lisible sur toute la planète
    const far = Math.max(0, Math.min(1, (this.cam.dist - 1.15) / 2.2));
    u.uShade.value = EXAG_KM * (1.25 + 3.4 * far);
    u.uBorderFade.value = 0.55 + 0.45 * (1 - far);
    if (this.riverLines) this.riverLines.material.opacity = 0.75 * (1 - Math.min(1, Math.max(0, (this.cam.dist - 1.25) / 1.2)));
    this._updateDetails();
    this._updateTerritory();
    this._updateVector();
    this.atmoMat.uniforms.uCamPos.value.copy(camPos);
    this.territory.upload();
    const pxWorld = 2 * Math.tan((this.camera.fov * Math.PI) / 360) / this.viewH;
    this.markerMat.uniforms.uTime.value = this.time;
    this.markerMat.uniforms.uPixel.value = pxWorld;

    this._updateVehicles(sim, alpha);
    // unités : petits groupes de jetons orientés vers leur destination, posés sur le relief
    let m = 0;
    const g = this.grid;
    const camP = camPos;
    // formation en colonne : chef devant, rangs derrière (représentation agrégée des forces)
    const FORM = [[0, 0], [-1.0, -0.8], [-1.0, 0.8], [-2.0, 0], [-2.9, -0.8], [-2.9, 0.8], [-3.8, 0]];
    const horizonDot = 1 / camLen - 0.02;
    if (!this.dispPos) this.dispPos = new Map();
    const fdt = Math.min(0.1, Math.max(0, this.time - (this.dispT ?? this.time))); this.dispT = this.time;
    const smoothK = 1 - Math.exp(-fdt * 14);
    if (sim && this.showMarkers) {
      const seen = new Set();
      for (const sd of sim.sides) {
        if (sd.eliminated) continue;
        const c = hexRgb(this.colors[sd.e]);
        // identité visuelle du pays (forme des unités, couleur secondaire)
        const ident = this.entities && this.entities[sd.e];
        const shape = ident ? (SHAPES[ident.unitShape] || 0) : 0;
        const sec = ident && ident.color2Override ? packRgb(ident.color2Override) : -1;
        // un point par groupe militaire : taille selon les forces représentées, halo pulsé au combat
        let avg = 0, na = 0;
        for (const a of sd.agents) { avg += a.str || 1; na++; }
        avg = Math.max(1e-6, avg / Math.max(1, na));
        for (const a of sd.agents) {
          if (a.transit >= 0) continue;
          const born = sim.time - a.bornAt;
          if (born < 0) continue;
          let x = a.px + (a.x - a.px) * alpha, y = a.py + (a.y - a.py) * alpha, z = a.pz + (a.z - a.pz) * alpha;
          // lissage d'affichage : la position montrée rejoint la position simulée en douceur
          // (pas d'à-coup entre deux pas ni lors d'un redéploiement) ; affichage seulement
          const dp = this.dispPos.get(a.id);
          if (dp && Math.hypot(dp[0] - x, dp[1] - y, dp[2] - z) < 0.08) {
            dp[0] += (x - dp[0]) * smoothK; dp[1] += (y - dp[1]) * smoothK; dp[2] += (z - dp[2]) * smoothK;
            x = dp[0]; y = dp[1]; z = dp[2];
          } else this.dispPos.set(a.id, [x, y, z]);
          const l = Math.hypot(x, y, z); x /= l; y /= l; z /= l;
          if ((x * camP.x + y * camP.y + z * camP.z) / camLen < horizonDot) continue; // face cachée
          seen.add(a.id);
          if (m >= MAX_MARKERS) break;
          const R = this.surfaceR(x, y, z) + 0.0006;
          this.mPos[m * 3] = x * R; this.mPos[m * 3 + 1] = y * R; this.mPos[m * 3 + 2] = z * R;
          this.mDir[m * 3] = shape; this.mDir[m * 3 + 1] = sec; this.mDir[m * 3 + 2] = 0;
          this.mColor[m * 3] = c[0]; this.mColor[m * 3 + 1] = c[1]; this.mColor[m * 3 + 2] = c[2];
          const rel = Math.sqrt((a.str || avg) / avg);
          const hot = Math.max(0, 1 - (sim.time - a.lastWinAt) / 0.8);
          this.mData[m * 4] = Math.max(19, Math.min(38, 27 * rel)) * (1 + hot * 0.12);
          this.mData[m * 4 + 1] = 2 + 4 * (a.engaged ? 2 : 1);
          this.mData[m * 4 + 2] = Math.min(1, born / 0.6);
          this.mData[m * 4 + 3] = a.id * 1.7;
          m++;
        }
      }
      if (this.headings.size > seen.size + 200) for (const id of [...this.headings.keys()]) if (!seen.has(id)) this.headings.delete(id);
      if (this.dispPos.size > seen.size + 200) for (const id of [...this.dispPos.keys()]) if (!seen.has(id)) this.dispPos.delete(id);
    }
    // micro-pays (pastilles de couleur)
    for (const mi of micro) {
      if (m >= MAX_MARKERS) break;
      const ci = mi.cell * 3;
      if ((g.xyz[ci] * camP.x + g.xyz[ci + 1] * camP.y + g.xyz[ci + 2] * camP.z) / camLen < horizonDot + 0.02) continue; // face cachée
      const R = this.cellR[mi.cell] + 0.0004;
      this.mPos[m * 3] = g.xyz[mi.cell * 3] * R; this.mPos[m * 3 + 1] = g.xyz[mi.cell * 3 + 1] * R; this.mPos[m * 3 + 2] = g.xyz[mi.cell * 3 + 2] * R;
      const c = hexRgb(this.colors[mi.owner]);
      this.mColor[m * 3] = c[0]; this.mColor[m * 3 + 1] = c[1]; this.mColor[m * 3 + 2] = c[2];
      this.mData[m * 4] = 13; this.mData[m * 4 + 1] = 2; this.mData[m * 4 + 2] = 1; this.mData[m * 4 + 3] = 0;
      this.mDir[m * 3] = 0; this.mDir[m * 3 + 1] = -1; this.mDir[m * 3 + 2] = 0;
      m++;
    }
    this.markerGeo.instanceCount = m;
    for (const k of ['aPos', 'aColor', 'aData', 'aDir']) this.markerGeo.attributes[k].needsUpdate = true;

    // anneaux
    let r = 0;
    this.rings = this.rings.filter((ri) => this.time - ri.t0 < ri.dur);
    for (const ri of this.rings) {
      if (r >= MAX_RINGS) break;
      if ((ri.x * camP.x + ri.y * camP.y + ri.z * camP.z) / camLen < horizonDot) continue;
      this.rPos[r * 3] = ri.x; this.rPos[r * 3 + 1] = ri.y; this.rPos[r * 3 + 2] = ri.z;
      this.rData[r * 4] = (this.time - ri.t0) / ri.dur; this.rData[r * 4 + 1] = ri.size; this.rData[r * 4 + 2] = ri.strong; this.rData[r * 4 + 3] = 0;
      const c = hexRgb(ri.color);
      this.rColor[r * 3] = c[0]; this.rColor[r * 3 + 1] = c[1]; this.rColor[r * 3 + 2] = c[2];
      r++;
    }
    this.ringGeo.instanceCount = r;
    this.ringMesh.material.uniforms.uPixel.value = pxWorld;
    for (const k of ['aPos', 'aData', 'aColor']) this.ringGeo.attributes[k].needsUpdate = true;

    this.renderer.render(this.scene, this.camera);
    this.stats.frameMs = performance.now() - t0;
  }

  // ---------------- sélection ----------------
  rayToLatLon(sx, sy) {
    const rect = this.canvas.getBoundingClientRect();
    const ndc = new THREE.Vector2(((sx - rect.left) / rect.width) * 2 - 1, -((sy - rect.top) / rect.height) * 2 + 1);
    const ray = new THREE.Raycaster();
    ray.setFromCamera(ndc, this.camera);
    const o = ray.ray.origin, dv = ray.ray.direction;
    // intersection avec le relief : entrée dans la sphère englobante puis marche + dichotomie
    const hitSphere = (R) => {
      const b = o.dot(dv), c = o.dot(o) - R * R;
      const disc = b * b - c;
      if (disc < 0) return null;
      return [-b - Math.sqrt(disc), -b + Math.sqrt(disc)];
    };
    const outer = hitSphere(1 + 9 * EXAG_KM);
    if (!outer || outer[1] < 0) return null;
    const inner = hitSphere(1);
    const tEnd = inner && inner[0] > 0 ? inner[0] : outer[1];
    const above = (t) => {
      const x = o.x + dv.x * t, y = o.y + dv.y * t, z = o.z + dv.z * t;
      return Math.hypot(x, y, z) - this.surfaceR(x, y, z);
    };
    let t0 = Math.max(0, outer[0]), t1 = tEnd, found = false;
    const N = 48;
    for (let k = 1; k <= N; k++) {
      const t = outer[0] + (tEnd - outer[0]) * (k / N);
      if (t < 0) continue;
      if (above(t) <= 0) { t1 = t; found = true; break; }
      t0 = t;
    }
    if (found) for (let k = 0; k < 16; k++) { const m = (t0 + t1) / 2; if (above(m) > 0) t0 = m; else t1 = m; }
    const p = o.clone().add(dv.clone().multiplyScalar(t1)).normalize();
    return { lat: Math.asin(Math.max(-1, Math.min(1, p.y))) * 180 / Math.PI, lon: Math.atan2(p.x, p.z) * 180 / Math.PI, p };
  }

  // coordonnées écran d'un point de la sphère (null si caché)
  project(x, y, z, r = 1) {
    const v = new THREE.Vector3(x * r, y * r, z * r);
    const camPos = this.camera.position;
    const toCam = camPos.clone().sub(v);
    if (toCam.dot(v) <= 0.02) return null;
    v.project(this.camera);
    if (v.z > 1) return null;
    return [(v.x + 1) / 2 * this.viewW, (1 - v.y) / 2 * this.viewH];
  }
}

function mergeGeos(geos) {
  const pos = [], idx = [];
  let off = 0;
  for (const g0 of geos) {
    const g = g0.index ? g0 : g0;
    const p = g.getAttribute('position');
    for (let k = 0; k < p.count; k++) pos.push(p.getX(k), p.getY(k), p.getZ(k));
    if (g.index) for (let k = 0; k < g.index.count; k++) idx.push(g.index.getX(k) + off);
    else for (let k = 0; k < p.count; k++) idx.push(k + off);
    off += p.count;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  out.setIndex(idx);
  return out;
}

// fusion de géométries avec une couleur par pièce (couleurs de sommets)
function mergeColored(parts) {
  const pos = [], nor = [], col = [];
  const c = new THREE.Color();
  for (const [g0, hex] of parts) {
    const g = g0.index ? g0.toNonIndexed() : g0;
    g.computeVertexNormals();
    const p = g.getAttribute('position'), n = g.getAttribute('normal');
    c.set(hex);
    for (let k = 0; k < p.count; k++) {
      pos.push(p.getX(k), p.getY(k), p.getZ(k));
      nor.push(n.getX(k), n.getY(k), n.getZ(k));
      col.push(c.r, c.g, c.b);
    }
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  out.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  return out;
}

// maillage de la Terre : disque d'anneaux (s = 0 au nadir de la caméra, 1 au-delà de l'horizon)
function capGeometry(rings, sectors) {
  const pos = new Float32Array((rings + 1) * (sectors + 1) * 3);
  let k = 0;
  for (let i = 0; i <= rings; i++) {
    for (let j = 0; j <= sectors; j++) {
      pos[k++] = i / rings; pos[k++] = (j / sectors) * Math.PI * 2; pos[k++] = 0;
    }
  }
  const idx = [];
  const row = sectors + 1;
  for (let i = 0; i < rings; i++) {
    for (let j = 0; j < sectors; j++) {
      const a = i * row + j, b = a + 1, c = a + row, d = c + 1;
      idx.push(a, c, b, b, c, d);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setIndex(idx);
  return g;
}

// vraies frontières d'origine : identifiants par pixel + niveaux réduits (identifiant majoritaire 2×2)
function buildHiresTexture(hires) {
  let W = hires.W, H = hires.H, cur = hires.data;
  const mips = [{ data: cur, width: W, height: H }];
  while (W > 1 || H > 1) {
    const nW = Math.max(1, W >> 1), nH = Math.max(1, H >> 1);
    const nxt = new Uint8Array(nW * nH);
    for (let y = 0; y < nH; y++) {
      for (let x = 0; x < nW; x++) {
        const x0 = Math.min(W - 1, 2 * x), x1 = Math.min(W - 1, 2 * x + 1), y0 = Math.min(H - 1, 2 * y), y1 = Math.min(H - 1, 2 * y + 1);
        const a = cur[y0 * W + x0], b = cur[y0 * W + x1], c = cur[y1 * W + x0], d = cur[y1 * W + x1];
        // majorité ; à égalité, la terre l'emporte sur la mer (côtes fines conservées)
        let v = a;
        if (a === b || a === c || a === d) v = a;
        else if (b === c || b === d) v = b;
        else if (c === d) v = c;
        if (v === 255) { if (a !== 255) v = a; else if (b !== 255) v = b; else if (c !== 255) v = c; else if (d !== 255) v = d; if ((a === 255) + (b === 255) + (c === 255) + (d === 255) >= 3) v = 255; }
        nxt[y * nW + x] = v;
      }
    }
    mips.push({ data: nxt, width: nW, height: nH });
    cur = nxt; W = nW; H = nH;
  }
  const tex = new THREE.DataTexture(mips[0].data, mips[0].width, mips[0].height, THREE.RedFormat, THREE.UnsignedByteType);
  tex.mipmaps = mips;
  tex.generateMipmaps = false;
  tex.minFilter = THREE.NearestMipmapNearestFilter;
  tex.magFilter = THREE.NearestFilter;
  tex.unpackAlignment = 1;
  tex.needsUpdate = true;
  return tex;
}

// types de figures d'un groupe (0 infanterie, 1 blindé, 2 artillerie, 3 reconnaissance), selon son rôle
// et la composition réelle de l'armée du pays
const _kindsCache = new Map();
function groupKinds(role, f, count) {
  const key = role + ':' + count + ':' + Math.round(f.arm * 20) + ':' + Math.round(f.art * 20) + ':' + Math.round(f.rec * 20);
  let r = _kindsCache.get(key);
  if (r) return r;
  r = new Array(count).fill(0);
  if (role === 'arm') { for (let k = 0; k < count; k++) r[k] = k % 3 === 2 ? 0 : 1; }
  else if (role === 'art') { for (let k = 0; k < count; k++) r[k] = k % 2 === 0 ? 2 : 0; r[0] = 0; }
  else if (role === 'rec') { for (let k = 0; k < count; k++) r[k] = k < 2 ? 3 : 0; }
  else {
    const nA = Math.round((count - 1) * f.arm * 1.8), nT = Math.round((count - 1) * f.art * 1.4), nR = Math.round((count - 1) * f.rec * 1.2);
    let k = 1;
    for (let q = 0; q < nA && k < count; q++) r[k++] = 1;
    for (let q = 0; q < nT && k < count; q++) r[k++] = 2;
    for (let q = 0; q < nR && k < count; q++) r[k++] = 3;
  }
  if (_kindsCache.size > 500) _kindsCache.clear();
  _kindsCache.set(key, r);
  return r;
}
