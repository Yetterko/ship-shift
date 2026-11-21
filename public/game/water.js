// Water fight: every waiter carries a water gun. Press F (or hold the water button) to spray.
// Other people in the same restaurant show up as waiters you can soak, and they can soak you back.
// On your own, a rival waiter from across the street turns up once you start spraying.
// Getting soaked only slows you down for a moment; it never touches the restaurant's score.
import { $, G, esc, toast, watching } from './core.js';
import { THREE, V, scene, flat, toon, rbox, cyl, ball, spawn, popup, shake, label } from './scene.js';
import { player, character, pose, walk, face, kick, blocked, findPath } from './world.js';
import { sfx } from './audio.js';

const RANGE_SPEED = 7.2, GRAVITY = 9.8, HIT_R = 0.5, COOLDOWN = 0.16, SOAK_S = 1.6, SAFE_S = 1.0;
const HAIRS = ['#5a3a2a', '#2c2430', '#c7772e', '#e8c56a', '#7a3b2a'];
const BOT = { id: 'bot', name: 'Rival waiter', color: '#7a3b9a' };

/* ---------- state ---------- */
const me = { id: null, name: 'You', color: '#2f8fdc', splashes: 0, soakedUntil: 0, safeUntil: 0, lastBy: null };
const remotes = new Map();   // id -> { id, name, color, ch, gun, tx, tz, try, moving, splashes, soakedUntil }
const drops = [];
const puddles = [];
let socket = null, cool = 0, sendT = 0, lastSent = null, holding = false, clock = 0, started = false;
let bot = null;

/* ---------- the gun ---------- */
const nozzleMat = toon('#3a241c');
function makeGun(color) {
  const g = new THREE.Group();
  rbox(0.11, 0.16, 0.12, toon('#fff1d6'), 0, -0.13, -0.02, g, 0.03);            // grip
  g.userData.body = rbox(0.13, 0.12, 0.34, toon(color, { key: 'gun' }), 0, -0.02, 0.06, g, 0.04);   // body
  const tank = cyl(0.085, 0.085, 0.16, flat('#7fd0ff', { transparent: true, opacity: 0.85 }), 0, 0.08, -0.02, g, 14);
  tank.castShadow = false;
  const barrel = cyl(0.035, 0.035, 0.22, nozzleMat, 0, 0.02, 0.3, g, 8); barrel.rotation.x = Math.PI / 2;
  g.userData.nozzle = new THREE.Object3D(); g.userData.nozzle.position.set(0, 0.02, 0.42); g.add(g.userData.nozzle);
  return g;
}
function arm(ch, color) {
  const gun = makeGun(color);
  gun.position.set(0, 0.02, 0.08);
  gun.scale.setScalar(1.3);
  ch.hands[1].add(gun);
  return gun;
}
const myGun = arm(player, me.color);

/* ---------- networking ---------- */
export function setSocket(ws) {
  socket = ws;
  if (!ws) { for (const id of [...remotes.keys()]) dropRemote(id); me.id = null; }
}
function send(msg) { if (socket?.readyState === 1) socket.send(JSON.stringify(msg)); }

export function onWaterMessage(m) {
  if (m.type === 'water:hello') {
    me.id = m.you; me.name = m.name; me.color = m.color; me.splashes = 0;
    recolor(myGun, me.color);
    for (const p of m.players) addRemote(p);
    lastSent = null;
  } else if (m.type === 'water:join') {
    addRemote(m.player);
    toast(`${m.player.name} walked in with a water gun. Press F to spray them!`);
  } else if (m.type === 'water:leave') {
    dropRemote(m.id);
  } else if (m.type === 'water:pos') {
    const r = remotes.get(m.id); if (!r) return;
    r.tx = m.x; r.tz = m.z; r.try = m.ry; r.moving = m.m;
  } else if (m.type === 'water:spray') {
    const r = remotes.get(m.id); if (!r) return;
    r.ch.g.position.x = m.x; r.ch.g.position.z = m.z; r.ch.g.rotation.y = m.ry; r.tx = m.x; r.tz = m.z; r.try = m.ry;
    stream(r.gun, m.ry, r.id);
  } else if (m.type === 'water:soaked') {
    if (m.by === me.id) {
      me.splashes = m.splashes;
      const r = remotes.get(m.id);
      if (r) { popup(`Splash! ${r.name} is soaked`, r.ch.g.position.clone().add(V(0, 2.4, 0)), 'good'); sfx('coin'); }
    } else {
      const r = remotes.get(m.by); if (r) r.splashes = m.splashes;
    }
    const v = remotes.get(m.id);
    if (v) { v.soakedUntil = clock + SOAK_S; splashFx(v.ch.g.position); kick(v.ch, 0.5); }
  }
}

