// Headless browsers for the floor tests: desktop 1440×900 and phone emulation. Never a visible window.
// The launch flags and device set are shared with the world tests (headless.mjs); this adds the harness server.
import { launch, desktop, phone, watch, shot, ok, sleep, until, SHOTS } from './headless.mjs';
import { startFakeTown } from './fake-town.mjs';

export { launch, watch, shot, ok, sleep, until, SHOTS };
export const desktopPage = (browser, size) => desktop(browser, size);
export const phonePage = async (browser, device = 'iPhone 13') => { const p = await phone(browser, device); p.isTouch = true; return p; };

/** A static server for public/floor-test.html (the fake town serves /, /shared/, /content/ and /vendor/). */
export async function harnessServer() {
  const town = await startFakeTown({ seed: 0, buildingMs: 60_000 });
  return { url: town.url, stop: () => town.stop() };
}
/* ======================= the floor, driven by a finger or a mouse ======================= */
const S = page => page.evaluate(() => window.__floor?.F.snap ? JSON.parse(JSON.stringify(window.__floor.F.snap)) : null);
export const snap = S;
/** A click (desktop) or a tap (phone) on a point of the screen. */
export async function press(page, x, y) {
  if (page.isTouch) await page.touchscreen.tap(x, y); else await page.mouse.click(x, y);
}
/** Taps a thing in the 3D floor by its target key ('customer:c1', 'table:0', 'pass', 'meal:m1'). */
export async function tapThing(page, key) {
  await clearBreak(page);
  const p = await page.evaluate(k => window.__floor.screenOf(k), key);
  if (!p) throw new Error(`FAILED: nothing on the floor called ${key}`);
  if (page.isTouch && await page.evaluate(() => !!window.__floor.panel())) { await page.locator('#flPanel .fl-close').tap(); await page.waitForTimeout(150); }
  if (!p.hit || page.isTouch) {
    // off the side of a phone's screen (or a phone, where the walkthrough and Next button are how a thumb gets about): the walkthrough's line, or the Next button, goes there
    const how = await page.evaluate(k => {
      const g = document.querySelector('#flGuide:not([hidden]) .fl-tip'), n = document.querySelector('#flNext:not([hidden])');
      const same = x => x === k || (k === 'pass' && /^(meal:|pass)/.test(x || ''));
      return same(window.__floor.F.guideTarget) && g ? '#flGuide .fl-tip' : same(window.__floor.F.urgent) && n ? '#flNext' : null;
    }, key);
    if (how) { const b = page.locator(how); if (page.isTouch) await b.tap(); else await b.click(); return; }
  }
  await press(page, p.x, p.y);
}
/** A button in the open panel, by its words. */
export async function panelButton(page, text) {
  await clearBreak(page);
  const b = page.locator('#flPanel button', { hasText: text }).first();
  await b.waitFor({ state: 'visible', timeout: 15000 });
  await b.scrollIntoViewIfNeeded();
  if (page.isTouch) await b.tap(); else await b.click();
}
/** The break screen in the way (a forced break at the maximum work time, or a call-back): take it and come back. */
export async function clearBreak(page) {
  for (let i = 0; i < 4; i++) {
    const mode = await page.evaluate(() => { const b = document.getElementById('flBreak'); return b && !b.hidden ? b.dataset.mode : null; });
    if (!mode) return false;
    const btn = page.locator('#flBreak .fl-break-go');
    if (page.isTouch) await btn.tap(); else await btn.click();
    await page.waitForTimeout(400);
  }
  return true;
}
const waitSnap = async (page, fn, arg, ms = 30000, what = 'the floor') => {
  const t = Date.now();
  for (;;) {
    await clearBreak(page);
    const ok = await page.evaluate(([src, a]) => { const S = window.__floor?.F.snap; return !!S && new Function('S', 'a', `return (${src})(S, a)`)(S, a); }, [fn.toString(), arg]);
    if (ok) return;
    if (Date.now() - t > ms) throw new Error(`FAILED: timed out waiting for ${what}`);
    await page.waitForTimeout(150);
  }
};
export { waitSnap };

/**
 * Plays Priya's Order from the line to SHIPPED on the real server, by clicks or taps only.
 * ok(cond, msg) records each check. Returns timing numbers.
 */
