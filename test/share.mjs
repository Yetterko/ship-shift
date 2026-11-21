// Public mode check: two visitors get separate kitchens, idle kitchens are deleted, the cap shows the full page,
// and nothing in the environment can switch on a real agent. Simulated chefs only, no API spend.
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocket } from 'ws';
import { git } from '../server/git.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'ship-share-'));
const PORT = 4694, IDLE_PORT = 4693, PACE = 80;
const servers = [];
let log = '';

function start(port, env) {
  const child = spawn(process.execPath, ['server/index.mjs', '--public'], {
    cwd: root,
    // Everything that would make a chef real on a private kitchen is set here on purpose. SHIP_CHEF_MODELS is even malformed.
    env: {
      ...process.env, SHIP_SIM: '', SHIP_DEMO: '', SHIP_SIM_ASK: '', SHIP_SIM_SPEED: '10', SHIP_PACE: String(PACE), SHIP_HOST: '127.0.0.1',
      SHIP_REAL_CHEFS: 'query,pixel,nobody', SHIP_CHEF_MODELS: 'nobody', SHIP_MODEL: 'claude-opus-5-5', ANTHROPIC_API_KEY: 'not-a-real-key',
      SHIP_REPO: path.join(tmp, 'ignored-repo'), PORT: String(port), ...env,
    },
    stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true,
  });
  child.stdout.on('data', d => { log += d; }); child.stderr.on('data', d => { log += d; });
  servers.push(child);
}

const sleep = ms => new Promise(r => setTimeout(r, ms));
const exists = p => fs.stat(p).then(() => true, () => false);
let passed = 0;
const ok = (cond, msg) => { if (!cond) throw new Error('FAILED: ' + msg); passed++; console.log('  ok', msg); };

