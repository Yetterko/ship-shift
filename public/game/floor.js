// One restaurant floor: the room, the people in it and everything that moves on its own.
// Where things are is the client's business; what they are is the server's (the snapshot in F.snap).
// Layout (spec section 2): Customers queue outside the left wall, two tables in the dining room, the ticket rail and the
// Pass on one long counter, four Stations and two Chefs along the top wall, the front door on the right wall, the TV by it.
import { THREE, V, scene, toon, flat, add, rbox, cyl, ball, plane, blob, canvasTex, spawn, confetti, label, popup, shake, disposeTree, clearLabels, clearParticles } from './scene.js';
import { character, customerChar, waiterChar, pose, kick, mover, moveTo, spring } from './characters.js';
import { esc, emit, reduceMotion } from './core.js';

/* ======================= layout ======================= */
export const STATIONS = [
  { id: 'frontend', name: 'Frontend', x: -3.6, color: '#4aa3d8', files: 'index.html, styles.css, ui.js', does: 'Builds the UI: semantic HTML, tidy CSS, accessible controls.' },
  { id: 'backend', name: 'Backend', x: -1.2, color: '#f2b23a', files: 'api.js', does: 'Writes pure, well-named functions with JSDoc. No DOM code.' },
  { id: 'database', name: 'Database', x: 1.2, color: '#57b86a', files: 'data/staff.json, data/shifts.json, data/schema.md', does: 'Owns the data shape and the seed data.' },
  { id: 'integration', name: 'Integration', x: 3.6, color: '#c873d6', files: 'main.js, checks.js', does: 'Wires the modules together and adds a self-check for each feature.' },
];
export const stationDef = id => STATIONS.find(s => s.id === id) || STATIONS[0];
const COUNTER_H = 0.9, STOVE_Z = -3.1, GALLEY_Z = -4.1, BAR_Z0 = -1.7, BAR_Z1 = -1.0, BAR_ZC = -1.35;
const RAIL_X = i => -5.0 + i * 0.5, RAIL_N = 8;
const PASS_X = i => -0.35 + i * 0.86, PASS_N = 6;
export const TABLES = [{ x: -2.7, z: 1.35 }, { x: 1.5, z: 1.35 }];
const LINE_X = -7.15, LINE_Z = i => 2.2 - i * 1.15, DOOR_IN = V(-5.3, 0, 2.2), STREET = V(-10.2, 0, 2.6);
const EXIT = { x: 6.2, z: 1.2 };
const TV = { x: 5.35, y: 1.05, z: -1.45, w: 1.5, h: 0.94 };
const CHEF_HOME = [-2.4, 2.4], CHEF_COLORS = ['#4aa3d8', '#c873d6', '#57b86a', '#f2b23a'];
const C = { cab: '#3d6475', cabDark: '#2f4f5e', cream: '#fff1d6', wood: '#d79a5b', woodDark: '#a8683a', red: '#dc4a3a', redDark: '#a9342a', steel: '#b9c4cc', steelDark: '#6d7a84', brass: '#e6b24a', brick: '#c8684a', teal: '#3f9e98', ink: '#3a241c', paper: '#fff8e6' };
const SIZE_COLOR = { S: '#57b86a', M: '#4aa3d8', L: '#e5533d' };
const FOODS = ['#f2a03a', '#e5533d', '#57b86a', '#e8c95a', '#c873d6', '#4aa3d8'];
/** The camera follows the Waiter across this box on an upright phone. */
export const FOLLOW = { x0: -8.6, x1: 7.2, z0: -5.2, z1: 4.0, top: 2.6 };

/* ---------- textures: painted once and kept for every mount (their GPU copies are freed on unmount) ---------- */
let TEX = null;
function textures() {
  if (TEX) return TEX;
  const rnd = (() => { let s = 7; return () => (s = (s * 16807) % 2147483647) / 2147483647; })();
  const T = {};
  T.floor = canvasTex(768, 448, (g) => {
    for (let i = 0; i < 12; i++) for (let j = 0; j < 7; j++) {
      const warm = (i + j) % 2 === 0, l = (rnd() - 0.5) * 5;
      g.fillStyle = warm ? `hsl(36, 62%, ${86 + l}%)` : `hsl(${17 + rnd() * 4}, 60%, ${68 + l}%)`;
      g.fillRect(i * 64, j * 64, 64, 64);
      g.fillStyle = 'rgba(255,255,255,.16)'; g.fillRect(i * 64 + 3, j * 64 + 3, 58, 5);
    }
    g.strokeStyle = 'rgba(120,70,50,.45)'; g.lineWidth = 3;
    for (let i = 0; i <= 12; i++) { g.beginPath(); g.moveTo(i * 64, 0); g.lineTo(i * 64, 448); g.stroke(); }
    for (let j = 0; j <= 7; j++) { g.beginPath(); g.moveTo(0, j * 64); g.lineTo(768, j * 64); g.stroke(); }
  });
  T.wall = canvasTex(512, 128, (g) => {
    for (let i = 0; i < 16; i++) for (let j = 0; j < 4; j++) {
      g.fillStyle = `hsl(${174 + rnd() * 6}, ${38 + rnd() * 6}%, ${j === 0 ? 62 : 50 + rnd() * 5}%)`;
      g.fillRect(i * 32 + (j % 2 ? 16 : 0) - 32, j * 32, 64, 32); g.fillRect(i * 32 + (j % 2 ? 16 : 0), j * 32, 31, 31);
    }
    g.fillStyle = '#fff1d6'; g.fillRect(0, 28, 512, 5);
    g.strokeStyle = 'rgba(20,60,60,.35)'; g.lineWidth = 2;
    for (let j = 0; j <= 4; j++) { g.beginPath(); g.moveTo(0, j * 32); g.lineTo(512, j * 32); g.stroke(); }
    for (let j = 1; j < 4; j++) for (let i = 0; i <= 16; i++) { const x = i * 32 + (j % 2 ? 16 : 0); g.beginPath(); g.moveTo(x, j * 32); g.lineTo(x, j * 32 + 32); g.stroke(); }
  });
  T.wood = canvasTex(256, 64, (g) => {
    for (let i = 0; i < 8; i++) { g.fillStyle = `hsl(${28 + rnd() * 6}, ${58 + rnd() * 8}%, ${58 + rnd() * 9}%)`; g.fillRect(i * 32, 0, 32, 64); }
    g.strokeStyle = 'rgba(110,60,25,.4)'; g.lineWidth = 2;
    for (let i = 0; i <= 8; i++) { g.beginPath(); g.moveTo(i * 32, 0); g.lineTo(i * 32, 64); g.stroke(); }
  });
  T.cobble = canvasTex(256, 256, (g) => {
    g.fillStyle = '#6f5d74'; g.fillRect(0, 0, 256, 256);
    for (let j = 0; j < 8; j++) for (let i = 0; i < 5; i++) {
      g.fillStyle = `hsl(${275 + rnd() * 20}, 13%, ${50 + rnd() * 9}%)`;
      g.beginPath(); g.roundRect(i * 56 + (j % 2 ? 28 : 0) - 26, j * 32 + 3, 50, 26, 9); g.fill();
    }
  }, { repeat: [1.6, 4.2] });
  T.ground = canvasTex(256, 256, (g) => {
    const grd = g.createRadialGradient(128, 128, 20, 128, 128, 128);
    grd.addColorStop(0, '#6b4a5c'); grd.addColorStop(0.45, '#46303f'); grd.addColorStop(1, '#1c1420');
    g.fillStyle = grd; g.fillRect(0, 0, 256, 256);
  });
  T.glow = canvasTex(64, 64, (g) => { const r = g.createRadialGradient(32, 32, 2, 32, 32, 32); r.addColorStop(0, 'rgba(255,170,70,.95)'); r.addColorStop(1, 'rgba(255,120,40,0)'); g.fillStyle = r; g.fillRect(0, 0, 64, 64); });
  T.ring = canvasTex(128, 128, (g) => {
    g.strokeStyle = '#fff'; g.lineWidth = 12; g.lineCap = 'round';
    for (let i = 0; i < 4; i++) { g.beginPath(); g.arc(64, 64, 48, i * Math.PI / 2 + 0.25, (i + 1) * Math.PI / 2 - 0.25); g.stroke(); }
  });
  T.awning = canvasTex(64, 256, (g) => { for (let i = 0; i < 16; i++) { g.fillStyle = i % 2 ? '#fff1d6' : '#dc4a3a'; g.fillRect(0, i * 16, 64, 16); } });
  T.cloth = canvasTex(64, 64, (g) => { g.fillStyle = '#fff6e3'; g.fillRect(0, 0, 64, 64); g.fillStyle = 'rgba(220,74,58,.5)'; for (let i = 0; i < 4; i++) { g.fillRect(i * 16, 0, 8, 64); g.fillRect(0, i * 16, 64, 8); } });
  T.signs = [];
  const sign = (w, h, paint) => { const t = canvasTex(w, h, paint); T.signs.push(t); return t; };
  T.board = (text, bg, fg = '#fff1d6') => sign(256, 80, (g, cw, ch) => { g.fillStyle = bg; g.fillRect(0, 0, cw, ch); g.fillStyle = fg; g.textAlign = 'center'; g.textBaseline = 'middle'; g.font = `${text.length > 9 ? 32 : text.length > 7 ? 38 : 46}px Bungee, Impact, sans-serif`; g.fillText(text, cw / 2, ch / 2 + 3); });
  T.stencil = (name, means) => sign(384, 128, (g, cw, ch) => {
    g.clearRect(0, 0, cw, ch); g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillStyle = 'rgba(92,46,30,.62)'; g.font = '62px Bungee, Impact, sans-serif'; g.fillText(name, cw / 2, 46);
    g.fillStyle = 'rgba(92,46,30,.7)'; g.font = '700 30px Rubik, sans-serif'; g.fillText(means, cw / 2, 100);
  });
  T.stationSign = STATIONS.map(s => T.board(s.name.toUpperCase(), s.color, '#3a241c'));
  T.line = T.board('THE LINE', '#dc4a3a'); T.exit = T.board('PARK', '#3f9e98');
  T.sRail = T.stencil('RAIL', 'tickets waiting for a Chef'); T.sPass = T.stencil('PASS', 'review before it goes out');
  T.sLine = T.stencil('LINE', 'tasks not started'); T.sT = [T.stencil('TABLE 1', 'a task in progress'), T.stencil('TABLE 2', 'a task in progress')];
  // the TV: a drawn Rosterette until a shipped Order's screenshot replaces it
  T.tv = canvasTex(320, 200, (g, w, h) => paintTv(g, w, h, 0));
  document.fonts?.ready.then(() => Promise.all([document.fonts.load('40px Bungee'), document.fonts.load('700 30px Rubik')])).then(() => { for (const t of T.signs) t.userData.redraw(); }).catch(() => {});
  return (TEX = T);
}
/** The stand-in picture on the TV: a week roster that fills in as Orders ship. */
export function paintTv(g, w, h, shipped) {
  g.fillStyle = '#fdf6e6'; g.fillRect(0, 0, w, h);
  g.fillStyle = '#3a241c'; g.fillRect(0, 0, w, 30);
  g.fillStyle = '#ffd75e'; g.font = '700 17px Rubik, sans-serif'; g.textBaseline = 'middle'; g.textAlign = 'left'; g.fillText('Rosterette', 10, 16);
  g.fillStyle = '#fff1d6'; g.font = '600 11px Rubik, sans-serif'; g.textAlign = 'right'; g.fillText(shipped ? `${shipped} shipped` : 'week 47', w - 10, 16);
  const cols = ['#4aa3d8', '#f2b23a', '#57b86a', '#c873d6', '#e5533d'];
  for (let r = 0; r < 5; r++) {
    g.fillStyle = '#e9dcc0'; g.fillRect(8, 40 + r * 31, 52, 24);
    for (let c = 0; c < 7; c++) {
      const on = (r * 3 + c * 5) % 4 !== 0;
      g.fillStyle = on ? cols[(r + (shipped > r ? c : 0)) % cols.length] : '#efe4cd';
      g.globalAlpha = on ? (shipped > r ? 1 : 0.55) : 1;
      g.fillRect(66 + c * 36, 40 + r * 31, 32, 24); g.globalAlpha = 1;
    }
  }
}

