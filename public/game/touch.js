// Phones and tablets: taps with generous aim, a thumb stick, thumb buttons, and the two small-screen layouts.
// Nothing here changes what the game does. Every button presses the same key a keyboard would, and a tap ends
// in the same walkTo() a click does. The look lives in touch.css; a desktop page with a mouse only gets the hint clicks.
import { $, G, ICON, toast, clamp } from './core.js';
import { THREE, V, stage, scene, camera, renderer, toScreen, resize, setFrame, device, quality, TALL, WIDE } from './scene.js';
import { player, stations, chefStations, slotOf, stationById, stationState } from './world.js';
import { walkTo, walkPoint, stick, urgent, state as inputState } from './input.js';

const canvas = renderer.domElement, body = document.body, root = document.documentElement;
const hudEl = document.querySelector('.hud'), cardEl = $('card');
const modal = () => !!document.querySelector('dialog[open], .overlay.open');
const typingIn = () => { const a = document.activeElement; return a && /INPUT|TEXTAREA|SELECT/.test(a.tagName) ? a : null; };

/* ======================= every button is a key ======================= */
const CODE = { E: 'KeyE', Q: 'KeyQ', F: 'KeyF', R: 'KeyR', X: 'KeyX', T: 'KeyT', J: 'KeyJ', K: 'KeyK', B: 'KeyB', Tab: 'Tab', Shift: 'ShiftLeft', Enter: 'Enter', Esc: 'Escape' };
/** Presses a key by the name on its cap. The game hears it exactly as it hears a keyboard. */
export function press(name) {
  const code = CODE[name]; if (!code) return false;
  typingIn()?.blur();
  dispatchEvent(new KeyboardEvent('keydown', { code, key: name.length === 1 ? name.toLowerCase() : name, bubbles: true, cancelable: true }));
  return true;
}
const keyOf = k => k.querySelector('kbd')?.textContent.trim() || '';
document.addEventListener('click', e => {
  const b = e.target.closest?.('[data-press]');
  if (b) { e.preventDefault(); if (b.getAttribute('aria-disabled') === 'true' && b.dataset.why) toast(b.dataset.why); else press(b.dataset.press); return; }
  // a key hint is a button too: tap "X your call" and X is pressed. Hints that already carry data-k press themselves.
  const k = e.target.closest?.('.k');
  if (k && !k.dataset.k && !modal() && press(keyOf(k))) e.preventDefault();
});
// what a meter means is in its tooltip, and a finger has no hover: a tap says it
hudEl.addEventListener('click', e => { const m = e.target.closest('.m[title], .score[title]'); if (m && body.classList.contains('touch')) toast(m.title); });

/* ======================= the top strip's menu ======================= */
const DOTS = '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="5" cy="12" r="2.2" fill="currentColor"/><circle cx="12" cy="12" r="2.2" fill="currentColor"/><circle cx="19" cy="12" r="2.2" fill="currentColor"/></svg>';
const more = Object.assign(document.createElement('button'), { className: 'rb more', id: 'moreBtn', type: 'button', title: 'Menu', innerHTML: DOTS });
more.setAttribute('aria-label', 'Menu'); more.setAttribute('aria-expanded', 'false');
hudEl.querySelector('.tools').before(more);
function menu(open) { hudEl.classList.toggle('open', open); more.setAttribute('aria-expanded', String(open)); }
more.onclick = e => { e.stopPropagation(); $('shiftPop').hidden = true; menu(!hudEl.classList.contains('open')); };
document.addEventListener('click', e => { if (!e.target.closest?.('#moreBtn')) menu(false); });
$('clockBtn').addEventListener('click', () => menu(false));

/* ======================= thumb controls ======================= */
const ICONS = {
  put: ICON.install,
  call: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 10v4h3l7 4.500v-13L7 10z" fill="currentColor"/><path d="M17.500 8.500a5 5 0 0 1 0 7M8 14.500V19h2.500" fill="none" stroke="currentColor" stroke-width="2.400" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  next: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3.500l9.500 16.500h-19z" fill="none" stroke="currentColor" stroke-width="2.600" stroke-linejoin="round"/><path d="M12 10v4.500" stroke="currentColor" stroke-width="2.800" stroke-linecap="round"/><circle cx="12" cy="17.300" r="1.500" fill="currentColor"/></svg>',
};
const pad = document.createElement('div');
pad.className = 'pad'; pad.id = 'pad';
pad.innerHTML = `<div class="stick" id="stick" aria-hidden="true"><i></i></div>
<div class="thumbs" role="group" aria-label="Actions">
  <button class="tb next" id="tbNext" type="button" data-press="Tab" aria-label="Next urgent">${ICONS.next}<span>Urgent</span></button>
  <button class="tb call" id="tbCall" type="button" data-press="F" aria-label="Call out" data-why="Stand at a cooking chef to call out">${ICONS.call}<span>Call out</span></button>
  <button class="tb put" id="tbPut" type="button" data-press="Q" aria-label="Put down" data-why="Your hands are empty">${ICONS.put}<span>Put down</span></button>
  <button class="tb act" id="tbAct" type="button" data-press="E" aria-label="Act"><b id="tbActWord">Act</b></button>
</div>`;
const float = Object.assign(document.createElement('div'), { className: 'stick float', innerHTML: '<i></i>' });
float.setAttribute('aria-hidden', 'true');
stage.append(pad, float);
const fixed = $('stick');

