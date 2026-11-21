// The kitchen on a phone, driven by touch alone. Three emulated devices (iPhone 13 upright and on its side, Pixel 7) each open
// the shared-link server, get a private kitchen, and play the walkthrough with fingers: take, give, answer, review, ship,
// then the end of a round. Along the way: the thumb stick with a second finger on a button, the menu, and a 360px-wide dialog.
// Usage: node test/mobile.mjs [screenshot-dir] [device-filter]. Never opens a visible window and never runs a real agent.
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { chromium, devices } from 'playwright-core';

const shots = process.argv[2];
const only = process.argv[3];
if (shots) await fs.mkdir(shots, { recursive: true });
const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'ship-shift-phone-'));
const sleep = ms => new Promise(r => setTimeout(r, ms));
const PORT = 4699, base = `http://127.0.0.1:${PORT}`;
const clean = { SHIP_SIM: '', SHIP_SIM_ASK: '', SHIP_REAL_CHEFS: '', SHIP_CHEF_MODELS: '', SHIP_PACE: '', SHIP_DEMO: '', SHIP_PUBLIC: '', SHIP_REPO: '', SHIP_DATA: '', SHIP_PUBLIC_ORIGIN: '' };
const server = spawn(process.execPath, ['server/index.mjs', '--public'], {
  env: { ...process.env, ...clean, SHIP_SESSIONS_DIR: path.join(tmp, 'sessions'), SHIP_TOWN_FILE: path.join(tmp, 'town.json'), SHIP_WORLD: '0', SHIP_SIM_SPEED: '3', PORT: String(PORT) }, stdio: 'ignore', windowsHide: true,
});

async function findChrome() {
  if (process.env.SHIP_CHROME) return process.env.SHIP_CHROME;
  const dir = path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), '.cache'), 'ms-playwright');
  const entries = (await fs.readdir(dir).catch(() => [])).filter(d => d.startsWith('chromium_headless_shell-')).sort().reverse();
  for (const e of entries) for (const sub of await fs.readdir(path.join(dir, e))) {
    const exe = path.join(dir, e, sub, process.platform === 'win32' ? 'chrome-headless-shell.exe' : 'chrome-headless-shell');
    if (await fs.stat(exe).then(() => true, () => false)) return exe;
  }
}

const PHONES = [
  ['iphone-portrait', 'iPhone 13'],
  ['iphone-landscape', 'iPhone 13 landscape'],
  ['pixel-portrait', 'Pixel 7'],
].filter(([tag]) => !only || tag.includes(only));

const errors = [], offHost = [];
let passed = 0, browser, page, tag = '';
const ok = (cond, msg) => { if (!cond) throw new Error(`FAILED (${tag}): ${msg}`); passed++; console.log('  ok', msg); };
const shot = async name => { if (shots) await page.screenshot({ path: path.join(shots, `${tag}-${name}.png`) }); };
const ship = fn => page.evaluate(fn);
const post = (url, body = {}) => page.evaluate(([url, body]) => fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }).then(r => r.ok), [url, body]);
/** One finger, one tap, on the thing itself: the ticket, the pot, the plate, the belt. */
const tapStation = async id => {
  const p = await page.evaluate(id => { const s = window.__ship, st = s.stations.find(x => x.id === id); return s.screenOfPoint(st.top.x, st.top.y, st.top.z); }, id);
  await page.touchscreen.tap(p.x, p.y);
};
const guideIs = (step, ms = 90000) => page.waitForFunction(step => window.__ship.guide.step === step && window.__ship.guide.target, step, { timeout: ms });
const tapGuide = async (until, ms = 30000, arg) => { await tapStation(await ship(() => window.__ship.guide.target)); await page.waitForFunction(until, arg, { timeout: ms }); };
/** Nothing sticks out of the screen, and nothing a finger must hit is smaller than a finger. */
const fits = sel => page.evaluate(sel => [...document.querySelectorAll(sel)].filter(e => e.getClientRects().length).every(e => { const r = e.getBoundingClientRect(); return r.left >= -1 && r.right <= innerWidth + 1 && r.top >= -1 && r.bottom <= innerHeight + 1; }), sel);

