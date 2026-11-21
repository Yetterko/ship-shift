// Headless run of the 3D kitchen with simulated chefs, in two parts.
// 1. The mechanics, in a plain kitchen: walk (with collision), hand out tickets, prep, spice, answer in the bubble, taste,
//    call out, review, carry, ship, plus the help sheet, presenter mode and tap-to-act.
// 2. The demo, played the way a first-time visitor meets it: start screen, the walkthrough from the window to main, then
//    the moments that only show up when things go wrong (smoke, fire, what a wait costs, the oven lever re-firing, the
//    conflict string, a cold plate and its send-back) and the end of the round: stars, then play again.
// 3. The board (L): the same kitchen without taking a step. New order, plan, bin, send to a chef, answer, the shift clock,
//    review and ship, all from the cards.
// Usage: node test/game.mjs [screenshot-dir]. Never opens a visible window and never runs a real agent.
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright-core';
import { ensureDemoRepo, STARTER_ORDERS } from '../server/demo-repo.mjs';

const shots = process.argv[2];
if (shots) await fs.mkdir(shots, { recursive: true });
const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'ship-shift-3d-'));
const sleep = ms => new Promise(r => setTimeout(r, ms));
const servers = [];
const clean = { SHIP_SIM: '', SHIP_SIM_ASK: '', SHIP_REAL_CHEFS: '', SHIP_CHEF_MODELS: '', SHIP_PACE: '', SHIP_DEMO: '', SHIP_PUBLIC: '', SHIP_REPO: '', SHIP_DATA: '' };
function serve(args, env) {
  const child = spawn(process.execPath, ['server/index.mjs', ...args], { env: { ...process.env, ...clean, ...env }, stdio: 'ignore', windowsHide: true });
  servers.push(child);
}
async function up(base) { for (let i = 0; i < 75; i++) { try { await fetch(`${base}/api/state`); return; } catch { await sleep(200); } } throw new Error(`No kitchen at ${base}`); }

async function findChrome() {
  if (process.env.SHIP_CHROME) return process.env.SHIP_CHROME;
  const dir = path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), '.cache'), 'ms-playwright');
  const entries = (await fs.readdir(dir).catch(() => [])).filter(d => d.startsWith('chromium_headless_shell-')).sort().reverse();
  for (const e of entries) for (const sub of await fs.readdir(path.join(dir, e))) {
    const exe = path.join(dir, e, sub, process.platform === 'win32' ? 'chrome-headless-shell.exe' : 'chrome-headless-shell');
    if (await fs.stat(exe).then(() => true, () => false)) return exe;
  }
}

const errors = [], offHost = [];
let passed = 0, browser, page;
const ok = (cond, msg) => { if (!cond) throw new Error('FAILED: ' + msg); passed++; console.log('  ok', msg); };
const shot = async (name, clip) => { if (shots) await page.screenshot({ path: path.join(shots, `${name}.png`), ...(clip ? { clip } : {}) }); };
const ship = fn => page.evaluate(fn);
const order = id => page.evaluate(id => window.__ship.state.orders.find(o => o.id === id), id);
const walk = async (id, until, ms = 30000, arg) => {
  await page.evaluate(id => window.__ship.walkTo(id), id);
  await page.waitForFunction(until, arg, { timeout: ms });
};
const slotFor = async id => {
  await page.waitForFunction(id => window.__ship.slotOf.has(id), id, { timeout: 120000 });
  return page.evaluate(id => `slot${window.__ship.slotOf.get(id)}`, id);
};
const pos = () => ship(() => ({ x: window.__ship.player.g.position.x, z: window.__ship.player.g.position.z }));
const freeChef = () => ship(() => `chef${window.__ship.state.chefs.findIndex(c => !c.orderId)}`);
const post = (url, body = {}) => page.evaluate(([url, body]) => fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }).then(r => r.ok), [url, body]);
const idOf = title => page.evaluate(t => window.__ship.state.orders.find(o => o.title === t)?.id ?? null, title);

async function open(base) {
  page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('request', r => { const u = new URL(r.url()); if (!['127.0.0.1', 'localhost'].includes(u.hostname) && !['data:', 'blob:'].includes(u.protocol)) offHost.push(r.url()); });
  await page.goto(base + '/');
  await page.waitForSelector('canvas');
  await page.waitForFunction(() => window.__ship?.state && document.fonts.status === 'loaded', null, { timeout: 30000 });
}

