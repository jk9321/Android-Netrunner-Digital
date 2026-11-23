# B0 Count Note: Deal 2211 trace (Part T) and Runner losses a defensive line avoided (Part D)

**Status:** Branch `gemini-b0-count` (from `origin/beta` @ `8efbf4f`, `src/ai` and `src/core` identical to `7fa8b6f`, g1 base `45086908053`). Part T done (`b0-notes/part-t.md`); Part D Step 0 (`b0-notes/step0.md`) and full count done across all three pools (batch 221, NRDB 110, people 1). Nothing stopped. No `src/**` edits. Checks: `npm run typecheck` passed, `npm run lint` passed (0 errors, 1 pre-existing warning in `LogFeed.tsx`), targeted vitest (`tests/codeHealth.test.ts`, `tests/loadOrder.test.ts`) 24/24 passed; full suite checked by GitHub Actions CI on push.

---

## Sources and runs

- **Base commit:** `origin/beta` `8efbf4f` (`src/ai` and `src/core` unchanged since `7fa8b6f`; g1 base run `45086908053`, identical to `44680798149` / `44754275578` on all 221 deals).
- **Batch pool (221 deals, `scripts/nsg-sample-decks.ts`):** `ai-script` run **45198095983** (`scripts/runner-rework/b0-defensive.ts -- pool=batch`, ref `c4017e403af76850c888a4ecf884a126523976f1`). Source match: **221/221** match `45086908053.deals.json` (0 mismatches).
- **NRDB pool (110 deals, `vp-,lib-` in `scripts/nrdb-test-decks.ts`):**
  - NRDB=1 g1 base: `ai-batch` run **45198090232** (110 games, Corp 44.5%, 12 flatlines, logged in `docs/ai-batch-log.md`).
  - Defensive count: `ai-script` run **45199076855** (`scripts/runner-rework/b0-defensive.ts -- pool=nrdb`, ref `c4017e403af76850c888a4ecf884a126523976f1`). Source match: **110/110** match `45198090232.deals.json` (0 mismatches).
- **People's games (Normal Runner):** `tests/fixtures/human-games/report-54.json` (1 game, 19 Runner turns, Corp won 8–4 by agenda points; 0 qualifying losses).
- **Hidden information:** Defensive lines (`do_nothing`, `remove_tags`, `draw_up`, `both`) and public conditions read only public state and public decklists minus public gone zones (faceup Archives, score areas). Every hidden measurement read (`nonAgendaRootIds`, `detectTagPunish`) is marked `// HIDDEN READ (measurement only)` in `scripts/runner-rework/b0-defensive.ts`.

---

## Part T summary (full trace in `b0-notes/part-t.md`)

Deal 2211 differs between `h2h=corp` (26 turns) and `h2h=runner` (20 turns, matches plain g1) at **step 52 (Turn 4, Runner `access_trash` prompt `prompt-6`)**: `h2h=corp` trashes (`true`), `h2h=runner` does not (`false`). The first differing cache value (event 95) is in **`threats`** (`src/ai/effectValues.ts:363`, key `game-2211:4:1:1:false:false:false::43`): `h2h=corp` (Runner in `old` graph) misses and computes `9/43 = 0.2093`, whereas `h2h=runner` (Runner in `new` graph) hits `10/43 = 0.2326` written at step 45 by `scripts/lossLog.ts` (`playLogged` / `OpeningTracker`, which imports `../src/ai/...` from the `new` graph). It is **found row 90's class** (incomplete `threats` key shared in one module graph) **combined with a harness asymmetry in `head-to-head.ts`** (not carry-over from deal 1571).

---

## Part D: Losses a defensive line avoided (numbers only, no verdict)

### 1. Qualifying Runner losses by pool

| Pool | Games | Corp wins | Qualifying losses | Flatlines (by cause) | Tag-punish losses (last 3 Corp turns) | Any defensive line survived next Corp turn |
| --- | ---: | ---: | ---: | --- | ---: | ---: |
| Batch pool | 221 | 114 (51.6%) | **21** (9.5%) | 16 (`5 access`, `5 other`, `3 ice`, `3 corpTurn`) | 6 (1 overlap: deal 2511) | 20 / 21 |
| NRDB pool (`vp-,lib-`) | 110 | 49 (44.5%) | **12** (10.9%) | 12 (`6 corpTurn`, `5 ice`, `1 access`) | 0 | 12 / 12 |
| People (`report-54.json`) | 1 | 1 | **0** (0.0%) | 0 | 0 | 0 / 0 |

