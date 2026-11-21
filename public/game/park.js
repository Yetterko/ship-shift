// The park: the lawn every kitchen opens onto, the 24 restaurant plots around it, and everybody standing on it.
//
// ====================================================================================================================
// INTEGRATION NOTE FOR BUILDER C  (modules: park.js, net.js, presence.js, parkinput.js, townboard.js, world.css)
// ====================================================================================================================
// Nothing in these modules touches the kitchen scene or any existing file. They share scene.js's renderer, camera,
// label(), popup() and quality, and core.js's toast(), emit() and store. All town DOM is built from script inside #stage,
// so index.html needs one line only:  <link rel="stylesheet" href="/world.css">
//
// 1. Boot, once the first `world` message has arrived (net.onWorld):
//      buildPark(world)                    builds parkScene (idempotent). addScene('park', parkScene) is yours.
//      initParkInput({ standalone:false, onZone, onBoard })     parkinput.js: the park's keys, taps, HUD card, pad, wheel
//      initTownBoard({ kitchen, kitchenActions, onStartOver })  townboard.js: town strip, feed, offers tray, chalkboard
//    then on every world message:  syncPark(world); syncTownUi(world)    (townboard.js)
//
// 2. Socket (game.js connect()):  ws.onopen = () => attach(ws);  ws.onmessage: `if (route(m)) return;`  (net.js)
//    net.js feeds presence.js itself. `state`, `reset` are passed through to you (route returns false for them).
//
// 3. Frame loop while the zone is 'park' (instead of step/animateWorld/updateCamera/render):
//      nextFrame();
//      parkFrame(dt, t, moveVector?)   parkinput.js: walks `me`, sends sendPos(), resolves what E would do, draws the card
//      stepPark(dt, t);                this file: everybody's animation, smoke, labels (calls scene.js label())
//      townFrame(t);                   townboard.js: countdowns
//      adapt(); updateParkCamera(dt, me);  placeLabels();  renderPark();
//    updateParkCamera/renderPark are optional: the park also draws correctly through your own follow camera and
//    effect.render(parkScene, camera), because every park material opts out of OutlineEffect and carries its own outline
//    (an inverted hull, so instanced meshes outline correctly and the whole park is ONE render pass). renderer.info after
//    renderPark() is the whole frame; parkStats() reports it.
//
// 4. Zones. E on a doormat ends in net.go('k:<plot>') and E on the kitchen Door in net.go('park'); both answer with a
//    `zone` message. On net.onZone(m):
//      m.zone === 'park'  ->  setParkActive(true); placeMe(m.x, m.z); document.body.dataset.zone = 'park'
//      otherwise          ->  setParkActive(false); document.body.dataset.zone = 'kitchen' | 'visit'
//    world.css hides the kitchen's card, quest, pad and thumb while body[data-zone="park"], and shows the park's own.
//
// 5. Input. With standalone:false parkinput.js adds no listeners of its own. Hand it:
//      parkKey(e) -> true when it used the key        (WASD/arrows are read from the move vector you pass to parkFrame)
//      parkTap(clientX, clientY)                      a click or a quick finger tap on the canvas
//      parkFrame(dt, t, { x, y, mag })                x right, y down the screen, as input.js's stick/keys already are
//      parkPress('E'|'F'|'R'|'Q'|'Shift'|'C'|'B'|'V'|'1'..'4')   the same thing a key does, for buttons
//    Keys the park uses: E F R Q Shift 1-4 C B N V Esc. It leaves ? H P M ` L to the page. V is the whole-town view.
//
// 6. Test hooks (for __ship.town): parkPlayers(), parkCards(), parkStats(), walkTo(x, z) -> Promise, screenOf(x, z),
//    me, setOverview(on), and from parkinput.js: hotTarget(), actions(), doTake(id), doPut(id, plot).
//
// 7. Kitchen zones: presence.syncAvatars(zone, world, kit) + stepAvatars(dt, t) draw visitors with the kitchen's own
//    character(); the kit is described in presence.js. Keep calling net.sendPos() there every frame.
//
// Exports of this file
//   parkScene, me                       the THREE.Scene; your own avatar's state { x, z, r, moving, dash, ... }
//   buildPark(world), syncPark(world), stepPark(dt, t)
//   parkBlocked(x, z, r)                true where nobody can stand
//   plotFrame(id), queueSpot(plot, k), offerSpot(plot, k), cardXZ(id)
//   placeMe(x, z), kickMe(amount), setHot(hot | null), setGoal(x, z | null)
//   updateParkCamera(dt, focus), setOverview(on), isOverview(), renderPark(), groundAt(clientX, clientY), screenOf(x, z)
//   parkPlayers(), parkCards(), parkStats(), puff(...), celebrateAt(x, z)
// ====================================================================================================================
import { THREE, V, camera, renderer, stage, toon, canvasTex, signTex, label, popup, blob, quality, toScreen } from './scene.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { clamp, esc, emit, reduceMotion } from './core.js';
import { LOOKS, EMOTES, PHRASES, sample, meaning } from './presence.js';

export const parkScene = new THREE.Scene();
parkScene.background = new THREE.Color('#1c1420');
parkScene.add(new THREE.HemisphereLight('#fff1dc', '#6b5a7a', 1.25));
const sun = new THREE.DirectionalLight('#ffe2b8', 2.5); sun.position.set(-5, 13, 7); parkScene.add(sun);

const C = { cream: '#fff1d6', cream2: '#ecd9b0', wood: '#d79a5b', woodDark: '#a8683a', ink: '#3a241c', brick: '#c8684a', brass: '#e6b24a', stone: '#ddd2c0', stoneDark: '#b8ab98', teal: '#3f9e98', cab: '#3d6475', leaf: '#6dbb58', leaf2: '#58a64e', leaf3: '#8bcf68', red: '#dc4a3a', mustard: '#f2b23a' };
const SIZE_COLOR = { S: '#57b86a', M: '#4aa3d8', L: '#e5533d' };
const HW = 20, HH = 9;

/* ======================= geometry: everything static is merged, everything repeated is instanced ======================= */
const geos = new Map();
const geo = (k, make) => { if (!geos.has(k)) geos.set(k, make()); return geos.get(k); };
const gbox = (w, h, d, r = 0.05, seg = 1) => geo(`b${w},${h},${d},${r},${seg}`, () => new RoundedBoxGeometry(w, h, d, seg, Math.min(r, w / 2 - 0.001, h / 2 - 0.001, d / 2 - 0.001)));
const gcyl = (rt, rb, h, seg = 14) => geo(`c${rt},${rb},${h},${seg}`, () => new THREE.CylinderGeometry(rt, rb, h, seg));
const gsph = (r, seg = 12) => geo(`s${r},${seg}`, () => new THREE.SphereGeometry(r, seg, Math.max(6, Math.round(seg * 0.7))));
const gcone = (r, h, seg = 8) => geo(`k${r},${h},${seg}`, () => new THREE.ConeGeometry(r, h, seg));
const gcap = (r, len) => geo(`p${r},${len}`, () => new THREE.CapsuleGeometry(r, len, 5, 14));
const gdisc = (r, seg = 32) => geo(`d${r},${seg}`, () => new THREE.CircleGeometry(r, seg).rotateX(-Math.PI / 2));
const grect = (w, d) => geo(`r${w},${d}`, () => new THREE.PlaneGeometry(w, d).rotateX(-Math.PI / 2));
/** A gabled roof: ridge along x, standing on y = 0. */
const gprism = (w, h, d) => geo(`g${w},${h},${d}`, () => {
  const a = [-w / 2, 0, d / 2], b = [w / 2, 0, d / 2], c = [w / 2, 0, -d / 2], e = [-w / 2, 0, -d / 2], f = [-w / 2, h, 0], g = [w / 2, h, 0];
  const tris = [a, b, g, a, g, f, c, e, f, c, f, g, e, a, f, b, c, g, a, e, c, a, c, b];
  const gm = new THREE.BufferGeometry(); gm.setAttribute('position', new THREE.Float32BufferAttribute(tris.flat(), 3)); gm.computeVertexNormals();
  return gm;
});

const M = new THREE.Matrix4(), NM = new THREE.Matrix3(), Q = new THREE.Quaternion(), E = new THREE.Euler(), P = V(), S = V(), v = V(), col = new THREE.Color();
/** Collects coloured shapes and builds one geometry out of them. tint 1 or 2 marks the parts an instance colours. */
class Batch {
  constructor() { this.P = []; this.N = []; this.K = []; this.T = []; this.U = []; this.I = []; this.n = 0; this.base = null; }
  add(g, color, x = 0, y = 0, z = 0, { rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1, s = 1, tint = 0 } = {}) {
    M.compose(P.set(x, y, z), Q.setFromEuler(E.set(rx, ry, rz)), S.set(sx * s, sy * s, sz * s));
    if (this.base) M.premultiply(this.base);
    NM.getNormalMatrix(M); col.set(color);
    const pa = g.attributes.position, na = g.attributes.normal, ua = g.attributes.uv, n0 = this.n;
    for (let i = 0; i < pa.count; i++) {
      v.fromBufferAttribute(pa, i).applyMatrix4(M); this.P.push(v.x, v.y, v.z);
      v.fromBufferAttribute(na, i).applyMatrix3(NM).normalize(); this.N.push(v.x, v.y, v.z);
      this.K.push(col.r, col.g, col.b); this.T.push(tint); this.U.push(ua ? ua.getX(i) : 0, ua ? ua.getY(i) : 0);
    }
    if (g.index) for (let i = 0; i < g.index.count; i++) this.I.push(n0 + g.index.getX(i)); else for (let i = 0; i < pa.count; i++) this.I.push(n0 + i);
    this.n += pa.count; return this;
  }
  /** A box standing on y. */
  box(w, h, d, color, x, y, z, o = {}) { return this.add(gbox(w, h, d, o.r ?? 0.05), color, x, y + h / 2, z, o); }
  cyl(rt, rb, h, color, x, y, z, o = {}) { return this.add(gcyl(rt, rb, h, o.seg ?? 14), color, x, y + h / 2, z, o); }
  ball(r, color, x, y, z, o = {}) { return this.add(gsph(r, o.seg ?? 12), color, x, y, z, o); }
  /** Everything added inside fn is placed at x, z, turned by ry and scaled by s. */
  at(x, z, ry, s, fn) {
    const was = this.base, m = new THREE.Matrix4().compose(V(x, 0, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, ry, 0)), V(s, s, s));
    this.base = was ? was.clone().multiply(m) : m; fn(this); this.base = was; return this;
  }
  build() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.P, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(this.N, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.K, 3)); g.setAttribute('tint', new THREE.Float32BufferAttribute(this.T, 1));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.U, 2)); g.setIndex(this.I);
    // the outline pushes each vertex along the average normal of everything that meets there, so hard edges stay closed
    const acc = new Map(), keys = new Array(this.n);
    for (let i = 0; i < this.n; i++) {
      const k = keys[i] = `${Math.round(this.P[i * 3] * 400)},${Math.round(this.P[i * 3 + 1] * 400)},${Math.round(this.P[i * 3 + 2] * 400)}`;
      let a = acc.get(k); if (!a) { a = [0, 0, 0]; acc.set(k, a); }
      a[0] += this.N[i * 3]; a[1] += this.N[i * 3 + 1]; a[2] += this.N[i * 3 + 2];
    }
    const sn = new Float32Array(this.n * 3);
    for (let i = 0; i < this.n; i++) { const a = acc.get(keys[i]), l = Math.hypot(a[0], a[1], a[2]) || 1; sn[i * 3] = a[0] / l; sn[i * 3 + 1] = a[1] / l; sn[i * 3 + 2] = a[2] / l; }
    g.setAttribute('sn', new THREE.BufferAttribute(sn, 3));
    g.computeBoundingSphere();
    return g;
  }
}

