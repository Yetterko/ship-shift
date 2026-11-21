// Syntax check for every script the app ships or tests with. Finds the files itself, so splitting a file never breaks it.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const scripts = dir => (fs.existsSync(path.join(root, dir)) ? fs.readdirSync(path.join(root, dir), { recursive: true }) : [])
  .map(f => path.join(dir, String(f)))
  .filter(f => /\.(mjs|js)$/.test(f) && !f.split(path.sep).some(p => p === 'vendor' || p === 'node_modules'));

const files = ['server', 'shared', 'content', 'test', 'public', 'tools', 'template-project'].flatMap(scripts).sort();
let failed = 0;
for (const f of files) {
  const r = spawnSync(process.execPath, ['--check', f], { cwd: root, encoding: 'utf8' });
  if (r.status !== 0) { failed++; console.error(`FAILED ${f}\n${r.stderr}`); }
}
console.log(failed ? `${failed} of ${files.length} files failed the syntax check` : `${files.length} files pass the syntax check`);
process.exitCode = failed ? 1 : 0;
