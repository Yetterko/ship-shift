import test from 'node:test';
import assert from 'node:assert/strict';
import { doubleBookings, weekView } from '../src/roster.js';

const lunch = { staffId: 'a', date: '2026-11-19', start: '11:00', end: '15:00' };
const afternoon = { staffId: 'a', date: '2026-11-19', start: '14:00', end: '18:00' };

test('two overlapping shifts for one person are a double booking', () => {
  assert.deepEqual(doubleBookings([lunch, afternoon]), [[lunch, afternoon]]);
});

test('the same hours for two different people are fine', () => {
  assert.deepEqual(doubleBookings([lunch, { ...afternoon, staffId: 'b' }]), []);
});

test('back-to-back shifts are fine', () => {
  assert.deepEqual(doubleBookings([lunch, { ...afternoon, start: '15:00' }]), []);
});

test('the same hours on different days are fine', () => {
  assert.deepEqual(doubleBookings([lunch, { ...afternoon, date: '2026-11-20' }]), []);
});

test('the roster warns about a double booking by name', () => {
  const view = weekView({ cafe: 'Test Cafe', weekStart: '2026-11-16', staff: [{ id: 'a', name: 'Ada Park', role: 'Barista', rate: 30 }], shifts: [lunch, afternoon] });
  assert.deepEqual(view.warnings, ['Ada Park is double-booked on 2026-11-19: 11:00 to 15:00 and 14:00 to 18:00']);
});
