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
import { SideStrip } from '../src/ui/components/SideStrip';
import { removedCardsForSide, zoneContents } from '../src/ui/components/ZoneViewer';
import { DockedHandBar } from '../src/ui/components/HandRow';
import { CorpActions, RunnerActions } from '../src/ui/components/ActionBars';
import { AccessedPanel } from '../src/ui/components/AccessedPanel';
import { AudioFxControls } from '../src/ui/components/GameSettingsControls';
import { flipHotseatBoardsEnabled, setFlipHotseatBoardsEnabled } from '../src/ui/boardFlip';
import { CardView } from '../src/ui/components/CardView';
import { RigView } from '../src/ui/components/RigView';
import { breakerTypes } from '../src/ui/components/IceTypeIcons';
import { ZoomContext, createZoomStore } from '../src/ui/components/ZoomPanel';
import { clearBoardTargets, setBoardTargets } from '../src/ui/promptHighlight';
import { SeatContext } from '../src/ui/seat';
import { AbilityBar, abilityActionKey } from '../src/ui/components/AbilityBar';
import { EncounterPanel } from '../src/ui/components/EncounterPanel';
import { HandoffScreen } from '../src/ui/components/HandoffScreen';
import { DeckListColumn } from '../src/ui/components/DeckListColumn';
import { summarize } from '../src/ui/deckPickerUtils';
import { executeAction, findCardAnywhere } from '../src/core';
import { installCorpForTest, installIceForTest, installProgramForTest, newGame, startRunnerTurn } from './helpers';

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
    expect(localHtml).not.toContain('SEED 98765');
    expect(localHtml).toContain('aria-label="Leave game"');
    expect(localHtml).toContain('aria-label="Forfeit (Runner concedes)"');

    const thinkingHtml = renderToStaticMarkup(
      <GameHeader
        state={state}
        config={{ seed: 98765, corpDeck: corpStarter, runnerDeck: runnerStarter, ai: 'corp', difficulty: 'normal' }}
        aiThinking={true}
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
    expect(thinkingHtml).toContain('data-testid="ai-status"');
    // Stops toggle keeps its AUTO label while AI THINKING renders in its own status badge
    expect(thinkingHtml).toMatch(/data-testid="stops-toggle"[^>]*>.*?AUTO<\/span><\/button>/);

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

  it('SideStrip omits duplicate pile pills, keeps score pills, and renders opponent mini card-back fan when hidden', () => {
    const state = newGame();
    // Runner viewing Corp strip: Corp hand is hidden -> mini card-back fan appears, no R&D/Archives pile pills, Scored stays
    const corpAsRunner = renderToStaticMarkup(
      <SideStrip side="corp" state={state} viewer="runner" onInspect={() => {}} onOpenZone={() => {}} />,
    );
    expect(corpAsRunner).toContain('data-testid="hand-corp"');
    expect(corpAsRunner).toContain('data-opponent-hand="true"');
    expect(corpAsRunner).toContain('data-testid="zone-corp-score"');
    expect(corpAsRunner).not.toContain('data-testid="zone-archives"');
    expect(corpAsRunner).not.toContain('View ID');

    // Corp viewing own strip: hand is docked at top, so no opponent badge in strip
    const corpAsCorp = renderToStaticMarkup(
      <SideStrip side="corp" state={state} viewer="corp" onInspect={() => {}} onOpenZone={() => {}} />,
    );
    expect(corpAsCorp).not.toContain('data-opponent-hand="true"');

    // Corp viewing Runner strip: Runner hand is hidden -> mini card-back fan appears, no Heap pill, Stolen stays
    const runnerAsCorp = renderToStaticMarkup(
      <SideStrip side="runner" state={state} viewer="corp" onInspect={() => {}} onOpenZone={() => {}} />,
    );
    expect(runnerAsCorp).toContain('data-testid="hand-runner"');
    expect(runnerAsCorp).toContain('data-opponent-hand="true"');
    expect(runnerAsCorp).toContain('data-testid="zone-runner-score"');
    expect(runnerAsCorp).not.toContain('data-testid="zone-heap"');
  });

  it('DockedHandBar renders top-docked Corp and bottom-docked Runner hands with hand-dock class', () => {
    const state = newGame();
    const corpDock = renderToStaticMarkup(
      <DockedHandBar
        side="corp"
        position="top"
        cards={state.corp.hq}
        handSizeLimit={state.corp.handSizeLimit}
        isSelectable
        selectedCardId={null}
        onSelect={() => {}}
        discardedIds={new Set()}
      />,
    );
    expect(corpDock).toContain('data-testid="hand-dock-corp"');
    expect(corpDock).toContain('hand-dock');
    expect(corpDock).toContain('data-testid="hand-corp"');

    const runnerDock = renderToStaticMarkup(
      <DockedHandBar
        side="runner"
        position="bottom"
        cards={state.runner.grip}
        handSizeLimit={state.runner.handSizeLimit}
        isSelectable
        selectedCardId={null}
        onSelect={() => {}}
        discardedIds={new Set()}
      />,
    );
    expect(runnerDock).toContain('data-testid="hand-dock-runner"');
    expect(runnerDock).toContain('data-testid="hand-runner"');
  });

  it('ServerColumn only reserves sideways-ice minWidth when ice is installed, and RigView exposes auto-fit tracks', () => {
    const state = newGame();
    const unicedHtml = renderToStaticMarkup(<ServerColumn server={state.corp.servers.archives} activePlayer="runner" />);
    expect(unicedHtml).toContain('min-width:calc(var(--card-w) + 0.75rem)');

    const ice = state.corp.hq.pop()!;
    state.corp.servers.hq.ice.push(ice);
    const icedHtml = renderToStaticMarkup(<ServerColumn server={state.corp.servers.hq} activePlayer="runner" />);
    expect(icedHtml).toContain('min-width:calc(var(--card-h) + 0.75rem)');

    // Populated resources with empty hardware: resources exposes data-auto-fit-track while hardware collapses cleanly
    state.runner.rig.resources.push(state.runner.grip.pop()!);
    const rigHtml = renderToStaticMarkup(<RigView rig={state.runner.rig} />);
    expect(rigHtml).toContain('data-auto-fit-track=""');
    expect(rigHtml).toContain('Hardware (0)');
  });

  it('ActionBars splits common click actions + Play/End Turn into dock and contextual pickers into sidebar', () => {
    const state = newGame();
    const seat = { can: () => true, reason: () => null, legal: [], waitingOn: null } as unknown as React.ContextType<typeof SeatContext>;

    const corpDockHtml = renderToStaticMarkup(
      <SeatContext.Provider value={seat}>
        <CorpActions state={state} selectedCard={undefined} onAction={() => {}} section="dock" />
      </SeatContext.Provider>,
    );
    expect(corpDockHtml).toContain('data-testid="corp-dock-actions"');
    expect(corpDockHtml).toContain('+1 Credit');
    expect(corpDockHtml).toContain('Draw Card');
    expect(corpDockHtml).toContain('data-testid="end-turn"');

    const corpSidebarEmpty = renderToStaticMarkup(
      <SeatContext.Provider value={seat}>
        <CorpActions state={state} selectedCard={undefined} onAction={() => {}} section="sidebar" />
      </SeatContext.Provider>,
    );
    expect(corpSidebarEmpty).toBe('');

    const runnerDockHtml = renderToStaticMarkup(
      <SeatContext.Provider value={seat}>
        <RunnerActions state={state} selectedCard={undefined} onAction={() => {}} section="dock" />
      </SeatContext.Provider>,
    );
    expect(runnerDockHtml).toContain('data-testid="runner-dock-actions"');
    expect(runnerDockHtml).toContain('+1 Credit');
    expect(runnerDockHtml).toContain('End Runner Turn');

    const runnerSidebarEmpty = renderToStaticMarkup(
      <SeatContext.Provider value={seat}>
        <RunnerActions state={state} selectedCard={undefined} onAction={() => {}} section="sidebar" />
      </SeatContext.Provider>,
    );
    expect(runnerSidebarEmpty).toBe('');

    const dockedWithActions = renderToStaticMarkup(
      <SeatContext.Provider value={seat}>
        <DockedHandBar
          side="runner"
          position="bottom"
          cards={state.runner.grip}
          handSizeLimit={state.runner.handSizeLimit}
          isSelectable
          selectedCardId={null}
          onSelect={() => {}}
          discardedIds={new Set()}
          actions={<RunnerActions state={state} selectedCard={undefined} onAction={() => {}} section="dock" />}
        />
      </SeatContext.Provider>,
    );
    expect(dockedWithActions.indexOf('data-testid="hand-runner"')).toBeLessThan(
      dockedWithActions.indexOf('data-testid="runner-dock-actions"'),
    );

    const dockedAccessed = renderToStaticMarkup(
      <AccessedPanel
        cards={[{ code: '30001' }]}
        onInspect={() => {}}
        onClose={() => {}}
        docked
        className="lg:order-2"
      />,
    );
    expect(dockedAccessed).toContain('data-testid="accessed-panel"');
    expect(dockedAccessed).toContain('lg:order-2');
    expect(dockedAccessed).not.toContain('fixed right-3 bottom-3');
  });

  it('mirrors ServerColumn and RigView for Corp-on-bottom view and persists the hotseat flip toggle', () => {
    const state = newGame();
    const innerIce = { ...state.corp.hq.pop()!, cardCode: '30072', isRezzed: true };
    const outerIce = { ...state.corp.hq.pop()!, cardCode: '30073', isRezzed: true };
    state.corp.servers.hq.ice.push(innerIce, outerIce);

    const mirroredServer = renderToStaticMarkup(
      <ServerColumn server={state.corp.servers.hq} activePlayer="corp" perspective="corp" mirrored />,
    );
    expect(mirroredServer).toContain('mt-auto');
    // Outermost ice (30073) renders above innermost ice (30072), and ice renders above the server header
    expect(mirroredServer.indexOf('30073')).toBeGreaterThan(-1);
    expect(mirroredServer.indexOf('30072')).toBeGreaterThan(-1);
    expect(mirroredServer.indexOf('30073')).toBeLessThan(mirroredServer.indexOf('30072'));
    expect(mirroredServer.indexOf('2 ice')).toBeLessThan(mirroredServer.indexOf('>HQ<'));

    const mirroredRig = renderToStaticMarkup(<RigView rig={state.runner.rig} mirrored />);
    expect(mirroredRig.indexOf('Hardware (0)')).toBeLessThan(mirroredRig.indexOf('Programs (0)'));

    expect(flipHotseatBoardsEnabled()).toBe(true);
    setFlipHotseatBoardsEnabled(false);
    expect(flipHotseatBoardsEnabled()).toBe(false);
    setFlipHotseatBoardsEnabled(true);
    expect(flipHotseatBoardsEnabled()).toBe(true);

    const withFlipHtml = renderToStaticMarkup(
      <AudioFxControls
        variant="desktop"
        sound
        onSoundChange={() => {}}
        music
        onMusicChange={() => {}}
        musicVol={0.5}
        onMusicVolChange={() => {}}
        animations
        onAnimationsChange={() => {}}
        flipHotseatBoards
        onFlipHotseatBoardsChange={() => {}}
      />,
    );
    expect(withFlipHtml).toContain('Flip boards at turn end');
    expect(withFlipHtml).toContain('data-testid="setting-flip-hotseat"');

    const withoutFlipHtml = renderToStaticMarkup(
      <AudioFxControls
        variant="desktop"
        sound
        onSoundChange={() => {}}
        music
        onMusicChange={() => {}}
        musicVol={0.5}
        onMusicVolChange={() => {}}
        animations
        onAnimationsChange={() => {}}
      />,
    );
    expect(withoutFlipHtml).not.toContain('Flip boards at turn end');

    const corpBottomStrip = renderToStaticMarkup(
      <SideStrip side="corp" edge="bottom" state={state} viewer="corp" onInspect={() => {}} onOpenZone={() => {}} />,
    );
    expect(corpBottomStrip).toContain('border-t border-cyan-950');
    expect(corpBottomStrip).not.toContain('border-b border-cyan-950');

    const runnerTopStrip = renderToStaticMarkup(
      <SideStrip side="runner" edge="top" state={state} viewer="corp" onInspect={() => {}} onOpenZone={() => {}} />,
    );
    expect(runnerTopStrip).toContain('border-b border-pink-950');
    expect(runnerTopStrip).not.toContain('border-t border-pink-950');

    const selectedHandHtml = renderToStaticMarkup(
      <DockedHandBar
        side="runner"
        position="bottom"
        cards={state.runner.grip}
        handSizeLimit={state.runner.handSizeLimit}
        isSelectable
        selectedCardId={state.runner.grip[0].instanceId}
        onSelect={() => {}}
        discardedIds={new Set()}
      />,
    );
    expect(selectedHandHtml).toContain('-translate-y-2');
  });

  it('splits Removed from game counters and zoneContents by side in SideStrip and ZoneViewer', () => {
    const stripText = (html: string) => html.replace(/<[^>]+>/g, '');
    const makeCard = (instanceId: string, cardCode: string) => ({
      instanceId,
      cardCode,
      isRezzed: false,
      advancementCounters: 0,
      tokens: {},
      hostedCardIds: [],
    });

    // Empty: neither side shows a Removed pill and both zones are empty
    const emptyState = newGame();
    expect(removedCardsForSide(emptyState, 'corp')).toEqual([]);
    expect(removedCardsForSide(emptyState, 'runner')).toEqual([]);
    expect(zoneContents('corp-removed', emptyState)).toEqual({
      title: 'CORP REMOVED FROM GAME',
      groups: [{ label: 'Removed Corp cards', cards: [] }],
    });
    expect(zoneContents('runner-removed', emptyState)).toEqual({
      title: 'RUNNER REMOVED FROM GAME',
      groups: [{ label: 'Removed Runner cards', cards: [] }],
    });
    const emptyCorp = renderToStaticMarkup(
      <SideStrip side="corp" state={emptyState} viewer="both" onInspect={() => {}} onOpenZone={() => {}} />,
    );
    const emptyRunner = renderToStaticMarkup(
      <SideStrip side="runner" state={emptyState} viewer="both" onInspect={() => {}} onOpenZone={() => {}} />,
    );
    expect(emptyCorp).not.toContain('data-testid="zone-corp-removed"');
    expect(emptyRunner).not.toContain('data-testid="zone-runner-removed"');

    // Corp-only (Petty Cash + Spin Doctor): Corp strip shows 2, Runner strip hides pill
    const corpOnly = newGame();
    const pettyCash = makeCard('rfg-pc', '35081');
    const spinDoctor = makeCard('rfg-sd', '30053');
    corpOnly.removedFromGame.push(pettyCash, spinDoctor);
    expect(zoneContents('corp-removed', corpOnly).groups[0].cards.map(c => c.instanceId)).toEqual(['rfg-pc', 'rfg-sd']);
    expect(zoneContents('runner-removed', corpOnly).groups[0].cards).toEqual([]);
    const corpOnlyCorpHtml = renderToStaticMarkup(
      <SideStrip side="corp" state={corpOnly} viewer="both" onInspect={() => {}} onOpenZone={() => {}} />,
    );
    const corpOnlyRunnerHtml = renderToStaticMarkup(
      <SideStrip side="runner" state={corpOnly} viewer="both" onInspect={() => {}} onOpenZone={() => {}} />,
    );
    expect(corpOnlyCorpHtml).toContain('data-testid="zone-corp-removed"');
    expect(stripText(corpOnlyCorpHtml)).toContain('Removed: 2');
    expect(corpOnlyRunnerHtml).not.toContain('data-testid="zone-runner-removed"');

    // Runner-only (heap cards exiled by Ansel 2.0): Runner strip shows 2, Corp strip hides pill
    const runnerOnly = newGame();
    const sureGamble = makeCard('rfg-sg', '30030');
    const overclock = makeCard('rfg-oc', '30029');
    runnerOnly.removedFromGame.push(sureGamble, overclock);
    expect(zoneContents('corp-removed', runnerOnly).groups[0].cards).toEqual([]);
    expect(zoneContents('runner-removed', runnerOnly).groups[0].cards.map(c => c.instanceId)).toEqual(['rfg-sg', 'rfg-oc']);
    const runnerOnlyCorpHtml = renderToStaticMarkup(
      <SideStrip side="corp" state={runnerOnly} viewer="both" onInspect={() => {}} onOpenZone={() => {}} />,
    );
    const runnerOnlyRunnerHtml = renderToStaticMarkup(
      <SideStrip side="runner" state={runnerOnly} viewer="both" onInspect={() => {}} onOpenZone={() => {}} />,
    );
    expect(runnerOnlyCorpHtml).not.toContain('data-testid="zone-corp-removed"');
    expect(runnerOnlyRunnerHtml).toContain('data-testid="zone-runner-removed"');
    expect(stripText(runnerOnlyRunnerHtml)).toContain('Removed: 2');

    // Mixed: GameState.removedFromGame holds both sides, each strip and zone viewer filters to its own side
    const mixed = newGame();
    mixed.removedFromGame.push(pettyCash, sureGamble, spinDoctor);
    expect(zoneContents('corp-removed', mixed).groups[0].cards.map(c => c.instanceId)).toEqual(['rfg-pc', 'rfg-sd']);
    expect(zoneContents('runner-removed', mixed).groups[0].cards.map(c => c.instanceId)).toEqual(['rfg-sg']);
    const mixedCorpHtml = renderToStaticMarkup(
      <SideStrip side="corp" state={mixed} viewer="runner" onInspect={() => {}} onOpenZone={() => {}} />,
    );
    const mixedRunnerHtml = renderToStaticMarkup(
      <SideStrip side="runner" state={mixed} viewer="corp" onInspect={() => {}} onOpenZone={() => {}} />,
    );
    expect(mixedCorpHtml).toContain('data-testid="zone-corp-removed"');
    expect(stripText(mixedCorpHtml)).toContain('Removed: 2');
    expect(mixedRunnerHtml).toContain('data-testid="zone-runner-removed"');
    expect(stripText(mixedRunnerHtml)).toContain('Removed: 1');
  });

  it('HandoffScreen stacks above Settings, exposes dialog ARIA, and starts disarmed against stray keypresses', () => {
    const html = renderToStaticMarkup(<HandoffScreen to="corp" reason="turn" onReady={() => {}} />);
    expect(html).toContain('z-[110]');
    expect(html).toContain('role="dialog"');
    expect(html).toContain('aria-modal="true"');
    expect(html).toMatch(/disabled=""[^>]*data-testid="handoff-ready"|data-testid="handoff-ready"[^>]*disabled=""/);
  });

  it('DeckListColumn disables Random online when the only non-starter alternative is format-illegal', () => {
    const customDeck = { ...corpStarter, id: 'custom-corp-illegal', name: 'Illegal Corp Deck', source: 'custom' as const };
    const summaries = [summarize(corpStarter), summarize(customDeck)];
    const baseProps = {
      side: 'corp' as const,
      selected: corpStarter.id,
      summaries,
      favorites: [] as string[],
      hidden: [] as string[],
      showHidden: false,
      onToggleShowHidden: () => {},
      listedDecks: () => summaries,
      onSelect: () => {},
      onToggleFavorite: () => {},
      onViewDeck: () => {},
      onEditDeck: () => {},
      onNewDeck: () => {},
      onCopyDeck: () => {},
      onDeleteDeck: () => {},
      onHideDeck: () => {},
      onRestoreDeck: () => {},
      onRememberScroll: () => {},
      onScrollList: () => {},
    };

    const localHtml = renderToStaticMarkup(<DeckListColumn {...baseProps} opts={{}} />);
    expect(localHtml).not.toMatch(/disabled=""[^>]*data-testid="random-corp-deck"|data-testid="random-corp-deck"[^>]*disabled=""/);

    const onlineBlockedHtml = renderToStaticMarkup(
      <DeckListColumn
        {...baseProps}
        opts={{ online: { format: 'startup', problems: new Map([[customDeck.id, ['Contains cards outside Startup']]]) } }}
      />,
    );
    expect(onlineBlockedHtml).toMatch(/disabled=""[^>]*data-testid="random-corp-deck"|data-testid="random-corp-deck"[^>]*disabled=""/);
  });

  it('RunOverlay formats phase labels, flags Let N Subroutines Fire with warning styling, and trims docked encounter text', () => {
    const base = newGame();
    startRunnerTurn(base);
    // Palisade (Barrier, str 2, 1 subroutine) on HQ + Cleaver (Fracter, str 3) and Unity (Decoder, str 1)
    const iceId = installIceForTest(base, '30072', 'hq', true);
    const cleaverId = installProgramForTest(base, '30006');
    const unityId = installProgramForTest(base, '30026');
    const s = executeAction(base, { type: 'INITIATE_RUN', player: 'runner', targetServerId: 'hq' });
    s.runner.credits = 0;
    const runState = s.activeRun!;
    runState.phase = 'encounter_ice';
    runState.icePosition = 0;
    runState.encounter = { iceId, broken: [false], resolvingIndex: null, boosts: {}, iceStrengthModifier: 0 };
    const seat = { can: () => false, reason: () => 'Not enough credits', legal: [], waitingOn: null } as unknown as React.ContextType<typeof SeatContext>;

    const dockedHtml = renderToStaticMarkup(
      <SeatContext.Provider value={seat}>
        <RunOverlay
          state={s}
          onContinueRun={() => {}}
          onJackOut={() => {}}
          runnerControls
          canPeekCorp={false}
          onAction={() => {}}
          docked
        />
      </SeatContext.Provider>,
    );
    expect(dockedHtml).toContain('Encounter Ice');
    expect(dockedHtml).not.toContain('ENCOUNTER_ICE');
    expect(dockedHtml).toContain('Let 1 Subroutine Fire');
    expect(dockedHtml).toContain('data-warning="true"');
    // EncounterPanel shows colorblind-safe strength markers + concise diagnostics instead of "no legal use"
    expect(dockedHtml).not.toContain('no legal use');
    expect(dockedHtml).toContain(`data-testid="breaker-status-${unityId}"`);
    expect(dockedHtml).toContain('Wrong type');
    expect(dockedHtml).toContain(`data-testid="breaker-status-${cleaverId}"`);
    expect(dockedHtml).toContain('Need 1c to break');
    expect(dockedHtml).toContain('✓');
    expect(dockedHtml).toContain('(-1)');

    // When all subroutines are broken, Pass Ice drops warning styling and breakers report All broken
    runState.encounter.broken = [true];
    const brokenHtml = renderToStaticMarkup(
      <SeatContext.Provider value={seat}>
        <EncounterPanel state={s} onAction={() => {}} />
      </SeatContext.Provider>,
    );
    expect(brokenHtml).toContain('All broken');
  });

  it('AbilityBar omits actions already listed in excludeKeys', () => {
    const s = newGame();
    const fermenterId = installProgramForTest(s, '30007');
    findCardAnywhere(s, fermenterId)!.tokens.virus = 2;
    const action = { type: 'USE_ABILITY' as const, player: 'runner' as const, cardInstanceId: fermenterId, abilityIndex: 0 };
    const seat = { can: () => true, reason: () => null, legal: [action], waitingOn: null } as unknown as React.ContextType<typeof SeatContext>;

    const fullHtml = renderToStaticMarkup(
      <SeatContext.Provider value={seat}>
        <AbilityBar state={s} side="runner" onAction={() => {}} />
      </SeatContext.Provider>,
    );
    expect(fullHtml).toContain('data-testid="ability-bar-runner"');

    const excludedHtml = renderToStaticMarkup(
      <SeatContext.Provider value={seat}>
        <AbilityBar state={s} side="runner" onAction={() => {}} excludeKeys={new Set([abilityActionKey(action)])} />
      </SeatContext.Provider>,
    );
    expect(excludedHtml).toBe('');
  });

  it('SideStrip, DockedHandBar, and CardView show MU/flatline urgency cues and agenda progress without leaking facedown agendas', () => {
    const s = newGame();
    // Corp turn: Runner clicks pill dims; MU full -> amber, MU over limit -> red
    s.runner.memoryUnitsUsed = 4;
    s.runner.memoryUnitsTotal = 4;
    const fullMuHtml = renderToStaticMarkup(
      <SideStrip side="runner" state={s} viewer="runner" onInspect={() => {}} onOpenZone={() => {}} />,
    );
    expect(fullMuHtml).toContain('data-testid="runner-mu-pill"');
    expect(fullMuHtml).toContain('bg-amber-950');
    expect(fullMuHtml).toContain('opacity-75');

    s.runner.memoryUnitsUsed = 5;
    const overMuHtml = renderToStaticMarkup(
      <SideStrip side="runner" state={s} viewer="runner" onInspect={() => {}} onOpenZone={() => {}} />,
    );
    expect(overMuHtml).toContain('bg-red-950');

    // Runner DockedHandBar with 1 card shows FLATLINE RISK + promptHint override
    const lowGripHtml = renderToStaticMarkup(
      <DockedHandBar
        side="runner"
        position="bottom"
        cards={s.runner.grip.slice(0, 1)}
        handSizeLimit={5}
        isSelectable={false}
        selectedCardId={null}
        onSelect={() => {}}
        discardedIds={new Set()}
        promptHint="Click highlighted card to choose"
      />,
    );
    expect(lowGripHtml).toContain('data-low-danger="true"');
    expect(lowGripHtml).toContain('FLATLINE RISK');
    expect(lowGripHtml).toContain('Click highlighted card to choose');

    // CardView shows 2/3 on Corp's own unrezzed agenda, but hides /3 from Runner when facedown
    const agendaId = installCorpForTest(s, '30068', 'remote1', false); // Send a Message (5/3) or Orbital Superiority (3/2)
    const agenda = findCardAnywhere(s, agendaId)!;
    agenda.advancementCounters = 2;
    const corpViewHtml = renderToStaticMarkup(<CardView card={agenda} isFaceDown canPeek />);
    const runnerViewHtml = renderToStaticMarkup(<CardView card={agenda} isFaceDown canPeek={false} />);
    expect(corpViewHtml).toContain('/3');
    expect(runnerViewHtml).not.toContain('/3');
  });
});
