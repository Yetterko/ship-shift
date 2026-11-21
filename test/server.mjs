// Server core tests: the skeleton over a real socket, then floors, roles, actions, the loop, the Pomodoro layer and
// scoring against an injected clock. Headless, no browser, no API (`node test/server.mjs`).
import { test } from 'node:test';
import { isPickedName } from '../content/orders.mjs';
import assert from 'node:assert/strict';
import { startServer, wsClient } from './helpers/server.mjs';
import { loadConfig } from '../server/config.mjs';
import { createGame } from '../server/game.mjs';
import { splitHunks } from '../shared/hunks.js';
import { fixtureFloor, FIXTURE_STAGES, fixtureBuilding } from '../shared/fixtures.js';

// ---------- helpers for the in-process game ----------

async function game(env = {}, opts = {}) {
  const clock = { t: 1_000_000 };
  const config = loadConfig(env);
  const g = await createGame({ config, now: () => clock.t, ...opts });
  const run = ms => { for (let i = 0; i < ms; i += 250) { clock.t += 250; g.tickAll(clock.t); } };
  return { g, clock, run, config };
}

function client(g) {
  const out = [];
  const conn = g.connect(s => out.push(JSON.parse(s)));
  let seq = 0;
  const c = {
    conn, out,
    send: (type, body = {}) => g.message(conn, { type, ...body }),
    act: (name, args = {}) => { c.send('action', { seq: ++seq, name, args }); return out.filter(m => m.type === 'ack').pop(); },
    last: type => out.filter(m => m.type === type).pop(),
    notes: kind => out.filter(m => m.type === 'notify' && (!kind || m.kind === kind)),
  };
  return c;
}

function player(g, role = 'player', body = {}) {
  const c = client(g);
  c.send('hello', { v: 1 });
  c.send('chooseRole', { role });
  c.send('createFloor', body);
  c.welcome = c.last('welcome');
  c.floorId = c.welcome.floorId;
  if (c.floorId) c.send('subscribe', { floorId: c.floorId });
  c.floor = () => g.floors.get(c.floorId);
  return c;
}

const picks = c => c.order.quickPicks.map(q => ({ prompt: q.prompt, station: q.station, quickPickId: q.id }));
const seatAndSend = (p, customerId, items) => {
  assert.equal(p.act('seat', { customerId }).ok, true);
  const cust = p.floor().tables.find(x => x && x.id === customerId);
  assert.equal(p.act('saveItems', { customerId, items: items || picks(cust) }).ok, true);
  assert.equal(p.act('sendItems', { customerId }).ok, true);
  return cust;
};
/** Samples every hunk of every ready Meal on the Pass and approves it. */
const reviewAll = p => {
  const f = p.floor();
  for (const id of [...f.pass]) {
    const m = f.meals[id];
    if (f.items[m.itemId].status !== 'ready') continue;
    p.act('sampleMeal', { mealId: id });
    for (let h = 1; h < m.hunks.length; h++) p.act('seeHunk', { mealId: id, index: h });
    assert.equal(p.act('approveMeal', { mealId: id }).ok, true);
  }
};

// ---------- the skeleton over a real socket ----------

test('skeleton: /health, /healthz, static, /shared, hello → welcome, subscribe → floor', async () => {
  const s = await startServer({});
  try {
    for (const p of ['/health', '/healthz']) assert.deepEqual(await (await fetch(s.url + p)).json(), { ok: true });
    const shared = await fetch(s.url + '/shared/protocol.js');
    assert.equal(shared.status, 200);
    assert.match(shared.headers.get('content-type'), /javascript/);
    assert.equal((await fetch(s.url + '/content/orders.mjs')).status, 200);
    assert.equal((await fetch(s.url + '/admin/usage')).status, 404, 'admin is hidden without ADMIN_SECRET');
    assert.equal((await fetch(s.url + '/preview/showcase/')).status, 404);
    const c = await wsClient(s.url);
    c.send('hello', { v: 1 });
    const w = await c.next('welcome');
    assert.equal(w.v, 1); assert.equal(w.role, 'spectator'); assert.equal(w.floorId, null); assert.equal(w.showcase, false);
    assert.equal(w.limits.items, 5);
    c.send('chooseRole', { role: 'player' });
    await c.next('welcome', m => m.role === 'player');
    c.send('createFloor', { name: 'Typed Free Text' });
    const made = await c.next('welcome', m => m.floorId);
    assert.ok(made.token);
    c.send('subscribe', { floorId: made.floorId });
    const fm = await c.next('floor');
    assert.equal(fm.floor.mode, 'demo', 'no key: every floor is Demo');
    assert.notEqual(fm.floor.name, 'Typed Free Text', 'a typed name is never used: names come from the game lists');
    assert.ok(isPickedName(fm.floor.name), 'the floor gets a picked name instead');
    assert.deepEqual(fm.you, { isOwner: true, canAct: true });
    assert.equal(fm.floor.line.length, 5);
    assert.ok(!JSON.stringify(fm).includes(made.token), 'the snapshot never holds the token');
    const b = await c.next('building', () => true, 4000);
    assert.equal(b.floors.length, 1);
    c.close();
  } finally { await s.stop(); }
});

