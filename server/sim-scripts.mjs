import { git } from './git.mjs';

/**
 * Recipes for the simulated chefs, keyed by the demo repo's starter-order titles.
 *
 * A recipe makes the change a careful agent would make to server/demo-repo.mjs's project, one tool event at a time.
 * Each one reads the worktree to decide what is left to do, so a resumed, steered or re-fired run picks up
 * from the files and not from memory. Any other title, or a repo that is not the demo, gets the generic recipe.
 *
 * run(ctx) returns the summary for the reviewer. ctx is built by simDriver in agents.mjs:
 *   kind        'first' | 'steer' | 'conflict' | 'feedback'
 *   note        what the head chef said (send-back comment or call-out), or ''
 *   mainBranch  the branch a conflict run merges in
 *   step(tool, text, { file, ms })   one tool event, then the time it takes
 *   edit(file, text, why, ms)        one edit event that really writes the file
 *   read(file)  -> text with LF line endings, or null
 *   say(text), wantsAsk(), ask(question) -> label or null, permit(command) -> boolean
 */

const PAY = 'src/pay.js', ROSTER = 'src/roster.js', EXPORT = 'src/export.js';
const ID = ['-c', 'user.name=Ship Shift chef', '-c', 'user.email=chef@ship-shift.local'];

/* ---------- src/pay.js: the block Overtime and CSV export both rewrite ---------- */

const BASE_DOC = "/** Pay for one shift at the staff member's base rate. Overtime is not handled yet. */";
const OT_SUM = {
  // Pays the overtime hours at the base rate and then again at 1.5x, so a 10 hour shift at 30 pays 390, not 330.
  wrong: 'hours * staff.rate + overtime * staff.rate * 1.5',
  right: '(hours - overtime) * staff.rate + overtime * staff.rate * 1.5',
};

function detectPay(text) {
  return {
    exact: text.includes('function shiftPayExact'),
    overtime: text.includes(OT_SUM.right) ? 'right' : text.includes(OT_SUM.wrong) ? 'wrong' : 'none',
  };
}

function payBlock({ overtime, exact }) {
  const ot = overtime !== 'none';
  const body = wrap => (ot
    ? ['  const hours = shiftHours(shift);', '  const overtime = Math.max(0, hours - 8);', `  return ${wrap(OT_SUM[overtime])};`]
    : [`  return ${wrap('shiftHours(shift) * staff.rate')};`]);
  const rule = 'base rate for the first 8 hours, 1.5x after that';
  if (!exact) {
    return [ot ? `/** Pay for one shift: ${rule}. */` : BASE_DOC, 'export function shiftPay(shift, staff) {', ...body(x => `round2(${x})`), '}'].join('\n');
  }
  return [
    ot ? `/** Unrounded pay for one shift: ${rule}. */` : '/** Unrounded pay for one shift, so a weekly total can round once at the end. */',
    'export function shiftPayExact(shift, staff) {', ...body(x => x), '}', '',
    ot ? '/** Pay for one shift, rounded to cents. */' : BASE_DOC,
    'export function shiftPay(shift, staff) {', '  return round2(shiftPayExact(shift, staff));', '}', '',
    '/** Pay for every shift one staff member worked, rounded once. */',
    'export function weeklyPay(shifts, staff) {', '  return round2(shifts.reduce((sum, s) => sum + shiftPayExact(s, staff), 0));', '}',
  ].join('\n');
}

