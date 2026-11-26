/**
 * B3 step 0 (brief /mnt/project-files/netrunner-ai/runner-rework/briefs/b3-prompt-view.md rev 2): the trees the step 0
 * scripts read. Measurement only: no src change.
 *
 * `source`: this checkout's src (or ARM_BASE's, armSource) copied unchanged; it plays the source games and is never asked
 * or cleared mid-game. Every other tree is a copy with measurement hooks (HOSTLOG, B3REC: they report, they change no
 * line of logic while unset) and, for the fix arms, B3b's two inputs of the host's owner written as a scratch patch:
 *
 *  today  hooks only (plays as source while the hooks are unset)
 *  in1    input 1 only: a counter on a facedown host the Runner does not know (`!isRezzed && !runnerKnows`) is worth the
 *         entry's own per-counter formula averaged over the unseen ice pool unrezzedDamageRisk reads (runs.ts:650-653,
 *         extracted as unseenIcePool, play identical), each pool card standing in for the host as unrezzedDamageRisk's
 *         stand-in does (its own id, the host's place); the pool's codes are summed in sorted order, so the mean is the
 *         same on the real state and on any deal of the same knowledge (one multiset)
 *  capA   input 1 + input 2 with the cap = the host's subroutines x 1 encounter in the entry's horizon
 *  capC   input 1 + input 2 with the cap = the host's subroutines x 3 encounters (one a turn over the entry's 3 turns)
 *         (input 2: the subroutine-breaking counters on one host, counted across every trojan with
 *         holdFacts.breaksHostSubroutine it hosts, earlier installs first (rig order), are worth the entry's per-counter
 *         worth up to the cap, past it 0; a later copy of an 'idle' trojan (runFacts.trojan.second) is worth 0. The entry
 *         states no encounter count (perTurn's horizon is 3 turns, virusWait a discount), so the cap's count is an
 *         option per arm, not a chosen number: step 0 brings it back to the coordinator (brief rev 2, S4).)
 *  In every fix arm the install action's trojanHostValue term goes (a rezzed host: the outcome's difference only) and
 *  the facedown flat -3 stays on the action (rev 2, S2).
 *
 * Each patch must match exactly once (a stop otherwise, as the other counts' trees).
 */
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { armSource } from '../../tag-owner/trees';

type Patch = [file: string, at: string, to: string];
export const ARMS = ['today', 'in1', 'capA', 'capC'] as const;
/** `built` (B3b, read on the built tree): this checkout's own src with the hooks only, whatever ARM_BASE names; the
 * source and the other arms come from ARM_BASE as before. Asked for by name (step0.ts FIX_ARMS), never in ARMS. */
export type Arm = (typeof ARMS)[number] | 'built';

const HOOKS: Patch[] = [
  [
    'ai/prompts.ts',
    `/** Picks an answer to the active prompt, which belongs to \`side\`. */\nexport function answerPrompt(state: GameState, side: SideCode, memory?: RunnerMemory, synergy = false): GameAction {\n`,
    `// eslint-disable-next-line @typescript-eslint/no-explicit-any\nexport const HOSTLOG: { on?: (promptId: string, action: any, score: number) => void } = {};\n// eslint-disable-next-line @typescript-eslint/no-explicit-any\nexport const B3REC: { prompt?: (state: GameState, side: SideCode, memory: any, synergy: boolean) => void; rank?: (state: GameState, ranked: any[], memory: any, planner: boolean) => void } = {};\n/** Picks an answer to the active prompt, which belongs to \`side\`. */\nexport function answerPrompt(state: GameState, side: SideCode, memory?: RunnerMemory, synergy = false): GameAction {\n  B3REC.prompt?.(state, side, memory, synergy);\n`,
  ],
  [
    'ai/prompts.ts',
    `    if (skip && after.activeRun?.encounter?.iceId === skip.iceId) score -= skip.cost;\n`,
    `    if (skip && after.activeRun?.encounter?.iceId === skip.iceId) score -= skip.cost;\n    HOSTLOG.on?.(prompt.id, action, score);\n`,
  ],
  ['ai/runnerAI.ts', `import { answerPrompt, runEventOptions, simulate } from './prompts';`, `import { B3REC, answerPrompt, runEventOptions, simulate } from './prompts';`],
  [
    'ai/runnerAI.ts',
    `      .sort((a, b) => b.score - a.score);\n  }\n\n  /** Cards seen so far`,
    `      .sort((a, b) => b.score - a.score);\n    B3REC.rank?.(state, __ranked, this.memory, this.planner);\n    return __ranked;\n  }\n\n  /** Cards seen so far`,
  ],
  ['ai/runnerAI.ts', `    return [...legal, ...makeRoomInstalls(state)]\n      .map(action => {\n        let score = this.scoreMain(state, action, before, view);`, `    const __ranked = [...legal, ...makeRoomInstalls(state)]\n      .map(action => {\n        let score = this.scoreMain(state, action, before, view);`],
];

