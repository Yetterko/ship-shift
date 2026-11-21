// A stand-in for the real server, for the world tests while builder 1's server is not live: the same HTTP routes and
// WebSocket messages as docs/REBUILD.md section 5, with the floors made from shared/fixtures.js. No game rules run here;
// only what the shell needs: roles, slots, floors, subscriptions, acks, `building`, `peers`, `notify` and `splash`.
//
//   const town = await startFakeTown({ liveMax, judgeMax, seed, buildingMs })
//   town.url, town.stop(), town.notify(floorId, kind, text), town.floors, town.conns, town.log
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import { fixtureFloor, fixtureBuilding } from '../../shared/fixtures.js';
import { PARK, PLOTS } from '../../shared/protocol.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const THREE = path.join(root, 'node_modules', 'three');
const STATIC = [
  ['/vendor/addons/', path.join(THREE, 'examples', 'jsm')], ['/vendor/', path.join(THREE, 'build')],
  ['/shared/', path.join(root, 'shared')], ['/content/', path.join(root, 'content')], ['/', path.join(root, 'public')],
];
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.woff2': 'font/woff2' };

export async function startFakeTown({ liveMax = 60, judgeMax = 6, seed = 5, buildingMs = 300, defaultMode = 'live', settings = null } = {}) {
  const floors = new Map();          // id -> { snap, token, ownerConn }
  const conns = new Set();
  const log = [];
  let number = 0, connN = 0;
  // the seeded floors belong to nobody here: other people's kitchens to look at
  for (const line of fixtureBuilding(seed).floors) {
    const snap = fixtureFloor(['start', 'cooking', 'ready', 'feedback', 'shipped'][line.number % 5], { mode: line.mode, ownerRole: line.ownerRole });
    Object.assign(snap, { id: line.id, number: line.number, name: line.name, plot: line.plot, score: line.score });
    snap.stats.shipped = line.shipped;
    floors.set(line.id, { snap, token: null, owner: null });
    number = line.number;
  }

  const server = http.createServer(async (req, res) => {
    const p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    if (p === '/health' || p === '/healthz') { res.writeHead(200, { 'content-type': 'application/json' }); return res.end('{"ok":true}'); }
    for (const [prefix, dir] of STATIC) {
      if (!p.startsWith(prefix)) continue;
      let file = path.join(dir, p.slice(prefix.length) || 'index.html');
      if (!file.startsWith(dir)) break;
      try {
        if ((await fs.stat(file)).isDirectory()) file = path.join(file, 'index.html');
        const body = await fs.readFile(file);
        res.writeHead(200, { 'content-type': MIME[path.extname(file)] || 'application/octet-stream', 'cache-control': 'no-cache' });
        return res.end(body);
      } catch { break; }
    }
    res.writeHead(404); res.end('not found');
  });
  const wss = new WebSocketServer({ noServer: true });
  server.on('upgrade', (req, sock, head) => {
    if (!req.url.startsWith('/ws')) return sock.destroy();
    wss.handleUpgrade(req, sock, head, ws => wss.emit('connection', ws));
  });

  const send = (c, type, body = {}) => { if (c.ws.readyState === 1) c.ws.send(JSON.stringify({ type, ...body })); };
  const lineOf = ({ snap }) => ({
    id: snap.id, number: snap.number, name: snap.name, plot: snap.plot, kind: snap.kind, ownerRole: snap.ownerRole, mode: snap.mode, model: snap.model,
    score: snap.score, shipped: snap.stats.shipped, watchers: snap.watchers, phase: snap.phase,
    lights: { cooking: snap.chefs.filter(c => c.status === 'cooking').length, onPass: snap.pass.length, waiting: snap.line.length },
  });
  const liveUsed = role => [...floors.values()].filter(f => f.snap.mode === 'live' && (!role || f.snap.ownerRole === role)).length;
  function building() {
    const fl = [...floors.values()];
    return { now: Date.now(), floors: fl.map(lineOf), slots: { liveUsed: liveUsed('player'), liveMax, judgeUsed: liveUsed('judge'), judgeMax, queued: 0 }, liveOpen: liveUsed('player') < liveMax, park: { ...PARK } };
  }
  const watchers = id => [...conns].filter(c => c.sub === id && c.floorId !== id).length;
  function push(id) {
    const f = floors.get(id); if (!f) return;
    f.snap.watchers = watchers(id);
    for (const c of conns) if (c.sub === id) send(c, 'floor', { floor: f.snap, you: { isOwner: c.floorId === id, canAct: c.floorId === id }, now: Date.now() });
  }
  function welcome(c, extra = {}) {
    send(c, 'welcome', { v: 1, connId: c.id, role: c.role, name: c.name, look: c.look, ...(c.floorId ? { token: floors.get(c.floorId)?.token, floorId: c.floorId } : { floorId: null }), serverNow: Date.now(), showcase: false, defaults: { settings: settings || { gracePeriodMs: 300000, maxWorkMs: 1500000 }, mode: defaultMode }, limits: { items: 5 }, ...extra });
  }
  function destroy(id) {
    const f = floors.get(id); if (!f) return;
    floors.delete(id);
    for (const c of conns) { if (c.floorId === id) { c.floorId = null; send(c, 'notify', { kind: 'floorClosed', floorId: id, text: 'Your kitchen has closed.' }); } else if (c.sub === id) send(c, 'notify', { kind: 'floorClosed', floorId: id, text: 'That kitchen has closed.' }); }
  }
  const freePlot = () => { const used = new Set([...floors.values()].map(f => f.snap.plot)); for (let i = 0; i < PLOTS; i++) if (!used.has(i)) return i; return null; };

  function action(c, name, args) {
    const f = c.floorId && floors.get(c.floorId);
    if (!f || c.sub !== c.floorId && !['setMode', 'leave', 'closeShift'].includes(name)) return { ok: false, code: 'view_only', message: 'View only' };
    const s = f.snap;
    if (name === 'seat') { const i = s.line.findIndex(x => !args.customerId || x.id === args.customerId); const t = s.tables.indexOf(null); if (i < 0 || t < 0) return { ok: false, code: 'no_table' }; const [cu] = s.line.splice(i, 1); Object.assign(cu, { status: 'seated', table: t }); s.tables[t] = cu; }
    else if (name === 'setMode') {
      if (args.mode === 'live' && !s.budget.canGoLive) return { ok: false, code: 'no_budget' };
      s.mode = args.mode; s.budget.blocked = false;
    } else if (name === 'leave') { destroy(s.id); return { ok: true }; }
    else if (name === 'closeShift') s.shift.status = 'ended';
    push(s.id);
    return { ok: true };
  }

  wss.on('connection', ws => {
    const c = { ws, id: `c${++connN}`, role: null, name: `Guest ${connN}`, look: connN % 8, floorId: null, sub: null, pos: null, said: 0 };
    conns.add(c);
    ws.on('message', data => {
      let m; try { m = JSON.parse(data); } catch { return send(c, 'error', { code: 'bad_message', message: 'Not JSON' }); }
      log.push({ conn: c.id, ...m });
      switch (m.type) {
        case 'hello': {
          if (m.token) for (const f of floors.values()) if (f.token === m.token) { c.floorId = f.snap.id; c.role = f.snap.ownerRole; f.owner = c; }
          welcome(c); send(c, 'building', building()); break;
        }
        case 'chooseRole': c.role = m.role; welcome(c); break;
        case 'createFloor': {
          const judge = c.role === 'judge', mode = m.mode === 'demo' ? 'demo' : 'live';
          if (!c.role || c.role === 'spectator') return send(c, 'error', { code: 'bad_message', message: 'Pick Player or Judge first.' });
          if (mode === 'live' && (judge ? liveUsed('judge') >= judgeMax && liveUsed('player') >= liveMax : liveUsed('player') >= liveMax)) return send(c, 'error', { code: 'no_slot', message: 'All live kitchens are busy.', options: ['demo', 'visit', 'queue'] });
          const snap = fixtureFloor('start', { mode, ownerRole: judge ? 'judge' : 'player' });
          const id = crypto.randomBytes(16).toString('base64url').slice(0, 21);
          Object.assign(snap, { id, number: ++number, name: String(m.name || 'The New Kitchen').slice(0, 24), plot: freePlot(), watchers: 0 });
          snap.budget.spentUsd = 0;
          if (m.settings) Object.assign(snap.settings, m.settings);
          const token = crypto.randomBytes(24).toString('base64url');
          floors.set(id, { snap, token, owner: c }); c.floorId = id;
          welcome(c);
          break;
        }
        case 'subscribe': {
          const old = c.sub;
          if (!floors.has(m.floorId)) { c.sub = null; send(c, 'error', { code: 'no_floor', message: 'That restaurant has closed.' }); break; }
          c.sub = m.floorId; c.pos = null;
          if (old && old !== m.floorId) push(old);
          push(m.floorId); break;
        }
        case 'unsubscribe': { const old = c.sub; c.sub = null; c.pos = null; if (old) push(old); break; }
        case 'action': send(c, 'ack', { seq: m.seq, ...action(c, m.name, m.args || {}) }); break;
        case 'p': c.pos = { x: +m.x || 0, z: +m.z || 0, r: +m.r || 0 }; break;
        case 'splash': {
          // as the real server: same zone, within 6 units, then `splashed` to the whole zone
          const zone = c.sub || 'park', to = [...conns].find(x => x.id === m.to);
          if (!to || to === c || (to.sub || 'park') !== zone || !c.pos || !to.pos) break;
          const dx = to.pos.x - c.pos.x, dz = to.pos.z - c.pos.z, d = Math.hypot(dx, dz);
          if (d > 6) break;
          for (const x of conns) if ((x.sub || 'park') === zone) send(x, 'splashed', { from: c.name, fromId: c.id, toId: to.id, dir: { x: d ? dx / d : 0, z: d ? dz / d : 1 } });
          break;
        }
        case 'joinQueue': case 'leaveQueue': break;
        default: send(c, 'error', { code: 'bad_message', message: `Unknown type ${m.type}` });
      }
    });
    ws.on('close', () => { conns.delete(c); if (c.sub) push(c.sub); });
  });

  const tickB = setInterval(() => { const b = building(); for (const c of conns) send(c, 'building', b); }, buildingMs);
  const tickP = setInterval(() => {
    const zones = new Map();
    for (const c of conns) { const z = c.sub || 'park'; if (!zones.has(z)) zones.set(z, []); zones.get(z).push(c); }
    for (const [zone, list] of zones) {
      if (list.length < 2) continue;
      const peers = list.filter(c => c.pos).slice(0, 30).map(c => ({ id: c.id, name: c.name, look: c.look, role: c.role || 'spectator', ...c.pos }));
      for (const c of list) send(c, 'peers', { zone, peers });
    }
  }, 200);

  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${server.address().port}`;
  return {
    url, floors, conns, log,
    notify(floorId, kind, text = '') { for (const c of conns) if (c.floorId === floorId || (['shipped', 'floorClosed'].includes(kind) && c.sub === floorId)) send(c, 'notify', { kind, floorId, text }); },
    patch(floorId, fn) { const f = floors.get(floorId); if (f) { fn(f.snap); push(floorId); } },
    destroy,
    async stop() { clearInterval(tickB); clearInterval(tickP); for (const c of conns) c.ws.terminate(); wss.close(); await new Promise(r => server.close(r)); },
  };
}
