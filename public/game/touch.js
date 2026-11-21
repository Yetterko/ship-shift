// Phones and tablets: which layout the screen gets, the thumb stick's picture, the on-screen buttons, and the gestures
// a browser would otherwise steal (pinch, double-tap zoom, pull-to-refresh). The stick itself is read in input.js.
import { $, on } from './core.js';
import { setLayout } from './scene.js';
import { player, setSide } from './world.js';
import { press, stick } from './input.js';
import { redock } from './panels.js';

export const touch = { on: false, layout: 'desk' };

/* ---------- layout: desk, a phone on its side (landscape), or a phone held upright (portrait) ---------- */
export function layout() {
  const w = innerWidth, h = innerHeight;
  const m = w < 820 && h > w ? 'portrait' : h < 540 ? 'landscape' : 'desk';
  touch.layout = m;
  document.body.dataset.layout = m;
  document.body.classList.toggle('narrow', m !== 'desk');
  if (m === 'desk') $('tools').classList.remove('open');
  // measured, because the walkthrough's steps add a second row to the HUD on an upright phone
  const hud = Math.round(document.querySelector('.hud').getBoundingClientRect().bottom);
  document.documentElement.style.setProperty('--hud-b', `${hud}px`);      // the visiting banner hangs just under the HUD
  setSide(m === 'portrait', m !== 'desk');
  setLayout({
    side: m === 'portrait', cap: m === 'desk' ? 0 : 5,
    pad: m === 'portrait' ? { l: 0, r: 0, t: hud - 4, b: 70 } : m === 'landscape' ? { l: 6, r: 6, t: hud - 6, b: 4 } : { l: 10, r: 10, t: null, b: 8 },
  });
  redock();
}
addEventListener('resize', layout);
addEventListener('orientationchange', () => setTimeout(layout, 250));
on('layout', layout);

function enable() {
  if (touch.on) return;
  touch.on = true;
  document.body.classList.add('touch');
  layout();
}
if (matchMedia('(pointer: coarse)').matches) enable();
setTimeout(() => $('stickHint').classList.add('gone'), 12000);
addEventListener('touchstart', enable, { once: true, passive: true });

/* ---------- the buttons: pressed on touch-down, so a thumb on the stick and a thumb on USE work together ---------- */
for (const b of document.querySelectorAll('.pad [data-tk]')) {
  b.addEventListener('pointerdown', e => {
    e.preventDefault();
    b.classList.add('down'); b.dataset.presses = Number(b.dataset.presses || 0) + 1; setTimeout(() => b.classList.remove('down'), 140);
    press(b.dataset.tk);
  });
  b.addEventListener('contextmenu', e => e.preventDefault());
}
$('urgentBtn').onclick = () => press('Tab');
$('menuBtn').onclick = () => { const open = $('tools').classList.toggle('open'); $('menuBtn').setAttribute('aria-expanded', String(open)); };
$('tools').addEventListener('click', () => $('tools').classList.remove('open'));
document.addEventListener('pointerdown', e => { if (!e.target.closest('#tools, #menuBtn')) $('tools').classList.remove('open'); });

/* ---------- gestures the page keeps for itself ---------- */
for (const ev of ['gesturestart', 'gesturechange', 'gestureend']) document.addEventListener(ev, e => e.preventDefault());
// two fingers on the kitchen are a stick and a tap, never a pinch; a drag down from the top is a walk, never a refresh
$('stage').addEventListener('touchmove', e => { if (e.target.tagName === 'CANVAS' || e.touches.length > 1) e.preventDefault(); }, { passive: false });
// double-tap zoom is turned off in the stylesheet (touch-action), which leaves fast repeated taps on a button alone
$('stage').addEventListener('contextmenu', e => { if (touch.on) e.preventDefault(); });

/* ---------- every frame: where the stick is drawn, and which buttons mean something right now ---------- */
let seenT = 0, hintGone = false;
export function touchFrame() {
  const on = stick.id !== null;
  if ($('thumb').hidden === on) $('thumb').hidden = !on;
  if (on) {
    $('thumb').style.transform = `translate(${Math.round(stick.ox)}px,${Math.round(stick.oy)}px)`;
    $('thumbKnob').style.transform = `translate(${Math.round(stick.kx)}px,${Math.round(stick.ky)}px)`;
    if (!hintGone) { hintGone = true; $('stickHint').classList.add('gone'); }
  }
  if (!touch.on || performance.now() - seenT < 120) return;
  seenT = performance.now();
  // the focus card already knows what each key would do here; the buttons follow it
  const hint = k => document.querySelector(`#cardBody [data-k="${k}"]`);
  const use = $('card').classList.contains('quiet') ? null : hint('E');
  const text = use ? use.textContent.replace(/^E/, '').trim() : '';
  if ($('tActHint').textContent !== text) $('tActHint').textContent = text;
  $('tAct').classList.toggle('idle', !use);
  $('tAct').classList.toggle('want', !!document.querySelector('.gd.near'));
  const stats = `${$('mBlocked').textContent} chefs waiting · ${$('mShipped').textContent} shipped · ${$('mSpend').textContent}`;
  if ($('menuStats').textContent !== stats) $('menuStats').textContent = stats;
  const drop = !!player.carry, call = !!hint('F');
  if ($('tDrop').hidden === drop) $('tDrop').hidden = !drop;
  if ($('tCall').hidden === call) $('tCall').hidden = !call;
}
layout();
