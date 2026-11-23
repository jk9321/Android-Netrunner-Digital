# Runner rework R0, count 1: the audit map

Branch `ai-runner-map-count` @ 47f8f05 (base beta 3329250; src/ai unchanged since). Count only: no src change, nothing tuned. Brief: `brief.md` in this folder. Audit report: `/mnt/project-files/audits/2026-11-19-runner-rework-r0/report.md`.

## What the numbers say, in short

- **D1 is a hidden-information read (rule 1 met), pinned.** On a built board (Burner on HQ, an unaccessed upgrade in the HQ root), the memory holds the upgrade's identity and the HQ price moves with it: 0.488 for Malapert Data Vault, 2.774 for Anoetic Void, 7.100 for both with honest memory. Pin: `tests/runnerPins.test.ts` (known-failing).
- **A second class of the same leak changes play far more often: `recycled`.** The memory is keyed by instance id. An installed card that went back to HQ, R&D or facedown Archives and was installed again keeps its old memory entry, so the Runner "knows" what a new facedown card is (rule 1.12.3: it is a new object). In self-play, taking those entries out changed **65 of 953** asked decisions, in **24 of 221 games**. Human games: 8 changed decisions with the Hard Runner (2 games) and 5 with a person as Runner (1 game).
- **The replaced-breach class itself (the pinned D1 case) never came up** in these sources (0 `breachReplaced` decisions). `notAccessed`, cards put in memory by a successful run but never accessed, came up 30 times in self-play and changed 2 decisions.
- **D2 is a real leak by rule 2.** Answers change when only cards the Runner cannot know change, in two prompt kinds:
  - Mutual Favor's search answer moves with the stack order (rule 8.7.3: the deck is shuffled after the search);
  - Topan and Scrounge's host pick moves with the identity of a named facedown ice (rule 10.2.2b).

  Whether it is over the brief's 0.05 a game depends on what is counted, and the brief does not say:
  - changed answers: 0.036 a game;
  - the leaking prompt kinds answered on the real state: Mutual Favor search 0.095 and Topan 0.086 a game.

  No D2 pin is added until you rule. The boards are listed in D2.
- **D3: the memory is a second record of "seen" beside the engine's marks.** Per self-play game, the memory holds (all in part D3):
  - 15.0 decisions' worth of R&D cards the state does not mark;
  - 6.3 recycled;
  - 1.3 in facedown Archives;
  - 1.2 in HQ;
  - 1.3 cards not accessed yet, mid-breach.

  Only the entries for installed cards are read by a price. The rest sit unused until the instance is installed again, and then they become `recycled`.

## A. The decision map

Every place the Runner AI chooses, at beta 3329250. "Number" is what decides between the options; the levers it reads are in part B.

