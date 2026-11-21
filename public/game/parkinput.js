// The park's controls: walking, what E does next to a customer, a door, the bell or a board, the emotes and the phrase wheel.
// Everything a key does a finger can do: the card's buttons, the pad, a tap on the thing itself.
//
// API (see the integration note at the top of park.js)
//   initParkInput({ standalone, onBoard, onEnter })    builds the park's card, pad, wheel and sign menu inside #stage
//       standalone: true   also listens to keys and the canvas itself (a page without input.js: the park harness)
//       onBoard(tab)       B, N and the boards in the park call this: 'town' | 'leaderboard' | 'you'
//       onEnter(plot)      optional, called just before net.go('k:<plot>')
//   setParkActive(on)      shows or hides the park's controls and stops them reading input
//   parkFrame(dt, t, move?)   every frame in the park. move is { x, y, mag }, screen-right and screen-down, or nothing
//   parkKey(e) -> boolean, parkPress(key), parkTap(clientX, clientY)
//   walkTo(x, z, then?) -> Promise<boolean>     walks there round the furniture; true when it arrived
//   hotTarget(), actions()                      what the card shows right now, for tests
//   doTake(id), doPut(id, plot|null), doEnter(plot), doEmote(e), doSay(q), doSign(sign), doBell()
//                                               each resolves the server's answer and tells the player when it was refused
import { esc, clamp, toast, emit, modal, ICON } from './core.js';
import { renderer } from './scene.js';
import { me, park, parkBlocked, plotFrame, cardXZ, kickMe, setHot, setGoal, groundAt, setOverview, isOverview, puff } from './park.js';
import * as net from './net.js';
import { PHRASES, EMOTES, sayLocal } from './presence.js';

const SPEED = 6.2, R = 0.3;
const SIGN_NAME = { team: 'Open to my team', help: 'Help wanted', private: 'Private' };
const SIGN_WHAT = { team: 'Teammates can answer and approve. Other teams can watch, cheer and offer.', help: 'Anyone who visits can answer your chefs\' questions.', private: 'Visitors can only watch, and other teams cannot offer you customers.' };
const st = { active: false, standalone: false, hot: null, acts: [], goal: null, busy: false, wheel: null, sign: false, onBoard: null, onEnter: null, vx: 0, vz: 0, dashCool: 0, stuck: 0, stepT: 0, layout: 'desk' };
const keys = {};
const KEYMAP = { KeyW: 'up', ArrowUp: 'up', KeyS: 'down', ArrowDown: 'down', KeyA: 'left', ArrowLeft: 'left', KeyD: 'right', ArrowRight: 'right' };
const typing = () => /INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName);
const dist = (ax, az, bx, bz) => Math.hypot(ax - bx, az - bz);
let ui = null;

/* ======================= what the server is asked to do ======================= */
const flags = () => (me.moving ? 1 : 0) | (me.dash > 0 ? 2 : 0);
const here = () => net.sendPos(me.x, me.z, me.r, flags(), true);
/** Runs one request at a time; a refusal is shown to the player in the server's own words. */
async function ask(fn, { good = null, sfx = 'yes', far = true } = {}) {
  if (st.busy) return { ok: false, code: 'busy', error: 'One thing at a time' };
  st.busy = true;
  try {
    here();
    let r = await fn();
    // the server checks a move against the position it last heard: if that was a step behind, say where we are and ask again
    if (!r.ok && r.code === 'far' && far) { here(); await new Promise(res => setTimeout(res, 180)); r = await fn(); }
    if (!r.ok) { toast(r.error, 'bad'); emit('sfx', 'err'); } else { if (good) toast(good, 'good'); emit('sfx', sfx); kickMe(0.18); }
    return r;
  } finally { st.busy = false; }
}
export const doTake = id => ask(() => net.take(id), { sfx: 'pick' });
export const doPut = (id, plot = null) => ask(() => net.put(id, plot), { sfx: 'drop' });
export const doBell = () => ask(() => net.bell(), { sfx: 'bell' });
export const doSign = sign => ask(() => net.setSign(sign), { good: `Your door says "${SIGN_NAME[sign]}"`, far: false });
export async function doEnter(plot) {
  if (st.busy) return { refused: 'busy' };
  st.busy = true;
  try {
    here(); st.onEnter?.(plot);
    let r = await net.go(`k:${plot}`);
    if (r.refused === 'far') { here(); await new Promise(res => setTimeout(res, 180)); r = await net.go(`k:${plot}`); }
    if (r.refused) { toast(r.refused === 'far' ? 'Walk up to the doormat first.' : r.refused === 'gone' ? 'Nobody has opened a restaurant there.' : 'The door is stuck. Try again.', 'bad'); emit('sfx', 'err'); }
    else emit('sfx', 'door');
    return r;
  } finally { st.busy = false; }
}
export function doEmote(e) { if (!me.pid || e < 1 || e > 4) return; net.emote(e); sayLocal(me.pid, e); kickMe(0.2); emit('sfx', 'pick'); closeWheel(); }
export function doSay(q) { if (!me.pid || q < 0 || q >= PHRASES.length) return; net.say(q); sayLocal(me.pid, 10 + q); kickMe(0.15); emit('sfx', 'open'); closeWheel(); }

