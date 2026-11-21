// End to end with simulated chefs and scripted customers, straight against the Restaurant: no browser, no network, no cost.
// Proves the waiter's loop on real worktrees, test runs and merges, the red-lamp redo, the break and bell,
// and that all five demo orders bill into main cleanly in two different orders.
process.env.SHIP_SIM_SPEED = process.env.SHIP_SIM_SPEED || '25';
const assert = (await import('node:assert/strict')).default;
const fs = await import('node:fs/promises');
const os = await import('node:os');
const path = await import('node:path');
const { Restaurant, DEMO_TIMINGS } = await import('../server/restaurant.mjs');
const { simDriver } = await import('../server/agents.mjs');
const { ensureProjectRepo, CUSTOMERS } = await import('../server/projects/roster-cafe.mjs');
const G = await import('../server/git.mjs');

const sleep = ms => new Promise(r => setTimeout(r, ms));
const FAST = { ...DEMO_TIMINGS, walkMs: 30, eatMs: 30, cooldownMs: 8000, graceMs: 100, penaltyEveryMs: 100000, patienceMs: { line: 600000, seated: 600000 } };
const until = async (what, fn, ms = 30000) => { const t = Date.now(); while (!(await fn())) { if (Date.now() - t > ms) throw new Error(`Timed out waiting for ${what}`); await sleep(40); } };

async function open(tables) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ship-shift-smoke-'));
  const repo = path.join(dir, 'repo');
  await ensureProjectRepo(repo);
  const r = new Restaurant({ repo, dataDir: path.join(dir, 'data'), chefs: [{ id: 'a', name: 'A', model: 'x', driver: simDriver }, { id: 'b', name: 'B', model: 'x', driver: simDriver }], customers: CUSTOMERS, tables, timings: FAST });
  await r.init();
  return { r, dir, repo };
}
const byKey = (r, key) => r.customers.find(c => c.key === key);
const itemsOf = (r, c) => r.items.filter(i => i.customerId === c.id);
const send = (r, c, ids) => r.addItems(c.id, c.presets.filter(p => !ids || ids.includes(p.id)).map(p => ({ station: p.station, prompt: p.prompt, presetId: p.id })));
async function serveAll(r, c) {
  for (;;) {
    await until(`${c.key} dishes`, () => itemsOf(r, c).every(i => ['plated', 'served', 'binned'].includes(i.state)), 60000);
    const plated = itemsOf(r, c).filter(i => i.state === 'plated');
    if (!plated.length) return;
    for (const it of plated) {
      if (it.tests && !it.tests.ok) { r.redo(it.id, { comment: 'Missed an edge case: tests fail' }); continue; }
      const res = await r.serve(it.id, { seen: true });
      assert.ok(res.served, `${c.key} item ${it.n} should serve cleanly`);
    }
  }
}
async function finish(r, c) {
  await until(`${c.key} feedback`, () => byKey(r, c.key).state === 'feedback_ready', 30000);
  const res = await r.bill(c.id);
  assert.ok(res.paid, `${c.key} should pay without a conflict`);
  return res.bill;
}

