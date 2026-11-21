// The world on a laptop, headless: landing, roles, overview, park, walking in, doors, teleport, pill, call-backs,
// reconnect and the water gun. Runs against test/helpers/fake-town.mjs (the REBUILD.md section 5 contract) unless
// SHIP_URL points at a real server. Screenshots land in test/shots/.
import { startFakeTown } from './helpers/fake-town.mjs';
import { launch, desktop, shot, ok, sleep, until, passedCount } from './helpers/headless.mjs';
import { startServer, wsClient } from './helpers/server.mjs';
import { startMock } from './helpers/mock-anthropic.mjs';

const town = await startFakeTown({ seed: 6 });
const browser = await launch();
const pages = [];
const open = async (name) => { const p = await desktop(browser); p.label = name; pages.push(p); await p.goto(town.url + '/'); await p.waitForSelector('.sh-role'); return p; };
// Go home lives 9 s; a whole kitchen under swiftshader can hold the page for seconds, so find and tap it in one go
const tapGoHome = (p, ms = 8000) => until(() => p.evaluate(() => { const b = [...document.querySelectorAll('.toast .toast-act')].find(x => /Go home/.test(x.textContent)); if (b) b.click(); return !!b; }), ms, 'Go home');
const S = p => p.evaluate(() => ({ ...window.__ship.state, pill: window.__ship.pill, owner: document.body.dataset.owner, net: { homeId: window.__ship.net.homeId, subscribed: window.__ship.net.subscribed, role: window.__ship.net.role, connId: window.__ship.net.welcome?.connId } }));

