// The restaurant floor: kitchen with four stations on the left, the pass in the middle, tables, and the line on the street.
// Where things are is the client's business; what they are is the server's.
import { THREE, V, scene, toon, flat, add, rbox, cyl, ball, capsule, plane, blob, canvasTex, signTex, spawn, confetti, label, popup, shake } from './scene.js';
import { G, nowS, esc, mmss, emit, ICON, reduceMotion, customerById, itemById, STATION, modelName } from './core.js';

/* ======================= layout ======================= */
const COUNTER_H = 0.9;
const STATION_Z = { backend: -2.55, frontend: -0.85, database: 0.85, integration: 2.55 };
const TABLE_POS = { 1: [0.9, -1.55], 2: [3.9, -1.55], 3: [0.9, 1.95], 4: [3.9, 1.95] };
const LINE_SPOTS = [[7.15, -2.45], [7.15, -1.45], [7.15, -0.45], [7.15, 0.55], [7.15, 1.55], [7.75, 2.3], [8.35, 2.3]];
const DOOR_IN = V(6.0, 0, -2.45), DOOR_STEP = V(5.25, 0, -2.45), DOOR_OUT = V(6.2, 0, 2.75), STREET_OUT = V(8.6, 0, 3.6);
const RAIL_PICK = V(-3.25, 0, -1.35), COUNTER_DROP = V(-3.25, 0, 1.35);
const C = { cab: '#3d6475', cabDark: '#2f4f5e', cream: '#fff1d6', wood: '#d79a5b', woodDark: '#a8683a', red: '#dc4a3a', redDark: '#a9342a', steel: '#b9c4cc', steelDark: '#6d7a84', brass: '#e6b24a', brick: '#c8684a', teal: '#3f9e98', ink: '#3a241c', paper: '#fff8e6', cloth: '#fbf3e4' };

/* ---------- textures ---------- */
const rnd = (() => { let s = 7; return () => (s = (s * 16807) % 2147483647) / 2147483647; })();
const tiles = (w, h, a, b) => canvasTex(w * 64, h * 64, (g) => {
  for (let i = 0; i < w; i++) for (let j = 0; j < h; j++) {
    const l = (rnd() - 0.5) * 5;
    g.fillStyle = (i + j) % 2 === 0 ? `hsl(${a[0]}, ${a[1]}%, ${a[2] + l}%)` : `hsl(${b[0]}, ${b[1]}%, ${b[2] + l}%)`;
    g.fillRect(i * 64, j * 64, 64, 64);
    g.fillStyle = 'rgba(255,255,255,.14)'; g.fillRect(i * 64 + 3, j * 64 + 3, 58, 5);
  }
  g.strokeStyle = 'rgba(120,70,50,.4)'; g.lineWidth = 3;
  for (let i = 0; i <= w; i++) { g.beginPath(); g.moveTo(i * 64, 0); g.lineTo(i * 64, h * 64); g.stroke(); }
  for (let j = 0; j <= h; j++) { g.beginPath(); g.moveTo(0, j * 64); g.lineTo(w * 64, j * 64); g.stroke(); }
});
const kitchenTex = tiles(4, 7, [190, 18, 82], [190, 14, 72]);
const diningTex = canvasTex(512, 512, (g) => {
  for (let i = 0; i < 16; i++) { g.fillStyle = `hsl(${26 + rnd() * 6}, ${50 + rnd() * 8}%, ${56 + rnd() * 8}%)`; g.fillRect(0, i * 32, 512, 32); }
  g.strokeStyle = 'rgba(110,60,25,.35)'; g.lineWidth = 2;
  for (let i = 0; i <= 16; i++) { g.beginPath(); g.moveTo(0, i * 32); g.lineTo(512, i * 32); g.stroke(); for (let k = 0; k < 3; k++) { const x = (rnd() * 512) | 0; g.beginPath(); g.moveTo(x, i * 32); g.lineTo(x, i * 32 + 32); g.stroke(); } }
}, { repeat: [2.2, 1.6] });
const wallTex = canvasTex(512, 128, (g) => {
  for (let i = 0; i < 16; i++) for (let j = 0; j < 4; j++) { g.fillStyle = `hsl(${174 + rnd() * 6}, ${38 + rnd() * 6}%, ${j === 0 ? 62 : 50 + rnd() * 5}%)`; g.fillRect(i * 32 + (j % 2 ? 16 : 0), j * 32, 31, 31); }
  g.fillStyle = '#fff1d6'; g.fillRect(0, 28, 512, 5);
});
const cobbleTex = canvasTex(256, 256, (g) => {
  g.fillStyle = '#6f5d74'; g.fillRect(0, 0, 256, 256);
  for (let j = 0; j < 8; j++) for (let i = 0; i < 5; i++) { g.fillStyle = `hsl(${275 + rnd() * 20}, 13%, ${50 + rnd() * 9}%)`; g.beginPath(); g.roundRect(i * 56 + (j % 2 ? 28 : 0) - 26, j * 32 + 3, 50, 26, 9); g.fill(); }
}, { repeat: [1.4, 3.6] });
const groundTex = canvasTex(256, 256, (g) => { const grd = g.createRadialGradient(128, 128, 20, 128, 128, 128); grd.addColorStop(0, '#6b4a5c'); grd.addColorStop(0.45, '#46303f'); grd.addColorStop(1, '#1c1420'); g.fillStyle = grd; g.fillRect(0, 0, 256, 256); });
const glowTex = canvasTex(64, 64, (g) => { const r = g.createRadialGradient(32, 32, 2, 32, 32, 32); r.addColorStop(0, 'rgba(255,170,70,.95)'); r.addColorStop(1, 'rgba(255,120,40,0)'); g.fillStyle = r; g.fillRect(0, 0, 64, 64); });
const woodTex = canvasTex(256, 64, (g) => { for (let i = 0; i < 8; i++) { g.fillStyle = `hsl(${28 + rnd() * 6}, ${58 + rnd() * 8}%, ${58 + rnd() * 9}%)`; g.fillRect(i * 32, 0, 32, 64); } });
const woodTop = toon('#ffffff', { map: woodTex });
const wallMat = toon('#ffffff', { map: wallTex });

