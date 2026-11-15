import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { GameState, actingSide, activePrompt, cardDef, createCardInstance, executeAction, findCardAnywhere, getLegalActions } from '../src/core';
import { createAgent } from '../src/ai';
import { answerPrompt, shufflesArchivesIntoRD } from '../src/ai/prompts';
import { giveCard, installCorpForTest, newGame, rezForTest, scoreForTest, useAbility, answer } from './helpers';

/**
 * ai-prompt-time (Jeff and the AI Coordinator 2026-11-15 15:20Z): one answer for every Corp prompt that shuffles the
 * Corp's own Archives cards into R&D. Agendas first (most points first), then the cards most worth drawing again (keep),
 * up to the prompt's maximum, with no board scored. Descent with an agenda in HQ stays on the generic route.
 * Card texts: Spin Doctor (30053), Longevity Serum (30044), Descent (34125); no rule changes (card behaviour untouched).
 */
const C = { spinDoctor: '30053', longevity: '30044', descent: '34125', offworld: '30067', sendAMessage: '30069', hedgeFund: '30075', palisade: '30072', regolith: '30071' };

const corpTurn = (s: GameState) => {
  s.activePlayer = 'corp';
  s.phase = 'corp_turn';
  s.turnStep = null;
  s.corp.clicks = 3;
};
const archive = (s: GameState, code: string, faceUp = false) => {
  const c = createCardInstance(s, code);
  (faceUp ? s.corp.archives.faceUp : s.corp.archives.faceDown).push(c);
  return c.instanceId;
};
const picked = (s: GameState) => {
  const a = answerPrompt(s, 'corp', undefined, true) as { choice: { kind: string; cardInstanceIds: string[] } };
  expect(a.choice.kind).toBe('effect_cards');
  return a.choice.cardInstanceIds;
};
/** HQ emptied and R&D left without agendas, so Descent's draw brings none in. */
const noAgendaDraws = (s: GameState) => {
  s.corp.rd.push(...s.corp.hq.splice(0));
  s.corp.rd = s.corp.rd.filter(c => cardDef(c).type_code !== 'agenda');
};
const titles = (s: GameState, ids: string[]) => ids.map(id => cardDef(findCardAnywhere(s, id)!).title);

