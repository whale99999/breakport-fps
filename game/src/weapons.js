// weapons.js — the weapon table (shared with bots.js so both sides use the
// same numbers), the player's view models, hitscan shooting with spread and
// recoil that punish movement, reloading, and the Breaker frag grenade with
// its area explosion. Zone multipliers live here: head x4, torso x1, legs
// x0.75; armour is applied by the victim's damage function.
import * as THREE from 'three';
import { S } from './state.js';
import { mat } from './palette.js';
import { sfxShot, sfxDry, sfxReload, sfxSwing, sfxBounce, sfxExplosion } from './audio.js';
import { muzzleFlashTexture } from './textures.js';

export const ZONE_MULT = { head: 4, torso: 1, legs: 0.75 };

export const WEAPONS = {
  knife:   { name: 'Mako',       slot: 3, price: 0,    dmg: 55, rpm: 80,  auto: false, mag: 0,  reserve: 0,  reload: 0,   spread: 0,    kick: 0,     kind: 'knife',  range: 1.7 },
  sable:   { name: 'P9 Sable',   slot: 2, price: 300,  dmg: 26, rpm: 380, auto: false, mag: 12, reserve: 48, reload: 1.4, spread: 0.85, kick: 0.012, kind: 'pistol', fall: [26, 60, 0.55] },
  vyper:   { name: 'Vyper-9',    slot: 1, price: 1200, dmg: 22, rpm: 750, auto: true,  mag: 30, reserve: 90, reload: 2.0, spread: 1.5,  kick: 0.008, kind: 'smg',    fall: [14, 38, 0.4] },
  kestrel: { name: 'Kestrel AR', slot: 1, price: 2700, dmg: 33, rpm: 600, auto: true,  mag: 30, reserve: 90, reload: 2.2, spread: 1.0,  kick: 0.011, kind: 'rifle',  fall: [30, 72, 0.75] },
  heron:   { name: 'Heron LR',   slot: 1, price: 4300, dmg: 98, rpm: 42,  auto: false, mag: 5,  reserve: 30, reload: 2.9, spread: 0.1,  kick: 0.05,  kind: 'sniper', fall: [60, 120, 0.9], scope: true },
};

// Damage after distance falloff: fall is [fullUntil, zeroAt, minFactor].
export function falloff(w, dist) {
  if (!w.fall) return 1;
  const [a, b, m] = w.fall;
  if (dist <= a) return 1;
  if (dist >= b) return m;
  return 1 - (1 - m) * ((dist - a) / (b - a));
}

// Transient effects hud.js reads (hitmarker timing).
export const FX = { hitT: -9, hitHead: false };

const _origin = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _right = new THREE.Vector3();
const _up = new THREE.Vector3();
const _target = new THREE.Vector3();
const _ray = new THREE.Raycaster();

