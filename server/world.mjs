// The town: a park that every public kitchen opens onto. Plots, players, teams, customer cards, the feed and the lunch rush.
// Nothing here touches the disk or git. A kitchen is reached only through its link:
//   { summary(), admit(card) -> orderId, withdraw(orderId), has(title) }
// and the server calls kitchenChanged(pid) when that kitchen changes. That link is the seam for a real team host.
import crypto from 'node:crypto';
import { EventEmitter } from 'node:events';

export const TEAMS = [
  { id: 'red', name: 'Red team', project: 'Payroll', color: '#e5484d' },
  { id: 'blue', name: 'Blue team', project: 'Rosters', color: '#3e7bfa' },
  { id: 'green', name: 'Green team', project: 'Timesheets', color: '#30a46c' },
];
export const SIGNS = ['team', 'help', 'private'];
export const PARK = { w: 40, h: 18, reach: 2.2, fountain: [0, 0], bell: [0, 0], bellReach: 3.5, bus: [-17.5, 0], board: [-5, -5.5], leaderboard: [5, -5.5] };

const PLOT_W = 4.5, MAT_IN = 0.7;
const CARRY = 2, QUEUE = 6, OFFERS = 4, SERVED_KEPT = 30, FEED_KEPT = 20, LOOKS = 8;
const SIZE_POINTS = { S: 1, M: 2, L: 3 };
const REFERRAL = 25, CHEER = 5, CHEERS_PER_MIN = 5, FULL_HOUSE = 100, RUSH_PER_POINT = 50, RUSH_PER_PLAYER = 2;
// Dash speed is 6.2 x 1.8; anything faster than this between two position messages is pulled back.
const MAX_SPEED = 14, SLACK = 0.6, EMOTE_MS = 2500;
const KITCHEN_BOUNDS = { x0: -15, x1: 15, z0: -15, z1: 15 }, PARK_BOUNDS = { x0: -PARK.w / 2 - 1, x1: PARK.w / 2 + 1, z0: -PARK.h / 2 - 1, z1: PARK.h / 2 + 1 };
const AREAS = { 1: [[0, 4.6]], 2: [[-8, 0.4], [8, 0.4]], 3: [[-9, 0.4], [9, 0.4], [0, 5] ] };
const HERBS = ['Basil', 'Sage', 'Thyme', 'Mint', 'Dill', 'Chive', 'Fennel', 'Sorrel', 'Tarragon', 'Parsley', 'Saffron', 'Ginger', 'Clove', 'Nutmeg', 'Pepper', 'Sesame', 'Juniper', 'Lovage', 'Caper', 'Cumin', 'Anise', 'Laurel', 'Mace', 'Sumac', 'Chervil', 'Borage', 'Wasabi', 'Paprika', 'Vanilla', 'Cocoa'];
const WALK_INS = ['Flat white prices on the menu', 'Opening hours in the footer', 'Staff birthday list', 'Thank-you note on the roster', 'Allergen note for the kitchen', 'Wi-Fi password on the page', 'Closing checklist', 'Coffee order of the day'];
const BAD_NAMES = /fuck|shit|cunt|bitch|nigg|fag|rape|nazi|hitler|penis|vagina|whore|slut|dick|cock|pussy|wank|twat|porn|arse|asshole|bastard|kill|sex/;
const LEET = { 0: 'o', 1: 'i', 3: 'e', 4: 'a', 5: 's', 7: 't', '@': 'a', $: 's', '!': 'i' };

const r2 = n => Math.round(n * 100) / 100;
const dist = (ax, az, bx, bz) => Math.hypot(ax - bx, az - bz);
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const dishKey = s => String(s || '').trim().toLowerCase();
const STATUS = { far: 409, taken: 409, locked: 409, hands: 409, full: 409, dish: 409, players: 409, team: 403, sign: 403, owner: 403, cooldown: 429, name: 400, bad: 400, gone: 404 };

/** A refusal the player should read: { message, code, status }. */
export function refusal(code, message) { return Object.assign(new Error(message), { code, status: STATUS[code] || 400 }); }
const fail = (code, message) => { throw refusal(code, message); };

