/**
 * Mobile UI Phase 1 smoke & invariant tests:
 * - Viewport mode detection (`detectViewportMode`, `isMobileViewport`)
 * - Isolated phone shell (`MobileGameShell`), compact HUD (`MobileTopBar`, `MobileSideStatus`),
 *   fixed thumb cockpit (`MobileThumbCockpit`), and portal bottom sheet (`MobileBottomSheet`)
 * - Secret-visibility invariant: opponent hand card titles never leak into mobile status/shell markup
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { cardDef, executeAction } from '../src/core';
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
import { MobileCorpBoard } from '../src/ui/mobile/MobileCorpBoard';
import { MobileRunnerBoard } from '../src/ui/mobile/MobileRunnerBoard';
import { MobileCardSheet } from '../src/ui/mobile/MobileCardSheet';
import { MobileServerSheet } from '../src/ui/mobile/MobileServerSheet';
import { MobileRunSheet } from '../src/ui/mobile/MobileRunSheet';
import { MobilePromptSheet } from '../src/ui/mobile/MobilePromptSheet';
import { MobileAccessedBanner } from '../src/ui/mobile/MobileAccessedBanner';
import { MobileGameShell } from '../src/ui/mobile/MobileGameShell';
import { installForTest, newGame, newGameAtSetup, startRunnerTurn } from './helpers';

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
    expect(tuckedHtml).toContain('h-[44px]');
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

describe('Phase 2 compact mobile boards & tap-to-act sheets', () => {
  it('MobileCorpBoard renders compact 28px ice strips and hides unrezzed titles from Runner', () => {
    const state = newGame(2026);
    const iceId = installForTest(state, 'ice', 'remote1', 'ice');
    const agendaId = installForTest(state, 'agenda', 'remote1', 'root');
    const realIce = state.corp.servers.remote1.ice.find(c => c.instanceId === iceId)!;
    const realAgenda = state.corp.servers.remote1.root.find(c => c.instanceId === agendaId)!;
    startRunnerTurn(state);

    const table = new LocalTable(state, null, { confirm: async () => true, alert: () => {} });
    const runnerSeat = table.seatFor('runner');
    const runnerHtml = renderToStaticMarkup(
      <MobileCorpBoard
        gameState={runnerSeat.state}
        seat={runnerSeat}
        viewer="runner"
        runnerCanAct
        actionableCardIds={new Set()}
        mirrored={false}
        onTapCard={() => {}}
        onTapServer={() => {}}
        onOpenZone={() => {}}
      />,
    );
    expect(runnerHtml).toContain('data-testid="mobile-corp-board"');
    expect(runnerHtml).toContain('data-testid="mobile-corp-servers"');
    expect(runnerHtml).toContain('min-h-[26px]');
    expect(runnerHtml).toContain('min-w-[82px]');
    expect(runnerHtml).toContain('Unrezzed');
    expect(runnerHtml).toContain('Face-down');
    expect(runnerHtml).not.toContain(cardDef(realIce).title);
    expect(runnerHtml).not.toContain(cardDef(realAgenda).title);

    // Corp sees its own unrezzed cards and gets actionable indicators, with mt-auto (never justify-end) on mirrored scroll body
    const corpSeat = table.seatFor('corp');
    const corpHtml = renderToStaticMarkup(
      <MobileCorpBoard
        gameState={corpSeat.state}
        seat={corpSeat}
        viewer="corp"
        runnerCanAct={false}
        actionableCardIds={new Set([corpSeat.state.corp.servers.remote1.ice[0].instanceId])}
        mirrored
        onTapCard={() => {}}
        onTapServer={() => {}}
        onOpenZone={() => {}}
      />,
    );
    expect(corpHtml).toContain(cardDef(realIce).title);
    expect(corpHtml).toContain(cardDef(realAgenda).title);
    expect(corpHtml).toContain('data-testid="mobile-server-scroll-remote1"');
    expect(corpHtml).toContain('mt-auto');
    expect(corpHtml).not.toContain('justify-end');
    expect(corpHtml).toContain('overscroll-y-contain');
    expect(corpHtml).not.toContain('overscroll-contain');
  });

  it('MobileRunnerBoard renders Programs/Support rows and mirrors Programs toward Corp ice', () => {
    const state = newGame(3030);
    const prog = state.runner.stack.find(c => cardDef(c).type_code === 'program')!;
    const hw = state.runner.stack.find(c => cardDef(c).type_code === 'hardware')!;
    state.runner.rig.programs.push(prog);
    state.runner.rig.hardware.push(hw);

    const normalHtml = renderToStaticMarkup(
      <MobileRunnerBoard
        gameState={state}
        viewer="runner"
        actionableCardIds={new Set([prog.instanceId])}
        mirrored={false}
        onTapCard={() => {}}
        onOpenZone={() => {}}
      />,
    );
    expect(normalHtml).toContain('data-testid="mobile-runner-board"');
    expect(normalHtml).toContain(cardDef(prog).title);
    expect(normalHtml).toContain(cardDef(hw).title);
    expect(normalHtml.indexOf('mobile-rig-programs')).toBeLessThan(normalHtml.indexOf('mobile-rig-support'));

    const mirroredHtml = renderToStaticMarkup(
      <MobileRunnerBoard
        gameState={state}
        viewer="corp"
        actionableCardIds={new Set()}
        mirrored
        onTapCard={() => {}}
        onOpenZone={() => {}}
      />,
    );
    expect(mirroredHtml.indexOf('mobile-rig-support')).toBeLessThan(mirroredHtml.indexOf('mobile-rig-programs'));
  });

  it('MobileCardSheet hides unrezzed Corp secrets from Runner while offering Run shortcut, and shows Advance/Rez to Corp', () => {
    const state = newGame(4040);
    const agendaId = installForTest(state, 'agenda', 'remote1', 'root');
    const realAgenda = state.corp.servers.remote1.root.find(c => c.instanceId === agendaId)!;

    // Corp turn: Corp taps its own unrezzed agenda and sees Advance button + real title
    const corpTable = new LocalTable(state, null, { confirm: async () => true, alert: () => {} });
    const corpSeat = corpTable.seatFor('corp');
    const corpAgendaId = corpSeat.state.corp.servers.remote1.root[0].instanceId;
    const corpSheetHtml = renderToStaticMarkup(
      <SeatContext.Provider value={corpSeat}>
        <MobileCardSheet
          state={corpSeat.state}
          cardId={corpAgendaId}
          viewer="corp"
          corpCanAct
          runnerCanAct={false}
          onAction={() => {}}
          onClose={() => {}}
          onSelectCardId={() => {}}
          onOpenFullZoom={() => {}}
        />
      </SeatContext.Provider>,
    );
    expect(corpSheetHtml).toContain('data-testid="mobile-card-sheet"');
    expect(corpSheetHtml).toContain(cardDef(realAgenda).title);
    expect(corpSheetHtml).toContain('data-testid="mobile-action-advance"');

    // Runner turn: Runner taps that unrezzed root card — title MUST NOT leak, Run shortcut offered
    startRunnerTurn(state);
    const runnerTable = new LocalTable(state, null, { confirm: async () => true, alert: () => {} });
    const runnerSeat = runnerTable.seatFor('runner');
    const runnerAgendaId = runnerSeat.state.corp.servers.remote1.root[0].instanceId;
    const runnerSheetHtml = renderToStaticMarkup(
      <SeatContext.Provider value={runnerSeat}>
        <MobileCardSheet
          state={runnerSeat.state}
          cardId={runnerAgendaId}
          viewer="runner"
          corpCanAct={false}
          runnerCanAct
          onAction={() => {}}
          onClose={() => {}}
          onSelectCardId={() => {}}
          onOpenFullZoom={() => {}}
        />
      </SeatContext.Provider>,
    );
    expect(runnerSheetHtml).toContain('Unrezzed Corp Card');
    expect(runnerSheetHtml).toContain('data-testid="mobile-action-run-server"');
    expect(runnerSheetHtml).not.toContain(cardDef(realAgenda).title);
  });

  it('MobileServerSheet renders Run button and hides unrezzed ice titles from Runner', () => {
    const state = newGame(5050);
    const iceId = installForTest(state, 'ice', 'rd', 'ice');
    const realIce = state.corp.servers.rd.ice.find(c => c.instanceId === iceId)!;
    startRunnerTurn(state);

    const table = new LocalTable(state, null, { confirm: async () => true, alert: () => {} });
    const runnerSeat = table.seatFor('runner');
    const html = renderToStaticMarkup(
      <SeatContext.Provider value={runnerSeat}>
        <MobileServerSheet
          state={runnerSeat.state}
          serverId="rd"
          viewer="runner"
          runnerCanAct
          actionableCardIds={new Set()}
          onAction={() => {}}
          onSelectCard={() => {}}
          onOpenZone={() => {}}
          onClose={() => {}}
        />
      </SeatContext.Provider>,
    );
    expect(html).toContain('data-testid="mobile-server-sheet"');
    expect(html).toContain('data-testid="mobile-run-rd"');
    expect(html).toContain('Unrezzed Ice');
    expect(html).not.toContain(cardDef(realIce).title);
  });
});

describe('Phase 3 peekable run/prompt sheets & accessed banner', () => {
  function ctlFromState(state: ReturnType<typeof newGame>, viewer: Viewer): GameController {
    const table = new LocalTable(state, null, { confirm: async () => true, alert: () => {} });
    const seat = table.seatFor(viewer);
    return {
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
  }

  it('MobileRunSheet renders active run in peekable bottom sheet and hides when paused for a prompt', () => {
    const base = newGame(6060);
    startRunnerTurn(base);
    const running = executeAction(base, { type: 'INITIATE_RUN', player: 'runner', targetServerId: 'rd' });
    const ctl = ctlFromState(running, 'runner');

    const html = renderToStaticMarkup(
      <GameStateContext.Provider value={ctl.gameState}>
        <SeatContext.Provider value={ctl.seat}>
          <MobileRunSheet ctl={ctl} onInspectCard={() => {}} />
        </SeatContext.Provider>
      </GameStateContext.Provider>,
    );
    expect(html).toContain('data-testid="mobile-run-sheet"');
    expect(html).toContain('data-testid="mobile-run-sheet-peek-btn"');
    expect(html).toContain('data-testid="run-overlay"');
    expect(html).toContain('RUN // R&amp;D');

    const hiddenHtml = renderToStaticMarkup(
      <GameStateContext.Provider value={ctl.gameState}>
        <SeatContext.Provider value={ctl.seat}>
          <MobileRunSheet ctl={ctl} hidden onInspectCard={() => {}} />
        </SeatContext.Provider>
      </GameStateContext.Provider>,
    );
    expect(hiddenHtml).toBe('');
  });

  it('MobilePromptSheet renders peekable decision sheet for acting side and non-blocking pill for waiting side', () => {
    const setupState = newGameAtSetup(7070);
    // Corp mulligans first at setup
    const corpCtl = ctlFromState(setupState, 'corp');
    const corpHtml = renderToStaticMarkup(
      <GameStateContext.Provider value={corpCtl.gameState}>
        <SeatContext.Provider value={corpCtl.seat}>
          <MobilePromptSheet ctl={corpCtl} ended={false} onInspectCard={() => {}} />
        </SeatContext.Provider>
      </GameStateContext.Provider>,
    );
    expect(corpHtml).toContain('data-testid="mobile-prompt-sheet"');
    expect(corpHtml).toContain('data-testid="mobile-prompt-sheet-peek-btn"');
    expect(corpHtml).toContain('data-testid="prompt-panel"');

    // Runner waits while Corp decides — non-blocking top pill, no bottom sheet
    const runnerCtl = ctlFromState(setupState, 'runner');
    const runnerHtml = renderToStaticMarkup(
      <GameStateContext.Provider value={runnerCtl.gameState}>
        <SeatContext.Provider value={runnerCtl.seat}>
          <MobilePromptSheet ctl={runnerCtl} ended={false} onInspectCard={() => {}} />
        </SeatContext.Provider>
      </GameStateContext.Provider>,
    );
    expect(runnerHtml).toContain('data-testid="mobile-prompt-waiting"');
    expect(runnerHtml).toContain('Waiting on the Corp to decide');
    expect(runnerHtml).not.toContain('data-testid="mobile-prompt-sheet"');
  });

  it('MobileAccessedBanner renders visible cards and hides secret R&D accesses from Corp', () => {
    const state = newGame(8080);
    const sampleCard = state.corp.rd[0];
    const html = renderToStaticMarkup(
      <MobileAccessedBanner
        cards={[
          { code: sampleCard.cardCode },
          {},
        ]}
        onInspect={() => {}}
        onClose={() => {}}
      />,
    );
    expect(html).toContain('data-testid="mobile-accessed-banner"');
    expect(html).toContain('Accessed this run (2)');
    expect(html).toContain(cardDef(sampleCard).title);
    expect(html).toContain('data-testid="mobile-accessed-hidden"');
    expect(html).toContain('R&amp;D Card (hidden)');
  });

  it('MobileGameShell switches to side-by-side compact layout in landscape mode', () => {
    const { ctl } = makeController('runner', { runnerTurn: true });
    const html = renderToStaticMarkup(
      <GameStateContext.Provider value={ctl.gameState}>
        <SeatContext.Provider value={ctl.seat}>
          <MobileGameShell
            ctl={ctl}
            config={{ seed: 12345, corpDeck: corpStarter, runnerDeck: runnerStarter, ai: null, difficulty: 'normal' }}
            onNewGame={() => {}}
            onConcede={() => {}}
            onLeave={() => {}}
            onViewMode={() => {}}
            shiftSide={null}
            landscape
          />
        </SeatContext.Provider>
      </GameStateContext.Provider>,
    );
    expect(html).toContain('data-layout="landscape"');
    expect(html).toContain('flex-row');
    expect(html).toContain('h-[36px]');
  });

  it('MobileCardSheet masks Read-Write Share facedown hosted cards from Corp while showing them to Runner', () => {
    const state = newGame(9090);
    const secretGripCard = state.runner.grip[0];
    const rws = {
      instanceId: 'rws-test-1',
      cardCode: '36022', // Read-Write Share (hostedFaceDown: true)
      isRezzed: true,
      advancementCounters: 0,
      tokens: {},
      hostedCardIds: [],
      hostedCards: [secretGripCard],
    };
    state.runner.rig.programs.push(rws);

    const corpCtl = ctlFromState(state, 'corp');
    const corpRwsId = corpCtl.gameState.runner.rig.programs.find(p => p.cardCode === '36022')!.instanceId;
    const corpHtml = renderToStaticMarkup(
      <SeatContext.Provider value={corpCtl.seat}>
        <MobileCardSheet
          state={corpCtl.gameState}
          cardId={corpRwsId}
          viewer="corp"
          corpCanAct
          runnerCanAct={false}
          onAction={() => {}}
          onClose={() => {}}
          onSelectCardId={() => {}}
          onOpenFullZoom={() => {}}
        />
      </SeatContext.Provider>,
    );
    expect(corpHtml).toContain('data-testid="mobile-hosted-hidden"');
    expect(corpHtml).toContain('Facedown hosted card');
    expect(corpHtml).not.toContain(cardDef(secretGripCard).title);

    const runnerCtl = ctlFromState(state, 'runner');
    const runnerRwsId = runnerCtl.gameState.runner.rig.programs.find(p => p.cardCode === '36022')!.instanceId;
    const runnerHtml = renderToStaticMarkup(
      <SeatContext.Provider value={runnerCtl.seat}>
        <MobileCardSheet
          state={runnerCtl.gameState}
          cardId={runnerRwsId}
          viewer="runner"
          corpCanAct={false}
          runnerCanAct
          onAction={() => {}}
          onClose={() => {}}
          onSelectCardId={() => {}}
          onOpenFullZoom={() => {}}
        />
      </SeatContext.Provider>,
    );
    expect(runnerHtml).toContain(cardDef(secretGripCard).title);
    expect(runnerHtml).not.toContain('data-testid="mobile-hosted-hidden"');
  });

  it('MobileThumbCockpit renders non-active side WindowBar Pass button in Open Table priority windows', () => {
    const state = newGame(9191);
    // Corp is active player, but Runner holds priority in an outside-run window
    state.priority = {
      step: 'corp_action',
      holder: 'runner',
      received: true,
      intent: { type: 'END_TURN', player: 'corp' },
    };
    const openCtl = ctlFromState(state, 'both');
    const idleFlow = {
      makingRoom: null,
      setMakingRoom: () => {},
      pendingTrash: null,
      setPendingTrash: () => {},
      pickingHost: null,
      setPickingHost: () => {},
    };
    const html = renderToStaticMarkup(
      <SeatContext.Provider value={openCtl.seat}>
        <MobileThumbCockpit
          state={openCtl.gameState}
          side="corp"
          canAct
          corpCanAct
          runnerCanAct
          handCards={openCtl.gameState.corp.hq}
          handSizeLimit={openCtl.gameState.corp.handSizeLimit}
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
          runnerFlow={idleFlow}
          aiThinking={false}
        />
      </SeatContext.Provider>,
    );
    expect(html).toContain('data-testid="window-pass-runner"');
  });

  it('MobileThumbCockpit renders ice and breaker subtype icons on tucked hand strips', () => {
    const state = newGame(4242);
    // Put Palisade (Barrier ice, 30072) in HQ and Cleaver (Fracter breaker, 30006) in Grip
    state.corp.hq[0].cardCode = '30072';
    state.runner.grip[0].cardCode = '30006';
    const idleFlow = {
      makingRoom: null,
      setMakingRoom: () => {},
      pendingTrash: null,
      setPendingTrash: () => {},
      pickingHost: null,
      setPickingHost: () => {},
    };

    const corpCtl = ctlFromState(state, 'corp');
    const corpHtml = renderToStaticMarkup(
      <SeatContext.Provider value={corpCtl.seat}>
        <MobileThumbCockpit
          state={corpCtl.gameState}
          side="corp"
          canAct
          handCards={corpCtl.gameState.corp.hq}
          handSizeLimit={corpCtl.gameState.corp.handSizeLimit}
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
          runnerFlow={idleFlow}
          aiThinking={false}
        />
      </SeatContext.Provider>,
    );
    expect(corpHtml).toContain('data-testid="ice-types"');
    expect(corpHtml).toContain('aria-label="Barrier"');

    const runnerCtl = ctlFromState(state, 'runner');
    const runnerHtml = renderToStaticMarkup(
      <SeatContext.Provider value={runnerCtl.seat}>
        <MobileThumbCockpit
          state={runnerCtl.gameState}
          side="runner"
          canAct
          handCards={runnerCtl.gameState.runner.grip}
          handSizeLimit={runnerCtl.gameState.runner.handSizeLimit}
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
          runnerFlow={idleFlow}
          aiThinking={false}
        />
      </SeatContext.Provider>,
    );
    expect(runnerHtml).toContain('data-testid="breaker-types"');
    expect(runnerHtml).toContain('aria-label="Breaks Barrier"');
  });
});
