// ChefWriter and the shared client: one Messages API call per Item on audience floors (spec 7.4, REBUILD 3.2).
// No files, no shell, no web: the only tool is serve_meal, the structured-output tool.
//
// Request shape per model (checked against the claude-api skill, Nov 2026):
//   Haiku 5.5:  tool_choice { type: 'tool', name } (forced), thinking { type: 'disabled' } (forced tool use and thinking do not mix)
//   Sonnet 5.5: forced tool_choice returns a 400 on this model, so tool_choice { type: 'auto', disable_parallel_tool_use: true },
//               a strict tool, the system prompt naming the tool, and thinking { type: 'between_tools' } (thinking off).
//               A reply without the tool call counts as an error (burnt, then retried, then the scripted Meal).
import { chefSystem, chefUser, SERVE_MEAL_TOOL } from './prompts.mjs';
import { costOf, plain } from '../budget.mjs';

const FORCED_TOOL_OK = new Set(['claude-haiku-5-5']);

/** One Anthropic client for the whole server, or null without a key (every floor is then Demo). */
export async function makeClient(config, { client = null } = {}) {
  if (client) return client;
  if (!config.apiKey) return null;
  const { default: Anthropic } = await import('@anthropic-ai/sdk');
  return new Anthropic({ apiKey: config.apiKey, ...(config.baseURL ? { baseURL: config.baseURL } : {}), maxRetries: 0, timeout: config.chefTimeoutMs });
}

/** The tool-choice and thinking fields for a model that must call exactly one tool. */
export function toolFields(model, tool) {
  return FORCED_TOOL_OK.has(model)
    ? { tools: [tool], tool_choice: { type: 'tool', name: tool.name }, thinking: { type: 'disabled' } }
    : { tools: [tool], tool_choice: { type: 'auto', disable_parallel_tool_use: true }, thinking: { type: 'between_tools' } };
}

/** The tool_use block's input, or throws: a refusal, a cut-off reply or a missing call all count as an error. */
export function toolInput(msg, name) {
  if (msg?.stop_reason === 'refusal') throw Object.assign(new Error('The model declined'), { costUsd: costOf(msg.usage, msg.model) });
  const block = (msg?.content || []).find(b => b.type === 'tool_use' && b.name === name);
  if (!block || typeof block.input !== 'object' || !block.input) throw Object.assign(new Error(`No ${name} call in the reply`), { costUsd: costOf(msg?.usage, msg?.model) });
  return block.input;
}

const MAX_CODE_LINES = 40;

/**
 * @param {object} client an Anthropic client
 * @param {object} config
 * @returns {(ctx:{floor:object, order:object, item:object, chef:object, prev?:object|null, signal?:AbortSignal}) => Promise<{summary:string,file:string,code:string,costUsd:number}>}
 */
export function chefWriter(client, config) {
  return async function cook({ floor, order, item, chef, prev, signal }) {
    const model = floor.model;
    const msg = await client.messages.create({
      model, max_tokens: config.chefMaxTokens,
      system: chefSystem(chef, item.station),
      messages: [{ role: 'user', content: chefUser({ order, item, prev }) }],
      ...toolFields(model, SERVE_MEAL_TOOL),
    }, { signal, timeout: config.chefTimeoutMs });
    const costUsd = costOf(msg.usage, model);
    const input = toolInput(msg, SERVE_MEAL_TOOL.name);
    const code = String(input.code ?? '').replace(/\r\n?/g, '\n').split('\n').slice(0, MAX_CODE_LINES).join('\n').replace(/\s+$/, '');
    const summary = plain(input.summary, 400);
    if (!summary && !code) throw Object.assign(new Error('An empty Meal'), { costUsd });
    return { summary: summary || 'The Chef left no note.', file: plain(input.file, 80).replace(/[^\w./-]/g, '') || 'api.js', code, costUsd };
  };
}
