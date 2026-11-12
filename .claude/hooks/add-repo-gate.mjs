// PreToolUse hook for mcp__claude-code-remote__add_repo.
// Attaching The Index (robh1985/The-Index) runs without a prompt, because every session reads it
// first. Attaching any other repository always asks the user, whatever the permission mode.
const ALLOWED = [{ owner: 'robh1985', repo: 'the-index' }];

let raw = '';
for await (const chunk of process.stdin) raw += chunk;

let owner = '';
let repo = '';
try {
  const input = JSON.parse(raw).tool_input ?? {};
  owner = String(input.owner ?? '').trim().toLowerCase();
  repo = String(input.repo ?? '').trim().toLowerCase();
} catch {
  // Unreadable input: fall through to asking.
}

const allowed = ALLOWED.some((a) => a.owner === owner && a.repo === repo);
process.stdout.write(
  JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: allowed ? 'allow' : 'ask',
      permissionDecisionReason: allowed
        ? 'The Index is attached automatically (.claude/hooks/add-repo-gate.mjs).'
        : `Attaching ${owner || '?'}/${repo || '?'} needs your approval: only The Index is attached automatically.`,
    },
  }),
);
