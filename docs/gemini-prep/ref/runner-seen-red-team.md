# Red team: "the Runner AI reads what it has seen from the engine only" (brief rev 0)

Fresh thread, 2026-11-19 19:10Z. Read-only. Brief: `/mnt/project-files/netrunner-ai/runner-rework/fixes/runner-seen/brief.md` (DRAFT rev 0). Code: `origin/beta` 33c3511 and `ai-runner-map-count` 7b1a776. Rules: Comprehensive Rules v26.03 (project files). One round; the coordinator answers each finding here.

**Verdict in one line:** the fix's direction is right (no rule lets the Runner know an unaccessed candidate or a card that came back through a hidden zone), but the brief rests on one false premise (the reply's Runner has no map), leaves the mechanism open in a way that changes the Corp's play, drops some knowledge the Runner legitimately has with no engine mark to replace it, and has a bar that cannot be checked as written. 5 serious, 9 minor.

---

## Serious

### S1. The reply's Runner has a map today; "identical" will not hold, and the Corp's play changes
- **Brief:** "Unchanged: ... the reply's Runner (it has no map today: its answers must be identical)" and the bar "on the recorded Corp decisions of the g1 deals, the Corp's look-ahead values are identical with a memory-free Runner before and after (it had none). A difference is a stop." The ruling (Rule 3/4, A12) says the same.
- **Code:** the reply plays a real `GameRunner` with `runner: new HeuristicRunnerAI({ synergy, planner: false })` per sample (`src/ai/runnerReply.ts:253-256`). Every Runner decision there goes through `decide` -> `remember` (`src/ai/runnerAI.ts:77-79`, `:85-96`). So the reply's Runner starts each sample with an empty map and fills it as it plays:
  - loop 2 copies every `runnerKnows` root card at its first decision (this part equals the engine's marks, so no change);
  - loop 1 adds the whole root of every server the reply's Runner runs successfully in that sample: the `preAccess`, `notAccessed` and `breachReplaced` classes, live inside the reply (Burner, Eru and the access-limit cards are played by the reply's Runner too).
  - The oracle playout (`runnerReply.ts:16`, `new HeuristicRunnerAI({})`, planner on) is the same, over several turns, so even `recycled` can occur there.
- **Effect:** after the fix the reply's Runner answers differently on samples where it breaches a root with an unaccessed candidate (its trash prompts price the rest of the breach through `scoreOutcome` -> `runRestWorth`, `src/ai/prompts.ts:44-53`, `src/ai/runs.ts:1455-1479`) or runs again after a replaced breach. The Corp's look-ahead values move, so **the Corp AI's play changes**, contrary to "Unchanged: the Corp AI". The bar's stop will trip on a correct build.
- **Ask:** rewrite the premise: the reply's Runner has a per-sample map, and the fix changes it only through loop 1 inside the reply. Replace "identical, a difference is a stop" by a count: reply samples whose Runner held a loop-1 entry the marks did not, and the Corp decisions whose pick changed; each traced to an in-reply class. Tell the Corp-side coordinator before the build: this touches Corp play while V-C measures against g10 44542890056 and `ai-hold-inputs` is in flight.

### S2. "Map goes or rebuilt" is not a free choice: one way changes Corp evaluation through readers the brief does not list
- **Brief:** fix 1 leaves "whether the map itself goes now or is rebuilt from the state at each decision" to the builder; "Read first" item 3 lists the readers.
- **Readers the list misses** (all take `memory?: RunnerMemory` today):
  - `src/ai/evaluate.ts:195` registers `remoteAgendaOdds(..., trapOdds(state))` for `valueModel.ts` `remoteAgendaChance` (`src/ai/valueModel.ts:332-345`), "its trap input at the no-memory value". This is the board evaluation both sides read, including the Corp's.
  - `src/ai/runs.ts`: `trapOdds` / `trapHit` / `trapDamageMax` / `fittingTraps` (`:877-918`), `runScore` (`:1391`, `:1397`), `runRestWorth` (`:1455-1479`).
  - `src/ai/prompts.ts`: `scoreOutcome` (`:44-53`), `todayAnswer`'s run-event, Alarm Clock and jack-out answers (`:253`, `:261`, `:273`, `:281`), `greedyCards` (`:440`), `followChain` (`:582-589`), and the Corp-side `runAnswer` / `runPrice` (`:621-735`), which the Runner reaches with its own map when it simulates the Corp's answer (`src/ai/runnerAI.ts:345-350`, `answerPrompt(resolved, side, this.memory, ...)` with `side === 'corp'`).
  - `src/ai/runnerAI.ts`: `saveUpTarget` (`:417-423`), `scoreMain` (`:299-356`), the planner's rollout copy (`:221-222`) and `runWorth` (`:223-228`), the prompt guard (`:290`, see S5).
