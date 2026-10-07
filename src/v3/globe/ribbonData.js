// Données de rubans (lignes à épaisseur d'écran) : fonction pure, utilisée par le rendu et par le
// travailleur de géométrie (les lignes de front sont préparées hors du fil principal).
// polylines : tableaux de directions unitaires [x, y, z]
export function ribbonArrays(polylines) {
  let segs = 0;
  for (const pl of polylines) segs += Math.max(0, pl.length - 1);
  const pos = new Float32Array(segs * 12), oth = new Float32Array(segs * 12), side = new Float32Array(segs * 4), end = new Float32Array(segs * 4), len = new Float32Array(segs * 4);
  const idx = new Uint32Array(segs * 6);
  let s = 0;
  for (const pl of polylines) {
    let L = 0;     // longueur cumulée (km) : pointillés
    for (let k = 0; k + 1 < pl.length; k++, s++) {
      const a = pl[k], b = pl[k + 1];
      const v = s * 4;
      const l0 = L; L += 6371 * Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
      const put = (j, p, o, sd, e) => { pos.set(p, (v + j) * 3); oth.set(o, (v + j) * 3); side[v + j] = sd; end[v + j] = e; len[v + j] = e ? L : l0; };
      put(0, a, b, 1, 0); put(1, a, b, -1, 0); put(2, b, a, 1, 1); put(3, b, a, -1, 1);
      idx.set([v, v + 1, v + 2, v + 1, v + 3, v + 2], s * 6);
    }
  }
  return { pos, oth, side, end, len, idx };
}
export const unitLL = (lon, lat) => { const D = Math.PI / 180, c = Math.cos(lat * D); return [c * Math.sin(lon * D), Math.sin(lat * D), c * Math.cos(lon * D)]; };
