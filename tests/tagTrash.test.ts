import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { GameState, cardDef, createCardInstance, executeAction, findCardAnywhere } from '../src/core';
import { HeuristicCorpAI } from '../src/ai/corpAI';
import { createAgent } from '../src/ai';
import { asSide, tuning } from '../src/ai/synergy';

/**
 * Jeff (2026-11-04, playing Sebastião Souza Pessoa against the Hard Corp): the Corp never trashed any of his
 * connection resources while he was tagged. Three things kept it from the basic trash action (rule 4.4.1):
 * - plan.tagTrashNow: a tag was worth this turn's trash, so holding the tag looked as good as using it;
 * - plan.ownTrashRisk: the Corp priced a tagged Runner's resources with the risk of its own trash action;
 * - plan.hqTrashCost: Sebastião's extra cost (a card from HQ) was priced at the flat worth of a card in hand.
 *
 * Position: bug report #13's game moved to a Corp turn (Corp identity Jinteki: Restoring Humanity): Sebastião tagged with Manuel Lattes de Moura,
 * Lago Paranoá Shelter and Arruaceiras Crew installed; the Corp has 8 credits and HQ Doomscroll,
 * Offworld Office and two Pings, 2 clicks left.
 */
function position(): GameState {
  const s: GameState = JSON.parse(readFileSync(new URL('./fixtures/bug-report-13-synapse.json', import.meta.url), 'utf8'));
  s.pendingPrompts = [];
  s.activePlayer = 'corp';
  s.turnStep = undefined;
  s.corp.clicks = 2;
  s.corp.credits = 8;
  s.runner.tags = 1;
  s.turnNumber = 3;
  // Synapse Global's own tag ability (remove 1 tag: gain 2 credits) is a different choice; a plain Corp identity here
  const id = createCardInstance(s, '30043'); // Jinteki: Restoring Humanity
  id.isRezzed = true;
  s.corp.identity = id;
  for (const code of ['30055', '30055']) s.corp.hq.push(createCardInstance(s, code)); // two spare Pings to pay Sebastião with
  for (const code of ['34075', '34009', '34073']) {
    const c = createCardInstance(s, code);
    c.isRezzed = true;
    c.faceUp = true;
    s.runner.rig.resources.push(c);
  }
  return s;
}

const title = (s: GameState, id: string) => cardDef(findCardAnywhere(s, id)!).title;

/** The Corp's main actions, best first, as the deck-aware rule-based AI ranks them. */
function ranked(s: GameState): string[] {
  return asSide('corp', () => new HeuristicCorpAI({ synergy: true, planner: false }).rankMainActions(s)).map(r =>
    r.action.type === 'TRASH_RESOURCE' ? `trash ${title(s, r.action.cardInstanceId)}` : r.action.type,
  );
}

const PLANS = ['tagTrashNow', 'ownTrashRisk', 'hqTrashCost'] as const;
const before = (list: string[], a: string, b: string) => list.indexOf(a) >= 0 && list.indexOf(a) < list.indexOf(b);

describe('the Corp trashes a tagged Sebastião’s connections (plan.tagTrashNow, ownTrashRisk, hqTrashCost)', () => {
  it('trashing Manuel Lattes de Moura beats a click for a credit or a card, and pays with a spare Ping', () => {
    const s = position();
    const list = ranked(s);
    expect(before(list, 'trash Manuel Lattes de Moura', 'GAIN_CREDIT')).toBe(true);
    expect(before(list, 'trash Manuel Lattes de Moura', 'DRAW_CARD')).toBe(true);
    let after = executeAction(s, { type: 'TRASH_RESOURCE', player: 'corp', cardInstanceId: s.runner.rig.resources[0].instanceId });
    after = executeAction(after, createAgent('corp', 'normal').chooseAction(after));
    expect(after.runner.rig.resources.map(c => cardDef(c).title)).not.toContain('Manuel Lattes de Moura');
    expect(after.corp.hq.map(c => cardDef(c).title).sort()).toEqual(['Doomscroll', 'Offworld Office', 'Ping']);
  });

  it('without the plans trashing ranked below a credit or a card', () => {
    for (const p of PLANS) tuning.plan[p] = false;
    try {
      const list = ranked(position());
      expect(before(list, 'trash Manuel Lattes de Moura', 'GAIN_CREDIT')).toBe(false);
      expect(before(list, 'trash Manuel Lattes de Moura', 'DRAW_CARD')).toBe(false);
    } finally {
      for (const p of PLANS) tuning.plan[p] = true;
    }
  });
});
