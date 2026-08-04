// S6d: detailed 3D architecture for every one of the 40 board tiles.
//
// S6c gave each tile a correct silhouette, but every surface was a flat
// single-colour box: no openings, no trim, no ground, no weathering. That
// fails the visual bar. S6d keeps the silhouettes and adds the detail layer:
//   - textured facades with real window grids, mullions, sills and grime
//   - emissive lit windows (no new lights - the fixed pool rule is absolute)
//   - roof texture (tile / gravel) instead of flat colour
//   - a paved apron under each building so it sits on ground, not on print
//   - cornices, string courses, balconies, awnings, doors, stairs, railings,
//     chimneys, roof plant, signage and street furniture per style
//
// Doctrine constraints (all still enforced by tools/s6c-geom.mjs):
//  - ZERO per-frame allocation: built once at board construction.
//  - SHARED geometry/material/texture cache across all 40 tiles.
//  - DETERMINISTIC variation from an integer hash, never Math.random.
//  - NO NEW LIGHTS: window glow is emissive material, which costs no slot.
//  - Footprint must stay inside the tile; landmark mass must sit on the
//    OUTER half so tokens and houses keep the centre and inner edge.

import * as THREE from 'three';
import { h01, facadeTexture, facadeEmissiveTexture, roofTexture, apronTexture } from './detail.js';

// per-group architectural character. tier drives height; palette drives walls.
const GROUP_STYLE = {
  harbor:  { kind: 'warehouse', tier: 0.55, wall: 0x8a7355, roof: 0x5b4a35, cols: 4, rows: 2, lit: 0.35 },
  grove:   { kind: 'house',     tier: 0.60, wall: 0xdfe9ee, roof: 0x6f8fa0, cols: 3, rows: 2, lit: 0.55 },
  midtown: { kind: 'block',     tier: 0.85, wall: 0xd8c3cf, roof: 0x8e5f77, cols: 5, rows: 3, lit: 0.45 },
  foundry: { kind: 'factory',   tier: 0.80, wall: 0xc8a077, roof: 0x7a5230, cols: 6, rows: 2, lit: 0.30 },
  arts:    { kind: 'theatre',   tier: 0.95, wall: 0xe0c2c2, roof: 0x8f3535, cols: 4, rows: 3, lit: 0.60 },
  uptown:  { kind: 'tower',     tier: 1.15, wall: 0xe6dcb4, roof: 0x9a8b3a, cols: 5, rows: 4, lit: 0.50 },
  summit:  { kind: 'tower',     tier: 1.35, wall: 0xcfe3d4, roof: 0x2f7d4a, cols: 5, rows: 4, lit: 0.55 },
  crown:   { kind: 'spire',     tier: 1.60, wall: 0xcfd6ea, roof: 0x24407f, cols: 6, rows: 5, lit: 0.65 },
};

export class LandmarkFactory {
  constructor() {
    this._geo = new Map();
    this._mat = new Map();
    this._tex = new Map();
  }

  // ---- shared caches -----------------------------------------------------
  g(key, make) {
    let v = this._geo.get(key);
    if (!v) { v = make(); this._geo.set(key, v); }
    return v;
  }

  m(key, params) {
    let v = this._mat.get(key);
    if (!v) { v = new THREE.MeshStandardMaterial(params); this._mat.set(key, v); }
    return v;
  }

  t(key, make) {
    let v = this._tex.get(key);
    if (!v) { v = make(); this._tex.set(key, v); }
    return v;
  }

  box(w, hh, d) { return this.g('b' + w + '_' + hh + '_' + d, () => new THREE.BoxGeometry(w, hh, d)); }
  cyl(r, hh, s = 10) { return this.g('c' + r + '_' + hh + '_' + s, () => new THREE.CylinderGeometry(r, r, hh, s)); }
  cylT(rt, rb, hh, s = 10) { return this.g('ct' + rt + '_' + rb + '_' + hh + '_' + s, () => new THREE.CylinderGeometry(rt, rb, hh, s)); }
  cone(r, hh, s = 8) { return this.g('n' + r + '_' + hh + '_' + s, () => new THREE.ConeGeometry(r, hh, s)); }
  sph(r, s = 10) { return this.g('s' + r + '_' + s, () => new THREE.SphereGeometry(r, s, s)); }
  torus(r, tb, s = 12) { return this.g('to' + r + '_' + tb + '_' + s, () => new THREE.TorusGeometry(r, tb, 6, s)); }

  // Flat/solid materials (trim, structure, props)
  wall(hex) { return this.m('w' + hex, { color: hex, roughness: 0.82, metalness: 0.02 }); }
  roofM(hex) { return this.m('r' + hex, { color: hex, roughness: 0.68, metalness: 0.04 }); }
  glass() { return this.m('glass', { color: 0x2c4a63, roughness: 0.18, metalness: 0.62 }); }
  metal() { return this.m('metal', { color: 0x9099a2, roughness: 0.42, metalness: 0.75 }); }
  darkMetal() { return this.m('dmetal', { color: 0x4a5058, roughness: 0.55, metalness: 0.7 }); }
  stone() { return this.m('stone', { color: 0xd6d0bd, roughness: 0.9, metalness: 0.0 }); }
  trimM() { return this.m('trim', { color: 0xf2ece0, roughness: 0.7, metalness: 0.0 }); }
  gold() { return this.m('gold', { color: 0xd8c07a, roughness: 0.35, metalness: 0.7 }); }
  timber() { return this.m('timber', { color: 0x6b4f2a, roughness: 0.88, metalness: 0.0 }); }
  green() { return this.m('foliage', { color: 0x38713f, roughness: 0.95, metalness: 0.0 }); }
  green2() { return this.m('foliage2', { color: 0x2c5f36, roughness: 0.95, metalness: 0.0 }); }
  doorM() { return this.m('door', { color: 0x53341c, roughness: 0.6, metalness: 0.05 }); }
  brightM(hex) { return this.m('br' + hex, { color: hex, roughness: 0.45, metalness: 0.1, emissive: hex, emissiveIntensity: 0.35 }); }

