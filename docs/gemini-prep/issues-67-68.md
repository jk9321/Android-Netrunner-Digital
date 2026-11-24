# Issues #67 and #68: fixtures, pins, the #67 look-ahead, the #68 count (no fix)

Branch `ai-runner-i67-i68` from `origin/beta` ff04f60. Tracker R-27 (items I67, I68); brief `/mnt/project-files/netrunner-ai/runner-rework/briefs/i67-i68-pins-count.md`; the coordinator's trace `runner-rework/issues/i67-i68-trace.md`. Tests and scripts only: nothing in `src/**` changes and nothing is fixed. "Read" = from the code; "run" = printed by a script on this branch.

## Commands

```bash
npx vite-node scripts/runner-rework/issues-67-68.ts           # Part 1 (replay) and Part 3 (#67)
npx vitest run tests/runnerIssues67to68.test.ts --reporter=verbose   # Part 2 (pins and twins)
SHARD=k/64 npx vite-node scripts/runner-rework/host-prompts.ts   # Part 4 (ai-script run), then
node scripts/runner-rework/host-prompts-sum.mjs <out dir>
```

## Part 1: the games replay (run)

`issue-67.json`: 143 moves, 0 engine errors, log length 159 (recorded 159). `issue-68.json`: 79 moves, 0 engine errors, log length 93 (recorded 93). Fixtures copied unchanged from `runner-rework/issues/` into `tests/fixtures/runner-issues/`.

## Part 2: the pins (run)

`tests/runnerIssues67to68.test.ts`: 2 passed, 2 expected fail. Each pin fails on its assertion (checked with `it.fails` turned into `it` on a scratch copy):

- **#68** `#68 T5: the Runner does not put a second Botulus on the ice that already hosts one`: `AssertionError: expected { hostsBotulusAlready: true, …(1) } to deeply equal { hostsBotulusAlready: false, …(1) }` (received `emptyLeft: true, hostsBotulusAlready: true`). Twin: the prompt at move 76 is "Install Botulus on which ice?", three facedown ice, Botulus counts `[1, 0, 0]`, the recorded answer is the first.
- **#67** `#67 T8: the Runner does not run Remote 1 and then decline to trash B-1001`: `AssertionError: expected [ { trash: false, credits: 8 } ] to deeply equal []`. Twin: the board at move 130 (T8, 4 clicks, 0 tags, B-1001 rezzed in Remote 1, trash 3, credits ≥ 3) and the recorded turn (run on Remote 1 at move 130, access answer `trash: false`).

## Part 3: #67, what the look-ahead counted (run unless marked)

Board: T8 move 130, 4 clicks, 8 credits, 0 tags. The planner plays out the first 4 of the flat ranking (`PLANNER.candidates`, `src/ai/turnPlanner.ts:31`); the rebuilt playouts give the same four values as the live decision's `onCandidates`.

| First action | Playout value | = leaf | + run bonus | Rest of the turn |
|---|---|---|---|---|
| Run R&D (flat 1st, -0.465) | 16.713 | 15.095 | 1.618 | gain, gain, install Madani; 7 credits |
| Click for a credit (2nd) | 16.770 | 15.095 | 1.675 | run R&D, gain, install Madani; 7 credits |
| Install Madani (3rd) | **17.250** | 15.746 | 1.504 | draw, run R&D, gain; 6 credits |
| **Run Remote 1 (4th, -1.583)** | **17.675** | 17.175 | 0.500 | gain, install Madani, draw; 7 credits |

