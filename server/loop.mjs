// The kitchen loop: 4 ticks a second per floor. Dispatch, cook release, plating, burnt retries, Customer reviews,
// break eligibility, grace period and call-backs, patience, the max work time, the idle penalty and the end of the shift.
// The server is the only writer of floor state; this file and actions.mjs are the only two that write it.
import { splitHunks, asAddedDiff } from '../shared/hunks.js';
import { scriptedMeal, scriptedFeedback, closestMealId, estimateFor } from './scripted.mjs';
import { estimateCall } from './budget.mjs';
import { award, POINTS, report } from './scoring.mjs';
import { nextId } from './floors.mjs';

/**
 * The context every loop function gets.
 * @typedef {{config:object, now:()=>number, budget:import('./budget.mjs').Budget, queue:import('./callqueue.mjs').CallQueue,
 *   agents:{cook:Function, review:Function}|null, showcase:object|null, notify:(floor:object, kind:string, fields?:object)=>void,
 *   canGoLive:(floor:object)=>boolean}} Ctx
 */

const T = (ctx, floor) => ctx.config.timings[floor.timings];
export const tableOf = (floor, customerId) => floor.tables.findIndex(c => c && c.id === customerId);
export const customerOf = (floor, customerId) => floor.tables.find(c => c && c.id === customerId) || floor.line.find(c => c.id === customerId) || null;

/** Picks the timing table for the floor's mode and kind, and clamps the player's settings into it. */
export function applyTimings(ctx, floor, settings = null) {
  const { config } = ctx;
  const timings = floor.mode === 'demo' || floor.kind === 'showcase' ? 'short' : config.liveTimings;
  const changed = timings !== floor.timings || !floor.settings.maxWorkMs;
  floor.timings = timings;
  const t = config.timings[timings], range = config.ranges[timings];
  const want = settings || (changed ? {} : floor.settings);
  const pick = (k, d) => {
    const v = Number(want[k]);
    return Number.isFinite(v) ? Math.min(range[k][1], Math.max(range[k][0], v)) : d;
  };
  floor.settings = { gracePeriodMs: pick('gracePeriodMs', t.gracePeriodMs), maxWorkMs: pick('maxWorkMs', t.maxWorkMs), maxAgentsForBreak: floor.settings.maxAgentsForBreak || 2 };
  if (floor.mode === 'demo') floor.shift.endsAt ??= ctx.now() + config.demoShiftLimitMs;
  else floor.shift.endsAt = null;
  updateDerived(ctx, floor, ctx.now());
  floor.priv.dirty = true;
}

/** Cook time before a Meal may be released, in ms. */
export function cookMs(ctx, floor, item) {
  return item.estCookMs / T(ctx, floor).cookDivisor / ctx.config.pace;
}

const busyChef = c => c.status === 'cooking' || c.status === 'waiting_stove';

/** Break eligibility, the max-work deadline, and whether the forced break is due. */
export function updateDerived(ctx, floor, now) {
  const before = `${floor.breakEligible}|${floor.mustBreakAt}|${floor.mustBreak}|${floor.budget.canGoLive}`;
  if (floor.phase === 'working') {
    floor.mustBreakAt = floor.workStretchStartedAt + floor.settings.maxWorkMs;
    floor.mustBreak = now >= floor.mustBreakAt + ctx.config.mustBreakWarningMs;
    const busy = floor.chefs.filter(busyChef).length;
    floor.breakEligible = floor.shift.status === 'running' && (busy >= floor.settings.maxAgentsForBreak || now >= floor.mustBreakAt);
  } else {
    floor.mustBreakAt = null; floor.mustBreak = false; floor.breakEligible = false;
  }
  floor.budget.canGoLive = ctx.canGoLive(floor);
  if (before !== `${floor.breakEligible}|${floor.mustBreakAt}|${floor.mustBreak}|${floor.budget.canGoLive}`) floor.priv.dirty = true;
}

