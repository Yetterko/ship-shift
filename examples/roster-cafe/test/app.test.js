import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/app.js';

/** Starts the app on a free port, with the real roster file, for one test. */
async function withApp(run) {
  const app = createApp();
  await new Promise(resolve => app.listen(0, '127.0.0.1', resolve));
  try { await run(`http://127.0.0.1:${app.address().port}`); } finally { app.close(); }
}

test('the roster page and its data are served', () => withApp(async base => {
  const page = await fetch(base + '/');
  assert.match(page.headers.get('content-type'), /text\/html/);
  assert.match(await page.text(), /<table id="roster">/);
  const view = await (await fetch(base + '/api/roster')).json();
  assert.equal(view.cafe, 'Little Wattle');
  assert.equal(view.days.length, 7);
  assert.equal(view.rows.length, 5);
}));

test('the timesheet downloads as CSV', () => withApp(async base => {
  const res = await fetch(base + '/timesheet.csv');
  assert.match(res.headers.get('content-type'), /text\/csv/);
  assert.match(await res.text(), /Mia Tran/);
}));

test('an unknown path is a 404', () => withApp(async base => {
  assert.equal((await fetch(base + '/nope')).status, 404);
}));
