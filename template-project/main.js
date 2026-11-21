// Wires the page together: loads the data, renders the roster, runs the self-checks.
import { renderRoster, renderChecks } from './ui.js';
import { runChecks } from './checks.js';

async function load(path) {
  const res = await fetch(path, { cache: 'no-store' });
  return res.json();
}

async function start() {
  const [staff, shifts] = await Promise.all([load('data/staff.json'), load('data/shifts.json')]);
  renderRoster(staff, shifts);
  renderChecks(runChecks({ staff, shifts, document }));
  document.body.dataset.ready = '1';
}

start();
