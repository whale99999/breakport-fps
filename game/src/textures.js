// textures.js — every surface in BREAKPORT is painted in code at boot:
// canvas-generated textures for containers, concrete, crates, the warehouse,
// barrels and hazard paint, plus the sun's glow sprite. No image files, no
// network; each texture is generated once and cached, materials are shared.
import * as THREE from 'three';
import { mat } from './palette.js';

// Small deterministic RNG so the rust and grime land the same way every load.
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function seedFrom(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
function css(hex, alpha = 1) {
  return `rgba(${(hex >> 16) & 255},${(hex >> 8) & 255},${hex & 255},${alpha})`;
}
function shadeNum(hex, f) {
  const r = Math.min(255, Math.round(((hex >> 16) & 255) * f));
  const g = Math.min(255, Math.round(((hex >> 8) & 255) * f));
  const b = Math.min(255, Math.round((hex & 255) * f));
  return (r << 16) | (g << 8) | b;
}
function makeCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return [c, c.getContext('2d')];
}
function toTex(c, rx = 1, ry = 1) {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  if (rx !== 1 || ry !== 1) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(rx, ry); }
  return t;
}
// Rust streaks running down from the top or up from the bottom edge, plus a
// grime gradient along the bottom — shared weathering for metal surfaces.
function weather(g, w, h, rnd, streaks = 14) {
  for (let i = 0; i < streaks; i++) {
    const x = rnd() * w, sw = 3 + rnd() * 9, len = h * (0.16 + rnd() * 0.5), fromTop = rnd() < 0.5;
    const gr = g.createLinearGradient(0, fromTop ? 0 : h, 0, fromTop ? len : h - len);
    gr.addColorStop(0, 'rgba(122,58,20,0.50)');
    gr.addColorStop(1, 'rgba(122,58,20,0)');
    g.fillStyle = gr;
    g.fillRect(x, fromTop ? 0 : h - len, sw, len);
  }
  const grime = g.createLinearGradient(0, h * 0.66, 0, h);
  grime.addColorStop(0, 'rgba(20,14,8,0)');
  grime.addColorStop(1, 'rgba(20,14,8,0.42)');
  g.fillStyle = grime;
  g.fillRect(0, h * 0.66, w, h * 0.34);
}

// --- shipping containers -----------------------------------------------------
const containerTexCache = new Map();
export function containerTexture(hex, label) {
  const key = hex + '|' + label;
  let t = containerTexCache.get(key);
  if (t) return t;
  const [c, g] = makeCanvas(512, 256);
  const rnd = rng(seedFrom(label));
  g.fillStyle = css(hex);
  g.fillRect(0, 0, 512, 256);
  // corrugated ridges: a light-dark gradient every 32 px
  for (let x = 0; x < 512; x += 32) {
    const gr = g.createLinearGradient(x, 0, x + 32, 0);
    gr.addColorStop(0, 'rgba(0,0,0,0.30)');
    gr.addColorStop(0.35, 'rgba(255,255,255,0.11)');
    gr.addColorStop(0.7, 'rgba(255,255,255,0.02)');
    gr.addColorStop(1, 'rgba(0,0,0,0.24)');
    g.fillStyle = gr;
    g.fillRect(x, 0, 32, 256);
  }
  // top and bottom rails
  g.fillStyle = 'rgba(0,0,0,0.26)'; g.fillRect(0, 0, 512, 14); g.fillRect(0, 242, 512, 14);
  g.fillStyle = 'rgba(255,255,255,0.09)'; g.fillRect(0, 14, 512, 3);
  weather(g, 512, 256, rnd, 16);
  // scuffs
  g.fillStyle = 'rgba(15,12,10,0.18)';
  for (let i = 0; i < 10; i++) g.fillRect(rnd() * 500, 60 + rnd() * 180, 4 + rnd() * 26, 2 + rnd() * 3);
  // stencil: fleet number big, operator lines under it, boxed B logo
  g.textAlign = 'left'; g.textBaseline = 'top';
  g.fillStyle = 'rgba(242,227,194,0.88)';
  g.font = '900 52px ui-monospace, Menlo, monospace';
  g.fillText(label, 26, 28);
  g.font = '700 20px ui-monospace, Menlo, monospace';
  g.fillStyle = 'rgba(242,227,194,0.60)';
  g.fillText('BREAKPORT LINES', 28, 98);
  g.fillText('MAX 30480 KG · TARE 2180 KG', 28, 126);
  g.strokeStyle = 'rgba(242,227,194,0.55)'; g.lineWidth = 3;
  g.strokeRect(450, 26, 38, 38);
  g.fillStyle = 'rgba(242,227,194,0.75)';
  g.font = '900 26px system-ui, sans-serif'; g.textAlign = 'center';
  g.fillText('B', 469, 32);
  t = toTex(c);
  containerTexCache.set(key, t);
  return t;
}

