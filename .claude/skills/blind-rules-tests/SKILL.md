---
name: blind-rules-tests
description: Write blind rules tests for a Netrunner card set (or a list of cards) from the card text and the comprehensive rules only, without reading the card scripts, then triage every mismatch against the rulebook. Use for step 3b of the new card set process, or when asked for blind or independent rules tests.
---

# Blind rules tests

A second, independent reading of the cards. The thread that implements a set tests what it wrote; this
thread tests what the card text and the rules say. It only works if you have **not** seen the card code.

## 0. Ground rules

- Run in its own thread, never in the thread implementing the set. Work on `beta`, in
  `tests/blindRules/<set>.test.ts` (one file per set; existing: systemGateway, elevation, vantagePoint, liberation).
- Until your tests are written, do **not** open `src/core/scripts/**` or the set's own card tests
  (`tests/<set>*.test.ts`, `tests/*<Card>*.test.ts`). You may read `tests/helpers.ts`,
  `tests/blindRules/util.ts`, `src/core/index.ts`, `src/core/types/**` and the generic engine flow in
  `src/core/engine/**` to drive games.
- Sources: card text in `src/data/<set>-cards.json` (`stripped_text`, `cost`, `strength`, `keywords`,
  `advancement_cost`, `agenda_points`) and the Comprehensive Rules
  `/mnt/project-files/Netrunner/Resources/Rulebook/Null_Signal_Games_Netrunner_Comprehensive_Rules_v26.03.pdf`
  (`pdftotext -layout` it into your scratchpad and grep for rule numbers).
- No `src/` changes. You report engine bugs, you do not fix them.

## 1. Pick the cards (20-30 per set)

Choose from the text alone. Good picks have wording where an implementation is easy to get subtly wrong:

- replacement and prevention: "instead", "prevent", "would" (9.9.5, 9.9.8)
- once-only timing: "the first time each turn", "the next time", "once per turn" (9.3.2b, 9.9.5a)
- static conditions: "while", "if", "during a run against this server", "anywhere except" (9.3.2c, 9.4.2)
- additional and nested costs: "as an additional cost", "unless", several costs at once (1.16.4, 1.16.10)
- "when rezzed" vs "when installed" vs "when you rez this ... during a run"; rezzes by card abilities (8.1.2b)
- persistent, lingering, "for the remainder of", "when this run ends" (9.10, 9.12.5, 6.8.5)
- cards leaving play mid-effect, hosted cards, uninstalling hosts
- "may" vs "must" (9.12.3, 1.17.3d), steal and score triggers (1.17.6-8), dividends (10.13), threat (1.17.1a)
- inactive cards: unrezzed ice and assets, agendas in the Runner's score area (9.1.7, 9.1.8, 4.5.4)
- interactions with older sets' cards (re-tag candidates), and anything in the bug backlog or past rules-bug reports.

## 2. Write the tests

- One `describe` per card, titled with the card name and the quoted tricky phrase. Each test cites its rule
  numbers in a comment. Test both sides of a condition (the case that fires and the case that must not).
- Drive games with the public API: `newGame`, `giveCard`, `installCorpForTest`, `installIceForTest`,
  `installProgramForTest`, `runnerInstall`, `scoreForTest`, `run`, `toCorp`, `corpPasses` from
  `tests/helpers.ts`, and `drive` (plays a run out, answering prompts), `pick`, `chooseCard`,
  `accessedSince` from `tests/blindRules/util.ts`. Check results through state (credits, grip, tags,
  score areas, `runsThisTurn`, `iceStrength`, `rezCostOf`, `isLegalAction`).
- Never mutate a state after `isLegalAction`/`getLegalActions` on it except for test setup before the first
  action (legality is cached per state).

## 3. Triage every mismatch

Only now read the code for the failing cards. For each failure decide against the rulebook:

- **Test wrong** (you misread the rules or drove the engine wrongly): fix the test and note the rule that
  settled it.
- **Engine wrong**: keep the test as `it.fails(...)` with a comment `KNOWN BUG (found <date>): ...` and
  "when fixed, change it.fails back to it". `it.fails` passes while the bug exists, so CI and Cloudflare
  builds stay green and the test flips to failing once someone fixes the bug.

Commit only passing files (failing tests block Cloudflare deploys). Update `tests/blindRules/README.md`
(cards covered, known bugs). Run typecheck, lint and the tests before pushing; check CI after.

## 4. Report

- Send each engine bug to the "Fix rules bugs from playtesting" thread (cmsg_013UNycUZbB5MfsLyJaSoKuFDTWqJVJrBzxiJJ9YatHeLS):
  card text quote, rule number, where the code goes wrong, and the `it.fails` test name.
- Tell Jeff in a few lines: tests written, how many matched, the real bugs, and test mistakes worth knowing.
