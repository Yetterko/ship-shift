// The park: the map between the restaurants. A lawn, a fountain, and one building per floor that has a plot.
// Nothing here is game state: it draws `building.floors` and tells the shell when somebody walks through a door.
//
//   buildPark(parkSize)            builds the lawn, the plots and your avatar into the park scene
//   syncBuildings(floors, homeId)  one building per floor with a plot: name sign and a LIVE/DEMO lamp
//   placeMe(x, z) / arriveAt(plot) where you stand when the park opens
//   setGoal(x, z) / stepPark(dt, t, move) / drawPark(dt)   walking, other visitors, camera, labels, render
//   groundAt(clientX, clientY)     the point of lawn under the pointer
//   onEnter(fn)                    fn(floorLine) when you walk onto a doormat
//   disposePark()                  removes everything it built
import { THREE, V, toon, flat, add, rbox, cyl, ball, capsule, plane, blob, canvasTex, addScene, setScene, updateCamera, placeLabels, render, label, renderer, camera, quality, mergeStatic, noCast, shadowsDirty, addShadowLight, disposeTree } from './scene.js';
import { clamp, esc } from './core.js';
import { lookOf, peerList } from './presence.js';

export const parkScene = new THREE.Scene();
parkScene.background = new THREE.Color('#8fd0f0');
addScene('park', parkScene);
parkScene.add(new THREE.HemisphereLight('#fff7e6', '#5f8f5a', 1.35));
const sun = new THREE.DirectionalLight('#ffe9c4', 2.3);
sun.position.set(-9, 18, 10); sun.castShadow = true;
sun.shadow.mapSize.set(quality.level >= 1 ? 1024 : 2048, quality.level >= 1 ? 1024 : 2048);
Object.assign(sun.shadow.camera, { left: -30, right: 30, top: 20, bottom: -20, near: 2, far: 60 });
sun.shadow.bias = -0.0006; sun.shadow.normalBias = 0.04;
parkScene.add(sun); addShadowLight(sun);

const PLOT_W = 4.5, MAT_IN = 0.7, SPEED = 5.2, DOOR_R = 0.75;
export const PLOTS = 24;
/** The same 24 plots the server numbers: nearest the fountain first. */
export function layPlots(w = 40, h = 18) {
  const hw = w / 2, hh = h / 2, plots = [];
  for (let i = 0; i < 8; i++) plots.push({ slot: i, side: 'n', x: -15.75 + i * PLOT_W, z: -hh + MAT_IN });
  for (let i = 0; i < 8; i++) plots.push({ slot: 8 + i, side: 's', x: -15.75 + i * PLOT_W, z: hh - MAT_IN });
  for (let i = 0; i < 4; i++) plots.push({ slot: 16 + i, side: 'e', x: hw - MAT_IN, z: -6.75 + i * PLOT_W });
  for (let i = 0; i < 4; i++) plots.push({ slot: 20 + i, side: 'w', x: -hw + MAT_IN, z: -6.75 + i * PLOT_W });
  plots.sort((a, b) => Math.hypot(a.x, a.z) - Math.hypot(b.x, b.z) || a.slot - b.slot);
  return plots.map((p, id) => ({ id, ...p }));
}
const OUT = { n: [0, -1], s: [0, 1], e: [1, 0], w: [-1, 0] };

export const park = { built: false, w: 40, h: 18, plots: [], floors: [], homeId: null };
export const me = { x: 0, z: 2.6, r: Math.PI, moving: false, g: null, name: 'You', look: 0, role: 'spectator' };
let root = null, goal = null, enterFn = null, armed = true, hotPlot = null, grassTex = null, ringT = null;
const buildings = new Map();   // plot id -> { g, floorId, mode, lamp }
const avatars = new Map();     // peer id -> { g, t }
const FOUNTAIN_R = 2.1;

export const onEnter = fn => { enterFn = fn; };
export const setGoal = (x, z) => { goal = x === null || x === undefined ? null : { x, z }; };
export function placeMe(x, z) { me.x = x; me.z = z; me.moving = false; goal = null; armed = false; }
/** Stand just inside the park in front of a plot's door, or by the fountain. */
export function arriveAt(plotId) {
  const p = park.plots[plotId];
  if (!p) { placeMe(0, FOUNTAIN_R + 1.4); me.r = 0; return; }
  const [ox, oz] = OUT[p.side];
  placeMe(p.x - ox * 1.5, p.z - oz * 1.5); me.r = Math.atan2(-ox, -oz);
}

