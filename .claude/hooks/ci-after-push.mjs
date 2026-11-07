#!/usr/bin/env node
// PostToolUse hook: after a `git push` to main or beta, remind the thread to check that push's CI run.
// Pushes to other branches (ai-batch-results, feature branches) are ignored: their build failures are noise.
// Fails open: any parse error prints nothing.
import { execFileSync } from 'node:child_process';

let raw = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (c) => (raw += c));
process.stdin.on('end', () => {
  try {
    run(JSON.parse(raw));
  } catch {
    process.exit(0);
  }
});

function currentBranch(cwd) {
  try {
    return execFileSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return null;
  }
}

function run(payload) {
  const cmd = String(payload?.tool_input?.command ?? '');
  const m = cmd.match(/\bgit\s+(?:-\S+\s+)*push\b([^;&|\n]*)/);
  if (!m) return;
  const args = m[1].trim().split(/\s+/).filter((a) => a && !a.startsWith('-'));
  // args: [remote, refspec...]. A refspec may be `main`, `HEAD:beta`, `a:b`.
  const refs = args.slice(1).map((r) => r.replace(/^\+/, '').split(':').pop());
  const targets = refs.length ? refs : [currentBranch(payload.cwd)];
  const hit = targets.filter((b) => b === 'main' || b === 'beta');
  if (!hit.length) return;
  const out = {
    hookSpecificOutput: {
      hookEventName: 'PostToolUse',
      additionalContext:
        `You pushed to ${hit.join(' and ')}. CI (typecheck, lint, test) runs on every push there. Before you finish, ` +
        'find that push\'s CI run (GitHub Actions, workflow "CI", head branch + sha) and wait for it. If it fails, read the ' +
        'logs and fix it (non-AI fixes to main then merge main into beta; src/ai needs an ai-* branch). ' +
        'Ignore ai-batch-results build failures: that is known noise.',
    },
  };
  process.stdout.write(JSON.stringify(out));
}