// review by thumb: previous and next hunk, and a Send button for the one-line input
const nav = document.createElement('span');
nav.className = 'hunknav';
nav.innerHTML = '<button class="btn ghost" type="button" data-press="K" aria-label="Previous hunk">&#9664; Prev</button><button class="btn ghost" type="button" data-press="J" aria-label="Next hunk">Next &#9654;</button>';
document.querySelector('.review-foot .hints').prepend(nav);
$('lineForm').append(Object.assign(document.createElement('button'), { className: 'btn send', type: 'submit', textContent: 'Send' }));

/** What the big button says: the verb of whatever E would do here. */
const VERBS = [[/^take/, 'Take'], [/^give/, 'Give'], [/^shake/, 'Shake'], [/^resume/, 'Resume'], [/^stop tasting/, 'Done'], [/^taste/, 'Taste'], [/^pick/, 'Pick up'], [/^prep/, 'Prep'], [/^put/, 'Put back'], [/^flip/, 'Flip'], [/^carry/, 'Carry'], [/^review/, 'Review'], [/^ship/, 'Ship'], [/^bin/, 'Bin'], [/^press again/, 'Sure?']];
const hintText = k => [...k.childNodes].filter(n => n.nodeType === 3).map(n => n.textContent).join('').trim();
function readCard() {
  let act = '', call = false;
  for (const k of cardEl.querySelectorAll('.k')) {
    const key = k.dataset.k || keyOf(k);
    k.classList.toggle('dead', !CODE[key]); k.dataset.cap = key;
    if (key === 'E') act = hintText(k);
    if (key === 'F') call = true;
  }
  const word = VERBS.find(([re]) => re.test(act))?.[1] || '';
  $('tbActWord').textContent = word || 'Act';
  $('tbAct').classList.toggle('ready', !!word);
  $('tbAct').setAttribute('aria-label', act ? `Act: ${act}` : 'Act');
  $('tbCall').setAttribute('aria-disabled', String(!call));
}
new MutationObserver(readCard).observe($('cardBody'), { childList: true, subtree: true });
let lastNear = null, lineOpen = false;
function tick() {
  // a card that was scrolled for one station starts at its top for the next, and again once its input line closes
  const near = inputState.near?.id || null, line = !$('lineForm').hidden;
  if (near !== lastNear || line !== lineOpen) { lastNear = near; lineOpen = line; if (!line) cardEl.scrollTop = 0; }
  $('tbPut').setAttribute('aria-disabled', String(!player.carry));
  const why = G.S ? urgent()?.why : null;
  $('tbNext').classList.toggle('hot', why === 'blocked' || why === 'stalled');
  // upright, a chef's question is laid out under the room and takes the thumbs' place while it is open
  body.classList.toggle('asking', !!document.querySelector('.lbl .bub'));
  layout();
}

