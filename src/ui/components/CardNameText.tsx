import React, { useEffect, useState } from 'react';
import { CardInstance } from '../../core/types/card';
import { ALL_CARDS } from '../../data/cards';
import { CardPopout } from './CardPopout';
import { renderSymbols } from './CreditIcon';

// Every printed title (and its accent-free spelling) mapped to its card code, so
// card names already shown in text (log lines, prompts) can show the card on hover.
const CODE_BY_TITLE = new Map<string, string>();
for (const c of ALL_CARDS) {
  CODE_BY_TITLE.set(c.title, c.code);
  if (c.stripped_title) CODE_BY_TITLE.set(c.stripped_title, c.code);
}
const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
// Longest first so "Bran 1.0" wins over a shorter title inside it; letters or
// digits on either side mean it's part of another word.
const TITLE_RE = new RegExp(
  `(?<![\\p{L}\\p{N}])(${[...CODE_BY_TITLE.keys()].sort((a, b) => b.length - a.length).map(escape).join('|')})(?![\\p{L}\\p{N}])`,
  'gu',
);

/** Splits text into plain runs and card names. */
export function splitCardNames(text: string): Array<string | { title: string; code: string }> {
  const parts: Array<string | { title: string; code: string }> = [];
  let last = 0;
  for (const m of text.matchAll(TITLE_RE)) {
    if (m.index > last) parts.push(text.slice(last, m.index));
    parts.push({ title: m[0], code: CODE_BY_TITLE.get(m[0])! });
    last = m.index + m[0].length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return parts;
}

interface CardNameTextProps {
  text: string;
  /**
   * Whether each name can take keyboard focus. Off inside buttons, where a
   * focusable child would be a second tab stop inside the control.
   */
  focusable?: boolean;
  /** Extra classes for the names, e.g. to make them stand out from the text. */
  nameClassName?: string;
}

/**
 * Text with each card name it already prints underlined; hovering, focusing, or tapping
 * a name shows that card. Rules symbols like [click] are drawn as icons. Only names in the text, so nothing hidden is revealed.
 */
export const CardNameText: React.FC<CardNameTextProps> = ({ text, focusable = true, nameClassName = '' }) => {
  const [hovered, setHovered] = useState<{ card: CardInstance; rect: DOMRect; pinned?: boolean } | null>(null);

  const makeCard = (code: string): CardInstance => ({
    instanceId: `text-${code}`,
    cardCode: code,
    isRezzed: true,
    advancementCounters: 0,
    tokens: {},
    hostedCardIds: [],
  });

  const show = (code: string) => (e: React.SyntheticEvent<HTMLElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    setHovered(prev => (prev?.pinned && prev.card.cardCode === code ? prev : { card: makeCard(code), rect }));
  };
  const hide = () => setHovered(prev => (prev?.pinned ? prev : null));

  const toggleTap = (code: string) => (e: React.MouseEvent<HTMLElement>) => {
    if (!focusable) return;
    e.stopPropagation();
    const rect = e.currentTarget.getBoundingClientRect();
    setHovered(prev =>
      prev?.card.cardCode === code && prev.pinned
        ? null
        : { card: makeCard(code), rect, pinned: true },
    );
  };

  useEffect(() => {
    if (!hovered?.pinned) return;
    const dismiss = () => setHovered(null);
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setHovered(null);
    };
    window.addEventListener('click', dismiss);
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('click', dismiss);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [hovered?.pinned]);

  return (
    <>
      {splitCardNames(text).map((part, i) =>
        typeof part === 'string' ? (
          <React.Fragment key={i}>{renderSymbols(part)}</React.Fragment>
        ) : (
          <span
            key={i}
            tabIndex={focusable ? 0 : undefined}
            data-testid="card-name"
            className={`underline decoration-dotted decoration-slate-400 underline-offset-2 cursor-help hover:text-amber-300 focus:text-amber-300 ${nameClassName}`}
            onMouseEnter={show(part.code)}
            onMouseLeave={hide}
            onFocus={show(part.code)}
            onBlur={hide}
            onClick={toggleTap(part.code)}
          >
            {part.title}
          </span>
        ),
      )}
      {hovered && (
        <CardPopout
          card={hovered.card}
          targetRect={hovered.rect}
          onClose={hovered.pinned ? () => setHovered(null) : undefined}
        />
      )}
    </>
  );
};