/** Reviews every hunk of the plate, approves it, carries it to the hatch and ships it. */
async function reviewAndShip(id) {
  const slot = await page.evaluate(id => `pass${window.__ship.passSlotOf.get(id)}`, id);
  await walk(slot, () => document.querySelector('#review.open .hunk'));
  const hunks = await page.locator('#review .hunk').count();
  for (let i = 0; i < hunks; i++) await page.keyboard.press('KeyJ');
  await page.keyboard.press('Enter');
  await page.waitForFunction(id => window.__ship.state.orders.find(o => o.id === id).approved === true && !document.querySelector('#review.open'), id, { timeout: 30000 });
  await walk(slot, id => window.__ship.player.carry?.type === 'plate' && window.__ship.player.carry.id === id, 20000, id);
  await walk('hatch', id => window.__ship.state.orders.find(o => o.id === id).state === 'shipped', 60000, id);
}

/* ======================= part 1: the mechanics ======================= */
async function mechanics() {
  console.log('The kitchen, in a plain simulated run');
  const repo = path.join(tmp, 'repo'), PORT = 4697, base = `http://127.0.0.1:${PORT}`;
  await ensureDemoRepo(repo);
  serve([], { SHIP_SIM: '1', SHIP_SIM_SPEED: '1', SHIP_REPO: repo, SHIP_DATA: path.join(tmp, 'data'), PORT: String(PORT) });
  await up(base);
  // #1 a clean small fix, #2 asks a question, #3 asks to npm install
  for (const o of [STARTER_ORDERS[0], STARTER_ORDERS[1], STARTER_ORDERS[3]]) {
    await fetch(`${base}/api/orders`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(o) });
  }
  await open(base);
  await page.waitForFunction(() => window.__ship.state.orders.length >= 3);
  await sleep(1500);

  /* ---------- the start screen, without the walkthrough ---------- */
  ok(await ship(() => document.getElementById('title').classList.contains('open') && window.__ship.modal()), 'the page opens on the start screen');
  await page.locator('#titleGuide').uncheck();
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => !window.__ship.modal() && document.querySelectorAll('.tk').length >= 3);
  ok(await ship(() => window.__ship.guide.on === false && window.__ship.state.shift.mode === 'off'), 'Enter opens the kitchen; with the walkthrough unticked nothing points and no clock starts');
  await sleep(1200);

  /* ---------- the picture ---------- */
  await shot('01-start');
  const look = await ship(() => window.__ship.look());
  ok(look.floorFrac >= 0.72, `the floor fills ${(look.floorFrac * 100).toFixed(0)}% of the stage width (72% or more)`);
  ok(look.chefPx >= 90, `a chef stands ${Math.round(look.chefPx)}px tall (90px or more)`);
  ok(look.labels >= 7 && look.overlaps === 0, `${look.labels} labels on screen, none overlapping`);
  ok((await ship(() => window.__ship.state.chefs.length)) === 4, 'four chefs on the line');
  ok((await ship(() => window.__ship.quality.pr)) <= 1.5, 'the pixel ratio is capped at 1.5');

  /* ---------- help sheet and presenter mode ---------- */
  await page.keyboard.press('Shift+Slash');
  await page.waitForSelector('#help.open');
  await sleep(400);
  await shot('02-help');
  ok((await page.locator('#helpReal dt').count()) >= 10 && /git worktree/.test(await page.locator('#helpReal').innerText()), '? opens the help sheet: the controls, and what each station really does with agents');
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => !window.__ship.modal());
  await page.keyboard.press('KeyP');
  await page.waitForFunction(() => window.__ship.presenter.on);
  await sleep(900);
  await shot('03-presenter');
  const big = await ship(() => window.__ship.look());
  ok(big.overlaps === 0 && (await ship(() => getComputedStyle(document.querySelector('.m.spend')).display)) === 'none', `P is presenter mode: bigger labels (${big.labels}, none overlapping) and the small print is gone`);
  await page.keyboard.press('KeyP');
  await page.waitForFunction(() => !window.__ship.presenter.on);

  /* ---------- walking and collision ---------- */
  const p0 = await pos();
  await page.keyboard.down('KeyS'); await sleep(1500); await page.keyboard.up('KeyS');
  const p1 = await pos();
  ok(p1.z > p0.z + 0.3 && p1.z <= 0.105, `walking down stops at the island (z ${p0.z.toFixed(2)} -> ${p1.z.toFixed(2)})`);
  await page.keyboard.down('KeyS'); await page.keyboard.down('KeyD'); await sleep(900); await page.keyboard.up('KeyS'); await page.keyboard.up('KeyD');
  const p2 = await pos();
  ok(p2.x > p1.x + 0.5, `and slides along it instead of sticking (x ${p1.x.toFixed(2)} -> ${p2.x.toFixed(2)})`);
  await page.keyboard.down('KeyW'); await page.keyboard.press('ShiftLeft'); await sleep(1800); await page.keyboard.up('KeyW');
  const p3 = await pos();
  ok(p3.z >= -2.41 && p3.z < -2.2, `a dash up the room stops at the stoves (z ${p3.z.toFixed(2)})`);
  // a walk across the room goes round the island, never through it
  await page.evaluate(() => { const s = window.__ship; s.trail = []; s.trailT = setInterval(() => s.trail.push(s.blocked(s.player.g.position.x, s.player.g.position.z, 0.25)), 30); });
  await walk('prep', () => window.__ship.near === 'prep' && !window.__ship.player.path);
  await walk('bin', () => window.__ship.near === 'bin' && !window.__ship.player.path);
  const trail = await ship(() => { const s = window.__ship; clearInterval(s.trailT); return { n: s.trail.length, hit: s.trail.filter(Boolean).length }; });
  ok(trail.n > 5 && trail.hit === 0, `path finding walked to the prep board and the bin without touching a counter (${trail.n} samples)`);

  /* ---------- tickets: by tap alone first ---------- */
  await page.evaluate(id => window.__ship.walkTo(id, { act: false }), await slotFor(1));
  await page.waitForFunction(() => window.__ship.near?.startsWith('slot') && !window.__ship.player.path);
  await page.locator('#card .k[data-k="E"]').click();
  await page.waitForFunction(() => window.__ship.player.carry?.id === 1);
  ok(true, 'tapping the E hint on the card takes the ticket: every key hint is a button');
  await walk('chef0', () => window.__ship.state.chefs[0].orderId === 1);
  ok(true, 'took ticket #1 from the window and gave it to Pixel');

  await walk(await slotFor(3), () => window.__ship.player.carry?.id === 3);
  await walk('prep', () => window.__ship.state.orders.find(o => o.id === 3).plan, 30000);
  ok(true, 'the prep board planned ticket #3');
  await walk('jar-install', () => window.__ship.player.carry?.type === 'jar');
  await walk('prep', () => window.__ship.state.orders.find(o => o.id === 3).grants?.includes('install'));
  ok((await ship(() => window.__ship.player.carry)) === null, 'shook the Install jar onto ticket #3, and the jar went back to the rack');
  await shot('04-prep-and-spice');
  await walk('prep', () => window.__ship.player.carry?.id === 3);
  await walk('chef2', () => window.__ship.state.chefs[2].orderId === 3);

  /* ---------- a blocked chef: answer in the bubble, nothing pauses ---------- */
  await walk(await slotFor(2), () => window.__ship.player.carry?.id === 2);
  await walk('chef1', () => window.__ship.state.chefs[1].orderId === 2);
  await page.waitForFunction(() => window.__ship.state.questions.some(q => q.orderId === 2), null, { timeout: 30000 });
  await walk('chef1', () => document.querySelector('.bub li[data-key="1"]'));
  await sleep(400);
  await shot('05-question-bubble');
  ok(!(await page.locator('dialog[open]').count()), 'the question is a bubble over the chef, not a dialog');
  const before = await ship(() => window.__ship.fx.sounds);
  await page.keyboard.press('Digit1');
  await page.waitForFunction(() => !window.__ship.state.questions.some(q => q.orderId === 2), null, { timeout: 10000 });
  ok((await ship(() => window.__ship.fx.sounds)) > before, 'key 1 answered it');

  /* ---------- call out, then taste ---------- */
  await page.waitForFunction(() => window.__ship.state.orders.find(o => o.id === 2).state === 'cooking' && !window.__ship.state.questions.length, null, { timeout: 10000 });
  await page.keyboard.press('KeyF');
  await page.waitForSelector('#lineInput:focus', { timeout: 5000 });
  await page.keyboard.type('use round2');
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => window.__ship.state.stats.steers >= 1 && window.__ship.state.orders.find(o => o.id === 2).activity.some(a => /called out: use round2/.test(a.text)), null, { timeout: 20000 });
  ok(true, 'F called out one line and the chef heard it');
  await page.waitForFunction(() => window.__ship.state.orders.find(o => o.id === 2).state === 'cooking', null, { timeout: 20000 });
  await page.keyboard.press('KeyE');
  await page.waitForFunction(() => window.__ship.ui.taste === 'chef1' && window.__ship.ui.wip && !window.__ship.ui.wip.error && document.querySelector('.wip .file'), null, { timeout: 20000 });
  await sleep(500);
  await shot('06-taste');
  ok(true, 'E at a cooking chef tastes the pot: the live diff is in the focus card');
  ok((await order(3)).state !== 'waiting' && !(await ship(() => window.__ship.state.questions.some(q => q.orderId === 3 && q.kind === 'permission'))), 'the spiced order is cooking without asking to install');

  /* ---------- the plate rides to the pass on its own ---------- */
  await page.waitForFunction(() => window.__ship.state.orders.find(o => o.id === 1).state === 'at_pass' && window.__ship.plates.get(1)?.mv.key?.startsWith('pass') && window.__ship.plates.get(1).mv.t >= 1, null, { timeout: 60000 });
  ok((await ship(() => window.__ship.player.carry)) === null, 'plate #1 went chef -> oven -> pass by itself; the player never carried it');
  await shot('07-plate-at-pass');

  /* ---------- review, docked, with the kitchen still running ---------- */
  const slot = await ship(() => `pass${window.__ship.passSlotOf.get(1)}`);
  await walk(slot, () => document.querySelector('#review.open .hunk'));
  await sleep(900);
  ok(!(await page.locator('dialog[open]').count()) && (await ship(() => { const r = document.getElementById('review').getBoundingClientRect(); return r.left / innerWidth; })) > 0.5, 'review opened as a panel docked on the right');
  const hunks = await page.locator('#review .hunk').count();
  for (let i = 0; i < hunks; i++) await page.keyboard.press('KeyJ');
  await page.keyboard.press('KeyK');
  await sleep(200);
  ok(await ship(() => window.__ship.diffSeen(window.__ship.state.orders.find(o => o.id === 1))), `J and K walked all ${hunks} hunks, so the diff counts as seen`);
  const tools = await ship(() => window.__ship.state.orders.reduce((n, o) => n + o.activity.length, 0));
  await shot('08-review-docked');
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => window.__ship.state.orders.find(o => o.id === 1).approved === true, null, { timeout: 10000 });
  ok((await order(1)).state === 'at_pass', 'Enter approved it; nothing merged yet');
  await page.waitForFunction(() => !document.querySelector('#review.open'));

  /* ---------- carry the approved plate to the hatch ---------- */
  await sleep(500);
  await shot('09-approved-cloche');
  await walk(slot, () => window.__ship.player.carry?.type === 'plate' && window.__ship.player.carry.id === 1);
  const fx0 = await ship(() => ({ ...window.__ship.fx }));
  await walk('hatch', () => window.__ship.state.orders.find(o => o.id === 1).state === 'shipped', 60000);
  const fx1 = await ship(() => ({ ...window.__ship.fx })), st = await ship(() => window.__ship.state.stats);
  ok(st.shipped === 1 && st.blindShips === 0, `carried it to the hatch and shipped #1 to main, score ${st.score}`);
  ok(fx1.popups > fx0.popups && fx1.shakes > fx0.shakes && fx1.sounds > fx0.sounds && fx1.banners > fx0.banners, `juice fired: ${fx1.popups} popups, ${fx1.shakes} shakes, ${fx1.sounds} sounds, ${fx1.banners} banner`);
  ok((await ship(() => window.__ship.state.orders.reduce((n, o) => n + o.activity.length, 0))) > tools, 'the other chefs kept working the whole time');
  await page.close();
}

