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
export const IceTypeIcons: React.FC<{ types: IceSubtype[]; side: 'ice' | 'breaker'; className?: string }> = ({
  types,
  side,
  className = '',
}) => {
  if (types.length === 0) return null;
  const tone = side === 'ice' ? 'bg-cyan-950/95 border-cyan-400 text-cyan-200' : 'bg-pink-950/95 border-pink-500 text-pink-100';
  const verb = side === 'ice' ? '' : 'Breaks ';
  return (
    <div className={`z-20 flex flex-col gap-0.5 pointer-events-none ${className}`} data-testid={`${side}-types`}>
      {ORDER.filter(t => types.includes(t)).map(t => {
        const Icon = ICON[t];
        return (
          <span key={t} className={`flex items-center justify-center w-5 h-5 rounded-full border ${tone}`} title={`${verb}${LABEL[t]}`}>
            <Icon className="w-3 h-3" />
          </span>
        );
      })}
    </div>
  );
};
