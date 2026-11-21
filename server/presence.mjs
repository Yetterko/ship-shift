// Avatar positions per zone (a floor id, or 'park'), relayed 5 times a second to zones with more than one connection,
// and the water gun: a splash between two avatars standing close together in the same zone.

export const zoneOf = conn => conn.subscribed || 'park';
/** A message already turned into JSON (game.mjs gives every connection sendRaw); a bare test connection gets the object. */
const sendText = (c, text, msg = null) => (c.sendRaw ? c.sendRaw(text) : c.send(msg ?? JSON.parse(text)));
const MAX_PEERS = 30;
const SPLASH_RANGE = 6, SPLASH_EVERY_MS = 1000, SPLASH_TARGET_COOLDOWN_MS = 1500;

/** Records a `p` message. At most 10 a second are kept per connection. */
export function move(conn, { x, z, r }, now) {
  if (![x, z].every(Number.isFinite)) return;
  if (conn.posAt && now - conn.posAt < 90) return;
  conn.posAt = now;
  const clamp = v => Math.max(-100, Math.min(100, v));
  conn.pos = { x: Math.round(clamp(x) * 100) / 100, z: Math.round(clamp(z) * 100) / 100, r: Number.isFinite(r) ? Math.round(r * 100) / 100 : 0, zone: zoneOf(conn) };
  conn.moved = true;
}

/** One `peers` message per busy zone where someone moved (and every second anyway). */
export function relay(conns, now, state) {
  const zones = new Map();
  for (const c of conns) {
    const zone = zoneOf(c);
    if (!zones.has(zone)) zones.set(zone, []);
    zones.get(zone).push(c);
  }
  const full = !state.lastFull || now - state.lastFull >= 1000;
  if (full) state.lastFull = now;
  for (const [zone, list] of zones) {
    if (list.length < 2) continue;
    if (!full && !list.some(c => c.moved)) continue;
    const peers = list.filter(c => c.pos && c.pos.zone === zone).slice(0, MAX_PEERS)
      .map(c => ({ id: c.id, name: c.name, look: c.look, role: c.role, x: c.pos.x, z: c.pos.z, r: c.pos.r }));
    // one JSON string per zone, not one per listener: a busy park is 30 listeners five times a second
    const text = JSON.stringify({ type: 'peers', zone, peers });
    for (const c of list) sendText(c, text);
  }
  for (const c of conns) c.moved = false;
}

/**
 * The water gun. Allowed when both stand in the same zone within about 6 units; 1 a second per sender,
 * and a short cooldown per target. Everyone in the zone hears it (so all see the target drip); the client shows the
 * splash overlay only when toId is its own connId. No score, no other effect.
 * @returns {string|null} a refusal reason, or null when it was sent
 */
export function splash(from, to, now, conns = [to]) {
  if (!to || to === from || !to.open) return 'gone';
  if (!from.pos || !to.pos || zoneOf(from) !== zoneOf(to) || from.pos.zone !== zoneOf(from) || to.pos.zone !== zoneOf(to)) return 'far';
  const dx = to.pos.x - from.pos.x, dz = to.pos.z - from.pos.z, d = Math.hypot(dx, dz);
  if (d > SPLASH_RANGE) return 'far';
  if (now - (from.splashAt || 0) < SPLASH_EVERY_MS) return 'rate';
  if (now - (to.splashedAt || 0) < SPLASH_TARGET_COOLDOWN_MS) return 'cooldown';
  from.splashAt = now; to.splashedAt = now;
  const dir = d ? { x: Math.round((dx / d) * 1000) / 1000, z: Math.round((dz / d) * 1000) / 1000 } : { x: 0, z: 1 };
  const msg = { type: 'splashed', from: from.name, fromId: from.id, toId: to.id, dir }, text = JSON.stringify(msg);
  const zone = zoneOf(to);
  for (const c of conns) if (c.open && zoneOf(c) === zone) sendText(c, text, msg);
  return null;
}
