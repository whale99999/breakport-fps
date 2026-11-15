// state.js — the one GameState object for the whole match, plus match config.
// Every module imports S and reads/writes it; nothing keeps a private copy of
// match state. Cross-module calls that would create import cycles (damage,
// explosions, planting) are registered here as refs by their owning module.

export const CFG = {
  buyTime: 12,          // seconds of buy phase at each round start
  roundTime: 100,       // seconds on the round clock before the Charge is planted
  chargeTime: 40,       // seconds from plant to detonation
  plantTime: 3,         // hold-E channel to plant
  defuseTime: 5,        // hold-E channel to defuse
  endTime: 4.5,         // round-end banner pause
  winTarget: 7,         // rounds to win the match
  maxRounds: 12,        // soft cap: past this, the next round win takes the match
  startMoney: 800,
  maxMoney: 16000,
  killReward: 300,
  winReward: 1400,
  lossReward: 1000,
  bonusReward: 500,     // detonation / defuse team bonus
  plantReward: 300,     // to the planter
  teamSize: 5,          // per side, including the player on the Jackals
};

export const TEAM = { ATK: 'jackals', DEF: 'wardens' };

export const S = {
  phase: 'idle',        // idle | buy | live | planted | end | matchover
  prevPhase: 'idle',
  round: 0,
  phaseT: 0,            // seconds left in buy / end phases
  roundT: 0,            // seconds left on the round (or charge) clock
  time: 0,              // sim seconds since boot
  score: { jackals: 0, wardens: 0 },
  roundWinner: null,    // TEAM value of the last round winner
  roundReason: '',      // 'detonation' | 'defused' | 'elimination' | 'time'
  matchWinner: null,
  targetSite: 'A',      // the site the Jackal bots push this round

  // The player's wallet and loadout bookkeeping (player.js owns the body).
  money: CFG.startMoney,

  // The Charge (the bomb). carrier is 'player', a bot object, or null.
  charge: {
    state: 'carried',   // carried | dropped | planted | gone
    carrier: null,
    site: null,         // 'A' | 'B' once planted (or targeted while carried)
    x: 0, z: 0,         // world position when dropped / planted
    beepT: 0,
  },

  // Last gunshot heard: { x, z, t, team } — bots react to it, minimap ignores it.
  noise: { x: 0, z: 0, t: -99, team: null },

  feed: [],             // killfeed + event lines for hud.js: { text, cls, t }
  banner: null,         // { title, sub, until } big centre message for hud.js
  shake: 0,             // camera shake impulse, decays in player.js

  player: null,         // wired by main.js: the player controller object
  bots: [],             // wired by main.js: every bot, both teams
  world: null,          // wired by main.js: { colliders, hitMeshes, sites, waypoints, spawns }
  refs: {
    damagePlayer: null, // (amount, attacker) => void        (player.js)
    damageBot: null,    // (bot, amount, zone, attacker)    (bots.js)
    explodeAt: null,    // (x, y, z, radius, maxDmg, owner) (weapons.js)
    onPlanted: null,    // (site) => void                   (rounds.js)
    onDefused: null,    // () => void                       (rounds.js)
    onCarrierDown: null,// (x, z) => void                   (rounds.js)
  },
};

export function aliveCount(team) {
  let n = 0;
  if (team === TEAM.ATK && S.player && S.player.alive) n += 1;
  for (const b of S.bots) if (b.team === team && b.alive) n += 1;
  return n;
}

export function pushFeed(text, cls) {
  S.feed.push({ text, cls: cls || '', t: S.time });
  if (S.feed.length > 6) S.feed.shift();
}

export function setBanner(title, sub, seconds) {
  S.banner = { title, sub: sub || '', until: S.time + (seconds || 2.6) };
}
