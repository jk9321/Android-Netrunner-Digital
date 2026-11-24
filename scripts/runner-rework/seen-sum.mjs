/**
 * ai-runner-seen: sums the JSON lines of scripts/runner-rework/seen.ts (files or directories of *.txt / *.jsonl).
 *   node scripts/runner-rework/seen-sum.mjs out/
 * Self-play (the 221 deals) and the human files (by kind; the Hard Runner's files apart, a replay check) are kept apart.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const files = [];
for (const a of process.argv.slice(2)) {
  if (statSync(a).isDirectory())
    for (const f of readdirSync(a, { recursive: true })) {
      if (/\.(jsonl|txt)$/.test(String(f))) files.push(join(a, String(f)));
    }
  else files.push(a);
}
const rows = [];
for (const f of files)
  for (const l of readFileSync(f, "utf8").split("\n")) {
    if (!l.startsWith("{")) continue;
    try {
      rows.push(JSON.parse(l));
    } catch {
      /* a cut line */
    }
  }
const of = (k) => rows.filter((r) => r.kind === k);
const inc = (o, k, n = 1) => (o[k] = (o[k] ?? 0) + n);
const f2 = (x) => (Number.isFinite(x) ? x.toFixed(2) : String(x));
const f3 = (x) => (Number.isFinite(x) ? x.toFixed(3) : String(x));
const mean = (xs) =>
  xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN;
const se = (xs) => {
  if (xs.length < 2) return NaN;
  const m = mean(xs);
  return Math.sqrt(
    xs.reduce((a, x) => a + (x - m) ** 2, 0) / (xs.length - 1) / xs.length,
  );
};
const p95 = (xs) => {
  const a = [...xs].sort((x, y) => x - y);
  return a.length ? a[Math.floor(0.95 * (a.length - 1))] : NaN;
};
const L = [];
const say = (s) => L.push(s);

// ---- sources
const games = of("g");
const errors = of("error");
say("## Sources");
say(
  `deals played: ${games.length}; base matching the g1 base record (45086908053: winner, cr, sc): ${games.filter((g) => g.matchesBatch).length}; control identical to base: ${games.filter((g) => g.controlSame).length}; errors: ${errors.length}`,
);
for (const e of errors) say(`  ERROR ${e.src}: ${e.error?.split("\n")[0]}`);
for (const g of games.filter((g) => !g.matchesBatch))
  say(`  base unlike the record: ${g.src}`);
const corpWins = (k) => games.filter((g) => g[k].winner === "corp").length;
say(
  `Corp wins (reported only): base ${corpWins("base")}/${games.length}, F ${corpWins("F")}/${games.length}`,
);
say(
  `deals whose play differs (base v F, lockstep): ${games.filter((g) => g.differs).length}`,
);

// ---- first differing decisions
const firsts = of("first");
say("");
say("## First differing decision, attributed (counterfactual)");
const byClass = {};
for (const f of firsts) inc(byClass, `${f.side}:${f.verdict}`);
for (const [k, n] of Object.entries(byClass).sort((a, b) => b[1] - a[1]))
  say(`  ${k}: ${n}`);
const missing = games.filter(
  (g) => g.differs && !firsts.some((f) => f.src === g.src),
);
if (missing.length)
  say(
    `  differing deals with no first-difference record: ${missing.map((g) => g.src).join(", ")}`,
  );
const stopsF = firsts.filter((f) => /^(stop|unattributed)/.test(f.verdict));
say(`STOPS (unattributed or control unlike played): ${stopsF.length}`);
say("");
say("### Each differing deal");
for (const f of firsts.sort((a, b) => a.src.localeCompare(b.src))) {
  const what =
    f.side === "runner"
      ? (f.diffs ?? []).map((d) => `${d.cls} ${d.title} (${d.zone})`).join("; ")
      : (f.leaks ?? [])
          .map((x) => `sample ${x.k} ${x.why} ${x.title}`)
          .join("; ");
  const extra =
    f.side === "runner"
      ? `Fdec ${f.Fdec}`
      : `Frep ${f.Frep}, ${f.leakSamples} leak samples`;
  say(
    `  ${f.src} T${f.T} ${f.side} ${f.dk}${f.prompt ? `/${f.prompt}` : ""}: ${f.verdict} | ${extra} | ${what}`,
  );
  say(`      base ${f.base}`);
  say(`      F    ${f.F}`);
}

