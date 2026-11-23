# Gemini prep hand-off: Runner AI rework (2026-11-23)

Written for Gemini, working in `github.com/jk9321/Android-Netrunner-Digital` without Claude's tooling. Four prep tasks for the paused Runner AI rework. All of it is measurement, diagnosis or design text. Nothing here changes how the game or the AI plays, and nothing merges.

**Where everything is:** in the repo, on branch **`gemini-prep`**: this file is `docs/gemini-prep/HANDOFF.md`, and the briefs and notes it points to are in `docs/gemini-prep/ref/` (written below as `ref/<name>`). Read them from that branch. Cut each task branch from `origin/beta`, not from `gemini-prep`.

---

## 0. Rules for every task (read before starting)

**Read first:** `CLAUDE.md` and `docs/ai-process.md` in the repo, whole. They are the project's rules. Where this file is stricter, this file wins.

**Hard limits**
1. One branch per task, cut fresh from `origin/beta` (currently `bdbc444`): names below, all `gemini-*`. Never push to `main` or `beta`. Never merge anything into anything, and never open a PR into `main` or `beta`. A Claude thread reviews each branch later and merges what passes.
2. **No `src/**` edits at all** (not `src/ai`, not `src/core`, not `src/ui`). The repo's guard hook only lets Claude edit `src/ai/**` on `ai-*` branches; that guard does not see you, so this rule is on trust. If a task looks like it needs a `src` change, stop and write down why.
3. **Batch runs are allowed (Jeff, 2026-11-23), under the queue rules.** Only the `ai-batch` and `ai-script` workflows; never `deploy` or `engine-fuzz-deep`.
   - Start the workflow from ref **`beta`**, and put your branch's **full 40-character SHA** in the `ref` input (a short SHA fails checkout).
   - Before launching, look at the Actions tab for runs already waiting. Keep **at most two of your runs** queued or running at once; launch the next when one of yours starts its shards.
   - Before every launch, run the exact script with the exact args for one shard locally for about a minute, on the same commit, so a broken run doesn't wait hours for a slot and then fail.
   - Fill in `label` with what the run measures, and add "~N min" if it will take over 30 minutes.
   - A run may sit in its `slot` job before starting (the slot gate in `docs/ai-process.md`); read that job's log for why. Check a g1 at +15 min, then every 10; a script run at +10, then every 5.
   - Log each run in `docs/ai-batch-log.md` on your task branch (`scripts/batch-log.mjs`).
   - Do not edit `.github/**`.