| # | Decision | Function (file:line) | What it compares | By which number | Callers that reach it |
|---|---|---|---|---|---|
| A1 | Which decision kind | `HeuristicRunnerAI.decide` (`src/ai/runnerAI.ts:75`) | prompt open, run under way, else main phase | none (a dispatch); `remember` runs first (`:77`, `:85`) | `chooseAction` (`:48`) from `GameRunner.step` (`src/ai/playout.ts:32`), the Corp's reply (`src/ai/runnerReply.ts`, `runnerReply`), the oracle play-out (`runnerReply.ts:16`), the planner's rollouts (`runnerAI.ts:221-228`, `answer`), the Hard AI's base and playouts (`src/ai/search.ts:114`, `:203`) |
| A2 | Main phase: full Read-Write Share | `readWriteFullShuffle` (`runnerAI.ts:453`) | a rule, before any ranking | Read-Write Share holds 4 (`:454`) | `mainAction` (`:201`), Hard `decide` (`search.ts:208`) |
| A3 | Main phase: the ranking | `rankMainActions` (`runnerAI.ts:234`) -> `scoreMain` (`:296`) | every legal action plus `makeRoomInstalls` (`:391`) | per action: END_TURN -0.5; INITIATE_RUN `runScore` on the Runner's view (+ Chain Reaction share); REMOVE_TAG flat 1.2 or 0.3; any other action `evaluate(after) - evaluate(before)` on the view after following up to 3 prompts (Corp prompts too, with synergy), plus the draw bonuses (1.5 bigger hand, 1.2 dig, `digValue`), the trojan host price, the saving-up +0.8/-0.4, the free-action cut 0.3; run events and run abilities `runScore` of their best server less `spendCost` (+ Jailbreak's `RATES.drawnCard`); Window of Opportunity its own path; then `nudge` (synergy.ts `nudge`, capped at `MAX_NUDGE` 1) | `mainAction` (`:206`), the planner (`rank`, `:228`), the Hard AI (`search.ts:210`) |
| A4 | Main phase: the planner | `plan` (`runnerAI.ts:220`) -> `planTurn` (`src/ai/turnPlanner.ts:463`) | the ranking's first `plannerCandidates('runner', PLANNER.candidates)` actions, each played out to the end of the turn (`playout`, `turnPlanner.ts:172`) by a planner-off copy with the memory copied; a remembered line is followed while the position key matches | `leafValue` (`turnPlanner.ts:307`: `evaluate` of the end) + each run's `runScore` + `runClick` (a run is not played out: `turnPlanner.ts:220-232`, `step`), less `runCreditSpend` from the rest of the turn | `mainAction` when `plannerOn('runner')` (`runnerAI.ts:207`); planner-off copies never plan |
| A5 | Saving up for a run | `saveUpTarget` (`runnerAI.ts:417`) | servers the Runner is 1 to 7 credits short of (`runShortfall`, `runs.ts:1293`) | `serverValue` at least 4 | `rankMainActions` (`:246`), read by `scoreMain` (`:364`) |
| A6 | Dig for breakers | `rankMainActions` (`runnerAI.ts:243-245`) | fewer than 3 types covered and no run worth > 0 | `rigCoverage`, `runScore` | `scoreMain` draw bonus (`:357`) |
| A7 | Prompt answer | `promptAnswer` (`runnerAI.ts:283`) -> `answerPrompt` (`src/ai/prompts.ts:120`) -> `todayAnswer` (`prompts.ts:130`) | on the Runner's view, unless the prompt names a stack card or a Corp card of `runnerUnknownSlots` (then the real state: part D2) or the view's answer is illegal on the real state | the per-card blocks (part B, card cases) or the fallback: every legal answer simulated, `scoreOutcome` (`prompts.ts:44`: `evaluate` + 0.5 x keep difference + 0.8 or 1 x `runRestWorth`) after `followChain`, less a bypass's encounter cost (`bypassSkips`) | `decide` (`runnerAI.ts:78`); the Runner's own follow-up in `scoreMain` (`:326`, `:348`) answers its prompts with `answerPrompt` directly on the view; the planner's `answer`; every planner-off copy (Corp reply, rollouts) answers on the state it is given |
| A8 | "Run any server" prompt | `todayAnswer` (`prompts.ts:251-256`) | each server option | `runScore` with the source card's `run` options | A7 |
| A9 | A run: approach and movement | `runAction` (`runnerAI.ts:98`) | continue or jack out after passing ice | jack out when `creditsAhead` (`runs.ts:748`) > available credits | `decide` (`:80`) |
| A10 | A run: encounter | `encounterAction` (`runnerAI.ts:114`) | which subroutines to break and with what | `subroutineCost` each (`runs.ts:64`: SUB_RULES, else 2); the lethal one forced (`tankDamage`); `mustBreak` = cost >= 1 (`:127`); Botulus first; bioroid clicks (worst first, `approachClickReserve` for Manegarm); "can't get through" stop: credits below `iceCreditNeed` and the run-ending sub's earlier subs cost < 2 (`:160`); break all when `planCost(bestBreakPlan) <= tank + 0.5` (`:182`); else only the run-enders | `runAction` (`:103`) |
| A11 | Off-turn paid ability (Madani) | `chooseOffTurn` (`runnerAI.ts:56`) | USE_ABILITY actions only | `scoreMain` on the view (the free-action cut applies) | `GameRunner.step` in the Corp's `corp_action` window (`playout.ts:44`); Hard `chooseOffTurn` (`search.ts:226`) |
| A12 | The Runner in the Corp's look-ahead | `runnerReply` (`runnerReply.ts`, from `REPLY`) | the Corp's candidate turns, each followed by one Runner turn on `guessHidden` deals, 2 samples (+2 for close contenders) | a fresh `HeuristicRunnerAI({ planner: false })`: A1-A3, A7-A11 with no planner, NO memory (every accessed card forgotten; only `runnerKnows` and the engine's HQ/R&D marks remain) and no own view (the deal is the Corp's guess) | `corpAI.ts` planner's `reply` (`plan.runnerReply`) |
| A13 | The Runner in the oracle play-out | `setOraclePlayout` (`runnerReply.ts:16`) | `plan.oracle.safestRemote` (measurement switch) | a fresh planner-on Runner | oracle only |
| A14 | The Corp's other models of the Runner (not Runner AI decisions, listed because they price what the Runner will do) | `stealOdds`/`passOdds`/`canTank` (`src/ai/effectValues.ts:226`, `:193`, `:143`); the hold walk (`src/ai/corp/hold.ts`, `breakPlans` at `:617`, `subroutineFacts` at `:494`, `:517`, `:1147`) | pass odds per ice; the walk's own way in | flat 0.95/0.85/0.1/0.55/0.9 pass odds, `STEAL.run` 0.45; the walk's subroutine facts | Corp only |
| A15 | Hard Runner (switched off) | `SearchAI.decide` (`search.ts:203`) | the base ranking's first 4 | Monte Carlo playouts on `determinize` (`search.ts:90`: Corp unknowns dealt by `dealRunnerUnknowns`; the stack is NOT shuffled: kept on purpose) with `MIN_GAIN` 1, `MIN_Z` 1.5, `CLEAR_LEAD` 3, `MIN_SAMPLES` 6 | `createAgent('runner', 'hard')` |