/* ======================= what is next to you, and what E, F, R and Q would do to it ======================= */
const sizeChip = c => `<i class="sz ${esc(c.size)}">${esc(c.size)}</i>`;
function resolve() {
  const w = net.town.world; if (!w || !me.visible) return null;
  const you = w.you, mine = net.me(), carry = (mine?.carry || []).map(net.cardOf).filter(Boolean), pk = w.park;
  const full = carry.length >= 2;
  let best = null, score = 1e9;
  const offer = (s, make) => { if (s < score) { score = s; best = make; } };
  for (const c of w.cards) {
    if (c.state !== 'backlog') continue;
    const at = cardXZ(c.id), x = at && dist(at.x, at.z, c.x, c.z) < 1 ? at.x : c.x, z = at && dist(at.x, at.z, c.x, c.z) < 1 ? at.z : c.z, d = dist(me.x, me.z, x, z);
    if (d < 1.55) offer(d, () => {
      const tm = net.teamOf(c.team), ours = c.team === you.team;
      return { kind: 'card', id: c.id, x, z, size: 1.15, eyebrow: `${ours ? 'Your team\'s backlog' : `${tm?.name || 'Another team'}'s backlog`}${c.rush ? ' · lunch rush' : ''}`, title: c.title, chip: sizeChip(c), tone: tm?.color,
        sub: ours ? '' : 'Only their team can take this customer. Ask them to offer it to you.',
        html: `<span class="pk-tag" style="--c:${tm?.color || '#8a7f78'}">${sizeChip(c)}${esc(c.title)}</span>`, y: 3.1,
        acts: ours ? [{ key: 'E', label: 'Take', off: full ? 'Hands full' : null, run: () => doTake(c.id) }] : [] };
    });
  }
  for (const pl of w.plots) {
    const d = dist(me.x, me.z, pl.x, pl.z);
    if (d < 1.5) offer(d - 0.25, () => door(pl, w, you, carry));
  }
  const dBell = dist(me.x, me.z, pk.bell[0], pk.bell[1]);
  if (dBell < pk.bellReach - 0.25) offer(dBell - 1.6, () => {
    const now = net.townNow(), open = w.plots.filter(p => p.owner).length, wait = Math.ceil((w.bellAt - now) / 1000);
    const off = open < 2 ? 'Needs 2 restaurants' : wait > 0 ? `Rests ${Math.floor(wait / 60)}:${String(wait % 60).padStart(2, '0')}` : null;
    return { kind: 'bell', x: pk.bell[0], z: pk.bell[1], size: 5.4, eyebrow: 'The fountain', title: 'Lunch bell', sub: w.rush ? `Lunch rush: ${w.rush.left} still to seat` : 'A bus brings two customers for every restaurant. Seat them all in time and everyone earns +100.', acts: [{ key: 'E', label: 'Ring the bell', off, run: doBell }] };
  });
  for (const [kind, at, title, sub] of [['board', pk.board, 'Town board', 'Every customer in town, column by column.'], ['leaderboard', pk.leaderboard, 'Leaderboard', 'Teams and restaurants by score.']]) {
    const d = dist(me.x, me.z, at[0], at[1] + 1.0);
    if (d < 1.7) offer(d, () => ({ kind, x: at[0], z: at[1] + 1.0, size: 1.5, eyebrow: 'Chalkboard', title, sub, acts: [{ key: 'E', label: 'Open', run: () => st.onBoard?.(kind === 'board' ? 'town' : 'leaderboard') }] }));
  }
  const hot = best ? best() : carry.length ? { kind: 'carry', eyebrow: 'Following you', title: carry.map(c => c.title).join(' + '), chip: sizeChip(carry[0]), sub: 'Walk them to a door: yours, a teammate\'s, or offer them to another team.', acts: [] } : null;
  if (hot && carry.length) hot.acts.push({ key: 'Q', label: carry.length > 1 ? 'Send one back' : 'Send back', run: () => doPut(carry.at(-1).id, null) });
  return hot;
}
function door(pl, w, you, carry) {
  const rel = net.relationTo(pl), tm = net.teamOf(pl.team);
  const hot = { kind: 'door', plot: pl.id, x: pl.x, z: pl.z, size: 1.5, tone: tm?.color, acts: [] };
  if (!rel) return { ...hot, eyebrow: 'For lease', title: 'Nobody has opened here yet', sub: 'The next player to join may get this plot.' };
  const queue = pl.queue.map(net.cardOf).filter(Boolean), lead = carry[0];
  const facts = [`${pl.queue.length}/6 waiting`, pl.open ? 'the chef is in' : 'back soon'];
  if (pl.lights.fire) facts.push('on fire!'); else if (pl.lights.blocked + pl.lights.stalled > 0) facts.push('a chef is stuck');
  hot.title = rel === 'owner' ? 'Your restaurant' : `${pl.name}'s restaurant`;
  hot.eyebrow = `${rel === 'owner' ? 'Home' : rel === 'team' ? 'Teammate' : tm?.name || 'Another team'} · ${SIGN_NAME[pl.sign]}`;
  hot.sub = facts.join(' · ');
  const inside = { label: rel === 'owner' ? 'Go inside' : 'Visit', run: () => doEnter(pl.id) };
  if (lead) {
    const verb = rel === 'owner' ? 'Queue' : rel === 'team' ? `Send to ${pl.name}` : `Offer to ${pl.name}`;
    const off = rel === 'stranger' && pl.sign === 'private' ? 'Private door' : (rel === 'stranger' ? pl.offers.length >= 4 : pl.queue.length >= 6) ? 'Full' : null;
    hot.acts.push({ key: 'E', label: verb, off, run: () => doPut(lead.id, pl.id) }, { key: 'F', ...inside, short: rel === 'owner' ? 'Go in' : 'Visit' });
    if (rel === 'stranger' && !off) hot.sub = `They accept or decline. ${hot.sub}`;
  } else {
    hot.acts.push({ key: 'E', ...inside });
    const last = queue.at(-1);
    if (last && rel !== 'stranger') hot.acts.push({ key: 'F', label: rel === 'owner' ? 'Take one back' : 'Take one', short: 'Take one', run: () => doTake(last.id) });
    const mine = pl.offers.map(net.cardOf).find(c => c && c.from === you.pid);
    if (mine) hot.acts.push({ key: 'F', label: 'Withdraw offer', short: 'With-<br>draw', run: () => ask(() => net.decline(mine.id), { sfx: 'back', far: false }) });
  }
  if (rel === 'owner') hot.acts.push({ key: 'R', label: 'Door sign', run: () => openSign() });
  return hot;
}
export const hotTarget = () => st.hot;
export const actions = () => st.acts.map(a => ({ key: a.key, label: a.label, off: a.off || null }));

