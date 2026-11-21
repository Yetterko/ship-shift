// Keys, pointer, walking with collision, and what E does at each station.
import { $, G, orderOf, questionFor, api, toast, emit, nowS, clamp } from './core.js';
import { THREE, V, scene, camera, renderer, popup, shake, spawn } from './scene.js';
import { player, stations, stationById, chefStations, passStations, hatchSt, prepSt, stationState, setCarry, local, slotOf, passSlotOf, blocked, findPath, PLAYER_R, ring, targetDot, arrow, urgentRing, dust, sprinkle, kick, chefChar, plateLook, JARS, orderStation, stateWords } from './world.js';
import { ui, answerKey, openInput, closeInput, openReview, closeReview, reviewKey, diffSeen } from './panels.js';

const keys = {};
const KEYMAP = { KeyW: 'up', ArrowUp: 'up', KeyS: 'down', ArrowDown: 'down', KeyA: 'left', ArrowLeft: 'left', KeyD: 'right', ArrowRight: 'right' };
const dialogOpen = () => !!document.querySelector('dialog[open]');
const typing = () => /INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName);
export const state = { near: null, urgentUntil: 0, urgent: null };

/* ======================= what E does ======================= */
export async function interact(st, { arriving = false } = {}) {
  const S = G.S; if (!S || !st) return;
  const c = player.carry;
  const full = () => toast('Hands full. Q puts it back', 'bad');
  try {
    if (st.type === 'slot') {
      const { order: o } = stationState(st);
      if (!o) return;
      if (c?.type === 'jar') return grant(c.id, o, st.top);
      if (o.state !== 'waiting') return;
      if (c) return full();
      setCarry({ type: 'ticket', id: o.id }); emit('sfx', 'pick'); return;
    }
    if (st.type === 'chef') {
      const { chef, order: o, question: q } = stationState(st);
      if (!chef) return;
      if (c?.type === 'jar' && o) return grant(c.id, o, st.potPos);
      if (q) return;                                   // the bubble takes 1-4, X and T
      if (o?.state === 'stalled') { await api(`/api/orders/${o.id}/resume`); emit('sfx', 'yes'); return; }
      if (c?.type === 'ticket') {
        if (chef.orderId) return toast(`${chef.name} is busy with #${chef.orderId}`, 'bad');
        const id = c.id; setCarry(null); emit('sfx', 'drop'); kick(st, 0.3); const ch = chefChar(chef.id); if (ch) kick(ch, 0.35);
        await api(`/api/orders/${id}/assign`, { chefId: chef.id });
        return;
      }
      if (o?.state === 'cooking') {
        if (ui.taste === st.id && !arriving) { ui.taste = null; ui.wip = null; return; }
        if (ui.taste !== st.id) { ui.taste = st.id; ui.wip = null; ui.wipAt = 0; emit('sfx', 'open'); kick(st, 0.25); spawn('puff', st.potPos, '#fffaf0', { n: 6, spread: 0.3, up: 1.2 }); }
        return;
      }
      return;
    }
    if (st.type === 'prep') {
      if (local.board) {
        const o = orderOf(local.board);
        if (c?.type === 'jar' && o) return grant(c.id, o, st.top);
        if (o?.state === 'planning') return;
        if (c) return full();
        setCarry({ type: 'ticket', id: local.board }); local.board = null; emit('sfx', 'pick'); return;
      }
      if (c?.type !== 'ticket') return;
      if (orderOf(c.id)?.plan) return toast('Already planned. Give it to a chef');
      const id = c.id; local.board = id; setCarry(null); emit('sfx', 'drop');
      await api(`/api/orders/${id}/plan`);
      return;
    }
    if (st.type === 'jar') {
      if (c?.type === 'jar') { setCarry(c.id === st.cls ? null : { type: 'jar', id: st.cls }); emit('sfx', 'drop'); return; }
      if (c) return full();
      setCarry({ type: 'jar', id: st.cls }); emit('sfx', 'pick'); return;
    }
    if (st.type === 'oven') {
      const next = !S.rules?.autoRefire;
      emit('sfx', 'lever'); kick(st, 0.15);
      await api('/api/rules', { autoRefire: next });
      popup(next ? 'Re-fire on fail: ON' : 'Re-fire: off', st.top, next ? 'good' : '');
      return;
    }
    if (st.type === 'pass') {
      const { order: o } = stationState(st);
      if (!o) return;
      if (c) return full();
      if (o.approved) { closeReview(); setCarry({ type: 'plate', id: o.id }); emit('sfx', 'pick'); return; }
      if (ui.review !== o.id) openReview(o.id);
      return;
    }
    if (st.type === 'hatch') {
      if (c?.type !== 'plate') return;
      const o = orderOf(c.id), look = plateLook(o), was = o.state;
      local.hatch = o.id; setCarry(null); emit('sfx', 'drop');
      try { await api(`/api/orders/${o.id}/ship`, { seen: diffSeen(o) }); }
      catch (e) { local.hatch = null; throw e; }
      if (look.cold && was) { /* the server sends it back; apply() plays the spoil */ }
      return;
    }
    if (st.type === 'bin') {
      if (!c || c.type === 'jar') return;
      if (local.binConfirm?.id !== c.id || performance.now() > local.binConfirm.until) { local.binConfirm = { id: c.id, until: performance.now() + 4000 }; emit('sfx', 'no'); return; }
      const id = c.id; setCarry(null); local.binConfirm = null; emit('sfx', 'back'); spawn('puff', st.top, '#8fae74', { n: 8, up: 1.2 });
      await api(`/api/orders/${id}/bin`);
    }
  } catch { /* api already toasted */ }
}

