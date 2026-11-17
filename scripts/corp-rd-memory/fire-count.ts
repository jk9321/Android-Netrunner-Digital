/**
 * ai-corp-rd-memory (brief rev 2, "Bar"; red team 2026-11-16 rulings 1, 3, 8): the fire count, split by change.
 *
 * Default: at each recorded Corp decision (the 56 local deals and the human games, scripts/stage-a/harness.ts, split by
 * SHARD) a fresh Normal Corp decides on copies of the state that differ only in the Corp's memory of R&D
 * (corp.rdKnownToCorp), which is all the Corp's deal reads to keep R&D places (runnerReply.ts corpKnownRdSlots):
 *   base   = the places the Runner knows exactly (runnerReply.ts knownRdSlots), as beta's deal kept them;
 *   branch = the Corp's own memory, as recorded (the branch);
 *   mem    = both (change 1 only: the Corp's memory added, the Runner's places still kept);
 *   leak   = neither (change 2 only: the Runner's places no longer kept, ruling 1, 7.1.2).
 * A change is a decision where base and branch differ; a cause reproduces it when its pick is the branch's. Base
 * differs from beta's deal in one way only: the Runner's range entries (lo < hi, or "may have left") are re-pointed to
 * the dealt cards on the branch and kept on beta; `rangeEntries` counts the decisions that have one. A change with no
 * card in either memory is a stop. `effects` names the effects that put the Corp's cards there (the log lines that
 * mention R&D since the card first appeared in the memory).
 *
 * Also (ARGS=runner: only this; ARGS=corp: only the Corp count): plays each local deal twice, Normal v Normal, the second time with the Runner deciding on a copy of the
 * state with the Corp's memory deleted; prints one line per deal with a hash of every action. Equal hashes = the
 * Runner never reads the Corp's memory (brief: "Runner decisions changed must be 0").
 *   SHARD=0/64 npx vite-node scripts/corp-rd-memory/fire-count.ts > fc-0.txt
 */
import { createHash } from 'node:crypto';
import { CardInstance, GameAction, GameState, activePrompt, getLegalActions } from '../../src/core';
import { HeuristicCorpAI, createAgent } from '../../src/ai';
import { Agent } from '../../src/ai/agent';
import { GameRunner } from '../../src/ai/playout';
import { valueLoops } from '../../src/ai/valueModel';
import { knownRdSlots } from '../../src/ai/runnerReply';
import { clearCaches, dealState, deals, forEachRecorded } from '../stage-a/harness';

const key = (a: GameAction | null | undefined) => (a ? JSON.stringify(Object.fromEntries(Object.entries(a).sort())) : 'null');
type Arm = 'base' | 'branch' | 'mem' | 'leak';
type Entry = { id: string; at: number };

function withMemory(s: GameState, arm: Arm): GameState {
  const copy = structuredClone(s);
  const runner: Entry[] = [...knownRdSlots(s)].map(at => ({ id: s.corp.rd[at].instanceId, at }));
  const corp: Entry[] = s.corp.rdKnownToCorp ?? [];
  const both = new Map<string, Entry>([...runner, ...corp].map(e => [e.id, e]));
  const memory = arm === 'base' ? runner : arm === 'branch' ? corp : arm === 'mem' ? [...both.values()].sort((a, b) => a.at - b.at) : [];
  copy.corp.rdKnownToCorp = memory;
  return copy;
}
const decide = (s: GameState, arm: Arm, kind: 'action' | 'rez', cards?: CardInstance[]) => {
  clearCaches();
  const copy = withMemory(s, arm);
  const agent = new HeuristicCorpAI({ synergy: true, planner: true });
  const t = performance.now();
  const a = kind === 'rez' ? agent.chooseRez(copy, cards!) : agent.chooseAction(copy);
  return { a: key(a), ms: Math.round(performance.now() - t) };
};

