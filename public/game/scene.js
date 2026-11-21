// Renderer, camera, toon materials, mesh helpers, particles, labels and popups.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { OutlineEffect } from 'three/addons/effects/OutlineEffect.js';
import { $, fx, reduceMotion, clamp } from './core.js';

export { THREE };
export const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
export const stage = $('stage');

// Sharp enough on a retina laptop without drawing four times the pixels: the ratio is capped, and adapt() lowers it when frames run slow.
const params = new URLSearchParams(location.search);
const MAX_PIXEL_RATIO = 1.5;
/** A phone or tablet: fingers, no hover. ?touch=1 and ?touch=0 force it either way. */
export const device = { touch: params.has('touch') ? params.get('touch') !== '0' : matchMedia('(pointer: coarse)').matches || (navigator.maxTouchPoints > 0 && !matchMedia('(hover: hover)').matches) };
/** The two small-screen layouts, in the same words as touch.css: a phone or tablet held upright, and a phone on its side. */
export const TALL = matchMedia('(orientation: portrait) and (max-width: 900px)');
export const WIDE = matchMedia('(orientation: landscape) and (max-height: 520px)');
export const quality = { pr: Math.min(window.devicePixelRatio || 1, MAX_PIXEL_RATIO), level: 0, outline: true, fps: 60, fixed: !!navigator.webdriver || params.get('quality') === 'high' };
if (params.get('quality') === 'low') { quality.pr = 1; quality.fixed = true; }
// a phone starts one step down: the same picture with a cheaper shadow, and adapt() can still take the outlines off
if (device.touch && params.get('quality') !== 'high') quality.level = 1;
export const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(quality.pr);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = quality.level ? THREE.PCFShadowMap : THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.18;
renderer.outputColorSpace = THREE.SRGBColorSpace;
stage.prepend(renderer.domElement);

export const effect = new OutlineEffect(renderer, { defaultThickness: 0.0042, defaultColor: [0.2, 0.11, 0.07], defaultAlpha: 1 });
export const scene = new THREE.Scene();
scene.background = new THREE.Color('#1c1420');
export const camera = new THREE.PerspectiveCamera(30, 1, 0.5, 120);

/* ---------- light ---------- */
scene.add(new THREE.HemisphereLight('#fff1dc', '#6b5a7a', 1.25));
const key = new THREE.DirectionalLight('#ffe2b8', 2.5);
key.position.set(-5, 13, 7);
key.castShadow = true;
key.shadow.mapSize.setScalar(quality.level ? 1024 : 2048);
quality.shadow = key.shadow.mapSize.x;
Object.assign(key.shadow.camera, { left: -10, right: 10, top: 8, bottom: -8, near: 2, far: 32 });
key.shadow.bias = -0.0006; key.shadow.normalBias = 0.035; key.shadow.radius = 3;
scene.add(key);

/* ---------- materials ---------- */
const ramp = new THREE.DataTexture(new Uint8Array([150, 208, 255]), 3, 1, THREE.RedFormat);
ramp.minFilter = ramp.magFilter = THREE.NearestFilter; ramp.needsUpdate = true;
const NO_OUTLINE = { visible: false };
const mats = new Map();
/** Cel-shaded material, cached by colour and options. */
export function toon(color, { map = null, emissive = null, emissiveIntensity = 1, outline = true, transparent = false, opacity = 1, key: k = '' } = {}) {
  const id = `t${color}${map?.uuid || ''}${emissive || ''}${emissiveIntensity}${outline}${opacity}${k}`;
  if (!mats.has(id)) {
    const m = new THREE.MeshToonMaterial({ color, gradientMap: ramp, map, transparent, opacity });
    if (emissive) { m.emissive = new THREE.Color(emissive); m.emissiveIntensity = emissiveIntensity; }
    if (!outline) m.userData.outlineParameters = NO_OUTLINE;
    mats.set(id, m);
  }
  return mats.get(id);
}
/** Unlit material: glows, decals, shadows, particles. Never outlined. */
export function flat(color, { map = null, transparent = false, opacity = 1, depthWrite = true, side = THREE.FrontSide, unique = false, toneMapped = true } = {}) {
  const make = () => {
    const m = new THREE.MeshBasicMaterial({ color, map, transparent, opacity, depthWrite, side, toneMapped });
    m.userData.outlineParameters = NO_OUTLINE; return m;
  };
  if (unique) return make();
  const id = `f${color}${map?.uuid || ''}${transparent}${opacity}${depthWrite}${side}${toneMapped}`;
  if (!mats.has(id)) mats.set(id, make());
  return mats.get(id);
}

