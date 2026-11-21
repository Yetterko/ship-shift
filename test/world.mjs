// Town check. First the World class on its own with a clock the test moves, then the real public server with three
// browsers' worth of cookie jars over fetch and WebSocket. Simulated chefs only, no API spend, no browser windows.
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocket } from 'ws';
import { World, cleanName, PARK } from '../server/world.mjs';
import { STARTER_ORDERS } from '../server/demo-repo.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'ship-world-'));
const sleep = ms => new Promise(r => setTimeout(r, ms));
let passed = 0;
const ok = (cond, msg) => { if (!cond) throw new Error('FAILED: ' + msg); passed++; console.log('  ok', msg); };
const code = fn => { try { fn(); return 'ok'; } catch (e) { return e.code || `threw: ${e.message}`; } };
const TITLE = Object.fromEntries(['close', 'overtime', 'sunday', 'export', 'holiday', 'wage', 'double'].map((k, i) => [k, STARTER_ORDERS[i].title]));
const servers = [];
let log = '';

/* ================= part 1: the World class, no server ================= */

/** A stand-in kitchen that speaks the town's link and nothing else. */
function fakeKitchen() {
  const k = { orders: [], next: 1, score: 0, shipped: 0, blockedSince: null };
  k.link = {
    summary: () => ({
      score: k.score, shipped: k.shipped, stars: 0, window: Math.max(0, 4 - k.orders.filter(o => o.state === 'waiting').length),
      lights: { cooking: k.orders.filter(o => o.state === 'cooking').length, oven: 0, pass: 0, blocked: k.blockedSince ? 1 : 0, fire: false, stalled: 0, since: k.blockedSince },
      orders: k.orders.map(o => ({ ...o })),
    }),
    admit: card => { const o = { id: k.next++, state: 'waiting', cardId: card.id, title: card.title, size: card.size }; k.orders.push(o); return o.id; },
    withdraw: id => { const o = k.orders.find(x => x.id === id); if (!o || o.state !== 'waiting') throw new Error('Only a waiting order can leave'); k.orders.splice(k.orders.indexOf(o), 1); },
    has: title => k.orders.some(o => o.state !== 'binned' && o.title.toLowerCase() === title.toLowerCase()),
  };
  return k;
}