/** The effect that put each Corp memory card there: the last R&D log line before it first appeared (per source). */
const firstSeen = new Map<string, Map<string, string>>();
const lastLog = new Map<string, number>();
function effectsOf(src: string, s: GameState): string[] {
  const seen = firstSeen.get(src) ?? new Map<string, string>();
  firstSeen.set(src, seen);
  const from = lastLog.get(src) ?? 0;
  const lines = s.log.slice(from).map(l => l.message).filter(m => /R&D/.test(m));
  lastLog.set(src, s.log.length);
  const label = (m: string | undefined) => (m ? (m.match(/\(([^)]+)\)\.?$/)?.[1] ?? m.replace(/\d+/g, 'n').slice(0, 60)) : 'unknown');
  for (const e of s.corp.rdKnownToCorp ?? []) if (!seen.has(e.id)) seen.set(e.id, label(lines[lines.length - 1]));
  return [...new Set((s.corp.rdKnownToCorp ?? []).map(e => seen.get(e.id)!))];
}

const args = process.env.ARGS ?? '';
if (!args.includes('corp')) {
  const [shard, shards] = (process.env.SHARD ?? '0/1').split('/').map(Number);
  deals().forEach((seed, k) => {
    if (k % shards !== shard) return;
    const play = (strip: boolean) => {
      valueLoops.clear();
      const hash = createHash('sha256');
      let n = 0;
      let corpMemory = 0;
      const corpInner = createAgent('corp', 'normal');
      const runnerInner = createAgent('runner', 'normal');
      const seen = (s: GameState) => (strip ? (({ ...structuredClone(s), corp: { ...structuredClone(s.corp), rdKnownToCorp: undefined } }) as GameState) : s);
      const corp = {
        side: 'corp',
        chooseAction(state: GameState) {
          clearCaches();
          const a = corpInner.chooseAction(state);
          hash.update('c' + JSON.stringify(a));
          return a;
        },
        chooseRez(state: GameState, cards: CardInstance[]) {
          clearCaches();
          const a = corpInner.chooseRez?.(state, cards) ?? null;
          hash.update('z' + JSON.stringify(a));
          return a;
        },
      } as Agent;
      const runner = {
        side: 'runner',
        chooseAction(state: GameState) {
          clearCaches();
          if (state.corp.rdKnownToCorp?.length) corpMemory++;
          const a = runnerInner.chooseAction(seen(state));
          hash.update('r' + JSON.stringify(a));
          n++;
          return a;
        },
        chooseOffTurn(state: GameState) {
          clearCaches();
          const a = runnerInner.chooseOffTurn?.(seen(state)) ?? null;
          hash.update('o' + JSON.stringify(a));
          return a;
        },
      } as Agent;
      const game = new GameRunner(dealState(seed), { corp, runner });
      for (let i = 0; i < 4000 && game.step(); i++);
      return { hash: hash.digest('hex').slice(0, 16), n, corpMemory, winner: game.state.winner };
    };
    const kept = play(false);
    const stripped = play(true);
    console.log(JSON.stringify({ mode: 'runner', src: `deal:${seed}`, identical: kept.hash === stripped.hash, runnerDecisions: kept.n, withCorpMemory: kept.corpMemory, kept, stripped }));
  });
}
if (!args.includes('runner')) {
  forEachRecorded({
    decision: d => {
      if (d.state.winner) return;
      const s = d.state;
      const kind = d.kind;
      if (kind === 'action' && !(getLegalActions(s, 'corp').length > 0)) return;
      const effects = effectsOf(d.src, s);
      const r = { base: decide(s, 'base', kind, d.cards), branch: decide(s, 'branch', kind, d.cards) };
      const changed = r.base.a !== r.branch.a;
      const causes: string[] = [];
      if (changed) for (const arm of ['mem', 'leak'] as const) if (decide(s, arm, kind, d.cards).a === r.branch.a) causes.push(arm);
      const corpMem = s.corp.rdKnownToCorp?.length ?? 0;
      const runnerExact = knownRdSlots(s).size;
      const rangeEntries = (s.corp.rdKnownToRunner ?? []).filter(e => e.lo !== e.hi || e.left).length;
      console.log(
        JSON.stringify({
          src: d.src,
          i: d.i,
          T: s.turnNumber,
          kind: kind === 'rez' ? 'rez' : activePrompt(s) ? 'prompt' : 'main',
          changed,
          causes,
          corpMem,
          runnerExact,
          rangeEntries,
          effects: corpMem ? effects : [],
          stop: changed && corpMem === 0 && runnerExact === 0 && rangeEntries === 0,
          base: changed ? r.base.a : undefined,
          branch: changed ? r.branch.a : undefined,
          msBase: r.base.ms,
          msBranch: r.branch.ms,
        }),
      );
    },
  });
}
