// The game core without HTTP: connections, message routing, the per-floor loop, floor pushes, the building summary and
// presence. index.mjs puts it behind http + ws; tests drive it directly with an injected clock.
import { PROTOCOL, CODES, LIMITS, MODES } from '../shared/protocol.js';
import { FloorManager, snapshot } from './floors.mjs';
import { Roles } from './roles.mjs';
import { Budget } from './budget.mjs';
import { CallQueue } from './callqueue.mjs';
import { runAction } from './actions.mjs';
import { tick, applyTimings, updateDerived, endShift } from './loop.mjs';
import { buildingSummary } from './building.mjs';
import { move, relay, splash, zoneOf } from './presence.mjs';
import { estimateCall } from './budget.mjs';
import { chefWriter, makeClient } from './agents/chef.mjs';
import { customerReviewer } from './agents/customer.mjs';

const RATE_PER_S = 40;

/**
 * @param {{config:object, now?:()=>number, client?:object|null, showcase?:object|null, agents?:object|null}} opts
 */
export async function createGame({ config, now = Date.now, client = null, showcase = null, agents = null }) {
  const budget = new Budget(config);
  const queue = new CallQueue(config.maxInflight);
  const api = agents ? null : await makeClient(config, { client });
  /** @type {any} */
  const ctx = {
    config, now, budget, queue, showcase,
    agents: agents || (api ? { cook: chefWriter(api, config), review: customerReviewer(api, config) } : null),
  };
  // Live calls need a key (or the showcase), and a way to make them.
  if (!ctx.agents && !(config.showcase && showcase)) budget.config = { ...config, apiKey: '' };
  const floors = new FloorManager({ config, now, budget, applyTimings: (f, s) => applyTimings(ctx, f, s) });
  const roles = new Roles({ config, now, floors, budget });
  Object.assign(ctx, { floors, roles });

  ctx.canGoLive = floor => !ctx.whyNotLive(floor, null);
  ctx.whyNotLive = (floor, conn) => {
    if (!budget.enabled) return 'no_key';
    const holdsSlot = floor.mode === 'live' && floor.shift.status === 'running';
    if (!holdsSlot && !roles.slotFree(floor.ownerRole, conn)) return 'no_slot';
    if (!budget.canAfford(floor, estimateCall(floor.model, config.chefMaxTokens))) return 'no_budget';
    return null;
  };

  ctx.notify = (floor, kind, fields = {}, { watchers = false } = {}) => {
    const msg = { type: 'notify', kind, floorId: floor.id, ...fields };
    const to = new Set(roles.owners(floor));
    if (watchers) for (const c of roles.subscribers(floor)) to.add(c);
    for (const c of to) c.send(msg);
  };

  ctx.destroyFloor = (floor, why = 'closed') => {
    if (floor.priv.destroyed) return;
    for (const job of floor.priv.jobs.values()) budget.settle(job.ticket, 0);
    ctx.notify(floor, 'floorClosed', { text: why === 'left' ? 'The restaurant has closed.' : 'This restaurant has closed.' }, { watchers: true });
    for (const c of roles.subscribers(floor)) c.subscribed = null;
    for (const c of roles.owners(floor)) c.floorId = null;
    floors.destroy(floor);
    roles.offer();
  };

  const welcome = (conn, extra = {}) => {
    const floor = conn.floorId ? floors.get(conn.floorId) : null;
    const mode = config.defaultMode === 'demo' || !budget.enabled ? 'demo' : 'live';
    const timingsFor = m => (m === 'demo' || config.showcase ? 'short' : config.liveTimings);
    const set = t => ({ gracePeriodMs: config.timings[t].gracePeriodMs, maxWorkMs: config.timings[t].maxWorkMs, ranges: config.ranges[t] });
    conn.send({
      type: 'welcome', v: PROTOCOL, connId: conn.id, role: conn.role, name: conn.name, look: conn.look,
      ...(floor ? { token: floor.priv.token } : {}), floorId: floor?.id || null,
      serverNow: now(), showcase: config.showcase,
      defaults: { settings: set(timingsFor(mode)), mode, live: set(timingsFor('live')), demo: set('short') },
      limits: { items: LIMITS.items },
      liveOpen: roles.liveOpen(conn.role === 'judge' ? 'judge' : 'player', conn),
      queuePosition: roles.queuePosition(conn),
      ...extra,
    });
  };
  const error = (conn, code, extra = {}) => conn.send({ type: 'error', code, message: CODES[code] || code, ...extra });

  const sendFloor = (floor, conns, json = JSON.stringify(snapshot(floor))) => {
    const t = now();
    for (const c of conns) {
      const isOwner = c.floorId === floor.id;
      c.sendRaw(`{"type":"floor","floor":${json},"you":{"isOwner":${isOwner},"canAct":${isOwner}},"now":${t}}`);
    }
  };

  /** Owner and watcher fields the snapshot carries, refreshed before each push. */
  const presenceFields = floor => {
    const owners = roles.owners(floor), subs = roles.subscribers(floor);
    const connected = owners.length > 0;
    const away = connected && !owners.some(c => c.subscribed === floor.id);
    const watchers = subs.filter(c => c.floorId !== floor.id).length;
    if (connected !== floor.ownerConnected || away !== floor.ownerAway || watchers !== floor.watchers) {
      Object.assign(floor, { ownerConnected: connected, ownerAway: away, watchers });
      floor.priv.dirty = true;
    }
    if (connected) floor.priv.ownerGoneAt = null;
    else floor.priv.ownerGoneAt ??= now();
  };

  const handlers = {
    hello(conn, { v, token }) {
      if (v !== undefined && v !== PROTOCOL) return error(conn, 'bad_message');
      const floor = floors.byOwnerToken(typeof token === 'string' ? token : '');
      if (floor) { conn.floorId = floor.id; conn.role = floor.ownerRole; presenceFields(floor); }
      welcome(conn);
    },
    chooseRole(conn, { role }) {
      if (!roles.setRole(conn, role)) return error(conn, 'bad_message');
      welcome(conn);
    },
    createFloor(conn, { name, settings, mode }) {
      if (conn.role !== 'player' && conn.role !== 'judge') conn.role = 'player';
      const old = conn.floorId && floors.get(conn.floorId);
      if (old) ctx.destroyFloor(old, 'left');
      if (floors.size >= config.maxFloors) return error(conn, 'full');
      if (config.showcase && floors.size >= 1) return error(conn, 'full');
      let m = MODES.includes(mode) ? mode : config.defaultMode;
      const liveOff = m === 'live' && !budget.enabled;
      if (liveOff) m = 'demo';
      if (m === 'live' && !roles.liveOpen(conn.role, conn)) return error(conn, 'no_slot', { options: ['demo', 'visit', 'queue'] });
      if (m === 'live') roles.takeHold(conn);
      roles.leaveQueue(conn);
      const floor = floors.create({ ownerRole: conn.role, kind: config.showcase ? 'showcase' : 'audience', mode: m, name, settings: settings && typeof settings === 'object' ? settings : null });
      if (liveOff) floor.demoReason = 'no_key';
      conn.floorId = floor.id;
      presenceFields(floor);
      welcome(conn);
      if (liveOff) ctx.notify(floor, 'liveOff', { text: CODES.no_key });
    },
    joinQueue(conn) { roles.joinQueue(conn); welcome(conn); },
    leaveQueue(conn) { roles.leaveQueue(conn); },
    subscribe(conn, { floorId }) {
      const floor = floors.get(floorId);
      if (!floor) return error(conn, 'no_floor');
      conn.subscribed = floor.id; conn.pos = null;
      presenceFields(floor);
      updateDerived(ctx, floor, now());
      sendFloor(floor, [conn]);
    },
    unsubscribe(conn) {
      const floor = conn.subscribed && floors.get(conn.subscribed);
      conn.subscribed = null; conn.pos = null;
      if (floor) presenceFields(floor);
    },
    action(conn, { seq, name, args }) {
      const res = runAction(ctx, conn, name, args);
      conn.send({ type: 'ack', seq, ...res });
      flush();
    },
    p(conn, body) { move(conn, body, now()); },
    splash(conn, { to }) { splash(conn, roles.conns.get(to), now()); },
  };

  function message(conn, msg) {
    const t = now();
    conn.stamps = conn.stamps.filter(s => t - s < 1000);
    if (conn.stamps.length >= RATE_PER_S) { if (!conn.rateWarned) { conn.rateWarned = true; error(conn, 'rate'); } return; }
    conn.stamps.push(t); conn.rateWarned = false;
    if (!msg || typeof msg !== 'object' || typeof msg.type !== 'string' || !Object.hasOwn(handlers, msg.type)) return error(conn, 'bad_message');
    try { handlers[msg.type](conn, msg); } catch (e) { console.error('A message failed:', msg.type, e); error(conn, 'bad_message'); }
  }

  function connect(send) {
    const conn = roles.add(msg => { if (conn.open) send(JSON.stringify(msg)); });
    conn.sendRaw = text => { if (conn.open) send(text); };
    return conn;
  }

  function disconnect(conn) {
    roles.remove(conn);
    const home = conn.floorId && floors.get(conn.floorId);
    if (home) presenceFields(home);
    const sub = conn.subscribed && floors.get(conn.subscribed);
    if (sub && sub !== home) presenceFields(sub);
  }

  /** Sends every changed floor to its subscribers (at most 10 a second per floor, from the timer). */
  function flush() {
    for (const floor of floors.list()) {
      if (!floor.priv.dirty) continue;
      floor.priv.dirty = false;
      const subs = roles.subscribers(floor);
      if (subs.length) sendFloor(floor, subs);
    }
  }

  function tickAll(t = now()) {
    for (const floor of floors.list()) {
      presenceFields(floor);
      try { tick(ctx, floor, t); } catch (e) { console.error(`Floor ${floor.number} tick failed:`, e); }
      const p = floor.priv;
      if (p.ownerGoneAt !== null && t - p.ownerGoneAt >= config.idleDestroyMs) ctx.destroyFloor(floor, 'idle');
      else if (p.endedAt !== null && t - p.endedAt >= config.endedDestroyMs) ctx.destroyFloor(floor, 'ended');
    }
    roles.offer();
  }

  function building() {
    const msg = JSON.stringify(buildingSummary({ floors, roles, now: now() }));
    for (const c of roles.conns.values()) c.sendRaw(msg);
  }

  const presenceState = {};
  const peers = () => relay([...roles.conns.values()], now(), presenceState);

  let timers = [];
  function start() {
    timers = [
      setInterval(() => tickAll(), config.tickMs),
      setInterval(flush, config.floorFlushMs),
      setInterval(building, config.buildingEveryMs),
      setInterval(peers, config.peersEveryMs),
    ];
  }
  function stop() {
    timers.forEach(clearInterval); timers = [];
    for (const f of floors.list()) f.priv.abort.abort();
  }

  function usage() {
    const list = floors.list();
    return {
      ...budget.usage(),
      floors: { live: list.filter(f => f.mode === 'live').length, demo: list.filter(f => f.mode === 'demo').length, judges: list.filter(f => f.ownerRole === 'judge').length },
      queue: queue.stats(), liveQueue: roles.queue.length,
    };
  }

  function setDefaultMode(mode) {
    if (!MODES.includes(mode)) return false;
    config.defaultMode = mode;
    return true;
  }

  return { ctx, floors, roles, budget, queue, connect, disconnect, message, flush, tickAll, building, peers, start, stop, usage, setDefaultMode, endShift: f => endShift(ctx, f, now()) };
}

export { zoneOf };