async function grant(cls, o, pos) {
  const jar = JARS.find(j => j.cls === cls);
  if ((o.grants || []).includes(cls) || (G.S.grants || []).includes(cls)) return toast(`#${o.id} already has ${jar.name}`);
  setCarry(null); emit('sfx', 'sprinkle'); sprinkle(pos.clone().add(V(0, 0.5, 0)), jar.color);
  try { await api('/api/grants', { cls, orderId: o.id }); popup(`+ ${jar.name}`, pos, 'good'); } catch { /* toasted */ }
}

function putDown() {
  const c = player.carry; if (!c) return;
  setCarry(null); emit('sfx', 'drop');
}

/* ======================= triage: Tab walks you to the most urgent thing ======================= */
export function urgent() {
  const S = G.S; if (!S) return null;
  const c = player.carry;
  const qs = [...S.questions].sort((a, b) => a.createdAt - b.createdAt);
  for (const q of qs) { const st = chefStations.find(s => s.chefId === q.chefId); if (st) return { st, why: 'blocked' }; }
  const stalled = S.orders.find(o => o.state === 'stalled'); if (stalled) return { st: orderStation(stalled), why: 'stalled' };
  if (c?.type === 'plate') return { st: hatchSt, why: 'ship' };
  if (c?.type === 'ticket') { const free = chefStations.find(s => !S.chefs.find(ch => ch.id === s.chefId)?.orderId); if (free) return { st: free, why: 'give' }; }
  const atPass = S.orders.filter(o => o.state === 'at_pass' && passSlotOf.has(o.id)).sort((a, b) => (a.atPassAt || 0) - (b.atPassAt || 0));
  const plate = atPass.find(o => o.approved && o.merge?.clean !== false) || atPass.find(o => !o.approved) || atPass[0];
  if (plate && !c) return { st: passStations[passSlotOf.get(plate.id)], why: 'plate' };
  if (local.board && orderOf(local.board)?.state === 'waiting' && !c) return { st: prepSt, why: 'planned' };
  const freeChef = S.chefs.some(ch => !ch.orderId);
  const waiting = S.orders.filter(o => o.state === 'waiting' && slotOf.has(o.id) && local.board !== o.id).sort((a, b) => (a.createdAt + a.targetMin * 60000) - (b.createdAt + b.targetMin * 60000));
  if (waiting.length && freeChef && !c) return { st: stationById(`slot${slotOf.get(waiting[0].id)}`), why: 'ticket' };
  return null;
}
function triage() {
  const u = urgent();
  if (!u?.st) { toast('Nothing needs you right now'); return; }
  state.urgent = u.st; state.urgentUntil = performance.now() + 5000;
  walkTo(u.st, { act: false }); emit('sfx', 'pick');
}

