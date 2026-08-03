// S6c: real 3D architecture for every one of the 40 board tiles.
//
// Doctrine constraints this module obeys:
//  - ZERO per-frame allocation: everything is built once at board construction.
//  - SHARED geometry/material cache: 40 landmarks are assembled from a small
//    pool of reused primitives, so geometry/texture counts stay flat and the
//    leak audit still returns to baseline after a restart.
//  - DETERMINISTIC variation: silhouette jitter comes from a pure integer hash
//    of the tile index, never Math.random, so a seeded capture is reproducible.
//  - NO NEW LIGHTS: the fixed light pool rule is absolute. Landmarks are lit
//    entirely by the existing rig; depth reads come from geometry and albedo.
//  - Footprint is parked on the OUTER half of the tile so the inner edge stays
//    free for houses/hotels and the centre stays free for player tokens.

import * as THREE from 'three';

// deterministic 0..1 from an integer (xorshift-style mix, no RNG stream needed
// because this is pure static art, not gameplay)
function h01(i, salt = 0) {
  let x = (i * 374761393 + salt * 668265263) | 0;
  x = (x ^ (x >>> 13)) | 0;
  x = Math.imul(x, 1274126177) | 0;
  x = (x ^ (x >>> 16)) >>> 0;
  return x / 4294967296;
}

// per-group architectural character. tier drives height; palette drives walls.
const GROUP_STYLE = {
  harbor:  { kind: 'warehouse', tier: 0.55, wall: 0x8a7355, roof: 0x5b4a35 },
  grove:   { kind: 'house',     tier: 0.60, wall: 0xdfe9ee, roof: 0x6f8fa0 },
  midtown: { kind: 'block',     tier: 0.85, wall: 0xd8c3cf, roof: 0x8e5f77 },
  foundry: { kind: 'factory',   tier: 0.80, wall: 0xc8a077, roof: 0x7a5230 },
  arts:    { kind: 'theatre',   tier: 0.95, wall: 0xe0c2c2, roof: 0x8f3535 },
  uptown:  { kind: 'tower',     tier: 1.15, wall: 0xe6dcb4, roof: 0x9a8b3a },
  summit:  { kind: 'tower',     tier: 1.35, wall: 0xcfe3d4, roof: 0x2f7d4a },
  crown:   { kind: 'spire',     tier: 1.60, wall: 0xcfd6ea, roof: 0x24407f },
};

export class LandmarkFactory {
  constructor() {
    this._geo = new Map();
    this._mat = new Map();
  }

  // cached geometry
  g(key, make) {
    let v = this._geo.get(key);
    if (!v) { v = make(); this._geo.set(key, v); }
    return v;
  }

  // cached standard material
  m(key, params) {
    let v = this._mat.get(key);
    if (!v) { v = new THREE.MeshStandardMaterial(params); this._mat.set(key, v); }
    return v;
  }

  box(w, hh, d) { return this.g(`b${w}_${hh}_${d}`, () => new THREE.BoxGeometry(w, hh, d)); }
  cyl(r, hh, s = 10) { return this.g(`c${r}_${hh}_${s}`, () => new THREE.CylinderGeometry(r, r, hh, s)); }
  cone(r, hh, s = 8) { return this.g(`n${r}_${hh}_${s}`, () => new THREE.ConeGeometry(r, hh, s)); }
  sph(r, s = 10) { return this.g(`s${r}_${s}`, () => new THREE.SphereGeometry(r, s, s)); }

  wall(hex) { return this.m(`w${hex}`, { color: hex, roughness: 0.82, metalness: 0.02 }); }
  roofM(hex) { return this.m(`r${hex}`, { color: hex, roughness: 0.68, metalness: 0.04 }); }
  glass() { return this.m('glass', { color: 0x2c4a63, roughness: 0.22, metalness: 0.55 }); }
  metal() { return this.m('metal', { color: 0x9099a2, roughness: 0.42, metalness: 0.75 }); }
  stone() { return this.m('stone', { color: 0xd6d0bd, roughness: 0.9, metalness: 0.0 }); }
  gold() { return this.m('gold', { color: 0xd8c07a, roughness: 0.35, metalness: 0.7 }); }
  timber() { return this.m('timber', { color: 0x6b4f2a, roughness: 0.88, metalness: 0.0 }); }
  green() { return this.m('foliage', { color: 0x38713f, roughness: 0.95, metalness: 0.0 }); }

