// The PreToolUse hook (spec 7.4): any tool that names a path outside the sandbox is denied before it runs.
// Hooks run before every other permission step, so this holds even if a tool slips past the allow and deny lists.
import { inside } from './sandbox.mjs';

const PATH_KEYS = ['file_path', 'path', 'notebook_path'];
const SAFE_TOOLS = new Set(['Read', 'Glob', 'Grep', 'Edit', 'Write']);

/** @param {string} root the sandbox directory. Returns an Agent SDK HookCallback. */
export function denyPathsOutsideSandbox(root) {
  return async input => {
    const deny = reason => ({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: reason } });
    if (input?.hook_event_name && input.hook_event_name !== 'PreToolUse') return {};
    const tool = input?.tool_name, args = input?.tool_input || {};
    if (!SAFE_TOOLS.has(tool)) return deny(`${tool} is not allowed in the Rosterette sandbox.`);
    for (const k of PATH_KEYS) if (k in args && !inside(root, String(args[k]))) return deny(`${args[k]} is outside the Rosterette sandbox.`);
    // a Glob or Grep pattern may carry a path of its own
    if (typeof args.pattern === 'string' && (/^([a-zA-Z]:)?[\\/]/.test(args.pattern) || args.pattern.split(/[\\/]/).includes('..'))) return deny('Search inside the Rosterette sandbox only.');
    return {};
  };
}
