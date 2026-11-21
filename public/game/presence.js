// Who is where: the other players' positions as the server reports them, played back 100 ms late so that twelve messages
// a second look like smooth walking. Also what a player looks like (the avatar palette is the client's) and what they can say.
//
// API
//   LOOKS, EMOTES, PHRASES        the avatar palette (index = `look`), the four emotes (1…4) and the eight canned phrases (0…7)
//   applyPresence(msg)            feed it every `{type:'p', z, ps}` message
//   seedPresence(world, zone)     feed it every world snapshot: players that have not moved yet still get a place to stand
//   sample(pid) -> { x, z, r, moving, dash, carrying, e, eAt } | null     where to draw that player this frame
//   sayLocal(pid, e)              shows your own emote or phrase at once, without waiting for the server's echo
//   clearPresence()               on a zone change: positions from the old zone mean nothing in the new one
//   syncAvatars(zone, world, kit) / stepAvatars(dt, t)    full-size chefs for the people standing in a kitchen with you (see below)
import { clamp } from './core.js';

/** apron and hat band, skin, and the hair a customer of that look would have. */
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
export const EMOTES = [null, { id: 1, name: 'Wave', mood: 'wave' }, { id: 2, name: 'Cheer', mood: 'cheer' }, { id: 3, name: 'Help', mood: 'blocked' }, { id: 4, name: 'Heart', mood: 'cheer' }];
export const PHRASES = ['Hello!', 'Need a hand?', 'This one is for you', 'Thank you!', 'On my way', 'My chef is stuck!', 'Lunch rush!', 'Nice ship!'];
/** What `e` in a presence row means: { emote: 1…4 } or { phrase: 0…7 } or null. */
export const meaning = e => (e >= 10 && e < 10 + PHRASES.length ? { phrase: e - 10 } : e >= 1 && e <= 4 ? { emote: e } : null);

const DELAY = 100, KEEP = 12, SHOW_MS = 2600;
const tracks = new Map();   // pid -> { s: [{ t, x, z, r, m }], e, eAt, zone }
const out = { x: 0, z: 0, r: 0, moving: false, dash: false, carrying: false, e: 0, eAt: 0 };
const track = pid => { let k = tracks.get(pid); if (!k) { k = { s: [], e: 0, eAt: 0, zone: null }; tracks.set(pid, k); } return k; };

export function applyPresence(msg, now = performance.now()) {
  for (const [pid, cx, cz, cr, m, e] of msg.ps || []) {
    const k = track(pid), last = k.s.at(-1), row = { t: now, x: cx / 100, z: cz / 100, r: cr / 100, m: m | 0 };
    k.zone = msg.z;
    // somebody who stood still for a while and then stepped off: without this they would glide for the whole time they stood
    if (last && now - last.t > 260) k.s.push({ ...last, t: now - 90 });
    k.s.push(row);
    if (k.s.length > KEEP) k.s.splice(0, k.s.length - KEEP);
    if ((e | 0) !== k.e) { k.e = e | 0; if (k.e) k.eAt = now; }
  }
}
export function seedPresence(world, zone, now = performance.now()) {
  const here = new Set();
  for (const p of world.players) {
    if (p.zone !== zone || p.x === null) continue;
    here.add(p.pid);
    const k = track(p.pid);
    if (!k.s.length || k.zone !== zone) { k.s = [{ t: now - 1000, x: p.x, z: p.z, r: p.r, m: 0 }]; k.zone = zone; }
  }
  for (const [pid, k] of tracks) if (!here.has(pid) && now - (k.s.at(-1)?.t ?? 0) > 3000) tracks.delete(pid);
}
export function clearPresence() { tracks.clear(); }
export function sayLocal(pid, e, now = performance.now()) { const k = track(pid); k.e = e; k.eAt = now; }

const turn = (a, b, f) => { const d = Math.atan2(Math.sin(b - a), Math.cos(b - a)); return a + d * f; };
export function sample(pid, now = performance.now()) {
  const k = tracks.get(pid); if (!k || !k.s.length) return null;
  const rt = now - DELAY, s = k.s;
  let a = s[0], b = s[0];
  for (let i = s.length - 1; i >= 0; i--) { if (s[i].t <= rt) { a = s[i]; b = s[i + 1] || s[i]; break; } }
  const f = b === a ? 0 : clamp((rt - a.t) / Math.max(1, b.t - a.t), 0, 1);
  out.x = a.x + (b.x - a.x) * f; out.z = a.z + (b.z - a.z) * f; out.r = turn(a.r, b.r, f);
  out.moving = b !== a && Math.hypot(b.x - a.x, b.z - a.z) > 0.01 && rt < b.t + 40;
  out.dash = !!(b.m & 2); out.carrying = !!(b.m & 4);
  const live = k.e && now - k.eAt < SHOW_MS;
  out.e = live ? k.e : 0; out.eAt = k.eAt;
  return out;
}

/* ---------- full-size chefs for a kitchen zone ----------
   The park draws everybody itself (park.js, instanced). Inside a kitchen the visitors are few, so each gets the kitchen's own
   chef. world.js owns that character, so Builder C hands it in:
     kit = { make({ look, name, pid }) -> avatar with .g (a THREE.Group already in the kitchen scene),
             pose(avatar, dt, t, { moving, mood }), remove(avatar), label?(avatar, name, t) }
   Call syncAvatars(zone, world, kit) on every world snapshot and zone change, and stepAvatars(dt, t) every frame. */
const avatars = new Map();    // pid -> { av, name }
let avatarKit = null;
export function syncAvatars(zone, world, kit) {
  avatarKit = kit || avatarKit;
  const want = new Map();
  if (avatarKit && world && zone && zone !== 'park') for (const p of world.players) if (p.zone === zone && p.pid !== world.you.pid) want.set(p.pid, p);
  for (const [pid, a] of avatars) if (!want.has(pid)) { avatarKit?.remove(a.av); avatars.delete(pid); }
  for (const [pid, p] of want) if (!avatars.has(pid)) avatars.set(pid, { av: avatarKit.make({ look: LOOKS[p.look % LOOKS.length], name: p.name, pid }), name: p.name });
  return avatars;
}
export function stepAvatars(dt, t) {
  if (!avatarKit) return;
  for (const [pid, a] of avatars) {
    const s = sample(pid); if (!s) { a.av.g.visible = false; continue; }
    a.av.g.visible = true;
    a.av.g.position.x = s.x; a.av.g.position.z = s.z; a.av.g.rotation.y = s.r;
    const say = meaning(s.e);
    avatarKit.pose(a.av, dt, t, { moving: s.moving, mood: say?.emote ? EMOTES[say.emote].mood : 'idle' });
    avatarKit.label?.(a.av, a.name, t, say);
  }
}
