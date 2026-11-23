# Review: bundle P, the placement wiring fix (brief rev 3) `ai-placement-wiring` @ 3aa6445e4b1076f3fa93c9311979d8dfca377029 — Approved
Base origin/beta @ 34f83acedef8bc45c9adfef56f448aa84e6f4129. Written 2026-11-20 05:38Z by the Corp AI Coordinator. Tier: FULL (src/ai logic).
Evidence re-run on 3aa6445e (spec's lists): typecheck PASS, lint PASS, tests PASS (251 files, 2,565 passed, 38 expected fail, 10 todo).
Evidence re-run on 47f895f885b2ab21f45ac73b95c8eadca5a804b0 (the hand-off's SHA, base 2abe91f8): PASS (250 files, 2,553 passed, 40 expected fail, 10 todo).

How it was reviewed: the hand-off's SHA 47f895f in full (every hunk of the diff against 2abe91f8, the tests, the reading,
the g1, eight mutations); then the later commits apart: 2f33fea0 (merge of beta 6e254bee, bundle R), fc722594 (one test
title), 3aa6445e (merge of beta 34f83ace, item 5's scripts). The source diff of 3aa6445e against beta 34f83ace is line for
line the source diff of 47f895f against 2abe91f8 (64 changed lines, compared by script); the same holds for
tests/placementWiring.test.ts, tests/readAssetTrash.test.ts and tests/fixtures/placement-wiring.

## Must fix (blocks merge)
- None.

## Should fix (merge may wait for Jeff's call)
- None.

## Notes (no action in this branch)
- N1 One file outside the allowed list, `docs/batch-logs/2026-11-20-g1-bundle-p-...txt`: the g1's breakdown that
  `scripts/batch-log.mjs` writes beside its row in the allowed `docs/ai-batch-log.md`. Accepted: the brief should have
  allowed `docs/batch-logs/**` (my gap; later briefs list it).
- N2 Deviation accepted: the refused-install tally (red team M4) is counted by the reading's record patch, not by a
  counter in src, because `src/ai/diagnostics.ts` is not an allowed file. It reads 0 of 889 top-level and 2,739
  look-ahead waiting-form candidates. `legalOr` (`src/ai/corp/candidates.ts:103`) keeps the bare install when refused.
- N3 Mutation m6 (fix 2 applied to the pair form too: `placement.pairWith ? from` replaced by the placed install at
  `src/ai/corp/candidates.ts:118`) is not caught by any test, and it cannot be: it is an equivalent mutant. A pair-form
  placement's server is the pick's own place by construction (`src/ai/corp/placement.ts:458`: `target ? target.id :
  'new remote'`, read back at `src/ai/corp/placement.ts:116`), so `placedInstall(from, placement)` is `from` again. The
  one corner where they could part is a `from` that carries `trashFirst` (the placed install drops it); the branch does
  not touch that path, and the snapshot test (`tests/placementWiring.test.ts:191`) holds the pair boards' candidates,
  values and order to the merge base's. Red team S1 ("the ice-pair form is not touched") is met by the code as written.
- N4 The 6 "own install" rows of M7 (deals 1881 i91, 2521 i105, 1891 i95, 2451 i115 and i116, 2691 i88): ruled IN the
  class. In each the differing move is the waiting cover's own install (c1 puts the asset on a new remote, c2 at the
  waiting remote); one side ran no playout to log, which is why the sum had no row for them. No first difference lies
  anywhere else, so M7's stop does not apply.
- N5 For the V-C checkpoint's g10 bar (M8), named now: fix 2 changes about 0.68 decisions a self-play game; on its 168
  pairs the branch is +0.04 ± 0.04 Corp wins, +0.51 ± 0.19 win-adjusted Corp points, −0.26 ± 0.19 points stolen (bar
  met, all sources and self-play alone). Two leans reported apart that do not decide by the brief: the class "base
  covers, the branch does not" (36 pairs, −0.17 ± 0.08 Corp wins, −0.17 ± 0.43 win-adjusted: under the 2 SE line the
  brief set), and the human Corp boards (11 pairs, −1.00 ± 0.54 win-adjusted, as in the count). Both are read again on
  the checkpoint's g10 and on the next human games.
- N6 Known debt left in on purpose: `reservedForAgenda`'s double count (1b; comment at
  `src/ai/corp/placement.ts:394`, pin `tests/reviewPins.test.ts:523` known-failing, found rows 89 e and j). It goes on
  the beta-to-main list beside 1c to 1g.
- N7 src/ai is at its line cap again (corp/ 4,068, src/ai 16,085, `tests/codeHealth.test.ts:530`): the next src/ai
  change must delete or raise it with its arithmetic.
- N8 Known-failing pins on beta after this merge: 38 (40, less the two bundle P pins of `tests/reviewPins.test.ts:485`
  and `tests/readAssetTrash.test.ts:58`, plus the 1b pin).

