// The room, its stations, the people in it, and everything that moves on its own.
// Where things are is the client's business; what they are is the server's.
import { THREE, V, scene, toon, flat, add, rbox, cyl, ball, capsule, plane, blob, canvasTex, signTex, spawn, confetti, label, popup, shake } from './scene.js';
import { G, nowS, orderOf, questionFor, escalation, modelName, esc, mmss, emit, ICON, reduceMotion, quiet } from './core.js';
import { PHRASES } from './presence.js';

/* ======================= layout ======================= */
export const CHEF_X = [-3.6, -1.2, 1.2, 3.6];
export const SLOT_Z = [-2.1, -0.7, 0.7, 2.1];
export const PASS_Z = [-0.75, 0, 0.75, 1.5];
const OVEN_Z = -2.3, HATCH_Z = 2.75, COUNTER_H = 0.9;
export const JARS = [
  { cls: 'install', name: 'Install', x: 0.1, color: '#f2b23a', what: 'npm install and other package installs' },
  { cls: 'network', name: 'Network', x: 0.7, color: '#4aa3d8', what: 'curl, fetch and other network calls' },
  { cls: 'delete', name: 'Delete', x: 1.3, color: '#e5533d', what: 'rm and other deletes' },
];
const CHEF_COLORS = { pixel: '#4aa3d8', router: '#f2b23a', query: '#57b86a', stack: '#c873d6' };
const C = { cab: '#3d6475', cabDark: '#2f4f5e', cream: '#fff1d6', wood: '#d79a5b', woodDark: '#a8683a', red: '#dc4a3a', redDark: '#a9342a', steel: '#b9c4cc', steelDark: '#6d7a84', brass: '#e6b24a', brick: '#c8684a', teal: '#3f9e98', ink: '#3a241c', paper: '#fff8e6' };