/* ---------- geometry helpers ---------- */
const geos = new Map();
const geo = (k, make) => { if (!geos.has(k)) geos.set(k, make()); return geos.get(k); };
export function add(geometry, material, x = 0, y = 0, z = 0, parent = scene, shadow = true) {
  const m = new THREE.Mesh(geometry, typeof material === 'string' ? toon(material) : material);
  m.position.set(x, y, z); m.castShadow = shadow; m.receiveShadow = shadow;
  parent.add(m); return m;
}
/** Rounded box standing on y. */
export function rbox(w, h, d, material, x = 0, y = 0, z = 0, parent = scene, r = 0.07) {
  const rr = Math.min(r, w / 2 - 0.001, h / 2 - 0.001, d / 2 - 0.001);
  return add(geo(`rb${w},${h},${d},${rr}`, () => new RoundedBoxGeometry(w, h, d, 3, rr)), material, x, y + h / 2, z, parent);
}
export const cyl = (rt, rb, h, material, x, y, z, parent, seg = 20) => add(geo(`cy${rt},${rb},${h},${seg}`, () => new THREE.CylinderGeometry(rt, rb, h, seg)), material, x, y + h / 2, z, parent);
export const ball = (r, material, x, y, z, parent, seg = 18) => add(geo(`sp${r},${seg}`, () => new THREE.SphereGeometry(r, seg, Math.max(8, Math.round(seg * 0.7)))), material, x, y, z, parent);
export const capsule = (r, len, material, x, y, z, parent) => add(geo(`ca${r},${len}`, () => new THREE.CapsuleGeometry(r, len, 6, 16)), material, x, y, z, parent);
export function plane(w, d, material, x, y, z, parent = scene) {
  const m = new THREE.Mesh(geo(`pl${w},${d}`, () => new THREE.PlaneGeometry(w, d)), material);
  m.rotation.x = -Math.PI / 2; m.position.set(x, y, z); parent.add(m); return m;
}

/* ---------- canvas textures ---------- */
export function canvasTex(w, h, draw, { repeat = null, pixel = false } = {}) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
  if (repeat) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(repeat[0], repeat[1]); }
  if (pixel) t.magFilter = THREE.NearestFilter;
  t.userData.redraw = () => { draw(c.getContext('2d'), w, h); t.needsUpdate = true; };
  return t;
}
const blobTex = canvasTex(64, 64, (g) => {
  const grd = g.createRadialGradient(32, 32, 4, 32, 32, 32);
  grd.addColorStop(0, 'rgba(40,18,30,.62)'); grd.addColorStop(0.6, 'rgba(40,18,30,.3)'); grd.addColorStop(1, 'rgba(40,18,30,0)');
  g.fillStyle = grd; g.fillRect(0, 0, 64, 64);
});
/** Soft dark blob on the floor, under counters and characters. */
export function blob(w, d, x, z, parent = scene, y = 0.012) {
  const m = plane(w, d, flat('#ffffff', { map: blobTex, transparent: true, depthWrite: false }), x, y, z, parent);
  m.renderOrder = 1; return m;
}
/** Text painted on a board. Redrawn once the display font has loaded. */
const signs = [];
export function signTex(w, h, paint) { const t = canvasTex(w, h, paint); signs.push(t); return t; }
document.fonts?.ready.then(() => Promise.all([document.fonts.load('40px Bungee'), document.fonts.load('700 30px Rubik')])).then(() => { for (const t of signs) t.userData.redraw(); }).catch(() => {});

