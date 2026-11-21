import { EventEmitter } from 'node:events';
import fs from 'node:fs/promises';
import path from 'node:path';
import * as G from './git.mjs';
import { grantClassFor, GRANT_CLASSES } from './agents.mjs';

const SIZE_POINTS = { S: 1, M: 2, L: 3 };
const TARGET_MIN = { S: 10, M: 20, L: 40 };
const LIVE = new Set(['planning', 'cooking', 'testing', 'merging']);
const STAGE = { cooking: 'cooking', testing: 'oven', at_pass: 'pass', merging: 'pass' };
const ON_THE_LINE = new Set(['cooking', 'testing', 'at_pass', 'merging', 'stalled']);
const EDIT_TOOLS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit']);

// A blocked chef: smoke, then fire, and a point lost per PENALTY_EVERY_MS once the grace has passed. All divided by pace.
const SMOKE_MS = 20_000, FIRE_MS = 60_000, PENALTY_EVERY_MS = 10_000, PENALTY_CAP = 30;
const STREAK_STEP = 0.25, STREAK_MAX = 2;

const now = () => Date.now();
const slug = s => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 32) || 'order';

function emptyStats() {
  return {
    shipped: 0, firstTime: 0, sentBack: 0, conflicts: 0, burntShipped: 0, blockedMs: 0, questions: 0, focusBreaks: 0, costUsd: 0, score: 0,
    blindShips: 0, steers: 0, refires: 0, streak: 1, blockedPenalty: 0, points: [],
  };
}

/** One to three stars for a shift, and the one thing most worth doing differently next time. */
function judge(r) {
  let stars = 1;
  if (r.shipped >= 1 && r.burntShipped === 0 && r.score > 0) stars = 2;
  if (stars === 2 && r.shipped >= 3 && r.conflicts === 0 && r.blindShips === 0 && r.blockedPenalty <= 10) stars = 3;
  let advice;
  if (r.burntShipped) advice = 'You shipped failing tests. Flip the oven lever so a red plate re-fires before it reaches you.';
  else if (!r.shipped) advice = 'Nothing reached main. Start the smallest ticket first so something ships early.';
  else if (r.conflicts) advice = 'A plate hit a merge conflict at the hatch. When a plate goes cold, send it back to merge main before you ship it.';
  else if (r.blockedPenalty > 10) advice = `Chefs waited ${Math.round(r.blockedMs / 1000)}s on you. Shake a spice jar on the ticket so they do not have to ask.`;
  else if (r.blindShips) advice = `You shipped ${r.blindShips} plate${r.blindShips > 1 ? 's' : ''} without reading the diff. Scroll it before you approve to keep the bonus and the streak.`;
  else if (r.sentBack >= 2) advice = 'Several plates went back. Put the bigger tickets on the prep island first so the chef cooks to a plan.';
  else if (r.shipped < 3) advice = 'Clean but slow. Hand out tickets sooner and keep more chefs cooking at once.';
  else advice = 'Clean service. Run one more chef in parallel next shift.';
  return { stars, advice };
}

export class Kitchen extends EventEmitter {
  /**
   * driver cooks for every chef that has no driver of its own, and writes the plans.
   * pace divides ticket targets and the blocked-chef timings, so a demo can run a whole service in minutes.
   */
  constructor({ repo, dataDir, driver, testCmd, chefs, mainBranch = 'main', model, pace = 1, focusMin = 25, breakMin = 5 }) {
    super();
    Object.assign(this, { repo, dataDir, driver, testCmd, mainBranch, model });
    this.pace = Number(pace) > 0 ? Number(pace) : 1;
    this.chefs = chefs.map(c => ({ id: c.id, name: c.name, style: c.style, model: c.model || model, driver: c.driver || driver, orderId: null }));
    this.orders = [];
    this.questions = [];
    this.stats = emptyStats();
    this.grants = new Set();          // shift-wide grant classes
    this.rules = { autoRefire: false };
    this.pairConflicts = new Map();   // 'idA:idB' -> files two plates at the pass would fight over
    this.shift = { mode: 'off', no: 0, focusMin, breakMin, startedAt: null, endsAt: null, startStats: null, report: null };
    this.nextId = 1;
    this.runs = new Map();       // orderId -> { ctl, done, superseded }
    this.waiters = new Map();    // questionId -> resolve
    this.file = path.join(dataDir, 'state.json');
  }