/* ---------- textures ---------- */
const rnd = (() => { let s = 7; return () => (s = (s * 16807) % 2147483647) / 2147483647; })();
const floorTex = canvasTex(768, 448, (g) => {
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
const wallTex = canvasTex(512, 128, (g) => {
  for (let i = 0; i < 16; i++) for (let j = 0; j < 4; j++) {
    g.fillStyle = `hsl(${174 + rnd() * 6}, ${38 + rnd() * 6}%, ${j === 0 ? 62 : 50 + rnd() * 5}%)`;
    g.fillRect(i * 32 + (j % 2 ? 16 : 0) - 32, j * 32, 64, 32); g.fillRect(i * 32 + (j % 2 ? 16 : 0), j * 32, 31, 31);
  }
  g.fillStyle = '#fff1d6'; g.fillRect(0, 28, 512, 5);
  g.strokeStyle = 'rgba(20,60,60,.35)'; g.lineWidth = 2;
  for (let j = 0; j <= 4; j++) { g.beginPath(); g.moveTo(0, j * 32); g.lineTo(512, j * 32); g.stroke(); }
  for (let j = 1; j < 4; j++) for (let i = 0; i <= 16; i++) { const x = i * 32 + (j % 2 ? 16 : 0); g.beginPath(); g.moveTo(x, j * 32); g.lineTo(x, j * 32 + 32); g.stroke(); }
});
const woodTex = canvasTex(256, 64, (g) => {
  for (let i = 0; i < 8; i++) { g.fillStyle = `hsl(${28 + rnd() * 6}, ${58 + rnd() * 8}%, ${58 + rnd() * 9}%)`; g.fillRect(i * 32, 0, 32, 64); }
  g.strokeStyle = 'rgba(110,60,25,.4)'; g.lineWidth = 2;
  for (let i = 0; i <= 8; i++) { g.beginPath(); g.moveTo(i * 32, 0); g.lineTo(i * 32, 64); g.stroke(); }
});
const cobbleTex = canvasTex(256, 256, (g) => {
  g.fillStyle = '#6f5d74'; g.fillRect(0, 0, 256, 256);
  for (let j = 0; j < 8; j++) for (let i = 0; i < 5; i++) {
    g.fillStyle = `hsl(${275 + rnd() * 20}, 13%, ${50 + rnd() * 9}%)`;
    g.beginPath(); g.roundRect(i * 56 + (j % 2 ? 28 : 0) - 26, j * 32 + 3, 50, 26, 9); g.fill();
  }
}, { repeat: [1.6, 4.2] });
const groundTex = canvasTex(256, 256, (g) => {
  const grd = g.createRadialGradient(128, 128, 20, 128, 128, 128);
  grd.addColorStop(0, '#6b4a5c'); grd.addColorStop(0.45, '#46303f'); grd.addColorStop(1, '#1c1420');
  g.fillStyle = grd; g.fillRect(0, 0, 256, 256);
});
const beltTex = canvasTex(64, 32, (g) => { g.fillStyle = '#3b3340'; g.fillRect(0, 0, 64, 32); g.fillStyle = '#554a5c'; g.fillRect(0, 0, 10, 32); g.fillRect(32, 0, 10, 32); }, { repeat: [5, 1] });

const woodTop = toon('#ffffff', { map: woodTex });
const wallMat = toon('#ffffff', { map: wallTex });
const steel = toon(C.steel), ink = toon(C.ink);

/* ---------- shell ---------- */
plane(70, 50, flat('#ffffff', { map: groundTex, toneMapped: false }), 0, -0.03, 0);
const floor = plane(12, 7, toon('#ffffff', { map: floorTex, outline: false }), 0, 0, 0);
floor.receiveShadow = true; floor.userData.floor = true;
const galley = plane(12.3, 1.5, toon('#8a6a62', { outline: false }), 0.15, 0, -4.2); galley.receiveShadow = true;
const street = plane(3.6, 9.2, toon('#ffffff', { map: cobbleTex, outline: false }), -7.8, -0.01, -0.4); street.receiveShadow = true;
plane(1.5, 6.4, toon('#e8d9b8', { outline: false }), -7.1, 0, 0).receiveShadow = true;   // pavement the customers stand on

// back wall with a shelf of pans and jars
const backWall = rbox(12.9, 2.55, 0.32, wallMat, 0.15, 0, -5.1, scene, 0.05);
rbox(12.9, 0.16, 0.42, C.cream, 0.15, 2.5, -5.1);
rbox(7.6, 0.08, 0.34, woodTop, -1.4, 1.78, -4.82);
for (const [x, col, r, h] of [[-4.6, '#e5533d', 0.15, 0.3], [-4.2, '#f2b23a', 0.12, 0.22], [-3.0, C.cream, 0.16, 0.34], [-2.55, '#57b86a', 0.11, 0.2], [-0.2, '#4aa3d8', 0.15, 0.28], [0.25, C.cream, 0.11, 0.2], [1.9, '#f2b23a', 0.16, 0.32]]) {
  cyl(r, r, h, col, x, 1.86, -4.8); cyl(r * 0.8, r * 0.8, 0.05, C.woodDark, x, 1.86 + h, -4.8);
}
for (const x of [-1.7, -1.2]) { const pan = cyl(0.2, 0.17, 0.06, C.steelDark, x, 1.3, -4.9, scene, 16); pan.rotation.x = Math.PI / 2; rbox(0.05, 0.3, 0.04, C.ink, x, 1.42, -4.9); }
// window in the back wall, warm evening outside
rbox(2.3, 1.2, 0.1, C.cream, 4.0, 1.05, -4.97, scene, 0.05);
add(new THREE.PlaneGeometry(2.0, 0.95), flat('#ffffff', { toneMapped: false, map: canvasTex(128, 64, (g) => { const s = g.createLinearGradient(0, 0, 0, 64); s.addColorStop(0, '#f6a85e'); s.addColorStop(0.6, '#f9d08a'); s.addColorStop(1, '#fbe6b3'); g.fillStyle = s; g.fillRect(0, 0, 128, 64); g.fillStyle = '#e98a52'; g.beginPath(); g.arc(88, 44, 14, 0, 7); g.fill(); g.fillStyle = '#7a5a7a'; g.fillRect(0, 50, 128, 14); g.fillRect(14, 36, 16, 20); g.fillRect(40, 42, 22, 12); }) }), 4.0, 1.65, -4.91, scene, false);
rbox(0.07, 1.0, 0.06, C.cream, 4.0, 1.15, -4.9); rbox(2.1, 0.07, 0.06, C.cream, 4.0, 1.62, -4.9);

// right wall behind the oven and the pass
rbox(0.32, 2.0, 7.3, wallMat, 6.2, 0, -1.45, scene, 0.05);
rbox(0.42, 0.14, 7.3, C.cream, 6.2, 1.96, -1.45);
rbox(0.34, 2.0, 0.34, C.cream, 6.2, 0, 3.6);
// front and left edges, kept low so nothing hides behind them
const frontWall = [rbox(12.9, 0.42, 0.3, C.brick, 0.15, 0, 3.66), rbox(12.9, 0.08, 0.38, C.cream, 0.15, 0.42, 3.66)];
rbox(0.36, 2.3, 0.36, C.cream, -6.18, 0, -3.7); rbox(0.36, 1.25, 0.36, C.cream, -6.18, 0, 3.6);

function counter(x0, x1, z0, z1, top = woodTop, body = C.cab) {
  const w = x1 - x0, d = z1 - z0, cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
  blob(w + 0.7, d + 0.7, cx, cz);
  rbox(w, 0.12, d, C.cabDark, cx, 0, cz, scene, 0.03);
  const b = rbox(w, COUNTER_H - 0.2, d, body, cx, 0.1, cz);
  const t = rbox(w + 0.06, 0.12, d + 0.06, top, cx, COUNTER_H - 0.12, cz, scene, 0.05);
  return [b, t];
}

/* ======================= stations ======================= */
export const stations = [];
function station(def) {
  stations.push(def);
  for (const m of def.meshes || []) m.traverse(o => { o.userData.station = def; });
  return def;
}
export const stationById = id => stations.find(s => s.id === id);

// order window along the left wall
const awningTex = canvasTex(64, 256, (g) => { for (let i = 0; i < 16; i++) { g.fillStyle = i % 2 ? '#fff1d6' : '#dc4a3a'; g.fillRect(0, i * 16, 64, 16); } });
const windowMeshes = counter(-6.0, -5.4, -3.5, 3.5, toon('#ffffff', { map: awningTex }));
SLOT_Z.forEach((z, i) => {
  const mat = rbox(0.5, 0.025, 0.66, C.ink, -5.68, COUNTER_H, z, scene, 0.01);
  const bell = cyl(0.03, 0.1, 0.09, C.brass, -5.78, COUNTER_H + 0.01, z - 0.45, scene, 12);
  ball(0.035, C.brass, -5.78, COUNTER_H + 0.12, z - 0.45);
  station({ id: `slot${i}`, type: 'slot', i, top: V(-5.68, COUNTER_H + 0.03, z), access: [V(-5.05, 0, z)], ring: V(-5.05, 0, z), stand: V(-6.85, 0, z), back: V(-7.7, 0, z + 0.7), meshes: [mat, bell] });
});
for (const m of windowMeshes) m.userData.windowCounter = true;

// the line: four stoves along the back, chefs in the galley behind them
let cx = -5.4;
for (const x of [...CHEF_X, null]) { const x1 = x === null ? 5.3 : x - 0.65; if (x1 > cx) counter(cx, x1, -3.5, -2.7); cx = (x ?? 0) + 0.65; }
const glowTex = canvasTex(64, 64, (g) => { const r = g.createRadialGradient(32, 32, 2, 32, 32, 32); r.addColorStop(0, 'rgba(255,170,70,.95)'); r.addColorStop(1, 'rgba(255,120,40,0)'); g.fillStyle = r; g.fillRect(0, 0, 64, 64); });
export const chefStations = CHEF_X.map((x, j) => {
  blob(2.0, 1.5, x, -3.1);
  const body = rbox(1.3, COUNTER_H, 0.8, C.red, x, 0, -3.1);
  rbox(0.9, 0.42, 0.04, C.redDark, x, 0.2, -2.69, scene, 0.03);
  rbox(0.7, 0.05, 0.05, C.cream, x, 0.68, -2.67, scene, 0.02);
  for (const dx of [-0.45, 0.45]) { const k = cyl(0.05, 0.05, 0.05, C.cream, x + dx, 0.74, -2.69, scene, 10); k.rotation.x = Math.PI / 2; }
  const hob = rbox(1.2, 0.04, 0.72, C.ink, x, COUNTER_H, -3.1, scene, 0.02);
  const burner = cyl(0.3, 0.3, 0.025, flat('#ff8a3a', { unique: true, transparent: true, opacity: 0 }), x - 0.12, COUNTER_H + 0.04, -3.1, scene, 20);
  const glow = plane(1.5, 1.5, flat('#ffffff', { map: glowTex, transparent: true, opacity: 0, depthWrite: false, unique: true }), x - 0.12, COUNTER_H + 0.07, -3.1);
  // the pot
  const pot = new THREE.Group(); pot.position.set(x - 0.12, COUNTER_H + 0.05, -3.1); scene.add(pot);
  const potBody = cyl(0.32, 0.28, 0.36, steel, 0, 0, 0, pot, 22);
  const rim = add(new THREE.TorusGeometry(0.325, 0.035, 8, 24), toon(C.steelDark), 0, 0.36, 0, pot); rim.rotation.x = Math.PI / 2;
  cyl(0.29, 0.29, 0.012, '#4a4048', 0, 0.356, 0, pot, 20).castShadow = false;
  for (const s of [-1, 1]) rbox(0.12, 0.05, 0.1, C.ink, 0.38 * s, 0.24, 0, pot, 0.02);
  const soup = cyl(0.29, 0.29, 0.03, toon('#e98f3c', { key: `soup${j}` }).clone(), 0, 0.36, 0, pot, 20); soup.castShadow = false; soup.visible = false;
  const lid = new THREE.Group(); lid.position.set(0, 0.4, 0); pot.add(lid);
  cyl(0.35, 0.36, 0.05, C.steelDark, 0, 0, 0, lid, 22); ball(0.07, C.ink, 0, 0.1, 0, lid, 10);
  lid.visible = false;
  const spoon = rbox(0.04, 0.5, 0.04, woodTop, 0.12, 0.2, 0.05, pot, 0.015); spoon.rotation.z = -0.35; spoon.visible = false;
  // what a chef left waiting too long looks like: real flames in the pot and a red wash across the floor in front of the stove
  const fire = new THREE.Group(); fire.position.set(x - 0.12, COUNTER_H + 0.34, -3.1); fire.visible = false; scene.add(fire);
  [[0, 0.36, 1.05, '#ff4a1c', 0], [-0.2, 0.2, 0.66, '#ff7a22', 0.02], [0.2, 0.21, 0.72, '#ff7a22', 0.02], [0, 0.21, 0.66, '#ffd23f', 0.12]].forEach(([dx, r, h, col, dz]) => {
    const m = add(new THREE.ConeGeometry(r, h, 9), flat(col, { toneMapped: false, transparent: true, opacity: 0.96, unique: true }), dx, h / 2, dz, fire, false); m.userData.h = h; m.renderOrder = 3;
  });
  const alarm = plane(2.6, 2.0, flat('#ff3b24', { map: glowTex, transparent: true, opacity: 0, depthWrite: false, unique: true, toneMapped: false }), x, 0.022, -2.15); alarm.renderOrder = 2;
  // a clip on the counter where the chef's ticket hangs
  rbox(0.34, 0.03, 0.44, '#b9d7d2', x + 0.42, COUNTER_H + 0.04, -3.1, scene, 0.01);
  return station({
    id: `chef${j}`, type: 'chef', j, chefId: null, top: V(x - 0.12, COUNTER_H + 0.45, -3.1), potPos: V(x - 0.12, COUNTER_H + 0.5, -3.1), ticketPos: V(x + 0.42, COUNTER_H + 0.08, -3.1),
    access: [V(x, 0, -2.35)], ring: V(x, 0, -2.35), stand: V(x, 0, -4.1), pot, soup, lid, spoon, burner, glow, fire, alarm, burn: 0, heat: 0, meshes: [body, hob, potBody, pot],
  });
});

// island: prep board and the spice rack
counter(-1.5, 1.5, 0.4, 1.4);
const board = rbox(0.74, 0.05, 0.56, '#f3d9a4', -0.85, COUNTER_H + 0.01, 0.9, scene, 0.03);
const knife = rbox(0.05, 0.02, 0.36, C.steel, -0.38, COUNTER_H + 0.01, 0.9, scene, 0.008); rbox(0.055, 0.035, 0.14, C.ink, -0.38, COUNTER_H + 0.01, 1.15, scene, 0.01);
export const prepSt = station({ id: 'prep', type: 'prep', top: V(-0.85, COUNTER_H + 0.08, 0.9), access: [V(-0.85, 0, 1.75), V(-0.85, 0, 0.05)], ring: V(-0.85, 0, 1.75), meshes: [board, knife] });
const rack = rbox(1.7, 0.06, 0.4, C.woodDark, 0.7, COUNTER_H, 0.9, scene, 0.02);
export const jarStations = JARS.map(def => {
  const g = new THREE.Group(); g.position.set(def.x, COUNTER_H + 0.06, 0.9); scene.add(g);
  const glass = cyl(0.15, 0.17, 0.3, def.color, 0, 0, 0, g, 14);
  cyl(0.155, 0.175, 0.08, C.cream, 0, 0.09, 0, g, 14);
  const cap = cyl(0.12, 0.15, 0.09, C.steel, 0, 0.3, 0, g, 12);
  for (const [a, b] of [[-0.05, -0.03], [0.05, -0.03], [0, 0.05]]) cyl(0.018, 0.018, 0.01, C.ink, a, 0.386, b, g, 6);
  const halo = cyl(0.2, 0.2, 0.02, flat('#ffd75e', { unique: true, transparent: true, opacity: 0 }), 0, -0.02, 0, g, 18); halo.castShadow = false;
  return station({ id: `jar-${def.cls}`, type: 'jar', def, cls: def.cls, home: V(def.x, COUNTER_H + 0.06, 0.9), top: V(def.x, COUNTER_H + 0.5, 0.9), access: [V(def.x, 0, 1.75), V(def.x, 0, 0.05)], ring: V(def.x, 0, 1.75), g, halo, mv: mover(g), meshes: [glass, cap, g] });
});

// oven, with the re-fire lever
counter(5.3, 6.0, -3.5, -2.98);
blob(1.5, 1.9, 5.65, OVEN_Z);
const ovenBody = rbox(0.74, 1.5, 1.24, '#5b6f86', 5.65, 0, OVEN_Z, scene, 0.08);
rbox(0.06, 0.2, 1.1, C.ink, 5.29, 1.22, OVEN_Z, scene, 0.02);
const ovenWindowMat = flat('#2a1c22', { unique: true });
const ovenDoor = new THREE.Group(); ovenDoor.position.set(5.27, 0.22, OVEN_Z); scene.add(ovenDoor);
rbox(0.07, 0.9, 1.06, '#46586c', 0, 0, 0, ovenDoor, 0.03);
add(new THREE.BoxGeometry(0.02, 0.5, 0.74), ovenWindowMat, -0.045, 0.5, 0, ovenDoor, false);
rbox(0.06, 0.05, 0.8, C.cream, -0.07, 0.82, 0, ovenDoor, 0.02);
const ovenInside = add(new THREE.BoxGeometry(0.5, 0.8, 0.98), flat('#ff9a3d', { unique: true, transparent: true, opacity: 0 }), 5.6, 0.68, OVEN_Z, scene, false);
const lampMat = flat('#55505a', { unique: true });
const ovenLamp = ball(0.13, lampMat, 5.36, 1.58, OVEN_Z - 0.36, scene, 14); ovenLamp.castShadow = false;
cyl(0.15, 0.17, 0.06, C.ink, 5.36, 1.5, OVEN_Z - 0.36, scene, 14);
const leverBase = rbox(0.3, 0.1, 0.22, C.ink, 5.42, 1.5, OVEN_Z + 0.34, scene, 0.03);
const lever = new THREE.Group(); lever.position.set(5.42, 1.58, OVEN_Z + 0.34); scene.add(lever);
rbox(0.05, 0.34, 0.05, C.steel, 0, 0, 0, lever, 0.02); const leverKnob = ball(0.085, toon(C.red, { key: 'lever' }).clone(), 0, 0.38, 0, lever, 12);
lever.scale.setScalar(1.6);
export const ovenSt = station({ id: 'oven', type: 'oven', top: V(5.5, 1.75, OVEN_Z), inside: V(5.62, 0.62, OVEN_Z), mouth: V(5.0, 0.8, OVEN_Z), access: [V(4.95, 0, OVEN_Z)], ring: V(4.95, 0, OVEN_Z), door: 0, lampT: 0, meshes: [ovenBody, ovenDoor, leverBase, lever] });

// the pass: brass, under heat lamps
const passMeshes = counter(5.3, 6.0, -1.62, 2.02, toon(C.brass));
plane(1.3, 3.9, flat('#ffffff', { map: glowTex, transparent: true, opacity: 0.4, depthWrite: false }), 5.6, COUNTER_H + 0.012, 0.37).renderOrder = 2;
// no lamps hang over the pass: from this camera anything above the counter sits in front of a plate, so the warm glow does the job alone
export const passStations = PASS_Z.map((z, i) => {
  const dot = cyl(0.3, 0.3, 0.012, '#c48f2e', 5.65, COUNTER_H + 0.004, z, scene, 20); dot.castShadow = false;
  return station({ id: `pass${i}`, type: 'pass', i, top: V(5.65, COUNTER_H + 0.05, z), access: [V(4.95, 0, z)], ring: V(4.95, 0, z), meshes: [dot] });
});
for (const m of passMeshes) m.userData.passCounter = true;

// the hatch: a belt out through the wall to main
const hatchMeshes = counter(5.3, 6.0, 2.25, 3.3, toon(C.steelDark));
blob(1.9, 1.7, 6.75, HATCH_Z);
const belt = rbox(1.0, 0.06, 0.6, toon('#ffffff', { map: beltTex }), 6.0, COUNTER_H, HATCH_Z, scene, 0.02);
for (const z of [HATCH_Z - 0.36, HATCH_Z + 0.36]) rbox(1.0, 0.1, 0.07, '#f2b23a', 6.0, COUNTER_H - 0.02, z, scene, 0.02);
let mainCount = 0;
const mainTex = signTex(256, 256, (g, w, h) => {
  g.fillStyle = '#2e8f63'; g.fillRect(0, 0, w, h); g.strokeStyle = '#fff1d6'; g.lineWidth = 10; g.strokeRect(12, 12, w - 24, h - 24);
  g.fillStyle = '#fff1d6'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.font = '58px Bungee, Impact, sans-serif'; g.fillText((G.S?.mainBranch || 'main').toUpperCase().slice(0, 6), w / 2, 92);
  g.font = '700 34px Rubik, sans-serif'; g.fillStyle = '#ffd75e'; g.fillText(G.S?.commits != null ? `${mainCount} commit${mainCount === 1 ? '' : 's'}` : `${mainCount} shipped`, w / 2, 168);
});
// main is a crate that jumps every time something lands in it
const mainG = new THREE.Group(); mainG.position.set(7.0, 0, HATCH_Z); scene.add(mainG);
const mainSign = rbox(1.15, 1.2, 1.3, '#2e8f63', 0, 0, 0, mainG, 0.08);
rbox(0.12, 0.34, 0.7, C.ink, 6.44, 0.82, HATCH_Z, scene, 0.03);
plane(1.0, 1.15, flat('#ffffff', { map: mainTex, toneMapped: false }), 0, 1.206, 0, mainG);
const mainSpring = { squash: 0, squashV: 0 };
export const hatchSt = station({ id: 'hatch', type: 'hatch', top: V(5.65, COUNTER_H + 0.08, HATCH_Z), out: V(6.6, COUNTER_H + 0.08, HATCH_Z), access: [V(4.95, 0, HATCH_Z)], ring: V(4.95, 0, HATCH_Z), meshes: [belt, mainSign, ...hatchMeshes] });

// bin, front left
blob(1.1, 1.1, -4.6, 3.05);
const binBody = cyl(0.36, 0.29, 0.74, '#6e8a5a', -4.6, 0, 3.05, scene, 16);
const binLid = cyl(0.39, 0.39, 0.07, '#8fae74', -4.6, 0.74, 3.05, scene, 16); ball(0.06, C.ink, -4.6, 0.84, 3.05);
export const binSt = station({ id: 'bin', type: 'bin', top: V(-4.6, 0.95, 3.05), access: [V(-4.6, 0, 2.35)], ring: V(-4.6, 0, 2.35), meshes: [binBody, binLid] });

// the door to the park: a low swing gate in the front wall, with a mat inside it. It only exists in a town.
const doorG = new THREE.Group(); doorG.visible = false; scene.add(doorG);
const DOOR_X = -3.3, DOOR_Z = 3.66;
{
  for (const dx of [-0.62, 0.62]) { rbox(0.2, 1.25, 0.34, C.cream, DOOR_X + dx, 0, DOOR_Z, doorG, 0.05); ball(0.13, flat('#ffe2a0', { toneMapped: false }), DOOR_X + dx, 1.37, DOOR_Z, doorG, 12).castShadow = false; }
  plane(1.0, 0.62, toon('#3f9e98', { outline: false }), DOOR_X, 0.012, 3.12, doorG).receiveShadow = true;        // the mat
  plane(0.74, 0.4, toon('#58b8b0', { outline: false }), DOOR_X, 0.014, 3.12, doorG);
}
const gateL = new THREE.Group(), gateR = new THREE.Group();
gateL.position.set(DOOR_X - 0.52, 0, DOOR_Z); gateR.position.set(DOOR_X + 0.52, 0, DOOR_Z); doorG.add(gateL, gateR);
const gateMeshes = [rbox(0.5, 0.62, 0.07, C.teal, 0.26, 0.16, 0, gateL, 0.04), rbox(0.5, 0.62, 0.07, C.teal, -0.26, 0.16, 0, gateR, 0.04)];
rbox(0.36, 0.08, 0.09, C.cream, 0.26, 0.6, 0, gateL, 0.03); rbox(0.36, 0.08, 0.09, C.cream, -0.26, 0.6, 0, gateR, 0.03);
// a gate seen end-on (the upright-phone camera) is too thin to tap: an unseen box around it and its mat takes the finger
const doorPick = new THREE.Mesh(new THREE.BoxGeometry(1.5, 1.3, 1.5), new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false }));
doorPick.material.userData.outlineParameters = { visible: false };
doorPick.position.set(DOOR_X, 0.65, 3.25); doorG.add(doorPick);
export const doorSt = { id: 'door', type: 'door', top: V(DOOR_X, 0.62, DOOR_Z), access: [V(DOOR_X, 0, 3.08)], ring: V(DOOR_X, 0, 3.08), swing: 0, meshes: [...gateMeshes, gateL, gateR, doorPick] };
/** A town exists: the gate appears and becomes a station. */
export function enableDoor() {
  if (doorG.visible) return;
  doorG.visible = true;
  // the front wall opens for it
  for (const m of frontWall) m.visible = false;
  for (const [x0, x1] of [[-6.3, DOOR_X - 0.6], [DOOR_X + 0.6, 6.6]]) { rbox(x1 - x0, 0.42, 0.3, C.brick, (x0 + x1) / 2, 0, 3.66); rbox(x1 - x0, 0.08, 0.38, C.cream, (x0 + x1) / 2, 0.42, 3.66); }
  station(doorSt);
  stencil('DOOR', 'to the park', DOOR_X, 2.3, 1.3);
  stencils.at(-1).visible = !world.side;
}

