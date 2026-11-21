// Phones: which layout the screen gets, the camera that follows the Waiter on an upright phone (FR-12), pinch to zoom
// out, and the gestures a browser would otherwise steal (pinch-zoom of the page, pull-to-refresh, double-tap zoom).
import { setLayout, setScene, setZoom, getZoom, stage } from './scene.js';
import { FOLLOW } from './floor.js';
import { hudBottom } from './hud.js';
import { dock } from './panels.js';

export const touch = { on: false, layout: 'desk', pinch: null, pinched: 0 };
let off = [];

/** desk, landscape (a phone on its side) or portrait (a phone held upright). */
export function layout() {
  const w = innerWidth, h = innerHeight;
  const m = w < 720 && h > w ? 'portrait' : h < 540 ? 'landscape' : 'desk';
  const changed = touch.layout !== m;
  touch.layout = m;
  document.body.dataset.layout = m;
  document.body.classList.toggle('narrow', m !== 'desk');
  const top = hudBottom();
  if (m === 'portrait') { if (changed || !touch.following) setScene('kitchen', { follow: FOLLOW }); touch.following = true; }
  else if (touch.following || changed) { setScene('kitchen'); touch.following = false; }
  setLayout({ side: false, pad: m === 'portrait' ? { l: 2, r: 2, t: top + 4, b: 64 } : m === 'landscape' ? { l: 6, r: 6, t: top + 2, b: 4 } : { l: 10, r: 10, t: top + 6, b: 70 } });
  dock();
}

export function initTouch() {
  touch.following = false; touch.layout = '';
  const add = (t, ev, fn, o) => { t.addEventListener(ev, fn, o); off.push(() => t.removeEventListener(ev, fn, o)); };
  add(window, 'resize', layout);
  add(window, 'orientationchange', () => setTimeout(layout, 250));
  const enable = () => { touch.on = true; document.body.classList.add('touch'); };
  if (matchMedia('(pointer: coarse)').matches) enable();
  add(window, 'touchstart', enable, { passive: true });
  for (const ev of ['gesturestart', 'gesturechange', 'gestureend']) add(document, ev, e => e.preventDefault());
  // two fingers on the floor pinch the camera out (only while it follows the Waiter); one finger never scrolls the page
  const dist = e => Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY);
  add(stage, 'touchstart', e => { if (e.touches.length === 2) touch.pinch = { d: dist(e), z: getZoom() }; }, { passive: true });
  add(stage, 'touchmove', e => {
    if (e.target.tagName === 'CANVAS' || e.touches.length > 1) e.preventDefault();
    if (e.touches.length === 2 && touch.pinch) { setZoom(touch.pinch.z * touch.pinch.d / Math.max(20, dist(e))); touch.pinched = performance.now(); }
  }, { passive: false });
  add(stage, 'touchend', e => { if (e.touches.length < 2) touch.pinch = null; }, { passive: true });
  add(stage, 'contextmenu', e => { if (touch.on) e.preventDefault(); });
  layout();
}
export function disposeTouch() { for (const f of off) f(); off = []; setZoom(1); touch.following = false; }
