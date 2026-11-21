// The app shell: one socket, one canvas, one animation loop, and one scene mounted at a time.
//
//   landing + role picker --> overview (cards) <--> park (walk) --> restaurant (read-only)
//           | Player / Judge                                           ^
//           +--> chalkboard --> own restaurant (can act) -- door / drawer
//
// The restaurant itself is game/floorapp.js (mountFloor, updateFloor, floorNotify, floorPeers, floorFrame, unmountFloor).
import { $, G, toast, esc } from './game/core.js';
import { THREE, resize, nextFrame, placeLabels, adapt, setLayout, setScene, setZoom, quality, renderer, scene as kitchenScene } from './game/scene.js';
import * as netm from './game/net.js';
import { net, act, on } from './game/net.js';
import { initRoles, showLanding, closeRoles, roles } from './game/roles.js';
import { initOverview, showOverview, hideOverview, renderOverview, overviewOpen } from './game/overview.js';
import { initTeleport, travel, openDoorPanel, openDrawer, goHome, teleport } from './game/teleport.js';
import { initPill, pillElement, renderPill, hidePill, budgetModal, pillText } from './game/pill.js';
import * as parkm from './game/park.js';
import { initParkInput, stopParkInput, parkMove } from './game/parkinput.js';
import { applyPeers, clearPeers, peerList } from './game/presence.js';
import { initSquirt, stepSquirt, clearSquirt, squirtButton, squirt } from './game/squirt.js';

const params = new URLSearchParams(location.search);
const shell = $('shell'), floorUi = $('floorUi');
/** view: 'boot' | 'landing' | 'overview' | 'park' | 'floor'. mounted: which 3D scene exists, if any. */
const state = { view: 'boot', mounted: null, floorId: null, floorMounts: 0, parkMounts: 0, floorMsgs: 0, staleDrops: 0, missing: 0 };
function setView(v) { state.view = v; document.body.dataset.view = v; }

/* ---------- the restaurant module (builder 2). A plain stand-in keeps the shell usable if it is missing. ---------- */
let floorApp = null;
const stub = {
  el: null,
  mountFloor(ctx) {
    this.ctx = ctx; this.el = document.createElement('div'); this.el.className = 'sh-stub';
    this.el.innerHTML = '<div class="sh-card"><p class="k">Restaurant</p><h2 id="stName"></h2><p id="stWho"></p><div id="stPill"></div><p id="stNums"></p><div class="sh-stack"><button type="button" class="sh-btn big" id="stDoor">The front door</button><button type="button" class="sh-btn" id="stMenu">All restaurants</button></div></div>';
    ctx.ui.append(this.el);
    this.el.querySelector('#stPill').append(ctx.pillSlot);
    this.el.querySelector('#stDoor').onclick = () => ctx.openDoor();
    this.el.querySelector('#stMenu').onclick = () => ctx.openMenu();
  },
  updateFloor(msg) {
    if (!this.el) return; const f = msg.floor;
    this.el.querySelector('#stName').textContent = `No. ${f.number} · ${f.name}`;
    this.el.querySelector('#stWho').textContent = msg.you?.canAct ? 'Your kitchen' : 'View only';
    this.el.querySelector('#stNums').textContent = `Score ${f.score} · ${f.stats?.shipped ?? 0} shipped · ${f.watchers} watching`;
  },
  floorNotify() {}, floorPeers() {}, floorFrame() {},
  unmountFloor() { this.el?.remove(); this.el = null; },
};
async function loadFloorApp() {
  if (floorApp) return floorApp;
  if (params.has('floorstub')) return (floorApp = stub);
  try {
    const m = await import('./game/floorapp.js');
    floorApp = typeof m.mountFloor === 'function' ? m : stub;
  } catch (e) { console.warn('The restaurant module did not load; showing the plain stand-in.', e); floorApp = stub; }
  return floorApp;
}