function unit() {
  console.log('World unit checks');
  let t = 1_000_000;
  const w = new World({ dishes: STARTER_ORDERS, arrivalsMs: [0, 1000, 2000, 3000, 4000, 5000, 6000], teams: 2, now: () => t, rushMs: 60_000, bellMs: 100_000, offerMs: 30_000 });
  const moved = [];
  w.on('moved', (pid, where) => moved.push({ pid, ...where }));
  const stand = (p, x, z) => Object.assign(w.players.get(p.pid), { zone: 'park', x, z });
  const card = (title, state = 'backlog', team) => [...w.cards.values()].find(c => c.title === title && c.state === state && (!team || c.team === team));
  const ka = fakeKitchen(), kb = fakeKitchen(), kc = fakeKitchen();

  ok(w.plots.length === 24 && w.plots.every((p, i) => p.id === i) && new Set(w.plots.map(p => p.slot)).size === 24 && w.plots.every((p, i) => i === 0 || Math.hypot(p.x, p.z) >= Math.hypot(w.plots[i - 1].x, w.plots[i - 1].z) - 1e-9), 'there are 24 plots, numbered from the fountain outward');
  ok(w.plots.every(p => Math.abs(p.x) <= PARK.w / 2 && Math.abs(p.z) <= PARK.h / 2) && ['n', 's', 'e', 'w'].every(side => w.plots.some(p => p.side === side)), 'every doormat is on the lawn, on all four sides');

  const A = w.join({ link: ka.link }), B = w.join({ link: kb.link }), C = w.join({ link: kc.link });
  ok(/^[a-f0-9]{6}$/.test(A.pid) && new Set([A.pid, B.pid, C.pid]).size === 3 && A.plot === 0 && B.plot === 1 && C.plot === 2, 'three players get a 6 hex pid and the three plots nearest the fountain');
  ok(A.team === 'red' && B.team === 'blue' && C.team === 'red' && /^Chef \w+$/.test(A.name) && new Set([A.name, B.name, C.name]).size === 3, `teams are dealt in turn and names are generated (${A.name}, ${B.name}, ${C.name})`);
  ok(ka.orders.length === 1 && ka.orders[0].title === TITLE.close && card(TITLE.close, 'seated').orderId === 1, 'the first dish walks straight in, because the owner starts inside');

  t += 2500; w.tick();
  ok(card(TITLE.overtime, 'backlog', 'red') && card(TITLE.overtime, 'backlog', 'blue') && card(TITLE.sunday, 'backlog', 'red') && !card(TITLE.export), 'the rest of each menu reaches its own team\'s backlog on the arrival schedule');
  const red = w.teams[0].area, ot = card(TITLE.overtime, 'backlog', 'red');
  ok(Math.hypot(ot.x - red.x, ot.z - red.z) <= red.r, 'a backlog customer stands inside their team\'s area');

  /* take: zone, proximity, team, second taker, carry limit */
  ok(code(() => w.take(A.pid, ot.id)) === 'far', 'take: refused from inside a kitchen');
  ok(w.go(A.pid, 'park').zone === 'park' && A.x === w.plots[0].x && A.z === w.plots[0].z && w.snapshot().plots[0].open === false, 'stepping out puts you on your doormat, and the door says back soon');
  ok(code(() => w.take(A.pid, ot.id)) === 'far', 'take: refused from across the park');
  stand(A, ot.x, ot.z); stand(C, ot.x, ot.z); stand(B, ot.x, ot.z);
  ok(code(() => w.take(B.pid, ot.id)) === 'team', 'take: another team cannot take from this team\'s backlog');
  ok(w.take(A.pid, ot.id).state === 'held' && A.carry.length === 1, 'take: a teammate in reach leads the customer away');
  ok(code(() => w.take(C.pid, ot.id)) === 'taken', 'take: a second taker gets "taken"');
  const sun = card(TITLE.sunday, 'backlog', 'red'), ot2 = card(TITLE.overtime, 'backlog', 'red');
  stand(A, sun.x, sun.z); w.take(A.pid, sun.id);
  stand(A, ot2.x, ot2.z);
  ok(code(() => w.take(A.pid, ot2.id)) === 'hands' && A.carry.length === 2, 'take: nobody leads more than two customers');

  /* put: proximity, own door, admission */
  ok(code(() => w.put(A.pid, ot.id, 0)) === 'far', 'put: refused away from the doormat');
  stand(A, w.plots[0].x, w.plots[0].z);
  ok(w.put(A.pid, ot.id, 0).state === 'queued' && w.plots[0].queue.includes(ot.id) && ka.orders.length === 1, 'put: on your own doormat the customer queues, and waits while you are out');
  ok(w.go(A.pid, 'k:0').zone === 'k:0' && w.cards.get(ot.id).state === 'seated' && ka.orders.length === 2, 'the queue walks in when the owner comes home');
  ok(code(() => w.take(C.pid, ot.id)) === 'locked', 'a seated customer cannot be taken');

  /* the dish rule, teammates' queues, the queue cap */
  w.go(A.pid, 'park');
  stand(A, w.plots[2].x, w.plots[2].z); stand(C, w.plots[2].x, w.plots[2].z); stand(B, w.plots[2].x, w.plots[2].z);
  w.go(C.pid, 'park');
  ok(w.put(A.pid, sun.id, 2).state === 'queued' && w.cards.get(sun.id).from === A.pid, 'a teammate\'s door queues the customer at once and remembers who sent them');
  stand(A, ot2.x, ot2.z); w.take(A.pid, ot2.id); stand(A, w.plots[0].x, w.plots[0].z);
  ok(code(() => w.put(A.pid, ot2.id, 0)) === 'dish', 'the dish rule: a restaurant refuses a dish it already has');
  stand(A, w.plots[2].x, w.plots[2].z);
  ok(code(() => w.take(B.pid, sun.id)) === 'team', 'another team cannot take from a door queue');
  ok(w.take(C.pid, sun.id).state === 'held' && w.put(C.pid, sun.id, 2).from === null, 'the owner takes a customer off their own queue and puts them back');
  w.put(A.pid, ot2.id, 2);
  ok(w.take(A.pid, ot2.id).heldBy === A.pid && w.put(A.pid, ot2.id, 2).state === 'queued', 'teammates hand a queued customer back and forth');
  t += 10_000; w.tick();
  for (const title of [TITLE.export, TITLE.holiday, TITLE.wage, TITLE.double]) { const c = card(title, 'backlog', 'red'); stand(A, c.x, c.z); w.take(A.pid, c.id); stand(A, w.plots[2].x, w.plots[2].z); w.put(A.pid, c.id, 2); }
  ok(w.plots[2].queue.length === 6, 'six customers queue at one door');
  w.setMe(B.pid, { team: 'red' });
  const extra = w.newCard({ title: 'One too many', size: 'S' }, 'red'); w.toBacklog(extra);
  stand(B, extra.x, extra.z); w.take(B.pid, extra.id); stand(B, w.plots[2].x, w.plots[2].z);
  ok(code(() => w.put(B.pid, extra.id, 2)) === 'full', 'a seventh is refused: the queue is full');
  ok(w.setMe(B.pid, { team: 'blue' }).team === 'blue' && B.carry.length === 0 && w.cards.get(extra.id).state === 'backlog' && w.cards.get(extra.id).team === 'red', 'changing team drops what you were leading into the backlog you left');

  /* offers across teams */
  B.zone = 'k:1'; // B is at home for this part
  const wage = card(TITLE.wage, 'backlog', 'red');
  stand(A, wage.x, wage.z); w.take(A.pid, wage.id); stand(A, w.plots[1].x, w.plots[1].z);
  const offered = w.put(A.pid, wage.id, 1);
  ok(offered.state === 'offered' && offered.fromTeam === 'red' && offered.from === A.pid && w.plots[1].offers.includes(wage.id) && !w.plots[1].queue.includes(wage.id), 'another team\'s door takes an offer, not a queue place');
  ok(code(() => w.accept(A.pid, wage.id)) === 'owner' && code(() => w.take(C.pid, wage.id)) === 'taken', 'only the owner answers an offer, and nobody takes it meanwhile');
  ok(w.accept(B.pid, wage.id).state === 'seated' && w.cards.get(wage.id).team === 'blue' && w.cards.get(wage.id).from === A.pid && kb.orders.some(o => o.title === TITLE.wage), 'accepting moves the customer to the owner\'s team, and they walk in');
  const hol = card(TITLE.holiday, 'backlog', 'red');
  stand(A, hol.x, hol.z); w.take(A.pid, hol.id); stand(A, w.plots[1].x, w.plots[1].z); w.put(A.pid, hol.id, 1);
  ok(w.decline(B.pid, hol.id).state === 'backlog' && w.cards.get(hol.id).team === 'red', 'a declined offer goes back to the offering team\'s backlog');
  stand(A, w.cards.get(hol.id).x, w.cards.get(hol.id).z); w.take(A.pid, hol.id); stand(A, w.plots[1].x, w.plots[1].z); w.put(A.pid, hol.id, 1);
  ok(w.decline(A.pid, hol.id).state === 'backlog', 'whoever made an offer can withdraw it');
  stand(A, w.cards.get(hol.id).x, w.cards.get(hol.id).z); w.take(A.pid, hol.id); stand(A, w.plots[1].x, w.plots[1].z); w.put(A.pid, hol.id, 1);
  t += 31_000; w.tick();
  ok(w.cards.get(hol.id).state === 'backlog' && w.plots[1].offers.length === 0, 'an offer nobody answers goes back to the park');
  w.setSign(B.pid, 'private');
  stand(A, w.cards.get(hol.id).x, w.cards.get(hol.id).z); w.take(A.pid, hol.id); stand(A, w.plots[1].x, w.plots[1].z);
  ok(code(() => w.put(A.pid, hol.id, 1)) === 'sign' && A.carry.includes(hol.id), 'a private door refuses offers from other teams');
  w.put(A.pid, hol.id, null); w.setSign(B.pid, 'team');
  ok(w.feed.some(f => /offered .* to /.test(f.text)) && w.feed.some(f => / declined /.test(f.text)) && w.feed.every(f => !/undefined|null/.test(f.text)), 'every move is named in the feed');

  /* bounce */
  w.go(A.pid, 'k:0') ; stand(A, w.plots[0].x, w.plots[0].z); w.go(A.pid, 'k:0');
  const seated = w.cards.get(ot.id);
  ok(w.bounce(A.pid, seated.orderId).state === 'backlog' && !ka.orders.some(o => o.title === TITLE.overtime), 'bounce: a waiting order leaves the kitchen and its customer is back in the backlog');
  ka.orders[0].state = 'cooking'; w.kitchenChanged(A.pid);
  ok(card(TITLE.close, 'cooking') && code(() => w.bounce(A.pid, ka.orders[0].id)) === 'locked', 'bounce: once a chef has the ticket the customer stays');

  /* visitor rights by relation and door sign */
  const R = (p, plot) => { const r = w.rights(p.pid, plot); return `${r.relation}:${['cheer', 'answer', 'approve'].filter(k => r.rights[k]).join('+') || 'watch'}`; };
  ok(R(A, 0) === 'owner:answer+approve' && R(C, 0) === 'team:cheer+answer+approve' && R(B, 0) === 'stranger:cheer', 'open to team: a teammate answers and approves, a stranger watches and cheers');
  w.setSign(A.pid, 'help');
  ok(R(B, 0) === 'stranger:cheer+answer' && R(C, 0) === 'team:cheer+answer+approve', 'help wanted: a stranger may answer too, but not approve');
  w.setSign(A.pid, 'private');
  ok(R(B, 0) === 'stranger:watch' && R(C, 0) === 'team:watch' && R(A, 0) === 'owner:answer+approve', 'private: visitors only watch, and the owner keeps everything');
  w.setSign(A.pid, 'team');
  ok(code(() => w.allowed(C.pid, 0, 'answer')) === 'far', 'a right only counts while you stand in that kitchen');
  stand(C, w.plots[0].x, w.plots[0].z); stand(B, w.plots[0].x, w.plots[0].z);
  ok(w.go(C.pid, 'k:0').zone === 'k:0' && w.go(B.pid, 'k:0').zone === 'k:0' && w.allowed(C.pid, 0, 'answer') === A && code(() => w.allowed(B.pid, 0, 'answer')) === 'sign', 'inside, the teammate may answer and the stranger may not');
  ok(w.go(B.pid, 'k:2').refused === 'far', 'you cannot walk from one kitchen straight into another');

  /* cheers */
  const before = w.plots[0].bonus;
  for (let i = 0; i < 5; i++) w.cheer(B.pid, 0);
  ok(w.plots[0].bonus === before + 25 && code(() => w.cheer(B.pid, 0)) === 'cooldown' && code(() => w.cheer(A.pid, 0)) === 'sign', 'a cheer is +5 to the owner, five a minute, and never for yourself');

  /* referral, and the rush */
  w.go(C.pid, 'park'); stand(C, w.plots[2].x, w.plots[2].z); w.go(C.pid, 'k:2');
  const sent = w.cards.get(ot2.id);
  ok(sent.state === 'seated' && sent.plot === 2, 'the customers A sent are seated once C is home');
  w.setMe(A.pid, { name: 'Ana' });
  kc.orders.find(o => o.id === sent.orderId).state = 'shipped'; kc.shipped = 1; kc.score = 150;
  const bonusA = w.plots[0].bonus;
  w.kitchenChanged(C.pid);
  let snap = w.snapshot();
  ok(sent.state === 'served' && w.plots[0].bonus === bonusA + 25 && snap.team.shipped === 1 && snap.plots[2].score === 150 && snap.plots[2].shipped === 1, 'a served card counts for the town, and the sender earns the +25 referral');
  ok(snap.teams[0].score === snap.plots[0].bonus + snap.plots[2].bonus + 150 && snap.team.score === snap.plots.reduce((n, p) => n + p.score + p.bonus, 0), 'team and town scores add up from the plots');

  w.go(A.pid, 'park');
  ok(code(() => w.ring(A.pid)) === 'far', 'the bell needs you at the fountain');
  stand(A, 1, 1);
  const rush = w.ring(A.pid);
  ok(rush.left === 6 && [...w.cards.values()].filter(c => c.rush).length === 6 && code(() => w.ring(A.pid)) === 'cooldown', 'the bell brings two walk-ins per player and then rests');
  // Everybody seats their walk-ins before the bus leaves.
  for (const c of [...w.cards.values()].filter(x => x.rush)) {
    const who = c.team === 'red' ? A : B, door = w.plots[who.plot];
    stand(who, c.x, c.z); w.take(who.pid, c.id); stand(who, door.x, door.z); w.put(who.pid, c.id, who.plot);
  }
  const bonuses = w.plots.slice(0, 3).map(p => p.bonus);
  t += 31_000; w.tick();
  ok(w.snapshot().rush.left === 0 && w.plots.slice(0, 3).every((p, i) => p.bonus === bonuses[i] + 100) && w.feed.some(f => /Full house/.test(f.text)), 'nobody left standing when the bus goes: Full house, +100 each');
  const cooking = card(TITLE.close, 'cooking');
  ka.orders.find(o => o.id === cooking.orderId).state = 'shipped';
  const bonusBefore = w.plots[0].bonus;
  w.kitchenChanged(A.pid);
  ok(w.plots[0].bonus === bonusBefore + 50, 'a ship during the rush earns half as much again (+50 for a small dish)');
  t += 31_000; w.tick();
  ok(w.snapshot().rush === null, 'the rush ends');

  /* presence */
  stand(A, 0, 0); A.at = t;
  t += 100; w.move(A.pid, 1900, 0, 157, 1);
  ok(A.x > 0 && A.x <= 14 * 0.1 + 0.6 + 1e-9, `a position that jumps across the park is pulled back to walking speed (moved ${A.x.toFixed(2)})`);
  t += 100; w.move(A.pid, 99_999, 99_999, 0, 0);
  ok(A.x <= PARK.w / 2 + 1 && A.z <= PARK.h / 2 + 1, 'and never leaves the park');
  w.emote(A.pid, 3);
  let frame = w.frame(false).get('park');
  ok(frame.some(p => p[0] === A.pid && p.length === 6 && Number.isInteger(p[1]) && p[5] === 3), 'a presence frame is [pid, x, z, r, m, e] in centimetres');
  ok(!w.frame(false).get('park') && w.frame(true).get('park').length >= 1, 'only players that changed are sent, except in a full frame');
  t += 3000; w.tick();
  ok(A.e === 0, 'an emote clears by itself');

  /* names */
  ok(cleanName('  Ana   Banana  ') === 'Ana Banana' && cleanName('x'.repeat(40)).length === 14 && cleanName('<b>Zoë</b>') === 'bZoëb' && cleanName('') === null && cleanName(42) === null, 'names are trimmed to 14 plain characters');
  ok(cleanName('sh1t chef') === null && cleanName('F.u.c.k') === null && code(() => w.setMe(B.pid, { name: 'fuuuck' })) === 'name', 'rude names are refused');

  /* a fresh kitchen, and leaving */
  const kc2 = fakeKitchen();
  const waiting = [...w.cards.values()].filter(c => c.plot === 2 && c.state !== 'served').length;
  ok(waiting >= 2, 'C has customers waiting before the fresh kitchen');
  w.plots[2].bonus = 40;
  w.refresh(C.pid, kc2.link);
  ok(C.plot === 2 && w.plots[2].owner === C.pid && w.plots[2].bonus === 0 && kc2.orders.length === 1 && kc2.orders[0].title === TITLE.close && [...w.cards.values()].filter(c => c.plot === 2 && c.state !== 'served').length === 1, 'a fresh kitchen keeps the plot, returns its customers to the backlog and seats the first dish again');

  stand(B, w.plots[0].x, w.plots[0].z); w.go(B.pid, 'park'); stand(B, w.plots[2].x, w.plots[2].z); w.go(B.pid, 'k:2');
  moved.length = 0;
  w.leave(C.pid);
  snap = w.snapshot();
  ok(snap.plots[2].owner === null && snap.plots[2].queue.length === 0 && !snap.players.some(p => p.pid === C.pid) && !snap.cards.some(c => c.plot === 2 && c.state !== 'served'), 'leaving frees the plot and sends its unfinished customers back to the backlog');
  ok(moved.length === 1 && moved[0].pid === B.pid && moved[0].zone === 'park' && B.zone === 'park', 'a visitor in a kitchen that closes is put back in the park');
  const D = w.join({ link: fakeKitchen().link });
  ok(D.plot === 2 && D.team === 'red', 'the freed plot and the smaller team go to the next player');

  w.addBots(27);
  t += 500; w.tick();
  snap = w.snapshot();
  const size = JSON.stringify(snap).length;
  ok(snap.players.filter(p => p.bot).length === 27 && snap.players.filter(p => p.bot).every(p => p.plot === null && p.zone === 'park') && w.frame(false).get('park').length >= 27, `27 bots wander the park without a kitchen (snapshot ${(size / 1024).toFixed(1)} KB)`);
  ok(!JSON.stringify(snap).includes('ship_sid') && !('you' in snap), 'the snapshot knows players only by pid');
}

