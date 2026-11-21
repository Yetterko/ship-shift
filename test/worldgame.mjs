// The town, played by three people at once: two laptops and a phone held upright, each in its own browser context against
// one shared-link server. Ana (red, laptop) hosts, Ben (blue, laptop) is the stranger, Cal (red, phone) is the teammate.
//   1. Step outside (the walkthrough's last pointer), avatars in the park, the phone driven by touch alone.
//   2. The kanban: claim, the team rule, the dish rule, a same-team handoff, a cross-team offer (accept, decline, private),
//      and a customer who waits at the door until the owner is back inside.
//   3. Bounce at the door, then visiting: what a stranger and a teammate may do under each door sign.
//   4. The bell, a fresh kitchen, and the presenter's reset: both end in a clean slate, and the token never reaches a page.
//   5. A second town with 27 wandering bots: the park stays inside its draw-call and label budget.
// Everything a player does goes through window.__ship.town (see docs/town-integration.md) or real taps and keys.
// Usage: node test/worldgame.mjs [screenshot-dir]. Never opens a visible window and never runs a real agent.
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { chromium, devices } from 'playwright-core';
import { STARTER_ORDERS } from '../server/demo-repo.mjs';

const shots = process.argv[2];
if (shots) await fs.mkdir(shots, { recursive: true });
const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'ship-shift-town-'));
const sleep = ms => new Promise(r => setTimeout(r, ms));
const TOKEN = 'presenter-token-for-the-test';
const DRAW_BUDGET = 250, LABEL_BUDGET = 16;
const TITLE = Object.fromEntries(['close', 'overtime', 'sunday', 'export', 'holiday', 'wage', 'double'].map((k, i) => [k, STARTER_ORDERS[i].title]));
const clean = { SHIP_SIM: '', SHIP_SIM_ASK: '', SHIP_REAL_CHEFS: '', SHIP_CHEF_MODELS: '', SHIP_DEMO: '', SHIP_PUBLIC: '', SHIP_REPO: '', SHIP_DATA: '', SHIP_PUBLIC_ORIGIN: '', SHIP_WORLD: '', SHIP_MAX_SESSIONS: '', SHIP_IDLE_MIN: '' };
const servers = [];

