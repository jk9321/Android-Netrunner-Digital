# tags-once count: sum of 4 files

## Checks
| pool | games | decisions | replays the batch record | base pick != source pick (corp / runner) | onceR pick != once (of asked) | max |evaluate once - onceR| | errors |
| --- | --- | --- | --- | --- | --- | --- | --- |
| batch | 2 | 581 | 2/2 | 1 / 0 | 0 of 59 | 2.84e-14 | 0 |
| nrdb | 1 | 330 | 1/1 | 0 / 0 | 0 of 33 | 1.42e-14 | 0 |
| issue58 | 1 | 71 | - | 0 / 0 | 0 of 8 | 0.00e+0 | 0 |

## (1) Corp decisions: changed picks against base
Unit: one decision the source game asks of the agent (GameRunner.step). Per pool; "per game" = changed picks / games; "tag board" = a tag in play or a tag-giving card in HQ or on the Corp board.

| pool | kind | decisions | on tag boards | once changed | once per game | once on tag boards | onceNoWait changed | onceNoWait per game | onceNoWait on tag boards | onceNoRisk changed | onceNoRisk per game | onceNoRisk on tag boards |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| batch | main | 161 | 158 | 5 | 2.5 | 5 | 5 | 2.5 | 5 | 7 | 3.5 | 7 |
| batch | rez | 37 | 37 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| batch | prompt | 40 | 40 | 1 | 0.5 | 1 | 1 | 0.5 | 1 | 1 | 0.5 | 1 |
| batch | all | 238 | 235 | 6 | 3 | 6 | 6 | 3 | 6 | 8 | 4 | 8 |
| nrdb | main | 99 | 99 | 2 | 2 | 2 | 2 | 2 | 2 | 2 | 2 | 2 |
| nrdb | rez | 10 | 10 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| nrdb | prompt | 19 | 19 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| nrdb | all | 128 | 128 | 2 | 2 | 2 | 2 | 2 | 2 | 2 | 2 | 2 |
| issue58 | main | 18 | 18 | 0 | 0 | 0 | 0 | 0 | 0 | 1 | 1 | 1 |
| issue58 | rez | 2 | 2 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| issue58 | prompt | 1 | 1 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| issue58 | all | 21 | 21 | 0 | 0 | 0 | 0 | 0 | 0 | 1 | 1 | 1 |

Size (all kinds, by the brief: under 1 changed pick in 10 games small, at or over 1 a game large, between: neither):
- batch once: 3 a game, large
- batch onceNoWait: 3 a game, large
- batch onceNoRisk: 4 a game, large
- nrdb once: 2 a game, large
- nrdb onceNoWait: 2 a game, large
- nrdb onceNoRisk: 2 a game, large
- issue58 once: 0 a game, small
- issue58 onceNoWait: 0 a game, small
- issue58 onceNoRisk: 1 a game, large

## (2) Runner decisions: changed picks against base
Unit: one decision the source game asks of the agent (GameRunner.step). Per pool; "per game" = changed picks / games; "tag board" = a tag in play or a tag-giving card in HQ or on the Corp board.

| pool | kind | decisions | on tag boards | once changed | once per game | once on tag boards | onceNoWait changed | onceNoWait per game | onceNoWait on tag boards | onceNoRisk changed | onceNoRisk per game | onceNoRisk on tag boards |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| batch | main | 143 | 142 | 3 | 1.5 | 3 | 4 | 2 | 4 | 8 | 4 | 8 |
| batch | run | 129 | 129 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| batch | prompt | 71 | 71 | 2 | 1 | 2 | 2 | 1 | 2 | 6 | 3 | 6 |
| batch | offTurn | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| batch | all | 343 | 342 | 5 | 2.5 | 5 | 6 | 3 | 6 | 14 | 7 | 14 |
| nrdb | main | 95 | 95 | 1 | 1 | 1 | 1 | 1 | 1 | 3 | 3 | 3 |
| nrdb | run | 57 | 57 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| nrdb | prompt | 50 | 50 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| nrdb | offTurn | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| nrdb | all | 202 | 202 | 1 | 1 | 1 | 1 | 1 | 1 | 3 | 3 | 3 |
| issue58 | main | 20 | 20 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| issue58 | run | 15 | 15 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| issue58 | prompt | 15 | 15 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| issue58 | offTurn | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| issue58 | all | 50 | 50 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |

