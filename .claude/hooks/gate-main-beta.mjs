#!/usr/bin/env node
// PreToolUse gate: no commit or push to main or beta until typecheck, lint and the fast unit tests pass.
//
// Bash: a `git commit` while on main/beta, or a `git push` whose target is main/beta, runs
//   .claude/hooks/fast-checks.mjs first. Exit 2 (block, reason on stderr) if a check fails.
//   - A passing run stamps the checked tree hash in .git/claude-gate-passed, so a later
//     `git push` of that same tree (e.g. the commit you just made) does not re-run anything.
//   - A push whose tree was never checked runs the checks on the working tree, but only when the
//     working tree IS the pushed commit (clean, HEAD = pushed ref). Otherwise it blocks and says why.
//   - Pushes to other branches (feature, ai-*, ai-batch-results) are never gated.
//   - Merges: `git merge main` on beta makes a commit without `git commit`; the push of beta checks it.
// GitHub MCP writes straight to main/beta (push_files, create_or_update_file, delete_file) skip
//   every check, so they are blocked: use git.
//
// No bypass flag on purpose. Fails open only when the payload can't be parsed or git is missing.
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const PROTECTED = new Set(['main', 'beta']);
// git subcommands that change HEAD or the branch before a later push in the same command
const MOVES = new Set(['checkout', 'switch', 'merge', 'rebase', 'reset', 'pull', 'cherry-pick', 'revert', 'am', 'stash']);

let raw = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (c) => (raw += c));
process.stdin.on('end', () => {
  let payload;
  try {
    payload = JSON.parse(raw);
  } catch {
    process.exit(0);
  }
  run(payload);
});

function git(cwd, args) {
  try {
    return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return null;
  }
}

function block(msg) {
  process.stderr.write(`Blocked by the main/beta gate (.claude/hooks/gate-main-beta.mjs): ${msg}\n`);
  process.exit(2);
}

/** Split a shell line into simple commands on ; && || | and newlines (good enough for git invocations). */
function segments(cmd) {
  return cmd.split(/&&|\|\||[;|\n]/).map((s) => s.trim()).filter(Boolean);
}