describe('shuffling Archives cards into R&D', () => {
  it('Spin Doctor: the agenda first, then the card most worth drawing, two cards in all', () => {
    let s = newGame();
    corpTurn(s);
    const id = installCorpForTest(s, C.spinDoctor, 'remote-1');
    s = rezForTest(s, id);
    corpTurn(s);
    const agenda = archive(s, C.offworld, true);
    archive(s, C.palisade);
    archive(s, C.regolith);
    archive(s, C.hedgeFund);
    archive(s, C.hedgeFund);
    s = useAbility(s, 'corp', id);
    const p = activePrompt(s)!;
    expect(p.kind === 'effect_cards' && shufflesArchivesIntoRD(s, p)).toBe(true);
    const ids = picked(s);
    expect(ids).toHaveLength(2);
    expect(ids[0]).toBe(agenda);
  });

  it('Spin Doctor on deal 2041 (12 cards in Archives, no agenda): the two cards keep prices highest, without scoring 79 boards', () => {
    const s: GameState = JSON.parse(readFileSync(new URL('./fixtures/spin-doctor-archives-2041.json', import.meta.url), 'utf8'));
    const t = performance.now();
    expect(titles(s, picked(s))).toEqual(['Hansei Review', 'Hansei Review']);
    expect(performance.now() - t).toBeLessThan(5_000);
  });

  it('Longevity Serum: after the HQ trash, the shuffle takes agendas by points, then up to 3', () => {
    let s = newGame();
    corpTurn(s);
    const three = archive(s, C.sendAMessage);
    const two = archive(s, C.offworld, true);
    archive(s, C.hedgeFund);
    archive(s, C.palisade);
    archive(s, C.regolith);
    s = scoreForTest(s, C.longevity);
    s = answer(s, { kind: 'effect_cards', cardInstanceIds: [] }); // the HQ trash step stays on its own route
    const p = activePrompt(s)!;
    expect(p.kind === 'effect_cards' && p.source.step).toBe('shuffle');
    expect(p.kind === 'effect_cards' && shufflesArchivesIntoRD(s, p)).toBe(true);
    const ids = picked(s);
    expect(ids).toHaveLength(3);
    expect(ids.slice(0, 2)).toEqual([three, two]);
  });

  it('Descent: with only Archives agendas it takes both, most points first; with an agenda in HQ it is not this prompt', () => {
    let s = newGame();
    noAgendaDraws(s);
    corpTurn(s);
    const two = archive(s, C.offworld, true);
    const three = archive(s, C.sendAMessage);
    let d = giveCard(s, 'corp', C.descent);
    s = useAbility(s, 'corp', d);
    let p = activePrompt(s)!;
    expect(p.kind === 'effect_cards' && shufflesArchivesIntoRD(s, p)).toBe(true);
    expect(picked(s)).toEqual([three, two]);

    let t = newGame();
    noAgendaDraws(t);
    corpTurn(t);
    archive(t, C.offworld, true);
    giveCard(t, 'corp', C.sendAMessage);
    d = giveCard(t, 'corp', C.descent);
    t = useAbility(t, 'corp', d);
    p = activePrompt(t)!;
    expect(p.kind === 'effect_cards' && p.candidateIds.length).toBe(2);
    expect(p.kind === 'effect_cards' && shufflesArchivesIntoRD(t, p)).toBe(false);
  });

  /**
   * Pin (AI Coordinator 2026-11-15 16:36Z): the family answer can leave Spin Doctor unused on the Corp's turn with an
   * agenda in Archives (human report-23 T9), which is acceptable only because the Corp still uses it in the paid ability
   * window of the Movement Phase (rules 6.9.4e) when the Runner runs Archives, shuffling the agenda back before the breach
   * (6.9.5b). With no agenda in Archives it passes. The same window is the last one before the Runner accesses (and can
   * trash) Spin Doctor in its own server: the Success Phase (6.9.5) and the access (7.1) open no paid ability window.
   */
  const runOn = (server: 'archives' | 'remote-1', agenda: boolean) => {
    let s = newGame(3);
    corpTurn(s);
    const spin = installCorpForTest(s, C.spinDoctor, 'remote-1');
    s = rezForTest(s, spin);
    const sam = agenda ? archive(s, C.sendAMessage, true) : undefined;
    archive(s, C.hedgeFund);
    archive(s, C.hedgeFund);
    archive(s, C.palisade);
    s.corp.credits = 8;
    s.corp.clicks = 0;
    s.runner.credits = 10;
    s.activePlayer = 'runner';
    s.phase = 'runner_turn';
    s.runner.clicks = 4;
    s = executeAction(s, { type: 'INITIATE_RUN', player: 'runner', targetServerId: server });
    const corp = createAgent('corp', 'normal');
    for (let i = 0; i < 40 && (s.activeRun || s.pendingPrompts.length > 0); i++) {
      const side = actingSide(s)!;
      const legal = getLegalActions(s, side);
      const trash = activePrompt(s)?.kind === 'access_trash' ? legal.find(a => (a as { choice?: { trash?: boolean } }).choice?.trash === true) : undefined;
      s = executeAction(s, side === 'corp' ? corp.chooseAction(s) : (trash ?? legal.find(a => /PASS|CONTINUE/.test(a.type)) ?? legal[0]));
    }
    return { s, spin, sam };
  };
  const archivesRun = (agenda: boolean) => runOn('archives', agenda);

  it('Spin Doctor: when the Runner runs Archives with an agenda there, the Corp uses it in the approach window and shuffles the agenda', () => {
    const { s, spin, sam } = archivesRun(true);
    expect(s.removedFromGame.map(c => c.instanceId)).toContain(spin);
    expect(s.corp.rd.map(c => c.instanceId)).toContain(sam);
    expect(s.runner.scoreArea).toHaveLength(0);
  }, 60_000);

  it('Spin Doctor: with no agenda in Archives the Corp passes in that window', () => {
    const { s, spin } = archivesRun(false);
    expect(s.removedFromGame.map(c => c.instanceId)).not.toContain(spin);
  }, 60_000);

  it('Spin Doctor: when the Runner runs its own server (able to trash it) with an agenda in Archives, the Corp uses it first', () => {
    const { s, spin, sam } = runOn('remote-1', true);
    expect(s.removedFromGame.map(c => c.instanceId)).toContain(spin);
    expect(s.corp.rd.map(c => c.instanceId)).toContain(sam);
  }, 60_000);
});
