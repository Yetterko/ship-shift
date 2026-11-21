// Entry: server state in, frames out. The room lives in game/world.js, the controls in game/input.js, the UI in game/panels.js.
import { $, G, fx, nowS, orderOf, chefName, toast, on, emit, ICON, quiet, modal } from './game/core.js';
import { THREE, V, stage, camera, scene, resize, updateCamera, render, stepParticles, placeLabels, nextFrame, popup, shake, toScreen, adapt, quality } from './game/scene.js';
import { syncWorld, animateWorld, world, player, stations, stationById, local, slotOf, passSlotOf, plates, blocked, chefStations, chefIndex, chefChar, kick, orderPos, hatchSt, shipFx } from './game/world.js';
import { step, walkTo, state as inputState, urgent } from './game/input.js';
import { hud, frame as panelFrame, maybeReport, ui, diffSeen, banner } from './game/panels.js';
import { sfx, ambience, setMuted, isMuted } from './game/audio.js';
import { guide, guideApply, guideFrame, presenter } from './game/guide.js';
import { touch, touchFrame } from './game/touch.js';
import { stick } from './game/input.js';
import { resetWorld } from './game/world.js';
import { resetPanels } from './game/panels.js';
import { attach, route, onFresh } from './game/net.js';
import { initTown, townFrame, townState, ownState, hook as townHook } from './game/town.js';

/* ---------- server state ---------- */
let lastPointT = Infinity;
/** Draws a state of your own kitchen. hush: you are not in the room to hear or see it (the park), so nothing plays or pops. */
function apply(next, hush = false) {
  G.offset = next.now - Date.now();
  const prev = G.S; G.S = next;
  const S = next, focus = quiet();
  if (!prev || hush) lastPointT = S.stats.points.at(-1)?.t ?? 0;
  if (prev && !hush) {
    const oldQ = new Set(prev.questions.map(q => q.id));
    for (const q of S.questions) if (!oldQ.has(q.id)) { if (!focus) sfx('ask'); const ch = chefChar(q.chefId); if (ch) kick(ch, 0.5); }
    for (const o of S.orders) {
      const was = prev.orders.find(x => x.id === o.id); if (!was) continue;
      if (was.state !== 'shipped' && o.state === 'shipped') { sfx('ship'); shipFx(); banner(`Shipped to ${S.mainBranch || 'main'}`, `#${o.id} ${o.title}`, 'ship'); }
      if (['at_pass', 'merging'].includes(was.state) && o.state === 'cooking') {
        if (S.stats.conflicts > prev.stats.conflicts) { sfx('spoil'); shake(0.24); popup('Spoiled: main moved', hatchSt.top, 'bad'); } else sfx('back');
      }
      if (was.state === 'cooking' && o.state === 'stalled') sfx('buzz');
    }
    if (prev.shift.mode === 'focus' && S.shift.mode === 'break') sfx('bell');
    if ((S.stats.streak ?? 1) > (prev.stats.streak ?? 1)) $('mStreak').classList.add('pop'), setTimeout(() => $('mStreak').classList.remove('pop'), 600);
  }
  syncWorld();
  guideApply(prev, next);
  // every point the server awards floats up from where it was earned
  for (const p of S.stats.points) {
    if (p.t <= lastPointT) continue;
    const o = orderOf(p.orderId), at = o && o.state !== 'shipped' ? orderPos(o).clone() : hatchSt.top.clone();
    popup(`${p.n > 0 ? '+' : ''}${p.n} ${p.why}`, at.add(V(0, 0.9, 0)), p.n >= 0 ? 'good' : 'bad');
  }
  lastPointT = Math.max(lastPointT === Infinity ? 0 : lastPointT, S.stats.points.at(-1)?.t ?? 0);
  hud();
  maybeReport();
}
// the end of the round: a fanfare, then one chime as each star lands
on('report', stars => { sfx(stars >= 2 ? 'fanfare' : 'bell'); for (let i = 1; i <= stars; i++) sfx('star', 0.25 + i * 0.22); });