const COLORS = ['#e5533d', '#4aa3d8', '#57b86a', '#f2b23a', '#c873d6', '#3f9e98', '#ee8fa6', '#5b6ee1'];
function person(look, role, parent) {
  const L = lookOf(look), g = new THREE.Group();
  capsule(0.3, 0.42, toon(L.color), 0, 0.62, 0, g);
  ball(0.27, toon(L.skin), 0, 1.3, 0, g);
  ball(0.045, flat('#2a1a16'), -0.1, 1.34, 0.24, g, 8); ball(0.045, flat('#2a1a16'), 0.1, 1.34, 0.24, g, 8);
  if (role === 'spectator') cyl(0.3, 0.3, 0.07, toon('#3a241c'), 0, 1.5, 0, g);          // a flat cap
  else { cyl(0.2, 0.22, 0.24, toon('#fffaf0'), 0, 1.5, 0, g); ball(0.25, toon(role === 'judge' ? '#ffd75e' : '#fffaf0'), 0, 1.8, 0, g); }
  blob(0.95, 0.95, 0, 0, g);
  noCast(g); parent.add(g); return g;
}

export function buildPark({ w = 40, h = 18 } = {}, who = {}) {
  if (park.built) disposePark();
  Object.assign(park, { built: true, w, h, plots: layPlots(w, h) });
  Object.assign(me, { name: who.name || 'You', look: who.look || 0, role: who.role || 'spectator' });
  root = new THREE.Group(); parkScene.add(root);
  const hw = w / 2, hh = h / 2;
  const grass = grassTex ||= canvasTex(256, 256, (g, cw, ch) => {
    g.fillStyle = '#7cc46a'; g.fillRect(0, 0, cw, ch);
    for (let i = 0; i < 260; i++) { g.fillStyle = i % 2 ? 'rgba(255,255,255,.07)' : 'rgba(30,90,40,.09)'; g.fillRect((i * 97) % cw, (i * 53) % ch, 5, 9); }
  }, { repeat: [10, 6] });
  const lawn = plane(w + 30, h + 26, toon('#7cc46a', { map: grass, outline: false }), 0, 0, 0, root); lawn.receiveShadow = true;
  // the paths: a ring round the lawn past every door, and a cross to the fountain
  const path = toon('#f2dfb4', { outline: false });
  for (const [pw, pd, px, pz] of [[w - 0.6, 1.5, 0, -hh + MAT_IN], [w - 0.6, 1.5, 0, hh - MAT_IN], [1.5, h - 0.6, -hw + MAT_IN, 0], [1.5, h - 0.6, hw - MAT_IN, 0], [w - 2, 1.3, 0, 0], [1.3, h - 2, 0, 0]]) {
    const m = plane(pw, pd, path, px, 0.012, pz, root); m.receiveShadow = true;
  }
  // the fountain
  cyl(FOUNTAIN_R, FOUNTAIN_R + 0.15, 0.45, toon('#d9cdbb'), 0, 0, 0, root, 28);
  cyl(FOUNTAIN_R - 0.3, FOUNTAIN_R - 0.3, 0.06, toon('#6fc3e8', { outline: false }), 0, 0.42, 0, root, 28);
  cyl(0.28, 0.4, 1.3, toon('#d9cdbb'), 0, 0.4, 0, root, 14);
  ball(0.42, toon('#ffd75e'), 0, 1.95, 0, root);
  // trees and benches in the four lawns
  for (const [tx, tz] of [[-12, -4.2], [-6.5, 4.4], [6.5, -4.4], [12, 4.2], [-13.5, 4.6], [13.5, -4.6]]) {
    cyl(0.2, 0.26, 1.1, toon('#8a5a3c'), tx, 0, tz, root, 10);
    ball(1.05, toon('#4fa35c'), tx, 1.9, tz, root); ball(0.75, toon('#63b86d'), tx + 0.5, 2.5, tz + 0.2, root);
    blob(2.6, 2.6, tx, tz, root);
  }
  for (const [bx, bz] of [[-4.2, -3.2], [4.2, 3.2]]) { rbox(1.7, 0.16, 0.55, toon('#b9773f'), bx, 0.42, bz, root); rbox(0.14, 0.42, 0.5, toon('#6b4c3e'), bx - 0.65, 0, bz, root); rbox(0.14, 0.42, 0.5, toon('#6b4c3e'), bx + 0.65, 0, bz, root); }
  // every plot has a doormat; a building stands behind it once a floor owns the plot
  for (const p of park.plots) {
    const [ox, oz] = OUT[p.side];
    const lot = plane(3.7, 3.3, toon('#a9d79b', { outline: false }), p.x + ox * 2.7, 0.014, p.z + oz * 2.7, root);
    if (ox) lot.rotation.z = Math.PI / 2;
  }
  mergeStatic(root);   // lawn, paths, fountain, trees, benches and lots: a handful of draw calls
  me.g = person(me.look, me.role, root);
  const ring = plane(1.3, 1.3, flat('#ffffff', { transparent: true, opacity: 0.55, depthWrite: false, map: ringTex() }), 0, 0.03, 0, me.g); ring.renderOrder = 2;
  setScene('park', { follow: { x0: -hw - 3.2, x1: hw + 3.2, z0: -hh - 4.6, z1: hh + 3.4, top: 3.4 } });
  syncBuildings(park.floors, park.homeId);
}
function ringTex() {
  return ringT ||= canvasTex(64, 64, g => { g.clearRect(0, 0, 64, 64); g.strokeStyle = '#fff'; g.lineWidth = 6; g.beginPath(); g.arc(32, 32, 26, 0, Math.PI * 2); g.stroke(); });
}

