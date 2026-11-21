// The water gun: spray another visitor in the park, or in a restaurant you are visiting. Never in your own kitchen.
//
//   initSquirt({ where, me, peers, sceneOf })   where() -> 'park' | 'visit' | 'off'; me() -> { x, z, r } or null;
//                                              peers() -> [{ id, name, x, z }]; sceneOf() -> the THREE scene on screen
//   fire()                 aims at the nearest player in front within range, sprays, sends `splash {to}`
//   squirtButton(show)     the round button, in the park controls only
//   stepSquirt(dt)         droplets and drips, from the shell's one animation loop
//   clearSquirt()          a scene is going away: drop every droplet in it
// The server passes `splash {to}` on as `splashed { from: name, fromId, toId, dir: { x, z } }` to everyone in the zone
// (REBUILD.md 5.3), when both stand within 6 units. Everyone sees the arc and the target dripping; only the target
// (toId is its own connId) gets the screen splat, from the side the water came from.
import { THREE } from './scene.js';
import { esc, reduceMotion, modal } from './core.js';
import { send, on, net } from './net.js';

const RANGE = 5.8, CONE = Math.cos(Math.PI * 0.4), COOL_MS = 1000, FLIGHT = 0.45;   // the server drops shots past 6 units, and more than 1 a second
let opt = null, btn = null, lastShot = 0;
const drops = [];           // { m, from, to, t, life, kind }
const dripGeo = new THREE.SphereGeometry(0.07, 8, 6);
const waterMat = new THREE.MeshBasicMaterial({ color: '#5fb4e6', transparent: true, opacity: 0.9 });
export const squirt = { shots: 0, hits: 0, splats: 0, drips: 0, last: null };

export function initSquirt(o) {
  opt = o;
  addEventListener('keydown', e => {
    if (e.key !== 'f' && e.key !== 'F') return;
    if (e.ctrlKey || e.metaKey || e.altKey || modal() || /^(INPUT|TEXTAREA|SELECT)$/.test(e.target?.tagName || '') || e.target?.isContentEditable) return;
    if (opt.where() === 'off') return;
    e.preventDefault(); fire();
  });
  on('splashed', m => splashed(m));
}

/** The nearest player in front of me within range, else the nearest within half the range behind or beside. */
export function aim() {
  const me = opt.me(); if (!me) return null;
  const fx = Math.sin(me.r), fz = Math.cos(me.r);
  let best = null, near = null;
  for (const p of opt.peers()) {
    if (!p || p.id === net.welcome?.connId) continue;
    const dx = p.x - me.x, dz = p.z - me.z, d = Math.hypot(dx, dz);
    if (d > RANGE || d < 0.05) continue;
    if ((dx * fx + dz * fz) / d >= CONE) { if (!best || d < best.d) best = { ...p, d }; }
    else if (d < RANGE / 2 && (!near || d < near.d)) near = { ...p, d };
  }
  return best || near;
}

export function fire() {
  if (!opt || opt.where() === 'off') return false;
  const now = performance.now();
  if (now - lastShot < COOL_MS) return false;
  lastShot = now;
  const me = opt.me(); if (!me) return false;
  const target = aim();
  squirt.shots++;
  sound();
  btn?.classList.add('cool'); setTimeout(() => btn?.classList.remove('cool'), COOL_MS);
  const to = target ? { x: target.x, z: target.z } : { x: me.x + Math.sin(me.r) * 4, z: me.z + Math.cos(me.r) * 4 };
  arc(me, to);
  if (target) { send('splash', { to: target.id }); squirt.last = { to: target.id, at: Date.now() }; squirt.hits++; setTimeout(() => drip(target), FLIGHT * 1000); }
  return !!target;
}

/* ---------- droplets ---------- */
function arc(from, to, n = reduceMotion ? 3 : 9) {
  const scene = opt.sceneOf(); if (!scene) return;
  for (let i = 0; i < n; i++) {
    const m = new THREE.Mesh(dripGeo, waterMat); m.scale.setScalar(0.7 + Math.random() * 0.6);
    scene.add(m);
    drops.push({ m, scene, kind: 'arc', t: -i * 0.03, life: FLIGHT, from: { x: from.x, y: 1.1, z: from.z }, to: { x: to.x + (Math.random() - 0.5) * 0.3, y: 1.2, z: to.z + (Math.random() - 0.5) * 0.3 } });
  }
}
function drip(at) {
  const scene = opt.sceneOf(); if (!scene) return;
  const n = reduceMotion ? 4 : 14;
  for (let i = 0; i < n; i++) {
    const m = new THREE.Mesh(dripGeo, waterMat); m.scale.setScalar(0.5 + Math.random() * 0.5);
    scene.add(m);
    drops.push({ m, scene, kind: 'drip', t: -Math.random() * 1.6, life: 0.9, from: { x: at.x + (Math.random() - 0.5) * 0.6, y: 1.5 + Math.random() * 0.4, z: at.z + (Math.random() - 0.5) * 0.6 } });
  }
}
export function stepSquirt(dt) {
  for (let i = drops.length - 1; i >= 0; i--) {
    const d = drops[i]; d.t += dt;
    if (d.t < 0) { d.m.visible = false; continue; }
    d.m.visible = true;
    const f = Math.min(1, d.t / d.life);
    if (d.kind === 'arc') d.m.position.set(d.from.x + (d.to.x - d.from.x) * f, d.from.y + (d.to.y - d.from.y) * f + Math.sin(f * Math.PI) * 1.1, d.from.z + (d.to.z - d.from.z) * f);
    else d.m.position.set(d.from.x, d.from.y - f * f * 1.5, d.from.z);
    if (d.t >= d.life) { d.scene.remove(d.m); drops.splice(i, 1); }
  }
}
export function clearSquirt() { for (const d of drops) d.scene.remove(d.m); drops.length = 0; }

