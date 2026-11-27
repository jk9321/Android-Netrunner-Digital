# AI process rules

Moved verbatim out of `CLAUDE.md` (2026-11-18) so threads that do not work on the AI skip them. Read this file first if you touch `src/ai`, review or red-team AI work, coordinate it, or launch an `ai-batch` or `ai-script` run. `CLAUDE.md` keeps the `src/ai` guard, the AI Coordinator review rule and the batch queue rules. The single AI status source is the plan page (`CLAUDE.md`, Hosting).

Rule ids (2026-11-26): every rule has an id heading. Cite the id (`RULE-ONE-OWNER`) in briefs, plans, skills, hand-offs and memory instead of copying the rule's text, and find it with one search (`grep -n RULE-ONE-OWNER docs/ai-process.md`). How ids work: `CLAUDE.md`, `RULE-CITE-IDS`.

| Id | Rule |
|---|---|
| `RULE-ONE-JOB-PER-THREAD` | One job per thread; fewer threads trial |
| `RULE-BATCH-WAITS` | When to check a batch or script run, queued or running |
| `RULE-POINT-AT-FILES` | Briefs and reports point at files |
| `RULE-MODELS` | Which model runs which thread; Fable for checkpoint audits and big plan drafts only; quota fallback |
| `RULE-CYCLE-COORDINATORS` | Fresh coordinators at stage boundaries |
| `RULE-ONE-TRACKER` | One AI tracker for open work |
| `RULE-SHARED-DOC-EDITOR` | One coordinator edits a shared file |
| `RULE-GEMINI-OFFERS` | Offer idle Gemini small own-branch tasks |
| `RULE-GOAL-WIN-RATE` | Goal is playing strength; Corp 50 ± 5% |
| `RULE-COUNTED-DECISIONS` | Fix a count's input first; a bonus only inside the owner |
| `RULE-ONE-OWNER` | One owner per quantity |
| `RULE-REPLACE-DONT-STACK` | Replace, don't stack; win rate reported only |
| `RULE-TUNING-LADDER` | Tuning ladder: trace top down, fix bottom up |
| `RULE-NUMBERS-SWITCHES` | No hand-picked numbers; switches are temporary |
| `RULE-PLAN-SWITCHES` | `tuning.plan` switches; folded names throw |
| `RULE-PER-CARD-DATA` | One AI entry per card |
| `RULE-HIDDEN-INFO` | Hard off; what Normal AIs may know |
| `RULE-AI-TIME` | Decision time budget |
| `RULE-JEFF-TEST-GAMES` | When to flag a merge as worth a test game |
| `RULE-CLAUDE-PLAYTESTS` | Claude playtests after merge groups |
| `RULE-PAIRED-BATCHES` | Batches on Actions, paired, logged |
| `RULE-BASELINES` | What a base is and when to re-run it |
| `RULE-MEASUREMENT-SCRIPTS` | `ai-script` runs and their check times |
| `RULE-SCRIPT-RULES` | How a measurement script plays and times games |
| `RULE-LAUNCH-CHECK` | One local minute before a launch; long legs on CI |
| `RULE-BATCH-SIZES` | games=1 for identical checks, g3 then g10 |
| `RULE-SLOT-GATE` | The slot gate and waiting runs |
| `RULE-BATCH-LOG-MARKERS` | Conflict markers in the batch log after a merge |
| `RULE-ENGINE-CHANGE-NOTICE` | Tell the AI Coordinator before an engine change |
| `RULE-BAR-BEFORE-BATCH` | Written bar before an experiment batch |
| `RULE-SPLIT-STRUCTURE` | A change mixing structure and new prices ships in two parts; a failed bar parks only what failed |
| `RULE-OVERRIDE-CHECK` | Fresh-thread yes/no on a borderline merge |
| `RULE-PIN-HOLES` | Pin human-usable holes |
| `RULE-HUMAN-FIXTURES` | Human-game fixtures |
| `RULE-REVIEW-CUTOFF` | Review depth by what a change can affect |
| `RULE-URGENT-FIX` | A fix for a stopped live game merges before its red team |
| `RULE-ADVERSARIAL` | Red team and exploit hunt |

Rules marked "from project memory (2026-11-26)" were Jeff's standing rules kept only in project memory until 2026-11-26; their text is moved here unchanged in meaning.

## AI work

