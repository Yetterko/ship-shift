// Public mode check: two visitors get separate kitchens, idle kitchens are deleted, the cap shows the full page,
// and nothing in the environment can switch on a real agent. Simulated chefs only, no API spend.
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocket } from 'ws';
import { git } from '../server/git.mjs';
import { STARTER_ORDERS } from '../server/demo-repo.mjs';

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
      // The town is off here: this test is the private-kitchen behaviour. test/world.mjs covers the town.
      SHIP_REPO: path.join(tmp, 'ignored-repo'), PORT: String(port), SHIP_WORLD: '0', SHIP_TOWN_FILE: path.join(tmp, 'town.json'), SHIP_RESET_TOKEN: 'never-used-in-private-mode', ...env,
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

  /* ---------- SHIP_WORLD=0: no town ---------- */
  h = await health(PORT);
  const noTown = await a.get('/api/world'), noReset = await a.raw('/api/world/reset', { token: 'never-used-in-private-mode' });
  ok(!('world' in h) && !('players' in h) && !noTown.ok && !noReset.ok && (await health(PORT)).kitchens === 2 && !(await exists(path.join(tmp, 'town.json'))), 'SHIP_WORLD=0 has no town: no world route, no reset, no town file');
  const first = await new Promise((resolve, reject) => { const ws = new WebSocket(`ws://127.0.0.1:${PORT}/ws`, { headers: a.headers() }); const got = []; ws.on('message', d => got.push(JSON.parse(d))); ws.on('error', reject); setTimeout(() => { ws.close(); resolve(got); }, 600); });
  ok(first.length >= 1 && first.every(m => m.type === 'state' && Object.keys(m).join() === 'type,state'), 'and its socket carries only the kitchen state, with no town fields');
  ok(!/town:|reset:/.test(log), 'the server log says nothing about a town or a reset token');

  /* ---------- the demo plays in each kitchen, and nothing crosses over ---------- */
  ok(sa.orders[0]?.title === STARTER_ORDERS[0].title && sb.orders[0]?.title === STARTER_ORDERS[0].title, 'the first customer walks up in each kitchen when its visitor arrives');
  const mine = await a.post('/api/orders', { title: 'Only in\nkitchen A', body: 'Nobody else should see this.', size: 'S' });
  ok(mine.title === 'Only in kitchen A', 'visitor A adds an order, and its title is kept to one line');
  sa = await a.state(); sb = await b.state();
  ok(sa.orders.some(o => o.id === mine.id) && !JSON.stringify(sb).includes('Only in kitchen A'), 'the order made by A is not visible to B');
  const wa = await a.socket({ origin: `http://127.0.0.1:${PORT}` }), wb = await b.socket({ origin: 'https://demo.example' });
  ok(wa.orders.some(o => o.title === 'Only in kitchen A') && !wb.orders.some(o => o.title === 'Only in kitchen A') && wb.driver === 'sim', 'each visitor\'s socket carries their own kitchen');
  ok(await a.socket({ origin: 'https://evil.example' }).then(() => false, e => e.message === '403'), 'a socket from another site is refused');

  /* ---------- origin, size and rate limits ---------- */
  ok((await a.raw('/api/rules', { autoRefire: false }, { origin: 'https://evil.example' })).status === 403, 'a POST from another site is refused');
  ok((await a.raw('/api/rules', { autoRefire: false }, { origin: `http://127.0.0.1:${PORT}` })).ok && (await a.raw('/api/rules', { autoRefire: false }, { origin: 'https://demo.example' })).ok, 'a POST from the request\'s own Host or SHIP_PUBLIC_ORIGIN is accepted');
  const big = await a.raw('/api/orders', { title: 'Big', body: 'x'.repeat(40_000) });
  ok(big.status === 413 && !(await a.state()).orders.some(o => o.title === 'Big'),'a 40 KB request is refused with 413');
  ok((await a.raw('/api/orders', '{not json')).status === 400, 'a body that is not JSON is refused with 400');
  const codes = [];
  for (let i = 0; i < 7; i++) codes.push((await a.raw('/api/orders', { title: `Flood ${i}`, size: 'S' })).status);
  ok(codes.slice(0, 5).every(c => c === 200) && codes[5] === 429 && codes[6] === 429, `order creation is rate limited: six a minute, then 429 (${codes.join(' ')})`);
  ok((await b.raw('/api/orders', { title: 'B is not slowed by A', size: 'S' })).status === 200, 'one visitor\'s limit does not slow another');

  /* ---------- a ship lands in A's repo only ---------- */
  await a.post('/api/orders/1/assign', { chefId: 'query' });
  await a.wait(s => s.orders.find(o => o.id === 1 && o.state === 'at_pass'), 'A\'s plate at the pass');
  ok((await a.state()).chefs.find(c => c.id === 'query').driver === 'sim' && (await a.state()).stats.apiUsd === 0 && (await a.state()).stats.costUsd > 0 && (await a.state()).stats.spendByRank.sous === (await a.state()).stats.costUsd, 'the chef named in SHIP_REAL_CHEFS cooked as a simulation: a wage on the meter and no real money spent');
  const diff = await (await a.get('/api/orders/1/diff')).json();
  ok(diff.patch.includes('diff --git') && diff.stat.files >= 1 &&(await b.get('/api/orders/1/diff')).ok && !(await (await b.get('/api/orders/1/diff')).json()).patch, 'A reads the real diff; the same order number in B has no work on it');
  await a.post('/api/orders/1/review', { verdict: 'approve' });
  ok((await a.post('/api/orders/1/ship', { seen: true })).shipped === true, 'A ships the plate');
  const logA = await git(repoA, ['log', '--oneline']), logB = await git(repoB, ['log', '--oneline']);
  ok(logA.includes('Ship #1') && !logB.includes('Ship #1') && logB.split('\n').length === 1, 'the merge is in A\'s repo and B\'s repo is untouched');

  /* ---------- the demo's arrival schedule plays out in each kitchen ---------- */
  const menu = STARTER_ORDERS.map(o => o.title).join('|');
  const starters = s => s.orders.filter(o => STARTER_ORDERS.some(x => x.title === o.title)).map(o => o.title).join('|');
  sa = await a.wait(s => starters(s) === menu && s, 'every starter order in kitchen A');
  sb = await b.wait(s => starters(s) === menu && s, 'every starter order in kitchen B');
  ok(sb.orders.length === STARTER_ORDERS.length + 1 && sa.orders.length > sb.orders.length, `both kitchens get the demo's ${STARTER_ORDERS.length} arrivals in order`);

  /* ---------- renaming a chef: your own kitchen only ---------- */
  const named = await b.post('/api/chefs/pixel', { name: ' Basil ' });
  ok(named.chef.name === 'Basil' && (await b.state()).chefs[0].name === 'Basil' && (await a.state()).chefs[0].name === 'Pixel', 'a visitor renames a chef in their own kitchen, and nobody else\'s chef changes');
  const badNames = [];
  for (const name of ['', 'x'.repeat(15), 'F.u.c.k', 'router']) { const r = await b.raw('/api/chefs/pixel', { name }); badNames.push(`${r.status} ${(await r.json()).code}`); }
  ok(badNames.join() === '400 name,400 name,400 name,409 taken' && (await b.state()).chefs[0].name === 'Basil', `an invalid name is refused with a code (${badNames.join(', ')})`);
  ok((await stranger.raw('/api/chefs/pixel', { name: 'Sage' })).status === 401 && (await b.raw('/api/chefs/pixel', { name: 'Sage' }, { origin: 'https://evil.example' })).status === 403 && (await b.state()).chefs[0].name === 'Basil', 'nobody without the kitchen\'s own session, and no other site, can rename a chef');

  /* ---------- hiring, ranks and letting go: your own kitchen only, and hiring costs score ---------- */
  sb = await b.state();
  const scoreBefore = sb.stats.score;
  const hire = await b.post('/api/chefs', { rank: 'commis' });
  const extra = await b.post('/api/chefs', { rank: 'head', name: 'Sage' });
  const seventh = await b.raw('/api/chefs', { rank: 'line' });
  sb = await b.state();
  ok(sb.hiring.cost === 50 && sb.stats.score === scoreBefore - 100 && sb.stats.points.filter(x => /^Hired /.test(x.why) && x.n === -50).length === 2, 'in public mode a hire costs 50 points');
  ok(sb.chefs.length === 6 && sb.chefs[4].rank === 'commis' && sb.chefs[4].model === 'claude-haiku-5-5' && sb.chefs[5].name === 'Sage' && sb.chefs[5].model === 'claude-fable-5-2' && sb.chefs.every(ch => ch.driver === 'sim') && seventh.status === 409 && (await seventh.json()).code === 'full' && (await b.state()).stats.score === scoreBefore - 100, 'two chefs are hired, both simulated whatever model their rank names, and a seventh is refused at no charge');
  ok((await b.post(`/api/chefs/${hire.chef.id}/rank`, { rank: 'line' })).chef.rank === 'line' && (await b.state()).chefs[4].model === 'claude-sonnet-5-5' && (await b.raw('/api/chefs/pixel/rank', { rank: 'emperor' })).status === 400, 'a chef changes rank, and an unknown rank is refused');
  const outsider = [(await stranger.raw('/api/chefs', { rank: 'commis' })).status, (await stranger.raw('/api/chefs/pixel/rank', { rank: 'commis' })).status, (await fetch(`${b.base}/api/chefs/pixel`, { method: 'DELETE' })).status,
    (await b.raw('/api/chefs', { rank: 'commis' }, { origin: 'https://evil.example' })).status, (await fetch(`${b.base}/api/chefs/pixel`, { method: 'DELETE', headers: b.headers({ origin: 'https://evil.example' }) })).status];
  ok(outsider.join() === '401,401,401,403,403' && (await b.state()).chefs.length === 6 && (await a.state()).chefs.length === 4 && (await a.state()).chefs.every(ch => ch.rank === 'sous'), `nobody without the kitchen's own session, and no other site, can hire, re-rank or dismiss (${outsider.join(' ')}); A's kitchen is untouched`);
  ok((await fetch(`${b.base}/api/chefs/${extra.chef.id}`, { method: 'DELETE', headers: b.headers() })).ok && (await b.post(`/api/chefs/${hire.chef.id}/dismiss`)).ok && (await b.state()).chefs.length === 4, 'an idle chef is let go, by DELETE or by POST');

  /* ---------- a fresh kitchen for one visitor ---------- */
  ok(sb.restart === '/api/demo/restart' && sb.commits === 1 && sa.commits === 3, 'the snapshot advertises the restart route and counts the commits on main');
  await b.post('/api/demo/restart');
  sb = await b.state();
  ok(sb.chefs.map(ch => ch.name).join() === 'Pixel,Router,Query,Stack' && sb.chefs.every(ch => ch.rank === 'sous' && !ch.hired) && sb.stats.spendByRank.sous === 0, 'a fresh kitchen puts back the default four Sous Chefs, with their names');
  ok(sb.orders.length === 1 && sb.orders[0].title === STARTER_ORDERS[0].title && sb.stats.score === 0 && (await exists(path.join(repoB, '.git'))) && (await health(PORT)).kitchens === 2, 'a fresh kitchen: B keeps the session and gets a new repo with the first customer at the window');
  await b.wait(s => s.orders.length >= 2, 'the arrivals to start again in B\'s fresh kitchen');
  ok((await a.state()).orders.length === sa.orders.length && (await git(repoA, ['log', '--oneline'])).includes('Ship #1'), 'and A\'s kitchen is untouched by it');

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