  /* ---------- lifecycle ---------- */
  async init() {
    await fs.mkdir(this.dataDir, { recursive: true });
    try {
      const saved = JSON.parse(await fs.readFile(this.file, 'utf8'));
      this.orders = (saved.orders || []).map(o => ({ touched: [], files: [], merge: null, approved: false, refires: 0, grants: [], ...o }));
      this.stats = { ...emptyStats(), ...saved.stats };
      this.nextId = saved.nextId || this.orders.length + 1;
      if (saved.rules) this.rules = { autoRefire: Boolean(saved.rules.autoRefire) };
      for (const c of saved.chefs || []) { const mine = this.chefs.find(x => x.id === c.id); if (mine) mine.orderId = c.orderId; }
      for (const o of this.orders) if (LIVE.has(o.state)) { o.state = 'stalled'; o.error = 'The kitchen restarted while this was cooking. Resume it or bin it.'; }
      if (saved.shift?.no) this.shift.no = saved.shift.no;
    } catch { /* fresh kitchen */ }
    for (const c of this.chefs) if (c.orderId && !this.orders.find(o => o.id === c.orderId && !['shipped', 'binned'].includes(o.state))) c.orderId = null;
    this.timer = setInterval(() => this.tick(), 250);
    this.refreshPass().catch(() => {});
  }

  changed() {
    if (this.closed) return;
    this.emit('change');
    clearTimeout(this.saveT);
    this.saveT = setTimeout(() => this.save().catch(e => console.error('save failed', e)), 300);
  }

  /** Stops the kitchen for good: timers, running chefs and waiting questions. The caller removes the directories. */
  async close() {
    this.closed = true;
    clearInterval(this.timer); clearTimeout(this.saveT);
    const runs = [...this.runs.values()];
    for (const r of runs) r.ctl.abort();
    for (const resolve of this.waiters.values()) resolve({ allow: false, message: 'The kitchen closed.' });
    this.waiters.clear(); this.questions = [];
    await Promise.all(runs.map(r => Promise.resolve(r.done).catch(() => {})));
    this.removeAllListeners();
  }

  async save() {
    const data = { orders: this.orders, stats: this.stats, nextId: this.nextId, rules: this.rules, chefs: this.chefs.map(c => ({ id: c.id, orderId: c.orderId })), shift: { no: this.shift.no } };
    await fs.writeFile(this.file + '.tmp', JSON.stringify(data, null, 2));
    await fs.rename(this.file + '.tmp', this.file);
  }

  snapshot() {
    const drivers = new Set(this.chefs.map(c => c.driver.name));
    return {
      driver: drivers.size === 1 ? [...drivers][0] : 'mixed',
      repo: this.repo, mainBranch: this.mainBranch, testCmd: this.testCmd, now: now(),
      pace: this.pace,
      escalation: { smokeMs: SMOKE_MS / this.pace, fireMs: FIRE_MS / this.pace },
      grants: [...this.grants],
      rules: { ...this.rules },
      chefs: this.chefs.map(c => ({ id: c.id, name: c.name, style: c.style, model: c.model, driver: c.driver.name, orderId: c.orderId, blocked: this.questions.some(q => q.chefId === c.id) })),
      orders: this.orders.map(o => ({ ...o, targetMin: TARGET_MIN[o.size] / this.pace, stage: STAGE[o.state] || null })),
      overlaps: this.overlaps(),
      questions: this.questions,
      stats: this.stats,
      shift: this.shift,
    };
  }

