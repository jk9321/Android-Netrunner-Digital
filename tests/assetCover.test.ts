import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { GameAction, GameState, executeAction } from '../src/core';
import { assetCover, assetPartner, scoreInTwoPick, scoringRemote } from '../src/ai/countedScore';
import { withDiagnostics } from '../src/ai/diagnostics';
import { asSide } from '../src/ai/pricing';
import { decisionContext } from '../src/ai/handValues';

/**
 * assetCover (asset cover step 2, folded, redesign/spec-asset-cover.md, form A: Jeff's rule with a counted affordability
 * check): an econ asset the Corp's own pick installs on a remote with no ice goes behind the cheapest ice from HQ, played
 * first, when the Corp has 2 clicks, the ice's install cost (8.5.11a) and, after it, the ice's rez and the asset's rez
 * next turn. One agenda or asset per remote root (3.3.1). Jeff's Runner games: 9 of the AI's 17 bare econ assets
 * trashed (2.6.1), 0 of 2 iced.
 * Pin 1: deal 1001 turn 10 (tests/fixtures/ice-redirect-1001-t10.json), The Syndicate, 15 credits, 2 clicks, with
 * Palisade inst-23 in HQ made a Nico Campaign (rez 2, trash 2) and remote-1's ice cleared (no scoring remote).
 * Pin 2: Jeff's Runner game report-39 (tests/fixtures/asset-cover-r39-t6.json, from tests/fixtures/human-games), turn 6:
 * the AI Corp, 3 clicks and 3 credits, installed Regolith Mining License bare on a new remote with Tatu-Bola (rez 2) in
 * HQ, and Jeff trashed it that turn for 3.
 */
const read = (name: string): GameState => JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8'));
const NICO = '30037';
const position = (edit?: (s: GameState) => void): GameState => {
  const s: GameState = structuredClone(read('ice-redirect-1001-t10.json'));
  s.corp.hq.find(c => c.instanceId === 'inst-23')!.cardCode = NICO;
  s.corp.servers['remote-1'].ice = [];
  edit?.(s);
  return s;
};
const newRemote = { type: 'INSTALL_CARD', player: 'corp', cardInstanceId: 'inst-23', asNewRemote: true } as GameAction;
const inCorp = <T>(s: GameState, f: () => T): T => asSide('corp', () => (decisionContext(s, 'corp'), f()));

