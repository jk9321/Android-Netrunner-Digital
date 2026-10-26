import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { executeAction } from '../src/core';
import { derez, trashInstalledCard } from '../src/core/engine/cardEffects';
import { installCorpCardFrom } from '../src/core/engine/actions/install';
import { ServerColumn } from '../src/ui/components/ServerColumn';
import { installCorpForTest, newGame, rezForTest, run } from './helpers';

// The Runner may remember a Corp card they have seen (rules 10.2.2b): turned
// facedown it is the same object (1.12.5), back in HQ or R&D it is a new one (1.12.3).

const REGOLITH = '30071'; // Regolith Mining License, an asset

describe('Corp cards the Runner has seen', () => {
  it('stay known after being derezzed', () => {
    let s = newGame();
    const id = installCorpForTest(s, REGOLITH, 'remote-1');
    s = rezForTest(s, id);
    const card = s.corp.servers['remote-1'].root.find(c => c.instanceId === id)!;
    expect(card.runnerKnows).toBe(true);
    derez(s, card);
    expect(card.isRezzed).toBe(false);
    expect(card.runnerKnows).toBe(true);
  });

  it('an unrezzed card accessed where it is installed becomes known', () => {
    let s = newGame();
    const id = installCorpForTest(s, REGOLITH, 'remote-1');
    s.runner.credits = 0; // can't trash it
    s = run(s, 'remote-1');
    s = executeAction(s, { type: 'CONTINUE_RUN', player: 'runner' });
    while (s.pendingPrompts.length > 0) {
      const p = s.pendingPrompts[0];
      if (p.kind !== 'access_trash') break;
      s = executeAction(s, { type: 'RESOLVE_PROMPT', player: 'runner', promptId: p.id, choice: { kind: 'access_trash', trash: false } });
    }
    expect(s.corp.servers['remote-1'].root.find(c => c.instanceId === id)!.runnerKnows).toBe(true);
  });

  it('are forgotten once they go back to HQ', () => {
    let s = newGame();
    const id = installCorpForTest(s, REGOLITH, 'remote-1');
    const card = s.corp.servers['remote-1'].root[0];
    card.runnerKnows = true;
    s.corp.servers['remote-1'].root = [];
    s.corp.hq.push(card);
    s = executeAction(s, { type: 'GAIN_CREDIT', player: 'corp' });
    expect(s.corp.hq.find(c => c.instanceId === id)!.runnerKnows).toBeUndefined();
  });

  it('a card installed from faceup Archives is known, one from HQ is not', () => {
    const s = newGame();
    const fromArchives = s.corp.hq.pop()!;
    s.corp.archives.faceUp.push(fromArchives);
    installCorpCardFrom(s, fromArchives, s.corp.archives.faceUp, null, true);
    expect(fromArchives.runnerKnows).toBe(true);
    const fromHq = s.corp.hq[0];
    fromHq.runnerKnows = true; // stale
    installCorpCardFrom(s, fromHq, s.corp.hq, null, true);
    expect(fromHq.runnerKnows).toBeUndefined();
  });

  it('a trashed card is forgotten', () => {
    const s = newGame();
    installCorpForTest(s, REGOLITH, 'remote-1');
    const card = s.corp.servers['remote-1'].root[0];
    card.runnerKnows = true;
    trashInstalledCard(s, card);
    expect(card.runnerKnows).toBeUndefined();
  });
});

describe('Seen cards on the board', () => {
  const board = (perspective: 'runner' | 'corp') => {
    const s = newGame();
    installCorpForTest(s, REGOLITH, 'remote-1');
    s.corp.servers['remote-1'].root[0].runnerKnows = true;
    return renderToStaticMarkup(<ServerColumn server={s.corp.servers['remote-1']} activePlayer="corp" perspective={perspective} />);
  };

  it('the Runner sees the card faded and marked Seen', () => {
    const html = board('runner');
    expect(html).toContain('data-testid="seen-tag"');
    expect(html).toContain('data-testid="seen-veil"');
    expect(html).toContain('Regolith Mining License');
  });

  it('the Corp view is unchanged', () => {
    const html = board('corp');
    expect(html).not.toContain('seen-tag');
    expect(html).toContain('Unrezzed');
  });

  it('an unknown card stays a card back for the Runner', () => {
    const s = newGame();
    installCorpForTest(s, REGOLITH, 'remote-1');
    const html = renderToStaticMarkup(<ServerColumn server={s.corp.servers['remote-1']} activePlayer="corp" perspective="runner" />);
    expect(html).not.toContain('seen-tag');
    expect(html).not.toContain('Regolith Mining License');
  });
});
