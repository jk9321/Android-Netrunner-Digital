# Task 5: Cache-Keys Check — Can the AI Value Caches Mix the Two Sides?

**Status:** Branch `gemini-cache-keys` (cut fresh from `origin/beta` @ `8efbf4f`). Write-up only — no `src/**` edits. Checks: `npm run typecheck` passed, `npm run lint` passed (0 errors), targeted vitest passed.

---

## 1. Inventory of Every Module-Level Cache in `src/ai/**`

Grep of `^(export )?const .* = new (Weak)?Map` across `src/ai/**` finds **23 module-level maps**: 16 caches (11 game/state-scoped, 5 pure static card-text/definition caches) and 4 non-cache bookkeeping maps (`mapGames`, `valueLoops`, `stateIds`, `runnerOtherKinds` — excluded from the cache table below, noted at end).

### 1.1 Game- and State-Scoped Value/View Caches (11)

| Cache (`file:line`) | Key | What fills it | Sides asking | Board passed in | Emptied when |
| --- | --- | --- | --- | --- | --- |
| **`threats`** (`effectValues.ts:363`) | `${state.id}:${archFaceUp.len}:${corpScore.len}:${runScore.len}:${skipIce}:${own}:${own&&tagged}:${own?boardFacts:''}:${count}` | `damageThreat()` | **Both** (Corp & Runner, plus `lossLog.ts` in batches) | Real state, Runner dealt view, Corp reply deals, look-ahead boards | `scopeToGame` (new `state.id`), `size > 200`, `clearDamageThreats()` |
| **`buildTargets`** (`valueModel.ts:249`) | `${side}:${state.id}:${corpId}:${runnerId}` | `buildTarget()` | **Both** | Real state, dealt views, look-ahead boards | Never automatically (`clearBuildTargets()` only) |
| **`iceMeans`** (`valueModel.ts:250`) | `${state.id}:${corpId}` | `corpIceMean()` | **Both** | Real state, dealt views, look-ahead boards | Never automatically (`clearBuildTargets()` only) |
| **`deckShares`** (`iceValues.ts:228`) | `${state.id}:${corpId}` | `deckIceShare()` | **Both** | Real state, dealt views, look-ahead boards | Never automatically (`clearDeckShares()` only) |
| **`boardFactCodes`** (`effectValues.ts:417`) | `'codes'` (single key per game) | `boardFacts()` | **Both** | Real state, dealt views, look-ahead boards | `scopeToGame` (new `state.id`) |
| **`deckAverage`** (`handValues.ts:130`) | `${deckPricingKey()}:${side}:${state.id}:${turn}:${credits}:${fingerprint}:${deckIds+Codes}` | `drawWorth()` | Both (disjoint by `deckPricingKey`) | Real state, dealt views, look-ahead boards | `scopeToGame`, `size > 500`, `clearHandCaches()` |
| **`clickCache`** (`handValues.ts:326`) | `${pricingKey()}:${side}:${state.id}:${turn}:${clicks}:${credits}:${handIds}:${fingerprint}` | `clickWorth()` | Both (disjoint by `pricingKey`) | Real state, dealt views, look-ahead boards | `scopeToGame`, `size > 2000`, `clearHandCaches()` |
| **`memos`** (`valueModel.ts:142`) | `WeakMap<GameState>` → `fingerprint` + `pricingKey():key` | `memo()` | Both (disjoint by state object & `pricingKey`) | Per `GameState` object | GC of `GameState` or fingerprint change |
| **`runnerViews`** / **`corpViews`** (`turnPlanner.ts:352,387`) | `WeakMap<GameState>` → `sig` | `runnerDecisionView` / `corpDecisionView` | Runner only / Corp only | Decision root `GameState` | GC of `GameState` or `sig` change |
| **`turnAnswers`**, **`reachAnswers`**, **`runAnswers`** (`corp/hold.ts:1360,1629,1826`) | `WeakMap<object>` (decision anchor) → walk key | `serverHold` / `walkRunnerTurn` | Corp only | Corp decision anchor | GC of decision anchor |
| **`runAfters`** (`prompts.ts:619`), **`rootRd`** (`cards/systemGateway.ts:47`), **`playedOut`** (`oracle.ts:45`) | `WeakMap<GameState>` / `WeakMap<GameState>` / full `JSON.stringify(state)+known` hash | Prompt run-after / Corp R&D root / Oracle turn | `runAfters` both (per state); `rootRd` Corp; `playedOut` Oracle | Per `GameState` / full state | GC (`WeakMap`) / never (`playedOut`, oracle-only) |

