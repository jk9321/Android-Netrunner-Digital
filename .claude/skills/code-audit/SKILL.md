---
name: code-audit
description: Read-only code audit of the Netrunner repo, either focused on one area or new feature (a new card set, a multiplayer chunk, an AI refactor item, a branch before merge) or a full codebase audit against tech-debt sprawl and vibe-coding drift. Produces a severity-ranked findings report compared against the previous audit, saved to /mnt/project-files/audits/. Use when asked to audit, review the codebase health, or check a big feature before it merges to beta or main.
---

# Code audit

An audit **only reports**. It changes no code, runs no AI batches and pushes nothing. Fixes go to separate
threads afterwards (see "Hand-off"). The value of an audit is that every finding is true, located, and
comparable with the last audit, so the rules below are about evidence as much as coverage.

## 1. Pick the mode and scope

- **Focused** (mode a): one area or one new feature. Typical triggers: a new card set before its balance step,
  a multiplayer chunk before the MP coordinator's review, an AI refactor item before it merges to beta, any
  branch Jeff will test. Scope = the diff plus everything it touches:
  `git diff --stat origin/beta...origin/<branch>` (or the commit range Jeff names), then the callers and tests
  of each changed function. Use the matching section(s) of [checklists.md](checklists.md).
- **Full** (mode b): the whole codebase on `beta` (it holds everything `main` has plus new work), plus the
  main-only checks run on `main`. Cadence that worked: after every 2-3 AI merges to beta, before beta merges to
  main, and before a new set's balance step. Use every section of [checklists.md](checklists.md). For a full
  audit you may split the areas across up to 5 read-only Explore agents (engine/rules, AI, UI + multiplayer
  views, data/decks/formats, tests/tooling); give each its checklist section and the evidence rules below, and
  verify every finding they return yourself before it goes in the report. An agent's claim is a lead, not a
  finding.

State the mode, branch and commit SHA at the top of the report. Audit a fixed SHA, not a moving branch.

## 2. Gather the baseline (before reading code)

1. Find the previous audit of the same scope: `ls /mnt/project-files/audits/` and read its `findings.json`
   (the index in `/mnt/project-files/audits/README.md` lists older audits that predate this skill, as Claude
   Docs: read the ones covering your scope). A focused audit compares with the last audit of that area AND the
   last full audit's findings in that area.
2. Take a metrics snapshot on the audited checkout (read-only):
   `node .claude/skills/code-audit/metrics.mjs snapshot --out <audit dir>/metrics.json`
   then diff it with the previous one: `node .claude/skills/code-audit/metrics.mjs diff <old> <new>`.
   It reports sizes per area, largest files and functions, escape hatches (any, ts-ignore, eslint-disable,
   empty catch, TODO), card codes named in generic code, plan switches (defined-never-read, folded-still-read,
   read only once), beta-only imports outside the build flags, skipped tests. Numbers are signals to look at,
   not findings by themselves.
3. Read `CLAUDE.md`, `PROJECT_STATUS.md` and the project memory notes for the area (decisions Jeff already
   made are not findings: "Hard Runner AI knows its draw order" is kept on purpose; rules windows 6.9.1e,
   5.6.3b, 5.7.2b are skipped on purpose). A decision recorded in memory but contradicted by code IS a finding.
4. Run the checks: `npm run typecheck`, `npm run lint`, and `npx vitest run --reporter=json --outputFile=<scratchpad>/vitest.json`
   (gives per-test durations for the slow-test check). Report failures as findings; don't fix them.

## 3. Audit

Work through the checklist sections for the scope. For each candidate finding, open the code and confirm it.
The recurring failure modes this repo has shown, in order of how often past audits found them:

1. **Whack-a-mole special cases**: a symptom fixed in several layers, or a card/situation hard-coded in a
   shared file instead of a general rule or the card's own entry (AI: rule ranking -> planner leaf ->
   overrides; engine: `if (code === '3xxxx')` outside `src/core/scripts/`).
2. **Parallel implementations**: the same quantity computed two to four ways (Corp rez money was counted 4
   ways; Runner income on the slide 4 ways). Name every copy with file:line and say which one should win.
3. **Dead or stale paths**: switches whose off path is identical to on, measured constants older than the
   code they measure, comments describing history instead of the code.
4. **Rules drift**: behaviour that doesn't match the comprehensive rules, or a rules change with no rule cited.
5. **Hidden information leaks**: anything that tells a player (or the Normal AI) what they shouldn't know.

## 4. Evidence rules (non-negotiable)

- Every finding cites `path:line` (or `path:start-end`) at the audited SHA. No location, no finding.
- Every rules finding quotes the rule number and its text from
  `/mnt/project-files/Netrunner/Resources/Rulebook/Null_Signal_Games_Netrunner_Comprehensive_Rules_v26.03.pdf`
  (read the PDF; don't cite from memory). Card wording comes from `src/data/*-cards.json` (`stripped_text`), plus
  errata if NetrunnerDB lists one.
- Card codes: every code in the report must resolve to the card you mean. Past audit sources (Gemini
  especially) invented codes. Before saving, run
  `node .claude/skills/code-audit/metrics.mjs verify <audit dir>/report.md`: it checks every `path:line` exists
  and prints each card code with its real title. Fix the report until it passes and every title matches.
- Claims about behaviour ("the AI never X", "this is slow") need a reproduction: a test name, a scenario, a
  log line, or a measured number. Mark anything you could not reproduce as **Unverified** and keep it out of
  the severity ranking.
- Say what you did not check. A quiet area is not a clean area.

## 5. Write the report

Use [report-template.md](report-template.md) exactly: the severity scale, finding fields and stable IDs are
what make audits comparable. Then compare with the previous audit: each old finding is **Fixed** (cite the
commit), **Recurring** (still there; say if it grew), **Regressed** (was fixed, came back) or **Won't fix**
(Jeff decided; cite where). New findings are **New**. A recurring finding keeps its old ID.

Save to `/mnt/project-files/audits/<YYYY-MM-DD>-<scope>/` (scope: `full`, `set-<name>`, `mp-<chunk>`,
`ai-<item>`, `branch-<name>`):
- `report.md`: the report.
- `findings.json`: `[{ "id", "severity", "status", "title", "locations": ["path:line"], "area", "owner" }]`.
- `metrics.json`: the snapshot.
Then add one line to `/mnt/project-files/audits/README.md` (date, scope, SHA, counts by severity, link).
`/mnt/project-files` is a network mount: re-read each file about ten seconds after writing it. If the Claude
Docs connector is available, also publish the report as a Claude Doc for Jeff to read and comment on, and put
its link in README.md; the files stay the record the next audit diffs against.

## 6. Hand-off (the audit fixes nothing)

End with a ranked fix list grouped by owner, and leave the choice to Jeff:
- AI findings (`src/ai/**`, batch scripts, tuning) go to the AI Coordinator thread
  (cmsg_013UNycUZbB5MfsLyJaSoKuFXFsEuAUtY2nrWo1i7JaYu1), which specs them for ai-* branch threads.
- Multiplayer findings (`src/core/view.ts`, per-player UI, game server) go to the multiplayer coordinator thread
  (cmsg_013UNycUZbB5MfsLyJaSoKuFQk1KQTbDgtk6sasrNiPj64).
- Rules bugs go to the "Fix rules bugs from playtesting" thread pattern: quote the rule, fix, test.
- Everything else: ask the project coordinator for a fix thread per group.
Recommend guards for anything that keeps recurring (an entry in `tests/codeHealth.test.ts` on beta, a lint
rule, a hook) so the next audit doesn't find it again. Don't add them in the audit thread.