/* ---------- materials ---------- */
const NO_OUTLINE = { visible: false };
const uLine = { value: 0.03 };
const base = toon('#ffffff', { key: 'park' });
/** Cel-shaded, coloured per vertex; on an instanced mesh `tint` picks the instance colour (1) or its second colour c2 (2). */
const tintMat = base.clone(); tintMat.vertexColors = true; tintMat.userData.outlineParameters = NO_OUTLINE;
tintMat.onBeforeCompile = sh => {
  sh.vertexShader = 'attribute float tint;\nattribute vec3 c2;\n' + sh.vertexShader.replace('#include <color_vertex>', '#include <color_vertex>\n#ifdef USE_INSTANCING_COLOR\n vColor.rgb = color * (tint < 0.5 ? vec3(1.0) : (tint < 1.5 ? instanceColor.rgb : c2));\n#endif');
};
tintMat.customProgramCacheKey = () => 'park-tint';
const lineMat = new THREE.MeshBasicMaterial({ color: '#33190f', side: THREE.BackSide, toneMapped: false });
lineMat.userData.outlineParameters = NO_OUTLINE;
lineMat.onBeforeCompile = sh => {
  sh.uniforms.uLine = uLine;
  sh.vertexShader = 'attribute vec3 sn;\nuniform float uLine;\n' + sh.vertexShader.replace('#include <begin_vertex>', 'vec3 transformed = position + sn * uLine;');
};
lineMat.customProgramCacheKey = () => 'park-line';
const glowMat = new THREE.MeshBasicMaterial({ color: '#ffffff', vertexColors: true, toneMapped: false }); glowMat.userData.outlineParameters = NO_OUTLINE;
const faceMat = new THREE.MeshBasicMaterial({ color: '#ffffff', vertexColors: true }); faceMat.userData.outlineParameters = NO_OUTLINE;
/** A texture cut into `cells` side by side; each instance shows the one its `cell` attribute names. */
function atlasMat(map, cells, opts = {}) {
  const m = new THREE.MeshBasicMaterial({ map, toneMapped: false, ...opts });
  m.userData.outlineParameters = NO_OUTLINE;
  m.onBeforeCompile = sh => { sh.vertexShader = 'attribute float cell;\n' + sh.vertexShader.replace('#include <uv_vertex>', `#include <uv_vertex>\n vMapUv = vec2((uv.x + cell) / ${cells}.0, uv.y);`); };
  m.customProgramCacheKey = () => `park-atlas${cells}`;
  return m;
}

const outlines = [];
function outlined(mesh) {
  const o = mesh.isInstancedMesh ? new THREE.InstancedMesh(mesh.geometry, lineMat, mesh.instanceMatrix.count) : new THREE.Mesh(mesh.geometry, lineMat);
  if (mesh.isInstancedMesh) { o.instanceMatrix = mesh.instanceMatrix; o.count = 0; }
  o.frustumCulled = mesh.frustumCulled; o.matrixAutoUpdate = false; o.userData.of = mesh;
  mesh.add(o); outlines.push(o);
  return mesh;
}
const white = new THREE.Color('#ffffff');
/** An instanced mesh with a colour per instance, and optionally a second colour and an outline. */
function inst(geometry, cap, { mat = tintMat, outline = true, c2 = false, attr = null, order = 0 } = {}) {
  const m = new THREE.InstancedMesh(geometry, mat, cap);
  m.frustumCulled = false; m.count = 0; m.renderOrder = order;
  m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  for (let i = 0; i < cap; i++) m.setColorAt(i, white);
  m.instanceColor.setUsage(THREE.DynamicDrawUsage);
  if (c2) { m.c2 = new THREE.InstancedBufferAttribute(new Float32Array(cap * 3), 3); m.c2.setUsage(THREE.DynamicDrawUsage); geometry.setAttribute('c2', m.c2); }
  if (attr) { m[attr] = new THREE.InstancedBufferAttribute(new Float32Array(cap), 1); m[attr].setUsage(THREE.DynamicDrawUsage); geometry.setAttribute(attr, m[attr]); }
  parkScene.add(m);
  return outline ? outlined(m) : m;
}
const setM = (m, i, mat4) => mat4.toArray(m.instanceMatrix.array, i * 16);
const setC = (attr, i, c) => { const a = attr.array; a[i * 3] = c.r; a[i * 3 + 1] = c.g; a[i * 3 + 2] = c.b; };
const flush = (m, n) => { m.count = n; m.instanceMatrix.needsUpdate = true; if (m.instanceColor) m.instanceColor.needsUpdate = true; if (m.c2) m.c2.needsUpdate = true; if (m.cell) m.cell.needsUpdate = true; for (const o of m.children) if (o.isInstancedMesh) o.count = n; };
const colors = new Map();
const colorOf = hex => { let c = colors.get(hex); if (!c) { c = new THREE.Color(hex); colors.set(hex, c); } return c; };
const TRS = (m, x, y, z, rx = 0, ry = 0, rz = 0, sx = 1, sy = sx, sz = sx, order = 'XYZ') => m.compose(P.set(x, y, z), Q.setFromEuler(E.set(rx, ry, rz, order)), S.set(sx, sy, sz));

/* ======================= where things stand ======================= */
const SIDE = { n: { ox: 0, oz: -1, ax: 1, az: 0, ry: 0 }, s: { ox: 0, oz: 1, ax: 1, az: 0, ry: Math.PI }, e: { ox: 1, oz: 0, ax: 0, az: 1, ry: -Math.PI / 2 }, w: { ox: -1, oz: 0, ax: 0, az: 1, ry: Math.PI / 2 } };
const frames = [];
/** A plot's doormat, which way its building lies (ox, oz), which way its queue runs (ax, az), and where its sign post is. */
export const plotFrame = id => frames[id] || null;
export function queueSpot(id, k, out = {}) {
  const f = frames[id], a = 0.95 + 0.62 * (k % 3), b = 0.05 + 0.8 * Math.floor(k / 3);
  out.x = f.x + f.ax * a - f.ox * b; out.z = f.z + f.az * a - f.oz * b; return out;
}
export function offerSpot(id, k, out = {}) {
  const f = frames[id], a = 0.95 + 0.62 * (k % 2), b = 0.05 + 0.8 * Math.floor(k / 2);
  out.x = f.x - f.ax * a - f.ox * b; out.z = f.z - f.az * a - f.oz * b; return out;
}
const circles = [], rects = [];
export function parkBlocked(x, z, r = 0.3) {
  if (x < -HW + r || x > HW - r || z < -HH + r || z > HH - r) return true;
  for (const c of circles) if (Math.hypot(x - c.x, z - c.z) < c.r + r) return true;
  for (const b of rects) if (x > b.x0 - r && x < b.x1 + r && z > b.z0 - r && z < b.z1 + r) return true;
  return false;
}