/* ======================= the stick: fixed where there is room for one, and anywhere you drag ======================= */
const REACH = 44, SLOP = 12;
const fingers = new Map();   // pointerId -> { x0, y0, mode: 'wait' | 'stick', el, onCanvas }
let steering = null;
function steer(f, x, y) {
  let dx = (x - f.x0) / REACH, dy = (y - f.y0) / REACH;
  const l = Math.hypot(dx, dy);
  if (l > 1) { dx /= l; dy /= l; }
  const dead = l < 0.18;
  stick.x = dead ? 0 : dx; stick.z = dead ? 0 : dy;
  f.el.firstElementChild.style.transform = `translate(${dx * REACH * 0.62}px,${dy * REACH * 0.62}px)`;
  if (!dead) { player.path = null; player.targetSt = null; }
}
function release(f) {
  stick.x = stick.z = 0; steering = null;
  f.el.firstElementChild.style.transform = ''; f.el.classList.remove('on');
}
// Capture phase, ahead of the mouse handler on the canvas: a mouse acts on press, a finger waits to see whether this is a tap or a drag.
stage.addEventListener('pointerdown', e => {
  if (e.pointerType === 'mouse') return;
  enableTouch();
  // a sign in the room is part of the room: a finger on one is a finger on the kitchen, and tapWorld() works out which
  const onStick = !!e.target.closest?.('#stick'), onCanvas = e.target === canvas || !!e.target.closest?.('.lbl.click');
  if (!onStick && !onCanvas) return;
  e.stopPropagation();
  if (modal()) return;
  const f = { x0: e.clientX, y0: e.clientY, mode: 'wait', el: float, onCanvas };
  if (onStick && !steering) {
    const r = fixed.getBoundingClientRect();
    Object.assign(f, { x0: r.left + r.width / 2, y0: r.top + r.height / 2, mode: 'stick', el: fixed });
    steering = e.pointerId; fixed.classList.add('on'); steer(f, e.clientX, e.clientY);
  }
  fingers.set(e.pointerId, f);
}, true);
addEventListener('pointermove', e => {
  const f = fingers.get(e.pointerId); if (!f) return;
  if (f.mode === 'wait' && !steering && Math.hypot(e.clientX - f.x0, e.clientY - f.y0) > SLOP) {
    f.mode = 'stick'; steering = e.pointerId;
    const r = stage.getBoundingClientRect();
    float.style.left = `${f.x0 - r.left}px`; float.style.top = `${f.y0 - r.top}px`; float.classList.add('on');
  }
  if (f.mode === 'stick') steer(f, e.clientX, e.clientY);
});
function lift(e, tapped) {
  const f = fingers.get(e.pointerId); if (!f) return;
  fingers.delete(e.pointerId);
  if (f.mode === 'stick') return release(f);
  if (tapped && f.onCanvas && Math.hypot(e.clientX - f.x0, e.clientY - f.y0) <= SLOP) tapWorld(e.clientX, e.clientY);
}
addEventListener('pointerup', e => {
  // sound may only start inside a gesture, and for a finger that is the lift, not the press
  if (e.pointerType !== 'mouse') dispatchEvent(new PointerEvent('pointerdown', { pointerType: e.pointerType, clientX: e.clientX, clientY: e.clientY }));
  lift(e, true);
});
addEventListener('pointercancel', e => lift(e, false));
// the tap on a sign has been answered by tapWorld(); the click that follows it must not walk a second time
let lastTouch = 0;
addEventListener('pointerup', e => { if (e.pointerType !== 'mouse') lastTouch = performance.now(); }, true);
$('labels').addEventListener('click', e => { if (e.target.closest('.lbl.click') && (e.pointerType === 'touch' || e.pointerType === 'pen' || performance.now() - lastTouch < 500)) e.stopPropagation(); }, true);
addEventListener('blur', () => { for (const f of fingers.values()) if (f.mode === 'stick') release(f); fingers.clear(); });

