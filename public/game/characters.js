// The people: one chunky toon body that chefs, customers, the Waiter and visitors all share, plus the spring that makes things squash.
import { THREE, V, scene, toon, flat, rbox, cyl, ball, capsule, blob, noCast, mergeStatic } from './scene.js';
import { reduceMotion } from './core.js';

const C = { ink: '#3a241c', cream: '#fff1d6' };
// eyes and feet are the outline's own colour: an outline pass over them draws nothing anyone can see
const INK = toon(C.ink, { outline: false });

export function character({ body = '#fffaf0', apron = null, hat = true, skin = '#f3c9a0', band = null, hair = null, scale = 1.3, scarf = null, parent = scene }) {
  const g = new THREE.Group(), inner = new THREE.Group(); g.add(inner);
  const tint = [], skinned = [];
  const shadow = blob(1.15, 1.15, 0, 0, g);
  const feet = [-1, 1].map(s => { const f = ball(0.11, INK, 0.15 * s, 0.07, 0.03, inner, 10); f.scale.set(1, 0.65, 1.4); return f; });
  const torso = capsule(0.31, 0.2, body, 0, 0.5, 0, inner);
  if (apron) { tint.push(rbox(0.44, 0.4, 0.1, apron, 0, 0.2, 0.25, inner, 0.05)); rbox(0.2, 0.14, 0.03, C.cream, 0, 0.3, 0.3, inner, 0.02); }
  if (scarf) { const s = cyl(0.27, 0.3, 0.1, scarf, 0, 0.72, 0, inner, 16); s.castShadow = false; tint.push(s); }
  const hg = new THREE.Group(); hg.position.set(0, 0.78, 0); hg.rotation.x = -0.38; inner.add(hg);
  const headParts = inner.children.length;
  const head = ball(0.36, skin, 0, 1.08, 0, inner, 24);
  const eyes = [-1, 1].map(s => {
    const e = ball(0.068, INK, 0.135 * s, 1.1, 0.318, inner, 12); e.scale.set(1, 1.3, 0.55); e.castShadow = false;
    const hl = ball(0.026, flat('#ffffff'), 0.135 * s + 0.022, 1.14, 0.352, inner, 8); hl.castShadow = false;
    return [e, hl];
  });
  for (const s of [-1, 1]) { const ch = ball(0.06, flat('#f08f86', { transparent: true, opacity: 0.75 }), 0.245 * s, 0.98, 0.262, inner, 8); ch.scale.set(1, 0.6, 0.3); ch.castShadow = false; }
  const hands = [-1, 1].map(s => ball(0.105, skin, 0.45 * s, 0.5, 0.06, inner, 12));

  if (hat) {
    cyl(0.25, 0.24, 0.3, '#ffffff', 0, 1.34, 0, inner, 18);
    const top = ball(0.31, '#ffffff', 0, 1.72, 0, inner, 16); top.scale.y = 0.72;
    if (band) tint.push(cyl(0.258, 0.25, 0.1, band, 0, 1.36, 0, inner, 18));
  } else if (hair) { const hr = ball(0.365, hair, 0, 1.15, -0.055, inner, 18); hr.scale.set(1.02, 0.92, 1); }
  // everything from the neck up tips back a little, so faces read from a camera that looks down
  for (const m of inner.children.slice(headParts).filter(m => !hands.includes(m))) { m.position.y -= 0.78; hg.add(m); }
  // the parts of the head that never move on their own (cheeks, the hat) become one mesh per material
  mergeStatic(hg, new Set([head, ...eyes.flat(), ...tint]));
  g.scale.setScalar(scale);
  noCast(g);   // people move: their shadow is the blob under them, not the static shadow map
  parent.add(g);
  skinned.push(head, ...hands);
  return { g, inner, hg, head, hands, feet, eyes, torso, shadow, tint, skinned, squash: 0, squashV: 0, phase: Math.random() * 6, blink: 2 + Math.random() * 3, scale };
}
/** Recolours a chef: apron, hat band and scarf in one colour, and the skin. */
export function setLook(ch, { color, skin } = {}) {
  if (color) for (const m of ch.tint) m.material = toon(color);
  if (skin) for (const m of ch.skinned) m.material = toon(skin);
}
/** Squash and stretch: a damped spring every character and prop can be kicked with. */
export function kick(o, amount = 0.25) { o.squashV = (o.squashV || 0) - amount * 14; }
export function spring(o, dt) {
  // fixed small steps: a stiff spring stepped once per slow frame blows up and scales the mesh to the size of the room
  let x = o.squash || 0, v = o.squashV || 0;
  for (let left = Math.min(dt, 0.1); left > 1e-5; left -= 1 / 240) {
    const h = Math.min(left, 1 / 240);
    v += (-x * 220 - v * 14) * h; x += v * h;
  }
  if (!Number.isFinite(x) || !Number.isFinite(v)) { x = 0; v = 0; }
  o.squash = Math.max(-0.45, Math.min(0.45, x)); o.squashV = v;
  return o.squash;
}
export function pose(ch, dt, t, { moving = false, hold = false, mood = 'idle', speed = 1 } = {}) {
  const s = spring(ch, dt);
  ch.inner.scale.set(1 - s * 0.55, 1 + s, 1 - s * 0.55);
  if (moving) ch.phase += dt * 13 * speed;
  const w = Math.sin(ch.phase), breathe = Math.sin(t * 2.2 + ch.phase) * 0.02;
  ch.inner.position.y = moving ? Math.abs(w) * 0.09 : breathe;
  // nobody stands still: heads look about, weight shifts from foot to foot, and a cook watches the pot
  const still = !moving && !reduceMotion, idle = still && (mood === 'idle' || mood === 'wave');
  const ease = Math.min(1, dt * 6);
  const lookY = !still ? 0 : mood === 'cooking' ? Math.sin(t * 1.9 + ch.phase) * 0.14 : idle ? Math.sin(t * 0.8 + ch.phase) * 0.3 + Math.sin(t * 0.33 + ch.phase * 2) * 0.22 : 0;
  ch.hg.rotation.y += (lookY - ch.hg.rotation.y) * ease;
  ch.hg.rotation.x += ((mood === 'cooking' ? -0.2 : mood === 'stalled' ? 0.12 : mood === 'cheer' ? -0.6 : -0.38) - ch.hg.rotation.x) * ease;
  ch.hg.rotation.z = !still ? 0 : idle ? Math.sin(t * 0.9 + ch.phase) * 0.06 : mood === 'blocked' ? Math.sin(t * 11) * 0.09 : 0;
  ch.inner.rotation.z = idle ? Math.sin(t * 1.1 + ch.phase) * 0.035 : 0;
  ch.torso.scale.y = still ? 1 + Math.sin(t * 2.2 + ch.phase) * 0.03 : 1;
  ch.feet[0].position.z = moving ? 0.03 + w * 0.16 : 0.03; ch.feet[1].position.z = moving ? 0.03 - w * 0.16 : 0.03;
  ch.feet[0].position.y = moving ? 0.07 + Math.max(0, w) * 0.08 : 0.07; ch.feet[1].position.y = moving ? 0.07 + Math.max(0, -w) * 0.08 : 0.07;
  const [l, r] = ch.hands;
  const set = (h, x, y, z) => { h.position.x += (x - h.position.x) * Math.min(1, dt * 16); h.position.y += (y - h.position.y) * Math.min(1, dt * 16); h.position.z += (z - h.position.z) * Math.min(1, dt * 16); };
  if (hold) { set(l, -0.3, 0.56, 0.42); set(r, 0.3, 0.56, 0.42); }
  else if (mood === 'cooking') { set(l, -0.4, 0.62, 0.3); set(r, 0.12 + Math.cos(t * 7) * 0.16, 0.96, 0.62 + Math.sin(t * 7) * 0.12); }
  else if (mood === 'blocked') { set(l, -0.52, 1.25 + Math.sin(t * 11) * 0.14, 0.1); set(r, 0.52, 1.25 + Math.cos(t * 11) * 0.14, 0.1); }
  else if (mood === 'stalled') { set(l, -0.42, 0.34, 0.1); set(r, 0.42, 0.34, 0.1); }
  else if (mood === 'cheer') { set(l, -0.5, 1.35 + Math.sin(t * 16) * 0.06, 0.05); set(r, 0.5, 1.35 - Math.sin(t * 16) * 0.06, 0.05); }
  else if (mood === 'wave') { set(l, -0.45, 0.5, 0.06); set(r, 0.5 + Math.sin(t * 10) * 0.12, 1.32, 0.12); }
  else if (moving) { set(l, -0.45, 0.5 - w * 0.1, 0.06 - w * 0.22); set(r, 0.45, 0.5 + w * 0.1, 0.06 + w * 0.22); }
  else { set(l, -0.45, 0.5 + breathe * 2, 0.06); set(r, 0.45, 0.5 + breathe * 2, 0.06); }
  ch.blink -= dt;
  const shut = ch.blink < 0.11 || mood === 'stalled';
  for (const [e, hl] of ch.eyes) { e.scale.y = shut ? 0.15 : 1.3; hl.visible = !shut; }
  if (ch.blink < 0) ch.blink = 2 + Math.random() * 4;
}

