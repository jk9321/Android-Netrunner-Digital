/**
 * Summarizes JSONL output from scripts/runner-rework/facts-log.ts into L1-L12 tables.
 *
 * Usage:
 *   node scripts/runner-rework/facts-log-sum.mjs <file1.jsonl> [file2.jsonl ...]
 */
import { readFileSync } from 'node:fs';

const files = process.argv.slice(2);
if (files.length === 0) {
  console.error('Usage: node scripts/runner-rework/facts-log-sum.mjs <file.jsonl> ...');
  process.exit(1);
}

const rows = [];
for (const f of files) {
  for (const line of readFileSync(f, 'utf8').split('\n')) {
    const t = line.trim();
    if (!t || !t.startsWith('{')) continue;
    const o = JSON.parse(t);
    if (o.kind === 'board') rows.push(o);
  }
}

const pools = [...new Set(rows.map(r => r.pool))];
const fmt = (diff, met) => {
  if (met < 10) return `${diff} / ${met} (not shown: <10 met)`;
  return `${diff} / ${met} (${((100 * diff) / met).toFixed(1)}%)`;
};

for (const pool of pools) {
  const pr = rows.filter(r => r.pool === pool);
  const games = new Set(pr.map(r => r.id)).size;
  const meanMs = pr.reduce((n, r) => n + r.ms, 0) / Math.max(1, pr.length);

  const sum = k => pr.reduce((n, r) => n + (r.metrics[k] ?? 0), 0);
  const l3Met = {};
  const l3Diff = {};
  const l10Styles = {};
  const unexplained = [];

  for (const r of pr) {
    for (const [k, v] of Object.entries(r.metrics.l3Met ?? {})) l3Met[k] = (l3Met[k] ?? 0) + v;
    for (const [k, v] of Object.entries(r.metrics.l3Diff ?? {})) l3Diff[k] = (l3Diff[k] ?? 0) + v;
    for (const [k, v] of Object.entries(r.metrics.l10Styles ?? {})) l10Styles[k] = (l10Styles[k] ?? 0) + v;
    for (const u of r.metrics.l9Unexplained ?? []) {
      unexplained.push({ id: r.id, turn: r.turn, ...u });
    }
  }

  console.log(`\n=== Pool: ${pool} (${pr.length} boards across ${games} games; mean ${meanMs.toFixed(2)} ms/board) ===`);
  console.log(`  L1  (subroutine ends run, 5 encodings):        ${fmt(sum('l1Diff'), sum('l1Met'))}`);
  console.log(`  L2  (subroutine damage encodings):             ${fmt(sum('l2Diff'), sum('l2Met'))}`);
  console.log(`  L3  (the 7 cross-side cards):                  met=${JSON.stringify(l3Met)} diff=${JSON.stringify(l3Diff)}`);
  console.log(`  L4  ("or end the run" vs walk):                ${fmt(sum('l4Diff'), sum('l4Met'))}`);
  console.log(`  L5  (unrezzed ice — same view / runnerKnows):  ${fmt(sum('l5SameViewDiff'), sum('l5SameViewMet'))}`);
  console.log(`  L5  (unrezzed ice — hidden / by construction): ${fmt(sum('l5HiddenDiff'), sum('l5HiddenMet'))}`);
  console.log(`  L6  (Runner money — no grip money):            ${fmt(sum('l6EmptyGripDiff'), sum('l6EmptyGripMet'))}`);
  console.log(`  L6  (Runner money — with grip money):          ${fmt(sum('l6WithGripDiff'), sum('l6WithGripMet'))}`);
  console.log(`  L7  (run-begin / run-paid cards):              ${fmt(sum('l7Diff'), sum('l7Met'))}`);
  console.log(`  L8  (rig bypasses):                            ${fmt(sum('l8Diff'), sum('l8Met'))}`);
  const l9Servers = sum('l9Servers');
  const l9Agree = sum('l9Agree');
  console.log(
    `  L9  (feasibility vs serverHold):               agree=${l9Agree}/${l9Servers} (${((100 * l9Agree) / Math.max(1, l9Servers)).toFixed(1)}%), disagree=${l9Servers - l9Agree} | policy: unrezzed=${sum('l9PolicyUnrezzed')}, rezChoice=${sum('l9PolicyRezChoice')}, money=${sum('l9PolicyMoney')} | unexplained=${unexplained.length}`
  );
  if (unexplained.length > 0) {
    console.log(`      L9 unexplained examples (first 5):`, unexplained.slice(0, 5));
  }
  console.log(`  L10 (turnFlags once-per-turn styles):          ${JSON.stringify(l10Styles)}`);
  console.log(`  L12 (Mycoweb derezzed lender):                 ${fmt(sum('l12Diff'), sum('l12Met'))}`);
}