/* ======================= state ======================= */
/**
 * F is everything the rest of the floor client reads: the latest snapshot, who you are, the Waiter, and what can be tapped.
 * targets: key -> { key, type, id, pos (where it is, for picking and labels), access (where the Waiter stands), name }
 */
export const F = { root: null, snap: null, you: { isOwner: false, canAct: false }, offset: 0, waiter: null, targets: new Map(), booted: false, cooking: 0, cheer: 0, guideTarget: null, hot: null };
export const now = () => Date.now() + F.offset;
const L = { stoves: [], chefs: new Map(), customers: new Map(), leaving: [], tickets: new Map(), plates: new Map(), passSlot: new Map(), peers: new Map(), popSeen: new Set(), tables: [], tv: null, ring: null, dot: null, beacon: null, beaconRing: null, shock: null, shockT: 9, door: null, marks: [], served: new Map() };

const tapOf = (meshes, key) => { for (const m of meshes) m.traverse(o => { o.userData.tap = key; }); };
function target(key, type, id, pos, access, name, extra = {}) { const t = { key, type, id, pos, access, name, ...extra }; F.targets.set(key, t); return t; }

/* ======================= collision and path finding (the Waiter keeps to the dining room) ======================= */
export const PLAYER_R = 0.3;
const BOUNDS = { x0: -5.75, x1: 5.75, z0: BAR_Z1, z1: 3.45 };
const SOLIDS = TABLES.map(t => ({ x0: t.x - 0.72, x1: t.x + 0.72, z0: t.z - 1.15, z1: t.z + 0.72 }));
export function blocked(x, z, r = PLAYER_R) {
  if (x < BOUNDS.x0 + r || x > BOUNDS.x1 - r || z < BOUNDS.z0 + r || z > BOUNDS.z1 - r) return true;
  for (const b of SOLIDS) if (x > b.x0 - r && x < b.x1 + r && z > b.z0 - r && z < b.z1 + r) return true;
  return false;
}
function clear(a, b) {
  const d = Math.hypot(b.x - a.x, b.z - a.z), n = Math.max(1, Math.ceil(d / 0.12));
  for (let i = 0; i <= n; i++) { const t = i / n; if (blocked(a.x + (b.x - a.x) * t, a.z + (b.z - a.z) * t, PLAYER_R - 0.02)) return false; }
  return true;
}
const NODES = [];
for (let x = -5.25; x <= 5.3; x += 0.5) for (let z = -0.6; z <= 3.1; z += 0.5) if (!blocked(x, z)) NODES.push({ x, z });
/** A* over a 0.5 grid, then pulled straight wherever there is a clear line. Returns points to walk through. */
export function findPath(from, to) {
  if (clear(from, to)) return [V(to.x, 0, to.z)];
  const start = { x: from.x, z: from.z }, goal = { x: to.x, z: to.z };
  const all = [start, ...NODES, goal], gi = all.length - 1;
  const g = new Float32Array(all.length).fill(1e9), came = new Int32Array(all.length).fill(-1), done = new Uint8Array(all.length);
  g[0] = 0;
  const h = i => Math.hypot(all[i].x - goal.x, all[i].z - goal.z);
  const open = new Set([0]);
  while (open.size) {
    let cur = -1, best = 1e9;
    for (const i of open) { const f = g[i] + h(i); if (f < best) { best = f; cur = i; } }
    if (cur === gi) break;
    open.delete(cur); done[cur] = 1;
    for (let j = 1; j < all.length; j++) {
      if (done[j]) continue;
      const d = Math.hypot(all[cur].x - all[j].x, all[cur].z - all[j].z);
      if (d > (cur === 0 || j === gi ? 1.1 : 0.75) || !d || !clear(all[cur], all[j])) continue;
      if (g[cur] + d < g[j]) { g[j] = g[cur] + d; came[j] = cur; open.add(j); }
    }
  }
  if (came[gi] < 0) return [V(to.x, 0, to.z)];
  const pts = []; for (let i = gi; i > 0; i = came[i]) pts.unshift(all[i]);
  const out = []; let at = start, i = 0;
  while (i < pts.length) { let j = pts.length - 1; while (j > i && !clear(at, pts[j])) j--; out.push(V(pts[j].x, 0, pts[j].z)); at = pts[j]; i = j + 1; }
  return out;
}

