// BudgetGuard: the price table, reserve before a call, settle after it, and the caps at every level
// (per floor, the judge pool, the global stop). The house key never leaves this process.
import { PRICES } from './config.mjs';

/** Real dollars for one reply, from its usage block. */
export function costOf(usage = {}, model = 'claude-haiku-5-5') {
  const p = PRICES[model] || PRICES['claude-haiku-5-5'];
  return ((usage.input_tokens || 0) * p.input + (usage.output_tokens || 0) * p.output
    + (usage.cache_read_input_tokens || 0) * p.cacheRead + (usage.cache_creation_input_tokens || 0) * p.cacheWrite) / 1e6;
}

/** A safe over-estimate for one call: a full prompt and every output token it may use. */
export function estimateCall(model, maxTokens, inputTokens = 3500) {
  const p = PRICES[model] || PRICES['claude-haiku-5-5'];
  return (inputTokens * p.input + maxTokens * p.output) / 1e6;
}

/** Model text as plain display text: no markup, no control characters, bounded. */
export function plain(text, max) {
  return String(text ?? '').replace(/[<>]/g, '').replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, ' ').replace(/[ \t]+/g, ' ').trim().slice(0, max);
}

export class Budget {
  /** @param {ReturnType<import('./config.mjs').loadConfig>} config */
  constructor(config) {
    this.config = config;
    this.spent = { house: 0, judges: 0 };
    this.held = { house: 0, judges: 0 };
  }

  get total() { return this.spent.house + this.spent.judges; }
  /** Whether live calls can happen at all on this server. */
  get enabled() { return Boolean(this.config.apiKey) || this.config.showcase; }

  capFor(floor) {
    const c = this.config.caps;
    return floor.kind === 'showcase' ? c.showcase : floor.ownerRole === 'judge' ? c.judge : c.player;
  }
  #pool(floor) { return floor.kind !== 'showcase' && floor.ownerRole === 'judge' ? 'judges' : 'house'; }
  #poolCap(pool) {
    const c = this.config.caps;
    return pool === 'judges' ? c.judgePool : Math.max(0, c.globalStop - c.judgePool);
  }

  /** Whether this floor could pay for a call of that estimate now. */
  canAfford(floor, estimate = 0) {
    if (!this.enabled) return false;
    const pool = this.#pool(floor), b = floor.budget;
    if (b.spentUsd + (floor.priv.heldUsd || 0) + estimate > b.capUsd + 1e-9) return false;
    if (this.spent[pool] + this.held[pool] + estimate > this.#poolCap(pool) + 1e-9) return false;
    return this.total + this.held.house + this.held.judges + estimate <= this.config.caps.globalStop + 1e-9;
  }

  /** Holds the estimate. Returns a ticket to settle, or null when a cap would be passed. */
  reserve(floor, estimate) {
    if (!this.canAfford(floor, estimate)) return null;
    const pool = this.#pool(floor);
    this.held[pool] += estimate;
    floor.priv.heldUsd = (floor.priv.heldUsd || 0) + estimate;
    return { floor, pool, estimate, settled: false };
  }

  /** Releases the hold and records what the call really cost. */
  settle(ticket, actualUsd = 0) {
    if (!ticket || ticket.settled) return;
    ticket.settled = true;
    const { floor, pool, estimate } = ticket;
    this.held[pool] = Math.max(0, this.held[pool] - estimate);
    floor.priv.heldUsd = Math.max(0, (floor.priv.heldUsd || 0) - estimate);
    const usd = Math.max(0, Number(actualUsd) || 0);
    this.spent[pool] += usd;
    floor.budget.spentUsd += usd;
  }

  usage() {
    const r = n => Math.round(n * 1e4) / 1e4;
    return { spentUsd: { house: r(this.spent.house), judges: r(this.spent.judges), total: r(this.total) }, caps: { ...this.config.caps } };
  }
}