Size (all kinds, by the brief: under 1 changed pick in 10 games small, at or over 1 a game large, between: neither):
- batch once: 2.5 a game, large
- batch onceNoWait: 3 a game, large
- batch onceNoRisk: 7 a game, large
- nrdb once: 1 a game, large
- nrdb onceNoWait: 1 a game, large
- nrdb onceNoRisk: 3 a game, large
- issue58 once: 0 a game, small
- issue58 onceNoWait: 0 a game, small
- issue58 onceNoRisk: 0 a game, small

## (2) access_trash answers that flip, by card

### every access_trash decision: 58 answers
| pool | card | answers | base trash | once keep>trash | once trash>keep | onceNoWait keep>trash | onceNoWait trash>keep | onceNoRisk keep>trash | onceNoRisk trash>keep |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| batch | Public Access Plaza | 18 | 1 | 2 | 0 | 2 | 0 | 6 | 0 |
(cards with no flip left out of this table)

### the 150 declined trashes of the decided-twice count (batch, nrdb): 15 answers
| pool | card | answers | base trash | once keep>trash | once trash>keep | onceNoWait keep>trash | onceNoWait trash>keep | onceNoRisk keep>trash | onceNoRisk trash>keep |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| batch | Public Access Plaza | 9 | 0 | 2 | 0 | 2 | 0 | 6 | 0 |
| batch | Mahkota Langit Grid | 4 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| nrdb | Hype Machine | 1 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| nrdb | Public Access Plaza | 1 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |

### issue #58 board (T3 to T6): 7 answers
| pool | card | answers | base trash | once keep>trash | once trash>keep | onceNoWait keep>trash | onceNoWait trash>keep | onceNoRisk keep>trash | onceNoRisk trash>keep |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| issue58 | Public Access Plaza | 4 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| issue58 | Otto Campaign | 2 | 1 | 0 | 0 | 0 | 0 | 0 | 0 |
| issue58 | The Holo Man | 1 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |

Declined-150 entries met in this run: 15 (the list has 158 entries over the 150 units). Of them base answers keep: 15.

## (2, rev 1) Where a tag sits in evaluate: the change for one more tag, in parts
Boards: every access whose trash gives a tag (the access board), and every board a tag was taken from (count 3). The board with one more tag and nothing else, base tree, the viewer's context; each part signed as it enters evaluate(·, viewer). rig by card: addRigCard from 0; its payoutWait part = the card's change less its change with the tagged risk off (onceNoWait tree).

| boards | view | n | mean total | mean tagsRunner | mean tagsCorp | mean rig | mean payoutWait | mean perTurn | mean rigRest | mean runnerCredits | mean runnerHand | mean corpCredits | mean corpHand | mean corpBoard | mean unsplit |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| batch: tag-giving accesses | runner | 9 | -8.65 | -3 | -3 | 0 | 0 | 0 | 0 | 0 | -0.57 | 0 | 0 | -2.08 | 0 |
| batch: tag-giving accesses | corp | 9 | 8.79 | 3.75 | 3.75 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 1.29 | 0 |
| batch: tags taken | runner | 17 | -9.43 | -2.95 | -2.95 | -2.44 | -0.05 | -2.39 | 0 | 0 | -0.32 | 0 | 0 | -0.77 | 0 |
| batch: tags taken | corp | 17 | 5.09 | 2.68 | 2.68 | 0.05 | 0.05 | 0 | 0 | 0 | 0 | 0 | 0 | -0.32 | 0 |
| nrdb: tag-giving accesses | runner | 1 | -8.73 | -3.25 | -3.25 | -1.88 | 0 | -1.88 | 0 | 0 | -0.35 | 0 | 0 | 0 | 0 |
| nrdb: tag-giving accesses | corp | 1 | 6.5 | 3.25 | 3.25 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| nrdb: tags taken | runner | 8 | -15.35 | -4.63 | -4.63 | -5.93 | 0 | -5.93 | 0 | 0 | -0.18 | 0 | 0 | 0.02 | 0 |
| nrdb: tags taken | corp | 8 | 10.48 | 5.09 | 5.09 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0.29 | 0 |
| issue58: tag-giving accesses | runner | 4 | -23.97 | -3.09 | -3.09 | -13.05 | 0 | -13.05 | 0 | 0 | -0.8 | 0 | 0 | -3.95 | 0 |
| issue58: tag-giving accesses | corp | 4 | 10.07 | 3.25 | 3.25 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 3.57 | 0 |

