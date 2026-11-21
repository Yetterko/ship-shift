import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { git } from './git.mjs';

/**
 * Recipes for the simulated chefs, keyed by the starter-order titles in server/demo-repo.mjs.
 *
 * A recipe makes the change a careful agent would make to examples/roster-cafe, one tool event at a time.
 * Each change is a function from a file's current text to its new text, and changes nothing once it is in. So a
 * resumed, steered or re-fired run picks up from the files and not from memory, and a merge conflict is resolved by
 * making the same change to main's version. Any other title, or a repo that is not roster-cafe, gets the generic recipe.
 *
 * Whole new files (tests, src/holidays.js, the rewritten timesheet) are kept as real files in examples/roster-cafe-orders.
 *
 * run(ctx) returns the summary for the reviewer. ctx is built by simDriver in agents.mjs:
 *   kind        'first' | 'steer' | 'conflict' | 'feedback'
 *   note        what the head chef said (send-back comment or call-out), or ''
 *   mainBranch  the branch a conflict run merges in
 *   step(tool, text, { file, ms })   one tool event, then the time it takes
 *   edit(file, text, why, ms, tool)  one edit event that really writes the file
 *   read(file)  -> text with LF line endings, or null
 *   say(text), wantsAsk(), ask(question) -> label or null, permit(command) -> boolean
 */

const PAY = 'src/pay.js', ROSTER = 'src/roster.js', TIMESHEET = 'src/timesheet.js', HOLIDAYS = 'src/holidays.js', PAGE = 'public/index.html';
const ID = ['-c', 'user.name=Ship Shift chef', '-c', 'user.email=chef@ship-shift.local'];
const DISHES = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'examples', 'roster-cafe-orders');
const dish = rel => fs.readFileSync(path.join(DISHES, rel), 'utf8').replace(/\r\n/g, '\n');

/* ---------- shared moves ---------- */

/**
 * Really runs `git merge <main>` in the worktree and resolves what conflicts.
 * resolvers maps a file to a function from main's version to the resolved text; any other file keeps both sides.
 */
export async function mergeMain(ctx, resolvers = {}) {
  const main = ctx.mainBranch;
  // The branch comes from the kitchen (order.mainBranch in agents.mjs). Refuse anything that is not a plain branch name.
  if (!/^[\w][\w./-]*$/.test(main || '')) throw new Error('No main branch to merge');
  await ctx.step('Bash', `runs git merge ${main}`, { ms: 1500 });
  await git(ctx.cwd, [...ID, 'merge', '--no-edit', main], { allowFail: true });
  const conflicted = ((await git(ctx.cwd, ['diff', '--name-only', '--diff-filter=U'], { allowFail: true })) || '').split('\n').filter(Boolean);
  for (const f of conflicted) {
    let resolved = null;
    if (resolvers[f]) {
      const theirs = await git(ctx.cwd, ['show', `${main}:${f}`], { allowFail: true });
      if (theirs != null) resolved = resolvers[f](theirs.replace(/\r\n/g, '\n') + '\n');
    }
    if (resolved == null) {
      const mine = await ctx.read(f);
      if (mine != null) resolved = mine.split('\n').filter(l => !/^(<{7}|={7}|>{7})( |$)/.test(l)).join('\n');
    }
    if (resolved != null) await ctx.edit(f, resolved, `resolves the conflict in ${f}`, 2200);
    await git(ctx.cwd, ['add', '-A', '--', f], { allowFail: true });
  }
  ctx.say(conflicted.length ? `Merged ${main}. Resolved by hand: ${conflicted.join(', ')}.` : `Merged ${main} with no conflicts.`);
  return conflicted;
}

const heard = ctx => (ctx.kind === 'steer' ? `Heard you: "${ctx.note}".` : ctx.note ? `Read your note: "${ctx.note}".` : '');
const runTests = ctx => ctx.step('Bash', 'runs npm test', { ms: 2500 });
const merged = (ctx, conflicted, rest) => `Merged ${ctx.mainBranch}${conflicted.length ? ` and resolved ${conflicted.join(', ')}` : ''}. ${rest} npm test passes.`;