Two structural facts the map shows:
- The ranking (A3) and the prompt fallback (A7) both price an action by simulating it and scoring the board; the run (A9, A10) prices by the run model (`runs.ts`). The planner (A4) mixes them: a run in a playout is `runScore`, never played. So "what a run is worth" has one owner (`runScore`), but a run event's riders reach it through two doors (the card's `run` entry via `runEventOptions`, and A3's run-event branch).
- The Runner inside the Corp's look-ahead (A12) is not the Runner that plays: no planner, no memory, no view. The private memory is read by every price that takes `memory` (part D3), so the two Runners disagree wherever memory holds a card.

## B. The levers, counted by name

The whole inventory is machine-made: `node scripts/runner-rework/map-levers.mjs` (output `levers.jsonl` in this folder: 250 entries: 185 numbers, 35 card codes, 30 switch reads, by file and function). The ones that decide play, by name:

### B1. Hand-set numbers in the ranking and the run steps (`src/ai/runnerAI.ts`)
| Lever | Where | Value |
|---|---|---|
| END_TURN score | `runnerAI.ts:299` | -0.5 |
| REMOVE_TAG flat score (with resources / without) | `runnerAI.ts:304` | 1.2 / 0.3 |
| Bigger-hand draw bonus | `runnerAI.ts:356` | +1.5 (with 2 clicks or room) |
| Dig-for-breakers draw bonus | `runnerAI.ts:357` | +1.2 (stack > 5) |
| Dig condition: types covered | `runnerAI.ts:244` | < 3 |
| Trojan host: unrezzed host | `runnerAI.ts:361` | -3 |
| Trojan host price | `runnerAI.ts:381-383` | 1 + 0.15 x min(iceStop, iceCost); second Tranquilizer -3, second Botulus -1.5 |
| Saving up: money / spending | `runnerAI.ts:366-367` | +0.8 / -0.4 (spend > 1) |
| Free-action cut | `runnerAI.ts:369` | score <= 0.3 -> -Infinity |
| Run-ability start bonus | `runnerAI.ts:339` | +0.3 |
| Prompt follow-up depth | `runnerAI.ts:323`, `:345` | 3 |
| Save-up target: worth / shortfall | `runnerAI.ts:419`, `:422` | >= 4 / 1 to 7 credits |
| Manegarm click reserve | `runnerAI.ts:444` | 5 credits a copy, else 2 clicks |
| Encounter: break threshold | `runnerAI.ts:127` | subroutine cost >= 1 |
| Encounter: "can't get through" stop | `runnerAI.ts:160` | subs before the run-ender cost < 2 |
| Encounter: break-all slack | `runnerAI.ts:182` | `planCost <= tank + 0.5` |
| Read-Write Share full | `runnerAI.ts:454` | 4 hosted |

### B2. The run model (`src/ai/runs.ts`)
| Lever | Where | Value |
|---|---|---|
| Unpriced subroutine | `runs.ts:65` | 2 |
| SUB_RULES flat prices | `runs.ts:116-159` | lose a click `clickRate`; ezaM 1.5; Tributary 2.5; Lethe 0.5 x trashed + 1; heap removal 0.3; R&D arrangement 0.4; "or end the run" 5 while a program is installed; Diviner 4; Capacitor 0.3/tag; gain 1 credit 0.3; gain 1 [credit] 0.8; gain N 0.4 N; draw 1 card 0.5; install 1.5 |
| Unrezzed ice credits guess | `runs.ts:598` | 1.5 (Corp >= 3 credits) / 0.5 |
| Repeat rules | `runs.ts:1145` (any earlier failed run on the server: 0); `:1080` (Archives a second time: 0); `:1101` (a remote a second time: 0); `:1086` (HQ: x 0.5 per earlier run) | |
| Agenda deny share | `runs.ts:928` `DENY` | remote 0.6, central 0.3 |
| Remote agenda bump for ice | `runs.ts:950` `iceBump` | + (1 - base) x min(0.45, 0.15 x ice), cap 0.9 |
| Archives facedown agenda odds | `runs.ts:982`, `:987` | 0.05, 0.1 with ice; at most 3 cards |
| Trap odds when not wary | `runs.ts:1097` | 1/3 |
| Rezzed asset trash floor | `runs.ts:1132` | 0.5 |
| Empty-grip run cost | `runs.ts:1404-1405` | 0.25 x flatline (grip 0), 0.25 x damageWorth(1) (grip 1) |
| Waste share of credits paid outside | `runs.ts:1421` | 0.5 / 0.25 / 0.1 by spare 2 / 4 |
| Corp can rez (rez tax) | `runs.ts:1414` | 4 credits with rezTax, else 1 |
| Window rerez share | `runs.ts:1415` | 0.5 x rez cost |
| Unrezzed ice share under rez tax | `runs.ts:1436` | 0.3 |
| Bioroid click price | `runs.ts:851` | 1.5 a click |
| Manegarm approach | `runs.ts:811-815` | 2 clicks or 5 credits |
| Boost guards | `runs.ts:536`, `:545`, `:552` | 3, 9, 2 (boost loop bounds) |
| Chain Reaction | `runs.ts:1499` | unrezzed card 1.5; ice cost + 2 |
| Weak ice | `runs.ts:1507` | 2 |
| Audrey | `runs.ts:436`, `:438` | discard 1.5, counter 1 |
| Bypass prices | `runs.ts:1231-1264` | second bypass 4, 2, 2; saving 100 (sentinel) |

