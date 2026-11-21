// Entry: server state in, frames out. The floor lives in game/world.js, the controls in game/input.js, the panels in game/panels.js.
import { $, G, fx, nowS, toast, on, ICON, watching, customerById } from './game/core.js';
import { THREE, V, stage, resize, updateCamera, render, stepParticles, placeLabels, nextFrame, popup, toScreen } from './game/scene.js';
import { syncWorld, animateWorld, world, player, targets, blocked, customerPos, billFx, chefChar, kick } from './game/world.js';
import { step, go, state as inputState } from './game/input.js';
import { hud, renderPanel, ui, diffSeen, notifyBell, panelIsOpen } from './game/panels.js';
import { sfx, ambience, setMuted, isMuted } from './game/audio.js';

/* ---------- server state ---------- */
let lastPointT = Infinity, lastBell = null, titleT = null;
const baseTitle = document.title;
function apply(next) {
  G.offset = next.now - Date.now();
  const prev = G.S; G.S = next;
  const S = next;
  if (!prev) { lastPointT = S.stats.points.at(-1)?.t ?? 0; lastBell = S.shift.bellAt; }
  if (prev) {
    for (const c of S.customers) {
      const was = prev.customers.find(x => x.id === c.id); if (!was) continue;
      if (was.state !== 'feedback_ready' && c.state === 'feedback_ready') { sfx('ask'); }
      if (was.state !== 'paid' && c.state === 'paid') { sfx('ship'); billFx(c.id); }
      if (was.state !== 'walked_out' && c.state === 'walked_out') { sfx('no'); toast(`${c.persona.name} got tired of waiting and walked out`, 'bad'); }
    }
    for (const it of S.items) {
      const was = prev.items.find(x => x.id === it.id);
      if (was && was.state !== 'stalled' && it.state === 'stalled') sfx('buzz');
    }
    const oldQ = new Set(prev.questions.map(q => q.id));
    for (const q of S.questions) if (!oldQ.has(q.id)) { sfx('ask'); const ch = chefChar(q.chefId); if (ch) kick(ch, 0.5); }
    if ((S.stats.streak ?? 1) > (prev.stats.streak ?? 1)) { $('mStreak').classList.add('pop'); setTimeout(() => $('mStreak').classList.remove('pop'), 600); }
    if (prev.shift.phase !== 'closed' && S.shift.phase === 'closed') sfx('bell');
  }
  // the bell: sound, a flash, a buzz on phones that can, a blinking tab title, and a system notification when hidden
  if (S.shift.bellAt && S.shift.bellAt !== lastBell) {
    lastBell = S.shift.bellAt;
    if (!watching()) {
      sfx('bell'); setTimeout(() => sfx('bell'), 700);
      document.body.classList.add('flash'); setTimeout(() => document.body.classList.remove('flash'), 1400);
      try { navigator.vibrate?.([220, 120, 220]); } catch { /* not here */ }
      const n = S.counter.length + S.customers.filter(c => c.state === 'feedback_ready').length;
      notifyBell(`${n || 'Something'} thing${n === 1 ? '' : 's'} need${n === 1 ? 's' : ''} you at the pass.`);
      clearInterval(titleT);
      let on = false;
      titleT = setInterval(() => { on = !on; document.title = on ? `🔔 Order up (${n})` : baseTitle; if (G.S.shift.phase !== 'bell') { clearInterval(titleT); document.title = baseTitle; } }, 900);
    }
  }
  syncWorld();
  for (const p of S.stats.points) {
    if (p.t <= lastPointT) continue;
    const at = p.at?.kind === 'customer' ? customerPos(p.at.id) : player.g.position.clone().add(V(0, 2, 0));
    popup(`${p.n > 0 ? '+' : ''}${p.n} ${p.why}`, at, p.n >= 0 ? 'good' : 'bad');
  }
  lastPointT = Math.max(lastPointT === Infinity ? 0 : lastPointT, S.stats.points.at(-1)?.t ?? 0);
  hud();
  renderPanel();
}
on('report', stars => sfx(stars >= 3 ? 'star' : 'bell'));

function connect() {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  const ws = new WebSocket(`${proto}://${location.host}/ws${watching() ? '?watch=1' : ''}`);
  ws.onmessage = e => { const m = JSON.parse(e.data); if (m.type === 'state') apply(m.state); };
  ws.onclose = ev => {
    if (ev.code === 4001) { toast('This restaurant closed. Reloading a fresh one…', 'bad'); setTimeout(() => location.reload(), 1800); return; }
    toast('Lost the restaurant. Reconnecting…', 'bad'); setTimeout(connect, 1500);
  };
}

$('soundBtn').onclick = () => { setMuted(!isMuted()); $('soundBtn').innerHTML = isMuted() ? ICON.mute : ICON.sound; $('soundBtn').setAttribute('aria-pressed', String(!isMuted())); };
setInterval(() => { const sh = G.S?.shift; if (sh?.phase === 'service' && sh.endsAt - nowS() < 20000 && sh.endsAt - nowS() > 0) sfx('tick'); }, 1000);
if (watching()) document.body.classList.add('watching');

/* ---------- frame loop ---------- */
const clock = new THREE.Clock();
function frame() {
  const dt = Math.min(0.1, clock.getDelta()), t = clock.elapsedTime;
  nextFrame();
  const near = step(dt, t);
  if (G.S) { animateWorld(dt, t, near); ambience(dt, { cooking: world.cooking, fires: 0 }); }
  stepParticles(dt);
  updateCamera(dt, player.g.position);
  placeLabels();
  render();
  requestAnimationFrame(frame);
}

/* ---------- test hook: lets the headless check drive the game ---------- */
const s = {};
window.__ship = {
  go, player, targets, fx, ui, blocked, diffSeen, panelIsOpen,
  get state() { return G.S; }, get near() { return inputState.near?.id || null; },
  look() {
    const w = stage.clientWidth, xs = [[-6, 3.5], [6, 3.5]].map(([x, z]) => toScreen(V(x, 0, z), s).x);
    const rects = [...document.querySelectorAll('.lbl:not(.hid)')].map(el => el.getBoundingClientRect()).filter(r => r.width > 0);
    let overlaps = 0;
    for (let a = 0; a < rects.length; a++) for (let b = a + 1; b < rects.length; b++) if (rects[a].left < rects[b].right && rects[b].left < rects[a].right && rects[a].top < rects[b].bottom && rects[b].top < rects[a].bottom) overlaps++;
    return { floorFrac: (xs[1] - xs[0]) / w, labels: rects.length, overlaps };
  },
};

resize();
connect();
requestAnimationFrame(frame);