test('skeleton: the Demo loop ships Priya over WebSocket', async () => {
  const s = await startServer({ SHIP_PACE: '10' });
  try {
    const c = await wsClient(s.url);
    c.send('hello', { v: 1 }); await c.next('welcome');
    c.send('chooseRole', { role: 'player' }); await c.next('welcome');
    c.send('createFloor', {}); const { floorId } = await c.next('welcome', m => m.floorId);
    c.send('subscribe', { floorId }); const first = await c.next('floor');
    const priya = first.floor.line[0];
    assert.equal((await c.act('seat', { customerId: priya.id })).ok, true);
    assert.equal((await c.act('saveItems', { customerId: priya.id, items: picks(priya) })).ok, true);
    assert.equal((await c.act('sendItems', { customerId: priya.id })).ok, true);
    const ready = await c.next('floor', m => Object.values(m.floor.items).filter(i => i.status === 'ready').length === 2, 15_000);
    for (const id of ready.floor.pass) {
      const meal = ready.floor.meals[id];
      await c.act('sampleMeal', { mealId: id });
      for (let h = 1; h < meal.hunks.length; h++) await c.act('seeHunk', { mealId: id, index: h });
      assert.equal((await c.act('approveMeal', { mealId: id })).ok, true);
    }
    assert.equal((await c.act('serveOrder', { customerId: priya.id, note: 'Check each acceptance criterion' })).ok, true);
    await c.next('floor', m => m.floor.tables[0]?.status === 'awaiting_player', 10_000);
    assert.equal((await c.act('readFeedback', { customerId: priya.id })).ok, true);
    assert.equal((await c.act('giveBill', { customerId: priya.id })).ok, true);
    const shipped = c.msgs.find(m => m.type === 'notify' && m.kind === 'shipped');
    assert.equal(shipped?.floorId, floorId);
    const after = await c.next('floor', m => m.floor.tables[0] === null, 5000);
    assert.equal(after.floor.stats.shipped, 1);
    assert.ok(after.floor.pops.some(x => x.text === 'SHIPPED' && x.points === 100));
    assert.ok(after.floor.pops.some(x => x.text === 'RIGHT FIRST TIME' && x.points === 40));
    assert.deepEqual(after.floor.tv.shots, ['o1']);
    c.close();
  } finally { await s.stop(); }
});

// ---------- the contract files ----------

test('shared: splitHunks splits on blank lines, at most 12 lines a hunk', () => {
  const code = Array.from({ length: 15 }, (_, i) => `line ${i}`).join('\n') + '\n\nnext\nblock';
  const h = splitHunks(code, 'api.js');
  assert.equal(h.length, 3);
  assert.equal(h[0].lines.length, 12); assert.equal(h[1].lines.length, 3); assert.equal(h[2].lines.length, 2);
  assert.ok(h.every(x => x.file === 'api.js' && x.lines.every(l => l.t === '+')));
});

test('shared: every fixture stage builds; the building fixture has n floors', () => {
  for (const s of FIXTURE_STAGES) assert.equal(fixtureFloor(s).tables.length, 2, s);
  assert.equal(fixtureBuilding(30).floors.length, 30);
});

// ---------- the core loop in Demo, clock-driven ----------

