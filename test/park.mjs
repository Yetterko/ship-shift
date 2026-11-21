// The park modules on their own (public/park-test.html), played by two people against one shared-link server:
// Ana on a laptop with the keyboard, Ben on an iPhone held upright with nothing but touch.
//   1. Both step out into the park and see each other walk (keys on one side, the thumb stick on the other).
//   2. The kanban by hand: take a customer, queue it at your own door, the dish rule, a cross-team offer answered from the
//      tray (accept on the laptop, decline on the phone), all of it visible on the other screen.
//   3. The door sign (key on the laptop, the board's name card on the phone), emotes, the phrase wheel, the bell.
//   4. Going inside seats the queue; the chalkboard and the leaderboard; a 360 px wide phone keeps every control on screen.
//   5. A second town with 27 wandering bots: draw calls and labels stay inside the plan's budget, on both screens.
// Usage: node test/park.mjs [screenshot-dir]. Never opens a visible window and never runs a real agent.
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { chromium, devices } from 'playwright-core';

const shots = process.argv[2];
if (shots) await fs.mkdir(shots, { recursive: true });
const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'ship-shift-park-'));
const sleep = ms => new Promise(r => setTimeout(r, ms));
const DRAW_BUDGET = 250, LABEL_BUDGET = 16;
const clean = { SHIP_SIM: '', SHIP_SIM_ASK: '', SHIP_REAL_CHEFS: '', SHIP_CHEF_MODELS: '', SHIP_DEMO: '', SHIP_PUBLIC: '', SHIP_REPO: '', SHIP_DATA: '', SHIP_PUBLIC_ORIGIN: '', SHIP_WORLD: '', SHIP_MAX_SESSIONS: '', SHIP_IDLE_MIN: '' };
const servers = [];

const freePort = () => new Promise((resolve, reject) => { const s = net.createServer(); s.once('error', reject); s.listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => resolve(port)); }); });
async function serve(tag, env = {}) {
  const port = await freePort(), base = `http://127.0.0.1:${port}`;
  const child = spawn(process.execPath, ['server/index.mjs', '--public'], {
    env: { ...process.env, ...clean, SHIP_PACE: '80', SHIP_SIM_SPEED: '10', SHIP_TEAMS: '2', SHIP_WORLD_BOTS: '0', SHIP_RESET_TOKEN: 'park-test-token', SHIP_SESSIONS_DIR: path.join(tmp, `${tag}-sessions`), SHIP_TOWN_FILE: path.join(tmp, `${tag}-town.json`), PORT: String(port), ...env },
    stdio: 'ignore', windowsHide: true,
  });
  servers.push(child);
  for (let i = 0; i < 80; i++) { try { const h = await (await fetch(`${base}/healthz`)).json(); if (h.ok) return base; } catch { /* not up yet */ } await sleep(200); }
  throw new Error(`No town at ${base}`);
}
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
let passed = 0, browser;
const ok = (cond, msg) => { if (!cond) throw new Error('FAILED: ' + msg); passed++; console.log('  ok', msg); };
const shot = async (who, name) => { if (shots) await who.page.screenshot({ path: path.join(shots, `${name}.png`) }); };

