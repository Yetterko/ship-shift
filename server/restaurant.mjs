// The restaurant: customers (reviewer agents with tickets), the waiter's items, chefs (coding agents) at four stations,
// the counter, the bill, patience, scoring and the shift with its breaks and bell. Server-authoritative; the client draws it.
import { EventEmitter } from 'node:events';
import fs from 'node:fs/promises';
import path from 'node:path';
import * as G from './git.mjs';
import { simCustomer, claudeReview } from './customers.mjs';
import { simDriver } from './agents.mjs';

export const STATIONS = [
  { id: 'backend', name: 'Backend', color: '#4aa3d8', prompt: 'You are at the Backend station: server-side logic and HTTP handlers (src/*.js, src/app.js). Keep functions small and pure, validate inputs, and add node:test tests under test/.' },
  { id: 'frontend', name: 'Frontend', color: '#f2a03a', prompt: 'You are at the Frontend station: the roster page (public/index.html, its CSS and inline module script). No frameworks and no build step. Keep it accessible and consistent with the existing look.' },
  { id: 'database', name: 'Database', color: '#57b86a', prompt: 'You are at the Database station: data files and reference tables (data/*.json, lookup modules such as src/holidays.js). Keep formats backward compatible and comment any new field.' },
  { id: 'integration', name: 'Integration', color: '#c873d6', prompt: 'You are at the Integration station: interfaces to other systems (CSV exports in src/timesheet.js, API response shapes in src/app.js). Match required formats exactly, handle escaping and errors, and test the edge cases.' },
];
const STATION_IDS = STATIONS.map(s => s.id);
const DIFF_POINTS = { S: 1, M: 2, L: 3 };
const STRICT_MULT = { 1: 1, 2: 1.25, 3: 1.5 };
const STAMINA = { 25: 1, 50: 1.2, 90: 1.4 };
const STREAK_STEP = 0.25, STREAK_MAX = 2, PENALTY_CAP = 30;

/** The demo compresses a shift into three minutes; a real shift uses Pomodoro lengths. */
export const DEMO_TIMINGS = { shiftMin: 3, cooldownMs: 15_000, graceMs: 5_000, maxWorkMs: 120_000, patienceMs: { line: 45_000, seated: 40_000 }, rejoinMs: 25_000, eatMs: 4_000, walkMs: 900, penaltyEveryMs: 2_000 };
export const REAL_TIMINGS = { shiftMin: 25, cooldownMs: 300_000, graceMs: 60_000, maxWorkMs: 3_000_000, patienceMs: { line: 180_000, seated: 240_000 }, rejoinMs: 120_000, eatMs: 1_500, walkMs: 900, penaltyEveryMs: 10_000 };

const ADJ = ['Hungry', 'Cheeky', 'Sleepy', 'Golden', 'Salty', 'Rusty', 'Sunny', 'Lucky', 'Fancy', 'Busy', 'Jolly', 'Brave'];
const NOUN = ['Wombat', 'Kookaburra', 'Possum', 'Galah', 'Quokka', 'Platypus', 'Magpie', 'Echidna', 'Koala', 'Bilby', 'Dingo', 'Lorikeet'];
export const restaurantName = () => `The ${ADJ[Math.floor(Math.random() * ADJ.length)]} ${NOUN[Math.floor(Math.random() * NOUN.length)]}`;

const now = () => Date.now();
const sleep = ms => new Promise(r => setTimeout(r, ms));
const slug = s => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 28) || 'item';
const clean = (s, n) => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, n);
const IN_KITCHEN = new Set(['ready', 'cooking', 'plated', 'stalled']);
const SEATED = new Set(['seated', 'waiting_food', 'eating', 'feedback_ready']);

function emptyStats() {
  return {
    score: 0, streak: 1, bills: 0, served: 0, redos: 0, blindServes: 0, burntServed: 0, walkouts: 0, breaks: 0, breakMs: 0,
    forcedBreaks: 0, returnMs: [], longestServiceMs: 0, waitedMs: 0, waitingPenalty: 0, costUsd: 0, satisfaction: [], points: [],
  };
}

export class Restaurant extends EventEmitter {
  /**
   * chefs: [{ id, name, color, model, driver }]. customers: ticket definitions (see projects/roster-cafe.mjs).
   * creds(): { reviewKey, chefKey, ownKey, realChefs } decides, per call, which agents may be real and on whose key.
   * budget: the server's Budget (customers.mjs), or null for no caps.
   */
  constructor({ repo, dataDir, mainBranch = 'main', testCmd = 'npm test', chefs, customers = [], tables = 2, timings = DEMO_TIMINGS,
    customerModel = 'claude-haiku-5-5', creds = () => ({}), budget = null, publicMode = false, name = restaurantName(), allowCustom = true, project = '' }) {
    super();
    Object.assign(this, { repo, dataDir, mainBranch, testCmd, customerModel, creds, budget, publicMode, name, allowCustom, project });
    this.t = { ...timings, patienceMs: { ...timings.patienceMs } };
    this.account = budget?.account({ unlimited: !publicMode || undefined }) || { reviews: 0, reviewUsd: 0, chefItems: 0, chefUsd: 0 };
    this.stations = STATIONS.map(s => ({ id: s.id, name: s.name, color: s.color, chefId: null }));
    this.chefs = chefs.map(c => ({ id: c.id, name: c.name, color: c.color, model: c.model, driver: c.driver || simDriver, state: 'idle', itemId: null, stationId: null, walkUntil: 0 }));
    this.tables = [1, 2, 3, 4].map(id => ({ id, customerId: null, reserved: id > tables }));
    this.customers = [];
    this.lineSeq = 0;
    for (const def of customers) this.enqueue(def);
    this.items = [];
    this.questions = [];
    this.stats = emptyStats();
    this.shift = { phase: 'off', lengthMin: this.t.shiftMin, startedAt: null, endsAt: null, serviceSince: null, breakStartedAt: null, cooldownEndsAt: null, bellAt: null, graceEndsAt: null, forced: false, cooldownMs: this.t.cooldownMs, maxWorkMs: this.t.maxWorkMs, multiplier: 1, report: null };
    this.nextItemId = 1;
    this.runs = new Map();
    this.waiters = new Map();
    this.commits = 0;
    this.lastTick = now();
  }