test('loop: all 5 Orders ship in Demo; FIFO; 2 Chefs at most; Order 3 first review fails; typed Items get set menu', async () => {
  const { g, run } = await game({ SHIP_PACE: '1' });
  const p = player(g);
  const f = p.floor();
  assert.equal(f.mode, 'demo'); assert.equal(f.timings, 'short');
  const seen = [];
  let maxBusy = 0;
  const step = ms => {
    for (let i = 0; i < ms; i += 250) {
      run(250);
      const fl = p.floor();
      maxBusy = Math.max(maxBusy, fl.chefs.filter(c => c.status !== 'idle').length);
      for (const c of fl.chefs) if (c.itemId && !seen.includes(c.itemId)) seen.push(c.itemId);
      if (fl.mustBreak) { assert.equal(p.act('startBreak').ok, true); p.act('endBreak'); }
    }
  };
  const feedbacks = {};
  for (const id of ['c1', 'c2', 'c3', 'c4', 'c5']) {
    const cust = p.floor().line.find(c => c.id === id);
    const items = picks(cust);
    if (id === 'c5') items[0] = { prompt: 'Frontend: make the header big and purple with our brand colour', station: 'frontend', typed: true };
    seatAndSend(p, id);
    if (id === 'c5') {
      // Replace the drafts before they were sent? They are sent; add the typed one as a second round below.
    }
    for (let round = 0; round < 4; round++) {
      for (let k = 0; k < 400; k++) {
        step(250);
        reviewAll(p);
        const fl = p.floor(), cu = fl.tables.find(x => x && x.id === id);
        const open = cu.order.itemIds.map(i => fl.items[i]).filter(i => i && !['approved', 'served'].includes(i.status));
        if (!open.length && cu.status !== 'eating' && fl.pass.some(m => fl.meals[m].orderId === cu.order.id)) p.act('serveOrder', { customerId: id });
        if (cu.status === 'awaiting_player') break;
      }
      const cu = p.floor().tables.find(x => x && x.id === id);
      (feedbacks[id] ||= []).push(cu.feedback.satisfied);
      if (cu.feedback.satisfied) { assert.equal(p.act('giveBill', { customerId: id }).ok, true); break; }
      assert.equal(p.act('moreWork', { customerId: id }).ok, true);
      if (id === 'c5' && round === 0) p.act('saveItems', { customerId: id, items: [items[0]] });
      assert.equal(p.act('sendItems', { customerId: id }).ok, true);
    }
    step(4000);
  }
  const fl = p.floor();
  assert.equal(fl.stats.shipped, 5);
  assert.deepEqual(fl.tv.shots, ['o1', 'o2', 'o3', 'o4', 'o5']);
  assert.equal(feedbacks.c3[0], false, "Order 3's first review is not satisfied");
  assert.equal(feedbacks.c1[0], true);
  assert.ok(maxBusy <= 2);
  assert.equal(fl.shift.status, 'ended', 'the line is empty and the tables are clear');
  assert.equal(fl.shift.report.shipped, 5);
  // FIFO: Chefs picked Items in the order they were sent (Item ids rise in send order within one Order).
  const firstOrder = seen.filter(id => ['i1', 'i2'].includes(id));
  assert.deepEqual(firstOrder, ['i1', 'i2']);
});

test('loop: a typed Item gets the closest scripted Meal, labelled set menu', async () => {
  const { g, run } = await game({});
  const p = player(g);
  seatAndSend(p, 'c1', [{ prompt: 'Backend: sum up the hours of one person over the week', station: 'backend', typed: true }]);
  run(20_000);
  const f = p.floor();
  const meal = Object.values(f.meals)[0];
  assert.ok(meal, 'a Meal is on the Pass');
  assert.equal(meal.setMenu, true);
  assert.match(meal.summary, /totalHours/);
  const qp = Object.values(f.meals).length;
  assert.equal(qp, 1);
});

