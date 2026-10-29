import { describe, expect, it } from 'vitest';
import { createCardInstance, findCardAnywhere, GameState } from '../src/core';
import { TurnFlag, bumpTurnFlag } from '../src/core/engine/cardEffects';
import { liveValues } from '../src/ui/liveValues';
import { giveCard, installCorpForTest, installIceForTest, installProgramForTest, newGame, startRunnerTurn } from './helpers';

const C = {
  risingTide: '35009', principia: '35032', ritual: '35026', transfer: '35017', cleaver: '30006', echelon: '30025',
  unity: '30026', fermenter: '30007', conduit: '30024', carmen: '30015', palisade: '30072', sureGamble: '30030',
  urtica: '30045', clearinghouse: '30061', neurospike: '30049', phat: '35051', idiosyncresis: '35061',
};

const values = (s: GameState, id: string) => liveValues(s, findCardAnywhere(s, id)!);

describe('live values on hover', () => {
  it('Rising Tide shows its strength from fracters in the heap', () => {
    const s = newGame();
    const tide = installProgramForTest(s, C.risingTide);
    s.runner.heap.push(createCardInstance(s, C.cleaver), createCardInstance(s, C.principia), createCardInstance(s, C.sureGamble));
    expect(values(s, tide)).toEqual(['Strength: 3 (printed 1)']);
  });

  it('Echelon and Unity in the grip count themselves as installed', () => {
    const s = newGame();
    installProgramForTest(s, C.cleaver);
    const echelon = giveCard(s, 'runner', C.echelon);
    const unity = installProgramForTest(s, C.unity);
    // Installed: Cleaver + Unity = 2; Echelon would make 3
    expect(values(s, echelon)[0]).toBe('Strength once installed: 3 (printed 0)');
    expect(values(s, unity)).toContain('X = 2: 1[credit] for +2 strength');
  });

  it('Principia and Carmen show their install cost now', () => {
    const s = newGame();
    startRunnerTurn(s);
    installProgramForTest(s, C.cleaver);
    const principia = giveCard(s, 'runner', C.principia);
    const carmen = giveCard(s, 'runner', C.carmen);
    expect(values(s, principia)).toContain('Install cost now: 3[credit] (printed 4)');
    expect(values(s, carmen).some(l => l.startsWith('Install cost'))).toBe(false);
  });

  it('counter-based Runner cards show their payout', () => {
    const s = newGame();
    const fermenter = installProgramForTest(s, C.fermenter);
    findCardAnywhere(s, fermenter)!.tokens.virus = 3;
    const conduit = installProgramForTest(s, C.conduit);
    findCardAnywhere(s, conduit)!.tokens.virus = 2;
    expect(values(s, fermenter)).toEqual(['Cash out now: gain 6[credit]']);
    expect(values(s, conduit)).toEqual(['X = 2: access 2 additional card(s)']);
  });

  it('Ritual and Transfer of Wealth read clicks and Corp credits', () => {
    const s = newGame();
    startRunnerTurn(s);
    s.runner.clicks = 4;
    s.corp.credits = 2;
    expect(values(s, giveCard(s, 'runner', C.ritual))).toEqual(['Play now: draw 3']);
    expect(values(s, giveCard(s, 'runner', C.transfer))).toEqual(['If successful now: Corp loses 2, you gain 4[credit]']);
  });

  it('advanceable Corp assets and Palisade show their current value', () => {
    const s = newGame();
    const urtica = installCorpForTest(s, C.urtica, 'remote1');
    findCardAnywhere(s, urtica)!.advancementCounters = 2;
    const house = installCorpForTest(s, C.clearinghouse, 'remote2');
    findCardAnywhere(s, house)!.advancementCounters = 3;
    const idio = installCorpForTest(s, C.idiosyncresis, 'remote3');
    findCardAnywhere(s, idio)!.advancementCounters = 2;
    const phat = installCorpForTest(s, C.phat, 'remote4');
    findCardAnywhere(s, phat)!.tokens.power = 5;
    const palisade = installIceForTest(s, C.palisade, 'remote1');
    expect(values(s, urtica)).toEqual(['On access now: 4 net damage']);
    expect(values(s, house)).toEqual(['Trash now: 3 meat damage']);
    expect(values(s, idio)).toEqual(['Trash now: gain 6[credit], Runner loses 4[credit]']);
    expect(values(s, phat)).toEqual(['Next score or steal: up to 3 net damage']);
    expect(values(s, palisade)).toEqual(['Strength: 4 (printed 2)']);
  });

  it('Neurospike shows the agenda points scored this turn', () => {
    const s = newGame();
    const spike = giveCard(s, 'corp', C.neurospike);
    bumpTurnFlag(s, TurnFlag.agendaPointsScored, 3);
    expect(values(s, spike)).toEqual(['X = 3: 3 net damage']);
  });

  it('cards without counted effects show nothing', () => {
    const s = newGame();
    expect(values(s, giveCard(s, 'runner', C.sureGamble))).toEqual([]);
  });
});