- **Chosen line:** run Remote 1 first, 17.675. **Best line not starting with that run:** install Madani first, 17.250 (margin 0.425).
- **What the Remote 1 run adds inside its line:** the bonus is `runWorth + runClick` (`turnPlanner.ts:205-207`) = -1.583 + 2.083 = **0.500**, which is `serverValue` of Remote 1. It expects to spend **0 credits** (`runCreditSpend`; Botulus on Starlit Knight breaks for free). After it the line plays gain a credit, install Madani, draw (a line after a run is not recorded as the plan, `turnPlanner.ts:256`, but it is played and scored).
- **The 0.5 is a floor (read):** `serverWorth`'s rezzed-root term, `src/ai/runs.ts:1174`: `value += Math.max(0.5, corpCardValue(card, state, 'runner', true) - creditCost(state, trash))`. Here `corpCardValue` (B-1001 as left) is 0.500 and `creditCost(3)` is 4.289 (run), so the trash is worth -3.789 and the floor lifts it to 0.5. It is a floor on the worth of trashing a rezzed, trashable root card at access.
- **The access answer:** live `answerPrompt` keeps (scoreOutcome keep 17.1234, trash 13.5601, synergy on, the Runner's memory); a planner-off rollout copy with the same memory answers keep as well. The planner never asks it: a run in a playout is not played out (`turnPlanner.ts:201-211`), so the rollout's access answer and the 0.5 the line counts never meet.
- **The R&D lines' credit is charged twice:** once inside `runWorth` (`runScore` subtracts `spendCost(state, paid)`, `src/ai/runs.ts:1490`, read; the R&D run's worth is 1.057 below its serverValue 2.675, run) and again in the leaf, because `runCredits` takes the run's credits out of the playout state (`turnPlanner.ts:210-211`, read; the comment there says runScore "already charged them"). The leaf of the Madani line (6 credits) is 1.429 below the Remote 1 line's leaf (7 credits) with the same grip and rig (run). The Remote 1 run spends 0, so it pays neither charge.
- **Planner off:** the same Runner (planner off, same memory) plays the flat first, the R&D run; played forward by GameRunner its T8 is run R&D, gain, gain, install Madani (run).

**Cause (read, with the run numbers above).** The flat ranking does not choose the Remote 1 run; the turn planner does, by 0.425. Its line counts the run at `serverValue` 0.5, which is the 0.5 floor at `runs.ts:1174` on a trash the access decision prices 3.56 below keeping, so the line is credited for a trash that will not be made. The run also spends no credits, while each R&D line is charged its credit twice (`runs.ts:1490` inside runWorth and `turnPlanner.ts:210-211` in the leaf), which lowers every competing line. Arithmetic on these numbers (not an arm): without the 0.5 the Remote 1 line is 17.175 < 17.250; with the R&D credit charged once the Madani line would sit above 17.675. Both parts are needed to explain the margin; neither is a proposal.

Finding for B5 (candidate duplicate): the run's credits in a Runner playout are priced twice, in `runScore`'s spendCost and again in the leaf's credits after `runCredits` (`turnPlanner.ts:208-211`).

## Part 4: #68, the count (run: ai-script 45493772875 at abec2e5a, 64 shards, 21:42Z to 21:49Z)

