# AI priced quantities: one owner each

Rule (CLAUDE.md, "One owner per quantity"): each quantity below has one owning function. A branch may not add another computation of it. The "known duplicates" column may only go down. Reviews check this file against the diff; every code audit recounts it. Source of the first counts: `/mnt/project-files/audits/2026-11-13-ai-corp/report.md` (beta ef644c0).

## Corp
| Quantity | Owner (target) | Known duplicates 2026-11-13 | Audit finding | Fixed in |
|---|---|---|---|---|
| Rez money the Corp must keep | `rezMoney` (src/ai/corp/rezMoney.ts: `keep`, `byServer`, `rezIds`, `unholdable`; `lineFloor` is its byServer sum), Step 4 Stage A | 4 left after Stage B (8 after Stage A): the ranking's `reservePenalty`/`rezReserve`, `moneyTargetPenalty`, the pacing gate and cast-while-able's `unrezzedIceCost` (corpAI: die in Stage C). Read the owner since Stage B: `scoringShort`, the horizon in `reservedForAgenda`, centralIce's rez gate (B3, corp/placement.ts: keep with the line's agenda left out; the gate is the rez on top of keep), `boardNeed` (B5: keep, the Corp's view) and `rezBudget` (B5: a reader, the owner's holding rezzes draw first; its shares REZ_NOW 1 and REZ_NEXT 0.3 and the one-turn-income pool CORP_TURN_INCOME 3 stay hand-set numbers, debt for the tuning phase, not Stage C). The Runner's view of boardNeed and rezBudget keeps the old count (the owner reads the Corp's HQ) | AI-REZMONEY | Step 4 Stage A (owner), B (B3, B5), C (the ranking's four) |
| Does this server keep the Runner out (hold count) | `serverHold` (src/ai/corp/hold.ts: `holds`, `rez`, `rezCost`, `need`, `budget`, `margin`, `entries`; `when: 'runnerTurn'` was holdCost, `'thisRun'` was rezModel's stopCost), Step 4 Stage A. Stage B2 deleted the holdCost and stopSpend readers, replaced countedRez's own `ahead` sum with the owner (same answer on 644 rez windows) and fixed the owner's afford test (a legal rez paid another way: recurring credits, Biawak's forfeit) | 7 besides the owner: `modelRezParts` `.stops` (rezModel, its own stop test inside the priced rez; labelled in stage-b/b2-rez-log.md, not merged), the ranking's `guards`, `iceDepth`, `fundedDepth`, `entryCost` (with `protectionCost`, `breakerReach`, `outOfReach`), `exposureOk` (corpAI: die in Stage C), and `iceStop`/`lastingIceCost` (iceValues: prices, not verdicts, stay). Open owner bugs: bioroid clicks counted twice, encounter costs (Funhouse) read as need 0, an on-rez granted subroutine not seen (Diviner, report-18 #5): Stage D1, D2 | AI-HOLD-COUNT | Step 4 Stage A (owner), B2 |
| Agenda odds (what an access is worth) | two pools: the Corp's own knowledge, `corpPools` and `stake` (src/ai/corp/pools.ts, Step 4 Stage A: `runLoss`, `reachablePoints`, `centralStake` and `rdAgendaOdds` moved there), and the Runner's view (not yet owned) | 5: the Corp pool is single (its three stake computations are fields of one owner; they still differ on purpose: `loss` is expected points by the odds, `points` the most one run can take; and on Archives `loss` counts facedown agendas only), plus the Runner-view four (`effectValues` agendaOdds/stealOdds, `evaluate`, `runs` x2) and the threat model's: Runner audit, by agreement (spec 1.6) | AI-AGENDA-ODDS | Step 4 Stage A (Corp pool) |
| Price of a game end | `sampledEndWorth` beside `flatlineWorth` (valueModel) | 3, but the sampled Runner reply no longer reads evaluate's ±1000 (Step 1, 004c789: a sampled end is ±pointValue(7) on the reply root's board). Left: ±1000 in evaluate (a certain end on the Corp's own line; and search.ts rollouts, which are sampled too: Step 3 or 4), `runLoss`, `flatlineWorth`. Open: what a NEAR sampled loss is worth (on the point clock a Runner win costs pointValue(7) less the Runner's points, 42 from 4 points, 15 from 6; deal 1321 T14), for the behaviour stage after the cleanup (spec stage D5 orders a game-ending access first rather than pricing it) | AI-TERMINAL-PRICE | Step 1 (sampled reply only) |
| Where a card is installed (placement) | `place` (src/ai/corp/placement.ts), Step 4: since Stage B4 it holds the rule bodies (`centralIce`, `iceRedirect`, `assetPartner`, `assetCover`, `reservedForAgenda`, `scoringShort`) and corp/core.ts applies them to the pick through `placePick` (one call, where the four rewriters ran; play identical, AI Coordinator 2026-11-14 17:40Z). countedScore.ts is gone | 1 listed duplicate: the install prompts' own targets (`freeInstallTarget` and four target blocks in prompts.ts: Stage D3). Ranking debt: installScore's per-server numbers and its two asset lines (Stage C1), and the look-ahead still proposes installs at the ranking's server (Stage C) | AI-PICK-PIPELINE | Step 4 Stage A (owner), B4 (bodies in) |
| A card held in HQ | by-card hand price (handValues) | 2 (flat 2.0/1.6 in the ranking, by card in the planner leaf) | AI-HAND-TWO-CURRENCIES | Step 5 |
| An advance on an unknown asset (bluff) | `placedCounterWorth` (effectValues) | 2 (flat 1.2 in corpAI) | AI-FLAT-NUMBERS | Step 5 |

