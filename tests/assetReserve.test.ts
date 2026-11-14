import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { GameAction, GameState } from '../src/core';
import { assetCover, assetPartner } from '../src/ai/corp/placement';
import { asSide } from '../src/ai/pricing';
import { decisionContext } from '../src/ai/handValues';

/**
 * Asset cover reservation (folded plan.assetReserve, countedScore.ts reservedForAgenda; bars/asset-cover-reserve.md): the
 * scoring remote is kept free of assets for an agenda only while a counted line could use it. Claude's play test round 3
 * (playtests/round3-report.md; fixtures written by scripts/fixture-at.ts, the state before the move):
 * G1 #126, turn 9, 3 credits, 2 clicks: Regolith Mining License to a new bare remote while remote-2 (Tithe, Diviner)
 * sat with an empty root and Orbital Superiority, Send a Message and Offworld Office in HQ; no rez set holds remote-2
 * even with next turn's money; the Runner trashed the Regolith with 12 credits on it.
 * G2 #103, turn 6, 2 credits: Regolith to a new remote, remote-1 (Whitespace, Manegarm Skunkworks) open, Salvo Testing in HQ.
 */
const read = (name: string): GameState => JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8'));
const inCorp = <T>(s: GameState, f: () => T): T => asSide('corp', () => (decisionContext(s, 'corp'), f()));
const cases: [string, string, string][] = [
  ['reserve-r3-g1-126.json', 'inst-32', 'remote-2'],
  ['reserve-r3-g2-103.json', 'inst-19', 'remote-1'],
];

describe('asset cover reservation: an unusable scoring remote takes the asset', () => {
  for (const [file, id, server] of cases) {
    it(`${file}: the Regolith goes to ${server}`, () => {
      const s = read(file);
      const pick = { type: 'INSTALL_CARD', player: 'corp', cardInstanceId: id, asNewRemote: true } as GameAction;
      expect(inCorp(s, () => assetCover(s, pick))).toMatchObject({ kind: 'asset', server, form: 'install' });
      expect(inCorp(s, () => assetPartner(s, pick))).toMatchObject({ targetServerId: server });
    });
  }
});