Unit: one **effect host prompt**, a Runner `effect_choice` built by `installRunnerChoice` (source data names the card and the discount; every option is an installed ice). Source check: 331 of 331 self-play games match their batch record (winner, cr, sc); the eval Runner's answer equals the played answer on 46 of 46 self-play prompts. People's files: 44 replayed (38 human + 6 issue games), report-24 stops at move 286 (see deviations). Scores are the try-each fallback's own (`answerPrompt` with the deck-aware AI on, on the board the Runner answers on); the coordinator's trace used synergy off, so its numbers differ (#68 T5: 13.1771 here against 13.8457 there; same order, same tie). Full printout: `/mnt/project-files/netrunner-ai/runner-rework/issues/host-prompts-45493772875-sum.txt`.

| Row | g1 45444888753 (221 deals) | NRDB=1 g1 45458221138 (110 deals) | People's files | Issue games |
|---|---|---|---|---|
| 1 prompts met | **33** in 19 games; all Botulus; Topan 24, Scrounge 7, Magdalene 2 | **13** in 10 games; all Botulus; Topan 10, Scrounge 3 | 8 (under 10, not shown): a person as Runner 7 (Chromatophores 5, Physarum Entangler 1, Stowaway 1; Madani 5, Beta Build 1, Arissana 1); our Runner 1 (Chromatophores via Illumination) | 2 (not shown): #68's two, Botulus via Topan |
| 2 two or more answers equal at the top | **15 of 33** (45.5%); in all 15 the pick is the first listed | **3 of 13** (23.1%); all 3 the first listed | 1 of 8 | 2 of 2 |
| 3 second copy on a host that has one, another hosting none | **5 of 33** (15.2%; possible on 15 boards); host facedown 4, rezzed 1 (deals 3011, 2751, 1771, 1191, 3141) | **1 of 13** (7.7%; possible on 5); host rezzed 1 (deal 1241) | 0 of 8 | 1 of 2 (#68 T5, facedown) |
| 4 facedown picks | **18 of 33** (54.5%) | **6 of 13** (46.2%) | 0 of 8 | 2 of 2 |
| 4 owner ranks one host first, pick is it | 15 | 5 | no owner: none of the 8 is a trojan | 0 |
| 4 owner ranks one host first, pick is another | **7** | **2** | no owner | 0 |
| 4 owner ranks no host first (top hosts equal) | 11 (9 all facedown at -3; 2 two rezzed hosts equal) | 6 (5 all facedown; 1 rezzed pair) | no owner | 2 (#68 T3, T5: all facedown at -3) |
| 5 card choice one step before: install action at that board | 33 boards; 21 scored: **8 score below 0, each with its best host facedown** (the -3), 11 ranked first; 12 not a legal click action | 13 boards; 8 scored: 2 below 0 (facedown), 2 more facedown just above 0 (0.31, 0.16, not ranked first), 4 ranked first; 5 not a legal click action | 8 boards: 1 scored (positive, rank 5), 4 not legal, 3 during a run or the Corp's turn | #68 T5: -2.6449, rank 7 of 13, facedown; T3 not legal (1 credit, costs 2) |

"Not a legal click action" (row 5): the action path has no INSTALL_CARD for the card at that board; checked on 4 boards: short of credits (2751 T4 and T8: costs 2, has 1; the effect's discount is what pays it) or memory full (2081 T7, 1581 T15: 5 of 5 MU, the effect trashes a program first). Row 5's board is built as `host-prompts.ts`' header says (prompts cleared, at least one click, the card moved to the grip from the heap for Scrounge and Magdalene).

**Finding (the coordinator's point 1, with the evidence):** the action's owner would not avoid the second copy on a facedown host either. `scoreMain`'s host term gives every facedown host a flat -3 (`runnerAI.ts:367`) and only a rezzed host gets `trojanHostValue`'s -1.5 for a second copy; on #68's two boards every host is facedown, so the owner ranks all of them equal (row 4, last column), as on 9 batch and 5 NRDB boards.

## Deviations and things the brief did not expect

1. **The owner has no preference on facedown hosts** (above): asking the action's owner as it stands would not have changed #68's pick.
2. **Row 3 also fires on rezzed hosts** (batch 1771 T11, NRDB 1241 T19): the try-each pick put a second Botulus on a rezzed host that already had one while the owner ranked another host first; the list order is not the only path to a second copy.
3. **Row 5 with no action path:** 12 of 33 (batch) and 5 of 13 (NRDB) card choices pick a card the action path could not install at that board at all (credits short, the effect's discount pays it; or memory full, the effect trashes first). Those boards have no action score to compare.
4. **report-24 stops at move 286** (`START_TURN` by the Corp): `Waiting on a decision: Runner: discard 2 card(s) down to your maximum hand size of 5.` The earlier people's-file scripts stop at the same move: the lockstep run 45467771741 ("report-24 replays to move 286, a discard prompt, in all three trees") and run-term-once 44642572300 ("report-24 stops at move 286 on every tree, as in the agreement count"; `docs/ai-batch-log.md`). Not worked around.
5. **The #67 twin** states the recorded turn from the fixture (the run at move 130 and the recorded `trash: false`), not an AI replay of it, so it keeps passing once the fix lands.
6. **The #67 double charge** of a run's credits in a Runner playout (Part 3) is a candidate duplicate for B5, found while tracing; no fix.
