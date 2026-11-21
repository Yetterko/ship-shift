import test from 'node:test';
import assert from 'node:assert/strict';
import { weekView } from '../src/roster.js';

const view = weekView({
  cafe: 'Test Cafe',
  weekStart: '2026-11-16',
  staff: [{ id: 'a', name: 'Ada Park', role: 'Barista', rate: 30 }, { id: 'b', name: 'Bo Reyes', role: 'Cook', rate: 32 }],
  shifts: [
    { staffId: 'a', date: '2026-11-16', start: '09:00', end: '17:00' },
    { staffId: 'b', date: '2026-11-16', start: '06:00', end: '12:00' },
    { staffId: 'a', date: '2026-11-21', start: '07:00', end: '13:00' },
  ],
});

test('each day carries the wages of everyone rostered on it', () => {
  assert.deepEqual(view.days.map(day => day.cost), [432, 0, 0, 0, 0, 225, 0]);
});

test('the daily costs add up to the week total', () => {
  assert.equal(view.days.reduce((sum, day) => sum + day.cost, 0), view.total.pay);
});
