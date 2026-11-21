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
const DEMO_PACE = 8, DEMO_ARRIVALS_S = demoProject.DEMO_ARRIVALS_S || demoProject.ARRIVALS_S || [0, 10, 25, 45];

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

  const kitchen = new Kitchen({
    repo, dataDir, mainBranch,
    driver: crew.driver,
    testCmd: process.env.SHIP_TEST_CMD || 'npm test',
    model: process.env.SHIP_MODEL || 'claude-opus-5-5',
    chefs: crew.chefs,
    pace: PACE,
    ...(DEMO ? { focusMin: 3, breakMin: 1 } : {}),
  });
  await kitchen.init();
  if (DEMO) {
    // The customers walk up once somebody is watching: the clock starts at the first page load, not at server start.
    let open = false;
    firstContact = () => {
      if (open) return;
      open = true;
      seatCustomers(kitchen);
    };
  } else if (seeded || (!repoArg && kitchen.orders.length === 0)) {
    for (const o of STARTER_ORDERS) kitchen.addOrder(o);
  }

  const server = http.createServer((req, res) => handle(kitchen, req, res).catch(e => send(res, 500, { error: e.message })));
  const wss = new WebSocketServer({ server, path: '/ws' });
  const broadcast = () => {
    const msg = JSON.stringify({ type: 'state', state: kitchen.snapshot() });
    for (const c of wss.clients) if (c.readyState === 1) c.send(msg);
  };
  let pending = null;
  kitchen.on('change', () => { if (!pending) pending = setTimeout(() => { pending = null; broadcast(); }, 120); });
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
const LOCAL = { open: () => firstContact(), sameOrigin, send, body, check: null };

async function handle(k, req, res, ctx = LOCAL) {
  const { send, sameOrigin } = ctx;
  const url = new URL(req.url, `http://${HOST}`);
  const p = url.pathname;

  if (!p.startsWith('/api/')) return serveStatic(p, res);

  if (req.method === 'GET' && p === '/api/state') { ctx.open(); return send(res, 200, k.snapshot()); }
  let m;
  if (req.method === 'GET' && (m = p.match(/^\/api\/orders\/(\d+)\/diff$/))) return send(res, 200, await k.diff(m[1]));
  if (req.method === 'GET' && (m = p.match(/^\/api\/orders\/(\d+)\/wip$/))) return send(res, 200, await k.wip(m[1]));

  if (req.method !== 'POST') return send(res, 405, { error: 'Method not allowed' });
  if (!sameOrigin(req) || !(req.headers['content-type'] || '').includes('application/json')) return send(res, 403, { error: 'Requests must come from the kitchen page' });
  const b = await ctx.body(req);
  const refused = ctx.check?.(p, b);
  if (refused) return send(res, refused.code, { error: refused.error });
  try {
    if (p === '/api/orders') return send(res, 200, k.addOrder(b));
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
    return send(res, 400, { error: e.message });
  }
  return send(res, 404, { error: 'Not found' });
}

/* ---------- public mode: a private demo kitchen per visitor ---------- */