/** Moves an object to a named place: a hop with an arc when the place changes, then it stays glued there. */
export function mover(g) { return { g, key: null, from: V(), t: 1, dur: 0.35, h: 0.5, squash: 0, squashV: 0, landed: null }; }
export function moveTo(mv, key, target, dt, { dur = 0.32, h = 0.45, instant = false, onLand = null } = {}) {
  if (mv.key !== key) { const first = mv.key === null; mv.key = key; mv.from.copy(mv.g.position); mv.t = instant || first ? 1 : 0; mv.dur = dur; mv.h = h; mv.landed = onLand; if (mv.t >= 1) mv.g.position.copy(target); }
  if (mv.t < 1) {
    mv.t = Math.min(1, mv.t + dt / mv.dur);
    const e = mv.t * mv.t * (3 - 2 * mv.t);
    mv.g.position.lerpVectors(mv.from, target, e); mv.g.position.y += Math.sin(Math.PI * mv.t) * mv.h;
    if (mv.t >= 1) { kick(mv, 0.3); mv.landed?.(); mv.landed = null; }
  } else mv.g.position.copy(target);
  const s = spring(mv, dt);
  mv.g.scale.set(1 - s * 0.6, 1 + s, 1 - s * 0.6);
  return mv.t >= 1;
}

/** Customers and visitors: the same six looks everywhere, picked by a number from the server. */
const BODIES = ['#c98bd6', '#6cc3c9', '#e8a25c', '#9fc46a', '#ee8fa6', '#8aa2e8'], SKINS = ['#f3c9a0', '#d19c72', '#94603f', '#f6dcc0'], HAIRS = ['#5a3a2a', '#2c2430', '#c7772e', '#e8c56a'];
export function customerChar(look = 0, parent = scene) {
  const n = Math.abs(look | 0);
  return character({ body: BODIES[n % BODIES.length], hat: false, hair: HAIRS[(n * 7) % HAIRS.length], skin: SKINS[n % SKINS.length], scale: 1.12, parent });
}
/** A visitor's or the Waiter's body: apron, hat band and scarf in one colour. */
export function waiterChar({ color = '#e5533d', skin = '#f3c9a0', parent = scene } = {}) {
  return character({ apron: color, band: color, scarf: color, skin, scale: 1.22, parent });
}
