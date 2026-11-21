// The town's glue: which place you are in (your kitchen, the park, somebody else's kitchen), what is drawn there, the door,
// visiting, the Start over dialog, and the hook the multi-player test drives. The park itself is park.js, its gestures are
// parkinput.js and its panels are townboard.js; this file only switches between them and the kitchen.
// Without a town (SHIP_WORLD=0, npm start) no `world` message ever arrives and nothing here does anything.
import { $, G, on, emit, toast, ICON } from './core.js';
import { addScene, setScene, toScreen, V, drawCalls, placeLabels, adapt, popup } from './scene.js';
import { player, resetWorld, syncWorld, enableDoor, doorSt, placePlayer, avatarKit, setLook, setCarry } from './world.js';
import { mode as keys, moveVector, walkTo as walkStation, SPEED } from './input.js';
import { resetPanels, hud, maybeReport, banner, boardActions } from './panels.js';
import * as net from './net.js';
import { syncAvatars, stepAvatars, LOOKS } from './presence.js';

/** mode: 'kitchen' (your own), 'park' or 'visit'. drawn: whose orders the kitchen scene holds, 'own' or a plot id. */
export const T = { mode: 'kitchen', drawn: 'own', ready: false, booting: false, park: null, pin: null, board: null, auto: null };
let draw = null, avatars = new Map();
const sleep = ms => new Promise(r => setTimeout(r, ms));
const world = () => net.town.world;
const kitchenOf = zone => (zone && zone !== 'park' ? Number(zone.slice(2)) : null);
// A module of the park that has not been written or deployed yet is not an error: the town runs with what is there.
const load = name => import(`./${name}.js`).catch(() => null);

export function initTown(hooks) {
  draw = hooks.draw;
  net.onWorld(onWorld);
  net.onZone(m => { if (m.refused) refused(m.refused); else if (T.ready) enter(m.zone, m); });
}

/* ======================= boot, on the first world message ======================= */
async function boot(w) {
  T.booting = true;
  document.body.classList.add('town');
  enableDoor();
  addStartOver();
  const css = document.createElement('link'); css.rel = 'stylesheet'; css.href = '/world.css'; css.onerror = () => css.remove(); document.head.append(css);
  const [park, pin, board] = await Promise.all([load('park'), load('parkinput'), load('townboard')]);
  T.park = park; T.pin = pin; T.board = board;
  if (park) { park.buildPark(w); addScene('park', park.parkScene); }
  pin?.initParkInput?.({ standalone: false, onBoard: tab => (T.board?.openTownBoard ? T.board.openTownBoard(tab) : toast('The town board is not up yet')) });
  // the chalkboard's "My kitchen" tab is the L board: the same cards and actions, minus the ones that need you in the room
  const { close: _close, ...kitchenActions } = boardActions;
  board?.initTownBoard?.({ kitchen: () => G.own, kitchenActions, onStartOver: openStartOver });
  keys.tap = (x, y) => (T.pin?.parkTap ? T.pin.parkTap(x, y) : lite.tap(x, y));
  keys.key = e => (T.pin?.parkKey ? T.pin.parkKey(e) : lite.key(e));
  T.ready = true; T.booting = false;
  onWorld(world());
  // a page opened while its player stands in the park, or in somebody's kitchen, joins them there
  const z = net.town.zone;
  if (z && z !== `k:${world().you.plot}`) { const p = net.me(); enter(z, { x: p?.x ?? null, z: p?.z ?? null }, true); }
  emit('layout');
}

function onWorld(w) {
  if (!w) return;
  if (!T.ready) { if (!T.booting) boot(w); return; }
  T.park?.syncPark(w);
  T.board?.syncTownUi?.(w);
  avatars = syncAvatars(net.town.zone, w, avatarKit);
  setLook(player, LOOKS[w.you.look % LOOKS.length]);
  if (G.visit) { const pl = net.plotOf(G.visit.of); if (pl?.owner) Object.assign(G.visit, { owner: pl.name, sign: pl.sign }); }
  showBanner();
}