function makeBuilding(p, f) {
  const [ox, oz] = OUT[p.side], g = new THREE.Group();
  const tall = p.side === 's' ? 1.5 : 2.7, col = COLORS[(f.number || 0) % COLORS.length];
  g.position.set(p.x + ox * 2.75, 0, p.z + oz * 2.75);
  g.rotation.y = Math.atan2(-ox, -oz);                      // local +z faces the park
  rbox(3.6, tall, 3.1, toon('#fff1d6'), 0, 0, 0, g, 0.12);
  rbox(3.9, 0.34, 3.4, toon(col), 0, tall, 0, g, 0.1);       // roof
  rbox(0.95, 1.25, 0.12, toon('#6b4c3e'), 0, 0, 1.56, g, 0.05);   // door
  rbox(1.8, 0.14, 0.75, toon(col), 0, 1.42, 1.85, g, 0.05);       // awning
  if (tall > 2) { rbox(0.8, 0.7, 0.1, toon('#9fd8f2'), -1.15, 1.0, 1.56, g, 0.04); rbox(0.8, 0.7, 0.1, toon('#9fd8f2'), 1.15, 1.0, 1.56, g, 0.04); }
  const mat = rbox(1.3, 0.05, 0.9, toon('#c9503b', { outline: false }), 0, 0.01, 2.2, g, 0.02); mat.castShadow = false;
  const lamp = ball(0.17, flat('#57b86a', { unique: true }), 0.75, Math.min(tall - 0.25, 1.9), 1.62, g, 12);
  mergeStatic(g);
  root.add(g); shadowsDirty();
  return { g, lamp, floorId: f.id, mode: null, tall };
}
function dropBuilding(b) { root?.remove(b.g); b.lamp.material.dispose(); b.g.traverse(o => { if (o.userData.merged) o.geometry.dispose(); }); shadowsDirty(); }

/** floors: FloorLine[] from the `building` message. */
export function syncBuildings(floors = [], homeId = park.homeId) {
  park.floors = floors || []; park.homeId = homeId;
  if (!park.built) return;
  const want = new Map();
  for (const f of park.floors) if (Number.isInteger(f.plot) && park.plots[f.plot]) want.set(f.plot, f);
  for (const [id, b] of buildings) if (want.get(id)?.id !== b.floorId) { dropBuilding(b); buildings.delete(id); }
  for (const [id, f] of want) {
    let b = buildings.get(id);
    if (!b) { b = makeBuilding(park.plots[id], f); buildings.set(id, b); }
    if (b.mode !== f.mode) { b.mode = f.mode; b.lamp.material.color.set(f.mode === 'live' ? '#4be07a' : '#ffb347'); }
    b.f = f;
  }
}

export function parkBlocked(x, z) { return Math.hypot(x, z) < FOUNTAIN_R + 0.5; }
const ray = new THREE.Raycaster(), ndc = new THREE.Vector2(), ground = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), hit = V();
export function groundAt(cx, cy) {
  const r = renderer.domElement.getBoundingClientRect();
  ndc.set((cx - r.left) / r.width * 2 - 1, -((cy - r.top) / r.height) * 2 + 1);
  ray.setFromCamera(ndc, camera);
  return ray.ray.intersectPlane(ground, hit) ? { x: hit.x, z: hit.z } : null;
}
/** The door spot of a floor's building, for "walk me there". */
export function doorOf(floorId) {
  for (const [id, b] of buildings) if (b.floorId === floorId) return park.plots[id];
  return null;
}
export const nearPlot = () => hotPlot;