/** One tick of one floor. */
export function tick(ctx, floor, now = ctx.now()) {
  if (floor.shift.status !== 'running') return;
  const p = floor.priv;
  dispatch(ctx, floor, now);

  for (const chef of floor.chefs) {
    const item = chef.itemId ? floor.items[chef.itemId] : null;
    if (!item) { if (chef.status !== 'idle') idleChef(floor, chef, now); continue; }
    const job = p.jobs.get(item.id);
    if (chef.status === 'walking' && now >= chef.priv_walkEndsAt) beginCook(ctx, floor, chef, item, now);
    else if ((chef.status === 'cooking' || chef.status === 'waiting_stove') && job) {
      if (job.error) failCook(ctx, floor, chef, item, job, now);
      else if (job.result && chef.status === 'cooking' && now >= item.cookEndsAt) {
        chef.status = 'plating'; chef.thought = 'Plating up'; chef.priv_plateEndsAt = now + ctx.config.plateMs; p.dirty = true;
      }
    } else if (chef.status === 'plating' && now >= chef.priv_plateEndsAt) releaseMeal(ctx, floor, chef, item, job, now);
  }

  // Burnt Items go back to the front of the rail after 2 s.
  for (const item of Object.values(floor.items)) {
    if (item.status === 'burnt' && now >= (p.burntUntil?.[item.id] || 0)) {
      item.status = 'queued'; floor.readyQueue.unshift(item.id); p.dirty = true;
    }
  }

  // Customers finishing their Meal, and Customers who have paid.
  for (const [i, c] of floor.tables.entries()) {
    if (!c) continue;
    const review = p.reviews.get(c.id);
    if (c.status === 'eating' && review?.result && now >= review.eatEndsAt) feedbackReady(ctx, floor, c, review.result, now);
    if (c.status === 'paying' && now >= (c.priv_leaveAt || 0)) {
      c.status = 'left'; floor.tables[i] = null; p.dirty = true;
    }
  }

  pomodoro(ctx, floor, now);
  drainPatience(ctx, floor, now);
  idlePenalty(ctx, floor, now);
  updateDerived(ctx, floor, now);

  const doneLine = !floor.line.length && floor.tables.every(t => !t);
  if (doneLine || (floor.shift.endsAt && now >= floor.shift.endsAt)) endShift(ctx, floor, now);
}

function idleChef(floor, chef, now) {
  Object.assign(chef, { status: 'idle', idleSince: now });
  delete chef.itemId; delete chef.station; delete chef.thought; delete chef.priv_walkEndsAt; delete chef.priv_plateEndsAt;
  floor.priv.dirty = true;
}

/** Whether this floor's next cook calls a model. */
const isLive = (ctx, floor) => floor.mode === 'live' && ctx.budget.enabled && (floor.kind === 'showcase' ? Boolean(ctx.showcase || ctx.agents) : Boolean(ctx.agents));

/** The estimate held for one call. */
function chefEstimate(ctx, floor) {
  if (floor.kind === 'showcase') return 0.5;
  return estimateCall(floor.model, ctx.config.chefMaxTokens);
}

/** Any idle Chef takes the oldest Item on the rail (FR-22). Live floors reserve budget first. */
export function dispatch(ctx, floor, now) {
  const p = floor.priv;
  for (const chef of floor.chefs) {
    if (chef.status !== 'idle' || !floor.readyQueue.length) continue;
    const live = isLive(ctx, floor);
    let ticket = null;
    if (live) {
      ticket = ctx.budget.reserve(floor, chefEstimate(ctx, floor));
      if (!ticket) { budgetBlocked(ctx, floor); return; }
    }
    const itemId = floor.readyQueue.shift();
    const item = floor.items[itemId];
    if (!item) { ctx.budget.settle(ticket, 0); continue; }
    Object.assign(item, { status: 'cooking', chefId: chef.id });
    delete item.cookStartedAt; delete item.cookEndsAt;
    Object.assign(chef, { status: 'walking', itemId, station: item.station, thought: 'Reading the ticket', priv_walkEndsAt: now + ctx.config.walkMs });
    delete chef.idleSince;
    p.jobs.set(itemId, { live, ticket, result: null, error: null });
    p.dirty = true;
  }
}

