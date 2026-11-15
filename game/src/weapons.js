// weapons.js — the weapon table (shared with bots.js so both sides use the
// same numbers), the player's view models, hitscan shooting with spread and
// recoil that punish movement, reloading, and the Breaker frag grenade with
// its area explosion. Zone multipliers live here: head x4, torso x1, legs
// x0.75; armour is applied by the victim's damage function.
import * as THREE from 'three';
import { S } from './state.js';
import { mat } from './palette.js';
import { sfxShot, sfxDry, sfxReload, sfxSwing, sfxBounce, sfxExplosion } from './audio.js';

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
  const fill = new THREE.PointLight(0xffe0b8, 1.7, 0, 2);
  fill.position.set(0.05, 0.12, 0.15);
  camera.add(fill);
  const models = {};
  function vm(key, build) {
    const g = new THREE.Group();
    g.position.set(0.26, -0.22, -0.45);
    build(g);
    g.visible = false;
    holder.add(g);
    models[key] = g;
  }
  const dark = mat(0x2c2f33, 0.5, 0.5), mid = mat(0x4a4f55, 0.45, 0.55), accent = mat(0xc65a21, 0.5, 0.3);
  function part(g, w, h, d, m, x, y, z) { const p = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m); p.position.set(x, y, z); g.add(p); return p; }
  vm('knife', (g) => { part(g, 0.03, 0.09, 0.16, dark, 0, 0, -0.05); part(g, 0.012, 0.05, 0.3, mid, 0, 0.03, -0.3); });
  vm('sable', (g) => { part(g, 0.05, 0.11, 0.24, dark, 0, 0, -0.08); part(g, 0.045, 0.05, 0.1, mid, 0, 0.07, -0.14); });
  vm('vyper', (g) => { part(g, 0.055, 0.12, 0.4, dark, 0, 0, -0.12); part(g, 0.04, 0.16, 0.07, mid, 0, -0.12, -0.1); part(g, 0.03, 0.03, 0.16, mid, 0, 0.02, -0.38); });
  vm('kestrel', (g) => { part(g, 0.055, 0.11, 0.52, dark, 0, 0, -0.16); part(g, 0.04, 0.14, 0.07, mid, 0, -0.11, -0.14); part(g, 0.05, 0.06, 0.12, accent, 0, 0.08, -0.2); part(g, 0.028, 0.028, 0.2, mid, 0, 0.01, -0.5); });
  vm('heron', (g) => { part(g, 0.05, 0.1, 0.62, dark, 0, 0, -0.2); part(g, 0.045, 0.09, 0.3, mid, 0, 0.09, -0.18); part(g, 0.02, 0.02, 0.34, mid, 0, 0.01, -0.62); });
  const grenadeModel = new THREE.Group();
  const gball = new THREE.Mesh(new THREE.SphereGeometry(0.055, 10, 8), mat(0x3d4756, 0.5, 0.4));
  grenadeModel.add(gball); grenadeModel.position.set(0.24, -0.2, -0.4); grenadeModel.visible = false;
  holder.add(grenadeModel);
  const flash = new THREE.Mesh(new THREE.PlaneGeometry(0.3, 0.3),
    new THREE.MeshBasicMaterial({ color: 0xffcf7a, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false }));
  flash.position.set(0, 0.02, -0.72); holder.add(flash);

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

  refreshModels();
  return { update, switchTo, refreshModels, throwGrenade, explodeAt, currentSpreadOf: () => {
    const w = WEAPONS[load.current];
    return w ? currentSpread(w) : 0;
  } };
}