const freePort = () => new Promise((resolve, reject) => { const s = net.createServer(); s.once('error', reject); s.listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => resolve(port)); }); });
async function serve(tag, env = {}) {
  const port = await freePort(), base = `http://127.0.0.1:${port}`;
  const child = spawn(process.execPath, ['server/index.mjs', '--public'], {
    env: { ...process.env, ...clean, SHIP_PACE: '80', SHIP_SIM_SPEED: '10', SHIP_TEAMS: '2', SHIP_WORLD_BOTS: '0', SHIP_RESET_TOKEN: TOKEN, SHIP_SESSIONS_DIR: path.join(tmp, `${tag}-sessions`), SHIP_TOWN_FILE: path.join(tmp, `${tag}-town.json`), PORT: String(port), ...env },
    stdio: 'ignore', windowsHide: true,
  });
  servers.push(child);
  for (let i = 0; i < 80; i++) { try { const h = await (await fetch(`${base}/healthz`)).json(); if (h.ok) return { base, health: () => fetch(`${base}/healthz`).then(r => r.json()) }; } catch { /* not up yet */ } await sleep(200); }
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

const errors = [], offHost = [], frames = [];
let passed = 0, browser, resetting = false;
const people = [];
const ok = (cond, msg) => { if (!cond) throw new Error('FAILED: ' + msg); passed++; console.log('  ok', msg); };
const shot = async (who, name) => { if (shots) await who.page.screenshot({ path: path.join(shots, `${name}.png`) }); };

/* ======================= one player ======================= */
/** Opens a page in its own context (its own cookie, so its own kitchen). phone: an iPhone 13 held upright, with a touch screen. */
async function join(base, name, { phone = false, viewport = { width: 1440, height: 900 }, query = '?quality=low' } = {}) {
  const context = await browser.newContext(phone ? { ...devices['iPhone 13'], deviceScaleFactor: 2 } : { viewport });
  const page = await context.newPage();
  const who = { name, page, context, phone, pid: null, plot: null, team: null };
  page.on('pageerror', e => errors.push(`${name}: ${e.message}`));
  // a refused move answers 4xx, and the browser logs every one of those; a reset drops every socket on purpose
  page.on('console', m => { if (m.type() === 'error' && !resetting && !/status of 4\d\d/.test(m.text())) errors.push(`${name}: ${m.text()}`); });
  page.on('request', r => { const u = new URL(r.url()); if (!['127.0.0.1', 'localhost'].includes(u.hostname) && !['data:', 'blob:'].includes(u.protocol)) offHost.push(r.url()); });
  page.on('websocket', ws => ws.on('framereceived', f => { if (typeof f.payload === 'string') frames.push(f.payload); }));
  await page.goto(`${base}/${query}`, { timeout: 90000 });
  await page.waitForSelector('canvas');
  await ready(who);
  people.push(who);
  return who;
}
/** The page has its kitchen and its place in the town. Fills in who they are. */
async function ready(who) {
  await who.page.waitForFunction(() => window.__ship?.state && window.__ship.town?.you && document.fonts.status === 'loaded', null, { timeout: 45000 });
  Object.assign(who, await who.page.evaluate(() => { const y = window.__ship.town.you; return { pid: y.pid, plot: y.plot, team: y.team, nick: y.name }; }));
}
/** Past the start screen. guide keeps the walkthrough. A phone taps; a laptop presses Enter. */
async function start(who, { guide = false } = {}) {
  const { page } = who;
  if (who.phone) { if (!guide) await page.locator('#titleGuide').uncheck(); await page.locator('#titleStart').tap(); }
  else { if (!guide) await page.locator('#titleGuide').uncheck(); await page.keyboard.press('Enter'); }
  await page.waitForFunction(() => !window.__ship.modal());
}

const town = (who, fn, arg) => who.page.evaluate(fn, arg);
const snap = who => who.page.evaluate(() => window.__ship.town.snap);
const zone = who => who.page.evaluate(() => window.__ship.town.zone);
const inZone = (who, z, ms = 30000) => who.page.waitForFunction(z => window.__ship.town.zone === z && window.__ship.town.mode === (z === 'park' ? 'park' : z === `k:${window.__ship.town.you.plot}` ? 'kitchen' : 'visit'), z, { timeout: ms });
/** A request from the player's own page, with their cookie. Returns the status with the body: a refusal has { error, code }. */
const api = (who, url, body = {}, method = 'POST') => who.page.evaluate(async ([url, body, method]) => {
  const r = await fetch(url, method === 'GET' ? {} : { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  return { ...(await r.json().catch(() => ({}))), status: r.status };
}, [url, body, method]);
/** A card as this player's page knows it, by id or by title and state. */
const card = (who, by) => who.page.evaluate(by => window.__ship.town.snap.cards.find(c => (by.id ? c.id === by.id : c.title === by.title) && (!by.state || c.state === by.state) && (!by.team || c.team === by.team)) || null, by);
const cardIs = (who, id, state, extra = {}, ms = 15000) => who.page.waitForFunction(([id, state, extra]) => {
  const c = window.__ship.town.snap.cards.find(c => c.id === id);
  return !!c && c.state === state && Object.entries(extra).every(([k, v]) => c[k] === v);
}, [id, state, extra], { timeout: ms });
const plotOf = (who, id) => who.page.evaluate(id => window.__ship.town.snap.plots[id], id);
const feedHas = (who, text, ms = 8000) => who.page.waitForFunction(text => window.__ship.town.snap.feed.some(f => f.text.includes(text)), text, { timeout: ms });
/** The kitchen this player owns, wherever they are standing. */
const home = who => who.page.evaluate(() => window.__ship.town.home);
const homeOrder = (who, cardId, ms = 20000) => who.page.waitForFunction(cardId => window.__ship.town.home.orders.find(o => o.cardId === cardId)?.id ?? false, cardId, { timeout: ms }).then(h => h.jsonValue());

/* ---------- the hook's verbs: each walks the player there and presses E, as a player would ---------- */
const enterPark = async who => { await town(who, () => window.__ship.town.enterPark()); await inZone(who, 'park'); };
const goHome = async who => { await town(who, () => window.__ship.town.goHome()); await inZone(who, `k:${who.plot}`); };
const visit = async (who, host) => { await town(who, plot => window.__ship.town.visit(plot), host.plot); await inZone(who, `k:${host.plot}`); };
const take = (who, id) => town(who, id => window.__ship.town.take(id), id);
const put = (who, id, plot) => town(who, ([id, plot]) => window.__ship.town.put(id, plot), [id, plot]);
const walkStation = async (who, id, until, arg, ms = 30000) => { await town(who, id => window.__ship.walkTo(id), id); await who.page.waitForFunction(until, arg, { timeout: ms }); };

/* ---------- fingers ---------- */
/** One tap on a station of the kitchen you are standing in. */
const tapStation = async (who, id) => {
  const p = await who.page.evaluate(id => { const s = window.__ship, st = s.stations.find(x => x.id === id); return s.screenOfPoint(st.top.x, st.top.y, st.top.z); }, id);
  await who.page.touchscreen.tap(p.x, p.y);
};
/**
 * Taps a spot in the park until something comes true. The follow camera shows only the lawn around you, so a spot that is
 * off the screen is walked up to first, and then the thing itself is tapped.
 */
async function tapPark(who, x, z, until, arg, ms = 45000) {
  const { page } = who, t0 = Date.now();
  let taps = 0, last = null;
  for (;;) {
    if (await page.evaluate(until, arg)) return taps;
    if (Date.now() - t0 > ms) {
      const seen = await page.evaluate(() => { const t = window.__ship.town; return { at: t.pos(), zone: t.zone, carry: t.snap.players.find(p => p.pid === t.you.pid)?.carry, toast: document.getElementById('toasts').textContent, stick: window.__ship.stick.id, modal: window.__ship.modal() }; });
      throw new Error(`${who.name} tapped towards (${x}, ${z}) ${taps} times and nothing came of it: ${JSON.stringify(seen)} last tap ${JSON.stringify(last)}`);
    }
    const p = await page.evaluate(([x, z]) => {
      const t = window.__ship.town, s = t.screenOf(x, z), me = t.pos(), c = t.screenOf(me.x, me.z);
      const bare = (px, py) => px > 10 && py > 10 && px < innerWidth - 10 && py < innerHeight - 10 && document.elementFromPoint(px, py)?.tagName === 'CANVAS';
      for (const dy of [0, 10, -10, 20]) if (bare(s.x, s.y + dy)) return { x: s.x, y: s.y + dy, direct: true };
      return null;
    }, [x, z]);
    if (p) { await page.touchscreen.tap(Math.round(p.x), Math.round(p.y)); taps++; last = p; for (let i = 0; i < 30 && !(await page.evaluate(until, arg)); i++) await sleep(100); continue; }
    // not on the screen yet: cross the lawn first (a blind tap on the way could land on somebody else's door), then tap the thing
    await page.evaluate(([x, z]) => window.__ship.town.walkTo(x * 0.92, z + (z < -6 ? 2.6 : z > 6 ? -2.6 : 1.6)), [x, z]);
    await sleep(300);
  }
}
/** Nothing sticks out of the screen. */
const fits = (who, sel) => who.page.evaluate(sel => [...document.querySelectorAll(sel)].filter(e => e.getClientRects().length).every(e => { const r = e.getBoundingClientRect(); return r.left >= -1 && r.right <= innerWidth + 1 && r.top >= -1 && r.bottom <= innerHeight + 1; }), sel);
const noSideScroll = who => who.page.evaluate(() => document.documentElement.scrollWidth <= innerWidth);

/* ======================= parts 1 to 4: three players, one town ======================= */
async function play() {
  console.log('A town of three: two laptops and a phone');
  const { base, health } = await serve('town', { SHIP_RUSH_S: '20', SHIP_BELL_S: '5' });
  const ana = await join(base, 'Ana'), ben = await join(base, 'Ben', { viewport: { width: 1280, height: 800 } }), cal = await join(base, 'Cal', { phone: true });
  const h = await health();
  ok(h.world === true && h.players === 3 && h.kitchens === 3, 'three pages are three kitchens and three players in one town');
  ok(new Set([ana.pid, ben.pid, cal.pid]).size === 3 && [ana, ben, cal].every(p => /^[a-f0-9]{6}$/.test(p.pid)) && new Set([ana.plot, ben.plot, cal.plot]).size === 3, 'each has a public id and a plot of their own');
  ok(ana.team === cal.team && ben.team !== ana.team, `the teams were dealt in turn: ${ana.nick} and ${cal.nick} are ${ana.team}, ${ben.nick} is ${ben.team}`);
  ok(await town(cal, () => window.__ship.touch.on && document.body.dataset.layout === 'portrait'), 'the third page is a phone held upright, with a touch screen');
  for (const who of [ana, ben, cal]) {
    ok(await town(who, () => { const s = window.__ship; return s.town.mode === 'kitchen' && s.town.zone === `k:${s.town.you.plot}` && s.state.orders.length === 1 && s.state.orders[0].state === 'waiting' && s.state.orders[0].cardId; }), `${who.name} starts in their own kitchen with one customer at the window, who came in from the town`);
  }

  /* ---------- step outside: the walkthrough points at the door once the first ticket is cooking ---------- */
  await start(ana, { guide: true });
  await start(ben);
  await start(cal);
  await ana.page.waitForFunction(() => window.__ship.guide.step === 'take' && window.__ship.guide.target, null, { timeout: 30000 });
  await walkStation(ana, await town(ana, () => window.__ship.guide.target), () => window.__ship.player.carry?.type === 'ticket');
  await ana.page.waitForFunction(() => window.__ship.guide.step === 'give' && window.__ship.guide.target);
  await walkStation(ana, await town(ana, () => window.__ship.guide.target), () => window.__ship.state.orders[0].chefId);
  await api(ana, '/api/shift/start', { focusMin: 90, breakMin: 1 });       // the round outlasts the test, so no report covers the town
  await ana.page.waitForFunction(() => window.__ship.guide.step === 'out' && window.__ship.guide.target === 'door' && /step outside/i.test(document.querySelector('.gd')?.textContent || ''), null, { timeout: 15000 });
  await shot(ana, '01-step-outside');
  ok(await town(ana, () => window.__ship.stations.some(s => s.id === 'door' && s.type === 'door')), 'with the first ticket cooking, the walkthrough points at the new Door station: "Step outside"');
  await walkStation(ana, 'door', () => window.__ship.town.zone === 'park');
  await inZone(ana, 'park');
  ok(await town(ana, () => window.__ship.guide.done.out === true), 'E at the door puts Ana in the park, and the walkthrough ticks the step off');
  if (await ana.page.locator('#questSkip').isVisible()) await ana.page.locator('#questSkip').click();
  const out = await town(ana, () => ({ at: window.__ship.town.pos(), mat: window.__ship.town.snap.plots[window.__ship.town.you.plot] }));
  ok(Math.hypot(out.at.x - out.mat.x, out.at.z - out.mat.z) < 1.5, 'she stands on her own doormat');
  ok((await plotOf(ben, ana.plot)).open === false, 'her restaurant shows "Back soon" to the others while she is out');

  /* ---------- presence ---------- */
  await enterPark(ben);
  const t0 = Date.now();
  await ana.page.waitForFunction(pid => window.__ship.town.players().some(p => p.pid === pid), ben.pid, { timeout: 5000, polling: 50 });
  const sawIn = Date.now() - t0;
  ok(sawIn <= 1000, `Ana sees Ben's avatar ${sawIn} ms after he steps out (1 s or less)`);
  ok(await town(ana, pid => { const p = window.__ship.town.players().find(p => p.pid === pid); return !!p.name && p.name === window.__ship.town.snap.players.find(x => x.pid === pid).name; }, ben.pid), 'the avatar carries his name');
  const spot = await town(ben, () => { const a = window.__ship.town.snap.teams.find(t => t.id === window.__ship.town.you.team).area; return { x: a.x - 2.5, z: a.z + 2.4 }; });
  await town(ben, p => window.__ship.town.walkTo(p.x, p.z), spot);
  await ana.page.waitForFunction(([pid, p]) => { const a = window.__ship.town.players().find(x => x.pid === pid); return a && Math.hypot(a.x - p.x, a.z - p.z) < 0.7; }, [ben.pid, spot], { timeout: 8000 });
  ok(true, 'Ben walks across the lawn and his avatar follows on Ana\'s screen');
  await sleep(600);
  await shot(ana, '02-park');
  ok(await noSideScroll(ana) && await town(ana, () => window.__ship.town.labels() <= 16), 'the park fits the laptop screen, with 16 labels or fewer');

  /* ---------- the phone, by touch alone: out of the door, a customer by the hand, to a teammate's door ---------- */
  await tapStation(cal, 'door');
  await inZone(cal, 'park');
  await sleep(700);
  await shot(cal, '02-park-phone');
  ok(await noSideScroll(cal) && await fits(cal, '.hud > *:not([hidden]):not(.tools), .pk-pad .tb, .pk-card'), 'one tap on the door took Cal outside; the park HUD and the touch buttons fit a phone held upright');
  ok(await town(cal, () => { const bs = [...document.querySelectorAll('.pk-pad .tb')].filter(b => b.getClientRects().length); return bs.length >= 4 && bs.every(b => b.getBoundingClientRect().width >= 44) && !document.querySelector('.pad').getClientRects().length; }), 'the park has its own touch pad in place of the kitchen pad, and every button is at least 44px across');
  // the bus has brought the rest of every menu by now
  for (const who of [ana, ben, cal]) await who.page.waitForFunction(() => { const t = window.__ship.town, mine = t.snap.cards.filter(c => c.state === 'backlog' && c.team === t.you.team).length; return mine >= 6; }, null, { timeout: 40000 });
  ok(await town(ana, () => { const t = window.__ship.town, area = t.snap.teams.find(x => x.id === t.you.team).area; return t.snap.cards.filter(c => c.state === 'backlog' && c.team === t.you.team).every(c => Math.hypot(c.x - area.x, c.z - area.z) <= area.r + 3); }), 'each team\'s backlog stands in its own corner of the park');
  // a thumb stick works on the lawn as it does in the kitchen
  const cdp = await cal.context.newCDPSession(cal.page);
  const thumb = await town(cal, () => { for (let y = Math.round(innerHeight * 0.5); y < innerHeight - 140; y += 12) for (let x = Math.round(innerWidth * 0.25); x < innerWidth * 0.6; x += 12) if ([0, 60].every(dx => document.elementFromPoint(x + dx, y)?.tagName === 'CANVAS')) return { x, y }; return null; });
  ok(thumb, 'there is bare lawn to put a thumb on');
  const p0 = await town(cal, () => window.__ship.town.pos());
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ ...thumb, id: 1 }] });
  for (let i = 1; i <= 6; i++) { await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: thumb.x + i * 9, y: thumb.y, id: 1 }] }); await sleep(30); }
  await sleep(700);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await sleep(300);
  const p1 = await town(cal, () => window.__ship.town.pos());
  ok(Math.hypot(p1.x - p0.x, p1.z - p0.z) > 0.8, `a drag is a thumb stick on the lawn too: Cal walked ${Math.hypot(p1.x - p0.x, p1.z - p0.z).toFixed(1)}`);
  // Customers stand in a huddle, and a finger picks whoever is nearest: Cal goes for the one with the most room around them.
  // Overtime and the export are kept for Ana's kitchen (they are the two dishes whose chefs ask something).
  const wage = await town(cal, keep => {
    const t = window.__ship.town, all = t.snap.cards.filter(c => c.state === 'backlog');
    const gap = c => Math.min(...all.filter(o => o !== c).map(o => Math.min(...[-1.2, -0.6, 0, 0.6, 1.2].map(dz => Math.hypot(o.x - c.x, o.z + dz - c.z)))));
    return all.filter(c => c.team === t.you.team && !keep.includes(c.title)).sort((a, b) => gap(b) - gap(a))[0];
  }, [TITLE.overtime, TITLE.export]);
  const [roleA, roleB, roleC] = [TITLE.sunday, TITLE.double, TITLE.holiday, TITLE.wage].filter(t => t !== wage.title);
  await tapPark(cal, wage.x, wage.z, id => window.__ship.town.snap.cards.find(c => c.id === id)?.state === 'held', wage.id);
  ok((await card(cal, { id: wage.id })).heldBy === cal.pid, 'Cal taps a customer in his team\'s backlog: he walks over and they follow him');
  const anaMat = await plotOf(cal, ana.plot);
  await tapPark(cal, anaMat.x, anaMat.z, id => window.__ship.town.snap.cards.find(c => c.id === id)?.state === 'queued', wage.id);
  await cardIs(ana, wage.id, 'queued');          // Cal's own page shows the move at once; everybody else hears a moment later
  const sent = await card(ana, { id: wage.id });
  ok(sent.plot === ana.plot && sent.from === cal.pid, 'he taps Ana\'s doormat and the customer joins her queue, sent by Cal: a handoff between teammates, by touch');
  await feedHas(ben, `${cal.nick} sent "${wage.title}" to ${ana.nick}`);
  ok(true, 'the move is named in everybody\'s feed');

  /* ---------- claim, and who may ---------- */
  const sunday = await card(ana, { title: roleA, state: 'backlog', team: ana.team });
  ok(await town(ben, id => window.__ship.town.cards().some(c => c.id === id && c.state === 'backlog'), sunday.id), 'Ben can see the red team\'s customers standing in the park');
  const claimed = await take(ana, sunday.id);
  ok(claimed.ok, 'Ana walks up to a customer in her backlog and claims them');
  await cardIs(ben, sunday.id, 'held', { heldBy: ana.pid });
  await ben.page.waitForFunction(id => !window.__ship.town.cards().some(c => c.id === id && c.state === 'backlog'), sunday.id, { timeout: 5000 });
  ok(true, 'on Ben\'s page that customer has left the backlog and follows Ana');
  await sleep(500);
  await shot(ana, '03-claimed');
  const sunday2 = await card(ben, { title: roleA, state: 'backlog', team: ana.team });
  const poach = await take(ben, sunday2.id);
  ok(!poach.ok && poach.code === 'team' && (await card(ben, { id: sunday2.id })).state === 'backlog', 'Ben cannot claim from another team\'s backlog: the server says so and the customer stays');

  /* ---------- a same-team handoff waits at the door until the owner is home ---------- */
  const handed = await put(ana, sunday.id, cal.plot);
  ok(handed.ok && handed.card.state === 'queued' && handed.card.from === ana.pid, 'Ana walks the customer to Cal\'s door: same team, so they queue at once');
  await cardIs(cal, sunday.id, 'queued', { plot: cal.plot });
  const dish = await take(ana, sunday2.id).then(r => r.ok ? put(ana, sunday2.id, cal.plot) : r);
  ok(!dish.ok && dish.code === 'dish' && /already serves that/.test(dish.error), `the same dish twice is refused: "${dish.error}"`);
  ok((await put(ana, sunday2.id, null)).ok, 'Q puts that one back in the backlog');
  await sleep(1500);
  ok((await card(cal, { id: sunday.id })).state === 'queued' && (await plotOf(ana, cal.plot)).open === false && !(await home(cal)).orders.some(o => o.cardId === sunday.id), 'Cal is still out, so the customer waits at his door');
  await sleep(300);
  await shot(cal, '04-queue-at-door-phone');
  const calMat = await plotOf(cal, cal.plot);
  await tapPark(cal, calMat.x, calMat.z, z => window.__ship.town.zone === z, `k:${cal.plot}`);
  await inZone(cal, `k:${cal.plot}`);
  const calOrder = await homeOrder(cal, sunday.id);
  await cardIs(ana, sunday.id, 'seated');
  ok(calOrder && (await home(cal)).orders.find(o => o.id === calOrder).title === roleA, `Cal taps his own doormat and goes in; the customer walks in after him and becomes order #${calOrder}`);

  /* ---------- a cross-team offer: accept, decline, and a private door ---------- */
  const double = await card(ana, { title: roleB, state: 'backlog', team: ana.team });
  ok((await take(ana, double.id)).ok, 'Ana claims another');
  const offer = await put(ana, double.id, ben.plot);
  ok(offer.ok && offer.card.state === 'offered' && offer.card.fromTeam === ana.team, 'at Ben\'s door it is an offer, because he is on the other team');
  await ben.page.waitForFunction(([plot, id]) => window.__ship.town.snap.plots[plot].offers.includes(id), [ben.plot, double.id], { timeout: 5000 });
  await feedHas(ben, 'offered by the');
  await sleep(500);
  await shot(ben, '05-offer');
  const grab = await take(ben, double.id);
  ok(!grab.ok && grab.code === 'taken', 'an offer cannot simply be taken');
  const notHers = await api(ana, `/api/world/cards/${double.id}/accept`);
  ok(notHers.status === 403 && notHers.code === 'owner', 'only the owner of the door accepts');
  await ben.page.locator(`.pk-offer [data-offer="accept"][data-id="${double.id}"]`).click();
  ok(true, 'the offer shows on his screen with Accept and Decline, and he accepts');
  await cardIs(ana, double.id, 'queued', { plot: ben.plot, team: ben.team, from: ana.pid });
  ok(true, 'the customer joins his queue and his team, and still remembers who brought them');
  await sleep(1200);
  ok((await card(ben, { id: double.id })).state === 'queued', 'Ben is in the park, so the customer waits');
  await shot(ben, '05b-queue-at-door');
  const wage2 = await card(ana, { title: roleC, state: 'backlog', team: ana.team });
  await take(ana, wage2.id);
  ok((await put(ana, wage2.id, ben.plot)).card?.state === 'offered' && (await town(ben, id => window.__ship.town.decline(id), wage2.id)).ok, 'a second offer, and Ben declines it');
  await cardIs(ana, wage2.id, 'backlog', { team: ana.team });
  ok(true, 'the declined customer is back in the red team\'s backlog');
  ok((await api(ben, '/api/world/sign', { sign: 'private' })).ok, 'Ben hangs "Private" on his door');
  await ana.page.waitForFunction(plot => window.__ship.town.snap.plots[plot].sign === 'private', ben.plot);
  const again = await take(ana, wage2.id);
  if (!again.ok) throw new Error(`Ana could not take the declined customer again: ${JSON.stringify(again)} ${JSON.stringify(await card(ana, { id: wage2.id }))} at ${JSON.stringify(await town(ana, () => window.__ship.town.pos()))}`);
  const shut = await put(ana, wage2.id, ben.plot);
  ok(!shut.ok && shut.code === 'sign', `a private door takes no offers from another team (${shut.code})`);
  await put(ana, wage2.id, null);
  await api(ben, '/api/world/sign', { sign: 'team' });
  await goHome(ben);
  const benOrder = await homeOrder(ben, double.id);
  ok(benOrder && (await home(ben)).orders.find(o => o.id === benOrder).title === roleB, `Ben goes back inside and the accepted customer becomes order #${benOrder} in his kitchen`);
  await ana.page.waitForFunction(plot => window.__ship.town.snap.plots[plot].open === true, ben.plot, { timeout: 5000 });
  ok(true, 'his restaurant is open again');

  /* ---------- Ana's own queue, then bounce at the door ---------- */
  const overtime = await card(ana, { title: TITLE.overtime, state: 'backlog', team: ana.team }), exportCard = await card(ana, { title: TITLE.export, state: 'backlog', team: ana.team });
  ok((await take(ana, overtime.id)).ok && (await take(ana, exportCard.id)).ok, 'Ana leads two customers at once');
  const third = await take(ana, wage2.id);
  ok(!third.ok && third.code === 'hands', 'and no more than two');
  ok((await put(ana, overtime.id, ana.plot)).card?.state === 'queued' && (await put(ana, exportCard.id, ana.plot)).card?.state === 'queued', 'E on her own doormat queues them: her to-do column');
  await goHome(ana);
  const [oOver, oExport, oWage] = [await homeOrder(ana, overtime.id), await homeOrder(ana, exportCard.id), await homeOrder(ana, wage.id)];
  ok(oOver && oExport && oWage, 'back inside, all three of her queued customers walk up to the order window');
  const slot = await ana.page.waitForFunction(id => window.__ship.slotOf.has(id) && `slot${window.__ship.slotOf.get(id)}`, oWage, { timeout: 20000 }).then(h => h.jsonValue());
  await walkStation(ana, slot, id => window.__ship.player.carry?.type === 'ticket' && window.__ship.player.carry.id === id, oWage);
  await town(ana, () => window.__ship.walkTo('door', { act: false }));
  await ana.page.waitForFunction(() => window.__ship.near === 'door', null, { timeout: 20000 });
  await sleep(350);
  await shot(ana, '06-bounce-at-the-door');
  ok(/E/.test(await ana.page.locator('#cardBody').innerText()) && /backlog|park/i.test(await ana.page.locator('#cardBody').innerText()), 'holding a waiting ticket at the door, the card offers to send the customer back to the park');
  await ana.page.keyboard.press('KeyE');
  await cardIs(ana, wage.id, 'backlog', { team: ana.team });
  ok(await town(ana, id => window.__ship.town.zone !== 'park' && window.__ship.player.carry === null && !window.__ship.state.orders.some(o => o.id === id && o.state === 'waiting'), oWage), 'E bounces it: the ticket is gone from her kitchen, the customer is back in the backlog, and she is still inside');

  /* ---------- visiting ---------- */
  for (const id of [oOver, oExport]) {
    const chefId = await town(ana, () => window.__ship.state.chefs.find(c => !c.orderId).id);
    // git can be busy for a moment with the plate that just reached the pass; the game itself tries twice
    let given;
    for (let i = 0; i < 4; i++) { given = await api(ana, `/api/orders/${id}/assign`, { chefId }); if (given.status === 200 || /cooking/.test(given.error || '')) break; await sleep(900); }
    ok(given.status === 200 || /cooking/.test(given.error || ''), `Ana gives #${id} to a chef (${given.status} ${given.error || ''})`);
    await ana.page.waitForFunction(id => window.__ship.state.orders.find(o => o.id === id).chefId, id);
  }
  await ana.page.waitForFunction(([a, b]) => [a, b].every(id => window.__ship.state.questions.some(q => q.orderId === id)), [oOver, oExport], { timeout: 60000 });
  const [q1, q2] = await town(ana, ([a, b]) => [a, b].map(id => { const s = window.__ship.state, q = s.questions.find(q => q.orderId === id); return { id: q.id, kind: q.kind, chef: `chef${s.chefs.findIndex(c => c.id === q.chefId)}` }; }), [oOver, oExport]);
  ok(q1.kind === 'question' && q2.kind === 'permission', 'two of her chefs are stuck: one has a question, one wants to run npm install');
  await ben.page.waitForFunction(plot => window.__ship.town.snap.plots[plot].lights.blocked === 2, ana.plot, { timeout: 10000 });
  ok(true, 'from the park her restaurant shows two blocked chefs');

  // a stranger
  await visit(ben, ana);
  await ben.page.waitForFunction(plot => window.__ship.town.visiting?.of === plot && window.__ship.state.questions.length === 2, ana.plot, { timeout: 10000 });
  const benSees = await town(ben, () => { const s = window.__ship; return { v: s.town.visiting, repo: 'repo' in s.state, input: s.state.questions.some(q => 'input' in q), banner: document.getElementById('visitBanner')?.textContent || '', hidden: document.getElementById('visitBanner')?.hidden, own: s.town.home.orders.length }; });
  ok(benSees.v.relation === 'stranger' && benSees.v.rights.watch && benSees.v.rights.cheer && !benSees.v.rights.answer && !benSees.v.rights.approve, 'Ben steps into Ana\'s kitchen as a stranger: he may watch and cheer');
  ok(!benSees.hidden && benSees.banner.includes(`Visiting ${ana.nick}`) && !benSees.repo && !benSees.input, `a banner says "Visiting ${ana.nick}'s kitchen", and her repo path and the commands her chefs asked to run never reach his page`);
  ok(benSees.own >= 2, 'his own kitchen carries on behind him');
  await ana.page.waitForFunction(pid => window.__ship.town.players().some(p => p.pid === pid), ben.pid, { timeout: 5000 });
  ok(true, 'Ana sees him walk in');
  await walkStation(ben, q1.chef, c => window.__ship.near === c, q1.chef);
  await sleep(500);
  await shot(ben, '07-visit-stranger');
  await ben.page.keyboard.press('Digit1');
  await ben.page.keyboard.press('KeyE');
  await sleep(900);
  const refused = await api(ben, `/api/world/kitchens/${ana.plot}/questions/${q1.id}/answer`, { allow: true, answers: {} });
  ok((await home(ana)).questions.some(q => q.id === q1.id) && refused.status === 403 && refused.code === 'sign', 'he presses 1 at the stuck chef and nothing happens; asked directly, the server refuses too');
  const pass1 = await ana.page.waitForFunction(() => { const s = window.__ship, o = s.town.home.orders.find(o => o.state === 'at_pass' && !o.approved); return o && s.passSlotOf.has(o.id) ? { id: o.id, st: `pass${s.passSlotOf.get(o.id)}` } : false; }, null, { timeout: 90000 }).then(h => h.jsonValue());
  await walkStation(ben, pass1.st, st => window.__ship.near === st, pass1.st);
  await ben.page.keyboard.press('KeyE');
  await sleep(700);
  const noReview = await api(ben, `/api/world/kitchens/${ana.plot}/orders/${pass1.id}/review`, { verdict: 'approve' });
  ok(await town(ben, () => !document.querySelector('#review.open') && window.__ship.player.carry === null) && noReview.status === 403 && noReview.code === 'sign', 'nor can he review the plate at her pass');
  const cheer = await api(ben, '/api/world/cheer', { plot: ana.plot });
  ok(cheer.ok && cheer.bonus === 5, 'he can cheer: +5 for Ana');

  // a teammate, on the phone
  await tapStation(cal, 'door');
  await inZone(cal, 'park');
  await tapPark(cal, anaMat.x, anaMat.z, z => window.__ship.town.zone === z, `k:${ana.plot}`);
  await inZone(cal, `k:${ana.plot}`);
  await cal.page.waitForFunction(plot => window.__ship.town.visiting?.of === plot && window.__ship.state.questions.length === 2, ana.plot, { timeout: 10000 });
  ok(await town(cal, () => { const v = window.__ship.town.visiting; return v.relation === 'team' && v.rights.answer && v.rights.approve; }), 'Cal taps Ana\'s doormat and walks in as a teammate: he may answer and approve');
  ok(await fits(cal, '#visitBanner') && await noSideScroll(cal), 'the visiting banner fits the phone');

  // Private: a teammate only watches
  await api(ana, '/api/world/sign', { sign: 'private' });
  await cal.page.waitForFunction(() => window.__ship.town.visiting.rights.answer === false && window.__ship.town.visiting.rights.cheer === false, null, { timeout: 5000 });
  await town(cal, c => window.__ship.walkTo(c), q2.chef);      // two chefs on fire side by side: their signs overlap the pots on a phone, so walk rather than tap
  await cal.page.waitForFunction(c => window.__ship.near === c, q2.chef, { timeout: 20000 });
  await sleep(600);
  await shot(cal, '08-visit-private-phone');
  if (await cal.page.locator('#qsheet li[data-key="1"]').isVisible()) await cal.page.locator('#qsheet li[data-key="1"]').tap();
  await sleep(800);
  const priv = await api(cal, `/api/world/kitchens/${ana.plot}/questions/${q2.id}/answer`, { allow: true });
  ok((await home(ana)).questions.some(q => q.id === q2.id) && priv.status === 403 && priv.code === 'sign', 'Ana hangs "Private": now even her teammate\'s tap on the answer does nothing, and the server refuses him');

  // Help wanted: a stranger may answer
  await api(ana, '/api/world/sign', { sign: 'help' });
  await ben.page.waitForFunction(() => window.__ship.town.visiting.rights.answer === true && window.__ship.town.visiting.rights.approve === false, null, { timeout: 5000 });
  await walkStation(ben, q1.chef, c => window.__ship.near === c, q1.chef);
  await sleep(400);
  await shot(ben, '09-visit-help-wanted');
  await ben.page.keyboard.press('Digit1');
  await ana.page.waitForFunction(id => !window.__ship.town.home.questions.some(q => q.id === id), q1.id, { timeout: 10000 });
  ok(true, 'Ana hangs "Help wanted": Ben presses 1 and her chef has his answer');
  await feedHas(ana, `${ben.nick} answered a question in ${ana.nick}'s kitchen`);
  ok((await api(ben, `/api/world/kitchens/${ana.plot}/orders/${pass1.id}/review`, { verdict: 'approve' })).code === 'sign', 'Help wanted is for questions only: a stranger still cannot approve');

  // Open to team: the teammate answers and approves, and still cannot ship
  await api(ana, '/api/world/sign', { sign: 'team' });
  await cal.page.waitForFunction(() => window.__ship.town.visiting.rights.answer === true, null, { timeout: 5000 });
  await town(cal, c => window.__ship.walkTo(c), q2.chef);      // two chefs on fire side by side: their signs overlap the pots on a phone, so walk rather than tap
  await cal.page.waitForSelector('#qsheet:not([hidden]) li[data-key="1"]', { timeout: 20000 });
  await sleep(400);
  await shot(cal, '10-visit-teammate-phone');
  await cal.page.locator('#qsheet li[data-key="1"]').tap();
  await ana.page.waitForFunction(id => !window.__ship.town.home.questions.some(q => q.id === id), q2.id, { timeout: 10000 });
  ok(true, 'with the door open to the team again, Cal taps "Once" on the phone and Ana\'s chef carries on');
  await tapStation(cal, pass1.st);
  await cal.page.waitForSelector('#review.open .hunk', { timeout: 30000 });
  await sleep(500);
  await shot(cal, '11-teammate-review-phone');
  ok(await town(cal, () => ['rBack', 'rBin'].every(id => { const el = document.getElementById(id); return el.hidden || !el.getClientRects().length; })) && await fits(cal, '#review, #rApprove'), 'a tap on the plate opens the real diff for him, with Approve and nothing else');
  await cal.page.locator('#rApprove').tap();
  await ana.page.waitForFunction(id => window.__ship.town.home.orders.find(o => o.id === id).approved === true, pass1.id, { timeout: 15000 });
  await feedHas(ana, `${cal.nick} approved a plate in ${ana.nick}'s kitchen`);
  ok(true, 'he approves it at her pass, and the feed says so');
  await cal.page.waitForFunction(() => !document.querySelector('#review.open'));
  await tapStation(cal, pass1.st);
  await cal.page.waitForFunction(st => window.__ship.near === st, pass1.st, { timeout: 20000 });
  await sleep(900);
  ok(await town(cal, () => window.__ship.player.carry === null) && (await home(ana)).orders.find(o => o.id === pass1.id).state === 'at_pass', 'the approved plate stays where it is: only the owner carries it to the hatch');

  /* ---------- leaving, and the bell ---------- */
  await cal.page.locator('#visitLeave').tap();
  await inZone(cal, 'park');
  ok(await town(cal, () => window.__ship.town.visiting === null && document.getElementById('visitBanner').hidden), 'Leave on the banner takes Cal back to the park, outside Ana\'s door');
  await enterPark(ben);
  await town(ben, () => window.__ship.town.walkTo(0.4, 2.4));
  const bell = await town(ben, () => window.__ship.town.bell());
  ok(bell.ok, 'Ben rings the fountain bell');
  await ana.page.waitForFunction(() => window.__ship.town.snap.rush && window.__ship.town.snap.cards.filter(c => c.rush).length === 6, null, { timeout: 8000 });
  await sleep(900);
  await shot(ben, '12-lunch-rush');
  await shot(cal, '12-lunch-rush-phone');
  ok(await town(ana, () => window.__ship.town.snap.rush.left === 6), 'lunch rush: the bus drops two walk-in customers for each of the three players');

  /* ---------- a fresh kitchen ---------- */
  const calMat2 = await plotOf(cal, cal.plot);
  await tapPark(cal, calMat2.x, calMat2.z, z => window.__ship.town.zone === z, `k:${cal.plot}`);
  await inZone(cal, `k:${cal.plot}`);
  ok((await home(cal)).orders.length >= 2, 'Cal is home, with more than one order on his rail');
  await cal.page.locator('#menuBtn').tap();
  await cal.page.locator('#startOverBtn').tap();
  await cal.page.waitForSelector('#startOver[open]');
  await sleep(300);
  await shot(cal, '13-start-over-phone');
  ok(await fits(cal, '#startOver, #freshGo') && await noSideScroll(cal), 'Start over fits the phone: a fresh kitchen for you, and the presenter\'s reset behind a token');
  await cal.page.locator('#freshGo').tap();
  await cal.page.waitForFunction(first => { const s = window.__ship.town.home; return s.orders.length === 1 && s.orders[0].title === first && s.orders[0].state === 'waiting' && s.stats.score === 0 && s.stats.shipped === 0 && s.chefs.every(c => !c.orderId) && s.questions.length === 0; }, TITLE.close, { timeout: 60000 });
  const fresh = await town(cal, () => { const t = window.__ship.town; return { you: t.you, plot: t.snap.plots[t.you.plot], dialog: !!document.querySelector('#startOver[open]'), carry: window.__ship.player.carry }; });
  ok(fresh.you.pid === cal.pid && fresh.you.plot === cal.plot && fresh.you.name === cal.nick && fresh.plot.bonus === 0 && fresh.plot.score === 0 && !fresh.dialog && fresh.carry === null, 'one tap on Fresh kitchen: a new kitchen on the same plot, the same name, score 0, and one customer at the window');
  await cardIs(ana, sunday.id, 'backlog', { team: ana.team });
  ok(true, 'the customers he had not finished are back in his team\'s backlog');
  await sleep(600);
  await shot(cal, '14-fresh-kitchen-phone');

  /* ---------- the presenter's reset ---------- */
  const before = { pids: [ana.pid, ben.pid, cal.pid], v: (await snap(ana)).v };
  ok((await snap(ana)).cards.length > 10 && (await snap(ana)).feed.length > 10, 'by now the town has a history: cards all over, and a long feed');
  await ana.page.locator('#startOverBtn').click();
  await ana.page.waitForSelector('#startOver[open]');
  ok(await town(ana, () => { const i = document.getElementById('resetToken'); return i.type === 'password' && i.autocomplete === 'off' && i.value === ''; }), 'the reset asks for the presenter\'s token in a password field that nothing fills in');
  await ana.page.locator('#resetBox summary').click();
  await ana.page.locator('#resetToken').fill('not-the-token');
  await ana.page.locator('#resetGo').click();
  await ana.page.waitForFunction(() => /token/i.test(document.getElementById('resetMsg').textContent), null, { timeout: 5000 });
  await sleep(300);
  await shot(ana, '15-reset-wrong-token');
  ok((await snap(ben)).v >= before.v && (await zone(ben)) === 'park' && await town(ana, () => window.__ship.town.you.pid, null) === ana.pid, 'a wrong token is refused and nothing changes');
  resetting = true;
  const reloads = [ana, ben, cal].map(who => who.page.waitForEvent('load', { timeout: 90000 }));      // three kitchens are built at once: slow on a busy machine
  await ana.page.locator('#resetToken').fill(TOKEN);
  await ana.page.locator('#resetGo').click();
  await Promise.all(reloads);
  for (const who of [ana, ben, cal]) await ready(who);
  resetting = false;
  await sleep(800);
  await shot(ana, '16-after-reset');
  await shot(cal, '16-after-reset-phone');
  ok([ana, ben, cal].every(who => !before.pids.includes(who.pid)), 'with the right token every page reloads into a new kitchen as a new player');
  const after = await snap(ana);
  ok(after.players.length === 3 && after.cards.every(c => c.title === TITLE.close || c.state === 'backlog') && !after.cards.some(c => c.rush || c.from) && after.team.shipped === 0 && after.team.score === 0 && after.rush === null && after.plots.filter(p => p.owner).every(p => p.score === 0 && p.bonus === 0 && p.sign === 'team') && after.feed.every(f => /opened a restaurant|The bus dropped/.test(f.text)), 'the new town is a clean slate: no scores, no rush, no signs, no history, only three restaurants opening');
  for (const who of [ana, ben, cal]) {
    ok(await town(who, first => { const s = window.__ship; return s.town.mode === 'kitchen' && s.state.orders.length === 1 && s.state.orders[0].title === first && s.state.stats.score === 0 && s.modal(); }, TITLE.close), `${who.name} is back on the start screen of a fresh kitchen with one customer`);
  }
  const h2 = await health();
  ok(h2.kitchens === 3 && h2.players === 3, 'the server holds three kitchens again, not six');

  /* ---------- what a player can and cannot see ---------- */
  const leaks = [];
  for (const who of [ana, ben, cal]) leaks.push(await town(who, token => { const store = k => { try { return JSON.stringify(Object.entries(window[k])); } catch { return ''; } }; return [document.documentElement.outerHTML, store('localStorage'), store('sessionStorage'), document.cookie].some(s => s.includes(token)); }, TOKEN));
  ok(!leaks.some(Boolean) && !frames.some(f => f.includes(TOKEN)), 'the presenter\'s token is in no page, no storage, and none of the socket messages');
  ok(frames.length > 100 && !frames.some(f => /ship_sid|sessions[\\/]/.test(f)), `none of the ${frames.length} socket messages carries a session id or a path on the server`);
  for (const who of [ana, ben, cal]) await who.context.close();
}

