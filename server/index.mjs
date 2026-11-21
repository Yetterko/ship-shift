import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import { Restaurant, DEMO_TIMINGS, REAL_TIMINGS } from './restaurant.mjs';
import { realDriver, simDriver } from './agents.mjs';
import { Budget } from './customers.mjs';
import { ensureProjectRepo, CUSTOMERS, PROJECT_NAME } from './projects/roster-cafe.mjs';
import { isRepo, currentBranch } from './git.mjs';
import { Sessions, sessionIdFrom, sessionCookie, allow, scrubber } from './sessions.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const PORT = Number(process.env.PORT || 4610);
const list = v => String(v || '').split(',').map(s => s.trim()).filter(Boolean);
const num = (v, d) => (Number(v) > 0 ? Number(v) : d);

// Public mode: every visitor gets a private restaurant of their own. See mainPublic().
const PUBLIC = process.argv.includes('--public') || process.env.SHIP_PUBLIC === '1';
const HOST = PUBLIC ? process.env.SHIP_HOST || '0.0.0.0' : '127.0.0.1';
// Demo mode: simulated chefs, the three minute shift, and a brand-new repo on every start.
const DEMO = process.argv.includes('--demo') || process.env.SHIP_DEMO === '1';
const SIM = PUBLIC || DEMO || process.env.SHIP_SIM === '1';

// Every agent runs on Claude Haiku unless the team says otherwise.
const MODEL = process.env.SHIP_MODEL || 'claude-haiku-5-5';
const CUSTOMER_MODEL = process.env.SHIP_CUSTOMER_MODEL || 'claude-haiku-5-5';
// The team's key. Not an ANTHROPIC_ name: public mode strips those from the environment so nothing it spawns inherits them.
const SHARED_KEY = process.env.SHIP_SHARED_KEY || (!PUBLIC ? process.env.ANTHROPIC_API_KEY : '') || null;
const SHARED_CHEFS = ['all', 'vip', 'off'].includes(process.env.SHIP_SHARED_CHEFS) ? process.env.SHIP_SHARED_CHEFS : 'vip';
const VIP_CODE = process.env.SHIP_VIP_CODE || null;
const OWNER_TOKEN = process.env.SHIP_OWNER_TOKEN || null;
const REAL_OFF = process.env.SHIP_REAL === 'off';

const budget = new Budget({
  capUsd: num(process.env.SHIP_SPEND_CAP_USD, 40),
  reviewsPerSession: num(process.env.SHIP_SESSION_REVIEWS, 20),
  reviewUsdPerSession: num(process.env.SHIP_SESSION_REVIEW_USD, 0.5),
  chefItemsPerSession: num(process.env.SHIP_SESSION_CHEF_ITEMS, 6),
  chefUsdPerSession: num(process.env.SHIP_SESSION_CHEF_USD, 1.5),
  maxRealRuns: num(process.env.SHIP_MAX_REAL_RUNS, 3),
});

const CHEF_DEFS = [
  { id: 'pixel', name: 'Pixel', color: '#4aa3d8' },
  { id: 'query', name: 'Query', color: '#57b86a' },
  { id: 'router', name: 'Router', color: '#f2b23a' },
  { id: 'stack', name: 'Stack', color: '#c873d6' },
];
const CHEF_COUNT = Math.max(1, Math.min(4, num(process.env.SHIP_CHEFS, 2)));
const TABLES = Math.max(1, Math.min(4, num(process.env.SHIP_TABLES, 2)));
const crew = driver => CHEF_DEFS.slice(0, CHEF_COUNT).map(c => ({ ...c, model: MODEL, driver }));
const timingsFor = demo => (demo || process.env.SHIP_TIMINGS === 'demo' ? DEMO_TIMINGS : REAL_TIMINGS);

