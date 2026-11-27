import React, { useEffect, useRef, useState } from 'react';
import { CardInstance, GameState, Prompt, PromptChoice, SideCode, activePrompt, availableCredits, cardDef, findCardAnywhere, locateCorpCard, trashableFirst, effectTrashableFirst } from '../../core';
import { useSeat } from '../seat';
import { TrashFirstPicker, TrashSplitSegment } from './TrashFirstPicker';
import { CardView } from './CardView';
import { Check, ExternalLink, PanelRight, RefreshCw, Trash2, X } from 'lucide-react';
import { CardNameText } from './CardNameText';
import { Credits, MuIcon } from './CreditIcon';
import { FloatingPanel } from './FloatingPanel';
import { cardPositionLabel, isInstalledCard } from '../cardLabels';
import {
  type BoardCardTarget,
  type BoardServerTarget,
  clearBoardTargets,
  hoverPromptServer,
  hoverPromptTarget,
  selectPromptTargets,
  setBoardTargets,
} from '../promptHighlight';

/** An installed Corp card that is neither rezzed nor faceup: only the Corp may look at it (rules 4.6.3). */
function isFacedownCorpCard(state: GameState, card: CardInstance): boolean {
  if (card.isRezzed || card.faceUp || cardDef(card).side_code !== 'corp') return false;
  return Object.values(state.corp.servers).some(s => s.ice.includes(card) || s.root.includes(card));
}

/**
 * Whether a pending prompt targets the tabletop board or an active run decision
 * (belongs docked in the desktop sidebar) vs. card piles or hands (pops out).
 */
export function isPromptDockable(state: GameState, prompt: Prompt | undefined): boolean {
  if (!prompt) return false;
  if (prompt.kind === 'mulligan' || prompt.kind === 'discard') return false;
  if (prompt.kind === 'effect_cards') {
    if (prompt.candidateIds.length === 0) return false;
    return prompt.candidateIds.every(id => {
      const card = findCardAnywhere(state, id);
      return !!card && isInstalledCard(state, card);
    });
  }
  return true;
}

export interface PromptPanelProps {
  state: GameState;
  onAnswer: (choice: PromptChoice) => void;
  onInspectCard?: (card: CardInstance) => void;
  /** False when the decision belongs to the side not at the screen: show a waiting note instead. */
  canAnswer?: boolean;
  /**
   * Set when the choice is the first thing an ability or event does, before the
   * action is applied (Red Team's server): backs out as if it was never used.
   */
  onCancel?: () => void;
  /**
   * The side the game waits on for a decision this screen can't see (the
   * opponent's prompt is not in the viewer's view): shows the waiting note.
   */
  waitingFor?: SideCode | null;
  /** When true, render docked inside the desktop right sidebar instead of floating over the board. */
  docked?: boolean;
  /** Toggle between docked sidebar mode and floating window mode (only passed for dockable prompts on desktop). */
  onToggleDock?: () => void;
  /** Active run metadata shown as a slim context banner when a prompt docks over an active run. */
  runContext?: { serverName: string; phase: string };
  /** Extra layout classes applied to the docked container (e.g., sidebar flex ordering). */
  className?: string;
}

/**
 * Shows the decision the game is waiting on, to the side it belongs to.
 * Board and run prompts dock in the desktop sidebar with a Pop-out toggle;
 * hand/pile prompts float over the board without dimming it.
 */
