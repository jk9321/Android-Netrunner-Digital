# Draft Spec: Generic Run and Turn Flags, `CardModifiers`, Prompt Metadata, and `executeAction` Context

**Status:** Branch `gemini-run-turn-flags-spec` (cut fresh from `origin/beta` @ `8efbf4f`). Design doc only — no code edits. Checks: `npm run typecheck` passed, `npm run lint` passed (0 errors), targeted vitest passed.

**Goal:** Before the next card set lands, move card-specific fields on `RunState`, `EncounterState`, `GameState`/`CorpState`/`RunnerState`, and `CardScript` to typed, keyed generic storage so a new card adds a typed key rather than a new field that ripples through `state.ts`, `view.ts` (3 places), `reconstruct.ts`, and saved fixtures. Also covers the "Archives into R&D" prompt metadata (`src/ai/prompts.ts`) and the `executeAction` execution context (engine module globals), which share this pre-set engine step.

---

## 1. Inventory Table (grep-backed against `origin/beta` @ `8efbf4f`)

### 1.1 Existing Generic Flag Infrastructure

| Container | Location | Helper / Key Enum | Reset Point | `view.ts` / `reconstruct.ts` |
| --- | --- | --- | --- | --- |
| `GameState.turnFlags` | `src/core/types/state.ts:428` | `TurnFlag` (20 keys), `turnFlag`, `bumpTurnFlag`, `useOncePerTurn` (`cardEffects.ts:21-52, 108-122`) | Turn handover (`actions/turn.ts:105`: `state.turnFlags = {}`) | Redacted via `flagKeys()` (`view.ts:311, 514-522, 756`); shallow copy (`reconstruct.ts:226`) |
| `RunState.runFlags` | `src/core/types/state.ts:270` | `RunFlag` (4 keys: `encounters`, `subsBroken`, `iceDerezzed`, `breachFired`), `runFlag`, `bumpRunFlag` (`cardEffects.ts:57-78`) | Run end (`runEnd.ts:26`: `state.activeRun = null`) | Redacted via `flagKeys()` (`view.ts:429, 839`); pass-through (`reconstruct.ts:115`) |
| `EncounterState.flags` | `src/core/types/state.ts:176` | Direct string keys | Encounter end (`ice.ts:273, 295`: `run.encounter = null`) | Redacted via `flagKeys()` (`view.ts:449, 795`); shallow copy (`reconstruct.ts:110`) |
| `CardScript.modifiers` | `src/core/scripts/types.ts:305` | `CardModifiers` (15 typed modifier hooks) | Static (card script) | Not serialized in state/view |

### 1.2 Card-Specific Fields on `RunState` (`src/core/types/state.ts:185-275`)

