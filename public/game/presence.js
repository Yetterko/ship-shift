// Who else is standing where you are: the server relays positions 5 times a second as `peers`, and this plays them back
// a little late so that five messages a second look like walking.
//
//   LOOKS                         the avatar palette (index = `look`)
//   applyPeers(msg, selfId)       feed it every `peers` message of the zone on screen
//   peerList() -> [{ id, name, look, role, x, z, r, moving }]   where to draw everybody this frame
//   clearPeers()                  on a zone change: positions from the old zone mean nothing in the new one
import { clamp } from './core.js';

/** apron and hat band, and skin. */
export const LOOKS = [
  { name: 'Tomato', color: '#e5533d', skin: '#f3c9a0' },
  { name: 'Sky', color: '#4aa3d8', skin: '#d19c72' },
  { name: 'Basil', color: '#57b86a', skin: '#f6dcc0' },
  { name: 'Mustard', color: '#f2b23a', skin: '#94603f' },
  { name: 'Plum', color: '#c873d6', skin: '#f3c9a0' },
  { name: 'Teal', color: '#3f9e98', skin: '#d19c72' },
  { name: 'Rose', color: '#ee8fa6', skin: '#94603f' },
  { name: 'Ink', color: '#5b6ee1', skin: '#f6dcc0' },
];
export const lookOf = n => LOOKS[((Number(n) || 0) % LOOKS.length + LOOKS.length) % LOOKS.length];

const DELAY = 220, GONE_MS = 3000;
const tracks = new Map();     // id -> { id, name, look, role, a: {t,x,z,r}, b: {t,x,z,r}, seen }
let out = [];

export function applyPeers(msg, selfId = null, now = performance.now()) {
  const here = new Set();
  for (const p of msg?.peers || []) {
    if (!p || p.id === selfId || typeof p.x !== 'number' || typeof p.z !== 'number') continue;
    here.add(p.id);
    let k = tracks.get(p.id);
    const row = { t: now, x: p.x, z: p.z, r: p.r || 0 };
    if (!k) { k = { id: p.id, a: row, b: row }; tracks.set(p.id, k); }
    else { k.a = pointAt(k, now - DELAY); k.a.t = now - DELAY; k.b = row; }
    k.name = p.name || 'Guest'; k.look = p.look || 0; k.role = p.role || 'spectator'; k.seen = now;
  }
  for (const [id, k] of tracks) if (!here.has(id) && now - k.seen > GONE_MS) tracks.delete(id);
}
function pointAt(k, t) {
  const span = Math.max(1, k.b.t - k.a.t), f = clamp((t - k.a.t) / span, 0, 1);
  const d = Math.atan2(Math.sin(k.b.r - k.a.r), Math.cos(k.b.r - k.a.r));
  return { t, x: k.a.x + (k.b.x - k.a.x) * f, z: k.a.z + (k.b.z - k.a.z) * f, r: k.a.r + d * f };
}
export function peerList(now = performance.now()) {
  out = [];
  for (const k of tracks.values()) {
    if (now - k.seen > GONE_MS) continue;
    const p = pointAt(k, now - DELAY);
    const moving = Math.hypot(k.b.x - k.a.x, k.b.z - k.a.z) > 0.02 && now - DELAY < k.b.t;
    out.push({ id: k.id, name: k.name, look: k.look, role: k.role, x: p.x, z: p.z, r: p.r, moving });
  }
  return out;
}
export function clearPeers() { tracks.clear(); out = []; }
export const peerCount = () => tracks.size;
