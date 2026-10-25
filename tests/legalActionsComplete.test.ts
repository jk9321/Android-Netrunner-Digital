import { describe, expect, it } from 'vitest';
import { GameAction, GameState, SideCode, executeAction, getLegalActions, isLegalAction } from '../src/core';
import { createInitialGameState } from '../src/core';
import { sampleGameSetup } from './sampleDecks';

/**
 * getLegalActions skips candidates that cheap checks rule out. This makes
 * sure those checks never hide a legal action: every action from a
 * brute-force list that the engine accepts must be listed.
 */
function bruteForce(state: GameState, side: SideCode): GameAction[] {
  const servers = Object.values(state.corp.servers);
  const installed = servers.flatMap(s => [...s.ice, ...s.root]);
  const hand = side === 'corp' ? state.corp.hq : state.runner.grip;
  const rig = [...state.runner.rig.programs, ...state.runner.rig.hardware, ...state.runner.rig.resources];
  const ice = servers.flatMap(s => s.ice);
  const all: GameAction[] = [
    { type: 'GAIN_CREDIT', player: side },
    { type: 'DRAW_CARD', player: side },
    { type: 'END_TURN', player: side },
    { type: 'REMOVE_TAG', player: side },
    { type: 'PURGE_VIRUS', player: side },
  ];
  for (const card of hand) {
    all.push({ type: 'PLAY_OPERATION_OR_EVENT', player: side, cardInstanceId: card.instanceId });
    // Canonical install shapes: the Corp names a server or a new remote, the Runner a host or nothing
    if (side === 'corp') {
      all.push({ type: 'INSTALL_CARD', player: side, cardInstanceId: card.instanceId, asNewRemote: true });
      for (const s of servers) all.push({ type: 'INSTALL_CARD', player: side, cardInstanceId: card.instanceId, targetServerId: s.id });
    } else {
      all.push({ type: 'INSTALL_CARD', player: side, cardInstanceId: card.instanceId });
      for (const i of ice) all.push({ type: 'INSTALL_CARD', player: side, cardInstanceId: card.instanceId, hostInstanceId: i.instanceId });
    }
  }
  for (const s of servers) {
    all.push({ type: 'INITIATE_RUN', player: side, targetServerId: s.id });
    for (const card of [...s.ice, ...s.root]) {
      all.push({ type: 'ADVANCE_CARD', player: side, cardInstanceId: card.instanceId, serverId: s.id });
    }
  }
  for (const card of installed) {
    all.push({ type: 'SCORE_AGENDA', player: side, cardInstanceId: card.instanceId });
    all.push({ type: 'REZ_CARD', player: side, cardInstanceId: card.instanceId });
  }
  for (const card of rig) all.push({ type: 'TRASH_RESOURCE', player: side, cardInstanceId: card.instanceId });
  for (const card of [...installed, ...rig, state.corp.identity, state.runner.identity]) {
    for (let abilityIndex = 0; abilityIndex < 3; abilityIndex++) {
      all.push({ type: 'USE_ABILITY', player: side, cardInstanceId: card.instanceId, abilityIndex });
    }
  }
  return all;
}

describe('getLegalActions', () => {
  for (const seed of [1, 2, 3]) {
    it(`lists every legal action (seed ${seed})`, () => {
      let state = createInitialGameState(sampleGameSetup(seed));
      let rand = seed;
      const next = () => ((rand = (rand * 1103515245 + 12345) % 2147483648), rand / 2147483648);
      for (let step = 0; step < 300 && !state.winner; step++) {
        if (step % 5 === 0 && state.pendingPrompts.length === 0) {
          for (const side of ['corp', 'runner'] as SideCode[]) {
            const listed = new Set(getLegalActions(state, side).map(a => JSON.stringify(a)));
            for (const action of bruteForce(state, side)) {
              if (isLegalAction(state, action)) expect(listed.has(JSON.stringify(action)), JSON.stringify(action)).toBe(true);
            }
          }
        }
        const side = state.pendingPrompts[0]?.side ?? (state.activeRun ? 'runner' : state.activePlayer);
        let actions = getLegalActions(state, side);
        if (state.activeRun && next() < 0.3) {
          const corp = getLegalActions(state, 'corp');
          if (corp.length > 0) actions = corp;
        }
        state = executeAction(state, actions[Math.floor(next() * actions.length)]);
      }
    });
  }
});