/* ======================= characters: every chef and customer in the park is drawn by the same few instanced meshes ======================= */
const CAP = 224;
const rig = { n: 0, chefs: 0, custs: 0, tickets: 0, icons: 0 };
const BODIES = ['#c98bd6', '#6cc3c9', '#e8a25c', '#9fc46a', '#ee8fa6', '#8aa2e8'], SKINS = ['#f3c9a0', '#d19c72', '#94603f', '#f6dcc0'], HAIRS = ['#5a3a2a', '#2c2430', '#c7772e', '#e8c56a'];
function buildRig() {
  let b = new Batch();
  b.add(gcap(0.31, 0.2), '#fffaf0', 0, 0.5, 0).box(0.44, 0.4, 0.1, '#ffffff', 0, 0.2, 0.25, { tint: 1 }).box(0.2, 0.14, 0.03, C.cream, 0, 0.3, 0.3, { r: 0.02 }).cyl(0.27, 0.3, 0.1, '#ffffff', 0, 0.72, 0, { tint: 1, seg: 16 });
  rig.bodyChef = inst(b.build(), CAP);
  b = new Batch(); b.add(gcap(0.31, 0.2), '#ffffff', 0, 0.5, 0, { tint: 1 });
  rig.bodyCust = inst(b.build(), CAP);
  // heads are built around the neck, which is where they tip back from
  b = new Batch();
  b.ball(0.36, '#ffffff', 0, 0.3, 0, { tint: 1, seg: 18 }).cyl(0.25, 0.24, 0.3, '#ffffff', 0, 0.56, 0, { seg: 16 }).ball(0.31, '#ffffff', 0, 0.94, 0, { sy: 0.72, seg: 14 }).cyl(0.26, 0.252, 0.1, '#ffffff', 0, 0.58, 0, { tint: 2, seg: 16 });
  rig.headChef = inst(b.build(), CAP, { c2: true });
  b = new Batch();
  b.ball(0.36, '#ffffff', 0, 0.3, 0, { tint: 1, seg: 18 }).ball(0.365, '#ffffff', 0, 0.37, -0.055, { tint: 2, sx: 1.02, sy: 0.92, seg: 14 });
  rig.headCust = inst(b.build(), CAP, { c2: true });
  b = new Batch();
  for (const s of [-1, 1]) {
    b.ball(0.068, C.ink, 0.135 * s, 0.32, 0.318, { sy: 1.3, sz: 0.55, seg: 10 }).ball(0.026, '#ffffff', 0.135 * s + 0.022, 0.36, 0.352, { seg: 6 });
    b.ball(0.06, '#f08f86', 0.245 * s, 0.2, 0.262, { sy: 0.6, sz: 0.3, seg: 8 });
  }
  rig.face = inst(b.build(), CAP, { mat: faceMat, outline: false });
  b = new Batch(); b.ball(0.105, '#ffffff', 0, 0, 0, { tint: 1, seg: 10 });
  rig.hands = inst(b.build(), CAP * 2);
  b = new Batch(); b.ball(0.11, C.ink, 0, 0, 0, { seg: 10 });
  rig.feet = inst(b.build(), CAP * 2);
  const shadowMat = blob(1, 1, 0, 0, new THREE.Group()).material;
  rig.shadow = inst(grect(1, 1).clone(), CAP + 120, { mat: shadowMat, outline: false, order: 1 });
  // the order ticket a customer holds up, and the little signs over people's heads
  b = new Batch(); b.box(0.36, 0.44, 0.05, C.cream, 0, -0.22, 0, { r: 0.03 }).box(0.37, 0.15, 0.06, '#ffffff', 0, 0.07, 0, { tint: 1, r: 0.03 });
  rig.ticket = inst(b.build(), CAP);
  rig.icon = inst(new THREE.PlaneGeometry(0.72, 0.72), 64, { mat: atlasMat(iconTex(), 5, { transparent: true, depthWrite: false }), outline: false, attr: 'cell', order: 4 });
}
function iconTex() {
  return canvasTex(640, 128, g => {
    const disc = (i, fill) => { g.fillStyle = C.ink; g.beginPath(); g.arc(i * 128 + 64, 64, 60, 0, 7); g.fill(); g.fillStyle = fill; g.beginPath(); g.arc(i * 128 + 64, 64, 51, 0, 7); g.fill(); };
    g.lineJoin = g.lineCap = 'round';
    // wave: an open hand
    disc(0, '#ffe2a8'); g.fillStyle = '#f3c9a0'; g.strokeStyle = C.ink; g.lineWidth = 6;
    g.beginPath(); g.roundRect(42, 52, 44, 44, 14); g.fill(); g.stroke();
    for (let i = 0; i < 4; i++) { g.beginPath(); g.roundRect(42 + i * 11.4, 26 + Math.abs(i - 1.5) * 5, 10, 36, 5); g.fill(); g.stroke(); }
    g.beginPath(); g.roundRect(28, 60, 20, 12, 6); g.fill(); g.stroke();
    // cheer: a star
    disc(1, '#fff1d6'); g.fillStyle = '#ffd23f'; g.lineWidth = 6; g.beginPath();
    for (let i = 0; i < 10; i++) { const a = -Math.PI / 2 + i * Math.PI / 5, r = i % 2 ? 17 : 40; g.lineTo(192 + Math.cos(a) * r, 66 + Math.sin(a) * r); }
    g.closePath(); g.fill(); g.stroke();
    // help: an exclamation mark
    disc(2, '#ff5a3c'); g.fillStyle = '#fff'; g.beginPath(); g.roundRect(310, 26, 20, 52, 9); g.fill(); g.beginPath(); g.arc(320, 96, 11, 0, 7); g.fill();
    // heart
    disc(3, '#ffd9e2'); g.fillStyle = '#e5484d'; g.lineWidth = 6; g.beginPath(); g.moveTo(448, 100); g.bezierCurveTo(392, 62, 414, 22, 448, 46); g.bezierCurveTo(482, 22, 504, 62, 448, 100); g.fill(); g.stroke();
    // an offer waiting for an answer
    disc(4, '#ffd75e'); g.strokeStyle = C.ink; g.lineWidth = 15; g.beginPath(); g.arc(576, 50, 20, Math.PI * 1.05, Math.PI * 2.45); g.quadraticCurveTo(576, 72, 576, 82); g.stroke(); g.fillStyle = C.ink; g.beginPath(); g.arc(576, 104, 9.5, 0, 7); g.fill();
  });
}
function newChar(kind, o = {}) {
  return { kind, x: 0, z: 0, y: 0, r: 0, sc: kind === 'chef' ? 1.22 : 1.08, moving: false, pace: 1, mood: 'idle', squash: 0, squashV: 0, phase: Math.random() * 6, seed: Math.random() * 6, blink: 2 + Math.random() * 3, hx: -0.38, hy: 0, h: [-0.45, 0.5, 0.06, 0.45, 0.5, 0.06], grow: 1, icon: -1, iconAt: 0, ticket: null, a: white, b: white, skin: white, ...o };
}
function spring(o, dt) {
  let x = o.squash, s = o.squashV;
  for (let left = Math.min(dt, 0.1); left > 1e-5; left -= 1 / 240) { const h = Math.min(left, 1 / 240); s += (-x * 220 - s * 14) * h; x += s * h; }
  if (!Number.isFinite(x) || !Number.isFinite(s)) { x = 0; s = 0; }
  o.squash = clamp(x, -0.45, 0.45); o.squashV = s;
  return o.squash;
}
const kick = (o, amount = 0.25) => { o.squashV -= amount * 14; };
const mA = new THREE.Matrix4(), mB = new THREE.Matrix4(), mC = new THREE.Matrix4(), mD = new THREE.Matrix4();
/** One character for this frame: the same poses the kitchen's chefs strike, written straight into the instance buffers. */
function drawChar(ch, dt, t) {
  if (rig.n >= CAP || ch.grow <= 0.01) return;
  const i = rig.n++, chef = ch.kind === 'chef', sc = ch.sc * ch.grow, mood = ch.mood, moving = ch.moving;
  const s = spring(ch, dt);
  if (moving) ch.phase += dt * 13 * ch.pace;
  const w = Math.sin(ch.phase), breathe = Math.sin(t * 2.2 + ch.seed) * 0.02;
  const still = !moving && !reduceMotion, idle = still && (mood === 'idle' || mood === 'wave');
  const hop = mood === 'cheer' && !reduceMotion ? Math.abs(Math.sin(t * 9 + ch.seed)) * 0.16 : 0;
  TRS(mA, ch.x, ch.y, ch.z, moving ? 0.1 : 0, ch.r, 0, sc, sc, sc, 'YXZ');
  TRS(mB, 0, (moving ? Math.abs(w) * 0.09 : breathe) + hop, 0, 0, 0, idle ? Math.sin(t * 1.1 + ch.seed) * 0.035 : 0, 1 - s * 0.55, 1 + s, 1 - s * 0.55).premultiply(mA);
  const ease = Math.min(1, dt * 6);
  const lookY = idle ? Math.sin(t * 0.8 + ch.seed) * 0.3 + Math.sin(t * 0.33 + ch.seed * 2) * 0.22 : 0;
  ch.hy += (lookY - ch.hy) * ease; ch.hx += ((mood === 'cheer' ? -0.6 : -0.38) - ch.hx) * ease;
  TRS(mC, 0, 0.78, 0, ch.hx, ch.hy, !still ? 0 : idle ? Math.sin(t * 0.9 + ch.seed) * 0.06 : mood === 'blocked' ? Math.sin(t * 11) * 0.09 : 0).premultiply(mB);
  const body = chef ? rig.bodyChef : rig.bodyCust, head = chef ? rig.headChef : rig.headCust, k = chef ? rig.chefs++ : rig.custs++;
  setM(body, k, mB); setC(body.instanceColor, k, ch.a);
  setM(head, k, mC); setC(head.instanceColor, k, ch.skin); setC(head.c2, k, ch.b);
  ch.blink -= dt; if (ch.blink < 0) ch.blink = 2 + Math.random() * 4;
  mD.copy(mC);
  if (ch.blink < 0.11) mD.multiply(TRS(mA, 0, 0.32, 0, 0, 0, 0, 1, 0.14, 1)).multiply(TRS(mA, 0, -0.32, 0));
  setM(rig.face, i, mD);
  // hands
  const h = ch.h, e16 = Math.min(1, dt * 16);
  const set = (j, x, y, z) => { h[j] += (x - h[j]) * e16; h[j + 1] += (y - h[j + 1]) * e16; h[j + 2] += (z - h[j + 2]) * e16; };
  if (mood === 'blocked') { set(0, -0.52, 1.25 + Math.sin(t * 11) * 0.14, 0.1); set(3, 0.52, 1.25 + Math.cos(t * 11) * 0.14, 0.1); }
  else if (mood === 'cheer') { set(0, -0.5, 1.35 + Math.sin(t * 16) * 0.06, 0.05); set(3, 0.5, 1.35 - Math.sin(t * 16) * 0.06, 0.05); }
  else if (mood === 'wave') { set(0, -0.45, 0.5, 0.06); set(3, 0.5 + Math.sin(t * 10) * 0.12, 1.32, 0.12); }
  else if (moving) { set(0, -0.45, 0.5 - w * 0.1, 0.06 - w * 0.22); set(3, 0.45, 0.5 + w * 0.1, 0.06 + w * 0.22); }
  else { set(0, -0.45, 0.5 + breathe * 2, 0.06); set(3, 0.45, 0.5 + breathe * 2, 0.06); }
  for (let j = 0; j < 2; j++) {
    setM(rig.hands, i * 2 + j, TRS(mD, h[j * 3], h[j * 3 + 1], h[j * 3 + 2]).premultiply(mB)); setC(rig.hands.instanceColor, i * 2 + j, ch.skin);
    const sg = j ? -1 : 1, fz = moving ? 0.03 + sg * w * 0.16 : 0.03, fy = moving ? 0.07 + Math.max(0, sg * w) * 0.08 : 0.07;
    setM(rig.feet, i * 2 + j, TRS(mD, j ? 0.15 : -0.15, fy, fz, 0, 0, 0, 1, 0.65, 1.4).premultiply(mB));
  }
  setM(rig.shadow, shadowBase + i, TRS(mD, ch.x, 0.02, ch.z, 0, 0, 0, sc * 1.15, 1, sc * 1.15));
  if (ch.ticket && rig.tickets < CAP) {
    const j = rig.tickets++;
    setM(rig.ticket, j, TRS(mD, ch.x, (2.42 + Math.sin(t * 2.4 + ch.seed) * 0.05) * sc + ch.y, ch.z, -0.35, Math.sin(t * 1.3 + ch.seed) * 0.25, 0, sc * 0.92)); setC(rig.ticket.instanceColor, j, ch.ticket);
  }
  if (ch.icon >= 0 && rig.icons < 64) {
    const j = rig.icons++, age = (performance.now() - ch.iconAt) / 1000, pop = ch.iconAt ? Math.min(1, age * 7) * (1 + Math.max(0, 0.25 - age) * 1.2) : 1;
    mD.compose(P.set(ch.x, (ch.ticket ? 3.05 : 2.75) * sc + Math.sin(t * 5 + ch.seed) * 0.05 + ch.y, ch.z), camera.quaternion, S.setScalar(pop * (quality.mobile ? 1.25 : 1)));
    setM(rig.icon, j, mD); rig.icon.cell.array[j] = ch.icon;
  }
}

/* ======================= particles: one instanced mesh of puffs, one of flames ======================= */
const PUFFS = 200, puffs = [];
let puffMesh, flameMesh, flames = 0;
export function puff(x, y, z, color, { n = 1, spread = 0.15, up = 0.9, out = 0.3, life = 1.2, size = 1, grow = 0.6, gravity = 0 } = {}) {
  if (reduceMotion) n = Math.min(n, 2);
  if (quality.level > 0) n = Math.ceil(n * 0.6);
  for (let i = 0; i < n && puffs.length < PUFFS; i++) {
    puffs.push({ x: x + (Math.random() - 0.5) * spread, y, z: z + (Math.random() - 0.5) * spread, vx: (Math.random() - 0.5) * out, vy: up * (0.7 + Math.random() * 0.6), vz: (Math.random() - 0.5) * out, life: life * (0.8 + Math.random() * 0.4), t: 0, g: gravity, grow, s: size * (0.8 + Math.random() * 0.4), c: colorOf(Array.isArray(color) ? color[i % color.length] : color) });
  }
}
function stepPuffs(dt) {
  let n = 0;
  for (let i = puffs.length - 1; i >= 0; i--) {
    const p = puffs[i]; p.t += dt;
    if (p.t >= p.life) { puffs.splice(i, 1); continue; }
    p.vy -= p.g * dt; p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
    const f = p.t / p.life, sc = p.s * (1 + p.grow * f) * Math.min(1, f * 8) * (1 - f * f * f);
    setM(puffMesh, n, TRS(mD, p.x, p.y, p.z, 0, 0, 0, sc)); setC(puffMesh.instanceColor, n, p.c); n++;
  }
  flush(puffMesh, n);
}
export function celebrateAt(x, z) { puff(x, 1.2, z, ['#f2b23a', '#57b86a', '#5aa7e0', '#e5533d', '#fff4df'], { n: 22, up: 4.2, out: 4, life: 1.1, gravity: 9, grow: 0, size: 0.7 }); }

/* ======================= the build ======================= */
export const me = newChar('chef', { pid: null, dash: 0, visible: false });
export const park = { built: false, world: null, booted: false };
let ground, statics, glows, water, water2, bell, bus, houses, lots, panes, mats, signs, bulbs, rings, flagsMesh, hotRing, goalDot, boardFace, shadowBase = 0;
const boardState = { cols: [[], [], [], []], top: [] };

