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
| 6. Remove special cases | In progress | `claude/project-thread-3heaal` | | Batching the Corp money hacks off one at a time (moneyTarget, agendaMoney, iceReserve, icePacing, deepReserve, affordIce, rezMoney): neutral or better -> switch off (Jeff: fewer hacks is a win). |
| Later: whole-turn planner for Normal | Not started | | | |
| Final: every-card value audit (Jeff) | Not started | | | A coverage test that lists every card in the pool and how it is valued (profile, counter entry, hand-set number, ice/breaker formula, simulated operation or event, agenda formula), failing for any card that falls to a default; plus a per-card report for Jeff. |

The 'Improve AI run and protection budgeting' work is paused (Jeff, 2026-10-27) until this rework is done. Then we check whether it is still needed.

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
- Check rules questions against the comprehensive rules (`Null_Signal_Games_Netrunner_Comprehensive_Rules_v26.03.pdf`) and cite the rule.
- Commit straight to main only for small fixes; this rework stays on a branch until Jeff approves a merge.

## How to test (any agent, local or cloud)

Needs Node 20+ and a clone of the repo, then `npm ci`.

- Unit tests: `npm test`. Types and lint: `npm run typecheck`, `npm run lint`.
- Self-play side balance with Corp loss reasons: `scripts/corp-losses.sh 10 normal` (2,210 games, about 20 minutes on 4 cores). Smaller sample for bug fixes: `scripts/corp-losses.sh 1 normal`.
- New vs old AI on the same deals: `scripts/ai-match.sh 5 normal`.
- Switch a piece off for a batch: `PLAN_OFF=name` or `PLAN_OFF=name.corp`.
- The `.sh` scripts need bash (on Windows: Git Bash or WSL). Without bash, run the shards by hand: `SHARD=0/1 npx vite-node scripts/corp-losses.ts -- 10 normal > out.json`, then `node scripts/corp-losses-sum.mjs out.json`.
- Noise: about ±2 points of Corp win rate (95%) at 2,210 games.
