// Renderer, camera, toon materials, mesh helpers, particles, labels and popups.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { OutlineEffect } from 'three/addons/effects/OutlineEffect.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { $, fx, reduceMotion, clamp } from './core.js';

export { THREE };
export const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
export const stage = $('stage');
/** The shell's page may not carry the hosts the labels and popups hang in: they are made here if missing. */
function hostFor(id, cls) { let el = $(id); if (!el) { el = document.createElement('div'); el.id = id; el.className = cls; stage.append(el); } return el; }

// Sharp enough on a retina laptop without drawing four times the pixels: the ratio is capped, and adapt() lowers it when frames run slow.
// A phone's screen is small and dense: 1.25 looks as sharp at arm's length and draws about 30% fewer pixels than 1.5.
const params = new URLSearchParams(location.search);
// A phone starts one rung down the ladder (smaller shadow map): its screen is small and its GPU is not a laptop's.
export const mobile = matchMedia('(pointer: coarse)').matches || /Mobi|Android|iPhone|iPad/i.test(navigator.userAgent);
const MAX_PIXEL_RATIO = mobile ? 1.25 : 1.5;
export const quality = { pr: Math.min(window.devicePixelRatio || 1, MAX_PIXEL_RATIO), level: mobile ? 1 : 0, outline: true, fps: 60, lost: false, mobile, fixed: params.get('quality') === 'high' };
if (params.get('ol') === '0') quality.outline = false;
if (params.get('pr')) quality.pr = Number(params.get('pr'));
if (params.get('quality') === 'low') { quality.pr = 1; quality.level = 2; quality.outline = false; quality.fixed = true; }
export const renderer = new THREE.WebGLRenderer({ antialias: params.get('aa') === '1', powerPreference: 'high-performance' });
renderer.setPixelRatio(quality.pr);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = params.get('sh') === 'pcf' ? THREE.PCFShadowMap : params.get('sh') === 'soft' ? THREE.PCFSoftShadowMap : params.get('sh') === 'basic' ? THREE.BasicShadowMap : THREE.PCFShadowMap;
if (params.get('sh') === 'off') renderer.shadowMap.enabled = false;
// Shadows are static: only the room and its furniture cast them, and the map is drawn once when a scene is built (shadowsDirty()).
// The people and the things that move carry a soft blob under them instead, so no frame pays for a second pass over the scene.
renderer.shadowMap.autoUpdate = false;
export const shadowsDirty = () => { renderer.shadowMap.needsUpdate = true; };
/** Something that moves: it casts no shadow into the static map (its blob is its shadow). */
export const noCast = o => { o.traverse(m => { m.castShadow = false; }); return o; };
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.18;
renderer.outputColorSpace = THREE.SRGBColorSpace;
stage.prepend(renderer.domElement);
// A phone that takes the GPU away (another app, a locked screen) gives it back later: keep the page, skip frames until then.
renderer.domElement.addEventListener('webglcontextlost', e => { e.preventDefault(); quality.lost = true; });
renderer.domElement.addEventListener('webglcontextrestored', () => { quality.lost = false; resize(); });

export const effect = new OutlineEffect(renderer, { defaultThickness: 0.0042, defaultColor: [0.2, 0.11, 0.07], defaultAlpha: 1 });
export const scene = new THREE.Scene();
scene.background = new THREE.Color('#1c1420');
export const camera = new THREE.PerspectiveCamera(30, 1, 0.5, 120);

