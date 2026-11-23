# Ruling: the count of bundle R (rez and rez money)

**JEFF'S DECISION, 2026-11-20 03:51Z (decision card, do not re-open): "Leave it as known debt".** `keepPricedCentral` (C2) is NOT built. The pin "Whitespace toll, the decision" stays known-failing with its comment saying what was counted; the class and its trace are registry debt (the free gate's two owners of "free"; the priced rez's horizon) and a lead for the learned rounds; it is listed at the main push as known and not fixed (`beta-to-main-step.md`, 1f). The build is A and B only, with the two pin comments (C1, C2) and the registry lines.

AI Coordinator (Corp side), 2026-11-20 03:49Z. On `count-note.md` (branch `ai-rez-count` 9986f01, run 44663255479: 259 sources, 25,029 Corp decisions asked, control unlike beta 0, errors 0), read against the rule I wrote in `brief.md` before any number. Where my rule could not be applied as written I say so and do not reword it.

## In one paragraph
Two of the three findings are small, confirmed and go to the build as they are: the LEO fall-through (A) and R&D staked with no agenda left (B). The third (the Whitespace toll) splits. Its number (C1) is wrong in one window in 55 and changes no answer anywhere: not built, registry debt. Its decision (C2) is a real hole that no recorded game contains: on the pin's board the Corp rezzes Whitespace out of the money it needs for the remote, because a loss toll is "free" to the counted rez and the priced rez does not look at the rest of the Runner's turn. One arm closes it and changes nothing else on 259 sources (`keepPricedCentral`). That arm is a candidate by my rule and, by the same rule, Jeff's to decide (it widens where an existing check applies: a lever).

## A. `leoFallThrough`: a build candidate (rule 1)
LEO legal at 50 approach-server windows, `leoGain` not above 0 at 29, another stopper legal too at 0. Changed decisions 0, so none outside the class; no pairs, so the 2 SE reading has nothing to read. The pin passes on the arm's tree and its two mirrors keep their answers. Built: it is the code doing what its own comment says, in LEO decks that hold a second stopper (none of the recorded games had both at once).

## B. `rdStakeUnseen`: a build candidate (rule 2)
`agendasUnseen` is 0 at 464 decisions; money is kept for R&D at 11 of them (2 games). One changed decision (deal 1021 turn 12: keep 6 to 0, Nico Campaign installed in remote-5 instead of remote-1), on an unseen-0 board at the top, as the rule asks. Its one pair reads -2 win-adjusted points with no change of winner: one pair, reported, not a reading. The pin passes on the arm's tree.

