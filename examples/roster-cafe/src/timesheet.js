import { byStaff } from './roster.js';
import { payFor } from './pay.js';

/** Timesheet CSV for payroll: one row per staff member with the week's hours and pay. */
export function timesheetCsv({ staff, shifts }) {
  const mine = byStaff(shifts);
  const rows = [['name', 'role', 'hours', 'pay']];
  for (const person of staff) {
    const { hours, pay } = payFor(mine[person.id] || [], person);
    rows.push([person.name, person.role, hours, pay.toFixed(2)]);
  }
  return rows.map(row => row.join(',')).join('\n') + '\n';
}