// signs and street dressing
function board3d(text, x, y, z, w, bg, fg = '#fff1d6') {
  const tex = signTex(256, 80, (g, cw, ch) => { g.fillStyle = bg; g.fillRect(0, 0, cw, ch); g.fillStyle = fg; g.textAlign = 'center'; g.textBaseline = 'middle'; g.font = '46px Bungee, Impact, sans-serif'; g.fillText(text, cw / 2, ch / 2 + 3); });
  rbox(w + 0.12, w * 0.3125 + 0.12, 0.08, C.ink, x, y, z, scene, 0.03);
  add(new THREE.PlaneGeometry(w, w * 0.3125), flat('#ffffff', { map: tex, toneMapped: false }), x, y + w * 0.156 + 0.06, z + 0.045, scene, false);
}
board3d('ORDERS', -7.0, 2.0, -4.25, 1.5, '#dc4a3a');
rbox(0.09, 2.0, 0.09, C.ink, -7.65, 0, -4.25); rbox(0.09, 2.0, 0.09, C.ink, -6.35, 0, -4.25);
for (const [x, z, s] of [[-8.6, -3.3, 1], [-8.9, 3.3, 0.8]]) {
  cyl(0.26 * s, 0.2 * s, 0.4 * s, C.brick, x, 0, z, scene, 12); blob(1.1 * s, 1.1 * s, x, z);
  ball(0.42 * s, '#57a05a', x, 0.72 * s, z, scene, 12); ball(0.3 * s, '#6fba62', x + 0.2 * s, 1.0 * s, z + 0.1, scene, 10);
}
// street lamp
cyl(0.05, 0.07, 2.6, C.ink, -8.7, 0, -0.9, scene, 8); ball(0.2, flat('#ffe2a0', { toneMapped: false }), -8.7, 2.7, -0.9, scene, 12).castShadow = false;

/* ---------- floor markers ---------- */
const ringTex = canvasTex(128, 128, (g) => {
  g.strokeStyle = '#fff'; g.lineWidth = 12; g.lineCap = 'round';
  for (let i = 0; i < 4; i++) { g.beginPath(); g.arc(64, 64, 48, i * Math.PI / 2 + 0.25, (i + 1) * Math.PI / 2 - 0.25); g.stroke(); }
});
export const ring = plane(1.15, 1.15, flat('#ffd75e', { map: ringTex, transparent: true, depthWrite: false, toneMapped: false }), 0, 0.02, 0); ring.visible = false; ring.renderOrder = 2;
export const targetDot = plane(0.5, 0.5, flat('#ffffff', { map: ringTex, transparent: true, depthWrite: false, opacity: 0.9, toneMapped: false }), 0, 0.02, 0); targetDot.visible = false; targetDot.renderOrder = 2;
const arrowTex = canvasTex(64, 64, (g) => { g.fillStyle = '#fff'; g.beginPath(); g.moveTo(32, 4); g.lineTo(58, 34); g.lineTo(42, 34); g.lineTo(42, 60); g.lineTo(22, 60); g.lineTo(22, 34); g.lineTo(6, 34); g.closePath(); g.fill(); });
export const arrow = plane(0.8, 0.8, flat('#ff5a3c', { map: arrowTex, transparent: true, depthWrite: false, toneMapped: false }), 0, 0.03, 0); arrow.visible = false; arrow.renderOrder = 2;
export const urgentRing = plane(1.5, 1.5, flat('#ff5a3c', { map: ringTex, transparent: true, depthWrite: false, toneMapped: false, unique: true }), 0, 0.025, 0); urgentRing.visible = false; urgentRing.renderOrder = 2;
arrow.material = arrow.material.clone();   // the floor arrow is red for trouble and gold for the walkthrough

// every station's name is stencilled on the floor in front of it, with what it really is underneath
const stencils = [];
function stencil(name, means, x, z, w = 1.7) {
  const tex = signTex(384, 128, (g, cw, ch) => {
    g.clearRect(0, 0, cw, ch); g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillStyle = 'rgba(92,46,30,.62)'; g.font = '62px Bungee, Impact, sans-serif'; g.fillText(name, cw / 2, 46);
    g.fillStyle = 'rgba(92,46,30,.7)'; g.font = '700 30px Rubik, sans-serif'; g.fillText(means, cw / 2, 100);
  });
  const m = plane(w, w / 3, flat('#ffffff', { map: tex, transparent: true, depthWrite: false }), x, 0.008, z); m.renderOrder = 1;
  stencils.push(m);
}
stencil('ORDERS', 'tasks to do', -4.0, -0.05, 1.5);
stencil('THE LINE', 'four Claude agents', 0, -1.72, 2.1);
stencil('PREP', 'plan first', -0.85, 2.25, 1.35);
stencil('SPICES', 'permissions', 0.72, 2.25, 1.35);
stencil('OVEN', 'runs the tests', 3.85, -2.25, 1.5);
stencil('PASS', 'code review', 3.85, 0.4, 1.5);
stencil('HATCH', 'git merge', 3.85, 2.78, 1.5);