function lawnTex() {
  return canvasTex(256, 256, g => {
    const tone = ['#8fcf63', '#86c65b'];
    for (let i = 0; i < 2; i++) for (let j = 0; j < 2; j++) { g.fillStyle = tone[(i + j) % 2]; g.fillRect(i * 128, j * 128, 128, 128); }
    let s = 11; const rnd = () => (s = (s * 16807) % 2147483647) / 2147483647;
    for (let i = 0; i < 150; i++) {
      const x = rnd() * 256, y = rnd() * 256; g.strokeStyle = rnd() > 0.5 ? 'rgba(255,255,220,.22)' : 'rgba(40,110,50,.2)'; g.lineWidth = 2; g.lineCap = 'round';
      g.beginPath(); g.moveTo(x, y); g.lineTo(x + (rnd() - 0.5) * 5, y - 5 - rnd() * 5); g.stroke();
    }
  }, { repeat: [HW / 2, HH / 2] });
}
function tree(b, x, z, s, ry, kind = 0) {
  const [a, c, d] = kind === 1 ? ['#f4a6c0', '#ee8fb0', '#f9c3d4'] : kind === 2 ? ['#5fae6a', '#4d9a5e', '#7cc47c'] : [C.leaf, C.leaf2, C.leaf3];
  b.at(x, z, ry, s, () => {
    b.cyl(0.15, 0.22, 1.15, C.woodDark, 0, 0, 0, { seg: 8 });
    b.ball(0.95, a, 0, 1.8, 0).ball(0.68, c, 0.55, 1.4, 0.2).ball(0.64, d, -0.55, 1.45, -0.1).ball(0.56, d, 0.1, 2.5, 0.05).ball(0.5, c, -0.15, 1.5, 0.6);
    if (kind === 0) for (const [ax, ay, az] of [[0.5, 1.95, 0.75], [-0.6, 1.75, 0.55], [0.15, 2.3, 0.6]]) b.ball(0.1, '#e5533d', ax, ay, az, { seg: 8 });
  });
  circles.push({ x, z, r: 0.42 * s });
}
function bench(b, x, z, ry) {
  b.at(x, z, ry, 1, () => {
    b.box(1.5, 0.09, 0.46, C.wood, 0, 0.4, 0).box(1.5, 0.42, 0.08, C.wood, 0, 0.52, -0.22, { rx: -0.15 });
    for (const s of [-0.62, 0.62]) b.box(0.09, 0.42, 0.42, C.cab, s, 0, 0);
  });
  circles.push({ x, z, r: 0.62 });
}
function lamp(b, gl, x, z) {
  b.at(x, z, 0, 1, () => { b.cyl(0.16, 0.2, 0.14, C.cab, 0, 0, 0, { seg: 10 }).cyl(0.05, 0.07, 2.4, C.cab, 0, 0.1, 0, { seg: 8 }).box(0.26, 0.08, 0.26, C.cab, 0, 2.9, 0).box(0.12, 0.1, 0.12, C.cab, 0, 2.98, 0).box(0.44, 0.06, 0.44, C.cab, 0, 2.44, 0); });
  gl.at(x, z, 0, 1, () => gl.box(0.36, 0.42, 0.36, '#ffe9a8', 0, 2.48, 0, { r: 0.08 }));
  circles.push({ x, z, r: 0.2 });
}
function flowers(b, x, z, n, seed) {
  let s = seed; const rnd = () => (s = (s * 16807) % 2147483647) / 2147483647;
  const tones = ['#ffd75e', '#ee8fa6', '#fff4df', '#e5533d', '#c873d6'];
  for (let i = 0; i < n; i++) {
    const a = rnd() * 7, r = Math.sqrt(rnd()) * 0.75, fx = x + Math.cos(a) * r, fz = z + Math.sin(a) * r, hgt = 0.14 + rnd() * 0.1;
    b.add(gcone(0.07, hgt * 2, 5), C.leaf2, fx, hgt, fz).ball(0.085, tones[Math.floor(rnd() * tones.length)], fx, hgt * 2, fz, { seg: 6 });
  }
}
function boardStand(b, x, z, roof) {
  b.at(x, z, 0, 1, () => {
    for (const s of [-1.4, 1.4]) b.box(0.16, 2.5, 0.16, C.woodDark, s, 0, 0);
    b.box(3.05, 1.75, 0.14, C.woodDark, 0, 0.68, 0).box(3.3, 0.16, 0.26, roof, 0, 2.44, 0).box(2.6, 0.08, 0.18, C.wood, 0, 0.62, 0.12);
  });
  rects.push({ x0: x - 1.5, x1: x + 1.5, z0: z - 0.15, z1: z + 0.15 });
}
function houseGeo() {
  const b = new Batch(), T = { tint: 1 };
  b.box(4.0, 0.22, 3.1, '#b9684f', 0, 0, -1.45).box(3.8, 2.4, 2.9, C.cream, 0, 0.2, -1.45, { r: 0.08 });
  // roof, ridge, chimney
  b.add(gprism(4.3, 1.25, 3.6), '#ffffff', 0, 2.6, -1.45, T).box(4.4, 0.12, 0.18, C.cream, 0, 3.78, -1.45).box(4.34, 0.1, 0.12, C.cream, 0, 2.57, 0.33).box(4.34, 0.1, 0.12, C.cream, 0, 2.57, -3.23);
  b.box(0.5, 1.3, 0.5, C.brick, 1.15, 3.0, -2.2).box(0.64, 0.13, 0.64, C.cream, 1.15, 4.26, -2.2);
  // door, step, knob
  b.box(1.08, 1.64, 0.1, C.cream2, 0, 0.2, 0.01).box(0.86, 1.5, 0.1, '#c9c9c9', 0, 0.2, 0.06, T).ball(0.055, C.brass, 0.28, 0.92, 0.13, { seg: 8 }).box(1.4, 0.12, 0.42, C.stone, 0, 0, 0.24);
  // windows with flower boxes
  for (const s of [-1.25, 1.25]) {
    b.box(0.97, 0.87, 0.1, C.cream2, s, 0.66, 0.01).box(0.05, 0.66, 0.04, C.cream, s, 0.77, 0.08, { r: 0.01 }).box(0.76, 0.05, 0.04, C.cream, s, 1.07, 0.08, { r: 0.01 });
    b.box(1.0, 0.17, 0.22, C.woodDark, s, 0.48, 0.14);
    for (const [dx, tone] of [[-0.3, '#ffd75e'], [0, '#ee8fa6'], [0.3, '#fff4df']]) b.ball(0.09, tone, s + dx, 0.7, 0.16, { seg: 6 }).ball(0.08, C.leaf2, s + dx + 0.14, 0.66, 0.15, { seg: 6 });
  }
  // a short awning in the team's colour with cream stripes: short, so the door and windows show from above
  b.add(gbox(3.74, 0.07, 0.66, 0.03), '#ffffff', 0, 2.24, 0.3, { rx: 0.3, tint: 1 });
  for (const x of [-1.26, -0.42, 0.42, 1.26]) b.add(gbox(0.42, 0.09, 0.68, 0.03), C.cream, x, 2.245, 0.305, { rx: 0.3 });
  b.box(3.74, 0.16, 0.06, '#d8d8d8', 0, 1.98, 0.62, { tint: 1, r: 0.02 });
  // the name board on the eave, and a badge and windows on the back for whoever looks from behind
  b.box(2.36, 0.62, 0.08, C.cream, 0, 2.62, 0.4).box(2.2, 0.48, 0.1, '#4a3028', 0, 2.69, 0.42);
  for (const s of [-1.05, 1.05]) b.box(0.97, 0.87, 0.1, C.cream2, s, 0.66, -2.91);
  b.add(gcyl(0.36, 0.36, 0.08, 16), '#ffffff', 0, 1.9, -2.93, { rx: Math.PI / 2, tint: 1 }).add(gcyl(0.2, 0.2, 0.1, 12), C.cream, 0, 1.9, -2.95, { rx: Math.PI / 2 });
  for (const s of [-1, 1]) b.box(0.1, 0.87, 0.97, C.cream2, 1.91 * s, 0.66, -1.45);
  return b.build();
}
function paneGeo() {
  const b = new Batch();
  for (const s of [-1.25, 1.25]) b.box(0.76, 0.66, 0.03, '#ffffff', s, 0.77, 0.065, { r: 0.01 });
  for (const s of [-1.05, 1.05]) b.box(0.76, 0.66, 0.03, '#ffffff', s, 0.77, -2.965, { r: 0.01 });
  for (const s of [-1, 1]) b.box(0.03, 0.66, 0.76, '#ffffff', 1.965 * s, 0.77, -1.45, { r: 0.01 });
  b.box(0.4, 0.36, 0.03, '#ffffff', 0, 1.2, 0.115, { r: 0.01 });
  return b.build();
}
function lotGeo() {
  const b = new Batch();
  b.box(3.7, 0.06, 2.8, '#b99c70', 0, 0, -1.5, { r: 0.02 });
  for (const x of [-1.8, 0, 1.8]) b.box(0.13, 0.75, 0.13, C.woodDark, x, 0, -2.85);
  for (const x of [-1.8, 1.8]) for (const z of [-0.15, -1.5]) b.box(0.13, 0.75, 0.13, C.woodDark, x, 0, z);
  for (const y of [0.28, 0.56]) { b.box(3.7, 0.08, 0.06, C.wood, 0, y, -2.85); for (const x of [-1.8, 1.8]) b.box(0.06, 0.08, 2.75, C.wood, x, y, -1.5); }
  b.box(0.6, 0.5, 0.6, C.wood, -0.9, 0.05, -1.9).box(0.5, 0.42, 0.5, C.woodDark, -0.3, 0.05, -2.1, { ry: 0.4 }).box(0.44, 0.4, 0.44, C.wood, -0.8, 0.55, -1.95, { ry: 0.3 });
  b.ball(0.34, C.leaf2, 1.0, 0.3, -1.2).ball(0.26, C.leaf3, 1.3, 0.24, -0.9).ball(0.22, C.leaf, 0.75, 0.2, -0.85);
  return b.build();
}
function signTexture() {
  const W = 256, H = 160;
  const cells = [['OPEN', 'to my team', '#57b86a', '#fff'], ['HELP', 'wanted', '#ffd23f', C.ink], ['PRIVATE', 'watch only', '#e5533d', '#fff'], ['BACK', 'soon', '#bfe3f5', C.ink], ['FOR', 'lease', C.cream, C.ink]];
  return signTex(W * cells.length, H, g => {
    g.clearRect(0, 0, W * cells.length, H);
    cells.forEach(([big, small, bg, fg], i) => {
      const x = i * W;
      g.fillStyle = C.ink; g.beginPath(); g.roundRect(x + 4, 4, W - 8, H - 8, 26); g.fill();
      g.fillStyle = bg; g.beginPath(); g.roundRect(x + 14, 14, W - 28, H - 28, 18); g.fill();
      g.fillStyle = fg; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.font = `${big.length > 5 ? 44 : 60}px Bungee, "Arial Black", sans-serif`; g.fillText(big, x + W / 2, 68);
      g.font = '700 30px Rubik, system-ui, sans-serif'; g.fillText(small, x + W / 2, 116);
    });
  });
}
function boardTexture() {
  return signTex(1024, 288, g => {
    // the chalkboard: the town's kanban in four columns, a note per customer in its team's colour
    g.fillStyle = '#2f5d50'; g.fillRect(0, 0, 512, 288);
    g.strokeStyle = 'rgba(255,255,255,.35)'; g.lineWidth = 3;
    for (let i = 1; i < 4; i++) { g.beginPath(); g.moveTo(i * 128, 54); g.lineTo(i * 128, 276); g.stroke(); }
    g.beginPath(); g.moveTo(12, 54); g.lineTo(500, 54); g.stroke();
    g.fillStyle = '#fff4df'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.font = '22px Bungee, "Arial Black", sans-serif';
    ['BACKLOG', 'DOORS', 'KITCHEN', 'SERVED'].forEach((name, i) => g.fillText(name, i * 128 + 64, 30));
    boardState.cols.forEach((list, i) => list.slice(0, 15).forEach((tone, k) => {
      const x = i * 128 + 14 + (k % 3) * 35, y = 66 + Math.floor(k / 3) * 41;
      g.fillStyle = 'rgba(0,0,0,.25)'; g.fillRect(x + 3, y + 4, 30, 32); g.fillStyle = tone; g.fillRect(x, y, 30, 32);
      g.fillStyle = 'rgba(58,36,28,.45)'; g.fillRect(x + 5, y + 9, 20, 3); g.fillRect(x + 5, y + 17, 13, 3);
    }));
    // the leaderboard: the three busiest kitchens
    g.fillStyle = C.cream; g.fillRect(512, 0, 512, 288);
    g.fillStyle = C.ink; g.font = '30px Bungee, "Arial Black", sans-serif'; g.fillText('TOP KITCHENS', 768, 36);
    const best = Math.max(1, ...boardState.top.map(r => r.score));
    boardState.top.slice(0, 3).forEach((r, i) => {
      const y = 76 + i * 68;
      g.fillStyle = ['#ffd23f', '#d5dbe0', '#e0a070'][i]; g.beginPath(); g.arc(556, y + 22, 24, 0, 7); g.fill(); g.strokeStyle = C.ink; g.lineWidth = 4; g.stroke();
      g.fillStyle = C.ink; g.font = '26px Bungee, "Arial Black", sans-serif'; g.fillText(String(i + 1), 556, y + 24);
      g.fillStyle = '#e8d6b0'; g.beginPath(); g.roundRect(596, y, 400, 46, 12); g.fill();
      g.fillStyle = r.color; g.beginPath(); g.roundRect(596, y, Math.max(46, 400 * r.score / best), 46, 12); g.fill();
      g.fillStyle = C.ink; g.textAlign = 'left'; g.font = '700 26px Rubik, system-ui, sans-serif'; g.fillText(r.name, 612, y + 24);
      g.textAlign = 'right'; g.font = '24px Bungee, "Arial Black", sans-serif'; g.fillText(String(r.score), 984, y + 25); g.textAlign = 'center';
    });
    if (!boardState.top.length) { g.fillStyle = '#6b4c3e'; g.font = '700 26px Rubik, system-ui, sans-serif'; g.fillText('Nobody has shipped yet', 768, 150); }
  });
}

