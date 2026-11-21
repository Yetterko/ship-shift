// Headless run of the 3D kitchen with simulated chefs. It plays one whole order the way a person would:
// walk (with collision), hand out tickets, prep, spice, answer in the bubble, taste, call out, review, carry, ship.
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
const repo = path.join(tmp, 'repo');
await ensureDemoRepo(repo);
const PORT = 4697;
const server = spawn(process.execPath, ['server/index.mjs'], {
  env: { ...process.env, SHIP_SIM: '1', SHIP_SIM_SPEED: '2', SHIP_SIM_ASK: '', SHIP_REAL_CHEFS: '', SHIP_CHEF_MODELS: '', SHIP_PACE: '', SHIP_DEMO: '', SHIP_REPO: repo, SHIP_DATA: path.join(tmp, 'data'), PORT: String(PORT) },
  stdio: 'ignore', windowsHide: true,
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

const errors = [], offHost = [];
let passed = 0, browser, page;
const ok = (cond, msg) => { if (!cond) throw new Error('FAILED: ' + msg); passed++; console.log('  ok', msg); };
const shot = async name => { if (shots) await page.screenshot({ path: path.join(shots, `${name}.png`) }); };

try {
  for (let i = 0; i < 50; i++) { try { await fetch(`${base}/api/state`); break; } catch { await sleep(200); } }
  // #1 Weekly hours (S), #2 Overtime (M, asks a question), #3 CSV export (L, asks to npm install)
  for (const o of [STARTER_ORDERS[0], STARTER_ORDERS[1], STARTER_ORDERS[3]]) {
    await fetch(`${base}/api/orders`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(o) });
  }
  browser = await chromium.launch({ headless: true, executablePath: await findChrome(), args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('request', r => { const u = new URL(r.url()); if (!['127.0.0.1', 'localhost'].includes(u.hostname) && !['data:', 'blob:'].includes(u.protocol)) offHost.push(r.url()); });
  await page.goto(base + '/');
  await page.waitForSelector('canvas');
  await page.waitForFunction(() => window.__ship?.state && document.querySelectorAll('.tk').length >= 3, null, { timeout: 30000 });
  await page.evaluate(() => document.fonts.ready);
  await sleep(2500);

  const ship = fn => page.evaluate(fn);
  const order = id => page.evaluate(id => window.__ship.state.orders.find(o => o.id === id), id);
  const walk = async (id, until, ms = 20000, arg) => {
    await page.evaluate(id => window.__ship.walkTo(id), id);
    await page.waitForFunction(until, arg, { timeout: ms });
  };
  const slotFor = id => page.evaluate(id => `slot${window.__ship.slotOf.get(id)}`, id);
  const pos = () => ship(() => ({ x: window.__ship.player.g.position.x, z: window.__ship.player.g.position.z }));

  /* ---------- the picture ---------- */
  await shot('01-start');
  const look = await ship(() => window.__ship.look());
  ok(look.floorFrac >= 0.72, `the floor fills ${(look.floorFrac * 100).toFixed(0)}% of the stage width (72% or more)`);
  ok(look.chefPx >= 90, `a chef stands ${Math.round(look.chefPx)}px tall (90px or more)`);
  ok(look.labels >= 7 && look.overlaps === 0, `${look.labels} labels on screen, none overlapping`);
  ok((await ship(() => window.__ship.state.chefs.length)) === 4, 'four chefs on the line');

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

  /* ---------- tickets ---------- */
  await walk(await slotFor(1), () => window.__ship.player.carry?.id === 1);
  await walk('chef0', () => window.__ship.state.chefs[0].orderId === 1);
  ok(true, 'took ticket #1 from the window and gave it to Pixel');

  await walk(await slotFor(3), () => window.__ship.player.carry?.id === 3);
  await walk('prep', () => window.__ship.state.orders.find(o => o.id === 3).plan, 30000);
  ok(true, 'the prep board planned ticket #3');
  await walk('jar-install', () => window.__ship.player.carry?.type === 'jar');
  await walk('prep', () => window.__ship.state.orders.find(o => o.id === 3).grants?.includes('install'));
  ok((await ship(() => window.__ship.player.carry)) === null, 'shook the Install jar onto ticket #3, and the jar went back to the rack');
  await shot('02-prep-and-spice');
  await walk('prep', () => window.__ship.player.carry?.id === 3);
  await walk('chef2', () => window.__ship.state.chefs[2].orderId === 3);

  /* ---------- a blocked chef: answer in the bubble, nothing pauses ---------- */
  await walk(await slotFor(2), () => window.__ship.player.carry?.id === 2);
  await walk('chef1', () => window.__ship.state.chefs[1].orderId === 2);
  await page.waitForFunction(() => window.__ship.state.questions.some(q => q.orderId === 2), null, { timeout: 30000 });
  await walk('chef1', () => document.querySelector('.bub li[data-key="1"]'));
  await sleep(400);
  await shot('03-question-bubble');
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
  await page.waitForFunction(() => window.__ship.state.stats.steers >= 1 && window.__ship.state.orders.find(o => o.id === 2).activity.some(a => /called out: use round2/.test(a.text)), null, { timeout: 10000 });
  ok(true, 'F called out one line and the chef heard it');
  await page.waitForFunction(() => window.__ship.state.orders.find(o => o.id === 2).state === 'cooking', null, { timeout: 10000 });
  await page.keyboard.press('KeyE');
  await page.waitForFunction(() => window.__ship.ui.taste === 'chef1' && window.__ship.ui.wip && !window.__ship.ui.wip.error && document.querySelector('.wip .file'), null, { timeout: 10000 });
  await sleep(500);
  await shot('04-taste');
  ok(true, 'E at a cooking chef tastes the pot: the live diff is in the focus card');
  ok((await order(3)).state !== 'waiting' && !(await ship(() => window.__ship.state.questions.some(q => q.orderId === 3 && q.kind === 'permission'))), 'the spiced CSV order is cooking without asking to install');

  /* ---------- the plate rides to the pass on its own ---------- */
  await page.waitForFunction(() => window.__ship.state.orders.find(o => o.id === 1).state === 'at_pass' && window.__ship.plates.get(1)?.mv.key?.startsWith('pass') && window.__ship.plates.get(1).mv.t >= 1, null, { timeout: 60000 });
  ok((await ship(() => window.__ship.player.carry)) === null, 'plate #1 went chef -> oven -> pass by itself; the player never carried it');
  await shot('05-plate-at-pass');

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
  await shot('06-review-docked');
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => window.__ship.state.orders.find(o => o.id === 1).approved === true, null, { timeout: 10000 });
  ok((await order(1)).state === 'at_pass', 'Enter approved it; nothing merged yet');
  await page.waitForFunction(() => !document.querySelector('#review.open'));

  /* ---------- carry the approved plate to the hatch ---------- */
  await sleep(500);
  await shot('07-approved-cloche');
  await walk(slot, () => window.__ship.player.carry?.type === 'plate' && window.__ship.player.carry.id === 1);
  const fx0 = await ship(() => ({ ...window.__ship.fx }));
  await walk('hatch', () => window.__ship.state.orders.find(o => o.id === 1).state === 'shipped', 20000);
  await sleep(700);
  await shot('08-shipped');
  const fx1 = await ship(() => ({ ...window.__ship.fx })), st = await ship(() => window.__ship.state.stats);
  ok(st.shipped === 1 && st.blindShips === 0, `carried it to the hatch and shipped #1 to main, score ${st.score}`);
  ok(fx1.popups > fx0.popups && fx1.shakes > fx0.shakes && fx1.sounds > fx0.sounds, `juice fired: ${fx1.popups} popups, ${fx1.shakes} shakes, ${fx1.sounds} sounds`);
  ok((await ship(() => window.__ship.state.orders.reduce((n, o) => n + o.activity.length, 0))) > tools, 'the other chefs kept working the whole time');

  ok(offHost.length === 0, `no network requests left 127.0.0.1${offHost.length ? ': ' + offHost.join(', ') : ''}`);
  if (errors.length) throw new Error('Page errors:\n' + errors.join('\n'));
  console.log(`3D game check passed (${passed} checks)`);
} catch (e) {
  console.error(e.message); if (errors.length) console.error(errors.join('\n'));
  if (page) await shot('99-failure').catch(() => {});
  process.exitCode = 1;
} finally {
  await browser?.close();
  server.kill();
  await sleep(300);
  await fs.rm(tmp, { recursive: true, force: true }).catch(() => {});
}
