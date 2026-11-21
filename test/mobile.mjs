// Headless run of the kitchen on a phone, upright (390x844) and on its side (844x390), with simulated chefs.
// It plays one whole order with touches only, the way a thumb would: tap a ticket, tap a chef, answer in the
// bubble, steer with the stick, call out, review the diff on the sheet, approve, carry, ship.
// Usage: node test/mobile.mjs [screenshot-dir]. Never opens a visible window and never runs a real agent.
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright-core';
import { ensureDemoRepo, STARTER_ORDERS } from '../server/demo-repo.mjs';

const shots = process.argv[2];
if (shots) await fs.mkdir(shots, { recursive: true });
const sleep = ms => new Promise(r => setTimeout(r, ms));
const SCREENS = [
  { name: 'portrait', width: 390, height: 844, layout: 'tall', port: 4691 },
  { name: 'landscape', width: 844, height: 390, layout: 'wide', port: 4692 },
  // tablets get the same thumbs: upright they share the phone's layout, on their side the desktop's with room kept for the thumbs
  { name: 'tablet-portrait', width: 820, height: 1180, layout: 'tall', port: 4689, glance: true },
  { name: 'tablet-landscape', width: 1180, height: 820, layout: 'desk', port: 4688, glance: true },
];
const only = process.env.SHIP_SCREEN;

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
const ok = (cond, msg) => { if (!cond) throw new Error('FAILED: ' + msg); passed++; console.log('  ok', msg); };