| Field | TS Type | Card(s) | Writers (file:line) | Readers (file:line) | `view.ts` / `reconstruct.ts` | `src/ai/**` | Resets | Fixtures |
| --- | --- | --- | --- | --- | --- | --- | --- | ---: |
| `shredArmed` | `boolean` | `35005` Shred | `actions/run.ts:36,71`; `elevation/runner/events.ts:102`; `runEnd.ts:69` | `runEnd.ts:68`; `tests/liberationRunner.test.ts:191,197`; `scripts/stage-d/run-answers.ts:282` | Public (`view.ts:229,416,826`); pass-through | No | Consumed on first `endTheRun` or run end | 28 |
| `redirectToHq` | `boolean` | `35016` Maintenance Access | `actions/run.ts:38,72`; `elevation/runner/events.ts:165`; `ice.ts:368` | `ice.ts:365` | Public (`view.ts:230,417,827`); pass-through | No | Consumed on `approachServer` or run end | 28 |
| `bakerRedirect` | `boolean?` | `36015` Baker | `actions/run.ts:44,82`; `vantage/runner/programs.ts:103`; `ice.ts:357` | `ice.ts:355,362` (invokes `onWouldApproachServer`) | Public (`view.ts:241,428,838`); pass-through | No | Consumed on `approachServer` or run end | 28 |
| `cannotStealOrTrash` | `boolean` | `30038` Ansel 1.0, `36031` Vertigo | `actions/run.ts:58`; `scripts/ice.ts:265`; `vantage/corp/ice.ts:145` | `actions/run.ts:488-496,541,573`; `vantage/runner/programs.ts:7,67`; `tests/ice.test.ts:362`; `tests/vantageCorp.test.ts:385` | Public (`view.ts:214,401,809`); pass-through | No (AI uses sub-kind string `'cannotStealOrTrash'`, not `RunState`) | Run end | 28 |
| `protectedTitles` | `string[]?` | `36035` Perfect Recall | `actions/run.ts:80`; `vantage/corp/upgrades.ts:23` | `actions/run.ts:491`; `tests/vantageCorp.test.ts:712` | Public (`view.ts:425,835`); pass-through | **Yes** (`src/ai/corp/rez.ts:304`) | Run end | 28 |
| `poolLocked` | `boolean?` | `36018` Aircheck | `actions/run.ts:42,79`; `vantage/runner/events.ts:164` | `cardEffects.ts:235,332`; `ui/liveValues.ts:25,54-61,85`; `ui/components/SideStrip.tsx:184`; `ui/components/RunOverlay.tsx:161-181`; tests (`reviewPins`, `liveValues`, `holdWalk`) | Public (`view.ts:424,834`); pass-through | **Yes** (`corp/hold.ts:513,1228,1724`; `cards/vantagePoint.ts:163`; `runs.ts:1187,1421`) | Run end | 28 |
| `creditHosts` | `string[]?` | `36018` Aircheck, `34019` Debbie, `34087` Trick Shot | `actions/run.ts:40,78`; `vantage/runner/events.ts:164`; `liberation/runner/resources.ts:106`; `liberation/runner/events.ts:525,533` | `cardEffects.ts:200,286`; tests (`holdWalk`, `liberationRunner`) | Redacted (`refs()`, `view.ts:423,833`); pass-through | No | Run end | 28 |
| `trashCreditHosts` | `string[]?` | `34030` Bahia Bands | `liberation/runner/events.ts:166` | `cardEffects.ts:217` | Redacted (`refs()`, `view.ts:435,845`); pass-through | No | Run end | 0 |
| `iceStrengthBonus` | `number?` | `34111` Tributary, `36039` ezaM | `actions/run.ts:81`; `liberation/corp/ice.ts:589`; `vantage/corp/ice.ts:199` | `ice.ts:74`; tests (`liberationCorp`, `plannerFastIdentity`) | Public (`view.ts:426,836`); pass-through | No | Run end | 28 |
| `notDeclaredSuccessful` | `boolean?` | `36064` Flagship | `actions/run.ts:214` | `tests/vantageCorp.test.ts:765` (never read in `src/`) | Public (`view.ts:427,837`); pass-through | No | Run end | 0 |
| `breachInstead` | `'hq'\|'rd'\|'archives'\|'none'?` | `34088` Cataloguer, `34007` Eru, `34028` Beatriz, `34068` Privileged Access, `34085` Burner | `liberation/runner/{hardware:324, resources:28,134, events:267,439}` | `actions/run.ts:233,234,356`; `liberation/runner/hardware.ts:337` | Public (`view.ts:432,842`); pass-through | No | Run end | 0 |
| `accessOnlyIds` | `string[]?` | `34046` Adrian Seis | `liberation/corp/upgrades.ts:76` | `actions/run.ts:347`; `tests/liberationCorp.test.ts:367` | Redacted (`refs()`, `view.ts:433,843`); pass-through | No | Run end | 0 |
| `noAccessIds` | `string[]?` | `34046` Adrian Seis | `liberation/corp/upgrades.ts:73` | `actions/run.ts:348` | Redacted (`refs()`, `view.ts:434,844`); pass-through | No | Run end | 0 |
| `iceRezCostIncrease` | `number` | `30012` Tread Lightly | `actions/run.ts:31,64`; `scripts/events.ts:148` | `cardEffects.ts:388`; tests (`reviewPins`, `rezKeepToll`) | Public (`view.ts:408,816`); pass-through | No | Run end | 28 |
| `bonusCredits` | `number` | `30029` Overclock | `actions/run.ts:32,65`; `scripts/events.ts:173`; `cardEffects.ts:302` | `cardEffects.ts:230,301`; `ui/liveValues.ts:45,47`; tests | Public (`view.ts:409,817`); pass-through | **Yes** (`corp/hold.ts:1229,1758`; `runs.ts:1172,1335,1421,1456`; `cards/*.ts`) | Run end | 28 |
| `subroutineResolved` | `boolean` | `35001` Ryō "Phoenix" Ōno, Vantage event | `actions/run.ts:68`; `ice.ts:252` | `elevation/runner/identities.ts:32`; `vantage/runner/events.ts:85`; `tests/elevationRunner.test.ts:57` | Public (`view.ts:412,820`); pass-through | No | Run end | 28 |
| `stoleAgenda` | `boolean` | `30060` AMAZE Amusements | `actions/run.ts:63,686` | `runEnd.ts:45` → `corpCards.ts:428` | Public (`view.ts:407,815`); pass-through | No | Run end | 28 |
| `cannotJackOut` | `boolean` | **None (dead/unused)** | `actions/run.ts:54` (init `false` only) | Never read in `src/` (`tests/runPricing.test.ts:77` literal) | Public (`view.ts:397,805`); pass-through | No | Run end | 28 |
| `iceGains` | `Record<string, {cardCode,index}[]>?` | Starlit Knight, `34096` Thunderbolt Armaments | `ice.ts:107-108` | `ice.ts:86` | Redacted (`refKeys()`, `view.ts:430,840`); pass-through | **Yes** (`cards/liberation.ts:344`) | Run end | 1 |
| `iceRunStrength` | `Record<string, number>?` | `34104` Brasília Gov Grid, `34096` Thunderbolt Armaments | `liberation/corp/{upgrades:188-189, identities:139-140}` | `ice.ts:73`; `tests/plannerFastIdentity.test.ts:192` | Redacted (`refKeys()`, `view.ts:431,841`); pass-through | No | Run end | 1 |
| `runBoosts` | `Record<string, number>` | GAMEDRAGON™ Pro | `actions/run.ts:74`; `ice.ts:172` | `ice.ts:159`; `tests/plannerFastIdentity.test.ts:204` | Redacted (`refKeys()`, `view.ts:419,829`); pass-through | Comment only (`hold.ts:596`) | Run end | 28 |
| `trashAtRunEnd` | `string[]` | Mayfly, Liberation ID | `actions/run.ts:59`; `scripts/breakers.ts:66`; `liberation/runner/identities.ts:37` | `runEnd.ts:19`; `tests/runAnswers.test.ts:894` | Redacted (`refs()`, `view.ts:402,810`); pass-through | No | Run end | 28 |
| `eventCode` | `string \| null` | All run events (read by S-Dobrado, UI) | `actions/run.ts:34,73` | `ui/liveValues.ts`; tests | Public (`view.ts:418,828`); pass-through | **Yes** (`runs.ts:796`) | Run end | 28 |