### B3. Card-number cases in the Runner's code and the Runner half of `prompts.ts`
Runner code (`runnerAI.ts`, `runs.ts`): Window of Opportunity 34077 (`runnerAI.ts:28`, `:321`), Jailbreak 30028 (`runnerAI.ts:318`), Read-Write Share 36022 (`runnerAI.ts:447`), Botulus 30004 and Tranquilizer 30017 (`runs.ts:50-51`, `runnerAI.ts:21`), Mayfly 30032 (`runs.ts:47`), BANGUN 35068 (`runs.ts:48`), Hantu 35008 (`runs.ts:49`), Audrey v2 34004, Banner 34005, Lobisomem 34090, Pressure Spike 34092 (`runs.ts:431-434`), Corsair 36004, Slap Vandal 34026 (`runs.ts:440-441`), Physarum Entangler 34082 (`runs.ts:641`), Funhouse 30054 (`runs.ts:697`), S-Dobrado 34012, Alarm Clock 34078 (`runs.ts:769-770`), Manegarm Skunkworks 30042 (`runs.ts:795`), Idiosyncresis 35061 (`runs.ts:860`), Malandragem 34081, Laser Pointer 34016, Curupira 34015, Fransofia Ward 35021 (`runs.ts:1194-1197`), Chain Reaction 36001 (`runs.ts:1482`). 26 codes.
The Runner half of `prompts.ts`: Lobisomem 34090 (`prompts.ts:239`), Alarm Clock 34078 (`:259`), Window of Opportunity 34077 (`:266`), Manegarm 30042 (`:272`), Baker 36015 (`:280`), Rotary 36014 (`:321`), Read-Write Share 36022 (`:333`), Methuselah 36020 (`:338`), Knickknack 35033 (`:352`), Botulus (`:391`), Zahya 30010 (`:416`), Tao Salonga 30019 (`:427`); shared blocks the Runner reaches: AirbladeX (by step, `:147`), Meeting of Minds 34076 (`:153`), Salvo Testing 34031 / Strike Fund 34001 / "Pretty" Mary 34093 (`:144`). 17 codes.

### B4. Nudges
`nudge` (`src/ai/synergy.ts:677`), added to every finite main-phase score but END_TURN (`runnerAI.ts:251`), capped at `MAX_NUDGE` 1 (`synergy.ts:24`). For the Runner: own-deck term off (`tuning.synergy.runner` 0, `synergy.ts:37`), opponent term on (`tuning.counter.runner` 1, `:39`) with four rules (`COUNTERS.runner`, `synergy.ts:522-527`): Corp econ -> trashEcon 1.5, denial 1; Corp tags -> cleanTags 1.5; Corp damage -> bigHand 1.5; Corp operations -> hq 0.5. The keep bonus (`keepBonus`, `synergy.ts:718`, `tuning.keep.runner` 1) reaches every discard and prompt keep (`prompts.ts:31`). (Lead in leads-vc-tuning.md: Step S measured the Runner better without its tags, Corp -1.7 +- 0.8.)

### B5. Switches on the Runner's paths
`tuning.wary` (11 reads: `runnerAI.ts:223`, `:245`, `:302`, `:316`, `:332`, `:339`, `:423`; `prompts.ts:253`, `:261`, `:273`, `:281`); `plan().bypass` (7: `runnerAI.ts:321`, `runs.ts:649`, `:780`, `:1217`, `:1381`, `prompts.ts:259`, `:266`); `plan().oneAgendaGuess` (`runs.ts:941`, `:1125`); `plan().runCreditsSlide` (`runs.ts:1393`); `plan().hiddenDraws` (`turnPlanner.ts:338`); `plannerOn('runner')` (`runnerAI.ts:207`); `this.synergy` gates (`runnerAI.ts:246`, `:251`, `:347`, `:358`; `prompts.ts:427`); the planner's own (`PLANNER`, `plannerCandidates`); iceValues `plan().iceStopRunner`, `iceStopAnchor`, `iceGripCap`, `rezBudget`, `iceProtects` (`iceValues.ts:34-90`); the Corp's reply `plan().runnerReply`, `openSteal`, `openStealUnrun`, `plannerSeed` (`runnerReply.ts:51`, `:276`, `:284`, `:105`). Comments still name folded switches (`plan.drawCap` `runnerAI.ts:353`, `plan.readWriteFull` `:450`, `plan.answerCorpChoice` `:344`): read by no code.

## C. The registry's Runner rows, recounted at 3329250

