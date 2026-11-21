// FloorManager: every floor in memory, its number, name and plot, its lifetime, and the snapshot the wire sees.
// A floor's public fields are the FloorSnapshot (shared/types.js); everything private sits under floor.priv and never leaves.
import crypto from 'node:crypto';
import { freshLine, CHIPS, CHEFS, FLOOR_NAMES } from '../content/orders.mjs';
import { MODEL_LABEL, PLOTS, LIMITS } from '../shared/protocol.js';
import { cleanName } from './building.mjs';

/** Random 21-character floor ids (spec 7.6). */
export const floorId = () => crypto.randomBytes(16).toString('base64url').slice(0, 21);
export const newToken = () => crypto.randomBytes(24).toString('base64url');

export const emptyStats = () => ({ shipped: 0, meals: 0, redos: 0, firstTime: 0, callBacks: 0, callBackMsTotal: 0, breakMs: 0, longestWorkMs: 0, patienceLost: 0, idlePenalty: 0 });

export class FloorManager {
  /** @param {{config:object, now:()=>number, budget:import('./budget.mjs').Budget}} ctx */
  constructor(ctx) {
    this.ctx = ctx;
    /** @type {Map<string, object>} */
    this.floors = new Map();
    this.byToken = new Map();
    this.nextNumber = 1;
    this.namesUsed = 0;
  }

  get size() { return this.floors.size; }
  get(id) { return this.floors.get(id) || null; }
  byOwnerToken(token) { return (token && this.byToken.get(token)) || null; }
  list() { return [...this.floors.values()]; }

  /** A free plot on the park, or null (open question 3: the first 24 floors get one). */
  #freePlot() {
    const used = new Set(this.list().map(f => f.plot).filter(p => p !== null));
    for (let i = 0; i < PLOTS; i++) if (!used.has(i)) return i;
    return null;
  }

  /**
   * @param {{ownerRole:'player'|'judge', kind?:'audience'|'showcase', mode:'live'|'demo', name?:string, settings?:object}} opts
   */
  create({ ownerRole, kind = 'audience', mode, name, settings }) {
    const { config, now } = this.ctx;
    const t = now();
    const model = kind === 'showcase' || ownerRole === 'judge' ? config.models.judge : config.models.player;
    const floor = {
      id: floorId(), number: this.nextNumber++,
      name: cleanName(name, LIMITS.floorName) || FLOOR_NAMES[this.namesUsed++ % FLOOR_NAMES.length],
      plot: this.#freePlot(), kind, ownerRole, mode, timings: 'short',
      model, modelLabel: MODEL_LABEL[model] || model, keySource: 'house',
      budget: { spentUsd: 0, capUsd: this.ctx.budget.capFor({ kind, ownerRole }), blocked: false, canGoLive: false },
      settings: { gracePeriodMs: 0, maxWorkMs: 0, maxAgentsForBreak: LIMITS.chefs },
      ownerAway: false, ownerConnected: true, watchers: 0, demoReason: null,
      chips: { redo: [...CHIPS.redo], serve: [...CHIPS.serve] },
      priv: {
        token: newToken(), heldUsd: 0, abort: new AbortController(), ownerGoneAt: null, endedAt: null,
        dirty: true, popId: 0, seq: 0, fails: {}, prev: {}, mealData: {}, served: {}, hunksSeen: {},
        jobs: new Map(), reviews: new Map(), budgetNotified: false, idleMs: {}, slot: false,
        breakStartedAt: null, mustBreakWarned: false, callBackDueAt: null, rested: false, firstSent: false,
      },
    };
    this.reset(floor, t);
    this.ctx.applyTimings(floor, settings);
    this.floors.set(floor.id, floor);
    this.byToken.set(floor.priv.token, floor);
    return floor;
  }

  /** A fresh shift on an existing floor: the preset line, idle Chefs, score 0 (also Play again). */
  reset(floor, t) {
    const p = floor.priv;
    p.abort.abort(); p.abort = new AbortController();
    p.jobs.clear(); p.reviews.clear();
    Object.assign(p, { fails: {}, prev: {}, mealData: {}, served: {}, hunksSeen: {}, idleMs: {}, endedAt: null, breakStartedAt: null, mustBreakWarned: false, callBackDueAt: null, rested: false, firstSent: false, budgetNotified: false, seq: 0 });
    Object.assign(floor, {
      phase: 'working', phaseStartedAt: t, workStretchStartedAt: t,
      breakEligible: false, mustBreakAt: null, mustBreak: false,
      callBack: { graceEndsAt: null, firedAt: null },
      shift: { status: 'running', startedAt: t, endsAt: null, report: null },
      line: freshLine(), tables: [null, null],
      chefs: CHEFS.map(c => ({ id: c.id, name: c.name, modelLabel: floor.modelLabel, status: 'idle', idleSince: t })),
      readyQueue: [], pass: [], items: {}, meals: {}, score: 0, stats: emptyStats(),
      guide: { seat: false, split: false, review: false, serve: false, ship: false },
      tv: { shots: [], version: 0 }, pops: [],
    });
    floor.budget.blocked = false;
    p.dirty = true;
  }

  destroy(floor) {
    if (!this.floors.has(floor.id)) return false;
    floor.priv.abort.abort();
    this.floors.delete(floor.id);
    this.byToken.delete(floor.priv.token);
    floor.priv.destroyed = true;
    // A freed plot goes to the oldest floor without one.
    if (floor.plot !== null) {
      const waiting = this.list().filter(f => f.plot === null).sort((a, b) => a.number - b.number)[0];
      if (waiting) { waiting.plot = floor.plot; waiting.priv.dirty = true; }
    }
    return true;
  }
}

