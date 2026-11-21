import test from 'node:test';
import assert from 'node:assert/strict';
import { timesheetCsv } from '../src/timesheet.js';

const staff = [{ id: 'a', name: 'Ada Park', role: 'Barista', rate: 30 }, { id: 'b', name: 'Bo Reyes', role: 'Cook', rate: 32 }];
const shifts = [
  { staffId: 'a', date: '2026-11-16', start: '09:00', end: '17:00' },
  { staffId: 'a', date: '2026-11-17', start: '09:00', end: '13:30' },
  { staffId: 'b', date: '2026-11-16', start: '06:00', end: '12:00' },
];

test('one row per staff member with hours and pay', () => {
  assert.equal(timesheetCsv({ staff, shifts }), 'name,role,hours,pay\nAda Park,Barista,12.5,375.00\nBo Reyes,Cook,6,192.00\n');
});

test('someone with no shifts still gets a row', () => {
  assert.equal(timesheetCsv({ staff, shifts: [] }).split('\n')[1], 'Ada Park,Barista,0,0.00');
});
