/**
 * "The first time each turn X" is an ordinal trigger condition (rules 9.3.2b): it is met by the turn's first X in the
 * game, not the first X the card saw. A card that becomes active after that X does not take a later X for the first
 * (rules 9.6.5b; the Virtuoso example under rules 10.11.5 treats "the first time this turn" as counting from the start
 * of the turn, with the mark as the stated exception). The engine counts each condition all turn (CardScript.firstEachTurn).
 */
import { describe, expect, it } from 'vitest';
import { cardDef, GameState } from '../src/core';
import { getCardScript, scriptedCardCodes } from '../src/core/scripts';
import { answer, cont, giveCard, keepGoing, newGame, play, run, runnerInstall, startRunnerTurn } from './helpers';

const KNICKKNACK = '35033';
const TELEWORK = '30027';
const TOUCHSTONE = '36021';
const LILYPAD = '34023';
const CREATIVE_COMMISSION = '30020';
const LEECH = '30008';
const MAYFLY = '30032';

const emptyHQ = (s: GameState) => s.corp.rd.push(...s.corp.hq.splice(0));
function declineAll(s: GameState): GameState {
  for (let guard = 0; guard < 20 && s.pendingPrompts.length; guard++) {
    const p = s.pendingPrompts[0];
    if (p.kind === 'access_trash') s = answer(s, { kind: 'access_trash', trash: false });
    else if (p.kind === 'effect_choice') s = answer(s, { kind: 'effect_choice', optionId: p.options.find(o => o.id === 'no')?.id ?? p.options[p.options.length - 1].id });
    else if (p.kind === 'effect_cards') s = answer(s, { kind: 'effect_cards', cardInstanceIds: [] });
    else break;
    s = keepGoing(s);
  }
  return s;
}

describe('"the first time each turn" counts the turn, not the card (rules 9.3.2b, 9.6.5b, 10.11.5)', () => {
  it('Knickknack installed after the turn\'s first run does not trigger on the second run', () => {
    let s = newGame();
    emptyHQ(s);
    [s] = runnerInstall(s, TELEWORK);
    s = declineAll(cont(run(s, 'archives')));
    expect(s.activeRun).toBeNull();
    [s] = runnerInstall(s, KNICKKNACK);
    s = run(s, 'archives');
    expect(s.pendingPrompts).toHaveLength(0);
  });

  it('Knickknack installed before any run still triggers on the turn\'s first run', () => {
    let s = newGame();
    emptyHQ(s);
    [s] = runnerInstall(s, TELEWORK);
    [s] = runnerInstall(s, KNICKKNACK);
    s = run(s, 'archives');
    expect(s.pendingPrompts[0]?.side).toBe('runner');
  });

  it('Touchstone installed after the turn\'s first event gets no credit from the second', () => {
    let s = newGame();
    startRunnerTurn(s);
    s.runner.credits = 10;
    s = play(s, 'runner', giveCard(s, 'runner', CREATIVE_COMMISSION));
    let touchstone: string;
    [s, touchstone] = runnerInstall(s, TOUCHSTONE);
    s.runner.clicks = 2;
    s = play(s, 'runner', giveCard(s, 'runner', CREATIVE_COMMISSION));
    const card = s.runner.rig.hardware.find(c => c.instanceId === touchstone)!;
    expect(card.tokens.credit ?? 0).toBe(0);
  });

  it('LilyPAD installed after the turn\'s first program install offers no draw on the second', () => {
    let s = newGame();
    [s] = runnerInstall(s, LEECH);
    [s] = runnerInstall(s, LILYPAD);
    [s] = runnerInstall(s, MAYFLY);
    expect(s.pendingPrompts).toHaveLength(0);
  });

  it('LilyPAD installed first offers the draw on the turn\'s first program install', () => {
    let s = newGame();
    [s] = runnerInstall(s, LILYPAD);
    [s] = runnerInstall(s, LEECH);
    expect(s.pendingPrompts[0]?.side).toBe('runner');
  });

  it('every scripted "first time each turn" card names its condition, unless it reads a turn-wide count already', () => {
    // Identities are active all game; the others already read a turn-wide count, or the occurrence is the card's own.
    const exempt = new Set([
      '30001', // René "Loup" Arcemont (identity)
      '30013', // Docklands Pass: TurnFlag.hqBreaches
      '30034', // Verbal Plasticity: TurnFlag.basicDraws
      '30051', // NBN: Reality Plus (identity)
      '34039', // A Teia (identity)
      '34041', // Front Company: its first-run blocker reads runsThisTurn; its Archives trigger is counted
      '34048', // Epiphany Analytica (identity)
      '35001', // Ryō "Phoenix" Ōno (identity)
      '35057', // Nebula Talent Management (identity)
      '35058', // Synapse Global (identity)
      '35069', // The Zwicky Group (identity)
      '36046', // Editorial Division (identity)
      '36056', // Sacrifice Zone Expansion: "you advance this agenda", an occurrence of this card only
    ]);
    const missing = scriptedCardCodes().filter(code => {
      const def = cardDef({ cardCode: code } as never);
      const text = (def as { text?: string }).text ?? '';
      return /first time each turn/i.test(text) && !exempt.has(code) && !getCardScript(code)?.firstEachTurn;
    });
    expect(missing).toEqual([]);
  });
});