export function createWeapons(camera, scene, input, player) {
  const load = player.loadout;

  // --- view models: one small group per weapon, toggled on switch -----------
  const holder = new THREE.Group();
  camera.add(holder);
  // a soft fill light riding the camera so the held weapon reads at any angle
  const fill = new THREE.PointLight(0xffe0b8, 0.85, 0, 2);
  fill.position.set(0.05, 0.12, 0.15);
  camera.add(fill);
  const models = {};
  function vm(key, build) {
    const g = new THREE.Group();
    g.position.set(0.24, -0.205, -0.40);
    g.rotation.y = -0.10; // three-quarter hold: the top rail and the left side read
    build(g);
    g.visible = false;
    holder.add(g);
    models[key] = g;
  }
  const dark = mat(0x2c2f33, 0.5, 0.5), mid = mat(0x4a4f55, 0.45, 0.55), accent = mat(0xc65a21, 0.5, 0.3);
  const violet = mat(0x4516b0, 0.45, 0.2); // the Kestrel's signature finish (deep violet; kept saturated by the gentler camera fill light)
  function part(g, w, h, d, m, x, y, z) { const p = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m); p.position.set(x, y, z); g.add(p); return p; }
  function tube(g, r, len, m, x, y, z) { const p = new THREE.Mesh(new THREE.CylinderGeometry(r, r, len, 10), m); p.rotation.x = Math.PI / 2; p.position.set(x, y, z); g.add(p); return p; }
  // Picatinny rail: a base strip with evenly spaced teeth — the one detail
  // that makes a slab read as a tactical rifle at screenshot distance.
  function rail(g, y, z0, z1, m) {
    part(g, 0.034, 0.016, z0 - z1, m, 0, y, (z0 + z1) / 2);
    for (let z = z1 + 0.022; z < z0; z += 0.045) part(g, 0.04, 0.02, 0.02, m, 0, y + 0.015, z);
  }
  // Ring optic: a torus you can see through, a mount post, a tinted lens.
  function optic(g, y, z, r) {
    const ring = new THREE.Mesh(new THREE.TorusGeometry(r, Math.max(0.008, r * 0.26), 8, 22), dark);
    ring.position.set(0, y, z); g.add(ring);
    const h = Math.max(0.02, y - 0.082);
    part(g, 0.018, h, 0.026, dark, 0, 0.082 + h / 2, z);
    const lens = new THREE.Mesh(new THREE.CircleGeometry(r * 0.82, 20),
      new THREE.MeshStandardMaterial({ color: 0x0d2b2e, emissive: 0x1f8a80, emissiveIntensity: 0.7, roughness: 0.15, metalness: 0.1, transparent: true, opacity: 0.85 }));
    lens.position.set(0, y, z + 0.004); g.add(lens);
  }
  // Each view model is assembled from real parts — receiver, barrel, magazine,
  // stock, sights, rail — so the gun in hand reads as a gun, not a slab.
  vm('knife', (g) => {
    part(g, 0.032, 0.095, 0.17, dark, 0, 0, -0.04);                    // grip
    part(g, 0.075, 0.018, 0.03, accent, 0, 0.012, -0.135);            // crossguard
    part(g, 0.014, 0.055, 0.3, mid, 0, 0.028, -0.3);                  // blade
  });
  vm('sable', (g) => {
    part(g, 0.05, 0.09, 0.26, dark, 0, -0.012, -0.1);                 // frame
    part(g, 0.046, 0.05, 0.27, mid, 0, 0.056, -0.11);                 // slide
    for (let i = 0; i < 4; i++) part(g, 0.048, 0.052, 0.009, dark, 0, 0.056, -0.005 - i * 0.02); // slide serrations
    const grip = part(g, 0.045, 0.13, 0.07, dark, 0, -0.1, 0.005); grip.rotation.x = 0.22;
    part(g, 0.008, 0.032, 0.008, dark, 0, 0.096, -0.225);             // front post
    part(g, 0.032, 0.026, 0.012, dark, 0, 0.092, 0.005);              // rear sight
    part(g, 0.03, 0.03, 0.035, mid, 0, 0.01, -0.245);                 // muzzle
  });
  vm('vyper', (g) => {
    part(g, 0.055, 0.115, 0.42, dark, 0, 0, -0.13);                   // receiver
    part(g, 0.05, 0.08, 0.2, mid, 0, 0.004, -0.42);                   // shroud
    tube(g, 0.016, 0.13, mid, 0, 0.012, -0.57);                       // barrel
    const mag = part(g, 0.04, 0.17, 0.075, mid, 0, -0.135, -0.12); mag.rotation.x = 0.16;
    part(g, 0.045, 0.08, 0.16, dark, 0, 0.008, 0.13);                 // stock
    rail(g, 0.068, 0.05, -0.52, dark);                                // top rail with teeth
    optic(g, 0.118, -0.18, 0.038);                                    // ring red-dot
    part(g, 0.008, 0.04, 0.008, dark, 0, 0.075, -0.48);               // front post
    part(g, 0.058, 0.03, 0.12, accent, 0, -0.02, -0.22);              // accent stripe
  });
  vm('kestrel', (g) => {
    part(g, 0.06, 0.115, 0.52, violet, 0, 0, -0.16);                  // receiver, signature violet
    part(g, 0.066, 0.10, 0.30, violet, 0, 0.002, -0.47);              // chunky handguard
    part(g, 0.068, 0.028, 0.26, dark, 0, -0.048, -0.47);              // under-rail shadow line
    for (const sx of [-1, 1]) for (let i = 0; i < 3; i++)             // handguard vent slots
      part(g, 0.002, 0.02, 0.05, dark, sx * 0.034, 0.02, -0.36 - i * 0.09);
    tube(g, 0.016, 0.14, dark, 0, 0.008, -0.66);                      // barrel
    tube(g, 0.03, 0.15, dark, 0, 0.008, -0.79);                       // suppressor can
    part(g, 0.02, 0.05, 0.06, dark, -0.031, 0.01, -0.13);             // ejection port, left face
    part(g, 0.03, 0.02, 0.02, mid, 0.032, 0.03, 0.02);                // charging-handle wing
    const mag = part(g, 0.044, 0.17, 0.085, dark, 0, -0.135, -0.17); mag.rotation.x = 0.18;
    const grip = part(g, 0.042, 0.115, 0.06, dark, 0, -0.105, 0.04); grip.rotation.x = 0.32;
    part(g, 0.052, 0.095, 0.19, dark, 0, -0.002, 0.16);               // stock
    part(g, 0.054, 0.03, 0.12, violet, 0, 0.055, 0.17);               // cheek riser, violet
    rail(g, 0.068, 0.08, -0.60, dark);                                // full-length top rail
    optic(g, 0.125, -0.20, 0.045);                                    // ring red-dot
    part(g, 0.008, 0.04, 0.008, dark, 0, 0.075, -0.58);               // front post
  });
  vm('heron', (g) => {
    part(g, 0.052, 0.105, 0.6, dark, 0, 0, -0.2);                     // receiver
    tube(g, 0.02, 0.34, mid, 0, 0.01, -0.64);                         // heavy barrel
    tube(g, 0.03, 0.07, dark, 0, 0.01, -0.82);                        // muzzle brake
    tube(g, 0.026, 0.3, dark, 0, 0.108, -0.2);                        // scope tube
    tube(g, 0.037, 0.07, dark, 0, 0.108, -0.335);                     // objective bell
    tube(g, 0.032, 0.05, dark, 0, 0.108, -0.055);                     // eyepiece
    const eyeLens = new THREE.Mesh(new THREE.CircleGeometry(0.024, 18),
      new THREE.MeshStandardMaterial({ color: 0x0d2b2e, emissive: 0x1f8a80, emissiveIntensity: 0.8, roughness: 0.15, metalness: 0.1 }));
    eyeLens.position.set(0, 0.108, -0.029); g.add(eyeLens);           // glass the player looks into
    const objLens = eyeLens.clone(); objLens.rotation.y = Math.PI;
    objLens.position.set(0, 0.108, -0.371); g.add(objLens);
    rail(g, 0.062, 0.05, -0.45, dark);                                // rail under the scope
    part(g, 0.02, 0.05, 0.03, mid, 0, 0.062, -0.28);                  // scope mounts
    part(g, 0.02, 0.05, 0.03, mid, 0, 0.062, -0.12);
    part(g, 0.05, 0.1, 0.3, mid, 0, -0.012, 0.17);                    // stock
    part(g, 0.052, 0.05, 0.16, dark, 0, 0.052, 0.19);                 // cheek rest
    part(g, 0.04, 0.09, 0.07, mid, 0, -0.095, -0.18);                 // magazine
    part(g, 0.05, 0.02, 0.02, mid, 0.045, 0.032, -0.02);              // bolt handle
    const bl = part(g, 0.012, 0.17, 0.012, dark, -0.055, -0.09, -0.52); bl.rotation.z = 0.35; bl.rotation.x = 0.4;
    const br = part(g, 0.012, 0.17, 0.012, dark, 0.055, -0.09, -0.52); br.rotation.z = -0.35; br.rotation.x = 0.4;
  });
  const grenadeModel = new THREE.Group();
  const gball = new THREE.Mesh(new THREE.SphereGeometry(0.055, 10, 8), mat(0x3d4756, 0.5, 0.4));
  grenadeModel.add(gball); grenadeModel.position.set(0.24, -0.2, -0.4); grenadeModel.visible = false;
  holder.add(grenadeModel);
  const flash = new THREE.Mesh(new THREE.PlaneGeometry(0.34, 0.34),
    new THREE.MeshBasicMaterial({ map: muzzleFlashTexture(), color: 0xffe9bb, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false }));
  holder.add(flash);
  // Muzzle tips in each view model's LOCAL space. anchorFlash() converts
  // through the group's world matrix, so the flash stays glued to the barrel
  // tip however the group is posed (the three-quarter hold included).
  const MUZZLE_LOCAL = {
    sable: [0, 0.01, -0.27], vyper: [0, 0.012, -0.65],
    kestrel: [0, 0.008, -0.88], heron: [0, 0.01, -0.87],
  };
  const _mv = new THREE.Vector3();
  function anchorFlash() {
    const ml = MUZZLE_LOCAL[load.current], g = models[load.current];
    if (!ml || !g) return;
    camera.updateMatrixWorld(true);
    _mv.set(ml[0], ml[1], ml[2]);
    g.localToWorld(_mv);
    holder.worldToLocal(_mv);
    flash.position.copy(_mv);
  }

  // --- tracers + impacts: small pools, reused, no per-shot allocation -------
  const tracerMat = new THREE.LineBasicMaterial({ color: 0xffd9a0, transparent: true, opacity: 0 });
  const tracers = [];
  for (let i = 0; i < 8; i++) {
    const geo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]);
    const line = new THREE.Line(geo, tracerMat.clone());
    line.visible = false; line.frustumCulled = false;
    scene.add(line);
    tracers.push({ line, until: 0 });
  }
  let tracerAt = 0;
  function tracer(from, to) {
    const t = tracers[tracerAt++ % tracers.length];
    const p = t.line.geometry.attributes.position;
    p.setXYZ(0, from.x, from.y, from.z); p.setXYZ(1, to.x, to.y, to.z);
    p.needsUpdate = true;
    t.line.visible = true; t.line.material.opacity = 0.75;
    t.until = S.time + 0.055;
  }

  // --- muzzle light + impact sparks: one pooled light, one pooled Points ---
  const flashLight = new THREE.PointLight(0xffb35c, 0, 10, 1.7);
  scene.add(flashLight);
  let flashLightUntil = -9;
  const SPARKS = 240;
  const sparkPos = new Float32Array(SPARKS * 3);
  const sparkVel = new Float32Array(SPARKS * 3);
  const sparkLife = new Float32Array(SPARKS);
  for (let i = 0; i < SPARKS; i++) sparkPos[i * 3 + 1] = -999;
  const sparkGeo = new THREE.BufferGeometry();
  sparkGeo.setAttribute('position', new THREE.BufferAttribute(sparkPos, 3));
  const sparkPts = new THREE.Points(sparkGeo, new THREE.PointsMaterial({
    color: 0xffc37a, size: 0.085, transparent: true, opacity: 0.95,
    blending: THREE.AdditiveBlending, depthWrite: false, sizeAttenuation: true,
  }));
  sparkPts.frustumCulled = false;
  scene.add(sparkPts);
  let sparkAt = 0;
  function spawnSparks(x, y, z, n, spread = 2.6, up = 2.2) {
    for (let k = 0; k < n; k++) {
      const i = sparkAt++ % SPARKS, j = i * 3;
      sparkPos[j] = x; sparkPos[j + 1] = y; sparkPos[j + 2] = z;
      sparkVel[j] = (Math.random() * 2 - 1) * spread;
      sparkVel[j + 1] = Math.random() * up;
      sparkVel[j + 2] = (Math.random() * 2 - 1) * spread;
      sparkLife[i] = 0.22 + Math.random() * 0.25;
    }
  }
  function tickSparks(dt) {
    let any = false;
    for (let i = 0; i < SPARKS; i++) {
      if (sparkLife[i] <= 0) continue;
      any = true;
      sparkLife[i] -= dt;
      const j = i * 3;
      if (sparkLife[i] <= 0) { sparkPos[j + 1] = -999; continue; }
      sparkVel[j + 1] -= 12 * dt;
      sparkPos[j] += sparkVel[j] * dt;
      sparkPos[j + 1] += sparkVel[j + 1] * dt;
      sparkPos[j + 2] += sparkVel[j + 2] * dt;
      if (sparkPos[j + 1] < 0.02) { sparkPos[j + 1] = 0.02; sparkVel[j + 1] *= -0.4; }
    }
    if (any) sparkGeo.attributes.position.needsUpdate = true;
  }

  // --- grenades ----------------------------------------------------------------
  const grenades = [];
  const gGeo = new THREE.SphereGeometry(0.07, 10, 8);
  const gMat = mat(0x3d4756, 0.5, 0.4);
  function throwGrenade(from, dir, owner) {
    const mesh = new THREE.Mesh(gGeo, gMat);
    mesh.position.copy(from);
    scene.add(mesh);
    grenades.push({ mesh, vx: dir.x * 15, vy: dir.y * 15 + 4.5, vz: dir.z * 15, fuse: 1.9, owner, bounced: false });
  }

  // Area damage with a cover check; also the Charge's detonation path.
  function explodeAt(x, y, z, radius, maxDmg, owner) {
    sfxExplosion(player.pos ? Math.hypot(player.pos.x - x, player.pos.z - z) : 0);
    spawnSparks(x, y + 0.3, z, 26, 4.5, 3.5);
    S.shake = Math.min(0.6, S.shake + Math.max(0, 1 - Math.hypot(player.pos.x - x, player.pos.z - z) / 16) * 0.5);
    const flashLight = new THREE.PointLight(0xffa050, 60, radius * 3, 1.6);
    flashLight.position.set(x, y + 0.5, z);
    scene.add(flashLight);
    setTimeout(() => scene.remove(flashLight), 90);
    const targets = [];
    if (owner !== 'player') targets.push({ kind: 'player' });
    for (const b of S.bots) if (b.alive && !(owner === b)) targets.push({ kind: 'bot', bot: b });
    for (const tg of targets) {
      const tp = tg.kind === 'player' ? player.pos : tg.bot.pos;
      const d = Math.hypot(tp.x - x, tp.z - z);
      if (d > radius) continue;
      let dmg = maxDmg * (1 - (d / radius) * 0.75);
      _origin.set(x, y, z); _target.set(tp.x, 1.1, tp.z); _dir.copy(_target).sub(_origin);
      const dist = _dir.length(); _dir.normalize();
      _ray.set(_origin, _dir); _ray.far = dist;
      if (_ray.intersectObjects(S.world.hitMeshes, false).length) dmg *= 0.25; // cover soaks most of it
      if (tg.kind === 'player') S.refs.damagePlayer(dmg, owner);
      else S.refs.damageBot(tg.bot, dmg, 'torso', owner);
    }
  }
  S.refs.explodeAt = explodeAt;

  // --- firing ---------------------------------------------------------------------
  let cooldown = 0, reloadT = 0, reloadKey = null, prevFiring = false, bloom = 0;
  const hitList = [];

  function startReload(key) {
    reloadKey = key;
    reloadT = WEAPONS[key].reload;
    sfxReload(0);
  }
  function completeReload() {
    const w = WEAPONS[reloadKey], st = load.state[reloadKey];
    const take = Math.min(w.mag - st.mag, st.reserve);
    st.mag += take; st.reserve -= take;
    reloadKey = null;
  };

  function currentSpread(w) {
    const speed = Math.hypot(player.vel.x, player.vel.z);
    let f = 1;
    if (!player.grounded) f = 3.4;
    else if (speed > 0.6) f = 1 + speed * 0.38;
    if (player.crouching && player.grounded) f *= 0.5;
    if (player.zoomed) f *= 0.15;
    return (w.spread + bloom) * f;
  }

  function shoot(w, st) {
    st.mag -= 1;
    bloom = Math.min(2.6, bloom + w.spread * 0.55);
    player.recoil += w.kick;
    player.recoilYaw += (Math.random() - 0.5) * w.kick * 0.6;
    flash.material.opacity = 0.95;
    flash.rotation.z = Math.random() * Math.PI;
    sfxShot(w.kind, 0);
    S.noise = { x: player.pos.x, z: player.pos.z, t: S.time, team: player.team };
    camera.getWorldPosition(_origin);
    camera.getWorldDirection(_dir);
    // the pooled muzzle light rides this shot for a few dozen milliseconds
    flashLight.position.set(_origin.x + _dir.x * 0.8, _origin.y - 0.04, _origin.z + _dir.z * 0.8);
    flashLight.intensity = 30;
    flashLightUntil = S.time + 0.05;
    _right.crossVectors(_dir, camera.up).normalize();
    _up.crossVectors(_right, _dir).normalize();
    const sp = currentSpread(w) * Math.PI / 180;
    _dir.addScaledVector(_right, (Math.random() * 2 - 1) * sp)
        .addScaledVector(_up, (Math.random() * 2 - 1) * sp).normalize();
    _ray.set(_origin, _dir); _ray.far = 220;
    hitList.length = 0;
    for (const m of S.world.hitMeshes) hitList.push(m);
    for (const b of S.bots) if (b.alive) for (const m of b.hitMeshes) hitList.push(m);
    const hits = _ray.intersectObjects(hitList, false);
    _target.copy(_dir).multiplyScalar(120).add(_origin);
    if (hits.length) {
      const h = hits[0];
      _target.copy(h.point);
      const ud = h.object.userData;
      spawnSparks(h.point.x, h.point.y, h.point.z, ud && ud.bot ? 7 : 11);
      if (ud && ud.bot && ud.bot.alive) {
        const dmg = w.dmg * ZONE_MULT[ud.zone] * falloff(w, h.distance);
        S.refs.damageBot(ud.bot, dmg, ud.zone, 'player');
        FX.hitT = S.time; FX.hitHead = ud.zone === 'head';
      }
    }
    _origin.y -= 0.12; _origin.addScaledVector(_dir, 0.4);
    tracer(_origin, _target);
  }

  function swingKnife() {
    sfxSwing(0);
    camera.getWorldPosition(_origin);
    camera.getWorldDirection(_dir);
    _ray.set(_origin, _dir); _ray.far = WEAPONS.knife.range;
    hitList.length = 0;
    for (const b of S.bots) if (b.alive) for (const m of b.hitMeshes) hitList.push(m);
    const hits = _ray.intersectObjects(hitList, false);
    if (hits.length) {
      const ud = hits[0].object.userData;
      S.refs.damageBot(ud.bot, WEAPONS.knife.dmg * ZONE_MULT[ud.zone], ud.zone, 'player');
      FX.hitT = S.time; FX.hitHead = ud.zone === 'head';
    }
  }

  function switchTo(slot) {
    const key = slot === 4 ? 'grenade' : load.bySlot[slot];
    if (!key || key === load.current) return;
    if (key !== 'grenade' && !load.owned[key]) return;
    if (key === 'grenade' && load.grenades <= 0) return;
    load.current = key;
    reloadT = 0; reloadKey = null;
    refreshModels();
  }
  function refreshModels() {
    for (const k in models) models[k].visible = k === load.current;
    grenadeModel.visible = load.current === 'grenade';
    anchorFlash();
    holder.position.z = player.zoomed ? 0.4 : 0; // hide the view model in scope
  }

  function doThrow() {
    if (load.grenades <= 0) return;
    load.grenades -= 1;
    camera.getWorldPosition(_origin);
    camera.getWorldDirection(_dir);
    _origin.addScaledVector(_dir, 0.5); _origin.y -= 0.05;
    throwGrenade(_origin.clone(), _dir.clone(), 'player');
    if (load.grenades <= 0) { load.current = load.bySlot[1] || 'sable'; }
    refreshModels();
  }

  // --- per-step update ----------------------------------------------------------------
  function update(dt) {
    cooldown -= dt;
    bloom = Math.max(0, bloom - dt * 2.2);
    if (reloadT > 0) { reloadT -= dt; if (reloadT <= 0) completeReload(); }
    flash.material.opacity = Math.max(0, flash.material.opacity - dt * 16);
    if (flashLight.intensity > 0 && S.time > flashLightUntil) flashLight.intensity = 0;
    tickSparks(dt);
    for (const t of tracers) if (t.line.visible && S.time > t.until) t.line.visible = false;

    // grenade physics: gravity, ground bounce, AABB bounce, fuse
    for (let i = grenades.length - 1; i >= 0; i--) {
      const g = grenades[i];
      g.fuse -= dt;
      g.vy -= 18 * dt;
      const p = g.mesh.position;
      p.x += g.vx * dt; p.y += g.vy * dt; p.z += g.vz * dt;
      if (p.y < 0.08) { p.y = 0.08; if (Math.abs(g.vy) > 1.4) sfxBounce(player.pos ? Math.hypot(player.pos.x - p.x, player.pos.z - p.z) : 0); g.vy *= -0.42; g.vx *= 0.72; g.vz *= 0.72; g.bounced = true; }
      for (const c of S.world.colliders) {
        if (p.x > c.x0 - 0.08 && p.x < c.x1 + 0.08 && p.z > c.z0 - 0.08 && p.z < c.z1 + 0.08 && p.y < 2.7) {
          const dxl = p.x - (c.x0 - 0.08), dxr = (c.x1 + 0.08) - p.x, dzl = p.z - (c.z0 - 0.08), dzr = (c.z1 + 0.08) - p.z;
          const m = Math.min(dxl, dxr, dzl, dzr);
          if (m === dxl) { p.x = c.x0 - 0.08; g.vx = -Math.abs(g.vx) * 0.45; }
          else if (m === dxr) { p.x = c.x1 + 0.08; g.vx = Math.abs(g.vx) * 0.45; }
          else if (m === dzl) { p.z = c.z0 - 0.08; g.vz = -Math.abs(g.vz) * 0.45; }
          else { p.z = c.z1 + 0.08; g.vz = Math.abs(g.vz) * 0.45; }
          if (!g.bounced) { sfxBounce(player.pos ? Math.hypot(player.pos.x - p.x, player.pos.z - p.z) : 0); g.bounced = true; }
        }
      }
      if (g.fuse <= 0) {
        explodeAt(p.x, Math.max(0.4, p.y), p.z, 5.2, 92, g.owner);
        scene.remove(g.mesh);
        grenades.splice(i, 1);
      }
    }

    if (!player.alive || S.phase === 'buy' || S.phase === 'idle' || S.phase === 'matchover' || S.phase === 'end') { prevFiring = input.firing; return; }

    // weapon switching
    if (input.pressed.has('Digit1')) switchTo(1);
    if (input.pressed.has('Digit2')) switchTo(2);
    if (input.pressed.has('Digit3')) switchTo(3);
    if (input.pressed.has('Digit4')) switchTo(4);
    if (input.wheel !== 0) {
      const slots = [1, 2, 3, 4].filter((sl) => sl === 4 ? load.grenades > 0 : !!load.bySlot[sl]);
      const cur = load.current === 'grenade' ? 4 : WEAPONS[load.current].slot;
      let idx = slots.indexOf(cur);
      idx = (idx + (input.wheel > 0 ? 1 : slots.length - 1)) % slots.length;
      switchTo(slots[idx]);
      input.wheel = 0;
    }
    if (input.pressed.has('KeyG') && load.current !== 'grenade' && load.grenades > 0) doThrow();

    const key = load.current;
    if (key === 'grenade') {
      if (input.firing && !prevFiring) doThrow();
      prevFiring = input.firing;
      return;
    }
    const w = WEAPONS[key];
    const st = load.state[key];

    // scope for the Heron
    const wantZoom = !!w.scope && input.aiming;
    if (wantZoom !== player.zoomed) { player.zoomed = wantZoom; refreshModels(); }

    if (reloadT > 0) { prevFiring = input.firing; return; }
    if (input.pressed.has('KeyR') && st.mag < w.mag && st.reserve > 0) startReload(key);

    const trigger = w.auto ? input.firing : (input.firing && !prevFiring);
    if (trigger && cooldown <= 0) {
      if (w.kind === 'knife') { cooldown = 60 / w.rpm; swingKnife(); }
      else if (st.mag <= 0) {
        cooldown = 0.3;
        if (st.reserve > 0) startReload(key); else sfxDry(0);
      } else { cooldown = 60 / w.rpm; shoot(w, st); }
    }
    prevFiring = input.firing;
  }

  // Freeze-frame effects for ?shot=play: muzzle flash lit, a tracer on its way
  // to the target, sparks already bursting off it — set after the last sim
  // step, so nothing decays before the capture renders.
  function poseShotFx(tx, ty, tz) {
    anchorFlash(); // matrices are fresh after the sim steps: re-glue the flash
    camera.getWorldPosition(_origin);
    camera.getWorldDirection(_dir);
    flash.material.opacity = 1;
    flash.rotation.z = 0.6;
    flashLight.position.set(_origin.x + _dir.x * 0.8, _origin.y - 0.04, _origin.z + _dir.z * 0.8);
    flashLight.intensity = 5; // the posed frame holds this light forever: at full strength its warm blast washes the held weapon pink, while the additive flash sprite still blooms on its own
    _target.set(tx, ty, tz);
    _origin.y -= 0.12; _origin.addScaledVector(_dir, 0.4);
    tracer(_origin, _target);
    spawnSparks(tx, ty, tz, 12, 2.2, 1.8);
  }

  refreshModels();
  return { update, switchTo, refreshModels, throwGrenade, explodeAt, poseShotFx, currentSpreadOf: () => {
    const w = WEAPONS[load.current];
    return w ? currentSpread(w) : 0;
  } };
}
