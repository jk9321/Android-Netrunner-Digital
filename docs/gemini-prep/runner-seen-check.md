# Task 6: Debt 1c (`runner-seen`) — Brief Refresh Against `origin/beta` (`8efbf4f`)

**Status:** Branch `gemini-runner-seen-check` (cut fresh from `origin/beta` @ `8efbf4f`). Write-up only — no code edits, no new design proposed. Checks: `npm run typecheck` passed, `npm run lint` passed (0 errors), `npx vitest run tests/runnerPins.test.ts` passed (2 passed, 4 expected fail).

---

## 1. File:Line Citation Check (`ref/runner-seen-brief.md` vs `origin/beta` @ `8efbf4f`)

| Brief citation | Status on `8efbf4f` | Current location / detail |
| --- | --- | --- |
| `src/ai/runs.ts:1110` (`serverWorth` memory branch) | **Moved (+11)** | `src/ai/runs.ts:1121` (`serverWorth` starts at `:1083`) |
| `src/ai/runs.ts:877-918` (`unseenTraps`, `trapOdds`, `trapHit`, `trapDamageMax`, `fittingTraps`) | **Moved (+11)** | `src/ai/runs.ts:888-929` |
| `src/ai/runs.ts:1152` (`needsBiggerHand`) | **Moved (+11)** | `src/ai/runs.ts:1163` (`memory?.has` at `:1166`) |
| `src/ai/runs.ts:1455-1479` (`runScore`, `runRestWorth`) | **Moved (+11)** | `runScore` at `:1383` (`options.memory` at `:1402,:1408`); `runRestWorth` at `:1466-1490` |
| `src/ai/runnerReply.ts:143` (`runnerUnknownSlots`) | **Still right** | `src/ai/runnerReply.ts:143` |
| `src/ai/runnerReply.ts:16` (oracle playout) | **Still right** | `src/ai/runnerReply.ts:16` (`setOraclePlayout`) |
| `src/ai/runnerReply.ts:253-256` (reply's fresh Runner) | **Still right** | `src/ai/runnerReply.ts:255` (`new HeuristicRunnerAI({ synergy, planner: false })`) |
| `src/ai/turnPlanner.ts:338` (`runnerDecisionView`) | **Still right** | `src/ai/turnPlanner.ts:338` (`memory` read at `:344`) |
| `src/ai/search.ts:117` (writes into Runner `memory`) | **Still right** | `src/ai/search.ts:117` (`runner.knownCards().set(id, code)`) |
| `src/ai/evaluate.ts:195` (no-memory Corp port) | **Still right** | `src/ai/evaluate.ts:195` (`setRunnerAgendaOdds`) |
| `src/ai/runnerAI.ts:348` (`answerPrompt` follow) | **Still right** | `src/ai/runnerAI.ts:348` |
| `src/ai/prompts.ts:243` (access-order does not read identity) | **Moved** | `:243` is inside the Lobisomem block; `access_order` prompt handling is further down in `prompts.ts` |

*(Engine helpers verified present: `forgetHiddenCards` at `src/core/engine/helpers.ts:222`, `runnerSawBeforeInstall` used at `src/core/engine/actions/install.ts:316`, `runnerKnows` set on access in `src/core/engine/actions/run.ts`.)*

---

## 2. Every Reader of the Runner's `memory` Today (Grep of `\.memory\b|knownCards\(`)

**Production code (`src/ai/**`):**
- `src/ai/runnerAI.ts` (`:90, :94` writes in `remember`; `:222, :223, :228` planner rollout; `:245, :246` `rankMainActions`; `:258-259` `knownCards()`; `:274` `ownView`; `:284, :290, :292` `promptAnswer`; `:302, :316, :326, :332, :339, :348, :356` `scoreMain`) — **covered by brief.**
- `src/ai/runs.ts` (`:888-929` trap helpers; `:1121` `serverWorth`; `:1166` `needsBiggerHand`; `:1402, :1408` `runScore`; `:1466-1490` `runRestWorth`) — **covered by brief.**
- `src/ai/runnerReply.ts` (`:143` `runnerUnknownSlots`) — **covered by brief.**
- `src/ai/turnPlanner.ts` (`:338, :344` `runnerDecisionView`) — **covered by brief.**
- `src/ai/prompts.ts` (`scoreOutcome`, `todayAnswer`, `greedyCards`, `followChain`, `taoSwap`, `bypassSkips`) — **covered by brief.**
- `src/ai/search.ts` (`:117` `knownCards().set`; `:160` `this.base.knownCards()`; `:272-273` `determinize`/`playout`) — **covered by brief.**

**No new `src/ai/**` readers of the Runner's `memory` have been added since 2026-11-19.**
*(Test/script readers that copy `.memory`: `tests/runnerPins.test.ts:180`, `scripts/runner-rework/{model-agree.ts:206, map-hidden.ts:96,412,444, get-in.ts:277,460,612,673, rank-cost-trees.ts:114}`.)*

---

## 3. `tests/runnerPins.test.ts` Output on Today's `origin/beta` (`8efbf4f`)

Normal run (`npx vitest run tests/runnerPins.test.ts --reporter=verbose`):
```text
 ✓ D1: after Burner, the HQ price does not depend on the unaccessed upgrade in the root of HQ [expected fail]
 ✓ D1 recycled (setup): the engine forgets the reinstalled card (rule 1.12.3)
 ✓ D1 recycled: a card accessed, returned to HQ and installed again facedown is not priced by its identity [expected fail]
 ✓ D2 (setup): each fixture's control answer is the one recorded in the fixture
 ✓ D2 Topan host (deal 1581 T4): the pick does not move when two facedown ice swap identities [expected fail]
 ✓ D2 Mutual Favor search (deal 2061 T4): the pick does not move with the stack order [expected fail]

 Test Files  1 passed (1)
      Tests  2 passed | 4 expected fail (6)
```

With `it.fails` temporarily changed to `it` locally (not committed) to verify all four fail on their **assertions** (no crash or timeout):
```text
FAIL D1: after Burner, the HQ price does not depend on the unaccessed upgrade in the root of HQ
  AssertionError: expected true to be false // tests/runnerPins.test.ts:56:44
  expect(ai.knownCards().has(upgrade)).toBe(false)

FAIL D1 recycled: a card accessed, returned to HQ and installed again facedown is not priced by its identity
  AssertionError: expected true to be false // tests/runnerPins.test.ts:85:41
  expect(ai.knownCards().has(card)).toBe(false)

FAIL D2 Topan host (deal 1581 T4): the pick does not move when two facedown ice swap identities
  AssertionError: tests/runnerPins.test.ts:111:34
  Expected: ...optionId:"inst-36"
  Received: ...optionId:"inst-39"

FAIL D2 Mutual Favor search (deal 2061 T4): the pick does not move with the stack order
  AssertionError: tests/runnerPins.test.ts:122:41
  Expected: ...cardInstanceIds:["inst-81"]
  Received: ...cardInstanceIds:[]
```

All four pins fail cleanly on their exact intended assertions.

---

## 4. Items in the Brief That No Longer Hold (List Only)

1. **Prerequisite merges already landed:** Both `ai-runner-map-count` (`tests/runnerPins.test.ts`) and `ai-hold-inputs` are already merged into `origin/beta` (`8efbf4f`), so the builder branches directly from current `origin/beta`.
2. **Base run IDs updated:** Beta's current g1 base is run **`45086908053`** (identical to `44680798149` / `44754275578` on all 221 deals), replacing the older `44381468776` / `33c3511` references.
3. **Line numbers shifted:** Four ranges in `src/ai/runs.ts` shifted by `+11` lines (Section 1 table), and `src/ai/prompts.ts:243` no longer points to access-order handling.
4. **Everything else still holds:** `remember()` (`src/ai/runnerAI.ts:85-96`), all `src/ai` memory readers, the `runnerKnows` / `forgetHiddenCards` engine marks, and all four pins in `tests/runnerPins.test.ts` match the brief verbatim.

---

## Check output tails

```text
$ npm run typecheck
> tsc --noEmit (exit 0)

$ npm run lint
/home/antigravity/jk9321/Android-Netrunner-Digital/src/ui/components/LogFeed.tsx
  184:6  warning  React Hook useEffect has a missing dependency: 'displayedLength'.
✖ 1 problem (0 errors, 1 warning) (exit 0)

$ npx vitest run tests/runnerPins.test.ts
 Test Files  1 passed (1)
      Tests  2 passed | 4 expected fail (6)
```
