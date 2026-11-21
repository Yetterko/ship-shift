// The town on the wire: the world snapshot, presence, zone changes and every town request, in one place.
// Built against docs/town-protocol.md. Nothing here draws anything.
//
// API
//   town                          { world, zone, on, offset }: the latest snapshot, the zone you stand in, whether a town exists
//   townNow()                     the server's clock, for rush and cooldown countdowns
//   loadTown() -> world | null    GET /api/world; null means "no town" (SHIP_WORLD=0, npm start): hide every town control
//   attach(ws)                    the socket to send on. game.js owns the socket; call this from connect() each time it opens
//   route(msg) -> boolean         hand every parsed socket message here first; true means the town used it
//   connectTown()                 only for pages without game.js (the park harness): opens and keeps its own socket
//   onWorld(fn) onPresence(fn) onZone(fn) onFresh(fn) onReset(fn) onState(fn)     subscribe; each returns an unsubscribe
//   sendPos(x, z, r, flags, force?)   call every frame; sends at 12 Hz while something changed and once a second otherwise.
//                                 force sends now: do it just before a take or put, which the server checks against your position
//   go(zone) -> Promise<zone msg> 'park' or 'k:<plot>'; resolves with the server's `zone` answer (which may carry `refused`)
//   emote(1…4), say(0…7)
//   take(id) put(id, plot|null) send(id, plot) accept(id) decline(id) setSign(sign) setMe({name, look, team})
//   cheer(plot) bell() freshKitchen() resetTown(token)
//                                 each resolves { ok:true, ... } or { ok:false, code, error }; none of them throws or toasts
//   me() plotOf(id) cardOf(id) playerOf(pid) teamOf(id) myPlot() relationTo(plot)     small readers over town.world
import { emit } from './core.js';
import { applyPresence, seedPresence, clearPresence } from './presence.js';

export const town = { world: null, zone: null, on: false, offset: 0, ws: null };
export const townNow = () => Date.now() + town.offset;

const subs = { world: [], p: [], zone: [], fresh: [], reset: [], state: [] };
const sub = name => fn => { subs[name].push(fn); return () => { subs[name] = subs[name].filter(f => f !== fn); }; };
const fire = (name, ...a) => { for (const fn of subs[name]) fn(...a); };
export const onWorld = sub('world'), onPresence = sub('p'), onZone = sub('zone'), onFresh = sub('fresh'), onReset = sub('reset'), onState = sub('state');

/* ---------- readers ---------- */
export const me = () => town.world?.players.find(p => p.pid === town.world.you.pid) || null;
export const plotOf = id => (id === null || id === undefined ? null : town.world?.plots[id] || null);
export const cardOf = id => town.world?.cards.find(c => c.id === id) || null;
export const playerOf = pid => town.world?.players.find(p => p.pid === pid) || null;
export const teamOf = id => town.world?.teams.find(t => t.id === id) || null;
export const myPlot = () => plotOf(town.world?.you.plot);
/** 'owner', 'team' or 'stranger' for a lived plot, or null for an empty one. */
export const relationTo = plot => (!plot?.owner || !town.world ? null : plot.owner === town.world.you.pid ? 'owner' : plot.team === town.world.you.team ? 'team' : 'stranger');

/* ---------- incoming ---------- */
function setWorld(w) {
  town.world = w; town.on = true; town.offset = w.now - Date.now();
  if (town.zone === null) town.zone = w.you.zone;
  seedPresence(w, town.zone);
  fire('world', w);
}
let goWait = null;
export function route(m) {
  if (!m || typeof m !== 'object') return false;
  if (m.type === 'world') { setWorld(m.world); return true; }
  if (m.type === 'p') { if (m.z === town.zone) applyPresence(m); fire('p', m); return true; }
  if (m.type === 'zone') {
    if (m.zone !== town.zone) clearPresence();
    town.zone = m.zone;
    if (town.world) { town.world.you.zone = m.zone; const p = me(); if (p) Object.assign(p, { zone: m.zone, x: m.x, z: m.z }); seedPresence(town.world, town.zone); }
    lastSent.t = 0;
    fire('zone', m);
    if (goWait) { const w = goWait; goWait = null; clearTimeout(w.timer); w.resolve(m); }
    return true;
  }
  if (m.type === 'fresh') { fire('fresh', m); return true; }
  if (m.type === 'reset') { fire('reset', m); return false; }       // game.js reloads the page on this one
  if (m.type === 'state') { fire('state', m); return false; }       // and draws kitchens
  return false;
}

