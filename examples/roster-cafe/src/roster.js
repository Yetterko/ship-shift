import { shiftHours, shiftPay, payFor, round2 } from './pay.js';

export const DAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

/** The seven dates of the week that starts on weekStart, a "YYYY-MM-DD" Monday. */
export function weekDates(weekStart) {
  const start = Date.parse(`${weekStart}T00:00:00Z`);
  return Array.from({ length: 7 }, (_, i) => new Date(start + i * 864e5).toISOString().slice(0, 10));
}

/** Groups shifts by staff id. */
export function byStaff(shifts) {
  const out = {};
  for (const shift of shifts) (out[shift.staffId] ||= []).push(shift);
  return out;
}

/** Everything the roster page shows: one row per staff member with a cell per day, and the week's totals. */
export function weekView({ cafe, weekStart, staff, shifts }) {
  const dates = weekDates(weekStart);
  const mine = byStaff(shifts);
  const rows = staff.map(person => {
    const own = mine[person.id] || [];
    const cell = date => own.filter(s => s.date === date)
      .map(s => ({ start: s.start, end: s.end, hours: shiftHours(s), pay: shiftPay(s, person) }));
    return { id: person.id, name: person.name, role: person.role, days: dates.map(cell), ...payFor(own, person) };
  });
  return {
    cafe,
    weekStart,
    days: dates.map((date, i) => ({ date, name: DAY_NAMES[i] })),
    rows,
    total: { hours: round2(rows.reduce((sum, row) => sum + row.hours, 0)), pay: round2(rows.reduce((sum, row) => sum + row.pay, 0)) },
    // TODO: warn when someone is rostered on two overlapping shifts.
    warnings: [],
  };
}
