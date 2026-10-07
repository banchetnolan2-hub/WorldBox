// TRAVAILLEUR DE GÉOMÉTRIE : exécute le calcul géométrique des territoires hors du fil principal.
import { createGeometryCore } from './geometryCore.js';

const core = createGeometryCore();
self.onmessage = (ev) => {
  const r = core(ev.data);
  if (r) self.postMessage(r.msg, r.transfer);
};
