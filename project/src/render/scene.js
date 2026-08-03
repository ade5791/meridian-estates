// Render subsystem: board, tokens, dice, buildings, camera, card flip.
// Listens to bus events only; never calls the engine. Cosmetic animation is
// performance.now / RAF-delta driven (documented determinism trade-off).

import * as THREE from 'three';
import { TILES, GROUP_COLORS } from '../rules/board.js';
import { Resilience } from './resilience.js';
import { LandmarkFactory } from './landmarks.js';

const BOARD = 22;          // world units across
const TILE_W = BOARD / 11; // corner tiles are TILE_W x TILE_W
const TOKEN_COLORS = [0xe74c3c, 0x3498db, 0xf1c40f, 0x9b59b6];

// tile index -> board-space center position
export function tilePos(i) {
  const half = BOARD / 2 - TILE_W / 2;
  const step = TILE_W;
  if (i <= 10) return new THREE.Vector3(half - 0, 0, half - 0).setX(half - i * step * 0 + 0), tileSide(i);
  return tileSide(i);
}
function tileSide(i) {
  const half = BOARD / 2 - TILE_W / 2;
  const s = TILE_W;
  if (i <= 10) return new THREE.Vector3(half - i * s, 0, half);          // bottom, right->left
  if (i <= 20) return new THREE.Vector3(-half, 0, half - (i - 10) * s); // left, bottom->top
  if (i <= 30) return new THREE.Vector3(-half + (i - 20) * s, 0, -half);// top, left->right
  return new THREE.Vector3(half, 0, -half + (i - 30) * s);              // right, top->bottom
}

function makeLabelTexture(text, sub, bg, fg) {
  const c = document.createElement('canvas');
  c.width = 256; c.height = 256;
  const g = c.getContext('2d');
  g.fillStyle = bg; g.fillRect(0, 0, 256, 256);
  g.fillStyle = fg;
  g.font = 'bold 30px Georgia, serif';
  g.textAlign = 'center';
  const words = String(text).split(' ');
  let lines = [''];
  for (const w of words) {
    if ((lines[lines.length - 1] + ' ' + w).trim().length > 12) lines.push(w);
    else lines[lines.length - 1] = (lines[lines.length - 1] + ' ' + w).trim();
  }
  lines.forEach((ln, k) => g.fillText(ln, 128, 110 + k * 36));
  if (sub) { g.font = '26px Georgia, serif'; g.fillText(sub, 128, 225); }
  const tx = new THREE.CanvasTexture(c);
  tx.anisotropy = 4;
  return tx;
}

export class RenderSystem {
  static id = 'render';
  static deps = [];

  constructor(canvas, bus, opts = {}) {
    this.canvas = canvas;
    this.bus = bus;
    // S5-FIX-07: honour the OS "reduce motion" accessibility preference.
    // The renderer already had a "fast" path (used by autoplay QA) but nothing
    // ever consulted prefers-reduced-motion, so a user who has asked their OS
    // to reduce motion still got full-length 260ms-per-tile token hops,
    // tumbling dice and 800ms card flips. Reduced motion reuses the short
    // timings and keeps the game fully playable -- state changes are never
    // skipped, only their cosmetic duration is compressed.
    this.reducedMotion = typeof matchMedia === 'function' &&
      matchMedia('(prefers-reduced-motion: reduce)').matches;
    this._fastOpt = !!opts.fast;                   // the caller's own request, kept for re-evaluation
    this.fast = this._fastOpt || this.reducedMotion; // autoplay or reduce-motion: quick animations
    // S6b-FIX-04: player-controlled game speed. Measured on the shipped build:
    // 3.0 rounds/min at 1x, so a typical 41-49 round game costs ~15 minutes,
    // most of it watching AI opponents. That is why games felt like they never
    // finished. speed scales every cosmetic duration AND the AI think-delay.
    this.speed = 1;
    this.quality = opts.quality || 'high'; // low | med | high
    this.orbit = !!opts.orbit; // QA: continuous camera orbit (perf matrix)
    this.orbitAngle = 0;
    this.tokens = [];
    this.buildingGroups = {}; // tileId -> THREE.Group
    this.mortgageMarks = {};
    this.ownerRings = {};     // tileId -> mesh
    this.anim = null;         // active token hop animation
    this.diceMeshes = [];
    this.cardMesh = null;
    this.disposed = false;
  }