  order(id) {
    const o = this.orders.find(x => x.id === Number(id));
    if (!o) throw new Error(`No order #${id}`);
    return o;
  }

  log(o, kind, text, file) {
    o.activity.push(file ? { t: now(), kind, text, file } : { t: now(), kind, text });
    if (o.activity.length > 60) o.activity.splice(0, o.activity.length - 60);
  }

  score(n, why, o) {
    this.stats.score += n;
    this.stats.points.push({ t: now(), n, why, orderId: o?.id ?? null });
    if (this.stats.points.length > 200) this.stats.points.splice(0, this.stats.points.length - 200);
  }

  noteHumanAction() { if (this.shift.mode === 'focus') this.stats.focusBreaks++; }

  /* ---------- orders ---------- */
  addOrder({ title, body = '', size = 'M' }) {
    title = String(title || '').trim();
    if (!title) throw new Error('An order needs a title');
    if (!SIZE_POINTS[size]) size = 'M';
    const o = {
      id: this.nextId++, title: title.slice(0, 120), body: String(body).slice(0, 4000), size, state: 'waiting',
      plan: null, chefId: null, branch: null, worktree: null, sessionId: null, activity: [], summary: '', tests: null,
      diff: null, behind: 0, rounds: 0, feedback: [], costUsd: 0, error: null,
      touched: [], files: [], merge: null, approved: false, refires: 0, grants: [],
      createdAt: now(), assignedAt: null, atPassAt: null, shippedAt: null,
    };
    this.orders.push(o);
    this.changed();
    return o;
  }

  async planOrder(id) {
    const o = this.order(id);
    if (o.state !== 'waiting') throw new Error('Only a waiting order can go to the plan board');
    o.state = 'planning'; o.error = null;
    this.log(o, 'info', 'On the plan board');
    this.changed();
    const run = { ctl: new AbortController() }; this.runs.set(o.id, run);
    const res = await this.driver.run({
      cwd: this.repo, readOnly: true, model: this.model, signal: run.ctl.signal, order: { id: o.id, title: o.title },
      prompt: `Plan this order before a chef cooks it. Read the code, then reply with a numbered plan of at most 8 short steps and the tests that should prove it. Do not change any files.\n\nOrder #${o.id} (${o.size}): ${o.title}\n${o.body}`,
      onEvent: ev => { if (ev.kind === 'tool') { this.log(o, 'tool', ev.text, ev.file); this.changed(); } },
      askHuman: async () => ({ allow: false, message: 'Planning pass: no questions, make reasonable assumptions and list them.' }),
    });
    if (this.runs.get(o.id) === run) this.runs.delete(o.id);
    if (o.state !== 'planning') return; // binned meanwhile
    o.costUsd += res.costUsd; this.stats.costUsd += res.costUsd;
    if (res.isError) { o.state = 'waiting'; o.error = `Planning failed: ${res.error}`; }
    else { o.plan = res.summary.trim(); o.state = 'waiting'; this.log(o, 'info', 'Plan ready'); }
    this.changed();
  }

  orderPrompt(o) {
    return [`Order #${o.id} (${o.size}): ${o.title}`, o.body, o.plan ? `The plan board agreed this plan:\n${o.plan}` : ''].filter(Boolean).join('\n\n');
  }

  async assign(orderId, chefId) {
    const o = this.order(orderId);
    const chef = this.chefs.find(c => c.id === chefId);
    if (!chef) throw new Error('No such chef');
    if (o.state !== 'waiting') throw new Error(`Order #${o.id} is ${o.state}, not waiting`);
    if (chef.orderId) throw new Error(`${chef.name} is already cooking #${chef.orderId}`);
    o.branch = `kitchen/${o.id}-${slug(o.title)}`;
    o.worktree = path.join(this.dataDir, 'worktrees', `${o.id}-${slug(o.title)}`);
    await G.removeWorktree(this.repo, o.worktree, o.branch); // clear leftovers from a binned run with the same id
    await G.addWorktree(this.repo, o.worktree, o.branch, this.mainBranch);
    o.chefId = chef.id; chef.orderId = o.id; o.assignedAt = now(); o.error = null;
    this.noteHumanAction();
    this.log(o, 'info', `Ticket handed to ${chef.name}`);
    this.cook(o, this.orderPrompt(o), false);
  }

