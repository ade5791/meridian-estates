// S6d-FIX-03: player-controlled camera orbit for the 3D board.
//
// Before S6d the camera was welded to a solved default position (S6b-FIX-01
// deliberately stopped it chasing tokens, because the chase read as glitching).
// That fixed the instability but left the board un-inspectable: a player could
// not look along a side, get low for the skyline, or zoom in on a property.
//
// This is a small purpose-built controller rather than three's OrbitControls
// because the published build vendors only three.module.js / three.core.js -
// pulling an addon would add an external file to a gated byte set for no gain.
//
// Design constraints:
//  - ZERO per-frame allocation: all vectors are preallocated scratch.
//  - The solved framing from RenderSystem.resize() remains the DEFAULT and the
//    reset target, so the game still opens perfectly framed.
//  - Damped: input sets a target, update() eases toward it, so a flick does not
//    snap. This is what keeps it from reading as the old jitter.
//  - Clamped polar angle so the camera can never go under the board or fully
//    top-down, and clamped radius so the board cannot be lost off-screen.
//  - Pointer Events, so mouse / pen / touch all use one code path. Two-finger
//    pinch is handled explicitly for zoom on phones.
//  - Every listener is stored and removed in dispose() (leak discipline).

import * as THREE from 'three';

const MIN_POLAR = 0.22;   // near-horizon limit (radians from +Y)
const MAX_POLAR = 1.40;   // just short of ground level
const DAMP = 0.16;        // per-frame easing factor toward the target

export class CameraControl {
  constructor(camera, domElement) {
    this.camera = camera;
    this.dom = domElement;
    this.enabled = true;
    this.userMoved = false;   // true once the player has actually orbited

    // spherical state: target (input) and current (rendered)
    this.tAzim = 0; this.tPolar = 0.8; this.tRadius = 30;
    this.azim = 0; this.polar = 0.8; this.radius = 30;
    this.aim = new THREE.Vector3(0, 0, 0);

    this.minRadius = 10;
    this.maxRadius = 70;

    this._v = new THREE.Vector3();          // scratch, never reallocated
    this._pointers = new Map();             // pointerId -> {x, y}
    this._lastPinch = 0;

    this._bind();
  }

  // Called by RenderSystem.resize() once it has solved the default framing.
  // Establishes both the reset pose and the zoom range from that solution.
  setDefault(position, aim) {
    this.aim.copy(aim);
    this._v.copy(position).sub(aim);
    const r = this._v.length();
    this.defRadius = r;
    this.defAzim = Math.atan2(this._v.x, this._v.z);
    this.defPolar = Math.acos(Math.min(1, Math.max(-1, this._v.y / r)));
    this.minRadius = r * 0.42;
    this.maxRadius = r * 1.85;
    if (!this.userMoved) {
      this.tAzim = this.azim = this.defAzim;
      this.tPolar = this.polar = this.defPolar;
      this.tRadius = this.radius = r;
    } else {
      // keep the player's angle, but re-clamp the distance to the new viewport
      this.tRadius = Math.min(this.maxRadius, Math.max(this.minRadius, this.tRadius));
    }
  }

  reset() {
    if (this.defRadius === undefined) return;
    this.userMoved = false;
    this.tAzim = this.defAzim;
    this.tPolar = this.defPolar;
    this.tRadius = this.defRadius;
  }

