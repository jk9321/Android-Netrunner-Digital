import React, { useState } from 'react';
import { CardInstance, GameState, PromptChoice, activePrompt, availableCredits, cardDef, findCardAnywhere, isLegalAction, locateCorpCard } from '../../core';
import { CardView } from './CardView';
import { Check, RefreshCw, Trash2, X } from 'lucide-react';
import { CardNameText } from './CardNameText';
import { Credits } from './CreditIcon';
import { FloatingPanel } from './FloatingPanel';

/** An installed Corp card that is neither rezzed nor faceup: only the Corp may look at it (rules 4.6.3). */
function isFacedownCorpCard(state: GameState, card: CardInstance): boolean {
  if (card.isRezzed || card.faceUp || cardDef(card).side_code !== 'corp') return false;
  return Object.values(state.corp.servers).some(s => s.ice.includes(card) || s.root.includes(card));
}

interface PromptPanelProps {
  state: GameState;
  onAnswer: (choice: PromptChoice) => void;
  onInspectCard?: (card: CardInstance) => void;
  /** False when the decision belongs to the side not at the screen: show a waiting note instead. */
  canAnswer?: boolean;
}

/**
 * Shows the decision the game is waiting on, to the side it belongs to.
 * It floats over the board without dimming it: drag it by its header or
 * minimize it to a bar to look at the board while deciding.
 */