/* ---------- being hit ---------- */
function splashed(m) {
  if (!opt || !m) return;
  const self = net.welcome?.connId, me = opt.me(), peers = opt.peers();
  const toId = m.toId ?? self;                     // an older server sent it to the target only, without toId
  if (m.fromId === self) return;                   // the shooter drew the arc and the drip when firing
  const at = id => (id === self ? me : peers.find(p => p.id === id));
  const dst = at(toId);
  // where the shooter stands: from the peer list, else back along dir from the target
  const src = at(m.fromId) || (dst && m.dir ? { x: dst.x - m.dir.x * 3, z: dst.z - m.dir.z * 3 } : null);
  if (src && dst) arc(src, dst);
  if (dst) { squirt.drips++; setTimeout(() => drip(dst), FLIGHT * 1000); }   // everyone in the zone sees the target drip
  if (toId === self) splat({ fromName: m.from }, src, me);
}
function splat(m, src, me) {
  squirt.splats++;
  // which side of me the water came from, in screen terms: the camera looks down -z, so x is left and right
  let fx = '-50%', fy = '-50%';
  if (src && me) {
    const dx = src.x - me.x, dz = src.z - me.z, d = Math.hypot(dx, dz) || 1;
    fx = `calc(-50% + ${Math.round(dx / d * 60)}vw)`; fy = `calc(-50% + ${Math.round(dz / d * 50)}vh)`;
  }
  const el = document.createElement('div'); el.className = 'sh-splat'; el.setAttribute('aria-hidden', 'true');
  const drips = Array.from({ length: 7 }, (_, i) => `<i class="drip" style="left:${18 + i * 10 + Math.random() * 5}%;top:${38 + Math.random() * 18}%;--h:${60 + Math.random() * 120}px;animation-delay:${0.15 + Math.random() * 0.5}s"></i>`).join('');
  el.innerHTML = `<svg viewBox="0 0 200 200" style="--fx:${fx};--fy:${fy}"><path fill="rgba(95,180,230,.78)" stroke="rgba(255,255,255,.7)" stroke-width="3" d="M100 22c14 0 16 22 30 24s22-14 32-4-6 26 2 36 30 6 30 22-24 14-26 28 16 28 4 38-28-4-40 6-10 30-30 30-18-24-32-28-28 14-38 2 6-28-2-40-30-8-30-24 24-14 26-28-14-28-2-38 28 6 40-4 8-40 24-40z"/><ellipse cx="78" cy="78" rx="18" ry="11" fill="rgba(255,255,255,.55)" transform="rotate(-30 78 78)"/></svg>${drips}<p>Splashed by ${esc(m.fromName || 'someone')}!</p>`;
  document.body.append(el);
  try { navigator.vibrate?.(80); } catch { /* not supported */ }
  sound(0.6);
  setTimeout(() => el.remove(), 2600);
}

/* ---------- the button (park controls only) ---------- */
export function squirtButton(show) {
  if (!show) { btn?.remove(); btn = null; return null; }
  if (!btn) {
    btn = document.createElement('button'); btn.type = 'button'; btn.className = 'sh-squirt'; btn.id = 'squirtBtn';
    btn.setAttribute('aria-label', 'Water gun: spray the nearest player'); btn.title = 'Water gun (F)';
    btn.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 9h12l2-2h3v4h-3l-1 1h-3l-1 6H7l1-5H3z" fill="currentColor"/><circle cx="21" cy="14" r="1.2" fill="#fff"/><circle cx="22.5" cy="17" r=".9" fill="#fff"/></svg>';
    btn.addEventListener('click', e => { e.stopPropagation(); fire(); });
  }
  return btn;
}

/* ---------- the squirt sound: a short filtered noise burst ---------- */
let actx = null;
function sound(vol = 1) {
  try {
    actx ||= new (window.AudioContext || window.webkitAudioContext)();
    const len = 0.22, buf = actx.createBuffer(1, Math.floor(actx.sampleRate * len), actx.sampleRate), d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / d.length);
    const src = actx.createBufferSource(), bp = actx.createBiquadFilter(), g = actx.createGain();
    src.buffer = buf; bp.type = 'bandpass'; bp.frequency.setValueAtTime(1800, actx.currentTime); bp.frequency.exponentialRampToValueAtTime(600, actx.currentTime + len); bp.Q.value = 1.2;
    g.gain.value = 0.25 * vol;
    src.connect(bp).connect(g).connect(actx.destination); src.start();
  } catch { /* no audio here */ }
}
