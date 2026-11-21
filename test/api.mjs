// API chef check. The real @anthropic-ai/sdk talks to a local mock of the Messages API that answers with scripted tool calls,
// so this spends nothing and needs no key. It covers the driver on its own and a public server with SHIP_PUBLIC_API=1.
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { apiKitchens, confine, costOf, API_MODEL } from '../server/api-driver.mjs';
import { ensureDemoRepo } from '../server/demo-repo.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'ship-api-'));
const sleep = ms => new Promise(r => setTimeout(r, ms));
let passed = 0;
const ok = (cond, msg) => { if (!cond) throw new Error('FAILED: ' + msg); passed++; console.log('  ok', msg); };
const KEY = 'sk-ant-test-key-never-real';
process.env.SHIP_SIM_SPEED = '40'; process.env.SHIP_SIM_ASK = '0';

/* ---------- a mock Messages API: each request takes the next scripted reply ---------- */
const requests = [];
let script = [];
let n = 0;
const reply = (content, stop_reason, usage = {}) => ({ id: `msg_${++n}`, type: 'message', role: 'assistant', model: API_MODEL, content, stop_reason, stop_sequence: null, usage: { input_tokens: 1000, output_tokens: 200, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, ...usage } });
const use = (name, input) => ({ type: 'tool_use', id: `toolu_${++n}`, name, input });
const say = text => ({ type: 'text', text });
const mock = http.createServer(async (req, res) => {
  let body = '';
  for await (const chunk of req) body += chunk;
  const json = body ? JSON.parse(body) : {};
  requests.push({ url: req.url, key: req.headers['x-api-key'] || String(req.headers.authorization || '').replace(/^Bearer /, ''), body: json });
  const next = script.shift();
  if (!next) { res.writeHead(500, { 'content-type': 'application/json' }); return res.end(JSON.stringify({ type: 'error', error: { type: 'api_error', message: 'the script ran out' } })); }
  const out = typeof next === 'function' ? next(json) : next;
  if (out.status) { res.writeHead(out.status, { 'content-type': 'application/json' }); return res.end(JSON.stringify({ type: 'error', error: { type: 'api_error', message: 'scripted failure' } })); }
  res.writeHead(200, { 'content-type': 'application/json' });
  res.end(JSON.stringify(out));
});
await new Promise(resolve => mock.listen(0, '127.0.0.1', resolve));
const baseURL = `http://127.0.0.1:${mock.address().port}`;
const servers = [];
let log = '';

/** One run of the driver in a fresh copy of the example project. */
async function cook(driver, { prompt = 'Order #1 (S): Add a greeting', resume, title = 'Add a greeting', answer } = {}, dir) {
  const cwd = dir || path.join(tmp, `wt-${Math.random().toString(36).slice(2, 8)}`);
  if (!dir) await ensureDemoRepo(cwd);
  const events = [], asked = [];
  const res = await driver.run({ cwd, prompt, resume, onEvent: e => events.push(e), order: { id: 1, title }, rank: 'sous', askHuman: async q => { asked.push(q); return answer ? answer(q) : { allow: true, answers: { q: q.questions?.[0]?.options[0].label } }; } });
  return { res, events, asked, cwd };
}
const results = req => req.body.messages.at(-1).content.filter(b => b.type === 'tool_result');