| Row (docs/ai-priced-quantities.md, Runner) | Owner today | Second computations today (each a duplicate by rule 4) | Change since 2026-11-15 |
|---|---|---|---|
| Cost to get past one ice | `icePrice` (`runs.ts:596`) | `iceCreditNeed`/`plainCreditNeed` (`runs.ts:720`, `:731`, credits only, reader-like); the Corp's `passOdds`/`canTank` (`effectValues.ts:193`, `:143`) compare `iceCost` (credits + value) with credits (RM-PASSODDS-UNITS); the hold walk's own way past (`corp/hold.ts` via `breakPlans` `:617` and `subroutineFacts`); unrezzed ice: a 1.5/0.5 credit guess (`runs.ts:598`) beside `unrezzedDamageRisk` (`runs.ts:613`) | same |
| What an access is worth (steal) | `stealWorth` (`runs.ts:930`) | `accessWorth` (`effectValues.ts:299`, no deny share; read by Rotary `prompts.ts:322` and card entries) | same (2) |
| Agenda odds, Runner view | none named | `agendaOdds` (`effectValues.ts:255`), `remoteAgendaOdds` + `iceBump` (`runs.ts:937`, `:950`), `hiddenCardOdds` (`evaluate.ts`, via `oneAgendaGuess`), `hqAgendaOdds` (`runs.ts:1018`), `rdWorth` (`runs.ts:959`), `unseenTraps`/`trapOdds` (`runs.ts:883`, own pool) and the flat 1/3 (`runs.ts:1097`), Archives 0.05/0.1 (`runs.ts:982-987`) | same (5 + flats) |
| A tag | `tagsWorth` (`evaluate.ts:370`) | `tagCost` (`runs.ts:395`), REMOVE_TAG flat (`runnerAI.ts:304`) | same (3) |
| Damage taken | `damageWorth` (`effectValues.ts:310`) | the empty-grip term (`runs.ts:1404-1405`) | draw-back now one count (`drawBackClicks`, RM-DRAWBACK-TWO fixed) |
| Lethal tank | `tankDamage` (`runs.ts:680`) | readers: `encounterAction` (`runnerAI.ts:125`), `plainIcePrice` (`runs.ts:703`), `unrezzedDamageRisk` (`runs.ts:627`), `canTank` (`effectValues.ts:147`). Second encodings of 10.4.4: SUB_RULES' per-subroutine `lethal` (`runs.ts:88`), `runRestWorth`'s `damage > grip` (`runs.ts:1477`) | canTank now reads the owner (RM-TANK-NOT-SINGLE fixed) |
| Steal damage | `stealHit`/`knownStealHit` (`runs.ts:1060`, `:1065`) | none | single |
| Denial (trash a Corp card) | `corpCardValue` with `left` (`runs.ts:1119`, `:1132`) | Chain Reaction twice: `chainReactionBonus` (`runs.ts:1499`, flat 1.5 unrezzed, ice cost + 2) and its card plan (`cardPlans.ts:94`, `corpCardValue` without `left`) | same (RM-DENIAL-TWO-WAYS) |
| Where the Runner will run (next turn) | `runScore` | the Corp's own Runner models: `stealOdds` (`effectValues.ts:226`, `STEAL.run` 0.45) and the hold walk | Corp copy in threatModel deleted (11-16) |
| Where a program or resource goes | the install's outcome | `makeRoomInstalls` (`runnerAI.ts:391`), `trojanHostValue` (`runnerAI.ts:380`), the generic answer | same (3) |
| Runner income per turn | none | `RUNNER_TURN_INCOME` 4 (`iceValues.ts:27`), the hold count's `runnerEarnings` (`corp/hold.ts`) | same (2) |
| The Runner's guess of the Corp's hidden cards | `runnerUnknownSlots` + `dealRunnerUnknowns` (`runnerReply.ts:143`, `:164`) | `unseenTraps` (`runs.ts:883`) and `remoteAgendaOdds`'s off path (`runs.ts:944`) build their own pools; `unrezzedDamageRisk` (`runs.ts:617`) a third | same |
| NEW: What the Runner has seen of the Corp's cards | the engine's marks: `runnerKnows` (`src/core/engine/actions/run.ts:462`, `install.ts:178`), `knownInHand` (`src/core/engine/helpers.ts:306`), `knownInRd` (`src/core/engine/rdKnowledge.ts:117`) | the private `memory` (`runnerAI.ts:33`, `:85-96`): a second record of installed cards seen, kept by instance id across zones; read by `serverWorth` (`runs.ts:1110`), `unseenTraps` (`runs.ts:891`), `needsBiggerHand` (`runs.ts:1155`), `runnerUnknownSlots` (`runnerReply.ts:147`), `runnerDecisionView` (`turnPlanner.ts:344`), `taoSwap` and `bypassSkips` through `serverValue` | new row (part D) |

