// End-to-end check with simulated chefs: real git worktrees, real tests, real merges and conflicts, no API spend.
import { spawn, exec } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { ensureDemoRepo, STARTER_ORDERS, DEMO_ARRIVALS_S } from '../server/demo-repo.mjs';
import { recipeFor } from '../server/sim-scripts.mjs';
import { git } from '../server/git.mjs';
import { grantClassFor, simDriver } from '../server/agents.mjs';
import { Kitchen } from '../server/kitchen.mjs';

const pexec = promisify(exec);
const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'ship-shift-'));
const repo = path.join(tmp, 'repo');
await ensureDemoRepo(repo);
// Free ports, so this can run next to another kitchen or another test.
const freePort = () => new Promise((resolve, reject) => {
  const probe = net.createServer().once('error', reject).listen(0, '127.0.0.1', () => { const { port } = probe.address(); probe.close(() => (port > 10080 ? resolve(port) : freePort().then(resolve, reject))); }); // fetch refuses some low ports
});
const PORT = await freePort(), DEMO_PORT = await freePort(), PACE = 20;
const servers = [];
let log = '';

function start(args, env) {
  const child = spawn(process.execPath, ['server/index.mjs', ...args], {
    env: { ...process.env, SHIP_SIM_ASK: '', SHIP_REAL_CHEFS: '', SHIP_CHEF_MODELS: '', SHIP_SIM_SPEED: '10', ...env },
    stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true,
  });
  child.stdout.on('data', d => { log += d; }); child.stderr.on('data', d => { log += d; });
  servers.push(child);
}

const sleep = ms => new Promise(r => setTimeout(r, ms));
let passed = 0;
const ok = (cond, msg) => { if (!cond) throw new Error('FAILED: ' + msg); passed++; console.log('  ok', msg); };

/** A small client for one kitchen. It remembers every question it sees, so a check can say what was never asked. */
function client(port) {
  const base = `http://127.0.0.1:${port}`;
  const asked = [];
  const c = {
    base, asked,
    raw: (p, b = {}) => fetch(base + p, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) }),
    post: async (p, b = {}) => { const r = await c.raw(p, b); const j = await r.json(); if (!r.ok) throw new Error(`${p}: ${j.error}`); return j; },
    get: async p => (await fetch(base + p)).json(),
    state: async () => {
      const s = await c.get('/api/state');
      for (const q of s.questions) if (!asked.some(a => a.id === q.id)) asked.push(q);
      return s;
    },
    up: async () => { for (let i = 0; i < 60; i++) { try { return await c.state(); } catch { await sleep(200); } } throw new Error(`No kitchen on ${port}`); },
    answerAll: async (s, skip = () => false) => {
      for (const q of s.questions) {
        if (skip(q)) continue;
        if (q.kind === 'question') await c.post(`/api/questions/${q.id}/answer`, { allow: true, answers: Object.fromEntries(q.questions.map(x => [x.question, x.options[0].label])) });
        else await c.post(`/api/questions/${q.id}/answer`, { allow: false, message: 'No new dependencies' });
      }
    },
    /** Polls, answering every chef question, until the snapshot satisfies `done`; returns what `done` returned. */
    wait: async (done, what, ms = 30000) => {
      const end = Date.now() + ms;
      while (Date.now() < end) {
        const s = await c.state();
        const hit = done(s);
        if (hit) return hit;
        await c.answerAll(s);
        await sleep(100);
      }
      throw new Error(`Timed out waiting for ${what}`);
    },
    until: (id, states, ms) => c.wait(s => { const o = s.orders.find(x => x.id === id); return o && states.includes(o.state) ? o : null; }, `#${id} to be ${states}`, ms),
  };
  return c;
}

