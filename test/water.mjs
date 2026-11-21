// Headless check of the water fight: two waiters in the same restaurant soak each other, then a lone waiter
// fights the rival bot. Usage: node test/water.mjs [screenshot-dir]. Never opens a visible window.
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright-core';

const shots = process.argv[2];
if (shots) await fs.mkdir(shots, { recursive: true });
const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'ship-shift-water-'));
const PORT = 4698;
const server = spawn(process.execPath, ['server/index.mjs', '--demo'], {
  env: { ...process.env, SHIP_DATA: path.join(tmp, 'data'), SHIP_SHARED_KEY: '', ANTHROPIC_API_KEY: '', PORT: String(PORT) },
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
let passed = 0, browser;
const errors = [];
const ok = (cond, msg) => { if (!cond) throw new Error('FAILED: ' + msg); passed++; console.log('  ok', msg); };
const W = (page, fn, arg) => page.evaluate(fn, arg);
const place = (page, x, z, ry) => W(page, ([x, z, ry]) => { const p = window.__ship.player; p.path = null; p.g.position.set(x, 0, z); p.g.rotation.y = ry; }, [x, z, ry]);
async function open(ctx, name) {
  const page = await ctx.newPage();
  page.on('pageerror', e => errors.push(`${name}: ${e.message}`));
  await page.goto(base);
  await page.waitForFunction(() => window.__ship?.state && window.__ship.water.me.id);
  await page.click('#startBtn').catch(() => {});
  await sleep(300);
  return page;
}

try {
  for (let i = 0; i < 60; i++) { try { await fetch(`${base}/api/state`); break; } catch { await sleep(250); } }
  browser = await chromium.launch({ executablePath: await findChrome(), args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
  const ctx = await browser.newContext({ viewport: { width: 900, height: 540 } });

  console.log('two waiters');
  const a = await open(ctx, 'A'), b = await open(ctx, 'B');
  await a.waitForFunction(() => window.__ship.water.remotes.length === 1);
  await b.waitForFunction(() => window.__ship.water.remotes.length === 1);
  ok(true, 'each waiter sees the other one');
  const ida = (await W(a, () => window.__ship.water.me)).id;
  // A stands left of B, facing +x (ry = pi/2), and sprays
  await place(a, 1.2, 0.3, Math.PI / 2); await place(b, 3.2, 0.3, -Math.PI / 2);
  await b.waitForFunction(() => { const r = window.__ship.water.remotes[0]; return r && Math.abs(r.x - 1.2) < 0.2; }, null, { timeout: 25000 });
  const seen = await W(b, () => window.__ship.water.remotes[0]);
  ok(Math.abs(seen.x - 1.2) < 0.2 && Math.abs(seen.z - 0.3) < 0.2, `B sees A where A stands (${seen.x.toFixed(2)}, ${seen.z.toFixed(2)})`);
  ok(await W(a, () => window.__ship.water.fire()), 'A fires the water gun');
  await b.waitForFunction(() => window.__ship.water.soaked(), null, { timeout: 25000 });
  ok(true, 'B gets soaked by the stream');
  await a.waitForFunction(() => window.__ship.water.me.splashes === 1, null, { timeout: 25000 });
  ok(true, 'A is credited with one splash');
  await b.waitForFunction(id => window.__ship.water.remotes.find(r => r.id === id)?.splashes === 1, ida, { timeout: 25000 });
  ok(true, "B's scoreboard shows A's splash too");
  if (shots) { await a.screenshot({ path: path.join(shots, 'a-sprays.png') }); await b.screenshot({ path: path.join(shots, 'b-soaked.png') }); }
  // a miss: B fires the wrong way
  await a.waitForFunction(() => !window.__ship.water.soaked(), null, { timeout: 25000 }).catch(() => {});
  await sleep(2500);
  await place(b, 3.2, 0.3, Math.PI / 2); await sleep(300);
  await W(b, () => window.__ship.water.fire()); await sleep(6000);
  ok(!(await W(a, () => window.__ship.water.soaked())) && (await W(b, () => window.__ship.water.me.splashes)) === 0, 'spraying the other way misses');
  ok(!(await W(a, () => window.__ship.water.bot)), 'no rival bot while a real opponent is here');
  await b.close(); await a.waitForFunction(() => window.__ship.water.remotes.length === 0, null, { timeout: 15000 }).catch(() => {});
  ok((await W(a, () => window.__ship.water.remotes.length)) === 0, 'the opponent disappears when their tab closes');

  console.log('alone against the rival');
  await place(a, 2.4, 0.2, 0);
  await W(a, () => window.__ship.water.fire());
  await a.waitForFunction(() => !!window.__ship.water.bot, null, { timeout: 25000 });
  ok(true, 'the rival waiter turns up after the first shot');
  // let the rival hunt the player
  await a.waitForFunction(() => window.__ship.water.soaked(), null, { timeout: 90000 });
  ok(true, 'the rival soaks the player');
  const bot = await W(a, () => window.__ship.water.bot);
  const me = await W(a, () => window.__ship.player.g.position);
  await W(a, ([bx, bz]) => { const p = window.__ship.player.g.position; window.__ship.player.g.rotation.y = Math.atan2(bx - p.x, bz - p.z); }, [bot.x, bot.z]);
  const before = (await W(a, () => window.__ship.water.me)).splashes;
  for (let i = 0; i < 30 && (await W(a, () => window.__ship.water.me)).splashes === before; i++) {
    const bt = await W(a, () => window.__ship.water.bot);
    await W(a, ([bx, bz]) => { const p = window.__ship.player.g.position; window.__ship.player.g.rotation.y = Math.atan2(bx - p.x, bz - p.z); window.__ship.water.fire(); }, [bt.x, bt.z]);
    await sleep(1500);
  }
  ok((await W(a, () => window.__ship.water.me)).splashes > before, `the player soaks the rival (from ${me.x.toFixed(1)}, ${me.z.toFixed(1)})`);
  ok(await a.isVisible('#waterBoard'), 'the water fight scoreboard is showing');
  if (shots) await a.screenshot({ path: path.join(shots, 'vs-rival.png') });
  ok(!errors.length, 'no page errors');
  console.log(`${passed} checks passed`);
} catch (e) {
  console.error(e.message);
  if (errors.length) console.error('page errors:', errors.join('\n'));
  process.exitCode = 1;
} finally {
  await browser?.close();
  server.kill();
  await fs.rm(tmp, { recursive: true, force: true }).catch(() => {});
}
