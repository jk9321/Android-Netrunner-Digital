---
name: review
description: Coordinator review of an implementing thread's branch before it merges to beta or main (AI Coordinator, Multiplayer Coordinator, or any thread asked to review a hand-off). Reads the raw diff against the spec, re-runs the hand-off evidence, checks duplicate logic, weakened types, shared paths, new switches and hidden-info leaks, fact-checks every claim, and returns Approved / Changes needed with located findings. Use whenever you review a hand-off or are asked to approve a merge.
---

# Review

You are the last check before code reaches Jeff's beta preview. The implementing thread's hand-off (the
`handoff` skill) is a claim; the diff is the truth. Review a fixed SHA, never a moving branch, and never approve
from the hand-off text alone. This project's known failure modes are sprawl and drift: the same quantity
computed in several places, symptoms patched in several layers, switches nobody removes, and assumptions from
one area leaking into another. A review exists to stop those before they merge.

## 1. Pin what you are reviewing

1. Open the spec you (or the coordinator) wrote: goal, allowed and forbidden files, invariants (e.g. "same-seed
   games identical to beta", "no src/ai changes"), the rules it named.
2. Take the SHA from the hand-off. If there is no hand-off in the `handoff` template, or it has no evidence
   block, reply "Changes needed: hand-off missing (use the handoff skill)" and stop.
3. Check it out in your own clone: `git fetch origin && git checkout <sha>` (`npm ci` if the lockfile changed).

## 2. Re-run the evidence yourself

```
node .claude/skills/handoff/evidence.mjs --base origin/beta --allow '<spec globs>' --deny '<spec globs>' --checks full
```

Use the **spec's** globs, not the ones the hand-off used. Compare with the hand-off: a check that failed for
you, a file outside the allowed list the hand-off didn't explain, or a diff signal it didn't answer is a
finding. If the branch is behind its base, ask for a merge of the base first; don't review a stale branch.

Run `node scripts/value-owners/verify-registry.mjs --all` (the default checks only the valuation section). `tests/codeHealth.test.ts` runs it in the fast checks; `--fix` moves a location only when it can prove the line, so refresh the rest by hand and read the diff.

Then the drift metrics, base vs branch (read-only; uses the code-audit skill's script):

```
git worktree add /tmp/review-base <merge-base sha>
(cd /tmp/review-base && ln -s "$OLDPWD/node_modules" node_modules && node .claude/skills/code-audit/metrics.mjs snapshot --out /tmp/review-base.json)
node .claude/skills/code-audit/metrics.mjs snapshot --out /tmp/review-head.json
node .claude/skills/code-audit/metrics.mjs diff /tmp/review-base.json /tmp/review-head.json
git worktree remove --force /tmp/review-base
```

Look at what moved: new escape hatches, new card codes in generic code, new `plan` switches (and switches read
only once or never), bigger largest-functions, beta-only imports outside the build flags.

## 3. Read the raw diff against the spec

`git diff <merge-base>..<sha>` file by file, every hunk. Not the stat, not the summary. For each item below,
write down what you checked even if it was clean.

- **Spec match.** Does the code do what the spec asked, and only that? Unrequested refactors, renamed
  functions, changed defaults and "while I was here" fixes are findings unless the hand-off lists them under
  Deviations and they are worth keeping.
- **Duplicate logic.** For every new function, constant or computed quantity: grep for an existing one that
  computes the same thing (`grep -rn "<key term>" src/`). The repo's history: Corp rez money counted four ways,
  Runner slide income four ways. A second copy is a finding even if both are correct today; name both
  locations and say which should win. For AI work, check `docs/ai-priced-quantities.md` against the diff
  (`RULE-ONE-OWNER`): no second computation of a listed quantity, a new quantity has its row.
- **Fix in the right layer.** A symptom fixed in a caller, an override, or a special case (`if (code ===
  '3xxxx')` outside `src/core/scripts/` or the card's own `src/ai/cards/<set>.ts` entry) when a general rule or
  the card's own entry is the right place. AI: is it fixed once, in the layer that owns it (rule ranking,
  planner leaf, override), or patched in a second layer too?
- **Weakened types and checks.** New `any`, `as` casts (especially `as unknown as`), `!` non-null assertions on
  values that can be null, optional fields made optional to silence an error, `@ts-ignore`, `eslint-disable`,
  loosened test assertions, widened timeouts, `.skip`/`.only`, deleted tests. Each needs a reason that holds.
- **Shared paths.** Changes to files many areas depend on: `src/core/engine/**`, `src/core/types*`,
  `gameState.ts` (`inst-N` numbering must not change), `src/core/view.ts`, `src/ai/synergy.ts` / tuning,
  `vite.config.ts`, `package.json`, CI and `.claude/**`. A shared-path change outside the spec's allowed list
  is a finding. Inside it, check every caller of a changed signature (`grep -rn "<fn>(" src tests`).
- **New switches.** Every new `tuning.plan` switch: is it needed (does the off path differ?), named for what it
  does, default stated, measured (paired batch with `base_run`) and logged? Where it is declared, does it say
  when it is removed (`RULE-NUMBERS-SWITCHES`: no switch is permanent)? Folded names must still THROW in
  `PLAN_OFF`. A switch that will never be turned off is dead code; ask for it to be folded.
- **Hidden-information leaks** (`RULE-HIDDEN-INFO`). Anything that lets a player or the Normal AI learn what it shouldn't: AI code
  reading `state.corp.hand`, `deck`, facedown/unrezzed `code` without the side's view; log text or prompts
  naming hidden cards; new GameState fields not classified in `src/core/view.ts`; bug reports, saves or server
  messages built from raw state instead of the view; pacing tells (a window that opens only when the Corp can
  act; AUTO paid windows are accepted, don't report that one).
- **State discipline and determinism.** No mutation after `isLegalAction`/`getLegalActions`; tests use
  `structuredClone`; RNG only through `src/core/rng.ts`; no `Math.random` or `Date.now` in engine or AI
  decisions. If the spec says "same-seed games identical", ask for the `games=1` identical-check batch id.
- **Rules** (`RULE-CITE-RULES-PDF`). Every rules-relevant change cites a rule number; open the comprehensive rules PDF
  (`/mnt/project-files/Netrunner/Resources/Rulebook/Null_Signal_Games_Netrunner_Comprehensive_Rules_v26.03.pdf`)
  and check the code does what the rule says. Card wording from `src/data/*-cards.json` `stripped_text`.
- **Tests.** Each behaviour change has a test that fails without it (check one: revert the line locally and run
  the test). AI holes are pinned by a scenario test, not only a batch. New cards each have their own test.
- **Numbers and bonuses (AI)** (`RULE-COUNTED-DECISIONS`, `RULE-NUMBERS-SWITCHES`). Every new number in the diff is
  worked out from the game state or is a declared learnable setting whose spec says why the game state cannot give
  it. Every new bonus or penalty term: the spec names the inputs tried (or why none can carry the fix), the term
  sits inside the quantity's one owning function, and that owner's registry row lists it. Missing any is a Must fix.
- **Measurements (AI).** Paired batch against the right base (`RULE-PAIRED-BATCHES`, `RULE-BASELINES`), sample size per
  `RULE-BATCH-SIZES`, result checked against the spec's written bar (`RULE-BAR-BEFORE-BATCH`). Win rate is reported, not
  gated (`RULE-REPLACE-DONT-STACK`); Corp 50 ± 5% is read in the final rounds with every set in (`RULE-SET-STEP-7`).
  A regression within noise on a fix that closes a human-usable hole is acceptable (Jeff, 2026-10-31).
- **Rule copies** (`RULE-CITE-IDS`). A brief, plan, skill or doc in the diff that copies a rule's text instead of
  citing its id is a Should fix.

**Tuning ladder (AI branches that change play)** (`RULE-TUNING-LADDER`). The spec or hand-off must hold the trace, and
the fix must sit in the layer the trace found, as narrow as the cause. Must fix: a fix moved to a broader or narrower
layer, or a new counted question, line, clause, per-card rule or lever, without the written reason and the approvals
that rule names.

**Adversarial findings (`RULE-ADVERSARIAL`).** When the branch's spec had a red-team pass, or the
stage had an exploit hunt, open `/mnt/project-files/adversarial/<date>-<name>/findings.md`: every finding must
have a written answer (fixed with the commit, or disagreed with a reason). A finding with no answer, or a "fixed"
whose commit is not in the reviewed SHA, is a Must fix. Rule on each open dispute in the review file, or take it
to Jeff with a recommendation.

## 4. Fact-check before you send (from the code-audit skill)

- Every finding cites `path:line` at the reviewed SHA. No location, no finding.
- Write your findings to a file and run `node .claude/skills/code-audit/metrics.mjs verify <file>`: every
  `path:line` must exist and every card code must print the title you meant. Fix the review until it passes.
- Claims about behaviour ("this double-counts", "the AI now never X") need a reproduction: a test, a scenario,
  a log line or a number. If you couldn't reproduce it, mark it **Unverified** and don't block on it alone.
- An Explore or other sub-agent's claim is a lead, not a finding: confirm it in the code yourself.

## 5. Verdict (fixed format)

```markdown
# Review: <spec name> `<branch>` @ <full sha> — Approved | Changes needed
Base <origin/beta @ sha>. Evidence re-run: typecheck PASS/FAIL, lint PASS/FAIL, tests PASS/FAIL (N tests).

## Must fix (blocks merge)
- R1 <title> — `path:line`. What is wrong, why it matters, what to do instead.

## Should fix (merge may wait for Jeff's call)
- R2 ...

## Notes (no action)
- ...

## Checked, clean
Spec match, duplicate logic, layer, types, shared paths, switches, hidden info, state/determinism, rules,
tests, numbers and bonuses, measurements, rule copies: say which you checked and found nothing. Say what you did not check.
```

- **Approved** only when Must fix is empty and the evidence re-run passed. The approval names the full SHA;
  any later commit needs another review (re-run steps 2 and 3 on the new commits only).
- Changes needed: send the list back to the implementing thread; it fixes, pushes and re-hands-off.
- Disagreements about scope or design that change what Jeff gets are Jeff's call: put them to him with a
  recommendation instead of deciding in the review.
- The review itself changes no code. Don't fix the branch yourself, even for a one-line issue; the implementing
  thread owns it, so the hand-off stays true.