function recolor(gun, color) { gun.userData.body.material = toon(color, { key: 'gun' }); }
function addRemote(p) {
  if (remotes.has(p.id) || p.id === me.id) return;
  const ch = character({ body: '#fffaf0', apron: p.color, hat: false, hair: HAIRS[p.id % HAIRS.length], scarf: p.color, scale: 1.22 });
  ch.g.position.set(p.x, 0, p.z); ch.g.rotation.y = p.ry;
  const gun = arm(ch, p.color);
  remotes.set(p.id, { ...p, ch, gun, tx: p.x, tz: p.z, try: p.ry, moving: false, soakedUntil: 0 });
  if (bot) dismissBot('Someone real showed up. The rival waiter slinks off.');
}
function dropRemote(id) {
  const r = remotes.get(id); if (!r) return;
  scene.remove(r.ch.g); remotes.delete(id);
}

/* ---------- spraying ---------- */
const tmp = V();
function stream(gun, ry, owner) {
  gun.userData.nozzle.getWorldPosition(tmp);
  const fx = Math.sin(ry), fz = Math.cos(ry);
  for (let i = 0; i < 9; i++) {
    const spread = (Math.random() - 0.5) * 0.12, sp = RANGE_SPEED * (0.88 + Math.random() * 0.2);
    const dx = fx * Math.cos(spread) - fz * Math.sin(spread), dz = fz * Math.cos(spread) + fx * Math.sin(spread);
    const m = new THREE.Mesh(dropGeo, flat('#7fd0ff', { transparent: true, opacity: 0.9, unique: true, depthWrite: false }));
    m.position.copy(tmp).addScaledVector(V(dx, 0, dz), -i * 0.05);
    m.renderOrder = 3; scene.add(m);
    drops.push({ m, v: V(dx * sp, 1.2 + Math.random() * 0.5, dz * sp), owner, t: -i * 0.012, done: false });
  }
}
const dropGeo = new THREE.SphereGeometry(0.06, 8, 6);
const puddleGeo = new THREE.CircleGeometry(0.28, 18);

/** Fires the player's gun, if it has cooled down. Returns true when it fired. */
export function fire() {
  if (cool > 0 || document.querySelector('dialog[open], .overlay.open')) return false;
  cool = COOLDOWN;
  stream(myGun, player.g.rotation.y, 'me');
  send({ type: 'water:spray', x: +player.g.position.x.toFixed(2), z: +player.g.position.z.toFixed(2), ry: +player.g.rotation.y.toFixed(3) });
  kick(player, 0.08);
  sfx('spray');
  if (!started) { started = true; $('waterBoard').hidden = false; }
  if (!remotes.size && !bot && !watching()) summonBot();
  if (bot) bot.lastPlayerShot = clock;
  return true;
}
export const soakedFactor = () => (clock < me.soakedUntil ? 0.5 : 1);

function soakMe(by) {
  if (clock < me.safeUntil) return;
  me.soakedUntil = clock + SOAK_S; me.safeUntil = clock + SAFE_S;
  splashFx(player.g.position); kick(player, 0.5); shake(0.1); sfx('splash');
  const who = by === 'bot' ? BOT.name : remotes.get(by)?.name || 'Someone';
  popup(`Soaked by ${who}!`, player.g.position.clone().add(V(0, 2.4, 0)), 'bad');
  if (by === 'bot') { if (bot) bot.splashes++; }
  else send({ type: 'water:soaked', by });
}
function splashFx(pos) { spawn('puff', pos.clone().add(V(0, 1.2, 0)), ['#7fd0ff', '#bfe9ff', '#ffffff'], { n: 14, spread: 0.5, up: 2.2, out: 2.6, life: 0.6, gravity: 8, grow: 0, size: 0.8, opacity: 0.9 }); }
function puddle(x, z) {
  if (puddles.length > 40) { const old = puddles.shift(); scene.remove(old.m); old.m.material.dispose(); }
  const m = new THREE.Mesh(puddleGeo, flat('#7fd0ff', { transparent: true, opacity: 0.55, unique: true, depthWrite: false }));
  m.rotation.x = -Math.PI / 2; m.position.set(x, 0.03, z); m.scale.setScalar(0.5 + Math.random() * 0.6); m.renderOrder = 2;
  scene.add(m); puddles.push({ m, t: 0 });
}