4. Do not comment on, label or close GitHub issues.
5. Before each push, run `npm run typecheck`, `npm run lint` and `npm test` and paste the tails into your notes. (Claude's gate hook does this automatically; you do it by hand.) CI must stay green on your branch.
6. Hidden information: the AIs must never see the Corp's unseen cards, the stack order or future draws (rule 10.2.2a). A measuring script may read hidden state to say what was true, but mark every such place with a `// HIDDEN READ (measurement only)` comment.
7. Never mutate a game state after `isLegalAction` / `getLegalActions` was called on it (legality is cached per state). Edit a `structuredClone` before any legality call.
8. Games and continuations are played with `GameRunner` (`src/ai/playout.ts`), which offers the Corp its rez windows. A driver that only calls `chooseAction` gives wrong answers.
9. Rules claims cite the comprehensive rules by number: `Netrunner/Resources/Rulebook/Null_Signal_Games_Netrunner_Comprehensive_Rules_v26.03.pdf` in Jeff's project folder.
10. Write in plain sentences. Report numbers; **do not pick fixes or answers**. Each brief says "you propose no fix": keep to it.

**The base (the reference self-play run)**
- Beta's `src` is unchanged since `7fa8b6f`. Its g1 base is run **45086908053** (221 deals). Its records are on branch `origin/ai-batch-results`: `results/45086908053.deals.json` (per seed: `cr`, `sc`, `winner`, turn records) and `results/45086908053.txt`.
- The briefs name older run ids (44680798149, 44754275578). Those are identical to 45086908053 on all 221 deals, so use 45086908053 and say so.
- Before trusting your script's games, play one deal with a plain `GameRunner` and check it matches that deal's record (winner, `cr`, `sc`). If it doesn't, stop.
- People's games: `tests/fixtures/human-games/` (38 files; which ones have our Normal Runner is in `ref/standing-rules.md`, "Sources"). Report self-play, NRDB-pool and people's games separately everywhere.

**Where outputs go:** commit your notes on the task branch (paths below). A Claude thread copies them into the project folder later. When a brief says "message me", write that message as a file in your notes instead. **Step 0 size cap:** if your step-0 estimate for the whole count is over about 3 hours of runner time or 4 workflow runs, stop after step 0 and write it up; under that, go on with the full count.

**Suggested order:** Task 1 (B0), Task 2 (issues), Task 3 (flags doc), Task 4 (A-log), then Tasks 5 to 7 (added 2026-11-23 afternoon; 5 first, since it's the only one not already partly done).

---

## Task 1. B0 count scripts: deal 2211 trace, and losses a defensive line avoided

**Brief:** `ref/b0-scripts.md` (the full spec; this section only adds the Gemini limits). Also read `ref/standing-rules.md`, `ref/r-b.md` (B0 and "Decided here" 1), `ref/count4-count-note.md`, `ref/count4-ruling.md`, the red team's B5 in `ref/red-team-findings.md`, and `ref/found-row-90.md` (self-play shares value caches between the two AIs). Code: `src/ai/playout.ts`, `scripts/head-to-head.ts` (how count 4's null pair was played), `src/ai/runnerAI.ts`.

**Branch:** `gemini-b0-count`. **Allowed files:** new `scripts/runner-rework/b0-*`, and `docs/ai-batch-log.md` if you launch a run. Notes: `scripts/runner-rework/b0-notes/` (step-0 report, count note). Everything else forbidden.

**Part T (do fully, locally):** deal 2211 differs between count 4's two null head-to-head cells (`h2h=corp` vs `h2h=runner`). It is the second game of shard 57, so the caches already hold the first game's entries when it starts: replay both cells over the whole shard with every action logged and the three caches instrumented (instrument in a script-side patched copy, never in `src`; see "An arm is a patched copy" in `ref/standing-rules.md`). Find the first differing decision, then the first differing value under it (which cache, which key, which AI wrote it). One paragraph: the cause, and whether it is found row 90's class or a new one. **Stop after about 2 hours of compute** and write how far you got.

**Part D:** write the script that finds the Runner losses (flatline, or a tag punishment fired in the Corp's last three turns), rewinds to the Runner's last turn before it, and plays each legal defensive line by `GameRunner` (rules and line list in the brief). Then step 0: a timed sample on 10 Runner losses from the base, the time per loss, and your estimate for the whole count. If it is under the size cap, launch the NRDB=1 g1 (an `ai-batch` run, games=1, decks limited to the NRDB pool as the brief says) and run the whole count.

**Done when:** `b0-notes/part-t.md` (cause or how far the trace got), `b0-notes/step0.md` (timed sample, estimate, the 10 losses with which lines survived), and if the count ran, `b0-notes/count-note.md` laid out by the brief's reading rules (avoidable, avoidable blind, the 2% and 10% lines; numbers only, no verdict). Scripts committed, checks green, branch pushed.

---

## Task 2. Reproduce and diagnose issues #58 and #59 (write-up only, no fix)

**Issues (read both, and their first comment, which holds the saved game):**
- **#58 "Plaza access bug"** (beta `d43a526`, Normal Runner AI, seed 3290689454). The Runner accessed Public Access Plaza in Remote 3 on turns 3, 4, 5 and 6 without trashing it, though it looks like it had the credits, and trashed it on turn 7 (for 2 credits, paid from Touchstone). Meanwhile the Plaza paid the Corp 1 credit every turn.
- **#59 "Runner repeatedly ran Bumi 1.0"** (main `dff9002`, Normal Runner AI, seed 2208434514). On turns 4, 7, 8 and 10 the Runner ran Remote 1, spent two clicks breaking Bumi 1.0 subroutines, then jacked out. The same failed run repeated four times.

**Read:** nothing in `ref/` is needed. Code: `src/ai/runnerAI.ts`, `src/ai/runs.ts` (`runScore`, `serverValue`, `serverWorth`), `src/ai/runnerReply.ts`, the trash decision at access, the card scripts for Public Access Plaza, Mahkota Langit Grid and Bumi 1.0 under `src/core/scripts/`. Tools: `scripts/bug-report-state.mjs` (decodes the saved game), `scripts/fixture-at.ts` (state at a move), `scripts/playtest-issue-to-fixture.mjs` (the fixture shape, `{config, state, moves, startStops}`).

**Branch:** `gemini-issues-58-59`. **Allowed files:** `docs/gemini-prep/issues-58-59.md` (new), and a diagnosis script `scripts/runner-rework/issues-*` (new) if you need one. Do **not** add files under `tests/` (many tests read every file in `tests/fixtures/human-games/`); put decoded games under `docs/gemini-prep/issue-games/` instead.

**What to find, for each issue:**
1. Decode the saved game and replay it to the decision (or replay the seed with the same decks). Confirm the engine did what the log says; if the engine itself is wrong, say so with the rule number.
2. At each bad decision, log what the Runner AI saw: the options it scored, each option's score, and the parts that make up the chosen one. For #58: what it priced trashing the Plaza at (one-time cost vs the Plaza's per-turn income) and why it said no; whether the repeat runs were aimed at the Plaza or chosen because Remote 3 was cheap to run. For #59: what it believed about the ice behind Bumi 1.0 when it started the run, why it jacked out, and why it did not remember the failure next turn.
3. Name the cause at the lowest level you can show (a missing term, a wrong number, a missing memory, a planner quirk). Say which part is shown and which is a guess. No fix, no patch.

**Done when:** `docs/gemini-prep/issues-58-59.md` with, per issue, the decision points (turn, move index), the AI's option scores at each, the cause, and how to reproduce it in one command. Checks green, branch pushed.

---

## Task 3. Draft spec: generic run and turn flags (design doc only)

**Goal:** before the next card set, card-specific fields on the engine's run state and card script types move to keyed, generic storage, so a new card adds a key, not a field. The build itself gets a full review later; this task only writes the plan.

**Read:** `ref/leads-flags-excerpt.md` (the lead as written). Code: `src/core/types/state.ts` (`RunState`, from about line 185), `src/core/scripts/types.ts` (`CardScript`, `CardModifiers` at about line 305), `src/core/engine/cardEffects.ts` (`TurnFlag` line 21, `RunFlag` line 57, `bumpTurnFlag`, `runFlag`), `src/core/view.ts` and `src/core/view/reconstruct.ts` (per-player views; hidden info), `src/core/engine/actions/run.ts`, `runEnd.ts`, `ice.ts`, `triggers.ts`, `legalActions.ts`, `install.ts`. Known card-specific fields to start from: `meliesServer`, `shredArmed`, `redirectToHq`, `bakerRedirect`, `agendasFaceUp`, `limitsAccessToOne`, `installFaceUpOnly`, `cannotStealOrTrash` (Ansel 1.0), plus the "Archives into R&D" prompt field, the `src/ai/prompts.ts:443` comment, and the `executeAction` execution context (engine globals).

**Branch:** `gemini-run-turn-flags-spec`. **Allowed files:** `docs/gemini-prep/run-turn-flags-draft.md` (new) only.

**The doc holds:**
1. **Inventory table:** every card-specific field on `RunState`, `TurnState`/`GameState` and `CardScript`, one row each: field, type, the card(s) that set it, every file and line that reads or writes it (grep, don't guess), whether `view.ts`/`reconstruct.ts` or `src/ai` reads it, and when it resets (run end, turn end, never).
2. **Proposed shape:** how each field maps onto the existing `TurnFlag` / `RunFlag` / `CardModifiers` (or one new keyed map if none fits), with its type, its reset point, and who may see it (both players, one player, neither). Keep keys typed, not free strings.
3. **Migration order:** small steps that each keep play identical, which tests prove each step (a whole-suite run plus the engine fuzzer `tests/engineFuzz.test.ts`), and which steps touch `src/ai` (those go to an `ai-*` branch and the AI Coordinator).
4. **Risks:** saved games and fixtures that hold the old field names (`tests/fixtures/**`, localStorage saves in `src/ui/savedGame.ts`), multiplayer views, the `inst-N` numbering in `gameState.ts` (must not change), and anything you could not resolve.

**Done when:** the doc is pushed on its branch. No code changes.

---

## Task 4. A-log scripts: card-fact logs and golden values (stretch)

**Brief:** `ref/a-log.md` (full spec). Also read `ref/standing-rules.md`, **`ref/r-a.md` whole (tables L1 to L12 and "The golden values" are the work list)**, `ref/count1-count-note.md` part B (the 26 cases, seven cards, five encodings), `ref/count3-count-note.md` section 4 and `ref/count3-ruling.md` section 5, the red team's A1, A2, A6, A7 in `ref/red-team-findings.md`. Code: `src/ai/runs.ts`, `src/ai/corp/hold.ts`, `src/ai/cards/types.ts`; for building boards, `tests/exploitPins.test.ts` and `tests/runnerPins.test.ts`.

**Branch:** `gemini-runner-facts-log`. **Allowed files:** new `scripts/runner-rework/facts-*`, new `tests/fixtures/runner-facts/` (built boards and `golden.json`; no test file), `docs/ai-batch-log.md`. Notes: `scripts/runner-rework/facts-notes/`.

**Do:** write the log scripts (L1 to L12) and `scripts/runner-rework/facts-golden.ts`; then step 0: (a) the source table (for each of the 26 cases and seven cards: decks holding it in the batch pool, in the NRDB=1 pool, and people's files where it was met in play); (b) a timed sample of 20 boards (10 self-play, 10 people's) through every log line, time per board, estimate for the whole. Also run `facts-golden.ts` twice and show the two outputs are byte-identical, and state the commit it was made on in its header and in the JSON.

If step 0 is under the size cap, run the whole log on the base, the people's files and one NRDB=1 g1 (reuse Task 1's NRDB g1 run if it exists, since it's the same commit). Never touch `src`.

**Done when:** `facts-notes/step0.md`, and if the log ran, `facts-notes/log-note.md` (the tables, where they are thin, which way each reading errs; no picked answer); scripts and fixture committed, checks green, branch pushed.

---

## Task 5. Cache-keys check: can the AI value caches mix the two sides? (write-up only)

**Goal:** found row 90 says self-play shares three per-game value caches between the Corp AI and the Runner AI, filled by whichever side asks first from the board it was given (its own view, or a look-ahead board). A game against a person doesn't share them. The effect on win rate was sized at zero (`ref/shared-caches.md`: 12 of 221 deals take a different path, +0.5 ± 1.0). What is still open is whether each cached value has one owner: does it depend on who asked first, and could one side ever read something only the other side may know? This is parked debt to fix before the first learned round. The task writes the plan for it and builds nothing.

**Read:** `ref/found-row-90.md`, `ref/shared-caches.md`, `ref/count4-count-note.md`, `ref/count4-ruling.md`. Code: `src/ai/effectValues.ts` (the `threats` map at about line 363, `damageThreat`, `boardFactCodes`), `src/ai/valueModel.ts` (`memos`, `mapGames` at about 142-170, `buildTargets`, `iceMeans`), `src/ai/iceValues.ts` (`deckShares`, about line 228), `scripts/cache-audit.ts`, `scripts/cache-bisect.ts`, `scripts/cache-clears.ts`, and the cache table in `docs/ai-priced-quantities.md` (search "cache"). Also grep `src/ai` for every other module-level `new Map` / `new WeakMap`; row 90 names three caches, but there may be more.

**Branch:** `gemini-cache-keys`. **Allowed files:** `docs/gemini-prep/cache-keys.md` (new) and, if you need to measure, new `scripts/runner-rework/cachekeys-*` plus `docs/ai-batch-log.md`. No `src` edits.

**The doc holds:**
1. **One row per module-level cache in `src/ai`:** its key, what fills it, which side(s) ask it, which board they pass in (real state, a player's view from `src/core/view.ts`, a look-ahead or dealt board), and when it is emptied.
2. **For each cache, two verdicts with evidence:** (a) whether the value can differ by who asked first. Show a board pair where it does, or the code path that proves it can't. (b) Whether it ever holds hidden information that one side may not know: the Corp's unseen cards, the stack order, or the Runner's grip. Mark it "shown", "ruled out (code path)" or "not checked".
3. **The fix options** for each cache: a complete key (add the asking side or the view's fingerprint), per-side caches, or no cache. Give the cost of each option, but don't pick one.
4. If Task 1's Part T found deal 2211's cause, say which cache it was.

**Done when:** the doc is pushed on its branch.

---

## Task 6. Debt 1c, the Runner AI's seen-card memory: refresh the fix brief against today's code (write-up only)

**Background:** the Normal Runner AI keeps a private map of Corp cards it has "seen", and it never forgets them, even when the rules say it should (rule 1.12.3). That is debt 1c in `ref/debts-1c-1h.md`. A full fix brief already exists and has been red-teamed: `ref/runner-seen-brief.md`, with the red team's findings and answers in `ref/runner-seen-red-team.md`. Known-failing pins for it already exist in `tests/runnerPins.test.ts` (D1, D2). **So don't write a new fix plan.** The brief was written on 2026-11-19, and beta has moved since. This task checks that the brief still fits the code, so the builder can start straight from it.

**Read:** `ref/runner-seen-brief.md` (whole), `ref/runner-seen-red-team.md`, `ref/debts-1c-1h.md` (1c), `ref/count1-count-note.md` part D. Code: `src/ai/runnerAI.ts` (`memory`, `remember`), `src/core/engine/actions/run.ts` (`runnerKnows`), `src/core/engine/helpers.ts` (`forgetHiddenCards`, `runnerSawBeforeInstall`), `src/core/engine/actions/install.ts`, `tests/runnerPins.test.ts`.

**Branch:** `gemini-runner-seen-check`. **Allowed files:** `docs/gemini-prep/runner-seen-check.md` (new) only.

**The doc holds:**
1. Every file:line the brief cites, checked against today's `origin/beta`: still right, moved (give the new line), or changed (say how).
2. Every reader of the Runner's `memory` today (grep it), including any added since 2026-11-19, and whether the brief covers each one.
3. The `tests/runnerPins.test.ts` pins for this debt, run on today's beta. For each: does it still fail, and does it fail on its assertion (not a crash or timeout)? Paste the output.
4. Anything in the brief that no longer holds, as a list. Propose no new design.

**Done when:** the doc is pushed on its branch.

---

## Task 7. Rez toll hole (debts 1e, 1f) and reservedForAgenda's double count (1h): check the pins (write-up only)

**Background:** these three are known Corp AI debts that were accepted at the push to main (`ref/debts-1c-1h.md`). **They already have known-failing pins** in `tests/reviewPins.test.ts`: "Whitespace toll: spendsKept hands rezMoney..." (1e), "Whitespace toll, the decision..." (1f) and "reservedForAgenda, report-48 move 59..." (1h), each written as `it.fails`. So don't add new pins. The task confirms the pins still reproduce each debt for the stated reason, so a later fix has a trustworthy test to turn over.

**Read:** `ref/debts-1c-1h.md` (1e, 1f, 1h), `ref/rez-count-ruling.md` (C1, C2), `ref/placement-review.md` (N6). Code: `src/ai/corp/placement.ts` (`reservedForAgenda`, `scoringShort`), the rez decision code the pins call (follow their imports), `tests/reviewPins.test.ts`.

**Branch:** `gemini-corp-debt-pins`. **Allowed files:** `docs/gemini-prep/corp-debt-pins.md` (new). Change `tests/reviewPins.test.ts` only if a pin no longer reproduces its debt, and then only that pin, keeping it as `it.fails` and asserting the right behaviour.

**For each of the three debts, the doc holds:**
1. The pin's name, and its output on today's beta. Does it fail, and is that because the wrong value or decision the debt describes is still there, rather than a crash, timeout or setup change? To show it, temporarily change `it.fails` to `it` locally, run it, and paste the assertion message with expected vs actual. Don't commit that change.
2. Today's code path that produces the wrong number (file:line), checked against the debt's description.
3. If a pin now passes, or fails for another reason, say so plainly, and fix only the pin as described above.

**Done when:** the doc (and a pin fix, if one was needed) is pushed on its branch, with typecheck, lint and test green.

---

## When you finish

For each branch, write one short status line at the top of its notes file: branch, last commit SHA, what is done, what was stopped and why, and the check output tails. Jeff hands the branches to the Runner rework coordinator when he gives the go; it reviews them and decides what merges.
