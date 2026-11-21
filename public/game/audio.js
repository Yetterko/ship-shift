// WebAudio only: short synth cues, a sizzle that follows the number of cooking chefs, a fire alarm and the last-30-seconds tick.
import { fx, on } from './core.js';

let AC = null, master = null, sizzle = null, alarmT = 0, muted = false;
function ctx() {
  if (AC) return AC;
  try {
    AC = new AudioContext();
    master = AC.createGain(); master.gain.value = muted ? 0 : 0.9; master.connect(AC.destination);
    // sizzle: looped noise through a band-pass, gain set by how many pots are on
    const buf = AC.createBuffer(1, AC.sampleRate * 2, AC.sampleRate), d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * (0.6 + 0.4 * Math.sin(i / 900));
    const src = AC.createBufferSource(); src.buffer = buf; src.loop = true;
    const bp = AC.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 5200; bp.Q.value = 0.7;
    sizzle = AC.createGain(); sizzle.gain.value = 0;
    src.connect(bp).connect(sizzle).connect(master); src.start();
  } catch { AC = null; }
  return AC;
}
const wake = () => { ctx(); if (AC?.state === 'suspended') AC.resume().catch(() => {}); };
addEventListener('keydown', wake, { once: false, passive: true });
addEventListener('pointerdown', wake, { passive: true });

// name: [frequency, seconds, wave, volume, glide-to?]
const CUES = {
  pick: [[620, .05, 'triangle', .09, 880]], drop: [[520, .06, 'triangle', .08, 330]], dash: [[300, .09, 'sawtooth', .03, 90]],
  step: [[160, .03, 'triangle', .02]], door: [[880, .08, 'sine', .05], [1320, .18, 'sine', .05]],
  ask: [[440, .09, 'square', .045], [370, .16, 'square', .045]], yes: [[660, .06, 'triangle', .08], [990, .12, 'triangle', .08]], no: [[330, .1, 'triangle', .07, 220]],
  shout: [[500, .05, 'square', .05, 800], [800, .1, 'square', .04, 600]], sprinkle: [[1800, .04, 'sine', .04], [2200, .04, 'sine', .04], [2600, .06, 'sine', .04]],
  ding: [[1568, .5, 'sine', .11], [2093, .6, 'sine', .05]], buzz: [[150, .22, 'sawtooth', .06], [120, .28, 'sawtooth', .06]],
  clink: [[1900, .05, 'sine', .05], [2500, .09, 'sine', .04]], open: [[500, .05, 'triangle', .05, 700]], approve: [[784, .07, 'triangle', .08], [1175, .16, 'triangle', .08]],
  ship: [[523, .08, 'triangle', .1], [659, .08, 'triangle', .1], [784, .08, 'triangle', .1], [1047, .28, 'triangle', .1]],
  coin: [[1319, .06, 'square', .04], [1976, .2, 'square', .035]], back: [[260, .12, 'sawtooth', .05, 180], [180, .18, 'sawtooth', .05, 120]],
  spoil: [[220, .16, 'sawtooth', .07, 110], [110, .3, 'sawtooth', .07, 70]], frost: [[2400, .08, 'sine', .04, 1200], [1500, .2, 'sine', .04, 900]],
  bell: [[1568, .6, 'sine', .1], [1175, .9, 'sine', .08]], tick: [[1100, .03, 'square', .035]], err: [[150, .16, 'sawtooth', .045]],
  lever: [[240, .05, 'square', .05], [360, .07, 'square', .05]], alarm: [[880, .16, 'square', .05], [660, .16, 'square', .05]], star: [[1047, .1, 'triangle', .09], [1568, .3, 'triangle', .08]],
};
export function sfx(name) {
  fx.sounds++;
  if (muted || !ctx() || AC.state !== 'running') return;
  let t = AC.currentTime;
  for (const [f, d, type, v, to] of CUES[name] || []) {
    const o = AC.createOscillator(), g = AC.createGain();
    o.type = type; o.frequency.setValueAtTime(f, t); if (to) o.frequency.exponentialRampToValueAtTime(to, t + d);
    g.gain.setValueAtTime(v, t); g.gain.exponentialRampToValueAtTime(1e-4, t + d);
    o.connect(g).connect(master); o.start(t); o.stop(t + d + .02); t += d * .8;
  }
}
on('sfx', sfx);

/** Called every frame with what the kitchen sounds like right now. */
export function ambience(dt, { cooking = 0, fires = 0 }) {
  if (sizzle && AC.state === 'running') sizzle.gain.setTargetAtTime(Math.min(0.05, cooking * 0.016), AC.currentTime, 0.4);
  alarmT -= dt;
  if (fires > 0 && alarmT <= 0) { sfx('alarm'); alarmT = 1.1; }
}
export function setMuted(m) { muted = m; if (master) master.gain.value = m ? 0 : 0.9; }
export const isMuted = () => muted;
