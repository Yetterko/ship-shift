// The one WebSocket. Everything but static files travels on it (REBUILD.md section 5).
//
//   connect()                      opens /ws, says hello (with the owner token when there is one), reconnects with backoff
//   send(type, body)               any client message
//   act(name, args) -> Promise     an action on your own floor; resolves with the ack { ok, code?, message? }, never rejects
//   subscribe(floorId) -> Promise  resolves with the first `floor` message of that floor; replaces any earlier subscription
//   unsubscribe()                  back to the park and the overview
//   request(type, body) -> Promise resolves with the next `welcome` or `error` (chooseRole, createFloor)
//   on(type, fn)                   every server message of that type; also 'open', 'close'. Returns an unsubscribe function
//   net                            what is known now: welcome, building, role, token, homeId, subscribed, floor, connected
import { G, store } from './core.js';

export const PROTOCOL = 1;
export const net = {
  connected: false, everConnected: false,
  welcome: null, building: null,
  role: null, token: store.get('token') || null, homeId: null,
  subscribed: null, floor: null,
  sent: 0, received: 0,
};

const handlers = {};
export function on(type, fn) { (handlers[type] ||= []).push(fn); return () => { const l = handlers[type], i = l.indexOf(fn); if (i >= 0) l.splice(i, 1); }; }
function fire(type, msg) { for (const fn of [...(handlers[type] || [])]) { try { fn(msg); } catch (e) { console.error(e); } } }

let ws = null, retry = 0, retryTimer = null, seq = 0, closedByUs = false, helloOut = false;
const acks = new Map();        // seq -> resolve
let waiters = [];              // { types, resolve }
let subWait = null;            // { floorId, resolve }

const wsUrl = () => {
  const q = new URLSearchParams(location.search).get('ws');
  return q || `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`;
};

export function connect() {
  closedByUs = false;
  clearTimeout(retryTimer);
  try { ws = new WebSocket(wsUrl()); } catch { schedule(); return; }
  const mine = ws;
  ws.onopen = () => {
    if (mine !== ws) return;
    retry = 0; net.connected = true;
    raw('hello', net.token ? { v: PROTOCOL, token: net.token } : { v: PROTOCOL }); helloOut = true;
    // A reconnect: the server has forgotten this socket, so say again who we are and what we are watching.
    if (net.everConnected) {
      if (net.role && !net.token) raw('chooseRole', { role: net.role });
      if (net.subscribed) raw('subscribe', { floorId: net.subscribed });
    }
    net.everConnected = true;
    fire('open', {});
  };
  ws.onmessage = e => {
    if (mine !== ws) return;
    let msg; try { msg = JSON.parse(e.data); } catch { return; }
    if (!msg || typeof msg.type !== 'string') return;
    net.received++;
    receive(msg);
  };
  ws.onclose = () => {
    if (mine !== ws) return;
    net.connected = false;
    for (const [, resolve] of acks) resolve({ ok: false, code: 'offline', message: 'The connection dropped. Try again.' });
    acks.clear();
    fire('close', {});
    if (!closedByUs) schedule();
  };
  ws.onerror = () => {};
}
function schedule() {
  clearTimeout(retryTimer);
  retryTimer = setTimeout(connect, Math.min(5000, 300 * 2 ** retry++));
}
/** Tests only: drops the socket as a phone does when its screen locks. */
export function dropForTest() { try { ws?.close(); } catch { /* already gone */ } }
export function disconnect() { closedByUs = true; clearTimeout(retryTimer); try { ws?.close(); } catch { /* already gone */ } }

function raw(type, body = {}) {
  if (!ws || ws.readyState !== 1) return false;
  ws.send(JSON.stringify({ type, ...body })); net.sent++;
  return true;
}
export const send = raw;