  enqueue(def) {
    const id = this.customers.length + 1;
    const c = {
      id, key: def.key || `TASK-${id}`, title: clean(def.title, 120), body: String(def.body || '').slice(0, 2000), labels: def.labels || [],
      acceptance: def.acceptance || [], difficulty: DIFF_POINTS[def.difficulty] ? def.difficulty : 'M',
      persona: def.persona || { name: 'You', role: 'Developer', strictness: 2, color: '#8aa2e8' },
      presets: (def.presets || []).map(p => ({ ...p })), state: 'in_line', lineOrder: ++this.lineSeq, tableId: null, branch: null, worktree: null,
      patience: 1, draining: false, furious: false, waitMs: 0, episodeMs: 0, charged: 0, reviews: [], suggestions: [], itemCount: 0,
      reviewQueued: false, satisfaction: null, lastVerdict: null, bill: null, seatedAt: null, paidAt: null, walkedAt: null, feedbackAt: null,
    };
    this.customers.push(c);
    return c;
  }

  /* ---------- lifecycle ---------- */
  async init() {
    await fs.mkdir(this.dataDir, { recursive: true });
    // a restart leaves no live work: clear any table and kitchen branches and their worktrees from a previous run
    await G.git(this.repo, ['worktree', 'prune'], { allowFail: true });
    for (const b of await G.branchesLike(this.repo, ['table/', 'kitchen/'])) await G.git(this.repo, ['branch', '-D', b], { allowFail: true });
    await fs.rm(path.join(this.dataDir, 'worktrees'), { recursive: true, force: true, maxRetries: 5 }).catch(() => {});
    await fs.rm(path.join(this.dataDir, 'tables'), { recursive: true, force: true, maxRetries: 5 }).catch(() => {});
    await G.git(this.repo, ['worktree', 'prune'], { allowFail: true });
    this.timer = setInterval(() => this.tick(), 250);
  }

  changed() { if (!this.closed) this.emit('change'); }

  async close() {
    this.closed = true;
    clearInterval(this.timer);
    const runs = [...this.runs.values()];
    for (const r of runs) r.ctl.abort();
    for (const resolve of this.waiters.values()) resolve({ allow: false, message: 'The restaurant closed.' });
    this.waiters.clear(); this.questions = [];
    await Promise.all(runs.map(r => Promise.resolve(r.done).catch(() => {})));
    this.removeAllListeners();
  }

  /* ---------- lookups ---------- */
  customer(id) { const c = this.customers.find(x => x.id === Number(id)); if (!c) throw new Error(`No customer #${id}`); return c; }
  item(id) { const it = this.items.find(x => x.id === Number(id)); if (!it) throw new Error(`No item #${id}`); return it; }
  station(id) { return this.stations.find(s => s.id === id); }
  rail() { return this.items.filter(i => i.state === 'ready').sort((a, b) => (b.priority - a.priority) || (a.readyAt - b.readyAt)); }
  counter() { return this.items.filter(i => i.state === 'plated').sort((a, b) => a.platedAt - b.platedAt); }
  tableFree() { return this.tables.some(t => !t.reserved && !t.customerId); }
  freeTables() { return this.tables.filter(t => !t.reserved && !t.customerId).length; }
  /** The customers at the front of the line who could be seated right now: one per free table. */
  seatable() { return this.customers.filter(c => c.state === 'in_line').sort((a, b) => a.lineOrder - b.lineOrder).slice(0, this.freeTables()); }

  log(it, kind, text, file) {
    it.activity.push(file ? { t: now(), kind, text, file } : { t: now(), kind, text });
    if (it.activity.length > 40) it.activity.splice(0, it.activity.length - 40);
  }

  score(n, why, at = null) {
    if (!n) return;
    this.stats.score += n;
    this.stats.points.push({ t: now(), n, why, at });
    if (this.stats.points.length > 120) this.stats.points.splice(0, this.stats.points.length - 120);
  }

  /** Everything that is waiting on the waiter right now. Customers in line count only while a table is free. */
  waitingThings() {
    const out = this.seatable().map(c => ({ kind: 'line', id: c.id }));
    for (const c of this.customers) if (c.state === 'seated' || c.state === 'feedback_ready') out.push({ kind: 'customer', id: c.id });
    for (const it of this.counter()) out.push({ kind: 'item', id: it.id });
    for (const q of this.questions) out.push({ kind: 'question', id: q.id });
    return out;
  }
  breakEligible() {
    if (this.shift.phase !== 'service') return false;
    const busy = this.chefs.every(c => c.state === 'walking' || c.state === 'cooking');
    return busy || this.waitingThings().length === 0;
  }
  drainable(t = now()) {
    const p = this.shift.phase;
    return p === 'service' || (p === 'bell' && t >= (this.shift.graceEndsAt || 0));
  }