  /** Starts cooking in the background; any failure parks the order as stalled instead of crashing the kitchen. */
  cook(o, prompt, resume) {
    this.cookRun(o, prompt, resume).catch(e => {
      this.runs.delete(o.id);
      if (['shipped', 'binned'].includes(o.state)) return;
      o.state = 'stalled'; o.error = e.message || String(e);
      this.log(o, 'error', o.error); this.changed();
    });
  }

  /** Runs (or resumes) the chef's agent session and carries the result to the pass. */
  async cookRun(o, prompt, resume) {
    const chef = this.chefs.find(c => c.id === o.chefId);
    o.state = 'cooking'; o.approved = false; o.merge = null; o.error = null;
    this.log(o, 'info', resume ? `${chef.name} picks it back up` : `${chef.name} starts cooking`);
    this.changed();
    const run = { ctl: new AbortController(), superseded: false };
    this.runs.set(o.id, run);
    run.done = chef.driver.run({
      cwd: o.worktree, prompt, model: chef.model, signal: run.ctl.signal, order: { id: o.id, title: o.title },
      resume: resume ? o.sessionId : undefined,
      systemAppend: chef.style ? `Your cooking style: ${chef.style}` : '',
      onEvent: ev => {
        if (run.superseded) return;
        if (ev.kind === 'session') o.sessionId = ev.sessionId;
        else {
          this.log(o, ev.kind, ev.text, ev.file);
          // Only edits count as touched: every chef reads the same files, and an overlap should mean two chefs changing one.
          if (ev.kind === 'tool' && ev.file && EDIT_TOOLS.has(ev.tool) && !o.touched.includes(ev.file)) o.touched.push(ev.file);
        }
        this.changed();
      },
      askHuman: req => this.ask(o, chef, req),
    });
    const res = await run.done;
    if (run.superseded) return; // a call-out interrupted this run; steer() starts the next one
    this.runs.delete(o.id);
    if (o.state !== 'cooking') return; // binned while cooking
    o.costUsd += res.costUsd; this.stats.costUsd += res.costUsd;
    if (res.isError) {
      o.state = 'stalled'; o.error = res.error || 'The agent stopped';
      this.log(o, 'error', o.error); this.changed(); return;
    }
    o.summary = res.summary;
    await this.toThePass(o);
  }

  async toThePass(o) {
    o.state = 'testing';
    this.log(o, 'info', 'Commits the work and puts it in the oven (tests)');
    this.changed();
    try {
      await G.commitAll(o.worktree, `#${o.id} ${o.title}${o.rounds ? ` (round ${o.rounds + 1})` : ''}`);
      o.tests = await G.runTests(o.worktree, this.testCmd);
      o.diff = await G.diffAgainst(this.repo, this.mainBranch, o.branch);
    } catch (e) {
      o.state = 'stalled'; o.error = e.message; this.changed(); return;
    }
    if (o.state !== 'testing') return;
    if (!o.tests.ok && this.rules.autoRefire && o.refires < 1) {
      o.refires++; this.stats.refires++;
      this.log(o, 'error', 'Tests fail. The oven lever re-fires it once');
      this.cook(o, `The oven re-fired your plate because the tests fail:\n${o.tests.output.slice(-1500)}\n\nFix it, rerun the tests, and summarize again.`, Boolean(o.sessionId));
      return;
    }
    o.state = 'at_pass'; o.atPassAt = now();
    this.log(o, o.tests.ok ? 'good' : 'error', o.tests.ok ? 'Tests pass. Plate is at the pass' : 'Tests fail. Plate is at the pass, burnt');
    this.changed();
    await this.refreshPass();
  }