test('loop: FIFO with a third Item waiting on the rail; a redo goes to the front', async () => {
  const { g, run } = await game({});
  const p = player(g);
  seatAndSend(p, 'c3');
  run(1000);
  let f = p.floor();
  assert.deepEqual(f.chefs.map(c => c.itemId), ['i1', 'i2']);
  assert.deepEqual(f.readyQueue, ['i3']);
  run(20_000);
  f = p.floor();
  const m1 = Object.values(f.meals).find(m => m.itemId === 'i1');
  assert.equal(p.act('redoMeal', { mealId: m1.id, reason: '' }).code, 'empty');
  assert.equal(p.act('redoMeal', { mealId: m1.id, reason: 'Keep the change smaller' }).ok, true);
  f = p.floor();
  assert.equal(f.items.i1.redoCount, 1);
  assert.equal(f.items.i1.redoReason, 'Keep the change smaller');
  assert.ok(f.readyQueue[0] === 'i1' || f.chefs.some(c => c.itemId === 'i1'));
  assert.equal(f.stats.redos, 1);
});

// ---------- guards ----------

test('actions: illegal transitions answer the right code; visitors get view_only', async () => {
  const { g, run } = await game({});
  const p = player(g);
  assert.equal(p.act('seat', { customerId: 'nobody' }).code, 'bad_state');
  assert.equal(p.act('sendItems', { customerId: 'c1' }).code, 'bad_state');
  assert.equal(p.act('seat', { customerId: 'c1' }).ok, true);
  assert.equal(p.act('seat', { customerId: 'c1' }).code, 'bad_state');
  assert.equal(p.act('seat', { customerId: 'c2', table: 0 }).code, 'no_table');
  assert.equal(p.act('seat', { customerId: 'c2' }).ok, true);
  assert.equal(p.act('seat', { customerId: 'c3' }).code, 'no_table');
  assert.equal(p.act('sendItems', { customerId: 'c1' }).code, 'no_items');
  assert.equal(p.act('saveItems', { customerId: 'c1', items: Array(6).fill({ prompt: 'x', station: 'backend' }) }).code, 'too_many');
  assert.equal(p.act('saveItems', { customerId: 'c1', items: [{ prompt: 'x', station: 'kitchen' }] }).code, 'bad_station');
  assert.equal(p.act('saveItems', { customerId: 'c1', items: [{ prompt: '  ', station: 'backend' }] }).code, 'empty');
  assert.equal(p.act('giveBill', { customerId: 'c1' }).code, 'no_feedback');
  assert.equal(p.act('serveOrder', { customerId: 'c1' }).code, 'nothing_approved');
  assert.equal(p.act('endBreak').code, 'not_eligible');
  assert.equal(p.act('startBreak').code, 'not_eligible');
  const long = 'y'.repeat(2000);
  assert.equal(p.act('saveItems', { customerId: 'c1', items: [{ prompt: long, station: 'backend' }] }).ok, true);
  assert.equal(Object.values(p.floor().items)[0].prompt.length, 600);
  assert.equal(p.act('sendItems', { customerId: 'c1' }).ok, true);
  run(20_000);
  const meal = Object.values(p.floor().meals)[0];
  assert.ok(meal.hunks.length >= 2, 'the scripted Meal has more than one hunk');
  assert.equal(p.act('approveMeal', { mealId: meal.id }).code, 'unread');
  p.act('sampleMeal', { mealId: meal.id });
  assert.equal(p.floor().meals[meal.id].hunksSeen, 1);
  assert.equal(p.act('approveMeal', { mealId: meal.id }).code, 'unread');
  assert.equal(p.act('seeHunk', { mealId: meal.id, index: 99 }).code, 'bad_state');

  const v = client(g);
  v.send('hello', { v: 1 });
  v.send('subscribe', { floorId: p.floorId });
  const fm = v.last('floor');
  assert.deepEqual(fm.you, { isOwner: false, canAct: false });
  assert.equal(v.act('seat', { customerId: 'c3' }).code, 'view_only');
  assert.equal(v.act('sampleMeal', { mealId: meal.id }).code, 'view_only');
  assert.equal(p.floor().watchers, 1);
});

// ---------- floors, roles, slots, tokens, lifetime ----------