/* ======================= build ======================= */
export function buildFloor() {
  if (F.root) disposeFloor();
  const T = textures();
  const root = new THREE.Group(); root.name = 'floor'; scene.add(root); F.root = root;
  const P = root;
  const woodTop = toon('#ffffff', { map: T.wood }), wallMat = toon('#ffffff', { map: T.wall }), steel = toon(C.steel);
  const counter = (x0, x1, z0, z1, top = woodTop, body = C.cab) => {
    const w = x1 - x0, d = z1 - z0, cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
    blob(w + 0.7, d + 0.7, cx, cz, P);
    rbox(w, 0.12, d, C.cabDark, cx, 0, cz, P, 0.03);
    return [rbox(w, COUNTER_H - 0.2, d, body, cx, 0.1, cz, P), rbox(w + 0.06, 0.12, d + 0.06, top, cx, COUNTER_H - 0.12, cz, P, 0.05)];
  };
  const board3d = (tex, x, y, z, w) => {
    rbox(w + 0.12, w * 0.3125 + 0.12, 0.08, C.ink, x, y, z, P, 0.03);
    add(new THREE.PlaneGeometry(w, w * 0.3125), flat('#ffffff', { map: tex, toneMapped: false }), x, y + w * 0.156 + 0.06, z + 0.045, P, false);
  };
  const stencil = (tex, x, z, w = 1.7) => { const m = plane(w, w / 3, flat('#ffffff', { map: tex, transparent: true, depthWrite: false }), x, 0.008, z, P); m.renderOrder = 1; return m; };

  /* ---------- shell ---------- */
  plane(70, 50, flat('#ffffff', { map: T.ground, toneMapped: false }), 0, -0.03, 0, P);
  const floor = plane(12, 7, toon('#ffffff', { map: T.floor, outline: false }), 0, 0, 0, P); floor.receiveShadow = true; floor.userData.ground = true;
  plane(12.3, 1.5, toon('#8a6a62', { outline: false }), 0.15, 0, -4.2, P).receiveShadow = true;
  plane(3.6, 9.2, toon('#ffffff', { map: T.cobble, outline: false }), -7.8, -0.01, -0.4, P).receiveShadow = true;
  const pave = plane(1.5, 6.6, toon('#e8d9b8', { outline: false }), -7.1, 0, -0.1, P); pave.receiveShadow = true;
  // back wall, a shelf of pans and jars, a window with a warm evening outside
  rbox(12.9, 2.55, 0.32, wallMat, 0.15, 0, -5.1, P, 0.05); rbox(12.9, 0.16, 0.42, C.cream, 0.15, 2.5, -5.1, P);
  rbox(7.6, 0.08, 0.34, woodTop, -1.4, 1.78, -4.82, P);
  for (const [x, col, r, h] of [[-4.6, '#e5533d', 0.15, 0.3], [-4.2, '#f2b23a', 0.12, 0.22], [-3.0, C.cream, 0.16, 0.34], [-2.55, '#57b86a', 0.11, 0.2], [-0.2, '#4aa3d8', 0.15, 0.28], [0.25, C.cream, 0.11, 0.2], [1.9, '#f2b23a', 0.16, 0.32]]) {
    cyl(r, r, h, col, x, 1.86, -4.8, P); cyl(r * 0.8, r * 0.8, 0.05, C.woodDark, x, 1.86 + h, -4.8, P);
  }
  rbox(2.3, 1.2, 0.1, C.cream, 4.3, 1.05, -4.97, P, 0.05);
  add(new THREE.PlaneGeometry(2.0, 0.95), flat('#ffffff', { toneMapped: false, map: (T.sky ||= canvasTex(128, 64, (g) => { const s = g.createLinearGradient(0, 0, 0, 64); s.addColorStop(0, '#f6a85e'); s.addColorStop(0.6, '#f9d08a'); s.addColorStop(1, '#fbe6b3'); g.fillStyle = s; g.fillRect(0, 0, 128, 64); g.fillStyle = '#e98a52'; g.beginPath(); g.arc(88, 44, 14, 0, 7); g.fill(); g.fillStyle = '#7a5a7a'; g.fillRect(0, 50, 128, 14); g.fillRect(14, 36, 16, 20); g.fillRect(40, 42, 22, 12); })) }), 4.3, 1.65, -4.91, P, false);
  rbox(0.07, 1.0, 0.06, C.cream, 4.3, 1.15, -4.9, P); rbox(2.1, 0.07, 0.06, C.cream, 4.3, 1.62, -4.9, P);
  // right wall, with the front door in it; left wall low, with the way in from the street
  const wallSeg = (z0, z1, h = 2.0) => { rbox(0.32, h, z1 - z0, wallMat, 6.2, 0, (z0 + z1) / 2, P, 0.05); rbox(0.42, 0.14, z1 - z0, C.cream, 6.2, h - 0.04, (z0 + z1) / 2, P); };
  wallSeg(-5.1, EXIT.z - 0.75); wallSeg(EXIT.z + 0.75, 3.7, 1.25);
  rbox(12.9, 0.42, 0.3, C.brick, 0.15, 0, 3.66, P); rbox(12.9, 0.08, 0.38, C.cream, 0.15, 0.42, 3.66, P);
  for (const [z0, z1] of [[-3.7, 1.5], [2.9, 3.7]]) { rbox(0.3, 0.9, z1 - z0, C.brick, -6.18, 0, (z0 + z1) / 2, P); rbox(0.38, 0.08, z1 - z0, C.cream, -6.18, 0.9, (z0 + z1) / 2, P); }
  rbox(0.36, 2.3, 0.36, C.cream, -6.18, 0, -3.7, P);
  for (const z of [1.5, 2.9]) { rbox(0.3, 1.9, 0.3, C.cream, -6.18, 0, z, P, 0.05); ball(0.13, flat('#ffe2a0', { toneMapped: false }), -6.18, 2.02, z, P, 12).castShadow = false; }
  const awn = rbox(0.9, 0.1, 1.9, toon('#ffffff', { map: T.awning }), -6.45, 1.86, 2.2, P, 0.03); awn.rotation.z = 0.22;
  plane(1.0, 1.1, toon('#3f9e98', { outline: false }), -5.55, 0.012, 2.2, P).receiveShadow = true;

  /* ---------- the line outside ---------- */
  board3d(T.line, -7.15, 2.0, -4.25, 1.5);
  rbox(0.09, 2.0, 0.09, C.ink, -7.8, 0, -4.25, P); rbox(0.09, 2.0, 0.09, C.ink, -6.5, 0, -4.25, P);
  for (const z of [-3.4, 2.95]) { cyl(0.07, 0.09, 0.9, C.brass, -6.5, 0, z, P, 10); ball(0.09, C.brass, -6.5, 0.94, z, P, 10); }
  rbox(0.05, 0.06, 6.3, C.red, -6.5, 0.72, -0.22, P, 0.02);
  for (const [x, z, s] of [[-8.7, -3.3, 1], [-8.9, 3.5, 0.8]]) { cyl(0.26 * s, 0.2 * s, 0.4 * s, C.brick, x, 0, z, P, 12); blob(1.1 * s, 1.1 * s, x, z, P); ball(0.42 * s, '#57a05a', x, 0.72 * s, z, P, 12); ball(0.3 * s, '#6fba62', x + 0.2 * s, 1.0 * s, z + 0.1, P, 10); }
  cyl(0.05, 0.07, 2.6, C.ink, -8.7, 0, -0.9, P, 8); ball(0.2, flat('#ffe2a0', { toneMapped: false }), -8.7, 2.7, -0.9, P, 12).castShadow = false;
  tapOf([pave], 'line');
  target('line', 'line', null, V(LINE_X, 1.0, 2.2), V(-5.25, 0, 2.2), 'The line');

  /* ---------- the kitchen: four Stations along the top wall, Chefs in the galley behind them ---------- */
  let cx = -5.4;
  for (const x of [...STATIONS.map(s => s.x), null]) { const x1 = x === null ? 4.6 : x - 0.65; if (x1 > cx) counter(cx, x1, -3.5, -2.7); cx = (x ?? 0) + 0.65; }
  L.stoves = STATIONS.map((s, j) => {
    const x = s.x;
    blob(2.0, 1.5, x, STOVE_Z, P);
    const body = rbox(1.3, COUNTER_H, 0.8, s.color, x, 0, STOVE_Z, P);
    const signM = add(new THREE.PlaneGeometry(1.12, 0.35), flat('#ffffff', { map: T.stationSign[j], toneMapped: false }), x, 0.4, -2.692, P, false);
    rbox(0.7, 0.05, 0.05, C.cream, x, 0.72, -2.67, P, 0.02);
    const hob = rbox(1.2, 0.04, 0.72, C.ink, x, COUNTER_H, STOVE_Z, P, 0.02);
    const burner = cyl(0.3, 0.3, 0.025, flat('#ff8a3a', { unique: true, transparent: true, opacity: 0 }), x - 0.12, COUNTER_H + 0.04, STOVE_Z, P, 20);
    const glow = plane(1.5, 1.5, flat('#ffffff', { map: T.glow, transparent: true, opacity: 0, depthWrite: false, unique: true }), x - 0.12, COUNTER_H + 0.07, STOVE_Z, P);
    const pot = new THREE.Group(); pot.position.set(x - 0.12, COUNTER_H + 0.05, STOVE_Z); P.add(pot);
    const potBody = cyl(0.32, 0.28, 0.36, steel, 0, 0, 0, pot, 22);
    const rim = add(new THREE.TorusGeometry(0.325, 0.035, 8, 24), toon(C.steelDark), 0, 0.36, 0, pot); rim.rotation.x = Math.PI / 2;
    for (const sd of [-1, 1]) rbox(0.12, 0.05, 0.1, C.ink, 0.38 * sd, 0.24, 0, pot, 0.02);
    const soup = cyl(0.29, 0.29, 0.03, toon(s.color, { key: 'soup' }), 0, 0.36, 0, pot, 20); soup.castShadow = false; soup.visible = false;
    const spoon = rbox(0.04, 0.5, 0.04, woodTop, 0.12, 0.2, 0.05, pot, 0.015); spoon.rotation.z = -0.35; spoon.visible = false;
    const smokeM = flat('#3a2a2a', { unique: true, transparent: true, opacity: 0 });
    rbox(0.34, 0.03, 0.44, '#b9d7d2', x + 0.42, COUNTER_H + 0.04, STOVE_Z, P, 0.01);
    tapOf([body, hob, pot, signM], `station:${s.id}`);
    target(`station:${s.id}`, 'station', s.id, V(x, COUNTER_H + 0.5, STOVE_Z), V(x, 0, BAR_Z1 + 0.42), `${s.name} station`);
    return { def: s, x, pot, soup, spoon, burner, glow, smokeM, heat: 0, squash: 0, squashV: 0, potPos: V(x - 0.12, COUNTER_H + 0.5, STOVE_Z), ticketPos: V(x + 0.42, COUNTER_H + 0.1, STOVE_Z), stand: V(x, 0, GALLEY_Z), burnT: 0 };
  });

  /* ---------- the long counter: ticket rail on the left, the brass Pass under its warm glow on the right ---------- */
  const railMeshes = counter(-5.4, -1.25, BAR_Z0, BAR_Z1);
  const railBar = rbox(4.0, 0.06, 0.06, C.steelDark, -3.3, COUNTER_H + 0.5, BAR_Z0 + 0.12, P, 0.02);
  for (const x of [-5.25, -1.35]) rbox(0.07, 0.56, 0.07, C.steelDark, x, COUNTER_H, BAR_Z0 + 0.12, P, 0.02);
  const passMeshes = counter(-1.25, 4.6, BAR_Z0, BAR_Z1, toon(C.brass));
  plane(5.6, 1.3, flat('#ffffff', { map: T.glow, transparent: true, opacity: 0.4, depthWrite: false }), 1.7, COUNTER_H + 0.012, BAR_ZC, P).renderOrder = 2;
  for (let i = 0; i < PASS_N; i++) { const d = cyl(0.3, 0.3, 0.012, '#c48f2e', PASS_X(i), COUNTER_H + 0.004, BAR_ZC, P, 20); d.castShadow = false; passMeshes.push(d); }
  const bell = cyl(0.05, 0.14, 0.11, C.brass, 4.3, COUNTER_H + 0.01, BAR_ZC + 0.12, P, 12); ball(0.04, C.brass, 4.3, COUNTER_H + 0.14, BAR_ZC + 0.12, P);
  tapOf([...railMeshes, railBar], 'rail'); tapOf([...passMeshes, bell], 'pass');
  target('rail', 'rail', null, V(-3.3, COUNTER_H + 0.5, BAR_ZC), V(-3.3, 0, BAR_Z1 + 0.42), 'Ticket rail');
  target('pass', 'pass', null, V(1.7, COUNTER_H + 0.3, BAR_ZC), V(1.7, 0, BAR_Z1 + 0.42), 'The Pass');
  stencil(T.sRail, -3.3, -0.45, 1.9); stencil(T.sPass, 1.7, -0.45, 1.9); stencil(T.sLine, -5.0, 0.9, 1.3).rotation.z = Math.PI / 2;

  /* ---------- two tables ---------- */
  L.tables = TABLES.map((t, i) => {
    blob(2.2, 2.2, t.x, t.z, P);
    const leg = cyl(0.1, 0.16, 0.7, C.woodDark, t.x, 0, t.z, P, 10); cyl(0.36, 0.4, 0.06, C.woodDark, t.x, 0, t.z, P, 14);
    const top = cyl(0.74, 0.74, 0.08, toon('#ffffff', { map: T.cloth }), t.x, 0.7, t.z, P, 28);
    const chair = rbox(0.56, 0.42, 0.5, C.red, t.x, 0, t.z - 0.92, P, 0.08); const back = rbox(0.56, 0.7, 0.12, C.redDark, t.x, 0.3, t.z - 1.14, P, 0.05);
    const vase = cyl(0.06, 0.08, 0.16, C.teal, t.x + 0.45, 0.78, t.z - 0.3, P, 10); ball(0.08, i ? '#f2b23a' : '#ee8fa6', t.x + 0.45, 1.0, t.z - 0.3, P, 8);
    const numTex = (T[`num${i}`] ||= canvasTex(64, 64, (g) => { g.fillStyle = '#3a241c'; g.beginPath(); g.arc(32, 32, 30, 0, 7); g.fill(); g.fillStyle = '#ffd75e'; g.font = '700 40px Rubik, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(String(i + 1), 32, 35); }));
    const tent = add(new THREE.PlaneGeometry(0.26, 0.26), flat('#ffffff', { map: numTex, transparent: true, toneMapped: false }), t.x - 0.47, 0.93, t.z + 0.25, P, false); tent.rotation.x = -0.5;
    stencil(T.sT[i], t.x, t.z + 1.25, 1.5);
    tapOf([top, leg, chair, back, vase, tent], `table:${i}`);
    target(`table:${i}`, 'table', i, V(t.x, 0.9, t.z), V(t.x + 1.3, 0, t.z + 0.15), `Table ${i + 1}`);
    return { ...t, seat: V(t.x, 0, t.z - 0.82), top: V(t.x, 0.8, t.z), hand: { squash: 0, squashV: 0 } };
  });

  /* ---------- the front door (right wall) and the TV beside it ---------- */
  const doorG = new THREE.Group(); P.add(doorG);
  for (const dz of [-0.72, 0.72]) rbox(0.34, 2.2, 0.2, C.cream, EXIT.x, 0, EXIT.z + dz, doorG, 0.05);
  rbox(0.4, 0.2, 1.64, C.cream, EXIT.x, 2.1, EXIT.z, doorG, 0.05);
  const leaf = new THREE.Group(); leaf.position.set(EXIT.x, 0, EXIT.z - 0.62); doorG.add(leaf);
  const leafM = rbox(0.1, 1.95, 1.24, C.teal, 0, 0.05, 0.62, leaf, 0.04); rbox(0.12, 0.7, 0.8, '#bfe3f5', 0, 1.05, 0.62, leaf, 0.03); ball(0.07, C.brass, -0.1, 0.95, 1.08, leaf, 8);
  const mat = plane(0.9, 1.2, toon('#3f9e98', { outline: false }), EXIT.x - 0.75, 0.012, EXIT.z, P); mat.receiveShadow = true;
  const exitSign = add(new THREE.PlaneGeometry(1.0, 0.31), flat('#ffffff', { map: T.exit, toneMapped: false }), EXIT.x - 0.22, 2.5, EXIT.z, P, false); exitSign.rotation.y = -Math.PI / 2 + 0.75;
  L.door = { leaf, open: 0 };
  tapOf([doorG, mat, exitSign], 'door');
  target('door', 'door', null, V(EXIT.x - 0.2, 1.2, EXIT.z), V(EXIT.x - 0.85, 0, EXIT.z), 'Front door');
  // the TV on a stand at the end of the counter
  blob(1.5, 1.0, TV.x, TV.z, P);
  const tvStand = rbox(0.14, TV.y, 0.14, C.ink, TV.x, 0, TV.z, P, 0.04); rbox(0.9, 0.08, 0.5, C.ink, TV.x, 0, TV.z, P, 0.03);
  const tvBody = rbox(TV.w + 0.16, TV.h + 0.16, 0.12, C.ink, TV.x, TV.y, TV.z, P, 0.05);
  const tvMat = flat('#ffffff', { map: T.tv, toneMapped: false, unique: true });
  const screen = add(new THREE.PlaneGeometry(TV.w, TV.h), tvMat, TV.x, TV.y + TV.h / 2 + 0.08, TV.z + 0.065, P, false);
  for (const m of [tvBody, screen]) { m.rotation.x = -0.18; }
  L.tv = { screen, mat: tvMat, own: null, squash: 0, squashV: 0 };
  tapOf([tvStand, tvBody, screen], 'tv');
  target('tv', 'tv', null, V(TV.x, TV.y + TV.h / 2, TV.z), V(TV.x - 0.2, 0, BAR_Z1 + 0.45), 'The TV');

  /* ---------- floor markers and the walkthrough's pointer ---------- */
  const mark = (w, color, opts = {}) => { const m = plane(w, w, flat(color, { map: T.ring, transparent: true, depthWrite: false, toneMapped: false, unique: true, ...opts }), 0, 0.02, 0, P); m.visible = false; m.renderOrder = 2; return m; };
  L.ring = mark(1.15, '#ffd75e'); L.dot = mark(0.5, '#ffffff', { opacity: 0.9 }); L.beaconRing = mark(1.7, '#ffe45e'); L.urgent = mark(1.5, '#ff5a3c');
  L.beacon = new THREE.Group(); L.beacon.visible = false; P.add(L.beacon);
  { const gold = toon('#ffd23f', { emissive: '#ff9d1f', emissiveIntensity: 0.35, key: 'beacon' }); const tip = add(new THREE.ConeGeometry(0.4, 0.5, 14), gold, 0, 0.25, 0, L.beacon, false); tip.rotation.x = Math.PI; add(new THREE.CylinderGeometry(0.17, 0.17, 0.46, 14), gold, 0, 0.72, 0, L.beacon, false); }
  L.shock = plane(1, 1, flat('#ffc21f', { map: (T.shock ||= canvasTex(128, 128, (g) => { g.strokeStyle = '#fff'; g.lineWidth = 16; g.beginPath(); g.arc(64, 64, 52, 0, 7); g.stroke(); })), transparent: true, depthWrite: false, toneMapped: false, unique: true }), 0, 0.03, 0, P); L.shock.visible = false; L.shock.renderOrder = 2;

  /* ---------- the Waiter ---------- */
  const w = waiterChar({ parent: P });
  F.waiter = Object.assign(w, { path: null, moving: false, dash: 0, dashCool: 0, vx: 0, vz: 0, speed: 6.2, hold: false });
  w.g.position.set(0.2, 0, 0.3);
  F.booted = false;
  return root;
}

/** Stands the Waiter somewhere with nowhere to go: at the door for a visitor, by the Pass for the owner. */
export function placeWaiter(at, facing = 0) { const w = F.waiter; if (!w) return; w.g.position.set(at.x, 0, at.z); w.g.rotation.y = facing; w.path = null; w.moving = false; }
export const doorSpot = () => V(EXIT.x - 0.9, 0, EXIT.z);

/* ======================= meshes that come and go ======================= */
function ticketMesh(item, size) {
  const g = new THREE.Group(), st = stationDef(item.station);
  rbox(0.3, 0.4, 0.025, C.paper, 0, 0, 0, g, 0.01);
  rbox(0.3, 0.1, 0.03, st.color, 0, 0.3, 0.001, g, 0.01);
  for (let i = 0; i < 2; i++) rbox(0.2 - i * 0.05, 0.025, 0.012, '#b9a98c', -0.02, 0.2 - i * 0.07, 0.012, g, 0.004);
  if (item.redoCount) { const d = cyl(0.05, 0.05, 0.02, C.red, 0.09, 0.04, 0.02, g, 10); d.rotation.x = Math.PI / 2; d.castShadow = false; }
  rbox(0.07, 0.07, 0.05, SIZE_COLOR[size] || C.steelDark, 0, 0.4, 0, g, 0.01);
  g.rotation.x = -0.3;
  return g;
}
function plateMesh(seed, look) {
  const g = new THREE.Group();
  cyl(0.34, 0.24, 0.07, '#fffdf5', 0, 0, 0, g, 22);
  if (look === 'ready') { // covered: nobody has looked yet
    const dome = add(new THREE.SphereGeometry(0.31, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2), toon(C.steel), 0, 0.05, 0, g, false); dome.scale.y = 0.9; ball(0.055, toon(C.steelDark), 0, 0.36, 0, g, 10);
  } else {
    const food = ball(0.2, FOODS[seed % FOODS.length], 0, 0.1, 0, g, 14); food.scale.y = 0.6;
    ball(0.07, '#57b86a', 0.09, 0.2, 0.03, g, 8); ball(0.05, '#fff1d6', -0.07, 0.19, -0.05, g, 8);
    if (look === 'approved') { const flag = rbox(0.03, 0.34, 0.03, C.woodDark, -0.02, 0.1, 0, g, 0.01); rbox(0.2, 0.13, 0.02, '#57b86a', 0.08, 0.32, 0, g, 0.01); flag.castShadow = false; }
  }
  return g;
}
const hash = s => { let h = 0; for (const c of String(s)) h = (h * 31 + c.charCodeAt(0)) >>> 0; return h; };
function freeIndex(map, n) { const used = new Set(map.values()); for (let i = 0; i < n; i++) if (!used.has(i)) return i; return -1; }
const customersOf = S => [...S.line, ...S.tables.filter(Boolean)];
export const customerById = id => F.snap ? customersOf(F.snap).find(c => c.id === id) : null;
export const customerOfOrder = orderId => F.snap ? customersOf(F.snap).find(c => c.order.id === orderId) : null;
export const tableOfCustomer = id => F.snap ? F.snap.tables.findIndex(c => c?.id === id) : -1;

/* ======================= sync: bring the room in line with a snapshot ======================= */
export function syncFloor(msg) {
  if (!F.root) return;
  const S = msg.floor, P = F.root, first = !F.booted;
  F.snap = S; F.you = msg.you || F.you; if (msg.now) F.offset = msg.now - Date.now();

  // customers: in the line, at a table, or on their way out
  const seen = new Set();
  S.line.forEach((c, i) => { seen.add(c.id); customerSync(c, { line: i }, first); });
  S.tables.forEach((c, i) => { if (c && c.status !== 'left') { seen.add(c.id); customerSync(c, { table: i }, first); } });
  for (const [id, cu] of L.customers) {
    if (seen.has(id)) continue;
    L.customers.delete(id); F.targets.delete(`customer:${id}`);
    cu.route = [V(cu.ch.g.position.x + 1.1, 0, cu.ch.g.position.z + 0.2), V(DOOR_IN.x, 0, DOOR_IN.z), STREET.clone()]; cu.happy = true; kick(cu.ch, 0.5);
    L.leaving.push(cu);
  }

  // chefs
  S.chefs.forEach((chef, j) => {
    let ch = L.chefs.get(chef.id);
    if (!ch) {
      const col = CHEF_COLORS[j % CHEF_COLORS.length];
      ch = character({ apron: col, band: col, skin: ['#f3c9a0', '#94603f', '#d19c72', '#f6dcc0'][j % 4], scale: 1.3, parent: P });
      ch.home = CHEF_HOME[j % 2]; ch.g.position.set(ch.home, 0, GALLEY_Z); ch.j = j; ch.color = col;
      for (const m of [ch.torso, ch.head]) m.userData.tap = `chef:${chef.id}`;
      L.chefs.set(chef.id, ch);
      target(`chef:${chef.id}`, 'chef', chef.id, ch.g.position, V(ch.home, 0, BAR_Z1 + 0.42), `Chef ${chef.name}`);
    }
    if (ch.status !== chef.status && !first) {
      if (chef.status === 'cooking') kick(ch, 0.3);
      if (chef.status === 'plating') { kick(ch, 0.45); }
    }
    ch.status = chef.status; ch.data = chef;
  });
  for (const [id, ch] of L.chefs) if (!S.chefs.some(c => c.id === id)) { disposeTree(ch.g); L.chefs.delete(id); F.targets.delete(`chef:${id}`); }

  // tickets: on the rail while queued, clipped by the stove while a Chef has them
  const wantT = new Set();
  for (const item of Object.values(S.items)) {
    if (!['queued', 'waiting_stove', 'cooking', 'burnt'].includes(item.status)) continue;
    wantT.add(item.id);
    let t = L.tickets.get(item.id);
    const key = `${item.station}|${item.redoCount}`;
    if (t && t.key !== key) { const g = ticketMesh(item, t.size); g.position.copy(t.g.position); disposeTree(t.g); P.add(g); t.g = g; t.mv.g = g; t.key = key; kick(t.mv, 0.4); }
    if (!t) {
      const size = customersOf(S).find(c => c.id === item.customerId)?.order.size;
      const g = ticketMesh(item, size); P.add(g);
      const tb = tableOfCustomer(item.customerId); if (!first && tb >= 0) g.position.copy(L.tables[tb].top);
      t = { g, key, mv: mover(g), size }; if (!first && tb >= 0) t.mv.key = 'table';
      L.tickets.set(item.id, t);
    }
    t.item = item;
  }
  for (const [id, t] of L.tickets) if (!wantT.has(id)) { disposeTree(t.g); L.tickets.delete(id); }

  // plates: on the Pass until served, then on the table until the Customer has eaten
  const wantP = new Set();
  for (const id of [...L.passSlot.keys()]) if (!S.pass.includes(id)) L.passSlot.delete(id);
  for (const id of S.pass) if (!L.passSlot.has(id)) { const i = freeIndex(L.passSlot, PASS_N); L.passSlot.set(id, i < 0 ? hash(id) % PASS_N : i); }
  for (const meal of Object.values(S.meals)) {
    const item = S.items[meal.itemId]; if (!item) continue;
    const onPass = S.pass.includes(meal.id);
    const cust = customersOf(S).find(c => c.id === item.customerId);
    const onTable = !onPass && item.status === 'served' && cust && cust.table != null && ['eating', 'awaiting_player'].includes(cust.status) && item.mealId === meal.id;
    if (!onPass && !onTable) continue;
    wantP.add(meal.id);
    const look = onTable ? 'sampled' : item.status === 'approved' ? 'approved' : item.status === 'sampled' ? 'sampled' : 'ready';
    let p = L.plates.get(meal.id);
    if (p && p.look !== look) {
      const g = plateMesh(hash(meal.id), look); g.position.copy(p.g.position); disposeTree(p.g); P.add(g); p.g = g; p.mv.g = g; kick(p.mv, 0.45);
      if (look === 'approved' && !first) spawn('star', g.position.clone().add(V(0, 0.4, 0)), ['#ffd75e', '#fff1b0'], { n: 10, up: 1.6, out: 1.8, life: 0.7, grow: 0 });
      p.look = look;
    }
    if (!p) {
      const g = plateMesh(hash(meal.id), look); P.add(g);
      p = { g, look, mv: mover(g), id: meal.id };
      const stove = L.stoves.find(s => s.def.id === item.station);
      if (!first && onPass && stove) { g.position.copy(stove.potPos); p.mv.key = 'stove'; kick(stove, 0.4); }
      L.plates.set(meal.id, p);
      if (!first && onPass) emit('sfx', 'ding');
    }
    p.where = onTable ? `table${cust.table}` : `pass${L.passSlot.get(meal.id)}`;
    p.slot = onTable ? S.tables[cust.table].order.itemIds.filter(i => S.items[i]?.status === 'served').indexOf(item.id) : 0;
    p.meal = meal; p.item = item;
    if (onPass) { tapOf([p.g], `meal:${meal.id}`); target(`meal:${meal.id}`, 'meal', meal.id, p.g.position, V(PASS_X(L.passSlot.get(meal.id)), 0, BAR_Z1 + 0.42), 'A Meal on the Pass'); }
    else { tapOf([p.g], `table:${cust.table}`); F.targets.delete(`meal:${meal.id}`); }
  }
  for (const [id, p] of L.plates) if (!wantP.has(id)) { spawn('puff', p.g.position, '#ffffff', { n: 4 }); disposeTree(p.g); L.plates.delete(id); F.targets.delete(`meal:${id}`); }

  // score events float up from where they happened
  for (const pop of S.pops || []) {
    if (L.popSeen.has(pop.id)) continue;
    L.popSeen.add(pop.id);
    if (first) continue;
    const text = `${pop.points > 0 ? '+' : ''}${pop.points}${pop.text ? ' ' + pop.text.toUpperCase() : ''}`;
    popup(text, anchorPos(pop.anchor).clone().add(V(0, 0.9, 0)), pop.points >= 0 ? 'good' : 'bad');
    if (pop.points >= 20) emit('sfx', 'coin');
  }
  F.cooking = S.chefs.filter(c => c.status === 'cooking').length;
  F.booted = true;
}

function customerSync(c, where, first) {
  let cu = L.customers.get(c.id);
  if (!cu) {
    const ch = customerChar(c.look ?? hash(c.id), F.root);
    for (const m of [ch.torso, ch.head]) m.userData.tap = `customer:${c.id}`;
    cu = { ch, route: null, where: null, sit: 0 };
    const spot = where.line !== undefined ? V(LINE_X, 0, LINE_Z(where.line)) : L.tables[where.table].seat;
    if (first) ch.g.position.copy(spot); else ch.g.position.copy(STREET);
    ch.g.rotation.y = where.line !== undefined ? Math.PI / 2 : 0;
    L.customers.set(c.id, cu);
  }
  const key = where.line !== undefined ? `line${where.line}` : `table${where.table}`;
  if (cu.where !== key) {
    const spot = where.line !== undefined ? V(LINE_X, 0, LINE_Z(where.line)) : L.tables[where.table].seat;
    const at = cu.ch.g.position;
    if (first || at.distanceTo(spot) < 0.05) { at.copy(spot); cu.route = null; }
    else if (where.table !== undefined) { cu.route = [V(LINE_X, 0, DOOR_IN.z), DOOR_IN.clone(), V(spot.x + 0.95, 0, spot.z + 0.1), spot.clone()].filter((p, i) => i > 1 || at.x < -6.2); if (!first) emit('sfx', 'door'); }
    else cu.route = [spot.clone()];
    cu.where = key;
  }
  if (cu.status !== c.status && !first) {
    if (c.status === 'awaiting_player') { kick(cu.ch, 0.5); emit('sfx', 'ask'); }
    if (c.status === 'paying') { kick(cu.ch, 0.6); }
  }
  cu.status = c.status; cu.data = c; cu.table = where.table ?? null; cu.lineIndex = where.line ?? null;
  const tKey = `customer:${c.id}`;
  if (where.line !== undefined) target(tKey, 'customer', c.id, cu.ch.g.position, V(-5.25, 0, Math.max(-0.3, Math.min(3.0, LINE_Z(where.line)))), c.name);
  else { F.targets.delete(tKey); for (const m of [cu.ch.torso, cu.ch.head]) m.userData.tap = `table:${where.table}`; }
}

/** Where a score event, a notification or the walkthrough points: a key from the server or one of ours. */
export function anchorPos(anchor) {
  const a = String(anchor || '');
  const t = F.targets.get(a); if (t) return t.pos;
  if (a === 'pass' || a === 'rail' || a === 'line' || a === 'tv' || a === 'door') return F.targets.get(a).pos;
  let m = /^table[:\s-]?(\d)/.exec(a); if (m && L.tables[+m[1]]) return L.tables[+m[1]].top;
  if (L.plates.has(a)) return L.plates.get(a).g.position;
  if (L.tickets.has(a)) return L.tickets.get(a).g.position;
  if (L.customers.has(a)) return L.customers.get(a).ch.g.position;
  if (L.chefs.has(a)) return L.chefs.get(a).g.position;
  const S = F.snap;
  if (S?.meals[a]) return anchorPos(S.meals[a].itemId);
  if (S?.items[a]) { const tb = tableOfCustomer(S.items[a].customerId); if (tb >= 0) return L.tables[tb].top; }
  const cu = customerOfOrder(a); if (cu) return anchorPos(cu.id);
  return F.waiter?.g.position || V();
}

/* ======================= every frame ======================= */
const ringHtml = (frac, inner, cls, color) => `<span class="ic ${cls}" style="--p:${Math.round(Math.max(0, Math.min(1, frac)) * 100)}${color ? `;--c:${color}` : ''}">${inner}</span>`;
const FACE = {
  happy: '<svg viewBox="0 0 24 24"><circle cx="8.5" cy="10" r="1.7" fill="currentColor"/><circle cx="15.5" cy="10" r="1.7" fill="currentColor"/><path d="M7.5 14.5c2.4 3 6.600 3 9 0" fill="none" stroke="currentColor" stroke-width="2.200" stroke-linecap="round"/></svg>',
  flat: '<svg viewBox="0 0 24 24"><circle cx="8.5" cy="10" r="1.7" fill="currentColor"/><circle cx="15.5" cy="10" r="1.7" fill="currentColor"/><path d="M8 16h8" stroke="currentColor" stroke-width="2.200" stroke-linecap="round"/></svg>',
  sad: '<svg viewBox="0 0 24 24"><circle cx="8.5" cy="10" r="1.7" fill="currentColor"/><circle cx="15.5" cy="10" r="1.7" fill="currentColor"/><path d="M7.5 17c2.400-3 6.600-3 9 0" fill="none" stroke="currentColor" stroke-width="2.200" stroke-linecap="round"/></svg>',
  hand: '<svg viewBox="0 0 24 24"><path d="M12 3v9M8 6v7M16 6v7M5.500 12l2.500 6c1 2 2.500 3 4.500 3s4-1.500 4.500-4l1-6" fill="none" stroke="currentColor" stroke-width="2.400" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  eye: '<svg viewBox="0 0 24 24"><path d="M2.5 12c2.500-4.500 5.700-6.500 9.500-6.500s7 2 9.500 6.500c-2.500 4.500-5.700 6.500-9.500 6.500s-7-2-9.500-6.500z" fill="none" stroke="currentColor" stroke-width="2.400"/><circle cx="12" cy="12" r="3" fill="currentColor"/></svg>',
  tick: '<svg viewBox="0 0 24 24"><path d="M5 12.5l4.600 4.600L19 7.600" fill="none" stroke="currentColor" stroke-width="3.600" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  bell: '<svg viewBox="0 0 24 24"><path d="M6 17V11a6 6 0 0 1 12 0v6l1.500 2h-15zM10 21h4" fill="none" stroke="currentColor" stroke-width="2.400" stroke-linecap="round" stroke-linejoin="round"/></svg>',
};
/** How much patience is left, 1 (full) to 0 (empty); null when nothing is draining. */
export function patienceLeft(p) { if (!p) return null; if (p.angry) return 0; return Math.max(0, Math.min(1, 1 - (now() - p.startedAt) / p.durationMs)); }
const patienceCls = f => f === null ? '' : f <= 0 ? 'lv3' : f < 0.34 ? 'lv2' : f < 0.67 ? 'lv1' : '';
const faceFor = f => f === null || f >= 0.67 ? FACE.happy : f >= 0.34 ? FACE.flat : FACE.sad;
export const chefWords = (chef, S) => {
  const item = chef.itemId ? S.items[chef.itemId] : null;
  if (chef.status === 'waiting_stove') return 'waiting for a stove';
  if (chef.status === 'cooking') return `cooking · ${stationDef(chef.station || item?.station).name}`;
  if (chef.status === 'walking') return `off to ${stationDef(chef.station || item?.station).name}`;
  if (chef.status === 'plating') return 'plating up';
  return 'idle';
};
const tmp = V(), tmp2 = V();
let emitT = 0;

export function animateFloor(dt, t) {
  const S = F.snap; if (!F.root || !S) return;
  const nowMs = now(), w = F.waiter, onBreak = S.phase === 'break';
  emitT += dt; const tickFx = emitT > 0.1; if (tickFx) emitT = 0;
  F.cheer = Math.max(0, F.cheer - dt);

  // the Waiter
  pose(w, dt, t, { moving: w.moving, hold: w.hold, mood: F.cheer > 0 && !w.moving ? 'cheer' : 'idle', speed: w.dash > 0 ? 1.6 : 1 });
  L.dot.visible = !!w.path?.length;
  if (w.path?.length) { const end = w.path.at(-1); L.dot.position.set(end.x, 0.02, end.z); L.dot.rotation.z = t * 2; }
  const hot = F.hot && F.targets.get(F.hot);
  L.ring.visible = !!hot;
  if (hot) { L.ring.position.set(hot.access.x, 0.02, hot.access.z); L.ring.rotation.z = -t * 1.5; L.ring.scale.setScalar(1 + Math.sin(t * 6) * 0.05); }

  // stoves
  for (const st of L.stoves) {
    const chef = S.chefs.find(c => c.status === 'cooking' && (c.station || S.items[c.itemId]?.station) === st.def.id);
    const on = !!chef;
    st.heat += ((on ? 1 : 0) - st.heat) * Math.min(1, dt * 4);
    st.soup.visible = st.spoon.visible = st.heat > 0.08;
    st.burner.material.opacity = st.heat * 0.9; st.glow.material.opacity = st.heat * (0.5 + Math.sin(t * 9 + st.x) * 0.12);
    const s = spring(st, dt); st.pot.scale.set(1 - s * 0.5, 1 + s, 1 - s * 0.5);
    if (on) { st.spoon.rotation.y = t * 5; st.pot.position.y = COUNTER_H + 0.05 + Math.abs(Math.sin(t * 14 + st.x)) * 0.012; }
    if (on && tickFx && Math.random() < 0.5 && !onBreak) spawn('puff', tmp.copy(st.potPos).add(tmp2.set(0, 0.1, 0)), '#ffffff', { n: 1, up: 0.8, life: 1.1, size: 0.9, opacity: 0.5 });
    const burnt = Object.values(S.items).some(i => i.status === 'burnt' && i.station === st.def.id);
    if (burnt && tickFx) spawn('puff', tmp.copy(st.potPos), '#3a2a2a', { n: 2, up: 1.2, life: 1.2, size: 1.3, opacity: 0.8 });
  }

  // chefs
  let ci = 0;
  for (const [id, ch] of L.chefs) {
    const chef = ch.data, item = chef.itemId ? S.items[chef.itemId] : null;
    const stId = chef.station || item?.station, stove = stId && chef.status !== 'idle' ? L.stoves.find(s => s.def.id === stId) : null;
    const tx = stove ? stove.x : ch.home, dx = tx - ch.g.position.x, moving = Math.abs(dx) > 0.04;
    if (moving) { const stepX = Math.sign(dx) * Math.min(Math.abs(dx), dt * 7.5); ch.g.position.x += stepX; ch.g.rotation.y += (Math.sign(dx) * Math.PI / 2 - ch.g.rotation.y) * Math.min(1, dt * 14); }
    else ch.g.rotation.y += (0 - ch.g.rotation.y) * Math.min(1, dt * 10);
    const mood = F.cheer > 0 ? 'cheer' : chef.status === 'cooking' && !moving ? 'cooking' : chef.status === 'waiting_stove' ? 'stalled' : chef.status === 'plating' ? 'cheer' : 'idle';
    pose(ch, dt, t, { moving, mood });
    // the badge: a status ring, the name, and the model with what they are doing
    let frac = 0, cls = 'free', inner = '';
    if (chef.status === 'cooking' && item?.cookStartedAt && item.cookEndsAt) { frac = (nowMs - item.cookStartedAt) / Math.max(1, item.cookEndsAt - item.cookStartedAt); cls = 'cook'; inner = `${Math.round(Math.min(0.99, Math.max(0, frac)) * 100)}`; }
    else if (chef.status === 'waiting_stove') { cls = 'held'; inner = '…'; }
    else if (chef.status === 'plating') { cls = 'done'; frac = 1; inner = FACE.tick; }
    else if (chef.status === 'walking') { cls = 'cook'; frac = 0.02; inner = '0'; }
    const words = chefWords(chef, S);
    label(`chef${id}`, `<div class="chip ${chef.status === 'waiting_stove' ? 'wait' : ''}">${ringHtml(frac, inner, cls, ch.color)}<span class="nm"><b>${esc(chef.name)}</b><i>${esc(chef.modelLabel || '')}${chef.modelLabel ? ' · ' : ''}${esc(words)}</i></span></div>`, tmp.set(ch.g.position.x, 2.75, GALLEY_Z), { pri: 3, click: `chef:${id}`, cls: 'chefl' });
    if (chef.thought && chef.status === 'cooking') label(`thought${id}`, `<div class="thought">${esc(chef.thought)}</div>`, tmp.set(ch.g.position.x + 0.9, 2.0, GALLEY_Z), { pri: 0 });
    ci++;
  }

  // customers
  for (const [id, cu] of L.customers) customerFrame(cu, dt, t, S, nowMs);
  for (let i = L.leaving.length - 1; i >= 0; i--) {
    const cu = L.leaving[i];
    walkRoute(cu, dt, 4.2);
    pose(cu.ch, dt, t, { moving: !!cu.route, mood: 'wave' });
    if (!cu.route) { disposeTree(cu.ch.g); L.leaving.splice(i, 1); }
  }

  // tickets
  const queue = S.readyQueue || [];
  for (const [id, tk] of L.tickets) {
    const item = tk.item, qi = queue.indexOf(id);
    const chef = S.chefs.find(c => c.itemId === id);
    const stove = chef && chef.status !== 'idle' ? L.stoves.find(s => s.def.id === item.station) : null;
    let key, pos;
    if (stove && item.status !== 'queued' && item.status !== 'burnt') { key = `stove${stove.def.id}`; pos = tmp.copy(stove.ticketPos); }
    else { const i = qi < 0 ? Math.min(RAIL_N - 1, queue.length) : Math.min(qi, RAIL_N - 1); key = `rail${i}`; pos = tmp.set(RAIL_X(i), COUNTER_H + 0.1, BAR_Z0 + 0.14); }
    moveTo(tk.mv, key, pos, dt, { dur: 0.4, h: 0.7 });
  }

  // plates
  for (const [id, p] of L.plates) {
    let pos;
    if (p.where.startsWith('pass')) pos = tmp.set(PASS_X(+p.where.slice(4)), COUNTER_H + 0.03, BAR_ZC);
    else { const tb = L.tables[+p.where.slice(5)]; const a = p.slot * 2.1 + 0.6; pos = tmp.set(tb.x + Math.cos(a) * 0.36, 0.79, tb.z + Math.sin(a) * 0.3); }
    moveTo(p.mv, p.where, pos, dt, { dur: 0.5, h: 1.0 });
    if (!p.where.startsWith('pass')) continue;
    const item = S.items[p.meal.itemId] || p.item, pf = patienceLeft(p.meal.patience);
    const lv = patienceCls(pf), st = stationDef(item.station);
    const inner = item.status === 'approved' ? FACE.tick : item.status === 'sampled' ? FACE.eye : FACE.bell;
    label(`meal${id}`, `<div class="pt ${lv} ${item.status}"><span class="ic ${item.status === 'approved' ? 'done' : ''}" style="--p:${pf === null ? 100 : Math.round(pf * 100)};--c:${pf !== null && pf < 0.34 ? '#e5533d' : item.status === 'approved' ? '#57b86a' : st.color}">${inner}</span></div>`, tmp2.set(pos.x, COUNTER_H + 0.85, BAR_ZC), { pri: 2, click: `meal:${id}`, cls: 'platel' });
  }

  // the rail says how many tickets wait
  if (queue.length) label('rail', `<div class="tag">${queue.length} waiting</div>`, tmp.set(-3.3, COUNTER_H + 1.05, BAR_Z0), { pri: 0, click: 'rail' });

  // the TV bounces when a new picture goes up
  { const s = spring(L.tv, dt); L.tv.screen.scale.set(1 + s * 0.4, 1 + s * 0.4, 1); }
  // the door swings while somebody stands at it
  { const d = L.door, near = w.g.position.distanceTo(tmp.set(EXIT.x - 0.85, 0, EXIT.z)) < 1.1 ? 1 : 0; d.open += (near - d.open) * Math.min(1, dt * 6); d.leaf.rotation.y = -d.open * 1.25; }

  // the walkthrough's pointer and the most urgent thing
  const gt = F.guideTarget && F.targets.get(F.guideTarget);
  L.beacon.visible = L.beaconRing.visible = !!gt;
  if (gt) {
    L.beacon.position.set(gt.pos.x, Math.max(1.5, gt.pos.y + 1.1) + (reduceMotion ? 0 : Math.sin(t * 4) * 0.14), gt.pos.z); L.beacon.rotation.y = t * 2;
    L.beaconRing.position.set(gt.access.x, 0.027, gt.access.z); L.beaconRing.rotation.z = t * 1.2;
  }
  const ut = F.urgent && F.targets.get(F.urgent);
  L.urgent.visible = !!ut && F.urgent !== F.guideTarget;
  if (ut) { L.urgent.position.set(ut.access.x, 0.025, ut.access.z); L.urgent.rotation.z = -t * 2; L.urgent.scale.setScalar(1 + Math.sin(t * 8) * 0.08); }
  if (L.shockT < 0.6) { L.shockT += dt; const f = L.shockT / 0.6; L.shock.visible = true; L.shock.scale.setScalar(1 + f * 7); L.shock.material.opacity = 1 - f; } else L.shock.visible = false;

  // other people on this floor
  for (const [id, pv] of L.peers) {
    const g = pv.ch.g, d = tmp.set(pv.x - g.position.x, 0, pv.z - g.position.z), dist = d.length(), moving = dist > 0.06;
    if (moving) { g.position.addScaledVector(d.normalize(), Math.min(dist, dt * 7)); g.rotation.y = Math.atan2(d.x, d.z); }
    pose(pv.ch, dt, t, { moving });
    label(`peer${id}`, `<div class="who">${esc(pv.name || 'Visitor')}</div>`, tmp2.set(g.position.x, 2.45, g.position.z), { pri: 1 });
  }
}

function walkRoute(cu, dt, speed) {
  if (!cu.route) return false;
  const g = cu.ch.g, to = cu.route[0], d = tmp.set(to.x - g.position.x, 0, to.z - g.position.z), dist = d.length();
  if (dist < 0.06) { cu.route.shift(); if (!cu.route.length) cu.route = null; return !!cu.route; }
  g.position.addScaledVector(d.normalize(), Math.min(dist, dt * speed));
  const want = Math.atan2(d.x, d.z); let diff = want - g.rotation.y; while (diff > Math.PI) diff -= Math.PI * 2; while (diff < -Math.PI) diff += Math.PI * 2;
  g.rotation.y += diff * Math.min(1, dt * 14);
  return true;
}
function customerFrame(cu, dt, t, S, nowMs) {
  const c = cu.data, g = cu.ch.g, moving = walkRoute(cu, dt, 4.6);
  const seated = cu.table !== null && !moving;
  if (!moving) { const want = cu.table !== null ? 0 : Math.PI / 2; g.rotation.y += (want - g.rotation.y) * Math.min(1, dt * 10); }
  cu.sit += ((seated ? 1 : 0) - cu.sit) * Math.min(1, dt * 8);
  cu.ch.inner.position.y -= cu.sit * 0.2;
  const pf = patienceLeft(c.patience);
  const mood = F.cheer > 0 && c.status === 'paying' ? 'cheer' : c.status === 'awaiting_player' && !c.feedbackRead ? (pf !== null && pf <= 0 ? 'blocked' : 'wave') : c.status === 'eating' ? 'cooking' : c.status === 'paying' ? 'cheer' : 'idle';
  pose(cu.ch, dt, t, { moving, mood });
  cu.ch.inner.position.y -= cu.sit * 0.2;
  if (cu.lineIndex !== null) {
    const o = c.order;
    label(`cu${c.id}`, `<div class="tk"><b>#${o.number}</b><span class="sz ${o.size}">${o.size}</span></div>`, tmp.set(g.position.x, 2.05, g.position.z), { pri: 1, click: `customer:${c.id}`, cls: 'linel' });
    return;
  }
  // at a table: a face, the name, what they are waiting for, and the patience ring when it drains
  const lv = patienceCls(pf);
  const words = c.status === 'seated' ? 'ready to order' : c.status === 'waiting_food' ? 'waiting for food' : c.status === 'eating' ? 'tasting…' : c.status === 'awaiting_player' ? (c.feedbackRead ? 'your call' : 'has feedback!') : c.status === 'paying' ? 'paying' : '';
  const hand = c.status === 'awaiting_player' && !c.feedbackRead;
  const face = hand ? FACE.hand : c.feedback && !c.feedback.satisfied && c.status === 'awaiting_player' ? FACE.sad : faceFor(pf);
  label(`cu${c.id}`, `<div class="chip ${hand ? 'hand' : ''} ${lv}">${ringHtml(pf === null ? 1 : pf, face, pf !== null && pf < 0.34 ? 'ask' : 'face', pf !== null && pf < 0.34 ? '#e5533d' : hand ? '#f2b23a' : '#57b86a')}<span class="nm"><b>${esc(c.name)}</b><i>${esc(words)}</i></span></div>`, tmp.set(g.position.x, 2.3, g.position.z), { pri: hand ? 4 : 2, click: `table:${cu.table}`, cls: 'custl' });
}

/* ======================= juice ======================= */
/** An Order shipped: confetti over the table, a shockwave on the floor, everybody cheers. */
export function shipFx(table) {
  const tb = L.tables[table] || L.tables[0]; if (!tb) return;
  confetti(tb.top.clone().add(V(0, 0.9, 0)));
  spawn('star', tb.top.clone().add(V(0, 0.7, 0)), ['#ffd75e', '#fff1b0', '#8ff0a4'], { n: 18, up: 2.6, out: 3, life: 0.9, grow: 0, gravity: 3, size: 1.3, opacity: 1 });
  F.cheer = 1.6; L.shock.position.set(tb.x, 0.03, tb.z); L.shockT = 0;
  shake(0.2);
}
export function dust(n = 5) { if (F.waiter) spawn('puff', F.waiter.g.position.clone().add(V(0, 0.12, 0)), '#f3e2c0', { n, spread: 0.4, up: 0.5, out: 1.2, life: 0.45, size: 1.1, opacity: 0.7 }); }
export function bumpTv() { if (L.tv) kick(L.tv, 0.5); }
/** Puts a picture on the TV: an image or canvas texture made by tv.js, or null for the drawn stand-in. */
export function setTvTexture(tex) {
  if (!L.tv) return;
  if (L.tv.own && L.tv.own !== tex) L.tv.own.dispose();
  L.tv.own = tex; L.tv.mat.map = tex || textures().tv; L.tv.mat.needsUpdate = true; bumpTv();
}
export function redrawTv(shipped) { const T = textures(); const c = T.tv.image; paintTv(c.getContext('2d'), c.width, c.height, shipped); T.tv.needsUpdate = true; }

/* ---------- visitors' avatars ---------- */
export function syncPeers(list, selfId) {
  if (!F.root) return;
  const seen = new Set();
  for (const p of list || []) {
    if (p.id === selfId) continue;
    seen.add(p.id);
    let pv = L.peers.get(p.id);
    if (!pv) {
      const look = typeof p.look === 'object' && p.look ? p.look : { color: FOODS[hash(p.id) % FOODS.length] };
      pv = { ch: waiterChar({ color: look.color || FOODS[hash(p.id) % FOODS.length], skin: look.skin, parent: F.root }) };
      pv.ch.g.position.set(p.x, 0, p.z); L.peers.set(p.id, pv);
    }
    pv.x = p.x; pv.z = p.z; pv.name = p.name;
  }
  for (const [id, pv] of L.peers) if (!seen.has(id)) { disposeTree(pv.ch.g); L.peers.delete(id); }
}

/* ======================= layout probes for the checks ======================= */
export function probe() {
  return {
    line: { x: LINE_X }, tables: TABLES.map(t => ({ x: t.x, z: t.z })), rail: { x: -3.3, z: BAR_ZC }, pass: { x: 1.7, z: BAR_ZC },
    stations: STATIONS.map(s => ({ id: s.id, x: s.x, z: STOVE_Z })), chefs: [...L.chefs.values()].map(c => ({ x: c.g.position.x, z: c.g.position.z })),
    door: { x: EXIT.x, z: EXIT.z }, tv: { x: TV.x, z: TV.z }, customers: L.customers.size, cust: [...L.customers].map(([id, c]) => [id, +c.ch.g.position.x.toFixed(2), +c.ch.g.position.z.toFixed(2)]), tickets: L.tickets.size, plates: L.plates.size, peers: L.peers.size,
  };
}

/* ======================= dispose ======================= */
export function disposeFloor() {
  if (!F.root) return;
  if (L.tv?.own) { L.tv.own.dispose(); L.tv.own = null; }
  clearParticles(); clearLabels();
  disposeTree(F.root);
  for (const m of [L.chefs, L.customers, L.tickets, L.plates, L.passSlot, L.peers, F.targets, L.served]) m.clear();
  L.popSeen.clear(); L.leaving.length = 0; L.stoves = []; L.tables = []; L.tv = null;
  Object.assign(F, { root: null, snap: null, waiter: null, booted: false, cooking: 0, cheer: 0, guideTarget: null, hot: null, urgent: null });
}
