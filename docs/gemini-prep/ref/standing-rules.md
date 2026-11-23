# R0 of the Runner rework: rules every count brief shares

From the Runner rework AI Coordinator (thread "Coordinate the Runner AI rework", id cmsg_013UNycUZbB5MfsLyJaSoKuFEqczEp3ecM68HA2caTpekx), 2026-11-19. **FINAL: Jeff approved plan rev 3 on 2026-11-19 18:17Z.**

**Count only.** No `src` change merges, no fix is built, nothing is tuned. You end with a note in your folder; I rule on it by the rule written in your brief before the numbers existed. The plan: `/mnt/project-files/netrunner-ai/runner-rework/plan.md` (rev 3; read sections 2, 4 (R0), 5 and 13, and `gemini-review-answers.md` beside it).

## Read first (all four)
- `CLAUDE.md` and `docs/ai-process.md` (whole): counted decisions, one owner per quantity, the tuning ladder, measurement scripts, batches and the slot gate, human-game fixtures, review cutoff.
- `docs/ai-priced-quantities.md`, the "Runner" rows.
- `src/ai/runnerAI.ts` (whole), `src/ai/runnerReply.ts` (whole), `playout` and `planTurn` in `src/ai/turnPlanner.ts`, `runScore`, `serverValue` and `serverWorth` in `src/ai/runs.ts`.

## Scripts
- Games and continuations are played by `GameRunner` (`src/ai/playout.ts`), with the Corp's rez windows offered. A driver that only calls `chooseAction` never offers them.
- Time is read against a control arm (a tree identical to beta, in the same run): identical trees read 3 to 4% apart in self-play, so a difference under 5% is "no difference".
- A script never asks or clears the tree that plays the source game. Check with a plain `GameRunner` game that your sources are the batch's games (g1 base 44381468776, `results/44381468776.deals.json` on `origin/ai-batch-results`: `cr`, `sc`, `winner` by seed).
- Hidden information (rule 10.2.2a; Jeff: Normal AIs never see their own draws or hidden cards): no arm reads the Corp's unseen cards, the stack's order or the Runner's future draws. The measuring script may read hidden cards to say what was true; mark each place.
- An arm adds no number. An arm is a patched copy of the tree, built as the last counts built theirs (patch files under `scripts/` applied to a copy: `scripts/stage-d/bait-run-trees.ts`, `prompt-chain-trees.ts`); your branch itself changes no file under `src/`. Where an arm cannot be built without a new number, stop on that arm and say which number is missing.
- Runs: the `ai-script` or `ai-batch` workflow started from ref `beta` with your SHA in `ref`; look at what is waiting first; at most two of your runs in the queue; "~N min" in the label if over 30; first check at +10 minutes (g1: +15), then every 5 (g1: every 10).

## The base moves (added 2026-11-19 19:03Z)
beta's engine changes today (a rules fix: Whitespace and Syailendra lose credits through `loseCredits`; self-play changes on Aircheck deals; on beta at 33c3511c; its g1 base is run 44594439017; of the human files only report-56 changes, from move 127), and `ai-hold-inputs` follows. The g1 base 44381468776 is the record of `src` at beta 3329250 only. Finish your count on the tree you started on: do not merge a beta that holds a `src` change into your count branch before your runs and sums are done (UI, test and script commits are fine). If you must, the source check is against the new base for that SHA (project memory, BASELINES, kept by the Corp-side coordinator), and you say so in the note.