try {
  console.log('landing and the spectator');
  const spec = await open('spectator');
  ok(await spec.$eval('.sh-role.sel', b => b.dataset.role) === 'spectator', 'Spectator is preselected');
  ok(await spec.$$eval('.sh-role', l => l.length) === 3, 'three role buttons');
  await shot(spec, 'world-landing');
  await spec.click('[data-role="spectator"]');
  await spec.waitForSelector('.sh-over');
  await until(async () => (await spec.$$('.sh-cardf')).length === 6, 4000, 'six overview cards');
  ok(true, 'the spectator lands on the overview with one card per restaurant');
  const card = await spec.$eval('.sh-cardf', c => c.textContent);
  ok(/No\. \d/.test(card) && /score/i.test(card) && /shipped/i.test(card) && /watching/i.test(card) && /LIVE|DEMO/.test(card), 'a card shows number, name, score, shipped, LIVE/DEMO and watchers');
  await shot(spec, 'world-overview');

  town.patch('fixture-floor-0000002', s => { s.score = 999; });
  await until(() => spec.evaluate(() => document.querySelector('[data-floor="fixture-floor-0000002"]')?.textContent.includes('999')), 3000, 'the card to update');
  ok(true, 'the overview updates on each building message');

  console.log('the park');
  await spec.click('#ovPark');
  await until(async () => (await S(spec)).mounted === 'park', 4000, 'the park');
  await sleep(600);
  const probe = await spec.evaluate(() => window.__ship.park.parkProbe());
  ok(probe.buildings.length === 6, `a building per restaurant with a plot (${probe.buildings.length})`);
  ok(await spec.$$eval('.pk-sign', l => l.length) >= 2 && await spec.$$eval('.pk-sign em', l => l.every(e => /LIVE|DEMO/.test(e.textContent))), 'name signs with a LIVE/DEMO lamp');
  ok(!(await spec.$('.sh-over')), 'only one scene: the overview is gone while the park is up');
  await shot(spec, 'world-park');

  console.log('walking in through a door');
  const target = probe.buildings[0];
  await spec.evaluate(id => { const p = window.__ship.park.doorOf(id); window.__ship.park.setGoal(p.x, p.z); }, target.floorId);
  await until(async () => (await S(spec)).mounted === 'floor', 8000, 'walking through the door');
  let st = await S(spec);
  ok(st.floorId === target.floorId && st.owner === '0', 'the doormat walks you in, read-only');
  ok(!(await spec.evaluate(() => window.__ship.park.parkProbe().built)), 'the park is disposed while inside');
  await shot(spec, 'world-walkin');

  console.log('the front door panel');
  await spec.evaluate(() => window.__ship.openDoorPanel());
  await spec.waitForSelector('.sh-doorp');
  ok(await spec.$$eval('.sh-doorp .sh-row', l => l.length) === 6, 'the door panel lists every restaurant');
  await shot(spec, 'world-doorpanel');
  await spec.click('.sh-doorp [data-do="back"]');
  ok(!(await spec.$('.sh-doorp')) && (await S(spec)).floorId === target.floorId, 'Back returns to the same restaurant');
  await spec.evaluate(() => window.__ship.openDoorPanel());
  await spec.click('.sh-doorp [data-do="park"]');
  await until(async () => (await S(spec)).mounted === 'park', 4000, 'stepping out');
  const me = await spec.evaluate(() => window.__ship.park.parkProbe().me);
  ok(Math.hypot(me.x - target.x, me.z - target.z) < 2.5, 'stepping out stands you in front of that building');

  console.log('teleport drawer and one floor loaded');
  await spec.evaluate(() => window.__ship.openDrawer());
  await spec.waitForSelector('.sh-drawer');
  await shot(spec, 'world-drawer');
  await spec.click('.sh-drawer [data-floor="fixture-floor-0000003"]');
  await until(async () => (await S(spec)).floorId === 'fixture-floor-0000003', 4000, 'teleport to No. 3');
  await spec.evaluate(() => window.__ship.openDrawer());
  await spec.click('.sh-drawer [data-floor="fixture-floor-0000004"]');
  await until(async () => (await S(spec)).floorId === 'fixture-floor-0000004', 4000, 'teleport to No. 4');
  const last = await spec.evaluate(() => window.__ship.teleport.last);
  ok(last.ms < 3000, `switch under 3 s (${last.ms} ms)`);
  const drops0 = (await S(spec)).staleDrops;
  town.patch('fixture-floor-0000003', s => { s.score += 1; });
  town.patch('fixture-floor-0000004', s => { s.score += 1; });
  await sleep(400);
  const subs = town.log.filter(m => m.conn === [...town.conns].find(c => c.sub === 'fixture-floor-0000004')?.id && (m.type === 'subscribe' || m.type === 'unsubscribe')).slice(-3).map(m => m.type + (m.floorId ? ':' + m.floorId.slice(-1) : ''));
  ok((await S(spec)).staleDrops === drops0 && subs.at(-1) === 'subscribe:4', `only the new restaurant's messages arrive afterwards (${subs.join(' ')})`);

  console.log('overview card walks in');
  await spec.evaluate(() => window.__ship.travel({ overview: true }));
  await spec.waitForSelector('.sh-cardf');
  await spec.click('[data-floor="fixture-floor-0000005"]');
  await until(async () => (await S(spec)).floorId === 'fixture-floor-0000005', 4000, 'walk-in from a card');
  ok((await S(spec)).owner === '0', 'a tapped card walks in read-only');

  console.log('a player');
  const player = await open('player');
  await player.click('[data-role="player"]');
  await player.waitForSelector('.sh-board');
  ok(/Haiku 5\.5/.test(await player.$eval('.sh-board .mode', e => e.textContent)), 'the chalkboard says Live on Haiku 5.5');
  await shot(player, 'world-chalkboard');
  await player.click('#cbGo');
  await until(async () => (await S(player)).mounted === 'floor', 5000, 'the player\'s own floor');
  st = await S(player);
  ok(st.owner === '1' && st.floorId === st.net.homeId, 'Player gets the chalkboard then their own floor, able to act');
  ok(/^LIVE\s*Haiku 5\.5\s*\$0\.00 of \$0\.10$/.test(st.pill.replace(/\s+/g, ' ').replace(/LIVE ?/, 'LIVE ')) || st.pill.includes('LIVE') && st.pill.includes('Haiku 5.5') && st.pill.includes('$0.00 of $0.10'), `the pill reads LIVE · Haiku 5.5 · $0.00 of $0.10 (${st.pill})`);
  await shot(player, 'world-own-floor');
  const home = st.floorId;

  console.log('away from home: the call-back brings you back');
  await player.evaluate(() => window.__ship.travel({ floorId: 'fixture-floor-0000001' }));
  await until(async () => (await S(player)).floorId === 'fixture-floor-0000001', 4000, 'visiting No. 1');
  ok((await S(player)).owner === '0', 'a player visiting another kitchen is read-only there');
  town.notify(home, 'callBack', "Table 1's order is up!");
  await player.waitForSelector('.toast .toast-act');
  ok(/Go home/.test(await player.$eval('.toast .toast-act', b => b.textContent)), 'a call-back away from home offers Go home');
  await tapGoHome(player);
  await until(async () => (await S(player)).floorId === home, 10000, 'going home');
  ok((await S(player)).owner === '1', 'Go home lands back in your own kitchen');

  console.log('pill, mode sheet and the budget modal');
  await player.evaluate(() => document.getElementById('modePill').click());
  await player.waitForSelector('.sh-mode');
  await shot(player, 'world-modesheet');
  await player.click('.sh-mode [data-do="close"]');
  town.patch(home, s => { s.budget.spentUsd = 0.1; s.budget.blocked = true; s.budget.canGoLive = false; });
  town.notify(home, 'budgetSpent', 'That is the end of your live budget.');
  await player.waitForSelector('.sh-budget');
  ok(await player.$('.sh-budget [data-do="demo"]') && await player.$('.sh-budget [data-do="visit"]'), 'budgetSpent opens the modal with both buttons');
  await shot(player, 'world-budget');
  await player.click('.sh-budget [data-do="demo"]');
  await until(async () => /DEMO/.test((await S(player)).pill), 3000, 'the pill to read DEMO');
  ok(/pre-cooked/.test((await S(player)).pill), 'the pill reads DEMO · pre-cooked');
  await player.evaluate(() => document.getElementById('modePill').click());
  await player.waitForSelector('.sh-mode');
  ok(await player.$eval('.sh-mode [data-mode="live"]', b => b.disabled), 'Demo to Live is disabled without budget');
  await player.click('.sh-mode [data-do="close"]');

  console.log('the overview counts the new kitchen');
  await spec.evaluate(() => window.__ship.travel({ overview: true }));
  await until(async () => (await spec.$$('.sh-cardf')).length === 7, 4000, 'seven cards');
  ok(true, 'a new restaurant appears on the overview');

  console.log('reconnect');
  const before = town.log.length;
  await player.evaluate(() => window.__ship.netm.dropForTest());
  await until(() => town.log.slice(before).some(m => m.type === 'subscribe'), 6000, 'the resubscribe');
  const again = town.log.slice(before);
  ok(again.some(m => m.type === 'hello' && m.token), 'a reconnect resends hello with the token');
  ok(again.some(m => m.type === 'subscribe' && m.floorId === home), 'and subscribes again');
  await sleep(300);
  ok((await S(player)).owner === '1', 'still the owner after the reconnect');

  console.log('a judge');
  const judge = await open('judge');
  await judge.click('[data-role="judge"]');
  await judge.waitForSelector('.sh-board');
  ok(/Sonnet 5\.5/.test(await judge.$eval('.sh-board .mode', e => e.textContent)), 'the judge chalkboard says Sonnet 5.5');
  await judge.click('#cbGo');
  await until(async () => /Sonnet 5\.5/.test((await S(judge)).pill), 5000, 'the judge pill');
  ok(true, 'a Judge sees Sonnet in the pill');

  console.log('the water gun');
  await judge.evaluate(() => window.__ship.travel({ park: true }));
  await spec.evaluate(() => window.__ship.travel({ park: true }));
  await player.evaluate(() => window.__ship.travel({ park: true }));       // a bystander in the same zone
  await until(async () => (await S(judge)).mounted === 'park' && (await S(spec)).mounted === 'park' && (await S(player)).mounted === 'park', 6000, 'all three in the park');
  await judge.evaluate(() => { const P = window.__ship.park; P.placeMe(0, 4); P.me.r = 0; });     // facing +z
  await spec.evaluate(() => { const P = window.__ship.park; P.placeMe(0.3, 7); });
  await until(() => judge.evaluate(() => window.__ship.park.parkProbe().peers >= 1), 4000, 'the judge to see the spectator');
  await until(() => judge.evaluate(() => { const P = window.__ship.park; return P.parkProbe().peers >= 1; }), 2000, 'peers');
  await sleep(500);
  ok(await judge.$('#squirtBtn'), 'the park controls carry the water gun');
  await judge.keyboard.press('f');
  // one read: under swiftshader a frame can hold the page for a while, and the splat only lives 2.5 s
  const seen = await until(() => spec.evaluate(() => { const e = document.querySelector('.sh-splat'); return e && { text: e.querySelector('p')?.textContent, pe: getComputedStyle(e).pointerEvents }; }), 4000, 'the splat');
  ok(/Splashed by Guest/.test(seen.text), `A splashes B: B's page shows the splat (${seen.text})`);
  ok(seen.pe === 'none', 'the splat never blocks taps');
  const by = await player.evaluate(() => ({ drips: window.__ship.squirt.drips, splat: !!document.querySelector('.sh-splat') }));
  ok(by.drips >= 1 && !by.splat, 'a bystander in the zone sees the target drip, without the splat');
  await player.evaluate(() => window.__ship.goHome());
  await until(async () => (await S(player)).owner === '1', 6000, 'the player home again');
  await shot(spec, 'world-splat');
  await sleep(2800);
  ok(!(await spec.$('.sh-splat')), 'the splat fades away');
  const homeShots = await player.evaluate(() => { const n = window.__ship.squirt.shots; document.dispatchEvent(new KeyboardEvent('keydown', { key: 'f', bubbles: true })); window.dispatchEvent(new KeyboardEvent('keydown', { key: 'f' })); return window.__ship.squirt.shots - n; });
  ok(homeShots === 0 && !(await player.$('#squirtBtn')), 'no water gun inside your own kitchen');

  console.log('all live kitchens busy');
  const full = await startFakeTown({ seed: 2, liveMax: 0, judgeMax: 0 });
  const late = await desktop(browser); pages.push(late);
  await late.goto(full.url + '/'); await late.waitForSelector('.sh-role');
  await sleep(500);
  await late.click('[data-role="player"]');
  await late.waitForSelector('.sh-busy');
  const opts = await late.$$eval('.sh-busy [data-do]', l => l.map(b => b.dataset.do));
  ok(opts.join() === 'demo,visit,queue', 'the busy sheet offers Demo kitchen, look around and queue');
  await shot(late, 'world-busy');
  await late.click('.sh-busy [data-do="demo"]');
  await late.waitForSelector('.sh-board .mode.demo');
  await late.click('#cbGo');
  await until(async () => /DEMO/.test((await S(late)).pill), 5000, 'a demo kitchen');
  ok((await S(late)).owner === '1', 'the Demo kitchen opens without a live slot');
  ok(late.errors.length === 0, `no console errors on the busy page${late.errors.length ? ': ' + late.errors.join(' | ') : ''}`);
  pages.splice(pages.indexOf(late), 1); await late.context().close();
  await full.stop();

  for (const p of pages) ok(p.errors.length === 0, `no console errors on the ${p.label || 'extra'} page${p.errors.length ? ': ' + p.errors.join(' | ') : ''}`);
  for (const p of pages) await p.context().close();
  pages.length = 0;
  if (!process.env.SHIP_FAKE_ONLY) await realServer();
  console.log(`\nworld: ${passedCount()} checks passed`);
} catch (e) {
  console.error(e.stack || e.message);
  for (const p of pages) { if (p.errors?.length) console.error(p.label, p.errors); await shot(p, `world-fail-${p.label || 'x'}`).catch(() => {}); }
  process.exitCode = 1;
} finally {
  await browser.close();
  await town.stop();
}