/* ======================= changing place ======================= */
const REFUSED = { far: 'Walk up to the doormat first', gone: 'Nobody has opened a restaurant there', offline: 'The town is not answering', timeout: 'The town is not answering', bad: '' };
function refused(code) { if (REFUSED[code] !== '') toast(REFUSED[code] || 'You cannot go in there', 'bad'); }
function setMode(m) {
  T.mode = m; document.body.dataset.zone = m; keys.park = m === 'park';
  T.auto = null;
}
function wipe() { const el = $('iris'); el.classList.remove('on'); void el.offsetWidth; el.classList.add('on'); }
/** Puts your own orders back in the kitchen scene after it showed somebody else's. */
function restoreOwn() {
  if (T.drawn === 'own') return;
  resetWorld(); resetPanels(); G.S = null; T.drawn = 'own';
}
function enter(zone, at = {}, quietly = false) {
  const w = world(), plot = kitchenOf(zone), mine = plot === w.you.plot;
  if (!quietly) { wipe(); emit('sfx', 'door'); }
  T.pin?.setParkActive?.(zone === 'park');
  if (zone === 'park') {
    if (!T.park) { toast('The park is not open yet', 'bad'); net.go(`k:${w.you.plot}`); return; }
    G.visit = null; restoreOwn();
    if (G.own) draw(G.own, true);                 // your kitchen carries on behind the door, silently
    setMode('park');
    const mat = net.myPlot();
    T.park.setOverview(false);
    T.park.placeMe(at.x ?? mat?.x ?? 0, at.z ?? mat?.z ?? 0);
  } else if (mine) {
    G.visit = null; restoreOwn();
    setMode('kitchen'); setScene('kitchen');
    placePlayer(doorSt.access[0]);
    if (G.own) draw(G.own, true);
  } else {
    const pl = net.plotOf(plot);
    resetWorld(); resetPanels(); G.S = null; T.drawn = plot;
    // what you may do here arrives with the kitchen's first state; until then you may only look
    G.visit = { of: plot, relation: net.relationTo(pl), rights: { watch: true }, owner: pl?.name || 'the owner', sign: pl?.sign || 'team', live: false };
    setMode('visit'); setScene('kitchen');
    placePlayer(doorSt.access[0]);
  }
  avatars = syncAvatars(zone, w, avatarKit);
  showBanner();
  emit('zone', T.mode); emit('layout');
}
on('door', async () => { const r = await net.go('park'); if (r.refused && r.refused !== 'bad') refused(r.refused); });

/* ======================= kitchen states ======================= */
/** A state of your own kitchen arrived. Returns true when you are not in it, so the caller must not draw it as usual. */
export function ownState(next) {
  if (!net.town.on || T.mode === 'kitchen') return false;
  if (T.drawn === 'own') draw(next, true);        // kept up to date while you are in the park, with no sound and no popups
  else { hud(); maybeReport(); }                  // you are in somebody else's kitchen: only your HUD follows your own
  return true;
}
/** The kitchen you are visiting. */
export function townState(m) {
  if (net.town.zone !== `k:${m.of}` || !G.visit || G.visit.of !== m.of) return;
  const pl = net.plotOf(m.of);
  Object.assign(G.visit, { relation: m.relation, rights: m.rights || {}, owner: pl?.name || G.visit.owner, sign: pl?.sign || G.visit.sign, live: true });
  G.offset = m.state.now - Date.now();
  G.S = m.state;
  syncWorld();
  showBanner();
}

