// bots.js — the nine AI fighters: four Jackals beside the player, five
// Wardens defending. Low-poly box humanoids whose legs, torso and head are
// separate meshes so the player's raycasts score real hit zones. Brains run
// on the waypoint graph from world.js: attackers push a chosen site and
// plant, defenders hold points, rotate on the planted Charge or on gunshot
// noise, and everyone fights with burst fire, reaction delay and spread
// that grows with range — the same weapon table the player uses.
import * as THREE from 'three';
import { S, CFG, TEAM, pushFeed } from './state.js';
import { collide } from './world.js';
import { WEAPONS, ZONE_MULT, falloff } from './weapons.js';
import { PAL, mat } from './palette.js';
import { sfxShot } from './audio.js';

const JACKAL_NAMES = ['Rook', 'Vex', 'Halo', 'Juno'];
const WARDEN_NAMES = ['Bram', 'Ossa', 'Kett', 'Miro', 'Senn'];
const EYE = 1.55, CHEST = 1.18;

const _o = new THREE.Vector3();
const _t = new THREE.Vector3();
const _d = new THREE.Vector3();
const _ray = new THREE.Raycaster();

function angDiff(a, b) {
  let d = a - b;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return d;
}
function yawTo(from, x, z) { return Math.atan2(-(x - from.x), -(z - from.z)); }

// Breadth-first route over the waypoint graph, nearest node to start.
function findPath(world, from, goalIdx) {
  let start = world.nodes[0], best = 1e9;
  for (const n of world.nodes) {
    const d = (n.x - from.x) ** 2 + (n.z - from.z) ** 2;
    if (d < best) { best = d; start = n; }
  }
  const goal = world.nodes[goalIdx];
  if (start === goal) return [goal];
  const prev = new Map([[start, null]]);
  const queue = [start];
  while (queue.length) {
    const cur = queue.shift();
    for (const nx of cur.next) {
      if (!prev.has(nx)) { prev.set(nx, cur); queue.push(nx); }
    }
    if (prev.has(goal)) break;
  }
  if (!prev.has(goal)) return [goal];
  const path = [];
  for (let n = goal; n; n = prev.get(n)) path.unshift(n);
  return path;
}