/* ======================= walking ======================= */
let waiter = null;
function endGoal(arrived) { const g = st.goal; st.goal = null; setGoal(null); if (waiter) { const w = waiter; waiter = null; w(arrived); } if (arrived && g?.then) g.then(); }
/** Walks to a point of the lawn, round whatever stands in the way. Resolves true on arrival, false if it gave up or you steered. */
export function walkTo(x, z, then = null) {
  if (st.goal) endGoal(false);
  x = clamp(x, -19.6, 19.6); z = clamp(z, -8.6, 8.6);
  // a goal inside the furniture is pulled back toward you until there is room to stand
  for (let i = 0; i < 24 && parkBlocked(x, z, R - 0.03); i++) { const d = dist(me.x, me.z, x, z) || 1; x += (me.x - x) / d * 0.2; z += (me.z - z) / d * 0.2; }
  st.goal = { x, z, then, t: 0 }; st.stuck = 0;
  if (!then) setGoal(x, z);
  return new Promise(res => { waiter = res; });
}
function steer(mx, mz) {
  // feel along the obstacle: the first heading near the wanted one that has room ahead
  for (const a of [0, 0.6, -0.6, 1.15, -1.15, 1.7, -1.7]) {
    const c = Math.cos(a), s = Math.sin(a), x = mx * c - mz * s, z = mx * s + mz * c;
    if (!parkBlocked(me.x + x * 0.45, me.z + z * 0.45, R)) return [x, z];
  }
  return [mx, mz];
}
function move(dt, mv) {
  let mx = 0, mz = 0, mag = 1;
  if (mv && (mv.x || mv.y)) { mx = mv.x; mz = mv.y; mag = mv.mag ?? Math.min(1, Math.hypot(mx, mz)); }
  else if (st.standalone) {
    mx = (keys.right ? 1 : 0) - (keys.left ? 1 : 0); mz = (keys.down ? 1 : 0) - (keys.up ? 1 : 0);
    if (stick.id !== null) { mx = stick.x; mz = stick.y; mag = Math.min(1, Math.hypot(mx, mz)); }
  }
  if (modal() || typing() || st.wheel || st.sign) mx = mz = 0;
  me.dash = Math.max(0, me.dash - dt); st.dashCool = Math.max(0, st.dashCool - dt);
  const speed = SPEED * (me.dash > 0 ? 1.8 : 1);
  if (mx || mz) { const l = Math.hypot(mx, mz); mx /= l; mz /= l; if (st.goal) endGoal(false); }
  else if (st.goal) {
    const g = st.goal, dx = g.x - me.x, dz = g.z - me.z, d = Math.hypot(dx, dz);
    g.t += dt;
    if (d < Math.max(0.1, speed * dt + 0.03)) { if (!parkBlocked(g.x, g.z, R - 0.03)) { me.x = g.x; me.z = g.z; } st.vx = st.vz = 0; endGoal(true); }
    else if (st.stuck > 0.9 || g.t > 25) endGoal(false);
    else [mx, mz] = steer(dx / d, dz / d);
  }
  const k = Math.min(1, dt * 20);
  st.vx += (mx * speed * mag - st.vx) * k; st.vz += (mz * speed * mag - st.vz) * k;
  if (!mx && !mz && Math.hypot(st.vx, st.vz) < 0.4) st.vx = st.vz = 0;
  const ox = me.x, oz = me.z, n = Math.max(1, Math.ceil(dt / 0.016));
  for (let i = 0; i < n; i++) {
    const sx = st.vx * dt / n, sz = st.vz * dt / n;
    if (!parkBlocked(me.x + sx, me.z, R)) me.x += sx; else st.vx = 0;
    if (!parkBlocked(me.x, me.z + sz, R)) me.z += sz; else st.vz = 0;
  }
  const was = me.moving;
  me.moving = !!(mx || mz);
  st.stuck = me.moving && dist(ox, oz, me.x, me.z) < speed * dt * 0.15 ? st.stuck + dt : 0;
  if (me.moving) {
    const d = Math.atan2(mx, mz) - me.r; me.r += Math.atan2(Math.sin(d), Math.cos(d)) * Math.min(1, dt * 16);
    me.pace = me.dash > 0 ? 1.5 : 1;
    st.stepT += dt; if (st.stepT > 0.16 && me.dash > 0) { st.stepT = 0; puff(me.x, 0.14, me.z, '#f3e2c0', { n: 2, spread: 0.4, up: 0.5, out: 1.2, life: 0.45, size: 0.7 }); }
  }
  if (was !== me.moving) kickMe(me.moving ? -0.12 : 0.12);
}
function dash() { if (st.dashCool > 0 || !me.moving) return; me.dash = 0.25; st.dashCool = 0.7; emit('sfx', 'dash'); }