/* ---------- camera: fits the room into the free part of the stage ---------- */
const DIR = V(0, 15, 10.4).normalize();
const CENTRE = V(-0.2, 0, -0.35);
const FIT = [];
for (const x of [-7.75, 7.6]) for (const [y, z] of [[0, -4.9], [2.55, -4.9], [0, 3.95], [0.6, 3.95]]) FIT.push(V(x, y, z));
// An upright phone is narrow, so the room is framed tighter (the far pavement gives way) and from
// steeper above: the floor then stands taller on the screen and nothing on a counter hides behind the one in front.
const DIR_TALL = V(0, 15, 6.4).normalize();
const FIT_TALL = [];
for (const x of [-7.55, 7.35]) for (const [y, z] of [[0, -4.9], [2.55, -4.9], [0, 3.9], [0.5, 3.9]]) FIT_TALL.push(V(x, y, z));
const view = { dist: 24, sx: 0, sy: 0, tDist: 24, tsx: 0, tsy: 0, dock: 0, shake: 0, shakeAmp: 0, snap: true, calm: false, top: 58, ft: null, head: 0, tall: false, il: 0, ir: 0, ib: 0, room: null, bubble: null };
const look = CENTRE.clone();
const pv = V();
function place(dist, target) {
  camera.position.copy(target).addScaledVector(view.tall ? DIR_TALL : DIR, dist);
  camera.lookAt(target); camera.updateMatrixWorld();
}
function solveFit() {
  const w = stage.clientWidth, h = stage.clientHeight;
  if (!w || !h) return;
  const tall = view.tall, FIT_NOW = tall ? FIT_TALL : FIT, edge = tall ? 2 : 10;
  // upright, review is a sheet under the room, so only a docked side panel squeezes the room sideways; on a phone's side it takes more
  const dock = tall ? 0 : view.dock && WIDE.matches ? 0.6 : view.dock;
  const free = { l: edge + view.il, r: Math.min(w - view.ir, w * (1 - dock)) - edge, t: (view.ft ?? view.top) + 4 + view.head, b: h - 8 - view.ib };
  camera.clearViewOffset(); camera.aspect = w / h; camera.updateProjectionMatrix();
  let lo = 8, hi = 80, box = null;
  const measure = dist => {
    place(dist, CENTRE);
    const b = { x0: 1e9, x1: -1e9, y0: 1e9, y1: -1e9 };
    for (const p of FIT_NOW) { pv.copy(p).project(camera); const x = (pv.x + 1) / 2 * w, y = (1 - pv.y) / 2 * h; b.x0 = Math.min(b.x0, x); b.x1 = Math.max(b.x1, x); b.y0 = Math.min(b.y0, y); b.y1 = Math.max(b.y1, y); }
    return b;
  };
  for (let i = 0; i < 22; i++) {
    const mid = (lo + hi) / 2; box = measure(mid);
    if (box.x1 - box.x0 <= free.r - free.l && box.y1 - box.y0 <= free.b - free.t) hi = mid; else lo = mid;
  }
  box = measure(hi);
  view.tDist = hi;
  view.tsx = (box.x0 + box.x1) / 2 - (free.l + free.r) / 2;
  // upright, the room sits against the top strip and everything else is laid out under it
  view.tsy = tall ? box.y0 - free.t : (box.y0 + box.y1) / 2 - (free.t + free.b) / 2;
  view.room = { x0: box.x0 - view.tsx, x1: box.x1 - view.tsx, y0: box.y0 - view.tsy, y1: box.y1 - view.tsy };
}
export function resize() {
  const w = stage.clientWidth, h = stage.clientHeight;
  effect.setSize(w, h, false);
  renderer.domElement.style.width = '100%'; renderer.domElement.style.height = '100%';
  solveFit(); view.snap = true;
  for (const L of labels.values()) L.w = 0;
}
addEventListener('resize', resize);
/**
 * Small screens: what the page keeps clear of the room. top is where the top strip ends (null leaves it alone) and head is room left under it for the signs over the back wall; left, right and bottom are bands taken
 * by thumb controls or a side column; tall is the upright layout. bubble, when set, is where a chef's question is shown instead
 * of over the chef. Returns the room's rectangle on screen. A desktop page never calls this.
 */
