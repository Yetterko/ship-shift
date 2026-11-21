// The demo project: roster-cafe, a small rostering and pay app for the fictional Little Wattle cafe.
// Every visitor's restaurant gets its own git copy of examples/roster-cafe, and the five customers below queue outside.
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { git } from '../git.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const PROJECT_DIR = path.join(root, 'examples', 'roster-cafe');
export const SOLUTIONS_DIR = path.join(root, 'examples', 'roster-cafe-orders');
export const PROJECT_NAME = 'Little Wattle roster';

async function copyTree(from, to) {
  await fs.mkdir(to, { recursive: true });
  for (const entry of await fs.readdir(from, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === '.git') continue;
    const a = path.join(from, entry.name), b = path.join(to, entry.name);
    if (entry.isDirectory()) await copyTree(a, b);
    else await fs.writeFile(b, (await fs.readFile(a, 'utf8')).replace(/\r\n/g, '\n'));
  }
}

/** Makes `dir` a fresh git repo holding the example project, with one commit on main. Returns false when it already is one. */
export async function ensureProjectRepo(dir) {
  if (await fs.stat(path.join(dir, '.git')).then(() => true, () => false)) return false;
  await copyTree(PROJECT_DIR, dir);
  await git(dir, ['init', '-q', '-b', 'main']);
  await git(dir, ['config', 'core.autocrlf', 'false']);
  await git(dir, ['add', '-A']);
  await git(dir, ['-c', 'user.name=Ship Shift', '-c', 'user.email=pass@ship-shift.local', 'commit', '-q', '-m', 'Start of service']);
  return true;
}

/**
 * The line outside, in order. Mia, Raj, Sol and Ava work at the cafe (see data/roster.json); Priya and Rosa are fictional too.
 * Each preset lists the files it touches; recipes in sim-scripts.mjs keep every pair of orders merging cleanly.
 */
export const CUSTOMERS = [
  {
    key: 'CAFE-101', title: 'Sunday shifts are underpaid', difficulty: 'S', labels: ['bug', 'payroll'],
    persona: { name: 'Mia Tran', role: 'Supervisor', strictness: 1, color: '#e8a25c' },
    body: 'Sunday shifts are paid at the Saturday rate. Our award says Sundays are time and a half.',
    acceptance: ['loadingFor returns 1.5 for a Sunday', 'Saturday stays 1.25 and weekdays stay 1', 'Tests cover a 4 hour Sunday shift at $30 paying $180'],
    presets: [
      { id: '101-backend', station: 'backend', estMs: 12000, prompt: 'In src/pay.js, make loadingFor return 1.5 for Sundays while Saturday stays 1.25 and weekdays stay 1. Add test/sunday.test.js, including a 4 hour Sunday shift at $30 paying $180.' },
    ],
  },
  {
    key: 'CAFE-102', title: 'My late close shows negative hours', difficulty: 'M', labels: ['bug', 'roster page'],
    persona: { name: 'Raj Patel', role: 'Front of house', strictness: 2, color: '#6cc3c9' },
    body: 'My Christmas Eve close runs 16:00 to 00:30 and the roster shows minus hours and minus pay. The page also makes it look like it ends that same morning.',
    acceptance: ['shiftHours counts shifts that end after midnight (16:00 to 00:30 is 8.5 hours, 18:00 to 00:00 is 6 hours)', 'Tests cover both cases', 'The roster page marks an end time past midnight with "(+1 day)"'],
    presets: [
      { id: '102-backend', station: 'backend', estMs: 16000, prompt: 'Fix shiftHours in src/pay.js so a shift that ends after midnight counts the hours past midnight (16:00 to 00:30 is 8.5 h; 18:00 to 00:00 is 6 h). Add test/close-shift.test.js.' },
      { id: '102-frontend', station: 'frontend', estMs: 14000, prompt: 'On the roster page (public/index.html), show "(+1 day)" after an end time that finishes after midnight.' },
    ],
  },
  {
    key: 'CAFE-103', title: 'Ava is double-booked on Christmas Eve and nobody noticed', difficulty: 'M', labels: ['feature', 'roster'],
    persona: { name: 'Sol Marino', role: 'Cook', strictness: 2, color: '#9fc46a' },
    body: 'Ava is rostered 11:00 to 15:00 and 14:00 to 18:00 on the 24th. The roster should warn us when someone is booked on two overlapping shifts.',
    acceptance: ['weekView returns one warning per pair of overlapping shifts for the same person, naming them, the day and both times', 'Tests cover an overlap and a non-overlap', 'Warnings stand out on the roster page'],
    presets: [
      { id: '103-backend', station: 'backend', estMs: 15000, prompt: 'In src/roster.js, make weekView fill warnings with one message per pair of overlapping shifts for the same person, e.g. "Ava Lindqvist is double-booked on Thu 24 Dec: 11:00-15:00 and 14:00-18:00". Add test/warnings.test.js.' },
      { id: '103-frontend', station: 'frontend', estMs: 12000, prompt: 'On the roster page, show the warnings list as a red banner so it stands out (style only).' },
    ],
  },
  {
    key: 'CAFE-104', title: 'Christmas week needs public holiday rates', difficulty: 'L', labels: ['feature', 'payroll'],
    persona: { name: 'Priya Shah', role: 'Area manager', strictness: 3, color: '#c98bd6' },
    body: 'Christmas Day and Boxing Day are in this roster week. Public holidays pay 2.5x, even when they fall on a Saturday, and the roster should show which days are holidays.',
    acceptance: ['src/holidays.js lists the 2026 Queensland public holidays with publicHoliday(date)', 'loadingFor pays 2.5 on a public holiday, even on a Saturday', 'Tests include a 6 hour Boxing Day shift at $30 paying $450', 'Public holiday columns on the roster page show the holiday name'],
    presets: [
      { id: '104-database', station: 'database', estMs: 10000, prompt: 'Add src/holidays.js with the 2026 Queensland public holidays and publicHoliday(date), which returns the holiday name or null. Add test/holidays-table.test.js.' },
      { id: '104-backend', station: 'backend', estMs: 16000, prompt: 'Make loadingFor in src/pay.js pay 2.5 on public holidays (use publicHoliday from src/holidays.js), even on a Saturday. Add test/holidays.test.js, including a 6 hour Boxing Day shift at $30 paying $450.' },
      { id: '104-frontend', station: 'frontend', estMs: 12000, prompt: 'On the roster page, label public holiday columns in the header with the holiday name.' },
    ],
  },
  {
    key: 'CAFE-105', title: 'Payroll needs a timesheet row per shift', difficulty: 'M', labels: ['integration', 'payroll'],
    persona: { name: 'Rosa Nguyen', role: 'Payroll', strictness: 3, color: '#ee8fa6' },
    body: 'Our payroll import wants one row per shift, not one per person, with the loading on each row and a total per person.',
    acceptance: ['timesheetCsv writes a header date,name,role,start,end,hours,loading,pay then one row per shift in date order', 'A Total row follows each person who worked', 'Cells with commas or quotes are quoted; an unknown staff id throws', 'Tests cover all of the above'],
    presets: [
      { id: '105-integration', station: 'integration', estMs: 16000, prompt: 'Rewrite timesheetCsv in src/timesheet.js: one row per shift in date order (date,name,role,start,end,hours,loading,pay), then a Total row per person; quote cells with commas or quotes; throw for an unknown staff id. Update test/timesheet.test.js.' },
      { id: '105-backend', station: 'backend', estMs: 13000, prompt: "Add each day's wage cost to weekView().days[].cost in src/roster.js (data only). Add test/day-cost.test.js." },
    ],
  },
];

