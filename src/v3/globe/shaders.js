// GLOBE — shaders WebGL2 (GLSL 3)
//
// La Terre est un maillage dont les sommets sont concentrés sous la caméra (anneaux autour du nadir),
// déplacés selon le vrai relief (altitudes et profondeurs réelles). Chaque pixel calcule : le relief
// éclairé (normales + ombres portées), l'océan selon sa profondeur, la couleur du pays par-dessus le
// terrain, l'état du territoire (officiel / occupé / neutre) et des frontières lissées et antialiasées.

// clé de territoire AFFICHÉE : interpolation entre l'état géométrique précédent et le nouvel état.
// Un pixel dont la clé change bascule quand l'animation dépasse l'instant (0..1) de capture de sa zone
// (texture lissée) : le front avance progressivement, à la fréquence d'image, quel que soit le rythme
// des calculs géométriques.
export const TERR_GLSL = /* glsl */`
uniform sampler2D uTerr;       // pièces des territoires (nouvel état) : clé 16 bits
uniform sampler2D uTerrPrev;   // état précédent
uniform sampler2D uTerrF;      // instant de capture normalisé (grille de simulation, filtrage linéaire)
uniform float uMix;            // avancement de l'animation 0..1
uniform vec2 uTerrSize;
float terrKey(ivec2 tc, out float moving, out float fresh) {
  vec2 n = texelFetch(uTerr, tc, 0).rg, q = texelFetch(uTerrPrev, tc, 0).rg;
  float kn = floor(n.r * 255.0 + 0.5) + floor(n.g * 255.0 + 0.5) * 256.0;
  float kp = floor(q.r * 255.0 + 0.5) + floor(q.g * 255.0 + 0.5) * 256.0;
  moving = 0.0; fresh = 0.0;
  if (kn == kp || uMix >= 1.0) return kn;
  moving = 1.0;
  float f = texture(uTerrF, (vec2(tc) + 0.5) / uTerrSize).r;
  // parcelle tout juste prise : éclat qui s'estompe derrière le front (fondu côté attaquant)
  if (uMix > f) fresh = 1.0 - smoothstep(0.0, 0.35, uMix - f);
  return uMix > f ? kn : kp;
}
`;

const common = /* glsl */`
const float PI = 3.14159265;
uniform float uReliefW;                         // largeur de la texture de relief (4096 Terre, 2048 monde créé)
#define TEXEL (6.2831853 / uReliefW)            // taille angulaire d'un texel de relief
vec2 dirUV(vec3 p) { return vec2(atan(p.x, p.z) / (2.0 * PI) + 0.5, 0.5 - asin(clamp(p.y, -1.0, 1.0)) / PI); }
`;

export const earthVertex = /* glsl */`
${common}
uniform sampler2D uRelief;
uniform vec3 uCapC;
uniform vec3 uCapX;
uniform vec3 uCapY;
uniform float uCapAngle;
uniform float uExag;
uniform vec2 uCapRes;    // anneaux, secteurs
out vec3 vPos;
out vec3 vWorld;
void main() {
  float s = position.x, ph = position.y;
  float th = pow(s, 1.6) * uCapAngle;
  vec3 p = normalize(uCapC * cos(th) + (uCapX * cos(ph) + uCapY * sin(ph)) * sin(th));
  float dth = 1.6 * pow(max(s, 1e-3), 0.6) * uCapAngle / uCapRes.x;
  float dci = 6.2831853 * sin(th) / uCapRes.y;
  float lod = max(0.0, log2(max(dth, dci) / TEXEL) + 0.5);
  float hk = textureLod(uRelief, dirUV(p), lod).r;
  float r = 1.0 + max(hk, 0.0) * uExag;
  vPos = p;
  vec4 w = modelMatrix * vec4(p * r, 1.0);
  vWorld = w.xyz;
  gl_Position = projectionMatrix * viewMatrix * w;
}`;

