import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { createCardInstance, createInitialGameState, createRng, executeAction, GameAction, GameState, getCardDefinition, nextFloat } from '../src/core';
import { certainInHand, updateHandKnowledge } from '../src/core/engine/helpers';
import { knownInRd, runnerSeesRd, shuffleRD, updateRdKnowledge } from '../src/core/engine/rdKnowledge';
import { deckGameSetup } from '../src/data/decks';
import { dealFallbacks, dealRunnerUnknowns, guessRunnerView } from '../src/ai/runnerReply';
import { frameChecks } from '../src/ai/pricing';
import { cardsByZone, checkInvariants, FUZZ_DECKS } from '../scripts/engine-fuzz-check';
import { newGame } from './helpers';
import '../src/ai';

// R-109 (B4a follow-up). An R&D card the Runner knows of may be drawn without being seen (a draw among cards it can't
// tell apart marks it left 'hq'); from then on it may be any HQ card, so an HQ card that leaves unseen could be it
// (rules 1.12.3; 4.6.6d: a card installed facedown stays hidden). The mark counts those departures and the card joins
// the cards known in HQ carrying them, so it is never certain in HQ after it may have left. Before the fix it joined as
// certain, the Runner's deal kept a Funhouse in HQ that was installed as ice, and the deal threw (NRDB g1 seed 1471).

const SG = { hedgeFund: '30075', palisade: '30072', funhouse: '30054' };

function act(s: GameState, change: (next: GameState) => void): GameState {
  const next = structuredClone(s);
  change(next);
  updateRdKnowledge(s, next);
  updateHandKnowledge(s, next);
  return next;
}

describe('an R&D card that may have been drawn unseen', () => {
  it('counts the HQ cards that leave unseen and joins HQ with them: installed as ice, it is not certain in HQ (1.12.3, 4.6.6d)', () => {
    const s0 = newGame();
    const fun = createCardInstance(s0, SG.funhouse);
    s0.corp.rd = [createCardInstance(s0, SG.hedgeFund), fun, createCardInstance(s0, SG.palisade)];
    let s = act(s0, n => runnerSeesRd(n, fun));
    s = act(s, n => shuffleRD(n)); // the Runner knows it is one of the 3, not which
    s = act(s, n => n.corp.hq.push(n.corp.rd.splice(n.corp.rd.findIndex(c => c.instanceId === fun.instanceId), 1)[0]));
    expect(s.corp.rdKnownToRunner?.[0]).toMatchObject({ id: fun.instanceId, left: 'hq' });
    s = act(s, n => {
      const c = n.corp.hq.splice(n.corp.hq.findIndex(x => x.instanceId === fun.instanceId), 1)[0];
      n.corp.servers.hq.ice.push(c); // installed facedown: the Runner sees an ice leave HQ, not which card
    });
    expect(s.corp.rdKnownToRunner?.[0].lost).toEqual({ ice: 1 });
    s = act(s, n => n.corp.hq.push(...n.corp.rd.splice(0)));
    expect(knownInRd(s)).toEqual([]);
    expect(s.corp.knownToRunner).toContainEqual({ id: fun.instanceId, code: SG.funhouse, lost: { ice: 1 } });
    expect(certainInHand(s, 'corp')).toEqual([]);
  });

  it('a mark drawn while no HQ card leaves still joins as certain', () => {
    const s0 = newGame();
    const fun = createCardInstance(s0, SG.funhouse);
    s0.corp.rd = [createCardInstance(s0, SG.hedgeFund), fun];
    let s = act(s0, n => runnerSeesRd(n, fun));
    s = act(s, n => shuffleRD(n));
    s = act(s, n => n.corp.hq.push(...n.corp.rd.splice(0)));
    expect(certainInHand(s, 'corp')).toEqual([[SG.funhouse, 1]]);
  });
});

describe('NRDB g1 seed 1471: the capture that threw', () => {
  const cap = JSON.parse(readFileSync(new URL('./fixtures/nrdb-1471-drawn-mark-acts.json', import.meta.url), 'utf8')) as { seed: number; corpDeck: string; runnerDeck: string; acts: GameAction[] };
  it('replays with no known-hidden-certain failure, and the Runner deals every guess', () => {
    const corp = FUZZ_DECKS.find(d => d.side === 'corp' && d.name === cap.corpDeck)!;
    const runner = FUZZ_DECKS.find(d => d.side === 'runner' && d.name === cap.runnerDeck)!;
    let s = createInitialGameState(deckGameSetup(cap.seed, corp, runner));
    const ids = new Set(cardsByZone(s).map(x => x.card.instanceId));
    const failures: string[] = [];
    cap.acts.forEach((a, i) => {
      const prev = s;
      s = executeAction(s, a);
      for (const f of checkInvariants(s, prev, ids).failures) failures.push(`${i} ${f.check}: ${f.detail}`);
    });
    expect(failures).toEqual([]);
    // The Funhouse (inst-42) was installed as ice; the Runner can't know it left HQ, so it is not certain there
    expect(s.corp.servers['remote-6'].ice.map(c => c.instanceId)).toContain('inst-42');
    expect(certainInHand(s, 'corp').find(([code]) => code === SG.funhouse)).toBeUndefined();
    for (let k = 0; k < 8; k++) expect(() => guessRunnerView(s, k)).not.toThrow();
  });
});

describe('the deal\'s safety net (R-109): a knowledge bug falls back to an unkept deal in play, and throws in the tests', () => {
  /** A board whose HQ list claims the one unrezzed ice is in HQ: the deal keeps it there and the ice slot finds no ice. */
  function wrong(): GameState {
    const s = newGame();
    const wall = createCardInstance(s, SG.palisade);
    s.corp.hq = [createCardInstance(s, SG.hedgeFund)];
    s.corp.rd = [createCardInstance(s, SG.hedgeFund)]; // no other ice for the ice slot to take
    s.corp.servers.hq.ice.push(wall);
    s.corp.knownToRunner = [{ id: wall.instanceId, code: SG.palisade }];
    return s;
  }
  const deal = (s: GameState) => {
    const v = structuredClone(s);
    const rng = createRng(5);
    dealRunnerUnknowns(v, () => nextFloat(rng));
    return v;
  };

  it('throws with the tripwire on (tests/setup.ts, the fuzzer)', () => {
    expect(frameChecks.on).toBe(true);
    expect(() => deal(wrong())).toThrow(/a slot found no code/);
  });

  it('in play it deals again without the knowledge, counts it and logs it', () => {
    const was = dealFallbacks.count;
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    frameChecks.on = false;
    try {
      const v = deal(wrong());
      expect(dealFallbacks.count).toBe(was + 1);
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('[deal-fallback]'));
      expect(getCardDefinition(v.corp.servers.hq.ice[0].cardCode).type_code).toBe('ice');
      expect(v.corp.hq).toHaveLength(1);
      // A board with nothing wrong never falls back
      const ok = newGame();
      deal(ok);
      expect(dealFallbacks.count).toBe(was + 1);
    } finally {
      frameChecks.on = true;
      warn.mockRestore();
    }
  });
});
