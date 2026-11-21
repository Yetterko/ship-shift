// The showcase sandbox: a git working copy of template-project/ (Rosterette) that the Agent SDK Chefs edit.
//   const sb = await createSandbox({ template, dir })
//   sb.dir, sb.snapshotCommit(message) -> sha, sb.diffSince(sha) -> { diff, changedFiles }, sb.read(paths), sb.reset()
import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';

/** git in the sandbox, never anywhere else; no user config, no hooks, no pager. */
export function git(cwd, args) {
  return new Promise((resolve, reject) => {
    execFile('git', ['-c', 'core.hooksPath=', '-c', 'core.autocrlf=false', '-c', 'user.name=Ship Shift', '-c', 'user.email=chef@ship-shift.local', ...args], { cwd, windowsHide: true, maxBuffer: 8 * 1024 * 1024, env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_CONFIG_NOSYSTEM: '1' } },
      (err, stdout, stderr) => (err ? reject(Object.assign(err, { stderr })) : resolve(stdout)));
  });
}

export async function createSandbox({ template, dir }) {
  const sb = {
    dir,
    async reset() {
      await fs.rm(dir, { recursive: true, force: true });
      await fs.mkdir(dir, { recursive: true });
      await fs.cp(template, dir, { recursive: true });
      await git(dir, ['init', '-q', '-b', 'main']);
      await git(dir, ['add', '-A']);
      await git(dir, ['commit', '-q', '-m', 'Rosterette: the starting state']);
    },
    /** Commits whatever is in the working copy (even nothing) and returns the commit. */
    async snapshotCommit(message = 'snapshot') {
      await git(dir, ['add', '-A']);
      await git(dir, ['commit', '-q', '--allow-empty', '-m', message]);
      return (await git(dir, ['rev-parse', 'HEAD'])).trim();
    },
    /** The working copy against a commit, new files included. */
    async diffSince(sha) {
      await git(dir, ['add', '-A']);
      const diff = await git(dir, ['diff', '--cached', '--no-color', '--no-ext-diff', '-U3', sha]);
      const changedFiles = (await git(dir, ['diff', '--cached', '--name-only', sha])).split('\n').map(s => s.trim()).filter(Boolean);
      return { diff, changedFiles };
    },
    /** File contents by sandbox-relative path; a path outside the sandbox or a missing file is left out. */
    async read(paths = []) {
      const out = {};
      for (const p of paths) {
        const file = inside(dir, p); if (!file) continue;
        try { out[p] = (await fs.readFile(file, 'utf8')).slice(0, 20_000); } catch { /* deleted or never there */ }
      }
      return out;
    },
  };
  await sb.reset();
  return sb;
}

/** The absolute path of p inside root, or null when p escapes it. */
export function inside(root, p) {
  if (typeof p !== 'string' || !p) return null;
  const abs = path.resolve(root, p);
  const rel = path.relative(path.resolve(root), abs);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel)) ? abs : null;
}