export const earthFragment = /* glsl */`
precision highp float;
precision highp int;
${common}
in vec3 vPos;
in vec3 vWorld;
out vec4 fragColor;

uniform sampler2D uRelief;    // altitude en km (négative en mer), niveaux de détail
uniform sampler2D uNoise;
uniform sampler2D uOwnerA;
uniform sampler2D uOwnerB;
uniform sampler2D uParams;
uniform sampler2D uHires;     // vraies frontières d'origine (≈ 5 km)
uniform vec2 uGrid;           // grille de simulation (interne, jamais affichée telle quelle)
uniform vec2 uHiresSize;
uniform float uTime;
uniform vec3 uSunDir;
uniform vec3 uCamPos;
uniform float uSelected;
uniform float uShowBorders;
uniform float uShade;         // exagération du relief pour l'éclairage (rayon par km)
uniform float uShadows;       // ombres portées (0/1)
uniform float uBorderFade;    // opacité des frontières selon le zoom
uniform sampler2D uMask;      // terre/mer 1:10m, 16384 × 8192 bits (texture 512 × 8192 RGBA)
uniform float uMaskOn;
uniform float uVecOn;         // frontières et côtes vectorielles affichées par-dessus (Terre)
uniform float uTerrOn;
${TERR_GLSL}
uniform float uHiresOn;       // 1 : Terre (vraies frontières d'origine) ; 0 : monde créé (côtes = altitude 0)
uniform float uTransition;    // durée des transitions de frontière (s)
uniform sampler2D uGeo;       // biomes (couleur) de la géographie simulée
uniform float uGeoOn;

const float SEA = 65535.0;

float decode16(vec2 v) { return floor(v.x * 255.0 + 0.5) + floor(v.y * 255.0 + 0.5) * 256.0; }
float reliefAt(vec3 p, float lod) { return textureLod(uRelief, dirUV(p), lod).r; }
// relief B-spline (bicubique, 4 lectures) : côtes et pentes parfaitement lisses en zoom très proche
float reliefBicubic(vec2 uv) {
  vec2 size = vec2(uReliefW, uReliefW * 0.5);
  vec2 t = uv * size - 0.5;
  vec2 f = fract(t), i = floor(t);
  vec2 f2 = f * f, f3 = f2 * f;
  vec2 w0 = (1.0 - 3.0 * f + 3.0 * f2 - f3) / 6.0, w1 = (4.0 - 6.0 * f2 + 3.0 * f3) / 6.0;
  vec2 w2 = (1.0 + 3.0 * f + 3.0 * f2 - 3.0 * f3) / 6.0, w3 = f3 / 6.0;
  vec2 g0 = w0 + w1, g1 = w2 + w3;
  vec2 h0 = (i - 1.0 + w1 / g0 + 0.5) / size, h1 = (i + 1.0 + w3 / g1 + 0.5) / size;
  float a = textureLod(uRelief, h0, 0.0).r, b = textureLod(uRelief, vec2(h1.x, h0.y), 0.0).r;
  float c = textureLod(uRelief, vec2(h0.x, h1.y), 0.0).r, d = textureLod(uRelief, h1, 0.0).r;
  return g0.y * (g0.x * a + g1.x * b) + g1.y * (g0.x * c + g1.x * d);
}

// noyau lissant à support fini (4 × 4) : continu et à dérivée continue -> contours sans cassure
float win(float x) { float t = clamp(abs(x) * 0.5, 0.0, 1.0); float u = 1.0 - t * t; return u * u; }
float maskBit(ivec2 c) {
  vec4 t = texelFetch(uMask, ivec2(c.x >> 5, c.y), 0);
  int k = (c.x >> 3) & 3;
  float b = k == 0 ? t.r : k == 1 ? t.g : k == 2 ? t.b : t.a;
  int v = int(b * 255.0 + 0.5);
  return float((v >> (c.x & 7)) & 1);
}
float kern(vec2 d, float k) { return exp(-k * dot(d, d)) * win(d.x) * win(d.y); }

// petit tableau de votes : propriétaire, poids, part « occupée »
float vId[5]; float vW[5]; float vO[5];
void resetVotes() { for (int k = 0; k < 5; k++) { vId[k] = -1.0; vW[k] = 0.0; vO[k] = 0.0; } }
void vote(float id, float w, float occ) {
  if (w <= 0.0) return;
  for (int k = 0; k < 5; k++) { if (vId[k] == id) { vW[k] += w; vO[k] += w * occ; return; } }
  for (int k = 0; k < 5; k++) { if (vId[k] < 0.0) { vId[k] = id; vW[k] = w; vO[k] = w * occ; return; } }
}
void best2(out float id1, out float w1, out float o1, out float id2, out float w2, out float o2) {
  id1 = -1.0; w1 = 0.0; o1 = 0.0; id2 = -1.0; w2 = 0.0; o2 = 0.0;
  for (int k = 0; k < 5; k++) {
    if (vW[k] > w1) { id2 = id1; w2 = w1; o2 = o1; id1 = vId[k]; w1 = vW[k]; o1 = vO[k]; }
    else if (vW[k] > w2) { id2 = vId[k]; w2 = vW[k]; o2 = vO[k]; }
  }
}

// terrain naturel (sous la couleur des pays)
vec3 terrainAlbedo(float hk, float lat, float n) {
  vec3 low = vec3(0.30, 0.40, 0.25);
  vec3 dry = vec3(0.60, 0.53, 0.38);
  vec3 mid = vec3(0.50, 0.45, 0.34);
  vec3 rock = vec3(0.44, 0.40, 0.37);
  float arid = smoothstep(0.62, 0.9, 1.0 - abs(abs(lat) - 24.0) / 24.0) * 0.8;
  vec3 c = mix(low, dry, clamp(arid + (n - 0.5) * 0.4, 0.0, 1.0));
  c = mix(c, mid, smoothstep(0.35, 1.4, hk));
  c = mix(c, rock, smoothstep(1.6, 3.4, hk));
  return c * (0.9 + 0.2 * n);
}
float snowAmount(float hk, float lat, float n) {
  float line = mix(5.3, 0.25, smoothstep(28.0, 72.0, abs(lat)));
  return smoothstep(line, line + 0.5, hk + (n - 0.5) * 0.5);
}

// motif de hachures (territoire occupé) : traits fins de largeur constante à l'écran
float hatch(float x, float pxDeg) {
  float P = pxDeg * 9.0;
  float lv = log2(P);
  float f = fract(lv);
  float p0 = exp2(floor(lv)), p1 = p0 * 2.0;
  float d0 = abs(fract(x / p0) - 0.5) * p0 / pxDeg;
  float d1 = abs(fract(x / p1) - 0.5) * p1 / pxDeg;
  float l0 = 1.0 - smoothstep(0.6, 1.5, d0), l1 = 1.0 - smoothstep(0.6, 1.5, d1);
  return mix(l0, l1, f);
}

void main() {
  vec3 p = normalize(vPos);
  float lat = degrees(asin(clamp(p.y, -1.0, 1.0)));
  float lon = degrees(atan(p.x, p.z));
  vec2 uv = dirUV(p);
  vec3 N = p;
  vec3 V = normalize(uCamPos - vWorld);
  vec3 L = normalize(uSunDir);
  vec3 east = normalize(vec3(cos(radians(lon)), 0.0, -sin(radians(lon))));
  vec3 north = normalize(cross(N, east));

  // taille d'un pixel à la surface (radians) -> niveau de détail
  float pxAng = max(length(fwidth(vWorld)), 1e-7);
  float lod = max(0.0, log2(pxAng / TEXEL));
  float pxDeg = degrees(pxAng);
  vec2 nuv = vec2(lon / 360.0 * 24.0, lat / 180.0 * 12.0);
  float nlod = max(0.0, log2(pxAng / (6.2831853 / (24.0 * 256.0))));
  float n = textureLod(uNoise, nuv, nlod).b * 0.6 + textureLod(uNoise, nuv * 4.3, nlod + 2.1).a * 0.4;

  // ---------- relief ----------
  float hk = reliefAt(p, lod);
  if (lod < 1.0) hk = mix(reliefBicubic(uv), hk, lod);
  float e1 = TEXEL * exp2(lod) * 1.2;
  float hE = reliefAt(normalize(p + east * e1), lod), hW = reliefAt(normalize(p - east * e1), lod);
  float hN = reliefAt(normalize(p + north * e1), lod), hS = reliefAt(normalize(p - north * e1), lod);
  vec2 gLand = vec2(max(hE, 0.0) - max(hW, 0.0), max(hN, 0.0) - max(hS, 0.0)) / (2.0 * e1);
  vec2 gSea = vec2(min(hE, 0.0) - min(hW, 0.0), min(hN, 0.0) - min(hS, 0.0)) / (2.0 * e1);
  vec3 Nl = normalize(N - (east * gLand.x + north * gLand.y) * uShade);
  vec3 Nb = normalize(N - (east * gSea.x + north * gSea.y) * uShade * 0.35);

  // ---------- côtes et frontières d'origine (raster ≈ 5 km lissé) ----------
  float h1 = -1.0, hw1 = 0.0, ho1, h2 = -1.0, hw2 = 0.0, ho2;
  float land, coastLine, edgeHi = 0.0;
  if (uHiresOn > 0.5) {
    // niveau de détail : environ un texel par pixel -> pas de scintillement en dézoomant
    int hl = int(clamp(floor(log2(pxAng / (6.2831853 / uHiresSize.x)) + 0.35), 0.0, 3.0));
    ivec2 hs = textureSize(uHires, hl);
    vec2 hp = uv * vec2(hs) - 0.5;
    vec2 hf = fract(hp);
    ivec2 h0 = ivec2(floor(hp));
    resetVotes();
    float landSum = 0.0, allSum = 0.0;
    for (int j = -1; j <= 2; j++) {
      for (int i = -1; i <= 2; i++) {
        ivec2 hc = h0 + ivec2(i, j);
        hc.x = (hc.x + hs.x) % hs.x;
        hc.y = clamp(hc.y, 0, hs.y - 1);
        float id = floor(texelFetch(uHires, hc, hl).r * 255.0 + 0.5);
        float w = kern(hf - vec2(float(i), float(j)), 1.1);
        allSum += w;
        if (id < 254.5) { vote(id, w, 0.0); landSum += w; }
      }
    }
    best2(h1, hw1, ho1, h2, hw2, ho2);
    float landW = landSum / max(allSum, 1e-5);
    float soft = 0.16 * uVecOn;   // rivage adouci : le trait vectoriel donne la netteté
    // vue rapprochée : rivage tiré du masque 1:10m (≈ 2,4 km), aligné sur le trait de côte vectoriel
    float mTex = 6.2831853 / 16384.0;
    if (uMaskOn > 0.5 && pxAng < mTex * 2.0) {
      vec2 mp = uv * vec2(16384.0, 8192.0) - 0.5;
      ivec2 m0 = ivec2(floor(mp)); vec2 mf = fract(mp);
      float ls = 0.0, as = 0.0;
      for (int j = -1; j <= 2; j++) for (int i = -1; i <= 2; i++) {
        ivec2 mc = m0 + ivec2(i, j);
        mc.x = (mc.x + 16384) % 16384; mc.y = clamp(mc.y, 0, 8191);
        float w = kern(mf - vec2(float(i), float(j)), 1.1);
        as += w; ls += w * maskBit(mc);
      }
      float tm = smoothstep(2.0, 1.2, pxAng / mTex);
      landW = mix(landW, ls / max(as, 1e-5), tm);
      soft = mix(soft, 0.05, tm);
    }
    float fwL = max(fwidth(landW) * 0.7 + 1e-4, soft);
    land = smoothstep(0.5 - fwL, 0.5 + fwL, landW);
    coastLine = 1.0 - smoothstep(0.0, fwL * 1.6, abs(landW - 0.5));
    float rh = (hw1 - hw2) / (hw1 + hw2 + 1e-5);
    edgeHi = (h2 >= 0.0 && h2 != h1) ? 1.0 - smoothstep(0.0, fwidth(rh) * 1.1 + 1e-4, rh) : 0.0;
  } else {
    // monde créé : la côte est la ligne d'altitude 0 du terrain (interpolation bicubique)
    float fwH = fwidth(hk) * 0.75 + 1e-5;
    land = smoothstep(-fwH, fwH, hk);
    coastLine = 1.0 - smoothstep(0.0, fwH * 1.6, abs(hk));
  }

  // ---------- champ de propriété (grille de simulation, jamais visible telle quelle) ----------
  // coordonnées légèrement déformées (contours naturels), noyau lissant continu sur 4 × 4 parcelles ;
  // une parcelle inchangée vote pour la vraie frontière ; une parcelle conquise vote pour son nouveau
  // et son ancien propriétaire selon l'avancement -> la frontière glisse progressivement.
  // (Terre avec géométrie des territoires : ce champ n'est pas calculé du tout -> coût nul)
  bool useField = !(uTerrOn > 0.5 && uHiresOn > 0.5);
  vec2 gp = uv * uGrid;
  float nowT = mod(floor(uTime * 20.0), 65536.0);
  resetVotes();
  float cellOwn[16]; float cellOcc[16]; float cellWo[16];
  for (int a = 0; a < 16; a++) { cellOwn[a] = -1.0; cellOcc[a] = 0.0; cellWo[a] = 0.0; }
  float changedW = 0.0, contested = 0.0, freshSum = 0.0, totW = 0.0, officialFx = 0.0;
  float occNum = 0.0, occDen = 0.0, frontGlow = 0.0;
  vec2 q = gp;
  if (useField) {
  vec2 wq = gp * 0.017;
  vec2 warp = (textureLod(uNoise, wq, 0.0).rg - 0.5) * 0.9 + (textureLod(uNoise, gp * 0.071, 0.0).ba - 0.5) * 0.35;
  q = gp + warp;
  ivec2 cb = ivec2(floor(q - 0.5));
  for (int dy = -1; dy <= 2; dy++) {
    for (int dx = -1; dx <= 2; dx++) {
      ivec2 c = cb + ivec2(dx, dy);
      c.x = (c.x + int(uGrid.x)) % int(uGrid.x);
      c.y = clamp(c.y, 0, int(uGrid.y) - 1);
      vec4 A = texelFetch(uOwnerA, c, 0);
      float owner = decode16(A.rg);
      if (owner > 65534.5) continue;           // mer
      vec4 B = texelFetch(uOwnerB, c, 0);
      float prev = decode16(A.ba);
      float flags = floor(B.a * 255.0 + 0.5);
      float isLand = mod(flags, 4.0) >= 2.0 ? 1.0 : 0.25;
      bool changed = mod(flags, 2.0) >= 1.0;
      bool occ = mod(floor(flags / 4.0), 2.0) >= 1.0;
      bool justOfficial = mod(floor(flags / 8.0), 2.0) >= 1.0;
      vec2 d = q - (vec2(c) + 0.5);
      d.x = d.x - uGrid.x * floor(d.x / uGrid.x + 0.5);
      float w = kern(d, 1.2) * isLand;
      float wo = kern(d, 0.65) * isLand;   // noyau large : limites d'occupation très arrondies
      totW += w;
      if (!changed && h1 >= 0.0) { vote(h1, w, 0.0); cellOwn[(dy + 1) * 4 + dx + 1] = h1; cellOcc[(dy + 1) * 4 + dx + 1] = 0.0; cellWo[(dy + 1) * 4 + dx + 1] = wo; continue; }
      changedW += w;
      float age = mod(nowT - decode16(B.rg) + 65536.0, 65536.0) / 20.0;
      float occV = occ ? 1.0 : 0.0;
      if (justOfficial) { float k = 1.0 - smoothstep(0.0, 2.2, age); occV = k; officialFx += w * k * (1.0 - k) * 4.0; }
      float pr = prev != owner ? smoothstep(0.0, 1.0, age / uTransition) : 1.0;
      vote(owner, w * pr, occV);
      cellOwn[(dy + 1) * 4 + dx + 1] = owner; cellOcc[(dy + 1) * 4 + dx + 1] = occV; cellWo[(dy + 1) * 4 + dx + 1] = wo;
      if (pr < 1.0) { vote(prev, w * (1.0 - pr), 0.0); freshSum += w * (1.0 - pr); }
      contested += B.b * w;
    }
  }
  }
  float o, wA, oA, o2, wB, oB;
  best2(o, wA, oA, o2, wB, oB);
  if (o < 0.0) { o = h1; wA = 1.0; oA = 0.0; }
  // part occupée du propriétaire dominant (noyau large, parcelles du même propriétaire seulement)
  for (int a = 0; a < 16; a++) {
    if (cellOwn[a] == o) { occNum += cellWo[a] * cellOcc[a]; occDen += cellWo[a]; }
  }
  float occA = occDen > 0.0 ? occNum / occDen : oA / max(wA, 1e-5);
  float occB = oB / max(wB, 1e-5);
  float r = (wA - wB) / (wA + wB + 1e-5);
  float edgeF = (o2 >= 0.0 && o2 != o) ? 1.0 - smoothstep(0.0, fwidth(r) * 1.1 + 1e-4, r) : 0.0;
  float chg = totW > 0.0 ? changedW / totW : 0.0;
  // en dézoom, plusieurs parcelles par pixel : le trait du champ s'efface (pas de scintillement)
  float cellPx = pxAng / (6.2831853 / uGrid.x);
  float fieldFade = 1.0 - smoothstep(0.5, 1.0, cellPx);
  float edgeField = uHiresOn > 0.5 ? edgeF * smoothstep(0.02, 0.2, chg) : edgeF;
  float edge = max(edgeField * fieldFade, edgeHi * (1.0 - smoothstep(0.2, 0.6, chg)) * (1.0 - uVecOn));
  // frontière interne officiel / occupé (même pays)
  float occEdge = (1.0 - smoothstep(0.0, fwidth(occA) * 1.1 + 1e-4, abs(occA - 0.5))) * fieldFade;
  float isOcc = smoothstep(0.45, 0.55, occA);
  // ---------- géométrie des territoires (Terre) : vrais polygones des territoires actuels ----------
  // la clé de chaque pixel vient de la partition polygonale ; les frontières sont tracées par des lignes
  // vectorielles uniquement là où les deux côtés diffèrent.
  if (uTerrOn > 0.5 && uHiresOn > 0.5) {
    float tTex = 6.2831853 / uTerrSize.x;
    float sp = max(1.0, floor(pxAng / tTex));
    vec2 tp = uv * uTerrSize / sp - 0.5;
    ivec2 t0 = ivec2(floor(tp)); vec2 tf = fract(tp);
    float moving = 0.0, frT = 0.0, frW = 0.0;
    resetVotes();
    for (int j = -1; j <= 2; j++) for (int i = -1; i <= 2; i++) {
      ivec2 tc = ivec2(float(t0.x + i) * sp, float(t0.y + j) * sp);
      tc.x = (tc.x % int(uTerrSize.x) + int(uTerrSize.x)) % int(uTerrSize.x); tc.y = clamp(tc.y, 0, int(uTerrSize.y) - 1);
      float mv, fr;
      float key = terrKey(tc, mv, fr);
      moving = max(moving, mv);
      if (key < 0.5) continue;
      key -= 1.0;
      float oc = key >= 32767.5 ? 1.0 : 0.0;
      float kw = kern(tf - vec2(float(i), float(j)), 1.1);
      vote(key - oc * 32768.0, kw, oc);
      frT += kw * fr; frW += kw;
    }
    best2(o, wA, oA, o2, wB, oB);
    occA = oA / max(wA, 1e-5); occB = oB / max(wB, 1e-5);
    isOcc = smoothstep(0.45, 0.55, occA);
    // front en mouvement (animation entre deux états) : trait antialiasé sur la limite affichée
    float rT = (wA - wB) / (wA + wB + 1e-5);
    bool front = moving > 0.5 && o2 >= 0.0 && o2 != o;
    edge = front ? 1.0 - smoothstep(0.0, fwidth(rT) * 1.1 + 1e-4, rT) : 0.0;
    // halo lumineux le long du front actif (quelques pixels de part et d'autre du trait)
    frontGlow = front ? 1.0 - smoothstep(0.0, fwidth(rT) * 7.0 + 1e-4, rT) : 0.0;
    occEdge = 0.0; officialFx = 0.0; contested = 0.0;
    freshSum = frT; totW = frW;
  }

  // ---------- couleur de territoire (par-dessus le terrain) ----------
  vec4 prm = o >= 0.0 && o < 65533.5 ? texelFetch(uParams, ivec2(int(o), 0), 0) : vec4(0.6, 0.62, 0.64, 0.0);
  // frontière d'origine : léger fondu de couleur entre les deux pays (le trait vectoriel reste net)
  if (uTerrOn < 0.5 && uVecOn > 0.5 && h2 >= 0.0 && h2 != h1 && o == h1 && chg < 0.2) {
    vec4 prm2 = texelFetch(uParams, ivec2(int(h2), 0), 0);
    float rh2 = (hw1 - hw2) / (hw1 + hw2 + 1e-5);
    if (abs(prm2.a - prm.a) < 0.5) prm.rgb = mix(prm.rgb, prm2.rgb, 0.5 * (1.0 - smoothstep(0.0, 0.5, rh2)));
  }
  float mode = prm.a;   // 0 neutre, 1 pays hors partie, 2 participant
  vec3 alb = terrainAlbedo(max(hk, 0.0), lat, n);
  if (uGeoOn > 0.5) { vec4 bio = texture(uGeo, vec2((lon + 180.0) / 360.0, (90.0 - lat) / 180.0)); alb = mix(alb, bio.rgb, 0.42 * bio.a); }
  float snow = snowAmount(max(hk, 0.0), lat, n);
  vec3 base;
  if (o < 0.0) base = mix(alb, vec3(0.92, 0.94, 0.97), max(snow, smoothstep(-62.0, -66.0, lat)));
  else if (mode < 0.5) base = mix(alb, vec3(0.60, 0.615, 0.63), 0.72);
  else if (mode < 1.5) {
    float g = dot(prm.rgb, vec3(0.3, 0.55, 0.15));
    base = mix(alb, mix(vec3(g), prm.rgb, 0.62) * 0.92 + 0.06, 0.6);
  } else {
    vec3 c = prm.rgb;
    vec3 off = mix(alb, c, 0.74);
    // occupé : même teinte, plus claire, hachurée
    vec3 occC = mix(alb, mix(c, vec3(1.0), 0.48), 0.85);
    float hl = hatch(lon * cos(radians(lat)) + lat, pxDeg);
    occC = mix(occC, c * 0.78, hl * 0.75);
    base = mix(off, occC, isOcc);
  }
  base = mix(base, vec3(0.95, 0.96, 0.98), snow * 0.45);
  // passage de front : légère lueur ; intégration officielle : éclat bref
  float fresh = totW > 0.0 ? freshSum / totW : 0.0;
  base += vec3(1.0, 0.95, 0.8) * fresh * 0.14;
  base += vec3(1.0, 0.82, 0.45) * frontGlow * (0.16 + 0.06 * sin(uTime * 6.0));
  base += vec3(1.0, 1.0, 0.9) * (totW > 0.0 ? officialFx / totW : 0.0) * 0.12;
  if (totW > 0.0 && contested / totW > 0.3) base = mix(base, vec3(1.0, 0.9, 0.6), 0.08 + 0.06 * sin(uTime * 5.0 + n * 6.0));
  if (abs(o - uSelected) < 0.5) base += vec3(0.10, 0.10, 0.08) * (0.6 + 0.4 * sin(uTime * 4.0));

  // ---------- éclairage du relief + ombres portées ----------
  float shadow = 1.0;
  float NL = dot(N, L);
  if (uShadows > 0.5 && NL > 0.0 && land > 0.01 && hk > 0.05) {
    vec3 Lt = L - N * NL;
    float lt = length(Lt);
    if (lt > 1e-4) {
      Lt /= lt;
      float tanE = NL / lt;
      float h0 = max(hk, 0.0) * uShade;
      float a = e1 * 1.5;
      for (int i = 0; i < 10; i++) {
        float hq = max(reliefAt(normalize(p + Lt * a), lod + float(i) * 0.3), 0.0) * uShade;
        float ray = h0 + a * tanE;
        shadow = min(shadow, clamp((ray - hq) / (a * 0.06) + 0.35, 0.0, 1.0));
        a *= 1.55;
      }
    }
  }
  float dif = max(dot(Nl, L), 0.0);
  float sky = 0.5 + 0.5 * dot(Nl, N);
  vec3 landLit = base * (0.26 * sky + 0.92 * dif * mix(0.35, 1.0, shadow));

  // frontières : traits fins, lisses et antialiasés
  // officiel ↔ officiel : trait continu ; frontière impliquant une zone occupée : pointillés ;
  // officiel ↔ occupé du même pays : pointillés clairs
  if (uShowBorders > 0.5) {
    float along = (lon * cos(radians(lat)) - lat) / (pxDeg * 7.0);
    float dash = smoothstep(0.25, 0.35, abs(fract(along) - 0.5));
    bool occSide = occA > 0.5 || (o2 >= 0.0 && occB > 0.5);
    float lineA = edge * (occSide ? mix(0.35, 1.0, dash) : 1.0) * uBorderFade;
    landLit = mix(landLit, vec3(0.04, 0.05, 0.07), lineA * 0.82);
    if (mode > 1.5) landLit = mix(landLit, vec3(0.97), occEdge * (1.0 - edge) * dash * 0.55 * uBorderFade);
  }

  // ---------- océan ----------
  float dep = max(-hk, 0.004);
  vec3 cShallow = vec3(0.09, 0.50, 0.56), cShelf = vec3(0.04, 0.30, 0.47), cDeep = vec3(0.016, 0.10, 0.25), cAbyss = vec3(0.008, 0.05, 0.15);
  vec3 water = mix(cShallow, cShelf, 1.0 - exp(-dep / 0.06));
  water = mix(water, cDeep, 1.0 - exp(-dep / 0.9));
  water = mix(water, cAbyss, smoothstep(3.8, 7.5, dep));
  // relief du fond visible à travers l'eau (atténué avec la profondeur)
  float floorRelief = dot(Nb, L) - NL;
  water *= 1.0 + floorRelief * (0.9 * exp(-dep / 1.2) + 0.35);
  // surface : vagues, reflets du soleil, ciel rasant
  vec2 wuv = vec2(lon / 360.0 * 60.0, lat / 180.0 * 30.0);
  float wl = max(0.0, log2(pxAng / (6.2831853 / (60.0 * 256.0))));
  float w1n = textureLod(uNoise, wuv + vec2(uTime * 0.004, uTime * 0.002), wl).r;
  float w2n = textureLod(uNoise, wuv * 1.9 - vec2(uTime * 0.003, -uTime * 0.004), wl + 0.9).g;
  vec3 Nw = normalize(N + (east * (w1n - 0.5) + north * (w2n - 0.5)) * 0.045);
  vec3 H = normalize(L + V);
  float spec = pow(max(dot(Nw, H), 0.0), 500.0) * 0.16 + pow(max(dot(N, H), 0.0), 150.0) * 0.012;
  float fres = pow(1.0 - max(dot(N, V), 0.0), 4.0);
  vec3 ocean = water * (0.30 + 0.85 * max(dot(Nw, L), 0.0)) + vec3(1.0, 0.95, 0.85) * spec * smoothstep(0.0, 0.2, NL) + vec3(0.30, 0.50, 0.75) * fres * 0.5;
  // écume discrète le long des côtes
  float foam = coastLine * (0.6 + 0.4 * sin(uTime * 1.3 + (lon + lat) * 40.0));
  ocean = mix(ocean, vec3(0.80, 0.90, 0.95), foam * 0.22);

  vec3 color = mix(ocean, landLit, land);
  color = mix(color, color * 0.75 + vec3(0.02, 0.03, 0.04), coastLine * land * 0.5 * (1.0 - 0.8 * uVecOn));
  float night = smoothstep(0.1, -0.35, NL);
  color = mix(color, color * vec3(0.30, 0.37, 0.58), night * 0.78);
  // brume atmosphérique en incidence rasante
  float haze = pow(1.0 - max(dot(N, V), 0.0), 3.0);
  color = mix(color, vec3(0.42, 0.62, 0.92), haze * 0.45);
  fragColor = vec4(color, 1.0);
}`;

