import React from 'react';
import type { IceSubtype } from '../../core/scripts/types';
import type { CardInstance } from '../../core/types/card';
import { breakerScript } from '../../core/engine/ice';

function BarrierIcon({ className = 'w-[1.2em] h-[1.2em]' }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" className={className} aria-hidden="true">
      <path d="M3 3h18v18H3z" />
      <path d="M3 9h18" />
      <path d="M3 15h18" />
      <path d="M12 3v6" />
      <path d="M8 9v6" />
      <path d="M16 9v6" />
      <path d="M12 15v6" />
    </svg>
  );
}

function CodeGateIcon({ className = 'w-[1.2em] h-[1.2em]' }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className={className} aria-hidden="true">
      <path d="M6 3.5h1.5v3" />
      <rect x="5" y="9.5" width="3.5" height="4.5" rx="1" />
      <path d="M6 17.5h1.5v3" />
      <line x1="12" y1="2" x2="12" y2="22" strokeDasharray="2 2" strokeWidth="1.2" opacity="0.6" />
      <rect x="15.5" y="3.5" width="3.5" height="4.5" rx="1" />
      <path d="M16.5 11h1.5v3" />
      <rect x="15.5" y="16.5" width="3.5" height="4.5" rx="1" />
    </svg>
  );
}

function SentryIcon({ className = 'w-[1.2em] h-[1.2em]' }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={className} aria-hidden="true">
      <circle cx="12" cy="12" r="3" />
      <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z" />
      <line x1="12" y1="1.5" x2="12" y2="4.5" strokeWidth="2.2" />
      <line x1="12" y1="19.5" x2="12" y2="22.5" strokeWidth="2.2" />
    </svg>
  );
}

const ICON: Record<IceSubtype, React.ElementType> = {
  barrier: BarrierIcon,
  'code gate': CodeGateIcon,
  sentry: SentryIcon,
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
