// The showcase floor with a fake Agent SDK query(): the SDK is never imported and no model is ever called.
// 1. createShowcase on its own: a real git diff and hunks, progress, the PreToolUse hook, the preview, ranOut, reset.
// 2. The whole server with SHOWCASE=1 and that showcase injected: an Item cooks through showcase.cook into a real Meal.
import fs from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createShowcase } from '../server/showcase/index.mjs';
import { denyPathsOutsideSandbox } from '../server/showcase/hooks.mjs';
import { wsClient } from './helpers/server.mjs';
import { ok, until, passedCount } from './helpers/headless.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'ship-showcase-test-'));
const TOTAL = '\n/** Total hours one staff member works in the week. */\nexport function totalHours(staffId, shifts) {\n  return getShiftsFor(staffId, shifts).reduce((sum, s) => sum + hours(s), 0);\n}\n';

/** A stand-in for the SDK's query(): reads, edits api.js in options.cwd, asks the hook about a path outside, and finishes. */
const calls = [];
function fakeQuery({ subtype = 'success', edit = true } = {}) {
  return ({ prompt, options }) => {
    calls.push({ prompt, options });
    return (async function* () {
      yield { type: 'assistant', message: { content: [{ type: 'tool_use', name: 'Read', input: { file_path: path.join(options.cwd, 'api.js') } }] } };
      const hook = options.hooks.PreToolUse[0].hooks[0];
      calls.at(-1).outside = await hook({ hook_event_name: 'PreToolUse', tool_name: 'Read', tool_input: { file_path: path.join(options.cwd, '..', '..', 'secret.txt') } }, 't1', { signal: new AbortController().signal });
      if (edit) {
        yield { type: 'assistant', message: { content: [{ type: 'tool_use', name: 'Edit', input: { file_path: path.join(options.cwd, 'api.js') } }] } };
        await fs.appendFile(path.join(options.cwd, 'api.js'), TOTAL);
      }
      yield { type: 'assistant', message: { content: [{ type: 'text', text: 'Added totalHours(staffId, shifts) to api.js.' }] } };
      yield { type: 'result', subtype, result: subtype === 'success' ? 'Added totalHours(staffId, shifts) to api.js.' : undefined, total_cost_usd: 0.12, is_error: subtype !== 'success' };
    })();
  };
}

const order = { source: 'GitHub Issue #3', title: "Show each person's total weekly hours", acceptanceCriteria: ['A function returns the total hours'] };
const item = { id: 'i1', prompt: 'Backend: add totalHours(staffId, shifts) to api.js', station: 'backend', redoCount: 0 };
const chef = { id: 'pixel', name: 'Pixel' };
let sc = null, server = null, srv = null;

