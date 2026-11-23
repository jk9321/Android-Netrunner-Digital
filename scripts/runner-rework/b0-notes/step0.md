# B0 Part D — Step 0: Timed sample and size estimate

- **Branch:** `gemini-b0-count` (cut fresh from `origin/beta` @ `8efbf4f`, `src/ai` and `src/core` identical to `7fa8b6f`, g1 base run `45086908053`)
- **Script:** `scripts/runner-rework/b0-defensive.ts`, summarized by `scripts/runner-rework/b0-defensive-sum.mjs`
- **Source verification:** Plain `GameRunner` in isolated `source` tree verified exact match (`winner`, `cr`, `sc`) against `results/45086908053.deals.json` on deal 1001 and all 10 Step 0 deals.

## Timed sample (10 Runner losses from batch pool)

Command:
```bash
POOL=batch SEEDS=1031,1221,1281,1301,1321,2261,2281,2301,2321,2361,2391,2511,2781 LIMIT_LOSSES=10 VERIFY_JSON=/tmp/base-deals.json npx vite-node scripts/runner-rework/b0-defensive.ts
```

- **Games played to collect 10 qualifying losses:** 10 (all 10 flatlines: 4 `access`, 2 `corpTurn`, 4 `other`)
- **Mean source game time (1 core):** 19.70 s
- **Mean loss evaluation time (4 defensive lines via `GameRunner`):** 7.87 s

## Whole-count estimate vs Step 0 cap (3 runner-hours / 4 workflow runs)

| Run | Scope | Estimated runner time | Workflow runs |
| --- | --- | --- | --- |
| Batch pool defensive count (`ai-script`, `pool=batch`) | 221 deals (~25 qualifying losses) | ~1.26 h (76 runner-min) | 1 |
| NRDB=1 g1 base (`ai-batch`, `decks=vp-,lib-`, `games=1`) | 110 deals (11 Corp × 10 Runner) | ~0.60 h (36 runner-min) | 1 |
| NRDB pool defensive count (`ai-script`, `pool=nrdb`) | 110 deals (~15 qualifying losses) | ~0.64 h (38 runner-min) | 1 |
| People's games (`pool=human`, `report-54.json`) | 1 Normal Runner game | < 0.01 h (local) | 0 |
| **Total** | **332 games** | **~2.50 runner-hours** | **3 runs** |

Under both caps (≤ 3 runner-hours, ≤ 4 workflow runs) → proceeded with full count.

*(Note: After inspecting the 4 `other` flatlines in Step 0, `b0-defensive.ts` was updated to record `flatActivePlayer` and `flatLog` and rewind any Runner-turn flatline to that Runner turn itself before launching the full Actions runs.)*

## The 10 Step 0 losses

| Deal | Matchup | Event | Rewind | Start state (tags / grip / cr / corpCr) | Public conditions | Surviving lines | Gave up (stolen / breached / trashed / crDiff) |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1031 | The Syndicate vs Planning Ahead | flatline:other @T11 | T10 | 0 / 4 / 4 / 13 | none | do_nothing, remove_tags, draw_up, both | 6 / 2 / 0 / -5 |
| 1221 | Discretion Advised vs Professional Opportunities | flatline:other @T6 | T5 | 0 / 5 / 8 / 6 | none | do_nothing, remove_tags, draw_up, both | 0 / 2 / 0 / -1 |
| 1281 | Advanced Yomi vs Stolen Goods | flatline:access @T6 | T6 | 0 / 4 / 9 / 11 | none | do_nothing, remove_tags, draw_up, both | 0 / 1 / 0 / -1 |
| 1301 | Advanced Yomi vs Bowel Movements | flatline:corpTurn @T11 | T10 | 0 / 5 / 1 / 13 | none | do_nothing, remove_tags, draw_up, both | 0 / 0 / 0 / -3 |
| 1321 | Advanced Yomi vs Prick Thyself | flatline:other @T10 | T9 | 0 / 3 / 4 / 14 | dmg_any | do_nothing, remove_tags, draw_up, both | 0 / 0 / 0 / -6 |
| 2261 | Peculiarity vs Professional Opportunities | flatline:other @T2 | T1 | 0 / 5 / 5 / 11 | none | do_nothing, remove_tags, draw_up, both | 0 / 0 / 0 / -2 |
| 2281 | Peculiarity vs Enthusiasm | flatline:access @T14 | T14 | 0 / 3 / 9 / 3 | dmg_any | do_nothing, remove_tags, draw_up, both | 0 / 1 / 0 / -2 |
| 2301 | Glyph of Warding vs The Catalyst | flatline:corpTurn @T10 | T9 | 1 / 4 / 2 / 1 | none | do_nothing, remove_tags, draw_up, both | 0 / 1 / 0 / -4 |
| 2321 | Glyph of Warding vs Stolen Goods | flatline:access @T19 | T19 | 0 / 5 / 3 / 22 | none | do_nothing, remove_tags, draw_up, both | 0 / 1 / 0 / -3 |
| 2361 | Glyph of Warding vs Prick Thyself | flatline:access @T2 | T2 | 0 / 1 / 2 / 5 | dmg_deck, dmg_any | do_nothing, remove_tags, draw_up, both | 0 / 1 / 0 / -4 |