## Checked, clean
- **Spec match.** Fix 1: `rezMoney`'s `except` on the next-turn path, honoured only where the server stakes, memoised
  under its own key (`src/ai/corp/rezMoney.ts:69`); `lineKeep` takes the server (`src/ai/corp/rezMoney.ts:190`);
  `scoringShort` asks it with the scoring remote (`src/ai/corp/placement.ts:351`); `reservedForAgenda` unchanged
  (`src/ai/corp/placement.ts:404`). Fix 2: the waiting form only (`src/ai/corp/candidates.ts:118`). Fix 3: the order on
  `memo`, the WeakMap deleted (`src/ai/corp/candidates.ts:410`). Fix 4: the comment above `iceRedirect`
  (`src/ai/corp/placement.ts:370`), no code. Nothing from the brief's "not built" list is in the diff (1b, the pair
  form, `coverAtPlace`); one commit per fix in the brief's order.
- **Duplicate logic.** No second copy: `except` reuses `holdingRez`'s existing parameter and `stakedServers`
  (`src/ai/corp/rezMoney.ts:47`); `legalOr` is the only "legal or the other" helper in corp/; fix 3 removes a cache
  instead of adding one (replace, don't stack). Registry rows updated, `verify-registry --all` in the suite.
- **Layer (tuning ladder).** Each fix sits where the count traced it: the keep's reader, the candidate list, the cache.
  No new counted question, line, clause, number, switch or card code (metrics diff: only line counts move, src/ai +28).
- **Types and checks.** No `any`, cast, non-null assertion, ts-ignore or eslint-disable in src or tests; no test
  loosened, skipped or deleted; the 68 escape hatches are all in `scripts/review-fixes/placement-wiring*` (record
  patches, as the count's scripts).
- **Shared paths.** `rezMoney`'s and `lineKeep`'s new parameters are optional; every caller read
  (`grep "lineKeep(\|rezMoney("`): only `scoringShort` passes the server. No forbidden file, nothing in src/core,
  .claude or .github.
- **Hidden information.** The diff reads only the Corp's own HQ and the board the Corp sees; `stakedServers` reads the
  pools' owner (`agendasUnseen`, bundle R). No Runner-hidden card is read.
- **State and determinism.** `isLegalAction` is asked of an unchanged state and nothing mutates it after; no
  Math.random or Date.now; the memo keys carry everything the answer depends on (mutations m2 and m7).
- **Rules.** 8.5.11a (ice install cost is per ice already protecting the server; assets have none), 3.3.1 (one agenda
  or asset per remote root), 6.9.2b (the Corp can rez the approached ice in the approach window): read in the rules
  PDF v26.03; the comments cite them correctly.
- **Tests, by mutation** (`p-mutations.txt`): m1 `scoringShort` without the server: caught (2 tests); m2 memo key
  without `except`: caught; m3 `except` honoured where not staked: caught; m4 1b slipped in: caught (2); m5 fix 2
  reverted: caught (3); m6: equivalent (N3); m7 fix 3's key without the options: caught; m8 `lineKeep` ignoring the
  server when HQ holds an agenda: caught (2).
- **Red team answers** (`/mnt/project-files/adversarial/2026-11-19-placement-wiring/findings.md`): S1 pair form
  untouched (N3); S2 four columns in the sum; M1 the lender test (`tests/placementWiring.test.ts:114`) and "the double
  count removed" wording; M2 nothing of `icePaid` in the diff; M3 1b pinned and named (N6); M4 `legalOr` and the tally
  (N2); M7 the playout logs (N4); M8 the hand-off's continuation statement and N5; M9 the staked check and memo, 0
  control differences; M10 the comments and `rezAllowed`'s reach in the commit; M11 the WeakMap replaced, 0 changed
  decisions for fix 3. S3 and M5 apply only to a pair-form build (found row 89 g).
- **Measurements on 47f895f** (src head f1350562). Reading 44671723306: 25,029 Corp decisions, control differs 0,
  errors 0; fix 1 changes 3 decisions (all in class, report-48), fix 2 168 (165 in class, 3 traced through the
  look-ahead as the count predicted), fixes 3 and 4 change 0; pairs' bar met; time 0.942x mean. g1 44664285704 against
  44633584479, read by me on the deals records: 70 of 221 differ, each first parting at fix 2 in its class (lockstep
  script), Corp wins 110 against 104 (reported only).
- **The merges.** 2f33fea0: `rezMoney.ts` and `reviewPins.test.ts` merged by git with no conflict (bundle R's
  `stakedServers` and this branch's `except` are different hunks; read together: `except` asks the new
  `stakedServers`, so a scoring remote is left out exactly when it stakes, as before); the caps are R's plus this
  branch's 28. fc722594: bundle R's describe title only (`tests/reviewPins.test.ts:332`, my note from R's review).
  3aa6445e: clean.

## The g1 on the merged SHA (read 2026-11-20 05:39Z)
- Expectation, written before the run (my message to the builder): against 44664285704 it differs on item 1's six
  deals (1531, 1541, 1591, 1601, 1641, 2861) and bundle R's one (1021) and nothing else.
- Run 44680798149 (ref 3aa6445e, started from beta 34f83ace), read by me on the deals records (winner, cr, sc): 7 of
  221 deals differ, exactly those seven. Expectation met. Corp wins 114 of 221 (reported only).
- **This run is the g1 base of beta once the branch is merged** (beta 851b2c37, which landed since, is UI only).

Not checked: the scripts under `scripts/review-fixes/placement-wiring*` line by line (light tier: read for what they
patch and that they write nothing into src); play against a person.