  snapshot() {
    const t = now();
    const drivers = new Set(this.chefs.map(c => c.driver.name));
    const cred = this.creds() || {};
    const reviewsReal = cred.reviewKey != null && !!this.budget?.canReview(this.account, cred.ownKey);
    const waiting = this.waitingThings().filter(w => w.kind !== 'line');
    const live = this.customers.filter(c => c.draining && c.state !== 'in_line').reduce((n, c) => n + c.episodeMs, 0);
    return {
      name: this.name, project: this.project, now: t, mainBranch: this.mainBranch, testCmd: this.testCmd, commits: this.commits,
      mode: drivers.size === 1 ? [...drivers][0] : 'mixed', reviews: reviewsReal ? 'claude' : 'script', customerModel: this.customerModel,
      allowCustom: this.allowCustom, publicMode: this.publicMode, ownKey: !!cred.ownKey, vip: !!cred.vip,
      settings: { tables: this.tables.filter(x => !x.reserved).length, chefs: this.chefs.length, timings: this.t },
      shift: { ...this.shift, eligible: this.breakEligible() },
      stations: this.stations,
      tables: this.tables,
      chefs: this.chefs.map(c => ({ id: c.id, name: c.name, color: c.color, model: c.model, driver: c.driver.name, state: c.state, itemId: c.itemId, stationId: c.stationId, blocked: this.questions.some(q => q.chefId === c.id) })),
      customers: this.customers.map(c => ({
        id: c.id, key: c.key, title: c.title, body: c.body, labels: c.labels, acceptance: c.acceptance, difficulty: c.difficulty, persona: c.persona,
        presets: c.presets, state: c.state, lineOrder: c.lineOrder, tableId: c.tableId, branch: c.branch, patience: c.patience, draining: c.draining,
        furious: c.furious, reviews: c.reviews, suggestions: c.suggestions, satisfaction: c.satisfaction, lastVerdict: c.lastVerdict,
        itemIds: this.items.filter(i => i.customerId === c.id).map(i => i.id), bill: c.bill, seatedAt: c.seatedAt, paidAt: c.paidAt, walkedAt: c.walkedAt, feedbackAt: c.feedbackAt,
      })),
      items: this.items.map(i => ({
        id: i.id, customerId: i.customerId, n: i.n, station: i.station, prompt: i.prompt, presetId: i.presetId, state: i.state, priority: i.priority,
        chefId: i.chefId, branch: i.branch, cookedBy: i.cookedBy, activity: i.activity.slice(-14), summary: i.summary, tests: i.tests, stat: i.stat,
        rounds: i.rounds, redos: i.redos, feedback: i.feedback, seen: i.seen, note: i.note, costUsd: i.costUsd, error: i.error,
        readyAt: i.readyAt, pickedAt: i.pickedAt, platedAt: i.platedAt, servedAt: i.servedAt, estMs: i.estMs,
      })),
      rail: this.rail().map(i => i.id),
      counter: this.counter().map(i => i.id),
      waiting: { count: waiting.length, ms: this.stats.waitedMs, live },
      questions: this.questions,
      stats: this.stats,
      spend: { session: this.account.reviewUsd + this.account.chefUsd, reviews: this.account.reviews, reviewsLeft: this.budget ? Math.max(0, this.budget.reviewsPerSession - this.account.reviews) : null, chefItemsLeft: this.budget ? Math.max(0, this.budget.chefItemsPerSession - this.account.chefItems) : null, practice: !!this.budget?.exhausted },
    };
  }

  /* ---------- shift, breaks and the bell ---------- */
  startShift({ lengthMin, cooldownMin, maxWorkMin } = {}) {
    if (['service', 'break', 'bell'].includes(this.shift.phase)) throw new Error('The shift is already running');
    const L = Math.max(1, Math.min(90, Number(lengthMin) || this.t.shiftMin));
    const cooldownMs = Number(cooldownMin) > 0 ? Math.max(5_000, Math.min(1_800_000, cooldownMin * 60_000)) : this.t.cooldownMs;
    const maxWorkMs = Number(maxWorkMin) > 0 ? Math.max(30_000, Math.min(5_400_000, maxWorkMin * 60_000)) : this.t.maxWorkMs;
    const t = now();
    this.shift = { phase: 'service', lengthMin: L, startedAt: t, endsAt: t + L * 60_000, serviceSince: t, breakStartedAt: null, cooldownEndsAt: null, bellAt: null, graceEndsAt: null, forced: false, cooldownMs, maxWorkMs, multiplier: STAMINA[L] || 1, report: null };
    this.changed();
  }

  stopShift() { if (this.shift.phase !== 'off' && this.shift.phase !== 'closed') this.closeShift(); }

  startBreak({ forced = false } = {}) {
    if (this.shift.phase !== 'service') throw new Error(this.shift.phase === 'off' ? 'Open the restaurant first' : 'You are not on the floor right now');
    if (!forced && !this.breakEligible()) throw new Error('Not yet: get every chef cooking first, or clear what is waiting on you.');
    const t = now();
    this.stats.longestServiceMs = Math.max(this.stats.longestServiceMs, t - this.shift.serviceSince);
    Object.assign(this.shift, { phase: 'break', breakStartedAt: t, cooldownEndsAt: t + this.shift.cooldownMs, bellAt: null, graceEndsAt: null, forced });
    this.changed();
  }

  endBreak() {
    const s = this.shift, t = now();
    if (s.phase !== 'break' && s.phase !== 'bell') throw new Error('You are not on a break');
    if (s.forced && t < s.cooldownEndsAt) throw new Error('Forced break: rest until the cooldown ends. The kitchen is still cooking.');
    if (!s.forced && t >= s.cooldownEndsAt) this.score(20, 'Proper break', { kind: 'break' });
    this.stats.breaks++;
    this.stats.breakMs += t - s.breakStartedAt;
    if (s.phase === 'bell' && s.bellAt) this.stats.returnMs.push(t - s.bellAt);
    Object.assign(s, { phase: 'service', serviceSince: t, forced: false, breakStartedAt: null, cooldownEndsAt: null, graceEndsAt: null });
    this.changed();
  }