**Readers of a subroutine's text** (rule 4: the same fact read more than once is a duplicate even when they agree):
| Fact | Readers |
|---|---|
| A subroutine's price to the Runner | `SUB_RULES`/`knownSubroutineCost`/`subroutineCost` (`runs.ts:95-215`); consumers `encounterAction` (`runnerAI.ts:121`), `plainIcePrice` (`runs.ts:694`), Mycoweb's borrowed (`runs.ts:99`, `:206`), `canTank` (`effectValues.ts:145`), Botulus' prompt (`prompts.ts:394`) |
| It ends the run | `SUB_RULES`' third column / `subroutineBlocks` (`runs.ts:210`; consumers `plainCreditNeed` `:733`, `bioroidClicks` `:826`); `subroutineFacts` (`runs.ts:321`; consumer the hold walk `corp/hold.ts:494`, `:517`, `:1147`); `hasEndTheRun` (`corp/rez.ts:18`, literal regex); the all-ETR barrier test in `breakPlans` (`runs.ts:514`); Banner's literal test (`runnerAI.ts:121`). **5 encodings.** |
| The damage it does | `subroutineDamage` + `subroutineTags` (`runs.ts:659-673`, consumer `tankDamage` only); `SUB_RULES` damage patterns (`runs.ts:105-108`, `:110-115`, `:131-136`, `:146-149`); `subroutineFacts`' `clauseEffects` (`runs.ts:283`); the Corp's `cardDamage` (`effectValues.ts:356`, Corp cards' text). **3 readers of subroutine damage.** |
| Gains on encounter / Mycoweb's borrowed subs | `plannedSubroutines` (`runs.ts:41`, `gainsOnEncounter`); `borrowedSubroutines` (`runs.ts:163`); the hold walk filters "resolve 1 subroutine on" itself (`corp/hold.ts:1147`) and `runs.ts:168` |

**Card facts the two sides read from different places** (requirement 2 of the rework): Botulus (`holdFacts.breaksHostSubroutine`, `cards/systemGateway.ts:65`, vs `BOTULUS`/`botulusBreaks`, `runs.ts:50`, `:59`); Tranquilizer (`holdFacts.runnerTurnStart.derezHostAt` 3, `systemGateway.ts:163`, vs `trojanHostValue`'s 3, `runnerAI.ts:383`); Physarum Entangler (`holdFacts.hostBypass`, `liberation.ts:520`, vs `PHYSARUM`/`physarumCost`, `runs.ts:641-648`); Funhouse (`holdFacts.encounter`, `systemGateway.ts:392`, vs `runs.ts:697`); Jaguarundi, Seraph, Paywall (`holdFacts.encounter`, `liberation.ts:236`, `:726`, `vantagePoint.ts:319`, vs SUB_RULES' text patterns). `cards/types.ts:29` says it: the Runner's run prices do not read `holdFacts`.


## D. Hidden information: the Runner's memory and its prompt answers

How it was counted: `scripts/runner-rework/map-hidden.ts` (4 local shards; the Actions queue was full). Summed by `map-hidden-sum.mjs`; the output is `d-count-summary.txt`, and the raw JSON lines are in `d-count-raw/`.
- **Sources:**
  - the 221 deals of g1 base 44381468776, played by a plain GameRunner on a `source` tree;
  - **all 221 match the batch record** (cr, sc, winner), so there is no stop;
  - the 38 human fixtures, kept apart:
    - 14 Hard Runner games against a person (`humanCorp:hard`);
    - 1 Normal Runner game against a person (`humanCorp:normal`);
    - 23 games with a person as Runner, where a shadow Normal Runner is shown each Runner decision (`humanRunner`).
- **The asks** are made on a separate `probe` tree with a copied agent. The tree that plays the game is never asked or cleared.
- **Self-play control:** each control ask is compared with the move played. Control stops: **0 of 953**.
- **Human control:** the recorded moves are Hard, a person's, or from an older beta, so there a difference is not a stop.
- **HIDDEN-READ:** the measuring script reads the real board, to say what was true. The places are marked HIDDEN-READ in the script; no agent reads it.

### D1. `remember` after a successful run whose breach was replaced (rules)
- **The rules:**
  - 6.9.5a/b: the run is successful, then the Runner breaches the attacked server.
  - A card's "instead of breaching" replaces the breach (Burner, Eru, Beatriz, Privileged Access, Cataloguer).
  - 7.4.1a: the candidates are the cards in the root of the server being breached; with no breach there are no candidates.
  - 7.2.1: only an accessed card is seen.
  - 10.2.2b: the Runner learns hidden information only through a game effect or a rule.
- **The code:** `remember` (`runnerAI.ts:85-96`) puts every root card of each successful run's server into memory, with no check that the breach happened or that the card was accessed.
- **Who reads it:** `serverWorth`'s "seen it" branch (`runs.ts:1110`), `unseenTraps`, `needsBiggerHand`, `runnerUnknownSlots` (so the view keeps the card's real identity) and `taoSwap`/`bypassSkips` through `serverValue`.
- **Built board (`tests/runnerPins.test.ts`):**
  - Burner on HQ, with Malapert Data Vault or Anoetic Void unrezzed in the HQ root and the other card in R&D.
  - The engine leaves `runnerKnows` unset, and the memory holds the upgrade.
  - The HQ price is 0.488 against 2.774, and 7.100 for both once the entry is removed.
  - **Rule 1 is met**, so a known-failing pin is added.
- **Also built into the same class** (not run in these sources): cards that limit access (Adrian Seis 34046, Flagship 36064) and cards installed into the root during the Runner's run (Ablative Barrier 34034, A Teia 34039). The script labels these `notAccessed` and `installedThisTurn`.

### D3. Every card in memory that the state does not mark, by how it got there
Counts are Runner decisions where memory holds at least one such card. The distinct cards are in brackets.