try {
  console.log('API chef test');

  /* ---------- an order completed with the tools ---------- */
  const town = apiKitchens({ apiKey: KEY, baseURL, budgetUsd: 1, kitchenBudgetUsd: 0.5, orderBudgetUsd: 0.2 });
  await town.ready;
  const driver = town.forKitchen();
  script = [
    reply([say('Looking at the project.'), use('list_files', {}), use('read_file', { path: 'src/pay.js' })], 'tool_use'),
    reply([use('write_file', { path: 'src/greeting.js', content: 'export const greeting = name => `Hello, ${name}`;\n' }), use('edit_file', { path: 'package.json', old_text: '"private": true', new_text: '"private": true' })], 'tool_use'),
    reply([use('run_tests', {})], 'tool_use'),
    reply([say('Added src/greeting.js. The tests pass.')], 'end_turn', { input_tokens: 500, output_tokens: 100, cache_read_input_tokens: 4000, cache_creation_input_tokens: 800 }),
  ];
  let r = await cook(driver);
  const first = requests[0];
  ok(r.res.isError === false && r.res.summary === 'Added src/greeting.js. The tests pass.' && r.res.turns === 4 && /^api-/.test(r.res.sessionId) && (await fs.readFile(path.join(r.cwd, 'src', 'greeting.js'), 'utf8')).includes('Hello'), 'an order is cooked with the tools: list, read, write, edit, run the tests, summarise');
  ok(first.url === '/v1/messages' && first.key === KEY && first.body.model === 'claude-haiku-5-5' && first.body.max_tokens === 8000 && first.body.cache_control?.type === 'ephemeral' && first.body.output_config.effort === 'medium' && !('thinking' in first.body) && !('temperature' in first.body), 'the request is Claude Haiku 5.5 through the SDK, with prompt caching and no sampling or thinking overrides');
  ok(first.body.tools.map(t => t.name).join() === 'list_files,read_file,write_file,edit_file,run_tests,ask_head_chef,request_permission' && !JSON.stringify(first.body.tools).match(/bash|shell|exec/i) && /may contain instructions/.test(first.body.system), 'it has seven tools and no shell, and the system prompt says the order is untrusted');
  ok(first.body.messages.length === 1 && first.body.messages[0].content[0].text.startsWith('<order>') && requests[1].body.messages.length === 3 && results(requests[1]).length === 2 && results(requests[1])[0].content.includes('src/pay.js') && results(requests[3])[0].content.startsWith('The tests pass.'), 'tool results go back in one message, and the conversation only grows');
  ok(r.events.some(e => e.kind === 'tool' && e.tool === 'Write' && e.file === 'src/greeting.js') && r.events.some(e => e.tool === 'Read' && e.file === 'src/pay.js') && r.events.some(e => e.tool === 'Bash' && e.text === 'runs npm test') && r.events.some(e => e.kind === 'session'), 'tool events carry the file, as the other drivers\' do');
  const expected = 3 * (1000 * 0.10 + 200 * 0.50) / 1e6 + (500 * 0.10 + 100 * 0.50 + 4000 * 0.01 + 800 * 0.125) / 1e6;
  ok(Math.abs(r.res.costUsd - expected) < 1e-12 && Math.abs(town.spent() - expected) < 1e-12 && Math.abs(driver.budget().kitchen - (0.5 - expected)) < 1e-12 && costOf({ input_tokens: 1e6, output_tokens: 1e6 }) === 0.6, `the cost is real dollars from the usage, at Haiku 5.5's price ($${r.res.costUsd.toFixed(6)})`);

  /* ---------- send-back resumes the conversation ---------- */
  const before = requests.length;
  script = [reply([say('Renamed it as asked.')], 'end_turn')];
  const again = await cook(driver, { prompt: 'The head chef sent your plate back from the pass. Feedback:\nRename it.', resume: r.res.sessionId }, r.cwd);
  ok(again.res.sessionId === r.res.sessionId && requests[before].body.messages.length === 9 && requests[before].body.messages.at(-1).content.at(-1).text.includes('Rename it.') && JSON.stringify(requests[before].body.messages.slice(0, 7)) === JSON.stringify(requests[before - 1].body.messages), 'a send-back continues the same conversation, with the history unchanged and the feedback added');
  script = [reply([say('Started over from the files.')], 'end_turn')];
  const lost = await cook(driver, { prompt: 'Feedback:\nAgain.', resume: 'api-gone' }, r.cwd);
  ok(lost.res.isError === false && requests.at(-1).body.messages.length === 1 && /earlier conversation about this order was lost/.test(requests.at(-1).body.messages[0].content[0].text), 'a lost conversation starts fresh from the order and the feedback');

  /* ---------- a question bubble, and a permission that grants nothing ---------- */
  script = [
    reply([use('ask_head_chef', { question: 'Round per shift or per week?', options: [{ label: 'Per shift', description: 'Each shift to cents' }, { label: 'Per week' }] })], 'tool_use'),
    reply([use('request_permission', { kind: 'install', reason: 'a CSV library' }), use('request_permission', { kind: 'network', reason: 'holiday dates' })], 'tool_use'),
    reply([say('Done by hand.')], 'end_turn'),
  ];
  const q = await cook(driver, { answer: p => (p.kind === 'question' ? { allow: true, answers: { [p.questions[0].question]: 'Per week' } } : { allow: p.input.command.startsWith('npm'), message: 'no network here' }) });
  ok(q.asked[0].kind === 'question' && q.asked[0].questions[0].question === 'Round per shift or per week?' && q.asked[0].questions[0].options.length === 2 && results(requests.at(-2))[0].content === 'The head chef answered: Per week', 'ask_head_chef is a question bubble, and the answer goes back to the chef');
  const { grantClassFor } = await import('../server/agents.mjs');
  ok(q.asked[1].kind === 'permission' && grantClassFor(q.asked[1].toolName, q.asked[1].input) === 'install' && grantClassFor(q.asked[2].toolName, q.asked[2].input) === 'network' && /^Approved, but this kitchen has no network/.test(results(requests.at(-1))[0].content) && /^Not approved: no network here/.test(results(requests.at(-1))[1].content), 'request_permission is a permission bubble with a grant class, and an approval installs and fetches nothing');

  /* ---------- the tools are the boundary ---------- */
  const outside = path.join(tmp, 'escape.txt');
  await fs.writeFile(path.join(tmp, 'secret.txt'), 'top secret');
  script = [
    reply([
      use('write_file', { path: '../escape.txt', content: 'out' }), use('write_file', { path: outside, content: 'out' }), use('read_file', { path: '../secret.txt' }),
      use('read_file', { path: 'src/../../secret.txt' }), use('write_file', { path: '.git/hooks/pre-commit', content: 'x' }), use('edit_file', { path: 'C:\\Windows\\win.ini', old_text: 'a', new_text: 'b' }),
      use('read_file', { path: '/etc/passwd' }), use('write_file', { path: 'node_modules/x/index.js', content: 'x' }), use('bash', { command: 'echo hi' }),
    ], 'tool_use'),
    reply([say('Could not.')], 'end_turn'),
  ];
  const t = await cook(driver);
  const refused = results(requests.at(-1));
  ok(refused.length === 9 && refused.every(x => x.is_error === true) && !(await fs.stat(outside).catch(() => null)) && !(await fs.stat(path.join(t.cwd, '.git', 'hooks', 'pre-commit')).catch(() => null)) && !JSON.stringify(refused).includes('top secret'), 'path traversal, absolute paths, .git, node_modules and a made-up shell tool are all refused, and nothing is read or written outside the worktree');
  ok(await confine(t.cwd, 'src/pay.js').then(x => x.rel === 'src/pay.js') && await confine(t.cwd, '..\\x').then(() => false, () => true) && await confine(t.cwd, '').then(() => false, () => true), 'a plain relative path is accepted and nothing else');

  /* ---------- stop reasons, API errors, and the caps: each hands the run to the simulated chef ---------- */
  script = [reply([], 'refusal')];
  let f = await cook(driver);
  ok(f.res.isError === false && /Simulated chef/.test(f.res.summary) && f.events.some(e => /declined this order, so a simulated chef takes this one/.test(e.text)), 'a refusal falls back to the simulated chef, with a line saying so');
  script = [reply([say('half a')], 'max_tokens'), reply([say('Finished in smaller steps.')], 'end_turn')];
  f = await cook(driver);
  ok(f.res.summary === 'Finished in smaller steps.' && /cut off/.test(requests.at(-1).body.messages.at(-1).content[0].text) && requests.at(-1).body.messages.length === 2, 'a reply cut off at max_tokens is not kept; the chef is asked to continue in smaller steps');
  script = [{ status: 500 }, { status: 500 }];
  f = await cook(driver);
  ok(f.res.isError === false && /Simulated chef/.test(f.res.summary) && f.events.some(e => /The API answered 500, so a simulated chef/.test(e.text)), 'an API error falls back to the simulated chef');
  const many = Array.from({ length: 31 }, () => reply([use('list_files', {})], 'tool_use', { input_tokens: 10, output_tokens: 1 }));
  script = [...many];
  f = await cook(driver);
  ok(f.res.turns === undefined || f.events.some(e => /took 30 turns without finishing/.test(e.text)), 'a chef that never finishes is stopped after 30 turns');
  script = [];

  const tight = apiKitchens({ apiKey: KEY, baseURL, budgetUsd: 1, kitchenBudgetUsd: 0.5, orderBudgetUsd: 0.001 });
  await tight.ready;
  const tightDriver = tight.forKitchen();
  script = [reply([use('list_files', {})], 'tool_use', { input_tokens: 20_000, output_tokens: 1000 }), reply([say('never sent')], 'end_turn')];
  const sent = requests.length;
  f = await cook(tightDriver);
  ok(requests.length === sent + 1 && /Simulated chef/.test(f.res.summary) && f.events.some(e => /This order has used its API budget, so a simulated chef/.test(e.text)) && Math.abs(f.res.costUsd - 0.0025) < 1e-12, 'the order cap: once an order has spent its budget the simulated chef finishes it, and the spend so far is still reported');
  script = [];
  const kitchenCap = apiKitchens({ apiKey: KEY, baseURL, budgetUsd: 1, kitchenBudgetUsd: 0, orderBudgetUsd: 1 });
  await kitchenCap.ready;
  f = await cook(kitchenCap.forKitchen());
  ok(/Simulated chef/.test(f.res.summary) && f.events.some(e => /This kitchen's API budget is used up/.test(e.text)), 'the kitchen cap falls back to the simulated chef');
  const townCap = apiKitchens({ apiKey: KEY, baseURL, budgetUsd: 0 });
  await townCap.ready;
  f = await cook(townCap.forKitchen());
  ok(/Simulated chef/.test(f.res.summary) && f.events.some(e => /The town's API budget is used up/.test(e.text)) && f.res.costUsd === 0, 'the global cap falls back to the simulated chef');
  const before2 = requests.length;
  const noKey = apiKitchens({ apiKey: '', baseURL });
  await noKey.ready;
  f = await cook(noKey.forKitchen());
  ok(!noKey.enabled() && requests.length === before2 && /Simulated chef/.test(f.res.summary) && f.events.some(e => /No API key is set, so a simulated chef/.test(e.text)), 'no key means the simulated chef, and no request is made');

  /* ---------- a public server: selection, snapshot, and what never leaves ---------- */
  const start = (port, env) => {
    const child = spawn(process.execPath, ['server/index.mjs', '--public'], {
      cwd: root, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true,
      env: { ...process.env, SHIP_SIM: '', SHIP_DEMO: '', SHIP_SIM_ASK: '0', SHIP_SIM_SPEED: '10', SHIP_PACE: '80', SHIP_HOST: '127.0.0.1', SHIP_WORLD: '0', SHIP_REAL_CHEFS: 'query', PORT: String(port), ANTHROPIC_BASE_URL: baseURL, ...env },
    });
    child.stdout.on('data', d => { log += d; }); child.stderr.on('data', d => { log += d; });
    servers.push(child);
  };
  const visit = async port => {
    const base = `http://127.0.0.1:${port}`;
    for (let i = 0; i < 80; i++) { try { await fetch(`${base}/healthz`); break; } catch { await sleep(150); } }
    const page = await fetch(base + '/');
    const cookie = page.headers.getSetCookie()[0].split(';')[0];
    const get = async p => (await fetch(base + p, { headers: { cookie } })).json();
    const post = async (p, b = {}) => (await fetch(base + p, { method: 'POST', headers: { cookie, 'content-type': 'application/json' }, body: JSON.stringify(b) })).json();
    const until = async (done, what) => { for (let i = 0; i < 300; i++) { const st = await get('/api/state'); const hit = done(st); if (hit) return hit; await sleep(100); } throw new Error(`Timed out waiting for ${what}`); };
    return { base, get, post, until, health: async () => (await fetch(`${base}/healthz`)).json() };
  };
  const P1 = 4671, P2 = 4672, P3 = 4673;
  start(P1, { SHIP_PUBLIC_API: '1', ANTHROPIC_API_KEY: KEY, SHIP_SESSIONS_DIR: path.join(tmp, 's1'), SHIP_BUDGET_USD: '5', SHIP_KITCHEN_BUDGET_USD: '0.5' });
  start(P2, { SHIP_PUBLIC_API: '', ANTHROPIC_API_KEY: KEY, SHIP_SESSIONS_DIR: path.join(tmp, 's2') });
  start(P3, { SHIP_PUBLIC_API: '1', ANTHROPIC_API_KEY: '', SHIP_SESSIONS_DIR: path.join(tmp, 's3') });
  const v = await visit(P1);
  let st = await v.until(x => x.orders.length >= 1 && x, 'the first order');
  ok(st.driver === 'api' && st.chefs.every(c => c.driver === 'api') && st.budget.kitchen === 0.5 && st.budget.town === 5 && st.budget.order === 0.4 && (await v.health()).api === true, 'with SHIP_PUBLIC_API=1 and a key, a public kitchen\'s chefs are API chefs and the snapshot shows the budget left');
  script = [
    reply([use('write_file', { path: 'src/env-probe.test.js', content: '// harmless\n' }), use('run_tests', {})], 'tool_use'),
    reply([say('Fixed the close shift hours.')], 'end_turn'),
  ];
  const at = requests.length;
  await v.post('/api/orders/1/assign', { chefId: 'pixel' });
  st = await v.until(x => x.orders[0].state === 'at_pass' && x, 'the API chef\'s plate at the pass');
  ok(st.orders[0].summary === 'Fixed the close shift hours.' && st.orders[0].files.includes('src/env-probe.test.js') && st.stats.apiUsd > 0 && st.stats.apiUsd === st.stats.costUsd && st.stats.spendByRank.sous === st.stats.apiUsd && st.budget.kitchen < 0.5 && requests.length === at + 2, 'a public kitchen cooks an order through the API: real diff, real spend on the meter and off the budget, and no wage on top');
  ok(/~\/kitchen|^Order #1/m.test(requests[at].body.messages[0].content[0].text) && !requests[at].body.messages[0].content[0].text.toLowerCase().includes(path.basename(tmp).toLowerCase()), 'the order reaches the model without the server\'s directories');
  // What a test run started by this server can see: the key is not in its environment.
  script = [reply([use('write_file', { path: 'test/env.test.js', content: "import test from 'node:test';\nimport assert from 'node:assert/strict';\ntest('no key in the environment', () => { assert.equal(Object.keys(process.env).filter(k => /^(ANTHROPIC_|CLAUDE_)/i.test(k)).join(), ''); assert.equal(process.env.SHIP_RESET_TOKEN, undefined); });\n" }), use('run_tests', {})], 'tool_use'), reply([say('Checked.')], 'end_turn')];
  await v.post('/api/orders', { title: 'Check the environment', size: 'S' });
  st = await v.get('/api/state');
  const probe = st.orders.find(o => o.title === 'Check the environment');
  await v.post(`/api/orders/${probe.id}/assign`, { chefId: 'router' });
  st = await v.until(x => x.orders.find(o => o.id === probe.id && o.state === 'at_pass') && x, 'the probe at the pass');
  ok(st.orders.find(o => o.id === probe.id).tests.ok === true, 'code a chef writes runs without the API key or the reset token in its environment');
  const everything = JSON.stringify(st) + JSON.stringify(await v.health());
  ok(!everything.includes(KEY) && !log.includes(KEY) && /claude-haiku-5-5 through the Messages API/.test(log) && !/Claude Agent SDK:/.test(log), 'the key is in no snapshot and no log line, and no Agent SDK chef exists');

  const w = await visit(P2), x = await visit(P3);
  const sw = await w.until(y => y.orders.length >= 1 && y, 'the first order without the switch'), sx = await x.until(y => y.orders.length >= 1 && y, 'the first order without a key');
  ok(sw.driver === 'sim' && !('budget' in sw) && !('api' in await w.health()), 'a key without SHIP_PUBLIC_API=1 stays simulated');
  ok(sx.driver === 'sim' && !('budget' in sx) && !('api' in await x.health()), 'SHIP_PUBLIC_API=1 without a key stays simulated');

  console.log(`\nAPI chef test passed (${passed} checks).`);
} catch (e) {
  console.error('\n' + (e.stack || e.message));
  if (log) console.error('--- server log ---\n' + log.replaceAll(KEY, '[key]'));
  process.exitCode = 1;
} finally {
  for (const s of servers) s.kill();
  mock.close(); mock.closeAllConnections?.();
  await sleep(600);
  await fs.rm(tmp, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }).catch(() => {});
}
