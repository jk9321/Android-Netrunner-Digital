Status: branch `gemini-corp-debt-pins` (base `origin/beta` `8efbf4f00ab166c4c732b18256b5e4b835262fb9`) — done: all three known Corp AI debt pins (1e, 1f, 1h) in `tests/reviewPins.test.ts` verified on today's beta; all three still fail on their exact stated assertions for the exact stated code reasons, so `tests/reviewPins.test.ts` was not edited. Stopped: nothing stopped. Check output tails at bottom.

# Corp Debt Pins Check (Debts 1e, 1f, 1h)

## Summary

Running `npx vitest run tests/reviewPins.test.ts --reporter=verbose` on `origin/beta` (`8efbf4f`) reports 28 passed and 3 expected failures (`it.fails`). Temporarily flipping each of the three `it.fails` blocks to `it` locally (and immediately reverting) confirms that none of the three fails from a crash, timeout, or setup drift: every one fails on its exact intended assertion. No pin edit is needed.

---

## Debt 1e: `spendsKept` reads `serverHold`'s credit-pool floor as credits spent

### 1. Pin name and output on today's beta

- **Pin:** `"Whitespace toll: spendsKept hands rezMoney the Runner's real credits after the toll (11 - 3 = 8)"` (`tests/reviewPins.test.ts:378-382`)
- **Normal `it.fails` run:** passes as expected fail (`× ... [expected fail]`).
- **Temporary `it` run assertion failure:**
  ```text
  FAIL  tests/reviewPins.test.ts > bundle R: rez count and timing (counted before any fix; the pins say what is asserted) > Whitespace toll: spendsKept hands rezMoney the Runner's real credits after the toll (11 - 3 = 8)
  AssertionError: expected 1 to be 8 // Object.is equality

  - Expected
  + Received

  - 8
  + 1

   ❯ tests/reviewPins.test.ts:381:23
      379|     const s = tollBoard(C.WHITESPACE);
      380|     expect(afterToll(s)).toBe(8);
      381|     expect(handed(s)).toBe(8);
         |                       ^
      382|   });
  ```
- Line 380 (`expect(afterToll(s)).toBe(8)`) passes, confirming the Runner's actual credits after paying through Whitespace are 8 (`11 - 3`). Line 381 fails because `spendsKept` hands `1` to `rezMoney` instead of `8`.

### 2. Code path producing the wrong number

- `spendsKept` (`src/ai/corp/rez.ts:90-105`) calls `serverHold(state, run.server, { when: 'thisRun', mustRez, further: false })` at `src/ai/corp/rez.ts:97`.
- At `src/ai/corp/rez.ts:98`, it computes `const runnerCredits = toll.holds ? state.runner.credits : Math.max(0, state.runner.credits - toll.need);` and passes `{ restOfTurn: { runnerCredits }, except: run.server }` to `rezMoney` at `src/ai/corp/rez.ts:99`.
- `serverHold` (`src/ai/corp/hold.ts:167-168`) calls `walkThisRun` (`src/ai/corp/hold.ts:1790-1792`), which calls `solveRun` (`src/ai/corp/hold.ts:1763-1787`). The `need` field returned by `solveRun` (`src/ai/corp/hold.ts:1776,1785-1786`) is the minimum starting credit pool the Runner needs to get through the run without it ending, not the credits deducted by the toll.
- For Whitespace (lose 3 credits; end the run if the Runner has 6 or fewer credits), passing unbroken requires starting with at least 10 credits (`10 - 3 = 7 > 6`), so `toll.need` is `10`.
- Subtracting `10` from the Runner's `11` credits at `src/ai/corp/rez.ts:98` yields `1` instead of the real post-toll total `8`. This matches the debt description in `ref/debts-1c-1h.md` (1e) and `ref/rez-count-ruling.md` (C1).

### 3. Pin status

The pin still fails for the exact stated reason. No edit to `tests/reviewPins.test.ts` is needed.

---

## Debt 1f: loss-toll ice bypasses `countedRez`'s free gate and `modelRezGain` does not check rest-of-turn keep

### 1. Pin name and output on today's beta

- **Pin:** `"Whitespace toll, the decision: the Corp keeps the money for Sleipnir and Send a Message is not stolen"` (`tests/reviewPins.test.ts:403-409`)
- **Normal `it.fails` run:** passes as expected fail (`× ... [expected fail]`).
- **Temporary `it` run assertion failure:**
  ```text
  FAIL  tests/reviewPins.test.ts > bundle R: rez count and timing (counted before any fix; the pins say what is asserted) > Whitespace toll, the decision: the Corp keeps the money for Sleipnir and Send a Message is not stolen
  AssertionError: expected true to be false // Object.is equality

  - Expected
  + Received

  - false
  + true

   ❯ tests/reviewPins.test.ts:408:66
      406|     expect(iceCreditNeed({ ...s }, { ...s.corp.servers.hq.ice[1], isRezzed: true })).toBe(0);
      407|     const end = remoteRunAfter(s);
      408|     expect(end.runner.scoreArea.some(c => c.cardCode === C.SAM)).toBe(false);
         |                                                                  ^
      409|   });
  ```
