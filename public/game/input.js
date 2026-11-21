// Tap-first controls: tap anything and the waiter walks there and opens its panel. WASD / arrows and E still work.
import { $, G, clamp, customerById, watching } from './core.js';
import { THREE, V, scene, camera, renderer } from './scene.js';
import { player, targets, targetById, blocked, findPath, PLAYER_R, ring, targetDot, arrow, hintRing, kick } from './world.js';
import { openSpec, closePanel, panelIsOpen, coach } from './panels.js';
import { soakedFactor } from './water.js';

const keys = {};
const KEYMAP = { KeyW: 'up', ArrowUp: 'up', KeyS: 'down', ArrowDown: 'down', KeyA: 'left', ArrowLeft: 'left', KeyD: 'right', ArrowRight: 'right' };
const blockedUi = () => !!document.querySelector('dialog[open], .overlay.open');
const typing = () => /INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName);
export const state = { near: null };

/** The floor target a spec walks to: 'line:3' and 'door' go to the door, 'table:1' to table 1, and so on. */
export function targetFor(spec) {
  if (!spec) return null;
  if (spec === 'door' || spec.startsWith('line:')) return targetById('door');
  return targetById(spec);
}

/** Walks to whatever the spec names, then opens its panel. */
export function go(spec) {
  if (watching() && !spec.startsWith('station:') && spec !== 'counter' && spec !== 'rail' && !spec.startsWith('table:') && !spec.startsWith('line:')) return;
  const t = targetFor(spec);
  if (!t) return;
  const from = player.g.position;
  let best = null, bestLen = 1e9;
  for (const a of t.access) {
    const path = findPath(from, a); let len = 0, at = from;
    for (const p of path) { len += Math.hypot(p.x - at.x, p.z - at.z); at = p; }
    if (len < bestLen) { bestLen = len; best = path; }
  }
  // already standing there: open straight away
  if (bestLen < 0.35) { player.path = null; face(t); openSpec(spec); return; }
  player.path = best; player.onArrive = () => { face(t); openSpec(spec); };
}
function face(t) { const p = player.g.position; player.g.rotation.y = Math.atan2(t.top.x - p.x, t.top.z - p.z); }

/* ---------- keys ---------- */
addEventListener('keydown', e => {
  if (blockedUi() || typing() || e.ctrlKey || e.metaKey || e.altKey) return;
  if (e.code === 'Escape') { closePanel(); return; }
  if (KEYMAP[e.code]) { keys[KEYMAP[e.code]] = true; e.preventDefault(); player.path = null; player.onArrive = null; return; }
  if (e.repeat) return;
  if ((e.code === 'KeyE' || e.code === 'Space') && state.near) { e.preventDefault(); const t = state.near; openSpec(t.id === 'door' ? 'door' : t.id); }
});
addEventListener('keyup', e => { if (KEYMAP[e.code]) keys[KEYMAP[e.code]] = false; });
addEventListener('blur', () => { for (const k in keys) keys[k] = false; });

/* ---------- taps ---------- */
const raycaster = new THREE.Raycaster(), pointer = new THREE.Vector2();
renderer.domElement.addEventListener('pointerdown', e => {
  if (blockedUi()) return;
  const r = renderer.domElement.getBoundingClientRect();
  pointer.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
  raycaster.setFromCamera(pointer, camera);
  const pick = [];
  scene.traverse(o => { if (o.isMesh && (o.userData.target || o.userData.floor || o.userData.chefOf || o.userData.customerOf)) pick.push(o); });
  const hit = raycaster.intersectObjects(pick, false)[0];
  if (!hit) return;
  const u = hit.object.userData;
  if (u.customerOf) {
    const c = customerById(u.customerOf);
    if (c?.state === 'in_line') return go(`line:${c.id}`);
    if (c?.tableId) return go(`table:${c.tableId}`);
    return;
  }
  if (u.chefOf) { const chef = G.S.chefs.find(c => c.id === u.chefOf); return go(chef?.stationId ? `station:${chef.stationId}` : 'rail'); }
  if (u.target) return go(u.target.id);
  if (u.floor && !watching()) walkPoint(hit.point.x, hit.point.z);
});
$('labels').addEventListener('click', e => {
  const el = e.target.closest('[data-goto]');
  if (el) go(el.dataset.goto);
});