/* ---------- outgoing ---------- */
export function attach(ws) { town.ws = ws; lastSent.t = 0; }
const raw = obj => { const ws = town.ws; if (!ws || ws.readyState !== 1) return false; ws.send(JSON.stringify(obj)); return true; };
const lastSent = { x: null, z: null, r: null, m: null, t: 0 };
export function sendPos(x, z, r, flags = 0, force = false) {
  if (town.zone === null) return;
  const now = performance.now();
  const cx = Math.round(x * 100), cz = Math.round(z * 100), cr = Math.round(Math.atan2(Math.sin(r), Math.cos(r)) * 100), m = flags & 3;
  const same = cx === lastSent.x && cz === lastSent.z && cr === lastSent.r && m === lastSent.m;
  if (!force && now - lastSent.t < (same ? 1000 : 83)) return;
  if (force && same && now - lastSent.t < 83) return;
  if (raw({ t: 'p', x: cx, z: cz, r: cr, m })) Object.assign(lastSent, { x: cx, z: cz, r: cr, m, t: now });
}
export function go(zone) {
  return new Promise(resolve => {
    if (goWait) { clearTimeout(goWait.timer); goWait.resolve({ zone: town.zone, refused: 'bad' }); }
    goWait = { resolve, timer: setTimeout(() => { goWait = null; resolve({ zone: town.zone, refused: 'timeout' }); }, 4000) };
    if (!raw({ t: 'go', z: zone })) { clearTimeout(goWait.timer); goWait = null; resolve({ zone: town.zone, refused: 'offline' }); }
  });
}
export const emote = e => raw({ t: 'emote', e });
export const say = q => raw({ t: 'say', q });

async function post(path, body = {}) {
  try {
    const res = await fetch(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    const data = await res.json().catch(() => ({}));
    if (res.status === 401) { emit('gone'); return { ok: false, code: 'gone', error: 'The kitchen has closed' }; }
    if (!res.ok) return { ok: false, code: data.code || String(res.status), error: data.error || `Request failed (${res.status})` };
    return { ok: true, ...data };
  } catch { return { ok: false, code: 'offline', error: 'The town is not answering' }; }
}
/** The server pushes the whole world a quarter of a second after a move. Until then the card that moved is shown where it went. */
function patch(r) {
  const w = town.world, c = r.ok && r.card; if (!w || !c) return r;
  const i = w.cards.findIndex(x => x.id === c.id);
  if (i < 0) w.cards.push(c); else w.cards[i] = c;
  for (const p of w.players) { p.carry = p.carry.filter(id => id !== c.id); if (c.state === 'held' && c.heldBy === p.pid) p.carry.push(c.id); }
  for (const pl of w.plots) {
    pl.queue = pl.queue.filter(id => id !== c.id); pl.offers = pl.offers.filter(id => id !== c.id);
    if (c.plot === pl.id && c.state === 'queued') pl.queue.push(c.id);
    if (c.plot === pl.id && c.state === 'offered') pl.offers.push(c.id);
  }
  fire('world', w);
  return r;
}
const card = id => `/api/world/cards/${encodeURIComponent(id)}`;
export const take = id => post(`${card(id)}/take`).then(patch);
export const put = (id, plot = null) => post(`${card(id)}/put`, { plot }).then(patch);
export const send = (id, plot) => post(`${card(id)}/send`, { plot }).then(patch);
export const accept = id => post(`${card(id)}/accept`).then(patch);
export const decline = id => post(`${card(id)}/decline`).then(patch);
export const setSign = sign => post('/api/world/sign', { sign }).then(r => { const pl = myPlot(); if (r.ok && pl) { pl.sign = r.sign; fire('world', town.world); } return r; });
export const setMe = body => post('/api/world/me', body).then(r => { if (r.ok && town.world) { Object.assign(town.world.you, r.you); const p = me(); if (p) Object.assign(p, { name: r.you.name, look: r.you.look, team: r.you.team }); fire('world', town.world); } return r; });
export const cheer = plot => post('/api/world/cheer', { plot });
export const bell = () => post('/api/world/bell');
export const freshKitchen = () => post('/api/demo/restart');
/** The presenter's reset. The token goes straight to the server and is never kept. */
export const resetTown = token => post('/api/world/reset', { token });

export async function loadTown() {
  try {
    const res = await fetch('/api/world');
    if (res.status !== 200) { town.on = false; return null; }
    setWorld(await res.json());
    return town.world;
  } catch { return null; }
}

/** A socket of its own, for a page that has no kitchen (the park harness). The game page uses attach() and route() instead. */
export function connectTown({ onClose = null } = {}) {
  let stopped = false;
  const open = () => {
    if (stopped) return;
    const ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`);
    ws.onopen = () => attach(ws);
    ws.onmessage = e => { let m; try { m = JSON.parse(e.data); } catch { return; } route(m); };
    ws.onclose = e => { if (e.code === 4001 || e.code === 4002) { stopped = true; onClose?.(e.code); return; } setTimeout(open, 1500); };
  };
  open();
  return () => { stopped = true; town.ws?.close(); };
}
