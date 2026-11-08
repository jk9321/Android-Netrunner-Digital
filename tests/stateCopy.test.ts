import { describe, expect, it } from 'vitest';
import { createInitialGameState, executeAction, getLegalActions, GameState } from '../src/core';
import { DECKS, deckGameSetup } from '../src/data/decks';

// executeAction copies the state with a plain deep copy (copyPlain, gameEngine.ts), not structuredClone, for speed
// (structuredClone was 24% of AI self-play time; the copy cut a games=1 batch's wall time 15%, byte-identical, 2026-11-07).
// That is only right while a state is plain data: these pin it.

function walk(v: unknown, path: string, visit: (o: object, path: string) => void) {
  if (typeof v !== 'object' || v === null) return;
  visit(v, path);
  for (const [k, x] of Object.entries(v)) walk(x, `${path}.${k}`, visit);
}

/** Plays `steps` actions (the first legal one each time, the Corp's or the Runner's), keeping every state. */
function play(steps: number): GameState[] {
  const corp = DECKS.find(d => d.side === 'corp')!;
  const runner = DECKS.find(d => d.side === 'runner')!;
  const states = [createInitialGameState(deckGameSetup(4242, corp, runner))];
  for (let i = 0; i < steps; i++) {
    const s = states[states.length - 1];
    if (s.winner) break;
    const actions = [...getLegalActions(s, 'corp'), ...getLegalActions(s, 'runner')].filter(a => a.type !== 'CONCEDE');
    if (!actions.length) break;
    states.push(executeAction(s, actions[i % actions.length]));
  }
  return states;
}

describe('executeAction state copy', () => {
  const states = play(120);

  it('holds only plain objects and arrays (no Map, Set, Date, class instance or function)', () => {
    expect(states.length).toBeGreaterThan(50);
    for (const s of states) {
      walk(s, 'state', (o, path) => {
        const proto = Object.getPrototypeOf(o);
        expect(proto === Object.prototype || proto === Array.prototype || proto === null, path).toBe(true);
      });
      walk(s, 'state', o => Object.values(o).forEach(x => expect(typeof x).not.toBe('function')));
    }
  });

  it('shares no object with the state before it, apart from log entries', () => {
    for (let i = 1; i < states.length; i++) {
      const before = new Set<object>();
      const { log: oldLog, ...oldRest } = states[i - 1];
      walk(oldRest, 'prev', o => before.add(o));
      const { log, ...rest } = states[i];
      walk(rest, 'next', (o, path) => expect(before.has(o), path).toBe(false));
      expect(log).not.toBe(oldLog);
    }
  });
});
