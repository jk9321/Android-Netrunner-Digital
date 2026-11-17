/**
 * Two corpTurnDamage facts corrected (ai-winnow-reach; the AI Coordinator's answers, Q1): the text's "X" read as 0, so the
 * owner of a card's damage on the Corp's own turn (ownTurnDamage, registry V20) saw neither card.
 *   Neurospike (30049): "Do X net damage, where X is equal to the sum of the printed agenda points on agendas you scored
 *   this turn."
 *   Phật Gioan Baotixita (35051, ai-winnow-reach after the fire count): "The first time each turn an agenda is scored or
 *   stolen, you may remove up to 2 hosted power counters. Do 1 net damage plus 1 net damage for each power counter removed
 *   this way." The text read 3 whatever the counters.
 *   Mindscaping (34045): "Resolve 1 of the following: ... Do X net damage. X is equal to the number of tags the Runner
 *   has, up to 3."
 * Rule 10.4.2a: each net damage trashes 1 card from the grip at random, so the cards lost are the damage dealt.
 */
import { describe, expect, it } from 'vitest';
import { ALL_CARDS, GameState } from '../src/core';
import { TurnFlag } from '../src/core/engine/cardEffects';
import { ownTurnDamage } from '../src/ai/effectValues';
import { answer, giveCard, installCorpForTest, newGame, play, scoreForTest } from './helpers';

const NEUROSPIKE = '30049';
const PHAT_GIOAN = '35051';
const LONGEVITY_SERUM = '30044'; // agenda, 3 to advance, 2 points
const MINDSCAPING = '34045';
const SURE_GAMBLE = '30030';

describe('the own-turn damage facts are the engine (ai-winnow-reach)', () => {
  /** A Runner with a grip big enough to count the damage. */
  function bigGrip(s: GameState): void {
    s.runner.stack.push(...s.runner.grip.splice(0));
    for (let i = 0; i < 8; i++) giveCard(s, 'runner', SURE_GAMBLE);
  }

  it('Neurospike: after 0, 2 and 3 points scored this turn the fact is 0, 2, 3, and so is the damage dealt', () => {
    for (const scored of [[], ['30052'], ['30052', '30070']]) {
      let s = structuredClone(newGame(1));
      s.corp.rd.push(...s.corp.hq.splice(0));
      bigGrip(s);
      scored.forEach((code, i) => (s = scoreForTest(s, code, `remote-${i + 1}`)));
      while (s.pendingPrompts.length) s = answer(s, s.pendingPrompts[0].kind === 'effect_choice' ? { kind: 'effect_choice', optionId: 'no' } : { kind: 'effect_cards', cardInstanceIds: [] });
      const points = scored.reduce((n, code) => n + (ALL_CARDS.find(c => c.code === code)!.agenda_points ?? 0), 0);
      expect(s.turnFlags[TurnFlag.agendaPointsScored] ?? 0).toBe(points);
      const fact = ownTurnDamage(s, NEUROSPIKE);
      expect(fact).toBe(points);
      s.corp.credits = 10;
      s.corp.clicks = 3;
      const grip = s.runner.grip.length;
      const id = giveCard(s, 'corp', NEUROSPIKE);
      const after = play(s, 'corp', id);
      expect(grip - after.runner.grip.length).toBe(fact);
    }
  });

  it('Mindscaping: at 0, 1, 3 and 4 tags the fact is 0, 1, 3, 3, and so is the damage dealt', () => {
    for (const tags of [0, 1, 3, 4]) {
      const s = structuredClone(newGame(1));
      s.corp.rd.push(...s.corp.hq.splice(0));
      bigGrip(s);
      s.runner.tags = tags;
      const fact = ownTurnDamage(s, MINDSCAPING);
      expect(fact).toBe(Math.min(3, tags));
      s.corp.credits = 10;
      const grip = s.runner.grip.length;
      const id = giveCard(s, 'corp', MINDSCAPING);
      const after = answer(play(s, 'corp', id), { kind: 'effect_choice', optionId: 'damage' });
      expect(grip - after.runner.grip.length).toBe(fact);
    }
  });

  it('Phật Gioan Baotixita: with 0, 1, 2 and 3 power counters the fact is 1, 2, 3, 3, and so is the damage when an agenda is scored', () => {
    for (const power of [0, 1, 2, 3]) {
      let s = structuredClone(newGame(1));
      s.corp.rd.push(...s.corp.hq.splice(0));
      bigGrip(s);
      const id = installCorpForTest(s, PHAT_GIOAN, 'remote-9', true);
      s.corp.servers['remote-9'].root[0].tokens = { power };
      const fact = ownTurnDamage(s, PHAT_GIOAN);
      expect(fact).toBe(1 + Math.min(2, power));
      expect(id).toBeTruthy();
      const grip = s.runner.grip.length;
      s = scoreForTest(s, LONGEVITY_SERUM, 'remote-1');
      // The Corp removes as many counters as it may (the most damage)
      while (s.pendingPrompts.length && s.pendingPrompts[0].side === 'corp' && grip === s.runner.grip.length) {
        const p = s.pendingPrompts[0] as { options?: { id: string }[] };
        const most = p.options ? p.options[p.options.length - 1].id : undefined;
        s = most !== undefined ? answer(s, { kind: 'effect_choice', optionId: most }) : answer(s, { kind: 'effect_cards', cardInstanceIds: [] });
      }
      expect(grip - s.runner.grip.length).toBe(fact);
    }
  });
});