  closeShift() {
    const t = now(), s = this.shift;
    if (s.phase === 'service') this.stats.longestServiceMs = Math.max(this.stats.longestServiceMs, t - s.serviceSince);
    s.phase = 'closed';
    s.report = this.report();
    if (s.report.multiplied) this.score(s.report.finalScore - this.stats.score, `Stamina ×${s.multiplier}`, { kind: 'shift' });
    this.changed();
  }

  report() {
    const st = this.stats, s = this.shift;
    const sat = st.satisfaction.length ? st.satisfaction.reduce((a, b) => a + b, 0) / st.satisfaction.length : null;
    const hours = Math.max(1 / 60, ((s.endsAt || now()) - (s.startedAt || now())) / 3_600_000);
    const demo = s.lengthMin < 25;
    let stars = 1;
    if (st.bills >= 1 && st.burntServed === 0 && st.score > 0) stars = 2;
    if (stars === 2 && st.bills >= (demo ? 2 : 3) && st.blindServes === 0 && st.breaks >= 1 && st.waitingPenalty <= 10) stars = 3;
    let advice;
    if (st.burntServed) advice = 'A dish with failing tests reached a customer. Check the oven lamp on the plate, and send red plates back.';
    else if (st.blindServes) advice = `You served ${st.blindServes} dish${st.blindServes > 1 ? 'es' : ''} without reading the diff. Scroll the whole plate before you serve to keep your streak.`;
    else if (!st.bills) advice = 'Nobody paid. Start with the small ticket so a bill lands early.';
    else if (st.waitingPenalty > 10) advice = `Customers waited ${Math.round(st.waitedMs / 1000)}s on you. Check the counter and raised hands as soon as the bell rings.`;
    else if (!st.breaks) advice = 'You never took a break. When every chef is cooking, step away: the bell will call you back.';
    else if (st.forcedBreaks) advice = 'You hit the maximum work time. Take your break before the kitchen makes you.';
    else if (st.walkouts) advice = 'Someone walked out of the line. Seat customers as soon as a table frees up.';
    else advice = 'Clean service. Try a longer shift for the stamina multiplier.';
    const multiplied = !demo && s.multiplier > 1 && !st.forcedBreaks && !st.burntServed;
    return {
      lengthMin: s.lengthMin, score: st.score, multiplier: s.multiplier, multiplied, finalScore: multiplied ? Math.round(st.score * s.multiplier) : st.score,
      stars, advice, bills: st.bills, served: st.served, redos: st.redos, blindServes: st.blindServes, burntServed: st.burntServed, walkouts: st.walkouts,
      satisfaction: sat, waitedMs: st.waitedMs, waitingPenalty: st.waitingPenalty, breaks: st.breaks, breakMs: st.breakMs, forcedBreaks: st.forcedBreaks,
      avgReturnMs: st.returnMs.length ? st.returnMs.reduce((a, b) => a + b, 0) / st.returnMs.length : null,
      longestServiceMs: st.longestServiceMs, billsPerHour: Math.round((st.bills / hours) * 10) / 10, costUsd: st.costUsd,
    };
  }

  /* ---------- the line and seating ---------- */
  addCustomer({ title, body = '', difficulty = 'M' }) {
    if (!this.allowCustom) throw new Error('Practice kitchens only serve the regulars. Hire real chefs to take your own orders.');
    if (!clean(title, 120)) throw new Error('A ticket needs a title');
    const acceptance = String(body).split('\n').map(l => l.replace(/^\s*[-*]\s*/, '').trim()).filter(Boolean).slice(0, 6);
    const c = this.enqueue({ title, body, difficulty, acceptance, labels: ['custom'] });
    this.changed();
    return c;
  }

  async seat(customerId, tableId) {
    const c = this.customer(customerId);
    if (c.state !== 'in_line') throw new Error(`${c.persona.name} is not in the line`);
    if (this.shift.phase === 'closed') throw new Error('Last orders have been called');
    const table = tableId ? this.tables.find(x => x.id === Number(tableId) && !x.reserved && !x.customerId) : this.tables.find(x => !x.reserved && !x.customerId);
    if (!table) throw Object.assign(new Error('No free table. Give someone their bill first.'), { status: 409 });
    table.customerId = c.id;
    c.state = 'seated'; c.tableId = table.id; c.seatedAt = now(); c.episodeMs = 0; c.charged = 0;
    c.branch = `table/${c.id}-${slug(c.title)}`;
    c.worktree = path.join(this.dataDir, 'tables', String(c.id));
    try {
      await G.removeWorktree(this.repo, c.worktree, c.branch);
      await G.addWorktree(this.repo, c.worktree, c.branch, this.mainBranch);
    } catch (e) {
      table.customerId = null; c.state = 'in_line'; c.tableId = null;
      throw e;
    }
    this.changed();
    return c;
  }

  /* ---------- the order pad ---------- */
  newItem(c, { station, prompt, presetId = null }) {
    const preset = presetId ? c.presets.find(p => p.id === presetId) : null;
    const it = {
      id: this.nextItemId++, customerId: c.id, n: ++c.itemCount, station: STATION_IDS.includes(station) ? station : 'backend',
      prompt: String(prompt || '').trim().slice(0, 600), presetId: preset ? preset.id : null, estMs: preset?.estMs || 12_000,
      state: 'ready', priority: false, chefId: null, branch: null, worktree: null, sessionId: null, next: null, cookedBy: null, activity: [],
      summary: '', tests: null, stat: null, rounds: 0, redos: 0, feedback: [], seen: false, note: '', costUsd: 0, error: null,
      readyAt: now(), pickedAt: null, platedAt: null, servedAt: null,
    };
    // a preset whose text was rewritten is the waiter's own prompt: a simulated chef cooks it with the generic recipe
    if (preset && it.prompt !== preset.prompt.trim()) it.presetId = null;
    this.items.push(it);
    this.log(it, 'info', 'On the rail');
    return it;
  }