const containerMatCache = new Map();
// Box material array: textured sides, plain darker roof.
export function containerMats(hex, label) {
  const key = hex + '|' + label;
  let m = containerMatCache.get(key);
  if (m) return m;
  const side = new THREE.MeshStandardMaterial({
    map: containerTexture(hex, label), roughness: 0.62, metalness: 0.28,
  });
  const top = mat(shadeNum(hex, 0.7), 0.8, 0.15);
  m = [side, side, top, top, side, side];
  containerMatCache.set(key, m);
  return m;
}

// --- concrete ground -----------------------------------------------------------
let concrete = null;
export function concreteMat() {
  if (concrete) return concrete;
  const [c, g] = makeCanvas(512, 512);
  const rnd = rng(90210);
  g.fillStyle = '#5f6368';
  g.fillRect(0, 0, 512, 512);
  for (let i = 0; i < 2600; i++) { // aggregate speckle
    g.fillStyle = rnd() < 0.5 ? 'rgba(0,0,0,0.13)' : 'rgba(255,255,255,0.07)';
    g.fillRect(rnd() * 512, rnd() * 512, 1 + rnd() * 2, 1 + rnd() * 2);
  }
  for (let i = 0; i < 9; i++) { // oil and water stains
    const x = rnd() * 512, y = rnd() * 512, r = 30 + rnd() * 85;
    const gr = g.createRadialGradient(x, y, 2, x, y, r);
    gr.addColorStop(0, `rgba(28,26,23,${0.10 + rnd() * 0.12})`);
    gr.addColorStop(1, 'rgba(28,26,23,0)');
    g.fillStyle = gr;
    g.fillRect(x - r, y - r, r * 2, r * 2);
  }
  g.strokeStyle = 'rgba(24,24,28,0.5)'; g.lineWidth = 1.5; // cracks
  for (let i = 0; i < 6; i++) {
    let x = rnd() * 512, y = rnd() * 512;
    g.beginPath(); g.moveTo(x, y);
    for (let s = 0; s < 6; s++) { x += (rnd() - 0.5) * 70; y += (rnd() - 0.5) * 70; g.lineTo(x, y); }
    g.stroke();
  }
  g.fillStyle = 'rgba(28,28,32,0.55)'; // expansion joints
  for (let i = 0; i <= 4; i++) { g.fillRect(i * 128 - 1, 0, 3, 512); g.fillRect(0, i * 128 - 1, 512, 3); }
  g.fillStyle = 'rgba(255,255,255,0.05)';
  for (let i = 0; i <= 4; i++) { g.fillRect(i * 128 + 2, 0, 1, 512); g.fillRect(0, i * 128 + 2, 512, 1); }
  concrete = new THREE.MeshStandardMaterial({ map: toTex(c, 10, 8), roughness: 0.96, metalness: 0 });
  return concrete;
}

// --- wooden crates ---------------------------------------------------------------
let crate = null;
export function crateMat() {
  if (crate) return crate;
  const [c, g] = makeCanvas(256, 256);
  const rnd = rng(5177);
  g.fillStyle = '#c39f66';
  g.fillRect(0, 0, 256, 256);
  for (let row = 0; row < 4; row++) { // planks with per-board tone and grain
    const y = row * 64;
    g.fillStyle = `rgba(${90 + rnd() * 40 | 0},${58 + rnd() * 26 | 0},20,${0.10 + rnd() * 0.12})`;
    g.fillRect(0, y, 256, 64);
    g.strokeStyle = 'rgba(70,48,22,0.35)'; g.lineWidth = 1;
    for (let i = 0; i < 7; i++) {
      const gy = y + 6 + rnd() * 52;
      g.beginPath(); g.moveTo(0, gy); g.lineTo(256, gy + (rnd() - 0.5) * 5); g.stroke();
    }
    g.fillStyle = 'rgba(40,26,12,0.65)';
    g.fillRect(0, y + 62, 256, 2);
  }
  // frame: edge beams over the planks, nails in the corners
  g.fillStyle = '#7d5c33';
  g.fillRect(0, 0, 256, 20); g.fillRect(0, 236, 256, 20);
  g.fillRect(0, 0, 20, 256); g.fillRect(236, 0, 20, 256);
  g.fillStyle = 'rgba(255,235,200,0.10)';
  g.fillRect(0, 20, 256, 3); g.fillRect(20, 0, 3, 256);
  g.fillStyle = '#2e2013';
  for (const [x, y] of [[10, 10], [246, 10], [10, 246], [246, 246], [128, 10], [128, 246]]) {
    g.beginPath(); g.arc(x, y, 3, 0, 7); g.fill();
  }
  crate = new THREE.MeshStandardMaterial({ map: toTex(c), roughness: 0.95, metalness: 0 });
  return crate;
}

