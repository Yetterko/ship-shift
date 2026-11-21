import test from 'node:test';
import assert from 'node:assert/strict';
import { timesheetCsv } from '../src/timesheet.js';

const staff = [
  { id: 'a', name: 'Ada Park', role: 'Barista', rate: 30 },
  { id: 'b', name: 'Bo Reyes', role: 'Cook, weekends', rate: 32 },
  { id: 'c', name: 'Cy Young', role: 'Kitchen hand', rate: 27.5 },
];
const shifts = [
  { staffId: 'a', date: '2026-11-17', start: '09:00', end: '13:30' },
  { staffId: 'b', date: '2026-11-21', start: '06:00', end: '12:00' },
  { staffId: 'a', date: '2026-11-16', start: '09:00', end: '17:00' },
];

test('a row per shift in date order, then a total for each person who worked', () => {
  assert.equal(timesheetCsv({ staff, shifts }), [
    'date,name,role,start,end,hours,loading,pay',
    '2026-11-16,Ada Park,Barista,09:00,17:00,8,1,240.00',
    '2026-11-17,Ada Park,Barista,09:00,13:30,4.5,1,135.00',
    'Total,Ada Park,Barista,,,12.5,,375.00',
    '2026-11-21,Bo Reyes,"Cook, weekends",06:00,12:00,6,1.25,240.00',
    'Total,Bo Reyes,"Cook, weekends",,,6,,240.00',
    '',
  ].join('\n'));
});

test('a quote in a name is doubled and the cell is quoted', () => {
  const csv = timesheetCsv({ staff: [{ ...staff[0], name: 'Ada "Sparky" Park' }], shifts: [shifts[2]] });
  assert.equal(csv.split('\n')[1], '2026-11-16,"Ada ""Sparky"" Park",Barista,09:00,17:00,8,1,240.00');
});

test('an empty roster is only the header', () => {
  assert.equal(timesheetCsv({ staff, shifts: [] }), 'date,name,role,start,end,hours,loading,pay\n');
});

test('a shift for someone with no staff record is an error, not a missing row', () => {
  assert.throws(() => timesheetCsv({ staff: [staff[0]], shifts }), /No staff record for b/);
});