/* ================= part 2: the real server, three cookie jars ================= */

const freePort = () => new Promise((resolve, reject) => {
  const probe = net.createServer().once('error', reject).listen(0, '127.0.0.1', () => { const { port } = probe.address(); probe.close(() => (port > 10080 ? resolve(port) : freePort().then(resolve, reject))); });
});

function start(port, env) {
  const child = spawn(process.execPath, ['server/index.mjs', '--public'], {
    cwd: root,
    env: {
      ...process.env, SHIP_SIM: '', SHIP_DEMO: '', SHIP_SIM_ASK: '', SHIP_SIM_SPEED: '10', SHIP_PACE: '80', SHIP_HOST: '127.0.0.1', SHIP_WORLD: '', SHIP_WORLD_BOTS: '',
      SHIP_REAL_CHEFS: 'query,pixel', ANTHROPIC_API_KEY: 'not-a-real-key', PORT: String(port), ...env,
    },
    stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true,
  });
  child.stdout.on('data', d => { log += d; }); child.stderr.on('data', d => { log += d; });
  servers.push(child);
  return child;
}

/** Everything any player was sent, so the end of the test can prove what was never in it. */
const seen = [];

/** One player: a browser's cookie jar, one socket, and the last town and kitchen the server pushed. */
function visitor(port) {
  const base = `http://127.0.0.1:${port}`;
  const v = {
    cookie: '', sid: null, ws: null, w: null, s: null, own: null, visit: null, zone: null, pos: null, msgs: [], closed: null,
    get pid() { return v.w?.you.pid; },
    get plot() { return v.w?.you.plot; },
    headers: extra => ({ ...(v.cookie ? { cookie: v.cookie } : {}), ...extra }),
    /** Loads the page, keeps the cookie, opens the socket and waits for the first town and kitchen. */
    open: async () => {
      const res = await fetch(base + '/', { headers: v.headers() });
      const set = res.headers.getSetCookie();
      if (set.length) { v.cookie = set[0].split(';')[0]; v.sid = v.cookie.split('=')[1]; }
      await res.text();
      Object.assign(v, { w: null, s: null, own: null, visit: null, zone: null, closed: null });
      v.ws = new WebSocket(`ws://127.0.0.1:${port}/ws`, { headers: v.headers() });
      v.ws.on('message', d => {
        const text = String(d); seen.push(text);
        const m = JSON.parse(text); v.msgs.push(m);
        if (m.type === 'world') v.w = m.world;
        else if (m.type === 'state') { if (m.of === undefined || m.relation === 'owner') { v.s = m.state; v.own = m; } else v.visit = m; }
        else if (m.type === 'zone') v.zone = m;
        else if (m.type === 'p') { const me = m.ps.find(p => p[0] === v.pid); if (me) v.pos = { zone: m.z, x: me[1] / 100, z: me[2] / 100 }; }
      });
      v.ws.on('close', c => { v.closed = c; });
      v.ws.on('error', () => {});
      await v.until(() => v.w && v.s, 'the first town and kitchen');
      return res;
    },
    until: async (done, what, ms = 30000) => {
      const end = Date.now() + ms;
      while (Date.now() < end) { const hit = done(); if (hit) return hit; await sleep(30); }
      throw new Error(`Timed out waiting for ${what}`);
    },
    raw: async (method, p, b) => {
      const res = await fetch(base + p, { method, headers: v.headers(method === 'POST' ? { 'content-type': 'application/json' } : {}), ...(method === 'POST' ? { body: JSON.stringify(b || {}) } : {}) });
      const text = await res.text(); seen.push(text);
      let json = {}; try { json = JSON.parse(text); } catch { /* a page */ }
      return { status: res.status, ...json };
    },
    get: p => v.raw('GET', p),
    post: (p, b) => v.raw('POST', p, b),
    /** POSTs and insists on success. */
    must: async (p, b) => { const r = await v.post(p, b); if (r.status !== 200 && r.status !== 202) throw new Error(`${p}: ${r.status} ${r.code || ''} ${r.error}`); return r; },
    send: m => v.ws.send(JSON.stringify(m)),
    go: async z => { v.zone = null; v.send({ t: 'go', z }); return v.until(() => v.zone, `an answer to go ${z}`); },
    /** Walks there the way a client does: position messages at walking speed until the server agrees. */
    walk: async (x, z) => {
      const at = () => v.pos && v.pos.zone === 'park' && Math.hypot(v.pos.x - x, v.pos.z - z) < 0.05;
      for (let i = 0; i < 200 && !at(); i++) { v.send({ t: 'p', x: Math.round(x * 100), z: Math.round(z * 100), r: 0, m: 1 }); await sleep(85); }
      if (!at()) throw new Error(`Could not walk to ${x}, ${z}`);
    },
    card: (title, state, team) => v.w.cards.find(c => c.title === title && (!state || c.state === state) && (!team || c.team === team)),
    cardById: id => v.w.cards.find(c => c.id === id),
    waitCard: (title, state, team) => v.until(() => v.card(title, state, team), `"${title}" to be ${state}`),
    /** Walks to a backlog customer and leads them away. */
    fetchCard: async (title, team) => { const c = await v.waitCard(title, 'backlog', team); await v.walk(c.x, c.z); await v.must(`/api/world/cards/${c.id}/take`); return c; },
    toDoor: async plot => { const p = v.w.plots[plot]; await v.walk(p.x, p.z); },
    /** Polls the pushed kitchen state, answering every chef question as the owner, until done. */
    cook: async (done, what, ms = 40000) => {
      const end = Date.now() + ms, answered = new Set();
      while (Date.now() < end) {
        const hit = done(v.s);
        if (hit) return hit;
        for (const q of v.s.questions) {
          if (answered.has(q.id)) continue;
          answered.add(q.id);
          await v.post(`/api/questions/${q.id}/answer`, q.kind === 'question' ? { allow: true, answers: Object.fromEntries(q.questions.map(x => [x.question, x.options[0].label])) } : { allow: false, message: 'No new dependencies' });
        }
        await sleep(50);
      }
      throw new Error(`Timed out waiting for ${what}`);
    },
    order: title => v.s.orders.find(o => o.title === title),
  };
  return v;
}

