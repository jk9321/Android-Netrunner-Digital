# Diagnosis and Pins: Runner Issues #64, #65, #66 (no fix)

**Status:** Branch `gemini-issues-64-66` (cut from `origin/beta` @ `f826d33`). Diagnosis and known-failing pins only; no `src/**`, `.github/**`, `.claude/**`, or `tests/runnerDecidedTwice.test.ts` edits. No fix is proposed.

**Fixtures:**
- `tests/fixtures/runner-issues/issue-64.json` (seed `2471002559`, 63 moves through Turn 5).
- `tests/fixtures/runner-issues/issue-66.json` (seed `203162371`, 261 moves through Turn 17).
- **Prefix check for #65 and #66:** `issue-65.json` (64 moves through Turn 5) has identical `config` and `startStops` to `issue-66.json`, and all 64 of its moves are an exact prefix of `issue-66.json`'s 261 moves (`firstDiff = -1`). Both #65 and #66 therefore use `tests/fixtures/runner-issues/issue-66.json`, and `issue-65.json` is kept out.

**One-command reproduction:**
```bash
npx vite-node scripts/runner-rework/issues-64-66.ts
```

**Pin suite:**
```bash
npx vitest run tests/runnerIssues64to66.test.ts --reporter=verbose
```

---

## Issue #64 — Semak-samun run ended at subroutine prompt (Turn 4)

- **Replay check:** All 63 moves of `issue-64.json` replay on beta with 0 engine errors. The replayed Turn 3 and Turn 4 logs match the issue report word-for-word.
- **Reproduces on beta:** **Yes.** From the Turn 4 run board (`move 55`) with a watching Normal Runner and Normal Corp, `GameRunner` reproduces the exact turn: `INITIATE_RUN(remote-2)` -> encounter `Semak-samun` -> `RESOLVE_PROMPT({ kind: 'effect_choice', optionId: 'end' })` -> run ends -> `DRAW_CARD` -> `DRAW_CARD` -> `PLAY_OPERATION_OR_EVENT` (`Sure Gamble`) -> `END_TURN`.

### Board state and decision points

