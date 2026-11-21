import path from 'node:path';
import fs from 'node:fs/promises';
import { recipeFor, mergeMain, genericRecipe } from './sim-scripts.mjs';

/**
 * One chef = one agent run. Both drivers share this contract:
 *   run({ cwd, prompt, resume, model, systemAppend, readOnly, signal, onEvent, askHuman, order })
 *     -> { sessionId, summary, costUsd, turns, isError, error }
 * onEvent receives { kind: 'session'|'tool'|'text', ... } as the agent works. A tool event carries `tool`, `text`
 *   and, when the tool reads or writes one file inside the worktree, `file` (relative, forward slashes).
 * askHuman({ kind: 'permission'|'question', toolName, input, questions, reason }) resolves to
 *   { allow: boolean, message?: string, answers?: Record<string,string> }.
 * order is { id, title } for the order being cooked. Only the simulated chef uses it, to pick its recipe.
 */

const READ_TOOLS = new Set(['Read', 'Glob', 'Grep', 'LS', 'TodoWrite', 'WebFetch', 'WebSearch', 'ToolSearch']);
const WRITE_TOOLS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit']);
const FILE_TOOLS = new Set(['Read', ...WRITE_TOOLS]);
const SHELL_TOOLS = new Set(['Bash', 'PowerShell']);
const SAFE_SHELL = /^\s*(npm (test|t|run test|run lint|ci)\b|node --test\b|node [\w./\\-]+|npx --no-install\b|git (status|diff|log|show|add|commit|branch|merge main|stash list)\b|ls\b|dir\b|cat\b|type\b|echo\b|pwd\b|head\b|tail\b|wc\b|grep\b|find\b|mkdir\b)/i;
const RISKY_SHELL = /\b(rm\s+-rf|del\s+\/s|push\b|reset\s+--hard|clean\s+-fd|curl\b|wget\b|sudo\b|format\b|shutdown\b)|\.\.[\\/]/i;
const SUBSHELL = /\$\(|`/;

/** A command line is only as safe as its least safe part, so `npm test && npm install x` still asks. */
const segments = cmd => String(cmd).split(/\s*(?:&&|\|\||;|\||\r?\n)\s*/).filter(s => s.trim());

export const GRANT_CLASSES = ['install', 'network', 'delete'];
const GRANT_SHELL = {
  install: /^\s*((npm|pnpm|bun) (install|i|add)|yarn (add|install)|pip3? install|python3? -m pip install|cargo add|go get|dotnet add)\b/i,
  network: /^\s*(curl|wget|iwr|Invoke-WebRequest|git (fetch|pull|clone))\b/i,
  delete: /^\s*(rm|del|rmdir|rd|Remove-Item|git rm|git clean)\b/i,
};
const NEVER_GRANT = /\.\.[\\/]|\b(sudo|push|shutdown|format)\b|reset\s+--hard/i;
const ABSOLUTE_PATH = /(^|[\s"'=])(\/|~|[a-z]:[\\/])/i;

/**
 * The permission class a request falls under, or null when no spice jar covers it.
 * A grant answers on the head chef's behalf, so this is strict: every part of the command must be safe or in the
 * one class, nothing may reach outside the worktree, and deleting by absolute path is never covered.
 */
export function grantClassFor(toolName, input = {}) {
  if (!SHELL_TOOLS.has(toolName)) return null;
  const cmd = String(input.command || '');
  if (NEVER_GRANT.test(cmd) || SUBSHELL.test(cmd)) return null;
  let found = null;
  for (const part of segments(cmd)) {
    if (SAFE_SHELL.test(part)) continue;
    const cls = GRANT_CLASSES.find(c => GRANT_SHELL[c].test(part));
    if (!cls || (found && found !== cls)) return null;
    if (cls === 'delete' && ABSOLUTE_PATH.test(part.replace(GRANT_SHELL.delete, ''))) return null;
    found = cls;
  }
  return found;
}

function inside(cwd, p) {
  if (!p) return true;
  const abs = path.resolve(cwd, String(p)).toLowerCase();
  const root = path.resolve(cwd).toLowerCase();
  return abs === root || abs.startsWith(root + path.sep);
}

export function summarizeTool(name, input = {}, cwd = '') {
  const rel = p => (p ? path.relative(cwd, path.resolve(cwd, String(p))) || '.' : '');
  switch (name) {
    case 'Read': return `reads ${rel(input.file_path)}`;
    case 'Edit': case 'MultiEdit': return `edits ${rel(input.file_path)}`;
    case 'Write': return `writes ${rel(input.file_path)}`;
    case 'Bash': case 'PowerShell': return `runs ${String(input.command || '').slice(0, 90)}`;
    case 'Grep': return `searches for ${String(input.pattern || '').slice(0, 60)}`;
    case 'Glob': return `looks for ${input.pattern}`;
    case 'TodoWrite': return 'updates its checklist';
    case 'AskUserQuestion': return 'asks you a question';
    case 'WebFetch': return `reads ${input.url}`;
    case 'WebSearch': return `searches the web for ${input.query}`;
    default: return `uses ${name}`;
  }
}

/** The one file a tool call reads or writes, relative to the worktree with forward slashes, or undefined. */
export function toolFile(name, input = {}, cwd = '') {
  if (!FILE_TOOLS.has(name)) return undefined;
  const p = input.file_path || input.notebook_path;
  if (!p || !inside(cwd, p)) return undefined;
  return path.relative(cwd, path.resolve(cwd, String(p))).split(path.sep).join('/') || undefined;
}

/**
 * Decides what a chef may do alone. Anything not decided here goes to the waiter, except in a public restaurant:
 * there the visitor is not the owner of the machine, so anything outside the safe list is simply denied.
 */
function policy(toolName, input, cwd, readOnly, publicMode) {
  const ask = publicMode ? { deny: 'Not allowed in a public kitchen. Use only the files in this directory and the safe commands (npm test, git status/diff/log).' } : 'ask';
  if (toolName === 'AskUserQuestion') return publicMode ? { deny: 'Nobody can answer questions in a public kitchen. Make a sensible assumption, say what it was, and keep going.' } : 'ask';
  if (READ_TOOLS.has(toolName)) {
    if (publicMode && ['WebFetch', 'WebSearch'].includes(toolName)) return ask;
    return inside(cwd, input.file_path || input.path) ? 'allow' : ask;
  }
  if (WRITE_TOOLS.has(toolName)) {
    if (readOnly) return { deny: 'This is a planning pass. Do not change files; describe the plan instead.' };
    return inside(cwd, input.file_path || input.notebook_path) ? 'allow' : ask;
  }
  if (SHELL_TOOLS.has(toolName)) {
    const cmd = String(input.command || '');
    if (readOnly && !/^\s*(git (status|log|diff|show)|ls|dir|cat|type)\b/i.test(cmd)) return { deny: 'This is a planning pass. Only read the code.' };
    if (RISKY_SHELL.test(cmd) || SUBSHELL.test(cmd)) return ask;
    // a public chef may not run arbitrary node: `node -e` or a script it wrote could read the process environment
    if (publicMode && /(^|[\s;&|])node\s+(?!--test\b)/i.test(cmd)) return ask;
    const parts = segments(cmd);
    return parts.length && parts.every(part => SAFE_SHELL.test(part)) ? 'allow' : ask;
  }
  return ask;
}

const KITCHEN_RULES = `You are a chef in Ship Shift: a coding agent cooking one item of a customer's order, in your own git worktree, which is your current directory.
- Stay inside this directory. Do not push, and do not touch other branches.
- Make only the change this item asks for. Other chefs may be cooking other items of the same order on separate branches.
- Add or update tests, and run the project's tests (npm test) before you finish.
- If something is genuinely ambiguous and you cannot pick a sensible default, use the AskUserQuestion tool once. Otherwise decide and keep going.
- Do not commit; the kitchen commits your work when you finish.
- End with a short summary for the waiter: what you changed, how you tested it, and anything they should look at closely.`;

/** The environment a real chef's Claude Code process gets: the machine's own, minus every secret, plus one API key. */
function chefEnv(apiKey) {
  if (!apiKey) return undefined; // local mode: inherit this machine's own Claude credentials
  const env = {};
  for (const [k, v] of Object.entries(process.env)) if (!/^(SHIP_SHARED_KEY|SHIP_VIP_CODE|SHIP_OWNER_TOKEN|ANTHROPIC_|CLAUDE_)/i.test(k)) env[k] = v;
  env.ANTHROPIC_API_KEY = apiKey;
  return env;
}

export const realDriver = {
  name: 'claude',
  /** apiKey: the key to use (a visitor's own, or the team's for VIP sessions); unset uses this machine's credentials. */
  async run({ cwd, prompt, resume, model, systemAppend, readOnly, signal, onEvent, askHuman, apiKey, publicMode = false, maxTurns }) {
    const { query } = await import('@anthropic-ai/claude-agent-sdk');
    const abortController = new AbortController();
    signal?.addEventListener('abort', () => abortController.abort(), { once: true });

    const canUseTool = async (toolName, input) => {
      const decision = policy(toolName, input, cwd, readOnly, publicMode);
      if (decision === 'allow') return { behavior: 'allow', updatedInput: input };
      if (decision && decision.deny) return { behavior: 'deny', message: decision.deny };
      if (toolName === 'AskUserQuestion') {
        const reply = await askHuman({ kind: 'question', toolName, input, questions: input.questions || [] });
        if (!reply.allow) return { behavior: 'deny', message: reply.message || 'The waiter skipped this question. Use your best judgement.' };
        return { behavior: 'allow', updatedInput: { ...input, answers: reply.answers || {} } };
      }
      const reply = await askHuman({ kind: 'permission', toolName, input, reason: summarizeTool(toolName, input, cwd) });
      return reply.allow
        ? { behavior: 'allow', updatedInput: input }
        : { behavior: 'deny', message: reply.message || 'The waiter said no. Find another way.' };
    };

    const env = chefEnv(apiKey);
    const q = query({
      prompt,
      options: {
        cwd,
        model,
        resume,
        abortController,
        canUseTool,
        permissionMode: 'default',
        settingSources: [],
        maxTurns: maxTurns || (readOnly ? 25 : 40),
        systemPrompt: { type: 'preset', preset: 'claude_code', append: [KITCHEN_RULES, systemAppend].filter(Boolean).join('\n\n'), snapshot: true },
        ...(env ? { env } : {}),
      },
    });

    let sessionId = resume || null, result = null;
    try {
      for await (const msg of q) {
        if (msg.session_id && msg.session_id !== sessionId) { sessionId = msg.session_id; onEvent({ kind: 'session', sessionId }); }
        if (msg.type === 'assistant' && !msg.parent_tool_use_id) {
          for (const block of msg.message?.content || []) {
            if (block.type === 'tool_use') onEvent({ kind: 'tool', tool: block.name, text: summarizeTool(block.name, block.input, cwd), file: toolFile(block.name, block.input, cwd) });
            else if (block.type === 'text' && block.text?.trim()) onEvent({ kind: 'text', text: block.text.trim().slice(0, 400) });
          }
        } else if (msg.type === 'result') {
          result = msg;
        }
      }
    } catch (e) {
      if (abortController.signal.aborted) return { sessionId, summary: '', costUsd: 0, turns: 0, isError: true, error: 'Stopped' };
      return { sessionId, summary: '', costUsd: 0, turns: 0, isError: true, error: e.message || String(e) };
    }
    if (!result) return { sessionId, summary: '', costUsd: 0, turns: 0, isError: true, error: 'The agent ended without a result' };
    return {
      sessionId,
      summary: result.subtype === 'success' ? result.result : '',
      costUsd: result.total_cost_usd || 0,
      turns: result.num_turns || 0,
      isError: result.is_error || result.subtype !== 'success',
      error: result.subtype !== 'success' ? `Agent stopped: ${result.subtype}` : null,
    };
  },
};

/** What a run is being asked to do, read from the kitchen's own prompts. */
function runKind(prompt, resume) {
  const merge = prompt.match(/git merge ([^\s`]+)/);
  if (merge) return { kind: 'conflict', note: '', mainBranch: merge[1] };
  if (!resume) return { kind: 'first', note: '' };
  const fed = prompt.match(/Feedback:\n([\s\S]*?)(\n\n|$)/);
  return { kind: 'feedback', note: fed ? fed[1].trim() : '' };
}

