// Canned snapshots for client harness pages. The same shapes the server sends; see shared/types.js.
// fixtureFloor(stage) -> FloorSnapshot. fixtureFloorMessage(stage) -> the whole `floor` message. fixtureBuilding(n) -> `building`.
import { freshLine, CHIPS, FLOOR_NAMES } from '../content/orders.mjs';
import { splitHunks, asAddedDiff } from './hunks.js';
import { TIMINGS, PARK } from './protocol.js';

export const FIXTURE_STAGES = [
  'start', 'seated', 'drafts', 'queued', 'cooking', 'stove', 'burnt', 'ready', 'sampled', 'approved', 'eating',
  'feedback', 'feedbackBad', 'paying', 'shipped', 'break', 'calledBack', 'mustBreak', 'angry', 'budget', 'ended',
];

const CODE_A = `/**
 * Total hours one staff member works across the week.
 * @param {string} staffId
 * @param {{staffId:string,start:string,end:string}[]} shifts
 * @returns {number}
 */
export function totalHours(staffId, shifts) {
  return getShiftsFor(staffId, shifts)
    .reduce((sum, shift) => sum + hoursOf(shift), 0);
}

function hoursOf(shift) {
  const [sh, sm] = shift.start.split(':').map(Number);
  const [eh, em] = shift.end.split(':').map(Number);
  return (eh * 60 + em - (sh * 60 + sm)) / 60;
}

// Self-check hook: 2 shifts of 4 h each give 8.
export const totalHoursExample = () => totalHours('s1', [
  { staffId: 's1', start: '09:00', end: '13:00' },
  { staffId: 's1', start: '14:00', end: '18:00' },
]) === 8;`;

const CODE_B = `// ui.js: a Total column at the end of each roster row
export function renderRoster(staff, shifts) {
  const head = DAYS.map(d => \`<th>\${d}</th>\`).join('') + '<th class="total">Total</th>';
  const rows = staff.map(person => rosterRow(person, shifts)).join('');
  table.innerHTML = \`<thead><tr><th></th>\${head}</tr></thead><tbody>\${rows}</tbody>\`;
}

function rosterRow(person, shifts) {
  const cells = DAYS.map(day => \`<td>\${cellFor(person.id, day, shifts)}</td>\`).join('');
  const total = totalHours(person.id, shifts);
  return \`<tr><th>\${person.name}</th>\${cells}<td class="total">\${total} h</td></tr>\`;
}`;

function meal(id, itemId, orderId, summary, file, code, now, extra = {}) {
  const hunks = splitHunks(code, file);
  return { id, itemId, orderId, summary, changedFiles: [file], diff: asAddedDiff(code), hunks, hunksSeen: 0, readyAt: now - 4000, setMenu: false, ranOut: false, real: false, ...extra };
}
const patience = (now, lostFraction = 0.2, durationMs = 30_000) => ({ startedAt: now - durationMs * lostFraction, durationMs, lost: Math.floor(lostFraction * 20), angry: lostFraction >= 1 });
const publicPick = ({ scriptedMealId, ...q }) => q;

/**
 * @param {string} [stage] one of FIXTURE_STAGES
 * @param {{mode?:'live'|'demo', kind?:'audience'|'showcase', ownerRole?:'player'|'judge', now?:number}} [opts]
 * @returns {import('./types.js').FloorSnapshot}
 */
