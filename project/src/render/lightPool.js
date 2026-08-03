// FIXED LIGHT POOL (v2 rule 1). All 6 PointLights are created once and added
// to the scene once at init with intensity 0. Effects acquire()/release();
// overflow requests return null and the effect runs unlit.
// Scene light count NEVER changes at runtime -> stable program keys.

import * as THREE from 'three';

export class LightPool {
  static id = 'lights';
  static deps = [];

  constructor(size = 6) {
    this.size = size;
    this.pool = [];
    this.inUse = new Set();
  }

  init(ctx) {
    const scene = ctx.get('render').scene;
    for (let i = 0; i < this.size; i++) {
      const l = new THREE.PointLight(0xffffff, 0, 8, 2);
      l.position.set(0, 3, 0);
      scene.add(l);
      this.pool.push(l);
    }
  }

  acquire() {
    for (const l of this.pool) {
      if (!this.inUse.has(l)) {
        this.inUse.add(l);
        return l;
      }
    }
    return null; // overflow: effect runs unlit
  }

  release(l) {
    if (!l) return;
    l.intensity = 0;
    this.inUse.delete(l);
  }

  update() {}
  dispose() { this.pool.length = 0; this.inUse.clear(); }
}