### 1.3 Card-Specific Fields on `EncounterState`, `CorpState`, `RunnerState`, `GameState`, `CardInstance`

| Field | Container & Type | Card(s) | Writers & Readers | `view.ts` / `reconstruct.ts` | `src/ai/**` | Resets | Fixtures |
| --- | --- | --- | --- | --- | --- | --- | ---: |
| `meliesServer` | `CorpState.meliesServer?: 'hq'\|'rd'\|'archives'` (`state.ts:88`) | `36036` Méliès U | W: `vantage/corp/identities.ts:21`; R: `:63`, `ui/components/SideStrip.tsx:234`, `tests/view.test.ts:156-163`, `tests/vantageCorp.test.ts:61,77` | **Own-until-flipped** (`view.ts:121,342,663` — stripped from Runner until `c.identity.flipped`); manual copy `reconstruct.ts:179` | No (`prompts.ts:518` only picks prompt option) | **Never** (game-scoped) | 1 (`report-27.json`) |
| `cannotEndRun` | `EncounterState.cannotEndRun?: boolean` (`state.ts:174`) | `34005` Banner | W: `liberation/runner/programs.ts:78,84`; R: `runEnd.ts:64` | Public (`view.ts:448,794`); manual copy `reconstruct.ts:109` | **Yes** (`runnerAI.ts:121`) | Encounter end | 0 |
| `bonusClicksNextTurn` | `CorpState` (`state.ts:83`), `RunnerState` (`state.ts:132`): `number?` | `35037` Aggressive Trendsetting, `36032` Caveat Emptor, Liberation op | W: `elevation/corp/agendas.ts:77,89`, `vantage/corp/operations.ts:34`, `liberation/corp/operations.ts:200`; R/reset: `actions/turn.ts:113-115, 135-137` | Public (`view.ts:341,366,661,682`); manual copy `reconstruct.ts:178,202` | **Yes** (`corp/lines.ts:78`) | Next turn start | 138 |
| `runnerLastTurnStoleOrTrashed` | `GameState` (`state.ts:412`): `boolean?` | `34055` Oppo Research, `34102` Active Policing, `34112` Bring Them Home | W: `actions/turn.ts:102`; R: `liberation/corp/operations.ts:27` | Public (`view.ts:308,755`); manual copy `reconstruct.ts:225` | No | Each Runner turn handover | 130 |
| `chosenSubtypes`, `cannotScoreTurn`, `scoredTurn`, `asAgendaPoints` | `CardInstance` (`types/card.ts`) | Lycian, A Teia / Warm Reception, Witch Hunt, Myōshu / Word on the Street | Engine & card scripts | Public/per-card (`view.ts:383-386`, `reconstruct.ts:56-59`) | `chosenSubtypes`: `corp/hold.ts:518,606` | Card leaves play | — |