/* ======================= keys, buttons, taps ======================= */
function runKey(key) {
  const a = st.acts.find(x => x.key === key); if (!a) return false;
  if (a.off) { toast(a.off, 'bad'); emit('sfx', 'no'); return true; }
  a.run(); return true;
}
/** What a key does in the park, by its letter: for the pad and the card's buttons as much as for the keyboard. */
export function parkPress(key) {
  if (!st.active) return false;
  if (st.wheel) {
    const n = Number(key);
    if (n >= 1 && n <= (st.wheel === 'say' ? 8 : 4)) { if (st.wheel === 'say') doSay(n - 1); else doEmote(n); return true; }
    if (key === 'C' || key === 'Escape' || key === 'G') { closeWheel(); return true; }
    return true;
  }
  if (st.sign) { if (key === 'Escape' || key === 'R') closeSign(); return true; }
  if (key === 'E' || key === 'F' || key === 'R' || key === 'Q') return runKey(key);
  if (key === 'Shift') { dash(); return true; }
  if (key >= '1' && key <= '4') { doEmote(Number(key)); return true; }
  if (key === 'C') { openWheel('say'); return true; }
  if (key === 'G') { openWheel('emote'); return true; }
  if (key === 'B') { st.onBoard?.('town'); return true; }
  if (key === 'N') { st.onBoard?.('you'); return true; }
  if (key === 'V') { setOverview(!isOverview()); return true; }
  return false;
}
/** A keydown in the park. True when the park used it. */
export function parkKey(e) {
  if (!st.active || typing() || e.ctrlKey || e.metaKey || e.altKey) return false;
  if (modal() && e.key !== 'Escape') return false;
  const key = e.key === 'Shift' ? 'Shift' : e.key === 'Escape' ? 'Escape' : e.code.startsWith('Key') ? e.code.slice(3) : e.code.startsWith('Digit') ? e.code.slice(5) : e.key;
  if (e.repeat && key !== 'Shift') return false;
  return parkPress(key);
}
/** A click or a quick tap on the park: walk there, and if it was a thing, use it on arrival. */
export function parkTap(cx, cy) {
  if (!st.active || modal()) return;
  if (st.wheel) return closeWheel();
  if (st.sign) return closeSign();
  const w = net.town.world, p = groundAt(cx, cy); if (!w || !p) return;
  // a finger lands on a body, and a body stands in front of the ground the ray reaches: look a little nearer the camera too
  const near = (x, z) => Math.min(dist(p.x, p.z, x, z), dist(p.x, p.z + 0.6, x, z), dist(p.x, p.z + 1.2, x, z) + 0.15);
  const then = (kind, id) => () => { const h = resolve(); if (h && h.kind === kind && (id === undefined || h.id === id || h.plot === id)) { st.hot = h; st.acts = h.acts; runKey('E'); } };
  let best = null, score = 0.85;
  for (const c of w.cards) {
    if (c.state !== 'backlog') continue;
    const at = cardXZ(c.id) || c, d = near(at.x, at.z);
    if (d < score) { score = d; best = () => { const dd = dist(me.x, me.z, at.x, at.z) || 1, k = Math.min(1, 0.95 / dd); walkTo(at.x + (me.x - at.x) * k, at.z + (me.z - at.z) * k, () => { const now = net.cardOf(c.id); if (now?.state === 'backlog' && now.team === w.you.team) doTake(c.id); else then('card', c.id)(); }); }; }
  }
  if (!best) for (const pl of w.plots) {
    const f = plotFrame(pl.id), house = dist(p.x, p.z, f.hx + f.ox * 1.4, f.hz + f.oz * 1.4) < 2.3, mat = near(pl.x, pl.z) < 1.0, post = dist(p.x, p.z, f.px, f.pz) < 0.8 || dist(p.x, p.z + 1.6, f.px, f.pz) < 0.9;
    if (house || mat || post) { best = () => walkTo(pl.x, pl.z, then('door', pl.id)); break; }
  }
  const pk = w.park;
  if (!best && dist(p.x, p.z, pk.bell[0], pk.bell[1]) < 2.7) best = () => { const d = dist(me.x, me.z, pk.bell[0], pk.bell[1]) || 1; walkTo(pk.bell[0] + (me.x - pk.bell[0]) / d * 2.75, pk.bell[1] + (me.z - pk.bell[1]) / d * 2.75, then('bell')); };
  if (!best) for (const [kind, at] of [['board', pk.board], ['leaderboard', pk.leaderboard]]) if (Math.abs(p.x - at[0]) < 1.7 && p.z > at[1] - 2.4 && p.z < at[1] + 1.2) best = () => walkTo(at[0], at[1] + 1.0, then(kind));
  if (best) { emit('sfx', 'step'); return best(); }
  if (Math.abs(p.x) > 21 || Math.abs(p.z) > 10) return;
  walkTo(p.x, p.z);
}