/** Rewrites the pay block, keeping everything else in the file. Returns null when the file is not the demo's pay.js. */
function setPay(text, change) {
  if (!text) return null;
  const fn = text.search(/export function shiftPay(Exact)?\(/);
  const end = text.indexOf('export function weeklyHours');
  if (fn < 0 || end < fn) return null;
  const doc = text.lastIndexOf('/**', fn);
  const start = doc >= 0 && !text.slice(doc, fn).includes('\n\n') ? doc : fn;
  return text.slice(0, start) + payBlock({ ...detectPay(text), ...change }) + '\n\n' + text.slice(end);
}

/* ---------- shared moves ---------- */

/**
 * Really runs `git merge <main>` in the worktree and resolves what conflicts.
 * resolvers maps a file to a function from main's version to the resolved text; any other file keeps both sides.
 */
export async function mergeMain(ctx, resolvers = {}) {
  const main = ctx.mainBranch;
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

/** For a run that finds its recipe already cooked: say so plainly instead of pretending to act on free text. */
async function nothingLeft(ctx, what) {
  ctx.say(`${heard(ctx)} ${what} is already on the plate, and a simulated chef only knows its recipe, so the code is unchanged.`.trim());
  await ctx.step('Bash', 'runs npm test', { ms: 2200 });
  return `${what} is unchanged. Simulated chefs follow a fixed recipe and cannot act on free-form notes.`;
}

/* ---------- the four starter orders ---------- */

const WEEKLY_TEST = `import test from 'node:test';
import assert from 'node:assert/strict';
import { weeklyHours } from '../src/pay.js';

test('weeklyHours adds up every shift', () => {
  assert.equal(weeklyHours([
    { start: '2026-11-16T09:00:00Z', end: '2026-11-16T17:00:00Z' },
    { start: '2026-11-17T09:00:00Z', end: '2026-11-17T13:00:00Z' },
  ]), 12);
});

test('weeklyHours of an empty roster is 0', () => {
  assert.equal(weeklyHours([]), 0);
});
`;

const weeklyHours = {
  title: 'Weekly hours crashes',
  planFile: PAY,
  plan: `Plan:
1. Reproduce: call weeklyHours() with one shift and read the error.
2. The loop in src/pay.js runs to i <= shifts.length, one past the end. Change it to i < shifts.length.
3. Add test/weekly-hours.test.js: a two-shift roster and an empty roster.
4. Run npm test.`,
  async applies(ctx) { return /i <=? shifts\.length/.test((await ctx.read(PAY)) || ''); },
  async run(ctx) {
    await ctx.step('Read', `reads ${PAY}`, { file: PAY, ms: 1500 });
    if (ctx.kind === 'conflict') await mergeMain(ctx);
    const text = await ctx.read(PAY);
    const testFile = 'test/weekly-hours.test.js';
    if (!text.includes('i <= shifts.length') && await ctx.read(testFile)) {
      if (ctx.kind === 'conflict') { await ctx.step('Bash', 'runs npm test', { ms: 2200 }); return `Merged ${ctx.mainBranch}. The weeklyHours fix still applies and the tests pass.`; }
      return nothingLeft(ctx, 'The weeklyHours fix');
    }
    if (heard(ctx)) ctx.say(heard(ctx));
    if (text.includes('i <= shifts.length')) {
      await ctx.step('Bash', 'runs node -e "import(\'./src/pay.js\').then(m => m.weeklyHours([]))"', { ms: 2000 });
      ctx.say('The loop reads shifts[shifts.length], which is undefined, so shiftHours throws on every roster.');
      await ctx.edit(PAY, text.replace('i <= shifts.length', 'i < shifts.length'), `edits ${PAY}`, 2500);
    }
    if (!await ctx.read(testFile)) await ctx.edit(testFile, WEEKLY_TEST, `writes ${testFile}`, 3000, 'Write');
    await ctx.step('Bash', 'runs npm test', { ms: 2500 });
    return `weeklyHours() looped one past the end of the roster (i <= shifts.length), so it threw for every input. Changed the bound to i < shifts.length in ${PAY}. Added ${testFile} with a two-shift roster and an empty roster. npm test passes.`;
  },
};

const OVERTIME_TESTS = `
const hoursLong = hours => ({ start: '2026-11-20T09:00:00Z', end: new Date(Date.parse('2026-11-20T09:00:00Z') + hours * 36e5).toISOString() });

test('an 8 hour shift earns no overtime', () => {
  assert.equal(shiftPay(hoursLong(8), { rate: 30 }), 240);
});

test('a 10 hour shift pays 2 hours at 1.5x', () => {
  assert.equal(shiftPay(hoursLong(10), { rate: 30 }), 330);
});

test('a 12 hour shift pays 4 hours at 1.5x', () => {
  assert.equal(shiftPay(hoursLong(12), { rate: 30 }), 420);
});
`;

const overtime = {
  title: 'Overtime pay',
  planFile: PAY,
  plan: `Plan:
1. shiftPay in src/pay.js is the only place pay is worked out. Split the hours into the first 8 and the rest.
2. Pay the first 8 at the base rate and the rest at 1.5x, then round once.
3. Add tests in test/pay.test.js for 8, 10 and 12 hour shifts (240, 330 and 420 at a rate of 30).
4. Run npm test after the new cases are in, not before.
Assumption: overtime is per shift, as the order says, not per week.`,
  async applies(ctx) { return setPay(await ctx.read(PAY), {}) != null; },
  async run(ctx) {
    const testFile = 'test/pay.test.js';
    await ctx.step('Read', `reads ${PAY}`, { file: PAY, ms: 1500 });
    if (ctx.kind === 'conflict') {
      const conflicted = await mergeMain(ctx, { [PAY]: theirs => setPay(theirs, { overtime: 'right' }) });
      const merged = await ctx.read(PAY);
      if (detectPay(merged).overtime !== 'right') await ctx.edit(PAY, setPay(merged, { overtime: 'right' }), `edits ${PAY}`, 2000);
      await ctx.step('Bash', 'runs npm test', { ms: 2500 });
      return `Merged ${ctx.mainBranch}${conflicted.length ? ` and resolved ${conflicted.join(', ')}` : ''}. The overtime rule now sits on top of what main had: base rate for the first 8 hours, 1.5x after. npm test passes.`;
    }
    const addTests = async () => {
      const tests = await ctx.read(testFile);
      if (tests != null && !tests.includes('hoursLong')) await ctx.edit(testFile, tests.trimEnd() + '\n' + OVERTIME_TESTS, `edits ${testFile}`, 3000);
    };
    const text = await ctx.read(PAY);
    const state = detectPay(text).overtime;
    if (state === 'right') { await addTests(); return nothingLeft(ctx, 'The overtime rule'); }
    if (state === 'none') {
      await ctx.step('Read', `reads ${testFile}`, { file: testFile, ms: 1500 });
      if (heard(ctx)) ctx.say(heard(ctx));
      if (ctx.kind === 'first' && ctx.wantsAsk()) {
        const pick = await ctx.ask({
          question: 'Should overtime count per shift or per week?', header: 'Overtime',
          options: [
            { label: 'Per shift', description: 'Hours past 8 in one shift earn 1.5x, as the order says' },
            { label: 'Per week', description: 'Hours past 40 in a week earn 1.5x' },
          ],
        });
        ctx.say(/week/i.test(pick || '')
          ? 'Per week needs the whole roster, which shiftPay never sees. This plate does per shift; weekly overtime wants its own order.'
          : pick ? 'Per shift it is.' : 'No answer, so going with per shift, as the order is written.');
      }
      await ctx.edit(PAY, setPay(text, { overtime: 'wrong' }), `edits ${PAY}`, 3500);
      await ctx.step('Bash', 'runs npm test', { ms: 2500 });
      ctx.say('The existing tests pass. Adding the 8, 10 and 12 hour cases.');
      await addTests();
      return `shiftPay now pays 1.5x for hours past 8 in a shift (${PAY}). Added tests for 8, 10 and 12 hour shifts to ${testFile}. I ran npm test before adding the new cases, not after.`;
    }
    // The first attempt is on the plate and it is wrong.
    if (ctx.kind === 'steer') {
      ctx.say(heard(ctx));
      await addTests();
      await ctx.step('Bash', 'runs npm test', { ms: 2500 });
      return `Carried on after your call-out. The overtime tests are in ${testFile}; check the oven before you ship.`;
    }
    await addTests();
    await ctx.step('Bash', 'runs npm test', { ms: 2500 });
    ctx.say('The 10 hour shift pays 390, not 330. The overtime hours are paid at the base rate and then again at 1.5x.');
    await ctx.edit(PAY, setPay(text, { overtime: 'right' }), `edits ${PAY}`, 3000);
    await ctx.step('Bash', 'runs npm test', { ms: 2500 });
    return `Fixed the overtime sum in ${PAY}: the first attempt paid overtime hours twice (base rate plus 1.5x). It now pays the first 8 hours at the base rate and only the rest at 1.5x. The 8, 10 and 12 hour tests pass.`;
  },
};

const DOUBLE_FN = `
/** Pairs of overlapping shifts worked by the same staff member. */
export function doubleBookings(shifts) {
  const pairs = [];
  for (const mine of Object.values(byStaff(shifts))) {
    for (let i = 0; i < mine.length; i++) {
      for (let j = i + 1; j < mine.length; j++) {
        if (overlaps(mine[i], mine[j])) pairs.push([mine[i], mine[j]]);
      }
    }
  }
  return pairs;
}
`;

const DOUBLE_TESTS = `
const morning = { staffId: 'a', start: '2026-11-20T09:00:00Z', end: '2026-11-20T13:00:00Z' };
const lunch = { staffId: 'a', start: '2026-11-20T12:00:00Z', end: '2026-11-20T16:00:00Z' };

test('doubleBookings pairs overlapping shifts for one staff member', () => {
  assert.deepEqual(doubleBookings([morning, lunch]), [[morning, lunch]]);
});

test('doubleBookings ignores overlaps between different staff', () => {
  assert.deepEqual(doubleBookings([morning, { ...lunch, staffId: 'b' }]), []);
});

test('back-to-back shifts are not double-booked', () => {
  const evening = { staffId: 'a', start: '2026-11-20T13:00:00Z', end: '2026-11-20T17:00:00Z' };
  assert.deepEqual(doubleBookings([morning, evening]), []);
});
`;

const doubleBooked = {
  title: 'Double-booked staff report',
  planFile: ROSTER,
  plan: `Plan:
1. src/roster.js already has byStaff() and overlaps(). Build doubleBookings(shifts) from those two.
2. For each staff member, compare every pair of their shifts once and collect the overlapping pairs.
3. Add tests in test/roster.test.js: an overlap, the same times for two different staff, and back-to-back shifts.
4. Run npm test.`,
  async applies(ctx) { const t = (await ctx.read(ROSTER)) || ''; return t.includes('export function byStaff') && t.includes('export function overlaps'); },
  async run(ctx) {
    const testFile = 'test/roster.test.js';
    await ctx.step('Read', `reads ${ROSTER}`, { file: ROSTER, ms: 1500 });
    if (ctx.kind === 'conflict') await mergeMain(ctx);
    const text = await ctx.read(ROSTER);
    const tests = await ctx.read(testFile);
    if (text.includes('doubleBookings') && (tests == null || tests.includes('doubleBookings'))) {
      if (ctx.kind === 'conflict') { await ctx.step('Bash', 'runs npm test', { ms: 2200 }); return `Merged ${ctx.mainBranch}. doubleBookings() is unchanged and the tests pass.`; }
      return nothingLeft(ctx, 'doubleBookings()');
    }
    if (heard(ctx)) ctx.say(heard(ctx));
    await ctx.step('Grep', 'searches for overlaps', { ms: 1500 });
    if (!text.includes('doubleBookings')) await ctx.edit(ROSTER, text.trimEnd() + '\n' + DOUBLE_FN, `edits ${ROSTER}`, 4000);
    await ctx.step('Read', `reads ${testFile}`, { file: testFile, ms: 1500 });
    if (tests != null && !tests.includes('doubleBookings')) {
      const withImport = tests.replace("import { overlaps } from '../src/roster.js';", "import { overlaps, doubleBookings } from '../src/roster.js';");
      await ctx.edit(testFile, withImport.trimEnd() + '\n' + DOUBLE_TESTS, `edits ${testFile}`, 4000);
    }
    await ctx.step('Bash', 'runs npm test', { ms: 2500 });
    return `Added doubleBookings(shifts) to ${ROSTER}. It groups shifts with byStaff() and returns each overlapping pair once, using the existing overlaps(). Tests in ${testFile} cover an overlap, two different staff at the same time, and back-to-back shifts. npm test passes.`;
  },
};

const EXPORT_SRC = `import { byStaff } from './roster.js';
import { shiftHours, weeklyPay, round2 } from './pay.js';

/** Quotes a CSV cell when it holds a comma, a quote or a line break. */
const cell = value => {
  const s = String(value);
  return /[",\\r\\n]/.test(s) ? \`"\${s.replace(/"/g, '""')}"\` : s;
};

/** CSV of the week's pay, one row per staff member: name, hours, pay. */
export function weeklyPayCsv(shifts, staffById) {
  const rows = [['name', 'hours', 'pay']];
  for (const [staffId, mine] of Object.entries(byStaff(shifts))) {
    const staff = staffById[staffId];
    if (!staff) throw new Error(\`No staff record for \${staffId}\`);
    const hours = round2(mine.reduce((sum, s) => sum + shiftHours(s), 0));
    rows.push([staff.name, hours, weeklyPay(mine, staff).toFixed(2)]);
  }
  return rows.map(row => row.map(cell).join(',')).join('\\n') + '\\n';
}
`;

const EXPORT_TEST = `import test from 'node:test';
import assert from 'node:assert/strict';
import { weeklyPayCsv } from '../src/export.js';

const shifts = [
  { staffId: 'a', start: '2026-11-16T09:00:00Z', end: '2026-11-16T17:00:00Z' },
  { staffId: 'a', start: '2026-11-17T09:00:00Z', end: '2026-11-17T13:00:00Z' },
  { staffId: 'b', start: '2026-11-16T10:00:00Z', end: '2026-11-16T16:00:00Z' },
];
const staffById = { a: { name: 'Ada Park', rate: 30 }, b: { name: 'Okafor, Ben', rate: 25 } };

test('one row per staff member with hours and pay', () => {
  assert.equal(weeklyPayCsv(shifts, staffById), 'name,hours,pay\\nAda Park,12,360.00\\n"Okafor, Ben",6,150.00\\n');
});

test('a quote in a name is doubled', () => {
  const csv = weeklyPayCsv([shifts[2]], { b: { name: 'Ben "Benny" Okafor', rate: 25 } });
  assert.equal(csv.split('\\n')[1], '"Ben ""Benny"" Okafor",6,150.00');
});

test('an empty roster is only the header', () => {
  assert.equal(weeklyPayCsv([], staffById), 'name,hours,pay\\n');
});

test('a shift for unknown staff is an error', () => {
  assert.throws(() => weeklyPayCsv(shifts, { a: staffById.a }), /No staff record for b/);
});
`;

const csvExport = {
  title: 'Weekly pay CSV export',
  planFile: PAY,
  plan: `Plan:
1. Weekly pay must round once, not per shift. Split shiftPay in src/pay.js into shiftPayExact (unrounded) and shiftPay, and add weeklyPay(shifts, staff).
2. Add src/export.js with weeklyPayCsv(shifts, staffById): group with byStaff(), one row per staff member.
3. Quote cells that hold a comma, a quote or a line break. That is a few lines, so no CSV dependency is needed.
4. Add test/export.test.js: a normal week, a comma in a name, a quote in a name, an empty roster, unknown staff.
5. Run npm test.
Risk: this rewrites shiftPay, the same lines the overtime order changes.`,
  async applies(ctx) { return setPay(await ctx.read(PAY), {}) != null && (await ctx.read(ROSTER) || '').includes('export function byStaff'); },
  async run(ctx) {
    const testFile = 'test/export.test.js';
    await ctx.step('Read', `reads ${PAY}`, { file: PAY, ms: 1500 });
    if (ctx.kind === 'conflict') {
      const conflicted = await mergeMain(ctx, { [PAY]: theirs => setPay(theirs, { exact: true }) });
      const merged = await ctx.read(PAY);
      if (!detectPay(merged).exact) await ctx.edit(PAY, setPay(merged, { exact: true }), `edits ${PAY}`, 2000);
      await ctx.step('Bash', 'runs npm test', { ms: 2500 });
      return `Merged ${ctx.mainBranch}${conflicted.length ? ` and resolved ${conflicted.join(', ')}` : ''}. shiftPayExact now carries whatever pay rule main has, and shiftPay and weeklyPay round it. npm test passes.`;
    }
    const text = await ctx.read(PAY);
    const done = detectPay(text).exact && await ctx.read(EXPORT) && await ctx.read(testFile);
    if (done) return nothingLeft(ctx, 'The CSV export');
    if (heard(ctx)) ctx.say(heard(ctx));
    await ctx.step('Read', `reads ${ROSTER}`, { file: ROSTER, ms: 1500 });
    if (!detectPay(text).exact) {
      ctx.say('Summing rounded shift pay drifts by a cent over a week, so pay.js gets an unrounded shiftPayExact and a weeklyPay that rounds once.');
      await ctx.edit(PAY, setPay(text, { exact: true }), `edits ${PAY}`, 4500);
    }
    if (!await ctx.read(EXPORT)) {
      if (ctx.kind === 'first' && ctx.wantsAsk()) {
        const allowed = await ctx.permit('npm install csv-stringify');
        ctx.say(allowed
          ? 'Thanks. On a second look the quoting rule is four lines, so I wrote it by hand and left package.json alone.'
          : 'No new dependency, then. Writing the quoting by hand.');
      }
      await ctx.edit(EXPORT, EXPORT_SRC, `writes ${EXPORT}`, 5000, 'Write');
    }
    if (!await ctx.read(testFile)) await ctx.edit(testFile, EXPORT_TEST, `writes ${testFile}`, 4500, 'Write');
    await ctx.step('Bash', 'runs npm test', { ms: 2500 });
    return `Added ${EXPORT} with weeklyPayCsv(shifts, staffById): one row per staff member with name, hours and pay, and cells quoted when they hold a comma, quote or line break. ${PAY} gains shiftPayExact and weeklyPay so the weekly total rounds once; shiftPay behaves as before. No new dependency. Look closely at ${PAY}: it rewrites shiftPay, which the overtime order also changes.`;
  },
};

const RECIPES = [weeklyHours, overtime, doubleBooked, csvExport];
const key = s => String(s || '').trim().toLowerCase();

/** The recipe for a starter-order title, or null for anything else. */
export function recipeFor(title) {
  return RECIPES.find(r => key(r.title) === key(title)) || null;
}
