import { describe, expect, it } from 'vitest';
import { executeAction, GameState, Prompt, PromptChoice } from '../src/core';
import { giveCard, installCorpForTest, installIceForTest, newGame, run, startRunnerTurn, step } from './helpers';

const URTICA = '30045';
const PING = '30055';
const SEND_A_MESSAGE = '30069';
const SURE_GAMBLE = '30030';

/** Plays the run out: the Runner breaks nothing, trashes nothing; `corp` answers the Corp's prompts. */
function drive(s: GameState, corp: (p: Prompt) => PromptChoice | undefined = () => undefined): GameState {
  for (let i = 0; i < 100 && (s.activeRun || s.pendingPrompts.length); i++) {
    const p = s.pendingPrompts[0];
    if (!p) {
      s = step(s);
      continue;
    }
    const choice: PromptChoice =
      (p.side === 'corp' ? corp(p) : undefined) ??
      (p.kind === 'access_trash'
        ? { kind: 'access_trash', trash: false }
        : p.kind === 'access_order'
          ? { kind: 'access_order', optionId: p.options[0].id }
          : p.kind === 'effect_cards'
            ? { kind: 'effect_cards', cardInstanceIds: [] }
            : p.kind === 'effect_choice'
              ? { kind: 'effect_choice', optionId: p.options.find(o => o.id === 'no')?.id ?? p.options[0].id }
              : (() => {
                  throw new Error(`Unhandled prompt ${p.kind}`);
                })());
    s = executeAction(s, { type: 'RESOLVE_PROMPT', player: p.side, promptId: p.id, choice });
  }
  return s;
}

// Rules 9.3.2c: "while" is a static condition. Urtica Cipher: "When the Runner accesses this
// asset while it is installed, do 2 net damage plus 1 net damage for each hosted advancement counter."
describe('Urtica Cipher', () => {
  const runnerHand = (s: GameState) => {
    startRunnerTurn(s);
    s.runner.grip = [];
    for (let i = 0; i < 4; i++) giveCard(s, 'runner', SURE_GAMBLE);
  };

  it('does its damage when accessed installed', () => {
    const s0 = newGame();
    installCorpForTest(s0, URTICA, 'remote-1');
    runnerHand(s0);
    expect(drive(run(s0, 'remote-1')).runner.grip).toHaveLength(2);
  });

  it('does nothing when accessed in HQ', () => {
    const s0 = newGame();
    s0.corp.hq = [];
    giveCard(s0, 'corp', URTICA);
    runnerHand(s0);
    expect(drive(run(s0, 'hq')).runner.grip).toHaveLength(4);
  });

  it('does nothing when accessed in R&D', () => {
    const s0 = newGame();
    const u = giveCard(s0, 'corp', URTICA);
    s0.corp.rd.unshift(s0.corp.hq.splice(s0.corp.hq.findIndex(c => c.instanceId === u), 1)[0]);
    runnerHand(s0);
    expect(drive(run(s0, 'rd')).runner.grip).toHaveLength(4);
  });
});

// Ping: "When you rez this ice during a run against this server, give the Runner 1 tag." Rules 8.1.2b:
// card abilities can rez cards at other times, and any such rez during that run meets the condition.
describe('Ping rezzed by Send a Message', () => {
  function stealSendAMessage(pingServer: string) {
    const s0 = newGame();
    const ping = installIceForTest(s0, PING, pingServer, false);
    installCorpForTest(s0, SEND_A_MESSAGE, 'remote-1');
    startRunnerTurn(s0);
    const s = drive(run(s0, 'remote-1'), p =>
      p.kind === 'effect_cards' && p.candidateIds.includes(ping) ? { kind: 'effect_cards', cardInstanceIds: [ping] } : undefined,
    );
    expect(s.runner.scoreArea.map(c => c.cardCode)).toContain(SEND_A_MESSAGE);
    expect(s.corp.servers[pingServer].ice.find(c => c.instanceId === ping)!.isRezzed).toBe(true);
    return s;
  }

  it('tags the Runner when Ping protects the attacked server', () => {
    expect(stealSendAMessage('remote-1').runner.tags).toBe(1);
  });

  it('no tag when Ping is on another server', () => {
    expect(stealSendAMessage('hq').runner.tags).toBe(0);
  });
});
