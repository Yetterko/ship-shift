// Headless browser check of the kitchen page with simulated chefs. Never opens a visible window.
// Usage: node test/ui.mjs [screenshot-dir]   (needs a Playwright Chromium; set SHIP_CHROME to its exe if not auto-found)
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright-core';
import { ensureDemoRepo } from '../server/demo-repo.mjs';

const shots = process.argv[2];
const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'ship-shift-ui-'));
const repo = path.join(tmp, 'repo');
await ensureDemoRepo(repo);
const PORT = 4698;
const server = spawn(process.execPath, ['server/index.mjs'], {
  env: { ...process.env, SHIP_SIM: '1', SHIP_SIM_SPEED: '4', SHIP_REPO: repo, SHIP_DATA: path.join(tmp, 'data'), PORT: String(PORT) },
  stdio: 'ignore', windowsHide: true,
});
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function findChrome() {
  if (process.env.SHIP_CHROME) return process.env.SHIP_CHROME;
  const dir = path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), '.cache'), 'ms-playwright');
  const entries = (await fs.readdir(dir).catch(() => [])).filter(d => d.startsWith('chromium_headless_shell-')).sort().reverse();
  for (const e of entries) for (const sub of await fs.readdir(path.join(dir, e))) {
    const exe = path.join(dir, e, sub, process.platform === 'win32' ? 'chrome-headless-shell.exe' : 'chrome-headless-shell');
    if (await fs.stat(exe).then(() => true, () => false)) return exe;
  }
  return undefined;
}

const errors = [];
let browser;
try {
  for (let i = 0; i < 50; i++) { try { await fetch(`http://127.0.0.1:${PORT}/api/state`); break; } catch { await sleep(200); } }
  for (const o of [{ title: 'Weekly hours crashes', body: 'Fix weeklyHours and add a test.', size: 'S' }, { title: 'Overtime pay', body: 'Pay 1.5x past 8 hours.', size: 'M' }, { title: 'CSV export', size: 'L' }]) {
    await fetch(`http://127.0.0.1:${PORT}/api/orders`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(o) });
  }
  browser = await chromium.launch({ headless: true, executablePath: await findChrome() });
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error' && !/fonts\.(googleapis|gstatic)/.test(m.text())) errors.push(m.text()); });
  await page.goto(`http://127.0.0.1:${PORT}/`);
  await page.waitForSelector('.ticket');
  console.log('  ok tickets render:', await page.locator('.ticket').count());
  if (shots) await page.screenshot({ path: path.join(shots, 'kitchen-start.png') });

  await page.locator('.ticket').first().click();
  await page.locator('.station[data-chef="pixel"]').click();
  await page.waitForSelector('.station[data-chef="pixel"].cooking, .station[data-chef="pixel"].blocked');
  console.log('  ok click ticket then chef starts cooking');

  // second chef via drag and drop
  await page.locator('.ticket').first().dragTo(page.locator('.station[data-chef="router"]'));
  await page.waitForSelector('.station[data-chef="router"].cooking, .station[data-chef="router"].blocked');
  console.log('  ok drag ticket onto chef starts cooking');

  // answer questions until a plate is up
  const end = Date.now() + 40000;
  while (Date.now() < end && !(await page.locator('.plate').count())) {
    const opt = page.locator('.bubble .opt').first();
    if (await opt.count()) { await opt.click(); await page.locator('.bubble [data-act="answer"]').first().click(); console.log('  ok answered a chef question'); }
    const deny = page.locator('.bubble [data-act="deny"]').first();
    if (await deny.count()) { await deny.click(); console.log('  ok refused a permission request'); }
    await sleep(300);
  }
  await page.waitForSelector('.plate');
  if (shots) await page.screenshot({ path: path.join(shots, 'kitchen-cooking.png') });
  console.log('  ok plate reaches the pass');

  await page.locator('.plate').first().click();
  await page.waitForSelector('#reviewDialog[open] .diff .add');
  console.log('  ok review shows the diff');
  if (shots) await page.screenshot({ path: path.join(shots, 'review.png') });
  await page.locator('#rShip').click();
  await page.waitForFunction(() => document.querySelector('#mShipped').textContent === '1', null, { timeout: 15000 });
  console.log('  ok ship merges and the score updates:', await page.locator('#mScore').textContent());

  if (errors.length) throw new Error('Page errors:\n' + errors.join('\n'));
  console.log('UI check passed');
} catch (e) {
  console.error(e.message); if (errors.length) console.error(errors.join('\n'));
  process.exitCode = 1;
} finally {
  await browser?.close();
  server.kill();
  await sleep(300);
  await fs.rm(tmp, { recursive: true, force: true }).catch(() => {});
}
