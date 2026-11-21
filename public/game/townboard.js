// The town on paper: the strip under the HUD (your team, the town's goal, the lunch rush), the feed, the offers waiting at
// your door, and the chalkboard: every customer in town as a kanban, your own kitchen's board, the leaderboard and your
// name card. It is also the keyboard and screen-reader path for everything the walking does.
//
// API (see the integration note at the top of park.js)
//   initTownBoard({ kitchen, kitchenActions, onStartOver })
//       kitchen()         optional: the kitchen state the Kitchen tab draws. Without it, the last own `state` message is used
//       kitchenActions    optional: handed straight to board.js's createBoard(). Leave an action out and its button is gone,
//                         so a kitchen you are only visiting gets a board you can only read
//       onStartOver()     optional: adds "Start over…" to the name card (Builder C's dialog: fresh kitchen, presenter reset)
//   syncTownUi(world)     on every world snapshot
//   townFrame(t)          every frame: the countdowns
//   openTownBoard(tab), closeTownBoard(), townBoardOpen()      tab is 'town' | 'kitchen' | 'leaderboard' | 'you'
import { esc, toast, emit, mmss, ICON } from './core.js';
import { createBoard } from './board.js';
import * as net from './net.js';
import { LOOKS } from './presence.js';

const LANES = [
  ['backlog', 'Backlog', 'Loose in the park'],
  ['held', 'In hands', 'Following a player'],
  ['queued', 'At a door', 'Somebody\'s to-do'],
  ['offered', 'Offered', 'Waiting for a yes'],
  ['seated', 'Accepted', 'A ticket at the window'],
  ['cooking', 'Cooking', 'A chef is on it'],
  ['review', 'Review', 'On the pass'],
  ['served', 'Served', 'Shipped to main'],
];
const TABS = [['town', 'Town'], ['kitchen', 'My kitchen'], ['leaderboard', 'Leaderboard'], ['you', 'You']];
const SIGNS = [['team', 'Open to my team', 'Teammates can answer and approve. Other teams watch, cheer and offer.'], ['help', 'Help wanted', 'Any visitor can answer your chefs\' questions.'], ['private', 'Private', 'Visitors only watch. No offers from other teams.']];
let ui = null, opts = {}, tab = 'town', kitchenBoard = null, ownState = null, lastFeedT = 0, booted = false;
const html = new Map();
const put = (el, s) => { if (html.get(el) !== s) { html.set(el, s); el.innerHTML = s; return true; } return false; };
const dot = color => `<i class="tw-dot" style="background:${esc(color || '#b8ab98')}"></i>`;
const typingIn = el => el.contains(document.activeElement) && /INPUT|SELECT|TEXTAREA/.test(document.activeElement.tagName);

async function run(promise, good) {
  const r = await promise;
  if (!r.ok) { toast(r.error, 'bad'); emit('sfx', 'err'); } else { if (good) toast(good, 'good'); emit('sfx', 'yes'); }
  return r;
}