  _bind() {
    const d = this.dom;
    this._onDown = (e) => {
      if (!this.enabled) return;
      this._pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (d.setPointerCapture) { try { d.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ } }
    };
    this._onMove = (e) => {
      if (!this.enabled) return;
      const prev = this._pointers.get(e.pointerId);
      if (!prev) return;
      const dx = e.clientX - prev.x;
      const dy = e.clientY - prev.y;
      this._pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

      if (this._pointers.size >= 2) {
        // two-finger pinch => zoom
        const pts = Array.from(this._pointers.values());
        const dist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
        if (this._lastPinch > 0) {
          const scale = this._lastPinch / dist;
          this.tRadius = Math.min(this.maxRadius,
            Math.max(this.minRadius, this.tRadius * scale));
          this.userMoved = true;
        }
        this._lastPinch = dist;
        return;
      }
      // single pointer => orbit
      if (dx === 0 && dy === 0) return;
      this.tAzim -= dx * 0.006;
      this.tPolar = Math.min(MAX_POLAR, Math.max(MIN_POLAR, this.tPolar + dy * 0.005));
      this.userMoved = true;
    };
    this._onUp = (e) => {
      this._pointers.delete(e.pointerId);
      if (this._pointers.size < 2) this._lastPinch = 0;
    };
    this._onWheel = (e) => {
      if (!this.enabled) return;
      e.preventDefault();
      const f = Math.exp(e.deltaY * 0.0011);
      this.tRadius = Math.min(this.maxRadius, Math.max(this.minRadius, this.tRadius * f));
      this.userMoved = true;
    };
    // Keyboard: arrows/WASD orbit, +/- zoom, R resets. Ignored while typing.
    this._onKey = (e) => {
      if (!this.enabled) return;
      const tag = (e.target && e.target.tagName) || '';
      if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;
      const k = e.key.toLowerCase();
      let used = true;
      if (k === 'arrowleft' || k === 'a') this.tAzim += 0.12;
      else if (k === 'arrowright' || k === 'd') this.tAzim -= 0.12;
      else if (k === 'arrowup' || k === 'w') this.tPolar = Math.max(MIN_POLAR, this.tPolar - 0.07);
      else if (k === 'arrowdown' || k === 's') this.tPolar = Math.min(MAX_POLAR, this.tPolar + 0.07);
      else if (k === '+' || k === '=') this.tRadius = Math.max(this.minRadius, this.tRadius * 0.9);
      else if (k === '-' || k === '_') this.tRadius = Math.min(this.maxRadius, this.tRadius * 1.1);
      else if (k === 'r') this.reset();
      else used = false;
      if (used) { this.userMoved = k !== 'r'; e.preventDefault(); }
    };

    d.addEventListener('pointerdown', this._onDown);
    d.addEventListener('pointermove', this._onMove);
    d.addEventListener('pointerup', this._onUp);
    d.addEventListener('pointercancel', this._onUp);
    d.addEventListener('pointerleave', this._onUp);
    d.addEventListener('wheel', this._onWheel, { passive: false });
    window.addEventListener('keydown', this._onKey);
  }

  // Damped follow. Called once per frame by RenderSystem.update().
  //
  // S6d-FIX-03b: the damping is FRAME-RATE INDEPENDENT. A raw per-frame
  // lerp (v += (target - v) * DAMP) converges in a fixed number of FRAMES,
  // so on a slow device the camera crawls and "Reset View" visibly fails to
  // arrive (measured: 6.1 units short after 1.1s on the software rasterizer).
  // Converting the constant into an exponential decay over elapsed TIME makes
  // the settle take the same wall-clock duration on every device.
  update(dtMs) {
    const dt = Math.min(0.1, Math.max(0.001, (dtMs || 16.7) / 1000));
    const a = 1 - Math.pow(1 - DAMP, dt * 60); // DAMP calibrated at 60fps
    this.azim += (this.tAzim - this.azim) * a;
    this.polar += (this.tPolar - this.polar) * a;
    this.radius += (this.tRadius - this.radius) * a;
    // snap out the last sliver so a reset lands exactly on the solved pose
    if (Math.abs(this.tAzim - this.azim) < 1e-3) this.azim = this.tAzim;
    if (Math.abs(this.tPolar - this.polar) < 1e-3) this.polar = this.tPolar;
    if (Math.abs(this.tRadius - this.radius) < 1e-2) this.radius = this.tRadius;
    const sp = Math.sin(this.polar), cp = Math.cos(this.polar);
    this.camera.position.set(
      this.aim.x + this.radius * sp * Math.sin(this.azim),
      this.aim.y + this.radius * cp,
      this.aim.z + this.radius * sp * Math.cos(this.azim));
    this.camera.up.set(0, 1, 0);
    this.camera.lookAt(this.aim);
  }

  dispose() {
    const d = this.dom;
    d.removeEventListener('pointerdown', this._onDown);
    d.removeEventListener('pointermove', this._onMove);
    d.removeEventListener('pointerup', this._onUp);
    d.removeEventListener('pointercancel', this._onUp);
    d.removeEventListener('pointerleave', this._onUp);
    d.removeEventListener('wheel', this._onWheel);
    window.removeEventListener('keydown', this._onKey);
    this._pointers.clear();
    this.enabled = false;
  }
}
