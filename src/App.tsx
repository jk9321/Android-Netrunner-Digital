import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  CardInstance,
  GameAction,
  GameState,
  cardDef,
  createInitialGameState,
  executeAction,
  findCardAnywhere,
  getCardScript,
  getLegalActions,
  isLegalAction,
  SideCode,
  breakerScript,
  iceSubtypes,
} from './core';
import type { IceSubtype } from './core/scripts/types';
import { AIClient } from './ai/client';
import { DECKS, DEFAULT_CORP_DECK, DEFAULT_RUNNER_DECK, deckGameSetup } from './data/decks';
import { GameConfig, SavedGame, clearSavedGame, loadSavedGame, saveGame } from './ui/savedGame';
import { loadCustomDecks } from './data/customDecks';
import { DeckPicker } from './ui/components/DeckPicker';
import { CardView } from './ui/components/CardView';
import { ServerColumn } from './ui/components/ServerColumn';
import { RigView } from './ui/components/RigView';
import { RunOverlay } from './ui/components/RunOverlay';
import { LogFeed } from './ui/components/LogFeed';
import { PromptPanel } from './ui/components/PromptPanel';
import { CardZoomModal } from './ui/components/CardZoomModal';
import { AbilityBar } from './ui/components/AbilityBar';
import { ZoneGroup, ZoneViewer } from './ui/components/ZoneViewer';
import { Pile } from './ui/components/Pile';
import { HandRow } from './ui/components/HandRow';
import { PhaseTracker } from './ui/components/PhaseTracker';
import { ZoomContext, ZoomPanel, createZoomStore } from './ui/components/ZoomPanel';
import { CardFates, ShownFate } from './ui/components/CardFates';
import { cardFates } from './ui/cardFates';
import { HandoffScreen } from './ui/components/HandoffScreen';
import { GameOverModal } from './ui/components/GameOverModal';
import { ViewMode, Viewer, actingSide, canActAs, canSeeCorpSecrets, canSeeRunnerSecrets, corpRezWindow } from './ui/viewer';
import { playForLog, setSoundEnabled, soundEnabled } from './ui/sound';
import {
  Clock,
  LogOut,
  Plus,
  Layers,
  Award,
  Zap,
  ZoomIn,
  Eye,
  ArrowRight,
  Tag,
  Trash2,
  Biohazard,
  Archive,
  Volume2,
  VolumeX,
  Ban,
  Flag,
} from 'lucide-react';
import { CreditIcon, Credits, MuIcon } from './ui/components/CreditIcon';
import { Keyword } from './ui/components/Keyword';
import { labelKeyword } from './ui/glossary';
import { showAlert, showConfirm } from './ui/components/Dialog';

const VIEW_MODE_KEY = 'netrunner.viewMode';
const AI_DELAY_MS = 650;
/** How long a stolen, scored or trashed card stays in the middle of the table. */
const FATE_SHOW_MS = 1300;

function savedViewMode(): ViewMode {
  try {
    const v = window.localStorage.getItem(VIEW_MODE_KEY);
    if (v === 'open' || v === 'hotseat' || v === 'corp' || v === 'runner') return v;
  } catch {
    // Storage blocked: use the default
  }
  return 'open';
}

function randomSeed(): number {
  return crypto.getRandomValues(new Uint32Array(1))[0];
}

/**
 * `?seed=123&corp=<deck id>&runner=<deck id>` starts that exact game (to
 * replay a deal), and `&ai=corp` or `&ai=runner` hands one side to the
 * computer (`&difficulty=hard` for the search AI); without a seed the app opens on the deck picker.
 */
function configFromUrl(): GameConfig | null {
  const params = new URLSearchParams(window.location.search);
  const seed = Number(params.get('seed'));
  if (!Number.isInteger(seed) || seed <= 0) return null;
  const decks = [...DECKS, ...loadCustomDecks()];
  const find = (id: string | null, side: SideCode, fallback: string) =>
    decks.find(d => d.id === id && d.side === side) ?? decks.find(d => d.id === fallback)!;
  return {
    seed,
    corpDeck: find(params.get('corp'), 'corp', DEFAULT_CORP_DECK),
    runnerDeck: find(params.get('runner'), 'runner', DEFAULT_RUNNER_DECK),
    ai: params.get('ai') === 'corp' || params.get('ai') === 'runner' ? (params.get('ai') as SideCode) : null,
    difficulty: params.get('difficulty') === 'hard' ? 'hard' : 'normal',
  };
}

/**
 * The game to open on: a `?seed=` link, or else the game in progress before
 * the page reloaded. A saved game resumes a link only if it is that same deal.
 */
function startingGame(): { config: GameConfig | null; saved: SavedGame | null } {
  const fromUrl = configFromUrl();
  const saved = loadSavedGame();
  if (fromUrl) {
    const same =
      saved &&
      saved.config.seed === fromUrl.seed &&
      saved.config.corpDeck.id === fromUrl.corpDeck.id &&
      saved.config.runnerDeck.id === fromUrl.runnerDeck.id &&
      saved.config.ai === fromUrl.ai;
    return { config: fromUrl, saved: same ? saved : null };
  }
  return { config: saved?.config ?? null, saved };
}

export default function App() {
  const [start] = useState(startingGame);
  const [config, setConfig] = useState<GameConfig | null>(start.config);
  const [lastDecks, setLastDecks] = useState({ corp: DEFAULT_CORP_DECK, runner: DEFAULT_RUNNER_DECK });

  if (!config) {
    return (
      <DeckPicker
        initialCorpDeckId={lastDecks.corp}
        initialRunnerDeckId={lastDecks.runner}
        onStart={(corpDeck, runnerDeck, ai, difficulty) => {
          setLastDecks({ corp: corpDeck.id, runner: runnerDeck.id });
          setConfig({ seed: randomSeed(), corpDeck, runnerDeck, ai, difficulty });
        }}
      />
    );
  }
  return (
    <Game
      key={config.seed}
      config={config}
      saved={start.saved?.config.seed === config.seed ? start.saved : null}
      onNewGame={() => {
        clearSavedGame();
        // Drop ?seed=... so a reload doesn't restart the old deal
        if (window.location.search) window.history.replaceState(null, '', window.location.pathname);
        setConfig(null);
      }}
      onRematch={() => {
        clearSavedGame();
        if (window.location.search) window.history.replaceState(null, '', window.location.pathname);
        setConfig({ ...config, seed: randomSeed() });
      }}
    />
  );
}

