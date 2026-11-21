// The restaurant floor, as the shell mounts it (docs/REBUILD.md 3.3): the 3D room (floor.js), its HTML (panels, HUD,
// walkthrough, break screen, TV) and its controls. The shell owns the socket, the one animation loop and the doors.
import { G, emit, on, reduceMotion } from './core.js';
import { nextFrame, placeLabels, render, updateCamera, stepParticles, adapt, memory, confetti, V, setDock, resize } from './scene.js';
import { F, buildFloor, syncFloor, animateFloor, disposeFloor, syncPeers, placeWaiter, doorSpot, shipFx, probe, patienceLeft } from './floor.js';
import { initInput, disposeInput, inputFrame, urgent, tap, input, pick } from './floorinput.js';
import { initPanels, disposePanels, refreshPanel, openPanel, closePanel, panelKey, panelStats } from './panels.js';
import { initHud, disposeHud, renderHud, tickHud, hudBottom } from './hud.js';
import { initGuide, disposeGuide, guideApply, guide, presenter } from './guide.js';
import { initBreak, disposeBreak, showBreak, takeBreak } from './breakscreen.js';
import { handleNotify, notifyFromSnapshot, disposeNotify, shipBanner } from './notify.js';
import { syncTv, disposeTv } from './tv.js';
import { initTouch, disposeTouch, layout, touch } from './touch.js';
import { ambience } from './audio.js';

const A = { ui: null, root: null, offs: [], prev: null, shipped: new Set(), mounted: false, mounts: 0, reported: false };

export function mountFloor(ctx) {
  if (A.mounted) unmountFloor();
  A.mounted = true; A.mounts++;
  F.ctx = ctx;
  const ui = document.createElement('div'); ui.className = 'fl-ui'; ui.id = 'flUi';
  (ctx.ui || document.getElementById('floorUi') || document.body).append(ui);
  A.ui = ui;
  buildFloor();
  initHud(ui, ctx); initGuide(ui); initPanels(ui); initBreak(ui);
  // on a phone the camera shows part of the floor: one button goes to the most urgent thing, wherever it is (Tab on a laptop)
  const next = document.createElement('button'); next.type = 'button'; next.className = 'fl-next'; next.id = 'flNext'; next.hidden = true;
  next.innerHTML = '<span>Next</span><b>›</b>'; next.onclick = () => { const u = urgent(); if (u) tap(u); };
  ui.append(next); A.next = next;
  initInput(); initTouch(); resize();
  A.offs = [
    on('help', () => openPanel('help')),
    on('takeBreak', () => takeBreak()),
    on('presenter', () => presenter()),
    on('layout', () => layout()),
    on('mustBreak', () => showBreak()),
    on('tapTarget', k => tap(k)),
  ];
  A.prev = null; A.shipped.clear(); A.reported = false;
  document.body.classList.add('fl-mounted');
  window.__floor = api;
}

export function updateFloor(msg) {
  if (!A.mounted || !msg?.floor) return;
  const prev = A.prev, S = msg.floor;
  const firstSnap = !prev;
  syncFloor(msg);
  G.S = S; G.offset = F.offset;
  if (firstSnap) {
    // a visitor arrives at the front door; the owner starts by the Pass
    if (!F.you.canAct) placeWaiter(doorSpot(), -Math.PI / 2); else placeWaiter(V(0.2, 0, 0.3), Math.PI);
    document.body.dataset.owner = F.you.canAct ? '1' : '0';
    for (const c of S.tables) if (c?.status === 'paying') A.shipped.add(c.id);
  }
  // shipped: a Customer has just paid
  for (const c of S.tables) {
    if (c?.status === 'paying' && !A.shipped.has(c.id)) {
      A.shipped.add(c.id);
      shipFx(c.table ?? S.tables.indexOf(c)); shipBanner(`#${c.order.number} ${c.order.title}`); emit('sfx', 'ship');
      if (!panelKey() && F.you.canAct) openPanel(`table:${S.tables.indexOf(c)}`);
    }
  }
  F.urgent = urgent(S);
  renderHud(S); guideApply(S); showBreak(S); syncTv(S);
  if (A.next) {
    // Next goes where the walkthrough does not already point; above the walkthrough's bar when both show
    const gShown = guide.el && !guide.el.hidden;
    A.next.hidden = !F.urgent || (gShown && F.guideTarget === F.urgent);
    A.next.style.bottom = gShown ? `${guide.el.offsetHeight + 18}px` : '';
    A.next.querySelector('span').textContent = nextWord(F.urgent);
  }
  notifyFromSnapshot(prev, S);
  refreshPanel();
  if (S.shift.status === 'ended' && S.shift.report && !A.reported) { A.reported = true; openPanel('report'); }
  if (S.shift.status === 'running') A.reported = false;
  A.prev = S;
  if (firstSnap) layout();
}
export function floorNotify(msg) { if (A.mounted) handleNotify(msg); }
export function floorPeers(list) { if (A.mounted) syncPeers(list, null); }

