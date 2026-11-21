// The thumb stick on a phone: a finger dragged on the kitchen walks the Waiter that way; a quick tap is still a tap.
// Headless only (`node test/stick.mjs`).
import { launch, phonePage, harnessServer, openHarness, ok } from './helpers/browser.mjs';

const harness = await harnessServer();
const browser = await launch();
try {
  const page = await phonePage(browser, 'iPhone 13');
  await openHarness(page, harness.url, 'role=owner');
  const pos = () => page.evaluate(() => { const p = window.__floor.F.waiter.g.position; return { x: p.x, z: p.z }; });
  const cdp = await page.context().newCDPSession(page);
  const touch = (type, x, y) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y, id: 1 }] });
  const box = await page.locator('canvas').first().boundingBox();
  const cx = box.x + box.width / 2, cy = box.y + box.height * 0.6;
  const a = await pos();
  await touch('touchStart', cx, cy);
  for (let i = 1; i <= 6; i++) { await touch('touchMove', cx + i * 10, cy); await page.waitForTimeout(16); }
  ok(await page.locator('.stick:not([hidden])').count() === 1, 'dragging shows the stick where the finger went down');
  await page.waitForTimeout(900);
  const b = await pos();
  await touch('touchEnd');
  ok(b.x - a.x > 0.2, `dragging right walks the Waiter right (x ${a.x.toFixed(2)} -> ${b.x.toFixed(2)})`);
  ok(await page.locator('.stick:not([hidden])').count() === 0, 'lifting the finger hides the stick');
  await page.waitForTimeout(300);
  const c = await pos();
  await page.waitForTimeout(400);
  const d = await pos();
  ok(Math.hypot(d.x - c.x, d.z - c.z) < 0.05, 'the Waiter stops when the finger lifts');
  await touch('touchStart', cx, cy);
  for (let i = 1; i <= 6; i++) { await touch('touchMove', cx, cy - i * 10); await page.waitForTimeout(16); }
  await page.waitForTimeout(700);
  const e = await pos();
  await touch('touchEnd');
  ok(e.z - d.z < -0.2, `dragging up walks the Waiter up the screen (z ${d.z.toFixed(2)} -> ${e.z.toFixed(2)})`);
  console.log('stick: all green');
} catch (err) { console.error(err); process.exitCode = 1; }
finally { await browser.close(); await harness.stop(); }
