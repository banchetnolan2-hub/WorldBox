// GLOBE — lignes vectorielles nettes (frontières, lignes de front, côtes, limites régionales) : rubans
// d'épaisseur constante à l'écran, posés sur le relief. Frontières et fronts : une ligne n'est affichée
// que si les deux côtés appartiennent réellement à des territoires différents (test sur la carte des
// pièces de la géométrie des territoires) ; même propriétaire mais statut différent (occupé / officiel) :
// pointillés clairs. Une ligne ne traverse donc jamais un territoire.
import * as THREE from 'three';
import { ribbonArrays } from './ribbonData.js';
import { TERR_GLSL } from './shaders.js';

const VS = `
  uniform vec2 uRes; uniform float uWidth; uniform float uSideTest; uniform float uEps;
  ${TERR_GLSL}
  uniform sampler2D uRelief; uniform float uExag; uniform float uLod; uniform float uLift;
  attribute vec3 aOther; attribute float aSide; attribute float aEnd; attribute float aLen;
  varying float vFace; varying float vHide; varying float vEdge; varying float vDash; varying float vLen;
  // même relief (et même niveau de détail) que le maillage de la Terre : la ligne colle au terrain affiché
  vec3 onSurface(vec3 d) {
    vec2 uv = vec2(atan(d.x, d.z) / 6.2831853 + 0.5, 0.5 - asin(clamp(d.y, -1.0, 1.0)) / 3.14159265);
    float hk = textureLod(uRelief, uv, uLod).r;
    return d * (1.0 + max(hk, 0.0) * uExag + uLift);
  }
  float keyAt(vec3 d) {
    d = normalize(d);
    vec2 uv = vec2(atan(d.x, d.z) / 6.2831853 + 0.5, 0.5 - asin(clamp(d.y, -1.0, 1.0)) / 3.14159265);
    ivec2 c = ivec2(floor(uv * uTerrSize));
    c.x = (c.x % int(uTerrSize.x) + int(uTerrSize.x)) % int(uTerrSize.x); c.y = clamp(c.y, 0, int(uTerrSize.y) - 1);
    float mv;
    float fr; return terrKey(c, mv, fr);
  }
  void main() {
    vec3 P = onSurface(position);
    vec4 c0 = projectionMatrix * modelViewMatrix * vec4(P, 1.0);
    vec4 c1 = projectionMatrix * modelViewMatrix * vec4(onSurface(aOther), 1.0);
    vec2 s0 = c0.xy / c0.w * uRes, s1 = c1.xy / c1.w * uRes;
    vec2 dir = s1 - s0; if (aEnd > 0.5) dir = -dir;
    dir = length(dir) > 1e-6 ? normalize(dir) : vec2(1.0, 0.0);
    vec2 nrm = vec2(-dir.y, dir.x);
    c0.xy += nrm * aSide * (uWidth + 1.0) * 0.5 / uRes * c0.w;   // uRes = demi-résolution en pixels
    gl_Position = c0;
    vEdge = aSide;
    vLen = aLen;
    vec3 n = normalize(position);
    vFace = dot(n, normalize(cameraPosition - P));
    vHide = 0.0; vDash = 0.0;
    if (uSideTest > 0.5) {
      // de part et d'autre de la ligne : deux territoires différents ?
      vec3 t = normalize(aOther - position); if (aEnd > 0.5) t = -t;
      vec3 side = normalize(cross(n, t));
      float kL = keyAt(n + side * uEps), kR = keyAt(n - side * uEps);
      float oL = kL > 0.5 ? mod(kL - 1.0, 32768.0) : -1.0, oR = kR > 0.5 ? mod(kR - 1.0, 32768.0) : -1.0;
      if (kL == kR || oL < 0.0 || oR < 0.0) vHide = 1.0;
      else if (oL == oR) vDash = 1.0;          // même pays, statut différent : limite d'occupation
    }
  }`;
const FS = `
  uniform vec3 uColor; uniform float uOpacity; uniform float uWidth; uniform float uDashKm;
  varying float vFace; varying float vHide; varying float vEdge; varying float vDash; varying float vLen;
  void main() {
    if (vFace < 0.02 || vHide > 0.5) discard;
    // bord antialiasé : la largeur utile est uWidth, le pixel supplémentaire sert au fondu
    float px = abs(vEdge) * (uWidth + 1.0) * 0.5;
    float a = clamp(uWidth * 0.5 + 0.5 - px, 0.0, 1.0);
    vec3 col = uColor;
    if (vDash > 0.5) {
      if (fract(vLen / uDashKm) > 0.55) discard;
      col = vec3(0.93, 0.90, 0.82); a *= 0.8;
    }
    gl_FragColor = vec4(col, a * uOpacity * smoothstep(0.02, 0.12, vFace));
  }`;