  addItems(customerId, items) {
    const c = this.customer(customerId);
    if (!SEATED.has(c.state)) throw new Error(`${c.persona.name} is not seated`);
    if (!Array.isArray(items) || !items.length) throw new Error('Write at least one item');
    if (items.length > 4) throw new Error('At most four items at a time');
    if (this.items.filter(i => i.customerId === c.id).length + items.length > 12) throw new Error('That order is big enough. Serve what is cooking first.');
    const made = [];
    for (const raw of items) {
      if (!clean(raw.prompt, 600)) throw new Error('Every item needs a prompt');
      made.push(this.newItem(c, raw));
    }
    if (c.state === 'seated' || c.state === 'feedback_ready') { c.state = 'waiting_food'; c.episodeMs = 0; c.charged = 0; }
    this.schedule();
    this.changed();
    return made;
  }

  editItem(itemId, { station, prompt } = {}) {
    const it = this.item(itemId);
    if (it.state !== 'ready' || it.sessionId) throw new Error('Only a fresh ticket still on the rail can be changed');
    if (station && STATION_IDS.includes(station)) it.station = station;
    if (prompt != null) {
      const p = String(prompt).trim().slice(0, 600);
      if (!p) throw new Error('An item needs a prompt');
      if (p !== it.prompt) { it.prompt = p; it.presetId = null; }
    }
    this.changed();
  }

  /* ---------- the kitchen: chefs pick up tickets by themselves ---------- */
  schedule() {
    const t = now();
    for (const chef of this.chefs) {
      if (chef.state !== 'idle') continue;
      const it = this.rail().find(i => !this.station(i.station).chefId && SEATED.has(this.customer(i.customerId).state));
      if (!it) continue;
      const st = this.station(it.station);
      st.chefId = chef.id;
      Object.assign(chef, { state: 'walking', itemId: it.id, stationId: st.id, walkUntil: t + this.t.walkMs });
      Object.assign(it, { state: 'cooking', chefId: chef.id, pickedAt: t, priority: false, error: null });
      this.log(it, 'info', `${chef.name} takes it to the ${st.name} station`);
      this.changed();
    }
    for (const chef of this.chefs) {
      if (chef.state === 'walking' && t >= chef.walkUntil) {
        chef.state = 'cooking';
        const it = this.items.find(i => i.id === chef.itemId);
        if (it) this.startCooking(it, chef);
        this.changed();
      }
    }
  }

  /** Which driver cooks this item, and on whose key. Real chefs fall back to the simulator when the caps run out. */
  driverFor(chef) {
    if (chef.driver.name === 'sim') return { driver: chef.driver, real: false };
    const cred = this.creds() || {};
    const allowed = cred.realChefs !== false && (!this.publicMode || cred.chefKey) && (!this.budget || this.budget.canChef(this.account, cred.ownKey));
    if (!allowed) return { driver: simDriver, real: false, fellBack: true };
    return { driver: chef.driver, real: true, apiKey: cred.chefKey || undefined, ownKey: !!cred.ownKey };
  }

  itemPrompt(it) {
    const c = this.customer(it.customerId), st = STATIONS.find(s => s.id === it.station);
    return [
      "You are cooking one item of a customer's order.",
      `Order ${c.key} for table ${c.tableId}: ${c.title}`,
      `Raised by ${c.persona.name}, ${c.persona.role}.`,
      c.body,
      c.acceptance.length ? `Acceptance criteria:\n${c.acceptance.map(a => `- ${a}`).join('\n')}` : '',
      `Your item (${st.name} station): ${it.prompt}`,
      'Only do this item. Other chefs may be cooking other items of this order on separate branches.',
    ].filter(Boolean).join('\n');
  }

  async startCooking(it, chef) {
    try {
      const c = this.customer(it.customerId);
      if (!it.worktree) {
        it.branch = `kitchen/${c.id}.${it.n}-${slug(it.prompt)}`;
        it.worktree = path.join(this.dataDir, 'worktrees', `${c.id}.${it.n}`);
        await G.removeWorktree(this.repo, it.worktree, it.branch);
        await G.addWorktree(this.repo, it.worktree, it.branch, c.branch);
      }
      const resume = Boolean(it.next && it.sessionId);
      const prompt = it.next ? (it.sessionId ? it.next : `${this.itemPrompt(it)}\n\n${it.next}`) : this.itemPrompt(it);
      it.next = null;
      await this.cookRun(it, chef, prompt, resume);
    } catch (e) {
      this.stall(it, e.message || String(e));
    }
  }

  async cookRun(it, chef, prompt, resume) {
    const c = this.customer(it.customerId), st = STATIONS.find(s => s.id === it.station);
    const pick = this.driverFor(chef);
    if (pick.fellBack) this.log(it, 'info', 'Real chefs are out of budget here, so a practice chef cooks this one');
    if (pick.real) { this.account.chefItems++; if (this.budget) this.budget.realRuns++; }
    it.cookedBy = pick.driver.name;
    this.log(it, 'info', resume ? `${chef.name} picks it back up` : `${chef.name} starts cooking`);
    this.changed();
    const run = { ctl: new AbortController() };
    this.runs.set(it.id, run);
    run.done = pick.driver.run({
      cwd: it.worktree, prompt, model: chef.model, signal: run.ctl.signal, resume: resume ? it.sessionId : undefined,
      order: { id: it.id, title: c.title, presetId: it.presetId, estMs: it.estMs, itemKey: `${c.id}.${it.n}`, ask: it.prompt },
      systemAppend: st.prompt, apiKey: pick.apiKey, publicMode: this.publicMode, maxTurns: this.publicMode ? 25 : 40,
      onEvent: ev => {
        if (ev.kind === 'session') it.sessionId = ev.sessionId;
        else this.log(it, ev.kind, ev.text, ev.file);
        this.changed();
      },
      askHuman: req => this.ask(it, chef, req),
    });
    const res = await run.done.finally(() => { if (pick.real && this.budget) this.budget.realRuns--; });
    this.runs.delete(it.id);
    if (pick.real && this.budget) this.budget.chargeChef(this.account, res.costUsd || 0, pick.ownKey);
    it.costUsd += res.costUsd || 0; this.stats.costUsd += res.costUsd || 0;
    if (it.state !== 'cooking') return; // binned meanwhile
    if (res.isError) return this.stall(it, res.error || 'The chef stopped');
    it.summary = res.summary;
    await this.plate(it, chef);
  }