/* ---------- a page of its own: keys, the mouse and a thumb stick on the canvas ---------- */
const stick = { id: null, x: 0, y: 0, ox: 0, oy: 0, kx: 0, ky: 0 };
const STICK_R = 52, fingers = new Map();
function listen() {
  addEventListener('keydown', e => {
    if (!st.active) return;
    if (KEYMAP[e.code] && !typing()) { keys[KEYMAP[e.code]] = true; if (st.goal) endGoal(false); e.preventDefault(); return; }
    if (parkKey(e)) e.preventDefault();
  });
  addEventListener('keyup', e => { if (KEYMAP[e.code]) keys[KEYMAP[e.code]] = false; });
  addEventListener('blur', () => { for (const k in keys) keys[k] = false; });
  const canvas = renderer.domElement;
  canvas.addEventListener('pointerdown', e => {
    if (!st.active || modal()) return;
    if (document.activeElement && document.activeElement !== document.body) document.activeElement.blur?.();
    if (e.pointerType === 'mouse') return parkTap(e.clientX, e.clientY);
    fingers.set(e.pointerId, { x: e.clientX, y: e.clientY, t: performance.now() });
    try { canvas.setPointerCapture(e.pointerId); } catch { /* already gone */ }
  });
  canvas.addEventListener('pointermove', e => {
    const f = fingers.get(e.pointerId); if (!f) return;
    if (stick.id === null && Math.hypot(e.clientX - f.x, e.clientY - f.y) > 12) { stick.id = e.pointerId; stick.ox = f.x; stick.oy = f.y; if (st.goal) endGoal(false); }
    if (stick.id !== e.pointerId) return;
    let dx = e.clientX - stick.ox, dy = e.clientY - stick.oy, d = Math.hypot(dx, dy);
    if (d > STICK_R) { stick.ox += dx * (1 - STICK_R / d); stick.oy += dy * (1 - STICK_R / d); dx *= STICK_R / d; dy *= STICK_R / d; d = STICK_R; }
    stick.kx = dx; stick.ky = dy;
    const k = d < 9 ? 0 : Math.min(1, (d - 9) / (STICK_R * 0.6)) / (d || 1);
    stick.x = dx * k; stick.y = dy * k;
  });
  const lift = e => {
    const f = fingers.get(e.pointerId); if (!f) return;
    fingers.delete(e.pointerId);
    if (stick.id === e.pointerId) { stick.id = null; stick.x = stick.y = stick.kx = stick.ky = 0; return; }
    if (e.type === 'pointerup' && performance.now() - f.t < 600) parkTap(f.x, f.y);
  };
  canvas.addEventListener('pointerup', lift); canvas.addEventListener('pointercancel', lift);
  canvas.addEventListener('touchmove', e => e.preventDefault(), { passive: false });
  canvas.addEventListener('contextmenu', e => e.preventDefault());
}