export function fixtureFloor(stage = 'start', opts = {}) {
  const now = opts.now ?? Date.now();
  const mode = opts.mode || 'demo', kind = opts.kind || 'audience', ownerRole = opts.ownerRole || 'player';
  const timings = mode === 'demo' || kind === 'showcase' ? 'short' : 'real';
  const T = TIMINGS[timings];
  const judge = ownerRole === 'judge' || kind === 'showcase';
  const modelLabel = judge ? 'Sonnet 5.5' : 'Haiku 5.5';
  const line = freshLine().map(c => ({ ...c, order: { ...c.order, quickPicks: c.order.quickPicks.map(publicPick) } }));
  /** @type {import('./types.js').FloorSnapshot} */
  const f = {
    id: 'fixture-floor-0000001', number: 7, name: FLOOR_NAMES[0], plot: 3, kind, ownerRole, mode, timings,
    model: judge ? 'claude-sonnet-5-5' : 'claude-haiku-5-5', modelLabel, keySource: 'house',
    budget: { spentUsd: mode === 'live' ? 0.04 : 0, capUsd: judge ? 1 : 0.1, blocked: false, canGoLive: true },
    settings: { gracePeriodMs: T.gracePeriodMs, maxWorkMs: T.maxWorkMs, maxAgentsForBreak: 2 },
    phase: 'working', phaseStartedAt: now - 40_000, workStretchStartedAt: now - 40_000,
    breakEligible: false, mustBreakAt: now - 40_000 + T.maxWorkMs, mustBreak: false,
    callBack: { graceEndsAt: null, firedAt: null }, ownerAway: false, ownerConnected: true, demoReason: null,
    shift: { status: 'running', startedAt: now - 40_000, endsAt: mode === 'demo' ? now + 260_000 : null, report: null },
    line, tables: [null, null],
    chefs: [
      { id: 'pixel', name: 'Pixel', modelLabel, status: 'idle', idleSince: now - 40_000 },
      { id: 'stack', name: 'Stack', modelLabel, status: 'idle', idleSince: now - 40_000 },
    ],
    readyQueue: [], pass: [], items: {}, meals: {}, score: 0,
    stats: { shipped: 0, meals: 0, redos: 0, firstTime: 0, callBacks: 0, callBackMsTotal: 0, breakMs: 0, longestWorkMs: 0, patienceLost: 0, idlePenalty: 0 },
    watchers: 2, guide: { seat: false, split: false, review: false, serve: false, ship: false },
    tv: { shots: [], version: 0 }, chips: { redo: [...CHIPS.redo], serve: [...CHIPS.serve] }, pops: [],
  };
  const order = FIXTURE_STAGES.indexOf(stage);
  if (order < 0) throw new Error(`Unknown fixture stage "${stage}". Stages: ${FIXTURE_STAGES.join(', ')}`);
  const at = s => order >= FIXTURE_STAGES.indexOf(s);
  if (!at('seated')) return f;

  // Priya (c1) sits at table 1 with the two quick-pick Items.
  const c1 = f.line.shift();
  Object.assign(c1, { status: 'seated', table: 0, seatedAt: now - 30_000 });
  f.tables[0] = c1; f.guide.seat = true;
  if (!at('drafts')) return f;
  const picks = c1.order.quickPicks;
  const item = (id, q, status) => ({ id, orderId: 'o1', customerId: 'c1', prompt: q.prompt, station: q.station, estCookMs: q.estCookMs, status, typed: false, quickPickId: q.id, redoCount: 0 });
  f.items = { i1: item('i1', picks[0], 'draft'), i2: item('i2', picks[1], 'draft') };
  c1.order.itemIds = ['i1', 'i2'];
  if (!at('queued')) return f;
  c1.status = 'waiting_food'; f.guide.split = true;
  const [i1, i2] = [f.items.i1, f.items.i2];
  const [pixel, stack] = f.chefs;
  const cook = (chef, it, startedAgo) => {
    Object.assign(it, { status: 'cooking', chefId: chef.id, cookStartedAt: now - startedAgo, cookEndsAt: now - startedAgo + it.estCookMs / T.cookDivisor });
    Object.assign(chef, { status: 'cooking', itemId: it.id, station: it.station, thought: 'Writing the change' }); delete chef.idleSince;
  };
  if (stage === 'queued') { i1.status = i2.status = 'queued'; f.readyQueue = ['i1', 'i2']; return f; }
  cook(pixel, i1, 4000); cook(stack, i2, 2000); f.breakEligible = true;
  if (stage === 'cooking') return f;
  if (stage === 'stove') {
    Object.assign(i2, { status: 'waiting_stove', cookStartedAt: undefined, cookEndsAt: undefined });
    Object.assign(stack, { status: 'waiting_stove', thought: 'Waiting for a stove' });
    return f;
  }
  if (stage === 'burnt') {
    Object.assign(i2, { status: 'burnt', chefId: undefined, cookStartedAt: undefined, cookEndsAt: undefined });
    Object.assign(stack, { status: 'idle', itemId: undefined, station: undefined, thought: undefined, idleSince: now - 500 });
    f.breakEligible = false;
    return f;
  }
  if (stage === 'break' || stage === 'calledBack') {
    f.phase = stage === 'break' ? 'break' : 'called_back'; f.phaseStartedAt = now - 6000; f.mustBreakAt = null;
    f.callBack = stage === 'break' ? { graceEndsAt: now + 4000, firedAt: null } : { graceEndsAt: now - 3000, firedAt: now - 1000 };
    if (stage === 'break') return f;
  }

  // The first Meal reaches the Pass; Stack is still cooking.
  const done = (chef, it, mealObj) => {
    Object.assign(it, { status: 'ready', mealId: mealObj.id }); delete it.chefId;
    Object.assign(chef, { status: 'idle', itemId: undefined, station: undefined, thought: undefined, idleSince: now - 4000 });
    f.meals[mealObj.id] = mealObj; f.pass.push(mealObj.id); f.stats.meals++;
  };
  done(pixel, i1, meal('m1', 'i1', 'o1', 'Added totalHours(staffId, shifts) to api.js with a small hoursOf helper. No DOM code; one example for the self-checks.', 'api.js', CODE_A, now, { patience: patience(now, stage === 'angry' ? 1 : 0.25, T.patienceMs) }));
  f.breakEligible = false;
  if (stage === 'angry') { f.score = -70; f.stats.patienceLost = 70; f.pops = [{ id: 1, text: 'KEPT WAITING', points: -50, at: now - 800, anchor: 'meal:m1' }]; return f; }
  if (stage === 'ready' || stage === 'calledBack') return f;
  if (stage === 'mustBreak') { f.workStretchStartedAt = now - T.maxWorkMs - 21_000; f.mustBreakAt = now - 21_000; f.mustBreak = true; f.breakEligible = true; return f; }
  if (stage === 'budget') { f.mode = 'live'; f.timings = 'real'; f.budget = { spentUsd: 0.1, capUsd: 0.1, blocked: true, canGoLive: false }; return f; }

  i1.status = 'sampled'; delete f.meals.m1.patience; f.meals.m1.hunksSeen = 1; f.guide.review = true;
  if (stage === 'sampled') return f;
  done(stack, i2, meal('m2', 'i2', 'o1', 'Added a Total column to the roster: a header cell and one cell per row using totalHours.', 'ui.js', CODE_B, now));
  for (const [it, m] of [[i1, f.meals.m1], [i2, f.meals.m2]]) { it.status = 'approved'; m.hunksSeen = m.hunks.length; delete m.patience; }
  if (stage === 'approved') return f;

  i1.status = i2.status = 'served'; f.pass = []; c1.status = 'eating'; f.guide.serve = true;
  if (stage === 'eating') return f;
  c1.status = 'awaiting_player'; c1.feedbackRound = 1; c1.feedbackRead = false; c1.patience = patience(now, 0.1, T.patienceMs);
  c1.feedback = stage === 'feedbackBad'
    ? { satisfied: false, score: 2, comments: 'The totals add up, but I cannot see them on the roster yet. Where is the Total column?', suggestedFollowUps: [{ prompt: 'Frontend: show the weekly total at the end of each roster row', station: 'frontend' }] }
    : { satisfied: true, score: 5, comments: 'Lovely! Totals for everyone, right there on the roster. Friday just got shorter.', suggestedFollowUps: [] };
  if (stage === 'feedback' || stage === 'feedbackBad') return f;

  const receipt = { items: 2, redos: 0, tookMs: 95_000, score: 5, points: 140 };
  Object.assign(c1, { status: 'paying', feedbackRead: true, receipt }); delete c1.patience;
  f.score = 140; f.guide.ship = true; f.tv.shots = ['o1'];
  Object.assign(f.stats, { shipped: 1, firstTime: 2 });
  f.pops = [{ id: 1, text: 'SHIPPED', points: 100, at: now - 900, anchor: 'table:0' }, { id: 2, text: 'RIGHT FIRST TIME', points: 40, at: now - 900, anchor: 'table:0' }];
  if (stage === 'paying') return f;
  f.tables[0] = null;
  if (stage === 'shipped') return f;

  // ended
  f.shift.status = 'ended'; f.shift.endsAt = now - 1000;
  f.shift.report = { shipped: 1, points: 140, reworkRate: 0, avgCallBackMs: 4200, breakMs: 18_000, longestWorkMs: 74_000, verdict: 'Head Expediter: right first time, every time.' };
  return f;
}

