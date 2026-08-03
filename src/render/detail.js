// S6d: shared architectural DETAIL vocabulary for the 40 board landmarks.
//
// Why a separate module: S6c gave every tile a correct silhouette but the
// surfaces were flat -- boxes with one flat albedo, no openings, no trim, no
// ground plane. That fails the visual bar ("no flat or untextured surfaces;
// nothing perfectly straight, clean or repeated"). This module supplies the
// reusable small parts that turn a massing block into a building.
//
// Doctrine constraints (unchanged from S6c and enforced by the geometry gate):
//  - ZERO per-frame allocation. Everything is built once at board construction.
//  - SHARED geometry/material cache, so 40 landmarks do not multiply memory.
//  - DETERMINISTIC variation from an integer hash, never Math.random.
//  - NO NEW LIGHTS. Windows read as lit via emissive material, which costs no
//    light slot and therefore cannot perturb the fixed light pool.
//  - Everything must stay inside the tile footprint (the gate fails otherwise).

import * as THREE from 'three';

// deterministic 0..1 from an integer (xorshift-style mix)
export function h01(i, salt = 0) {
  let x = (i * 374761393 + salt * 668265263) | 0;
  x = (x ^ (x >>> 13)) | 0;
  x = Math.imul(x, 1274126177) | 0;
  x = (x ^ (x >>> 16)) >>> 0;
  return x / 4294967296;
}

// A window grid drawn as a single canvas texture. One texture is shared by all
// buildings of a given style, so 40 landmarks add a handful of textures, not
// hundreds. The texture carries mullions, sill shading, per-pane brightness
// variation and grime -- the "readable at half a metre" detail layer.
export function facadeTexture(opts) {
  const cols = opts.cols || 4;
  const rows = opts.rows || 3;
  const wallHex = opts.wall || 0xd8d2c0;
  const litFrac = opts.litFrac === undefined ? 0.45 : opts.litFrac;
  const seed = opts.seed || 0;
  const trim = opts.trim || 0x000000;

  const W = 256, H = 256;
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const g = c.getContext('2d');

  const hex = (n) => '#' + n.toString(16).padStart(6, '0');
  // base wall with subtle vertical banding so it is never a flat fill
  g.fillStyle = hex(wallHex);
  g.fillRect(0, 0, W, H);
  for (let i = 0; i < 90; i++) {
    const a = 0.03 + h01(seed, 900 + i) * 0.05;
    g.fillStyle = 'rgba(0,0,0,' + a.toFixed(3) + ')';
    const bx = Math.floor(h01(seed, 1000 + i) * W);
    g.fillRect(bx, 0, 1 + Math.floor(h01(seed, 2000 + i) * 2), H);
  }
  // grime gradient toward the base (weathering, per the visual bar)
  const grad = g.createLinearGradient(0, H * 0.55, 0, H);
  grad.addColorStop(0, 'rgba(0,0,0,0)');
  grad.addColorStop(1, 'rgba(20,16,10,0.30)');
  g.fillStyle = grad;
  g.fillRect(0, 0, W, H);

  // window grid
  const padX = W * 0.10, padY = H * 0.12;
  const cw = (W - padX * 2) / cols;
  const ch = (H - padY * 2) / rows;
  const wW = cw * 0.62, wH = ch * 0.60;
  for (let r = 0; r < rows; r++) {
    for (let k = 0; k < cols; k++) {
      const x = padX + k * cw + (cw - wW) / 2;
      const y = padY + r * ch + (ch - wH) / 2;
      const lit = h01(seed, r * 31 + k * 7 + 3) < litFrac;
      // recess shadow so the opening reads as depth, not a sticker
      g.fillStyle = 'rgba(0,0,0,0.45)';
      g.fillRect(x - 2, y - 2, wW + 4, wH + 4);
      if (lit) {
        const warm = 200 + Math.floor(h01(seed, r * 13 + k * 5) * 55);
        g.fillStyle = 'rgb(' + warm + ',' + (warm - 35) + ',' + (warm - 110) + ')';
      } else {
        const cool = 40 + Math.floor(h01(seed, r * 17 + k * 11) * 35);
        g.fillStyle = 'rgb(' + cool + ',' + (cool + 12) + ',' + (cool + 26) + ')';
      }
      g.fillRect(x, y, wW, wH);
      // mullions
      g.strokeStyle = hex(trim);
      g.lineWidth = 1.5;
      g.beginPath();
      g.moveTo(x + wW / 2, y); g.lineTo(x + wW / 2, y + wH);
      g.moveTo(x, y + wH / 2); g.lineTo(x + wW, y + wH / 2);
      g.stroke();
      g.strokeRect(x, y, wW, wH);
      // sill highlight
      g.fillStyle = 'rgba(255,255,255,0.16)';
      g.fillRect(x - 2, y + wH + 1, wW + 4, 2);
    }
  }
  // storey band lines
  g.fillStyle = 'rgba(0,0,0,0.18)';
  for (let r = 1; r < rows; r++) g.fillRect(0, padY + r * ch - 1, W, 2);

  const tx = new THREE.CanvasTexture(c);
  tx.anisotropy = 4;
  tx.colorSpace = THREE.SRGBColorSpace;
  return tx;
}