/* ======================= part 2: the demo, as a first-time player ======================= */
async function demo() {
  console.log('The demo, as someone who has never seen it');
  const PORT = 4698, base = `http://127.0.0.1:${PORT}`;
  // The roles the demo's menu plays, by title, so a reordered menu still finds them.
  const title = i => STARTER_ORDERS[i].title;
  const T = { first: title(0), asks: title(1), sunday: 'Sunday penalty rate', holiday: 'Public holiday rate' };
  for (const t of [T.sunday, T.holiday]) if (!STARTER_ORDERS.some(o => o.title === t)) throw new Error(`The demo menu has no "${t}" order: update the roles in test/game.mjs`);
  serve(['--demo'], { SHIP_DEMO_DIR: path.join(tmp, 'demo'), SHIP_SIM_SPEED: '3', PORT: String(PORT) });
  await up(base);
  await open(base);
  await page.waitForFunction(() => window.__ship.state.orders.length >= 1 && document.querySelector('.tk'), null, { timeout: 30000 });
  await sleep(1500);
  const guideIs = (step, ms = 60000) => page.waitForFunction(step => window.__ship.guide.step === step && window.__ship.guide.target, step, { timeout: ms });
  const follow = async (until, ms = 20000, arg) => { await page.evaluate(() => window.__ship.walkTo(window.__ship.guide.target)); await page.waitForFunction(until, arg, { timeout: ms }); };
  const lineIs = re => ship(() => window.__ship.guide.line).then(l => re.test(l));

  /* ---------- start screen ---------- */
  await shot('10-title');
  const card = await page.locator('#title .title-card').innerText();
  ok(/simulated/i.test(card) && /real Claude agent/i.test(card), 'the start screen says in one line that these chefs are simulated, and real Claude agents in real mode');
  ok(await ship(() => window.__ship.state.shift.mode === 'off' && window.__ship.state.driver === 'sim'), 'nothing is on the clock while the start screen is up');
  await page.locator('#titleStart').click();
  await page.waitForFunction(() => !window.__ship.modal() && window.__ship.guide.on);

  /* ---------- the walkthrough: take, give, answer, review, ship ---------- */
  await guideIs('take'); await sleep(900);
  await shot('11-guide-take');
  ok(await lineIs(/ticket/i) && (await page.locator('#questSteps li').count()) === 5, 'the walkthrough points at the first ticket, with the five steps listed in the HUD');
  await follow(() => window.__ship.player.carry?.type === 'ticket');
  await guideIs('give'); await sleep(700);
  await shot('12-guide-give');
  await follow(() => window.__ship.state.orders[0].chefId);
  await page.waitForFunction(() => window.__ship.state.shift.mode === 'focus', null, { timeout: 10000 });
  ok(await ship(() => window.__ship.guide.done.take && window.__ship.guide.done.give), 'following the arrow took the ticket and gave it to a chef; the three minute clock started with that first ticket');
  await sleep(500);
  await shot('13-service-banner');
  // The demo's round is three real minutes. This run stops to take pictures, and may share the machine with other checks,
  // so it puts five minutes on the clock here and plays a one minute round of its own at the end.
  ok(await post('/api/shift/start', { focusMin: 5, breakMin: 1 }), 'the test gives itself a longer clock for the middle of the run');

  // while the first chef cooks, the arrow sends you for the next ticket, and that one asks a question
  const asks = await page.waitForFunction(t => window.__ship.state.orders.find(o => o.title === t && window.__ship.slotOf.has(o.id))?.id, T.asks, { timeout: 60000 }).then(h => h.jsonValue());
  await guideIs('take');
  await follow(() => window.__ship.player.carry?.type === 'ticket');
  await guideIs('give');
  await follow(id => window.__ship.state.orders.find(o => o.id === id).chefId, 20000, asks);
  await page.waitForFunction(id => window.__ship.state.questions.some(q => q.orderId === id), asks, { timeout: 30000 });
  await guideIs('answer'); await sleep(500);
  await shot('14-guide-answer');
  await follow(() => document.querySelector('.bub li[data-key="1"]'));
  await sleep(500);
  await shot('15-guide-answer-bubble');
  await page.locator('.bub li[data-key="1"]').click();
  await page.waitForFunction(id => !window.__ship.state.questions.some(q => q.orderId === id), asks, { timeout: 10000 });
  ok(await ship(() => window.__ship.guide.done.answer), 'the arrow led to the stuck chef, and a click on the first option answered it');

  /* ---------- the oven lever, and the plate it re-fires ---------- */
  await walk('oven', () => window.__ship.state.rules.autoRefire === true);
  await sleep(450);
  await shot('16-oven-lever');
  ok(true, 'E at the oven flips the re-fire lever on');
  await page.waitForFunction(id => window.__ship.state.orders.find(o => o.id === id).refires === 1, asks, { timeout: 90000 });
  await page.waitForFunction(() => [...document.querySelectorAll('.pop')].some(p => /re-fire/i.test(p.textContent)), null, { timeout: 15000 });
  await sleep(350);
  await shot('17-oven-refire');
  ok((await order(asks)).rounds === 0, `the failing plate #${asks} went straight back to its chef from the oven, with no send-back`);

  await page.waitForFunction(() => window.__ship.state.orders[0].state === 'at_pass', null, { timeout: 60000 });
  await guideIs('review'); await sleep(900);
  await shot('18-guide-review');
  await follow(() => document.querySelector('#review.open .hunk'));
  await sleep(900);
  await shot('19-guide-review-panel');
  ok(await page.locator('#rGuide').isVisible(), 'the review panel says it is the real diff and how to approve it');
  const hunks = await page.locator('#review .hunk').count();
  for (let i = 0; i < hunks; i++) await page.keyboard.press('KeyJ');
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => window.__ship.state.orders[0].approved && !document.querySelector('#review.open'), null, { timeout: 10000 });
  await guideIs('ship'); await sleep(700);
  await shot('20-guide-pick-up');
  await follow(() => window.__ship.player.carry?.type === 'plate');
  await page.waitForFunction(() => window.__ship.guide.target === 'hatch'); await sleep(250);
  await shot('21-guide-ship');
  await follow(() => window.__ship.state.orders[0].state === 'shipped', 60000);
  await sleep(380);
  await shot('22-ship-moment');
  await page.waitForFunction(() => !window.__ship.guide.on, null, { timeout: 5000 });
  ok(await ship(() => window.__ship.state.stats.shipped === 1 && window.__ship.state.stats.blindShips === 0), 'review, approve, carry, ship: the first plate is on main and the walkthrough is done, all five steps ticked');
  await sleep(700);
  await shot('23-guide-done');

  /* ---------- a chef left waiting: smoke, then fire, and what it cost ---------- */
  const sunday = await idOf(T.sunday);
  await walk(await slotFor(sunday), id => window.__ship.player.carry?.id === id, 20000, sunday);
  await walk(await freeChef(), id => window.__ship.state.orders.find(o => o.id === id).chefId, 20000, sunday);
  const holiday = await page.waitForFunction(t => window.__ship.state.orders.find(o => o.title === t)?.id, T.holiday, { timeout: 120000 }).then(h => h.jsonValue());
  await walk(await slotFor(holiday), id => window.__ship.player.carry?.id === id, 20000, holiday);
  const stove = await freeChef();
  await walk(stove, id => window.__ship.state.orders.find(o => o.id === id).chefId, 20000, holiday);
  await page.evaluate(() => window.__ship.walkTo('bin', { act: false }));
  await page.waitForFunction(id => window.__ship.state.questions.some(q => q.orderId === id), holiday, { timeout: 30000 });
  const level = n => page.waitForFunction(([id, n]) => { const s = window.__ship.state, q = s.questions.find(q => q.orderId === id); return q && window.__ship.now() - q.createdAt >= (n === 2 ? s.escalation.smokeMs : s.escalation.fireMs); }, [holiday, n], { timeout: 30000 });
  await sleep(600);
  await shot('24-chef-asks');
  await level(2); await sleep(900);
  await shot('25-chef-smoke');
  await level(3); await sleep(1100);
  await shot('26-chef-fire');
  ok(await ship(() => window.__ship.world.fires === 1 && !!document.querySelector('.lv3')), 'a chef left waiting smokes, then catches fire: the alarm counts one fire and its sign turns red');
  await walk(stove, () => document.querySelector('.bub li[data-key="1"]'));
  await page.waitForFunction(id => window.__ship.state.questions.find(q => q.orderId === id)?.charged > 0 && document.querySelector('.costline'), holiday, { timeout: 10000 });
  await sleep(300);
  await shot('27-question-cost');
  const cost = await ship(() => document.querySelector('.costline').innerText.replace(/\s+/g, ' '));
  ok(/cost you \d+ point/.test(cost) && (await page.locator('.bub .cost').count()) === 1, `the card and the bubble both say what the wait has cost: "${cost}"`);
  const always = await page.locator('.bub li[data-key="2"]').count();
  await page.keyboard.press(always ? 'Digit2' : 'Digit1');
  await page.waitForFunction(id => !window.__ship.state.questions.some(q => q.orderId === id), holiday, { timeout: 10000 });
  await sleep(600);
  await shot('28-always-jar');

  /* ---------- two plates that fight over the same lines: the string, the cold plate, the send-back ---------- */
  await page.waitForFunction(([a, b]) => { const s = window.__ship.state; return s.overlaps.some(x => x.includes(a) && x.includes(b) && x[3].length) && [a, b].every(id => window.__ship.plates.get(id)?.mv.key?.startsWith('pass') && window.__ship.plates.get(id).mv.t >= 1); }, [sunday, holiday], { timeout: 120000 });
  await page.evaluate(() => window.__ship.walkTo('prep', { act: false }));
  await sleep(1500);
  await shot('29-conflict-string');
  ok((await page.locator('.knot.conf').count()) === 1, 'two plates at the pass that cannot both merge are tied with a thick string that names the file');
  await reviewAndShip(sunday);
  await page.waitForFunction(id => window.__ship.state.orders.find(o => o.id === id).merge?.clean === false, holiday, { timeout: 20000 });
  await page.evaluate(() => window.__ship.walkTo('prep', { act: false }));
  await sleep(2800);
  await shot('30-cold-plate');
  await shot('30-cold-plate-close', { x: 1040, y: 300, width: 400, height: 400 });
  ok((await page.locator('.pt.cold').count()) === 1, `shipping #${sunday} left #${holiday} cold: frost on the plate and a cold tag over it`);
  const coldSlot = await page.evaluate(id => `pass${window.__ship.passSlotOf.get(id)}`, holiday);
  await walk(coldSlot, () => document.querySelector('#review.open .hunk'));
  await sleep(900);
  await shot('31-cold-review');
  ok(/merge main/i.test(await page.locator('#rBack').innerText()), 'the review of a cold plate offers to send it back to merge main, with no note needed');
  const scoreBefore = await ship(() => window.__ship.state.stats.score);
  await page.locator('#rBack').click();
  await page.waitForFunction(id => window.__ship.state.orders.find(o => o.id === id).state === 'cooking', holiday, { timeout: 10000 });
  await page.evaluate(() => window.__ship.walkTo('prep', { act: false }));
  await sleep(1500);
  await shot('32-cold-sent-back');
  await page.waitForFunction(id => { const o = window.__ship.state.orders.find(o => o.id === id); return o.state === 'at_pass' && o.merge?.clean === true && window.__ship.plates.get(id)?.mv.t >= 1; }, holiday, { timeout: 90000 });
  ok((await ship(() => window.__ship.state.stats)).conflicts === 0 && (await ship(() => window.__ship.state.stats.score)) === scoreBefore, 'the chef merged main and the plate came back warm, at no cost in points');
  await sleep(600);
  await shot('33-warm-again');

  /* ---------- the end of the round: a one minute shift with the warmed plate shipped in it ---------- */
  await post('/api/shift/start', { focusMin: 1, breakMin: 1 });
  await reviewAndShip(holiday);
  await page.evaluate(() => window.__ship.walkTo('prep', { act: false }));
  await page.waitForSelector('#reportDialog[open]', { timeout: 120000 });
  await sleep(2000);
  await shot('34-shift-report');
  const rep = await ship(() => ({ stars: document.querySelectorAll('#repStars .on').length, title: document.getElementById('repTitle').textContent, shipped: window.__ship.state.shift.report.shipped, again: !document.getElementById('repAgain').hidden }));
  ok(rep.stars >= 2 && rep.shipped >= 1 && rep.again, `the shift ends on its report: "${rep.title}", ${rep.stars} of 3 stars for ${rep.shipped} shipped, and a Play again button`);
  await page.locator('#repAgain').click();
  await page.waitForFunction(() => !document.querySelector('dialog[open]') && window.__ship.state.shift.mode === 'off' && window.__ship.state.orders.filter(o => o.state === 'waiting').length >= 1, null, { timeout: 15000 });
  await sleep(700);
  await shot('35-play-again');
  const next = await ship(() => window.__ship.state.orders.filter(o => o.state === 'waiting' && window.__ship.slotOf.has(o.id)).sort((a, b) => a.id - b.id)[0].id);
  await walk(await slotFor(next), id => window.__ship.player.carry?.id === id, 20000, next);
  await page.waitForFunction(() => window.__ship.state.shift.mode === 'focus', null, { timeout: 10000 });
  ok(true, 'Play again clears the clock and seats customers; taking the next ticket starts a new round');
  await page.close();
}

