# B0 Part T — Deal 2211 trace (`h2h=corp` vs `h2h=runner`)

- **Branch:** `gemini-b0-count` (cut from `origin/beta` @ `8efbf4f`, `src/ai` and `src/core` identical to `7fa8b6f`, g1 base `45086908053`)
- **Script:** `scripts/runner-rework/b0-trace-2211.ts` (instruments `threats`, `buildTargets`, `iceMeans`, `deckShares` in script-side patched copies of `src` and `old/src`, never touching repo `src/`)

## Cause (one paragraph)

Deal 2211 diverges between `h2h=corp` (26 turns, Corp win) and `h2h=runner` (20 turns, Corp win, identical to the plain g1 base) at **step 52 (Turn 4, Runner `access_trash` prompt `prompt-6`)**, where `h2h=corp` chooses `trash: true` and `h2h=runner` chooses `trash: false`. The first differing value under that decision (cache event 95) is a lookup in **`threats`** (`src/ai/effectValues.ts:363`, `damageThreat`) for key **`game-2211:4:1:1:false:false:false::43`**: under `h2h=corp` the Runner runs in the `old` module graph, misses the cache, and computes `{"burst": 4, "share": 9/43 = 0.20930232558139536}` on the access-trash board; under `h2h=runner` the Runner runs in the `new` module graph, hits the cache, and reads `{"burst": 4, "share": 10/43 = 0.23255813953488372}`, which had been written at **step 45 of deal 2211 by `scripts/lossLog.ts`** (`playLogged` / `OpeningTracker`, which imports `../src/ai/...` from the `new` module graph and never from `old/`). This is **not** carry-over from deal 1571 (shard 57's first game — `scopeToGame` scopes `threats` to `game-2211`). It is **found row 90's class** (incomplete `threats` key counting `archives.faceUp.length` rather than which cards are gone, shared across callers in one module graph) **combined with a harness asymmetry in `scripts/head-to-head.ts`**: `lossLog.ts` always shares the `new` module graph, so `h2h=corp` shares `lossLog`'s cache writes with the Corp while `h2h=runner` shares them with the Runner.

## Trace evidence

- **Shard 57 replay (`OLD_AI=/tmp/b0-old SHARD=57/64 npx vite-node scripts/head-to-head.ts -- 1 normal`):**
  - Deal 1571 (`Quick and Dirty` vs `Dashing Mad`): identical (`corp`, 18 turns).
  - Deal 2211 (`Peculiarity` vs `Bowel Movements`): differs (`h2h=corp`: `corp`, 26 turns; `h2h=runner`: `corp`, 20 turns, matches `45086908053.deals.json`).
  - Deal 2851 (`Brick Stack` vs `Planning Ahead`): identical (`runner`, 11 turns).
- **First differing decision (deal 2211, step 52, Turn 4, Runner `RESOLVE_PROMPT` `prompt-6`):**
  - `h2h=corp`: `{"type":"RESOLVE_PROMPT","player":"runner","promptId":"prompt-6","choice":{"kind":"access_trash","trash":true}}`
  - `h2h=runner`: `{"type":"RESOLVE_PROMPT","player":"runner","promptId":"prompt-6","choice":{"kind":"access_trash","trash":false}}`
- **First differing cache value (step 52, event 95 of 158):**
  - Cache: `threats` (`src/ai/effectValues.ts:363`)
  - Key: `game-2211:4:1:1:false:false:false::43`
  - `h2h=corp` (`old` graph, `runner(old).chooseAction`): `op=set`, `val={"burst":4,"share":0.20930232558139536}` (9/43)
  - `h2h=runner` (`new` graph, `runner(new).chooseAction`): `op=hit`, `val={"burst":4,"share":0.23255813953488372}` (10/43), written at deal 2211 step 45 (Turn 4) by `lossLog/other` (`playLogged` in `scripts/lossLog.ts`).