  // Textured facade material: window grid + emissive lit panes. Keyed on the
  // style so all buildings in a colour group share ONE texture pair.
  facade(styleKey, st, seed) {
    const key = 'f' + styleKey;
    return this.m(key, {
      map: this.t('ft' + styleKey, () => facadeTexture({
        cols: st.cols, rows: st.rows, wall: st.wall, litFrac: st.lit, seed, trim: 0x2a2a2a,
      })),
      emissiveMap: this.t('fe' + styleKey, () => facadeEmissiveTexture({
        cols: st.cols, rows: st.rows, litFrac: st.lit, seed,
      })),
      emissive: 0xffffff,
      emissiveIntensity: 0.55,
      roughness: 0.78,
      metalness: 0.03,
    });
  }

  roofTex(styleKey, hex, kind, seed) {
    const key = 'rt' + styleKey + kind;
    return this.m(key, {
      map: this.t(key, () => roofTexture(hex, seed, kind)),
      roughness: 0.72,
      metalness: 0.05,
    });
  }

  apron(tone, seed, key) {
    return this.m('ap' + key, {
      map: this.t('apt' + key, () => apronTexture(seed, tone)),
      roughness: 0.94,
      metalness: 0.0,
    });
  }

  mesh(geo, mat, x, y, z) {
    const o = new THREE.Mesh(geo, mat);
    o.position.set(x, y, z);
    o.castShadow = true;
    o.receiveShadow = true;
    return o;
  }

  // ---- reusable detail parts --------------------------------------------
  // Each returns nothing; it appends to the supplied group. Keeping them here
  // means a single fix improves every building that uses the part.

  // Paved ground apron so the building sits on a surface, not on printed card.
  addApron(g, w, d, tone, seed, key) {
    const a = this.mesh(this.box(w, 0.02, d), this.apron(tone, seed, key), 0, 0.01, 0);
    a.castShadow = false;
    g.add(a);
  }

  // Horizontal band (cornice / string course / plinth). Slightly proud of the
  // wall so it catches the key light and casts a real shadow line.
  addBand(g, w, d, y, hh, mat) {
    g.add(this.mesh(this.box(w, hh, d), mat, 0, y, 0));
  }

  // Ground-floor entrance: recessed door, frame, step and a small canopy.
  addEntrance(g, z, w, seed) {
    const dw = Math.min(0.16, w * 0.22);
    g.add(this.mesh(this.box(dw + 0.05, 0.20, 0.02), this.trimM(), 0, 0.10, z + 0.005));
    g.add(this.mesh(this.box(dw, 0.17, 0.03), this.doorM(), 0, 0.085, z + 0.012));
    // handle
    g.add(this.mesh(this.box(0.015, 0.015, 0.012), this.gold(), dw * 0.28, 0.09, z + 0.026));
    // step
    const st = this.mesh(this.box(dw + 0.14, 0.02, 0.07), this.stone(), 0, 0.01, z + 0.04);
    st.castShadow = false;
    g.add(st);
    // canopy
    const cw = dw + 0.12;
    g.add(this.mesh(this.box(cw, 0.02, 0.09), this.darkMetal(), 0, 0.235, z + 0.045));
    void seed;
  }

  // Awning over a shopfront - a tilted slab in an accent colour.
  addAwning(g, x, y, z, w, hex) {
    const a = this.mesh(this.box(w, 0.015, 0.10), this.m('aw' + hex, { color: hex, roughness: 0.6, metalness: 0.05 }), x, y, z);
    a.rotation.x = -0.42;
    g.add(a);
  }

  // Balcony: a slab plus a thin railing rail on two posts.
  addBalcony(g, x, y, z, w) {
    g.add(this.mesh(this.box(w, 0.015, 0.07), this.stone(), x, y, z));
    g.add(this.mesh(this.box(w, 0.012, 0.012), this.darkMetal(), x, y + 0.055, z + 0.03));
    g.add(this.mesh(this.box(0.012, 0.055, 0.012), this.darkMetal(), x - w / 2 + 0.01, y + 0.028, z + 0.03));
    g.add(this.mesh(this.box(0.012, 0.055, 0.012), this.darkMetal(), x + w / 2 - 0.01, y + 0.028, z + 0.03));
  }

  // Rooftop plant: HVAC boxes, a vent stack and a parapet. Gives the roof a
  // silhouette instead of a clean rectangle when seen from the 3/4 camera.
  addRoofPlant(g, w, d, y, seed) {
    // parapet ring (four thin walls)
    const t = 0.025;
    g.add(this.mesh(this.box(w, 0.05, t), this.stone(), 0, y + 0.025, d / 2 - t / 2));
    g.add(this.mesh(this.box(w, 0.05, t), this.stone(), 0, y + 0.025, -d / 2 + t / 2));
    g.add(this.mesh(this.box(t, 0.05, d), this.stone(), w / 2 - t / 2, y + 0.025, 0));
    g.add(this.mesh(this.box(t, 0.05, d), this.stone(), -w / 2 + t / 2, y + 0.025, 0));
    // plant
    const n = 1 + Math.floor(h01(seed, 71) * 3);
    for (let k = 0; k < n; k++) {
      const bw = 0.09 + h01(seed, 80 + k) * 0.07;
      const bh = 0.05 + h01(seed, 90 + k) * 0.05;
      const px = (h01(seed, 100 + k) - 0.5) * (w - bw - 0.08);
      const pz = (h01(seed, 110 + k) - 0.5) * (d - bw - 0.08);
      g.add(this.mesh(this.box(bw, bh, bw * 0.8), this.darkMetal(), px, y + bh / 2, pz));
      g.add(this.mesh(this.box(bw * 0.7, 0.008, bw * 0.55), this.metal(), px, y + bh + 0.005, pz));
    }
    // vent stack
    g.add(this.mesh(this.cyl(0.018, 0.10, 6), this.metal(), w * 0.30, y + 0.05, -d * 0.28));
    g.add(this.mesh(this.cyl(0.026, 0.015, 6), this.darkMetal(), w * 0.30, y + 0.105, -d * 0.28));
  }