describe('assetCover: an econ asset behind the cheapest ice in HQ', () => {
  it('plays Whitespace (rez 2, under Palisade 3 and Brân 6) onto a new remote, then Nico Campaign behind it', () => {
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
    expect(inCorp(m, () => scoreInTwoPick({ ...m, corp: { ...m.corp, clicks: 1 } }, pick, second.held)).held).toBeNull();
  });

  it("an asset line stays out of the scoreInTwo diagnostics (its agendaId names an asset)", () => {
    const s = position();
    withDiagnostics(d => {
      inCorp(s, () => scoreInTwoPick(s, newRemote, null));
      expect(d.scoreInTwo.begun).toBe(0);
      expect(d.scoreInTwoLines).toEqual([]);
    });
  });

  it("Jeff's game report-39 turn 6: Tatu-Bola goes in front of the Regolith he trashed", () => {
    const s = read('asset-cover-r39-t6.json');
    const pick = { type: 'INSTALL_CARD', player: 'corp', cardInstanceId: 'inst-18', asNewRemote: true } as GameAction;
    expect(inCorp(s, () => assetCover(s, pick))).toMatchObject({ kind: 'asset', agendaId: 'inst-18', server: 'new remote', iceId: 'inst-29' });
    expect(inCorp(s, () => scoreInTwoPick(s, pick, null).action)).toMatchObject({ type: 'INSTALL_CARD', cardInstanceId: 'inst-29', asNewRemote: true });
  });

  it('leaves the bare install without the money for the ice and the rez, or with one click', () => {
    for (const s of [position(x => (x.corp.credits = 1)), position(x => (x.corp.clicks = 1))]) {
      expect(inCorp(s, () => assetCover(s, newRemote))).toBeNull();
      expect(inCorp(s, () => scoreInTwoPick(s, newRemote, null).action)).toBe(newRemote);
    }
  });

  it('an agenda in HQ and a scoring remote no counted line could use: not reserved, the asset goes behind its ice (reservedForAgenda)', () => {
    // remote-1 with an unrezzed Brân 1.0 alone (broken with clicks): the scoring remote, short by the count
    const bran = (x: GameState) => x.corp.servers['remote-1'].ice.push({ ...structuredClone(x.corp.servers.rd.ice[1]), instanceId: 'inst-bran', isRezzed: false });
    const s = position(x => (bran(x), x.corp.hq.push({ ...structuredClone(x.corp.hq[0]), instanceId: 'inst-agenda', cardCode: '30068' })));
    expect(inCorp(s, () => scoringRemote(s)?.id)).toBe('remote-1');
    // No rez set holds remote-1 within the line's horizon (folded plan.assetReserve; before it: reserved, no line)
    expect(inCorp(s, () => assetCover(s, newRemote))).toMatchObject({ kind: 'asset', server: 'remote-1', form: 'install' });
    // With no agenda in HQ the scoring remote has nothing to protect this turn: the asset goes behind its Brân (assetPartner's econ case)
    const t = position(bran);
    expect(inCorp(t, () => assetCover(t, newRemote))).toMatchObject({ kind: 'asset', server: 'remote-1', form: 'install' });
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

describe('assetPartner: an asset or upgrade headed for a new bare remote goes to a waiting iced remote (3.3.1)', () => {
  // Claude's play test round 2, game 2 action #177 (turn 11, 9 credits): remote-1 has Palisade and Ansel 1.0 and an
  // empty root, no agenda in HQ; the Corp put Clearinghouse on a new remote and the Runner trashed it for 3
  const g2 = () => read('asset-partner-pt2-g2-177.json');
  const clearinghouse = { type: 'INSTALL_CARD', player: 'corp', cardInstanceId: 'inst-22', asNewRemote: true } as GameAction;

  it('play test G2 #177: Clearinghouse goes to remote-1', () => {
    const s = g2();
    expect(inCorp(s, () => assetPartner(s, clearinghouse))).toMatchObject({ type: 'INSTALL_CARD', cardInstanceId: 'inst-22', targetServerId: 'remote-1' });
  });

  it('not the scoring remote while an agenda waits in HQ and a counted line could use it (reservedForAgenda)', () => {
    const s: GameState = structuredClone(g2());
    s.corp.hq.push({ ...structuredClone(s.corp.hq[0]), instanceId: 'inst-agenda', cardCode: '30068' });
    expect(inCorp(s, () => scoringRemote(s)?.id)).toBe('remote-1');
    // No rez set holds remote-1 within the line's horizon: not reserved, the asset may take it (3.3.1)
    expect(inCorp(s, () => assetPartner(s, clearinghouse))).toMatchObject({ targetServerId: 'remote-1' });
    // Against a Runner with no money and no breakers a rez set holds: it stays reserved for the agenda
    s.corp.credits = 100;
    s.runner.credits = 0;
    s.runner.rig.programs = [];
    s.runner.rig.resources = [];
    s.runner.rig.hardware = [];
    expect(inCorp(s, () => assetPartner(s, clearinghouse))).toBeNull();
  });

  it('an econ asset takes the same move ahead of a cover pair (assetCover)', () => {
    const s: GameState = structuredClone(read('ice-redirect-1001-t10.json'));
    s.corp.hq.find(c => c.instanceId === 'inst-23')!.cardCode = NICO;
    expect(inCorp(s, () => assetCover(s, newRemote))).toMatchObject({ kind: 'asset', server: 'remote-1', form: 'install' });
  });
});
