// Public demo mode: one private kitchen per visitor, found by a session cookie.
// A session owns a directory (its own demo repo, data and worktrees) and is removed whole when the visitor goes idle.
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

const MARK = '.ship-shift-sessions';
const COOKIE = 'ship_sid';
const ID = /^[a-f0-9]{32}$/;
const RM = { recursive: true, force: true, maxRetries: 10, retryDelay: 200 };

/** The visitor's session id from the Cookie header, or null. Only ever a 32 character hex string. */
export function sessionIdFrom(req) {
  for (const part of String(req.headers.cookie || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === COOKIE) { const v = part.slice(i + 1).trim(); return ID.test(v) ? v : null; }
  }
  return null;
}

export const sessionCookie = (id, secure) => `${COOKIE}=${id}; Path=/; HttpOnly; SameSite=Lax; Max-Age=86400${secure ? '; Secure' : ''}`;

/** True while fewer than `max` stamps fall inside the window; records this one when it is allowed. */
export function allow(stamps, max, windowMs) {
  const t = Date.now();
  while (stamps.length && stamps[0] <= t - windowMs) stamps.shift();
  if (stamps.length >= max) return false;
  stamps.push(t);
  return true;
}

const reEsc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
// A path separator as it shows up in text: a slash, a backslash, or a backslash escaped inside JSON.
const SEP = String.raw`(?:\\\\|\\|/)`;
const pathPattern = dir => path.resolve(dir).split(/[\\/]+/).map(reEsc).join(SEP);

/**
 * Hides where the server keeps things: a visitor sees `~/kitchen/repo`, never the host's directories or a session id.
 * Works on plain text and on JSON, where Windows separators are doubled.
 */
export function scrubber(sessionsDir, root) {
  const session = new RegExp(`${pathPattern(sessionsDir)}${SEP}[a-f0-9]{32}`, 'gi');
  const home = new RegExp(pathPattern(root), 'gi');
  return text => String(text).replace(session, '~/kitchen').replace(home, '~');
}

export class Sessions {
  /**
   * build(dir) makes one visitor's kitchen inside dir and returns { kitchen, stop() }.
   * max is how many kitchens may be open at once, and idleMs how long one lives after its visitor's last request.
   */
  constructor({ dir, max = 25, idleMs = 20 * 60_000, build }) {
    Object.assign(this, { dir: path.resolve(dir), max, idleMs, build });
    this.live = new Map();
    this.closing = new Set();
  }

  get size() { return this.live.size; }

  /** Clears kitchens left by the last run. Only ever deletes a directory this class created and marked. */
  async init() {
    const exists = await fs.stat(this.dir).then(() => true, () => false);
    if (exists) {
      const ours = await fs.stat(path.join(this.dir, MARK)).then(() => true, () => false);
      const empty = !ours && (await fs.readdir(this.dir)).length === 0;
      if (!ours && !empty) throw new Error(`${this.dir} was not made by Ship Shift's public mode, so it will not be cleared. Point SHIP_SESSIONS_DIR at an empty or new directory.`);
      await fs.rm(this.dir, RM);
    }
    await fs.mkdir(this.dir, { recursive: true });
    await fs.writeFile(path.join(this.dir, MARK), 'Ship Shift public mode. Each directory here is one visitor\'s kitchen, deleted when they go idle.\n');
    this.sweeper = setInterval(() => this.sweep(), Math.max(250, Math.min(30_000, this.idleMs / 4)));
    this.sweeper.unref();
  }

  /** The visitor's kitchen, or null when the id is unknown or its kitchen has closed. Counts as activity. */
  find(id) {
    const s = id ? this.live.get(id) : null;
    if (!s) return null;
    s.lastSeen = Date.now();
    return s;
  }

  /** Opens a kitchen for a new visitor, or returns null when every kitchen is taken. */
  open() {
    if (this.live.size >= this.max) this.sweep();
    if (this.live.size >= this.max) return null;
    const id = crypto.randomBytes(16).toString('hex');
    const s = { id, dir: path.join(this.dir, id), kitchen: null, stop: null, sockets: new Set(), lastSeen: Date.now(), requests: [], orders: [] };
    this.live.set(id, s);
    s.ready = this.build(s.dir).then(
      built => { Object.assign(s, built); return s; },
      async e => { await this.end(s); throw e; },
    );
    s.ready.catch(() => {});
    return s;
  }

  sweep() {
    const cutoff = Date.now() - this.idleMs;
    for (const s of [...this.live.values()]) if (s.lastSeen < cutoff) this.end(s).catch(e => console.error('Closing a kitchen failed:', e.message));
  }

  /** Closes one kitchen: frees its place at once, then stops its chefs and deletes its repo, data and worktrees. */
  end(s) {
    if (this.live.get(s.id) !== s) return Promise.resolve();
    this.live.delete(s.id);
    const done = (async () => {
      for (const ws of s.sockets) ws.close(4001, 'Kitchen closed');
      s.sockets.clear();
      await Promise.resolve(s.ready).catch(() => {});
      try { await s.stop?.(); } catch (e) { console.error('Stopping a kitchen failed:', e.message); }
      await fs.rm(s.dir, RM).catch(e => console.error(`Could not remove ${s.dir}: ${e.message}`));
    })();
    this.closing.add(done);
    done.finally(() => this.closing.delete(done));
    return done;
  }

  /** Closes every kitchen and removes the sessions directory. */
  async closeAll() {
    clearInterval(this.sweeper);
    for (const s of [...this.live.values()]) this.end(s);
    await Promise.all([...this.closing]);
    await fs.rm(this.dir, RM).catch(() => {});
  }
}