| Class (how it got there) | self (221 games) | humanCorp:hard (14) | humanRunner (23) | humanCorp:normal (1) | Read by a price? |
|---|---|---|---|---|---|
| `recycled`: an installed card it saw went back to HQ, R&D or facedown Archives and was installed again. The id is the same, but it is a new object (rule 1.12.3) | 1,400 (40); **65 decisions changed** | 18 (2); **8 changed** | 13 (1); **5 changed** | 0 | yes: the root readers above |
| `notAccessed`: put in memory by a successful run, never accessed (an access limit or prohibition) | 30 (3); 2 changed | 0 | 12 (2); 0 changed | 0 | yes |
| `breachReplaced` (the pinned D1 case) | 0 | 0 | 0 | 0 | yes (built board) |
| `installedThisTurn`: installed into the root after the run that put the server in memory | 0 | 0 | 0 | 0 | yes |
| `preAccess`: a candidate of the breach under way, not accessed yet (memory runs ahead of the access by one step) | 290 (159) | 23 (12) | 15 (10) | 0 | yes, during the breach: the access order and the trash prompts are answered knowing every candidate |
| `other`: Spin Doctor, one case | 12 (1); 1 changed | 0 | 0 | 0 | yes |
| `hiddenZone:rd:seenBefore` | 3,318 (79) | 333 (6) | 0 | 0 | only `unseenTraps`' pool (composition, not position): see the thin spots |
| `hiddenZone:hq:seenBefore` | 268 (14) | 0 | 0 | 0 | as above |
| `hiddenZone:archivesDown:seenBefore` | 295 (6) | 0 | 0 | 0 | as above |

**Honest-memory asks.** At each decision where memory held an unexplained installed card, the same agent was asked again with those entries taken out.

| | self | humanCorp:hard | humanRunner |
|---|---|---|---|
| Decisions asked | 953 | 41 | 40 |
| Decisions changed | 68 (0.31 a game) | 8 | 5 |
| Games with a change | 24 of 221 | 2 of 14 | 1 of 23 |

By class, the 68 self-play changes are 65 recycled, 2 notAccessed and 1 other. Most of the changed decisions are runs: the Runner runs a recycled facedown card because it "knows" it is Manegarm, Urtica, Anoetic Void or an econ asset. Every changed decision is listed in `d-count-summary.txt`.

### D2. Prompt answers on the real state
`promptAnswer` (`runnerAI.ts:283-294`) answers on the real state when the prompt JSON names a stack card or a Corp card of `runnerUnknownSlots`. Each such answer was asked again with three changes on a copy:
- **P1:** the stack reordered, keeping the named cards.
- **P2:** the codes of unnamed unknown Corp cards permuted within their kind.
- **P3:** the codes of named facedown installed cards swapped with same-kind unknown cards.

Each change was asked with 2 seeds.

| Kind (self-play) | Real-path answers (a game) | Changed by P1 / P2 / P3 |
|---|---|---|
| Tāo Salonga swap (names ice) | 107 (0.484) | 0 / 0 / 0 of 107 |
| MuslihaT top (names the stack) | 105 (0.475) | 0 / 0 / n/a |
| **Mutual Favor search (names the stack)** | 21 (0.095) | **3 / 2** / n/a (4 decisions) |
| **Topan host (names ice)** | 19 (0.086) | 0 / 0 / **3 of 19** |
| **Scrounge host (names ice)** | 7 (0.032) | 0 / 0 / **1 of 7** |
| Magdalene host, Mutual Favor install, Madani host | 4 | 0 |
| All real-path answers | 263 (1.190) | 8 decisions changed (0.036 a game) |

Human games:
- 18 real-path answers in humanCorp:hard and 49 in humanRunner.
- One change: report-35 T10, Hermes bounce, which named ice and a root card, changed by P3.

Why it leaks:
- **Mutual Favor:** the answer simulates the install on the real state, so the stack order after the search (shuffled, 8.7.3) and the Corp's hidden cards reach the result.
- **Topan and Scrounge:** the host pick prices each facedown named ice by its real identity, where Tāo and Hermes price unrezzed ice by the 1.5/0.5 guess (`runs.ts:598`).

Boards for a pin, if you want one:
- self deal 1581 T4, Topan (inst-36 against inst-39 with P3);
- deal 2061 T4, Mutual Favor (P1).

### Reading by the brief's rules (laid out, not chosen)
- **Rule 1 (D1):** met on the built board, and pinned. The `recycled` class is the same read through another door: an identity the rules took away (1.12.3), read by the same prices. It changes play in 11% of self-play games. The pin covers the breach door only; a second pin for `recycled` is one built board away (Anthill trashed, returned to HQ and reinstalled, as in report-33).
- **Rule 2 (D2):** the leak is real; answers change with stack order and facedown identity alone. The 0.05 threshold can be read three ways:
  - **Per changed answer:** 0.036 a game, which is under 0.05, so no pin.
  - **Per leaking kind's real-path rate:** Mutual Favor search 0.095 and Topan 0.086 a game, both over 0.05, so pin.
  - **All real-path answers:** 1.19 a game, most of them blind to what they name (Tāo, MuslihaT).

  The two readings that differ part on whether a kind that can leak counts in full, or only the answers that actually moved in 2 seeds.
