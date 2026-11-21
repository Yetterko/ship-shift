import { execFile, exec } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs/promises';
import path from 'node:path';

const pexecFile = promisify(execFile);
const pexec = promisify(exec);

export async function git(cwd, args, { allowFail = false } = {}) {
  try {
    const { stdout } = await pexecFile('git', args, { cwd, maxBuffer: 32 * 1024 * 1024, windowsHide: true });
    return stdout.trimEnd();
  } catch (e) {
    if (allowFail) return null;
    const msg = (e.stderr || e.message || '').toString().trim();
    throw new Error(`git ${args.join(' ')} failed: ${msg}`);
  }
}

export async function isRepo(dir) {
  return (await git(dir, ['rev-parse', '--is-inside-work-tree'], { allowFail: true })) === 'true';
}

export async function currentBranch(repo) {
  return git(repo, ['rev-parse', '--abbrev-ref', 'HEAD']);
}

export async function head(repo, ref = 'HEAD') {
  return git(repo, ['rev-parse', ref]);
}

/** Creates a branch from the main branch's tip and checks it out in its own worktree. */
export async function addWorktree(repo, dir, branch, base) {
  await fs.mkdir(path.dirname(dir), { recursive: true });
  await git(repo, ['worktree', 'add', '-b', branch, dir, base]);
}

export async function removeWorktree(repo, dir, branch) {
  await git(repo, ['worktree', 'remove', '--force', dir], { allowFail: true });
  await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
  await git(repo, ['worktree', 'prune'], { allowFail: true });
  if (branch) await git(repo, ['branch', '-D', branch], { allowFail: true });
}

/** Commits everything the agent left in its worktree. Returns true when there was something to commit. */
export async function commitAll(dir, message) {
  await git(dir, ['add', '-A']);
  const status = await git(dir, ['status', '--porcelain']);
  if (!status) return false;
  await git(dir, ['-c', 'user.name=Ship Shift chef', '-c', 'user.email=chef@ship-shift.local', 'commit', '-q', '-m', message]);
  return true;
}

export async function diffAgainst(repo, mainBranch, branch) {
  const base = await git(repo, ['merge-base', mainBranch, branch]);
  const [patch, stat] = await Promise.all([
    git(repo, ['diff', '--no-color', base, branch]),
    git(repo, ['diff', '--shortstat', base, branch]),
  ]);
  return { patch, stat: parseShortstat(stat) };
}

function parseShortstat(s) {
  const n = re => Number((s.match(re) || [])[1] || 0);
  return { files: n(/(\d+) files? changed/), added: n(/(\d+) insertions?/), removed: n(/(\d+) deletions?/) };
}

/** How many commits landed on main since this branch was cut. The "spoil" meter. */
export async function behindBy(repo, mainBranch, branch) {
  const out = await git(repo, ['rev-list', '--count', `${branch}..${mainBranch}`], { allowFail: true });
  return Number(out || 0);
}

/** Merges the branch into main in the main checkout. Returns { ok, conflict }. */
export async function mergeIntoMain(repo, mainBranch, branch, message) {
  const cur = await currentBranch(repo);
  if (cur !== mainBranch) throw new Error(`The main checkout is on ${cur}, expected ${mainBranch}`);
  const dirty = await git(repo, ['status', '--porcelain', '--untracked-files=no']);
  if (dirty) throw new Error('The main checkout has uncommitted changes. Commit or stash them before shipping');
  try {
    await pexecFile('git', ['-c', 'user.name=Ship Shift', '-c', 'user.email=pass@ship-shift.local', 'merge', '--no-ff', '-m', message, branch], { cwd: repo, windowsHide: true });
    return { ok: true };
  } catch (e) {
    await git(repo, ['merge', '--abort'], { allowFail: true });
    return { ok: false, conflict: true, detail: (e.stdout || e.stderr || e.message || '').toString().slice(0, 2000) };
  }
}

