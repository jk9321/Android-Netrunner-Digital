# Audit report template

Copy this structure into `report.md`. Keep the headings so audits can be compared.

```markdown
# Code audit: <scope> (<YYYY-MM-DD>)

Mode: focused | full · Branch: <branch> · Commit: <40-char SHA> · Previous audit: <dir or doc link>
Checks: typecheck <pass/fail> · lint <pass/fail> · tests <n passed / n failed, slowest Xs>

## Summary
Three to five sentences: overall health, the biggest risk, what changed since the last audit.
Counts: S1 n · S2 n · S3 n · S4 n · Fixed since last n · Recurring n · Regressed n

## Compared with the previous audit
| ID | Title | Then | Now | Evidence |
|----|-------|------|-----|----------|
| AI-REZMONEY | Corp rez money counted 4 ways | S2 | Fixed | beta abc1234 |

## Findings
### <ID> · S<n> · <New|Recurring|Regressed> · <short title>
- **Where:** `path:line`, `path:line` (every copy, for duplication)
- **What:** one or two sentences on the defect.
- **Evidence:** rule quote (number + text), card text, test name, repro steps or measured number.
- **Why it matters:** the concrete consequence (wrong ruling, leak, AI loses, slows CI, blocks next set).
- **Suggested fix:** the general fix, not a patch; name the owner (AI Coordinator / MP coordinator / rules / other).

## Unverified
Leads you could not confirm, with what would confirm them. Not ranked.

## Checked, clean
Checklist items you checked that had nothing to report.

## Not checked
What was out of scope or skipped, and why.

## Metrics
Short table from `metrics.mjs diff`: lines per area, functions over 150 lines, escape hatches, card codes in
generic files, plan switches. Note which numbers moved and why.

## Fix list
Ranked, grouped by owner thread. Recommended guards (codeHealth entries, lint rules, hooks) for recurring items.
```

## Severity

| Level | Meaning | Examples |
|-------|---------|----------|
| **S1 Critical** | Wrong game result, crash, data loss, hidden-info leak, secret exposed, or main ships something it must not | rule implemented backwards; log names a facedown card; test decks in the main build |
| **S2 High** | Wrong behaviour in real games or a structural problem that keeps producing bugs | missing rules window; same quantity priced 3 ways; cache key missing an input; card scripted wrong in a common case |
| **S3 Medium** | Tech debt that slows work or will cause bugs later | dead switch paths; a card code in a shared value file; slow test > 60 s; untested new module |
| **S4 Low** | Hygiene and notes | stale comment; doc drift; naming; small duplication |

Rank by consequence, not by effort. A finding's severity can change between audits (say so in the comparison).

## Finding IDs

`<AREA>-<SLUG>`, uppercase, stable across audits: `RULES-`, `CARD-`, `LEAK-`, `AI-`, `UI-`, `DATA-`, `TEST-`,
`DRIFT-`, `SEC-`, `MP-`. Example: `AI-INCOME-SLIDE`, `LEAK-CORP-REZ-WINDOW`, `CARD-34017-COST`. Reuse the old ID
for a recurring finding; never reuse an ID for a different problem.

## findings.json

```json
[
  {
    "id": "AI-INCOME-SLIDE",
    "severity": "S2",
    "status": "Recurring",
    "title": "Runner income on the slide computed 4 ways",
    "area": "ai",
    "locations": ["src/ai/valueModel.ts:326", "src/ai/runnerAI.ts:410"],
    "owner": "AI Coordinator",
    "firstSeen": "2026-11-05"
  }
]
```
