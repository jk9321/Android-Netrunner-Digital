/**
 * Step S-1 local fire counts (brief-step-s.md step 3): at every recorded decision of one side, the decision is made with
 * nothing ablated while a probe notes which valuation families it read (pricing.ts ablationProbe), then again with each
 * family it read ablated for that side (a family it did not read cannot change it: decisions are deterministic once the
 * hand caches are cleared, which the control below checks). One JSON line per decision; sum with fire-count-sum.mjs.
 *
 * Recorded decisions: the 56 local deals (stage-a harness seeds and pairings, Normal v Normal, nothing ablated) and every
 * state of tests/fixtures/human-games where that side acts (main phase and prompts; the Corp's rez windows too).
 * ARGS: `corp` or `runner` (the side whose decisions are counted; default corp), then optionally a comma list of
 * families. SHARD=k/n takes every n-th source.
 *   SHARD=0/64 npx vite-node scripts/step-s/fire-count.ts -- corp > fc-0.txt
 */
import { readFileSync } from 'node:fs';
import { CardInstance, GameAction, GameState, SideCode, actingSide, cardDef, createInitialGameState, executeAction, findCardAnywhere, wantsStop } from '../../src/core';
import { deckGameSetup } from '../../src/data/decks';
import { createAgent } from '../../src/ai';
import { Agent } from '../../src/ai/agent';
import { GameRunner, rezCandidates } from '../../src/ai/playout';
import { ABLATE_FAMILIES, AblateFamily, ablationProbe, applyAblate } from '../../src/ai/pricing';
import { valueLoops } from '../../src/ai/valueModel';
import { clearCaches, dealState, deals, humanFiles } from '../stage-a/harness';

const args = (process.env.ARGS ?? process.argv.slice(2).join(' ')).split(/\s+/).filter(Boolean);
const side: SideCode = args[0] === 'runner' ? 'runner' : 'corp';
const only = (args[1] ?? '').split(',').filter(Boolean);
const families: AblateFamily[] = only.length ? ABLATE_FAMILIES.filter(f => only.includes(f)) : [...ABLATE_FAMILIES];

const name = (s: GameState, a: GameAction | null) => {
  if (!a) return 'none';
  const id = 'cardInstanceId' in a ? (a.cardInstanceId as string) : undefined;
  const c = id ? findCardAnywhere(s, id) : undefined;
  const to = 'targetServerId' in a && a.targetServerId ? '@' + a.targetServerId : a.type === 'INSTALL_CARD' ? '@new' : '';
  const choice = a.type === 'RESOLVE_PROMPT' ? ' ' + JSON.stringify((a as { choice?: unknown }).choice) : '';
  return `${a.type}${c ? ' ' + cardDef(c).title : ''}${to}${choice}`;
};

type Kind = 'action' | 'rez';
/** One decision by a fresh Normal agent of `side`, with `ablate` ablated; the families it read (probe) and its time. */
function decide(s: GameState, kind: Kind, cards: CardInstance[] | undefined, ablate: string, probe: boolean) {
  applyAblate(ablate);
  ablationProbe.seen = probe ? new Set() : null;
  clearCaches();
  const t = performance.now();
  const agent = createAgent(side, 'normal');
  let move: string;
  try {
    const a = kind === 'rez' ? agent.chooseRez?.(structuredClone(s), cards ?? []) ?? null : agent.chooseAction(structuredClone(s));
    move = name(s, a);
  } catch (e) {
    move = `ERROR ${(e as Error).message.slice(0, 120)}`;
  }
  const ms = Math.round(performance.now() - t);
  const read = [...(ablationProbe.seen ?? [])].filter(k => k.startsWith(side + ':')).map(k => k.slice(side.length + 1) as AblateFamily);
  ablationProbe.seen = null;
  applyAblate('');
  return { move, ms, read };
}

let first = true;
let seen = 0;
function measure(src: string, i: number, s: GameState, kind: Kind, cards?: CardInstance[]) {
  const base = decide(s, kind, cards, '', true);
  // Control: the first decision of each source and every 10th decided twice with nothing ablated; a difference is
  // noise, not a family
  const control = first || seen++ % 10 === 0 ? decide(s, kind, cards, '', false).move !== base.move : undefined;
  first = false;
  const changed: Record<string, string> = {};
  const ms: Record<string, number> = {};
  for (const f of families.filter(f => base.read.includes(f))) {
    const r = decide(s, kind, cards, `${side}:${f}`, false);
    ms[f] = r.ms;
    if (r.move !== base.move) changed[f] = r.move;
  }
  console.log(JSON.stringify({ src, i, kind, T: s.turnNumber, base: base.move, baseMs: base.ms, read: base.read.filter(f => families.includes(f)), changed, ms, control }));
}

/** A watching agent: records the deciding side's states, and plays the deal on with a plain Normal agent. */
function watched(src: string, own: SideCode, counter: { i: number }): Agent {
  const inner = createAgent(own, 'normal');
  return {
    side: own,
    chooseAction(state: GameState) {
      if (own === side && !state.winner) measure(src, counter.i++, state, 'action');
      clearCaches();
      return inner.chooseAction(state);
    },
    chooseRez(state: GameState, cards: CardInstance[]) {
      if (own === side) measure(src, counter.i++, state, 'rez', cards);
      clearCaches();
      return inner.chooseRez?.(state, cards) ?? null;
    },
    chooseOffTurn(state: GameState) {
      clearCaches();
      return inner.chooseOffTurn?.(state) ?? null;
    },
  } as Agent;
}

function playDeal(seed: number) {
  valueLoops.clear();
  first = true;
  const src = `deal:${seed}`;
  const counter = { i: 0 };
  const game = new GameRunner(dealState(seed), { corp: watched(src, 'corp', counter), runner: watched(src, 'runner', counter) });
  for (let n = 0; n < 4000 && game.step(); n++);
}

function replayHuman(file: string) {
  const report = JSON.parse(readFileSync(file, 'utf8'));
  if (!report.moves?.length) return;
  valueLoops.clear();
  first = true;
  const src = `human:${file.split('/').pop()}`;
  let s: GameState = createInitialGameState(deckGameSetup(report.config.seed, report.config.corpDeck, report.config.runnerDeck));
  if (report.startStops) s = { ...s, stops: report.startStops };
  let i = 0;
  for (const move of report.moves as GameAction[]) {
    const acting = actingSide(s);
    const window = s.priority;
    const offWindow = window && window.holder === side && s.activePlayer !== side;
    if (acting === side && !s.winner) {
      const rezWindow = side === 'corp' && s.pendingPrompts.length === 0 && offWindow && (window.step === 'approach_ice' || window.step === 'approach_server');
      if (rezWindow) {
        if (wantsStop({ ...s, stops: { corp: 'ai', runner: 'ai' } }, 'corp', window)) measure(src, i++, s, 'rez', rezCandidates(s, window.step as 'approach_ice' | 'approach_server'));
      } else if (!offWindow) measure(src, i++, s, 'action');
    }
    try {
      s = executeAction(s, move);
    } catch {
      break; // a fixture recorded on an older engine: read up to here
    }
  }
}

const [shard, shards] = (process.env.SHARD ?? '0/1').split('/').map(Number);
const sources: (() => void)[] = [...deals().map(seed => () => playDeal(seed)), ...humanFiles().map(f => () => replayHuman(f))];
sources.forEach((run, k) => {
  if (k % shards === shard) run();
});
