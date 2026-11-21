// Ship Shift wire constants, shared by the server and the browser. docs/REBUILD.md section 5 is the source of truth.
export const PROTOCOL = 1;
export const WS_PATH = '/ws';

export const STATIONS = ['frontend', 'backend', 'database', 'integration'];
export const STATION_LABEL = { frontend: 'Frontend', backend: 'Backend', database: 'Database', integration: 'Integration' };
export const STATION_FILES = {
  frontend: ['index.html', 'styles.css', 'ui.js'],
  backend: ['api.js'],
  database: ['data/staff.json', 'data/shifts.json', 'data/schema.md'],
  integration: ['main.js', 'checks.js'],
};
export const ROLES = ['spectator', 'player', 'judge'];
export const MODES = ['live', 'demo'];

export const ACTIONS = [
  'seat', 'saveItems', 'sendItems', 'sampleMeal', 'seeHunk', 'redoMeal', 'approveMeal', 'serveMeal', 'serveOrder',
  'readFeedback', 'moreWork', 'giveBill', 'startBreak', 'endBreak', 'skipBreak', 'updateSettings', 'setMode',
  'closeShift', 'playAgain', 'leave',
];
export const NOTIFY = ['mealReady', 'feedbackReady', 'callBack', 'burnt', 'stoveWait', 'budgetSpent', 'slotFree', 'mustBreak', 'shipped', 'floorClosed', 'liveOff'];

/** Every refusal code an `ack` or `error` can carry, with the line the player reads. */
export const CODES = {
  bad_message: 'That message was not understood.',
  no_slot: 'All live kitchens are busy.',
  no_floor: 'That restaurant has closed.',
  full: 'The town is full right now.',
  rate: 'Slow down a little.',
  view_only: 'View only: this is not your restaurant.',
  must_break: 'Time for a break. Take it to carry on.',
  shift_over: 'The shift is over. Play again to reopen.',
  bad_state: 'That cannot be done right now.',
  no_table: 'Both tables are taken.',
  too_many: 'An Order takes at most 5 Items at a time.',
  bad_station: 'Pick a Station for every Item.',
  empty: 'Write something first.',
  no_items: 'Add an Item before sending to the kitchen.',
  unread: 'Read every hunk before you approve.',
  nothing_approved: 'Approve a Meal at the Pass first.',
  no_feedback: 'Serve the Customer and hear their Feedback first.',
  not_eligible: 'Breaks open when every Chef is busy.',
  no_budget: 'The live budget is spent.',
  no_key: 'Live Chefs are off on this server (it has no API key), so kitchens run in Demo.',
};

export const LIMITS = { items: 5, prompt: 600, reason: 300, note: 300, floorName: 24, tables: 2, chefs: 2 };
export const MODEL_LABEL = { 'claude-haiku-5-5': 'Haiku 5.5', 'claude-sonnet-5-5': 'Sonnet 5.5' };

const MIN = 60_000;
/** Timer tables. `cookDivisor` divides an Item's estimate; the rest are ms. SHIP_PACE divides all of them on the server. */
export const TIMINGS = {
  real: { gracePeriodMs: 5 * MIN, maxWorkMs: 25 * MIN, patienceMs: 5 * MIN, callBackDelayMs: 10_000, cookDivisor: 1, eatMs: 8000 },
  short: { gracePeriodMs: 10_000, maxWorkMs: 90_000, patienceMs: 30_000, callBackDelayMs: 2000, cookDivisor: 4, eatMs: 4000 },
};
/** What updateSettings clamps to, per timing table. */
export const SETTINGS_RANGE = {
  real: { gracePeriodMs: [0, 15 * MIN], maxWorkMs: [10 * MIN, 60 * MIN] },
  short: { gracePeriodMs: [0, 60_000], maxWorkMs: [30_000, 300_000] },
};
export const DEMO_SHIFT_LIMIT_MS = 5 * MIN;
export const MUST_BREAK_WARNING_MS = 20_000;
export const PARK = { w: 40, h: 18 };
export const PLOTS = 24;