export function budgetBlocked(ctx, floor) {
  floor.budget.blocked = true; floor.priv.dirty = true;
  if (!floor.priv.budgetNotified) {
    floor.priv.budgetNotified = true;
    ctx.notify(floor, 'budgetSpent', { text: "That's the end of your live budget. Your Chefs can keep cooking in the Demo kitchen with pre-cooked results, or you can look around as a visitor." });
  }
}

function startCooking(ctx, floor, chef, item, now) {
  if (floor.priv.destroyed || floor.items[item.id] !== item || item.chefId !== chef.id) return;
  Object.assign(item, { status: 'cooking', cookStartedAt: now, cookEndsAt: now + cookMs(ctx, floor, item) });
  Object.assign(chef, { status: 'cooking', thought: 'Writing the change' });
  floor.priv.dirty = true;
}

/** The walk is over: start the cook. Live calls go through the stove (the call queue). */
function beginCook(ctx, floor, chef, item, now) {
  const p = floor.priv, job = p.jobs.get(item.id);
  const order = customerOf(floor, item.customerId)?.order;
  if (!job || !order) { idleChef(floor, chef, now); return; }
  delete chef.priv_walkEndsAt;
  const prev = p.prev[item.id] || null;
  if (!job.live) {
    startCooking(ctx, floor, chef, item, now);
    job.result = toResult(scriptedMeal(order, item), { key: closestMealId(order, item) });
    return;
  }
  const signal = p.abort.signal;
  const priority = floor.ownerRole === 'judge' || floor.kind === 'showcase';
  if (ctx.queue.busy) {
    Object.assign(item, { status: 'waiting_stove' });
    Object.assign(chef, { status: 'waiting_stove', thought: 'Waiting for a stove' });
    ctx.notify(floor, 'stoveWait', { text: `${chef.name} is waiting for a stove.` });
    p.dirty = true;
  }
  const call = floor.kind === 'showcase' && ctx.showcase
    ? () => ctx.showcase.cook({ floor, order, item, chef, prompt: item.prompt, systemAppend: '', signal, prev,
      onProgress: thought => { if (chef.itemId === item.id) { chef.thought = String(thought || '').slice(0, 80); p.dirty = true; } } })
    : () => ctx.agents.cook({ floor, order, item, chef, prev, signal });
  ctx.queue.run(call, { priority, signal, onStart: () => startCooking(ctx, floor, chef, item, ctx.now()) })
    .then(r => {
      ctx.budget.settle(job.ticket, r.costUsd || 0);
      job.result = toResult(r, { key: closestMealId(order, item) });
    })
    .catch(e => {
      ctx.budget.settle(job.ticket, e.costUsd || 0);
      job.error = e;
    });
}

/** Normalises a cook result (scripted, Messages API or showcase) into what a Meal needs. */
function toResult(r, { key }) {
  return {
    summary: r.summary, file: r.file || r.changedFiles?.[0] || '', code: r.code ?? r.diff ?? '',
    changedFiles: r.changedFiles || (r.file ? [r.file] : []), diff: r.diff ?? null, hunks: r.hunks ?? null,
    setMenu: Boolean(r.setMenu), ranOut: Boolean(r.ranOut), real: Boolean(r.hunks && r.diff), key: r.mealKey || key,
  };
}

