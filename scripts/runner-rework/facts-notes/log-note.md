# R-A A-log Note: Card-Fact Disagreement Logs (L1–L12) and Golden Values

**Status:** Branch `gemini-runner-facts-log` (cut fresh from `origin/beta` @ `8efbf4f`, `src/ai` and `src/core` identical to `7fa8b6f`, g1 base `45086908053`, NRDB=1 g1 base `45198090232`). Step 0 (`facts-notes/step0.md`), byte-identical golden fixture (`tests/fixtures/runner-facts/golden.json`, 55 boards + 3 L11 checks), and full L1–L12 logs across all three pools (batch 221 deals / 3,205 boards, NRDB 110 deals / 1,432 boards, people 38 files / 483 boards) are complete. Nothing stopped. No `src/**` edits. Checks: `npm run typecheck` passed, `npm run lint` passed (0 errors), targeted vitest passed.

---

## Sources and Runs

- **Batch pool (221 games, 3,205 Runner turn-start boards):** `ai-script` run **45204960831** (`scripts/runner-rework/facts-log.ts -- pool=batch`, ref `ce47caec7637f6f3ce39382ebfa47b81ac63fba7`; mean 5.51 ms/board).
- **NRDB pool (110 games, 1,432 Runner turn-start boards):** `ai-script` run **45204967040** (`scripts/runner-rework/facts-log.ts -- pool=nrdb`, ref `ce47caec7637f6f3ce39382ebfa47b81ac63fba7`; mean 5.25 ms/board; reuses Task 1 NRDB=1 g1 base `45198090232`).
- **People's games (36 games with Runner turns of 38 files, 483 Runner turn-start boards):** local `pool=human` (mean 4.21 ms/board).
- **Golden fixture (`tests/fixtures/runner-facts/golden.json`):** generated on commit `8efbf4f00ab166c4c732b18256b5e4b835262fb9` by `scripts/runner-rework/facts-golden.ts`, run twice and verified byte-identical (SHA-256 `9fc9f7e1c4f4c1c34e4c53e61850896b04375cb1cc1b54bd8200f23369c802fb`).
- **Hidden information:** All measuring hidden reads (`!c.isRezzed && !c.runnerKnows` in L3, exact `iceCost` on unrezzed ice in L5) are marked `// HIDDEN READ (measurement only)` in `scripts/runner-rework/facts-log.ts`.

---

## L1–L12 Results by Pool (numbers only; no picked answer)

Unit: **L1, L2, L4** = `(board, rezzed subroutine)`; **L3, L7, L12** = `(board, card)`; **L5** = `(board, unrezzed ice)`; **L6** = `board`; **L8, L9** = `(board, server)`; **L10** = `turnFlags` entry at Runner turn start. Counts with `< 10` met are marked `not shown`.