export const atmosphereVertex = /* glsl */`
out vec3 vN;
out vec3 vW;
void main() {
  vN = normalize(mat3(modelMatrix) * normal);
  vec4 w = modelMatrix * vec4(position, 1.0);
  vW = w.xyz;
  gl_Position = projectionMatrix * viewMatrix * w;
}`;

export const atmosphereFragment = /* glsl */`
precision highp float;
in vec3 vN;
in vec3 vW;
out vec4 fragColor;
uniform vec3 uCamPos;
uniform vec3 uSunDir;
void main() {
  vec3 V = normalize(uCamPos - vW);
  float rim = 1.0 - abs(dot(normalize(vN), V));
  float a = pow(clamp(rim, 0.0, 1.0), 2.4);
  float lit = 0.4 + 0.6 * max(dot(normalize(vN), normalize(uSunDir)), 0.0);
  fragColor = vec4(mix(vec3(0.30, 0.55, 1.0), vec3(0.65, 0.82, 1.0), a) * lit, a * 0.8);
}`;

// Unités : petits soldats stylisés (silhouette abstraite : tête, buste, bras et jambes qui marchent),
// debout sur le relief, tournés vers leur destination, ombre au sol. Un groupe = quelques soldats.
export const markerVertex = /* glsl */`
in vec3 aPos;
in vec3 aColor;
in vec4 aData; // taille (px), état + 4 × type (0 marche, 1 combat, 2 pastille ; type 0 infanterie, 1 blindé, 2 artillerie, 3 reconnaissance), apparition 0-1, graine
in vec3 aDir;  // direction de déplacement (monde)
out vec2 vUv;
out vec3 vColor;
out vec4 vData;
out float vPhase;
out float vKind;
out float vShape;   // groupes : forme (0 disque, 1 carré, 2 losange, 3 hexagone)
out vec3 vColor2;   // groupes : couleur secondaire (liseré) ; x < 0 = blanc
uniform float uPixel;
uniform float uTime;
void main() {
  vec4 mv = modelViewMatrix * vec4(aPos, 1.0);
  float appear = clamp(aData.z, 0.0, 1.0);
  float kind = floor(aData.y / 4.0 + 0.001);
  float state = aData.y - kind * 4.0;
  float size = aData.x * uPixel * -mv.z * (0.5 + 0.5 * appear);
  vec3 dv = mat3(modelViewMatrix) * aDir;
  float face = dv.x < 0.0 ? -1.0 : 1.0;
  vec2 c = position.xy;            // -0.5 .. 0.5
  if (state > 1.5) {
    mv.xy += c * size;
    vUv = c;
  } else if (kind > 0.5) {
    // véhicules : quad plus large, posé au sol
    mv.xy += vec2(c.x * 1.25, c.y + 0.42) * size;
    vUv = vec2(c.x * face * 1.25, c.y + 0.5);
  } else {
    // ancré aux pieds : le quad monte au-dessus du point
    mv.xy += vec2(c.x * 0.8, c.y + 0.42) * size;
    vUv = vec2(c.x * face, c.y + 0.5);
  }
  vColor = aColor;
  vShape = state > 1.5 ? aDir.x : 0.0;
  float pk = state > 1.5 ? aDir.y : -1.0;
  vColor2 = pk < 0.0 ? vec3(-1.0) : vec3(floor(pk / 65536.0), mod(floor(pk / 256.0), 256.0), mod(pk, 256.0)) / 255.0;
  vData = vec4(aData.x, state, aData.z, aData.w);
  vKind = kind;
  vPhase = uTime * (state > 0.5 ? 13.0 : 9.0) + aData.w * 5.7;
  gl_Position = projectionMatrix * mv;
}`;

