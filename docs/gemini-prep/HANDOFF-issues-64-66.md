# Gemini hand-off: replay and pin Runner issues #64, #65, #66 (2026-11-24)

Written for Gemini, working in `github.com/jk9321/Android-Netrunner-Digital` without Claude's tooling. One task: replay three saved games, say what the Runner AI did and why, and write a known-failing test ("pin") for each fault. It is diagnosis and tests only. Nothing here changes how the game or the AI plays, and nothing merges.

**Where everything is:** this file is `docs/gemini-prep/HANDOFF-issues-64-66.md` on branch **`gemini-issues-64-66`**, which is already cut from `origin/beta` (`f826d33`). Work on this branch. The format follows the earlier `docs/gemini-prep/HANDOFF.md` (branch `gemini-prep`), and your earlier write-up of #58 and #59 (`docs/gemini-prep/issues-58-59.md`, branch `gemini-issues-58-59`) is the model for the write-up.

---

## 0. Rules (read before starting)

**Read first:** `CLAUDE.md` and `docs/ai-process.md` in the repo, whole. Where this file is stricter, this file wins.

**Hard limits**
1. Commit only to `gemini-issues-64-66`. Never push to `main` or `beta`, never merge anything into anything, never open a PR. A Claude thread (the Runner rework coordinator) reviews the branch and merges what passes.
2. **No `src/**` edits at all.** The repo's guard hook does not see you, so this is on trust. If something looks like it needs a `src` change, stop and write down why.
3. **No workflow runs** (`ai-batch`, `ai-script`, `deploy`, anything): everything here runs locally in seconds. Do not edit `.github/**` or `.claude/**`.
4. Do not comment on, label or close the GitHub issues.
5. **Allowed files, and no others:**
   - `tests/fixtures/runner-issues/issue-64.json`, `issue-65.json`, `issue-66.json` (new folder; NOT `tests/fixtures/runner-facts/issues/`, which count scripts read as a fixed pool, and NOT `tests/fixtures/human-games/`, which many tests read whole);
   - `tests/runnerIssues64to66.test.ts` (new; do not edit `tests/runnerDecidedTwice.test.ts`, copy what you need from it);
   - `docs/gemini-prep/issues-64-66.md` (new, the write-up);
   - `scripts/runner-rework/issues-*` (new, only if you need a diagnosis script).
6. Before each push run `npm run typecheck`, `npm run lint` and `npm test` and paste the tails into the write-up. All three must pass with your pins in place (a pin written with `it.fails` passes while the fault exists).
7. Hidden information: the Runner under test may know only what the rules let it know (comprehensive rules section 1.12, and 10.2.2a as the earlier hand-off cites it). Build its knowledge the way `boardAt` in `tests/runnerDecidedTwice.test.ts` does: a fresh Normal Runner that `observe`s every board of the replay. A diagnosis script may read hidden state to say what was true; mark each such place `// HIDDEN READ (measurement only)`.
8. Never mutate a game state after `isLegalAction` / `getLegalActions` was called on it (legality is cached per state). Edit a `structuredClone` before anything asks about it.
9. Turns are played forward with `GameRunner` (`src/ai/playout.ts`) and a Normal Corp, as the existing pins do. A driver that only calls `chooseAction` skips the Corp's rez windows and gives wrong answers.
10. Rules claims cite the comprehensive rules by number (`Null_Signal_Games_Netrunner_Comprehensive_Rules_v26.03.pdf`).
11. Plain sentences. Report what is shown and mark every guess as a guess. **Propose no fix and write no patch.** The fixes belong to the Runner rework (stages R-B and R-C1).

**The model to copy:** `tests/runnerDecidedTwice.test.ts` (the pins for #58 and #59). Each issue there has (a) a setup test that passes and states the board, (b) the pin as `it.fails`, stating the behaviour over the played turn, not a value of an internal score, and (c) a "twin": the same board with one stated change on which the Runner behaves sensibly, which passes today. The twin shows the pin fails for the reason named and not for another.

**The saved games:** each issue's first comment holds the game. Paste the comment into a file and run `node scripts/bug-report-state.mjs <file> > tests/fixtures/runner-issues/issue-N.json`. The result has `config` (seed and both full deck objects), `moves`, `startStops`, `state`, `table`. Replay: `createInitialGameState(deckGameSetup(config.seed, config.corpDeck, config.runnerDeck))`, then `startStops`, then `executeAction` for each move (see `boardAt`). All three games were played on `main` at `4d304e6`; you replay them on beta's engine. **First check, per game:** the replay runs to the last move without an engine error and its log matches the issue's log at the turns below. If not, stop on that game and write down the first move that differs.

**The reproduce check, per fault:** from the board just before the Runner's first run of the turn, with the watching Runner and a Normal Corp, `GameRunner` must replay the same fault on beta. Beta's Runner AI differs from main's in one place (the seen-card memory fix, `remember` in `src/ai/runnerAI.ts`). If a fault does not reproduce on beta, that is a result: say so, show what the Runner does now, and write no pin for it.

---

## The three issues

All three: Normal Runner AI (the computer plays the Runner), Ryō "Phoenix" Ōno, reported from the live site.

### #64 (seed 2471002559, Corp AU Co., custom deck)
**The report:** turn 3 the Runner installs Botulus on a piece of ice, runs Remote Server 2, the Corp rezzes Semak-samun, the Runner takes 3 net damage and steals Sericulture Expansion. Turn 4 (Botulus now has 2 counters) it runs Remote Server 2 again into the rezzed Semak-samun; "End the run unless the Runner suffers 3 net damage" fires and the run ends. A click spent for nothing.
**What the coordinator read from the code (not replayed, so treat both as guesses to test):**
- (1) The run's price counts this subroutine as damage it will take (`src/ai/runs.ts:678`, "a tank takes the damage"), while the decision inside the run chooses to end the run.
- (2) Semak-samun's subroutine can only be broken by a fracter (engine: `canBreakSubroutinesWith`, `src/core/engine/ice.ts:45`, enforced at `src/core/engine/actions/breaking.ts:51`). `breakPlans` checks it (`src/ai/runs.ts:539`), but `botulusBreaks` (`runs.ts:59`) and `plainIcePrice` (`runs.ts:703`) may not, so Botulus may be counted as breaking it.
**Find out:** which ice Botulus was on; the Runner's grip size and credits at the turn 4 run; what the Runner believed the run would cost and what it would get (the parts of the run's score for Remote Server 2, read through exported functions of `src/ai/runs.ts` such as `runScore` and `serverValue`, or in a script-side copy; never by editing `src`); what it was offered at Semak-samun and what it chose; which of (1), (2), both or neither is the cause.
**Pin:** on the turn 4 board, played to the end of the turn: the Runner makes no run on Remote Server 2 that Semak-samun's subroutine ends (it either does not run there or gets past). Twin: your choice, stated (for example the same board with a grip or a rig on which it gets in).

