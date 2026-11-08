---
name: handoff
description: Fixed hand-off for an implementing thread that finished a spec from the AI Coordinator, the Multiplayer Coordinator or any reviewer (a branch ready for review or merge). Generates diff stat vs base, files touched vs the spec's allowed list, diff signals and real typecheck/lint/test output, plus a deviations list. Use whenever you hand a branch to a coordinator or reviewer, or say work is "ready for review".
---

# Hand-off

A hand-off is evidence, not a summary. The reviewer must be able to check every claim in it without asking you,
and must be able to re-run it and get the same answer. A prose "all tests pass, stayed in scope" is not a
hand-off. Past problems this prevents: reviewers reading the summary instead of the diff, branches that
quietly touched shared files, "tests pass" when CI then went red.

## 1. Before you generate it

- Everything is committed and pushed to the branch the spec named (`git status` clean, `origin/<branch>` = HEAD).
- The branch contains the current base: merge `origin/beta` (or `origin/main`) in first if the base moved, and
  re-run your tests after the merge. Reviewing a stale branch hides conflicts.
- Find the spec's **allowed files** and **forbidden files** (the coordinator's spec message or the spec file in
  `/mnt/project-files/`). If the spec named none, write the list you actually intended and say "spec gave no
  list" under Deviations. Typical forbidden: `src/ai/**` for non-AI work, `src/core/engine/**` for AI work.

## 2. Generate the evidence (don't hand-write it)

```
node .claude/skills/handoff/evidence.mjs --base origin/beta \
  --allow 'src/core/view.ts,src/ui/**,tests/**' --deny 'src/ai/**' --checks full \
  --out /mnt/project-files/handoffs/<branch>-<short sha>.md
```

- `--base`: what the branch merges into (`origin/beta` for AI, multiplayer and new-set work; `origin/main` for
  main fixes). The diff is from the merge base, so other people's work on the base doesn't show up.
- `--checks full` runs typecheck, lint and the full `npm test` (a few minutes; run it in the background).
  It captures the real output tails. Use `--checks fast` only for a doc- or test-only change, and say so.
- The script is read-only. It flags, in added lines only: escape hatches (`any`, `@ts-ignore`,
  `eslint-disable`, `as unknown as`), skipped/focused tests, empty catches, `Math.random`/`Date.now`, card codes
  outside card files, `plan.*` switches, raw hidden-state reads in `src/ai`, deleted test files, and "no tests
  touched". Each flag needs either a fix or one line of reason in your hand-off.
- `/mnt/project-files` is a network mount: re-read the file about ten seconds after writing it.

## 3. The hand-off message (fixed template)

Paste this, filled in, as your reply to the coordinator. Keep the headings and order exactly; write "None" in
an empty section rather than deleting it.

```markdown
# Hand-off: <spec name> on `<branch>` @ <full sha>
Base: <origin/beta @ sha>. Spec: <link or path to the spec message/file>.

## What changed (3-6 lines)
The behaviour change in plain words, and where it lives (file:function). No history, no "I tried X first".

## Evidence
<the whole output of evidence.mjs, unedited, or the path of the --out file plus its Checks and
Files-vs-spec sections pasted>

## Files outside the allowed list
Every OUTSIDE ALLOWED / FORBIDDEN line from the evidence, each with why it was necessary. "None" if none.

## Diff signals
Each flagged line: fixed, or one line of why it is right (e.g. "card code in scripts is the card's own entry").

## Spec deviations
Everything you did differently from the spec, or decided where the spec was silent: renamed/added switches,
changed defaults, extra refactors, skipped steps, tests you could not write. "None" means none.

## Tests added
Test name -> what it pins (one line each). For rules changes, the rule number it cites (CLAUDE.md: every rules
change cites the comprehensive rules). For AI changes, the scenario test that pins the hole.

## Batches / measurements (AI work only)
Run ids, base_run pairing, games, result vs gate, `scripts/batch-log.mjs` entry. "n/a" otherwise.

## Not checked / known gaps
What you did not verify (e.g. "didn't run e2e locally", "only tested Normal difficulty"). A quiet area is not
a clean area.

## Reviewer: run this
git fetch origin && git checkout <full sha>
node .claude/skills/handoff/evidence.mjs --base <base> --allow '<same globs>' --deny '<same globs>' --checks full
```

## 4. Rules

- Never claim a check passed that the evidence file doesn't show passing. If a test failed and you believe it
  is flaky, say which test, paste the failure, and show it passing on a re-run; don't drop it from the report.
- Never weaken a check to get green: no `.skip`, no loosened assertion, no `any` to silence the compiler, no
  widened timeout without saying so under Deviations.
- Don't merge into beta (or main) until the coordinator's review (the `review` skill) says **Approved** for
  this exact SHA. A new commit after approval needs a new review, however small.
- Changing the hand-off after review started: push new commits, re-run the evidence, and post the new file;
  don't edit the old one.
