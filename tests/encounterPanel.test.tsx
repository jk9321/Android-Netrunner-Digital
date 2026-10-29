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

describe('Encounter panel: counter-spending breakers', () => {
  const HANTU = '35008';
  const BUMI = '35041'; // sentry, strength 3
  const buttons = (s: ReturnType<typeof newGame>) =>
    [...renderToStaticMarkup(<EncounterPanel state={s} onAction={() => {}} />).matchAll(/<button([^>]*)>(.*?)<\/button>/g)].map(m =>
      m[2].replace(/<[^>]+>/g, '').replace(/&#x27;/g, "'"),
    );

  it('offers Hantu’s virus-counter boost in its own row, then its break buttons (no credit boost)', () => {
    let s = newGame();
    installIceForTest(s, BUMI, 'hq');
    installProgramForTest(s, HANTU);
    const hantu = s.runner.rig.programs[0];
    hantu.tokens.virus = 2;
    s.runner.credits = 2;
    s = runIntoFirstIce(s, 'hq');
    // Strength 2 < 3: only the counter ability is usable (rules 3.9.5g, 1.16.9).
    expect(buttons(s)).toContain('Spend 1 virus: +2 strength (2 left)');
    s = executeAction(s, { type: 'USE_ABILITY', player: 'runner', cardInstanceId: hantu.instanceId, abilityIndex: 0 });
    const after = buttons(s);
    expect(after).toContain('Break 1 (1credit)');
    expect(after).toContain('Break 2 (1credit)');
    expect(after.some(t => /^\+\d+ strength \(\d+credit\)$/.test(t))).toBe(false);
  });

  it('labels Unity’s boost with the strength it gives (+X, X = installed icebreakers)', () => {
    const UNITY = '30026';
    const PHAROS = '30063';
    let s = newGame();
    installIceForTest(s, PHAROS, 'hq');
    installProgramForTest(s, UNITY);
    installProgramForTest(s, '30006'); // Cleaver
    installProgramForTest(s, '30015'); // Carmen
    s.runner.credits = 20;
    s = runIntoFirstIce(s, 'hq');
    expect(buttons(s)).toContain('+3 strength (1credit)');
  });
});