/* ---------- the rival waiter (only when nobody else is here) ---------- */
function summonBot() {
  const ch = character({ body: '#2c2430', apron: BOT.color, hat: false, hair: '#e8c56a', scarf: '#ffd75e', scale: 1.22 });
  ch.g.position.set(5.3, 0, -2.45); ch.g.rotation.y = -Math.PI / 2;
  bot = { ch, gun: arm(ch, BOT.color), splashes: 0, soakedUntil: 0, safeUntil: 0, nextShot: clock + 1.6, nextMove: 0, lastPlayerShot: clock, mine: 0 };
  sfx('door');
  toast('A rival waiter from across the street wants a water fight!');
}
function dismissBot(msg) {
  if (!bot) return;
  scene.remove(bot.ch.g); bot = null;
  if (msg) toast(msg);
}
function stepBot(dt) {
  const b = bot, pos = b.ch.g.position, pp = player.g.position;
  // the rival gets bored and leaves 40 s after your last shot
  if (clock - b.lastPlayerShot > 40) return dismissBot('The rival waiter got bored and went home.');
  const busy = !!document.querySelector('dialog[open], .overlay.open, .panel.open');
  const soaked = clock < b.soakedUntil;
  if (clock > b.nextMove && !b.ch.path.length) {
    // keep about 2.5 m away, somewhere with a clear shot
    for (let k = 0; k < 8; k++) {
      const a = Math.random() * Math.PI * 2, d = 2 + Math.random() * 1.2, x = pp.x + Math.cos(a) * d, z = pp.z + Math.sin(a) * d;
      if (!blocked(x, z)) { b.ch.path = findPath(pos, { x, z }); break; }
    }
    b.nextMove = clock + 2 + Math.random() * 2;
  }
  const moving = walk(b.ch, dt, soaked ? 1.4 : 2.8);
  const dist = Math.hypot(pp.x - pos.x, pp.z - pos.z);
  if (!moving || dist < 3.4) face(b.ch, dt * 2, Math.atan2(pp.x - pos.x, pp.z - pos.z));
  pose(b.ch, dt, clock, { moving, mood: soaked ? 'cross' : 'idle' });
  if (!busy && !soaked && clock > b.nextShot && dist < 4.2) {
    const aim = Math.atan2(pp.x - pos.x, pp.z - pos.z) + (Math.random() - 0.5) * 0.35;
    b.ch.g.rotation.y = aim;
    stream(b.gun, aim, 'bot');
    sfx('spray');
    b.nextShot = clock + 1.1 + Math.random() * 1.3;
  }
  label('water-bot', `<div class="wtag" style="--c:${BOT.color}"><b>${esc(BOT.name)}</b><i>${b.splashes} splash${b.splashes === 1 ? '' : 'es'}</i></div>`, pos.clone().add(V(0, 2.6, 0)), { pri: 1 });
  if (soaked && Math.random() < dt * 10) spawn('puff', pos.clone().add(V(0, 1.6, 0)), '#7fd0ff', { n: 1, up: -0.5, life: 0.4, size: 0.6, gravity: 6 });
}