- **Decision point 1 — Run initiation (Turn 4, move index `55`):**
  - Runner: `clicks = 4`, `credits = 5`, `grip = 3` (`Take a Dive`, `Pennyshaver`, `Take a Dive`), `tags = 1`, `score = 2`.
  - Rig: `Gourmand` (decoder; not a fracter), `Botulus` (`2` virus counters) **hosted on HQ's inner unrezzed ice `Whitespace` (`inst-16`)** — *not* on `Semak-samun`.
  - Corp: `credits = 2`, `score = 0`.
  - `remote-2`: 1 rezzed ice `Semak-samun` (`35054`, `inst-33`, strength 3, barrier, subroutine `"End the run unless the Runner suffers 3 net damage."`, only fracters can break its subroutines); root holds 1 unrezzed card (`Spin Doctor`, `inst-11`, `mem = false` — hidden read for measurement only; open information is 1 facedown card, Comprehensive Rules 1.12.1 / 10.2.2a).
  - **What the Runner AI believed the run would cost and get (`asSide('runner')`):**
    - `botulusBreaks(state, semakSamun) = 0` (Botulus is on HQ's ice, not Semak-samun).
    - `bestBreakPlan = null` (no fracter in rig).
    - `tankDamage = { damage: 3, lethal: undefined }` because `3 <= grip.length (3)` (rule 10.4.4: flatline occurs only when the Runner suffers more damage than cards in grip).
    - `subroutineCost` (`src/ai/runs.ts:105`) calls `damageWorth(state, 3, ownRun(state))` with `ownRun = true` (`drawBack = true`, because 3 clicks remain after the run's click to draw back): **`3.750`** (compared to `23.895` with `drawBack = false`).
    - `icePrice(state, semakSamun) = { credits: 0, value: 3.75, damage: 3 }`.
    - `serverValue(state, 'remote-2', grip = 0) = 11.356`.
    - `runClick(state) = 1.475`.
    - `runScore(state, 'remote-2') = 11.356 - 3.750 - 1.475 = +6.131` (#1 in `rankMainActions`, ahead of `REMOVE_TAG` `+0.467` and `INITIATE_RUN(rd)` `-0.110`).
- **Decision point 2 — Semak-samun subroutine choice (Turn 4, move index `58`):**
  - Prompt: `effect_choice` — `"Semak-samun: suffer 3 net damage, or the run ends."` with options `damage` (`"Suffer 3 net damage"`) and `end` (`"End the run"`).
  - `answerPrompt` (`src/ai/prompts.ts`) simulates both options and compares `scoreOutcome`:
    - `optionId: 'damage'` (`grip: 3 -> 0`, `activeRun = true`): `evaluate(after) = -0.387`, `0.5 * keepDiff = -4.285` (including synergy `keepBonus`; raw `keepValue` diff `* 0.5 = -2.975`), `+ 0.8 * runRestWorth (11.356) = +9.085` -> **`scoreOutcome = 4.413`**.
    - `optionId: 'end'` (`grip = 3`, `activeRun = false`): `evaluate(after) = 16.552`, `keepDiff = 0`, `runRestWorth = 0` -> **`scoreOutcome = 16.552`**.
  - AI pick: **`end`** (`16.552` vs `4.413`, margin `+12.139`).

### Cause (shown)

- **Coordinator guess (1) is confirmed (shown):** `runScore` prices Semak-samun's subroutine as 3 net damage the Runner will tank (`3.750` with `drawBack = true` in `src/ai/runs.ts:105`, `679`) and assumes the run reaches the root (`+11.356`, net `runScore = +6.131`), while `answerPrompt` -> `scoreOutcome` (`src/ai/prompts.ts:44`) evaluates the post-damage `grip = 0` board via `evaluate(after, 'runner')` *without* draw-back (`evaluate` drops by `-16.939`, plus `-4.285` lost hand keep value), so it chooses `"End the run"`.
- **Coordinator guess (2) is not the cause in #64 (shown):** Botulus is hosted on HQ's `Whitespace`, not on `Semak-samun`, so `botulusBreaks = 0`. (Code note: `botulusBreaks` at `src/ai/runs.ts:59` does not call `canBreakSubroutinesWith`, so a Botulus hosted directly on Semak-samun would be miscounted, but that did not occur in this game.)

---

## Issue #65 — Unprotected Regolith Mining License accessed and not trashed (Turn 4)

- **Replay check:** Moves 0–63 of `issue-66.json` replay on beta with 0 engine errors and match the issue #65 Turn 4 log word-for-word. Confirmed credits: Runner starts Turn 4 at `1` credit, clicks to draw 2 cards (`Verbal Plasticity`), clicks for `1` credit twice (`1 -> 2 -> 3`), then runs `remote-2` with `clicks = 1, credits = 3`.
- **Reproduces on beta:** **Yes**, when played from the Turn 4 Runner turn start (`move 55`, `clicks = 4, credits = 1`). `GameRunner` reproduces the entire Turn 4 sequence identically: `DRAW_CARD` -> `GAIN_CREDIT` -> `GAIN_CREDIT` -> `INITIATE_RUN(remote-2)` -> `access_trash: false` -> `END_TURN` -> discard `Leech`, `Stick and Poke`. (Note: starting `GameRunner` mid-turn at `move 58` with an empty `planMemory` picks `GAIN_CREDIT` instead of `INITIATE_RUN(remote-2)`, because `planTurn` planned the 4-click line at `move 55` and replayed it from `planMemory.line`.)

### Board state and decision points

- **Decision point 1 — Run pricing (Turn 4, move index `58`):**
  - Runner: `clicks = 1`, `credits = 3`, `grip = 7` (`Buzzsaw`, `Sure Gamble`, `Carmen`, `Leech`, `Take a Dive`, `Stick and Poke`, `Sure Gamble`), `tags = 0`, `score = 2`.
  - Rig: `Botulus` (on HQ's `Karunā`, 1v), `Rising Tide`, `Verbal Plasticity`.
  - `remote-2`: 0 ice; root holds rezzed `Regolith Mining License` (`30071`, `inst-36`, `9` credits remaining, `trash_cost = 3`, `mem = true`; rule 1.19.2 allows trashing an accessed card by paying its trash cost).
  - **What the run was given for Regolith (`asSide('runner')`):**
    - `corpCardValue(regolith, state, 'runner', left = true) = 6.250`.
    - `spendCost(state, 3) = 5.127`.
    - `serverWorth` (`src/ai/runs.ts:1143`): `max(0.5, 6.250 - 5.127) = +1.123` (`serverValue('remote-2') = 1.123`).
    - `runClick(state) = 1.412`, so `runScore('remote-2') = 1.123 - 1.412 = -0.288` (in `planTurn`, `worth + runClick = +1.123`).
    - `nudge` (`src/ai/synergy.ts:659`) adds `+1.000` (`counters their econ (trashEcon) +1.00`), putting `INITIATE_RUN(remote-2)` #1 in `rankMainActions` at **`+0.712`** (ahead of `GAIN_CREDIT` `+0.167`).
- **Decision point 2 — Access trash choice (Turn 4, move index `61`):**
  - Prompt: `access_trash` — `"Runner: pay 3 [credit] to trash Regolith Mining License?"`
  - `answerPrompt` compares `scoreOutcome` for `trash: false` vs `trash: true`:
    - `trash: false` (`rCr = 3`): `corpBoard = 23.250`, `sideCreditValue(runner) = 5.127`, `runnerRigValue = 23.885`, `evaluate = 8.240`, **`scoreOutcome = 8.240`**.
    - `trash: true` (`rCr = 0`): `corpBoard = 17.000` (`-6.250`, exact match to `serverWorth`), `sideCreditValue(runner) = 0.000` (`-5.127`, exact match to `spendCost(3)`), `runnerRigValue = 21.783` (**`-2.102`**), `evaluate = 7.262`, `0.5 * keepDiff = -0.063`, **`scoreOutcome = 7.199`**.
  - AI pick: **`trash: false`** (`8.240` vs `7.199`, margin `+1.041`).

### Cause (shown)

- **Different mechanism from #58 (shown):** Issue #58 was a Threat-2 tag penalty cliff in `payoutWait` (`0 -> 1` tag). Here there is **no tag** (`tags = 0`). Instead:
  1. `serverWorth` (`src/ai/runs.ts:1143`) prices the trash as `corpCardValue(left) - creditCost(3) = +6.250 - 5.127 = +1.123`.
  2. At access (`move 61`), `evaluate` charges the same `-5.127` in `sideCreditValue`, **plus** dropping `runner.credits` from `3` to `0` lowers `cardRate(state, 'runner')`, which `Verbal Plasticity`'s `runner` formula (`src/ai/cards/systemGateway.ts:283`) reads (`runnerCardValue`: `4.375 -> 3.324`, `-1.051`). Multiplied by `RATES.rigCardScale = 2` (`src/ai/evaluate.ts:130`), `runnerRigValue` drops by **`-2.102`** (`+6.250 - 5.127 - 2.102 - 0.063 = -1.041`), flipping the trash decision from `+1.123` to `-1.041`.

---

## Issue #66a — Bioroid clicks spent on Brân 1.0 then jacking out (Turns 14, 15, 16)

- **Replay check:** All 261 moves of `issue-66.json` replay on beta with 0 engine errors. The replayed Turn 14, 15, and 16 logs match the issue report word-for-word.
- **Reproduces on beta:**
  - **Turn 14 (`move 221`):** Does **not** reproduce the jack-out with Normal Corp on beta because outer `Brân 1.0` (`inst-6`) is **unrezzed** at move 221; the human Corp spent 6c to rez it, whereas beta's Normal Corp declines to rez it (`PASS`), so the Runner passes it unrezzed and accesses `Urtica Cipher`.
  - **Turn 15 (`move 238`) and Turn 16 (`move 253`):** **Yes, reproduces identically on beta.** Both `Brân 1.0`s are now rezzed; `GameRunner` runs `remote-3`, spends 3 clicks on outer `Brân 1.0` (`3x BIOROID_BREAK`), enters `movement` with `clicks = 0, credits = 4`, and immediately chooses `JACK_OUT` -> `END_TURN`.

### Board state and decision points

On all three turns, Runner has `clicks = 4`, `credits = 4`, `grip = 5`, rig programs `[Botulus (on HQ Karunā), Rising Tide, Carmen, Buzzsaw]`, resource `[Verbal Plasticity]`. `remote-3` ice (inner `[0]` to outer `[3]`):

| Turn / Move | `[0]` Karunā | `[1]` Brân 1.0 | `[2]` Tithe | `[3]` Brân 1.0 | `remote-3` root (hidden read for measurement) | `serverValue` | `runScore` | `rankMainActions` #1 |
| --- | --- | --- | --- | --- | --- | ---: | ---: | --- |
| **T14 / M221** | REZZED (`{cr:4, val:0}`) | REZZED (`{cr:0, val:4.5}`) | REZZED (`{cr:0, val:1.55, dmg:1}`) | **unrezzed** (`{cr:1.5, val:0}`) | `Urtica Cipher` (unrezzed, 2 adv, `mem=false`), `Manegarm Skunkworks` (unrezzed, `mem=false`) | `49.647` | `+35.213` | `INITIATE_RUN(remote-3)` `+35.213` |
| **T15 / M238** | REZZED (`{cr:4, val:0}`) | REZZED (`{cr:0, val:4.5}`) | REZZED (`{cr:0, val:1.55, dmg:1}`) | **REZZED** (`{cr:0, val:4.5}`) | `Manegarm Skunkworks` (unrezzed, `mem=false`), `Orbital Superiority` (unrezzed, 1 adv, `mem=false`) | `50.941` | `+32.868` | `INITIATE_RUN(remote-3)` `+32.868` |
| **T16 / M253** | REZZED (`{cr:4, val:0}`) | REZZED (`{cr:0, val:4.5}`) | REZZED (`{cr:0, val:1.55, dmg:1}`) | **REZZED** (`{cr:0, val:4.5}`) | `Manegarm Skunkworks` (unrezzed, `mem=false`) | `22.786` | `+4.302` | `INITIATE_RUN(remote-3)` `+4.302` |

- **Why it jacked out (T14 M230, T15 M244, T16 M259):** After spending all 3 remaining clicks breaking outer `[3] Brân 1.0`, the Runner enters `movement` at `icePosition = 3` with `clicks = 0, credits = 4`. In `runAction` (`src/ai/runnerAI.ts:105-108`), `creditsAhead(state)` sums `iceCreditNeed` for ice inward of position 3: `[2] Tithe = 0`, `[1] Brân 1.0 = 7` (with `clicks = 0` it can no longer be click-broken and requires 7 credits via `Buzzsaw`/`Carmen`? — `iceCreditNeed = 7`), `[0] Karunā = 0` -> **`creditsAhead = 7 > 4`**, triggering `JACK_OUT`.
- **Why T14's failure did not stop T15's run (shown):**
  1. `serverValue` (`src/ai/runs.ts:1156`) only suppresses a server after a failed run *this turn* (`state.runsThisTurn`), not across turns.
  2. On T15, both `Brân 1.0`s are now rezzed, yet `plainIcePrice` / `selfBreakPrice` prices each `Brân 1.0` independently against `state.runner.clicks - 1 = 3` clicks — giving **both** `{ credits: 0, value: 4.5 }` (6 bioroid clicks assumed when only 3 remain), so `runScore('remote-3') = +32.868` — the exact same mechanism as issue #59.

---

## Issue #66b — "Empty server" on Turn 16

- **Root check on the replayed board (shown):** `state.corp.servers['remote-3'].root` is **NOT empty** at the Turn 16 run (`move 253`).
  - `remote-3.root.length === 1`: it contains **1 unrezzed card**, `Manegarm Skunkworks` (`inst-9`, installed by the Corp on Turn 14 at `move 216`, never rezzed or accessed, `mem = false` — card identity is a hidden read for measurement only).
  - When the Corp scored `Orbital Superiority` out of `remote-3` on Turn 16, only the agenda left the root; the unrezzed upgrade stayed installed face-down.
- **What the Runner may know (Comprehensive Rules):** The existence and count of installed cards in a server's root is open information visible to both players, while the identity of an unrezzed card that the Runner has not accessed is hidden information (Comprehensive Rules 1.12, 1.12.1, 10.2.2a).
- **Every part of `runScore('remote-3')` at Turn 16 (`move 253`, `asSide('runner')`):**
  - `serverValue('remote-3') = +22.786` (from the 1 unseen face-down card in `remote-3.root` while the Runner is at `6` agenda points — match point).
  - `chainReactionBonus = 0.000`, `nudge = 0.000`, `runBypasses = { ids: [], price: 0 }`, `botulusBreaks = 0` on all 4 ice (Botulus's 13 counters are on HQ's `Karunā`, not `remote-3`).
  - Ice prices: `[0] Karunā { cr: 4, val: 0 }`, `[1] Brân 1.0 { cr: 0, val: 4.5 }`, `[2] Tithe { cr: 0, val: 1.55, dmg: 1 }`, `[3] Brân 1.0 { cr: 0, val: 4.5 }`.
  - Net `runScore('remote-3') = +4.302` (`22.786 - spendCost(4) - (4.5 + 1.55 + 4.5) - runClick`).
- **Pin decision:** No empty-server pin is written for #66b, because `remote-3.root` was not empty on Turn 16; the Runner saw 1 unseen face-down card at match point (`serverValue = 22.786`), and the actual fault on Turn 16 is #66a (running into two rezzed `Brân 1.0`s with only 4 clicks). The setup test in `tests/runnerIssues64to66.test.ts` asserts `srv.root.length > 0` on Turn 16.

---

## Pin assertion-failure proofs (run once as plain `it`)

Before restoring `it.fails`, all three pins were run as plain `it` with `npx vitest run tests/runnerIssues64to66.test.ts --reporter=verbose` (duration `4.85s`, 6 passed, 3 failed — every pin failed on its `expect`, not a throw or timeout):

1. **`#64 T4` (`640 ms`):**
   ```text
   FAIL tests/runnerIssues64to66.test.ts > issue #64: run priced as tanking Semak-samun damage, then ended at the subroutine prompt > #64 T4: the Runner makes no run on remote-2 that Semak-samun ends
   AssertionError: expected [ { endedBySemak: true, …(1) } ] to deeply equal []
   - Expected
   + Received
   - []
   + [
   +   {
   +     "endedBySemak": true,
   +     "successful": false,
   +   },
   + ]
   ❯ tests/runnerIssues64to66.test.ts:134:46
   ```

2. **`#65 T4` (`326 ms`):**
   ```text
   FAIL tests/runnerIssues64to66.test.ts > issue #65: run priced for trashing rezzed Regolith Mining License, then declined at access > #65 T4: every affordable access of rezzed Regolith Mining License ends with it trashed
   AssertionError: expected [ { credits: 3, trash: false } ] to deeply equal []
   - Expected
   + Received
   - []
   + [
   +   {
   +     "credits": 3,
   +     "trash": false,
   +   },
   + ]
   ❯ tests/runnerIssues64to66.test.ts:183:62
   ```

3. **`#66a T14, T15, T16` (`1106 ms`):**
   ```text
   FAIL tests/runnerIssues64to66.test.ts > issue #66a: a run priced past two rezzed Brân 1.0s by more clicks than are left > #66a T14, T15, T16: the Runner does not spend bioroid clicks on Brân 1.0 and then jack out
   AssertionError: turn 15: expected [ { breaks: 3, ended: 'jackedOut' } ] to deeply equal []
   - Expected
   + Received
   - []
   + [
   +   {
   +     "breaks": 3,
   +     "ended": "jackedOut",
   +   },
   + ]
   ❯ tests/runnerIssues64to66.test.ts:249:9
   ```

---

## Checks (with `it.fails` in place)

All timeouts in `tests/runnerIssues64to66.test.ts` are `15_000` ms (below the 20 s cap); the whole file runs in ~3.7 s. (Note: on this 2-core remote VM, bare `npm test` exceeds the 9m50s command timeout per the `netrunner-dev-checks` workflow, so targeted vitest was run locally on both `tests/runnerIssues64to66.test.ts` and `tests/runnerDecidedTwice.test.ts`.)

```text
> npm run typecheck
npm notice run netrunner-app@0.1.0 typecheck
npm notice run tsc --noEmit
(exit 0)

> npm run lint
/home/antigravity/jk9321/Android-Netrunner-Digital/src/ui/components/LogFeed.tsx
  184:6  warning  React Hook useEffect has a missing dependency: 'displayedLength'. Either include it or remove the dependency array  react-hooks/exhaustive-deps

✖ 1 problem (0 errors, 1 warning)
(exit 0)

> npx vitest run tests/runnerIssues64to66.test.ts tests/runnerDecidedTwice.test.ts --reporter=verbose
  ✓ tests/runnerIssues64to66.test.ts > ... > #64 setup ... 54ms
  ✓ tests/runnerIssues64to66.test.ts > ... > #64 T4 ... 684ms (expected fail)
  ✓ tests/runnerIssues64to66.test.ts > ... > #64 twin ... 562ms
  ✓ tests/runnerIssues64to66.test.ts > ... > #65 setup ... 24ms
  ✓ tests/runnerIssues64to66.test.ts > ... > #65 T4 ... 342ms (expected fail)
  ✓ tests/runnerIssues64to66.test.ts > ... > #65 twin ... 417ms
  ✓ tests/runnerIssues64to66.test.ts > ... > #66a setup ... 193ms
  ✓ tests/runnerIssues64to66.test.ts > ... > #66a T14, T15, T16 ... 1127ms (expected fail)
  ✓ tests/runnerIssues64to66.test.ts > ... > #66a twin ... 329ms
  ✓ tests/runnerDecidedTwice.test.ts > ... (6 tests, 4 passed | 2 expected fail)

 Test Files  2 passed (2)
      Tests  10 passed | 5 expected fail (15)
   Duration  25.37s (tests 95%, import 3%, transform 2%)
```
