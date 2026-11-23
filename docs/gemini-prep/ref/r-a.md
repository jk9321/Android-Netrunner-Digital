# Stage spec R-A: the Runner's card facts in the card entries, differences logged (play identical)

Runner rework AI Coordinator. **Draft 2, 2026-11-20, after its red team** (`/mnt/project-files/adversarial/2026-11-20-runner-stage-specs/findings.md`: A1 to A7 all accepted, answered there; draft 1 in `draft1/`). Briefs: `../briefs/a-log.md`, `../briefs/a-move.md`. Plan: `../plan.md` (rev 3, approved by Jeff 2026-11-19), R-A. R0's rulings that bind it: `../r0/count1-audit-map/ruling.md` (the seven cards, the five encodings, the audit), `../r0/count2-rank-cost/ruling.md` (no speed cut is exact, so none rides with R-A).

**PAUSED (Jeff, 2026-11-20 14:06Z): no thread of this stage starts until his go.**

## What R-A is, in one paragraph
Requirement 2 of the rework: a card's facts are read by both sides from one place, the card's entry in `src/ai/cards/<set>.ts`. Today the Runner's run model names cards by number (count 1 lists 26 codes in `src/ai/runs.ts` and `src/ai/runnerAI.ts`) and seven cards have their fact written twice, once in the entry for the Corp's hold count (`holdFacts`) and once in the Runner's code. R-A moves the facts and changes no decision. Two parts: **A-log**, scripts that record every place the two sides read the same fact differently and that capture the golden values A-move is proven against, and **A-move**, the `src` change. A-log comes first: A-move's branch is cut only after A-log's golden file is on beta.

## The sources, and what they cannot show (red team A1, A2)
The batch pool (13 x 17 = 221 deals) holds 10 of the 26 cases; ten more appear only in people's files; five appear in no source (Banner, Lobisomem, Pressure Spike, Corsair, Chain Reaction), yet the beta picker decks hold most of them. So a proof on "221 deals and 38 files" proves less than half of the move. The proof therefore has three legs (the bar below): the sources, the NRDB=1 pool (the picker decks, `NRDB=1`, `scripts/corp-losses.ts:41-42`, `ai-batch.yml` decks input), and built boards with golden values captured on the base commit. A-log's first table recounts which case is in which source.

## Part A-log: the disagreement logs and the golden values (scripts and one fixture, light tier, may merge before main)
Branch `ai-runner-facts-log`. Allowed: `scripts/runner-rework/facts-*`, `tests/fixtures/runner-facts/` (new: the built boards and `golden.json`), `docs/ai-batch-log.md`, `PROJECT_STATUS.md`. No `src`, no test file.

**The base** is named by rule, not by number: the g1 base of the beta commit the scripts run on (today 44680798149, beta 38ab2a97 through dd4004c). Standing rules: `../r0/standing-rules.md`, including one local minute of the exact run before any launch.

