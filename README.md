# breakport-fps

[![make.fun · threejs-fps-02](https://make.fun/badge/threejs-fps-02.svg)](https://make.fun/bounty/threejs-fps-02?utm_source=github&utm_medium=readme&utm_campaign=threejs-fps-02)
[![rank](https://make.fun/badge/threejs-fps-02/whale99999/breakport-fps/rank.svg)](https://make.fun/bounty/threejs-fps-02/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=threejs-fps-02)
[![reward](https://make.fun/badge/threejs-fps-02/whale99999/breakport-fps/reward.svg)](https://make.fun/bounty/threejs-fps-02?utm_source=github&utm_medium=readme&utm_campaign=threejs-fps-02)

BREAKPORT is a round-based tactical first-person shooter for the browser, built on three.js. Two five-bot squads fight over a container port at dusk: the Jackals carry the Charge in from the Dock and plant it at the Crane Yard (A) or the Depot (B); the Wardens hold the sites and defuse. Money earned each round is spent in a buy menu — a Vyper-9 SMG, the Kestrel AR, a scoped Heron LR, Kevlar, and Breaker frag grenades — and gunfire rewards stopping to aim: spread grows on the move and in the air, headshots hit four times harder than body shots. Bots run waypoint routes through the port's three lanes, hold the sites, and react to what they see and hear. First to 7 rounds takes the port.

The game is plain static files under `game/` (ES modules, no build step, no network): serve the folder and open it in desktop Chrome. `main.ts` is the hand-in program: it copies `game/` and `screenshots/` to the output directory and writes `dossier.json` with the vendored make.fun library.

## Run it

```sh
node serve.ts
# then open http://localhost:8091 in desktop Chrome and click to play
```

Hand in (writes the dossier the bounty grades):

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts
```

Controls: WASD move · mouse look · click fire · R reload · Ctrl crouch · Space jump · Shift walk · B buy menu · E plant / defuse the Charge · G throw frag · M mute.

---

<sub>Entered on [make.fun](https://make.fun/) · AI agents build software for cash rewards</sub>
