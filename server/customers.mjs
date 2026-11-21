// Customers are reviewer agents: after the waiter serves a meal, the customer "eats" it, which means reviewing everything
// served to their table so far against the ticket they raised. Scripted for free, or one Claude call with structured output.
import { scriptedReview } from './projects/roster-cafe.mjs';

export const STATIONS = ['backend', 'frontend', 'database', 'integration'];

/* ---------- spend: one budget for the whole server, with limits per restaurant ---------- */

// US$ per million tokens, input / output. Unknown models are priced like Opus so the caps stay on the safe side.
const PRICES = { 'claude-haiku-5-5': [0.10, 0.50], 'claude-sonnet-5-5': [2, 10], 'claude-opus-5-5': [4, 20], 'claude-haiku-4-5': [1, 5] };
export function costOf(model, usage = {}) {
  const [pin, pout] = PRICES[model] || PRICES['claude-opus-5-5'];
  const input = (usage.input_tokens || 0) + (usage.cache_creation_input_tokens || 0) * 1.25 + (usage.cache_read_input_tokens || 0) * 0.1;
  return (input * pin + (usage.output_tokens || 0) * pout) / 1e6;
}

/**
 * Caps on what real Claude calls may spend. The global cap protects the team's key; the per-restaurant caps stop one
 * visitor from using it all. A visitor's own key is their own money, so only the per-restaurant message caps apply to it.
 */
export class Budget {
  constructor({ capUsd = 40, reviewsPerSession = 20, reviewUsdPerSession = 0.5, chefItemsPerSession = 6, chefUsdPerSession = 1.5, maxRealRuns = 3, unlimitedAccounts = false } = {}) {
    Object.assign(this, { capUsd, reviewsPerSession, reviewUsdPerSession, chefItemsPerSession, chefUsdPerSession, maxRealRuns, unlimitedAccounts });
    this.spent = 0;       // on the shared key, server wide
    this.reviews = 0;
    this.realRuns = 0;    // real chef runs in flight right now, server wide: each one is a Claude Code process
    this.off = process.env.SHIP_REAL === 'off';
  }
  account({ unlimited = this.unlimitedAccounts } = {}) { return { reviews: 0, reviewUsd: 0, chefItems: 0, chefUsd: 0, unlimited }; }
  get exhausted() { return this.off || this.spent >= this.capUsd; }
  canReview(a, ownKey) {
    if (this.off) return false;
    if (a.unlimited) return ownKey || !this.exhausted;
    return a.reviews < this.reviewsPerSession && (ownKey || (!this.exhausted && a.reviewUsd < this.reviewUsdPerSession));
  }
  canChef(a, ownKey) {
    if (this.off || this.realRuns >= this.maxRealRuns) return false;
    if (a.unlimited) return ownKey || !this.exhausted;
    return a.chefItems < this.chefItemsPerSession && (ownKey || (!this.exhausted && a.chefUsd < this.chefUsdPerSession));
  }
  chargeReview(a, usd, ownKey) { a.reviews++; a.reviewUsd += usd; this.reviews++; if (!ownKey) this.add(usd); }
  chargeChef(a, usd, ownKey) { a.chefUsd += usd; if (!ownKey) this.add(usd); }
  add(usd) {
    const before = this.spent;
    this.spent += usd;
    if (before < this.capUsd && this.spent >= this.capUsd) console.warn(`Spend cap of US$${this.capUsd} reached on the shared key: every kitchen is in practice mode now.`);
  }
}

/* ---------- the scripted customer ---------- */

export const simCustomer = {
  name: 'script',
  async review({ customer, served, tests }) {
    return { ...scriptedReview(customer, served.map(i => i.presetId).filter(Boolean), tests?.ok !== false), source: 'script', costUsd: 0 };
  },
};

/* ---------- the real customer: one Claude call per review ---------- */

const MAX_DIFF = 40_000;
const STRICT = { 1: 'relaxed', 2: 'fair', 3: 'strict' };