### 1.4 Card-Specific Fields on `CardScript` / `IceScript` / `BreakerScript` (`src/core/scripts/types.ts`)

| Field | Container & Type | Card(s) | Readers (file:line) | `view.ts` / `src/ai` |
| --- | --- | --- | --- | --- |
| `agendasFaceUp` | `CardScript` (`types.ts:123`): `boolean?` | `35068` BANGUN (`elevation/corp/identities.ts:237`) | `actions/install.ts:246` | No / No |
| `limitsAccessToOne` | `CardScript` (`types.ts:165`): `boolean?` | `36064` Flagship (`vantage/corp/upgrades.ts:111`) | `actions/run.ts:263` | No / No |
| `blocksSuccess` | `CardScript` (`types.ts:163`): `boolean?` | `36064` Flagship (`vantage/corp/upgrades.ts:110`) | `actions/run.ts:253` | No / No |
| `installFaceUpOnly` | `CardScript` (`types.ts:143`): `boolean?` | `36056` Sacrifice Zone Expansion (`vantage/corp/agendas.ts:99`) | `triggers.ts:30-31`, `actions/install.ts:245,313`, `legalActions.ts:94` | No / No |
| `onWouldApproachServer` | `CardScript` (`types.ts:81`): `(ctx) => boolean?` | `36015` Baker (`vantage/runner/programs.ts:106`) | `ice.ts:355,362` | No / No |
| `maxRemotes` | `CardScript`: `number?` | A Teia | `actions/install.ts:283` | No / No |
| `trashGripCost` | `CardScript`: `number?` | Daniela | `actions/run.ts:505,516`, `actions/prompt.ts:148` | No / No |
| `revealedOnRdAccess` | `CardScript`: `boolean?` | 3 ambush assets (Byte!, Behold!, Esca) | `actions/run.ts:468` | No / No |
| `runnerCannotTrash` | `CardScript`: `boolean?` | Kessleroid | `elevation/runner/events.ts:30` | No / No |
| `hostedPlayable` / `hostedFaceDown` | `CardScript`: `boolean?` | Bling / Read-Write Share | `actions/install.ts:377` / UI (`RigView.tsx:34`, `MobileCardSheet.tsx:342`) | No / No |
| `grantsIceSubtypes` | `CardScript` | Chromatophores | `ice.ts:24` | No / **Yes** (`corp/hold.ts:544`) |
| `fracterOnly` / `runnerBreakCost` / `clickBreak` | `IceScript` | Semak-samun / N-Pot / Ansel 2.0 | `ice.ts:46`, `breaking.ts:122,125`, `legalActions.ts:190`, UI | No / **Yes** (`runnerBreakCost`, `clickBreak`) |
| `breakCounter` / `boostDiscard` | `BreakerScript` | Audrey v2 | `breaking.ts:71,92` | No / No |

