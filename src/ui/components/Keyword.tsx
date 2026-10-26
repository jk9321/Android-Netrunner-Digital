import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { GLOSSARY } from '../glossary';

/** Marks UI text as a rules term; hovering it shows the glossary tooltip. */
export const Keyword: React.FC<{ id: string; children: React.ReactNode; className?: string }> = ({ id, children, className = '' }) =>
  GLOSSARY[id] ? (
    <span data-kw={id} className={`kw-label ${className}`}>
      {children}
    </span>
  ) : (
    <span className={className}>{children}</span>
  );

const WIDTH = 280;

/**
 * One tooltip for the whole app. Any element with data-kw="<glossary id>", including
 * spans inside card text set with dangerouslySetInnerHTML, shows that term's definition on hover.
 * An element with data-tip="<text>" (and optionally data-tip-title) shows that text instead,
 * e.g. the whole of a badge cut short by its card's width.
 */
export const KeywordTooltip: React.FC = () => {
  const [tip, setTip] = useState<{ term: string; text: string; rect: DOMRect } | null>(null);

  useEffect(() => {
    let current: Element | null = null;
    const show = (el: Element | null) => {
      const entry = el && GLOSSARY[el.getAttribute('data-kw') ?? ''];
      const text = el?.getAttribute('data-tip');
      if (el && entry) setTip({ term: entry.term, text: entry.text, rect: el.getBoundingClientRect() });
      else if (el && text) setTip({ term: el.getAttribute('data-tip-title') ?? '', text, rect: el.getBoundingClientRect() });
      else setTip(null);
    };
    const over = (e: MouseEvent) => {
      const el = (e.target as Element | null)?.closest?.('[data-kw], [data-tip]') ?? null;
      if (el === current) return;
      current = el;
      show(el);
    };
    const hide = () => {
      current = null;
      setTip(null);
    };
    // Follow the term when the page scrolls under the pointer
    const follow = () => {
      if (current) show(current.isConnected ? current : null);
    };
    document.addEventListener('mouseover', over);
    document.addEventListener('scroll', follow, true);
    document.addEventListener('mousedown', hide);
    return () => {
      document.removeEventListener('mouseover', over);
      document.removeEventListener('scroll', follow, true);
      document.removeEventListener('mousedown', hide);
    };
  }, []);

  if (!tip) return null;
  const pad = 8;
  const left = Math.max(pad, Math.min(window.innerWidth - WIDTH - pad, tip.rect.left + tip.rect.width / 2 - WIDTH / 2));
  // Above the term when there is room, otherwise below it
  const above = tip.rect.top > 140;
  const style: React.CSSProperties = above
    ? { left, bottom: window.innerHeight - tip.rect.top + 6 }
    : { left, top: tip.rect.bottom + 6 };

  return createPortal(
    <div
      role="tooltip"
      data-testid="keyword-tooltip"
      style={{ position: 'fixed', width: WIDTH, zIndex: 10050, ...style }}
      className="pointer-events-none rounded-lg border border-amber-500/70 bg-slate-950/95 px-3 py-2 font-mono text-xs leading-snug text-slate-200 shadow-2xl backdrop-blur"
    >
      {tip.term && <div className="mb-0.5 font-bold text-amber-300">{tip.term}</div>}
      {tip.text}
    </div>,
    document.body
  );
};
