# Diagnosis: Issues #58 and #59 (write-up only, no fix)

**Status:** Branch `gemini-issues-58-59` (cut fresh from `origin/beta` @ `8efbf4f`). Both issues decoded from their saved-game snapshots into `docs/gemini-prep/issue-games/` (`issue-58.json`, `issue-59.json`), replayed move-for-move with 0 engine errors, and diagnosed via `scripts/runner-rework/issues-58-59.ts`. No `src/**` or `tests/**` edits. Checks: `npm run typecheck` passed, `npm run lint` passed (0 errors), targeted vitest passed.

**One-command reproduction (both issues):**
```bash
npx vite-node scripts/runner-rework/issues-58-59.ts
```

---

## Issue #58 — "Plaza access bug"

- **Saved game:** `docs/gemini-prep/issue-games/issue-58.json` (beta `d43a526`, Normal Runner AI, seed `3290689454`, Corp *Big Brain Thinking* vs Runner *[Startup-Basics] Zahya the Baker*, 135 moves through Turn 7, score 2–0).
- **Engine check:** All 135 moves replay cleanly and match the game log. The engine followed the rules: **Public Access Plaza** (`35062`, `src/core/scripts/elevation/corp/assets.ts:151-164`) has *"When your turn begins, gain 1 credit. Threat 2 → When the Runner trashes this asset (while it is rezzed), give them 1 tag."* Because the Corp reached 2 agenda points on Turn 2 (`Threat = 2`), trashing the **rezzed** Plaza on Turns 3–7 legally gave the Runner 1 tag (Comprehensive Rules 1.19.2 / Threat condition). On Turn 2 Plaza was unrezzed, so trashing would not have given a tag.

### Decision points and AI option scores

#### A. Why the Runner refused to trash Public Access Plaza on Turns 2–6, and trashed it on Turn 7

At every `access_trash` prompt, `answerPrompt` (`src/ai/prompts.ts`) simulates `trash: true` vs `trash: false` and scores both via `scoreOutcome` → `evaluate(after, 'runner')`.

| Turn / Move | Plaza rezzed | Runner cr / availCr (Touchstone) | Runner tags before → after trash | `scoreOutcome` trash vs keep (diff) | `corpBoardValue` lost by Corp | `sideCreditValue` diff | `runnerRigValue` diff | `tagCost` after | AI pick (`real` & `view`) |
| --- | :---: | --- | :---: | --- | ---: | ---: | ---: | ---: | :---: |
| **T2 / M33** | no | 4 / 4 (0) | 0 → 0 | -11.25 vs -9.02 (**-2.24**) | +2.00 | -3.22 | -1.06 | — | `trash: false` |
| **T3 / M49** | yes | 6 / 6 (0) | 0 → **1** | -32.31 vs -9.58 (**-22.73**) | +1.89 | -2.96 | **-9.04** | 0.71 | `trash: false` |
| **T4 / M62** | yes | 5 / 5 (0) | 0 → **1** | -40.61 vs -14.38 (**-26.24**) | +2.69 | -3.09 | **-11.41** | 2.36 | `trash: false` |
| **T5 / M85** | yes | 9 / 10 (1) | 0 → **1** | -28.32 vs -5.86 (**-22.46**) | +6.33 | -1.26 | **-16.77** | 1.67 | `trash: false` |
| **T6 / M104** | yes | 6 / 7 (1) | 0 → **1** | -31.98 vs -11.22 (**-20.76**) | +4.87 | -1.45 | **-16.08** | 2.50 | `trash: false` |
| **T7 / M133** | yes | 13 / 15 (2) | **1 → 2** | -45.58 vs -48.76 (**+3.18**) | +10.26 | **0.00** | **-1.77** | 0.10 | **`trash: true`** |

#### B. Why the Runner kept running Remote 3 on Turns 3, 4, 5, and 6

Remote 3 had **0 ice** and held **only** Public Access Plaza (`known=true`, `mem=true`).

| Turn / Move | Action that started run | `runScore` (`remote-3`) | `serverValue` (`remote-3`) | Top ranked main actions (`rankMainActions`) |
| --- | --- | ---: | ---: | --- |
| **T3 / M46** | `RUN(remote-3)` | +0.096 | — | `remote-3` positive with 0 ice |
| **T4 / M59** | `RUN(remote-3)` | +0.916 | **+2.759** | **#1 `RUN(remote-3)` +1.710**, #2 `INSTALL(Touchstone)` +0.938, #4 other `RUN` +0.292 |
| **T5 / M82** | `PROMPT(effect_choice: remote-3)` | +1.302 | **+3.147** | **#1 `remote-3` +1.602**, #2 `remote-4` +1.572, centrals `-Infinity` |
| **T6 / M101** | `RUN(remote-3)` | +2.262 | **+4.005** | **#1 `RUN(remote-3)` +3.204**, #2 `PLAY(Sure Gamble)` +2.709 |
| **T7 / M130** | `RUN(remote-3)` | +3.925 | **+5.273** | #1 `PLAY(Lie Low)` +9.051, **#2 `RUN(remote-3)` +4.925** |