/** NFR-9: first error → burnt for 2 s and back to the front of the rail; second → the scripted Meal, "set menu". */
function failCook(ctx, floor, chef, item, job, now) {
  const p = floor.priv;
  p.fails[item.id] = (p.fails[item.id] || 0) + 1;
  if (job.error?.name !== 'AbortError') console.warn(`Floor ${floor.number}: a cook failed (${job.error?.status || ''} ${String(job.error?.message || job.error).slice(0, 120)})`);
  if (p.fails[item.id] >= 2) {
    const order = customerOf(floor, item.customerId)?.order;
    job.error = null;
    job.result = toResult(scriptedMeal(order, item, { forceSetMenu: true }), { key: closestMealId(order, item) });
    if (chef.status === 'waiting_stove' || !item.cookEndsAt) startCooking(ctx, floor, chef, item, now);
    return;
  }
  p.jobs.delete(item.id);
  item.status = 'burnt'; delete item.chefId; delete item.cookStartedAt; delete item.cookEndsAt;
  (p.burntUntil ||= {})[item.id] = now + ctx.config.burntMs;
  idleChef(floor, chef, now);
  ctx.notify(floor, 'burnt', { text: `${chef.name} burnt that one. It goes back on the rail.` });
}

/** Plating is over: the Meal goes on the Pass, the Chef goes idle (FR-26). */
export function releaseMeal(ctx, floor, chef, item, job, now) {
  const p = floor.priv;
  p.jobs.delete(item.id);
  idleChef(floor, chef, now);
  const customer = customerOf(floor, item.customerId);
  if (!job?.result || !customer || customer.status === 'paying' || customer.status === 'left') { delete floor.items[item.id]; return; }
  const r = job.result;
  const id = nextId(floor, 'm');
  const hunks = r.hunks || splitHunks(r.code, r.file);
  /** @type {import('../shared/types.js').Meal} */
  const meal = {
    id, itemId: item.id, orderId: item.orderId, summary: r.summary, changedFiles: r.changedFiles,
    diff: r.diff ?? asAddedDiff(r.code), hunks, hunksSeen: 0, readyAt: now,
    setMenu: r.setMenu, ranOut: r.ranOut, real: r.real,
  };
  if (floor.phase !== 'break') meal.patience = newPatience(ctx, floor, now);
  floor.meals[id] = meal;
  p.mealData[id] = { summary: r.summary, file: r.file, code: r.code, key: r.key };
  p.hunksSeen[id] = new Set();
  Object.assign(item, { status: 'ready', mealId: id });
  delete item.chefId;
  floor.pass.push(id);
  floor.stats.meals++;
  p.dirty = true;
  if (floor.phase !== 'break') ctx.notify(floor, 'mealReady', { mealId: id, customerId: customer.id, table: tableOf(floor, customer.id), text: `Order up! Table ${tableOf(floor, customer.id) + 1}'s Meal is on the Pass.` });
  if (r.real) floor.tv.version = ctx.showcase?.version?.() ?? floor.tv.version + 1;
}

const newPatience = (ctx, floor, now) => ({ startedAt: now, durationMs: T(ctx, floor).patienceMs, lost: 0, angry: false });

/** Starts the Customer's review (FR-30). Live: one call through the stove; Demo or any failure: the scripted Feedback. */
export function startReview(ctx, floor, customer, meals, note, now) {
  const p = floor.priv;
  const round = customer.feedbackRound + 1;
  const served = p.served[customer.id] ||= [];
  const review = { result: null, eatEndsAt: now + T(ctx, floor).eatMs };
  p.reviews.set(customer.id, review);
  const scripted = () => scriptedFeedback(customer, round, served.map(s => s.key));
  if (!isLive(ctx, floor) || !ctx.agents) { review.result = scripted(); return; }
  const ticket = ctx.budget.reserve(floor, estimateCall(floor.model, ctx.config.reviewMaxTokens, 6000));
  if (!ticket) { budgetBlocked(ctx, floor); review.result = scripted(); return; }
  const signal = p.abort.signal;
  const priority = floor.ownerRole === 'judge' || floor.kind === 'showcase';
  const files = async () => (floor.kind === 'showcase' && ctx.showcase ? ctx.showcase.fileContents([...new Set(meals.flatMap(m => m.changedFiles))]) : null);
  ctx.queue.run(async () => ctx.agents.review({ floor, customer, meals: meals.map(m => ({ item: floor.items[m.itemId], ...p.mealData[m.id] })), note, files: await files(), signal }), { priority, signal })
    .then(r => { ctx.budget.settle(ticket, r.costUsd || 0); review.result = r.feedback; })
    .catch(e => { ctx.budget.settle(ticket, e.costUsd || 0); review.result = scripted(); });
}