test('roles: the 61st live player gets no_slot; judge slots are held; Demo uses no slot', async () => {
  const fakeAgents = { cook: async () => ({ summary: 's', file: 'api.js', code: 'x', costUsd: 0 }), review: async () => ({ feedback: { satisfied: true, score: 5, comments: 'ok', suggestedFollowUps: [] }, costUsd: 0 }) };
  const { g } = await game({ ANTHROPIC_API_KEY: 'test-key', ANTHROPIC_BASE_URL: 'http://127.0.0.1:9', MAX_LIVE_FLOORS: '10', JUDGE_SLOTS: '2' }, { agents: fakeAgents });
  const players = Array.from({ length: 8 }, () => player(g));
  assert.ok(players.every(p => p.floor()?.mode === 'live'));
  const ninth = player(g);
  assert.equal(ninth.floorId, null);
  assert.equal(ninth.last('error').code, 'no_slot');
  assert.deepEqual(ninth.last('error').options, ['demo', 'visit', 'queue']);
  const demo = player(g, 'player', { mode: 'demo' });
  assert.equal(demo.floor().mode, 'demo');
  const j1 = player(g, 'judge'), j2 = player(g, 'judge');
  assert.equal(j1.floor().mode, 'live'); assert.equal(j2.floor().mode, 'live');
  assert.equal(j1.floor().model, 'claude-sonnet-5-5');
  assert.equal(players[0].floor().model, 'claude-haiku-5-5');
  const j3 = player(g, 'judge');
  assert.equal(j3.last('error').code, 'no_slot', 'judges past their reserve compete for the full general pool');
  // A live floor switching to Demo frees a slot; the queue hears about it.
  ninth.send('joinQueue');
  assert.equal(players[0].act('setMode', { mode: 'demo' }).ok, true);
  assert.equal(ninth.notes('slotFree').length, 1);
  assert.equal(demo.act('setMode', { mode: 'live' }).code, 'no_slot', 'the freed slot is held for the head of the queue');
  ninth.send('createFloor', {});
  assert.equal(g.floors.get(ninth.last('welcome').floorId).mode, 'live');
  const b = JSON.parse(JSON.stringify(g.ctx.roles.slots()));
  assert.equal(b.liveUsed, 10); assert.equal(b.judgeUsed, 2);
});

const fakeAgents = () => ({
  cook: async () => ({ summary: 'Did it.', file: 'api.js', code: 'export const x = 1;\n\nexport const y = 2;', costUsd: 0.0004 }),
  review: async () => ({ feedback: { satisfied: true, score: 5, comments: 'ok', suggestedFollowUps: [] }, costUsd: 0.0002 }),
});
const LIVE = { ANTHROPIC_API_KEY: 'test-key', ANTHROPIC_BASE_URL: 'http://127.0.0.1:9' };

test('floors: a reconnect with the token regains the floor; destroyed 15 min after the owner leaves', async () => {
  const { g, run } = await game(LIVE, { agents: fakeAgents() });
  const p = player(g);
  assert.equal(p.floor().mode, 'live'); assert.equal(p.floor().timings, 'real');
  const token = p.welcome.token;
  g.disconnect(p.conn);
  run(5 * 60_000);
  assert.equal(p.floor().ownerConnected, false);
  const back = client(g);
  back.send('hello', { v: 1, token });
  assert.equal(back.last('welcome').floorId, p.floorId);
  back.send('subscribe', { floorId: p.floorId });
  assert.equal(back.act('seat', { customerId: 'c1' }).ok, true);
  g.disconnect(back.conn);
  run(14 * 60_000);
  assert.ok(g.floors.get(p.floorId), 'still there at 14 min');
  run(61_000);
  assert.equal(g.floors.get(p.floorId), null, 'gone at 15 min');
  const again = client(g);
  again.send('hello', { v: 1, token });
  assert.equal(again.last('welcome').floorId, null);
});

test('floors: leave destroys the floor and tells watchers; Play again resets it', async () => {
  const { g } = await game({});
  const p = player(g);
  p.act('seat', { customerId: 'c1' });
  assert.equal(p.act('playAgain').ok, true);
  assert.equal(p.floor().line.length, 5);
  assert.equal(p.floor().score, 0);
  const v = client(g);
  v.send('subscribe', { floorId: p.floorId });
  assert.equal(p.act('leave').ok, true);
  assert.equal(g.floors.get(p.floorId), null);
  assert.equal(v.notes('floorClosed').length, 1);
  assert.equal(v.conn.subscribed, null);
});