const lp = V();
export function stepPark(dt, t, move = null) {
  if (!park.built) return;
  const hw = park.w / 2, hh = park.h / 2;
  let dx = 0, dz = 0;
  if (move && (move.x || move.z)) { dx = move.x; dz = move.z; goal = null; }
  else if (goal) { dx = goal.x - me.x; dz = goal.z - me.z; if (Math.hypot(dx, dz) < 0.12) { goal = null; dx = dz = 0; } }
  const len = Math.hypot(dx, dz);
  me.moving = len > 0.001;
  if (me.moving) {
    const s = Math.min(SPEED * dt, goal ? len : Infinity);
    let nx = me.x + dx / len * s, nz = me.z + dz / len * s;
    nx = clamp(nx, -hw + 0.3, hw - 0.3); nz = clamp(nz, -hh + 0.3, hh - 0.3);
    if (parkBlocked(nx, nz)) {       // slide round the fountain
      const a = Math.atan2(nz, nx), turn = (dx * -Math.sin(a) + dz * Math.cos(a)) >= 0 ? 1 : -1, na = a + turn * s / (FOUNTAIN_R + 0.55);
      nx = Math.cos(na) * (FOUNTAIN_R + 0.55); nz = Math.sin(na) * (FOUNTAIN_R + 0.55);
    }
    me.r = Math.atan2(dx, dz); me.x = nx; me.z = nz;
  }
  me.g.position.set(me.x, me.moving ? Math.abs(Math.sin(t * 13)) * 0.09 : 0, me.z);
  me.g.rotation.y += Math.atan2(Math.sin(me.r - me.g.rotation.y), Math.cos(me.r - me.g.rotation.y)) * Math.min(1, dt * 14);

  // doors: walking onto a mat with a building behind it goes in. Not the mat you just stepped out onto, until you leave it.
  let onMat = null; hotPlot = null;
  for (const [id, b] of buildings) {
    const p = park.plots[id], d = Math.hypot(me.x - p.x, me.z - p.z);
    if (d < DOOR_R) onMat = b;
    if (d < 2.4 && (!hotPlot || d < hotPlot.d)) hotPlot = { id, d, f: b.f };
  }
  if (!onMat) armed = true;
  else if (armed && enterFn) { armed = false; goal = null; enterFn(onMat.f); }

  // other visitors
  const seen = new Set();
  for (const p of peerList()) {
    seen.add(p.id);
    let a = avatars.get(p.id);
    if (!a) { a = { g: person(p.look, p.role, root) }; avatars.set(p.id, a); }
    a.g.position.set(p.x, p.moving ? Math.abs(Math.sin(t * 13 + p.x)) * 0.09 : 0, p.z); a.g.rotation.y = p.r;
    if (Math.hypot(p.x - me.x, p.z - me.z) < 9) label(`pk-p-${p.id}`, `<span class="pk-name">${esc(p.name)}</span>`, lp.set(p.x, 2.25, p.z), { cls: 'pk', pri: 1 });
  }
  for (const [id, a] of avatars) if (!seen.has(id)) { root.remove(a.g); avatars.delete(id); }

  // signs: number and name over each door, LIVE or DEMO, the score
  for (const [id, b] of buildings) {
    const f = b.f, p = park.plots[id], [ox, oz] = OUT[p.side], home = f.id === park.homeId;
    const html = `<div class="pk-sign ${f.mode === 'live' ? 'live' : 'demo'}${home ? ' home' : ''}"><b>No. ${f.number}</b><span>${esc(f.name)}</span><em><i></i>${f.mode === 'live' ? 'LIVE' : 'DEMO'}</em>${home ? '<u>Yours</u>' : ''}</div>`;
    label(`pk-b-${id}`, html, lp.set(p.x + ox * 1.6, b.tall + 0.75, p.z + oz * 1.6), { cls: 'pk', pri: home ? 6 : hotPlot?.id === id ? 5 : 3, click: `floor:${f.id}` });
  }
}

export function drawPark(dt) {
  if (!park.built) return;
  updateCamera(dt, me);
  placeLabels();
  render();
}

export function disposePark() {
  if (!park.built) return;
  buildings.clear(); avatars.clear();
  // the GPU gets its memory back: merged meshes, the lawn's texture and every building are freed, not just unhooked
  if (root) disposeTree(root);
  root = null; me.g = null; goal = null; hotPlot = null;
  park.built = false;
}

export const parkProbe = () => ({
  built: park.built, me: { x: me.x, z: me.z }, buildings: [...buildings].map(([plot, b]) => ({ plot, floorId: b.floorId, mode: b.mode, x: park.plots[plot].x, z: park.plots[plot].z })),
  peers: avatars.size, children: root ? root.children.length : 0, sceneChildren: parkScene.children.length,
});