## Stage B: duplicate counts before and after (Step 4, branch ai-corp-untangle)
| Quantity | After Stage A | After Stage B | What went |
|---|---|---|---|
| Rez money the Corp must keep | 8 | 4 (the ranking's, Stage C) | scoringShort, reservedForAgenda's horizon, centralIce's rez gate (B3), boardNeed (B5) read `keep`; rezBudget reads the owner's holding rezzes for its order (B5; it moves a share on 35 of 1,644 human-game states) |
| Does this server keep the Runner out | 7 | 7 | holdCost and stopSpend (readers, not counted) deleted; countedRez's own `ahead` sum (found by the B2 grep, not counted before) replaced by the owner |
| Agenda odds | 5 | 5 | none (the Corp pool was already single; the Runner view waits for the Runner audit) |
| Placement | 4 rewriters, their order copied twice, prompts, installScore | 1 (the prompts, D3) plus ranking debt (installScore, Stage C) | the rewriters' bodies are in `place`; one placePick call in corp/core.ts; countedScore.ts deleted |

## Step 4 owners (src/ai/corp/), after Stage B
| File | Owner | Readers in play |
|---|---|---|
| `corp/hold.ts` | `serverHold` (+ `runnerBudget`, `runnerMoney`, `CHECK`) | `corp/lines.ts` (scoreInTwo, lineHolds), `corp/rezMoney.ts`, `corp/placement.ts` (scoringShort, reservedForAgenda), `corp/rez.ts` (matchPointRez, rezStops) |
| `corp/rezMoney.ts` | `rezMoney` (`keep`, `byServer`, `rezIds`, `unholdable`; `lineFloor`, `stakedServers`) | `corp/lines.ts` (lineFloor), `corp/placement.ts` (keep: scoringShort, reservedForAgenda, centralIce), `valueModel.ts` boardNeed (keep, through setRezKeep), `iceValues.ts` rezBudget (rezIds) |
| `corp/pools.ts` | `corpPools`, `stake` (+ `runLoss`, `reachablePoints`, `centralStake`, `rdAgendaOdds`, `agendasUnseen`) | `corp/rez.ts` (runLoss, agendasUnseen, reachablePoints), `rezModel.ts`, `corp/placement.ts` (centralStake) |
| `corp/lines.ts` | the counted lines: `scoreInTwo`, `lineHolds`, `heldLaterStep`, `finishTurnStep`, `knownIncome`, `nextTurnCredits`, `scoringRemote`, `isCorpMain` | `corp/core.ts`, `corp/placement.ts`, `incomeLine.ts` |
| `corp/placement.ts` | `place`, `placePick`, the placement rules, `scoreInTwoPick` (Q5), `assetCover`, `mainRemote` | `corp/core.ts` (placePick, scoreInTwoPick), `corpAI.ts` and `iceValues.ts` (mainRemote) |
| `corp/rez.ts` | the rez during a run: `decideRez`, `countedRez`, `matchPointRez`, `rezStops`, `archivesWantsIce`, the run stoppers | `corpAI.ts` chooseRez (and through it search.ts) |
| `corp/core.ts` | `corpDecide`: Q0 to Q6 for the Normal and the Hard Corp | `corpAI.ts`, `search.ts` |

## Ranking debt, deleted by Stage C
Copies left untouched in Stage B because only the ranking (corpAI.ts rankMainActions and what it calls) reads them (brief rule 2):
- Hold count: `guards`, `iceDepth`, `fundedDepth`, `entryCost` with `protectionCost`, `breakerReach`, `outOfReach`, `exposureOk`, `hqNoSafer`, `lethalHqAgenda`.
- Rez money: `rezReserve` with `reservePenalty`, `moneyTargetPenalty`, the ice pacing gate, `unrezzedIceCost` (pacing and cast-while-able), the reserve penalty inside play scoring.
- Rezzes on the Corp's own turn: `rezValue`, `rezToUse`, `rezTimingBlocked`, `idleUpgrade` (reads `rezReserve`).
- Placement: installScore's per-server numbers and its two asset lines (econ asset in an iced remote, trap off the scoring remote), `iceFit`, `stopperPlacement`.

## Stage B2 grep (prompts.ts, decideRez, chooseRez, rezModel.ts)
Full table with labels: `/mnt/project-files/netrunner-ai/audit-fixes/stage-b/b2-rez-log.md`.
- `stopSpend`, `holdCost`: replaced by the owner (deleted).
- `countedRez`, `matchPointRez`, `rezStops`, `archivesWantsIce`, `decideRez`, `runStopper`, `leoGain`: moved to corp/rez.ts unchanged.
- countedRez's `ahead` sum over iceCreditNeed: replaced by the owner (`serverHold` 'thisRun', no rez, nothing further in; the same answer on 644 windows, 189 human and 455 deal).
- `serverImportance` and the run-stopper thresholds (`importance < 6`, `>= 7`): moved unchanged, debt Stage D.
- decideRez's legacy ice branch (`credits - cost < 2`, rezToll): moved unchanged, reached only with plan.modelRez off; goes when modelRez is folded.
- modelRezParts' stop test: labelled duplicate, kept as the price's input.
- prompts.ts `untaianPick` (`credits < 2`), the `credits < 4` choice, `freeRezSaving`'s affordability check: debt for D3 (prompts unchanged in Stage B).

## Runner
Not audited yet. A Runner audit fills these rows before any new Runner rule is added. Known from the 2026-11-05 audit, not re-checked: Runner card income on the slide was implemented four ways.

## How to use
- Writing a spec: list the rows the new code reads. If it needs a quantity that is not here, add the row and the owner in the same branch.
- Reviewing: grep the diff for a new computation of any row (new helper that sums rez costs, counts ice against a rig, or derives agenda odds). One found is "Changes needed".
- Fixing a row: lower the count and name the commit in "Fixed in". At 1, write "single".
