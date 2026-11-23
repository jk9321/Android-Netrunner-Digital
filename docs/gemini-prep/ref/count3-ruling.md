# R0 count 3 (getting in): ruling

Runner rework AI Coordinator, 2026-11-19 22:27Z. Ruled by the reading rules of `brief.md` (written before the numbers) and `step0-ruling.md`. Note: `count-note.md`; run 44590458201 (221 of 221 deals match the g1 base 44381468776, 0 errors); sums spot-checked against `outputs/extra.txt` (card-started runs: control 44 of 71, (b) 46, (d) 45).

## 1. The lines on the record (rule 1)

| Line | People | Ruling |
|---|---|---|
| Second run on another server | 14 of 20 games | on the record |
| A run a card started | 17 of 20 | on the record |
| Money made, then spent in a run | 7 of 20 | on the record; every number behind it is thin (9 boards, rule 7) |
| Return after a successful run | 3 of 20, and once in report-33 | see below |
| Return after a failed run | 3 of 20, none in report-33 | not on the record: pinned (F3a to F3c), not built |
| Bait run | 0 | not on the record: pinned, not built (row 84) |

**A conflict in my own rules, said plainly.** Rule 1 says "4 or more of their 21 games"; the standing rules say report-33 (the Hard Corp game) is one of the 21 and is "read apart". The return after a successful run is 3 of 20, or 4 of 21 with report-33. I wrote both before the numbers and did not say which governs; this reading is chosen after them. I read it by the letter of rule 1: **on the record, 4 of 21**. It changes nothing that is built: in self-play, returning first is worse than control's pick on every repeat rule (HQ −0.24 ± 0.16, remote −0.55 ± 0.15, Archives −0.07 ± 0.17 Runner points), the people's trace is 5 boards (thin), and option (b) below already replaces the repeat rules that priced it. In the triage table it is listed as on the record with no measured cost and no item of its own.

## 2. Design question 1 (rule 2 to rule 4): option (b), alone

| Option | (i) time | (ii) flip | (iii) people's lines held | (iv) continuations | (v) hidden | Viable |
|---|---|---|---|---|---|---|
| (b) repeat rules repaired | 1.01x | +0.2 | card-started runs +0.028 ± 0.020 (2 boards up, 0 down, of 71); second run +0.00 | +0.11 ± 0.17 (210) | none, on the memory (below) | see below |
| (d) more than one priced run | 1.03x | +0.6 | +0.014 ± 0.032; second run +0.00 | +0.17 ± 0.13 (399) | none | **no**: (iii) |
| (c) runs played | 1.27x (report-33 1.54x) | **+26.2** | card-started runs −0.13 ± 0.05 | +0.09 ± 0.20 | none | **no**: (ii), (iii) |
| (c, 8 deals) | **7.67x** | +23.1 | −0.03 ± 0.05 | none | none | **no**: (i) |
| (c2) ice played | 1.22x (report-33 1.65x) | **+10.5** | second run +0.15 ± 0.08; card-started −0.20 ± 0.05 | +0.10 ± 0.21 | none | **no**: (ii), (iii) |
| (a) the walk | not built | | misses the grip or the money made in the turn in 107 of 127 self-play boards and 12 of 12 of the people's | | | not an arm |