  /** Recomputes merge truth for every plate at the pass: how far behind, which files, whether it still merges. */
  async refreshPass() {
    const plates = this.orders.filter(o => o.state === 'at_pass' && o.branch);
    for (const o of plates) {
      o.behind = await G.behindBy(this.repo, this.mainBranch, o.branch);
      o.files = await G.changedFiles(this.repo, this.mainBranch, o.branch);
      o.merge = await G.mergeCheck(this.repo, this.mainBranch, o.branch);
    }
    const pairs = new Map();
    for (let i = 0; i < plates.length; i++) {
      for (let j = i + 1; j < plates.length; j++) {
        const a = plates[i], b = plates[j];
        if (!a.files.some(f => b.files.includes(f))) continue;
        const check = await G.mergeCheck(this.repo, a.branch, b.branch);
        pairs.set(`${a.id}:${b.id}`, check && !check.clean ? check.conflicts : []);
      }
    }
    this.pairConflicts = pairs;
    this.changed();
  }

  /**
   * Orders on the line that change the same files: [idA, idB, sharedFiles, conflictFiles].
   * conflictFiles is filled once both plates are at the pass and git says they cannot both merge as they are.
   */
  overlaps() {
    const live = this.orders.filter(o => ON_THE_LINE.has(o.state) && o.chefId);
    const filesOf = o => ((o.state === 'at_pass' || o.state === 'merging') && o.files?.length ? o.files : o.touched) || [];
    const out = [];
    for (let i = 0; i < live.length; i++) {
      for (let j = i + 1; j < live.length; j++) {
        const theirs = filesOf(live[j]);
        const shared = filesOf(live[i]).filter(f => theirs.includes(f)).sort();
        if (shared.length) out.push([live[i].id, live[j].id, shared, this.pairConflicts.get(`${live[i].id}:${live[j].id}`) || []]);
      }
    }
    return out;
  }

  /* ---------- questions: the ? bubble ---------- */
  ask(o, chef, req) {
    const grantClass = req.kind === 'permission' ? grantClassFor(req.toolName, req.input) : null;
    if (grantClass && (this.grants.has(grantClass) || o.grants.includes(grantClass))) {
      this.log(o, 'good', `Pre-approved by your ${grantClass} grant: ${req.reason}`);
      this.changed();
      return Promise.resolve({ allow: true });
    }
    const q = {
      id: `q${now().toString(36)}${Math.random().toString(36).slice(2, 5)}`,
      orderId: o.id, chefId: chef.id, kind: req.kind, toolName: req.toolName, reason: req.reason || '',
      input: req.kind === 'permission' ? req.input : undefined, grantClass,
      questions: req.questions || [], createdAt: now(), duringFocus: this.shift.mode === 'focus', charged: 0,
    };
    this.questions.push(q);
    this.stats.questions++;
    this.log(o, 'ask', req.kind === 'question' ? `asks: ${q.questions.map(x => x.question).join(' / ')}` : `needs your OK: ${q.reason}`);
    this.changed();
    return new Promise(resolve => this.waiters.set(q.id, resolve));
  }

  /** Takes a question off the board and lets the chef carry on with the reply. */
  settle(q, reply, note) {
    const i = this.questions.indexOf(q);
    if (i < 0) return;
    this.questions.splice(i, 1);
    this.stats.blockedMs += now() - q.createdAt;
    const o = this.orders.find(x => x.id === q.orderId);
    if (o && note) this.log(o, 'info', note);
    this.waiters.get(q.id)?.(reply);
    this.waiters.delete(q.id);
    this.changed();
  }

  answer(qid, { allow = true, message = '', answers = {}, always = false } = {}) {
    const q = this.questions.find(x => x.id === qid);
    if (!q) throw new Error('That question is already answered');
    const waited = Math.round((now() - q.createdAt) / 1000);
    this.noteHumanAction();
    this.settle(q, { allow, message, answers }, allow ? `You answered after ${waited}s` : `You said no after ${waited}s`);
    if (always && allow && q.grantClass) this.grant(q.grantClass);
  }