### RULE-ONE-JOB-PER-THREAD: Thread economy (1), one job per thread
Thread economy (Jeff 2026-11-17, on trial, to save tokens). (1) One job per thread: each branch or brief gets its own build thread, which ends at its merge; the next branch starts in a fresh thread from a short hand-off file (what merged and its SHA, what is next, where the brief is), which the AI Coordinator asks the project coordinator for at the merge. Fewer threads (Jeff 2026-11-25, a trial to cut credit use; the coordinators note what it slows or makes worse, since Jeff asked whether it helps or hurts): red-team reviews stay separate threads, but a small count is folded into the build or count thread it feeds (one thread, the count first, the build only after the coordinator's ruling and the red team), and a build does its own measurement step instead of a new thread being started for it. Aim for about a third fewer threads (from project memory, 2026-11-26).

### RULE-BATCH-WAITS: Thread economy (2), batch waits
(2) Batch waits: the first check is scheduled at the run's expected finish, counted from when its shards start (g1 +15 min, g3 +30, g10 +55; an ai-script run +10), and not before; after that, every 10 minutes (every 5 for a script) until it is done. While a run is still queued (Jeff 2026-11-25: a check of a waiting run learns nothing and re-reads the whole thread): each scheduled check first looks whether the run's shards have started; if they have not, the next check is scheduled for when the runs ahead of it should finish, not at the fixed interval; once it is running, the times above apply. Never oversleep: a check is always scheduled when a run is launched, and a finished run is read and acted on in the turn that sees it, so no result sits for hours.

### RULE-POINT-AT-FILES: Thread economy (3), briefs and reports point at files
(3) Briefs and reports point at files instead of repeating them: a brief names the file and section, and a report is a few lines (outcome, SHA, run ids, what is needed) with the detail in a file.

### RULE-MODELS: Thread economy (4), models
(4) Models: Sonnet, sparingly, for mechanical threads that need little judgment (CI checks, batch polling and logging, a recount against a written list, a small contained fix); AI logic and rules work stay on Opus. No Haiku. The AI coordinators run on Opus at high effort (Jeff 2026-11-25). **Fable (Jeff 2026-11-27 04:45Z, narrowed because it used too much quota):** Fable does only two jobs, so that it stays in the process at the advisory and planning level: (a) the audit at each stage checkpoint, and (b) the first draft of each big stage plan (Runner side: R-C1, R-C2, R-D; Corp side: the Corp strength plan when it comes). For (b) the coordinator asks the project coordinator for a short, one-job "draft the plan" Fable thread, which reads the hand-off and the counts named, writes the draft, and finishes; the coordinator reviews it, a red team checks it (`RULE-ADVERSARIAL`), and the coordinator rules. Everything else is Opus: red teams and exploit hunts, plan and brief revisions (rev 1, rev 2 and on), briefs for fixes, and the short review a coordinator starts before a hard ruling. A request for a thread names its model. Fable quota fallback (Jeff 2026-11-26 05:26Z): if Fable usage runs out, start or roll every Fable thread on Opus instead and keep going until Opus quota is out too; then Jeff upgrades his subscription. History: Jeff 2026-11-25 gave Fable red teams, stage design briefs and hard-ruling reviews; Jeff 2026-11-26 23:58Z added drafting every plan and brief; both are replaced by the 2026-11-27 rule above.

### RULE-CYCLE-COORDINATORS: Cycle AI coordinators
From project memory (2026-11-26). Jeff 2026-11-24, Runner and Corp side: cycle the AI coordinators where it makes sense. A fresh coordinator starts at a stage boundary, or when the thread runs long, from one short current hand-off file; no long threads doing secretary work. A hand-off file is current, not a diary: replace lines rather than adding to them.

### RULE-ONE-TRACKER: One AI tracker
From project memory (2026-11-26). Jeff 2026-11-24 (sources of truth down to as few as possible): open AI work lives in ONE tracker, `/mnt/project-files/netrunner-ai/tracker.md`. Add a new item there once; name its id everywhere else. The Corp side's items are in its section "Corp side" (`F<n>` = found row n, `L-<n>` leads); a new Corp finding is a found row plus one tracker line.

### RULE-SHARED-DOC-EDITOR: One editor for a shared file
From project memory (2026-11-26). Jeff 2026-11-25: when a rule goes to both AI coordinators with a doc edit, name ONE of them to edit the shared file.

### RULE-GEMINI-OFFERS: Offer Gemini tasks
From project memory (2026-11-26). Jeff 2026-11-23: Jeff's Gemini is often idle. Offer, in one line and without being asked, small, no-merge, own-branch tasks (count scripts, repros, failing tests, draft specs) that are long and easy to check. Write the `HANDOFF.md` (like `docs/gemini-prep/HANDOFF.md`) only after Jeff says he will give the task to Gemini.

### RULE-GOAL-WIN-RATE: Goal and win rate
Goal is playing strength, not matching Jeff's moves. Corp win rate should sit around 50 ± 5%.

### RULE-COUNTED-DECISIONS: Counted decisions
Counted decisions (Jeff 2026-11-10; reworded by Jeff 2026-11-24): a decision made by counting (`plan.scoreNow`, `plan.scoreInTwo`, and the ones that follow) is fixed FIRST by changing an INPUT to its count (what holds a server, the Runner's capability, the reserve). A bonus or penalty term is never the first attempt. Where no input can carry the fix, a bonus may be the answer, on three conditions: the spec says which inputs were tried, or why none can carry it; the bonus lives inside the quantity's ONE owning function (the single place that quantity is computed, `docs/ai-priced-quantities.md`), never in a caller or a second file; and the registry row of that owner lists it as a term. A bonus goes through the same steps as any other change: it is counted on recorded games first, with the reading rule written before the numbers, and it passes adversarial review. After each counted decision ships, delete the value terms it made redundant, so the levers stay few and visible.

### RULE-ONE-OWNER: One owner per quantity
One owner per quantity (Jeff 2026-11-13, after the audit found rez money priced about seven ways): every quantity the AI prices or counts (rez money, what holds a server, agenda odds, a game end, a card in hand, ...) has ONE owning function, listed in `docs/ai-priced-quantities.md` with its known duplicates. A branch may not add a second computation of a listed quantity: read the owner, or change the owner. A new rule names in its spec which listed quantities it reads; a new quantity gets a row in the same branch. The duplicate counts in that file may only go down; the review checks the file against the diff, and every audit recounts it.

### RULE-REPLACE-DONT-STACK: Replace, don't stack
Replace, don't stack (same date): a branch that adds a counted rule names the value term or rule it replaces and deletes it in the same branch, or the hand-off says why it cannot yet and the review file records the debt. The Step 4 cleanup has landed (Stage C 2026-11-16, V-B 2026-11-17). Stage D (Jeff's go 2026-11-17) fixes known wrong behaviour, in the order on the plan page; it is not tuning. Win rate is reported only, with no gate or stop line on it (Jeff 2026-11-14, 11-16); crashes and rules errors are fixed at any time; his games stay pinned, as known-failing where the fix waits. No new Runner rules until a Runner audit has filled the Runner rows of the registry.

### RULE-TUNING-LADDER: Tuning ladder
Tuning ladder (Jeff 2026-11-15; applies to every Corp behaviour fix, balance change and tuning step once Stage C lands, and to the Runner once it has the same shape). The levers, broadest first: (1) the counted questions, which bypass everything below them (win now, score now, the scoring line and its money, rezzes, placement) and the shared counts they read (what holds a server, the money kept for rezzing, the Runner's capability, the pools); (2) the list of ordinary moves (`/mnt/project-files/netrunner-ai/audit-fixes/stage-c/order.md`, then `src/ai/corp/candidates.ts`): its order and each line's condition; (3) the planner's settings (how many moves it compares, how far it plays forward); (4) the valuation model's numbers; (5) per-card rules in `corp/cardRules.ts`. **Trace top down, fix bottom up.** Trace: start at the top and find the layer that produced the wrong move (did a counted question take the click; did the list offer or hide the move; did the planner see it; did the valuation pick it), and write the trace in the spec. Fix: in the layer the trace found, with the narrowest change that removes the cause for the whole class of position, not only the reported game: first correct an existing thing (a wrong count input, a line's condition, a number, the order), and only then add one. A fix stays on the layer the trace found. Moving it up to a broader lever (a counted question added, or a count bent, to override a mistake made lower down) or down to a narrower one (a per-card rule or a one-position exception for a general mistake, which is whack-a-mole) needs a written reason and the approval of both the AI Coordinator and Jeff before it is built. The spec or hand-off says, for each narrower fix passed over, why it does not remove the cause. Adding a counted question, a line, a condition clause, a per-card rule, or any NEW lever (a value term, weight, threshold, switch or override that fits none of the five) needs that written reason and the AI Coordinator's approval; a new counted question and a new lever also need Jeff's yes before they are built. The review rejects a branch without them. A per-card fix has its own order (Jeff 2026-11-15): first the card's facts in its `src/ai/cards/<set>.ts` entry (what it pays, gives or gains, which the counts read), then its worth there (formula, value, counters), and only last a per-card rule or prompt answer; a fix a second card would also need is not per-card: it is a family answer or a valuation fix. Growth is counted: every stage checkpoint and audit reports the number of counted questions, lines in the list, condition clauses per line, per-card rules, planner settings and hand-set valuation numbers, and the counts go up only with a recorded reason.

### RULE-NUMBERS-SWITCHES: Numbers and switches
Numbers and switches (Jeff 2026-11-24, replaces "no flat tuned numbers, no permanent switches"): no hand-picked numbers. Every number the AI uses is either worked out from the game state (a count, a card's printed value, a rate measured on recorded games with its source named) or declared as a learnable setting: named, kept in one place, given a placeholder value, and owned by the learned rounds, which set it. A placeholder is set once, from a written reason (where the value comes from), and is never adjusted for win rate before the learned rounds: there is no hand tuning pass (Jeff 2026-11-19). A new learnable setting says in its spec why the game state cannot give the number. A switch is temporary: it is fine while a change is being built or measured, and where it is declared it says when it is removed (the merge or the stage). No switch is permanent.

### RULE-PLAN-SWITCHES: Plan switches
Behaviour is controlled by switches in `tuning.plan`. Folded switch names THROW when passed in `PLAN_OFF` (see `src/ai/synergy.ts`).

### RULE-PER-CARD-DATA: Per-card AI data
Per-card AI data (synergy tags, values, profiles, effect formulas, counter worths) lives in ONE entry per card in `src/ai/cards/<set>.ts`, joined in `src/ai/cards/index.ts`. Prompt answers, break plans and run options stay in `prompts.ts` / `runs.ts`.

### RULE-HIDDEN-INFO: Difficulty and hidden information
From project memory (2026-11-26). Hard difficulty is OFF. Normal AIs never see their own draws or hidden cards (the Corp's unseen cards, the stack's order, the Runner's future draws); they may know both full deck lists.

### RULE-AI-TIME: Decision time
From project memory (2026-11-26). Small decision-time increases are OK for better play; egregious ones are not (Jeff 2026-11-08: "I don't want to make the corp too much slower if we can help it, but I also want it to be strong").

### RULE-JEFF-TEST-GAMES: Jeff's test games
From project memory (2026-11-26). Jeff 2026-11-24: he plays again only after a substantial change. Don't ask him after every merge; say clearly when a merge is worth a test game and what to look for.

### RULE-CLAUDE-PLAYTESTS: Claude playtests
From project memory (2026-11-26). Jeff 2026-11-12: Claude playtests against the AI after merge groups (occasional rounds after merges, with Jeff's standing OK). Notes and harness: `/mnt/project-files/netrunner-ai/playtests/`.

## Batches and measurement

### RULE-PAIRED-BATCHES: Batches on Actions
Batches run on GitHub Actions: `.github/workflows/ai-batch.yml` (ref = branch name or full 40-char SHA). Use paired batches: run the base first, then pass its run id as `base_run`; compare with `scripts/corp-losses-sum.mjs`. Log every batch with `scripts/batch-log.mjs`.

### RULE-BASELINES: Baselines
From project memory (2026-11-26). A base is keyed by the CONTENT of `src/ai`, `src/core` and `src/data`. Re-run the g1 base after every play-changing change on beta. A g3 pair needs a g3 base on its own tree, and a g10 pair needs a fresh g10 base. An "expect identical" g1 compares the `deals.json` turn records (`cr`, `sc`), not only the winners. Self-play shares value caches between the two AIs, so a head-to-head cell is read against a null cell of the same commit, never against a plain g1. The current bases are listed in project memory (MEMORY.md, AI, BASELINES).

### RULE-MEASUREMENT-SCRIPTS: Measurement scripts on Actions
Measurement scripts on Actions (Jeff 2026-11-15): slow local runs (side-by-side on recorded states, leave-one-out, fire counts) go on `.github/workflows/ai-script.yml` instead of a container: it runs `scripts/<script>.ts` on 16 runners x 4 processes, each with `SHARD=<k>/64`, `ARGS` and `OUT_DIR`; the `out` artifact holds every shard's stdout and files. The script splits its own work by SHARD and has a summing step. It shares the 20-job limit with batches: one at a time beside a batch, and schedule the check when you launch it. Check times: a run usually finishes in 7 to 30 minutes (much faster than the same script in a container), so first check at +10 minutes, then every 5 minutes until it is done; do not use the batch check times for it.

### RULE-SCRIPT-RULES: How a measurement script plays
From project memory (2026-11-26). Time is read against a control arm (a tree identical to beta, in the same run); continuations are played by `GameRunner` (`src/ai/playout.ts`), since a driver that only calls `chooseAction` skips the Corp's rez window; a script never asks or clears the tree that plays the source game.

### RULE-LAUNCH-CHECK: Before a launch, and long legs
From project memory (2026-11-26). Before any `ai-script` or `ai-batch` launch, run the exact script with the exact ARGS for one shard locally for about a minute, on the commit the run will use (every tree built, the first records written); this is a start-up check, not the count, and local runs are not used to get ahead of the queue (Jeff 2026-11-19). The cloud container can restart mid-thread and kill local runs: any leg over about 10 minutes goes on CI (`ai-script`); CI outputs land on branch `ai-batch-results` (`scripts/<run>.tar.gz`, `results/<run>.*`).

### RULE-BATCH-SIZES: Batch sizes
Batch sizes (Jeff 2026-11-07: the repo runs at most 20 Actions jobs at once, a full batch is ~600 runner-minutes): "expect identical" checks use `games=1` (any difference shows); win-rate tests start at `games=3` and top up to 10 (`game_from=3`, `add_run`) only when the result is within about 2 SE of the gate. Launch at most 2-3 batches at a time.

### RULE-SLOT-GATE: Slot gate
Slot gate (Jeff 2026-11-16; `.github/scripts/batch-slot.cjs`, the `slot` job of both workflows): a batch or script run waits, holding one job, until its 16 shards fit: beside the tail of the run before when nothing is building (all 20 jobs used), with 3 jobs kept free while a CI or Deploy run is queued or running; waiting runs go in order: a long run that has waited an hour in `slot` first, then short runs (a 1-game check, a script not labelled "over N minutes"), then oldest first (the hour step from 2026-11-27, after a g3 waited 2 hours behind ten newer short runs). A run waiting on an older copy of the gate is ordered by the old rule on both sides, so changing the order no longer locks two waiting runs (each gate reads the other run's `GATE_VERSION`; raise it with any new ordering rule). So a run may sit in `slot` before it starts: read the slot job's log for why, and count the check times from when the shards start. Where to start the workflow and the queue discipline: `CLAUDE.md`, AI work, "Batch queue" (`RULE-BATCH-QUEUE`). A waiting run is not free: it holds one of the 20 jobs until it starts, so nine waiting runs leave the running batch eleven runners for its sixteen shards.

### RULE-BATCH-LOG-MARKERS: Batch log after a merge
From project memory (2026-11-26). After merging beta, check `docs/ai-batch-log.md` for conflict markers.

### RULE-ENGINE-CHANGE-NOTICE: Engine changes that move self-play
From project memory (2026-11-26; standing request 2026-11-17). Before pushing an engine change to beta that could change self-play, message the AI Coordinator thread, so it can start a new batch base sooner.

### RULE-BAR-BEFORE-BATCH: Bar before the batch
Bar before the batch (Jeff 2026-11-12): before an experiment batch is launched, the spec (or a file in `/mnt/project-files/netrunner-ai/redesign/bars/`) states the expected behaviour change and what counts as pass, fail, borderline and stop, including the behaviour numbers (not only win rate). Every arm reports its local fire count (decisions changed per game) before it gets a batch; an arm that barely fires gets a note, not a batch.

### RULE-SPLIT-STRUCTURE: Structure and prices in separate parts
Structure and prices in separate parts (Jeff 2026-11-27 16:42-16:46Z, after F119): a change that both moves structure (a new field, a new owner, readers moved onto one statement) and sets new prices or new behaviour through it is built as two parts. The structure part goes in first and play identical: today's numbers translated into the new shape, shown by a g1 with deals.json identical (`RULE-BASELINES`) or a lockstep with 0 first differences. The pricing part is judged on its own count, with its own bar written before it (`RULE-BAR-BEFORE-BATCH`). This applies only to such mixed changes: a decision fix (a wrong move corrected, a count's input fixed) ships with real play changes and its own count, as before. The intent is judgment, not strictness: when a bar fails, park only the part that failed and keep the rest moving, and a coordinator who sees a rule leading to a silly result (parking whole work for the rule's sake) says so and asks, rather than following it. Example: F119's tag-use field (2026-11-27): its pricing half failed its bar, and the field went ahead as a play-identical translation.

### RULE-OVERRIDE-CHECK: Override check
Override check (Jeff 2026-11-12): a merge that goes ahead on a borderline or failed bar first gets a yes/no from a fresh thread that reads only the batch numbers, the bar and the diff. The AI Coordinator asks the project coordinator to start it and writes the reason for the override in the review file.

### RULE-PIN-HOLES: Pin human-usable holes
Self-play hides holes. Pin human-usable holes with scenario tests.

### RULE-HUMAN-FIXTURES: Human-game fixtures
Human-games fixtures: `tests/fixtures/human-games/report-N.json` (decode bug reports with `scripts/bug-report-state.mjs`); score with `npx vite-node scripts/human-agreement.ts`.

## Review cutoff (Jeff 2026-11-19, to save usage)

### RULE-REVIEW-CUTOFF: Review cutoff
- How much review a change gets depends on what it can affect, not on its size. The files in the diff decide the tier; when a diff spans tiers, the highest tier applies, and when in doubt, go up a tier.
  - **Full (red team on the spec + coordinator review with the `review` skill):** anything that can change an AI decision or a game rule: `src/ai/**` logic, AI card data in `src/ai/cards/**`, and engine resolution in `src/core/**` (turn and run flow, timing, triggers, shared card helpers). A two-line change here can still flip games.
  - **Single review, no red team:** an engine change that only touches one card's script or text (one card in `src/core/scripts/**` and its test). The rules PDF citation and the card's own test are still required.
  - **Light (CI plus the author's quick self-check; no red team, no `review` skill):** tests only, count and measurement scripts, UI, docs and workflow files. The coordinator that merges it checks only that the diff stays inside these paths and that CI passes on the merged SHA.
  - **None:** a step that was counted and parked with no change (nothing merges, or only its count note and results files are written). Its ruling and Jeff's decision are recorded as before.
- This cutoff decides per-change review only. It does not remove the stage checkpoint exploit hunt, the override check on a borderline bar, Jeff's yes for a new lever or counted question, the hand-off evidence, or the rule that nothing AI merges to beta without the AI Coordinator's sign-off (for the light tier, that sign-off is the path and CI check above).

### RULE-URGENT-FIX: Urgent fix before its red team
- A fix for a bug that stops a live game (a person's game cannot go on, such as "Computer stuck") may merge on the AI Coordinator's single review, without the red team first (Jeff 2026-11-27, decision card). Its red team (Opus) runs right after the merge, on the change as merged, and each serious finding is fixed next at the change's full tier. The review file names this rule. All other full-tier work keeps the red team before the build.

## Adversarial review (AI and Multiplayer)

### RULE-ADVERSARIAL: Adversarial review
Adversarial review (Jeff 2026-11-15; starts with the Stage C checkpoint). Two passes by a fresh thread that did not write or build the work, started by the project coordinator at the AI or Multiplayer Coordinator's request. (1) Red team on a spec or brief before it is built: "why will this fail, what does it break, what does it assume that is not true"; it reads the spec and the code, not the author's reasoning. (2) Exploit hunt at each stage checkpoint: an agent plays against the AI on purpose (or, for multiplayer, against the server) looking for repeatable exploits a person could use, and is given the list of known-failing pins so it reports new holes, not known ones. One round only: the adversary writes numbered findings to `/mnt/project-files/adversarial/<date>-<name>/findings.md`; the author or builder answers each in writing in the same file (fixed, with the commit; or disagreed, with the reason); open disputes go to the coordinator, who rules or takes them to Jeff. Jeff's checkpoint shows the findings, the fixes, and only the unresolved disputes. An exploit that is real becomes a scenario pin (known-failing if its fix waits for a later stage). The adversary changes no code, and its findings are leads until reproduced (a state, a test or a replay). Keep it light (Jeff): "nothing serious" is a valid result; each finding is marked serious (a repeatable exploit, or a flaw that would change what is built) or minor, and only serious ones need the builder's reply; the exploit hunter reads code and sets up positions and local games, and launches no batch of its own; a real exploit goes through the tuning ladder's trace and is fixed in its Stage D item, pinned meanwhile.
