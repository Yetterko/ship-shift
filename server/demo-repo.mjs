import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { git } from './git.mjs';

/**
 * The project the chefs cook in: examples/roster-cafe, a small rostering and pay app with node:test tests
 * and a one-page roster view. It is seeded with real gaps, and STARTER_ORDERS is the menu that closes them.
 */
export const EXAMPLE_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'examples', 'roster-cafe');

/**
 * The menu for roster-cafe. server/sim-scripts.mjs has a recipe for every title, so simulated chefs make the real change.
 * The comment on each order is what it exercises in the kitchen.
 */
export const STARTER_ORDERS = [
  // A one-function bug fix that is right first time.
  { title: 'Close shift shows negative hours', size: 'S', body: "Raj's Thursday close (16:00 to 00:30) shows as -15.5 hours and negative pay on the roster. A shift that runs past midnight should count its real hours. Add tests." },
  // Asks a real question (does overtime replace the weekend loading or stack on it?), and its first attempt fails its own tests.
  { title: 'Overtime after 8 hours', size: 'M', body: "Hours past 8 in a single shift should be paid at 1.5x. Ben's 10 hour Wednesday is the one to check. Add tests for 8, 10 and 12 hour shifts, and for a long Saturday." },
  // Rewrites loadingFor() in src/pay.js, the same lines as the public holiday order: a real conflict.
  { title: 'Sunday penalty rate', size: 'S', body: 'Sunday shifts are paid at the Saturday loading (1.25x). Sunday should be 1.5x. There is a TODO in src/pay.js. Add tests.' },
  // Wants to run npm install (the install jar). Rewrites the export and its tests.
  { title: 'Timesheet export for payroll', size: 'L', body: 'Payroll wants /timesheet.csv with a row per shift (date, name, role, start, end, hours, loading, pay) and a total row per person. The current file also breaks when a cell has a comma: "Supervisor, barista" pushes every column after it one to the right. Tests required.' },
  // Wants a network call (the network jar). Rewrites loadingFor() too, so it conflicts with the Sunday order.
  { title: 'Public holiday rate', size: 'M', body: 'Public holidays should pay 2.5x in place of the weekend loading. We are in Brisbane, and this roster covers Boxing Day 2026. Tests required.' },
  // Visible in the app: a new footer row on the roster page.
  { title: 'Daily wage cost on the roster', size: 'M', body: 'Add a footer row to the roster page with the wage cost of each day, next to the week total, so the manager can see which days are expensive. Work the numbers out on the server and test them.' },
  // Visible in the app too: fills the warnings list above the roster. Shares src/roster.js with the wage cost order and merges cleanly.
  { title: 'Double-booked staff warning', size: 'S', body: 'Ava is rostered 11:00 to 15:00 and 14:00 to 18:00 on Thursday and nothing flags it. Warn on the roster page when someone has two overlapping shifts. There is a TODO in src/roster.js. Tests required.' },
];

/** When each starter order walks up in the demo, in seconds at the demo's pace of 8, in STARTER_ORDERS order. */
export const DEMO_ARRIVALS_S = [0, 10, 25, 45, 70, 95, 120];

/** Copies a directory of text files, writing LF line endings so the demo's diffs and merges are the same on every machine. */
async function copyText(from, to) {
  await fs.mkdir(to, { recursive: true });
  for (const entry of await fs.readdir(from, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === '.git') continue;
    const src = path.join(from, entry.name), dest = path.join(to, entry.name);
    if (entry.isDirectory()) await copyText(src, dest);
    else await fs.writeFile(dest, (await fs.readFile(src, 'utf8')).replace(/\r\n/g, '\n'));
  }
}

/** Creates the example project at dir as its own git repo with one commit. Returns false when a repo is already there. */
export async function ensureDemoRepo(dir) {
  // Check for the repo's own .git, since the demo lives inside the Ship Shift checkout, which is a repo too.
  if (await fs.stat(path.join(dir, '.git')).then(() => true, () => false)) return false;
  await copyText(EXAMPLE_DIR, dir);
  await git(dir, ['init', '-q', '-b', 'main']);
  // Keep line endings as written.
  await git(dir, ['config', 'core.autocrlf', 'false']);
  await git(dir, ['add', '-A']);
  await git(dir, ['-c', 'user.name=Ship Shift', '-c', 'user.email=pass@ship-shift.local', 'commit', '-q', '-m', 'Start of service']);
  return true;
}
