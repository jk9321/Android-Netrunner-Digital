/**
 * ai-runner-seen measurement (brief /mnt/project-files/netrunner-ai/runner-rework/fixes/runner-seen/brief.md rev 1a): the trees.
 *
 * A tree is a copy of this checkout's src/ (branch ai-runner-seen, whose `remember` is the fix) with text patches, loaded
 * as its own module graph (loadTree from scripts/stage-vc/breaker-once-trees.ts). Every tree gets the same patches; only
 * its ARM constant differs:
 *  - `remember` (src/ai/runnerAI.ts) runs beta's body (the old one, copied verbatim from beta 4d304e6) or the fix's body:
 *      base, control: old everywhere (= beta's src exactly);
 *      F: the fix everywhere;  Fdec: the fix in the deciding Runner only (the reply's and the oracle's Runners keep the
 *      old one);  Frep: the fix in the reply's and the oracle's Runners only.
 *    (Arm H, F with the hidden-zone entries removed too, is asked on the F tree with a forced memory, see FORCE.)
 *  - RECORD (writes globals only, keyed by the tree's name, so the play is unchanged):
 *      the reply's Runners (runnerReply.ts, one per sample) and the oracle playout's Runner are numbered (`__reply`: k for
 *      the k-th reply sample made in this tree, -k for an oracle playout);
 *      a reply or oracle Runner running the OLD body logs every root card it holds that the engine does not mark
 *      (`__seenLeak_<tree>`: sample, id, code, why: preAccess / breachReplaced / notAccessed / installedThisTurn / carried);
 *      `promptAnswer`'s real-state path taken because the prompt names a stack card or a card of runnerUnknownSlots, by the
 *      top-level Runner only (`__seenTop_<tree>` is the agent the script asks; `__seenReal_<tree>` counts).
 *  - FORCE: after `remember`, a deciding Runner (not a reply's or oracle's) applies `__seenForce_<tree>` (id -> code, or
 *    null to delete) when the script sets it: the counterfactual asks (one class's entries taken out, or arm H).
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import {
  cpSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { Tree, loadTree } from "../stage-vc/breaker-once-trees";

export const TREES = [
  "base",
  "control",
  "F",
  "pBase",
  "pControl",
  "pF",
  "pFdec",
  "pFrep",
] as const;
export type TreeName = (typeof TREES)[number];
const ARM: Record<TreeName, "base" | "F" | "Fdec" | "Frep"> = {
  base: "base",
  control: "base",
  F: "F",
  pBase: "base",
  pControl: "base",
  pF: "F",
  pFdec: "Fdec",
  pFrep: "Frep",
};

export type SeenTree = Tree & {
  tree: TreeName;
  reply: any;
  helpers: any;
  rdKnowledge: any;
};

type Patch = [file: string, at: string, to: string];

const NEW_BODY = `  private remember(state: GameState) {
    for (const server of Object.values(state.corp.servers)) {
      for (const card of server.root) {
        if (card.isRezzed || card.faceUp || card.runnerKnows) this.memory.set(card.instanceId, card.cardCode);
        else this.memory.delete(card.instanceId);
      }
    }
  }`;

function patches(tree: TreeName): Patch[] {
  const arm = ARM[tree];
  const G = `(globalThis as any)`;
  const fix =
    arm === "F"
      ? "true"
      : arm === "Fdec"
        ? "!__reply"
        : arm === "Frep"
          ? "!!__reply"
          : "false";
  return [
    [
      "ai/runnerAI.ts",
      NEW_BODY,
      `  private remember(state: GameState) {
    const __reply = (this as any).__reply as number | undefined;
    if (${fix}) {
      for (const server of Object.values(state.corp.servers)) {
        for (const card of server.root) {
          if (card.isRezzed || card.faceUp || card.runnerKnows) this.memory.set(card.instanceId, card.cardCode);
          else this.memory.delete(card.instanceId);
        }
      }
    } else {
      // beta 4d304e6's body, verbatim
      const run = state.activeRun;
      const breached = state.runsThisTurn.filter(r => r.successful).map(r => r.server);
      if (run?.isSuccessful) breached.push(run.server);
      for (const id of breached) {
        for (const card of state.corp.servers[id]?.root ?? []) this.memory.set(card.instanceId, card.cardCode);
      }
      // Cards it accessed that the Corp then installed during the breach (Poétrï)
      for (const server of Object.values(state.corp.servers)) {
        for (const card of server.root) if (card.runnerKnows) this.memory.set(card.instanceId, card.cardCode);
      }
      // RECORD: a reply's or oracle's Runner holding a root card the engine does not mark
      const __log = ${G}.__seenLeak_${tree};
      if (__reply && __log) {
        for (const [sid, server] of Object.entries(state.corp.servers)) {
          for (const card of server.root) {
            if (!this.memory.has(card.instanceId) || card.isRezzed || card.faceUp || card.runnerKnows) continue;
            const why = run?.isSuccessful && run.server === sid ? (run.breachInstead ? 'breachReplaced' : 'preAccess') : state.runsThisTurn.some(r => r.successful && r.server === sid) ? (card.installedTurn === \`\${state.turnNumber}-\${state.activePlayer}\` ? 'installedThisTurn' : 'notAccessed') : 'carried';
            __log.push({ k: __reply, id: card.instanceId, code: card.cardCode, why });
          }
        }
      }
    }
    // FORCE: the deciding Runner's memory with entries set or taken out (the script's counterfactual asks)
    const __f = ${G}.__seenForce_${tree} as Map<string, string | null> | undefined;
    if (__f && !__reply) for (const [id, code] of __f) code === null ? this.memory.delete(id) : this.memory.set(id, code);
  }`,
    ],
    [
      "ai/runnerAI.ts",
      '    if ([...state.runner.stack, ...ice, ...root, ...loose].some(c => shown.includes(`"${c.instanceId}"`))) return real();',
      `    if ([...state.runner.stack, ...ice, ...root, ...loose].some(c => shown.includes(\`"\${c.instanceId}"\`))) {
      if (${G}.__seenTop_${tree} === this) ${G}.__seenReal_${tree} = (${G}.__seenReal_${tree} ?? 0) + 1;
      return real();
    }`,
    ],
    [
      "ai/runnerReply.ts",
      `        runner: new HeuristicRunnerAI({ synergy, planner: false }),`,
      `        runner: Object.assign(new HeuristicRunnerAI({ synergy, planner: false }), { __reply: (${G}.__seenReplyN_${tree} = (${G}.__seenReplyN_${tree} ?? 0) + 1) }),`,
    ],
    [
      "ai/runnerReply.ts",
      `runner: new HeuristicRunnerAI({}) }));`,
      `runner: Object.assign(new HeuristicRunnerAI({}), { __reply: -(${G}.__seenReplyN_${tree} = (${G}.__seenReplyN_${tree} ?? 0) + 1) }) }));`,
    ],
  ];
}

export async function seenTrees(
  root: string,
  want: readonly TreeName[] = TREES,
): Promise<Record<TreeName, SeenTree>> {
  rmSync(root, { recursive: true, force: true });
  const out: Partial<Record<TreeName, SeenTree>> = {};
  for (const name of want) {
    const dir = join(root, name);
    mkdirSync(dir, { recursive: true });
    cpSync("src", join(dir, "src"), { recursive: true });
    for (const [file, at, to] of patches(name)) {
      const path = join(dir, "src", file);
      const text = readFileSync(path, "utf8");
      const n = text.split(at).length - 1;
      if (n !== 1)
        throw new Error(
          `patch for ${file} matches ${n} times (tree ${name}): ${at.slice(0, 80)}`,
        );
      writeFileSync(
        path,
        text.replace(at, () => to),
      );
    }
    const t = (await loadTree(name, dir)) as SeenTree;
    const m = (p: string) => import(/* @vite-ignore */ join(dir, "src", p));
    t.tree = name;
    t.reply = await m("ai/runnerReply.ts");
    t.helpers = await m("core/engine/helpers.ts");
    t.rdKnowledge = await m("core/engine/rdKnowledge.ts");
    out[name] = t;
  }
  return out as Record<TreeName, SeenTree>;
}