Rig parts by card (Runner view; sum over boards, and boards it moved on), tag-giving accesses and tags taken together, per pool:
- batch (26 boards): GAMEDRAGON™ Pro -37.16 on 6 (payoutWait 0, perTurn -37.16, other 0); Side Hustle -4.29 on 3 (payoutWait -0.77, perTurn -3.51, other 0)
- nrdb (9 boards): Eru Ayase-Pessoa -32.14 on 4 (payoutWait 0, perTurn -32.14, other 0); Hermes -9.67 on 7 (payoutWait 0, perTurn -9.67, other 0); Alarm Clock -3.28 on 1 (payoutWait 0, perTurn -3.28, other 0); Physarum Entangler -3.19 on 4 (payoutWait 0, perTurn -3.19, other 0); Fermenter -1.06 on 1 (payoutWait 0, perTurn -1.06, other 0)
- issue58 (4 boards): Verbal Plasticity -35.72 on 4 (payoutWait 0, perTurn -35.72, other 0); Touchstone -11.04 on 2 (payoutWait 0, perTurn -11.04, other 0); Devadatta Drone -5.43 on 3 (payoutWait 0, perTurn -5.43, other 0)

Issue #58 board, each access of the Plaza (Runner view): T, total, tagsRunner, tagsCorp, rig (payoutWait), rig by card
- T3 Public Access Plaza: total -20.224, tags -3.25 + -3.25, rig -8.895 (payoutWait 0, perTurn -8.895, rest 0), corpBoard -3.95, unsplit 0; Verbal Plasticity inst-73 -8.895 (pw 0, perTurn -8.895); answers {"base":"keep","once":"keep","onceNoWait":"keep","onceNoRisk":"keep"}
- T4 Public Access Plaza: total -22.912, tags -3.25 + -3.25, rig -11.337 (payoutWait 0, perTurn -11.336, rest 0), corpBoard -3.95, unsplit 0; Devadatta Drone inst-85 -2.673 (pw 0, perTurn -2.673), Verbal Plasticity inst-73 -8.663 (pw 0, perTurn -8.663); answers {"base":"keep","once":"keep","onceNoWait":"keep","onceNoRisk":"keep","onceR":"keep"}
- T5 Public Access Plaza: total -26.145, tags -2.913 + -2.913, rig -15.96 (payoutWait 0, perTurn -15.96, rest 0), corpBoard -3.95, unsplit 0; Devadatta Drone inst-85 -1.365 (pw 0, perTurn -1.365), Touchstone inst-91 -5.519 (pw 0, perTurn -5.519), Verbal Plasticity inst-73 -9.076 (pw 0, perTurn -9.076); answers {"base":"keep","once":"keep","onceNoWait":"keep","onceNoRisk":"keep"}
- T6 Public Access Plaza: total -26.618, tags -2.951 + -2.951, rig -15.995 (payoutWait 0, perTurn -15.995, rest 0), corpBoard -3.95, unsplit 0; Devadatta Drone inst-85 -1.395 (pw 0, perTurn -1.395), Touchstone inst-91 -5.519 (pw 0, perTurn -5.519), Verbal Plasticity inst-73 -9.081 (pw 0, perTurn -9.081); answers {"base":"keep","once":"keep","onceNoWait":"keep","onceNoRisk":"keep"}

