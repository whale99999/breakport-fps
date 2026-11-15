// player.js — the human Jackal: first-person movement with acceleration and
// friction, AABB collision, crouch and jump, health and armour, the buy
// logic for the loadout, and the Charge interactions (plant channel, picking
// up a dropped Charge). The camera is posed here every step.
import * as THREE from 'three';
import { S, CFG, TEAM, pushFeed } from './state.js';
import { collide } from './world.js';
import { WEAPONS } from './weapons.js';
import { sfxStep, sfxHurt, sfxBuy, sfxDenied } from './audio.js';

const EYE_STAND = 1.62, EYE_CROUCH = 1.12;

export function createPlayer(camera, input, world) {
  const player = {
    team: TEAM.ATK,
    name: 'You',
    alive: true,
    hp: 100,
    armor: 0,               // 0 none, 1 kevlar, 2 kevlar + helmet
    pos: { x: world.spawns.player.x, z: world.spawns.player.z },
    y: 0,                   // feet height (jump)
    vel: { x: 0, y: 0, z: 0 },
    yaw: -Math.PI / 2,      // face +x, toward Mid
    pitch: 0,
    recoil: 0, recoilYaw: 0,
    crouching: false,
    grounded: true,
    zoomed: false,
    hurtT: -9,
    stepAcc: 0,
    diedLastRound: false,
    channel: { active: false, kind: null, t: 0, need: 0 },
    loadout: null,

    eyeY() { return this.y + (this.crouching ? EYE_CROUCH : EYE_STAND); },

    buy(key) {
      if (S.phase !== 'buy' || !this.alive) return false;
      const L = this.loadout;
      const spend = (price) => {
        if (S.money < price) { sfxDenied(); return false; }
        S.money -= price; sfxBuy(); return true;
      };
      if (key === 'kevlar') { if (this.armor >= 1 || !spend(650)) return false; this.armor = 1; return true; }
      if (key === 'helmet') {
        const price = this.armor === 1 ? 350 : 1000;
        if (this.armor >= 2 || !spend(price)) return false;
        this.armor = 2; return true;
      }
      if (key === 'frag') { if (L.grenades >= 2 || !spend(300)) return false; L.grenades += 1; return true; }
      const w = WEAPONS[key];
      if (!w || w.slot !== 1 || L.owned[key]) return false;
      if (!spend(w.price)) return false;
      if (L.bySlot[1]) L.owned[L.bySlot[1]] = false;   // the old primary is traded in
      L.owned[key] = true;
      L.bySlot[1] = key;
      L.state[key] = { mag: w.mag, reserve: w.reserve };
      return true;
    },

    resetForRound() {
      this.hp = 100;
      this.alive = true;
      this.pos.x = world.spawns.player.x; this.pos.z = world.spawns.player.z;
      this.y = 0; this.vel.x = 0; this.vel.y = 0; this.vel.z = 0;
      this.yaw = -Math.PI / 2; this.pitch = 0; this.recoil = 0; this.recoilYaw = 0;
      this.crouching = false; this.zoomed = false;
      this.channel.active = false;
      const L = this.loadout;
      if (this.diedLastRound && L.bySlot[1]) {
        // Death costs the primary; pistol, armour and grenades are kept.
        L.owned[L.bySlot[1]] = false;
        L.bySlot[1] = null;
        if (WEAPONS[L.current] && WEAPONS[L.current].slot === 1) L.current = 'sable';
        this.diedLastRound = false;
      }
      if (L.state.sable.reserve < 24) L.state.sable.reserve = 24;
      if (L.current === 'grenade' && L.grenades <= 0) L.current = 'sable';
    },

    resetForMatch() {
      // Mutate the loadout in place: weapons.js holds a reference to this
      // object from boot, so replacing it would strand the guns on a stale copy.
      if (!this.loadout) {
        this.loadout = { owned: {}, state: {}, bySlot: {}, current: 'sable', grenades: 0 };
      }
      this.loadout.owned = { knife: true, sable: true };
      this.loadout.state = {
        knife: { mag: 0, reserve: 0 },
        sable: { mag: WEAPONS.sable.mag, reserve: WEAPONS.sable.reserve },
      };
      this.loadout.bySlot = { 1: null, 2: 'sable', 3: 'knife' };
      this.loadout.current = 'sable';
      this.loadout.grenades = 0;
      this.armor = 0;
      this.diedLastRound = false;
      this.resetForRound();
    },
  };

  function damagePlayer(amount, attacker) {
    if (!player.alive || S.phase === 'buy' || S.phase === 'end') return;
    let dmg = amount;
    if (player.armor >= 1) dmg *= 0.65;
    player.hp -= dmg;
    player.hurtT = S.time;
    sfxHurt();
    if (player.hp <= 0) {
      player.hp = 0;
      player.alive = false;
      player.diedLastRound = true;
      player.channel.active = false;
      const who = attacker && attacker.name ? attacker.name : 'Crossfire';
      pushFeed(`${who} ▸ You`, 'bad');
      if (attacker && attacker.team === TEAM.DEF) { /* warden bots earn no wallet */ }
      if (S.charge.state === 'carried' && S.charge.carrier === 'player') {
        S.refs.onCarrierDown(player.pos.x, player.pos.z);
      }
    }
  }
  S.refs.damagePlayer = damagePlayer;

  // --- movement + camera + interaction, one fixed step -----------------------
  function update(dt) {
    const ch = player.channel;
    ch.active = false;

    if (player.alive) {
      // mouse look
      const [dx, dy] = input.consumeMouse();
      const sens = player.zoomed ? 0.0009 : 0.0023;
      player.yaw -= dx * sens;
      player.pitch -= dy * sens;
      player.pitch = Math.max(-1.45, Math.min(1.45, player.pitch));

      // wish direction: input axes rotated by the yaw basis (allocation-free)
      let ix = 0, iz = 0;
      if (input.keys.has('KeyW')) iz -= 1;
      if (input.keys.has('KeyS')) iz += 1;
      if (input.keys.has('KeyA')) ix -= 1;
      if (input.keys.has('KeyD')) ix += 1;
      const fx = -Math.sin(player.yaw), fz = -Math.cos(player.yaw);
      const rx = Math.cos(player.yaw), rz = -Math.sin(player.yaw);
      let wx = fx * -iz + rx * ix;
      let wz = fz * -iz + rz * ix;
      const len = Math.hypot(wx, wz);
      if (len > 1) { wx /= len; wz /= len; }

      player.crouching = input.keys.has('ControlLeft') || input.keys.has('KeyC');
      const speed = player.crouching ? 2.2 : (player.zoomed ? 2.4 : 4.6);
      const blend = Math.min(1, dt * (player.grounded ? 11 : 2.2));
      player.vel.x += (wx * speed - player.vel.x) * blend;
      player.vel.z += (wz * speed - player.vel.z) * blend;

      // jump + gravity
      if (input.pressed.has('Space') && player.grounded && !player.crouching) {
        player.vel.y = 4.8; player.grounded = false;
      }
      player.vel.y -= 13.5 * dt;
      player.y += player.vel.y * dt;
      if (player.y <= 0) { player.y = 0; player.vel.y = 0; player.grounded = true; }

      player.pos.x += player.vel.x * dt;
      player.pos.z += player.vel.z * dt;
      collide(world, player.pos, 0.36);

      // footsteps
      const hSpeed = Math.hypot(player.vel.x, player.vel.z);
      if (player.grounded && hSpeed > 0.8 && !player.crouching) {
        player.stepAcc += hSpeed * dt;
        if (player.stepAcc > 2.3) { player.stepAcc = 0; sfxStep(hSpeed > 3.6); }
      }

      updateInteraction(dt);
    }

    // recoil recovery
    player.recoil *= Math.pow(0.0001, dt); // fast spring back
    if (player.recoil < 0.0004) player.recoil = 0;
    player.recoilYaw *= Math.pow(0.0001, dt);
    if (Math.abs(player.recoilYaw) < 0.0004) player.recoilYaw = 0;

    // camera pose (death: sink and tilt)
    const deathT = player.alive ? 0 : 1;
    const eye = player.eyeY() - deathT * 1.1;
    camera.position.set(player.pos.x, eye, player.pos.z);
    camera.rotation.order = 'YXZ';
    camera.rotation.y = player.yaw + player.recoilYaw;
    camera.rotation.x = player.pitch + player.recoil;
    camera.rotation.z = deathT * 0.5 + S.shake * (Math.random() - 0.5) * 0.05;
    const targetFov = player.zoomed ? 21 : 75;
    if (Math.abs(camera.fov - targetFov) > 0.2) {
      camera.fov += (targetFov - camera.fov) * Math.min(1, dt * 14);
      camera.updateProjectionMatrix();
    }
    S.shake = Math.max(0, S.shake - dt * 1.8);
  }

  function updateInteraction(dt) {
    const c = S.charge;
    // pick up a dropped Charge by walking over it
    if (c.state === 'dropped' && Math.hypot(player.pos.x - c.x, player.pos.z - c.z) < 1.5) {
      c.state = 'carried'; c.carrier = 'player';
      pushFeed('You picked up the Charge', 'good');
    }
    // plant: hold E inside a site while carrying
    if ((S.phase === 'live') && c.state === 'carried' && c.carrier === 'player') {
      for (const key of ['A', 'B']) {
        const st = world.sites[key];
        if (Math.hypot(player.pos.x - st.x, player.pos.z - st.z) < st.r) {
          if (input.keys.has('KeyE')) {
            const ch = player.channel;
            ch.active = true; ch.kind = 'plant';
            ch.need = CFG.plantTime;
            ch.t = (ch.kind === 'plant' ? ch.t : 0) + dt;
            if (ch.t >= CFG.plantTime) {
              ch.active = false; ch.t = 0;
              S.refs.onPlanted(key, player.pos.x, player.pos.z);
            }
          } else player.channel.t = 0;
          return;
        }
      }
      player.channel.t = 0;
    }
  }

  player.resetForMatch();
  return { player, update };
}