try {
  console.log('Ship Shift smoke test');

  /* ---------- what a chef may do alone, and what a spice jar covers ---------- */
  const cls = command => grantClassFor('Bash', { command });
  ok(cls('npm install csv-stringify') === 'install' && cls('curl https://example.com/x.json') === 'network' && cls('rm -rf dist') === 'delete', 'grant classes: install, network and delete are recognised');
  ok(cls('rm -rf /') === null && cls('rm -rf ../other') === null && cls('npm install x && git push') === null && cls('npm test') === null, 'grant classes never cover absolute deletes, paths outside the worktree, or a push');

  /* ---------- questions, "always", and the shift report, on a kitchen with no server ---------- */
  {
    const k = new Kitchen({ repo, dataDir: path.join(tmp, 'unit'), driver: simDriver, testCmd: 'npm test', chefs: [{ id: 'pixel', name: 'Pixel' }], pace: PACE });
    await fs.mkdir(k.dataDir, { recursive: true });
    const o = k.addOrder({ title: 'Unit', size: 'S' });
    const install = { kind: 'permission', toolName: 'Bash', input: { command: 'npm install left-pad' }, reason: 'runs npm install left-pad' };
    const first = k.ask(o, k.chefs[0], install);
    const q = k.snapshot().questions[0];
    ok(q && q.grantClass === 'install', 'a permission request carries its grant class');
    k.answer(q.id, { allow: true, always: true });
    ok((await first).allow === true && k.snapshot().grants.includes('install'), 'answering with always adds a shift grant');
    const second = await k.ask(o, k.chefs[0], install);
    ok(second.allow === true && k.questions.length === 0, 'the shift grant answers the next install without a question');
    k.startShift({ focusMin: 1 });
    k.shift.endsAt = Date.now() - 1;
    k.tick();
    const r = k.snapshot().shift.report;
    ok(r && [1, 2, 3].includes(r.stars) && typeof r.advice === 'string' && r.advice.length > 10, `the shift report has stars and advice (${r?.stars}: ${r?.advice})`);
    ok(k.snapshot().grants.length === 0, 'the shift grant ends with the shift');
    await sleep(400); // let its last save land before the next kitchen uses the directory tree
  }

  /* ---------- the main kitchen ---------- */
  start([], { SHIP_SIM: '1', SHIP_PACE: String(PACE), SHIP_REPO: repo, SHIP_DATA: path.join(tmp, 'data'), PORT: String(PORT) });
  const c = client(PORT);
  let s = await c.up();
  ok(s.chefs.map(x => x.id).join() === 'pixel,router,query,stack' && s.chefs[3].name === 'Stack', 'four chefs, the fourth is Stack');
  ok(s.pace === PACE && s.escalation.smokeMs === 20000 / PACE && s.escalation.fireMs === 60000 / PACE && Array.isArray(s.grants) && s.rules.autoRefire === false && Array.isArray(s.overlaps), 'snapshot has pace, escalation, grants, rules and overlaps');
  ok(['blindShips', 'steers', 'refires', 'blockedPenalty'].every(key => s.stats[key] === 0) && s.stats.streak === 1, 'stats start with the new counters at zero and a streak of 1');
  const addon = await fetch(`${c.base}/vendor/addons/effects/OutlineEffect.js`);
  ok(addon.ok && addon.headers.get('content-type').includes('javascript') && (await addon.text()).includes('OutlineEffect'), '/vendor/addons/ serves the three.js addons');

  /* ---------- renaming a chef ---------- */
  const renamed = await c.post('/api/chefs/stack', { name: '  Basil  ' });
  s = await c.state();
  ok(renamed.chef.id === 'stack' && renamed.chef.name === 'Basil' && s.chefs[3].name === 'Basil' && s.chefs[3].id === 'stack', 'a chef is renamed, trimmed, and keeps its id');
  const refusals = [];
  for (const [id, name] of [['stack', ''], ['stack', '   '], ['stack', 'x'.repeat(15)], ['stack', 'sh1t chef'], ['stack', 'pixel'], ['nobody', 'Sage'], ['stack', 42]]) { const r = await c.raw(`/api/chefs/${id}`, { name }); refusals.push(`${r.status} ${(await r.json()).code}`); }
  ok(refusals.join() === '400 name,400 name,400 name,400 name,409 taken,404 gone,400 name' && (await c.state()).chefs.map(x => x.name).join() === 'Pixel,Router,Query,Basil', `an empty, long, rude or duplicate name and an unknown chef are refused with a code (${refusals.join(', ')})`);
  ok((await c.post('/api/chefs/stack', { name: 'Basil' })).chef.name === 'Basil' && (await c.post('/api/chefs/stack', { name: 'Stack' })).chef.name === 'Stack', 'renaming to the same name is fine, and a chef can be named back');
  {
    // The name is saved with the kitchen and comes back after a restart; a cooking chef's order hears about it.
    const dataDir = path.join(tmp, 'rename-data');
    const mk = () => new Kitchen({ repo, dataDir, driver: simDriver, testCmd: 'npm test', mainBranch: 'main', chefs: ['pixel', 'router'].map(id => ({ id, name: id[0].toUpperCase() + id.slice(1) })) });
    const k1 = mk(); await k1.init();
    const o1 = k1.addOrder({ title: 'Rename while cooking', size: 'S' });
    k1.chefs[0].orderId = o1.id; o1.chefId = 'pixel';
    k1.renameChef('pixel', 'Saffron');
    ok(o1.activity.some(x => x.text === 'Pixel is now Saffron') && k1.snapshot().chefs[0].name === 'Saffron', 'a rename is written to the order the chef is cooking: "Pixel is now Saffron"');
    k1.chefs[0].orderId = null; o1.chefId = null;
    await k1.save(); await k1.close();
    const k2 = mk(); await k2.init();
    ok(k2.chefs[0].name === 'Saffron' && k2.chefs[1].name === 'Router', 'the name is saved with the kitchen state and restored when the kitchen reopens');
    await k2.close();
  }

  /* ---------- ranks: hiring, promoting, letting go ---------- */
  s = await c.state();
  ok(s.ranks.map(r => r.id).join() === 'head,sous,line,commis' && s.ranks.map(r => r.model).join() === 'claude-fable-5-2,claude-opus-5-5,claude-sonnet-5-5,claude-haiku-5-5' && s.ranks.every((r, i) => r.label && (i === 0 || r.wage < s.ranks[i - 1].wage)), `the snapshot lists four ranks with their models, dearest first (${s.ranks.map(r => `${r.label} $${r.wage}`).join(', ')})`);
  ok(s.chefs.length === 4 && s.chefs.every(ch => ch.rank === 'sous' && ch.model === 'claude-opus-5-5' && ch.wage === 0.2 && ch.hired === false) && s.hiring.max === 6 && s.hiring.cost === 0, 'a kitchen starts with four Sous Chefs, and hiring is free on your own machine');
  const hired = await c.post('/api/chefs', { rank: 'commis', name: ' Dill ' });
  const staffNo = [];
  for (const [p, b] of [['/api/chefs', { rank: 'intern' }], ['/api/chefs', { rank: 'line', name: 'dill' }], ['/api/chefs', { rank: 'line', name: 'sh1t' }], [`/api/chefs/${hired.chef.id}/rank`, { rank: 'boss' }], ['/api/chefs/nobody/rank', { rank: 'head' }], ['/api/chefs/nobody/dismiss', {}]]) { const r = await c.raw(p, b); staffNo.push(`${r.status} ${(await r.json()).code}`); }
  const auto = await c.post('/api/chefs', {});
  const over = await c.raw('/api/chefs', { rank: 'head' });
  s = await c.state();
  ok(hired.chef.name === 'Dill' && hired.chef.rank === 'commis' && s.chefs[4].model === 'claude-haiku-5-5' && s.chefs[4].wage === 0.005 && s.chefs[4].hired && s.chefs[4].driver === 'sim' && auto.chef.rank === 'sous' && auto.chef.name === 'Cache', 'hire: a Commis by name, and a Sous Chef with a name from the list when none is given');
  ok(staffNo.join() === '400 rank,409 taken,400 name,400 rank,404 gone,404 gone', `an unknown rank, a taken or rude name and an unknown chef are refused (${staffNo.join(', ')})`);
  ok(over.status === 409 && (await over.json()).code === 'full' && s.chefs.length === 6 && s.stats.score === 0 && s.stats.hires === 2, 'the cap: a seventh chef is refused');
  const promoted = await c.post(`/api/chefs/${hired.chef.id}/rank`, { rank: 'head' });
  s = await c.state();
  ok(promoted.chef.rank === 'head' && s.chefs[4].rank === 'head' && s.chefs[4].model === 'claude-fable-5-2' && s.chefs[4].wage === 0.4 && s.chefs[4].name === 'Dill', 'rank: a Commis is promoted to Head Chef and takes that rank\'s model and wage');
  const gone = await fetch(`${c.base}/api/chefs/${auto.chef.id}`, { method: 'DELETE' });
  await c.post(`/api/chefs/${hired.chef.id}/dismiss`);
  s = await c.state();
  ok(gone.ok && s.chefs.map(x => x.id).join() === 'pixel,router,query,stack', 'dismiss: an idle chef is let go, by DELETE or by POST …/dismiss');
  {
    const dataDir = path.join(tmp, 'staff-data');
    const mk = chefs => new Kitchen({ repo, dataDir, driver: simDriver, testCmd: 'npm test', mainBranch: 'main', model: 'claude-opus-5-5', hireCost: 50, chefs });
    const k1 = mk([{ id: 'pixel', name: 'Pixel' }, { id: 'router', name: 'Router', model: 'claude-haiku-5-5' }]); await k1.init();
    const err = fn => { try { fn(); return 'ok'; } catch (e) { return e.code; } };
    ok(k1.chefs[1].rank === 'commis' && k1.rankChef('router', 'head').rank === 'head' && k1.chefs[1].model === 'claude-haiku-5-5', 'a model set for one chef (SHIP_CHEF_MODELS) stays theirs whatever rank they are given');
    const h = k1.hireChef({ rank: 'line' });
    ok(k1.stats.score === -50 && k1.stats.points.at(-1).why === 'Hired Cache, Line Cook' && k1.snapshot().hiring.cost === 50, 'where hiring has a price, it is paid in score');
    const o1 = k1.addOrder({ title: 'Busy chef', size: 'S' });
    k1.chefs[0].orderId = o1.id;
    ok(err(() => k1.dismissChef('pixel')) === 'busy', 'dismiss: a chef with an order on is refused');
    k1.chefs[0].orderId = null;
    k1.dismissChef('pixel'); k1.dismissChef('router');
    ok(err(() => k1.dismissChef(h.id)) === 'last' && k1.chefs.length === 1, 'dismiss: the last chef stays');
    k1.hireChef({ rank: 'commis', name: 'Mint' });
    await k1.save(); await k1.close();
    const k2 = mk([{ id: 'pixel', name: 'Pixel' }, { id: 'router', name: 'Router' }]); await k2.init();
    ok(k2.chefs.map(x => `${x.name}:${x.rank}:${x.model}`).join() === 'Cache:line:claude-sonnet-5-5,Mint:commis:claude-haiku-5-5' && k2.hireChef({}).id !== h.id, 'the roster, with its hires and ranks, is saved with the kitchen and comes back');
    await k2.close();
  }

  /* ---------- ranks: how simulated chefs differ ---------- */
  {
    const keep = { speed: process.env.SHIP_SIM_SPEED, ask: process.env.SHIP_SIM_ASK, slip: process.env.SHIP_SIM_SLIP };
    const rRepo = path.join(tmp, 'rank-repo');
    await ensureDemoRepo(rRepo);
    // Speed and questions, straight from the driver: the same small order, eight times per rank.
    process.env.SHIP_SIM_SPEED = '40'; process.env.SHIP_SIM_ASK = '1'; process.env.SHIP_SIM_SLIP = '0';
    const trial = async rank => {
      let asked = 0; const t0 = Date.now();
      for (let i = 0; i < 8; i++) {
        const cwd = path.join(tmp, 'rank-trials', `${rank}${i}`);
        await fs.mkdir(path.join(cwd, 'src'), { recursive: true });
        await simDriver.run({ cwd, prompt: `Order #1 (S): Tidy trial ${i}`, rank, onEvent: () => {}, order: { id: 1, title: `Tidy trial ${i}` }, askHuman: async q => { asked++; return q.kind === 'question' ? { allow: true, answers: { a: q.questions[0].options[0].label } } : { allow: false }; } });
      }
      return { asked, ms: Date.now() - t0 };
    };
    const head = await trial('head'), commis = await trial('commis');
    ok(head.ms > commis.ms * 1.6 && commis.asked > head.asked, `a Head Chef is slower and asks less; a Commis is fast and asks more (${head.ms} ms and ${head.asked} questions against ${commis.ms} ms and ${commis.asked})`);

    // First attempts, through a kitchen: real worktrees and real test runs.
    process.env.SHIP_SIM_SPEED = '10'; process.env.SHIP_SIM_ASK = ''; process.env.SHIP_SIM_SLIP = '1';
    const k = new Kitchen({ repo: rRepo, dataDir: path.join(tmp, 'rank-data'), driver: simDriver, testCmd: 'npm test', mainBranch: 'main', pace: 80, chefs: [{ id: 'h', name: 'Hattie', rank: 'head' }, { id: 's', name: 'Sol', rank: 'sous' }, { id: 'c', name: 'Cam', rank: 'commis' }] });
    await k.init();
    try {
      const settle = async (o, what) => {
        const end = Date.now() + 40000;
        while (Date.now() < end && !(o.state === 'at_pass' && o.merge)) { for (const q of [...k.questions]) k.answer(q.id, q.kind === 'question' ? { allow: true, answers: Object.fromEntries(q.questions.map(x => [x.question, x.options[0].label])) } : { allow: false, message: 'No' }); await sleep(80); }
        if (o.state !== 'at_pass' || !o.merge) throw new Error(`Timed out waiting for ${what}: ${o.state} ${o.error || ''}`);
        // A merge check that started before this arrival can still be finishing, so the pass is read once more before it is judged.
        await k.refreshPass();
      };
      const ot = k.addOrder(STARTER_ORDERS.find(x => x.title === 'Overtime after 8 hours'));
      const sun = k.addOrder(STARTER_ORDERS.find(x => x.title === 'Sunday penalty rate'));
      const close = k.addOrder(STARTER_ORDERS.find(x => x.title === 'Close shift shows negative hours'));
      await k.assign(ot.id, 'h'); await k.assign(sun.id, 's'); await k.assign(close.id, 'c');
      await settle(ot, 'the Head Chef\'s Overtime'); await settle(sun, 'the Sous Chef\'s Sunday'); await settle(close, 'the Commis\'s Close shift');
      ok(ot.tests.ok && ot.refires === 0 && ot.rounds === 0 && ot.model === 'claude-fable-5-2', 'a Head Chef gets Overtime right first time: the scripted failure is for every rank below');
      ok(sun.tests.ok && !sun.files.includes('test/slip.test.js'), 'a Sous Chef leaves no slip, even when slips are certain');
      ok(!close.tests.ok && close.files.includes('test/slip.test.js') && /half-finished/.test(close.tests.output), 'a Commis\'s first attempt can leave a failing test behind: the plate arrives burnt');
      await k.review(close.id, { verdict: 'send_back', comment: 'The new test fails.' });
      await settle(close, 'the Commis\'s second attempt');
      ok(close.tests.ok && !close.files.includes('test/slip.test.js') && close.rounds === 1, 'sent back, the Commis finishes it and the tests pass');
      const by = k.stats.spendByRank;
      ok(by.head > 0 && by.sous > 0 && by.commis > 0 && by.head > by.commis * 10 && by.line === 0 && k.stats.apiUsd === 0 && Math.abs(k.stats.costUsd - (by.head + by.sous + by.commis)) < 1e-9 && Math.abs(ot.costUsd - by.head) < 1e-9, `wages accrue while cooking, by rank, on the spend meter; no real money is spent (head $${by.head.toFixed(2)}, sous $${by.sous.toFixed(2)}, commis $${by.commis.toFixed(3)})`);
      const idle = k.stats.costUsd;
      await sleep(900);
      ok(k.stats.costUsd === idle, 'nobody is paid while their plate sits at the pass');
      k.startShift({ focusMin: 1 });
      // A demotion counts for the next run; the session under way keeps its model.
      k.rankChef('h', 'commis');
      await k.review(ot.id, { verdict: 'send_back', comment: 'Add a comment.' });
      await settle(ot, 'the demoted chef\'s second round');
      ok(k.chefs[0].model === 'claude-haiku-5-5' && ot.model === 'claude-fable-5-2' && ot.activity.some(x => /is now a Commis/.test(x.text)) && k.stats.spendByRank.commis > by.commis - 1e-12, 'a demotion is logged on the order; the resumed session keeps its model and the wage follows the new rank');
      k.shift.endsAt = Date.now() - 1; k.tick();
      const rep = k.shift.report;
      ok(rep && rep.spendByRank.head === 0 && rep.spendByRank.commis > 0 && rep.apiUsd === 0 && Math.abs(rep.costUsd - Object.values(rep.spendByRank).reduce((x, y) => x + y, 0)) < 1e-9, 'the shift report shows the shift\'s spend by rank');
    } finally {
      await k.close();
      for (const [key, name] of [['speed', 'SHIP_SIM_SPEED'], ['ask', 'SHIP_SIM_ASK'], ['slip', 'SHIP_SIM_SLIP']]) { if (keep[key] === undefined) delete process.env[name]; else process.env[name] = keep[key]; }
    }
  }

  const a = await c.post('/api/orders', { title: 'Tidy the kitchen notes', body: 'Any small change', size: 'M' });
  ok(a.id === 1 && a.state === 'waiting' && a.approved === false && a.refires === 0 && a.grants.length === 0, 'order goes on the rail');

  await c.post(`/api/orders/${a.id}/plan`);
  let o = await c.wait(st => { const x = st.orders.find(y => y.id === a.id); return x.state === 'waiting' && x.plan ? x : null; }, 'the plan', 10000);
  ok(o.plan.includes('Plan'), 'plan board writes a plan');

  await c.post(`/api/orders/${a.id}/assign`, { chefId: 'pixel' });
  s = await c.state();
  ok(s.chefs.find(x => x.id === 'pixel').orderId === a.id && s.orders[0].stage === 'cooking', 'chef takes the ticket and the order is at the cooking stage');
  await fs.stat(path.join(tmp, 'data', 'worktrees')).then(() => ok(true, 'worktree created'));

  o = await c.until(a.id, ['at_pass']);
  ok(o.tests && o.tests.ok, 'tests ran in the worktree and pass');
  ok(o.diff.stat.files >= 1, 'diff against main shows the change');
  ok((await c.get(`/api/orders/${a.id}/diff`)).patch.includes('kitchen-notes'), 'diff endpoint returns the patch');
  o = await c.wait(st => { const x = st.orders[0]; return x.merge ? x : null; }, 'the merge check');
  ok(o.stage === 'pass' && o.files.includes('src/kitchen-notes.js') && o.touched.includes('src/kitchen-notes.js') && o.merge.clean === true && o.merge.conflicts.length === 0, 'a plate at the pass carries its files, the files it touched, and a clean merge check');
  ok(o.activity.some(x => x.kind === 'tool' && x.file === 'src/kitchen-notes.js'), 'tool events carry the file');

  await c.post(`/api/orders/${a.id}/review`, { verdict: 'send_back', comment: 'Add a 12 hour test' });
  o = await c.until(a.id, ['at_pass']);
  ok(o.rounds === 1 && o.feedback.length === 1, 'send back resumes the chef and returns to the pass');

  ok((await c.raw(`/api/orders/${a.id}/ship`, { seen: true })).status === 400, 'ship refuses a plate that is not approved');
  await c.post(`/api/orders/${a.id}/review`, { verdict: 'approve' });
  await sleep(600);
  o = (await c.state()).orders[0];
  ok(o.state === 'at_pass' && o.approved === true && !/Ship #1/.test(await git(repo, ['log', '--oneline', '-3', 'main'])), 'approve marks the plate and merges nothing');
  const shipA = await c.post(`/api/orders/${a.id}/ship`, { seen: true });
  ok(shipA.shipped === true && /Ship #1/.test(await git(repo, ['log', '--oneline', '-3', 'main'])), 'ship merges the branch into main');
  s = await c.state();
  ok(s.stats.shipped === 1 && s.stats.sentBack === 1 && s.stats.firstTime === 0 && s.chefs.find(x => x.id === 'pixel').orderId === null, 'stats count it and the chef is free');

  const b = await c.post('/api/orders', { title: 'Throwaway', size: 'S' });
  await c.post(`/api/orders/${b.id}/assign`, { chefId: 'router' });
  await sleep(200);
  await c.post(`/api/orders/${b.id}/bin`);
  s = await c.state();
  ok(s.orders.find(x => x.id === b.id).state === 'binned' && !s.chefs.find(x => x.id === 'router').orderId, 'bin stops the chef and frees the station');
  ok(!(await git(repo, ['branch', '--list', 'kitchen/*'])).includes(`kitchen/${b.id}-`), 'bin removes the branch');

  /* ---------- the roster-cafe menu, cooked by recipe ---------- */
  ok(STARTER_ORDERS.length === 7 && STARTER_ORDERS.map(x => x.size).join('') === 'SMSLMMS' && STARTER_ORDERS.every(x => recipeFor(x.title)), 'the menu has seven orders in three sizes, and every one has a recipe');
  const menu = [];
  for (const x of STARTER_ORDERS) menu.push(await c.post('/api/orders', x));
  const [close, ot, sun, ts, hol, cost, dbl] = menu;
  const byId = (st, x) => st.orders.find(y => y.id === x.id);

  // A spice jar on the ticket before it is handed over.
  await c.post('/api/grants', { cls: 'install', orderId: ts.id });
  ok(byId(await c.state(), ts).grants.join() === 'install', 'a grant sticks to the ticket');

  await c.post(`/api/orders/${ot.id}/assign`, { chefId: 'pixel' });
  await c.post(`/api/orders/${ts.id}/assign`, { chefId: 'router' });
  await c.post(`/api/orders/${close.id}/assign`, { chefId: 'query' });
  await c.post(`/api/orders/${dbl.id}/assign`, { chefId: 'stack' });

  // Call out to Stack straight away: the run is interrupted and the same session carries on with the note.
  await c.post(`/api/orders/${dbl.id}/steer`, { note: 'use round2' });
  s = await c.state();
  ok(byId(s, dbl).state === 'cooking' && s.stats.steers === 1 && byId(s, dbl).activity.some(x => x.text === 'You called out: use round2'), 'steer keeps the chef cooking and logs the note');

  // Leave the Overtime chef's question unanswered until it has cost something.
  const otAsk = q => q.orderId === ot.id && q.kind === 'question';
  let seenOtQuestion = null;
  const end = Date.now() + 15000;
  while (Date.now() < end) {
    s = await c.state();
    seenOtQuestion = s.questions.find(otAsk) || seenOtQuestion;
    if (seenOtQuestion && s.stats.blockedPenalty >= 1) break;
    await c.answerAll(s, otAsk);
    await sleep(100);
  }
  ok(seenOtQuestion && /replace the loading or stack on top of it/.test(seenOtQuestion.questions[0].question) && seenOtQuestion.questions[0].options.length === 2 && seenOtQuestion.grantClass === null, 'the Overtime chef asks a real question: does 1.5x replace the weekend loading or stack on it?');
  ok(s.stats.blockedPenalty >= 1 && s.stats.points.some(x => x.why === 'Chef kept waiting' && x.n < 0 && x.orderId === ot.id), `a chef left waiting past the threshold costs points (${s.stats.blockedPenalty} so far)`);

  o = await c.until(ot.id, ['at_pass']);
  ok(o.tests && o.tests.ok === false && /390/.test(o.tests.output) && /330/.test(o.tests.output), 'Overtime: the first test run really fails (390 where 330 is expected)');
  ok(o.activity.some(x => x.kind === 'text' && /higher rate wins/i.test(x.text)), 'Overtime: the answer (Higher rate wins) decides the rule the chef writes');
  o = await c.until(dbl.id, ['at_pass']);
  ok(o.activity.some(x => x.kind === 'text' && x.text.includes('use round2')) && o.tests.ok, 'the steered chef heard the note and finished Double-booked green');

  o = await c.until(ts.id, ['at_pass']);
  ok(o.activity.some(x => /Pre-approved by your install grant: runs npm install csv-stringify/.test(x.text)) && !c.asked.some(q => q.orderId === ts.id && q.kind === 'permission'), 'the grant pre-approves the Timesheet install: the chef never has to ask');
  ok(o.tests.ok && o.activity.some(x => x.kind === 'tool' && x.file === 'src/timesheet.js'), 'Timesheet arrives green, and its tool events carry the file');
  o = await c.until(close.id, ['at_pass']);
  ok(o.tests.ok && o.rounds === 0, 'Close shift is green first time');
  await c.wait(st => [close, ot, ts, dbl].every(x => byId(st, x).state === 'at_pass' && byId(st, x).merge), 'the first four merge checks');
  s = await c.state();
  ok(byId(s, close).files.join() === 'src/pay.js,test/close-shift.test.js' && byId(s, ts).files.join() === 'src/timesheet.js,test/timesheet.test.js' && byId(s, dbl).files.join() === 'src/roster.js,test/double-booking.test.js' && byId(s, ot).files.join() === 'src/pay.js,test/pay.test.js', 'each plate changes exactly the files its recipe names');
  ok(s.overlaps.some(x => x[0] === close.id && x[1] === ot.id && x[2].includes('src/pay.js') && x[3].length === 0), 'Close shift and Overtime both change src/pay.js without a conflict');

  // Send Overtime back. While the chef is fixing it, the uncommitted fix shows in the work-in-progress diff.
  await c.post(`/api/orders/${ot.id}/review`, { verdict: 'send_back', comment: 'The 10 hour case fails' });
  let tasted = false;
  for (let i = 0; i < 200 && !tasted; i++) {
    const wip = await c.get(`/api/orders/${ot.id}/wip`);
    const cur = byId(await c.state(), ot);
    if (cur.state !== 'cooking') break;
    tasted = wip.patch.includes('(hours - overtime) * staff.rate') && !cur.diff.patch.includes('(hours - overtime) * staff.rate') && wip.stat.files >= 2;
    if (!tasted) await sleep(40);
  }
  ok(tasted, 'wip shows the uncommitted fix while the chef is still cooking');
  o = await c.until(ot.id, ['at_pass']);
  ok(o.tests.ok === true && o.rounds === 1, 'Overtime: fixed on the resume, and the tests pass');
  ok((await c.raw(`/api/orders/${ot.id}/steer`, { note: 'too late' })).status === 400, 'steer is refused when the order is not cooking');

  // A blind ship: approved and shipped without the diff being read.
  await c.post(`/api/orders/${close.id}/review`, { verdict: 'approve' });
  await c.post(`/api/orders/${close.id}/ship`, { seen: false });
  s = await c.state();
  ok(s.stats.blindShips === 1 && s.stats.firstTime === 0 && s.stats.streak === 1 && !s.stats.points.some(x => x.orderId === close.id && x.why === 'Right first time'), 'a blind ship is counted and earns no first-time bonus');

  await c.post(`/api/orders/${dbl.id}/review`, { verdict: 'approve' });
  await c.post(`/api/orders/${dbl.id}/ship`, { seen: true });
  s = await c.state();
  ok(s.stats.firstTime === 1 && s.stats.streak === 1.25, 'a read, right-first-time ship earns the bonus and builds the streak');

  // Two chefs are free. Sunday and Public holiday both rewrite loadingFor(); the holiday chef wants the network first.
  await c.post(`/api/orders/${sun.id}/assign`, { chefId: 'query' });
  await c.post(`/api/orders/${hol.id}/assign`, { chefId: 'stack' });
  await c.until(sun.id, ['at_pass']);
  o = await c.until(hol.id, ['at_pass']);
  const curl = c.asked.find(q => q.orderId === hol.id && q.kind === 'permission');
  ok(curl && curl.grantClass === 'network' && /^curl -s https:\/\//.test(curl.input.command), 'Public holiday asks to make a network call, and the request is in the network grant class');
  ok(o.tests.ok && o.activity.some(x => x.kind === 'text' && /^No network call/.test(x.text)), 'told no, the chef writes the dates in by hand and the plate is green');

  // Both plates merge alone, and git already knows they cannot both go out as they are.
  const pair = await c.wait(st => st.overlaps.find(x => x[0] === sun.id && x[1] === hol.id && x[3]?.length), 'the Sunday/Public holiday overlap');
  s = await c.state();
  ok(pair[2].join() === 'src/pay.js' && pair[3].join() === 'src/pay.js' && byId(s, sun).merge.clean && byId(s, hol).merge.clean, 'the merge check predicts the Sunday/Public holiday conflict in src/pay.js before anything ships');
  ok(byId(s, hol).files.join() === 'src/holidays.js,src/pay.js,test/holidays.test.js' && byId(s, sun).files.join() === 'src/pay.js,test/sunday.test.js', 'Sunday and Public holiday change the files their recipes name');
  ok(s.overlaps.some(x => x[0] === ot.id && x[1] === sun.id && x[2].includes('src/pay.js') && x[3].length === 0), 'Overtime and Sunday overlap in src/pay.js without a conflict');

  await c.post(`/api/orders/${ot.id}/review`, { verdict: 'approve' });
  await c.post(`/api/orders/${ot.id}/ship`, { seen: true });
  await c.post(`/api/orders/${sun.id}/review`, { verdict: 'approve' });
  ok((await c.post(`/api/orders/${sun.id}/ship`, { seen: true })).shipped === true, 'Overtime ships, and Sunday still merges after it');
  o = await c.wait(st => { const x = byId(st, hol); return x.merge && x.merge.clean === false ? x : null; }, 'the Public holiday plate to go cold');
  ok(o.merge.conflicts.join() === 'src/pay.js' && o.behind >= 1 && o.state === 'at_pass', 'once Sunday ships, the Public holiday plate goes cold: its merge check names src/pay.js');

  // Ship it anyway: a real conflict, and the chef really merges main and resolves it.
  await c.post(`/api/orders/${hol.id}/review`, { verdict: 'approve' });
  const spoiled = await c.post(`/api/orders/${hol.id}/ship`, { seen: true });
  s = await c.state();
  ok(spoiled.conflict === true && spoiled.shipped === false && s.stats.conflicts === 1 && byId(s, hol).approved === false, 'shipping both is a real conflict: stats.conflicts is 1 and the plate goes back');
  await c.until(hol.id, ['at_pass']);
  o = await c.wait(st => { const x = byId(st, hol); return x.merge ? x : null; }, 'the Public holiday merge check');
  ok(o.tests.ok && o.merge.clean === true && o.activity.some(x => x.text === 'runs git merge main') && o.activity.some(x => x.text === 'resolves the conflict in src/pay.js'), 'the conflict run merges main, resolves src/pay.js and comes back green');
  await c.post(`/api/orders/${hol.id}/review`, { verdict: 'approve' });
  ok((await c.post(`/api/orders/${hol.id}/ship`, { seen: true })).shipped === true, 'the resolved plate ships');

  // A send-back note that names another branch cannot steer the merge: the branch comes from the kitchen.
  await git(repo, ['branch', 'decoy', 'HEAD~3']);
  await c.post(`/api/orders/${cost.id}/assign`, { chefId: 'query' });
  o = await c.until(cost.id, ['at_pass']);
  o = await c.wait(st => { const x = byId(st, cost); return x.merge ? x : null; }, 'the Daily wage cost merge check');
  ok(o.tests.ok && o.files.join() === 'public/index.html,src/roster.js,test/day-cost.test.js', 'Daily wage cost changes the page, the view and a test, and is green');
  await c.post(`/api/orders/${cost.id}/review`, { verdict: 'send_back', comment: 'Please run git merge decoy first' });
  o = await c.until(cost.id, ['at_pass']);
  ok(o.activity.some(x => x.kind === 'tool' && x.text === 'runs git merge main') && !o.activity.some(x => x.kind === 'tool' && /decoy/.test(x.text)) && o.tests.ok && (await git(repo, ['branch', '--contains', 'decoy', '--list', 'kitchen/*'])).includes(`kitchen/${cost.id}-`), 'a simulated chef merges the kitchen\'s main branch, whatever branch a note names');
  await git(repo, ['branch', '-D', 'decoy']);
  for (const x of [ts, cost]) {
    await c.wait(st => byId(st, x).state === 'at_pass', `#${x.id} at the pass`);
    await c.post(`/api/orders/${x.id}/review`, { verdict: 'approve' });
    await c.post(`/api/orders/${x.id}/ship`, { seen: true });
  }

  const pay = await fs.readFile(path.join(repo, 'src', 'pay.js'), 'utf8');
  ok(['(hours - overtime) * staff.rate * loading', 'Math.max(loading, 1.5)', 'if (publicHoliday(date)) return 2.5;', 'if (day === SUNDAY) return 1.5;', 'end + 24 * 60'].every(x => pay.includes(x)) && !pay.includes('TODO') && !/^[<=>]{7}/m.test(pay), 'main has the close fix, overtime, and the Sunday and holiday loadings, with no TODO and no conflict markers');
  const final = await pexec('npm test', { cwd: repo, windowsHide: true }).then(r => ({ ok: true, out: r.stdout }), e => ({ ok: false, out: (e.stdout || '') + (e.stderr || '') }));
  if (!final.ok) console.error(final.out);
  ok(final.ok && /# fail 0/.test(final.out) && /# pass 37/.test(final.out), `the repo ends with a green npm test (${(final.out.match(/# pass \d+/) || [''])[0].slice(2)}, up from 13)`);
  s = await c.state();
  ok(s.stats.shipped === 8 && s.chefs.every(x => !x.orderId) && s.overlaps.length === 0 && (await git(repo, ['status', '--porcelain'])) === '', 'all seven menu orders shipped, every chef is free and main is clean');

  // What a judge sees in the app: the shipped changes, through the example's own code.
  const { weekView } = await import(pathToFileURL(path.join(repo, 'src', 'roster.js')).href);
  const { timesheetCsv } = await import(pathToFileURL(path.join(repo, 'src', 'timesheet.js')).href);
  const data = JSON.parse(await fs.readFile(path.join(repo, 'data', 'roster.json'), 'utf8'));
  const view = weekView(data);
  const cell = (id, day) => view.rows.find(r => r.id === id).days[day];
  ok(cell('raj', 3)[0].hours === 8.5 && cell('ben', 2)[0].pay === 330 && cell('ben', 6)[0].pay === 270 && cell('mia', 5)[0].pay === 517.5, 'the roster now shows Raj\'s close as 8.5 hours, Ben\'s overtime, Sunday at 1.5x and Boxing Day at 2.5x');
  ok(view.warnings.length === 1 && /^Ava Lindqvist is double-booked on 2026-12-24/.test(view.warnings[0]) && view.days[4].cost === 0 && Math.abs(view.days.reduce((n, d) => n + d.cost, 0) - view.total.pay) < 0.005, 'and it warns about Ava\'s double booking and carries a wage cost for each day');
  const page = await fs.readFile(path.join(repo, 'public', 'index.html'), 'utf8');
  const sheet = timesheetCsv(data).split('\n');
  ok(page.includes("el('tfoot')") && sheet[0] === 'date,name,role,start,end,hours,loading,pay' && sheet[1] === '2026-12-21,Mia Tran,"Supervisor, barista",06:00,14:00,8,1,276.00', 'the page has its wage cost row and the timesheet quotes "Supervisor, barista"');

  await c.post('/api/shift/start', { focusMin: 0.5, breakMin: 0.5 });
  ok((await c.state()).shift.mode === 'focus', 'shift starts in focus');

  /* ---------- the other answers, on a kitchen with no server ---------- */
  {
    const repo2 = path.join(tmp, 'repo2');
    await ensureDemoRepo(repo2);
    const first = await pexec('npm test', { cwd: repo2, windowsHide: true }).then(r => r.stdout, e => e.stdout || '');
    ok(/# pass 13/.test(first) && /# fail 0/.test(first), 'a fresh copy of examples/roster-cafe is green: 13 tests');
    process.env.SHIP_SIM_SPEED = '10'; process.env.SHIP_SIM_ASK = '';
    const k = new Kitchen({ repo: repo2, dataDir: path.join(tmp, 'unit2'), driver: simDriver, testCmd: 'npm test', pace: PACE, chefs: ['pixel', 'router', 'query', 'stack'].map(id => ({ id, name: id })) });
    await k.init();
    k.setRules({ autoRefire: true });
    const seen = [];
    const settle = async (id, ms = 30000) => {
      for (const endAt = Date.now() + ms; Date.now() < endAt; await sleep(50)) {
        for (const q of [...k.questions]) {
          seen.push(q);
          // Stack the rates, and say yes to the network call.
          k.answer(q.id, q.kind === 'question' ? { allow: true, answers: { [q.questions[0].question]: 'Stack them' } } : { allow: true });
        }
        const x = k.order(id);
        if (x.state === 'at_pass' && x.merge) return x;
        if (x.state === 'stalled') throw new Error(`#${id} stalled: ${x.error}`);
      }
      throw new Error(`Timed out waiting for #${id}`);
    };
    const [ot2, hol2, sun2] = ['Overtime after 8 hours', 'Public holiday rate', 'Sunday penalty rate'].map(title => k.addOrder(STARTER_ORDERS.find(x => x.title === title)));
    await k.planOrder(hol2.id);
    ok(/^Plan:/.test(k.order(hol2.id).plan) && /network call/.test(k.order(hol2.id).plan) && k.order(hol2.id).activity.some(x => x.file === 'src/pay.js'), 'the plan board writes the recipe\'s own plan, which says up front that it wants the network');
    await k.assign(ot2.id, 'pixel'); await k.assign(hol2.id, 'router'); await k.assign(sun2.id, 'query');
    let x = await settle(ot2.id);
    const cooked = await fs.readFile(path.join(x.worktree, 'src', 'pay.js'), 'utf8');
    ok(x.tests.ok && x.refires === 1 && x.rounds === 0 && cooked.includes('overtime * staff.rate * loading * 1.5') && (await fs.readFile(path.join(x.worktree, 'test', 'pay.test.js'), 'utf8')).includes('412.5'), 'answered "Stack them", Overtime stacks the rates and tests for $412.50; it fails once and the oven lever re-fires it green');
    x = await settle(hol2.id);
    ok(x.tests.ok && seen.some(q => q.orderId === hol2.id && q.grantClass === 'network') && x.activity.some(a => /^Thanks\. Pay should not depend on a live API/.test(a.text)), 'allowed the network call, Public holiday still checks the dates in');
    await settle(sun2.id);
    // The other way round from the main kitchen: the holiday ships first, so Sunday is the one that resolves.
    for (const id of [ot2.id, hol2.id]) { await k.review(id, { verdict: 'approve' }); await k.ship(id, { seen: true }); }
    await k.review(sun2.id, { verdict: 'approve' });
    ok((await k.ship(sun2.id, { seen: true })).conflict === true, 'shipped in the other order, Sunday is the plate that conflicts');
    x = await settle(sun2.id);
    await k.review(sun2.id, { verdict: 'approve' });
    const done = await k.ship(sun2.id, { seen: true });
    const pay2 = await fs.readFile(path.join(repo2, 'src', 'pay.js'), 'utf8');
    const last = await pexec('npm test', { cwd: repo2, windowsHide: true }).then(r => r.stdout, e => e.stdout || '');
    ok(done.shipped && x.tests.ok && pay2.includes('if (publicHoliday(date)) return 2.5;') && pay2.includes('if (day === SUNDAY) return 1.5;') && /# fail 0/.test(last), 'and its chef resolves it the same way: both loadings on main, tests green');
    await k.close();
    await sleep(400);
  }

  /* ---------- tickets handed out while other plates commit and ship ---------- */
  {
    // Six plates commit and merge into main at the same moment as six new tickets get their worktrees, all in one repo.
    // Without the per-repo queue in server/git.mjs this fails with "index.lock: File exists" and half-finished merges.
    const G = await import(pathToFileURL(path.resolve('server/git.mjs')).href);
    const raceRepo = path.join(tmp, 'race-repo'), N = 6, failures = [];
    await ensureDemoRepo(raceRepo);
    const plates = [];
    for (let i = 0; i < N; i++) {
      const dir = path.join(tmp, 'race-wt', `plate${i}`), branch = `kitchen/plate${i}`;
      await G.addWorktree(raceRepo, dir, branch, 'main');
      await fs.writeFile(path.join(dir, `plate${i}.txt`), `plate ${i}\n`);
      plates.push({ dir, branch });
    }
    await Promise.all([
      ...plates.map(async (p, i) => {
        try {
          await G.commitAll(p.dir, `plate ${i}`);
          const r = await G.mergeIntoMain(raceRepo, 'main', p.branch, `Ship plate ${i}`);
          if (!r.ok) failures.push(`merge ${i}: ${r.detail}`);
          await G.removeWorktree(raceRepo, p.dir, p.branch);
        } catch (e) { failures.push(`plate ${i}: ${e.message}`); }
      }),
      ...plates.map(async (_p, i) => {
        const dir = path.join(tmp, 'race-wt', `ticket${i}`), branch = `kitchen/ticket${i}`;
        try { await G.removeWorktree(raceRepo, dir, branch); await G.addWorktree(raceRepo, dir, branch, 'main'); } catch (e) { failures.push(`ticket ${i}: ${e.message}`); }
      }),
    ]);
    const merges = (await git(raceRepo, ['log', '--oneline', '--merges', 'main'])).split('\n').filter(Boolean).length;
    const trees = (await git(raceRepo, ['worktree', 'list'])).split('\n').filter(l => l.includes('ticket')).length;
    ok(failures.length === 0 && merges === N && trees === N && !(await git(raceRepo, ['status', '--porcelain', '--untracked-files=no'])), `six tickets are handed out while six plates commit and ship in the same repo: every merge lands and every worktree exists${failures.length ? ` (${failures[0].replace(/\s+/g, ' ').slice(0, 200)})` : ''}`);

    // The same through a kitchen: two approved plates ship at once while a third ticket is handed to a chef.
    process.env.SHIP_SIM_SPEED = '10'; process.env.SHIP_SIM_ASK = '0';
    const kRepo = path.join(tmp, 'race-kitchen');
    await ensureDemoRepo(kRepo);
    const k = new Kitchen({ repo: kRepo, dataDir: path.join(tmp, 'race-kitchen-data'), driver: simDriver, testCmd: 'npm test', mainBranch: 'main', pace: 80, chefs: ['pixel', 'router', 'query', 'stack'].map(id => ({ id, name: id })) });
    await k.init();
    try {
      const [x, y, z] = ['Race one', 'Race two', 'Race three'].map(title => k.addOrder({ title, size: 'S' }));
      await k.assign(x.id, 'pixel'); await k.assign(y.id, 'router');
      const end = Date.now() + 40000;
      while (Date.now() < end && !(x.state === 'at_pass' && y.state === 'at_pass')) { for (const q of [...k.questions]) k.answer(q.id, { allow: true, answers: Object.fromEntries(q.questions.map(qq => [qq.question, qq.options[0].label])) }); await sleep(100); }
      await k.review(x.id, { verdict: 'approve' }); await k.review(y.id, { verdict: 'approve' });
      const results = await Promise.allSettled([k.ship(x.id, { seen: true }), k.ship(y.id, { seen: true }), k.assign(z.id, 'query')]);
      const bad = results.filter(r => r.status === 'rejected').map(r => r.reason.message.replace(/\s+/g, ' ').slice(0, 160));
      ok(bad.length === 0 && z.chefId === 'query' && ['cooking', 'testing', 'at_pass'].includes(z.state) && [x, y].filter(o => o.state === 'shipped').length >= 1 && [x, y].every(o => o.state === 'shipped' || o.rounds === 1), `a kitchen hands out a ticket while two plates ship: the chef gets it and neither ship errors${bad.length ? ` (${bad[0]})` : ''}`);
    } finally { await k.close(); }
  }

  /* ---------- demo mode ---------- */
  const demoDir = path.join(tmp, 'demo');
  start(['--demo'], { SHIP_PACE: '80', SHIP_DEMO_DIR: demoDir, PORT: String(DEMO_PORT) }); // arrivals over the first 12 s
  const d = client(DEMO_PORT);
  s = await d.up();
  ok(s.driver === 'sim' && s.pace === 80 && s.shift.mode === 'off' && s.shift.focusMin === 3 && s.repo.startsWith(demoDir), 'demo: simulated chefs, its own fresh repo, a 3 minute shift that has not started');
  ok(s.orders.length === 1 && s.orders[0].title === STARTER_ORDERS[0].title, 'demo: the first customer walks up when the page opens');
  ok(DEMO_ARRIVALS_S.length === STARTER_ORDERS.length && DEMO_ARRIVALS_S.every((t, i) => i === 0 || t > DEMO_ARRIVALS_S[i - 1]) && DEMO_ARRIVALS_S.at(-1) <= 150, 'demo: every order has its own arrival time inside the 3 minute shift');
  await d.post('/api/rules', { autoRefire: true });
  const second = await d.wait(st => st.orders.find(x => x.title === 'Overtime after 8 hours'), 'the second customer', 8000);
  await d.post(`/api/orders/${second.id}/assign`, { chefId: 'query' });
  o = await d.until(second.id, ['at_pass']);
  s = await d.state();
  ok(s.rules.autoRefire === true && o.refires === 1 && o.rounds === 0 && o.tests.ok && s.stats.refires === 1 && s.stats.sentBack === 0, 'the oven lever re-fires the failing Overtime plate once and it comes back green, with no send-back');
  s = await d.wait(st => (st.orders.length === STARTER_ORDERS.length ? st : null), 'all seven customers', 25000);
  ok(s.orders.map(x => x.size).join('') === 'SMSLMMS' && s.orders.map(x => x.title).join() === STARTER_ORDERS.map(x => x.title).join() && s.shift.mode === 'off', 'demo: all seven orders arrive in menu order and no shift starts by itself');

  // The demo's last beat: ship Sunday, the Public holiday plate goes cold, send it back and it returns merged.
  const early = s.orders.find(x => x.title === 'Sunday penalty rate'), last = s.orders.find(x => x.title === 'Public holiday rate');
  await d.post('/api/grants', { cls: 'network' });
  await d.post(`/api/orders/${early.id}/assign`, { chefId: 'pixel' });
  await d.post(`/api/orders/${last.id}/assign`, { chefId: 'stack' });
  await d.until(early.id, ['at_pass']);
  o = await d.until(last.id, ['at_pass']);
  ok(o.activity.some(x => /Pre-approved by your network grant: runs curl/.test(x.text)) && !d.asked.some(q => q.orderId === last.id && q.kind === 'permission'), 'demo: the network jar pre-approves the holiday chef\'s curl');
  await d.post(`/api/orders/${early.id}/review`, { verdict: 'approve' });
  await d.post(`/api/orders/${early.id}/ship`, { seen: true });
  await d.wait(st => st.orders.find(x => x.id === last.id && x.merge?.clean === false), 'the demo Public holiday plate to go cold');
  const before = (await d.state()).stats.score;
  await d.post(`/api/orders/${last.id}/review`, { verdict: 'send_back' });
  await d.until(last.id, ['at_pass']);
  o = await d.wait(st => st.orders.find(x => x.id === last.id && x.merge), 'the demo Public holiday merge check');
  s = await d.state();
  ok(o.merge.clean === true && o.tests.ok && s.stats.conflicts === 0 && s.stats.score === before && s.grants.join() === 'network', 'a cold plate sent back merges main and returns green, at no cost in points');

  /* ---------- demo: the longer grace, the commit count, and "Play again" ---------- */
  ok(s.escalation.smokeMs === 20000 * 2.4 / 80 && s.escalation.fireMs === 60000 * 2.4 / 80 && s.escalation.everyMs === 10000 * 2.4 / 80, 'demo: a waiting chef smokes after 6 s at pace 8, not 2.5 s, and the penalty is stretched to match');
  ok(s.commits === Number(await git(path.join(demoDir, 'repo'), ['rev-list', '--count', 'main'])) && s.commits > 1, `demo: the snapshot counts the commits on main (${s.commits})`);
  ok(s.restart === '/api/demo/restart' && (await client(PORT).state()).restart === undefined && (await client(PORT).raw('/api/demo/restart')).status === 404, 'demo: the snapshot advertises the restart route; a kitchen on your own repo has none');
  await d.post('/api/chefs/pixel', { name: 'Nutmeg' });
  ok((await d.state()).chefs[0].name === 'Nutmeg', 'demo: a chef is renamed before play again');
  await d.post(s.restart);
  s = await d.state();
  ok(s.chefs.map(x => x.name).join() === 'Pixel,Router,Query,Stack', 'play again: the chefs have their default names back');
  ok(s.orders.length === 1 && s.orders[0].id === 1 && s.orders[0].title === STARTER_ORDERS[0].title && s.orders[0].state === 'waiting' && s.stats.score === 0 && s.stats.shipped === 0 && s.commits === 1 && s.chefs.every(ch => !ch.orderId), 'play again: a fresh kitchen with the first customer at the window and nothing shipped');
  ok((await git(path.join(demoDir, 'repo'), ['log', '--oneline'])).split('\n').length === 1 && !(await fs.readdir(path.join(demoDir, 'data', 'worktrees')).catch(() => [])).length, 'play again: the demo repo is rebuilt from the example, with no worktrees left');
  await d.wait(st => st.orders.find(x => x.title === 'Overtime after 8 hours'), 'the second customer after play again', 8000);
  ok(true, 'play again: the arrivals are re-armed');

  console.log(`\n${passed} checks passed`);
} catch (e) {
  console.error(e.message); console.error('--- server log ---\n' + log);
  process.exitCode = 1;
} finally {
  for (const child of servers) child.kill();
  await sleep(400);
  await fs.rm(tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }).catch(() => {});
}