export const markerFragment = /* glsl */`
precision highp float;
in vec2 vUv;
in vec3 vColor;
in vec4 vData;
in float vPhase;
in float vKind;
in float vShape;
in vec3 vColor2;
out vec4 fragColor;
float capsule(vec2 p, vec2 a, vec2 b, float r) {
  vec2 pa = p - a, ba = b - a;
  float h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0);
  return length(pa - ba * h) - r;
}
float rbox(vec2 p, vec2 c, vec2 h, float r) {
  vec2 q = abs(p - c) - h + r;
  return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r;
}
void main() {
  float appear = clamp(vData.z, 0.0, 1.0);
  if (vData.y > 1.5) {
    vec2 q = vUv;
    if (vKind > 0.5) {
      // groupe militaire : forme pleine aux couleurs du pays (disque, carré, losange ou hexagone), liseré clair
      // (ou couleur secondaire), contour sombre renforcé pour rester visible sur tous les fonds, halo au combat
      float r = length(q);
      float d;
      if (vShape > 2.5) { vec2 h = abs(q); d = max(h.x * 0.8660254 + h.y * 0.5, h.y) - 0.29; }          // hexagone
      else if (vShape > 1.5) d = (abs(q.x) + abs(q.y)) * 0.7071068 - 0.255;                            // losange
      else if (vShape > 0.5) d = rbox(q, vec2(0.0), vec2(0.27), 0.05);                                  // carré
      else d = r - 0.3;                                                                                  // disque
      float aa = fwidth(d) * 1.2 + 1e-4;
      float fill = 1.0 - smoothstep(-aa, aa, d + 0.012);
      float ring = smoothstep(-0.085 - aa, -0.085 + aa, d);                // liseré
      float rim = smoothstep(-0.04 - aa, -0.04 + aa, d);                   // contour sombre (renforcé)
      vec3 c = vColor * (1.0 + 0.18 * (1.0 - smoothstep(0.0, 0.22, length(q - vec2(-0.06, 0.07)))));
      c = mix(c, vColor2.x < 0.0 ? vec3(0.97) : vColor2, ring * 0.9);
      c = mix(c, vec3(0.03, 0.035, 0.05), rim * 0.95);
      float a = fill;
      if (vKind > 1.5) {
        float ph = fract(vPhase * 0.08);
        float ring = (1.0 - smoothstep(0.0, 0.025 + aa, abs(r - (0.32 + ph * 0.17)))) * (1.0 - ph);
        a = max(a, ring * 0.8);
        if (fill < 0.01) c = vColor * 0.6 + 0.4;
      }
      float sh = (1.0 - smoothstep(0.28, 0.42, length(q - vec2(0.03, -0.04)))) * 0.35;
      a = max(a, sh);
      if (fill < 0.01 && a <= sh + 1e-4) c = vec3(0.0);
      if (a < 0.01) discard;
      fragColor = vec4(c, a * appear);
      return;
    }
    // pastille (micro-pays)
    float d = length(q) - 0.3;
    float aa = fwidth(d);
    float a = 1.0 - smoothstep(-aa, aa, d);
    vec3 c = mix(vColor, vec3(0.98), smoothstep(-0.09 - aa, -0.09 + aa, d));
    if (a < 0.01) discard;
    fragColor = vec4(c, a);
    return;
  }
  vec2 p = vUv;                         // x : avant = +x, y : 0 (sol) .. 1
  float s = sin(vPhase), cs = cos(vPhase);
  float fight = step(0.5, vData.y);
  float d, dark = 1e3;
  if (vKind < 0.5) {
    // fantassin
    float bob = abs(s) * 0.025;
    vec2 hip = vec2(0.0, 0.40 + bob), sh = vec2(0.02, 0.63 + bob);
    float legA = capsule(p, hip, vec2(0.13 * s, 0.05), 0.068);
    float legB = capsule(p, hip, vec2(-0.13 * s, 0.05), 0.068);
    float body = capsule(p, hip + vec2(0.0, 0.03), sh, 0.125);
    float head = length(p - vec2(0.04, 0.80 + bob)) - 0.11;
    float helm = max(length(p - vec2(0.04, 0.83 + bob)) - 0.13, -(p.y - (0.83 + bob)));
    vec2 hand = mix(vec2(-0.12 * s, 0.44 + bob), vec2(0.26, 0.66 + 0.05 * cs + bob), fight);
    float arm = capsule(p, sh, hand, 0.055);
    d = min(min(min(legA, legB), min(body, min(head, helm))), arm);
  } else if (vKind < 1.5) {
    // char : chenilles, caisse, tourelle, canon (recul au combat)
    float rec = fight * max(0.0, s) * 0.05;
    float tracks = rbox(p, vec2(0.0, 0.12), vec2(0.5, 0.1), 0.09);
    float hull = rbox(p, vec2(0.0, 0.27), vec2(0.46, 0.08), 0.04);
    float turret = rbox(p, vec2(-0.05, 0.42), vec2(0.2, 0.08), 0.06);
    float gun = capsule(p, vec2(0.12, 0.43), vec2(0.62 - rec, 0.45), 0.028);
    d = min(min(tracks, hull), min(turret, gun));
    dark = tracks;
    for (int k = 0; k < 4; k++) dark = min(dark, length(p - vec2(-0.33 + float(k) * 0.22, 0.11)) - 0.055);
  } else if (vKind < 2.5) {
    // artillerie : roues, affût, long tube relevé
    float rec = fight * max(0.0, s) * 0.06;
    float wheel = length(p - vec2(-0.05, 0.14)) - 0.13;
    float trail = capsule(p, vec2(-0.05, 0.16), vec2(-0.52, 0.04), 0.035);
    float shield = rbox(p, vec2(0.02, 0.32), vec2(0.06, 0.13), 0.02);
    vec2 dir = normalize(vec2(0.78, 0.5));
    float tube = capsule(p, vec2(-0.02, 0.3) - dir * rec, vec2(-0.02, 0.3) + dir * (0.62 - rec), 0.035);
    d = min(min(wheel, trail), min(shield, tube));
    dark = min(wheel, trail) + 0.01;
  } else {
    // véhicule de reconnaissance : caisse basse, pare-brise, deux roues
    float body = rbox(p, vec2(0.0, 0.25), vec2(0.42, 0.09), 0.06);
    float cab = rbox(p, vec2(-0.08, 0.38), vec2(0.18, 0.07), 0.04);
    float w1 = length(p - vec2(-0.26, 0.11)) - 0.1, w2 = length(p - vec2(0.26, 0.11)) - 0.1;
    float ant = capsule(p, vec2(-0.3, 0.33), vec2(-0.38, 0.7), 0.012);
    d = min(min(body, cab), min(min(w1, w2), ant));
    dark = min(w1, w2);
  }
  float aa = fwidth(d) * 0.9;
  float fill = 1.0 - smoothstep(-aa, aa, d);
  float rimW = vKind > 0.5 ? 0.022 : 0.05;
  float rim = smoothstep(-rimW - aa, -rimW + aa, d);
  float shadow = (1.0 - smoothstep(0.0, 0.035, length((p - vec2(0.0, 0.02)) * vec2(vKind > 0.5 ? 0.7 : 1.0, 4.0)) - 0.2)) * 0.35;
  vec3 light = vColor * (0.92 + 0.22 * smoothstep(0.3, 0.9, p.y));
  vec3 c = mix(light, vec3(0.05, 0.06, 0.08), rim * 0.85);
  c = mix(c, vec3(0.16, 0.17, 0.19), (1.0 - smoothstep(-aa, aa, dark)) * 0.7);
  float a = max(fill, shadow);
  if (a < 0.01) discard;
  fragColor = vec4(fill > 0.001 ? c : vec3(0.0), a * appear);
}`;