function nearestFree(x, z) {
  x = clamp(x, -1.4, 5.6); z = clamp(z, -3.0, 3.0);
  if (!blocked(x, z)) return { x, z };
  for (let r = 0.2; r < 2.5; r += 0.2) for (let a = 0; a < 6.3; a += 0.4) { const px = x + Math.cos(a) * r, pz = z + Math.sin(a) * r; if (!blocked(px, pz)) return { x: px, z: pz }; }
  return { x: player.g.position.x, z: player.g.position.z };
}
function walkPoint(x, z) { const p = nearestFree(x, z); player.path = findPath(player.g.position, p); player.onArrive = null; }

function nearest() {
  let best = null, bd = 0.85;
  const p = player.g.position;
  for (const t of targets) for (const a of t.access) { const d = Math.hypot(p.x - a.x, p.z - a.z); if (d < bd) { bd = d; best = t; } }
  return best;
}

/* ---------- every frame ---------- */
const SPEED = 6.4;
export function step(dt, t) {
  const pos = player.g.position;
  let mx = (keys.right ? 1 : 0) - (keys.left ? 1 : 0), mz = (keys.down ? 1 : 0) - (keys.up ? 1 : 0);
  if (blockedUi() || typing()) mx = mz = 0;
  let arrived = null;
  if (mx || mz) { const l = Math.hypot(mx, mz); mx /= l; mz /= l; }
  else if (player.path?.length) {
    const p = player.path[0], dx = p.x - pos.x, dz = p.z - pos.z, d = Math.hypot(dx, dz);
    if (d < SPEED * soakedFactor() * dt + 0.03) {
      if (!blocked(p.x, p.z, PLAYER_R - 0.03)) { pos.x = p.x; pos.z = p.z; }
      player.path.shift();
      if (!player.path.length) { arrived = player.onArrive; player.path = null; player.onArrive = null; }
    } else { mx = dx / d; mz = dz / d; }
  }
  const k = Math.min(1, dt * 20);
  const speed = SPEED * soakedFactor();   // soaked waiters squelch along at half speed
  player.vx += (mx * speed - player.vx) * k; player.vz += (mz * speed - player.vz) * k;
  if (!mx && !mz && Math.hypot(player.vx, player.vz) < 0.4) player.vx = player.vz = 0;
  const n = Math.max(1, Math.ceil(dt / 0.016));
  // if the waiter somehow ends up inside furniture, let them walk straight out instead of freezing
  const stuck = blocked(pos.x, pos.z);
  for (let i = 0; i < n; i++) {
    const sx = player.vx * dt / n, sz = player.vz * dt / n;
    if (stuck || !blocked(pos.x + sx, pos.z)) pos.x += sx; else player.vx = 0;
    if (stuck || !blocked(pos.x, pos.z + sz)) pos.z += sz; else player.vz = 0;
  }
  const was = player.moving;
  player.moving = !!(mx || mz);
  if (player.moving) { let diff = Math.atan2(mx, mz) - player.g.rotation.y; diff = Math.atan2(Math.sin(diff), Math.cos(diff)); player.g.rotation.y += diff * Math.min(1, dt * 16); }
  if (was !== player.moving) kick(player, player.moving ? -0.12 : 0.12);
  player.g.rotation.x = player.moving ? 0.1 : 0;
  if (arrived) arrived();

  const near = state.near = nearest();
  ring.visible = !!near;
  if (near) { const a = near.access[0]; ring.position.x = a.x; ring.position.z = a.z; ring.rotation.z = t * 1.5; ring.scale.setScalar(1 + Math.sin(t * 6) * 0.05); }
  const goal = player.path?.at(-1);
  targetDot.visible = !!goal; if (goal) { targetDot.position.x = goal.x; targetDot.position.z = goal.z; targetDot.rotation.z = -t * 3; }

  // the coach's arrow: points at the next thing worth doing, while no panel is open
  const h = G.S && !panelIsOpen() ? coach() : null;
  const tgt = h?.spec ? targetFor(h.spec) : null;
  const show = !!tgt && tgt !== near && !watching();
  arrow.visible = hintRing.visible = show;
  if (show) {
    const a = tgt.access[0], dx = a.x - pos.x, dz = a.z - pos.z, d = Math.hypot(dx, dz) || 1;
    arrow.position.set(pos.x + dx / d * (0.95 + Math.sin(t * 8) * 0.1), 0.03, pos.z + dz / d * (0.95 + Math.sin(t * 8) * 0.1));
    arrow.rotation.z = Math.atan2(-dx, -dz);
    hintRing.position.set(a.x, 0.025, a.z); hintRing.scale.setScalar(1 + Math.sin(t * 7) * 0.12); hintRing.rotation.z = t * 2;
  }
  return near;
}
