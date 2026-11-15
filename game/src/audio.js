// audio.js — every sound is synthesized with WebAudio at play time: no audio
// files, no network. One master gain, M toggles mute. Distant sounds pass a
// distance (metres) and are attenuated and low-passed so gunfire reads as
// near or far.
let ctx = null;
let master = null;
let noiseBuf = null;
let muted = false;

export function initAudio() {
  if (ctx) return;
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return;
  ctx = new AC();
  master = ctx.createGain();
  master.gain.value = 0.5;
  master.connect(ctx.destination);
  noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 0.5, ctx.sampleRate);
  const d = noiseBuf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
}

export function resumeAudio() { if (ctx && ctx.state === 'suspended') ctx.resume(); }
export function toggleMute() { muted = !muted; if (master) master.gain.value = muted ? 0 : 0.5; return muted; }

// A routed output for one sound: gain (+ optional lowpass) by distance.
function out(dist) {
  const g = ctx.createGain();
  if (dist && dist > 4) {
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = Math.max(500, 5200 - dist * 90);
    g.gain.value = Math.min(1, 14 / dist);
    g.connect(f); f.connect(master);
  } else {
    g.gain.value = 1;
    g.connect(master);
  }
  return g;
}

function noise(dest, t0, dur, vol, freq, q = 1) {
  const src = ctx.createBufferSource();
  src.buffer = noiseBuf;
  src.loop = true;
  const f = ctx.createBiquadFilter();
  f.type = 'bandpass'; f.frequency.value = freq; f.Q.value = q;
  const g = ctx.createGain();
  g.gain.setValueAtTime(vol, t0);
  g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
  src.connect(f); f.connect(g); g.connect(dest);
  src.start(t0); src.stop(t0 + dur + 0.05);
}

function tone(dest, t0, type, f0, f1, dur, vol) {
  const o = ctx.createOscillator();
  o.type = type;
  o.frequency.setValueAtTime(f0, t0);
  o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t0 + dur);
  const g = ctx.createGain();
  g.gain.setValueAtTime(vol, t0);
  g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
  o.connect(g); g.connect(dest);
  o.start(t0); o.stop(t0 + dur + 0.05);
}

function ready(dist) { return ctx && !muted ? out(dist || 0) : null; }

// Gunshots differ by class: pistol crack, smg chatter, rifle boom, sniper crack-boom.
export function sfxShot(kind, dist) {
  const d = ready(dist); if (!d) return;
  const t = ctx.currentTime;
  if (kind === 'sniper') { noise(d, t, 0.32, 0.9, 900, 0.6); tone(d, t, 'triangle', 160, 40, 0.3, 0.7); }
  else if (kind === 'rifle') { noise(d, t, 0.16, 0.75, 1300, 0.7); tone(d, t, 'triangle', 200, 55, 0.16, 0.5); }
  else if (kind === 'smg') { noise(d, t, 0.1, 0.6, 1900, 0.8); tone(d, t, 'triangle', 240, 80, 0.09, 0.35); }
  else { noise(d, t, 0.12, 0.65, 1600, 0.8); tone(d, t, 'triangle', 220, 70, 0.11, 0.4); }
}
export function sfxDry(dist) { const d = ready(dist); if (d) tone(d, ctx.currentTime, 'square', 1400, 900, 0.04, 0.12); }
export function sfxReload(dist) {
  const d = ready(dist); if (!d) return; const t = ctx.currentTime;
  tone(d, t, 'square', 500, 300, 0.05, 0.15);
  tone(d, t + 0.14, 'square', 700, 380, 0.05, 0.15);
  tone(d, t + 0.3, 'square', 900, 500, 0.06, 0.2);
}
export function sfxSwing(dist) { const d = ready(dist); if (d) noise(d, ctx.currentTime, 0.12, 0.25, 700, 2); }
export function sfxHit(head) {
  const d = ready(0); if (!d) return; const t = ctx.currentTime;
  tone(d, t, 'sine', head ? 1560 : 1050, head ? 1200 : 900, 0.07, 0.25);
}
export function sfxHurt() { const d = ready(0); if (d) tone(d, ctx.currentTime, 'sawtooth', 180, 90, 0.12, 0.12); }
export function sfxStep(run) {
  const d = ready(0); if (!d) return;
  noise(d, ctx.currentTime, 0.07, run ? 0.1 : 0.05, 300 + Math.random() * 120, 1.4);
}
export function sfxBounce(dist) { const d = ready(dist); if (d) tone(d, ctx.currentTime, 'sine', 300, 140, 0.08, 0.3); }
export function sfxExplosion(dist) {
  const d = ready(dist); if (!d) return; const t = ctx.currentTime;
  noise(d, t, 0.8, 1.0, 220, 0.4);
  tone(d, t, 'sine', 120, 28, 0.85, 0.9);
  noise(d, t + 0.03, 0.25, 0.5, 1500, 0.5);
}
export function sfxBeep(fast) { const d = ready(0); if (d) tone(d, ctx.currentTime, 'square', fast ? 1320 : 990, fast ? 1320 : 990, 0.07, 0.12); }
export function sfxPlant() { const d = ready(0); if (!d) return; const t = ctx.currentTime; tone(d, t, 'square', 660, 660, 0.06, 0.15); tone(d, t + 0.1, 'square', 880, 880, 0.06, 0.15); tone(d, t + 0.2, 'square', 1100, 1100, 0.09, 0.18); }
export function sfxBuy() { const d = ready(0); if (!d) return; const t = ctx.currentTime; tone(d, t, 'sine', 880, 880, 0.06, 0.18); tone(d, t + 0.07, 'sine', 1320, 1320, 0.09, 0.18); }
export function sfxDenied() { const d = ready(0); if (d) tone(d, ctx.currentTime, 'square', 220, 160, 0.12, 0.15); }
export function sfxSting(win) {
  const d = ready(0); if (!d) return; const t = ctx.currentTime;
  const seq = win ? [392, 523, 659] : [330, 262, 196];
  for (let i = 0; i < 3; i++) tone(d, t + i * 0.16, 'triangle', seq[i], seq[i], 0.22, 0.22);
}
