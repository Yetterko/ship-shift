// The Waiter and the controls (FR-6, FR-7). A tap on anything opens its panel at once, and at the same moment the Waiter
// runs there in about 0.4 s: the panel never waits for the walk. WASD or click to walk, E use, Shift dash, Tab the most
// urgent thing, ? help, T Type it, J/K hunks, P presenter mode, Esc close.
import { THREE, V, camera, stage, renderer } from './scene.js';
import { modal, emit, clamp } from './core.js';
import { F, findPath, blocked, PLAYER_R, patienceLeft, dust } from './floor.js';
import { openPanel, closePanel, panelKey, typeItKey } from './panels.js';
import { nextHunk, prevHunk } from './review.js';
import { openTvFull, closeTvFull, tvOpen } from './tv.js';
import { presenter } from './guide.js';
import { touch } from './touch.js';

const I = { keys: new Set(), off: [], down: null, lastTap: null, sentAt: { x: 1e9, z: 1e9, t: 0 }, atDoor: false, taps: 0 };
export const input = I;
const ray = new THREE.Raycaster(), ndc = new THREE.Vector2();

/* ======================= tap: the panel first, then the run ======================= */
export function tap(key, { run = true } = {}) {
  const t = F.targets.get(key) || (key.startsWith('meal:') || key === 'passlist' ? F.targets.get('pass') : null);
  I.taps++; I.lastTap = { key, at: performance.now() };
  if (key === 'door') { F.ctx?.openDoor?.(); }
  else if (key === 'tv') openTvFull();
  else if (!openPanel(key)) { /* refused (a forced break): the break screen says why */ }
  F.hot = key;
  if (run && t?.access) runTo(t.access, 0.4);
  emit('sfx', 'pick');
  return true;
}
/** The Waiter runs to a spot, fast enough to arrive in about `secs` whatever the distance. */
export function runTo(to, secs = 0.4) {
  const w = F.waiter; if (!w) return;
  const path = findPath(w.g.position, to);
  let len = 0, at = w.g.position; for (const p of path) { len += Math.hypot(p.x - at.x, p.z - at.z); at = p; }
  w.path = path; w.runSpeed = Math.max(w.speed, len / Math.max(0.15, secs)); w.arriveBy = performance.now() + secs * 1000;
  if (len > 1.2) dust(3);
}

/* ======================= what is most urgent (Tab) ======================= */
export function urgent(S = F.snap) {
  if (!S || !F.you.canAct) return null;
  const tables = S.tables.map((c, i) => [c, i]).filter(([c]) => c);
  const fb = tables.filter(([c]) => c.status === 'awaiting_player' && !c.feedbackRead).sort((a, b) => (patienceLeft(a[0].patience) ?? 1) - (patienceLeft(b[0].patience) ?? 1))[0];
  const meals = S.pass.map(id => S.meals[id]).filter(m => m && S.items[m.itemId]?.status !== 'approved').sort((a, b) => (patienceLeft(a.patience) ?? 1) - (patienceLeft(b.patience) ?? 1));
  const mealP = meals[0] ? patienceLeft(meals[0].patience) ?? 1 : 2, fbP = fb ? patienceLeft(fb[0].patience) ?? 1 : 2;
  if (fb && fbP <= mealP) return `table:${fb[1]}`;
  if (meals[0]) return `meal:${meals[0].id}`;
  const serve = tables.find(([c]) => c.status !== 'eating' && c.order.itemIds.some(i => S.items[i]?.status === 'approved'));
  if (serve) return `table:${serve[1]}`;
  const split = tables.find(([c]) => c.status === 'seated');
  if (split) return `table:${split[1]}`;
  const pay = tables.find(([c]) => c.status === 'awaiting_player');
  if (pay) return `table:${pay[1]}`;
  if (S.line[0] && tables.length < S.tables.length) return `customer:${S.line[0].id}`;
  return null;
}

/* ======================= pointer ======================= */
export function pick(cx, cy) {
  const r = renderer.domElement.getBoundingClientRect();
  ndc.set(((cx - r.left) / r.width) * 2 - 1, -((cy - r.top) / r.height) * 2 + 1);
  ray.setFromCamera(ndc, camera);
  const hits = F.root ? ray.intersectObject(F.root, true) : [];
  for (const h of hits) {
    if (!h.object.visible) continue;
    if (h.object.userData.tap) return { key: h.object.userData.tap };
    if (h.object.userData.ground) return { ground: h.point };
  }
  return null;
}
function onDown(e) { if (e.isPrimary) I.down = { x: e.clientX, y: e.clientY, t: performance.now() }; }
function onUp(e) {
  const d = I.down; I.down = null;
  if (!d || !e.isPrimary || touch.pinch || performance.now() - touch.pinched < 300) return;
  if (Math.hypot(e.clientX - d.x, e.clientY - d.y) > 12) return;
  const hit = pick(e.clientX, e.clientY);
  if (!hit) return;
  if (hit.key) { tap(hit.key); return; }
  // the floor: walk there, and close what was open
  const p = hit.ground; if (!F.waiter) return;
  const x = clamp(p.x, -5.4, 5.4), z = clamp(p.z, -0.7, 3.1);
  if (!blocked(x, z)) { runTo(V(x, 0, z), 0.6); if (panelKey() && touch.layout !== 'desk') closePanel(); }
}
function onLabel(e) {
  const el = e.target.closest('[data-goto]'); if (!el) return;
  e.stopPropagation(); tap(el.dataset.goto);
}