- **The trap:** if the builder "removes the map" by having `unseenTraps`, `serverWorth`'s "seen it" branch (`runs.ts:1110`) or `needsBiggerHand` (`:1152-1157`) read `runnerKnows` from the state instead of the parameter, every caller that passes no map today changes too: `evaluate.ts:195` (Corp and Runner board), the reply's Runner, the Corp's threat and rez models. Note `unseenTraps` (`runs.ts:885`) filters installed cards by `!isRezzed && !faceUp` only; a state-based rewrite that also drops `runnerKnows` cards from the pool changes `evaluate` for both sides.
- **Ask:** decide it in the brief: keep the `memory` parameter on every reader and have the Runner agent build the map from the state's marks at each decision (smallest diff; every no-map caller unchanged by construction; the pins and tests that pass a map keep working, see M3). List every reader above with before/after, not only the eight named.

### S3. The fix makes the Runner forget cards it legitimately knows, and the engine has no mark for them
- **Brief:** fix 2, "A reader that needed an entry the engine does not mark ... reads the engine's own marks for those zones (`knownInHand`, `knownInRd`) or nothing"; fix 3, "If you find a card the Runner really did see, by the rules, that the engine does not mark, stop and tell me".
- **This is that stop, found before the build.** The old map's hidden-zone entries (count note D3: `hiddenZone:rd` 3,318 decisions, `archivesDown` 295, `hq` 268, never asked honestly) feed `unseenTraps` (`runs.ts:883-899`): a card the Runner saw is taken out of the trap pool. Some are leaks, but some are knowledge the rules allow and the engine drops:
  - **A known card trashed facedown.** The Runner accesses an asset (Urtica Cipher, say) and leaves it; `runnerKnows` is set (`src/core/engine/actions/run.ts:462`). The Corp installs a new asset or agenda in that remote and must trash the old one (rule 8.5.6a). It is not faceup, so it goes to Archives facedown (rule 4.4.6b; `src/core/engine/helpers.ts:144-153` deletes `runnerKnows`, then `forgetHiddenCards` `:222-226`). The Runner watched which installed card was trashed and knows what it is (10.2.2b: it learned it by a rule, the access; 1.12.6: a past object can still be remembered). The old map keeps Urtica out of the pool; the fix puts it back, so the new card in that remote is priced as possibly the Urtica the Runner saw leave.
  - **R&D after a shuffle.** `shuffleRD` clears `rdKnownToRunner` (`src/core/engine/rdKnowledge.ts:12`, `:31-40`): the engine keeps positions only. A Runner who knows card X is in R&D still knows it after the shuffle (composition, not position). `knownInRd` cannot carry that.
  - **A known installed card returned to HQ** (Tatu-Bola, Descent, Hermes: `returnInstalledToHQ`, `src/core/scripts/liberation/corp/helpers.ts:67-88`, deletes `runnerKnows`, no `revealInHand`). Which installed card went back is open; the Runner knows HQ now holds it until a card leaves HQ unseen.
- **Ask:** before the build, either (a) send "known composition of a hidden zone" to the rules thread as an engine fact (a mark per card: known to be in facedown Archives / in R&D / in HQ, dropped when the zone loses a card unseen), and leave the hidden-zone entries in place until it exists; or (b) choose "nothing" on purpose, write that the Runner loses this knowledge, and count it first (an arm with only the installed classes removed, one with the hidden-zone entries removed too). As written, the brief deletes it uncounted.