  async plate(it, chef) {
    const c = this.customer(it.customerId);
    this.log(it, 'info', 'Commits the work and runs the tests');
    this.changed();
    try {
      await G.commitAll(it.worktree, `${c.key}.${it.n} ${it.prompt.slice(0, 60)}${it.rounds ? ` (round ${it.rounds + 1})` : ''}`);
      it.tests = await G.runTests(it.worktree, this.testCmd);
      it.stat = (await G.diffAgainst(this.repo, c.branch, it.branch)).stat;
    } catch (e) { return this.stall(it, e.message); }
    if (it.state !== 'cooking') return;
    Object.assign(it, { state: 'plated', platedAt: now(), seen: false, chefId: null });
    this.freeChef(chef);
    this.log(it, it.tests.ok ? 'good' : 'error', it.tests.ok ? 'Tests pass. On the counter' : 'Tests fail. On the counter, burnt');
    this.schedule();
    this.changed();
  }

  freeChef(chef) {
    if (!chef) return;
    const st = this.station(chef.stationId);
    if (st && st.chefId === chef.id) st.chefId = null;
    Object.assign(chef, { state: 'idle', itemId: null, stationId: null });
  }

  stall(it, msg) {
    const chef = this.chefs.find(c => c.itemId === it.id);
    this.freeChef(chef);
    this.dropQuestions(it, 'The item stopped.');
    if (['served', 'binned'].includes(it.state)) return;
    Object.assign(it, { state: 'stalled', error: msg, chefId: null });
    this.log(it, 'error', msg);
    this.changed();
  }

  resume(itemId) {
    const it = this.item(itemId);
    if (it.state !== 'stalled') throw new Error('Only a stalled item can be resumed');
    Object.assign(it, { state: 'ready', priority: true, readyAt: now(), error: null, next: it.sessionId ? 'Continue the item where you left off. Finish it, run the tests, and summarize.' : null });
    this.schedule();
    this.changed();
  }

  /* ---------- chef questions (real chefs, local kitchens only) ---------- */
  ask(it, chef, req) {
    const q = { id: `q${now().toString(36)}${Math.random().toString(36).slice(2, 5)}`, itemId: it.id, chefId: chef.id, kind: req.kind, toolName: req.toolName, reason: req.reason || '', input: req.kind === 'permission' ? req.input : undefined, questions: req.questions || [], createdAt: now() };
    this.questions.push(q);
    this.log(it, 'ask', req.kind === 'question' ? `asks: ${q.questions.map(x => x.question).join(' / ')}` : `needs your OK: ${q.reason}`);
    this.changed();
    return new Promise(resolve => this.waiters.set(q.id, resolve));
  }
  settle(q, reply) {
    const i = this.questions.indexOf(q);
    if (i < 0) return;
    this.questions.splice(i, 1);
    this.waiters.get(q.id)?.(reply);
    this.waiters.delete(q.id);
    this.changed();
  }
  answer(qid, { allow = true, message = '', answers = {} } = {}) {
    const q = this.questions.find(x => x.id === qid);
    if (!q) throw new Error('That question is already answered');
    this.settle(q, { allow, message, answers });
  }
  dropQuestions(it, message) { for (const q of this.questions.filter(x => x.itemId === it.id)) this.settle(q, { allow: false, message }); }

  /* ---------- the counter: sample, redo, serve ---------- */
  async diff(itemId) {
    const it = this.item(itemId);
    const c = this.customer(it.customerId);
    if (!it.branch || !c.branch) return { patch: '', stat: null };
    try { return await G.diffAgainst(this.repo, c.branch, it.branch); } catch { return { patch: '', stat: null }; }
  }

  async wip(itemId) {
    const it = this.item(itemId);
    const c = this.customer(it.customerId);
    if (!it.worktree || it.state !== 'cooking') return { patch: '', stat: null };
    try { return await G.wipDiff(it.worktree, c.branch); } catch { return { patch: '', stat: null }; }
  }

  redo(itemId, { comment } = {}) {
    const it = this.item(itemId);
    if (it.state !== 'plated') throw new Error('That dish is not on the counter');
    comment = clean(comment, 500);
    if (!comment) throw new Error('Say what the chef should fix');
    it.rounds++; it.redos++; this.stats.redos++;
    it.feedback.push({ t: now(), comment });
    const testNote = it.tests && !it.tests.ok ? `\n\nThe tests were failing when it reached the counter:\n${it.tests.output.slice(-1500)}` : '';
    it.next = `The waiter sent your dish back from the counter. Feedback:\n${comment}${testNote}\n\nFix it, rerun the tests, and summarize again.`;
    Object.assign(it, { state: 'ready', priority: true, readyAt: now(), tests: null, stat: null, seen: false });
    this.log(it, 'info', `Sent back: ${comment}`);
    this.schedule();
    this.changed();
  }