export function floorFrame(dt, t) {
  if (!A.mounted) return;
  nextFrame();
  F.simT = (F.simT || 0) + dt;
  // the HUD can grow a row (the pill arrives, a break button shows): the camera keeps the room clear of it
  if ((A.frameN = (A.frameN || 0) + 1) % 20 === 0) { const hb = hudBottom(); if (hb !== A.hudB) { A.hudB = hb; layout(); } }
  inputFrame(dt);
  animateFloor(dt, t);
  tickHud();
  if (F.snap && (F.snap.phase !== 'working' || F.snap.mustBreak)) showBreak();
  stepParticles(dt);
  updateCamera(dt, F.waiter ? F.waiter.g.position : V());
  render();
  placeLabels();
  adapt();
  const S = F.snap;
  if (S) ambience(dt, { cooking: S.phase === 'break' ? 0 : F.cooking, fires: 0, smoking: Object.values(S.items).filter(i => i.status === 'burnt').length });
}

export function unmountFloor() {
  if (!A.mounted) return;
  A.mounted = false;
  for (const f of A.offs) f(); A.offs = [];
  disposeInput(); disposeTouch(); disposeTv(); disposeNotify();
  disposePanels(); disposeBreak(); disposeGuide(); disposeHud();
  disposeFloor();
  setDock(0, 0);
  A.ui?.remove(); A.ui = null; A.prev = null;
  document.body.classList.remove('fl-mounted', 'fl-panel-open', 'fl-onbreak');
  F.ctx = null;
  if (window.__floor === api) window.__floor = null;
}

const nextWord = k => !k ? '' : k.startsWith('meal:') ? 'Sample a Meal' : k.startsWith('customer:') ? 'Seat next' : k.startsWith('table:') ? `Table ${+k.slice(6) + 1}` : 'Next';

/* ---------- what the headless checks read ---------- */
const api = {
  F, probe, memory, tap, urgent, input, touch, guide, panelStats,
  panel: () => panelKey(), open: openPanel, close: closePanel,
  mounted: () => A.mounted, mounts: () => A.mounts,
  /** Where a target is on the screen, for a real click or tap on it. */
  screenOf(key) {
    const t = F.targets.get(key); if (!t) return null;
    const st = document.getElementById('stage').getBoundingClientRect();
    const at = v => { const p = v.clone().project(cameraRef()); return { x: st.left + (p.x + 1) / 2 * st.width, y: st.top + (1 - p.y) / 2 * st.height }; };
    const c = at(t.type === 'customer' || t.type === 'chef' ? t.pos.clone().add(V(0, 1, 0)) : t.pos);
    // the point on screen where a tap really lands on this thing (something in front of it may cover its centre)
    const want = key === 'pass' ? k => k === 'pass' || k.startsWith('meal:') : k => k === key;
    const inView = q => q.x > 4 && q.x < innerWidth - 4 && q.y > 4 && q.y < innerHeight - 4 && document.elementFromPoint(q.x, q.y)?.tagName === 'CANVAS';
    for (let r = 0; r <= 140; r += 7) for (let a = 0; a < (r ? 16 : 1); a++) {
      const q = { x: c.x + Math.cos(a * Math.PI / 8) * r, y: c.y + Math.sin(a * Math.PI / 8) * r };
      if (inView(q) && want(pick(q.x, q.y)?.key || '')) return { ...q, hit: true };
    }
    return { ...c, hit: false };
  },
  targets: () => [...F.targets.keys()],
  patience: p => patienceLeft(p),
  confetti: () => confetti(V(0, 1, 0)),
  reduceMotion,
};
import { camera } from './scene.js';
const cameraRef = () => camera;