/** Clears a directory this server made and marked, then makes it again. Never touches one it did not make. */
async function freshDir(dir, mark) {
  const exists = await fs.stat(dir).then(() => true, () => false);
  if (exists) {
    const ours = await fs.stat(path.join(dir, mark)).then(() => true, () => false);
    const empty = !ours && (await fs.readdir(dir)).length === 0;
    if (!ours && !empty) throw new Error(`${dir} was not made by Ship Shift, so it will not be cleared. Point SHIP_DATA at an empty or new directory.`);
    await fs.rm(dir, { recursive: true, force: true, maxRetries: 8, retryDelay: 150 });
  }
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, mark), 'Ship Shift. This directory is deleted and rebuilt on every start.\n');
}

/* ---------- HTTP helpers ---------- */

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
  if (p === '/watch' || p === '/watch/') p = '/index.html';
  const [prefix, base] = STATIC.find(([pre]) => p.startsWith(pre));
  let rel;
  try { rel = decodeURIComponent(p.slice(prefix.length)) || 'index.html'; } catch { return send(res, 404, { error: 'Not found' }); }
  const file = path.join(base, path.normalize(rel).replace(/^([/\\])+/, ''));
  if (!file.startsWith(base + path.sep)) return send(res, 404, { error: 'Not found' });
  try {
    const data = await fs.readFile(file);
    const headers = { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream', 'cache-control': cache };
    if (path.basename(file) === 'sw.js') headers['service-worker-allowed'] = '/';
    res.writeHead(200, headers);
    return res.end(data);
  } catch { return send(res, 404, { error: 'Not found' }); }
}

/**
 * The restaurant API, shared by every mode. ctx carries the mode's own rules:
 * send, body, sameOrigin, check (extra limits), session hooks for keys, readOnly, and a leaderboard.
 */
async function handle(r, req, res, ctx) {
  const { send } = ctx;
  const url = new URL(req.url, 'http://kitchen');
  const p = url.pathname;
  if (!p.startsWith('/api/')) return serveStatic(p, res);

  let m;
  if (req.method === 'GET') {
    if (p === '/api/state') { ctx.open?.(); return send(res, 200, r.snapshot()); }
    if (p === '/api/leaderboard') return send(res, 200, ctx.leaderboard ? ctx.leaderboard() : []);
    if ((m = p.match(/^\/api\/items\/(\d+)\/diff$/))) return send(res, 200, await r.diff(m[1]));
    if ((m = p.match(/^\/api\/items\/(\d+)\/wip$/))) return send(res, 200, await r.wip(m[1]));
    return send(res, 404, { error: 'Not found' });
  }
  if (req.method !== 'POST') return send(res, 405, { error: 'Method not allowed' });
  if (!ctx.sameOrigin(req) || !(req.headers['content-type'] || '').includes('application/json')) return send(res, 403, { error: 'Requests must come from the restaurant page' });
  if (ctx.readOnly) return send(res, 403, { error: 'You are watching this restaurant. Open your own to play.' });
  const b = await ctx.body(req);
  const refused = ctx.check?.(p, b);
  if (refused) return send(res, refused.code, { error: refused.error });
  try {
    if (p === '/api/shift/start') { r.startShift(b); return send(res, 200, { ok: true }); }
    if (p === '/api/shift/stop') { r.stopShift(); return send(res, 200, { ok: true }); }
    if (p === '/api/break/start') { r.startBreak(); return send(res, 200, { ok: true }); }
    if (p === '/api/break/end') { r.endBreak(); return send(res, 200, { ok: true }); }
    if (p === '/api/customers') { const c = r.addCustomer(b); return send(res, 200, { ok: true, id: c.id }); }
    if ((m = p.match(/^\/api\/customers\/(\d+)\/seat$/))) { await r.seat(m[1], b.tableId); return send(res, 200, { ok: true }); }
    if ((m = p.match(/^\/api\/customers\/(\d+)\/items$/))) { const made = r.addItems(m[1], b.items); return send(res, 200, { ok: true, ids: made.map(i => i.id) }); }
    if ((m = p.match(/^\/api\/customers\/(\d+)\/ack$/))) { r.ack(m[1]); return send(res, 200, { ok: true }); }
    if ((m = p.match(/^\/api\/customers\/(\d+)\/bill$/))) return send(res, 200, { ok: true, ...(await r.bill(m[1], b)) });
    if ((m = p.match(/^\/api\/items\/(\d+)\/edit$/))) { r.editItem(m[1], b); return send(res, 200, { ok: true }); }
    if ((m = p.match(/^\/api\/items\/(\d+)\/remove$/))) { await r.bin(m[1]); return send(res, 200, { ok: true }); }
    if ((m = p.match(/^\/api\/items\/(\d+)\/redo$/))) { r.redo(m[1], b); return send(res, 200, { ok: true }); }
    if ((m = p.match(/^\/api\/items\/(\d+)\/serve$/))) return send(res, 200, { ok: true, ...(await r.serve(m[1], b)) });
    if ((m = p.match(/^\/api\/items\/(\d+)\/resume$/))) { r.resume(m[1]); return send(res, 200, { ok: true }); }
    if ((m = p.match(/^\/api\/items\/(\d+)\/bin$/))) { await r.bin(m[1]); return send(res, 200, { ok: true }); }
    if ((m = p.match(/^\/api\/questions\/([\w-]+)\/answer$/))) { r.answer(m[1], b); return send(res, 200, { ok: true }); }
    if (p === '/api/session/key') { if (!ctx.setKey) throw new Error('This kitchen already uses this machine\'s Claude credentials'); await ctx.setKey(b.apiKey); return send(res, 200, { ok: true }); }
    if (p === '/api/session/key/clear') { ctx.clearKey?.(); return send(res, 200, { ok: true }); }
    if (p === '/api/session/vip') { if (!ctx.setVip) throw new Error('No VIP codes here'); ctx.setVip(b.code); return send(res, 200, { ok: true }); }
  } catch (e) {
    return send(res, e.status || 400, { error: e.message });
  }
  return send(res, 404, { error: 'Not found' });
}