/* ======================= the banner over a kitchen you are visiting ======================= */
const SIGN = { team: 'Open to team', help: 'Help wanted', private: 'Private' };
function showBanner() {
  const v = T.mode === 'visit' ? G.visit : null, el = $('visitBanner');
  if (el.hidden !== !v) el.hidden = !v;
  if (!v) return;
  const r = v.rights || {};
  const can = !v.live ? 'Stepping inside…' : v.sign === 'private' ? 'Private: you can watch'
    : r.answer && r.approve ? 'Teammate: you can answer and approve' : r.answer ? 'Help wanted: you can answer their chefs' : 'You can watch and cheer';
  const who = `Visiting ${v.owner}'s kitchen`;
  if ($('visitText').textContent !== who) $('visitText').textContent = who;
  if ($('visitCan').textContent !== can) $('visitCan').textContent = can;
  el.dataset.sign = v.sign; el.title = `Door sign: ${SIGN[v.sign] || v.sign}`;
  if ($('visitCheer').hidden !== !r.cheer) $('visitCheer').hidden = !r.cheer;
}
$('visitLeave').onclick = () => emit('door');
$('visitCheer').onclick = async () => {
  if (!G.visit) return;
  const r = await net.cheer(G.visit.of);
  if (r.ok) { emit('sfx', 'yes'); popup(`+5 for ${G.visit.owner}`, V(player.g.position.x, 2.2, player.g.position.z), 'good'); } else toast(r.error, 'bad');
};

/* ======================= Start over: a fresh kitchen, or (the presenter) a fresh town ======================= */
function addStartOver() {
  if ($('startOverBtn')) return;
  const b = document.createElement('button');
  b.className = 'rb'; b.id = 'startOverBtn'; b.type = 'button'; b.title = 'Start over'; b.setAttribute('aria-label', 'Start over');
  b.innerHTML = `<span>${ICON.restart}</span><em>Start over</em>`;
  b.onclick = openStartOver;
  $('tools').append(b);
}
export function openStartOver() {
  $('resetToken').value = ''; $('resetMsg').textContent = ''; $('resetBox').open = false;
  $('startOver').showModal(); $('freshGo').focus();
}
$('startOverClose').onclick = () => $('startOver').close();
$('startOver').addEventListener('close', () => { $('resetToken').value = ''; });
$('freshGo').onclick = async () => {
  $('startOver').close();
  const r = await net.freshKitchen();
  if (r.ok) { banner('Fresh kitchen', 'A clean slate on the same plot', 'go'); emit('sfx', 'start'); } else toast(r.error, 'bad');
};
$('resetForm').addEventListener('submit', async e => {
  e.preventDefault();
  // the token goes from the field to the server and nowhere else: it is not kept in a variable, a URL or storage
  const field = $('resetToken'), given = field.value;
  field.value = '';
  if (!given) { $('resetMsg').textContent = 'Type the token from the presenter\'s terminal.'; return; }
  $('resetMsg').textContent = 'Resetting…';
  const r = await net.resetTown(given);
  $('resetMsg').textContent = r.ok ? 'The town is reset. Reloading…' : r.error;
});

