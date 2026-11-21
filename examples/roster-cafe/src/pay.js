/** Pay rules for the cafe. A shift has a date and "HH:MM" start and end times; money is in dollars. */

const SUNDAY = 0, SATURDAY = 6;

const minutes = time => {
  const [h, m] = time.split(':').map(Number);
  return h * 60 + m;
};

export const round2 = n => Math.round(n * 100) / 100;

/** Day of the week for a "YYYY-MM-DD" date: 0 is Sunday. */
export const dayOfWeek = date => new Date(`${date}T00:00:00Z`).getUTCDay();

/** Hours worked in one shift. */
export function shiftHours(shift) {
  return (minutes(shift.end) - minutes(shift.start)) / 60;
}

/** The penalty loading for a date. TODO: Sunday should be 1.5x; it gets the Saturday loading for now. */
export function loadingFor(date) {
  const day = dayOfWeek(date);
  return day === SATURDAY || day === SUNDAY ? 1.25 : 1;
}

/** Pay for one shift: the base rate times the day's loading. Overtime is not paid yet. */
export function shiftPay(shift, staff) {
  return round2(shiftHours(shift) * staff.rate * loadingFor(shift.date));
}

/** Total hours and pay for the shifts one staff member worked. */
export function payFor(shifts, staff) {
  let hours = 0, pay = 0;
  for (const shift of shifts) {
    hours += shiftHours(shift);
    pay += shiftPay(shift, staff);
  }
  return { hours: round2(hours), pay: round2(pay) };
}
