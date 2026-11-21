// Headless Chromium for the world, showcase and load tests. Never a visible window.
//   const b = await launch(); const page = await desktop(b) | await phone(b, 'iPhone 13') | await phone(b, { width: 360, height: 640 })
//   watch(page) collects console errors; shot(page, name) writes test/shots/<name>.png
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, devices } from 'playwright-core';

const here = path.dirname(fileURLToPath(import.meta.url));
export const SHOTS = path.join(here, '..', 'shots');

export async function findChrome() {
  if (process.env.SHIP_CHROME) return process.env.SHIP_CHROME;
  const dir = path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), '.cache'), 'ms-playwright');
  const entries = (await fs.readdir(dir).catch(() => [])).filter(d => d.startsWith('chromium_headless_shell-')).sort().reverse();
  for (const e of entries) for (const sub of await fs.readdir(path.join(dir, e))) {
    const exe = path.join(dir, e, sub, process.platform === 'win32' ? 'chrome-headless-shell.exe' : 'chrome-headless-shell');
    if (await fs.stat(exe).then(() => true, () => false)) return exe;
  }
  return undefined;
}

export async function launch() {
  return chromium.launch({ headless: true, executablePath: await findChrome(), args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'] });
}
export async function desktop(browser, size = { width: 1440, height: 900 }) {
  const ctx = await browser.newContext({ viewport: size, deviceScaleFactor: 1 });
  return watch(await ctx.newPage());
}
export async function phone(browser, device = 'iPhone 13') {
  const opts = typeof device === 'string' ? { ...devices[device] } : { viewport: device, deviceScaleFactor: 2, isMobile: true, hasTouch: true, userAgent: devices['Pixel 7'].userAgent };
  delete opts.defaultBrowserType;
  const ctx = await browser.newContext(opts);
  return watch(await ctx.newPage());
}
export function watch(page) {
  page.errors = [];
  page.on('console', m => { if (m.type() === 'error' && !/favicon|WebGL|GPU stall|GL Driver|Failed to load resource/.test(m.text())) page.errors.push(m.text()); });
  // a missing file is an error, except the restaurant module while builder 2 has not landed it (the shell falls back)
  page.on('response', r => { if (r.status() >= 400 && !/favicon|\/game\/floorapp\.js/.test(r.url())) page.errors.push(`${r.status()} ${r.url()}`); });
  page.on('pageerror', e => page.errors.push(String(e)));
  return page;
}
export async function shot(page, name) {
  await fs.mkdir(SHOTS, { recursive: true });
  const file = path.join(SHOTS, `${name}.png`);
  await page.screenshot({ path: file });
  return file;
}

let passed = 0;
export const ok = (cond, msg) => { if (!cond) throw new Error('FAILED: ' + msg); passed++; console.log('  ok', msg); };
export const passedCount = () => passed;
export const sleep = ms => new Promise(r => setTimeout(r, ms));
export async function until(fn, ms = 5000, what = 'condition') {
  const t = Date.now();
  for (;;) { const v = await fn(); if (v) return v; if (Date.now() - t > ms) throw new Error(`FAILED: timed out waiting for ${what}`); await sleep(50); }
}