/** Turns a restaurant's changes into WebSocket state messages for a set of sockets, at most every 120 ms. */
function broadcaster(r, sockets, scrub = s => s) {
  let pending = null;
  const flush = () => {
    pending = null;
    if (!sockets.size) return;
    const msg = scrub(JSON.stringify({ type: 'state', state: r.snapshot() }));
    for (const c of sockets) if (c.readyState === 1) c.send(msg);
  };
  r.on('change', () => { if (!pending) pending = setTimeout(flush, 120); });
  // clocks and patience bars move without events, so send a heartbeat too
  const beat = setInterval(() => { if (!pending) flush(); }, 1000);
  beat.unref();
  return () => { clearTimeout(pending); clearInterval(beat); };
}

/* ---------- local mode: one restaurant on this machine ---------- */

async function main() {
  const repoArg = process.env.SHIP_REPO ? path.resolve(process.env.SHIP_REPO) : null;
  const base = path.resolve(process.env.SHIP_DATA || path.join(root, '.kitchen', DEMO ? 'demo' : 'local'));
  await freshDir(base, '.ship-shift-local');
  const repo = repoArg || path.join(base, 'repo');
  if (!repoArg) await ensureProjectRepo(repo);
  if (!(await isRepo(repo))) throw new Error(`${repo} is not a git repository. Set SHIP_REPO to a git checkout.`);
  const mainBranch = process.env.SHIP_MAIN || await currentBranch(repo);
  const r = new Restaurant({
    repo, dataDir: path.join(base, 'data'), mainBranch, testCmd: process.env.SHIP_TEST_CMD || 'npm test',
    chefs: crew(SIM ? simDriver : realDriver), customers: repoArg ? [] : CUSTOMERS, tables: TABLES, timings: timingsFor(DEMO),
    customerModel: CUSTOMER_MODEL, budget, publicMode: false, allowCustom: true, project: repoArg ? path.basename(repo) : PROJECT_NAME,
    creds: () => ({ reviewKey: REAL_OFF ? null : SHARED_KEY, chefKey: undefined, ownKey: false, realChefs: !REAL_OFF }),
  });
  await r.init();

  const ctx = {
    send, body,
    sameOrigin: req => { const o = req.headers.origin; return !o || o === `http://${HOST}:${PORT}` || o === `http://localhost:${PORT}`; },
    leaderboard: () => [{ name: r.name, score: r.stats.score, bills: r.stats.bills, you: true }],
  };
  const server = http.createServer((req, res) => handle(r, req, res, ctx).catch(e => send(res, 500, { error: e.message })));
  const wss = new WebSocketServer({ server, path: '/ws' });
  const sockets = new Set();
  broadcaster(r, sockets);
  wss.on('connection', (ws, req) => {
    if (!ctx.sameOrigin(req)) return ws.close(1008, 'Wrong origin');
    sockets.add(ws); ws.on('close', () => sockets.delete(ws));
    ws.send(JSON.stringify({ type: 'state', state: r.snapshot() }));
  });
  server.listen(PORT, HOST, () => {
    console.log(`Ship Shift is open at http://${HOST}:${PORT}  (${r.name})`);
    console.log(`  repo:      ${repo} (${mainBranch})`);
    console.log(`  chefs:     ${SIM ? 'simulated, free' : `real Claude Agent SDK on ${MODEL}`} x${CHEF_COUNT}; ${TABLES} tables`);
    console.log(`  customers: ${SHARED_KEY && !REAL_OFF ? `Claude reviews on ${CUSTOMER_MODEL}, capped at US$${budget.capUsd}` : 'scripted reviews (set SHIP_SHARED_KEY or ANTHROPIC_API_KEY for Claude)'}`);
    console.log(`  timings:   ${timingsFor(DEMO) === DEMO_TIMINGS ? 'demo (3 minute shift)' : 'real (Pomodoro lengths)'}`);
  });
}

