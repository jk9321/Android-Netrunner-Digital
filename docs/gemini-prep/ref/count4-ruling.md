# R0 count 4 (the Runner's two roles): ruling

Runner rework AI Coordinator, 2026-11-19. On `count-note.md` in this folder (branch `ai-runner-model-count` d24f72e, merged to beta as 6919a82, light tier). Read by the five rules of the brief, written before the numbers.

## Rule 1: is head-to-head a clean instrument?
**Not against the plain batch. Yes against a null head-to-head cell of the same commit.**
- With old and new the same commit, 14 (`h2h=corp`) and 13 (`h2h=runner`) of 221 deals differ from the plain g1, 5 winners. The cause is traced: the old AI is loaded as a second module graph, and three value caches that both sides share in one graph (`clearDamageThreats`, `clearBuildTargets`, `clearDeckShares`) stop being shared. One graph, or those caches cleared before each Corp decision, gives identical games.
- So every head-to-head cell of the rework is read paired against a null cell (old and new both the commit before the stage, same `h2h`), never against the plain batch. That is one more run a cell kind and stage; R-B's bar is written with it, and the size table gets it.
- Deal 2211 (the one deal where the two null cells differ from each other) is not traced. The count thread answered 20:44Z that it is not one replay: 2211 is the second game of shard 57, so the old graph's caches already hold the first game's entries when it starts, and naming the first differing decision and the cache that flips it means replaying both cells over the shard with every action logged and the three caches instrumented, about an hour of local compute. Not done today (Jeff 20:15Z: keep token use low). The likely cause (cache entries carried from one game of a shard to the next) is a guess, not a finding. By my rule an unexplained difference is traced before a stage uses the pair: the trace is a script step of R-B's spec, before R-B's bar is written; nothing before R-B reads a head-to-head pair.
- **A finding beyond the instrument, for the Corp side:** if those caches held values that depended only on their keys, clearing them could not change a game. It does, in 6% of deals. So in self-play one side reads a value the other side wrote for a board that is not the same, and against a person (one AI, one side) that sharing does not exist. Self-play and games against people differ by it. Told to the Corp-side coordinator: the caches and the registry's cache table are its side's.

## Rule 2: the baselines
Taken as counted, self-play and people apart, real grip and dealt grip. For R-C2's model bar ("not below these by more than 1 SE"):
- outcome of the turn, all four (A3): self 55.0 ± 1.2 real, 33.1 ± 1.0 dealt; people 9.3 ± 1.9 real, 6.2 ± 1.7 dealt;
- the move played among the first 4 (A2): self 98.6 real, 80.0 dealt; people 68.9 ± 2.1 real, 55.9 ± 1.3 dealt;
- first click (A1): self 42.0 real, 25.7 dealt; people 14.1 real, 9.2 dealt.
They are not judged here. What they say plainly: at a person's board the Corp's model of the Runner predicts the turn's outcome about one time in ten, even with the real grip.

## Rule 3: the dealt grip
**Material on both sources** (real less dealt, A3 all four: self +21.9 ± 1.1, people +3.1 ± 1.3; the grip-and-stack part alone +16.7 ± 1.0 and +2.3 ± 1.2). That part is how the Corp deals the Runner's grip: passed to the Corp-side coordinator, not the rework's to fix. On people it is small only because the model already misses most of the turn on the real grip.

## Rule 4: which misses the fast Runner must cover in R-C2
Over the line (20% of self-play's missed units, or 3 or more of the people's games):
- **a run a card or ability started** (26.6% self; 13 of 20 people's games);
- **a run priced below the top pick with nothing blocking it** (26.0% self; 9 games);
- on people only: an unrezzed ice priced it out (9 games), the model ran and was stopped (7), the run was blocked outright (5), the same breach with different points (4).
Listed, below the line: **a sequence of clicks** (18.6% on the real grip, 1 people's game). It is the cause on row 36's board (deal 1041: draw twice, then run), and R-C2's intake (always a run, a rig move and a money or draw move) is meant for it; it is not a required counted question on this count.
**Not in my rule and the largest disagreement, so added to R-C2's bar by name:** the model runs where the real Runner did not (self 814 units in 205 games; people 253 units in all 20 games; 1.82 runs a turn against people's 0.85). A Corp that plans against a Runner who runs twice as often as a person defends the wrong turns. R-C2's model bar reads A3's "breached" in both directions.
Gemini's review expected sequencing and unseen steals to be the gap. The count says card-started runs and run prices first, sequencing third.

## Rule 5: thin numbers
Report-54 (the only Normal Runner game against a person, 19 turns) and report-33 are single games: no result is read from them. Jeff's new Corp games go into the same script when they arrive.

## Row 36
Deal 1041 T10 reproduces (reply 0 of 8, deciding Runner 8 of 8). Deal 2121 T16 does not on today's record: the row is corrected to one board.

## Deviation
A, M and P ran in the thread's container before my 20:16Z note reached it. Accepted: the sources match the base 221 of 221 and the control differs on 0 of 3,625 boards. The two batch logs under `docs/batch-logs/` are the repository's usual place for a run's log; accepted as part of "the batch log".

**Merged:** beta 6919a82 (light tier); CI run 44611287325 green on that SHA (read 2026-11-19 21:54Z).