/* ======================= the park's own controls on screen ======================= */
const EMO = [null,
  '<path d="M8 12V6.3a1.4 1.4 0 0 1 2.8 0V11V4.6a1.4 1.4 0 0 1 2.8 0V11V5.6a1.4 1.4 0 0 1 2.8 0V12V8.4a1.4 1.4 0 0 1 2.8 0V15a6.5 6.5 0 0 1-6.5 6.5c-2.9 0-4.4-1.2-5.9-3.6L4.4 14a1.45 1.45 0 0 1 2.4-1.6L8 14z" fill="#f3c9a0" stroke="#3a241c" stroke-width="1.7" stroke-linejoin="round"/>',
  '<path d="M12 2.5l2.9 6 6.6.9-4.8 4.6 1.2 6.5L12 17.4l-5.9 3.1 1.2-6.5L2.5 9.4l6.6-.9z" fill="#ffd23f" stroke="#3a241c" stroke-width="1.7" stroke-linejoin="round"/>',
  '<circle cx="12" cy="12" r="10" fill="#ff5a3c" stroke="#3a241c" stroke-width="1.7"/><path d="M12 6.5v7" stroke="#fff" stroke-width="3" stroke-linecap="round"/><circle cx="12" cy="17.3" r="1.7" fill="#fff"/>',
  '<path d="M12 20.5C4 15 5.5 6.5 12 9.5c6.5-3 8 5.5 0 11z" fill="#e5484d" stroke="#3a241c" stroke-width="1.7" stroke-linejoin="round"/>'];