/** The walkthrough's pointer: a fat gold arrow that bobs over the next thing to use, and a ring where to stand. */
export const beacon = new THREE.Group(); beacon.visible = false; scene.add(beacon);
{
  const gold = toon('#ffd23f', { emissive: '#ff9d1f', emissiveIntensity: 0.35, key: 'beacon' });
  const tip = add(new THREE.ConeGeometry(0.4, 0.5, 14), gold, 0, 0.25, 0, beacon, false); tip.rotation.x = Math.PI;
  add(new THREE.CylinderGeometry(0.17, 0.17, 0.46, 14), gold, 0, 0.72, 0, beacon, false);
}
export const beaconRing = plane(1.7, 1.7, flat('#ffe45e', { map: ringTex, transparent: true, depthWrite: false, toneMapped: false, unique: true }), 0, 0.027, 0); beaconRing.visible = false; beaconRing.renderOrder = 2;
const shockTex = canvasTex(128, 128, (g) => { g.strokeStyle = '#fff'; g.lineWidth = 16; g.beginPath(); g.arc(64, 64, 52, 0, 7); g.stroke(); });
const shock = plane(1, 1, flat('#ffc21f', { map: shockTex, transparent: true, depthWrite: false, toneMapped: false, unique: true }), 0, 0.03, 0); shock.visible = false; shock.renderOrder = 2;
let shockT = 9;

/* ======================= collision and path finding ======================= */
export const PLAYER_R = 0.3;
const BOUNDS = { x0: -5.4, x1: 5.3, z0: -2.7, z1: 3.5 };
const SOLIDS = [{ x0: -1.5, x1: 1.5, z0: 0.4, z1: 1.4 }, { x0: -4.95, x1: -4.25, z0: 2.72, z1: 3.5 }];
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
for (let x = -5; x <= 5.001; x += 0.5) for (let z = -2.25; z <= 3.2; z += 0.5) if (!blocked(x, z)) NODES.push({ x, z });
/** A* over a 0.5 grid, then pulled straight wherever there is a clear line. Returns points to walk through. */
export function findPath(from, to) {
  if (clear(from, to)) return [V(to.x, 0, to.z)];
  const start = { x: from.x, z: from.z }, goal = { x: to.x, z: to.z };
  const all = [start, ...NODES, goal], gi = all.length - 1;
  const near = (a, b) => { const d = Math.hypot(a.x - b.x, a.z - b.z); return d < 0.75 ? d : 0; };
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
      const loose = cur === 0 || j === gi;
      const d = loose ? (Math.hypot(all[cur].x - all[j].x, all[cur].z - all[j].z) < 1.1 ? Math.hypot(all[cur].x - all[j].x, all[cur].z - all[j].z) : 0) : near(all[cur], all[j]);
      if (!d || !clear(all[cur], all[j])) continue;
      if (g[cur] + d < g[j]) { g[j] = g[cur] + d; came[j] = cur; open.add(j); }
    }
  }
  if (came[gi] < 0) return [V(to.x, 0, to.z)];
  const pts = []; for (let i = gi; i > 0; i = came[i]) pts.unshift(all[i]);
  const out = []; let at = start, i = 0;
  while (i < pts.length) { let j = pts.length - 1; while (j > i && !clear(at, pts[j])) j--; out.push(V(pts[j].x, 0, pts[j].z)); at = pts[j]; i = j + 1; }
  return out;
}

/* ======================= characters ======================= */
export function character({ body = '#fffaf0', apron = null, hat = true, skin = '#f3c9a0', band = null, hair = null, scale = 1.3, scarf = null, parent = scene }) {
  const g = new THREE.Group(), inner = new THREE.Group(); g.add(inner);
  const tint = [], skinned = [];
  const shadow = blob(1.15, 1.15, 0, 0, g);
  const feet = [-1, 1].map(s => { const f = ball(0.11, C.ink, 0.15 * s, 0.07, 0.03, inner, 10); f.scale.set(1, 0.65, 1.4); return f; });
  const torso = capsule(0.31, 0.2, body, 0, 0.5, 0, inner);
  if (apron) { tint.push(rbox(0.44, 0.4, 0.1, apron, 0, 0.2, 0.25, inner, 0.05)); rbox(0.2, 0.14, 0.03, C.cream, 0, 0.3, 0.3, inner, 0.02); }
  if (scarf) { const s = cyl(0.27, 0.3, 0.1, scarf, 0, 0.72, 0, inner, 16); s.castShadow = false; tint.push(s); }
  const hg = new THREE.Group(); hg.position.set(0, 0.78, 0); hg.rotation.x = -0.38; inner.add(hg);
  const headParts = inner.children.length;
  const head = ball(0.36, skin, 0, 1.08, 0, inner, 24);
  const eyes = [-1, 1].map(s => {
    const e = ball(0.068, C.ink, 0.135 * s, 1.1, 0.318, inner, 12); e.scale.set(1, 1.3, 0.55); e.castShadow = false;
    const hl = ball(0.026, flat('#ffffff'), 0.135 * s + 0.022, 1.14, 0.352, inner, 8); hl.castShadow = false;
    return [e, hl];
  });
  for (const s of [-1, 1]) { const ch = ball(0.06, flat('#f08f86', { transparent: true, opacity: 0.75 }), 0.245 * s, 0.98, 0.262, inner, 8); ch.scale.set(1, 0.6, 0.3); ch.castShadow = false; }
  const hands = [-1, 1].map(s => ball(0.105, skin, 0.45 * s, 0.5, 0.06, inner, 12));

  if (hat) {
    cyl(0.25, 0.24, 0.3, '#ffffff', 0, 1.34, 0, inner, 18);
    const top = ball(0.31, '#ffffff', 0, 1.72, 0, inner, 16); top.scale.y = 0.72;
    if (band) tint.push(cyl(0.258, 0.25, 0.1, band, 0, 1.36, 0, inner, 18));
  } else if (hair) { const hr = ball(0.365, hair, 0, 1.15, -0.055, inner, 18); hr.scale.set(1.02, 0.92, 1); }
  // everything from the neck up tips back a little, so faces read from a camera that looks down
  for (const m of inner.children.slice(headParts).filter(m => !hands.includes(m))) { m.position.y -= 0.78; hg.add(m); }
  g.scale.setScalar(scale);
  parent.add(g);
  skinned.push(head, ...hands);
  return { g, inner, hg, head, hands, feet, eyes, torso, shadow, tint, skinned, squash: 0, squashV: 0, phase: Math.random() * 6, blink: 2 + Math.random() * 3, scale };
}
/** Recolours a chef: apron, hat band and scarf in one colour, and the skin. */
export function setLook(ch, { color, skin } = {}) {
  if (color) for (const m of ch.tint) m.material = toon(color);
  if (skin) for (const m of ch.skinned) m.material = toon(skin);
}
/** Squash and stretch: a damped spring every character and prop can be kicked with. */
export function kick(o, amount = 0.25) { o.squashV = (o.squashV || 0) - amount * 14; }
function spring(o, dt) {
  // fixed small steps: a stiff spring stepped once per slow frame blows up and scales the mesh to the size of the room
  let x = o.squash || 0, v = o.squashV || 0;
  for (let left = Math.min(dt, 0.1); left > 1e-5; left -= 1 / 240) {
    const h = Math.min(left, 1 / 240);
    v += (-x * 220 - v * 14) * h; x += v * h;
  }
  if (!Number.isFinite(x) || !Number.isFinite(v)) { x = 0; v = 0; }
  o.squash = Math.max(-0.45, Math.min(0.45, x)); o.squashV = v;
  return o.squash;
}
export function pose(ch, dt, t, { moving = false, hold = false, mood = 'idle', speed = 1 } = {}) {
  const s = spring(ch, dt);
  ch.inner.scale.set(1 - s * 0.55, 1 + s, 1 - s * 0.55);
  if (moving) ch.phase += dt * 13 * speed;
  const w = Math.sin(ch.phase), breathe = Math.sin(t * 2.2 + ch.phase) * 0.02;
  ch.inner.position.y = moving ? Math.abs(w) * 0.09 : breathe;
  // nobody stands still: heads look about, weight shifts from foot to foot, and a cook watches the pot
  const still = !moving && !reduceMotion, idle = still && (mood === 'idle' || mood === 'wave');
  const ease = Math.min(1, dt * 6);
  const lookY = !still ? 0 : mood === 'cooking' ? Math.sin(t * 1.9 + ch.phase) * 0.14 : idle ? Math.sin(t * 0.8 + ch.phase) * 0.3 + Math.sin(t * 0.33 + ch.phase * 2) * 0.22 : 0;
  ch.hg.rotation.y += (lookY - ch.hg.rotation.y) * ease;
  ch.hg.rotation.x += ((mood === 'cooking' ? -0.2 : mood === 'stalled' ? 0.12 : mood === 'cheer' ? -0.6 : -0.38) - ch.hg.rotation.x) * ease;
  ch.hg.rotation.z = !still ? 0 : idle ? Math.sin(t * 0.9 + ch.phase) * 0.06 : mood === 'blocked' ? Math.sin(t * 11) * 0.09 : 0;
  ch.inner.rotation.z = idle ? Math.sin(t * 1.1 + ch.phase) * 0.035 : 0;
  ch.torso.scale.y = still ? 1 + Math.sin(t * 2.2 + ch.phase) * 0.03 : 1;
  ch.feet[0].position.z = moving ? 0.03 + w * 0.16 : 0.03; ch.feet[1].position.z = moving ? 0.03 - w * 0.16 : 0.03;
  ch.feet[0].position.y = moving ? 0.07 + Math.max(0, w) * 0.08 : 0.07; ch.feet[1].position.y = moving ? 0.07 + Math.max(0, -w) * 0.08 : 0.07;
  const [l, r] = ch.hands;
  const set = (h, x, y, z) => { h.position.x += (x - h.position.x) * Math.min(1, dt * 16); h.position.y += (y - h.position.y) * Math.min(1, dt * 16); h.position.z += (z - h.position.z) * Math.min(1, dt * 16); };
  if (hold) { set(l, -0.3, 0.56, 0.42); set(r, 0.3, 0.56, 0.42); }
  else if (mood === 'cooking') { set(l, -0.4, 0.62, 0.3); set(r, 0.12 + Math.cos(t * 7) * 0.16, 0.96, 0.62 + Math.sin(t * 7) * 0.12); }
  else if (mood === 'blocked') { set(l, -0.52, 1.25 + Math.sin(t * 11) * 0.14, 0.1); set(r, 0.52, 1.25 + Math.cos(t * 11) * 0.14, 0.1); }
  else if (mood === 'stalled') { set(l, -0.42, 0.34, 0.1); set(r, 0.42, 0.34, 0.1); }
  else if (mood === 'cheer') { set(l, -0.5, 1.35 + Math.sin(t * 16) * 0.06, 0.05); set(r, 0.5, 1.35 - Math.sin(t * 16) * 0.06, 0.05); }
  else if (mood === 'wave') { set(l, -0.45, 0.5, 0.06); set(r, 0.5 + Math.sin(t * 10) * 0.12, 1.32, 0.12); }
  else if (moving) { set(l, -0.45, 0.5 - w * 0.1, 0.06 - w * 0.22); set(r, 0.45, 0.5 + w * 0.1, 0.06 + w * 0.22); }
  else { set(l, -0.45, 0.5 + breathe * 2, 0.06); set(r, 0.45, 0.5 + breathe * 2, 0.06); }
  ch.blink -= dt;
  const shut = ch.blink < 0.11 || mood === 'stalled';
  for (const [e, hl] of ch.eyes) { e.scale.y = shut ? 0.15 : 1.3; hl.visible = !shut; }
  if (ch.blink < 0) ch.blink = 2 + Math.random() * 4;
}

