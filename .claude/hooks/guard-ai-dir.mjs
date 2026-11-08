#!/usr/bin/env node
// PreToolUse guard: changes under src/ai/** are only allowed on `ai-*` branches.
// Reads the hook payload (JSON) on stdin. Exit 2 = block (message on stderr).
// Fails open: any parse error, missing git, or unknown branch lets the call through.
import { execFileSync } from 'node:child_process';
import path from 'node:path';

const MESSAGE =
  'Blocked: src/ai/** may only be changed on an ai-* branch. AI changes go through the ' +
  'AI Coordinator thread (Fable reviews them), so ask the project coordinator for an ai-* branch thread.';

let raw = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (c) => (raw += c));
process.stdin.on('end', () => {
  try {
    run(JSON.parse(raw));
  } catch {
    process.exit(0); // fail open
  }
});

function branchOf(cwd) {
  try {
    return execFileSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return null; // git unavailable or not a repo
  }
}

// Does a file path point into <repo>/src/ai/ ?
function inAiDir(file, cwd) {
  const abs = path.resolve(cwd, file).split(path.sep).join('/');
  return /(^|\/)src\/ai(\/|$)/.test(abs);
}

// Obvious shell writes aimed at src/ai (redirects, tee, sed/perl -i, mv/cp/rm/touch/install/truncate).
function bashWritesAi(cmd) {
  const target = String.raw`[^\s;|&]*src/ai(?:/|\b)`;
  const patterns = [
    new RegExp(String.raw`>>?\s*['"]?${target}`),
    new RegExp(String.raw`\btee\b[^;|&]*${target}`),
    new RegExp(String.raw`\b(?:sed|perl)\b[^;|&]*\s-[a-zA-Z]*i[^;|&]*${target}`),
    new RegExp(String.raw`\b(?:mv|cp|rm|touch|install|truncate|ln)\b[^;|&]*${target}`),
  ];
  return patterns.some((p) => p.test(cmd));
}

function run(payload) {
  const cwd = payload.cwd || process.cwd();
  const input = payload.tool_input || {};
  let hit = false;

  if (payload.tool_name === 'Bash') {
    hit = typeof input.command === 'string' && bashWritesAi(input.command);
  } else {
    const file = input.file_path || input.notebook_path;
    hit = typeof file === 'string' && inAiDir(file, cwd);
  }
  if (!hit) process.exit(0);

  const branch = branchOf(cwd);
  if (branch === null || branch.startsWith('ai-')) process.exit(0);
  process.stderr.write(`${MESSAGE} (current branch: ${branch})\n`);
  process.exit(2);
}
