import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { GameAction, GameState, executeAction } from '../src/core';
import { assetCover, scoreInTwoPick, scoringRemote } from '../src/ai/countedScore';
import { tuning } from '../src/ai/synergy';
import { asSide } from '../src/ai/pricing';
import { decisionContext } from '../src/ai/handValues';

/**
 * plan.assetCover (asset cover step 2, redesign/spec-asset-cover.md): an econ asset the Corp's own pick installs where
 * it would not hold through the Runner's next turn goes behind the cheapest ice from HQ that holds it, counted against
 * the Runner's budget less the asset's printed trash cost (rule 2.6.1: the Runner pays it to trash an accessed card).
 * Pin: deal 1001 turn 10 (tests/fixtures/ice-redirect-1001-t10.json), The Syndicate, 15 credits, 2 clicks, with
 * Palisade inst-23 in HQ made a Nico Campaign (rez 2, trash 2; pays 3 when the turn begins), the Runner's breakers
 * gone (so Whitespace and Palisade each hold, Brân 1.0 is broken with clicks) and remote-1's ice cleared (no scoring
 * remote). One agenda or asset per remote root (3.3.1); 1 credit per ice already protecting a server (8.5.11a).
 */
const read = (name: string): GameState => JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8'));
const NICO = '30037';
const position = (edit?: (s: GameState) => void): GameState => {
  const s: GameState = structuredClone(read('ice-redirect-1001-t10.json'));
  s.corp.hq.find(c => c.instanceId === 'inst-23')!.cardCode = NICO;
  s.runner.rig.programs = [];
  s.corp.servers['remote-1'].ice = [];
  edit?.(s);
  return s;
};
const newRemote = { type: 'INSTALL_CARD', player: 'corp', cardInstanceId: 'inst-23', asNewRemote: true } as GameAction;
const inCorp = <T>(s: GameState, f: () => T, on = true): T => {
  const keep = tuning.plan;
  tuning.plan = { ...keep, assetCover: on, scoringNoAsset: true };
  try {
    return asSide('corp', () => (decisionContext(s, 'corp'), f()));
  } finally {
    tuning.plan = keep;
  }
};

describe('plan.assetCover: a drip asset behind the cheapest ice that holds it', () => {
  it('plays Whitespace (rez 2, under Palisade 3) onto a new remote, then Nico Campaign behind it', () => {
    const s = position();
    expect(inCorp(s, () => assetCover(s, newRemote))).toMatchObject({ kind: 'asset', agendaId: 'inst-23', server: 'new remote', form: 'install+ice', iceId: 'inst-29' });
    const first = inCorp(s, () => scoreInTwoPick(s, newRemote, null));
    expect(first.action).toMatchObject({ type: 'INSTALL_CARD', cardInstanceId: 'inst-29', asNewRemote: true });
    const n = executeAction(s, first.action);
    const second = inCorp(n, () => scoreInTwoPick(n, { ...newRemote }, first.held));
    const server = Object.values(n.corp.servers).find(v => v.ice.some(c => c.instanceId === 'inst-29'))!.id;
    expect(second.action).toMatchObject({ type: 'INSTALL_CARD', cardInstanceId: 'inst-23', targetServerId: server });
    // The line is done once the asset is in: the next pick stands
    const m = executeAction(n, second.action);
    const pick = { type: 'GAIN_CREDIT', player: 'corp' } as GameAction;
    expect(m.corp.clicks).toBe(0);
    expect(inCorp(m, () => scoreInTwoPick({ ...m, corp: { ...m.corp, clicks: 1 } }, pick, second.held)).held).toBeNull();
  });

  it('covers a click asset too: Regolith Mining License (rez 2, trash 3; Jeff trashes the bare ones)', () => {
    const s = position(x => (x.corp.hq.find(c => c.instanceId === 'inst-23')!.cardCode = '30071'));
    expect(inCorp(s, () => assetCover(s, newRemote))).toMatchObject({ kind: 'asset', form: 'install+ice', iceId: 'inst-29' });
  });

  it('switch off: the pick stands', () => {
    const s = position();
    expect(inCorp(s, () => scoreInTwoPick(s, newRemote, null), false).action).toBe(newRemote);
  });

  it('leaves the bare install with no money for the ice and the rez', () => {
    const s = position(x => (x.corp.credits = 1));
    expect(inCorp(s, () => assetCover(s, newRemote))).toBeNull();
    expect(inCorp(s, () => scoreInTwoPick(s, newRemote, null).action)).toBe(newRemote);
  });

  it('nothing while the scoring remote does not hold: the ice goes there (iceRedirect)', () => {
    // remote-1 with an unrezzed Brân 1.0 alone: the scoring remote, broken with clicks
    const s = position(x => x.corp.servers['remote-1'].ice.push({ ...structuredClone(x.corp.servers.rd.ice[1]), instanceId: 'inst-bran', isRezzed: false }));
    expect(inCorp(s, () => scoringRemote(s)?.id)).toBe('remote-1');
    expect(inCorp(s, () => assetCover(s, newRemote))).toBeNull();
  });

  it('a score line wins: deal 1411 turn 6 keeps Whitespace for Orbital Superiority', () => {
    const s: GameState = structuredClone(read('ice-redirect-1411-t6.json'));
    s.corp.hq.find(c => c.instanceId === 'inst-27')!.cardCode = NICO;
    const pick = { type: 'INSTALL_CARD', player: 'corp', cardInstanceId: 'inst-27', asNewRemote: true } as GameAction;
    const two = inCorp(s, () => scoreInTwoPick(s, pick, null));
    expect(two.held?.line.kind).toBeUndefined();
    expect(two.held?.line.agendaId).toBe('inst-4');
    expect(two.action).toMatchObject({ cardInstanceId: 'inst-41' });
  });
});