  // Chimney with a cap - for pitched-roof residential and industrial.
  addChimney(g, x, y, z, hh) {
    g.add(this.mesh(this.box(0.07, hh, 0.07), this.m('brick', { color: 0x8c5b45, roughness: 0.9 }), x, y + hh / 2, z));
    g.add(this.mesh(this.box(0.09, 0.02, 0.09), this.stone(), x, y + hh + 0.01, z));
  }

  // A small illuminated sign board on a post.
  addSign(g, x, y, z, hex, w = 0.24, hh = 0.16) {
    g.add(this.mesh(this.cyl(0.016, y * 2 * 0.55, 6), this.darkMetal(), x, y * 0.55, z));
    const s = this.mesh(this.box(w, hh, 0.02), this.brightM(hex), x, y + hh * 0.5, z);
    s.rotation.y = -0.30;
    g.add(s);
  }

  // Street furniture: lamp post (unlit geometry + emissive head), bollards.
  addLamp(g, x, z, hh = 0.38) {
    g.add(this.mesh(this.cyl(0.014, hh, 6), this.darkMetal(), x, hh / 2, z));
    g.add(this.mesh(this.box(0.10, 0.02, 0.05), this.darkMetal(), x + 0.03, hh, z));
    g.add(this.mesh(this.box(0.06, 0.025, 0.04), this.brightM(0xffe6ad), x + 0.06, hh - 0.012, z));
  }

  addTree(g, x, z, scale = 1) {
    g.add(this.mesh(this.cyl(0.028 * scale, 0.20 * scale, 6), this.timber(), x, 0.10 * scale, z));
    g.add(this.mesh(this.sph(0.13 * scale, 8), this.green(), x, 0.29 * scale, z));
    g.add(this.mesh(this.sph(0.09 * scale, 8), this.green2(), x + 0.05 * scale, 0.35 * scale, z - 0.03 * scale));
  }

  addHedge(g, x, z, w) {
    g.add(this.mesh(this.box(w, 0.07, 0.07), this.green2(), x, 0.035, z));
  }

  // ---- the public entry point -------------------------------------------
  // Returns a Group in TILE-LOCAL space: -z is toward the board centre,
  // +z is outward, y=0 is the tile top surface.
  build(i, t) {
    // The outward parking offset lives on an INNER group, because the caller
    // does lm.position.copy(tilePos), which would overwrite it on the outer.
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
    g.position.z = 0.40;
    return outer;
  }