/* ---------- public mode: a private restaurant per visitor ---------- */

const MAX_BODY = 16 * 1024;
const REQUESTS_PER_MIN = 300;
const SOCKETS = 6;

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

/** Tidies everything a visitor typed: no control characters, bounded lengths, bounded nesting. */
function tidy(v, depth = 0) {
  if (typeof v === 'string') return v.replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, ' ').replace(/git\s+merge/gi, 'git-merge').slice(0, 4000);
  if (v === null || typeof v !== 'object') return v;
  if (depth >= 4) return null;
  if (Array.isArray(v)) return v.slice(0, 20).map(x => tidy(x, depth + 1));
  return Object.fromEntries(Object.entries(v).slice(0, 20).map(([k, x]) => [k.slice(0, 300), tidy(x, depth + 1)]));
}

const cookieValue = (req, name) => {
  for (const part of String(req.headers.cookie || '').split(';')) { const i = part.indexOf('='); if (i > 0 && part.slice(0, i).trim() === name) return part.slice(i + 1).trim(); }
  return null;
};

async function mainPublic() {
  // Nothing a public restaurant starts (test runs, git, chefs) inherits the owner's Claude credentials.
  for (const key of Object.keys(process.env)) if (/^(ANTHROPIC_|CLAUDE_)/i.test(key)) delete process.env[key];

  const sessionsDir = path.resolve(process.env.SHIP_SESSIONS_DIR || path.join(root, '.kitchen', 'sessions'));
  const max = Math.floor(num(process.env.SHIP_MAX_SESSIONS, 25));
  const idleMin = num(process.env.SHIP_IDLE_MIN, 20);
  const origins = list(process.env.SHIP_PUBLIC_ORIGIN).map(o => o.replace(/\/+$/, ''));
  const scrub = scrubber(sessionsDir, root);
  const ownOrigin = req => {
    const o = req.headers.origin;
    if (!o || origins.includes(o)) return true;
    try { return new URL(o).host === req.headers.host; } catch { return false; }
  };
  const sendJson = (res, code, b) => {
    res.writeHead(code, { 'content-type': 'application/json', 'cache-control': 'no-store' });
    res.end(scrub(JSON.stringify(b)));
  };

  /** Which agents a visitor's restaurant may run for real, and on whose key. */
  const credsFor = s => () => {
    if (REAL_OFF) return { reviewKey: null, chefKey: null, ownKey: false, realChefs: false };
    const own = s.apiKey || null;
    const sharedChefs = !!SHARED_KEY && (SHARED_CHEFS === 'all' || (SHARED_CHEFS === 'vip' && s.vip));
    return { reviewKey: own || SHARED_KEY, chefKey: own || (sharedChefs ? SHARED_KEY : null), ownKey: !!own, realChefs: !!own || sharedChefs, vip: !!s.vip };
  };
  const syncChefs = s => {
    const real = credsFor(s)().realChefs;
    for (const c of s.restaurant.chefs) c.driver = real ? realDriver : simDriver;
    s.restaurant.allowCustom = real;
    s.restaurant.changed();
  };

  const sessions = new Sessions({
    dir: sessionsDir, max, idleMs: idleMin * 60_000,
    build: async dir => {
      const repo = path.join(dir, 'repo');
      await ensureProjectRepo(repo);
      const holder = { apiKey: null, vip: false };
      const r = new Restaurant({
        repo, dataDir: path.join(dir, 'data'), mainBranch: await currentBranch(repo), testCmd: 'npm test',
        chefs: crew(simDriver), customers: CUSTOMERS, tables: TABLES, timings: DEMO_TIMINGS, customerModel: CUSTOMER_MODEL,
        budget, publicMode: true, allowCustom: false, project: PROJECT_NAME, creds: credsFor(holder),
      });
      await r.init();
      holder.restaurant = r;
      const s = { restaurant: r, holder, sockets: null, stopCast: null };
      return {
        restaurant: r, holder,
        watch: sockets => { if (!s.stopCast) { s.sockets = sockets; s.stopCast = broadcaster(r, sockets, scrub); } },
        stop: async () => { s.stopCast?.(); holder.apiKey = null; await r.close(); },
      };
    },
  });
  await sessions.init();

  // the team's flagship: real chefs on the team key, one persistent restaurant everyone can watch at /watch
  let flagship = null;
  if (OWNER_TOKEN) {
    const dir = path.join(path.resolve(process.env.SHIP_FLAGSHIP_DIR || path.join(root, '.kitchen', 'flagship')));
    await freshDir(dir, '.ship-shift-flagship');
    const repo = path.join(dir, 'repo');
    await ensureProjectRepo(repo);
    const r = new Restaurant({
      repo, dataDir: path.join(dir, 'data'), mainBranch: 'main', testCmd: 'npm test', chefs: crew(SHARED_KEY ? realDriver : simDriver),
      customers: CUSTOMERS, tables: TABLES, timings: timingsFor(process.env.SHIP_FLAGSHIP_TIMINGS !== 'real'), customerModel: CUSTOMER_MODEL,
      budget, publicMode: false, allowCustom: true, project: PROJECT_NAME, name: 'Team kitchen',
      creds: () => ({ reviewKey: REAL_OFF ? null : SHARED_KEY, chefKey: SHARED_KEY, ownKey: false, realChefs: !REAL_OFF && !!SHARED_KEY }),
    });
    r.account.unlimited = true;
    await r.init();
    const sockets = new Set();
    broadcaster(r, sockets, scrub);
    flagship = { restaurant: r, sockets, requests: [] };
  }

  const leaderboard = mine => () => {
    const all = [...sessions.live.values()].filter(s => s.restaurant).map(s => ({ name: s.restaurant.name, score: s.restaurant.stats.score, bills: s.restaurant.stats.bills, you: s.restaurant === mine }));
    if (flagship) all.push({ name: flagship.restaurant.name, score: flagship.restaurant.stats.score, bills: flagship.restaurant.stats.bills, team: true, you: flagship.restaurant === mine });
    return all.sort((a, b) => b.score - a.score).slice(0, 10);
  };

  const sessionContext = s => ({
    send: sendJson, body: smallBody, sameOrigin: ownOrigin, leaderboard: leaderboard(s.restaurant),
    check: (p, b) => { for (const [k, v] of Object.entries(b)) b[k] = tidy(v); return null; },
    setKey: async key => {
      key = String(key || '').trim();
      if (!/^sk-ant-[\w-]{20,}$/.test(key)) throw new Error('That does not look like an Anthropic API key (sk-ant-…)');
      const { default: Anthropic } = await import('@anthropic-ai/sdk');
      try { await new Anthropic({ apiKey: key, maxRetries: 0, timeout: 10_000 }).models.retrieve(MODEL); }
      catch (e) { throw new Error(e.status === 401 ? 'Anthropic did not accept that key' : `Could not check the key (${e.status || 'network'})`); }
      s.holder.apiKey = key;
      syncChefs(s.holder);
    },
    clearKey: () => { s.holder.apiKey = null; syncChefs(s.holder); },
    setVip: code => {
      if (!VIP_CODE || String(code || '').trim() !== VIP_CODE) throw new Error('That is not the VIP code');
      s.holder.vip = true;
      syncChefs(s.holder);
    },
  });
  const ownerContext = {
    send: sendJson, body: smallBody, sameOrigin: ownOrigin, check: (p, b) => { for (const [k, v] of Object.entries(b)) b[k] = tidy(v); return null; },
    leaderboard: () => leaderboard(flagship?.restaurant)(),
  };
  const watchContext = { ...ownerContext, readOnly: true };

  const FULL = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta http-equiv="refresh" content="20"><title>Ship Shift: every table is taken</title>
<style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#2b2233;color:#fff1dc;font:18px/1.5 system-ui,sans-serif;text-align:center}main{max-width:30rem;padding:2rem}h1{font-size:2rem;margin:0 0 .5rem}a{color:#ffd27a}</style></head>
<body><main><h1>Every restaurant is open</h1><p>All ${max} restaurants are taken right now. ${OWNER_TOKEN ? 'You can <a href="/watch">watch the team kitchen</a> while you wait. ' : ''}This page tries again every 20 seconds.</p></main></body></html>`;

  const isOwner = req => OWNER_TOKEN && cookieValue(req, 'ship_owner') === OWNER_TOKEN;
  const handlePublic = async (req, res) => {
    let url;
    try { url = new URL(req.url, 'http://kitchen'); } catch { return sendJson(res, 400, { error: 'Bad request' }); }
    const p = url.pathname;
    if (p === '/healthz') return sendJson(res, 200, { ok: true, restaurants: sessions.size, max, spent: Math.round(budget.spent * 100) / 100, cap: budget.capUsd });
    const api = p.startsWith('/api/');
    let from = '';
    try { from = new URL(req.headers.referer || 'http://x/').pathname; } catch { /* none */ }
    const watching = api ? (from === '/watch' || from === '/watch/' || url.searchParams.get('watch') === '1') : (p === '/watch' || p === '/watch/');
    // the owner link: /?owner=<token> sets a cookie, and from then on this browser runs the flagship
    if (OWNER_TOKEN && url.searchParams.get('owner') === OWNER_TOKEN && !api) {
      res.writeHead(302, { location: '/', 'set-cookie': `ship_owner=${OWNER_TOKEN}; Path=/; HttpOnly; SameSite=Lax; Max-Age=86400${String(req.headers['x-forwarded-proto'] || '').startsWith('https') ? '; Secure' : ''}` });
      return res.end();
    }
    const page = !api && req.method === 'GET' && (p === '/' || p.endsWith('.html') || p === '/watch' || p === '/watch/');
    if (!api && !page) return serveStatic(p, res, p.startsWith('/vendor/') || p.startsWith('/fonts/') ? 'public, max-age=3600' : 'no-cache');

    if (flagship && (isOwner(req) || watching)) {
      if (page) return serveStatic(p, res, 'no-store');
      if (!allow(flagship.requests, REQUESTS_PER_MIN * 4, 60_000)) return sendJson(res, 429, { error: 'Too many requests.' });
      return handle(flagship.restaurant, req, res, isOwner(req) ? ownerContext : watchContext);
    }

    let s = sessions.find(sessionIdFrom(req));
    if (!s && page) {
      s = sessions.open();
      if (!s) { res.writeHead(503, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'retry-after': '20' }); return res.end(FULL); }
      res.setHeader('set-cookie', sessionCookie(s.id, String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim() === 'https'));
    }
    if (!s) return sendJson(res, 401, { error: 'This restaurant has closed. Reload the page for a fresh one.' });
    await s.ready;
    if (page) return serveStatic(p, res, 'no-store');
    if (p === '/api/session/reset' && req.method === 'POST') {
      // "New restaurant": close this one for good and forget the cookie, so the next page load opens a fresh one
      if (!ownOrigin(req)) return sendJson(res, 403, { error: 'Requests must come from the restaurant page' });
      sessions.end(s).catch(() => {});
      res.setHeader('set-cookie', 'ship_sid=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0');
      return sendJson(res, 200, { ok: true });
    }
    if (!allow(s.requests, REQUESTS_PER_MIN, 60_000)) return sendJson(res, 429, { error: 'Too many requests. Slow down a little.' });
    return handle(s.restaurant, req, res, s.ctx ||= sessionContext(s));
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
    let url = null;
    try { url = new URL(req.url, 'http://kitchen'); } catch { /* refused below */ }
    if (url?.pathname !== '/ws') return refuse(404, 'Not Found');
    if (!ownOrigin(req)) return refuse(403, 'Forbidden');
    if (flagship && (isOwner(req) || url.searchParams.get('watch') === '1')) {
      return wss.handleUpgrade(req, socket, head, ws => {
        ws.on('error', () => {});
        flagship.sockets.add(ws); ws.on('close', () => flagship.sockets.delete(ws));
        ws.send(scrub(JSON.stringify({ type: 'state', state: flagship.restaurant.snapshot() })));
      });
    }
    const s = sessions.find(sessionIdFrom(req));
    if (!s) return refuse(401, 'Unauthorized');
    if (s.sockets.size >= SOCKETS) return refuse(429, 'Too Many Requests');
    wss.handleUpgrade(req, socket, head, async ws => {
      ws.on('error', () => {});
      try { await s.ready; } catch { return ws.close(1011, 'Restaurant failed to open'); }
      if (sessions.find(s.id) !== s) return ws.close(4001, 'Restaurant closed');
      s.sockets.add(ws);
      s.watch(s.sockets);
      ws.on('close', () => s.sockets.delete(ws));
      if (ws.readyState === 1) ws.send(scrub(JSON.stringify({ type: 'state', state: s.restaurant.snapshot() })));
    });
  });

  let closing = false;
  const shutdown = () => {
    if (closing) return;
    closing = true;
    setTimeout(() => process.exit(0), 8000).unref();
    server.close();
    for (const c of wss.clients) c.terminate();
    Promise.all([sessions.closeAll(), flagship?.restaurant.close()]).finally(() => process.exit(0));
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(PORT, HOST, resolve); });
  console.log(`Ship Shift public restaurants open on http://${HOST}:${PORT} (this machine: http://localhost:${PORT})`);
  console.log(`  each visitor gets a private restaurant with its own copy of roster-cafe; at most ${max} at once, closed after ${idleMin} idle minutes`);
  console.log(`  chefs:     simulated${SHARED_KEY ? `; real (${MODEL}) with a visitor's own key${SHARED_CHEFS === 'all' ? ', or the team key for everyone' : SHARED_CHEFS === 'vip' && VIP_CODE ? ', or the team key with the VIP code' : ''}` : "; real with a visitor's own key"}`);
  console.log(`  customers: ${SHARED_KEY && !REAL_OFF ? `Claude reviews on ${CUSTOMER_MODEL}` : 'scripted (set SHIP_SHARED_KEY for Claude)'}; spend cap US$${budget.capUsd} on the team key, ${budget.reviewsPerSession} reviews and ${budget.chefItemsPerSession} real chef items per restaurant`);
  if (flagship) console.log(`  flagship:  "${flagship.restaurant.name}" with ${SHARED_KEY ? 'real' : 'simulated'} chefs; run it from /?owner=<SHIP_OWNER_TOKEN>, anyone can watch at /watch`);
}

(PUBLIC ? mainPublic() : main()).catch(e => { console.error(e.message); process.exit(1); });
