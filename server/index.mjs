import crypto from 'node:crypto';
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import { Kitchen } from './kitchen.mjs';
import { realDriver, simDriver } from './agents.mjs';
import * as demoProject from './demo-repo.mjs';
import { isRepo, currentBranch } from './git.mjs';
import { Sessions, sessionIdFrom, sessionCookie, allow, scrubber } from './sessions.mjs';
import { World } from './world.mjs';
import { apiKitchens, API_MODEL } from './api-driver.mjs';

const { ensureDemoRepo, STARTER_ORDERS } = demoProject;
const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const PORT = Number(process.env.PORT || 4610);
// Public mode: every visitor gets a private demo kitchen of their own, and the chefs are always simulated. See mainPublic().
const PUBLIC = process.argv.includes('--public') || process.env.SHIP_PUBLIC === '1';
const HOST = PUBLIC ? process.env.SHIP_HOST || '0.0.0.0' : '127.0.0.1';
// Demo mode: simulated chefs, a fast clock, and a brand-new repo on every start so the same three minutes play out each time.
const DEMO = process.argv.includes('--demo') || process.env.SHIP_DEMO === '1';
const SIM = PUBLIC || DEMO || process.env.SHIP_SIM === '1';
const PACE = Number(process.env.SHIP_PACE) > 0 ? Number(process.env.SHIP_PACE) : DEMO || PUBLIC ? 8 : 1;
const demoDir = path.resolve(process.env.SHIP_DEMO_DIR || path.join(root, '.kitchen', 'demo'));
const DEMO_MARK = '.ship-shift-demo';
const repoArg = DEMO ? null : process.env.SHIP_REPO;
const repo = DEMO ? path.join(demoDir, 'repo') : path.resolve(repoArg || path.join(root, 'demo-repo'));
const dataDir = DEMO ? path.join(demoDir, 'data') : path.resolve(process.env.SHIP_DATA || path.join(root, '.kitchen', path.basename(repo)));
// When the demo's starter orders walk up, in seconds at the demo's pace of 8. Another pace stretches or squeezes them.
// The example project's own schedule wins when it exports one.
const DEMO_PACE = 8, DEMO_ARRIVALS_S = demoProject.DEMO_ARRIVALS_S || [0, 10, 25, 45];
// The town: public kitchens open onto one shared park. SHIP_WORLD=0 keeps every public kitchen private, as before.
const WORLD = PUBLIC && process.env.SHIP_WORLD !== '0';
// A demo kitchen gives a first-timer longer before a waiting chef smokes: 6 s at the demo's pace of 8, where 20 s / 8 would be 2.5 s.
// Fire and the waiting penalty stretch by the same factor.
const DEMO_GRACE = 2.4;
// The route that hands out a fresh demo kitchen. A kitchen that has one says so in its snapshot.
const RESTART = '/api/demo/restart';
// What hiring a chef costs in score in a public kitchen, so it is a decision.
const HIRE_COST = 50;

const CHEFS = [
  { id: 'pixel', name: 'Pixel', style: 'You care about clear names and small, readable diffs.' },
  { id: 'router', name: 'Router', style: 'You care about edge cases and input validation.' },
  { id: 'query', name: 'Query', style: 'You care about correct data handling and thorough tests.' },
  { id: 'stack', name: 'Stack', style: 'You care about simple designs and adding as few dependencies as you can.' },
];

const list = v => String(v || '').split(',').map(s => s.trim()).filter(Boolean);
const knownChef = id => { if (!CHEFS.some(c => c.id === id)) throw new Error(`No chef called "${id}". The chefs are ${CHEFS.map(c => c.id).join(', ')}.`); return id; };

/** Each chef's driver and model: SHIP_REAL_CHEFS names the chefs that are real agents, and the rest are simulated. */
function staff() {
  // A public kitchen never reads SHIP_REAL_CHEFS or SHIP_CHEF_MODELS: a real chef would run code with the owner's Claude credentials.
  if (PUBLIC) return { driver: simDriver, chefs: CHEFS.map(c => ({ ...c, driver: simDriver })) };
  const real = list(process.env.SHIP_REAL_CHEFS).map(knownChef);
  const models = Object.fromEntries(list(process.env.SHIP_CHEF_MODELS).map(pair => {
    const [id, model] = pair.split('=').map(s => s.trim());
    if (!model) throw new Error(`SHIP_CHEF_MODELS needs chef=model pairs, got "${pair}"`);
    return [knownChef(id), model];
  }));
  const everyone = real.length ? null : SIM ? simDriver : realDriver;
  return {
    // Plans come from the kitchen's own driver. It is simulated whenever any chef is, so a mixed kitchen only spends where you asked it to.
    driver: SIM || real.length ? simDriver : realDriver,
    chefs: CHEFS.map(c => ({ ...c, model: models[c.id], driver: everyone || (real.includes(c.id) ? realDriver : simDriver) })),
  };
}

/** The demo's customers walk up to the window on schedule. Returns the timers still pending. */
function seatCustomers(kitchen) {
  return STARTER_ORDERS.flatMap((o, i) => {
    const ms = (DEMO_ARRIVALS_S[i] ?? DEMO_ARRIVALS_S.at(-1)) * 1000 * DEMO_PACE / PACE;
    if (ms === 0) { kitchen.addOrder(o); return []; }
    return [setTimeout(() => kitchen.addOrder(o), ms)];
  });
}

/** Clears the last demo. Only ever deletes a directory this function created and marked. */
async function freshDemoDir() {
  const exists = await fs.stat(demoDir).then(() => true, () => false);
  if (exists) {
    const ours = await fs.stat(path.join(demoDir, DEMO_MARK)).then(() => true, () => false);
    const empty = !ours && (await fs.readdir(demoDir)).length === 0;
    if (!ours && !empty) throw new Error(`${demoDir} was not made by the demo, so it will not be cleared. Point SHIP_DEMO_DIR at an empty or new directory.`);
    await fs.rm(demoDir, { recursive: true, force: true, maxRetries: 8, retryDelay: 150 });
  }
  await fs.mkdir(demoDir, { recursive: true });
  await fs.writeFile(path.join(demoDir, DEMO_MARK), 'Ship Shift demo. This directory is deleted and rebuilt on every `npm run demo`.\n');
}

