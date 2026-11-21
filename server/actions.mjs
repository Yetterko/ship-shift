// One handler per player action (REBUILD.md 5.2): the owner guard, the state-machine guards and the input clamps.
// Every handler returns nothing on success or throws refuse(code).
import { STATIONS, LIMITS, ACTIONS, CODES } from '../shared/protocol.js';
import { estimateFor } from './scripted.mjs';
import { nextId } from './floors.mjs';
import { award, orderPoints } from './scoring.mjs';
import { applyTimings, startReview, startBreak, endBreak, endShift, updateDerived, tableOf, dispatch } from './loop.mjs';

export class Refusal extends Error { constructor(code) { super(CODES[code] || code); this.code = code; } }
const refuse = code => { throw new Refusal(code); };

const text = (v, max) => String(v ?? '').replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, ' ').trim().slice(0, max);
const seatedCustomer = (floor, customerId) => floor.tables.find(c => c && c.id === customerId) || refuse('bad_state');
const ORDERING = new Set(['seated', 'waiting_food', 'awaiting_player']);
const onPass = (floor, mealId) => {
  const meal = floor.pass.includes(mealId) ? floor.meals[mealId] : null;
  const item = meal && floor.items[meal.itemId];
  if (!meal || !item) refuse('bad_state');
  return { meal, item };
};
const dropPatience = c => { delete c.patience; };

/** Marks the Feedback as read: the Customer's patience stops (it runs until readFeedback). */
function markRead(c) { if (c.feedback) { c.feedbackRead = true; dropPatience(c); } }

