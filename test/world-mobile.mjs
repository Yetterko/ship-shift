// The world on phones, headless: iPhone 13 and a 360 x 640 Android. Landing, overview, park, walk-in and the drawer,
// with no horizontal scroll and tap targets of at least 44 px. Runs against test/helpers/fake-town.mjs.
import { startFakeTown } from './helpers/fake-town.mjs';
import { launch, phone, shot, ok, until, passedCount } from './helpers/headless.mjs';

const town = await startFakeTown({ seed: 6 });
const browser = await launch();
const noScroll = p => p.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1);
const small = (p, sel) => p.$$eval(sel, l => l.filter(e => e.offsetParent && (e.getBoundingClientRect().height < 43.5 || e.getBoundingClientRect().width < 43.5)).map(e => e.className || e.id));
try {
  for (const [name, device] of [['iphone', 'iPhone 13'], ['android360', { width: 360, height: 640 }]]) {
    console.log(name);
    const p = await phone(browser, device);
    await p.goto(town.url + '/'); await p.waitForSelector('.sh-role');
    ok(await noScroll(p), `${name}: no horizontal scroll on the landing`);
    ok((await small(p, '.sh-role')).length === 0, `${name}: role buttons are at least 44 px`);
    await shot(p, `mobile-${name}-landing`);
    await p.tap('[data-role="spectator"]');
    await until(async () => (await p.$$('.sh-cardf')).length === 6, 4000, 'cards');
    ok(await noScroll(p), `${name}: no horizontal scroll on the overview`);
    ok((await small(p, '.sh-cardf, .sh-bar button')).length === 0, `${name}: overview targets are at least 44 px`);
    await shot(p, `mobile-${name}-overview`);
    await p.tap('#ovPark');
    await until(() => p.evaluate(() => window.__ship.state.mounted === 'park'), 4000, 'the park');
    ok(await p.$('#squirtBtn') && (await small(p, '#squirtBtn, .sh-bar button')).length === 0, `${name}: park controls, with the water gun, are at least 44 px`);
    await shot(p, `mobile-${name}-park`);
    await p.tap('#pkMenu');
    await p.waitForSelector('.sh-drawer');
    ok((await small(p, '.sh-drawer .sh-row, .sh-drawer .sh-place')).length === 0, `${name}: drawer rows are at least 44 px`);
    await shot(p, `mobile-${name}-drawer`);
    await p.tap('.sh-drawer [data-floor="fixture-floor-0000002"]');
    await until(() => p.evaluate(() => window.__ship.state.floorId === 'fixture-floor-0000002'), 8000, 'walk-in');
    ok(await p.evaluate(() => document.body.dataset.owner === '0'), `${name}: walked in read-only`);
    ok(!(await p.$('#squirtBtn')), `${name}: no water gun button inside a restaurant on a phone`);
    ok(p.errors.length === 0, `${name}: no console errors${p.errors.length ? ': ' + p.errors.join(' | ') : ''}`);
    await p.context().close();
  }
  console.log(`\nworld-mobile: ${passedCount()} checks passed`);
} catch (e) {
  console.error(e.stack || e.message); process.exitCode = 1;
} finally { await browser.close(); await town.stop(); }
