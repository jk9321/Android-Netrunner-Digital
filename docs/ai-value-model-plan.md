# AI card value model plan

Approved by Jeff on 2026-10-27. This file is the working copy for anyone (Claude, Gemini or a person) continuing the work. Update the **Status** section whenever a step lands. The original discussion doc: https://claude.ai/artifact/FRSCNV6bvpe1iExG7VmNod

## Status

| Step | State | Branch / commit | Self-play Corp % | Notes |
| --- | --- | --- | --- | --- |
| 1. Exchange rates module (no behaviour change) | Done 2026-10-27 | `claude/project-thread-3heaal` | 38.0% (221 games, identical to main 1724c6b) | `src/ai/valueModel.ts` holds today's numbers; same-seed self-play output byte-identical to main |
| 2. New rates (click, credit slide, clocks) | Done 2026-10-27 | `claude/project-thread-3heaal` | 37.7% (was 40.1% with all off) | Credit slide ON: Runner +2.6 pts, Corp +0.7 (noise). Points clock, hand filter ON (noise). Flat 1.25 click OFF: lost 2-3 pts for each side; re-test when a click is priced by the best play in hand. Race clock on credits not built yet. |
| 3. Counters by effect | Done 2026-10-27 | `claude/project-thread-3heaal` | 35.2% (was 37.7%) | `src/ai/counterValues.ts`, 23 cards, test each. Runner +2.5-3 pts, Corp noise. Lesson: a flat Smartware rate made the Runner stack it (-8 pts); stacked payouts must lose worth per turn of waiting. |
| 4. Card profiles | Done 2026-10-27 (money cards) | `claude/project-thread-3heaal` | 36.0% (was 35.2%, noise) | `src/ai/cardProfiles.ts`: Nico, Otto, Anthill, Regolith, Telework, Open Market by load/payout/schedule, 15% per turn waited, nothing past turns left. Other cards still hand-set in cardValues.ts (to profile or mark in the final audit). |
| 5. Ice and breakers in credits | Done 2026-10-27 | `claude/project-thread-3heaal` | 39.0% | 5a ice worth the Runner's cost to get past (`src/ai/iceValues.ts`): Corp +2.5 pts (36.0 -> 38.5). 5b breakers worth the stops they save, by shown ice + decklist odds: noise (39.0), kept. |
| 6. Remove special cases | Done 2026-10-27 | `claude/project-thread-3heaal` | 38.9% | deepReserve, iceReserve, hostedMoney switched off (neutral together); the others lose when off and stay on. Money operations read from card text. |
| Fix A (Jeff 2026-10-28): last hand-set cards | Done | 68f42f5 | batching | `src/ai/effectValues.ts` (plan.effectValues): the 31 hand-set-only cards plus the base worth of 14 counter cards, from what they do; a test each; audit fails on hand-set-only cards. |
| Fix B: free payouts | Done | 68f42f5 | 37.6% alone | plan.payoutRisk: turn-start payouts keep full worth less trash risk (Corp asset 3-6%/turn, Runner resource 2%, 25% tagged); clicked payouts wait 7%/turn. |
| Fix C: run scoring in model units | Done | 17023fa | batching | plan.runModel (runs.ts serverWorth, spendCost, runClick): credits on the slide, steals on the point clock + share denied to the Corp, remote agenda odds rise with ice, traps priced by damage (flatline = 32). plan.subCosts: tags/damage/trashed cards/lost credits from rates. |
| Fix D (Jeff 2026-10-28 overnight): hand by card | Off | 57c11c3 | 31.9% both; each side loses ~4 pts using it | `src/ai/handValues.ts` (plan.handByCard), off both sides (23f21d0), kept; Runner overdraws 55% of turns with it: each card in hand worth 70% of its played worth (45% if not affordable yet), floor 0.5; best cards up to the limit; unseen draws at the deck average. Replaces the flat 1.6 a card. |
| Fix E: value hacks replaced by the model | On | 3761037 | 31.0% (rez group back: 31.7%) | plan.modelHacks {rez, rezPriority, purge, bonuses, iceAdvance}: rez/advance/counter/purge/Petty Cash/Top-Down bonuses from the model. Nanomanagement/Touch-ups kept as a finish-the-agenda priority tier. |
| Fix F: Fermenter, Conduit, Mayfly | On | a35e090, 932d784 | 30.4% | plan.cardFixes: banked virus counters wait (purge risk), Conduit priced by extra accesses on runs still to come, one-use breakers (Mayfly) a third. |
| Fix G: click priced by best play | Runner only | b57d227 | 23.5% both; Corp side 21.6%, Runner side neutral | plan.clickByPlay, Corp off (23f21d0); kept settings 25.2%, same with G off 26.6%: own clicks worth the average of the best uses of the clicks left (what playing a card now adds over holding it, or draw/credit), 1 to 3 credits. clickRate on for both sides. |
| Hand schedule (Jeff 2026-10-28) | Off | 511d38f, 57557d0 | 24.9% both; Corp only 14.1%, Runner only 42.9% | plan.handSchedule: hand and click value from one plan of the next 2 turns. Each side much worse with it: a one-step AI with plan-valued hands procrastinates. Kept, off. Lesson: hand and click pricing needs the whole-turn planner. |
| Counter formulas, model discards | On | ead8e14, c417d8d | 25.6% (formulas off 24.7%, discards off 26.0%; noise) | plan.counterFormulas: the last 20 hand-set counter rates from what each counter turns into. plan.keepByModel: discards and trashes from hand by played worth. |
| Whole-turn planner for Normal | On | 26fc538 | batching at 85b2d96 | `src/ai/turnPlanner.ts` (plan.turnPlanner, plan.plannerHand): the top 4 candidates played to the end of the turn by the rule-based AI, runs not played out (click + expected worth), no peeking; end of turn valued with hand by card. About 3x slower batches; Jeff accepts the slowdown. |
| Damage and tag clocks | On | 91e150d | batching | plan.damageClock: damage priced by the odds of a flatline from the Corp's damage cards against the grip. plan.tagClock: tags priced by the Corp's punishers in HQ (odds for the Runner) and the cost of clearing them. |
| Last two hacks: finish, Conduit | On | 5ebeee5 | batching | modelHacks.finish: Nanomanagement/Touch-ups by the points they finish less the agenda's board worth. modelHacks.conduit: Conduit ice placement by the accesses it denies. |
| Short batches (Jeff) | Done | fc9fae3 | | 3 games a pairing (663 games, about ±3.7 pts) first; topped up to 2,210 only when the result is close. Same seeds as the full batch. |
| Run openness for engine cards (Jeff) | On | df6b7fd | batching | plan.runOpenness: Docklands, Leech, Pennyshaver, Conduit, Cacophony by the odds the rig gets through each server's ice (rezzed ice the rig can afford, unrezzed by the Corp's money), so they fade as servers lock down. |
| Agendas on the board and in hand | On | 85b2d96 | batching | plan.agendaBoard: an installed agenda is worth its point gain, discounted by the odds of a steal each Runner turn until it can be scored, less the clicks and credits still to pay. Agendas and ice in hand from the same formulas. |
| Final flat-value scan | Written 2026-10-28 | | | See **Final flat-value scan** below. |
| Flat rates from the model | On | 8ef6f20, 43a33a6, 89a2b33 | 24.7% full system; off 21.3% (Corp +3.4 pts with it) | plan.flatRates {points, flatline, cards, coreDamage, tags, hosted, breakers}: the scan below built. Agendas in Archives priced as a likely steal (archivedAgendaLoss, rule 7.3.2). |
| Run pace measured (Jeff) | Done | f01f346, 3d3131a | | `scripts/pace.ts` + `pace-sum.mjs` (or the Actions workflow with script = pace): PACE and AGENDA_RUN are measured averages. Re-measure after EVERY Corp or Runner AI change. |
| Agenda tempo | On | 8e19ade | 24.7% full; short batch off 23.2% vs 22.6% (neutral) | plan.agendaTempo: an agenda's worth counts the Runner turns it sits exposed before it can be scored. |
| Same-position caching | Done | 62ff956 | same-seed output identical | valueModel memo(): run odds, agenda odds, tag loss worked out once per position. The slow deal went from 73 s a turn to under 1 s. |
| Batches on GitHub Actions (Jeff) | Done | 847d4f3 (main 4c849dc, 77e9081) | | `.github/workflows/ai-batch.yml`: 64 shards, a full 2,210-game batch in about 5 minutes; results on the `ai-batch-results` branch. Pass the full commit SHA as ref. |
| Switch-off check, full batches (2026-10-28) | Done | 62ff956 | full system 24.7% | Planner off for Corp 22.8%, for Runner 27.5% (helps each side, keep). Flat rates off 21.3% (keep). Damage clock off 26.0%, tag clock off 23.8%, run openness off 23.5%, agendas on the board off 24.7% (noise, all kept on). Nothing switched off. |
| Run pace re-measured | Done | a3b53d9 | 24.3% full system | 2,210 games at 26b182c: runs 1.17, HQ 27%, R&D 23%, Archives 13%, remotes 37%, success 83%, AGENDA_RUN 0.43. Conduit only 19% of runs on R&D (844 runs; the Runner does not lean on R&D with Conduit). |
| Old vs new head-to-head (Jeff) | Done 2026-10-28 | a3b53d9 vs 1724c6b | old vs old 40.1% | `scripts/head-to-head.ts`, 2,210 games each. New Corp vs old Runner: Corp 35.3% (new Corp 4.8 pts WEAKER). Old Corp vs new Runner: Corp 33.3% (new Runner 6.8 pts stronger). New vs new 24.3%. |
| Corp fix (Jeff: no 35% Corp) | In progress 2026-10-29 | 307dad4, 456fc94 | | `scripts/steal-odds.ts`: the Corp's steal guess was about half the real rate (open remote 43% vs 82%). plan.stealOdds (measured: run 0.84, income 2): 35.1%. plan.hqSteal: lost even calibrated (29-31%), off. Every value switch off: 40.1% (= old Corp). Only board/agenda pieces 32.3%, only planner 33.2%, only economy 38.5%; minus every piece that lost alone 40.0%. |
| Runner reply (Jeff) | On | 456fc94 | **41.9% vs old Runner** (old Corp 40.1%); self-play 35.1% (was 24-26%) | plan.runnerReply, `src/ai/runnerReply.ts`: the Corp planner plays the Runner AI's next turn on each candidate board (grip/stack redealt from unseen cards, R&D shuffled, 2 samples) and scores the board at the Corp's next turn. Games about 3x slower; a full batch about 15 min. |
| Per-side switches + rez timing | On | 50a3b8a, 0acad73, b72eb3d, 3566955 | **Final: new Corp vs old Runner 45.8%** (old vs old 40.1%, +5.7); old Corp vs new Runner 32.8% (new Runner +7.3); self-play 41.5% | `sideOff` in synergy.ts: only effectValues stays off for the Corp (44.4 vs 46.3 on). Model rez choices lost (44.4) because they rezzed Manegarm/Anoetic Void/AMAZE on the Corp's turn; `runTimed()` keeps run-timed cards for the run (rules 3.3.2, 3.6.3), now even (46.3), back on. Traps accessed 71% of the time (trap log). Pace re-measured (1.19 runs, AGENDA_RUN 0.40). |
| Issues with the new system (Jeff, before any Corp rebalance) | Found 2026-10-28 | `claude/project-thread-3heaal` | 38.8% full system | https://claude.ai/artifact/GduREr1PTu2HvH4LKY5MR5. Payout wait kills Open Market/Telework/Otto; Runner overdraws (hand filter); rich Runner skips runs (runScore still in old units); Mayfly overvalued (one-use breaker); Hard ~1.3-2x slower. Tool: `scripts/behaviour.ts`. Fix order in the doc. |
| Final: every-card value audit (Jeff) | Done 2026-10-28 | `claude/project-thread-3heaal` | | `src/ai/valueAudit.ts` + test; report `npx vite-node scripts/print-card-values.ts` (31 cards still hand-set only). A coverage test that lists every card in the pool and how it is valued (profile, counter entry, hand-set number, ice/breaker formula, simulated operation or event, agenda formula), failing for any card that falls to a default; plus a per-card report for Jeff. |

