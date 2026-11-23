# R0 count 3: getting in (the note)

Branch `ai-runner-getin-count` (scripts only), tree beta 3329250. Run: ai-script **44590458201** (16 x 4 shards, about 1 h 50 min), 259 sources, 0 errors, **221 of 221 self-play deals match the g1 base 44381468776** (winner, cr, sc). Sources: 221 self-play games; the people as Runner, 20 games (report-40/40b/40c are one game) plus report-33 read apart (Hard Corp, 1 game); our Runner against a person as Corp, 15 games.
Outputs (`outputs/`): `run-44590458201.jsonl.gz` (every row), `sum.txt` (`get-in-sum.mjs`), `extra.txt` (`get-in-extra.mjs`), `deckmarks.json`, `marks-local-humans.jsonl`. Step 0: `step0/`.
The reading rules are the brief's, applied as written. "Thin" = fewer than 10 people's turns (rule 7) or fewer than 30 continuation pairs (ruling 4). I do not pick an answer; section 6 says which reading the numbers support and where they are thin.

## 1. The answer in short
- **On the record (rule 1):** a second run on another server (people 14 of 20 games), a card-started run (17 of 20), money then run (7 of 20). **Not on the record:** a return after a failed run (3 of 20; returning priced worse than control in self-play), a return after a successful run (3 of 20; same), the bait run (0 of 20).
- **No arm clears all five tests of rule 2 cleanly.** (b) clears (i), (ii), (iv), (v), and (iii) only on card-started runs, by +0.028 ± 0.020 (1.4 SE), a margin carried by 2 of 71 boards (2 up, 0 down). (d) clears (i), (ii), (iv), (v), not (iii). (c) and (c2) fail (ii) by 26 and 10 points and lose card-started runs on (iii). (c, 8 deals) fails (i) at 7.7x.
- Read (b)'s (iii) as a result: (b) is the only viable option, so rule 3 gives (b). Read it as two boards: none is viable, and rule 4's fallback is (b), which passes (i), (iv) and (v). **Both readings end at (b) alone.** (d) does not buy any people's line on this count: the people's second runs it was built for are held 4 of 20 by control and 4 of 20 by (d).
- Why (d) does not help: at the board before a person's second run, the run was in beta's top four candidates in 14 of 22 and ranked fifth or lower in 7. The one-run cap is not what puts it out. The ranking is (count 2, R-C).

## 2. L: the lines on the record
Turns with the line (a game; games with it at least once).

| Line | Self-play (221 g, 3134 turns) | People as Runner (20 g, 260 turns) | Our Runner vs a person (15 g, 212 turns) | report-33 |
|---|---|---|---|---|
| second run, another server | 3.62; 211 of 221 | 1.55; **14 of 20** | 4.67; 15 of 15 | 5 |
| return after a failed run | 0; 0 | 0.15; 3 of 20 (between: nothing 2, an install 1) | 0.07; 1 | 0 |
| return after a successful run | 0.39; 71 (rd 64, hq 24, archives 2) | 0.25; 3 of 20 (hq 4, rd 1) | 0.93; 10 (rd 12, hq 3, archives 1) | 1 (remote) |
| run a card started | 3.01; 193 | 3.65; **17 of 20** | 4.33; 15 | 8 |
| money made then spent in a run | 0.56; 78 | 0.45; **7 of 20** | 0.27; 4 | 1 |
| bait run | 0.11; 22 | 0; 0 | 0.13; 2 | 0 |