/* ---------- shell ---------- */
plane(70, 50, flat('#ffffff', { map: groundTex, toneMapped: false }), 1, -0.03, 0);
const kfloor = plane(3.8, 7, toon('#ffffff', { map: kitchenTex, outline: false }), -4.1, 0, 0); kfloor.receiveShadow = true; kfloor.userData.floor = true;
const dfloor = plane(8.2, 7, toon('#ffffff', { map: diningTex, outline: false }), 1.9, 0.002, 0); dfloor.receiveShadow = true; dfloor.userData.floor = true;
const street = plane(3.4, 9.4, toon('#ffffff', { map: cobbleTex, outline: false }), 8.1, -0.01, 0); street.receiveShadow = true;
plane(0.9, 7.6, toon('#e8d9b8', { outline: false }), 6.75, 0, 0).receiveShadow = true;   // the footpath

// back wall, left wall, the right wall with two doors, a low front wall
rbox(12.6, 2.5, 0.32, wallMat, 0, 0, -3.66, scene, 0.05);
rbox(12.6, 0.14, 0.4, C.cream, 0, 2.48, -3.66);
rbox(0.32, 2.5, 7.3, wallMat, -6.2, 0, 0, scene, 0.05);
for (const [z0, z1] of [[-3.6, -3.0], [-1.85, 2.15], [3.35, 3.6]]) rbox(0.32, 2.2, z1 - z0, wallMat, 6.2, 0, (z0 + z1) / 2, scene, 0.05);
for (const z of [-3.0, -1.85, 2.15, 3.35]) rbox(0.4, 2.3, 0.14, C.cream, 6.2, 0, z);
rbox(0.36, 0.16, 1.4, C.cream, 6.2, 2.1, -2.42); rbox(0.36, 0.16, 1.4, C.cream, 6.2, 2.1, 2.75);
rbox(12.6, 0.42, 0.3, C.brick, 0, 0, 3.66); rbox(12.6, 0.08, 0.38, C.cream, 0, 0.42, 3.66);
// a half wall either side of the pass marks the kitchen off from the dining room
rbox(0.24, 1.1, 0.9, C.cabDark, -2.35, 0, -3.15); rbox(0.24, 1.1, 0.9, C.cabDark, -2.35, 0, 3.15);

function signBoard(text, x, y, z, w, bg, fg = '#fff1d6', rotY = 0) {
  const tex = signTex(256, 80, (g, cw, ch) => { g.fillStyle = bg; g.fillRect(0, 0, cw, ch); g.fillStyle = fg; g.textAlign = 'center'; g.textBaseline = 'middle'; g.font = '44px Bungee, Impact, sans-serif'; g.fillText(text, cw / 2, ch / 2 + 3); });
  const grp = new THREE.Group(); grp.position.set(x, y, z); grp.rotation.y = rotY; scene.add(grp);
  rbox(w + 0.12, w * 0.3125 + 0.12, 0.08, C.ink, 0, 0, 0, grp, 0.03);
  add(new THREE.PlaneGeometry(w, w * 0.3125), flat('#ffffff', { map: tex, toneMapped: false }), 0, w * 0.156 + 0.06, 0.045, grp, false);
  return grp;
}
signBoard('KITCHEN', -4.2, 1.75, -3.45, 1.7, '#3d6475');
signBoard('DINING', 2.4, 1.75, -3.45, 1.7, '#dc4a3a');
signBoard('IN', 6.45, 2.25, -2.42, 0.8, '#57b86a', '#fff1d6', Math.PI / 2);
signBoard('OUT', 6.45, 2.25, 2.75, 0.8, '#a9342a', '#fff1d6', Math.PI / 2);
// street dressing
for (const [x, z, s] of [[9.3, -3.0, 1], [9.4, 3.2, 0.8]]) { cyl(0.26 * s, 0.2 * s, 0.4 * s, C.brick, x, 0, z, scene, 12); blob(1.1 * s, 1.1 * s, x, z); ball(0.42 * s, '#57a05a', x, 0.72 * s, z, scene, 12); ball(0.3 * s, '#6fba62', x + 0.2 * s, 1.0 * s, z + 0.1, scene, 10); }
cyl(0.05, 0.07, 2.6, C.ink, 9.2, 0, -0.5, scene, 8); ball(0.2, flat('#ffe2a0', { toneMapped: false }), 9.2, 2.7, -0.5, scene, 12).castShadow = false;
// little rope posts along the line
for (const z of [-2.95, -0.95, 1.05]) { cyl(0.05, 0.07, 0.8, C.brass, 6.75, 0, z, scene, 8); ball(0.07, C.brass, 6.75, 0.84, z, scene, 8); }

function counter(x0, x1, z0, z1, top = woodTop, body = C.cab) {
  const w = x1 - x0, d = z1 - z0, cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
  blob(w + 0.7, d + 0.7, cx, cz);
  rbox(w, 0.12, d, C.cabDark, cx, 0, cz, scene, 0.03);
  const b = rbox(w, COUNTER_H - 0.2, d, body, cx, 0.1, cz);
  const t = rbox(w + 0.06, 0.12, d + 0.06, top, cx, COUNTER_H - 0.12, cz, scene, 0.05);
  return [b, t];
}

/* ======================= targets you can tap ======================= */
export const targets = [];
function target(def) { targets.push(def); for (const m of def.meshes || []) m.traverse(o => { o.userData.target = def; }); return def; }
export const targetById = id => targets.find(t => t.id === id);