const HANDLERS = {
  seat(ctx, floor, { customerId, table }, now) {
    const i = floor.line.findIndex(c => c.id === customerId);
    if (i < 0 || floor.line[i].status !== 'in_line') refuse('bad_state');
    let t = Number.isInteger(table) ? table : floor.tables.findIndex(x => !x);
    if (t < 0 || t >= LIMITS.tables || floor.tables[t]) refuse('no_table');
    const [c] = floor.line.splice(i, 1);
    Object.assign(c, { status: 'seated', table: t, seatedAt: now });
    floor.tables[t] = c;
    floor.guide.seat = true;
  },

  saveItems(ctx, floor, { customerId, items }) {
    const c = seatedCustomer(floor, customerId);
    if (!ORDERING.has(c.status)) refuse('bad_state');
    if (!Array.isArray(items)) refuse('empty');
    if (items.length > LIMITS.items) refuse('too_many');
    const order = c.order;
    const clean = items.map(raw => {
      const prompt = text(raw?.prompt, LIMITS.prompt);
      if (!prompt) refuse('empty');
      if (!STATIONS.includes(raw?.station)) refuse('bad_station');
      const pick = order.quickPicks.find(q => q.id === raw?.quickPickId);
      return { id: typeof raw?.id === 'string' ? raw.id : null, prompt, station: raw.station, quickPickId: pick?.id, typed: Boolean(raw?.typed) || !pick };
    });
    const oldDrafts = order.itemIds.filter(id => floor.items[id]?.status === 'draft');
    const keep = new Set();
    for (const d of clean) {
      let it = d.id && oldDrafts.includes(d.id) ? floor.items[d.id] : null;
      if (!it) {
        it = { id: nextId(floor, 'i'), orderId: order.id, customerId: c.id, status: 'draft', redoCount: 0 };
        floor.items[it.id] = it; order.itemIds.push(it.id);
      }
      Object.assign(it, { prompt: d.prompt, station: d.station, typed: d.typed });
      if (d.quickPickId) it.quickPickId = d.quickPickId; else delete it.quickPickId;
      it.estCookMs = estimateFor(order, it);
      keep.add(it.id);
    }
    for (const id of oldDrafts) if (!keep.has(id)) delete floor.items[id];
    order.itemIds = order.itemIds.filter(id => floor.items[id]);
  },

  sendItems(ctx, floor, { customerId }) {
    const c = seatedCustomer(floor, customerId);
    if (!ORDERING.has(c.status)) refuse('bad_state');
    const drafts = c.order.itemIds.map(id => floor.items[id]).filter(it => it?.status === 'draft');
    if (!drafts.length) refuse('no_items');
    for (const it of drafts) { it.status = 'queued'; floor.readyQueue.push(it.id); }
    if (c.status === 'awaiting_player') markRead(c);
    c.status = 'waiting_food';
    floor.guide.split = true;
    floor.priv.firstSent = true;
  },

  sampleMeal(ctx, floor, { mealId }) {
    const { meal, item } = onPass(floor, mealId);
    if (item.status === 'ready') { item.status = 'sampled'; delete meal.patience; }
    seen(floor, meal, 0);
  },

  seeHunk(ctx, floor, { mealId, index }) {
    const { meal, item } = onPass(floor, mealId);
    if (!Number.isInteger(index) || index < 0 || index >= meal.hunks.length) refuse('bad_state');
    if (item.status === 'ready') { item.status = 'sampled'; delete meal.patience; }
    seen(floor, meal, index);
  },

  redoMeal(ctx, floor, { mealId, reason }) {
    const why = text(reason, LIMITS.reason);
    const { meal, item } = onPass(floor, mealId);
    if (!['ready', 'sampled', 'approved'].includes(item.status)) refuse('bad_state');
    if (!why) refuse('empty');
    const p = floor.priv;
    p.prev[item.id] = p.mealData[mealId];
    floor.pass = floor.pass.filter(id => id !== mealId);
    delete floor.meals[mealId]; delete p.hunksSeen[mealId];
    Object.assign(item, { status: 'queued', redoReason: why, redoCount: item.redoCount + 1 });
    delete item.mealId; delete item.cookStartedAt; delete item.cookEndsAt;
    p.fails[item.id] = 0;
    floor.readyQueue.unshift(item.id);
    floor.stats.redos++;
    void meal;
  },

  approveMeal(ctx, floor, { mealId }) {
    const { meal, item } = onPass(floor, mealId);
    if (item.status === 'approved') return;
    if (meal.hunksSeen < meal.hunks.length) refuse('unread');
    item.status = 'approved';
    floor.guide.review = true;
  },

  serveOrder(ctx, floor, { customerId, mealIds, note }, now) {
    const c = seatedCustomer(floor, customerId);
    if (!ORDERING.has(c.status)) refuse('bad_state');
    const wanted = Array.isArray(mealIds) && mealIds.length ? new Set(mealIds) : null;
    const meals = floor.pass.map(id => floor.meals[id])
      .filter(m => m && m.orderId === c.order.id && floor.items[m.itemId]?.status === 'approved' && (!wanted || wanted.has(m.id)));
    if (!meals.length) refuse('nothing_approved');
    const p = floor.priv;
    const served = p.served[c.id] ||= [];
    for (const m of meals) {
      floor.items[m.itemId].status = 'served';
      served.push({ mealId: m.id, key: p.mealData[m.id]?.key });
    }
    floor.pass = floor.pass.filter(id => !meals.some(m => m.id === id));
    markRead(c);
    c.status = 'eating';
    floor.guide.serve = true;
    const all = served.map(s => floor.meals[s.mealId]).filter(Boolean);
    startReview(ctx, floor, c, all, text(note, LIMITS.note), now);
  },

  readFeedback(ctx, floor, { customerId }) {
    const c = seatedCustomer(floor, customerId);
    if (!c.feedback) refuse('bad_state');
    markRead(c);
  },

  moreWork(ctx, floor, { customerId }) {
    const c = seatedCustomer(floor, customerId);
    if (c.status !== 'awaiting_player' || !c.feedback) refuse('bad_state');
    markRead(c);
    const order = c.order;
    const drafts = order.itemIds.filter(id => floor.items[id]?.status === 'draft').length;
    c.feedback.suggestedFollowUps.slice(0, Math.max(0, LIMITS.items - drafts)).forEach((f, i) => {
      const pick = { id: `${order.id}-f${c.feedbackRound}-${i + 1}`, label: f.prompt.slice(0, 48), prompt: f.prompt, station: f.station, estCookMs: 0, followUp: true };
      const it = { id: nextId(floor, 'i'), orderId: order.id, customerId: c.id, status: 'draft', redoCount: 0, prompt: text(f.prompt, LIMITS.prompt), station: f.station, typed: false, quickPickId: pick.id };
      it.estCookMs = pick.estCookMs = estimateFor(order, { ...it, quickPickId: undefined, typed: true });
      if (!order.quickPicks.some(q => q.id === pick.id)) order.quickPicks.push(pick);
      floor.items[it.id] = it; order.itemIds.push(it.id);
    });
  },

  giveBill(ctx, floor, { customerId }, now) {
    const c = seatedCustomer(floor, customerId);
    if (!c.feedback) refuse('no_feedback');
    if (!ORDERING.has(c.status)) refuse('bad_state');
    const p = floor.priv;
    const servedItems = (p.served[c.id] || []).map(s => floor.meals[s.mealId]).filter(Boolean).map(m => floor.items[m.itemId]).filter(Boolean);
    const pts = orderPoints(c, servedItems);
    const t = tableOf(floor, c.id);
    award(floor, pts.base, 'SHIPPED', `table:${t}`, now);
    if (pts.bonus) award(floor, pts.bonus, 'RIGHT FIRST TIME', `table:${t}`, now);
    floor.stats.shipped++; floor.stats.firstTime += pts.firstTime;
    c.receipt = { items: servedItems.length, redos: servedItems.reduce((n, it) => n + it.redoCount, 0), tookMs: now - (c.seatedAt || now), score: c.feedback.score, points: pts.base + pts.bonus };
    markRead(c);
    c.status = 'paying'; c.priv_leaveAt = now + ctx.config.payMs;
    // Whatever else this Order still had in the kitchen is dropped.
    for (const id of c.order.itemIds) {
      const it = floor.items[id];
      if (it && ['draft', 'queued', 'burnt', 'ready', 'sampled', 'approved'].includes(it.status)) {
        if (it.mealId) { delete floor.meals[it.mealId]; floor.pass = floor.pass.filter(m => m !== it.mealId); }
        delete floor.items[id];
      }
    }
    floor.readyQueue = floor.readyQueue.filter(id => floor.items[id]);
    floor.tv.shots.push(c.order.id);
    floor.guide.ship = true;
    ctx.notify(floor, 'shipped', { customerId: c.id, table: t, text: `SHIPPED! ${c.order.title}` }, { watchers: true });
  },

  startBreak(ctx, floor, args, now) {
    if (floor.phase !== 'working' || !floor.breakEligible) refuse('not_eligible');
    startBreak(ctx, floor, now);
  },

  endBreak(ctx, floor, args, now) {
    if (!endBreak(ctx, floor, now)) refuse('not_eligible');
  },

  updateSettings(ctx, floor, args) {
    const s = { ...floor.settings };
    for (const k of ['gracePeriodMs', 'maxWorkMs']) if (args?.[k] !== undefined) s[k] = Number(args[k]);
    applyTimings(ctx, floor, s);
  },

  setMode(ctx, floor, { mode }, now, conn) {
    if (mode !== 'live' && mode !== 'demo') refuse('bad_state');
    if (mode === floor.mode) return;
    if (mode === 'live') {
      const why = ctx.whyNotLive(floor, conn);
      if (why) refuse(why);
      ctx.roles.takeHold(conn);
      floor.mode = 'live'; floor.demoReason = null;
      floor.shift.endsAt = null;
    } else {
      floor.mode = 'demo';
      floor.shift.endsAt = null;
      ctx.roles.offer();
    }
    floor.budget.blocked = false; floor.priv.budgetNotified = false;
    applyTimings(ctx, floor, null);
  },

  closeShift(ctx, floor, args, now) { endShift(ctx, floor, now); },

  playAgain(ctx, floor, args, now, conn) {
    // An ended live shift gave up its slot; without one free again, the new shift runs in Demo and says why.
    let lost = null;
    if (floor.mode === 'live' && floor.shift.status === 'ended') lost = ctx.whyNotLive({ ...floor, mode: 'demo' }, conn);
    if (lost) { floor.mode = 'demo'; floor.demoReason = lost; }
    ctx.floors.reset(floor, now);
    applyTimings(ctx, floor, floor.settings);
    if (lost) ctx.notify(floor, 'liveOff', { text: lost === 'no_slot' ? 'Every live kitchen is busy, so this shift runs in the Demo kitchen.' : CODES[lost] });
  },

  leave(ctx, floor, args, now, conn) { ctx.destroyFloor(floor, 'left'); conn.floorId = null; },
};