async function main() {
  let seeded = false;
  const crew = staff();
  if (DEMO) await freshDemoDir();
  if (!repoArg) seeded = await ensureDemoRepo(repo);
  if (!(await isRepo(repo))) throw new Error(`${repo} is not a git repository. Set SHIP_REPO to a git checkout.`);
  const mainBranch = process.env.SHIP_MAIN || await currentBranch(repo);

  let kitchen, pending = null, arrivals = [];
  const broadcast = () => {
    const msg = JSON.stringify({ type: 'state', state: kitchen.snapshot() });
    for (const c of wss.clients) if (c.readyState === 1) c.send(msg);
  };
  const openKitchen = async () => {
    const k = new Kitchen({
      repo, dataDir, mainBranch,
      driver: crew.driver,
      testCmd: process.env.SHIP_TEST_CMD || 'npm test',
      model: process.env.SHIP_MODEL || 'claude-opus-5-5',
      chefs: crew.chefs,
      pace: PACE,
      ...(DEMO ? { focusMin: 3, breakMin: 1, grace: DEMO_GRACE, restart: RESTART } : {}),
    });
    await k.init();
    k.on('change', () => { if (!pending) pending = setTimeout(() => { pending = null; broadcast(); }, 120); });
    return k;
  };
  kitchen = await openKitchen();
  if (DEMO) {
    // The customers walk up once somebody is watching: the clock starts at the first page load, not at server start.
    let open = false;
    firstContact = () => {
      if (open) return;
      open = true;
      arrivals = seatCustomers(kitchen);
    };
    // "Play again": the demo repo is rebuilt from the example and the customers walk up again from the start.
    let restarting = null;
    LOCAL.restart = () => (restarting ||= (async () => {
      arrivals.forEach(clearTimeout);
      for (const c of wss.clients) if (c.readyState === 1) c.send(JSON.stringify({ type: 'fresh' }));
      await kitchen.close();
      await freshDemoDir();
      await ensureDemoRepo(repo);
      kitchen = await openKitchen();
      arrivals = open ? seatCustomers(kitchen) : [];
      broadcast();
    })().finally(() => { restarting = null; }));
  } else if (seeded || (!repoArg && kitchen.orders.length === 0)) {
    for (const o of STARTER_ORDERS) kitchen.addOrder(o);
  }

  const server = http.createServer((req, res) => handle(kitchen, req, res).catch(e => send(res, 500, { error: e.message })));
  const wss = new WebSocketServer({ server, path: '/ws' });
  wss.on('connection', (ws, req) => {
    if (!sameOrigin(req)) return ws.close(1008, 'Wrong origin');
    firstContact();
    ws.send(JSON.stringify({ type: 'state', state: kitchen.snapshot() }));
  });

  server.listen(PORT, HOST, () => {
    console.log(`Ship Shift kitchen open at http://${HOST}:${PORT}`);
    console.log(`  repo:   ${repo} (${mainBranch})`);
    const real = kitchen.chefs.filter(c => c.driver === realDriver), sim = kitchen.chefs.filter(c => c.driver !== realDriver);
    if (real.length) console.log(`  chefs:  Claude Agent SDK: ${real.map(c => `${c.name} (${c.model})`).join(', ')}`);
    if (sim.length) console.log(`  chefs:  simulated, free: ${sim.map(c => c.name).join(', ')}`);
    if (PACE !== 1) console.log(`  pace:   ${PACE}x (ticket targets and blocked-chef timers run ${PACE} times faster)`);
    if (DEMO) console.log('  demo:   a fresh repo each start; orders walk up once the page opens; start the 3 minute shift when you are ready');
  });
}

let firstContact = () => {};

function sameOrigin(req) {
  const o = req.headers.origin;
  return !o || o === `http://${HOST}:${PORT}` || o === `http://localhost:${PORT}`;
}

function send(res, code, body) {
  res.writeHead(code, { 'content-type': 'application/json', 'cache-control': 'no-store' });
  res.end(JSON.stringify(body));
}

async function body(req) {
  let data = '';
  for await (const chunk of req) { data += chunk; if (data.length > 1e6) throw new Error('Body too large'); }
  return data ? JSON.parse(data) : {};
}

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.ico': 'image/x-icon',
  '.woff2': 'font/woff2', '.woff': 'font/woff', '.ttf': 'font/ttf', '.wasm': 'application/wasm',
};
const THREE = path.join(root, 'node_modules', 'three');
// Longest prefix first: /vendor/addons/ is three's examples/jsm, the rest of /vendor/ is three's build.
const STATIC = [['/vendor/addons/', path.join(THREE, 'examples', 'jsm')], ['/vendor/', path.join(THREE, 'build')], ['/', path.join(root, 'public')]];