/** Merges a branch into whatever is checked out in `dir` (a table's worktree). Returns { ok, conflict }. */
export async function mergeInto(dir, branch, message) {
  try {
    await pexecFile('git', ['-c', 'user.name=Ship Shift', '-c', 'user.email=pass@ship-shift.local', 'merge', '--no-ff', '-m', message, branch], { cwd: dir, windowsHide: true });
    return { ok: true };
  } catch (e) {
    await git(dir, ['merge', '--abort'], { allowFail: true });
    return { ok: false, conflict: true, detail: (e.stdout || e.stderr || e.message || '').toString().slice(0, 2000) };
  }
}

/** Every local branch whose name starts with one of the prefixes. */
export async function branchesLike(repo, prefixes) {
  const out = await git(repo, ['for-each-ref', '--format=%(refname:short)', ...prefixes.map(p => `refs/heads/${p}`)], { allowFail: true });
  return (out || '').split('\n').map(s => s.trim()).filter(Boolean);
}

/** Runs the project's test command. The oven. */
export async function runTests(dir, cmd) {
  const started = Date.now();
  try {
    const { stdout, stderr } = await pexec(cmd, { cwd: dir, timeout: 180_000, maxBuffer: 8 * 1024 * 1024, windowsHide: true });
    return { ok: true, ms: Date.now() - started, output: tail(stdout + stderr) };
  } catch (e) {
    return { ok: false, ms: Date.now() - started, output: tail((e.stdout || '') + (e.stderr || '') + (e.killed ? '\n[timed out]' : '')) };
  }
}

const tail = s => (s.length > 6000 ? '…' + s.slice(-6000) : s);

/** Runs git and returns stdout with the exit code, for commands where a non-zero exit is an answer and not a failure. */
async function gitCode(cwd, args) {
  try {
    const { stdout } = await pexecFile('git', args, { cwd, maxBuffer: 32 * 1024 * 1024, windowsHide: true });
    return { code: 0, out: stdout.trimEnd() };
  } catch (e) {
    return { code: typeof e.code === 'number' ? e.code : -1, out: (e.stdout || '').toString().trimEnd() };
  }
}

/**
 * Predicts whether `branch` merges into `into` without touching any checkout.
 * Returns { clean, conflicts } or null when git cannot say (old git, missing ref).
 */
export async function mergeCheck(repo, into, branch) {
  const { code, out } = await gitCode(repo, ['merge-tree', '--write-tree', '--name-only', '--no-messages', into, branch]);
  if (code === 0) return { clean: true, conflicts: [] };
  if (code !== 1) return null;
  const conflicts = [...new Set(out.split('\n').slice(1).map(s => s.trim()).filter(Boolean))].sort();
  return { clean: false, conflicts };
}

/** The files a branch changes compared with where it left main. */
export async function changedFiles(repo, mainBranch, branch) {
  const out = await git(repo, ['diff', '--name-only', `${mainBranch}...${branch}`], { allowFail: true });
  return (out || '').split('\n').map(s => s.trim()).filter(Boolean).sort();
}

/** The work in progress in a worktree against main: commits, uncommitted edits and new files. Leaves the index alone. */
export async function wipDiff(dir, mainBranch) {
  const base = await git(dir, ['merge-base', mainBranch, 'HEAD']);
  const parts = [await git(dir, ['diff', '--no-color', base])];
  const untracked = ((await git(dir, ['ls-files', '--others', '--exclude-standard'], { allowFail: true })) || '').split('\n').filter(Boolean);
  for (const f of untracked.slice(0, 40)) {
    const { code, out } = await gitCode(dir, ['diff', '--no-color', '--no-index', '--', '/dev/null', f]);
    if (code === 1 && out) parts.push(out);
  }
  const patch = parts.filter(Boolean).join('\n');
  const lines = patch.split('\n');
  return {
    patch,
    stat: {
      files: lines.filter(l => l.startsWith('diff --git ')).length,
      added: lines.filter(l => l.startsWith('+') && !l.startsWith('+++')).length,
      removed: lines.filter(l => l.startsWith('-') && !l.startsWith('---')).length,
    },
  };
}