### 1.5 "Archives into R&D" Prompt Field & `executeAction` Module Globals

- **"Archives into R&D" prompt heuristic (`src/ai/prompts.ts:431-436`, `:779-783`):** `shufflesArchivesIntoRD(state, prompt)` guesses intent from `prompt.source.step === 'shuffle'` plus checking that all `candidateIds` are in Archives. Eight cards use `step: 'shuffle'` (`Longevity Serum`, `Spin Doctor`, `Descent`, `Sleipnir`, `Sprint`, `Next Big Thing`, `KPI`, `Touch-ups`). Meanwhile `EffectSource.data` (`src/core/types/prompts.ts:59`) already carries typed `{ install: true, cardId }` propagated through `view.ts:711-715` and `reconstruct.ts:73`.
- **`executeAction` mutable module globals (`src/core/engine/`):**
  1. `closedIntent: GameAction | null` (`src/core/engine/gameEngine.ts:156`, set at `:161`, read/cleared at `:103-109`).
  2. `rdShuffleProbe` (`src/core/engine/rdKnowledge.ts:30`, toggled by `trialRun()` in `gameEngine.ts:278-285`, read in `rdKnowledge.ts:40-42,55`, `tests/engineFuzz.test.ts:162-166`, `scripts/engine-fuzz-check.ts:252-256,384,399-400`).
  3. `watch` (`src/core/engine/uncommitted.ts:22`, set/cleared in `uncommittedChoice()` `:63-72`, read in `effectResolving()`/`:30-36`, `effectResolved()`/`:39-42`).

---

## 2. Proposed Shape (Typed Keys, Reset Points, Visibility)

### 2.1 `RunFlag` (numeric/boolean run-scoped flags on `RunState.runFlags`)

Extend `RunFlag` (`src/core/engine/cardEffects.ts:57`) with typed `as const` keys and a `RunFlagKey` union type. Keep `RunState.runFlags: Partial<Record<RunFlagKey, number>>` (plus existing dynamic `inst-N` keys redacted by `flagKeys()`):