  init(ctx) {
    this.ctx = ctx;
    const PRESETS = {
      low:  { dprCap: 1.0, shadows: false, shadowMap: 1024 },
      med:  { dprCap: 1.5, shadows: true,  shadowMap: 1024 },
      high: { dprCap: 2.0, shadows: true,  shadowMap: 2048 },
    };
    this.preset = PRESETS[this.quality] || PRESETS.high;
    const renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true, powerPreference: 'high-performance' });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, this.preset.dprCap));
    renderer.shadowMap.enabled = this.preset.shadows;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.1;
    this.renderer = renderer;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x101822);
    this.scene.fog = new THREE.Fog(0x101822, 40, 90);

    this.camera = new THREE.PerspectiveCamera(45, 1, 0.1, 200);
    this.camDefault = new THREE.Vector3(0, 24, 20);
    this.camera.position.copy(this.camDefault);
    this.camTarget = new THREE.Vector3(0, 0, 0);
    this.camLook = new THREE.Vector3(0, 0, 0);
    this._camScratch = new THREE.Vector3();
    this.camera.lookAt(this.camLook);
    this.followPlayer = null;

    // static lights (count fixed forever; pool adds its 6 at init too)
    const sun = new THREE.DirectionalLight(0xfff2e0, 2.6);
    sun.position.set(14, 22, 8);
    sun.castShadow = this.preset.shadows;
    sun.shadow.mapSize.set(this.preset.shadowMap, this.preset.shadowMap);
    sun.shadow.camera.left = -16; sun.shadow.camera.right = 16;
    sun.shadow.camera.top = 16; sun.shadow.camera.bottom = -16;
    this.scene.add(sun);
    this.sun = sun;
    this.scene.add(new THREE.HemisphereLight(0x8fb4d9, 0x2a2016, 0.9));

    this.buildBoard();
    this.buildDice();
    this.buildCard();

    this.resilience = new Resilience(renderer,
      () => this.forceDirect(),
      () => this.stepDownQuality());

    this.bindEvents();
    this.resize();
    window.addEventListener('resize', this._onResize = () => this.resize());
  }

  forceDirect() {
    // permanent plain forward render
    this.renderer.shadowMap.enabled = false;
    this.renderer.toneMapping = THREE.NoToneMapping;
    this.renderer.setPixelRatio(1);
    this.scene.fog = null;
    this.scene.traverse((o) => { if (o.material) o.material.needsUpdate = true; });
    document.dispatchEvent(new CustomEvent('render:forceDirect'));
  }

  stepDownQuality() {
    this.renderer.shadowMap.enabled = false;
    this.renderer.setPixelRatio(1);
    this.scene.traverse((o) => { if (o.material) o.material.needsUpdate = true; });
  }

  resize() {
    const w = this.canvas.clientWidth || window.innerWidth;
    const h = this.canvas.clientHeight || window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();

    // S6b-FIX-02: SOLVE the framing instead of guessing a magic distance.
    // The old code scaled a hardcoded (0,24,20) vector, which left the board
    // covering only 69.3% of viewport width and 76.4% of height - the game
    // looked small and unfinished. Here we compute the distance that makes the
    // board's projected radius fill FILL_FRACTION of the smaller viewport axis,
    // accounting for both vertical and horizontal FOV. Runs on every resize,
    // so desktop, portrait and landscape are all correctly framed.
    // A tilted camera projects the square board into a trapezoid: the near edge
    // is magnified and pushed DOWN-screen, so aiming at the board origin leaves
    // the shape sitting low (measured dy = +75.6px) and under-filling the frame
    // (72.1% width). Rather than hand-tune constants, SOLVE it: binary-search
    // the camera distance for the largest board that still fits, then recentre
    // by measuring the projected bounds and lifting the aim point.
    const TILT = 0.80;                       // elevation angle - 3/4 view
    const vFov = (this.camera.fov * Math.PI) / 180;
    const halfDiag = (BOARD / 2 + 0.6) * Math.SQRT2;
    const dir = new THREE.Vector3(0, Math.sin(TILT), Math.cos(TILT));

    // corners of the board footprint (square, axis-aligned)
    const hb = BOARD / 2 + 0.6;
    const pts = [
      new THREE.Vector3(-hb, 0, -hb), new THREE.Vector3(hb, 0, -hb),
      new THREE.Vector3(hb, 0, hb), new THREE.Vector3(-hb, 0, hb),
    ];

    const measure = (dist, aimY) => {
      const cam = this._fitCam || (this._fitCam = new THREE.PerspectiveCamera());
      cam.fov = this.camera.fov; cam.aspect = this.camera.aspect;
      cam.near = this.camera.near; cam.far = this.camera.far;
      cam.position.copy(dir).multiplyScalar(dist);
      cam.up.set(0, 1, 0);
      cam.lookAt(0, aimY, 0);
      cam.updateProjectionMatrix();
      cam.updateMatrixWorld(true);
      let mnx = 1e9, mxx = -1e9, mny = 1e9, mxy = -1e9;
      for (const p of pts) {
        const v = this._fitV || (this._fitV = new THREE.Vector3());
        v.copy(p).project(cam);
        mnx = Math.min(mnx, v.x); mxx = Math.max(mxx, v.x);
        mny = Math.min(mny, v.y); mxy = Math.max(mxy, v.y);
      }
      return { mnx, mxx, mny, mxy, w: mxx - mnx, h: mxy - mny,
               cx: (mnx + mxx) / 2, cy: (mny + mxy) / 2 };
    };

    // 1) find aimY that vertically centres the projected board, and the
    //    distance where it fills FILL of the tighter NDC axis (NDC span = 2).
    const FILL = 0.94;
    let dist = halfDiag / Math.tan(vFov / 2);   // starting guess
    let aimY = 0;
    for (let iter = 0; iter < 24; iter++) {
      // recentre vertically: raise the aim point by the measured offset
      const m0 = measure(dist, aimY);
      aimY += m0.cy * dist * 0.30;              // NDC offset -> world lift
      const m = measure(dist, aimY);
      const fillNow = Math.max(m.w, m.h) / 2;   // fraction of the half-extent
      const err = fillNow / FILL;
      if (Math.abs(err - 1) < 0.002) break;
      dist *= err;                              // scale distance to hit FILL
      dist = Math.max(8, Math.min(200, dist));
    }

    this.camAim = this.camAim || new THREE.Vector3();
    this.camAim.set(0, aimY, 0);
    this.camDefault.copy(dir).multiplyScalar(dist);
    this.camera.position.copy(this.camDefault);
    this.camera.up.set(0, 1, 0);
    this.camera.lookAt(this.camAim);
  }

  // ---------- board ----------
  buildBoard() {
    // S6c: shared landmark asset cache. One factory per RenderSystem instance,
    // disposed with the system so a restart returns to the leak baseline.
    this._landmarks = new LandmarkFactory();
    this.landmarkGroups = {};
    // base slab
    const slab = new THREE.Mesh(
      new THREE.BoxGeometry(BOARD + 1.2, 0.6, BOARD + 1.2),
      new THREE.MeshStandardMaterial({ color: 0x1d2b20, roughness: 0.85, metalness: 0.05 })
    );
    slab.position.y = -0.35;
    slab.receiveShadow = true;
    this.scene.add(slab);

    // center felt
    const felt = new THREE.Mesh(
      new THREE.BoxGeometry(BOARD - 2 * TILE_W, 0.1, BOARD - 2 * TILE_W),
      new THREE.MeshStandardMaterial({ color: 0x24402c, roughness: 0.95 })
    );
    felt.position.y = 0.0;
    felt.receiveShadow = true;
    this.scene.add(felt);

    // center emblem
    const emblemTex = makeLabelTexture('MERIDIAN', 'ESTATES', '#24402c', '#d8c07a');
    const emblem = new THREE.Mesh(
      new THREE.PlaneGeometry(7, 7),
      new THREE.MeshStandardMaterial({ map: emblemTex, transparent: false, roughness: 0.9 })
    );
    emblem.rotation.x = -Math.PI / 2;
    emblem.rotation.z = Math.PI / 4;
    emblem.position.y = 0.06;
    this.scene.add(emblem);

    // tiles
    const tileGeo = new THREE.BoxGeometry(TILE_W - 0.06, 0.14, TILE_W - 0.06);
    for (let i = 0; i < 40; i++) {
      const t = TILES[i];
      const pos = tileSide(i);
      const isCorner = i % 10 === 0;
      let baseColor = '#e9e4d0';
      if (t.type === 'card') baseColor = t.deck === 'fortune' ? '#dfe9f5' : '#f5ecdc';
      if (t.type === 'tax') baseColor = '#e5d5d5';
      if (isCorner) baseColor = '#d8d2ba';
      const tex = makeLabelTexture(t.name, t.price ? String(t.price) : '', baseColor, '#222');
      const mat = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.8 });
      const m = new THREE.Mesh(tileGeo, mat);
      m.position.copy(pos);
      m.position.y = 0.07;
      // rotate label to face outward per side
      if (i <= 10) m.rotation.y = 0;
      else if (i <= 20) m.rotation.y = -Math.PI / 2;
      else if (i <= 30) m.rotation.y = Math.PI;
      else m.rotation.y = Math.PI / 2;
      m.receiveShadow = true; m.castShadow = false;
      m.userData.tile = i;
      this.scene.add(m);

      // group color strip
      if (t.type === 'prop') {
        const strip = new THREE.Mesh(
          new THREE.BoxGeometry(TILE_W - 0.06, 0.16, 0.34),
          new THREE.MeshStandardMaterial({ color: GROUP_COLORS[t.group], roughness: 0.55 })
        );
        strip.position.copy(pos);
        strip.position.y = 0.12;
        // strip sits on inner edge of the tile
        const inward = new THREE.Vector3(-pos.x, 0, -pos.z).normalize();
        if (i <= 10 || (i > 20 && i <= 30)) { strip.position.z += Math.sign(inward.z) * (TILE_W / 2 - 0.2); }
        else { strip.rotation.y = Math.PI / 2; strip.position.x += Math.sign(inward.x) * (TILE_W / 2 - 0.2); }
        strip.castShadow = true;
        this.scene.add(strip);
      }

      // owner ring (hidden until owned)
      const ring = new THREE.Mesh(
        new THREE.TorusGeometry(0.5, 0.06, 8, 24),
        new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.4 })
      );
      ring.rotation.x = -Math.PI / 2;
      ring.position.copy(pos); ring.position.y = 0.16;
      ring.visible = false;
      this.scene.add(ring);
      this.ownerRings[i] = ring;

      // building anchor group
      const bg = new THREE.Group();
      bg.position.copy(pos); bg.position.y = 0.15;
      this.scene.add(bg);
      this.buildingGroups[i] = bg;

      // S6c: real 3D architecture per tile. Built ONCE here from a shared
      // geometry/material cache, so there is no per-frame or per-event cost.
      // The landmark is parked on the OUTER half of the tile: houses/hotels
      // keep the inner edge and player tokens keep the centre.
      const lm = this._landmarks.build(i, t);
      lm.position.copy(pos);
      lm.position.y = 0.14;
      // Orient so each landmark's local -z points at the board centre. This is
      // the same per-side mapping the tile labels use, kept in lockstep.
      if (i <= 10) lm.rotation.y = 0;
      else if (i <= 20) lm.rotation.y = -Math.PI / 2;
      else if (i <= 30) lm.rotation.y = Math.PI;
      else lm.rotation.y = Math.PI / 2;
      this.scene.add(lm);
      this.landmarkGroups[i] = lm;

      // mortgage marker
      const mm = new THREE.Mesh(
        new THREE.PlaneGeometry(TILE_W - 0.4, TILE_W - 0.4),
        new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.45 })
      );
      mm.rotation.x = -Math.PI / 2;
      mm.position.copy(pos); mm.position.y = 0.17;
      mm.visible = false;
      this.scene.add(mm);
      this.mortgageMarks[i] = mm;
    }
  }

  createTokens(players) {
    for (const tk of this.tokens) {
      this.scene.remove(tk.mesh);
      tk.mesh.geometry.dispose();
      tk.mesh.material.dispose();
    }
    this.tokens = [];
    const geos = [
      new THREE.ConeGeometry(0.32, 0.85, 24),
      new THREE.CylinderGeometry(0.3, 0.38, 0.7, 24),
      new THREE.SphereGeometry(0.36, 24, 16),
      new THREE.BoxGeometry(0.55, 0.55, 0.55),
    ];
    players.forEach((p, i) => {
      const mesh = new THREE.Mesh(
        geos[i % geos.length],
        new THREE.MeshStandardMaterial({ color: TOKEN_COLORS[i % 4], roughness: 0.35, metalness: 0.35 })
      );
      mesh.castShadow = true;
      const pos = tileSide(p.pos || 0);
      mesh.position.set(pos.x + this.tokenOffset(i).x, 0.55, pos.z + this.tokenOffset(i).z);
      this.scene.add(mesh);
      this.tokens.push({ mesh, player: i, tile: p.pos || 0 });
    });
  }

  tokenOffset(i) {
    // S6b-FIX-03: widen the per-seat spread. At 0.35 the four tokens
    // interpenetrated on the shared start tile (visible in the shipped build
    // as a single clumped blob of overlapping shapes). Tokens are up to 0.55
    // wide, so 0.35 spacing guaranteed intersection; 0.52 separates them
    // while staying inside the 2.0-unit tile.
    const off = [[-0.52, -0.52], [0.52, -0.52], [-0.52, 0.52], [0.52, 0.52]][i % 4];
    return { x: off[0], z: off[1] };
  }

  buildDice() {
    const mkFace = (n) => {
      const c = document.createElement('canvas');
      c.width = 128; c.height = 128;
      const g = c.getContext('2d');
      g.fillStyle = '#f5f0e6'; g.fillRect(0, 0, 128, 128);
      g.fillStyle = '#1a1a1a';
      const pip = (x, y) => { g.beginPath(); g.arc(x, y, 12, 0, Math.PI * 2); g.fill(); };
      const L = 34, M = 64, R = 94;
      const map = {
        1: [[M, M]], 2: [[L, L], [R, R]], 3: [[L, L], [M, M], [R, R]],
        4: [[L, L], [L, R], [R, L], [R, R]], 5: [[L, L], [L, R], [M, M], [R, L], [R, R]],
        6: [[L, L], [L, M], [L, R], [R, L], [R, M], [R, R]],
      };
      for (const [x, y] of map[n]) pip(x, y);
      return new THREE.MeshStandardMaterial({ map: new THREE.CanvasTexture(c), roughness: 0.5 });
    };
    // face order for BoxGeometry: +x -x +y -y +z -z ; opposite faces sum 7
    const mats = [mkFace(1), mkFace(6), mkFace(2), mkFace(5), mkFace(3), mkFace(4)];
    for (let i = 0; i < 2; i++) {
      const d = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.9, 0.9), mats);
      d.castShadow = true;
      d.position.set(i === 0 ? -1 : 1, 0.6, 2);
      d.visible = false;
      this.scene.add(d);
      this.diceMeshes.push(d);
    }
    this.diceAnim = null;
  }

  buildCard() {
    const front = document.createElement('canvas');
    front.width = 512; front.height = 320;
    this.cardFrontCtx = front.getContext('2d');
    this.cardFrontTex = new THREE.CanvasTexture(front);
    const backTexF = makeLabelTexture('FORTUNE', '', '#2d4b9a', '#f0e6c8');
    const backTexL = makeLabelTexture('LEDGER', '', '#8a5a2a', '#f0e6c8');
    this.cardBackMats = {
      fortune: new THREE.MeshStandardMaterial({ map: backTexF, roughness: 0.6 }),
      ledger: new THREE.MeshStandardMaterial({ map: backTexL, roughness: 0.6 }),
    };
    this.cardFrontMat = new THREE.MeshStandardMaterial({ map: this.cardFrontTex, roughness: 0.6 });
    const g = new THREE.BoxGeometry(4.2, 0.06, 2.7);
    this.cardMesh = new THREE.Mesh(g, [
      new THREE.MeshStandardMaterial({ color: 0xdddddd }),
      new THREE.MeshStandardMaterial({ color: 0xdddddd }),
      this.cardFrontMat,               // +y top
      this.cardBackMats.fortune,       // -y bottom
      new THREE.MeshStandardMaterial({ color: 0xdddddd }),
      new THREE.MeshStandardMaterial({ color: 0xdddddd }),
    ]);
    this.cardMesh.position.set(0, 1.4, 0);
    this.cardMesh.visible = false;
    this.scene.add(this.cardMesh);
    this.cardAnim = null;
  }

  drawCardFace(deck, text) {
    const g = this.cardFrontCtx;
    g.fillStyle = deck === 'fortune' ? '#e8eef8' : '#f5eddc';
    g.fillRect(0, 0, 512, 320);
    g.strokeStyle = deck === 'fortune' ? '#2d4b9a' : '#8a5a2a';
    g.lineWidth = 10; g.strokeRect(10, 10, 492, 300);
    g.fillStyle = '#222';
    g.font = '26px Georgia, serif';
    g.textAlign = 'center';
    const words = text.split(' ');
    let lines = [''];
    for (const w of words) {
      if ((lines[lines.length - 1] + ' ' + w).trim().length > 34) lines.push(w);
      else lines[lines.length - 1] = (lines[lines.length - 1] + ' ' + w).trim();
    }
    lines.forEach((ln, k) => g.fillText(ln, 256, 120 + k * 34));
    this.cardFrontTex.needsUpdate = true;
  }

  // S5-FIX-07: react if the user flips the OS reduce-motion setting mid-session.
  // Stored as a named handler and removed in dispose() so it cannot leak.
  bindReducedMotion() {
    if (typeof matchMedia !== 'function') return;
    this._rmQuery = matchMedia('(prefers-reduced-motion: reduce)');
    this._rmHandler = (e) => {
      this.reducedMotion = e.matches;
      this.fast = !!this._fastOpt || this.reducedMotion;
    };
    if (this._rmQuery.addEventListener) this._rmQuery.addEventListener('change', this._rmHandler);
    else if (this._rmQuery.addListener) this._rmQuery.addListener(this._rmHandler);
  }

  // ---------- event bindings ----------
  bindEvents() {
    const b = this.bus;
    this.bindReducedMotion();
    b.on('token:moved', (p) => this.queueMove(p));
    b.on('dice:rolled', (p) => this.animateDice(p));
    b.on('card:drawn', (p) => this.animateCard(p));
    b.on('property:bought', (p) => this.refreshOwnership(p.tile));
    b.on('auction:won', (p) => this.refreshOwnership(p.tile));
    b.on('build:changed', (p) => this.refreshBuildings(p.tile, p.houses));
    b.on('mortgage:changed', (p) => { this.mortgageMarks[p.tile].visible = p.mortgaged; });
    b.on('trade:resolved', () => this.refreshAllOwnership());
    b.on('player:bankrupt', (p) => {
      const tk = this.tokens[p.player];
      if (tk) tk.mesh.visible = false;
      this.refreshAllOwnership();
    });
    b.on('state:loaded', () => this.syncAll());
    // S6b-FIX-01: turn:begin no longer moves the camera. The board stays
    // centred; the HUD and log already communicate whose turn it is.
    b.on('turn:begin', (p) => { this.followPlayer = p.player; /* camera unaffected */ });
  }

  refreshOwnership(tile) {
    const eng = this.ctx.get('engine');
    const ts = eng.tstate(tile);
    const ring = this.ownerRings[tile];
    if (ts.owner === null) { ring.visible = false; return; }
    ring.visible = true;
    ring.material.color.setHex(TOKEN_COLORS[ts.owner % 4]);
  }

  refreshAllOwnership() {
    for (let i = 0; i < 40; i++) {
      const t = TILES[i];
      if (t.type === 'prop' || t.type === 'rail' || t.type === 'util') this.refreshOwnership(i);
    }
  }

  buildingAssets() {
    // shared geometry + material for ALL houses/hotels: zero allocation per
    // build event, and removal never disposes shared assets.
    if (!this._houseGeo) {
      this._houseGeo = new THREE.BoxGeometry(0.28, 0.3, 0.28);
      this._hotelGeo = new THREE.BoxGeometry(0.7, 0.55, 0.45);
      this._houseMat = new THREE.MeshStandardMaterial({ color: 0x2e8b57, roughness: 0.5 });
      this._hotelMat = new THREE.MeshStandardMaterial({ color: 0xb03030, roughness: 0.5 });
    }
  }

  setBuildings(tile, houses) {
    this.buildingAssets();
    const g = this.buildingGroups[tile];
    while (g.children.length) g.remove(g.children[g.children.length - 1]);
    if (houses >= 5) {
      const hotel = new THREE.Mesh(this._hotelGeo, this._hotelMat);
      hotel.position.set(0, 0.28, -TILE_W / 2 + 0.55);
      hotel.castShadow = true;
      g.add(hotel);
    } else {
      for (let h = 0; h < houses; h++) {
        const house = new THREE.Mesh(this._houseGeo, this._houseMat);
        house.position.set(-0.55 + h * 0.37, 0.15, -TILE_W / 2 + 0.55);
        house.castShadow = true;
        g.add(house);
      }
    }
  }

  refreshBuildings(tile, houses) {
    this.setBuildings(tile, houses);
    // build flash from the light pool (unlit if pool exhausted)
    const pool = this.ctx.get('lights');
    if (pool) {
      const l = pool.acquire();
      if (l) {
        const pos = tileSide(tile);
        l.position.set(pos.x, 1.5, pos.z);
        l.color.setHex(0xffe9a0);
        l.intensity = 6;
        const t0 = performance.now();
        const fade = () => {
          if (this.disposed) { pool.release(l); return; }
          const k = (performance.now() - t0) / 600;
          if (k >= 1) { pool.release(l); return; }
          l.intensity = 6 * (1 - k);
          requestAnimationFrame(fade);
        };
        requestAnimationFrame(fade);
      }
    }
  }

  syncAll() {
    const eng = this.ctx.get('engine');
    const s = eng.state;
    this.createTokens(s.players);
    s.players.forEach((p, i) => { if (p.bankrupt) this.tokens[i].mesh.visible = false; });
    this.refreshAllOwnership();
    for (let i = 0; i < 40; i++) {
      const ts = s.tiles[i];
      this.refreshBuildingsQuiet(i, ts.houses);
      this.mortgageMarks[i].visible = ts.mortgaged;
    }
  }

  refreshBuildingsQuiet(tile, houses) {
    // same as refreshBuildings but no light flash (bulk sync)
    this.setBuildings(tile, houses);
  }

  // ---------- animations ----------
  queueMove(p) {
    const tk = this.tokens[p.player];
    if (!tk) return;
    tk.tile = p.to;
    this.animQueue = this.animQueue || [];
    this.animQueue.push({ token: tk, path: p.path.slice(), player: p.player });
  }

  animateDice(p) {
    for (const d of this.diceMeshes) d.visible = true;
    // final orientations that show d1/d2 on top
    const faceUp = {
      1: [0, 0, 0], 6: [Math.PI, 0, 0],
      2: [0, 0, -Math.PI / 2], 5: [0, 0, Math.PI / 2],
      3: [Math.PI / 2, 0, 0], 4: [-Math.PI / 2, 0, 0],
    };
    this.diceAnim = {
      t0: performance.now(),
      dur: (this.fast ? 250 : 900) / this.speed,
      final: [faceUp[p.d1], faceUp[p.d2]],
    };
    // dice glow from pool
    const pool = this.ctx.get('lights');
    if (pool) {
      const l = pool.acquire();
      if (l) {
        l.position.set(0, 2.2, 2);
        l.color.setHex(0xaad4ff);
        l.intensity = 4;
        setTimeout(() => pool.release(l), this.fast ? 300 : 1000);
      }
    }
  }

  animateCard(p) {
    this.drawCardFace(p.deck, p.text);
    this.cardMesh.material[3] = this.cardBackMats[p.deck];
    this.cardMesh.visible = true;
    this.cardMesh.rotation.set(0, 0, Math.PI); // face down
    this.cardAnim = { t0: performance.now(), dur: (this.fast ? 200 : 800) / this.speed,
                      hold: (this.fast ? 300 : 2200) / this.speed };
    const pool = this.ctx.get('lights');
    if (pool) {
      const l = pool.acquire();
      if (l) {
        l.position.set(0, 3, 0);
        l.color.setHex(0xfff0c0);
        l.intensity = 5;
        setTimeout(() => pool.release(l), this.fast ? 500 : 2500);
      }
    }
  }

  update(dtMs) {
    const now = performance.now();

    // token hop animation - tile by tile
    if (!this.anim && this.animQueue && this.animQueue.length) {
      const job = this.animQueue.shift();
      this.anim = { ...job, step: 0, t0: now, hopDur: (this.fast ? 40 : 260) / this.speed };
    }
    if (this.anim) {
      const a = this.anim;
      const k = Math.min(1, (now - a.t0) / a.hopDur);
      const fromTile = a.step === 0
        ? (a.prevTile !== undefined ? a.prevTile : this.prevTileOf(a))
        : a.path[a.step - 1];
      const from = tileSide(fromTile);
      const to = tileSide(a.path[a.step]);
      const off = this.tokenOffset(a.player);
      const x = from.x + (to.x - from.x) * k + off.x;
      const z = from.z + (to.z - from.z) * k + off.z;
      const y = 0.55 + Math.sin(k * Math.PI) * 0.7;
      a.token.mesh.position.set(x, y, z);
      if (k >= 1) {
        a.step++;
        a.t0 = now;
        a.prevTile = a.path[a.step - 1];
        if (a.step >= a.path.length) {
          a.token.mesh.position.set(to.x + off.x, 0.55, to.z + off.z);
          this.anim = null;
        }
      }
      // S6b-FIX-01: the camera NO LONGER chases the active token.
      // Measured on the live build: token-follow held the board 163.7px
      // off-centre at rest and swung it 237px between turns. On a board game
      // that continuous sliding reads as the board "glitching". A board game
      // must present the WHOLE board, stable and centred.
    }

    // smooth camera (or QA orbit: continuous motion for the perf matrix)
    if (this.orbit) {
      this.orbitAngle += dtMs * 0.0006;
      const r = Math.hypot(this.camDefault.x + 0.001, this.camDefault.z + 20);
      this.camera.position.set(Math.sin(this.orbitAngle) * r, this.camDefault.y,
        Math.cos(this.orbitAngle) * r);
      this.camera.lookAt(0, 0, 0);
    } else {
      // S6b-FIX-01: fixed, centred framing. The camera sits at the fitted
      // default and always looks at the solved aim point, so the board stays
      // centred and motionless for the whole game. Only the tokens move.
      this.camera.position.copy(this.camDefault);
      this.camera.lookAt(this.camAim || this._originAim ||
        (this._originAim = new THREE.Vector3(0, 0, 0)));
    }

    // dice tumble
    if (this.diceAnim) {
      const d = this.diceAnim;
      const k = Math.min(1, (now - d.t0) / d.dur);
      this.diceMeshes.forEach((m, i) => {
        if (k < 1) {
          m.rotation.x += 0.35; m.rotation.y += 0.27; m.rotation.z += 0.19;
          m.position.y = 0.6 + Math.sin(k * Math.PI) * 1.2;
        } else {
          m.rotation.set(...d.final[i]);
          m.position.y = 0.6;
        }
      });
      if (k >= 1) this.diceAnim = null;
    }

    // card flip
    if (this.cardAnim) {
      const c = this.cardAnim;
      const k = Math.min(1, (now - c.t0) / c.dur);
      this.cardMesh.rotation.z = Math.PI * (1 - k);
      this.cardMesh.position.y = 1.4 + Math.sin(k * Math.PI) * 0.8;
      if (k >= 1 && now - c.t0 > c.dur + c.hold) {
        this.cardMesh.visible = false;
        this.cardAnim = null;
      }
    }
  }

  prevTileOf(a) {
    // derive the starting tile: one step back along path is not stored, so use token record
    const first = a.path[0];
    return (first - 1 + 40) % 40;
  }

  render() {
    this.renderer.render(this.scene, this.camera);
  }

  isAnimating() {
    return !!(this.anim || (this.animQueue && this.animQueue.length) || this.diceAnim || this.cardAnim);
  }

  // S6b-FIX-04: set playback speed (1 = normal, 2 = fast, 4 = very fast).
  // Scales cosmetic animation only; the rules engine is untouched, so game
  // outcomes stay identical for a given seed.
  setSpeed(mult) {
    const m = Number(mult);
    this.speed = Number.isFinite(m) && m > 0 ? Math.min(8, Math.max(0.5, m)) : 1;
    return this.speed;
  }

  dispose() {
    // Full teardown (leak audit contract): every geometry, material and
    // texture created by this system is disposed; the scene is emptied.
    this.disposed = true;
    window.removeEventListener('resize', this._onResize);
    // S5-FIX-07: drop the reduced-motion media listener (leak audit discipline)
    if (this._rmQuery && this._rmHandler) {
      if (this._rmQuery.removeEventListener) this._rmQuery.removeEventListener('change', this._rmHandler);
      else if (this._rmQuery.removeListener) this._rmQuery.removeListener(this._rmHandler);
      this._rmQuery = null; this._rmHandler = null;
    }
    const seenMats = new Set();
    this.scene.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
      if (o.material) {
        const mats = Array.isArray(o.material) ? o.material : [o.material];
        for (const m of mats) {
          if (seenMats.has(m)) continue;
          seenMats.add(m);
          if (m.map) m.map.dispose();
          m.dispose();
        }
      }
    });
    this.scene.clear();
    // S6c: release the shared landmark geometry/material cache. The traverse
    // above already disposed each instance's assets, but the cache holds its
    // own references, so it must be cleared or a restart leaks them.
    if (this._landmarks) { this._landmarks.dispose(); this._landmarks = null; }
    this.landmarkGroups = {};
    this.tokens = [];
    this.buildingGroups = {};
    this.ownerRings = {};
    this.mortgageMarks = {};
    this.diceMeshes = [];
    this.cardMesh = null;
    this.animQueue = [];
    this.anim = null; this.diceAnim = null; this.cardAnim = null;
    this.renderer.renderLists.dispose();
    this.renderer.dispose();
  }
}