async function play(screen) {
  console.log(`${screen.name} ${screen.width}x${screen.height}`);
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'ship-shift-mobile-'));
  const repo = path.join(tmp, 'repo');
  await ensureDemoRepo(repo);
  const server = spawn(process.execPath, ['server/index.mjs'], {
    env: { ...process.env, SHIP_SIM: '1', SHIP_SIM_SPEED: '0.3', SHIP_SIM_ASK: '', SHIP_REAL_CHEFS: '', SHIP_CHEF_MODELS: '', SHIP_PACE: '', SHIP_DEMO: '', SHIP_PUBLIC: '', SHIP_REPO: repo, SHIP_DATA: path.join(tmp, 'data'), PORT: String(screen.port) },
    stdio: 'ignore', windowsHide: true,
  });
  const base = `http://127.0.0.1:${screen.port}`;
  const errors = [], offHost = [];
  let page, context;
  const shot = async name => { if (shots) await page.screenshot({ path: path.join(shots, `${screen.name}-${name}.png`) }); };
  try {
    for (let i = 0; i < 50; i++) { try { await fetch(`${base}/api/state`); break; } catch { await sleep(200); } }
    // #1 Weekly hours (S), #2 Overtime (M, asks a question), #3 CSV export (L)
    for (const o of [STARTER_ORDERS[0], STARTER_ORDERS[1], STARTER_ORDERS[3]]) {
      await fetch(`${base}/api/orders`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(o) });
    }
    context = await browser.newContext({ viewport: { width: screen.width, height: screen.height }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 });
    page = await context.newPage();
    const cdp = await context.newCDPSession(page);
    page.on('pageerror', e => errors.push(e.message));
    page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
    page.on('request', r => { const u = new URL(r.url()); if (!['127.0.0.1', 'localhost'].includes(u.hostname) && !['data:', 'blob:'].includes(u.protocol)) offHost.push(r.url()); });
    await page.goto(base + '/');
    await page.waitForSelector('canvas');
    await page.waitForFunction(() => window.__ship?.state && window.__ship.touch && document.querySelectorAll('.tk').length >= 3, null, { timeout: 30000 });
    await page.evaluate(() => document.fonts.ready);
    await sleep(2500);

    const ship = fn => page.evaluate(fn);
    const wait = (fn, arg, ms = 40000) => page.waitForFunction(fn, arg, { timeout: ms });
    const order = id => page.evaluate(id => window.__ship.state.orders.find(o => o.id === id), id);
    const pos = () => ship(() => ({ x: window.__ship.player.g.position.x, z: window.__ship.player.g.position.z }));
    const slotFor = id => page.evaluate(id => `slot${window.__ship.slotOf.get(id)}`, id);
    /** A finger on a station: never dead centre, the way a thumb never is. */
    const tapStation = async (id, dx = 5, dy = -4) => {
      const p = await page.evaluate(id => window.__ship.touch.at(id), id);
      await page.touchscreen.tap(p.x + dx, p.y + dy);
    };
    const tap = sel => page.locator(sel).tap();
    const touch = (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts.map(([x, y]) => ({ x, y })) });
    /** A drag from one point to another, held at the end, then lifted. */
    const drag = async (x0, y0, x1, y1, holdMs) => {
      await touch('touchStart', [[x0, y0]]);
      for (let i = 1; i <= 6; i++) { await touch('touchMove', [[x0 + (x1 - x0) * i / 6, y0 + (y1 - y0) * i / 6]]); await sleep(16); }
      await sleep(holdMs);
      const held = await pos();
      await touch('touchEnd', []);
      return held;
    };

    /** What must hold in every screenshot: nothing scrolls, no two labels overlap, and nothing lies over the room that should not. */
    const picture = async (name, { cardClear = true } = {}) => {
      await shot(name);
      const p = await ship(() => {
        const box = el => { const r = el.getBoundingClientRect(); return { x0: r.left, y0: r.top, x1: r.right, y1: r.bottom, w: r.width, h: r.height }; };
        const cross = (a, b) => a.x0 < b.x1 - 1 && b.x0 < a.x1 - 1 && a.y0 < b.y1 - 1 && b.y0 < a.y1 - 1;
        const labels = [...document.querySelectorAll('.lbl:not(.hid)')].filter(el => el.getBoundingClientRect().width > 0);
        const rects = labels.map(box);
        let overlaps = 0;
        for (let a = 0; a < rects.length; a++) for (let b = a + 1; b < rects.length; b++) if (cross(rects[a], rects[b])) overlaps++;
        const inRoom = labels.filter(el => !el.querySelector('.bub')).map(box);
        const room = window.__ship.touch.state.room, hud = box(document.querySelector('.hud')), card = box(document.getElementById('card'));
        const pad = [...document.querySelectorAll('.pad .stick, .pad .tb')].filter(el => el.getBoundingClientRect().width > 0).map(box);
        const se = document.scrollingElement, stage = document.getElementById('stage');
        window.scrollTo(0, 200); se.scrollTop = 200; stage.scrollTop = 200; stage.scrollLeft = 200;
        return {
          overlaps, labels: rects.length, room, card,
          scroll: { x: window.scrollX + stage.scrollLeft, y: window.scrollY + stage.scrollTop, w: se.scrollWidth, h: se.scrollHeight, iw: innerWidth, ih: innerHeight },
          underHud: inRoom.filter(r => r.y0 < hud.y1 - 1).length,
          underCard: card.h ? inRoom.filter(r => cross(r, card)).length : 0,
          underPad: inRoom.filter(r => pad.some(b => cross(r, b))).length,
          offScreen: rects.filter(r => r.x0 < -1 || r.y0 < -1 || r.x1 > innerWidth + 1 || r.y1 > innerHeight + 1).length,
          cardOnRoom: card.h > 0 && cross(card, { x0: room.x0, y0: room.y0, x1: room.x1, y1: room.y1 }),
        };
      });
      const s = p.scroll;
      if (s.x || s.y || s.w > s.iw || s.h > s.ih) throw new Error(`FAILED: ${name}: the page scrolls (${JSON.stringify(s)})`);
      if (p.overlaps) throw new Error(`FAILED: ${name}: ${p.overlaps} labels overlap`);
      if (p.underHud || p.underCard || p.underPad || p.offScreen) throw new Error(`FAILED: ${name}: labels under the top strip (${p.underHud}), the card (${p.underCard}), the thumbs (${p.underPad}) or off the screen (${p.offScreen})`);
      if (cardClear && p.cardOnRoom) throw new Error(`FAILED: ${name}: the focus card covers the kitchen (${JSON.stringify(p.card)} over ${JSON.stringify(p.room)})`);
      return p;
    };
    /** Everything on screen that a finger can press, with the size of what it would hit. */
    const targets = () => ship(() => {
      const out = [];
      const seen = el => { const r = el.getBoundingClientRect(), cs = getComputedStyle(el); return r.width > 0 && cs.visibility !== 'hidden' && cs.pointerEvents !== 'none' ? r : null; };
      for (const el of document.querySelectorAll('.hud button, .hud a, .tb, .card .keys .k, .bub li, .bub .bf .k, #review.open button, #lineForm:not([hidden]) button')) {
        const r = seen(el); if (!r || r.right < 0 || r.left > innerWidth || r.top > innerHeight) continue;
        out.push({ what: el.id || el.getAttribute('aria-label') || el.textContent.trim().slice(0, 24) || el.className, w: r.width, h: r.height });
      }
      return out;
    });
    const checkTargets = async where => {
      const all = await targets(), small = all.filter(t => t.w < 43.5 || t.h < 43.5);
      ok(all.length >= 5 && !small.length, `${where}: all ${all.length} buttons are 44px or more${small.length ? ' EXCEPT ' + small.map(t => `${t.what} ${Math.round(t.w)}x${Math.round(t.h)}`).join(', ') : ''}`);
    };
    /** Things in the room are smaller than a thumb, so a tap takes the nearest one: every sign answers to its own station, and a miss of 22px still lands. */
    const checkAim = async where => {
      const a = await ship(() => {
        const t = window.__ship.touch, out = { reach: t.reach, signs: 0, wrong: [], missed: [] };
        for (const el of document.querySelectorAll('.lbl.click:not(.hid)')) {
          const r = el.getBoundingClientRect(); if (!r.width) continue;
          out.signs++;
          const got = t.aim(r.left + r.width / 2, r.top + r.height / 2);
          if (got !== el.dataset.goto) out.wrong.push(`${el.dataset.goto} -> ${got}`);
        }
        // stations with nothing else near them: 22px off in every direction is still a hit, so each is a 44px target or better
        for (const id of ['bin', 'hatch', 'oven']) {
          const p = t.at(id);
          for (const [dx, dy] of [[22, 0], [-22, 0], [0, 22], [0, -22]]) { const got = t.aim(p.x + dx, p.y + dy); if (got !== id) out.missed.push(`${id}${dx ? (dx > 0 ? ' right' : ' left') : dy > 0 ? ' below' : ' above'} -> ${got}`); }
        }
        return out;
      });
      ok(a.signs >= 4 && !a.wrong.length && !a.missed.length && a.reach >= 22, `${where}: a tap on each of ${a.signs} signs picks its own station, and a tap 22px wide of the bin, the hatch or the oven still finds it${a.wrong.length || a.missed.length ? ' EXCEPT ' + [...a.wrong, ...a.missed].join(', ') : ''}`);
    };

    /* ---------- the page and the picture ---------- */
    const env = await ship(() => ({ on: window.__ship.touch.on, layout: window.__ship.touch.layout, viewport: document.querySelector('meta[name=viewport]').content, quality: window.__ship.touch.quality }));
    ok(env.on && env.layout === screen.layout, `the page knows it is under a finger and lays itself out ${screen.layout}`);
    ok(/viewport-fit=cover/.test(env.viewport) && /user-scalable=no/.test(env.viewport), 'the viewport covers the notch and does not zoom');
    ok(env.quality.pr <= 1.5 && env.quality.shadow <= 1024, `drawn at pixel ratio ${env.quality.pr} with a ${env.quality.shadow}px shadow map`);
    const first = await picture('01-start');
    ok(true, 'the page does not scroll, even when asked to');
    ok(first.labels >= 7, `${first.labels} labels on screen, none overlapping, none under the top strip, the card or the thumbs`);
    const floor = await ship(() => window.__ship.touch.floor());
    const fw = (floor.x1 - floor.x0) / floor.w, fh = (floor.y1 - floor.y0) / floor.h;
    if (screen.layout === 'tall') ok(fw >= 0.74 && floor.x0 >= 0 && floor.x1 <= floor.w, `the kitchen floor spans ${(fw * 100).toFixed(0)}% of the screen's width (74% or more) and all of it is in view`);
    else if (screen.layout === 'desk') ok(fw >= 0.7 && floor.y1 <= floor.h, `the kitchen floor spans ${(fw * 100).toFixed(0)}% of the screen's width (70% or more)`);
    else ok(fh >= 0.42 && fw >= 0.45 && floor.y1 <= floor.h && (first.room.y1 - first.room.y0) / floor.h >= 0.7, `the kitchen floor fills ${(fh * 100).toFixed(0)}% of the screen's height and ${(fw * 100).toFixed(0)}% of its width (42% and 45% or more), and the room with its walls ${((first.room.y1 - first.room.y0) / floor.h * 100).toFixed(0)}% of the height`);
    ok(!first.cardOnRoom, 'the focus card sits clear of the kitchen');
    await checkTargets('at the start');
    await checkAim('at the start');
    if (screen.glance) {
      // one tap to prove the thumbs are live on a tablet too, then the same picture checks with a ticket in hand
      await tapStation(await slotFor(1));
      await wait(() => window.__ship.player.carry?.id === 1);
      await sleep(300);
      // on its side a tablet keeps the desktop's card, which rests on the front wall as it does there
      await picture('02-carrying-a-ticket', { cardClear: screen.layout !== 'desk' });
      await tap('#tbPut');
      await wait(() => window.__ship.player.carry === null);
      ok(true, 'a tap took ticket #1 and Put down put it back');
      if (errors.length) throw new Error('Page errors:\n' + errors.join('\n'));
      return;
    }

    /* ---------- the clock's settings ---------- */
    await tap('#clockBtn');
    await sleep(200);
    await shot('01b-shift-settings');
    const pop = await ship(() => { const r = document.getElementById('shiftPop').getBoundingClientRect(); return { x0: r.left, x1: r.right, y1: r.bottom, hud: document.querySelector('.hud').getBoundingClientRect().bottom, f: [...document.querySelectorAll('#shiftPop input, #shiftPop button')].map(el => el.getBoundingClientRect().height) }; });
    ok(pop.x0 >= 0 && pop.x1 <= screen.width && pop.f.every(h => h >= 44), 'the shift settings open under the clock, on screen, with 44px fields');
    await tap('#clockBtn');

    /* ---------- the stick ---------- */
    const p0 = await pos();
    let from;
    if (screen.layout === 'tall') { const r = await ship(() => { const r = document.getElementById('stick').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; }); from = [r.x, r.y]; }
    else from = [floor.x0 + (floor.x1 - floor.x0) * 0.45, floor.y0 + (floor.y1 - floor.y0) * 0.5];
    const p1 = await drag(from[0], from[1], from[0] - 60, from[1], 500);
    await shot('02-stick');
    ok(p1.x < p0.x - 0.8 && Math.abs(p1.z - p0.z) < 0.4, `${screen.layout === 'tall' ? 'the thumb stick' : 'a drag on the floor'} walks the head chef left (x ${p0.x.toFixed(2)} -> ${p1.x.toFixed(2)})`);
    await sleep(400);
    const p2 = await pos();
    await sleep(300);
    const p3 = await pos();
    ok(Math.abs(p3.x - p2.x) < 0.02 && !(await ship(() => window.__ship.player.path)), 'and lifting the thumb stops, with no stray tap');

    /* ---------- tap a ticket, tap a chef ---------- */
    await tapStation(await slotFor(1));
    await wait(() => window.__ship.player.carry?.id === 1);
    await sleep(300);
    await picture('03-carrying-a-ticket');
    await tapStation('chef0', -6, 5);
    await wait(() => window.__ship.state.chefs[0].orderId === 1);
    ok(true, 'tapped ticket #1 at the window, then tapped Pixel: the ticket is his');

    // Put down: take #3, change your mind
    await tapStation(await slotFor(3));
    await wait(() => window.__ship.player.carry?.id === 3);
    await tap('#tbPut');
    await wait(() => window.__ship.player.carry === null);
    ok((await order(3)).state === 'waiting', 'Put down put ticket #3 back at the window');

    /* ---------- a blocked chef: big answers ---------- */
    await tapStation(await slotFor(2));
    await wait(() => window.__ship.player.carry?.id === 2);
    await tapStation('chef1');
    await wait(() => window.__ship.state.chefs[1].orderId === 2);
    await wait(() => window.__ship.state.questions.some(q => q.orderId === 2), null, 30000);
    // walk off, then let Next urgent find the blocked chef
    await tapStation('bin');
    await wait(() => window.__ship.touch.near === 'bin');
    await wait(() => document.getElementById('tbNext').classList.contains('hot'));
    await tap('#tbNext');
    await wait(() => document.querySelector('.bub li[data-key="1"]'));
    ok((await ship(() => window.__ship.touch.near)) === 'chef1', 'Next urgent walked to the blocked chef');
    await sleep(500);
    const bub = await picture('04-question');
    const opts = await ship(() => [...document.querySelectorAll('.bub li')].map(el => { const r = el.getBoundingClientRect(); return { w: r.width, h: r.height, y1: r.bottom }; }));
    ok(opts.length >= 2 && opts.every(o => o.h >= 44 && o.w >= 200 && o.y1 <= screen.height), `the question's ${opts.length} answers are ${Math.round(Math.min(...opts.map(o => o.h)))}px tall and ${Math.round(opts[0].w)}px wide, all on screen`);
    if (screen.layout === 'tall') ok(await ship(() => { const b = document.querySelector('.bub').getBoundingClientRect(); return b.top >= window.__ship.touch.state.room.y1; }), 'upright, the question is laid out under the kitchen instead of over it');
    ok(bub.overlaps === 0, 'no label overlaps the question');
    await checkTargets('with a question open');
    await tap('.bub li[data-key="1"]');
    await wait(() => !window.__ship.state.questions.some(q => q.orderId === 2), null, 10000);
    ok(true, 'a tap on the first answer unblocked the chef');

    /* ---------- call out ---------- */
    await wait(() => window.__ship.state.orders.find(o => o.id === 2).state === 'cooking' && !window.__ship.state.questions.length && document.getElementById('tbCall').getAttribute('aria-disabled') === 'false', null, 10000);
    await tap('#tbCall');
    await page.waitForSelector('#lineInput:focus', { timeout: 5000 });
    await page.keyboard.type('use round2');
    await sleep(200);
    await picture('05-call-out');
    // a phone's keyboard takes the bottom of the screen: the line being typed, its Send button and the room must all still be in view
    const visible = screen.layout === 'tall' ? screen.height - 320 : screen.height - 190;
    await page.evaluate(v => window.__ship.touch.keyboard(v), visible);
    await sleep(400);
    await shot('05b-keyboard-up');
    const typed = await ship(() => { const b = el => { const r = el.getBoundingClientRect(); return { y0: r.top, y1: r.bottom, h: r.height }; }; return { input: b(document.getElementById('lineInput')), send: b(document.querySelector('#lineForm .send')), room: window.__ship.touch.state.room, pad: getComputedStyle(document.getElementById('pad')).display }; });
    ok(typed.input.y1 <= visible && typed.send.y1 <= visible && typed.input.h >= 40 && typed.room.y1 <= visible && typed.pad === 'none', `with a keyboard over the bottom ${screen.height - visible}px, the line and Send sit at y ${Math.round(typed.input.y1)} of the ${visible}px left, under a kitchen that is still whole`);
    await page.evaluate(() => window.__ship.touch.keyboard(0));
    await sleep(300);
    await tap('#lineForm .send');
    await wait(() => window.__ship.state.stats.steers >= 1 && window.__ship.state.orders.find(o => o.id === 2).activity.some(a => /called out: use round2/.test(a.text)), null, 10000);
    ok(true, 'Call out opened the line, and Send shouted it to the chef');

    /* ---------- taste with the big button ---------- */
    await wait(() => window.__ship.state.orders.find(o => o.id === 2).state === 'cooking' && document.getElementById('tbActWord').textContent === 'Taste', null, 10000);
    await tap('#tbAct');
    await wait(() => window.__ship.ui.taste === 'chef1' && window.__ship.ui.wip && !window.__ship.ui.wip.error && document.querySelector('.wip .file'), null, 10000);
    await sleep(400);
    await picture('06-taste');
    ok(true, 'the big button said Taste, and showed the live diff in the card without covering the kitchen');

    /* ---------- the plate reaches the pass; review it on the sheet ---------- */
    await wait(() => window.__ship.state.orders.find(o => o.id === 1).state === 'at_pass' && window.__ship.plates.get(1)?.mv.key?.startsWith('pass') && window.__ship.plates.get(1).mv.t >= 1, null, 120000);
    const slot = await ship(() => `pass${window.__ship.passSlotOf.get(1)}`);
    await tapStation(slot, 7, 3);
    await wait(() => document.querySelector('#review.open .hunk'));
    await sleep(900);
    const rev = await picture('07-review', { cardClear: false });
    const sheet = await ship(() => {
      const r = document.getElementById('review').getBoundingClientRect(), d = document.getElementById('rDiff'), ln = d.querySelector('.ln'), room = window.__ship.touch.state.room;
      const b = id => { const x = document.getElementById(id).getBoundingClientRect(); return { w: x.width, h: x.height }; };
      const f = window.__ship.touch.floor();
      return { x0: r.left, x1: r.right, y0: r.top, y1: r.bottom, room, font: parseFloat(getComputedStyle(ln).fontSize), diffH: d.clientHeight, diffW: d.clientWidth, scrollW: d.scrollWidth, overflowX: getComputedStyle(d).overflowX, approve: b('rApprove'), back: b('rBack'), floorOnScreen: f.x0 >= -1 && f.x1 <= r.left + 1 || f.y1 <= r.top + 1 };
    });
    if (screen.layout === 'tall') ok(sheet.x0 <= 1 && sheet.x1 >= screen.width - 1 && sheet.y1 >= screen.height - 1 && sheet.y0 >= sheet.room.y1 - 2, `review rose as a bottom sheet from y ${Math.round(sheet.y0)}, under the kitchen, which is still in view`);
    else ok(sheet.x1 >= screen.width - 1 && sheet.x0 >= sheet.room.x1 - 2 && sheet.y1 >= screen.height - 1, `review docked on the right from x ${Math.round(sheet.x0)}, and the kitchen moved over to stay in view`);
    ok(sheet.font >= 12 && sheet.diffH >= 90, `the diff is ${sheet.font}px code in a ${Math.round(sheet.diffW)}x${Math.round(sheet.diffH)} window of its own`);
    ok(['auto', 'scroll'].includes(sheet.overflowX) && sheet.scrollW > sheet.diffW, `long lines scroll sideways inside it (${sheet.scrollW}px of code in ${Math.round(sheet.diffW)}px)`);
    ok(sheet.approve.h >= 44 && sheet.back.h >= 44 && sheet.approve.w >= 100 && sheet.back.w >= 100, `Approve is ${Math.round(sheet.approve.w)}x${Math.round(sheet.approve.h)} and Send back ${Math.round(sheet.back.w)}x${Math.round(sheet.back.h)}`);
    ok(rev.overlaps === 0, 'no labels overlap behind the sheet');
    await checkTargets('in review');
    // a sideways swipe on the code scrolls the code, and only the code
    const d0 = await ship(() => { const r = document.getElementById('rDiff').getBoundingClientRect(); return { x: r.left + r.width * 0.7, y: r.top + r.height * 0.5 }; });
    await touch('touchStart', [[d0.x, d0.y]]);
    for (let i = 1; i <= 8; i++) { await touch('touchMove', [[d0.x - i * 12, d0.y]]); await sleep(16); }
    await touch('touchEnd', []);
    await sleep(300);
    const swiped = await ship(() => ({ diff: document.getElementById('rDiff').scrollLeft, page: window.scrollX + document.scrollingElement.scrollLeft, open: !!document.querySelector('#review.open') }));
    ok(swiped.diff > 20 && swiped.page === 0 && swiped.open, `a swipe scrolled the code ${Math.round(swiped.diff)}px sideways and nothing else moved`);
    await ship(() => { document.getElementById('rDiff').scrollLeft = 0; });
    const hunks = await page.locator('#review .hunk').count();
    for (let i = 0; i < hunks; i++) { await tap('.hunknav [data-press="J"]'); await sleep(60); }
    await tap('.hunknav [data-press="K"]');
    await sleep(200);
    ok(await ship(() => window.__ship.diffSeen(window.__ship.state.orders.find(o => o.id === 1))), `Next and Prev walked all ${hunks} hunks, so the diff counts as seen`);
    await shot('08-review-last-hunk');
    await tap('#rApprove');
    await wait(() => window.__ship.state.orders.find(o => o.id === 1).approved === true, null, 10000);
    await wait(() => !document.querySelector('#review.open'));
    ok((await order(1)).state === 'at_pass', 'a tap on Approve approved it; nothing merged yet');

    /* ---------- carry it to the hatch ---------- */
    await sleep(600);
    await wait(() => document.getElementById('tbActWord').textContent === 'Carry');
    await picture('09-approved');
    await tap('#tbAct');
    await wait(() => window.__ship.player.carry?.type === 'plate' && window.__ship.player.carry.id === 1);
    const fx0 = await ship(() => ({ ...window.__ship.fx }));
    await tapStation('hatch', -4, 4);
    await wait(() => window.__ship.state.orders.find(o => o.id === 1).state === 'shipped', null, 90000);   // the merge runs the demo repo's real tests
    await sleep(700);
    await picture('10-shipped');
    const fx1 = await ship(() => ({ ...window.__ship.fx })), st = await ship(() => window.__ship.state.stats);
    ok(st.shipped === 1 && st.blindShips === 0, `the big button said Carry, a tap on the hatch shipped #1 to main, score ${st.score}`);
    ok(fx1.popups > fx0.popups && fx1.shakes > fx0.shakes && fx1.sounds > fx0.sounds, `juice fired: ${fx1.popups} popups, ${fx1.shakes} shakes, ${fx1.sounds} sounds`);

    /* ---------- the menu and the dialogs ---------- */
    if (screen.layout === 'tall') { await tap('#moreBtn'); await sleep(200); await shot('11-menu'); await checkTargets('with the menu open'); }
    await tap('#newOrderBtn');
    await page.waitForSelector('#orderDialog[open]');
    await sleep(200);
    await shot('12-new-order');
    const dlg = await ship(() => { const r = document.getElementById('orderDialog').getBoundingClientRect(); const b = [...document.querySelectorAll('#orderDialog button')].map(x => x.getBoundingClientRect().height); return { x0: r.left, x1: r.right, y0: r.top, y1: r.bottom, b, font: parseFloat(getComputedStyle(document.getElementById('oTitle')).fontSize) }; });
    ok(dlg.x0 >= 0 && dlg.y0 >= 0 && dlg.x1 <= screen.width && dlg.y1 <= screen.height && dlg.b.every(h => h >= 44) && dlg.font >= 16, 'the New order dialog fits the screen, with 44px buttons and 16px fields that do not make the phone zoom');
    await tap('#orderCancel');

    ok(offHost.length === 0, `no network requests left 127.0.0.1${offHost.length ? ': ' + offHost.join(', ') : ''}`);
    if (errors.length) throw new Error('Page errors:\n' + errors.join('\n'));
  } catch (e) {
    if (page) await shot('99-failure').catch(() => {});
    if (errors.length) console.error(errors.join('\n'));
    throw e;
  } finally {
    await context?.close();
    server.kill();
    await sleep(300);
    await fs.rm(tmp, { recursive: true, force: true }).catch(() => {});
  }
}

try {
  browser = await chromium.launch({ headless: true, executablePath: await findChrome(), args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  for (const screen of SCREENS) if (!only || only === screen.name) await play(screen);
  console.log(`Mobile check passed (${passed} checks)`);
} catch (e) {
  console.error(e.message);
  process.exitCode = 1;
} finally {
  await browser?.close();
}