// Anneaux d'effets (captures, événements)
export const ringVertex = /* glsl */`
in vec3 aPos;
in vec4 aData; // âge 0-1, taille, intensité, -
in vec3 aColor;
out vec2 vUv;
out vec4 vData;
out vec3 vColor;
uniform float uPixel;
void main() {
  vec3 n = normalize(aPos);
  vec3 t = normalize(abs(n.y) < 0.99 ? cross(n, vec3(0.0, 1.0, 0.0)) : cross(n, vec3(1.0, 0.0, 0.0)));
  vec3 b = cross(n, t);
  vec4 mvc = modelViewMatrix * vec4(aPos, 1.0);
  float r = min(aData.y, uPixel * -mvc.z * 26.0 * (aData.z > 0.5 ? 2.5 : 1.0)) * (0.3 + aData.x * 1.2);
  vec3 p = aPos + (t * (position.x - 0.5) + b * (position.y - 0.5)) * 2.0 * r;
  vUv = position.xy;
  vData = aData;
  vColor = aColor;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
}`;

export const ringFragment = /* glsl */`
precision highp float;
in vec2 vUv;
in vec4 vData;
in vec3 vColor;
out vec4 fragColor;
void main() {
  float d = length(vUv - 0.5) * 2.0;
  float ring = smoothstep(0.72, 0.86, d) * (1.0 - smoothstep(0.86, 1.0, d));
  float glow = (1.0 - d) * 0.25 * vData.z;
  float a = (ring * 0.55 + max(glow, 0.0)) * (1.0 - vData.x) * (1.0 - vData.x);
  if (a < 0.01) discard;
  fragColor = vec4(vColor * (1.0 + vData.z * 0.5), a);
}`;
