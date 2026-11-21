import test from 'node:test';
import assert from 'node:assert/strict';
import { publicHoliday } from '../src/holidays.js';
import { loadingFor, shiftPay } from '../src/pay.js';

test('publicHoliday names the holiday, or is null on an ordinary day', () => {
  assert.equal(publicHoliday('2026-12-25'), 'Christmas Day');
  assert.equal(publicHoliday('2026-12-24'), null);
});

test('a public holiday is 2.5x', () => {
  assert.equal(loadingFor('2026-12-25'), 2.5);
});

test('a holiday on a Saturday pays the holiday loading, not the Saturday one', () => {
  assert.equal(loadingFor('2026-12-26'), 2.5);
  assert.equal(loadingFor('2026-12-19'), 1.25);
});

test('a 6 hour Boxing Day shift at $30 pays $450', () => {
  assert.equal(shiftPay({ date: '2026-12-26', start: '07:00', end: '13:00' }, { rate: 30 }), 450);
});