- **Rule 2(iii) does not say whether "a line that is on the record" means every such line, any one, or the lines pooled.** Again mine, again read after the numbers. All three readings end in the same place: any one line, (b) passes (1.4 SE on card-started runs) and (d) does not; pooled over the 100 boards, (b) +0.02 ± 0.014 passes and (d) +0.02 ± 0.02 does not exceed 1 SE; every line, nothing is viable and rule 4's fallback is (b), which passes (i), (iv) and (v). **(b) is built. (d), (c), (c2) and (a) are not.**
- I do not claim (b) holds people's lines more. Its margin is two boards. (b) is built because the repeat rules are a fault by themselves (four flat rules beside owners that already read the state) and replacing them costs no time, no steadiness and no points. It changes 1.4 picks a game.
- **(d) was my leaning and the count does not support it.** At the board before a person's second run the run was already among beta's top four in 14 of 22 and ranked fifth or lower in 7; a price put it out once. The one-run cap is not what puts people's runs out; the ranking is. (d) is counted and parked, not built, and rule 5 (a red team of its three open points) falls away. It is asked once more, with the same scripts, after R-C2's new order exists: if the trace then says the cap puts a line out that the order no longer does, it gets a brief; not before.
- (c) and (c2) answer the question Gemini's review raised (A1, look ahead through played runs): the pick then follows the cards the deal invented (44% and 28% of seed asks change against control's 17%), and eight deals do not steady it at 7.7 times the time. Not built at any stage of this rework; a wider search with a work budget is Jeff's step 5, after the rework.

## 3. What this changes in the plan

- **R-C1** is now: the counted speed cuts (count 2) and (b). "Look-ahead through runs" is not built in R-C1. (b)'s owner for a remote on a repeat reads `remember`: the memory fix (`ai-runner-seen`, the first src merge after main) sits under it, and R-C1's brief counts (b) again on the fixed memory before it builds.
- **R-C2** takes the people's lines that are on the record: its coverage bar reads the people's first runs (41 of 127 ranked out, 9 priced out), second runs (7 of 22 ranked out) and card plays (6 of 23 ranked out), with count 4's over-running beside them (the model runs 1.82 times a turn, people 0.85): an order that only runs more does not pass.
- **Design question 1 is closed** for the rework: (b).

## 4. The triage table for R-D (rule 6), my proposed cut

Final only with count 2's numbers, in R0's report to Jeff. From this count:

| Item | Record | Proposed |
|---|---|---|
| Where the Runner runs (Stage D item 2) | on the record; trace: the ranking | **moves to R-C2's bar**, not an R-D item |
| Runs other cards start and what they feed | on the record (17 of 20) | **keep in R-D**: the feed (Side Hustle, Knickknack credits a run pays) is priced nowhere; the card's play ranked out 6 of 23 goes to R-C2 |
| Money made then spent in a run; which credits to spend | on the record, thin | keep, counted again when Jeff's new Corp games arrive, before any brief |
| Choices during a run | not a line of this count; 3.1 runs a game priced worth it and failed, 504 of 692 on ice rezzed in the run | keep for its own count (count 4 names unrezzed ice among the misses on people's boards) |
| Return after a successful run | on the record by the letter, no cost | no item: (b) |
| Return after a failed run; the bait run | not on the record | pinned, not built |
| Planner noise (item 9) | control's own pick changes with the seed on 17.4% of asks | to R-C2 (the order), a number to bring down, not an R-D item |
| Madani, "or end the run" cards, tag clock, B4's Runner half, item 35, game #54 | not counted here | unchanged, counted before any is built |

## 5. Passed on

- To the Corp-side coordinator: the walk's misses (it says the server holds and the Runner got in): 127 in self-play, of which at most 24 are on boards carrying a hold-inputs class (marks are per deal, so an upper bound) and the rest are the grip and money made during the turn, which the walk does not model; 12 of 12 of the people's are on unmarked boards. Section 4 of the note.
- One mark could not be read from a card fact ("a derezzed lender" for Mycoweb): a fact for R-A's card entries.

## 6. Deviations accepted

Self-play hold marks per deal, not per board (an upper bound, used only in the split above). (c, 8 deals) on a seeded sample, by my step 0 ruling. Nothing else.

**Merged:** branch `ai-runner-getin-count` 5e2ab69 to beta as 7a42d19 (light tier: 7 files, all under `scripts/runner-rework/get-in*` and `docs/ai-batch-log.md`).
 CI run 44628529036 green on 7a42d19 (read 2026-11-19 23:09Z).