/* ---------- 1. the loop: seat, items, cook, red lamp, redo, serve, feedback, more items, bill ---------- */
{
  const { r, repo } = await open(2);
  r.startShift({ lengthMin: 10 });
  const mia = byKey(r, 'CAFE-101'), raj = byKey(r, 'CAFE-102');
  await r.seat(mia.id); await r.seat(raj.id);
  await assert.rejects(r.seat(byKey(r, 'CAFE-103').id), /No free table/);
  // two different stations, so both chefs cook at once (one chef per station)
  send(r, mia); send(r, raj, ['102-frontend']);
  // both chefs busy: the break is allowed
  await until('both chefs cooking', () => r.chefs.every(c => c.state === 'cooking'));
  assert.equal(r.breakEligible(), true);
  r.startBreak();
  // a dish lands during the cooldown: no bell until the cooldown ends
  const t0 = Date.now(); await until('a plated dish', () => r.counter().length > 0); console.log('  first dish plated after', Date.now() - t0, 'ms');
  assert.equal(r.shift.phase, 'break');
  await until('the bell', () => r.shift.phase === 'bell', 15000);
  r.endBreak();
  assert.equal(r.stats.breaks, 1);
  assert.ok(r.stats.points.some(p => p.why === 'Proper break'), 'a full break earns its bonus');

  await until('Mia plated', () => itemsOf(r, mia)[0].state === 'plated');
  assert.equal(itemsOf(r, mia)[0].tests.ok, true);
  await r.serve(itemsOf(r, mia)[0].id, { seen: true, note: 'Sunday is 1.5x now' });
  const bill = await finish(r, mia);
  assert.equal(bill.items.length, 1);
  assert.match(bill.commit, /^[0-9a-f]{7}$/);
  assert.equal(byKey(r, 'CAFE-101').reviews.at(-1).verdict, 'satisfied');

  // Raj's page fix alone is not enough for him
  await serveAll(r, raj);
  await until('Raj feedback', () => byKey(r, 'CAFE-102').state === 'feedback_ready');
  assert.equal(byKey(r, 'CAFE-102').lastVerdict, 'needs_more', 'Raj still has negative hours');
  assert.equal(byKey(r, 'CAFE-102').suggestions[0].station, 'backend');
  send(r, raj, ['102-backend']);
  // Raj's first backend attempt burns: the oven lamp is red, so the waiter sends it back
  const rb = itemsOf(r, raj).find(i => i.presetId === '102-backend');
  await until('Raj plated', () => rb.state === 'plated');
  assert.equal(rb.tests.ok, false, 'the first overnight attempt fails its tests');
  r.redo(rb.id, { comment: '16:00 to 00:30 is still negative' });
  await until('Raj re-plated', () => rb.state === 'plated');
  assert.equal(rb.tests.ok, true, 'the redo passes');
  await r.serve(rb.id, { seen: true });
  const b2 = await finish(r, raj);
  assert.equal(b2.verdict, 'satisfied');
  assert.equal(r.stats.bills, 2);
  assert.equal(r.stats.redos, 1);
  assert.ok(r.stats.score > 0);
  // main really has both bills and passes its tests
  const log = await G.git(repo, ['log', '--oneline', 'main']);
  assert.match(log, /Bill CAFE-101/); assert.match(log, /Bill CAFE-102/);
  assert.equal((await G.runTests(repo, 'npm test')).ok, true, 'main passes its tests after two bills');
  // a blind serve costs points and resets the streak
  const sol = byKey(r, 'CAFE-103');
  await r.seat(sol.id); send(r, sol, ['103-backend']);
  await until('Sol plated', () => itemsOf(r, sol)[0].state === 'plated');
  await r.serve(itemsOf(r, sol)[0].id, { seen: false });
  assert.equal(r.stats.blindServes, 1);
  assert.equal(r.stats.streak, 1);
  await r.close();
  console.log('ok 1  the waiter loop: seat, cook, break and bell, red lamp, redo, serve, feedback, more items, bill, blind serve');
}

/* ---------- 2. every demo order bills into main cleanly, in two different orders ---------- */
for (const order of [['CAFE-101', 'CAFE-102', 'CAFE-103', 'CAFE-104', 'CAFE-105'], ['CAFE-105', 'CAFE-104', 'CAFE-103', 'CAFE-102', 'CAFE-101']]) {
  const { r, repo } = await open(4);
  r.startShift({ lengthMin: 10 });
  // seat four at once so their table branches all start from the same main, then the fifth after the first bill
  const first = order.slice(0, 4).map(k => byKey(r, k));
  for (const c of first) { await r.seat(c.id); send(r, c); }
  for (const c of first) { await serveAll(r, c); }
  for (const c of first) { const b = await finish(r, c); assert.equal(b.verdict, 'satisfied', `${c.key} is satisfied with every special`); }
  const last = byKey(r, order[4]);
  await r.seat(last.id); send(r, last); await serveAll(r, last); await finish(r, last);
  assert.equal(r.stats.bills, 5);
  assert.equal((await G.runTests(repo, 'npm test')).ok, true, 'main passes every test after all five bills');
  await r.close();
  console.log(`ok 2  all five orders bill cleanly: ${order.join(' ')}`);
}

/* ---------- 3. forced break, walkouts and the shift report ---------- */
{
  const { r } = await open(2);
  r.t.patienceMs.line = 300; r.t.rejoinMs = 200;
  r.startShift({ lengthMin: 10, maxWorkMin: 0.5 });
  r.shift.maxWorkMs = 300; r.shift.cooldownMs = 300;
  await until('a forced break', () => r.shift.phase === 'break' && r.shift.forced, 3000);
  assert.throws(() => r.endBreak(), /Forced break/);
  assert.equal(r.stats.forcedBreaks, 1);
  await until('cooldown over', () => Date.now() >= r.shift.cooldownEndsAt + 50, 3000);
  r.shift.maxWorkMs = 600000;
  if (r.shift.phase !== 'service') r.endBreak();
  await until('a walkout', () => r.stats.walkouts > 0, 3000);
  await until('the walkout rejoins', () => r.customers.every(c => c.state === 'in_line'), 3000);
  r.stopShift();
  assert.equal(r.shift.phase, 'closed');
  assert.ok(r.shift.report.stars >= 1 && r.shift.report.advice);
  await r.close();
  console.log('ok 3  forced break, a walkout and its return, and the shift report');
}
process.exit(0);