function feedbackReady(ctx, floor, c, fb, now) {
  floor.priv.reviews.delete(c.id);
  Object.assign(c, { status: 'awaiting_player', feedback: fb, feedbackRead: false, feedbackRound: c.feedbackRound + 1 });
  if (floor.phase !== 'break') c.patience = newPatience(ctx, floor, now);
  floor.priv.dirty = true;
  const t = tableOf(floor, c.id);
  if (floor.phase !== 'break') ctx.notify(floor, 'feedbackReady', { customerId: c.id, table: t, text: `${c.name.split(' ')[0]} at table ${t + 1} has Feedback for you.` });
}

/** Things waiting on the player: Meals on the Pass not yet sampled, and unread Feedback. */
function waitingThings(floor) {
  const meals = floor.pass.map(id => floor.meals[id]).filter(m => m && floor.items[m.itemId]?.status === 'ready');
  const customers = floor.tables.filter(c => c && c.status === 'awaiting_player' && !c.feedbackRead);
  return { meals, customers, any: meals.length + customers.length > 0 };
}

/** Starts the patience meter on everything waiting that has none yet. */
export function startWaitingPatience(ctx, floor, now) {
  const w = waitingThings(floor);
  for (const x of [...w.meals, ...w.customers]) if (!x.patience) { x.patience = newPatience(ctx, floor, now); floor.priv.dirty = true; }
}

/** Grace period, call-back delay and the call-back itself (FR-37, 38, 41); the max-work warning (FR-40). */
function pomodoro(ctx, floor, now) {
  const p = floor.priv;
  if (floor.phase === 'break') {
    const w = waitingThings(floor);
    if (now >= floor.callBack.graceEndsAt && w.any) {
      p.callBackDueAt ??= now + T(ctx, floor).callBackDelayMs;
      if (now >= p.callBackDueAt) fireCallBack(ctx, floor, now, w);
    }
    return;
  }
  if (floor.phase === 'working' && floor.mustBreakAt !== null && now >= floor.mustBreakAt && !p.mustBreakWarned) {
    p.mustBreakWarned = true;
    ctx.notify(floor, 'mustBreak', { text: 'You have hit your maximum work time. Take a break in 20 seconds.' });
  }
}

export function fireCallBack(ctx, floor, now, w = waitingThings(floor)) {
  const p = floor.priv;
  floor.phase = 'called_back'; floor.phaseStartedAt = now;
  floor.callBack.firedAt = now; p.callBackDueAt = null;
  floor.stats.callBacks++;
  startWaitingPatience(ctx, floor, now);
  const meal = w.meals[0], c = w.customers[0];
  const item = meal && floor.items[meal.itemId];
  const table = item ? tableOf(floor, item.customerId) : c ? tableOf(floor, c.id) : -1;
  const text = meal ? `Table ${table + 1}'s order is up!` : `Table ${table + 1} has Feedback for you.`;
  ctx.notify(floor, 'callBack', { mealId: meal?.id, customerId: item?.customerId || c?.id, table, text });
  p.dirty = true;
}

/** Ends a break (Back to work, or any action): records break time and the call-back response time. */
export function endBreak(ctx, floor, now) {
  if (floor.phase === 'working') return false;
  const p = floor.priv;
  floor.stats.breakMs += now - (p.breakStartedAt ?? now);
  if (floor.phase === 'called_back' && floor.callBack.firedAt) floor.stats.callBackMsTotal += now - floor.callBack.firedAt;
  floor.phase = 'working'; floor.phaseStartedAt = now; floor.workStretchStartedAt = now;
  floor.callBack = { graceEndsAt: null, firedAt: null };
  Object.assign(p, { breakStartedAt: null, callBackDueAt: null, mustBreakWarned: false });
  startWaitingPatience(ctx, floor, now);
  updateDerived(ctx, floor, now);
  p.dirty = true;
  return true;
}