  /** Adds a grant, shift-wide or for one order, and answers every waiting request it now covers. */
  grant(cls, orderId) {
    if (!GRANT_CLASSES.includes(cls)) throw new Error(`Unknown grant "${cls}". Use ${GRANT_CLASSES.join(', ')}`);
    let o = null;
    if (orderId !== undefined && orderId !== null && orderId !== '') {
      o = this.order(orderId);
      if (['shipped', 'binned'].includes(o.state)) throw new Error('That order is already done');
      if (!o.grants.includes(cls)) o.grants.push(cls);
      this.log(o, 'info', `You granted ${cls} for this order`);
    } else {
      this.grants.add(cls);
    }
    for (const q of this.questions.filter(x => x.grantClass === cls && (!o || x.orderId === o.id))) {
      this.settle(q, { allow: true }, `Pre-approved by your ${cls} grant: ${q.reason}`);
    }
    this.changed();
  }

  setRules({ autoRefire } = {}) {
    if (typeof autoRefire === 'boolean') this.rules.autoRefire = autoRefire;
    this.changed();
  }

  /** Drops an order's open questions without counting them as an answer from the head chef. */
  dropQuestions(o, message) {
    for (const q of this.questions.filter(x => x.orderId === o.id)) this.settle(q, { allow: false, message });
  }

  /* ---------- tasting and calling out ---------- */
  async diff(orderId) {
    const o = this.order(orderId);
    if (!o.branch) return { patch: '', stat: null };
    return G.diffAgainst(this.repo, this.mainBranch, o.branch);
  }

  /** The chef's work so far, including what is not committed yet. */
  async wip(orderId) {
    const o = this.order(orderId);
    if (!o.worktree || ['shipped', 'binned', 'waiting'].includes(o.state)) return { patch: '', stat: null };
    try { return await G.wipDiff(o.worktree, this.mainBranch); } catch { return { patch: '', stat: null }; }
  }

  /** Interrupts a cooking chef and resumes the same session with one line from the head chef. */
  async steer(orderId, note) {
    const o = this.order(orderId);
    note = String(note || '').replace(/\s+/g, ' ').trim().slice(0, 500);
    if (o.state !== 'cooking') throw new Error('You can only call out to a chef who is cooking');
    if (!note) throw new Error('Say something when you call out');
    const run = this.runs.get(o.id);
    if (run?.superseded) throw new Error('The chef is still turning round from your last call-out');
    this.noteHumanAction();
    this.stats.steers++;
    this.log(o, 'info', `You called out: ${note}`);
    if (run) {
      run.superseded = true;
      run.ctl.abort();
      this.dropQuestions(o, 'The head chef interrupted with a new instruction.');
      this.changed();
      await Promise.resolve(run.done).catch(() => {});
      if (this.runs.get(o.id) === run) this.runs.delete(o.id);
    }
    if (o.state !== 'cooking') return; // binned while the chef was stopping
    const callout = `The head chef called out: ${note}\n\nTake that into account, carry on with the order, run the tests, and summarize.`;
    this.cook(o, o.sessionId ? callout : `${this.orderPrompt(o)}\n\n${callout}`, Boolean(o.sessionId));
  }