  // ---- streets -----------------------------------------------------------
  property(g, i, t) {
    const st = GROUP_STYLE[t.group] || GROUP_STYLE.harbor;
    const key = t.group || 'harbor';
    const jitter = 0.85 + h01(i, 1) * 0.3;
    const face = this.facade(key, st, 17);
    const roofFlat = this.roofTex(key, st.roof, 'flat', 23);
    const roofTile = this.roofTex(key, st.roof, 'tile', 29);
    const roofSolid = this.roofM(st.roof);

    // every property gets a ground apron; tone varies by group for variety
    this.addApron(g, 1.10, 0.95, key === 'grove' ? '#9fae92' : '#b3ad9c', i, key);

    if (st.kind === 'warehouse') {
      const hh = 0.42;
      g.add(this.mesh(this.box(0.90, hh, 0.62), face, 0, hh / 2 + 0.02, 0));
      this.addBand(g, 0.94, 0.66, hh + 0.045, 0.04, this.trimM());   // eaves band
      const r = this.mesh(this.cone(0.62, 0.26, 4), roofTile, 0, hh + 0.20, 0);
      r.rotation.y = Math.PI / 4;
      g.add(r);
      // loading bay doors on the outward face
      for (const dx of [-0.24, 0.24]) {
        g.add(this.mesh(this.box(0.17, 0.24, 0.03), this.darkMetal(), dx, 0.14, 0.315));
        g.add(this.mesh(this.box(0.19, 0.02, 0.06), this.metal(), dx, 0.27, 0.335));
      }
      this.addEntrance(g, 0.31, 0.4, i);
      // dockside crane: mast, jib, counterweight, hook line
      g.add(this.mesh(this.cyl(0.03, 0.5, 6), this.metal(), 0.42, 0.27, -0.22));
      g.add(this.mesh(this.box(0.32, 0.035, 0.035), this.metal(), 0.30, 0.52, -0.22));
      g.add(this.mesh(this.box(0.07, 0.06, 0.06), this.darkMetal(), 0.51, 0.52, -0.22));
      g.add(this.mesh(this.cyl(0.006, 0.16, 4), this.darkMetal(), 0.18, 0.43, -0.22));
      g.add(this.mesh(this.box(0.05, 0.04, 0.05), this.darkMetal(), 0.18, 0.34, -0.22));
      // stacked cargo crates
      g.add(this.mesh(this.box(0.13, 0.11, 0.13), this.m('crate1', { color: 0xa8622f, roughness: 0.9 }), -0.40, 0.075, 0.34));
      g.add(this.mesh(this.box(0.11, 0.10, 0.11), this.m('crate2', { color: 0x7c8a3d, roughness: 0.9 }), -0.40, 0.18, 0.34));
      this.addLamp(g, 0.46, 0.36, 0.34);
    } else if (st.kind === 'house') {
      const hh = 0.34 * jitter;
      g.add(this.mesh(this.box(0.52, hh, 0.44), face, -0.16, hh / 2 + 0.02, 0));
      this.addBand(g, 0.56, 0.48, hh + 0.04, 0.035, this.trimM());
      const r1 = this.mesh(this.cone(0.42, 0.24, 4), roofTile, -0.16, hh + 0.16, 0);
      r1.rotation.y = Math.PI / 4;
      g.add(r1);
      // the roof cone is centred on the house, so offset the chimney with it
      this.addChimney(g, -0.02, hh + 0.10, -0.10, 0.14);
      // porch: two posts and a small roof over the door
      g.add(this.mesh(this.box(0.30, 0.02, 0.10), this.trimM(), -0.16, 0.24, 0.245));
      g.add(this.mesh(this.cyl(0.014, 0.24, 6), this.trimM(), -0.29, 0.12, 0.245));
      g.add(this.mesh(this.cyl(0.014, 0.24, 6), this.trimM(), -0.03, 0.12, 0.245));
      // door sits on the house face, so shift the entrance with the house
      const dg = new THREE.Group();
      dg.position.x = -0.16;
      this.addEntrance(dg, 0.22, 0.4, i);
      g.add(dg);
      // detached garage
      g.add(this.mesh(this.box(0.28, 0.22, 0.30), this.wall(st.wall), 0.34, 0.13, 0.02));
      const r2 = this.mesh(this.cone(0.26, 0.14, 4), roofTile, 0.34, 0.31, 0.02);
      r2.rotation.y = Math.PI / 4;
      g.add(r2);
      g.add(this.mesh(this.box(0.20, 0.15, 0.02), this.darkMetal(), 0.34, 0.10, 0.175));
      // garden: tree, hedge, path
      this.addTree(g, 0.32, -0.30, 0.9);
      this.addHedge(g, -0.16, 0.40, 0.46);
      const path = this.mesh(this.box(0.10, 0.012, 0.22), this.stone(), -0.16, 0.026, 0.34);
      path.castShadow = false;
      g.add(path);
    } else if (st.kind === 'block') {
      const hh = 0.62 * jitter;
      g.add(this.mesh(this.box(0.80, hh, 0.56), face, 0, hh / 2 + 0.02, 0));
      // plinth + cornice make the massing read as a designed building
      this.addBand(g, 0.86, 0.62, 0.05, 0.06, this.stone());
      this.addBand(g, 0.86, 0.62, hh + 0.04, 0.05, this.trimM());
      // shopfront glazing band and awnings at street level
      g.add(this.mesh(this.box(0.66, 0.12, 0.02), this.glass(), 0, 0.16, 0.285));
      this.addAwning(g, -0.18, 0.245, 0.315, 0.26, 0x9a3f4f);
      this.addAwning(g, 0.18, 0.245, 0.315, 0.26, 0x9a3f4f);
      this.addEntrance(g, 0.285, 0.4, i);
      // balconies on the upper storeys
      this.addBalcony(g, -0.20, hh * 0.60, 0.30, 0.22);
      this.addBalcony(g, 0.20, hh * 0.60, 0.30, 0.22);
      g.add(this.mesh(this.box(0.84, 0.04, 0.60), roofFlat, 0, hh + 0.085, 0));
      this.addRoofPlant(g, 0.76, 0.52, hh + 0.105, i);
      this.addLamp(g, -0.46, 0.34, 0.34);
    } else if (st.kind === 'factory') {
      const hh = 0.44;
      g.add(this.mesh(this.box(0.86, hh, 0.58), face, 0, hh / 2 + 0.02, 0));
      this.addBand(g, 0.90, 0.62, 0.045, 0.05, this.stone());
      // sawtooth roof with glazed north lights
      for (let k = 0; k < 3; k++) {
        const s = this.mesh(this.box(0.26, 0.16, 0.58), roofSolid, -0.28 + k * 0.28, 0.53, 0);
        s.rotation.x = 0.35;
        g.add(s);
        const gl = this.mesh(this.box(0.24, 0.10, 0.02), this.glass(), -0.28 + k * 0.28, 0.55, 0.075);
        gl.rotation.x = 0.35;
        g.add(gl);
      }
      const ch = 0.55 + h01(i, 3) * 0.25;
      g.add(this.mesh(this.cylT(0.062, 0.085, ch, 8), this.m('brick', { color: 0x8c5b45, roughness: 0.9 }), 0.36, 0.46 + ch / 2, -0.18));
      g.add(this.mesh(this.cyl(0.075, 0.04, 8), this.darkMetal(), 0.36, 0.46 + ch, -0.18));
      // banding on the stack
      g.add(this.mesh(this.cyl(0.07, 0.02, 8), this.stone(), 0.36, 0.46 + ch * 0.62, -0.18));
      // industrial roller door + pipework
      g.add(this.mesh(this.box(0.26, 0.28, 0.03), this.darkMetal(), -0.22, 0.16, 0.295));
      g.add(this.mesh(this.box(0.28, 0.025, 0.05), this.metal(), -0.22, 0.31, 0.305));
      g.add(this.mesh(this.cyl(0.022, 0.34, 6), this.metal(), 0.22, 0.19, 0.29));
      g.add(this.mesh(this.box(0.16, 0.03, 0.03), this.metal(), 0.30, 0.36, 0.29));
      this.addSign(g, -0.40, 0.30, 0.30, 0xd8853a, 0.20, 0.12);
    } else if (st.kind === 'theatre') {
      const hh = 0.60 * jitter;
      g.add(this.mesh(this.box(0.82, hh, 0.54), face, 0, hh / 2 + 0.02, 0));
      this.addBand(g, 0.88, 0.60, 0.055, 0.07, this.stone());
      this.addBand(g, 0.88, 0.60, hh + 0.04, 0.055, this.trimM());
      // lit marquee canopy over the entrance
      g.add(this.mesh(this.box(0.70, 0.05, 0.20), this.gold(), 0, 0.30, 0.34));
      g.add(this.mesh(this.box(0.66, 0.03, 0.03), this.brightM(0xffe0a0), 0, 0.272, 0.425));
      g.add(this.mesh(this.box(0.40, 0.10, 0.02), this.brightM(0xffd98a), 0, 0.40, 0.30));
      // colonnade
      for (let k = 0; k < 4; k++) {
        g.add(this.mesh(this.cyl(0.035, 0.34, 8), this.stone(), -0.27 + k * 0.18, 0.19, 0.26));
        g.add(this.mesh(this.box(0.09, 0.02, 0.09), this.trimM(), -0.27 + k * 0.18, 0.365, 0.26));
      }
      this.addEntrance(g, 0.275, 0.4, i);
      // fly tower with its own roof
      g.add(this.mesh(this.box(0.34, 0.30, 0.34), this.wall(st.wall), -0.10, hh + 0.17, -0.06));
      g.add(this.mesh(this.box(0.38, 0.03, 0.38), roofFlat, -0.10, hh + 0.335, -0.06));
      g.add(this.mesh(this.box(0.86, 0.04, 0.58), roofFlat, 0, hh + 0.085, 0));
      this.addSign(g, 0.44, 0.34, 0.28, 0xc2405a, 0.18, 0.20);
    } else if (st.kind === 'tower') {
      const floors = 3 + Math.floor(h01(i, 4) * 3);
      let y = 0.02;
      let w = 0.72;
      this.addBand(g, 0.80, 0.66, 0.05, 0.06, this.stone());
      for (let k = 0; k < floors; k++) {
        const fh = 0.26 * jitter;
        g.add(this.mesh(this.box(w, fh, w * 0.78), face, 0, y + fh / 2, 0));
        // setback cornice between storeys
        g.add(this.mesh(this.box(w + 0.04, 0.022, w * 0.78 + 0.04), this.trimM(), 0, y + fh, 0));
        if (k === 0) this.addEntrance(g, w * 0.39 + 0.01, w, i);
        if (k === 1) this.addBalcony(g, 0, y + fh * 0.5, w * 0.42, w * 0.5);
        y += fh;
        w *= 0.88;
      }
      g.add(this.mesh(this.box(w + 0.06, 0.04, w * 0.78 + 0.06), roofFlat, 0, y + 0.02, 0));
      this.addRoofPlant(g, w, w * 0.72, y + 0.04, i);
      g.add(this.mesh(this.cyl(0.014, 0.22, 6), this.metal(), 0, y + 0.16, 0));
      g.add(this.mesh(this.sph(0.022, 6), this.brightM(0xff5a4a), 0, y + 0.28, 0));
      this.addLamp(g, 0.46, 0.36, 0.32);
    } else { // spire - the crown group, most valuable on the board
      const floors = 5;
      let y = 0.02;
      let w = 0.66;
      this.addBand(g, 0.76, 0.62, 0.05, 0.06, this.stone());
      for (let k = 0; k < floors; k++) {
        const fh = 0.24 * jitter;
        g.add(this.mesh(this.box(w, fh, w * 0.8), face, 0, y + fh / 2, 0));
        g.add(this.mesh(this.box(w + 0.035, 0.02, w * 0.8 + 0.035), this.gold(), 0, y + fh, 0));
        if (k === 0) this.addEntrance(g, w * 0.40 + 0.01, w, i);
        y += fh;
        w *= 0.84;
      }
      g.add(this.mesh(this.cone(w * 0.62, 0.30, 8), this.gold(), 0, y + 0.15, 0));
      g.add(this.mesh(this.cyl(0.012, 0.20, 6), this.gold(), 0, y + 0.40, 0));
      g.add(this.mesh(this.sph(0.035, 8), this.brightM(0xffe9a8), 0, y + 0.52, 0));
      this.addLamp(g, -0.44, 0.34, 0.30);
    }
  }

