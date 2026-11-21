// In-browser self-checks, shown on the page as green ticks. Add one per feature with check(name, fn).
const registered = [];

/**
 * Registers a self-check. fn gets { staff, shifts, document } and returns true when it passes.
 * @param {string} name
 * @param {(ctx:{staff:object[], shifts:object[], document:Document}) => boolean} fn
 */
export function check(name, fn) {
  registered.push({ name, fn });
}

/** Runs every registered check. A check that throws fails. */
export function runChecks(ctx) {
  return registered.map(({ name, fn }) => {
    let pass = false;
    try { pass = fn(ctx) === true; } catch { pass = false; }
    return { name, pass };
  });
}

check('The roster renders a row for every staff member', ({ staff, document }) =>
  document.querySelectorAll('#roster tbody tr').length === staff.length);

check('Every shift has a staff member', ({ staff, shifts }) =>
  shifts.every(shift => staff.some(person => person.id === shift.staffId)));
