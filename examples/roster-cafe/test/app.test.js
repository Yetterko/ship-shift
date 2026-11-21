import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createApp } from '../src/app.js';

// One app for the file, on a free port, reading the real roster.
const app = createApp();
before(() => new Promise(resolve => app.listen(0, '127.0.0.1', resolve)));
after(() => { app.close(); app.closeAllConnections(); });

// http.get and not fetch: fetch refuses some port numbers, and a free port can be one of them.
const get = path => new Promise((resolve, reject) => {
  http.get({ host: '127.0.0.1', port: app.address().port, path }, res => {
    let body = '';
    res.setEncoding('utf8');
    res.on('data', chunk => { body += chunk; });
    res.on('end', () => resolve({ status: res.statusCode, type: res.headers['content-type'], body }));
  }).on('error', reject);
});

test('the roster page and its data are served', async () => {
  const page = await get('/');
  assert.match(page.type, /text\/html/);
  assert.match(page.body, /<table id="roster">/);
  const view = JSON.parse((await get('/api/roster')).body);
  assert.equal(view.cafe, 'Little Wattle');
  assert.equal(view.days.length, 7);
  assert.equal(view.rows.length, 5);
});

test('the timesheet downloads as CSV', async () => {
  const res = await get('/timesheet.csv');
  assert.match(res.type, /text\/csv/);
  assert.match(res.body, /Mia Tran/);
});

test('an unknown path is a 404', async () => {
  assert.equal((await get('/nope')).status, 404);
});
