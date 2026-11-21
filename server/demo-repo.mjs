import fs from 'node:fs/promises';
import path from 'node:path';
import { git } from './git.mjs';

/** A small, real project for the chefs to cook in: shift pay and rostering, with node:test tests. */
const FILES = {
  'package.json': JSON.stringify({ name: 'demo-roster', version: '0.1.0', type: 'module', scripts: { test: 'node --test' } }, null, 2) + '\n',
  'README.md': '# demo-roster\n\nShift pay and rostering helpers. Run `npm test`.\n',
  'src/pay.js': `/** Hours between two ISO timestamps. */
export function shiftHours(shift) {
  const ms = new Date(shift.end) - new Date(shift.start);
  return ms / 36e5;
}

/** Pay for one shift at the staff member's base rate. Overtime is not handled yet. */
export function shiftPay(shift, staff) {
  return round2(shiftHours(shift) * staff.rate);
}

export function weeklyHours(shifts) {
  let total = 0;
  for (let i = 0; i <= shifts.length; i++) {
    total += shiftHours(shifts[i]);
  }
  return total;
}

export const round2 = n => Math.round(n * 100) / 100;
`,
  'src/roster.js': `/** Groups shifts by staff id. */
export function byStaff(shifts) {
  const out = {};
  for (const s of shifts) (out[s.staffId] ||= []).push(s);
  return out;
}

/** True when two shifts overlap in time. */
export function overlaps(a, b) {
  return new Date(a.start) < new Date(b.end) && new Date(b.start) < new Date(a.end);
}
`,
  'test/pay.test.js': `import test from 'node:test';
import assert from 'node:assert/strict';
import { shiftHours, shiftPay } from '../src/pay.js';

const shift = { start: '2026-11-20T09:00:00Z', end: '2026-11-20T17:00:00Z' };

test('shiftHours counts an 8 hour shift', () => {
  assert.equal(shiftHours(shift), 8);
});

test('shiftPay pays the base rate', () => {
  assert.equal(shiftPay(shift, { rate: 30 }), 240);
});
`,
  'test/roster.test.js': `import test from 'node:test';
import assert from 'node:assert/strict';
import { overlaps } from '../src/roster.js';

test('overlapping shifts are detected', () => {
  assert.equal(overlaps(
    { start: '2026-11-20T09:00:00Z', end: '2026-11-20T13:00:00Z' },
    { start: '2026-11-20T12:00:00Z', end: '2026-11-20T16:00:00Z' }), true);
});
`,
  '.gitignore': 'node_modules\n',
};

export const STARTER_ORDERS = [
  { title: 'Weekly hours crashes', body: 'weeklyHours() in src/pay.js throws for every roster. Fix it and add a test, including an empty roster.', size: 'S' },
  { title: 'Overtime pay', body: 'shiftPay should pay 1.5x the base rate for any hours past 8 in a single shift. Add tests for 8, 10 and 12 hour shifts.', size: 'M' },
  { title: 'Double-booked staff report', body: 'Add a function doubleBookings(shifts) in src/roster.js that returns pairs of overlapping shifts for the same staff member. Tests required.', size: 'M' },
  { title: 'Weekly pay CSV export', body: 'Add src/export.js with weeklyPayCsv(shifts, staffById) returning CSV: staff name, hours, pay. Handle commas in names. Tests required.', size: 'L' },
];

export async function ensureDemoRepo(dir) {
  // Check for the repo's own .git, since the demo lives inside the Ship Shift checkout, which is a repo too.
  if (await fs.stat(path.join(dir, '.git')).then(() => true, () => false)) return false;
  await fs.mkdir(dir, { recursive: true });
  for (const [rel, body] of Object.entries(FILES)) {
    const p = path.join(dir, rel);
    await fs.mkdir(path.dirname(p), { recursive: true });
    await fs.writeFile(p, body);
  }
  await git(dir, ['init', '-q', '-b', 'main']);
  // Keep line endings as written, so the demo's diffs and merges are the same on every machine.
  await git(dir, ['config', 'core.autocrlf', 'false']);
  await git(dir, ['add', '-A']);
  await git(dir, ['-c', 'user.name=Ship Shift', '-c', 'user.email=pass@ship-shift.local', 'commit', '-q', '-m', 'Start of service']);
  return true;
}
