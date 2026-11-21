import fs from 'node:fs/promises';
import path from 'node:path';
import { git } from './git.mjs';
import { SOLUTIONS_DIR } from './projects/roster-cafe.mjs';

/**
 * Recipes for the simulated chefs, keyed by the roster-cafe preset id (see server/projects/roster-cafe.mjs).
 *
 * A recipe makes the change a careful agent would make, one tool event at a time, and really writes the files.
 * Each one reads the worktree to decide what is left to do, so a redo or a conflict run picks up from the files.
 * Every recipe edits different lines from every other customer's recipes, so tables merge into main cleanly in any order.
 *
 * run(ctx) returns the chef's summary. ctx is built by simDriver in agents.mjs:
 *   kind        'first' | 'conflict' | 'feedback' | 'steer'
 *   note        the waiter's redo comment, or ''
 *   mainBranch  the branch a conflict run merges in (the table branch)
 *   est         how long the special should take, in ms (already divided by the sim speed)
 *   step(tool, text, { file, ms }), edit(file, text, why, ms), read(file), say(text)
 */

const ID = ['-c', 'user.name=Ship Shift chef', '-c', 'user.email=chef@ship-shift.local'];
const PAY = 'src/pay.js', ROSTER = 'src/roster.js', PAGE = 'public/index.html', SHEET = 'src/timesheet.js', HOLS = 'src/holidays.js';
const solution = rel => fs.readFile(path.join(SOLUTIONS_DIR, ...rel.split('/')), 'utf8').then(t => t.replace(/\r\n/g, '\n'));

/** Merges the given branch into the worktree, then strips any conflict markers by keeping both sides. */
export async function mergeMain(ctx) {
  const main = ctx.mainBranch;
  await ctx.step('Bash', `runs git merge ${main}`, { ms: 1500 });
  await git(ctx.cwd, [...ID, 'merge', '--no-edit', main], { allowFail: true });
  const conflicted = ((await git(ctx.cwd, ['diff', '--name-only', '--diff-filter=U'], { allowFail: true })) || '').split('\n').filter(Boolean);
  for (const f of conflicted) {
    const mine = await ctx.read(f);
    if (mine != null) await ctx.edit(f, mine.split('\n').filter(l => !/^(<{7}|={7}|>{7})( |$)/.test(l)).join('\n'), `resolves the conflict in ${f}`, 1800);
    await git(ctx.cwd, ['add', '-A', '--', f], { allowFail: true });
  }
  if (conflicted.length) await git(ctx.cwd, [...ID, 'commit', '-q', '--no-edit'], { allowFail: true });
  ctx.say(conflicted.length ? `Merged ${main}. Resolved by hand: ${conflicted.join(', ')}.` : `Merged ${main} with no conflicts.`);
  return conflicted;
}

/** Replaces one exact piece of text in a file. Returns false when the file does not hold it. */
async function swap(ctx, file, from, to, why, ms) {
  const text = await ctx.read(file);
  if (text == null || !text.includes(from)) return false;
  await ctx.edit(file, text.replace(from, to), why || `edits ${file}`, ms);
  return true;
}
const has = async (ctx, file, needle) => ((await ctx.read(file)) || '').includes(needle);
const tests = (ctx, ms) => ctx.step('Bash', 'runs npm test', { ms });
const heard = ctx => (ctx.note ? `Read your note: "${ctx.note}".` : '');

/** A recipe that finds its work already done: re-checks, runs the tests, and says so plainly. */
async function recheck(ctx, what) {
  if (heard(ctx)) ctx.say(heard(ctx));
  await tests(ctx, ctx.est * 0.3);
  return `${what} was already in place, so I re-ran the tests instead of changing it again.`;
}