export const PromptPanel: React.FC<PromptPanelProps> = ({
  state,
  onAnswer,
  onInspectCard,
  canAnswer = true,
  onCancel,
  waitingFor = null,
  docked = false,
  onToggleDock,
  runContext,
  className = '',
}) => {
  const prompt = activePrompt(state);
  const seat = useSeat();
  const [selected, setSelected] = useState<string[]>([]);
  // An effect installing a card: the option (server) whose cards to trash first (rules 8.5.6)
  const [trashingFor, setTrashingFor] = useState<{ promptId: string; optionId: string } | null>(null);
  const [targetOwner] = useState(() => ({}));

  const isCorp = prompt?.side === 'corp';
  // An effect installing a card may first trash cards already installed (rules 8.5.6): Corp effects
  // asking where to install (option: a server), Runner effects picking a card (option: the picked card)
  const installs = !!prompt && (prompt.kind === 'effect_choice' || prompt.kind === 'effect_cards') && !!prompt.source.data?.install;
  const installCardFor = (optionId: string): CardInstance | undefined => {
    if (!prompt || !installs) return undefined;
    if (prompt.kind === 'effect_cards') return findCardAnywhere(state, optionId);
    return isCorp || optionId === 'install' ? findCardAnywhere(state, String(prompt.source.data?.cardId)) : undefined;
  };
  const trashableFor = (optionId: string): CardInstance[] => {
    if (!prompt) return [];
    const card = installCardFor(optionId);
    if (!card) return [];
    return isCorp ? (optionId === 'new' ? [] : trashableFirst(state, card, optionId)) : effectTrashableFirst(state, card, 'source' in prompt ? prompt.source.data : undefined);
  };
  const trashingChoice = (optionId: string, trash: string[]): PromptChoice =>
    prompt?.kind === 'effect_cards' ? { kind: 'effect_cards', cardInstanceIds: [optionId], trashFirst: trash } : { kind: 'effect_choice', optionId, trashFirst: trash };
  const trashing = !!prompt && installs && trashingFor?.promptId === prompt.id ? trashingFor.optionId : null;
  const maxSelected = prompt?.kind === 'discard' ? prompt.count : prompt?.kind === 'effect_cards' ? prompt.max : Infinity;
  const toggle = (id: string) =>
    setSelected(sel =>
      sel.includes(id)
        ? sel.filter(s => s !== id)
        : sel.length < maxSelected
          ? [...sel, id]
          : maxSelected === 1
            ? [id]
            : sel,
    );
  const answer = (choice: PromptChoice) => {
    setSelected([]);
    onAnswer(choice);
  };

  const answerRef = useRef(answer);
  answerRef.current = answer;
  const toggleRef = useRef(toggle);
  toggleRef.current = toggle;
  const trashableForRef = useRef(trashableFor);
  trashableForRef.current = trashableFor;
  const trashingChoiceRef = useRef(trashingChoice);
  trashingChoiceRef.current = trashingChoice;

  // Mark the picked cards on the table too, and drop every mark once the prompt closes
  useEffect(() => selectPromptTargets(selected), [selected]);
  useEffect(() => {
    setSelected([]);
    setTrashingFor(null);
    return () => {
      hoverPromptTarget(null);
      hoverPromptServer(null);
      selectPromptTargets([]);
    };
  }, [prompt?.id]);

  // Publish clickable board cards & servers for the active prompt (unless TrashFirstPicker holds them)
  useEffect(() => {
    if (!prompt || !canAnswer || trashing) {
      clearBoardTargets(targetOwner);
      return;
    }
    const cards = new Map<string, BoardCardTarget>();
    const servers = new Map<string, BoardServerTarget>();
    // The deciding side's own hand is on the table too: its cards answer to clicks like installed ones
    const ownHand = prompt.side === 'corp' ? state.corp.hq : state.runner.grip;
    const inOwnHand = (id: string) => ownHand.some(c => c.instanceId === id);

    if (prompt.kind === 'access_order') {
      for (const opt of prompt.options) {
        if (opt.id.startsWith('root:')) {
          const cardId = opt.id.slice('root:'.length);
          if (findCardAnywhere(state, cardId)) {
            cards.set(cardId, {
              onClick: () => {
                hoverPromptTarget(null);
                hoverPromptServer(null);
                answerRef.current({ kind: 'access_order', optionId: opt.id });
              },
            });
          }
        } else if (state.corp.servers[opt.id]) {
          servers.set(opt.id, {
            title: `Click to access ${state.corp.servers[opt.id].name} next`,
            onClick: () => {
              hoverPromptTarget(null);
              hoverPromptServer(null);
              answerRef.current({ kind: 'access_order', optionId: opt.id });
            },
          });
        }
      }
    } else if (prompt.kind === 'effect_choice') {
      for (const opt of prompt.options) {
        const card = findCardAnywhere(state, opt.id);
        const server = state.corp.servers[opt.id];
        const cardInstalled = card ? isInstalledCard(state, card) : false;
        const canNormal = seat.can({
          type: 'RESOLVE_PROMPT',
          player: prompt.side,
          promptId: prompt.id,
          choice: { kind: 'effect_choice', optionId: opt.id },
        });
        const trashables = installs ? trashableForRef.current(opt.id) : [];
        const canWithTrash =
          trashables.length > 0 &&
          seat.can({
            type: 'RESOLVE_PROMPT',
            player: prompt.side,
            promptId: prompt.id,
            choice: trashingChoiceRef.current(opt.id, trashables.map(c => c.instanceId)),
          });
        const autoTrash = !canNormal && canWithTrash;
        if (!canNormal && !autoTrash) continue;

        const pickOption = () => {
          hoverPromptTarget(null);
          hoverPromptServer(null);
          if (autoTrash) {
            setTrashingFor({ promptId: prompt.id, optionId: opt.id });
            return;
          }
          answerRef.current({ kind: 'effect_choice', optionId: opt.id });
        };
        if (card && (cardInstalled || inOwnHand(opt.id))) {
          cards.set(opt.id, { onClick: pickOption });
        } else if (server) {
          servers.set(server.id, { title: opt.label, onClick: pickOption });
        }
      }
    } else if (prompt.kind === 'effect_cards') {
      for (const id of prompt.candidateIds) {
        const card = findCardAnywhere(state, id);
        if (card && (isInstalledCard(state, card) || inOwnHand(id))) {
          cards.set(id, {
            onClick: () => toggleRef.current(id),
          });
        }
      }
    } else if (prompt.kind === 'discard') {
      for (const card of ownHand) cards.set(card.instanceId, { onClick: () => toggleRef.current(card.instanceId) });
    }

    if (cards.size === 0 && servers.size === 0) {
      clearBoardTargets(targetOwner);
    } else {
      setBoardTargets(targetOwner, { cards, servers });
    }
  }, [targetOwner, prompt, canAnswer, trashing, installs, state, seat]);

  useEffect(() => () => clearBoardTargets(targetOwner), [targetOwner]);

  if (!prompt && !waitingFor) return null;
  if (!prompt || !canAnswer) {
    const side = waitingFor ?? prompt?.side;
    return (
      <div className="fixed top-20 left-1/2 -translate-x-1/2 z-40 bg-[#090d15]/95 border border-slate-700 rounded-[2px] px-4 py-2 text-xs font-mono text-slate-300 shadow-xl">
        Waiting on the {side === 'corp' ? 'Corp' : 'Runner'} to decide…
      </div>
    );
  }

  const trashOptions = !installs
    ? []
    : (prompt.kind === 'effect_choice' ? prompt.options.map(o => o.id) : selected.length === 1 ? selected : []).filter(id => trashableFor(id).length > 0);
  const hand = isCorp ? state.corp.hq : state.runner.grip;
  const accent = isCorp ? 'border-cyan-500 shadow-cyan-950/60' : 'border-pink-500 shadow-pink-950/60';
  const isFull = selected.length >= maxSelected && maxSelected !== 1;

  const button = `${docked ? 'px-3 py-1.5' : 'px-4 py-2'} text-xs font-bold rounded-[2px] border border-b-2 flex items-center gap-1.5 transition-all disabled:opacity-40 active:translate-y-[1px] active:border-b-[1px]`;

  const titleLabel = (
    <div className={`text-xs font-bold uppercase tracking-wider ${isCorp ? 'text-cyan-400' : 'text-pink-400'}`}>
      {isCorp ? 'Corp' : 'Runner'} decision
    </div>
  );

  const effectCardsFooter = prompt.kind === 'effect_cards' && !trashing ? (() => {
    const inRange = selected.length >= prompt.min && selected.length <= prompt.max;
    const canNormal =
      inRange &&
      seat.can({ type: 'RESOLVE_PROMPT', player: prompt.side, promptId: prompt.id, choice: { kind: 'effect_cards', cardInstanceIds: selected } });
    const hasTrashable = selected.length === 1 && trashOptions.includes(selected[0]);
    const canWithTrash =
      hasTrashable &&
      seat.can({
        type: 'RESOLVE_PROMPT',
        player: prompt.side,
        promptId: prompt.id,
        choice: trashingChoice(selected[0], trashableFor(selected[0]).map(c => c.instanceId)),
      });
    const autoTrash = !canNormal && canWithTrash;
    const canTrashSplit = canNormal && hasTrashable;
    const confirmBtn = (
      <button
        className={`${button} bg-emerald-700 hover:bg-emerald-600 border-emerald-500 text-white ${canTrashSplit ? 'rounded-r-none' : ''}`}
        disabled={!inRange && !autoTrash}
        onClick={() => {
          if (autoTrash) {
            setTrashingFor({ promptId: prompt.id, optionId: selected[0] });
            return;
          }
          answer({ kind: 'effect_cards', cardInstanceIds: selected });
        }}
      >
        <Check className="w-3.5 h-3.5" /> Confirm{autoTrash ? (isCorp ? ' — trash first…' : ' — free MU…') : ''}
      </button>
    );
    return {
      status: (
        <span className="text-xs text-slate-400">
          Selected {selected.length} ({prompt.min === prompt.max ? prompt.min : `${prompt.min}-${prompt.max}`})
          {isFull && <span className="text-amber-300"> · limit reached, deselect a card to change</span>}
        </span>
      ),
      confirm: !canTrashSplit ? confirmBtn : (
        <div className="inline-flex items-stretch">
          {confirmBtn}
          <TrashSplitSegment
            title="Trash installed programs first, to free memory for this one"
            onClick={() => setTrashingFor({ promptId: prompt.id, optionId: selected[0] })}
            testId={`prompt-trash-first-${selected[0]}`}
            className="border-emerald-500"
          />
        </div>
      ),
    };
  })() : null;

  const accessTrashData = prompt.kind === 'access_trash' ? (() => {
    const card = locateCorpCard(state, prompt.cardInstanceId)?.card;
    const canPay = card ? availableCredits(state, 'runner', { kind: 'trash', card }) : state.runner.credits;
    const canTrash = seat.can({
      type: 'RESOLVE_PROMPT',
      player: 'runner',
      promptId: prompt.id,
      choice: { kind: 'access_trash', trash: true },
    });
    const justLooking = prompt.trashCost === null && (prompt.alternatives ?? []).length === 0;
    const actions = justLooking ? (
      <button className={`${button} bg-slate-800 hover:bg-slate-700 border-slate-600 text-slate-200`} onClick={() => answer({ kind: 'access_trash', trash: false })}>
        Continue
      </button>
    ) : (
      <>
        <button className={`${button} bg-slate-800 hover:bg-slate-700 border-slate-600 text-slate-200`} onClick={() => answer({ kind: 'access_trash', trash: false })}>
          <X className="w-3.5 h-3.5" /> {card && cardDef(card).type_code === 'agenda' ? 'Steal it' : 'Leave it'}
        </button>
        {(prompt.alternatives ?? []).map(alt => (
          <button
            key={alt.id}
            className={`${button} bg-purple-800 hover:bg-purple-700 border-purple-500 text-white`}
            onClick={() => answer({ kind: 'access_trash', trash: false, alternativeId: alt.id })}
          >
            <Trash2 className="w-3.5 h-3.5" /> {alt.label}
          </button>
        ))}
        {prompt.trashCost !== null && (
          <button
            className={`${button} bg-red-700 hover:bg-red-600 border-red-500 text-white`}
            disabled={!canTrash}
            title={canTrash ? undefined : 'Not enough credits to pay the trash cost'}
            onClick={() => {
              hoverPromptTarget(null);
              answer({ kind: 'access_trash', trash: true });
            }}
            onMouseEnter={() => card && hoverPromptTarget({ id: card.instanceId, label: null })}
            onMouseLeave={() => hoverPromptTarget(null)}
          >
            <Trash2 className="w-3.5 h-3.5" /> Trash (<Credits amount={prompt.trashCost ?? 0} />)
          </button>
        )}
      </>
    );
    return { card, trashCost: prompt.trashCost, canPay, justLooking, actions };
  })() : null;

  const cancelButton = onCancel && !trashing ? (
    <button
      data-testid="prompt-cancel"
      title="Back out: the action is not used and nothing is spent"
      className={`${button} bg-slate-900 hover:bg-slate-800 border-slate-600 text-slate-300`}
      onClick={() => {
        setSelected([]);
        onCancel();
      }}
    >
      <X className="w-3.5 h-3.5" /> Cancel
    </button>
  ) : null;

  const hasBoardTargets = (() => {
    if (trashing) return false;
    const ownHand = prompt.side === 'corp' ? state.corp.hq : state.runner.grip;
    const inOwnHand = (id: string) => ownHand.some(c => c.instanceId === id);
    if (prompt.kind === 'discard') return ownHand.length > 0;
    if (prompt.kind === 'access_order') {
      return prompt.options.some(opt =>
        opt.id.startsWith('root:')
          ? !!findCardAnywhere(state, opt.id.slice('root:'.length))
          : !!state.corp.servers[opt.id],
      );
    }
    if (prompt.kind === 'effect_cards') {
      return prompt.candidateIds.some(id => {
        const c = findCardAnywhere(state, id);
        return !!c && (isInstalledCard(state, c) || inOwnHand(id));
      });
    }
    if (prompt.kind === 'effect_choice') {
      return prompt.options.some(opt => {
        if (state.corp.servers[opt.id]) return true;
        const c = findCardAnywhere(state, opt.id);
        return !!c && (isInstalledCard(state, c) || inOwnHand(opt.id));
      });
    }
    return false;
  })();

  const promptContent = (
    <>
      <div className={docked ? 'space-y-0.5' : 'mb-4 space-y-1'}>
        <h3 className="text-sm text-slate-100 font-bold leading-snug">
          <CardNameText text={prompt.message} />
        </h3>
        {hasBoardTargets && (
          <p className="text-[11px] text-slate-400 font-mono" data-testid="board-target-hint">
            Click a highlighted target on the board, or choose below
          </p>
        )}
      </div>

      {prompt.kind === 'mulligan' && (
        <>
          <div className="flex gap-2 overflow-x-auto py-2 mb-4">
            {hand.map(card => (
              <CardView key={card.instanceId} card={card} size="sm" notInstalled typeIcons onInspect={onInspectCard} />
            ))}
          </div>
          <div className="flex gap-2 justify-end">
            <button className={`${button} bg-slate-800 hover:bg-slate-700 border-slate-600 text-slate-200`} onClick={() => answer({ kind: 'mulligan', mulligan: true })}>
              <RefreshCw className="w-3.5 h-3.5" /> Mulligan
            </button>
            <button className={`${button} bg-emerald-700 hover:bg-emerald-600 border-emerald-500 text-white`} onClick={() => answer({ kind: 'mulligan', mulligan: false })}>
              <Check className="w-3.5 h-3.5" /> Keep hand
            </button>
          </div>
        </>
      )}

      {prompt.kind === 'discard' && (
        <>
          <div className="flex gap-2 overflow-x-auto py-2 mb-4">
            {hand.map(card => (
              <CardView
                key={card.instanceId}
                card={card}
                size="sm"
                notInstalled
                typeIcons
                isSelectable={!isFull || selected.includes(card.instanceId)}
                isSelected={selected.includes(card.instanceId)}
                onClick={() => toggle(card.instanceId)}
                onInspect={onInspectCard}
              />
            ))}
          </div>
          <div className="flex items-center justify-between">
            <span className="text-xs text-slate-400">
              Selected {selected.length} / {prompt.count}
              {isFull && <span className="text-amber-300"> · limit reached, deselect a card to change</span>}
            </span>
            <button
              className={`${button} bg-red-700 hover:bg-red-600 border-red-500 text-white`}
              disabled={selected.length !== prompt.count}
              onClick={() => answer({ kind: 'discard', cardInstanceIds: selected })}
            >
              <Trash2 className="w-3.5 h-3.5" /> Discard selected
            </button>
          </div>
        </>
      )}

      {prompt.kind === 'access_order' && (
        <div className={`flex gap-2 flex-wrap ${docked ? 'justify-start' : 'justify-end'}`}>
          {prompt.options.map(option => (
            <button
              key={option.id}
              className={`${button} bg-slate-800 hover:bg-slate-700 border-slate-600 text-slate-100 max-w-full text-left`}
              onClick={() => answer({ kind: 'access_order', optionId: option.id })}
            >
              <CardNameText text={option.label} focusable={false} />
            </button>
          ))}
        </div>
      )}

      {trashing && (() => {
        const card = installCardFor(trashing)!;
        const where = isCorp ? ` in ${state.corp.servers[trashing]?.name ?? ''}` : '';
        const isCorpIce = isCorp && cardDef(card).type_code === 'ice';
        const rawCards = trashableFor(trashing);
        const cards = isCorpIce ? [...rawCards].reverse() : rawCards;
        const neededMu = !isCorp ? (cardDef(card).memory_cost ?? 0) : 0;
        const freeMu = !isCorp ? Math.max(0, state.runner.memoryUnitsTotal - state.runner.memoryUnitsUsed) : 0;
        return (
          <TrashFirstPicker
            key={trashing}
            serverId={isCorp ? trashing : undefined}
            iceSlots={isCorpIce}
            heading={`Install ${cardDef(card).title}${where}, trashing first:`}
            cards={cards}
            statusText={
              neededMu > 0
                ? trash => {
                    const freed = trash.reduce((sum, id) => {
                      const p = findCardAnywhere(state, id);
                      return sum + (p ? (cardDef(p).memory_cost ?? 0) : 0);
                    }, 0);
                    const total = freeMu + freed;
                    return total >= neededMu
                      ? <span className="text-emerald-400 inline-flex items-center gap-1"><MuIcon className="w-3.5 h-3.5 shrink-0" /> {total}/{neededMu} MU available</span>
                      : `Need ${neededMu - total} more MU`;
                  }
                : undefined
            }
            confirmLabel={trash => `Install${trash.length > 0 ? `, trash ${trash.length}` : ''}`}
            canConfirm={trash =>
              trash.length > 0 &&
              seat.can({ type: 'RESOLVE_PROMPT', player: prompt.side, promptId: prompt.id, choice: trashingChoice(trashing, trash) })
            }
            onConfirm={trash => {
              setTrashingFor(null);
              answer(trashingChoice(trashing, trash));
            }}
            onCancel={() => setTrashingFor(null)}
          />
        );
      })()}

      {prompt.kind === 'effect_choice' && !trashing && (
        <div className={`flex gap-2 flex-wrap ${docked ? 'justify-start' : 'justify-end'}`}>
          {prompt.options.map(option => {
            // Options that name a card or server on the table light it up like a pick
            const card = findCardAnywhere(state, option.id);
            const server = state.corp.servers[option.id];
            const position = card ? cardPositionLabel(state, card) : null;
            const hasTrashable = trashOptions.includes(option.id);
            const canNormal = seat.can({ type: 'RESOLVE_PROMPT', player: prompt.side, promptId: prompt.id, choice: { kind: 'effect_choice', optionId: option.id } });
            const canWithTrash =
              hasTrashable &&
              seat.can({
                type: 'RESOLVE_PROMPT',
                player: prompt.side,
                promptId: prompt.id,
                choice: trashingChoice(option.id, trashableFor(option.id).map(c => c.instanceId)),
              });
            const autoTrash = !canNormal && canWithTrash;
            const canTrashSplit = canNormal && hasTrashable;
            const btn = (
              <button
                key={option.id}
                className={`${button} bg-slate-800 hover:bg-slate-700 border-slate-600 text-slate-100 max-w-full text-left ${canTrashSplit ? 'rounded-r-none' : ''}`}
                onClick={() => {
                  hoverPromptTarget(null);
                  hoverPromptServer(null);
                  if (autoTrash) {
                    setTrashingFor({ promptId: prompt.id, optionId: option.id });
                    return;
                  }
                  answer({ kind: 'effect_choice', optionId: option.id });
                }}
                onMouseEnter={() => {
                  if (card) hoverPromptTarget({ id: option.id, label: position });
                  else if (server) hoverPromptServer(server.id);
                }}
                onMouseLeave={() => {
                  if (card) hoverPromptTarget(null);
                  else if (server) hoverPromptServer(null);
                }}
              >
                <CardNameText text={option.label} focusable={false} />
                {autoTrash && <span className="text-slate-300 font-normal">{isCorp ? '— trash first…' : '— free MU…'}</span>}
              </button>
            );
            if (!canTrashSplit) return btn;
            return (
              <div key={option.id} className="inline-flex items-stretch">
                {btn}
                <TrashSplitSegment
                  title={isCorp ? "Trash cards already there as part of this install; trashed ice doesn't count toward the install cost" : 'Trash installed programs first, to free memory for this one'}
                  onClick={() => {
                    hoverPromptTarget(null);
                    hoverPromptServer(null);
                    setTrashingFor({ promptId: prompt.id, optionId: option.id });
                  }}
                  onMouseEnter={() => {
                    if (server) hoverPromptServer(server.id);
                  }}
                  onMouseLeave={() => {
                    if (server) hoverPromptServer(null);
                  }}
                  testId={`prompt-trash-first-${option.id}`}
                  className="border-slate-600"
                />
              </div>
            );
          })}
        </div>
      )}

      {prompt.kind === 'effect_cards' && !trashing && (
        <>
          <div className={docked ? 'flex flex-wrap justify-center gap-2.5 py-1' : 'flex gap-2 overflow-x-auto py-2 mb-4'}>
            {prompt.candidateIds.map(id => {
              const card = findCardAnywhere(state, id);
              // The Runner never sees the face of an unrezzed Corp card it is choosing (Tāo Salonga)
              const secret = !!card && !isCorp && isFacedownCorpCard(state, card);
              const position = card ? cardPositionLabel(state, card) : null;
              return card ? (
                <div
                  key={id}
                  className="flex flex-col items-center gap-1 shrink-0"
                  onMouseEnter={() => hoverPromptTarget({ id, label: position })}
                  onMouseLeave={() => hoverPromptTarget(null)}
                >
                  <CardView
                    card={card}
                    size="sm"
                    notInstalled={!isInstalledCard(state, card)}
                    isFaceDown={secret}
                    canPeek={!secret}
                    typeIcons
                    isSelectable={!isFull || selected.includes(id)}
                    isSelected={selected.includes(id)}
                    onClick={() => toggle(id)}
                    onInspect={secret ? undefined : onInspectCard}
                  />
                  {position && (
                    <span data-testid="prompt-card-position" className="w-28 text-center text-[11px] leading-tight font-mono text-slate-400">
                      {position}
                    </span>
                  )}
                </div>
              ) : null;
            })}
          </div>
          {!docked && effectCardsFooter && (
            <div className="flex items-center justify-between">
              {effectCardsFooter.status}
              {effectCardsFooter.confirm}
            </div>
          )}
        </>
      )}

      {accessTrashData && (
        <>
          <div className={`flex ${docked ? 'items-start gap-3' : 'items-center gap-4 mb-4'}`}>
            {accessTrashData.card && (
              <CardView card={accessTrashData.card} size={docked ? 'sm' : 'md'} typeIcons onInspect={onInspectCard} />
            )}
            {accessTrashData.justLooking ? (
              accessTrashData.card && <div className="text-xs font-bold text-slate-100">{cardDef(accessTrashData.card).title}</div>
            ) : (
              <div className="text-xs text-slate-300 leading-relaxed min-w-0">
                {accessTrashData.card && <div className="font-bold text-slate-100 mb-1">{cardDef(accessTrashData.card).title}</div>}
                {accessTrashData.trashCost !== null && (
                  <>
                    Trash cost: <span className="text-red-300 font-bold"><Credits amount={accessTrashData.trashCost} /></span> ·{' '}
                  </>
                )}
                You have <span className="text-amber-300 font-bold"><Credits amount={accessTrashData.canPay} /></span>
                {accessTrashData.canPay !== state.runner.credits && (
                  <span className="text-slate-400"> ({state.runner.credits} in your pool, the rest from run or hosted credits)</span>
                )}
              </div>
            )}
          </div>
          {!docked && (
            <div className="flex gap-2 justify-end flex-wrap">
              {accessTrashData.actions}
            </div>
          )}
        </>
      )}

      {!docked && cancelButton && (
        <div className="flex justify-end mt-3 pt-3 border-t border-slate-800">
          {cancelButton}
        </div>
      )}
    </>
  );

  if (docked) {
    const hasFooter = !!(effectCardsFooter || accessTrashData || cancelButton);
    return (
      <div
        data-testid="prompt-panel"
        className={`shrink min-h-[min(48vh,calc(100%-8rem))] flex flex-col bg-[#090d15] border-2 ${accent} rounded-[2px] shadow-2xl font-mono overflow-hidden ${className}`}
      >
        {runContext && (
          <div className="px-3 py-1 bg-[#140a16] border-b border-pink-900/50 flex items-center justify-between gap-2 text-[11px] font-mono shrink-0">
            <span className="font-cyber font-bold text-cyber-neonPink tracking-wider truncate">
              RUN // {runContext.serverName.toUpperCase()}
            </span>
            <span className="text-slate-400 uppercase tracking-wider shrink-0">
              {runContext.phase.replace(/_/g, ' ')}
            </span>
          </div>
        )}
        <div className="px-3 py-2 border-b border-slate-800 bg-[#0c121d] flex items-center justify-between gap-2 shrink-0">
          <div className="flex items-center gap-2 min-w-0">
            <span className={`h-2 w-2 rounded-full shrink-0 ${isCorp ? 'bg-cyan-400' : 'bg-pink-400'}`} />
            {titleLabel}
          </div>
          {onToggleDock && (
            <button
              type="button"
              onClick={onToggleDock}
              data-testid="prompt-panel-popout"
              title="Pop out into floating window"
              aria-label="Pop out decision panel"
              className="shrink-0 inline-flex items-center gap-1 px-2 py-0.5 rounded-[2px] text-[11px] font-mono text-slate-300 hover:text-white bg-slate-900 hover:bg-slate-800 border border-slate-700"
            >
              <ExternalLink className="w-3 h-3" /> Pop out
            </button>
          )}
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto p-3 flex flex-col gap-3">
          {promptContent}
        </div>

        {hasFooter && (
          <div className="p-2 border-t border-slate-800 bg-[#070a11] flex flex-wrap items-center justify-between gap-2 shrink-0">
            <div className="flex items-center gap-2 min-w-0">
              {effectCardsFooter?.status}
              {cancelButton}
            </div>
            <div className="flex flex-wrap items-center justify-end gap-1.5 ml-auto">
              {effectCardsFooter?.confirm}
              {accessTrashData?.actions}
            </div>
          </div>
        )}
      </div>
    );
  }

  return (
    <FloatingPanel
      key={prompt.id}
      testId="prompt-panel"
      accentClass={accent}
      dotClass={isCorp ? 'bg-cyan-400' : 'bg-pink-400'}
      defaultPlacement="left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2"
      minimizedPlacement="left-1/2 top-20 -translate-x-1/2"
      widthClass="w-[56rem]"
      minimizedLabel={`Decision waiting: ${prompt.message}`}
      headerActions={
        onToggleDock ? (
          <button
            type="button"
            onClick={onToggleDock}
            data-testid="prompt-panel-dock"
            title="Dock decision panel back into sidebar"
            aria-label="Dock decision panel"
            className="inline-flex items-center gap-1 px-2 py-1 rounded-[2px] text-[11px] font-mono text-slate-300 hover:text-white hover:bg-slate-800 border border-slate-700/80 shrink-0"
          >
            <PanelRight className="w-3.5 h-3.5" /> Dock
          </button>
        ) : undefined
      }
      title={titleLabel}
    >
      {promptContent}
    </FloatingPanel>
  );
};