/* ======================= a tap: the thing you meant, not the pixel you hit ======================= */
const ray = new THREE.Raycaster(), ndc = new THREE.Vector2(), ground = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), at = V(), sp = {};
const aims = new Map();
/** The points a finger aims at for a station: the thing on the counter, and whoever stands at it. */
function aimsOf(st) {
  if (!aims.has(st)) {
    const pts = [st.top];
    if (st.type === 'chef') pts.push(V(st.stand.x, 1.1, st.stand.z), V(st.stand.x, 2.1, st.stand.z));
    if (st.type === 'slot') pts.push(V(st.stand.x, 1.0, st.stand.z));
    if (st.type === 'hatch') pts.push(st.out);
    if (st.type === 'oven') pts.push(st.mouth);
    aims.set(st, pts);
  }
  return aims.get(st);
}
/** An empty window spot or an empty place on the pass is not something anyone aims for. */
const live = st => !G.S || !(st.type === 'slot' || st.type === 'pass') || !!stationState(st).order;
function pxPerUnit() { const a = toScreen(V(0, 0, 0), {}), b = toScreen(V(1, 0, 0), {}); return Math.abs(b.x - a.x) || 30; }
/** How far a finger may miss by: about one floor tile, and never less than a 52px target or more than a 92px one. */
const reach = () => clamp(pxPerUnit() * 1.05, 26, 46);
/** The station whose sign the point is inside, if any. Signs never overlap, so there is at most one. */
function signAt(x, y) {
  const s = stage.getBoundingClientRect();
  for (const el of $('labels').querySelectorAll('.lbl.click:not(.hid)')) {
    const r = el.getBoundingClientRect();
    if (x >= r.left - s.left && x <= r.right - s.left && y >= r.top - s.top && y <= r.bottom - s.top) return stationById(el.dataset.goto) || null;
  }
  return null;
}
/** The nearest live station within reach of the point, in stage pixels: by its counter, whoever stands at it, or its sign. */
function snap(x, y) {
  let best = null, bd = reach();
  const s = stage.getBoundingClientRect();
  for (const st of stations) {
    if (!live(st)) continue;
    for (const p of aimsOf(st)) { toScreen(p, sp); const d = Math.hypot(sp.x - x, sp.y - y); if (d < bd) { bd = d; best = st; } }
  }
  for (const el of $('labels').querySelectorAll('.lbl.click:not(.hid)')) {
    const st = stationById(el.dataset.goto); if (!st) continue;
    const r = el.getBoundingClientRect(), d = Math.hypot(Math.max(r.left - s.left - x, 0, x - (r.right - s.left)), Math.max(r.top - s.top - y, 0, y - (r.bottom - s.top)));
    if (d < bd) { bd = d; best = st; }
  }
  return best;
}
function ripple(x, y, hit) {
  const el = document.createElement('div'); el.className = `ripple${hit ? ' hit' : ''}`;
  el.style.left = `${x}px`; el.style.top = `${y}px`;
  stage.append(el); setTimeout(() => el.remove(), 500);
}
/** What a finger at this point of the stage means: a station, or failing that a place on the floor. */
function aim(x, y) {
  const r = canvas.getBoundingClientRect();
  ndc.set((x / r.width) * 2 - 1, -(y / r.height) * 2 + 1);
  ray.setFromCamera(ndc, camera);
  const pick = [];
  scene.traverse(o => { if (o.isMesh && (o.userData.station || o.userData.floor || o.userData.chefOf || o.userData.customerOf)) pick.push(o); });
  const hit = ray.intersectObjects(pick, false)[0], u = hit?.object.userData;
  // first the sign under the finger, then the thing under it, then the nearest thing within reach
  let st = signAt(x, y);
  if (!st) {
    st = u?.station || null;
    if (!st && u?.chefOf) st = chefStations.find(s => s.chefId === u.chefOf);
    if (!st && u?.customerOf && slotOf.has(u.customerOf)) st = stationById(`slot${slotOf.get(u.customerOf)}`);
    if (!st || !live(st)) st = snap(x, y) || st;
  }
  // open floor, or outside the room altogether: the nearest place a person can stand
  return { st: st || null, point: st ? null : hit?.point || ray.ray.intersectPlane(ground, at) };
}
export function tapWorld(cx, cy) {
  if (modal()) return;
  $('shiftPop').hidden = true; menu(false); typingIn()?.blur();
  const r = stage.getBoundingClientRect(), x = cx - r.left, y = cy - r.top;
  const { st, point } = aim(x, y);
  ripple(x, y, !!st);
  if (st) walkTo(st); else if (point) walkPoint(point.x, point.z);
}

/* ======================= layout: what the page keeps clear of the room ======================= */
let framed = false;
const px = n => `${Math.round(n)}px`;
function layout() {
  const w = stage.clientWidth, h = stage.clientHeight; if (!w || !h) return;
  const tall = TALL.matches, wide = WIDE.matches, touch = body.classList.contains('touch');
  if (!tall && !wide && !touch) { if (framed) { framed = false; setFrame(); } return; }
  framed = true;
  const s = stage.getBoundingClientRect(), hudB = hudEl.getBoundingClientRect().bottom - s.top;
  stage.style.setProperty('--hud-bottom', px(hudB));
  let room;
  if (tall) {
    // headroom for the chefs' signs, which stand above the back wall
    const f = { top: Math.round(hudB) + 2, head: w <= 560 ? 40 : 30, bottom: Math.min(Math.round(h * 0.4), 330), tall: true };
    room = setFrame(f);
    stage.style.setProperty('--room-bottom', px(room.y1));
    const c = cardEl.getBoundingClientRect(), y = (c.height ? c.bottom - s.top : room.y1) + 8;
    stage.style.setProperty('--bubble-top', px(y));
    room = setFrame({ ...f, bubble: { x: 8, y } });
  } else if (wide) {
    const c = cardEl.getBoundingClientRect();
    room = setFrame({ top: Math.round(hudB) + 2, head: 34, right: Math.round(s.right - c.left) + 2 });
  } else room = setFrame({ bottom: 120 });
  touchState.room = room;
}
const touchState = { room: null };