*(Note: All 5 `flatline:other` deals in the batch pool occurred on the Runner's own turn from net damage during access/run prompts. On the 6 batch tag-punishment losses, `remove_tags`/`both` prevented the tag punishment from firing on deals `1211` and `1461` (`Predictive Planogram`), while on `2441` (`Bigger Picture`, 2 tags, 0 credits) the Runner could clear at most 1 tag so `Bigger Picture` still fired; on `3071`, `1611`, and `2511` the punishment did not fire on the next Corp turn under any defensive line.)*

### 2. Avoidable vs Avoidable (blind) against the 2% and 10% reading lines

Three nested public conditions are reported separately (all strictly public at the start of the Runner's turn):
- **Strict on-board (`rc2_tag OR dmg_rezzed`):** Runner tagged with a live affordable tag-punishment card or installed resource (Corp ≥ 2c), OR grip strictly below a rezzed/faceup Corp-turn damage source on board.
- **Decklist Corp-turn (`rc2_tag OR dmg_deck`):** adds grip strictly below the maximum `ownTurnDamage` of a live card in the Corp's public decklist (affordable within `corpCredits + 2`).
- **Decklist any-phase (`rc2_tag OR dmg_deck OR dmg_any`):** adds grip strictly below `damageThreat(state, false).burst` (including ice/traps, relevant for Runner-turn run flatlines).

| Pool | Public condition set | Avoidable (% of all games [2% line] / % of qualifying [10% line]) | Avoidable, blind (% of all / % of qualifying) | Unavoidable |
| --- | --- | --- | --- | ---: |
| **Batch (221 games, 21 qual.)** | `rc2_tag OR dmg_rezzed` | **5** (**2.3%** / **23.8%**) | 15 (6.8% / 71.4%) | 1 |
| **Batch (221 games, 21 qual.)** | `rc2_tag OR dmg_deck` | **7** (**3.2%** / **33.3%**) | 13 (5.9% / 61.9%) | 1 |
| **Batch (221 games, 21 qual.)** | `rc2_tag OR dmg_deck OR dmg_any` | **12** (**5.4%** / **57.1%**) | 8 (3.6% / 38.1%) | 1 |
| **NRDB (110 games, 12 qual.)** | `rc2_tag OR dmg_rezzed` | **0** (**0.0%** / **0.0%**) | 12 (10.9% / 100.0%) | 0 |
| **NRDB (110 games, 12 qual.)** | `rc2_tag OR dmg_deck` | **1** (**0.9%** / **8.3%**) | 11 (10.0% / 91.7%) | 0 |
| **NRDB (110 games, 12 qual.)** | `rc2_tag OR dmg_deck OR dmg_any` | **5** (**4.5%** / **41.7%**) | 7 (6.4% / 58.3%) | 0 |
| **People (`report-54`, 1 game, 0 qual.)** | all sets | **0** (0.0% / —) | 0 | 0 |

### 3. Reading rule 4: public-condition prevalence in non-loss games (and R-C2's tag condition)

| Pool | Subset | Runner turns | Runner tagged | R-C2 tag condition (`rc2_tag`) | Live tag card affordable (`tag_card`) | Grip < rezzed Corp-turn dmg | Grip < live deck Corp-turn dmg | Grip < live deck any dmg |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| **Batch** | Non-qualifying (200 games) | 2,966 | 254 (8.6%; 40.0% games) | **209 (7.0%; 36.5% games)** | 197 (6.6%; 32.0% games) | 6 (0.2%; 1.5% games) | 77 (2.6%; 15.5% games) | 465 (15.7%; 49.5% games) |
| **Batch** | Runner wins only (107 games) | 1,528 | 163 (10.7%; 43.9% games) | **141 (9.2%; 41.1% games)** | 133 (8.7%; 36.4% games) | 5 (0.3%; 1.9% games) | 52 (3.4%; 19.6% games) | 279 (18.3%; 50.5% games) |
| **NRDB** | Non-qualifying (98 games) | 1,295 | 159 (12.3%; 40.8% games) | **114 (8.8%; 28.6% games)** | 91 (7.0%; 20.4% games) | 0 (0.0%; 0.0% games) | 20 (1.5%; 12.2% games) | 81 (6.3%; 30.6% games) |
| **NRDB** | Runner wins only (61 games) | 792 | 111 (14.0%; 42.6% games) | **82 (10.4%; 29.5% games)** | 64 (8.1%; 21.3% games) | 0 (0.0%; 0.0% games) | 6 (0.8%; 8.2% games) | 51 (6.4%; 31.1% games) |
| **People** | `report-54.json` (1 game, non-qual.) | 19 | 7 (36.8%) | **7 (36.8%)** | 7 (36.8%) | 0 (0.0%) | 1 (5.3%) | 5 (26.3%) |

### 4. What surviving defensive lines gave up (count 4 A3 outcome reading)

- **Batch pool (20 surviving losses, best surviving line):** gave up 6 stolen agenda points total across 20 games (deals `2391` 2 pts, `2441` 2 pts, `2781` 2 pts; 0 pts on the other 17), 16 server breaches (mean 0.80/turn), 1 trashed Corp card (deal `2511`), and gained +3.55 credits on average (`crDiff` mean -3.55 because defensive clicks gained credits instead of spending on runs).
- **NRDB pool (12 surviving losses, best surviving line):** gave up 12 stolen agenda points total across 12 games (deals `1231` 4 pts, `1321` 2 pts, `2021` 6 pts; 0 pts on the other 9), 10 server breaches (mean 0.83/turn), 3 trashed Corp cards, and gained +4.83 credits on average (`crDiff` mean -4.83).

### 5. Per-loss detail (Batch: 21; NRDB: 12)

**Batch pool (21):**
- `deal:1031` The Syndicate vs Planning Ahead — `flatline:other @T11` (rewind T11), `pub=[dmg_any]`, survived `[all 4]`
- `deal:1091` The Syndicate vs Professional Opportunities — `flatline:other @T16` (rewind T16), `pub=[]`, survived `[all 4]`
- `deal:1211` Discretion Advised vs Shootin’ ‘n’ Lootin’ — `tag:Predictive Planogram @T11` (rewind T10), `pub=[rc2_tag,tag_card]`, survived `[all 4]` (`remove_tags`/`both` stopped punishment)
- `deal:1221` Discretion Advised vs Professional Opportunities — `flatline:other @T6` (rewind T6), `pub=[dmg_any]`, survived `[all 4]`
- `deal:1281` Advanced Yomi vs Stolen Goods — `flatline:access @T6` (rewind T6), `pub=[]`, survived `[all 4]`
- `deal:1301` Advanced Yomi vs Bowel Movements — `flatline:corpTurn @T11` (rewind T10), `pub=[]`, survived `[all 4]`
- `deal:1321` Advanced Yomi vs Prick Thyself — `flatline:other @T10` (rewind T10), `pub=[dmg_any]`, survived `[all 4]`
- `deal:1461` Hyper Velocity vs Tickets, please — `tag:Predictive Planogram @T17` (rewind T16), `pub=[rc2_tag,tag_card,dmg_deck,dmg_any]`, survived `[all 4]` (`remove_tags`/`both` stopped punishment)
- `deal:1611` Quick and Dirty vs Professional Opportunities — `tag:Retribution @T21` (rewind T20), `pub=[]`, survived `[all 4]`
- `deal:2261` Peculiarity vs Professional Opportunities — `flatline:other @T2` (rewind T2), `pub=[]`, survived `[all 4]`
- `deal:2281` Peculiarity vs Enthusiasm — `flatline:access @T14` (rewind T14), `pub=[dmg_any]`, survived `[all 4]`
- `deal:2301` Glyph of Warding vs The Catalyst — `flatline:corpTurn @T10` (rewind T9), `pub=[]`, survived `[all 4]`
- `deal:2321` Glyph of Warding vs Stolen Goods — `flatline:access @T19` (rewind T19), `pub=[]`, survived `[all 4]`
- `deal:2361` Glyph of Warding vs Prick Thyself — `flatline:access @T2` (rewind T2), `pub=[dmg_deck,dmg_any]`, survived `[all 4]`
- `deal:2391` Glyph of Warding vs Professional Opportunities — `flatline:access @T4` (rewind T4), `pub=[dmg_rezzed,dmg_deck,dmg_any]`, survived `[all 4]`
- `deal:2441` Fine Print vs Party Hard — `tag:Bigger Picture @T16` (rewind T15), `pub=[rc2_tag,tag_card,dmg_any]`, survived `[all 4]` (punishment still fired)
- `deal:2511` Fine Print vs Shootin’ ‘n’ Lootin’ — `flatline+tag:ice+Predictive Planogram @T4` (rewind T4), `pub=[rc2_tag,tag_card]`, survived `[all 4]`
- `deal:2631` Not so subtle vs Tickets, please — `flatline:ice @T13` (rewind T13), `pub=[]`, **survived `[]` (unavoidable)**
- `deal:2781` Gimbatul vs Professional Opportunities — `flatline:ice @T9` (rewind T9), `pub=[dmg_any]`, survived `[all 4]`
- `deal:2981` Pork Chops vs Planning Ahead — `flatline:corpTurn @T22` (rewind T21), `pub=[]`, survived `[all 4]`
- `deal:3071` Pork Chops vs Sabbatical — `tag:Orbital Superiority @T15` (rewind T14), `pub=[dmg_deck,dmg_any]`, survived `[all 4]`

**NRDB pool (12):**
- `deal:1011` Reflections on the Past vs Rats & Cigarettes — `flatline:ice @T11` (rewind T11), `pub=[]`, survived `[all 4]`
- `deal:1231` De Profundis vs Negative Marketing Campaign — `flatline:corpTurn @T8` (rewind T7), `pub=[]`, survived `[all 4]`
- `deal:1301` Zwift Deth vs Sourdough Starter — `flatline:corpTurn @T12` (rewind T11), `pub=[]`, survived `[all 4]`
- `deal:1321` Zwift Deth vs V.I.C. — `flatline:corpTurn @T9` (rewind T8), `pub=[]`, survived `[all 4]`
- `deal:1331` Zwift Deth vs Negative Marketing Campaign — `flatline:corpTurn @T14` (rewind T13), `pub=[]`, survived `[all 4]`
- `deal:1381` Zwift Deth vs Trick Shot Zahya — `flatline:corpTurn @T16` (rewind T15), `pub=[]`, survived `[all 4]`
- `deal:1621` A Teia Startup vs V.I.C. — `flatline:ice @T11` (rewind T11), `pub=[dmg_any]`, survived `[all 4]`
- `deal:1641` A Teia Startup vs They Are Huge With It — `flatline:ice @T14` (rewind T14), `pub=[dmg_any]`, survived `[all 4]`
- `deal:1671` A Teia Startup vs Bright Eyes — `flatline:ice @T20` (rewind T20), `pub=[]`, survived `[all 4]`
- `deal:2021` PT Untaian vs V.I.C. — `flatline:access @T2` (rewind T2), `pub=[dmg_deck,dmg_any]`, survived `[all 4]`
- `deal:2051` PT Untaian vs Seb — `flatline:corpTurn @T12` (rewind T11), `pub=[dmg_any]`, survived `[all 4]`
- `deal:2071` PT Untaian vs Bright Eyes — `flatline:ice @T14` (rewind T14), `pub=[dmg_any]`, survived `[all 4]`

---

## Check output tails

```text
$ npm run typecheck
> tsc --noEmit (exit 0)

$ npm run lint
/home/antigravity/jk9321/Android-Netrunner-Digital/src/ui/components/LogFeed.tsx
  184:6  warning  React Hook useEffect has a missing dependency: 'displayedLength'.
✖ 1 problem (0 errors, 1 warning) (exit 0)

$ npx vitest run tests/codeHealth.test.ts tests/loadOrder.test.ts
 Test Files  2 passed (2)
      Tests  24 passed (24)
   Duration  7.93s
```
