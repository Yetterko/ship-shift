// Pure business logic: no DOM code here.

/**
 * Every shift one staff member works.
 * @param {string} staffId
 * @param {{id:string, staffId:string, day:string, start:string, end:string}[]} shifts
 * @returns {{id:string, staffId:string, day:string, start:string, end:string}[]}
 */
export function getShiftsFor(staffId, shifts) {
  return shifts.filter(shift => shift.staffId === staffId);
}

/**
 * A shift as the roster shows it.
 * @param {{start:string, end:string}} shift
 * @returns {string} e.g. "09:00-15:00"
 */
export function formatShift(shift) {
  return `${shift.start}-${shift.end}`;
}