### The logs
On every recorded board (the 221 deals of the base, the 38 human files, and one NRDB=1 g1's deals), for each rezzed or Runner-known ice and each server, both sides' reading of the same fact and whether they agree. One table per fact, by kind and count; self-play, the NRDB pool and people apart.

| # | Fact | The readings compared |
|---|---|---|
| L1 | This subroutine ends the run | the five encodings: `SUB_RULES`' third column / `subroutineBlocks`; `subroutineFacts`; `hasEndTheRun` (`corp/rez.ts:18`, read at `:208`); the all-end barrier test in `breakPlans`; Banner's literal test |
| L2 | The damage a subroutine does | `subroutineDamage`; `SUB_RULES`' damage patterns; `subroutineFacts`' `clauseEffects` |
| L3 | The seven cards | Botulus, Tranquilizer, Physarum Entangler, Funhouse, Jaguarundi, Seraph, Paywall: the entry's `holdFacts` field against the Runner's constant or text pattern, as a fact and as the number each reader gets, and how many boards met the card at all |
| L4 | "Trash a program or end the run" and like choices | the Runner's price (5 with a program) against the walk's answer (the end) |
| L5 | An unrezzed ice | the Runner's flat 1.5 or 0.5 credits and `unrezzedDamageRisk` against what the walk assumes for the same ice. **Split:** boards where the Runner knows the ice (the two views are the same) apart from boards where it does not (a difference by construction, counted but not a finding) |
| L6 | The Runner's money over the turn | `runScore`'s credits now; `iceStop`'s flat 4; the walk's `runnerEarnings`; which credits may pay (a locked pool: `tests/holdWalk.test.ts`, Aircheck and Whitespace, found row 102). **Split** as L5: turn start with an empty grip of money cards apart from the rest |
| L7 | Cards that act as a run begins or are paid by a run | the entry's `holdFacts` (`runBeginCredits`, `firstRunTrashForCost`, `counterCredits`) against what the Runner's price of the same run reads (today nothing) |
| L8 | A rig bypass | `runBypasses` (added only where it saves more than it costs in the Runner's prices) against the walk; found row 88's board as a built case |
| L9 | Can the Runner get into this server this turn | **Feasibility on both sides** (red team A6). The Runner's reading: the price part of `runScore` only (no BLOCK, `known <= budget`, `approachCost` not null), the breach's worth set aside, so an open server with nothing to take reads "can get in". The Corp's: `serverHold`. Both on the board with every identity public, the walk given the Runner's real grip money. Logged beside it as three **named policy differences**, each with its count: the flat price of an unrezzed ice against the walk's exact ice; the walk's choice of rezzes that keep the Runner out against the Runner's assumption; the money (L6). The two-row test of R-B reads only the boards where none of the three explains the difference |
| L10 | This once-per-turn ability is used this turn | the engine writes three names: `once:<instance>` and `once:<instance>:<n>` (the card scripts' `onceKey` helpers, differing by set) and `ability:<instance>:<index>` (`src/core/engine/actions/ability.ts:15`, abilities declared `oncePerTurn: true`). Readers: `corp/hold.ts:189` (the `once:` forms only), `runs.ts:1254` (Malandragem, `once:<instance>:0`), `runnerEarnings` (no flag at all: `tests/clickMoneyFacts.test.ts`, Telework Contract). Per card with a once-per-turn use: the name its script writes and what each reader sees after the use |
| L11 | An entry against the engine (red team A2, A7) | for every numeric field of a card entry that states what the engine pays, costs or does (`clickMoney`, `runBeginCredits`, `counterCredits`, the seven cards' fields, the fields A-move will add): play it in the engine on the built board, in each state the card's text names (tagged or not, threat below or at the line, each "unless" option), and compare. Friend of a Friend (9 in the entry while tagged, the engine pays 5) is the first row |
| L12 | A derezzed lender (count 3's ruling, section 5) | Mycoweb's fact as the entry would state it against what the Runner's price and the walk read today |

Reading rule, written before the numbers: **the log decides nothing.** Every fact with a difference above 0 goes to R-B with its count. "0 differences" is written only with the number of boards that met the fact beside it; under 10 boards met is "not shown", not 0. A difference seen on fewer than 10 people's boards is "thin" and still listed. L9 is reported with count 3's kinds (A, B, B2, C, D, E) so the two notes lie side by side; a board where L9 and count 3 section 4 disagree is listed.

### The golden values (red team A1)
`scripts/runner-rework/facts-golden.ts`, run on the base commit, builds one board per branch of each of the 26 cases and writes `tests/fixtures/runner-facts/golden.json`: for each board, what every reader returns today (`breakPlans`, `runBypasses`, `bypassesAhead`, `iceCost`, `iceCreditNeed`, `approachCost`, `runScore` for the server, `serverHold`, and the Corp's rez decision for the ice on that board). Branches at least: Pressure Spike below and at threat 4 and with its once-per-run use spent; Malandragem in both modes and with its turn flag set; Curupira at 2, 3 and 6 counters; Banner on a barrier whose every subroutine is "End the run" and on a mixed one; Laser Pointer against each keyword and none; Fransofia Ward at 14 and 15 Corp credits; Lobisomem with and without a counter, on a barrier and not; S-Dobrado and Alarm Clock on the first ice, the second at threat 4 with and without a click; Mayfly, BANGUN, Hantu, Audrey, Corsair, Slap Vandal each on an ice they break and one they do not; Botulus and Tranquilizer hosted and in grip with 0, 1 and 2 targets; Physarum, Funhouse, Manegarm, Idiosyncresis; Chain Reaction, Window of Opportunity, Jailbreak, Read-Write Share at the decision that reads them. The script's header states the commit it ran on; the file is committed once and A-move may not rewrite it (a rebase regenerates it on the new base in a separate commit, and any changed value is explained line by line before the move continues).

Ends with `specs/r-a-log-note.md`, a hand-off, and a message to me.

## Part A-move: the facts move (`src`, full tier)
Branch `ai-runner-facts` from `origin/beta` at or after the commit that holds A-log's golden file (and so after 38ab2a97). Every identity proof is taken against the base of the commit the branch is cut from or last rebased on, never an older one. It may be built before beta is pushed to main but **does not merge before main**, and not before the memory fix `ai-runner-seen`; it is rebased on the fix and its proof is taken on that base.

### Step 1, before any move: the classification table (red team A3)
The builder sends me one table of the 26 cases, each in one class, and waits for my yes:
- **F, a plain fact:** a number, a flag, a subtype, a counter kind. Moves to a field.
- **C, a fact under a condition:** moves to a field in the typed condition vocabulary below. Expected here: Pressure Spike, Malandragem, Laser Pointer, Curupira, Fransofia Ward, Lobisomem, Banner, S-Dobrado, Alarm Clock.
- **P, a procedure:** stays in the code, listed with its reason for R-B. Expected: Window of Opportunity (an install simulated and the run priced on its result), Read-Write Share's full rule (the counted-question slot of R-B), Manegarm Skunkworks (three readers, one with its own flat 5).
- A case with **a price inside it** (Mayfly's 2, Audrey's 1 and 1.5, Hantu's 1.5 a counter, Lobisomem's 1, `trojanHostValue`'s 0.15, -3 and -1.5, Jailbreak's `RATES.drawnCard`): the fact moves, the price stays in the code that reads the field, at the same line of the computation, with a comment naming it.

### The condition vocabulary (`cards/types.ts`), facts only
One typed shape for "this card lets the Runner pass or break this ice when": the ice's subtype; a strength cap; a list of keywords in the ice's text; every subroutine is "End the run"; threat at least N; Corp credits at least N; first ice of the run, or the next one for a click; a counter kind and the count a use costs; once a run or once a turn, with the engine's flag name as L10 logs it; removed from the game on use. No field holds credits' worth. A condition the vocabulary cannot state makes the case class P; the vocabulary does not grow a free-form function to fit a card.

**Known exceptions, said up front.** The `run` entry is a function returning `RunOptions`, and `RunOptions.successBonus` is a worth (`runs.ts:1176-1177`); `gainsOnEncounter` is a function. Both stay as they are in A-move, each with a line in `docs/ai-priced-quantities.md` as debt ruled in B5. The three counter flats (Audrey 1, Lobisomem 1, Hantu 1.5) stand beside `counterWorthOf`, which `runBypasses` reads for Malandragem and Curupira: a duplicate added to B5's list and not touched here (they reach the Corp through `breakPlans`).

### What moves
1. **The card-number cases** of `runs.ts` and `runnerAI.ts`, by the table of step 1.
2. **The seven cards** (L3). The Runner's reader switches to the entry's field, and its own constant goes, only where all of these hold (red team A2): the golden boards walk every branch of the fact's condition; both readers agree there on the fact and on the number; L11 shows the field equals what the engine does on the same boards. Otherwise both stay, with a comment naming the B5 item.
3. **The run riders and the cards that start runs**: a run event's or run ability's options come from the card's `run` entry through one door. Today there are two (`runEventOptions`, and the run-event branch of `scoreMain`); the second reads the first.

### The rule that keeps play identical
- A move changes **where** a fact is read, never **what** a reader computes. Each reader keeps its policy, named in the entry's comment: the Runner's 5 for "or end the run", the walk's end, `iceStop`'s 4 credits, the flat price of an unrezzed ice, the "saves more than it costs" test of `runBypasses`.
- No reader starts reading a fact its price did not already contain. `cards/types.ts:29` is rewritten to say which fields both sides now read and which stay Corp-only, by name.
- Not in A-move: `src/ai/prompts.ts` (its 17 Runner card cases move with R-B's prompt work), any duplicate's removal beyond point 2, any fix. A bug found on the way is reported, pinned known-failing, and left.

### What the Corp reads of `runs.ts` (red team A5)
Not only `corp/hold.ts`. Importers on beta dd4004c: `corp/hold.ts` (`breakPlans`, `bypassesAhead`, `plannedSubroutines`, `runBypasses`, `subroutineFacts`, `bioroidBreakClicks`); `corp/rez.ts` (`iceCost`, `iceCreditNeed`, `accessTrap`, `isTrap`, `tagCost`, `BLOCK`); `rezModel.ts` (`bypassesAhead`, `iceCost`, `iceCreditNeed`); `effectValues.ts` (`subroutineCost`, `tankDamage`, `plannedSubroutines`, `iceCost`, `isTrap`); `iceValues.ts` and `corp/cardRules.ts` (`iceCost`); `corp/placement.ts` (`isTrap`); `evaluate.ts` (`remoteAgendaOdds`, `trapOdds`). Physarum (`iceCost` through `physarumCost`), Manegarm (`approachCost`) and Funhouse (`plainIcePrice`) sit inside functions the counted rez reads. The constraint is: **anything a Corp file imports from `runs.ts`**. The builder's hand-off lists every hunk inside or reachable from those functions, and the Corp-side coordinator reviews each one.

### Files
- Allowed: `src/ai/cards/types.ts`, `src/ai/cards/*.ts`, `src/ai/runs.ts`, `src/ai/runnerAI.ts`; a Corp file only where a field it reads is renamed (each line listed); `tests/runnerFacts.test.ts` (new: every moved fact read back from its entry; every golden board gives the golden numbers); `tests/codeHealth.test.ts` (red team A4: for `runs.ts` and `runnerAI.ts` a guard on every comparison with a card, that is `.cardCode ===`, an imported card-code constant, or a card title string; each one left is listed with its R-B reason and the list may only shrink; line caps by exactly the lines changed); `docs/ai-priced-quantities.md`; `scripts/runner-rework/facts-*`.
- Forbidden: `tests/fixtures/runner-facts/golden.json` (read only), `src/ai/prompts.ts`, `src/ai/corp/**` except as above, `src/ai/turnPlanner.ts`, `src/ai/runnerReply.ts`, `src/core/**`, `src/ui/**`, `.github/**`, `.claude/**`, any other test's expectations.

### Judged by (the bar, before any run)
1. **Identity by decision, three legs.** (1a) The branch tree and its base are asked at every decision of the 221 deals and the 38 human files (lockstep, as count 2's control check): 0 decisions differ on either side, 0 reply Runner steps differ, 0 errors. (1b) The same lockstep on the deals of one NRDB=1 g1 of the base. (1c) `tests/runnerFacts.test.ts` gives every golden number on every golden board, the file untouched.
2. **Identity by deals.** A g1 equals the g1 base of the branch's base on all 221 deals (winner, and the turn records `cr` and `sc` of `deals.json`); an NRDB=1 g1 pair, base and branch launched together, equal on every deal.
3. **The walk.** `scripts/stage-d/hold-baseline.ts` gives identical answers.
4. **Time.** Mean and p95 decision time of both sides within 5% of a control arm in the same run.
5. Typecheck, lint, the full tests (`tests/loadOrder.test.ts` named: it guards the load-order trap of `runnerAI.ts:18-20`); no pin changes state.
6. Every moved card is in the new test; the hand-off says, card by card, which leg proves it (a source, the NRDB pool, or the golden boards only); the code-health list holds only comparisons with a written reason.
A failure of 1, 2 or 3 is not read: the move that caused it is found and undone or corrected, and the check runs again.

### Review
Full tier: this spec's red team (done); the `review` skill by me on the hand-off; the Corp-side coordinator on every hunk the Corp reads. No checkpoint and no go from Jeff for the merge (his decision of 2026-11-19: R-A merges on its identity proof), after his go that ends the pause.