/* ======================= keys ======================= */
addEventListener('keydown', e => {
  if (e.code === 'Tab' && !dialogOpen()) { e.preventDefault(); if (!typing() && !e.repeat) triage(); return; }
  if (dialogOpen() || typing() || e.ctrlKey || e.metaKey || e.altKey) return;
  if (e.code === 'Escape') { if (reviewKey(e)) return; ui.taste = null; $('shiftPop').hidden = true; return; }
  if (KEYMAP[e.code]) { keys[KEYMAP[e.code]] = true; e.preventDefault(); player.path = null; player.targetSt = null; return; }
  if (e.repeat) return;
  if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') { dash(); return; }
  if (reviewKey(e)) { e.preventDefault(); return; }
  const near = state.near;
  const q = near?.type === 'chef' ? questionFor(near.chefId) : null;
  if (q) {
    const digit = /^(Digit|Numpad)([1-4])$/.exec(e.code)?.[2];
    if (digit) { e.preventDefault(); answerKey(q, digit); return; }
    if (e.code === 'KeyX') { answerKey(q, 'x'); return; }
    if (e.code === 'KeyT') { e.preventDefault(); openInput('answer', q.id, q.kind === 'question' ? 'Your answer, then Enter' : 'Say no with a note, then Enter'); return; }
  }
  if (e.code === 'KeyE' || e.code === 'Space') { e.preventDefault(); if (near) interact(near); return; }
  if (e.code === 'KeyQ') { putDown(); return; }
  if (e.code === 'KeyF' && near?.type === 'chef') {
    const { order: o, chef } = stationState(near);
    if (o?.state === 'cooking' && !q) { e.preventDefault(); openInput('steer', o.id, `Call out to ${chef.name}: one line, then Enter`); }
    return;
  }
  if (e.code === 'KeyR' && near?.type === 'pass') { const { order: o } = stationState(near); if (o && !player.carry) openReview(o.id); return; }
  if (e.code === 'KeyX' && near?.type === 'chef') {
    const { order: o } = stationState(near);
    if (o?.state !== 'stalled') return;
    if (ui.binChef !== o.id) { ui.binChef = o.id; emit('sfx', 'no'); return; }
    ui.binChef = null; api(`/api/orders/${o.id}/bin`).catch(() => {});
  }
});
addEventListener('keyup', e => { if (KEYMAP[e.code]) keys[KEYMAP[e.code]] = false; });
addEventListener('blur', () => { for (const k in keys) keys[k] = false; });

function dash() {
  if (player.dashCool > 0) return;
  player.dash = 0.25; player.dashCool = 0.7;
  kick(player, -0.3); dust(7); emit('sfx', 'dash');
}

/* ======================= pointer ======================= */
const raycaster = new THREE.Raycaster(), pointer = new THREE.Vector2();
renderer.domElement.addEventListener('pointerdown', e => {
  if (dialogOpen()) return;
  $('shiftPop').hidden = true;
  const r = renderer.domElement.getBoundingClientRect();
  pointer.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
  raycaster.setFromCamera(pointer, camera);
  const pick = [];
  scene.traverse(o => { if (o.isMesh && (o.userData.station || o.userData.floor || o.userData.chefOf || o.userData.customerOf)) pick.push(o); });
  const hit = raycaster.intersectObjects(pick, false)[0];
  if (!hit) return;
  let st = hit.object.userData.station;
  if (!st && hit.object.userData.chefOf) st = chefStations.find(s => s.chefId === hit.object.userData.chefOf);
  if (!st && hit.object.userData.customerOf && slotOf.has(hit.object.userData.customerOf)) st = stationById(`slot${slotOf.get(hit.object.userData.customerOf)}`);
  if (st) walkTo(st);
  else walkPoint(hit.point.x, hit.point.z);
});
$('labels').addEventListener('click', e => {
  const k = e.target.closest('[data-key]');
  if (k) { const q = state.near?.type === 'chef' ? questionFor(state.near.chefId) : null; if (q) answerKey(q, k.dataset.key); return; }
  const el = e.target.closest('[data-goto]'); if (!el) return;
  const st = stationById(el.dataset.goto); if (st) walkTo(st);
});

function nearestFree(x, z) {
  x = clamp(x, -5.1, 5.0); z = clamp(z, -2.4, 3.2);
  if (!blocked(x, z)) return { x, z };
  for (let r = 0.2; r < 2.5; r += 0.2) for (let a = 0; a < 6.3; a += 0.4) { const px = x + Math.cos(a) * r, pz = z + Math.sin(a) * r; if (!blocked(px, pz)) return { x: px, z: pz }; }
  return { x: player.g.position.x, z: player.g.position.z };
}
function walkPoint(x, z) { const p = nearestFree(x, z); player.path = findPath(player.g.position, p); player.targetSt = null; }
/** Walks to a station by the shortest clear route. With act, presses E on arrival. */
export function walkTo(st, { act = true } = {}) {
  if (!st) return;
  const from = player.g.position;
  let best = null, bestLen = 1e9;
  for (const a of st.access) {
    const path = findPath(from, a); let len = 0, at = from;
    for (const p of path) { len += Math.hypot(p.x - at.x, p.z - at.z); at = p; }
    if (len < bestLen) { bestLen = len; best = path; }
  }
  player.path = best; player.targetSt = st; player.act = act;
}

function nearest() {
  let best = null, bd = 0.85;
  const p = player.g.position;
  for (const st of stations) for (const a of st.access) { const d = Math.hypot(p.x - a.x, p.z - a.z); if (d < bd) { bd = d; best = st; } }
  return best;
}

