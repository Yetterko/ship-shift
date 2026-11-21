// Moving between scenes. Only one is ever loaded: the park, or one restaurant (or the overview, which has no scene).
//
//   travel(target)      doors close (0.6 s) -> unsubscribe -> unmount -> subscribe -> mount -> doors open
//                       target: { floorId } | { park: true } | { overview: true }
//   openDoorPanel()     the restaurant's front door: "Step out to the park" plus every restaurant, and Back
//   openDrawer()        the teleport menu: a side drawer listing every restaurant, plus the park and the overview
//   goHome()            straight back to your own kitchen
//   initTeleport({ shell, hooks })   hooks: unmount(), mountFloor(msg), mountPark(plot), showOverview(), where()
import { esc, toast, reduceMotion } from './core.js';
import { net, act, subscribe, unsubscribe, forgetHome, lineOf, on } from './net.js';

const DOOR_MS = 600;
let host = null, hooks = null, busy = false, drawer = null, panel = null;
export const teleport = { last: null, count: 0, get busy() { return busy; } };

export function initTeleport(o) {
  host = o.shell; hooks = o.hooks;
  on('building', () => { if (drawer) fillDrawer(); if (panel) fillPanel(); });
  addEventListener('keydown', e => { if (e.key === 'Escape') { if (drawer) closeDrawer(); else if (panel) closeDoorPanel(); } });
}

const sleep = ms => new Promise(r => setTimeout(r, ms));
const doors = () => document.getElementById('doors');
async function closeDoors(text) {
  const d = doors(); document.getElementById('doorsSign').textContent = text || '';
  d.classList.add('shut');
  await sleep(reduceMotion ? 120 : DOOR_MS);
}
function openDoors() { doors().classList.remove('shut'); }

const nameOf = t => { if (t.floorId) { const f = lineOf(t.floorId); return f ? `No. ${f.number} · ${f.name}` : 'A restaurant'; } return t.park ? 'The park' : 'The town'; };

export async function travel(target, { quiet = false } = {}) {
  if (busy) return false;
  busy = true;
  const t0 = performance.now(), from = hooks.where();
  try {
    closeDrawer(); closeDoorPanel(true);
    const curtain = !quiet && (from.view === 'floor' || from.view === 'park' || target.floorId || target.park);
    if (curtain) await closeDoors(nameOf(target));
    const fromPlot = from.floorId ? lineOf(from.floorId)?.plot ?? null : null;
    hooks.unmount();
    if (net.subscribed) unsubscribe();
    if (target.floorId) {
      const msg = await subscribe(target.floorId);
      if (!msg) {
        unsubscribe();
        if (target.floorId === net.homeId) forgetHome();
        toast('That kitchen has closed.', 'bad');
        hooks.showOverview();
      } else await hooks.mountFloor(msg);
    } else if (target.park) hooks.mountPark(target.plot ?? fromPlot);
    else hooks.showOverview();
    teleport.last = { ms: Math.round(performance.now() - t0), to: target.floorId || (target.park ? 'park' : 'overview') };
    teleport.count++;
    return true;
  } catch (e) {
    console.error(e); toast('Could not get there. Try again.', 'bad');
    try { hooks.unmount(); unsubscribe(); hooks.showOverview(); } catch { /* the overview is the safe place */ }
    return false;
  } finally { openDoors(); busy = false; }
}
export const goHome = () => (net.homeId ? travel({ floorId: net.homeId }) : Promise.resolve(false));

/* ---------- the list of restaurants, shared by the door panel and the drawer ---------- */
function rows(here) {
  const floors = [...(net.building?.floors || [])].sort((a, b) => a.number - b.number);
  if (!floors.length) return '<p class="sh-none">No kitchens are open yet.</p>';
  return floors.map(f => `<button type="button" class="sh-row${f.id === here ? ' here' : ''}" data-floor="${esc(f.id)}"${f.id === here ? ' aria-current="true"' : ''}>
    <b>${f.number}</b><span class="n">${esc(f.name)}${f.id === net.homeId ? ' <u>Yours</u>' : ''}</span>
    <span class="mode ${f.mode === 'live' ? 'live' : 'demo'}"><i></i>${f.mode === 'live' ? 'LIVE' : 'DEMO'}</span><small>${f.score} pts</small></button>`).join('');
}
function pick(e) {
  const b = e.target.closest('[data-floor]'); if (!b) return false;
  if (b.dataset.floor === hooks.where().floorId) { closeDrawer(); closeDoorPanel(); return true; }
  travel({ floorId: b.dataset.floor }); return true;
}

