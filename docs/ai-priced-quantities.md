# AI priced quantities: one owner each

Rule (CLAUDE.md, "One owner per quantity"): each quantity below has one owning function. A branch may not add another computation of it. The "known duplicates" column may only go down. Reviews check this file against the diff; every code audit recounts it. Source of the first counts: `/mnt/project-files/audits/2026-11-13-ai-corp/report.md` (beta ef644c0).

## Corp
| Quantity | Owner (target) | Known duplicates 2026-11-13 | Audit finding | Fixed in |
|---|---|---|---|---|
| Rez money the Corp must keep | `rezMoney` (src/ai/corp/rezMoney.ts: `keep`, `byServer`, `unholdable`; `lineFloor` is its byServer sum), Step 4 Stage A | 8 left after Stage A (afterLineFloor folded into the owner): `reservePenalty`/`rezReserve`, `moneyTargetPenalty` (corpAI, the ranking: die in Stage C), the pacing gate and cast-while-able's `unrezzedIceCost` (ranking, Stage C), `scoringShort`, the horizon in `reservedForAgenda`, centralIce's rez gate (countedScore, Stage B3/B4), `boardNeed`, `rezBudget` (valuation layer, Stage B5) | AI-REZMONEY | Step 4 Stage A (owner), B and C (duplicates) |
| Does this server keep the Runner out (hold count) | `serverHold` (src/ai/corp/hold.ts: `holds`, `rez`, `rezCost`, `need`, `budget`, `margin`, `entries`; `when: 'runnerTurn'` was holdCost, `'thisRun'` was rezModel's stopCost; `holdCost` is now a one-line reader of it for ice lists), Step 4 Stage A | 7 besides the owner after Stage A (the audit's 8 less holdCost and stopCost, now one owner): `modelRezParts` `.stops` (rezModel, its own stop test inside the priced rez), the ranking's `guards`, `iceDepth`, `fundedDepth`, `entryCost` (with `protectionCost`, `breakerReach`, `outOfReach`), `exposureOk` (corpAI: die in Stage C), and `iceStop`/`lastingIceCost` (iceValues: prices, not verdicts, stay). Bioroid clicks still counted twice and encounter costs (Funhouse) still read as need 0: Stage D1, D2 | AI-HOLD-COUNT | Step 4 Stage A (owner) |
| Agenda odds (what an access is worth) | two pools: the Corp's own knowledge, `corpPools` and `stake` (src/ai/corp/pools.ts, Step 4 Stage A: `runLoss`, `reachablePoints`, `centralStake` and `rdAgendaOdds` moved there), and the Runner's view (not yet owned) | 5: the Corp pool is single (its three stake computations are fields of one owner; they still differ on purpose: `loss` is expected points by the odds, `points` the most one run can take; and on Archives `loss` counts facedown agendas only), plus the Runner-view four (`effectValues` agendaOdds/stealOdds, `evaluate`, `runs` x2) and the threat model's: Runner audit, by agreement (spec 1.6) | AI-AGENDA-ODDS | Step 4 Stage A (Corp pool) |
| Price of a game end | `sampledEndWorth` beside `flatlineWorth` (valueModel) | 3, but the sampled Runner reply no longer reads evaluate's ±1000 (Step 1, 004c789: a sampled end is ±pointValue(7) on the reply root's board). Left: ±1000 in evaluate (a certain end on the Corp's own line; and search.ts rollouts, which are sampled too: Step 3 or 4), `runLoss`, `flatlineWorth`. Open: what a NEAR sampled loss is worth (on the point clock a Runner win costs pointValue(7) less the Runner's points, 42 from 4 points, 15 from 6; deal 1321 T14), for the behaviour stage after the cleanup (spec stage D5 orders a game-ending access first rather than pricing it) | AI-TERMINAL-PRICE | Step 1 (sampled reply only) |
| Where a card is installed (placement) | `place` (src/ai/corp/placement.ts), Step 4 Stage A: written, applies today's rules in today's order, NOT yet called by any decision | 4 post-pick rewriters (`centralIce`, `iceRedirect`, `assetCover`, `assetPartner`, with `reservedForAgenda`), order copied in corpAI and search (Stage B4 deletes them); the install prompts' own targets (`freeInstallTarget` and four target blocks in prompts.ts: Stage D3); installScore's per-server numbers (Stage C1) | AI-PICK-PIPELINE | Step 4 (Stage A owner written) |
| A card held in HQ | by-card hand price (handValues) | 2 (flat 2.0/1.6 in the ranking, by card in the planner leaf) | AI-HAND-TWO-CURRENCIES | Step 5 |
| An advance on an unknown asset (bluff) | `placedCounterWorth` (effectValues) | 2 (flat 1.2 in corpAI) | AI-FLAT-NUMBERS | Step 5 |

## Step 4 Stage A owners (src/ai/corp/)
| File | Owner | Readers in play after Stage A |
|---|---|---|
| `corp/hold.ts` | `serverHold` (+ `runnerBudget`, `runnerMoney`, `CHECK`; `holdCost` reader) | `corp/lines.ts` (scoreInTwo, lineHolds), `corp/rezMoney.ts`, `countedScore.ts` (scoringShort, reservedForAgenda), `rezModel.ts` (matchPointRez, rezStops) |
| `corp/rezMoney.ts` | `rezMoney` (`keep`, `byServer`, `unholdable`; `lineFloor`, `stakedServers`) | `corp/lines.ts`, `countedScore.ts` (lineFloor only; `keep` has no reader in play) |
| `corp/pools.ts` | `corpPools`, `stake` (+ `runLoss`, `reachablePoints`, `centralStake`, `rdAgendaOdds`, `agendasUnseen`) | `corpAI.ts` (runLoss), `rezModel.ts`, `countedScore.ts` (centralStake) |
| `corp/lines.ts` | the counted lines: `scoreInTwo`, `lineHolds`, `heldLaterStep`, `finishTurnStep`, `knownIncome`, `nextTurnCredits`, `scoringRemote`, `isCorpMain` | `corpAI.ts`, `search.ts`, `incomeLine.ts`, `countedScore.ts` |
| `corp/placement.ts` | `place` | none in play (scripts/stage-a/tables.ts, tests/corpOwners.test.ts) |

## Runner
Not audited yet. A Runner audit fills these rows before any new Runner rule is added. Known from the 2026-11-05 audit, not re-checked: Runner card income on the slide was implemented four ways.

## How to use
- Writing a spec: list the rows the new code reads. If it needs a quantity that is not here, add the row and the owner in the same branch.
- Reviewing: grep the diff for a new computation of any row (new helper that sums rez costs, counts ice against a rig, or derives agenda odds). One found is "Changes needed".
- Fixing a row: lower the count and name the commit in "Fixed in". At 1, write "single".