function seen(floor, meal, index) {
  const set = floor.priv.hunksSeen[meal.id] ||= new Set();
  if (meal.hunks.length) set.add(Math.min(index, meal.hunks.length - 1));
  meal.hunksSeen = set.size;
}

const ANY_TIME = new Set(['playAgain', 'leave', 'closeShift', 'setMode', 'updateSettings']);

/**
 * Runs one action from one connection. Returns the ack body.
 * @returns {{ok:true}|{ok:false,code:string,message:string}}
 */
export function runAction(ctx, conn, name, args = {}) {
  try {
    if (!ACTIONS.includes(name)) refuse('bad_message');
    const floor = conn.floorId ? ctx.floors.get(conn.floorId) : null;
    if (!floor) refuse(conn.subscribed ? 'view_only' : 'no_floor');
    if (conn.subscribed && conn.subscribed !== floor.id && name !== 'leave') refuse('view_only');
    const now = ctx.now();
    if (floor.shift.status !== 'running' && !ANY_TIME.has(name)) refuse('shift_over');
    updateDerived(ctx, floor, now);
    if (floor.mustBreak && !['startBreak', 'leave', 'closeShift', 'setMode'].includes(name)) refuse('must_break');
    if (floor.phase !== 'working' && !['endBreak', 'startBreak', 'leave', 'updateSettings', 'setMode', 'closeShift'].includes(name)) endBreak(ctx, floor, now);
    HANDLERS[name](ctx, floor, args && typeof args === 'object' ? args : {}, now, conn);
    if (!floor.priv.destroyed) {
      if (floor.shift.status === 'running') dispatch(ctx, floor, now);   // an idle Chef takes a new ticket at once
      updateDerived(ctx, floor, now); floor.priv.dirty = true;
    }
    return { ok: true };
  } catch (e) {
    if (e instanceof Refusal) return { ok: false, code: e.code, message: CODES[e.code] || e.message };
    console.error('An action failed:', name, e);
    return { ok: false, code: 'bad_state', message: CODES.bad_state };
  }
}
