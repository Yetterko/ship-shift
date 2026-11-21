// CustomerReviewer: one Messages API call per review on the floor's model, forced submit_review (FR-30, spec 7.4).
import { customerSystem, customerUser, SUBMIT_REVIEW_TOOL } from './prompts.mjs';
import { toolFields, toolInput } from './chef.mjs';
import { costOf, plain } from '../budget.mjs';
import { STATIONS } from '../../shared/protocol.js';

const words = (s, n) => s.split(/\s+/).filter(Boolean).slice(0, n).join(' ');

/** Clamps a model's review into a Feedback. */
export function toFeedback(input) {
  const score = Math.min(5, Math.max(1, Math.round(Number(input.score) || 3)));
  const satisfied = Boolean(input.satisfied);
  const ups = Array.isArray(input.suggestedFollowUps) ? input.suggestedFollowUps : [];
  return {
    satisfied, score,
    comments: words(plain(input.comments, 600), 60) || (satisfied ? 'That does the job.' : 'Not quite there yet.'),
    suggestedFollowUps: satisfied ? [] : ups
      .map(f => ({ prompt: plain(f?.prompt, 300), station: STATIONS.includes(f?.station) ? f.station : 'frontend' }))
      .filter(f => f.prompt).slice(0, 3),
  };
}

export function customerReviewer(client, config) {
  return async function review({ floor, customer, meals, note, files, signal }) {
    const model = floor.model;
    const msg = await client.messages.create({
      model, max_tokens: config.reviewMaxTokens,
      system: customerSystem(customer),
      messages: [{ role: 'user', content: customerUser({ customer, meals, note, files }) }],
      ...toolFields(model, SUBMIT_REVIEW_TOOL),
    }, { signal, timeout: config.chefTimeoutMs });
    const costUsd = costOf(msg.usage, model);
    const input = toolInput(msg, SUBMIT_REVIEW_TOOL.name);
    return { feedback: toFeedback(input), costUsd };
  };
}