/* ======================= a small stand-in for parkinput.js: walk, and E at whatever is in reach ======================= */
const lite = {
  near() {
    const w = world(), me = T.park.me, reach = (w.park?.reach ?? 2.2) - 0.5, d = (x, z) => Math.hypot(me.x - x, me.z - z);
    const mine = net.me()?.carry || [];
    const mat = w.plots.filter(p => p.owner && d(p.x, p.z) <= reach).sort((a, b) => d(a.x, a.z) - d(b.x, b.z))[0];
    if (mat) return { mat };
    const card = w.cards.filter(c => c.state === 'backlog' && c.team === w.you.team && d(c.x, c.z) <= reach).sort((a, b) => d(a.x, a.z) - d(b.x, b.z))[0];
    return card && mine.length < 2 ? { card } : null;
  },
  async act() {
    const n = lite.near(), carry = net.me()?.carry || [];
    if (!n) return;
    const say = r => { if (!r.ok) toast(r.error, 'bad'); else emit('sfx', 'pick'); };
    if (n.card) return say(await net.take(n.card.id));
    if (carry.length) return say(await net.put(carry[0], n.mat.id));
    const r = await net.go(`k:${n.mat.id}`); if (r.refused) refused(r.refused);
  },
  key(e) {
    if (e.code === 'KeyE' || e.code === 'Space') { lite.act(); return true; }
    if (e.code === 'KeyQ') { const c = net.me()?.carry?.at(-1); if (c) net.put(c, null); return true; }
    if (e.code === 'KeyV') { T.park.setOverview(!T.park.isOverview()); return true; }
    if (/^Digit[1-4]$/.test(e.code)) { net.emote(Number(e.code.slice(5))); return true; }
    return false;
  },
  tap(cx, cy) { const p = T.park.groundAt(cx, cy); if (p) walkPark(p.x, p.z).then(ok => { if (ok && lite.near()) lite.act(); }); },
  frame(dt, mv) {
    const me = T.park.me, sp = SPEED * dt * mv.mag;
    me.moving = !!(mv.x || mv.y);
    if (me.moving) {
      const l = Math.hypot(mv.x, mv.y), dx = mv.x / l * sp, dz = mv.y / l * sp;
      if (!T.park.parkBlocked(me.x + dx, me.z)) me.x += dx;
      if (!T.park.parkBlocked(me.x, me.z + dz)) me.z += dz;
      me.r = Math.atan2(dx, dz);
    }
    net.sendPos(me.x, me.z, me.r, me.moving ? 1 : 0);
  },
};

/* ======================= walking somewhere on the lawn, for a tap without parkinput.js and for the test hook ======================= */
/** Walks your avatar to a point by steering it like a held stick. Resolves true on arrival, false when something else took over. */
function walkPark(x, z, within = 0.25) {
  if (T.pin?.walkTo) {
    // parkinput.js finds its own way round the furniture; stop short by walking to a point this side of the target
    const me = T.park.me, d = Math.hypot(x - me.x, z - me.z), k = within > 0.3 && d > within ? (d - within * 0.8) / d : 1;
    return d <= within ? Promise.resolve(true) : T.pin.walkTo(me.x + (x - me.x) * k, me.z + (z - me.z) * k);
  }
  if (T.auto) T.auto.done(false);
  return new Promise(resolve => { T.auto = { x, z, within, t: 0, stuck: 0, best: 1e9, side: 1, done: ok => { if (T.auto?.done === done) T.auto = null; resolve(ok); } }; const done = T.auto.done; });
}
function steer(dt, mv) {
  const a = T.auto; if (!a || T.pin) return mv;
  if (mv.x || mv.y) { a.done(false); return mv; }           // the player took the stick back
  const me = T.park.me, dx = a.x - me.x, dz = a.z - me.z, d = Math.hypot(dx, dz);
  a.t += dt;
  if (d <= a.within || a.t > 20) { a.done(d <= a.within + 0.6); return mv; }
  // something in the way (the fountain, a board): no nearer for a while, so slide around it
  if (d < a.best - 0.05) { a.best = d; a.stuck = 0; } else a.stuck += dt;
  if (a.stuck > 0.35) { if (a.stuck > 1.6) { a.side = -a.side; a.stuck = 0.35; a.best = d; } return { x: -dz / d * a.side, y: dx / d * a.side, mag: 1 }; }
  return { x: dx / d, y: dz / d, mag: Math.min(1, 0.35 + d) };
}

/* ======================= every frame ======================= */
/** Returns true when it drew the frame (the park). In a kitchen it only reports where you are and moves the other people. */
export function townFrame(dt, t) {
  if (!net.town.on) return false;
  if (T.mode !== 'park' || !T.park) {
    const p = player.g.position;
    net.sendPos(p.x, p.z, player.g.rotation.y, (player.moving ? 1 : 0) | (player.dash > 0 ? 2 : 0));
    stepAvatars(dt, t);
    return false;
  }
  const m = moveVector(), mv = steer(dt, { x: m.x, y: m.z, mag: m.mag });
  if (T.pin?.parkFrame) T.pin.parkFrame(dt, t, mv); else lite.frame(dt, mv);
  T.park.stepPark(dt, t);
  T.board?.townFrame?.(t);
  adapt();
  T.park.updateParkCamera(dt, T.park.me);
  placeLabels();
  T.park.renderPark();
  return true;
}

