import { annotateKeywords } from './glossary';
import {
  CLICK_ICON_HTML,
  CREDIT_ICON_HTML,
  LINK_ICON_HTML,
  MU_ICON_HTML,
  RECURRING_CREDIT_ICON_HTML,
  SUBROUTINE_ICON_HTML,
  TRASH_ICON_HTML,
} from './components/CreditIcon';

const symbol = (kw: string, color: string, icon: string) =>
  `<span data-kw="${kw}" class="kw-label ${color} font-bold inline-flex items-center">${icon}</span>`;

const SYMBOLS: Record<string, string> = {
  '[credit]': symbol('credit', 'text-amber-400', CREDIT_ICON_HTML),
  '[click]': symbol('click', 'text-red-400', CLICK_ICON_HTML),
  '[subroutine]': symbol('subroutine', 'text-cyan-400', SUBROUTINE_ICON_HTML),
  '[trash]': symbol('trash-symbol', 'text-red-400', TRASH_ICON_HTML),
  '[recurring-credit]': symbol('recurring-credit', 'text-amber-300', RECURRING_CREDIT_ICON_HTML),
  '[mu]': symbol('mu', 'text-pink-300', MU_ICON_HTML),
  '[link]': symbol('link', 'text-emerald-400', LINK_ICON_HTML),
  // Vantage Point: "[interrupt] → When this asset would be uninstalled" (Luana Campos)
  '[interrupt]': symbol('interrupt', 'text-yellow-300', '<span class="uppercase tracking-wide text-[0.85em]">Interrupt</span>'),
};

/**
 * NetrunnerDB card text (with its <em>/<strong>/<ul> markup and [click]-style symbol tokens) as HTML
 * for dangerouslySetInnerHTML: rules terms marked for hover tooltips, symbols drawn as the official
 * icons, line breaks kept. Every place that shows a card's rules text uses this.
 */
export function cardTextHtml(text: string): string {
  return annotateKeywords(text)
    .replace(/\[[a-z-]+\]/g, token => SYMBOLS[token] ?? token)
    .replace(/\n/g, '<br />');
}