/** One player in their own browser context: their own cookie, so their own kitchen and plot. */
async function join(base, name, { phone = false, viewport = { width: 1440, height: 900 }, query = '' } = {}) {
  const context = await browser.newContext(phone === true ? { ...devices['iPhone 13'], deviceScaleFactor: 2 } : phone ? { viewport: phone, deviceScaleFactor: 2, isMobile: true, hasTouch: true, userAgent: devices['Pixel 7'].userAgent } : { viewport });
  const page = await context.newPage();
  page.on('pageerror', e => errors.push(`${name}: ${e.message}`));
  // a refusal (409, 403) is part of the game: the browser logs it, the player reads it in a toast
  page.on('console', m => { if (m.type() === 'error' && !/status of 40[39]/.test(m.text())) errors.push(`${name}: ${m.text()}`); });
  page.on('request', r => { const u = new URL(r.url()); if (!['127.0.0.1', 'localhost'].includes(u.hostname) && !['data:', 'blob:'].includes(u.protocol)) offHost.push(r.url()); });
  await page.goto(`${base}/park-test.html${query}`, { waitUntil: 'domcontentloaded', timeout: 90000 });
  await page.waitForFunction(() => window.__park?.ready && window.__park.zone === 'park' && window.__park.me.visible && document.fonts.status === 'loaded', null, { timeout: 60000 });
  const who = { name, page, context, phone: !!phone };
  Object.assign(who, await page.evaluate(() => ({ pid: __park.world.you.pid, plot: __park.world.you.plot, team: __park.world.you.team })));
  if (phone) who.cdp = await context.newCDPSession(page);
  return who;
}
const ev = (who, fn, arg) => who.page.evaluate(fn, arg);
const until = (who, fn, arg, ms = 15000) => who.page.waitForFunction(fn, arg, { timeout: ms }).catch(async e => { const at = await who.page.evaluate(() => ({ me: [__park.me.x.toFixed(2), __park.me.z.toFixed(2)], zone: __park.zone, hot: __park.hot()?.kind, acts: __park.actions(), toasts: [...document.querySelectorAll('.toast')].map(t => t.textContent) })).catch(() => null); throw new Error(`${who.name} waited ${ms} ms for ${String(fn).slice(0, 170)} :: ${JSON.stringify(at)} :: ${e.message.split(String.fromCharCode(10))[0]}`); });
const card = (who, id) => ev(who, id => __park.world.cards.find(c => c.id === id) || null, id);
const plotOf = (who, id) => ev(who, id => __park.world.plots[id], id);
const walk = (who, x, z) => ev(who, ([x, z]) => __park.walkTo(x, z), [x, z]);
/** A finger on something in the park. The player first walks to just south of it, so it is on screen and clear of the controls. */
const tapGround = async (who, x, z, y = 0, back = 3) => {
  await walk(who, x + 0.4, Math.min(8.2, z + back));
  await sleep(700);
  const p = await ev(who, ([x, z, y]) => __park.screenOf(x, z, y), [x, z, y]);
  const clear = await ev(who, ([px, py]) => document.elementFromPoint(px, py)?.tagName === 'CANVAS', [p.x, p.y]);
  if (!clear) throw new Error(`${who.name}: the tap at ${Math.round(p.x)},${Math.round(p.y)} would land on the HUD, not on the park`);
  await who.page.touchscreen.tap(Math.round(p.x), Math.round(p.y));
};
const tap = async (who, sel) => { const b = await who.page.locator(sel).first().boundingBox(); if (!b) throw new Error(`Nothing to tap at ${sel}`); await who.page.touchscreen.tap(Math.round(b.x + b.width / 2), Math.round(b.y + b.height / 2)); };
/** Walks up to a customer in the backlog and answers with whichever one the card on screen names (they stand close together). */
async function nearestCard(who, c) {
  await walk(who, c.x + 0.8, c.z + 0.5);
  await until(who, () => __park.hot()?.kind === 'card');
  return card(who, await ev(who, () => __park.hot().id));
}
/** A customer in this player's team backlog whose dish is not one of `not`. */
const backlogCard = (who, not = []) => who.page.waitForFunction(not => { const w = __park.world; return w.cards.find(c => c.state === 'backlog' && c.team === w.you.team && !not.includes(c.title)) || null; }, not, { timeout: 30000 }).then(h => h.jsonValue());