  // ---- transit -----------------------------------------------------------
  station(g, i) {
    const st = { cols: 4, rows: 2, wall: 0xd9d2c0, lit: 0.5 };
    const face = this.facade('station', st, 41);
    const roofT = this.roofTex('station', 0x4a5a6a, 'tile', 43);
    this.addApron(g, 1.10, 0.95, '#a9a396', i, 'station');
    g.add(this.mesh(this.box(0.86, 0.34, 0.46), face, 0, 0.19, -0.02));
    this.addBand(g, 0.90, 0.50, 0.045, 0.05, this.stone());
    this.addBand(g, 0.90, 0.50, 0.365, 0.04, this.trimM());
    const r = this.mesh(this.cone(0.62, 0.22, 4), roofT, 0, 0.48, -0.02);
    r.rotation.y = Math.PI / 4;
    g.add(r);
    // clock face with hands
    g.add(this.mesh(this.cyl(0.09, 0.03, 12), this.trimM(), 0, 0.30, 0.225));
    g.add(this.mesh(this.cyl(0.07, 0.034, 12), this.gold(), 0, 0.30, 0.228));
    g.add(this.mesh(this.box(0.045, 0.008, 0.006), this.darkMetal(), 0.014, 0.30, 0.246));
    g.add(this.mesh(this.box(0.008, 0.055, 0.006), this.darkMetal(), 0, 0.318, 0.246));
    this.addEntrance(g, 0.215, 0.4, i);
    // platform canopy on posts, with a valance edge
    g.add(this.mesh(this.box(0.92, 0.035, 0.18), this.darkMetal(), 0, 0.35, 0.30));
    g.add(this.mesh(this.box(0.92, 0.03, 0.012), this.metal(), 0, 0.332, 0.386));
    for (const px of [-0.38, 0, 0.38]) {
      g.add(this.mesh(this.cyl(0.02, 0.33, 6), this.metal(), px, 0.165, 0.32));
    }
    // benches under the canopy
    g.add(this.mesh(this.box(0.16, 0.02, 0.06), this.timber(), -0.20, 0.075, 0.31));
    g.add(this.mesh(this.box(0.16, 0.02, 0.06), this.timber(), 0.20, 0.075, 0.31));
    // ballast strip, rails and sleepers
    const bal = this.mesh(this.box(0.98, 0.015, 0.22), this.m('ballast', { color: 0x6d6459, roughness: 0.98 }), 0, 0.012, 0.49);
    bal.castShadow = false;
    g.add(bal);
    for (let k = 0; k < 6; k++) {
      g.add(this.mesh(this.box(0.05, 0.018, 0.18), this.timber(), -0.40 + k * 0.16, 0.026, 0.49));
    }
    g.add(this.mesh(this.box(0.96, 0.022, 0.028), this.metal(), 0, 0.042, 0.44));
    g.add(this.mesh(this.box(0.96, 0.022, 0.028), this.metal(), 0, 0.042, 0.54));
    // signal post
    g.add(this.mesh(this.cyl(0.016, 0.30, 6), this.darkMetal(), 0.46, 0.15, 0.40));
    g.add(this.mesh(this.box(0.045, 0.09, 0.03), this.darkMetal(), 0.46, 0.32, 0.40));
    g.add(this.mesh(this.sph(0.018, 6), this.brightM(0x4ad06a), 0.46, 0.345, 0.418));
  }