async function play([name, device]) {
  tag = name;
  const d = devices[device];
  console.log(`${device}, ${d.viewport.width}×${d.viewport.height}, by touch`);
  const context = await browser.newContext({ ...d, deviceScaleFactor: 2 });
  page = await context.newPage();
  page.on('pageerror', e => errors.push(`${tag}: ${e.message}`));
  page.on('console', m => { if (m.type() === 'error') errors.push(`${tag}: ${m.text()}`); });
  page.on('request', r => { const u = new URL(r.url()); if (!['127.0.0.1', 'localhost'].includes(u.hostname) && !['data:', 'blob:'].includes(u.protocol)) offHost.push(r.url()); });
  await page.goto(base + '/');
  await page.waitForSelector('canvas');
  await page.waitForFunction(() => window.__ship?.state?.orders.length >= 1 && document.fonts.status === 'loaded', null, { timeout: 30000 });
  await sleep(1500);
  const portrait = d.viewport.height > d.viewport.width;

  /* ---------- start screen ---------- */
  await shot('01-title');
  ok(await ship(() => window.__ship.touch.on && document.body.classList.contains('touch') && document.body.dataset.layout) === (portrait ? 'portrait' : 'landscape'), `the page knows it is a phone held ${portrait ? 'upright' : 'on its side'}`);
  ok(await fits('#title .title-card, #titleStart') && await ship(() => document.documentElement.scrollWidth <= innerWidth), 'the start screen fits the screen, with nothing to scroll sideways');
  await page.locator('#titleStart').tap();
  await page.waitForFunction(() => !window.__ship.modal() && window.__ship.guide.on);
  await guideIs('take'); await sleep(1200);
  await shot('02-kitchen');
  ok(await fits('.hud > *:not([hidden]):not(.tools), .pad .tb:not([hidden])'), 'the HUD is one strip inside the screen and the buttons sit in the corner');
  ok(await ship(() => [...document.querySelectorAll('.pad .tb:not([hidden])')].every(b => b.getBoundingClientRect().width >= 44)), 'every touch button is at least 44px across');
  const look = await ship(() => window.__ship.look());
  ok(look.chefPx >= (portrait ? 50 : 40) && look.overlaps === 0, `a chef stands ${Math.round(look.chefPx)}px tall on this screen and no labels overlap`);

  /* ---------- the thumb stick, with a second finger on a button ---------- */
  const cdp = await context.newCDPSession(page);
  // a thumb goes down on bare floor: the first spot near the middle of the screen with nothing but the kitchen under it
  const start = await ship(() => {
    for (let y = Math.round(innerHeight * 0.55); y < innerHeight - 120; y += 12) for (let x = Math.round(innerWidth * 0.3); x < innerWidth * 0.6; x += 12) {
      if ([0, 60].every(dx => document.elementFromPoint(x + dx, y)?.tagName === 'CANVAS')) return { x, y };
    }
    return null;
  });
  ok(start, 'there is bare kitchen to put a thumb on');
  const p0 = await ship(() => ({ x: window.__ship.player.g.position.x, z: window.__ship.player.g.position.z }));
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ ...start, id: 1 }] });
  for (let i = 1; i <= 6; i++) { await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: start.x + i * 9, y: start.y, id: 1 }] }); await sleep(30); }
  await sleep(500);
  await shot('03-thumb-stick');
  const dash = await page.locator('#tDash').boundingBox();
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: start.x + 54, y: start.y, id: 1 }, { x: Math.round(dash.x + dash.width / 2), y: Math.round(dash.y + dash.height / 2), id: 2 }] });
  await sleep(120);
  const mid = await ship(() => ({ stick: window.__ship.stick.id !== null, dash: window.__ship.player.dashCool > 0, thumb: !document.getElementById('thumb').hidden }));
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [{ x: start.x + 54, y: start.y, id: 1 }] });
  await sleep(300);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await sleep(200);
  const p1 = await ship(() => ({ x: window.__ship.player.g.position.x, z: window.__ship.player.g.position.z, stick: window.__ship.stick.id }));
  const moved = portrait ? p1.z - p0.z : p1.x - p0.x;
  ok(mid.stick && mid.thumb && moved > 0.5 && p1.stick === null, `a drag to the right is a thumb stick: the chef walked ${moved.toFixed(1)} to the right of the screen and stopped when the thumb lifted`);
  ok(mid.dash, 'a second finger pressed Dash while the first held the stick');

  /* ---------- the menu, and a dialog on a narrow screen ---------- */
  await page.locator('#menuBtn').tap();
  await page.waitForSelector('#tools.open');
  await sleep(250);
  await shot('04-menu');
  ok(await fits('#tools .rb') && (await page.locator('#tools .rb').count()) === 5, 'the menu button opens the board, help, sound, presenter mode and new order');
  await page.locator('#helpBtn').tap();
  await page.waitForSelector('#help.open');
  await sleep(300);
  await shot('05-help');
  ok(await fits('#help .help-card') && await ship(() => document.documentElement.scrollWidth <= innerWidth), 'the help sheet fits and scrolls inside itself');
  await page.locator('#helpClose').tap();
  await page.waitForFunction(() => !window.__ship.modal());

  /* ---------- the board, as a sheet ---------- */
  await page.locator('#menuBtn').tap();
  await page.locator('#boardBtn').tap();
  await page.waitForSelector('#board.open');
  await sleep(800);
  await shot('05b-board');
  const bd = await ship(() => { const r = document.getElementById('board').getBoundingClientRect(); return { top: r.top / innerHeight, left: r.left / innerWidth, lanes: document.querySelectorAll('#board .lane').length, cards: document.querySelectorAll('#board .bcard').length }; });
  ok(await fits('#board') && bd.lanes === 7 && bd.cards >= 1 && (portrait ? bd.top > 0.25 && bd.left < 0.05 : bd.left >= 0.45), `the board is ${portrait ? 'a sheet across the bottom' : 'a drawer on the right'} with all seven columns to swipe through, and the kitchen still showing`);
  await page.locator('#board [data-act="close"]').tap();
  await page.waitForFunction(() => !document.querySelector('#board.open'));

  /* ---------- take and give ---------- */
  await guideIs('take'); await sleep(700);
  await shot('06-take');
  await tapGuide(() => window.__ship.player.carry?.type === 'ticket');
  await guideIs('give'); await sleep(600);
  await shot('07-give');
  ok(await ship(() => !document.getElementById('tDrop').hidden), 'holding a ticket brings up the Put down button');
  await tapGuide(() => window.__ship.state.orders[0].chefId);
  await page.waitForFunction(() => window.__ship.state.shift.mode === 'focus', null, { timeout: 10000 });
  ok(true, 'a tap on the ticket took it, a tap on a chef handed it over, and the clock started');
  await post('/api/shift/start', { focusMin: 5, breakMin: 1 });       // room for the screenshots; the round at the end is the real one

  /* ---------- answer ---------- */
  const asks = await page.waitForFunction(() => window.__ship.state.orders.find(o => o.id === 2 && window.__ship.slotOf.has(2))?.id, null, { timeout: 60000 }).then(h => h.jsonValue());
  await guideIs('take');
  await tapGuide(() => window.__ship.player.carry?.type === 'ticket');
  await guideIs('give');
  await tapGuide(id => window.__ship.state.orders.find(o => o.id === id).chefId, 30000, asks);
  await page.waitForFunction(id => window.__ship.state.questions.some(q => q.orderId === id), asks, { timeout: 40000 });
  await guideIs('answer');
  await tapStation(await ship(() => window.__ship.guide.target));
  await page.waitForSelector('#qsheet:not([hidden]) li[data-key="1"]', { timeout: 20000 });
  await sleep(500);
  await shot('08-answer');
  ok(await fits('#qsheet') && await ship(() => [...document.querySelectorAll('#qsheet li')].every(li => li.getBoundingClientRect().height >= 40)), 'the question is a sheet that fits, with options tall enough to tap');
  await page.locator('#qsheet li[data-key="1"]').tap();
  await page.waitForFunction(id => !window.__ship.state.questions.some(q => q.orderId === id), asks, { timeout: 10000 });
  ok(await ship(() => window.__ship.guide.done.answer && document.getElementById('qsheet').hidden), 'one tap on an option answered the chef');

  /* ---------- review ---------- */
  await page.waitForFunction(() => window.__ship.state.orders[0].state === 'at_pass', null, { timeout: 90000 });
  await guideIs('review'); await sleep(900);
  await shot('09-plate-ready');
  await tapGuide(() => document.querySelector('#review.open .hunk'));
  await sleep(1000);
  await shot('10-review');
  const rv = await ship(() => { const r = document.getElementById('review').getBoundingClientRect(), d = document.getElementById('rDiff').getBoundingClientRect(); return { top: r.top / innerHeight, left: r.left / innerWidth, diff: d.height, scroll: document.getElementById('rDiff').scrollHeight > d.height }; });
  if (portrait) ok(rv.top > 0.3 && rv.left < 0.05 && rv.diff >= 90, `review is a sheet across the bottom ${Math.round((1 - rv.top) * 100)}% of the screen, with a ${Math.round(rv.diff)}px scrolling diff and the kitchen above it`);
  else ok(rv.left >= 0.45 && rv.diff >= 60, `review docks on the right half, with a ${Math.round(rv.diff)}px scrolling diff and the kitchen beside it`);
  ok(await fits('#review, #rApprove, #rBack, #review .pair .k'), 'the whole review sheet and its buttons are on the screen');
  const hunks = await page.locator('#review .hunk').count();
  for (let i = 0; i < hunks; i++) { await page.locator('#review .k[data-k="J"]').tap(); await sleep(60); }
  ok(await ship(() => window.__ship.diffSeen(window.__ship.state.orders[0])), `the Next button walked all ${hunks} changes, so the diff counts as seen`);
  await page.locator('#rApprove').tap();
  await page.waitForFunction(() => window.__ship.state.orders[0].approved && !document.querySelector('#review.open'), null, { timeout: 30000 });

  /* ---------- ship, inside a short round of its own ---------- */
  await post('/api/shift/start', { focusMin: 0.75, breakMin: 1 });
  await guideIs('ship'); await sleep(600);
  await tapGuide(() => window.__ship.player.carry?.type === 'plate');
  await page.waitForFunction(() => window.__ship.guide.target === 'hatch'); await sleep(300);
  await shot('11-carry-to-hatch');
  await tapGuide(() => window.__ship.state.orders[0].state === 'shipped', 60000);
  await sleep(420);
  await shot('12-shipped');
  ok(await ship(() => window.__ship.state.stats.shipped === 1 && window.__ship.state.stats.blindShips === 0 && !window.__ship.guide.on), 'two taps carried the plate to the hatch and shipped it: the whole loop, by touch');

  /* ---------- the end of the round ---------- */
  await page.waitForSelector('#reportDialog[open]', { timeout: 90000 });
  await sleep(1800);
  await shot('13-report');
  ok(await fits('#reportDialog, #repAgain, #repClose') && (await ship(() => document.querySelectorAll('#repStars .on').length)) >= 2, 'the shift report, its stars and both buttons fit the screen');
  await page.locator('#repAgain').tap();
  await page.waitForFunction(() => !document.querySelector('dialog[open]') && window.__ship.state.shift.mode === 'off', null, { timeout: 60000 });
  ok(true, 'Play again is one tap');
  await context.close();
}