try {
  browser = await chromium.launch({ headless: true, executablePath: await findChrome(), args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const base = await serve('main');

  /* ======================= 1. two people in one park ======================= */
  console.log('1. presence');
  const ana = await join(base, 'ana'), ben = await join(base, 'ben', { phone: true });
  ok(ana.team !== ben.team, `Ana is on the ${ana.team} team and Ben on the ${ben.team} team`);
  await until(ana, pid => __park.players().some(p => p.pid === pid), ben.pid);
  await until(ben, pid => __park.players().some(p => p.pid === pid), ana.pid);
  ok(true, 'each sees the other standing in the park');
  ok(await ev(ben, () => document.body.classList.contains('touch') && getComputedStyle(document.getElementById('pkPad')).display === 'grid'), 'the phone shows the touch pad');
  await sleep(600);
  await shot(ana, '01-park-desktop'); await shot(ben, '01-park-phone');

  const a0 = await ev(ben, pid => __park.players().find(p => p.pid === pid), ana.pid);
  await ana.page.keyboard.down('KeyD'); await until(ana, x => __park.me.x > x + 2.5, a0.x); await ana.page.keyboard.up('KeyD'); await sleep(400);
  const aMe = await ev(ana, () => ({ x: __park.me.x, z: __park.me.z }));
  ok(aMe.x > a0.x + 2, `Ana walked east with the keyboard (${a0.x.toFixed(1)} to ${aMe.x.toFixed(1)})`);
  await until(ben, ([pid, x]) => Math.abs(__park.players().find(p => p.pid === pid).x - x) < 0.25, [ana.pid, aMe.x], 5000);
  ok(true, 'Ben sees Ana arrive where she stopped');

  // the thumb stick: a finger dragged on the lawn
  const b0 = await ev(ben, () => ({ x: __park.me.x, z: __park.me.z }));
  const thumb = { x: 120, y: 520 };
  await ben.cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ ...thumb, id: 1 }] });
  for (let i = 1; i <= 6; i++) { await ben.cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: thumb.x, y: thumb.y + i * 9, id: 1 }] }); await sleep(30); }
  await until(ben, z => __park.me.z > z + 2, b0.z);
  ok(await ev(ben, () => !document.getElementById('pkThumb').hidden), 'the thumb stick is drawn under the finger');
  await shot(ben, '02-stick-phone');
  await ben.cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  const bMe = await ev(ben, () => ({ x: __park.me.x, z: __park.me.z }));
  ok(bMe.z > b0.z + 1.5, `Ben walked south with the thumb stick (${b0.z.toFixed(1)} to ${bMe.z.toFixed(1)})`);
  await until(ana, ([pid, z]) => Math.abs(__park.players().find(p => p.pid === pid).z - z) < 0.25, [ben.pid, bMe.z], 5000);
  ok(true, 'Ana sees Ben arrive where he stopped');

  /* ======================= 2. the kanban by hand ======================= */
  console.log('2. take, put, the dish rule, an offer');
  const first = await nearestCard(ana, await backlogCard(ana));
  ok((await ev(ana, () => __park.actions()))[0]?.label === 'Take', 'next to a customer of her team, E says Take');
  await ana.page.keyboard.press('KeyE');
  await until(ana, ([id, pid]) => __park.world.cards.find(c => c.id === id)?.heldBy === pid, [first.id, ana.pid]);
  await until(ben, id => __park.cards().find(c => c.id === id)?.state === 'held', first.id);
  ok(true, 'Ana took a customer with E, and on Ben\'s phone it left the backlog');
  const mine = await plotOf(ana, ana.plot);
  await walk(ana, mine.x, mine.z);
  await until(ana, ([id, x, z]) => { const c = __park.cards().find(c => c.id === id); return c && Math.hypot(c.x - x, c.z - z) < 1.6; }, [first.id, mine.x, mine.z], 8000);
  ok(true, 'the customer followed her to her door');
  await shot(ana, '03-held-desktop');
  ok((await ev(ana, () => __park.actions())).find(a => a.key === 'E')?.label === 'Queue', 'on her own doormat with a customer, E says Queue');
  await ana.page.keyboard.press('KeyE');
  await until(ben, ([id, plot]) => { const c = __park.world.cards.find(c => c.id === id); return c?.state === 'queued' && c.plot === plot; }, [first.id, ana.plot]);
  ok(true, 'E on her own doormat queued it, and Ben\'s phone shows it at her door');
  await sleep(700);
  await shot(ana, '04-queued-desktop');

  // Ben, by touch: tap a customer of his own team to take it, then tap Ana's door to offer it
  const same = await ev(ben, title => __park.world.cards.find(c => c.state === 'backlog' && c.team === __park.world.you.team && c.title === title) || null, first.title);
  if (same) {
    await tapGround(ben, same.x, same.z, 0.6);
    await until(ben, ([id, pid]) => __park.world.cards.find(c => c.id === id)?.heldBy === pid, [same.id, ben.pid]);
    await tapGround(ben, mine.x, mine.z);
    await until(ben, () => [...document.querySelectorAll('.toast.bad')].some(t => /already serves/.test(t.textContent)), null, 15000);
    ok((await card(ben, same.id)).state === 'held', 'the dish rule: Ana already has that dish at her door, so the offer is refused and Ben keeps the customer');
    await shot(ben, '05-dish-rule-phone');
    await tap(ben, '#pkPut');
    await until(ben, id => __park.world.cards.find(c => c.id === id)?.state === 'backlog', same.id);
    ok(true, 'the phone\'s Send back button returned it to his team\'s backlog');
  }
  const atHers = await ev(ana, () => __park.world.cards.filter(c => c.plot === __park.world.you.plot).map(c => c.title));
  const gift = await backlogCard(ben, atHers);
  await tapGround(ben, gift.x, gift.z, 0.6);
  await until(ben, ([id, pid]) => __park.world.cards.find(c => c.id === id)?.heldBy === pid, [gift.id, ben.pid]);
  ok(true, 'Ben tapped a customer of his team: he walked over and took it');
  await shot(ben, '06-held-phone');
  await tapGround(ben, mine.x, mine.z);
  await until(ana, id => __park.world.cards.find(c => c.id === id)?.state === 'offered', gift.id, 20000);
  const offered = await card(ana, gift.id);
  ok(offered.plot === ana.plot && offered.fromTeam === ben.team, 'Ben tapped Ana\'s door: a cross-team customer becomes an offer, marked with his team');
  await until(ana, () => !!document.querySelector('#pkOffers .pk-offer'));
  await sleep(500);
  await shot(ana, '07-offer-desktop'); await shot(ben, '07-offer-phone');
  ok(/Offered by the/.test(await ana.page.locator('#pkOffers .pk-offer small').first().textContent()), 'Ana\'s tray says who offered it');
  await ana.page.locator('#pkOffers [data-offer="accept"]').first().click();
  await until(ben, ([id, plot]) => { const c = __park.world.cards.find(c => c.id === id); return c?.state === 'queued' && c.plot === plot; }, [gift.id, ana.plot]);
  ok((await card(ben, gift.id)).team === ana.team, 'Ana accepted: it joined her queue and her team');

  // and the other way: Ana offers by keyboard, Ben declines by touch
  const back = await nearestCard(ana, await backlogCard(ana, [first.title, gift.title]));
  await ana.page.keyboard.press('KeyE');
  await until(ana, ([id, pid]) => __park.world.cards.find(c => c.id === id)?.heldBy === pid, [back.id, ana.pid]);
  const bens = await plotOf(ana, ben.plot);
  await walk(ana, bens.x, bens.z);
  await until(ana, () => __park.hot()?.kind === 'door');
  ok(/^Offer to /.test((await ev(ana, () => __park.actions())).find(a => a.key === 'E')?.label), 'on another team\'s doormat E says Offer');
  await ana.page.keyboard.press('KeyE');
  await until(ben, () => !!document.querySelector('#pkOffers [data-offer="decline"]'));
  await sleep(300);
  await shot(ben, '08-offer-tray-phone');
  await tap(ben, '#pkOffers [data-offer="decline"]');
  await until(ana, id => __park.world.cards.find(c => c.id === id)?.state === 'backlog', back.id);
  ok((await card(ana, back.id)).team === ana.team, 'Ben declined with a tap: the customer is back in Ana\'s team\'s backlog');
  ok((await ev(ana, () => __park.world.feed.map(f => f.text))).some(t => /declined/.test(t)), 'every move is named in the feed');

  /* ======================= 3. the door sign, emotes, the wheel, the bell ======================= */
  console.log('3. door sign, emotes, phrases, the bell');
  await walk(ana, mine.x, mine.z);
  await until(ana, () => __park.hot()?.kind === 'door' && __park.actions().some(a => a.key === 'R'));
  await ana.page.keyboard.press('KeyR');
  await until(ana, () => !document.getElementById('pkSign').hidden);
  await shot(ana, '09-sign-desktop');
  await ana.page.locator('#pkSign [data-sign="help"]').click();
  await until(ben, plot => __park.world.plots[plot].sign === 'help', ana.plot);
  ok(true, 'Ana set her door sign to Help wanted with R, and Ben sees it');
  // Ben sets his from the board's name card, by touch
  await tap(ben, '#pkPad [data-pk="B"]');
  await until(ben, () => document.getElementById('townBoard').classList.contains('open'));
  await sleep(450);
  await shot(ben, '10-board-phone');
  ok(await ev(ben, () => document.querySelectorAll('#townBoard .tw-pane[data-pane="town"] .bcard').length > 0), 'the phone\'s Board button opens the town kanban with cards on it');
  await tap(ben, '#townBoard [data-tab="you"]');
  await until(ben, () => !!document.querySelector('#townBoard [data-do="sign"][data-id="private"]'));
  await ben.page.locator('#townBoard [data-do="sign"][data-id="private"]').scrollIntoViewIfNeeded();
  await sleep(200);
  await shot(ben, '11-you-phone');
  await tap(ben, '#townBoard [data-do="sign"][data-id="private"]');
  await until(ana, plot => __park.world.plots[plot].sign === 'private', ben.plot);
  ok(true, 'Ben set his door to Private from the name card, by touch');
  await tap(ben, '#townBoard [data-close]');
  await until(ben, () => !document.getElementById('townBoard').classList.contains('open'));
  await sleep(700);
  await shot(ana, '12-signs-desktop');

  await ana.page.keyboard.press('Digit1');
  await until(ben, pid => __park.presence.sample(pid)?.e === 1, ana.pid, 5000);
  ok(true, 'Ana waved with the 1 key, and Ben\'s phone shows it');
  await tap(ben, '#pkPad [data-pk="G"]');
  await until(ben, () => !document.getElementById('pkWheel').hidden);
  await tap(ben, '#pkWheel [data-emote="4"]');
  await until(ana, pid => __park.presence.sample(pid)?.e === 4, ben.pid, 5000);
  ok(true, 'Ben sent a heart from the Emote button, and Ana sees it');
  await shot(ana, '13-emote-desktop');
  await sleep(2700);
  await tap(ben, '#pkPad [data-pk="C"]');
  await until(ben, () => !document.getElementById('pkWheel').hidden && document.getElementById('pkWheel').dataset.mode === 'say');
  await sleep(200);
  await shot(ben, '14-wheel-phone');
  await tap(ben, '#pkWheel [data-say="1"]');
  await until(ana, pid => __park.presence.sample(pid)?.e === 11, ben.pid, 5000);
  await until(ana, () => [...document.querySelectorAll('.pk-say')].some(e => /Need a hand/.test(e.textContent)), null, 3000);
  ok(true, 'Ben picked a phrase on the wheel, and it appears over his head on Ana\'s screen');
  await shot(ana, '15-phrase-desktop');
  await ana.page.keyboard.press('KeyC');
  await until(ana, () => !document.getElementById('pkWheel').hidden);
  await sleep(200);
  await shot(ana, '16-wheel-desktop');
  await ana.page.keyboard.press('Digit4');
  await until(ben, pid => __park.presence.sample(pid)?.e === 13, ana.pid, 5000);
  ok(await ev(ana, () => document.getElementById('pkWheel').hidden), 'on the laptop C opens the wheel and a number picks the phrase');

  // the bell: Ben taps the fountain, walks up and rings it
  await tapGround(ben, 0, 0, 1.2, 5);
  await until(ana, () => !!__park.world.rush, null, 20000);
  ok(true, 'Ben tapped the fountain: he walked up and rang the lunch bell');
  await until(ana, () => !document.getElementById('pkRush').hidden && __park.world.cards.some(c => c.rush));
  await sleep(900);
  await shot(ana, '17-rush-desktop'); await shot(ben, '17-rush-phone');
  ok(/to seat/.test(await ana.page.locator('#pkRush').textContent()), 'the strip counts the rush down and how many are left to seat');

  /* ======================= 4. inside, the boards, a small phone ======================= */
  console.log('4. inside, boards, small screens');
  await walk(ana, mine.x, mine.z);
  await until(ana, () => __park.hot()?.kind === 'door' && __park.actions()[0]?.label === 'Go inside');
  await ana.page.keyboard.press('KeyE');
  await until(ana, plot => __park.zone === `k:${plot}`, ana.plot);
  ok(await ev(ana, () => !document.getElementById('inside').hidden && document.getElementById('parkUi').hidden), 'E on her doormat takes Ana inside, and the park\'s controls step aside');
  await until(ben, id => ['seated', 'cooking', 'review', 'served'].includes(__park.world.cards.find(c => c.id === id)?.state), first.id, 20000);
  ok(true, 'with the owner inside, a queued customer walks in and becomes an order');
  await until(ben, id => !__park.cards().some(c => c.id === id), first.id, 8000);
  ok(await ev(ben, plot => __park.world.plots[plot].open === true, ana.plot), 'Ben sees her customer leave the lawn and her door marked open');
  await ana.page.locator('#insideOut').click();
  await until(ana, () => __park.zone === 'park' && __park.me.visible);
  ok(true, 'stepping outside puts her back on her doormat');

  await ana.page.keyboard.press('KeyB');
  await until(ana, () => document.getElementById('townBoard').classList.contains('open'));
  await sleep(450);
  await shot(ana, '18-board-desktop');
  const lanes = await ev(ana, () => Object.fromEntries([...document.querySelectorAll('#townBoard .tw-pane[data-pane="town"] [data-count]')].map(b => [b.dataset.count, Number(b.textContent)])));
  ok(lanes.backlog > 0 && lanes.queued + lanes.seated + lanes.cooking + lanes.review + lanes.served > 0, `the chalkboard sorts the town into columns (${JSON.stringify(lanes)})`);
  const sendable = await ana.page.locator('#townBoard select[data-do="send"]').count();
  if (sendable) ok(/Send to/.test(await ana.page.locator('#townBoard select[data-do="send"] option').first().textContent()), 'a customer in her own queue has Send to… on its card');
  await ana.page.locator('#townBoard [data-tab="kitchen"]').click();
  await until(ana, () => !!document.querySelector('#townBoard .tw-kb .lane'));
  await sleep(300);
  await shot(ana, '19-kitchen-board-desktop');
  ok(await ev(ana, () => document.querySelectorAll('#townBoard .tw-kb .bcard').length > 0), 'the My kitchen tab is the kitchen board (board.js) with her orders on it');
  await ana.page.locator('#townBoard [data-tab="leaderboard"]').click();
  await sleep(300);
  await shot(ana, '20-leaderboard-desktop');
  ok(await ev(ana, () => document.querySelectorAll('#townBoard .tw-teams li').length === 2 && document.querySelectorAll('#townBoard .tw-plots li').length === 2), 'the leaderboard lists both teams and both restaurants');
  await ana.page.locator('#townBoard [data-tab="you"]').click();
  await ana.page.locator('#twName').fill('Ana');
  await ana.page.locator('#townBoard .tw-name button').click();
  await until(ben, pid => __park.world.players.find(p => p.pid === pid)?.name === 'Ana', ana.pid);
  await ana.page.locator('#townBoard [data-do="look"][data-id="4"]').click();
  await until(ben, pid => __park.world.players.find(p => p.pid === pid)?.look === 4, ana.pid);
  ok(true, 'the name card renames her and changes her apron, and Ben sees both');
  await sleep(300);
  await shot(ana, '21-you-desktop');
  await ana.page.keyboard.press('Escape');
  await until(ana, () => !document.getElementById('townBoard').classList.contains('open'));
  await ana.page.keyboard.press('KeyV');
  await sleep(1500);
  await shot(ana, '22-town-view-desktop');
  await ana.page.keyboard.press('KeyV');

  // a 360 px wide phone, and a phone on its side
  const cal = await join(base, 'cal', { phone: { width: 360, height: 640 } });
  await sleep(800);
  await shot(cal, '23-park-360');
  const fit = await ev(cal, () => {
    const r = sel => { const e = document.querySelector(sel); const b = e.getBoundingClientRect(); return { l: b.left, r: b.right, t: b.top, b: b.bottom, w: b.width }; };
    return { w: innerWidth, h: innerHeight, strip: r('#pkStrip'), card: r('#pkCard'), pad: r('#pkPad'), feed: r('#pkFeed'), scroll: document.documentElement.scrollWidth };
  });
  ok(fit.w === 360 && fit.scroll <= 360, 'at 360 px wide nothing makes the page scroll sideways');
  ok(fit.strip.l >= 0 && fit.strip.r <= 360 && fit.feed.r <= 360 && fit.pad.r <= 360 && fit.card.l >= 0, 'the strip, the feed, the card and the pad are all on screen');
  ok(fit.card.r <= fit.pad.l + 1 && fit.strip.b <= fit.feed.t + 1, 'the card stops short of the pad, and the feed sits under the strip');
  const card360 = await backlogCard(cal);
  await tapGround(cal, card360.x, card360.z, 0.6);
  await until(cal, ([id, pid]) => __park.world.cards.find(c => c.id === id)?.heldBy === pid, [card360.id, cal.pid]);
  await sleep(400);
  await shot(cal, '24-held-360');
  ok(await ev(cal, () => !document.getElementById('pkPut').hidden), 'holding a customer, the small phone shows Send back on the pad');
  await tap(cal, '#pkPad [data-pk="C"]');
  await until(cal, () => !document.getElementById('pkWheel').hidden);
  await sleep(250);
  await shot(cal, '25-wheel-360');
  const wheel = await ev(cal, () => [...document.querySelectorAll('#pkWheel [data-say], #pkWheel [data-emote]')].map(b => b.getBoundingClientRect()).every(b => b.left >= 0 && b.right <= innerWidth && b.bottom <= innerHeight && b.width >= 40 && b.height >= 40));
  ok(wheel, 'every phrase and emote on the wheel is on screen and big enough for a thumb');
  await tap(cal, '#pkWheel [data-pk="Escape"]');
  await cal.page.setViewportSize({ width: 740, height: 360 });
  await sleep(900);
  await shot(cal, '26-park-landscape');
  const side = await ev(cal, () => { const b = s => document.querySelector(s).getBoundingClientRect(); return { card: b('#pkCard'), pad: b('#pkPad'), h: innerHeight, layout: document.getElementById('parkUi').dataset.layout }; });
  ok(side.layout === 'landscape' && side.pad.top >= 0 && side.pad.bottom <= side.h && side.card.right <= side.pad.left + 1, 'on its side the pad fits the height and the card stays clear of it');
  await cal.context.close();

  /* ======================= 5. a crowd: the budget ======================= */
  console.log('5. the budget, with 27 bots');
  const crowd = await serve('crowd', { SHIP_WORLD_BOTS: '27' });
  const dee = await join(crowd, 'dee'), eli = await join(crowd, 'eli', { phone: true });
  for (const who of [dee, eli]) {
    await until(who, () => __park.players().length >= 28, null, 20000);
    await walk(who, 0, 3.4);
    await sleep(2500);
    const s = await ev(who, () => ({ ...__park.stats(), labels: __park.labels(), players: __park.players().length, cards: __park.cards().length, fps: __park.quality.fps }));
    console.log(`     ${who.phone ? 'phone ' : 'laptop'}: ${s.calls} draw calls, ${Math.round(s.triangles / 1000)}k triangles, ${s.chars} people drawn, ${s.labels} labels, outlines ${s.outline ? 'on' : 'off'}`);
    ok(s.players >= 28 && s.chars >= 29, `${who.phone ? 'the phone' : 'the laptop'} draws all 27 bots and both players as full characters (${s.chars} people)`);
    ok(s.outline && s.calls > 0 && s.calls <= DRAW_BUDGET, `${s.calls} draw calls with outlines, inside the budget of ${DRAW_BUDGET}`);
    ok(s.labels <= (who.phone ? 10 : LABEL_BUDGET), `${s.labels} labels, inside the budget of ${who.phone ? 10 : LABEL_BUDGET}`);
    await shot(who, who.phone ? '27-crowd-phone' : '27-crowd-desktop');
  }
  const p0 = await ev(dee, () => __park.players().filter(p => p.bot).map(p => [p.pid, p.x, p.z]));
  await sleep(1200);
  const moved = await ev(dee, p0 => p0.filter(([pid, x, z]) => { const p = __park.players().find(q => q.pid === pid); return p && Math.hypot(p.x - x, p.z - z) > 0.3; }).length, p0);
  ok(moved >= 15, `the bots wander smoothly (${moved} of 27 moved in a second)`);
  await ev(dee, () => __park.park.setOverview(true));
  await sleep(1600);
  const far = await ev(dee, () => ({ ...__park.stats(), labels: __park.labels() }));
  ok(far.calls <= DRAW_BUDGET && far.labels <= LABEL_BUDGET, `the whole-town view holds the budget too (${far.calls} calls, ${far.labels} labels)`);
  await shot(dee, '28-crowd-town-view');

  ok(errors.length === 0, `no page errors${errors.length ? ': ' + errors.slice(0, 4).join(' | ') : ''}`);
  ok(offHost.length === 0, `nothing was requested from another host${offHost.length ? ': ' + offHost[0] : ''}`);
  console.log(`\nPARK OK: ${passed} checks passed`);
} catch (e) {
  console.error(e.message);
  if (errors.length) console.error('page errors:', errors.slice(0, 6).join('\n  '));
  process.exitCode = 1;
} finally {
  await browser?.close().catch(() => {});
  for (const s of servers) s.kill();
  await sleep(300);
  await fs.rm(tmp, { recursive: true, force: true }).catch(() => {});
}