export function startBreak(ctx, floor, now) {
  const p = floor.priv;
  const eligibleByChefs = floor.chefs.filter(busyChef).length >= floor.settings.maxAgentsForBreak;
  floor.stats.longestWorkMs = Math.max(floor.stats.longestWorkMs, now - floor.workStretchStartedAt);
  floor.phase = 'break'; floor.phaseStartedAt = now;
  floor.callBack = { graceEndsAt: now + floor.settings.gracePeriodMs, firedAt: null };
  Object.assign(p, { breakStartedAt: now, callBackDueAt: null });
  if (eligibleByChefs || floor.mustBreakAt !== null) award(floor, POINTS.rested, 'RESTED CHEF BONUS', 'hud', now);
  updateDerived(ctx, floor, now);
  p.dirty = true;
}

/** −1 per 5 % of a meter lost, at most −20 a meter; −50 and an angry face at empty (D6: the Customer stays). */
export function drainPatience(ctx, floor, now) {
  const meters = [];
  for (const id of floor.pass) { const m = floor.meals[id]; if (m?.patience) meters.push([m.patience, `meal:${id}`]); }
  for (const [i, c] of floor.tables.entries()) if (c?.patience) meters.push([c.patience, `table:${i}`]);
  for (const [pt, anchor] of meters) {
    const frac = (now - pt.startedAt) / pt.durationMs;
    const lost = Math.min(POINTS.patienceMax, Math.floor(Math.max(0, frac) * 20));
    if (lost > pt.lost) {
      const d = (lost - pt.lost) * POINTS.patienceStep;
      pt.lost = lost; floor.stats.patienceLost += d;
      award(floor, -d, 'PATIENCE', anchor, now, { pop: lost % 5 === 0 });
    }
    if (frac >= 1 && !pt.angry) {
      pt.angry = true; floor.stats.patienceLost += POINTS.angry;
      award(floor, -POINTS.angry, 'KEPT WAITING', anchor, now);
    }
  }
}

/** −1 per 10 s per Chef idle while the rail is empty and the player is working, once the first Items were sent. */
export function idlePenalty(ctx, floor, now) {
  const p = floor.priv;
  const last = p.idleTickAt ?? now; p.idleTickAt = now;
  if (!p.firstSent || floor.phase !== 'working' || floor.readyQueue.length) return;
  for (const chef of floor.chefs) {
    if (chef.status !== 'idle') { p.idleMs[chef.id] = 0; continue; }
    p.idleMs[chef.id] = (p.idleMs[chef.id] || 0) + (now - last);
    while (p.idleMs[chef.id] >= ctx.config.idleChargeMs) {
      p.idleMs[chef.id] -= ctx.config.idleChargeMs;
      floor.stats.idlePenalty += POINTS.idle;
      award(floor, -POINTS.idle, 'CHEF IDLE', `chef:${chef.id}`, now, { pop: false });
    }
  }
}

export function endShift(ctx, floor, now) {
  if (floor.shift.status === 'ended') return;
  if (floor.phase !== 'working') endBreak(ctx, floor, now);
  floor.stats.longestWorkMs = Math.max(floor.stats.longestWorkMs, now - floor.workStretchStartedAt);
  floor.priv.abort.abort(); floor.priv.abort = new AbortController();
  for (const job of floor.priv.jobs.values()) ctx.budget.settle(job.ticket, 0);
  floor.priv.jobs.clear();
  floor.shift = { status: 'ended', startedAt: floor.shift.startedAt, endsAt: now, report: report(floor, now) };
  floor.breakEligible = false; floor.mustBreak = false; floor.mustBreakAt = null;
  floor.priv.endedAt = now;
  floor.priv.dirty = true;
  ctx.roles?.offer();   // an ended shift frees its live slot
}

/** The cook estimate for a new Item. */
export function itemEstimate(order, item) { return estimateFor(order, item); }
