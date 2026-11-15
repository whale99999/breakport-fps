// palette.js — the one colour story for BREAKPORT: a container port at dusk.
// Sand, rust orange, teal and slate, lit by low golden sun. Team colours come
// from the same family: Jackals wear rust, Wardens wear teal.
import * as THREE from 'three';

export const PAL = {
  sand: 0xd9b380,
  sandDark: 0xb08d55,
  asphalt: 0x5b5f66,
  rust: 0xc65a21,
  rustDark: 0x9a4215,
  teal: 0x1f7a72,
  tealDark: 0x14524d,
  slate: 0x3d4756,
  slateLight: 0x5a6a7d,
  cream: 0xf2e3c2,
  sky: 0xf7b267,
  skyLow: 0xffe3b3,
  fog: 0xe8a06a,
  sun: 0xffc98a,
  jackal: 0xc65a21,
  warden: 0x1f8a80,
};

const cache = new Map();

// Shared MeshStandardMaterials by colour+roughness, so the map builds few
// materials and the renderer binds few programs.
export function mat(color, rough = 0.9, metal = 0.0) {
  const key = color + '|' + rough + '|' + metal;
  let m = cache.get(key);
  if (!m) {
    m = new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: metal });
    cache.set(key, m);
  }
  return m;
}

export function box(w, h, d, material) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

// A canvas texture drawn in code (site letters, container stencils): no image
// files, no network, generated once at boot.
export function textTexture(text, fg, bg, size = 256) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  if (bg) { g.fillStyle = bg; g.fillRect(0, 0, size, size); }
  g.fillStyle = fg;
  g.font = `900 ${Math.floor(size * 0.72)}px system-ui, sans-serif`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(text, size / 2, size / 2 + size * 0.03);
  const tex = new THREE.CanvasTexture(c);
  tex.anisotropy = 4;
  return tex;
}