export const player = Object.assign(character({ apron: '#e5533d', band: '#e5533d', scarf: '#e5533d', scale: 1.22 }), { carry: null, path: null, targetSt: null, act: true, moving: false, dash: 0, dashCool: 0, vx: 0, vz: 0 });
player.g.position.set(0, 0, -0.95);
const carryAnchor = new THREE.Object3D(); carryAnchor.position.set(0, 0.62, 0.52); player.inner.add(carryAnchor);
const carryWorld = V();
const agentChefs = new Map();   // chefId -> character
/** Stands the player on a spot with empty hands and nowhere to go: coming in through the door. */
export function placePlayer(at, facing = Math.PI) {
  player.g.position.set(at.x, 0, at.z); player.g.rotation.y = facing;
  Object.assign(player, { carry: null, path: null, targetSt: null, moving: false, vx: 0, vz: 0, dash: 0 });
}
/** What presence.js needs to stand the other people in this kitchen: a chef in their colours, with their name over the hat. */
export const avatarKit = {
  make({ look, name, pid }) {
    const ch = character({ apron: look.color, band: look.color, scarf: look.color, skin: look.skin, scale: 1.22 });
    ch.g.visible = false; ch.pid = pid;
    return ch;
  },
  pose(ch, dt, t, o) { pose(ch, dt, t, o); },
  remove(ch) { scene.remove(ch.g); },
  label(ch, name, t, say) {
    const text = say?.phrase !== undefined ? PHRASES[say.phrase] : null;
    label(`av${ch.pid}`, `<div class="who">${esc(name)}${text ? `<i>${esc(text)}</i>` : ''}</div>`, V(ch.g.position.x, 2.5, ch.g.position.z), { pri: 2 });
  },
};

/* ======================= things that get carried ======================= */
/** Moves an object to a named place: a hop with an arc when the place changes, then it stays glued there. */
function mover(g) { return { g, key: null, from: V(), t: 1, dur: 0.35, h: 0.5, squash: 0, squashV: 0, landed: null }; }
const tmp = V();
function moveTo(mv, key, target, dt, { dur = 0.32, h = 0.45, instant = false, onLand = null } = {}) {
  if (mv.key !== key) { const first = mv.key === null; mv.key = key; mv.from.copy(mv.g.position); mv.t = instant || first ? 1 : 0; mv.dur = dur; mv.h = h; mv.landed = onLand; if (mv.t >= 1) mv.g.position.copy(target); }
  if (mv.t < 1) {
    mv.t = Math.min(1, mv.t + dt / mv.dur);
    const e = mv.t * mv.t * (3 - 2 * mv.t);
    mv.g.position.lerpVectors(mv.from, target, e); mv.g.position.y += Math.sin(Math.PI * mv.t) * mv.h;
    if (mv.t >= 1) { kick(mv, 0.3); mv.landed?.(); mv.landed = null; }
  } else mv.g.position.copy(target);
  const s = spring(mv, dt);
  mv.g.scale.set(1 - s * 0.6, 1 + s, 1 - s * 0.6);
  return mv.t >= 1;
}

const SIZE_COLOR = { S: '#57b86a', M: '#4aa3d8', L: '#e5533d' };
function ticketMesh(o) {
  const g = new THREE.Group();
  rbox(0.34, 0.03, 0.46, C.paper, 0, 0, 0, g, 0.012);
  rbox(0.34, 0.034, 0.1, SIZE_COLOR[o.size] || SIZE_COLOR.M, 0, 0.001, -0.18, g, 0.012);
  const lines = { S: 1, M: 2, L: 3 }[o.size] || 2;
  for (let i = 0; i < lines; i++) rbox(0.22 - i * 0.04, 0.012, 0.03, '#b9a98c', -0.02, 0.026, -0.05 + i * 0.075, g, 0.005);
  if (o.plan) { const st = cyl(0.07, 0.07, 0.012, '#4aa3d8', 0.09, 0.03, 0.15, g, 12); st.castShadow = false; }
  (o.grants || []).forEach((cls, i) => { const d = cyl(0.045, 0.045, 0.02, JARS.find(j => j.cls === cls)?.color || '#888', -0.11 + i * 0.1, 0.03, 0.16, g, 10); d.castShadow = false; });
  return g;
}
const ticketKey = o => `${o.size}|${o.plan ? 1 : 0}|${(o.grants || []).join()}`;
const FOODS = ['#f2a03a', '#e5533d', '#57b86a', '#e8c95a', '#c873d6', '#4aa3d8'];
export const foodColor = id => FOODS[id % FOODS.length];
function plateMesh(o, look) {
  const g = new THREE.Group();
  const cold = look.cold, tint = c => cold ? '#8fcdf0' : c;
  // a cold plate sits in a patch of frost, ringed with ice
  if (cold) { const patch = cyl(0.56, 0.56, 0.012, flat('#dff5ff', { transparent: true, opacity: 0.85 }), 0, -0.035, 0, g, 26); patch.castShadow = false; }
  cyl(0.34, 0.24, 0.07, tint('#fffdf5'), 0, 0, 0, g, 22);
  const food = ball(0.2, look.burnt ? '#40302a' : tint(foodColor(o.id)), 0, 0.1, 0, g, 14); food.scale.y = 0.6;
  if (!look.burnt) { ball(0.07, tint('#57b86a'), 0.09, 0.2, 0.03, g, 8); ball(0.05, tint('#fff1d6'), -0.07, 0.19, -0.05, g, 8); }
  if (cold) for (let i = 0; i < 8; i++) { const a = i * 0.785 + 0.3, r = 0.36 + (i % 2) * 0.08; const f = add(new THREE.OctahedronGeometry(0.085 + (i % 3) * 0.02), toon('#f4fcff', { emissive: '#9fd8ff', emissiveIntensity: 0.5 }), Math.cos(a) * r, 0.1 + (i % 2) * 0.04, Math.sin(a) * r, g, false); f.scale.y = 2.3; f.rotation.z = Math.cos(a) * 0.45; f.rotation.x = Math.sin(a) * 0.45; }
  if (look.approved) {
    const dome = add(new THREE.SphereGeometry(0.31, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2), toon(cold ? '#bfe3f5' : '#f6c64a'), 0, 0.05, 0, g, false);
    dome.scale.y = 0.9; ball(0.055, toon(cold ? '#e8f8ff' : '#fff1b0'), 0, 0.36, 0, g, 10);
  }
  return g;
}
const plateKey = look => `${look.burnt ? 1 : 0}${look.approved ? 1 : 0}${look.cold ? 1 : 0}`;
export const plateLook = o => ({ burnt: !!(o.tests && !o.tests.ok), approved: !!o.approved, cold: o.merge?.clean === false });

/* ======================= local state ======================= */
export const local = { board: null, binConfirm: null, hatch: null, booted: false };
export const slotOf = new Map();       // orderId -> window slot, while its ticket is still at the window
export const passSlotOf = new Map();   // orderId -> pass slot
const backOf = new Map();              // orderId -> back row spot, once a chef has the ticket
const customers = new Map();           // orderId -> { ch }
const leaving = [];
const tickets = new Map();             // orderId -> { g, key, mv }
export const plates = new Map();       // orderId -> { g, key, mv, route, ovenT }
const coins = [];
const strings = new Map();             // "a-b" -> { mesh, key }
const ACTIVE = new Set(['waiting', 'planning', 'cooking', 'testing', 'at_pass', 'merging', 'stalled']);
const AT_WINDOW = new Set(['waiting', 'planning']);
export const stateWords = o => ({ waiting: o.plan ? 'planned, waiting for a chef' : 'waiting for a chef', planning: 'on the prep board', cooking: 'cooking', testing: 'in the oven', at_pass: o.approved ? 'approved, ready to ship' : 'at the pass', merging: 'shipping', stalled: 'stalled', shipped: 'shipped', binned: 'binned' }[o.state] || o.state);
export const chefIndex = id => G.S.chefs.findIndex(c => c.id === id);

export function setCarry(c) { player.carry = c; kick(player, 0.18); }

/**
 * Empties the room of everything that belongs to one kitchen's orders: another kitchen is about to be drawn (a visit, the way
 * home, a fresh kitchen), and order ids mean something else there.
 */
export function resetWorld() {
  for (const cu of customers.values()) scene.remove(cu.ch.g);
  for (const l of leaving) scene.remove(l.ch.g);
  for (const t of tickets.values()) scene.remove(t.g);
  for (const p of plates.values()) scene.remove(p.g);
  for (const c of coins) scene.remove(c.m);
  for (const s of strings.values()) { scene.remove(s.mesh); s.mesh.geometry.dispose(); }
  for (const ch of agentChefs.values()) scene.remove(ch.g);
  customers.clear(); tickets.clear(); plates.clear(); strings.clear(); agentChefs.clear(); slotOf.clear(); passSlotOf.clear(); backOf.clear();
  leaving.length = 0; coins.length = 0;
  Object.assign(local, { board: null, binConfirm: null, hatch: null, booted: false });
  player.carry = null; player.path = null; player.targetSt = null;
  for (const st of chefStations) { st.chefId = null; st.heat = 0; st.burn = 0; st.tools = undefined; st.fire.visible = false; st.alarm.material.opacity = 0; st.burner.material.opacity = 0; st.glow.material.opacity = 0; st.soup.visible = st.lid.visible = st.spoon.visible = false; }
  world.cooking = world.fires = world.smoking = 0; world.cheer = 0;
}

function freeIndex(map, n) { const used = new Set(map.values()); for (let i = 0; i < n; i++) if (!used.has(i)) return i; return -1; }