/**
 * A free, offline stand-in that makes real file changes so the whole loop can be played, demoed and tested.
 * Items made from a roster-cafe special follow its recipe in sim-scripts.mjs; anything else gets the generic chef.
 * SHIP_SIM_SPEED divides every wait.
 */
export const simDriver = {
  name: 'sim',
  async run({ cwd, prompt, resume, signal, onEvent, order }) {
    const wait = ms => new Promise((res, rej) => {
      if (signal?.aborted) return rej(new Error('Stopped'));
      const stop = () => { clearTimeout(t); rej(new Error('Stopped')); };
      const t = setTimeout(() => { signal?.removeEventListener('abort', stop); res(); }, ms);
      signal?.addEventListener('abort', stop, { once: true });
    });
    const stopIfAborted = () => { if (signal?.aborted) throw new Error('Stopped'); };
    const sessionId = resume || 'sim-' + Math.random().toString(36).slice(2, 10);
    onEvent({ kind: 'session', sessionId });
    const speed = Number(process.env.SHIP_SIM_SPEED) > 0 ? Number(process.env.SHIP_SIM_SPEED) : 1;
    const abs = rel => path.join(cwd, ...rel.split('/'));
    const est = (Number(order?.estMs) || 12000) / speed;
    const ctx = {
      cwd, prompt, title: order?.title || 'item', itemKey: order?.itemKey, ask: order?.ask, ...runKind(prompt, resume),
      est: resume ? est * 0.6 : est,
      step: async (tool, text, { file, ms = 900 } = {}) => { stopIfAborted(); onEvent({ kind: 'tool', tool, text, file }); await wait(ms); },
      say: text => { if (text) onEvent({ kind: 'text', text }); },
      read: rel => fs.readFile(abs(rel), 'utf8').then(t => t.replace(/\r\n/g, '\n'), () => null),
      edit: async (rel, text, why, ms = 900, tool = 'Edit') => {
        stopIfAborted();
        onEvent({ kind: 'tool', tool, text: why, file: rel });
        await fs.mkdir(path.dirname(abs(rel)), { recursive: true });
        await fs.writeFile(abs(rel), text);
        await wait(ms);
      },
    };
    try {
      if (ctx.kind === 'conflict') await mergeMain(ctx);
      const recipe = recipeFor(order?.presetId) || genericRecipe;
      const summary = await recipe.run(ctx);
      return { sessionId, summary, costUsd: 0, turns: 6, isError: false };
    } catch (e) {
      return { sessionId, summary: '', costUsd: 0, turns: 0, isError: true, error: e.message };
    }
  },
};