/** One visitor: a browser's cookie jar and nothing else. */
function visitor(port) {
  const base = `http://127.0.0.1:${port}`;
  const v = {
    base, cookie: '', id: null,
    headers: extra => ({ ...(v.cookie ? { cookie: v.cookie } : {}), ...extra }),
    /** Loads the page as a browser would and keeps whatever cookie comes back. */
    visit: async (extra = {}) => {
      const res = await fetch(base + '/', { headers: v.headers(extra) });
      const set = res.headers.getSetCookie();
      if (set.length) { v.setCookie = set[0]; v.cookie = set[0].split(';')[0]; v.id = v.cookie.split('=')[1]; }
      return { res, set, text: await res.text() };
    },
    get: p => fetch(base + p, { headers: v.headers() }),
    state: async () => (await v.get('/api/state')).json(),
    raw: (p, b = {}, extra = {}) => fetch(base + p, { method: 'POST', headers: v.headers({ 'content-type': 'application/json', ...extra }), body: typeof b === 'string' ? b : JSON.stringify(b) }),
    post: async (p, b = {}) => { const r = await v.raw(p, b); const j = await r.json(); if (!r.ok) throw new Error(`${p}: ${j.error}`); return j; },
    wait: async (done, what, ms = 30000) => {
      const end = Date.now() + ms;
      while (Date.now() < end) {
        const s = await v.state();
        const hit = done(s);
        if (hit) return hit;
        for (const q of s.questions) {
          if (q.kind === 'question') await v.post(`/api/questions/${q.id}/answer`, { allow: true, answers: Object.fromEntries(q.questions.map(x => [x.question, x.options[0].label])) });
          else await v.post(`/api/questions/${q.id}/answer`, { allow: false, message: 'No new dependencies' });
        }
        await sleep(100);
      }
      throw new Error(`Timed out waiting for ${what}`);
    },
    /** Opens the kitchen's socket and resolves with the first state it sends, or rejects with why it was refused. */
    socket: (extra = {}) => new Promise((resolve, reject) => {
      const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`, { headers: v.headers(extra) });
      ws.on('message', d => { ws.close(); resolve(JSON.parse(d).state); });
      ws.on('unexpected-response', (_req, res) => reject(new Error(String(res.statusCode))));
      ws.on('error', reject);
    }),
  };
  return v;
}

const health = async port => (await fetch(`http://127.0.0.1:${port}/healthz`)).json();
async function up(port) {
  for (let i = 0; i < 80; i++) { try { return await health(port); } catch { await sleep(150); } }
  throw new Error(`No public kitchen on ${port}`);
}

try {
  console.log('Ship Shift public mode test');
  const dir = path.join(tmp, 'sessions'), idleDir = path.join(tmp, 'idle-sessions');
  start(PORT, { SHIP_MAX_SESSIONS: '2', SHIP_SESSIONS_DIR: dir, SHIP_PUBLIC_ORIGIN: 'https://demo.example/' });
  start(IDLE_PORT, { SHIP_MAX_SESSIONS: '1', SHIP_IDLE_MIN: '0.04', SHIP_SESSIONS_DIR: idleDir }); // idle after 2.4 s

  /* ---------- a kitchen only for somebody who opens the page ---------- */
  let h = await up(PORT);
  ok(h.ok && h.kitchens === 0 && h.max === 2, 'public mode starts with no kitchens, even with SHIP_REAL_CHEFS and a malformed SHIP_CHEF_MODELS set');
  const stranger = visitor(PORT);
  const script = await stranger.get('/game/core.js');
  ok(script.ok && !script.headers.getSetCookie().length && (await stranger.get('/api/state')).status === 401 && (await health(PORT)).kitchens === 0, 'scripts need no kitchen, and the API without a session is refused');
  ok(await stranger.socket().then(() => false, e => e.message === '401'), 'a socket without a session is refused');

  /* ---------- two visitors, two kitchens ---------- */
  const a = visitor(PORT), b = visitor(PORT);
  const pa = await a.visit(), pb = await b.visit({ 'x-forwarded-proto': 'https' });
  ok(pa.res.status === 200 && pa.text.includes('<html') && /^ship_sid=[a-f0-9]{32}; Path=\/; HttpOnly; SameSite=Lax/.test(a.setCookie) && !a.setCookie.includes('Secure'), 'a first visit serves the game and sets an HttpOnly session cookie');
  ok(pb.res.status === 200 && b.setCookie.endsWith('; Secure') && a.id !== b.id, 'a second visitor gets a different session, marked Secure behind an https proxy');
  const repoA = path.join(dir, a.id, 'repo'), repoB = path.join(dir, b.id, 'repo');
  let sa = await a.state(), sb = await b.state();
  ok(await exists(path.join(repoA, '.git')) && await exists(path.join(repoB, '.git')) && (await health(PORT)).kitchens === 2, 'each visitor has their own git repo on disk');

  /* ---------- real agents are impossible ---------- */
  ok(sa.driver === 'sim' && sb.driver === 'sim' && [...sa.chefs, ...sb.chefs].every(c => c.driver === 'sim') && sa.chefs.length === 4, 'every chef is simulated although SHIP_REAL_CHEFS names query and pixel');
  ok(/chefs:\s+simulated/.test(log) && !/Claude Agent SDK/.test(log), 'the server log reports simulated chefs only');
  ok(sa.pace === PACE && sa.shift.focusMin === 3 && sa.shift.mode === 'off', 'a public kitchen runs at demo pace with a 3 minute shift that has not started');
  const text = JSON.stringify(sa);
  ok(!text.includes(a.id) && !text.toLowerCase().includes(path.basename(tmp).toLowerCase()) && sa.repo.replace(/\\/g, '/') === '~/kitchen/repo', `the snapshot hides the server's directories and the session id (repo shows as ${sa.repo})`);

  /* ---------- the demo plays in each kitchen, and nothing crosses over ---------- */
  ok(sa.orders[0]?.title === 'Weekly hours crashes', 'the first customer walks up when the visitor arrives');
  sa = await a.wait(s => s.orders.length === 4 && s, 'the four starter orders in kitchen A');
  sb = await b.wait(s => s.orders.length === 4 && s, 'the four starter orders in kitchen B');
  ok(sa.orders.map(o => o.size).join('') === 'SMML' && sb.orders.map(o => o.size).join('') === 'SMML', 'both kitchens get the demo\'s four arrivals');
  const mine = await a.post('/api/orders', { title: 'Only in\nkitchen A', body: 'Nobody else should see this.', size: 'S' });
  ok(mine.id === 5 && mine.title === 'Only in kitchen A', 'visitor A adds an order, and its title is kept to one line');
  sa = await a.state(); sb = await b.state();
  ok(sa.orders.length === 5 && sb.orders.length === 4 && !JSON.stringify(sb).includes('Only in kitchen A'), 'the order made by A is not visible to B');
  const wa = await a.socket({ origin: `http://127.0.0.1:${PORT}` }), wb = await b.socket({ origin: 'https://demo.example' });
  ok(wa.orders.some(o => o.title === 'Only in kitchen A') && wb.orders.length === 4 && wb.driver === 'sim', 'each visitor\'s socket carries their own kitchen');
  ok(await a.socket({ origin: 'https://evil.example' }).then(() => false, e => e.message === '403'), 'a socket from another site is refused');

  /* ---------- origin, size and rate limits ---------- */
  ok((await a.raw('/api/rules', { autoRefire: false }, { origin: 'https://evil.example' })).status === 403, 'a POST from another site is refused');
  ok((await a.raw('/api/rules', { autoRefire: false }, { origin: `http://127.0.0.1:${PORT}` })).ok && (await a.raw('/api/rules', { autoRefire: false }, { origin: 'https://demo.example' })).ok, 'a POST from the request\'s own Host or SHIP_PUBLIC_ORIGIN is accepted');
  const big = await a.raw('/api/orders', { title: 'Big', body: 'x'.repeat(40_000) });
  ok(big.status === 413 && (await a.state()).orders.length === 5, 'a 40 KB request is refused with 413');
  ok((await a.raw('/api/orders', '{not json')).status === 400, 'a body that is not JSON is refused with 400');
  const codes = [];
  for (let i = 0; i < 7; i++) codes.push((await a.raw('/api/orders', { title: `Flood ${i}`, size: 'S' })).status);
  ok(codes.slice(0, 5).every(c => c === 200) && codes[5] === 429 && codes[6] === 429, `order creation is rate limited: six a minute, then 429 (${codes.join(' ')})`);
  ok((await b.raw('/api/orders', { title: 'B is not slowed by A', size: 'S' })).status === 200, 'one visitor\'s limit does not slow another');

  /* ---------- a ship lands in A's repo only ---------- */
  await a.post('/api/orders/1/assign', { chefId: 'query' });
  await a.wait(s => s.orders.find(o => o.id === 1 && o.state === 'at_pass'), 'A\'s plate at the pass');
  ok((await a.state()).chefs.find(c => c.id === 'query').driver === 'sim' && (await a.state()).stats.costUsd === 0, 'the chef named in SHIP_REAL_CHEFS cooked as a simulation, at no cost');
  const diff = await (await a.get('/api/orders/1/diff')).json();
  ok(diff.patch.includes('src/pay.js') && (await b.get('/api/orders/1/diff')).ok && !(await (await b.get('/api/orders/1/diff')).json()).patch, 'A reads the real diff; the same order number in B has no work on it');
  await a.post('/api/orders/1/review', { verdict: 'approve' });
  ok((await a.post('/api/orders/1/ship', { seen: true })).shipped === true, 'A ships the plate');
  const logA = await git(repoA, ['log', '--oneline']), logB = await git(repoB, ['log', '--oneline']);
  ok(logA.includes('Ship #1') && !logB.includes('Ship #1') && logB.split('\n').length === 1, 'the merge is in A\'s repo and B\'s repo is untouched');

  /* ---------- the cap ---------- */
  const c = visitor(PORT);
  const pc = await c.visit();
  ok(pc.res.status === 503 && /kitchen is full/i.test(pc.text) && /try again shortly/i.test(pc.text) && !pc.set.length && pc.res.headers.get('retry-after'), 'a third visitor gets the "kitchen is full" page and no session');
  ok((await fs.readdir(dir)).filter(n => !n.startsWith('.')).length === 2 && (await health(PORT)).kitchens === 2, 'the full page opens no kitchen');
  const again = await a.visit();
  ok(again.res.status === 200 && !again.set.length && (await a.state()).orders.some(o => o.title === 'Only in kitchen A'), 'a visitor who reloads keeps their kitchen while it is full');

  /* ---------- idle cleanup ---------- */
  await up(IDLE_PORT);
  const d = visitor(IDLE_PORT), e = visitor(IDLE_PORT);
  ok((await d.visit()).res.status === 200 && (await e.visit()).res.status === 503, 'the short-lived server holds one kitchen and turns the next visitor away');
  const dDir = path.join(idleDir, d.id);
  await d.wait(s => s.orders.length >= 1, 'the idle kitchen\'s first order');
  await d.post('/api/orders/1/assign', { chefId: 'pixel' });
  ok(await exists(path.join(dDir, 'repo', '.git')) && (await fs.readdir(path.join(dDir, 'data', 'worktrees'))).length === 1, 'the visitor has a repo and a chef cooking in a worktree');
  const gone = Date.now() + 15000;
  while (await exists(dDir) && Date.now() < gone) await sleep(200);
  ok(!(await exists(dDir)) && (await health(IDLE_PORT)).kitchens === 0, 'an idle kitchen is closed and its repo, data and worktrees are deleted');
  ok((await d.get('/api/state')).status === 401 && await d.socket().then(() => false, err => err.message === '401'), 'the old session no longer opens a kitchen');
  ok((await e.visit()).res.status === 200 && e.id && e.id !== d.id, 'the freed place goes to the next visitor');

  console.log(`\nPublic mode test passed (${passed} checks).`);
} catch (e) {
  console.error('\n' + e.message);
  console.error('--- server log ---\n' + log);
  process.exitCode = 1;
} finally {
  for (const s of servers) s.kill();
  await sleep(600);
  await fs.rm(tmp, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }).catch(() => {});
}
