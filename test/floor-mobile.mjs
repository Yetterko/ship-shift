// The restaurant floor on phones, headless: iPhone 13 and a 360×640 screen. Part 1 checks the phone layout on the
// harness page (bottom sheets, 44 px targets, nothing wider than the screen, a camera that follows the Waiter, pinch);
// part 2 plays a whole Order on the real server in the Demo kitchen by taps only.
// Usage: node test/floor-mobile.mjs [--shots]. Never opens a visible window and never calls the real API.
import path from 'node:path';
import { launch, phonePage, harnessServer, openHarness, ok, SHOTS, playPriya } from './helpers/browser.mjs';
import { startServer } from './helpers/server.mjs';

const wantShots = process.argv.includes('--shots');
const browser = await launch();
const harness = await harnessServer();
let server = null;
/** Nothing a finger must hit is smaller than 44 px (the HUD, the open panel), and nothing sticks out sideways. */
const fingerCheck = page => page.evaluate(() => {
  const small = [...document.querySelectorAll('#flHud button, #flPanel button, #flGuide button, #flBreak button')]
    .filter(b => b.getClientRects().length && getComputedStyle(b).visibility !== 'hidden')
    .map(b => { const r = b.getBoundingClientRect(); return { t: (b.textContent || b.getAttribute('aria-label') || '').trim().slice(0, 24), w: Math.round(r.width), h: Math.round(r.height) }; })
    .filter(r => r.w < 44 || r.h < 44);
  return { small, scroll: document.documentElement.scrollWidth > innerWidth + 1 };
});
try {
  for (const [tag, device] of [['iphone', 'iPhone 13'], ['360', { width: 360, height: 640 }]]) {
    console.log(`${tag}: harness`);
    const page = await phonePage(browser, device);
    await openHarness(page, harness.url, 'stage=seated');
    ok(await page.evaluate(() => document.body.dataset.layout) === 'portrait', 'the page knows it is an upright phone');
    ok(await page.evaluate(() => window.__floor.touch.following), 'the camera follows the Waiter');
    // tap a table with a finger: the sheet opens from the bottom at once
    const p = await page.evaluate(() => window.__floor.screenOf('table:0'));
    await page.touchscreen.tap(p.x, p.y);
    await page.waitForFunction(() => window.__floor.panel() === 'table:0', null, { timeout: 3000 });
    const sheet = await page.evaluate(() => { const r = document.getElementById('flPanel').getBoundingClientRect(); return { bottom: Math.round(r.bottom), left: Math.round(r.left), w: Math.round(r.width), vh: innerHeight, vw: innerWidth }; });
    ok(sheet.bottom >= sheet.vh - 1 && sheet.left <= 0 && sheet.w >= sheet.vw - 1, 'the panel is a bottom sheet across the screen');
    await page.locator('#flPanel .fl-qp').first().tap(); await page.waitForTimeout(150);
    let f = await fingerCheck(page);
    ok(f.small.length === 0, `every button in the HUD and the sheet is at least 44 px${f.small.length ? ` (${JSON.stringify(f.small.slice(0, 4))})` : ''}`);
    ok(!f.scroll, 'nothing scrolls sideways');
    if (wantShots) await page.screenshot({ path: path.join(SHOTS, `floor-${tag}-pad.png`) });
    // the review sheet
    await page.evaluate(() => { window.__floor.close(); window.__harness.setStage('ready'); });
    await page.waitForTimeout(200);
    await page.evaluate(() => window.__floor.tap('pass'));
    await page.waitForTimeout(250);
    f = await fingerCheck(page);
    ok(f.small.length === 0 && !f.scroll, 'the review sheet fits the screen and its buttons fit a finger');
    if (wantShots) await page.screenshot({ path: path.join(SHOTS, `floor-${tag}-review.png`) });
    // pinch zooms the camera out
    await page.evaluate(() => window.__floor.close());
    const z0 = await page.evaluate(async () => (await import('/game/scene.js')).getZoom());
    const cdp = await page.context().newCDPSession(page);
    const box = await page.evaluate(() => ({ x: innerWidth / 2, y: innerHeight / 2 }));
    const touch = (type, d) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x: box.x - d, y: box.y, id: 1 }, { x: box.x + d, y: box.y, id: 2 }] });
    await touch('touchStart', 120); await touch('touchMove', 90); await touch('touchMove', 50); await touch('touchEnd', 0);
    const z1 = await page.evaluate(async () => (await import('/game/scene.js')).getZoom());
    ok(z1 > z0 + 0.3, `a pinch zooms the camera out (${z0.toFixed(2)} → ${z1.toFixed(2)})`);
    // the break screen fits too
    await page.evaluate(() => window.__harness.setStage('break')); await page.waitForTimeout(200);
    f = await fingerCheck(page);
    ok(await page.locator('#flBreak').isVisible() && f.small.length === 0 && !f.scroll, 'the break screen fits the phone');
    if (wantShots) await page.screenshot({ path: path.join(SHOTS, `floor-${tag}-break.png`) });
    ok(page.errors.filter(e => !/\/tv\//.test(e)).length === 0, `no console errors on the harness${page.errors.length ? ` (${page.errors.slice(0, 2).join('; ')})` : ''}`);
    await page.close();
  }

  console.log('iPhone 13: the real server, Priya to shipped by taps');
  server = await startServer({ SHIP_PACE: '2' });
  const phone = await phonePage(browser, 'iPhone 13');
  await phone.goto(server.url + '/');
  await phone.locator('[data-role="player"]').tap();
  await phone.locator('#cbWork').waitFor();
  await phone.evaluate(() => { const r = document.getElementById('cbWork'); r.value = r.max; r.dispatchEvent(new Event('input')); });
  await phone.locator('#cbGo').tap();
  await phone.waitForFunction(() => window.__floor?.mounted() && window.__floor.F.snap?.line.length === 5, null, { timeout: 15000 });
  await phone.waitForTimeout(800);
  try { await playPriya(phone, ok, { shots: wantShots ? path.join(SHOTS, 'floor-phone-play') : null }); }
  catch (e) { await phone.screenshot({ path: path.join(SHOTS, 'floor-phone-FAILED.png') }); console.log(await phone.evaluate(() => JSON.stringify({ panel: window.__floor.panel(), guide: window.__floor.F.guideTarget, urgent: window.__floor.F.urgent, pass: window.__floor.F.snap.pass, w: window.__floor.F.waiter.g.position, so: window.__floor.screenOf('pass') }))); throw e; }
  const errs = phone.errors.filter(e => !/\/tv\/(order-\d|start)\.png/.test(e));
  ok(errs.length === 0, `no console errors${errs.length ? ` (${errs.slice(0, 3).join('; ')})` : ''}`);
  console.log('floor-mobile: all green');
} finally {
  await browser.close();
  await harness.stop();
  await server?.stop();
}
