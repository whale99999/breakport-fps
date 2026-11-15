// world.js — BREAKPORT's map: a container port at golden hour. Builds every
// mesh, the AABB collider list movement resolves against, the shootable mesh
// list raycasts test, the two Charge sites, spawn points and the waypoint
// graph the bots navigate. Three lanes: Dock->Mid->A (north), the Dock->B
// connector (south), and Mid->B through the centre.
import * as THREE from 'three';
import { PAL, mat, box, textTexture } from './palette.js';

export const BOUNDS = { x: 58, z: 40 };

export function createWorld(scene) {
  const colliders = [];   // { x0, z0, x1, z1 } — full-height for movement
  const hitMeshes = [];   // meshes a bullet can strike

  // --- sky, light, fog -----------------------------------------------------
  const skyC = document.createElement('canvas');
  skyC.width = 4; skyC.height = 256;
  const sg = skyC.getContext('2d');
  const grad = sg.createLinearGradient(0, 0, 0, 256);
  grad.addColorStop(0, '#51749a'); grad.addColorStop(0.5, '#e59a58');
  grad.addColorStop(0.76, '#ffc978'); grad.addColorStop(1, '#ffe9bd');
  sg.fillStyle = grad; sg.fillRect(0, 0, 4, 256);
  const skyTex = new THREE.CanvasTexture(skyC);
  skyTex.colorSpace = THREE.SRGBColorSpace;
  const sky = new THREE.Mesh(
    new THREE.SphereGeometry(420, 24, 16),
    new THREE.MeshBasicMaterial({ map: skyTex, side: THREE.BackSide, fog: false }),
  );
  scene.add(sky);
  scene.fog = new THREE.Fog(PAL.fog, 55, 190);

  const sun = new THREE.DirectionalLight(PAL.sun, 3.1);
  sun.position.set(-55, 34, -26);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -75; sun.shadow.camera.right = 75;
  sun.shadow.camera.top = 55; sun.shadow.camera.bottom = -55;
  sun.shadow.camera.far = 220;
  sun.shadow.bias = -0.0006;
  scene.add(sun);
  scene.add(new THREE.HemisphereLight(0xffe0b0, 0x6b5a44, 1.15));

  // --- ground --------------------------------------------------------------
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(150, 110),
    mat(PAL.asphalt, 1),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);
  hitMeshes.push(ground);

  // --- helpers ---------------------------------------------------------------
  function solid(cx, cz, w, d, h, material, y = 0) {
    const m = box(w, h, d, material);
    m.position.set(cx, y + h / 2, cz);
    scene.add(m);
    hitMeshes.push(m);
    if (y === 0) colliders.push({ x0: cx - w / 2, z0: cz - d / 2, x1: cx + w / 2, z1: cz + d / 2 });
    return m;
  }
  // A shipping container: body plus a stencilled end panel; sometimes stacked.
  function container(cx, cz, vertical, color, stack = 1) {
    const w = vertical ? 2.44 : 6.06, d = vertical ? 6.06 : 2.44;
    for (let i = 0; i < stack; i++) solid(cx, cz, w, d, 2.6, mat(color, 0.75, 0.15), i * 2.6);
  }
  function crates(cx, cz, n = 3) {
    for (let i = 0; i < n; i++) {
      const s = 1.1 + (i % 2) * 0.25;
      solid(cx + (i % 2) * 1.3 - 0.6, cz + Math.floor(i / 2) * 1.3 - 0.4, s, s, s, mat(PAL.sand, 0.95), 0);
    }
    // stacked second layer on the first crate
    const top = box(1.0, 1.0, 1.0, mat(PAL.sandDark, 0.95));
    top.position.set(cx - 0.6, 1.6, cz - 0.4); scene.add(top); hitMeshes.push(top);
  }
  function barrels(cx, cz) {
    for (let i = 0; i < 3; i++) {
      const b = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.42, 1.05, 10), mat(i ? PAL.tealDark : PAL.rustDark, 0.6, 0.3));
      b.position.set(cx + (i % 2) * 0.95, 0.53, cz + Math.floor(i / 2) * 0.95);
      b.castShadow = true; scene.add(b); hitMeshes.push(b);
    }
    colliders.push({ x0: cx - 0.5, z0: cz - 0.5, x1: cx + 1.5, z1: cz + 1.5 });
  }

  // --- perimeter ------------------------------------------------------------
  solid(0, -41.5, 124, 1, 2.2, mat(PAL.slate, 0.9));
  solid(0, 41.5, 124, 1, 2.2, mat(PAL.slate, 0.9));
  solid(-59.5, 0, 1, 84, 2.2, mat(PAL.slate, 0.9));
  solid(59.5, 0, 1, 84, 2.2, mat(PAL.slate, 0.9));

  // --- dock & mid -------------------------------------------------------------
  container(-55, -9, true, PAL.rust, 2);
  container(-55, 9, true, PAL.teal, 1);
  container(-47, -17, false, PAL.slateLight, 1);
  container(-47, 17, false, PAL.sandDark, 1);
  container(-34, -7.5, false, PAL.rust, 1);
  container(-24, -7.5, false, PAL.teal, 2);
  container(-12, -7.5, true, PAL.slate, 1);
  container(0, -7.5, false, PAL.sandDark, 1);
  container(-34, 7.5, false, PAL.teal, 1);
  container(-24, 7.5, false, PAL.rust, 2);
  container(-12, 7.5, false, PAL.slateLight, 1);
  container(0, 7.5, true, PAL.rustDark, 1);
  crates(-18, 0); crates(6, -1); barrels(-28, -2); barrels(12, 3);

  // --- north lane to A ---------------------------------------------------------
  container(-2, -21, false, PAL.teal, 1);
  container(10, -27, true, PAL.rust, 2);
  container(20, -13, false, PAL.sandDark, 1);
  crates(16, -22);

  // --- site A: crane yard -------------------------------------------------------
  container(27, -31, false, PAL.slate, 1);
  container(49, -31, false, PAL.rust, 2);
  container(49, -13, true, PAL.teal, 1);
  crates(29, -14); barrels(44, -27);
  // Gantry crane over the site: legs, beam, cab and a hanging hook block.
  const craneMat = mat(PAL.slate, 0.6, 0.35);
  solid(31, -33, 1, 1, 13, craneMat); solid(45, -33, 1, 1, 13, craneMat);
  const beam = box(17, 1.1, 1.4, mat(PAL.rust, 0.6, 0.3)); beam.position.set(38, 13.4, -33); scene.add(beam); hitMeshes.push(beam);
  const jib = box(1.1, 0.9, 12, mat(PAL.rust, 0.6, 0.3)); jib.position.set(38, 13.2, -27.5); scene.add(jib); hitMeshes.push(jib);
  const cable = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 5.5, 6), mat(PAL.slate, 0.5, 0.5));
  cable.position.set(38, 10.2, -24); scene.add(cable);
  const hook = box(1.4, 1.1, 1.4, mat(PAL.rustDark, 0.6, 0.3)); hook.position.set(38, 7.2, -24); scene.add(hook); hitMeshes.push(hook);

  // --- south lane & site B: the depot -------------------------------------------
  container(-36, 27, false, PAL.slate, 1);
  container(-22, 33, true, PAL.rust, 2);
  container(-8, 27, false, PAL.teal, 1);
  crates(4, 33); barrels(-16, 22);
  // Warehouse walls around B with two door gaps (north and east).
  const wall = mat(PAL.sandDark, 0.9);
  solid(29.5, 12.5, 13, 1, 4.2, wall); solid(45.5, 12.5, 11, 1, 4.2, wall);
  solid(52, 19, 1, 12, 4.2, wall); solid(52, 30.5, 1, 9, 4.2, wall);
  solid(38, 34.5, 29, 1, 4.2, wall); solid(24.5, 23, 1, 24, 4.2, wall);
  const roof = box(29, 0.3, 24, mat(PAL.slate, 0.8, 0.2)); roof.position.set(38, 5.4, 23); scene.add(roof); hitMeshes.push(roof);
  container(40, 27, false, PAL.teal, 1);
  crates(31, 20); barrels(46, 31);

  // --- east edge & lamps ----------------------------------------------------------
  container(56, -6, true, PAL.slateLight, 2);
  container(56, 8, true, PAL.rust, 1);
  const lampMat = new THREE.MeshStandardMaterial({ color: 0x554433, emissive: 0xffa640, emissiveIntensity: 1.6 });
  for (const [lx, lz] of [[-40, -3], [-4, 4], [18, -18], [18, 18], [-30, 21], [50, -22]]) {
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.12, 5.4, 6), mat(PAL.slate, 0.6, 0.4));
    pole.position.set(lx, 2.7, lz); pole.castShadow = true; scene.add(pole); hitMeshes.push(pole);
    const head = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.18, 0.3), lampMat);
    head.position.set(lx, 5.45, lz); scene.add(head);
    colliders.push({ x0: lx - 0.16, z0: lz - 0.16, x1: lx + 0.16, z1: lz + 0.16 });
  }

  // --- sites: painted rings + letters ----------------------------------------------
  const sites = {
    A: { x: 38, z: -22, r: 9, name: 'Crane Yard' },
    B: { x: 38, z: 22, r: 9, name: 'Depot' },
  };
  for (const key of ['A', 'B']) {
    const st = sites[key];
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(st.r - 0.55, st.r, 40),
      new THREE.MeshBasicMaterial({ color: key === 'A' ? PAL.rust : PAL.teal, transparent: true, opacity: 0.85 }),
    );
    ring.rotation.x = -Math.PI / 2; ring.position.set(st.x, 0.03, st.z); scene.add(ring);
    const letter = new THREE.Mesh(
      new THREE.PlaneGeometry(5, 5),
      new THREE.MeshBasicMaterial({ map: textTexture(key, key === 'A' ? '#c65a21' : '#1f8a80', null), transparent: true, opacity: 0.9 }),
    );
    letter.rotation.x = -Math.PI / 2; letter.position.set(st.x, 0.04, st.z); scene.add(letter);
  }

  // Lane paint: worn guide lines on the asphalt.
  const paint = mat(PAL.cream, 1);
  for (const [px, pz, w, d] of [[-26, 0, 44, 0.35], [8, -14, 0.35, 20], [-20, 25.5, 40, 0.35], [10, 16, 0.35, 16]]) {
    const line = new THREE.Mesh(new THREE.PlaneGeometry(w, d), paint);
    line.rotation.x = -Math.PI / 2; line.position.set(px, 0.02, pz); scene.add(line);
  }

  // --- the Charge prop (rounds.js moves it) -----------------------------------------
  const chargeMesh = new THREE.Group();
  const cbody = box(0.52, 0.34, 0.2, mat(PAL.slate, 0.5, 0.4)); cbody.castShadow = true;
  const clight = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.06, 0.05),
    new THREE.MeshStandardMaterial({ color: 0x220000, emissive: 0xff2211, emissiveIntensity: 2 }));
  clight.position.set(0, 0.2, 0.08);
  chargeMesh.add(cbody, clight);
  chargeMesh.visible = false;
  scene.add(chargeMesh);

  // --- navigation graph ----------------------------------------------------------------
  const nodes = [
    [-52, 0], [-44, -13], [-44, 13], [-30, 0], [-16, 0], [2, 0], [-8, -16], [12, -20],
    [24, -20], [36, -22], [46, -27], [-30, 24], [-12, 27], [14, 25], [34, 23], [45, 28],
    [8, 12], [12, -8], [30, -29], [30, 17],
  ].map(([x, z], i) => ({ i, x, z, next: [] }));
  const edges = [[0, 1], [0, 2], [0, 3], [1, 6], [2, 3], [2, 11], [3, 4], [4, 5], [4, 6],
    [5, 16], [5, 17], [6, 7], [7, 8], [7, 17], [8, 9], [8, 18], [9, 10], [9, 18],
    [11, 12], [12, 13], [12, 16], [13, 14], [13, 19], [14, 15], [14, 19], [16, 13], [17, 7]];
  for (const [a, b] of edges) { nodes[a].next.push(nodes[b]); nodes[b].next.push(nodes[a]); }

  const spawns = {
    jackals: [{ x: -53, z: -4 }, { x: -51, z: 3 }, { x: -54, z: 1 }, { x: -50, z: -2 }],
    player: { x: -52, z: 5 },
    wardensA: [{ x: 34, z: -26 }, { x: 43, z: -19 }, { x: 30, z: -16 }],
    wardensB: [{ x: 35, z: 18 }, { x: 43, z: 26 }],
    holdA: [{ x: 36, z: -27, face: -2.4 }, { x: 42, z: -18, face: 2.6 }, { x: 30, z: -18, face: -0.6 }],
    holdB: [{ x: 34, z: 18, face: 0.6 }, { x: 42, z: 27, face: -2.8 }],
  };

  return { colliders, hitMeshes, sites, nodes, spawns, chargeMesh, clight };
}

// Resolve a circle (x, z, r) out of every AABB collider and the map bounds.
// Mutates and returns the passed {x, z} object — no allocation.
export function collide(world, p, r) {
  if (p.x < -BOUNDS.x + r) p.x = -BOUNDS.x + r;
  if (p.x > BOUNDS.x - r) p.x = BOUNDS.x - r;
  if (p.z < -BOUNDS.z + r) p.z = -BOUNDS.z + r;
  if (p.z > BOUNDS.z - r) p.z = BOUNDS.z - r;
  for (const c of world.colliders) {
    if (p.x > c.x0 - r && p.x < c.x1 + r && p.z > c.z0 - r && p.z < c.z1 + r) {
      const dxl = p.x - (c.x0 - r), dxr = (c.x1 + r) - p.x;
      const dzl = p.z - (c.z0 - r), dzr = (c.z1 + r) - p.z;
      const m = Math.min(dxl, dxr, dzl, dzr);
      if (m === dxl) p.x = c.x0 - r; else if (m === dxr) p.x = c.x1 + r;
      else if (m === dzl) p.z = c.z0 - r; else p.z = c.z1 + r;
    }
  }
  return p;
}