/* ---------- mounting and unmounting: at most one scene at a time ---------- */
let floorMe = null, floorPeerList = [];   // where I stand in a restaurant, and who else is there (for the water gun)
const pillSlot = document.createElement('div'); pillSlot.className = 'sh-pillslot';
const ctx = {
  act: (name, args) => act(name, args),
  sendPos: (x, z, r) => { floorMe = { x, z, r }; return netm.sendPos(x, z, r); },
  openDoor: () => openDoorPanel(),
  openMenu: () => openDrawer(),
  goHome: () => goHome(),
  pillSlot, ui: floorUi,
};
function placePill() {
  // The HUD owns where the pill sits: either it took ctx.pillSlot, or it made its own #pillSlot. Failing both, it floats.
  const pill = pillElement(), own = document.getElementById('pillSlot');
  if (own && own !== pillSlot) { if (pill.parentNode !== own) own.append(pill); return; }
  if (pill.parentNode !== pillSlot) pillSlot.append(pill);
  if (!pillSlot.isConnected) { pillSlot.classList.add('float'); floorUi.append(pillSlot); }
}

function flushLabels() { nextFrame(); placeLabels(); }
function unmount() {
  hideOverview(); closeRoles();
  if (state.mounted === 'floor') {
    try { floorApp.unmountFloor(); } catch (e) { console.error(e); }
    hidePill(); pillSlot.remove(); pillSlot.classList.remove('float'); floorUi.replaceChildren();
    G.S = null;
  } else if (state.mounted === 'park') { stopParkInput(); parkm.disposePark(); parkBar(false); setZoom(1); }
  if (state.mounted) { clearSquirt(); clearPeers(); flushLabels(); }
  floorMe = null; floorPeerList = [];
  state.mounted = null; state.floorId = null;
  setView('boot');
}
async function mountFloor(msg) {
  const app = await loadFloorApp();
  state.mounted = 'floor'; state.floorId = msg.floor.id; state.floorMounts++; state.missing = 0;
  setView('floor');
  document.body.dataset.owner = msg.you?.canAct ? '1' : '0';
  setScene('kitchen');
  app.mountFloor(ctx);
  renderPill(msg); placePill();
  app.updateFloor(msg);
  placePill();
  fit(); resize();
}
function mountPark(fromPlot = null) {
  state.mounted = 'park'; state.parkMounts++;
  setView('park');
  setZoom(quality.mobile ? 1.3 : 1.55);   // the park is wide: show a few buildings at once
  parkm.buildPark(net.building?.park || {}, { name: net.welcome?.name, look: net.welcome?.look, role: net.role || 'spectator' });
  parkm.syncBuildings(net.building?.floors || [], net.homeId);
  parkm.arriveAt(fromPlot);
  parkm.onEnter(f => travel({ floorId: f.id }));
  initParkInput({ onSign: id => walkToDoor(id), onUse: f => travel({ floorId: f.id }) });
  parkBar(true);
  fit(); resize();
}
/** Tapping a sign: walk to that door (and through it). A sign far away is a long walk, so that is a teleport. */
function walkToDoor(floorId) {
  const p = parkm.doorOf(floorId);
  if (!p) return travel({ floorId });
  if (Math.hypot(p.x - parkm.me.x, p.z - parkm.me.z) < 0.8) return travel({ floorId });
  parkm.setGoal(p.x, p.z);
}
function showOv() { setView('overview'); showOverview(); }

/* ---------- the park's own bar ---------- */
let bar = null;
function parkBar(show) {
  bar?.remove(); bar = null; squirtButton(false);
  if (!show) return;
  bar = document.createElement('div'); bar.className = 'sh-parkui';
  bar.innerHTML = `<header class="sh-bar">
      <div class="sh-brand">SHIP<span>SHIFT</span></div>
      <div class="sh-seg" role="group" aria-label="View"><button type="button" id="pkOver" aria-pressed="false">Overview</button><button type="button" class="on" aria-pressed="true">Walk the park</button></div>
      <span class="sh-gap"></span>
      <button type="button" class="sh-btn small" id="pkMain"></button>
      <button type="button" class="sh-icon" id="pkMenu" aria-label="All restaurants" title="All restaurants"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 7h14M5 12h14M5 17h14" fill="none" stroke="currentColor" stroke-width="2.800" stroke-linecap="round"/></svg></button>
    </header>
    <p class="sh-hint" id="pkHint"></p>`;
  shell.append(bar);
  bar.append(squirtButton(true));
  bar.querySelector('#pkOver').onclick = () => travel({ overview: true });
  bar.querySelector('#pkMenu').onclick = () => openDrawer();
  bar.querySelector('#pkMain').onclick = () => (net.homeId ? goHome() : toLanding());
  parkBarText();
}
function parkBarText() {
  if (!bar) return;
  bar.querySelector('#pkMain').textContent = net.homeId ? 'Go to my kitchen' : 'Start a kitchen';
  const n = net.building?.floors?.filter(f => Number.isInteger(f.plot)).length || 0;
  bar.querySelector('#pkHint').textContent = n ? (quality.mobile ? 'Tap the ground to walk. Tap a sign to walk in.' : 'Click the ground or use WASD to walk. Walk onto a doormat to go in.') : 'No kitchens are open yet. Buildings appear here as people start one.';
}

