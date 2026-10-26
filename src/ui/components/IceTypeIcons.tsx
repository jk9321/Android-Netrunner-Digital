import React from 'react';
import { BrickWall, KeyRound, Swords } from 'lucide-react';
import type { IceSubtype } from '../../core/scripts/types';
import type { CardInstance } from '../../core/types/card';
import { breakerScript } from '../../core/engine/ice';

const ICON: Record<IceSubtype, React.ElementType> = {
  barrier: BrickWall,
  'code gate': KeyRound,
  sentry: Swords,
};
const LABEL: Record<IceSubtype, string> = { barrier: 'Barrier', 'code gate': 'Code gate', sentry: 'Sentry' };
// Glossary ids for the hover tooltip: the ice subtype on ice, the breaker that answers it on icebreakers
const ICE_KW: Record<IceSubtype, string> = { barrier: 'barrier', 'code gate': 'code-gate', sentry: 'sentry' };
const BREAKER_KW: Record<IceSubtype, string> = { barrier: 'fracter', 'code gate': 'decoder', sentry: 'killer' };
const ORDER: IceSubtype[] = ['barrier', 'code gate', 'sentry'];

/** What an icebreaker breaks (AI breakers: everything), matched against the icons on ice. */
export function breakerTypes(card: CardInstance): IceSubtype[] {
  const breaks = breakerScript(card)?.breaks;
  return breaks === 'any' ? [...ORDER] : breaks ? [breaks] : [];
}

/**
 * Ice types at a glance: blue on ice for what it is, red on icebreakers for
 * what they break, so matching icons show which ice the Runner has answers for.
 */
export const IceTypeIcons: React.FC<{ types: IceSubtype[]; side: 'ice' | 'breaker'; row?: boolean; className?: string }> = ({
  types,
  side,
  row = false,
  className = '',
}) => {
  if (types.length === 0) return null;
  const tone = side === 'ice' ? 'bg-cyan-950/95 border-cyan-400 text-cyan-200' : 'bg-pink-950/95 border-pink-500 text-pink-100';
  const verb = side === 'ice' ? '' : 'Breaks ';
  return (
    <div className={`flex ${row ? 'flex-row' : 'flex-col'} gap-[0.2em] pointer-events-none ${className}`} data-testid={`${side}-types`}>
      {ORDER.filter(t => types.includes(t)).map(t => {
        const Icon = ICON[t];
        // A breaker that breaks every type is an AI breaker
        const kw = side === 'ice' ? ICE_KW[t] : types.length === ORDER.length ? 'ai' : BREAKER_KW[t];
        return (
          <span
            key={t}
            data-kw={kw}
            className={`pointer-events-auto flex items-center justify-center w-[2em] h-[2em] rounded-full border ${tone}`}
            aria-label={`${verb}${LABEL[t]}`}
          >
            <Icon className="w-[1.2em] h-[1.2em]" />
          </span>
        );
      })}
    </div>
  );
};
