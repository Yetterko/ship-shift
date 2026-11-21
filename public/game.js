// Entry: server state in, frames out. The room lives in game/world.js, the controls in game/input.js, the UI in game/panels.js.
import { $, G, fx, nowS, orderOf, chefName, toast, on, ICON } from './game/core.js';
import { THREE, V, stage, camera, scene, resize, updateCamera, render, stepParticles, placeLabels, nextFrame, popup, shake, toScreen } from './game/scene.js';
import { syncWorld, animateWorld, world, player, stations, stationById, local, slotOf, passSlotOf, plates, blocked, chefStations, chefIndex, chefChar, kick, orderPos, hatchSt, shipFx } from './game/world.js';
import { step, walkTo, state as inputState, urgent } from './game/input.js';
import { hud, frame as panelFrame, maybeReport, ui, diffSeen } from './game/panels.js';
import { sfx, ambience, setMuted, isMuted } from './game/audio.js';

/* ---------- server state ---------- */
let lastPointT = Infinity;
function apply(next) {
  G.offset = next.now - Date.now();
  const prev = G.S; G.S = next;
  const S = next, focus = S.shift.mode === 'focus';
  if (!prev) lastPointT = S.stats.points.at(-1)?.t ?? 0;
  if (prev) {
    const oldQ = new Set(prev.questions.map(q => q.id));
    for (const q of S.questions) if (!oldQ.has(q.id)) { if (!focus) sfx('ask'); const ch = chefChar(q.chefId); if (ch) kick(ch, 0.5); }
    for (const o of S.orders) {
      const was = prev.orders.find(x => x.id === o.id); if (!was) continue;
      if (was.state !== 'shipped' && o.state === 'shipped') { sfx('ship'); shipFx(); }
      if (['at_pass', 'merging'].includes(was.state) && o.state === 'cooking') {
        if (S.stats.conflicts > prev.stats.conflicts) { sfx('spoil'); shake(0.24); popup('Spoiled: main moved', hatchSt.top, 'bad'); } else sfx('back');
      }
      if (was.state === 'cooking' && o.state === 'stalled') sfx('buzz');
    }
    if (prev.shift.mode === 'focus' && S.shift.mode === 'break') sfx('bell');
    if ((S.stats.streak ?? 1) > (prev.stats.streak ?? 1)) $('mStreak').classList.add('pop'), setTimeout(() => $('mStreak').classList.remove('pop'), 600);
  }
  syncWorld();
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
on('report', stars => sfx(stars >= 3 ? 'star' : 'bell'));

function connect() {
  const ws = new WebSocket(`ws://${location.host}/ws`);
  ws.onmessage = e => { const m = JSON.parse(e.data); if (m.type === 'state') apply(m.state); };
  ws.onclose = () => { toast('Lost the kitchen. Reconnecting…', 'bad'); setTimeout(connect, 1500); };
}

$('soundBtn').onclick = () => { setMuted(!isMuted()); $('soundBtn').innerHTML = isMuted() ? ICON.mute : ICON.sound; $('soundBtn').setAttribute('aria-pressed', String(!isMuted())); };
setInterval(() => { const sh = G.S?.shift; if (sh?.mode === 'focus' && sh.endsAt - nowS() < 30000 && sh.endsAt - nowS() > 0) sfx('tick'); }, 1000);

/* ---------- frame loop ---------- */
const clock = new THREE.Clock();
function frame() {
  const dt = Math.min(0.1, clock.getDelta()), t = clock.elapsedTime;
  nextFrame();
  const near = step(dt, t);
  if (G.S) { animateWorld(dt, t, near); panelFrame(near); ambience(dt, world); }
  stepParticles(dt);
  updateCamera(dt, player.g.position);
  placeLabels();
  render();
  requestAnimationFrame(frame);
}

/* ---------- test hook: lets the headless check drive the game and measure the picture ---------- */
const s = {};
window.__ship = {
  walkTo: (id, opts) => walkTo(stationById(id), opts), player, stations, local, slotOf, passSlotOf, plates, fx, ui, blocked, urgent, diffSeen, scene,
  get state() { return G.S; }, get near() { return inputState.near?.id || null; },
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