export function buildPark(world) {
  if (park.built) return parkScene;
  park.built = true;
  const pk = world.park, [fx, fz] = pk.fountain;
  for (const pl of world.plots) {
    const sd = SIDE[pl.side], f = { id: pl.id, side: pl.side, x: pl.x, z: pl.z, ...sd };
    f.hx = pl.x + sd.ox * 1.5; f.hz = pl.z + sd.oz * 1.5;                                                   // the middle of the front wall
    f.px = pl.x + sd.ox * 0.5 - sd.ax * 1.5; f.pz = pl.z + sd.oz * 0.5 - sd.az * 1.5;                     // the sign post
    f.m = new THREE.Matrix4().compose(V(f.hx, 0, f.hz), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, sd.ry, 0)), V(1, 1, 1));
    f.chimney = V(1.15, 4.4, -2.2).applyMatrix4(f.m); f.roof = pl.side === 'n' ? V(0, 2.72, 0.5).applyMatrix4(f.m) : V(0, 4.25, -1.45).applyMatrix4(f.m); f.door = { x: pl.x + sd.ox * 1.35, z: pl.z + sd.oz * 1.35 };
    f.fires = [[1.15, 4.4, -2.2, 1.25], [0.98, 4.35, -2.08, 0.8], [1.3, 4.35, -2.3, 0.9], [-0.9, 3.4, -0.75, 1.0], [-1.6, 3.15, -2.45, 0.8], [0.2, 3.65, -1.2, 0.7]].map(([x, y, z, sc]) => [V(x, y, z).applyMatrix4(f.m), sc]);
    frames[pl.id] = f;
  }

  /* ---------- ground ---------- */
  const far = new THREE.Mesh(new THREE.PlaneGeometry(150, 110).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ toneMapped: false, map: canvasTex(256, 256, g => { const r = g.createRadialGradient(128, 128, 30, 128, 128, 128); r.addColorStop(0, '#5d7a52'); r.addColorStop(0.5, '#3c4a40'); r.addColorStop(1, '#1c1420'); g.fillStyle = r; g.fillRect(0, 0, 256, 256); }) }));
  far.position.y = -0.04; far.material.userData.outlineParameters = NO_OUTLINE; parkScene.add(far);
  const lawnMat = toon('#ffffff', { map: lawnTex(), outline: false, key: 'lawn' });
  const lawn = new THREE.Mesh(new THREE.PlaneGeometry(HW * 2, HH * 2).rotateX(-Math.PI / 2), lawnMat); parkScene.add(lawn);
  const g = new Batch(), rect = (x0, x1, z0, z1, y, tone) => g.add(grect(1, 1), tone, (x0 + x1) / 2, y, (z0 + z1) / 2, { sx: x1 - x0, sz: z1 - z0 });
  const PAVE = '#f0dfba', PAVE2 = '#e4cfa4', COURT = '#d9c5a0', KERB = '#c2a982';
  rect(-25.6, 25.6, -14.6, 14.6, -0.02, COURT);                                           // the street the restaurants stand on
  for (const s of [-1, 1]) { rect(-HW, HW, s * HH - 0.09, s * HH + 0.09, 0.012, KERB); rect(s * HW - 0.09, s * HW + 0.09, -HH, HH, 0.012, KERB); }
  for (const s of [-1, 1]) { rect(-HW, HW, s > 0 ? HH - 1.5 : -HH, s > 0 ? HH : -HH + 1.5, 0.008, PAVE); rect(s > 0 ? HW - 1.5 : -HW, s > 0 ? HW : -HW + 1.5, -HH + 1.5, HH - 1.5, 0.008, PAVE); }
  rect(-17.2, 17.2, -0.75, 0.75, 0.008, PAVE); rect(-0.75, 0.75, -HH + 1.5, HH - 1.5, 0.008, PAVE);
  rect(-16.9, -13.5, -2.85, -0.95, 0.009, PAVE2);                                         // the bus bay
  g.add(gdisc(3.9), PAVE, fx, 0.01, fz).add(gdisc(3.05), PAVE2, fx, 0.014, fz).add(gdisc(2.5), C.stoneDark, fx, 0.018, fz);
  for (const [bx, bz] of [pk.board, pk.leaderboard]) g.add(gdisc(1.9, 24), PAVE, bx, 0.009, bz + 0.9, { sz: 0.7 });
  // flower beds and tufts
  const beds = [[-12.5, -4.3], [12.5, -4.3], [-12.8, 4.6], [12.8, 4.6], [-17, -5.2], [17, -5.2], [-17, 5.2], [17, 5.2], [-2.6, -5.6], [2.6, -5.6], [-7.4, -5.9], [7.4, -5.9], [-5.6, 6.3], [5.6, 6.3]];
  beds.forEach(([x, z], i) => { g.add(gdisc(0.95, 16), '#7a5a40', x, 0.012, z); flowers(g, x, z, 11, 31 + i * 7); });
  let seed = 5; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  for (let i = 0; i < 70; i++) {
    const x = (rnd() - 0.5) * 34, z = (rnd() - 0.5) * 13;
    if (Math.hypot(x - fx, z - fz) < 4.3 || Math.abs(z) < 1.1 || Math.abs(x) < 1.1) continue;
    for (let k = 0; k < 3; k++) g.add(gcone(0.06, 0.26, 4), k % 2 ? '#6fb551' : '#a5dc78', x + (k - 1) * 0.1, 0.12, z + (k % 2) * 0.06, { rz: (k - 1) * 0.3 });
  }
  const groundMat = tintMat;
  ground = new THREE.Mesh(g.build(), groundMat); parkScene.add(ground);

  /* ---------- furniture: one outlined mesh ---------- */
  const b = new Batch(), gl = new Batch();
  // the fountain, with the lunch bell on an arch over it
  b.at(fx, fz, 0, 1, () => {
    b.cyl(2.35, 2.45, 0.14, C.stoneDark, 0, 0, 0, { seg: 28 }).cyl(1.92, 2.02, 0.5, C.stone, 0, 0.12, 0, { seg: 28 }).cyl(0.34, 0.46, 1.05, C.stone, 0, 0.5, 0, { seg: 12 }).cyl(0.98, 0.5, 0.24, C.stone, 0, 1.45, 0, { seg: 20 });
    for (const s of [-1, 1]) b.box(0.1, 1.15, 0.1, C.woodDark, 0.62 * s, 1.66, 0);
    b.box(1.5, 0.11, 0.14, C.woodDark, 0, 2.78, 0);
  });
  circles.push({ x: fx, z: fz, r: 2.1 });
  [[-17, -6.4, 1.15, 0.4, 0], [17, -6.4, 1.1, 1.2, 0], [-17, 6.4, 1.1, 2.1, 0], [17, 6.4, 1.15, 0.9, 0], [-12.5, -5.8, 1.0, 1.7, 1], [12.5, -5.8, 1.0, 0.3, 2], [-12.8, 6.0, 1.05, 2.6, 2], [12.8, 6.0, 1.0, 1.1, 1], [0, -6.5, 1.1, 0.7, 0], [-5.6, 6.5, 0.9, 1.9, 0], [5.6, 6.5, 0.95, 0.2, 2], [15.4, -1.6, 0.95, 2.2, 0]]
    .forEach(([x, z, s, ry, kind]) => tree(b, x, z, s, ry, kind));
  for (const [x, z, ry] of [[-3.3, -3.3, Math.PI / 4], [3.3, -3.3, -Math.PI / 4], [-3.3, 3.3, Math.PI * 0.75], [3.3, 3.3, -Math.PI * 0.75]]) bench(b, x, z, ry);
  for (const [x, z] of [[-10.6, -4.6], [10.6, -4.6], [-10.6, 5.4], [10.6, 5.4], [-2.2, -4.6], [2.2, 4.6], [-15.6, 4.4], [15.6, 4.4]]) lamp(b, gl, x, z);
  boardStand(b, pk.board[0], pk.board[1], C.teal); boardStand(b, pk.leaderboard[0], pk.leaderboard[1], C.red);
  // the bus stop
  b.at(-15.6, 1.95, Math.PI, 1, () => {
    for (const s of [-1.1, 1.1]) b.box(0.1, 2.0, 0.1, C.cab, s, 0, -0.42).box(0.1, 2.0, 0.1, C.cab, s, 0, 0.3);
    b.box(2.7, 0.12, 1.2, C.teal, 0, 2.0, -0.02, { rx: -0.08 }).box(2.74, 0.1, 0.1, C.cream, 0, 2.0, 0.6).box(1.7, 0.09, 0.4, C.wood, 0, 0.42, -0.2).box(0.09, 0.42, 0.36, C.cab, -0.7, 0, -0.2).box(0.09, 0.42, 0.36, C.cab, 0.7, 0, -0.2);
    b.cyl(0.05, 0.06, 2.5, C.cab, 1.75, 0, 0.3, { seg: 8 }).add(gcyl(0.36, 0.36, 0.08, 18), C.red, 1.75, 2.6, 0.3, { rx: Math.PI / 2 }).add(gcyl(0.25, 0.25, 0.1, 18), C.cream, 1.75, 2.6, 0.3, { rx: Math.PI / 2 });
  });
  gl.at(-15.6, 1.95, Math.PI, 1, () => gl.box(2.2, 1.3, 0.04, '#cfeaf7', 0, 0.6, -0.42, { r: 0.01 }));
  rects.push({ x0: -16.8, x1: -14.4, z0: 1.75, z1: 2.5 }, { x0: -16.75, x1: -13.65, z0: -2.65, z1: -1.15 });
  // a sign post by every doormat: the door sign hangs from it under four status lights
  for (const f of frames) b.at(f.px, f.pz, 0, 1, () => { b.cyl(0.13, 0.17, 0.12, C.stoneDark, 0, 0, 0, { seg: 8 }).cyl(0.055, 0.07, 2.62, C.woodDark, 0, 0.08, 0, { seg: 8 }).box(1.28, 0.09, 0.09, C.woodDark, 0, 2.46, 0).ball(0.09, C.brass, 0, 2.74, 0, { seg: 8 }); });
  statics = outlined(new THREE.Mesh(b.build(), tintMat)); parkScene.add(statics);
  glows = new THREE.Mesh(gl.build(), glowMat); parkScene.add(glows);

  /* ---------- water, bell, bus ---------- */
  const waterTex = canvasTex(128, 128, c => { c.fillStyle = '#6cc8e8'; c.fillRect(0, 0, 128, 128); c.strokeStyle = 'rgba(255,255,255,.55)'; c.lineWidth = 4; for (const r of [14, 30, 46, 60]) { c.beginPath(); c.arc(64, 64, r, 0.4, 4.2); c.stroke(); } });
  const waterMat = new THREE.MeshBasicMaterial({ map: waterTex, toneMapped: false }); waterMat.userData.outlineParameters = NO_OUTLINE;
  water = new THREE.Mesh(new THREE.CircleGeometry(1.74, 28).rotateX(-Math.PI / 2), waterMat); water.position.set(fx, 0.56, fz); parkScene.add(water);
  water2 = new THREE.Mesh(new THREE.CircleGeometry(0.86, 18).rotateX(-Math.PI / 2), waterMat); water2.position.set(fx, 1.7, fz); parkScene.add(water2);
  const bb = new Batch(); bb.cyl(0.1, 0.3, 0.4, C.brass, 0, -0.58, 0, { seg: 12 }).cyl(0.31, 0.34, 0.07, C.brass, 0, -0.62, 0, { seg: 12 }).ball(0.09, C.ink, 0, -0.62, 0, { seg: 8 }).cyl(0.03, 0.03, 0.2, C.ink, 0, -0.2, 0, { seg: 6 });
  bell = outlined(new THREE.Mesh(bb.build(), tintMat)); bell.position.set(fx, 2.8, fz); bell.userData = { swing: 0, v: 0 }; parkScene.add(bell);
  const ub = new Batch(), ug = new Batch();
  ub.box(2.9, 1.2, 1.4, C.mustard, 0, 0.32, 0, { r: 0.22 }).box(2.92, 0.17, 1.42, C.red, 0, 0.62, 0, { r: 0.05 }).box(2.6, 0.12, 1.2, C.cream, 0, 1.5, 0, { r: 0.05 });
  for (const x of [-0.95, 0.95]) for (const z of [-0.66, 0.66]) ub.add(gcyl(0.3, 0.3, 0.2, 14), C.ink, x, 0.3, z, { rx: Math.PI / 2 }).add(gcyl(0.13, 0.13, 0.22, 10), C.stone, x, 0.3, z, { rx: Math.PI / 2 });
  for (const z of [-0.45, 0.45]) ub.ball(0.1, '#fff4c4', 1.45, 0.62, z, { seg: 8 });
  for (const z of [-0.71, 0.71]) for (const x of [-0.95, -0.25, 0.45]) ug.box(0.56, 0.42, 0.02, '#cfeaf7', x, 0.92, z, { r: 0.01 });
  ug.box(0.02, 0.44, 1.1, '#cfeaf7', 1.46, 0.92, 0, { r: 0.01 }).box(0.5, 0.75, 0.02, '#a8d6ea', 1.05, 0.5, 0.715, { r: 0.01 });
  bus = outlined(new THREE.Mesh(ub.build(), tintMat)); bus.position.set(-15.2, 0, -1.9); bus.add(new THREE.Mesh(ug.build(), glowMat)); bus.userData = { squash: 0, squashV: 0 }; parkScene.add(bus);

  /* ---------- the plots ---------- */
  houses = inst(houseGeo(), 24); lots = inst(lotGeo(), 24);
  panes = inst(paneGeo(), 24, { mat: glowMat, outline: false });
  mats = inst(gbox(1.15, 0.05, 0.74, 0.02).clone(), 24, { mat: toon('#ffffff', { outline: false, key: 'mats' }), outline: false });
  signs = inst(new THREE.PlaneGeometry(1.16, 0.725), 48, { mat: atlasMat(signTexture(), 5, { alphaTest: 0.5 }), outline: false, attr: 'cell' });
  bulbs = inst(new Batch().ball(0.09, '#ffffff', 0, 0, 0, { seg: 10 }).build(), 96, { mat: glowMat });
  frames.forEach((f, i) => { setM(mats, i, TRS(mD, f.x, 0.025, f.z, 0, f.ry)); });
  mats.count = 24;

  /* ---------- team areas, markers, boards, particles ---------- */
  const ringTex = canvasTex(256, 256, c => { c.clearRect(0, 0, 256, 256); c.fillStyle = 'rgba(255,255,255,.16)'; c.beginPath(); c.arc(128, 128, 120, 0, 7); c.fill(); c.strokeStyle = 'rgba(255,255,255,.85)'; c.lineWidth = 4; c.setLineDash([16, 12]); c.beginPath(); c.arc(128, 128, 118, 0, 7); c.stroke(); });
  const ringMat = new THREE.MeshBasicMaterial({ map: ringTex, transparent: true, depthWrite: false, toneMapped: false }); ringMat.userData.outlineParameters = NO_OUTLINE;
  rings = inst(grect(1, 1).clone(), 3, { mat: ringMat, outline: false, order: 2 });
  const fb = new Batch(); fb.cyl(0.12, 0.16, 0.12, C.stoneDark, 0, 0, 0, { seg: 8 }).cyl(0.045, 0.055, 3.0, C.cream, 0, 0.1, 0, { seg: 8 }).ball(0.09, C.brass, 0, 3.15, 0, { seg: 8 }).box(1.0, 0.56, 0.05, '#ffffff', 0.55, 2.45, 0, { tint: 1, r: 0.02 }).box(0.34, 0.2, 0.06, C.cream, 0.5, 2.63, 0, { r: 0.02 });
  flagsMesh = inst(fb.build(), 3);
  const markTex = canvasTex(128, 128, c => { c.clearRect(0, 0, 128, 128); c.strokeStyle = '#fff'; c.lineWidth = 12; c.setLineDash([30, 20]); c.beginPath(); c.arc(64, 64, 52, 0, 7); c.stroke(); });
  const mk = (tone, opacity) => { const m = new THREE.MeshBasicMaterial({ color: tone, map: markTex, transparent: true, depthWrite: false, toneMapped: false, opacity }); m.userData.outlineParameters = NO_OUTLINE; const o = new THREE.Mesh(grect(1, 1), m); o.renderOrder = 3; o.visible = false; parkScene.add(o); return o; };
  hotRing = mk('#ffd75e', 1); goalDot = mk('#ffffff', 0.9);
  const fg = new THREE.BufferGeometry(), half = [[0, 0.5], [0.5, 1]];
  const quad = ([x, z], [u0, u1]) => { const w = 1.36, y0 = 0.82, y1 = 2.32, zz = z + 0.085; return { p: [x - w, y0, zz, x + w, y0, zz, x + w, y1, zz, x - w, y0, zz, x + w, y1, zz, x - w, y1, zz], u: [u0, 0, u1, 0, u1, 1, u0, 0, u1, 1, u0, 1] }; };
  const qa = quad(pk.board, half[0]), qb = quad(pk.leaderboard, half[1]);
  fg.setAttribute('position', new THREE.Float32BufferAttribute([...qa.p, ...qb.p], 3)); fg.setAttribute('uv', new THREE.Float32BufferAttribute([...qa.u, ...qb.u], 2));
  const faceBoardMat = new THREE.MeshBasicMaterial({ map: boardTexture(), toneMapped: false }); faceBoardMat.userData.outlineParameters = NO_OUTLINE;
  boardFace = new THREE.Mesh(fg, faceBoardMat); parkScene.add(boardFace);
  puffMesh = inst(gsph(0.16, 8).clone(), PUFFS, { mat: new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.86, depthWrite: false, toneMapped: false }), outline: false, order: 5 });
  puffMesh.material.userData.outlineParameters = NO_OUTLINE;
  flameMesh = inst(new Batch().add(gcone(0.2, 0.62, 7), '#ffffff').build(), 96, { mat: glowMat, outline: false, order: 5 });

  buildRig();
  // fixed shadows first in the shadow buffer: houses, trees, the fountain, the bus
  let n = 0;
  const shade = (x, z, w, d) => setM(rig.shadow, n++, TRS(mD, x, 0.016, z, 0, 0, 0, w, 1, d));
  for (const c of circles) { const k = c.r > 1.5 ? 2.7 : c.r > 0.3 ? 3.6 : 4.4; shade(c.x, c.z, c.r * k, c.r * k); }
  shade(-15.2, -1.9, 4.4, 2.6); shade(-15.6, 1.95, 3.6, 2.2);
  for (const f of frames) shade(f.hx + f.ox * 1.45, f.hz + f.oz * 1.45, f.ax ? 5.6 : 4.8, f.ax ? 4.8 : 5.6);
  shadowBase = n;
  syncPark(world);
  return parkScene;
}