## Sources
- Self-play: the 221 deals of the g1 base, as the batch plays them.
- People: `tests/fixtures/human-games` (38 files). 21 games have a person as the Runner (23 files: report-40b and 40c are cuts of 40; report-33 is against the Hard Corp, read apart). 15 have our Runner against a person: 14 are the Hard Runner (reports 17 to 29 and 32; read apart, it is switched off) and one is the Normal Runner (report-54). Jeff is playing 3 or 4 more as the Corp against the Normal Runner; I send them when they arrive.
- Self-play, person as Runner, and person as Corp are reported apart everywhere.
- The hold count (`src/ai/corp/hold.ts`) has five known gathering faults (`/mnt/project-files/netrunner-ai/review-fixes-1119/hold-inputs/brief.md`), being fixed on `ai-hold-inputs`. Branch from beta after that merge if it has landed; if not, mark every board that meets one of the five classes and read the walk's answer there as known-wrong.

## Branch, files, hand-off
- Branch as your brief names, from `origin/beta`. Allowed: new files under `scripts/runner-rework/` with your brief's prefix, `docs/ai-batch-log.md` if you launch a run, and what your brief adds. Forbidden: `src/**`, `tests/**` unless your brief names a file, `.claude/**`, `.github/**`, every other file.
- Notes and outputs go to your folder under `/mnt/project-files/netrunner-ai/runner-rework/r0/`. `/mnt/project-files` is a network mount: trailing slash on its path, never search the whole folder, re-read a shared file about ten seconds after writing it.
- End: `count-note.md`, then the `handoff` skill for the scripts branch (light tier: scripts only, CI green), then message me. Do not pick the answer: lay out which reading the numbers support, where they are thin, and which way each arm errs.
- A stop, for every count: a decision that changes in the control tree; a hidden-information read by an arm; a source game that does not match the batch's record.

**Read 2026-11-19 23:58Z (Corp-side coordinator):** the g1 base on the engine fix, run 44594439017, is identical to 44381468776 on all 221 deals (winner, cr, sc). Either run is the g1 base of beta's src today (src/ai at 2104a62, engine at 33c3511c); counts sourced from 44381468776 stand.

**2026-11-20 03:19Z (Corp-side coordinator):** two src merges moved beta. `ai-hold-inputs` daffc389 (g1 identical to 44594439017 on 221 of 221 deals). `ai-run-term-once` f80f3123 (`prompts.ts`, the Corp's run term) changes 6 of the 221 deals (1531, 1541, 1591, 1601, 1641, 2861): the g1 base of f80f3123 is run 44666924040 (read 04:12Z; src unchanged from f80f3123 through beta 900bc5e4; it differs from 44633584479, the base of daffc389, on exactly those 6 deals). R0's four counts are on 3329250's src and stand as counted; any script run from here on names the beta SHA it ran on and reads against that SHA's base.

## Before every launch: one local minute of the exact run (added 2026-11-19 20:58Z)

Count 2's PART D run (44589226027) waited two hours for a slot and then failed on every shard in five seconds: one arm's patch did not match once in its tree (`dBigHand`), and only PART C had been tried locally. Before any `ai-script` or `ai-batch` launch, run the exact script with the exact ARGS for one shard locally for about a minute (every tree built, the first records written), on the commit the run will use. This is a start-up check, not the count: Jeff's 20:15Z note (no local runs to get ahead of the queue) stands.

- 2026-11-20 05:16Z: beta src moved again, bundle R (rez fixes) merged 6e254bee. g1 base of that src = run 44673826897 (against 44666924040 it differs on deal 1021 only, first change T12). Bundle P (placement wiring) is the next src merge; take the base the Corp side sends after it.
- 2026-11-20 05:45Z: bundle P (placement wiring) merged 38ab2a97. CURRENT g1 base of beta = run 44680798149 (221 deals); it replaces 44673826897 and 44666924040. About 70 deals differ from the older bases (the Corp's asset cover candidate). Any g1 or head-to-head on a branch cut before 38ab2a97 needs beta merged in and this base. R0's counts are on 3329250's src and stand as counted.
- 2026-11-20 15:26Z: beta is on main (555b956a). CURRENT g1 base of beta = run 44754275578 (identical to 44680798149 on all 221 deals; engine fixes from the deep fuzz, src/core only). g10 base 44685386416.