- People's card-started runs by card: Alarm Clock (34078) 17, Clean Getaway (35014) 17, Transfer of Wealth (35017) 10, Trick Shot (34087) 9, then 36010 5 and singles. Self-play's are the System Gateway events (30012, 30018, 30028, 30029: 560 of 665).
- **What they fed** (in the rig at the turn start, turns with a card-started run): Side Hustle 139 of 665 self-play turns, 8 of 73 people's, 5 of 8 report-33, 1 of 65 ours vs a person; Knickknack 5, 2, 0, 6.
- **Openings in self-play** (a return legal, priced by a repeat rule; the return played first against control's pick, paired continuations by GameRunner, Runner points / Runner wins):

| Rule | Boards a game | Taken | Return first minus control (n) |
|---|---|---|---|
| HQ halved per repeat | 3.04 | 19 of 672 | −0.24 ± 0.16 / 0.00 ± 0.03 (310) |
| a failed run's server is 0 | 4.33 | 0 of 956 | −0.33 ± 0.15 / −0.07 ± 0.03 (363) |
| a remote on a repeat is 0 | 5.52 | 0 of 1220 | −0.55 ± 0.15 / −0.10 ± 0.03 (366) |
| Archives on a repeat is 0 | 1.40 | 0 of 309 | −0.07 ± 0.17 / −0.02 ± 0.04 (172) |

  The openings are common, but returning is worse than control's pick, not better, so the self-play half of rule 1 does not put a return on the record. The repeat rules cost nothing measurable here; they mostly disagree with a walk nobody runs.

## 3. Traces: beta's ranking at the board before each run (the played move)
`candidate` = in the top four open moves; `rank` = open, fifth or lower; `price:*` = priced out (worth none, cost, out); `rule:*` = a repeat rule put it out.

| Source, line | n | Trace |
|---|---|---|
| self, first run | 1814 | candidate 1813, rank 1 |
| self, second run | 807 | candidate 807 |
| self, return after success | 82 | candidate 63, rule:hqHalved 19 |
| people, first run | 127 | candidate 77, **rank 41**, price 9 (worthNone 5, cost 3, out 1) |
| people, second run | 22 | candidate 14, **rank 7**, price:cost 1 |
| people, return after success | 5 (thin) | candidate 2, rule:hqHalved 2, rank 1 |
| people, return after a failed run | 1 (thin) | rule:failedZero 1 |
| people, card-started run (the card's play) | 23 | candidate 16, rank 6, price:out 1 (Diversion of Funds 34007) |
| ours vs a person, first run | 130 | candidate 117, rank 10, price:cost 3 |
| ours vs a person, second run | 78 | candidate 70, rank 6, price 2 |

Where our Runner and a person part, the ranking puts the person's run out about five times as often as a price does, and a repeat rule shows up on 3 boards in all.

## 4. G: three voices at each server (turn start and before each run)
Kinds as the brief names them. A = the Runner prices it out and got in (self-play: our Runner's own turn; people: the person got in); B = the walk ("restOfTurn") says it holds and the Runner got in; B2 = the walk does not hold, ran and failed; C = runScore says worth it and the run failed; D = the Runner prices it in while the walk holds; E = the Runner prices it out while the walk does not hold.

| Kind | Self-play (25,608 server-boards) | People (1,939) | Ours vs a person (1,833) | report-33 (111) |
|---|---|---|---|---|
| A, priced out, got in | 228 (money made before 124; a card started the run 89) | **27** (money 11, a card 11) | 33 (money 8, a card 18) | 2 |
| B, walk holds, got in | 127 (103 on unmarked boards) | 12 (12 unmarked) | 7 (5 unmarked) | 2 |
| B, the cause named | grip 41, grip+rez not made 25, grip+money 17, rez not made 12, money 8, grip+money+rez 8, money+rez 7, none named 7, holdFault Knickknack 2 | grip+money 4, grip+money+rez 3, money+rez 2, money 2, grip 1 | grip+rez 3, others 1 each (one Knickknack) | grip+money+rez 1, grip+rez 1 |
| B2, walk does not hold, ran and failed | 402 | 14 | 23 | 3 |
| C, worth it, run failed | 692 (ice rezzed in the run 504; no unrezzed ice 149; unrezzed ice left unrezzed 39) | 21 (rezzed in the run 11; none unrezzed 4; left unrezzed 6) | 32 (26; 6; 0) | 1 |
| D, priced in, walk holds: not run / ran, no / got in | 1152 / 500 / 85 | 78 / 18 / 9 | 14 / 39 / 5 | 6 / 1 / 2 |
| E, priced out on cost (worth > 0), walk does not hold: all / got in | 614 / 65 | 27 / 4 | 92 / 15 | 7 / 1 |
| E, nothing to take, walk does not hold: all / got in | 7177 / 121 | 368 / 20 | 568 / 16 | 25 / 1 |

**The walk with and without the marked boards** (ruling 5 and the 18:42Z note: the hold classes Knickknack, Audrey, Saci, Lionsmane rezzed on the server, a borrowing ice). The walk says "holds" on 2,908 unmarked and 764 marked self-play server-boards, "does not hold" on 17,536 and 4,400; people 210 / 19 and 1,555 / 155; ours vs a person 273 / 87 and 1,073 / 400. Its misses (B) fall from 127 to 103 in self-play when the marked boards go, and are unchanged for people (12 of 12 unmarked). So the hold-inputs bugs explain about a fifth of the walk's self-play misses and none of the people's; the rest are the grip and money made in the turn, which the walk does not model (plan section 5 (a)).
Marks by class: self-play is marked **at the deal level** (`deckmarks.json`: 53 deals, a borrowing ice 39, Knickknack 17; no Saci or Lionsmane in the self-play decks), so its marked count is an upper bound; people and ours vs a person are marked per board (borrow 16 / 53, Knickknack 158 / 325, Audrey 0 / 121, Lionsmane 0 / 13). **One mark I could not read from a card fact:** "a derezzed lender" for the borrowing ice (Mycoweb 35053). No card fact names a lender, so I marked every board where Mycoweb is installed on the server. That is why the borrow marks are wide.

## 5. Q: the five options
Built as patched copies (`get-in-trees.ts`); each arm changes only the deciding Runner, the reply's Runner is the same in every arm, so no Corp decision time changes (by construction: the Corp's code is not patched in any arm).
- **(a) not built.** One `serverHold` ask on the Runner's dealt view, all servers: 2.1 ms mean a decision (p95 6, max 79). What it cannot see (plan section 5): the grip, a held rez (fixed rez set), the money made during the turn; B above is what that costs on the record: the grip or money in 107 of 127 self-play misses and all 12 of the people's.
- **(b) repeatRepaired.** The four repeat rules are off while the Runner decides; each is replaced by an owner that already reads the state: a failed run's server by the board as it is now (the rezzed ice, the credits and clicks now); a remote on a repeat by the Runner's memory of the root (`remember`) and the cards gone from it; Archives on a repeat by the faceup cards and the stolen agendas gone; HQ halved by `hqAgendaOdds`' known cards (knownInHand). R&D unchanged (`rdWorth`'s knownInRd).
- **(d) runsPriced.** (b) plus the one-run cap lifted for the deciding Runner: a playout may price one run on each server. Open points (plan section 5), what I did: (1) the playout carries the click and `runCreditSpend`'s credits, as beta already does, and nothing else: no effect is written beside the engine; **not carried** (listed): Side Hustle's credits, Knickknack's, counters spent at the breach, cards trashed. (2) A priced run is written nowhere (runsThisTurn unchanged): neither successful nor failed, so Chain Reaction and Side Hustle read no run and (b)'s owners see none. (3) The second run is priced on the board the first left (its click and credits gone), the first's outcome not known; the Corp's credits are not reduced by rezzes in the first run.
- **(c) runsPlayed**: the run played in the engine on the playout's board (the Runner's dealt view) against a planner-off Normal Corp through GameRunner. **(c, 8 deals)**: the same on 8 deals of the view, value the mean. **(c2) icePlayed**: played to the approach to the server (6.9.4), the breach priced by `serverValue`, then ended as successful.