/* ======================= the world snapshot, drawn ======================= */
const remotes = new Map();    // pid -> character
const custs = new Map();      // card id -> character
const seen = new Map();       // card id -> last state
const VISIBLE = new Set(['backlog', 'held', 'queued', 'offered']);
const BUS_DOOR = { x: -14.3, z: -0.8 };
const num = id => Number(String(id).replace(/\D/g, '')) || 0;
const tmp = {};
function lookOf(ch, look) { const L = LOOKS[(look ?? 0) % LOOKS.length]; ch.a = ch.b = colorOf(L.color); ch.skin = colorOf(L.skin); }
function cardTarget(c, w) {
  if (c.state === 'queued') { const k = w.plots[c.plot].queue.indexOf(c.id); return queueSpot(c.plot, Math.max(0, k), tmp); }
  if (c.state === 'offered') { const k = w.plots[c.plot].offers.indexOf(c.id); return offerSpot(c.plot, Math.max(0, k), tmp); }
  tmp.x = c.x; tmp.z = c.z; return tmp;
}
export function syncPark(world) {
  if (!park.built) return;
  park.world = world;
  const you = world.you;
  // you
  me.pid = you.pid; lookOf(me, you.look); me.visible = you.zone === 'park';
  // everybody else on the lawn
  const here = new Set();
  for (const p of world.players) {
    if (p.pid === you.pid || p.zone !== 'park' || p.x === null) continue;
    here.add(p.pid);
    let ch = remotes.get(p.pid);
    if (!ch) { ch = newChar('chef', { pid: p.pid, x: p.x, z: p.z, r: p.r, grow: 0.01 }); remotes.set(p.pid, ch); }
    ch.p = p; ch.leaving = false; lookOf(ch, p.look);
  }
  for (const [pid, ch] of remotes) if (!here.has(pid)) { ch.leaving = true; }
  // customers
  const live = new Set();
  for (const c of world.cards) {
    const was = seen.get(c.id); seen.set(c.id, c.state);
    if (was && was !== 'served' && c.state === 'served' && c.plot !== null) { const f = frames[c.plot]; celebrateAt(f.x, f.z); popup('Served!', V(f.x, 2.2, f.z), 'good'); emit('sfx', 'coin'); }
    let ch = custs.get(c.id);
    if (!VISIBLE.has(c.state)) {
      if (ch && !ch.exit) { const f = c.plot !== null ? frames[c.plot] : null; ch.exit = f ? { x: f.door.x, z: f.door.z } : { x: ch.x, z: ch.z }; }
      if (ch) live.add(c.id);
      continue;
    }
    live.add(c.id);
    if (!ch) {
      const n = num(c.id), t = cardTarget(c, world);
      ch = newChar('cust', { id: c.id, sc: { S: 1.0, M: 1.08, L: 1.17 }[c.size] || 1.08, a: colorOf(c.rush ? '#ffd75e' : BODIES[n % BODIES.length]), b: colorOf(HAIRS[(n * 7) % HAIRS.length]), skin: colorOf(SKINS[n % SKINS.length]), x: t.x, z: t.z, r: (n % 7 - 3) * 0.25 });
      // somebody new in the backlog got off the bus
      if (park.booted && !was && c.state === 'backlog') { ch.x = BUS_DOOR.x + (n % 3) * 0.3; ch.z = BUS_DOOR.z + (n % 2) * 0.3; kick(bus.userData, 0.2); emit('sfx', 'door'); }
      else if (park.booted) ch.grow = 0.01;
      custs.set(c.id, ch);
    }
    const t = cardTarget(c, world);
    if (ch.card && ch.card.state !== c.state) kick(ch, 0.2);
    ch.card = c; ch.exit = null; ch.tx = t.x; ch.tz = t.z; ch.ticket = colorOf(SIZE_COLOR[c.size] || SIZE_COLOR.M);
    ch.r0 ??= ch.r; ch.icon = c.state === 'offered' ? 4 : -1; ch.mood = c.rush && c.state === 'backlog' ? 'wave' : 'idle';
    if (c.state !== 'held') ch.lead = null;
  }
  for (const p of world.players) p.carry.forEach((id, k) => { const ch = custs.get(id); if (ch) ch.lead = k === 0 ? { pid: p.pid } : { card: p.carry[k - 1] }; });
  for (const [id, ch] of custs) if (!live.has(id)) { custs.delete(id); seen.delete(id); if (ch.card) puff(ch.x, 0.8, ch.z, '#fff4df', { n: 5, up: 1 }); }
  for (const id of seen.keys()) if (!world.cards.some(c => c.id === id)) seen.delete(id);

  // the plots
  let h = 0, l = 0;
  houses.plots = [];
  for (const pl of world.plots) {
    const f = frames[pl.id];
    if (pl.owner) { setM(houses, h, f.m); setC(houses.instanceColor, h, colorOf(pl.color || '#c8684a')); setM(panes, h, f.m); houses.plots[h] = pl; h++; }
    else setM(lots, l++, f.m);
    setC(mats.instanceColor, pl.id, colorOf(pl.owner ? pl.color || '#c8684a' : '#a89a8c'));
    const cell = pl.owner ? { team: 0, help: 1, private: 2 }[pl.sign] ?? 0 : 4;
    setM(signs, pl.id * 2, TRS(mD, f.px, 2.04, f.pz + 0.07)); signs.cell.array[pl.id * 2] = cell;
    setM(signs, pl.id * 2 + 1, pl.owner && !pl.open ? TRS(mD, f.px + 0.1, 1.4, f.pz + 0.1, 0, 0, -0.07, 0.7) : TRS(mD, 0, -5, 0, 0, 0, 0, 0.001)); signs.cell.array[pl.id * 2 + 1] = 3;
  }
  flush(houses, h); flush(lots, l); flush(mats, 24); flush(signs, 48); panes.count = h; panes.instanceMatrix.needsUpdate = true;
  // team areas
  world.teams.forEach((tm, i) => {
    const a = tm.area, tone = colorOf(tm.color);
    setM(rings, i, TRS(mD, a.x, 0.02, a.z, 0, 0, 0, a.r * 2.1, 1, a.r * 2.1)); setC(rings.instanceColor, i, tone);
    setM(flagsMesh, i, TRS(mD, a.x - a.r * 0.74, 0, a.z - a.r * 0.74)); setC(flagsMesh.instanceColor, i, tone);
  });
  flush(rings, world.teams.length); flush(flagsMesh, world.teams.length);
  // the two boards in the park follow the real numbers
  const tone = c => world.teams.find(t => t.id === c.team)?.color || '#fff4df';
  const cols = [world.cards.filter(c => c.state === 'backlog' || c.state === 'held'), world.cards.filter(c => c.state === 'queued' || c.state === 'offered'), world.cards.filter(c => ['seated', 'cooking', 'review'].includes(c.state)), world.cards.filter(c => c.state === 'served')].map(list => list.map(tone));
  const top = world.plots.filter(p => p.owner && p.score + p.bonus > 0).sort((a, b) => b.score + b.bonus - (a.score + a.bonus)).slice(0, 3).map(p => ({ name: p.name, score: p.score + p.bonus, color: p.color }));
  const sig = JSON.stringify([cols, top]);
  if (sig !== boardState.sig) { boardState.sig = sig; boardState.cols = cols; boardState.top = top; boardFace.material.map.userData.redraw(); }
  park.booted = true;
}

