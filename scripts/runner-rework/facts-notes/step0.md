# R-A A-log — Step 0: Source Table, Timed Sample, and Golden Determinism

- **Branch:** `gemini-runner-facts-log` (cut fresh from `origin/beta` @ `8efbf4f`, `src/ai` and `src/core` identical to `7fa8b6f`, g1 base `45086908053`, NRDB=1 g1 base `45198090232` from Task 1)
- **Scripts:** `scripts/runner-rework/facts-source-table.ts`, `scripts/runner-rework/facts-golden.ts`, `scripts/runner-rework/facts-log.ts`, `scripts/runner-rework/facts-log-sum.mjs`

## 1. Step 0a: Source Table (26 cases + 7 cross-side cards + Mycoweb)

Pools: Batch (`scripts/nsg-sample-decks.ts`, 13 Corp + 17 Runner = 30 decks, 221 deals), NRDB (`scripts/nrdb-test-decks.ts`, 11 Corp + 10 Runner = 21 decks, 110 deals), People (`tests/fixtures/human-games/`, 38 files — showing both decklist count and **met in play** count).

| Code | Card | Group | Batch decks | NRDB decks | Human decklist | Human met in play |
| --- | --- | --- | ---: | ---: | ---: | ---: |
| `34077` | Window of Opportunity | case26 | 0 | 1 | 2 | 0 |
| `30028` | Jailbreak | case26 | 7 | 2 | 13 | 13 |
| `36022` | Read-Write Share | case26 | 0 | 2 | 3 | 3 |
| `30004` | Botulus | both | 5 | 4 | 11 | 7 |
| `30017` | Tranquilizer | both | 2 | 0 | 4 | 1 |
| `30032` | Mayfly | case26 | 3 | 2 | 5 | 4 |
| `35068` | BANGUN: When Disaster Strikes | case26 | 1 | 0 | 0 | 0 |
| `35008` | Hantu | case26 | 1 | 0 | 0 | 0 |
| `34004` | Audrey v2 | case26 | 0 | 1 | 2 | 2 |
| `34005` | Banner | case26 | 0 | 0 | 0 | 0 |
| `34090` | Lobisomem | case26 | 0 | 0 | 0 | 0 |
| `34092` | Pressure Spike | case26 | 0 | 1 | 0 | 0 |
| `36004` | Corsair | case26 | 0 | 0 | 0 | 0 |
| `34026` | Slap Vandal | case26 | 0 | 1 | 1 | 1 |
| `34082` | Physarum Entangler | both | 0 | 2 | 5 | 2 |
| `30054` | Funhouse | both | 4 | 2 | 11 | 8 |
| `34012` | S-Dobrado | case26 | 0 | 1 | 6 | 4 |
| `34078` | Alarm Clock | case26 | 0 | 3 | 7 | 4 |
| `30042` | Manegarm Skunkworks | case26 | 8 | 4 | 12 | 10 |
| `35061` | Idiosyncresis | case26 | 2 | 0 | 3 | 3 |
| `34081` | Malandragem | case26 | 0 | 1 | 4 | 3 |
| `34016` | Laser Pointer | case26 | 0 | 1 | 4 | 2 |
| `34015` | Curupira | case26 | 0 | 1 | 7 | 7 |
| `35021` | Fransofia Ward | case26 | 1 | 0 | 0 | 0 |
| `36001` | Chain Reaction | case26 | 0 | 2 | 0 | 0 |
| `34035` | Jaguarundi | seven | 0 | 0 | 3 | 2 |
| `34118` | Seraph | seven | 0 | 0 | 1 | 0 |
| `36052` | Paywall | seven | 0 | 0 | 1 | 1 |
| `35053` | Mycoweb | L12 | 3 | 2 | 3 | 3 |

## 2. Step 0b: Timed Sample (20 boards) & Whole-Count Estimate

- **Self-play sample (10 boards, `pool=batch limit=10`):** mean **6.42 ms/board** for L1–L12 evaluation (plus source game replay ~20–28s/game on 1 core).
- **People's sample (10 boards, `pool=human limit=10`):** mean **4.34 ms/board** for L1–L12 evaluation.

| Run | Scope | Estimated runner time | Workflow runs |
| --- | --- | --- | --- |
| Batch pool (`ai-script`, `pool=batch`) | 221 deals (~3,200 boards) | ~1.25 h (75 runner-min) | 1 |
| NRDB pool (`ai-script`, `pool=nrdb`) | 110 deals (~1,430 boards; reuses Task 1 NRDB g1 `45198090232`) | ~0.60 h (36 runner-min) | 1 |
| People's games (`pool=human`, local) | 38 files (~500 boards) | < 0.01 h (local) | 0 |
| **Total** | **369 games** | **~1.85 runner-hours** | **2 runs** |

Under both caps (≤ 3 runner-hours, ≤ 4 workflow runs) → proceeded with the full log runs.

## 3. Golden Values Determinism (`facts-golden.ts`)

- **Fixture:** `tests/fixtures/runner-facts/golden.json` (55 built boards covering all branches of the 26 cases + 3 L11 engine checks).
- **Base commit recorded in script header and JSON:** `8efbf4f00ab166c4c732b18256b5e4b835262fb9`.
- **Two-run byte-identity check (`cmp` exit 0):**
  - Run 1 (`tests/fixtures/runner-facts/golden.json`): `9fc9f7e1c4f4c1c34e4c53e61850896b04375cb1cc1b54bd8200f23369c802fb`
  - Run 2 (`/tmp/golden-check.json`): `9fc9f7e1c4f4c1c34e4c53e61850896b04375cb1cc1b54bd8200f23369c802fb`
