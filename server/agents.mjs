import path from 'node:path';
import fs from 'node:fs/promises';
import { recipeFor, mergeMain } from './sim-scripts.mjs';

/**
 * One chef = one agent run. Both drivers share this contract:
 *   run({ cwd, prompt, resume, model, systemAppend, readOnly, signal, onEvent, askHuman, order })
 *     -> { sessionId, summary, costUsd, turns, isError, error }
 * onEvent receives { kind: 'session'|'tool'|'text', ... } as the agent works. A tool event carries `tool`, `text`
 *   and, when the tool reads or writes one file inside the worktree, `file` (relative, forward slashes).
 * askHuman({ kind: 'permission'|'question', toolName, input, questions, reason }) resolves to
 *   { allow: boolean, message?: string, answers?: Record<string,string> }.
 * order is { id, title, mainBranch } for the order being cooked. Only the simulated chef uses it, to pick its recipe
 *   and to know which branch a conflict run merges in.
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

/** Decides what a chef may do alone. Anything not decided here goes to the human. */
function policy(toolName, input, cwd, readOnly) {
  if (toolName === 'AskUserQuestion') return 'ask';
  if (READ_TOOLS.has(toolName)) return inside(cwd, input.file_path || input.path) ? 'allow' : 'ask';
  if (WRITE_TOOLS.has(toolName)) {
    if (readOnly) return { deny: 'This is a planning pass. Do not change files; describe the plan instead.' };
    return inside(cwd, input.file_path || input.notebook_path) ? 'allow' : 'ask';
  }
  if (SHELL_TOOLS.has(toolName)) {
    const cmd = String(input.command || '');
    if (readOnly && !/^\s*(git (status|log|diff|show)|ls|dir|cat|type)\b/i.test(cmd)) return { deny: 'This is a planning pass. Only read the code.' };
    if (RISKY_SHELL.test(cmd) || SUBSHELL.test(cmd)) return 'ask';
    const parts = segments(cmd);
    return parts.length && parts.every(part => SAFE_SHELL.test(part)) ? 'allow' : 'ask';
  }
  return 'ask';
}

const KITCHEN_RULES = `You are a chef in Ship Shift: a coding agent working one order (task) in your own git worktree, which is your current directory.
- Stay inside this directory. Do not push, and do not touch other branches.
- Make the change the order asks for, add or update tests, and run the project's tests before you finish.
- If something about the order is genuinely ambiguous and you cannot pick a sensible default, use the AskUserQuestion tool once. Otherwise decide and keep going.
- Do not commit; the kitchen commits your work when you finish.
- End with a short summary for the reviewer: what you changed, how you tested it, and anything they should look at closely.`;