/* ======================= every frame ======================= */
const SPEED = 6.2;
let stepT = 0;
export function step(dt, t) {
  const pos = player.g.position;
  let mx = (keys.right ? 1 : 0) - (keys.left ? 1 : 0), mz = (keys.down ? 1 : 0) - (keys.up ? 1 : 0);
  if (dialogOpen() || typing()) mx = mz = 0;
  player.dash = Math.max(0, player.dash - dt); player.dashCool = Math.max(0, player.dashCool - dt);
  const speed = SPEED * (player.dash > 0 ? 1.8 : 1);
  let arrived = null;
  if (mx || mz) { const l = Math.hypot(mx, mz); mx /= l; mz /= l; }
  else if (player.path?.length) {
    const p = player.path[0], dx = p.x - pos.x, dz = p.z - pos.z, d = Math.hypot(dx, dz);
    if (d < speed * dt + 0.03) {
      if (!blocked(p.x, p.z, PLAYER_R - 0.03)) { pos.x = p.x; pos.z = p.z; }
      player.path.shift();
      if (!player.path.length) { arrived = player.targetSt; player.path = null; player.targetSt = null; }
    } else { mx = dx / d; mz = dz / d; }
  }
  // velocity eases in and out, then moves on each axis alone so walls slide instead of stick
  const k = Math.min(1, dt * 20);
  player.vx += (mx * speed - player.vx) * k; player.vz += (mz * speed - player.vz) * k;
  if (!mx && !mz && Math.hypot(player.vx, player.vz) < 0.4) player.vx = player.vz = 0;
  const n = Math.max(1, Math.ceil(dt / 0.016));
  for (let i = 0; i < n; i++) {
    const sx = player.vx * dt / n, sz = player.vz * dt / n;
    if (!blocked(pos.x + sx, pos.z)) pos.x += sx; else player.vx = 0;
    if (!blocked(pos.x, pos.z + sz)) pos.z += sz; else player.vz = 0;
  }
  const was = player.moving;
  player.moving = !!(mx || mz);
  if (player.moving) {
    let diff = Math.atan2(mx, mz) - player.g.rotation.y; diff = Math.atan2(Math.sin(diff), Math.cos(diff));
    player.g.rotation.y += diff * Math.min(1, dt * 16);
    stepT += dt; if (stepT > 0.2) { stepT = 0; if (player.dash > 0) dust(2); }
  }
  if (was && !player.moving) kick(player, 0.12);
  if (!was && player.moving) kick(player, -0.12);
  player.g.rotation.z = 0; player.g.rotation.x = player.moving ? 0.1 : 0;

  if (arrived) {
    const look = arrived.top; player.g.rotation.y = Math.atan2(look.x - pos.x, look.z - pos.z);
    if (player.act) interact(arrived, { arriving: true });
  }

  // markers
  const near = state.near = nearest();
  ring.visible = !!near;
  if (near) { ring.position.x = near.ring.x; ring.position.z = near.ring.z; if (near.type === 'prep' || near.type === 'jar') ring.position.z = pos.z < 0.9 ? 0.05 : 1.75; ring.rotation.z = t * 1.5; ring.scale.setScalar(1 + Math.sin(t * 6) * 0.05); }
  const goal = player.path?.at(-1);
  targetDot.visible = !!goal && !player.targetSt; if (targetDot.visible) { targetDot.position.x = goal.x; targetDot.position.z = goal.z; targetDot.rotation.z = -t * 3; }

  // the red arrow: on Tab for a few seconds, and always while something is on fire
  const u = G.S ? urgent() : null;
  const fire = u?.why === 'blocked' && G.S.shift.mode !== 'focus' && G.S.questions.some(q => nowS() - q.createdAt >= (G.S.escalation?.fireMs ?? 60000 / (G.S.pace || 1)));
  const target = performance.now() < state.urgentUntil ? state.urgent : fire ? u.st : null;
  const show = !!target && target !== near;
  arrow.visible = urgentRing.visible = show;
  if (show) {
    const a = target.ring, dx = a.x - pos.x, dz = a.z - pos.z, d = Math.hypot(dx, dz) || 1;
    arrow.position.set(pos.x + dx / d * (0.95 + Math.sin(t * 8) * 0.1), 0.03, pos.z + dz / d * (0.95 + Math.sin(t * 8) * 0.1));
    arrow.rotation.z = Math.atan2(-dx, -dz);
    urgentRing.position.set(a.x, 0.025, a.z); urgentRing.scale.setScalar(1 + Math.sin(t * 7) * 0.12); urgentRing.rotation.z = t * 2;
  }
  return near;
}
export { shake };
