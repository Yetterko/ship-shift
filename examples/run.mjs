// npm run example: the kitchen on a copy of examples/roster-cafe, with real Claude agents as chefs and the menu on the rail.
//   npm run example             real agents (they cost money; uses your Claude credentials)
//   npm run example -- --sim    simulated chefs, free, for a dry run
//   npm run example -- --fresh  throw the last copy away and start from the example again
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ensureDemoRepo, STARTER_ORDERS } from '../server/demo-repo.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dir = path.resolve(process.env.SHIP_EXAMPLE_DIR || path.join(root, '.kitchen', 'example'));
const MARK = '.ship-shift-example';
const repo = path.join(dir, 'repo');
const port = Number(process.env.PORT || 4610);
const sim = process.argv.includes('--sim');

if (process.argv.includes('--fresh') && await fs.stat(dir).then(() => true, () => false)) {
  // Only ever deletes a directory this script made and marked.
  if (!await fs.stat(path.join(dir, MARK)).then(() => true, () => false)) throw new Error(`${dir} was not made by npm run example, so it will not be cleared.`);
  await fs.rm(dir, { recursive: true, force: true, maxRetries: 8, retryDelay: 150 });
}
await fs.mkdir(dir, { recursive: true });
await fs.writeFile(path.join(dir, MARK), 'Ship Shift example kitchen. `npm run example -- --fresh` deletes and rebuilds this directory.\n');
if (await ensureDemoRepo(repo)) console.log(`Copied examples/roster-cafe to ${repo}`);

const server = spawn(process.execPath, [path.join(root, 'server', 'index.mjs')], {
  cwd: root, stdio: 'inherit',
  env: { ...process.env, SHIP_DEMO: '', SHIP_SIM: sim ? '1' : '', SHIP_REPO: repo, SHIP_DATA: path.join(dir, 'data'), PORT: String(port) },
});
server.on('exit', code => process.exit(code ?? 0));
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => server.kill());

// Put the menu on the rail the first time. A kitchen that already has orders keeps them.
const base = `http://127.0.0.1:${port}`;
for (let i = 0; i < 100; i++) {
  const state = await fetch(`${base}/api/state`).then(r => r.json(), () => null);
  if (!state) { await new Promise(r => setTimeout(r, 200)); continue; }
  if (state.orders.length === 0) {
    for (const order of STARTER_ORDERS) {
      await fetch(`${base}/api/orders`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(order) });
    }
    console.log(`  menu:   ${STARTER_ORDERS.length} orders on the rail`);
  }
  console.log(`  app:    cd ${path.relative(root, repo)} && npm start   (the roster, at http://127.0.0.1:4620; it reloads when you ship)`);
  break;
}
