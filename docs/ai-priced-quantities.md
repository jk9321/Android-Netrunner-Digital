# AI priced quantities: one owner each

Rule (CLAUDE.md, "One owner per quantity"): each quantity below has one owning function. A branch may not add another computation of it. The "known duplicates" column may only go down. Reviews check this file against the diff; every code audit recounts it. Source of the first counts: `/mnt/project-files/audits/2026-11-13-ai-corp/report.md` (beta ef644c0).

## Corp
| Quantity | Owner (target) | Known duplicates 2026-11-13 | Audit finding | Fixed in |
|---|---|---|---|---|
| Rez money the Corp must keep | `rezMoney` (src/ai/corp/rezMoney.ts: `keep`, `byServer`, `rezIds`, `unholdable`; `lineFloor` returns keep since C6; `lineKeep`, the former `keepFloor`), Step 4 Stage A | **0 after Stage C: single.** The ranking's four (`rezReserve`/`reservePenalty`, `moneyTarget`/`moneyTargetPenalty`, the ice pacing gate with `unrezzedIceCost` and `ICE_PACING_INCOME`, cast-while-able) were deleted with the ranking (C7); the candidates read `keep` (line conditions and the behind group, corp/candidates.ts). Live but not counted, each with its reason: `boardNeed`'s board count for the Runner's view (valueModel.ts; the Runner's estimate of the Corp's need, a Runner-view quantity: the Runner audit); decideRez's legacy 2-credit reserve (corp/rez.ts, `credits - cost < 2`, only with plan.modelRez off). One floor (SB-TWO-FLOORS, C6): `lineFloor` reads `keep` as the placement rules do (0 of 7,765 agenda checks on 4,398 recorded states differ from the byServer sum, stage-c/c6-floor-log.md); the sum is still computed beside it, only for that log (`floorLog`), and changes no decision. `keepFloor` moved into the owner as `lineKeep` (review R4). The Corp's boardNeed reads keep through `corpPorts` and throws if the port is unset | AI-REZMONEY | Step 4 Stage A (owner), B (B3, B5), C (the ranking's four deleted; C6 one floor) |
| Does this server keep the Runner out (hold count) | `serverHold` (src/ai/corp/hold.ts: `holds`, `rez`, `rezCost`, `need`, `budget`, `margin`, `entries`; `when: 'runnerTurn'` was holdCost, `'thisRun'` was rezModel's stopCost), Step 4 Stage A. Stage B2 deleted the holdCost and stopSpend readers, replaced countedRez's own `ahead` sum with the owner (not the same count: the owner leaves out inner ice the run's bypasses skip, 6.5.8a, so it is right where they differ; they differ on 0 of 644 recorded rez windows) and fixed the owner's afford test (a legal rez paid another way: recurring credits, Biawak's forfeit) | **1 after Stage C**: `modelRezParts` `.stops` (rezModel, its own stop test inside the priced rez; labelled in stage-b/b2-rez-log.md, kept as the price's input). The ranking's copies (`guards`, `iceDepth`, `fundedDepth`, `entryCost` with `protectionCost`, `breakerReach`, `outOfReach`, `exposureOk`, and `hqNoSafer`/`lethalHqAgenda`) were deleted in C7; the candidates read `serverHold` (`holds`, `margin`, `entries`). `iceStop`/`lastingIceCost` (iceValues) are prices, not verdicts, and stay. Open owner bugs: bioroid clicks counted twice, encounter costs (Funhouse) read as need 0, an on-rez granted subroutine not seen (Diviner, report-18 #5): Stage D1, D2 | AI-HOLD-COUNT | Step 4 Stage A (owner), B2, C (the ranking's copies deleted) |
| Agenda odds (what an access is worth) | two pools: the Corp's own knowledge, `corpPools` and `stake` (src/ai/corp/pools.ts, Step 4 Stage A: `runLoss`, `reachablePoints`, `centralStake` and `rdAgendaOdds` moved there), and the Runner's view (not yet owned) | 5: the Corp pool is single (its three stake computations are fields of one owner; they still differ on purpose: `loss` is expected points by the odds, `points` the most one run can take; and on Archives `loss` counts facedown agendas only), plus the Runner-view four (`effectValues` agendaOdds/stealOdds, `evaluate`, `runs` x2) and the threat model's: Runner audit, by agreement (spec 1.6) | AI-AGENDA-ODDS | Step 4 Stage A (Corp pool) |
| Price of a game end | `sampledEndWorth` beside `flatlineWorth` (valueModel) | 3, but the sampled Runner reply no longer reads evaluate's ±1000 (Step 1, 004c789: a sampled end is ±pointValue(7) on the reply root's board). Left: ±1000 in evaluate (a certain end on the Corp's own line; and search.ts rollouts, which are sampled too: Step 3 or 4), `runLoss`, `flatlineWorth`. Open: what a NEAR sampled loss is worth (on the point clock a Runner win costs pointValue(7) less the Runner's points, 42 from 4 points, 15 from 6; deal 1321 T14), for the behaviour stage after the cleanup (spec stage D5 orders a game-ending access first rather than pricing it) | AI-TERMINAL-PRICE | Step 1 (sampled reply only) |
| Where a card is installed (placement) | `place` (src/ai/corp/placement.ts), Step 4: the rule bodies (`centralIce`, `iceRedirect`, `assetPartner`, `assetCover`, `reservedForAgenda`, `scoringShort`) and, since Stage C1, the fallback of spec 1.8 rule 3 where no counted rule applies. Since Stage C2 placement is inside generation: every install candidate is at `place`'s destination (corp/candidates.ts); `placePick` is gone | **1 listed duplicate after Stage C**: the four target blocks in prompts.ts (Stage D3). The prompts' port `freeInstallTarget` now reads the order and `place` (corp/candidates.ts, C1b), not installScore. Ranking debt: **empty** (installScore's per-server numbers and its two asset lines, `iceFit`, `stopperPlacement`, `iceTrashInstalls`, `withDeadIceTrashed` deleted; trash-first is `place`'s `trash` field, rule 8.5.6a). Planner debt: **empty** (`agendaCandidates`, `buildCandidates` and turnPlanner's destination filters deleted; the planner takes its K from the order through `plannerIntake`, with the agenda and build slots) | AI-PICK-PIPELINE | Step 4 Stage A (owner), B4 (bodies in), C (fallback, generation, prompts' port) |
| A card held in HQ | `ownHandValue` (handValues; valuation row V3), no winner picked in V-A | **5** (recounted by the valuation audit, AI-HAND-TWO-CURRENCIES; corrected in V-A, ai-value-owners): the by-card owner (`ownHandValue`, the planner leaf only), the flat `handValue` (every non-leaf Corp evaluate: the list's play values, the rez decision, `rezModel`, `scoreOutcome`), `keepValue` (discards, prompts), `hqTrashCardsLoss` (the hqTrashCost term on the tag-trash candidate, corp/candidates.ts `TRASH_RESOURCE`, pinned by report-22 T10) and `scoreOutcome`'s 0.5 x keep (prompts.ts). Locations and the stated comparisons: valuation row V3. Line 7's draw condition (corp/candidates.ts `drawFirst`) is a count, not a price. (Stage C's "2" counted only the leaf price and the hqTrashCost term: the flat went from the ranking's score function only) | AI-HAND-TWO-CURRENCIES | Stage C (the flat), Step 5 |
| An advance on an unknown asset (bluff) | `placedCounterWorth` (effectValues) | **0 after Stage C: single.** The flat 1.2 went with `advanceScore` (C7). The advance is a candidate (line 4): an asset in a server with fewer counters than `trapAdvanceCap` (corp/cardRules.ts), keyed by `placedCounterWorth` | AI-FLAT-NUMBERS | Stage C |

## Stage B: duplicate counts before and after (Step 4, branch ai-corp-untangle)
| Quantity | After Stage A | After Stage B | What went |
|---|---|---|---|
| Rez money the Corp must keep | 9 (8 when the pacing gate and cast-while-able count as one) | 4 (3 on that count; the ranking's, Stage C) | scoringShort, reservedForAgenda's horizon, centralIce's rez gate (B3), boardNeed (B5, the Corp's view) read `keep`; rezBudget reads the owner's holding rezzes for its order (B5; it moves a share on 35 of 1,644 human-game states) |
| Does this server keep the Runner out | 7 | 7 | holdCost and stopSpend (readers, not counted) deleted; countedRez's own `ahead` sum (found by the B2 grep, not counted before) replaced by the owner (which leaves out bypassed ice, 6.5.8a; 0 of 644 windows differ) |
| Agenda odds | 5 | 5 | none (the Corp pool was already single; the Runner view waits for the Runner audit) |
| Placement | 4 rewriters, their order copied twice, prompts, installScore | 1 (the prompts' freeInstallTarget, D3) plus ranking debt (installScore, iceTrashInstalls, withDeadIceTrashed) and planner debt (its destination filters), Stage C | the rewriters' bodies are in `place`; one placePick call in corp/core.ts; countedScore.ts deleted |

## Stage C: duplicate counts before and after (Step 4, branch ai-corp-core-c)
| Quantity | After Stage B | After Stage C | What went |
|---|---|---|---|
| Rez money the Corp must keep | 4 (all in the ranking) | 0 | the ranking's four, with the ranking (C7); one floor for the line (C6) |
| Does this server keep the Runner out | 7 | 1 (`modelRezParts`' stop test, kept as the price's input) | the ranking's six, and `hqNoSafer`/`lethalHqAgenda` (C7) |
| Agenda odds | 5 | 5 | none (the Runner view waits for the Runner audit) |
| Placement | 1 plus ranking debt and planner debt | 1 (prompts.ts' four target blocks, D3) | installScore and its helpers; the planner's destination filters; the prompts' port reads `place` (C1b) |
| A card held in HQ | 3 (the flat, the leaf's by-card price, the hqTrashCost term) | 2 | the ranking's flat 2.0/1.6 |
| An advance on an unknown asset (bluff) | 2 | 1 (the owner only) | the flat 1.2 |

## Step 4 owners (src/ai/corp/), after Stage C
| File | Owner | Readers in play |
|---|---|---|
| `corp/hold.ts` | `serverHold` (+ `runnerBudget`, `runnerMoney`, `CHECK`) | `corp/lines.ts` (scoreInTwo, lineHolds), `corp/rezMoney.ts`, `corp/placement.ts` (scoringShort, reservedForAgenda), `corp/rez.ts` (matchPointRez, rezStops) |
| `corp/rezMoney.ts` | `rezMoney` (`keep`, `byServer`, `rezIds`, `unholdable`; `lineFloor`, `stakedServers`) | `corp/lines.ts` (lineFloor), `corp/placement.ts` (keep: scoringShort, reservedForAgenda, centralIce), `valueModel.ts` boardNeed (keep) and `iceValues.ts` rezBudget (holdingRezIds), both through `corpPorts` |
| `corp/pools.ts` | `corpPools`, `stake` (+ `runLoss`, `reachablePoints`, `centralStake`, `rdAgendaOdds`, `agendasUnseen`) | `corp/rez.ts` (runLoss, agendasUnseen, reachablePoints), `rezModel.ts`, `corp/placement.ts` (centralStake) |
| `corp/lines.ts` | the counted lines: `scoreInTwo`, `lineHolds`, `heldLaterStep`, `finishTurnStep`, `knownIncome`, `nextTurnCredits`, `scoringRemote`, `isCorpMain` | `corp/core.ts`, `corp/placement.ts`, `incomeLine.ts` |
| `corp/placement.ts` | `place`, the placement rules and the fallback (spec 1.8 rule 3), `scoreInTwoPick` (Q5), `lineStep`, `assetCover` | `corp/candidates.ts` (every install candidate), `corp/core.ts` (scoreInTwoPick, lineStep) |
| `corp/candidates.ts` | Q7: `corpCandidates` (the ten lines of stage-c/order.md and the behind group), `sortCandidates`, `asRanked` (the position is the only number), `plannerIntake` (K, the agenda and build slots), `freeInstallTarget` (the prompts' port) | `corpAI.ts` (the Normal Corp, the planner's rollouts and the Runner reply's Corp), `search.ts` (the Hard Corp) |
| `corp/cardRules.ts` | the card-specific rules: `advancesAsIce`, `iceAdvanceValue`, `isPettyCash`, `overAdvance`, `trapAdvanceCap` (a codeHealth test lists the exports; the list only shrinks) | `corp/candidates.ts` |
| `corp/rez.ts` | the rez during a run: `decideRez`, `countedRez`, `matchPointRez`, `rezStops`, `archivesWantsIce`, the run stoppers | `corpAI.ts` chooseRez (and through it search.ts) |
| `corp/core.ts` | `corpDecide`: Q0 to Q6, then Q7 from the candidates, for the Normal and the Hard Corp | `corpAI.ts`, `search.ts` |

## Corp ports (src/ai/corpPorts.ts, Stage B review R8)
The one seam through which the valuation layer and prompts.ts reach a Corp owner. `corpAI.ts` fills it once as it loads (`registerCorpPorts`), and an unset port throws. The ports are readers of the owners, not copies, and are not counted as duplicates. There are exactly four: `keep` and `holdingRezIds` (corp/rezMoney.ts; valueModel boardNeed, iceValues rezBudget), `perfectRecallTarget` (corp/rez.ts; prompts.ts), and `freeInstallTarget` (corp/candidates.ts since Stage C1b: the order's first install at `place`'s destination; prompts.ts). Stage D3 moves the prompts' four target blocks onto it. The board-only helpers `mainRemote` and `withIceInstalled` live in the leaf `src/ai/board.ts`. Guards (tests/codeHealth.test.ts): corp/ is in no value-import cycle; the largest cycle in src/ai is at most 16 modules (29 before R8, 27 at beta 545f146); outside corp/, only corpAI, search, index, incomeLine (knownIncome) and rezModel (corp/pools) import it; the ports are these four.

## Ranking debt, deleted by Stage C
**Empty.** Everything listed here at Stage B was deleted with the ranking in Stage C7 (hold count, rez money, the Corp's own-turn rezzes, placement), and the planner's destination filters with Stage C3. The own-turn rez test moved to corp/rez.ts (`rezTimingBlocked`, the structural half of `rezValue`, `rezToUse`, `clickOnly`): its money test reads `keep`, and its worth test reads the valuation model (`rezzedWorth` above the rez cost).

### Hand-set numbers that survive in corp/ (by name, with the stage that removes them)
The ranking's numbers (about 94) are gone. Line numbers (1 to 10, the behind group's 100 + line) are positions in the order, not values. Numbers set by the rules (2 clicks for an install and an advance, 7 points) are not listed. What is left:
- `corp/candidates.ts`: the Corp's own prompts are followed three steps when a play is valued (as `playScore` did; Stage D or tuning). The planner intake's two caps (at most two candidates per line, two placements per card) are spec 1.3's, not tuned.
- Per-card rules outside cardRules.ts (audit SC-PERCARD-SCOPE): the five card-coded run stoppers in `corp/rez.ts`, there since Stage B2 and counted with lever 5 from the Stage C checkpoint on.
- `corp/cardRules.ts`: `overAdvance`'s excess under 2 (Stage D); `trapAdvanceCap`'s Clearinghouse cap of the grip + 1 between 3 and 6, and 3 for other traps (Stage D).
- `corp/rez.ts`, the rez during a run (moved unchanged in Stage B2; debt for Stage D):
  - `serverImportance`: 10, or 7 + 1.5 x `agendaStakes`, for a root agenda; HQ 3 + the stakes of its agendas; R&D 4; Archives 6 or 0.5; 3 for a rezzed money asset; 2 or 0.5 otherwise.
  - `agendaStakes`: the points, + 3 at match point, + 0.25 per counter up to 4.
  - The run-stopper thresholds (`importance < 6`, `>= 7`).
  - decideRez's legacy scores: 2 + gain, the 2-credit reserve under importance 4, Spin Doctor 3.
  - The three prompt steps of its own simulation.
  - `WIN = 7` is the rule, not a tuned number.
- `corp/hold.ts`: the caps of 10 on the combinations tried (a bound on compute time, not a value).

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
Filled from the Runner audit (`/mnt/project-files/audits/2026-11-14-ai-runner/report.md`, beta 922dbca), branch `ai-runner-fixes`. Lines were at 922dbca; line numbers are dropped from the rows touched by ai-runner-unknowns (they drift; search the name). Recounted against the 2026-11-15 audit (`/mnt/project-files/audits/2026-11-15-ai-runner-merged/report.md`, RM-REGISTRY-RUNNER). No new Runner rule may add a computation of these rows.

| Quantity | Owner (target) | Known duplicates 2026-11-14 | Audit finding | Fixed in |
|---|---|---|---|---|
| Cost to get past one ice | `icePrice` (src/ai/runs.ts, ai-runner-fixes): `{ credits, value }`, credits paid apart from the value lost (subroutines let through, a bioroid's clicks, counters and cards a break spends); `iceCost` is its total. `BreakPlan` carries the same split (`credits`, `value`, `planCost`) | Before ai-runner-fixes: 2 per-ice functions (`iceCost`; `iceCreditNeed` :368, ETR credits only); their sums written 7 more times: `runScore` :916-941, `runShortfall` :844-858 (own flat Manegarm 5 at :856), `runCreditSpend` :864-877, `runRestWorth` :950-965, `stealTax` :610, `creditsAhead`/`iceCreditsAhead` :392-411, the encounter's budget (runnerAI.ts:146-153); plus `bypassSkips` (prompts.ts:481-477). `bestBreakPlan` prices counters and discards inside `.credits` (Lobisomem :273, Audrey :288, Hantu :303, Mayfly :321). After: the break plans' counters and discards are `value` (fixed); `runScore`, `runRestWorth`, `runShortfall` and `stealTax` budget `icePrice(...).credits` (fixed for those four); left: `iceCreditNeed` (ETR credits), `runCreditSpend`, `creditsAhead`/`iceCreditsAhead`, the encounter budget, `bypassSkips`, and the flat unrezzed 1.5/0.5 (RUNNER-UNREZZED-FLAT, not touched). A bioroid's click stays a flat 1.5 (`runClick` reads the grip's draws, which read this price: a value loop) | RUNNER-BUDGET-UNITS, AI-RUNNER-NONCREDIT-BREAK-COST, RUNNER-UNREZZED-FLAT | ai-runner-fixes (credits apart from value; break plans) Also counted (2026-11-15 audit): `passOdds` (effectValues.ts, the Corp's steal odds) sums its own per-ice `iceCost` and compares credits plus value with the Runner's credits (RM-PASSODDS-UNITS, the Corp's work after Stage C). ai-runner-unknowns: an unrezzed ice's damage risk is `unrezzedDamageRisk` (runs.ts; the ice still unseen in the decklist, read by `runScore` and `runRestWorth`), its credits are still the flat 1.5/0.5 |
| What an access is worth (steal) | `stealWorth` (src/ai/runs.ts:705) | 2: `stealWorth`; `accessWorth` (effectValues.ts:323, no deny share) | RUNNER-ACCESSWORTH-TWO | |
| Accesses a run makes (breach) | `serverValue`'s `extraAccesses` (src/ai/runs.ts); breach-time accesses from the rig: `breachAccesses` (runs.ts, reads `CardAI.breachAccess` and the counter's `counterWorth`) | Before: `runRestWorth` ignored `run.extraAccesses`; `runScore` read extra accesses only from `RunOptions`, never from the rig (Devadatta Drone, #54). After: both read them (single) | RUNNER-BREACH-EXTRA-ACCESS | ai-runner-fixes (single) |
| Agenda odds, Runner view | one Runner-view pool (not yet named) | 5: `agendaOdds` (effectValues.ts:279, centrals, pool includes installed ice), `remoteAgendaOdds` (runs.ts:712, plus `iceBump` :554), `hiddenCardOdds` (evaluate.ts:215, board), `hqAgendaOdds` (runs.ts:793, known HQ cards), `rdWorth` (runs.ts:734, known R&D cards); plus `trapOdds` :512 / flat 1/3 :652 and Archives' 0.05/0.1 :586-591. Two points averages: `agendaOdds.points` (whole decklist) and `hiddenCardOdds.agendaPoints` (unseen, off path) | RUNNER-AGENDA-POOLS | |
| Income on the slide | `payoutSlide` (src/ai/valueModel.ts:449); spending priced by `creditCost` (runs.ts:189, the `creditSlide` difference) | single owner. Readers: evaluate.ts:139, handValues.ts:62, cards/systemGateway.ts:90 (Fermenter, own bank factor). Run-success credits flat unless the off switch `runCreditsSlide` (runs.ts:1168) | (AI-INCOME-SLIDE, fixed) | single |
| Runner income per turn | none yet (a measured Runner income) | 2: `RUNNER_TURN_INCOME = 4` (src/ai/iceValues.ts:27, read by `iceStop` and evaluate.ts `threatStanding`), and the Corp hold count's Runner money (src/ai/corp/hold.ts) | Gemini (merged report) | |
| A card in the grip | `ownHandValue` (handValues; valuation row V3) | **6** (corrected in V-A; the valuation audit said 7, counting `hqTrashCardsLoss`, which prices HQ cards only): the owner (planner leaf), the flat `handValue` (every non-leaf evaluate), `keepValue` (discards), `scoreOutcome`'s 0.5 x keep (prompts.ts), `lifeCards` (takes the owner's first-three extra back out), `digValue` on a draw (runnerAI.ts, valuation row V17). Locations: valuation rows V3 and V17 | AI-HAND-TWO-CURRENCIES (Runner side), RUNNER-DRAW-STACK | |
| A tag | `tagsWorth` (src/ai/evaluate.ts:473) | 3: `tagsWorth`, `tagCost` (runs.ts:203, its difference), flat `REMOVE_TAG` 1.2/0.3 (runnerAI.ts:264). Corp and Runner differ by `tagTrashNow` (Jeff's decision) | RUNNER-TAG-TWO-PRICES | |
| Damage taken | `damageWorth` (src/ai/effectValues.ts:334) | 3: `damageWorth` (in a run, no draw-back), the board's damage clock (evaluate.ts:590-592, with draw-back), `runScore`'s empty-grip term (runs.ts:899-900); plus trap damage `2 + advancements` (runs.ts:680); core damage `coreDamageWorth` (effectValues.ts:483). Lethal tests at runs.ts:88/91/103/125 used `>=` (rule 10.4.4: more than the grip). After: the lethal tests use `>` (fixed); `damageWorth` reads the Runner's clicks left to draw back on its own turn (5.2.7c), as the board's damage clock does; the empty-grip term, trap damage and core damage are left (3 still). ai-runner-unknowns: trap damage is no longer the flat `2 + advancements`; an unknown card's access damage is `trapHit` (runs.ts), the access damage (`accessDamage`, effectValues.ts, card text) of each trap still unseen in the decklist, through `damageWorth` at the grip at the access; `needsBiggerHand` reads `trapDamageMax` from the same pool (the "plus" list drops trap damage; core damage is left). BANGUN's 2 meat damage now reads the grip at the access. The SUB_RULES flats "unless the Runner suffers N net damage" (2 a point) and "at least 2 tags" (4) are now `damageWorth` (RM-SUBDAMAGE-TEXT). The draw-back's clicks are one count, `drawBackClicks` (effectValues.ts), read by `damageWorth` (paid, CLICK each) and `lifeGrip` (free draws outside a run) (RM-DRAWBACK-TWO), and the run choice on the Runner's own turn reads it too (RM-DRAWBACK-RUN-START). `damageWorth` also takes the grip the damage lands on (`grip` input; a steal or trap at the access, after the ice's damage) | RUNNER-DAMAGE-NO-DRAWBACK, AI-RUNNER-LETHAL-DAMAGE-OFF-BY-ONE | ai-runner-fixes (lethal test, draw-back) |
| Whether letting an ice's subroutines resolve flatlines the Runner | `tankDamage` (src/ai/runs.ts): the damage the unbroken subroutines do one at a time in printed order with the tags given on the way, and the first at which the total is more than the grip. Rules 9.8.7b, 10.4.4 | 2 (2026-11-15 audit counted 3): `tankDamage`, read by `plainIcePrice` (the run's price: a lethal tank is no way past) and `encounterAction` (runnerAI.ts: the lethal subroutine must be broken, as one that ends the run). `canTank` (effectValues.ts, the Corp's view behind passOdds) reads it since ai-runner-unknowns; left: corpAI's `tankCost` (per-subroutine lethal only; dies with the ranking in Stage C). Each subroutine's own `subroutineCost` lethal test is still per subroutine | AI Coordinator review 2026-11-15 (R1 flatlines) | ai-runner-fixes |
| Damage an agenda does when stolen | `stealHit` / `knownStealHit` (src/ai/runs.ts, read by `serverWorth` for every access), from `agendaOdds(...).onSteal` (effectValues.ts: the steal damage of each agenda not yet scored or stolen, decklist; `stealDamage` reads the card text) and priced by `damageWorth` at the grip the Runner holds at the access (`grip` input: the grip less the damage of the rezzed ice it lets resolve, `icePrice(...).damage`), no draw-back. Rules 1.17.3d (an accessed agenda must be stolen), 10.4.4 | single (new, ai-runner-fixes review R1: Fujii Asset Retrieval at 1 card). The Corp's own score-time damage is `synergy.gives.damage` on the card entry (cards/liberation.ts), a separate Corp reading | AI Coordinator review 2026-11-14 | ai-runner-fixes |
| Worth of trashing a Corp card (denial) | the card's worth from the Corp's side (`corpCardValue`, evaluate.ts), read by `serverValue` (runs.ts); the Runner's trash-or-leave reads it with `left = true` (`corpCardValue(card, state, 'runner', true)`: the payout still to come on the card, `payoutWait`'s `left` input, not the whole card from a fresh install). The Corp's default path (`left` false) is unchanged. Stage D's D9 (economy assets in the Corp's rez money) reads the same owner with `left` | 1 reader with a 0.5 floor and the Runner's trash price taken off on the Runner's slide | RUNNER-ASSET-TRASH | ai-runner-fixes (`left` input) Readers with `left`: `serverWorth`'s two trash lines and `chainReactionBonus` (runs.ts, since ai-runner-unknowns). Still on the default (2026-11-15 audit, RM-DENIAL-TWO-WAYS): Chain Reaction's payoff in cardPlans.ts (outside the branch's files) |
| A game end | `flatlineWorth` / the point clock (valueModel.ts `flatlineWorth`, `pointValue`; valuation row V13) | 3: ±1000 in `evaluate` (evaluate.ts `evaluate`, the Runner planner's leaf when a line ends the game), `flatlineWorth` (damage, effectValues.ts `damageWorth`), a game-winning steal priced by `stealWorth` on the point clock. No Runner-side `sampledEndWorth` | (Corp row's Runner half) | |
| Where the Runner will run (next turn) | not decided: the next Runner branch picks it | 2: the Runner's own `runScore` (runs.ts) and the threat model's run bar (src/ai/threatModel.ts, the Corp's prediction of the Runner's next turn). They disagree since ai-runner-fixes R1 (bug report #15, tests/threatModel.test.ts, now `it.fails`: `runScore` gives HQ -0.54 and the Runner runs R&D only; the run bar budgets HQ at -0.26 and predicts R&D then HQ) | (ai-runner-fixes, AI Coordinator 2026-11-14) | |
| Where a program or resource goes | the install's own outcome (`evaluate`) | 3: `makeRoomInstalls` (runnerAI.ts:391), `trojanHostValue` (runnerAI.ts:380, flat host price), the generic prompt answer (prompts.ts:444-460) | RUNNER-FLAT-NUMBERS | |
| The Runner's estimate of the Corp's need (credits to rez what guards the centrals and the agenda remotes) | `boardNeed`'s Runner branch (src/ai/valueModel.ts; ai-honest-runner-view): an unrezzed ice the Runner can't see costs `corpIceMean` (the decklist's mean ice cost, which `buildTarget` reads too); a remote counts by the chance it holds an agenda, `remoteAgendaOdds` (runs.ts, through the `setRunnerAgendaOdds` port that evaluate.ts fills; trap input at the no-memory value; several facedown root cards: one minus the product of the misses) | single. Known gaps, recorded: public rez-cost modifiers (Tread Lightly, Fransofia Ward) are not applied to an unknown ice; the agenda odds don't read the Runner AI's memory (a remote it accessed and saw an asset in still counts as maybe-agenda; less informed, not a leak) | VAL-RUNNER-BOARDNEED | ai-honest-runner-view |
| The Runner's guess of the Corp's hidden cards (which Corp card is where, for a view) | `runnerUnknownSlots` + `dealRunnerUnknowns` (src/ai/runnerReply.ts; ai-honest-runner-view): unrezzed ice, facedown root cards not seen, unknown HQ, R&D outside known slots, facedown Archives; read by `guessRunnerView` (the deciding Runner's view), the Hard AI's `determinize` (search.ts) and the Runner's prompt guard (runnerAI.ts) | single (determinize's own deal was lifted into the owner). Known gap, recorded: an R&D card the Runner knows only by range (knownInRd lo < hi) or with `left` may be dealt out of R&D | VAL-OPP-DECK-AVERAGE (Runner half) | ai-honest-runner-view |
| The Corp's unseen pool (cards the Runner can't see) | `unseenCorpPool` (src/ai/evaluate.ts; ai-honest-runner-view): HQ, R&D, facedown Archives, facedown installed root cards; read by `hiddenCardOdds` and the tag-punisher share (tagLoss) | the run model's `unseenTraps` (runs.ts) and `remoteAgendaOdds`'s off-path pool build their own list (2, not yet moved: runs.ts was outside this branch) | VAL-RUNNER-TAG-POOL | ai-honest-runner-view (the punisher share) |

<!-- valuation:start -->
## Valuation (Stage V-A, branch ai-value-owners)
Source: the valuation audit (`/mnt/project-files/audits/2026-11-16-ai-valuation/report.md`, Q1 and VAL-REGISTRY-GAPS), the V-A brief rev 2 and its red-team rulings (`/mnt/project-files/netrunner-ai/valuation-cleanup/brief-stage-va-owners.md`, `/mnt/project-files/adversarial/2026-11-16-stage-va-owners/findings.md`). V-A names one owner per quantity and records every second computation; it changes no number. **V-A builds no new function** (ruling 5): each owner is an existing function with a doc comment saying "Owner of ...". The renames and wrappers the audit proposed (`creditWorth`, `clickWorthOf`, `handCardWorth`, `deckCardWorth`, `effectOverTurns`, `corpCardWorth`) wait for V-B, when the readers' files are open. From here the copy counts in this section may only go down.

How it is checked:
- Every location below is written as `NAME` (`path:line`); `node scripts/value-owners/verify-registry.mjs` fails if a line no longer holds its name (`--fix` moves it to the nearest line that does).
- The disagreement log (`scripts/value-owners/log.ts`, on `ai-script.yml`) evaluates each copy beside its owner on sampled boards, with the comparison stated below. Its output is the evidence V-B is specified from (`/mnt/project-files/netrunner-ai/valuation-cleanup/stage-va/`).
- Every owner and every copy in the eight valuation files hands the value it priced, unchanged, to `logValue` (`src/ai/valueModel.ts:475`), which passes it to the diagnostics sink's `onValue` (`src/ai/diagnostics.ts:60`). The sink is null in play.
- `tests/codeHealth.test.ts` "every valuation export has a reader in src": the exports of the eight valuation files with no reader are an allow-list that may only shrink (VAL-DEAD; for V-B and Jeff).

"Comparable" means the log maps the copy's inputs onto the owner's and both answer in the same unit (credits of worth to the side named); the mapping is written in the row. "Not comparable" means the copy prices a different quantity; it then has its own row below (ruling 4e). "Asks counted" means the copy sits in one of the eight valuation files and the log counts how often it is asked; a copy elsewhere is evaluated at the owner's sampled boards and its static call sites are given (ruling 4a).

### Summary
| # | Quantity | Owner today | Copies (live) | Comparable copies | Readers in src |
|---|---|---|---|---|---|
| V1 | A credit (either side's, as the viewer prices it) | `sideCreditValue` | 0 live + 1 dead (+ run credits at face value, recorded for the Runner cleanup) | 0 | 3 |
| V2 | A click | `clickPrice` | 3 (flat `CLICK` in played worth and keep, `payoutClick`, `clickRate`) + 61 raw `CLICK` reads (29 outside cards/, 32 in cards/; recount) | 3 | 2 |
| V3 | A hand (Corp HQ, Runner grip) | `ownHandValue` (card input `heldWorth`) | HQ 4, grip 5 | 4 | 1 |
| V4 | A card drawn from a deck | `cardRate` (via `drawWorth`) | 3 (1.6, `drawBonus`, Jailbreak's flat) + 1 dead (+ a second entry point) | 3 | 13 + 27 in cards |
| V5 | Installed ice | `iceWorth` | 2 | 2 | 3 |
| V6 | An installed agenda | `agendaWorth` | 1 | 1 | 3 |
| V7 | A tag (Corp and Runner views) | `tagsWorth` | 7 (+ `REMOVE_TAG`, not comparable) | 7 | 7 + 1 in cards |
| V8 | n damage (Corp and Runner views) | `damageWorth` | 1 (`runScore`'s empty-grip term, Runner row) | 0 | 15 + 11 in cards |
| V9 | A counter | `counterWorth` | 1 | 1 | 3 + 2 in cards |
| V10 | An effect over turns (a card's income or effect paid turn by turn) | `payoutWorth` + `payoutWait` + `turnsLeft` | 1 (`perTurn`, 83 call sites) + the owner's own bare/iced split | 1 | 4 |
| V11 | A Corp card's worth on the board | `corpCardValue` | 2 | 1 | 6 |
| V12 | A Corp card's worth before it is installed | `corpKeepValue` | 4 (+ the owner's own iced split, V10) | 4 | 6 + 1 in cards |
| V13 | A game end | `flatlineWorth`, `sampledEndWorth` (rows above) | 0 (the +-1000 is a sentinel) + 1 dead | 0 | 6 |
| V14 | Hosted credits on a Corp card | `countersWorth` (type credit) | 2 | 2 | 1 |
| V15 | A Runner rig card's worth installed | `runnerCardValue` | 2 | 2 | 2 |
| V16 | A Corp click spent advancing (what it could have built) | `AGENDA_CLICK` | 0 | n/a | 1 |
| V17 | Digging for an answer (a draw's extra worth) | `digValue` | 1 (`needsBiggerHand`'s 1.5) | 0 | 2 |
| V18 | The Runner's standing flatline exposure (the board's damage clock) | `flatlineOdds` x `flatlineWorth` + `lifeCards` | 0 | n/a | 1 |
| V19 | A hand slot lost to core damage | `coreSlotWorth` (`coreDamageWorth` for one more) | 0 | n/a | 3 |
| V20 | The Corp's damage threat (biggest hit, share of damage cards) | `damageThreat` | 0 (`cardDamage` and `ownTurnDamage` are its two readings, by `plan.corpTurnDamageOwn`) | n/a | 2 |
| V21 | A point on the clock | `pointValue`, `pointGain` | 0 (`pointsTerm` reads it) | n/a | ~55 |
| V22 | Icebreaker coverage in the rig (an ice type broken) | `breakerTypeWorth` | 0 | n/a | 1 |
| V23 | An agenda lost to Archives | `archivedAgendaLoss` | 0 | n/a | 5 |
| V24 | A memory unit | `muWorth` | 0 | n/a | 14 in cards |
| V25 | An advancement counter on ice | `iceAdvanceWorth` | 0 | n/a | 1 |

Counts at the branch head (scripts/value-owners/counts.mjs): see "Counts" at the end of this section. Since V-B B1 the copy count is the number of `live` lines in "Copy lines" below, not the "Copies (live)" column, which is prose (recount VA-COPY-COUNT-BASELINE: three of its numbers were higher than their rows, and it counted not-comparable items).

### V1. A credit
- **Owner:** `sideCreditValue` (`src/ai/valueModel.ts:426`): a side's credits on the credit slide against its need, as `viewer` prices them. Parts: `creditSlide` (`src/ai/valueModel.ts:102`), `creditNeed` (`src/ai/valueModel.ts:375`) = max of `buildTarget` (`src/ai/valueModel.ts:298`) and `boardNeed` (`src/ai/valueModel.ts:324`); the Corp's own view adds `moneyReach` (`src/ai/valueModel.ts:389`) and `BROKE_SLOPE` (`src/ai/valueModel.ts:423`).
- **Copies:** `creditValue` (`src/ai/valueModel.ts:72`), dead (re-exported at `creditValue` (`src/ai/evaluate.ts:22`), no reader). Comparable: `creditValue(credits)` against `sideCreditValue(state, side, viewer)` at the same credits; credits. Not copies: `payoutSlide` (`src/ai/valueModel.ts:449`) and `creditCost` (`src/ai/runs.ts:189`) read the slide (readers); hosted credits are V14; a payout still to come is V10.
- **Readers:** `sideCreditValue` (`src/ai/evaluate.ts:603`), `sideCreditValue` (`src/ai/evaluate.ts:615`), `sideCreditValue` (`src/ai/threatModel.ts:400`).
- **Caches, context:** `buildTargets` and `iceMeans` (`src/ai/valueModel.ts:269`), keyed by game id and identities (a decklist number, once per game). `boardNeed` reads `actingSide` (the deciding Corp reads rez money's `keep` through `corpPorts`; the Runner's view reads `remoteAgendaOdds` through its port).

### V2. A click
- **Owner:** `clickPrice` (`src/ai/handValues.ts:346`): a side's own click by the best plays in its hand (`clickWorth` (`src/ai/handValues.ts:309`), 1 to 3) where `plan.clickByPlay` is on for the viewer (Runner on, Corp off), else the flat `CLICK` (`src/ai/valueModel.ts:93`) 1.25.
- **Copies (all the flat `CLICK`):**
  - `playedWorth` (`src/ai/handValues.ts:30`) charges `CLICK` once per card it prices (every branch but an event's or operation's), and `keepValue` (`src/ai/evaluate.ts:641`) adds it back. Asks counted (the `playedWorth` hook). Comparable: `CLICK` against `clickPrice(state, card's side, deciding side)` on the same board.
  - `payoutClick` (`src/ai/valueModel.ts:95`): the click a payout takes, inside `payoutWorth`. Asks counted. Comparable only through the constant: `payoutWorth` has no board, so the log compares `CLICK` with the owner's distribution on the boards where the payout's card is priced.
  - `clickRate` (`src/ai/valueModel.ts:94`): read by `runClick` (`src/ai/runs.ts:200`) when no state is given, and by card formulas. Asks counted. Comparable as `payoutClick`.
  - 40 more raw `CLICK` reads in src/ai outside cards/ and 36 in cards/ (the tag clear `CLICK + 2`, `damageWorth`'s draw-back, `vicTagsWorth`, Syailendra's step, formulas): each a click priced at the flat rate. Counted, not listed one by one; V-B decides which are "a click" and which are the rules' cost of an action.
- **Not a copy:** `AGENDA_CLICK` is V16 (a different quantity: what an advancing click could have built).
- **Readers:** `clickPrice` (`src/ai/evaluate.ts:581`), `clickPrice` (`src/ai/runs.ts:200`).
- **Caches, context:** `clickCache` (`src/ai/handValues.ts:343`): pricingKey, side, game, turn, clicks, credits, the hand's ids and the board fingerprint, kept to one game (`scopeToGame`); its key leaves out what the decks hold, so a hit can be another board's (AI-CACHE-HIDDEN-STATE). Context: `plan.clickByPlay`, the pricing key.

### V3. A hand (a card in HQ, a card in the grip)
- **Owner:** `ownHandValue` (`src/ai/handValues.ts:280`), both sides: the best `limit` cards by held worth, the first over the limit as a filter, the first three with the `handCore` extra; an unseen card (drawn in a look-ahead) is a deck card (V4). Its card-level input is `heldWorth` (`src/ai/handValues.ts:101`) (played worth x `SOON`, at least `HAND_FLOOR`). Which price a board uses is a switch, and part of this row: `handAndClicks` (`src/ai/evaluate.ts:570`) reads `ownHandValue` where `handByCard` (`src/ai/handValues.ts:298`) is on (the planner's leaves, `leafHandByCard`; `plan.handByCard` is off for both sides), and the flat `handValue` everywhere else. So **the flat is the price every non-leaf evaluate uses** (the list's play values, the rez decision, `rezModel`, `scoreOutcome`; AI-HAND-TWO-CURRENCIES).
- **Copies:**
  - `handValue` (`src/ai/evaluate.ts:39`): 2 for each of the first 3 cards, 1.6 to the limit, 0.3 for the first over. Asks counted. Comparable: `handValue(hand - reached, limit, viewer)` against `ownHandValue(state, side)` on the same board, the whole hand in credits (both leave out the money card `moneyReach` already prices: the flat drops it, the owner floors it).
  - `keepValue` (`src/ai/evaluate.ts:637`), per card (discards, prompts): played worth plus the click, at least the floor, plus an agenda's Archives loss. Asks counted. Comparable per card: `keepValue(card)` against `heldWorth(card)` (no `SOON` discount in the copy).
  - `hqTrashCardsLoss` (`src/ai/evaluate.ts:589`), Corp: the k smallest `keepValue - CLICK` for a resource trash that costs HQ cards. Asks counted. Comparable: against `ownHandValue(hq) - ownHandValue(hq less the k cards it picks)`.
  - `scoreOutcome`'s `0.5 * (sumKeep` (`src/ai/prompts.ts:46`), both sides: 0.5 x the summed `keepValue` of the cards that left the hand. Asks not counted (prompts.ts; 1 site). Comparable per card: `0.5 x keepValue(card)` against `heldWorth(card)`.
  - Grip only: `lifeCards` (`src/ai/evaluate.ts:597`) takes the `handCore` extra back out of the Runner's side (the damage clock, V18, replaces it). Asks counted. Comparable: `lifeCards(n)` against the extra the owner adds, `min(n, 3) x (handCore - drawnCard)`: equal by construction, so the pair is two terms for nothing (VAL-CANCEL-TERMS).
  - Grip only: `digValue` (`src/ai/evaluate.ts:58`) on a draw is V17 (not comparable: a draw's extra, not a card held).
- **Counts:** HQ 5 prices (the owner, `handValue`, `keepValue`, `hqTrashCardsLoss`, `scoreOutcome`), grip 6 (the owner, `handValue`, `keepValue`, `scoreOutcome`, `lifeCards`, `digValue`; the audit's 7 counted `hqTrashCardsLoss`, which prices HQ cards only). The rows "A card held in HQ" (Corp table) and "A card in the grip" (Runner table) above point here.
- **Readers:** `ownHandValue` (`src/ai/evaluate.ts:578`); `heldWorth` (`src/ai/evaluate.ts:151`) (hosted cards on Bling and Madani), `heldWorth` (`src/ai/handValues.ts:203`) (the deck average). The flat: `handValue` (`src/ai/evaluate.ts:579`), `handValue` (`src/ai/corp/candidates.ts:185`).
- **Caches, context:** none of its own; an unseen card reads V4's caches. Context: `pricing().known` (which cards the decider has seen), `leaves` (the by-card switch), `plan.oracle.rd` (`corpKnowsRd`), `averaging` (no card plans inside the deck average).

### V4. A card drawn from a deck
- **Owner:** `cardRate` (`src/ai/valueModel.ts:206`), through the hook `setDeckCard` (`src/ai/handValues.ts:273`) to `drawWorth` (`src/ai/handValues.ts:173`): the average held worth of the cards left in the side's deck; the flat `RATES.drawnCard` 1.6 while that average is being worked out (`averaging`). On a Corp decision's planner playouts the deck cards are priced once on the decision's root (`rootDeckAverage` (`src/ai/handValues.ts:232`)).
- **Two entry points that disagree:** `ownHandValue` (`src/ai/handValues.ts:288`) and `clickWorth` (`src/ai/handValues.ts:327`) call `drawWorth` directly, without the hook's `averaging` guard, so inside an average they compute a real average where `cardRate` gives 1.6 (ruling 6). The log counts both and compares them under `averaging`.
- **Known leak (rule 10.2.2a):** the owner reads the real deck: the Corp prices the Runner's real stack, the Runner the real R&D (VAL-OPP-DECK-AVERAGE). It takes no viewer; none is added in V-A (ruling 6).
- **Copies:**
  - The flat 1.6 per card beyond the first three in `handValue`, `DRAWN_CARD` (`src/ai/evaluate.ts:40`): the non-leaf price of a drawn card. Asks counted (the `handValue` hook). Comparable: 1.6 against `cardRate(state, side)` on the board where the hand is priced.
  - `drawBonus` (`src/ai/cardValues.ts:33`): `RATES.cardDrawn` 0.5 for each card a card's `draws` field says it draws, added to its flat worth. Asks counted. Comparable: 0.5 against `cardRate(state, the card's side)`.
  - `topDownWorth` (`src/ai/effectValues.ts:613`), dead (tests only); a reader of the owner, not a copy.
- **Readers:** 16 outside cards/: `cardRate` (`src/ai/effectValues.ts:341`), `cardRate` (`src/ai/effectValues.ts:475`), `cardRate` (`src/ai/effectValues.ts:506`), `cardRate` (`src/ai/cardProfiles.ts:121`), `cardRate` (`src/ai/evaluate.ts:139`), `cardRate` (`src/ai/evaluate.ts:174`), `cardRate` (`src/ai/evaluate.ts:193`), `cardRate` (`src/ai/evaluate.ts:194`), `cardRate` (`src/ai/cardPlans.ts:112`), `cardRate` (`src/ai/cardPlans.ts:135`), `cardRate` (`src/ai/prompts.ts:379`), `cardRate` (`src/ai/handValues.ts:44`), `cardRate` (`src/ai/handValues.ts:63`); and 27 calls in cards/ (every Corp formula's `card` input through `corpEffect`, counters, Runner formulas).
- **Caches, context:** `deckAverage` (`src/ai/handValues.ts:136`): pricingKey, side, game, turn, the side's credits, the board fingerprint, the deck's ids and codes; one game; incomplete (zones by size only), about 6% of hits another board's (`drawAudit`). `anchor.deckValues` (`rootDeckAverage`): per decision, pricingKey and side, then the card. Context: `averaging`, `pricingRootDeck`, `frozen`, `anchor`, `plan.oracle.rd`.

### V5. Installed ice
- **Owner:** `iceWorth` (`src/ai/iceValues.ts:51`): rezzed, the base `RATES.ice` plus what the Runner pays to get past it (capped at `iceStop`) times the share of it the server's stake supports (Corp view, `protects`); unrezzed, the Runner's guess (`iceCost`'s unrezzed price) or, for the Corp, the rez budget's share of it.
- **Copies:**
  - `flatIceWorth` (`src/ai/iceValues.ts:236`), the loop fallback (`RATES.ice` + 0.6 x the rez cost): a second price, served when `guardLoop` meets the ice inside its own pricing (ruling 7: counted). Asks counted. Comparable: `flatIceWorth(ice)` against `iceWorth(state, ice, viewer)`.
  - `RATES.ice` (`src/ai/cards/elevation.ts:61`) in Project Ingatan's formula: an ice in Archives worth the flat 1. Asks not counted (cards/; 1 site). Comparable: 1 against `iceWorth(state, ice unrezzed, 'corp')` for the same card.
- **Not copies:** the Runner's `(cardDef(c).cost ?? 0) + 2` (`src/ai/runs.ts:1273`) and unrezzed 1.5 in `chainReactionBonus` price the Corp's loss when the Runner trashes a card: the Runner row "Worth of trashing a Corp card (denial)".
- **Readers:** `iceWorth` (`src/ai/evaluate.ts:398`) (`corpBoardValue`), `iceWorth` (`src/ai/handValues.ts:56`) (an ice in HQ), `iceWorth` (`src/ai/prompts.ts:676`).
- **Caches, context:** `memo` on the position (fingerprint plus pricingKey): `iceProtects:*`, `runSuccess:*`; `rezBudget` (noted once per decision in `anchor.stops`); `guardLoop`'s key (title and instance). Context: `pricingIce`, `anchor.credits` (`plan.iceStopAnchor`), `plan.iceGripCap`, `plan.iceProtects`, `plan.rezBudget`, `actingSide`.

### V6. An installed agenda
- **Owner:** `agendaWorth` (`src/ai/evaluate.ts:267`): its points on the clock if it stands through the Runner turns until it can be scored, less the clicks and credits still to put in (a click at `AGENDA_CLICK`, V16).
- **Copies:** `placedCounterWorth` (`src/ai/effectValues.ts:589`)'s agenda share: one counter is worth `point gain / advancement cost` (0.3 of it unprotected). Asks counted. Comparable: against `agendaWorth(counters + 1) - agendaWorth(counters)` for the same agenda in its server.
- **Not copies (a different quantity, the stake of losing an agenda, both sides' points; the Corp row "Agenda odds (what an access is worth)"):** `serverStake` (`src/ai/iceValues.ts:114`)'s swing and `plannedStake` (`src/ai/iceValues.ts:142`), `openAgendaLoss` (`src/ai/runnerReply.ts:199`). The audit's Q1 table counted them here; the count above leaves them out and they are named in that row's sense instead.
- **Readers:** `agendaWorth` (`src/ai/evaluate.ts:406`), `agendaWorth` (`src/ai/evaluate.ts:410`), `agendaWorth` (`src/ai/handValues.ts:51`).
- **Caches, context:** none of its own; reads `stealOdds` (the threat cache, threatModel.ts) and `runSuccess` (`memo`). Context: `threatOn` (`computingThreat`), `plan.oracle.safestRemote`, `KNOBS.corpPoints`.

### V7. A tag (the Corp's view and the Runner's)
- **Owner:** `tagsWorth` (`src/ai/evaluate.ts:473`): the tag clock (what a tagged Runner loses each Corp turn, against what clearing costs), `viewer` choosing whose knowledge of HQ it reads; Vic's own clear inside it (`vicTagsWorth` (`src/ai/evaluate.ts:527`), card-coded).
- **Copies:**
  - The flat `RATES.tagAgainstRunner` 3 a tag, twice inside the owner: while the tag clock prices the rig (`pricingTagLoss`), and as the loop fallback. Asks counted (sites `tagsWorth flat (tag clock)`, `tagsWorth flat (loop)`). Comparable: `3 x tags` against the clock on the same board outside the guard.
  - Liberation's `RATES.tagAgainstRunner * 0.5` (`src/ai/cards/liberation.ts:40`): a tag removed priced at 1.5. Asks not counted (cards/). Comparable: 1.5 against `tagsWorth(state, 'corp', 1)`.
  - `REMOVE_TAG` (`src/ai/runnerAI.ts:303`): the Runner's move score 1.2 or 0.3. Not comparable (a move's score in the rule list, not a tag's worth); listed in the Runner row "A tag".
- **Readers:** `tagsWorth` (`src/ai/evaluate.ts:607`), `tagsWorth` (`src/ai/evaluate.ts:618`), `tagsWorth` (`src/ai/effectValues.ts:510`) (the Corp formulas' lazy `tag` input), `tagsWorth` (`src/ai/runs.ts:208`) (`tagCost`, its difference), `tagsWorth` (`src/ai/cardPlans.ts:77`), and 1 in cards/.
- **Caches, context:** `memo` keys `tagLoss:<viewer>:<skip>` and, for `tagCost`'s copy, `tagLoss:<viewer>:<skip>:c<clicks>` on the original board. Context: `pricingTagLoss`, `plan.tagTrashNow`, `plan.hqTrashCost`, `actingSide` (through the rig's prices).
- **Loop:** tags price the rig, the rig prices ice, ice prices tags (`valueModel.ts` value-loop note): cut by `pricingTagLoss`.

### V8. n damage (the Corp's view and the Runner's)
- **Owner:** `damageWorth` (`src/ai/effectValues.ts:334`): the cards lost (`cardRate`) and the step the smaller grip takes toward a flatline (V18's clock), the game (`flatlineWorth`) if n is more than the grip (10.4.4); the draw-back for damage the Runner takes in its own run.
- **Copies:** `runScore`'s empty-grip term (runs.ts), already in the Runner row "Damage taken"; asks not counted. No copy in the eight files: the board's clock is V18, core damage V19, the damage a Corp card can deal V20.
- **Readers:** 15 outside cards/ (effectValues.ts: Urtica's and Clearinghouse's counter steps `'30045'` (`src/ai/effectValues.ts:602`), `'30061'` (`src/ai/effectValues.ts:605`); runs.ts: `damageWorth` (`src/ai/runs.ts:99`), `damageWorth` (`src/ai/runs.ts:102`), `damageWorth` (`src/ai/runs.ts:114`), `damageWorth` (`src/ai/runs.ts:128`), `damageWorth` (`src/ai/runs.ts:142`), `damageWorth` (`src/ai/runs.ts:412`), `damageWorth` (`src/ai/runs.ts:685`), `damageWorth` (`src/ai/runs.ts:838`), `damageWorth` (`src/ai/runs.ts:842`), `damageWorth` (`src/ai/runs.ts:882`), `damageWorth` (`src/ai/runs.ts:1180`); `damageWorth` (`src/ai/cardPlans.ts:83`)) and 11 in cards/.
- **Caches, context:** `damageThreat`'s map (V20; one game, keyed by counts). Context: whose turn and the clicks left (`drawBackClicks`, `plan.spareLastClick`).

### V9. A counter
- **Owner:** `counterWorth` (`src/ai/counterValues.ts:74`): one counter of a type on a card, by the card's `counterFormulas`, then its `counters` entry, then the step-1 default by type (`defaultWorth` (`src/ai/counterValues.ts:58`)).
- **Copies:** `counterWorthOf` (`src/ai/effectValues.ts:532`), for a card not on the board: reads the `counters` entry only (never `counterFormulas`), default 1 where the owner's is 0.6, 0.7, 1.5 or 0.8 (VAL-COUNTERWORTHOF). Asks counted. Comparable: `counterWorthOf(state, code, type)` against `counterWorth(state, the same probe instance, type)`.
- **Readers:** `counterWorth` (`src/ai/counterValues.ts:80`) (`countersWorth`), `counterWorth` (`src/ai/handValues.ts:97`) (`loadedWorth`), `counterWorth` (`src/ai/runs.ts:1116`), and 2 in cards/.
- **Caches, context:** none.

### V10. An effect over turns (a card's income or effect, turn by turn)
- **Owner, three parts:** `payoutWorth` (`src/ai/cardProfiles.ts:99`) (the payouts and draws, each discounted by the wait per turn, cut at the horizon), `payoutWait` (`src/ai/cardProfiles.ts:46`) (the risk: a Corp asset bare `bareAssetRisk` (`src/ai/cardProfiles.ts:63`), measured 0.268 and moved by this game's record, or iced `moneyIced` 0.078; a Runner card 0.25 tagged, 0.02 not), `turnsLeft` (`src/ai/cardProfiles.ts:86`) (the horizon: 14 turns at 0 points, measured). For profiled cards (`CARD_PROFILES`).
- **The owner disagrees with itself:** an unrezzed profiled Corp asset is priced bare whatever its server (`unrezzedWorth` (`src/ai/cardProfiles.ts:118`) passes `iced` false from `corpKeepValue`), the same asset rezzed in an iced remote at the iced risk (`corpCardWorth`, `inIcedServer`). The log prices both on the same boards.
- **Copy:** `perTurn` (`src/ai/effectValues.ts:114`): x a turn for the turns left, at the risk `PAYOUT_RISK.corpBare` 0.06 for every Corp card (a guess; `corpIced` unread) and the Runner's tagged/untagged risk (the same as the owner's). 83 call sites: `perTurn` (`src/ai/effectValues.ts:575`) and 82 in cards/ (every Corp and Runner formula that pays over time); each passes its own `x`, `minTurns`, `maxTurns`, `wait`, `lock`. Asks counted. Comparable per card, not per call (a formula gets a card code, not an instance, so "bare or iced" is not known where `perTurn` runs, ruling 3): the log prices each formula card's worth with `corpBare` at 0.06, at `bareAssetRisk` and at `moneyIced`, in a pass of its own with the caches cleared.
- **Readers:** `unrezzedWorth` (`src/ai/cardProfiles.ts:121`) (Corp, unrezzed), `payoutWorth` (`src/ai/evaluate.ts:174`) (Corp, rezzed), `payoutWorth` (`src/ai/evaluate.ts:139`) (Runner rig), `payoutWorth` (`src/ai/handValues.ts:63`) (Runner, in the grip). Two of the four are Runner income: the quantity is "an effect over turns", not only the Corp's.
- **Caches, context:** none. Context: `plan.measuredTurnsLeft`, `plan.rdTurnsLeft`, `plan.ownTrashRisk` and `actingSide` (`perTurn`), `state.bareAssets`.

### V11. A Corp card's worth on the board
- **Owner:** `corpCardValue` (`src/ai/evaluate.ts:164`) with its body `corpCardWorth` (`src/ai/evaluate.ts:169`): an installed asset or upgrade, as `viewer` judges it: a profiled card by its payouts (V10) rezzed or `corpKeepValue` (V12) unrezzed; a rezzed card with hosted credits `1 +` their worth (V14); power counters; Spin Doctor's spent branch for the Runner (card-coded, VAL-SPIN-DOCTOR); `left` (the Runner's trash-or-leave) leaves out the trash risk.
- **Copies:** the loop fallback with no state, `corpKeepValue(card.cardCode)` (`src/ai/evaluate.ts:165`): the card's flat CARD_VALUES worth. Asks counted (site `corpCardValue flat (loop)`). Comparable: against `corpCardValue(card, state, viewer, left)`. The Runner's 1.5 for an unrezzed card in `chainReactionBonus`, `!c.isRezzed ? 1.5` (`src/ai/runs.ts:1273`): the denial row (not comparable here; asks not counted).
- **Readers:** `corpCardValue` (`src/ai/evaluate.ts:411`) (`corpBoardValue`), `corpCardValue` (`src/ai/runs.ts:894`), `corpCardValue` (`src/ai/runs.ts:907`), `corpCardValue` (`src/ai/runs.ts:1273`), `corpCardValue` (`src/ai/cardPlans.ts:94`).
- **Caches, context:** `guardLoop`'s key (title, instance, `left`). Context: `viewer`, `left`.

### V12. A Corp card's worth before it is installed
- **Owner:** `corpKeepValue` (`src/ai/cardValues.ts:40`): by card code (no instance, no viewer): a profiled card's `unrezzedWorth` (V10's owner, bare), else the formula's `keep` (`corpEffect` (`src/ai/effectValues.ts:502`), handed `cost` = the rez cost unrezzed, 0 rezzed), else the flat CARD_VALUES `keep` (default `RATES.defaultKeep` 1) plus `drawBonus`. It does not subtract the rez cost itself: 33 formulas do, 15 don't (VAL-CORP-FORMULA-COST; V-B).
- **Copies:**
  - `econValue` (`src/ai/cardValues.ts:44`): `ECON_SCALE` 0.6 x the profiled worth or the formula's `econ`, or the flat `econ`. Its readers test only that it exists (VAL-DEAD), so its size changes no decision. Asks counted. Comparable with the unit stated: `econValue` (install-score scale) against `corpKeepValue(code, state)`.
  - `upgradeValue` (`src/ai/cardValues.ts:53`): `ECON_SCALE` x the formula's `[remote, central]`, or the flat pair; read once (`upgradeValue` (`src/ai/corp/rez.ts:177`), capped at 2). Asks counted. Comparable with the unit stated: each of the pair against `corpKeepValue(code, state)`.
  - `rezzedWorth` (`src/ai/effectValues.ts:547`): the worth once rezzed less the rez cost (an entry's own `rezzed`, else the formula rezzed less `rezCost`), read by the own-turn rez test (`rezzedWorth` (`src/ai/corp/rez.ts:349`)). Asks counted. Comparable: against `corpKeepValue(code, state, true) - rezCost`.
  - `unrezzedWorth` with `iced` true is never asked: the owner's bare price is compared against it (V10's self-disagreement).
  - The flat CARD_VALUES `keep` with no state (the owner's last branch, and `serverStake`'s `corpKeepValue` (`src/ai/iceValues.ts:133`), which leaves the state out on purpose to cut a value loop). Comparable: against `corpKeepValue(code, state)`.
- **The two V-B columns** (the log, ruling 10): for each of the 48 formula cards, the worth as today (`f(cost)`) against the worth with the cost subtracted once (`f(0) - cost`), and whether `f(c) - f(0)` is linear in the cost; and the worth with `corpBare` at 0.06 against the measured risks (V10). Profiled cards are outside the cost column (`unrezzedWorth` subtracts the printed cost itself).
- **Readers:** `corpKeepValue` (`src/ai/evaluate.ts:178`), `corpKeepValue` (`src/ai/evaluate.ts:174`), `corpKeepValue` (`src/ai/evaluate.ts:245`) (`hiddenCardOdds`' `other`), `corpKeepValue` (`src/ai/handValues.ts:59`), `corpKeepValue` (`src/ai/iceValues.ts:133`), `corpKeepValue` (`src/ai/evaluate.ts:165`) (V11's fallback), and `corpKeepValue` (`src/ai/cards/elevation.ts:61`).
- **Caches, context:** none of its own (the formulas read `memo`'d odds). Context: `rezzed`.

### V13. A game end
- **Owner:** the rows "Price of a game end" (Corp) and "A game end" (Runner) above: `flatlineWorth` (`src/ai/valueModel.ts:218`) and `sampledEndWorth` (`src/ai/valueModel.ts:240`) on the point clock.
- **Copies:** `evaluate`'s +-1000 (`src/ai/evaluate.ts:628`) for a certain end on a line (not comparable: a sentinel that sorts a won line above every other, not a price); `FLATLINE` (`src/ai/effectValues.ts:490`), dead (tests only), comparable: 32 against `flatlineWorth(state)`.
- **Readers:** `flatlineWorth` (`src/ai/effectValues.ts:340`), `flatlineWorth` (`src/ai/effectValues.ts:352`), `flatlineWorth` (`src/ai/effectValues.ts:486`), `flatlineWorth` (`src/ai/evaluate.ts:621`), `flatlineWorth` (`src/ai/runs.ts:1179`), `sampledEndWorth` (`src/ai/runnerReply.ts:249`).

### V14. Hosted credits on a Corp card
- **Owner:** `countersWorth` (`src/ai/counterValues.ts:78`) with type credit (V9's owner per counter), read for a rezzed unprofiled card in `corpCardWorth` as `countersWorth(state, card, 'credit')` (`src/ai/evaluate.ts:176`).
- **Copies:** with no state, `hosted * RATES.counters.hostedCredit` (`src/ai/evaluate.ts:176`) 0.6 a credit; and a profiled card's hosted credits priced as payouts (`payoutWorth` with `hosted`, `src/ai/evaluate.ts:174`), so the same credits have two prices by whether the card has a profile. Asks counted (inside `corpCardValue`). Comparable: on a rezzed card with credits, `1 + countersWorth` against `payoutWorth(profile, ..., hosted)` against the flat.

### V15. A Runner rig card's worth installed (not an icebreaker)
- **Owner:** `runnerCardValue` (`src/ai/cardValues.ts:60`): the card's formula (`runnerEffect`), in rig points (credits / `RATES.rigCardScale` 2), else its flat CARD_VALUES `rig` (default `RATES.defaultRig` 2) plus `drawBonus`. Its readers multiply by `rigCardScale` again.
- **Copies:** the flat (`runnerCardValue flat`, the no-formula and loop path). Asks counted. Comparable: the flat against the formula, both x 2. A profiled rig card (`CARD_PROFILES`, Runner) is priced by `payoutWorth` x `payoutSlide` in `runnerRigValue`, `payoutWorth` (`src/ai/evaluate.ts:139`), not by this owner: comparable, the same card both ways.
- **Readers:** `runnerCardValue` (`src/ai/evaluate.ts:143`) (the rig), `runnerCardValue` (`src/ai/handValues.ts:88`) (in the grip).

### V16 to V20 (rows a red-team ruling split off: a different quantity, each single today)
- **V16, a Corp click spent advancing:** `AGENDA_CLICK` (`src/ai/evaluate.ts:253`) 2, what the click could have built instead, read in `agendaWorth` as `const click = AGENDA_CLICK` (`src/ai/evaluate.ts:298`); `setAgendaClick` for scripts/human-agreement.ts. Hand-set.
- **V17, digging for an answer:** `digValue` (`src/ai/evaluate.ts:58`), the chance the next card answers a problem the hand can't (money, ice, a breaker type); read by `digValue` (`src/ai/runnerAI.ts:358`) and `digValue` (`src/ai/corp/rez.ts:321`). Copy (not comparable, a flat on the same move): `needsBiggerHand`'s `score += 1.5` (`src/ai/runnerAI.ts:356`). It reads the side's own deck contents (decklist odds, never the order).
- **V18, the Runner's standing flatline exposure:** the board's damage clock in `sideStrength`, `flatlineOdds` (`src/ai/effectValues.ts:462`) x `flatlineWorth` at `lifeGrip` (`src/ai/effectValues.ts:363`), plus `lifeCards` (V3) (`board clock` (`src/ai/evaluate.ts:621`)). Asks counted.
- **V19, a hand slot lost to core damage:** `coreSlotWorth` (`src/ai/effectValues.ts:474`) (`CORE_SLOT_USE` x a card); `coreDamageWorth` (`src/ai/effectValues.ts:483`) adds the clock at the lower limit.
- **V20, the Corp's damage threat:** `damageThreat` (`src/ai/effectValues.ts:398`): the biggest hit and the share of damage cards, read through `cardDamage` (`src/ai/effectValues.ts:380`) or, on the Corp's turn with `plan.corpTurnDamageOwn`, `ownTurnDamage` (`src/ai/effectValues.ts:447`). Its map is keyed by counts (about a third of hits another board's, `threatsAudit`).

### V21 to V25 (rows the V-A recount found missing, added in V-B B1; ruling 12)
- **V21, a point on the clock:** `pointValue` (`src/ai/valueModel.ts:128`) (the sum of the point steps while `plan.pointClock` is on, else `RATES.point` 8 a point) and `pointGain` (`src/ai/valueModel.ts:211`) (more points on a score, fractional for decklist averages). About 40 and 15 call sites; every game end (V13), agenda (V6) and Archives loss (V23) reads them. Copies: none. `pointsTerm` (`src/ai/valueModel.ts:227`) restates sideStrength's points term by construction (for the sampled game end) and reads `pointValue`: a reader of the owner, not a second price of a point (labelled, not counted).
- **V22, icebreaker coverage in the rig:** `breakerTypeWorth` (`src/ai/iceValues.ts:277`): 3 x the ice stop x the odds of meeting the type x the clock; read in runnerRigValue, `breakerTypeWorth` (`src/ai/evaluate.ts:134`) with `AI_BREAKER_SHARE` for an AI breaker. Copies: none (V15 leaves icebreakers out; plan.flatRates.breakers took the flat extra away).
- **V23, an agenda lost to Archives:** `archivedAgendaLoss` (`src/ai/evaluate.ts:345`): the Runner's point gain by the odds of an Archives breach on one of the turns left (`PACE.facedownBreach`). Readers: keepValue's `archivedAgendaLoss` (`src/ai/evaluate.ts:640`), archivedAgendasValue's `archivedAgendaLoss` (`src/ai/evaluate.ts:359`), spentSpinDoctorWorth's `archivedAgendaLoss` (`src/ai/evaluate.ts:194`) (Archives' facedown cards), serverStake's Archives branch `archivedAgendaLoss` (`src/ai/iceValues.ts:125`). Copies: none.
- **V24, a memory unit:** `muWorth` (`src/ai/effectValues.ts:103`): `MU`, doubled while the programs installed and seen in the grip need more than the base 4. Readers: 14 Runner formulas in cards/ (some scaled, `2 * muWorth * 0.6`, `-0.3 * muWorth`: a card's own share, read through the owner). Copies: none.
- **V25, an advancement counter on ice:** `iceAdvanceWorth` (`src/ai/effectValues.ts:570`): what the Runner pays more to get past the ice at three counters, a third a counter; Syailendra's branch prices its counter placement through `perTurn` (V10's copy) and the flat `CLICK` (V2). Readers: `iceAdvanceWorth` (`src/ai/corp/cardRules.ts:49`). Copies: none.

### Copy lines (one line per copy; `scripts/value-owners/counts.mjs` counts these lines)
V-B B1 re-baseline (recount VA-COPY-COUNT-BASELINE, ruling 13): the count is the number of lines below whose `counted` cell is `live`, not a summary cell. Baseline at B1: **35** (the recount's 29 live comparable copies on ruling 4e, plus the five Runner formulas' flat tag and Jailbreak's flat drawn card it found). The other lines are listed so nothing is dropped from sight: `dead` (no reader), `not comparable` (a different quantity on ruling 4e), `inside owner` (a part of the owner, not a second computation), `reader` (reads the owner), `recorded` (ruled to a later cleanup, not counted until it is ruled a copy). The label is the red-team ruling's where one exists (`/mnt/project-files/adversarial/2026-11-16-stage-vb-duplicates/findings.md`), else "labels file"; the labels file (`/mnt/project-files/netrunner-ai/valuation-cleanup/stage-vb/labels.md`) is ruled by the AI Coordinator and this column follows it. A step that removes a copy deletes its line; a copy found later gets a line in the branch that finds it.

<!-- copies:start -->
| row | copy | where | counted | label (ruling) | step |
|---|---|---|---|---|---|
| V2 | the flat `CLICK` in played worth | `playedWorth` (`src/ai/handValues.ts:31`) | live | loop guard: clickWorth > playedWorth > click (ruling 10) | B5, label only |
| V2 | the click a payout takes | `payoutClick` (`src/ai/valueModel.ts:95`) | live | loop guard: V10 > click > playedWorth > V10 (ruling 10) | B5, label only |
| V2 | the stateless click rate | `clickRate` (`src/ai/valueModel.ts:94`) | live | loop guard, as payoutClick (ruling 10) | B5, label only |
| V3 | HQ: the flat count | `handValue` (`src/ai/evaluate.ts:39`) | live | the other side's hidden HQ: not the same quantity (ruling 8); own HQ: the candidate owner of a hand (addendum to ruling 7) | B4 (waits for Jeff) |
| V3 | HQ: a card kept against a discard | `keepValue` (`src/ai/evaluate.ts:637`) | live | labels file | B4 |
| V3 | HQ: cards a resource trash costs | `hqTrashCardsLoss` (`src/ai/evaluate.ts:589`) | live | labels file | B4 |
| V3 | HQ: half the summed keep | `sumKeep` (`src/ai/prompts.ts:46`) | live | labels file | B4 |
| V3 | grip: the flat count | `handValue` (`src/ai/evaluate.ts:39`) | live | as HQ's | B4 (waits for Jeff) |
| V3 | grip: a card kept against a discard | `keepValue` (`src/ai/evaluate.ts:637`) | live | labels file | B4 |
| V3 | grip: half the summed keep | `sumKeep` (`src/ai/prompts.ts:46`) | live | labels file | B4 |
| V3 | grip: the handCore extra taken back | `lifeCards` (`src/ai/evaluate.ts:597`) | live | labels file (a cancel pair with the owner's extra, VAL-CANCEL-TERMS) | B6 |
| V4 | the flat 1.6 beyond three cards | `DRAWN_CARD` (`src/ai/evaluate.ts:47`) | live | the other side's hidden hand: not the same quantity (ruling 8) | B4/B5, labels file |
| V4 | 0.5 a card a card draws | `drawBonus` (`src/ai/cardValues.ts:33`) | live | loop guard at all three sites (ruling 16) | none |
| V4 | Jailbreak's drawn card | `RATES.drawnCard` (`src/ai/runnerAI.ts:318`) | live | recorded for the Runner cleanup (ruling 12) | Runner cleanup |
| V5 | the ice loop fallback | `flatIceWorth` (`src/ai/iceValues.ts:236`) | live | loop guard (brief B6) | none |
| V5 | Ingatan's ice in Archives | `RATES.ice` (`src/ai/cards/elevation.ts:61`) | live | not the same quantity unless an honest instance is shown (ruling 17) | B6, labels file |
| V6 | the agenda share of a placed counter | `placedCounterWorth` (`src/ai/effectValues.ts:589`) | live | labels file | B6 |
| V7 | the flat 3 a tag inside the owner (tag clock and loop) | `tagsWorth flat` (`src/ai/evaluate.ts:479`) | live | loop guard (ruling 10) | B5, label only |
| V7 | Solidarity Badge's tag removed | `RATES.tagAgainstRunner * 0.5` (`src/ai/cards/liberation.ts:40`) | live | owner is right (ruling 10) | B5 |
| V7 | Eru Ayase-Pessoa's flat tag | `RATES.tagAgainstRunner` (`src/ai/cards/liberation.ts:64`) | live | owner is right (ruling 10) | B5 |
| V7 | Hannah "Wheels" Pilintra's flat tag | `RATES.tagAgainstRunner` (`src/ai/cards/liberation.ts:76`) | live | owner is right (ruling 10) | B5 |
| V7 | Arruaceiras Crew's flat tag | `RATES.tagAgainstRunner` (`src/ai/cards/liberation.ts:446`) | live | owner is right (ruling 10) | B5 |
| V7 | Friend of a Friend's flat tag | `RATES.tagAgainstRunner` (`src/ai/cards/liberation.ts:453`) | live | owner is right (ruling 10) | B5 |
| V7 | Borrowed Goods' flat tag | `RATES.tagAgainstRunner` (`src/ai/cards/vantagePoint.ts:97`) | live | owner is right (ruling 10) | B5 |
| V9 | a counter on a card not on the board | `counterWorthOf` (`src/ai/effectValues.ts:531`) | live | not the same quantity unless an honest instance is shown (ruling 17); one default for an unlisted counter (B6) | B6 |
| V10 | x a turn at the 0.06 guess | `perTurn` (`src/ai/effectValues.ts:114`) | live | owner has a bug for Corp assets (ruled correction, ruling 5); other cards keep 0.06 until V-C | B3 |
| V11 | the stateless board-card fallback | `corpCardValue flat (loop)` (`src/ai/evaluate.ts:165`) | live | loop guard | none |
| V12 | the econ install score | `econValue` (`src/ai/cardValues.ts:44`) | live | not the same quantity: a type test (ruling 3) | B2 (predicate) |
| V12 | an upgrade by kind of server | `upgradeValue` (`src/ai/cardValues.ts:53`) | live | not the same quantity (ruling 15) | none |
| V12 | the worth once rezzed less the cost | `rezzedWorth` (`src/ai/effectValues.ts:547`) | live | generic branch: owner is right already; the two instance rules: not the same quantity (ruling 4) | none |
| V12 | the stateless CARD_VALUES keep | `corpKeepValue(card.cardCode))` (`src/ai/iceValues.ts:133`) | live | loop guard in serverStake (on purpose); other no-state readers listed in B2 | B2 (list) |
| V14 | hosted credits with no state | `RATES.counters.hostedCredit` (`src/ai/evaluate.ts:176`) | live | labels file | B6 |
| V14 | a profiled card's hosted credits as payouts | `payoutWorth` (`src/ai/evaluate.ts:174`) | live | labels file | B6 |
| V15 | the flat rig worth | `runnerCardValue flat` (`src/ai/cardValues.ts:61`) | live | loop guard and no-formula path | B6, labels file |
| V15 | a profiled rig card by its payouts | `payoutWorth` (`src/ai/evaluate.ts:139`) | live | labels file | B6 |
| V1 | the flat credit | `creditValue` (`src/ai/valueModel.ts:72`) | dead | dead list | B6 (Jeff's yes) |
| V1 | run credits at face value | `runCreditsSlide` (`src/ai/runs.ts:1168`) | recorded | recorded for the Runner cleanup; not ruled a copy (ruling 12) | Runner cleanup |
| V3 | grip: digging for an answer | `digValue` (`src/ai/evaluate.ts:58`) | not comparable | V17's owner (a draw's extra) | none |
| V4 | a deck card from the top | `topDownWorth` (`src/ai/effectValues.ts:613`) | dead | dead list (a reader of the owner) | B6 (Jeff's yes) |
| V4 | Vic's clear inside the tag owner | `vicTagsWorth` (`src/ai/evaluate.ts:527`) | inside owner | part of V7's owner (ruling 12: B5) | B5 |
| V7 | the Runner's move score | `REMOVE_TAG` (`src/ai/runnerAI.ts:303`) | not comparable | not the same quantity (ruling 11) | none |
| V8 | the empty grip in a run's score | `flatlineOdds(state, 0)` (`src/ai/runs.ts:1179`) | not comparable | Runner row "Damage taken" (ruling 4e) | Runner cleanup |
| V10 | the owner's own bare/iced split | `unrezzedWorth` (`src/ai/cardProfiles.ts:118`) | inside owner | debt for Stage D (ruling 2) | Stage D |
| V11 | the Runner's 1.5 for an unrezzed card | `!c.isRezzed ? 1.5` (`src/ai/runs.ts:1273`) | not comparable | denial row (ruling 4e) | none |
| V13 | a certain end on a line | `evaluate` (`src/ai/evaluate.ts:628`) | not comparable | a sort sentinel (ruling 11) | none |
| V13 | the flat flatline | `FLATLINE` (`src/ai/effectValues.ts:490`) | dead | dead list | B6 (Jeff's yes) |
| V17 | a bigger hand's flat | `needsBiggerHand` (`src/ai/runnerAI.ts:356`) | not comparable | a Runner move score (ruling 11) | none |
| V21 | evaluate's points term restated | `pointsTerm` (`src/ai/valueModel.ts:227`) | reader | reads V21's owner | none |
<!-- copies:end -->

### Owners read by owners (V-B's loop check, ruling 7)
"Reads" is a call inside the owner's own pricing, through any helper. A **copy inside an owner** is what V-B would redirect to its owner; where that redirect closes a loop, it is marked. `guardLoop` serves the loop's flat value when a lookup meets itself; the guard is what turns a loop into a second price.

| Owner | Reads these owners | Copies sitting inside it | Redirecting a copy to its owner closes a loop? |
|---|---|---|---|
| V1 `sideCreditValue` | (Corp acting) rez money `keep` through `corpPorts` | none | no |
| V2 `clickPrice` | V3 (`playedWorth` through `clickWorth`), V4 (`drawWorth`) | the flat `CLICK` in `playedWorth` | **yes**: `clickWorth` -> `playedWorth` -> click owner -> `clickWorth` |
| V3 `ownHandValue` | V4 (an unseen card), via `heldWorth` -> `playedWorth`: V6, V5, V12, V10, V15, V9 | the flat `CLICK` (V2) in `playedWorth` | **yes** for the click (as V2); `cardRate` <-> `heldWorth` is the existing loop cut by `averaging` |
| V4 `cardRate` | V3's `heldWorth` -> `playedWorth` (all of it, as V3) | `drawBonus` (V4's own copy) inside V12, V15 | **yes**: `cardRate` -> `drawWorth` -> `heldWorth` -> `playedWorth` -> `corpKeepValue` -> `drawBonus` -> `cardRate` (today cut because `drawBonus` is flat) |
| V5 `iceWorth` | V7 and V8 (subroutine costs in `iceCost`), V12 (`serverStake`, flat on purpose), V6's stake | `flatIceWorth` | the flat is the loop guard itself |
| V6 `agendaWorth` | V10's `turnsLeft`, the threat model | `AGENDA_CLICK` (V16) | no (V16 is its own quantity) |
| V7 `tagsWorth` | the rig (V15, V10, V9, V3's `heldWorth`), `hqTrashCardsLoss` (V3's copy) -> `keepValue` | the flat 3 a tag | **yes**, the known loop: tags -> rig -> ice -> tags (cut by `pricingTagLoss`) |
| V8 `damageWorth` | V4, V13, V18 | none | no |
| V9 `counterWorth` | card formulas (V4, V10's `perTurn`, V8, ...) | none | no |
| V10 owner | V2's `payoutClick` (a copy), V4 (callers hand `card`) | `payoutClick` | **yes** if `payoutClick` reads `clickWorth` (-> `playedWorth` -> V10 for a profiled card) |
| V11 `corpCardValue` | V12, V10, V14, V4, V9 | the stateless flat fallback | the flat is the loop guard |
| V12 `corpKeepValue` | V10 (profiled), formulas (V4, V7, V8, V9, V10's copy `perTurn`, V6's odds) | `drawBonus` (V4), `perTurn` (V10) | **yes** for `drawBonus` (as V4) |
| V15 `runnerCardValue` | formulas (V4, V7, V8, V9, `perTurn`) | `drawBonus` (V4) | **yes** for `drawBonus` |

### Hook sites (what the log samples)
Owner sites: `sideCreditValue`, `clickPrice`, `handAndClicks` (the hand term, both prices), `cardRate`, `iceWorth`, `agendaWorth`, `tagsWorth`, `damageWorth`, `counterWorth`, `payoutWorth`, `corpCardValue`, `corpKeepValue`, `runnerCardValue`, `flatlineWorth`, `sampledEndWorth`. Copy sites: `handValue`, `keepValue`, `hqTrashCardsLoss`, `lifeCards`, `playedWorth` (its `CLICK`), `payoutClick`, `clickRate`, the two direct `drawWorth` entries, `drawBonus`, `flatIceWorth`, `placedCounterWorth`, the two tag flats, `counterWorthOf`, `perTurn`, `corpEffect`, `unrezzedWorth`, `econValue`, `upgradeValue`, `rezzedWorth`, the stateless corp-card fallback, `runnerCardValue flat`, the board clock, `evaluate`'s +-1000. No hook in a forbidden file.

### Dead valuation exports (the codeHealth allow-list; shrink only, for V-B and Jeff)
Listed in `tests/codeHealth.test.ts` ("every valuation export has a reader in src"). A reader is a use in src outside the declaring statement, in a module the app loads (reachable from src/main.tsx or the server's imports; V-B B1); a re-export or a test is not a reader, and since B1 the re-export lines are checked too. The dead list for Jeff: `/mnt/project-files/netrunner-ai/valuation-cleanup/stage-vb/dead-list.md`.

- `creditValue` (valueModel.ts): dead (re-exported by evaluate.ts, never read): V-B
- `clearBuildTargets` (valueModel.ts), `clearHandCaches` (handValues.ts), `clearDamageThreats` (effectValues.ts), `clearDeckShares` (iceValues.ts): test and script cache resets
- `passOddsOf` (effectValues.ts): scripts only (threat calibration)
- `FLATLINE` (effectValues.ts): dead (tests only; `flatlineWorth` replaced it): V-B
- `topDownWorth` (effectValues.ts): dead (tests only): V-B
- `shownIceShare` (evaluate.ts): dead (no reader anywhere): V-B
- `AGENDA_RUN` (evaluate.ts): scripts only (a measured rate, logged)
- `setAgendaClick` (evaluate.ts): scripts only (scripts/human-agreement.ts sweeps `AGENDA_CLICK`)
- `centralExposure` (evaluate.ts): scripts and tests only since the oneCurrency off path went: V-B
- `EFFECT_CODES` (effectValues.ts re-export), `CARD_VALUES` (cardValues.ts re-export): read only by src/ai/valueAudit.ts, which the app never loads (V-B B1, recount VA-DEAD-GUARD-REEXPORTS)
- `PAYOUT_RISK` (cardProfiles.ts re-export): no src importer (src reads ./payoutRisk) (V-B B1)

### Disagreement log at this branch (beta b38786f; `ai-honest-corp-decision` not merged)
`/mnt/project-files/netrunner-ai/valuation-cleanup/stage-va/value-log-43824608678.md` (ai-script run 43824608678: 56 deals and 35 of Jeff's games, both sides, 64 shards, K 8 a site and tag). Known-answer check 1: 34,959 of 34,969 owner samples priced again equal what play got; the 10 that don't (damageWorth 4, clickPrice 3, corpKeepValue 2, keepValue 1; 9 on reply or playout boards, 1 at a root) are all at sites that read an incomplete-key cache (`clickCache`, `deckAverage` through `cardRate` and `heldWorth`, the `damageThreat` map). That is consistent with the cache leak the audit recorded (AI-CACHE-HIDDEN-STATE: play, mid-decision, served another board's cached sub-value; the pass prices cache-cold) rather than a misplaced hook, since the other sites match n of n. Not proven per sample. Each copy's headline is in the report's "Copies against their owners" table.

### Counts
From `node scripts/value-owners/counts.mjs` (re-run it to recount; the copy counts may only go down).

| count | value |
|---|--:|
| hand-set literals in the valuation layer (val-lits.mjs: table + scattered) | 1131 (957 + 174) |
| quantities with one named owner (V1 to V25) | 25 |
| live copies, all quantities (the live lines of "Copy lines") | 35 |
| other copy lines, by kind (not counted) | dead 3, recorded 1, not comparable 6, inside owner 2, reader 1 |
| valuation exports with no reader (allow-list) | 15 |
| lines of src/ai | 14222 |

Live copies per quantity: V1 0, V2 3, V3 8, V4 3, V5 2, V6 1, V7 7, V8 0, V9 1, V10 1, V11 1, V12 4, V13 0, V14 2, V15 2, V16 0, V17 0, V18 0, V19 0, V20 0, V21 0, V22 0, V23 0, V24 0, V25 0.
<!-- valuation:end -->

## Hidden information (rule 10.2.2a)
- The deciding Corp's whole decision reads its own view (ai-honest-corp-decision): `turnPlanner.ts corpDecisionView` deals R&D's order (outside the slots both sides know), the Runner's unseen grip with the stack and the rng once per decision, and `corpAI.ts decide` hands it to every question of `corp/core.ts corpDecide` (Q1, Q3, Q0 prompts and the free install they reach, the order, the look-ahead, Q6 money, Q4/Q5, tagFirst) and `chooseRez` hands it to `decideRez` under that decision's own `decisionContext`. The legal list is the real state's; an answer not legal there is taken again on the real state before anything is committed (`corp/core.ts honestCorpCounts`). The cards the active prompt names stay in their real places, and the breach queue names the view's R&D cards at the same places. The Hard Corp, the planner's rollouts and the reply's Corp are unchanged (they already play on a deal, or are Hard).
- Known debt (red team 2026-11-16 finding 1, ruled): the view forgets R&D cards only the Corp has seen (arranged in secret: `arrangeTop`, Cultivate, AU Co., liberationCorp.ts:644) and a stack top the Corp set (Working Prototype): the engine keeps no Corp-side R&D memory (`rdNotes.privateTop` is a count). Known-failing pin in tests/corpHonestDecision.test.ts; its own brief.

## How to use
- Writing a spec: list the rows the new code reads. If it needs a quantity that is not here, add the row and the owner in the same branch.
- Reviewing: grep the diff for a new computation of any row (new helper that sums rez costs, counts ice against a rig, or derives agenda odds). One found is "Changes needed".
- Fixing a row: lower the count and name the commit in "Fixed in". At 1, write "single".