| Line | Fact | Batch (3,205 boards / 221 games) | NRDB (1,432 boards / 110 games) | People (483 boards / 36 games) |
| --- | --- | --- | --- | --- |
| **L1** | Subroutine ends the run (5 encodings) | **2,203 / 13,219 (16.7%)** | **780 / 5,065 (15.4%)** | **355 / 1,720 (20.6%)** |
| **L2** | Subroutine damage encodings | **0 / 2,778 (0.0%)** | **0 / 602 (0.0%)** | **0 / 334 (0.0%)** |
| **L3** | Seven cross-side cards (see breakdown below) | Botulus 917, Tranq 115, Funhouse 151 (0 diff); 4 cards 0 met | Botulus 256, Funhouse 44, Physarum 65 (0 diff); 4 cards 0 met | Botulus 33, Funhouse 35, Physarum 23 (0 diff); Jaguarundi 3/3 (not shown: <10); 3 cards 0 met |
| **L4** | "or end the run" vs walk | **195 / 200 (97.5%)** | **50 / 56 (89.3%)** | **22 / 22 (100.0%)** |
| **L5a** | Unrezzed ice — same view (`runnerKnows`) | **116 / 122 (95.1%)** | **27 / 27 (100.0%)** | **45 / 57 (78.9%)** |
| **L5b** | Unrezzed ice — hidden (by construction) | **7,009 / 8,643 (81.1%)** | **2,532 / 3,059 (82.8%)** | **815 / 1,006 (81.0%)** |
| **L6a** | Runner money (`creditsNow` vs `iceStop` 4 vs click-money) | **2,951 / 3,205 (92.1%)** | **1,352 / 1,432 (94.4%)** | **446 / 483 (92.3%)** |
| **L6b** | Runner money (grip-money split — see caveat below) | 0 / 0 (not shown) | 0 / 0 (not shown) | 0 / 0 (not shown) |
| **L7** | Run-begin / run-paid cards (`holdFacts` vs Runner 0) | **665 / 665 (100.0%)** | **251 / 251 (100.0%)** | **104 / 104 (100.0%)** |
| **L8** | Rig bypasses (`runBypasses` vs `bypassesAhead`) | 0 / 0 (not shown) | **12 / 12 (100.0%)** | **11 / 11 (100.0%)** |
| **L9** | Feasibility vs `serverHold` (agree / total) | **11,093 / 12,807 (86.6%)** | **4,885 / 5,647 (86.5%)** | **1,716 / 1,986 (86.4%)** |
| **L9 policy** | Disagreements explained by (unrezzed / rezChoice / money) | 1,714 disagree: unrezzed 1,336, rezChoice 1,322, money 1,714; **unexplained: 0** | 762 disagree: unrezzed 631, rezChoice 627, money 762; **unexplained: 0** | 270 disagree: unrezzed 204, rezChoice 198, money 270; **unexplained: 0** |
| **L10** | `turnFlags` once-per-turn naming styles | `{}` (at turn start) | `ability:<inst>:<idx>`: 1, `once:<inst>`: 1, `once:<inst>:<n>`: 6, `other`: 230 | `once:<inst>`: 13, `once:<inst>:<n>`: 1, `other`: 133 |
| **L11** | Entry vs engine (`golden.json` built boards) | Friend of a Friend (`34074`): engine pays 5c untagged & 5c tagged; Telework Contract (`30027`): engine pays 3c | (same built boards) | (same built boards) |
| **L12** | Mycoweb (`35053`) with derezzed/unrezzed lender | **56 / 56 (100.0%)** | **15 / 15 (100.0%)** | **22 / 22 (100.0%)** |

---

## Where the Readings Are Thin and Which Way Each Errs

1. **L3 (the 7 cards):** Jaguarundi (`34035`), Seraph (`34118`), and Paywall (`36052`) are **0 met** in both self-play pools (and 0–3 met in people's games — all `< 10`, i.e., **not shown**). Tranquilizer (`30017`) is 0 met in NRDB and 0 met at Runner turn start in human files. Physarum (`34082`) is 0 met in batch, 65 in NRDB, 23 in human. Coverage for these cards depends on the golden boards in `tests/fixtures/runner-facts/golden.json`.
2. **L6b (grip-money split):** `facts-log.ts` matched `/gain \d+ \[credit\]/i` against `stripped_text`, whereas `stripped_text` uses `"gain N credits"` (no brackets), so all boards landed in L6a rather than splitting out grip-money events. L6a therefore upper-bounds the non-grip-money disagreement rate by including turns where grip money was present.
3. **L8 (rig bypasses):** 0 met in the batch pool (confirming red team A1: bypass cards sit only in NRDB and human decks); 12 met in NRDB and 11 in human (thin on people's games, barely above 10).
4. **L9 (`unexplained = 0`):** On every board where Runner feasibility and `serverHold` disagreed, `state.runner.clicks > 1` (Runner has spare clicks to gain credits, which the walk models via `runnerEarnings` while `runScore` checks `creditsNow`) fired the `money` policy flag alongside `unrezzed`/`rezChoice`. Narrowing the `money` flag to boards where `runnerEarnings` actually exceeds `creditsNow` on a needed credit margin would separate click-money disagreements from pure structural ones in R-B.
5. **L10 (`turnFlags` at turn start):** Because `state.turnFlags` resets on turn handover (`actions/turn.ts:105`), sampling at Runner turn start sees only flags written by start-of-turn triggers; sampling mid-turn would capture more `once:<inst>` and `ability:<inst>:<idx>` writes. Even at turn start, all three naming styles (`once:<inst>`, `once:<inst>:<n>`, `ability:<inst>:<idx>`) appeared.

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
```
