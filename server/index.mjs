// Ship Shift server: http (static files, /shared, /content, /vendor, /tv, health, admin, the showcase preview) and one
// WebSocket at /ws for everything else. All state is in memory. REBUILD.md section 5 is the contract.
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { WebSocketServer } from 'ws';
import { loadConfig } from './config.mjs';
import { createGame } from './game.mjs';
import { WS_PATH } from '../shared/protocol.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.ico': 'image/x-icon',
  '.woff2': 'font/woff2', '.woff': 'font/woff', '.ttf': 'font/ttf', '.wasm': 'application/wasm', '.md': 'text/plain; charset=utf-8', '.txt': 'text/plain; charset=utf-8',
};
const THREE = path.join(root, 'node_modules', 'three');
// Longest prefix first.
const STATIC = [
  ['/vendor/addons/', path.join(THREE, 'examples', 'jsm')], ['/vendor/', path.join(THREE, 'build')],
  ['/shared/', path.join(root, 'shared')], ['/content/', path.join(root, 'content')],
  ['/', path.join(root, 'public')],
];

function sendJson(res, code, body) {
  res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(JSON.stringify(body));
}

async function serveStatic(p, res) {
  const [prefix, base] = STATIC.find(([pre]) => p.startsWith(pre));
  let rel;
  try { rel = decodeURIComponent(p.slice(prefix.length)) || 'index.html'; } catch { return sendJson(res, 404, { error: 'Not found' }); }
  const file = path.join(base, path.normalize(rel).replace(/^([/\\])+/, ''));
  if (!file.startsWith(base + path.sep)) return sendJson(res, 404, { error: 'Not found' });
  try {
    const data = await fs.readFile(file);
    const cache = prefix.startsWith('/vendor/') || p.startsWith('/fonts/') ? 'public, max-age=3600' : 'no-cache';
    res.writeHead(200, { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream', 'cache-control': cache });
    return res.end(data);
  } catch { return sendJson(res, 404, { error: 'Not found' }); }
}

async function readBody(req, max = 4096) {
  let data = '';
  for await (const chunk of req) { data += chunk; if (data.length > max) throw Object.assign(new Error('Too large'), { status: 413 }); }
  try { return data ? JSON.parse(data) : {}; } catch { throw Object.assign(new Error('Bad JSON'), { status: 400 }); }
}

/** A socket may connect from this server's own host, or from an origin listed in SHIP_PUBLIC_ORIGIN. */
function originOk(req, origins) {
  const o = req.headers.origin;
  if (!o) return true;
  try { if (new URL(o).host === req.headers.host) return true; } catch { return false; }
  return origins.includes(o.replace(/\/+$/, ''));
}

/**
 * Starts the server. Returns { url, port, game, close }.
 * @param {{env?:object, now?:()=>number, client?:object, agents?:object, showcase?:object, quiet?:boolean}} [opts]
 */
export async function startServer({ env = process.env, now, client, agents, showcase, quiet = false } = {}) {
  const config = loadConfig(env);
  let sc = showcase || null;
  if (config.showcase && !sc) {
    try {
      const mod = await import(pathToFileURL(path.join(here, 'showcase', 'index.mjs')).href);
      sc = await mod.createShowcase({ root, config });
    } catch (e) { console.warn(`SHOWCASE=1 but the showcase could not load (${e.message}). Its floor runs on the Messages API Chef.`); }
  }
  const game = await createGame({ config, now, client, agents, showcase: sc });
  const origins = String(env.SHIP_PUBLIC_ORIGIN || '').split(',').map(s => s.trim().replace(/\/+$/, '')).filter(Boolean);
  const adminOk = req => config.adminSecret && req.headers['x-admin-secret'] === config.adminSecret;

  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://ship-shift');
      const p = url.pathname;
      if (p === '/health' || p === '/healthz') return sendJson(res, 200, { ok: true });
      if (p.startsWith('/admin/')) {
        if (!adminOk(req)) return sendJson(res, 404, { error: 'Not found' });
        if (p === '/admin/usage' && req.method === 'GET') return sendJson(res, 200, game.usage());
        if (p === '/admin/mode' && req.method === 'POST') {
          const body = await readBody(req);
          return game.setDefaultMode(body.defaultMode) ? sendJson(res, 200, { ok: true, defaultMode: config.defaultMode }) : sendJson(res, 400, { error: 'defaultMode is live or demo' });
        }
        return sendJson(res, 404, { error: 'Not found' });
      }
      if (p.startsWith('/preview/showcase')) {
        if (!sc) return sendJson(res, 404, { error: 'Not found' });
        return sc.preview(req, res, decodeURIComponent(p.slice('/preview/showcase'.length)) || '/');
      }
      if (req.method !== 'GET' && req.method !== 'HEAD') return sendJson(res, 405, { error: 'Method not allowed' });
      return serveStatic(p, res);
    } catch (e) {
      if (res.headersSent) return res.destroy();
      const code = e.status || 500;
      if (code === 500) console.error(e);
      sendJson(res, code, { error: code === 500 ? 'Server error' : e.message });
    }
  });
  server.requestTimeout = 30_000;

  const wss = new WebSocketServer({ noServer: true, maxPayload: 8192 });
  server.on('upgrade', (req, socket, head) => {
    socket.on('error', () => {});
    let p = '';
    try { p = new URL(req.url, 'http://ship-shift').pathname; } catch { /* refused below */ }
    if (p !== WS_PATH) return socket.end('HTTP/1.1 404 Not Found\r\nConnection: close\r\nContent-Length: 0\r\n\r\n');
    if (!originOk(req, origins)) return socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\nContent-Length: 0\r\n\r\n');
    wss.handleUpgrade(req, socket, head, ws => {
      ws.on('error', () => {});
      const conn = game.connect(text => { if (ws.readyState === 1) ws.send(text); });
      ws.isAlive = true;
      ws.on('pong', () => { ws.isAlive = true; });
      ws.on('message', data => {
        let msg;
        try { msg = JSON.parse(data); } catch { msg = null; }
        game.message(conn, msg);
      });
      ws.on('close', () => game.disconnect(conn));
    });
  });
  // Heartbeat: a socket that misses two pings is dropped, so a locked phone frees its connection.
  const heartbeat = setInterval(() => {
    for (const ws of wss.clients) {
      if (!ws.isAlive) { ws.terminate(); continue; }
      ws.isAlive = false;
      try { ws.ping(); } catch { /* closing */ }
    }
  }, 20_000);

  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(config.port, config.host, resolve); });
  game.start();
  const port = server.address().port;
  const url = `http://localhost:${port}`;
  if (!quiet) {
    console.log(`Ship Shift listening on ${url}`);
    console.log(`  agents:  ${game.budget.enabled ? `live (${config.models.player} for players, ${config.models.judge} for judges)` : 'Demo only: no ANTHROPIC_API_KEY'}${config.baseURL ? `, API at ${config.baseURL}` : ''}`);
    console.log(`  floors:  ${config.maxLiveFloors} live (${config.judgeSlots} for judges), ${config.maxFloors} in all; default mode ${config.defaultMode}; live timings ${config.liveTimings}${config.pace !== 1 ? `; pace ${config.pace}x` : ''}`);
    console.log(`  caps:    player $${config.caps.player}, judge $${config.caps.judge}, judge pool $${config.caps.judgePool}, global stop $${config.caps.globalStop}`);
    if (config.showcase) console.log(`  showcase: ${sc ? 'on' : 'module missing'}`);
    if (!env.SHIP_NO_QR) {
      try {
        const { default: qrcode } = await import('qrcode-terminal');
        qrcode.generate(env.SHIP_PUBLIC_URL || url, { small: true });
      } catch { /* no QR without the package */ }
    }
  }

  let closed = false;
  const close = async () => {
    if (closed) return;
    closed = true;
    clearInterval(heartbeat);
    game.stop();
    for (const c of wss.clients) c.terminate();
    await new Promise(r => server.close(() => r()));
    await sc?.close?.();
  };
  return { url, port, game, config, close };
}

// `node server/index.mjs`, or `node -e "import(...)"` (the showcase script), starts it; an import from a test does not.
const isMain = !process.argv[1] || path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  startServer().then(({ close }) => {
    const stop = () => { close().finally(() => process.exit(0)); setTimeout(() => process.exit(0), 5000).unref(); };
    process.on('SIGINT', stop);
    process.on('SIGTERM', stop);
  }, e => { console.error(e.message); process.exit(1); });
}