  // ---- utilities ---------------------------------------------------------
  utility(g, i, t) {
    const power = /power/i.test(t.name);
    this.addApron(g, 1.10, 0.95, '#a5a5a0', i, power ? 'power' : 'water');
    if (power) {
      const face = this.facade('power', { cols: 5, rows: 2, wall: 0xbfc4c9, lit: 0.3 }, 53);
      g.add(this.mesh(this.box(0.72, 0.34, 0.48), face, 0, 0.19, 0.04));
      this.addBand(g, 0.76, 0.52, 0.045, 0.05, this.stone());
      g.add(this.mesh(this.box(0.76, 0.03, 0.52), this.roofTex('power', 0x6b7076, 'flat', 55), 0, 0.375, 0.04));
      // two cooling stacks with a waisted profile and rim
      g.add(this.mesh(this.cylT(0.15, 0.11, 0.46, 12), this.m('conc', { color: 0xc3bfb4, roughness: 0.92 }), -0.20, 0.59, -0.16));
      g.add(this.mesh(this.cylT(0.14, 0.10, 0.38, 12), this.m('conc', { color: 0xc3bfb4, roughness: 0.92 }), 0.14, 0.55, -0.20));
      g.add(this.mesh(this.cyl(0.16, 0.03, 12), this.darkMetal(), -0.20, 0.825, -0.16));
      g.add(this.mesh(this.cyl(0.15, 0.03, 12), this.darkMetal(), 0.14, 0.755, -0.20));
      // lattice pylon with cross-arms and insulators
      g.add(this.mesh(this.cylT(0.012, 0.028, 0.52, 6), this.metal(), 0.40, 0.28, 0.14));
      g.add(this.mesh(this.box(0.24, 0.018, 0.018), this.metal(), 0.40, 0.48, 0.14));
      g.add(this.mesh(this.box(0.18, 0.018, 0.018), this.metal(), 0.40, 0.40, 0.14));
      for (const dx of [-0.10, 0.10]) {
        g.add(this.mesh(this.cyl(0.012, 0.03, 6), this.m('insul', { color: 0x8c8f95, roughness: 0.5 }), 0.40 + dx, 0.462, 0.14));
      }
      // transformer bank + warning sign
      g.add(this.mesh(this.box(0.14, 0.12, 0.12), this.darkMetal(), -0.42, 0.08, 0.30));
      g.add(this.mesh(this.cyl(0.014, 0.06, 6), this.metal(), -0.42, 0.17, 0.30));
      this.addSign(g, 0.30, 0.20, 0.34, 0xd8b53a, 0.14, 0.10);
    } else {
      const face = this.facade('water', { cols: 4, rows: 2, wall: 0xc7d3d8, lit: 0.3 }, 59);
      g.add(this.mesh(this.box(0.62, 0.26, 0.44), face, -0.10, 0.15, 0.06));
      this.addBand(g, 0.66, 0.48, 0.045, 0.045, this.stone());
      g.add(this.mesh(this.box(0.66, 0.03, 0.48), this.roofTex('water', 0x6f7d84, 'flat', 61), -0.10, 0.295, 0.06));
      // main tank with banding, ladder and roof
      const tank = this.m('tank', { color: 0x5b8fa8, roughness: 0.48, metalness: 0.32 });
      g.add(this.mesh(this.cyl(0.17, 0.30, 12), tank, 0.28, 0.17, -0.10));
      g.add(this.mesh(this.cyl(0.175, 0.02, 12), this.metal(), 0.28, 0.235, -0.10));
      g.add(this.mesh(this.cyl(0.175, 0.02, 12), this.metal(), 0.28, 0.105, -0.10));
      g.add(this.mesh(this.cone(0.19, 0.07, 12), this.darkMetal(), 0.28, 0.355, -0.10));
      for (let k = 0; k < 5; k++) {
        g.add(this.mesh(this.box(0.05, 0.006, 0.006), this.metal(), 0.28, 0.06 + k * 0.06, 0.075));
      }
      // elevated tank on legs
      g.add(this.mesh(this.cyl(0.11, 0.22, 10), this.m('tank2', { color: 0x76a7bd, roughness: 0.5, metalness: 0.3 }), -0.30, 0.39, -0.06));
      g.add(this.mesh(this.cone(0.125, 0.06, 10), this.darkMetal(), -0.30, 0.53, -0.06));
      for (const a of [0, 1, 2, 3]) {
        const ang = (a / 4) * Math.PI * 2 + 0.78;
        g.add(this.mesh(this.cyl(0.012, 0.28, 6), this.metal(),
          -0.30 + Math.cos(ang) * 0.075, 0.14, -0.06 + Math.sin(ang) * 0.075));
      }
      // pipework linking tanks, with valve wheels
      g.add(this.mesh(this.box(0.5, 0.028, 0.028), this.metal(), -0.02, 0.30, -0.06));
      g.add(this.mesh(this.torus(0.032, 0.008, 10), this.m('valve', { color: 0xb04a3a, roughness: 0.6 }), -0.02, 0.34, -0.06));
      g.add(this.mesh(this.cyl(0.02, 0.10, 6), this.metal(), 0.10, 0.25, -0.06));
      this.addSign(g, -0.40, 0.18, 0.32, 0x3f86a8, 0.14, 0.10);
    }
  }

  // ---- civic -------------------------------------------------------------
  taxOffice(g) {
    const face = this.facade('civic', { cols: 4, rows: 2, wall: 0xe2ddcb, lit: 0.4 }, 67);
    this.addApron(g, 1.10, 0.95, '#aca695', 7, 'civic');
    // stepped podium
    g.add(this.mesh(this.box(0.86, 0.05, 0.58), this.stone(), 0, 0.045, 0));
    g.add(this.mesh(this.box(0.78, 0.05, 0.50), this.stone(), 0, 0.09, -0.02));
    g.add(this.mesh(this.box(0.66, 0.40, 0.40), face, 0, 0.315, -0.04));
    // portico columns with bases and capitals
    for (let k = 0; k < 5; k++) {
      const px = -0.30 + k * 0.15;
      g.add(this.mesh(this.cyl(0.045, 0.40, 10), this.stone(), px, 0.315, 0.20));
      g.add(this.mesh(this.box(0.11, 0.022, 0.11), this.trimM(), px, 0.128, 0.20));
      g.add(this.mesh(this.box(0.11, 0.022, 0.11), this.trimM(), px, 0.526, 0.20));
    }
    g.add(this.mesh(this.box(0.80, 0.05, 0.52), this.trimM(), 0, 0.555, 0));
    const ped = this.mesh(this.cone(0.42, 0.16, 4), this.roofTex('civic', 0x8a8271, 'tile', 71), 0, 0.635, 0);
    ped.rotation.y = Math.PI / 4;
    g.add(ped);
    this.addEntrance(g, 0.165, 0.4, 7);
    this.addLamp(g, -0.44, 0.34, 0.30);
    this.addLamp(g, 0.44, 0.34, 0.30);
  }