/** For a run that finds its recipe already cooked: say so plainly instead of pretending to act on free text. */
async function nothingLeft(ctx, what) {
  ctx.say(`${heard(ctx)} ${what} is already on the plate, and a simulated chef only knows its recipe, so the code is unchanged.`.trim());
  await runTests(ctx);
  return `${what} is unchanged. Simulated chefs follow a fixed recipe and cannot act on free-form notes.`;
}

/** Replaces an exported function and the doc comment above it. Returns null when the file does not have it. */
function swapFn(text, name, block) {
  if (!text) return null;
  const fn = text.indexOf(`export function ${name}(`);
  const end = fn < 0 ? -1 : text.indexOf('\n}\n', fn);
  if (end < 0) return null;
  const doc = text.lastIndexOf('/**', fn);
  const start = doc >= 0 && !text.slice(doc, fn).includes('\n\n') ? doc : fn;
  return text.slice(0, start) + block + text.slice(end + 2);
}

/** A change that writes a whole file from examples/roster-cafe-orders, unless `has` says it is already there. */
const whole = (file, has = () => true, ms = 3500) => {
  const body = dish(file);
  return { file, ms, to: text => (text != null && has(text) ? text : body) };
};

const changesFor = (r, file) => r.changes.filter(c => c.file === file);
const applyAll = (changes, text) => changes.reduce((t, c) => (t == null ? t : c.to(t)), text);

/**
 * Cooks a recipe that is a list of changes: reads, asks what it has to, makes each change that is not in yet and runs
 * the tests. On a conflict run it merges main first, making its own changes again on top of main's version of each file.
 */
async function cook(ctx, r) {
  await ctx.step('Read', `reads ${r.planFile}`, { file: r.planFile, ms: 1500 });
  let conflicted = [];
  if (ctx.kind === 'conflict') {
    const files = [...new Set(r.changes.map(c => c.file))];
    conflicted = await mergeMain(ctx, Object.fromEntries(files.map(f => [f, theirs => applyAll(changesFor(r, f), theirs)])));
  }
  const todo = [];
  for (const c of r.changes) {
    const now = await ctx.read(c.file), next = c.to(now);
    if (next != null && next !== now) todo.push(c);
  }
  if (!todo.length) {
    if (ctx.kind !== 'conflict') return nothingLeft(ctx, r.what);
    await runTests(ctx);
    return merged(ctx, conflicted, r.afterMerge);
  }
  if (heard(ctx)) ctx.say(heard(ctx));
  for (const file of r.reads || []) await ctx.step('Read', `reads ${file}`, { file, ms: 1300 });
  if (r.reproduce) await ctx.step('Bash', `runs ${r.reproduce}`, { ms: 2000 });
  if (r.found) ctx.say(r.found);
  if (r.before && ctx.kind === 'first' && ctx.wantsAsk()) await r.before(ctx);
  for (const c of todo) {
    const now = await ctx.read(c.file), next = c.to(now);
    if (next == null || next === now) continue;
    await ctx.edit(c.file, next, `${now == null ? 'writes' : 'edits'} ${c.file}`, c.ms || 3000, now == null ? 'Write' : 'Edit');
  }
  await runTests(ctx);
  return ctx.kind === 'conflict' ? merged(ctx, conflicted, r.afterMerge) : r.summary;
}

const listed = r => ({ ...r, run: ctx => cook(ctx, r) });

/* ---------- Close shift shows negative hours (S): a one-function fix, right first time ---------- */

const HOURS_BUG = '  return (minutes(shift.end) - minutes(shift.start)) / 60;';
const HOURS_FIX = [
  '  const start = minutes(shift.start), end = minutes(shift.end);',
  '  // An end at or before the start is on the next day.',
  '  return ((end > start ? end : end + 24 * 60) - start) / 60;',
].join('\n');