function receive(msg) {
  const now = msg.now ?? msg.serverNow;
  if (typeof now === 'number') G.offset = now - Date.now();
  switch (msg.type) {
    case 'welcome': {
      net.welcome = { ...(net.welcome || {}), ...msg };
      net.role = msg.role ?? net.role;
      if (msg.token) { net.token = msg.token; store.set('token', msg.token); }
      if ('floorId' in msg) net.homeId = msg.floorId || null;
      // A token the server no longer knows: the floor is gone, so stop offering it.
      if (helloOut) { helloOut = false; if (net.token && !msg.floorId) forgetHome(); }
      settle('welcome', msg);
      break;
    }
    case 'error': settle('error', msg); break;
    case 'building': net.building = msg; break;
    case 'floor': {
      const id = msg.floor?.id;
      if (!id || id !== net.subscribed) return;          // a late message from the floor we just left
      net.floor = msg;
      if (subWait && subWait.floorId === id) { const w = subWait; subWait = null; w.resolve(msg); }
      break;
    }
    case 'ack': { const r = acks.get(msg.seq); if (r) { acks.delete(msg.seq); r(msg); } break; }
    case 'peers': break;
    case 'notify': break;
    default: break;
  }
  fire(msg.type, msg);
}
function settle(type, msg) {
  const hit = waiters.filter(w => w.types.includes(type));
  if (!hit.length) return;
  waiters = waiters.filter(w => !hit.includes(w));
  for (const w of hit) w.resolve(msg);
}

/** Sends a message whose answer is the next `welcome` or `error`. Resolves with that message, or { type: 'error', code: 'offline' }. */
export function request(type, body = {}, { timeout = 8000 } = {}) {
  return new Promise(resolve => {
    const w = { types: ['welcome', 'error'], resolve: m => { clearTimeout(t); resolve(m); } };
    const t = setTimeout(() => { waiters = waiters.filter(x => x !== w); resolve({ type: 'error', code: 'offline', message: 'The server did not answer. Try again.' }); }, timeout);
    waiters.push(w);
    if (!raw(type, body)) { clearTimeout(t); waiters = waiters.filter(x => x !== w); resolve({ type: 'error', code: 'offline', message: 'Not connected yet. Try again in a moment.' }); }
  });
}

/** An action on your own floor. Always resolves; a refusal is { ok: false, code, message }. */
export function act(name, args = {}) {
  return new Promise(resolve => {
    const n = ++seq;
    const t = setTimeout(() => { if (acks.delete(n)) resolve({ ok: false, code: 'timeout', message: 'The kitchen did not answer. Try again.' }); }, 8000);
    acks.set(n, m => { clearTimeout(t); resolve(m); });
    if (!raw('action', { seq: n, name, args })) { clearTimeout(t); acks.delete(n); resolve({ ok: false, code: 'offline', message: 'Not connected. Reconnecting…' }); }
  });
}

/** Watches one floor. Resolves with its first snapshot message, or null when none came in time. */
export function subscribe(floorId, { timeout = 6000 } = {}) {
  net.subscribed = floorId; net.floor = null;
  if (subWait) { subWait.resolve(null); subWait = null; }
  return new Promise(resolve => {
    const t = setTimeout(() => { if (subWait?.floorId === floorId) subWait = null; resolve(null); }, timeout);
    subWait = { floorId, resolve: m => { clearTimeout(t); resolve(m); } };
    raw('subscribe', { floorId });
  });
}
export function unsubscribe() {
  if (subWait) { subWait.resolve(null); subWait = null; }
  if (net.subscribed) raw('unsubscribe', {});
  net.subscribed = null; net.floor = null;
}

/** The owner token is spent: the floor was left or destroyed. */
export function forgetHome() { net.token = null; net.homeId = null; store.set('token', null); }

let lastPos = 0;
/** Your avatar's place in the current zone; at most 10 a second reach the server. */
export function sendPos(x, z, r = 0) {
  const now = performance.now();
  if (now - lastPos < 100) return false;
  lastPos = now;
  return raw('p', { x: Math.round(x * 100) / 100, z: Math.round(z * 100) / 100, r: Math.round(r * 100) / 100 });
}

export const lineOf = id => net.building?.floors?.find(f => f.id === id) || null;
/** Resolves with the first building summary, or null if none comes soon (it is sent every 2 s). */
export function buildingReady(timeout = 2600) {
  if (net.building) return Promise.resolve(net.building);
  return new Promise(resolve => {
    const off = on('building', m => { off(); clearTimeout(t); resolve(m); });
    const t = setTimeout(() => { off(); resolve(null); }, timeout);
  });
}