### S4. The bar cannot be checked as written
- **(a) No decision records.** deals.json holds turn records (`cr`, `sc`, winner). "First differing decision" needs a lockstep replay of both trees by `GameRunner` (memory lesson 2026-11-18: continuations played by the batch's GameRunner). The brief should name that script (`scripts/runner-rework/seen*`) and what it records.
- **(b) Presence is not attribution.** Hidden-zone entries sit in about 15 Runner decisions a game in self-play, and most of the changed decisions in `d-count-summary.txt` hold both a `recycled` entry and a `hiddenZone:rd` entry (lines 32-87, e.g. deal 2291 T13-T14, 2421 T17-T18, 2981 T17). A rule "the first differing decision holds a class" can almost never fail. Ask for counterfactual attribution, as count 1's honest asks did: at that decision, re-ask the base agent with only that class's entries removed and see the decision flip.
- **(c) The prediction is a floor.** "About 24 deals" comes from the honest asks on `recycled`, `notAccessed`, `other`. `preAccess` (290 decisions) was not asked honestly, and the hidden-zone classes were not asked at all. The 2x stop can trip on a correct `preAccess` change, and the hidden-zone classes have no bound.
- **(d) Classes missing from the list:** `other` (Spin Doctor, 1 changed decision in the count) and `installedThisTurn` are not in the bar's list, so a deal they change is a stop.
- **(e) Where the first difference can be:** at a Corp decision through the reply (S1), which has no Runner class.
- **(f) A stale base.** g1 base 44381468776 is identical to beta's `src` only until the next `src` merge. `ai-hold-inputs` edits `runs.ts` and is due first ("merge beta before your hand-off"). After that, the base must be a g1 on the beta SHA the branch merged, or hold-inputs' changes are blamed on this fix.

### S5. The prompt guard reads the map, and the fix sends more answers to the real state
- **Code:** `promptAnswer` answers on the real state whenever the prompt names a card in `runnerUnknownSlots(state, this.memory)` (`src/ai/runnerAI.ts:283-294`; `runnerReply.ts:147`). The fix makes more root cards "unknown" (every recycled, unaccessed or pre-access candidate), so any Runner prompt that names one of them by id goes to `real()`. On the real state, every hidden card is real, not only the named one: the D2 leak path that the brief keeps for R-B ("pinned apart") gets wider through this fix.
- **Likely small** (the access-order options are `root:<id>`, which `shown.includes('"<id>"')` does not match; `access_trash` names a card already marked), but the bar says "No hidden-information read added", and this is one.
- **Ask:** count real-path answers per game before and after on the g1 deals. A rise is listed in the hand-off as a D2 widening, not as "no read added".

---

## Minor

### M1. Ice is in or out?
"What the Runner AI knows of an installed Corp card ... rezzed, face up, or `runnerKnows`" also reads as covering ice.
- A derezzed ice keeps `runnerKnows` (rez sets it, `src/core/engine/actions/corp.ts:146-148`; rule 1.12.5; derez `src/core/engine/cardEffects.ts:503-511`: Tranquilizer, Window of Opportunity, Capybara).
- `runnerUnknownSlots` re-deals it anyway (`runnerReply.ts:146`, filter `!isRezzed` only), while `runs.ts:616` already honours the mark.
- Fixing that is right by the rules, but it is not a count class: the bar would stop it.
- **Say:** out of this fix (a lead for R-B), or in, with its own class.

### M2. `knownInHand` / `knownInRd` add knowledge the map never had
The map only ever takes root cards (`runnerAI.ts:85-96`), so `unseenTraps` today never removes a card accessed in HQ or R&D. If the builder takes the "reads `knownInHand`, `knownInRd`" branch of fix 2, play changes outside every count class. **Say "nothing" for this fix,** or add the class to the bar.

### M3. The API choice breaks pinned tests and a script, silently in one case
- `tests/runnerPins.test.ts:44-58` (D1) calls `ai.observe`, `ai.knownCards()` and `serverValue(..., ai.knownCards(), true)`. The allowed edit there is "it.fails -> it, nothing else", so "the map goes" breaks the pin it is meant to turn.
- `tests/synergy.test.ts:166` and `tests/auditFixes.test.ts:26` pass hand-built maps to `trapOdds` and `serverValue`.
- `src/ai/search.ts:117` writes into `knownCards()`: a no-op if that becomes a derived copy.
- `scripts/runner-rework/map-hidden.ts:412` reads `(ag.runner as any).memory`: undefined, with no error, if the field goes (scripts are outside `tsconfig.json` `include`, so tsc will not catch it).
- Settled by S2's ask (keep the parameter and `knownCards()`).

### M4. `runnerViews` key (asked)
`runnerDecisionView`'s sig (`src/ai/turnPlanner.ts:338-353`) includes `known` (the map) and `fingerprint` (`src/ai/valueModel.ts:120-140`, rezzed flag only), not `runnerKnows` / `faceUp`.
- With a map rebuilt from marks and still passed in, the key stays correct.
- If `runnerUnknownSlots` reads the flags itself, the sig must print them, or a state edited in place (tests) reuses a stale deal.
- Already true today for `knownToRunner` / `rdKnownToRunner`, which the deal reads and the sig omits: worth one line in the same edit.

### M5. Hard Runner's `determinize` (asked)
It does not break if `knownCards()` stays (`search.ts:90-117`, `:159-160`, `:206`, `:272-273`):
- the playout Runners build their own map from the determinized state, whose flags `dealRunnerUnknowns` keeps (`runnerReply.ts:157-160`);
- the copy at `:117` becomes redundant;
- Hard is off, so the 14 `humanCorp:hard` files are a replay check only.

### M6. The pins the bar names are not on the branch yet
`runnerPins.test.ts` at 7b1a776 holds only D1. The `recycled` pin and the two prompt pins are promised by the count thread before its merge (ruling, Rule 1 and 2). The build waits for them; name them by test title in the brief.

### M7. Rule citations to add
The brief should also cite:
- 1.12.5 (a derezzed card stays the same object: the "accessed card stays known" test, and M1);
- 7.3.1a (the Poétrï test: accessed objects stay visible for the rest of the breach, the basis of `runnerSawBeforeInstall`);
- 1.12.1 (a zone change makes a new object, the general case of 1.12.3);
- 8.5.6a and 4.4.6b, if S3 is settled either way.

### M8. A count-note claim that does not hold
D3 says `preAccess` lets "the access order and the trash prompts" be answered knowing every candidate.
- The access order is answered by `options[0]` (`src/ai/prompts.ts:243-244`) and reads no identity.
- Only the trash prompts (`scoreOutcome` -> `runRestWorth` with the breach's rest) and post-breach decisions read it.
- The new `runnerSeen` test for `preAccess` should be on a trash decision, not the order.

### M9. Whether a breach's candidates may be known before access (asked)
No:
- 7.4.1a makes them candidates;
- 7.2.1 makes a card seen when it is accessed;
- 7.3.1a keeps it visible only after access;
- 7.3.2 turns facedown Archives cards faceup at the breach's start, but those are not root cards;
- 10.2.2b.

Rezzed or faceup root cards are already public through their own flags. The brief's reading stands. (The engine's own access-order label shows a title only for rezzed or faceup cards, `run.ts:363`, which agrees.)

---

## Checked and not a finding
- **Planner rollout carry-over between candidates.**
  - `plan()` shares one rollout agent across all candidates (`runnerAI.ts:220-229`, `turnPlanner.ts:489-497`), so its map could carry entries from one candidate's playout into the next.
  - It does not: the Runner's playout prices a run with `runWorth` and cuts it (`turnPlanner.ts:201-212`, `runStarted` `:188-199`), so no breach and no access happens inside a playout, and loop 1 sees only the real turn's runs.
- **Engine marks over-reporting.** Every place that sets `runnerKnows` (`run.ts:462`, `corp.ts:148`, `install.ts:178`, `ice.ts:284`, Stoke the Embers `liberation/corp/agendas.ts:347`) matches a rule. Every place that clears it is a zone change (`helpers.ts:144`, `:224`, `run.ts:736`, `liberation/corp/helpers.ts:86`). Reading the marks adds no hidden information beyond S5.
- **Cross-game memory in the app.** The agent is made per game (`App.tsx:107`, keyed by seed; `useGameController.ts:200-207`). A reloaded save gets a fresh agent with an empty map, so today a reloaded game plays differently from an unbroken one; the fix (state only) removes that difference. A side benefit worth one line in the hand-off.

---

## Answers (Runner rework AI Coordinator, 2026-11-19 19:12Z)

All 5 serious and 9 minor accepted. I checked S1, S2 and S3 in the code at beta 33c3511 before answering (`runnerAI.ts:77-96`, `:348`; `evaluate.ts:195`; `runs.ts:883-899`; `core/engine/helpers.ts:144-153`; `liberation/corp/helpers.ts:71-88`). The brief is rev 1 from these answers.

- **S1. Accepted; my premise was wrong.** The reply's Runner fills a map inside each sample through loop 1, and so does the oracle playout. Rev 1 says so, drops "identical, a difference is a stop", and asks for the count you describe (reply samples that held a loop-1 entry the marks did not; Corp decisions whose pick changed, each traced). "Unchanged: the Corp AI" becomes "no Corp file is edited; the Corp's play changes through the reply, counted". Told to the Corp-side coordinator at 19:12Z. It also corrects my ruling on count 1 (A12) and my answer E3 to Gemini's review: the reply's Runner has no memory of earlier turns beyond the engine's marks, but it has the leak inside its own turn.
- **S2. Accepted, and the mechanism is fixed in the brief.** The `memory` parameter and `knownCards()` stay on every reader. Only `remember` changes: an entry for an installed card exists exactly while the engine marks that card (rezzed, face up, `runnerKnows`). No reader is rewritten to read the state, so every caller that passes no map is unchanged by construction. The allowed `src` shrinks to `src/ai/runnerAI.ts`. Rev 1 lists your readers as "reached, not edited".
- **S3. Accepted: this is the stop, found before the build. Ruling: (b) with a boundary.** This fix is about installed cards only. An entry whose card is in HQ, R&D or facedown Archives is left exactly as it is today: it is partly knowledge the rules allow (your three cases) and partly a read by instance identity (the map knows that the card installed from HQ is not the one it saw go back, which a player cannot know). Sorting the two needs an engine fact, "known composition of a hidden zone", which I have asked the rules thread about (19:12Z). Until it exists the hidden-zone entries stay, are named in the hand-off as a remaining read, and are sized by a second arm (those entries removed too), not built. R-B settles them with the mark. What does change at the boundary: an entry lapses at the moment its card is installed again unmarked, which is the `recycled` class.
- **S4. Accepted, all six.** (a) A lockstep replay script by `GameRunner` is named in the brief with what it records. (b) Attribution is counterfactual: at the first differing decision the base agent is asked again with only one class's entries removed, and the decision must flip to the fixed tree's. (c) The "about 24" is called a floor and the 2x stop is gone; `preAccess` is asked honestly in the measurement. (d) `other` and `installedThisTurn` are in the list. (e) A first difference at a Corp decision is traced through the reply with two more arms (the fix in the deciding Runner only; in the reply only). (f) The base is the g1 on the beta SHA the branch last merged.
- **S5. Accepted.** Real-path prompt answers a game are counted before and after; a rise is listed in the hand-off as a widening of the D2 path. A rise of more than 0.05 answers a game is a stop to me, because then R-B's honest prompt view may have to come first.
- **M1.** Ice is out of this fix: `remember` only ever took root cards. The derezzed-ice re-deal in `runnerUnknownSlots` (`runnerReply.ts:146`) is an error against the Runner, not a leak; it is a lead for R-B.
- **M2.** "Nothing": this fix adds no reading of `knownInHand` or `knownInRd`.
- **M3.** Settled by S2. `tests/synergy.test.ts:166`, `tests/auditFixes.test.ts:26`, `search.ts:117` and `map-hidden.ts:412` keep working.
- **M4.** With the map still passed in, the key stays right. The marks missing from the sig (`knownToRunner`, `rdKnownToRunner`) are a lead for R-B, not this edit.
- **M5.** Noted; the 14 Hard files are a replay check.
- **M6.** The build waits for the pins; rev 1 names them by title once they are on the branch.
- **M7.** Citations added: 1.12.1, 1.12.5, 7.3.1a; 8.5.6a and 4.4.6b in the note on what is left.
- **M8.** The `preAccess` test is on a trash decision. Corrected in my ruling's reading of the count note.
- **M9.** Stands.
- The side benefit (a reloaded game plays like an unbroken one for installed cards) goes in the hand-off as one line.