  kiosk(g, i, t) {
    const fortune = t.deck === 'fortune';
    const c = fortune ? 0x3c6fa8 : 0xa8813c;
    this.addApron(g, 1.10, 0.95, '#b0aa9a', i, 'kiosk');
    // kiosk body with glazing on three sides and a counter
    g.add(this.mesh(this.box(0.30, 0.30, 0.30), this.wall(0xe4dfd0), 0, 0.17, 0));
    g.add(this.mesh(this.box(0.24, 0.14, 0.02), this.glass(), 0, 0.22, 0.152));
    g.add(this.mesh(this.box(0.02, 0.14, 0.24), this.glass(), 0.152, 0.22, 0));
    g.add(this.mesh(this.box(0.02, 0.14, 0.24), this.glass(), -0.152, 0.22, 0));
    g.add(this.mesh(this.box(0.34, 0.025, 0.09), this.timber(), 0, 0.135, 0.185));
    // roof with overhang and a finial
    g.add(this.mesh(this.box(0.38, 0.035, 0.38), this.roofM(c), 0, 0.335, 0));
    g.add(this.mesh(this.box(0.40, 0.015, 0.015), this.gold(), 0, 0.318, 0.19));
    g.add(this.mesh(this.cyl(0.012, 0.07, 6), this.gold(), 0, 0.385, 0));
    g.add(this.mesh(this.sph(0.022, 8), this.brightM(fortune ? 0x8fc4ff : 0xffcf8a), 0, 0.43, 0));
    // standing sign board
    this.addSign(g, 0.32, 0.30, 0.06, c, 0.28, 0.20);
    // poster board on the back
    g.add(this.mesh(this.box(0.22, 0.16, 0.02), this.brightM(c), -0.30, 0.24, -0.10));
    this.addTree(g, -0.38, 0.34, 0.7);
  }

  launchArch(g) {
    this.addApron(g, 1.30, 1.20, '#b3ad9c', 0, 'start');
    // gateway piers with plinths and caps
    for (const px of [-0.46, 0.46]) {
      g.add(this.mesh(this.box(0.20, 0.05, 0.20), this.stone(), px, 0.045, 0));
      g.add(this.mesh(this.box(0.14, 0.70, 0.14), this.stone(), px, 0.42, 0));
      g.add(this.mesh(this.box(0.18, 0.03, 0.18), this.trimM(), px, 0.785, 0));
    }
    g.add(this.mesh(this.box(1.06, 0.14, 0.18), this.gold(), 0, 0.87, 0));
    g.add(this.mesh(this.box(1.10, 0.025, 0.20), this.trimM(), 0, 0.955, 0));
    // directional chevron + lit lamps on the beam
    g.add(this.mesh(this.box(0.34, 0.16, 0.10), this.brightM(0xd8c07a), 0, 1.02, 0));
    for (const px of [-0.34, 0, 0.34]) {
      g.add(this.mesh(this.sph(0.022, 6), this.brightM(0xffe6ad), px, 0.775, 0.10));
    }
    // launch lane with painted stripes
    const lane = this.mesh(this.box(0.92, 0.014, 0.52), this.m('lane', { color: 0xcfc8ae, roughness: 0.92 }), 0, 0.022, -0.10);
    lane.castShadow = false;
    g.add(lane);
    for (let k = 0; k < 4; k++) {
      const s = this.mesh(this.box(0.13, 0.006, 0.05), this.trimM(), -0.33 + k * 0.22, 0.032, -0.10);
      s.castShadow = false;
      g.add(s);
    }
  }

  holdingHouse(g) {
    const face = this.facade('jail', { cols: 4, rows: 2, wall: 0xb9b4a6, lit: 0.22 }, 79);
    this.addApron(g, 1.30, 1.20, '#9e988a', 10, 'jail');
    g.add(this.mesh(this.box(0.86, 0.46, 0.62), face, 0, 0.25, 0));
    this.addBand(g, 0.90, 0.66, 0.045, 0.05, this.stone());
    g.add(this.mesh(this.box(0.92, 0.05, 0.68), this.roofTex('jail', 0x6d6a60, 'flat', 83), 0, 0.505, 0));
    this.addRoofPlant(g, 0.80, 0.56, 0.53, 10);
    // corner watchtower with rail and cap
    g.add(this.mesh(this.cyl(0.16, 0.36, 8), this.wall(0xb9b4a6), 0.34, 0.68, -0.14));
    g.add(this.mesh(this.torus(0.17, 0.012, 12), this.darkMetal(), 0.34, 0.845, -0.14));
    g.add(this.mesh(this.cone(0.20, 0.18, 8), this.roofM(0x53504a), 0.34, 0.95, -0.14));
    g.add(this.mesh(this.sph(0.026, 6), this.brightM(0xffd98a), 0.34, 0.80, 0.00));
    // barred windows: recess + bars + lintel
    for (const bx of [-0.21, 0.21]) {
      g.add(this.mesh(this.box(0.26, 0.20, 0.02), this.m('cell', { color: 0x1a1f24, roughness: 0.9 }), bx, 0.28, 0.312));
      for (let k = 0; k < 4; k++) {
        g.add(this.mesh(this.box(0.016, 0.20, 0.016), this.darkMetal(), bx - 0.09 + k * 0.06, 0.28, 0.322));
      }
      g.add(this.mesh(this.box(0.30, 0.022, 0.03), this.stone(), bx, 0.395, 0.318));
      g.add(this.mesh(this.box(0.30, 0.022, 0.04), this.stone(), bx, 0.168, 0.322));
    }
    // barred gate
    g.add(this.mesh(this.box(0.18, 0.24, 0.02), this.m('cell', { color: 0x1a1f24, roughness: 0.9 }), 0, 0.135, 0.312));
    for (let k = 0; k < 4; k++) {
      g.add(this.mesh(this.box(0.014, 0.24, 0.014), this.darkMetal(), -0.06 + k * 0.04, 0.135, 0.322));
    }
    // perimeter fence posts
    for (const px of [-0.46, 0.46]) {
      g.add(this.mesh(this.cyl(0.016, 0.26, 6), this.darkMetal(), px, 0.13, 0.42));
    }
    g.add(this.mesh(this.box(0.94, 0.012, 0.012), this.darkMetal(), 0, 0.24, 0.42));
  }