export function createBots(scene, world) {
  const bots = [];
  function makeBot(name, team, i) {
    const group = new THREE.Group();
    const teamMat = mat(team === TEAM.ATK ? PAL.jackal : PAL.warden, 0.8);
    const legMat = mat(PAL.slate, 0.9);
    const headMat = mat(PAL.cream, 0.7);
    const legs = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.8, 0.3), legMat);
    legs.position.y = 0.4;
    const torso = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.72, 0.34), teamMat);
    torso.position.y = 1.16;
    const head = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.3, 0.3), headMat);
    head.position.y = 1.7;
    const gun = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.12, 0.55), mat(0x2c2f33, 0.5, 0.5));
    gun.position.set(0.22, 1.28, -0.35);
    for (const m of [legs, torso, head]) { m.castShadow = true; group.add(m); }
    group.add(gun);
    scene.add(group);
    const bot = {
      name, team, idx: i, alive: true, hp: 100, armor: false,
      pos: { x: 0, z: 0 }, yaw: 0, group,
      hitMeshes: [legs, torso, head],
      weapon: 'sable',
      mode: 'hold',           // hold | route | engage | plant | defuse | pickup
      path: [], pathI: 0, goal: null,
      holdPoint: null,
      target: null, lastSeen: null, seeT: -9, reactT: 0,
      burstLeft: 0, burstCd: 0, shotCd: 0, thinkT: Math.random() * 0.15,
      strafeDir: 1, strafeT: 0, channelT: 0, speedMul: 0.92 + Math.random() * 0.16,
    };
    legs.userData = { bot, zone: 'legs' };
    torso.userData = { bot, zone: 'torso' };
    head.userData = { bot, zone: 'head' };
    bots.push(bot);
    return bot;
  }
  JACKAL_NAMES.forEach((n, i) => makeBot(n, TEAM.ATK, i));
  WARDEN_NAMES.forEach((n, i) => makeBot(n, TEAM.DEF, i + 4));

  function damageBot(bot, amount, zone, attacker) {
    if (!bot.alive || S.phase === 'buy' || S.phase === 'end') return;
    let dmg = amount;
    if (bot.armor && zone === 'torso') dmg *= 0.65;
    if (bot.armor && zone === 'head') dmg *= 0.6;
    bot.hp -= dmg;
    // Being shot reveals the shooter's direction: turn toward them at once.
    const src = attacker === 'player' ? S.player : attacker;
    if (src && src.alive !== false && src.pos) {
      bot.lastSeen = { x: src.pos.x, z: src.pos.z };
      bot.seeT = S.time;
      if (!bot.target) { bot.target = src; bot.reactT = Math.max(bot.reactT, 0.18); }
    }
    if (bot.hp <= 0) {
      bot.hp = 0; bot.alive = false; bot.mode = 'dead';
      bot.group.rotation.x = -Math.PI / 2;
      bot.group.position.y = 0.25;
      const who = attacker === 'player' ? 'You' : (attacker && attacker.name) || 'Crossfire';
      pushFeed(`${who} ▸ ${bot.name}`, attacker === 'player' || (attacker && attacker.team === TEAM.ATK) ? 'good' : 'bad');
      if (attacker === 'player') S.money = Math.min(CFG.maxMoney, S.money + CFG.killReward);
      if (S.charge.state === 'carried' && S.charge.carrier === bot) {
        S.refs.onCarrierDown(bot.pos.x, bot.pos.z);
      }
    }
  }
  S.refs.damageBot = damageBot;

  // Round setup: positions, weapons by round number, orders.
  function assignRound() {
    const siteNode = S.targetSite === 'A' ? 9 : 14;
    for (const b of bots) {
      b.alive = true; b.hp = 100; b.mode = 'hold';
      b.target = null; b.lastSeen = null; b.path = []; b.channelT = 0;
      b.group.rotation.x = 0; b.group.position.y = 0;
      b.armor = S.round >= 2;
      if (b.team === TEAM.ATK) {
        const sp = world.spawns.jackals[b.idx];
        b.pos.x = sp.x; b.pos.z = sp.z; b.yaw = -Math.PI / 2;
        b.weapon = S.round === 1 ? 'sable' : (b.idx % 2 ? 'kestrel' : 'vyper');
        b.goal = { node: siteNode };
      } else {
        const atA = b.idx - 4 < 3;
        const sp = (atA ? world.spawns.wardensA : world.spawns.wardensB)[(b.idx - 4) % 3];
        b.pos.x = sp.x; b.pos.z = sp.z;
        b.holdPoint = (atA ? world.spawns.holdA : world.spawns.holdB)[(b.idx - 4) % 3];
        b.yaw = b.holdPoint.face;
        b.weapon = S.round === 1 ? 'sable' : (b.idx === 5 && S.round >= 4 ? 'heron' : 'kestrel');
        b.goal = null;
      }
      syncMesh(b);
    }
  }

  function syncMesh(b) {
    // local -Z is the gun side; rotation.y = yaw aims it along the bot's facing
    b.group.position.set(b.pos.x, b.alive ? 0 : 0.25, b.pos.z);
    b.group.rotation.y = b.yaw;
  }

  // --- perception ----------------------------------------------------------------
  function losBlocked(x0, z0, x1, z1) {
    _o.set(x0, EYE, z0); _t.set(x1, CHEST, z1); _d.copy(_t).sub(_o);
    const dist = _d.length(); _d.normalize();
    _ray.set(_o, _d); _ray.far = dist - 0.4;
    return _ray.intersectObjects(world.hitMeshes, false).length > 0;
  }

  function perceive(b, dt) {
    b.thinkT -= dt;
    if (b.thinkT > 0) return;
    b.thinkT = 0.13;
    let bestEnemy = null, bestD = 1e9;
    const foes = [];
    if (b.team === TEAM.DEF && S.player.alive) foes.push(S.player);
    for (const o of bots) if (o.team !== b.team && o.alive) foes.push(o);
    for (const e of foes) {
      const d = Math.hypot(e.pos.x - b.pos.x, e.pos.z - b.pos.z);
      if (d > 68) continue;
      const inFov = d < 6 || Math.abs(angDiff(b.yaw, yawTo(b.pos, e.pos.x, e.pos.z))) < 1.0;
      const heard = S.noise.team === e.team && S.time - S.noise.t < 1.4 &&
        Math.hypot(S.noise.x - b.pos.x, S.noise.z - b.pos.z) < 34;
      if (!inFov && !heard) continue;
      if (inFov && !losBlocked(b.pos.x, b.pos.z, e.pos.x, e.pos.z)) {
        if (d < bestD) { bestD = d; bestEnemy = e; }
      } else if (heard && !b.target) {
        b.lastSeen = { x: S.noise.x, z: S.noise.z };
      }
    }
    if (bestEnemy) {
      if (b.target !== bestEnemy) { b.target = bestEnemy; b.reactT = 0.24 + Math.random() * 0.26; }
      b.lastSeen = { x: bestEnemy.pos.x, z: bestEnemy.pos.z };
      b.seeT = S.time;
    } else if (S.time - b.seeT > 1.6) {
      b.target = null;
    }
  }

  // --- combat ----------------------------------------------------------------------
  function botShoot(b, foe) {
    const w = WEAPONS[b.weapon];
    const dx = foe.pos.x - b.pos.x, dz = foe.pos.z - b.pos.z;
    const dist = Math.hypot(dx, dz);
    sfxShot(w.kind, Math.hypot(S.player.pos.x - b.pos.x, S.player.pos.z - b.pos.z));
    S.noise = { x: b.pos.x, z: b.pos.z, t: S.time, team: b.team };
    // Ray with distance-scaled spread against the foe's body segment.
    const aimY = Math.random() < 0.22 ? 1.62 : CHEST;
    const spread = (0.028 + dist * 0.0011) * (foe === S.player && Math.hypot(S.player.vel.x, S.player.vel.z) > 3 ? 1.5 : 1);
    _o.set(b.pos.x, EYE, b.pos.z);
    _t.set(foe.pos.x + (Math.random() * 2 - 1) * spread * dist, aimY + (Math.random() * 2 - 1) * spread * dist * 0.6, foe.pos.z + (Math.random() * 2 - 1) * spread * dist);
    _d.copy(_t).sub(_o).normalize();
    _ray.set(_o, _d); _ray.far = dist + 1;
    if (_ray.intersectObjects(world.hitMeshes, false).length) return; // into cover
    // Closest approach of the ray to the foe's vertical body axis.
    const px = foe.pos.x - _o.x, pz = foe.pos.z - _o.z;
    const along = px * _d.x + pz * _d.z;
    if (along < 0) return;
    const cx = _o.x + _d.x * along, cz = _o.z + _d.z * along;
    const offAxis = Math.hypot(foe.pos.x - cx, foe.pos.z - cz);
    if (offAxis > 0.42) return;
    const hitY = _o.y + _d.y * along;
    const zone = hitY > 1.45 ? 'head' : hitY > 0.78 ? 'torso' : 'legs';
    const dmg = w.dmg * ZONE_MULT[zone] * falloff(w, dist);
    if (foe === S.player) S.refs.damagePlayer(dmg, b);
    else damageBot(foe, dmg, zone, b);
  }

  function combat(b, dt) {
    const foe = b.target;
    b.reactT -= dt;
    // face the target (or last seen point)
    const aim = foe && foe.alive ? foe.pos : b.lastSeen;
    if (aim) {
      const want = yawTo(b.pos, aim.x, aim.z);
      b.yaw += Math.max(-7 * dt, Math.min(7 * dt, angDiff(want, b.yaw)));
    }
    // strafe while engaged
    b.strafeT -= dt;
    if (b.strafeT <= 0) { b.strafeT = 0.7 + Math.random() * 0.9; b.strafeDir = Math.random() < 0.5 ? -1 : 1; }
    if (foe && foe.alive) {
      const d = Math.hypot(foe.pos.x - b.pos.x, foe.pos.z - b.pos.z);
      const sx = Math.cos(b.yaw) * b.strafeDir, sz = -Math.sin(b.yaw) * b.strafeDir;
      const approach = d > 26 ? 1.4 : d < 9 ? -0.8 : 0;
      move(b, (sx * 1.5) + Math.sin(b.yaw) * -approach, (sz * 1.5) + Math.cos(b.yaw) * -approach, dt);
    }
    // burst fire control
    b.shotCd -= dt; b.burstCd -= dt;
    if (!foe || !foe.alive || b.reactT > 0 || S.time - b.seeT > 0.4) return;
    if (b.burstLeft <= 0) {
      if (b.burstCd <= 0) { b.burstLeft = 3 + Math.floor(Math.random() * 3); b.burstCd = 0.45 + Math.random() * 0.55; }
      else return;
    }
    if (b.shotCd <= 0 && b.burstLeft > 0) {
      b.shotCd = 60 / WEAPONS[b.weapon].rpm;
      b.burstLeft -= 1;
      botShoot(b, foe);
    }
  }

  function move(b, vx, vz, dt) {
    const sp = Math.hypot(vx, vz);
    if (sp < 0.01) return;
    b.pos.x += vx * dt; b.pos.z += vz * dt;
    collide(world, b.pos, 0.36);
  }

  function followPath(b, dt, speed) {
    if (b.pathI >= b.path.length) return true;
    const n = b.path[b.pathI];
    const dx = n.x - b.pos.x, dz = n.z - b.pos.z;
    const d = Math.hypot(dx, dz);
    if (d < 1.3) { b.pathI += 1; return b.pathI >= b.path.length; }
    b.yaw += Math.max(-5 * dt, Math.min(5 * dt, angDiff(Math.atan2(-dx, -dz), b.yaw)));
    move(b, (dx / d) * speed * b.speedMul, (dz / d) * speed * b.speedMul, dt);
    return false;
  }
  function routeTo(b, nodeIdx) {
    b.path = findPath(world, b.pos, nodeIdx);
    b.pathI = 0;
    b.mode = 'route';
    b.goal = { node: nodeIdx };
  }
  function nearestNode(x, z) {
    let bi = 0, bd = 1e9;
    for (const n of world.nodes) { const d = (n.x - x) ** 2 + (n.z - z) ** 2; if (d < bd) { bd = d; bi = n.i; } }
    return bi;
  }

  // --- per-bot brain ------------------------------------------------------------------
  function think(b, dt) {
    if (!b.alive) return;
    if (S.phase !== 'live' && S.phase !== 'planted') return;
    perceive(b, dt);
    if (b.target && b.target.alive) { combat(b, dt); return; }
    if (b.mode === 'engage') b.mode = 'hold';

    const c = S.charge;
    if (b.team === TEAM.ATK) {
      if (c.state === 'carried' && c.carrier === b) {
        const st = world.sites[S.targetSite];
        if (Math.hypot(b.pos.x - st.x, b.pos.z - st.z) < st.r - 1.5) {
          b.mode = 'plant';
          b.yaw += Math.max(-4 * dt, Math.min(4 * dt, angDiff(yawTo(b.pos, st.x, st.z), b.yaw)));
          b.channelT += dt;
          if (b.channelT >= CFG.plantTime) { b.channelT = 0; S.refs.onPlanted(S.targetSite, b.pos.x, b.pos.z, b); }
          return;
        }
        if (b.mode !== 'route' || !b.goal || b.goal.node !== (S.targetSite === 'A' ? 9 : 14)) routeTo(b, S.targetSite === 'A' ? 9 : 14);
        followPath(b, dt, 3.9);
        return;
      }
      if (c.state === 'dropped') {
        if (b.mode !== 'pickup') { b.path = findPath(world, b.pos, nearestNode(c.x, c.z)); b.pathI = 0; b.mode = 'pickup'; b.goal = { x: c.x, z: c.z }; }
        if (followPath(b, dt, 4.1) || Math.hypot(b.pos.x - c.x, b.pos.z - c.z) < 1.5) {
          c.state = 'carried'; c.carrier = b; b.mode = 'route'; b.goal = null;
          pushFeed(`${b.name} picked up the Charge`, 'good');
        }
        return;
      }
      if (c.state === 'planted') { // guard the planted Charge
        const st = world.sites[c.site];
        if (Math.hypot(b.pos.x - st.x, b.pos.z - st.z) > 7) {
          if (b.mode !== 'route') routeTo(b, nearestNode(st.x, st.z));
          followPath(b, dt, 3.9);
        }
        return;
      }
      // default: push the target site, then hold its edge and watch
      const node = S.targetSite === 'A' ? 9 : 14;
      const st = world.sites[S.targetSite];
      if (Math.hypot(b.pos.x - st.x, b.pos.z - st.z) > st.r + 2) {
        if (b.mode !== 'route' || !b.goal || b.goal.node !== node) routeTo(b, node);
        followPath(b, dt, 3.9);
      } else {
        b.mode = 'hold';
        if (b.lastSeen && S.time - b.seeT < 4) {
          b.yaw += Math.max(-3 * dt, Math.min(3 * dt, angDiff(yawTo(b.pos, b.lastSeen.x, b.lastSeen.z), b.yaw)));
        }
      }
      return;
    }

    // Wardens
    if (c.state === 'planted') {
      const d = Math.hypot(b.pos.x - c.x, b.pos.z - c.z);
      const isDefuser = !bots.some((o) => o !== b && o.team === TEAM.DEF && o.alive && o.mode === 'defuse');
      if (d < 1.7 && isDefuser) {
        b.mode = 'defuse';
        b.channelT += dt;
        if (b.channelT >= CFG.defuseTime) { b.channelT = 0; S.refs.onDefused(); }
        return;
      }
      b.channelT = 0;
      if (b.mode !== 'route' || !b.goal || b.goal.x !== c.x) {
        b.path = findPath(world, b.pos, nearestNode(c.x, c.z));
        b.pathI = 0; b.mode = 'route'; b.goal = { x: c.x, z: c.z };
      }
      followPath(b, dt, 4.1);
      return;
    }
    if (b.mode === 'defuse') { b.mode = 'hold'; b.channelT = 0; }
    // walk back to the hold point, then settle onto its facing
    if (b.mode === 'hold' && b.holdPoint) {
      const d = Math.hypot(b.pos.x - b.holdPoint.x, b.pos.z - b.holdPoint.z);
      if (d > 1.2) {
        b.yaw += Math.max(-5 * dt, Math.min(5 * dt, angDiff(yawTo(b.pos, b.holdPoint.x, b.holdPoint.z), b.yaw)));
        move(b, ((b.holdPoint.x - b.pos.x) / d) * 3.2, ((b.holdPoint.z - b.pos.z) / d) * 3.2, dt);
      } else if (S.noise.team === TEAM.ATK && S.time - S.noise.t < 2.5) {
        // fresh Jackal gunfire elsewhere: turn toward it, stay on site
        b.yaw += Math.max(-3 * dt, Math.min(3 * dt, angDiff(yawTo(b.pos, S.noise.x, S.noise.z), b.yaw)));
      } else {
        b.yaw += Math.max(-2 * dt, Math.min(2 * dt, angDiff(b.holdPoint.face, b.yaw)));
      }
    }
  }

  function update(dt) {
    for (const b of bots) {
      think(b, dt);
      syncMesh(b);
    }
  }

  return { bots, update, assignRound, damageBot };
}
