// Walking in the park: tap or click the lawn to walk there, WASD or the arrows, E at a door. Tapping a sign walks in.
//
//   initParkInput({ onSign })   onSign(floorId) when a building's sign is tapped; listeners live until stopParkInput()
//   parkMove() -> { x, z }      the direction the keys are holding, for stepPark
//   stopParkInput()
import { stage } from './scene.js';
import { modal } from './core.js';
import { groundAt, setGoal, nearPlot, park } from './park.js';

const keys = new Set();
const mv = { x: 0, z: 0 };
let offs = [], signFn = null, useFn = null;

const typing = e => /^(INPUT|TEXTAREA|SELECT)$/.test(e.target?.tagName || '') || e.target?.isContentEditable;
function listen(target, type, fn, opts) { target.addEventListener(type, fn, opts); offs.push(() => target.removeEventListener(type, fn, opts)); }

import { stick, initStick } from './stick.js';
export function initParkInput({ onSign = null, onUse = null } = {}) {
  stopParkInput();
  initStick();
  signFn = onSign; useFn = onUse;
  const canvas = stage.querySelector('canvas');
  listen(canvas, 'pointerdown', e => {
    if (modal() || e.button > 0) return;
    const p = groundAt(e.clientX, e.clientY); if (!p) return;
    const hw = park.w / 2, hh = park.h / 2;
    // a tap on a building means its doormat
    setGoal(Math.max(-hw + 0.3, Math.min(hw - 0.3, p.x)), Math.max(-hh + 0.3, Math.min(hh - 0.3, p.z)));
  });
  listen(document.getElementById('labels'), 'click', e => {
    const el = e.target.closest?.('[data-goto^="floor:"]'); if (!el) return;
    signFn?.(el.dataset.goto.slice(6));
  });
  listen(window, 'keydown', e => {
    if (modal() || typing(e) || e.ctrlKey || e.metaKey || e.altKey) return;
    const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
    if (['w', 'a', 's', 'd', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(k)) { keys.add(k); e.preventDefault(); }
    else if (k === 'e' || k === 'Enter') { const h = nearPlot(); if (h) { useFn?.(h.f); e.preventDefault(); } }
  });
  listen(window, 'keyup', e => { keys.delete(e.key.length === 1 ? e.key.toLowerCase() : e.key); });
  listen(window, 'blur', () => keys.clear());
}
export function parkMove() {
  mv.x = (keys.has('d') || keys.has('ArrowRight') ? 1 : 0) - (keys.has('a') || keys.has('ArrowLeft') ? 1 : 0);
  mv.z = (keys.has('s') || keys.has('ArrowDown') ? 1 : 0) - (keys.has('w') || keys.has('ArrowUp') ? 1 : 0);
  if (!mv.x && !mv.z && stick.active && stick.mag > 0.15) { mv.x = stick.x; mv.z = stick.z; }   // the thumb stick
  return mv;
}
export function stopParkInput() { for (const off of offs) off(); offs = []; keys.clear(); signFn = useFn = null; }