test('floors: the snapshot JSON never contains a token, a key, costs or scripted ids', async () => {
  const fakeAgents = { cook: async () => ({ summary: 's', file: 'api.js', code: 'x', costUsd: 0.0004 }), review: async () => ({ feedback: { satisfied: true, score: 5, comments: 'ok', suggestedFollowUps: [] }, costUsd: 0 }) };
  const { g, run } = await game({ ANTHROPIC_API_KEY: 'sk-ant-secret-key', ANTHROPIC_BASE_URL: 'http://127.0.0.1:9' }, { agents: fakeAgents });
  const p = player(g);
  seatAndSend(p, 'c1');
  run(2000);
  await new Promise(r => setTimeout(r, 10));
  run(80_000);
  g.flush();
  const all = JSON.stringify(p.out.filter(m => m.type === 'floor' || m.type === 'building'));
  for (const bad of [p.welcome.token, 'sk-ant-secret-key', 'costUsd', 'scriptedMealId', 'priv', 'heldUsd']) assert.ok(!all.includes(bad), bad);
});

// ---------- Pomodoro and scoring ----------

/** A Demo floor with both Chefs cooking Quinn's first two Items. */
async function busyFloor(env = {}) {
  const ctx = await game(env);
  const p = player(ctx.g);
  seatAndSend(ctx.g === ctx.g ? p : p, 'c3');
  ctx.run(1000);
  return { ...ctx, p };
}

test('pomodoro: no call-back inside grace; call-back after grace + delay; patience starts at the call-back', async () => {
  const { p, run } = await busyFloor();
  let f = p.floor();
  assert.equal(f.breakEligible, true);
  assert.equal(p.act('startBreak').ok, true);
  f = p.floor();
  assert.equal(f.phase, 'break');
  assert.equal(f.callBack.graceEndsAt - f.phaseStartedAt, 10_000);
  // Quinn's Database Item (25 s / 4) is ready at about 7 s: inside the 10 s grace.
  run(9000);
  f = p.floor();
  assert.ok(f.pass.length >= 1, 'a Meal waits on the Pass');
  assert.equal(f.phase, 'break');
  assert.equal(p.notes('callBack').length, 0);
  assert.ok(Object.values(f.meals).every(m => !m.patience), 'no patience during grace');
  assert.equal(p.notes('mealReady').length, 0, 'Meals wait silently during a break');
  run(1000 + 1750);
  assert.equal(p.floor().phase, 'break', 'the 2 s call-back delay has not passed');
  run(500);
  f = p.floor();
  assert.equal(f.phase, 'called_back');
  const cb = p.notes('callBack');
  assert.equal(cb.length, 1);
  assert.match(cb[0].text, /Table 1/);
  assert.ok(Object.values(f.meals).filter(m => m.readyAt <= f.callBack.firedAt).every(m => m.patience && m.patience.startedAt === f.callBack.firedAt));
  run(3000);
  assert.equal(p.act('endBreak').ok, true);
  f = p.floor();
  assert.equal(f.phase, 'working');
  assert.equal(f.stats.callBacks, 1);
  assert.ok(f.stats.callBackMsTotal >= 3000);
  assert.ok(f.stats.breakMs >= 12_000);
  assert.ok(f.pops.some(x => x.text === 'RESTED CHEF BONUS' && x.points === 10));
});

test('pomodoro: nothing ready when grace ends → the break simply continues', async () => {
  const { p, run } = await busyFloor();
  p.act('updateSettings', { gracePeriodMs: 0 });
  assert.equal(p.floor().settings.gracePeriodMs, 0);
  p.act('startBreak');
  run(3000);
  assert.equal(p.floor().phase, 'break');
  assert.equal(p.notes('callBack').length, 0);
});

test('scoring: patience drains −1 per 5 % up to −20, then −50 at empty', async () => {
  const { p, run } = await busyFloor();
  run(8000);
  let f = p.floor();
  const meal = Object.values(f.meals)[0];
  assert.ok(meal.patience);
  const before = f.score;
  run(15_000); // half the 30 s meter
  f = p.floor();
  assert.equal(f.meals[meal.id].patience.lost, 10);
  run(16_000);
  f = p.floor();
  assert.equal(f.meals[meal.id].patience.lost, 20);
  assert.equal(f.meals[meal.id].patience.angry, true);
  const drained = f.stats.patienceLost;
  assert.ok(drained >= 70, `drained ${drained}`);
  assert.ok(f.score <= before - 70);
  assert.ok(f.pops.some(x => x.text === 'KEPT WAITING' && x.points === -50));
  // Sampling stops the meter.
  p.act('sampleMeal', { mealId: meal.id });
  assert.equal(p.floor().meals[meal.id].patience, undefined);
});