/* ---------- the four work stations ---------- */
export const stationSpots = {};
for (const s of STATION) {
  const z = STATION_Z[s.id], x = -5.55;
  blob(1.5, 1.7, x, z);
  const body = rbox(0.9, COUNTER_H, 1.3, s.color, x, 0, z);
  rbox(0.05, 0.4, 0.9, '#00000033', x + 0.46, 0.22, z, scene, 0.02);
  const hob = rbox(0.84, 0.04, 1.2, C.ink, x, COUNTER_H, z, scene, 0.02);
  const burner = cyl(0.3, 0.3, 0.025, flat('#ff8a3a', { unique: true, transparent: true, opacity: 0 }), x, COUNTER_H + 0.04, z, scene, 20);
  const glow = plane(1.4, 1.4, flat('#ffffff', { map: glowTex, transparent: true, opacity: 0, depthWrite: false, unique: true }), x, COUNTER_H + 0.07, z);
  const pot = new THREE.Group(); pot.position.set(x, COUNTER_H + 0.05, z); scene.add(pot);
  cyl(0.3, 0.26, 0.34, C.steel, 0, 0, 0, pot, 22);
  const rim = add(new THREE.TorusGeometry(0.305, 0.035, 8, 24), toon(C.steelDark), 0, 0.34, 0, pot); rim.rotation.x = Math.PI / 2;
  const soup = cyl(0.27, 0.27, 0.03, toon(s.color, { key: `soup${s.id}` }).clone(), 0, 0.34, 0, pot, 20); soup.castShadow = false; soup.visible = false;
  const sign = signBoard(s.name.toUpperCase(), x + 0.05, 1.55, z, 1.05, s.color, '#fff1d6', Math.PI / 2);
  stationSpots[s.id] = {
    stand: V(-4.55, 0, z), potPos: V(x, COUNTER_H + 0.5, z), pot, soup, burner, glow, heat: 0,
    tgt: target({ id: `station:${s.id}`, kind: 'station', station: s.id, top: V(x, COUNTER_H + 0.4, z), access: [V(-1.5, 0, Math.max(-2.4, Math.min(2.4, z)))], meshes: [body, hob, pot, sign] }),
  };
}
const CHEF_HOME = [V(-3.55, 0, -0.45), V(-3.55, 0, 0.45), V(-3.9, 0, -1.6), V(-3.9, 0, 1.6)];

/* ---------- the pass: the rail on the kitchen side, the counter on the dining side ---------- */
const passMeshes = counter(-2.75, -2.0, -2.6, 2.6, toon(C.brass));
rbox(0.05, 0.05, 2.3, C.steelDark, -2.62, COUNTER_H + 0.42, -1.35, scene, 0.02);   // the ticket rail
for (const z of [-2.5, -0.2]) cyl(0.025, 0.025, 0.42, C.steelDark, -2.62, COUNTER_H, z, scene, 6);
plane(0.7, 2.3, flat('#ffffff', { map: glowTex, transparent: true, opacity: 0.35, depthWrite: false }), -2.3, COUNTER_H + 0.012, 1.35).renderOrder = 2;
for (const z of [0.7, 2.0]) { cyl(0.02, 0.02, 0.5, C.ink, -2.3, 1.85, z, scene, 6); const sh = cyl(0.08, 0.24, 0.2, C.cabDark, -2.3, 1.65, z, scene, 16); sh.castShadow = false; ball(0.08, flat('#ffe2a0', { toneMapped: false }), -2.3, 1.62, z, scene, 10).castShadow = false; }
export const railTgt = target({ id: 'rail', kind: 'rail', top: V(-2.4, COUNTER_H + 0.3, -1.35), access: [V(-1.5, 0, -1.35)], meshes: [passMeshes[0]] });
export const counterTgt = target({ id: 'counter', kind: 'counter', top: V(-2.3, COUNTER_H + 0.3, 1.35), access: [V(-1.5, 0, 1.35)], meshes: [passMeshes[1]] });
const RAIL_SLOTS = Array.from({ length: 6 }, (_, i) => V(-2.6, COUNTER_H + 0.28, -2.4 + i * 0.42));
const COUNTER_SLOTS = Array.from({ length: 6 }, (_, i) => V(-2.3, COUNTER_H + 0.05, 0.35 + i * 0.42));

