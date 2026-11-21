// One Agent SDK session per Item, in the sandbox, with the options of spec 7.4. queryFn is the SDK's query(), or a test's fake.
import path from 'node:path';
import { denyPathsOutsideSandbox } from './hooks.mjs';

const VERB = { Read: 'Reading', Glob: 'Looking through', Grep: 'Searching', Edit: 'Editing', Write: 'Writing' };
/** A tool's path as the player reads it: relative to the sandbox. */
const short = (p, cwd) => { const s = String(p || ''); if (!s) return ''; return (path.isAbsolute(s) ? path.relative(cwd, s) : s).replace(/\\/g, '/'); };

/**
 * @returns {Promise<{ text:string, costUsd:number, ranOut:boolean, subtype:string }>}
 */
export async function runChef({ queryFn, cwd, model, prompt, systemAppend, signal, onProgress = () => {}, maxTurns = 10, maxBudgetUsd = 0.5, env = process.env, configDir }) {
  const abortController = new AbortController();
  const stop = () => abortController.abort();
  if (signal) { if (signal.aborted) stop(); else signal.addEventListener('abort', stop, { once: true }); }
  const options = {
    cwd, model,
    systemPrompt: { type: 'preset', preset: 'claude_code', append: systemAppend },
    settingSources: [],
    allowedTools: ['Read', 'Glob', 'Grep', 'Edit', 'Write'],
    disallowedTools: ['Bash', 'WebFetch', 'WebSearch', 'Agent', 'Task', 'NotebookEdit'],
    permissionMode: 'dontAsk',
    maxTurns, maxBudgetUsd,
    hooks: { PreToolUse: [{ hooks: [denyPathsOutsideSandbox(cwd)] }] },
    abortController,
    env: { ...env, ...(configDir ? { CLAUDE_CONFIG_DIR: configDir } : {}), CLAUDE_CODE_DISABLE_AUTO_MEMORY: '1' },
  };
  let text = '', costUsd = 0, subtype = 'success', lastText = '';
  try {
    for await (const m of queryFn({ prompt, options })) {
      if (m?.type === 'assistant') {
        for (const b of m.message?.content || []) {
          if (b.type === 'tool_use') onProgress(`${VERB[b.name] || b.name} ${short(b.input?.file_path || b.input?.path || b.input?.pattern || '', cwd)}`.trim());
          else if (b.type === 'text' && b.text?.trim()) lastText = b.text.trim();
        }
      } else if (m?.type === 'result') {
        subtype = m.subtype || 'success';
        costUsd = Number(m.total_cost_usd) || 0;
        text = typeof m.result === 'string' && m.result.trim() ? m.result.trim() : lastText;
      }
    }
  } finally { signal?.removeEventListener?.('abort', stop); }
  const ranOut = subtype === 'error_max_turns' || subtype === 'error_max_budget_usd';
  if (subtype !== 'success' && !ranOut) throw Object.assign(new Error(`The showcase Chef stopped: ${subtype}`), { costUsd });
  return { text: text || lastText, costUsd, ranOut, subtype };
}