export const PromptPanel: React.FC<PromptPanelProps> = ({ state, onAnswer, onInspectCard, canAnswer = true }) => {
  const prompt = activePrompt(state);
  const [selected, setSelected] = useState<string[]>([]);
  if (!prompt) return null;
  if (!canAnswer) {
    return (
      <div className="fixed top-20 left-1/2 -translate-x-1/2 z-40 bg-slate-950/95 border border-slate-700 rounded-xl px-4 py-2 text-xs font-mono text-slate-300 shadow-xl">
        Waiting on the {prompt.side === 'corp' ? 'Corp' : 'Runner'} to decide…
      </div>
    );
  }

  const isCorp = prompt.side === 'corp';
  const hand = isCorp ? state.corp.hq : state.runner.grip;
  const accent = isCorp ? 'border-cyan-500 shadow-cyan-950/60' : 'border-pink-500 shadow-pink-950/60';
  // Selection stops at the most cards the prompt takes; with a limit of one, a new pick replaces the old
  const maxSelected = prompt.kind === 'discard' ? prompt.count : prompt.kind === 'effect_cards' ? prompt.max : Infinity;
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
  const isFull = selected.length >= maxSelected && maxSelected !== 1;
  const answer = (choice: PromptChoice) => {
    setSelected([]);
    onAnswer(choice);
  };

  const button = 'px-4 py-2 text-xs font-bold rounded-xl border flex items-center gap-1.5 transition-colors disabled:opacity-40';

  return (
    <FloatingPanel
      key={prompt.id}
      id="prompt"
      testId="prompt-panel"
      accentClass={accent}
      dotClass={isCorp ? 'bg-cyan-400' : 'bg-pink-400'}
      defaultPlacement="left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2"
      minimizedPlacement="left-1/2 top-20 -translate-x-1/2"
      widthClass="w-[56rem]"
      minimizedLabel={`Decision waiting: ${prompt.message}`}
      title={
        <div className={`text-xs font-bold uppercase tracking-wider ${isCorp ? 'text-cyan-400' : 'text-pink-400'}`}>
          {isCorp ? 'Corp' : 'Runner'} decision
        </div>
      }
    >
        <h3 className="text-sm text-slate-100 font-bold mb-4"><CardNameText text={prompt.message} /></h3>

        {prompt.kind === 'mulligan' && (
          <>
            <div className="flex gap-2 overflow-x-auto py-2 mb-4">
              {hand.map(card => (
                <CardView key={card.instanceId} card={card} size="sm" notInstalled onInspect={onInspectCard} />
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
          <div className="flex gap-2 justify-end flex-wrap">
            {prompt.options.map(option => (
              <button
                key={option.id}
                className={`${button} bg-slate-800 hover:bg-slate-700 border-slate-600 text-slate-100`}
                onClick={() => answer({ kind: 'access_order', optionId: option.id })}
              >
                <CardNameText text={option.label} focusable={false} />
              </button>
            ))}
          </div>
        )}

        {prompt.kind === 'effect_choice' && (
          <div className="flex gap-2 justify-end flex-wrap">
            {prompt.options.map(option => (
              <button
                key={option.id}
                className={`${button} bg-slate-800 hover:bg-slate-700 border-slate-600 text-slate-100`}
                onClick={() => answer({ kind: 'effect_choice', optionId: option.id })}
              >
                <CardNameText text={option.label} focusable={false} />
              </button>
            ))}
          </div>
        )}

        {prompt.kind === 'effect_cards' && (
          <>
            <div className="flex gap-2 overflow-x-auto py-2 mb-4">
              {prompt.candidateIds.map(id => {
                const card = findCardAnywhere(state, id);
                // The Runner never sees the face of an unrezzed Corp card it is choosing (Tāo Salonga)
                const secret = !!card && !isCorp && isFacedownCorpCard(state, card);
                return card ? (
                  <CardView
                    key={id}
                    card={card}
                    size="sm"
                    isFaceDown={secret}
                    canPeek={!secret}
                    isSelectable={!isFull || selected.includes(id)}
                    isSelected={selected.includes(id)}
                    onClick={() => toggle(id)}
                    onInspect={secret ? undefined : onInspectCard}
                  />
                ) : null;
              })}
            </div>
            <div className="flex items-center justify-between">
              <span className="text-xs text-slate-400">
                Selected {selected.length} ({prompt.min === prompt.max ? prompt.min : `${prompt.min}-${prompt.max}`})
                {isFull && <span className="text-amber-300"> · limit reached, deselect a card to change</span>}
              </span>
              <button
                className={`${button} bg-emerald-700 hover:bg-emerald-600 border-emerald-500 text-white`}
                disabled={selected.length < prompt.min || selected.length > prompt.max}
                onClick={() => answer({ kind: 'effect_cards', cardInstanceIds: selected })}
              >
                <Check className="w-3.5 h-3.5" /> Confirm
              </button>
            </div>
          </>
        )}

        {prompt.kind === 'access_trash' && (() => {
          const card = locateCorpCard(state, prompt.cardInstanceId)?.card;
          // Count every credit the Runner could pay the trash cost with, and only offer it when affordable
          const canPay = card ? availableCredits(state, 'runner', { kind: 'trash', card }) : state.runner.credits;
          const canTrash = isLegalAction(state, {
            type: 'RESOLVE_PROMPT',
            player: 'runner',
            promptId: prompt.id,
            choice: { kind: 'access_trash', trash: true },
          });
          return (
            <>
              <div className="flex items-center gap-4 mb-4">
                {card && <CardView card={card} size="md" onInspect={onInspectCard} />}
                <div className="text-xs text-slate-300">
                  {card && <div className="font-bold text-slate-100 mb-1">{cardDef(card).title}</div>}
                  {prompt.trashCost !== null && (
                    <>
                      Trash cost: <span className="text-red-300 font-bold"><Credits amount={prompt.trashCost} /></span> ·{' '}
                    </>
                  )}
                  You have <span className="text-amber-300 font-bold"><Credits amount={canPay} /></span>
                  {canPay !== state.runner.credits && (
                    <span className="text-slate-400"> ({state.runner.credits} in your pool, the rest from run or hosted credits)</span>
                  )}
                </div>
              </div>
              <div className="flex gap-2 justify-end flex-wrap">
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
                    onClick={() => answer({ kind: 'access_trash', trash: true })}
                  >
                    <Trash2 className="w-3.5 h-3.5" /> Trash (<Credits amount={prompt.trashCost ?? 0} />)
                  </button>
                )}
              </div>
            </>
          );
        })()}
    </FloatingPanel>
  );
};