/** A player's name as the town will show it: at most 14 plain characters, or null when it is empty or rude. */
export function cleanName(v) {
  if (typeof v !== 'string') return null;
  const name = v.normalize('NFKC').replace(/[^\p{L}\p{N} '.-]/gu, '').replace(/\s+/g, ' ').trim().slice(0, 14).trim();
  if (!name) return null;
  const flat = name.toLowerCase().replace(/[013457@$!]/g, c => LEET[c]).replace(/[^a-z]/g, '');
  return BAD_NAMES.test(flat) || BAD_NAMES.test(flat.replace(/(.)\1+/g, '$1')) ? null : name;
}

/** The 24 plots around the lawn with their doormats, numbered from the fountain outward. */
function layPlots() {
  const hw = PARK.w / 2, hh = PARK.h / 2, plots = [];
  for (let i = 0; i < 8; i++) plots.push({ slot: i, side: 'n', x: -15.75 + i * PLOT_W, z: -hh + MAT_IN });
  for (let i = 0; i < 8; i++) plots.push({ slot: 8 + i, side: 's', x: -15.75 + i * PLOT_W, z: hh - MAT_IN });
  for (let i = 0; i < 4; i++) plots.push({ slot: 16 + i, side: 'e', x: hw - MAT_IN, z: -6.75 + i * PLOT_W });
  for (let i = 0; i < 4; i++) plots.push({ slot: 20 + i, side: 'w', x: -hw + MAT_IN, z: -6.75 + i * PLOT_W });
  plots.sort((a, b) => dist(a.x, a.z, 0, 0) - dist(b.x, b.z, 0, 0) || a.slot - b.slot);
  return plots.map((p, id) => ({ id, ...p, owner: null, sign: 'team', queue: [], offers: [], bonus: 0, score: 0, shipped: 0, stars: 0, lights: noLights() }));
}
const noLights = () => ({ cooking: 0, oven: 0, pass: 0, blocked: 0, fire: false, stalled: 0, since: null });

export class World extends EventEmitter {
  /**
   * dishes is the menu every player brings: the first goes straight to their door and the rest reach their team's backlog
   * at arrivalsMs after they join. now is injectable so a test can move the clock.
   */
  constructor({ dishes = [], arrivalsMs = [], teams = 2, now = Date.now, rushMs = 90_000, bellMs = 180_000, offerMs = 120_000 } = {}) {
    super();
    this.dishes = dishes.map(d => ({ title: String(d.title), size: SIZE_POINTS[d.size] ? d.size : 'M', body: String(d.body || '') }));
    this.arrivalsMs = arrivalsMs;
    this.clock = now;
    Object.assign(this, { rushMs, bellMs, offerMs });
    const n = clamp(Math.floor(Number(teams)) || 2, 1, TEAMS.length);
    this.teams = TEAMS.slice(0, n).map((t, i) => ({ ...t, area: { x: AREAS[n][i][0], z: AREAS[n][i][1], r: 3.2 } }));
    this.plots = layPlots();
    this.players = new Map();
    this.cards = new Map();
    this.feed = [];
    this.rush = null; this.bellAt = 0; this.rushNo = 0;
    this.v = 1; this.nextCard = 1; this.shipped = 0; this.walkIn = 0;
    this.lastSlow = 0;
  }

  now() { return this.clock(); }
  changed() { this.v++; this.emit('change'); }
  say(text) { this.feed.push({ t: this.now(), text }); if (this.feed.length > FEED_KEPT) this.feed.splice(0, this.feed.length - FEED_KEPT); }

  player(pid) { return this.players.get(pid) || fail('gone', 'You are not in this town any more. Reload the page.'); }
  plot(id) {
    const p = Number.isInteger(id) ? this.plots[id] : typeof id === 'string' && /^\d{1,2}$/.test(id) ? this.plots[Number(id)] : null;
    return p || fail('gone', 'There is no such plot.');
  }
  lived(id) { const p = this.plot(id); return p.owner ? p : fail('gone', 'Nobody has opened a restaurant there.'); }
  card(id) { return this.cards.get(String(id)) || fail('gone', 'That customer has left town.'); }
  team(id) { return this.teams.find(t => t.id === id) || null; }
  ownerOf(plot) { return plot.owner ? this.players.get(plot.owner) : null; }
  plotOf(p) { return p.plot === null ? null : this.plots[p.plot]; }
  mates(a, b) { return Boolean(a && b && (a.pid === b.pid || (a.team && a.team === b.team))); }
  people() { return [...this.players.values()].filter(p => !p.bot); }

  /* ---------- joining and leaving ---------- */

  /** Opens a restaurant for a new player on the free plot nearest the fountain. Returns the player, or null when the town is full. */
  join({ link, name } = {}) {
    const plot = this.plots.find(p => !p.owner);
    if (!plot) return null;
    let pid;
    do pid = crypto.randomBytes(3).toString('hex'); while (this.players.has(pid));
    const team = [...this.teams].sort((a, b) => this.members(a.id) - this.members(b.id))[0];
    const p = {
      pid, name: cleanName(name) || this.freeName(), look: this.players.size % LOOKS, team: team.id, plot: plot.id, zone: `k:${plot.id}`,
      x: null, z: null, r: 0, m: 0, e: 0, eUntil: 0, at: this.now(), dirty: true, carry: [], bot: false, link, cheers: [],
      // The rest of the menu arrives on the demo's schedule.
      due: this.dishes.slice(1).map((d, i) => ({ dish: d, at: this.now() + (this.arrivalsMs[i + 1] ?? this.arrivalsMs.at(-1) ?? 0) })),
    };
    this.players.set(pid, p);
    Object.assign(plot, { owner: pid, sign: 'team', queue: [], offers: [], bonus: 0, score: 0, shipped: 0, stars: 0, lights: noLights() });
    this.say(`${p.name} opened a restaurant for the ${team.name}`);
    if (this.dishes[0]) this.doorCard(p, plot);
    this.admitNext(plot);
    this.changed();
    return p;
  }

  members(teamId) { return this.people().filter(p => p.team === teamId).length; }

  freeName() {
    const used = new Set([...this.players.values()].map(p => p.name));
    const start = Math.floor(Math.random() * HERBS.length);
    for (let i = 0; i < HERBS.length; i++) { const n = `Chef ${HERBS[(start + i) % HERBS.length]}`; if (!used.has(n)) return n; }
    return `Chef ${crypto.randomBytes(2).toString('hex')}`;
  }

  newCard(dish, team, extra = {}) {
    const c = {
      id: `c${this.nextCard++}`, title: dish.title, size: dish.size, body: dish.body || '', state: 'backlog', plot: null, heldBy: null, by: null, from: null,
      team, fromTeam: null, rush: false, x: 0, z: 0, movedAt: this.now(), orderId: null, spot: null, offeredAt: null, rushNo: null, servedAt: null, ...extra,
    };
    this.cards.set(c.id, c);
    return c;
  }

  /** The first, small dish stands at the player's own door, so a new kitchen has a customer at once. */
  doorCard(p, plot) {
    const first = this.dishes[0];
    const c = [...this.cards.values()].find(x => x.state === 'backlog' && x.team === p.team && dishKey(x.title) === dishKey(first.title)) || this.newCard(first, p.team);
    this.detach(c);
    Object.assign(c, { state: 'queued', plot: plot.id, team: p.team, by: p.pid, from: null, fromTeam: null, x: plot.x, z: plot.z, movedAt: this.now() });
    plot.queue.push(c.id);
    return c;
  }

  /** Closes a player's restaurant: their customers go back to the backlog, their visitors to the park, and the plot is free. */
  leave(pid) {
    const p = this.players.get(pid);
    if (!p) return;
    const plot = this.plotOf(p);
    for (const id of [...p.carry]) this.toBacklog(this.cards.get(id));
    if (plot) {
      this.emptyPlot(plot);
      for (const v of this.players.values()) if (v !== p && v.zone === `k:${plot.id}`) this.eject(v, plot);
      Object.assign(plot, { owner: null, sign: 'team', queue: [], offers: [], bonus: 0, score: 0, shipped: 0, stars: 0, lights: noLights() });
    }
    this.players.delete(pid);
    if (!p.bot) this.say(`${p.name} closed for the day`);
    this.changed();
  }

  /** Every customer at this plot who has not been served goes back to a backlog. */
  emptyPlot(plot) {
    for (const c of [...this.cards.values()]) if (c.plot === plot.id && c.state !== 'served') this.toBacklog(c);
  }

  eject(v, plot) {
    Object.assign(v, { zone: 'park', x: plot.x, z: plot.z, at: this.now(), dirty: true });
    this.emit('moved', v.pid, { zone: 'park', x: r2(plot.x), z: r2(plot.z) });
  }

  /** The player's kitchen is being replaced: nobody walks in until refresh() brings the new one. */
  unlink(pid) { const p = this.players.get(pid); if (p) p.link = null; }

  /** A line for the feed from the server, for a move that happened inside a kitchen. */
  note(text) { this.say(text); this.changed(); }

  /**
   * A fresh kitchen on the same plot: unfinished customers return to the backlog, the world bonus is cleared,
   * and the first dish walks up to the door again. link is the new kitchen's.
   */
  refresh(pid, link) {
    const p = this.player(pid), plot = this.plotOf(p);
    p.link = link;
    if (plot) {
      this.emptyPlot(plot);
      Object.assign(plot, { bonus: 0, score: 0, shipped: 0, stars: 0, lights: noLights() });
      if (this.dishes[0]) this.doorCard(p, plot);
      this.say(`${p.name} started over with a fresh kitchen`);
      this.admitNext(plot);
    }
    this.changed();
  }

  /* ---------- where a card is ---------- */

  /** Takes a card out of whatever hand or door holds it. */
  detach(c) {
    if (c.heldBy) { const h = this.players.get(c.heldBy); if (h) h.carry = h.carry.filter(id => id !== c.id); }
    if (c.plot !== null) { const pl = this.plots[c.plot]; pl.queue = pl.queue.filter(id => id !== c.id); pl.offers = pl.offers.filter(id => id !== c.id); }
    Object.assign(c, { heldBy: null, plot: null, orderId: null, offeredAt: null, spot: null });
  }

  toBacklog(c) {
    if (!c) return;
    this.detach(c);
    const team = this.team(c.team) || this.teams[0];
    const taken = new Set([...this.cards.values()].filter(x => x.state === 'backlog' && x.team === team.id && x !== c).map(x => x.spot));
    let spot = 0;
    while (taken.has(spot)) spot++;
    // A sunflower of standing places, filling the team's area from its middle.
    const a = spot * 2.39996, r = 0.62 * Math.sqrt(spot + 0.5);
    Object.assign(c, {
      state: 'backlog', team: team.id, spot, from: null, fromTeam: null, movedAt: this.now(),
      x: r2(clamp(team.area.x + Math.cos(a) * r, -PARK.w / 2 + 1, PARK.w / 2 - 1)), z: r2(clamp(team.area.z + Math.sin(a) * r, -PARK.h / 2 + 1.6, PARK.h / 2 - 1.6)),
    });
  }

  near(p, x, z, reach = PARK.reach) { return p.zone === 'park' && p.x !== null && dist(p.x, p.z, x, z) <= reach; }

  /** True when the restaurant on this plot already has the dish: on its rail, served, or waiting at its door. */
  serves(plot, title, except) {
    const owner = this.ownerOf(plot);
    if (owner?.link?.has(title)) return true;
    return [...plot.queue, ...plot.offers].some(id => id !== except?.id && dishKey(this.cards.get(id)?.title) === dishKey(title));
  }

  /* ---------- moving cards ---------- */

  take(pid, cardId) {
    const p = this.player(pid), c = this.card(cardId);
    if (c.state === 'held') fail('taken', c.heldBy === pid ? 'That customer is already following you.' : `${this.players.get(c.heldBy)?.name || 'Somebody'} got there first.`);
    if (c.state === 'offered') fail('taken', 'That customer is waiting for an answer at the door.');
    if (c.state !== 'backlog' && c.state !== 'queued') fail('locked', 'That customer has been seated and stays where they are.');
    if (c.state === 'backlog') {
      if (c.team !== p.team) fail('team', `That customer is waiting for the ${this.team(c.team)?.name || 'other team'}. Ask them to offer it to you.`);
      if (!this.near(p, c.x, c.z)) fail('far', 'Walk up to the customer first.');
    } else {
      const plot = this.plots[c.plot], owner = this.ownerOf(plot);
      if (!this.mates(p, owner)) fail('team', `Only the ${this.team(owner?.team)?.name || 'owner\'s team'} can take customers from that door.`);
      if (!this.near(p, plot.x, plot.z)) fail('far', 'Walk up to the door first.');
    }
    if (p.carry.length >= CARRY) fail('hands', `You can lead ${CARRY} customers at a time.`);
    const fromDoor = c.state === 'queued' ? this.ownerOf(this.plots[c.plot]) : null;
    this.detach(c);
    Object.assign(c, { state: 'held', heldBy: pid, by: pid, from: null, fromTeam: null, movedAt: this.now() });
    p.carry.push(c.id); p.dirty = true;
    this.say(fromDoor && fromDoor !== p ? `${p.name} took "${c.title}" from ${fromDoor.name}'s door` : fromDoor ? `${p.name} took "${c.title}" back from their own door` : `${p.name} claimed "${c.title}"`);
    this.changed();
    return this.cardView(c);
  }

  put(pid, cardId, plotId) {
    const p = this.player(pid), c = this.card(cardId);
    if (c.state !== 'held' || c.heldBy !== pid) fail('taken', 'That customer is not following you.');
    if (plotId === null || plotId === undefined) {
      this.toBacklog(c);
      p.dirty = true;
      this.say(`${p.name} sent "${c.title}" back to the ${this.team(c.team).name} backlog`);
      this.changed();
      return this.cardView(c);
    }
    const plot = this.lived(plotId);
    if (!this.near(p, plot.x, plot.z)) fail('far', 'Walk up to the doormat first.');
    this.place(c, plot, p);
    return this.cardView(c);
  }

  /** The board's shortcut: a card in your own queue goes to another door without the walk. */
  send(pid, cardId, plotId) {
    const p = this.player(pid), c = this.card(cardId), mine = this.plotOf(p);
    if (!mine || c.state !== 'queued' || c.plot !== mine.id) fail('owner', 'You can only send on a customer from your own queue.');
    const plot = this.lived(plotId);
    if (plot === mine) fail('bad', 'That customer is already at your door.');
    this.place(c, plot, p);
    return this.cardView(c);
  }

  /** Why this card cannot go to this door, as a refusal, or null. */
  placeRefusal(c, plot, sender) {
    const owner = this.ownerOf(plot), same = this.mates(sender, owner);
    if (!same && plot.sign === 'private') return refusal('sign', `${owner.name}'s door is private. They are not taking offers.`);
    if (same ? plot.queue.length >= QUEUE : plot.offers.length >= OFFERS) return refusal('full', same ? `${owner.name}'s queue is full.` : `${owner.name} already has ${OFFERS} offers to answer.`);
    if (this.serves(plot, c.title, c)) return refusal('dish', `${owner.name} already serves that.`);
    return null;
  }

  /** Queues a card at a teammate's door (or your own), or offers it to another team's. */
  place(c, plot, sender) {
    const owner = this.ownerOf(plot), same = this.mates(sender, owner);
    const no = this.placeRefusal(c, plot, sender);
    if (no) throw no;
    const mine = sender.pid === owner.pid;
    this.detach(c);
    Object.assign(c, {
      state: same ? 'queued' : 'offered', plot: plot.id, by: sender.pid, from: mine ? null : sender.pid, fromTeam: mine ? null : sender.team,
      x: plot.x, z: plot.z, movedAt: this.now(), offeredAt: same ? null : this.now(),
    });
    (same ? plot.queue : plot.offers).push(c.id);
    sender.dirty = true;
    if (mine) this.say(`${sender.name} queued "${c.title}"`);
    else if (same) this.say(`${sender.name} sent "${c.title}" to ${owner.name}`);
    else this.say(`${sender.name} offered "${c.title}" to ${owner.name}: offered by the ${this.team(sender.team)?.name}`);
    this.admitNext(plot);
    this.changed();
  }

  accept(pid, cardId) {
    const p = this.player(pid), c = this.card(cardId), plot = this.plotOf(p);
    if (c.state !== 'offered') fail('taken', 'That offer is no longer waiting.');
    if (!plot || c.plot !== plot.id) fail('owner', 'Only the owner of that door can accept an offer.');
    if (plot.queue.length >= QUEUE) fail('full', 'Your queue is full.');
    if (this.serves(plot, c.title, c)) fail('dish', 'You already serve that.');
    plot.offers = plot.offers.filter(id => id !== c.id);
    plot.queue.push(c.id);
    Object.assign(c, { state: 'queued', team: p.team, offeredAt: null, movedAt: this.now() });
    this.say(`${p.name} accepted "${c.title}" from ${this.players.get(c.from)?.name || 'a neighbour'}`);
    this.admitNext(plot);
    this.changed();
    return this.cardView(c);
  }

  /** The owner turns an offer down, or the player who made it takes it back. */
  decline(pid, cardId) {
    const p = this.player(pid), c = this.card(cardId);
    if (c.state !== 'offered') fail('taken', 'That offer is no longer waiting.');
    const plot = this.plots[c.plot], owner = this.ownerOf(plot);
    if (owner?.pid !== pid && c.from !== pid) fail('owner', 'Only the owner of that door, or whoever made the offer, can end it.');
    const title = c.title;
    this.toBacklog(c);
    this.say(owner?.pid === pid ? `${p.name} declined "${title}"` : `${p.name} withdrew the offer of "${title}"`);
    this.changed();
    return this.cardView(c);
  }

  /** A waiting order leaves the owner's kitchen again: back to the backlog, or on to another door. */
  bounce(pid, orderId, plotId) {
    const p = this.player(pid), mine = this.plotOf(p);
    const c = mine && [...this.cards.values()].find(x => x.plot === mine.id && x.orderId === Number(orderId) && x.state !== 'served');
    if (!c) fail('gone', 'That order did not come in from the park.');
    if (c.state !== 'seated') fail('locked', 'A chef has that ticket now, so the customer stays.');
    const plot = plotId === null || plotId === undefined ? null : this.lived(plotId);
    if (plot === mine) fail('bad', 'That customer is already yours.');
    if (plot) { const no = this.placeRefusal(c, plot, p); if (no) throw no; }
    try { p.link.withdraw(c.orderId); } catch (e) { fail('locked', e.message); }
    if (plot) this.place(c, plot, p);
    else {
      this.toBacklog(c);
      this.say(`${p.name} sent "${c.title}" back to the ${this.team(c.team).name} backlog`);
      this.changed();
    }
    return this.cardView(c);
  }

  /** Queued customers walk in while the owner is inside and the order window has room. */
  admitNext(plot) {
    const owner = this.ownerOf(plot);
    if (!owner?.link || owner.zone !== `k:${plot.id}` || this.admitting) return false;
    let any = false, room = owner.link.summary().window;
    // A kitchen announces its new order while admit() is still running, so nothing may walk in twice.
    this.admitting = true;
    try {
      while (room > 0 && plot.queue.length) {
        const c = this.cards.get(plot.queue[0]);
        let orderId;
        try { orderId = owner.link.admit({ id: c.id, title: c.title, size: c.size, body: c.body }); } catch { break; }
        plot.queue.shift();
        Object.assign(c, { state: 'seated', orderId, movedAt: this.now() });
        room--; any = true;
      }
    } finally { this.admitting = false; }
    if (any) this.changed();
    return any;
  }

  /** The server says a kitchen changed: follow its orders, lights and score. */
  kitchenChanged(pid) {
    const p = this.players.get(pid), plot = p && this.plotOf(p);
    if (!plot || !p.link || this.admitting) return;
    const s = p.link.summary();
    let any = false;
    const orders = new Map(s.orders.map(o => [o.id, o]));
    for (const c of [...this.cards.values()]) {
      if (c.plot !== plot.id || c.orderId === null || c.state === 'served') continue;
      const o = orders.get(c.orderId);
      const next = !o || o.state === 'binned' ? 'backlog' : o.state === 'shipped' ? 'served' : ['waiting', 'planning'].includes(o.state) ? 'seated' : ['at_pass', 'merging'].includes(o.state) ? 'review' : 'cooking';
      if (next === c.state) continue;
      any = true;
      if (next === 'backlog') { this.toBacklog(c); this.say(`"${c.title}" left ${p.name}'s and is back in the park`); }
      else if (next === 'served') this.served(c, p, plot);
      else Object.assign(c, { state: next, movedAt: this.now() });
    }
    const lights = JSON.stringify(s.lights);
    if (plot.score !== s.score || plot.shipped !== s.shipped || plot.stars !== s.stars || JSON.stringify(plot.lights) !== lights) {
      Object.assign(plot, { score: s.score, shipped: s.shipped, stars: s.stars, lights: s.lights });
      any = true;
    }
    if (this.admitNext(plot)) any = false; // admitNext already announced the change
    else if (any) this.changed();
  }

  served(c, owner, plot) {
    Object.assign(c, { state: 'served', servedAt: this.now(), movedAt: this.now() });
    this.shipped++;
    this.say(`${owner.name} served "${c.title}"`);
    const sender = c.from && c.from !== owner.pid ? this.players.get(c.from) : null, theirs = sender && this.plotOf(sender);
    if (theirs) { theirs.bonus += REFERRAL; this.say(`${sender.name} earns +${REFERRAL} for the referral`); }
    if (this.rush && this.now() < this.rush.endsAt) { const n = RUSH_PER_POINT * SIZE_POINTS[c.size]; plot.bonus += n; this.say(`Rush hour: ${owner.name} earns +${n}`); }
    const done = [...this.cards.values()].filter(x => x.state === 'served').sort((a, b) => a.servedAt - b.servedAt);
    for (const old of done.slice(0, Math.max(0, done.length - SERVED_KEPT))) this.cards.delete(old.id);
  }

  /* ---------- the name card, the door sign, visiting ---------- */

  setMe(pid, { name, look, team } = {}) {
    const p = this.player(pid);
    if (name !== undefined) {
      const clean = cleanName(name);
      if (!clean) fail('name', 'Pick another name: up to 14 letters, and nothing rude.');
      if (clean !== p.name) { this.say(`${p.name} is now ${clean}`); p.name = clean; }
    }
    if (look !== undefined) {
      if (!Number.isInteger(look) || look < 0 || look >= LOOKS) fail('bad', `A look is a number from 0 to ${LOOKS - 1}.`);
      p.look = look;
    }
    if (team !== undefined && team !== p.team) {
      const t = this.team(team);
      if (!t) fail('bad', `The teams are ${this.teams.map(x => x.id).join(', ')}.`);
      // What you were leading stays with the team you leave; the customers at your door come with you.
      for (const id of [...p.carry]) this.toBacklog(this.cards.get(id));
      p.team = t.id;
      const plot = this.plotOf(p);
      if (plot) {
        for (const id of plot.queue) this.cards.get(id).team = t.id;
        // An offer from your new team is simply queued now, while there is room.
        for (const id of [...plot.offers]) { const c = this.cards.get(id); if (c.fromTeam === t.id && plot.queue.length < QUEUE) { plot.offers = plot.offers.filter(x => x !== id); plot.queue.push(id); Object.assign(c, { state: 'queued', offeredAt: null, team: t.id }); } }
        for (const c of this.cards.values()) if (c.plot === plot.id && c.state !== 'offered') c.team = t.id;
        this.admitNext(plot);
      }
      this.say(`${p.name} joined the ${t.name}`);
    }
    p.dirty = true;
    this.changed();
    return this.you(pid);
  }

  setSign(pid, sign) {
    const p = this.player(pid), plot = this.plotOf(p);
    if (!plot) fail('owner', 'You have no door to hang a sign on.');
    if (!SIGNS.includes(sign)) fail('bad', `A door sign is one of ${SIGNS.join(', ')}.`);
    if (plot.sign !== sign) {
      plot.sign = sign;
      this.say(`${p.name}'s door now says "${{ team: 'Open to team', help: 'Help wanted', private: 'Private' }[sign]}"`);
      this.changed();
    }
    return sign;
  }

  /** What this player is to that kitchen and what the server will take from them there. */
  rights(pid, plotId) {
    const p = this.player(pid), plot = this.lived(plotId), owner = this.ownerOf(plot);
    if (owner.pid === pid) return { relation: 'owner', rights: { watch: true, cheer: false, answer: true, approve: true } };
    const team = this.mates(p, owner), open = plot.sign !== 'private';
    return { relation: team ? 'team' : 'stranger', rights: { watch: true, cheer: open, answer: open && (team || plot.sign === 'help'), approve: open && team } };
  }

  /** Throws unless this player is standing in that kitchen with the named right. Returns the owner. */
  allowed(pid, plotId, right) {
    const p = this.player(pid), plot = this.lived(plotId), r = this.rights(pid, plotId);
    if (r.relation !== 'owner' && p.zone !== `k:${plot.id}`) fail('far', 'Step inside that kitchen first.');
    if (!r.rights[right]) fail('sign', right === 'cheer' && r.relation === 'owner' ? 'You cannot cheer for yourself.' : plot.sign === 'private' ? 'This kitchen is private: visitors can only watch.' : r.relation === 'stranger' ? 'Only this kitchen\'s team can do that.' : 'You cannot do that here.');
    return this.ownerOf(plot);
  }

  cheer(pid, plotId) {
    const p = this.player(pid), owner = this.allowed(pid, plotId, 'cheer'), plot = this.plotOf(owner);
    const t = this.now();
    p.cheers = p.cheers.filter(x => x > t - 60_000);
    if (p.cheers.length >= CHEERS_PER_MIN) fail('cooldown', 'Save some applause for later: five cheers a minute.');
    p.cheers.push(t);
    plot.bonus += CHEER;
    if (p.cheers.length === 1) this.say(`${p.name} cheered for ${owner.name}`);
    this.emote(pid, 2);
    this.changed();
    return plot.bonus;
  }

  /** Changes zone. Returns what the client is told: { zone, x, z } and, when it was turned down, refused. */
  go(pid, zone) {
    const p = this.player(pid);
    const here = () => ({ zone: p.zone, x: p.x === null ? null : r2(p.x), z: p.z === null ? null : r2(p.z) });
    if (zone === p.zone) return here();
    const was = p.zone.startsWith('k:') ? this.plots[Number(p.zone.slice(2))] : null;
    if (zone === 'park') {
      Object.assign(p, { zone: 'park', x: was.x, z: was.z, at: this.now(), dirty: true });
    } else {
      const m = typeof zone === 'string' && zone.match(/^k:(\d{1,2})$/), plot = m && this.plots[Number(m[1])];
      if (!plot?.owner) return { ...here(), refused: 'gone' };
      if (was || !this.near(p, plot.x, plot.z)) return { ...here(), refused: 'far' };
      Object.assign(p, { zone: `k:${plot.id}`, x: null, z: null, at: this.now(), dirty: true });
      if (plot.owner === pid) this.admitNext(plot);
    }
    this.changed();
    return here();
  }

  /** A position report, in centimetres and yaw x 100. Speed and bounds are clamped here. */
  move(pid, cx, cz, cr, m) {
    const p = this.players.get(pid);
    if (!p || ![cx, cz, cr].every(Number.isFinite)) return;
    const b = p.zone === 'park' ? PARK_BOUNDS : KITCHEN_BOUNDS, t = this.now();
    let x = clamp(cx / 100, b.x0, b.x1), z = clamp(cz / 100, b.z0, b.z1);
    if (p.x !== null) {
      const max = MAX_SPEED * Math.min(1, Math.max(0, t - p.at) / 1000) + SLACK, d = dist(x, z, p.x, p.z);
      if (d > max) { x = p.x + (x - p.x) * max / d; z = p.z + (z - p.z) * max / d; }
    }
    const flags = (Number.isInteger(m) ? m & 3 : 0) | (p.carry.length ? 4 : 0);
    if (x !== p.x || z !== p.z || cr !== p.rr || flags !== p.m) p.dirty = true;
    Object.assign(p, { x, z, rr: cr, r: clamp(cr, -700, 700) / 100, m: flags, at: t });
  }

  emote(pid, e) {
    const p = this.players.get(pid);
    if (!p || !Number.isInteger(e) || e < 1 || e > 4) return;
    Object.assign(p, { e, eUntil: this.now() + EMOTE_MS, dirty: true });
  }

  phrase(pid, q) {
    const p = this.players.get(pid);
    if (!p || !Number.isInteger(q) || q < 0 || q > 7) return;
    Object.assign(p, { e: 10 + q, eUntil: this.now() + EMOTE_MS, dirty: true });
  }

  /* ---------- the lunch rush ---------- */

  /** Rings the fountain bell: a bus brings two walk-in customers per player. */
  ring(pid) {
    const p = this.player(pid), t = this.now();
    if (!this.near(p, PARK.bell[0], PARK.bell[1], PARK.bellReach)) fail('far', 'Walk up to the fountain to ring the bell.');
    const people = this.people().filter(x => x.plot !== null);
    if (people.length < 2) fail('players', 'The lunch rush needs at least two restaurants open.');
    if (t < this.bellAt) fail('cooldown', `The bell rests for another ${Math.ceil((this.bellAt - t) / 1000)} s.`);
    this.rushNo++;
    this.bellAt = t + this.bellMs;
    this.rush = { no: this.rushNo, endsAt: t + this.rushMs, seatBy: t + this.rushMs / 2, judged: false };
    for (const who of people) {
      for (let i = 0; i < RUSH_PER_PLAYER; i++) {
        const n = ++this.walkIn;
        this.toBacklog(this.newCard({ title: `Table ${n}: ${WALK_INS[n % WALK_INS.length]}`, size: 'S', body: 'A walk-in from the lunch rush bus. Keep it small.' }, who.team, { rush: true, rushNo: this.rushNo }));
      }
    }
    this.say(`${p.name} rang the bell. Lunch rush: seat everyone from the bus!`);
    this.changed();
    return this.rushView();
  }

  rushLeft() { return this.rush ? [...this.cards.values()].filter(c => c.rushNo === this.rush.no && (c.state === 'backlog' || c.state === 'held')).length : 0; }
  rushView() { return this.rush ? { endsAt: this.rush.endsAt, seatBy: this.rush.seatBy, left: this.rushLeft(), bellAt: this.bellAt } : null; }

  /* ---------- the clock ---------- */

  /** Called about 12 times a second: arrivals, expiring offers, the rush, emotes, bots, and each kitchen's lights. */
  tick() {
    const t = this.now();
    let any = false;
    for (const p of this.players.values()) {
      if (p.e && t >= p.eUntil) { p.e = 0; p.dirty = true; }
      if (p.bot) this.wander(p, t);
      while (p.due?.length && p.due[0].at <= t) {
        const { dish } = p.due.shift();
        const c = this.newCard(dish, p.team);
        this.toBacklog(c);
        this.say(`The bus dropped "${c.title}" for the ${this.team(c.team).name}`);
        any = true;
      }
    }
    for (const c of this.cards.values()) {
      if (c.state !== 'offered' || t - c.offeredAt < this.offerMs) continue;
      const owner = this.ownerOf(this.plots[c.plot]);
      this.say(`${owner?.name || 'Nobody'} did not answer, so "${c.title}" went back to the park`);
      this.toBacklog(c);
      any = true;
    }
    if (this.rush) {
      if (!this.rush.judged && t >= this.rush.seatBy) {
        this.rush.judged = true;
        if (this.rushLeft() === 0) {
          for (const pl of this.plots) if (pl.owner) pl.bonus += FULL_HOUSE;
          this.say(`Full house! Everyone earns +${FULL_HOUSE}`);
        } else this.say('The bus left with customers still standing in the park');
        any = true;
      }
      if (t >= this.rush.endsAt) { this.rush = null; this.say('The lunch rush is over'); any = true; }
    }
    if (t - this.lastSlow >= 1000) {
      this.lastSlow = t;
      // Fire is a matter of time, and a customer may be waiting for a window slot, so each open kitchen is looked at once a second.
      for (const p of this.players.values()) if (p.link && p.plot !== null) this.kitchenChanged(p.pid);
    }
    if (any) this.changed();
  }

  addBots(n) {
    for (let i = 0; i < n; i++) {
      const pid = `b${String(i).padStart(5, '0')}`.slice(0, 6);
      const x = (Math.random() - 0.5) * (PARK.w - 4), z = (Math.random() - 0.5) * (PARK.h - 4);
      this.players.set(pid, { pid, name: `Bot ${i + 1}`, look: i % LOOKS, team: null, plot: null, zone: 'park', x, z, r: 0, m: 0, e: 0, eUntil: 0, at: this.now(), dirty: true, carry: [], bot: true, link: null, cheers: [], due: [], tx: x, tz: z, stepAt: this.now() });
    }
    if (n > 0) this.changed();
  }

  wander(p, t) {
    const dt = Math.min(0.5, (t - p.stepAt) / 1000);
    p.stepAt = t;
    const d = dist(p.x, p.z, p.tx, p.tz);
    if (d < 0.2) { p.tx = (Math.random() - 0.5) * (PARK.w - 4); p.tz = (Math.random() - 0.5) * (PARK.h - 4); if (p.m) { p.m = 0; p.dirty = true; } return; }
    const step = Math.min(d, 2.4 * dt);
    p.r = Math.atan2(p.tx - p.x, p.tz - p.z);
    p.x += (p.tx - p.x) / d * step; p.z += (p.tz - p.z) / d * step; p.m = 1; p.at = t; p.dirty = true;
  }

  /* ---------- what clients see ---------- */

  /** Presence for one tick: zone -> [[pid, x, z, r, m, e], ...] for the players that changed, or for everyone when full. */
  frame(full) {
    const zones = new Map();
    for (const p of this.players.values()) {
      if (!full && !p.dirty) continue;
      p.dirty = false;
      if (p.x === null) continue;
      if (!zones.has(p.zone)) zones.set(p.zone, []);
      zones.get(p.zone).push([p.pid, Math.round(p.x * 100), Math.round(p.z * 100), Math.round(p.r * 100), p.m, p.e]);
    }
    return zones;
  }

  cardView(c) {
    return { id: c.id, title: c.title, size: c.size, state: c.state, plot: c.plot, heldBy: c.heldBy, by: c.by, from: c.from, team: c.team, fromTeam: c.fromTeam, rush: c.rush, x: c.x, z: c.z, movedAt: c.movedAt };
  }

  you(pid) {
    const p = this.player(pid);
    return { pid: p.pid, plot: p.plot, team: p.team, name: p.name, look: p.look, zone: p.zone };
  }

  /** The whole town, without `you`. No session id, directory or kitchen content is in here. */
  snapshot() {
    const total = pl => pl.score + pl.bonus;
    const lived = this.plots.filter(pl => pl.owner);
    return {
      v: this.v, now: this.now(), mode: 'demo', park: PARK,
      teams: this.teams.map(t => {
        const theirs = lived.filter(pl => this.ownerOf(pl)?.team === t.id);
        return { ...t, members: this.members(t.id), score: theirs.reduce((n, pl) => n + total(pl), 0), shipped: theirs.reduce((n, pl) => n + pl.shipped, 0) };
      }),
      plots: this.plots.map(pl => {
        const o = this.ownerOf(pl);
        return {
          id: pl.id, slot: pl.slot, side: pl.side, x: pl.x, z: pl.z, owner: pl.owner, name: o?.name ?? null, team: o?.team ?? null, color: o ? this.team(o.team)?.color ?? null : null,
          sign: pl.sign, open: Boolean(o && o.zone === `k:${pl.id}`), queue: [...pl.queue], offers: [...pl.offers], lights: pl.lights, score: pl.score, bonus: pl.bonus, shipped: pl.shipped, stars: pl.stars,
        };
      }),
      players: [...this.players.values()].map(p => ({ pid: p.pid, name: p.name, look: p.look, team: p.team, plot: p.plot, zone: p.zone, x: p.x === null ? null : r2(p.x), z: p.z === null ? null : r2(p.z), r: r2(p.r), carry: [...p.carry], bot: p.bot })),
      cards: [...this.cards.values()].map(c => this.cardView(c)),
      team: { score: lived.reduce((n, pl) => n + total(pl), 0), shipped: this.shipped, goal: Math.max(6, lived.length * 3) },
      rush: this.rushView(), bellAt: this.bellAt,
      feed: [...this.feed],
    };
  }
}
