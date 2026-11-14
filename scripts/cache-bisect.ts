/**
 * Audit Step 2 (AI-CACHE-HIDDEN-STATE): does a game's play depend on the games played before it in the same process?
 * Plays deal B alone (in a child process, so no AI module map is warm), then deals A and B in one process as a batch
 * shard does (scripts/corp-losses.ts: fresh agents and valueLoops per game, playLogged), and reports the first decision
 * of B that differs: its index, turn, mover and both picks.
 *
 *   PAIRS=1112+1323+1541+1752+1963:2181 npx vite-node scripts/cache-bisect.ts
 *
 * A pair is A:B, or A1+A2+...:B for several games before B (a shard's order: in a g3 batch shard i plays deal indexes
 * i, i+64, ...; deal index d is seed 1000 + 10 * floor(d / 3) + d % 3 + 1). CLEAR=name,name empties those maps
 * (scripts/cache-clears.ts) just before B, to find the one that carries the state.
 *
 * RECORD=out.json SEEDS=1001,1041 plays the deals in order in this process and writes, per deal, every decision's pick
 * and the Corp's milliseconds per decision (the fire count and speed pair: run it on the branch and on its base).
 */
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { createInitialGameState, GameState } from '../src/core';
import { deckGameSetup } from '../src/data/decks';
import { ALL_DECKS } from './nsg-sample-decks';
import { Agent, createAgent } from '../src/ai';
import { playLogged } from './lossLog';
import { valueLoops } from '../src/ai/valueModel';

const corpDecks = ALL_DECKS.filter(d => d.side === 'corp');
const runnerDecks = ALL_DECKS.filter(d => d.side === 'runner');

/** A deal as corp-losses.ts seeds it (stride 10): seed 1000 + (pairing - 1) * 10 + game + 1. */
function decksOf(seed: number) {
  const p = Math.floor((seed - 1001) / 10);
  return { c: corpDecks[Math.floor(p / runnerDecks.length)], r: runnerDecks[p % runnerDecks.length] };
}

interface Decision {
  i: number;
  turn: number;
  side: string;
  method: string;
  pick: string;
  ms: number;
}

/** Wraps an agent so every answer it gives is recorded, with the time it took. */
function recorded(agent: Agent, log: Decision[]): Agent {
  return new Proxy(agent, {
    get(target, prop, receiver) {
      const v = Reflect.get(target, prop, receiver);
      if (typeof v !== 'function' || prop === 'constructor') return v;
      return (...args: unknown[]) => {
        const t = performance.now();
        const out = (v as (...a: unknown[]) => unknown).apply(target, args);
        const ms = performance.now() - t;
        const state = args[0] as GameState | undefined;
        if (state && typeof state === 'object' && 'turnNumber' in state) {
          log.push({ i: log.length, turn: state.turnNumber, side: agent.side, method: String(prop), pick: JSON.stringify(out ?? null), ms });
        }
        return out;
      };
    },
  });
}

function play(seed: number): { seed: number; log: Decision[]; winner: string | null } {
  const { c, r } = decksOf(seed);
  valueLoops.clear();
  const log: Decision[] = [];
  const agents = { corp: recorded(createAgent('corp', 'normal'), log), runner: recorded(createAgent('runner', 'normal'), log) };
  const record = playLogged(createInitialGameState(deckGameSetup(seed, c, r)), agents, { corp: c.name, runner: r.name });
  return { seed, log, winner: (record as unknown as { winner?: string }).winner ?? null };
}

const firstDiff = (a: Decision[], b: Decision[]): number => {
  for (let i = 0; i < Math.max(a.length, b.length); i++) if (a[i]?.pick !== b[i]?.pick || a[i]?.method !== b[i]?.method) return i;
  return -1;
};

if (process.env.RECORD) {
  const out = (process.env.SEEDS ?? '').split(',').filter(Boolean).map(Number).map(s => {
    const g = play(s);
    console.error(`deal ${s}: ${g.log.length} decisions, ${g.winner}`);
    return { seed: s, winner: g.winner, picks: g.log.map(d => `${d.side}:${d.method}:${d.pick}`), corpMs: g.log.filter(d => d.side === 'corp').map(d => Math.round(d.ms * 10) / 10) };
  });
  writeFileSync(process.env.RECORD, JSON.stringify(out));
} else if (process.env.CHILD) {
  // Child: play the listed deals in order (CLEAR_BEFORE_LAST empties maps before the last), print the last one's decisions
  const seeds = process.env.CHILD.split('+').map(Number);
  const clears = (process.env.CLEAR_BEFORE_LAST ?? '').split(',').filter(Boolean);
  const { aiCacheClears } = clears.length ? await import('./cache-clears') : { aiCacheClears: {} as Record<string, () => void> };
  let last: ReturnType<typeof play> | null = null;
  seeds.forEach((s, n) => {
    if (n === seeds.length - 1) for (const name of clears) aiCacheClears[name]();
    last = play(s);
  });
  process.stdout.write('\n@@' + JSON.stringify(last));
} else {
  const child = (seeds: number[], clear: string): { log: Decision[]; winner: string | null } => {
    const out = execFileSync('npx', ['vite-node', 'scripts/cache-bisect.ts'], {
      env: { ...process.env, CHILD: seeds.join('+'), CLEAR_BEFORE_LAST: clear, PAIRS: '' },
      maxBuffer: 1 << 30,
      encoding: 'utf8',
    });
    return JSON.parse(out.slice(out.lastIndexOf('@@') + 2));
  };
  const clear = process.env.CLEAR ?? '';
  for (const pair of (process.env.PAIRS ?? '').split(',').filter(Boolean)) {
    const [before, b] = pair.split(':');
    const B = Number(b);
    const alone = child([B], '');
    const after = child([...before.split('+').map(Number), B], clear);
    const k = firstDiff(alone.log, after.log);
    const res: Record<string, unknown> = { pair, clear: clear || undefined, decisions: alone.log.length, firstDiff: k, winners: [alone.winner, after.winner] };
    if (k >= 0) {
      res.alone = { ...alone.log[k], ms: undefined };
      res.after = { ...after.log[k], ms: undefined };
    }
    console.log(JSON.stringify(res));
  }
}