- Lines 405–406 pass (`countedRez` returns `null`, `iceCreditNeed` returns `0`). Line 408 fails because the Corp rezzes Whitespace, drops from 5 credits to 3, cannot rez Sleipnir (4) on `remote-1`, and the Runner steals Send a Message on the next click.

### 2. Code path producing the wrong decision

- `decideRez` (`src/ai/corp/rez.ts:182-232`) calls `countedRez(state, card)` at `src/ai/corp/rez.ts:194`.
- Inside `countedRez` (`src/ai/corp/rez.ts:42-78`), `iceCreditNeed(view, up)` is evaluated at `src/ai/corp/rez.ts:59`.
- `iceCreditNeed` (`src/ai/runs.ts:731-736`) calls `plainCreditNeed` (`src/ai/runs.ts:742-751`), which counts subroutines matching `subroutineBlocks` (`src/ai/runs.ts:744`). Because Whitespace's credit loss and threshold-conditional end-the-run are not counted as blocking break costs, `blocking` is `0` and `plainCreditNeed` returns `0` at `src/ai/runs.ts:745`.
- At `src/ai/corp/rez.ts:60`, `if (need === 0 && !countNeeds(state, ice)) return null;` returns `null` (`countNeeds` at `src/ai/corp/rez.ts:163-166` only returns true when the attacked server has an agenda in its root, which HQ does not). As a result, `countedRez` exits before reaching the R3 `spendsKept` check at `src/ai/corp/rez.ts:74`.
- Because `countedRez` returned `null`, `decideRez` falls through to the priced rez branch at `src/ai/corp/rez.ts:199-204` and calls `modelRezGain(state, card, synergy)` (`src/ai/corp/rez.ts:202`). That priced rez path does not check `spendsKept` / `rezMoney` for the rest of the Runner's turn, returns `gain > 0`, and `decideRez` returns `REZ_CARD` for Whitespace at `src/ai/corp/rez.ts:230`. This matches the debt description in `ref/debts-1c-1h.md` (1f) and `ref/rez-count-ruling.md` (C2).

### 3. Pin status

The pin still fails for the exact stated reason. No edit to `tests/reviewPins.test.ts` is needed.

---

## Debt 1h: `reservedForAgenda` double-counts the scoring remote's own holding rez

### 1. Pin name and output on today's beta

- **Pin:** `"reservedForAgenda, report-48 move 59: with remote-1 counted once it is reserved for the agenda"` (`tests/reviewPins.test.ts:523-526`)
- **Normal `it.fails` run:** passes as expected fail (`× ... [expected fail]`).
- **Temporary `it` run assertion failure:**
  ```text
  FAIL  tests/reviewPins.test.ts > bundle P: placement wiring (counted before any fix; the pins say what is asserted) > reservedForAgenda, report-48 move 59: with remote-1 counted once it is reserved for the agenda
  AssertionError: expected undefined to be 'remote-1' // Object.is equality

  - Expected:
  "remote-1"

  + Received:
  undefined

   ❯ tests/reviewPins.test.ts:525:55
      523|   it.fails('reservedForAgenda, report-48 move 59: with remote-1 counted once it is reserved for the agenda', { timeout: T }, () => {
      524|     const s: GameState = JSON.parse(readFileSync(new URL('./fixtures/placement-wiring/report-48-59.json', import.meta.url), 'utf8'));
      525|     expect(inCorp(s, () => reservedForAgenda(s)?.id)).toBe('remote-1');
         |                                                       ^
      526|   });
  ```
- `reservedForAgenda(s)` returns `null` (so `?.id` is `undefined`) instead of `remote-1`.

### 2. Code path producing the wrong decision

- `reservedForAgenda` (`src/ai/corp/placement.ts:400-413`) calls `lineKeep(state, agendas)` at `src/ai/corp/placement.ts:404` without passing `scoring.id` as the third `server` parameter (unlike its sibling `scoringShort` at `src/ai/corp/placement.ts:351`, which calls `lineKeep(state, agendas, scoring.id)`).
- In `lineKeep` (`src/ai/corp/rezMoney.ts:190-193`), leaving `server` undefined leaves `except` as `{}` (`src/ai/corp/rezMoney.ts:191`), so `rezMoney` includes the scoring remote's own holding rez in `floor`.
- `reservedForAgenda` subtracts `floor` from `horizon` at `src/ai/corp/placement.ts:406`, then asks `serverHold(state, scoring.id, { when: 'runnerTurn', corpCredits: horizon })` at `src/ai/corp/placement.ts:407` (and for each unique HQ ice at `src/ai/corp/placement.ts:410`), charging `remote-1`'s holding rez a second time against the same horizon. On `tests/fixtures/placement-wiring/report-48-59.json`, `serverHold` fails to hold and `reservedForAgenda` returns `null` at `src/ai/corp/placement.ts:412`. This matches the debt description in `ref/debts-1c-1h.md` (1h) and `ref/placement-review.md` (N6).

### 3. Pin status

The pin still fails for the exact stated reason. No edit to `tests/reviewPins.test.ts` is needed.

---

## Check Output Tails

```text
$ npm run typecheck
> tsc --noEmit
(exit 0)

$ npm run lint
> eslint src tests
(exit 0)

$ npx vitest run tests/reviewPins.test.ts
 Test Files  1 passed (1)
      Tests  28 passed | 3 expected fail (31)
```
