/**
 * Step S hang probe: from a dumped position (STATE=file.json), plays on with fresh Normal agents and times every
 * decision; the state before each decision is saved to OUT_PREFIX-<n>.json so a stuck decision's position is on disk.
 *   STATE=d.json OUT_PREFIX=/tmp/x npx vite-node scripts/step-s/hang-probe.ts
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { CardInstance, GameState } from '../../src/core';
import { createAgent } from '../../src/ai';
import { Agent } from '../../src/ai/agent';
import { GameRunner } from '../../src/ai/playout';

const start: GameState = JSON.parse(readFileSync(process.env.STATE!, 'utf8'));
const prefix = process.env.OUT_PREFIX ?? 'probe';
let n = 0;
const wrap = (side: 'corp' | 'runner'): Agent => {
  const inner = createAgent(side, 'normal');
  const timed = <T>(kind: string, s: GameState, f: () => T): T => {
    const k = n++;
    writeFileSync(`${prefix}-${k}.json`, JSON.stringify(s));
    console.error(`start ${k} ${side} ${kind} T${s.turnNumber} clicks ${s[side].clicks} credits ${s[side].credits}`);
    const t = performance.now();
    const out = f();
    console.error(`done ${k} ${side} ${kind} ${Math.round(performance.now() - t)} ms -> ${JSON.stringify(out)?.slice(0, 160)}`);
    return out;
  };
  return new Proxy(inner, {
    get(target, prop, recv) {
      const v = Reflect.get(target, prop, recv);
      if (typeof v !== 'function' || prop === 'side') return v;
      return (...args: unknown[]) => (args[0] && typeof args[0] === 'object' && 'turnNumber' in (args[0] as object))
        ? timed(String(prop), args[0] as GameState, () => v.apply(target, args))
        : v.apply(target, args);
    },
  }) as Agent;
};
const game = new GameRunner(start, { corp: wrap('corp'), runner: wrap('runner') });
for (let i = 0; i < Number(process.env.STEPS ?? 60) && game.step(); i++);
void (null as unknown as CardInstance);
