// `npm run reset`: clears the whole town on the running public server, so the next demo starts from a clean slate.
// Every kitchen, repo, card and score goes, and every connected page reloads into a new kitchen.
// It reads where the server is, and the presenter's token, from the file the server wrote at start (.kitchen/town.json).
//   npm run reset                                   the town on this machine
//   npm run reset -- --url https://… --token …      a town hosted somewhere else
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const arg = name => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : undefined; };
const file = path.resolve(process.env.SHIP_TOWN_FILE || path.join(root, '.kitchen', 'town.json'));

let town = {};
try { town = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { /* no local town; the flags may say where one is */ }
const token = arg('token') || process.env.SHIP_RESET_TOKEN || town.token;
const port = arg('port') || town.port || process.env.PORT || 4610;
const url = (arg('url') || `http://${town.host || '127.0.0.1'}:${port}`).replace(/\/+$/, '');

if (!token) {
  console.error(`No town is running here: ${file} is missing. Start one with \`npm run share\`, or pass --url and --token.`);
  process.exit(1);
}
try {
  const res = await fetch(`${url}/api/world/reset`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ token }) });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) { console.error(`The town at ${url} refused the reset: ${body.error || res.status}`); process.exit(1); }
  console.log(`The town at ${url} was reset. ${body.closed} kitchen${body.closed === 1 ? '' : 's'} closed, and every open page reloads into a new one.`);
} catch (e) {
  console.error(`Could not reach the town at ${url}: ${e.cause?.message || e.message}`);
  process.exit(1);
}