const emoteIcon = i => `<i class="pk-emo"><svg viewBox="0 0 24 24" aria-hidden="true">${EMO[i]}</svg></i>`;
function build() {
  const root = document.createElement('div'); root.className = 'pk-ui'; root.id = 'parkUi'; root.hidden = true;
  root.innerHTML = `
    <div class="pk-card quiet" id="pkCard" aria-live="polite"></div>
    <div class="pk-pad" id="pkPad">
      <button class="tb" type="button" data-pk="G" aria-label="Emote">${emoteIcon(1)}<em>Emote</em></button>
      <button class="tb" type="button" data-pk="C" aria-label="Say something"><span class="pk-bub"></span><em>Say</em></button>
      <button class="tb" type="button" data-pk="B" aria-label="Town board"><span>${ICON.list}</span><em>Board</em></button>
      <button class="tb" type="button" data-pk="Shift"><em>Dash</em></button>
      <button class="tb ctx" type="button" data-pk="Q" id="pkPut" hidden><em>Send<br>back</em></button>
      <button class="tb ctx" type="button" data-pk="F" id="pkAlt" hidden><em id="pkAltText"></em></button>
      <button class="tb act idle" type="button" data-pk="E" id="pkAct"><b>USE</b><small id="pkActHint"></small></button>
    </div>
    <div class="pk-wheel" id="pkWheel" hidden role="dialog" aria-label="Say something">
      <div class="pk-wheel-in">
        <div class="pk-emotes">${EMOTES.slice(1).map(e => `<button type="button" data-emote="${e.id}">${emoteIcon(e.id)}<em>${e.name}</em><kbd class="for-keys">${e.id}</kbd></button>`).join('')}</div>
        <div class="pk-phrases">${PHRASES.map((p, i) => `<button type="button" data-say="${i}" style="--i:${i}"><kbd class="for-keys">${i + 1}</kbd>${esc(p)}</button>`).join('')}</div>
        <button class="rb pk-x" type="button" data-pk="Escape" aria-label="Close">×</button>
      </div>
    </div>
    <div class="pk-sign" id="pkSign" hidden role="dialog" aria-label="Door sign">
      <h3>Your door sign</h3>
      ${Object.keys(SIGN_NAME).map(s => `<button type="button" data-sign="${s}"><b>${SIGN_NAME[s]}</b><small>${SIGN_WHAT[s]}</small></button>`).join('')}
      <button class="btn small ghost" type="button" data-pk="Escape">Close</button>
    </div>
    <div class="pk-thumb" id="pkThumb" hidden><i id="pkKnob"></i></div>`;
  document.getElementById('stage').append(root);
  const q = sel => root.querySelector(sel);
  ui = { root, card: q('#pkCard'), act: q('#pkAct'), actHint: q('#pkActHint'), put: q('#pkPut'), alt: q('#pkAlt'), altText: q('#pkAltText'), wheel: q('#pkWheel'), sign: q('#pkSign'), thumb: q('#pkThumb'), knob: q('#pkKnob'), html: '' };
  // pressed on touch-down, so a thumb on the stick and a thumb on USE work together
  root.addEventListener('pointerdown', e => {
    const b = e.target.closest('[data-pk]');
    if (b) { e.preventDefault(); b.classList.add('down'); setTimeout(() => b.classList.remove('down'), 140); if (b.dataset.pk === 'Escape') { closeWheel(); closeSign(); } else parkPress(b.dataset.pk); return; }
    const em = e.target.closest('[data-emote]'); if (em) { e.preventDefault(); return doEmote(Number(em.dataset.emote)); }
    const sy = e.target.closest('[data-say]'); if (sy) { e.preventDefault(); return doSay(Number(sy.dataset.say)); }
    const sg = e.target.closest('[data-sign]'); if (sg) { e.preventDefault(); closeSign(); return void doSign(sg.dataset.sign); }
    if (e.target === ui.wheel) closeWheel();
  });
  root.addEventListener('contextmenu', e => e.preventDefault());
  ui.card.addEventListener('click', e => { if (e.target.closest('.pk-card') && !e.target.closest('button')) e.stopPropagation(); });
}
function openWheel(mode) { closeSign(); st.wheel = mode; ui.wheel.hidden = false; ui.wheel.dataset.mode = mode; }
function closeWheel() { if (!st.wheel) return; st.wheel = null; ui.wheel.hidden = true; }
function openSign() { closeWheel(); st.sign = true; ui.sign.hidden = false; const cur = net.myPlot()?.sign; for (const b of ui.sign.querySelectorAll('[data-sign]')) b.classList.toggle('on', b.dataset.sign === cur); }
function closeSign() { if (!st.sign) return; st.sign = false; ui.sign.hidden = true; }
const kbd = k => `<kbd class="for-keys">${k}</kbd>`;
function draw() {
  const h = st.hot, touch = document.body.classList.contains('touch');
  let html;
  if (!h) html = `<div class="pk-keys">${touch ? '<span><b>Drag</b> to walk</span><span><b>Tap</b> a customer or a door</span>' : `<span>${kbd('WASD')} walk</span><span>${kbd('E')} use</span><span>${kbd('C')} say</span><span>${kbd('1')}–${kbd('4')} emote</span><span>${kbd('B')} board</span><span>${kbd('V')} town view</span>`}</div>`;
  else {
    const acts = h.acts.map(a => `<button class="btn small${a.key === 'E' ? '' : ' ghost'}${a.off ? ' off' : ''}" type="button" data-pk="${a.key}"${a.off ? ' aria-disabled="true"' : ''}>${kbd(a.key)}${esc(a.off || a.label)}</button>`).join('');
    html = `<div class="pk-row1"><small>${esc(h.eyebrow || '')}</small><b>${h.chip || ''}${esc(h.title || '')}</b></div>${h.sub ? `<p>${esc(h.sub)}</p>` : ''}${acts ? `<div class="pk-acts">${acts}</div>` : ''}`;
  }
  if (html !== ui.html) { ui.html = html; ui.card.innerHTML = html; ui.card.classList.toggle('quiet', !h); ui.card.style.setProperty('--c', h?.tone || 'transparent'); }
  const e = st.acts.find(a => a.key === 'E'), f = st.acts.find(a => a.key === 'F'), qd = st.acts.find(a => a.key === 'Q');
  const hint = e ? e.off || e.label : '';
  if (ui.actHint.textContent !== hint) ui.actHint.textContent = hint;
  ui.act.classList.toggle('idle', !e || !!e.off); ui.act.classList.toggle('want', !!e && !e.off);
  if (ui.put.hidden === !!qd) ui.put.hidden = !qd;
  if (ui.alt.hidden === !!f) ui.alt.hidden = !f;
  if (f && ui.altHtml !== (f.short || f.label)) { ui.altHtml = f.short || f.label; ui.altText.innerHTML = ui.altHtml; }
}
function layout() {
  const w = innerWidth, h = innerHeight, m = w < 720 && h > w ? 'portrait' : h < 540 ? 'landscape' : 'desk';
  st.layout = m; if (ui) ui.root.dataset.layout = m;
  if (st.standalone) { document.body.dataset.layout = m; document.body.classList.toggle('narrow', m !== 'desk'); }
}

