# roster-cafe-orders

The whole files that Ship Shift's simulated chefs write into `roster-cafe` when they cook an order: new tests, `src/holidays.js` and the rewritten timesheet export. `server/sim-scripts.mjs` reads them from here and makes the smaller edits to existing files itself.

They are kept as real files so they can be read, linted and run. Real agents never see this directory: `ensureDemoRepo` copies only `examples/roster-cafe`.
