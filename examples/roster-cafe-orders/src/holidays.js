/**
 * Queensland public holidays for 2026, as they apply in Brisbane.
 * The table is checked in so that pay never depends on a network call. Add each new year before its first roster.
 */
const HOLIDAYS = {
  '2026-01-01': "New Year's Day",
  '2026-01-26': 'Australia Day',
  '2026-04-03': 'Good Friday',
  '2026-04-04': 'The day after Good Friday',
  '2026-04-05': 'Easter Sunday',
  '2026-04-06': 'Easter Monday',
  '2026-04-25': 'Anzac Day',
  '2026-05-04': 'Labour Day',
  '2026-08-12': 'Royal Queensland Show (Brisbane)',
  '2026-10-05': "King's Birthday",
  '2026-12-25': 'Christmas Day',
  '2026-12-26': 'Boxing Day',
  '2026-12-28': 'Boxing Day (additional day)',
};

/** The public holiday's name for a "YYYY-MM-DD" date, or null on an ordinary day. */
export const publicHoliday = date => HOLIDAYS[date] ?? null;