/** Brings the room in line with the latest server state. */
export function syncWorld() {
  const S = G.S, c = player.carry;
  if (c) {
    const o = orderOf(c.id);
    if (c.type === 'ticket' && o?.state !== 'waiting') setCarry(null);
    if (c.type === 'plate' && o?.state !== 'at_pass') setCarry(null);
  }
  if (local.board && !AT_WINDOW.has(orderOf(local.board)?.state)) local.board = null;
  if (local.hatch && !['at_pass', 'merging'].includes(orderOf(local.hatch)?.state)) local.hatch = null;
  for (const o of S.orders) if (o.state === 'planning' && local.board == null) local.board = o.id;

  // window slots hold tickets; once a chef has the ticket the customer steps back and frees the slot
  for (const [id] of slotOf) if (!AT_WINDOW.has(orderOf(id)?.state)) slotOf.delete(id);
  for (const [id] of backOf) if (!ACTIVE.has(orderOf(id)?.state) || AT_WINDOW.has(orderOf(id)?.state)) backOf.delete(id);
  for (const o of [...S.orders].sort((a, b) => a.id - b.id)) {
    if (AT_WINDOW.has(o.state) && !slotOf.has(o.id)) { const i = freeIndex(slotOf, SLOT_Z.length); if (i >= 0) slotOf.set(o.id, i); }
    if (ACTIVE.has(o.state) && !AT_WINDOW.has(o.state) && !backOf.has(o.id)) { const i = freeIndex(backOf, 4); backOf.set(o.id, i < 0 ? o.id % 4 : i); }
  }
  for (const [id, cu] of customers) {
    const o = orderOf(id);
    if (o && ACTIVE.has(o.state)) continue;
    customers.delete(id);
    const happy = o?.state === 'shipped';
    leaving.push({ ch: cu.ch, happy, t: 0 });
    if (happy) { kick(cu.ch, 0.5); coinFrom(cu.ch.g.position); }
  }
  for (const o of S.orders) {
    if (customers.has(o.id) || !(slotOf.has(o.id) || backOf.has(o.id))) continue;
    const bodies = ['#c98bd6', '#6cc3c9', '#e8a25c', '#9fc46a', '#ee8fa6', '#8aa2e8'], skins = ['#f3c9a0', '#d19c72', '#94603f', '#f6dcc0'], hairs = ['#5a3a2a', '#2c2430', '#c7772e', '#e8c56a'];
    const ch = character({ body: bodies[o.id % bodies.length], hat: false, hair: hairs[(o.id * 7) % hairs.length], skin: skins[o.id % skins.length], scale: 1.12 });
    const at = local.booted ? V(-9.6, 0, 4.4) : (slotOf.has(o.id) ? stationById(`slot${slotOf.get(o.id)}`).stand : stationById(`slot${backOf.get(o.id)}`).back);
    ch.g.position.copy(at); ch.g.rotation.y = Math.PI / 2;
    for (const m of [ch.torso, ch.head]) m.userData.customerOf = o.id;
    customers.set(o.id, { ch });
    if (local.booted) emit('sfx', 'door');
  }

  // agent chefs at their stoves
  S.chefs.forEach((chef, j) => {
    const st = chefStations[j]; if (!st) return;
    st.chefId = chef.id;
    if (agentChefs.has(chef.id)) return;
    const col = CHEF_COLORS[chef.id] || FOODS[j % FOODS.length];
    const ch = character({ apron: col, band: col, skin: ['#f3c9a0', '#94603f', '#d19c72', '#f6dcc0'][j % 4], scale: 1.3 });
    ch.g.position.copy(st.stand);
    for (const m of [ch.torso, ch.head]) m.userData.chefOf = chef.id;
    agentChefs.set(chef.id, ch);
  });

  // tickets: at the window, on the prep board, in your hands, or clipped beside a stove
  const wantT = new Set();
  for (const o of S.orders) {
    if (!['waiting', 'planning', 'cooking', 'stalled'].includes(o.state)) continue;
    if (o.state === 'waiting' && !slotOf.has(o.id) && local.board !== o.id && !(c?.type === 'ticket' && c.id === o.id)) continue;
    wantT.add(o.id);
    let t = tickets.get(o.id);
    const key = ticketKey(o);
    if (t && t.key !== key) { scene.remove(t.g); const g = ticketMesh(o); g.position.copy(t.g.position); scene.add(g); t.g = g; t.mv.g = g; t.key = key; kick(t.mv, 0.4); }
    if (!t) { const g = ticketMesh(o); scene.add(g); t = { g, key, mv: mover(g) }; tickets.set(o.id, t); }
  }
  for (const [id, t] of tickets) if (!wantT.has(id)) { scene.remove(t.g); tickets.delete(id); }

  // plates: chef -> oven -> pass on their own, then you carry them to the hatch
  for (const [id] of passSlotOf) if (!['at_pass', 'merging'].includes(orderOf(id)?.state)) passSlotOf.delete(id);
  for (const o of S.orders) if (o.state === 'at_pass' && !passSlotOf.has(o.id)) { const i = freeIndex(passSlotOf, PASS_Z.length); passSlotOf.set(o.id, i < 0 ? o.id % PASS_Z.length : i); }
  for (const o of S.orders) {
    let p = plates.get(o.id);
    const j = chefIndex(o.chefId);
    let want = null;
    if (o.state === 'testing') want = 'oven';
    else if (o.state === 'at_pass') want = c?.type === 'plate' && c.id === o.id ? 'carry' : local.hatch === o.id ? 'hatch' : `pass${passSlotOf.get(o.id)}`;
    else if (o.state === 'merging') want = local.hatch === o.id ? 'hatch' : p?.route.at(-1) || `pass${passSlotOf.get(o.id) ?? 0}`;
    else if (o.state === 'shipped' && p) want = 'out';
    else if (['cooking', 'stalled'].includes(o.state) && p) want = `chef${j}`;
    if (!want) { if (p) { spawn('puff', p.g.position, '#ffffff', { n: 5 }); scene.remove(p.g); plates.delete(o.id); } continue;
    }
    if (!p) {
      const look = plateLook(o), g = plateMesh(o, look);
      scene.add(g);
      p = { g, key: plateKey(look), mv: mover(g), route: [], ovenT: 0, id: o.id };
      plates.set(o.id, p);
      if (!local.booted || j < 0) { p.route.push(want); }
      else { g.position.copy(chefStations[j].potPos); p.mv.key = `chef${j}`; p.route.push(`chef${j}`); if (want !== 'oven') p.route.push('oven'); p.route.push(want); kick(agentChefs.get(o.chefId) || {}, 0.4); }
    } else if (p.route.at(-1) !== want) {
      if (want === 'out' && p.route.at(-1) !== 'hatch') p.route.push('hatch');
      p.route.push(want);
    }
    const look = plateLook(o), key = plateKey(look);
    if (p.key !== key) {
      const g = plateMesh(o, look); g.position.copy(p.g.position); g.visible = p.g.visible; scene.remove(p.g); scene.add(g);
      if (look.approved && p.key[1] === '0') { spawn('star', g.position.clone().add(V(0, 0.4, 0)), ['#ffd75e', '#fff1b0'], { n: 10, up: 1.6, out: 1.8, life: 0.7, grow: 0 }); }
      if (look.cold && p.key[2] === '0') { spawn('star', g.position.clone().add(V(0, 0.3, 0)), ['#bfe3f5', '#ffffff'], { n: 18, up: 1.6, out: 2, life: 1.1, grow: 0, size: 1.3, opacity: 1 }); emit('sfx', 'frost'); popup(`#${o.id} went cold: main moved`, g.position.clone().add(V(-0.4, 0.5, 0)), 'cold'); }
      p.g = g; p.mv.g = g; p.key = key; kick(p.mv, 0.45);
    }
  }
  for (const [id, p] of plates) if (!orderOf(id)) { scene.remove(p.g); plates.delete(id); }

  const shippedN = S.commits ?? S.stats.shipped;
  if (shippedN !== mainCount) { mainCount = shippedN; mainTex.userData.redraw(); }
  local.booted = true;
}

function coinFrom(pos) {
  const m = cyl(0.14, 0.14, 0.04, toon('#ffd75e'), pos.x, 1.4, pos.z, scene, 14);
  coins.push({ m, from: m.position.clone(), to: V(-5.7, COUNTER_H + 0.06, pos.z), t: 0 });
}

/** Where an order physically is right now, for popups, strings and triage. */
export function orderPos(o) {
  if (!o) return hatchSt.top;
  const p = plates.get(o.id); if (p) return p.g.position;
  const j = chefIndex(o.chefId); if (j >= 0 && ['cooking', 'stalled'].includes(o.state)) return chefStations[j].potPos;
  const t = tickets.get(o.id); if (t) return t.g.position;
  if (o.state === 'shipped') return hatchSt.top;
  return j >= 0 ? chefStations[j].potPos : hatchSt.top;
}
/** The station an order is sitting at, if any. */
export function orderStation(o) {
  if (!o) return null;
  if (['cooking', 'stalled'].includes(o.state)) return chefStations[chefIndex(o.chefId)] || null;
  if (o.state === 'testing') return ovenSt;
  if (o.state === 'at_pass') return player.carry?.id === o.id ? hatchSt : passStations[passSlotOf.get(o.id)] || null;
  if (o.state === 'planning' || local.board === o.id) return prepSt;
  if (o.state === 'waiting' && slotOf.has(o.id)) return stationById(`slot${slotOf.get(o.id)}`);
  return null;
}

export function stationState(st) {
  const S = G.S;
  if (st.type === 'slot') { const id = [...slotOf].find(([, s]) => s === st.i)?.[0]; return { order: id && local.board !== id ? orderOf(id) : null }; }
  if (st.type === 'chef') { const chef = S.chefs.find(c => c.id === st.chefId); return { chef, order: chef?.orderId ? orderOf(chef.orderId) : null, question: chef ? questionFor(chef.id) : null }; }
  if (st.type === 'pass') { const id = [...passSlotOf].find(([id, s]) => s === st.i && !(player.carry?.type === 'plate' && player.carry.id === id) && local.hatch !== id)?.[0]; return { order: id ? orderOf(id) : null }; }
  if (st.type === 'prep') return { order: local.board ? orderOf(local.board) : null };
  if (st.type === 'oven') return { orders: S.orders.filter(o => o.state === 'testing') };
  return {};
}

function platePos(key, out) {
  if (key === 'oven') return out.copy(ovenSt.inside);
  if (key === 'carry') return out.copy(carryWorld);
  if (key === 'hatch') return out.copy(hatchSt.top);
  if (key === 'out') return out.copy(hatchSt.out);
  if (key.startsWith('pass')) return out.copy(passStations[+key.slice(4)]?.top || passStations[0].top);
  if (key.startsWith('chef')) return out.copy(chefStations[+key.slice(4)]?.potPos || chefStations[0].potPos);
  return out;
}