const ANY = presets => ids => presets.every(p => ids.includes(p));

/**
 * The scripted customer: what each one says, given which specials have been served and whether the table's tests pass.
 * Returns the same shape as a real Claude review.
 */
export function scriptedReview(customer, servedPresets, testsOk) {
  const has = id => servedPresets.includes(id);
  const missingOf = ids => customer.presets.filter(p => ids.includes(p.id) && !has(p.id)).map(p => ({ station: p.station, prompt: p.prompt }));
  const fail = { verdict: 'needs_more', satisfaction: 2, feedback: "The tests are failing on what you brought me. I can't sign off on that.", missing: [] };
  if (!testsOk) return fail;
  // A ticket the waiter wrote themselves has no script: a review only runs after a serve, so call it done.
  if (!customer.presets.length) return { verdict: 'satisfied', satisfaction: 4, feedback: 'Looks like what I asked for. Thanks.', missing: [] };
  switch (customer.key) {
    case 'CAFE-101':
      return has('101-backend')
        ? { verdict: 'satisfied', satisfaction: 5, feedback: "Sunday pay's right now, cheers! Bill please.", missing: [] }
        : { verdict: 'needs_more', satisfaction: 2, feedback: 'Sundays still pay the Saturday rate.', missing: missingOf(['101-backend']) };
    case 'CAFE-102':
      if (has('102-backend') && has('102-frontend')) return { verdict: 'satisfied', satisfaction: 5, feedback: 'Eight and a half hours, paid properly, and the page says it ends the next day. Perfect.', missing: [] };
      if (has('102-backend')) return { verdict: 'needs_more', satisfaction: 3, feedback: 'Hours add up now, but the roster still makes my close look like it ends that same morning.', missing: missingOf(['102-frontend']) };
      return { verdict: 'needs_more', satisfaction: 2, feedback: 'The page is nicer, but my hours are still negative.', missing: missingOf(['102-backend']) };
    case 'CAFE-103':
      if (has('103-backend') && has('103-frontend')) return { verdict: 'satisfied', satisfaction: 5, feedback: "Nobody's missing that warning now. Great.", missing: [] };
      if (has('103-backend')) return { verdict: 'satisfied', satisfaction: 4, feedback: 'I can see the warning now. Would be good if it stood out more.', missing: missingOf(['103-frontend']) };
      return { verdict: 'needs_more', satisfaction: 2, feedback: "A red banner with nothing in it doesn't help. It still doesn't spot Ava's clash.", missing: missingOf(['103-backend']) };
    case 'CAFE-104': {
      const all = ['104-database', '104-backend', '104-frontend'];
      if (ANY(all)(servedPresets)) return { verdict: 'satisfied', satisfaction: 5, feedback: 'Holiday rates, holiday labels, and a proper table behind them. That is exactly it.', missing: [] };
      const left = missingOf(all);
      return { verdict: 'needs_more', satisfaction: 3, feedback: `Getting there, but I asked for the whole thing. Still missing: ${left.map(m => m.station).join(', ')}.`, missing: left };
    }
    case 'CAFE-105':
      if (has('105-integration') && has('105-backend')) return { verdict: 'satisfied', satisfaction: 5, feedback: "That's the format our payroll import wants, and the daily costs are a bonus.", missing: [] };
      if (has('105-integration')) return { verdict: 'satisfied', satisfaction: 4, feedback: "That's the format our payroll import wants.", missing: missingOf(['105-backend']) };
      return { verdict: 'needs_more', satisfaction: 2, feedback: 'Daily costs are nice, but the timesheet is still one row per person.', missing: missingOf(['105-integration']) };
  }
  return { verdict: 'satisfied', satisfaction: 4, feedback: 'Looks good to me.', missing: [] };
}