/* ---------- the front door (the spec's elevator) ---------- */
export function openDoorPanel() {
  if (panel || busy) return;
  closeDrawer();
  panel = document.createElement('div'); panel.className = 'sh-sheet sh-doorp';
  panel.innerHTML = `<div class="sh-card" role="dialog" aria-modal="true" aria-label="The front door">
    <h2>The front door</h2>
    <button type="button" class="sh-btn big" data-do="park">Step out to the park</button>
    <h3>Or walk straight into</h3>
    <div class="sh-rows" id="dpRows"></div>
    <button type="button" class="sh-btn ghost" data-do="back">Back</button></div>`;
  host.append(panel);
  panel.querySelector('[data-do="park"]').onclick = () => travel({ park: true });
  panel.querySelector('[data-do="back"]').onclick = () => closeDoorPanel();
  panel.addEventListener('click', e => { if (e.target === panel) closeDoorPanel(); else pick(e); });
  fillPanel();
  panel.querySelector('[data-do="park"]').focus({ preventScroll: true });
}
function fillPanel() { const r = panel?.querySelector('#dpRows'); if (r) r.innerHTML = rows(hooks.where().floorId); }
export function closeDoorPanel() { panel?.remove(); panel = null; }
export const doorPanelOpen = () => !!panel;

/* ---------- the teleport drawer ---------- */
export function openDrawer() {
  if (drawer || busy) return;
  closeDoorPanel();
  drawer = document.createElement('div'); drawer.className = 'sh-drawer open';
  drawer.innerHTML = `<aside role="dialog" aria-modal="true" aria-label="All restaurants">
    <header><h2>Restaurants</h2><button type="button" class="sh-icon" data-do="close" aria-label="Close">✕</button></header>
    <div class="sh-places" id="drPlaces"></div>
    <div class="sh-rows" id="drRows"></div>
    <footer id="drFoot"></footer></aside>`;
  host.append(drawer);
  drawer.addEventListener('click', e => {
    if (e.target === drawer) return closeDrawer();
    const d = e.target.closest('[data-do]')?.dataset.do;
    if (d === 'close') closeDrawer();
    else if (d === 'home') goHome();
    else if (d === 'park') travel({ park: true });
    else if (d === 'overview') travel({ overview: true });
    else if (d === 'role') { closeDrawer(); hooks.toLanding(); }
    else if (d === 'closeup') closeUp();
    else if (d === 'leave') leave(e.target.closest('[data-do]'));
    else pick(e);
  });
  fillDrawer();
  drawer.querySelector('[data-do="close"]').focus({ preventScroll: true });
}
function fillDrawer() {
  if (!drawer) return;
  const w = hooks.where(), atHome = w.view === 'floor' && w.floorId === net.homeId;
  drawer.querySelector('#drPlaces').innerHTML = `
    ${net.homeId && !atHome ? '<button type="button" class="sh-btn big" data-do="home">Go home to my kitchen</button>' : ''}
    <button type="button" class="sh-place${w.view === 'park' ? ' here' : ''}" data-do="park">The park</button>
    <button type="button" class="sh-place${w.view === 'overview' ? ' here' : ''}" data-do="overview">Town overview</button>`;
  drawer.querySelector('#drRows').innerHTML = rows(w.floorId);
  const foot = drawer.querySelector('#drFoot');
  if (foot.dataset.k !== `${atHome}${!!net.homeId}`) {
    foot.dataset.k = `${atHome}${!!net.homeId}`;
    foot.innerHTML = atHome ? '<button type="button" class="sh-btn" data-do="closeup">Close up for today</button><button type="button" class="sh-btn danger" data-do="leave">Leave my kitchen</button>'
      : net.homeId ? '' : '<button type="button" class="sh-btn" data-do="role">Start a kitchen</button>';
  }
}
export function closeDrawer() { drawer?.remove(); drawer = null; }
export const drawerOpen = () => !!drawer;

async function closeUp() {
  closeDrawer();
  const r = await act('closeShift', {});
  if (!r.ok) toast(r.message || 'Could not close up.', 'bad');
}
async function leave(btn) {
  if (btn.dataset.sure !== '1') { btn.dataset.sure = '1'; btn.textContent = 'Tap again: this closes your kitchen'; return; }
  const r = await act('leave', {});
  if (!r.ok && r.code !== 'no_floor') { toast(r.message || 'Could not leave.', 'bad'); return; }
  forgetHome();
  await travel({ overview: true });
  toast('Your kitchen is closed. Thanks for the shift.', 'good');
}