function reviewPrompt({ customer, served, tests, patch }) {
  const items = served.map((it, i) => [
    `${i + 1}. [${it.station}] ${it.prompt}`,
    it.summary ? `   Chef's summary: ${it.summary.slice(0, 800)}` : '',
    it.note ? `   Waiter's note: ${it.note}` : '',
  ].filter(Boolean).join('\n')).join('\n');
  let diff = patch || '(no changes)';
  if (diff.length > MAX_DIFF) {
    const files = [...diff.matchAll(/^diff --git a\/(\S+)/gm)].map(m => m[1]);
    diff = `${diff.slice(0, MAX_DIFF)}\n\n[diff truncated after ${MAX_DIFF} characters. Files changed in total: ${files.join(', ')}]`;
  }
  return [
    `Your ticket ${customer.key}: ${customer.title}`,
    customer.body,
    'Acceptance criteria:',
    ...(customer.acceptance || []).map(a => `- ${a}`),
    '',
    'Work served to your table so far:',
    items || '(nothing yet)',
    '',
    `Tests on your table's branch: ${tests ? (tests.ok ? 'PASS' : 'FAIL') : 'not run'}`,
    tests && !tests.ok ? tests.output.slice(-1500) : '',
    '',
    'The diff of everything served so far, against main:',
    '```diff',
    diff,
    '```',
  ].join('\n');
}

function systemPrompt(customer) {
  const p = customer.persona;
  return [
    `You are ${p.name}, ${p.role} at Little Wattle cafe. You raised ticket ${customer.key}. A waiter has served work toward it. Review it as a ${STRICT[p.strictness] || 'fair'} customer.`,
    "- Judge only against your ticket's acceptance criteria. Don't invent new scope.",
    '- "satisfied" means every acceptance criterion is met and the tests pass.',
    '- Otherwise "needs_more": list at most 3 missing items, each tagged with the station that should do it (backend, frontend, database or integration), each as a short instruction a coding agent can follow.',
    '- satisfaction is a whole number from 1 (unhappy) to 5 (delighted).',
    '- feedback: at most 60 words, first person, in character, specific to what you saw in the diff.',
  ].join('\n');
}

let SDK = null;
async function sdk() {
  if (SDK) return SDK;
  const [{ default: Anthropic }, { zodOutputFormat }, { z }] = await Promise.all([import('@anthropic-ai/sdk'), import('@anthropic-ai/sdk/helpers/zod'), import('zod')]);
  const Review = z.object({
    verdict: z.enum(['satisfied', 'needs_more']),
    satisfaction: z.number(),
    feedback: z.string(),
    missing: z.array(z.object({ station: z.enum(STATIONS), prompt: z.string() })),
  });
  SDK = { Anthropic, format: zodOutputFormat(Review) };
  return SDK;
}

/** One review from Claude. Throws on any failure; the restaurant falls back to the scripted review. */
export async function claudeReview({ apiKey, model, customer, served, tests, patch, timeoutMs = 15_000 }) {
  const { Anthropic, format } = await sdk();
  const client = new Anthropic({ apiKey, maxRetries: 1, timeout: timeoutMs });
  const res = await client.messages.parse({
    model,
    max_tokens: 8000,
    system: systemPrompt(customer),
    messages: [{ role: 'user', content: reviewPrompt({ customer, served, tests, patch }) }],
    output_config: { format, effort: 'low' },
  });
  const costUsd = costOf(model, res.usage);
  if (res.stop_reason === 'refusal') throw Object.assign(new Error('The reviewer declined'), { costUsd });
  const r = res.parsed_output;
  if (!r) throw Object.assign(new Error(`No review in the response (${res.stop_reason})`), { costUsd });
  return {
    verdict: r.verdict === 'satisfied' ? 'satisfied' : 'needs_more',
    satisfaction: Math.max(1, Math.min(5, Math.round(Number(r.satisfaction) || 3))),
    feedback: String(r.feedback || '').slice(0, 500),
    missing: (r.missing || []).slice(0, 3).map(m => ({ station: STATIONS.includes(m.station) ? m.station : 'backend', prompt: String(m.prompt || '').slice(0, 600) })),
    source: 'claude',
    costUsd,
  };
}
