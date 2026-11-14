import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { GameAction, GameState, cardDef } from '../src/core';
import { createAgent } from '../src/ai';
import { valueLoops } from '../src/ai/valueModel';

/**
 * Audit Step 0a (spec-step0-small-fixes.md; AI-PICK-PIPELINE, Gemini AI-REVERSE-BLUFF-CONSUMED). The reverse bluff (an
 * agenda alone in a new remote, at most once a game: corpAI nakedAgenda) is used up by the install the Corp actually
 * plays, not by the pick the counted layer rewrote. Fixtures: the Corp's state at the decision, written from self-play
 * deals 1241 (turn 6) and 1521 (turn 5), Normal v Normal.
 */
const read = (name: string): GameState => JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8'));
const decide = (s: GameState) => {
  valueLoops.clear();
  const corp = createAgent('corp', 'normal');
  const action = corp.chooseAction(s) as GameAction & { asNewRemote?: boolean };
  return { action, bluffed: (corp as unknown as { reverseBluffed: boolean }).reverseBluffed };
};

describe('reverse bluff bookkeeping (Step 0a)', () => {
  // The ranking picks Offworld Office into a new remote; the counted two-turn line plays an advance instead
  it('a bluff install the counted layer rewrote leaves the bluff unused', () => {
    const { action, bluffed } = decide(read('bluff-rewritten-1241-t6.json'));
    expect(action.type).toBe('ADVANCE_CARD');
    expect(bluffed).toBe(false);
  });

  // Send a Message goes alone into a new remote and is played as picked: the bluff is used
  it('a bluff install that is played uses the bluff up', () => {
    const s = read('bluff-played-1521-t5.json');
    const { action, bluffed } = decide(s);
    expect(action).toMatchObject({ type: 'INSTALL_CARD', asNewRemote: true });
    const card = s.corp.hq.find(c => c.instanceId === (action as { cardInstanceId?: string }).cardInstanceId)!;
    expect(cardDef(card).type_code).toBe('agenda');
    expect(bluffed).toBe(true);
  });
});