/* ---------- light ---------- */
scene.add(new THREE.HemisphereLight('#fff1dc', '#6b5a7a', 1.25));
const key = new THREE.DirectionalLight('#ffe2b8', 2.5);
key.position.set(-5, 13, 7);
key.castShadow = true;
key.shadow.mapSize.set(2048, 2048);
Object.assign(key.shadow.camera, { left: -10, right: 10, top: 8, bottom: -8, near: 2, far: 32 });
key.shadow.bias = -0.0006; key.shadow.normalBias = 0.035; key.shadow.radius = 3;
if (quality.level >= 1) key.shadow.mapSize.set(1024, 1024);
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
    m.userData.outlineParameters = NO_OUTLINE; if (unique) m.userData.unique = true; return m;
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
  // two segments per rounded edge: at this camera distance three look the same and cost twice the triangles
  return add(geo(`rb${w},${h},${d},${rr}`, () => new RoundedBoxGeometry(w, h, d, 2, rr)), material, x, y + h / 2, z, parent);
}
export const cyl = (rt, rb, h, material, x, y, z, parent, seg = 20) => add(geo(`cy${rt},${rb},${h},${seg}`, () => new THREE.CylinderGeometry(rt, rb, h, seg)), material, x, y + h / 2, z, parent);
export const ball = (r, material, x, y, z, parent, seg = 18) => add(geo(`sp${r},${seg}`, () => new THREE.SphereGeometry(r, seg, Math.max(8, Math.round(seg * 0.7)))), material, x, y, z, parent);
export const capsule = (r, len, material, x, y, z, parent) => add(geo(`ca${r},${len}`, () => new THREE.CapsuleGeometry(r, len, 6, 16)), material, x, y, z, parent);
export function plane(w, d, material, x, y, z, parent = scene) {
  const m = new THREE.Mesh(geo(`pl${w},${d}`, () => new THREE.PlaneGeometry(w, d)), material);
  m.rotation.x = -Math.PI / 2; m.position.set(x, y, z); parent.add(m); return m;
}

/**
 * Merges the meshes directly under root that never move, change or answer a tap into one mesh per material, so a room
 * of a few hundred boxes is a few dozen draw calls. Left alone: groups, anything tagged in userData (tap, ground),
 * meshes with a material of their own (they fade or glow), and anything invisible. keep: more meshes to leave alone.
 */
