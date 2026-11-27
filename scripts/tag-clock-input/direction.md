# Step 5 c: the direction table for step 9 (F114 + F110, brief tag-clock-input rev 2)

Written and committed before any arm game runs (RULE-BAR-BEFORE-BATCH). Source: ai-script run 45926149523 (MODE=probe on the merge base 3680b7f, head b2c7f2f), every Runner turn start read (every tagged one, one untagged in four with a resource). The Corp-view price of the next tag (tagsWorth(tags + 1) less tagsWorth(tags), the Corp deciding), base / C1 / P / C1+P, by Corp deck. A deck where an arm lowers it by 0.25 or more is "fewer" (may give fewer tags) for that arm; the others are "same" (did not move). Step 9 reads the column of the arm ruled in ruling 1: a fall in tags given in a "fewer" deck is reported; in the "same" decks taken together, a fall beyond two standard errors (unpaired, by game) is a stop and a finding.

```
  5c. direction table: Corp-view price of the next tag at Runner turn starts, base / C1 / P / C1+P, and the verdict per arm (lowered by 0.25+: "may give fewer tags")
   Advanced Yomi (52): 3.34 / 3.26 / 2.97 / 2.95 | C1 same, P fewer, C1+P fewer
   Agency (33): 3.09 / 2.28 / 3.09 / 2.28 | C1 fewer, P same, C1+P fewer
   Brick Stack (46): 2.74 / 2.63 / 2.74 / 2.63 | C1 same, P same, C1+P same
   Brutal Efficiency (36): 1.84 / 1.60 / 1.84 / 1.60 | C1 same, P same, C1+P same
   Discretion Advised (42): 2.40 / 2.45 / 2.40 / 2.45 | C1 same, P same, C1+P same
   Fashion Lab (23): 2.75 / 2.25 / 2.75 / 2.25 | C1 fewer, P same, C1+P fewer
   Fine Print (90): 1.61 / 1.58 / 1.28 / 1.27 | C1 same, P fewer, C1+P fewer
   Gimbatul (52): 1.94 / 1.94 / 1.37 / 1.39 | C1 same, P fewer, C1+P fewer
   Glyph of Warding (48): 1.80 / 1.66 / 1.31 / 1.06 | C1 same, P fewer, C1+P fewer
   Hidden Funds (64): 1.50 / 1.56 / 1.24 / 1.32 | C1 same, P fewer, C1+P same
   Hyper Velocity (83): 1.50 / 1.47 / 0.80 / 0.73 | C1 same, P fewer, C1+P fewer
   Not so subtle (55): 2.40 / 2.40 / 2.03 / 2.06 | C1 same, P fewer, C1+P fewer
   Peculiarity (30): 2.40 / 2.15 / 2.40 / 2.15 | C1 same, P same, C1+P same
   Pork Chops (40): 2.37 / 2.18 / 1.86 / 1.49 | C1 same, P fewer, C1+P fewer
   Quick Returns (38): 2.17 / 1.89 / 2.17 / 1.89 | C1 fewer, P same, C1+P fewer
   Quick and Dirty (49): 2.78 / 2.60 / 2.65 / 2.47 | C1 same, P same, C1+P fewer
   The Syndicate (starter) (35): 3.60 / 3.32 / 3.60 / 3.32 | C1 fewer, P same, C1+P fewer
  5c. direction table: Corp-view price of the next tag at Runner turn starts, base / C1 / P / C1+P, and the verdict per arm (lowered by 0.25+: "may give fewer tags")
   A Teia Startup (36): 1.38 / 1.25 / 1.38 / 1.25 | C1 same, P same, C1+P same
   Bioroid - Startup - Click Thief (20): 2.06 / 1.60 / 2.06 / 1.60 | C1 fewer, P same, C1+P fewer
   Built to Launch, 4th UK Nats/Megacity (Startup) (14): 0.89 / 0.64 / 0.89 / 0.64 | C1 same, P same, C1+P same
   De Profundis (43): 1.14 / 0.80 / 1.14 / 0.80 | C1 fewer, P same, C1+P fewer
   PT Untaian agendas/bluff/ambushes 4th at MC Łódź [Startup (58): 1.43 / 1.31 / 1.43 / 1.31 | C1 same, P same, C1+P same
   Reflections on the Past (36): 1.53 / 1.35 / 1.53 / 1.35 | C1 same, P same, C1+P same
   Steal a Stoke, Fan the Embers 2-0 (1st @ Startup Winter SD) (54): 0.66 / 0.68 / 0.60 / 0.62 | C1 same, P same, C1+P same
   Tempo ED (77): 2.18 / 2.13 / 2.10 / 2.05 | C1 same, P same, C1+P same
   Totes Undefeated Leo (19): 1.15 / 0.93 / 1.15 / 0.93 | C1 same, P same, C1+P same
   Zwift Deth (34): 0.70 / 0.56 / 0.70 / 0.56 | C1 same, P same, C1+P same
   [Start Up] Response Rush Nuvem (35): 0.80 / 0.69 / 0.80 / 0.69 | C1 same, P same, C1+P same
```