const recipes = {
  '101-backend': {
    async run(ctx) {
      const e = ctx.est;
      await ctx.step('Read', `reads ${PAY}`, { file: PAY, ms: e * 0.15 });
      await ctx.step('Grep', 'searches for loadingFor', { ms: e * 0.1 });
      if (await has(ctx, PAY, 'day === SUNDAY ? 1.5')) return recheck(ctx, 'The Sunday loading');
      ctx.say('Sundays fall through to the Saturday branch, so they get 1.25x.');
      await swap(ctx, PAY, '/** The penalty loading for a date. TODO: Sunday should be 1.5x; it gets the Saturday loading for now. */', '/** The penalty loading for a date: Sundays are 1.5x, Saturdays 1.25x, weekdays 1x. */', `edits ${PAY}`, e * 0.1);
      await swap(ctx, PAY, '  return day === SATURDAY || day === SUNDAY ? 1.25 : 1;', '  return day === SUNDAY ? 1.5 : day === SATURDAY ? 1.25 : 1;', `edits ${PAY}`, e * 0.2);
      await ctx.edit('test/sunday.test.js', await solution('test/sunday.test.js'), 'writes test/sunday.test.js', e * 0.2, 'Write');
      await tests(ctx, e * 0.25);
      return 'Sundays now pay 1.5x in loadingFor; Saturday stays 1.25x and weekdays 1x. Added test/sunday.test.js (a 4 hour Sunday shift at $30 pays $180). All tests pass.';
    },
  },

  '102-backend': {
    async run(ctx) {
      const e = ctx.est;
      const WRONG = '  const end = minutes(shift.end) || 24 * 60; // a close at midnight counts to the end of the day\n  return (end - minutes(shift.start)) / 60;';
      const RIGHT = '  let mins = minutes(shift.end) - minutes(shift.start);\n  if (mins < 0) mins += 24 * 60; // the shift ends after midnight\n  return mins / 60;';
      const ORIGINAL = '  return (minutes(shift.end) - minutes(shift.start)) / 60;';
      if (heard(ctx)) ctx.say(heard(ctx));
      await ctx.step('Read', `reads ${PAY}`, { file: PAY, ms: e * 0.15 });
      if (await has(ctx, PAY, 'mins += 24 * 60')) return recheck(ctx, 'The overnight shift fix');
      if (await has(ctx, PAY, WRONG)) {
        // the redo: the first attempt only handled a close that ends exactly at midnight
        await ctx.step('Bash', 'runs node --test test/close-shift.test.js', { ms: e * 0.2 });
        ctx.say('Right: 00:30 is still treated as earlier than the start. Any end before the start means the next day.');
        await swap(ctx, PAY, WRONG, RIGHT, `edits ${PAY}`, e * 0.25);
        await tests(ctx, e * 0.25);
        return 'Fixed shiftHours for every shift that ends after midnight, not just at exactly 00:00: 16:00 to 00:30 is now 8.5 hours. test/close-shift.test.js passes, and so does everything else.';
      }
      // the first attempt: misses closes that run past midnight, so the oven lamp goes red
      ctx.say('A close that ends at 00:00 reads as minute 0, so the hours go negative.');
      await swap(ctx, PAY, ORIGINAL, WRONG, `edits ${PAY}`, e * 0.25);
      await ctx.edit('test/close-shift.test.js', await solution('test/close-shift.test.js'), 'writes test/close-shift.test.js', e * 0.2, 'Write');
      await tests(ctx, e * 0.3);
      return 'shiftHours now treats a 00:00 end as midnight at the end of the day. Added test/close-shift.test.js.';
    },
  },

  '102-frontend': {
    async run(ctx) {
      const e = ctx.est;
      await ctx.step('Read', `reads ${PAGE}`, { file: PAGE, ms: e * 0.2 });
      if (await has(ctx, PAGE, '(+1 day)')) return recheck(ctx, 'The "(+1 day)" label');
      if (heard(ctx)) ctx.say(heard(ctx));
      await swap(ctx, PAGE, "const line = el('div', `${shift.start} to ${shift.end}`, 'shift');", "const line = el('div', `${shift.start} to ${shift.end}${shift.end < shift.start ? ' (+1 day)' : ''}`, 'shift');", `edits ${PAGE}`, e * 0.4);
      await tests(ctx, e * 0.3);
      return 'The roster page now shows "(+1 day)" after any end time earlier than its start, e.g. "16:00 to 00:30 (+1 day)". Tests still pass.';
    },
  },

  '103-backend': {
    async run(ctx) {
      const e = ctx.est;
      await ctx.step('Read', `reads ${ROSTER}`, { file: ROSTER, ms: e * 0.15 });
      if (await has(ctx, ROSTER, 'function doubleBookings')) return recheck(ctx, 'The double-booking warnings');
      if (heard(ctx)) ctx.say(heard(ctx));
      const fn = [
        "const DAY = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];",
        "const MONTH = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];",
        "const minutesOf = time => { const [h, m] = time.split(':').map(Number); return h * 60 + m; };",
        '',
        '/** One warning per pair of overlapping shifts for the same person on the same day. */',
        'export function doubleBookings(staff, shifts) {',
        '  const warnings = [];',
        '  for (const [id, own] of Object.entries(byStaff(shifts))) {',
        '    const name = staff.find(person => person.id === id)?.name || id;',
        '    for (let i = 0; i < own.length; i++) {',
        '      for (let j = i + 1; j < own.length; j++) {',
        '        const a = own[i], b = own[j];',
        '        if (a.date !== b.date || !(minutesOf(a.start) < minutesOf(b.end) && minutesOf(b.start) < minutesOf(a.end))) continue;',
        '        const d = new Date(`${a.date}T00:00:00Z`);',
        '        warnings.push(`${name} is double-booked on ${DAY[d.getUTCDay()]} ${d.getUTCDate()} ${MONTH[d.getUTCMonth()]}: ${a.start}-${a.end} and ${b.start}-${b.end}`);',
        '      }',
        '    }',
        '  }',
        '  return warnings;',
        '}',
        '',
        '/** Everything the roster page shows:',
      ].join('\n');
      await swap(ctx, ROSTER, '/** Everything the roster page shows:', fn, `edits ${ROSTER}`, e * 0.25);
      await swap(ctx, ROSTER, '    // TODO: warn when someone is rostered on two overlapping shifts.\n    warnings: [],', '    warnings: doubleBookings(staff, shifts),', `edits ${ROSTER}`, e * 0.1);
      const test = [
        "import test from 'node:test';",
        "import assert from 'node:assert/strict';",
        "import { weekView } from '../src/roster.js';",
        '',
        "const staff = [{ id: 'ava', name: 'Ava Lindqvist', role: 'Kitchen hand', rate: 27.5 }];",
        "const view = shifts => weekView({ cafe: 'Test', weekStart: '2026-12-21', staff, shifts });",
        '',
        "test('two overlapping shifts on one day give one warning', () => {",
        "  const { warnings } = view([{ staffId: 'ava', date: '2026-12-24', start: '11:00', end: '15:00' }, { staffId: 'ava', date: '2026-12-24', start: '14:00', end: '18:00' }]);",
        "  assert.deepEqual(warnings, ['Ava Lindqvist is double-booked on Thu 24 Dec: 11:00-15:00 and 14:00-18:00']);",
        '});',
        '',
        "test('back-to-back shifts are not a double booking', () => {",
        "  assert.deepEqual(view([{ staffId: 'ava', date: '2026-12-24', start: '08:00', end: '12:00' }, { staffId: 'ava', date: '2026-12-24', start: '12:00', end: '16:00' }]).warnings, []);",
        '});',
        '',
      ].join('\n');
      await ctx.edit('test/warnings.test.js', test, 'writes test/warnings.test.js', e * 0.2, 'Write');
      await tests(ctx, e * 0.25);
      return 'weekView now returns a warning for each pair of overlapping shifts per person, e.g. "Ava Lindqvist is double-booked on Thu 24 Dec: 11:00-15:00 and 14:00-18:00". Back-to-back shifts do not count. Added test/warnings.test.js.';
    },
  },

  '103-frontend': {
    async run(ctx) {
      const e = ctx.est;
      await ctx.step('Read', `reads ${PAGE}`, { file: PAGE, ms: e * 0.25 });
      if (await has(ctx, PAGE, '#warnings:empty')) return recheck(ctx, 'The warning banner');
      if (heard(ctx)) ctx.say(heard(ctx));
      await swap(ctx, PAGE, '  #warnings { color: #b42318; font-weight: 600; padding-left: 1.2rem; }', '  #warnings { color: #fff; background: #b42318; font-weight: 600; padding: .6rem 1rem .6rem 2rem; border-radius: 8px; box-shadow: 0 2px 0 #7a1a12; }\n  #warnings:empty { display: none; }', `edits ${PAGE}`, e * 0.4);
      await tests(ctx, e * 0.25);
      return 'Warnings now show as a red banner above the roster, and the banner hides itself when there are none. Style only; tests still pass.';
    },
  },

  '104-database': {
    async run(ctx) {
      const e = ctx.est;
      await ctx.step('Glob', 'looks for src/*.js', { ms: e * 0.15 });
      if (await ctx.read(HOLS)) return recheck(ctx, 'The public holiday table');
      await ctx.edit(HOLS, await solution(HOLS), `writes ${HOLS}`, e * 0.35, 'Write');
      const test = [
        "import test from 'node:test';",
        "import assert from 'node:assert/strict';",
        "import { publicHoliday } from '../src/holidays.js';",
        '',
        "test('Christmas and Boxing Day are public holidays', () => {",
        "  assert.equal(publicHoliday('2026-12-25'), 'Christmas Day');",
        "  assert.equal(publicHoliday('2026-12-26'), 'Boxing Day');",
        '});',
        '',
        "test('an ordinary day is not a public holiday', () => {",
        "  assert.equal(publicHoliday('2026-12-24'), null);",
        '});',
        '',
      ].join('\n');
      await ctx.edit('test/holidays-table.test.js', test, 'writes test/holidays-table.test.js', e * 0.2, 'Write');
      await tests(ctx, e * 0.25);
      return 'Added src/holidays.js with the 2026 Queensland public holidays as a checked-in table, and publicHoliday(date) returning the name or null. Added test/holidays-table.test.js.';
    },
  },

  '104-backend': {
    async run(ctx) {
      const e = ctx.est;
      await ctx.step('Read', `reads ${PAY}`, { file: PAY, ms: e * 0.12 });
      if (await has(ctx, PAY, 'publicHoliday(date)')) return recheck(ctx, 'The public holiday loading');
      if (heard(ctx)) ctx.say(heard(ctx));
      if (!(await ctx.read(HOLS))) {
        ctx.say('There is no holiday table yet, so I added the same src/holidays.js the Database station would.');
        await ctx.edit(HOLS, await solution(HOLS), `writes ${HOLS}`, e * 0.15, 'Write');
      }
      const text = await ctx.read(PAY);
      await ctx.edit(PAY, "import { publicHoliday } from './holidays.js';\n" + text, `edits ${PAY}`, e * 0.1);
      await swap(ctx, PAY, 'export function loadingFor(date) {\n', 'export function loadingFor(date) {\n  if (publicHoliday(date)) return 2.5; // a public holiday beats the weekend loading\n', `edits ${PAY}`, e * 0.15);
      await ctx.edit('test/holidays.test.js', await solution('test/holidays.test.js'), 'writes test/holidays.test.js', e * 0.15, 'Write');
      await tests(ctx, e * 0.25);
      return 'loadingFor now pays 2.5x on any public holiday, checked before the weekend loading, so Boxing Day on a Saturday is 2.5x. Added test/holidays.test.js (6 hours on Boxing Day at $30 pays $450).';
    },
  },

  '104-frontend': {
    async run(ctx) {
      const e = ctx.est;
      await ctx.step('Read', `reads ${PAGE}`, { file: PAGE, ms: e * 0.2 });
      if (await has(ctx, PAGE, 'th.holiday')) return recheck(ctx, 'The holiday labels');
      if (heard(ctx)) ctx.say(heard(ctx));
      await swap(ctx, PAGE, '  th { background: #2f6f62; color: #fff; font-weight: 600; }\n', '  th { background: #2f6f62; color: #fff; font-weight: 600; }\n  th.holiday { background: #a4441c; }\n', `edits ${PAGE}`, e * 0.2);
      await swap(ctx, PAGE,
        "const dayHeading = day => { const th = el('th', day.name); th.append(el('small', day.date.slice(5))); return th; };",
        "const HOLIDAYS = { '2026-12-25': 'Christmas Day', '2026-12-26': 'Boxing Day', '2026-12-28': 'Boxing Day (additional)' };\nconst dayHeading = day => { const th = el('th', day.name); th.append(el('small', day.date.slice(5))); if (HOLIDAYS[day.date]) { th.className = 'holiday'; th.append(el('small', HOLIDAYS[day.date])); } return th; };",
        `edits ${PAGE}`, e * 0.3);
      await tests(ctx, e * 0.25);
      return 'Public holiday columns on the roster header are now highlighted and labelled with the holiday name (Christmas Day, Boxing Day). Tests still pass.';
    },
  },

  '105-integration': {
    async run(ctx) {
      const e = ctx.est;
      await ctx.step('Read', `reads ${SHEET}`, { file: SHEET, ms: e * 0.12 });
      if (await has(ctx, SHEET, "'loading'")) return recheck(ctx, 'The per-shift timesheet');
      if (heard(ctx)) ctx.say(heard(ctx));
      await ctx.step('Read', 'reads test/timesheet.test.js', { file: 'test/timesheet.test.js', ms: e * 0.1 });
      await ctx.edit(SHEET, await solution(SHEET), `edits ${SHEET}`, e * 0.3);
      await ctx.edit('test/timesheet.test.js', await solution('test/timesheet.test.js'), 'edits test/timesheet.test.js', e * 0.2);
      await tests(ctx, e * 0.25);
      return 'timesheetCsv now writes one row per shift in date order with date, name, role, start, end, hours, loading and pay, then a Total row per person. Cells with commas or quotes are quoted, and an unknown staff id throws. Replaced test/timesheet.test.js to match.';
    },
  },

  '105-backend': {
    async run(ctx) {
      const e = ctx.est;
      await ctx.step('Read', `reads ${ROSTER}`, { file: ROSTER, ms: e * 0.15 });
      if (await has(ctx, ROSTER, 'cost: round2(')) return recheck(ctx, 'The daily wage cost');
      if (heard(ctx)) ctx.say(heard(ctx));
      await swap(ctx, ROSTER, '    days: dates.map((date, i) => ({ date, name: DAY_NAMES[i] })),', '    days: dates.map((date, i) => ({ date, name: DAY_NAMES[i], cost: round2(rows.reduce((sum, row) => sum + row.days[i].reduce((s, shift) => s + shift.pay, 0), 0)) })),', `edits ${ROSTER}`, e * 0.35);
      await ctx.edit('test/day-cost.test.js', await solution('test/day-cost.test.js'), 'writes test/day-cost.test.js', e * 0.2, 'Write');
      await tests(ctx, e * 0.25);
      return "weekView().days[] now carries each day's wage cost, summed from everyone rostered that day, and the days add up to the week total. Added test/day-cost.test.js.";
    },
  },
};

/** Any item without a recipe: one harmless, real edit in a file of its own, so it never conflicts. */
export const genericRecipe = {
  async run(ctx) {
    const e = ctx.est;
    await ctx.step('Glob', 'looks for src/**/*.js', { ms: e * 0.2 });
    await ctx.step('Read', 'reads src/roster.js', { file: 'src/roster.js', ms: e * 0.2 });
    if (heard(ctx)) ctx.say(heard(ctx));
    const file = `notes/item-${String(ctx.itemKey || 'x').replace(/[^\w.-]/g, '')}.md`;
    const prev = (await ctx.read(file)) || `# ${ctx.title}\n\n`;
    await ctx.edit(file, prev + `- ${ctx.kind === 'first' ? 'Request' : 'Follow-up'}: ${String(ctx.ask || ctx.title).slice(0, 300)}\n`, `writes ${file}`, e * 0.3, 'Write');
    await tests(ctx, e * 0.3);
    return `Simulated chef: this item has no scripted recipe, so I wrote the request up in ${file} and ran the tests. Hire real chefs to cook free-text items properly.`;
  },
};

export function recipeFor(presetId) {
  return recipes[presetId] || null;
}