const health = async port => (await fetch(`http://127.0.0.1:${port}/healthz`)).json();
async function up(port) {
  for (let i = 0; i < 80; i++) { try { return await health(port); } catch { await sleep(150); } }
  throw new Error(`No public kitchen on ${port}`);
}
const run = (args, env) => new Promise(resolve => {
  const child = spawn(process.execPath, args, { cwd: root, env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
  let out = '';
  child.stdout.on('data', d => { out += d; }); child.stderr.on('data', d => { out += d; });
  child.on('exit', status => resolve({ status, out }));
});

async function wire() {
  console.log('\nTown protocol checks');
  const PORT = await freePort(), IDLE_PORT = await freePort();
  const TOKEN = 'presenter-token-for-the-test', townFile = path.join(tmp, 'town.json');
  start(PORT, { SHIP_SESSIONS_DIR: path.join(tmp, 'sessions'), SHIP_TOWN_FILE: townFile, SHIP_RESET_TOKEN: TOKEN, SHIP_RUSH_S: '4', SHIP_BELL_S: '60', SHIP_TEAMS: '2' });
  start(IDLE_PORT, { SHIP_SESSIONS_DIR: path.join(tmp, 'idle-sessions'), SHIP_TOWN_FILE: path.join(tmp, 'idle-town.json'), SHIP_IDLE_MIN: '0.05', SHIP_WORLD_BOTS: '5' }); // idle after 3 s

  let h = await up(PORT);
  ok(h.ok && h.world === true && h.players === 0 && h.kitchens === 0 && h.max === 24, 'the town starts empty, with room for 24 kitchens');
  ok(/chefs:\s+simulated/.test(log) && !/Claude Agent SDK/.test(log), 'every chef is simulated although SHIP_REAL_CHEFS and an API key are set');

  /* ---------- joining ---------- */
  const a = visitor(PORT), b = visitor(PORT), c = visitor(PORT);
  await a.open(); await b.open(); await c.open();
  await a.until(() => a.w.players.length === 3, 'A to see three players');
  ok([a, b, c].every(v => /^[a-f0-9]{6}$/.test(v.pid)) && a.plot === 0 && b.plot === 1 && c.plot === 2 && a.w.plots.length === 24, 'three visitors get a pid and neighbouring plots');
  ok(a.w.you.team === 'red' && b.w.you.team === 'blue' && c.w.you.team === 'red' && a.w.teams.length === 2 && a.w.teams.every(t => t.name && t.project && /^#[0-9a-f]{6}$/.test(t.color) && t.area), 'teams are assigned on join: A and C are red, B is blue');
  ok(a.own.of === 0 && a.own.relation === 'owner' && a.own.rights.approve === true && a.s.driver === 'sim' && a.s.chefs.every(ch => ch.driver === 'sim'), 'your own kitchen state says which plot it is, and its chefs are simulated');
  ok(a.s.orders.length === 1 && a.s.orders[0].title === TITLE.close && a.s.orders[0].cardId === a.card(TITLE.close, 'seated').id && a.card(TITLE.close, 'seated').plot === 0, 'the first customer is already at each player\'s window, as a town card');
  ok(a.s.restart === '/api/demo/restart' && a.s.commits === 1 && a.s.escalation.smokeMs === 20000 * 2.4 / 80 && a.s.escalation.everyMs === 10000 * 2.4 / 80, 'the kitchen snapshot advertises restart, counts commits on main and gives the demo a longer grace');
  const got = await a.get('/api/world');
  ok(got.status === 200 && got.you.pid === a.pid && got.plots.length === 24 && (await health(PORT)).players === 3, 'GET /api/world answers the same town, and /healthz counts the players');

  /* ---------- bounce: a waiting order goes back to the park ---------- */
  const firstCard = a.s.orders[0].cardId;
  const bounced = await a.must('/api/orders/1/bounce');
  await a.until(() => a.s.orders.length === 0 && a.cardById(firstCard).state === 'backlog', 'the bounced card in the backlog');
  ok(bounced.card.state === 'backlog' && bounced.card.team === 'red' && a.cardById(firstCard).plot === null, 'bounce returns a waiting order\'s customer to the team backlog');

  /* ---------- zones and proximity ---------- */
  ok((await a.post(`/api/world/cards/${firstCard}/take`)).code === 'far', 'take from inside your kitchen is refused: 409 far');
  const out = await a.go('park');
  ok(out.zone === 'park' && out.x === a.w.plots[0].x && out.z === a.w.plots[0].z, 'going out answers with your doormat');
  ok((await a.go('k:1')).refused === 'far', 'entering a kitchen from across the park is refused');
  await b.go('park'); await c.go('park');
  await a.until(() => a.w.plots.slice(0, 3).every(p => !p.open), 'three back-soon signs');
  const close = a.cardById(firstCard);
  const far = await a.post(`/api/world/cards/${firstCard}/take`);
  ok(far.status === 409 && far.code === 'far', 'take needs proximity: 409 far from the doormat');
  ok((await b.post(`/api/world/cards/${firstCard}/take`)).status === 403, 'another team cannot take from the red backlog: 403 team');
  await a.walk(close.x, close.z); await c.walk(close.x, close.z);
  ok((await a.post(`/api/world/cards/${firstCard}/take`)).card?.heldBy === a.pid, 'A walks up and takes the customer');
  const second = await c.post(`/api/world/cards/${firstCard}/take`);
  ok(second.status === 409 && second.code === 'taken', 'a second taker gets 409');
  await b.until(() => b.cardById(firstCard).state === 'held' && b.w.players.find(p => p.pid === a.pid).carry.includes(firstCard), 'B to see the card leave the backlog');
  ok(b.cardById(firstCard).heldBy === a.pid && b.w.feed.some(f => f.text.includes('claimed')), 'everyone is pushed the move, and the feed names it');
  await b.send({ t: 'p', x: 0, z: 0, r: 0, m: 0 });
  await b.until(() => b.msgs.some(m => m.type === 'p' && m.z === 'park' && m.ps.some(p => p[0] === a.pid)), 'B to see A in the park');
  ok(b.msgs.filter(m => m.type === 'p').every(m => m.ps.every(p => p.length === 6 && p.every(n => typeof n === 'string' || Number.isInteger(n)))), 'B sees A move: presence frames are [pid, x, z, r, m, e]');

  /* ---------- the dish rule ---------- */
  await a.toDoor(2);
  const dish = await a.post(`/api/world/cards/${firstCard}/put`, { plot: 2 });
  ok(dish.status === 409 && dish.code === 'dish' && /already serves that/.test(dish.error), `the dish rule refuses: "${dish.error}"`);

  /* ---------- your own queue, and admission only while you are inside ---------- */
  const overtime = await a.fetchCard(TITLE.overtime, 'red');
  const third = await a.waitCard(TITLE.sunday, 'backlog', 'red');
  await a.walk(third.x, third.z);
  ok((await a.post(`/api/world/cards/${third.id}/take`)).code === 'hands', 'a third customer is refused: 409 hands');
  await a.toDoor(0);
  ok((await a.must(`/api/world/cards/${firstCard}/put`, { plot: 0 })).card.state === 'queued' && (await a.must(`/api/world/cards/${overtime.id}/put`, { plot: 0 })).card.state === 'queued', 'A queues two customers at their own door');
  await sleep(1500);
  ok(a.cardById(firstCard).state === 'queued' && a.cardById(overtime.id).state === 'queued' && a.s.orders.length === 0 && a.w.plots[0].queue.length === 2, 'nobody is admitted while the owner is in the park');

  /* ---------- same team: one shared backlog ---------- */
  await c.toDoor(0); await b.toDoor(0);
  ok((await b.post(`/api/world/cards/${overtime.id}/take`)).status === 403, 'another team cannot take from A\'s door queue: 403');
  ok((await c.must(`/api/world/cards/${overtime.id}/take`)).card.heldBy === c.pid, 'a teammate takes a customer from A\'s door queue');
  const back = await c.must(`/api/world/cards/${overtime.id}/put`, { plot: 0 });
  ok(back.card.state === 'queued' && back.card.from === c.pid, 'and hands them back, queued at once');

  ok((await a.go('k:0')).zone === 'k:0', 'A goes home');
  await a.until(() => a.s.orders.length === 2 && a.cardById(overtime.id).state === 'seated' && a.cardById(firstCard).state === 'seated', 'both customers seated');
  ok(a.w.plots[0].open && a.w.plots[0].queue.length === 0 && a.order(TITLE.overtime).cardId === overtime.id, 'the queue walks in once the owner is inside, as kitchen orders');
  const locked = await c.post(`/api/world/cards/${overtime.id}/take`);
  ok(locked.status === 409 && locked.code === 'locked', 'a seated card cannot be taken: 409 locked');

  /* ---------- another team: offer, accept, decline ---------- */
  const sunday = await c.fetchCard(TITLE.sunday, 'red');
  await c.toDoor(1);
  const offer = await c.must(`/api/world/cards/${sunday.id}/put`, { plot: 1 });
  await b.until(() => b.w.plots[1].offers.includes(sunday.id), 'B to see the offer');
  ok(offer.card.state === 'offered' && offer.card.fromTeam === 'red' && offer.card.from === c.pid && !b.w.plots[1].queue.includes(sunday.id), 'a customer put at another team\'s door is an offer from the Red team');
  ok((await a.post(`/api/world/cards/${sunday.id}/accept`)).status === 403, 'only the door\'s owner can accept');
  const accepted = await b.must(`/api/world/cards/${sunday.id}/accept`);
  ok(accepted.card.state === 'queued' && accepted.card.team === 'blue' && accepted.card.from === c.pid, 'B accepts: the customer joins B\'s queue and the Blue team');
  const exp = await c.fetchCard(TITLE.export, 'red');
  await c.toDoor(1);
  await c.must(`/api/world/cards/${exp.id}/put`, { plot: 1 });
  const declined = await b.must(`/api/world/cards/${exp.id}/decline`);
  ok(declined.card.state === 'backlog' && declined.card.team === 'red', 'B declines: the customer is back in the Red backlog');
  await b.must('/api/world/sign', { sign: 'private' });
  await c.until(() => c.cardById(exp.id).state === 'backlog' && c.w.plots[1].sign === 'private', 'the private sign');
  await c.walk(c.cardById(exp.id).x, c.cardById(exp.id).z); await c.must(`/api/world/cards/${exp.id}/take`); await c.toDoor(1);
  const priv = await c.post(`/api/world/cards/${exp.id}/put`, { plot: 1 });
  ok(priv.status === 403 && priv.code === 'sign', 'a private door refuses another team\'s offer: 403 sign');
  ok((await c.must(`/api/world/cards/${exp.id}/put`, { plot: null })).card.state === 'backlog', 'Q anywhere drops the customer back into the backlog');
  await b.must('/api/world/sign', { sign: 'team' });

  /* ---------- a referral: C sends A a customer, A ships it ---------- */
  const sunday2 = await c.fetchCard(TITLE.sunday, 'red');
  await c.toDoor(0);
  ok((await c.must(`/api/world/cards/${sunday2.id}/put`, { plot: 0 })).card.from === c.pid, 'C sends a second Sunday to A\'s door');
  await a.until(() => a.order(TITLE.sunday), 'the sent customer at A\'s window');
  const sunId = a.order(TITLE.sunday).id, otId = a.order(TITLE.overtime).id;
  await a.must(`/api/orders/${sunId}/assign`, { chefId: 'pixel' });
  await a.must(`/api/orders/${otId}/assign`, { chefId: 'query' });
  await a.until(() => a.cardById(sunday2.id).state !== 'seated', 'the card to follow its order');
  ok(['cooking', 'review'].includes(a.cardById(sunday2.id).state), 'a card follows its order onto the line');

  /* ---------- visiting: rights by relation and door sign ---------- */
  await a.until(() => a.s.questions.some(q => q.orderId === otId), 'the Overtime chef to ask');
  const q = a.s.questions.find(x => x.orderId === otId);
  await a.until(() => a.w.plots[0].lights.blocked === 1 && a.w.plots[0].lights.since, 'the blocked light outside');
  ok(a.w.plots[0].lights.blocked === 1, 'a blocked chef shows on the restaurant\'s lights in the park');
  const bIn = await b.go('k:0'), cIn = await c.go('k:0');
  await b.until(() => b.visit && c.visit, 'the visitors\' kitchen states');
  ok(bIn.zone === 'k:0' && cIn.zone === 'k:0' && b.visit.of === 0 && b.visit.relation === 'stranger' && c.visit.relation === 'team', 'B and C step into A\'s kitchen and are sent its state');
  ok(!('repo' in b.visit.state) && b.visit.state.questions.every(x => !('input' in x)) && b.visit.state.orders.some(o => o.title === TITLE.overtime) && b.s.orders.every(o => o.title !== TITLE.overtime), 'a visitor\'s copy has no repo and no command input, and their own kitchen state still arrives separately');
  ok(b.visit.rights.cheer && !b.visit.rights.answer && !b.visit.rights.approve && c.visit.rights.answer && c.visit.rights.approve, 'open to team: the stranger may cheer, the teammate may answer and approve');
  const answers = { allow: true, answers: Object.fromEntries(q.questions.map(x => [x.question, x.options[0].label])) };
  const noAnswer = await b.post(`/api/world/kitchens/0/questions/${q.id}/answer`, answers);
  ok(noAnswer.status === 403 && noAnswer.code === 'sign' && a.s.questions.some(x => x.id === q.id), 'a stranger cannot answer a ? bubble: 403 sign');
  await a.must('/api/world/sign', { sign: 'private' });
  await c.until(() => c.visit.rights.answer === false, 'the private sign to reach the visitors');
  ok((await c.post(`/api/world/kitchens/0/questions/${q.id}/answer`, answers)).code === 'sign' && (await b.post('/api/world/cheer', { plot: 0 })).code === 'sign', 'private: even a teammate only watches, and nobody cheers');
  await a.must('/api/world/sign', { sign: 'help' });
  await b.until(() => b.visit.rights.answer === true, 'help wanted to reach the stranger');
  ok((await b.post(`/api/world/kitchens/0/questions/${q.id}/answer`, answers)).status === 200, 'help wanted: the stranger answers the ? bubble');
  await a.until(() => !a.s.questions.some(x => x.id === q.id), 'the question to clear');
  ok((await b.post(`/api/world/kitchens/0/questions/${q.id}/answer`, answers)).status === 404, 'an answered question is gone');
  const cheered = await b.must('/api/world/cheer', { plot: 0 });
  ok(cheered.bonus === 5 && (await a.post('/api/world/cheer', { plot: 0 })).status === 403, 'a visitor\'s cheer is +5 for the owner, and nobody cheers themselves');

  await a.cook(s => s.orders.find(o => o.id === otId && o.state === 'at_pass') && s.orders.find(o => o.id === sunId && o.state === 'at_pass'), 'both plates at the pass');
  ok((await b.post(`/api/world/kitchens/0/orders/${otId}/review`, { verdict: 'approve' })).code === 'sign' && (await b.get(`/api/world/kitchens/0/orders/${otId}/diff`)).status === 403, 'a stranger cannot approve at the pass or read the diff');
  ok((await c.post(`/api/world/kitchens/0/orders/${otId}/review`, { verdict: 'send_back', comment: 'no' })).code === 'owner', 'a teammate cannot send a plate back: that is the owner\'s');
  const diff = await c.get(`/api/world/kitchens/0/orders/${otId}/diff`);
  ok(diff.status === 200 && diff.patch.includes('diff --git') && (await c.post(`/api/world/kitchens/0/orders/${otId}/review`, { verdict: 'approve' })).status === 200, 'a teammate reads the diff and approves at the pass');
  await a.until(() => a.s.orders.find(o => o.id === otId).approved, 'the approval in A\'s kitchen');
  const cShip = await c.post(`/api/orders/${otId}/ship`, { seen: true });
  ok(cShip.status !== 200 && a.s.orders.find(o => o.id === otId).state === 'at_pass', 'a visitor\'s ship goes to their own kitchen: only the owner ships at the hatch');
  /* ---------- renaming a chef: the owner's only ---------- */
  ok((await c.post('/api/world/kitchens/0/chefs/pixel', { name: 'Hijack' })).status === 404 && (await b.post('/api/world/kitchens/0/chefs/pixel', { name: 'Hijack' })).status === 404, 'there is no route for a visitor to rename a chef, teammate or not');
  const mine = await c.must('/api/chefs/pixel', { name: 'Clove' });
  await c.until(() => c.s.chefs[0].name === 'Clove', 'C\'s renamed chef');
  ok(mine.chef.name === 'Clove' && a.s.chefs[0].name === 'Pixel' && c.visit.state.chefs[0].name === 'Pixel', 'a visitor\'s rename goes to their own kitchen, and the kitchen they stand in keeps its names');
  const own = await a.must('/api/chefs/query', { name: 'Basil' });
  await c.until(() => c.visit.state.chefs[2].name === 'Basil' && c.w.feed.some(f => / chef Query is now Basil/.test(f.text)), 'the rename in the town feed');
  ok(own.chef.name === 'Basil' && a.s.orders.find(o => o.id === otId).activity.some(x => x.text === 'Query is now Basil') && (await a.post('/api/chefs/query', { name: 'pixel' })).code === 'taken' && (await a.post('/api/chefs/query', { name: 'sh1t' })).code === 'name', 'the owner renames a chef: visitors see it, the town feed and the order\'s activity name it, and a bad name is refused');

  const visitorStaff = [(await c.post('/api/world/kitchens/0/chefs', { rank: 'commis' })).status, (await c.post('/api/world/kitchens/0/chefs/pixel/rank', { rank: 'commis' })).status, (await c.post('/api/world/kitchens/0/chefs/pixel/dismiss')).status];
  const hiredC = await c.must('/api/chefs', { rank: 'commis', name: 'Dill' });
  await c.until(() => c.s.chefs.length === 5 && c.w.feed.some(f => / hired Dill as a Commis/.test(f.text)), 'the hire in the town feed');
  ok(visitorStaff.join() === '404,404,404' && a.s.chefs.length === 4 && a.s.chefs.every(ch => ch.rank === 'sous') && c.s.chefs[4].rank === 'commis' && c.s.hiring.cost === 50 && c.s.stats.points.some(x => x.why === 'Hired Dill, Commis' && x.n === -50), 'a visitor cannot hire, re-rank or dismiss in the kitchen they stand in; their own hire costs 50 points and the town feed names it');
  await c.must(`/api/chefs/${hiredC.chef.id}/rank`, { rank: 'line' });

  const peek = await b.get('/api/world/kitchens/0');
  ok(peek.status === 200 && peek.relation === 'stranger' && !('repo' in peek.state), 'a visitor can read the kitchen they stand in');
  await b.go('park');
  ok((await b.get('/api/world/kitchens/0')).code === 'far', 'and not from outside');

  /* ---------- ship: served card, town score, referral ---------- */
  await a.must(`/api/orders/${sunId}/review`, { verdict: 'approve' });
  ok((await a.must(`/api/orders/${sunId}/ship`, { seen: true })).shipped === true, 'A ships the Sunday plate');
  await a.until(() => a.cardById(sunday2.id).state === 'served' && a.s.commits > 1, 'the served card');
  ok(a.w.team.shipped === 1 && a.w.plots[0].shipped === 1 && a.w.plots[0].score > 0 && a.w.plots[2].bonus === 25, 'the card is served, the town counter ticks, and C earns the +25 referral');
  ok(a.w.teams.find(t => t.id === 'red').score === a.w.plots[0].score + a.w.plots[0].bonus + a.w.plots[2].score + a.w.plots[2].bonus && a.s.commits === 3, 'the Red team\'s score is its plots\' scores and bonuses; main has 3 commits');
  ok(['offered', 'accepted', 'took', 'claimed', 'served', 'referral'].every(word => a.w.feed.some(f => f.text.includes(word)) || a.msgs.some(m => m.type === 'world' && m.world.feed.some(f => f.text.includes(word)))), 'the feed named every move');

  /* ---------- the bell ---------- */
  await a.go('park');
  ok((await a.post('/api/world/bell')).code === 'far', 'the bell is out of reach from the doormat');
  await a.walk(0.5, 0.5);
  const bell = await a.must('/api/world/bell');
  ok(bell.rush.left === 6 && bell.rush.endsAt > bell.rush.seatBy && (await a.post('/api/world/bell')).status === 429, 'the bell starts the lunch rush with two walk-ins per player, then rests');
  await a.until(() => a.w.rush && a.w.cards.filter(x => x.rush).length === 6, 'the rush in the town');
  await a.until(() => a.w.rush === null, 'the rush to end', 8000);
  ok(a.w.feed.some(f => /bus left/.test(f.text)) && a.w.cards.filter(x => x.rush && x.state === 'backlog').length === 6, 'the bus leaves, and the walk-ins nobody seated stay in the backlog');

  /* ---------- a fresh kitchen ---------- */
  const before = c.msgs.length;
  ok((await c.post('/api/demo/restart')).status === 200, 'C asks for a fresh kitchen');
  await c.until(() => c.msgs.slice(before).some(m => m.type === 'fresh') && c.s.orders.length === 0 && c.s.stats.score === 0, 'the fresh kitchen');
  await c.until(() => c.card(TITLE.close, 'queued')?.plot === 2, 'the first dish back at C\'s door');
  ok(c.s.chefs.map(ch => ch.name).join() === 'Pixel,Router,Query,Stack' && c.s.chefs.every(ch => ch.rank === 'sous'), 'a fresh kitchen puts back the default four Sous Chefs, with their names');
  ok(c.w.you.plot === 2 && c.w.you.pid === c.pid && c.w.plots[2].owner === c.pid && c.w.plots[2].bonus === 0 && c.s.commits === 1, 'C keeps the plot and pid; the kitchen, repo and world bonus start over');
  await c.go('park'); await c.toDoor(2); await c.go('k:2');
  await c.until(() => c.s.orders.length === 1 && c.s.orders[0].title === TITLE.close, 'the first dish seated in the fresh kitchen');
  await c.until(() => c.w.cards.some(x => x.title === TITLE.close && x.state === 'seated' && x.plot === 2), 'the seated card in the town');
  ok(c.s.orders[0].cardId === c.w.cards.find(x => x.state === 'seated' && x.plot === 2).id, 'and the first dish walks into the fresh kitchen');

  /* ---------- idle: leaving frees the plot ---------- */
  await up(IDLE_PORT);
  const d = visitor(IDLE_PORT), e = visitor(IDLE_PORT);
  await d.open(); await e.open();
  await d.until(() => d.w.plots[1].owner === e.pid, 'D to see E\'s restaurant');
  const eFirst = d.card(TITLE.close, 'seated', 'blue').id;
  ok((await health(IDLE_PORT)).players === 7, 'five bots and two players are in the idle town');
  await d.go('park');
  await d.until(() => d.msgs.some(m => m.type === 'p' && m.z === 'park' && m.ps.filter(p => p[0].startsWith('b')).length >= 5), 'the bots in D\'s presence frames');
  ok(d.w.players.filter(p => p.bot).length === 5, 'SHIP_WORLD_BOTS adds wandering bots that D sees in the park');
  e.ws.close();
  const alive = setInterval(() => d.send({ t: 'p', x: -225, z: -830, r: 0, m: 0 }), 400);
  try { await d.until(() => d.w.plots[1].owner === null, 'E\'s plot to be freed', 15000); } finally { clearInterval(alive); }
  ok(!d.w.players.some(p => p.pid === e.pid) && d.cardById(eFirst).state === 'backlog' && d.cardById(eFirst).plot === null && d.w.plots[0].owner === d.pid, 'leaving frees the plot and returns its cards, while D\'s heartbeat keeps D\'s kitchen open');
  ok((await e.get('/api/world')).status === 401, 'the closed session opens nothing');

  /* ---------- the presenter's reset ---------- */
  const wrong = await a.post('/api/world/reset', { token: 'not-the-token' });
  ok(wrong.status === 403 && wrong.code === 'token' && (await a.post('/api/world/reset', {})).status === 403 && (await health(PORT)).kitchens === 3, 'a reset with the wrong token, or none, is refused');
  const file = JSON.parse(await fs.readFile(townFile, 'utf8'));
  ok(file.token === TOKEN && file.port === PORT, 'the server left the town file for `npm run reset`');
  const reset = await run(['server/reset.mjs'], { SHIP_TOWN_FILE: townFile, SHIP_RESET_TOKEN: '' });
  ok(reset.status === 0 && /3 kitchens closed/.test(reset.out) && !reset.out.includes(TOKEN), `npm run reset: ${reset.out.trim()}`);
  await a.until(() => [a, b, c].every(v => v.closed === 4002), 'every socket to close');
  ok([a, b, c].every(v => v.msgs.at(-1).type === 'reset'), 'every client is told to reload, and its socket closes with 4002');
  h = await health(PORT);
  ok(h.kitchens === 0 && h.players === 0 && (await a.get('/api/world')).status === 401 && (await fs.readdir(path.join(tmp, 'sessions'))).filter(n => !n.startsWith('.')).length === 0, 'the town is empty: no kitchens, no players, no repos, and old cookies open nothing');
  const oldPid = a.pid, oldSid = a.sid;
  a.msgs.length = 0;
  await a.open();
  ok(a.sid !== oldSid && a.pid !== oldPid && a.plot === 0 && a.w.plots.filter(p => p.owner).length === 1 && a.w.team.shipped === 0 && a.w.cards.length === 1 && a.s.orders.length === 1 && a.s.commits === 1, 'a reload lands in a new kitchen in a clean town');

  /* ---------- what never leaves the server ---------- */
  const all = seen.join('\n');
  const sids = [a, b, c, d, e].map(v => v.sid).concat(oldSid);
  ok(seen.length > 200 && !all.includes('ship_sid') && sids.every(id => !all.includes(id)), `ship_sid and the session ids appear in none of the ${seen.length} messages and responses`);
  ok(!all.includes(TOKEN) && !all.includes(file.token) && !all.toLowerCase().includes(path.basename(tmp).toLowerCase()), 'the reset token and the server\'s directories appear in none of them either');
  ok(log.includes(TOKEN), 'the token is printed in the presenter\'s terminal only');
  for (const v of [a, b, c, d, e]) v.ws?.close();
}

try {
  unit();
  await wire();
  console.log(`\nTown test passed (${passed} checks).`);
} catch (e) {
  console.error('\n' + (e.stack || e.message));
  if (log) console.error('--- server log ---\n' + log);
  process.exitCode = 1;
} finally {
  for (const s of servers) s.kill();
  await sleep(600);
  await fs.rm(tmp, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }).catch(() => {});
}
