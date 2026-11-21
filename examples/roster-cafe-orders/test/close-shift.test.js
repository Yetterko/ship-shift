import test from 'node:test';
import assert from 'node:assert/strict';
import { shiftHours, shiftPay } from '../src/pay.js';

test('a close that runs past midnight counts the hours on both sides of it', () => {
  assert.equal(shiftHours({ date: '2026-11-19', start: '16:00', end: '00:30' }), 8.5);
});

test('a shift that ends exactly at midnight', () => {
  assert.equal(shiftHours({ date: '2026-11-19', start: '18:00', end: '00:00' }), 6);
});

test('a daytime shift is counted as before', () => {
  assert.equal(shiftHours({ date: '2026-11-19', start: '06:30', end: '14:30' }), 8);
});

test('a close is paid for its real hours', () => {
  assert.equal(shiftPay({ date: '2026-11-19', start: '16:00', end: '00:30' }, { rate: 29 }), 246.5);
});
