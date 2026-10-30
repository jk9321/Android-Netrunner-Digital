import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { DeckList } from '../../data/decks';
import { ImportResult, fetchNetrunnerDbDeck, importDeckText, parseNetrunnerDbUrl, resolveImport } from '../../data/deckImport';
import { AlertTriangle, CheckCircle2, Download, FileUp, Pencil, Save, X } from 'lucide-react';

interface ImportDeckModalProps {
  onSave: (deck: DeckList) => void;
  onEdit: (deck: DeckList) => void;
  onClose: () => void;
}

/** Paste a NetrunnerDB export or link, or load a .txt/.o8d file, and save it as a custom deck. */
export const ImportDeckModal: React.FC<ImportDeckModalProps> = ({ onSave, onEdit, onClose }) => {
  const [text, setText] = useState('');
  const [fetched, setFetched] = useState<{ url: string; result: ImportResult } | null>(null);
  const [fetching, setFetching] = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [name, setName] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const link = parseNetrunnerDbUrl(text) && text.trim().split(/\s+/).length === 1 ? text.trim() : null;
  const result = useMemo<ImportResult | null>(() => {
    if (link) return fetched?.url === link ? fetched.result : null;
    return text.trim() ? importDeckText(text) : null;
  }, [text, link, fetched]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const changeText = (value: string) => {
    setText(value);
    setName(null);
    setFetchError(null);
  };

  const fetchLink = async () => {
    if (!link) return;
    setFetching(true);
    setFetchError(null);
    try {
      setFetched({ url: link, result: resolveImport(await fetchNetrunnerDbDeck(link)) });
    } catch (e) {
      setFetchError((e as Error).message || 'Could not reach NetrunnerDB.');
    } finally {
      setFetching(false);
    }
  };

  const loadFile = async (file: File | undefined) => {
    if (!file) return;
    changeText(await file.text());
  };

  const deck = result?.deck ? { ...result.deck, name: (name ?? result.deck.name).trim() || result.deck.name } : null;
  const cardCount = deck ? Object.values(deck.cards).reduce((a, b) => a + b, 0) : 0;

  return createPortal(
    <div
      onClick={onClose}
      className="fixed inset-0 z-[10000] bg-black/80 backdrop-blur-md flex items-center justify-center p-4"
      data-testid="import-modal"
    >
      <div
        onClick={e => e.stopPropagation()}
        className="relative w-full max-w-2xl max-h-[90vh] overflow-y-auto bg-slate-950 border-2 border-indigo-500 chamfer p-6 shadow-2xl font-mono text-slate-100"
      >
        <button
          onClick={onClose}
          className="absolute top-4 right-4 p-2 bg-slate-900 hover:bg-slate-800 rounded-full text-slate-400 hover:text-white border border-slate-800"
          title="Close (Esc)"
          aria-label="Close"
        >
          <X className="w-4 h-4" />
        </button>
        <h2 className="font-cyber font-bold tracking-wider text-indigo-300 mb-1">IMPORT A DECK</h2>
        <p className="text-xs text-slate-400 mb-3 pr-10">
          Paste a NetrunnerDB export (Download → Text file, or a Markdown or BBCode copy), a jinteki.net list, or a NetrunnerDB
          decklist link. You can also load a .txt or OCTGN .o8d file. Cards are matched by title against System Gateway and
          Elevation.
        </p>
        <textarea
          value={text}
          onChange={e => changeText(e.target.value)}
          placeholder={'My deck\n\nThe Catalyst: Convention Breaker (System Gateway)\n\nEvent (3)\n3x Sure Gamble (System Gateway)\n…'}
          rows={9}
          autoFocus
          data-testid="import-text"
          className="w-full bg-slate-900 border border-slate-700 rounded-lg p-2 text-xs focus:outline-none focus:border-indigo-400"
        />
        <div className="flex flex-wrap items-center gap-2 mt-2">
          <input
            ref={fileInput}
            type="file"
            accept=".txt,.o8d,.md,.xml,text/plain"
            className="hidden"
            data-testid="import-file"
            onChange={e => {
              void loadFile(e.target.files?.[0]);
              e.target.value = '';
            }}
          />
          <button
            onClick={() => fileInput.current?.click()}
            className="px-2.5 py-1 rounded-lg border border-slate-700 hover:border-slate-500 text-xs flex items-center gap-1"
          >
            <FileUp className="w-3.5 h-3.5" /> Load a file
          </button>
          {link && (
            <button
              onClick={() => void fetchLink()}
              disabled={fetching}
              data-testid="import-fetch"
              className="disabled:opacity-50 px-2.5 py-1 rounded-lg border border-indigo-500 bg-indigo-950 hover:bg-indigo-900 text-xs flex items-center gap-1"
            >
              <Download className="w-3.5 h-3.5" /> {fetching ? 'Fetching…' : 'Fetch from NetrunnerDB'}
            </button>
          )}
        </div>
        {fetchError && <p className="mt-2 text-xs text-red-400">{fetchError}</p>}

        {result && (
          <div className="mt-4 border-t border-slate-800 pt-4 text-xs" data-testid="import-preview">
            {deck ? (
              <>
                <label className="block text-[12px] uppercase tracking-wider text-slate-500 font-bold mb-1">Deck name</label>
                <input
                  value={name ?? deck.name}
                  onChange={e => setName(e.target.value)}
                  data-testid="import-name"
                  className="w-full bg-slate-900 border border-slate-700 rounded-lg px-2 py-1 mb-2 focus:outline-none focus:border-indigo-400"
                />
                <div className={deck.side === 'corp' ? 'text-cyan-300' : 'text-pink-300'}>
                  {deck.side === 'corp' ? 'Corp' : 'Runner'} · {deck.identity} · {cardCount} cards
                </div>
              </>
            ) : null}
            {result.notes.map(n => (
              <p key={n} className="mt-2 text-slate-300">
                {n}
              </p>
            ))}
            {result.missing.length > 0 && (
              <div className="mt-2 text-amber-400" data-testid="import-missing">
                <div className="flex items-center gap-1 font-bold">
                  <AlertTriangle className="w-3.5 h-3.5" /> Not in this game, left out:
                </div>
                <ul className="ml-5 list-disc text-amber-300/90">
                  {result.missing.map(m => (
                    <li key={m.title}>
                      {m.count}x {m.title}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {deck &&
              (result.problems.length === 0 ? (
                <p className="mt-2 text-emerald-400 flex items-center gap-1">
                  <CheckCircle2 className="w-3.5 h-3.5" /> Legal deck
                </p>
              ) : (
                <div className="mt-2 text-amber-400" data-testid="import-problems">
                  <div className="font-bold">Not legal yet (it saves, but can't start a game until fixed):</div>
                  <ul className="ml-5 list-disc text-amber-300/90">
                    {result.problems.map(p => (
                      <li key={p}>{p}</li>
                    ))}
                  </ul>
                </div>
              ))}
          </div>
        )}

        <div className="mt-5 flex justify-end gap-2">
          <button onClick={onClose} className="px-3 py-1.5 rounded-lg border border-slate-700 hover:border-slate-500 text-xs">
            Cancel
          </button>
          <button
            onClick={() => deck && onEdit(deck)}
            disabled={!deck}
            data-testid="import-edit"
            className="disabled:opacity-40 disabled:cursor-not-allowed px-3 py-1.5 rounded-lg border border-slate-600 hover:border-slate-400 text-xs flex items-center gap-1"
          >
            <Pencil className="w-3.5 h-3.5" /> Open in deckbuilder
          </button>
          <button
            onClick={() => deck && onSave(deck)}
            disabled={!deck}
            data-testid="import-save"
            className="disabled:opacity-40 disabled:cursor-not-allowed px-3 py-1.5 rounded-lg bg-amber-400 hover:bg-amber-300 text-black font-bold text-xs flex items-center gap-1"
          >
            <Save className="w-3.5 h-3.5" /> Save deck
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
};
