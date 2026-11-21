// Connections, roles, live slots (with the judges' reserved ones), the queue for a live slot, and owner tokens.
import { ROLES } from '../shared/protocol.js';

const NAMES = ['Ana', 'Ben', 'Cleo', 'Dev', 'Eli', 'Fern', 'Gus', 'Hana', 'Ivo', 'Jules', 'Kai', 'Lena', 'Milo', 'Nia', 'Omar', 'Pia', 'Quin', 'Rex', 'Suki', 'Tom', 'Uma', 'Vic', 'Wren', 'Yara', 'Zed'];
const LOOKS = 8;

export class Roles {
  /** @param {{config:object, now:()=>number, floors:import('./floors.mjs').FloorManager, budget:import('./budget.mjs').Budget}} ctx */
  constructor(ctx) {
    this.ctx = ctx;
    /** @type {Map<string, object>} */
    this.conns = new Map();
    this.nextConn = 1;
    /** connection ids waiting for a live slot, in order */
    this.queue = [];
    /** { connId, until } while a freed slot is held for the head of the queue */
    this.hold = null;
  }

  add(send) {
    const n = this.nextConn++;
    const conn = {
      id: `c${n}`, send, role: 'spectator', name: `${NAMES[n % NAMES.length]} ${10 + (n % 90)}`, look: n % LOOKS,
      floorId: null, subscribed: null, pos: null, stamps: [], splashAt: 0, open: true,
    };
    this.conns.set(conn.id, conn);
    return conn;
  }

  remove(conn) {
    conn.open = false;
    this.conns.delete(conn.id);
    this.leaveQueue(conn);
  }

  setRole(conn, role) {
    if (!ROLES.includes(role)) return false;
    conn.role = role;
    return true;
  }

  /** Every open connection that owns this floor. */
  owners(floor) { return [...this.conns.values()].filter(c => c.floorId === floor.id); }
  subscribers(floor) { return [...this.conns.values()].filter(c => c.subscribed === floor.id); }

  /** Live floors now, split into the general pool and the judges' reserve. */
  #counts() {
    let player = 0, judge = 0;
    // A floor whose shift has ended holds no slot, though it stays up 5 min for its Shift report.
    for (const f of this.ctx.floors.list()) if (f.mode === 'live' && f.shift.status === 'running') f.ownerRole === 'judge' ? judge++ : player++;
    const { maxLiveFloors, judgeSlots } = this.ctx.config;
    const general = player + Math.max(0, judge - judgeSlots);
    const held = this.hold && this.hold.until > this.ctx.now() ? 1 : 0;
    return { player, judge, general, generalMax: Math.max(0, maxLiveFloors - judgeSlots), held };
  }

  /** Whether a live slot is free for this role (a held slot counts as taken for everyone but its holder). */
  slotFree(role, conn = null) {
    const c = this.#counts();
    const mine = this.hold && conn && this.hold.connId === conn.id && this.hold.until > this.ctx.now();
    const held = mine ? 0 : c.held;
    if (role === 'judge' && c.judge < this.ctx.config.judgeSlots) return true;
    return c.general + held < c.generalMax;
  }

  /** Whether a new live floor could start for this role now: a slot, a key and budget. */
  liveOpen(role, conn = null) {
    const b = this.ctx.budget;
    if (!b.enabled) return false;
    if (!this.slotFree(role, conn)) return false;
    return b.canAfford({ kind: this.ctx.config.showcase ? 'showcase' : 'audience', ownerRole: role, budget: { spentUsd: 0, capUsd: b.capFor({ kind: 'audience', ownerRole: role }) }, priv: {} }, 0.0001);
  }

  /** Claims the held slot if this connection holds it. */
  takeHold(conn) { if (this.hold && this.hold.connId === conn.id) this.hold = null; }

  slots() {
    const c = this.#counts();
    return { liveUsed: c.player + c.judge, liveMax: this.ctx.config.maxLiveFloors, judgeUsed: c.judge, judgeMax: this.ctx.config.judgeSlots, queued: this.queue.length };
  }

  joinQueue(conn) { if (!this.queue.includes(conn.id)) this.queue.push(conn.id); this.offer(); }
  leaveQueue(conn) {
    this.queue = this.queue.filter(id => id !== conn.id);
    if (this.hold?.connId === conn.id) { this.hold = null; this.offer(); }
  }
  queuePosition(conn) { return this.queue.indexOf(conn.id); }

  /** When a slot is free and someone queues, hold it 30 s for them and tell them (notify slotFree). */
  offer() {
    const now = this.ctx.now();
    if (this.hold && this.hold.until > now) return;
    this.hold = null;
    while (this.queue.length) {
      const conn = this.conns.get(this.queue[0]);
      if (!conn) { this.queue.shift(); continue; }
      const role = conn.role === 'judge' ? 'judge' : 'player';
      if (!this.slotFree(role, conn)) return;
      this.queue.shift();
      this.hold = { connId: conn.id, until: now + this.ctx.config.slotHoldMs };
      conn.send({ type: 'notify', kind: 'slotFree', floorId: conn.floorId, text: 'A live kitchen is free. It is held for you for 30 seconds.' });
      return;
    }
  }
}