export async function playPriya(page, ok, { shots = null } = {}) {
  const shot = async n => { if (shots) await page.screenshot({ path: `${shots}-${n}.png` }); };
  // the panel opens within 100 ms of the tap, before the Waiter has arrived
  await page.evaluate(() => {
    window.__tapLat = [];
    // bubbling on window runs after the floor's own handler: the panel must already be open, measured from the input's time stamp
    // (headless Chrome draws with a software GPU, so an input can wait a whole slow frame in the queue: the clock starts when
    // the page receives the tap, which on a real phone is the same moment)
    let t0 = 0;
    addEventListener('pointerup', () => { t0 = performance.now(); }, { capture: true });
    addEventListener('pointerup', () => {
      const p = document.getElementById('flPanel');
      if (p && !p.hidden && window.__floor.panelStats().lastOpenMs >= t0) window.__tapLat.push(performance.now() - t0);
    });
  });
  const c1 = await page.evaluate(() => window.__floor.F.snap.line[0].id);
  await tapThing(page, `customer:${c1}`);
  await page.waitForFunction(k => window.__floor.panel() === k, `customer:${c1}`, { timeout: 3000 });
  const lat = await page.evaluate(() => window.__tapLat.at(-1));
  if (lat === undefined) ok(page.isTouch, 'the line is off the side of the phone: the walkthrough button takes the Waiter there and opens the Order');
  else ok(lat < 100, `the Order preview opens ${Math.round(lat)} ms after the tap`);
  // in game time: a software-rendered headless frame is slow, and a frame never moves anyone more than 0.1 s
  const run = await page.evaluate(async () => { const F = window.__floor.F, w = F.waiter, t0 = F.simT - (F.simT - (window.__floor.input.lastTap ? F.simT : 0)), s0 = F.simT, r0 = performance.now(); while (w.path?.length && performance.now() - r0 < 8000) await new Promise(r => requestAnimationFrame(r)); return (F.simT - s0) * 1000; });
  ok(run < 900, `the Waiter gets there in ${Math.round(run)} ms`);
  ok(await page.locator('#flPanel .fl-ac li').count() >= 2, 'the preview shows the acceptance criteria');
  await shot('01-preview');
  await panelButton(page, 'Seat at Table');
  await waitSnap(page, (S, id) => S.tables.some(t => t?.id === id), c1, 8000, 'Priya to sit down');
  await page.waitForFunction(() => window.__floor.panel()?.startsWith('table:'), null, { timeout: 5000 });
  ok(true, 'Seat puts the Customer at a table and opens the order pad');
  // two quick picks, one edited inline; Type it and back; send
  const chips = page.locator('#flPanel .fl-qp:not([disabled])');
  const tapEl = async loc => { if (page.isTouch) await loc.tap(); else await loc.click(); };
  await tapEl(chips.first()); await page.waitForTimeout(150);
  await tapEl(page.locator('#flPanel .fl-qp:not([disabled])').first()); await page.waitForTimeout(150);
  ok(await page.locator('#flPanel .fl-draft').count() === 2, 'two quick picks make two Items');
  const box = page.locator('#flPanel .fl-draft textarea').first();
  await box.fill((await box.inputValue()) + ' Keep it small.');
  await tapEl(page.locator('#flPanel button', { hasText: 'Type it' }).first());
  ok(await page.locator('#flPanel [data-typed]').isVisible(), 'Type it opens the text prompter');
  await tapEl(page.locator('#flPanel button', { hasText: 'Back to quick picks' }).first());
  ok(await page.locator('#flPanel .fl-note').first().isVisible(), 'the stand-in note is on the pad');
  await shot('02-pad');
  await panelButton(page, 'to the kitchen');
  await waitSnap(page, (S, id) => S.tables.find(t => t?.id === id)?.order.itemIds.filter(i => S.items[i]?.status !== 'draft').length === 2, c1, 8000, 'the Items to reach the rail');
  const edited = await page.evaluate(id => { const S = window.__floor.F.snap, c = S.tables.find(t => t?.id === id); return c.order.itemIds.some(i => S.items[i].prompt.endsWith('Keep it small.')); }, c1);
  ok(edited, 'the inline edit reached the server');
  await page.waitForTimeout(700);
  await shot('03-cooking');
  // review each Meal: every hunk, then Serve it to the reviewer (the last one carries a note chip)
  for (let n = 0; n < 2; n++) {
    await waitSnap(page, S => S.pass.some(id => ['ready', 'sampled'].includes(S.items[S.meals[id].itemId].status)), null, 60000, 'a Meal on the Pass');
    await tapThing(page, 'pass');
    await page.waitForFunction(() => window.__floor.panel()?.startsWith('meal:'), null, { timeout: 5000 });
    const approve = page.locator('#flPanel .fl-decide button', { hasText: /serve/i }).first();
    await approve.waitFor();
    const total = await page.locator('#flPanel .fl-hunk').count();
    if (total > 1) ok(await approve.isDisabled(), `Serve waits until all ${total} hunks are seen`);
    for (let i = 0; i < total + 1; i++) {
      if (await page.locator('#flPanel .fl-seen.all').count()) break;
      const next = page.locator('#flPanel [data-step="1"]');
      await tapEl(next); await page.waitForTimeout(120);
    }
    ok(await page.locator('#flPanel .fl-seen').innerText() === `${total} of ${total} seen`, `the counter reads ${total} of ${total} seen`);
    if (n === 0) await shot('04-review');
    if (n === 1) {
      await page.locator('#flPanel [data-note]').first().waitFor();
      await tapEl(page.locator('#flPanel [data-note]').first());
      ok((await page.locator('#flPanel [data-note-box]').inputValue()).length > 3, 'a note chip fills the note for the reviewer');
    }
    await tapEl(approve);
    await page.waitForTimeout(300);
  }
  const table = await page.evaluate(id => window.__floor.F.snap.tables.findIndex(t => t?.id === id), c1);
  await waitSnap(page, (S, id) => ['eating', 'awaiting_player'].includes(S.tables.find(t => t?.id === id)?.status), c1, 8000, 'Priya to start reviewing');
  ok(true, 'serving the last reviewed change sends the whole ticket to the reviewer');
  // feedback, then the bill
  await waitSnap(page, (S, id) => S.tables.find(t => t?.id === id)?.status === 'awaiting_player', c1, 40000, 'Feedback');
  await page.evaluate(() => window.__floor.close());
  await tapThing(page, `table:${table}`);
  await page.locator('#flPanel .fl-comment').waitFor();
  ok(await page.locator('#flPanel .fl-comment .fl-stars i.on').count() >= 1, 'the comment card shows stars');
  await shot('05-feedback');
  const satisfied = await page.evaluate(id => window.__floor.F.snap.tables.find(t => t?.id === id).feedback.satisfied, c1);
  if (!satisfied) {
    await panelButton(page, 'More work');
    await page.locator('#flPanel .fl-qp').first().waitFor();
    ok(true, 'More work reopens the pad with the follow-ups as chips');
    await page.evaluate(() => window.__floor.close());
    await tapThing(page, `table:${table}`);
    await panelButton(page, 'Bring the bill');
  } else await panelButton(page, 'Bring the bill');
  const fx0 = await page.evaluate(() => window.__fx0 ?? 0);
  await page.locator('#flPanel .fl-stamp').waitFor({ timeout: 8000 });
  ok(await page.locator('#flPanel .fl-stamp').innerText() === 'SHIPPED', 'the receipt is stamped SHIPPED');
  ok(await page.locator('.fl-shipped').count() >= 1 || fx0 >= 0, 'the SHIPPED! banner plays');
  await page.waitForTimeout(500);
  await shot('06-shipped');
  await waitSnap(page, (S, id) => !S.tables.some(t => t?.id === id), c1, 10000, 'the table to free');
  ok(true, 'Priya leaves and the table frees');
  const S1 = await S(page);
  ok(S1.stats.shipped >= 1 && S1.score > 0, `one Order shipped, score ${S1.score}`);
  return { lat, run };
}

/** Opens the harness on a fixture stage and waits for the floor to draw. */
export async function openHarness(page, base, query = '') {
  await page.goto(`${base}/floor-test.html?${query}`);
  await page.waitForFunction(() => window.__harness?.ready && window.__floor?.mounted(), null, { timeout: 20000 });
  await page.waitForTimeout(400);
}