export function setFrame({ top = null, head = 0, left = 0, right = 0, bottom = 0, tall = false, bubble = null } = {}) {
  view.bubble = bubble;
  if (top !== view.ft || head !== view.head || left !== view.il || right !== view.ir || bottom !== view.ib || tall !== view.tall) {
    Object.assign(view, { ft: top, head, il: left, ir: right, ib: bottom, tall });
    solveFit(); view.snap = true;
    for (const L of labels.values()) L.w = 0;
  }
  return view.room;
}
/** The review panel docks over this fraction of the stage; the kitchen slides and shrinks to stay in view. */
export function setDock(frac) { if (view.dock !== frac) { view.dock = frac; solveFit(); } }
/** Presenter mode: the camera stops following and shaking, and the room leaves space for a taller HUD. */
export function setCalm(calm, top = 58) { view.calm = calm; view.top = top; solveFit(); for (const L of labels.values()) L.w = 0; }
export function shake(amp = 0.16) {
  fx.shakes++;
  if (reduceMotion || view.calm) return;
  view.shake = 0.15; view.shakeAmp = amp;
}
export function updateCamera(dt, focus) {
  const k = view.snap ? 1 : 1 - Math.exp(-dt * 7);
  view.snap = false;
  view.dist += (view.tDist - view.dist) * k; view.sx += (view.tsx - view.sx) * k; view.sy += (view.tsy - view.sy) * k;
  // eased toward the player, so the room breathes without ever scrolling; less when the review panel narrows the view
  const k10 = view.calm ? 0 : view.dock || view.tall ? 0.02 : 0.07;
  look.lerp(V(CENTRE.x + (focus.x - CENTRE.x) * k10, 0, CENTRE.z + (focus.z - CENTRE.z) * k10), 1 - Math.exp(-dt * 5));
  place(view.dist, look);
  if (view.shake > 0) {
    view.shake -= dt; const a = view.shakeAmp * Math.max(0, view.shake / 0.15);
    camera.position.x += (Math.random() - 0.5) * a * 2; camera.position.y += (Math.random() - 0.5) * a * 2;
  }
  const w = stage.clientWidth, h = stage.clientHeight;
  camera.setViewOffset(w, h, Math.round(view.sx), Math.round(view.sy), w, h);
  camera.updateMatrixWorld();
}
export function render() { adapt(); if (quality.outline) effect.render(scene, camera); else renderer.render(scene, camera); }

/* ---------- frame rate: measured every two seconds; a slow machine gives up pixels, then shadow detail, then outlines ---------- */
let qSince = performance.now(), qFrames = 0, qWarm = 2, qFrame = -1;
export function adapt() {
  if (qFrame === frameNo) return;                // counted once a frame, whoever calls
  qFrame = frameNo; qFrames++;
  const now = performance.now(), span = now - qSince;
  if (span < 2000) return;
  const fps = qFrames * 1000 / span; qSince = now; qFrames = 0;
  if (span > 4000) return;                       // the tab was in the background
  quality.fps = Math.round(fps);
  if (qWarm > 0) { qWarm--; return; }            // the first seconds compile shaders
  if (quality.fixed || document.hidden || fps >= 42) return;
  if (quality.pr > 1) { quality.pr = Math.max(1, quality.pr - 0.25); renderer.setPixelRatio(quality.pr); resize(); }
  else if (quality.level === 0) { quality.level = 1; quality.shadow = 1024; key.shadow.mapSize.set(1024, 1024); key.shadow.map?.dispose(); key.shadow.map = null; }
  else if (quality.level === 1 && fps < 30) { quality.level = 2; quality.outline = false; }
  qWarm = 1;
}
export const drawCalls = () => renderer.info.render.calls;
export function toScreen(pos, out = {}) {
  pv.copy(pos).project(camera);
  out.x = (pv.x + 1) / 2 * stage.clientWidth; out.y = (1 - pv.y) / 2 * stage.clientHeight;
  return out;
}

