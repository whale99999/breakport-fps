// hud.js — every DOM element of the HUD: health/armour, ammo and money, the
// round clock and score strip, killfeed, hitmarker, damage flash, the
// spread-aware crosshair, banners, the plant channel bar, the buy menu, the
// top-down minimap, and the start / resume / match-end overlays. It only
// reads GameState and writes the DOM when a value actually changed.
import { S, CFG, TEAM, aliveCount } from './state.js';
import { WEAPONS, FX } from './weapons.js';
import { toggleMute } from './audio.js';

const $ = (id) => document.getElementById(id);

const BUY_ITEMS = [
  { key: 'vyper', label: 'Vyper-9', sub: 'SMG · auto', price: 1200 },
  { key: 'kestrel', label: 'Kestrel AR', sub: 'Rifle · auto', price: 2700 },
  { key: 'heron', label: 'Heron LR', sub: 'Sniper · scope', price: 4300 },
  { key: 'kevlar', label: 'Kevlar', sub: 'Armour · torso', price: 650 },
  { key: 'helmet', label: 'Kevlar + Helmet', sub: 'Armour · full', price: 1000 },
  { key: 'frag', label: 'Breaker Frag', sub: 'Grenade · max 2', price: 300 },
];

export function createHud(input, callbacks, shotMode = false) {
  const el = {
    hpFill: $('hp-fill'), hpText: $('hp-text'), armor: $('armor-label'),
    ammoMag: $('ammo-mag'), ammoRes: $('ammo-res'), weapon: $('weapon-name'), money: $('money'),
    timer: $('timer'), phase: $('phase-label'), scoreJ: $('score-j'), scoreW: $('score-w'),
    aliveJ: $('alive-j'), aliveW: $('alive-w'), round: $('round-label'),
    feed: $('killfeed'), hit: $('hitmarker'), dmg: $('dmgflash'), scope: $('scope'),
    banner: $('banner'), bannerTitle: $('banner-title'), bannerSub: $('banner-sub'),
    channel: $('channel'), channelFill: $('channel-fill'), channelLabel: $('channel-label'),
    hint: $('hint'), buy: $('buymenu'), buyGrid: $('buy-grid'), buyMoney: $('buy-money'), buyTimer: $('buy-timer'),
    start: $('overlay-start'), resume: $('overlay-resume'), end: $('overlay-end'),
    endTitle: $('end-title'), endScore: $('end-score'), cross: $('crosshair'),
    map: $('minimap'),
  };
  const mapCtx = el.map.getContext('2d');
  const ticks = el.cross.children;
  let buyOpen = false, wasPhase = '', lastFeedKey = '', cache = {};
  let started = false, endShown = false;

  // --- buy menu DOM -------------------------------------------------------------
  const buyButtons = BUY_ITEMS.map((item, i) => {
    const b = document.createElement('button');
    b.className = 'buy-item';
    b.innerHTML = `<span class="buy-key">${i + 1}</span><span class="buy-name">${item.label}</span>` +
      `<span class="buy-sub">${item.sub}</span><span class="buy-price">$${item.price}</span>`;
    b.addEventListener('click', () => { if (S.player.buy(item.key)) refreshBuy(); });
    el.buyGrid.appendChild(b);
    return b;
  });
  function itemState(item) {
    const L = S.player.loadout;
    if (item.key === 'kevlar') return { owned: S.player.armor >= 1, price: 650 };
    if (item.key === 'helmet') return { owned: S.player.armor >= 2, price: S.player.armor === 1 ? 350 : 1000 };
    if (item.key === 'frag') return { owned: L.grenades >= 2, price: 300 };
    return { owned: !!L.owned[item.key], price: item.price };
  }
  function refreshBuy() {
    BUY_ITEMS.forEach((item, i) => {
      const st = itemState(item);
      const b = buyButtons[i];
      b.disabled = st.owned || S.money < st.price;
      b.classList.toggle('owned', st.owned);
      b.querySelector('.buy-price').textContent = st.owned ? 'OWNED' : `$${st.price}`;
    });
    el.buyMoney.textContent = `$${S.money}`;
  }

  $('play').addEventListener('click', () => { started = true; callbacks.onPlay(); });
  $('resume-btn').addEventListener('click', () => callbacks.onPlay());
  $('again').addEventListener('click', () => { endShown = false; callbacks.onPlayAgain(); });

  window.addEventListener('keydown', (e) => {
    if (e.code === 'KeyM') toggleMute();
    if (S.phase !== 'buy' || !started) return;
    if (e.code === 'KeyB' || e.code === 'Escape') { buyOpen = !buyOpen && e.code === 'KeyB'; if (e.code === 'Escape') buyOpen = false; }
    if (buyOpen && e.code.startsWith('Digit')) {
      const i = Number(e.code.slice(5)) - 1;
      if (BUY_ITEMS[i] && S.player.buy(BUY_ITEMS[i].key)) refreshBuy();
    }
  });

  function setText(node, key, value) {
    if (cache[key] !== value) { cache[key] = value; node.textContent = value; }
  }
  function fmt(t) {
    t = Math.max(0, Math.ceil(t));
    return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
  }

  // --- minimap ----------------------------------------------------------------------
  function drawMap() {
    const g = mapCtx, W = el.map.width, H = el.map.height;
    const sx = (x) => (x + 62) / 124 * W, sz = (z) => (z + 44) / 88 * H;
    g.fillStyle = '#22252b'; g.fillRect(0, 0, W, H);
    g.fillStyle = '#3a3f47';
    for (const c of S.world.colliders) g.fillRect(sx(c.x0), sz(c.z0), Math.max(2, (c.x1 - c.x0) / 124 * W), Math.max(2, (c.z1 - c.z0) / 88 * H));
    for (const key of ['A', 'B']) {
      const st = S.world.sites[key];
      g.strokeStyle = key === 'A' ? '#e06a28' : '#27a294';
      g.lineWidth = 1.6;
      g.beginPath(); g.arc(sx(st.x), sz(st.z), st.r / 124 * W, 0, Math.PI * 2); g.stroke();
      g.fillStyle = g.strokeStyle; g.font = 'bold 10px system-ui';
      g.fillText(key, sx(st.x) - 3, sz(st.z) + 3);
    }
    if (S.charge.state === 'dropped' || S.charge.state === 'planted') {
      g.fillStyle = '#ffdf5e';
      g.fillRect(sx(S.charge.x) - 2.5, sz(S.charge.z) - 2.5, 5, 5);
    }
    g.fillStyle = '#e06a28';
    for (const b of S.bots) if (b.alive && b.team === TEAM.ATK) {
      g.beginPath(); g.arc(sx(b.pos.x), sz(b.pos.z), 2.4, 0, Math.PI * 2); g.fill();
    }
    // the player: a wedge pointing along the view yaw
    const px = sx(S.player.pos.x), pz = sz(S.player.pos.z);
    const a = Math.atan2(-Math.cos(S.player.yaw), -Math.sin(S.player.yaw));
    g.save(); g.translate(px, pz); g.rotate(a);
    g.fillStyle = '#ffe3b3';
    g.beginPath(); g.moveTo(6, 0); g.lineTo(-4, -3.6); g.lineTo(-4, 3.6); g.closePath(); g.fill();
    g.restore();
  }

  // --- per-frame update -----------------------------------------------------------------
  function update() {
    const p = S.player;
    if (!p) return;
    // phase transitions: open the buy menu each buy phase, close it after
    if (S.phase !== wasPhase) {
      if (S.phase === 'buy') { buyOpen = true; refreshBuy(); }
      if (S.phase === 'live') buyOpen = false;
      wasPhase = S.phase;
    }

    // health + armour
    el.hpFill.style.width = `${Math.max(0, p.hp)}%`;
    el.hpFill.style.background = p.hp > 50 ? '#7fc46a' : p.hp > 25 ? '#e0a83c' : '#d84f35';
    setText(el.hpText, 'hp', `${Math.ceil(Math.max(0, p.hp))}`);
    setText(el.armor, 'armor', p.armor === 2 ? 'KEVLAR + HELMET' : p.armor === 1 ? 'KEVLAR' : '');
    el.dmg.style.opacity = S.time - p.hurtT < 0.35 ? String(0.55 * (1 - (S.time - p.hurtT) / 0.35)) : (p.hp < 30 && p.alive ? '0.22' : '0');

    // weapon + ammo + money
    const cur = p.loadout.current;
    if (cur === 'grenade') {
      setText(el.weapon, 'w', 'Breaker Frag');
      setText(el.ammoMag, 'am', `${p.loadout.grenades}`);
      setText(el.ammoRes, 'ar', '');
    } else {
      const w = WEAPONS[cur], st = p.loadout.state[cur];
      setText(el.weapon, 'w', w.name);
      setText(el.ammoMag, 'am', w.mag ? `${st.mag}` : '—');
      setText(el.ammoRes, 'ar', w.mag ? `/ ${st.reserve}` : '');
    }
    setText(el.money, 'm', `$${S.money}`);

    // clock + score
    const clock = S.phase === 'buy' ? S.phaseT : S.roundT;
    setText(el.timer, 't', S.phase === 'idle' || S.phase === 'matchover' ? '—' : fmt(clock));
    el.timer.style.color = S.phase === 'planted' ? '#ff6a4d' : '';
    setText(el.phase, 'ph', { idle: 'BREAKPORT', buy: 'BUY PHASE — press B', live: 'ROUND LIVE', planted: 'CHARGE PLANTED', end: 'ROUND OVER', matchover: 'MATCH OVER' }[S.phase]);
    setText(el.scoreJ, 'sj', `${S.score.jackals}`);
    setText(el.scoreW, 'sw', `${S.score.wardens}`);
    setText(el.round, 'r', `ROUND ${Math.max(1, S.round)} · FIRST TO ${CFG.winTarget}`);
    setText(el.aliveJ, 'aj', '●'.repeat(aliveCount(TEAM.ATK)));
    setText(el.aliveW, 'aw', '●'.repeat(aliveCount(TEAM.DEF)));

    // crosshair spread + hitmarker + scope
    const spreadDeg = S.weapons ? S.weapons.currentSpreadOf() : 1;
    const gap = 7 + spreadDeg * 130;
    ticks[0].style.transform = `translate(-50%, ${-gap - 7}px)`;
    ticks[1].style.transform = `translate(-50%, ${gap}px)`;
    ticks[2].style.transform = `translate(${-gap - 7}px, -50%)`;
    ticks[3].style.transform = `translate(${gap}px, -50%)`;
    el.cross.style.opacity = p.alive && !p.zoomed && started ? '1' : '0';
    const hitAge = S.time - FX.hitT;
    el.hit.style.opacity = hitAge < 0.13 ? '1' : '0';
    el.hit.classList.toggle('head', FX.hitHead);
    el.scope.style.opacity = p.zoomed ? '1' : '0';

    // banner
    if (S.banner && S.time < S.banner.until) {
      el.banner.style.opacity = '1';
      setText(el.bannerTitle, 'bt', S.banner.title);
      setText(el.bannerSub, 'bs', S.banner.sub);
    } else el.banner.style.opacity = '0';

    // plant channel + context hint
    if (p.channel.active) {
      el.channel.style.opacity = '1';
      el.channelFill.style.width = `${Math.min(100, p.channel.t / p.channel.need * 100)}%`;
      setText(el.channelLabel, 'cl', p.channel.kind === 'plant' ? 'PLANTING THE CHARGE…' : 'DEFUSING…');
      setText(el.hint, 'h', '');
    } else {
      el.channel.style.opacity = '0';
      let hint = '';
      if (S.phase === 'live' && S.charge.state === 'carried' && S.charge.carrier === 'player') {
        for (const key of ['A', 'B']) {
          const st = S.world.sites[key];
          if (Math.hypot(p.pos.x - st.x, p.pos.z - st.z) < st.r) hint = `Hold E to plant the Charge at ${key}`;
        }
        if (!hint) hint = 'Carry the Charge to site A or B';
      } else if (S.phase === 'live' && S.charge.state === 'dropped') hint = 'The Charge is down — recover it';
      else if (S.phase === 'buy') hint = 'Buy with B · the round starts soon';
      setText(el.hint, 'h', hint);
    }

    // killfeed
    const feedKey = S.feed.length + '|' + (S.feed.length ? S.feed[S.feed.length - 1].t : 0);
    if (feedKey !== lastFeedKey) {
      lastFeedKey = feedKey;
      el.feed.innerHTML = S.feed.slice(-5).map((f) => `<div class="feed-line ${f.cls}">${f.text}</div>`).join('');
    }

    // buy menu
    const showBuy = buyOpen && S.phase === 'buy' && p.alive;
    el.buy.style.display = showBuy ? 'block' : 'none';
    if (showBuy) setText(el.buyTimer, 'bt2', `Round starts in ${Math.ceil(S.phaseT)}s · $${S.money}`);

    // overlays
    el.start.style.display = !started ? 'grid' : 'none';
    el.resume.style.display = started && !input.locked && !shotMode && S.phase !== 'matchover' && S.phase !== 'idle' ? 'grid' : 'none';
    if (S.phase === 'matchover' && !endShown) {
      endShown = true;
      if (document.pointerLockElement) document.exitPointerLock();
      el.endTitle.textContent = S.matchWinner === TEAM.ATK ? 'JACKALS TAKE THE PORT' : 'WARDENS HOLD THE PORT';
      el.endScore.textContent = `Jackals ${S.score.jackals} — ${S.score.wardens} Wardens`;
    }
    el.end.style.display = S.phase === 'matchover' ? 'grid' : 'none';

    drawMap();
  }

  return { update };
}