| Migrated Field | New Key in `RunFlag` | Value Type | Visibility (`view.ts`) | Reset Point |
| --- | --- | --- | --- | --- |
| `shredArmed` | `RunFlag.shredArmed` | `0 \| 1` | Public (both players) | Consumed on first `endTheRun` or run end |
| `redirectToHq` | `RunFlag.redirectToHq` | `0 \| 1` | Public (both players) | Consumed on `approachServer` or run end |
| `bakerRedirect` | `RunFlag.bakerRedirect` | `0 \| 1` | Public (both players) | Consumed on `approachServer` or run end |
| `cannotStealOrTrash` | `RunFlag.cannotStealOrTrash` | `0 \| 1` | Public (both players) | Run end |
| `poolLocked` | `RunFlag.poolLocked` | `0 \| 1` | Public (both players) | Run end |
| `iceStrengthBonus` | `RunFlag.iceStrengthBonus` | `number` | Public (both players) | Run end |
| `iceRezCostIncrease` | `RunFlag.iceRezCostIncrease` | `number` | Public (both players) | Run end |
| `subroutineResolved` | `RunFlag.subroutineResolved` | `0 \| 1` | Public (both players) | Run end |
| `stoleAgenda` | `RunFlag.stoleAgenda` | `0 \| 1` | Public (both players) | Run end |
| `notDeclaredSuccessful` | `RunFlag.notDeclaredSuccessful` | `0 \| 1` | Public (both players) | Run end |
| `cannotJackOut` | *(delete — unused dead field)* | — | — | — |

**Kept as first-class typed fields on `RunState`** (structural/non-numeric or heavily indexed by core & AI, not single-card booleans):
- `bonusCredits` (numeric credit pool read by `availableCredits`, UI, and AI), `eventCode`, `breachInstead` (shared by 5 cards), `creditHosts` / `trashCreditHosts` / `accessOnlyIds` / `noAccessIds` / `trashAtRunEnd` (instance-ID lists redacted via `refs()`), `iceGains` / `iceRunStrength` / `runBoosts` (instance-ID maps redacted via `refKeys()`), `protectedTitles` (string list).

### 2.2 `EncounterFlag` (typed keys on `EncounterState.flags`)

Add `export const EncounterFlag = { cannotEndRun: 'cannotEndRun' } as const;` with helper `encounterFlag(state, key)` / `setEncounterFlag(state, key, n)`.
- Migrates `EncounterState.cannotEndRun` → `EncounterFlag.cannotEndRun` (`0 | 1`, public, resets at encounter end).

### 2.3 Game-Scoped Secret / Persistent State (`meliesServer`)

`meliesServer` is **not** run-scoped or turn-scoped — it is **game-scoped secret Corp state** (hidden from Runner until `corp.identity.flipped`). It does **not** fit `TurnFlag` or `RunFlag`.
- **Proposed shape:** One typed keyed map on `CorpState` (or `GameState`):
  ```ts
  export interface CorpSecretMap {
    meliesServer?: 'hq' | 'rd' | 'archives';
  }
  ```
  stored as `CorpState.secrets?: CorpSecretMap` (with a visibility predicate per key in `view.ts`, e.g. `meliesServer` visible to Corp always and to Runner once `corp.identity.flipped`). Future secret-choice cards add a typed key to `CorpSecretMap` + one visibility entry, without adding a new top-level `CorpState` field.
- **Note on `bonusClicksNextTurn` and `runnerLastTurnStoleOrTrashed`:** Both span across a turn boundary (written on turn N, read on turn N+1, then reset). They do **not** fit `TurnFlag` (which clears on handover). Keep them as explicit fields (or group into a typed `NextTurnCarry` / `LastTurnSummary` object if more cross-turn fields appear).

### 2.4 `CardModifiers` (`src/core/scripts/types.ts:305`)

Move static boolean/numeric rule modifiers off top-level `CardScript` onto `CardModifiers`:
- `agendasFaceUp?: boolean` → `CardModifiers.agendasFaceUp` (BANGUN; read in `actions/install.ts:246`)
- `installFaceUpOnly?: boolean` → `CardModifiers.installFaceUpOnly` (Sacrifice Zone Expansion; read in `triggers.ts`, `install.ts`, `legalActions.ts`)
- `limitsAccessToOne?: boolean` → `CardModifiers.limitsAccessToOne` (Flagship; read in `actions/run.ts:263`)
- `blocksSuccess?: boolean` → `CardModifiers.blocksSuccess` (Flagship; read in `actions/run.ts:253`)
- `maxRemotes?: number` → `CardModifiers.maxRemotes` (A Teia; read in `actions/install.ts:283`)
- `trashGripCost?: number` → `CardModifiers.trashGripCost` (Daniela; read in `actions/run.ts`, `actions/prompt.ts`)