export function initParkInput({ standalone = false, onBoard = null, onEnter = null } = {}) {
  if (ui) return;
  Object.assign(st, { standalone, onBoard, onEnter });
  build(); layout();
  addEventListener('resize', layout);
  if (standalone) {
    listen();
    const touchOn = () => document.body.classList.add('touch');
    if (matchMedia('(pointer: coarse)').matches) touchOn();
    addEventListener('touchstart', touchOn, { once: true, passive: true });
  }
}
export function setParkActive(on) {
  st.active = !!on;
  if (ui) ui.root.hidden = !on;
  if (!on) { closeWheel(); closeSign(); if (st.goal) endGoal(false); setHot(null); st.hot = null; st.acts = []; me.moving = false; st.vx = st.vz = 0; for (const k in keys) keys[k] = false; }
}
let drawT = 0;
export function parkFrame(dt, t, mv = null) {
  if (!st.active || !park.world) return null;
  move(dt, mv);
  net.sendPos(me.x, me.z, me.r, flags());
  const h = st.hot = resolve(); st.acts = h?.acts || [];
  setHot(h && h.x !== undefined ? h : null);
  if (t - drawT > 0.1 || t < drawT) { drawT = t; draw(); }
  if (st.standalone) {
    const on = stick.id !== null;
    if (ui.thumb.hidden === on) ui.thumb.hidden = !on;
    if (on) { ui.thumb.style.transform = `translate(${Math.round(stick.ox)}px,${Math.round(stick.oy)}px)`; ui.knob.style.transform = `translate(${Math.round(stick.kx)}px,${Math.round(stick.ky)}px)`; }
  }
  return h;
}
