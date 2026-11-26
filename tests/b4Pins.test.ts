import { describe, expect, it } from 'vitest';
import { cardDef, executeAction, GameState, getLegalActions, InstallCardAction } from '../src/core';
import { revealInHand } from '../src/core/engine/helpers';
import { hqAgendaOdds } from '../src/ai/runs';
import { agendaOdds } from '../src/ai/effectValues';
import { newGame } from './helpers';
import '../src/ai';

// B4 pins (brief b4-hidden-zones rev 1c, bar 6): each fails without its change.

describe('B4a 7(a): HQ odds read only the seen cards surely still there', () => {
  // Red team b4 probe-hq-stale (R-100): the Runner saw all of HQ (3 ice); the Corp draws and installs a seen ice
  // three times. HQ now holds three unseen cards, but the list still names the three ice, and hqAgendaOdds read 0.
  // Each install protects a server, so it was ice (4.6.6d, 10.2.3a): it may have been a seen card (1.12.3).
  it('after three seen ice are installed, HQ is priced as three unseen cards', () => {
    let s: GameState = newGame(3);
    const type = (c: { cardCode: string }) => cardDef(c as never).type_code;
    const ice = s.corp.rd.filter(c => type(c) === 'ice').slice(0, 3);
    const agendas = s.corp.rd.filter(c => type(c) === 'agenda').slice(0, 3);
    s.corp.rd.push(...s.corp.hq);
    s.corp.hq = [...ice];
    s.corp.rd = [...agendas, ...s.corp.rd.filter(c => !ice.includes(c) && !agendas.includes(c))];
    s.corp.credits = 20;
    const iceIds = ice.map(c => c.instanceId);
    revealInHand(s, 'corp', s.corp.hq);
    expect(hqAgendaOdds(s, agendaOdds(s).odds)).toBe(0);
    for (let round = 0; round < 3; round++) {
      s = executeAction(s, { type: 'DRAW_CARD', player: 'corp' });
      const seen = s.corp.hq.find(c => iceIds.includes(c.instanceId))!;
      const install = getLegalActions(s, 'corp').find(a => a.type === 'INSTALL_CARD' && (a as InstallCardAction).cardInstanceId === seen.instanceId)!;
      s = executeAction(s, install);
      s.corp.clicks = 3;
    }
    const odds = agendaOdds(s).odds;
    expect(odds).toBeGreaterThan(0);
    expect(hqAgendaOdds(s, odds)).toBeCloseTo(odds, 9);
  });
});