/** Parse `git [-C dir] [-c k=v] <sub> args...` from one segment. */
function parseGit(seg, cwd) {
  const words = seg.match(/"[^"]*"|'[^']*'|\S+/g) ?? [];
  let i = 0;
  while (i < words.length && /^[A-Z_][A-Z0-9_]*=/.test(words[i])) i++; // env assignments
  if (words[i] !== 'git') return null;
  i++;
  let dir = cwd;
  while (i < words.length && words[i].startsWith('-')) {
    if (words[i] === '-C') {
      dir = path.resolve(dir, words[i + 1].replace(/^["']|["']$/g, ''));
      i += 2;
    } else if (words[i] === '-c') i += 2;
    else i++;
  }
  return { sub: words[i], args: words.slice(i + 1).map((w) => w.replace(/^["']|["']$/g, '')), dir };
}

/** Protected targets of a push: [{ branch, src }] where src is the local ref being pushed. */
function pushTargets(args, dir) {
  if (args.includes('--delete') || args.includes('-d')) return [];
  if (args.includes('--all') || args.includes('--mirror')) {
    return [...PROTECTED].map((b) => ({ branch: b, src: b }));
  }
  const pos = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '-o' || a === '--push-option' || a === '--repo') { i++; continue; }
    if (a.startsWith('-')) continue;
    pos.push(a);
  }
  const refspecs = pos.slice(1);
  const current = git(dir, ['rev-parse', '--abbrev-ref', 'HEAD']);
  const specs = refspecs.length ? refspecs : [current ?? ''];
  const out = [];
  for (const spec of specs) {
    const s = spec.replace(/^\+/, '');
    const [src, dst] = s.includes(':') ? s.split(':') : [s, s];
    const branch = dst.replace(/^refs\/heads\//, '');
    if (!src) continue; // `:main` is a delete
    if (PROTECTED.has(branch)) out.push({ branch, src: src === 'HEAD' ? 'HEAD' : src });
  }
  return out;
}

const stampFile = (dir) => {
  const gitDir = git(dir, ['rev-parse', '--absolute-git-dir']);
  return gitDir ? path.join(gitDir, 'claude-gate-passed') : null;
};

function passedTrees(dir) {
  const f = stampFile(dir);
  if (!f || !existsSync(f)) return new Set();
  return new Set(readFileSync(f, 'utf8').split('\n').filter(Boolean));
}

function stamp(dir, tree) {
  const f = stampFile(dir);
  if (!f || !tree) return;
  const keep = [...passedTrees(dir)].slice(-50);
  writeFileSync(f, [...keep, tree].join('\n') + '\n');
}

/** Tree hash of the working tree including untracked (non-ignored) files, without touching the real index. */
function workingTree(dir) {
  const gitDir = git(dir, ['rev-parse', '--absolute-git-dir']);
  if (!gitDir) return null;
  const tmpIndex = path.join(gitDir, 'claude-gate-index');
  const env = { ...process.env, GIT_INDEX_FILE: tmpIndex };
  try {
    execFileSync('git', ['read-tree', 'HEAD'], { cwd: dir, env, stdio: 'ignore' });
    execFileSync('git', ['add', '-A'], { cwd: dir, env, stdio: 'ignore' });
    return execFileSync('git', ['write-tree'], { cwd: dir, env, encoding: 'utf8' }).trim();
  } catch {
    return null;
  } finally {
    try { execFileSync('rm', ['-f', tmpIndex]); } catch { /* ignore */ }
  }
}

function runChecks(dir, why, stampTree = null) {
  const root = git(dir, ['rev-parse', '--show-toplevel']) ?? dir;
  if (!existsSync(path.join(root, 'node_modules'))) {
    block(`${why}, but node_modules is missing, so the checks can't run. Run \`npm ci\` and try again.`);
  }
  const tree = workingTree(dir);
  if (tree && passedTrees(dir).has(tree)) return; // this exact content already passed
  const r = spawnSync('node', [path.join(root, '.claude/hooks/fast-checks.mjs')], {
    cwd: root,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  if (r.status !== 0) {
    const tail = `${r.stdout ?? ''}${r.stderr ?? ''}`.trim().split('\n').slice(-60).join('\n');
    block(
      `${why}, and the fast checks failed. Fix them and try again (nothing was committed or pushed).\n${tail}`,
    );
  }
  stamp(dir, tree);
  if (stampTree && stampTree !== tree) stamp(dir, stampTree);
}

function checkBash(payload) {
  const cwd = payload.cwd || process.cwd();
  const cmd = String(payload.tool_input?.command ?? '');
  if (!/\bgit\b/.test(cmd)) return;
  let needCommitCheck = null;
  let movedBeforePush = null; // a checkout/merge/... earlier in the same command changes what gets pushed
  let moved = null;
  const pushes = [];
  for (const seg of segments(cmd)) {
    const g = parseGit(seg, cwd);
    if (!g) continue;
    if (g.sub === 'commit') {
      const branch = git(g.dir, ['rev-parse', '--abbrev-ref', 'HEAD']);
      if (branch && PROTECTED.has(branch)) needCommitCheck = { dir: g.dir, branch };
      else moved = 'commit'; // a commit on another branch, then `push HEAD:main`: the pushed tree isn't known yet
    } else if (g.sub === 'push') {
      const t = pushTargets(g.args, g.dir);
      if (t.length && moved) movedBeforePush = moved;
      for (const x of t) pushes.push({ ...x, dir: g.dir });
    } else if (MOVES.has(g.sub)) {
      moved = g.sub;
    }
  }
  if (movedBeforePush) {
    block(
      `this command runs \`git ${movedBeforePush}\` and then pushes to main/beta, so the gate can't tell ` +
        'what will be pushed. Run the push as its own command.',
    );
  }
  if (!needCommitCheck && !pushes.length) return;

  // A commit in the same command: check the working tree now (it is what will be committed and pushed).
  if (needCommitCheck) {
    runChecks(needCommitCheck.dir, `This command commits to ${needCommitCheck.branch}`);
    return;
  }

  for (const p of pushes) {
    const tree = git(p.dir, ['rev-parse', `${p.src}^{tree}`]);
    if (!tree) continue; // unknown ref: let git report it
    if (passedTrees(p.dir).has(tree)) continue;
    // Same content is already on the remote branch (CI ran on it): nothing new to check.
    if (git(p.dir, ['rev-parse', `refs/remotes/origin/${p.branch}^{tree}`]) === tree) continue;
    const headTree = git(p.dir, ['rev-parse', 'HEAD^{tree}']);
    const dirty = git(p.dir, ['status', '--porcelain', '--untracked-files=no']);
    if (headTree === tree && dirty === '') {
      runChecks(p.dir, `This pushes to ${p.branch}`, tree);
      continue;
    }
    block(
      `pushing ${p.src} to ${p.branch}, but that commit was never checked and it isn't the clean working ` +
        'tree, so the checks can\'t run on it. Check that commit out with a clean tree and push again.',
    );
  }
}

function checkGithubWrite(payload) {
  const branch = String(payload.tool_input?.branch ?? '');
  if (PROTECTED.has(branch.replace(/^refs\/heads\//, ''))) {
    block(
      `${payload.tool_name} writes straight to ${branch} and skips typecheck, lint and tests. ` +
        'Commit with git in the clone and push instead, so the gate runs.',
    );
  }
}

function run(payload) {
  const tool = String(payload?.tool_name ?? '');
  if (tool === 'Bash') checkBash(payload);
  else if (/^mcp__github__(push_files|create_or_update_file|delete_file)$/.test(tool)) checkGithubWrite(payload);
  process.exit(0);
}