// A shared kitchen closes after sitting idle: the socket closes with 4001 and the API answers 401. Stop retrying and offer a fresh one.
let gone = false;
function kitchenGone() { if (gone) return; gone = true; $('gone').classList.add('open'); $('goneBtn').focus(); }
on('gone', kitchenGone);
$('goneBtn').onclick = () => location.reload();
function connect() {
  if (gone) return;
  const ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`);
  ws.onmessage = e => {
    const m = JSON.parse(e.data);
    if (route(m)) return;                                   // the town's own messages: world, presence, zone, fresh
    if (m.type === 'reset') return location.reload();
    if (m.type !== 'state') return;
    // in a shared town the socket also carries the kitchen you are visiting
    if (m.relation && m.relation !== 'owner') return townState(m);
    if (fresh) { fresh = false; if (G.S === G.own) { resetWorld(); resetPanels(); G.S = null; lastPointT = Infinity; } }
    G.own = m.state;
    if (!ownState(m.state)) apply(m.state);                 // false: you are home, so it is drawn with all its noise
  };
  ws.onopen = () => attach(ws);
  ws.onclose = async e => {
    if (e.code === 4001) return kitchenGone();
    if (e.code === 4002) return location.reload();      // the presenter reset the town
    // a refused upgrade looks like any other drop, so ask the API whether the kitchen is still there
    const status = await fetch('/api/state').then(r => r.status, () => 0);
    if (status === 401) return kitchenGone();
    toast('Lost the kitchen. Reconnecting…', 'bad'); setTimeout(connect, 1500);
  };
}

const showSound = () => { $('soundIcon').innerHTML = isMuted() ? ICON.mute : ICON.sound; $('soundBtn').setAttribute('aria-pressed', String(!isMuted())); };
$('soundBtn').onclick = () => { setMuted(!isMuted()); showSound(); };
on('mute', () => $('soundBtn').click());
showSound();
setInterval(() => { const sh = G.S?.shift; if (sh?.mode === 'focus' && sh.endsAt - nowS() < 30000 && sh.endsAt - nowS() > 0) sfx('tick'); }, 1000);

// A fresh kitchen replaces yours: every order the room knew is gone. The old picture stays until the new state arrives.
let fresh = false;
onFresh(() => { fresh = true; });
initTown({ draw: apply });

/* ---------- frame loop ---------- */
const clock = new THREE.Clock();
function frame() {
  requestAnimationFrame(frame);
  if (document.hidden) { clock.getDelta(); return; }      // nothing is drawn or simulated for a screen nobody can see
  const dt = Math.min(0.1, clock.getDelta()), t = clock.elapsedTime;
  nextFrame();
  if (townFrame(dt, t)) { touchFrame(null); return; }     // in the park the town draws the frame
  const near = step(dt, t);
  if (G.S) { animateWorld(dt, t, near); panelFrame(near); guideFrame(t, near); touchFrame(near); ambience(dt, world); }
  adapt();
  stepParticles(dt);
  updateCamera(dt, player.g.position);
  placeLabels();
  render();
}

/* ---------- test hook: lets the headless check drive the game and measure the picture ---------- */
const s = {};
window.__ship = {
  walkTo: (id, opts) => walkTo(stationById(id), opts), player, stations, local, slotOf, passSlotOf, plates, fx, ui, blocked, urgent, diffSeen, scene, guide, presenter, quality, world, modal,
  get state() { return G.S; }, now: nowS, touch, stick, town: townHook,
  /** Where a station's standing spot, or any point of the room, is on the screen: for tests that tap. */
  screenOfPoint(x, y, z) { const p = toScreen(V(x, y, z), {}); return { x: p.x, y: p.y }; },
  screenAt(x, z) { const p = toScreen(V(x, 0, z), {}); return { x: p.x, y: p.y }; }, get near() { return inputState.near?.id || null; },
  look() {
    const w = stage.clientWidth, xs = [[-6, 3.5], [6, 3.5], [-6, -3.5], [6, -3.5]].map(([x, z]) => toScreen(V(x, 0, z), s).x);
    const j = 0, st = chefStations[j], feet = toScreen(st.stand, s).y, hat = toScreen(V(st.stand.x, 1.97 * 1.3, st.stand.z), s).y;
    const rects = [...document.querySelectorAll('.lbl:not(.hid)')].map(el => el.getBoundingClientRect()).filter(r => r.width > 0);
    let overlaps = 0;
    for (let a = 0; a < rects.length; a++) for (let b = a + 1; b < rects.length; b++) if (rects[a].left < rects[b].right && rects[b].left < rects[a].right && rects[a].top < rects[b].bottom && rects[b].top < rects[a].bottom) overlaps++;
    return { floorFrac: (Math.max(xs[0], xs[1]) - Math.min(xs[0], xs[1])) / w, floorFracBack: (xs[3] - xs[2]) / w, chefPx: Math.abs(feet - hat), labels: rects.length, overlaps };
  },
};

resize();
connect();
requestAnimationFrame(frame);