const closeShift = listed({
  title: 'Close shift shows negative hours',
  planFile: PAY,
  plan: `Plan:
1. Reproduce: shiftHours() for Raj's Thursday close, 16:00 to 00:30, in data/roster.json.
2. shiftHours in src/pay.js subtracts the two clock times as if they were on the same day. When the end is at or before the start, add 24 hours to the end.
3. Add test/close-shift.test.js: a close past midnight, an end exactly at midnight, a daytime shift, and the pay for a close.
4. Run npm test.
Not in this order: the whole shift is paid at the loading of the day it starts on.`,
  what: 'The close shift fix',
  reproduce: 'node -e "import(\'./src/pay.js\').then(m => console.log(m.shiftHours({ start: \'16:00\', end: \'00:30\' })))"',
  found: 'It prints -15.5. shiftHours subtracts the clock times as if both were on the same day, so any shift that ends after midnight is negative.',
  async applies(ctx) { const t = (await ctx.read(PAY)) || ''; return t.includes(HOURS_BUG) || t.includes(HOURS_FIX); },
  changes: [
    { file: PAY, ms: 2800, to: text => text && text.replace(HOURS_BUG, HOURS_FIX).replace('/** Hours worked in one shift. */', '/** Hours worked in one shift. A close that runs past midnight ends on the next day. */') },
    whole('test/close-shift.test.js'),
  ],
  summary: `shiftHours() subtracted the start time from the end time as if both were on the same day, so Raj's Thursday close (16:00 to 00:30) came out at -15.5 hours and negative pay. An end at or before the start now counts as the next day (${PAY}). Added test/close-shift.test.js: a close past midnight, an end exactly at midnight, a daytime shift, and the pay for a close. npm test passes. Not changed: the whole shift is paid at the loading of the day it starts on, so the half hour after midnight is not treated as the next day.`,
  afterMerge: 'The close shift fix is unchanged.',
});

/* ---------- loadingFor() in src/pay.js: the block the Sunday and public holiday orders both rewrite ---------- */

const SUNDAY_LINE = '  if (day === SUNDAY) return 1.5;', HOLIDAY_LINE = '  if (publicHoliday(date)) return 2.5;';
const HOLIDAY_IMPORT = "import { publicHoliday } from './holidays.js';";
const SUNDAY_TODO = 'TODO: Sunday should be 1.5x; it gets the Saturday loading for now.';

const detectLoading = text => ({ sunday: text.includes(SUNDAY_LINE), holiday: text.includes(HOLIDAY_LINE) });

function loadingBlock({ sunday, holiday }) {
  const rates = [holiday && '2.5x on a public holiday', sunday && '1.5x on Sunday', sunday && '1.25x on Saturday'].filter(Boolean);
  const doc = ['The penalty loading for a date' + (rates.length ? `: ${rates.join(', ')}.` : '.'), !sunday && SUNDAY_TODO].filter(Boolean).join(' ');
  return [
    `/** ${doc} */`,
    'export function loadingFor(date) {',
    ...(holiday ? [HOLIDAY_LINE] : []),
    '  const day = dayOfWeek(date);',
    ...(sunday ? [SUNDAY_LINE, '  return day === SATURDAY ? 1.25 : 1;'] : ['  return day === SATURDAY || day === SUNDAY ? 1.25 : 1;']),
    '}',
  ].join('\n');
}

/** Rewrites loadingFor() with one more rule, keeping the rules it already has and everything else in the file. */
function setLoading(text, change) {
  if (!text) return null;
  const rules = { ...detectLoading(text), ...change };
  let out = swapFn(text, 'loadingFor', loadingBlock(rules));
  if (out && rules.holiday && !out.includes(HOLIDAY_IMPORT)) out = out.replace('\nconst SUNDAY', `\n${HOLIDAY_IMPORT}\n\nconst SUNDAY`);
  return out;
}

/* ---------- Sunday penalty rate (S): conflicts with the public holiday order ---------- */

