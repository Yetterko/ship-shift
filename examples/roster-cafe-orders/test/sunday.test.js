import test from 'node:test';
import assert from 'node:assert/strict';
import { loadingFor, shiftPay } from '../src/pay.js';

test('Sunday is 1.5x', () => {
  assert.equal(loadingFor('2026-11-22'), 1.5);
});

test('Saturday stays 1.25x and a weekday has no loading', () => {
  assert.equal(loadingFor('2026-11-21'), 1.25);
  assert.equal(loadingFor('2026-11-20'), 1);
});

test('a 4 hour Sunday shift at $30 pays $180', () => {
  assert.equal(shiftPay({ date: '2026-11-22', start: '08:00', end: '12:00' }, { rate: 30 }), 180);
});