function Game({
  config,
  saved,
  onNewGame,
  onRematch,
}: {
  config: GameConfig;
  saved: SavedGame | null;
  onNewGame: () => void;
  onRematch: () => void;
}) {
  const [gameOverHidden, setGameOverHidden] = useState(false);
  const [gameState, setGameState] = useState(
    () => saved?.state ?? createInitialGameState(deckGameSetup(config.seed, config.corpDeck, config.runnerDeck))
  );

  const [selectedCardId, setSelectedCardId] = useState<string | null>(null);
  const [cardScale, setCardScale] = useState<'normal' | 'large' | 'huge'>('normal');
  const [zoomStore] = useState(createZoomStore);
  const [inspectedCard, setInspectedCard] = useState<CardInstance | null>(null);
  const [zone, setZone] = useState<'archives' | 'heap' | 'corp-score' | 'runner-score' | 'removed' | null>(null);
  const [sound, setSound] = useState(soundEnabled);

  // Who is looking. Pass and play shows one side at a time and hands over
  // (behind a cover screen) whenever the other side has to act.
  // Against the computer a game starts in the person's own view (Open table is
  // still in the menu); two-player games start in the last mode used.
  const [viewMode, setViewMode] = useState<ViewMode>(() =>
    config.ai === 'corp' ? 'runner' : config.ai === 'runner' ? 'corp' : savedViewMode(),
  );
  const [hotseatSide, setHotseatSide] = useState<SideCode>(saved?.table.hotseatSide ?? 'corp');
  // Runs started so far, and the Corp rez windows already passed, so each window asks once
  const [runSerial, setRunSerial] = useState(saved?.table.runSerial ?? 0);
  const [passedRezWindows, setPassedRezWindows] = useState<string[]>(saved?.table.passedRezWindows ?? []);
  // Cards the Runner accessed in the latest run, shown until dismissed or the next run
  const [accessed, setAccessed] = useState<string[]>(saved?.table.accessed ?? []);
  // Cards just stolen, scored or trashed, shown briefly in the middle of the table
  const [fates, setFates] = useState<ShownFate[]>([]);
  const prevStateRef = useRef(gameState);
  // The state as of the latest move, for actions applied after an await (a
  // confirm dialog) when the computer may have moved in the meantime
  const latestStateRef = useRef(gameState);
  latestStateRef.current = gameState;
  // Timers that end each card-fate showing, cleared if the game is left
  const fateTimersRef = useRef(new Set<number>());
  // Bumped to ask the computer again after it failed to move
  const [aiRetry, setAiRetry] = useState(0);

  // Against the computer: the AI plays one side and the person sees their own
  // side (or everything, with Open table).
  const aiSide = config.ai;
  const humanSide: SideCode | null = aiSide === 'corp' ? 'runner' : aiSide === 'runner' ? 'corp' : null;
  const aiRef = useRef<AIClient | null>(null);

  // The Corp gets rez windows during runs in pass and play, and whenever the computer plays a side
  const rezWindowsOn = viewMode === 'hotseat' || aiSide !== null;
  const rezWindow = corpRezWindow(gameState, runSerial);
  const rezWindowOpen = rezWindowsOn && rezWindow !== null && !passedRezWindows.includes(rezWindow.key);
  const acting = actingSide(gameState, rezWindowOpen);
  const viewer: Viewer = humanSide
    ? viewMode === 'open' || gameState.winner
      ? 'both'
      : humanSide
    : viewMode === 'open'
      ? 'both'
      : viewMode === 'hotseat'
        ? gameState.winner
          ? 'both'
          : hotseatSide
        : viewMode;
  const handoffTo = !aiSide && viewMode === 'hotseat' && acting && acting !== hotseatSide ? acting : null;
  const corpCanAct = canActAs(viewer, 'corp') && aiSide !== 'corp';
  const runnerCanAct = canActAs(viewer, 'runner') && aiSide !== 'runner' && !rezWindowOpen;
  const aiThinking = aiSide !== null && acting === aiSide;

  useEffect(() => {
    if (aiSide) return; // the AI game's view choice doesn't replace the two-player default
    try {
      window.localStorage.setItem(VIEW_MODE_KEY, viewMode);
    } catch {
      // Not saved; the choice still applies to this game
    }
  }, [viewMode, aiSide]);

  // Save after every move so a reload (the browser discarding a background
  // tab, or the dev server reconnecting) resumes this game; a finished game is dropped
  useEffect(() => {
    if (gameState.winner) clearSavedGame();
    else saveGame({ config, state: gameState, table: { runSerial, passedRezWindows, hotseatSide, accessed } });
  }, [config, gameState, runSerial, passedRezWindows, hotseatSide, accessed]);

  // Watch every state change (the person's moves and the computer's) for steals, scores and trashes
  useEffect(() => {
    const prev = prevStateRef.current;
    prevStateRef.current = gameState;
    if (prev === gameState) return;
    const found = cardFates(prev, gameState);
    if (found.length === 0) return;
    const stamp = Date.now();
    const shown = found.map((f, i) => ({
      ...f,
      key: `${f.card.instanceId}-${stamp}-${i}`,
      canSee: !f.corpSecret || canSeeCorpSecrets(viewer),
    }));
    setFates(cur => [...cur, ...shown]);
    // Not cleared on the next change: each showing ends on its own timer
    const timer = window.setTimeout(() => {
      fateTimersRef.current.delete(timer);
      const keys = new Set(shown.map(f => f.key));
      setFates(cur => cur.filter(f => !keys.has(f.key)));
    }, FATE_SHOW_MS);
    fateTimersRef.current.add(timer);
  }, [gameState]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const timers = fateTimersRef.current;
    return () => timers.forEach(t => window.clearTimeout(t));
  }, []);

  const handleAction = (action: GameAction) => {
    const current = latestStateRef.current;
    try {
      const nextState = executeAction(current, action);
      latestStateRef.current = nextState;
      if (!current.activeRun && nextState.activeRun) setRunSerial(n => n + 1);
      const newEntries = nextState.log.slice(current.log.length);
      playForLog(newEntries);
      const newlyAccessed = newEntries
        .filter(e => e.cardCode && e.message.startsWith('Runner accessed '))
        .map(e => e.cardCode!);
      const runStarted = !current.activeRun && nextState.activeRun;
      if (runStarted || newlyAccessed.length > 0) setAccessed(prev => [...(runStarted ? [] : prev), ...newlyAccessed]);
      setGameState(nextState);
      setSelectedCardId(null);
    } catch (err) {
      void showAlert(err instanceof Error ? err.message : 'Illegal action', { title: 'Action blocked' });
    }
  };

  // The computer thinks in a background worker, then moves after a short pause so its moves can be followed
  useEffect(() => {
    if (!aiSide) return;
    const client = new AIClient(aiSide, config.difficulty);
    aiRef.current = client;
    return () => {
      client.dispose();
      aiRef.current = null;
    };
  }, [aiSide, config.difficulty]);

  useEffect(() => {
    const ai = aiRef.current;
    if (!ai || !aiSide || gameState.winner || acting !== aiSide) return;
    let cancelled = false;
    let timer: number | undefined;
    const started = Date.now();
    const window_ = aiSide === 'corp' && rezWindowOpen ? rezWindow : null;
    // A computer that can't move would leave the game on "AI THINKING" for
    // good, so let the person ask it again or end the game
    const failed = async (problem: string) => {
      console.error('AI failed to move:', problem);
      const retry = await showConfirm(
        `The computer couldn't make its move (${problem}). Ask it to try again, or end the game with the computer conceding?`,
        { title: 'Computer stuck', confirmLabel: 'Try again', cancelLabel: 'Computer concedes' },
      );
      if (cancelled) return;
      if (retry) setAiRetry(n => n + 1);
      else handleAction({ type: 'CONCEDE', player: aiSide });
    };
    const request = window_ ? ai.chooseRez(gameState, window_.cards) : ai.chooseAction(gameState);
    request
      .then(action => {
        if (cancelled) return;
        timer = window.setTimeout(() => {
          if (cancelled) return;
          if (action && !isLegalAction(gameState, action)) void failed(`it chose an illegal ${action.type} move`);
          else if (action) handleAction(action);
          else if (window_) setPassedRezWindows(keys => [...keys, window_.key]);
          else void failed('it found no move');
        }, Math.max(0, AI_DELAY_MS - (Date.now() - started)));
      })
      .catch(err => {
        if (!cancelled) void failed(err instanceof Error ? err.message : String(err));
      });
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gameState, acting, rezWindowOpen, aiRetry]);

  const zoneView: { title: string; groups: ZoneGroup[] } | null =
    zone === 'archives'
      ? {
          title: 'ARCHIVES',
          groups: [
            { label: 'Face up', cards: gameState.corp.archives.faceUp },
            { label: 'Face down', cards: gameState.corp.archives.faceDown, faceDown: true },
          ],
        }
      : zone === 'heap'
        ? { title: 'HEAP', groups: [{ label: 'Heap', cards: gameState.runner.heap }] }
        : zone === 'corp-score'
          ? { title: 'CORP SCORE AREA', groups: [{ label: 'Scored agendas', cards: gameState.corp.scoreArea }] }
          : zone === 'runner-score'
            ? { title: 'RUNNER SCORE AREA', groups: [{ label: 'Stolen agendas', cards: gameState.runner.scoreArea }] }
            : zone === 'removed'
              ? { title: 'REMOVED FROM GAME', groups: [{ label: 'Removed', cards: gameState.removedFromGame }] }
              : null;
  const zoneButton = (id: NonNullable<typeof zone>, label: string, count: number, icon: React.ReactNode) => (
    <button
      onClick={() => setZone(id)}
      data-testid={`zone-${id}`}
      className="flex items-center gap-1 bg-slate-900 hover:bg-slate-800 border border-slate-800 hover:border-slate-600 px-2 py-0.5 rounded-lg text-slate-300 shadow transition-colors"
      title={`Browse ${label}`}
    >
      {icon}
      <span>
        <Keyword id={labelKeyword(label)}>{label}</Keyword>: {count}
      </span>
    </button>
  );

  // Back to the deck picker; a game still in progress is lost, so ask first
  const leaveGame = async () => {
    if (
      !gameState.winner &&
      !(await showConfirm('Leave this game and go back to deck selection? The game in progress will be lost.', {
        title: 'Leave game',
        confirmLabel: 'Leave',
        danger: true,
      }))
    )
      return;
    onNewGame();
  };
  // Concede: against the computer the person concedes; in two-player games the
  // side holding the device (pass and play) or the player whose turn it is
  const concedingSide: SideCode = humanSide ?? (viewMode === 'hotseat' ? hotseatSide : gameState.activePlayer);
  const concede = async () => {
    const name = concedingSide === 'corp' ? 'Corp' : 'Runner';
    const ok = await showConfirm(`Forfeit this game? The ${name} concedes and the ${concedingSide === 'corp' ? 'Runner' : 'Corp'} wins.`, {
      title: 'Forfeit',
      confirmLabel: 'Forfeit',
      danger: true,
    });
    if (!ok) return;
    handleAction({ type: 'CONCEDE', player: concedingSide });
  };

  const { corp, runner, activePlayer, activeRun, winner, winReason } = gameState;

  const selectedCard = [...corp.hq, ...runner.grip].find(c => c.instanceId === selectedCardId);
  const selectedIsPlayable = selectedCard && ['operation', 'event'].includes(cardDef(selectedCard).type_code);
  const playButton = (side: SideCode) => {
    if (!selectedCard || !selectedIsPlayable || cardDef(selectedCard).side_code !== side) return null;
    const action: GameAction = { type: 'PLAY_OPERATION_OR_EVENT', player: side, cardInstanceId: selectedCard.instanceId };
    const implemented = Boolean(getCardScript(selectedCard.cardCode)?.onPlay);
    return (
      <button
        onClick={() => handleAction(action)}
        disabled={!isLegalAction(gameState, action)}
        title={implemented ? undefined : 'This card\'s effect is not implemented yet'}
        className="px-4 py-1.5 bg-amber-500 hover:bg-amber-400 text-black text-xs font-bold rounded-xl transition-all flex items-center gap-1.5 shadow-lg disabled:opacity-40 disabled:animate-none animate-pulse"
      >
        <Zap className="w-3.5 h-3.5" /> {implemented ? `Play ${cardDef(selectedCard).title}` : 'Effect not implemented yet'}
      </button>
    );
  };

  // Why the selected grip card can't be installed now (shown on the disabled Install button), or null if it can
  const installBlocked =
    selectedCardId && selectedCard && !selectedIsPlayable && cardDef(selectedCard).side_code === 'runner'
      ? illegalReason(gameState, { type: 'INSTALL_CARD', player: 'runner', cardInstanceId: selectedCardId })
      : null;

  // What each icebreaker breaks (AI breakers: everything), matched against the icons on ice
  const breakerTypes = (card: CardInstance): IceSubtype[] => {
    const breaks = breakerScript(card)?.breaks;
    return breaks === 'any' ? ['barrier', 'code gate', 'sentry'] : breaks ? [breaks] : [];
  };

  // Runner cards installed on Corp ice (trojans), and where each one sits, for the host tags
  const onIce = [...runner.rig.programs, ...runner.rig.hardware, ...runner.rig.resources].filter(c => c.hostedOnId);
  const iceHostLabel = (card: CardInstance): string | undefined => {
    if (!card.hostedOnId) return undefined;
    const server = Object.values(corp.servers).find(s => s.ice.some(i => i.instanceId === card.hostedOnId));
    const ice = server?.ice.find(i => i.instanceId === card.hostedOnId);
    if (!server || !ice) return undefined;
    const name = ice.isRezzed || canSeeCorpSecrets(viewer) ? cardDef(ice).title : 'unrezzed ice';
    return `${server.name} · ${name}`;
  };

  const rezAction = (card: CardInstance): GameAction => ({ type: 'REZ_CARD', player: 'corp', cardInstanceId: card.instanceId });
  const approachedIce =
    activeRun && activeRun.phase === 'approach_ice' && activeRun.icePosition !== null
      ? corp.servers[activeRun.server]?.ice[activeRun.icePosition]
      : undefined;

  // Board cards follow the window height (--card-w in index.css); Large and Huge scale them up
  const cardScaleValue = cardScale === 'huge' ? 1.4 : cardScale === 'large' ? 1.2 : 1;

  // The servers and the rig only change with the game state or who is looking, so selecting a
  // card, opening a zone or resizing cards reuses them instead of redrawing the whole table.
  // (Their buttons call handleAction, which always works on the latest state.)
  const serversView = useMemo(
    () =>
      Object.values(corp.servers).map(server => (
        <ServerColumn
          key={server.id}
          server={server}
          activePlayer={activePlayer}
          perspective={viewer}
          run={activeRun?.server === server.id ? activeRun : null}
          onInitiateRun={
            runnerCanAct
              ? (sId) => handleAction({ type: 'INITIATE_RUN', player: 'runner', targetServerId: sId })
              : undefined
          }
          onRezCard={(cId) =>
            handleAction({ type: 'REZ_CARD', player: 'corp', cardInstanceId: cId })
          }
          onAdvanceCard={(cId, sId) =>
            handleAction({ type: 'ADVANCE_CARD', player: 'corp', cardInstanceId: cId, serverId: sId })
          }
          onScoreCard={(cId) =>
            handleAction({ type: 'SCORE_AGENDA', player: 'corp', cardInstanceId: cId })
          }
          canRez={(card) => corpCanAct && isLegalAction(gameState, rezAction(card))}
          canAdvance={(card) =>
            corpCanAct &&
            isLegalAction(gameState, { type: 'ADVANCE_CARD', player: 'corp', cardInstanceId: card.instanceId, serverId: server.id })
          }
          canScore={(card) =>
            corpCanAct && isLegalAction(gameState, { type: 'SCORE_AGENDA', player: 'corp', cardInstanceId: card.instanceId })
          }
          onInspectCard={(card) => setInspectedCard(card)}
          hostedOnIce={(ice) => onIce.filter(c => c.hostedOnId === ice.instanceId)}
          iceTypes={(ice) => iceSubtypes(ice, gameState)}
          anchor={
            server.id === 'hq' ? (
              <CardView card={corp.identity} size="fit" notInstalled onInspect={setInspectedCard} />
            ) : server.id === 'rd' ? (
              <Pile label="R&D" count={corp.rd.length} side="corp" size="fit" hideLabel testId="pile-rd" />
            ) : server.id === 'archives' ? (
              <Pile
                label="Archives"
                count={corp.archives.faceUp.length + corp.archives.faceDown.length}
                side="corp"
                topCard={corp.archives.faceUp[corp.archives.faceUp.length - 1]}
                size="fit"
                hideLabel
                onClick={() => setZone('archives')}
                testId="pile-archives"
              />
            ) : undefined
          }
        />
      )),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [gameState, viewer, corpCanAct, runnerCanAct],
  );
  const rigView = useMemo(
    () => (
      <RigView
        rig={runner.rig}
        onInspectCard={setInspectedCard}
        hostLabel={iceHostLabel}
        breaks={breakerTypes}
        aside={
          <>
            <CardView card={runner.identity} size="fit" notInstalled onInspect={setInspectedCard} />
            <div />
            <Pile label="Stack" count={runner.stack.length} side="runner" size="fit" testId="pile-stack" />
            <Pile
              label="Heap"
              count={runner.heap.length}
              side="runner"
              topCard={runner.heap[runner.heap.length - 1]}
              size="fit"
              onClick={() => setZone('heap')}
              testId="pile-heap"
            />
          </>
        }
      />
    ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [gameState, viewer],
  );
  // New only when a move changes the piles, so the hands below can skip redrawing
  const discardedIds = useMemo(
    () => new Set([...runner.heap, ...corp.archives.faceUp, ...corp.archives.faceDown].map(c => c.instanceId)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [gameState],
  );

  return (
    <div
      className="min-h-screen lg:h-screen lg:overflow-hidden text-slate-100 flex flex-col font-mono selection:bg-cyber-neonYellow selection:text-black"
      style={{ '--card-scale': cardScaleValue } as React.CSSProperties}
    >
      {/* Top Header Bar */}
      <header className="h-12 shrink-0 min-w-0 overflow-x-auto border-b border-amber-400/40 bg-slate-950/90 px-3 gap-3 flex items-center justify-between sticky top-0 z-30 shadow-lg">
        <div className="flex items-center gap-3">
          <button
            onClick={leaveGame}
            data-testid="home-logo"
            title="Back to deck selection"
            className="font-cyber font-black tracking-wider 2xl:tracking-widest text-xs 2xl:text-lg whitespace-nowrap glitch-title hover:brightness-125 transition"
          >
            NETRUNNER
          </button>
          <div className="flex items-center gap-1.5">
            <div className="hidden sm:block">
              <PhaseTracker state={gameState} />
            </div>
            <span
              className="text-[10px] text-slate-500 font-mono whitespace-nowrap hidden 2xl:inline"
              title={`Open the app with ?seed=${gameState.rng.seed}&corp=${config.corpDeck.id}&runner=${config.runnerDeck.id}${aiSide ? `&ai=${aiSide}&difficulty=${config.difficulty}` : ''} to replay this deal`}
            >
              SEED {gameState.rng.seed}
            </span>
            {aiSide && (
              <span
                data-testid="ai-status"
                className={`text-[10px] px-2 py-0.5 rounded border font-bold ${
                  aiThinking ? 'border-amber-500 text-amber-300 animate-pulse' : 'border-slate-700 text-slate-500'
                }`}
                title={`The computer plays the ${aiSide === 'corp' ? 'Corp' : 'Runner'}`}
              >
                {aiThinking ? 'AI THINKING…' : `AI: ${aiSide.toUpperCase()}${config.difficulty === 'hard' ? ' (HARD)' : ''}`}
              </span>
            )}
            {/* Quick Sticky End Turn Button */}
            <button
              onClick={() => handleAction({ type: 'END_TURN', player: activePlayer })}
              disabled={
                !(activePlayer === 'corp' ? corpCanAct : runnerCanAct) ||
                !isLegalAction(gameState, { type: 'END_TURN', player: activePlayer })
              }
              className={`px-2.5 py-1 text-xs font-bold rounded-lg border transition-all shadow flex items-center gap-1 whitespace-nowrap disabled:opacity-40 ${
                activePlayer === 'corp'
                  ? 'bg-cyan-700 hover:bg-cyan-600 text-white border-cyan-500 shadow-cyan-950'
                  : 'bg-pink-700 hover:bg-pink-600 text-white border-pink-500 shadow-pink-950'
              }`}
              title={`End ${activePlayer.toUpperCase()}'s turn`}
            >
              End Turn <ArrowRight className="w-3 h-3" />
            </button>
          </div>
        </div>

        {/* Score Board */}
        <div className="flex items-center gap-3 2xl:gap-6">
          <div className="flex items-center gap-2">
            <span className="text-xs font-bold text-cyan-400 hidden 2xl:inline">CORP</span>
            <div title="Corp agenda points" className="flex items-center whitespace-nowrap bg-cyan-950/60 border border-cyan-800 px-2.5 py-0.5 rounded-full text-xs font-bold text-cyan-300">
              <Award className="w-3.5 h-3.5 mr-1 text-cyan-400" /> {corp.score} / 7
            </div>
          </div>
          <div className="text-slate-600 font-bold text-xs hidden 2xl:block">vs</div>
          <div className="flex items-center gap-2">
            <div title="Runner agenda points" className="flex items-center whitespace-nowrap bg-pink-950/60 border border-pink-800 px-2.5 py-0.5 rounded-full text-xs font-bold text-pink-300">
              <Award className="w-3.5 h-3.5 mr-1 text-pink-400" /> {runner.score} / 7
            </div>
            <span className="text-xs font-bold text-pink-400 hidden 2xl:inline">RUNNER</span>
          </div>
        </div>

        {/* Card Zoom & Game Controls */}
        <div className="flex items-center gap-2">
          {/* Card Size Selector */}
          <div className="flex items-center bg-slate-900 border border-slate-800 rounded-lg p-0.5 text-xs">
            <span className="px-2 text-[10px] text-slate-500 font-bold uppercase hidden 2xl:inline-flex items-center gap-1">
              <ZoomIn className="w-3 h-3" /> Size:
            </span>
            <button
              onClick={() => setCardScale('normal')}
              className={`px-2 py-0.5 rounded text-xs transition-colors ${
                cardScale === 'normal'
                  ? 'bg-slate-700 text-white font-bold'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              Normal
            </button>
            <button
              onClick={() => setCardScale('large')}
              className={`px-2 py-0.5 rounded text-xs transition-colors ${
                cardScale === 'large'
                  ? 'bg-cyan-600 text-white font-bold'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              Large
            </button>
            <button
              onClick={() => setCardScale('huge')}
              className={`px-2 py-0.5 rounded text-xs transition-colors ${
                cardScale === 'huge'
                  ? 'bg-cyber-neonPink text-white font-bold'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              Huge
            </button>
          </div>

          {humanSide ? (
            <select
              value={viewMode === 'open' ? 'open' : humanSide}
              onChange={(e) => setViewMode(e.target.value as ViewMode)}
              aria-label="View"
              data-testid="view-mode"
              className="bg-slate-900 border border-slate-800 rounded-lg px-2 py-1 text-xs text-slate-300"
              title="Open table also shows the computer's hand"
            >
              <option value={humanSide}>My view ({humanSide === 'corp' ? 'Corp' : 'Runner'})</option>
              <option value="open">Open table</option>
            </select>
          ) : (
            <select
              value={viewMode}
              onChange={(e) => setViewMode(e.target.value as ViewMode)}
              aria-label="View"
              data-testid="view-mode"
              className="bg-slate-900 border border-slate-800 rounded-lg px-2 py-1 text-xs text-slate-300"
              title="Who is looking at the screen"
            >
              <option value="open">Open table</option>
              <option value="hotseat">Pass and play</option>
              <option value="corp">Corp view</option>
              <option value="runner">Runner view</option>
            </select>
          )}
          <button
            onClick={() => {
              setSoundEnabled(!sound);
              setSound(!sound);
            }}
            className="p-2 bg-slate-900 hover:bg-slate-800 text-slate-400 hover:text-white rounded-lg border border-slate-800 transition-colors"
            title={sound ? 'Mute sound' : 'Turn sound on'}
            data-testid="sound-toggle"
          >
            {sound ? <Volume2 className="w-4 h-4" /> : <VolumeX className="w-4 h-4" />}
          </button>
          {!gameState.winner && (
            <button
              onClick={concede}
              className="p-2 bg-slate-900 hover:bg-red-950 text-slate-400 hover:text-red-300 rounded-lg border border-slate-800 hover:border-red-800 transition-colors"
              title={`Forfeit (the ${concedingSide === 'corp' ? 'Corp' : 'Runner'} concedes)`}
              data-testid="forfeit"
            >
              <Flag className="w-4 h-4" />
            </button>
          )}
          <button
            onClick={leaveGame}
            className="p-2 bg-slate-900 hover:bg-slate-800 text-slate-400 hover:text-white rounded-lg border border-slate-800 transition-colors"
            title="Leave game (back to deck select)"
          >
            <LogOut className="w-4 h-4" />
          </button>
        </div>
      </header>

      {/* Main Tabletop */}
      <div className="flex-1 min-h-0 w-full flex flex-col lg:flex-row gap-2 p-2">
      {/* Cards on the table send their hover to the zoom panel in the side bar */}
      <ZoomContext.Provider value={zoomStore}>
      <main className="flex-1 min-w-0 min-h-0 flex flex-col gap-2">
        {/* Victory Banner */}
        {winner && (
          <div className="shrink-0 p-3 bg-gradient-to-r from-amber-950/80 to-pink-950/80 border-2 border-amber-500 chamfer flex items-center justify-between shadow-2xl">
            <div>
              <h2 className="text-xl font-cyber font-black text-amber-400">
                GAME OVER // {winner.toUpperCase()} VICTORIOUS
              </h2>
              <p className="text-xs text-slate-300 mt-1">{winReason}</p>
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => setGameOverHidden(false)}
                className="px-4 py-2.5 bg-slate-800 hover:bg-slate-700 text-slate-100 font-bold rounded-xl text-xs shadow-lg transition-colors"
              >
                Show result
              </button>
              <button
                onClick={onNewGame}
                className="px-5 py-2.5 bg-amber-500 hover:bg-amber-400 text-black font-bold rounded-xl text-xs shadow-lg transition-colors"
              >
                Play Again
              </button>
            </div>
          </div>
        )}

        {/* CORP SECTOR (TOP HALF) */}
        <section id="corp-board" className="flex-1 min-h-0 flex flex-col gap-1.5 bg-slate-950/70 border border-cyan-900/80 chamfer hud-frame hud-corp p-2 shadow-xl relative w-full min-w-0">
          <div className="shrink-0 flex flex-wrap items-center justify-between gap-x-3 gap-y-1 pb-1 border-b border-cyan-950">
            {/* Identity & Header */}
            <div className="flex items-center gap-3">
              <span className="w-2 h-2 rounded-full bg-cyan-400 shadow-[0_0_10px_#00f0ff]" />
              <div className="flex items-center gap-2 flex-wrap">
                <h2 className="font-cyber font-bold text-xs tracking-wider text-cyan-400">
                  CORP
                </h2>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-slate-300 font-mono font-bold truncate max-w-[18rem]" title={cardDef(corp.identity).title}>
                    {cardDef(corp.identity).title}
                  </span>
                  <button
                    onClick={() => setInspectedCard(corp.identity)}
                    className="text-[10px] text-cyan-400 hover:text-cyan-200 border border-cyan-800/80 bg-cyan-950/40 px-1.5 py-0.5 rounded flex items-center gap-1 transition-colors"
                    title="Inspect Corp Identity card"
                  >
                    <Eye className="w-2.5 h-2.5" /> View ID
                  </button>
                </div>
              </div>
            </div>

            {/* Corp Stats */}
            <div className="flex items-center gap-1.5 text-[11px] font-mono flex-wrap">
              <div className="flex items-center gap-1.5 bg-cyan-950/80 border border-cyan-800 px-2 py-0.5 rounded-lg text-cyan-300 shadow">
                <CreditIcon className="w-3.5 h-3.5 text-amber-400" />
                <span className="font-bold">{corp.credits}</span> <Keyword id="credit">Credits</Keyword>
              </div>
              <div className="flex items-center gap-1.5 bg-cyan-950/80 border border-cyan-800 px-2 py-0.5 rounded-lg text-cyan-300 shadow">
                <Clock className="w-3.5 h-3.5 text-red-400" />
                <span className="font-bold">{corp.clicks}</span> / {corp.maxClicks} <Keyword id="click">Clicks</Keyword>
              </div>
              <div className="flex items-center gap-1.5 bg-slate-900 border border-slate-800 px-2 py-0.5 rounded-lg text-slate-400 shadow">
                <Layers className="w-3.5 h-3.5 text-slate-500" />
                <span><Keyword id="rd">R&D</Keyword>: {corp.rd.length}</span>
              </div>
              {zoneButton(
                'archives',
                'Archives',
                corp.archives.faceUp.length + corp.archives.faceDown.length,
                <Archive className="w-3.5 h-3.5 text-slate-500" />
              )}
              {zoneButton('corp-score', 'Scored', corp.scoreArea.length, <Award className="w-3.5 h-3.5 text-cyan-400" />)}
              {gameState.removedFromGame.length > 0 &&
                zoneButton('removed', 'Removed', gameState.removedFromGame.length, <Ban className="w-3.5 h-3.5 text-slate-500" />)}
            </div>
          </div>


          <div className="flex-1 min-h-0 flex flex-col lg:flex-row gap-2 min-w-0">
          {/* Servers Grid */}
          <div className="flex items-start gap-2 flex-1 min-w-0 min-h-0 overflow-auto pt-2 pb-1">
            {serversView}
          </div>
          {/* Corp HQ Hand: beside the servers on wide screens */}
          <div className="min-w-0 lg:max-w-[45%] shrink-0 flex flex-col overflow-x-auto overflow-y-hidden">
            <div className="text-[11px] text-cyan-400 font-bold uppercase tracking-wider">
              <span><Keyword id="hq">HQ</Keyword> Hand (<Keyword id="hand-size">{corp.hq.length} / {corp.handSizeLimit}</Keyword>)</span>
            </div>
            <HandRow
              cards={corp.hq}
              side="corp"
              canSee={canSeeCorpSecrets(viewer)}
              isSelectable={activePlayer === 'corp' && corpCanAct}
              selectedCardId={selectedCardId}
              onSelect={setSelectedCardId}
              onInspect={setInspectedCard}
              discardedIds={discardedIds}
            />
          </div>
          </div>
        </section>

        {/* RUNNER SECTOR (BOTTOM): the rig is two rows, so it takes what it needs and the Corp gets the rest */}
        <section id="runner-board" className="flex-none lg:max-h-[55%] min-h-0 flex flex-col gap-1.5 bg-slate-950/70 border border-pink-900/80 chamfer hud-frame hud-runner p-2 shadow-xl relative w-full min-w-0">
          <div className="flex-1 min-h-0 flex flex-col lg:flex-row gap-2 min-w-0">
          {/* Runner Rig (Installed Programs, Hardware, Resources) */}
          <div className="flex-1 min-w-0 min-h-0 overflow-auto">
            {rigView}
          </div>
          {/* Runner Grip Hand: beside the rig on wide screens */}
          <div className="min-w-0 lg:max-w-[45%] shrink-0 flex flex-col overflow-x-auto overflow-y-hidden">
            <div className="text-[11px] text-pink-400 font-bold uppercase tracking-wider">
              <span><Keyword id="grip">Grip</Keyword> Hand (<Keyword id="hand-size">{runner.grip.length} / {runner.handSizeLimit}</Keyword>)</span>
            </div>
            <HandRow
              cards={runner.grip}
              side="runner"
              canSee={canSeeRunnerSecrets(viewer)}
              isSelectable={activePlayer === 'runner' && runnerCanAct}
              selectedCardId={selectedCardId}
              onSelect={setSelectedCardId}
              onInspect={setInspectedCard}
              discardedIds={discardedIds}
            />
          </div>
          </div>


          <div className="shrink-0 flex flex-wrap items-center justify-between gap-x-3 gap-y-1 pt-1 border-t border-pink-950">
            {/* Identity & Header */}
            <div className="flex items-center gap-3">
              <span className="w-2 h-2 rounded-full bg-pink-400 shadow-[0_0_10px_#ff0055]" />
              <div className="flex items-center gap-2 flex-wrap">
                <h2 className="font-cyber font-bold text-xs tracking-wider text-pink-400">
                  RUNNER
                </h2>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-slate-300 font-mono font-bold truncate max-w-[18rem]" title={cardDef(runner.identity).title}>
                    {cardDef(runner.identity).title}
                  </span>
                  <button
                    onClick={() => setInspectedCard(runner.identity)}
                    className="text-[10px] text-pink-400 hover:text-pink-200 border border-pink-800/80 bg-pink-950/40 px-1.5 py-0.5 rounded flex items-center gap-1 transition-colors"
                    title="Inspect Runner Identity card"
                  >
                    <Eye className="w-2.5 h-2.5" /> View ID
                  </button>
                </div>
              </div>
            </div>

            {/* Runner Stats */}
            <div className="flex items-center gap-1.5 text-[11px] font-mono flex-wrap">
              <div className="flex items-center gap-1.5 bg-pink-950/80 border border-pink-800 px-2 py-0.5 rounded-lg text-pink-300 shadow">
                <CreditIcon className="w-3.5 h-3.5 text-amber-400" />
                <span className="font-bold">{runner.credits}</span> <Keyword id="credit">Credits</Keyword>
              </div>
              <div className="flex items-center gap-1.5 bg-pink-950/80 border border-pink-800 px-2 py-0.5 rounded-lg text-pink-300 shadow">
                <Clock className="w-3.5 h-3.5 text-red-400" />
                <span className="font-bold">{runner.clicks}</span> / {runner.maxClicks} <Keyword id="click">Clicks</Keyword>
              </div>
              <div className="flex items-center gap-1.5 bg-slate-900 border border-slate-800 px-2 py-0.5 rounded-lg text-slate-400 shadow">
                <MuIcon className="w-3.5 h-3.5 text-cyan-400" />
                <span><Keyword id="mu">MU</Keyword>: {runner.memoryUnitsUsed} / {runner.memoryUnitsTotal}</span>
              </div>
              <div className="flex items-center gap-1.5 bg-slate-900 border border-slate-800 px-2 py-0.5 rounded-lg text-slate-400 shadow">
                <Layers className="w-3.5 h-3.5 text-slate-500" />
                <span><Keyword id="stack">Stack</Keyword>: {runner.stack.length}</span>
              </div>
              {zoneButton('heap', 'Heap', runner.heap.length, <Trash2 className="w-3.5 h-3.5 text-slate-500" />)}
              {zoneButton('runner-score', 'Stolen', runner.scoreArea.length, <Award className="w-3.5 h-3.5 text-pink-400" />)}
              <div
                className={`flex items-center gap-1.5 px-2 py-0.5 rounded-lg shadow border ${
                  runner.tags > 0 ? 'bg-red-950 border-red-700 text-red-300' : 'bg-slate-900 border-slate-800 text-slate-400'
                }`}
                data-testid="runner-tags"
              >
                <Tag className="w-3.5 h-3.5" />
                <span className="font-bold">{runner.tags}</span> <Keyword id="tag">Tag{runner.tags === 1 ? '' : 's'}</Keyword>
              </div>
              {runner.coreDamage > 0 && (
                <div className="flex items-center gap-1.5 bg-red-950 border border-red-800 px-2 py-0.5 rounded-lg text-red-300 shadow">
                  <span className="font-bold">{runner.coreDamage}</span> <Keyword id="core-damage">Core damage</Keyword>
                </div>
              )}
            </div>
          </div>

        </section>

      </main>
      </ZoomContext.Provider>

      {/* Side bar: the hovered card, the acting side's actions, then the log */}
      <aside className="lg:w-80 2xl:w-96 shrink-0 flex flex-col gap-2 min-h-0">
        <div className="hidden lg:block shrink-0">
          <ZoomPanel store={zoomStore} onInspect={setInspectedCard} />
        </div>
        <div className="shrink-0 lg:max-h-[40vh] overflow-y-auto flex flex-col gap-2 empty:hidden">
          {/* Dedicated Corp Action Bar (Always fully on-screen) */}
          {activePlayer === 'corp' && corpCanAct && (
            <div className="flex flex-col gap-2 p-2 bg-cyan-950/40 border border-cyan-800/80 chamfer-sm shadow-inner">
              <div className="flex items-center gap-1.5 flex-wrap">
                <span className="text-xs font-bold text-cyan-400 font-mono uppercase w-full">
                  Corp Actions ({corp.clicks} Clicks):
                </span>
                <button
                  onClick={() => handleAction({ type: 'GAIN_CREDIT', player: 'corp' })}
                  disabled={corp.clicks < 1}
                  className="px-2 py-1 bg-cyan-950 hover:bg-cyan-900 border border-cyan-700 text-cyan-200 text-xs font-bold rounded-lg transition-all flex items-center gap-1.5 disabled:opacity-40 shadow"
                >
                  <CreditIcon className="w-3.5 h-3.5 text-amber-400" /> +1 Credit
                </button>
                <button
                  onClick={() => handleAction({ type: 'DRAW_CARD', player: 'corp' })}
                  disabled={corp.clicks < 1}
                  className="px-2 py-1 bg-cyan-950 hover:bg-cyan-900 border border-cyan-700 text-cyan-200 text-xs font-bold rounded-lg transition-all flex items-center gap-1.5 disabled:opacity-40 shadow"
                >
                  <Layers className="w-3.5 h-3.5 text-cyan-400" /> Draw Card
                </button>
                <button
                  onClick={() => handleAction({ type: 'PURGE_VIRUS', player: 'corp' })}
                  disabled={!isLegalAction(gameState, { type: 'PURGE_VIRUS', player: 'corp' })}
                  className="px-2 py-1 bg-cyan-950 hover:bg-cyan-900 border border-cyan-700 text-cyan-200 text-xs font-bold rounded-lg transition-all flex items-center gap-1.5 disabled:opacity-40 shadow"
                  title="Spend 3 clicks to remove every virus counter"
                >
                  <Biohazard className="w-3.5 h-3.5 text-lime-400" /> Purge (3 clicks)
                </button>
                {getLegalActions(gameState, 'corp')
                  .filter(a => a.type === 'TRASH_RESOURCE')
                  .map(a => {
                    const res = a.type === 'TRASH_RESOURCE' ? findCardAnywhere(gameState, a.cardInstanceId) : undefined;
                    return (
                      <button
                        key={a.type === 'TRASH_RESOURCE' ? a.cardInstanceId : ''}
                        onClick={() => handleAction(a)}
                        className="px-2 py-1 bg-red-950 hover:bg-red-900 border border-red-700 text-red-200 text-xs font-bold rounded-lg transition-all flex items-center gap-1.5 shadow"
                        title="The Runner is tagged: spend a click and 2 credits to trash this resource"
                      >
                        <Trash2 className="w-3.5 h-3.5" /> Trash {res ? cardDef(res).title : 'resource'} (1 click + <Credits amount={2} />)
                      </button>
                    );
                  })}
                {playButton('corp')}
                {selectedCard && !selectedIsPlayable && cardDef(selectedCard).side_code === 'corp' && (
                  <CorpInstallOptions state={gameState} card={selectedCard} onAction={handleAction} />
                )}
              </div>

              {/* End Turn Button - Prominently Anchored */}
              <button
                onClick={() => handleAction({ type: 'END_TURN', player: 'corp' })}
              disabled={!isLegalAction(gameState, { type: 'END_TURN', player: 'corp' })}
                className="px-3 py-1.5 bg-cyan-600 hover:bg-cyan-500 text-white font-mono text-xs font-bold rounded-lg border border-cyan-400 transition-all shadow-lg shadow-cyan-950 flex items-center gap-1.5 self-end disabled:opacity-40 disabled:hover:scale-100"
              >
                End Corp Turn <ArrowRight className="w-3.5 h-3.5" />
              </button>
            </div>
          )}

          {corpCanAct && <AbilityBar state={gameState} side="corp" onAction={handleAction} />}
          {/* Dedicated Runner Action Bar (Always fully on-screen) */}
          {activePlayer === 'runner' && runnerCanAct && (
            <div className="flex flex-col gap-2 p-2 bg-pink-950/40 border border-pink-800/80 chamfer-sm shadow-inner">
              <div className="flex items-center gap-1.5 flex-wrap">
                <span className="text-xs font-bold text-pink-400 font-mono uppercase w-full">
                  Runner Actions ({runner.clicks} Clicks):
                </span>
                <button
                  onClick={() => handleAction({ type: 'GAIN_CREDIT', player: 'runner' })}
                  disabled={runner.clicks < 1}
                  className="px-2 py-1 bg-pink-950 hover:bg-pink-900 border border-pink-700 text-pink-200 text-xs font-bold rounded-lg transition-all flex items-center gap-1.5 disabled:opacity-40 shadow"
                >
                  <CreditIcon className="w-3.5 h-3.5 text-amber-400" /> +1 Credit
                </button>
                <button
                  onClick={() => handleAction({ type: 'DRAW_CARD', player: 'runner' })}
                  disabled={runner.clicks < 1}
                  className="px-2 py-1 bg-pink-950 hover:bg-pink-900 border border-pink-700 text-pink-200 text-xs font-bold rounded-lg transition-all flex items-center gap-1.5 disabled:opacity-40 shadow"
                >
                  <Layers className="w-3.5 h-3.5 text-pink-400" /> Draw Card
                </button>
                {runner.tags > 0 && (
                  <button
                    onClick={() => handleAction({ type: 'REMOVE_TAG', player: 'runner' })}
                    disabled={!isLegalAction(gameState, { type: 'REMOVE_TAG', player: 'runner' })}
                    className="px-2 py-1 bg-pink-950 hover:bg-pink-900 border border-pink-700 text-pink-200 text-xs font-bold rounded-lg transition-all flex items-center gap-1.5 disabled:opacity-40 shadow"
                  >
                    <Tag className="w-3.5 h-3.5 text-red-400" /> Remove Tag (1 click + <Credits amount={2} />)
                  </button>
                )}
                {playButton('runner')}
                {selectedCardId &&
                  !selectedIsPlayable &&
                  selectedCard &&
                  getCardScript(selectedCard.cardCode)?.installsOnIce &&
                  getLegalActions(gameState, 'runner')
                    .filter(a => a.type === 'INSTALL_CARD' && a.cardInstanceId === selectedCardId && a.hostInstanceId)
                    .map(a => {
                      const host = a.type === 'INSTALL_CARD' && a.hostInstanceId ? findCardAnywhere(gameState, a.hostInstanceId) : undefined;
                      const server = host && Object.values(corp.servers).find(s => s.ice.includes(host));
                      return (
                        <button
                          key={a.type === 'INSTALL_CARD' ? a.hostInstanceId : ''}
                          onClick={() => handleAction(a)}
                          className="px-2 py-1 bg-cyber-neonPink hover:bg-pink-600 text-white text-xs font-bold rounded-lg transition-all flex items-center gap-1.5 shadow-lg"
                        >
                          <Plus className="w-3.5 h-3.5" /> Install on {host?.isRezzed ? cardDef(host).title : 'unrezzed ice'} ({server?.name})
                        </button>
                      );
                    })}
                {selectedCardId && !selectedIsPlayable && !(selectedCard && getCardScript(selectedCard.cardCode)?.installsOnIce) && (
                  <button
                    onClick={() => {
                      handleAction({
                        type: 'INSTALL_CARD',
                        player: 'runner',
                        cardInstanceId: selectedCardId,
                      });
                    }}
                    disabled={installBlocked !== null}
                    title={installBlocked ?? undefined}
                    className="px-2 py-1 bg-cyber-neonPink hover:bg-pink-600 text-white text-xs font-bold rounded-lg transition-all flex items-center gap-1.5 shadow-lg animate-pulse disabled:opacity-40 disabled:animate-none"
                  >
                    <Plus className="w-3.5 h-3.5" /> Install Card
                  </button>
                )}
                {hostedCardActions(gameState).map(a => {
                  if (a.type !== 'INSTALL_CARD' && a.type !== 'PLAY_OPERATION_OR_EVENT') return null;
                  const hosted = findCardAnywhere(gameState, a.cardInstanceId);
                  if (!hosted) return null;
                  return (
                    <button
                      key={`${a.type}-${a.cardInstanceId}-${a.type === 'INSTALL_CARD' ? a.hostInstanceId ?? '' : ''}`}
                      onClick={() => handleAction(a)}
                      data-testid={`hosted-${a.cardInstanceId}`}
                      className="px-2 py-1 bg-pink-900 hover:bg-pink-800 border border-pink-500 text-white text-xs font-bold rounded-lg transition-all flex items-center gap-1.5 shadow"
                      title="This card is hosted faceup on your hardware"
                    >
                      {a.type === 'INSTALL_CARD' ? <Plus className="w-3.5 h-3.5" /> : <Zap className="w-3.5 h-3.5" />}
                      {a.type === 'INSTALL_CARD' ? 'Install' : 'Play'} hosted {cardDef(hosted).title}
                    </button>
                  );
                })}
              </div>

              {/* End Turn Button - Prominently Anchored */}
              <button
                onClick={() => handleAction({ type: 'END_TURN', player: 'runner' })}
              disabled={!isLegalAction(gameState, { type: 'END_TURN', player: 'runner' })}
                className="px-3 py-1.5 bg-cyber-neonPink hover:bg-pink-600 text-white font-mono text-xs font-bold rounded-lg border border-pink-400 transition-all shadow-lg shadow-pink-950 flex items-center gap-1.5 self-end disabled:opacity-40 disabled:hover:scale-100"
              >
                End Runner Turn <ArrowRight className="w-3.5 h-3.5" />
              </button>
            </div>
          )}

          {runnerCanAct && <AbilityBar state={gameState} side="runner" onAction={handleAction} />}
        </div>
        <LogFeed logs={gameState.log} className="h-56 lg:h-auto lg:flex-1 lg:min-h-[6rem]" />
      </aside>
      </div>

      {/* Active Run Overlay */}
      <RunOverlay
        state={gameState}
        onContinueRun={() => handleAction({ type: 'CONTINUE_RUN', player: 'runner' })}
        onJackOut={() => handleAction({ type: 'JACK_OUT', player: 'runner' })}
        rezCards={
          rezWindowsOn
            ? rezWindowOpen
              ? rezWindow!.cards
              : []
            : approachedIce && isLegalAction(gameState, rezAction(approachedIce))
              ? [approachedIce]
              : []
        }
        onRez={corpCanAct ? (card) => handleAction(rezAction(card)) : undefined}
        rezAbilities={rezWindowOpen ? rezWindow!.abilities : []}
        onDoneRezzing={rezWindowOpen && corpCanAct ? () => setPassedRezWindows(keys => [...keys, rezWindow!.key]) : undefined}
        runnerControls={runnerCanAct}
        canPeekCorp={canSeeCorpSecrets(viewer)}
        onInspectCard={setInspectedCard}
        onAction={handleAction}
      />

      {/* Pending player decision (mulligan, discard, trash on access) */}
      <PromptPanel
        state={gameState}
        onAnswer={(choice) => {
          const prompt = gameState.pendingPrompts[0];
          if (prompt) handleAction({ type: 'RESOLVE_PROMPT', player: prompt.side, promptId: prompt.id, choice });
        }}
        onInspectCard={setInspectedCard}
        canAnswer={
          !gameState.pendingPrompts[0] ||
          (canActAs(viewer, gameState.pendingPrompts[0].side) && gameState.pendingPrompts[0].side !== aiSide)
        }
      />

      {!handoffTo && <CardFates fates={fates} />}

      {accessed.length > 0 && !handoffTo && (
        <AccessedPanel codes={accessed} onInspect={setInspectedCard} onClose={() => setAccessed([])} />
      )}

      {zoneView && (
        <ZoneViewer
          title={zoneView.title}
          groups={zoneView.groups}
          canPeek={canSeeCorpSecrets(viewer)}
          onClose={() => setZone(null)}
          onInspect={setInspectedCard}
        />
      )}

      {handoffTo && (
        <HandoffScreen
          to={handoffTo}
          reason={
            gameState.pendingPrompts[0]
              ? 'decision'
              : rezWindowOpen
                ? 'rez'
                : 'turn'
          }
          onReady={() => {
            setHotseatSide(handoffTo);
            // Show the incoming player their own board and hand
            // (window.scrollTo, not scrollIntoView, which would also scroll the overflow-hidden <main>)
            requestAnimationFrame(() => {
              const board = document.getElementById(`${handoffTo}-board`);
              if (board) window.scrollTo({ top: board.getBoundingClientRect().top + window.scrollY - 80, behavior: 'smooth' });
            });
          }}
        />
      )}

      {winner && (
        <GameOverModal
          winner={winner}
          reason={winReason}
          corpScore={corp.score}
          runnerScore={runner.score}
          humanSide={humanSide}
          onRematch={onRematch}
          onDeckSelect={onNewGame}
          minimized={gameOverHidden}
          onMinimizedChange={setGameOverHidden}
        />
      )}

      {/* Full Card Zoom Modal */}
      <CardZoomModal
        card={inspectedCard}
        onClose={() => setInspectedCard(null)}
      />
    </div>
  );
}

/** The engine's reason an action is illegal right now, or null if it is legal. */
function illegalReason(state: GameState, action: GameAction): string | null {
  try {
    executeAction(state, action);
    return null;
  } catch (err) {
    return err instanceof Error ? err.message : 'Illegal action';
  }
}

/** Runner play and install actions for cards hosted faceup on hardware (Bling, Madani), not in the grip. */
function hostedCardActions(state: GameState): GameAction[] {
  const grip = new Set(state.runner.grip.map(c => c.instanceId));
  return getLegalActions(state, 'runner').filter(
    a => (a.type === 'INSTALL_CARD' || a.type === 'PLAY_OPERATION_OR_EVENT') && !grip.has(a.cardInstanceId),
  );
}

/**
 * Where the selected HQ card can go: a new remote, or any server the engine
 * allows (ice on any server, upgrades in centrals, a replacement in a remote).
 */
function CorpInstallOptions({
  state,
  card,
  onAction,
}: {
  state: GameState;
  card: CardInstance;
  onAction: (action: GameAction) => void;
}) {
  const def = cardDef(card);
  const options = getLegalActions(state, 'corp').filter(
    (a): a is Extract<GameAction, { type: 'INSTALL_CARD' }> => a.type === 'INSTALL_CARD' && a.cardInstanceId === card.instanceId
  );
  if (options.length === 0) {
    return <span className="text-xs text-slate-400">{def.title} cannot be installed right now.</span>;
  }
  return (
    <div className="flex items-center gap-1.5 flex-wrap" data-testid="install-options">
      <span className="text-xs text-amber-300 font-bold">Install {def.title}:</span>
      {options.map(a => {
        const server = a.targetServerId ? state.corp.servers[a.targetServerId] : null;
        const iceCost = def.type_code === 'ice' && server ? server.ice.length : 0;
        const replaced =
          server && ['agenda', 'asset'].includes(def.type_code)
            ? server.root.find(c => ['agenda', 'asset'].includes(cardDef(c).type_code))
            : undefined;
        return (
          <button
            key={`${a.targetServerId ?? 'new'}${a.faceUp ? '-faceup' : ''}`}
            onClick={() => onAction(a)}
            data-testid={`install-${a.targetServerId ?? 'new'}${a.faceUp ? '-faceup' : ''}`}
            title={replaced ? `Trashes ${cardDef(replaced).title} to make room` : undefined}
            className="px-3 py-1.5 bg-amber-500 hover:bg-amber-400 text-black text-xs font-bold rounded-xl transition-all flex items-center gap-1 shadow-lg"
          >
            <Plus className="w-3.5 h-3.5" /> {server ? server.name : 'New remote'}
            {iceCost > 0 && ` (${iceCost}c)`}
            {replaced && ' (replace)'}
            {a.faceUp && ' (faceup)'}
          </button>
        );
      })}
    </div>
  );
}

/** The cards the Runner accessed in the latest run, so accesses with nothing to decide are still seen. */
function AccessedPanel({
  codes,
  onInspect,
  onClose,
}: {
  codes: string[];
  onInspect: (card: CardInstance) => void;
  onClose: () => void;
}) {
  return (
    <div
      className="fixed left-4 bottom-6 z-40 w-72 max-w-[calc(100vw-2rem)] bg-slate-950/95 border-2 border-pink-700 rounded-2xl p-3 shadow-2xl font-mono"
      data-testid="accessed-panel"
    >
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs font-bold text-pink-300 uppercase tracking-wider">Accessed this run ({codes.length})</span>
        <button onClick={onClose} className="text-slate-400 hover:text-white text-xs px-1.5" aria-label="Dismiss accessed cards">
          ✕
        </button>
      </div>
      <div className="flex gap-2 overflow-x-auto pb-1">
        {codes.map((code, i) => (
          <CardView
            key={`${code}-${i}`}
            card={{ instanceId: `accessed-${i}`, cardCode: code, isRezzed: true, advancementCounters: 0, tokens: {}, hostedCardIds: [] }}
            size="xs"
            notInstalled
            onInspect={onInspect}
          />
        ))}
      </div>
      <p className="text-[10px] text-slate-500 mt-1.5">Cards without a trash cost (ice, operations) can't be trashed.</p>
    </div>
  );
}