## C1. `spentApart` (the number): not built; registry debt (rule 3, with its gap stated)
My rule had two branches and the count fits neither as written: `handed` differs from `real` at 13 of 55 windows (above 1 in 100), and no `spendsKept` answer changes (so there is nothing to pair). What the 13 are: 11 where the Runner AI paid more than the least it could (the rule's own "not the count's error"), 1 run that ended, and **1 window of the count's own error** (deal 1131 turn 14: Palisade approached on R&D, Whitespace rezzed further in; handed 17, real 24 in both worlds), which is the class I predicted and 1.8% of the windows. The only way to "candidate" in rule 3 is a changed answer, and there is none on 259 sources. So: **nothing is built for the number.** It goes to the registry as debt on the hold row (the hold owner returns the least pool, and `spendsKept` reads it as the credits taken; wrong where a credit threshold sits on the run), the pin "Whitespace toll: spendsKept hands..." stays known-failing with its comment corrected at the build (where the class can be reached), and it is listed for Jeff at the main push as known and not fixed (`beta-to-main-step.md`, 1e).
One thing carried into the build's judging: if C2 is built, `spendsKept` is asked at more windows (an approached Whitespace passed unbroken is one), so the build reports `handed` against `real` at the new windows; a changed answer there re-opens C1.

## C2 (the route): one candidate, `keepPricedCentral`; Jeff's card (rules 4 and 5)
**The trace (T).** In play the class "a loss toll under R3's or R4's conditions, the priced rez made, `spendsKept` true" is empty on all 259 sources (81 W windows, 45 rezzed, 0 with `spendsKept` true). On the pin's board the gain of the priced rez is +8.66 (the ice rezzed on the board +5.32, the Runner's credits +3.98, the rig +2.51, the Corp's credits -3.15); the Corp's 3 credits after the rez are below both its next-turn keep and its rest-of-turn keep (4, the remote's Sleipnir), and neither enters the gain; the Runner's 3 clicks left are played nowhere in it. Two layers produce the move: the free gate's "free" (one quantity with two owners: `iceCreditNeed` 0, the hold owner's `need` 10) and the priced rez's horizon.

| arm | (a) pin | (b) class | (c) pairs | (d) time | reading |
|---|---|---|---|---|---|
| `tollByHold` (the free gate reads the hold owner) | passes | 12 changed, all in W or traced; **all direction (ii)** (new rezzes), direction (i) 0 | points stolen worse by 1.4 SE all, 1.2 SE self-play (12 pairs); its 3 look-ahead pairs worse in every column | met | **not a candidate**: (c) fails |
| `keepPricedCentral` (F1's check asked of the priced rez under R3's or R4's conditions) | passes | 0 changed | none to read | met (1.005 mean, 1.013 p95) | **a candidate**: (a) and (d) met, (b) and (c) with nothing against them |
| `keepPriced` (the same on every server) | passes | 33 changed, **9 outside every class** (the count's stop) | self-play points stolen worse by 2.1 SE | met | **not a candidate**: (b) fails |

`keepPricedCentral` is on one of the trace's two layers (the priced rez's horizon), is the narrowest of the three, and is the only one with nothing against it. It closes the hole the pin shows and, on the evidence, does nothing else: the price of building it is 0 changed decisions in 259 games. What it cannot show is a gain in games, because the recorded games do not contain the class; the case for it is the one Jeff made for F1 (a hole a person can aim at), and it applies F1's own check, with F1's own owner (`spendsKept`), to the one rez branch F1's fix left out. By rule 5 it is his decision. **My recommendation: build it.**

Not candidates, kept as leads (found row 95): `tollByHold`'s direction (ii) at the board (9 pairs: Corp wins +0.22 ± 0.15, win-adjusted +0.67 ± 0.44, stolen -0.22 ± 0.43) against its 3 look-ahead pairs (each a lost game): "stop or toll: rez" for a loss toll may be right at the board and wrong inside the look-ahead; for the learned rounds. The free gate's two owners of "free" stay as registry debt.

## D. The 37 "rez not made" (found row 91)
They are 27 distinct runs. In 26 a window was not rezzed and in every one the answer was the priced rez's gain not above 0 (20 where no counted rule had an opinion, 6 at the free gate); none is a `spendsKept` pass, R5, a match-point pass or a Corp that could not pay. In 4 runs every asked window was rezzed and the unrezzed ice that the hold count relied on got no window. So the hold count's "holds" assumed rezzes the priced rez then declines: a disagreement between two owners of one question (found row 95), not a class of this bundle.

## What is built (the build brief follows this ruling)
1. A: `runStopper` falls through when LEO's trash is not worth it; line 244 goes.
2. B: R&D is staked only while `agendasUnseen` is above 0.
3. C2: NOT built (Jeff's card, 03:51Z). The pin's comment corrected; registry debt; `beta-to-main-step.md` 1f.
4. C1: not built. The pin's comment corrected; registry debt; `beta-to-main-step.md` 1e.
Full review tier: a red team on the build brief, then the builder, then my review.

## The count's own notes
- 47 of 21,273 self-play decisions differ between beta asked from a snapshot and the source game's move (fresh agents against the batch's long-lived ones); the control reproduces beta at all of them, so the count stands. The same effect as found row 90 (state carried by a long-lived agent); added there.
- The thread stopped at `keepPriced`'s 9 outside-class windows as rule 7 asks and read nothing from that arm. Right.
- `spentApart` was read at the recorded windows only (a whole-tree arm was too slow): accepted, the brief allowed it.