  mesh(geo, mat, x, y, z) {
    const o = new THREE.Mesh(geo, mat);
    o.position.set(x, y, z);
    o.castShadow = true;
    o.receiveShadow = true;
    return o;
  }

  // ---- the public entry point -------------------------------------------
  // Returns a Group in TILE-LOCAL space: -z is toward the board centre,
  // +z is outward, y=0 is the tile top surface.
  build(i, t) {
    // S6c-FIX: the outward parking offset lives on an INNER group. The caller
    // does `lm.position.copy(tilePos)`, which overwrites x/y/z wholesale - so
    // setting it on the outer group silently wiped the offset and left every
    // landmark centred on the tile (measured: 8 tiles' visual mass ended up
    // INWARD of the tile centre, colliding with the token/house strip).
    const outer = new THREE.Group();
    const g = new THREE.Group();
    outer.add(g);
    const type = t.type;
    if (type === 'prop') this.property(g, i, t);
    else if (type === 'rail') this.station(g, i);
    else if (type === 'util') this.utility(g, i, t);
    else if (type === 'tax') this.taxOffice(g, i);
    else if (type === 'card') this.kiosk(g, i, t);
    else if (type === 'start') this.launchArch(g);
    else if (type === 'jail') this.holdingHouse(g);
    else if (type === 'parking') this.commons(g);
    else if (type === 'gotojail') this.courthouse(g);
    // Park the whole landmark on the outer half of the tile. On the INNER
    // group, so the caller's position.copy(tilePos) cannot erase it.
    g.position.z = 0.40;
    return outer;
  }