/* ======================= the hook: what test/worldgame.mjs drives, each verb done the way a player would ======================= */
const until = async (fn, ms = 15000) => { const t0 = performance.now(); while (!fn()) { if (performance.now() - t0 > ms) return false; await sleep(50); } return true; };
/** A move the server refused as "far" is tried again: it knows where you are from 12 messages a second, a moment behind your feet. */
async function reach(fn) { let r; for (let i = 0; i < 6; i++) { r = await fn(); if (r.ok || r.code !== 'far') break; await sleep(200); } return r; }
async function toPark() {
  if (T.mode === 'park') return true;
  if (player.carry) setCarry(null);
  walkStation(doorSt);
  return until(() => T.mode === 'park');
}
async function toDoor(plot) {
  const w = world(), pl = w.plots[plot];
  if (net.town.zone === `k:${plot}`) return true;
  if (!(await toPark())) return false;
  await walkPark(pl.x, pl.z, 0.5);
  for (let i = 0; i < 8 && net.town.zone !== `k:${plot}`; i++) { const r = await net.go(`k:${plot}`); if (r.refused) await sleep(220); }
  return until(() => net.town.zone === `k:${plot}`, 4000);
}
export const hook = {
  get on() { return net.town.on; }, get ready() { return T.ready; }, get mode() { return T.mode; }, get zone() { return net.town.zone; },
  get snap() { return world(); }, get you() { return T.ready ? world().you : null; }, get home() { return G.own; },
  get visiting() { return G.visit?.live ? G.visit : null; },
  pos() { return T.mode === 'park' ? { x: T.park.me.x, z: T.park.me.z } : { x: player.g.position.x, z: player.g.position.z }; },
  async enterPark() { await toPark(); return net.town.zone; },
  async goHome() { await toDoor(world().you.plot); return net.town.zone; },
  async visit(plot) { await toDoor(plot); return net.town.zone; },
  async walkTo(x, z) { if (T.mode !== 'park') return false; const ok = await walkPark(x, z); await sleep(120); return ok; },
  async take(id) {
    if (!(await toPark())) return { ok: false, code: 'far', error: 'Not in the park' };
    const c = net.cardOf(id); if (!c) return { ok: false, code: 'gone', error: 'No such customer' };
    const at = c.state === 'backlog' ? c : world().plots[c.plot] || c;       // where they stand, not where they are still walking from
    await walkPark(at.x, at.z, 1.1);
    return reach(() => net.take(id));
  },
  async put(id, plot) {
    if (plot === null || plot === undefined) return net.put(id, null);
    if (!(await toPark())) return { ok: false, code: 'far', error: 'Not in the park' };
    const pl = world().plots[plot];
    await walkPark(pl.x, pl.z, 0.6);
    return reach(() => net.put(id, plot));
  },
  accept: id => net.accept(id), decline: id => net.decline(id),
  bell: () => reach(() => net.bell()),
  players() {
    if (T.mode === 'park') return T.park.parkPlayers();
    return [...avatars].filter(([, a]) => a.av.g.visible).map(([pid, a]) => ({ pid, name: a.name, x: a.av.g.position.x, z: a.av.g.position.z, full: true }));
  },
  cards() { return T.park ? T.park.parkCards() : []; },
  screenOf(x, z) { if (T.mode === 'park') return T.park.screenOf(x, z); const p = toScreen(V(x, 0, z), {}); return { x: p.x, y: p.y }; },
  drawCalls() { return T.mode === 'park' ? T.park.parkStats().calls : drawCalls(); },
  labels() { return [...document.querySelectorAll('.lbl:not(.hid)')].filter(el => el.getClientRects().length).length; },
  overview(on) { T.park?.setOverview(on); },
  tap(cx, cy) { keys.tap?.(cx, cy); },
};