/* ======================= keys ======================= */
const typing = e => /^(INPUT|TEXTAREA|SELECT)$/.test(e.target?.tagName) || e.target?.isContentEditable;
function onKey(e) {
  if (e.type === 'keyup') { I.keys.delete(e.key.toLowerCase()); return; }
  if (typing(e)) { if (e.key === 'Escape') e.target.blur(); return; }
  const k = e.key.toLowerCase();
  if (k === 'escape') { if (tvOpen()) closeTvFull(); else closePanel(); return; }
  if (modal() && !tvOpen()) return;
  if (['w', 'a', 's', 'd', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright'].includes(k)) { I.keys.add(k); if (k.startsWith('arrow')) e.preventDefault(); return; }
  if (k === 'shift') { dash(); return; }
  if (k === 'tab') { e.preventDefault(); const u = urgent(); if (u) tap(u); else emit('sfx', 'no'); return; }
  if (k === 'e' || k === ' ' || k === 'enter') { if (k !== 'e' && panelKey()) return; e.preventDefault(); use(); return; }
  if (k === '?' || (k === '/' && e.shiftKey) || k === 'h') { openPanel('help'); return; }
  if (k === 'j' && panelKey()?.startsWith('meal:')) { nextHunk(); return; }
  if (k === 'k' && panelKey()?.startsWith('meal:')) { prevHunk(); return; }
  if (k === 't') { if (typeItKey()) e.preventDefault(); return; }
  if (k === 'p') { presenter(); return; }
}
function dash() { const w = F.waiter; if (!w || w.dashCool > 0) return; w.dash = 0.22; w.dashCool = 0.6; dust(5); emit('sfx', 'dash'); }
/** E: the nearest thing to the Waiter. */
function use() {
  const w = F.waiter; if (!w) return;
  let best = null, bd = 1.6;
  for (const t of F.targets.values()) {
    if (!t.access || t.type === 'line' && false) continue;
    const d = Math.hypot(t.access.x - w.g.position.x, t.access.z - w.g.position.z);
    if (d < bd) { bd = d; best = t; }
  }
  if (best) tap(best.key, { run: false }); else emit('sfx', 'no');
}

/* ======================= every frame: walk ======================= */
const dir = V();
export function inputFrame(dt) {
  const w = F.waiter; if (!w) return;
  w.dash = Math.max(0, (w.dash || 0) - dt); w.dashCool = Math.max(0, (w.dashCool || 0) - dt);
  const K = I.keys;
  dir.set((K.has('d') || K.has('arrowright') ? 1 : 0) - (K.has('a') || K.has('arrowleft') ? 1 : 0), 0, (K.has('s') || K.has('arrowdown') ? 1 : 0) - (K.has('w') || K.has('arrowup') ? 1 : 0));
  const pos = w.g.position;
  if (dir.lengthSq()) {
    w.path = null; dir.normalize();
    const sp = w.speed * (w.dash > 0 ? 2.2 : 1) * dt;
    const nx = pos.x + dir.x * sp, nz = pos.z + dir.z * sp;
    if (!blocked(nx, pos.z)) pos.x = nx;
    if (!blocked(pos.x, nz)) pos.z = nz;
    face(w, dir.x, dir.z, dt); w.moving = true;
  } else if (w.path?.length) {
    const to = w.path[0], dx = to.x - pos.x, dz = to.z - pos.z, d = Math.hypot(dx, dz);
    const sp = (w.runSpeed || w.speed) * (w.dash > 0 ? 1.6 : 1) * dt;
    if (d <= sp) { pos.x = to.x; pos.z = to.z; w.path.shift(); if (!w.path.length) { w.path = null; w.arrivedAt = performance.now(); } }
    else { pos.x += dx / d * sp; pos.z += dz / d * sp; }
    face(w, dx, dz, dt); w.moving = true;
  } else w.moving = false;
  // walking into the front door opens the door panel (once, until you step away)
  const door = F.targets.get('door');
  if (door) {
    const near = Math.hypot(door.access.x - pos.x, door.access.z - pos.z) < 0.45;
    if (near && !I.atDoor && dir.lengthSq()) { I.atDoor = true; F.ctx?.openDoor?.(); }
    if (!near) I.atDoor = false;
  }
  // the avatar's position goes to the server for other people's screens, at most ten times a second
  const t = performance.now();
  if (t - I.sentAt.t > 100 && Math.hypot(pos.x - I.sentAt.x, pos.z - I.sentAt.z) > 0.05) {
    I.sentAt = { x: pos.x, z: pos.z, t };
    try { F.ctx?.sendPos?.(+pos.x.toFixed(2), +pos.z.toFixed(2), +w.g.rotation.y.toFixed(2)); } catch { /* offline */ }
  }
}
function face(w, dx, dz, dt) {
  const want = Math.atan2(dx, dz); let diff = want - w.g.rotation.y;
  while (diff > Math.PI) diff -= Math.PI * 2; while (diff < -Math.PI) diff += Math.PI * 2;
  w.g.rotation.y += diff * Math.min(1, dt * 16);
}

export function initInput() {
  const add = (t, ev, fn, o) => { t.addEventListener(ev, fn, o); I.off.push(() => t.removeEventListener(ev, fn, o)); };
  const cv = renderer.domElement;
  add(cv, 'pointerdown', onDown); add(cv, 'pointerup', onUp);
  const labels = document.getElementById('labels');
  if (labels) add(labels, 'click', onLabel);
  add(window, 'keydown', onKey); add(window, 'keyup', onKey);
  add(window, 'blur', () => I.keys.clear());
  I.atDoor = false; I.sentAt = { x: 1e9, z: 1e9, t: 0 };
  // the first raycast computes every bounding sphere in the room: done now, not on the player's first tap
  setTimeout(() => { try { pick(innerWidth / 2, innerHeight / 2); } catch { /* not drawn yet */ } }, 300);
}
export function disposeInput() { for (const f of I.off) f(); I.off = []; I.keys.clear(); }
export { PLAYER_R, stage };