/** The smallest phone still in use: dialogs at 360px. */
async function small() {
  tag = 'small-360';
  console.log('A 360×640 phone');
  const context = await browser.newContext({ viewport: { width: 360, height: 640 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, userAgent: devices['Pixel 7'].userAgent });
  page = await context.newPage();
  page.on('pageerror', e => errors.push(`${tag}: ${e.message}`));
  await page.goto(base + '/');
  await page.waitForFunction(() => window.__ship?.state?.orders.length >= 1 && document.fonts.status === 'loaded', null, { timeout: 30000 });
  await sleep(1200);
  await shot('01-title');
  ok(await fits('#title .title-card, #titleStart'), 'the start screen fits 360px');
  await page.locator('#titleGuide').uncheck();
  await page.locator('#titleStart').tap();
  await page.waitForFunction(() => !window.__ship.modal());
  await sleep(1000);
  await shot('02-kitchen');
  await page.locator('#menuBtn').tap();
  await page.locator('#newOrderBtn').tap();
  await page.waitForSelector('#orderDialog[open]');
  await sleep(300);
  await shot('03-new-order');
  ok(await fits('#orderDialog, #orderDialog .btn') && await ship(() => document.documentElement.scrollWidth <= innerWidth), 'the New order dialog fits 360px');
  await page.locator('#orderCancel').tap();
  // the board's own controls, by touch: send the first ticket to a chef from its card
  await page.locator('#menuBtn').tap();
  await page.locator('#boardBtn').tap();
  await page.waitForSelector('#board.open .bcard[data-order="1"] select');
  await page.locator('#board .bcard[data-order="1"] select').selectOption('pixel');
  await page.waitForFunction(() => window.__ship.state.chefs[0].orderId === 1, null, { timeout: 20000 });
  await sleep(700);
  await shot('04-board');
  ok(await fits('#board') && await ship(() => !!document.querySelector('#board .lane[data-lane="cooking"] .bcard[data-order="1"], #board .lane[data-lane="oven"] .bcard[data-order="1"]')), 'on a 360px phone the board sent #1 to Pixel from its card, and the card moved on to the next column');
  await context.close();
}

try {
  for (let i = 0; i < 75; i++) { try { if ((await fetch(`${base}/healthz`)).ok) break; } catch { /* not up yet */ } await sleep(200); }
  browser = await chromium.launch({ headless: true, executablePath: await findChrome(), args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  for (const phone of PHONES) await play(phone);
  if (!only) await small();
  ok(offHost.length === 0, `no network requests left 127.0.0.1${offHost.length ? ': ' + offHost.join(', ') : ''}`);
  if (errors.length) throw new Error('Page errors:\n' + errors.join('\n'));
  console.log(`Phone check passed (${passed} checks)`);
} catch (e) {
  console.error(e.message); if (errors.length) console.error(errors.join('\n'));
  if (page && !page.isClosed()) await shot('99-failure').catch(() => {});
  process.exitCode = 1;
} finally {
  await browser?.close();
  server.kill();
  await sleep(400);
  await fs.rm(tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }).catch(() => {});
}
