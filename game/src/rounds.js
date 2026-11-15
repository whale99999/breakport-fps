// rounds.js — the match referee: buy/live/planted/end/matchover phases, the
// round and Charge clocks, win checks, the economy, and the Charge prop's
// placement. First to 7 round wins takes the match (12-round soft cap: a
// tied 12th round sends the match to a decider).
import { S, CFG, TEAM, aliveCount, pushFeed, setBanner } from './state.js';
import { sfxPlant, sfxBeep, sfxSting } from './audio.js';

export function createRounds(world, botsApi) {
  let matchDecided = false;

  function startMatch() {
    S.score.jackals = 0; S.score.wardens = 0;
    S.round = 0;
    S.matchWinner = null;
    S.money = CFG.startMoney;
    S.player.resetForMatch();
    matchDecided = false;
    startRound();
  }

  function startRound() {
    S.round += 1;
    S.phase = 'buy';
    S.phaseT = CFG.buyTime;
    S.roundWinner = null;
    S.targetSite = Math.random() < 0.5 ? 'A' : 'B';
    S.player.resetForRound();
    botsApi.assignRound();
    // The player carries the Charge most rounds; sometimes a Jackal bot does,
    // and then the squad pushes the called site and the bot plants.
    const jackals = S.bots.filter((b) => b.team === TEAM.ATK);
    const carrier = Math.random() < 0.62 || !jackals.length ? 'player' : jackals[Math.floor(Math.random() * jackals.length)];
    S.charge.state = 'carried';
    S.charge.carrier = carrier;
    S.charge.site = null;
    setBanner(
      `ROUND ${S.round}`,
      carrier === 'player' ? 'You carry the Charge — plant it at A or B' : `${carrier.name} carries the Charge — cover the push to ${S.targetSite}`,
      3,
    );
  }

  function endRound(winner, reason) {
    if (S.phase === 'end' || S.phase === 'matchover') return;
    S.phase = 'end';
    S.phaseT = CFG.endTime;
    S.roundWinner = winner;
    S.roundReason = reason;
    S.score[winner] += 1;
    const playerWon = winner === TEAM.ATK;
    let pay = playerWon ? CFG.winReward : CFG.lossReward;
    // Detonation/defuse team bonus: only a Jackal detonation pays the player.
    if (reason === 'detonation' && winner === TEAM.ATK) pay += CFG.bonusReward;
    S.money = Math.min(CFG.maxMoney, S.money + pay);
    const label = { detonation: 'CHARGE DETONATED', defused: 'CHARGE DEFUSED', elimination: 'ELIMINATION', time: 'TIME EXPIRED' }[reason];
    setBanner(playerWon ? 'ROUND WON' : 'ROUND LOST', `${winner === TEAM.ATK ? 'Jackals' : 'Wardens'} — ${label} · +$${pay}`, 3.6);
    sfxSting(playerWon);
    matchDecided = S.score.jackals >= CFG.winTarget || S.score.wardens >= CFG.winTarget ||
      (S.round >= CFG.maxRounds && S.score.jackals !== S.score.wardens);
  }

  // --- Charge events (registered for player.js / bots.js) ----------------------
  function onPlanted(site, x, z, planter) {
    S.charge.state = 'planted';
    S.charge.site = site;
    S.charge.x = x; S.charge.z = z;
    S.charge.carrier = null;
    S.charge.beepT = 0;
    S.phase = 'planted';
    S.roundT = CFG.chargeTime;
    if (!planter || planter === 'player') {
      S.money = Math.min(CFG.maxMoney, S.money + CFG.plantReward);
      pushFeed(`You planted the Charge at ${site} · +$${CFG.plantReward}`, 'good');
    } else {
      pushFeed(`${planter.name} planted the Charge at ${site}`, 'good');
    }
    setBanner('CHARGE PLANTED', `${CFG.chargeTime} seconds to detonation`, 2.4);
    sfxPlant();
  }
  function onDefused() {
    S.charge.state = 'gone';
    pushFeed('The Charge was defused', 'bad');
    endRound(TEAM.DEF, 'defused');
  }
  function onCarrierDown(x, z) {
    S.charge.state = 'dropped';
    S.charge.carrier = null;
    S.charge.x = x; S.charge.z = z;
    pushFeed('The Charge was dropped', '');
  }
  S.refs.onPlanted = onPlanted;
  S.refs.onDefused = onDefused;
  S.refs.onCarrierDown = onCarrierDown;

  // --- per-step update -------------------------------------------------------------
  function update(dt) {
    // Charge prop follows its carrier, or rests where it fell / was planted.
    const c = S.charge, mesh = world.chargeMesh;
    if (c.state === 'carried') {
      const p = c.carrier === 'player' ? S.player.pos : (c.carrier ? c.carrier.pos : null);
      if (p) { mesh.position.set(p.x, 0.16, p.z); mesh.visible = true; }
    } else if (c.state === 'dropped' || c.state === 'planted') {
      mesh.position.set(c.x, 0.16, c.z);
      mesh.visible = true;
    } else mesh.visible = false;
    if (c.state === 'planted') {
      // beeps accelerate as the clock runs down; the prop light pulses with them
      c.beepT -= dt;
      const rate = S.roundT > 10 ? 1 : S.roundT > 5 ? 0.5 : 0.22;
      if (c.beepT <= 0) { c.beepT = rate; sfxBeep(S.roundT <= 5); }
      world.clight.material.emissiveIntensity = c.beepT < 0.09 ? 3.2 : 0.5;
    }

    if (S.phase === 'buy') {
      S.phaseT -= dt;
      if (S.phaseT <= 0) {
        S.phase = 'live';
        S.roundT = CFG.roundTime;
        setBanner(S.charge.carrier === 'player' ? 'PLANT THE CHARGE' : 'BACK THE PUSH', `Site ${S.targetSite} is the call · first to ${CFG.winTarget}`, 2.2);
      }
    } else if (S.phase === 'live') {
      S.roundT -= dt;
      if (aliveCount(TEAM.DEF) === 0) endRound(TEAM.ATK, 'elimination');
      else if (aliveCount(TEAM.ATK) === 0) endRound(TEAM.DEF, 'elimination');
      else if (S.roundT <= 0) endRound(TEAM.DEF, 'time');
    } else if (S.phase === 'planted') {
      S.roundT -= dt;
      if (aliveCount(TEAM.DEF) === 0) endRound(TEAM.ATK, 'elimination');
      else if (S.roundT <= 0) {
        S.refs.explodeAt(S.charge.x, 1, S.charge.z, 13, 220, 'charge');
        S.charge.state = 'gone';
        endRound(TEAM.ATK, 'detonation');
      }
    } else if (S.phase === 'end') {
      S.phaseT -= dt;
      if (S.phaseT <= 0) {
        if (matchDecided) {
          S.phase = 'matchover';
          S.matchWinner = S.score.jackals > S.score.wardens ? TEAM.ATK : TEAM.DEF;
          setBanner(S.matchWinner === TEAM.ATK ? 'MATCH WON' : 'MATCH LOST',
            `Jackals ${S.score.jackals} — ${S.score.wardens} Wardens`, 6);
          sfxSting(S.matchWinner === TEAM.ATK);
        } else startRound();
      }
    }
  }

  return { update, startMatch, startRound };
}
