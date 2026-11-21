import test from 'node:test';
import assert from 'node:assert/strict';
import { shiftHours, loadingFor, shiftPay, payFor } from '../src/pay.js';

const weekday = { date: '2026-11-18', start: '09:00', end: '17:00' };
const saturday = { date: '2026-11-21', start: '07:00', end: '13:00' };

test('shiftHours counts whole and half hours', () => {
  assert.equal(shiftHours(weekday), 8);
  assert.equal(shiftHours({ date: '2026-11-18', start: '08:00', end: '12:30' }), 4.5);
});

test('a weekday has no loading and Saturday is 1.25x', () => {
  assert.equal(loadingFor('2026-11-18'), 1);
  assert.equal(loadingFor('2026-11-21'), 1.25);
});

test('shiftPay is hours times rate times loading', () => {
  assert.equal(shiftPay(weekday, { rate: 30 }), 240);
  assert.equal(shiftPay(saturday, { rate: 30 }), 225);
});

test('payFor totals hours and pay, rounded to cents', () => {
  assert.deepEqual(payFor([weekday, saturday], { rate: 27.33 }), { hours: 14, pay: 423.62 });
});