/** The whole `floor` message, as the socket delivers it. */
export function fixtureFloorMessage(stage = 'start', opts = {}) {
  const now = opts.now ?? Date.now();
  const canAct = opts.canAct ?? true;
  return { type: 'floor', floor: fixtureFloor(stage, { ...opts, now }), you: { isOwner: canAct, canAct }, now };
}

/** A `building` message with n floors. */
export function fixtureBuilding(n = 6, now = Date.now()) {
  const floors = Array.from({ length: n }, (_, i) => ({
    id: `fixture-floor-${String(i + 1).padStart(7, '0')}`, number: i + 1, name: FLOOR_NAMES[i % FLOOR_NAMES.length], plot: i < 24 ? i : null,
    kind: 'audience', ownerRole: i % 5 === 4 ? 'judge' : 'player', mode: i % 3 === 2 ? 'demo' : 'live',
    model: i % 5 === 4 ? 'claude-sonnet-5-5' : 'claude-haiku-5-5', modelLabel: i % 5 === 4 ? 'Sonnet 5.5' : 'Haiku 5.5',
    score: (i * 85) % 420, shipped: i % 4, watchers: i % 3, phase: i % 4 === 1 ? 'break' : 'working',
    lights: { cooking: i % 3, onPass: (i + 1) % 2, waiting: i % 2 },
  }));
  return {
    type: 'building', now, floors,
    slots: { liveUsed: floors.filter(f => f.mode === 'live').length, liveMax: 60, judgeUsed: floors.filter(f => f.ownerRole === 'judge').length, judgeMax: 6, queued: 0 },
    liveOpen: true, park: { ...PARK },
  };
}
