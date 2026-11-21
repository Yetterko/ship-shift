// The thumb stick: on a touch screen, put a finger down anywhere on the scene and drag to walk in that direction.
// A quick tap is still a tap (walk there and open it); only a drag past a few pixels becomes the stick.
//   initStick()   once; listens on the 3D canvas
//   stick         { active, x, z, mag }: the direction in world terms (screen up is -z), for the floor and the park
import { renderer } from './scene.js';

export const stick = { active: false, x: 0, z: 0, mag: 0 };
const R = 56, DEAD = 14;          // the stick's reach and the drag that turns a touch into a stick, in CSS pixels
let ui = null, base = null, knob = null, id = null, ox = 0, oy = 0, started = false, touches = 0;

export function initStick() {
  if (started) return;
  started = true;
  const cv = renderer.domElement;
  ui = document.createElement('div'); ui.className = 'stick'; ui.hidden = true; ui.setAttribute('aria-hidden', 'true');
  ui.innerHTML = '<i class="stick-base"></i><i class="stick-knob"></i>';
  document.body.append(ui); base = ui.firstChild; knob = ui.lastChild;
  cv.addEventListener('pointerdown', e => {
    if (e.pointerType === 'mouse') return;
    touches++;
    if (touches > 1) { reset(); return; }            // a second finger is a pinch, not a walk
    id = e.pointerId; ox = e.clientX; oy = e.clientY;
  });
  cv.addEventListener('pointermove', e => {
    if (e.pointerId !== id) return;
    const dx = e.clientX - ox, dy = e.clientY - oy, d = Math.hypot(dx, dy);
    if (!stick.active && d < DEAD) return;
    if (!stick.active) { stick.active = true; ui.hidden = false; ui.style.transform = `translate(${ox}px, ${oy}px)`; }
    const k = Math.min(1, d / R), n = d || 1;
    stick.x = dx / n * k; stick.z = dy / n * k; stick.mag = k;
    knob.style.transform = `translate(${dx / n * k * R}px, ${dy / n * k * R}px)`;
  });
  const up = e => { if (e.pointerType === 'mouse') return; touches = Math.max(0, touches - 1); if (e.pointerId === id) reset(); };
  cv.addEventListener('pointerup', up); cv.addEventListener('pointercancel', up);
}
function reset() { id = null; stick.active = false; stick.x = stick.z = stick.mag = 0; if (ui) { ui.hidden = true; knob.style.transform = ''; } }
/** True while a drag is (or just was) the stick, so the end of the drag is not read as a tap. */
export const stickBusy = () => stick.active;