try {
  console.log('the showcase module');
  sc = await createShowcase({ root, config: { models: { judge: 'claude-sonnet-5-5' } }, queryFn: fakeQuery(), dir: path.join(tmp, 'a') });
  const v0 = sc.version();
  const progress = [];
  const meal = await sc.cook({ order, item, chef, onProgress: t => progress.push(t) });
  ok(meal.changedFiles.join() === 'api.js', `the Meal names the changed file (${meal.changedFiles})`);
  ok(/\+export function totalHours/.test(meal.diff) && /^diff --git a\/api\.js b\/api\.js/m.test(meal.diff), 'the Meal carries the real git diff');
  ok(meal.hunks.length >= 1 && meal.hunks[0].file === 'api.js' && meal.hunks[0].lines.some(l => l.t === '+' && /totalHours/.test(l.text)), 'and its hunks');
  ok(/totalHours/.test(meal.summary) && meal.costUsd === 0.12 && meal.ranOut === false, 'summary and cost come from the result message');
  ok(progress.includes('Reading api.js') && progress.includes('Editing api.js'), `tool use becomes the Chef's progress (${progress.join(' / ')})`);
  ok(sc.version() > v0, 'the preview version rises when files change');
  const o = calls[0].options;
  ok(o.permissionMode === 'dontAsk' && o.settingSources.length === 0 && ['Bash', 'WebFetch', 'WebSearch', 'Agent'].every(t => o.disallowedTools.includes(t)) && o.allowedTools.join() === 'Read,Glob,Grep,Edit,Write', 'the session gets the spec 7.4 options');
  ok(o.model === 'claude-sonnet-5-5' && o.maxTurns === 10 && o.maxBudgetUsd > 0 && o.systemPrompt.preset === 'claude_code' && /Chef Pixel/.test(o.systemPrompt.append), 'Sonnet, capped turns and budget, the Chef prompt appended');
  ok(calls[0].outside?.hookSpecificOutput?.permissionDecision === 'deny', 'a path outside the sandbox is denied by the hook');
  const hook = denyPathsOutsideSandbox(sc.dir);
  ok((await hook({ hook_event_name: 'PreToolUse', tool_name: 'Edit', tool_input: { file_path: path.join(sc.dir, 'ui.js') } })).hookSpecificOutput === undefined, 'a path inside is allowed');
  ok((await hook({ hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command: 'ls' } })).hookSpecificOutput?.permissionDecision === 'deny', 'Bash is denied even if it slipped through');
  ok((await hook({ hook_event_name: 'PreToolUse', tool_name: 'Glob', tool_input: { pattern: '../../**/*.env' } })).hookSpecificOutput?.permissionDecision === 'deny', 'a search pattern climbing out is denied');
  ok(/totalHours/.test((await sc.fileContents(['api.js', '../package.json']))['api.js']) && !('../package.json' in await sc.fileContents(['../package.json'])), 'fileContents reads inside the sandbox only');

  // the preview, served the way server/index.mjs does
  server = http.createServer((req, res) => { const p = new URL(req.url, 'http://x').pathname; if (p.startsWith('/preview/showcase')) return sc.preview(req, res, decodeURIComponent(p.slice('/preview/showcase'.length)) || '/'); res.writeHead(404); res.end(); });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}/preview/showcase`;
  const page = await fetch(`${base}/`); const html = await page.text();
  ok(page.status === 200 && /Rosterette/.test(html) && /no-store/.test(page.headers.get('cache-control')), 'the preview serves the app, never cached');
  ok(/totalHours/.test(await (await fetch(`${base}/api.js`)).text()), 'the preview serves the changed file');
  ok((await fetch(`${base}/.git/config`)).status === 404 && (await fetch(`${base}/..%2F..%2Fpackage.json`)).status === 404, 'nothing outside the working copy, and not .git');

  const ran = await createShowcase({ root, config: {}, queryFn: fakeQuery({ subtype: 'error_max_turns' }), dir: path.join(tmp, 'b') });
  const short = await ran.cook({ order, item, chef });
  ok(short.ranOut === true && short.changedFiles.includes('api.js'), 'a cook that runs out of turns still gives a Meal, marked ranOut');
  await ran.close();

  await sc.reset();
  ok(!/totalHours/.test((await sc.fileContents(['api.js']))['api.js']), 'reset() restores the template');

  console.log('the whole server with SHOWCASE=1');
  calls.length = 0;
  const { startServer } = await import('../server/index.mjs');
  const showcase = await createShowcase({ root, config: { models: { judge: 'claude-sonnet-5-5' } }, queryFn: fakeQuery(), dir: path.join(tmp, 'c') });
  const clean = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('ANTHROPIC_')));
  srv = await startServer({ env: { ...clean, SHOWCASE: '1', PORT: '0', SHIP_HOST: '127.0.0.1', SHIP_NO_QR: '1', SHIP_PACE: '20' }, showcase, quiet: true });
  const c = await wsClient(`http://127.0.0.1:${srv.port}`);
  c.send('hello', { v: 1 }); const hello = await c.next('welcome');
  ok(hello.showcase === true, 'welcome says showcase');
  c.send('chooseRole', { role: 'player' }); await c.next('welcome');
  c.send('createFloor', { name: 'The Stage Kitchen', mode: 'live' }); const w = await c.next('welcome', m => !!m.floorId);
  c.send('subscribe', { floorId: w.floorId }); const first = await c.next('floor');
  ok(first.floor.kind === 'showcase' && first.floor.mode === 'live', `the one floor is the showcase, Live (${first.floor.kind}, ${first.floor.mode}, ${first.floor.demoReason})`);
  ok((await c.act('seat', { customerId: 'c1' })).ok, 'seat Priya');
  const pick = first.floor.line[0].order.quickPicks[0];
  ok((await c.act('saveItems', { customerId: 'c1', items: [{ prompt: pick.prompt, station: pick.station, quickPickId: pick.id, typed: false }] })).ok, 'save one Item');
  ok((await c.act('sendItems', { customerId: 'c1' })).ok, 'send it');
  const isReal = m => m.type === 'floor' && Object.values(m.floor.meals).some(x => x.real);
  const ready = c.msgs.find(isReal) || await c.next('floor', isReal, 20000).catch(e => {
    const last = c.msgs.filter(m => m.type === 'floor').at(-1);
    console.error('calls', calls.length, 'items', JSON.stringify(Object.values(last?.floor.items || {}).map(i => [i.status, i.chefId])), 'meals', JSON.stringify(Object.values(last?.floor.meals || {}).map(m => [m.real, m.changedFiles, m.setMenu])), 'chefs', JSON.stringify(last?.floor.chefs));
    throw e;
  });
  const realMeal = Object.values(ready.floor.meals).find(x => x.real);
  ok(calls.length === 1 && realMeal.changedFiles.includes('api.js') && realMeal.hunks.some(h => h.file === 'api.js'), 'the Item cooked through showcase.cook into a real Meal');
  ok(ready.floor.tv.version === showcase.version(), 'the TV version follows the preview');
  ok(/totalHours/.test(await (await fetch(`http://127.0.0.1:${srv.port}/preview/showcase/api.js`)).text()), 'the server serves the live preview');
  c.ws.close();
  console.log(`\nshowcase: ${passedCount()} checks passed`);
} catch (e) {
  console.error(e.stack || e.message); process.exitCode = 1;
} finally {
  await sc?.close(); server?.close(); await srv?.close?.();
  await fs.rm(tmp, { recursive: true, force: true }).catch(() => {});
}
