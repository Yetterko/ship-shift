// Water fight: everyone looking at the same restaurant gets a waiter with a water gun and can soak the others.
// The server only relays. Each socket gets a player id and colour; positions, sprays and soaks pass through,
// rate limited and clamped, to the other sockets in the same restaurant. Nothing here touches the restaurant
// or its score: splashes are counted per room and reset when everyone leaves.

const COLORS = ['#2f8fdc', '#e5533d', '#57b86a', '#c873d6', '#f2a03a', '#3f9e98', '#d6457f', '#8a6be0'];
const NAMES = ['Splash', 'Drizzle', 'Puddle', 'Squirt', 'Soaker', 'Ripple', 'Mizzle', 'Torrent'];
const rooms = new WeakMap();   // the restaurant's socket set -> { next, players: Map<ws, player> }
const num = (v, lo, hi) => (Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : 0);

function roomFor(sockets) {
  let room = rooms.get(sockets);
  if (!room) { room = { next: 1, players: new Map() }; rooms.set(sockets, room); }
  return room;
}
const publicView = p => ({ id: p.id, name: p.name, color: p.color, x: p.x, z: p.z, ry: p.ry, splashes: p.splashes });
function sendTo(ws, msg) { if (ws.readyState === 1) ws.send(typeof msg === 'string' ? msg : JSON.stringify(msg)); }
function others(room, from, msg) {
  const s = JSON.stringify(msg);
  for (const [ws] of room.players) if (ws !== from) sendTo(ws, s);
}
function everyone(room, msg) {
  const s = JSON.stringify(msg);
  for (const [ws] of room.players) sendTo(ws, s);
}

/**
 * Joins a socket to the water fight of the restaurant whose sockets are in `sockets`.
 * Call it once per connection, after the socket is in the set.
 */
export function joinWaterFight(ws, sockets) {
  const room = roomFor(sockets);
  const n = room.next++;
  const me = { id: n, name: NAMES[(n - 1) % NAMES.length] + (n > NAMES.length ? ` ${Math.ceil(n / NAMES.length)}` : ''), color: COLORS[(n - 1) % COLORS.length], x: 2.4, z: 0.2, ry: 0, splashes: 0, bucket: 40, last: Date.now(), lastSpray: 0, lastSoak: 0 };
  room.players.set(ws, me);
  sendTo(ws, { type: 'water:hello', you: me.id, name: me.name, color: me.color, players: [...room.players.values()].filter(p => p !== me).map(publicView) });
  others(room, ws, { type: 'water:join', player: publicView(me) });

  ws.on('message', raw => {
    if (raw.length > 512) return;
    let m;
    try { m = JSON.parse(raw); } catch { return; }
    if (!m || typeof m.type !== 'string' || !m.type.startsWith('water:')) return;
    // a small token bucket: 40 messages a second is plenty for 10 Hz movement plus sprays
    const now = Date.now();
    me.bucket = Math.min(40, me.bucket + (now - me.last) * 0.04); me.last = now;
    if (me.bucket < 1) return;
    me.bucket--;
    if (m.type === 'water:pos') {
      me.x = num(m.x, -2, 6); me.z = num(m.z, -3.5, 3.5); me.ry = num(m.ry, -10, 10);
      others(room, ws, { type: 'water:pos', id: me.id, x: me.x, z: me.z, ry: me.ry, m: !!m.m });
    } else if (m.type === 'water:spray') {
      if (now - me.lastSpray < 120) return;
      me.lastSpray = now;
      others(room, ws, { type: 'water:spray', id: me.id, x: num(m.x, -2, 6), z: num(m.z, -3.5, 3.5), ry: num(m.ry, -10, 10) });
    } else if (m.type === 'water:soaked') {
      // the one who got wet reports it, so nobody can claim hits they did not land
      if (now - me.lastSoak < 900) return;
      const by = [...room.players.values()].find(p => p.id === m.by);
      if (!by || by === me) return;
      me.lastSoak = now;
      by.splashes++;
      everyone(room, { type: 'water:soaked', id: me.id, by: by.id, splashes: by.splashes });
    }
  });
  ws.on('close', () => {
    room.players.delete(ws);
    everyone(room, { type: 'water:leave', id: me.id });
  });
}