/** Ids for Items, Meals and pops, unique within a floor. */
export const nextId = (floor, prefix) => `${prefix}${++floor.priv.seq}`;

const PUBLIC_PICK = ({ scriptedMealId, ...q }) => q;
/** Drops the loop's private timer fields (priv_*). */
const pub = o => Object.fromEntries(Object.entries(o).filter(([k]) => !k.startsWith('priv_')));
const pubCustomer = c => c && ({ ...pub(c), order: { ...c.order, quickPicks: c.order.quickPicks.map(PUBLIC_PICK), itemIds: [...c.order.itemIds] } });

/**
 * The FloorSnapshot: an allow-list copy. No token, no key, no cost per Item, no scripted ids.
 * @returns {import('../shared/types.js').FloorSnapshot}
 */
export function snapshot(floor) {
  const items = {};
  for (const [id, it] of Object.entries(floor.items)) {
    const { costUsd, ...rest } = it;
    items[id] = rest;
  }
  return {
    id: floor.id, number: floor.number, name: floor.name, plot: floor.plot,
    kind: floor.kind, ownerRole: floor.ownerRole, mode: floor.mode, timings: floor.timings,
    model: floor.model, modelLabel: floor.modelLabel, keySource: floor.keySource,
    budget: { spentUsd: round4(floor.budget.spentUsd), capUsd: floor.budget.capUsd, blocked: floor.budget.blocked, canGoLive: floor.budget.canGoLive },
    settings: { ...floor.settings },
    phase: floor.phase, phaseStartedAt: floor.phaseStartedAt, workStretchStartedAt: floor.workStretchStartedAt,
    breakEligible: floor.breakEligible, mustBreakAt: floor.mustBreakAt, mustBreak: floor.mustBreak,
    callBack: { ...floor.callBack },
    ownerAway: floor.ownerAway, ownerConnected: floor.ownerConnected, demoReason: floor.demoReason,
    shift: { ...floor.shift },
    line: floor.line.map(pubCustomer), tables: floor.tables.map(pubCustomer),
    chefs: floor.chefs.map(pub),
    readyQueue: [...floor.readyQueue], pass: [...floor.pass],
    items, meals: floor.meals,
    score: floor.score, stats: { ...floor.stats }, watchers: floor.watchers,
    guide: { ...floor.guide }, tv: { shots: [...floor.tv.shots], version: floor.tv.version },
    chips: floor.chips, pops: floor.pops,
  };
}

/** One line per floor for `building`. */
export function floorLine(floor) {
  const cooking = floor.chefs.filter(c => c.status === 'cooking' || c.status === 'waiting_stove').length;
  const waiting = floor.tables.filter(c => c && c.status === 'awaiting_player' && !c.feedbackRead).length;
  return {
    id: floor.id, number: floor.number, name: floor.name, plot: floor.plot, kind: floor.kind, ownerRole: floor.ownerRole,
    mode: floor.mode, model: floor.model, modelLabel: floor.modelLabel, score: floor.score, shipped: floor.stats.shipped,
    watchers: floor.watchers, phase: floor.phase, lights: { cooking, onPass: floor.pass.length, waiting },
  };
}

const round4 = n => Math.round(n * 1e4) / 1e4;