/* ---------- the same journey against builder 1's real server, with the API mocked ---------- */
async function realServer() {
  console.log('\nthe real server (mock API)');
  const mock = await startMock({ delayMs: 20 });
  const srv = await startServer({ ANTHROPIC_API_KEY: 'test-key', ANTHROPIC_BASE_URL: mock.url, SHIP_PACE: '4', LIVE_TIMINGS: 'short' });
  const seeds = [];
  try {
    for (let i = 0; i < 3; i++) {
      const c = await wsClient(srv.url);
      c.send('hello', { v: 1 }); await c.next('welcome');
      c.send('chooseRole', { role: 'player' }); await c.next('welcome');
      c.send('createFloor', { name: `Seed Kitchen ${i + 1}`, mode: i === 2 ? 'demo' : 'live' });
      const w = await c.next('welcome', m => !!m.floorId);
      c.send('subscribe', { floorId: w.floorId }); await c.next('floor');
      seeds.push({ c, floorId: w.floorId });
    }
    const spec = await desktop(browser); spec.label = 'real-spectator'; pages.push(spec);
    await spec.goto(srv.url + '/'); await spec.waitForSelector('.sh-role');
    await until(() => spec.evaluate(() => window.__ship.net.connected), 4000, 'the socket');
    await spec.click('[data-role="spectator"]');
    await until(async () => (await spec.$$('.sh-cardf')).length === 3, 5000, 'three cards from the real server');
    ok(true, 'real: the overview shows every restaurant');
    ok(await spec.$$eval('.sh-cardf .mode', l => l.map(e => e.textContent.trim()).sort().join()) === 'DEMO,LIVE,LIVE', 'real: LIVE and DEMO dots');
    await spec.click('#ovPark');
    await until(async () => (await spec.evaluate(() => window.__ship.park.parkProbe().buildings.length)) === 3, 5000, 'three buildings');
    ok(true, 'real: a building per restaurant in the park');
    await spec.evaluate(id => { const p = window.__ship.park.doorOf(id); window.__ship.park.setGoal(p.x, p.z); }, seeds[0].floorId);
    await until(async () => (await S(spec)).floorId === seeds[0].floorId, 8000, 'walking in');
    ok((await S(spec)).owner === '0', 'real: walked in read-only');
    const own = await seeds[0].c.act('seat', { customerId: 'c1' });
    ok(own.ok, `real: the owner still acts while watched (${own.code || 'ok'})`);
    const v = await spec.evaluate(() => window.__ship.netm.act('seat', { customerId: 'c2' }));
    ok(v.code === 'view_only' || v.code === 'no_floor', `real: a visitor's action is refused (${v.code})`);

    const player = await desktop(browser); player.label = 'real-player'; pages.push(player);
    await player.goto(srv.url + '/'); await player.waitForSelector('.sh-role');
    await until(() => player.evaluate(() => window.__ship.net.connected), 4000, 'the socket');
    await player.click('[data-role="player"]');
    await player.waitForSelector('#cbGo');
    await player.evaluate(() => { const w = document.getElementById('cbWork'); w.value = w.max; w.dispatchEvent(new Event('input')); });   // the longest work stretch: no forced break mid-test
    await player.click('#cbGo');
    await until(async () => (await S(player)).mounted === 'floor', 6000, 'the player floor');
    const st = await S(player);
    ok(st.owner === '1' && /LIVE/.test(st.pill) && /Haiku 5\.5/.test(st.pill) && /of \$0\.10/.test(st.pill), `real: own floor, LIVE on Haiku 5.5 (${st.pill})`);
    await shot(player, 'world-real-own');
    // start an Order, then go visiting: the Meal coming up calls you home
    const A = (n, a) => player.evaluate(([n, a]) => window.__ship.netm.act(n, a), [n, a]);
    const seated = await A('seat', { customerId: 'c1' });
    ok(seated.ok, `real: seat Priya (${seated.code || 'ok'} ${seated.message || ''})`);
    const snap = await player.evaluate(() => window.__ship.net.floor.floor);
    const picks = snap.tables.find(Boolean).order.quickPicks;
    ok((await A('saveItems', { customerId: 'c1', items: picks.slice(0, 2).map(q => ({ prompt: q.prompt, station: q.station, quickPickId: q.id, typed: false })) })).ok, 'real: save two Items');
    ok((await A('sendItems', { customerId: 'c1' })).ok, 'real: send them to the kitchen');
    await player.evaluate(id => window.__ship.travel({ floorId: id }), seeds[1].floorId);
    await until(async () => (await S(player)).floorId === seeds[1].floorId, 5000, 'visiting');
    await tapGoHome(player, 20000);
    await until(async () => (await S(player)).floorId === st.floorId, 5000, 'home again');
    ok((await S(player)).owner === '1', 'real: a Meal ready while away offers Go home, and it goes home');

    // the water gun through the real relay
    await player.evaluate(() => window.__ship.travel({ park: true }));
    await spec.evaluate(() => window.__ship.travel({ park: true }));
    await until(async () => (await S(player)).mounted === 'park' && (await S(spec)).mounted === 'park', 5000, 'both in the park');
    await player.evaluate(() => { const P = window.__ship.park; P.placeMe(0, 4); P.me.r = 0; });
    await spec.evaluate(() => { const P = window.__ship.park; P.placeMe(0.4, 6.5); });
    await until(() => player.evaluate(() => window.__ship.park.parkProbe().peers >= 1), 5000, 'peers in the park');
    await sleep(500);
    await player.keyboard.press('f');
    const seen = await until(() => spec.evaluate(() => document.querySelector('.sh-splat p')?.textContent), 5000, 'the splat');
    ok(/Splashed by/.test(seen), `real: A splashes B through the server, B sees the splat (${seen})`);
    for (const p of pages) ok(p.errors.length === 0, `real: no console errors on the ${p.label} page${p.errors.length ? ': ' + p.errors.join(' | ') : ''}`);
  } catch (e) {
    console.error(srv.logs.join('').slice(-3000));
    throw e;
  } finally {
    for (const s of seeds) s.c.ws.close();
    await srv.stop(); await mock.close();
  }
}
