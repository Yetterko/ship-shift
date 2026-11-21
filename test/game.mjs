// Headless run of the restaurant with simulated chefs, at a phone's landscape size. It plays one order the way a judge would:
// open the restaurant, seat a customer, send a special, take a break, answer the bell, taste the dish, serve it, bill.
// Usage: node test/game.mjs [screenshot-dir]. Never opens a visible window and never runs a real agent.
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright-core';

const shots = process.argv[2];
if (shots) await fs.mkdir(shots, { recursive: true });
const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'ship-shift-game-'));
const PORT = 4697;
const server = spawn(process.execPath, ['server/index.mjs', '--demo'], {
  env: { ...process.env, SHIP_SIM_SPEED: '3', SHIP_DATA: path.join(tmp, 'data'), SHIP_SHARED_KEY: '', ANTHROPIC_API_KEY: '', PORT: String(PORT) },
  stdio: ['ignore', 'ignore', 'inherit'], windowsHide: true,
});
const sleep = ms => new Promise(r => setTimeout(r, ms));
const base = `http://127.0.0.1:${PORT}`;

async function findChrome() {
  if (process.env.SHIP_CHROME) return process.env.SHIP_CHROME;
  const dir = path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), '.cache'), 'ms-playwright');
  const entries = (await fs.readdir(dir).catch(() => [])).filter(d => d.startsWith('chromium_headless_shell-')).sort().reverse();
  for (const e of entries) for (const sub of await fs.readdir(path.join(dir, e))) {
    const exe = path.join(dir, e, sub, process.platform === 'win32' ? 'chrome-headless-shell.exe' : 'chrome-headless-shell');
    if (await fs.stat(exe).then(() => true, () => false)) return exe;
  }
}

const errors = [];
let passed = 0, browser, page;
const ok = (cond, msg) => { if (!cond) throw new Error('FAILED: ' + msg); passed++; console.log('  ok', msg); };
const shot = async name => { if (shots) await page.screenshot({ path: path.join(shots, `${name}.png`) }); };
const S = () => page.evaluate(() => window.__ship.state);
const go = spec => page.evaluate(s => window.__ship.go(s), spec);
const waitFor = (fn, arg, ms = 30000) => page.waitForFunction(fn, arg, { timeout: ms });