  commons(g) {
    this.addApron(g, 1.30, 1.20, '#8fa383', 20, 'commons');
    // lawn with a path ring
    const lawn = this.mesh(this.cyl(0.46, 0.03, 16), this.m('lawn', { color: 0x3f7a46, roughness: 0.96 }), 0, 0.03, 0);
    lawn.castShadow = false;
    g.add(lawn);
    const ring = this.mesh(this.torus(0.40, 0.022, 16), this.m('gravel', { color: 0xbdb49c, roughness: 0.95 }), 0, 0.045, 0);
    ring.rotation.x = Math.PI / 2;
    ring.castShadow = false;
    g.add(ring);
    // bandstand: stepped base, columns with capitals, roof, finial
    g.add(this.mesh(this.cyl(0.34, 0.04, 12), this.stone(), 0, 0.06, 0));
    g.add(this.mesh(this.cyl(0.30, 0.03, 12), this.timber(), 0, 0.095, 0));
    for (let k = 0; k < 6; k++) {
      const a = (k / 6) * Math.PI * 2;
      const px = Math.cos(a) * 0.26, pz = Math.sin(a) * 0.26;
      g.add(this.mesh(this.cyl(0.022, 0.28, 6), this.trimM(), px, 0.25, pz));
      g.add(this.mesh(this.box(0.055, 0.018, 0.055), this.stone(), px, 0.40, pz));
    }
    g.add(this.mesh(this.cone(0.40, 0.20, 12), this.roofTex('commons', 0x7a5230, 'tile', 89), 0, 0.51, 0));
    g.add(this.mesh(this.cyl(0.012, 0.08, 6), this.gold(), 0, 0.64, 0));
    g.add(this.mesh(this.sph(0.03, 8), this.brightM(0xffe9a8), 0, 0.69, 0));
    // benches facing the bandstand
    for (const a of [0.4, 2.5, 4.2]) {
      const px = Math.cos(a) * 0.40, pz = Math.sin(a) * 0.40;
      const b = this.mesh(this.box(0.16, 0.02, 0.05), this.timber(), px, 0.085, pz);
      b.rotation.y = -a;
      g.add(b);
      const bl = this.mesh(this.box(0.16, 0.06, 0.012), this.timber(), px, 0.12, pz);
      bl.rotation.y = -a;
      g.add(bl);
    }
    // flanking trees and lamps
    this.addTree(g, -0.60, -0.26, 1.0);
    this.addTree(g, 0.60, -0.26, 0.85);
    this.addLamp(g, -0.56, 0.40, 0.32);
    this.addLamp(g, 0.56, 0.40, 0.32);
  }

  courthouse(g) {
    const face = this.facade('court', { cols: 4, rows: 2, wall: 0xdad4c2, lit: 0.35 }, 97);
    this.addApron(g, 1.30, 1.20, '#aca695', 30, 'court');
    // stepped stylobate
    g.add(this.mesh(this.box(0.92, 0.05, 0.62), this.stone(), 0, 0.045, 0));
    g.add(this.mesh(this.box(0.84, 0.05, 0.54), this.stone(), 0, 0.09, -0.02));
    g.add(this.mesh(this.box(0.70, 0.46, 0.44), face, 0, 0.355, -0.04));
    // colonnade with bases and capitals
    for (let k = 0; k < 6; k++) {
      const px = -0.32 + k * 0.128;
      g.add(this.mesh(this.cyl(0.04, 0.46, 10), this.stone(), px, 0.355, 0.22));
      g.add(this.mesh(this.box(0.10, 0.02, 0.10), this.trimM(), px, 0.135, 0.22));
      g.add(this.mesh(this.box(0.10, 0.02, 0.10), this.trimM(), px, 0.575, 0.22));
    }
    g.add(this.mesh(this.box(0.84, 0.06, 0.56), this.trimM(), 0, 0.615, 0));
    const ped = this.mesh(this.cone(0.44, 0.18, 4), this.roofTex('court', 0x6b6558, 'tile', 101), 0, 0.71, 0);
    ped.rotation.y = Math.PI / 4;
    g.add(ped);
    // dome on a drum, with mast and scales
    g.add(this.mesh(this.cyl(0.16, 0.08, 12), this.stone(), 0, 0.80, 0));
    g.add(this.mesh(this.sph(0.15, 12), this.m('dome', { color: 0x8a99a8, roughness: 0.38, metalness: 0.48 }), 0, 0.87, 0));
    g.add(this.mesh(this.cyl(0.012, 0.16, 6), this.gold(), 0, 1.03, 0));
    g.add(this.mesh(this.box(0.18, 0.015, 0.015), this.gold(), 0, 1.10, 0));
    for (const dx of [-0.075, 0.075]) {
      g.add(this.mesh(this.cyl(0.022, 0.008, 8), this.gold(), dx, 1.085, 0));
    }
    this.addEntrance(g, 0.185, 0.4, 30);
    this.addLamp(g, -0.50, 0.36, 0.30);
    this.addLamp(g, 0.50, 0.36, 0.30);
  }

  dispose() {
    for (const g of this._geo.values()) g.dispose();
    for (const m of this._mat.values()) m.dispose();
    for (const t of this._tex.values()) t.dispose();
    this._geo.clear();
    this._mat.clear();
    this._tex.clear();
  }
}
