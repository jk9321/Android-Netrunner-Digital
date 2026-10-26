import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { executeAction, GameAction } from '../src/core';
import { EncounterPanel } from '../src/ui/components/EncounterPanel';
import { installIceForTest, installProgramForTest, newGame, runIntoFirstIce } from './helpers';

const PHAROS = '30063';
const MAYFLY = '30032';

describe('Encounter panel', () => {
  it('keeps a broken subroutine’s button in place, greyed out', () => {
    let s = newGame();
    installIceForTest(s, PHAROS, 'hq');
    installProgramForTest(s, MAYFLY);
    s.runner.credits = 20;
    s = runIntoFirstIce(s, 'hq');
    const mayfly = s.runner.rig.programs[0].instanceId;
    const boost: GameAction = { type: 'BOOST_BREAKER', player: 'runner', breakerInstanceId: mayfly };
    for (let i = 0; i < 4; i++) s = executeAction(s, boost);
    s = executeAction(s, { type: 'BREAK_SUBROUTINE', player: 'runner', breakerInstanceId: mayfly, subroutineIndices: [0] });

    const html = renderToStaticMarkup(<EncounterPanel state={s} onAction={() => {}} />);
    const labels = [...html.matchAll(/<button([^>]*)>(.*?)<\/button>/g)].map(m => ({
      disabled: /\sdisabled=""/.test(m[1]),
      text: m[2].replace(/<[^>]+>/g, ''),
    }));
    const breaks = labels.filter(l => /Break|Broken/.test(l.text));
    expect(breaks.map(b => b.text.split(' (')[0])).toEqual(['Broken 1', 'Break 2', 'Break 3']);
    expect(breaks.map(b => b.disabled)).toEqual([true, false, false]);
  });
});
