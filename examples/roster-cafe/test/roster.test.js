import test from 'node:test';
import assert from 'node:assert/strict';
import { weekDates, byStaff, weekView } from '../src/roster.js';

const roster = {
  cafe: 'Test Cafe',
  weekStart: '2026-11-16',
  staff: [{ id: 'a', name: 'Ada Park', role: 'Barista', rate: 30 }, { id: 'b', name: 'Bo Reyes', role: 'Cook', rate: 32 }],
  shifts: [
    { staffId: 'a', date: '2026-11-16', start: '09:00', end: '17:00' },
    { staffId: 'a', date: '2026-11-21', start: '07:00', end: '13:00' },
    { staffId: 'b', date: '2026-11-16', start: '06:00', end: '12:00' },
  ],
};

test('weekDates runs Monday to Sunday across a year end', () => {
  assert.deepEqual(weekDates('2026-12-28'), ['2026-12-28', '2026-12-29', '2026-12-30', '2026-12-31', '2027-01-01', '2027-01-02', '2027-01-03']);
});

test('byStaff groups shifts by staff id', () => {
  assert.deepEqual(Object.keys(byStaff(roster.shifts)), ['a', 'b']);
  assert.equal(byStaff(roster.shifts).a.length, 2);
});

test('weekView has a row per staff member and a cell per day', () => {
  const view = weekView(roster);
  assert.deepEqual(view.days.map(d => d.name), ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']);
  assert.deepEqual(view.rows.map(r => r.name), ['Ada Park', 'Bo Reyes']);
  assert.deepEqual(view.rows[0].days[0], [{ start: '09:00', end: '17:00', hours: 8, pay: 240 }]);
  assert.deepEqual(view.rows[0].days[1], []);
});

test('weekView totals each person and the week', () => {
  const view = weekView(roster);
  assert.equal(view.rows[0].hours, 14);
  assert.equal(view.rows[0].pay, 465);
  assert.deepEqual(view.total, { hours: 20, pay: 657 });
});