const MAX_BODY = 16 * 1024;          // the largest request a visitor may send
const ORDERS_PER_MIN = 6;            // new orders per kitchen per minute
const OPEN_ORDERS = 12, ALL_ORDERS = 60;
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
  // Nothing a public kitchen starts (test runs, git) inherits the owner's Claude credentials.
  for (const key of Object.keys(process.env)) if (/^(ANTHROPIC_|CLAUDE_)/i.test(key)) delete process.env[key];

  const sessionsDir = path.resolve(process.env.SHIP_SESSIONS_DIR || path.join(root, '.kitchen', 'sessions'));
  const max = Number(process.env.SHIP_MAX_SESSIONS) > 0 ? Math.floor(Number(process.env.SHIP_MAX_SESSIONS)) : 25;
  const idleMin = Number(process.env.SHIP_IDLE_MIN) > 0 ? Number(process.env.SHIP_IDLE_MIN) : 20;
  const origins = list(process.env.SHIP_PUBLIC_ORIGIN).map(o => o.replace(/\/+$/, ''));
  const scrub = scrubber(sessionsDir, root);
  const crew = staff();

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

  const sessions = new Sessions({
    dir: sessionsDir, max, idleMs: idleMin * 60_000,
    build: async dir => {
      const repo = path.join(dir, 'repo');
      await ensureDemoRepo(repo);
      const kitchen = new Kitchen({
        repo, dataDir: path.join(dir, 'data'), mainBranch: await currentBranch(repo),
        driver: crew.driver, chefs: crew.chefs, testCmd: 'npm test', model: 'claude-opus-5-5',
        pace: PACE, focusMin: 3, breakMin: 1,
      });
      if (kitchen.driver !== simDriver || kitchen.chefs.some(c => c.driver !== simDriver)) throw new Error('A public kitchen may only have simulated chefs');
      await kitchen.init();
      let timers = [], open = false, pending = null;
      const s = { kitchen, sockets: null };
      kitchen.on('change', () => {
        if (pending) return;
        pending = setTimeout(() => {
          pending = null;
          if (!s.sockets?.size) return;
          const msg = scrub(JSON.stringify({ type: 'state', state: kitchen.snapshot() }));
          for (const c of s.sockets) if (c.readyState === 1) c.send(msg);
        }, 120);
      });
      return {
        kitchen,
        watch: sockets => { s.sockets = sockets; },
        // The customers walk up once the visitor is watching.
        openDoors: () => { if (!open) { open = true; timers = seatCustomers(kitchen); } },
        stop: async () => { timers.forEach(clearTimeout); clearTimeout(pending); await kitchen.close(); },
      };
    },
  });
  await sessions.init();

  /** How one visitor's kitchen answers: its own doors, the public origin rule, small bodies, and limits on new orders. */
  const sessionContext = s => ({
    open: s.openDoors, sameOrigin: ownOrigin, send: sendJson, body: smallBody,
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

  const FULL = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta http-equiv="refresh" content="20"><title>Ship Shift: the kitchen is full</title>
<style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#2b2233;color:#fff1dc;font:18px/1.5 system-ui,sans-serif;text-align:center}main{max-width:30rem;padding:2rem}h1{font-size:2rem;margin:0 0 .5rem}p{margin:.5rem 0;opacity:.9}a{color:#ffd27a}</style></head>
<body><main><h1>The kitchen is full</h1><p>All ${max} kitchens are taken right now. Try again shortly.</p><p>This page tries again by itself every 20 seconds, or you can <a href="">try now</a>.</p></main></body></html>`;

  const handlePublic = async (req, res) => {
    let p;
    try { p = new URL(req.url, 'http://kitchen').pathname; } catch { return sendJson(res, 400, { error: 'Bad request' }); }
    if (p === '/healthz') return sendJson(res, 200, { ok: true, kitchens: sessions.size, max });
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
    return handle(s.kitchen, req, res, s.ctx ||= sessionContext(s));
  };

  const server = http.createServer((req, res) => handlePublic(req, res).catch(e => {
    if (res.headersSent) return res.destroy();
    const code = e.status || 500;
    if (code === 500) console.error(e);
    if (code === 413) res.setHeader('connection', 'close');
    sendJson(res, code, { error: code === 500 ? 'The kitchen dropped that one. Try again.' : e.message });
  }));
  server.requestTimeout = 30_000;

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
      s.watch(s.sockets);
      ws.on('close', () => s.sockets.delete(ws));
      s.openDoors();
      if (ws.readyState === 1) ws.send(scrub(JSON.stringify({ type: 'state', state: s.kitchen.snapshot() })));
    });
  });

  let closing = false;
  const shutdown = () => {
    if (closing) return;
    closing = true;
    setTimeout(() => process.exit(0), 8000).unref();
    server.close();
    for (const c of wss.clients) c.terminate();
    sessions.closeAll().finally(() => process.exit(0));
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(PORT, HOST, resolve); });
  console.log(`Ship Shift public kitchen open on http://${HOST}:${PORT} (this machine: http://localhost:${PORT})`);
  console.log(`  each visitor gets a private kitchen with its own demo repo under ${sessionsDir}`);
  console.log(`  kitchens: at most ${max} at once, closed and deleted after ${idleMin} idle minute${idleMin === 1 ? '' : 's'}`);
  console.log(`  chefs:    simulated, free: ${crew.chefs.map(c => c.name).join(', ')}. Real agents are off in public mode, whatever the environment says`);
  console.log(`  pace:     ${PACE}x; orders walk up once a visitor's page opens; the shift is 3 minutes`);
  if (origins.length) console.log(`  origins:  the visitor's own Host, and ${origins.join(', ')}`);
}

(PUBLIC ? mainPublic() : main()).catch(e => { console.error(e.message); process.exit(1); });