// --- warehouse walls ----------------------------------------------------------------
let warehouse = null;
export function warehouseMat(letter) {
  if (warehouse) return warehouse;
  const [c, g] = makeCanvas(512, 256);
  const rnd = rng(31173);
  g.fillStyle = '#b08d55';
  g.fillRect(0, 0, 512, 256);
  for (let x = 0; x <= 512; x += 64) { // panel seams + rivets
    g.fillStyle = 'rgba(40,30,16,0.5)'; g.fillRect(x - 1, 0, 3, 256);
    g.fillStyle = 'rgba(255,240,210,0.13)'; g.fillRect(x + 2, 0, 2, 256);
    g.fillStyle = 'rgba(40,30,16,0.55)';
    for (let y = 16; y < 256; y += 32) { g.beginPath(); g.arc(x + 8, y, 2, 0, 7); g.fill(); }
  }
  g.fillStyle = 'rgba(40,30,16,0.4)'; g.fillRect(0, 126, 512, 3);
  // the big faded letter painted on the cladding
  g.fillStyle = 'rgba(242,227,194,0.20)';
  g.font = '900 178px system-ui, sans-serif';
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(letter, 256, 138);
  weather(g, 512, 256, rnd, 9);
  warehouse = new THREE.MeshStandardMaterial({ map: toTex(c, 2, 1), roughness: 0.9, metalness: 0.05 });
  return warehouse;
}

// --- barrels ---------------------------------------------------------------------------
const barrelCache = new Map();
export function barrelMat(hex) {
  let m = barrelCache.get(hex);
  if (m) return m;
  const [c, g] = makeCanvas(256, 128);
  const rnd = rng(seedFrom('barrel' + hex));
  g.fillStyle = css(hex);
  g.fillRect(0, 0, 256, 128);
  for (let x = 0; x < 256; x += 8) { // soft vertical shading
    g.fillStyle = rnd() < 0.5 ? 'rgba(0,0,0,0.06)' : 'rgba(255,255,255,0.045)';
    g.fillRect(x, 0, 4, 128);
  }
  for (const y of [26, 88]) { // rolled ribs
    g.fillStyle = 'rgba(0,0,0,0.4)'; g.fillRect(0, y, 256, 6);
    g.fillStyle = 'rgba(255,255,255,0.16)'; g.fillRect(0, y - 3, 256, 3);
  }
  weather(g, 256, 128, rnd, 8);
  g.fillStyle = 'rgba(242,227,194,0.55)';
  g.font = '700 17px ui-monospace, Menlo, monospace';
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText('PORT FUEL', 128, 58);
  m = new THREE.MeshStandardMaterial({ map: toTex(c), roughness: 0.55, metalness: 0.35 });
  barrelCache.set(hex, m);
  return m;
}

// --- hazard stripes -----------------------------------------------------------------------
let hazard = null;
export function hazardMat() {
  if (hazard) return hazard;
  const [c, g] = makeCanvas(128, 128);
  g.fillStyle = '#d8a022';
  g.fillRect(0, 0, 128, 128);
  g.fillStyle = '#22242a';
  for (let x = -128; x < 256; x += 64) { // 45-degree bands
    g.beginPath();
    g.moveTo(x, 128); g.lineTo(x + 32, 128); g.lineTo(x + 32 + 128, 0); g.lineTo(x + 128, 0);
    g.closePath(); g.fill();
  }
  hazard = new THREE.MeshBasicMaterial({ map: toTex(c, 4, 1) });
  return hazard;
}

// --- sun glow sprite -----------------------------------------------------------------------
let glowTex = null;
export function sunGlowTexture() {
  if (glowTex) return glowTex;
  const [c, g] = makeCanvas(256, 256);
  const gr = g.createRadialGradient(128, 128, 2, 128, 128, 128);
  gr.addColorStop(0, 'rgba(255,242,205,1)');
  gr.addColorStop(0.22, 'rgba(255,206,132,0.55)');
  gr.addColorStop(0.6, 'rgba(255,160,80,0.16)');
  gr.addColorStop(1, 'rgba(255,150,70,0)');
  g.fillStyle = gr;
  g.fillRect(0, 0, 256, 256);
  glowTex = toTex(c);
  return glowTex;
}

let flashTex = null;
// Muzzle flash sprite: a hot core with six tapered spikes, alpha falling to
// zero at the rim so the additive quad reads as a star burst, not a square.
export function muzzleFlashTexture() {
  if (flashTex) return flashTex;
  const [c, g] = makeCanvas(128, 128);
  g.translate(64, 64);
  for (let i = 0; i < 6; i++) {
    g.save();
    g.rotate((i / 6) * Math.PI * 2 + 0.4);
    const gr = g.createLinearGradient(0, 0, 62, 0);
    gr.addColorStop(0, 'rgba(255,220,150,0.8)');
    gr.addColorStop(1, 'rgba(255,160,60,0)');
    g.fillStyle = gr;
    g.beginPath(); g.moveTo(0, -5); g.lineTo(62, 0); g.lineTo(0, 5); g.closePath(); g.fill();
    g.restore();
  }
  const core = g.createRadialGradient(0, 0, 1, 0, 0, 30);
  core.addColorStop(0, 'rgba(255,246,214,1)');
  core.addColorStop(0.5, 'rgba(255,205,120,0.55)');
  core.addColorStop(1, 'rgba(255,170,70,0)');
  g.fillStyle = core;
  g.beginPath(); g.arc(0, 0, 30, 0, Math.PI * 2); g.fill();
  flashTex = toTex(c);
  return flashTex;
}