function toLanding() {
  if (net.homeId) return goHome();
  unmount(); if (net.subscribed) netm.unsubscribe();
  showLanding();
}

/* ---------- server messages ---------- */
on('floor', msg => {
  if (state.mounted !== 'floor' || msg.floor.id !== state.floorId) { state.staleDrops++; return; }
  state.floorMsgs++;
  document.body.dataset.owner = msg.you?.canAct ? '1' : '0';
  renderPill(msg);
  try { floorApp.updateFloor(msg); } catch (e) { console.error(e); }
  placePill();
});
on('building', b => {
  if (overviewOpen()) renderOverview(b);
  if (state.mounted === 'park') { parkm.syncBuildings(b.floors, net.homeId); parkBarText(); }
  // the restaurant on screen has gone from the town: two summaries in a row without it means it was destroyed
  if (state.mounted === 'floor' && !teleport.busy) {
    state.missing = b.floors.some(f => f.id === state.floorId) ? 0 : state.missing + 1;
    if (state.missing >= 2) closed(state.floorId);
  }
});
on('peers', msg => {
  if (state.mounted === 'park' && msg.zone === 'park') applyPeers(msg, net.welcome?.connId);
  else if (state.mounted === 'floor' && msg.zone === state.floorId) { floorPeerList = (msg.peers || []).filter(p => p.id !== net.welcome?.connId); try { floorApp.floorPeers((msg.peers || []).filter(p => p.id !== net.welcome?.connId)); } catch (e) { console.error(e); } }
});
const HOME_CALLS = { callBack: 'Your kitchen is calling you back.', mealReady: 'Order up in your kitchen!', feedbackReady: 'A customer in your kitchen has feedback.', mustBreak: 'Your kitchen says: time for a break.', burnt: '', stoveWait: '' };
on('notify', msg => {
  const here = state.mounted === 'floor' && msg.floorId === state.floorId;
  if (here) { try { floorApp.floorNotify(msg); } catch (e) { console.error(e); } }
  if (msg.kind === 'budgetSpent' && msg.floorId === net.homeId) { if (here) budgetModal(); else toast('Your live budget is spent.', 'bad', { label: 'Go home', run: () => goHome().then(() => budgetModal()) }); return; }
  if (msg.kind === 'floorClosed') { closed(msg.floorId); return; }
  if (msg.kind === 'liveOff' && msg.floorId === net.homeId) { toast(msg.text || 'Live Chefs are off, so your kitchen runs in Demo.', 'bad'); return; }
  // a player away from home: the call still reaches them, with the way back
  if (!here && msg.floorId && msg.floorId === net.homeId && HOME_CALLS[msg.kind]) {
    toast(msg.text || HOME_CALLS[msg.kind], 'good', { label: 'Go home', run: () => goHome() });
    try { navigator.vibrate?.(120); } catch { /* not supported */ }
  }
});
function closed(floorId) {
  const mine = floorId === net.homeId;
  if (mine) netm.forgetHome();
  if (state.mounted === 'floor' && state.floorId === floorId && !teleport.busy) {
    state.missing = 0;
    travel({ overview: true }).then(() => toast(mine ? 'Your kitchen has closed.' : 'That kitchen has closed.', 'bad'));
  } else if (mine) toast('Your kitchen has closed.', 'bad');
}
on('error', m => { if (m.code === 'rate') toast('Slow down a little.', 'bad'); else if (m.code === 'no_floor' && state.mounted === 'floor' && !teleport.busy) closed(state.floorId); });
on('close', () => { document.body.dataset.net = 'off'; const c = $('landConn'); if (c) c.textContent = 'Reconnecting…'; });
on('open', () => { document.body.dataset.net = 'on'; const c = $('landConn'); if (c) c.textContent = ''; });