### Time, picks changed, flip
Self-play 14,712 decisions; control 86 ms mean, p95 315; flips on 759 planned decisions x 8 seeds. People 1,209 decisions; control 176 ms, p95 606; 221 planned decisions. (c, 8 deals) flip on a fixed seeded sample (42 self-play, 50 people's), ruling 1.

| Arm | Self-play: time mean / p95 | Picks changed a game | Flip, points over control (control 17.4%) | People: time mean / p95 | People: flip over control (control 11.8%) | Ours vs a person: time; flip over control (13.9%) | report-33 time mean |
|---|---|---|---|---|---|---|---|
| (b) | 1.01x / 1.01x | 1.43 | +0.2 | 0.99x / 1.02x | +0.3 | 1.00x; −0.1 | 0.91x |
| (d) | 1.03x / 1.03x | 4.89 | +0.6 | 1.03x / 1.07x | −0.9 | 1.01x; −1.0 | 0.97x |
| (c) | 1.27x / 1.32x | 16.1 | **+26.2** | 1.44x / 1.32x | **+33.6** | 1.34x / 1.46x; +20.9 | **1.54x** |
| (c, 8) | **7.67x / 8.58x** | 19.8 | +23.1 (42) | **9.22x / 8.66x** | +30.6 (50) | 8.31x; +21.9 | 10.5x |
| (c2) | 1.22x / 1.27x | 12.0 | **+10.5** | 1.35x / 1.30x | **+19.8** | 1.21x / 1.20x; +4.6 | **1.65x** |

On the people's boards (d) changed 11.5 picks a game (230), against 4.9 in self-play: the people's boards hold more servers worth a second run.

### (iii) The people's lines held (the line's move in the arm's pick or plan, at the board before; paired arm minus control)
| Line (boards) | control | (b) | (d) | (c) | (c, 8) | (c2) |
|---|---|---|---|---|---|---|
| second run, another server (20) | 4 of 20 | +0.00 | +0.00 | +0.05 ± 0.09 | +0.05 ± 0.09 | +0.15 ± 0.08 |
| card-started run (71) | 44 of 71 | **+0.028 ± 0.020** (2 up, 0 down) | +0.014 ± 0.032 (3 up, 2 down) | **−0.13 ± 0.05** | −0.03 ± 0.05 | **−0.20 ± 0.05** |
| money then run, at the turn start (9, thin) | 1 of 9 | +0.00 | +0.11 ± 0.11 | −0.11 | −0.11 | −0.11 |
| return after a failed run (1, thin) / after success (3, thin) | 0 / 0 | +1 / 0 | +1 / 0 | 0 / 0 | 0 / 0 | 0 / 0 |
report-33 (read apart): card-started run 11 boards, control 8; (b) and (d) +0; (c) −0.09; (c, 8) −0.27 ± 0.14; (c2) +0.09 ± 0.16. Ours vs a person (our own record, for reference): card-started run 79 boards, (b) +0.03 ± 0.02, (d) +0.04 ± 0.02, (c2) −0.16 ± 0.06.
Pooled over the three lines on the record (100 people's boards): (b) +0.02 ± 0.014, (d) +0.02 ± 0.02.

### (iv) Paired continuations on self-play boards where the arm's pick differs (arm first minus control first)
| Arm | Pairs | Runner points | Runner wins |
|---|---|---|---|
| (b) | 210 | +0.11 ± 0.17 | +0.05 ± 0.04 |
| (d) | 399 | +0.17 ± 0.13 | +0.02 ± 0.03 |
| (c) | 221 | +0.09 ± 0.20 | +0.03 ± 0.04 |
| (c2) | 220 | +0.10 ± 0.21 | +0.06 ± 0.04 |
| (c, 8) | 0 | thin (none by ruling 2) | |
None is worse than control; none is better by more than 1.3 SE. Win rate is reported only.

### (v) Hidden information
No arm reads the Corp's unseen cards, the stack order or future draws: (b) and (d) read the Runner's view, its memory and the price; (c), (c, 8) and (c2) play on the Runner's dealt view, with the deal's Corp answering. **One caveat for (b):** it leans on the Runner's memory, and count 1's lead says `remember()` may mark a whole root seen when the breach was replaced; the memory fix (before R-A, `ai-runner-seen`) sits under (b). The record's own `minRez` field reads the true board; it is labelled HIDDEN-READ, feeds only the C split of section 4, and no arm sees it.

### (d)'s changed picks (self-play, 1,081; ruling 6)
- Its plan held 1 run 466, 2 runs on 2 servers 418, 3 runs 63, 4 runs 7, none 127. The second priced run was on a remote 220, R&D 153, HQ 81, Archives 34. **The record of the first run is marked nowhere in every one** (point 2 above).
- (d) runs first where control did not: 420. Control ran and (d) did not run first: about 250, of which **control's run is not in (d)'s plan at all: 108** (0.49 a game; R&D first in 58 of the 250).
- The continuations split by kind (Runner points / wins, n): plan of 2+ runs +0.21 ± 0.19 / −0.01 ± 0.04 (177); plan of 0 or 1 run +0.13 ± 0.18 / +0.05 ± 0.04 (222); (d) runs first where control did not −0.03 ± 0.22 (164); **control ran and its run is not in (d)'s plan +0.08 ± 0.44 / +0.03 ± 0.10 (36, wide)**.

## 6. Which reading the numbers support, and which way each arm errs
- **Rule 2 by option.** (b): (i) yes, (ii) yes, (iii) yes on card-started runs only (1.4 SE, two boards), no change on the second run, money then run thin; (iv) yes (210); (v) yes, with the memory caveat. (d): (i), (ii), (iv) (399), (v) yes; (iii) no: +0.014 ± 0.032 on card-started runs, nothing on second runs. (c): (i) yes on the 20 games and in self-play, no on report-33 (1.54x); (ii) no (+26); (iii) no, worse on card-started runs (−0.13 ± 0.05); (iv) yes. (c, 8): (i) no. (c2): (i) no on report-33 (1.65x); (ii) no (+10.5, +19.8 on people); (iii) mixed: second runs +0.15 ± 0.08 (1.9 SE, on 20 boards), card-started runs −0.20 ± 0.05; (iv) yes.
- **Rule 3 / rule 4:** strict, (b) is the one viable option and wins; read (b)'s two boards as no result, nothing is viable and rule 4's fallback is (b). Either way (b) alone. (d) is not ruled out by a fault on this count; it is ruled out by not holding the people's lines more. Its continuations are the best measured (+0.17 ± 0.13 on 399), not significant.
- **Where it is thin:** money then run (9 boards), both returns (1 and 3 boards), (c, 8)'s continuations (0), the 36 pairs where (d) dropped control's run, and every report-33 number. (b)'s (iii) margin is two boards.

**The errors the brief named:**
- *Runs into rezzed ice it cannot pass because it priced the second run as if the first had not happened.* (d) cannot run one server twice in a playout, and the second run sees the Runner's click and credits gone. It does not see the Corp's credits spent rezzing in the first, so it errs **cautious** on the second run (expects the Corp to rez with money it no longer has), not reckless. Not measured run by run; the continuations of (d)'s two-run plans are not worse (+0.21 ± 0.19, 177).
- *Stops running the first server because the plan prefers two cheap runs.* Seen: 108 changed picks where control's run is gone from (d)'s plan. The 36 continuations there are +0.08 ± 0.44: no measured cost, too wide to say there is none.
- *A plan built on a card the deal invented.* This is (c)'s and (c2)'s error, measured as the flip: the pick changes with the deal's seed on 44% (c) and 28% (c2) of seed asks against 17% for control, and more on people's boards. Eight deals do not steady it (33.7% on the sample, at 7.7x the time). (b) and (d) do not deal a run's outcome and flip like control.

**Which way each arm errs, in one line each.** (b): too little change (1.4 picks a game), safe, and it leans on the memory read. (d): cautious on a second run, can drop the first server for two cheaper ones, and does not carry Side Hustle's or Knickknack's credits, so it under-prices a card-started run that feeds them. (c): follows the deal's invented accesses and rezzes (flip +26), loses the people's card plays. (c, 8): too slow. (c2): steadier than (c) but still dealt (flip +10.5), loses the people's card plays, gains some second runs.

**Planner noise (Stage D item 9, for R-D):** control's own flip rate is 17.4% of seed asks in self-play, 11.8% on the people's boards, 13.9% on ours vs a person.

## 7. R: the triage table for R-D
Turns touched a game (self-play / people / ours vs a person); cost where this count measures it; the ladder level its trace points to.

| R-D item | Turns a game | On the record (rule 1) | Cost measured here | Trace level | Counted elsewhere |
|---|---|---|---|---|---|
| Return after a failed run | 0 / 0.15 / 0.07 | **No** (3 of 20 games; self-play return-first −0.33 ± 0.15 pts) | none: returning costs, not refraining | rule:failedZero (1 board, thin) | pins F3a to F3c |
| Return after a successful run (what R-C1's repeat rules leave) | 0.39 / 0.25 / 0.93 | **No** (3 of 20; HQ −0.24 ± 0.16, remote −0.55 ± 0.15, Archives −0.07 ± 0.17) | none | rule:hqHalved 2 of 5 people's boards (thin) | this note |
| Bait run | 0.11 / 0 / 0.13 | **No** | none | not traced | row 84, bait-run count |
| Choices during a run | C boards: 3.1 / 1.05 / 2.1 a game (worth it, run failed; ice rezzed in the run 504 of 692 self-play) | not a line of L | runs paid for and lost: not priced here | not traced here | flatlines by cause, `scripts/flatline-causes.ts` (needs its own count) |
| Runs other cards start and what they feed | 3.01 / 3.65 / 4.33 | **Yes** (17 of 20) | not measured on people's boards; Side Hustle in the rig on 21% of self-play's card-run turns, 11% of people's | the card's play: candidate 16, rank 6, price 1 (of 23); control holds it 44 of 71 | rows 61, 80a; report-33 pin |
| Programs hosted on Madani | not counted | — | — | — | `ai-madani-count` c340705 |
| Where the Runner runs (Stage D item 2) | first runs everywhere; second run 3.62 / 1.55 / 4.67 | **Yes** (second run 14 of 20) | A (priced out, the person got in): 1.35 server-boards a game | **rank**: people's first runs 41 of 127, second runs 7 of 22; price 9 and 1 | count 2 (the ranking), Stage D item 2 notes |
| Planner noise, asset lines, line memory (item 9) | every planned decision | — | control flip 17.4% / 11.8% / 13.9% | the planner | asset lines and line memory not counted |
| Which credits to spend (row 49), row 55 | money then run 0.56 / 0.45 / 0.27 | **Yes** (money then run, 7 of 20) | thin (9 boards); A after money made: 11 of 27 people's | not traced | rules thread (engine) |
| "Or end the run", Tailor, Baz, Arruaceiras | not counted | — | — | — | R-A logs the difference |
| Tag clock, B4's Runner half, item 35, game #54 | not counted | — | — | — | — |

By rule 6 (turns touched times cost): where the Runner runs, then card-started runs, then money then run (thin). The returns and the bait run are pinned. The items whose trace points to the ranking ("rank", not a price or a rule): where the Runner runs, and a quarter of the people's card plays. **Flag for rule 6:** these may belong to the ranking (R-C, count 2) or to the learned rounds, not to R-D.

## 8. Not counted here
Choices during a run, Madani, the choice of credits, "or end the run" and its cards, the tag clock: no line of L touches them directly, and the brief names other counts for them. Side Hustle's and Knickknack's credits are read from the rig at the turn start, not from what a run paid.

## 9. Scripts
`scripts/runner-rework/get-in-trees.ts` (the arms as patched trees), `get-in.ts` (the count: parts G, L, Q, A, C), `get-in-sum.mjs` (the sums), `get-in-extra.mjs` (card-started runs, money then run, (d)'s changed picks), `get-in-time.mjs` (step 0), `get-in-deckmarks.ts` (deal-level fix 6 marks). Re-run the sums: `node scripts/runner-rework/get-in-sum.mjs out/*.jsonl` and `node scripts/runner-rework/get-in-extra.mjs out/*.jsonl` on the extracted run (DECKMARKS and MARKS env as in `get-in-sum.mjs`'s header).