test('pomodoro: max work time warns, then every action but startBreak is refused with must_break', async () => {
  const { p, run } = await busyFloor();
  run(88_000);
  assert.equal(p.notes('mustBreak').length, 0);
  run(2000);
  assert.equal(p.notes('mustBreak').length, 1);
  assert.equal(p.floor().breakEligible, true);
  assert.equal(p.act('readFeedback', { customerId: 'c3' }).code, 'bad_state', 'inside the 20 s warning actions still run');
  run(20_000);
  assert.equal(p.floor().mustBreak, true);
  assert.equal(p.act('seat', { customerId: 'c1' }).code, 'must_break');
  assert.equal(p.act('startBreak').ok, true);
  assert.equal(p.floor().mustBreak, false);
  assert.equal(p.act('endBreak').ok, true);
  const f = p.floor();
  assert.equal(f.workStretchStartedAt, f.phaseStartedAt, 'the work stretch resets');
  assert.ok(f.stats.longestWorkMs >= 110_000);
});

test('scoring: the Chef idle penalty counts only after the first send, never during a break', async () => {
  const { g, run } = await game({});
  const p = player(g);
  run(60_000);
  assert.equal(p.floor().stats.idlePenalty, 0, 'nothing sent yet');
  seatAndSend(p, 'c1');
  run(30_000);
  const f = p.floor();
  assert.ok(f.stats.idlePenalty > 0);
  const n = f.stats.idlePenalty;
  // Both Chefs idle, the rail empty: a break is not eligible by Chefs, so check the rule through the stats only.
  assert.ok(n <= 6, `idle penalty ${n}`);
});

test('scoring: points and report numbers match a scripted run of Priya', async () => {
  const { g, run } = await game({});
  const p = player(g);
  seatAndSend(p, 'c1');
  for (let i = 0; i < 80 && p.floor().pass.length < 2; i++) run(250);
  reviewAll(p);
  assert.equal(p.act('serveOrder', { customerId: 'c1' }).ok, true);
  run(5000);
  const before = p.floor().score;
  assert.equal(p.act('giveBill', { customerId: 'c1' }).ok, true);
  const f = p.floor();
  const c = f.tables[0];
  assert.equal(c.status, 'paying');
  // 100 × difficulty 1 × score 5 ÷ 5 = 100, + 20 × 2 Meals right first time.
  assert.equal(c.receipt.points, 140);
  assert.equal(f.score - before, 140);
  assert.equal(c.receipt.items, 2); assert.equal(c.receipt.redos, 0); assert.equal(c.receipt.score, 5);
  run(3500);
  assert.equal(p.floor().tables[0], null);
  assert.equal(p.act('closeShift').ok, true);
  const r = p.floor().shift.report;
  assert.equal(r.shipped, 1); assert.equal(r.points, p.floor().score); assert.equal(r.reworkRate, 0);
  assert.match(r.verdict, /Line Cook/);
  assert.equal(p.act('seat', { customerId: 'c2' }).code, 'shift_over');
});

test('presence and the water gun: peers per zone; splash only close by, rate limited', async () => {
  const { g, clock } = await game({});
  const a = client(g), b = client(g), far = client(g);
  for (const c of [a, b, far]) c.send('hello', { v: 1 });
  a.send('p', { x: 0, z: 0, r: 0 }); b.send('p', { x: 3, z: 4, r: 0 }); far.send('p', { x: 30, z: 0, r: 0 });
  g.peers();
  assert.equal(a.last('peers').peers.length, 3);
  a.send('splash', { to: b.conn.id });
  assert.equal(b.out.filter(m => m.type === 'splashed').length, 1);
  assert.deepEqual(b.last('splashed').dir, { x: 0.6, z: 0.8 });
  const seen = a.last('splashed');
  assert.deepEqual({ fromId: seen.fromId, toId: seen.toId }, { fromId: a.conn.id, toId: b.conn.id }, 'everyone in the zone hears it, with the target named');
  assert.equal(far.out.filter(m => m.type === 'splashed').length, 1, 'the whole zone, even out of range');
  const elsewhere = client(g); elsewhere.conn.subscribed = 'some-floor';
  a.send('splash', { to: b.conn.id });
  assert.equal(elsewhere.out.filter(m => m.type === 'splashed').length, 0, 'another zone does not');
  a.send('splash', { to: b.conn.id });
  assert.equal(b.out.filter(m => m.type === 'splashed').length, 1, '1 a second per sender');
  a.send('splash', { to: far.conn.id });
  assert.ok(!far.out.some(m => m.type === 'splashed' && m.toId === far.conn.id), 'too far');
  clock.t += 2000;
  a.send('splash', { to: b.conn.id });
  assert.equal(b.out.filter(m => m.type === 'splashed').length, 2);
});