The 'Improve AI run and protection budgeting' work is paused (Jeff, 2026-10-27) until this rework is done. Then we check whether it is still needed.

## Final flat-value scan (2026-10-28)

Every card now has a formula: no card in `CARD_VALUES` falls back to a hand-set number with the model on. What is left are rates, named guesses and Corp priorities.

**(a) Flat rates still used, to convert before the head-to-head**

| Rate | Where | Proposed model value |
| --- | --- | --- |
| Agenda point 8 (`RATES.point`) | accessWorth, agendaOdds, FLATLINE = 32 | Point clock (`pointValue`) by the score reached; a flatline is worth the rest of the game, `pointValue(7) - pointValue(corp score)`. |
| Drawn card 1.6 (`RATES.drawnCard`) | Mid-turn hand value, damage per card, draws in payouts | Damage: the average played worth of the cards in the grip (a random card is lost). Draws: the deck's average played worth. Mid-turn hand stays flat (the planner prices hands at the end of the turn). |
| Core damage 4 | Board, subroutine costs | One card of hand size for the rest of the game: the damage clock with the limit 1 lower, plus the hand filter lost. |
| Tags in two card formulas (fire 3, 2 tags) | effectValues lines 243, 271 | `tagsWorth`, as the board already does with plan.tagClock. |
| Hosted card 0.8 | Bling, Madani | The hosted card's played worth. |
| Breaker in hand: any-breaker 2 + 4, covered type 1 | handValues | The installed breaker formula (`breakerTypeWorth`, stops saved) less what the rig already covers. |
| Installed icebreaker +2, `rigCardScale` 2 | runnerRigValue | Breakers: coverage only (already in credits). `rigCardScale` only scales `defaultRig` for unlisted cards now; drop it. |
| Ice base 1, Corp's unrezzed hold-back 0.6 | iceWorth, handValues | Base 1 stays as a named guess (any ice slows a run). Hold-back: iceCost less the rez cost spread over the runs it will face. |

