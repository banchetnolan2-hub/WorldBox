// MAP — caméra : zoom, déplacement, retour à la vue complète, suivi automatique
export class Camera {
  constructor() {
    this.x = 800; this.y = 500; this.zoom = 1;
    this.target = null;       // { x, y, zoom } animation douce
    this.viewW = 1; this.viewH = 1;
    this.fitZoom = 1;
    this.minZoom = 0.3; this.maxZoom = 14;
    this.home = { x: 800, y: 500, zoom: 1 };
  }

  setViewport(w, h) { this.viewW = w; this.viewH = h; }

  // Calcule la vue complète pour une boîte englobante (en unités monde)
  fit(bounds, padding = { top: 110, right: 40, bottom: 110, left: 40 }, instant = false) {
    const [[x0, y0], [x1, y1]] = bounds;
    const availW = Math.max(100, this.viewW - padding.left - padding.right);
    const availH = Math.max(100, this.viewH - padding.top - padding.bottom);
    const zoom = Math.min(availW / (x1 - x0), availH / (y1 - y0));
    const cxScreen = padding.left + availW / 2;
    const cyScreen = padding.top + availH / 2;
    // centre monde tel que le centre de la boîte tombe au centre de la zone disponible
    const x = (x0 + x1) / 2 - (cxScreen - this.viewW / 2) / zoom;
    const y = (y0 + y1) / 2 - (cyScreen - this.viewH / 2) / zoom;
    this.fitZoom = zoom;
    this.minZoom = zoom * 0.45;
    this.maxZoom = zoom * 14;
    this.home = { x, y, zoom };
    if (instant) { this.x = x; this.y = y; this.zoom = zoom; this.target = null; }
    else this.target = { ...this.home };
  }

  reset() { this.target = { ...this.home }; }

  worldToScreen(wx, wy) {
    return [(wx - this.x) * this.zoom + this.viewW / 2, (wy - this.y) * this.zoom + this.viewH / 2];
  }
  screenToWorld(sx, sy) {
    return [(sx - this.viewW / 2) / this.zoom + this.x, (sy - this.viewH / 2) / this.zoom + this.y];
  }

  zoomAt(factor, sx, sy) {
    const [wx, wy] = this.screenToWorld(sx, sy);
    const z = Math.min(this.maxZoom, Math.max(this.minZoom, this.zoom * factor));
    this.zoom = z;
    // garde le point sous le curseur immobile
    this.x = wx - (sx - this.viewW / 2) / z;
    this.y = wy - (sy - this.viewH / 2) / z;
    this.target = null;
  }

  zoomCenter(factor) {
    const t = this.target || { x: this.x, y: this.y, zoom: this.zoom };
    const z = Math.min(this.maxZoom, Math.max(this.minZoom, t.zoom * factor));
    this.target = { x: t.x, y: t.y, zoom: z };
  }

  pan(dxScreen, dyScreen) {
    this.x -= dxScreen / this.zoom;
    this.y -= dyScreen / this.zoom;
    this.target = null;
  }

  follow(x, y, zoom) { this.target = { x, y, zoom: Math.min(this.maxZoom, Math.max(this.minZoom, zoom)) }; }

  update(dt) {
    if (!this.target) return false;
    const k = 1 - Math.exp(-dt * 5);
    this.x += (this.target.x - this.x) * k;
    this.y += (this.target.y - this.y) * k;
    // zoom interpolé en logarithmique pour un mouvement naturel
    this.zoom = Math.exp(Math.log(this.zoom) + (Math.log(this.target.zoom) - Math.log(this.zoom)) * k);
    if (Math.abs(this.target.x - this.x) < 0.05 && Math.abs(this.target.y - this.y) < 0.05 && Math.abs(this.target.zoom / this.zoom - 1) < 0.001) {
      this.x = this.target.x; this.y = this.target.y; this.zoom = this.target.zoom;
      this.target = null;
    }
    return true;
  }
}