const sunday = listed({
  title: 'Sunday penalty rate',
  planFile: PAY,
  plan: `Plan:
1. loadingFor() in src/pay.js gives Saturday and Sunday the same 1.25x, and its comment has the TODO.
2. Return 1.5 for Sunday, keep 1.25 for Saturday, and drop the TODO.
3. Add test/sunday.test.js: Sunday 1.5x, Saturday still 1.25x, a weekday 1x, and the pay for a 4 hour Sunday shift.
4. Run npm test.
Risk: any other order that changes loadingFor() will conflict with this one.`,
  what: 'The Sunday loading',
  async applies(ctx) { return setLoading(await ctx.read(PAY), {}) != null; },
  changes: [
    { file: PAY, ms: 3000, to: text => setLoading(text, { sunday: true }) },
    whole('test/sunday.test.js'),
  ],
  summary: `loadingFor() in ${PAY} now returns 1.5 for Sunday and keeps 1.25 for Saturday, and the TODO is gone. Added test/sunday.test.js: Sunday, Saturday and a weekday, and a 4 hour Sunday shift at $30 paying $180. npm test passes. On the roster, Ben, Sol and Ava's Sunday shifts go up.`,
  afterMerge: 'loadingFor() keeps the rules main had and adds the Sunday one.',
});

/* ---------- Public holiday rate (M): wants a network call, and conflicts with the Sunday order ---------- */

const holiday = listed({
  title: 'Public holiday rate',
  planFile: PAY,
  plan: `Plan:
1. Add src/holidays.js with publicHoliday(date): the Queensland public holidays for 2026, including the Brisbane show day.
2. In loadingFor() in src/pay.js, check for a public holiday first and return 2.5, before the weekend rule.
3. Add test/holidays.test.js: Christmas Day, an ordinary day, Boxing Day on a Saturday paying 2.5x and not 1.25x, and the pay for a Boxing Day shift.
4. Run npm test.
Needs: the list of dates. I would fetch it once (a network call) and check the dates in, so pay never depends on the network.
Risk: this rewrites loadingFor(), the same lines the Sunday order changes.`,
  what: 'The public holiday loading',
  reads: ['data/roster.json'],
  async applies(ctx) { return setLoading(await ctx.read(PAY), {}) != null; },
  async before(ctx) {
    const allowed = await ctx.permit('curl -s https://date.nager.at/api/v3/PublicHolidays/2026/AU');
    ctx.say(allowed
      ? 'Thanks. Pay should not depend on a live API, so the Queensland dates for 2026 go into the repo as a table.'
      : 'No network call, then. Writing the Queensland dates for 2026 in by hand; they need checking against the government list.');
  },
  changes: [
    whole(HOLIDAYS, undefined, 4000),
    { file: PAY, ms: 3200, to: text => setLoading(text, { holiday: true }) },
    whole('test/holidays.test.js', undefined, 3800),
  ],
  summary: `Added ${HOLIDAYS} with publicHoliday(date) and the Queensland public holidays for 2026, including the Brisbane show day. loadingFor() in ${PAY} checks it first and returns 2.5, so Boxing Day on this roster pays 2.5x and not the Saturday 1.25x. Tests are in test/holidays.test.js and npm test passes. Look closely at three things. The dates are a checked-in table, so check them against the Queensland Government list. Only 2026 is in the table: a 2027 date pays as an ordinary day until someone adds that year. Christmas Eve from 6pm is a part-day holiday in Queensland and is not handled.`,
  afterMerge: 'loadingFor() keeps the rules main had and checks for a public holiday first.',
});

/* ---------- Timesheet export for payroll (L): wants npm install ---------- */