  // ---- streets -----------------------------------------------------------
  property(g, i, t) {
    const st = GROUP_STYLE[t.group] || GROUP_STYLE.harbor;
    const jitter = 0.85 + h01(i, 1) * 0.3;
    const hgt = st.tier * jitter;
    const wall = this.wall(st.wall);
    const roof = this.roofM(st.roof);

    if (st.kind === 'warehouse') {
      g.add(this.mesh(this.box(0.9, 0.42, 0.62), wall, 0, 0.21, 0));
      // pitched roof as a rotated 4-sided cone (shared with other pitched roofs)
      const r = this.mesh(this.cone(0.62, 0.26, 4), roof, 0, 0.55, 0);
      r.rotation.y = Math.PI / 4;
      g.add(r);
      g.add(this.mesh(this.box(0.16, 0.24, 0.06), this.timber(), -0.24, 0.12, 0.32));
      g.add(this.mesh(this.box(0.16, 0.24, 0.06), this.timber(), 0.24, 0.12, 0.32));
      // dockside crane arm
      g.add(this.mesh(this.cyl(0.03, 0.5, 6), this.metal(), 0.42, 0.25, -0.22));
      g.add(this.mesh(this.box(0.30, 0.04, 0.04), this.metal(), 0.30, 0.50, -0.22));
    } else if (st.kind === 'house') {
      const w = 0.46 + h01(i, 2) * 0.10;
      g.add(this.mesh(this.box(0.52, 0.34 * jitter, 0.44), wall, -0.16, 0.17 * jitter, 0));
      const r1 = this.mesh(this.cone(0.42, 0.24, 4), roof, -0.16, 0.34 * jitter + 0.12, 0);
      r1.rotation.y = Math.PI / 4;
      g.add(r1);
      // detached garage + a tree, so the group reads as a leafy suburb
      g.add(this.mesh(this.box(0.28, 0.22, 0.30), wall, 0.34, 0.11, 0.02));
      const r2 = this.mesh(this.cone(0.26, 0.14, 4), roof, 0.34, 0.29, 0.02);
      r2.rotation.y = Math.PI / 4;
      g.add(r2);
      g.add(this.mesh(this.cyl(0.03, 0.18, 6), this.timber(), 0.30, 0.09, -0.30));
      g.add(this.mesh(this.sph(0.14, 8), this.green(), 0.30, 0.30, -0.30));
      void w;
    } else if (st.kind === 'block') {
      g.add(this.mesh(this.box(0.80, 0.62 * jitter, 0.56), wall, 0, 0.31 * jitter, 0));
      g.add(this.mesh(this.box(0.66, 0.10, 0.44), this.glass(), 0, 0.30 * jitter, 0.07));
      g.add(this.mesh(this.box(0.86, 0.06, 0.62), roof, 0, 0.62 * jitter + 0.03, 0));
      g.add(this.mesh(this.box(0.20, 0.16, 0.20), this.stone(), 0.22, 0.62 * jitter + 0.11, -0.10));
    } else if (st.kind === 'factory') {
      g.add(this.mesh(this.box(0.86, 0.44, 0.58), wall, 0, 0.22, 0));
      // sawtooth roof
      for (let k = 0; k < 3; k++) {
        const s = this.mesh(this.box(0.26, 0.16, 0.56), roof, -0.28 + k * 0.28, 0.52, 0);
        s.rotation.x = 0.35;
        g.add(s);
      }
      const ch = 0.55 + h01(i, 3) * 0.25;
      g.add(this.mesh(this.cyl(0.075, ch, 8), this.stone(), 0.36, 0.44 + ch / 2, -0.18));
      g.add(this.mesh(this.cyl(0.09, 0.05, 8), this.metal(), 0.36, 0.44 + ch, -0.18));
    } else if (st.kind === 'theatre') {
      g.add(this.mesh(this.box(0.82, 0.60 * jitter, 0.54), wall, 0, 0.30 * jitter, 0));
      // marquee canopy over the entrance
      g.add(this.mesh(this.box(0.70, 0.05, 0.20), this.gold(), 0, 0.30, 0.34));
      for (let k = 0; k < 4; k++) {
        g.add(this.mesh(this.cyl(0.035, 0.34, 8), this.stone(), -0.27 + k * 0.18, 0.17, 0.26));
      }
      // fly tower
      g.add(this.mesh(this.box(0.34, 0.30, 0.34), wall, -0.10, 0.60 * jitter + 0.15, -0.06));
      g.add(this.mesh(this.box(0.90, 0.05, 0.60), roof, 0, 0.60 * jitter + 0.03, 0));
    } else if (st.kind === 'tower') {
      const floors = 3 + Math.floor(h01(i, 4) * 3);
      let y = 0;
      let w = 0.72;
      for (let k = 0; k < floors; k++) {
        const fh = 0.26 * jitter;
        g.add(this.mesh(this.box(w, fh, w * 0.78), wall, 0, y + fh / 2, 0));
        g.add(this.mesh(this.box(w * 0.92, 0.06, w * 0.72), this.glass(), 0, y + fh * 0.62, 0));
        y += fh;
        w *= 0.88;
      }
      g.add(this.mesh(this.box(w + 0.06, 0.05, w * 0.78 + 0.06), roof, 0, y + 0.03, 0));
      g.add(this.mesh(this.cyl(0.015, 0.22, 6), this.metal(), 0, y + 0.16, 0));
    } else { // spire - the crown group, most valuable on the board
      const floors = 5;
      let y = 0;
      let w = 0.66;
      for (let k = 0; k < floors; k++) {
        const fh = 0.24 * jitter;
        g.add(this.mesh(this.box(w, fh, w * 0.8), wall, 0, y + fh / 2, 0));
        g.add(this.mesh(this.box(w * 0.9, 0.05, w * 0.74), this.glass(), 0, y + fh * 0.6, 0));
        y += fh;
        w *= 0.84;
      }
      g.add(this.mesh(this.cone(w * 0.62, 0.30, 8), this.gold(), 0, y + 0.15, 0));
      g.add(this.mesh(this.cyl(0.012, 0.20, 6), this.gold(), 0, y + 0.40, 0));
      g.add(this.mesh(this.sph(0.035, 8), this.gold(), 0, y + 0.52, 0));
    }
  }

  // ---- transit -----------------------------------------------------------
  station(g, i) {
    const wall = this.wall(0xd9d2c0);
    g.add(this.mesh(this.box(0.86, 0.34, 0.46), wall, 0, 0.17, -0.02));
    const r = this.mesh(this.cone(0.62, 0.22, 4), this.roofM(0x4a5a6a), 0, 0.45, -0.02);
    r.rotation.y = Math.PI / 4;
    g.add(r);
    // clock face
    g.add(this.mesh(this.cyl(0.09, 0.03, 12), this.gold(), 0, 0.30, 0.24));
    // platform canopy on posts
    g.add(this.mesh(this.box(0.92, 0.04, 0.16), this.metal(), 0, 0.34, 0.30));
    g.add(this.mesh(this.cyl(0.02, 0.32, 6), this.metal(), -0.38, 0.16, 0.32));
    g.add(this.mesh(this.cyl(0.02, 0.32, 6), this.metal(), 0.38, 0.16, 0.32));
    // rails + sleepers running along the tile
    g.add(this.mesh(this.box(0.94, 0.02, 0.03), this.metal(), 0, 0.02, 0.44));
    g.add(this.mesh(this.box(0.94, 0.02, 0.03), this.metal(), 0, 0.02, 0.54));
    for (let k = 0; k < 5; k++) {
      g.add(this.mesh(this.box(0.05, 0.015, 0.16), this.timber(), -0.36 + k * 0.18, 0.012, 0.49));
    }
    void i;
  }