/* ======================= every frame ======================= */
let emitT = 0;
const ringHtml = (frac, inner, cls) => `<span class="ic ${cls}" style="--p:${Math.round(frac * 100)}">${inner}</span>`;
export function animateWorld(dt, t, near) {
  const S = G.S, focus = quiet(), esca = escalation(), now = nowS();
  emitT += dt; const tickFx = emitT > 0.1; if (tickFx) emitT = 0;
  carryAnchor.getWorldPosition(carryWorld);
  const carry = player.carry;
  world.cheer = Math.max(0, world.cheer - dt);
  const cheering = world.cheer > 0;

  // the player
  pose(player, dt, t, { moving: player.moving, hold: !!carry, mood: cheering && !player.moving ? 'cheer' : 'idle', speed: player.dash > 0 ? 1.6 : 1 });

  // main jumps when a plate lands in it, and a ring of light rolls out across the floor
  const ms = spring(mainSpring, dt); mainG.scale.set(1 - ms * 0.35, 1 + ms, 1 - ms * 0.35);
  shockT += dt; shock.visible = shockT < 0.7;
  if (shock.visible) { const f = shockT / 0.7; shock.scale.setScalar(0.6 + f * 5.2); shock.material.opacity = (1 - f) * 0.9; }

  // customers
  let queued = 0;
  for (const o of S.orders) if (o.state === 'waiting' && !slotOf.has(o.id)) queued++;
  for (const [id, cu] of customers) {
    const o = orderOf(id); if (!o) continue;
    const front = slotOf.has(id), g = cu.ch.g;
    const st = stationById(`slot${front ? slotOf.get(id) : backOf.get(id) ?? 0}`), target = front ? st.stand : st.back;
    const dx = target.x - g.position.x, dz = target.z - g.position.z, d = Math.hypot(dx, dz), walking = d > 0.06;
    if (walking) { const sp = Math.min(d, dt * 3.4); g.position.x += dx / d * sp; g.position.z += dz / d * sp; g.rotation.y = Math.atan2(dx, dz); }
    else g.rotation.y += (Math.PI / 2 - g.rotation.y) * Math.min(1, dt * 8);
    const frac = Math.max(0, 1 - (now - o.createdAt) / (o.targetMin * 60000));
    const cross = front && o.state === 'waiting' && frac < 0.2;
    g.rotation.z = cross ? Math.sin(t * 14) * 0.05 : 0;
    pose(cu.ch, dt, t, { moving: walking, mood: cross ? 'blocked' : 'idle' });
    if (front && !walking && !(carry?.type === 'ticket' && carry.id === id) && local.board !== id) {
      const here = near === st;
      label(`cust${id}`, `<div class="tk ${frac < 0.2 ? 'late' : frac < 0.5 ? 'warn' : ''}"><b>#${o.id}</b><span class="sz ${o.size}">${o.size}</span>${o.plan ? `<span class="pl">${ICON.pencil}</span>` : ''}<i style="--p:${Math.round(frac * 100)}"></i></div>`, V(g.position.x - 0.1, 2.25, g.position.z), { cls: here ? 'here' : '', pri: here ? 5 : 2, click: st.id });
    } else if (!front && !walking) {
      // their ticket is in the kitchen: a small tag says whose it is and how their patience is holding
      label(`cust${id}`, `<div class="tk away ${frac < 0.2 ? 'late' : frac < 0.5 ? 'warn' : ''}"><b>#${o.id}</b><i style="--p:${Math.round(frac * 100)}"></i></div>`, V(g.position.x - 0.1, 2.15, g.position.z), { pri: 1 });
    }
  }
  if (queued) label('queued', `<div class="tk"><b>+${queued}</b> in the queue</div>`, V(-7.2, 1.2, 3.4), { pri: 1 });
  for (let i = leaving.length - 1; i >= 0; i--) {
    const l = leaving[i]; l.t += dt;
    const g = l.ch.g;
    if (l.happy && l.t < 0.7) { g.position.y = Math.abs(Math.sin(l.t * 9)) * 0.45; pose(l.ch, dt, t, { mood: 'cheer' }); }
    else { g.position.y = 0; g.position.z += dt * 3.6; g.position.x -= dt * 1.2; g.rotation.y = -0.3; pose(l.ch, dt, t, { moving: true }); }
    if (l.t > 3) { scene.remove(g); leaving.splice(i, 1); }
  }
  for (let i = coins.length - 1; i >= 0; i--) {
    const c = coins[i]; c.t += dt;
    const f = Math.min(1, c.t / 0.6);
    c.m.position.lerpVectors(c.from, c.to, f); c.m.position.y += Math.sin(Math.PI * f) * 1.1; c.m.rotation.x = c.t * 12;
    if (f >= 1) c.m.rotation.x = 0;
    if (c.t > 0.6 && !c.rang) { c.rang = true; emit('sfx', 'coin'); spawn('star', c.m.position, '#ffd75e', { n: 5, up: 1, out: 1.2, life: 0.5, grow: 0 }); }
    if (c.t > 6) { scene.remove(c.m); coins.splice(i, 1); }
  }

  // chefs and their pots
  let cooking = 0, fires = 0;
  S.chefs.forEach((chef, j) => {
    const st = chefStations[j], ch = agentChefs.get(chef.id); if (!st || !ch) return;
    const o = chef.orderId ? orderOf(chef.orderId) : null, q = questionFor(chef.id);
    const age = q ? now - q.createdAt : 0;
    const level = !q ? 0 : age >= esca.fireMs ? 3 : age >= esca.smokeMs ? 2 : 1;
    const isCooking = o?.state === 'cooking' && !q, stalled = o?.state === 'stalled';
    // a free chef waves you over while you are carrying a ticket, and turns to watch you walk past
    const free = !o, wantsTicket = free && carry?.type === 'ticket';
    const mood = q ? 'blocked' : stalled ? 'stalled' : isCooking ? 'cooking' : cheering || (o?.state === 'at_pass' && o.approved) ? 'cheer' : wantsTicket ? 'wave' : 'idle';
    if (isCooking) cooking++;
    if (level === 3) fires++;
    pose(ch, dt, t, { mood });
    ch.g.position.y = reduceMotion ? 0 : q ? Math.abs(Math.sin(t * (level > 1 ? 9 : 6))) * (level > 1 ? 0.22 : 0.12) : cheering ? Math.abs(Math.sin(t * 10 + j)) * 0.2 : wantsTicket ? Math.abs(Math.sin(t * 5 + j)) * 0.07 : 0;
    const toPlayer = Math.atan2(player.g.position.x - st.stand.x, player.g.position.z - st.stand.z);
    // from the street-end camera a chef who faces the stove is in profile, so everyone turns a little towards it
    const bias = world.side ? -0.8 : 0;
    const faceTo = bias + (q ? Math.sin(t * 3) * 0.3 : stalled ? 0.5 : isCooking ? -0.12 + Math.sin(t * 1.3 + j) * 0.08 : free ? (world.side ? 0 : toPlayer * 0.8) : Math.sin(t * 0.6 + j * 2) * 0.25);
    ch.g.rotation.y += (faceTo - ch.g.rotation.y) * Math.min(1, dt * 6);
    ch.g.rotation.z = stalled ? 0.16 : 0;

    const hot = !!o && ['cooking', 'stalled'].includes(o.state);
    st.heat += ((isCooking ? 1 : 0) - st.heat) * Math.min(1, dt * 4);
    st.burner.material.opacity = st.heat * (0.75 + Math.sin(t * 13 + j) * 0.2);
    st.glow.material.opacity = st.heat * (0.5 + Math.sin(t * 9 + j) * 0.12) + (level === 3 ? 0.6 : 0);
    st.soup.visible = hot; st.spoon.visible = isCooking && !focus;
    if (hot) { st.soup.material.color.set(stalled ? '#4a3a34' : foodColor(o.id)); st.soup.position.y = 0.375 + Math.sin(t * 5 + j) * 0.008; }
    st.lid.visible = focus && hot;
    st.lid.position.y = 0.4 + (isCooking ? Math.abs(Math.sin(t * 10 + j)) * 0.025 : 0);
    st.lid.rotation.z = isCooking ? Math.sin(t * 10 + j) * 0.04 : 0;
    const s = spring(st, dt); st.pot.scale.set(1 - s * 0.5, 1 + s, 1 - s * 0.5);
    if (tickFx && isCooking && !focus && Math.random() < 0.7) spawn('puff', st.potPos, '#fffaf0', { spread: 0.3, up: 0.9, life: 1.1, size: 0.9, opacity: 0.6 });
    if (tickFx && stalled && Math.random() < 0.5) spawn('puff', st.potPos, '#5a4a52', { spread: 0.3, up: 0.7, life: 1.6, size: 1.4 });
    // smoke is a grey column you can see from the window; fire is flames in the pot, sparks, black smoke and a red floor
    if (tickFx && level === 2) spawn('puff', st.potPos, ['#a89aa2', '#8a7a82'], { n: 2, spread: 0.3, up: 1.7, out: 0.25, life: 2.1, size: 2.3, grow: 1.5, opacity: 0.78 });
    if (tickFx && level === 3) {
      spawn('puff', st.potPos.clone().add(V(0, 0.7, 0)), ['#3a2f36', '#52444c'], { n: 2, spread: 0.4, up: 2.1, out: 0.3, life: 2.2, size: 2.8, grow: 1.6, opacity: 0.8 });
      spawn('star', st.potPos, ['#ffc23d', '#ff7a2a'], { n: 2, spread: 0.5, up: 3, out: 1.6, life: 0.8, gravity: 4, grow: 0, size: 0.8, opacity: 1 });
    }
    st.burn += ((level === 3 ? 1 : 0) - st.burn) * Math.min(1, dt * 5);
    st.fire.visible = st.burn > 0.03;
    if (st.fire.visible) {
      st.fire.scale.setScalar(st.burn);
      st.fire.children.forEach((f, i) => { const k = reduceMotion ? 1 : 1 + Math.sin(t * (15 + i * 3) + i * 2 + j) * 0.2; f.scale.set(1 + Math.sin(t * 11 + i) * 0.1, k, 1); f.position.y = f.userData.h * k / 2; });
    }
    st.alarm.material.opacity = st.burn * (0.5 + Math.sin(t * 9) * 0.22);

    // one small sign per chef: who, which model, and what state, readable from across the room
    const tools = o ? o.activity.filter(a => a.kind === 'tool').length : 0;
    if (st.tools !== tools) { if (tools > (st.tools ?? tools)) kick(st, 0.16); st.tools = tools; }
    const frac = o?.assignedAt ? Math.min(1, (now - o.assignedAt) / (o.targetMin * 60000)) : 0;
    const icon = level === 3 ? ringHtml(1, ICON.flame, 'fire') : level === 2 ? ringHtml(1, ICON.smoke, 'smoke') : level === 1 ? ringHtml(1, ICON.q, focus ? 'held' : 'ask')
      : stalled ? ringHtml(1, 'zz', 'stall') : o?.state === 'cooking' ? ringHtml(frac, `#${o.id}`, 'cook') : o?.state === 'testing' ? ringHtml(1, ICON.oven, 'oven')
      : o && ['at_pass', 'merging'].includes(o.state) ? ringHtml(1, ICON.tick, 'done') : ringHtml(0, '', 'free');
    const sub = level === 3 ? `on fire ${mmss(age)}` : level === 2 ? `smoking ${mmss(age)}` : q ? `waiting ${mmss(age)}` : modelName(chef.model);
    // on a phone a chef is a dot of status until they need you (a question, a fire, a stall, a plate up): then the full sign
    const tiny = world.small && !level && !stalled && !(o && ['at_pass', 'merging'].includes(o.state));
    label(`chef${chef.id}`, tiny ? `<div class="chip dot" style="--c:${CHEF_COLORS[chef.id] || '#c873d6'}" title="${esc(chef.name)}">${icon}</div>` : `<div class="chip" style="--c:${CHEF_COLORS[chef.id] || '#c873d6'}">${icon}<span class="nm"><b>${esc(chef.name)}</b><i>${esc(sub)}</i></span></div>`, world.side ? V(st.stand.x + 0.15, 2.85, st.stand.z) : V(st.stand.x, 3.0, st.stand.z - 0.35), { cls: (level ? `lv${level}` : '') + (tiny ? ' dot' : ''), pri: level ? 6 + level : 3, click: st.id });
  });
  world.cooking = cooking; world.fires = focus ? 0 : fires; world.smoking = focus ? 0 : S.questions.filter(q => now - q.createdAt >= esca.smokeMs).length;

  // the gate swings out a little while you stand at it
  if (doorG.visible) {
    doorSt.swing += ((near === doorSt ? 1 : 0) - doorSt.swing) * Math.min(1, dt * 9);
    gateL.rotation.y = doorSt.swing * 1.15; gateR.rotation.y = -doorSt.swing * 1.15;
  }

  // the oven
  const inOven = S.orders.filter(o => o.state === 'testing');
  let doorOpen = false;
  for (const p of plates.values()) if (p.mv.t < 1 && (p.mv.key === 'oven' || p.from === 'oven')) doorOpen = true;
  ovenSt.door += ((doorOpen ? 1 : 0) - ovenSt.door) * Math.min(1, dt * 12);
  ovenDoor.rotation.z = ovenSt.door * 1.25;
  const baking = [...plates.values()].some(p => p.mv.key === 'oven' && p.mv.t >= 1);
  ovenInside.material.opacity = (baking ? 0.55 + Math.sin(t * 6) * 0.12 : 0) + ovenSt.door * 0.3;
  ovenWindowMat.color.set(baking ? '#ff9a3d' : '#2a1c22');
  ovenSt.lampT = Math.max(0, ovenSt.lampT - dt);
  if (ovenSt.lampT <= 0) lampMat.color.set(baking ? (Math.sin(t * 8) > 0 ? '#ffc23d' : '#8a6a2a') : '#55505a');
  const refire = !!S.rules?.autoRefire;
  lever.rotation.x += ((refire ? -0.75 : 0.75) - lever.rotation.x) * Math.min(1, dt * 14);
  leverKnob.material.color.set(refire ? '#57b86a' : C.red);
  if (refire) label('lever', `<div class="ovn refire">${ICON.flame}re-fire on</div>`, V(5.42, 2.25, OVEN_Z + 0.34), { pri: 1, click: 'oven' });
  if (inOven.length || baking) label('oven', `<div class="ovn"><span class="spin"></span>${inOven.map(o => `#${o.id}`).join(' ') || 'testing'}</div>`, ovenSt.top.clone().add(V(0, 0.35, 0)), { pri: 4, click: 'oven' });

  // tickets
  for (const [id, tk] of tickets) {
    const o = orderOf(id); if (!o) continue;
    const j = chefIndex(o.chefId);
    if (carry?.type === 'ticket' && carry.id === id) moveTo(tk.mv, 'carry', carryWorld, dt);
    else if (local.board === id) { moveTo(tk.mv, 'prep', tmp.copy(prepSt.top), dt); if (o.state === 'planning') { tk.g.position.y += Math.abs(Math.sin(t * 6)) * 0.05; if (tickFx && Math.random() < 0.3) spawn('star', tk.g.position, '#4aa3d8', { up: 0.9, out: 0.8, life: 0.6, grow: 0 }); } }
    else if (j >= 0 && o.state !== 'waiting') moveTo(tk.mv, `chef${j}`, chefStations[j].ticketPos, dt, { dur: 0.3, h: 0.7 });
    else if (slotOf.has(id)) moveTo(tk.mv, `slot${slotOf.get(id)}`, stationById(`slot${slotOf.get(id)}`).top, dt);
    tk.g.rotation.y = tk.mv.key === 'carry' ? player.g.rotation.y : tk.mv.key?.startsWith('slot') ? Math.PI / 2 : 0;
  }

  // plates
  for (const [id, p] of plates) {
    const o = orderOf(id);
    const key = p.route[0];
    if (!key) continue;
    const arrived = moveTo(p.mv, key, platePos(key, tmp), dt, key === 'out' ? { dur: 0.9, h: 0 } : key === 'carry' ? { dur: 0.18, h: 0.25 } : { dur: key === 'oven' || p.from === 'oven' ? 0.7 : 0.45, h: key === 'oven' || p.from === 'oven' ? 1.5 : 0.6, onLand: () => { if (key.startsWith('pass')) emit('sfx', 'clink'); } });
    p.g.visible = !(key === 'oven' && arrived && ovenSt.door < 0.2);
    if (key === 'carry') p.g.rotation.y = player.g.rotation.y;
    if (key === 'oven' && arrived) p.ovenT += dt;
    if (arrived && p.route.length > 1 && (key !== 'oven' || p.ovenT > 0.75)) {
      const next = p.route[1];
      if (key === 'oven') {
        const ok = next.startsWith('pass') && o?.tests?.ok !== false;
        lampMat.color.set(ok ? '#5fe07a' : '#ff4a3a'); ovenSt.lampT = 2.6; p.ovenT = 0;
        emit('sfx', ok ? 'ding' : 'buzz'); kick(ovenSt, 0.2);
        spawn('puff', ovenSt.mouth, ok ? '#fffaf0' : '#5a4a52', { n: 6, spread: 0.6, up: 1.1, life: 0.9 });
        if (!next.startsWith('pass')) popup('Re-fire!', ovenSt.top, 'warn');
      }
      p.from = key; p.route.shift();
    } else if (arrived && p.route.length === 1) {
      if (key === 'out' || key.startsWith('chef')) { if (key === 'out') spawn('star', p.g.position, ['#ffd75e', '#57b86a'], { n: 8, up: 1.4, out: 1.6, life: 0.6, grow: 0 }); scene.remove(p.g); plates.delete(id); continue; }
      p.from = key;
    }
    // what a plate says about itself from across the room
    if (key.startsWith('pass') && arrived && o) {
      const look = plateLook(o), st = passStations[+key.slice(4)], here = near === st;
      // an icon and one word: cold beats approved beats burnt, because that is the order they matter in at the hatch
      const [kind, ic, word] = look.cold ? ['cold', ICON.snow, 'cold'] : look.approved ? ['gold', ICON.tick, 'ship it'] : look.burnt ? ['burnt', ICON.flame, 'tests fail'] : ['new', ICON.eye, 'review'];
      label(`plate${id}`, `<div class="pt ${kind}"><span class="pi ${kind}">${ic}</span><b>#${o.id} ${word}</b></div>`, st.top.clone().add(V(0.5, 0.6, 0)), { pri: here ? 5 : 2, click: st.id, anchor: 'tl' });
      if (look.burnt && tickFx && Math.random() < 0.25) spawn('puff', p.g.position.clone().add(V(0, 0.25, 0)), '#5a4a52', { up: 0.6, life: 1.1, size: 0.7 });
      if (look.cold && tickFx && Math.random() < 0.45) spawn('puff', p.g.position.clone().add(V(0, 0.25, 0)), '#e3f6ff', { spread: 0.5, up: 0.35, out: 0.5, life: 1.3, size: 1.2, grow: 0.9, opacity: 0.55 });
    }
  }
  beltTex.offset.x -= dt * ([...plates.values()].some(p => p.mv.key === 'out') ? 1.6 : 0.12);
  const os = spring(ovenSt, dt); ovenBody.scale.set(1 + os * 0.3, 1 - os * 0.5, 1 + os * 0.3);

  // jars
  for (const js of jarStations) {
    const held = carry?.type === 'jar' && carry.id === js.cls;
    moveTo(js.mv, held ? 'carry' : 'home', held ? carryWorld : js.home, dt);
    const always = (S.grants || []).includes(js.cls);
    js.halo.material.opacity = always ? 0.75 + Math.sin(t * 4) * 0.2 : 0;
    if (!held && (!world.small || near === js || always)) label(`jar${js.cls}`, `<div class="jr ${always ? 'always' : ''}" style="--c:${js.def.color}">${ICON[js.cls]}</div>`, js.home.clone().add(V(0, 0.62, 0)), { pri: near === js ? 4 : 1, click: js.id });
  }

  // red string between plates and pots that touch the same files
  const live = new Set();
  for (const [a, b, files, conflictFiles] of S.overlaps || []) {
    const conflict = (conflictFiles || []).length > 0;
    const oa = orderOf(a), ob = orderOf(b); if (!oa || !ob) continue;
    const pa = orderPos(oa), pb = orderPos(ob), id = `${a}-${b}`, key = `${pa.x.toFixed(1)},${pa.y.toFixed(1)},${pa.z.toFixed(1)},${pb.x.toFixed(1)},${pb.y.toFixed(1)},${pb.z.toFixed(1)},${conflict}`;
    live.add(id);
    let s = strings.get(id);
    if (!s || s.key !== key) {
      if (s) { scene.remove(s.mesh); s.mesh.geometry.dispose(); }
      const mid = pa.clone().lerp(pb, 0.5); mid.y = Math.max(pa.y, pb.y) + 0.9 + pa.distanceTo(pb) * 0.08;
      const curve = new THREE.QuadraticBezierCurve3(pa.clone().add(V(0, 0.25, 0)), mid, pb.clone().add(V(0, 0.25, 0)));
      const mesh = new THREE.Mesh(new THREE.TubeGeometry(curve, 20, conflict ? 0.07 : 0.028, 6), flat(conflict ? '#ff1f1f' : '#ff7a5c', { toneMapped: false }));
      scene.add(mesh); s = { mesh, key, mid: curve.getPoint(0.5) }; strings.set(id, s);
    }
    const names = (conflict ? conflictFiles : files || []).map(f => f.split('/').pop()).slice(0, 2).join(', ');
    label(`str${id}`, conflict ? `<div class="knot conf">${ICON.flame}<b>${esc(names)} will conflict</b></div>` : `<div class="knot">${ICON.link}</div>`, s.mid, { pri: conflict ? 5 : 1 });
  }
  for (const [id, s] of strings) if (!live.has(id)) { scene.remove(s.mesh); s.mesh.geometry.dispose(); strings.delete(id); }

  // the prep board says when it is thinking or done
  if (local.board) {
    const o = orderOf(local.board);
    label('prep', `<div class="pt">${o?.state === 'planning' ? '<span class="pi plan"><span class="spin"></span></span>' : `<span class="pi gold">${ICON.pencil}</span>`}</div>`, prepSt.top.clone().add(V(0, 0.75, 0)), { pri: 3, click: 'prep' });
  }
}
export const world = { cooking: 0, fires: 0, smoking: 0, cheer: 0, side: false };
/** The upright-phone camera looks from the street end: floor lettering would read sideways, and the main crate turns to face it. */
export function setSide(side, small = world.small) {
  world.side = side; world.small = small;
  for (const m of stencils) m.visible = !side && !small;      // a phone has no room for lettering on the floor
  mainG.rotation.y = side ? -Math.PI / 2 : 0;
}

/** Dust at the player's feet. */
export function dust(n = 5) { spawn('puff', player.g.position.clone().add(V(0, 0.12, 0)), '#f3e2c0', { n, spread: 0.4, up: 0.5, out: 1.2, life: 0.45, size: 1.1, opacity: 0.7 }); }
export function sprinkle(pos, color) { spawn('star', pos, [color, '#fff1d6'], { n: 14, spread: 0.3, up: 1.6, out: 1.4, life: 0.8, gravity: 5, grow: 0, size: 0.7 }); }
/** The ship moment: the crate jumps, confetti from the hatch and from main, a ring of light, and the whole line cheers. */
export function shipFx() {
  confetti(hatchSt.top.clone().add(V(0, 0.6, 0)));
  confetti(V(7.0, 1.7, HATCH_Z));
  spawn('star', V(7.0, 1.5, HATCH_Z), ['#ffd75e', '#fff1b0', '#8ff0a4'], { n: 18, up: 2.6, out: 3, life: 0.9, grow: 0, gravity: 3, size: 1.3, opacity: 1 });
  kick(mainSpring, 0.55); world.cheer = 1.5;
  shock.position.set(hatchSt.ring.x, 0.03, hatchSt.ring.z); shockT = 0;
  shake(0.2);
}
export function chefChar(chefId) { return agentChefs.get(chefId); }
