import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { GameState } from '../src/core';
import { scoringRemote } from '../src/ai/countedScore';
import { tuning } from '../src/ai/synergy';

/**
 * plan.scoringNoAsset (asset cover step 1): rule 3.3.1, "There can be only one agenda or asset installed in the root of
 * each remote server", so a remote whose root holds an asset cannot take an agenda and is not the scoring remote.
 * Pin: deal 1001 turn 10 (tests/fixtures/ice-redirect-1001-t10.json) with the three central ice moved onto remote-4,
 * whose root holds a rezzed Regolith Mining License: remote-4 then has the most ice (3, against remote-1's 2).
 */
const position = (): GameState => {
  const s: GameState = structuredClone(JSON.parse(readFileSync(new URL('./fixtures/ice-redirect-1001-t10.json', import.meta.url), 'utf8')));
  const v = s.corp.servers;
  v['remote-4'].ice.push(...v.hq.ice.splice(0), ...v.rd.ice.splice(0));
  return s;
};
const withSwitch = <T>(on: boolean, f: () => T): T => {
  const keep = tuning.plan;
  tuning.plan = { ...keep, scoringNoAsset: on };
  try {
    return f();
  } finally {
    tuning.plan = keep;
  }
};

describe('plan.scoringNoAsset: the scoring remote is never an asset root (3.3.1)', () => {
  it('names remote-1, not the more iced remote-4 holding Regolith', () => {
    const s = position();
    expect(s.corp.servers['remote-4'].ice).toHaveLength(3);
    expect(withSwitch(false, () => scoringRemote(s)?.id)).toBe('remote-4');
    expect(withSwitch(true, () => scoringRemote(s)?.id)).toBe('remote-1');
  });

  it('adopts the remote once its asset leaves', () => {
    const s = position();
    s.corp.servers['remote-4'].root = [];
    expect(withSwitch(true, () => scoringRemote(s)?.id)).toBe('remote-4');
  });
});