  // ---- utilities ---------------------------------------------------------
  utility(g, i, t) {
    const power = /power/i.test(t.name);
    if (power) {
      g.add(this.mesh(this.box(0.72, 0.34, 0.48), this.wall(0xbfc4c9), 0, 0.17, 0.04));
      // two cooling stacks
      g.add(this.mesh(this.cyl(0.13, 0.46, 10), this.stone(), -0.20, 0.57, -0.16));
      g.add(this.mesh(this.cyl(0.13, 0.38, 10), this.stone(), 0.14, 0.53, -0.20));
      g.add(this.mesh(this.cyl(0.15, 0.04, 10), this.metal(), -0.20, 0.80, -0.16));
      // pylon
      g.add(this.mesh(this.cyl(0.02, 0.50, 6), this.metal(), 0.40, 0.25, 0.14));
      g.add(this.mesh(this.box(0.22, 0.02, 0.02), this.metal(), 0.40, 0.46, 0.14));
      g.add(this.mesh(this.box(0.16, 0.02, 0.02), this.metal(), 0.40, 0.38, 0.14));
    } else {
      g.add(this.mesh(this.box(0.62, 0.26, 0.44), this.wall(0xc7d3d8), -0.10, 0.13, 0.06));
      // water tanks
      g.add(this.mesh(this.cyl(0.17, 0.30, 12), this.m('tank', { color: 0x5b8fa8, roughness: 0.5, metalness: 0.3 }), 0.28, 0.15, -0.10));
      g.add(this.mesh(this.cyl(0.19, 0.04, 12), this.metal(), 0.28, 0.32, -0.10));
      g.add(this.mesh(this.cyl(0.11, 0.22, 10), this.m('tank2', { color: 0x76a7bd, roughness: 0.5, metalness: 0.3 }), -0.30, 0.37, -0.06));
      g.add(this.mesh(this.cyl(0.025, 0.26, 6), this.metal(), -0.30, 0.13, -0.06));
      g.add(this.mesh(this.box(0.5, 0.03, 0.03), this.metal(), -0.02, 0.30, -0.06));
    }
    void i;
  }

  // ---- civic -------------------------------------------------------------
  taxOffice(g) {
    g.add(this.mesh(this.box(0.84, 0.10, 0.56), this.stone(), 0, 0.05, 0));
    g.add(this.mesh(this.box(0.66, 0.40, 0.40), this.wall(0xe2ddcb), 0, 0.30, -0.04));
    for (let k = 0; k < 5; k++) {
      g.add(this.mesh(this.cyl(0.045, 0.40, 10), this.stone(), -0.30 + k * 0.15, 0.30, 0.20));
    }
    g.add(this.mesh(this.box(0.80, 0.06, 0.52), this.stone(), 0, 0.53, 0));
    const ped = this.mesh(this.cone(0.42, 0.16, 4), this.roofM(0x8a8271), 0, 0.61, 0);
    ped.rotation.y = Math.PI / 4;
    g.add(ped);
  }

  kiosk(g, i, t) {
    const fortune = t.deck === 'fortune';
    const c = fortune ? 0x3c6fa8 : 0xa8813c;
    g.add(this.mesh(this.box(0.30, 0.30, 0.30), this.wall(0xe4dfd0), 0, 0.15, 0));
    g.add(this.mesh(this.box(0.36, 0.05, 0.36), this.roofM(c), 0, 0.32, 0));
    // standing sign board
    g.add(this.mesh(this.cyl(0.022, 0.36, 6), this.metal(), 0.32, 0.18, 0.06));
    const sign = this.mesh(this.box(0.30, 0.22, 0.03), this.m(`sign${c}`, { color: c, roughness: 0.45, metalness: 0.1 }), 0.32, 0.44, 0.06);
    sign.rotation.y = -0.35;
    g.add(sign);
    void i;
  }