### #65 (seed 203162371, Corp The Syndicate, upgraded starter; the same game as #66, saved at turn 5)
**The report:** turn 4 the Runner clicks for a credit twice (reaching 3 credits by the log's arithmetic; confirm it), runs the unprotected Remote Server 2 holding a rezzed Regolith Mining License (trash cost 3), accesses it and does not trash it.
**What the coordinator read:** this looks like #58 (Public Access Plaza) with another card. The run's worth counts the trash because the Runner can pay it (`serverWorth` in `src/ai/runs.ts`, the rezzed-card branch: `trash <= state.runner.credits`), and the decision at access declines. A guess until replayed.
**Find out:** credits at the run; the worth the run was given for the Regolith; the trash decision at access (the options, their scores, why "no"); whether it is the mechanism you found for #58 or a different one.
**Pin:** on the turn 4 board, played to the end of the turn: every Runner access of the rezzed Regolith Mining License that it can pay to trash ends with it trashed (or the Runner makes no such run). Twin: stated, as in #58's.

### #66 (the same game, saved at turn 17)
**The report:** turns 14, 15 and 16 the Runner runs Remote Server 3, loses three clicks breaking Brân 1.0's three subroutines, then jacks out. On turn 16 the Corp had just scored the agenda out of that server and installed nothing new, so the reporter says the server held nothing.
**Two faults, pinned apart:**
- **(a) The wasted runs (turns 14, 15, 16).** This looks like #59 (clicks spent on a bioroid, nothing left for what is behind it). **Find out:** what ice is behind Brân 1.0 on each of the three turns, rezzed or not, and what the Runner knew of it; clicks and credits at each run; why it jacked out; why the failure on turn 14 did not stop turn 15's run. **Pin:** on each of the three boards, played to the end of the turn: no run on Remote Server 3 in which the Runner spends bioroid clicks and then jacks out (the shape of `remoteRuns` in the existing test). One twin is enough.
- **(b) The run into an empty server (turn 16).** New and unexplained. First confirm on the replayed board that `state.corp.servers[<remote 3>].root` is empty at the turn 16 run, and say what the Runner may know of that (how many cards are installed in a root is open to both players; cite the rule number you find for it). `serverWorth` gives 0 for an empty remote, so something else paid for the run. **Find out what:** list every part of the run's score for that server on that board (a card in the rig or the grip that pays on a run or a successful run, the identity, the tag, Botulus's 13 counters, anything else). **Pin:** on the turn 16 board: the Runner makes no run on a remote whose root is empty, unless your diagnosis shows the run had a real payoff, in which case write no pin and say what the payoff was.

Since #65 and #66 are one game, check that issue-65's moves are a prefix of issue-66's. If they are, say so and you may use `issue-66.json` for both (keep `issue-65.json` out then).

---

## Done when
- `tests/fixtures/runner-issues/` holds the decoded games, and `tests/runnerIssues64to66.test.ts` holds, per fault: the setup test, the `it.fails` pin, the twin. For each pin, show in the write-up that it fails **on its assertion** (run it once as a plain `it`, paste the failure, then put `it.fails` back), not on a throw or a timeout. Give each test's run time; keep the whole file under about 30 seconds, and set no test timeout above 20 seconds.
- `docs/gemini-prep/issues-64-66.md` holds, per fault: whether the replay matches the log, whether the fault reproduces on beta, the decision points (turn and move index), what the Runner AI scored and chose at each, the cause at the lowest level you can show (shown or guess, marked), how to reproduce it in one command, and the tails of typecheck, lint and test.
- The branch is pushed. Tell Jeff it is ready; the Runner rework coordinator reviews it.