/* ---------- particles ---------- */
const parts = [];
const pGeo = { puff: new THREE.SphereGeometry(0.09, 8, 6), bit: new THREE.BoxGeometry(0.09, 0.025, 0.06), flame: new THREE.ConeGeometry(0.11, 0.3, 7), star: new THREE.OctahedronGeometry(0.07) };
export function spawn(kind, pos, color, { n = 1, spread = 0.15, up = 0.9, out = 0.3, life = 1.2, size = 1, grow = 0.6, gravity = 0, opacity = 0.85 } = {}) {
  if (reduceMotion) n = Math.min(n, 2);
  if (parts.length > 320) n = Math.min(n, 1);     // a busy kitchen never piles up more smoke than a laptop can draw
  if (quality.level > 0) n = Math.ceil(n * 0.6);
  for (let i = 0; i < n; i++) {
    const m = new THREE.Mesh(pGeo[kind] || pGeo.puff, flat(Array.isArray(color) ? color[i % color.length] : color, { transparent: true, opacity, unique: true, depthWrite: false }));
    m.position.copy(pos); m.position.x += (Math.random() - 0.5) * spread; m.position.z += (Math.random() - 0.5) * spread;
    m.scale.setScalar(size * (0.8 + Math.random() * 0.4)); m.renderOrder = 3;
    scene.add(m);
    parts.push({ m, v: V((Math.random() - 0.5) * out, up * (0.7 + Math.random() * 0.6), (Math.random() - 0.5) * out), life: life * (0.8 + Math.random() * 0.4), t: 0, g: gravity, grow, s: m.scale.x, o: opacity, spin: kind === 'bit' || kind === 'star' ? 6 : 0 });
  }
}
export const confetti = pos => spawn('bit', pos, ['#f2b23a', '#57b86a', '#5aa7e0', '#e5533d', '#fff4df'], { n: 46, up: 4.6, out: 5, life: 1.5, gravity: 10, grow: 0, opacity: 1 });
export function stepParticles(dt) {
  for (let i = parts.length - 1; i >= 0; i--) {
    const p = parts[i]; p.t += dt;
    p.v.y -= p.g * dt; p.m.position.addScaledVector(p.v, dt);
    const f = p.t / p.life;
    p.m.scale.setScalar(p.s * (1 + p.grow * f));
    if (p.spin) { p.m.rotation.x += dt * p.spin; p.m.rotation.z += dt * p.spin * 0.7; }
    p.m.material.opacity = p.o * Math.max(0, 1 - f * f);
    if (p.t >= p.life) { scene.remove(p.m); p.m.material.dispose(); parts.splice(i, 1); }
  }
}