const timesheet = listed({
  title: 'Timesheet export for payroll',
  planFile: TIMESHEET,
  plan: `Plan:
1. Rewrite timesheetCsv() in src/timesheet.js: a row per shift in date order (date, name, role, start, end, hours, loading, pay), then a Total row per person.
2. Quote any cell that holds a comma, a quote or a line break. That is a few lines, so it may not need a CSV package.
3. A shift whose staff id has no staff record should be an error, not a row that silently goes missing from payroll.
4. Rewrite test/timesheet.test.js: a normal week, a comma in a role, a quote in a name, an empty roster, unknown staff.
5. Run npm test. /timesheet.csv in src/app.js already serves whatever timesheetCsv() returns.`,
  what: 'The timesheet export',
  reads: ['data/roster.json', PAY, 'test/timesheet.test.js'],
  found: 'Mia\'s role is "Supervisor, barista" and the export joins cells with commas and no quoting, so her hours land in the role column.',
  async applies(ctx) { return ((await ctx.read(TIMESHEET)) || '').includes('export function timesheetCsv'); },
  async before(ctx) {
    const allowed = await ctx.permit('npm install csv-stringify');
    ctx.say(allowed
      ? 'Thanks. On a second look the quoting rule is four lines, so I wrote it by hand and left package.json with no dependencies.'
      : 'No new dependency, then. Writing the quoting by hand.');
  },
  changes: [
    whole(TIMESHEET, text => text.includes('const HEADER'), 5500),
    whole('test/timesheet.test.js', text => text.includes("'Total,"), 5000),
  ],
  summary: `Rewrote timesheetCsv() in ${TIMESHEET}. It now writes a row per shift in date order (date, name, role, start, end, hours, loading, pay) and a Total row for each person who worked. Cells are quoted when they hold a comma, a quote or a line break, so "Supervisor, barista" no longer shifts the columns. A shift for a staff id with no staff record throws, so it cannot go missing from payroll. No new dependency. test/timesheet.test.js is rewritten for the new format and npm test passes. Look closely at the format change: anything that read the old name,role,hours,pay file needs to know.`,
  afterMerge: 'The timesheet export is unchanged.',
});

/* ---------- Daily wage cost on the roster (M): visible in the app ---------- */

const VIEW_DOC = '/** Everything the roster page shows';
const DAY_COST_FN = `/** Wage cost of one day of the week (0 is Monday): the pay of every shift rostered on it. */
function dayCost(rows, day) {
  return round2(rows.reduce((sum, row) => sum + row.days[day].reduce((n, shift) => n + shift.pay, 0), 0));
}

`;
const DAYS_LINE = '    days: dates.map((date, i) => ({ date, name: DAY_NAMES[i] })),';
const DAYS_COST_LINE = '    days: dates.map((date, i) => ({ date, name: DAY_NAMES[i], cost: dayCost(rows, i) })),';
const PAGE_TABLE = "document.getElementById('roster').append(head, body);";
const PAGE_FOOT = [
  "const foot = el('tfoot');",
  "foot.append(row([el('th', 'Wage cost'), ...view.days.map(day => el('td', money(day.cost), 'num')), el('td', String(view.total.hours), 'num'), el('td', money(view.total.pay), 'num')]));",
  "document.getElementById('roster').append(head, body, foot);",
].join('\n');
const PAGE_STYLE = '  .shift { white-space: nowrap; }\n';
const PAGE_FOOT_STYLE = '  tfoot th, tfoot td { background: #f1ece2; color: inherit; font-weight: 600; }\n';

const dayCost = listed({
  title: 'Daily wage cost on the roster',
  planFile: ROSTER,
  plan: `Plan:
1. weekView() in src/roster.js builds what the page shows. Give each entry of days a cost: the pay of every shift on that day.
2. In public/index.html, add a table footer row: "Wage cost", a cell per day, then the week's hours and pay.
3. Add test/day-cost.test.js: the cost of each day, and the days adding up to the week total.
4. Run npm test, then open the page to see the row.`,
  what: 'The wage cost row',
  reads: [PAGE],
  async applies(ctx) {
    const roster = (await ctx.read(ROSTER)) || '', page = (await ctx.read(PAGE)) || '';
    return (roster.includes(DAYS_LINE) || roster.includes(DAYS_COST_LINE)) && roster.includes(VIEW_DOC) && (page.includes(PAGE_TABLE) || page.includes('tfoot'));
  },
  changes: [
    { file: ROSTER, ms: 3800, to: text => text && (text.includes('function dayCost(') ? text : text.replace(VIEW_DOC, DAY_COST_FN + VIEW_DOC)).replace(DAYS_LINE, DAYS_COST_LINE) },
    { file: PAGE, ms: 3800, to: text => text && (text.includes('tfoot') ? text : text.replace(PAGE_TABLE, PAGE_FOOT).replace(PAGE_STYLE, PAGE_STYLE + PAGE_FOOT_STYLE)) },
    whole('test/day-cost.test.js'),
  ],
  summary: `The roster page has a new footer row, "Wage cost", with the cost of each day and the week's hours and pay. weekView() in ${ROSTER} works the cost out on the server, as days[i].cost, and ${PAGE} only prints it. test/day-cost.test.js checks each day's cost and that the days add up to the week total. npm test passes. To see it, run npm start in the repo and open the roster.`,
  afterMerge: 'The wage cost row is unchanged.',
});

