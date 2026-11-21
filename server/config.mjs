// Reads the environment once. Nothing else in the server touches process.env.
import { TIMINGS, SETTINGS_RANGE, DEMO_SHIFT_LIMIT_MS, MUST_BREAK_WARNING_MS } from '../shared/protocol.js';

const num = (v, d) => (v !== undefined && v !== '' && Number.isFinite(Number(v)) && Number(v) >= 0 ? Number(v) : d);

/** Dollars per million tokens (spec 7.5, checked 21 Nov 2026). Prompts stay far below Haiku's 100k line. */
export const PRICES = {
  'claude-haiku-5-5': { input: 0.10, output: 0.50, cacheRead: 0.01, cacheWrite: 0.125 },
  'claude-sonnet-5-5': { input: 2.00, output: 10.00, cacheRead: 0.10, cacheWrite: 2.50 },
};

/** @param {Record<string,string|undefined>} [env] */
export function loadConfig(env = process.env) {
  const showcase = env.SHOWCASE === '1';
  const pace = num(env.SHIP_PACE, 1) || 1;
  const scale = table => Object.fromEntries(Object.entries(table).map(([k, v]) => [k, k === 'cookDivisor' || v === null ? v : v / pace]));
  const apiKey = env.ANTHROPIC_API_KEY || '';
  const defaultMode = env.DEFAULT_MODE === 'demo' ? 'demo' : 'live';
  return {
    port: num(env.PORT, 4610),
    host: env.SHIP_HOST || '0.0.0.0',
    apiKey,
    baseURL: env.ANTHROPIC_BASE_URL || '',
    adminSecret: env.ADMIN_SECRET || '',
    maxLiveFloors: showcase ? 1 : Math.floor(num(env.MAX_LIVE_FLOORS, 60)),
    judgeSlots: showcase ? 0 : Math.floor(num(env.JUDGE_SLOTS, 6)),
    maxFloors: Math.floor(num(env.MAX_FLOORS, 200)),
    maxInflight: Math.max(1, Math.floor(num(env.MAX_INFLIGHT_CALLS, 20))),
    caps: {
      player: num(env.PLAYER_CAP_USD, 0.10), judge: num(env.JUDGE_CAP_USD, 1.00), judgePool: num(env.JUDGE_POOL_USD, 15),
      globalStop: num(env.GLOBAL_STOP_USD, 100), showcase: num(env.SHOWCASE_CAP_USD, 5),
    },
    defaultMode,
    liveTimings: env.LIVE_TIMINGS === 'short' ? 'short' : 'real',
    showcase,
    pace,
    models: { player: 'claude-haiku-5-5', judge: 'claude-sonnet-5-5' },
    timings: { real: scale(TIMINGS.real), short: scale(TIMINGS.short) },
    ranges: {
      real: { gracePeriodMs: SETTINGS_RANGE.real.gracePeriodMs.map(v => v / pace), maxWorkMs: SETTINGS_RANGE.real.maxWorkMs.map(v => v / pace) },
      short: { gracePeriodMs: SETTINGS_RANGE.short.gracePeriodMs.map(v => v / pace), maxWorkMs: SETTINGS_RANGE.short.maxWorkMs.map(v => v / pace) },
    },
    // Fixed beats of the kitchen, in ms.
    walkMs: 800 / pace, plateMs: 800 / pace, burntMs: 2000 / pace, payMs: 3000 / pace,
    demoShiftLimitMs: DEMO_SHIFT_LIMIT_MS / pace, mustBreakWarningMs: MUST_BREAK_WARNING_MS / pace,
    idleChargeMs: 10_000 / pace, breakBonus: 10,
    idleDestroyMs: 15 * 60_000 / pace, endedDestroyMs: 5 * 60_000 / pace, slotHoldMs: 30_000 / pace,
    buildingEveryMs: 2000, tickMs: 250, peersEveryMs: 200, floorFlushMs: 100,
    chefTimeoutMs: 30_000, chefMaxTokens: 1500, reviewMaxTokens: 700,
  };
}
