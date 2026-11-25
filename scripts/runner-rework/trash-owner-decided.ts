/**
 * R-B O1b bar 3 (brief /mnt/project-files/netrunner-ai/runner-rework/briefs/o1b-trash-owner.md rev 2): decided-twice.ts
 * on this checkout's tree, unchanged, with its hooked tree's patches brought to B2's files.
 *
 * decided-twice-trees.ts was written before B2 (beta ad25482) moved the Runner's decision during a run out of the agent
 * (runnerAI.ts) into free functions (src/ai/runner/run.ts), so seven of its HOOKED patches no longer match once and
 * makeTrees stops. This wrapper edits that exported array in place before decided-twice.ts loads (one module instance, so
 * makeTrees reads the edited array), then runs decided-twice.ts as it is. Existing scripts are not edited.
 *
 *   - the run-event price (runnerAI.ts): the same patch, with B1's `RUNNER_TERMS.runCard` where it read `0.3`;
 *   - the six in-run hooks (the jack-out test, five places encounterAction gives no break): the same patches on
 *     runner/run.ts, one indent less (free functions, not methods), and the agent they report is the one whose decision
 *     is under way (`__dtAgent`) where they passed `this`;
 *   - one more call-only patch (runnerAI.ts decide): the agent sets `__dtAgent` to itself around runnerDecide and puts
 *     back what was there, so a look-ahead's or a reply's agent (other instances) reports itself, as before. runAction is
 *     reached only through runnerDecide (runner/core.ts); the Hard Runner (search.ts) is not in these games.
 *
 * Run as decided-twice.ts: ARGS="POOL=batch,nrdb,issues" SHARD=i/n npx vite-node scripts/runner-rework/trash-owner-decided.ts;
 * IDENT=1 checks the hooked tree against a plain copy of src, step for step.
 */
import { readFileSync } from "node:fs";
import { HOOKED, type Patch } from "./decided-twice-trees";

const A = "(globalThis as any).__dtAgent";
const src = (f: string) => readFileSync(`src/${f}`, "utf8");
const once = (f: string, at: string) => src(f).split(at).length === 2;
const dedent = (t: string) =>
  t
    .split("\n")
    .map((l) => (l.startsWith("  ") ? l.slice(2) : l))
    .join("\n");

const moved: Patch[] = [];
for (let i = 0; i < HOOKED.length; i++) {
  const [f, at, to] = HOOKED[i];
  if (once(f, at)) continue;
  if (f !== "ai/runnerAI.ts")
    throw new Error(
      `a stale patch outside runnerAI.ts: ${f}: ${at.slice(0, 90)}`,
    );
  const runCard: Patch = [
    f,
    at.replace(/\+ 0\.3;$/, "+ RUNNER_TERMS.runCard;"),
    to.replace(/\+ 0\.3;$/, "+ RUNNER_TERMS.runCard;"),
  ];
  const inRun: Patch = [
    "ai/runner/run.ts",
    dedent(at),
    dedent(to).replace(/\?\.(enc|move)\(this, /g, `?.$1(${A}, `),
  ];
  const next = [runCard, inRun].find(([g, a]) => once(g, a));
  if (!next)
    throw new Error(
      `no B2 place for a decided-twice patch: ${at.slice(0, 90)}`,
    );
  if (next[0] === "ai/runner/run.ts" && next[2].includes("this"))
    throw new Error(`a moved patch still passes this: ${next[1].slice(0, 90)}`);
  HOOKED[i] = next;
  moved.push(next);
}
const decide = `    return runnerDecide(state, this.runnerContext());`;
if (!once("ai/runnerAI.ts", decide))
  throw new Error(
    "runnerAI.ts decide: the call to runnerDecide does not match once",
  );
HOOKED.push([
  "ai/runnerAI.ts",
  decide,
  `    const __p = ${A};\n    ${A} = this;\n    try {\n      return runnerDecide(state, this.runnerContext());\n    } finally {\n      ${A} = __p;\n    }`,
]);
console.error(
  `trash-owner-decided: ${moved.length} patches moved to B2's places (${moved.map((m) => m[0]).join(", ")}), the agent's scope added`,
);

await import("./decided-twice");
