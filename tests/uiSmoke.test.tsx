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
import { createZoomStore } from '../src/ui/components/ZoomPanel';
import { RunOverlay } from '../src/ui/components/RunOverlay';
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

describe('zoom store hover tracking', () => {
  it('tracks active hover state separately from sticky zoom target', () => {
    const state = newGame();
    const cardA = state.corp.hq[0];
    const cardB = state.runner.grip[0];
    const store = createZoomStore();

    expect(store.get()).toBeNull();
    expect(store.isHovering()).toBe(false);

    store.show({ card: cardA, hidden: false });
    expect(store.get()?.card.instanceId).toBe(cardA.instanceId);
    expect(store.isHovering()).toBe(true);

    // Leaving a different card does not clear current hover
    store.leave(cardB.instanceId);
    expect(store.isHovering()).toBe(true);

    // Leaving the hovered card clears isHovering while keeping sticky current
    store.leave(cardA.instanceId);
    expect(store.isHovering()).toBe(false);
    expect(store.get()?.card.instanceId).toBe(cardA.instanceId);

    store.clear();
    expect(store.isHovering()).toBe(false);
    expect(store.get()).toBeNull();
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
    for (const id of ['home-logo', 'stops-toggle', 'card-size', 'auto-fit', 'view-mode', 'settings-button', 'forfeit', 'mobile-menu-button']) {
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
});