**(b) Named guesses, measured or tuned, not flat card values** (leave as is): PACE (self-play logs), AGENDA_RUN, LOCKDOWN, BLOCKED_PASS, UNREZZED_PASS, ICE_STOPS, ICE_STOP, FLATLINE_LANDS, VIRUS_WAIT, SOON, HAND_FLOOR, PAYOUT_RISK, SCHEDULE, DENY, AI_BREAKER_SHARE, credit slide and point clock curves.

**(c) Corp decision priorities** (Corp balance work, not value work): advanceScore tiers, iceFit nudges, keepBonus, ECON_SCALE (credits to corpAI install scores), defaultKeep / defaultUpgrade.

## Goal

The AI should value every card by what it does to four resources (clicks, cards, credits, counters), using one shared set of exchange rates, and turn all of it into progress toward agenda points (or a flatline). Today values come from four places that don't agree:

- hand-set numbers in `src/ai/cardValues.ts` (assets, upgrades and Runner rig cards only)
- board formulas in `src/ai/evaluate.ts` (ice = 1 + 0.6 × rez cost, about 8 per breakable ice type, 8 per agenda point)
- one-step simulation of operations and events
- about 50 card-code special cases and `tuning.plan` overrides in `corpAI.ts`, `runnerAI.ts`, `runs.ts` and `prompts.ts`