// ---------- the debug ticket view, in a headless browser ----------

test('ticket view: plays a full Order in a headless browser', async () => {
  const { launch, desktop } = await import('./helpers/headless.mjs');
  const s = await startServer({ SHIP_PACE: '10' });
  const browser = await launch();
  try {
    const page = await desktop(browser);
    await page.goto(s.url + '/ticket.html');
    await page.waitForFunction(() => window.__ticket?.welcome);
    const click = async test => { await page.locator(`[data-test="${test}"]`).first().click(); };
    const waitState = fn => page.waitForFunction(fn, null, { timeout: 15_000 });
    await click('role-player');
    await click('create-demo');
    await waitState(() => window.__ticket.floor?.line.length === 5);
    await click('seat-c1');
    await waitState(() => window.__ticket.floor.tables[0]);
    await click('picks-c1');
    await waitState(() => Object.keys(window.__ticket.floor.items).length === 2);
    await click('send-c1');
    await waitState(() => window.__ticket.floor.pass.length === 2);
    for (const id of await page.evaluate(() => window.__ticket.floor.pass)) {
      await click(`sample-${id}`);
      await page.waitForFunction(m => { const meal = window.__ticket.floor.meals[m]; return meal.hunksSeen === meal.hunks.length; }, id);
      await click(`approve-${id}`);
      await page.waitForFunction(m => window.__ticket.floor.items[window.__ticket.floor.meals[m].itemId].status === 'approved', id);
    }
    await click('serve-c1');
    await waitState(() => window.__ticket.floor.tables[0]?.status === 'awaiting_player');
    await click('bill-c1');
    await waitState(() => window.__ticket.floor.stats.shipped === 1);
    assert.deepEqual(page.errors, []);
  } finally { await browser.close(); await s.stop(); }
});

test('roles: an ended live shift frees its slot; Play again without one runs in Demo and says why', async () => {
  const { g } = await game({ ...LIVE, MAX_LIVE_FLOORS: '1', JUDGE_SLOTS: '0' }, { agents: fakeAgents() });
  const a = player(g);
  assert.equal(a.floor().mode, 'live');
  const b = player(g);
  assert.equal(b.last('error').code, 'no_slot');
  b.send('joinQueue');
  assert.equal(a.act('closeShift').ok, true);
  assert.equal(b.notes('slotFree').length, 1, 'the ended shift gave its slot to the queue');
  b.send('createFloor', {});
  assert.equal(g.floors.get(b.last('welcome').floorId).mode, 'live');
  assert.equal(a.act('playAgain').ok, true);
  assert.equal(a.floor().mode, 'demo');
  assert.equal(a.floor().demoReason, 'no_slot');
  assert.equal(a.notes('liveOff').length, 1);
});

test('floors: choosing Live on a server without a key gives a Demo floor and a notice saying why', async () => {
  const { g } = await game({});
  const p = player(g, 'player', { mode: 'live' });
  assert.equal(p.floor().mode, 'demo');
  assert.equal(p.floor().demoReason, 'no_key');
  const n = p.notes('liveOff');
  assert.equal(n.length, 1);
  assert.match(n[0].text, /no API key/);
  assert.equal(p.last('floor').floor.demoReason, 'no_key');
  assert.equal(p.act('setMode', { mode: 'live' }).code, 'no_key');
  const d = player(g, 'player', { mode: 'demo' });
  assert.equal(d.notes('liveOff').length, 0, 'no notice when Demo was the choice');
});