- **Rule 3:** every lever in B counts. There are 250 by the script, and B lists the ones that decide.
- **Rule 4:** the duplicates in C are:
  - "it ends the run": 5 encodings;
  - subroutine damage: 3 readers;
  - unrezzed ice cost: guess and risk apart;
  - agenda odds: 5 plus flats;
  - "seen": the memory beside the engine's marks;
  - card facts read from two places: 7 cards.

### Thin spots and which way each arm errs
- **Only installed entries were taken out in the honest asks.** The hidden-zone entries reach `unseenTraps`' pool as composition only; the Runner may legitimately know a card it saw went to R&D or HQ. So the 68 is a floor for the installed classes, and silent on composition.
- **The honest ask removes all unexplained installed entries at once,** so a change is not attributed to one entry when two are held. In practice, each of the 68 changes held a single installed class (by label).
- **`preAccess` was not asked honestly:** memory there leads the access by one step, inside the breach. It is a rules question whether the access-order and trash answers may use it. This errs toward under-counting.
- **D2 perturbations are 2 seeds each.** A kind with 0 changes can still leak on boards not drawn. This errs toward under-counting, and is thin for Topan (19) and Scrounge (7).
- **The `breachReplaced` class is 0 here** because these decks rarely play a breach-replacing card at a server with a facedown root card. Its rate in play is unknown; its effect is shown on the built board only.
- **Human samples are small:** 14, 1 and 23 games. The Hard Runner's numbers come from a Runner that is switched off.
- **The control ask has no stop in self-play (0 of 953),** so the probe tree reproduces the played decision.

## E. The pins that are the Runner's

| Pin | Kind | What turns it | Stage of plan rev 3 |
|---|---|---|---|
| `tests/runnerPins.test.ts` D1 (new) | known-failing | `remember` takes no unaccessed card; one record of "seen" | a bug fix (coordinator's brief); else R-B (the memory deleted for the engine's marks) |
| `tests/exploitPins.test.ts:88` Ballista alone on a root agenda | known-failing | V5/V22 one-owner fix and `runs.ts:138` "or end the run" (cause 2) | R-A logs, R-B rules (plan: row 72a with the difference logged in R-A); V-C item 1 builds only the in-run correction |
| `tests/exploitPins.test.ts:187`, `:230`, `:261` F3a-F3c bait run | known-failing | the repeat rules (`runs.ts:1145`, `:1101`) and the run term's "out" | R-C1 (repeat rules replaced) |
| `tests/exploitPins.test.ts:48` F2 money events | known-failing | Corp side (V-C item 5); the Runner's line is the red team's script | not the Runner's code (listed for the line it plays) |
| `tests/runnerRunsRead.test.ts:77`, `:88` (bugs #15, #34, #34b) | known-failing | "where the Runner will run" read by the Corp | R-D (the Corp's read of the Runner; parked) |
| `tests/readAssetTrash.test.ts:49`, `:54` (Otto Campaign) | known-failing | the Corp's read of this Runner's record of trashing | R-D (with item 2 of the rework list) |
| `tests/playOverHold.test.ts:75` (Wildcat Strike, the Runner's side) | known-failing | a Runner-side value of the Corp's pick | R-B or R-C2 (the Runner's prompt answer for the Corp's choice) |
| `tests/stageDPins.test.ts:383` report-40 T5 (Madani's hosted Chromatophores) | known-failing | card facts in one place (hosted breakers) | R-A |
| `tests/stageDPins.test.ts:478` report-33 T17 (Alarm Clock and Hannah runs feed Side Hustle) | known-failing | the Runner's earnings from run starters, as card facts | R-A (facts), then the Corp side reads them |
| `tests/valueB1Keys.test.ts:24`, `:41` (a Runner board priced on its own) | known-failing | the hand caches' keys (Runner stack priced once per decision) | R-C1 speed cuts (count 2) |
| `tests/synergy.test.ts:211` Urtica bluff advance | known-failing | depends on how the rebuilt Runner reads an advanced card | rounds after R-C2 |
| `tests/stageDPins.test.ts:345` game 54 T7 (Principia's 4) | known-failing | the hold count's Runner money | Corp side (`ai-hold-inputs`) |
| Exploit and human pins that pass today and pin Runner code: `tests/exploitPins.test.ts` F1 mirrors, `tests/lethalHq.test.ts` (Runner side passes), the ai-runner-fixes pins in `tests/runnerFixes*.test.ts` | passing | must stay green through R-A to R-C | all stages |

## Files
- `levers.jsonl`: the B inventory (`node scripts/runner-rework/map-levers.mjs`).
- `d-count-summary.txt`, `d-count-raw/`: D1-D3 (`SHARD=k/4 npx vite-node scripts/runner-rework/map-hidden.ts`, then `node scripts/runner-rework/map-hidden-sum.mjs <dir>`).
- Scripts: `scripts/runner-rework/map-trees.ts`, `map-hidden.ts`, `map-hidden-sum.mjs`, `map-levers.mjs` on `ai-runner-map-count`.
