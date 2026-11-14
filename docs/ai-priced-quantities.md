# AI priced quantities: one owner each

Rule (CLAUDE.md, "One owner per quantity"): each quantity below has one owning function. A branch may not add another computation of it. The "known duplicates" column may only go down. Reviews check this file against the diff; every code audit recounts it. Source of the first counts: `/mnt/project-files/audits/2026-11-13-ai-corp/report.md` (beta ef644c0).

## Corp
| Quantity | Owner (target) | Known duplicates 2026-11-13 | Audit finding | Fixed in |
|---|---|---|---|---|
| Rez money the Corp must keep | one rez-money function (to be named in Step 4) | about 7: `reservePenalty`, `rezReserve`, `moneyTargetPenalty` (corpAI), `boardNeed`, `rezBudget`, `afterLineFloor`, `scoringShort`, `reservedForAgenda`, centralIce's rez gate | AI-REZMONEY | Step 4 |
| Does this server keep the Runner out (hold count) | `holdCost` (countedScore) | 8 ways; bioroid clicks counted twice; encounter costs (Funhouse) read as need 0 | AI-HOLD-COUNT | Step 4 |
| Agenda odds (what an access is worth) | two pools: the Corp's own knowledge, the Runner's view | 6 pools (centralIce's R&D stake no longer mixes two of them: Step 0, b12c26b) | AI-AGENDA-ODDS | Step 4 |
| Price of a game end | `sampledEndWorth` beside `flatlineWorth` (valueModel) | 3, but the sampled Runner reply no longer reads evaluate's ±1000 (Step 1: a sampled end is the winner's pointValue(7) plus the rest of the loser's game, on the reply root's board). Left: ±1000 in evaluate (a certain end on the Corp's own line; and search.ts rollouts, which are sampled too: Step 3 or 4), `runLoss`, `flatlineWorth` | AI-TERMINAL-PRICE | Step 1 (sampled reply only) |
| Where a card is installed (placement) | one placement function in candidate generation | 4 post-pick rewriters (`centralIce`, `iceRedirect`, `assetCover`, `assetPartner`), order copied in corpAI and search | AI-PICK-PIPELINE | Step 4 |
| A card held in HQ | by-card hand price (handValues) | 2 (flat 2.0/1.6 in the ranking, by card in the planner leaf) | AI-HAND-TWO-CURRENCIES | Step 5 |
| An advance on an unknown asset (bluff) | `placedCounterWorth` (effectValues) | 2 (flat 1.2 in corpAI) | AI-FLAT-NUMBERS | Step 5 |

## Runner
Not audited yet. A Runner audit fills these rows before any new Runner rule is added. Known from the 2026-11-05 audit, not re-checked: Runner card income on the slide was implemented four ways.

## How to use
- Writing a spec: list the rows the new code reads. If it needs a quantity that is not here, add the row and the owner in the same branch.
- Reviewing: grep the diff for a new computation of any row (new helper that sums rez costs, counts ice against a rig, or derives agenda odds). One found is "Changes needed".
- Fixing a row: lower the count and name the commit in "Fixed in". At 1, write "single".