// polylines : tableaux de directions unitaires [x, y, z] (le relief est appliqué dans le shader)
export function ribbonMesh(polylines, { color = 0x0a1016, width = 1.4, opacity = 1, sideTest = false, order = 4, lift = 0.0003, material = null } = {}) {
  const d = Array.isArray(polylines) ? ribbonArrays(polylines) : polylines;   // polylignes ou données déjà préparées
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(d.pos, 3));
  g.setAttribute('aOther', new THREE.BufferAttribute(d.oth, 3));
  g.setAttribute('aSide', new THREE.BufferAttribute(d.side, 1));
  g.setAttribute('aEnd', new THREE.BufferAttribute(d.end, 1));
  g.setAttribute('aLen', new THREE.BufferAttribute(d.len, 1));
  g.setIndex(new THREE.BufferAttribute(d.idx, 1));
  const m = material || ribbonMaterial({ color, width, opacity, sideTest, lift });
  const mesh = new THREE.Mesh(g, m);
  mesh.frustumCulled = false;
  mesh.renderOrder = order;
  return mesh;
}
// matériau partageable entre plusieurs rubans (ex. lignes de front de tous les pays)
export function ribbonMaterial({ color = 0x0a1016, width = 1.4, opacity = 1, sideTest = false, lift = 0.0003 } = {}) {
  const mat = new THREE.ShaderMaterial({
    vertexShader: VS, fragmentShader: FS, transparent: true, depthWrite: false, depthTest: false,   // face cachée : vFace
    uniforms: {
      uRes: { value: new THREE.Vector2(1, 1) }, uWidth: { value: width }, uColor: { value: new THREE.Color(color) }, uOpacity: { value: opacity },
      uTerr: { value: null }, uTerrPrev: { value: null }, uTerrF: { value: null }, uMix: { value: 1 }, uTerrSize: { value: new THREE.Vector2(1, 1) }, uSideTest: { value: sideTest ? 1 : 0 }, uEps: { value: 0.001 }, uDashKm: { value: 20 },
      uRelief: { value: null }, uExag: { value: 0 }, uLod: { value: 0 }, uLift: { value: lift },
    },
  });
  mat.userData.sideTest = sideTest;   // test des deux côtés (frontières, fronts) ; jamais pour les côtes
  return mat;
}

// simplification de Douglas-Peucker (points [x, y])
export function simplifyDP(pts, tol) {
  if (pts.length < 3) return pts;
  const keep = new Uint8Array(pts.length); keep[0] = keep[pts.length - 1] = 1;
  const st = [[0, pts.length - 1]];
  while (st.length) {
    const [a, b] = st.pop();
    const [ax, ay] = pts[a], [bx, by] = pts[b];
    const dx = bx - ax, dy = by - ay, L = Math.hypot(dx, dy);
    let md = -1, mi = -1;
    for (let i = a + 1; i < b; i++) { const d = L > 1e-9 ? Math.abs((pts[i][0] - ax) * dy - (pts[i][1] - ay) * dx) / L : Math.hypot(pts[i][0] - ax, pts[i][1] - ay); if (d > md) { md = d; mi = i; } }
    if (md > tol) { keep[mi] = 1; st.push([a, mi], [mi, b]); }
  }
  return pts.filter((_, i) => keep[i]);
}

// lissage de Chaikin (polylignes issues de la grille : plus d'escaliers)
export function chaikin(pts, iter = 2) {
  let p = pts;
  for (let it = 0; it < iter; it++) {
    if (p.length < 3) return p;
    const q = [p[0]];
    for (let k = 0; k + 1 < p.length; k++) {
      const a = p[k], b = p[k + 1];
      q.push([a[0] * 0.75 + b[0] * 0.25, a[1] * 0.75 + b[1] * 0.25], [a[0] * 0.25 + b[0] * 0.75, a[1] * 0.25 + b[1] * 0.75]);
    }
    q.push(p[p.length - 1]);
    p = q;
  }
  return p;
}

// fichier borders.bin : [a+1, b+1, lod, n, (x, y) × n] en Uint16 ; b = 0 : côte
export function parseBorders(u16) {
  const out = [];
  for (let i = 0; i < u16.length;) {
    const a = u16[i] - 1, b = u16[i + 1] - 1, lod = u16[i + 2], n = u16[i + 3];
    i += 4;
    const pts = new Array(n);
    for (let k = 0; k < n; k++, i += 2) pts[k] = [u16[i] / 65535 * 360 - 180, 90 - u16[i + 1] / 65535 * 180];
    out.push({ a, b, lod, pts });
  }
  return out;
}