export function mergeStatic(root, keep = new Set()) {
  root.updateMatrix();
  const buckets = new Map();
  for (const m of [...root.children]) {
    if (!m.isMesh || m.children.length || !m.visible || keep.has(m) || Object.keys(m.userData).length || Array.isArray(m.material) || m.material.userData.unique) continue;
    const k = `${m.material.uuid}|${m.castShadow}|${m.receiveShadow}|${m.renderOrder}`;
    (buckets.get(k) || buckets.set(k, []).get(k)).push(m);
  }
  let merged = 0;
  for (const list of buckets.values()) {
    if (list.length < 2) continue;
    const geos = list.map(m => {
      m.updateMatrix();
      let g = m.geometry.index ? m.geometry.toNonIndexed() : m.geometry.clone();
      for (const a of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(a)) g.deleteAttribute(a);
      g.morphAttributes = {};
      return g.applyMatrix4(m.matrix);
    });
    const g = mergeGeometries(geos, false);
    for (const x of geos) x.dispose();
    if (!g) continue;
    const one = new THREE.Mesh(g, list[0].material); one.userData.merged = true;
    Object.assign(one, { castShadow: list[0].castShadow, receiveShadow: list[0].receiveShadow, renderOrder: list[0].renderOrder });
    for (const m of list) root.remove(m);
    root.add(one); merged += list.length;
  }
  return merged;
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
// Two ways to look at the room. From the front it is wide, which suits a laptop and a phone on its side. A phone held upright
// looks from the street end instead, so the long side of the room runs up the screen and everything is nearly twice the size.
const DIRS = { front: V(0, 15, 10.4).normalize(), side: V(-10.4, 15, 0).normalize() };
let DIR = DIRS.front;
const CENTRE = V(-0.2, 0, -0.35);
const FITS = { front: [], side: [] };
for (const x of [-7.75, 7.6]) for (const [y, z] of [[0, -4.9], [2.55, -4.9], [0, 3.95], [0.6, 3.95]]) FITS.front.push(V(x, y, z));
for (const z of [-5.3, 3.9]) for (const [x, y] of [[-6.9, 0], [6.4, 0], [6.4, 2.1], [7.6, 1.3]]) FITS.side.push(V(x, y, z));
// follow: { x0, x1, z0, z1 } while the camera follows the player across a place bigger than the screen (the park), else null.
// wide: the whole of that place at once.
const view = { dist: 24, sx: 0, sy: 0, tDist: 24, tsx: 0, tsy: 0, dock: 0, dockB: 0, shake: 0, shakeAmp: 0, snap: true, calm: false, top: 58, side: false, follow: null, wide: false, zoom: 1, spanX: 16, spanZ: 9, pad: { l: 10, r: 10, t: null, b: 8 } };
const topOf = () => view.pad.t ?? view.top;
/** The street-end camera is for the kitchen on an upright phone. A followed place is always seen from the front. */
export const isSide = () => view.side && !view.follow;
const look = CENTRE.clone();
const pv = V();
function place(dist, target) {
  camera.position.copy(target).addScaledVector(view.follow ? DIRS.front : DIR, dist);
  camera.lookAt(target); camera.updateMatrixWorld();
}
const FOLLOW_SIN = DIRS.front.y;          // how steeply the camera looks down: screen height to depth of ground
const followCentre = V();
function solveFit() {
  const w = stage.clientWidth, h = stage.clientHeight;
  if (!w || !h) return;
  const f = view.follow;
  const FIT = f ? [] : view.side ? FITS.side : FITS.front;
  const centre = f ? followCentre.set((f.x0 + f.x1) / 2, 0, (f.z0 + f.z1) / 2) : CENTRE;
  if (f) for (const x of [f.x0, f.x1]) for (const [y, z] of [[0, f.z0], [f.top ?? 3, f.z0], [0, f.z1]]) FIT.push(V(x, y, z));
  const free = { l: view.pad.l, r: w * (1 - view.dock) - view.pad.r, t: topOf() + 4, b: h * (1 - view.dockB) - view.pad.b };
  camera.clearViewOffset(); camera.aspect = w / h; camera.updateProjectionMatrix();
  if (f && !view.wide) {
    // about 16 units of ground across a wide screen, about 10 across an upright phone, and the player in the middle of the free part
    const tanH = Math.tan(camera.fov * Math.PI / 360), across = (w >= h ? 16 : 9.2) * view.zoom;
    view.tDist = clamp(across / (2 * tanH * (w / h)), 12, 70);
    view.spanX = 2 * view.tDist * tanH * (w / h); view.spanZ = 2 * view.tDist * tanH / FOLLOW_SIN;
    view.tsx = w / 2 - (free.l + free.r) / 2; view.tsy = h / 2 - (free.t + free.b) / 2;
    return;
  }
  let lo = 8, hi = 220, box = null;
  const measure = dist => {
    place(dist, centre);
    const b = { x0: 1e9, x1: -1e9, y0: 1e9, y1: -1e9 };
    for (const p of FIT) { pv.copy(p).project(camera); const x = (pv.x + 1) / 2 * w, y = (1 - pv.y) / 2 * h; b.x0 = Math.min(b.x0, x); b.x1 = Math.max(b.x1, x); b.y0 = Math.min(b.y0, y); b.y1 = Math.max(b.y1, y); }
    return b;
  };
  for (let i = 0; i < 25; i++) {
    const mid = (lo + hi) / 2; box = measure(mid);
    if (box.x1 - box.x0 <= free.r - free.l && box.y1 - box.y0 <= free.b - free.t) hi = mid; else lo = mid;
  }
  box = measure(hi);
  view.tDist = hi;
  view.tsx = (box.x0 + box.x1) / 2 - (free.l + free.r) / 2;
  view.tsy = (box.y0 + box.y1) / 2 - (free.t + free.b) / 2;
}
export function resize() {
  const w = stage.clientWidth, h = stage.clientHeight;
  effect.setSize(w, h, false);
  renderer.domElement.style.width = '100%'; renderer.domElement.style.height = '100%';
  solveFit(); view.snap = true;
}
addEventListener('resize', resize);
/** The review panel docks over this fraction of the stage; the kitchen slides and shrinks to stay in view. */
export function setDock(frac, bottom = 0) { if (view.dock !== frac || view.dockB !== bottom) { view.dock = frac; view.dockB = bottom; solveFit(); } }
/** Which way the camera looks, and how much of each edge the HUD and the touch controls cover. */
export function setLayout({ side = false, pad }) {
  const turned = view.side !== side;
  view.side = side; DIR = side ? DIRS.side : DIRS.front; Object.assign(view.pad, pad);
  solveFit(); if (turned) view.snap = true;
  for (const L of labels.values()) L.w = 0;
}
/** Presenter mode: the camera stops following and shaking, and the room leaves space for a taller HUD. */
export function setCalm(calm, top = 58) { view.calm = calm; view.top = top; solveFit(); for (const L of labels.values()) L.w = 0; }
export function shake(amp = 0.16) {
  fx.shakes++;
  if (reduceMotion || view.calm) return;
  view.shake = 0.15; view.shakeAmp = amp;
}
const want = V();
export function updateCamera(dt, focus) {
  const snap = view.snap, k = snap ? 1 : 1 - Math.exp(-dt * 7);
  view.snap = false;
  view.dist += (view.tDist - view.dist) * k; view.sx += (view.tsx - view.sx) * k; view.sy += (view.tsy - view.sy) * k;
  const f = view.follow;
  if (f && view.wide) want.copy(followCentre);
  else if (f) {
    // the player stays in the middle until the edge of the place comes into view, then the camera stops and they walk on
    const mx = Math.max(0, (f.x1 - f.x0 - view.spanX) / 2 + 1.5), mz = Math.max(0, (f.z1 - f.z0 - view.spanZ) / 2 + 1.5), cx = (f.x0 + f.x1) / 2, cz = (f.z0 + f.z1) / 2;
    want.set(clamp(focus.x, cx - mx, cx + mx), 0, clamp(focus.z, cz - mz, cz + mz));
  } else {
    // eased toward the player, so the room breathes without ever scrolling; less when the review panel narrows the view
    const k10 = view.calm ? 0 : view.dock ? 0.02 : 0.07;
    want.set(CENTRE.x + (focus.x - CENTRE.x) * k10, 0, CENTRE.z + (focus.z - CENTRE.z) * k10);
  }
  if (snap) look.copy(want); else look.lerp(want, 1 - Math.exp(-dt * (f ? 6 : 5)));
  place(view.dist, look);
  if (view.shake > 0) {
    view.shake -= dt; const a = view.shakeAmp * Math.max(0, view.shake / 0.15);
    camera.position.x += (Math.random() - 0.5) * a * 2; camera.position.y += (Math.random() - 0.5) * a * 2;
  }
  const w = stage.clientWidth, h = stage.clientHeight;
  camera.setViewOffset(w, h, Math.round(view.sx), Math.round(view.sy), w, h);
  camera.updateMatrixWorld();
}
/* ---------- scenes: the kitchen, and whatever else is added (the park). Only the active one is drawn. ---------- */
const scenes = { kitchen: scene };
let active = scene;
export function addScene(name, s) { scenes[name] = s; }
/** Switches what is drawn. follow: the bounds of a place the camera should follow the player across, or null to fit the kitchen. */
export function setScene(name, { follow = null } = {}) {
  active = scenes[name] || scene;
  shadowsDirty();
  view.follow = follow; view.wide = false;
  solveFit(); view.snap = true;
  for (const L of labels.values()) L.w = 0;
}
export const sceneName = () => Object.keys(scenes).find(k => scenes[k] === active);
/** The whole followed place at once, or back to following. */
export function setOverview(on) { if (!view.follow || view.wide === !!on) return; view.wide = !!on; solveFit(); }
export const isOverview = () => view.wide;
/** Pinch: 1 is the close view that follows the Waiter, larger shows more of the floor. Only a followed place zooms. */
export function setZoom(z) { const v = clamp(z, 0.8, 2.1); if (v === view.zoom) return; view.zoom = v; if (view.follow) solveFit(); }
export const getZoom = () => view.zoom;
export const isFollowing = () => !!view.follow;
// the outline effect draws the scene twice, so the count is kept for the whole frame (nextFrame resets it), not for the last pass
renderer.info.autoReset = false;
export function render() { if (quality.lost) return; if (quality.outline) effect.render(active, camera); else renderer.render(active, camera); }

/* ---------- frame rate: measured every second; a slow machine gives up pixels, then shadow detail, then outlines ---------- */
// One second windows, one window of grace for shader compiles, and a frame rate far below the bar takes several rungs at
// once: a phone that draws 12 frames a second is on its feet in two or three seconds, not half a minute.
let qSince = performance.now(), qFrames = 0, qWarm = 1, qFast = 0;
// Dynamic resolution first: the picture gets a little softer before anything disappears. The floor of 0.6 still reads
// fine with the outlines; only a machine that cannot hold 30 there loses shadow detail, outlines and shadows, in that order.
const MIN_PR = 0.6, MAX_PR = quality.pr, TARGET = 34;
function setPr(pr) { pr = Math.round(pr * 100) / 100; if (pr === quality.pr) return false; quality.pr = pr; renderer.setPixelRatio(pr); resize(); return true; }
function down(fps) {
  if (quality.pr > MIN_PR) return setPr(Math.max(MIN_PR, quality.pr * Math.sqrt(Math.max(0.3, fps / TARGET)) * 0.95));
  if (quality.level === 0) { quality.level = 1; for (const l of shadowLights) { l.shadow.mapSize.set(1024, 1024); l.shadow.map?.dispose(); l.shadow.map = null; } shadowsDirty(); return true; }
  if (quality.level === 1 && fps < 28) { quality.level = 2; quality.outline = false; return true; }
  if (quality.level === 2 && fps < 26) { quality.level = 3; for (const l of shadowLights) l.castShadow = false; return true; }
  if (quality.level === 3 && fps < 24) { quality.level = 4; return setPr(0.5); }
  return false;
}
const shadowLights = [key];
export const addShadowLight = l => { shadowLights.push(l); };
export function adapt() {
  qFrames++;
  const now = performance.now(), span = now - qSince;
  if (span < 1000) return;
  const fps = qFrames * 1000 / span; qSince = now; qFrames = 0;
  if (span > 2500) return;                       // the tab was in the background
  quality.fps = Math.round(fps);
  if (qWarm > 0) { qWarm--; return; }            // the first second compiles shaders
  if (quality.fixed || document.hidden) return;
  if (fps < 30) { qFast = 0; down(fps); return; }
  // Headroom: three fast seconds in a row buy some sharpness back, up to where it started.
  if (fps >= 52 && quality.pr < MAX_PR) { if (++qFast >= 3) { qFast = 0; setPr(Math.min(MAX_PR, quality.pr + 0.1)); } }
  else qFast = 0;
}
export const drawCalls = () => renderer.info.render.calls;
export function toScreen(pos, out = {}) {
  pv.copy(pos).project(camera);
  out.x = (pv.x + 1) / 2 * stage.clientWidth; out.y = (1 - pv.y) / 2 * stage.clientHeight;
  return out;
}

/* ---------- particles ---------- */
const parts = [], spare = [];
/** Removes every particle at once: the scene they were in is going away. */
export function clearParticles() { for (const p of parts) { scene.remove(p.m); p.m.material.dispose(); } parts.length = 0; for (const m of spare) m.material.dispose(); spare.length = 0; }
const pGeo = { puff: new THREE.SphereGeometry(0.09, 8, 6), bit: new THREE.BoxGeometry(0.09, 0.025, 0.06), flame: new THREE.ConeGeometry(0.11, 0.3, 7), star: new THREE.OctahedronGeometry(0.07) };
export function spawn(kind, pos, color, { n = 1, spread = 0.15, up = 0.9, out = 0.3, life = 1.2, size = 1, grow = 0.6, gravity = 0, opacity = 0.85 } = {}) {
  if (reduceMotion) n = Math.min(n, 2);
  if (parts.length > 320) n = Math.min(n, 1);     // a busy kitchen never piles up more smoke than a laptop can draw
  if (quality.level > 0) n = Math.ceil(n * 0.6);
  for (let i = 0; i < n; i++) {
    // a spent particle's mesh and material are used again: smoke every tenth of a second allocates nothing
    const c = Array.isArray(color) ? color[i % color.length] : color;
    let m = spare.pop();
    if (m) { m.geometry = pGeo[kind] || pGeo.puff; m.material.color.set(c); m.rotation.set(0, 0, 0); }
    else m = new THREE.Mesh(pGeo[kind] || pGeo.puff, flat(c, { transparent: true, opacity, unique: true, depthWrite: false }));
    m.material.opacity = opacity;
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
    if (p.t >= p.life) { scene.remove(p.m); if (spare.length < 200) spare.push(p.m); else p.m.material.dispose(); parts.splice(i, 1); }
  }
}

/* ---------- HTML labels pinned to 3D points; lower priority ones give way instead of overlapping ---------- */
const host = hostFor('labels', 'labels');
const labels = new Map();
let frameNo = 0;
export const nextFrame = () => { renderer.info.reset(); return ++frameNo; };
/** pri: higher wins a collision. anchor: 'top' hangs the label below its point instead of above it. */
export function label(key, html, pos, { cls = '', pri = 1, click = null, anchor = 'bottom' } = {}) {
  let L = labels.get(key);
  if (!L) { const el = document.createElement('div'); host.append(el); L = { el, html: null, cls: null, click: undefined, pos: V(), w: 0, h: 0, x: NaN, y: NaN }; labels.set(key, L); }
  const c = `lbl ${cls}${click ? ' click' : ''}`;
  if (L.html !== html) { L.el.innerHTML = html; L.html = html; L.w = 0; }
  if (L.cls !== c) { L.el.className = c; L.cls = c; L.w = 0; }
  // the same value written every frame is still a DOM write: only a change touches the element
  if (L.click !== click) { L.click = click; if (click) L.el.dataset.goto = click; else delete L.el.dataset.goto; }
  L.pos.copy(pos); L.seen = frameNo; L.pri = pri; L.anchor = anchor;
}
/** Removes every label at once (a scene is being unmounted). */
export function clearLabels() { for (const L of labels.values()) L.el.remove(); labels.clear(); popHost.replaceChildren(); }
const scr = {};
export function placeLabels() {
  const w = stage.clientWidth, h = stage.clientHeight, taken = [];
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
    // a thing off the side of the screen (the camera follows the Waiter on a phone) has no label piled at the edge
    if (scr.x < -30 || scr.x > w + 30 || scr.y > h + 30) { L.el.classList.add('hid'); continue; }
    const ax = L.anchor === 'tl' ? scr.x : L.anchor === 'tr' ? scr.x - L.w : scr.x - L.w / 2, ay = L.anchor === 'bottom' ? scr.y - L.h : scr.y;
    const top = topOf();
    const right = w * (1 - view.dock) - 6, low = h * (1 - view.dockB) - 6;
    const r = { x: clamp(ax, 6, Math.max(6, right - L.w)), y: clamp(ay, top, Math.max(top, low - L.h)), w: L.w, h: L.h };
    let ok = !hits(r);
    for (const [dx, dy] of [[0, -1], [0, 1], [1, 0], [-1, 0]]) {
      if (ok) break;
      const t = { ...r, x: r.x + dx * (L.w * 0.6 + 6), y: r.y + dy * (L.h + 5) };
      if (t.x >= 6 && t.y >= top && t.x + t.w <= right && t.y + t.h <= low && !hits(t)) { r.x = t.x; r.y = t.y; ok = true; }
    }
    L.el.classList.toggle('hid', !ok);
    if (!ok) continue;
    taken.push(r);
    const x = Math.round(r.x), y = Math.round(r.y);
    if (x !== L.x || y !== L.y) { L.x = x; L.y = y; L.el.style.transform = `translate(${x}px,${y}px)`; }
  }
}

