// Public mode over HTTP: private restaurants per visitor, key and VIP checks, the read-only team kitchen at /watch,
// the owner link, "New restaurant", origin checks and the leaderboard. Costs nothing: no API key is set.
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'ship-shift-public-'));
const PORT = 4698, base = `http://127.0.0.1:${PORT}`;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const srv = spawn(process.execPath, ['server/index.mjs', '--public'], {
  env: { ...process.env, PORT: String(PORT), SHIP_OWNER_TOKEN: 'owner123', SHIP_VIP_CODE: 'vip42', SHIP_SHARED_KEY: '', SHIP_SESSIONS_DIR: path.join(tmp, 'sessions'), SHIP_FLAGSHIP_DIR: path.join(tmp, 'flagship') },
  stdio: ['ignore', 'ignore', 'inherit'], windowsHide: true,
});
let passed = 0;
const ok = (cond, msg) => { if (!cond) throw new Error('FAILED: ' + msg); passed++; console.log('  ok', msg); };
try {
  for (let i = 0; i < 60; i++) { try { await fetch(base + '/healthz'); break; } catch { await sleep(250); } }
  const visitor = async () => {
    const cookie = (await fetch(base + '/')).headers.get('set-cookie').split(';')[0];
    const H = { cookie, 'content-type': 'application/json', origin: base };
    return {
      cookie,
      state: async () => (await fetch(base + '/api/state', { headers: { cookie } })).json(),
      post: (p, b = {}, h = {}) => fetch(base + p, { method: 'POST', headers: { ...H, ...h }, body: JSON.stringify(b) }).then(async r => ({ status: r.status, body: await r.json() })),
    };
  };
  const a = await visitor(), b = await visitor();
  const sa = await a.state(), sb = await b.state();
  ok(sa.customers.filter(c => c.state === 'in_line').length === 5 && sa.publicMode && sa.mode === 'sim', 'a visitor gets a private restaurant with five customers and practice chefs');
  ok((await a.post('/api/shift/start', { lengthMin: 3 })).status === 200 && (await a.post('/api/customers/1/seat')).status === 200, 'a visitor can open and seat');
  ok((await b.state()).customers[0].state === 'in_line' && sa.name !== undefined && sb.repo === undefined, "one visitor's seating does not touch another's restaurant");
  ok(/Practice kitchens/.test((await a.post('/api/customers', { title: 'x' })).body.error), 'practice kitchens refuse free-text tickets');
  ok(/does not look like/.test((await a.post('/api/session/key', { apiKey: 'nope' })).body.error), 'a malformed API key is refused before any network call');
  ok(/not the VIP code/.test((await a.post('/api/session/vip', { code: 'bad' })).body.error) && (await a.post('/api/session/vip', { code: 'vip42' })).status === 200, 'the VIP code is checked');
  ok((await a.state()).vip === true && (await b.state()).vip === false, 'VIP applies to one restaurant only');
  ok((await a.post('/api/shift/start', {}, { origin: 'https://evil.example' })).status === 403, 'a POST from another site is refused');
  const lb = await (await fetch(base + '/api/leaderboard', { headers: { cookie: a.cookie } })).json();
  ok(lb.length === 3 && lb.some(r => r.you) && lb.some(r => r.team), 'the leaderboard lists every restaurant and the team kitchen');
  const w = await (await fetch(base + '/api/state', { headers: { referer: base + '/watch' } })).json();
  ok(w.name === 'Team kitchen', '/watch shows the team kitchen');
  ok(/watching/.test((await fetch(base + '/api/shift/start', { method: 'POST', headers: { 'content-type': 'application/json', origin: base, referer: base + '/watch' }, body: '{}' }).then(r => r.json())).error), 'watchers cannot act');
  const oc = (await fetch(base + '/?owner=owner123', { redirect: 'manual' })).headers.get('set-cookie').split(';')[0];
  ok((await fetch(base + '/api/shift/start', { method: 'POST', headers: { cookie: oc, 'content-type': 'application/json', origin: base }, body: JSON.stringify({ lengthMin: 3 }) })).status === 200, 'the owner link runs the team kitchen');
  ok((await a.post('/api/session/reset')).status === 200 && (await fetch(base + '/api/state', { headers: { cookie: a.cookie } })).status === 401, '"New restaurant" closes the old one');
  ok((await fetch(base + '/api/state')).status === 401, 'the API without a session is refused');
  console.log(`${passed} checks passed`);
} catch (e) { console.error(e.message); process.exitCode = 1; }
finally { srv.kill(); await sleep(600); await fs.rm(tmp, { recursive: true, force: true, maxRetries: 5 }).catch(() => {}); }