/* ======================= part 3: the board ======================= */
async function board() {
  console.log('The board: the same kitchen without walking');
  const repo = path.join(tmp, 'repo-board'), PORT = 4696, base = `http://127.0.0.1:${PORT}`;
  await ensureDemoRepo(repo);
  serve([], { SHIP_SIM: '1', SHIP_SIM_SPEED: '2', SHIP_REPO: repo, SHIP_DATA: path.join(tmp, 'data-board'), PORT: String(PORT) });
  await up(base);
  // #1 a clean small fix, #2 asks a question
  for (const o of [STARTER_ORDERS[0], STARTER_ORDERS[1]]) await fetch(`${base}/api/orders`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(o) });
  await open(base);
  await page.waitForFunction(() => window.__ship.state.orders.length >= 2);
  await sleep(1000);
  await page.locator('#titleGuide').uncheck();
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => !window.__ship.modal());
  const card = id => `#board .bcard[data-order="${id}"]`;
  const p0 = await pos();

  await page.keyboard.press('KeyL');
  await page.waitForSelector('#board.open');
  await sleep(700);
  await shot('40-board');
  const b = await ship(() => { const r = document.getElementById('board').getBoundingClientRect(); return { left: r.left / innerWidth, lanes: [...document.querySelectorAll('#board .lane h3')].map(h => h.textContent).join(' '), waiting: document.querySelectorAll('#board .lane[data-lane="waiting"] .bcard').length }; });
  ok(b.left >= 0.45 && b.lanes === 'Waiting Planning Cooking Blocked Oven Pass Shipped' && b.waiting === 2, `L opens the board as a drawer on the right, a kanban by state (${b.lanes}), with both tickets under Waiting`);
  ok(!(await page.locator('dialog[open]').count()) && (await ship(() => window.__ship.look().floorFrac)) > 0.3, 'the kitchen stays in view beside it and nothing is paused');

  await page.locator('#board [data-act="newOrder"]').click();
  await page.locator('#oTitle').fill('Tidy the README');
  await page.locator('#orderForm button[type="submit"]').click();
  await page.waitForSelector(card(3));
  await page.locator(`${card(3)} [data-act="plan"]`).click();
  await page.waitForFunction(() => window.__ship.state.orders.find(o => o.id === 3).plan, null, { timeout: 30000 });
  ok(await page.locator(`${card(3)} .chip2.plan`).count(), 'New order and Plan work from the board: #3 is created and planned');
  await page.locator(`${card(3)} [data-act="bin"]`).click();
  ok(/really/i.test(await page.locator(`${card(3)} [data-act="bin"]`).innerText()), 'Bin asks once more before it throws an order away');
  await page.locator(`${card(3)} [data-act="bin"]`).click();
  await page.waitForFunction(() => window.__ship.state.orders.find(o => o.id === 3).state === 'binned' && !document.querySelector('#board .bcard[data-order="3"]'), null, { timeout: 15000 });

  await page.locator(`${card(1)} select`).selectOption('pixel');
  await page.waitForFunction(() => window.__ship.state.chefs[0].orderId === 1, null, { timeout: 15000 });
  await page.locator(`${card(2)} select`).selectOption('router');
  await page.waitForFunction(() => window.__ship.state.chefs[1].orderId === 2, null, { timeout: 15000 });
  ok(true, '"Send to chef" put #1 with Pixel and #2 with Router');
  await page.waitForSelector(`#board .lane[data-lane="blocked"] .bcard[data-order="2"] .opt`, { timeout: 40000 });
  await sleep(400);
  await shot('41-board-question');
  await page.locator(`${card(2)} .opt`).first().click();
  await page.waitForFunction(() => !window.__ship.state.questions.length, null, { timeout: 15000 });
  ok(true, 'a blocked chef shows up under Blocked with the question on the card, and one click answers it from anywhere');

  await page.locator('#board [data-act="shift"]').click();
  await page.waitForFunction(() => window.__ship.state.shift.mode === 'focus', null, { timeout: 10000 });
  await page.locator('#board [data-act="shift"]').click();
  await page.waitForFunction(() => window.__ship.state.shift.mode === 'off', null, { timeout: 10000 });
  ok(true, 'the shift starts and ends from the board, with its focus and break lengths');

  await page.waitForSelector(`#board .lane[data-lane="pass"] .bcard[data-order="1"] [data-act="review"]`, { timeout: 90000 });
  await page.locator(`${card(1)} [data-act="review"]`).click();
  await page.waitForFunction(() => document.querySelector('#review.open .hunk') && !document.querySelector('#board.open'));
  await sleep(600);
  await shot('42-review-from-board');
  ok((await ship(() => window.__ship.near)) !== 'pass0', 'Review opens the plate from the board, without standing at the pass');
  const hunks = await page.locator('#review .hunk').count();
  for (let i = 0; i < hunks; i++) await page.keyboard.press('KeyJ');
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => window.__ship.state.orders[0].approved && !document.querySelector('#review.open'), null, { timeout: 30000 });
  await page.keyboard.press('KeyL');
  await page.locator(`${card(1)} [data-act="ship"]`).click();
  await page.waitForFunction(() => window.__ship.state.orders[0].state === 'shipped' && document.querySelector('#board .lane[data-lane="shipped"] .bcard[data-order="1"]'), null, { timeout: 60000 });
  await sleep(700);
  await shot('43-board-shipped');
  const end = await ship(() => ({ feed: document.querySelector('#board [data-feed]').innerText, blind: window.__ship.state.stats.blindShips, shipped: window.__ship.state.stats.shipped }));
  const p1 = await pos();
  ok(end.shipped === 1 && end.blind === 0 && /Shipped #1/.test(end.feed), 'Ship it merged #1 from the board: it is under Shipped and in the score feed');
  ok(Math.hypot(p1.x - p0.x, p1.z - p0.z) < 0.01, 'all of that without the head chef taking a step');
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => !document.querySelector('#board.open'));
  ok((await fetch(`${base}/board.html`)).status === 404, 'the old list view is gone');
  await page.close();
}

try {
  browser = await chromium.launch({ headless: true, executablePath: await findChrome(), args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const only = process.env.SHIP_GAME_PART;
  if (!only || only === 'mechanics') await mechanics();
  if (!only || only === 'demo') await demo();
  if (!only || only === 'board') await board();
  ok(offHost.length === 0, `no network requests left 127.0.0.1${offHost.length ? ': ' + offHost.join(', ') : ''}`);
  if (errors.length) throw new Error('Page errors:\n' + errors.join('\n'));
  console.log(`3D game check passed (${passed} checks)`);
} catch (e) {
  console.error(e.message); if (errors.length) console.error(errors.join('\n'));
  if (page && !page.isClosed()) await shot('99-failure').catch(() => {});
  process.exitCode = 1;
} finally {
  await browser?.close();
  for (const child of servers) child.kill();
  await sleep(300);
  await fs.rm(tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }).catch(() => {});
}