/* ---------- tables ---------- */
export const tableSpots = {};
const placardTex = signTex(128, 64, (g, w, h) => { g.fillStyle = '#fff8e6'; g.fillRect(0, 0, w, h); g.fillStyle = '#a9342a'; g.font = '22px Bungee, Impact, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('RESERVED', w / 2, h / 2 + 2); });
for (const [id, [x, z]] of Object.entries(TABLE_POS)) {
  blob(1.7, 1.7, x, z);
  cyl(0.08, 0.14, 0.72, C.ink, x, 0, z, scene, 10);
  const top = cyl(0.62, 0.62, 0.06, C.cloth, x, 0.72, z, scene, 28);
  cyl(0.64, 0.64, 0.03, '#d9c7a6', x, 0.71, z, scene, 28).castShadow = false;
  // the chair behind it, where the customer sits facing you
  const seat = V(x, 0, z - 0.95);
  rbox(0.5, 0.42, 0.46, woodTop, seat.x, 0, seat.z);
  rbox(0.5, 0.62, 0.08, C.woodDark, seat.x, 0.42, seat.z - 0.2);
  const card = new THREE.Group(); card.position.set(x, 0.78, z); scene.add(card); card.visible = false;
  const tent = add(new THREE.PlaneGeometry(0.42, 0.21), flat('#ffffff', { map: placardTex, toneMapped: false, side: THREE.DoubleSide }), 0, 0.11, 0, card, false); tent.rotation.x = -0.3;
  tableSpots[id] = { x, z, seat, top: V(x, 0.8, z), card, plates: [], tgt: target({ id: `table:${id}`, kind: 'table', table: Number(id), top: V(x, 0.8, z), access: [V(x, 0, z + 1.05)], meshes: [top] }) };
}
export const doorTgt = target({ id: 'door', kind: 'door', top: V(6.0, 1, -2.45), access: [V(5.3, 0, -2.45)], meshes: [] });

/* ---------- floor markers ---------- */
const ringTex = canvasTex(128, 128, (g) => { g.strokeStyle = '#fff'; g.lineWidth = 12; g.lineCap = 'round'; for (let i = 0; i < 4; i++) { g.beginPath(); g.arc(64, 64, 48, i * Math.PI / 2 + 0.25, (i + 1) * Math.PI / 2 - 0.25); g.stroke(); } });
export const ring = plane(1.15, 1.15, flat('#ffd75e', { map: ringTex, transparent: true, depthWrite: false, toneMapped: false }), 0, 0.02, 0); ring.visible = false; ring.renderOrder = 2;
export const targetDot = plane(0.5, 0.5, flat('#ffffff', { map: ringTex, transparent: true, depthWrite: false, opacity: 0.9, toneMapped: false }), 0, 0.02, 0); targetDot.visible = false; targetDot.renderOrder = 2;
const arrowTex = canvasTex(64, 64, (g) => { g.fillStyle = '#fff'; g.beginPath(); g.moveTo(32, 4); g.lineTo(58, 34); g.lineTo(42, 34); g.lineTo(42, 60); g.lineTo(22, 60); g.lineTo(22, 34); g.lineTo(6, 34); g.closePath(); g.fill(); });
export const arrow = plane(0.8, 0.8, flat('#ff5a3c', { map: arrowTex, transparent: true, depthWrite: false, toneMapped: false }), 0, 0.03, 0); arrow.visible = false; arrow.renderOrder = 2;
export const hintRing = plane(1.5, 1.5, flat('#ff5a3c', { map: ringTex, transparent: true, depthWrite: false, toneMapped: false }), 0, 0.025, 0); hintRing.visible = false; hintRing.renderOrder = 2;

/* ======================= collision and path finding (the waiter stays in the dining room) ======================= */
export const PLAYER_R = 0.3;
const BOUNDS = { x0: -1.8, x1: 5.9, z0: -3.3, z1: 3.35 };
const SOLIDS = Object.values(TABLE_POS).map(([x, z]) => ({ x0: x - 0.64, x1: x + 0.64, z0: z - 1.25, z1: z + 0.62 }));
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
for (let x = -1.5; x <= 5.6; x += 0.5) for (let z = -3.0; z <= 3.1; z += 0.5) if (!blocked(x, z)) NODES.push({ x, z });
/** A* over a 0.5 grid, then pulled straight wherever there is a clear line. */
export function findPath(from, to) {
  if (clear(from, to)) return [V(to.x, 0, to.z)];
  const start = { x: from.x, z: from.z }, goal = { x: to.x, z: to.z };
  const all = [start, ...NODES, goal], gi = all.length - 1;
  const dist = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
  const g = new Float32Array(all.length).fill(1e9), came = new Int32Array(all.length).fill(-1), done = new Uint8Array(all.length);
  g[0] = 0;
  const open = new Set([0]);
  while (open.size) {
    let cur = -1, best = 1e9;
    for (const i of open) { const f = g[i] + dist(all[i], goal); if (f < best) { best = f; cur = i; } }
    if (cur === gi) break;
    open.delete(cur); done[cur] = 1;
    for (let j = 1; j < all.length; j++) {
      if (done[j]) continue;
      const d = dist(all[cur], all[j]);
      if (d > ((cur === 0 || j === gi) ? 1.1 : 0.75) || !clear(all[cur], all[j])) continue;
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
function character({ body = '#fffaf0', apron = null, hat = true, skin = '#f3c9a0', band = null, hair = null, scale = 1.3, scarf = null }) {
  const g = new THREE.Group(), inner = new THREE.Group(); g.add(inner);
  blob(1.15, 1.15, 0, 0, g);
  const feet = [-1, 1].map(s => { const f = ball(0.11, C.ink, 0.15 * s, 0.07, 0.03, inner, 10); f.scale.set(1, 0.65, 1.4); return f; });
  const torso = capsule(0.31, 0.2, body, 0, 0.5, 0, inner);
  if (apron) { rbox(0.44, 0.4, 0.1, apron, 0, 0.2, 0.25, inner, 0.05); rbox(0.2, 0.14, 0.03, C.cream, 0, 0.3, 0.3, inner, 0.02); }
  if (scarf) { const s = cyl(0.27, 0.3, 0.1, scarf, 0, 0.72, 0, inner, 16); s.castShadow = false; }
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
    if (band) cyl(0.258, 0.25, 0.1, band, 0, 1.36, 0, inner, 18);
  } else if (hair) { const hr = ball(0.365, hair, 0, 1.15, -0.055, inner, 18); hr.scale.set(1.02, 0.92, 1); }
  for (const m of inner.children.slice(headParts).filter(m => !hands.includes(m))) { m.position.y -= 0.78; hg.add(m); }
  g.scale.setScalar(scale);
  scene.add(g);
  return { g, inner, head, hands, feet, eyes, torso, squash: 0, squashV: 0, phase: Math.random() * 6, blink: 2 + Math.random() * 3, path: [], scale };
}
export function kick(o, amount = 0.25) { o.squashV = (o.squashV || 0) - amount * 14; }
function spring(o, dt) {
  let x = o.squash || 0, v = o.squashV || 0;
  for (let left = Math.min(dt, 0.1); left > 1e-5; left -= 1 / 240) { const h = Math.min(left, 1 / 240); v += (-x * 220 - v * 14) * h; x += v * h; }
  if (!Number.isFinite(x) || !Number.isFinite(v)) { x = 0; v = 0; }
  o.squash = Math.max(-0.45, Math.min(0.45, x)); o.squashV = v;
  return o.squash;
}
function pose(ch, dt, t, { moving = false, hold = false, mood = 'idle', speed = 1 } = {}) {
  const s = spring(ch, dt);
  ch.inner.scale.set(1 - s * 0.55, 1 + s, 1 - s * 0.55);
  if (moving) ch.phase += dt * 13 * speed;
  const w = Math.sin(ch.phase), breathe = Math.sin(t * 2.2 + ch.phase) * 0.012;
  ch.inner.position.y = moving ? Math.abs(w) * 0.09 : breathe;
  ch.feet[0].position.z = moving ? 0.03 + w * 0.16 : 0.03; ch.feet[1].position.z = moving ? 0.03 - w * 0.16 : 0.03;
  const [l, r] = ch.hands;
  const set = (h, x, y, z) => { const k = Math.min(1, dt * 16); h.position.x += (x - h.position.x) * k; h.position.y += (y - h.position.y) * k; h.position.z += (z - h.position.z) * k; };
  if (hold) { set(l, -0.3, 0.56, 0.42); set(r, 0.3, 0.56, 0.42); }
  else if (mood === 'cooking') { set(l, -0.4, 0.62, 0.3); set(r, 0.12 + Math.cos(t * 7) * 0.16, 0.96, 0.62 + Math.sin(t * 7) * 0.12); }
  else if (mood === 'blocked' || mood === 'hand') { set(l, -0.42, 0.5, 0.1); set(r, 0.48, 1.45 + Math.sin(t * 9) * 0.08, 0.05); }
  else if (mood === 'eating') { set(l, -0.35, 0.62, 0.38); set(r, 0.3, 0.7 + Math.abs(Math.sin(t * 5)) * 0.25, 0.42); }
  else if (mood === 'cross') { set(l, -0.52, 1.0 + Math.sin(t * 11) * 0.1, 0.1); set(r, 0.52, 1.0 + Math.cos(t * 11) * 0.1, 0.1); }
  else if (mood === 'cheer') { set(l, -0.5, 1.35, 0.05); set(r, 0.5, 1.35, 0.05); }
  else if (moving) { set(l, -0.45, 0.5 - w * 0.1, 0.06 - w * 0.22); set(r, 0.45, 0.5 + w * 0.1, 0.06 + w * 0.22); }
  else { set(l, -0.45, 0.5 + breathe * 2, 0.06); set(r, 0.45, 0.5 + breathe * 2, 0.06); }
  ch.blink -= dt;
  const shut = ch.blink < 0.11 || mood === 'sleep';
  for (const [e, hl] of ch.eyes) { e.scale.y = shut ? 0.15 : 1.3; hl.visible = !shut; }
  if (ch.blink < 0) ch.blink = 2 + Math.random() * 4;
}
/** Walks a character along its path at `speed`; returns true while it is moving. */
function walk(ch, dt, speed = 3.4) {
  const g = ch.g;
  if (!ch.path.length) return false;
  const p = ch.path[0], dx = p.x - g.position.x, dz = p.z - g.position.z, d = Math.hypot(dx, dz);
  if (d < 0.05) { ch.path.shift(); return ch.path.length > 0; }
  const step = Math.min(d, dt * speed);
  g.position.x += dx / d * step; g.position.z += dz / d * step;
  let diff = Math.atan2(dx, dz) - g.rotation.y; diff = Math.atan2(Math.sin(diff), Math.cos(diff));
  g.rotation.y += diff * Math.min(1, dt * 12);
  return true;
}
function face(ch, dt, angle) { let diff = angle - ch.g.rotation.y; diff = Math.atan2(Math.sin(diff), Math.cos(diff)); ch.g.rotation.y += diff * Math.min(1, dt * 8); }

export const player = Object.assign(character({ body: '#fffaf0', apron: '#3a241c', hat: false, hair: '#4a2c22', scarf: '#e5533d', scale: 1.22 }), { carry: null, path: null, onArrive: null, moving: false, vx: 0, vz: 0 });
player.g.position.set(2.4, 0, 0.2);
const carryAnchor = new THREE.Object3D(); carryAnchor.position.set(0, 0.62, 0.52); player.inner.add(carryAnchor);
const carryWorld = V();
const notepad = new THREE.Group(); rbox(0.24, 0.03, 0.32, C.paper, 0, 0, 0, notepad, 0.01); rbox(0.24, 0.035, 0.05, C.tomato || '#e5533d', 0, 0.001, -0.14, notepad, 0.01); scene.add(notepad); notepad.visible = false;

/* ======================= props ======================= */
function ticketMesh(stationId) {
  const g = new THREE.Group();
  rbox(0.3, 0.02, 0.38, C.paper, 0, 0, 0, g, 0.01);
  rbox(0.3, 0.024, 0.09, STATION.find(s => s.id === stationId)?.color || '#888', 0, 0.001, -0.14, g, 0.01);
  for (let i = 0; i < 2; i++) rbox(0.2 - i * 0.05, 0.01, 0.025, '#b9a98c', -0.02, 0.02, -0.03 + i * 0.07, g, 0.004);
  g.rotation.x = Math.PI / 2.6;
  return g;
}
function plateMesh(color, { burnt = false, empty = false, small = false } = {}) {
  const g = new THREE.Group();
  cyl(0.3, 0.21, 0.06, '#fffdf5', 0, 0, 0, g, 22);
  if (!empty) {
    const food = ball(0.18, burnt ? '#40302a' : color, 0, 0.09, 0, g, 14); food.scale.y = 0.6;
    if (!burnt) { ball(0.06, '#57b86a', 0.08, 0.18, 0.03, g, 8); ball(0.045, '#fff1d6', -0.06, 0.17, -0.05, g, 8); }
  } else { ball(0.03, '#e8c95a', 0.08, 0.07, 0.02, g, 6); }
  if (small) g.scale.setScalar(0.7);
  return g;
}
const stationColor = id => STATION.find(s => s.id === id)?.color || '#c873d6';

/* ======================= local state ======================= */
const chefChars = new Map();      // chefId -> { ch, home, mode, plateG }
const custChars = new Map();      // customerId -> { ch, mode, leaving }
const ticketMeshes = new Map();   // itemId -> group (on the rail or at a station)
const counterPlates = new Map();  // itemId -> group
const coins = [];
let booted = false;

function lineIndexOf(c) { return G.S.customers.filter(x => x.state === 'in_line').sort((a, b) => a.lineOrder - b.lineOrder).indexOf(c); }
const SKINS = ['#f3c9a0', '#d19c72', '#94603f', '#f6dcc0'], HAIRS = ['#5a3a2a', '#2c2430', '#c7772e', '#e8c56a', '#7a3b2a'];

function seatPath(from, seat) {
  const pts = [];
  if (from.x > 6.05) pts.push(DOOR_IN.clone());
  pts.push(DOOR_STEP.clone());
  if (seat.z > 0) pts.push(V(5.25, 0, seat.z));
  pts.push(V(seat.x, 0, seat.z));
  return pts;
}

/** Brings the floor in line with the latest server state. */
export function syncWorld() {
  const S = G.S;
  // chefs
  S.chefs.forEach((chef, j) => {
    if (chefChars.has(chef.id)) return;
    const ch = character({ apron: chef.color, band: chef.color, skin: SKINS[j % 4], scale: 1.25 });
    ch.g.position.copy(CHEF_HOME[j % 4]); ch.g.rotation.y = Math.PI / 2;
    for (const m of [ch.torso, ch.head]) m.userData.chefOf = chef.id;
    chefChars.set(chef.id, { ch, home: CHEF_HOME[j % 4], at: 'home', item: null, carrying: false });
  });
  for (const chef of S.chefs) {
    const cc = chefChars.get(chef.id);
    const st = chef.stationId;
    if ((chef.state === 'walking' || chef.state === 'cooking') && st && cc.at !== `station:${st}`) {
      cc.at = `station:${st}`; cc.item = chef.itemId; cc.carrying = false;
      cc.ch.path = [RAIL_PICK.clone(), stationSpots[st].stand.clone()];
      if (booted) kick(cc.ch, 0.3);
    } else if (chef.state === 'idle' && cc.at.startsWith('station:')) {
      // the dish goes to the counter on the way home
      const done = cc.item && itemById(cc.item)?.state === 'plated';
      cc.at = 'home'; cc.carrying = !!done;
      cc.ch.path = done ? [COUNTER_DROP.clone(), cc.home.clone()] : [cc.home.clone()];
    }
  }

  // customers
  for (const c of S.customers) {
    let cu = custChars.get(c.id);
    const visible = c.state !== 'paid' || (cu && !cu.gone);
    if (!cu && c.state !== 'paid' && c.state !== 'walked_out') {
      const ch = character({ body: c.persona.color, hat: false, hair: HAIRS[c.id % HAIRS.length], skin: SKINS[(c.id * 3) % 4], scale: 1.12 });
      const i = Math.max(0, lineIndexOf(c));
      const spot = LINE_SPOTS[Math.min(i, LINE_SPOTS.length - 1)];
      ch.g.position.set(booted ? 8.6 : spot[0], 0, booted ? 4.2 : spot[1]); ch.g.rotation.y = -Math.PI / 2;
      for (const m of [ch.torso, ch.head]) m.userData.customerOf = c.id;
      cu = { ch, mode: 'line', gone: false };
      custChars.set(c.id, cu);
      if (booted) emit('sfx', 'door');
    }
    if (!cu || !visible) continue;
    if (c.state === 'in_line') {
      const i = lineIndexOf(c), spot = LINE_SPOTS[Math.min(i, LINE_SPOTS.length - 1)];
      if (cu.mode !== 'line' || cu.spot !== i) { cu.mode = 'line'; cu.spot = i; cu.ch.path = [V(spot[0], 0, spot[1])]; }
    } else if (c.state === 'walked_out' && cu.mode !== 'out') {
      cu.mode = 'out'; cu.ch.path = [V(8.4, 0, cu.ch.g.position.z), V(9.6, 0, 4.6)]; cu.leaving = true;
    } else if (SEATED_STATES.has(c.state) && cu.mode !== 'seat' && c.tableId) {
      cu.mode = 'seat'; cu.leaving = false;
      cu.ch.path = seatPath(cu.ch.g.position, tableSpots[c.tableId].seat);
      if (booted) kick(cu.ch, 0.3);
    } else if (c.state === 'paid' && cu.mode !== 'leave') {
      cu.mode = 'leave'; cu.leaving = true;
      const seat = cu.ch.g.position.clone();
      cu.ch.path = [V(5.25, 0, seat.z), V(5.25, 0, 2.75), DOOR_OUT.clone(), STREET_OUT.clone()];
      if (booted) { kick(cu.ch, 0.5); coinFrom(seat); }
    }
  }

  // tickets on the rail and clipped at stations
  const wantT = new Set();
  for (const it of S.items) {
    if (it.state !== 'ready' && it.state !== 'cooking') continue;
    wantT.add(it.id);
    if (!ticketMeshes.has(it.id)) { const g = ticketMesh(it.station); g.position.copy(booted ? player.g.position.clone().setY(1) : RAIL_SLOTS[0]); scene.add(g); ticketMeshes.set(it.id, { g, from: g.position.clone(), t: booted ? 0 : 1 }); }
  }
  for (const [id, tk] of ticketMeshes) if (!wantT.has(id)) { scene.remove(tk.g); ticketMeshes.delete(id); }

  // plates on the counter
  const wantP = new Set(S.counter);
  for (const id of S.counter) {
    if (counterPlates.has(id)) continue;
    const it = itemById(id);
    const g = plateMesh(stationColor(it.station), { burnt: !!(it.tests && !it.tests.ok) });
    g.position.copy(COUNTER_DROP).setY(COUNTER_H + 0.05); scene.add(g);
    counterPlates.set(id, { g, t: booted ? 0 : 1, from: g.position.clone() });
    if (booted) { emit('sfx', it.tests?.ok === false ? 'buzz' : 'ding'); spawn('puff', g.position, '#fffaf0', { n: 5, up: 1 }); }
  }
  for (const [id, p] of counterPlates) if (!wantP.has(id)) { scene.remove(p.g); counterPlates.delete(id); }

  // plates on tables, and the reserved placards
  for (const [id, ts] of Object.entries(tableSpots)) {
    const table = S.tables.find(t => t.id === Number(id));
    ts.card.visible = !!table?.reserved;
    const c = table?.customerId ? customerById(table.customerId) : null;
    const served = c ? S.items.filter(i => i.customerId === c.id && i.state === 'served').slice(-3) : [];
    const key = served.map(i => i.id).join(',') + (c?.state === 'feedback_ready' ? 'e' : '');
    if (ts.key !== key) {
      for (const p of ts.plates) scene.remove(p);
      ts.plates = served.map((it, k) => { const g = plateMesh(stationColor(it.station), { small: true, empty: c.state !== 'eating' && c.state !== 'waiting_food' }); g.position.set(ts.x - 0.25 + k * 0.25, 0.76, ts.z + 0.1 - (k % 2) * 0.18); scene.add(g); return g; });
      ts.key = key;
    }
  }
  booted = true;
}
const SEATED_STATES = new Set(['seated', 'waiting_food', 'eating', 'feedback_ready', 'paying']);

function coinFrom(pos) {
  const m = cyl(0.14, 0.14, 0.04, toon('#ffd75e'), pos.x, 1.4, pos.z, scene, 14);
  coins.push({ m, from: m.position.clone(), to: V(pos.x, 0.79, pos.z + 0.9), t: 0 });
}

/** Where a customer is, for popups and hints. */
export function customerPos(id) { const cu = custChars.get(id); return cu ? cu.ch.g.position.clone().add(V(0, 2.2, 0)) : V(2, 1.5, 0); }
export function chefChar(id) { return chefChars.get(id)?.ch; }
export function customerChar(id) { return custChars.get(id)?.ch; }
export function setCarry(c) { player.carry = c; kick(player, 0.18); }

/* ======================= every frame ======================= */
let emitT = 0;
const ringHtml = (frac, inner, cls, color) => `<span class="ic ${cls}" style="--p:${Math.round(frac * 100)};${color ? `--c:${color}` : ''}">${inner}</span>`;
const pbar = v => `<i class="pb ${v < 0.25 ? 'late' : v < 0.55 ? 'warn' : ''}" style="--p:${Math.round(v * 100)}"></i>`;

export function animateWorld(dt, t, near) {
  const S = G.S, now = nowS();
  emitT += dt; const tickFx = emitT > 0.1; if (tickFx) emitT = 0;
  carryAnchor.getWorldPosition(carryWorld);
  pose(player, dt, t, { moving: player.moving, hold: !!player.carry });
  notepad.visible = player.carry === 'tickets';
  if (notepad.visible) { notepad.position.copy(carryWorld); notepad.rotation.y = player.g.rotation.y; }

  // chefs
  let cooking = 0;
  for (const chef of S.chefs) {
    const cc = chefChars.get(chef.id); if (!cc) continue;
    const moving = walk(cc.ch, dt, 3.2);
    const q = S.questions.find(x => x.chefId === chef.id);
    const atStation = !moving && cc.at.startsWith('station:');
    const mood = q ? 'blocked' : atStation && chef.state === 'cooking' ? 'cooking' : chef.state === 'idle' && !moving ? (S.rail.length ? 'idle' : 'sleep') : 'idle';
    if (atStation) face(cc.ch, dt, -Math.PI / 2);
    else if (!moving && cc.at === 'home') face(cc.ch, dt, Math.PI / 2);
    if (!moving && cc.carrying) cc.carrying = false;
    pose(cc.ch, dt, t, { moving, mood, hold: cc.carrying || (moving && cc.at.startsWith('station:')) });
    if (atStation && chef.state === 'cooking') cooking++;
    const it = chef.itemId ? itemById(chef.itemId) : null;
    const spot = chef.stationId ? stationSpots[chef.stationId] : null;
    const est = it ? Math.max(4000, it.estMs || 12000) : 1;
    const frac = it?.pickedAt ? Math.min(0.97, (now - it.pickedAt) / est) : 0;
    const icon = q ? ringHtml(1, ICON.q, 'ask') : chef.state === 'cooking' ? ringHtml(frac, esc(customerById(it?.customerId)?.key?.slice(-3) || ''), 'cook', spot ? stationColor(chef.stationId) : null) : chef.state === 'walking' ? ringHtml(0, '…', 'free') : ringHtml(0, S.rail.length ? '' : 'zz', 'free');
    const sub = q ? 'needs you' : chef.state === 'cooking' ? (STATION.find(s => s.id === chef.stationId)?.name || '') : chef.state === 'walking' ? 'to the station' : S.rail.length ? 'free' : 'waiting for tickets';
    const pos = cc.ch.g.position;
    label(`chef${chef.id}`, `<div class="chip" style="--c:${chef.color}">${icon}<span class="nm"><b>${esc(chef.name)}</b><i>${esc(sub)}${chef.driver === 'claude' ? ` · ${esc(modelName(chef.model))}` : ''}</i></span></div>`, V(pos.x, 2.75, pos.z), { cls: q ? 'lv1' : '', pri: q ? 7 : 3, click: chef.stationId ? `station:${chef.stationId}` : 'rail' });
  }
  world.cooking = cooking;

  // stations: heat, soup and steam
  for (const s of STATION) {
    const spot = stationSpots[s.id], st = S.stations.find(x => x.id === s.id);
    label(`st${s.id}`, `<div class="stlab" style="--c:${s.color}">${s.name}</div>`, V(-5.55, 1.05, STATION_Z[s.id] + 0.55), { pri: 1, click: `station:${s.id}` });
    const chef = st?.chefId ? S.chefs.find(c => c.id === st.chefId) : null;
    const hot = chef?.state === 'cooking';
    spot.heat += ((hot ? 1 : 0) - spot.heat) * Math.min(1, dt * 4);
    spot.burner.material.opacity = spot.heat * (0.75 + Math.sin(t * 13) * 0.2);
    spot.glow.material.opacity = spot.heat * (0.5 + Math.sin(t * 9) * 0.12);
    spot.soup.visible = hot;
    if (hot) spot.soup.position.y = 0.355 + Math.sin(t * 5) * 0.008;
    const sp = spring(spot, dt); spot.pot.scale.set(1 - sp * 0.5, 1 + sp, 1 - sp * 0.5);
    if (tickFx && hot && Math.random() < 0.7) spawn('puff', spot.potPos, '#fffaf0', { spread: 0.3, up: 0.9, life: 1.1, size: 0.9, opacity: 0.6 });
    if (hot) {
      const it = itemById(chef.itemId);
      const tools = it?.activity?.filter(a => a.kind === 'tool').length || 0;
      if (spot.tools !== tools) { if (tools > (spot.tools ?? tools)) kick(spot, 0.16); spot.tools = tools; }
    }
  }

  // customers
  for (const c of S.customers) {
    const cu = custChars.get(c.id); if (!cu) continue;
    const g = cu.ch.g;
    const moving = walk(cu.ch, dt, cu.mode === 'leave' || cu.mode === 'out' ? 3.0 : 3.6);
    if (cu.leaving && !moving && !cu.ch.path.length) {
      if (c.state === 'paid' || c.state === 'walked_out') { g.visible = false; if (c.state === 'paid') cu.gone = true; else { scene.remove(g); custChars.delete(c.id); } continue; }
    }
    if (!moving) face(cu.ch, dt, cu.mode === 'seat' ? 0 : cu.mode === 'line' ? -Math.PI / 2 : g.rotation.y);
    const mood = c.state === 'eating' ? 'eating' : c.state === 'feedback_ready' ? 'hand' : c.state === 'in_line' && c.draining && c.patience < 0.3 ? 'cross' : c.furious ? 'cross' : c.state === 'paid' && cu.ch.path.length > 2 ? 'cheer' : 'idle';
    pose(cu.ch, dt, t, { moving, mood });
    g.position.y = cu.mode === 'seat' && !moving ? -0.08 : 0;
    if (moving || g.visible === false) continue;
    const pos = g.position;
    if (c.state === 'in_line') {
      const i = lineIndexOf(c);
      if (i > 4) continue;
      const here = near?.id === 'door';
      label(`cust${c.id}`, `<div class="tk ${c.draining ? 'drain' : ''} ${c.patience < 0.25 ? 'late' : ''}"><b>${esc(c.key.replace('CAFE-', '#'))}</b><span class="sz ${c.difficulty}">${c.difficulty}</span>${pbar(c.patience)}</div>`, V(pos.x, 2.25, pos.z), { cls: here ? 'here' : '', pri: i === 0 ? 4 : 2, click: `line:${c.id}` });
    } else if (SEATED_STATES.has(c.state) && cu.mode === 'seat') {
      const items = S.items.filter(i => i.customerId === c.id);
      const cookingN = items.filter(i => i.state === 'ready' || i.state === 'cooking').length;
      const plated = items.filter(i => i.state === 'plated').length;
      let ic, txt, cls = '';
      if (c.state === 'seated') { ic = ICON.pencil; txt = items.length ? 'decide' : 'ready to order'; cls = 'want'; }
      else if (c.state === 'feedback_ready') { ic = ICON.hand; txt = 'feedback!'; cls = 'want hand'; }
      else if (c.state === 'eating') { ic = '<span class="spin"></span>'; txt = 'tasting…'; }
      else if (plated) { ic = ICON.plate; txt = `${plated} on the counter`; cls = 'want'; }
      else { ic = ICON.wait; txt = `${cookingN} cooking`; }
      if (c.furious) cls += ' furious';
      label(`cust${c.id}`, `<div class="bub2 ${cls}"><span class="bi">${ic}</span><span class="bt"><b>${esc(c.persona.name.split(' ')[0])}</b><i>${esc(txt)}</i></span>${pbar(c.patience)}</div>`, V(pos.x, 2.35, pos.z), { pri: cls.includes('want') ? 6 : 3, click: `table:${c.tableId}` });
    }
  }
  for (let i = coins.length - 1; i >= 0; i--) {
    const k = coins[i]; k.t += dt;
    const f = Math.min(1, k.t / 0.6);
    k.m.position.lerpVectors(k.from, k.to, f); k.m.position.y += Math.sin(Math.PI * f) * 1.0; k.m.rotation.x = f >= 1 ? 0 : k.t * 12;
    if (k.t > 0.6 && !k.rang) { k.rang = true; emit('sfx', 'coin'); spawn('star', k.m.position, '#ffd75e', { n: 5, up: 1, out: 1.2, life: 0.5, grow: 0 }); }
    if (k.t > 4) { scene.remove(k.m); coins.splice(i, 1); }
  }

  // tickets fly from the waiter to the rail, then ride to a station
  const railOrder = S.rail;
  for (const [id, tk] of ticketMeshes) {
    const it = itemById(id); if (!it) continue;
    let goal;
    if (it.state === 'ready') goal = RAIL_SLOTS[Math.min(railOrder.indexOf(id), RAIL_SLOTS.length - 1)] || RAIL_SLOTS[0];
    else { const chef = S.chefs.find(c => c.itemId === id); const cc = chef && chefChars.get(chef.id); goal = cc ? cc.ch.g.position.clone().add(V(0.35, 1.25, 0.2)) : RAIL_SLOTS[0]; }
    if (tk.t < 1) { tk.t = Math.min(1, tk.t + dt / 0.6); const e = tk.t * tk.t * (3 - 2 * tk.t); tk.g.position.lerpVectors(tk.from, goal, e); tk.g.position.y += Math.sin(Math.PI * tk.t) * 0.8; }
    else tk.g.position.lerp(goal, Math.min(1, dt * 10));
  }
  if (railOrder.length) label('rail', `<div class="ovn rail">${ICON.ticket}<b>${railOrder.length}</b> on the rail</div>`, railTgt.top.clone().add(V(0, 0.55, -0.6)), { pri: 2, click: 'rail' });

  // plates slide along the counter
  S.counter.forEach((id, i) => {
    const p = counterPlates.get(id); if (!p) return;
    const goal = COUNTER_SLOTS[Math.min(i, COUNTER_SLOTS.length - 1)];
    if (p.t < 1) { p.t = Math.min(1, p.t + dt / 0.5); p.g.position.lerpVectors(p.from, goal, p.t); p.g.position.y += Math.sin(Math.PI * p.t) * 0.4; }
    else p.g.position.lerp(goal, Math.min(1, dt * 8));
  });
  if (S.counter.length) {
    const icons = S.counter.slice(0, 4).map(id => { const it = itemById(id); const ok = it?.tests?.ok !== false; return `<span class="pi ${ok ? 'ok' : 'burnt'}">${ok ? ICON.tick : ICON.flame}</span>`; }).join('');
    label('counter', `<div class="pt plates ${near?.id === 'counter' ? 'here' : ''}">${icons}${S.counter.length > 4 ? `<b>+${S.counter.length - 4}</b>` : ''}</div>`, counterTgt.top.clone().add(V(0.4, 0.75, 0)), { pri: 6, click: 'counter' });
  }
  for (const [id, ts] of Object.entries(tableSpots)) {
    const table = S.tables.find(x => x.id === Number(id));
    if (!table?.reserved && !table?.customerId) label(`free${id}`, '<div class="freetag">free table</div>', ts.top.clone().add(V(0, 0.35, 0.3)), { pri: 0 });
  }
}
export const world = { cooking: 0 };

export function dust(n = 5) { spawn('puff', player.g.position.clone().add(V(0, 0.12, 0)), '#f3e2c0', { n, spread: 0.4, up: 0.5, out: 1.2, life: 0.45, size: 1.1, opacity: 0.7 }); }
export function billFx(customerId) { confetti(customerPos(customerId)); shake(0.18); }
export { popup };