  launchArch(g) {
    // start corner: a gateway arch over the launch lane
    g.add(this.mesh(this.box(0.14, 0.72, 0.14), this.stone(), -0.46, 0.36, 0));
    g.add(this.mesh(this.box(0.14, 0.72, 0.14), this.stone(), 0.46, 0.36, 0));
    g.add(this.mesh(this.box(1.06, 0.14, 0.18), this.gold(), 0, 0.79, 0));
    g.add(this.mesh(this.box(0.34, 0.16, 0.10), this.m('arrow', { color: 0xd8c07a, roughness: 0.4, metalness: 0.5 }), 0, 0.95, 0));
    g.add(this.mesh(this.box(0.9, 0.02, 0.5), this.m('lane', { color: 0xcfc8ae, roughness: 0.9 }), 0, 0.01, -0.10));
  }

  holdingHouse(g) {
    g.add(this.mesh(this.box(0.86, 0.46, 0.62), this.wall(0xb9b4a6), 0, 0.23, 0));
    g.add(this.mesh(this.box(0.92, 0.06, 0.68), this.roofM(0x6d6a60), 0, 0.49, 0));
    // corner watchtower
    g.add(this.mesh(this.cyl(0.16, 0.36, 8), this.wall(0xb9b4a6), 0.34, 0.64, -0.14));
    const cap = this.mesh(this.cone(0.20, 0.18, 8), this.roofM(0x53504a), 0.34, 0.91, -0.14);
    g.add(cap);
    // window bars
    for (let k = 0; k < 4; k++) {
      g.add(this.mesh(this.box(0.02, 0.18, 0.02), this.metal(), -0.24 + k * 0.06, 0.26, 0.32));
    }
    for (let k = 0; k < 4; k++) {
      g.add(this.mesh(this.box(0.02, 0.18, 0.02), this.metal(), 0.06 + k * 0.06, 0.26, 0.32));
    }
    g.add(this.mesh(this.box(0.9, 0.02, 0.02), this.metal(), 0, 0.26, 0.32));
  }

  commons(g) {
    // free-parking corner: a public park with a bandstand
    g.add(this.mesh(this.cyl(0.42, 0.06, 12), this.m('lawn', { color: 0x3f7a46, roughness: 0.95 }), 0, 0.03, 0));
    for (let k = 0; k < 6; k++) {
      const a = (k / 6) * Math.PI * 2;
      g.add(this.mesh(this.cyl(0.022, 0.28, 6), this.stone(), Math.cos(a) * 0.30, 0.20, Math.sin(a) * 0.30));
    }
    g.add(this.mesh(this.cone(0.40, 0.20, 12), this.roofM(0x7a5230), 0, 0.44, 0));
    g.add(this.mesh(this.sph(0.03, 8), this.gold(), 0, 0.57, 0));
    // flanking trees
    for (const sx of [-0.62, 0.62]) {
      g.add(this.mesh(this.cyl(0.035, 0.22, 6), this.timber(), sx, 0.11, -0.24));
      g.add(this.mesh(this.sph(0.17, 8), this.green(), sx, 0.36, -0.24));
    }
  }

  courthouse(g) {
    g.add(this.mesh(this.box(0.90, 0.12, 0.60), this.stone(), 0, 0.06, 0));
    g.add(this.mesh(this.box(0.70, 0.46, 0.44), this.wall(0xdad4c2), 0, 0.35, -0.04));
    for (let k = 0; k < 6; k++) {
      g.add(this.mesh(this.cyl(0.04, 0.46, 10), this.stone(), -0.32 + k * 0.128, 0.35, 0.22));
    }
    g.add(this.mesh(this.box(0.84, 0.07, 0.56), this.stone(), 0, 0.61, 0));
    const ped = this.mesh(this.cone(0.44, 0.18, 4), this.roofM(0x6b6558), 0, 0.70, 0);
    ped.rotation.y = Math.PI / 4;
    g.add(ped);
    // dome + scales-of-justice mast
    g.add(this.mesh(this.sph(0.15, 10), this.m('dome', { color: 0x8a99a8, roughness: 0.4, metalness: 0.45 }), 0, 0.80, 0));
    g.add(this.mesh(this.cyl(0.012, 0.16, 6), this.gold(), 0, 0.96, 0));
    g.add(this.mesh(this.box(0.18, 0.015, 0.015), this.gold(), 0, 1.03, 0));
  }

  dispose() {
    for (const g of this._geo.values()) g.dispose();
    for (const m of this._mat.values()) m.dispose();
    this._geo.clear();
    this._mat.clear();
  }
}