const POOL: Patch[] = [
  [
    'ai/runs.ts',
    `export function unrezzedDamageRisk(state: GameState, ice: CardInstance): number {\n  const damages = memo(state, 'unrezzedIceDamage', () => {\n    const corp = state.corp;\n    const hidden = Object.values(corp.servers).flatMap(server => server.ice.filter(c => !c.isRezzed && !c.runnerKnows));\n    const pool = [...corp.hq, ...corp.rd, ...corp.archives.faceDown, ...hidden].filter(c => getCardDefinition(c.cardCode).type_code === 'ice');\n`,
    `export function unseenIcePool(state: GameState): CardInstance[] {\n  const corp = state.corp;\n  const hidden = Object.values(corp.servers).flatMap(server => server.ice.filter(c => !c.isRezzed && !c.runnerKnows));\n  return [...corp.hq, ...corp.rd, ...corp.archives.faceDown, ...hidden].filter(c => getCardDefinition(c.cardCode).type_code === 'ice');\n}\nexport function unrezzedDamageRisk(state: GameState, ice: CardInstance): number {\n  const damages = memo(state, 'unrezzedIceDamage', () => {\n    const corp = state.corp;\n    const pool = unseenIcePool(state);\n`,
  ],
];

const fixWorth = (cap: number): Patch[] => [
  ['ai/counterValues.ts', `import { COUNTER_FORMULAS, COUNTER_WORTH } from './cards';`, `import { CARDS, COUNTER_FORMULAS, COUNTER_WORTH } from './cards';\nimport { plannedSubroutines, unseenIcePool } from './runs';\nimport { memo } from './valueModel';`],
  [
    'ai/counterValues.ts',
    `  const host = card.hostedOnId ? findCardAnywhere(state, card.hostedOnId) : undefined;\n  if (host) return worth(host);\n`,
    `  const host = card.hostedOnId ? findCardAnywhere(state, card.hostedOnId) : undefined;\n  if (host) return b3HostWorth(state, card, host, worth);\n`,
  ],
  [
    'ai/counterValues.ts',
    `/** Step-1 rates, for cards without an entry:`,
    `const B3_CAP = ${cap};
/** B3 step 0 scratch arm: input 2's share of this card's counters on host \`h\` (h may be a stand-in for \`host\`). */
function b3Share(state: GameState, card: CardInstance, host: CardInstance, h: CardInstance): number {
  const facts = CARDS[card.cardCode];
  const on = state.runner.rig.programs.filter(c => c.hostedOnId === host.instanceId && CARDS[c.cardCode]?.runFacts?.trojan);
  const mine = on.findIndex(c => c.instanceId === card.instanceId);
  const earlier = mine < 0 ? on : on.slice(0, mine);
  if (facts?.runFacts?.trojan?.second === 'idle' && earlier.some(c => c.cardCode === card.cardCode)) return 0;
  if (!facts?.holdFacts?.breaksHostSubroutine || !Number.isFinite(B3_CAP)) return 1;
  const cap = plannedSubroutines(state, h).length * B3_CAP;
  const used = earlier.filter(c => CARDS[c.cardCode]?.holdFacts?.breaksHostSubroutine).reduce((n, c) => n + counters(c, 'virus'), 0);
  const room = Math.max(0, cap - used);
  const n = counters(card, 'virus');
  return n > 0 ? Math.min(n, room) / n : room > 0 ? 1 : 0;
}
/** B3 step 0 scratch arm: input 1 (an unknown facedown host read as the pool's expectation) and input 2 (b3Share). */
function b3HostWorth(state: GameState, card: CardInstance, host: CardInstance, worth: (host: CardInstance) => number): number {
  const one = (h: CardInstance) => worth(h) * b3Share(state, card, host, h);
  if (host.isRezzed || host.runnerKnows) return one(host);
  return memo(state, \`b3HostWorth:\${card.instanceId}:\${host.instanceId}\`, () => b3Expect(state, host, one));
}
function b3Expect(state: GameState, host: CardInstance, one: (h: CardInstance) => number): number {
  const codes = unseenIcePool(state).map(c => c.cardCode).sort();
  if (codes.length === 0) return one(host);
  const byCode = new Map<string, number>();
  let total = 0;
  for (const code of codes) {
    let v = byCode.get(code);
    if (v === undefined) {
      v = one({ ...host, instanceId: \`\${host.instanceId}~\${code}\`, cardCode: code });
      byCode.set(code, v);
    }
    total += v;
  }
  return total / codes.length;
}

/** Step-1 rates, for cards without an entry:`,
  ],
  ['ai/runnerAI.ts', `      score += host?.isRezzed ? trojanHostValue(state, cardCode, host) : -3;`, `      score += host?.isRezzed ? 0 : -3;`],
];

const ARM_PATCHES: Record<Arm, Patch[]> = {
  today: HOOKS,
  built: HOOKS,
  in1: [...HOOKS, ...POOL, ...fixWorth(Infinity)],
  capA: [...HOOKS, ...POOL, ...fixWorth(1)],
  capC: [...HOOKS, ...POOL, ...fixWorth(3)],
};

export function makeB3Trees(root: string, arms: readonly Arm[], shard = 0): Record<'source' | Arm, string> {
  rmSync(root, { recursive: true, force: true });
  mkdirSync(root, { recursive: true });
  const from = armSource(root, shard);
  const dirs = { source: join(root, 'source') } as Record<'source' | Arm, string>;
  cpSync(from, join(dirs.source, 'src'), { recursive: true });
  for (const arm of arms) {
    const dir = join(root, arm);
    dirs[arm] = dir;
    cpSync(arm === 'built' ? 'src' : from, join(dir, 'src'), { recursive: true });
    for (const [f, at, to] of ARM_PATCHES[arm]) {
      const path = join(dir, 'src', f);
      const text = readFileSync(path, 'utf8');
      if (text.split(at).length !== 2) throw new Error(`${arm} tree: a patch does not match once in ${f}: ${at.slice(0, 80)}`);
      writeFileSync(
        path,
        text.replace(at, () => to)
      );
    }
  }
  return dirs;
}