Example bug this causes: hosted Regolith credits counted 0.6 on the board but 1 once gained, which needed the `hostedMoney` patch.

## Exchange rates (`src/ai/valueModel.ts`)

All in credits. Starting points, tuned with batches.

| Resource | Rate | Notes |
| --- | --- | --- |
| Click | At least 1 credit; the best value per click among plays in hand; 1.25 default | Jeff. Raise the default if behaviour is off. Computed once per turn from a simple first pass, so it can't go circular. |
| Click saved (compression) | 1.25 per extra action | Humanoid Resources, Top-Down Solutions: each extra install or draw is a click saved. |
| Click taken from opponent | 1.25 + what it blocks | Worth more when it stops a score or a run this turn. |
| Card in hand | About 1 click up to the limit; 1 over = small plus; 2+ over ≈ 0 | One over is a filter: you discard your worst card, often dead ice (Jeff). Count the hand at end of turn. Runner: the hand is also its life total; cards up to the damage the Corp could deal before the next Runner turn are worth the flatline chance they prevent. |
| Credit | Smooth slide against a need, no hard cap | Marginal value 1.8 at 0 credits, 1 at the need, fading toward 0.3 above it. Need 15: at 1 → 1.75, at 14 → ~1.05, at 20 → ~0.55, at 30 → ~0.33. |
| Counter | What it turns into on that card | Never by counter type (Jeff). Botulus counter = credits saved breaking one sub on its host; Idiosyncresis = 3 credits Corp and −2 Runner; Fermenter = 2 credits when trashed. Unit test per card. Recomputed against the board each decision. |
| Agenda point | By score reached: 1-2 → 8, 3 → 9, 4 → 10, 5 → 12, 6 → 15, 7 → win | Board score is mine minus theirs, so stopping the opponent's next point gets as urgent. |