/* ---------- Double-booked staff warning (S): visible in the app, and shares src/roster.js without conflicting ---------- */

const WARN_TODO = '    // TODO: warn when someone is rostered on two overlapping shifts.\n    warnings: [],\n';
const WARN_LIVE = [
  '    warnings: doubleBookings(shifts).map(([a, b]) => {',
  '      const who = staff.find(person => person.id === a.staffId)?.name ?? a.staffId;',
  '      return `${who} is double-booked on ${a.date}: ${a.start} to ${a.end} and ${b.start} to ${b.end}`;',
  '    }),',
  '',
].join('\n');
const DOUBLE_FNS = `
/** True when two shifts on the same date overlap in time. Back-to-back shifts do not. */
export function overlaps(a, b) {
  return a.date === b.date && a.start < b.end && b.start < a.end;
}

/** Pairs of overlapping shifts rostered for the same staff member. */
export function doubleBookings(shifts) {
  const pairs = [];
  for (const own of Object.values(byStaff(shifts))) {
    for (let i = 0; i < own.length; i++) {
      for (let j = i + 1; j < own.length; j++) {
        if (overlaps(own[i], own[j])) pairs.push([own[i], own[j]]);
      }
    }
  }
  return pairs;
}
`;

const doubleBooked = listed({
  title: 'Double-booked staff warning',
  planFile: ROSTER,
  plan: `Plan:
1. Add overlaps(a, b) and doubleBookings(shifts) to src/roster.js: for each staff member, every pair of their shifts that overlap on the same date.
2. weekView() returns warnings: [] with a TODO. Fill it with one sentence per double booking, naming the person and the two shifts.
3. public/index.html already lists warnings above the roster, so the page needs no change.
4. Add test/double-booking.test.js: an overlap, two different people, back-to-back shifts, different days, and the warning text.
5. Run npm test.`,
  what: 'The double-booking warning',
  reads: [PAGE],
  async applies(ctx) { const t = (await ctx.read(ROSTER)) || ''; return t.includes('export function byStaff') && (t.includes(WARN_TODO) || t.includes('doubleBookings')); },
  changes: [
    { file: ROSTER, ms: 4200, to: text => text && (text.includes('export function doubleBookings(') ? text : text.trimEnd() + '\n' + DOUBLE_FNS).replace(WARN_TODO, WARN_LIVE) },
    whole('test/double-booking.test.js', undefined, 3800),
  ],
  summary: `Added overlaps() and doubleBookings(shifts) to ${ROSTER}, and weekView() now fills warnings with one sentence per double booking. The page already lists warnings above the roster, so Ava's two Thursday shifts (11:00 to 15:00 and 14:00 to 18:00) now show in red with no change to ${PAGE}. test/double-booking.test.js covers an overlap, two different people, back-to-back shifts, different days and the warning text. npm test passes. One limit: shifts are compared by clock time on the same date, so an overlap with a close that runs past midnight is not caught.`,
  afterMerge: 'The double-booking warning is unchanged.',
});

/* ---------- Overtime after 8 hours (M): asks a real question, and the first attempt fails its own tests ---------- */