## (3) The record as the oracle: what each tag the Runner took then cost
Unit: one tag taken (each +1 to the Runner's tags). cost = what the clearing spent (clicks and credits at base's rates on that board) + the share of each loss while it was open (a resource the Corp trashed, by tagLoss's owner; a tag punisher, the Runner's strength drop without its tag term). net = the loss less what the Corp paid for it. priced = tagsWorth of that tag on the board it was taken from (marginal, as runs.ts tagCost), each view.

| pool | tags | cleared | other removal | kept to end | with a loss | mean cost | mean net | mean priced (Runner view) | x2 | whole change of evaluate (Runner view) | mean priced (Corp view) | x2 | whole change (Corp view) | Runner view: nearer | Corp view: nearer |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| batch | 17 | 8 | 6 | 3 | 4 | 3.61 | 1.69 | 2.95 | 5.9 | 9.43 | 3.11 | 6.22 | 5.09 | one (|c-W| 0.65, |c-2W| 2.3) | one (|c-W| 0.5, |c-2W| 2.62) |
| nrdb | 8 | 4 | 4 | 0 | 3 | 6.46 | 3.97 | 6.61 | 13.22 | 15.35 | 7.73 | 15.45 | 10.48 | one (|c-W| 0.15, |c-2W| 6.76) | one (|c-W| 1.27, |c-2W| 8.99) |

By end and by what gave the tag (per pool):
- batch: ends cleared 8 (mean cost 4.06, priced R 4.1); removedBy:corp:RESOLVE_PROMPT 4 (mean cost 7.2, priced R 2.67); removed:RESOLVE_PROMPT 2 (mean cost 0, priced R 1.63); keptToEnd 3 (mean cost 0, priced R 1.15). given by corp:PLAY_OPERATION_OR_EVENT 2, corp:RESOLVE_PROMPT 5, runner:CONTINUE_RUN 8, corp:REZ_CARD 2. loss events seen by open tags: punish 6
- nrdb: ends cleared 4 (mean cost 4.01, priced R 6.86); removedBy:corp:RESOLVE_PROMPT 3 (mean cost 11.88, priced R 7.08); removed:RESOLVE_PROMPT 1 (mean cost 0, priced R 4.2). given by corp:REZ_CARD 3, runner:USE_ABILITY 2, corp:PLAY_OPERATION_OR_EVENT 1, corp:SCORE_AGENDA 1, runner:RESOLVE_PROMPT 1. loss events seen by open tags: trash 2, punish 3

Reading (the brief's rule, applied to each view):
- runner view: open: under 30 tags in batch
- corp view: open: under 30 tags in batch
- runner view, as a whole (rev 1 line): whole change batch 9.43 v 2 x cost 7.21, nrdb 15.35 v 12.91: OVERPRICED AS A WHOLE; largest part rig 3.56 (then tagsRunner 3.49, tagsCorp 3.49)
- corp view, as a whole (rev 1 line): whole change batch 5.09 v 2 x cost 7.21, nrdb 10.48 v 12.91: not overpriced as a whole; largest part tagsRunner 3.45 (then tagsCorp 3.45, rig 0.03)

## (4) Time: ms per ask, summed, per arm
| pool | base | once | onceNoWait | onceNoRisk | once / base | onceNoWait / base | onceNoRisk / base | onceR (every 10th) |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| batch | 50467 | 51358 | 50994 | 50275 | 1.02 | 1.01 | 1 | 8847 |
| nrdb | 26679 | 26305 | 26136 | 26422 | 0.99 | 0.98 | 0.99 | 2143 |
| issue58 | 7316 | 6985 | 6989 | 7208 | 0.95 | 0.96 | 0.99 | 426 |