### 1.2 Pure Static Card-Data Caches (5)

- `labelRules` (`runs.ts:178`), `factsCache` (`runs.ts:318`), `typeFlags` (`iceValues.ts:270`), `placesOf` (`winNow.ts:52`): keyed solely by printed subroutine label string or printed card code. Immutable card-text parsing; cannot depend on asking side or hidden state.
- *(Non-cache bookkeeping maps: `mapGames` `valueModel.ts:165`, `valueLoops` `valueModel.ts:479`, `stateIds` `valueModel.ts:495`, `runnerOtherKinds` `prompts.ts:617`.)*

---

## 2. Per-Cache Verdicts: Order Dependence and Hidden Information

| Cache | (a) Can value differ by who asked first? | (b) Can it hold hidden info the other side may not know? |
| --- | --- | --- |
| **`threats`** (`effectValues.ts:363`) | **YES — SHOWN.** Incomplete key counts `archives.faceUp.length` and `count`, not which cards are gone. Proven on **deal 2211 Step 52** (Task 1 Part T, below) and V-B B1 (`threatsAudit`: 5,093 wrong of 713k hits on deals 1001 & 2181; 12–14 of 221 deals differ in null head-to-head when unshared). | **Ruled out (code path)** for real-board secrets: `damageThreat` scans `sideCards(state, 'corp')` (the public decklist multiset) minus public gone zones (`archives.faceUp`, `scoreArea`s). On look-ahead boards it can serve a stale count from another simulated board (wrong value, not a secret card read). |
| **`buildTargets` & `iceMeans`** (`valueModel.ts:249-250`) | **Possible on synthetic/modified boards (code path); identical on normal games.** Reads `sideCards(state, side)` once per `state.id`. On normal games both sides' views preserve the exact starting decklist multiset, so both compute the same number. If a look-ahead or test mutates/drops a card before the first ask, the mutated value sticks for that `state.id`. | **Ruled out (code path):** Computes only decklist-wide printed cost / advancement averages (public decklists, `valueModel.ts:258`). |
| **`deckShares`** (`iceValues.ts:228`) | **Possible on RFG/modified boards (code path); identical on normal games.** Sums ice types across HQ, R&D, Archives, and server ice. `dealRunnerUnknowns` permutes the exact unseen Corp codes, preserving the multiset; only RFG'd ice or synthetic boards before first ask could differ. | **Ruled out (code path):** Computes only Corp decklist ice-type shares (public decklist). |
| **`boardFactCodes`** (`effectValues.ts:417`) | **Ruled out (code path)** on normal games: static subset of Corp decklist codes with function `corpTurnDamage`. | **Ruled out (code path):** Decklist codes are public. |
| **`deckAverage`** (`handValues.ts:130`) | **Ruled out between sides (code path):** `deckPricingKey()` includes `actingSide()`, so Corp and Runner entries never collide. **YES within one side's calls — SHOWN** (V-B B1: 24 wrong of 401k hits due to incomplete zone/counter fingerprint). | **Ruled out between sides (code path):** Disjoint by `actingSide()`, and key includes exact `deck.map(c => c.instanceId + c.cardCode)` so a dealt deck cannot collide with the real deck. |
| **`clickCache`** (`handValues.ts:326`) | **Ruled out between sides (code path):** `pricingKey()` includes `actingSide()`. **YES within one side's calls — SHOWN** (V-B B1: 19 wrong of 41.7k hits). | **Ruled out between sides (code path):** Disjoint by `actingSide()`, and key includes `hand.map(c => c.instanceId)` + `fingerprint`. |
| **`memos`** (`valueModel.ts:142`) | **Ruled out (code path):** Keyed by `GameState` object identity (`WeakMap`) + `fingerprint` + `pricingKey()` (`actingSide`). | **Ruled out (code path):** Per state object and per `actingSide`. |
| **`runnerViews`, `corpViews`, `turnAnswers`, `reachAnswers`, `runAnswers`, `rootRd`** | **Ruled out (code path):** Single-side maps keyed by `WeakMap` object identity. | **Ruled out (code path):** Never read by the opposing side. |
| **`playedOut`** (`oracle.ts:45`) | **Ruled out (code path):** Keyed by full `JSON.stringify(state)` + known sets (oracle-only, off in normal play). | **Not applicable** (oracle mode intentionally reads real state; off in Normal AI). |
| **Static caches** (`labelRules`, `factsCache`, `typeFlags`, `placesOf`) | **Ruled out (code path):** Pure functions of printed card text/code. | **Ruled out (code path):** Printed card definitions only. |