/* ---------- every frame ---------- */
export function stepWater(dt) {
  clock += dt; cool = Math.max(0, cool - dt);
  if (holding) fire();
  myGun.visible = true;

  // send where I am, ten times a second while I move, once a second otherwise
  sendT -= dt;
  const p = player.g.position, ry = player.g.rotation.y;
  const moved = !lastSent || Math.hypot(p.x - lastSent.x, p.z - lastSent.z) > 0.02 || Math.abs(ry - lastSent.ry) > 0.05;
  if (me.id && sendT <= 0 && (moved || sendT < -1)) {
    lastSent = { x: p.x, z: p.z, ry };
    send({ type: 'water:pos', x: +p.x.toFixed(2), z: +p.z.toFixed(2), ry: +ry.toFixed(3), m: player.moving });
    sendT = 0.1;
  }

  // other people: glide to where they say they are
  for (const r of remotes.values()) {
    const g = r.ch.g, k = Math.min(1, dt * 12);
    const dx = r.tx - g.position.x, dz = r.tz - g.position.z;
    g.position.x += dx * k; g.position.z += dz * k;
    let diff = r.try - g.rotation.y; diff = Math.atan2(Math.sin(diff), Math.cos(diff)); g.rotation.y += diff * k;
    const soaked = clock < r.soakedUntil;
    pose(r.ch, dt, clock, { moving: r.moving || Math.hypot(dx, dz) > 0.05, mood: soaked ? 'cross' : 'idle' });
    label(`water-${r.id}`, `<div class="wtag" style="--c:${r.color}"><b>${esc(r.name)}</b><i>${r.splashes} splash${r.splashes === 1 ? '' : 'es'}</i></div>`, g.position.clone().add(V(0, 2.6, 0)), { pri: 2 });
    if (soaked && Math.random() < dt * 10) spawn('puff', g.position.clone().add(V(0, 1.6, 0)), '#7fd0ff', { n: 1, up: -0.5, life: 0.4, size: 0.6, gravity: 6 });
  }
  if (bot) stepBot(dt);

  // water drops: fly, hit someone, or land as a puddle
  for (let i = drops.length - 1; i >= 0; i--) {
    const d = drops[i];
    d.t += dt;
    if (d.t < 0) continue;
    d.v.y -= GRAVITY * dt;
    d.m.position.addScaledVector(d.v, dt);
    const { x, y, z } = d.m.position;
    let hit = false;
    if (y < 2.0) {
      if (d.owner !== 'me' && Math.hypot(x - p.x, z - p.z) < HIT_R) { soakMe(d.owner); hit = true; }
      else if (d.owner === 'me' && bot && Math.hypot(x - bot.ch.g.position.x, z - bot.ch.g.position.z) < HIT_R) {
        if (clock > bot.safeUntil) {
          bot.soakedUntil = clock + SOAK_S; bot.safeUntil = clock + SAFE_S; bot.ch.path = [];
          me.splashes++; splashFx(bot.ch.g.position); kick(bot.ch, 0.5); sfx('coin');
          popup('Splash! The rival is soaked', bot.ch.g.position.clone().add(V(0, 2.4, 0)), 'good');
        }
        hit = true;
      } else if (d.owner === 'me' || typeof d.owner === 'number') {
        for (const r of remotes.values()) if (r.id !== d.owner && Math.hypot(x - r.ch.g.position.x, z - r.ch.g.position.z) < HIT_R) { hit = true; break; }
      }
    }
    if (hit || y < 0.03 || d.t > 2) {
      if (!hit && y < 0.03 && Math.random() < 0.35) puddle(x, z);
      scene.remove(d.m); d.m.material.dispose(); drops.splice(i, 1);
    }
  }
  for (let i = puddles.length - 1; i >= 0; i--) {
    const q = puddles[i]; q.t += dt;
    q.m.material.opacity = 0.55 * Math.max(0, 1 - q.t / 6);
    if (q.t > 6) { scene.remove(q.m); q.m.material.dispose(); puddles.splice(i, 1); }
  }
  if (clock < me.soakedUntil && Math.random() < dt * 10) spawn('puff', p.clone().add(V(0, 1.6, 0)), '#7fd0ff', { n: 1, up: -0.5, life: 0.4, size: 0.6, gravity: 6 });
  board();
}

/* ---------- the little scoreboard ---------- */
let boardKey = '';
function board() {
  const el = $('waterBoard'); if (!el) return;
  if (remotes.size && el.hidden) el.hidden = false;
  const rows = [{ name: `${me.name} (you)`, color: me.color, n: me.splashes, you: true }, ...[...remotes.values()].map(r => ({ name: r.name, color: r.color, n: r.splashes }))];
  if (bot) rows.push({ name: BOT.name, color: BOT.color, n: bot.splashes });
  rows.sort((a, b) => b.n - a.n);
  const wet = clock < me.soakedUntil;
  const key = rows.map(r => `${r.name}${r.n}`).join('|') + wet;
  if (key === boardKey) return;
  boardKey = key;
  $('waterRows').innerHTML = rows.map(r => `<li class="${r.you ? 'you' : ''}"><i style="background:${r.color}"></i><span>${esc(r.name)}</span><b>${r.n}</b></li>`).join('');
  $('waterBtn').classList.toggle('wet', wet);
}

/* ---------- controls: F, or hold the water button ---------- */
addEventListener('keydown', e => {
  if (e.code !== 'KeyF' || e.ctrlKey || e.metaKey || e.altKey) return;
  if (/INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName)) return;
  e.preventDefault(); fire();
});
const btn = $('waterBtn');
if (btn) {
  btn.addEventListener('pointerdown', e => { e.preventDefault(); holding = true; fire(); btn.setPointerCapture?.(e.pointerId); });
  for (const ev of ['pointerup', 'pointercancel', 'lostpointercapture']) btn.addEventListener(ev, () => { holding = false; });
  btn.addEventListener('contextmenu', e => e.preventDefault());
}

/** For the headless checks. */
export const water = {
  fire, get me() { return { ...me }; }, get remotes() { return [...remotes.values()].map(r => ({ id: r.id, name: r.name, splashes: r.splashes, x: r.ch.g.position.x, z: r.ch.g.position.z })); },
  get bot() { return bot ? { splashes: bot.splashes, x: bot.ch.g.position.x, z: bot.ch.g.position.z } : null; },
  get drops() { return drops.length; }, soaked: () => clock < me.soakedUntil,
};