const OT_BASE = {
  // Pays the overtime hours at the day's rate and then again at the overtime rate, so 10 hours at $30 pays $390, not $330.
  wrong: 'hours * staff.rate * loading',
  right: '(hours - overtime) * staff.rate * loading',
};
const OT_RATE = { highest: 'Math.max(loading, 1.5)', stack: 'loading * 1.5' };

function detectOvertime(text) {
  return {
    state: text.includes(OT_BASE.right) ? 'right' : text.includes('const overtime = ') ? 'wrong' : 'none',
    mode: text.includes(`overtime * staff.rate * ${OT_RATE.stack}`) ? 'stack' : 'highest',
  };
}

function shiftPayBlock({ state, mode }) {
  if (state === 'none') {
    return [
      "/** Pay for one shift: the base rate times the day's loading. Overtime is not paid yet. */",
      'export function shiftPay(shift, staff) {',
      '  return round2(shiftHours(shift) * staff.rate * loadingFor(shift.date));',
      '}',
    ].join('\n');
  }
  const after = mode === 'stack' ? 'then 1.5x on top of the loading' : 'then 1.5x or the loading, whichever is higher';
  return [
    `/** Pay for one shift: the day's loading for the first 8 hours, ${after}. */`,
    'export function shiftPay(shift, staff) {',
    '  const hours = shiftHours(shift);',
    '  const overtime = Math.max(0, hours - 8);',
    '  const loading = loadingFor(shift.date);',
    `  return round2(${OT_BASE[state]} + overtime * staff.rate * ${OT_RATE[mode]});`,
    '}',
  ].join('\n');
}

const setShiftPay = (text, change) => (text ? swapFn(text, 'shiftPay', shiftPayBlock({ ...detectOvertime(text), ...change })) : null);

const overtimeTests = mode => `
const long = (end, date = '2026-11-18') => ({ date, start: '06:00', end });

test('an 8 hour shift earns no overtime', () => {
  assert.equal(shiftPay(long('14:00'), { rate: 30 }), 240);
});

test('a 10 hour shift pays 2 hours at 1.5x', () => {
  assert.equal(shiftPay(long('16:00'), { rate: 30 }), 330);
});

test('a 12 hour shift pays 4 hours at 1.5x', () => {
  assert.equal(shiftPay(long('18:00'), { rate: 30 }), 420);
});

test('${mode === 'stack' ? 'Saturday overtime is 1.5x on top of the 1.25x loading' : 'Saturday overtime is 1.5x in place of the 1.25x loading'}', () => {
  assert.equal(shiftPay(long('16:00', '2026-11-21'), { rate: 30 }), ${mode === 'stack' ? '412.5' : '390'});
});
`;

