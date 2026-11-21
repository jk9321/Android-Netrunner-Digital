/**
 * Mobile UI Phase 1 smoke & invariant tests:
 * - Viewport mode detection (`detectViewportMode`, `isMobileViewport`)
 * - Isolated phone shell (`MobileGameShell`), compact HUD (`MobileTopBar`, `MobileSideStatus`),
 *   fixed thumb cockpit (`MobileThumbCockpit`), and portal bottom sheet (`MobileBottomSheet`)
 * - Secret-visibility invariant: opponent hand card titles never leak into mobile status/shell markup
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { cardDef } from '../src/core';
import { STARTER_DECKS } from '../src/data/decks';
import { LocalTable } from '../src/ui/table';
import { SeatContext } from '../src/ui/seat';
import { GameStateContext } from '../src/ui/liveValues';
import type { GameController } from '../src/ui/useGameController';
import type { Viewer } from '../src/ui/viewer';
import { detectViewportMode, isMobileViewport } from '../src/ui/mobile/useViewportMode';
import { MobileBottomSheet } from '../src/ui/mobile/MobileBottomSheet';
import { MobileSideStatus, MobileTopBar } from '../src/ui/mobile/MobileHud';
import { MobileThumbCockpit } from '../src/ui/mobile/MobileThumbCockpit';
import { MobileGameShell } from '../src/ui/mobile/MobileGameShell';
import { newGame, startRunnerTurn } from './helpers';

const corpStarter = STARTER_DECKS.find(d => d.side === 'corp')!;
const runnerStarter = STARTER_DECKS.find(d => d.side === 'runner')!;

function stubBrowser(matchesMap: Record<string, boolean> = {}) {
  const store = new Map<string, string>();
  vi.stubGlobal('window', {
    localStorage: {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, String(v)),
      removeItem: (k: string) => void store.delete(k),
    },
    location: { origin: 'https://example.test', pathname: '/' },
    matchMedia: (query: string) => ({
      matches: Boolean(matchesMap[query]),
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
    }),
    addEventListener: () => {},
    removeEventListener: () => {},
  });
  vi.stubGlobal('document', {
    documentElement: { dataset: {} },
  });
}

function makeController(viewer: Viewer, opts?: { runnerTurn?: boolean }): { ctl: GameController; realState: ReturnType<typeof newGame> } {
  const realState = newGame(12345);
  if (opts?.runnerTurn) startRunnerTurn(realState);
  const table = new LocalTable(realState, null, {
    confirm: async () => true,
    alert: () => {},
  });
  const seat = table.seatFor(viewer);
  const ctl: GameController = {
    seat,
    gameState: seat.state,
    handleAction: async () => {},
    cancelChoice: undefined,
    selectedCardId: null,
    setSelectedCardId: () => {},
    viewMode: viewer === 'both' ? 'open' : viewer,
    setViewMode: () => {},
    hotseatSide: viewer === 'runner' ? 'runner' : 'corp',
    setHotseatSide: () => {},
    accessed: [],
    clearAccessed: () => {},
    fates: [],
    aiSide: null,
    humanSide: viewer === 'both' ? null : viewer,
    rezWindow: null,
    rezWindowOpen: false,
    passWindow: async () => {},
    stops: 'auto',
    setStops: () => {},
    viewer,
    handoffTo: null,
    corpCanAct: viewer === 'corp' || viewer === 'both',
    runnerCanAct: viewer === 'runner' || viewer === 'both',
    aiThinking: false,
    online: null,
  };
  return { ctl, realState };
}

beforeEach(() => stubBrowser());
afterEach(() => vi.unstubAllGlobals());

describe('viewport mode detection', () => {
  it('defaults to desktop when matchMedia is unavailable (SSR)', () => {
    vi.stubGlobal('window', undefined);
    expect(detectViewportMode()).toBe('desktop');
    expect(isMobileViewport('desktop')).toBe(false);
    expect(isMobileViewport('tablet')).toBe(false);
    expect(isMobileViewport('mobile-portrait')).toBe(true);
    expect(isMobileViewport('mobile-landscape')).toBe(true);
  });

  it('classifies portrait phone, landscape phone, tablet, and desktop accurately', () => {
    stubBrowser({ '(max-width: 767px)': true });
    expect(detectViewportMode()).toBe('mobile-portrait');

    stubBrowser({ '(max-height: 500px) and (max-width: 1023px) and (orientation: landscape)': true });
    expect(detectViewportMode()).toBe('mobile-landscape');

    stubBrowser({ '(min-width: 768px) and (max-width: 1023px)': true });
    expect(detectViewportMode()).toBe('tablet');

    stubBrowser({});
    expect(detectViewportMode()).toBe('desktop');
  });
});

describe('MobileHud components', () => {
  it('MobileTopBar renders compact controls, scores, turn/clicks, stops, and online badge', () => {
    const state = newGame(77);
    startRunnerTurn(state);
    const html = renderToStaticMarkup(
      <MobileTopBar
        state={state}
        online={{
          code: 'ABCD-12',
          token: 'tok',
          side: 'runner',
          status: 'open',
          opponentConnected: true,
          waitingForOpponent: false,
          over: null,
          takeOver: () => {},
        }}
        aiThinking={false}
        stops="auto"
        onStops={() => {}}
        onOpenMenu={() => {}}
        onOpenZone={() => {}}
      />,
    );
    expect(html).toContain('data-testid="mobile-top-bar"');
    expect(html).toContain('data-testid="mobile-menu-button"');
    expect(html).toContain('data-testid="header-corp-score"');
    expect(html).toContain('data-testid="header-runner-score"');
    expect(html).toContain('data-testid="stops-toggle"');
    expect(html).toContain('data-testid="online-connection"');
    expect(html).toContain('4/4');
  });

  it('MobileSideStatus hides opponent hand contents without leaking card titles', () => {
    const { ctl: runnerCtl, realState } = makeController('runner', { runnerTurn: true });
    const corpStatusHtml = renderToStaticMarkup(
      <MobileSideStatus
        side="corp"
        edge="top"
        state={runnerCtl.gameState}
        viewer="runner"
        onInspect={() => {}}
        onOpenZone={() => {}}
      />,
    );
    expect(corpStatusHtml).toContain('data-testid="mobile-status-corp"');
    expect(corpStatusHtml).toContain('HQ');
    expect(corpStatusHtml).toContain(`${realState.corp.hq.length}/${realState.corp.handSizeLimit}`);
    for (const card of realState.corp.hq) {
      expect(corpStatusHtml).not.toContain(cardDef(card).title);
    }

    const { ctl: corpCtl } = makeController('corp');
    const runnerStatusHtml = renderToStaticMarkup(
      <MobileSideStatus
        side="runner"
        edge="top"
        state={corpCtl.gameState}
        viewer="corp"
        onInspect={() => {}}
        onOpenZone={() => {}}
      />,
    );
    expect(runnerStatusHtml).toContain('data-testid="mobile-status-runner"');
    expect(runnerStatusHtml).toContain('Grip');
    for (const card of realState.runner.grip) {
      expect(runnerStatusHtml).not.toContain(cardDef(card).title);
    }
  });
});

describe('MobileThumbCockpit & MobileBottomSheet', () => {
  const idleRunnerFlow = {
    makingRoom: null,
    setMakingRoom: () => {},
    pendingTrash: null,
    setPendingTrash: () => {},
    pickingHost: null,
    setPickingHost: () => {},
  };

  it('renders tucked vs expanded Peeking Hand Tray, selected card action bar, and ⚡n chip', () => {
    const { ctl } = makeController('runner', { runnerTurn: true });
    const firstCard = ctl.gameState.runner.grip[0];

    const tuckedHtml = renderToStaticMarkup(
      <SeatContext.Provider value={ctl.seat}>
        <MobileThumbCockpit
          state={ctl.gameState}
          side="runner"
          canAct
          handCards={ctl.gameState.runner.grip}
          handSizeLimit={ctl.gameState.runner.handSizeLimit}
          selectedCardId={null}
          onSelectCard={() => {}}
          onInspect={() => {}}
          onAction={() => {}}
          handExpanded={false}
          onHandExpandedChange={() => {}}
          abilityCount={0}
          onOpenAbilities={() => {}}
          onOpenLog={() => {}}
          hasUnreadLog={false}
          onOpenCorpInstall={() => {}}
          runnerFlow={idleRunnerFlow}
          aiThinking={false}
        />
      </SeatContext.Provider>,
    );
    expect(tuckedHtml).toContain('data-testid="mobile-thumb-cockpit"');
    expect(tuckedHtml).toContain('h-[42px]');
    expect(tuckedHtml).toContain('Expand');
    expect(tuckedHtml).toContain('data-testid="end-turn"');
    expect(tuckedHtml).not.toContain('data-testid="mobile-abilities-chip"');
    expect(tuckedHtml).not.toContain('data-testid="mobile-selected-card-bar"');

    const expandedHtml = renderToStaticMarkup(
      <SeatContext.Provider value={ctl.seat}>
        <MobileThumbCockpit
          state={ctl.gameState}
          side="runner"
          canAct
          handCards={ctl.gameState.runner.grip}
          handSizeLimit={ctl.gameState.runner.handSizeLimit}
          selectedCardId={firstCard.instanceId}
          onSelectCard={() => {}}
          onInspect={() => {}}
          onAction={() => {}}
          handExpanded
          onHandExpandedChange={() => {}}
          abilityCount={2}
          onOpenAbilities={() => {}}
          onOpenLog={() => {}}
          hasUnreadLog
          onOpenCorpInstall={() => {}}
          runnerFlow={idleRunnerFlow}
          aiThinking={false}
        />
      </SeatContext.Provider>,
    );
    expect(expandedHtml).toContain('h-[98px]');
    expect(expandedHtml).toContain('Tuck');
    expect(expandedHtml).toContain('data-testid="mobile-selected-card-bar"');
    expect(expandedHtml).toContain('data-testid="mobile-play-selected"');
    expect(expandedHtml).toContain('data-testid="mobile-abilities-chip"');
    expect(expandedHtml).toContain(cardDef(firstCard).title);
  });

  it('MobileBottomSheet handles closed, open, and peek states cleanly in SSR', () => {
    expect(
      renderToStaticMarkup(
        <MobileBottomSheet open={false} title="Hidden" onClose={() => {}}>
          <p>Nope</p>
        </MobileBottomSheet>,
      ),
    ).toBe('');

    const openHtml = renderToStaticMarkup(
      <MobileBottomSheet
        open
        title="Install Ice"
        subtitle="Pick a server"
        onClose={() => {}}
        onTogglePeek={() => {}}
        footer={<button type="button">Confirm</button>}
        testId="test-sheet"
      >
        <p>Server list</p>
      </MobileBottomSheet>,
    );
    expect(openHtml).toContain('data-testid="test-sheet"');
    expect(openHtml).toContain('Install Ice');
    expect(openHtml).toContain('Server list');
    expect(openHtml).toContain('Confirm');
    expect(openHtml).toContain('data-testid="test-sheet-peek-btn"');

    const peekHtml = renderToStaticMarkup(
      <MobileBottomSheet
        open
        peeking
        peekLabel="Servers"
        title="Install Ice"
        onTogglePeek={() => {}}
        testId="test-sheet"
      >
        <p>Server list</p>
      </MobileBottomSheet>,
    );
    expect(peekHtml).toContain('data-testid="test-sheet-peek"');
    expect(peekHtml).toContain('data-testid="test-sheet-restore"');
    expect(peekHtml).toContain('Servers');
    expect(peekHtml).not.toContain('Server list');
  });
});

describe('MobileGameShell smoke & secret safety', () => {
  const localConfig = {
    seed: 12345,
    corpDeck: corpStarter,
    runnerDeck: runnerStarter,
    ai: null,
    difficulty: 'normal' as const,
  };

  it('renders Runner phone shell without leaking Corp HQ card titles', () => {
    const { ctl, realState } = makeController('runner', { runnerTurn: true });
    const html = renderToStaticMarkup(
      <GameStateContext.Provider value={ctl.gameState}>
        <SeatContext.Provider value={ctl.seat}>
          <MobileGameShell
            ctl={ctl}
            config={localConfig}
            onNewGame={() => {}}
            onConcede={() => {}}
            onLeave={() => {}}
            onViewMode={() => {}}
            shiftSide={null}
          />
        </SeatContext.Provider>
      </GameStateContext.Provider>,
    );
    expect(html).toContain('data-testid="mobile-game-shell"');
    expect(html).toContain('data-testid="mobile-top-bar"');
    expect(html).toContain('data-testid="mobile-thumb-cockpit"');
    expect(html).toContain('data-testid="hand-dock-runner"');
    // Corp board sits on top when viewing as Runner
    expect(html.indexOf('id="corp-board"')).toBeLessThan(html.indexOf('id="runner-board"'));
    for (const card of realState.corp.hq) {
      expect(html).not.toContain(cardDef(card).title);
    }
  });

  it('mirrors boards for Corp view so Corp servers sit directly above the thumb cockpit', () => {
    const { ctl, realState } = makeController('corp');
    const html = renderToStaticMarkup(
      <GameStateContext.Provider value={ctl.gameState}>
        <SeatContext.Provider value={ctl.seat}>
          <MobileGameShell
            ctl={ctl}
            config={localConfig}
            onNewGame={() => {}}
            onConcede={() => {}}
            onLeave={() => {}}
            onViewMode={() => {}}
            shiftSide={null}
          />
        </SeatContext.Provider>
      </GameStateContext.Provider>,
    );
    expect(html).toContain('data-testid="hand-dock-corp"');
    // Runner board sits on top and Corp board sits on bottom when viewing as Corp
    expect(html.indexOf('id="runner-board"')).toBeLessThan(html.indexOf('id="corp-board"'));
    for (const card of realState.runner.grip) {
      expect(html).not.toContain(cardDef(card).title);
    }
  });
});
