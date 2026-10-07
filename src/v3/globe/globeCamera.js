// GLOBE — caméra orbitale (rotation, zoom, déplacements animés, caméra automatique)
import * as THREE from 'three';

const DEG = Math.PI / 180;
export const MIN_DIST = 1.045, MAX_DIST = 4.6;

export class GlobeCamera {
  constructor(camera) {
    this.camera = camera;
    this.lat = 30; this.lon = 10; this.dist = 3.2;
    this.target = null;
    this.flySpeed = 2.2;
    this.velocity = { lat: 0, lon: 0 };
    this.idleSpin = 0; // rotation lente (menu)
    this.tilt = true;  // vue inclinée en zoom proche
    this.zoomGoal = null;
    this.minDist = MIN_DIST;     // zoom très proche possible (éditeur de frontières)
    this.apply();
  }

  position(out = new THREE.Vector3()) {
    const phi = this.lat * DEG, lam = this.lon * DEG;
    return out.set(Math.cos(phi) * Math.sin(lam), Math.sin(phi), Math.cos(phi) * Math.cos(lam)).multiplyScalar(this.dist);
  }

  // inclinaison de la vue en zoom proche : on regarde vers l'horizon pour voir le relief en 3D
  tiltAngle() {
    const alt = this.dist - 1;
    const t = Math.max(0, Math.min(1, (0.42 - alt) / (0.42 - (MIN_DIST - 1))));
    return this.tilt ? t * t * (3 - 2 * t) * 0.95 : 0;
  }

  apply() {
    const phi = this.lat * DEG, lam = this.lon * DEG;
    const S = new THREE.Vector3(Math.cos(phi) * Math.sin(lam), Math.sin(phi), Math.cos(phi) * Math.cos(lam));
    const alt = this.dist - 1;
    const tilt = this.tiltAngle();
    if (tilt < 1e-3) {
      this.camera.position.copy(S).multiplyScalar(this.dist);
      this.camera.up.set(0, 1, 0);
      this.camera.lookAt(0, 0, 0);
    } else {
      // caméra reculée vers le sud, regard vers le point visé (vers le nord)
      const north = new THREE.Vector3(-Math.sin(phi) * Math.sin(lam), Math.cos(phi), -Math.sin(phi) * Math.cos(lam));
      const target = S.clone().multiplyScalar(1 + 0.004);
      this.camera.position.copy(target).addScaledVector(S, alt * Math.cos(tilt)).addScaledVector(north, -alt * Math.sin(tilt));
      this.camera.up.copy(S);
      this.camera.lookAt(target);
    }
    this.camera.near = Math.max(0.002, alt * 0.2);
    this.camera.far = 60;
    this.camera.updateProjectionMatrix();
  }

  rotateBy(dx, dy) {
    const k = (this.dist - 1) * 0.11 + 0.004;
    this.lon -= dx * k;
    this.lat = Math.max(-85, Math.min(85, this.lat + dy * k));
    this.target = null;
    this.velocity.lon = -dx * k; this.velocity.lat = dy * k;
  }

  // zoom doux : on déplace un objectif, la caméra le rejoint progressivement
  zoomBy(factor) {
    const base = this.zoomGoal !== null ? this.zoomGoal : this.dist;
    this.zoomGoal = 1 + Math.max(this.minDist - 1, Math.min(MAX_DIST - 1, (base - 1) * factor));
    if (this.target) this.target.dist = this.zoomGoal;
  }

  flyTo(lat, lon, dist = this.dist, speed = 2.2) {
    this.zoomGoal = null;
    this.target = { lat, lon, dist: Math.max(this.minDist, Math.min(MAX_DIST, dist)) };
    this.flySpeed = speed;
    this.flyAge = 0;
  }

  update(dt) {
    if (this.target) {
      // départ progressif (pas d'à-coup), puis approche exponentielle
      this.flyAge = (this.flyAge || 0) + dt;
      const ramp = Math.min(1, this.flyAge / 0.45);
      const k = 1 - Math.exp(-dt * this.flySpeed * ramp * ramp * (3 - 2 * ramp));
      let dl = ((this.target.lon - this.lon + 540) % 360) - 180;
      this.lon += dl * k;
      this.lat += (this.target.lat - this.lat) * k;
      this.dist = Math.exp(Math.log(this.dist) + (Math.log(this.target.dist) - Math.log(this.dist)) * k);
      if (Math.abs(dl) < 0.01 && Math.abs(this.target.lat - this.lat) < 0.01 && Math.abs(this.target.dist - this.dist) < 0.001) this.target = null;
      this.zoomGoal = null;
    } else {
      if (this.zoomGoal !== null) {
        const kz = 1 - Math.exp(-dt * 9);
        this.dist = Math.exp(Math.log(this.dist) + (Math.log(this.zoomGoal) - Math.log(this.dist)) * kz);
        if (Math.abs(this.dist - this.zoomGoal) < 1e-5) this.zoomGoal = null;
      }
      // inertie après un glissement
      this.lon += this.velocity.lon * 0.9 * (dt * 60) * 0.12;
      this.lat = Math.max(-85, Math.min(85, this.lat + this.velocity.lat * 0.9 * (dt * 60) * 0.12));
      this.velocity.lon *= Math.pow(0.02, dt); this.velocity.lat *= Math.pow(0.02, dt);
      if (this.idleSpin) this.lon += this.idleSpin * dt;
    }
    this.lon = ((this.lon + 540) % 360) - 180;
    this.apply();
  }
}
