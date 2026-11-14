import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { GameState, cardDef, executeAction } from '../src/core';
import { createAgent } from '../src/ai';


/**
 * Jeff's bug report #13 (2026-11-04; Synapse Global vs Sebastião, Hard Corp): on turn 1 the Runner
 * removed a tag with Friend of a Friend. Synapse Global ("The first time each turn a tag is removed,
 * you may reveal and install 1 card from HQ, ignoring all costs") fired, but the Corp installed
 * nothing, with Doomscroll in HQ and R&D bare. The board score priced a card leaving HQ above
 * unrezzed ice the Corp can't rez yet (2 credits, Doomscroll costs 3).
 *
 * The fixture is the report's end state with the tag put back and removed again, so the Synapse
 * prompt is open (HQ: Doomscroll, Offworld Office).
 */
const fixture = (): GameState => JSON.parse(readFileSync(new URL('./fixtures/bug-report-13-synapse.json', import.meta.url), 'utf8'));

function answerAll(s: GameState, agent = createAgent('corp', 'normal')): GameState {
  for (let i = 0; i < 4 && s.pendingPrompts[0]?.side === 'corp'; i++) s = executeAction(s, agent.chooseAction(s));
  return s;
}

describe('Synapse Global free install (plan.freeInstallPick, bug report #13)', () => {
  it('installs Doomscroll on bare R&D, and never reveals the agenda (Normal and Hard)', () => {
    for (const agent of [createAgent('corp', 'normal'), createAgent('corp', 'hard', { samples: 6, seed: 1 })]) {
      const s = answerAll(fixture(), agent);
      expect(s.corp.servers.rd.ice.map(c => cardDef(c).title)).toEqual(['Doomscroll']);
      expect(s.corp.hq.map(c => cardDef(c).title)).toEqual(['Offworld Office']);
    }
  });
});
