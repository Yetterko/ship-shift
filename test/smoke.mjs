// End-to-end check with simulated chefs: real git worktrees, real tests, real merges and conflicts, no API spend.
import { spawn, exec } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { ensureDemoRepo } from '../server/demo-repo.mjs';
import { git } from '../server/git.mjs';
import { grantClassFor, simDriver } from '../server/agents.mjs';
import { Kitchen } from '../server/kitchen.mjs';

const pexec = promisify(exec);
const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'ship-shift-'));
const repo = path.join(tmp, 'repo');
await ensureDemoRepo(repo);
const PORT = 4699, DEMO_PORT = 4698, PACE = 20;
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

  /* ---------- the four starter orders, cooked by recipe ---------- */
  const ot = await c.post('/api/orders', { title: 'Overtime pay', body: 'Pay 1.5x past 8 hours in a shift', size: 'M' });
  const csv = await c.post('/api/orders', { title: 'Weekly pay CSV export', body: 'Add src/export.js', size: 'L' });
  const wk = await c.post('/api/orders', { title: 'Weekly hours crashes', body: 'Fix weeklyHours', size: 'S' });
  const db = await c.post('/api/orders', { title: 'Double-booked staff report', body: 'Add doubleBookings', size: 'M' });
  const byId = (st, x) => st.orders.find(y => y.id === x.id);

  // A spice jar on the ticket before it is handed over.
  await c.post('/api/grants', { cls: 'install', orderId: csv.id });
  ok(byId(await c.state(), csv).grants.join() === 'install', 'a grant sticks to the ticket');

  await c.post(`/api/orders/${ot.id}/assign`, { chefId: 'pixel' });
  await c.post(`/api/orders/${csv.id}/assign`, { chefId: 'router' });
  await c.post(`/api/orders/${wk.id}/assign`, { chefId: 'query' });
  await c.post(`/api/orders/${db.id}/assign`, { chefId: 'stack' });

  // Call out to Stack straight away: the run is interrupted and the same session carries on with the note.
  await c.post(`/api/orders/${db.id}/steer`, { note: 'use round2' });
  s = await c.state();
  ok(byId(s, db).state === 'cooking' && s.stats.steers === 1 && byId(s, db).activity.some(x => x.text === 'You called out: use round2'), 'steer keeps the chef cooking and logs the note');

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
  ok(seenOtQuestion && /per shift or per week/.test(seenOtQuestion.questions[0].question) && seenOtQuestion.grantClass === null, 'the Overtime chef asks: per shift or per week?');
  ok(s.stats.blockedPenalty >= 1 && s.stats.points.some(x => x.why === 'Chef kept waiting' && x.n < 0 && x.orderId === ot.id), `a chef left waiting past the threshold costs points (${s.stats.blockedPenalty} so far)`);

  o = await c.until(ot.id, ['at_pass']);
  ok(o.tests && o.tests.ok === false && /390/.test(o.tests.output), 'Overtime: the first test run really fails (390 where 330 is expected)');
  ok((await c.until(db.id, ['at_pass'])).activity.some(x => x.kind === 'text' && x.text.includes('use round2')), 'the steered chef heard the note and finished the dish');

  o = await c.until(csv.id, ['at_pass']);
  ok(o.activity.some(x => /Pre-approved by your install grant: runs npm install csv-stringify/.test(x.text)) && !c.asked.some(q => q.orderId === csv.id && q.kind === 'permission'), 'the grant pre-approves the CSV install: the chef never has to ask');
  ok(o.tests.ok && o.files.includes('src/export.js') && o.files.includes('src/pay.js'), 'CSV export arrives green with src/export.js and src/pay.js changed');
  await c.until(wk.id, ['at_pass']);

  // Both plates merge alone, and git already knows they cannot both go out as they are.
  const pair = await c.wait(st => st.overlaps.find(x => x[0] === ot.id && x[1] === csv.id && x[3]?.length), 'the Overtime/CSV overlap');
  s = await c.state();
  ok(pair[2].includes('src/pay.js') && pair[3].join() === 'src/pay.js' && byId(s, ot).merge.clean && byId(s, csv).merge.clean, 'the merge check predicts the Overtime/CSV conflict in src/pay.js before anything ships');
  ok(s.overlaps.some(x => x[0] === ot.id && x[1] === wk.id && x[2].includes('src/pay.js') && x[3].length === 0), 'Overtime and Weekly hours overlap in src/pay.js without a conflict');

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
  await c.post(`/api/orders/${wk.id}/review`, { verdict: 'approve' });
  await c.post(`/api/orders/${wk.id}/ship`, { seen: false });
  s = await c.state();
  ok(s.stats.blindShips === 1 && s.stats.firstTime === 0 && s.stats.streak === 1 && !s.stats.points.some(x => x.orderId === wk.id && x.why === 'Right first time'), 'a blind ship is counted and earns no first-time bonus');

  await c.post(`/api/orders/${db.id}/review`, { verdict: 'approve' });
  await c.post(`/api/orders/${db.id}/ship`, { seen: true });
  s = await c.state();
  ok(s.stats.firstTime === 1 && s.stats.streak === 1.25, 'a read, right-first-time ship earns the bonus and builds the streak');

  await c.post(`/api/orders/${ot.id}/review`, { verdict: 'approve' });
  await c.post(`/api/orders/${ot.id}/ship`, { seen: true });
  o = await c.wait(st => { const x = byId(st, csv); return x.merge && x.merge.clean === false ? x : null; }, 'the CSV plate to go cold');
  ok(o.merge.conflicts.join() === 'src/pay.js' && o.behind >= 1 && o.state === 'at_pass', 'once Overtime ships, the CSV plate goes cold: its merge check names src/pay.js');

  // Ship it anyway: a real conflict, and the chef really merges main and resolves it.
  await c.post(`/api/orders/${csv.id}/review`, { verdict: 'approve' });
  const spoiled = await c.post(`/api/orders/${csv.id}/ship`, { seen: true });
  s = await c.state();
  ok(spoiled.conflict === true && spoiled.shipped === false && s.stats.conflicts === 1 && byId(s, csv).approved === false, 'shipping both is a real conflict: stats.conflicts is 1 and the plate goes back');
  o = await c.until(csv.id, ['at_pass']);
  o = await c.wait(st => { const x = byId(st, csv); return x.merge ? x : null; }, 'the CSV merge check');
  ok(o.tests.ok && o.merge.clean === true && o.activity.some(x => x.text === 'runs git merge main') && o.activity.some(x => x.text === 'resolves the conflict in src/pay.js'), 'the conflict run merges main, resolves src/pay.js and comes back green');
  await c.post(`/api/orders/${csv.id}/review`, { verdict: 'approve' });
  ok((await c.post(`/api/orders/${csv.id}/ship`, { seen: true })).shipped === true, 'the resolved plate ships');

  const pay = await fs.readFile(path.join(repo, 'src', 'pay.js'), 'utf8');
  ok(pay.includes('shiftPayExact') && pay.includes('(hours - overtime) * staff.rate') && pay.includes('i < shifts.length') && !/^[<=>]{7}/m.test(pay), 'main has the overtime rule, the exact pay split and the weekly hours fix, with no conflict markers');
  const final = await pexec('npm test', { cwd: repo, windowsHide: true }).then(r => ({ ok: true, out: r.stdout }), e => ({ ok: false, out: (e.stdout || '') + (e.stderr || '') }));
  if (!final.ok) console.error(final.out);
  ok(final.ok && /# fail 0/.test(final.out), `the repo ends with a green npm test (${(final.out.match(/# pass \d+/) || [''])[0].slice(2)})`);
  s = await c.state();
  ok(s.stats.shipped === 5 && s.chefs.every(x => !x.orderId) && s.overlaps.length === 0 && (await git(repo, ['status', '--porcelain'])) === '', 'five orders shipped, every chef is free and main is clean');

  await c.post('/api/shift/start', { focusMin: 0.5, breakMin: 0.5 });
  ok((await c.state()).shift.mode === 'focus', 'shift starts in focus');

  /* ---------- demo mode ---------- */
  const demoDir = path.join(tmp, 'demo');
  start(['--demo'], { SHIP_PACE: '80', SHIP_DEMO_DIR: demoDir, PORT: String(DEMO_PORT) }); // arrivals at 0, 1, 2.5 and 4.5 s
  const d = client(DEMO_PORT);
  s = await d.up();
  ok(s.driver === 'sim' && s.pace === 80 && s.shift.mode === 'off' && s.shift.focusMin === 3 && s.repo.startsWith(demoDir), 'demo: simulated chefs, its own fresh repo, a 3 minute shift that has not started');
  ok(s.orders.length === 1 && s.orders[0].title === 'Weekly hours crashes', 'demo: the first customer walks up when the page opens');
  await d.post('/api/rules', { autoRefire: true });
  const second = await d.wait(st => st.orders.find(x => x.title === 'Overtime pay'), 'the second customer', 8000);
  await d.post(`/api/orders/${second.id}/assign`, { chefId: 'query' });
  o = await d.until(second.id, ['at_pass']);
  s = await d.state();
  ok(s.rules.autoRefire === true && o.refires === 1 && o.rounds === 0 && o.tests.ok && s.stats.refires === 1 && s.stats.sentBack === 0, 'the oven lever re-fires the failing Overtime plate once and it comes back green, with no send-back');
  s = await d.wait(st => (st.orders.length === 4 ? st : null), 'all four customers', 10000);
  ok(s.orders.map(x => x.size).join('') === 'SMML' && s.shift.mode === 'off', 'demo: all four starter orders arrive in turn and no shift starts by itself');

  // The demo's last beat: ship Overtime, the CSV plate goes cold, send it back and it returns merged.
  const last = s.orders.find(x => x.title === 'Weekly pay CSV export');
  await d.post('/api/grants', { cls: 'install' });
  await d.post(`/api/orders/${last.id}/assign`, { chefId: 'stack' });
  await d.until(last.id, ['at_pass']);
  await d.post(`/api/orders/${second.id}/review`, { verdict: 'approve' });
  await d.post(`/api/orders/${second.id}/ship`, { seen: true });
  await d.wait(st => st.orders.find(x => x.id === last.id && x.merge?.clean === false), 'the demo CSV plate to go cold');
  const before = (await d.state()).stats.score;
  await d.post(`/api/orders/${last.id}/review`, { verdict: 'send_back' });
  await d.until(last.id, ['at_pass']);
  o = await d.wait(st => st.orders.find(x => x.id === last.id && x.merge), 'the demo CSV merge check');
  s = await d.state();
  ok(o.merge.clean === true && o.tests.ok && s.stats.conflicts === 0 && s.stats.score === before && s.grants.join() === 'install', 'a cold plate sent back merges main and returns green, at no cost in points');

  console.log(`\n${passed} checks passed`);
} catch (e) {
  console.error(e.message); console.error('--- server log ---\n' + log);
  process.exitCode = 1;
} finally {
  for (const child of servers) child.kill();
  await sleep(400);
  await fs.rm(tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }).catch(() => {});
}
