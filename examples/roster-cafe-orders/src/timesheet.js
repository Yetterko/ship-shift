import { byStaff } from './roster.js';
import { shiftHours, shiftPay, loadingFor, payFor } from './pay.js';

const HEADER = ['date', 'name', 'role', 'start', 'end', 'hours', 'loading', 'pay'];

/** Quotes a CSV cell when it holds a comma, a quote or a line break. */
const cell = value => {
  const text = String(value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
};

/** Timesheet CSV for payroll: a row per shift in date order, then a Total row for each staff member who worked. */
export function timesheetCsv({ staff, shifts }) {
  const unknown = shifts.find(shift => !staff.some(person => person.id === shift.staffId));
  if (unknown) throw new Error(`No staff record for ${unknown.staffId}`);
  const mine = byStaff(shifts);
  const rows = [HEADER];
  for (const person of staff) {
    const own = (mine[person.id] || []).toSorted((a, b) => (a.date + a.start).localeCompare(b.date + b.start));
    if (!own.length) continue;
    for (const shift of own) {
      rows.push([shift.date, person.name, person.role, shift.start, shift.end, shiftHours(shift), loadingFor(shift.date), shiftPay(shift, person).toFixed(2)]);
    }
    const { hours, pay } = payFor(own, person);
    rows.push(['Total', person.name, person.role, '', '', hours, '', pay.toFixed(2)]);
  }
  return rows.map(row => row.map(cell).join(',')).join('\n') + '\n';
}