/* ======================= part 5: a full town, inside the drawing budget ======================= */
async function crowd() {
  console.log('A crowded town: 27 bots and two players, with outlines on');
  const { base, health } = await serve('crowd', { SHIP_WORLD_BOTS: '27' });
  // no ?quality=low here: the budget is for the picture a player really gets, outlines and all
  const dee = await join(base, 'Dee', { query: '' }), eli = await join(base, 'Eli', { phone: true, query: '' });
  ok((await health()).players === 29, 'the town holds 27 bots and two players');
  for (const who of [dee, eli]) {
    await start(who);
    if (who.phone) await tapStation(who, 'door'); else await enterPark(who);
    await inZone(who, 'park');
    await who.page.waitForFunction(() => window.__ship.town.players().length >= 27, null, { timeout: 15000 });
    // walk into the middle of the crowd, where the most is on screen at once
    await town(who, () => window.__ship.town.walkTo(1.5, 2.5));
    let draws = 0, labels = 0;
    for (let i = 0; i < 12; i++) { await sleep(250); const m = await town(who, () => ({ d: window.__ship.town.drawCalls(), l: window.__ship.town.labels() })); draws = Math.max(draws, m.d); labels = Math.max(labels, m.l); }
    const q = await town(who, () => ({ outline: window.__ship.quality.outline, all: window.__ship.town.players().length }));
    await shot(who, who.phone ? '17-crowd-phone' : '17-crowd');
    ok(q.outline && draws > 0 && draws <= DRAW_BUDGET, `${who.name}'s ${who.phone ? 'phone' : 'laptop'} draws the park and ${q.all} other players in ${draws} draw calls a frame, outlines included (${DRAW_BUDGET} or fewer)`);
    ok(labels <= LABEL_BUDGET, `${labels} labels on screen (${LABEL_BUDGET} or fewer)`);
    ok(await noSideScroll(who), 'nothing scrolls sideways');
  }
  await town(dee, () => window.__ship.town.overview(true));
  await sleep(1500);
  const wide = await town(dee, () => window.__ship.town.drawCalls());
  await shot(dee, '18-crowd-overview');
  ok(wide <= DRAW_BUDGET, `the whole-town overview (M) holds the budget too: ${wide} draw calls`);
  for (const who of [dee, eli]) await who.context.close();
}

try {
  browser = await chromium.launch({ headless: true, executablePath: await findChrome(), args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows'] });
  await play();
  await crowd();
  ok(offHost.length === 0, `no network requests left 127.0.0.1${offHost.length ? ': ' + offHost.join(', ') : ''}`);
  if (errors.length) throw new Error('Page errors:\n' + errors.join('\n'));
  console.log(`Town check passed (${passed} checks)`);
} catch (e) {
  console.error(e.message); if (errors.length) console.error(errors.join('\n'));
  for (const who of people) if (!who.page.isClosed()) await shot(who, `99-failure-${who.name.toLowerCase()}`).catch(() => {});
  process.exitCode = 1;
} finally {
  await browser?.close();
  for (const s of servers) s.kill();
  await sleep(500);
  await fs.rm(tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }).catch(() => {});
}