/* ---------- HTML labels pinned to 3D points; lower priority ones give way instead of overlapping ---------- */
const host = $('labels');
const labels = new Map();
let frameNo = 0;
export const nextFrame = () => ++frameNo;
/** pri: higher wins a collision. anchor: 'top' hangs the label below its point instead of above it. */
export function label(key, html, pos, { cls = '', pri = 1, click = null, anchor = 'bottom' } = {}) {
  let L = labels.get(key);
  if (!L) { const el = document.createElement('div'); host.append(el); L = { el, html: null, cls: null, pos: V(), w: 0, h: 0 }; labels.set(key, L); }
  const c = `lbl ${cls}${click ? ' click' : ''}`;
  if (L.html !== html) { L.el.innerHTML = html; L.html = html; L.w = 0; }
  if (L.cls !== c) { L.el.className = c; L.cls = c; L.w = 0; }
  if (click) L.el.dataset.goto = click; else delete L.el.dataset.goto;
  L.pos.copy(pos); L.seen = frameNo; L.pri = pri; L.anchor = anchor; L.dock = key === 'bubble';
}
const scr = {};
export function placeLabels() {
  const w = stage.clientWidth, h = stage.clientHeight, taken = [];
  // labels keep to the room: clear of a side column, and upright they stay above whatever is laid out under the room
  const x0 = 6 + view.il, x1 = w - 6 - view.ir, y1 = (view.tall && view.room ? Math.min(h, view.room.y1 + 4) : h - view.ib) - 6;
  const live = [];
  for (const [k, L] of labels) {
    if (L.seen !== frameNo) { L.el.remove(); labels.delete(k); continue; }
    if (!L.w) { L.w = L.el.offsetWidth; L.h = L.el.offsetHeight; }
    live.push(L);
  }
  live.sort((a, b) => b.pri - a.pri);
  const hits = r => taken.some(t => r.x < t.x + t.w + 3 && t.x < r.x + r.w + 3 && r.y < t.y + t.h + 3 && t.y < r.y + r.h + 3);
  for (const L of live) {
    toScreen(L.pos, scr);
    const ax = L.anchor === 'tl' ? scr.x : L.anchor === 'tr' ? scr.x - L.w : scr.x - L.w / 2, ay = L.anchor === 'bottom' ? scr.y - L.h : scr.y;
    const top = view.ft ?? view.top;
    // a docked question sits in the space the page gave it, clear of the room and of every other label
    if (L.dock && view.bubble) { L.el.classList.remove('hid'); L.el.style.transform = `translate(${Math.round(view.bubble.x)}px,${Math.round(view.bubble.y)}px)`; continue; }
    const r = { x: clamp(ax, x0, Math.max(x0, x1 - L.w)), y: clamp(ay, top, Math.max(top, y1 - L.h)), w: L.w, h: L.h };
    let ok = !hits(r);
    for (const [dx, dy] of [[0, -1], [0, 1], [1, 0], [-1, 0]]) {
      if (ok) break;
      const t = { ...r, x: r.x + dx * (L.w * 0.6 + 6), y: r.y + dy * (L.h + 5) };
      if (t.x >= x0 && t.y >= top && t.x + t.w <= x1 && t.y + t.h <= y1 && !hits(t)) { r.x = t.x; r.y = t.y; ok = true; }
    }
    L.el.classList.toggle('hid', !ok);
    if (!ok) continue;
    taken.push(r);
    L.el.style.transform = `translate(${Math.round(r.x)}px,${Math.round(r.y)}px)`;
  }
}

/* ---------- floating score text ---------- */
const popHost = $('pops');
let popSlot = 0, popSlotT = 0;
export function popup(text, pos, cls = '') {
  fx.popups++;
  const now = performance.now();
  if (now - popSlotT > 900) popSlot = 0;
  popSlotT = now;
  const el = document.createElement('div'); el.className = `pop ${cls}`; el.textContent = text;
  toScreen(pos, scr);
  el.style.animationDelay = `${popSlot * 0.12}s`;
  popHost.append(el);
  // kept whole on a narrow screen: the text is centred on its point, so half its width (and its pop to 1.25x) must fit either side
  const half = Math.max(60, el.offsetWidth * 0.625 + 4), w = stage.clientWidth - view.ir;
  el.style.left = `${clamp(scr.x, Math.min(half, w / 2), Math.max(w - half, w / 2))}px`; el.style.top = `${clamp(scr.y - popSlot * 30, 80, stage.clientHeight - 40)}px`;
  popSlot++;
  setTimeout(() => el.remove(), 2200 + popSlot * 120);
}