### Root cause (shown vs guess)

Two separate bugs interacted to produce the repeat-access loop (both **shown** directly in code and numbers):

1. **Why it refused to trash on Turns 3–6 (and then trashed on Turn 7):**
   - **Double-counted, over-broad tag penalty in `payoutWait` (`src/ai/cardProfiles.ts:47`):**
     ```ts
     const risk = owner === 'corp' ? assetRisk(state, iced) : (state.runner.tags > 0 ? PAYOUT_RISK.runnerTagged : PAYOUT_RISK.runnerUntagged);
     ```
     When trashing rezzed Plaza at Threat 2 moved `runner.tags` from `0` to `1`, `payoutWait` switched **every** Runner `CARD_PROFILES` payout card in the rig from `runnerUntagged` to `runnerTagged` — collapsing `runnerRigValue` by **-9.04 to -16.77 points**, on top of `tagsWorth` (`src/ai/evaluate.ts:364`) separately charging the tag clock! (Note: `payoutWait` applies `runnerTagged` to all Runner payout cards regardless of card type, even non-resource hardware like Touchstone that cannot be trashed by the Corp's basic tag-trash action.)
   - **Why Turn 7 flipped to `trash: true`:** On Turn 7 the Runner was **already tagged (`tags = 1`)** before accessing Plaza, so `state.runner.tags > 0` was already true in both `trash: true` and `trash: false`. Taking a 2nd tag did not trigger the `0 → 1` cliff in `payoutWait` (`runnerRigValue` dropped only -1.77), Touchstone covered the 2c trash cost (`sideCreditValue` diff = 0.00), and removing Plaza's remaining Corp value (+10.26) easily won (`+3.18`).
   - **Turn 2 (unrezzed Plaza):** No tag was involved; `corpBoardValue` only priced the unrezzed asset at `2.00`, which was smaller than spending 2 of 4 credits (`-3.22` credit slide).

2. **Why it kept running Remote 3 on Turns 3–6 (aimed at Plaza, not just cheap):**
   - **Missing on-trash tag penalty in `serverWorth` (`src/ai/runs.ts:1139-1144`):**
     ```ts
     if (trash != null && trash <= state.runner.credits)
       value += Math.max(0.5, corpCardValue(card, state, 'runner', true) - creditCost(state, trash));
     ```
     `serverWorth` priced Remote 3 solely for trashing Public Access Plaza (`+2.76` to `+4.01`, making `RUN(remote-3)` the **#1 ranked action** on Turns 4, 5, and 6), because it subtracted only `creditCost(2)` and **never priced Plaza's Threat 2 on-trash tag** (and also has a `Math.max(0.5, ...)` floor). Thus the run scorer assumed the Runner would gain +3 to +4 by trashing Plaza, sent the Runner into Remote 3, and then `answerPrompt` saw the -20 to -26 tag penalty in `evaluate` and declined to trash — repeating every turn until the Runner was already tagged on Turn 7.

---

## Issue #59 — "Runner repeatedly ran Bumi 1.0"

- **Saved game:** `docs/gemini-prep/issue-games/issue-59.json` (main `dff9002`, Normal Runner AI, seed `2208434514`, Corp *Startup Anoetic Reanimation* vs Runner *[STARTUP - Vantage Point] Read-Write Dewi*, 207 moves through Turn 11, score 2–0).
- **Engine check:** All 207 moves replay cleanly and match the log. On Turn 4 the Corp rezzed **Bumi 1.0** (`pos=1`, outer, Bioroid, 2 subroutines) in front of already-rezzed **Brân 1.0** (`pos=0`, inner, Bioroid, 3 subroutines) on `remote-1`. Spending 2 clicks to break Bumi 1.0's 2 subroutines (Comprehensive Rules 6.9.3 / Bioroid lose-click ability) and then jacking out during Movement (6.9.4) is legal.

### Decision points and AI option scores

On Turns 4, 7, 8, and 10 the Runner started its turn with **4 clicks** and **no icebreakers capable of breaking Brân 1.0 or Bumi 1.0** (on T4 only `Unity`, a decoder; on T7, T8, T10 `rig = []`).

| Turn / Move | `remote-1` ice (inner → outer) | Runner clicks / availCr / rig | `iceCost` / `need` seen at run start | `runScore` (`remote-1`) | `serverValue` (`remote-1`) | Top ranked actions (`rankMainActions`) | In-run sequence |
| --- | --- | --- | --- | ---: | ---: | --- | --- |
| **T4 / M62** | `[0] Brân 1.0 (rez)` \| `[1] Bumi 1.0 (unrez)` | 4 / 5 / `[Unity]` | Brân `cost=4.5, need=0`; Bumi `cost=1.5, need=0` | **+15.399** | +25.760 | **#1 `RUN(remote-1)` +16.065**, #2 `RUN(rd)` -0.940 | M67–68: 2× `BIOROID_BREAK` on Bumi (clicks 3→1); M70: `JACK_OUT` (`creditsAhead=Infinity`) |
| **T7 / M131** | `[0] Brân 1.0 (rez)` \| `[1] Bumi 1.0 (rez)` | 4 / 5 / `[]` | Brân `cost=4.5, need=0`; Bumi `cost=3.0, need=0` | **+6.618** | +16.809 | **#1 `RUN(remote-1)` +7.951**, #2 `RUN(rd)` -1.052 | M134–135: 2× `BIOROID_BREAK` on Bumi (clicks 3→1); M137: `JACK_OUT` (`creditsAhead=Infinity`) |
| **T8 / M146** | `[0] Brân 1.0 (rez)` \| `[1] Bumi 1.0 (rez)` | 4 / 6 / `[]` | Brân `cost=4.5, need=0`; Bumi `cost=3.0, need=0` | **+5.027** | +15.219 | **#1 `RUN(remote-1)` +6.361**, #2 `RUN(remote-2)` +3.514 | M149–150: 2× `BIOROID_BREAK` on Bumi (clicks 3→1); M152: `JACK_OUT` (`creditsAhead=Infinity`) |
| **T10 / M198** | `[0] Brân 1.0 (rez)` \| `[1] Bumi 1.0 (rez)` | 4 / 3 / `[]` | Brân `cost=4.5, need=0`; Bumi `cost=3.0, need=0` | **+17.667** | +27.944 | **#1 `RUN(remote-1)` +18.334**, #2 `GAIN_CREDIT` -6.836 | M201–202: 2× `BIOROID_BREAK` on Bumi (clicks 3→1); M204: `JACK_OUT` (`creditsAhead=Infinity`) |

### Root cause (shown vs guess)

All three parts of the failure are **shown** directly in the code and trace:

1. **What the Runner believed about Brân 1.0 behind Bumi 1.0 when starting the run (`src/ai/runs.ts:1438-1455`):**
   - On Turn 4, Bumi 1.0 was unrezzed, so running was based on the unrezzed-ice flat (`1.5`).
   - On **Turns 7, 8, and 10**, both **Bumi 1.0** (needs **2 clicks**) and **Brân 1.0** (needs **3 clicks**) were rezzed and known, and the Runner had only **3 clicks remaining** after spending 1 click to initiate the run (total required: `2 + 3 = 5` clicks > 3 clicks available).
   - **Independent bioroid-click double-counting in `runScore` (`src/ai/runs.ts:1438-1451`):** `runScore` loops over `server.ice` and calls `icePrice(state, ice)` on each ice against the **same unchanged `state.runner.clicks` (4 → 3 after run click)** without subtracting clicks already committed to outer bioroids. So it believed Bumi 1.0 cost 2 clicks (`need = 0`) **and** Brân 1.0 cost 3 clicks (`need = 0`) using the **same 3 clicks**, returning `runScore = +6.62`, `+5.03`, and `+17.67` instead of `-Infinity`!
   - Furthermore, line `1454` computes `state.runner.clicks - 1 - bioroidClicks(state, server.ice)` (which evaluates to `4 - 1 - 5 = -2 < 0`!) and passes it to `approachCost(...)`, but `approachCost` only checks server-approach taxes (e.g. rezzed Manegarm Skunkworks) and returns `{ cost: 0 }` even when remaining clicks is negative.

2. **Why it spent 2 clicks breaking Bumi 1.0 and then jacked out (`src/ai/runnerAI.ts:138-150`, `:105-109`):**
   - In `encounterAction` (`src/ai/runnerAI.ts:138-150`), the `isBioroid(ice)` click-break block executes **before** checking whether the Runner can get past the rezzed ice behind it (and even on the 1st click, `creditsAhead(state)` returns `0` because `state.runner.clicks === 3` still satisfies Brân 1.0's 3-click check in isolation; on the 2nd click at `clicks === 2`, `iceCost(Brân 1.0)` is already `Infinity`, yet `encounterAction` still spends the 2nd click on Bumi 1.0).
   - Once Bumi 1.0 is passed (`phase = 'movement'`, `clicks = 1`), `runAction` (`src/ai/runnerAI.ts:105-108`) checks `creditsAhead(state) > availableCredits(state, 'runner')`. Now `iceCreditNeed(state, Brân 1.0)` sees `clicks = 1 < 3` and returns `Infinity`, triggering `JACK_OUT`.

3. **Why it did not remember the failure next turn (`src/ai/runs.ts:1154-1156`):**
   - The only failed-run memory in the Runner AI is `serverValue` (`src/ai/runs.ts:1154-1156`), which checks `state.runsThisTurn.filter(r => r.server === serverId).some(r => !r.successful)`. Because `state.runsThisTurn` resets at the end of every turn, there is no cross-turn memory of failed runs; on the next turn with 4 fresh clicks, `runScore` repeats the exact same bioroid-click double-count and ranks `RUN(remote-1)` #1 again.

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