/* ======================= build ======================= */
function build() {
  const stage = document.getElementById('stage');
  const hud = document.createElement('div'); hud.className = 'pk-hud'; hud.id = 'parkHud';
  hud.innerHTML = `
    <div class="pk-strip" id="pkStrip">
      <button class="pill pk-team" id="pkTeam" type="button" title="Your name, look and team (N)"></button>
      <div class="pill pk-goal" id="pkGoal" title="Shipped by the whole town"></div>
      <div class="pill pk-rush" id="pkRush" hidden></div>
    </div>
    <ol class="pk-feed" id="pkFeed" aria-live="polite" aria-label="What is happening in town"></ol>`;
  const offers = document.createElement('div'); offers.className = 'pk-offers'; offers.id = 'pkOffers'; offers.setAttribute('aria-live', 'polite');
  const board = document.createElement('aside'); board.className = 'board tboard'; board.id = 'townBoard'; board.setAttribute('aria-label', 'Town board');
  board.innerHTML = `
    <div class="board-head">
      <nav class="tw-tabs" role="tablist">${TABS.map(([k, name]) => `<button type="button" role="tab" data-tab="${k}">${name}</button>`).join('')}</nav>
      <button class="rb" type="button" data-close title="Close (Esc)" aria-label="Close the board">×</button>
    </div>
    <section class="tw-pane" data-pane="town">
      <nav class="board-tabs" aria-label="Jump to a column">${LANES.map(([k, name]) => `<button type="button" data-lane="${k}">${name}<b data-count="${k}">0</b></button>`).join('')}</nav>
      <div class="lanes">${LANES.map(([k, name, what]) => `<section class="lane" data-lane="${k}" aria-label="${name}"><header><h3>${name}</h3><small>${what}</small></header><div class="lane-body" data-body="${k}"></div></section>`).join('')}</div>
    </section>
    <section class="tw-pane tw-kitchen" data-pane="kitchen"><div class="tw-kb"></div><p class="tw-empty">Your kitchen has not opened yet.</p></section>
    <section class="tw-pane tw-scroll" data-pane="leaderboard"></section>
    <section class="tw-pane tw-scroll" data-pane="you"></section>`;
  stage.append(hud, offers, board);
  const q = sel => board.querySelector(sel);
  ui = { hud, offers, board, team: hud.querySelector('#pkTeam'), goal: hud.querySelector('#pkGoal'), rush: hud.querySelector('#pkRush'), feed: hud.querySelector('#pkFeed'), q };

  hud.querySelector('#pkTeam').onclick = () => openTownBoard('you');
  ui.feed.onclick = () => openTownBoard('town');
  offers.addEventListener('click', e => {
    const b = e.target.closest('button[data-offer]'); if (!b) return;
    if (b.dataset.offer === 'more') return openTownBoard('town');
    run(b.dataset.offer === 'accept' ? net.accept(b.dataset.id) : net.decline(b.dataset.id), b.dataset.offer === 'accept' ? 'Accepted: they join your queue' : null);
  });
  board.addEventListener('click', e => {
    if (e.target.closest('[data-close]')) return closeTownBoard();
    const t = e.target.closest('[data-tab]'); if (t) return openTownBoard(t.dataset.tab);
    const lane = e.target.closest('.tw-pane[data-pane="town"] .board-tabs [data-lane]');
    if (lane) return q(`.tw-pane[data-pane="town"] section[data-lane="${lane.dataset.lane}"]`).scrollIntoView({ behavior: 'smooth', inline: 'start', block: 'nearest' });
    const b = e.target.closest('button[data-do]'); if (!b) return;
    const id = b.dataset.id, what = b.dataset.do;
    if (what === 'accept') return run(net.accept(id), 'Accepted: they join your queue');
    if (what === 'decline') return run(net.decline(id));
    if (what === 'back') return run(net.put(id, null));
    if (what === 'look') return run(net.setMe({ look: Number(id) }));
    if (what === 'team') return run(net.setMe({ team: id }), 'You changed team');
    if (what === 'sign') return run(net.setSign(id));
    if (what === 'startover') return opts.onStartOver?.();
  });
  board.addEventListener('change', e => {
    const s = e.target.closest('select[data-do="send"]'); if (!s || !s.value) return;
    const plot = Number(s.value), id = s.dataset.id; s.value = ''; s.blur();
    const pl = net.plotOf(plot);
    run(net.send(id, plot), net.relationTo(pl) === 'team' ? `Sent to ${pl.name}` : `Offered to ${pl?.name}`);
  });
  board.addEventListener('submit', e => {
    const f = e.target.closest('form[data-do="name"]'); if (!f) return;
    e.preventDefault();
    const name = f.elements.name.value.trim(); if (!name) return;
    f.elements.name.blur();
    run(net.setMe({ name }), 'Name changed');
  });
  addEventListener('keydown', e => { if (e.key === 'Escape' && townBoardOpen() && !e.defaultPrevented) { closeTownBoard(); e.preventDefault(); } });
  net.onState(m => { if (!m.relation || m.relation === 'owner') { ownState = m.state; if (townBoardOpen() && tab === 'kitchen') drawKitchen(); } });
}

/* ======================= the board ======================= */
export const townBoardOpen = () => !!ui?.board.classList.contains('open');
export function openTownBoard(next = 'town') {
  if (!ui) return;
  tab = TABS.some(([k]) => k === next) ? next : 'town';
  ui.board.classList.add('open');
  for (const b of ui.board.querySelectorAll('[data-tab]')) { b.classList.toggle('on', b.dataset.tab === tab); b.setAttribute('aria-selected', String(b.dataset.tab === tab)); }
  for (const p of ui.board.querySelectorAll('.tw-pane')) p.hidden = p.dataset.pane !== tab;
  drawBoard();
  emit('sfx', 'open');
}
export function closeTownBoard() { if (!ui) return; ui.board.classList.remove('open'); if (ui.board.contains(document.activeElement)) document.activeElement.blur(); }

