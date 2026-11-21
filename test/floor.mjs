// The restaurant floor on a laptop (1440×900), headless. Part 1 drives the harness page (public/floor-test.html) with the
// canned snapshots of shared/fixtures.js; part 2 plays a whole Order on the real server in the Demo kitchen, by clicks only.
// Usage: node test/floor.mjs [--shots]. Never opens a visible window and never calls the real API.
import path from 'node:path';
import { launch, desktopPage, harnessServer, openHarness, ok, SHOTS, playPriya, tapThing } from './helpers/browser.mjs';
import { startServer } from './helpers/server.mjs';

const wantShots = process.argv.includes('--shots');
const shotBase = n => (wantShots ? path.join(SHOTS, `floor-desk-${n}`) : null);
const browser = await launch();
const harness = await harnessServer();
let server = null;
try {
  console.log('Harness: the floor on canned snapshots');
  const page = await desktopPage(browser);
  await openHarness(page, harness.url, 'stage=start');

  // B2.1 layout: line on the left, two tables, rail and Pass, four Stations and two Chefs on the top wall, door right, TV
  const L = await page.evaluate(() => window.__floor.probe());
  ok(L.line.x < Math.min(...L.tables.map(t => t.x)) && L.customers === 5, 'five Customers queue on the left of the tables');
  ok(L.tables.length === 2 && L.stations.length === 4, 'two tables and four Stations');
  ok(L.stations.every(s => s.z < L.rail.z) && L.chefs.length === 2 && L.chefs.every(c => c.z < L.rail.z), 'Stations and Chefs run along the top wall, behind the rail');
  ok(L.door.x > Math.max(...L.tables.map(t => t.x)) && L.tv.x > 3, 'the door is on the right wall, the TV beside it');
  ok(L.rail.z < L.tables[0].z && L.pass.z === L.rail.z, 'the rail and the Pass sit in front of the kitchen');

  // mount and unmount ten times: the GPU memory comes back
  const mem = await page.evaluate(async () => {
    const h = window.__harness, frame = () => new Promise(r => requestAnimationFrame(r));
    h.unmount(); await frame(); h.mount(); await frame(); await frame();
    const base = window.__floor.memory();
    for (let i = 0; i < 10; i++) { h.unmount(); await frame(); h.mount(); await frame(); await frame(); }
    return { base, after: window.__floor.memory(), mounts: window.__floor.mounts() };
  });
  ok(mem.after.geometries <= mem.base.geometries + 2 && mem.after.textures <= mem.base.textures + 2, `ten mounts later the GPU holds ${mem.after.geometries} geometries and ${mem.after.textures} textures (was ${mem.base.geometries}, ${mem.base.textures})`);

  // B2.2 agent state per stage
  const labels = () => page.evaluate(() => [...document.querySelectorAll('#labels .lbl:not(.hid)')].map(e => e.textContent).join(' | '));
  const labelSays = (re, ms = 4000) => page.waitForFunction(src => new RegExp(src).test([...document.querySelectorAll('#labels .lbl:not(.hid)')].map(e => e.textContent).join(' | ')), re.source, { timeout: ms }).then(() => true, () => false);
  await page.evaluate(() => window.__harness.setStage('stove')); await page.waitForTimeout(300);
  ok(await labelSays(/waiting for a stove/), 'a Chef shows "waiting for a stove"');
  await page.evaluate(() => window.__harness.setStage('cooking')); await page.waitForTimeout(300);
  ok(await labelSays(/cooking/), 'cooking Chefs say what they cook');
  ok(await page.locator('#flBreakBtn').isVisible(), 'Take a break shows when both Chefs are busy');
  await page.evaluate(() => window.__harness.setStage('seated')); await page.waitForTimeout(200);
  ok(!(await page.locator('#flBreakBtn').isVisible()), 'and not otherwise');
  await page.evaluate(() => window.__harness.setStage('feedback'));
  ok(await labelSays(/has feedback/), 'a Customer with Feedback raises a hand');

  // B2.7 HUD and guide
  ok(await page.locator('#flClock').isVisible() && await page.locator('#flScore').isVisible() && await page.locator('#flName').innerText() === 'No. 7 · The Hungry Linter', 'HUD: clock, score and floor name');
  ok(await page.locator('#pillSlot .harness-pill').count() === 1, 'the pill sits in #pillSlot');
  ok(await page.locator('#flGuide li.done').count() === 4 && (await page.locator('#flGuide li.cur').innerText()).includes('SHIP'), 'the walkthrough has lit SEAT to SERVE and points at SHIP');

  // B2.5 review: the summary leads, the code is folded away (J/K unfolds and steps it), Serve is open at once and
  // closes the panel, redo chips
  await page.evaluate(() => window.__harness.setStage('ready')); await page.waitForTimeout(200);
  await page.evaluate(() => window.__floor.tap('pass')); await page.waitForTimeout(300);
  ok(await page.evaluate(() => window.__floor.panel()) === 'meal:m1', 'tapping the Pass opens the Meal');
  const acts = () => page.evaluate(() => window.__harness.acts.map(a => a.name));
  ok((await acts()).includes('sampleMeal'), 'opening a fresh Meal samples it');
  const hunks = await page.locator('#flPanel .fl-hunk').count();
  const codeOpen = () => page.locator('#flPanel .fl-code').evaluate(d => d.open);
  ok(await page.locator('#flPanel .fl-summary').isVisible() && !(await codeOpen()) && !(await page.locator('#flPanel .fl-hunk').first().isVisible()), 'the Chef\'s summary shows and the code starts folded away');
  ok(!(await page.locator('#flPanel button', { hasText: /serve/i }).isDisabled()), 'Serve is open without reading the code');
  await page.keyboard.press('j'); await page.waitForTimeout(80);
  ok(await codeOpen() && await page.locator('#flPanel .fl-hunk.cur').isVisible(), 'J unfolds the code on the first hunk');
  await page.keyboard.press('j'); await page.waitForTimeout(80);
  ok(await page.locator('#flPanel .fl-seen').innerText() === `2 of ${hunks} seen`, `J steps on: "2 of ${hunks} seen"`);
  await page.locator('#flPanel .fl-code > summary').click(); await page.waitForTimeout(80);
  ok(!(await codeOpen()), 'tapping "Review the code" folds it again');
  await page.locator('#flPanel .fl-decide button', { hasText: /serve/i }).click(); await page.waitForTimeout(100);
  const served = await page.evaluate(() => window.__harness.acts.find(a => a.name === 'serveMeal'));
  ok(served?.args.mealId === 'm1' && await page.evaluate(() => window.__floor.panel()) === null, 'Serve sends serveMeal and closes the panel');
  await page.evaluate(() => window.__floor.tap('pass')); await page.waitForTimeout(300);
  await page.locator('#flPanel button', { hasText: 'Send back' }).click();
  await page.locator('#flPanel [data-why]').first().click();
  await page.locator('#flPanel button', { hasText: 'Send back for a Redo' }).click(); await page.waitForTimeout(100);
  const redo = await page.evaluate(() => window.__harness.acts.find(a => a.name === 'redoMeal'));
  ok(redo && redo.args.mealId === 'm1' && redo.args.reason.length > 3, `a redo chip sends redoMeal with "${redo?.args.reason}"`);
  ok(await page.evaluate(() => window.__floor.panel()) === null, 'sending it back closes the panel too');

  // B2.8 break screen, call-back with Notification and vibrate stubbed, forced break blocks panels
  await page.evaluate(() => {
    window.__calls = { notes: 0, buzz: 0 };
    window.Notification = class { static permission = 'granted'; static requestPermission() { return Promise.resolve('granted'); } constructor() { window.__calls.notes++; } };
    navigator.vibrate = () => { window.__calls.buzz++; return true; };
    window.__harness.setStage('break');
  });
  await page.waitForTimeout(200);
  ok(await page.locator('#flBreak').isVisible() && /held/.test(await page.locator('#flBreak').innerText()), 'the break screen dims the floor and says call-backs are held');
  await page.evaluate(() => window.__harness.setStage('calledBack')); await page.waitForTimeout(900);
  const calls = await page.evaluate(() => ({ ...window.__calls, title: document.title }));
  ok(calls.notes === 1 && calls.buzz === 1 && calls.title.startsWith('●'), 'a call-back shows a notification, buzzes and flashes the title');
  await page.evaluate(() => window.__harness.setStage('mustBreak')); await page.waitForTimeout(200);
  const opened = await page.evaluate(() => window.__floor.open('rail'));
  ok(!opened && await page.locator('#flBreak[data-mode="must"]').isVisible(), 'a forced break locks the panels behind the break screen');

  // B2.9 read-only and the TV
  await openHarness(page, harness.url, 'stage=ready&canAct=0');
  const wpos = await page.evaluate(() => { const p = window.__floor.F.waiter.g.position; return { x: p.x, z: p.z }; });
  ok(wpos.x > 4, 'a visitor starts at the front door');
  await page.evaluate(() => window.__floor.tap('pass')); await page.waitForTimeout(200);
  ok(await page.locator('#flPanel .fl-viewonly').count() >= 1 && await page.locator('#flPanel button', { hasText: /serve/i }).count() === 0, 'a visitor sees "View only" instead of Serve');
  ok(await page.locator('#flWatch').isVisible(), 'the eye icon shows the watcher count');
  await openHarness(page, harness.url, 'stage=shipped');
  ok(await page.evaluate(() => window.__floor.F.snap.tv.shots[0] === 'o1'), 'the TV knows Order 1 shipped');
  await page.evaluate(() => window.__floor.tap('tv')); await page.waitForTimeout(200);
  ok(await page.locator('.fl-tvfull img[src="/tv/order-1.png"]').count() === 1 && /Stand-in/.test(await page.locator('.fl-tvfull').innerText()), 'the TV full screen shows /tv/order-1.png with its stand-in note');
  await page.keyboard.press('Escape');
  await openHarness(page, harness.url, 'stage=cooking&kind=showcase');
  await page.evaluate(() => window.__floor.tap('tv')); await page.waitForTimeout(200);
  ok(await page.locator('.fl-tvfull iframe[src^="/preview/showcase/"]').count() === 1, 'on the showcase floor the TV is the live preview');
  await page.close();

  // B2.10: the real server, Demo kitchen, clicks only
  console.log('Real server: Priya, seated to shipped, by clicks');
  server = await startServer({ SHIP_PACE: '2' });
  const p2 = await desktopPage(browser);
  await p2.goto(server.url + '/');
  await p2.locator('[data-role="player"]').click();
  await p2.locator('#cbWork').waitFor();
  await p2.evaluate(() => { const r = document.getElementById('cbWork'); r.value = r.max; r.dispatchEvent(new Event('input')); });
  await p2.locator('#cbGo').click();
  await p2.waitForFunction(() => window.__floor?.mounted() && window.__floor.F.snap?.line.length === 5, null, { timeout: 15000 });
  ok(true, 'the Player gets their own floor with five Customers in line');
  await p2.waitForTimeout(800);
  await playPriya(p2, ok, { shots: shotBase('play') });
  // the TV screenshots are builder 3's (B3.7); until they land the TV keeps its drawn stand-in
  const errs = p2.errors.filter(e => !/\/tv\/(order-\d|start)\.png/.test(e));
  ok(errs.length === 0, `no console errors${errs.length ? ` (${errs.slice(0, 3).join('; ')})` : ''}`);
  console.log('floor: all green');
} finally {
  await browser.close();
  await harness.stop();
  await server?.stop();
}
void tapThing;
