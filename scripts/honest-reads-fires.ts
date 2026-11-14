/**
 * Fire count for spec-honest-reads.md (the Corp AI stops reading the Runner's grip, the stack's top and the cards an econ
 * operation draws; rules 10.2.2a). Two modes, run on the base SHA and on the fix:
 *
 *   DUMP=dir SEEDS=1001,1041 npx vite-node scripts/honest-reads-fires.ts   (on the base: play each deal Normal v Normal as
 *       scripts/corp-losses.ts seeds it, and write every Corp decision's method and arguments to dir/<seed>.jsonl)
 *   PICK=dir OUT=picks.json npx vite-node scripts/honest-reads-fires.ts   (on each SHA: a fresh Normal Corp answers every
 *       dumped decision; compare the two OUT files with COMPARE=a.json,b.json)
 *
 * First-order changes on the base's own lines only: once a game turns, everything after it differs too.
 */
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { createInitialGameState, GameState } from '../src/core';
import { deckGameSetup } from '../src/data/decks';
import { ALL_DECKS } from './nsg-sample-decks';
import { Agent, createAgent } from '../src/ai';
import { playLogged } from './lossLog';
import { valueLoops } from '../src/ai/valueModel';

const corpDecks = ALL_DECKS.filter(d => d.side === 'corp');
const runnerDecks = ALL_DECKS.filter(d => d.side === 'runner');
function decksOf(seed: number) {
  const p = Math.floor((seed - 1001) / 10);
  return { c: corpDecks[Math.floor(p / runnerDecks.length)], r: runnerDecks[p % runnerDecks.length] };
}

function dumping(agent: Agent, lines: string[]): Agent {
  return new Proxy(agent, {
    get(target, prop, receiver) {
      const v = Reflect.get(target, prop, receiver);
      if (typeof v !== 'function' || prop === 'constructor') return v;
      return (...args: unknown[]) => {
        const state = args[0] as GameState | undefined;
        const rec = state && typeof state === 'object' && 'turnNumber' in state ? JSON.stringify({ method: String(prop), args }) : null;
        const out = (v as (...a: unknown[]) => unknown).apply(target, args);
        if (rec) lines.push(JSON.stringify({ ...JSON.parse(rec), pick: out ?? null }));
        return out;
      };
    },
  });
}

if (process.env.DUMP) {
  mkdirSync(process.env.DUMP, { recursive: true });
  for (const seed of (process.env.SEEDS ?? '').split(',').filter(Boolean).map(Number)) {
    const { c, r } = decksOf(seed);
    valueLoops.clear();
    const lines: string[] = [];
    playLogged(createInitialGameState(deckGameSetup(seed, c, r)), { corp: dumping(createAgent('corp', 'normal'), lines), runner: createAgent('runner', 'normal') }, { corp: c.name, runner: r.name });
    writeFileSync(`${process.env.DUMP}/${seed}.jsonl`, lines.join('\n'));
    console.error(`deal ${seed}: ${lines.length} Corp decisions`);
  }
} else if (process.env.PICK) {
  const dir = process.env.PICK;
  const out: Record<string, string[]> = {};
  const only = (process.env.SEEDS ?? '').split(',').filter(Boolean);
  for (const f of readdirSync(dir).filter(f => f.endsWith('.jsonl') && (!only.length || only.includes(f.replace('.jsonl', ''))))) {
    out[f] = readFileSync(`${dir}/${f}`, 'utf8').split('\n').filter(Boolean).map(line => {
      const { method, args } = JSON.parse(line) as { method: string; args: unknown[] };
      valueLoops.clear();
      const agent = createAgent('corp', 'normal') as unknown as Record<string, (...a: unknown[]) => unknown>;
      return `${method}:${JSON.stringify(agent[method](...args) ?? null)}`;
    });
    console.error(`${f}: ${out[f].length} picks`);
  }
  writeFileSync(process.env.OUT ?? 'picks.json', JSON.stringify(out));
} else if (process.env.COMPARE) {
  const [a, b] = process.env.COMPARE.split(',').map(p => JSON.parse(readFileSync(p, 'utf8')) as Record<string, string[]>);
  let total = 0;
  let changed = 0;
  const per: string[] = [];
  for (const k of Object.keys(a).sort()) {
    const n = a[k].filter((x, i) => x !== b[k]?.[i]).length;
    total += a[k].length;
    changed += n;
    if (n) per.push(`${k.replace('.jsonl', '')} ${a[k].length}/${n}`);
  }
  console.log(`${Object.keys(a).length} deals, ${total} Corp decisions, ${changed} changed in ${per.length} deals (${(changed / Object.keys(a).length).toFixed(2)} per game)`);
  console.log(per.join(', '));
}