/* ---------- floating score text ---------- */
const popHost = hostFor('pops', 'pops');
let popSlot = 0, popSlotT = 0;
export function popup(text, pos, cls = '') {
  fx.popups++;
  const now = performance.now();
  if (now - popSlotT > 900) popSlot = 0;
  popSlotT = now;
  const el = document.createElement('div'); el.className = `pop ${cls}`; el.textContent = text;
  toScreen(pos, scr);
  el.style.left = `${clamp(scr.x, 60, stage.clientWidth - 60)}px`; el.style.top = `${clamp(scr.y - popSlot * 30, 80, stage.clientHeight - 40)}px`;
  el.style.animationDelay = `${popSlot * 0.12}s`;
  popSlot++;
  popHost.append(el);
  setTimeout(() => el.remove(), 2200 + popSlot * 120);
}

/* ---------- disposal: a scene that is unmounted gives its GPU memory back ---------- */
/**
 * Removes an object from its parent and frees every geometry, material and texture under it. Cached geometries and
 * materials are safe to free: three uploads them again the next time something draws with them.
 */
export function disposeTree(root) {
  if (!root) return;
  const seen = new Set();
  const free = x => { if (x && !seen.has(x)) { seen.add(x); x.dispose?.(); } };
  root.traverse(o => {
    free(o.geometry);
    for (const m of Array.isArray(o.material) ? o.material : o.material ? [o.material] : []) {
      for (const k of ['map', 'emissiveMap', 'alphaMap']) free(m[k]);
      free(m);
    }
  });
  root.parent?.remove(root);
}
/** For the mount and unmount check: what the GPU is holding. */
export const memory = () => ({ ...renderer.info.memory });