/* ======================= every frame ======================= */
let hot = null, goal = null, smokeT = 0, jetT = 0, lastBellAt = 0;
/** What E would act on: { x, z, size?, html? }. The ring is drawn there and the label above it. */
export function setHot(h) { hot = h; }
export function setGoal(x, z) { goal = x === null || x === undefined ? null : { x, z }; }
export function placeMe(x, z) { if (x !== null && x !== undefined) { me.x = x; me.z = z; } me.visible = true; me.moving = false; view.snap = true; }
export const kickMe = (amount = 0.15) => kick(me, amount);
export function cardXZ(id) { const ch = custs.get(id); return ch ? { x: ch.x, z: ch.z } : null; }
const leaderOf = lead => (lead.card ? custs.get(lead.card) : lead.pid === me.pid ? (me.visible ? me : null) : remotes.get(lead.pid)) || null;
const turnTo = (ch, r, dt, k = 12) => { const d = Math.atan2(Math.sin(r - ch.r), Math.cos(r - ch.r)); ch.r += d * Math.min(1, dt * k); };
const LIGHTS = [['cooking', '#ffb02e'], ['oven', '#59b6ee'], ['pass', '#63d977'], ['blocked', '#ff4d3a']];
const OFF = colorOf('#9a877c'), WARM = colorOf('#ffd98a'), DARK = colorOf('#56617c');
const pos = V(), scr = {};
const sayOf = (ch, e, at) => { const m = meaning(e); ch.icon = m?.emote ? m.emote - 1 : -1; ch.iconAt = at; ch.mood = m?.emote ? EMOTES[m.emote].mood : 'idle'; return m?.phrase ?? -1; };