  /* ---------- the pass and the hatch ---------- */
  async review(orderId, { verdict, comment = '' }) {
    const o = this.order(orderId);
    if (o.state !== 'at_pass') throw new Error('That plate is not at the pass');
    if (verdict === 'send_back') {
      const cold = o.merge?.clean === false;
      comment = String(comment || '').trim() || (cold ? `It no longer merges into ${this.mainBranch}.` : '');
      if (!comment) throw new Error('Say what to fix when you send a plate back');
      this.noteHumanAction();
      o.rounds++; o.feedback.push({ t: now(), comment }); this.stats.sentBack++;
      // A cold plate is nobody's bad cooking, so sending it back to merge main costs the round but no points.
      if (!cold) this.score(-10, 'Sent back', o);
      const testNote = o.tests && !o.tests.ok ? `\n\nThe tests were failing when it reached the pass:\n${o.tests.output.slice(-1500)}` : '';
      const mergeNote = cold ? `\n\nMain has also moved on and your branch no longer merges cleanly (${o.merge.conflicts.join(', ') || 'conflicts'}). Run \`git merge ${this.mainBranch}\` in your directory and resolve every conflict.` : '';
      this.cook(o, `The head chef sent your plate back from the pass. Feedback:\n${comment}${testNote}${mergeNote}\n\nFix it, rerun the tests, and summarize again.`, Boolean(o.sessionId));
      return;
    }
    if (verdict !== 'approve') throw new Error('Unknown verdict');
    this.noteHumanAction();
    if (!o.approved) { o.approved = true; this.log(o, 'good', 'Approved at the pass. Carry it to the hatch to ship'); }
    this.changed();
  }

  /** Merges an approved plate into main. `seen` is whether the head chef read the diff before approving. */
  async ship(orderId, { seen = false } = {}) {
    const o = this.order(orderId);
    if (o.state !== 'at_pass') throw new Error('That plate is not at the pass');
    if (!o.approved) throw new Error('Approve the plate at the pass before it goes to the hatch');
    seen = seen === true;
    this.noteHumanAction();
    o.state = 'merging'; this.changed();
    let res;
    try { res = await G.mergeIntoMain(this.repo, this.mainBranch, o.branch, `Ship #${o.id}: ${o.title}`); }
    catch (e) { o.state = 'at_pass'; o.error = e.message; this.changed(); throw e; }
    if (!res.ok) {
      o.rounds++; this.stats.conflicts++; this.stats.streak = 1;
      this.score(-20, 'Spoiled: conflicts with main', o);
      this.log(o, 'error', 'Main moved on and this no longer merges. Back to the chef');
      this.cook(o, `Main has moved on and your branch no longer merges cleanly. Run \`git merge ${this.mainBranch}\` in your directory, resolve every conflict, rerun the tests, and summarize again.`, Boolean(o.sessionId));
      return { shipped: false, conflict: true };
    }
    const burnt = Boolean(o.tests && !o.tests.ok);
    const base = 100 * SIZE_POINTS[o.size];
    const earned = seen && !burnt && o.rounds === 0; // right first time, and you looked
    this.score(base, `Shipped #${o.id}`, o);
    if (seen && !burnt && this.stats.streak > 1) this.score(Math.round(base * (this.stats.streak - 1)), `Streak ×${this.stats.streak}`, o);
    if (earned) { this.stats.firstTime++; this.score(50, 'Right first time', o); }
    if (!seen) { this.stats.blindShips++; this.log(o, 'info', 'Shipped without reading the diff: no bonus'); }
    if (burnt) { this.stats.burntShipped++; this.score(-150, 'Shipped with failing tests', o); }
    this.stats.streak = earned ? Math.min(STREAK_MAX, this.stats.streak + STREAK_STEP) : 1;
    const leadMin = (now() - o.createdAt) / 60000;
    if (leadMin <= TARGET_MIN[o.size] / this.pace) this.score(25, 'Served on time', o);
    this.stats.shipped++;
    o.state = 'shipped'; o.shippedAt = now(); o.error = null;
    this.log(o, 'good', 'Shipped to main');
    this.freeChef(o);
    await G.removeWorktree(this.repo, o.worktree, o.branch);
    await this.refreshPass().catch(() => this.changed());
    return { shipped: true, conflict: false };
  }

  freeChef(o) { const c = this.chefs.find(x => x.id === o.chefId); if (c && c.orderId === o.id) c.orderId = null; }