  async serve(itemId, { seen = false, note = '' } = {}) {
    const it = this.item(itemId);
    if (it.state !== 'plated') throw new Error('That dish is not on the counter');
    const c = this.customer(it.customerId);
    if (!SEATED.has(c.state)) throw new Error(`${c.persona.name} is not at a table`);
    it.state = 'serving';
    const res = await G.mergeInto(c.worktree, it.branch, `Serve ${c.key}.${it.n}: ${it.prompt.slice(0, 60)}`).catch(e => ({ ok: false, detail: e.message }));
    if (!res.ok) {
      it.rounds++;
      it.next = `Your dish no longer merges into the table's branch. Run \`git merge ${c.branch}\` in your directory, resolve every conflict, rerun the tests, and summarize again.`;
      Object.assign(it, { state: 'ready', priority: true, readyAt: now() });
      this.log(it, 'error', 'It clashed with what is already on the table. Back to a chef to merge');
      this.schedule();
      this.changed();
      return { served: false, conflict: true };
    }
    Object.assign(it, { state: 'served', servedAt: now(), seen: seen === true, note: clean(note, 300) });
    this.log(it, 'good', it.note ? `Served with a note: ${it.note}` : 'Served');
    const burnt = Boolean(it.tests && !it.tests.ok);
    const at = { kind: 'customer', id: c.id };
    if (!it.seen) { this.stats.blindServes++; this.stats.streak = 1; this.score(-10, 'Blind serve', at); }
    if (burnt) { this.stats.burntServed++; this.stats.streak = 1; this.score(-50, 'Burnt dish served', at); }
    if (it.seen && !burnt && it.redos === 0) { this.score(25, 'Clean plate', at); this.stats.streak = Math.min(STREAK_MAX, this.stats.streak + STREAK_STEP); }
    this.stats.served++;
    await G.removeWorktree(this.repo, it.worktree, it.branch).catch(() => {});
    it.worktree = null;
    if (c.state === 'eating') c.reviewQueued = true;
    else this.startReview(c);
    this.changed();
    return { served: true, conflict: false };
  }

  /* ---------- the customer eats: a review of everything served so far ---------- */
  startReview(c) {
    Object.assign(c, { state: 'eating', episodeMs: 0, charged: 0 });
    this.changed();
    (async () => {
      do {
        c.reviewQueued = false;
        const started = now();
        const tests = await G.runTests(c.worktree, this.testCmd);
        const { patch } = await G.diffAgainst(this.repo, this.mainBranch, c.branch);
        const served = this.items.filter(i => i.customerId === c.id && i.state === 'served');
        const review = await this.reviewWith(c, served, tests, patch);
        const left = this.t.eatMs - (now() - started);
        if (left > 0) await sleep(left);
        if (this.closed || c.state !== 'eating') return;
        c.reviews.push({ t: now(), verdict: review.verdict, satisfaction: review.satisfaction, feedback: review.feedback, missing: review.missing, source: review.source, testsOk: tests.ok });
        Object.assign(c, { satisfaction: review.satisfaction, lastVerdict: review.verdict, suggestions: review.missing });
      } while (c.reviewQueued && !this.closed);
      if (this.closed || c.state !== 'eating') return;
      Object.assign(c, { state: 'feedback_ready', feedbackAt: now(), episodeMs: 0, charged: 0 });
      this.changed();
    })().catch(e => {
      console.error('A review failed:', e.message);
      if (c.state !== 'eating') return;
      c.reviews.push({ t: now(), verdict: 'needs_more', satisfaction: 3, feedback: 'Sorry, I lost my train of thought. Could you bring that again?', missing: [], source: 'script', testsOk: null });
      Object.assign(c, { state: 'feedback_ready', feedbackAt: now(), episodeMs: 0, charged: 0 });
      this.changed();
    });
  }

  async reviewWith(c, served, tests, patch) {
    const cred = this.creds() || {};
    if (cred.reviewKey && (!this.budget || this.budget.canReview(this.account, cred.ownKey))) {
      try {
        const r = await claudeReview({ apiKey: cred.reviewKey, model: this.customerModel, customer: c, served, tests, patch });
        this.budget?.chargeReview(this.account, r.costUsd, cred.ownKey);
        this.stats.costUsd += r.costUsd;
        return r;
      } catch (e) {
        if (e.costUsd) { this.budget?.chargeReview(this.account, e.costUsd, cred.ownKey); this.stats.costUsd += e.costUsd; }
        console.warn(`A customer review fell back to the script: ${e.status || ''} ${String(e.message || e).replace(/sk-ant-[\w-]+/g, '[key]').slice(0, 200)}`);
      }
    }
    return simCustomer.review({ customer: c, served, tests });
  }

  ack(customerId) {
    const c = this.customer(customerId);
    if (c.state !== 'feedback_ready') return;
    c.state = this.items.some(i => i.customerId === c.id && IN_KITCHEN.has(i.state)) ? 'waiting_food' : 'seated';
    this.changed();
  }