/* ---------- layout: how much of each edge the bars cover ---------- */
function fit() {
  const portrait = innerWidth < 720 && innerHeight > innerWidth;
  document.body.dataset.layout = portrait ? 'portrait' : innerHeight < 540 ? 'landscape' : 'desk';
  if (state.mounted === 'park') setLayout({ side: false, pad: { l: 6, r: 6, t: portrait ? 104 : 64, b: 8 } });
}
addEventListener('resize', fit);

/* ---------- the one animation loop ---------- */
const clock = new THREE.Clock();
let sentAt = { x: 0, z: 0 };
function frame() {
  requestAnimationFrame(frame);
  const dt = Math.min(0.1, clock.getDelta()), t = clock.elapsedTime;
  if (document.hidden && !navigator.webdriver) return;
  if (state.mounted === 'park') {
    nextFrame();
    parkm.stepPark(dt, t, parkMove());
    stepSquirt(dt);
    parkm.drawPark(dt);
    adapt();
    if (Math.hypot(parkm.me.x - sentAt.x, parkm.me.z - sentAt.z) > 0.05 && netm.sendPos(parkm.me.x, parkm.me.z, parkm.me.r)) sentAt = { x: parkm.me.x, z: parkm.me.z };
  } else if (state.mounted === 'floor') {
    stepSquirt(dt);
    try { floorApp.floorFrame(dt, t); } catch (e) { if (!frame.said) { frame.said = true; console.error(e); } }
  }
}

/* ---------- boot ---------- */
initRoles({ shell, go: { overview: () => { unmount(); showOv(); }, home: () => goHome(), queueChanged: () => renderOverview() } });
initOverview({ shell, walkIn: id => travel({ floorId: id }), toPark: () => travel({ park: true }), toLanding, goHome, openMenu: openDrawer });
initTeleport({ shell, hooks: { unmount, mountFloor, mountPark, showOverview: showOv, toLanding, where: () => ({ view: state.view, floorId: state.floorId }) } });
initSquirt({
  // never in your own kitchen: only in the park, or in a restaurant you are visiting
  where: () => (state.mounted === 'park' ? 'park' : state.mounted === 'floor' && state.floorId !== net.homeId && !teleport.busy ? 'visit' : 'off'),
  me: () => (state.mounted === 'park' ? parkm.me : state.mounted === 'floor' ? floorMe : null),
  peers: () => (state.mounted === 'park' ? peerList() : floorPeerList),
  sceneOf: () => (state.mounted === 'park' ? parkm.parkScene : state.mounted === 'floor' ? kitchenScene : null),
});
initPill({ shell, becomeVisitor: async () => { const r = await act('leave', {}); if (r.ok || r.code === 'no_floor') netm.forgetHome(); await travel({ overview: true }); } });

let booted = false;
on('welcome', async () => {
  if (booted) return; booted = true;
  // A token the server still knows: straight back into your kitchen. Otherwise, the role picker.
  if (net.homeId) { const ok = await travel({ floorId: net.homeId }, { quiet: true }); if (ok && state.mounted) return; }
  if (state.view === 'boot') showLanding();
});
showLanding();
netm.connect();
resize(); fit();
requestAnimationFrame(frame);

// What the headless checks drive and read.
window.__ship = {
  state, net, netm, teleport, squirt, roles, park: parkm, travel, goHome, openDrawer, openDoorPanel, budgetModal, pillText,
  get pill() { return pillElement().textContent.trim(); },
  get renderer() { return renderer; },
  stubbed: () => floorApp === stub,
};
