// main.js — boot and the one loop. The simulation runs on a fixed 1/60
// accumulator, decoupled from rendering: player, weapons, bots and rounds
// step at exactly 60 Hz however fast the display paints, and the HUD and the
// renderer run once per animation frame.
// ?shot=start|play|end (with &seed=N) sets up one deterministic frame for a
// screenshot, renders it twice, freezes, and sets window.__shotReady.
import * as THREE from 'three';
import { S, CFG } from './state.js';
import { createWorld } from './world.js';
import { createInput } from './input.js';
import { createPlayer } from './player.js';
import { createWeapons } from './weapons.js';
import { createBots } from './bots.js';
import { createRounds } from './rounds.js';
import { createHud } from './hud.js';
import { initAudio, resumeAudio } from './audio.js';

const STEP = 1 / 60;
const params = new URLSearchParams(window.location.search);
const shot = params.get('shot');

const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.28;
document.getElementById('game').appendChild(renderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.08, 600);
scene.add(camera);

const world = createWorld(scene);
S.world = world;
const input = createInput(renderer.domElement);
const playerCtl = createPlayer(camera, input, world);
S.player = playerCtl.player;
const weapons = createWeapons(camera, scene, input, playerCtl.player);
S.weapons = weapons;
const botsApi = createBots(scene, world);
S.bots = botsApi.bots;
const rounds = createRounds(world, botsApi);

// The whole match state, exposed for automated playtesting and screenshots.
window.GAME = S;

// A posed backdrop behind the start screen: squads at their spawns.
S.round = 1;
botsApi.assignRound();
playerCtl.player.resetForRound();

const hud = createHud(input, {
  onPlay() {
    initAudio(); resumeAudio();
    if (S.phase === 'idle' || S.phase === 'matchover') rounds.startMatch();
    input.lock();
  },
  onPlayAgain() {
    initAudio(); resumeAudio();
    rounds.startMatch();
    input.lock();
  },
}, !!shot);

function step(dt) {
  S.time += dt;
  playerCtl.update(dt);
  weapons.update(dt);
  botsApi.update(dt);
  rounds.update(dt);
  input.pressed.clear();
}

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

if (shot) {
  // Deterministic captures: pose the requested screen, settle it, freeze.
  if (shot === 'play') {
    document.getElementById('play').click(); // start the match (buy phase)
    S.phaseT = 0.05;                          // skip ahead to the live round
    for (let i = 0; i < 6; i++) step(STEP);
    for (let i = 0; i < 300; i++) step(STEP); // 5 s live: the push is moving
    const p = S.player;
    p.pos.x = 4; p.pos.z = -4; p.yaw = -1.1; p.hp = 100; p.alive = true;
    // two Wardens stand in the sightline toward the crane yard: one close
    // enough to read as an enemy in the frame, one holding the site itself
    const w1 = S.bots[5], w2 = S.bots[4];
    w1.pos.x = 14; w1.pos.z = -9; w1.yaw = 2.2; w1.mode = 'hold';
    w2.pos.x = 30; w2.pos.z = -20; w2.yaw = 2.4; w2.mode = 'hold';
    p.loadout.owned.kestrel = true; p.loadout.bySlot[1] = 'kestrel';
    p.loadout.state.kestrel = { mag: 24, reserve: 90 };
    p.loadout.current = 'kestrel'; weapons.refreshModels();
    S.money = 2350; S.roundT = 63;
    step(STEP);
    // freeze a shot mid-flight at the near Warden: flash, tracer, sparks
    weapons.poseShotFx(w1.pos.x, 1.25, w1.pos.z);
  } else if (shot === 'buy') {
    document.getElementById('play').click(); // the match opens in the buy phase
    S.money = 5000;
    S.player.buy('kestrel');                  // one grid item already OWNED
    for (let i = 0; i < 30; i++) step(STEP);  // settle half a second of buy phase
  } else if (shot === 'end') {
    document.getElementById('play').click();
    S.score.jackals = 7; S.score.wardens = 5;
    S.phase = 'matchover'; S.matchWinner = 'jackals';
    step(STEP);
  } else {
    step(STEP); // 'start': the title overlay over the posed dock backdrop
  }
  hud.update();
  renderer.render(scene, camera);
  renderer.render(scene, camera);
  window.__shotReady = true;
} else {
  let last = performance.now(), acc = 0;
  renderer.setAnimationLoop((now) => {
    let frame = (now - last) / 1000;
    last = now;
    if (frame > 0.1) frame = 0.1;
    acc += frame;
    while (acc >= STEP) { step(STEP); acc -= STEP; }
    hud.update();
    renderer.render(scene, camera);
  });
}
