# roster-cafe

Rostering and pay for Little Wattle, a fictional Brisbane café. It is a small, real app: staff, shifts, a weekly roster, award-style penalty rates and a timesheet export for payroll. It has no dependencies and needs only Node 22.

```
npm start    # the roster at http://127.0.0.1:4620, restarting when a source file changes
npm test     # node --test
```

| File | What it does |
|---|---|
| `data/roster.json` | The café's staff and one week of shifts, Christmas week 2026. Read on every request |
| `src/pay.js` | Hours in a shift, the loading for a date, pay for a shift and for a week |
| `src/roster.js` | Groups shifts into the weekly roster the page shows |
| `src/timesheet.js` | The timesheet CSV for payroll |
| `src/app.js`, `server.js` | The HTTP server: `/`, `/api/roster` and `/timesheet.csv` |
| `public/index.html` | The one-page roster view |

A shift is `{ staffId, date: "YYYY-MM-DD", start: "HH:MM", end: "HH:MM" }`. Times are clock times at the café, so nothing depends on the time zone of the machine.

## Known gaps

The tests pass, and the app is wrong in ways the roster page shows. These are the orders in Ship Shift's menu for this project (`STARTER_ORDERS` in `server/demo-repo.mjs`).

| Gap | Where you see it |
|---|---|
| A shift that ends after midnight has negative hours | Raj's Thursday close shows −15.5 hours and negative pay |
| Overtime is not paid | Ben's 10 hour Wednesday is paid 10 hours at the base rate |
| Sunday is paid at the Saturday loading, 1.25x (a TODO in `src/pay.js`) | Ben, Sol and Ava's Sunday shifts |
| Public holidays are paid as ordinary days | Boxing Day, Saturday 26 December, pays the Saturday loading |
| The timesheet has one row per person and does not quote cells | Mia's role, "Supervisor, barista", pushes her hours into the wrong column |
| No wage cost per day | The roster has no footer row |
| Nothing flags a double booking (a TODO in `src/roster.js`) | Ava is rostered 11:00 to 15:00 and 14:00 to 18:00 on Thursday |

The pay rules are simplified for the demo. They are not any real award.