// ---- reply
const reply = of("reply");
say("");
say("## The reply's Runner (base games, every Corp decision)");
const sum = (k) => reply.reduce((n, r) => n + (r[k] ?? 0), 0);
say(
  `Corp decisions: ${sum("decisions")} (${f2(sum("decisions") / reply.length)} a game); reply/oracle samples made: ${sum("samples")}`,
);
say(
  `Corp decisions with a sample whose Runner held a root card the marks did not: ${sum("withLeak")} (${f2(sum("withLeak") / reply.length)} a game); such samples: ${sum("leakSamples")}`,
);
const why = {};
for (const r of reply)
  for (const [k, n] of Object.entries(r.byWhy ?? {})) inc(why, k, n);
say(
  `  entries by why (entry-holdings, summed over samples and remember calls): ${Object.entries(
    why,
  )
    .map(([k, n]) => `${k} ${n}`)
    .join(", ")}`,
);
say(
  `asked (cap per game): ${sum("asked")}; control unlike played (not counted): ${sum("controlStops")}; Corp picks changed (pF unlike control): ${sum("changed")} (${f3(sum("changed") / reply.length)} a game)`,
);
const picks = of("corpPick");
const pts = [];
const wins = [];
for (const p of picks) {
  if (!p.contBase || !p.contF || p.contBase.error || p.contF.error) continue;
  pts.push(p.contF.corpPts - p.contBase.corpPts);
  wins.push(
    (p.contF.winner === "corp" ? 1 : 0) -
      (p.contBase.winner === "corp" ? 1 : 0),
  );
}
say(
  `### The Corp's part: paired continuations (pF tree, from the same board; F's pick minus the base's), ${pts.length} pairs`,
);
say(
  `  Corp points: ${f2(mean(pts))} +- ${f2(se(pts))} (SE); Corp win: ${f3(mean(wins))} +- ${f3(se(wins))} (SE)`,
);
say(
  `  pFrep agrees with pF on ${picks.filter((p) => p.Frep === "F").length} of ${picks.length} changed picks`,
);
for (const p of picks)
  say(
    `  ${p.src} T${p.T} ${p.dk}: base ${p.base} -> F ${p.F}; ${p.samples} leak samples (${[...new Set((p.leaks ?? []).map((x) => `${x.why} ${x.title}`))].join("; ")}); cont base ${JSON.stringify(p.contBase)} F ${JSON.stringify(p.contF)}`,
  );

// ---- preAccess on trash decisions
const tr = of("trash");
say("");
say(
  "## preAccess asked honestly (base games, Runner access_trash decisions holding a preAccess entry)",
);
say(
  `asked ${tr.reduce((n, r) => n + r.asked, 0)}, control stops ${tr.reduce((n, r) => n + r.stops, 0)}, changed ${tr.reduce((n, r) => n + r.changed, 0)}`,
);
for (const x of of("trashFlip"))
  say(
    `  ${x.src} T${x.T}: ${x.base} -> ${x.honest} (${x.pre.map((p) => p.title).join(", ")})`,
  );

// ---- arm H
const H = of("H");
say("");
say("## Arm H (F with the hidden-zone entries removed too; sized, not built)");
const hz = {};
for (const h of H)
  for (const [k, n] of Object.entries(h.byZone ?? {})) inc(hz, k, n);