async function serveStatic(p, res, cache = 'no-store') {
  const [prefix, base] = STATIC.find(([pre]) => p.startsWith(pre));
  let rel;
  try { rel = decodeURIComponent(p.slice(prefix.length)) || 'index.html'; } catch { return send(res, 404, { error: 'Not found' }); }
  const file = path.join(base, path.normalize(rel).replace(/^([/\\])+/, ''));
  if (!file.startsWith(base + path.sep)) return send(res, 404, { error: 'Not found' });
  try {
    const data = await fs.readFile(file);
    res.writeHead(200, { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream', 'cache-control': cache });
    return res.end(data);
  } catch { return send(res, 404, { error: 'Not found' }); }
}

/** How the one kitchen on this machine answers. A public session passes its own: see sessionContext(). */
const LOCAL = { open: () => firstContact(), sameOrigin, send, body, check: null, restart: null };

async function handle(k, req, res, ctx = LOCAL) {
  const { send, sameOrigin } = ctx;
  const url = new URL(req.url, `http://${HOST}`);
  const p = url.pathname;

  if (!p.startsWith('/api/')) return serveStatic(p, res);

  if (req.method === 'GET' && p === '/api/state') { ctx.open(); return send(res, 200, k.snapshot()); }
  let m;
  if (req.method === 'GET' && (m = p.match(/^\/api\/orders\/(\d+)\/diff$/))) return send(res, 200, await k.diff(m[1]));
  if (req.method === 'GET' && (m = p.match(/^\/api\/orders\/(\d+)\/wip$/))) return send(res, 200, await k.wip(m[1]));

  // Letting a chef go is also DELETE /api/chefs/:id. It has no body, so only the origin is checked.
  if (req.method === 'DELETE' && (m = p.match(/^\/api\/chefs\/([\w-]{1,32})$/))) {
    if (!sameOrigin(req)) return send(res, 403, { error: 'Requests must come from the kitchen page' });
    try { const chef = k.dismissChef(m[1]); ctx.staffed?.(chef); return send(res, 200, { ok: true, chef: { id: chef.id, name: chef.name } }); }
    catch (e) { return send(res, e.status || 400, { error: e.message, ...(e.code ? { code: e.code } : {}) }); }
  }
  if (req.method !== 'POST') return send(res, 405, { error: 'Method not allowed' });
  if (!sameOrigin(req) || !(req.headers['content-type'] || '').includes('application/json')) return send(res, 403, { error: 'Requests must come from the kitchen page' });
  const b = await ctx.body(req);
  const refused = ctx.check?.(p, b);
  if (refused) return send(res, refused.code, { error: refused.error });
  try {
    if (p === RESTART && ctx.restart) { await ctx.restart(); return send(res, 200, { ok: true }); }
    if (p === '/api/orders') return send(res, 200, k.addOrder(b));
    if (p === '/api/chefs') { const chef = k.hireChef({ rank: b.rank, name: b.name }); ctx.staffed?.(chef); return send(res, 200, { ok: true, chef: { id: chef.id, name: chef.name, rank: chef.rank } }); }
    if ((m = p.match(/^\/api\/chefs\/([\w-]{1,32})\/rank$/))) { const chef = k.rankChef(m[1], b.rank); ctx.staffed?.(chef); return send(res, 200, { ok: true, chef: { id: chef.id, name: chef.name, rank: chef.rank } }); }
    if ((m = p.match(/^\/api\/chefs\/([\w-]{1,32})\/dismiss$/))) { const chef = k.dismissChef(m[1]); ctx.staffed?.(chef); return send(res, 200, { ok: true, chef: { id: chef.id, name: chef.name } }); }
    if ((m = p.match(/^\/api\/chefs\/([\w-]{1,32})$/))) { const chef = k.renameChef(m[1], b.name); ctx.renamed?.(chef); return send(res, 200, { ok: true, chef: { id: chef.id, name: chef.name } }); }
    if ((m = p.match(/^\/api\/orders\/(\d+)\/plan$/))) { k.planOrder(m[1]).catch(e => console.error(e)); return send(res, 202, { ok: true }); }
    if ((m = p.match(/^\/api\/orders\/(\d+)\/assign$/))) { await k.assign(m[1], b.chefId); return send(res, 202, { ok: true }); }
    if ((m = p.match(/^\/api\/orders\/(\d+)\/review$/))) { await k.review(m[1], b); return send(res, 200, { ok: true }); }
    if ((m = p.match(/^\/api\/orders\/(\d+)\/ship$/))) return send(res, 200, { ok: true, ...(await k.ship(m[1], b)) });
    if ((m = p.match(/^\/api\/orders\/(\d+)\/steer$/))) { await k.steer(m[1], b.note); return send(res, 202, { ok: true }); }
    if (p === '/api/grants') { k.grant(b.cls, b.orderId); return send(res, 200, { ok: true, grants: [...k.grants] }); }
    if (p === '/api/rules') { k.setRules(b); return send(res, 200, { ok: true, rules: k.rules }); }
    if ((m = p.match(/^\/api\/orders\/(\d+)\/resume$/))) { await k.resume(m[1]); return send(res, 202, { ok: true }); }
    if ((m = p.match(/^\/api\/orders\/(\d+)\/bin$/))) { await k.bin(m[1]); return send(res, 200, { ok: true }); }
    if ((m = p.match(/^\/api\/questions\/([\w-]+)\/answer$/))) { k.answer(m[1], b); return send(res, 200, { ok: true }); }
    if (p === '/api/shift/start') { k.startShift(b); return send(res, 200, { ok: true }); }
    if (p === '/api/shift/stop') { k.stopShift(); return send(res, 200, { ok: true }); }
  } catch (e) {
    return send(res, e.status || 400, { error: e.message, ...(e.code ? { code: e.code } : {}) });
  }
  return send(res, 404, { error: 'Not found' });
}

/* ---------- public mode: a private demo kitchen per visitor ---------- */

const MAX_BODY = 16 * 1024;          // the largest request a visitor may send
const ORDERS_PER_MIN = 6;            // new orders per kitchen per minute
const OPEN_ORDERS = 20, ALL_ORDERS = 60;
const REQUESTS_PER_MIN = 300;        // API calls per kitchen per minute
const SOCKETS = 6;                   // open tabs per kitchen

/** Reads a small JSON body. An oversized one is drained and refused, so the visitor gets an answer and not a dropped connection. */
function smallBody(req) {
  return new Promise((resolve, reject) => {
    const tooLarge = () => Object.assign(new Error(`Requests are limited to ${MAX_BODY / 1024} KB`), { status: 413 });
    let data = '', size = 0, over = Number(req.headers['content-length']) > MAX_BODY;
    req.on('data', chunk => {
      size += chunk.length;
      if (size > MAX_BODY) over = true;
      if (size > 64 * MAX_BODY) { req.destroy(); return reject(tooLarge()); }
      if (!over) data += chunk;
    });
    req.on('end', () => { if (over) return reject(tooLarge()); try { resolve(data ? JSON.parse(data) : {}); } catch { reject(Object.assign(new Error('The request body is not JSON'), { status: 400 })); } });
    req.on('error', reject);
  });
}

/**
 * Tidies everything a visitor typed before it reaches a kitchen: no control characters, bounded lengths, bounded nesting.
 * "git merge" is broken up because a simulated chef reads the branch to merge out of its prompt.
 */
function tidy(v, depth = 0) {
  if (typeof v === 'string') return v.replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, ' ').replace(/git\s+merge/gi, 'git-merge').slice(0, 4000);
  if (v === null || typeof v !== 'object') return v;
  if (depth >= 4) return null;
  if (Array.isArray(v)) return v.slice(0, 20).map(x => tidy(x, depth + 1));
  return Object.fromEntries(Object.entries(v).slice(0, 20).map(([k, x]) => [k.slice(0, 300), tidy(x, depth + 1)]));
}

async function mainPublic() {
  // The presenter's reset token is read once and then forgotten by the environment, so nothing a kitchen starts can inherit it.
  const givenToken = String(process.env.SHIP_RESET_TOKEN || '');
  delete process.env.SHIP_RESET_TOKEN;
  const resetToken = givenToken.length >= 8 ? givenToken : crypto.randomBytes(9).toString('base64url');
  // Nothing a public kitchen starts (test runs, git) inherits the owner's Claude credentials.
  // With SHIP_PUBLIC_API=1 and a key, the chefs get a voice: Claude Haiku writes their chatter and rephrases their summaries.
  // The simulated chef still does every edit, test run and merge. The model has no tools, and its words are only displayed.
  // The key is held here and nowhere else. It is taken out of the environment with the rest, so no test run can read it.
  const apiKey = process.env.SHIP_PUBLIC_API === '1' ? String(process.env.ANTHROPIC_API_KEY || '').trim() : '';
  const apiBase = process.env.ANTHROPIC_BASE_URL || '';
  for (const key of Object.keys(process.env)) if (/^(ANTHROPIC_|CLAUDE_)/i.test(key)) delete process.env[key];
  const dollars = (v, d) => (Number(v) >= 0 && v !== undefined && v !== '' ? Number(v) : d);
  const apiChefs = apiKey ? apiKitchens({
    apiKey, baseURL: apiBase, lineEveryMs: Number(process.env.SHIP_VOICE_EVERY_S) >= 0 && process.env.SHIP_VOICE_EVERY_S ? Number(process.env.SHIP_VOICE_EVERY_S) * 1000 : undefined,
    budgetUsd: dollars(process.env.SHIP_BUDGET_USD, 100), kitchenBudgetUsd: dollars(process.env.SHIP_KITCHEN_BUDGET_USD, 1.5), orderBudgetUsd: dollars(process.env.SHIP_ORDER_BUDGET_USD, 0.4),
  }) : null;
  if (apiChefs) await apiChefs.ready;

  const sessionsDir = path.resolve(process.env.SHIP_SESSIONS_DIR || path.join(root, '.kitchen', 'sessions'));
  // A town has 24 plots, so it never opens more kitchens than that.
  const asked = Number(process.env.SHIP_MAX_SESSIONS) > 0 ? Math.floor(Number(process.env.SHIP_MAX_SESSIONS)) : WORLD ? 24 : 25;
  const max = WORLD ? Math.min(asked, 24) : asked;
  const idleMin = Number(process.env.SHIP_IDLE_MIN) > 0 ? Number(process.env.SHIP_IDLE_MIN) : 20;
  const origins = list(process.env.SHIP_PUBLIC_ORIGIN).map(o => o.replace(/\/+$/, ''));
  const townFile = path.resolve(process.env.SHIP_TOWN_FILE || path.join(root, '.kitchen', 'town.json'));
  const scrub = scrubber(sessionsDir, root);
  const crew = staff();
  const seconds = (v, d) => (Number(v) > 0 ? Number(v) : d) * 1000;

  /** A request may come from the page it was served to: the Origin's host is the Host the visitor asked for, or SHIP_PUBLIC_ORIGIN. */
  const ownOrigin = req => {
    const o = req.headers.origin;
    if (!o) return true;
    if (origins.includes(o)) return true;
    try { return new URL(o).host === req.headers.host; } catch { return false; }
  };
  const sendJson = (res, code, body) => {
    res.writeHead(code, { 'content-type': 'application/json', 'cache-control': 'no-store' });
    res.end(scrub(JSON.stringify(body)));
  };

  /* ---------- the town ---------- */

  let world = null;
  const byPid = new Map();           // pid -> session, for the town's fan-out
  const openSockets = s => [...s.sockets].filter(c => c.readyState === 1);
  const toSession = (s, msg) => { for (const c of openSockets(s)) c.send(msg); };

  /** Sends everyone the town, each with their own `you`. The snapshot is built and serialised once. */
  let worldPending = null;
  const pushWorld = () => {
    worldPending = null;
    const rest = JSON.stringify(world.snapshot()).slice(1);
    for (const s of byPid.values()) {
      if (!s.sockets.size || s.world !== world) continue;
      toSession(s, `{"type":"world","world":{"you":${JSON.stringify(world.you(s.pid))},${rest}}`);
    }
  };
  const newWorld = () => {
    const w = new World({
      dishes: STARTER_ORDERS, arrivalsMs: DEMO_ARRIVALS_S.map(t => t * 1000 * DEMO_PACE / PACE), teams: process.env.SHIP_TEAMS,
      rushMs: seconds(process.env.SHIP_RUSH_S, 90), bellMs: seconds(process.env.SHIP_BELL_S, 180),
    });
    w.on('change', () => { if (w === world) worldPending ||= setTimeout(pushWorld, 250); });
    w.on('moved', (pid, where) => {
      const s = byPid.get(pid);
      if (s) toSession(s, JSON.stringify({ type: 'zone', ...where }));
    });
    const bots = Math.min(200, Math.floor(Number(process.env.SHIP_WORLD_BOTS)) || 0);
    if (bots > 0) w.addBots(bots);
    return w;
  };
  if (WORLD) world = newWorld();

  /** What the town may do to one kitchen. This is the whole link; a real team host would speak it over a socket. */
  const linkFor = kitchen => ({
    summary: () => kitchen.summary(),
    admit: card => kitchen.addOrder({ title: card.title, body: card.body, size: card.size, cardId: card.id }).id,
    withdraw: id => { kitchen.withdraw(id); },
    has: title => kitchen.has(title),
  });

  /** The kitchen as its owner sees it, and as a visitor does: no repo, and no command a chef asked to run. */
  const ownState = s => scrub(JSON.stringify({
    type: 'state', state: s.kitchen.snapshot(),
    ...(WORLD && s.pid ? { of: world.you(s.pid).plot, relation: 'owner', rights: world.rights(s.pid, world.you(s.pid).plot).rights } : {}),
  }));
  const visitorSnapshot = s => {
    const { repo: _repo, ...state } = s.kitchen.snapshot();
    return { ...state, questions: state.questions.map(({ input: _input, ...q }) => q) };
  };
  const visitorState = (owner, visitor) => scrub(JSON.stringify({ type: 'state', state: visitorSnapshot(owner), of: world.you(owner.pid).plot, ...world.rights(visitor.pid, world.you(owner.pid).plot) }));
  /** The sessions standing in this owner's kitchen as visitors. */
  const visitorsOf = owner => {
    const zone = `k:${world.you(owner.pid).plot}`;
    return [...byPid.values()].filter(v => v !== owner && v.world === world && world.players.get(v.pid)?.zone === zone);
  };
  const pushState = s => {
    if (!s.kitchen || s.kitchen.closed || (WORLD && s.world !== world)) return;
    if (s.sockets.size) toSession(s, ownState(s));
    if (WORLD && s.pid && s.world === world) for (const v of visitorsOf(s)) if (v.sockets.size) toSession(v, visitorState(s, v));
  };
  /** A door sign or a team changed, so what each visitor may do changed with it. */
  const pushVisitors = () => { for (const s of byPid.values()) if (s.world === world && s.kitchen && !s.kitchen.closed) for (const v of visitorsOf(s)) toSession(v, visitorState(s, v)); };

  const sessions = new Sessions({
    dir: sessionsDir, max, idleMs: idleMin * 60_000,
    onEnd: s => {
      if (!s.pid) return;
      if (byPid.get(s.pid) === s) byPid.delete(s.pid);
      s.world?.leave(s.pid);
    },
    build: async (dir, s) => {
      const repo = path.join(dir, 'repo');
      await ensureDemoRepo(repo);
      // One API driver per visitor, kept across a fresh kitchen, so starting over does not refill the kitchen's budget.
      const apiDriver = apiChefs?.enabled() ? (s.apiDriver ||= apiChefs.forKitchen()) : null;
      apiDriver?.forget();
      const kitchen = new Kitchen({
        repo, dataDir: path.join(dir, 'data'), mainBranch: await currentBranch(repo),
        driver: apiDriver || crew.driver, chefs: crew.chefs.map(c => ({ ...c, driver: apiDriver || c.driver })), testCmd: 'npm test', model: 'claude-opus-5-5',
        ...(apiDriver ? { budget: () => apiDriver.budget() } : {}),
        pace: PACE, focusMin: 3, breakMin: 1, grace: DEMO_GRACE, restart: RESTART, hireCost: HIRE_COST,
      });
      // Never the Agent SDK: a public kitchen's chefs are simulated, with or without a voice from the API.
      if (![kitchen.driver, kitchen.hireDriver, ...kitchen.chefs.map(c => c.driver)].every(d => d === simDriver || (apiDriver && d === apiDriver))) throw new Error('A public kitchen may only have simulated or API chefs');
      await kitchen.init();
      let timers = [], open = false, pending = null;
      kitchen.on('change', () => {
        if (pending) return;
        pending = setTimeout(() => {
          pending = null;
          if (kitchen.closed || s.kitchen !== kitchen) return;
          if (WORLD && s.pid) s.world.kitchenChanged(s.pid);
          pushState(s);
        }, 120);
      });
      if (WORLD) {
        const link = linkFor(kitchen);
        if (s.pid && s.world === world) world.refresh(s.pid, link);   // a fresh kitchen on the same plot
        else {
          const player = world.join({ link });
          if (!player) throw new Error('The town is full');
          s.pid = player.pid; s.world = world;
          byPid.set(s.pid, s);
        }
      }
      return {
        kitchen,
        // In a town the customers come from the park. Otherwise they walk up once the visitor is watching.
        openDoors: () => { if (!open && !WORLD) { open = true; timers = seatCustomers(kitchen); } },
        stop: async () => { timers.forEach(clearTimeout); clearTimeout(pending); await kitchen.close(); },
      };
    },
  });
  await sessions.init();

  /** "Fresh kitchen" and "Play again": this visitor's repo is rebuilt and their customers start over. In a town they keep their plot. */
  const restart = async s => {
    if (!allow(s.restarts ||= [], 3, 60_000)) throw Object.assign(new Error('Three fresh kitchens a minute is the limit. Give it a moment.'), { status: 429, code: 'cooldown' });
    if (WORLD) world.unlink(s.pid);
    toSession(s, JSON.stringify({ type: 'fresh' }));
    await sessions.rebuild(s);
    if (s.sockets.size) s.openDoors();
    pushState(s);
  };

  /** How one visitor's kitchen answers: its own doors, the public origin rule, small bodies, and limits on new orders. */
  const sessionContext = s => ({
    open: () => s.openDoors(), sameOrigin: ownOrigin, send: sendJson, body: smallBody,
    restart: () => restart(s),
    // The town hears about a hire, a change of rank and a chef let go.
    staffed: chef => { if (WORLD && s.pid && s.world === world && chef.note) world.note(`${world.you(s.pid).name} ${chef.note}`); },
    // The town hears about a renamed chef too.
    renamed: chef => { if (WORLD && s.pid && s.world === world && chef.was !== chef.name) world.note(`${world.you(s.pid).name}'s chef ${chef.was} is now ${chef.name}`); },
    check: (p, b) => {
      for (const [k, v] of Object.entries(b)) b[k] = tidy(v);
      if (p !== '/api/orders') return null;
      if (typeof b.title === 'string') b.title = b.title.replace(/\s+/g, ' ');
      const orders = s.kitchen.orders;
      if (orders.length >= ALL_ORDERS || orders.filter(o => !['shipped', 'binned'].includes(o.state)).length >= OPEN_ORDERS) return { code: 429, error: 'The rail is full. Ship or bin a ticket before you take another order.' };
      if (!allow(s.orders, ORDERS_PER_MIN, 60_000)) return { code: 429, error: 'Too many new orders at once. Give the kitchen a minute.' };
      return null;
    },
  });

  /* ---------- the town's routes ---------- */

  const refuse = (res, e) => sendJson(res, e.status || 400, { error: e.message, code: e.code || 'bad' });
  const fromPage = req => ownOrigin(req) && (req.headers['content-type'] || '').includes('application/json');
  const plotId = v => (Number.isInteger(v) ? v : typeof v === 'string' && /^\d{1,2}$/.test(v) ? Number(v) : v === null || v === undefined ? null : NaN);

  /** The presenter's reset: every kitchen closes, every repo is deleted, and a new town opens. Every client is told to reload. */
  const resetTries = [];
  const sameToken = given => {
    const a = crypto.createHash('sha256').update(String(given)).digest(), b = crypto.createHash('sha256').update(resetToken).digest();
    return typeof given === 'string' && crypto.timingSafeEqual(a, b);
  };
  const resetTown = async () => {
    const old = [...sessions.live.values()];
    clearTimeout(worldPending); worldPending = null;
    world = newWorld();
    byPid.clear();
    const told = JSON.stringify({ type: 'reset' });
    for (const s of old) for (const c of s.sockets) { if (c.readyState === 1) c.send(told); c.close(4002, 'Town reset'); }
    await Promise.all(old.map(s => sessions.end(s)));
    console.log(`  reset:    the town was reset; ${old.length} kitchen${old.length === 1 ? '' : 's'} closed`);
    return old.length;
  };

  /** Answers a town route, or returns false when the path is not one. Every route acts as the caller's own player. */
  const townRoute = async (s, req, res, p) => {
    const pid = s.pid, get = req.method === 'GET';
    let m;
    const bounce = p.match(/^\/api\/orders\/(\d+)\/bounce$/);
    if (!p.startsWith('/api/world') && !bounce) return false;
    try {
      if (get && p === '/api/world') return sendJson(res, 200, { you: world.you(pid), ...world.snapshot() });
      const kitchenOf = id => {
        const owner = byPid.get(world.lived(plotId(id)).owner);
        if (!owner?.kitchen || owner.kitchen.closed) throw Object.assign(new Error('That kitchen is closed.'), { status: 404, code: 'gone' });
        return owner;
      };
      if (get && (m = p.match(/^\/api\/world\/kitchens\/(\d{1,2})$/))) {
        const owner = kitchenOf(m[1]);
        world.allowed(pid, Number(m[1]), 'watch');
        return sendJson(res, 200, { of: Number(m[1]), ...world.rights(pid, Number(m[1])), state: owner === s ? s.kitchen.snapshot() : visitorSnapshot(owner) });
      }
      if (get && (m = p.match(/^\/api\/world\/kitchens\/(\d{1,2})\/orders\/(\d+)\/diff$/))) {
        const owner = kitchenOf(m[1]);
        world.allowed(pid, Number(m[1]), 'approve');
        return sendJson(res, 200, await owner.kitchen.diff(m[2]));
      }
      if (req.method !== 'POST') return sendJson(res, 405, { error: 'Method not allowed' });
      if (!fromPage(req)) return sendJson(res, 403, { error: 'Requests must come from the kitchen page' });
      const b = await smallBody(req);
      for (const [k, v] of Object.entries(b)) b[k] = tidy(v);

      if (bounce) return sendJson(res, 200, { ok: true, card: world.bounce(pid, Number(bounce[1]), plotId(b.plot)) });
      if (p === '/api/world/me') { const you = world.setMe(pid, { name: b.name, look: b.look, team: b.team }); pushVisitors(); pushState(s); return sendJson(res, 200, { ok: true, you }); }
      if ((m = p.match(/^\/api\/world\/cards\/([\w-]{1,12})\/(take|put|send|accept|decline)$/))) {
        const [, id, verb] = m;
        const card = verb === 'take' ? world.take(pid, id) : verb === 'put' ? world.put(pid, id, plotId(b.plot)) : verb === 'send' ? world.send(pid, id, plotId(b.plot)) : verb === 'accept' ? world.accept(pid, id) : world.decline(pid, id);
        return sendJson(res, 200, { ok: true, card });
      }
      if (p === '/api/world/sign') { const sign = world.setSign(pid, b.sign); pushVisitors(); return sendJson(res, 200, { ok: true, sign }); }
      if (p === '/api/world/cheer') return sendJson(res, 200, { ok: true, bonus: world.cheer(pid, plotId(b.plot)) });
      if (p === '/api/world/bell') return sendJson(res, 200, { ok: true, rush: world.ring(pid) });
      if ((m = p.match(/^\/api\/world\/kitchens\/(\d{1,2})\/questions\/([\w-]+)\/answer$/))) {
        const owner = kitchenOf(m[1]);
        world.allowed(pid, Number(m[1]), 'answer');
        if (!owner.kitchen.questions.some(q => q.id === m[2])) throw Object.assign(new Error('That question is already answered.'), { status: 404, code: 'gone' });
        // A visitor answers this one question. "Always" is a grant, and grants are the owner's.
        owner.kitchen.answer(m[2], { allow: b.allow !== false, message: typeof b.message === 'string' ? b.message : '', answers: b.answers && typeof b.answers === 'object' ? b.answers : {}, always: false });
        if (owner !== s) world.note(`${world.you(pid).name} answered a question in ${world.you(owner.pid).name}'s kitchen`);
        return sendJson(res, 200, { ok: true });
      }
      if ((m = p.match(/^\/api\/world\/kitchens\/(\d{1,2})\/orders\/(\d+)\/review$/))) {
        const owner = kitchenOf(m[1]);
        world.allowed(pid, Number(m[1]), 'approve');
        if (b.verdict !== 'approve') throw Object.assign(new Error('A visitor can approve a plate. Only the owner sends one back.'), { status: 403, code: 'owner' });
        try { await owner.kitchen.review(m[2], { verdict: 'approve' }); } catch (e) { throw Object.assign(new Error(e.message), { status: 409, code: 'locked' }); }
        if (owner !== s) world.note(`${world.you(pid).name} approved a plate in ${world.you(owner.pid).name}'s kitchen`);
        return sendJson(res, 200, { ok: true });
      }
    } catch (e) {
      if (e.status === 413 || (!e.code && !e.status)) throw e;
      return refuse(res, e);
    }
    return sendJson(res, 404, { error: 'Not found', code: 'gone' });
  };

  const FULL = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta http-equiv="refresh" content="20"><title>Ship Shift: the kitchen is full</title>
<style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#2b2233;color:#fff1dc;font:18px/1.5 system-ui,sans-serif;text-align:center}main{max-width:30rem;padding:2rem}h1{font-size:2rem;margin:0 0 .5rem}p{margin:.5rem 0;opacity:.9}a{color:#ffd27a}</style></head>
<body><main><h1>The kitchen is full</h1><p>All ${max} kitchens are taken right now. Try again shortly.</p><p>This page tries again by itself every 20 seconds, or you can <a href="">try now</a>.</p></main></body></html>`;

  const handlePublic = async (req, res) => {
    let p;
    try { p = new URL(req.url, 'http://kitchen').pathname; } catch { return sendJson(res, 400, { error: 'Bad request' }); }
    if (p === '/healthz') return sendJson(res, 200, { ok: true, kitchens: sessions.size, max, ...(apiChefs?.enabled() ? { api: true, budgetLeft: Math.round(apiChefs.left() * 100) / 100 } : {}), ...(WORLD ? { players: world.players.size, world: true } : {}) });
    // The reset needs the presenter's token and no kitchen, so `npm run reset` can call it from a terminal.
    if (WORLD && p === '/api/world/reset') {
      if (req.method !== 'POST') return sendJson(res, 405, { error: 'Method not allowed' });
      if (!fromPage(req)) return sendJson(res, 403, { error: 'Requests must come from the kitchen page' });
      if (!allow(resetTries, 10, 60_000)) return sendJson(res, 429, { error: 'Too many reset attempts. Wait a minute.', code: 'cooldown' });
      const b = await smallBody(req);
      if (!sameToken(b.token)) return sendJson(res, 403, { error: 'That is not the presenter\'s reset token.', code: 'token' });
      return sendJson(res, 200, { ok: true, closed: await resetTown() });
    }
    const api = p.startsWith('/api/');
    const page = !api && req.method === 'GET' && (p === '/' || p.endsWith('.html'));
    // Scripts, styles, fonts and three.js are the same for everyone, so they need no kitchen.
    if (!api && !page) return serveStatic(p, res, p.startsWith('/vendor/') || p.startsWith('/fonts/') ? 'public, max-age=3600' : 'no-cache');

    let s = sessions.find(sessionIdFrom(req));
    if (!s && page) {
      s = sessions.open();
      if (!s) {
        res.writeHead(503, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'retry-after': '20' });
        return res.end(FULL);
      }
      res.setHeader('set-cookie', sessionCookie(s.id, String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim() === 'https'));
    }
    if (!s) return sendJson(res, 401, { error: 'This kitchen has closed. Reload the page for a fresh one.' });
    await s.ready;
    if (page) return serveStatic(p, res, 'no-store');
    if (!allow(s.requests, REQUESTS_PER_MIN, 60_000)) return sendJson(res, 429, { error: 'Too many requests. Slow down a little.' });
    if (WORLD && await townRoute(s, req, res, p) !== false) return;
    return handle(s.kitchen, req, res, s.ctx ||= sessionContext(s));
  };

  const server = http.createServer((req, res) => handlePublic(req, res).catch(e => {
    if (res.headersSent) return res.destroy();
    const code = e.status || 500;
    if (code === 500) console.error(e);
    if (code === 413) res.setHeader('connection', 'close');
    sendJson(res, code, { error: code === 500 ? 'The kitchen dropped that one. Try again.' : e.message, ...(e.code ? { code: e.code } : {}) });
  }));
  server.requestTimeout = 30_000;

  /** One message from a player's socket: where they are, where they are going, or a wave. Anything else is ignored. */
  const WS_PER_S = 30;
  const onMessage = (s, ws, data) => {
    if (!allow(ws.stamps ||= [], WS_PER_S, 1000)) return;
    if (s.world !== world || !s.pid) return;
    let msg;
    try { msg = JSON.parse(data); } catch { return; }
    if (!msg || typeof msg !== 'object') return;
    s.lastSeen = Date.now();
    if (msg.t === 'p') return world.move(s.pid, msg.x, msg.z, msg.r, msg.m);
    if (msg.t === 'emote') return world.emote(s.pid, msg.e);
    if (msg.t === 'say') return world.phrase(s.pid, msg.q);
    if (msg.t === 'go') {
      const where = world.go(s.pid, msg.z);
      toSession(s, JSON.stringify({ type: 'zone', ...where }));
      const m = !where.refused && where.zone.match(/^k:(\d+)$/), owner = m && byPid.get(world.plots[Number(m[1])].owner);
      if (owner && owner !== s && owner.kitchen && !owner.kitchen.closed) toSession(s, visitorState(owner, s));
    }
  };

  const wss = new WebSocketServer({ noServer: true, maxPayload: 4096 });
  server.on('upgrade', (req, socket, head) => {
    const refuse = (code, text) => { socket.end(`HTTP/1.1 ${code} ${text}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`); };
    socket.on('error', () => {});
    let p = '';
    try { p = new URL(req.url, 'http://kitchen').pathname; } catch { /* refused below */ }
    if (p !== '/ws') return refuse(404, 'Not Found');
    if (!ownOrigin(req)) return refuse(403, 'Forbidden');
    const s = sessions.find(sessionIdFrom(req));
    if (!s) return refuse(401, 'Unauthorized');
    if (s.sockets.size >= SOCKETS) return refuse(429, 'Too Many Requests');
    wss.handleUpgrade(req, socket, head, async ws => {
      ws.on('error', () => {});
      try { await s.ready; } catch { return ws.close(1011, 'Kitchen failed to open'); }
      if (sessions.find(s.id) !== s) return ws.close(4001, 'Kitchen closed');
      s.sockets.add(ws);
      ws.on('close', () => s.sockets.delete(ws));
      s.openDoors();
      if (ws.readyState !== 1) return;
      ws.send(ownState(s));
      if (!WORLD) return;
      ws.send(JSON.stringify({ type: 'world', world: { you: world.you(s.pid), ...world.snapshot() } }));
      // A tab opened while its player stands in somebody else's kitchen sees that kitchen too.
      const m = world.you(s.pid).zone.match(/^k:(\d+)$/), owner = m && byPid.get(world.plots[Number(m[1])].owner);
      if (owner && owner !== s && owner.kitchen && !owner.kitchen.closed) ws.send(visitorState(owner, s));
      ws.on('message', data => { try { onMessage(s, ws, data); } catch (e) { console.error('A town message failed:', e.message); } });
    });
  });

  // The town's clock: 12 times a second every zone hears about the players in it that moved, and every 2 s about all of them.
  let ticks = 0;
  const ticker = WORLD ? setInterval(() => {
    world.tick();
    const frame = world.frame(++ticks % 24 === 0);
    if (!frame.size) return;
    const msgs = new Map();
    for (const s of byPid.values()) {
      if (!s.sockets.size || s.world !== world) continue;
      const zone = world.players.get(s.pid)?.zone, ps = frame.get(zone);
      if (!ps) continue;
      if (!msgs.has(zone)) msgs.set(zone, JSON.stringify({ type: 'p', z: zone, ps }));
      toSession(s, msgs.get(zone));
    }
  }, 1000 / 12) : null;

  let closing = false;
  const shutdown = () => {
    if (closing) return;
    closing = true;
    clearInterval(ticker);
    setTimeout(() => process.exit(0), 8000).unref();
    server.close();
    for (const c of wss.clients) c.terminate();
    Promise.all([sessions.closeAll(), WORLD ? fs.rm(townFile, { force: true }).catch(() => {}) : null]).finally(() => process.exit(0));
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(PORT, HOST, resolve); });
  if (WORLD) {
    // Where `npm run reset` finds the running town. It is on the presenter's disk only: nothing serves this directory.
    await fs.mkdir(path.dirname(townFile), { recursive: true });
    await fs.writeFile(townFile, JSON.stringify({ port: PORT, host: HOST === '0.0.0.0' ? '127.0.0.1' : HOST, token: resetToken, pid: process.pid }) + '\n', { mode: 0o600 });
  }
  console.log(`Ship Shift public kitchen open on http://${HOST}:${PORT} (this machine: http://localhost:${PORT})`);
  console.log(`  each visitor gets a private kitchen with its own demo repo under ${sessionsDir}`);
  console.log(`  kitchens: at most ${max} at once, closed and deleted after ${idleMin} idle minute${idleMin === 1 ? '' : 's'}`);
  if (apiChefs?.enabled()) console.log(`  chefs:    simulated: ${crew.chefs.map(c => c.name).join(', ')}, with a voice from ${API_MODEL} (text only, no tools). Voice budget $${apiChefs.left().toFixed(2)} for the town; past a cap the chefs use their own words. Real agents are off in public mode`);
  else console.log(`  chefs:    simulated, free: ${crew.chefs.map(c => c.name).join(', ')}. Real agents are off in public mode, whatever the environment says`);
  console.log(`  pace:     ${PACE}x; ${WORLD ? 'customers arrive by bus in the park' : 'orders walk up once a visitor\'s page opens'}; the shift is 3 minutes`);
  if (WORLD) {
    console.log(`  town:     every kitchen opens onto one park, in ${world.teams.length} team${world.teams.length === 1 ? '' : 's'} (${world.teams.map(t => t.name).join(', ')}). SHIP_WORLD=0 turns it off`);
    console.log(`  reset:    \`npm run reset\` clears the whole town. Presenter's token for the in-page control: ${resetToken}`);
  }
  if (origins.length) console.log(`  origins:  the visitor's own Host, and ${origins.join(', ')}`);
}

(PUBLIC ? mainPublic() : main()).catch(e => { console.error(e.message); process.exit(1); });