**Credit need** = the larger of a build target and the board need.

- Build target, worked out once per game from decklist averages, holds from turn 1 so early turns save up (Jeff). Corp: average rez cost of its ice × 2.5 layers + average agenda advancement cost. Runner: average credits its breakers need per Corp ice × 2.5 layers + average cost of its 3 most expensive cards. Likely 12-15.
- Board need: Corp, money to rez the ice it relies on now (today's `moneyTarget`); Runner, cost to break into its best target now (`runs.ts`).

## Card profiles

Each card describes what it produces; its value is computed from the rates and the turns left.

| Card | Profile | Works out as |
| --- | --- | --- |
| Regolith Mining License | 15 hosted credits, 3 per click | 3 credits per click vs 1.25 for a plain click, up to 5 clicks |
| Nico Campaign | 3 credits a turn for 3 turns, then draw 1 | 9 credits and a card over turns, no click |
| Pennyshaver | 1 credit per successful run, click to cash in | Depends on run frequency |
| Humanoid Resources | Draw 3, then install | Cards drawn + clicks saved |

- Installing: output minus install cost, rez cost and the click.
- Trashing an opponent's card: its remaining output plus what they paid. Same formula prices our own trash risk.
- In hand: installed value scaled down by how soon it can be played.
- Odd cards keep a hand-set number, marked as such. The coverage test fails for a card with neither.
- Later: read common wording ("gain N credits", "draw N cards", "place N credits") from card text to pre-fill profiles for new sets.

## Ice, breakers, agendas, tags, damage

- **Ice**: the credits the Runner must spend to get past it with their rig, times how often they'll run that server. Can't get past = full stop. Unrezzed ice counts only if the Corp can pay to rez it (Jeff's rule).
- **Subroutine costs** (Jeff): breaking can cost clicks (bioroids), counters (Botulus) or credits. A sub that fires is priced by what it does: clicks at the click rate, credits on the slide, a tag at its tag value, a trashed program at its profile value, damage as cards lost plus flatline risk, end the run as the run's value. Replaces the fixed numbers in `knownSubroutineCost` (`runs.ts`: tag 3, trash a card 4).
- **Breakers**: credits saved across the ice the Corp has shown or likely has (decklist), times expected runs. Replaces the flat 8 per type.
- **Agendas**: points at the point rate + counters + advancement already in them.
- **Tags**: worth the lower of the cost to clear (1 click + 2 credits) or the expected loss while tagged (best resource trashed, tag punishers in the Corp's decklist and seen cards, tag-conditional subs). Replaces 1.5 / 3 per tag + `tagThreat`.
- **Damage**: cards lost + the rise in flatline chance. Damage that kills or leaves the Runner within reach of what the Corp still holds is worth close to the game (Jeff): a damage clock like the agenda clock.
- **Race clock**: the closer either side is to winning (points or flatline), the more points are worth and the less spare credits are. Turns left is estimated mostly from points; the damage clock counts only as much as the Corp's decklist can deal (Jeff).

## Gaps and how they're handled

1. Turns left: see race clock above.
2. Run value (`serverValue`) comes from the model. Agenda odds for a facedown card start from decklist odds and rise with server investment (ice layers, rez cost, advancement, fresh install behind ice) (Jeff). Trap odds and Corp bluffing keep it honest. Include Runner trash costs.
3. Constraints (memory, hand size, link, unique) are usability checks; the cost of making room is priced by the model.
4. Identities stay special cases, one small module each with tests, returning model units (Jeff).
5. Double counting: as an asset pays out, its future value falls by the same amount.
6. Planning across turns: later, its own step. First a whole-turn planner for Normal; then goal values or Hard looking through its own next turn if needed.
7. Balance swings are expected and accepted (Jeff). Steps stay on the branch until results are at least as good as main.

## Rules for every step

- Each step is behind its own `tuning.plan` switch. A step that clearly loses in batches is switched off, never deleted. A neutral step that removes hacks stays on (Jeff).
- Normal and Hard both use the model (Jeff). Hard stays at 1 s per decision if possible; Jeff allows more if it makes Hard better.
- Balance target: self-play Corp 50 ± 5%. Report Corp loss reasons with every batch.
- AI bug fixes only need a small sample, not a full batch.
- Run pace (Jeff, 2026-10-28): PACE and AGENDA_RUN are averages measured from self-play (`scripts/pace.ts`, `scripts/pace-sum.mjs`). Re-measure them after every Corp or Runner AI change (either one changes how often and where the Runner runs) and update the constants.
- Check rules questions against the comprehensive rules (`Null_Signal_Games_Netrunner_Comprehensive_Rules_v26.03.pdf`) and cite the rule.
- Commit straight to main only for small fixes; this rework stays on a branch until Jeff approves a merge.

## How to test (any agent, local or cloud)

Needs Node 20+ and a clone of the repo, then `npm ci`.

- Unit tests: `npm test`. Types and lint: `npm run typecheck`, `npm run lint`.
- Self-play side balance with Corp loss reasons: `scripts/corp-losses.sh 10 normal` (2,210 games, about 20 minutes on 4 cores). Smaller sample for bug fixes: `scripts/corp-losses.sh 1 normal`.
- Behaviour (clicks, hoarding, overdraws, runs, plays per card): `SHARD=i/4 npx vite-node scripts/behaviour.ts -- 5 normal > beh-i.json` for i = 0..3 (accepts PLAN_OFF).
- Log every batch (Jeff): `node scripts/batch-log.mjs "<change>" out.txt` appends to `docs/ai-batch-log.md`.
- New vs old AI on the same deals: `scripts/ai-match.sh 5 normal`.
- Switch a piece off for a batch: `PLAN_OFF=name` or `PLAN_OFF=name.corp`.
- The `.sh` scripts need bash (on Windows: Git Bash or WSL). Without bash, run the shards by hand: `SHARD=0/1 npx vite-node scripts/corp-losses.ts -- 10 normal > out.json`, then `node scripts/corp-losses-sum.mjs out.json`.
- Noise: about ±2 points of Corp win rate (95%) at 2,210 games.