  async resume(orderId) {
    const o = this.order(orderId);
    if (o.state !== 'stalled') throw new Error('Only a stalled order can be resumed');
    if (!o.worktree || !o.chefId) { o.state = 'waiting'; o.error = null; this.changed(); return; }
    this.noteHumanAction();
    this.cook(o, 'Continue the order where you left off. Finish it, run the tests, and summarize.', Boolean(o.sessionId));
  }

  async bin(orderId) {
    const o = this.order(orderId);
    if (['shipped', 'binned'].includes(o.state)) throw new Error('Already done');
    const wasLive = LIVE.has(o.state);
    o.state = 'binned'; o.approved = false;
    this.noteHumanAction();
    this.runs.get(o.id)?.ctl.abort();
    this.dropQuestions(o, 'The order was binned.');
    this.freeChef(o);
    if (o.worktree) await G.removeWorktree(this.repo, o.worktree, o.branch);
    this.log(o, 'info', wasLive ? 'Binned mid-cook' : 'Binned');
    await this.refreshPass().catch(() => this.changed());
  }

  /* ---------- shift (pomodoro) ---------- */
  startShift({ focusMin, breakMin } = {}) {
    const f = Math.max(0.5, Math.min(90, Number(focusMin) || this.shift.focusMin || 25)), b = Math.max(0.5, Math.min(30, Number(breakMin) || this.shift.breakMin || 5));
    this.shift = { mode: 'focus', no: this.shift.no + 1, focusMin: f, breakMin: b, startedAt: now(), endsAt: now() + f * 60000, startStats: structuredClone({ ...this.stats, points: undefined }), report: null };
    this.changed();
  }

  stopShift() { this.shift = { ...this.shift, mode: 'off', endsAt: null }; this.grants.clear(); this.changed(); }

  /** A chef waiting on you past the grace costs a point every interval, up to a cap, so a forgotten ? cannot drain a whole score. */
  chargeBlocked() {
    const grace = SMOKE_MS / this.pace, every = PENALTY_EVERY_MS / this.pace;
    let any = false;
    for (const q of this.questions) {
      const owed = Math.min(PENALTY_CAP, Math.max(0, Math.floor((now() - q.createdAt - grace) / every)));
      if (owed <= (q.charged || 0)) continue;
      const n = owed - (q.charged || 0);
      q.charged = owed;
      this.stats.blockedPenalty += n;
      this.score(-n, 'Chef kept waiting', this.orders.find(o => o.id === q.orderId));
      any = true;
    }
    return any;
  }

  tick() {
    const charged = this.chargeBlocked();
    const s = this.shift;
    if (s.mode === 'off' || !s.endsAt || now() < s.endsAt) { if (charged) this.changed(); return; }
    if (s.mode === 'focus') {
      const a = s.startStats, b = this.stats;
      const d = k => b[k] - (a?.[k] || 0);
      const report = {
        shift: s.no, focusMin: s.focusMin,
        shipped: d('shipped'), firstTime: d('firstTime'), sentBack: d('sentBack'), conflicts: d('conflicts'), burntShipped: d('burntShipped'),
        blockedMs: d('blockedMs') + this.questions.reduce((t, q) => t + (now() - Math.max(q.createdAt, s.startedAt)), 0),
        questions: d('questions'), focusBreaks: d('focusBreaks'), costUsd: d('costUsd'), score: d('score'),
        blindShips: d('blindShips'), steers: d('steers'), refires: d('refires'), blockedPenalty: d('blockedPenalty'), streak: b.streak,
        waiting: this.questions.length, atPass: this.orders.filter(o => o.state === 'at_pass').length,
      };
      s.report = { ...report, ...judge(report) };
      s.mode = 'break'; s.endsAt = now() + s.breakMin * 60000;
      this.grants.clear(); // "always this shift" ends with the shift
    } else {
      s.mode = 'off'; s.endsAt = null;
    }
    this.changed();
  }
}