export const realDriver = {
  name: 'claude',
  async run({ cwd, prompt, resume, model, systemAppend, readOnly, signal, onEvent, askHuman }) {
    const { query } = await import('@anthropic-ai/claude-agent-sdk');
    const abortController = new AbortController();
    signal?.addEventListener('abort', () => abortController.abort(), { once: true });

    const canUseTool = async (toolName, input) => {
      const decision = policy(toolName, input, cwd, readOnly);
      if (decision === 'allow') return { behavior: 'allow', updatedInput: input };
      if (decision && decision.deny) return { behavior: 'deny', message: decision.deny };
      if (toolName === 'AskUserQuestion') {
        const reply = await askHuman({ kind: 'question', toolName, input, questions: input.questions || [] });
        if (!reply.allow) return { behavior: 'deny', message: reply.message || 'The head chef skipped this question. Use your best judgement.' };
        return { behavior: 'allow', updatedInput: { ...input, answers: reply.answers || {} } };
      }
      const reply = await askHuman({ kind: 'permission', toolName, input, reason: summarizeTool(toolName, input, cwd) });
      return reply.allow
        ? { behavior: 'allow', updatedInput: input }
        : { behavior: 'deny', message: reply.message || 'The head chef said no. Find another way.' };
    };

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
        maxTurns: readOnly ? 25 : 80,
        systemPrompt: { type: 'preset', preset: 'claude_code', append: [KITCHEN_RULES, systemAppend].filter(Boolean).join('\n\n'), snapshot: true },
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

/**
 * Kitchen ranks. Each is a model, and a wage that follows the model's real price: the wage is the model's output price
 * per million tokens divided by 100, in dollars per game minute of cooking ($40, $20, $10 and $0.50 per million).
 * The sim* numbers are how a simulated chef of that rank behaves, so the trade-off is honest without spending anything:
 *   slow   multiplies how long each step takes
 *   ask    multiplies the chance of each scripted question
 *   extra  the chance of one more "is this the right place?" question before starting
 *   slip   the chance that a first attempt leaves a failing test behind
 *   first  whether the scripted Overtime order is right first time (it fails once for every rank below Head Chef)
 */
export const RANKS = [
  { id: 'head', label: 'Head Chef', model: 'claude-fable-5-2', wage: 0.4, sim: { slow: 1.5, ask: 0.4, extra: 0, slip: 0, first: true } },
  { id: 'sous', label: 'Sous Chef', model: 'claude-opus-5-5', wage: 0.2, sim: { slow: 1, ask: 1, extra: 0, slip: 0, first: false } },
  { id: 'line', label: 'Line Cook', model: 'claude-sonnet-5-5', wage: 0.1, sim: { slow: 0.8, ask: 1, extra: 0.3, slip: 0.25, first: false } },
  { id: 'commis', label: 'Commis', model: 'claude-haiku-5-5', wage: 0.005, sim: { slow: 0.55, ask: 1, extra: 0.8, slip: 0.6, first: false } },
];
export const DEFAULT_RANK = 'sous';
export const rankOf = id => RANKS.find(r => r.id === id) || null;

// A slip is one real failing test, left in the worktree by a junior chef's first attempt and removed on their next run.
const SLIP_FILE = 'test/slip.test.js';
const slipTest = title => `import test from 'node:test';\nimport assert from 'node:assert/strict';\n\n// Left behind by a first attempt that was not finished.\ntest('the change for ${JSON.stringify(title).slice(1, -1).replace(/'/g, '')} is finished', () => {\n  assert.fail('half-finished: this case was written before the code that makes it pass');\n});\n`;

/** What a run is being asked to do, read from the kitchen's own prompts. */
function runKind(prompt, resume) {
  const called = prompt.match(/The head chef called out: (.*)/);
  if (called) return { kind: 'steer', note: called[1].trim() };
  // Only the kind comes from the prompt. The branch to merge comes from the kitchen, never from text a visitor may have typed.
  if (/git merge /.test(prompt)) return { kind: 'conflict', note: '' };
  if (!resume) return { kind: 'first', note: '' };
  const fed = prompt.match(/Feedback:\n([\s\S]*?)(\n\n|$)/);
  return { kind: 'feedback', note: fed ? fed[1].trim() : '' };
}

/** The generic chef, for any order that has no recipe: one real edit, sometimes a question. */
const genericRecipe = {
  async run(ctx) {
    await ctx.step('Glob', 'looks for src/**/*.js');
    await ctx.step('Read', 'reads src/pay.js', { file: 'src/pay.js' });
    if (ctx.kind === 'conflict') await mergeMain(ctx);
    if (ctx.kind === 'steer') ctx.say(`Heard you: "${ctx.note}".`);
    if (ctx.kind === 'first' && ctx.wantsAsk()) {
      const pick = await ctx.ask({ question: 'Should rounding happen per shift or on the weekly total?', header: 'Rounding', options: [{ label: 'Per shift', description: 'Round each shift to cents' }, { label: 'Weekly total', description: 'Round once at the end' }] });
      ctx.say(pick ? `Going with: ${pick}` : 'No answer, using my best judgement.');
    }
    const file = 'src/kitchen-notes.js';
    const line = `// ${ctx.kind === 'first' ? 'Change' : 'Revision'} for: ${ctx.title.slice(0, 80)}\nexport const touched${Date.now()} = true;\n`;
    await ctx.edit(file, ((await ctx.read(file)) || '') + line, `edits ${file}`);
    if (ctx.kind !== 'steer' && Math.random() < Math.min(0.3, ctx.askChance)) {
      const allowed = await ctx.permit('npm install csv-stringify');
      ctx.say(allowed ? 'Allowed, but the change did not need it after all.' : 'Skipped the dependency and wrote it by hand.');
    }
    await ctx.step('Bash', 'runs npm test', { ms: 1400 });
    return `${ctx.kind === 'first' ? 'Made the change.' : 'Addressed your feedback.'} Simulated chef: edited ${file} and ran npm test.`;
  },
};

/**
 * A free, offline stand-in that makes real file changes so the whole loop can be demoed and tested.
 * Starter orders in the demo repo follow a recipe from sim-scripts.mjs; anything else gets the generic chef.
 * SHIP_SIM_SPEED divides every wait. SHIP_SIM_ASK is the chance of each question or permission request;
 * when it is unset a recipe always asks and the generic chef asks half the time.
 */
export const simDriver = {
  name: 'sim',
  async run({ cwd, prompt, resume, readOnly, signal, onEvent, askHuman, order, rank }) {
    const habits = (rankOf(rank) || rankOf(DEFAULT_RANK)).sim;
    const wait = ms => new Promise((res, rej) => {
      if (signal?.aborted) return rej(new Error('Stopped'));
      const stop = () => { clearTimeout(t); rej(new Error('Stopped')); };
      const t = setTimeout(() => { signal?.removeEventListener('abort', stop); res(); }, ms);
      signal?.addEventListener('abort', stop, { once: true });
    });
    const stopIfAborted = () => { if (signal?.aborted) throw new Error('Stopped'); };
    const sessionId = resume || 'sim-' + Math.random().toString(36).slice(2, 10);
    onEvent({ kind: 'session', sessionId });
    // A Head Chef takes their time and a Commis rushes.
    const speed = (Number(process.env.SHIP_SIM_SPEED) > 0 ? Number(process.env.SHIP_SIM_SPEED) : 1) / habits.slow;
    const title = order?.title || (prompt.match(/^Order #\d+ \(\w\): (.*)$/m) || [])[1] || prompt.split('\n').find(l => l.trim()) || 'order';
    const abs = rel => path.join(cwd, ...rel.split('/'));
    const ctx = {
      cwd, prompt, title, ...runKind(prompt, resume), mainBranch: order?.mainBranch || 'main',
      askChance: 1, rank: rankOf(rank)?.id || DEFAULT_RANK, firstTryRight: habits.first,
      step: async (tool, text, { file, ms = 900 } = {}) => { stopIfAborted(); onEvent({ kind: 'tool', tool, text, file }); await wait(ms / speed); },
      say: text => { if (text) onEvent({ kind: 'text', text }); },
      read: rel => fs.readFile(abs(rel), 'utf8').then(t => t.replace(/\r\n/g, '\n'), () => null),
      edit: async (rel, text, why, ms = 900, tool = 'Edit') => {
        stopIfAborted();
        onEvent({ kind: 'tool', tool, text: why, file: rel });
        await fs.mkdir(path.dirname(abs(rel)), { recursive: true });
        await fs.writeFile(abs(rel), text);
        await wait(ms / speed);
      },
      wantsAsk: () => Math.random() < ctx.askChance,
      ask: async question => {
        const reply = await askHuman({ kind: 'question', toolName: 'AskUserQuestion', questions: [question] });
        return reply.allow ? Object.values(reply.answers || {})[0] || reply.message || null : null;
      },
      permit: async command => (await askHuman({ kind: 'permission', toolName: 'Bash', input: { command }, reason: `runs ${command}` })).allow,
    };
    try {
      let recipe = recipeFor(title);
      if (recipe && !(await recipe.applies(ctx))) recipe = null;
      const asked = process.env.SHIP_SIM_ASK;
      ctx.askChance = (asked !== undefined && asked !== '' ? Number(asked) : recipe ? 1 : 0.5) * habits.ask;
      if (readOnly) {
        const file = recipe?.planFile || 'src/pay.js';
        await ctx.step('Glob', 'looks for src/**/*.js');
        await ctx.step('Read', `reads ${file}`, { file });
        await ctx.step('Grep', 'searches for shiftHours');
        return { sessionId, summary: recipe?.plan || `Plan:\n1. Find where the order touches the code.\n2. Change the smallest function that does it.\n3. Add a test per case named in the order.\n4. Run npm test.`, costUsd: 0, turns: 3, isError: false };
      }
      // A junior chef asks before they start, more often than not.
      const set = v => (v !== undefined && v !== '' ? Number(v) : null);
      if (ctx.kind === 'first' && Math.random() < (set(asked) ?? 1) * habits.extra) {
        const pick = await ctx.ask({ question: `Before I start on "${title.slice(0, 60)}": should I change the existing code, or add a new file next to it?`, header: 'Where', options: [{ label: 'Change what is there', description: 'Edit the function that already does this' }, { label: 'Add a new file', description: 'Leave the existing code alone' }] });
        ctx.say(pick ? `Right: ${pick.toLowerCase()}.` : 'No answer. I will change what is there.');
      }
      // The slip from the last attempt is cleared before anything else: that is the fix.
      const slipped = (await ctx.read(SLIP_FILE)) != null;
      if (slipped) { ctx.say('The half-finished test from my first attempt is still there. Finishing it properly.'); await fs.rm(abs(SLIP_FILE), { force: true }); onEvent({ kind: 'tool', tool: 'Edit', text: `removes ${SLIP_FILE}`, file: SLIP_FILE }); }
      let summary = await (recipe || genericRecipe).run(ctx);
      // And a first attempt may leave one, unless the recipe already fails on its own (Overtime does, below Head Chef).
      const hasTests = await fs.stat(abs('test')).then(st => st.isDirectory(), () => false);
      const failsAnyway = recipe?.failsFirst && !habits.first;
      if (ctx.kind === 'first' && !slipped && hasTests && !failsAnyway && habits.slip > 0 && Math.random() < (set(process.env.SHIP_SIM_SLIP) ?? habits.slip)) {
        await ctx.edit(SLIP_FILE, slipTest(title), `writes ${SLIP_FILE}`, 600, 'Write');
        summary += ' I added a test for one more case and ran out of time before making it pass.';
      }
      return { sessionId, summary, costUsd: 0, turns: 6, isError: false };
    } catch (e) {
      return { sessionId, summary: '', costUsd: 0, turns: 0, isError: true, error: e.message };
    }
  },
};