---

## 3. Deal 2211 Cause (from Task 1 Part T)

Task 1 Part T (`gemini-b0-count` @ `856e067`, `scripts/runner-rework/b0-notes/part-t.md`) traced deal 2211 (`h2h=corp` 26 turns vs `h2h=runner` 20 turns):
- **Cache:** **`threats`** (`src/ai/effectValues.ts:363`, `damageThreat`).
- **First differing decision:** Step 52, Turn 4, Runner `access_trash` prompt (`prompt-6`: `trash: true` in `h2h=corp`, `trash: false` in `h2h=runner`).
- **First differing value (event 95):** Key `game-2211:4:1:1:false:false:false::43`. Under `h2h=corp`, the Runner (in the `old` graph) missed the cache and computed `{"burst": 4, "share": 9/43 = 0.2093}` on the access-trash look-ahead board; under `h2h=runner`, the Runner (in the `new` graph) hit `{"burst": 4, "share": 10/43 = 0.2326}` written at **step 45 by `scripts/lossLog.ts`** (`OpeningTracker`, which always imports from `../src/ai/...` in the `new` graph).

---

## 4. Fix Options and Costs (no option picked)

| Cache group | Option A: Complete key | Option B: Per-side caches (or `actingSide()` in key) | Option C: No cache |
| --- | --- | --- | --- |
| **`threats`** (`effectValues.ts:363`) | Include live pool's sorted card codes (or gone-zone card codes) in key. **Cost:** measured in V-B B1 (`run 43876047121`) at **~1.10× Corp, ~1.08× Runner** decision time; eliminates all 5,093/713k stale hits both within and across sides. | Prefix key with `actingSide()` (or hold per-agent / `EvalContext` map). **Cost:** ~0% runtime overhead; eliminates cross-side sharing (matches person's-game isolation & fixes row 90a), but keeps within-side incomplete-key stale hits. | Recompute `damageThreat` on every call (or memoize on `memos` `WeakMap<GameState>`). **Cost:** `memos` per state object adds minimal cost inside a decision and eliminates cross-board staleness completely, at the cost of recomputing once per new `GameState` object. |
| **`buildTargets`, `iceMeans`, `deckShares`** | Key by sorted decklist codes (or compute once at game start from initial decklists). **Cost:** tiny (called once per game if computed on initial decklist; sorting on every call would add overhead). | Add `scopeToGame` + `actingSide()` (or per-agent map). **Cost:** ~0% runtime overhead; prevents any cross-game or cross-side carry-over. | Compute once per game on `GameState` or `memos`. **Cost:** tiny if cached per-game on initial decklist; expensive if recomputed on every `evaluate` without caching. |
| **`deckAverage`, `clickCache`** (`handValues.ts`) | Include full zone contents & counters in key. **Cost:** measured in V-B B1 at **~1.17× Corp / ~1.13× Runner** (`deckAverage`) and **~1.05×** (`clickCache`). | Already separated by `actingSide()` via `pricingKey()`/`deckPricingKey()`; moving maps onto `EvalContext` or agent instance adds ~0% overhead. | Already too hot to drop uncached without a speed cut first (called on every `evaluate`). |

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