export function stepPark(dt, t) {
  const w = park.world; if (!park.built || !w) return;
  const now = performance.now(), labels = [];
  for (const o of outlines) o.visible = quality.outline;
  // the outline is a fixed few pixels wide however far the camera stands
  const dist = camera.position.y / DIR.y, perUnit = stage.clientHeight / (dist * 2 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)));
  uLine.value = clamp(1.7 / Math.max(1, perUnit), 0.01, 0.16);
  rig.n = rig.chefs = rig.custs = rig.tickets = rig.icons = 0;

  /* ---------- people ---------- */
  if (me.visible) {
    const s = sample(me.pid, now), phrase = s ? sayOf(me, s.e, s.eAt) : -1;
    drawChar(me, dt, t);
    if (phrase >= 0) labels.push({ k: 'say-me', html: `<span class="pk-say">${esc(PHRASES[phrase])}</span>`, x: me.x, y: 3.0, z: me.z, pri: 8, d: 0 });
  }
  for (const [pid, ch] of remotes) {
    if (ch.leaving) { ch.grow -= dt * 5; if (ch.grow <= 0.02) { remotes.delete(pid); continue; } }
    else ch.grow = Math.min(1, ch.grow + dt * 5);
    const s = sample(pid, now);
    let phrase = -1;
    if (s) { ch.x = s.x; ch.z = s.z; ch.r = s.r; if (ch.moving && !s.moving) kick(ch, 0.1); ch.moving = s.moving; ch.pace = s.dash ? 1.5 : 1; phrase = sayOf(ch, s.e, s.eAt); }
    drawChar(ch, dt, t);
    const d = Math.hypot(ch.x - me.x, ch.z - me.z);
    if (phrase >= 0) labels.push({ k: `say${pid}`, html: `<span class="pk-say">${esc(PHRASES[phrase])}</span>`, x: ch.x, y: 3.0, z: ch.z, pri: 7, d });
    const tm = w.teams.find(x => x.id === ch.p.team);
    labels.push({ k: `pn${pid}`, html: `<span class="pk-name${ch.p.bot ? ' bot' : ''}" style="--c:${tm?.color || '#8a7f78'}">${esc(ch.p.name)}</span>`, x: ch.x, y: 2.62, z: ch.z, pri: ch.p.bot ? 1.5 : 3, d, cap: 'name' });
  }
  for (const [id, ch] of custs) {
    ch.grow = Math.min(1, ch.grow + dt * 5);
    let tx = ch.tx, tz = ch.tz, speed = 4.6, rope = 0, face = null;
    if (ch.exit) { tx = ch.exit.x; tz = ch.exit.z; speed = 5.5; }
    else if (ch.lead) {
      const L = leaderOf(ch.lead);
      if (L) { tx = L.x; tz = L.z; rope = 0.85; speed = 14; } else { tx = ch.x; tz = ch.z; }
    } else if (ch.card.state === 'queued' || ch.card.state === 'offered') { const f = frames[ch.card.plot]; face = Math.atan2(f.door.x - tx, f.door.z - tz); }
    const dx = tx - ch.x, dz = tz - ch.z, d = Math.hypot(dx, dz), go = Math.min(Math.max(0, d - rope), speed * dt);
    if (d > 30) { ch.x = tx; ch.z = tz; }
    else if (go > 0.004 && d > 0.02) {
      ch.x += dx / d * go; ch.z += dz / d * go;
      // nobody wades through the fountain: they slide round it
      const fr = Math.hypot(ch.x, ch.z);
      if (fr < 2.75 && Math.hypot(tx, tz) > 2.6) { const ux = ch.x / fr, uz = ch.z / fr, side = Math.sign(ux * tz - uz * tx) || 1, slip = side * speed * dt * 0.8; ch.x = ux * 2.75 - uz * slip; ch.z = uz * 2.75 + ux * slip; }
      turnTo(ch, Math.atan2(dx, dz), dt); ch.moving = true; ch.pace = speed > 8 ? 1.3 : 1;
    } else {
      if (ch.moving) kick(ch, 0.1);
      ch.moving = false;
      if (ch.exit) { ch.grow -= dt * 9; if (ch.grow <= 0.02) { custs.delete(id); continue; } }
      else if (face !== null) turnTo(ch, face, dt, 5);
      else if (!ch.lead) turnTo(ch, ch.r0 ?? 0, dt, 4);
    }
    drawChar(ch, dt, t);
  }

  /* ---------- plots: lights, windows, smoke and fire ---------- */
  smokeT -= dt; const puffNow = smokeT <= 0; if (puffNow) smokeT = 0.2;
  let fl = 0, nb = 0;
  houses.plots?.forEach((pl, h) => {
    const L = pl.lights, f = frames[pl.id], fire = !!L.fire, trouble = L.blocked > 0 || L.stalled > 0;
    setC(panes.instanceColor, h, fire ? col.set('#ff7a2e').multiplyScalar(0.75 + Math.sin(t * 17 + pl.id) * 0.25) : pl.open ? WARM : DARK);
    if (trouble && puffNow) puff(f.chimney.x, f.chimney.y, f.chimney.z, fire ? ['#4a4048', '#6b5f66'] : ['#9c98a2', '#b9b5bd'], { n: fire ? 2 : 1, spread: 0.2, up: 1.3, out: 0.5, life: fire ? 2.4 : 1.9, size: fire ? 1.7 : 1.25, grow: 1.3 });
    if (fire) for (const [p, sc] of f.fires) {
      if (fl >= 96) break;
      const k = 0.75 + Math.abs(Math.sin(t * 13 + fl * 1.7)) * 0.5;
      setM(flameMesh, fl, TRS(mD, p.x, p.y + 0.3 * sc * k, p.z, 0, t * 3 + fl, 0, sc, sc * k, sc)); setC(flameMesh.instanceColor, fl, colorOf(fl % 2 ? '#ffd23f' : '#ff7a2e')); fl++;
    }
  });
  flush(flameMesh, fl); panes.instanceColor.needsUpdate = true;
  for (const pl of w.plots) {
    const f = frames[pl.id], L = pl.lights;
    LIGHTS.forEach(([key, tone], i) => {
      const on = pl.owner && (key === 'blocked' ? L.blocked + L.stalled > 0 : L[key] > 0), blink = key === 'blocked' && on && !reduceMotion ? Math.sin(t * 9) > -0.2 : true;
      setM(bulbs, nb, TRS(mD, f.px - 0.42 + i * 0.28, 2.62, f.pz + 0.02, 0, 0, 0, on && blink ? 1.4 : 0.9)); setC(bulbs.instanceColor, nb, on && blink ? colorOf(tone) : OFF); nb++;
    });
  }
  flush(bulbs, nb);

  /* ---------- the fountain, the bell, the bus ---------- */
  water.rotation.y = t * 0.25; water2.rotation.y = -t * 0.5;
  jetT -= dt;
  if (jetT <= 0 && !reduceMotion) { jetT = quality.level > 1 ? 0.12 : 0.06; const [fx, fz] = w.park.fountain; puff(fx, 1.8, fz, ['#e6f7ff', '#bfe9fb'], { n: 1, spread: 0.1, up: 2.6, out: 1.5, life: 0.75, gravity: 7.5, grow: 0, size: 0.42 }); }
  if (w.rush && w.rush.bellAt !== lastBellAt) { lastBellAt = w.rush.bellAt; bell.userData.v = 7; kick(bus.userData, 0.35); emit('sfx', 'bell'); }
  const bu = bell.userData; bu.v += (-bu.swing * 60 - bu.v * 1.6) * Math.min(dt, 0.05); bu.swing += bu.v * Math.min(dt, 0.05); bell.rotation.z = clamp(bu.swing, -0.9, 0.9);
  const sq = spring(bus.userData, dt); bus.scale.set(1 - sq * 0.4, 1 + sq, 1 - sq * 0.4);
  stepPuffs(dt);
  flush(rig.bodyChef, rig.chefs); flush(rig.headChef, rig.chefs); flush(rig.bodyCust, rig.custs); flush(rig.headCust, rig.custs);
  flush(rig.face, rig.n); flush(rig.hands, rig.n * 2); flush(rig.feet, rig.n * 2); flush(rig.shadow, shadowBase + rig.n); flush(rig.ticket, rig.tickets); flush(rig.icon, rig.icons);

  /* ---------- markers ---------- */
  hotRing.visible = !!hot;
  if (hot) { hotRing.position.set(hot.x, 0.03, hot.z); hotRing.rotation.y = t * 1.5; hotRing.scale.setScalar((hot.size || 1.25) * (1 + Math.sin(t * 6) * 0.05)); }
  goalDot.visible = !!goal;
  if (goal) { goalDot.position.set(goal.x, 0.03, goal.z); goalDot.rotation.y = -t * 3; goalDot.scale.setScalar(0.55); }

  /* ---------- labels: never more than the budget, nearest and most urgent first ---------- */
  if (hot?.html) labels.push({ k: 'hot', html: hot.html, x: hot.x, y: hot.y ?? 2.9, z: hot.z, pri: 9, d: 0 });
  for (const pl of w.plots) {
    if (!pl.owner) continue;
    const f = frames[pl.id], mine = pl.owner === w.you.pid, L = pl.lights;
    const state = L.fire ? ' fire' : L.blocked + L.stalled > 0 ? ' smoke' : '';
    labels.push({ k: `pl${pl.id}`, html: `<span class="pk-plot${mine ? ' mine' : ''}${state}" style="--c:${pl.color}"><b>${esc(pl.name)}</b><i>${pl.score + pl.bonus}</i></span>`, x: f.roof.x, y: f.roof.y, z: f.roof.z, pri: mine ? 5 : state ? 4 : 2, d: Math.hypot(f.x - me.x, f.z - me.z), cap: 'plot', pin: mine });
  }
  for (const tm of w.teams) labels.push({ k: `ar${tm.id}`, html: `<span class="pk-area" style="--c:${tm.color}">${esc(tm.name)} backlog</span>`, x: tm.area.x - tm.area.r * 0.74, y: 3.5, z: tm.area.z - tm.area.r * 0.74, pri: 1, d: Math.hypot(tm.area.x - me.x, tm.area.z - me.z), pin: tm.id === w.you.team });
  const goalPct = Math.round(clamp(w.team.shipped / Math.max(1, w.team.goal), 0, 1) * 100);
  labels.push({ k: 'fountain', html: `<span class="pk-town"><b>${w.team.shipped}</b> of ${w.team.goal} served<i style="--p:${goalPct}%"></i></span>`, x: w.park.fountain[0], y: 3.5, z: w.park.fountain[1], pri: 2.5, d: Math.hypot(me.x, me.z) });
  const phone = quality.mobile, caps = { name: phone ? 4 : 6, plot: phone ? 5 : 8 }, max = phone ? 10 : 16;
  labels.sort((a, b) => b.pri - a.pri || a.d - b.d);
  let n = 0;
  const sw = stage.clientWidth, sh = stage.clientHeight;
  for (const L of labels) {
    if (n >= max) break;
    if (!L.pin) { toScreen(pos.set(L.x, L.y, L.z), scr); if (scr.x < -30 || scr.x > sw + 30 || scr.y < 20 || scr.y > sh + 10) continue; }
    if (L.cap) { if (caps[L.cap] <= 0) continue; caps[L.cap]--; }
    label(`park-${L.k}`, L.html, pos.set(L.x, L.y, L.z), { pri: L.pri, cls: 'pk' }); n++;
  }
  stats.labels = n; stats.chars = rig.n;
}

/* ======================= camera: the kitchen's angle, following you across the lawn ======================= */
const DIR = V(0, 15, 10.4).normalize();
const view = { x: 0, z: 0, dist: 22, overview: false, snap: true };
export function setOverview(on) { view.overview = !!on; }
export const isOverview = () => view.overview;
export function updateParkCamera(dt, focus = me) {
  const w = stage.clientWidth, h = stage.clientHeight; if (!w || !h) return;
  const aspect = w / h;
  if (camera.view?.enabled) camera.clearViewOffset();
  if (camera.aspect !== aspect) { camera.aspect = aspect; camera.updateProjectionMatrix(); }
  const tan = 2 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
  // about 22 units of lawn across a laptop, 12 across an upright phone; V shows the whole town
  let dist = view.overview ? Math.max(53 / (tan * aspect), 31 * DIR.y / tan) : clamp((aspect < 0.8 ? 12.5 : aspect < 1.3 ? 16 : 22) / (tan * aspect), 17, 60);
  const visW = dist * tan * aspect, visD = dist * tan / DIR.y;
  const hx = Math.max(2, 24.5 - visW / 2), z0 = Math.min(-13 + visD / 2, -7), z1 = Math.max(12.5 - visD / 2, 6.5);
  const tx = view.overview ? 0 : clamp(focus.x, -hx, hx), tz = view.overview ? -0.3 : clamp(focus.z + (aspect < 0.8 ? -0.6 : 0.5), z0, z1);
  const k = view.snap ? 1 : 1 - Math.exp(-dt * 5); view.snap = false;
  view.x += (tx - view.x) * k; view.z += (tz - view.z) * k; view.dist += (dist - view.dist) * k;
  pos.set(view.x, 0, view.z);
  camera.position.copy(pos).addScaledVector(DIR, view.dist); camera.lookAt(pos); camera.updateMatrixWorld();
}
export function renderPark() { if (quality.lost) return; renderer.render(parkScene, camera); stats.calls = renderer.info.render.calls; stats.triangles = renderer.info.render.triangles; }
const ray = new THREE.Raycaster(), ndc = new THREE.Vector2(), floor = new THREE.Plane(V(0, 1, 0), 0);
/** The point of the lawn under a screen position, or null. */
export function groundAt(cx, cy) {
  const r = renderer.domElement.getBoundingClientRect();
  ndc.set(((cx - r.left) / r.width) * 2 - 1, -((cy - r.top) / r.height) * 2 + 1);
  ray.setFromCamera(ndc, camera);
  const p = ray.ray.intersectPlane(floor, V());
  return p ? { x: p.x, z: p.z } : null;
}
export function screenOf(x, z, y = 0) { pos.set(x, y, z).project(camera); const r = renderer.domElement.getBoundingClientRect(); return { x: r.left + (pos.x + 1) / 2 * r.width, y: r.top + (1 - pos.y) / 2 * r.height }; }

/* ======================= for tests and the debug overlay ======================= */
const stats = { calls: 0, triangles: 0, labels: 0, chars: 0 };
export const parkStats = () => ({ ...stats, outline: quality.outline, level: quality.level });
/** Everybody drawn on the lawn but you. Every one of them is a full character. */
export const parkPlayers = () => [...remotes.values()].filter(c => !c.leaving).map(c => ({ pid: c.pid, name: c.p.name, x: c.x, z: c.z, full: true, bot: !!c.p.bot }));
export const parkCards = () => [...custs.values()].filter(c => !c.exit).map(c => ({ id: c.id, state: c.card.state, x: c.x, z: c.z }));
