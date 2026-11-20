/**
 * Component smoke tests & storage wrapper unit tests (UI cleanup Stage 5).
 * Ensures the refactored UI entry screens (GameHeader, DeckPicker, DeckBuilder,
 * DeckViewer) and the guarded localStorage wrapper render/behave cleanly in SSR.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { STARTER_DECKS } from '../src/data/decks';
import { readStorage, readStorageJson, removeStorage, writeStorage, writeStorageJson } from '../src/ui/storage';
import { GameHeader } from '../src/ui/components/GameHeader';
import { DeckPicker } from '../src/ui/components/DeckPicker';
import { DeckBuilder, DeckViewer } from '../src/ui/components/DeckBuilder';
import { RunOverlay } from '../src/ui/components/RunOverlay';
import { PromptPanel, isPromptDockable } from '../src/ui/components/PromptPanel';
import { ServerColumn } from '../src/ui/components/ServerColumn';
import { CardView } from '../src/ui/components/CardView';
import { RigView } from '../src/ui/components/RigView';
import { breakerTypes } from '../src/ui/components/IceTypeIcons';
import { ZoomContext, createZoomStore } from '../src/ui/components/ZoomPanel';
import { clearBoardTargets, setBoardTargets } from '../src/ui/promptHighlight';
import { SeatContext } from '../src/ui/seat';
import { executeAction } from '../src/core';
import { newGame, startRunnerTurn } from './helpers';

const corpStarter = STARTER_DECKS.find(d => d.side === 'corp')!;
const runnerStarter = STARTER_DECKS.find(d => d.side === 'runner')!;

function stubBrowser(entries: Record<string, string> = {}) {
  const store = new Map(Object.entries(entries));
  vi.stubGlobal('window', {
    localStorage: {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, String(v)),
      removeItem: (k: string) => void store.delete(k),
    },
    location: { origin: 'https://example.test', pathname: '/' },
    addEventListener: () => {},
    removeEventListener: () => {},
  });
  vi.stubGlobal('document', {
    documentElement: { dataset: {} },
  });
  return store;
}

beforeEach(() => stubBrowser());
afterEach(() => vi.unstubAllGlobals());

describe('storage wrapper', () => {
  it('reads, writes, and removes strings and JSON values', () => {
    expect(writeStorage('netrunner.testKey', 'hello')).toBe(true);
    expect(readStorage('netrunner.testKey')).toBe('hello');
    removeStorage('netrunner.testKey');
    expect(readStorage('netrunner.testKey')).toBeNull();

    expect(writeStorageJson('netrunner.testJson', { a: 1, b: ['x'] })).toBe(true);
    expect(readStorageJson<{ a: number; b: string[] }>('netrunner.testJson')).toEqual({ a: 1, b: ['x'] });
  });

  it('degrades safely when storage is missing, malformed, or throws', () => {
    vi.stubGlobal('window', {});
    expect(readStorage('k')).toBeNull();
    expect(writeStorage('k', 'v')).toBe(false);
    expect(writeStorageJson('k', { ok: true })).toBe(false);
    expect(() => removeStorage('k')).not.toThrow();

    stubBrowser({ badJson: '{oops' });
    expect(readStorageJson('badJson')).toBeNull();

    vi.stubGlobal('window', {
      localStorage: {
        getItem: () => {
          throw new Error('blocked');
        },
        setItem: () => {
          throw new Error('quota');
        },
        removeItem: () => {
          throw new Error('blocked');
        },
      },
    });
    expect(readStorage('k')).toBeNull();
    expect(writeStorage('k', 'v')).toBe(false);
    expect(() => removeStorage('k')).not.toThrow();
  });
});

describe('UI component smoke renders', () => {
  it('GameHeader renders local and online bars without duplicating desktop testids', () => {
    const state = newGame();
    const localHtml = renderToStaticMarkup(
      <GameHeader
        state={state}
        config={{ seed: 98765, corpDeck: corpStarter, runnerDeck: runnerStarter, ai: 'corp', difficulty: 'normal' }}
        aiThinking={false}
        stops="auto"
        onStops={() => {}}
        humanSide="runner"
        viewMode="runner"
        onViewMode={() => {}}
        concedingSide="runner"
        onConcede={() => {}}
        onLeave={() => {}}
      />,
    );
    for (const id of ['home-logo', 'stops-toggle', 'header-corp-score', 'header-runner-score', 'card-size', 'auto-fit', 'view-mode', 'settings-button', 'forfeit', 'mobile-menu-button']) {
      expect(localHtml.match(new RegExp(`data-testid="${id}"`, 'g'))?.length, id).toBe(1);
    }
    expect(localHtml).toContain('SEED 98765');

    const onlineHtml = renderToStaticMarkup(
      <GameHeader
        state={state}
        config={null}
        online={{
          code: 'K7QM2X',
          token: 'tok',
          side: 'corp',
          status: 'open',
          opponentConnected: true,
          waitingForOpponent: false,
          over: null,
          takeOver: () => {},
        }}
        aiThinking={false}
        stops="full"
        onStops={() => {}}
        humanSide="corp"
        viewMode="corp"
        onViewMode={() => {}}
        concedingSide="corp"
        onConcede={() => {}}
        onLeave={() => {}}
      />,
    );
    expect(onlineHtml).toContain('data-testid="online-marks"');
    expect(onlineHtml).toContain('GAME K7QM-2X');
    expect(onlineHtml).not.toContain('data-testid="view-mode"');
  });

  it('DeckPicker renders start screen controls and deck columns cleanly', () => {
    const html = renderToStaticMarkup(
      <DeckPicker initialCorpDeckId={corpStarter.id} initialRunnerDeckId={runnerStarter.id} onStart={() => {}} />,
    );
    for (const id of ['app-title', 'game-settings', 'deck-columns', 'search-corp-decks', 'search-runner-decks', 'random-corp-deck', 'new-corp-deck', 'start-game']) {
      expect(html).toContain(`data-testid="${id}"`);
    }
  });

  it('DeckBuilder and DeckViewer render starter decks cleanly', () => {
    const builderHtml = renderToStaticMarkup(
      <DeckBuilder initial={corpStarter} onSave={() => {}} onCancel={() => {}} onImport={() => {}} />,
    );
    for (const id of ['deck-name', 'import-deck', 'save-deck', 'card-pool', 'identity-select', 'format-select', 'deck-legal']) {
      expect(builderHtml).toContain(`data-testid="${id}"`);
    }

    const viewerHtml = renderToStaticMarkup(
      <DeckViewer deck={runnerStarter} onClose={() => {}} onSelect={() => {}} />,
    );
    for (const id of ['deck-viewer', 'close-deck-view', 'viewed-deck-name', 'viewed-identity', 'deck-view-cards', 'select-viewed-deck']) {
      expect(viewerHtml).toContain(`data-testid="${id}"`);
    }
  });

  it('RunOverlay renders cleanly in both docked sidebar mode and floating pop-out mode', () => {
    const base = newGame();
    startRunnerTurn(base);
    const running = executeAction(base, { type: 'INITIATE_RUN', player: 'runner', targetServerId: 'archives' });
    const seat = { can: () => false, legal: [], waitingOn: null } as unknown as React.ContextType<typeof SeatContext>;

    const dockedHtml = renderToStaticMarkup(
      <SeatContext.Provider value={seat}>
        <RunOverlay
          state={running}
          onContinueRun={() => {}}
          onJackOut={() => {}}
          runnerControls
          canPeekCorp={false}
          onAction={() => {}}
          docked
          onToggleDock={() => {}}
        />
      </SeatContext.Provider>,
    );
    expect(dockedHtml).toContain('data-testid="run-overlay"');
    expect(dockedHtml).toContain('data-testid="run-overlay-popout"');
    expect(dockedHtml).not.toContain('data-testid="run-overlay-handle"');

    const floatingHtml = renderToStaticMarkup(
      <SeatContext.Provider value={seat}>
        <RunOverlay
          state={running}
          onContinueRun={() => {}}
          onJackOut={() => {}}
          runnerControls
          canPeekCorp={false}
          onAction={() => {}}
          onToggleDock={() => {}}
        />
      </SeatContext.Provider>,
    );
    expect(floatingHtml).toContain('data-testid="run-overlay"');
    expect(floatingHtml).toContain('data-testid="run-overlay-handle"');
    expect(floatingHtml).toContain('data-testid="run-overlay-dock"');
  });

  it('classifies board/run prompts as dockable and hand/pile prompts as floating, and renders PromptPanel in both modes', () => {
    const state = newGame();
    const installedIce = state.corp.hq.pop()!;
    state.corp.servers.hq.ice.push(installedIce);
    const handCard = state.corp.hq[0];

    expect(isPromptDockable(state, { id: 'p1', side: 'corp', kind: 'mulligan', message: 'Keep?' })).toBe(false);
    expect(isPromptDockable(state, { id: 'p2', side: 'runner', kind: 'discard', count: 1, message: 'Discard 1.' })).toBe(false);
    expect(
      isPromptDockable(state, {
        id: 'p3',
        side: 'corp',
        kind: 'effect_cards',
        candidateIds: [handCard.instanceId],
        min: 1,
        max: 1,
        message: 'Pick from HQ.',
        source: { cardCode: '30001', instanceId: 'x', step: 's' },
      }),
    ).toBe(false);
    expect(
      isPromptDockable(state, {
        id: 'p4',
        side: 'runner',
        kind: 'effect_cards',
        candidateIds: [installedIce.instanceId],
        min: 1,
        max: 1,
        message: 'Pick installed ice.',
        source: { cardCode: '30001', instanceId: 'x', step: 's' },
      }),
    ).toBe(true);
    expect(
      isPromptDockable(state, {
        id: 'p5',
        side: 'runner',
        kind: 'effect_choice',
        options: [{ id: 'archives', label: 'Archives' }],
        message: 'Run which server?',
        source: { cardCode: '30018', instanceId: 'x', step: 's' },
      }),
    ).toBe(true);
    expect(
      isPromptDockable(state, {
        id: 'p6',
        side: 'runner',
        kind: 'access_trash',
        cardInstanceId: installedIce.instanceId,
        trashCost: 2,
        message: 'Access card.',
      }),
    ).toBe(true);

    const seat = { can: () => true, legal: [], waitingOn: 'runner' } as unknown as React.ContextType<typeof SeatContext>;
    const promptState = {
      ...state,
      pendingPrompts: [
        {
          id: 'p-choice',
          side: 'runner' as const,
          kind: 'effect_choice' as const,
          message: 'Red Team: run which central server?',
          options: [{ id: 'archives', label: 'Archives' }],
          source: { cardCode: '30018', instanceId: 'x', step: 'run' },
        },
      ],
    };

    const dockedChoiceHtml = renderToStaticMarkup(
      <SeatContext.Provider value={seat}>
        <PromptPanel
          state={promptState}
          onAnswer={() => {}}
          onCancel={() => {}}
          docked
          onToggleDock={() => {}}
          runContext={{ serverName: 'R&D', phase: 'access' }}
        />
      </SeatContext.Provider>,
    );
    expect(dockedChoiceHtml).toContain('data-testid="prompt-panel"');
    expect(dockedChoiceHtml).toContain('data-testid="prompt-panel-popout"');
    expect(dockedChoiceHtml).toContain('data-testid="prompt-cancel"');
    expect(dockedChoiceHtml).toContain('RUN // R&amp;D');
    expect(dockedChoiceHtml).not.toContain('data-testid="prompt-panel-handle"');

    const floatingChoiceHtml = renderToStaticMarkup(
      <SeatContext.Provider value={seat}>
        <PromptPanel state={promptState} onAnswer={() => {}} onToggleDock={() => {}} />
      </SeatContext.Provider>,
    );
    expect(floatingChoiceHtml).toContain('data-testid="prompt-panel-handle"');
    expect(floatingChoiceHtml).toContain('data-testid="prompt-panel-dock"');

    const mulliganState = {
      ...state,
      pendingPrompts: [
        { id: 'p-mulligan', side: 'corp' as const, kind: 'mulligan' as const, message: 'Corp: keep your opening hand or mulligan?' },
      ],
    };
    const mulliganHtml = renderToStaticMarkup(
      <SeatContext.Provider value={seat}>
        <PromptPanel state={mulliganState} onAnswer={() => {}} />
      </SeatContext.Provider>,
    );
    expect(mulliganHtml).toContain('data-testid="prompt-panel-handle"');
    expect(mulliganHtml).not.toContain('data-testid="prompt-panel-dock"');
  });

  it('registers two-way board card and server targets safely by owner without marking non-installed cards', () => {
    const state = newGame();
    const installedCard = state.corp.hq.pop()!;
    state.corp.servers.hq.root.push(installedCard);
    const handCard = state.corp.hq[0];

    const ownerA = {};
    const ownerB = {};
    setBoardTargets(ownerA, {
      cards: new Map([[installedCard.instanceId, { onClick: () => {} }], [handCard.instanceId, { onClick: () => {} }]]),
      servers: new Map([['archives', { onClick: () => {}, title: 'Archives target' }]]),
    });
    // Clearing with an old owner must not wipe active targets
    clearBoardTargets(ownerB);

    const zoomStore = createZoomStore();
    const targetedHtml = renderToStaticMarkup(
      <ZoomContext.Provider value={zoomStore}>
        <ServerColumn server={state.corp.servers.archives} activePlayer="runner" />
        <CardView card={installedCard} />
        <CardView card={handCard} notInstalled />
      </ZoomContext.Provider>,
    );
    expect(targetedHtml).toContain('data-server-target="true"');
    expect(targetedHtml).toContain('data-board-target="true"');
    // Only the installed card receives data-board-target, not the notInstalled hand card
    expect(targetedHtml.match(/data-board-target="true"/g)?.length).toBe(1);
    // A hand card the hand row lets a prompt target (the deciding side's own, faceup hand) takes the click too
    const handHtml = renderToStaticMarkup(
      <ZoomContext.Provider value={zoomStore}>
        <CardView card={handCard} notInstalled handTarget />
      </ZoomContext.Provider>,
    );
    expect(handHtml).toContain('data-board-target="true"');

    clearBoardTargets(ownerA);
    const clearedHtml = renderToStaticMarkup(
      <ZoomContext.Provider value={zoomStore}>
        <ServerColumn server={state.corp.servers.archives} activePlayer="runner" />
        <CardView card={installedCard} />
      </ZoomContext.Provider>,
    );
    expect(clearedHtml).not.toContain('data-server-target="true"');
    expect(clearedHtml).not.toContain('data-board-target="true"');
  });

  it('shows breaker and ice type icons on cards hosted in RigView while hiding facedown hosted secrets', () => {
    const state = newGame();
    const mk = (instanceId: string, cardCode: string, hostedCards?: typeof state.runner.grip) => ({
      instanceId,
      cardCode,
      isRezzed: true,
      advancementCounters: 0,
      tokens: {},
      hostedCardIds: [],
      ...(hostedCards ? { hostedCards } : {}),
    });

    state.runner.rig.hardware.push(
      mk('madani-1', '35028', [mk('hosted-cleaver', '30006')]),
      mk('bling-1', '35006', [mk('hosted-buzzsaw', '30005')]),
      mk('detente-1', '35018', [mk('hosted-palisade', '30072')]),
    );
    state.runner.rig.programs.push(
      mk('rws-1', '36022', [mk('hosted-secret-breaker', '30006')]),
    );

    const runnerHtml = renderToStaticMarkup(<RigView rig={state.runner.rig} breaks={breakerTypes} canSeeSecrets />);
    expect(runnerHtml).toContain('aria-label="Breaks Barrier"');
    expect(runnerHtml).toContain('aria-label="Breaks Code gate"');
    expect(runnerHtml).toContain('aria-label="Barrier"');
    expect(runnerHtml.match(/data-testid="breaker-types"/g)?.length).toBe(3);
    expect(runnerHtml.match(/data-testid="ice-types"/g)?.length).toBe(1);

    const corpHtml = renderToStaticMarkup(<RigView rig={state.runner.rig} breaks={breakerTypes} canSeeSecrets={false} />);
    expect(corpHtml.match(/data-testid="breaker-types"/g)?.length).toBe(2);
    expect(corpHtml.match(/data-testid="ice-types"/g)?.length).toBe(1);
  });
});