  /* ---------- the bill ---------- */
  async bill(customerId, { abandon = false } = {}) {
    const c = this.customer(customerId);
    if (c.state === 'eating') throw new Error(`${c.persona.name} is still eating. Wait for the feedback.`);
    if (!['seated', 'waiting_food', 'feedback_ready'].includes(c.state)) throw new Error(`${c.persona.name} is not at a table`);
    const served = this.items.filter(i => i.customerId === c.id && i.state === 'served');
    if (!served.length) throw new Error('Serve at least one dish before the bill');
    const open = this.items.filter(i => i.customerId === c.id && IN_KITCHEN.has(i.state));
    if (open.length && !abandon) throw Object.assign(new Error(`${open.length} of ${c.persona.name}'s items are still in the kitchen or on the counter`), { status: 409, open: open.length });
    for (const it of open) await this.bin(it.id, { quiet: true });
    c.state = 'paying';
    this.changed();
    const res = await G.mergeIntoMain(this.repo, this.mainBranch, c.branch, `Bill ${c.key}: ${c.title}`).catch(e => ({ ok: false, detail: e.message }));
    if (!res.ok) {
      c.state = 'waiting_food';
      const it = this.newItem(c, { station: 'backend', prompt: `Merge ${this.mainBranch} into this table's work and resolve any conflicts.` });
      it.next = `${this.mainBranch} has moved on since this table was seated. Run \`git merge ${this.mainBranch}\` in your directory, resolve every conflict, rerun the tests, and summarize.`;
      it.priority = true;
      this.schedule();
      this.changed();
      return { paid: false, conflict: true };
    }
    this.commits++;
    const commit = (await G.head(this.repo, this.mainBranch)).slice(0, 7);
    const base = Math.round(100 * DIFF_POINTS[c.difficulty] * STRICT_MULT[c.persona.strictness || 2]);
    const streak = this.stats.streak;
    const points = Math.round(base * streak);
    const sat = c.satisfaction ?? 3;
    const tip = c.furious ? 0 : Math.round(base * 0.5 * (sat / 5) * c.patience * (c.lastVerdict === 'needs_more' ? 0.5 : 1));
    const at = { kind: 'customer', id: c.id };
    this.score(points, `Bill ${c.key}${streak > 1 ? ` ×${streak}` : ''}`, at);
    if (tip) this.score(tip, 'Tip', at);
    this.stats.bills++;
    this.stats.satisfaction.push(sat);
    c.bill = {
      base, streak, points, tip, total: points + tip, commit, waitedMs: c.waitMs, satisfaction: sat, verdict: c.lastVerdict,
      items: served.map(i => ({ station: i.station, prompt: i.prompt, rounds: i.rounds, testsOk: i.tests ? i.tests.ok : null, seen: i.seen })),
    };
    const table = this.tables.find(x => x.id === c.tableId);
    if (table) table.customerId = null;
    await G.removeWorktree(this.repo, c.worktree, c.branch).catch(() => {});
    Object.assign(c, { state: 'paid', paidAt: now(), worktree: null });
    this.schedule();
    this.changed();
    return { paid: true, bill: c.bill };
  }

  async bin(itemId, { quiet = false } = {}) {
    const it = this.item(itemId);
    if (['served', 'binned'].includes(it.state)) throw new Error('Already done');
    const chef = this.chefs.find(c => c.itemId === it.id);
    it.state = 'binned';
    this.runs.get(it.id)?.ctl.abort();
    this.dropQuestions(it, 'The item was binned.');
    this.freeChef(chef);
    if (it.worktree) await G.removeWorktree(this.repo, it.worktree, it.branch).catch(() => {});
    it.worktree = null;
    this.log(it, 'info', 'Binned');
    if (!quiet) { this.schedule(); this.changed(); }
  }

  /* ---------- every 250 ms ---------- */
  tick() {
    const t = now(), dt = Math.min(1000, t - this.lastTick);
    this.lastTick = t;
    this.schedule();
    const drain = this.drainable(t), front = new Set(this.seatable().map(c => c.id)), s = this.shift;
    let dirty = false;
    for (const c of this.customers) {
      const line = c.state === 'in_line';
      let waiting = false;
      if (line) waiting = front.has(c.id);
      else if (c.state === 'seated' || c.state === 'feedback_ready') waiting = true;
      else if (c.state === 'waiting_food') waiting = this.items.some(i => i.customerId === c.id && i.state === 'plated');
      const pm = line ? this.t.patienceMs.line : this.t.patienceMs.seated;
      const was = c.draining;
      c.draining = waiting && drain;
      if (c.draining) {
        c.patience = Math.max(0, c.patience - dt / pm);
        if (!line) {
          c.waitMs += dt; c.episodeMs += dt; this.stats.waitedMs += dt;
          const owed = Math.min(PENALTY_CAP, Math.max(0, Math.floor((c.episodeMs - this.t.graceMs) / this.t.penaltyEveryMs)));
          if (owed > c.charged) { const n = owed - c.charged; c.charged = owed; this.stats.waitingPenalty += n; this.score(-n, 'Kept waiting', { kind: 'customer', id: c.id }); }
        }
        if (c.patience === 0) {
          if (line) { c.state = 'walked_out'; c.walkedAt = t; c.draining = false; this.stats.walkouts++; this.score(-25, 'Walked out', { kind: 'customer', id: c.id }); }
          else if (!c.furious) c.furious = true;
        }
        dirty = true;
      } else {
        if (!waiting) { c.episodeMs = 0; c.charged = 0; }
        if (!line && (c.state === 'waiting_food' || c.state === 'eating') && c.patience < 1) { c.patience = Math.min(1, c.patience + dt / (pm * 2)); dirty = true; }
      }
      if (c.state === 'walked_out' && t - c.walkedAt >= this.t.rejoinMs) { Object.assign(c, { state: 'in_line', patience: 1, lineOrder: ++this.lineSeq, walkedAt: null }); dirty = true; }
      if (was !== c.draining) dirty = true;
    }
    if (s.phase === 'service') {
      if (t - s.serviceSince >= s.maxWorkMs) {
        this.stats.forcedBreaks++;
        this.score(-30, 'Overworked: forced break', { kind: 'break' });
        this.startBreak({ forced: true });
      }
    } else if (s.phase === 'break') {
      if (t >= s.cooldownEndsAt && this.waitingThings().some(w => w.kind !== 'line')) {
        Object.assign(s, { phase: 'bell', bellAt: t, graceEndsAt: t + this.t.graceMs });
        dirty = true;
      }
    }
    if (['service', 'break', 'bell'].includes(s.phase) && s.endsAt && t >= s.endsAt) { this.closeShift(); dirty = false; }
    if (dirty) this.changed();
  }
}
