import { motion } from 'framer-motion';
import { CardInstance, HIDDEN_CORP, getCardDefinition } from '../../core';
import { CardView } from './CardView';
import { AccessedCard } from '../savedGame';
import { shouldReduceMotion } from '../animations';

/** The cards the Runner accessed in the latest run, so accesses with nothing to decide are still seen. */
export function AccessedPanel({
  cards,
  onInspect,
  onClose,
}: {
  /** As the viewer saw them: a card with no code (an R&D access seen by the Corp, rules 7.1.2) shows face down. */
  cards: AccessedCard[];
  onInspect: (card: CardInstance) => void;
  onClose: () => void;
}) {
  const prefersReduced = shouldReduceMotion();
  // Rules 7.1.5a: only cards with a trash cost can be trashed on access. Explains a
  // card the viewer can see that got no trash offer (agendas are stolen instead).
  const untrashable = cards.some(({ code }) => {
    if (!code) return false;
    const def = getCardDefinition(code);
    return def.type_code !== 'agenda' && def.trash_cost == null;
  });
  return (
    <motion.div
      initial={prefersReduced ? false : { opacity: 0, scale: 0.95, y: 6 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      transition={prefersReduced ? { duration: 0 } : { duration: 0.14, ease: [0.16, 1, 0.3, 1] }}
      className="fixed left-4 bottom-6 z-40 w-72 max-w-[calc(100vw-2rem)] bg-[#090d15]/95 border border-pink-700/80 rounded-[2px] p-3 shadow-2xl font-mono"
      data-testid="accessed-panel"
    >
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs font-bold text-pink-300 uppercase tracking-wider">Accessed this run ({cards.length})</span>
        <button onClick={onClose} className="text-slate-400 hover:text-white text-xs px-1.5" aria-label="Dismiss accessed cards">
          ✕
        </button>
      </div>
      <div className="flex gap-2 overflow-x-auto pb-1">
        {cards.map(({ code }, i) => (
          <CardView
            key={`${code ?? 'hidden'}-${i}`}
            card={{ instanceId: `accessed-${i}`, cardCode: code ?? HIDDEN_CORP, isRezzed: true, advancementCounters: 0, tokens: {}, hostedCardIds: [] }}
            size="xs"
            notInstalled
            isFaceDown={!code}
            canPeek={!!code}
            plainBack
            onInspect={code ? onInspect : undefined}
          />
        ))}
      </div>
      {untrashable && <p className="text-[11px] text-slate-500 mt-1.5">Cards without a trash cost (most ice and operations) can&apos;t be trashed.</p>}
    </motion.div>
  );
}
