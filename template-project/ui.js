// Builds the page. Data shapes are described in data/schema.md.
import { getShiftsFor, formatShift } from './api.js';

export const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

/**
 * Fills the roster table: one row per staff member, one column per day. Cells carry data-shift="<shift id>".
 * @param {{id:string, name:string}[]} staff
 * @param {{id:string, staffId:string, day:string, start:string, end:string}[]} shifts
 */
export function renderRoster(staff, shifts) {
  const table = document.getElementById('roster');
  const head = DAYS.map(day => `<th scope="col">${day}</th>`).join('');
  const rows = staff.map(person => {
    const mine = getShiftsFor(person.id, shifts);
    const cells = DAYS.map(day => {
      const shift = mine.find(s => s.day === day);
      return shift ? `<td class="shift" data-shift="${shift.id}">${formatShift(shift)}</td>` : '<td></td>';
    }).join('');
    return `<tr><th scope="row">${person.name}</th>${cells}</tr>`;
  }).join('');
  table.innerHTML = `<thead><tr><th scope="col">Staff</th>${head}</tr></thead><tbody>${rows}</tbody>`;
}

/**
 * Shows the self-check results as ticks and crosses.
 * @param {{name:string, pass:boolean}[]} results
 */
export function renderChecks(results) {
  document.getElementById('checks').innerHTML = results
    .map(r => `<li class="${r.pass ? 'pass' : 'fail'}">${r.name}</li>`).join('');
}