// Emissive mask so lit windows actually glow without adding a light.
export function facadeEmissiveTexture(opts) {
  const cols = opts.cols || 4;
  const rows = opts.rows || 3;
  const litFrac = opts.litFrac === undefined ? 0.45 : opts.litFrac;
  const seed = opts.seed || 0;
  const W = 256, H = 256;
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const g = c.getContext('2d');
  g.fillStyle = '#000000';
  g.fillRect(0, 0, W, H);
  const padX = W * 0.10, padY = H * 0.12;
  const cw = (W - padX * 2) / cols;
  const ch = (H - padY * 2) / rows;
  const wW = cw * 0.62, wH = ch * 0.60;
  for (let r = 0; r < rows; r++) {
    for (let k = 0; k < cols; k++) {
      if (h01(seed, r * 31 + k * 7 + 3) >= litFrac) continue;
      const x = padX + k * cw + (cw - wW) / 2;
      const y = padY + r * ch + (ch - wH) / 2;
      const warm = 190 + Math.floor(h01(seed, r * 13 + k * 5) * 65);
      g.fillStyle = 'rgb(' + warm + ',' + (warm - 45) + ',' + (warm - 120) + ')';
      g.fillRect(x, y, wW, wH);
    }
  }
  const tx = new THREE.CanvasTexture(c);
  tx.anisotropy = 2;
  tx.colorSpace = THREE.SRGBColorSpace;
  return tx;
}

// Roof texture: seams, gravel/tile speckle, and a darker perimeter so the roof
// plane is never a single flat colour when viewed from the 3/4 camera.
export function roofTexture(hex0, seed, kind) {
  const W = 128, H = 128;
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const g = c.getContext('2d');
  const hex = (n) => '#' + n.toString(16).padStart(6, '0');
  g.fillStyle = hex(hex0);
  g.fillRect(0, 0, W, H);
  if (kind === 'tile') {
    g.strokeStyle = 'rgba(0,0,0,0.28)';
    g.lineWidth = 2;
    for (let y = 8; y < H; y += 12) {
      g.beginPath(); g.moveTo(0, y); g.lineTo(W, y); g.stroke();
    }
    for (let y = 8; y < H; y += 12) {
      for (let x = 6; x < W; x += 14) {
        g.fillStyle = 'rgba(255,255,255,0.07)';
        g.fillRect(x, y - 6, 10, 5);
      }
    }
  } else {
    // flat/gravel roof: speckle + seam lines + rooftop staining
    for (let i = 0; i < 900; i++) {
      const a = 0.04 + h01(seed, i) * 0.14;
      g.fillStyle = 'rgba(0,0,0,' + a.toFixed(3) + ')';
      g.fillRect(Math.floor(h01(seed, i * 3) * W), Math.floor(h01(seed, i * 5) * H), 2, 2);
    }
    g.strokeStyle = 'rgba(255,255,255,0.10)';
    g.lineWidth = 1;
    for (let x = 16; x < W; x += 22) {
      g.beginPath(); g.moveTo(x, 0); g.lineTo(x, H); g.stroke();
    }
  }
  g.strokeStyle = 'rgba(0,0,0,0.35)';
  g.lineWidth = 6;
  g.strokeRect(3, 3, W - 6, H - 6);
  const tx = new THREE.CanvasTexture(c);
  tx.anisotropy = 4;
  tx.colorSpace = THREE.SRGBColorSpace;
  return tx;
}

// Ground apron texture: paving, kerb and a little dirt, so the building sits
// on a surface instead of floating on the printed tile.
export function apronTexture(seed, tone) {
  const W = 128, H = 128;
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const g = c.getContext('2d');
  g.fillStyle = tone || '#b9b3a2';
  g.fillRect(0, 0, W, H);
  g.strokeStyle = 'rgba(0,0,0,0.22)';
  g.lineWidth = 1.5;
  for (let y = 16; y < H; y += 16) { g.beginPath(); g.moveTo(0, y); g.lineTo(W, y); g.stroke(); }
  for (let x = 16; x < W; x += 16) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, H); g.stroke(); }
  for (let i = 0; i < 260; i++) {
    const a = 0.03 + h01(seed, 500 + i) * 0.10;
    g.fillStyle = 'rgba(60,50,35,' + a.toFixed(3) + ')';
    g.fillRect(Math.floor(h01(seed, i * 7) * W), Math.floor(h01(seed, i * 11) * H), 3, 3);
  }
  const tx = new THREE.CanvasTexture(c);
  tx.anisotropy = 4;
  tx.colorSpace = THREE.SRGBColorSpace;
  return tx;
}