*(Keep `onWouldApproachServer` as a hook on `CardScript` alongside `triggers` — it is a lifecycle callback, not a static modifier.)*

### 2.5 Typed Prompt Intent (`EffectSource.data`)

Replace `shufflesArchivesIntoRD`'s string-matching heuristic (`src/ai/prompts.ts:779-783`) with a typed field on `EffectSource.data` (`src/core/types/prompts.ts:59`):
```ts
shufflesTo?: 'rd' | 'stack';
shufflesFrom?: 'archives' | 'hq' | 'hq_or_archives' | 'runner';
```
Set by `Longevity Serum` and `Spin Doctor` (`shufflesTo: 'rd', shufflesFrom: 'archives'`), exposed on `MyPromptView` alongside `installs`/`installCardId` (`view.ts:711-715`, `reconstruct.ts:73`).

### 2.6 `executeAction` Execution Context (Engine Globals)

Introduce an optional internal `ExecContext` parameter threaded through `executeAction(prevState, action, execCtx?)`:
```ts
export interface ExecContext {
  closedIntent?: GameAction | null;
  trial?: boolean;
  rdShuffleProbe?: { shuffles: number; corpSeenSince: Set<string> };
  watch?: { depth: number; promptsBefore?: number; before?: string; after?: string } | null;
}
```
Replaces module globals `closedIntent` (`gameEngine.ts:156`), `rdShuffleProbe` (`rdKnowledge.ts:30`), and `watch` (`uncommitted.ts:22`). External callers keep the existing 2-arg `executeAction(state, action)` signature (defaulting to a fresh per-call `ExecContext`).

---

## 3. Migration Order (Play-Identical Steps & Branch Routing)

Each step is small, self-contained, and play-identical. **FULL review tier** (engine resolution).

| Step | Scope | Touches `src/ai`? | Branch / Review | Proving Tests |
| --- | --- | :---: | --- | --- |
| **Step 1** | **CardScript → `CardModifiers`** (`agendasFaceUp`, `installFaceUpOnly`, `limitsAccessToOne`, `blocksSuccess`, `maxRemotes`, `trashGripCost`). Zero state/view/fixture impact. | No | Engine branch (FULL review) | Full vitest suite + `tests/engineFuzz.test.ts` + `tests/plannerFastIdentity.test.ts` |
| **Step 2** | **Delete dead `RunState.cannotJackOut`** + migrate **engine-only `RunState` booleans/numbers** (`shredArmed`, `redirectToHq`, `bakerRedirect`, `cannotStealOrTrash`, `iceStrengthBonus`, `iceRezCostIncrease`, `subroutineResolved`, `stoleAgenda`, `notDeclaredSuccessful`) to `RunFlag` with a read-compat shim for old fixtures (`runFlag(s, k) \|\| legacyField`). | No | Engine branch (FULL review) + Multiplayer review of `view.ts` | Full vitest suite + `tests/view.test.ts` + `tests/engineFuzz.test.ts` + g1 identical check |
| **Step 3** | **Migrate `poolLocked` (`RunState` → `RunFlag.poolLocked`) & `EncounterState.cannotEndRun` (`EncounterFlag.cannotEndRun`).** | **Yes** (`hold.ts`, `runs.ts`, `vantagePoint.ts`, `runnerAI.ts`) | **`ai-*` branch + AI Coordinator** (FULL review) | Full vitest suite + `tests/holdWalk.test.ts` + `tests/engineFuzz.test.ts` + g1 identical check |
| **Step 4** | **`CorpState.secrets` (`meliesServer`)** + visibility rule in `view.ts` / `reconstruct.ts` + UI `SideStrip.tsx`. | No | Engine branch + Multiplayer review (`view.ts`) | `tests/view.test.ts`, `tests/vantageCorp.test.ts`, full suite + `engineFuzz` |
| **Step 5** | **Typed prompt metadata (`shufflesFrom` / `shufflesTo`)** on `EffectSource.data`, `view.ts`, `reconstruct.ts`; then switch `shufflesArchivesIntoRD` in `src/ai/prompts.ts`. | **Yes** (`src/ai/prompts.ts`) | Engine part first, then **`ai-*` branch + AI Coordinator** for `prompts.ts` | Full suite + `tests/steps.test.ts` + `tests/view.test.ts` + g1 identical check |
| **Step 6** | **`executeAction` `ExecContext`** replacing `closedIntent`, `rdShuffleProbe`, `watch`. | No | Engine branch (FULL review) | Full suite + `tests/engineFuzz.test.ts` + `tests/uncommitted*.test.ts` + `engine-fuzz-deep` |