const overtime = {
  title: 'Overtime after 8 hours',
  // The first attempt fails its own tests for every rank below Head Chef, so no other slip is added on top.
  failsFirst: true,
  planFile: PAY,
  plan: `Plan:
1. shiftPay() in src/pay.js is the only place a shift's pay is worked out. Split the hours into the first 8 and the rest.
2. Pay the first 8 at the day's loading and the rest at the overtime rate, then round once.
3. Add tests to test/pay.test.js for 8, 10 and 12 hour weekday shifts ($240, $330 and $420 at $30 an hour) and a 10 hour Saturday.
4. Run npm test after the new cases are in, not before.
Open question: on a Saturday the shift already earns 1.25x. The order does not say whether overtime replaces that loading or stacks on it, and the two answers pay a 10 hour Saturday $390 or $412.50.`,
  async applies(ctx) { return setShiftPay(await ctx.read(PAY), {}) != null; },
  async run(ctx) {
    const testFile = 'test/pay.test.js';
    await ctx.step('Read', `reads ${PAY}`, { file: PAY, ms: 1500 });
    if (ctx.kind === 'conflict') {
      const { mode } = detectOvertime((await ctx.read(PAY)) || '');
      const conflicted = await mergeMain(ctx, { [PAY]: theirs => setShiftPay(theirs, { state: 'right', mode }) });
      const now = await ctx.read(PAY);
      if (detectOvertime(now).state !== 'right') await ctx.edit(PAY, setShiftPay(now, { state: 'right', mode }), `edits ${PAY}`, 2000);
      await runTests(ctx);
      return merged(ctx, conflicted, 'shiftPay() still pays overtime past 8 hours, on top of whatever loading rules main has.');
    }
    const addTests = async () => {
      const tests = await ctx.read(testFile);
      if (tests != null && !tests.includes('const long = ')) {
        await ctx.edit(testFile, tests.trimEnd() + '\n' + overtimeTests(detectOvertime(await ctx.read(PAY)).mode), `edits ${testFile}`, 3000);
      }
    };
    const text = await ctx.read(PAY);
    const { state } = detectOvertime(text);
    if (state === 'right') { await addTests(); return nothingLeft(ctx, 'The overtime rule'); }
    if (state === 'none') {
      await ctx.step('Read', `reads ${testFile}`, { file: testFile, ms: 1500 });
      if (heard(ctx)) ctx.say(heard(ctx));
      let mode = 'highest';
      if (ctx.kind === 'first' && ctx.wantsAsk()) {
        const pick = await ctx.ask({
          question: 'A Saturday shift already earns 1.25x. For its overtime hours, does 1.5x replace the loading or stack on top of it?', header: 'Overtime',
          options: [
            { label: 'Higher rate wins', description: 'Overtime hours earn 1.5x in place of 1.25x. A 10 hour Saturday at $30 pays $390' },
            { label: 'Stack them', description: 'Overtime hours earn 1.25 x 1.5 = 1.875x. A 10 hour Saturday at $30 pays $412.50' },
          ],
        });
        if (/stack/i.test(pick || '')) mode = 'stack';
        ctx.say(mode === 'stack' ? 'Stacking it is: overtime is 1.5x on top of the loading.'
          : pick ? 'The higher rate wins: overtime is 1.5x, or the loading when that is higher.'
            : 'No answer, so the higher rate wins. That is the cheaper reading to correct later, and the summary says so.');
      }
      // Every rank below Head Chef pays the overtime hours twice on the first attempt. The Head Chef gets the sum right.
      await ctx.edit(PAY, setShiftPay(text, { state: ctx.firstTryRight ? 'right' : 'wrong', mode }), `edits ${PAY}`, 3500);
      await runTests(ctx);
      ctx.say('The existing tests pass. Adding the 8, 10 and 12 hour cases and the long Saturday.');
      await addTests();
      return `shiftPay() in ${PAY} now pays hours past 8 in a shift at 1.5x${mode === 'stack' ? ', stacked on the weekend loading' : ', or at the day\'s loading when that is higher'}. Added tests for 8, 10 and 12 hour shifts and a 10 hour Saturday to ${testFile}. I ran npm test before adding the new cases, not after.`;
    }
    // The first attempt is on the plate and it is wrong.
    if (ctx.kind === 'steer') {
      ctx.say(heard(ctx));
      await addTests();
      await runTests(ctx);
      return `Carried on after your call-out. The overtime tests are in ${testFile}; check the oven before you ship.`;
    }
    await addTests();
    await runTests(ctx);
    ctx.say('The 10 hour shift pays $390, not $330. The overtime hours are paid at the day\'s rate and then again at the overtime rate.');
    await ctx.edit(PAY, setShiftPay(text, { state: 'right' }), `edits ${PAY}`, 3000);
    await runTests(ctx);
    return `Fixed the overtime sum in ${PAY}. The first attempt paid the overtime hours twice: once at the day's rate and again at the overtime rate. It now pays the first 8 hours at the day's loading and only the rest at the overtime rate. The 8, 10 and 12 hour tests and the Saturday test pass. On the roster, Ben's 10 hour Wednesday goes from $300 to $330.`;
  },
};

const RECIPES = [closeShift, overtime, sunday, timesheet, holiday, dayCost, doubleBooked];
const key = s => String(s || '').trim().toLowerCase();

/** The recipe for a starter-order title, or null for anything else. */
export function recipeFor(title) {
  return RECIPES.find(r => key(r.title) === key(title)) || null;
}