function where(c, w) {
  const tm = net.teamOf(c.team), pl = c.plot === null ? null : w.plots[c.plot], owner = pl?.name || 'a closed door';
  const mineDoor = pl && pl.owner === w.you.pid;
  if (c.state === 'backlog') return [`${tm?.name || 'Town'} backlog`, tm?.color];
  if (c.state === 'held') { const p = net.playerOf(c.heldBy); return [c.heldBy === w.you.pid ? 'Following you' : `With ${p?.name || 'somebody'}`, tm?.color]; }
  if (c.state === 'offered') { const ft = net.teamOf(c.fromTeam); return [`Offered by the ${ft?.name || 'other team'} to ${mineDoor ? 'you' : owner}`, ft?.color]; }
  const sent = c.from ? ` · from ${net.playerOf(c.from)?.name || 'a neighbour'}` : '';
  return [`${mineDoor ? 'Your' : `${owner}'s`} ${c.state === 'queued' ? 'door' : 'kitchen'}${sent}`, pl?.color || tm?.color];
}
function cardHtml(c, w) {
  const you = w.you, [place, tone] = where(c, w), mineDoor = c.plot !== null && w.plots[c.plot].owner === you.pid;
  let acts = '';
  if (c.state === 'queued' && mineDoor) {
    const others = w.plots.filter(p => p.owner && p.owner !== you.pid);
    acts = `<select data-do="send" data-id="${esc(c.id)}" aria-label="Send ${esc(c.title)} to another door"${others.length ? '' : ' disabled'}><option value="">${others.length ? 'Send to… ▾' : 'Nobody else is open'}</option>${others.map(p => `<option value="${p.id}">${esc(p.name)} (${p.team === you.team ? 'teammate' : `offer to the ${esc(net.teamOf(p.team)?.name || 'other team')}`})</option>`).join('')}</select>`;
  } else if (c.state === 'offered' && mineDoor) acts = `<button class="btn small ship" type="button" data-do="accept" data-id="${esc(c.id)}">Accept</button><button class="btn small ghost" type="button" data-do="decline" data-id="${esc(c.id)}">Decline</button>`;
  else if (c.state === 'offered' && c.from === you.pid) acts = `<button class="btn small ghost" type="button" data-do="decline" data-id="${esc(c.id)}">Withdraw</button>`;
  else if (c.state === 'held' && c.heldBy === you.pid) acts = `<button class="btn small ghost" type="button" data-do="back" data-id="${esc(c.id)}">Send back</button>`;
  const mine = mineDoor || c.heldBy === you.pid;
  return `<article class="bcard${mine ? ' mine' : ''}${c.rush ? ' rush' : ''}" style="--c:${esc(tone || '#b8ab98')}"><div class="bc-head"><span class="sz ${esc(c.size)}">${esc(c.size)}</span><span class="tw-where">${dot(tone)}${esc(place)}</span></div><h4>${esc(c.title)}</h4>${c.rush ? '<div class="chips"><span class="chip2 warn">lunch rush</span></div>' : ''}${acts ? `<div class="acts">${acts}</div>` : ''}</article>`;
}
function drawTown(w) {
  const you = w.you, pane = ui.q('.tw-pane[data-pane="town"]');
  const rank = c => (c.heldBy === you.pid || (c.plot !== null && w.plots[c.plot].owner === you.pid) ? 0 : c.team === you.team ? 1 : 2);
  for (const [k] of LANES) {
    const list = w.cards.filter(c => c.state === k).sort((a, b) => rank(a) - rank(b) || (k === 'served' ? b.movedAt - a.movedAt : a.movedAt - b.movedAt));
    const body = pane.querySelector(`[data-body="${k}"]`);
    if (!typingIn(body)) put(body, list.map(c => cardHtml(c, w)).join(''));
    pane.querySelector(`[data-count="${k}"]`).textContent = list.length;
    pane.querySelector(`section[data-lane="${k}"]`).classList.toggle('empty', !list.length);
    const t = pane.querySelector(`.board-tabs [data-lane="${k}"]`);
    t.classList.toggle('some', list.length > 0); t.classList.toggle('hot', k === 'offered' && list.some(c => w.plots[c.plot]?.owner === you.pid));
  }
}
function drawKitchen() {
  const pane = ui.q('.tw-kitchen'), S = opts.kitchen ? opts.kitchen() : ownState;
  pane.classList.toggle('none', !S);
  if (!S) return;
  if (!kitchenBoard) kitchenBoard = createBoard(pane.querySelector('.tw-kb'), { ...(opts.kitchenActions || {}), close: undefined }, { now: net.townNow, title: 'My kitchen' });
  kitchenBoard.render(S);
}
function drawLeaders(w) {
  const total = p => p.score + p.bonus;
  const teams = [...w.teams].sort((a, b) => b.score - a.score), plots = w.plots.filter(p => p.owner).sort((a, b) => total(b) - total(a) || b.shipped - a.shipped);
  const best = Math.max(1, ...plots.map(total)), pct = Math.round(Math.min(1, w.team.shipped / Math.max(1, w.team.goal)) * 100);
  put(ui.q('.tw-pane[data-pane="leaderboard"]'), `
    <div class="tw-goal"><b>${w.team.shipped}</b> of ${w.team.goal} served by the whole town<i style="--p:${pct}%"></i><small>Town score ${w.team.score}</small></div>
    <h3>Teams</h3>
    <ol class="tw-teams">${teams.map((t, i) => `<li style="--c:${esc(t.color)}"${t.id === w.you.team ? ' class="mine"' : ''}><em>${i + 1}</em><span><b>${esc(t.name)}</b><small>${esc(t.project)} · ${t.members} ${t.members === 1 ? 'chef' : 'chefs'}</small></span><strong>${t.score}</strong><small>${t.shipped} served</small></li>`).join('')}</ol>
    <h3>Restaurants</h3>
    <ol class="tw-plots">${plots.map((p, i) => `<li${p.owner === w.you.pid ? ' class="mine"' : ''}><em>${i + 1}</em>${dot(p.color)}<span><b>${esc(p.name)}</b><i class="tw-bar" style="--p:${Math.round(total(p) / best * 100)}%;--c:${esc(p.color)}"></i></span><strong>${total(p)}</strong><small>${p.shipped} served${p.bonus ? ` · +${p.bonus} town` : ''}</small></li>`).join('') || '<li class="none">Nobody has opened yet</li>'}</ol>`);
}
function drawYou(w) {
  const pane = ui.q('.tw-pane[data-pane="you"]');
  if (typingIn(pane)) return;
  const you = w.you, pl = net.myPlot();
  put(pane, `
    <form class="tw-name" data-do="name" autocomplete="off"><label for="twName">Your name</label><div class="line"><input id="twName" name="name" maxlength="14" value="${esc(you.name)}" autocapitalize="words" spellcheck="false"><button class="btn small" type="submit">Save</button></div></form>
    <h3>Apron</h3>
    <div class="tw-looks">${LOOKS.map((L, i) => `<button type="button" data-do="look" data-id="${i}" aria-label="${esc(L.name)}" aria-pressed="${i === you.look}" style="--c:${L.color};--s:${L.skin}"><i></i></button>`).join('')}</div>
    <h3>Team</h3>
    <div class="tw-pick">${w.teams.map(t => `<button type="button" data-do="team" data-id="${esc(t.id)}" aria-pressed="${t.id === you.team}" style="--c:${esc(t.color)}">${dot(t.color)}<span><b>${esc(t.name)}</b><small>${esc(t.project)} · ${t.members} ${t.members === 1 ? 'chef' : 'chefs'}</small></span></button>`).join('')}</div>
    <p class="tw-note">Your team shares one backlog. Customers at your door come with you; whoever is following you stays behind.</p>
    ${pl ? `<h3>Door sign</h3><div class="tw-pick">${SIGNS.map(([k, name, what]) => `<button type="button" data-do="sign" data-id="${k}" aria-pressed="${pl.sign === k}"><span><b>${name}</b><small>${what}</small></span></button>`).join('')}</div>` : ''}
    ${opts.onStartOver ? '<h3>Start over</h3><button class="btn small ghost" type="button" data-do="startover">Fresh kitchen or town reset…</button>' : ''}`);
}
function drawBoard() {
  const w = net.town.world; if (!w || !townBoardOpen()) return;
  if (tab === 'town') drawTown(w); else if (tab === 'kitchen') drawKitchen(); else if (tab === 'leaderboard') drawLeaders(w); else drawYou(w);
}

/* ======================= the strip, the feed, the offers ======================= */
function banner(big, small) {
  const host = document.getElementById('banners'); if (!host) return toast(`${big} ${small}`, 'good');
  const el = document.createElement('div'); el.className = 'banner'; el.innerHTML = `<b>${esc(big)}</b><i>${esc(small)}</i>`;
  host.replaceChildren(el); setTimeout(() => el.remove(), 2600);
}
export function syncTownUi(w) {
  if (!ui || !w) return;
  const you = w.you, tm = net.teamOf(you.team), pct = Math.round(Math.min(1, w.team.shipped / Math.max(1, w.team.goal)) * 100);
  put(ui.team, `${dot(tm?.color)}<span><b>${esc(you.name)}</b><small>${esc(tm?.name || 'No team')} · ${esc(tm?.project || '')}</small></span>`);
  put(ui.goal, `<span class="ic">${ICON.plate}</span><b>${w.team.shipped}</b><small>/ ${w.team.goal}</small><i style="--p:${pct}%"></i>`);
  // the feed: newest at the bottom, a few lines, and the big moments get a banner
  const fresh = w.feed.filter(f => f.t > lastFeedT);
  if (booted) for (const f of fresh) {
    if (/^Full house/.test(f.text)) { banner('Full house!', 'Everyone earns +100'); emit('sfx', 'fanfare'); }
    else if (/rang the bell/.test(f.text)) banner('Lunch rush!', 'Seat everyone from the bus');
  }
  lastFeedT = Math.max(lastFeedT, ...w.feed.map(f => f.t), 0);
  put(ui.feed, w.feed.slice(-4).map(f => `<li${fresh.includes(f) && booted ? ' class="new"' : ''}>${esc(f.text)}</li>`).join(''));
  // offers at your door: answered from anywhere
  const mine = net.myPlot(), offers = (mine?.offers || []).map(net.cardOf).filter(Boolean);
  put(ui.offers, offers.slice(0, 2).map(c => `<div class="pk-offer" style="--c:${esc(net.teamOf(c.fromTeam)?.color || '#b8ab98')}"><small>Offered by the ${esc(net.teamOf(c.fromTeam)?.name || 'other team')}</small><b><i class="sz ${esc(c.size)}">${esc(c.size)}</i>${esc(c.title)}</b><span>${esc(net.playerOf(c.from)?.name || 'A neighbour')} left them at your door</span><div class="acts"><button class="btn small ship" type="button" data-offer="accept" data-id="${esc(c.id)}">Accept</button><button class="btn small ghost" type="button" data-offer="decline" data-id="${esc(c.id)}">Decline</button></div></div>`).join('') + (offers.length > 2 ? `<button class="btn small ghost" type="button" data-offer="more">+${offers.length - 2} more on the board</button>` : ''));
  ui.offers.hidden = !offers.length;
  booted = true;
  drawBoard();
}
let tickT = 0;
export function townFrame(t) {
  const w = net.town.world; if (!ui || !w || (t - tickT < 0.25 && t >= tickT)) return;
  tickT = t;
  const r = w.rush, now = net.townNow();
  ui.rush.hidden = !r || now >= r.endsAt;
  if (!ui.rush.hidden) {
    const seating = now < r.seatBy;
    put(ui.rush, seating ? `<span class="ic">${ICON.flame}</span><b>${mmss(r.seatBy - now)}</b><small>${r.left} to seat</small>` : `<span class="ic">${ICON.flame}</span><b>${mmss(r.endsAt - now)}</b><small>ships ×1.5</small>`);
    ui.rush.classList.toggle('last', seating && r.seatBy - now < 10000);
  }
  if (townBoardOpen() && tab === 'kitchen') drawKitchen();
}
export function initTownBoard(o = {}) { if (ui) return; opts = o; build(); if (net.town.world) syncTownUi(net.town.world); }
