import { describe, expect, it } from 'vitest';
import { createCardInstance, executeAction, GameState, knownInHand } from '../src/core';
import { answer, cont, giveCard, installCorpForTest, keepGoing, newGame, passTurn, play, run, setIdentity, startRunnerTurn } from './helpers';

// Rules 1.21.3: a revealed card is shown, then returns to its previous state.
// It stays hidden in the hand; the other side only remembers it.
const muslihat = '35013';
const peerReview = '35055';
const touchUps = '35067';
const idio = '35061';
const SG = { cleaver: '30006', sureGamble: '30030', hedgeFund: '30075', palisade: '30072' };

const choose = (s: GameState, optionId: string) => keepGoing(answer(s, { kind: 'effect_choice', optionId }));
const pick = (s: GameState, ids: string[]) => keepGoing(answer(s, { kind: 'effect_cards', cardInstanceIds: ids }));
const known = (s: GameState, side: 'corp' | 'runner') => knownInHand(s, side).map(c => c.instanceId);
function playCorp(s: GameState, code: string, clicks: number): GameState {
  s.activePlayer = 'corp';
  s.phase = 'corp_turn';
  s.corp.clicks = clicks;
  s.corp.credits += 10;
  return play(s, 'corp', giveCard(s, 'corp', code));
}

describe('cards known in the opponent\'s hand', () => {
  it('MuslihaT: the revealed breaker is known to the Corp until it leaves the grip', () => {
    let s = newGame();
    setIdentity(s, 'runner', muslihat);
    const cleaver = createCardInstance(s, SG.cleaver);
    s.runner.stack.unshift(cleaver);
    s = passTurn(s);
    s = choose(s, 'take');
    expect(known(s, 'runner')).toEqual([cleaver.instanceId]);
    expect(known(s, 'corp')).toEqual([]);
    s.runner.credits += 10;
    s = executeAction(s, { type: 'INSTALL_CARD', player: 'runner', cardInstanceId: cleaver.instanceId });
    expect(known(s, 'runner')).toEqual([]);
  });

  it('Peer Review: every revealed HQ card is known, the hidden one is not', () => {
    const s0 = newGame();
    const hidden = createCardInstance(s0, SG.hedgeFund);
    const shown = createCardInstance(s0, SG.palisade);
    s0.corp.hq = [hidden, shown];
    const s = playCorp(s0, peerReview, 1);
    expect(known(s, 'corp')).toEqual([shown.instanceId]);
  });

  it('Touch-ups: the whole grip is known, minus the cards shuffled away', () => {
    const s0 = newGame();
    const target = installCorpForTest(s0, idio, 'remote1');
    const gamble = createCardInstance(s0, SG.sureGamble);
    const cleaver = createCardInstance(s0, SG.cleaver);
    s0.runner.grip = [gamble, cleaver];
    let s = playCorp(s0, touchUps, 2);
    s = pick(s, [target]);
    s = choose(s, 'event');
    s = pick(s, [gamble.instanceId]);
    expect(known(s, 'runner')).toEqual([cleaver.instanceId]);
  });

  it('an HQ card the Runner accessed and left is known; a card drawn later is not', () => {
    const s0 = newGame();
    const fund = createCardInstance(s0, SG.hedgeFund);
    s0.corp.rd.push(...s0.corp.hq.splice(0));
    s0.corp.hq = [fund];
    startRunnerTurn(s0);
    let s = cont(run(s0, 'hq'));
    for (let i = 0; i < 10 && s.pendingPrompts.length > 0; i++) {
      s = s.pendingPrompts[0].kind === 'access_trash' ? answer(s, { kind: 'access_trash', trash: false }) : cont(s);
    }
    expect(known(s, 'corp')).toEqual([fund.instanceId]);
    s = passTurn(s); // Corp mandatory draw adds an unknown card
    expect(s.corp.hq.length).toBe(2);
    expect(known(s, 'corp')).toEqual([fund.instanceId]);
  });
});