const hc = H.reduce((n, h) => n + h.changed, 0);
say(
  `asked ${H.reduce((n, h) => n + h.asked, 0)} (cap per game), control stops ${H.reduce((n, h) => n + h.stops, 0)}, decisions changed ${hc} (${f3(hc / (H.length || 1))} a game); by zone: ${
    Object.entries(hz)
      .map(([k, n]) => `${k} ${n}`)
      .join(", ") || "none"
  }`,
);
say(
  `  games where the cap was reached: ${H.filter((h) => h.asked >= 40).length}`,
);

// ---- real path
say("");
say(
  "## Real-path prompt answers (the deciding Runner's promptAnswer, prompt naming a stack card or an unknown Corp card)",
);
const rb = games.reduce((n, g) => n + g.base.real, 0);
const rf = games.reduce((n, g) => n + g.F.real, 0);
const rc = games.reduce((n, g) => n + g.control.real, 0);
say(
  `self-play: base ${rb} (${f3(rb / games.length)} a game), F ${rf} (${f3(rf / games.length)} a game), control ${rc}; rise ${f3((rf - rb) / games.length)} a game (stop above 0.05)`,
);

// ---- time
say("");
say("## Time against the control arm (ms a decision)");
const times = of("time");
for (const side of ["corp", "runner", "all"]) {
  const pool = (k) =>
    times.flatMap((t) =>
      side === "all" ? [...t.raw[k].corp, ...t.raw[k].runner] : t.raw[k][side],
    );
  const [b, f, c] = ["base", "F", "control"].map(pool);
  say(
    `self-play ${side}: mean base ${f2(mean(b))} F ${f2(mean(f))} control ${f2(mean(c))} -> F/control ${f3(mean(f) / mean(c))} (base/control ${f3(mean(b) / mean(c))}); p95 base ${f2(p95(b))} F ${f2(p95(f))} control ${f2(p95(c))} -> F/control ${f3(p95(f) / p95(c))} (base/control ${f3(p95(b) / p95(c))})`,
  );
}
const hum = of("human");
const hpool = (k) =>
  hum.filter((h) => !h.sk.endsWith(":hard")).flatMap((h) => h.raw[k]);
{
  const [b, f, c] = ["pBase", "pF", "pControl"].map(hpool);
  say(
    `human Runner asks: mean base ${f2(mean(b))} F ${f2(mean(f))} control ${f2(mean(c))} -> F/control ${f3(mean(f) / mean(c))}; p95 F/control ${f3(p95(f) / p95(c))} (base/control ${f3(p95(b) / p95(c))}); n ${f.length}`,
  );
}

// ---- human files
say("");
say(
  "## Human files (recorded moves replayed; shadows of each tree asked at every Runner decision; Hard: replay check)",
);
const byK = {};
for (const h of hum) {
  const o = (byK[h.sk] ??= {
    files: 0,
    decisions: 0,
    memDiff: 0,
    changed: 0,
    stopped: 0,
    verdicts: {},
  });
  o.files++;
  o.decisions += h.decisions;
  o.memDiff += h.memDiff;
  o.changed += h.changed;
  if (h.stopped) o.stopped++;
  for (const [k, n] of Object.entries(h.byVerdict ?? {})) inc(o.verdicts, k, n);
}
say(`files: ${hum.length}`);
for (const [k, o] of Object.entries(byK))
  say(
    `  ${k}: ${o.files} files, ${o.decisions} Runner decisions, memory differs at ${o.memDiff}, answers changed ${o.changed} (${
      Object.entries(o.verdicts)
        .map(([v, n]) => `${v} ${n}`)
        .join(", ") || "-"
    }), replays stopped ${o.stopped}`,
  );
for (const h of hum.filter((h) => h.stopped))
  say(`  STOPPED ${h.src}: ${h.stopped}`);
for (const c of of("hChange"))
  say(
    `  ${c.src} T${c.T} ${c.dk}: ${c.verdict} (${(c.diffs ?? []).map((d) => `${d.cls} ${d.title}`).join("; ")}) control ${c.controlSame ? "same" : "DIFFERS"}`,
  );

console.log(L.join("\n"));