/* ======================= the page itself: no zoom, no scroll, and the keyboard never covers what you type in ======================= */
function enableTouch() {
  if (body.classList.contains('touch')) return;
  device.touch = true; body.classList.add('touch'); readCard(); layout();
}
if (device.touch) enableTouch();
for (const name of ['gesturestart', 'gesturechange', 'dblclick']) document.addEventListener(name, e => e.preventDefault(), { passive: false });
stage.addEventListener('contextmenu', e => { if (body.classList.contains('touch') && !typingIn()) e.preventDefault(); });
// a second finger never zooms the page, and nothing but a list of code or text scrolls
document.addEventListener('touchmove', e => {
  if (e.touches.length > 1 || !e.target.closest?.('.diff, .wip, .card, pre, .bub, .review, dialog, textarea, .tools')) e.preventDefault();
}, { passive: false });
// focus can scroll a box that has nothing to scroll; where overflow: clip is not understood, put it straight back
for (const el of [stage, $('labels'), $('pops')]) el.addEventListener('scroll', () => { el.scrollTop = 0; el.scrollLeft = 0; });
addEventListener('scroll', () => { if (scrollX || scrollY) scrollTo(0, 0); });
const vv = window.visualViewport;
const full = { tall: 0, wide: 0 };   // the tallest the page has been each way up, which is its height with no keyboard
/**
 * With the keyboard up, the stage shrinks to what is still visible and body.kb strips the page down to the room and the line
 * being typed. Browsers disagree on whether a keyboard shrinks the page or only what is visible of it, so this measures both.
 */
function fitViewport(forced) {
  const way = innerWidth > innerHeight ? 'wide' : 'tall', seen = typeof forced === 'number' ? forced : vv ? vv.height : innerHeight;
  full[way] = Math.max(full[way], innerHeight, vv ? vv.height : 0);
  const kb = body.classList.contains('touch') && (typeof forced === 'number' || !!typingIn()) && full[way] - seen > 120;
  if (kb) root.style.setProperty('--vvh', px(seen)); else root.style.removeProperty('--vvh');
  body.classList.toggle('kb', kb);
  stage.style.transform = kb && vv?.offsetTop ? `translateY(${Math.round(vv.offsetTop)}px)` : '';
}
vv?.addEventListener('resize', () => fitViewport()); vv?.addEventListener('scroll', () => fitViewport());
addEventListener('resize', () => fitViewport());
document.addEventListener('focusin', () => fitViewport()); document.addEventListener('focusout', () => setTimeout(fitViewport, 50));
new ResizeObserver(() => { resize(); layout(); }).observe(stage);
new ResizeObserver(layout).observe(cardEl);
new ResizeObserver(layout).observe(hudEl);
for (const q of [TALL, WIDE]) q.addEventListener('change', () => { resize(); layout(); });
addEventListener('resize', layout);
document.fonts?.ready.then(layout);
setInterval(tick, 150);
readCard(); layout();

/* ---------- test hook ---------- */
const corners = [[-6, -3.5], [6, -3.5], [-6, 3.5], [6, 3.5]];
if (window.__ship) window.__ship.touch = {
  press, tapWorld, stick, state: touchState,
  /** Pretends a keyboard has left this many pixels of the page visible; 0 puts it away. Headless browsers have no keyboard. */
  keyboard(visible) { if (visible) fitViewport(visible); else { root.style.removeProperty('--vvh'); body.classList.remove('kb'); } resize(); layout(); },
  /** The station a finger at this point of the page would pick, and how far it may miss by. */
  aim(x, y) { const r = stage.getBoundingClientRect(); return aim(x - r.left, y - r.top).st?.id || null; },
  get reach() { return reach(); },
  get on() { return body.classList.contains('touch'); },
  get layout() { return TALL.matches ? 'tall' : WIDE.matches ? 'wide' : 'desk'; },
  /** Where a station's counter top is on the page, so a check can tap it the way a finger would. */
  at(id) { const st = stationById(id), r = stage.getBoundingClientRect(), p = toScreen(st.top, {}); return { x: p.x + r.left, y: p.y + r.top }; },
  /** The floor's box on the page. */
  floor() {
    const pts = corners.map(([x, z]) => toScreen(V(x, 0, z), {}));
    return { x0: Math.min(...pts.map(p => p.x)), x1: Math.max(...pts.map(p => p.x)), y0: Math.min(...pts.map(p => p.y)), y1: Math.max(...pts.map(p => p.y)), w: stage.clientWidth, h: stage.clientHeight };
  },
  get near() { return inputState.near?.id || null; },
  get quality() { return { pr: quality.pr, shadow: quality.shadow, level: quality.level, outline: quality.outline, fps: quality.fps }; },
};