try {
  for (let i = 0; i < 60; i++) { try { await fetch(`${base}/api/state`); break; } catch { await sleep(250); } }
  browser = await chromium.launch({ headless: true, executablePath: await findChrome(), args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const w = Number(process.env.SHIP_W || 844), h = Number(process.env.SHIP_H || 390);
  page = await browser.newPage({ viewport: { width: w, height: h }, hasTouch: true, deviceScaleFactor: 2 });
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto(base + '/');
  await page.waitForSelector('canvas');
  await waitFor(() => window.__ship?.state);
  await page.evaluate(() => document.fonts.ready);
  await sleep(1200);
  await shot('01-start');
  ok(await page.locator('#start.open').count() === 1, 'the start screen is up before the shift');
  await page.click('#startBtn');
  await waitFor(() => window.__ship.state.shift.phase === 'service');
  await sleep(800);
  await shot('02-floor');
  ok((await S()).customers.filter(c => c.state === 'in_line').length === 5, 'five customers wait in the line');

  // seat Mia from her docket
  await go('line:1');
  await waitFor(() => window.__ship.ui.mode === 'docket', null, 15000);
  await sleep(400); await shot('03-docket');
  await page.click('[data-act="seat"]');
  await waitFor(() => window.__ship.state.customers[0].state === 'seated');
  ok(true, 'Mia is seated from her ticket docket');
  // take her order: the pad opens with her special already on it
  await sleep(600);
  await go('table:1');
  await waitFor(() => window.__ship.ui.mode === 'pad', null, 15000);
  await sleep(400); await shot('04-pad');
  ok(await page.locator('.pline').count() === 1, 'the order pad starts with the special');
  await page.click('[data-act="send"]');
  await waitFor(() => window.__ship.state.items.length === 1);
  ok(true, 'one ticket goes on the rail');
  // seat Raj and send both of his specials
  await go('line:2'); await waitFor(() => window.__ship.ui.mode === 'docket', null, 15000); await page.click('[data-act="seat"]');
  await waitFor(() => window.__ship.state.customers[1].state === 'seated');
  await sleep(500);
  await go('table:2'); await waitFor(() => window.__ship.ui.mode === 'pad', null, 15000);
  await page.click('.spc[data-act="chip"]');
  ok(await page.locator('.pline').count() === 2, 'tapping a special adds a second line');
  await page.click('[data-act="send"]');
  await waitFor(() => window.__ship.state.items.length === 3);
  await waitFor(() => window.__ship.state.chefs.every(c => c.state === 'cooking'), null, 15000);
  await sleep(1000); await shot('05-cooking');
  ok(true, 'both chefs are cooking at two stations');
  // peek at a station
  await go('station:backend'); await waitFor(() => window.__ship.ui.mode === 'peek', null, 15000);
  await sleep(1600); await shot('06-peek');
  await page.click('[data-act="close"]');

  // the break, then the bell
  // the button hops while it glows, so press it the moment the break is allowed
  await waitFor(() => window.__ship.state.shift.eligible && !document.getElementById('breakBtn').disabled && (document.getElementById('breakBtn').click(), true), null, 15000);
  await waitFor(() => window.__ship.state.shift.phase === 'break');
  await sleep(500); await shot('07-staffroom');
  ok(await page.locator('#staff.open').count() === 1, 'the staff room covers the floor during the break');
  await waitFor(() => window.__ship.state.shift.phase === 'bell', null, 40000);
  await sleep(500); await shot('08-bell');
  ok(true, 'the bell rings after the cooldown, once a dish is ready');
  await page.click('#backBtn');
  await waitFor(() => window.__ship.state.shift.phase === 'service');

  // taste and serve
  await go('counter'); await waitFor(() => window.__ship.ui.mode === 'plate', null, 15000);
  await waitFor(() => document.querySelectorAll('#pDiff .hunk').length > 0, null, 10000);
  for (let i = 0; i < 12; i++) { await page.evaluate(() => { document.getElementById('pDiff').scrollTop += 120; document.getElementById('pBody').scrollTop += 150; }); await sleep(120); }
  await sleep(300); await shot('09-plate');
  const plated = await page.evaluate(() => window.__ship.ui.itemId);
  await page.click('[data-act="serve"]');
  await waitFor(id => window.__ship.state.items.find(i => i.id === id).state === 'served', plated);
  ok(true, 'the dish is served from the plate card');
  // feedback and the bill (Mia, or whoever was served first)
  const cid = (await S()).items.find(i => i.id === plated).customerId;
  await waitFor(id => window.__ship.state.customers.find(c => c.id === id).state === 'feedback_ready', cid, 20000);
  const table = (await S()).customers.find(c => c.id === cid).tableId;
  await go(`table:${table}`); await waitFor(() => window.__ship.ui.mode === 'feedback' || window.__ship.ui.mode === 'table', null, 15000);
  await sleep(400); await shot('10-feedback');
  if ((await S()).customers.find(c => c.id === cid).lastVerdict === 'satisfied') {
    await page.click('[data-act="bill"]');
    await waitFor(id => window.__ship.state.customers.find(c => c.id === id).state === 'paid', cid, 15000);
    await sleep(1200); await shot('11-receipt');
    ok(await page.locator('.receipt .r-paid').count() === 1, 'the bill prints a receipt with the merge commit');
  }
  const look = await page.evaluate(() => window.__ship.look());
  ok(look.floorFrac > 0.4, `the floor fills the screen (${Math.round(look.floorFrac * 100)}%)`);
  ok(errors.length === 0, `no page errors${errors.length ? ': ' + errors.slice(0, 3).join(' | ') : ''}`);
  console.log(`${passed} checks passed`);
} catch (e) {
  console.error(e.message);
  if (errors.length) console.error('page errors:', errors.slice(0, 5).join('\n'));
  if (page) await shot('99-failure').catch(() => {});
  process.exitCode = 1;
} finally {
  await browser?.close().catch(() => {});
  server.kill();
  await sleep(500);
  await fs.rm(tmp, { recursive: true, force: true, maxRetries: 5 }).catch(() => {});
}
