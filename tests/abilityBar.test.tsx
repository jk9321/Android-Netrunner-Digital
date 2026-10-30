import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { AbilityBar } from '../src/ui/components/AbilityBar';
import { installProgramForTest, newGame, startRunnerTurn } from './helpers';

const FERMENTER = '30007';
const buttons = (s: ReturnType<typeof newGame>) =>
  [...renderToStaticMarkup(<AbilityBar state={s} side="runner" onAction={() => {}} />).matchAll(/<button[^>]*>(.*?)<\/button>/g)].map(m =>
    m[1].replace(/<[^>]+>/g, ''),
  );

describe('Ability bar', () => {
  it('numbers two copies of the same card and shows their counters', () => {
    const s = newGame();
    startRunnerTurn(s);
    const a = installProgramForTest(s, FERMENTER);
    const b = installProgramForTest(s, FERMENTER);
    const [first, second] = s.runner.rig.programs.filter(c => c.instanceId === a || c.instanceId === b);
    first.tokens.virus = 1;
    second.tokens.virus = 3;
    const labels = buttons(s).filter(t => t.startsWith('Fermenter'));
    expect(labels).toHaveLength(2);
    expect(labels[0]).toMatch(/^Fermenter \(#1, 1 virus\):/);
    expect(labels[1]).toMatch(/^Fermenter \(#2, 3 virus\):/);
  });

  it('leaves a single copy unnumbered', () => {
    const s = newGame();
    startRunnerTurn(s);
    installProgramForTest(s, FERMENTER);
    const labels = buttons(s).filter(t => t.startsWith('Fermenter'));
    expect(labels).toHaveLength(1);
    expect(labels[0]).toMatch(/^Fermenter: /);
  });
});