---

## 4. Risks and Open Questions

1. **Saved games and test fixtures:**
   - `tests/fixtures/**` has **28 JSON fixtures** with an active `RunState` containing `shredArmed`, `redirectToHq`, `bakerRedirect`, `cannotStealOrTrash`, `poolLocked`, `iceStrengthBonus`, `iceRezCostIncrease`, `subroutineResolved`, `stoleAgenda`, `cannotJackOut`; **138 fixtures** with `bonusClicksNextTurn`; **130 fixtures** with `runnerLastTurnStoleOrTrashed`; and **1 fixture** (`report-27.json`) with `meliesServer`.
   - `src/ui/savedGame.ts` serializes raw `GameState` to `localStorage` (`SAVE_VERSION = 2`).
   - **Mitigation:** Either keep a lightweight read-compat shim (or one-time `migrateState()` on load in `savedGame.ts` and fixture loader) OR bump `SAVE_VERSION` to `3` and migrate the 28 active-run fixtures in the same PR. Do not silently drop old fields while fixtures still deserialize them.
2. **Multiplayer views (`src/core/view.ts` & `src/core/view/reconstruct.ts`):**
   - `view.ts` enforces `*_FIELDS satisfies Record<keyof ..., Vis>` — every removed/added field must be updated in the `*View` interface, `*_FIELDS`, and builder together.
   - `flagKeys()` in `view.ts:514-522` strips keys containing an unrevealed `inst-N`; plain string `RunFlag` keys without `inst-` pass through as public. Any future secret flag on `RunFlag` or `TurnFlag` must NOT use the public `runFlags`/`turnFlags` map unless `flagKeys()` gets an explicit visibility map!
   - `meliesServer` (`CorpState.secrets`) MUST remain stripped from the Runner's view until `corp.identity.flipped` (guarded by `tests/view.test.ts:156-163`).
3. **`inst-N` instance numbering (`src/core/engine/gameState.ts`):**
   - Must not change. None of the proposed flag, modifier, prompt-data, or `ExecContext` refactors allocate card instances or alter `createInitialGameState` order; verify with `tests/engineFuzz.test.ts` and a g1 identical check.
4. **Open / unresolved items for review:**
   - Whether `RunState.runFlags` should remain `Record<string, number>` (storing booleans as `0 | 1`) or allow `number | boolean` (keeping `number` avoids changing `flagKeys` and `bumpRunFlag` signatures).
   - Whether `rdShuffleProbe` in `tests/engineFuzz.test.ts` / `scripts/engine-fuzz-check.ts` prefers passing an explicit `ExecContext` into `executeAction` or keeping a thin test-only hook on `ExecContext`.

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
