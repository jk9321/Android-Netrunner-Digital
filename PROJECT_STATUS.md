# Netrunner Digital // Project Status & Collaboration Guide

> [!IMPORTANT]
> **MANDATORY INSTRUCTION FOR ALL AI AGENTS & DEVELOPERS (Antigravity, Claude, etc.):**
> Before starting work, **read this file completely** to understand the architecture, active design decisions, and current progress.
> **Whenever you implement a feature, refactor code, or modify the roadmap, you MUST update this file** (specifically the *Current Status*, *Task Checklist*, and *Changelog* sections) so subsequent agents and developers maintain perfect context continuity.

---

## 1. Project Overview & Rules Reference
This project is an open-source digital implementation of **Android: Netrunner**, adhering strictly to the **Null Signal Games (NSG)** rules and card formats.
* **Rules Reference:** [Null Signal Games Comprehensive Rules](https://rules.nullsignal.games/) (v26.03 or later; consult it for official timing structures, trigger rules, and definitions)
* **Card Database:** Null Signal Games releases via [NetrunnerDB API v2.0](https://netrunnerdb.com/api/2.0/public/cards)
* **Active Card Pools:**
  * ✅ **System Gateway** (`sg`) — Primary foundation (77 cards)
  * ✅ **Borealis Cycle** (`msbp`, `ms`, `ph`)
  * ✅ **Liberation Cycle** (`tai`, `rwr`)
  * ✅ **Current NSG Sets** (`elev`, `vp`)
  * ❌ **Rotated / Excluded Sets:** System Update 2021 (`su21`), Magnum Opus (`mo`), and older Fantasy Flight Games (FFG) sets are strictly excluded.

---

## 2. Tech Stack & Architecture

### Stack Components
* **Language:** TypeScript 5.7+ (strict mode enabled).
* **Game Core Engine (`src/core/`):** Pure TypeScript, completely decoupled from React and DOM.
  * Deterministic and headless.
  * Can run on the browser client (for zero-latency solo play vs AI) and on Node.js/Bun servers (for authoritative multiplayer).
* **Frontend UI (`src/ui/`, `src/App.tsx`):**
  * **React 19** + **Vite 6**
  * **Tailwind CSS** with custom cyberpunk palette (`cyber-dark`, `cyber-neonCyan`, `cyber-neonPink`, etc.)
  * **Framer Motion** for card transitions (FLIP animations)
  * **Lucide React** for icons
* **Testing:** **Vitest** (fast headless unit testing for game rules and timing interactions).
* **Desktop Executable Target:** Architecture is prepared for **Tauri** packaging to output lightweight Windows `.exe` binaries without modifying web code.

### Architectural Invariants
1. **Never leak hidden information to the client:** In multiplayer, unrezzed cards in Corp servers and cards in R&D/HQ must be stripped before sending state to the Runner.
2. **Headless engine purity:** `src/core/` must never import React, DOM, or browser-specific globals. All state transitions must be pure functions or easily cloneable state operations.
3. **Automated test coverage for rules:** Whenever a new rule or complex card ability is written, add a corresponding test in `tests/`.
4. **Determinism:** All randomness goes through the seeded RNG stored in `GameState.rng` (`src/core/rng.ts`); card instance ids come from `GameState.nextInstanceId`. `src/core/` must never call `Math.random`, `Date.now` or `new Date()`. Same seed + same action list = identical state. `tests/enginePurity.test.ts` enforces this and invariant 2.
5. **Plain-data state:** `GameState` is plain JSON. Card instances store only `cardCode`; look up definitions with `cardDef(card)` / `getCardDefinition(code)` from `src/core/cards.ts`.
6. **One way in:** Every state change goes through `executeAction(state, action)`, which never mutates its input and throws `IllegalActionError` for illegal moves. Use `getLegalActions(state, side)` to drive UI buttons and AI rather than re-implementing rules checks. Import engine APIs from `src/core` (the `index.ts` barrel).
7. **Player decisions are prompts:** When the rules need a player to choose (mulligan, discard to hand size, trash on access, and future "you may" effects), the engine pushes a `Prompt` onto `GameState.pendingPrompts` (`src/core/types/prompts.ts`, `engine/prompts.ts`). While any prompt is pending, the only legal action is `RESOLVE_PROMPT` for the first one, from its side. Multi-step flows (e.g. breach via `activeRun.accessQueue`, end of turn via `finishEndTurn`) must be resumable after the answer. Add new decision types as a new `Prompt` kind + `PromptChoice` + a case in `engine/actions/prompt.ts` + answers in `legalActions.ts`. Card effects use the generic `effect_choice` / `effect_cards` prompts via `askChoice` / `askCards` in `src/core/scripts/effects.ts`.
8. **Card scripts:** Card abilities live in `src/core/scripts/` as a `CardScript` per card code (`canPlay`, `onPlay`, `onPromptAnswer`), registered in `scripts/index.ts`. A card with no script is treated as not implemented (`NotImplementedError`), so it is never offered as a legal play. Each scripted card gets a test in `tests/`.
9. **Ice encounters:** An encounter is `activeRun.encounter` (`iceId`, `broken[]`, per-breaker `boosts`, `resolvingIndex`). While `resolvingIndex` is null the Runner may `BREAK_SUBROUTINE` / `BOOST_BREAKER` / `BIOROID_BREAK`; `CONTINUE_RUN` starts resolving unbroken subroutines in order. A subroutine may queue a prompt; `resolvePrompt` then calls `resumeEncounter` to carry on. Ice and breaker behaviour is data on the card script (`ice: IceScript`, `breaker: BreakerScript` in `scripts/types.ts`); generic logic lives in `engine/ice.ts` and `engine/actions/breaking.ts`. Damage and tags go through `engine/damage.ts`; every way a run ends goes through `endRun` in `engine/runEnd.ts`.
10. **Card abilities (`engine/triggers.ts`, `engine/cardEffects.ts`):** A `CardScript` reacts to game events through `triggers` (`turn_begins`, `installed`, `rezzed`, `advanced`, `agenda_scored`, `agenda_stolen`, `successful_run`, `approach_server`, `run_ends`, `tags_taken`, `trashed_on_access`, `discard_phase_ends`), fired by the engine with `fireTrigger` to every active card (identities, rezzed Corp cards, Corp score area, installed Runner cards). Click and paid abilities are `abilities` used with `USE_ABILITY`; costs (clicks, credits, hosted counters, trash or remove self) are declared and paid by the engine. Constant effects are `modifiers` (memory, hand size, install cost, extra breach accesses, first basic draw); hand size and MU are derived from them, never stored by scripts. Per-turn counters and "once per turn" flags live in `state.turnFlags` (keys in `TurnFlag`), cleared when the turn passes. Hosted credits and virus counters are `card.tokens`. Run-scoped effects (Red Team, Jailbreak, Conduit, Tread Lightly, Overclock) are options on `startRun`. Pay Runner costs with `spendCredits`/`availableCredits` so run-only credits (Overclock) are used.

---

## 3. Directory Layout

```
Netrunner/
├── PROJECT_STATUS.md                   <-- THIS LIVING DOCUMENT
├── package.json
├── vite.config.ts
├── tailwind.config.js
├── scripts/sync-cards.mjs              <-- `npm run sync-cards`: refreshes src/data/*.json (card data) from NetrunnerDB; no images (card art loads from card-images.netrunnerdb.com at runtime)
├── public/card-backs/                  <-- Our own corp.svg / runner.svg (NSG card art and backs are not licensed for redistribution, so none are in the repo)
├── src/
│   ├── core/                           <-- Pure TypeScript Game Engine
│   │   ├── index.ts                    <-- Public engine API (import from here)
│   │   ├── rng.ts                      <-- Seeded PRNG (mulberry32) + shuffle
│   │   ├── cards.ts                    <-- Card definition registry (cardDef / getCardDefinition)
│   │   ├── deckValidation.ts           <-- validateDeck: size, deck limits, influence, agenda points, out-of-faction agendas
│   │   ├── scripts/                    <-- Card abilities: types, effects helpers, operations.ts, events.ts, ice.ts, breakers.ts, corpCards.ts, runnerCards.ts, index.ts registry
│   │   ├── types/
│   │   │   ├── card.ts                 <-- Card schema, instances, tokens
│   │   │   ├── state.ts                <-- GameState, CorpState, RunnerState, RunState
│   │   │   ├── actions.ts              <-- Legal player actions & types
│   │   │   └── prompts.ts              <-- Prompt / PromptChoice types
│   │   └── engine/
│   │       ├── gameState.ts            <-- createInitialGameState(GameSetup): seeded deal
│   │       ├── gameEngine.ts           <-- executeAction: clones state, dispatches to handler table
│   │       ├── legalActions.ts         <-- getLegalActions(state, side)
│   │       ├── ice.ts                  <-- Encounters: strength, subroutine resolution, passing ice
│   │       ├── damage.ts               <-- Net damage (flatline), tags, trashing installed Runner cards
│   │       ├── runEnd.ts               <-- endRun / endTheRun (fires run_ends)
│   │       ├── triggers.ts             <-- activeCards, fireTrigger
│   │       ├── cardEffects.ts          <-- Turn flags, counters, hosted credits, spending, hand size/MU, trash/derez/remove from game, console & unique limits
│   │       ├── errors.ts               <-- IllegalActionError / NotImplementedError
│   │       ├── prompts.ts              <-- pushPrompt / activePrompt (player-choice queue)
│   │       ├── helpers.ts, log.ts      <-- Shared engine utilities
│   │       └── actions/                <-- One module per action group (basic, install, play, corp, run, turn, prompt)
│   ├── data/
│   │   ├── cards.ts                    <-- Typed card lookup utilities
│   │   ├── decks.ts                    <-- Playable decklists (2 official starters + 7 Gateway faction builds), deckGameSetup
│   │   ├── sampleDecks.ts              <-- One-of-each sample decks used by tests (not legal decks)
│   │   └── system-gateway-cards.json   <-- Bundled card metadata
│   ├── ui/
│   │   ├── glossary.ts                 <-- Rules keyword definitions + card-text annotation for hover tooltips
│   │   └── components/
│   │       ├── CardView.tsx            <-- Card renderer with hover stats & face-down backing
│   │       ├── ServerColumn.tsx        <-- HQ, R&D, Archives, Remotes with Ice stacks
│   │       ├── RigView.tsx             <-- Installed Programs, Hardware, Resources
│   │       ├── RunOverlay.tsx          <-- Real-time run tracker overlay
│   │       └── LogFeed.tsx             <-- Cyberpunk terminal event log
│   ├── App.tsx                         <-- Main interactive tabletop interface
│   ├── main.tsx
│   └── index.css                       <-- Tailwind directives & cyberpunk styles
└── tests/
    ├── helpers.ts                      <-- newGame(seed), putInHand(), startRunnerTurn()
    ├── gameEngine.test.ts              <-- Core action tests
    ├── determinism.test.ts             <-- Seeded RNG + replay tests
    ├── legalActions.test.ts            <-- getLegalActions tests
    ├── rulesFixes.test.ts              <-- Regression tests for rules fixes
    ├── prompts.test.ts                 <-- Mulligan, discard, trash-on-access prompts
    ├── operationsEvents.test.ts        <-- Playing operations/events + each scripted card
    └── enginePurity.test.ts            <-- Guards: no Math.random/Date.now/React/DOM in src/core
```

---

## 4. Implementation Roadmap & Status

### Phase 1: Foundational Engine & Gateway Pool (CURRENT)
- [x] Workspace scaffolding (Vite + React 19 + TypeScript + Tailwind + Vitest).
- [x] Download System Gateway card data to `Resources/Cards/System Gateway`.
- [x] Core state types (`GameState`, `CorpState`, `RunnerState`, `ServerState`, `RunState`).
- [x] Turn loop & basic click actions (gain credit, draw card, end turn).
- [x] Card installation (Ice on servers, Cards in remote roots, Runner Rig).
- [x] Basic Run initiation and server access logic.
- [x] Automated test suite passing in Vitest (`tests/gameEngine.test.ts`).
- [x] Interactive Tabletop UI with live server columns, rig layout, and log feed.
- [x] Engine refactor: seeded RNG in state, deterministic ids, cardCode-only instances, per-action handlers, `getLegalActions`.
- [x] Rules fixes: turn enforcement, install restrictions (no events/operations, no agendas/assets in centrals, one agenda/asset per remote), MU limit, agendas can't be rezzed, ice rezzed only on approach (Corp rez window in run overlay), advancing only advanceable cards, scoring as a separate `SCORE_AGENDA` action, breach accesses HQ (random, seeded) / R&D top / all of Archives, no skipped cards on access, Corp mandatory draw on turn 1.
- [x] Player-choice prompt model (`pendingPrompts` + `RESOLVE_PROMPT`): mulligan (Corp then Runner), discard to hand size at end of turn, pay-to-trash on access. Turns can only end once all clicks are spent. UI: `PromptPanel` (draggable, minimizable `FloatingPanel`).
- [x] Roadmap M1 — play operations & events: `PLAY_OPERATION_OR_EVENT`, card script registry, effect prompts, run/install-turn tracking. Scripted: Sure Gamble, Creative Commission, VRcation, Wildcat Strike, Mutual Favor, Hedge Fund, Government Subsidy, Hansei Review, Sprint, Predictive Planogram, Seamless Launch. (Full roadmap: https://claude.ai/artifact/HzYaWkAZGsA2ehdMqTGPZW)
- [x] Roadmap M2 — ice & icebreakers: encounters, strength, subtype matching, break/boost, bioroid click-breaks, subroutine resolution with prompts, jack-out timing. Scripted all 11 Gateway ice (Ansel 1.0, Brân 1.0, Diviner, Karunā, Funhouse, Ping, Ballista, Pharos, Palisade, Tithe, Whitespace) and 7 breakers (Buzzsaw, Cleaver, Carmen, Marjanah, Echelon, Unity, Mayfly). Basic net damage and tags pulled forward from M4.
- [x] Roadmap M3 — card ability framework: triggers, `USE_ABILITY` click/paid abilities, once-per-turn tracking, hosted credits and virus counters, hosting programs on ice, lasting modifiers, console and unique limits, derez, remove from game, extra accesses, mid-access abilities, runs started by cards. Scripted every Gateway identity, agenda, asset, upgrade, hardware, resource and remaining program, plus Tread Lightly, Jailbreak and Overclock.
- [x] Roadmap M4 — tags and damage: `REMOVE_TAG`, `TRASH_RESOURCE` (while tagged), `PURGE_VIRUS`; net, meat and core damage with flatline (including max hand size below 0 at the discard step); Urtica Cipher, Clearinghouse, Orbital Superiority, Neurospike, Public Trail, Retribution. Every System Gateway card now has a script (the two starter identities have no text).
- [x] Roadmap M6 — decks: the official Catalyst and Syndicate starter decks, NSG's official System Gateway-only sample decks for the 7 faction identities (44-card Corp, 40-card Runner; from the NSG Getting Started sample decklists page), `validateDeck`, and a deck picker start screen. `?seed=&corp=&runner=` in the URL replays a deal.
- [x] Deckbuilder: create, copy, edit and delete custom decks on the deck picker, with live legality checks; saved in the browser (localStorage).
- [x] Play formats in the deckbuilder: Casual (default), Startup and Standard card pools and current ban lists (`src/core/formats.ts`). Eternal is out of scope.
- [x] Deck import from NetrunnerDB: paste a text/Markdown/BBCode export, a jinteki.net list or a decklist link, or load a .txt/.o8d file; cards outside the pool are listed and left out.
- [x] Random deck button for each side on the deck picker: picks a legal official sample or custom deck, never a starter deck.
- [x] Roadmap M7 — UI: Corp installs into any legal server (ice on centrals, upgrades, replacing a remote's card); browsable Archives, Heap, score areas and removed-from-game; view modes (Open table, Pass and play with a hand-off screen and Corp rez windows during runs, Corp view, Runner view) that hide each side's secrets; card flip animations; synthesized sound effects with mute; prompts no longer cover the header.
- [x] Support Agenda scoring & advancement counters with victory checks.
- [x] Forfeit: a flag button in the header asks to confirm, then sends `CONCEDE` (legal for either side at any time, even mid-run or with a decision pending). Against the computer the person concedes; in pass and play the side holding the device; in Open table the player whose turn it is.

### Phase 2: Card Ability System & Advanced Timing
- [x] Implement card effect triggers (e.g., `when_installed`, `when_rezzed`, `on_access`, `trash_ability`). (Roadmap M3)
- [x] Script core System Gateway icebreakers and ice. (Roadmap M2)
- [x] Net damage, Meat damage, and Brain/Core damage resolution. (Roadmap M4)
- [x] Tagging system. (Roadmap M4; no Gateway card uses Bad Publicity)

### Phase 3: Solo AI Opponent
- [x] Define `Agent` interface (`src/ai/agent.ts`: `chooseAction(state)`, plus `chooseRez(state, cards)` for the Corp's rez windows). (Roadmap M8)
- [x] Build `HeuristicCorpAI`:
  - Evaluate remote scoring opportunities.
  - Prioritize ice installation and rez decisions based on runner threats.
- [x] Build `HeuristicRunnerAI`:
  - Calculate run safety and break costs.
  - Prioritize icebreaker installations and vulnerable server breaches.
- [x] "Opponent" choice on the deck picker: two players, or the computer plays the Corp or the Runner.
- [x] Web Worker execution so AI calculation doesn't block the UI thread (`src/ai/worker.ts`, `src/ai/client.ts`).
- [x] Hard difficulty: Monte Carlo look-ahead over re-dealt hidden information (`src/ai/search.ts`).
- [x] Deck-aware AI layer (`src/ai/synergy.ts`, `synergyTags.ts`): per-card enabler/payoff tags, live deck and opponent profiles, capped move nudges, trap caution, Corp bluffing, Dividends. Weights per side in `tuning`, measured with `scripts/ai-match.sh`. A new set must add its cards to `SYNERGY` (tests/synergy.test.ts fails otherwise).
- [x] AI setup planning (`tuning.plan`): `when` condition tags per card, Runner urgency on scoreable agendas, breakers weighted by shown ice, saving up for runs, Corp score setups and tag-before-Orbital, tag threat, ice placement and agenda stakes.
- [x] Corp economy and defence (round 3, `tuning.plan`): rez money for two key servers, R&D ice first (HQ only while it holds agendas), agenda timing (no half-advanced agendas). `scripts/ai-match.sh` logs how the new Corp loses (`scripts/lossLog.ts`); `scripts/corp-losses.sh` logs self-play.

### Phase 4: UI Polish & Animation Juice
- [x] Hand animations (`HandRow`): drawn cards slide in, played/installed cards lift out, discarded cards drop away, the rest close the gap. Hidden hands animate face down.
- [ ] Cards fly from hand to their exact spot in the Rig / Server.
- [x] Card flip when cards are rezzed, revealed or turned over (M7).
- [x] Sound effects for actions (M7, `src/ui/sound.ts`).
- [x] Stolen / Scored / Trashed: the card shows big in the middle of the table with a stamp, then heads off (`src/ui/cardFates.ts` diffs states; `CardFates.tsx`). Cards trashed face down stay hidden from the Runner.
- [x] Card-selection prompts stop at their maximum (a one-card prompt swaps the pick).
- [x] Run highlights: the targeted server pulses with a RUN TARGET badge; the ice the Runner is at glows with Approaching / Encountering / Passing; the root shows Approaching / Breaching.
- [x] Full card zoom modal on click/inspect and high-res hover popout via Portal.
- [x] Dynamic card scaling system (Normal / Large / Huge) with legible card art and text.
- [x] Decision pop-ups (prompts, run overlay, game over) are draggable and minimizable so the board stays visible.
- [x] Rules keyword glossary: hover underlined terms in card text and UI labels for a short definition (`src/ui/glossary.ts`).
- [x] Card names in the terminal log and in decision pop-ups (prompt text and choice buttons) are underlined; hover or focus one to see that card (`CardNameText.tsx`). Only names the log already prints, so nothing hidden leaks.
- [x] Cyberpunk theme: angular clipped corners, HUD brackets, CRT scanlines, Night City yellow/red palette, terminal-green log. All colours are CSS variables at the top of `src/index.css`; `tailwind.config.js` routes `slate`/`cyan`/`pink`/`amber` (and `cyber-*`) through them, so a recolour is one edit. Faction colours keep Tailwind defaults.

### Phase 5: Multiplayer with a Friend
- [ ] Lightweight WebSocket room server (e.g., Node.js + `ws` or Colyseus).
- [ ] Private state scrubbing (Corp cannot see Runner Grip cards; Runner cannot see unrezzed Corp cards).
- [ ] 4-character room codes for instant browser link invitations.

### Phase 6: Desktop Executable Packaging
- [ ] Add Tauri config (`@tauri-apps/cli`).
- [ ] Single-click build for Windows `.exe` release.

---

## 5. Development Commands

* **Start dev server:** `npm run dev` (Runs locally on `http://localhost:3000`)
* **Run unit tests:** `npm test`
* **Run tests in watch mode:** `npm run test:watch`
* **Build production bundle:** `npm run build`
* **Sync/update card data:** `npm run sync-cards`
* **Replay a specific deal:** open the app with `?seed=<number>` (the current seed is shown in the header).

---

## 6. Changelog & Agent Work Log

| Date | Agent / Dev | Changes Made |
| :--- | :--- | :--- |
| **2026-10-25** | Claude | Deck-aware AI. `src/ai/synergyTags.ts`: hand-written `gives`/`wants` theme tags (econ, draw, runs, hq, rd, trash, virus, discard, install, breakers, tags, damage, advance, operations, bioroid, denial, ice) for all 159 cards, plus `inferSynergy` from card text for untagged cards; `tests/synergy.test.ts` flags any untagged card. `src/ai/synergy.ts`: each side's live deck profile (identity x3, hand/installed x1.5, deck x0.5, trashed 0) and a read of the opponent's public cards; `nudge()` adds at most 1 point to a move for feeding live payoffs, playing payoffs whose enablers are around, or countering the opponent (trash an econ Corp's money assets, clear tags against tag decks, bigger hand against damage, purge against viruses); `keepBonus` for discards; `?aidebug` logs each AI move's reasons in the browser console. Runner: `trapOdds` in `runs.ts` makes it warier of unknown remotes as the Corp shows traps (more so with no ice). Corp: traps behind cheap ice, Urtica advanced for lethal, naked-agenda reverse bluff once a trap is in Archives, Dividends agendas over-advanced before scoring. `scripts/ai-match.sh` plays new-vs-old batches on 4 cores (`SIDE`, `KEEP`, `WARY`, `BLUFF`, `DIVIDENDS`, `PURGE`, `DIAGONAL`, `BASE_CACHE`). Per-piece results (663 deals each, noise about ±16): Runner opponent reading +22, hand-keeping +4, trap caution +4, own-deck nudge -19; Corp own-deck nudge -15, opponent reading -25, hand-keeping -14, Dividends -1, bluffing -4. Shipped: the Runner pieces that won plus the Corp's bluffing/Dividends/purge; own-deck nudges and Corp nudges are weight 0, to re-test with Vantage Point. Final Normal batch, 1,105 deals: new Runner +14 games vs old, new Corp -12 (both within noise). Fixed a Pantograph crash when the chosen card had left the grip. |
| **2026-10-25** | Claude | AI setup planning (round 2). `synergyTags.ts` gains `when` condition tags (ifTagged, onScore, scoredThisTurn, successfulRun, notInstalledThisTurn, threat) with a lint test. Flags in `tuning.plan`: tag threat (tags valued by the punishers in play), breaker focus (breakers for ice types the Corp has shown), Runner urgency (agendas the Corp can finish next turn, late-game defence), Runner saving up for an unaffordable run, Corp score setups (Seamless Launch/KPI) and tagging before Orbital Superiority, ice placement as zero-mean shifts (types the rig can't break, servers under attack, HQ vs R&D by agendas in HQ, mixed types), agenda stakes (points, a winning steal, 0.25 per counter). A flat ice bonus made the Corp over-ice (-23 games) and was reworked. Final Normal batch, 1,105 deals (noise about ±20): new Runner +24 games vs old, new Corp -15. Own-deck synergy and hand-keeping stay off. |
| **2026-10-25** | Claude | Corp AI round 3, from a loss log (`scripts/corp-losses.sh`: Runner points came 40% from R&D, 39% remotes, 19% HQ; unrezzed ice meant a broke Corp, about 1 credit). `tuning.plan.rezMoney`: the rez reserve covers the two most expensive of R&D, agenda remotes and HQ while it holds agendas, graded, with a small reward for money that climbs back. `centralIce`: R&D ice first, HQ only while it holds agendas. `agendaTiming`: install or advance an agenda only if the rest of the turn leaves it scoreable next turn behind ice the Corp can still rez, then use the turn on it. Every `ai-match.sh` batch now prints the new Corp's loss breakdown. Batches, 1,105 deals: new Corp +46 games vs old (43.8%, was 39.6%); without rez money +24, without agenda timing +19, without central ice +58. |
| **2026-10-21** | Antigravity | Initial setup: scaffolded Vite + React 19 + TypeScript + Tailwind workspace; fetched 77 System Gateway cards and high-res images to `Resources/Cards/System Gateway`; built headless rules engine (`src/core/`); implemented basic turn/run actions; wrote passing Vitest test suite; created interactive tabletop UI; authored `PROJECT_STATUS.md`. |
| **2026-10-21** | Antigravity | Enhanced visual readability & fixed pop-outs: copied 77 local card images to `public/cards/`; increased card dimensions across tabletop by 2x–3x with dynamic scaling toggle (Normal/Large/Huge); removed obscuring dark gradient on card images; fixed Corp pop-out bug by creating a Portal-based `CardPopout` with viewport boundary clamping; resolved Rez button mouse event interception in `ServerColumn`; allowed Corp players to peek at unrezzed cards and inspect abilities; added interactive Corp and Runner Identity inspect previews and full-screen `CardZoomModal`. |
| **2026-10-21** | Antigravity | Fixed action overflow bug: separated active turn action controls into dedicated toolbars; added `min-w-0` to all flex containers to prevent large cards from expanding past the screen; anchored "End Turn" button cleanly within the UI and added a quick "End Turn" button to the sticky top header. |
| **2026-10-21** | Claude | Engine refactor (no rules changes): seeded mulberry32 RNG stored in `GameState.rng`, deterministic instance ids, removed `Date.now`/`Math.random` from core; card instances now store only `cardCode` (definitions via `cardDef()`); split `executeAction` into a typed per-action handler table under `engine/actions/` with `IllegalActionError`/`NotImplementedError`; added `getLegalActions`/`isLegalAction` and a `src/core/index.ts` barrel; UI shows the seed and accepts `?seed=`; added determinism, legal-action and engine-purity tests; `tests/` now typechecked. |
| **2026-10-21** | Claude | Rules-bug fixes: turn/run enforcement on every action; install restrictions + MU limit; agendas unrezzable; ice rez only while approached (Corp rez button in `RunOverlay`); new `SCORE_AGENDA` action replaces auto-score, advance limited to agendas and "You can advance this" cards; breach collects candidates first (fixes skipped cards) and accesses HQ/R&D/Archives; Runner can't draw from an empty Stack; Corp mandatory draw on turn 1; Advance/Score/Rez buttons in `ServerColumn` driven by `isLegalAction`; 18 regression tests in `tests/rulesFixes.test.ts`. |
| **2026-10-21** | Claude | Player-choice prompts: `GameState.pendingPrompts` queue + `RESOLVE_PROMPT` action (only legal action while a prompt is pending); mulligan at setup (Corp first turn and its mandatory draw start after both decide; clicks start at 0); END_TURN requires all clicks spent and prompts a discard when over hand size; breach is now a resumable `accessQueue` with a pay-to-trash prompt for cards with a trash cost (not in Archives); `getLegalActions` enumerates prompt answers; new `PromptPanel` UI and disabled End Turn buttons; `tests/prompts.test.ts` (66 tests total). |
| **2026-10-22** | Claude | Keyword glossary tooltips: `src/ui/glossary.ts` holds short plain-language rules definitions (from the NSG Comprehensive Rules v26.03) for ~60 terms (tags, net/meat/core damage, advance, rez, access, breach, trash cost, subroutines, virus counters, load/empty, persistent, etc.). `annotateKeywords` underlines the first mention of each term in card text; `KeywordTooltip` (mounted in `main.tsx`) shows the definition when hovering any `[data-kw]` element, and `<Keyword id>` marks UI labels (credits, clicks, MU, tags, core damage, piles, hand size, counter badges, run phase, card stats). The hover popout can't be hovered itself, so it lists the less obvious terms on the card below the rules text; the zoom modal has full hover tooltips. `tests/glossary.test.ts`. |
| **2026-10-22** | Claude | Hard AI tuning: the search keeps the rule-based AI's favourite move unless another candidate does better on the same re-dealt games by at least 1 point on average and 1.5 standard errors (paired comparison). Measured over 16 AI-vs-AI games per side across all 9 decks at 1 s per move: Hard Corp beat Normal Runner 10/16 (Normal Corp: 6/16); Hard Runner beat Normal Corp 14/16 (Normal Runner: 10/16). |
| **2026-10-22** | Claude | Hard AI (Roadmap M8 route 2): `SearchAI` in `src/ai/search.ts`. For main-phase moves and the Corp's rez choices it takes the rule-based AI's best few candidates (`rankMainActions`), re-deals what its side can't see (`determinize`: the Runner guesses unrezzed cards it hasn't accessed, HQ, R&D and face-down Archives, keeping ice in ice slots and advanceable cards under counters; the Corp guesses the Grip and Stack), plays each candidate forward through the opponent's next turn with the rule-based AI on both sides (`GameRunner` in `src/ai/playout.ts`, shared with `playAIGame`), and keeps the best average. 1.5 s per move. The AI now runs in a Web Worker (`src/ai/worker.ts`, `AIClient` in `src/ai/client.ts`). Deck picker Difficulty (Normal / Hard, localStorage `netrunner.difficulty`), `&difficulty=hard` URL parameter, header badge shows (HARD). `getLegalActions` skips candidates that cheap checks rule out (about 40% faster), checked by `tests/legalActionsComplete.test.ts`. Tests: `tests/search.test.ts`. |
| **2026-10-22** | Claude | Deck picker: Random deck button beside New deck for the Corp and the Runner. It picks from `randomDeckPool` in `src/data/decks.ts` (legal decks of that side, official samples and custom decks, never the starters) and avoids the deck already selected (`pickRandomDeck`). Tests in `tests/decks.test.ts`. |
| **2026-10-22** | Claude | Card popout and zoom: the line under the title is now the printed type line (`Upgrade`, `Ice: Barrier`) plus the faction in its colour. It used to show the subtypes, or the faction in capitals for the 14 cards with no subtypes (e.g. Manegarm Skunkworks showed "HAAS BIOROID"). Faction labels/colours moved to `src/ui/cardLabels.ts` (shared with the deckbuilder). |
| **2026-10-22** | Claude | Draggable, minimizable pop-ups: new `src/ui/components/FloatingPanel.tsx` (drag by the header, kept on screen, position remembered per panel for the session; the minimize button collapses it to a pulsing bar with a Show button). Used by `PromptPanel` (mulligan, discard, effect choices, access/trash), `RunOverlay` (with the encounter panel) and `GameOverModal` (Look at the final board now minimizes it; the banner's Show result restores it). The prompt no longer dims or blocks the board. A new prompt opens expanded. |
| **2026-10-22** | Claude | Game-over box (`src/ui/components/GameOverModal.tsx`) over the board when a side wins: winner ("You win" / "You lose" against the AI), reason, final score, and Play again (same decks, new seed), Back to deck selection, or Look at the final board. The banner above the board stays, with a Show result button to bring the box back. |
| **2026-10-22** | Claude | The NETRUNNER // PROTOCOL logo in the game header goes back to deck selection (same as the new-game button). Both ask before abandoning a game in progress, and leaving clears `?seed=` from the URL so a reload doesn't restart the old deal. |
| **2026-10-22** | Claude | Roadmap M8 (basic AI): `src/ai/` with a shared `Agent` interface, `HeuristicCorpAI` and `HeuristicRunnerAI`. Both score every legal action: board evaluation after simulating the action (`evaluate.ts`: credits, clicks, hand, installed cards, icebreaker coverage, score), plus rules for runs (`runs.ts`: server value from public information, ice cost from break plans or subroutine costs, jack out when ice is too expensive), Corp installs (ice where it's needed, agendas only behind ice, econ assets in their own remote), advancing and rez windows. The Runner remembers cards it has accessed and avoids known traps. Prompts are answered by simulating each answer (`prompts.ts`). `playAIGame` runs AI vs AI with the same Corp rez windows as pass and play. Deck picker Opponent choice (stored in localStorage `netrunner.opponent`), `?ai=corp|runner` URL parameter, AI moves on its own after a short pause, header badge, view choice of My view / Open table. Tests: `tests/ai.test.ts` (each Corp deck plays a full AI vs AI game to a winner). In 16 tuning games the Runner won 10 and the Corp 6. |
| **2026-10-22** | Claude | Widescreen layout: the log moved to a side bar (xl and up), and the two boards face each other in the middle. The Corp shows stats, actions, then servers with the HQ hand beside them; the Runner shows rig with the Grip beside it, then actions and stats. Hands fan with overlapping cards on wide screens; the rig puts Hardware and Resources side by side under Programs. Normal size uses smaller hand cards, so a game fits on a 1920x1080 screen. |
| **2026-10-22** | Claude | Table-like board: server roots lay assets/agendas and upgrades side by side (servers in a wrapping row that grows to fit); centrals show their own card first (HQ: Corp identity, R&D: deck with count, Archives: discard pile, click to browse) via `Pile.tsx`; the rig is three rows (programs, hardware, resources) with the Runner identity, Stack and Heap (click to browse) beside it. |
| **2026-10-22** | Claude | "Accessed this run" panel (`AccessedPanel` in App) shows every card the Runner accessed in the latest run; access log entries now carry the card code. Prompted by a Jailbreak run on HQ that accessed two ice with nothing to decide, which only showed in the log. |
| **2026-10-22** | Claude | Pass and play: after each hand-off the page scrolls to the incoming player's board (`#corp-board` / `#runner-board`). |
| **2026-10-22** | Claude | Server columns: root (assets, agendas, upgrades) on top on the Corp's side, ice below toward the Runner, innermost ice nearest the root and outermost at the bottom. |
| **2026-10-22** | Claude | Credits now use the official NSG credit symbol (NSG Visual Assets v1.5, CC BY-ND 4.0, paths unmodified, recoloured via `currentColor`) instead of the Coins icon, the 🪙 emoji and the "c" suffix: `src/ui/components/CreditIcon.tsx` (`CreditIcon`, `RecurringCreditIcon`, `Credits`, and HTML strings for card text). Used in the player stats, +1 Credit buttons, card popout/zoom (stats and `[credit]`/`[recurring-credit]` in text), hosted credit tokens, rez/boost/break/trash costs and ability costs. Attribution on the deck picker and in README. |
| **2026-10-22** | Claude | Fix: every action scrolled the page down to the log (`LogFeed` used `scrollIntoView`); it now scrolls only the log box. |
| **2026-10-22** | Claude | Installed ice is drawn sideways in its server column, as on the table (`ServerColumn`); the hover popout and run overlay still show it upright. |
| **2026-10-22** | Claude | Card hover popout shows the whole card image, uncropped, beside the details (was a cropped art strip that showed the text box on cards with art at the bottom, e.g. Karunā). |
| **2026-10-22** | Claude | Roadmap M7 (UI): `src/ui/viewer.ts` (Viewer/ViewMode, `actingSide`, `corpRezWindow`), `HandoffScreen`, `ZoneViewer`, `src/ui/sound.ts` (Web Audio, picks one sound per action from new log lines), `CorpInstallOptions` in App, flip wrapper in `CardView` (framer-motion), `EncounterPanel` read-only mode, viewer-aware `RunOverlay`/`PromptPanel`. The Runner's basic draw no longer names the drawn cards in the log. Old M8 split into M8 AI, M9 Multiplayer, M10 Desktop. Tests: `tests/viewer.test.ts`. |
| **2026-10-22** | Claude | Faction decks swapped for NSG's official "System Gateway-only" sample lists (Discretion Advised, Advanced Yomi, Hyper Velocity, Quick and Dirty, Party Hard, Stolen Goods, Planning Ahead; https://nullsignal.games/players/getting-started-sample-decklists/). Deckbuilder (`src/ui/components/DeckBuilder.tsx`): New deck / Copy / Edit / Delete on the picker, card pool with search and type/faction filters, live size, influence, agenda points and `validateDeck` problems. Custom decks save to localStorage (`src/data/customDecks.ts`); an illegal deck can be saved but not started. Tests: `tests/customDecks.test.ts`. |
| **2026-10-22** | Claude | Roadmap M6: `src/data/decks.ts` (official starter lists from the NSG System Gateway product page; since replaced by NSG sample lists), `src/core/deckValidation.ts`, `DeckPicker` start screen, App split into picker + `Game`. The old placeholder decks moved to `src/data/sampleDecks.ts` (tests only). `tests/decks.test.ts` validates every deck and plays each Corp deck in a random playout. |
| **2026-10-22** | Claude | Roadmap M4: `dealDamage` (net/meat/core) and `flatline` in `engine/damage.ts`; core damage lowers max hand size and flatlines below 0 at the Runner's discard step; `REMOVE_TAG`, `TRASH_RESOURCE`, `PURGE_VIRUS` basic actions. Scripted Urtica Cipher, Clearinghouse, Orbital Superiority, Neurospike, Public Trail, Retribution: every Gateway card is now scripted. UI: tag and core damage counters, Remove Tag, Purge and Trash-resource buttons. `tests/tagsDamage.test.ts`. |
| **2026-10-22** | Claude | Roadmap M3: `engine/triggers.ts` (active cards, `fireTrigger`) and `engine/cardEffects.ts` (turn flags, counters, hosted credits, `spendCredits`, derived hand size/MU, trash/derez/remove from game, console and unique limits); `USE_ABILITY` action; `startRun` with run options; breach extra accesses; access prompt with mid-access alternatives (Carnivore); "when accessed" hook; hosting via `INSTALL_CARD.hostInstanceId`. Scripted 37 cards in `scripts/corpCards.ts`, `scripts/runnerCards.ts` and `scripts/events.ts`. UI: `AbilityBar`, ability buttons in the encounter panel, counter badges, install-on-ice buttons, access-ability buttons. `tests/abilities.test.ts` and a random-playout stress test (`tests/playout.test.ts`). |
| **2026-10-22** | Claude | Roadmap M2: `EncounterState` on `RunState`; `BREAK_SUBROUTINE` (subroutine indices), `BOOST_BREAKER`, `BIOROID_BREAK`; `IceScript`/`BreakerScript` on card scripts; `engine/ice.ts`, `engine/damage.ts`, `engine/runEnd.ts`, `engine/actions/breaking.ts`; rez hook for ice rezzed mid-run (Ping); install cost modifiers (Carmen); jack out only after passing ice. Scripted 11 ice + 7 breakers. UI: `EncounterPanel` in the run overlay (subroutines, legal break/boost buttons, context-aware Continue label, Jack Out disabled when illegal). `tests/ice.test.ts` (124 tests total). |
| **2026-10-21** | Claude | Roadmap M1: `PLAY_OPERATION_OR_EVENT` basic action (click + cost, card to Archives/heap face up, then effect); `src/core/scripts/` card-script registry (`canPlay`/`onPlay`/`onPromptAnswer`) with generic `effect_choice`/`effect_cards` prompts; `runsThisTurn` and `CardInstance.installedTurn` tracking; `drawCards` helper; `installRunnerCardFrom` for installs from effects. Scripted 11 cards (see roadmap above). UI: Play button for selected operations/events (disabled with "not implemented" for unscripted cards), effect prompts in `PromptPanel`. `tests/operationsEvents.test.ts` (92 tests total). |
| **2026-10-22** | Claude | Visual clarity: `ServerColumn` takes the active `run` (replaces unused `isRunTarget`) and highlights the target server, the current ice and the root by run phase (CSS pulses in `index.css`, off with prefers-reduced-motion). New `src/ui/components/HandRow.tsx` renders HQ and the Grip with framer-motion `AnimatePresence` (enter, layout, exit; exit drops if the card is now in the heap/Archives, lifts otherwise). |
| **2026-10-22** | Claude | Card fates: `src/ui/cardFates.ts` (`cardFates(prev, next)`: stolen, scored, and trashed = installed or accessed-from-HQ/R&D cards now in Archives/heap; hand discards excluded) and `CardFates.tsx` overlay, driven by a `gameState` effect in App so AI moves show too. `PromptPanel` caps discard/effect_cards selection at the max and marks hand cards `notInstalled`. Tests: `tests/cardFates.test.ts`. |
| **2026-10-22** | Claude | Elevation card data: `Resources/Cards/Elevation/elevation-cards.json` holds the 82 Elevation cards (pack `elev`, codes 35001–35082, 34 Runner / 48 Corp), in the same format as the Gateway JSON (NetrunnerDB card fields, sorted keys, `faction_cost` 0 when absent). New `scripts/download-elevation.mjs` (copy of the Gateway script) fetches the JSON and card images into `Resources/Cards/Elevation/images/`. Data only: no card scripts, nothing imported by the game yet. |
| **2026-10-22** | Claude | Elevation in the card pool: `src/data/elevation-cards.json` merged into `ALL_CARDS` (`src/core/cards.ts`, plus `CARD_SETS`); images copied to `public/cards/`; DeckBuilder gets a Set filter and a "Not scripted yet" badge on Elevation cards whose abilities are not implemented; test sample decks stay on System Gateway (`pack_code === 'sg'`). |
| **2026-10-22** | Claude | Elevation cards scripted (all 82): `src/core/scripts/elevationRunner.ts` (34) and `elevationCorp.ts` (48). New engine mechanics: flippable identities, faceup installs, cards hosted on cards (Bling, Madani), recurring and restricted credits (`creditSources`, payment purposes), power/agenda counters and Dividends, threat level, persistent effects, Shred, run redirects, access-only pseudo-runs (Detente), a turn-end stage machine (`turnStep`: action phase ends, discard phase ends, hand-over), and many new trigger events (`approach_ice`, `encounter_ice`, `card_accessed`, `credits_gained`, `hq_trashed`, ...). Tests: `tests/elevationRunner.test.ts`, `tests/elevationCorp.test.ts`; 108 random playouts across all official SG + Elevation deck pairings run clean. |
| **2026-10-22** | Claude | Elevation decks, UI and AI. `src/data/decks.ts`: the 21 "NSG Core Sets (System Gateway + Elevation)" sample decks (`core-*` ids, source `official sample`, new `credit` field = `CORE_SETS_CREDIT`, shown on the deck card). UI: hosted cards render under their host in `RigView` with Play/Install buttons (`hostedCardActions` in App); Faceup/Flipped badges and power/agenda counters in `CardView`; BANGUN faceup installs labelled; N-Pot's credit break labelled; the rez window (`corpRezWindow`, key now includes the server) also offers Corp run abilities (LEO, Proprionegation) via `RunOverlay.rezAbilities` and shows the current rez cost (`rezCostOf`). AI: "any number of cards" prompts answered greedily and `getLegalActions` lists at most 256 answers per card prompt (Next Big Thing made games crawl); Hantu boosts with virus counters, N-Pot paid breaks, Semak-samun fracter-only, Elevation subroutine costs, Elevation asset/upgrade values, LEO/Proprionegation used when the Runner reaches a server that matters. |
| **2026-10-22** | Claude | AI with Elevation cards, after a 216-game Normal-vs-Normal batch over every SG + Elevation pairing showed 13 cards never used: the Runner AI now follows its own prompts when scoring a main action (Lie Low, Scrounge), values Clean Getaway (+6 on success) and Shred (gets past one "end the run") in `runScore`, and values Cacophony, Bling, Detente, Open Market and Side Hustle; the Corp AI rezzes Phật Gioan Baotixita, Idiosyncresis (at 2+ counters), Plutus, Mahkota, Mercia and Mitra Aman, plays Nanomanagement / Touch-ups when they let an agenda be scored this turn, and plays Top-Down Solutions with installable cards in HQ. Rerun: every Elevation card gets used, no errors, all games finish. |
| **2026-10-23** | Claude | Cyberpunk UI restyle (no layout or logic changes): theme tokens in `src/index.css` (neutral/corp/runner/signal scales, chamfer sizes, scanline opacity, glow), Tailwind palettes mapped onto them, near-square `borderRadius`, `.chamfer`/`.hud-frame`/`.glitch-title`/`.terminal-text` helpers, framed buttons get clipped corners with inset focus rings, Share Tech Mono body font. Scanlines and glow switch off under `prefers-contrast: more`; the log cursor stops under reduced motion. |
| **2026-10-23** | Claude | Hoverable card names in the log: `LogFeed` matches printed card titles (accented and plain spellings, longest first, not inside other words) and shows the existing `CardPopout` on hover or keyboard focus. `tests/logCardNames.test.ts`. |
| **2026-10-23** | Claude | Card-name hover moved into a shared `CardNameText` component and added to `PromptPanel` (prompt message and effect-choice buttons, e.g. MuslihaT). |
| **2026-10-23** | Claude | Deck import (`src/data/deckImport.ts`, `ImportDeckModal`, "Import from NetrunnerDB" on the deck picker): parses NetrunnerDB plain-text exports and their Markdown/BBCode copies, OCTGN .o8d files and "3 Sure Gamble" lists; a NetrunnerDB decklist or shared-deck link is fetched from the public API (CORS allowed), and codes outside our pool are looked up by title so reprints still match. Titles match ignoring case, accents and quote style. Missing cards are listed and left out; a missing identity falls back to the side's first identity with a note. Shows `validateDeck` problems, then saves as a custom deck or opens it in the deckbuilder. Tests: `tests/deckImport.test.ts` (round-trips every built-in deck). |
| **2026-10-23** | Claude | Corp AI protects its remotes (Jeff's playtest feedback). `src/ai/corpAI.ts`: agendas are installed only behind ice that is rezzed or affordable to rez (`guards()`), never in a naked remote unless they can be scored at once or HQ is over the hand limit; agendas are advanced over several turns only while guarded; installs, advances and other spending that would drop the Corp below the credits needed to rez one piece of ice in front of an agenda remote are penalised (`rezReserve()` / `reservePenalty()`). Naked economy assets and bluff/trap installs stay on purpose. Normal-vs-Normal batches: Corp wins 38% → 42% (216 games, SG + Elevation decks) and 22% → 33% (40 games, SG decks). Also: the engine deletes `faceUp`/`installedTurn` instead of setting them to undefined, so a saved and reloaded game serialises identically. |
| **2026-10-23** | Claude | Repo prepared for going public: removed all bundled card images (`Resources/Cards/*/images`, `public/cards`), the NSG card backs and the rules PDF. Card images now load from NetrunnerDB (`getCardImageUrl` in `src/data/cards.ts`; a text placeholder shows if one fails); card backs are our own SVGs in `public/card-backs/`; the download scripts only fetch card data; local file paths removed from the docs; README credits. |
| **2026-10-23** | Claude | Runner stat bar MU icon is now the official NSG MU (chip) symbol (`NSG_Mu.svg`, NSG Visual Assets v1.5, CC BY-ND 4.0, path unmodified) via `MuIcon` in `src/ui/components/CreditIcon.tsx`, replacing the Zap icon. README credit updated. |
| **2026-10-23** | Claude | The MU symbol also replaces the "MU" text in card text (`[mu]`, via `MU_ICON_HTML`) and the memory cost stat in the card popout and zoom view. |
| **2026-10-23** | Claude | Scanlines moved behind the app (`body::before`, z-index -1) so card art and buttons stay sharp. Games against the computer now start in My view instead of Open table (Open table is still in the menu); two-player games keep the last mode used. |
| **2026-10-23** | Claude | Single-screen table (Jeff's request, inspired by jinteki.net): the game fills exactly the window from 1280x720 to 1080p, no page scroll (below 1024px wide it still scrolls). Board cards size from the window height (`--card-w`/`--card-h` in `src/index.css`, CardView sizes `fit`/`fit-sm`); Normal/Large/Huge set `--card-scale`. The Corp half takes the spare height; the Runner rig is two rows (Programs, then Hardware + Resources) with identity/Stack/Heap beside it. Ice lies sideways under each server, Rez/Advance/Score sit over the card, hands fan beside each half, stats are compact strips. Side bar: `ZoomPanel` (hovering a table card shows it full size; a small store so hover doesn't re-render the board; modals keep the floating popout), the acting side's actions and card abilities, then the log. Added `wrangler.jsonc` (static assets from `dist/`, SPA fallback, empty `previews` block) so Cloudflare branch previews deploy. |
| **2026-10-23** | Claude | Themed dialogs replace every browser `alert`/`confirm` (illegal-action errors, leave game, forfeit, delete deck): `src/ui/components/Dialog.tsx` (`showAlert`, `showConfirm` returning promises; `DialogHost` mounted in `main.tsx`). Escape or a click outside cancels, focus stays in the dialog and starts on Cancel for destructive confirms. |
| **2026-10-24** | Claude | Play formats (`src/core/formats.ts`): Casual (any card, the default), Startup (SG + Elevation + Vantage Point, Startup Balance Update 26.05 a.k.a. NSG's 26.04, max 4 agendas worth 3+ points) and Standard (SG, Elevation, Ashes, Borealis, Liberation, Vantage Point; Standard Balance Update 26.08). `DeckList.format` / `DeckSpec.format`; `validateDeck` adds card-pool, ban-list (by title, so all printings), restricted-card and extra-rule problems. Deckbuilder has a Format picker and BANNED / NOT LEGAL badges; the picker tags decks with their format. To update after a rotation or new list, edit `FORMATS` (`node scripts/print-banlist.mjs` prints NetrunnerDB's latest lists as titles). Tests: `tests/formats.test.ts`. |
| **2026-10-24** | Claude | Deckbuilder ban markers: cards banned or restricted in any format get a BAN / RES marker (hover lists the formats) in the card pool and deck list, and a "Banned or restricted" panel in the right column lists the deck's flagged cards and their formats (`formatStatuses` / `describeFormatStatuses` in `src/core/formats.ts`). |
| **2026-10-25** | Claude | Bug fixes from the code health audit: crash screen (`ErrorBoundary` in `main.tsx`; "Start over" clears the saved game) and `SAVE_VERSION` in `src/ui/savedGame.ts` (bump it when GameState changes shape; saves with another version are dropped); an AI that errors, finds no move or picks an illegal one now opens a "Computer stuck" dialog (Try again / Computer concedes) instead of hanging on AI THINKING; `handleAction` applies moves to the latest state, so forfeiting after the confirm dialog no longer undoes AI moves made while it was open; the Runner's Install Card button is disabled with the engine's reason when the install is illegal; card-fate timers are cleared when a game is left; favicon (`public/favicon.svg`, was a 404). Card data: one `scripts/sync-cards.mjs` (`npm run sync-cards`) now writes `src/data/*.json` in the committed format for both sets; the old download scripts and the duplicate `Resources/` copies are removed. |
| **2026-10-25** | Claude | Speed (audit P1–P6). Legality answers are cached per state object (`isLegalAction` and `getLegalActions` keep a WeakMap; game states must never be edited after they are made, so tests change a `structuredClone` copy). `executeAction` no longer deep-copies the log: the new state gets a new array of the same entries, which `addLog` freezes. App reuses the servers and rig (`useMemo` on the game state and viewer; their buttons call `handleAction`, which reads the latest state), `HandRow`, `LogFeed` and each log line are memoized, and keyword-annotated card text is cached. The board sections, header and card badges lost their `backdrop-blur` (the blur repainted the whole board on every change and was invisible over the dark panels; modals keep theirs). DeckBuilder and ImportDeckModal load on first use. Unused Google Font weights dropped (Fira Code, Orbitron 500). Measured in headless Chromium on a turn-12 save: selecting a card 160–180 ms → 65–80 ms click-to-paint, JavaScript per selection 27–31 ms → 9 ms. |
