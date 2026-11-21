// WebAudio only: short synth cues, a sizzle that follows the number of cooking chefs, a smoke warning, a fire alarm and the last-30-seconds tick.
// Everything goes through one compressor, so a busy moment (a ship, a coin and a bell at once) gets denser instead of louder.
import { fx, on, store } from './core.js';

const LEVEL = 0.8;
let AC = null, master = null, sizzle = null, alarmT = 0, smokeT = 0, muted = store.get('muted') === '1';
function ctx() {
  if (AC) return AC;
  try {
    AC = new AudioContext();
    const squash = AC.createDynamicsCompressor();
    squash.threshold.value = -18; squash.knee.value = 12; squash.ratio.value = 5; squash.attack.value = 0.004; squash.release.value = 0.2;
    master = AC.createGain(); master.gain.value = muted ? 0 : LEVEL;
    master.connect(squash).connect(AC.destination);
    // sizzle: looped noise through a band-pass, gain set by how many pots are on
    const buf = AC.createBuffer(1, AC.sampleRate * 2, AC.sampleRate), d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * (0.6 + 0.4 * Math.sin(i / 900));
    const src = AC.createBufferSource(); src.buffer = buf; src.loop = true;
    const bp = AC.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 4600; bp.Q.value = 0.8;
    sizzle = AC.createGain(); sizzle.gain.value = 0;
    src.connect(bp).connect(sizzle).connect(master); src.start();
  } catch { AC = null; }
  return AC;
}
let unlocked = false;
const wake = () => {
  if (document.hidden) return;
  ctx(); if (!AC) return;
  if (AC.state !== 'running') AC.resume().catch(() => {});
  // iOS only lets sound start inside a touch: one silent sample played from the first tap unlocks everything after it
  if (!unlocked) { unlocked = true; try { const s = AC.createBufferSource(); s.buffer = AC.createBuffer(1, 1, 22050); s.connect(AC.destination); s.start(0); } catch { /* still locked */ } }
};
for (const ev of ['keydown', 'pointerdown', 'pointerup', 'touchend', 'click']) addEventListener(ev, wake, { passive: true, capture: true });
// a phone that locks, or a tab left behind, goes quiet at once and picks up where it was
document.addEventListener('visibilitychange', () => { if (!AC) return; if (document.hidden) AC.suspend().catch(() => {}); else AC.resume().catch(() => {}); });

// name: [frequency, seconds, wave, volume, glide-to?, starts-at?]. Without a start time a note follows the one before it.
// Three loudness bands: things you did (quiet), things that happened (medium), things that matter (loud).
const CUES = {
  pick: [[620, .05, 'triangle', .06, 880]], drop: [[520, .06, 'triangle', .055, 330]], dash: [[300, .09, 'sawtooth', .022, 90]],
  step: [[160, .03, 'triangle', .02]], door: [[880, .08, 'sine', .04], [1320, .18, 'sine', .04]],
  open: [[500, .05, 'triangle', .045, 700]], lever: [[240, .05, 'square', .04], [360, .07, 'square', .04]],
  sprinkle: [[1800, .04, 'sine', .035], [2200, .04, 'sine', .035], [2600, .06, 'sine', .035]],
  shout: [[500, .05, 'square', .04, 800], [800, .1, 'square', .032, 600]],
  yes: [[660, .06, 'triangle', .07], [990, .12, 'triangle', .07]], no: [[330, .1, 'triangle', .06, 220]],
  clink: [[1900, .05, 'sine', .045], [2500, .09, 'sine', .035]], coin: [[1319, .06, 'square', .03], [1976, .2, 'square', .026]],
  ask: [[523, .09, 'triangle', .075], [392, .18, 'triangle', .075]],
  ding: [[1568, .5, 'sine', .09], [2093, .6, 'sine', .04, 0, 0]], buzz: [[150, .22, 'sawtooth', .05], [120, .28, 'sawtooth', .05]],
  approve: [[784, .07, 'triangle', .075], [1175, .16, 'triangle', .075]],
  back: [[260, .12, 'sawtooth', .042, 180], [180, .18, 'sawtooth', .042, 120]],
  spoil: [[220, .16, 'sawtooth', .06, 110], [110, .3, 'sawtooth', .06, 70]], frost: [[2400, .08, 'sine', .04, 1200], [1500, .22, 'sine', .04, 900], [3100, .3, 'sine', .02, 0, .05]],
  // the ship: a rising arpeggio with a fifth under it and a sparkle on top
  ship: [[523, .09, 'triangle', .1], [659, .09, 'triangle', .1], [784, .09, 'triangle', .1], [1047, .42, 'triangle', .11], [262, .5, 'sine', .07, 0, 0], [392, .42, 'sine', .05, 0, .21], [2093, .3, 'sine', .03, 0, .3], [2637, .35, 'sine', .022, 0, .38]],
  bell: [[1568, .6, 'sine', .09], [1175, .9, 'sine', .07]], tick: [[1100, .03, 'square', .028]], err: [[150, .16, 'sawtooth', .04]],
  smoke: [[700, .07, 'triangle', .04], [700, .07, 'triangle', .04, 0, .14]],
  alarm: [[880, .14, 'square', .038], [660, .14, 'square', .038]],
  star: [[1047, .1, 'triangle', .085], [1568, .3, 'triangle', .075]],
  fanfare: [[523, .12, 'triangle', .09], [659, .12, 'triangle', .09], [784, .12, 'triangle', .09], [1047, .5, 'triangle', .1], [330, .7, 'sine', .05, 0, .3], [1319, .45, 'sine', .04, 0, .36]],
  start: [[392, .08, 'triangle', .08], [523, .08, 'triangle', .08], [784, .22, 'triangle', .09]],
};
export function sfx(name, delay = 0) {
  fx.sounds++;
  if (muted || !ctx() || AC.state !== 'running') return;
  const t0 = AC.currentTime + delay; let t = t0;
  for (const [f, d, type, v, to, at] of CUES[name] || []) {
    const start = at === undefined ? t : t0 + at;
    const o = AC.createOscillator(), g = AC.createGain();
    o.type = type; o.frequency.setValueAtTime(f, start); if (to) o.frequency.exponentialRampToValueAtTime(to, start + d);
    g.gain.setValueAtTime(1e-4, start); g.gain.exponentialRampToValueAtTime(v, start + 0.006); g.gain.exponentialRampToValueAtTime(1e-4, start + d);
    o.connect(g).connect(master); o.start(start); o.stop(start + d + .02);
    if (at === undefined) t += d * .8;
  }
}
on('sfx', sfx);

/** Called every frame with what the kitchen sounds like right now. */
export function ambience(dt, { cooking = 0, fires = 0, smoking = 0 }) {
  if (sizzle && AC.state === 'running') sizzle.gain.setTargetAtTime(Math.min(0.034, cooking * 0.012), AC.currentTime, 0.4);
  alarmT -= dt; smokeT -= dt;
  if (fires > 0) { if (alarmT <= 0) { sfx('alarm'); alarmT = 1.5; } }
  else if (smoking > 0 && smokeT <= 0) { sfx('smoke'); smokeT = 2.6; }
}
export function setMuted(m) { muted = m; store.set('muted', m ? '1' : '0'); if (master) master.gain.setTargetAtTime(m ? 0 : LEVEL, AC.currentTime, 0.02); }
export const isMuted = () => muted;
